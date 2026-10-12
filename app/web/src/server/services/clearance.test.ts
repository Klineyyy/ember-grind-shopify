import { describe, expect, it } from 'vitest';
import { CODE_PATTERN, codeStem, excessUnits, suggestForSelection, suggestPercentOff } from './clearance.js';

const overstockDays = 120;
const candidate = (daysOfCover: number | null, velocity: number | null = 1, tier: 'overstock' | 'no_demand' = 'overstock') => ({
  title: 'Decaf Colombia Swiss Water',
  available: 300,
  velocity,
  daysOfCover,
  tier,
});

describe('clearance suggestions', () => {
  it('scales the discount with how deep the overstock is', () => {
    expect(suggestPercentOff(candidate(150), overstockDays)).toBe(10);
    expect(suggestPercentOff(candidate(250), overstockDays)).toBe(20);
    expect(suggestPercentOff(candidate(400), overstockDays)).toBe(30);
  });

  it('goes deepest when nothing is selling', () => {
    expect(suggestPercentOff(candidate(null, 0, 'no_demand'), overstockDays)).toBe(30);
  });

  it('uses the deepest need across a selection and builds a readable code', () => {
    const s = suggestForSelection([candidate(150), candidate(400)], overstockDays);
    expect(s).toEqual({ percentOff: 30, code: 'CLEAR-DECAF-30' });
    expect(CODE_PATTERN.test(s.code)).toBe(true);
  });

  it('falls back to a generic stem for mixed products', () => {
    const s = suggestForSelection([candidate(150), { ...candidate(150), title: 'Sumatra Kerinci' }], overstockDays);
    expect(s.code).toBe('CLEAR-STOCK-10');
  });

  it('strips accents and symbols from code stems', () => {
    expect(codeStem('Brazil Santa Inês')).toBe('BRAZIL');
    expect(codeStem('Costa Rica Tarrazú Honey')).toBe('COSTA');
  });

  it('counts only units beyond the overstock horizon as excess', () => {
    expect(excessUnits(300, 1, 120)).toBe(180);
    expect(excessUnits(50, 1, 120)).toBe(0);
    expect(excessUnits(40, null, 120)).toBe(40);
  });
});
