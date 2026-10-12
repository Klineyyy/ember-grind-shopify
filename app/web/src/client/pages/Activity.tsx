import { useState } from 'react';
import { useActivity } from '../api';
import { AppLink, ErrorBanner, relativeTime } from '../components/ui';
import type { ActivityEntry } from '../types';

const ICONS: Record<ActivityEntry['entityType'], string> = {
  plan: '📦',
  supplier: '🚚',
  product: '🏷️',
  alert: '⚠️',
  sync: '🔄',
  settings: '⚙️',
  discount: '💸',
};

const LINKS: Partial<Record<ActivityEntry['entityType'], (id: number) => string>> = {
  plan: (id) => `/plans/${id}`,
  product: (id) => `/products/${id}`,
  discount: () => '/clearance',
};

function formatChange(key: string, value: unknown): string | null {
  if (key === 'items' && Array.isArray(value)) {
    return `items: ${value.map((c: { productId: number; from: number; to: number }) => `#${c.productId} ${c.from}→${c.to}`).join(', ')}`;
  }
  if (value && typeof value === 'object' && 'from' in value && 'to' in value) {
    const { from, to } = value as { from: unknown; to: unknown };
    return `${key}: ${from ?? '—'} → ${to ?? '—'}`;
  }
  return null;
}

export function ActivityTimeline({ items, compact = false }: { items: ActivityEntry[]; compact?: boolean }) {
  if (!items.length) return <s-text color="subdued">No activity yet.</s-text>;
  return (
    <ul className="timeline">
      {items.map((entry) => {
        const link = entry.entityId && LINKS[entry.entityType]?.(entry.entityId);
        const changes = !compact && entry.changes ? Object.entries(entry.changes).map(([k, v]) => formatChange(k, v)).filter(Boolean) : [];
        return (
          <li key={entry.id}>
            <span className={`timeline__icon timeline__icon--${entry.actor}`} aria-hidden="true">{ICONS[entry.entityType]}</span>
            <div>
              {link ? <AppLink to={link}>{entry.summary}</AppLink> : <s-text>{entry.summary}</s-text>}
              {!compact && (
                <div>
                  <s-text color="subdued">by {entry.actor}</s-text>
                </div>
              )}
              {changes.length > 0 && (
                <ul className="timeline__changes">
                  {changes.map((c) => <li key={c}>{c}</li>)}
                </ul>
              )}
            </div>
            <span className="timeline__time" title={new Date(entry.createdAt).toLocaleString()}>{relativeTime(entry.createdAt)}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function ActivityPage() {
  const [entityType, setEntityType] = useState('');
  const [cursors, setCursors] = useState<number[]>([]);
  const before = cursors[cursors.length - 1];
  const { data, isLoading, error } = useActivity({ entityType: entityType || undefined, before });

  return (
    <s-page heading="Activity">
      <s-section>
        <s-stack gap="base">
          <s-select
            label="Show"
            value={entityType}
            onChange={(e: Event) => {
              setEntityType((e.currentTarget as HTMLSelectElement).value);
              setCursors([]);
            }}
          >
            <s-option value="">Everything</s-option>
            <s-option value="plan">Restock plans</s-option>
            <s-option value="alert">Alerts</s-option>
            <s-option value="product">Product settings</s-option>
            <s-option value="discount">Clearance discounts</s-option>
            <s-option value="supplier">Suppliers</s-option>
            <s-option value="sync">Syncs</s-option>
            <s-option value="settings">Settings</s-option>
          </s-select>
          {error ? <ErrorBanner error={error} /> : isLoading ? <s-spinner accessibilityLabel="Loading" /> : <ActivityTimeline items={data?.items ?? []} />}
          <s-stack direction="inline" gap="small">
            <s-button disabled={!cursors.length} onClick={() => setCursors(cursors.slice(0, -1))}>Newer</s-button>
            <s-button disabled={!data?.nextCursor} onClick={() => data?.nextCursor && setCursors([...cursors, data.nextCursor])}>Older</s-button>
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}
