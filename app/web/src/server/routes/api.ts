/**
 * Authenticated JSON API used by the embedded frontend. Every handler is
 * scoped to `res.locals.shop` (resolved from the verified session token), so
 * one shop can never read or write another shop's rows.
 */
import { and, desc, eq } from 'drizzle-orm';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { db } from '../db/client.js';
import { activityEntityTypes, alerts, planStatuses, products, riskTiers, shops, suppliers } from '../db/schema.js';
import { generateDemoSales } from '../demo/demoSales.js';
import { seedStore } from '../demo/seedStore.js';
import { diff, listActivity, logActivity } from '../services/activity.js';
import { getDashboard, getProductDetail, listProducts } from '../services/insights.js';
import {
  createPlan,
  createPlansFromRecommendations,
  getPlan,
  listPlans,
  PlanError,
  planToCsv,
  transitionPlan,
  updatePlan,
} from '../services/plans.js';
import { rescoreShop } from '../services/scoring.js';
import { ensureShop, type Shop } from '../services/shops.js';
import { syncShop } from '../services/sync.js';
import type { Session } from '@shopify/shopify-api';

export const api = Router();

const ctx = (res: Response) => ({ shop: res.locals.shop as Shop, session: res.locals.shopify.session as Session });
const id = (req: Request) => z.coerce.number().int().positive().parse(req.params.id);

/** Resolve (and lazily create) the shop row for the authenticated session. */
api.use(async (_req, res, next) => {
  res.locals.shop = await ensureShop(res.locals.shopify.session.shop);
  next();
});

/* ---------------- Dashboard & sync ---------------- */

api.get('/dashboard', async (_req, res) => {
  res.json(await getDashboard(ctx(res).shop.id));
});

api.post('/sync', async (_req, res) => {
  const { shop, session } = ctx(res);
  res.json(await syncShop(session, shop.id));
});

api.post('/rescore', async (_req, res) => {
  res.json(await rescoreShop(ctx(res).shop.id));
});

/* ---------------- Products ---------------- */

api.get('/products', async (req, res) => {
  const q = z
    .object({
      tier: z.enum(riskTiers).optional(),
      q: z.string().trim().max(100).optional(),
      supplierId: z.coerce.number().int().positive().optional(),
    })
    .parse(req.query);
  res.json(await listProducts(ctx(res).shop.id, q));
});

api.get('/products/:id', async (req, res) => {
  const detail = await getProductDetail(ctx(res).shop.id, id(req));
  if (!detail) return res.status(404).json({ error: 'Product not found' });
  res.json(detail);
});

const productPatch = z.object({
  supplierId: z.number().int().positive().nullable().optional(),
  leadTimeDaysOverride: z.number().int().min(0).max(365).nullable().optional(),
  minOrderQty: z.number().int().min(1).max(100000).optional(),
  unitCost: z.number().min(0).nullable().optional(),
  isTracked: z.boolean().optional(),
});

api.patch('/products/:id', async (req, res) => {
  const { shop } = ctx(res);
  const productId = id(req);
  const body = productPatch.parse(req.body);
  const product = await db.query.products.findFirst({ where: and(eq(products.id, productId), eq(products.shopId, shop.id)) });
  if (!product) return res.status(404).json({ error: 'Product not found' });
  if (body.supplierId) {
    const supplier = await db.query.suppliers.findFirst({ where: and(eq(suppliers.id, body.supplierId), eq(suppliers.shopId, shop.id)) });
    if (!supplier) return res.status(404).json({ error: 'Supplier not found' });
  }
  const changes = diff(product as unknown as Record<string, unknown>, body);
  if (Object.keys(changes).length) {
    await db.update(products).set(body).where(eq(products.id, productId));
    await logActivity({
      shopId: shop.id,
      actor: 'merchant',
      entityType: 'product',
      entityId: productId,
      action: 'updated',
      summary: `Updated planning settings for ${product.title}${product.variantTitle ? ` (${product.variantTitle})` : ''}`,
      changes,
    });
    await rescoreShop(shop.id, [productId]);
  }
  res.json(await getProductDetail(shop.id, productId));
});

/* ---------------- Suppliers ---------------- */

const supplierBody = z.object({
  name: z.string().trim().min(1).max(255),
  email: z.string().trim().email().max(255).nullable().optional().or(z.literal('').transform(() => null)),
  leadTimeDays: z.number().int().min(0).max(365),
  notes: z.string().max(2000).nullable().optional(),
});

api.get('/suppliers', async (_req, res) => {
  const { shop } = ctx(res);
  const rows = await db.query.suppliers.findMany({
    where: eq(suppliers.shopId, shop.id),
    with: { products: { columns: { id: true } } },
    orderBy: suppliers.name,
  });
  res.json(rows.map(({ products: p, ...s }) => ({ ...s, productCount: p.length })));
});

api.post('/suppliers', async (req, res) => {
  const { shop } = ctx(res);
  const body = supplierBody.parse(req.body);
  const [result] = await db.insert(suppliers).values({ ...body, shopId: shop.id });
  await logActivity({ shopId: shop.id, actor: 'merchant', entityType: 'supplier', entityId: result.insertId, action: 'created', summary: `Added supplier ${body.name}` });
  res.status(201).json(await db.query.suppliers.findFirst({ where: eq(suppliers.id, result.insertId) }));
});

api.patch('/suppliers/:id', async (req, res) => {
  const { shop } = ctx(res);
  const supplierId = id(req);
  const body = supplierBody.partial().parse(req.body);
  const existing = await db.query.suppliers.findFirst({ where: and(eq(suppliers.id, supplierId), eq(suppliers.shopId, shop.id)) });
  if (!existing) return res.status(404).json({ error: 'Supplier not found' });
  const changes = diff(existing as unknown as Record<string, unknown>, body);
  if (Object.keys(changes).length) {
    await db.update(suppliers).set(body).where(eq(suppliers.id, supplierId));
    await logActivity({ shopId: shop.id, actor: 'merchant', entityType: 'supplier', entityId: supplierId, action: 'updated', summary: `Updated supplier ${body.name ?? existing.name}`, changes });
    // Lead time feeds the risk engine.
    if ('leadTimeDays' in changes) await rescoreShop(shop.id);
  }
  res.json(await db.query.suppliers.findFirst({ where: eq(suppliers.id, supplierId) }));
});

api.delete('/suppliers/:id', async (req, res) => {
  const { shop } = ctx(res);
  const supplierId = id(req);
  const existing = await db.query.suppliers.findFirst({ where: and(eq(suppliers.id, supplierId), eq(suppliers.shopId, shop.id)) });
  if (!existing) return res.status(404).json({ error: 'Supplier not found' });
  await db.delete(suppliers).where(eq(suppliers.id, supplierId));
  await logActivity({ shopId: shop.id, actor: 'merchant', entityType: 'supplier', entityId: supplierId, action: 'deleted', summary: `Removed supplier ${existing.name}` });
  res.status(204).end();
});

/* ---------------- Restock plans ---------------- */

const planItem = z.object({
  productId: z.number().int().positive(),
  quantity: z.number().int().min(1).max(1_000_000),
  unitCost: z.number().min(0).nullable().optional(),
});

api.get('/plans', async (req, res) => {
  const { status } = z.object({ status: z.enum(planStatuses).optional() }).parse(req.query);
  res.json(await listPlans(ctx(res).shop.id, status));
});

api.get('/plans/:id', async (req, res) => {
  res.json(await getPlan(ctx(res).shop.id, id(req)));
});

api.get('/plans/:id/csv', async (req, res) => {
  const plan = await getPlan(ctx(res).shop.id, id(req));
  res.type('text/csv').attachment(`${plan.reference}.csv`).send(planToCsv(plan));
});

api.post('/plans', async (req, res) => {
  const body = z
    .object({ supplierId: z.number().int().positive().nullable().optional(), notes: z.string().max(2000).nullable().optional(), items: z.array(planItem).max(500) })
    .parse(req.body);
  res.status(201).json(await createPlan(ctx(res).shop.id, body));
});

api.post('/plans/from-recommendations', async (req, res) => {
  const { productIds } = z.object({ productIds: z.array(z.number().int().positive()).optional() }).parse(req.body ?? {});
  const plans = await createPlansFromRecommendations(ctx(res).shop.id, productIds);
  res.status(201).json({ created: plans.length, plans });
});

api.patch('/plans/:id', async (req, res) => {
  const body = z
    .object({
      notes: z.string().max(2000).nullable().optional(),
      expectedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      supplierId: z.number().int().positive().nullable().optional(),
      items: z.array(planItem).max(500).optional(),
    })
    .parse(req.body);
  res.json(await updatePlan(ctx(res).shop.id, id(req), body));
});

api.post('/plans/:id/transition', async (req, res) => {
  const { shop, session } = ctx(res);
  const body = z.object({ to: z.enum(planStatuses), updateShopifyInventory: z.boolean().optional() }).parse(req.body);
  res.json(await transitionPlan(shop.id, id(req), body.to, { session, updateShopifyInventory: body.updateShopifyInventory }));
});

/* ---------------- Alerts ---------------- */

api.get('/alerts', async (req, res) => {
  const { status } = z.object({ status: z.enum(['open', 'acknowledged', 'resolved']).optional() }).parse(req.query);
  const { shop } = ctx(res);
  const rows = await db
    .select({ alert: alerts, productTitle: products.title, variantTitle: products.variantTitle })
    .from(alerts)
    .innerJoin(products, eq(alerts.productId, products.id))
    .where(and(eq(alerts.shopId, shop.id), status ? eq(alerts.status, status) : undefined))
    .orderBy(desc(alerts.createdAt))
    .limit(200);
  res.json(rows.map((r) => ({ ...r.alert, productTitle: r.productTitle, variantTitle: r.variantTitle })));
});

api.post('/alerts/:id/:action', async (req, res) => {
  const { shop } = ctx(res);
  const action = z.enum(['acknowledge', 'resolve']).parse(req.params.action);
  const alertId = id(req);
  const alert = await db.query.alerts.findFirst({ where: and(eq(alerts.id, alertId), eq(alerts.shopId, shop.id)) });
  if (!alert) return res.status(404).json({ error: 'Alert not found' });
  const status = action === 'acknowledge' ? 'acknowledged' : 'resolved';
  await db.update(alerts).set({ status, resolvedAt: status === 'resolved' ? new Date() : null }).where(eq(alerts.id, alertId));
  await logActivity({ shopId: shop.id, actor: 'merchant', entityType: 'alert', entityId: alertId, action: status, summary: `${status === 'resolved' ? 'Resolved' : 'Acknowledged'}: ${alert.message}` });
  res.json({ ok: true });
});

/* ---------------- Activity ---------------- */

api.get('/activity', async (req, res) => {
  const q = z
    .object({
      entityType: z.enum(activityEntityTypes).optional(),
      entityId: z.coerce.number().int().positive().optional(),
      before: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    })
    .parse(req.query);
  res.json(await listActivity(ctx(res).shop.id, q));
});

/* ---------------- Settings ---------------- */

const settingsBody = z.object({
  defaultLeadTimeDays: z.number().int().min(0).max(365),
  safetyStockDays: z.number().int().min(0).max(180),
  reviewPeriodDays: z.number().int().min(1).max(180),
  overstockDays: z.number().int().min(30).max(730),
});

api.get('/settings', async (_req, res) => {
  const { shop } = ctx(res);
  res.json({
    defaultLeadTimeDays: shop.defaultLeadTimeDays,
    safetyStockDays: shop.safetyStockDays,
    reviewPeriodDays: shop.reviewPeriodDays,
    overstockDays: shop.overstockDays,
    shopName: shop.name ?? shop.domain,
    currency: shop.currency,
    devTools: process.env.NODE_ENV !== 'production',
  });
});

api.patch('/settings', async (req, res) => {
  const { shop } = ctx(res);
  const body = settingsBody.partial().parse(req.body);
  const changes = diff(shop as unknown as Record<string, unknown>, body);
  if (Object.keys(changes).length) {
    await db.update(shops).set(body).where(eq(shops.id, shop.id));
    await logActivity({ shopId: shop.id, actor: 'merchant', entityType: 'settings', action: 'updated', summary: 'Updated planning settings', changes });
    await rescoreShop(shop.id);
  }
  res.json({ ok: true });
});

/* ---------------- Dev tools (demo data) ---------------- */

const devOnly = (_req: Request, res: Response, next: NextFunction) =>
  process.env.NODE_ENV === 'production' ? res.status(404).end() : next();

api.post('/dev/seed-store', devOnly, async (_req, res) => {
  const { shop, session } = ctx(res);
  const log = await seedStore(session);
  // Pull the new catalog in straight away so the dashboard isn't empty.
  const sync = await syncShop(session, shop.id).catch((err: Error) => ({ error: err.message }));
  res.json({ log, sync });
});

api.post('/dev/demo-sales', devOnly, async (_req, res) => {
  res.json(await generateDemoSales(ctx(res).shop.id));
});

api.post('/dev/demo-suppliers', devOnly, async (_req, res) => {
  const { shop } = ctx(res);
  const demo = [
    { name: 'Origin Green Importers', email: 'orders@origingreen.example', leadTimeDays: 21, notes: 'Green coffee importer. Ships from Rotterdam.' },
    { name: 'Highland Direct Trade', email: 'hello@highlanddirect.example', leadTimeDays: 35, notes: 'Direct trade East Africa lots. Container every 5 weeks.' },
    { name: 'BrewWorks Wholesale', email: 'trade@brewworks.example', leadTimeDays: 7, notes: 'Brewing gear distributor.' },
  ];
  for (const s of demo) {
    await db.insert(suppliers).values({ ...s, shopId: shop.id }).onDuplicateKeyUpdate({ set: { leadTimeDays: s.leadTimeDays } });
  }
  const bySupplier = Object.fromEntries(
    (await db.select().from(suppliers).where(eq(suppliers.shopId, shop.id))).map((s) => [s.name, s.id])
  );
  // Assign suppliers by product type/origin so plans group naturally.
  const all = await db.select().from(products).where(eq(products.shopId, shop.id));
  for (const p of all) {
    const isGear = p.sku?.startsWith('EG-GEAR');
    const eastAfrica = /Ethiopia|Kenya|Rwanda/.test(p.title);
    const supplierId = isGear ? bySupplier['BrewWorks Wholesale'] : eastAfrica ? bySupplier['Highland Direct Trade'] : bySupplier['Origin Green Importers'];
    await db.update(products).set({ supplierId, minOrderQty: isGear ? 6 : 10 }).where(eq(products.id, p.id));
  }
  await logActivity({ shopId: shop.id, actor: 'merchant', entityType: 'supplier', action: 'demo_seeded', summary: `Added ${demo.length} demo suppliers and assigned ${all.length} products` });
  await rescoreShop(shop.id);
  res.json({ suppliers: demo.length, assigned: all.length });
});

/* ---------------- Errors ---------------- */

api.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof z.ZodError) return res.status(422).json({ error: 'Validation failed', issues: err.issues });
  if (err instanceof PlanError) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});
