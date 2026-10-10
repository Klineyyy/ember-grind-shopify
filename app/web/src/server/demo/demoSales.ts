/**
 * Generates 60 days of plausible sales history for every tracked product.
 * A fresh dev store has no orders, so without this the risk engine has
 * nothing to score. Rows are flagged `is_simulated` and never overwrite real
 * order data (see the ON DUPLICATE KEY clause).
 */
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { products, salesDaily } from '../db/schema.js';
import { logActivity } from '../services/activity.js';
import { addDays } from '../services/riskEngine.js';
import { rescoreShop } from '../services/scoring.js';
import { demandProfileFor } from './catalog.js';

const DAYS = 60;

/** Small deterministic PRNG so the same product always gets the same history. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Poisson sample (Knuth) — realistic integer unit counts around a mean. */
function poisson(mean: number, rand: () => number) {
  if (mean <= 0) return 0;
  const limit = Math.exp(-mean);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rand();
  } while (p > limit);
  return k - 1;
}

export async function generateDemoSales(shopId: number) {
  const rows = await db.select().from(products).where(eq(products.shopId, shopId));
  const today = new Date();
  const values: (typeof salesDaily.$inferInsert)[] = [];

  for (const product of rows) {
    const rand = mulberry32(product.id * 7919);
    const profile = demandProfileFor(product.title, product.variantTitle) ?? { demand: 0.2 + rand() * 1.5, spike: 1 };
    for (let i = DAYS - 1; i >= 0; i--) {
      const date = new Date(today);
      date.setUTCDate(date.getUTCDate() - i);
      const weekday = date.getUTCDay();
      const weekendBoost = weekday === 0 || weekday === 6 ? 1.25 : 0.95;
      const spike = i < 7 ? profile.spike : 1;
      const units = poisson(profile.demand * weekendBoost * spike, rand);
      if (units > 0) {
        values.push({
          productId: product.id,
          day: addDays(date, 0),
          units,
          revenue: Math.round(units * Number(product.price) * 100) / 100,
          isSimulated: true,
        });
      }
    }
  }

  for (let i = 0; i < values.length; i += 500) {
    await db
      .insert(salesDaily)
      .values(values.slice(i, i + 500))
      .onDuplicateKeyUpdate({
        // Only replace rows that are themselves simulated; real orders win.
        set: {
          units: sql`IF(${salesDaily.isSimulated}, VALUES(units), ${salesDaily.units})`,
          revenue: sql`IF(${salesDaily.isSimulated}, VALUES(revenue), ${salesDaily.revenue})`,
        },
      });
  }

  await rescoreShop(shopId);
  await logActivity({
    shopId,
    actor: 'merchant',
    entityType: 'sync',
    action: 'demo_sales',
    summary: `Generated ${DAYS} days of simulated sales for ${rows.length} products`,
  });
  return { products: rows.length, rows: values.length };
}
