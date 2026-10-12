export type RiskTier = 'critical' | 'high' | 'watch' | 'healthy' | 'overstock' | 'no_demand';
export type PlanStatus = 'draft' | 'ordered' | 'received' | 'cancelled';

export interface Settings {
  defaultLeadTimeDays: number;
  safetyStockDays: number;
  reviewPeriodDays: number;
  overstockDays: number;
  shopName: string;
  currency: string;
  devTools: boolean;
}

export interface ProductView {
  id: number;
  title: string;
  variantTitle: string | null;
  sku: string | null;
  imageUrl: string | null;
  price: number;
  unitCost: number | null;
  available: number;
  minOrderQty: number;
  leadTimeDaysOverride: number | null;
  isTracked: boolean;
  supplierId: number | null;
  supplierName: string | null;
  score: number | null;
  tier: RiskTier | null;
  velocity: number | null;
  daysOfCover: number | null;
  incoming: number;
  recommendedQty: number;
  orderByDate: string | null;
}

export interface RiskFactor {
  key: string;
  label: string;
  points: number;
  detail: string;
}

export interface Alert {
  id: number;
  productId: number;
  type: 'stockout_risk' | 'out_of_stock' | 'velocity_spike' | 'overstock';
  severity: 'critical' | 'warning' | 'info';
  status: 'open' | 'acknowledged' | 'resolved';
  message: string;
  createdAt: string;
  productTitle?: string;
}

export interface ActivityEntry {
  id: number;
  actor: 'merchant' | 'system' | 'webhook';
  entityType: 'plan' | 'supplier' | 'product' | 'alert' | 'sync' | 'settings' | 'discount';
  entityId: number | null;
  action: string;
  summary: string;
  changes: Record<string, unknown> | null;
  createdAt: string;
}

export interface ActivityPage {
  items: ActivityEntry[];
  nextCursor: number | null;
}

export interface Dashboard {
  shop: { name: string; currency: string; lastSyncedAt: string | null };
  setup: { hasProducts: boolean; hasSales: boolean };
  kpis: {
    tracked: number;
    critical: number;
    high: number;
    watch: number;
    healthy: number;
    overstock: number;
    weeklyRevenueAtRisk: number;
    overstockValue: number;
    reorderNowCount: number;
    draftPlans: number;
    orderedPlans: number;
  };
  topRisks: (ProductView & { trend: number[] })[];
  alerts: Alert[];
  activity: ActivityEntry[];
}

export interface ProductDetail {
  product: ProductView;
  factors: RiskFactor[];
  scoreHistory: { at: string; score: number; tier: RiskTier }[];
  salesSeries: { day: string; units: number }[];
  isSimulated: boolean;
  stockHistory: { at: string; available: number; source: string }[];
  alerts: Alert[];
  plans: { planId: number; reference: string; status: PlanStatus; quantity: number; expectedAt: string | null }[];
}

export interface ProductPatch {
  supplierId: number | null;
  leadTimeDaysOverride: number | null;
  minOrderQty: number;
  unitCost: number | null;
  isTracked: boolean;
}

export interface Supplier {
  id: number;
  name: string;
  email: string | null;
  leadTimeDays: number;
  notes: string | null;
  productCount?: number;
}

export type SupplierInput = Pick<Supplier, 'name' | 'email' | 'leadTimeDays' | 'notes'>;

export interface PlanSummary {
  id: number;
  reference: string;
  status: PlanStatus;
  supplier: Supplier | null;
  expectedAt: string | null;
  createdAt: string;
  itemCount: number;
  units: number;
  total: number;
}

export interface PlanItem {
  id: number;
  productId: number;
  quantity: number;
  unitCost: number | null;
  suggestedQty: number | null;
  product: { id: number; title: string; variantTitle: string | null; sku: string | null; available: number };
}

export interface PlanDetail extends Omit<PlanSummary, 'itemCount' | 'units'> {
  notes: string | null;
  orderedAt: string | null;
  receivedAt: string | null;
  items: PlanItem[];
  allowedTransitions: PlanStatus[];
}

export interface PlanItemInput {
  productId: number;
  quantity: number;
  unitCost?: number | null;
}

export interface ClearanceDiscount {
  id: number;
  code: string;
  percentOff: number;
  status: 'active' | 'ended';
  shopifyStatus: string | null;
  startsAt: string;
  endsAt: string | null;
  endedAt: string | null;
  uses: number | null;
  revenue: number | null;
  unitsSoldSince: number;
  excessAtStart: number;
  stockCleared: number;
  items: { productId: number; title: string; variantTitle: string | null; imageUrl: string | null; availableAtStart: number; availableNow: number }[];
}

export interface ClearanceSuggestion {
  code: string;
  percentOff: number;
  excessUnits: number;
  excessValue: number;
}
