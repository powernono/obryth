import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ActivityQuery, Note } from "@obryth/contracts";
import {
  activityPeriods,
  activityRange,
  calendarDays,
  dateKey,
  defaultActivityPeriod,
  shiftDay,
} from "./activity";
import {
  previewFeed,
  previewSummary,
  previewVersions,
  readPreviewStore,
  writePreviewStore,
  type PreviewStore,
  previewStoreKey,
} from "./preview-activity";
import { PreviewBridge } from "./bridge";

const range: ActivityQuery = {
  from: "2026-01-01",
  to: "2027-01-01",
  timeZone: "Asia/Shanghai",
  kind: null,
};
const note = (id: string, time: string, body = "第一版"): Note => ({
  id,
  title: "测试笔记",
  body,
  kind: "memo",
  tags: ["测试"],
  pinned: false,
  createdAt: time,
  updatedAt: time,
  revision: `${id}-${body}`,
  source: null,
  extra: {},
});
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});
describe("calendar and preview activity", () => {
  it("defaults to 30 inclusive local days and supports rolling scales across year and leap-day boundaries", () => {
    expect(
      activityRange(
        defaultActivityPeriod,
        "2026-01-01",
        "all",
        "Asia/Shanghai",
      ),
    ).toEqual({
      from: "2025-12-03",
      to: "2026-01-02",
      kind: null,
      timeZone: "Asia/Shanghai",
    });
    expect(activityRange("30d", "2024-03-01", "memo", "UTC").from).toBe(
      "2024-02-01",
    );
    for (const period of activityPeriods) {
      const range = activityRange(period.value, "2026-10-16", "all", "UTC");
      expect(
        calendarDays(range).filter(
          (day) => day >= range.from && day < range.to,
        ),
      ).toHaveLength(period.days);
    }
  });
  it("uses local dates across years, leap days and daylight-saving transitions", () => {
    expect(dateKey("2025-12-31T16:00:00Z", "Asia/Shanghai")).toBe("2026-01-01");
    expect(dateKey("2026-03-08T04:59:00Z", "America/New_York")).toBe(
      "2026-03-07",
    );
    expect(dateKey("2026-03-09T03:59:00Z", "America/New_York")).toBe(
      "2026-03-08",
    );
    expect(shiftDay("2024-02-28", 1)).toBe("2024-02-29");
    const days = calendarDays(
      activityRange("2024", "2026-10-15", "all", "UTC"),
    );
    expect(days.length % 7).toBe(0);
    expect(new Date(`${days[0]}T12:00:00Z`).getUTCDay()).toBe(1);
    expect(days).toContain("2024-02-29");
  });
  it("migrates only known versions, counts every save, and commits history atomically", async () => {
    const old = note("one", "2026-01-01T15:59:00Z");
    localStorage.setItem("obryth.preview.notes.v1", JSON.stringify([old]));
    const store = readPreviewStore(() => []);
    expect(store.historyIncomplete).toBe(true);
    expect(store.revisions).toHaveLength(1);
    const api = new PreviewBridge();
    const saved = await api.call<Note>("notes.save", {
      ...old,
      body: "第二版",
      baseRevision: old.revision,
    });
    expect(
      JSON.parse(localStorage.getItem(previewStoreKey)!).revisions,
    ).toHaveLength(2);
    await api.call("notes.delete", {
      id: old.id,
      baseRevision: saved.revision,
    });
    const state: PreviewStore = JSON.parse(
      localStorage.getItem(previewStoreKey)!,
    );
    expect(state.notes).toHaveLength(0);
    expect(state.revisions).toHaveLength(3);
    const historical = previewFeed(state, {
      range,
      cursor: null,
      limit: 20,
      noteId: null,
    });
    expect(historical.items.every((r) => r.deleted)).toBe(true);
    const before = localStorage.getItem(previewStoreKey);
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    await expect(
      api.call("notes.save", { title: "失败", body: "不可丢失" }),
    ).rejects.toThrow("quota");
    expect(localStorage.getItem(previewStoreKey)).toBe(before);
  });
  it("groups days, ignores tombstones and duplicate IDs, and paginates more than 200 notes", () => {
    const first = note("one", "2026-01-01T15:58:00Z");
    const second = { ...first, body: "第二版", revision: "second" };
    const store: PreviewStore = {
      version: 2,
      notes: [],
      historyIncomplete: false,
      revisions: [
        {
          id: first.revision,
          noteId: first.id,
          note: first,
          timestamp: first.updatedAt,
        },
        {
          id: second.revision,
          noteId: first.id,
          note: second,
          timestamp: "2026-01-01T15:59:00Z",
        },
        {
          id: "tombstone",
          noteId: first.id,
          note: null,
          timestamp: "2026-01-01T16:00:00Z",
        },
      ],
    };
    store.revisions.push(store.revisions[0]);
    const summary = previewSummary(store, range);
    expect(summary.totalSaves).toBe(2);
    expect(summary.days[0].notes).toBe(1);
    const feed = previewFeed(store, {
      range,
      cursor: null,
      limit: 20,
      noteId: null,
    });
    expect(feed.items[0].saveCount).toBe(2);
    expect(feed.items[0].note.body).toBe("第二版");
    const versions = previewVersions(store, {
      range,
      cursor: null,
      limit: 1,
      noteId: "one",
    });
    expect(versions.items[0].id).toBe("second");
    expect(
      previewVersions(store, {
        range,
        cursor: versions.nextCursor,
        limit: 1,
        noteId: "one",
      }).items[0].id,
    ).toBe(first.revision);
    for (let i = 0; i < 230; i++) {
      const item = note(`bulk-${i}`, "2026-06-01T00:00:00Z");
      store.revisions.push({
        id: item.revision,
        noteId: item.id,
        note: item,
        timestamp: item.updatedAt,
      });
    }
    let cursor: string | null = null;
    const ids: string[] = [];
    do {
      const page = previewFeed(store, {
        range,
        cursor,
        limit: 20,
        noteId: null,
      });
      ids.push(...page.items.map((r) => r.noteId));
      cursor = page.nextCursor;
    } while (cursor);
    expect(ids.length).toBe(231);
    expect(new Set(ids).size).toBe(231);
    expect(
      previewSummary(store, { ...range, kind: "document" }).totalSaves,
    ).toBe(0);
    writePreviewStore(store);
    expect(readPreviewStore(() => []).revisions.length).toBe(
      store.revisions.length,
    );
  });
});
