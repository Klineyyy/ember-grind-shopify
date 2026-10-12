import { useNavigate } from 'react-router-dom';
import { useDiscounts, useEndDiscount } from '../api';
import { ErrorBanner, formatDate, useMoney, variantLabel } from '../components/ui';

export function ClearancePage() {
  const { data, isLoading, error } = useDiscounts();
  const end = useEndDiscount();
  const navigate = useNavigate();
  const money = useMoney();

  return (
    <s-page heading="Clearance">
      <s-button slot="primary-action" variant="primary" onClick={() => navigate('/clearance/new')}>
        New clearance discount
      </s-button>

      <s-stack gap="base">
        <s-banner tone="info">
          Overstocked products tie up cash. A clearance code is a real Shopify discount limited to the variants you pick. Restock Radar
          suggests how deep to go and tracks what it clears.
        </s-banner>

        <s-section padding="none">
          <s-table loading={isLoading}>
            <s-table-header-row>
              <s-table-header listSlot="primary">Code</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Products</s-table-header>
              <s-table-header format="numeric">Uses</s-table-header>
              <s-table-header format="currency">Sales with code</s-table-header>
              <s-table-header format="numeric">Units sold since launch</s-table-header>
              <s-table-header format="numeric">Excess cleared</s-table-header>
              <s-table-header>Ends</s-table-header>
              <s-table-header>{''}</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {(data ?? []).map((d) => (
                <s-table-row key={d.id}>
                  <s-table-cell>
                    <s-stack gap="small-300">
                      <s-text type="strong">{d.code}</s-text>
                      <s-text color="subdued">{d.percentOff}% off</s-text>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge tone={d.status === 'active' ? 'success' : 'neutral'}>{d.status === 'active' ? 'Active' : 'Ended'}</s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack gap="small-300">
                      <s-text>{variantLabel(d.items[0])}</s-text>
                      {d.items.length > 1 && <s-text color="subdued">+ {d.items.length - 1} more</s-text>}
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>{d.uses ?? '—'}</s-table-cell>
                  <s-table-cell>{d.revenue === null ? '—' : money(d.revenue, true)}</s-table-cell>
                  <s-table-cell>{d.unitsSoldSince}</s-table-cell>
                  <s-table-cell>
                    {d.excessAtStart ? `${Math.min(d.stockCleared, d.excessAtStart)} of ${d.excessAtStart}` : d.stockCleared}
                  </s-table-cell>
                  <s-table-cell>{d.status === 'ended' ? `Ended ${formatDate(d.endedAt)}` : d.endsAt ? formatDate(d.endsAt) : 'No end date'}</s-table-cell>
                  <s-table-cell>
                    {d.status === 'active' && (
                      <s-button
                        variant="tertiary"
                        tone="critical"
                        loading={end.isPending && end.variables === d.id}
                        onClick={() => {
                          if (window.confirm(`End ${d.code}? Customers won't be able to use it any more.`)) end.mutate(d.id);
                        }}
                      >
                        End now
                      </s-button>
                    )}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
          {error && <ErrorBanner error={error} />}
          {data && data.length === 0 && (
            <s-box padding="base">
              <s-text color="subdued">No clearance codes yet. Start from an overstocked product, or click “New clearance discount”.</s-text>
            </s-box>
          )}
        </s-section>
      </s-stack>
    </s-page>
  );
}
