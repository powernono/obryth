import {
  Columns2,
  List,
  Maximize2,
  PanelLeft,
  PanelRight,
  PanelsTopLeft,
  Plus,
  Rows2,
  Search,
  PanelLeftOpen,
  PanelLeftClose,
  Home,
} from "lucide-react";
import type { PanelVisibility, WritingView } from "../../lib/workspace-chrome";
import type { WorkspaceSurface } from "../../lib/workbench";
export function WorkspaceTitlebar(props: {
  macos: boolean;
  homeActive: boolean;
  surface: WorkspaceSurface;
  panels: PanelVisibility;
  toggle: (panel: keyof PanelVisibility) => void;
  view: WritingView | null;
  chooseView: (view: WritingView) => void;
  name: string;
  title: string;
  search: () => void;
  create: () => void;
  home: () => void;
  split: (direction: "right" | "below") => void;
  layout: (kind: string) => void;
}) {
  const writing = props.surface === "workspace" && !props.homeActive;
  return (
    <header className="app-titlebar" data-tauri-drag-region="">
      <div className="titlebar-leading">
        <button
          className="icon-button"
          aria-label="返回主页"
          title="返回主页"
          onClick={props.home}
        >
          <Home size={16} />
        </button>
        <button
          className={`icon-button ${props.panels.navigation ? "is-on" : ""}`}
          aria-label="切换导航栏"
          aria-pressed={props.panels.navigation}
          aria-expanded={props.panels.navigation}
          aria-controls="library-navigation"
          title={`${props.panels.navigation ? "收起导航" : "展开导航"} · ${props.macos ? "⌘" : "Ctrl+"}\\`}
          onClick={() => props.toggle("navigation")}
        >
          {props.panels.navigation ? (
            <PanelLeftClose size={17} />
          ) : (
            <PanelLeftOpen size={17} />
          )}
        </button>
        {writing && (
          <button
            className={`index-toggle ${props.panels.list ? "is-on" : ""}`}
            aria-label="切换笔记列表"
            aria-pressed={props.panels.list}
            aria-expanded={props.panels.list}
            aria-controls="note-index"
            title={`${props.panels.list ? "收起笔记列表" : "显示笔记列表"} · ${props.macos ? "⌘ ⇧" : "Ctrl+Shift+"}\\`}
            onClick={() => props.toggle("list")}
          >
            <List size={17} />
            <span>笔记列表</span>
          </button>
        )}
        <span className="titlebar-divider" />
        <span className="titlebar-brand">
          <span>o</span>obryth
        </span>
      </div>
      <div className="titlebar-context" data-tauri-drag-region="">
        <span data-tauri-drag-region="">{props.name}</span>
        <span className="titlebar-slash" data-tauri-drag-region="">
          /
        </span>
        <strong data-tauri-drag-region="">{props.title}</strong>
      </div>
      <div className="titlebar-actions">
        {writing && (
          <>
            <div
              className="writing-view-switch"
              role="group"
              aria-label="写作布局"
            >
              {(
                [
                  { id: "focus", label: "专注写作", key: "1", Icon: Maximize2 },
                  {
                    id: "browse",
                    label: "列表与编辑器",
                    key: "2",
                    Icon: Columns2,
                  },
                  {
                    id: "full",
                    label: "完整布局",
                    key: "3",
                    Icon: PanelsTopLeft,
                  },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  aria-label={item.label}
                  aria-pressed={props.view === item.id}
                  title={`${item.label} · ${props.macos ? "⌘" : "Ctrl+"}${item.key}`}
                  onClick={() => props.chooseView(item.id)}
                >
                  <item.Icon size={14} />
                </button>
              ))}
            </div>
            <button
              className={`icon-button ${props.panels.details ? "is-on" : ""}`}
              aria-label="切换笔记详情"
              aria-pressed={props.panels.details}
              title="笔记详情"
              onClick={() => props.toggle("details")}
            >
              <PanelRight size={15} />
            </button>
            <span className="titlebar-divider titlebar-secondary" />
            <div className="layout-picker titlebar-secondary">
              <select
                aria-label="工作区布局"
                defaultValue=""
                onChange={(event) => {
                  props.layout(event.target.value);
                  event.target.value = "";
                }}
              >
                <option value="" disabled>
                  窗格
                </option>
                <option value="dev">开发记录</option>
                <option value="research">研究阅读</option>
              </select>
            </div>
            <button
              className="icon-button titlebar-secondary"
              aria-label="向右拆分"
              title="向右拆分"
              onClick={() => props.split("right")}
            >
              <Columns2 size={15} />
            </button>
            <button
              className="icon-button titlebar-secondary"
              aria-label="向下拆分"
              title="向下拆分"
              onClick={() => props.split("below")}
            >
              <Rows2 size={15} />
            </button>
          </>
        )}
        <button
          className="icon-button titlebar-search"
          aria-label="搜索笔记与命令"
          title="搜索与命令 · ⌘K"
          onClick={props.search}
        >
          <Search size={15} />
        </button>
        <button className="new-note-button" onClick={props.create}>
          <Plus size={14} />
          <span>新建笔记</span>
        </button>
      </div>
    </header>
  );
}
