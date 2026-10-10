/**
 * Read models for the dashboard and product views. Kept separate from the
 * write-side services so queries can be tuned without touching business rules.
 */
import { and, asc, desc, eq, gte, inArray, like, or, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  alerts,
  inventorySnapshots,
  products,
  restockPlanItems,
  restockPlans,
  riskScores,
  salesDaily,
  shops,
  suppliers,
  type RiskTier,
} from '../db/schema.js';
import { listActivity } from './activity.js';
import { addDays } from './riskEngine.js';
import { latestScoreByProduct } from './scoring.js';

type ProductRow = typeof products.$inferSelect;

function toProductView(p: ProductRow, score: typeof riskScores.$inferSelect | undefined, supplierName: string | null) {
  return {
    id: p.id,
    title: p.title,
    variantTitle: p.variantTitle,
    sku: p.sku,
    imageUrl: p.imageUrl,
    price: Number(p.price),
    unitCost: p.unitCost === null ? null : Number(p.unitCost),
    available: p.available,
    minOrderQty: p.minOrderQty,
    leadTimeDaysOverride: p.leadTimeDaysOverride,
    isTracked: p.isTracked,
    supplierId: p.supplierId,
    supplierName,
    score: score?.score ?? null,
    tier: (score?.tier ?? null) as RiskTier | null,
    velocity: score ? Number(score.velocity) : null,
    daysOfCover: score?.daysOfCover === null || score?.daysOfCover === undefined ? null : Number(score.daysOfCover),
    incoming: score?.incoming ?? 0,
    recommendedQty: score?.recommendedQty ?? 0,
    orderByDate: score?.orderByDate ?? null,
  };
}

export async function listProducts(shopId: number, filters: { tier?: RiskTier; q?: string; supplierId?: number }) {
  const rows = await db
    .select({ product: products, supplierName: suppliers.name })
    .from(products)
    .leftJoin(suppliers, eq(products.supplierId, suppliers.id))
    .where(
      and(
        eq(products.shopId, shopId),
        filters.supplierId ? eq(products.supplierId, filters.supplierId) : undefined,
        filters.q ? or(like(products.title, `%${filters.q}%`), like(products.sku, `%${filters.q}%`)) : undefined
      )
    );
  const scores = await latestScoreByProduct(shopId);
  return rows
    .map((r) => toProductView(r.product, scores.get(r.product.id), r.supplierName))
    .filter((p) => !filters.tier || p.tier === filters.tier)
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.title.localeCompare(b.title));
}

export async function getProductDetail(shopId: number, productId: number) {
  const row = await db
    .select({ product: products, supplierName: suppliers.name })
    .from(products)
    .leftJoin(suppliers, eq(products.supplierId, suppliers.id))
    .where(and(eq(products.id, productId), eq(products.shopId, shopId)))
    .limit(1);
  if (!row.length) return null;

  const since = addDays(new Date(), -29);
  const [history, sales, snapshots, openAlerts, planLines] = await Promise.all([
    db.select().from(riskScores).where(eq(riskScores.productId, productId)).orderBy(desc(riskScores.id)).limit(30),
    db.select().from(salesDaily).where(and(eq(salesDaily.productId, productId), gte(salesDaily.day, since))).orderBy(asc(salesDaily.day)),
    db.select().from(inventorySnapshots).where(eq(inventorySnapshots.productId, productId)).orderBy(desc(inventorySnapshots.id)).limit(30),
    db.select().from(alerts).where(and(eq(alerts.productId, productId), inArray(alerts.status, ['open', 'acknowledged']))),
    db
      .select({ planId: restockPlans.id, reference: restockPlans.reference, status: restockPlans.status, quantity: restockPlanItems.quantity, expectedAt: restockPlans.expectedAt })
      .from(restockPlanItems)
      .innerJoin(restockPlans, eq(restockPlanItems.planId, restockPlans.id))
      .where(eq(restockPlanItems.productId, productId))
      .orderBy(desc(restockPlans.id))
      .limit(10),
  ]);

  // Dense 30-day series so charts don't skip days without sales.
  const byDay = new Map(sales.map((s) => [s.day, s.units]));
  const salesSeries = Array.from({ length: 30 }, (_, i) => {
    const day = addDays(new Date(), -29 + i);
    return { day, units: byDay.get(day) ?? 0 };
  });

  const latest = history[0];
  return {
    product: toProductView(row[0].product, latest, row[0].supplierName),
    factors: latest?.factors ?? [],
    scoreHistory: history.reverse().map((h) => ({ at: h.computedAt, score: h.score, tier: h.tier })),
    salesSeries,
    isSimulated: sales.some((s) => s.isSimulated),
    stockHistory: snapshots.reverse().map((s) => ({ at: s.capturedAt, available: s.available, source: s.source })),
    alerts: openAlerts,
    plans: planLines,
  };
}

export async function getDashboard(shopId: number) {
  const shop = await db.query.shops.findFirst({ where: eq(shops.id, shopId) });
  const all = await listProducts(shopId, {});
  const tracked = all.filter((p) => p.isTracked);
  const scored = tracked.filter((p) => p.tier !== null);

  const countTier = (tier: RiskTier) => scored.filter((p) => p.tier === tier).length;
  const atRisk = scored.filter((p) => p.tier === 'critical' || p.tier === 'high');

  // Revenue lost per week if at-risk items stock out (velocity × price × 7).
  const weeklyRevenueAtRisk = atRisk.reduce((s, p) => s + (p.velocity ?? 0) * p.price * 7, 0);
  // Capital sitting in stock beyond the overstock horizon.
  const overstockValue = scored
    .filter((p) => p.tier === 'overstock' || p.tier === 'no_demand')
    .reduce((s, p) => {
      const excess = Math.max(0, p.available - (p.velocity ?? 0) * (shop?.overstockDays ?? 120));
      return s + excess * (p.unitCost ?? 0);
    }, 0);
  const reorderNow = atRisk.filter((p) => p.recommendedQty > 0);

  // Sparkline data: last 14 scores for the top risks.
  const top = scored.filter((p) => (p.score ?? 0) > 0).slice(0, 8);
  const trendRows = top.length
    ? await db
        .select({ productId: riskScores.productId, score: riskScores.score, id: riskScores.id })
        .from(riskScores)
        .where(inArray(riskScores.productId, top.map((p) => p.id)))
        .orderBy(desc(riskScores.id))
    : [];
  const trends = new Map<number, number[]>();
  for (const r of trendRows) {
    const list = trends.get(r.productId) ?? [];
    if (list.length < 14) list.unshift(r.score);
    trends.set(r.productId, list);
  }

  const [openAlerts, openPlans, activity, salesDays] = await Promise.all([
    db
      .select({ alert: alerts, productTitle: products.title })
      .from(alerts)
      .innerJoin(products, eq(alerts.productId, products.id))
      .where(and(eq(alerts.shopId, shopId), eq(alerts.status, 'open')))
      .orderBy(sql`FIELD(${alerts.severity}, 'critical', 'warning', 'info')`, desc(alerts.createdAt))
      .limit(8),
    db
      .select({ status: restockPlans.status, n: sql<number>`COUNT(*)` })
      .from(restockPlans)
      .where(and(eq(restockPlans.shopId, shopId), inArray(restockPlans.status, ['draft', 'ordered'])))
      .groupBy(restockPlans.status),
    listActivity(shopId, { limit: 8 }),
    db
      .select({ n: sql<number>`COUNT(*)` })
      .from(salesDaily)
      .innerJoin(products, eq(salesDaily.productId, products.id))
      .where(eq(products.shopId, shopId)),
  ]);

  return {
    shop: { name: shop?.name ?? shop?.domain, currency: shop?.currency ?? 'USD', lastSyncedAt: shop?.lastSyncedAt ?? null },
    setup: { hasProducts: tracked.length > 0, hasSales: Number(salesDays[0]?.n ?? 0) > 0 },
    kpis: {
      tracked: tracked.length,
      critical: countTier('critical'),
      high: countTier('high'),
      watch: countTier('watch'),
      healthy: countTier('healthy'),
      overstock: countTier('overstock') + countTier('no_demand'),
      weeklyRevenueAtRisk: Math.round(weeklyRevenueAtRisk),
      overstockValue: Math.round(overstockValue),
      reorderNowCount: reorderNow.length,
      draftPlans: Number(openPlans.find((p) => p.status === 'draft')?.n ?? 0),
      orderedPlans: Number(openPlans.find((p) => p.status === 'ordered')?.n ?? 0),
    },
    topRisks: top.map((p) => ({ ...p, trend: trends.get(p.id) ?? [] })),
    alerts: openAlerts.map((a) => ({ ...a.alert, productTitle: a.productTitle })),
    activity: activity.items,
  };
}
