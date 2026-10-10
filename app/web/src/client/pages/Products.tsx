import { useDeferredValue, useState } from 'react';
import { useProducts } from '../api';
import { ErrorBanner, OrderBy, ProductCell, ScoreBar, useMoney } from '../components/ui';

export function ProductsPage() {
  const [tier, setTier] = useState('');
  const [query, setQuery] = useState('');
  const q = useDeferredValue(query);
  const { data, isLoading, error } = useProducts({ tier, q });
  const money = useMoney();

  return (
    <s-page heading="Products">
      <s-section padding="none">
        <s-table loading={isLoading}>
          <s-grid slot="filters" gridTemplateColumns="2fr 1fr" gap="small">
            <s-search-field
              label="Search"
              labelAccessibilityVisibility="exclusive"
              placeholder="Search by title or SKU"
              value={query}
              onInput={(e: Event) => setQuery((e.currentTarget as HTMLInputElement).value)}
            />
            <s-select label="Risk tier" labelAccessibilityVisibility="exclusive" value={tier} onChange={(e: Event) => setTier((e.currentTarget as HTMLSelectElement).value)}>
              <s-option value="">All tiers</s-option>
              <s-option value="critical">Critical</s-option>
              <s-option value="high">High</s-option>
              <s-option value="watch">Watch</s-option>
              <s-option value="healthy">Healthy</s-option>
              <s-option value="overstock">Overstock</s-option>
              <s-option value="no_demand">No demand</s-option>
            </s-select>
          </s-grid>
          <s-table-header-row>
            <s-table-header listSlot="primary">Product</s-table-header>
            <s-table-header listSlot="secondary">Variant</s-table-header>
            <s-table-header>Risk</s-table-header>
            <s-table-header format="numeric">In stock</s-table-header>
            <s-table-header format="numeric">Days of cover</s-table-header>
            <s-table-header>Order by</s-table-header>
            <s-table-header format="numeric">Suggested</s-table-header>
            <s-table-header>Supplier</s-table-header>
            <s-table-header format="currency">Price</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {(data ?? []).map((p) => (
              <s-table-row key={p.id}>
                <s-table-cell>
                  <ProductCell product={p} label={p.title} />
                </s-table-cell>
                <s-table-cell>{p.variantTitle ?? '—'}</s-table-cell>
                <s-table-cell><ScoreBar score={p.score} tier={p.tier} /></s-table-cell>
                <s-table-cell>{p.available}{p.incoming ? ` (+${p.incoming})` : ''}</s-table-cell>
                <s-table-cell>{p.daysOfCover ?? '—'}</s-table-cell>
                <s-table-cell><OrderBy date={p.orderByDate} /></s-table-cell>
                <s-table-cell>{p.recommendedQty || '—'}</s-table-cell>
                <s-table-cell>{p.supplierName ?? <s-text color="subdued">Unassigned</s-text>}</s-table-cell>
                <s-table-cell>{money(p.price, true)}</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
        {error && <ErrorBanner error={error} />}
        {data && data.length === 0 && (
          <s-box padding="base">
            <s-text color="subdued">No products match. Try a different filter, or sync from the dashboard.</s-text>
          </s-box>
        )}
      </s-section>
    </s-page>
  );
}
