import { useNavigate } from 'react-router-dom';
import { useAlertAction, useDashboard, useDevAction, useGeneratePlans, useSettings, useSync } from '../api';
import {
  ErrorBanner,
  Kpi,
  LoadingPage,
  OrderBy,
  ProductCell,
  ScoreBar,
  Sparkline,
  TIER_META,
  TierDistribution,
  relativeTime,
  useMoney,
  variantLabel,
} from '../components/ui';
import { ActivityTimeline } from './Activity';

export function DashboardPage() {
  const { data, isLoading, error } = useDashboard();
  const { data: settings } = useSettings();
  const sync = useSync();
  const generate = useGeneratePlans();
  const dev = useDevAction();
  const alertAction = useAlertAction();
  const money = useMoney();
  const navigate = useNavigate();

  if (isLoading) return <LoadingPage heading="Restock Radar" />;
  if (error || !data) return <s-page heading="Restock Radar"><ErrorBanner error={error} /></s-page>;

  const { kpis, setup } = data;

  return (
    <s-page heading="Restock Radar">
      <s-button slot="primary-action" variant="primary" loading={generate.isPending} disabled={!kpis.reorderNowCount} onClick={() => generate.mutate(undefined, { onSuccess: () => navigate('/plans') })}>
        Create restock plans
      </s-button>
      <s-button slot="secondary-actions" loading={sync.isPending} onClick={() => sync.mutate(undefined)}>
        Sync with Shopify
      </s-button>

      {/* Grids don't get Polaris' automatic section spacing, so stack everything with one gap. */}
      <s-stack gap="base">
        {!setup.hasProducts && (
          <s-banner tone="info" heading="Let’s get your catalog in">
            <s-paragraph>Restock Radar needs your products and stock levels to start scoring risk.</s-paragraph>
            <s-button slot="secondary-actions" loading={sync.isPending} onClick={() => sync.mutate(undefined)}>Sync products</s-button>
            {settings?.devTools && (
              <s-button slot="secondary-actions" loading={dev.isPending} onClick={() => dev.mutate('seed-store')}>Seed demo store</s-button>
            )}
          </s-banner>
        )}
        {setup.hasProducts && !setup.hasSales && (
          <s-banner tone="warning" heading="No sales history yet">
            <s-paragraph>Scores are based on how fast products sell. Once orders come in, risk scores appear automatically.</s-paragraph>
            {settings?.devTools && (
              <s-button slot="secondary-actions" loading={dev.isPending} onClick={() => dev.mutate('demo-sales')}>Generate 60 days of demo sales</s-button>
            )}
          </s-banner>
        )}

        <s-grid gridTemplateColumns="@container (inline-size > 700px) 1fr 1fr 1fr 1fr, 1fr 1fr" gap="base">
          <Kpi label="At risk of stockout" value={kpis.critical + kpis.high} hint={`${kpis.critical} critical · ${kpis.high} high`} tone={kpis.critical ? 'critical' : undefined} />
          <Kpi label="Weekly revenue at risk" value={money(kpis.weeklyRevenueAtRisk)} hint="If at-risk items sell out" tone={kpis.weeklyRevenueAtRisk ? 'critical' : undefined} />
          <Kpi label="Reorder now" value={kpis.reorderNowCount} hint={`${kpis.draftPlans} draft · ${kpis.orderedPlans} on order`} />
          <Kpi label="Cash tied in overstock" value={money(kpis.overstockValue)} hint={`${kpis.overstock} slow movers`} />
        </s-grid>

        <s-section heading="Risk across your catalog">
          <TierDistribution counts={{ critical: kpis.critical, high: kpis.high, watch: kpis.watch, healthy: kpis.healthy, overstock: kpis.overstock }} />
        </s-section>

        <s-section heading="Highest risk right now" padding="none">
          <s-button slot="secondary-actions" variant="tertiary" onClick={() => navigate('/products')}>
            View all products
          </s-button>
          {data.topRisks.length === 0 ? (
            <s-box padding="base">
              <s-text color="subdued">Nothing at risk. Every tracked product has enough stock to cover its lead time.</s-text>
            </s-box>
          ) : (
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Product</s-table-header>
                <s-table-header>Risk</s-table-header>
                <s-table-header format="numeric">Days of cover</s-table-header>
                <s-table-header format="numeric">Sells / day</s-table-header>
                <s-table-header>Order by</s-table-header>
                <s-table-header format="numeric">Suggested qty</s-table-header>
                <s-table-header>14-run trend</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {data.topRisks.map((p) => (
                  <s-table-row key={p.id}>
                    <s-table-cell>
                      <ProductCell product={p} label={variantLabel(p)} />
                    </s-table-cell>
                    <s-table-cell><ScoreBar score={p.score} tier={p.tier} /></s-table-cell>
                    <s-table-cell>{p.daysOfCover ?? '—'}</s-table-cell>
                    <s-table-cell>{p.velocity?.toFixed(1) ?? '—'}</s-table-cell>
                    <s-table-cell><OrderBy date={p.orderByDate} /></s-table-cell>
                    <s-table-cell>{p.recommendedQty || '—'}</s-table-cell>
                    <s-table-cell><Sparkline values={p.trend} color={p.tier ? TIER_META[p.tier].color : undefined} /></s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}
        </s-section>

        <s-grid gridTemplateColumns="@container (inline-size > 800px) 1fr 1fr, 1fr" gap="base">
          <s-section heading={`Open alerts (${data.alerts.length})`}>
            {data.alerts.length === 0 ? (
              <s-text color="subdued">No open alerts. Nice.</s-text>
            ) : (
              <s-stack gap="small">
                {data.alerts.map((a) => (
                  <s-box key={a.id} padding="small" borderRadius="base" border="base">
                    <s-stack direction="inline" justifyContent="space-between" alignItems="center" gap="small">
                      <s-stack gap="small-300">
                        <s-stack direction="inline" gap="small-200" alignItems="center">
                          <s-badge tone={a.severity === 'critical' ? 'critical' : a.severity === 'warning' ? 'warning' : 'info'}>
                            {a.type.replace(/_/g, ' ')}
                          </s-badge>
                          <s-text color="subdued">{relativeTime(a.createdAt)}</s-text>
                        </s-stack>
                        <s-text>{a.message}</s-text>
                      </s-stack>
                      <s-button variant="tertiary" onClick={() => alertAction.mutate({ id: a.id, action: 'acknowledge' })}>Dismiss</s-button>
                    </s-stack>
                  </s-box>
                ))}
              </s-stack>
            )}
          </s-section>

          <s-section heading="Recent activity">
            <s-button slot="secondary-actions" variant="tertiary" onClick={() => navigate('/activity')}>
              Full log
            </s-button>
            <ActivityTimeline items={data.activity} compact />
          </s-section>
        </s-grid>

        <s-stack padding="base" alignItems="center">
          <s-text color="subdued">
            {data.shop.lastSyncedAt ? `Last synced ${relativeTime(data.shop.lastSyncedAt)}` : 'Not synced yet'} · {kpis.tracked} variants tracked
          </s-text>
        </s-stack>
      </s-stack>
    </s-page>
  );
}
