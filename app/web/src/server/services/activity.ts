import { and, desc, eq, lt } from 'drizzle-orm';
import { db } from '../db/client.js';
import { activityLog, type ActivityEntityType } from '../db/schema.js';

type Actor = (typeof activityLog.$inferInsert)['actor'];

export interface ActivityEntry {
  shopId: number;
  actor: Actor;
  entityType: ActivityEntityType;
  entityId?: number | null;
  action: string;
  summary: string;
  changes?: Record<string, unknown> | null;
}

// Accepts either the root db or a transaction so log rows commit atomically with the change.
type Executor = Pick<typeof db, 'insert'>;

export async function logActivity(entry: ActivityEntry, tx: Executor = db) {
  await tx.insert(activityLog).values({ ...entry, entityId: entry.entityId ?? null, changes: entry.changes ?? null });
}

/** Field-level diff of the keys present in `next`, for audit entries. */
export function diff<T extends Record<string, unknown>>(prev: T, next: Partial<T>) {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(next) as (keyof T)[]) {
    if (next[key] !== undefined && next[key] !== prev[key]) {
      changes[key as string] = { from: prev[key] ?? null, to: next[key] };
    }
  }
  return changes;
}

export async function listActivity(
  shopId: number,
  opts: { entityType?: ActivityEntityType; entityId?: number; before?: number; limit?: number }
) {
  const limit = Math.min(opts.limit ?? 50, 200);
  const rows = await db
    .select()
    .from(activityLog)
    .where(
      and(
        eq(activityLog.shopId, shopId),
        opts.entityType ? eq(activityLog.entityType, opts.entityType) : undefined,
        opts.entityId ? eq(activityLog.entityId, opts.entityId) : undefined,
        opts.before ? lt(activityLog.id, opts.before) : undefined
      )
    )
    .orderBy(desc(activityLog.id))
    .limit(limit + 1);
  return { items: rows.slice(0, limit), nextCursor: rows.length > limit ? rows[limit - 1].id : null };
}
