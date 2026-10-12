import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useClearanceSuggestion, useCreateDiscount, useProducts, useSettings } from '../api';
import { ErrorBanner, LoadingPage, TierBadge, useMoney, variantLabel } from '../components/ui';

const inDays = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

export function ClearanceNewPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const money = useMoney();
  const { data: products, isLoading, error } = useProducts({});
  const { data: settings } = useSettings();
  const create = useCreateDiscount();

  const [selected, setSelected] = useState<number[]>(() => (params.get('products') ?? '').split(',').map(Number).filter(Boolean));
  const [code, setCode] = useState('');
  const [percentOff, setPercentOff] = useState(10);
  const [endsAt, setEndsAt] = useState(inDays(30));
  const [touched, setTouched] = useState({ code: false, percent: false });

  const overstockDays = settings?.overstockDays ?? 120;
  const candidates = useMemo(
    () =>
      (products ?? [])
        .filter((p) => p.tier === 'overstock' || p.tier === 'no_demand' || selected.includes(p.id))
        .map((p) => ({ ...p, excess: Math.max(0, Math.floor(p.available - (p.velocity ?? 0) * overstockDays)) }))
        .sort((a, b) => b.excess - a.excess),
    [products, overstockDays, selected]
  );

  const sortedSelection = useMemo(() => [...selected].sort((a, b) => a - b), [selected]);
  const { data: suggestion } = useClearanceSuggestion(sortedSelection);

  // Follow the suggestion until the merchant edits a field themselves.
  useEffect(() => {
    if (!suggestion) return;
    if (!touched.code) setCode(suggestion.code);
    if (!touched.percent) setPercentOff(suggestion.percentOff);
  }, [suggestion, touched]);

  if (isLoading) return <LoadingPage heading="New clearance discount" />;
  if (error) return <s-page heading="New clearance discount"><ErrorBanner error={error} /></s-page>;

  const toggle = (id: number, on: boolean) => setSelected(on ? [...selected, id] : selected.filter((s) => s !== id));
  const submit = () =>
    create.mutate({ code, percentOff, productIds: selected, endsAt: endsAt || null }, { onSuccess: () => navigate('/clearance') });

  return (
    <s-page heading="New clearance discount">
      <s-link slot="breadcrumb-actions" href="/clearance">Clearance</s-link>
      <s-button slot="primary-action" variant="primary" disabled={!selected.length || !code} loading={create.isPending} onClick={submit}>
        Create in Shopify
      </s-button>

      <s-grid gridTemplateColumns="@container (inline-size > 800px) 2fr 1fr, 1fr" gap="base">
        <s-section heading="Which products?" padding="none">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Product</s-table-header>
              <s-table-header>Tier</s-table-header>
              <s-table-header format="numeric">In stock</s-table-header>
              <s-table-header format="numeric">Days of cover</s-table-header>
              <s-table-header format="numeric">Excess units</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {candidates.map((p) => (
                <s-table-row key={p.id}>
                  <s-table-cell>
                    <s-checkbox
                      label={variantLabel(p)}
                      checked={selected.includes(p.id)}
                      onChange={(e: Event) => toggle(p.id, (e.currentTarget as HTMLInputElement).checked)}
                    />
                  </s-table-cell>
                  <s-table-cell><TierBadge tier={p.tier} /></s-table-cell>
                  <s-table-cell>{p.available}</s-table-cell>
                  <s-table-cell>{p.daysOfCover ?? '—'}</s-table-cell>
                  <s-table-cell>{p.excess}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
          {candidates.length === 0 && (
            <s-box padding="base">
              <s-text color="subdued">Nothing is overstocked right now. 🎉</s-text>
            </s-box>
          )}
        </s-section>

        <s-stack gap="base">
          <s-section heading="Discount">
            <s-stack gap="base">
              <s-text-field
                label="Code"
                details="Customers type this at checkout"
                value={code}
                onInput={(e: Event) => {
                  setTouched({ ...touched, code: true });
                  setCode((e.currentTarget as HTMLInputElement).value.toUpperCase());
                }}
              />
              <s-number-field
                label="Percent off"
                min={1}
                max={90}
                suffix="%"
                value={String(percentOff)}
                onInput={(e: Event) => {
                  setTouched({ ...touched, percent: true });
                  setPercentOff(Math.min(90, Math.max(1, Number((e.currentTarget as HTMLInputElement).value) || 1)));
                }}
              />
              <s-date-field label="Ends" value={endsAt} onChange={(e: Event) => setEndsAt((e.currentTarget as HTMLInputElement).value)} />
            </s-stack>
          </s-section>

          <s-section heading="Summary">
            {selected.length === 0 ? (
              <s-text color="subdued">Pick the products to clear.</s-text>
            ) : (
              <s-stack gap="small">
                <s-text>
                  {percentOff}% off {selected.length} variant{selected.length === 1 ? '' : 's'}, ending {endsAt || 'never'}.
                </s-text>
                {suggestion && (
                  <>
                    <s-text>
                      <s-text type="strong">{suggestion.excessUnits}</s-text> excess units, about{' '}
                      <s-text type="strong">{money(suggestion.excessValue)}</s-text> at cost.
                    </s-text>
                    <s-text color="subdued">
                      Suggested {suggestion.percentOff}%: deeper overstock gets a deeper discount (10% just over the {overstockDays}-day threshold,
                      20% at 2×, 30% at 3× or with no sales).
                    </s-text>
                  </>
                )}
              </s-stack>
            )}
          </s-section>
        </s-stack>
      </s-grid>
    </s-page>
  );
}
