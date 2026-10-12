/**
 * Clearance suggestions: how deep a discount to offer on overstocked stock.
 * Pure functions (no I/O) so the rules are easy to test and to explain.
 *
 * The deeper the overstock, the deeper the suggested discount:
 *   no recent sales            → 30%
 *   cover ≥ 3× the threshold   → 30%
 *   cover ≥ 2× the threshold   → 20%
 *   otherwise (just over)      → 10%
 */
import type { RiskTier } from '../db/schema.js';

export interface ClearanceCandidate {
  title: string;
  available: number;
  velocity: number | null;
  daysOfCover: number | null;
  tier: RiskTier | null;
}

/** Units beyond what normal sales would clear within the overstock horizon. */
export function excessUnits(available: number, velocity: number | null, overstockDays: number) {
  return Math.max(0, Math.floor(available - (velocity ?? 0) * overstockDays));
}

export function suggestPercentOff(candidate: ClearanceCandidate, overstockDays: number) {
  if (candidate.tier === 'no_demand' || !candidate.velocity) return 30;
  const ratio = (candidate.daysOfCover ?? 0) / overstockDays;
  if (ratio >= 3) return 30;
  if (ratio >= 2) return 20;
  return 10;
}

/** For several variants, suggest the deepest discount any of them needs. */
export function suggestForSelection(candidates: ClearanceCandidate[], overstockDays: number) {
  if (!candidates.length) return { percentOff: 10, code: 'CLEAR-10' };
  const percentOff = Math.max(...candidates.map((c) => suggestPercentOff(c, overstockDays)));
  const titles = [...new Set(candidates.map((c) => c.title))];
  const stem = titles.length === 1 ? codeStem(titles[0]) : 'STOCK';
  return { percentOff, code: `CLEAR-${stem}-${percentOff}` };
}

/** "Decaf Colombia Swiss Water" → "DECAF"; strips accents and symbols. */
export function codeStem(title: string) {
  return (
    title
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .split(/[^A-Z0-9]+/)
      .filter(Boolean)[0]
      ?.slice(0, 12) ?? 'STOCK'
  );
}

/** Shopify codes are case-insensitive; we store them upper-case with A–Z, 0–9, - and _. */
export const CODE_PATTERN = /^[A-Z0-9_-]{3,32}$/;
