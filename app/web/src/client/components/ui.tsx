/**
 * Small presentational helpers shared across pages: tier badges, score bars,
 * sparklines and formatting. Charts are plain SVG — no chart library needed.
 */
import { createContext, useContext, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { RiskTier } from '../types';

export const CurrencyContext = createContext('USD');

export function useMoney() {
  const currency = useContext(CurrencyContext);
  const fmt = new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 });
  const fmt2 = new Intl.NumberFormat(undefined, { style: 'currency', currency });
  return (n: number | null | undefined, cents = false) => (n === null || n === undefined ? '—' : (cents ? fmt2 : fmt).format(n));
}

export const TIER_META: Record<RiskTier, { label: string; tone: 'critical' | 'warning' | 'caution' | 'success' | 'info' | 'neutral'; color: string }> = {
  critical: { label: 'Critical', tone: 'critical', color: '#c5280c' },
  high: { label: 'High', tone: 'warning', color: '#e48a00' },
  watch: { label: 'Watch', tone: 'caution', color: '#d4b106' },
  healthy: { label: 'Healthy', tone: 'success', color: '#2e8b57' },
  overstock: { label: 'Overstock', tone: 'info', color: '#3b82c4' },
  no_demand: { label: 'No demand', tone: 'neutral', color: '#8a8a8a' },
};

export function TierBadge({ tier }: { tier: RiskTier | null }) {
  if (!tier) return <s-badge>Not scored</s-badge>;
  const meta = TIER_META[tier];
  return <s-badge tone={meta.tone}>{meta.label}</s-badge>;
}

export function ScoreBar({ score, tier }: { score: number | null; tier: RiskTier | null }) {
  if (score === null || !tier) return <s-text color="subdued">—</s-text>;
  return (
    <div className="score-bar" title={`Risk score ${score}/100`}>
      <span className="score-bar__value">{score}</span>
      <span className="score-bar__track">
        <span style={{ width: `${score}%`, background: TIER_META[tier].color }} />
      </span>
    </div>
  );
}

export function Sparkline({ values, width = 90, height = 26, color = '#c5280c' }: { values: number[]; width?: number; height?: number; color?: string }) {
  if (values.length < 2) return <s-text color="subdued">—</s-text>;
  const max = Math.max(100, ...values);
  const step = width / (values.length - 1);
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(height - (v / max) * (height - 2) - 1).toFixed(1)}`).join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Bar chart for daily units; highlights the last 7 days (the velocity window that matters most). */
export function SalesChart({ series }: { series: { day: string; units: number }[] }) {
  const max = Math.max(1, ...series.map((s) => s.units));
  return (
    <div className="sales-chart" role="img" aria-label="Units sold per day, last 30 days">
      {series.map((s, i) => (
        <div key={s.day} className="sales-chart__col" title={`${s.day}: ${s.units} units`}>
          <span className={i >= series.length - 7 ? 'is-recent' : ''} style={{ height: `${(s.units / max) * 100}%` }} />
        </div>
      ))}
    </div>
  );
}

/** Stacked distribution bar across tiers. */
export function TierDistribution({ counts }: { counts: Partial<Record<RiskTier, number>> }) {
  const entries = (Object.keys(TIER_META) as RiskTier[]).map((t) => [t, counts[t] ?? 0] as const).filter(([, n]) => n > 0);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  if (!total) return null;
  return (
    <s-stack gap="small-200">
      <div className="tier-dist">
        {entries.map(([t, n]) => (
          <span key={t} style={{ flex: n, background: TIER_META[t].color }} title={`${TIER_META[t].label}: ${n}`} />
        ))}
      </div>
      <s-stack direction="inline" gap="base">
        {entries.map(([t, n]) => (
          <s-text key={t} color="subdued">
            <span className="dot" style={{ background: TIER_META[t].color }} /> {TIER_META[t].label} {n}
          </s-text>
        ))}
      </s-stack>
    </s-stack>
  );
}

export function Kpi({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: 'critical' | 'success' }) {
  return (
    <s-section>
      <s-stack gap="small-200">
        <s-text color="subdued">{label}</s-text>
        <s-heading>
          <span className={`kpi-value${tone ? ` kpi-value--${tone}` : ''}`}>{value}</span>
        </s-heading>
        {hint && <s-text color="subdued">{hint}</s-text>}
      </s-stack>
    </s-section>
  );
}

/** In-app link that uses the client router (keeps the iframe from reloading). */
export function AppLink({ to, children }: { to: string; children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <s-link
      href={to}
      onClick={(e: Event) => {
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </s-link>
  );
}

/** Product thumbnail + linked title + tier badge, used in product tables. */
export function ProductCell({ product, label }: { product: { id: number; imageUrl: string | null; tier: RiskTier | null }; label: string }) {
  return (
    <s-stack direction="inline" gap="small" alignItems="center">
      <s-thumbnail src={product.imageUrl ?? undefined} alt="" size="small" />
      <s-stack gap="small-300">
        <AppLink to={`/products/${product.id}`}>{label}</AppLink>
        <TierBadge tier={product.tier} />
      </s-stack>
    </s-stack>
  );
}

export const variantLabel = (p: { title: string; variantTitle: string | null }) => (p.variantTitle ? `${p.title} — ${p.variantTitle}` : p.title);

export function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
}

export function relativeTime(value: string) {
  const diff = (Date.now() - new Date(value).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return formatDate(value);
}

/** "Order by" with urgency: overdue / today / in N days. */
export function OrderBy({ date }: { date: string | null }) {
  if (!date) return <s-text color="subdued">—</s-text>;
  const days = Math.round((new Date(`${date}T00:00:00`).getTime() - new Date(new Date().toDateString()).getTime()) / 86400000);
  if (days < 0) return <s-badge tone="critical">Overdue {Math.abs(days)}d</s-badge>;
  if (days === 0) return <s-badge tone="warning">Today</s-badge>;
  if (days <= 7) return <s-text tone="caution">in {days}d</s-text>;
  return <s-text>{formatDate(date)}</s-text>;
}

export function LoadingPage({ heading }: { heading: string }) {
  return (
    <s-page heading={heading}>
      <s-section>
        <s-stack alignItems="center" padding="large">
          <s-spinner accessibilityLabel="Loading" />
        </s-stack>
      </s-section>
    </s-page>
  );
}

export function ErrorBanner({ error }: { error: unknown }) {
  return (
    <s-banner tone="critical" heading="Something went wrong">
      {(error as Error)?.message ?? 'Unknown error'}
    </s-banner>
  );
}
