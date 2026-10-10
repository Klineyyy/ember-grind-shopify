import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  decimal,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';

/* -------------------------------------------------------------------------- */
/* Shopify session storage (column types must match DrizzleSessionStorageMySQL) */
/* -------------------------------------------------------------------------- */

export const sessions = mysqlTable('session', {
  id: varchar('id', { length: 255 }).primaryKey(),
  shop: text('shop').notNull(),
  state: text('state').notNull(),
  isOnline: boolean('isOnline').default(false).notNull(),
  scope: text('scope'),
  expires: timestamp('expires', { mode: 'date' }),
  accessToken: text('accessToken').notNull(),
  userId: bigint('userId', { mode: 'number' }),
  firstName: text('firstName'),
  lastName: text('lastName'),
  email: text('email'),
  accountOwner: boolean('accountOwner'),
  locale: text('locale'),
  collaborator: boolean('collaborator'),
  emailVerified: boolean('emailVerified'),
  refreshToken: text('refreshToken'),
  refreshTokenExpires: timestamp('refreshTokenExpires', { mode: 'date' }),
});

/* -------------------------------------------------------------------------- */
/* Tenancy                                                                    */
/* -------------------------------------------------------------------------- */

/** One row per installed store. Planning defaults live here as typed columns. */
export const shops = mysqlTable('shops', {
  id: serial('id').primaryKey(),
  domain: varchar('domain', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }),
  currency: varchar('currency', { length: 3 }).default('USD').notNull(),
  defaultLeadTimeDays: int('default_lead_time_days').default(14).notNull(),
  safetyStockDays: int('safety_stock_days').default(7).notNull(),
  reviewPeriodDays: int('review_period_days').default(14).notNull(),
  overstockDays: int('overstock_days').default(120).notNull(),
  lastSyncedAt: timestamp('last_synced_at'),
  installedAt: timestamp('installed_at').defaultNow().notNull(),
  uninstalledAt: timestamp('uninstalled_at'),
});

/* -------------------------------------------------------------------------- */
/* Catalog & suppliers                                                        */
/* -------------------------------------------------------------------------- */

export const suppliers = mysqlTable(
  'suppliers',
  {
    id: serial('id').primaryKey(),
    shopId: bigint('shop_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    email: varchar('email', { length: 255 }),
    leadTimeDays: int('lead_time_days').default(14).notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
  },
  (t) => [uniqueIndex('suppliers_shop_name_uq').on(t.shopId, t.name)]
);

/**
 * A tracked Shopify variant. Inventory numbers are a cache of Shopify's
 * values (refreshed by sync + inventory webhooks); planning fields (supplier,
 * lead time, MOQ) are owned by this app.
 */
export const products = mysqlTable(
  'products',
  {
    id: serial('id').primaryKey(),
    shopId: bigint('shop_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    shopifyProductId: varchar('shopify_product_id', { length: 64 }).notNull(),
    shopifyVariantId: varchar('shopify_variant_id', { length: 64 }).notNull(),
    inventoryItemId: varchar('inventory_item_id', { length: 64 }),
    title: varchar('title', { length: 255 }).notNull(),
    variantTitle: varchar('variant_title', { length: 255 }),
    sku: varchar('sku', { length: 128 }),
    imageUrl: text('image_url'),
    price: decimal('price', { precision: 10, scale: 2, mode: 'number' }).default(0).notNull(),
    unitCost: decimal('unit_cost', { precision: 10, scale: 2, mode: 'number' }),
    available: int('available').default(0).notNull(),
    supplierId: bigint('supplier_id', { mode: 'number', unsigned: true }).references(() => suppliers.id, {
      onDelete: 'set null',
    }),
    leadTimeDaysOverride: int('lead_time_days_override'),
    minOrderQty: int('min_order_qty').default(1).notNull(),
    isTracked: boolean('is_tracked').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
  },
  (t) => [
    uniqueIndex('products_shop_variant_uq').on(t.shopId, t.shopifyVariantId),
    index('products_inventory_item_idx').on(t.inventoryItemId),
    index('products_supplier_idx').on(t.supplierId),
  ]
);

/** Point-in-time stock levels, written on every sync / inventory webhook. */
export const inventorySnapshots = mysqlTable(
  'inventory_snapshots',
  {
    id: serial('id').primaryKey(),
    productId: bigint('product_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    available: int('available').notNull(),
    source: mysqlEnum('source', ['sync', 'webhook', 'receipt']).notNull(),
    capturedAt: timestamp('captured_at').defaultNow().notNull(),
  },
  (t) => [index('snapshots_product_time_idx').on(t.productId, t.capturedAt)]
);

/** Units sold per variant per day — the input to velocity. */
export const salesDaily = mysqlTable(
  'sales_daily',
  {
    productId: bigint('product_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    day: date('day', { mode: 'string' }).notNull(),
    units: int('units').default(0).notNull(),
    revenue: decimal('revenue', { precision: 12, scale: 2, mode: 'number' }).default(0).notNull(),
    isSimulated: boolean('is_simulated').default(false).notNull(),
  },
  (t) => [primaryKey({ columns: [t.productId, t.day] })]
);

/* -------------------------------------------------------------------------- */
/* Risk scoring & alerts                                                      */
/* -------------------------------------------------------------------------- */

export const riskTiers = ['critical', 'high', 'watch', 'healthy', 'overstock', 'no_demand'] as const;
export type RiskTier = (typeof riskTiers)[number];

/** Append-only score history; the latest row per product is the current score. */
export const riskScores = mysqlTable(
  'risk_scores',
  {
    id: serial('id').primaryKey(),
    shopId: bigint('shop_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    productId: bigint('product_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    score: int('score').notNull(),
    tier: mysqlEnum('tier', riskTiers).notNull(),
    velocity: decimal('velocity', { precision: 10, scale: 3, mode: 'number' }).notNull(),
    daysOfCover: decimal('days_of_cover', { precision: 10, scale: 1, mode: 'number' }),
    incoming: int('incoming').default(0).notNull(),
    recommendedQty: int('recommended_qty').default(0).notNull(),
    orderByDate: date('order_by_date', { mode: 'string' }),
    factors: json('factors').$type<RiskFactor[]>().notNull(),
    computedAt: timestamp('computed_at').defaultNow().notNull(),
  },
  (t) => [
    index('risk_product_time_idx').on(t.productId, t.computedAt),
    index('risk_shop_time_idx').on(t.shopId, t.computedAt),
  ]
);

export type RiskFactor = { key: string; label: string; points: number; detail: string };

export const alertTypes = ['stockout_risk', 'out_of_stock', 'velocity_spike', 'overstock'] as const;
export type AlertType = (typeof alertTypes)[number];

export const alerts = mysqlTable(
  'alerts',
  {
    id: serial('id').primaryKey(),
    shopId: bigint('shop_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    productId: bigint('product_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    type: mysqlEnum('type', alertTypes).notNull(),
    severity: mysqlEnum('severity', ['critical', 'warning', 'info']).notNull(),
    status: mysqlEnum('status', ['open', 'acknowledged', 'resolved']).default('open').notNull(),
    message: varchar('message', { length: 500 }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
    resolvedAt: timestamp('resolved_at'),
  },
  (t) => [
    index('alerts_shop_status_idx').on(t.shopId, t.status),
    index('alerts_product_type_idx').on(t.productId, t.type, t.status),
  ]
);

/* -------------------------------------------------------------------------- */
/* Restock planning                                                           */
/* -------------------------------------------------------------------------- */

export const planStatuses = ['draft', 'ordered', 'received', 'cancelled'] as const;
export type PlanStatus = (typeof planStatuses)[number];

export const restockPlans = mysqlTable(
  'restock_plans',
  {
    id: serial('id').primaryKey(),
    shopId: bigint('shop_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    supplierId: bigint('supplier_id', { mode: 'number', unsigned: true }).references(() => suppliers.id, {
      onDelete: 'set null',
    }),
    reference: varchar('reference', { length: 32 }).notNull(),
    status: mysqlEnum('status', planStatuses).default('draft').notNull(),
    notes: text('notes'),
    expectedAt: date('expected_at', { mode: 'string' }),
    orderedAt: timestamp('ordered_at'),
    receivedAt: timestamp('received_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
  },
  (t) => [
    uniqueIndex('plans_shop_reference_uq').on(t.shopId, t.reference),
    index('plans_shop_status_idx').on(t.shopId, t.status),
  ]
);

export const restockPlanItems = mysqlTable(
  'restock_plan_items',
  {
    id: serial('id').primaryKey(),
    planId: bigint('plan_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => restockPlans.id, { onDelete: 'cascade' }),
    productId: bigint('product_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    quantity: int('quantity').notNull(),
    unitCost: decimal('unit_cost', { precision: 10, scale: 2, mode: 'number' }),
    /** Quantity suggested by the risk engine when the line was created (for "you changed X" insight). */
    suggestedQty: int('suggested_qty'),
  },
  (t) => [uniqueIndex('plan_items_plan_product_uq').on(t.planId, t.productId)]
);

/* -------------------------------------------------------------------------- */
/* Activity log                                                               */
/* -------------------------------------------------------------------------- */

export const activityEntityTypes = ['plan', 'supplier', 'product', 'alert', 'sync', 'settings'] as const;
export type ActivityEntityType = (typeof activityEntityTypes)[number];

export const activityLog = mysqlTable(
  'activity_log',
  {
    id: serial('id').primaryKey(),
    shopId: bigint('shop_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    actor: mysqlEnum('actor', ['merchant', 'system', 'webhook']).notNull(),
    entityType: mysqlEnum('entity_type', activityEntityTypes).notNull(),
    entityId: bigint('entity_id', { mode: 'number', unsigned: true }),
    action: varchar('action', { length: 64 }).notNull(),
    summary: varchar('summary', { length: 500 }).notNull(),
    /** Field-level before/after for updates, or extra context. */
    changes: json('changes').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { fsp: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
  },
  (t) => [
    index('activity_shop_time_idx').on(t.shopId, t.createdAt),
    index('activity_entity_idx').on(t.entityType, t.entityId),
  ]
);

/* -------------------------------------------------------------------------- */
/* Relations (for the relational query API)                                   */
/* -------------------------------------------------------------------------- */

export const shopsRelations = relations(shops, ({ many }) => ({
  suppliers: many(suppliers),
  products: many(products),
  plans: many(restockPlans),
}));

export const suppliersRelations = relations(suppliers, ({ one, many }) => ({
  shop: one(shops, { fields: [suppliers.shopId], references: [shops.id] }),
  products: many(products),
  plans: many(restockPlans),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  shop: one(shops, { fields: [products.shopId], references: [shops.id] }),
  supplier: one(suppliers, { fields: [products.supplierId], references: [suppliers.id] }),
  sales: many(salesDaily),
  scores: many(riskScores),
  snapshots: many(inventorySnapshots),
  alerts: many(alerts),
}));

export const salesDailyRelations = relations(salesDaily, ({ one }) => ({
  product: one(products, { fields: [salesDaily.productId], references: [products.id] }),
}));

export const riskScoresRelations = relations(riskScores, ({ one }) => ({
  product: one(products, { fields: [riskScores.productId], references: [products.id] }),
}));

export const inventorySnapshotsRelations = relations(inventorySnapshots, ({ one }) => ({
  product: one(products, { fields: [inventorySnapshots.productId], references: [products.id] }),
}));

export const alertsRelations = relations(alerts, ({ one }) => ({
  product: one(products, { fields: [alerts.productId], references: [products.id] }),
}));

export const restockPlansRelations = relations(restockPlans, ({ one, many }) => ({
  supplier: one(suppliers, { fields: [restockPlans.supplierId], references: [suppliers.id] }),
  items: many(restockPlanItems),
}));

export const restockPlanItemsRelations = relations(restockPlanItems, ({ one }) => ({
  plan: one(restockPlans, { fields: [restockPlanItems.planId], references: [restockPlans.id] }),
  product: one(products, { fields: [restockPlanItems.productId], references: [products.id] }),
}));
