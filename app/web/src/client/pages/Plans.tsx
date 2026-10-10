import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCreatePlan, useGeneratePlans, usePlans } from '../api';
import { AppLink, ErrorBanner, formatDate, useMoney } from '../components/ui';
import type { PlanStatus } from '../types';

export const STATUS_TONE: Record<PlanStatus, 'info' | 'warning' | 'success' | 'neutral'> = {
  draft: 'info',
  ordered: 'warning',
  received: 'success',
  cancelled: 'neutral',
};

export function PlansPage() {
  const [status, setStatus] = useState('');
  const { data, isLoading, error } = usePlans(status || undefined);
  const generate = useGeneratePlans();
  const create = useCreatePlan();
  const navigate = useNavigate();
  const money = useMoney();

  return (
    <s-page heading="Restock plans">
      <s-button slot="primary-action" variant="primary" loading={generate.isPending} onClick={() => generate.mutate(undefined)}>
        Generate from recommendations
      </s-button>
      <s-button slot="secondary-actions" loading={create.isPending} onClick={() => create.mutate({ items: [] }, { onSuccess: (plan) => navigate(`/plans/${plan.id}`) })}>
        New empty plan
      </s-button>

      <s-section padding="none">
        <s-table loading={isLoading}>
          <s-select slot="filters" label="Status" labelAccessibilityVisibility="exclusive" value={status} onChange={(e: Event) => setStatus((e.currentTarget as HTMLSelectElement).value)}>
            <s-option value="">All statuses</s-option>
            <s-option value="draft">Draft</s-option>
            <s-option value="ordered">Ordered</s-option>
            <s-option value="received">Received</s-option>
            <s-option value="cancelled">Cancelled</s-option>
          </s-select>
          <s-table-header-row>
            <s-table-header listSlot="primary">Plan</s-table-header>
            <s-table-header>Status</s-table-header>
            <s-table-header>Supplier</s-table-header>
            <s-table-header format="numeric">Lines</s-table-header>
            <s-table-header format="numeric">Units</s-table-header>
            <s-table-header format="currency">Cost</s-table-header>
            <s-table-header>Expected</s-table-header>
            <s-table-header>Created</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {(data ?? []).map((plan) => (
              <s-table-row key={plan.id}>
                <s-table-cell><AppLink to={`/plans/${plan.id}`}>{plan.reference}</AppLink></s-table-cell>
                <s-table-cell><s-badge tone={STATUS_TONE[plan.status]}>{plan.status}</s-badge></s-table-cell>
                <s-table-cell>{plan.supplier?.name ?? <s-text color="subdued">No supplier</s-text>}</s-table-cell>
                <s-table-cell>{plan.itemCount}</s-table-cell>
                <s-table-cell>{plan.units}</s-table-cell>
                <s-table-cell>{money(plan.total, true)}</s-table-cell>
                <s-table-cell>{formatDate(plan.expectedAt)}</s-table-cell>
                <s-table-cell>{formatDate(plan.createdAt)}</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
        {error && <ErrorBanner error={error} />}
        {data && data.length === 0 && (
          <s-box padding="base">
            <s-text color="subdued">
              No plans yet. “Generate from recommendations” groups everything at risk by supplier into ready-to-send drafts.
            </s-text>
          </s-box>
        )}
      </s-section>
    </s-page>
  );
}
