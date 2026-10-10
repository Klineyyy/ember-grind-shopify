import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useGeneratePlans, useProduct, useSuppliers, useUpdateProduct } from '../api';
import {
  AppLink,
  ErrorBanner,
  LoadingPage,
  OrderBy,
  SalesChart,
  ScoreBar,
  Sparkline,
  TIER_META,
  TierBadge,
  formatDate,
  useMoney,
  variantLabel,
} from '../components/ui';
import type { ProductPatch } from '../types';

const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v));

export function ProductDetailPage() {
  const id = Number(useParams().id);
  const { data, isLoading, error } = useProduct(id);
  const { data: suppliers } = useSuppliers();
  const update = useUpdateProduct(id);
  const generate = useGeneratePlans();
  const navigate = useNavigate();
  const money = useMoney();
  const [form, setForm] = useState<ProductPatch | null>(null);

  useEffect(() => {
    if (data) {
      const p = data.product;
      setForm({ supplierId: p.supplierId, leadTimeDaysOverride: p.leadTimeDaysOverride, minOrderQty: p.minOrderQty, unitCost: p.unitCost, isTracked: p.isTracked });
    }
  }, [data]);

  if (isLoading) return <LoadingPage heading="Product" />;
  if (error || !data || !form) return <s-page heading="Product"><ErrorBanner error={error} /></s-page>;

  const { product: p, factors } = data;
  const dirty =
    form.supplierId !== p.supplierId ||
    form.leadTimeDaysOverride !== p.leadTimeDaysOverride ||
    form.minOrderQty !== p.minOrderQty ||
    form.unitCost !== p.unitCost ||
    form.isTracked !== p.isTracked;
  const onOpenPlan = data.plans.some((pl) => pl.status === 'draft' || pl.status === 'ordered');

  return (
    <s-page heading={variantLabel(p)}>
      <s-link slot="breadcrumb-actions" href="/products">Products</s-link>
      <s-button
        slot="primary-action"
        variant="primary"
        disabled={!p.recommendedQty || onOpenPlan}
        loading={generate.isPending}
        onClick={() => generate.mutate([p.id], { onSuccess: (r) => r.plans[0] && navigate(`/plans/${r.plans[0].id}`) })}
      >
        {onOpenPlan ? 'Already on an open plan' : `Reorder ${p.recommendedQty || ''}`}
      </s-button>

      {data.alerts.map((a) => (
        <s-banner key={a.id} tone={a.severity === 'critical' ? 'critical' : a.severity === 'warning' ? 'warning' : 'info'}>
          {a.message}
        </s-banner>
      ))}

      <s-grid gridTemplateColumns="@container (inline-size > 800px) 2fr 1fr, 1fr" gap="base">
        <s-stack gap="base">
          <s-section heading="Why this score">
            <s-stack gap="base">
              <s-stack direction="inline" gap="base" alignItems="center">
                <TierBadge tier={p.tier} />
                <ScoreBar score={p.score} tier={p.tier} />
              </s-stack>
              <div>
                {factors.map((f) => (
                  <div className="factor" key={f.key}>
                    <s-text type="strong">{f.label}</s-text>
                    <span className="factor__points">+{f.points}</span>
                    <span className="factor__detail">{f.detail}</span>
                  </div>
                ))}
                {factors.length === 0 && <s-text color="subdued">Not scored yet — sync or generate sales data first.</s-text>}
              </div>
            </s-stack>
          </s-section>

          <s-section heading="Units sold, last 30 days">
            {data.isSimulated && <s-badge slot="secondary-actions" tone="info">Includes demo data</s-badge>}
            <SalesChart series={data.salesSeries} />
            <s-text color="subdued">Darker bars are the last 7 days, which carry 60% of the velocity weight.</s-text>
          </s-section>

          <s-section heading="Risk score history">
            <Sparkline values={data.scoreHistory.map((h) => h.score)} width={600} height={60} color={p.tier ? TIER_META[p.tier].color : undefined} />
          </s-section>
        </s-stack>

        <s-stack gap="base">
          <s-section heading="Stock position">
            <s-stack gap="small">
              <Row label="Available" value={p.available} />
              <Row label="On order" value={p.incoming} />
              <Row label="Sells per day" value={p.velocity?.toFixed(2) ?? '—'} />
              <Row label="Days of cover" value={p.daysOfCover ?? '—'} />
              <Row label="Order by" value={<OrderBy date={p.orderByDate} />} />
              <Row label="Suggested reorder" value={p.recommendedQty || '—'} />
              <Row label="Price / cost" value={`${money(p.price, true)} / ${money(p.unitCost, true)}`} />
            </s-stack>
          </s-section>

          <s-section heading="Planning settings">
            <s-stack gap="base">
              <s-select
                label="Supplier"
                value={form.supplierId ? String(form.supplierId) : ''}
                onChange={(e: Event) => setForm({ ...form, supplierId: numOrNull((e.currentTarget as HTMLSelectElement).value) })}
              >
                <s-option value="">No supplier</s-option>
                {(suppliers ?? []).map((s) => (
                  <s-option key={s.id} value={String(s.id)}>{`${s.name} (${s.leadTimeDays}d)`}</s-option>
                ))}
              </s-select>
              <s-number-field
                label="Lead time override (days)"
                details="Leave blank to use the supplier's lead time"
                min={0}
                value={form.leadTimeDaysOverride === null ? '' : String(form.leadTimeDaysOverride)}
                onInput={(e: Event) => setForm({ ...form, leadTimeDaysOverride: numOrNull((e.currentTarget as HTMLInputElement).value) })}
              />
              <s-number-field
                label="Minimum order quantity"
                min={1}
                value={String(form.minOrderQty)}
                onInput={(e: Event) => setForm({ ...form, minOrderQty: Math.max(1, Number((e.currentTarget as HTMLInputElement).value) || 1) })}
              />
              <s-number-field
                label="Unit cost"
                min={0}
                step={0.01}
                value={form.unitCost === null ? '' : String(form.unitCost)}
                onInput={(e: Event) => setForm({ ...form, unitCost: numOrNull((e.currentTarget as HTMLInputElement).value) })}
              />
              <s-switch
                label="Track this variant"
                checked={form.isTracked}
                onChange={(e: Event) => setForm({ ...form, isTracked: (e.currentTarget as HTMLInputElement).checked })}
              />
              <s-button variant="primary" disabled={!dirty} loading={update.isPending} onClick={() => update.mutate(form)}>
                Save
              </s-button>
            </s-stack>
          </s-section>

          <s-section heading="Restock plans">
            {data.plans.length === 0 ? (
              <s-text color="subdued">Not on any plan yet.</s-text>
            ) : (
              <s-stack gap="small">
                {data.plans.map((pl) => (
                  <s-stack key={pl.planId} direction="inline" justifyContent="space-between">
                    <AppLink to={`/plans/${pl.planId}`}>{pl.reference}</AppLink>
                    <s-text>{pl.quantity} units · {pl.status}{pl.expectedAt ? ` · ${formatDate(pl.expectedAt)}` : ''}</s-text>
                  </s-stack>
                ))}
              </s-stack>
            )}
          </s-section>
        </s-stack>
      </s-grid>
    </s-page>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <s-stack direction="inline" justifyContent="space-between">
      <s-text color="subdued">{label}</s-text>
      <s-text type="strong">{value}</s-text>
    </s-stack>
  );
}
