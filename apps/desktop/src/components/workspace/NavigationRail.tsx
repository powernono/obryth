import {
  BookOpen,
  Globe,
  Inbox,
  Layers3,
  Moon,
  Palette,
  Puzzle,
  Search,
  Settings2,
  Sparkles,
  Sun,
  TerminalSquare,
} from "lucide-react";
import type { WorkspaceSurface } from "../../lib/workbench";
import type { NoteView } from "./Library";

export function NavigationRail(props: {
  surface: WorkspaceSurface;
  activeTool?: string;
  view: NoteView;
  selectView: (view: NoteView) => void;
  setSurface: (surface: WorkspaceSurface) => void;
  agent: () => void;
  terminal: () => void;
  search: () => void;
  settings: () => void;
  appearance: () => void;
  dark: boolean;
  theme: () => void;
}) {
  const notesActive =
    props.surface === "workspace" &&
    !["home", "agent", "terminal"].includes(props.activeTool ?? "");
  const items = [
    {
      label: "收件箱",
      Icon: Inbox,
      active: notesActive && props.view === "inbox",
      action: () => props.selectView("inbox"),
    },
    {
      label: "笔记导航",
      Icon: BookOpen,
      active: notesActive && props.view !== "inbox",
      action: () => props.selectView("all"),
    },
    {
      label: "知识助手",
      Icon: Sparkles,
      active: props.surface === "workspace" && props.activeTool === "agent",
      action: props.agent,
    },
    {
      label: "研究浏览器",
      Icon: Globe,
      active: props.surface === "browser",
      action: () => props.setSurface("browser"),
    },
    {
      label: "终端工作区",
      Icon: TerminalSquare,
      active: props.surface === "workspace" && props.activeTool === "terminal",
      action: props.terminal,
    },
  ];
  return (
    <nav className="navigation-rail" aria-label="快捷功能">
      <button
        aria-label="快速搜索"
        title="搜索笔记与命令"
        onClick={props.search}
      >
        <Search size={18} />
      </button>
      <span className="rail-divider" />
      {items.map(({ label, Icon, active, action }) => (
        <button
          key={label}
          aria-label={label}
          title={label}
          aria-pressed={active}
          onClick={action}
        >
          <Icon size={19} />
        </button>
      ))}
      <div className="rail-bottom">
        <button
          aria-label="知识库管理"
          title="知识库管理"
          aria-pressed={props.surface === "knowledge"}
          onClick={() => props.setSurface("knowledge")}
        >
          <Layers3 size={18} />
        </button>
        <button
          aria-label="插件与扩展"
          title="插件与扩展"
          aria-pressed={props.surface === "plugins"}
          onClick={() => props.setSurface("plugins")}
        >
          <Puzzle size={18} />
        </button>
        <span className="rail-divider" />
        <button
          aria-label="外观设置"
          title="主题、主题色与界面材质"
          onClick={props.appearance}
        >
          <Palette size={18} />
        </button>
        <button
          aria-label="切换主题"
          title={props.dark ? "切换到浅色" : "切换到深色"}
          onClick={props.theme}
        >
          {props.dark ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <button
          aria-label="设置与连接"
          title="设置与连接"
          onClick={props.settings}
        >
          <Settings2 size={18} />
        </button>
      </div>
    </nav>
  );
}
