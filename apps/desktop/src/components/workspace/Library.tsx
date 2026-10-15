import { useEffect, useState } from "react";
import {
  Archive,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Clock3,
  FileText,
  Globe,
  Hash,
  Inbox,
  Layers3,
  ListFilter,
  Moon,
  PanelLeft,
  PanelLeftClose,
  ChevronLeft,
  Palette,
  PanelRight,
  Pin,
  Plus,
  Puzzle,
  Search,
  Settings2,
  Sparkles,
  Star,
  Sun,
  TerminalSquare,
} from "lucide-react";
import type { Note, SearchHit } from "@obryth/contracts";
import type { WorkspaceSurface } from "../../lib/workbench";
import { bridge, safeMessage } from "../../lib/bridge";
import { useWorkbench } from "../../lib/workbench";
export type NoteView = "all" | "inbox" | "pinned" | "memo" | "runbook";
export const viewNames: Record<NoteView, string> = {
  all: "所有笔记",
  inbox: "收件箱",
  pinned: "星标笔记",
  memo: "随手记",
  runbook: "执行日志",
};
export function LibraryNavigation(props: {
  name: string;
  notes: Note[];
  surface: WorkspaceSurface;
  setSurface: (value: WorkspaceSurface) => void;
  view: NoteView;
  selectView: (value: NoteView) => void;
  tag: string;
  selectTag: (value: string) => void;
  settings: () => void;
  search: () => void;
  collapse: () => void;
  dark: boolean;
  theme: () => void;
  appearance: () => void;
  expanded: boolean;
  agent: () => void;
  terminal: () => void;
}) {
  const tags = Array.from(
    new Set(props.notes.flatMap((note) => note.tags)),
  ).sort();
  const row = (view: NoteView, Icon: typeof Inbox, count: number) => (
    <button
      className={
        props.surface === "workspace" && props.view === view && !props.tag
          ? "active"
          : ""
      }
      onClick={() => props.selectView(view)}
    >
      <Icon size={15} />
      <span>{viewNames[view]}</span>
      <small>{count}</small>
    </button>
  );
  return (
    <aside
      className="library-nav"
      id="library-navigation"
      aria-label="知识空间导航"
      hidden={!props.expanded}
    >
      <div className="navigation-heading">
        <button className="vault-selector" onClick={props.settings}>
          <span className="vault-monogram">
            {props.name.slice(0, 1).toUpperCase()}
          </span>
          <span>
            {props.name}
            <small>本地知识空间</small>
          </span>
          <ChevronDown size={13} />
        </button>
        <button
          className="icon-button navigation-collapse"
          aria-label="收起导航栏"
          title="收起导航栏"
          onClick={props.collapse}
        >
          <PanelLeftClose size={16} />
        </button>
      </div>
      <button className="nav-search" onClick={props.search}>
        <Search size={14} />
        <span>搜索笔记与命令</span>
        <kbd>⌘ K</kbd>
      </button>
      <nav className="library-primary" aria-label="笔记视图">
        {row(
          "inbox",
          Inbox,
          props.notes.filter((n) => n.tags.includes("inbox")).length,
        )}
        {row("all", BookOpen, props.notes.length)}
        {row("pinned", Star, props.notes.filter((n) => n.pinned).length)}
      </nav>
      <div className="nav-section-heading">
        <ChevronDown size={11} />
        工作空间
      </div>
      <nav className="library-primary">
        <button onClick={props.agent}>
          <Sparkles size={15} />
          <span>知识助手</span>
          <kbd>AI</kbd>
        </button>
        <button
          className={props.surface === "browser" ? "active" : ""}
          onClick={() => props.setSurface("browser")}
        >
          <Globe size={15} />
          <span>研究浏览器</span>
        </button>
        <button onClick={props.terminal}>
          <TerminalSquare size={15} />
          <span>终端工作区</span>
        </button>
      </nav>
      <div className="nav-section-heading">
        <ChevronDown size={11} />
        笔记类型
      </div>
      <nav className="library-primary">
        {row(
          "memo",
          FileText,
          props.notes.filter((n) => n.kind === "memo").length,
        )}
        {row(
          "runbook",
          Archive,
          props.notes.filter((n) => n.kind === "runbook").length,
        )}
      </nav>
      <div className="nav-section-heading">
        <ChevronDown size={11} />
        标签<span>{tags.length}</span>
      </div>
      <nav className="library-primary library-tags">
        {tags.map((tag, index) => (
          <button
            key={tag}
            className={
              props.tag === tag && props.surface === "workspace" ? "active" : ""
            }
            onClick={() => props.selectTag(tag)}
          >
            <Hash size={14} className={`tag-color-${index % 4}`} />
            <span>{tag}</span>
            <small>
              {props.notes.filter((n) => n.tags.includes(tag)).length}
            </small>
          </button>
        ))}
        {!tags.length && <p className="nav-hint">为笔记添加标签来组织内容</p>}
      </nav>
      <div className="nav-bottom">
        <nav className="library-primary">
          <button
            className={props.surface === "knowledge" ? "active" : ""}
            onClick={() => props.setSurface("knowledge")}
          >
            <Layers3 size={15} />
            <span>知识库管理</span>
          </button>
          <button
            className={props.surface === "plugins" ? "active" : ""}
            onClick={() => props.setSurface("plugins")}
          >
            <Puzzle size={15} />
            <span>插件与扩展</span>
          </button>
        </nav>
        <div className="nav-footer">
          <button onClick={props.settings} aria-label="设置与连接">
            <Settings2 size={15} />
            <span>设置与连接</span>
          </button>
          <button
            onClick={props.appearance}
            aria-label="外观设置"
            title="主题、主题色与界面材质"
          >
            <Palette size={15} />
          </button>
          <button onClick={props.theme} aria-label="切换主题">
            {props.dark ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
      </div>
    </aside>
  );
}
export function NoteIndex(props: {
  notes: Note[];
  selected: string | null;
  title: string;
  filter: string;
  setFilter: (value: string) => void;
  open: (note: Note) => void;
  create: () => void;
  sort: string;
  setSort: (value: string) => void;
  collapse: () => void;
  visible: boolean;
}) {
  return (
    <aside
      className="note-index"
      id="note-index"
      aria-label="笔记列表"
      hidden={!props.visible}
    >
      <header>
        <strong>{props.title}</strong>
        <span>{props.notes.length}</span>
        <button aria-label="新建笔记" onClick={props.create}>
          <Plus size={16} />
        </button>
        <button
          className="index-collapse-button"
          aria-label="收起笔记列表"
          title="收起笔记列表"
          onClick={props.collapse}
        >
          <ChevronLeft size={16} />
        </button>
      </header>
      <div className="index-tools">
        <label>
          <Search size={13} />
          <input
            aria-label="筛选笔记"
            placeholder="搜索当前视图…"
            value={props.filter}
            onChange={(event) => props.setFilter(event.target.value)}
          />
        </label>
        <select
          aria-label="笔记排序"
          value={props.sort}
          onChange={(event) => props.setSort(event.target.value)}
        >
          <option value="modified">最近修改</option>
          <option value="created">最近创建</option>
          <option value="title">名称 A–Z</option>
        </select>
        <ListFilter size={13} />
      </div>
      <div className="index-note-list">
        {props.notes.length ? (
          props.notes.map((note) => (
            <button
              key={note.id}
              className={`index-note ${note.id === props.selected ? "selected" : ""}`}
              onClick={() => props.open(note)}
            >
              <div className="index-note-title">
                <FileText size={13} />
                <strong>{note.title || "未命名笔记"}</strong>
                {note.pinned && <Pin size={11} />}
              </div>
              <p>
                {note.body
                  .replace(/[#*`>\[\]]/g, "")
                  .trim()
                  .slice(0, 100) || "这是一页新的空白。开始记录你的想法。"}
              </p>
              <div className="index-note-tags">
                {note.tags.slice(0, 2).map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
              <footer>
                <time>
                  {new Date(note.updatedAt).toLocaleDateString("zh-CN", {
                    month: "short",
                    day: "numeric",
                  })}
                </time>
                <span>
                  {note.kind === "runbook"
                    ? "执行日志"
                    : note.kind === "memo"
                      ? "随手记"
                      : "Markdown"}
                </span>
              </footer>
            </button>
          ))
        ) : (
          <div className="index-empty">
            <Inbox size={24} />
            <h4>这里还很安静</h4>
            <p>新建笔记，或尝试其他视图。</p>
            <button onClick={props.create}>
              <Plus size={13} />
              新建笔记
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
export function NoteInspector({ close }: { close: () => void }) {
  const workbench = useWorkbench();
  const note = workbench.notes.find((n) => n.id === workbench.selectedId);
  const [tab, setTab] = useState("properties");
  const [links, setLinks] = useState<SearchHit[]>([]);
  useEffect(() => {
    let active = true;
    setLinks([]);
    if (note)
      void bridge
        .call<SearchHit[]>("notes.backlinks", { id: note.id })
        .then((value) => {
          if (active) setLinks(value);
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [note?.id, note?.revision]);
  const outline =
    note?.body
      .split("\n")
      .filter((line) => /^#{1,4} /.test(line))
      .map((line) => ({
        level: line.match(/^#+/)![0].length,
        title: line.replace(/^#+ /, ""),
      })) ?? [];
  return (
    <aside className="note-inspector">
      <header>
        <PanelRight size={14} />
        <strong>笔记详情</strong>
        <button aria-label="收起笔记详情" onClick={close}>
          <PanelRight size={14} />
        </button>
      </header>
      <div className="inspector-tabs">
        <button
          className={tab === "properties" ? "active" : ""}
          onClick={() => setTab("properties")}
        >
          属性与关系
        </button>
        <button
          className={tab === "outline" ? "active" : ""}
          onClick={() => setTab("outline")}
        >
          大纲 <small>{outline.length}</small>
        </button>
      </div>
      {note ? (
        <div className="inspector-content">
          {tab === "properties" ? (
            <>
              <dl className="property-table">
                <div>
                  <dt>
                    <FileText size={12} />
                    类型
                  </dt>
                  <dd>
                    <span className="property-pill">
                      {note.kind === "memo"
                        ? "随手记"
                        : note.kind === "runbook"
                          ? "执行日志"
                          : "文档"}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>
                    <Star size={12} />
                    星标
                  </dt>
                  <dd>{note.pinned ? "已收藏" : "未收藏"}</dd>
                </div>
                <div>
                  <dt>
                    <Clock3 size={12} />
                    修改时间
                  </dt>
                  <dd>{new Date(note.updatedAt).toLocaleDateString()}</dd>
                </div>
                <div>
                  <dt>
                    <Hash size={12} />
                    标签
                  </dt>
                  <dd>
                    {note.tags.length
                      ? note.tags.map((tag) => (
                          <span className="property-tag" key={tag}>
                            {tag}
                          </span>
                        ))
                      : "—"}
                  </dd>
                </div>
                {note.source && (
                  <div>
                    <dt>
                      <Globe size={12} />
                      来源
                    </dt>
                    <dd className="property-source">{note.source}</dd>
                  </div>
                )}
              </dl>
              <section>
                <div className="inspector-section-title">
                  反向链接 <span>{links.length}</span>
                </div>
                {links.length ? (
                  links.map((hit) => (
                    <button
                      className="related-note"
                      key={hit.note.id}
                      onClick={() =>
                        workbench.open("document", hit.note.id, hit.note.title)
                      }
                    >
                      <FileText size={13} />
                      {hit.note.title}
                      <ChevronRight size={12} />
                    </button>
                  ))
                ) : (
                  <p className="inspector-empty">
                    其他笔记引用此笔记后，会显示在这里。使用 [[笔记标题]]
                    建立联系。
                  </p>
                )}
              </section>
              <section>
                <div className="inspector-section-title">知识上下文</div>
                <p className="inspector-empty">
                  可通过标签将这篇笔记纳入知识范围，供 API 与 Agent 检索。
                </p>
                <div className="property-tag-list">
                  {note.tags.map((tag) => (
                    <span className="property-tag" key={tag}>
                      #{tag}
                    </span>
                  ))}
                </div>
              </section>
              <section>
                <div className="inspector-section-title">文件信息</div>
                <code className="note-file-id">{note.id}.md</code>
                <small className="revision-label">
                  版本 {note.revision.slice(0, 12)}
                </small>
              </section>
            </>
          ) : (
            <section className="outline-list">
              {outline.length ? (
                outline.map((item, index) => (
                  <p key={index} style={{ paddingLeft: (item.level - 1) * 12 }}>
                    {item.title}
                  </p>
                ))
              ) : (
                <p className="inspector-empty">
                  使用 Markdown 标题组织长文档。
                </p>
              )}
            </section>
          )}
        </div>
      ) : (
        <p className="inspector-empty">选择一篇笔记查看详情。</p>
      )}
    </aside>
  );
}
