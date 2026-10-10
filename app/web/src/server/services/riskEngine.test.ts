import { describe, expect, it } from 'vitest';
import { computeVelocity, revenuePercentiles, roundToMoq, scoreProduct, tierFor, type RiskInput } from './riskEngine.js';

const today = new Date('2026-10-06T12:00:00Z');
const flat = (perDay: number, days = 30) => Array.from({ length: days }, () => perDay);

const base: RiskInput = {
  available: 100,
  incoming: 0,
  dailySales: flat(2),
  leadTimeDays: 14,
  safetyStockDays: 7,
  reviewPeriodDays: 14,
  overstockDays: 120,
  minOrderQty: 1,
  unitCost: 5,
  revenuePercentile: 0.5,
  today,
};

describe('computeVelocity', () => {
  it('blends 7 and 30 day averages 60/40', () => {
    const sales = [...flat(1, 23), ...flat(4, 7)];
    const v = computeVelocity(sales);
    expect(v.velocity7).toBe(4);
    expect(v.velocity30).toBeCloseTo((23 + 28) / 30);
    expect(v.velocity).toBeCloseTo(0.6 * 4 + 0.4 * (51 / 30));
  });

  it('treats missing history as zero sales', () => {
    expect(computeVelocity([]).velocity).toBe(0);
  });
});

describe('scoreProduct', () => {
  it('is healthy with plenty of cover', () => {
    const r = scoreProduct({ ...base, available: 100 }); // 50 days vs 21 needed
    expect(r.tier).toBe('healthy');
    expect(r.score).toBe(0);
    expect(r.daysOfCover).toBe(50);
  });

  it('is critical when cover is well below lead time + safety stock', () => {
    const r = scoreProduct({ ...base, available: 10, revenuePercentile: 1 }); // 5 days of cover
    expect(r.tier).toBe('critical');
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(r.stockoutDate).toBe('2026-10-11');
    // order-by date is in the past → the merchant is already late
    expect(r.orderByDate! < '2026-10-06').toBe(true);
  });

  it('scores out-of-stock with demand at full cover risk', () => {
    const r = scoreProduct({ ...base, available: 0 });
    expect(r.factors.find((f) => f.key === 'cover')!.points).toBe(70);
  });

  it('counts incoming purchase orders as cover', () => {
    const without = scoreProduct({ ...base, available: 10 });
    const withPo = scoreProduct({ ...base, available: 10, incoming: 90 });
    expect(withPo.score).toBeLessThan(without.score);
    expect(withPo.factors.some((f) => f.key === 'incoming')).toBe(true);
  });

  it('adds trend points and flags a spike when this week outpaces the month', () => {
    const spiking = scoreProduct({ ...base, available: 60, dailySales: [...flat(1, 23), ...flat(5, 7)] });
    const trend = spiking.factors.find((f) => f.key === 'trend')!;
    expect(trend.points).toBeGreaterThan(0);
    expect(spiking.isSpike).toBe(true);
  });

  it('weights best-sellers higher only when cover is at risk', () => {
    const low = scoreProduct({ ...base, available: 30, revenuePercentile: 0 });
    const high = scoreProduct({ ...base, available: 30, revenuePercentile: 1 });
    expect(high.score - low.score).toBe(15);
    const safe = scoreProduct({ ...base, available: 500, revenuePercentile: 1 });
    expect(safe.factors.find((f) => f.key === 'revenue')!.points).toBe(0);
  });

  it('recommends enough to cover lead + review + safety, rounded to MOQ', () => {
    // velocity 2/day * 35 days = 70 needed, minus 10 on hand = 60 → MOQ 25 → 75
    const r = scoreProduct({ ...base, available: 10, minOrderQty: 25 });
    expect(r.recommendedQty).toBe(75);
  });

  it('detects overstock and the capital tied up in it', () => {
    const r = scoreProduct({ ...base, available: 400, dailySales: flat(1), unitCost: 6 });
    expect(r.tier).toBe('overstock');
    expect(r.overstockUnits).toBe(280); // 400 - 1/day * 120 days
    expect(r.overstockValue).toBe(1680);
  });

  it('marks products with stock but no sales as no_demand', () => {
    const r = scoreProduct({ ...base, dailySales: flat(0) });
    expect(r.tier).toBe('no_demand');
    expect(r.score).toBe(0);
    expect(r.recommendedQty).toBe(0);
  });
});

describe('helpers', () => {
  it('maps scores to tiers', () => {
    expect(tierFor(95)).toBe('critical');
    expect(tierFor(60)).toBe('high');
    expect(tierFor(35)).toBe('watch');
    expect(tierFor(10)).toBe('healthy');
  });

  it('rounds up to MOQ multiples', () => {
    expect(roundToMoq(0, 12)).toBe(0);
    expect(roundToMoq(1, 12)).toBe(12);
    expect(roundToMoq(13, 12)).toBe(24);
  });

  it('ranks revenue into percentiles with ties sharing a rank', () => {
    const p = revenuePercentiles(new Map([[1, 0], [2, 50], [3, 50], [4, 200]]));
    expect(p.get(1)).toBe(0);
    expect(p.get(2)).toBeCloseTo(1 / 3);
    expect(p.get(3)).toBeCloseTo(1 / 3);
    expect(p.get(4)).toBe(1);
  });
});
