import type { Session } from '@shopify/shopify-api';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { sessions, shops } from '../db/schema.js';
import { logActivity } from './activity.js';

export type Shop = typeof shops.$inferSelect;

export async function findShopByDomain(domain: string): Promise<Shop | undefined> {
  return db.query.shops.findFirst({ where: eq(shops.domain, domain) });
}

/** Upsert the shop row; returns it. Re-installs clear `uninstalledAt`. */
export async function ensureShop(domain: string): Promise<Shop> {
  await db
    .insert(shops)
    .values({ domain })
    .onDuplicateKeyUpdate({ set: { uninstalledAt: null } });
  return (await findShopByDomain(domain))!;
}

/** Called by the auth library after each successful token exchange. */
export async function onShopAuthenticated(session: Session) {
  const existing = await findShopByDomain(session.shop);
  const shop = await ensureShop(session.shop);
  if (!existing || existing.uninstalledAt) {
    await logActivity({
      shopId: shop.id,
      actor: 'system',
      entityType: 'settings',
      action: 'installed',
      summary: 'Restock Radar installed',
    });
  }
}

export async function markUninstalled(domain: string) {
  await db.delete(sessions).where(eq(sessions.shop, domain));
  await db.update(shops).set({ uninstalledAt: new Date() }).where(eq(shops.domain, domain));
}

/** GDPR shop/redact: remove everything we hold for the shop (cascades to all tables). */
export async function purgeShop(domain: string) {
  await db.delete(sessions).where(eq(sessions.shop, domain));
  await db.delete(shops).where(eq(shops.domain, domain));
}
