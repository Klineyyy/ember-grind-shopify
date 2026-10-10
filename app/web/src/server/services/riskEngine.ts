/**
 * Restock Radar risk engine.
 *
 * Pure functions only (no DB, no clock unless passed in) so the scoring rules
 * are easy to unit test and to explain to merchants. Every point added to a
 * score is recorded as a `factor` and shown in the UI ("why is this at risk?").
 *
 * Score (0–100) =
 *   cover risk    up to 70  how far stock cover falls short of lead time + safety stock
 * + trend risk    up to 15  last 7 days selling faster than the 30-day average
 * + revenue weight up to 15 top sellers (by revenue rank) matter more
 */
import type { RiskFactor, RiskTier } from '../db/schema.js';

export interface RiskInput {
  available: number;
  /** Units on open purchase orders expected to land within the lead time. */
  incoming: number;
  /** Units sold per day, oldest first. Up to 30 entries are used. */
  dailySales: number[];
  leadTimeDays: number;
  safetyStockDays: number;
  reviewPeriodDays: number;
  overstockDays: number;
  minOrderQty: number;
  unitCost: number | null;
  /** 0 = lowest revenue in the shop, 1 = highest. */
  revenuePercentile: number;
  today?: Date;
}

export interface RiskResult {
  score: number;
  tier: RiskTier;
  velocity: number;
  velocity7: number;
  velocity30: number;
  daysOfCover: number | null;
  recommendedQty: number;
  /** Last day to place an order and still avoid dipping into safety stock. */
  orderByDate: string | null;
  stockoutDate: string | null;
  overstockUnits: number;
  overstockValue: number;
  isSpike: boolean;
  factors: RiskFactor[];
}

export const WEIGHTS = { cover: 70, trend: 15, revenue: 15 } as const;
export const TIER_THRESHOLDS = { critical: 80, high: 60, watch: 35 } as const;
export const SPIKE_RATIO = 1.5;

const round = (n: number, dp = 0) => Math.round(n * 10 ** dp) / 10 ** dp;
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function addDays(date: Date, days: number): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + Math.floor(days));
  return d.toISOString().slice(0, 10);
}

/**
 * Blended daily velocity: 60% last-7-day average, 40% last-30-day average.
 * Reacts to recent spikes without being whipsawed by a single big day.
 */
export function computeVelocity(dailySales: number[]) {
  const last30 = dailySales.slice(-30);
  const last7 = dailySales.slice(-7);
  const velocity30 = last30.length ? sum(last30) / 30 : 0;
  const velocity7 = last7.length ? sum(last7) / 7 : 0;
  return { velocity7, velocity30, velocity: 0.6 * velocity7 + 0.4 * velocity30 };
}

export function tierFor(score: number): RiskTier {
  if (score >= TIER_THRESHOLDS.critical) return 'critical';
  if (score >= TIER_THRESHOLDS.high) return 'high';
  if (score >= TIER_THRESHOLDS.watch) return 'watch';
  return 'healthy';
}

/** Round a positive quantity up to the supplier's minimum order multiple. */
export function roundToMoq(qty: number, moq: number): number {
  if (qty <= 0) return 0;
  const step = Math.max(1, moq);
  return Math.ceil(qty / step) * step;
}

export function scoreProduct(input: RiskInput): RiskResult {
  const today = input.today ?? new Date();
  const { velocity, velocity7, velocity30 } = computeVelocity(input.dailySales);
  const stock = Math.max(0, input.available) + Math.max(0, input.incoming);
  const coverTarget = input.leadTimeDays + input.safetyStockDays;
  const factors: RiskFactor[] = [];

  // Reorder quantity: enough to cover lead time + review period + safety stock.
  const horizon = input.leadTimeDays + input.reviewPeriodDays + input.safetyStockDays;
  const recommendedQty = roundToMoq(Math.ceil(velocity * horizon - stock), input.minOrderQty);

  // No demand: nothing to protect. Still flag dead stock if units are sitting idle.
  if (velocity <= 0) {
    const overstockUnits = Math.max(0, input.available);
    return {
      score: 0,
      tier: overstockUnits > 0 ? 'no_demand' : 'healthy',
      velocity: 0,
      velocity7,
      velocity30,
      daysOfCover: null,
      recommendedQty: 0,
      orderByDate: null,
      stockoutDate: null,
      overstockUnits,
      overstockValue: round(overstockUnits * (input.unitCost ?? 0), 2),
      isSpike: false,
      factors: [{ key: 'no_demand', label: 'No recent sales', points: 0, detail: 'No units sold in the last 30 days.' }],
    };
  }

  const daysOfCover = stock / velocity;
  const stockoutDate = addDays(today, daysOfCover);
  const orderByDate = addDays(today, daysOfCover - coverTarget);

  // 1) Cover risk: 0 pts at ≥150% of target cover, full 70 pts at ≤50%.
  const coverRatio = daysOfCover / coverTarget;
  const coverPoints = input.available <= 0 && input.incoming <= 0 ? WEIGHTS.cover : WEIGHTS.cover * clamp((1.5 - coverRatio) / 1, 0, 1);
  factors.push({
    key: 'cover',
    label: 'Stock cover',
    points: round(coverPoints),
    detail:
      input.available <= 0
        ? 'Out of stock with active demand.'
        : `${round(daysOfCover, 1)} days of stock vs ${coverTarget} needed (lead time ${input.leadTimeDays}d + safety ${input.safetyStockDays}d).`,
  });

  // 2) Trend risk: velocity7 / velocity30 from 1.0 → 1.5 maps to 0 → 15 pts.
  const spikeRatio = velocity30 > 0 ? velocity7 / velocity30 : velocity7 > 0 ? SPIKE_RATIO : 1;
  const trendPoints = WEIGHTS.trend * clamp((spikeRatio - 1) / (SPIKE_RATIO - 1), 0, 1);
  const isSpike = spikeRatio >= SPIKE_RATIO && velocity7 >= 1;
  factors.push({
    key: 'trend',
    label: 'Sales trend',
    points: round(trendPoints),
    detail:
      spikeRatio > 1.05
        ? `Selling ${round((spikeRatio - 1) * 100)}% faster this week than the 30-day average.`
        : 'Demand is steady or slowing.',
  });

  // 3) Revenue weight: losing a best-seller hurts more. Only applies when cover is actually at risk.
  const revenuePoints = coverPoints > 0 ? WEIGHTS.revenue * clamp(input.revenuePercentile, 0, 1) : 0;
  factors.push({
    key: 'revenue',
    label: 'Revenue impact',
    points: round(revenuePoints),
    detail: `Top ${Math.max(1, round((1 - input.revenuePercentile) * 100))}% of products by revenue.`,
  });

  if (input.incoming > 0) {
    factors.push({
      key: 'incoming',
      label: 'Incoming stock',
      points: 0,
      detail: `${input.incoming} units on order are already counted in cover.`,
    });
  }

  const score = Math.round(clamp(coverPoints + trendPoints + revenuePoints, 0, 100));

  const overstockUnits = Math.max(0, Math.floor(input.available - velocity * input.overstockDays));
  const isOverstock = daysOfCover > input.overstockDays && overstockUnits > 0;

  return {
    score,
    tier: isOverstock && score < TIER_THRESHOLDS.watch ? 'overstock' : tierFor(score),
    velocity: round(velocity, 3),
    velocity7: round(velocity7, 3),
    velocity30: round(velocity30, 3),
    daysOfCover: round(daysOfCover, 1),
    recommendedQty,
    orderByDate,
    stockoutDate,
    overstockUnits: isOverstock ? overstockUnits : 0,
    overstockValue: isOverstock ? round(overstockUnits * (input.unitCost ?? 0), 2) : 0,
    isSpike,
    factors,
  };
}

/**
 * Revenue percentile per product within a shop (ties share a rank).
 * Input: map of productId → revenue over the window.
 */
export function revenuePercentiles(revenueByProduct: Map<number, number>): Map<number, number> {
  const entries = [...revenueByProduct.entries()].sort((a, b) => a[1] - b[1]);
  const result = new Map<number, number>();
  if (entries.length <= 1) {
    entries.forEach(([id, revenue]) => result.set(id, revenue > 0 ? 1 : 0));
    return result;
  }
  for (const [id, revenue] of entries) {
    const rank = entries.findIndex(([, r]) => r === revenue); // first index → ties share a rank
    result.set(id, revenue > 0 ? rank / (entries.length - 1) : 0);
  }
  return result;
}
