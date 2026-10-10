import { useRef, useState } from 'react';
import { useDeleteSupplier, useSaveSupplier, useSuppliers } from '../api';
import { ErrorBanner } from '../components/ui';
import type { Supplier, SupplierInput } from '../types';

const EMPTY: SupplierInput = { name: '', email: '', leadTimeDays: 14, notes: '' };

export function SuppliersPage() {
  const { data, isLoading, error } = useSuppliers();
  const save = useSaveSupplier();
  const remove = useDeleteSupplier();
  const modal = useRef<HTMLElementTagNameMap['s-modal']>(null);
  const [editing, setEditing] = useState<(SupplierInput & { id?: number }) | null>(null);

  const open = (s?: Supplier) => {
    setEditing(s ? { id: s.id, name: s.name, email: s.email ?? '', leadTimeDays: s.leadTimeDays, notes: s.notes ?? '' } : { ...EMPTY });
    modal.current?.showOverlay();
  };

  const submit = () => {
    if (!editing) return;
    save.mutate(editing, { onSuccess: () => modal.current?.hideOverlay() });
  };

  return (
    <s-page heading="Suppliers">
      <s-button slot="primary-action" variant="primary" onClick={() => open()}>Add supplier</s-button>

      <s-section padding="none">
        <s-table loading={isLoading}>
          <s-table-header-row>
            <s-table-header listSlot="primary">Supplier</s-table-header>
            <s-table-header>Email</s-table-header>
            <s-table-header format="numeric">Lead time</s-table-header>
            <s-table-header format="numeric">Products</s-table-header>
            <s-table-header>{''}</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {(data ?? []).map((s) => (
              <s-table-row key={s.id}>
                <s-table-cell>
                  <s-stack gap="small-300">
                    <s-text type="strong">{s.name}</s-text>
                    {s.notes && <s-text color="subdued">{s.notes}</s-text>}
                  </s-stack>
                </s-table-cell>
                <s-table-cell>{s.email ?? '—'}</s-table-cell>
                <s-table-cell>{s.leadTimeDays} days</s-table-cell>
                <s-table-cell>{s.productCount ?? 0}</s-table-cell>
                <s-table-cell>
                  <s-stack direction="inline" gap="small-200">
                    <s-button variant="tertiary" onClick={() => open(s)}>Edit</s-button>
                    <s-button
                      variant="tertiary"
                      tone="critical"
                      onClick={() => {
                        if (window.confirm(`Remove ${s.name}? Its products become unassigned.`)) remove.mutate(s.id);
                      }}
                    >
                      Remove
                    </s-button>
                  </s-stack>
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
        {error && <ErrorBanner error={error} />}
        {data && data.length === 0 && (
          <s-box padding="base">
            <s-text color="subdued">
              Add the companies you buy from. Each supplier’s lead time drives when Restock Radar tells you to reorder.
            </s-text>
          </s-box>
        )}
      </s-section>

      <s-modal ref={modal} id="supplier-modal" heading={editing?.id ? 'Edit supplier' : 'Add supplier'}>
        {editing && (
          <s-stack gap="base">
            <s-text-field label="Name" required value={editing.name} onInput={(e: Event) => setEditing({ ...editing, name: (e.currentTarget as HTMLInputElement).value })} />
            <s-email-field label="Order email" value={editing.email ?? ''} onInput={(e: Event) => setEditing({ ...editing, email: (e.currentTarget as HTMLInputElement).value })} />
            <s-number-field
              label="Lead time (days)"
              details="Time from placing an order to stock arriving"
              min={0}
              value={String(editing.leadTimeDays)}
              onInput={(e: Event) => setEditing({ ...editing, leadTimeDays: Number((e.currentTarget as HTMLInputElement).value) || 0 })}
            />
            <s-text-area label="Notes" value={editing.notes ?? ''} onInput={(e: Event) => setEditing({ ...editing, notes: (e.currentTarget as HTMLTextAreaElement).value })} />
          </s-stack>
        )}
        <s-button slot="primary-action" variant="primary" loading={save.isPending} disabled={!editing?.name.trim()} onClick={submit}>
          Save
        </s-button>
        <s-button slot="secondary-actions" onClick={() => modal.current?.hideOverlay()}>Cancel</s-button>
      </s-modal>
    </s-page>
  );
}
