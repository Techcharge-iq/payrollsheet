import Dexie, { type Table } from "dexie";
import type { QueryClient } from "@tanstack/react-query";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { db as supabase, dbAny } from "@/integrations/supabase/external-client";

const CACHE_TABLES = [
  "employees",
  "payroll_batches",
  "payroll_lines",
  "advance_transactions",
  "timesheets",
  "payroll_site_allocations",
] as const;

export type PayrollCacheTable = (typeof CACHE_TABLES)[number];

interface CachedRow {
  user_id: string;
  table_name: PayrollCacheTable;
  row_id: string;
  month?: string;
  work_date?: string;
  payload: Record<string, unknown>;
}

class PayrollCacheDatabase extends Dexie {
  rows!: Table<CachedRow, [string, PayrollCacheTable, string]>;

  constructor() {
    super("site-payroll-cache");
    this.version(1).stores({
      rows: "&[user_id+table_name+row_id], [user_id+table_name], [user_id+table_name+month], [user_id+table_name+work_date]",
    });
  }
}

const cache = new PayrollCacheDatabase();
let activeUserId: string | null = null;
let activeChannel: RealtimeChannel | null = null;
let initializationId = 0;

function getActiveUserId() {
  if (!activeUserId) throw new Error("Payroll cache is not initialized for a signed-in user.");
  return activeUserId;
}

function toCachedRow(userId: string, table: PayrollCacheTable, value: unknown): CachedRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Supabase returned an invalid ${table} row.`);
  }

  const payload = value as Record<string, unknown>;
  if (typeof payload["id"] !== "string" && typeof payload["id"] !== "number") {
    throw new Error(`Supabase returned a ${table} row without an id.`);
  }

  return {
    user_id: userId,
    table_name: table,
    row_id: String(payload["id"]),
    ...(typeof payload["month"] === "string"
      ? { month: payload["month"] }
      : typeof payload["work_date"] === "string"
        ? { month: payload["work_date"].slice(0, 7) }
        : {}),
    ...(typeof payload["work_date"] === "string" ? { work_date: payload["work_date"] } : {}),
    payload,
  };
}

async function fetchAllRows(table: PayrollCacheTable) {
  const rows: unknown[] = [];
  const pageSize = 1000;

  for (let start = 0; ; start += pageSize) {
    const { data, error } = await dbAny
      .from(table)
      .select("*")
      .order("id", { ascending: true })
      .range(start, start + pageSize - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as unknown[]));
    if (!data || data.length < pageSize) return rows;
  }
}

async function replaceSnapshot(userId: string, snapshots: Map<PayrollCacheTable, unknown[]>) {
  await cache.transaction("rw", cache.rows, async () => {
    for (const table of CACHE_TABLES) {
      await cache.rows.where("[user_id+table_name]").equals([userId, table]).delete();
      const snapshot = snapshots.get(table);
      if (!snapshot) throw new Error(`The initial ${table} snapshot is missing.`);
      const rows = snapshot.map((row) => toCachedRow(userId, table, row));
      if (rows.length) await cache.rows.bulkPut(rows);
    }
  });
}

async function applyRealtimeEvent(
  userId: string,
  table: PayrollCacheTable,
  event: { eventType: string; new: unknown; old: unknown },
) {
  const changedRow = event.eventType === "DELETE" ? event.old : event.new;
  if (!changedRow || typeof changedRow !== "object" || Array.isArray(changedRow)) return;
  const row = changedRow as Record<string, unknown>;
  if (typeof row["id"] !== "string" && typeof row["id"] !== "number") return;

  const key: [string, PayrollCacheTable, string] = [userId, table, String(row["id"])];
  if (event.eventType === "DELETE") {
    await cache.rows.delete(key);
  } else {
    await cache.rows.put(toCachedRow(userId, table, row));
  }
}

function invalidateTableQueries(queryClient: QueryClient, table: PayrollCacheTable) {
  const queryKey =
    table === "employees"
      ? ["employees"]
      : table === "payroll_batches" || table === "payroll_lines"
        ? ["payroll_batches"]
        : table === "advance_transactions"
          ? ["advance_transactions"]
          : table === "timesheets"
            ? ["timesheets"]
            : ["payroll_site_allocations"];
  void queryClient.invalidateQueries({ queryKey });
}

export async function initializePayrollCache(
  userId: string,
  queryClient: QueryClient,
  onRealtimeError: (message: string) => void,
) {
  const currentInitialization = ++initializationId;
  activeUserId = userId;
  if (activeChannel) {
    await supabase.removeChannel(activeChannel);
    activeChannel = null;
  }

  let initializing = true;
  const pendingEvents: Array<{
    table: PayrollCacheTable;
    event: { eventType: string; new: unknown; old: unknown };
  }> = [];
  const channel = supabase.channel(`payroll-cache-${userId}`);
  for (const table of CACHE_TABLES) {
    channel.on("postgres_changes", { event: "*", schema: "public", table }, (event) => {
      const normalized = {
        eventType: event.eventType,
        new: event.new,
        old: event.old,
      };
      if (initializing) {
        pendingEvents.push({ table, event: normalized });
        return;
      }
      void applyRealtimeEvent(userId, table, normalized)
        .then(() => invalidateTableQueries(queryClient, table))
        .catch((error: unknown) => {
          console.error(`Could not update local ${table} cache from Supabase Realtime.`, error);
          onRealtimeError(
            `A ${table.replaceAll("_", " ")} change arrived but could not be saved to this browser's cache. Refresh the page to resync.`,
          );
        });
    });
  }

  const subscribed = new Promise<void>((resolve, reject) => {
    channel.subscribe((status, error) => {
      if (status === "SUBSCRIBED") resolve();
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        reject(error ?? new Error(`Supabase Realtime subscription failed: ${status}.`));
      }
    });
  });
  activeChannel = channel;

  try {
    await subscribed;
    const snapshots = new Map<PayrollCacheTable, unknown[]>(
      await Promise.all(
        CACHE_TABLES.map(async (table) => [table, await fetchAllRows(table)] as const),
      ),
    );
    await replaceSnapshot(userId, snapshots);
    for (const { table, event } of pendingEvents) {
      await applyRealtimeEvent(userId, table, event);
      invalidateTableQueries(queryClient, table);
    }
    initializing = false;
    await queryClient.invalidateQueries();
  } catch (error) {
    initializing = false;
    await supabase.removeChannel(channel);
    if (activeChannel === channel) activeChannel = null;
    if (currentInitialization === initializationId) activeUserId = null;
    throw error;
  }

  return async () => {
    if (activeChannel === channel) {
      activeChannel = null;
      await supabase.removeChannel(channel);
    }
    if (activeUserId === userId) activeUserId = null;
  };
}

export async function readCachedRows<T extends Record<string, unknown>>(
  table: PayrollCacheTable,
  filter: { month?: string; workDate?: string } = {},
): Promise<T[]> {
  const userId = getActiveUserId();
  const rows = filter.workDate
    ? await cache.rows
        .where("[user_id+table_name+work_date]")
        .equals([userId, table, filter.workDate])
        .toArray()
    : filter.month
      ? await cache.rows
          .where("[user_id+table_name+month]")
          .equals([userId, table, filter.month])
          .toArray()
      : await cache.rows.where("[user_id+table_name]").equals([userId, table]).toArray();
  return rows.map((row) => row.payload as T);
}

export async function writeCachedRows(table: PayrollCacheTable, rows: unknown[]) {
  const userId = getActiveUserId();
  const records = rows.map((row) => toCachedRow(userId, table, row));
  if (records.length) await cache.rows.bulkPut(records);
}

export async function deleteCachedRows(table: PayrollCacheTable, ids: Array<string | number>) {
  const userId = getActiveUserId();
  if (ids.length) {
    await cache.rows.bulkDelete(ids.map((id) => [userId, table, String(id)]));
  }
}

export async function clearPayrollCacheUser(userId: string) {
  await cache.transaction("rw", cache.rows, async () => {
    for (const table of CACHE_TABLES) {
      await cache.rows.where("[user_id+table_name]").equals([userId, table]).delete();
    }
  });
}
