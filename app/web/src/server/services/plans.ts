/**
 * Restock plans (purchase orders): creation from recommendations, editing,
 * a strict status state machine, receiving stock back into Shopify, CSV export.
 * Every mutation writes an activity_log entry in the same transaction.
 */
import type { Session } from '@shopify/shopify-api';
import { createHash } from 'node:crypto';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { inventorySnapshots, products, restockPlanItems, restockPlans, suppliers, type PlanStatus } from '../db/schema.js';
import { shopify } from '../shopify.js';
import { diff, logActivity } from './activity.js';
import { AppError } from './errors.js';
import { addDays } from './riskEngine.js';
import { latestScoreByProduct, rescoreShop } from './scoring.js';

export class PlanError extends AppError {}

export const TRANSITIONS: Record<PlanStatus, PlanStatus[]> = {
  draft: ['ordered', 'cancelled'],
  ordered: ['received', 'cancelled'],
  received: [],
  cancelled: [],
};

type ItemInput = { productId: number; quantity: number; unitCost?: number | null; suggestedQty?: number | null };

/** Next RR-#### for the shop: highest existing number + 1 (a row count would reuse numbers after deletes). */
async function nextReference(shopId: number, tx: Pick<typeof db, 'select'> = db) {
  const [{ max }] = await tx
    .select({ max: sql<number | null>`MAX(CAST(SUBSTRING(${restockPlans.reference}, 4) AS UNSIGNED))` })
    .from(restockPlans)
    .where(eq(restockPlans.shopId, shopId));
  return `RR-${String(Number(max ?? 0) + 1).padStart(4, '0')}`;
}

async function assertOwnsProducts(shopId: number, productIds: number[]) {
  if (!productIds.length) return;
  const owned = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.shopId, shopId), inArray(products.id, productIds)));
  if (owned.length !== new Set(productIds).size) throw new PlanError('One or more products do not belong to this shop', 404);
}

async function assertOwnsSupplier(shopId: number, supplierId: number | null | undefined) {
  if (!supplierId) return;
  const s = await db.query.suppliers.findFirst({ where: and(eq(suppliers.id, supplierId), eq(suppliers.shopId, shopId)) });
  if (!s) throw new PlanError('Supplier not found', 404);
}

export async function getPlan(shopId: number, planId: number) {
  const plan = await db.query.restockPlans.findFirst({
    where: and(eq(restockPlans.id, planId), eq(restockPlans.shopId, shopId)),
    with: { supplier: true, items: { with: { product: true }, orderBy: asc(restockPlanItems.id) } },
  });
  if (!plan) throw new PlanError('Plan not found', 404);
  const total = plan.items.reduce((sum, i) => sum + i.quantity * Number(i.unitCost ?? 0), 0);
  return { ...plan, total: Math.round(total * 100) / 100, allowedTransitions: TRANSITIONS[plan.status] };
}

export async function listPlans(shopId: number, status?: PlanStatus) {
  const plans = await db.query.restockPlans.findMany({
    where: and(eq(restockPlans.shopId, shopId), status ? eq(restockPlans.status, status) : undefined),
    with: { supplier: true, items: true },
    orderBy: desc(restockPlans.createdAt),
  });
  return plans.map(({ items, ...plan }) => ({
    ...plan,
    itemCount: items.length,
    units: items.reduce((s, i) => s + i.quantity, 0),
    total: Math.round(items.reduce((s, i) => s + i.quantity * Number(i.unitCost ?? 0), 0) * 100) / 100,
  }));
}

export async function createPlan(shopId: number, input: { supplierId?: number | null; notes?: string | null; items: ItemInput[] }) {
  await assertOwnsSupplier(shopId, input.supplierId);
  await assertOwnsProducts(shopId, input.items.map((i) => i.productId));
  const planId = await db.transaction(async (tx) => {
    const reference = await nextReference(shopId, tx);
    const [res] = await tx.insert(restockPlans).values({ shopId, supplierId: input.supplierId ?? null, notes: input.notes ?? null, reference });
    if (input.items.length) {
      await tx.insert(restockPlanItems).values(input.items.map((i) => ({ ...i, planId: res.insertId })));
    }
    await logActivity(
      { shopId, actor: 'merchant', entityType: 'plan', entityId: res.insertId, action: 'created', summary: `Created ${reference} with ${input.items.length} items` },
      tx
    );
    return res.insertId;
  });
  return getPlan(shopId, planId);
}

/**
 * One click from the dashboard: take every product the engine recommends
 * reordering (critical/high/watch), group by supplier, and open one draft
 * plan per supplier with suggested quantities pre-filled.
 */
export async function createPlansFromRecommendations(shopId: number, productIds?: number[]) {
  const scores = await latestScoreByProduct(shopId);
  const candidates = [...scores.values()].filter(
    (s) => s.recommendedQty > 0 && ['critical', 'high', 'watch'].includes(s.tier) && (!productIds || productIds.includes(s.productId))
  );
  if (!candidates.length) return [];

  // Skip products already on an open (draft/ordered) plan to avoid double-ordering.
  const onOpenPlans = new Set(
    (
      await db
        .select({ productId: restockPlanItems.productId })
        .from(restockPlanItems)
        .innerJoin(restockPlans, eq(restockPlanItems.planId, restockPlans.id))
        .where(and(eq(restockPlans.shopId, shopId), inArray(restockPlans.status, ['draft', 'ordered'])))
    ).map((r) => r.productId)
  );
  const fresh = candidates.filter((c) => !onOpenPlans.has(c.productId));
  if (!fresh.length) return [];

  const productRows = await db.select().from(products).where(inArray(products.id, fresh.map((c) => c.productId)));
  const bySupplier = new Map<number | null, ItemInput[]>();
  for (const score of fresh) {
    const product = productRows.find((p) => p.id === score.productId)!;
    const list = bySupplier.get(product.supplierId) ?? [];
    list.push({ productId: product.id, quantity: score.recommendedQty, suggestedQty: score.recommendedQty, unitCost: product.unitCost });
    bySupplier.set(product.supplierId, list);
  }

  const created = [];
  for (const [supplierId, items] of bySupplier) {
    created.push(await createPlan(shopId, { supplierId, items, notes: 'Generated from Restock Radar recommendations' }));
  }
  return created;
}

export async function updatePlan(
  shopId: number,
  planId: number,
  input: { notes?: string | null; expectedAt?: string | null; supplierId?: number | null; items?: ItemInput[] }
) {
  const plan = await getPlan(shopId, planId);
  if (input.items && plan.status !== 'draft') throw new PlanError('Items can only be edited while the plan is a draft', 409);
  await assertOwnsSupplier(shopId, input.supplierId);
  if (input.items) await assertOwnsProducts(shopId, input.items.map((i) => i.productId));

  await db.transaction(async (tx) => {
    const fields = { notes: input.notes, expectedAt: input.expectedAt, supplierId: input.supplierId };
    const changes: Record<string, unknown> = diff(plan as unknown as Record<string, unknown>, fields);
    if (Object.keys(changes).length) {
      await tx.update(restockPlans).set(fields).where(eq(restockPlans.id, planId));
    }
    if (input.items) {
      const before = new Map(plan.items.map((i) => [i.productId, i.quantity]));
      const itemChanges = input.items
        .filter((i) => before.get(i.productId) !== i.quantity)
        .map((i) => ({ productId: i.productId, from: before.get(i.productId) ?? 0, to: i.quantity }));
      const removed = plan.items.filter((i) => !input.items!.some((n) => n.productId === i.productId));
      removed.forEach((i) => itemChanges.push({ productId: i.productId, from: i.quantity, to: 0 }));

      await tx.delete(restockPlanItems).where(eq(restockPlanItems.planId, planId));
      if (input.items.length) {
        const suggested = new Map(plan.items.map((i) => [i.productId, i.suggestedQty]));
        await tx.insert(restockPlanItems).values(
          input.items.map((i) => ({ ...i, planId, suggestedQty: i.suggestedQty ?? suggested.get(i.productId) ?? null }))
        );
      }
      if (itemChanges.length) changes.items = itemChanges;
    }
    if (Object.keys(changes).length) {
      await logActivity(
        { shopId, actor: 'merchant', entityType: 'plan', entityId: planId, action: 'updated', summary: `Updated ${plan.reference}`, changes },
        tx
      );
    }
  });
  return getPlan(shopId, planId);
}

export async function transitionPlan(
  shopId: number,
  planId: number,
  to: PlanStatus,
  opts: { session: Session; updateShopifyInventory?: boolean }
) {
  const plan = await getPlan(shopId, planId);
  if (!TRANSITIONS[plan.status].includes(to)) {
    throw new PlanError(`Cannot move ${plan.reference} from ${plan.status} to ${to}`, 409);
  }
  if (to === 'ordered' && plan.items.length === 0) throw new PlanError('Add at least one item before ordering', 422);

  const now = new Date();
  const set: Partial<typeof restockPlans.$inferInsert> = { status: to };
  if (to === 'ordered') {
    set.orderedAt = now;
    set.expectedAt = plan.expectedAt ?? addDays(now, plan.supplier?.leadTimeDays ?? 14);
  }
  if (to === 'received') set.receivedAt = now;

  let inventoryResult: { pushed: boolean; error?: string } | undefined;
  if (to === 'received' && opts.updateShopifyInventory) {
    inventoryResult = await pushReceiptToShopify(opts.session, plan);
  }

  await db.transaction(async (tx) => {
    await tx.update(restockPlans).set(set).where(eq(restockPlans.id, planId));
    if (to === 'received') {
      for (const item of plan.items) {
        const available = item.product.available + item.quantity;
        await tx.update(products).set({ available }).where(eq(products.id, item.productId));
        await tx.insert(inventorySnapshots).values({ productId: item.productId, available, source: 'receipt' });
      }
    }
    const units = plan.items.reduce((s, i) => s + i.quantity, 0);
    const summaries: Record<string, string> = {
      ordered: `Marked ${plan.reference} as ordered (${units} units, expected ${set.expectedAt})`,
      received: `Received ${plan.reference}: ${units} units${inventoryResult?.pushed ? ' added to Shopify inventory' : ''}`,
      cancelled: `Cancelled ${plan.reference}`,
    };
    await logActivity(
      {
        shopId,
        actor: 'merchant',
        entityType: 'plan',
        entityId: planId,
        action: to,
        summary: summaries[to] ?? `${plan.reference} → ${to}`,
        changes: { status: { from: plan.status, to }, ...(inventoryResult?.error ? { inventoryError: inventoryResult.error } : {}) },
      },
      tx
    );
  });

  // Ordered/received/cancelled all change "incoming" or stock → rescore the affected products.
  await rescoreShop(shopId, plan.items.map((i) => i.productId));
  return { plan: await getPlan(shopId, planId), inventory: inventoryResult };
}

// Since API 2026-04 inventoryAdjustQuantities requires an @idempotent key and a
// compare-and-set `changeFromQuantity` on every change.
const ADJUST_MUTATION = `#graphql
  mutation ReceiveStock($input: InventoryAdjustQuantitiesInput!, $key: String!) {
    inventoryAdjustQuantities(input: $input) @idempotent(key: $key) {
      userErrors { field message }
    }
  }`;

const CURRENT_LEVELS_QUERY = `#graphql
  query CurrentLevels($ids: [ID!]!, $locationId: ID!) {
    nodes(ids: $ids) {
      ... on InventoryItem {
        id
        inventoryLevel(locationId: $locationId) { quantities(names: ["available"]) { quantity } }
      }
    }
  }`;

/**
 * Deterministic UUID-shaped idempotency key. It includes the expected starting
 * quantities, so a duplicate submit of the same receipt is deduplicated by Shopify,
 * while a retry after stock moved (new starting quantities) is a distinct request.
 */
export function receiptIdempotencyKey(shop: string, planId: number, changes: { inventoryItemId: string; changeFromQuantity: number }[]) {
  const fingerprint = changes.map((c) => `${c.inventoryItemId}@${c.changeFromQuantity}`).join(',');
  const hex = createHash('sha256').update(`restock-radar:${shop}:plan:${planId}:receive:${fingerprint}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function pushReceiptToShopify(session: Session, plan: Awaited<ReturnType<typeof getPlan>>) {
  const client = new shopify.api.clients.Graphql({ session });
  try {
    const loc = await client.request<{ locations: { nodes: { id: string }[] } }>(
      `#graphql
      query { locations(first: 1, query: "active:true") { nodes { id } } }`
    );
    const locationId = loc.data?.locations.nodes[0]?.id;
    if (!locationId) return { pushed: false, error: 'No active location found' };

    const lines = plan.items.filter((i) => i.product.inventoryItemId);
    const levels = await client.request<{
      nodes: ({ id: string; inventoryLevel: { quantities: { quantity: number }[] } | null } | null)[];
    }>(CURRENT_LEVELS_QUERY, { variables: { ids: lines.map((i) => i.product.inventoryItemId!), locationId } });
    const current = new Map(
      (levels.data?.nodes ?? []).filter((n) => n?.id).map((n) => [n!.id, n!.inventoryLevel?.quantities[0]?.quantity ?? 0])
    );

    const changes = lines.map((i) => ({
      delta: i.quantity,
      changeFromQuantity: current.get(i.product.inventoryItemId!) ?? 0,
      inventoryItemId: i.product.inventoryItemId!,
      locationId,
    }));
    const res = await client.request<{ inventoryAdjustQuantities: { userErrors: { message: string }[] } }>(ADJUST_MUTATION, {
      variables: {
        input: { reason: 'received', name: 'available', referenceDocumentUri: `restock-radar://plans/${plan.id}`, changes },
        key: receiptIdempotencyKey(session.shop, plan.id, changes),
      },
    });
    const errors = res.data?.inventoryAdjustQuantities.userErrors ?? [];
    return errors.length ? { pushed: false, error: errors.map((e) => e.message).join('; ') } : { pushed: true };
  } catch (err) {
    return { pushed: false, error: (err as Error).message };
  }
}

export function planToCsv(plan: Awaited<ReturnType<typeof getPlan>>) {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['Reference', 'Supplier', 'Product', 'Variant', 'SKU', 'Quantity', 'Unit cost', 'Line total'];
  const lines = plan.items.map((i) =>
    [
      plan.reference,
      plan.supplier?.name ?? '',
      i.product.title,
      i.product.variantTitle ?? '',
      i.product.sku ?? '',
      i.quantity,
      i.unitCost ?? '',
      i.unitCost ? (i.quantity * Number(i.unitCost)).toFixed(2) : '',
    ]
      .map(esc)
      .join(',')
  );
  return [header.map(esc).join(','), ...lines].join('\n');
}
