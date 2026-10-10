import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, toast, useActivity, usePlan, useProducts, useSuppliers, useTransitionPlan, useUpdatePlan } from '../api';
import { AppLink, ErrorBanner, LoadingPage, formatDate, useMoney, variantLabel } from '../components/ui';
import type { PlanItemInput, PlanStatus } from '../types';
import { ActivityTimeline } from './Activity';
import { STATUS_TONE } from './Plans';

const ACTION_LABEL: Record<PlanStatus, string> = {
  ordered: 'Mark as ordered',
  received: 'Mark as received',
  cancelled: 'Cancel plan',
  draft: 'Back to draft',
};

export function PlanDetailPage() {
  const id = Number(useParams().id);
  const { data: plan, isLoading, error } = usePlan(id);
  const { data: suppliers } = useSuppliers();
  const { data: products } = useProducts({});
  const { data: activity } = useActivity({ entityType: 'plan', entityId: id });
  const update = useUpdatePlan(id);
  const transition = useTransitionPlan(id);
  const money = useMoney();

  const [items, setItems] = useState<PlanItemInput[]>([]);
  const [notes, setNotes] = useState('');
  const [pushInventory, setPushInventory] = useState(true);
  const [addProductId, setAddProductId] = useState('');

  useEffect(() => {
    if (plan) {
      setItems(plan.items.map((i) => ({ productId: i.productId, quantity: i.quantity, unitCost: i.unitCost })));
      setNotes(plan.notes ?? '');
    }
  }, [plan]);

  const productById = useMemo(() => new Map((products ?? []).map((p) => [p.id, p])), [products]);

  if (isLoading) return <LoadingPage heading="Restock plan" />;
  if (error || !plan) return <s-page heading="Restock plan"><ErrorBanner error={error} /></s-page>;

  const editable = plan.status === 'draft';
  const itemsDirty = JSON.stringify(items) !== JSON.stringify(plan.items.map((i) => ({ productId: i.productId, quantity: i.quantity, unitCost: i.unitCost })));
  const notesDirty = notes !== (plan.notes ?? '');
  const total = items.reduce((s, i) => s + i.quantity * Number(i.unitCost ?? 0), 0);
  const candidates = (products ?? []).filter((p) => !items.some((i) => i.productId === p.id) && (!plan.supplier || p.supplierId === plan.supplier.id || !p.supplierId));

  const downloadCsv = async () => {
    try {
      const csv = await api<string>(`/plans/${id}/csv`, { headers: { Accept: 'text/csv' } });
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: `${plan.reference}.csv` });
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast((err as Error).message, true);
    }
  };

  return (
    <s-page heading={plan.reference}>
      <s-link slot="breadcrumb-actions" href="/plans">Restock plans</s-link>
      {plan.allowedTransitions
        .filter((t) => t !== 'cancelled')
        .map((t) => (
          <s-button
            key={t}
            slot="primary-action"
            variant="primary"
            loading={transition.isPending}
            disabled={itemsDirty || notesDirty || items.length === 0}
            onClick={() => transition.mutate({ to: t, updateShopifyInventory: t === 'received' ? pushInventory : undefined })}
          >
            {ACTION_LABEL[t]}
          </s-button>
        ))}
      <s-button slot="secondary-actions" onClick={downloadCsv} disabled={!plan.items.length}>Export CSV</s-button>
      {plan.allowedTransitions.includes('cancelled') && (
        <s-button slot="secondary-actions" tone="critical" onClick={() => transition.mutate({ to: 'cancelled' })}>Cancel plan</s-button>
      )}

      {(itemsDirty || notesDirty) && (
        <s-banner tone="warning">Save your changes before changing the plan status.</s-banner>
      )}

      <s-grid gridTemplateColumns="@container (inline-size > 800px) 2fr 1fr, 1fr" gap="base">
        <s-stack gap="base">
          <s-section heading="Items" padding="none">
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Product</s-table-header>
                <s-table-header format="numeric">In stock</s-table-header>
                <s-table-header format="numeric">Suggested</s-table-header>
                <s-table-header format="numeric">Quantity</s-table-header>
                <s-table-header format="currency">Line cost</s-table-header>
                {editable && <s-table-header>{''}</s-table-header>}
              </s-table-header-row>
              <s-table-body>
                {items.map((item) => {
                  const saved = plan.items.find((i) => i.productId === item.productId);
                  const product = saved?.product ?? productById.get(item.productId);
                  return (
                    <s-table-row key={item.productId}>
                      <s-table-cell>
                        {product ? <AppLink to={`/products/${item.productId}`}>{variantLabel(product)}</AppLink> : `#${item.productId}`}
                      </s-table-cell>
                      <s-table-cell>{product?.available ?? '—'}</s-table-cell>
                      <s-table-cell>{saved?.suggestedQty ?? '—'}</s-table-cell>
                      <s-table-cell>
                        {editable ? (
                          <div className="qty-input">
                            <s-number-field
                              label="Quantity"
                              labelAccessibilityVisibility="exclusive"
                              min={1}
                              value={String(item.quantity)}
                              onInput={(e: Event) => {
                                const quantity = Math.max(1, Number((e.currentTarget as HTMLInputElement).value) || 1);
                                setItems(items.map((i) => (i.productId === item.productId ? { ...i, quantity } : i)));
                              }}
                            />
                          </div>
                        ) : (
                          item.quantity
                        )}
                      </s-table-cell>
                      <s-table-cell>{money(item.quantity * Number(item.unitCost ?? 0), true)}</s-table-cell>
                      {editable && (
                        <s-table-cell>
                          <s-button variant="tertiary" tone="critical" icon="delete" accessibilityLabel="Remove" onClick={() => setItems(items.filter((i) => i.productId !== item.productId))} />
                        </s-table-cell>
                      )}
                    </s-table-row>
                  );
                })}
              </s-table-body>
            </s-table>
            <s-box padding="base">
              <s-stack gap="base">
                {editable && (
                  <s-stack direction="inline" gap="small" alignItems="end">
                    <s-select label="Add product" value={addProductId} onChange={(e: Event) => setAddProductId((e.currentTarget as HTMLSelectElement).value)}>
                      <s-option value="">Choose a product…</s-option>
                      {candidates.map((p) => (
                        <s-option key={p.id} value={String(p.id)}>{`${variantLabel(p)}${p.recommendedQty ? ` — suggest ${p.recommendedQty}` : ''}`}</s-option>
                      ))}
                    </s-select>
                    <s-button
                      disabled={!addProductId}
                      onClick={() => {
                        const p = productById.get(Number(addProductId));
                        if (!p) return;
                        setItems([...items, { productId: p.id, quantity: Math.max(p.recommendedQty, p.minOrderQty, 1), unitCost: p.unitCost }]);
                        setAddProductId('');
                      }}
                    >
                      Add
                    </s-button>
                  </s-stack>
                )}
                <s-stack direction="inline" justifyContent="space-between">
                  <s-text type="strong">Total</s-text>
                  <s-text type="strong">{money(total, true)} · {items.reduce((s, i) => s + i.quantity, 0)} units</s-text>
                </s-stack>
                {editable && (
                  <s-button variant="primary" disabled={!itemsDirty} loading={update.isPending} onClick={() => update.mutate({ items })}>
                    Save items
                  </s-button>
                )}
              </s-stack>
            </s-box>
          </s-section>

          <s-section heading="History">
            <ActivityTimeline items={activity?.items ?? []} />
          </s-section>
        </s-stack>

        <s-stack gap="base">
          <s-section heading="Details">
            <s-stack gap="base">
              <s-stack direction="inline" justifyContent="space-between">
                <s-text color="subdued">Status</s-text>
                <s-badge tone={STATUS_TONE[plan.status]}>{plan.status}</s-badge>
              </s-stack>
              <s-select
                label="Supplier"
                disabled={!editable}
                value={plan.supplier ? String(plan.supplier.id) : ''}
                onChange={(e: Event) => {
                  const v = (e.currentTarget as HTMLSelectElement).value;
                  update.mutate({ supplierId: v ? Number(v) : null });
                }}
              >
                <s-option value="">No supplier</s-option>
                {(suppliers ?? []).map((s) => (
                  <s-option key={s.id} value={String(s.id)}>{s.name}</s-option>
                ))}
              </s-select>
              {plan.supplier?.email && <s-text color="subdued">PO contact: {plan.supplier.email}</s-text>}
              <s-date-field
                label="Expected delivery"
                disabled={plan.status === 'received' || plan.status === 'cancelled'}
                value={plan.expectedAt ?? ''}
                onChange={(e: Event) => update.mutate({ expectedAt: (e.currentTarget as HTMLInputElement).value || null })}
              />
              <s-text-area label="Notes" rows={3} value={notes} onInput={(e: Event) => setNotes((e.currentTarget as HTMLTextAreaElement).value)} />
              {notesDirty && <s-button onClick={() => update.mutate({ notes: notes || null })}>Save notes</s-button>}
              {plan.allowedTransitions.includes('received') && (
                <s-checkbox
                  label="Add received units to Shopify inventory"
                  checked={pushInventory}
                  onChange={(e: Event) => setPushInventory((e.currentTarget as HTMLInputElement).checked)}
                />
              )}
            </s-stack>
          </s-section>
          <s-section heading="Timeline">
            <s-stack gap="small">
              <s-text>Created {formatDate(plan.createdAt)}</s-text>
              {plan.orderedAt && <s-text>Ordered {formatDate(plan.orderedAt)}</s-text>}
              {plan.receivedAt && <s-text>Received {formatDate(plan.receivedAt)}</s-text>}
            </s-stack>
          </s-section>
        </s-stack>
      </s-grid>
    </s-page>
  );
}
