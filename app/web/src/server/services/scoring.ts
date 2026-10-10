/**
 * DB-facing side of the risk engine: gathers inputs, persists score history
 * and keeps alerts in sync (open / escalate / auto-resolve).
 */
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  alerts,
  products,
  restockPlanItems,
  restockPlans,
  riskScores,
  salesDaily,
  shops,
  suppliers,
  type AlertType,
} from '../db/schema.js';
import { logActivity } from './activity.js';
import { addDays, revenuePercentiles, scoreProduct, type RiskResult } from './riskEngine.js';

const WINDOW_DAYS = 30;

type Severity = (typeof alerts.$inferInsert)['severity'];

export async function rescoreShop(shopId: number, onlyProductIds?: number[]) {
  const shop = await db.query.shops.findFirst({ where: eq(shops.id, shopId) });
  if (!shop) throw new Error(`Shop ${shopId} not found`);

  const today = new Date();
  const since = addDays(today, -WINDOW_DAYS + 1);

  const rows = await db
    .select({ product: products, supplierLead: suppliers.leadTimeDays })
    .from(products)
    .leftJoin(suppliers, eq(products.supplierId, suppliers.id))
    .where(and(eq(products.shopId, shopId), eq(products.isTracked, true)));
  if (rows.length === 0) return { scored: 0 };

  const allIds = rows.map((r) => r.product.id);
  const sales = await db
    .select()
    .from(salesDaily)
    .where(and(inArray(salesDaily.productId, allIds), gte(salesDaily.day, since)));

  // Dense per-product day arrays (oldest → newest) + 30-day revenue for ranking.
  const dayIndex = new Map<string, number>();
  for (let i = 0; i < WINDOW_DAYS; i++) dayIndex.set(addDays(today, -WINDOW_DAYS + 1 + i), i);
  const series = new Map<number, number[]>(allIds.map((id) => [id, new Array(WINDOW_DAYS).fill(0)]));
  const revenue = new Map<number, number>(allIds.map((id) => [id, 0]));
  for (const s of sales) {
    const idx = dayIndex.get(s.day);
    if (idx !== undefined) series.get(s.productId)![idx] += s.units;
    revenue.set(s.productId, (revenue.get(s.productId) ?? 0) + Number(s.revenue));
  }
  const percentiles = revenuePercentiles(revenue);

  // Units already on order (placed but not received) count toward cover.
  const incomingRows = await db
    .select({ productId: restockPlanItems.productId, qty: sql<number>`SUM(${restockPlanItems.quantity})` })
    .from(restockPlanItems)
    .innerJoin(restockPlans, eq(restockPlanItems.planId, restockPlans.id))
    .where(and(eq(restockPlans.shopId, shopId), eq(restockPlans.status, 'ordered')))
    .groupBy(restockPlanItems.productId);
  const incoming = new Map(incomingRows.map((r) => [r.productId, Number(r.qty)]));

  const targets = onlyProductIds ? rows.filter((r) => onlyProductIds.includes(r.product.id)) : rows;
  const latest = await latestScoreByProduct(shopId);
  const results: { productId: number; result: RiskResult }[] = [];

  for (const { product, supplierLead } of targets) {
    const result = scoreProduct({
      available: product.available,
      incoming: incoming.get(product.id) ?? 0,
      dailySales: series.get(product.id)!,
      leadTimeDays: product.leadTimeDaysOverride ?? supplierLead ?? shop.defaultLeadTimeDays,
      safetyStockDays: shop.safetyStockDays,
      reviewPeriodDays: shop.reviewPeriodDays,
      overstockDays: shop.overstockDays,
      minOrderQty: product.minOrderQty,
      unitCost: product.unitCost,
      revenuePercentile: percentiles.get(product.id) ?? 0,
      today,
    });
    results.push({ productId: product.id, result });

    // History: append when something meaningful changed, or at most daily otherwise.
    const prev = latest.get(product.id);
    const changed =
      !prev ||
      prev.score !== result.score ||
      prev.tier !== result.tier ||
      prev.recommendedQty !== result.recommendedQty ||
      Date.now() - prev.computedAt.getTime() > 24 * 3600 * 1000;
    if (changed) {
      await db.insert(riskScores).values({
        shopId,
        productId: product.id,
        score: result.score,
        tier: result.tier,
        velocity: result.velocity,
        daysOfCover: result.daysOfCover,
        incoming: incoming.get(product.id) ?? 0,
        recommendedQty: result.recommendedQty,
        orderByDate: result.orderByDate,
        factors: result.factors,
      });
    }

    await syncAlerts(shopId, product.id, product.title, product.available, result);
  }

  return { scored: results.length };
}

/** Latest score row per product: rows whose id is the MAX(id) of their product. */
export async function latestScoreByProduct(shopId: number) {
  const latestIds = db
    .select({ id: sql<number>`MAX(${riskScores.id})` })
    .from(riskScores)
    .where(eq(riskScores.shopId, shopId))
    .groupBy(riskScores.productId);
  const rows = await db.select().from(riskScores).where(inArray(riskScores.id, latestIds));
  return new Map(rows.map((r) => [r.productId, r]));
}

/**
 * Alert rules. One open alert per (product, type): new conditions open one,
 * worsening conditions escalate it, and cleared conditions auto-resolve it.
 */
async function syncAlerts(shopId: number, productId: number, title: string, available: number, r: RiskResult) {
  const wanted = new Map<AlertType, { severity: Severity; message: string }>();

  if (available <= 0 && r.velocity > 0) {
    wanted.set('out_of_stock', { severity: 'critical', message: `${title} is out of stock and losing ~${r.velocity.toFixed(1)} sales/day.` });
  } else if (r.tier === 'critical' || r.tier === 'high') {
    wanted.set('stockout_risk', {
      severity: r.tier === 'critical' ? 'critical' : 'warning',
      message: `${title} runs out around ${r.stockoutDate} (${r.daysOfCover} days of cover). Reorder ~${r.recommendedQty} units.`,
    });
  }
  if (r.isSpike) {
    wanted.set('velocity_spike', { severity: 'info', message: `${title} is selling ${(r.velocity7 / Math.max(r.velocity30, 0.01)).toFixed(1)}× faster this week.` });
  }
  if (r.tier === 'overstock') {
    wanted.set('overstock', { severity: 'info', message: `${title} has ${r.overstockUnits} units beyond ${r.daysOfCover} days of cover.` });
  }

  const open = await db
    .select()
    .from(alerts)
    .where(and(eq(alerts.productId, productId), inArray(alerts.status, ['open', 'acknowledged'])));

  for (const existing of open) {
    const next = wanted.get(existing.type);
    if (!next) {
      await db.update(alerts).set({ status: 'resolved', resolvedAt: new Date() }).where(eq(alerts.id, existing.id));
      await logActivity({ shopId, actor: 'system', entityType: 'alert', entityId: existing.id, action: 'auto_resolved', summary: `Resolved: ${existing.message}` });
    } else {
      const escalated = existing.severity !== 'critical' && next.severity === 'critical';
      await db
        .update(alerts)
        .set({ severity: next.severity, message: next.message, ...(escalated ? { status: 'open' as const } : {}) })
        .where(eq(alerts.id, existing.id));
      if (escalated) {
        await logActivity({ shopId, actor: 'system', entityType: 'alert', entityId: existing.id, action: 'escalated', summary: `Escalated to critical: ${next.message}` });
      }
      wanted.delete(existing.type);
    }
  }

  for (const [type, { severity, message }] of wanted) {
    const [res] = await db.insert(alerts).values({ shopId, productId, type, severity, message });
    await logActivity({ shopId, actor: 'system', entityType: 'alert', entityId: res.insertId, action: 'opened', summary: message });
  }
}
