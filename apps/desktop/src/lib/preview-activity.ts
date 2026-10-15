import type {
  ActivityQuery,
  ActivityPageQuery,
  ActivitySummary,
  ActivityFeed,
  ActivityVersions,
  Note,
} from "@obryth/contracts";
import { dateKey } from "./activity";

export const previewStoreKey = "obryth.preview.vault.v2";
export interface PreviewRevision {
  id: string;
  noteId: string;
  timestamp: string;
  note: Note | null;
}
export interface PreviewStore {
  version: 2;
  notes: Note[];
  revisions: PreviewRevision[];
  historyIncomplete: boolean;
}
export function readPreviewStore(seed: () => Note[]): PreviewStore {
  const stored = localStorage.getItem(previewStoreKey);
  if (stored) return JSON.parse(stored) as PreviewStore;
  const legacy = localStorage.getItem("obryth.preview.notes.v1");
  const notes: Note[] = legacy ? JSON.parse(legacy) : seed();
  const store: PreviewStore = {
    version: 2,
    notes,
    historyIncomplete: !!legacy && notes.length > 0,
    revisions: notes.map((note) => ({
      id: note.revision,
      noteId: note.id,
      timestamp: note.updatedAt,
      note,
    })),
  };
  writePreviewStore(store);
  return store;
}
// One atomic localStorage replacement commits notes and history together.
export function writePreviewStore(store: PreviewStore) {
  localStorage.setItem(previewStoreKey, JSON.stringify(store));
}
function savedRows(store: PreviewStore, range: ActivityQuery) {
  if (
    !(range.from < range.to) ||
    (Date.parse(range.to) - Date.parse(range.from)) / 86400000 > 370
  )
    throw new Error("活动范围须为 1–370 天");
  const format = new Intl.DateTimeFormat("en", { timeZone: range.timeZone });
  void format;
  return [...new Map(store.revisions.map((r) => [r.id, r])).values()]
    .filter(
      (r): r is PreviewRevision & { note: Note } =>
        !!r.note && (!range.kind || r.note.kind === range.kind),
    )
    .map((r) => ({ ...r, day: dateKey(r.timestamp, range.timeZone) }));
}
export function previewSummary(
  store: PreviewStore,
  range: ActivityQuery,
): ActivitySummary {
  const rows = savedRows(store, range);
  const days = new Map<string, { saves: number; notes: Set<string> }>();
  for (const row of rows) {
    if (row.day < range.from || row.day >= range.to) continue;
    const bucket = days.get(row.day) ?? { saves: 0, notes: new Set<string>() };
    bucket.saves++;
    bucket.notes.add(row.noteId);
    days.set(row.day, bucket);
  }
  const result = [...days]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, data]) => ({
      date,
      saves: data.saves,
      notes: data.notes.size,
    }));
  return {
    days: result,
    totalSaves: result.reduce((n, d) => n + d.saves, 0),
    activeDays: result.length,
    years: [...new Set(rows.map((r) => Number(r.day.slice(0, 4))))].sort(
      (a, b) => b - a,
    ),
    historyIncomplete: store.historyIncomplete,
  };
}
function compare(
  a: Pick<PreviewRevision, "id" | "timestamp">,
  b: Pick<PreviewRevision, "id" | "timestamp">,
) {
  return (
    Date.parse(b.timestamp) - Date.parse(a.timestamp) ||
    (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
  );
}
function paginate<T extends PreviewRevision>(
  rows: T[],
  query: ActivityPageQuery,
) {
  rows.sort(compare);
  if (query.cursor) {
    const cursor = JSON.parse(
      decodeURIComponent(escape(atob(query.cursor))),
    ) as {
      range: ActivityQuery;
      noteId: string | null;
      timestamp: string;
      id: string;
    };
    if (
      JSON.stringify(cursor.range) !== JSON.stringify(query.range) ||
      cursor.noteId !== query.noteId
    )
      throw new Error("活动分页条件已改变");
    rows = rows.filter((r) => compare(r, cursor) > 0);
  }
  const limit = Math.max(1, Math.min(query.limit ?? 20, 100));
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  const nextCursor =
    rows.length > limit && last
      ? btoa(
          unescape(
            encodeURIComponent(
              JSON.stringify({
                range: query.range,
                noteId: query.noteId,
                timestamp: last.timestamp,
                id: last.id,
              }),
            ),
          ),
        )
      : null;
  return { items, nextCursor };
}
export function previewFeed(
  store: PreviewStore,
  query: ActivityPageQuery,
): ActivityFeed {
  const groups = new Map<
    string,
    ReturnType<typeof savedRows>[number] & { count: number }
  >();
  for (const row of savedRows(store, query.range)) {
    if (row.day < query.range.from || row.day >= query.range.to) continue;
    const key = `${row.day}/${row.noteId}`;
    const old = groups.get(key);
    groups.set(key, {
      ...(!old || compare(row, old) < 0 ? row : old),
      count: (old?.count ?? 0) + 1,
    });
  }
  const page = paginate([...groups.values()], query);
  const alive = new Set(store.notes.map((n) => n.id));
  return {
    nextCursor: page.nextCursor,
    items: page.items.map((r) => ({
      day: r.day,
      noteId: r.noteId,
      note: r.note,
      saveCount: r.count,
      lastSavedAt: r.timestamp,
      revisionId: r.id,
      deleted: !alive.has(r.noteId),
    })),
  };
}
export function previewVersions(
  store: PreviewStore,
  query: ActivityPageQuery,
): ActivityVersions {
  if (!query.noteId) throw new Error("缺少笔记 ID");
  const rows = savedRows(store, query.range).filter(
    (r) =>
      r.noteId === query.noteId &&
      r.day >= query.range.from &&
      r.day < query.range.to,
  );
  const page = paginate(rows, query);
  return {
    nextCursor: page.nextCursor,
    items: page.items.map(({ id, timestamp, note }) => ({
      id,
      timestamp,
      note,
    })),
  };
}
