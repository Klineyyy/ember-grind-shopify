import { useEffect, useState } from 'react';
import { useDevAction, useSaveSettings, useSettings } from '../api';
import { ErrorBanner, LoadingPage } from '../components/ui';

type Fields = { defaultLeadTimeDays: number; safetyStockDays: number; reviewPeriodDays: number; overstockDays: number };

const FIELDS: { key: keyof Fields; label: string; details: string }[] = [
  { key: 'defaultLeadTimeDays', label: 'Default lead time (days)', details: 'Used when a product has no supplier or override.' },
  { key: 'safetyStockDays', label: 'Safety stock (days)', details: 'Buffer for late deliveries and demand surprises.' },
  { key: 'reviewPeriodDays', label: 'Review period (days)', details: 'How often you place orders. Reorder quantities cover this gap.' },
  { key: 'overstockDays', label: 'Overstock threshold (days)', details: 'More cover than this is flagged as cash tied up in stock.' },
];

type SeedResult = { log?: { step: string; ok: boolean; detail: string }[] };

export function SettingsPage() {
  const { data, isLoading, error } = useSettings();
  const save = useSaveSettings();
  const dev = useDevAction();
  const [form, setForm] = useState<Fields | null>(null);
  const [seedLog, setSeedLog] = useState<SeedResult['log']>();

  useEffect(() => {
    if (data) setForm({ defaultLeadTimeDays: data.defaultLeadTimeDays, safetyStockDays: data.safetyStockDays, reviewPeriodDays: data.reviewPeriodDays, overstockDays: data.overstockDays });
  }, [data]);

  if (isLoading || !form) return <LoadingPage heading="Settings" />;
  if (error || !data) return <s-page heading="Settings"><ErrorBanner error={error} /></s-page>;

  const dirty = FIELDS.some((f) => form[f.key] !== data[f.key]);

  return (
    <s-page heading="Settings" inlineSize="small">
      <s-section heading="Planning rules">
        <s-stack gap="base">
          {FIELDS.map((f) => (
            <s-number-field
              key={f.key}
              label={f.label}
              details={f.details}
              min={0}
              value={String(form[f.key])}
              onInput={(e: Event) => setForm({ ...form, [f.key]: Number((e.currentTarget as HTMLInputElement).value) || 0 })}
            />
          ))}
          <s-paragraph>
            <s-text color="subdued">
              A product is flagged when its stock cover drops below lead time + safety stock. Saving recalculates every score.
            </s-text>
          </s-paragraph>
          <s-button variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate(form)}>
            Save
          </s-button>
        </s-stack>
      </s-section>

      {data.devTools && (
        <s-section heading="Demo data (development only)">
          <s-stack gap="base">
            <s-paragraph>
              A fresh development store has no products or order history. These tools create the Ember & Grind catalog in your store and simulate
              realistic sales so every feature can be explored.
            </s-paragraph>
            <s-stack direction="inline" gap="small">
              <s-button loading={dev.isPending && dev.variables === 'seed-store'} onClick={() => dev.mutate('seed-store', { onSuccess: (r) => setSeedLog((r as SeedResult).log) })}>
                1. Seed demo store
              </s-button>
              <s-button loading={dev.isPending && dev.variables === 'demo-suppliers'} onClick={() => dev.mutate('demo-suppliers')}>
                2. Add demo suppliers
              </s-button>
              <s-button loading={dev.isPending && dev.variables === 'demo-sales'} onClick={() => dev.mutate('demo-sales')}>
                3. Generate demo sales
              </s-button>
            </s-stack>
            {seedLog && (
              <ul className="seed-log">
                {seedLog.map((l) => (
                  <li key={l.step}>
                    {l.ok ? '✅' : '❌'} <strong>{l.step}:</strong> {l.detail}
                  </li>
                ))}
              </ul>
            )}
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}
