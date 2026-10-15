import {
  useCallback,
  useEffect,
  useRef,
  useState,
  lazy,
  Suspense,
} from "react";
import {
  FileText,
  Code2,
  Check,
  Loader2,
  Save,
  Plus,
  Clock3,
  History,
  Pin,
  Trash2,
} from "lucide-react";
import type { IDockviewPanelProps } from "dockview-react";
import type { Note, NoteDraft } from "@obryth/contracts";
import { bridge, draftKey, safeMessage } from "../lib/bridge";
import { useWorkbench } from "../lib/workbench";
const RichEditor = lazy(() =>
  import("./RichEditor").then((m) => ({ default: m.RichEditor })),
);
const SourceEditor = lazy(() =>
  import("./SourceEditor").then((m) => ({ default: m.SourceEditor })),
);

export function NotePane(
  props: IDockviewPanelProps<{ noteId?: string; mode?: string }>,
) {
  const workbench = useWorkbench();
  const id = props.params.noteId ?? workbench.selectedId;
  const [note, setNote] = useState<Note | null>(null);
  const [body, setBody] = useState("");
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [mode, setMode] = useState(props.params.mode ?? "document");
  const [vimMode, setVimMode] = useState(false);
  const [state, setState] = useState("saved");
  const [history, setHistory] = useState<
    { id: string; timestamp: string; note: Note | null }[] | null
  >(null);
  const latest = useRef({ body: "", title: "", tags: [] as string[] });
  const head = useRef<Note | null>(null);
  const saving = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    if (!id) return;
    setNote(null);
    bridge
      .call<Note>("notes.get", { id })
      .then((value) => {
        if (!active) return;
        head.current = value;
        const saved = localStorage.getItem(draftKey(value.id));
        const recovered = saved
          ? (JSON.parse(saved) as {
              body: string;
              title: string;
              tags: string[];
              baseRevision: string;
            })
          : null;
        const content = recovered ?? value;
        latest.current = {
          body: content.body,
          title: content.title,
          tags: content.tags,
        };
        setNote(value);
        setBody(content.body);
        setTitle(content.title);
        setTags(content.tags);
        setState(recovered ? "draft" : "saved");
        if (recovered && recovered.baseRevision !== value.revision)
          setState("conflict");
      })
      .catch((error) => workbench.notify(safeMessage(error)));
    return () => {
      active = false;
    };
  }, [id]);
  useEffect(() => {
    const current = head.current;
    const updated = workbench.notes.find((note) => note.id === id);
    if (
      !current ||
      !updated ||
      current.revision === updated.revision ||
      saving.current
    )
      return;
    if (
      current.body === latest.current.body &&
      current.title === latest.current.title &&
      JSON.stringify(current.tags) === JSON.stringify(latest.current.tags)
    ) {
      head.current = updated;
      latest.current = {
        body: updated.body,
        title: updated.title,
        tags: updated.tags,
      };
      setNote(updated);
      setBody(updated.body);
      setTitle(updated.title);
      setTags(updated.tags);
      setState("saved");
    }
  }, [workbench.notes, id]);
  const save = useCallback(async () => {
    if (saving.current || !head.current || state === "conflict") return;
    const current = head.current;
    const content = { ...latest.current };
    if (
      current.body === content.body &&
      current.title === content.title &&
      JSON.stringify(current.tags) === JSON.stringify(content.tags)
    )
      return;
    saving.current = true;
    setState("saving");
    try {
      const updated = await bridge.call<Note>("notes.save", {
        id: current.id,
        title: content.title,
        body: content.body,
        tags: content.tags,
        kind: current.kind,
        pinned: current.pinned,
        source: current.source,
        baseRevision: current.revision,
      } satisfies NoteDraft);
      if (head.current?.id === updated.id) {
        head.current = updated;
        if (mounted.current) {
          setNote(updated);
          setState("saved");
        }
        if (
          latest.current.body === updated.body &&
          latest.current.title === updated.title &&
          JSON.stringify(latest.current.tags) === JSON.stringify(updated.tags)
        )
          localStorage.removeItem(draftKey(updated.id));
        else
          localStorage.setItem(
            draftKey(updated.id),
            JSON.stringify({
              ...latest.current,
              baseRevision: updated.revision,
            }),
          );
      }
      props.api.setTitle(updated.title || "未命名笔记");
      await workbench.refresh();
    } catch (error) {
      if (mounted.current) setState("conflict");
      workbench.notify(`草稿已保留：${safeMessage(error)}`);
    } finally {
      saving.current = false;
    }
  }, [state, props.api]);
  useEffect(() => {
    if (!note || state === "conflict") return;
    const handle = setTimeout(() => void save(), 750);
    return () => clearTimeout(handle);
  }, [body, title, tags, note, state, save]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key === "s" &&
        workbench.surface === "workspace" &&
        props.api.isActive
      ) {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [save, props.api, workbench.surface]);
  const change = (patch: Partial<typeof latest.current>) => {
    latest.current = { ...latest.current, ...patch };
    if (head.current)
      localStorage.setItem(
        draftKey(head.current.id),
        JSON.stringify({
          ...latest.current,
          baseRevision: head.current.revision,
        }),
      );
    setBody(latest.current.body);
    setTitle(latest.current.title);
    setTags(latest.current.tags);
    if (state !== "conflict") setState("draft");
  };
  if (!id)
    return (
      <div className="empty-pane">
        <FileText size={30} />
        <h2>留一点空间，给新的想法</h2>
        <p>从左侧选择笔记，或创建一条新的记录。</p>
      </div>
    );
  if (!note)
    return (
      <div className="empty-pane">
        <Loader2 className="spin" />
        正在打开笔记…
      </div>
    );
  return (
    <div className={`note-pane ${mode === "markdown" ? "source-mode" : ""}`}>
      <div className="note-controls">
        <div className="segmented">
          <button
            className={mode === "document" ? "selected" : ""}
            onClick={() => {
              setMode("document");
              props.api.updateParameters({ mode: "document" });
            }}
          >
            <FileText size={13} />
            文档
          </button>
          <button
            className={mode === "markdown" ? "selected" : ""}
            onClick={() => {
              setMode("markdown");
              props.api.updateParameters({ mode: "markdown" });
            }}
          >
            <Code2 size={13} />
            源码
          </button>
        </div>
        {mode === "markdown" && (
          <button
            className={`quiet-button ${vimMode ? "enabled" : ""}`}
            onClick={() => setVimMode((v) => !v)}
          >
            VIM {vimMode ? "ON" : "OFF"}
          </button>
        )}
        <span className="grow" />
        <span
          className={`save-status ${state === "conflict" ? "warning" : ""}`}
        >
          {state === "saving" ? (
            <Loader2 className="spin" size={12} />
          ) : state === "saved" ? (
            <Check size={12} />
          ) : (
            <Clock3 size={12} />
          )}
          {
            {
              saved: "已保存",
              saving: "保存中",
              draft: "草稿",
              conflict: "版本冲突 · 草稿已保留",
            }[state]
          }
        </span>
        <button
          className="icon-button"
          title="保存笔记"
          aria-label="保存笔记"
          onClick={() => void save()}
        >
          <Save size={15} />
        </button>
        <button
          className="icon-button"
          title="版本历史"
          aria-label="版本历史"
          onClick={() =>
            void bridge
              .call<typeof history>("notes.history", { id: note.id })
              .then(setHistory)
              .catch((error) => workbench.notify(safeMessage(error)))
          }
        >
          <History size={15} />
        </button>
        <button
          className="icon-button"
          aria-label="置顶"
          title="置顶"
          onClick={() =>
            void bridge
              .call<Note>("notes.save", {
                ...latest.current,
                id: note.id,
                kind: note.kind,
                pinned: !note.pinned,
                baseRevision: head.current?.revision,
              })
              .then((value) => {
                head.current = value;
                setNote(value);
                void workbench.refresh();
              })
              .catch((error) => workbench.notify(safeMessage(error)))
          }
        >
          <Pin size={15} />
        </button>
        <button
          className="icon-button"
          aria-label="删除笔记"
          title="删除笔记"
          onClick={() => {
            if (window.confirm("将这条笔记移入回收站？"))
              void bridge
                .call("notes.delete", {
                  id: note.id,
                  baseRevision: head.current?.revision,
                })
                .then(() => {
                  props.api.close();
                  void workbench.refresh();
                })
                .catch((error) => workbench.notify(safeMessage(error)));
          }}
        >
          <Trash2 size={15} />
        </button>
      </div>
      {state === "conflict" && (
        <div className="conflict-banner">
          当前草稿与磁盘版本不同。请先复制或导出草稿，再重新打开笔记进行合并。
          <button
            onClick={() => navigator.clipboard.writeText(latest.current.body)}
          >
            复制草稿
          </button>
        </div>
      )}
      <div className="note-heading">
        <div className="eyebrow">
          {note.kind === "runbook"
            ? "EXECUTION LOG"
            : "YOUR KNOWLEDGE, CONNECTED"}
        </div>
        <input
          aria-label="笔记标题"
          className="note-title"
          value={title}
          onChange={(event) => change({ title: event.target.value })}
          placeholder="未命名笔记"
        />
        <div className="note-meta">
          <Clock3 size={12} />
          <span>
            {new Date(note.updatedAt).toLocaleDateString("zh-CN", {
              month: "short",
              day: "numeric",
            })}
          </span>
          <span className="meta-dot">·</span>
          {tags.map((tag) => (
            <button
              className="tag-chip"
              key={tag}
              title="点击移除标签"
              onClick={() => change({ tags: tags.filter((t) => t !== tag) })}
            >
              #{tag}
            </button>
          ))}
          <button
            className="add-tag"
            onClick={() => {
              const tag = window.prompt("标签名称");
              if (tag?.trim())
                change({ tags: [...new Set([...tags, tag.trim()])] });
            }}
          >
            <Plus size={12} />
            标签
          </button>
        </div>
      </div>
      <div className="editor-surface">
        <Suspense
          fallback={<div className="loading-editor">正在准备编辑器…</div>}
        >
          {mode === "markdown" ? (
            <SourceEditor
              key={note.id}
              value={body}
              onChange={(value) => change({ body: value })}
              vimMode={vimMode}
            />
          ) : (
            <RichEditor
              key={note.id}
              value={body}
              onChange={(value) => change({ body: value })}
            />
          )}
        </Suspense>
      </div>
      {history && (
        <div className="history-sheet">
          <header>
            <h3>版本历史</h3>
            <button onClick={() => setHistory(null)}>关闭</button>
          </header>
          {history.length ? (
            history.map((version) => (
              <article key={version.id}>
                <time>{new Date(version.timestamp).toLocaleString()}</time>
                <pre>{version.note?.body.slice(0, 240) ?? "已删除"}</pre>
                {version.note && (
                  <button
                    onClick={() =>
                      void bridge
                        .call<Note>("notes.restore", {
                          id: note.id,
                          revision: version.note!.revision,
                        })
                        .then((value) => {
                          head.current = value;
                          setNote(value);
                          change({
                            body: value.body,
                            title: value.title,
                            tags: value.tags,
                          });
                          setHistory(null);
                        })
                        .catch((error) => workbench.notify(safeMessage(error)))
                    }
                  >
                    恢复此版本
                  </button>
                )}
              </article>
            ))
          ) : (
            <p>保存后将在这里保留历史版本。</p>
          )}
        </div>
      )}
    </div>
  );
}
