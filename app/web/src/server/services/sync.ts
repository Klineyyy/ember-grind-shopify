/**
 * Pulls catalog, stock and recent order history from the Shopify Admin
 * GraphQL API into MySQL, then rescores the shop.
 */
import type { Session } from '@shopify/shopify-api';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { inventorySnapshots, products, salesDaily, shops } from '../db/schema.js';
import { shopify } from '../shopify.js';
import { logActivity } from './activity.js';
import { addDays } from './riskEngine.js';
import { rescoreShop } from './scoring.js';

const ORDER_HISTORY_DAYS = 60; // read_orders exposes the last 60 days

const PRODUCTS_QUERY = `#graphql
  query SyncProducts($cursor: String) {
    shop { name currencyCode }
    products(first: 50, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        title
        featuredMedia { preview { image { url(transform: { maxWidth: 200 }) } } }
        variants(first: 100) {
          nodes {
            id
            title
            sku
            price
            inventoryItem {
              id
              tracked
              unitCost { amount }
              inventoryLevels(first: 10) {
                nodes { quantities(names: ["available"]) { name quantity } }
              }
            }
          }
        }
      }
    }
  }`;

const ORDERS_QUERY = `#graphql
  query SyncOrders($cursor: String, $query: String!) {
    orders(first: 100, after: $cursor, query: $query, sortKey: CREATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes {
        createdAt
        lineItems(first: 100) {
          nodes {
            quantity
            variant { id }
            discountedTotalSet { shopMoney { amount } }
          }
        }
      }
    }
  }`;

type GqlProducts = {
  shop: { name: string; currencyCode: string };
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: {
      id: string;
      title: string;
      featuredMedia: { preview: { image: { url: string } | null } | null } | null;
      variants: {
        nodes: {
          id: string;
          title: string;
          sku: string | null;
          price: string;
          inventoryItem: {
            id: string;
            tracked: boolean;
            unitCost: { amount: string } | null;
            inventoryLevels: { nodes: { quantities: { name: string; quantity: number }[] }[] };
          };
        }[];
      };
    }[];
  };
};

type GqlOrders = {
  orders: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: {
      createdAt: string;
      lineItems: { nodes: { quantity: number; variant: { id: string } | null; discountedTotalSet: { shopMoney: { amount: string } } }[] };
    }[];
  };
};

export async function syncShop(session: Session, shopId: number) {
  const client = new shopify.api.clients.Graphql({ session });
  const started = Date.now();

  /* ---- Products, variants, stock ---- */
  let cursor: string | null = null;
  let variantCount = 0;
  do {
    const res: { data?: GqlProducts } = await client.request<GqlProducts>(PRODUCTS_QUERY, { variables: { cursor } });
    const data = res.data!;
    if (!cursor) {
      await db.update(shops).set({ name: data.shop.name, currency: data.shop.currencyCode }).where(eq(shops.id, shopId));
    }

    for (const product of data.products.nodes) {
      for (const variant of product.variants.nodes) {
        if (!variant.inventoryItem.tracked) continue; // untracked items can't run out
        const available = variant.inventoryItem.inventoryLevels.nodes
          .flatMap((l) => l.quantities)
          .filter((q) => q.name === 'available')
          .reduce((a, q) => a + q.quantity, 0);
        const values = {
          shopId,
          shopifyProductId: product.id,
          shopifyVariantId: variant.id,
          inventoryItemId: variant.inventoryItem.id,
          title: product.title,
          variantTitle: variant.title === 'Default Title' ? null : variant.title,
          sku: variant.sku || null,
          imageUrl: product.featuredMedia?.preview?.image?.url ?? null,
          price: Number(variant.price),
          available,
        };
        const unitCost = variant.inventoryItem.unitCost ? Number(variant.inventoryItem.unitCost.amount) : null;
        await db
          .insert(products)
          .values({ ...values, unitCost })
          // Keep a merchant-entered cost if Shopify has none.
          .onDuplicateKeyUpdate({ set: { ...values, ...(unitCost !== null ? { unitCost } : {}) } });
        variantCount++;
      }
    }
    cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
  } while (cursor);

  // One snapshot per product per sync for stock history charts.
  const all = await db.select({ id: products.id, available: products.available }).from(products).where(eq(products.shopId, shopId));
  if (all.length) {
    await db.insert(inventorySnapshots).values(all.map((p) => ({ productId: p.id, available: p.available, source: 'sync' as const })));
  }

  /* ---- Orders → sales_daily ---- */
  const variantToProduct = new Map(
    (await db.select({ id: products.id, variantId: products.shopifyVariantId }).from(products).where(eq(products.shopId, shopId))).map(
      (p) => [p.variantId, p.id]
    )
  );
  const buckets = new Map<string, { productId: number; day: string; units: number; revenue: number }>();
  const since = addDays(new Date(), -ORDER_HISTORY_DAYS);
  let orderCount = 0;
  let ordersError: string | null = null;
  cursor = null;
  try {
    do {
      const res: { data?: GqlOrders } = await client.request<GqlOrders>(ORDERS_QUERY, {
        variables: { cursor, query: `created_at:>=${since} AND -status:cancelled` },
      });
      const data = res.data!;
      for (const order of data.orders.nodes) {
        orderCount++;
        const day = order.createdAt.slice(0, 10);
        for (const line of order.lineItems.nodes) {
          const productId = line.variant ? variantToProduct.get(line.variant.id) : undefined;
          if (!productId) continue;
          const key = `${productId}:${day}`;
          const bucket = buckets.get(key) ?? { productId, day, units: 0, revenue: 0 };
          bucket.units += line.quantity;
          bucket.revenue += Number(line.discountedTotalSet.shopMoney.amount);
          buckets.set(key, bucket);
        }
      }
      cursor = data.orders.pageInfo.hasNextPage ? data.orders.pageInfo.endCursor : null;
    } while (cursor);
  } catch (err) {
    // Orders are protected customer data; until the app is approved Shopify rejects the query.
    // Keep the catalog/stock sync useful and fall back to whatever sales history we already have.
    ordersError = (err as Error).message;
    console.warn(`Order history unavailable for shop ${shopId}: ${ordersError}`);
  }

  if (buckets.size) {
    // Real order data wins over simulated demo data for the same day.
    await db
      .insert(salesDaily)
      .values([...buckets.values()].map((b) => ({ ...b, isSimulated: false })))
      .onDuplicateKeyUpdate({
        set: { units: sql`VALUES(units)`, revenue: sql`VALUES(revenue)`, isSimulated: false },
      });
  }

  await db.update(shops).set({ lastSyncedAt: new Date() }).where(eq(shops.id, shopId));
  const { scored } = await rescoreShop(shopId);

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const summary = ordersError
    ? `Synced ${variantCount} variants in ${seconds}s (order history unavailable: protected customer data not approved)`
    : `Synced ${variantCount} variants and ${orderCount} orders in ${seconds}s`;
  await logActivity({ shopId, actor: 'system', entityType: 'sync', action: 'full_sync', summary, changes: { variantCount, orderCount, scored, ordersError } });
  return { variantCount, orderCount, scored, ordersError };
}

/* -------------------------------------------------------------------------- */
/* Incremental updates from webhooks                                          */
/* -------------------------------------------------------------------------- */

type OrderWebhook = { created_at: string; line_items: { variant_id: number | null; quantity: number; price: string }[] };

export async function applyOrderWebhook(shopId: number, order: OrderWebhook) {
  const day = order.created_at.slice(0, 10);
  const variantIds = order.line_items.filter((l) => l.variant_id).map((l) => `gid://shopify/ProductVariant/${l.variant_id}`);
  if (!variantIds.length) return;
  const rows = await db
    .select({ id: products.id, variantId: products.shopifyVariantId })
    .from(products)
    .where(and(eq(products.shopId, shopId), inArray(products.shopifyVariantId, variantIds)));
  const byVariant = new Map(rows.map((r) => [r.variantId, r.id]));

  for (const line of order.line_items) {
    const productId = byVariant.get(`gid://shopify/ProductVariant/${line.variant_id}`);
    if (!productId) continue;
    const revenue = Number(line.price) * line.quantity;
    await db
      .insert(salesDaily)
      .values({ productId, day, units: line.quantity, revenue })
      .onDuplicateKeyUpdate({
        set: { units: sql`${salesDaily.units} + ${line.quantity}`, revenue: sql`${salesDaily.revenue} + ${revenue}` },
      });
  }
  if (rows.length) await rescoreShop(shopId, rows.map((r) => r.id));
}

type InventoryWebhook = { inventory_item_id: number; available: number | null };

/** Assumes a single stock location (true for the demo store); full sync reconciles multi-location totals. */
export async function applyInventoryWebhook(shopId: number, payload: InventoryWebhook) {
  if (payload.available === null) return;
  const product = await db.query.products.findFirst({
    where: and(eq(products.shopId, shopId), eq(products.inventoryItemId, `gid://shopify/InventoryItem/${payload.inventory_item_id}`)),
  });
  if (!product || product.available === payload.available) return;
  await db.update(products).set({ available: payload.available }).where(eq(products.id, product.id));
  await db.insert(inventorySnapshots).values({ productId: product.id, available: payload.available, source: 'webhook' });
  await rescoreShop(shopId, [product.id]);
}
