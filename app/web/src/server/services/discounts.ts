/**
 * Clearance discounts: real Shopify discount codes scoped to overstocked
 * variants, stored locally so the app can show progress (uses, revenue,
 * units sold since launch, excess stock cleared) and keep an audit trail.
 */
import type { Session } from '@shopify/shopify-api';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { clearanceDiscountItems, clearanceDiscounts, products, salesDaily, shops } from '../db/schema.js';
import { shopify } from '../shopify.js';
import { logActivity } from './activity.js';
import { excessUnits, suggestForSelection } from './clearance.js';
import { AppError } from './errors.js';
import { latestScoreByProduct } from './scoring.js';

type UserError = { field?: string[] | null; message: string };

const CREATE_MUTATION = `#graphql
  mutation CreateClearance($input: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $input) {
      codeDiscountNode { id }
      userErrors { field message }
    }
  }`;

const DEACTIVATE_MUTATION = `#graphql
  mutation EndClearance($id: ID!) {
    discountCodeDeactivate(id: $id) { userErrors { field message } }
  }`;

const LIVE_QUERY = `#graphql
  query ClearanceStats($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on DiscountCodeNode {
        id
        codeDiscount {
          ... on DiscountCodeBasic { status asyncUsageCount totalSales { amount } }
        }
      }
    }
  }`;

async function loadShopProducts(shopId: number, productIds: number[]) {
  const rows = await db.select().from(products).where(and(eq(products.shopId, shopId), inArray(products.id, productIds)));
  if (rows.length !== new Set(productIds).size) throw new AppError('One or more products do not belong to this shop', 404);
  return rows;
}

/** Suggested code and % off for the chosen variants, plus the numbers behind it. */
export async function suggestClearance(shopId: number, productIds: number[]) {
  const shop = (await db.query.shops.findFirst({ where: eq(shops.id, shopId) }))!;
  const rows = productIds.length ? await loadShopProducts(shopId, productIds) : [];
  const scores = await latestScoreByProduct(shopId);
  const candidates = rows.map((p) => {
    const s = scores.get(p.id);
    return {
      id: p.id,
      title: p.title,
      available: p.available,
      velocity: s ? Number(s.velocity) : null,
      daysOfCover: s?.daysOfCover == null ? null : Number(s.daysOfCover),
      tier: s?.tier ?? null,
      unitCost: p.unitCost,
    };
  });
  const excess = candidates.map((c) => excessUnits(c.available, c.velocity, shop.overstockDays));
  return {
    ...suggestForSelection(candidates, shop.overstockDays),
    excessUnits: excess.reduce((a, b) => a + b, 0),
    excessValue: Math.round(candidates.reduce((sum, c, i) => sum + excess[i] * Number(c.unitCost ?? 0), 0)),
  };
}

export async function createClearance(
  session: Session,
  shopId: number,
  input: { code: string; percentOff: number; productIds: number[]; endsAt?: string | null }
) {
  const code = input.code.trim().toUpperCase();
  const rows = await loadShopProducts(shopId, input.productIds);
  const existing = await db.query.clearanceDiscounts.findFirst({
    where: and(eq(clearanceDiscounts.shopId, shopId), eq(clearanceDiscounts.code, code)),
  });
  if (existing) throw new AppError(`The code ${code} is already used. Pick another.`, 409);

  const startsAt = new Date();
  const endsAt = input.endsAt ? new Date(`${input.endsAt}T23:59:59Z`) : null;
  if (endsAt && endsAt <= startsAt) throw new AppError('The end date must be in the future', 422);

  const client = new shopify.api.clients.Graphql({ session });
  const res = await client.request<{
    discountCodeBasicCreate: { codeDiscountNode: { id: string } | null; userErrors: UserError[] };
  }>(CREATE_MUTATION, {
    variables: {
      input: {
        title: `Restock Radar clearance — ${code}`,
        code,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt?.toISOString() ?? null,
        context: { all: 'ALL' },
        customerGets: {
          value: { percentage: input.percentOff / 100 },
          items: { products: { productVariantsToAdd: rows.map((p) => p.shopifyVariantId) } },
        },
        appliesOncePerCustomer: false,
        tags: ['restock-radar', 'clearance'],
      },
    },
  });
  const result = res.data!.discountCodeBasicCreate;
  if (result.userErrors.length || !result.codeDiscountNode) {
    throw new AppError(`Shopify rejected the discount: ${result.userErrors.map((e) => e.message).join('; ')}`, 422);
  }

  const shop = (await db.query.shops.findFirst({ where: eq(shops.id, shopId) }))!;
  const scores = await latestScoreByProduct(shopId);
  const discountId = await db.transaction(async (tx) => {
    const [inserted] = await tx.insert(clearanceDiscounts).values({
      shopId,
      shopifyDiscountId: result.codeDiscountNode!.id,
      code,
      percentOff: input.percentOff,
      startsAt,
      endsAt,
    });
    await tx.insert(clearanceDiscountItems).values(
      rows.map((p) => {
        const velocity = scores.get(p.id) ? Number(scores.get(p.id)!.velocity) : null;
        return {
          discountId: inserted.insertId,
          productId: p.id,
          availableAtStart: p.available,
          excessAtStart: excessUnits(p.available, velocity, shop.overstockDays),
        };
      })
    );
    await logActivity(
      {
        shopId,
        actor: 'merchant',
        entityType: 'discount',
        entityId: inserted.insertId,
        action: 'created',
        summary: `Created clearance code ${code}: ${input.percentOff}% off ${rows.length} variant${rows.length === 1 ? '' : 's'}`,
        changes: { endsAt: input.endsAt ?? null, products: rows.map((p) => p.id) },
      },
      tx
    );
    return inserted.insertId;
  });
  return discountId;
}

export async function listClearance(session: Session | null, shopId: number) {
  const rows = await db.query.clearanceDiscounts.findMany({
    where: eq(clearanceDiscounts.shopId, shopId),
    with: { items: { with: { product: true } } },
    orderBy: desc(clearanceDiscounts.createdAt),
  });
  if (!rows.length) return [];

  // Live usage + revenue from Shopify (best effort: the list still renders if this fails).
  let live = new Map<string, { status: string; uses: number; revenue: number }>();
  if (session) {
    try {
      const client = new shopify.api.clients.Graphql({ session });
      const res = await client.request<{
        nodes: ({ id: string; codeDiscount: { status: string; asyncUsageCount: number; totalSales: { amount: string } | null } } | null)[];
      }>(LIVE_QUERY, { variables: { ids: rows.map((r) => r.shopifyDiscountId) } });
      live = new Map(
        (res.data?.nodes ?? [])
          .filter((n): n is NonNullable<typeof n> => Boolean(n?.codeDiscount))
          .map((n) => [
            n.id,
            { status: n.codeDiscount.status, uses: n.codeDiscount.asyncUsageCount, revenue: Number(n.codeDiscount.totalSales?.amount ?? 0) },
          ])
      );
    } catch (err) {
      console.warn('Could not load live discount stats', err);
    }
  }

  const result = [];
  for (const row of rows) {
    const productIds = row.items.map((i) => i.productId);
    const since = row.startsAt.toISOString().slice(0, 10);
    const [{ units }] = await db
      .select({ units: sql<number>`COALESCE(SUM(${salesDaily.units}), 0)` })
      .from(salesDaily)
      .where(and(inArray(salesDaily.productId, productIds), gte(salesDaily.day, since)));
    const stats = live.get(row.shopifyDiscountId);

    // Shopify ends codes on their end date; mirror that locally.
    if (row.status === 'active' && stats?.status === 'EXPIRED') {
      await db.update(clearanceDiscounts).set({ status: 'ended', endedAt: new Date() }).where(eq(clearanceDiscounts.id, row.id));
      row.status = 'ended';
    }

    const availableAtStart = row.items.reduce((s, i) => s + i.availableAtStart, 0);
    const availableNow = row.items.reduce((s, i) => s + i.product.available, 0);
    result.push({
      id: row.id,
      code: row.code,
      percentOff: row.percentOff,
      status: row.status,
      shopifyStatus: stats?.status ?? null,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      endedAt: row.endedAt,
      uses: stats?.uses ?? null,
      revenue: stats?.revenue ?? null,
      unitsSoldSince: Number(units),
      excessAtStart: row.items.reduce((s, i) => s + i.excessAtStart, 0),
      stockCleared: Math.max(0, availableAtStart - availableNow),
      items: row.items.map((i) => ({
        productId: i.productId,
        title: i.product.title,
        variantTitle: i.product.variantTitle,
        imageUrl: i.product.imageUrl,
        availableAtStart: i.availableAtStart,
        availableNow: i.product.available,
      })),
    });
  }
  return result;
}

export async function endClearance(session: Session, shopId: number, id: number) {
  const row = await db.query.clearanceDiscounts.findFirst({ where: and(eq(clearanceDiscounts.id, id), eq(clearanceDiscounts.shopId, shopId)) });
  if (!row) throw new AppError('Discount not found', 404);
  if (row.status === 'ended') throw new AppError(`${row.code} has already ended`, 409);

  const client = new shopify.api.clients.Graphql({ session });
  const res = await client.request<{ discountCodeDeactivate: { userErrors: UserError[] } }>(DEACTIVATE_MUTATION, {
    variables: { id: row.shopifyDiscountId },
  });
  const errors = res.data?.discountCodeDeactivate.userErrors ?? [];
  if (errors.length) throw new AppError(`Shopify could not end the discount: ${errors.map((e) => e.message).join('; ')}`, 422);

  await db.update(clearanceDiscounts).set({ status: 'ended', endedAt: new Date() }).where(eq(clearanceDiscounts.id, id));
  await logActivity({ shopId, actor: 'merchant', entityType: 'discount', entityId: id, action: 'ended', summary: `Ended clearance code ${row.code}` });
}
