/**
 * Thin API client. App Bridge (loaded from Shopify's CDN) patches `fetch` to
 * attach a fresh session token to same-origin requests, so no auth code here.
 */
import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type * as T from './types';

export class ApiError extends Error {
  constructor(message: string, public status: number, public body: unknown) {
    super(message);
  }
}

export async function api<R>(path: string, init?: RequestInit & { json?: unknown }): Promise<R> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(`/api${path}`, {
    ...rest,
    headers: { Accept: 'application/json', ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...rest.headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError((body as { error?: string }).error ?? res.statusText, res.status, body);
  }
  if (res.status === 204) return undefined as R;
  return (res.headers.get('content-type')?.includes('json') ? res.json() : res.text()) as Promise<R>;
}

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false } },
});

export const toast = (message: string, isError = false) => window.shopify?.toast.show(message, { isError, duration: 4000 });

/** Any write can change scores, alerts and activity, so refresh broadly. */
function useInvalidateAll() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}

function useApiMutation<V, R>(fn: (vars: V) => Promise<R>, success?: (r: R, v: V) => string | void) {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r, v) => {
      invalidate();
      const msg = success?.(r, v);
      if (msg) toast(msg);
    },
    onError: (err: Error) => toast(err.message, true),
  });
}

/* ---------- Queries ---------- */

export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => api<T.Settings>('/settings') });
export const useDashboard = () => useQuery({ queryKey: ['dashboard'], queryFn: () => api<T.Dashboard>('/dashboard') });
export const useProducts = (filters: { tier?: string; q?: string }) =>
  useQuery({
    queryKey: ['products', filters],
    queryFn: () => api<T.ProductView[]>(`/products?${new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][])}`),
  });
export const useProduct = (id: number) => useQuery({ queryKey: ['product', id], queryFn: () => api<T.ProductDetail>(`/products/${id}`) });
export const useSuppliers = () => useQuery({ queryKey: ['suppliers'], queryFn: () => api<T.Supplier[]>('/suppliers') });
export const usePlans = (status?: string) =>
  useQuery({ queryKey: ['plans', status], queryFn: () => api<T.PlanSummary[]>(`/plans${status ? `?status=${status}` : ''}`) });
export const usePlan = (id: number) => useQuery({ queryKey: ['plan', id], queryFn: () => api<T.PlanDetail>(`/plans/${id}`) });
export const useActivity = (filters: { entityType?: string; entityId?: number; before?: number }) =>
  useQuery({
    queryKey: ['activity', filters],
    queryFn: () =>
      api<T.ActivityPage>(
        `/activity?${new URLSearchParams(Object.entries(filters).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]))}`
      ),
  });

/* ---------- Mutations ---------- */

export const useSync = () =>
  useApiMutation(() => api<{ variantCount: number; orderCount: number }>('/sync', { method: 'POST' }), (r) => `Synced ${r.variantCount} variants, ${r.orderCount} orders`);

export const useGeneratePlans = () =>
  useApiMutation(
    (productIds?: number[]) => api<{ created: number; plans: T.PlanDetail[] }>('/plans/from-recommendations', { method: 'POST', json: { productIds } }),
    (r) => (r.created ? `Created ${r.created} draft plan${r.created > 1 ? 's' : ''}` : 'Everything at risk is already on an open plan')
  );

export const useCreatePlan = () =>
  useApiMutation((body: { supplierId?: number | null; items: T.PlanItemInput[] }) => api<T.PlanDetail>('/plans', { method: 'POST', json: body }));

export const useUpdatePlan = (id: number) =>
  useApiMutation((body: Partial<{ notes: string | null; expectedAt: string | null; supplierId: number | null; items: T.PlanItemInput[] }>) =>
    api<T.PlanDetail>(`/plans/${id}`, { method: 'PATCH', json: body }), () => 'Plan saved');

export const useTransitionPlan = (id: number) =>
  useApiMutation(
    (body: { to: T.PlanStatus; updateShopifyInventory?: boolean }) =>
      api<{ plan: T.PlanDetail; inventory?: { pushed: boolean; error?: string } }>(`/plans/${id}/transition`, { method: 'POST', json: body }),
    (r, v) =>
      r.inventory?.error ? `Marked ${v.to}, but Shopify inventory update failed: ${r.inventory.error}` : `Plan marked ${v.to}`
  );

export const useUpdateProduct = (id: number) =>
  useApiMutation((body: Partial<T.ProductPatch>) => api<T.ProductDetail>(`/products/${id}`, { method: 'PATCH', json: body }), () => 'Planning settings saved');

export const useSaveSupplier = () =>
  useApiMutation(
    ({ id, ...body }: T.SupplierInput & { id?: number }) =>
      api<T.Supplier>(id ? `/suppliers/${id}` : '/suppliers', { method: id ? 'PATCH' : 'POST', json: body }),
    (_r, v) => (v.id ? 'Supplier updated' : 'Supplier added')
  );

export const useDeleteSupplier = () => useApiMutation((id: number) => api(`/suppliers/${id}`, { method: 'DELETE' }), () => 'Supplier removed');

export const useAlertAction = () =>
  useApiMutation(({ id, action }: { id: number; action: 'acknowledge' | 'resolve' }) => api(`/alerts/${id}/${action}`, { method: 'POST' }));

export const useSaveSettings = () =>
  useApiMutation((body: Partial<T.Settings>) => api('/settings', { method: 'PATCH', json: body }), () => 'Settings saved — scores recalculated');

export const useDevAction = () =>
  useApiMutation((action: 'seed-store' | 'demo-sales' | 'demo-suppliers') => api<unknown>(`/dev/${action}`, { method: 'POST' }));
