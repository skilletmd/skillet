// Collapse device rows so one physical machine shows once in user-facing views.
//
// The pairing flow intends one device row per machine (client kinds are additive
// onto a single row). But desktop and CLI on the same machine are independently
// credentialed, and a warm sibling can't be safely token-rotated on re-pair, so
// the registry deliberately tolerates a transient duplicate row for the same
// machine_id. Those duplicates don't converge while both clients stay live, so
// the human-facing surfaces (CLI `device list`, web Settings, the device count)
// collapse by machine_id instead of trusting the row set to be already unique.
//
// Rows with no machine_id (old registries that predate the column) can't be
// grouped and each stays on its own — absence is never treated as a match.

/** The fields collapsing needs; callers may carry many more (preserved via T). */
export interface CollapsibleDevice {
  device_id: string;
  machine_id?: string | null;
  last_seen_at?: number | null;
  created_at: number;
  client_kind?: string | null;
  client_kinds?: string[] | null;
}

function kindsOf(row: CollapsibleDevice): string[] {
  if (row.client_kinds && row.client_kinds.length > 0) return row.client_kinds;
  return row.client_kind ? [row.client_kind] : [];
}

/**
 * One entry per machine_id, order-stable by first appearance. The surviving row
 * is the caller's own device when it's in the group (so device_id stays stable
 * for rename/delete), else the most-recently-seen row. The winner keeps its own
 * fields except: client_kinds is unioned across the machine's rows, created_at
 * is the machine's earliest, and last_seen_at is the machine's latest.
 */
export function collapseDevicesByMachine<T extends CollapsibleDevice>(
  rows: readonly T[],
  currentDeviceId?: string | null,
): T[] {
  const groups = new Map<string, T[]>();
  const order: string[] = [];
  for (const row of rows) {
    const key = row.machine_id ? `m:${row.machine_id}` : `d:${row.device_id}`;
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = [];
      groups.set(key, bucket);
      order.push(key);
    }
    bucket.push(row);
  }

  return order.map((key) => {
    const bucket = groups.get(key)!;
    if (bucket.length === 1) return bucket[0]!;

    const seenAt = (r: T): number => r.last_seen_at ?? r.created_at;
    const winner =
      (currentDeviceId != null && bucket.find((r) => r.device_id === currentDeviceId)) ||
      bucket.reduce((best, r) => (seenAt(r) > seenAt(best) ? r : best));

    const kinds = new Set<string>();
    for (const r of bucket) for (const k of kindsOf(r)) if (k) kinds.add(k);

    const created_at = Math.min(...bucket.map((r) => r.created_at));
    const last_seen_at = bucket.reduce<number | null>(
      (mx, r) => (r.last_seen_at != null && (mx == null || r.last_seen_at > mx) ? r.last_seen_at : mx),
      null,
    );

    return {
      ...winner,
      created_at,
      last_seen_at,
      ...(kinds.size > 0 ? { client_kinds: [...kinds] } : {}),
    };
  });
}
