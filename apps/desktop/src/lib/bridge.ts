import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  RpcBridge,
  Note,
  SearchHit,
  NoteDraft,
  KnowledgeScope,
  ActivityQuery,
  ActivityPageQuery,
} from "@obryth/contracts";
import {
  readPreviewStore,
  writePreviewStore,
  previewSummary,
  previewFeed,
  previewVersions,
} from "./preview-activity";

export const native = isTauri();
const preferencesKey = "obryth.preview.preferences.v1";
function seed(): Note[] {
  const date = new Date().toISOString();
  return [
    {
      id: "welcome",
      title: "让思考保持流动",
      body: '# 让思考保持流动\n\nObryth 是一个安静的工作空间，让笔记、终端和你的 AI Agent 自然地连接。\n\n## 从一个想法开始\n\n记录灵感，用标签组织知识，然后把需要的上下文交给 Agent。你的笔记始终属于你。\n\n- 用 **文档模式** 专注写作\n- 切换 **Markdown**，保留熟悉的编辑方式\n- 拆分工作区，让终端与思考并肩\n\n## 在同一个空间里工作\n\n```sh\nobryth new --title "今天的想法" --tag inbox\nobryth tui\n```\n\n> 好的工具让你更接近正在做的事。\n',
      tags: ["开始使用", "inbox"],
      kind: "document",
      pinned: true,
      createdAt: date,
      updatedAt: date,
      revision: "welcome-1",
      source: null,
      extra: {},
    },
  ];
}
export class PreviewBridge implements RpcBridge {
  async call<T>(method: string, params: unknown = {}): Promise<T> {
    const p = params as Record<string, unknown>;
    let result: unknown;
    const store = readPreviewStore(seed);
    const notes = store.notes;
    switch (method) {
      case "plugins.list":
        result = JSON.parse(
          localStorage.getItem("obryth.preview.plugins") ?? "[]",
        );
        break;
      case "vault.info":
        result = {
          id: "preview",
          name: "Personal space",
          root: "Browser preview",
          protocolVersion: 1,
        };
        break;
      case "notes.list":
      case "knowledge.search": {
        const query = String(p.text ?? "").toLowerCase();
        const scope = p.scope as KnowledgeScope | undefined;
        result = notes
          .filter(
            (n) =>
              (!query ||
                `${n.title} ${n.body}`.toLowerCase().includes(query)) &&
              (!scope?.includeTags?.length ||
                scope.includeTags.some((t) => n.tags.includes(t))) &&
              !scope?.excludeTags?.some((t) => n.tags.includes(t)),
          )
          .sort(
            (a, b) =>
              Number(b.pinned) - Number(a.pinned) ||
              b.updatedAt.localeCompare(a.updatedAt),
          )
          .slice(
            Number(p.offset ?? 0),
            Number(p.offset ?? 0) + Number(p.limit ?? 50),
          )
          .map((note) => ({ note, excerpt: note.body.slice(0, 160), line: 1 }));
        break;
      }
      case "notes.get": {
        result = notes.find((n) => n.id === p.id);
        if (!result) throw new Error("Note not found");
        break;
      }
      case "notes.save": {
        const input = p as unknown as NoteDraft;
        const old = notes.find((n) => n.id === input.id);
        if (old && old.revision !== input.baseRevision)
          throw new Error(
            "REVISION_CONFLICT: recover your draft before reloading",
          );
        const note: Note = {
          ...old,
          id: old?.id ?? crypto.randomUUID(),
          title: input.title,
          body: input.body,
          tags: input.tags ?? [],
          kind: input.kind ?? "document",
          pinned: input.pinned ?? false,
          createdAt: old?.createdAt ?? new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          revision: crypto.randomUUID(),
          source: input.source ?? null,
          extra: old?.extra ?? {},
        };
        writePreviewStore({
          ...store,
          notes: [note, ...notes.filter((n) => n.id !== note.id)],
          revisions: [
            ...store.revisions,
            {
              id: note.revision,
              noteId: note.id,
              timestamp: note.updatedAt,
              note,
            },
          ],
        });
        result = note;
        break;
      }
      case "notes.delete": {
        const note = notes.find((n) => n.id === p.id);
        if (note && note.revision !== p.baseRevision)
          throw new Error("REVISION_CONFLICT");
        if (!note) throw new Error("Note not found");
        writePreviewStore({
          ...store,
          notes: notes.filter((n) => n.id !== p.id),
          revisions: [
            ...store.revisions,
            {
              id: crypto.randomUUID(),
              noteId: note.id,
              timestamp: new Date().toISOString(),
              note: null,
            },
          ],
        });
        result = true;
        break;
      }
      case "notes.activity":
        result = previewSummary(store, p as unknown as ActivityQuery);
        break;
      case "notes.activityFeed":
        result = previewFeed(store, p as unknown as ActivityPageQuery);
        break;
      case "notes.activityVersions":
        result = previewVersions(store, p as unknown as ActivityPageQuery);
        break;
      case "notes.history":
        result = store.revisions.filter((r) => r.noteId === p.id).reverse();
        break;
      case "notes.restore": {
        const old = store.revisions.find(
          (r) => r.id === p.revision && r.noteId === p.id,
        )?.note;
        const current = notes.find((n) => n.id === p.id);
        if (!old || !current) throw new Error("历史版本不存在");
        result = await this.call("notes.save", {
          ...old,
          baseRevision: current.revision,
        });
        break;
      }
      case "conflicts.list":
        result = [];
        break;
      case "notes.backlinks": {
        const target = notes.find((note) => note.id === p.id);
        result = target
          ? notes
              .filter(
                (note) =>
                  note.id !== target.id &&
                  (note.body.includes(`[[${target.id}]]`) ||
                    note.body.includes(`[[${target.title}]]`)),
              )
              .map((note) => ({
                note,
                excerpt: note.body.slice(0, 160),
                line: 1,
              }))
          : [];
        break;
      }
      case "notes.refresh":
        result = { changed: 0 };
        break;
      case "settings.get": {
        const prefs = JSON.parse(localStorage.getItem(preferencesKey) ?? "{}");
        result = prefs[String(p.key)] ?? null;
        break;
      }
      case "settings.set": {
        const prefs = JSON.parse(localStorage.getItem(preferencesKey) ?? "{}");
        prefs[String(p.key)] = p.value;
        localStorage.setItem(preferencesKey, JSON.stringify(prefs));
        result = true;
        break;
      }
      case "providers.list":
        result = JSON.parse(
          localStorage.getItem("obryth.preview.providers") ?? "[]",
        );
        break;
      case "providers.save": {
        if (p.secret)
          throw new Error(
            "API secrets are only accepted by the native credential store",
          );
        const list = await this.call<{ id: string }[]>("providers.list");
        localStorage.setItem(
          "obryth.preview.providers",
          JSON.stringify([
            ...list.filter((n) => n.id !== (p.profile as { id: string }).id),
            p.profile,
          ]),
        );
        result = true;
        break;
      }
      case "agent.detect":
        result = ["codex", "claude", "opencode"].map((id) => ({
          id,
          installed: false,
        }));
        break;
      default:
        throw new Error(
          "此功能需要 Obryth 桌面客户端和 Rust 服务。浏览器预览中的笔记保存在当前浏览器。",
        );
    }
    return result as T;
  }
}
export const bridge: RpcBridge = native
  ? {
      call: <T>(method: string, params: unknown = {}) =>
        invoke<T>("rpc", { method, params }),
    }
  : new PreviewBridge();
export async function listNotes(
  text = "",
  tags: string[] = [],
): Promise<SearchHit[]> {
  return bridge.call("notes.list", {
    text,
    scope: { includeTags: tags, excludeTags: [] },
    limit: 200,
  });
}
export function draftKey(id: string) {
  return `obryth.draft.${id}`;
}
export function safeMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
