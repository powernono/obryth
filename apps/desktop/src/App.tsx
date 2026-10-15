import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  lazy,
  Suspense,
} from "react";
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  themeLight,
} from "dockview-react";
import type { Note, PaneKind, SearchHit } from "@obryth/contracts";
import {
  PanelLeft,
  Plus,
  Search,
  FileText,
  Hash,
  TerminalSquare,
  Sparkles,
  Globe,
  Settings2,
  ChevronDown,
  BookOpen,
  Command,
  Columns2,
  Rows2,
  ArrowUpRight,
  Check,
  FolderOpen,
  Sun,
  Moon,
  X,
  Home,
} from "lucide-react";
import { bridge, listNotes, native, safeMessage } from "./lib/bridge";
import { WorkbenchContext, type WorkspaceSurface } from "./lib/workbench";
import type { KnowledgeScope } from "@obryth/contracts";
import {
  LibraryNavigation,
  NoteIndex,
  NoteInspector,
  viewNames,
  type NoteView,
} from "./components/workspace/Library";
import { KnowledgeManager } from "./components/workspace/KnowledgeManager";
import { PluginSettings } from "./components/PluginSettings";
import { BrowserWorkspace } from "./components/workspace/BrowserWorkspace";
import { PanelRight } from "lucide-react";
import { NotePane } from "./components/NotePane";
import { HomePane } from "./components/workspace/HomePane";
import { WorkspaceTitlebar } from "./components/workspace/WorkspaceTitlebar";
import { NavigationRail } from "./components/workspace/NavigationRail";
import { useAppearance, useMediaQuery } from "./lib/appearance";
import {
  CHROME_KEY,
  readChrome,
  currentWritingView,
  writingViews,
  type WritingView,
  type PanelVisibility,
} from "./lib/workspace-chrome";
import type { SetStateAction } from "react";
const TerminalPane = lazy(() =>
  import("./components/TerminalPane").then((m) => ({
    default: m.TerminalPane,
  })),
);
const AgentPane = lazy(() =>
  import("./components/AgentPane").then((m) => ({ default: m.AgentPane })),
);
const BrowserPane = lazy(() =>
  import("./components/BrowserPane").then((m) => ({ default: m.BrowserPane })),
);
const SearchPane = lazy(() =>
  import("./components/SearchPane").then((m) => ({ default: m.SearchPane })),
);
const Settings = lazy(() =>
  import("./components/Settings").then((m) => ({ default: m.Settings })),
);
import {
  PluginRuntime,
  PluginPane,
  type PluginCommand,
} from "./components/PluginRuntime";
const components = {
  home: HomePane,
  plugin: PluginPane,
  note: NotePane,
  terminal: TerminalPane,
  agent: AgentPane,
  browser: BrowserPane,
  search: SearchPane,
};
const paneNames: Record<PaneKind, string> = {
  document: "文档",
  markdown: "Markdown",
  terminal: "终端",
  agent: "知识助手",
  browser: "浏览器",
  search: "搜索",
};
export default function App() {
  const [surface, setSurface] = useState<WorkspaceSurface>("workspace");
  const [view, setView] = useState<NoteView>("all");
  const [sort, setSort] = useState("modified");
  const [chrome, setChrome] = useState(readChrome);
  const sidebar = chrome.navigation;
  const chromeRef = useRef(chrome);
  chromeRef.current = chrome;
  const setInspector = useCallback(
    (update: SetStateAction<boolean>) =>
      setChrome((value) => ({
        ...value,
        details: typeof update === "function" ? update(value.details) : update,
      })),
    [],
  );
  const setSidebar = useCallback(
    (update: SetStateAction<boolean>) =>
      setChrome((value) => ({
        ...value,
        navigation:
          typeof update === "function" ? update(value.navigation) : update,
      })),
    [],
  );
  const togglePanel = (panel: keyof PanelVisibility) => {
    const next = { ...chromeRef.current, [panel]: !chromeRef.current[panel] };
    if (surface === "workspace" && currentWritingView(next) === "focus")
      chooseWritingView("focus");
    else {
      api.current?.exitMaximizedGroup();
      setChrome(next);
    }
  };
  const macos = native && /Mac/.test(navigator.platform);
  useEffect(() => {
    localStorage.setItem(CHROME_KEY, JSON.stringify(chrome));
  }, [chrome]);
  const [scope, setScope] = useState<KnowledgeScope>({
    includeTags: [],
    excludeTags: [],
  });
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activePanelTitle, setActivePanelTitle] = useState("主页");
  const [activePaneKind, setActivePaneKind] = useState("home");
  const homeActive = surface === "workspace" && activePaneKind === "home";
  const showIndex = chrome.list && !homeActive;
  const inspector = chrome.details && !homeActive;
  const [activeTag, setActiveTag] = useState("");
  const [filter, setFilter] = useState("");
  const [settings, setSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState("providers");
  const compact = useMediaQuery("(max-width: 1100px)");
  const { preferences, setPreferences, dark, reducedTransparency } =
    useAppearance();
  const showSettings = (tab = "providers") => {
    setSettingsTab(tab);
    setSettings(true);
  };
  const toggleTheme = () =>
    setPreferences((value) => ({ ...value, theme: dark ? "light" : "dark" }));
  const [palette, setPalette] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [pluginCommands, setPluginCommands] = useState<PluginCommand[]>([]);
  const [toast, setToast] = useState("");
  const [name, setName] = useState("Personal space");
  const api = useRef<DockviewApi | null>(null);
  const dockCleanup = useRef<() => void>(() => {});
  useEffect(() => () => dockCleanup.current(), []);
  const openHome = useCallback(() => {
    setSurface("workspace");
    const dock = api.current;
    if (!dock) return;
    dock.exitMaximizedGroup();
    const home =
      dock.getPanel("home") ??
      dock.addPanel({
        id: "home",
        component: "home",
        title: "主页",
        params: { mode: "home" },
      });
    home.api.setActive();
    setActivePaneKind("home");
    setSelectedId(null);
  }, []);
  const chooseWritingView = useCallback((view: WritingView) => {
    setSurface("workspace");
    setChrome({ ...writingViews[view] });
    const dock = api.current;
    if (!dock) return;
    if (view === "focus") {
      const note =
        dock.panels.find(
          (panel) =>
            panel.params?.noteId === selectedRef.current &&
            ["document", "markdown"].includes(panel.params?.mode),
        ) ?? dock.activePanel;
      if (note) {
        note.api.setActive();
        if (dock.groups.length > 1) dock.maximizeGroup(note);
      }
    } else dock.exitMaximizedGroup();
  }, []);
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const notify = useCallback((text: string) => {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 6000);
  }, []);
  const refresh = useCallback(async () => {
    const hits = await listNotes();
    setNotes(hits.map((h) => h.note));
  }, []);
  useEffect(() => {
    void refresh().catch((error) => notify(safeMessage(error)));
    void bridge
      .call<{ name: string }>("vault.info")
      .then((info) => setName(info.name))
      .catch((error) => notify(safeMessage(error)));
    const timer = setInterval(() => void refresh().catch(() => {}), 5000);
    return () => {
      clearInterval(timer);
      clearTimeout(toastTimer.current);
    };
  }, [refresh, notify]);
  const revealList = () => {
    api.current?.exitMaximizedGroup();
    setChrome((value) => ({ ...value, list: true }));
    setSurface("workspace");
    if (compact) setSidebar(false);
    if (api.current?.activePanel?.params?.mode === "home") {
      const note = notesRef.current[0];
      if (note) open("document", note.id, note.title);
      else open("search");
    }
  };
  const selectView = (value: NoteView) => {
    setView(value);
    setActiveTag("");
    setFilter("");
    revealList();
  };
  const open = useCallback((kind: PaneKind, id?: string, title?: string) => {
    if (kind === "browser") {
      setSurface("browser");
      window.dispatchEvent(new Event("obryth:browser-new"));
      return;
    }
    setSurface("workspace");
    if (kind === "agent" || kind === "terminal") setInspector(false);
    const dock = api.current;
    if (!dock) return;
    if (kind === "agent" || kind === "terminal") {
      dock.exitMaximizedGroup();
      setChrome((value) =>
        currentWritingView(value) === "focus"
          ? { ...writingViews.browse }
          : { ...value, details: false },
      );
    }
    const noteId = id ?? selectedRef.current;
    const key = ["document", "markdown"].includes(kind)
      ? `note-${noteId}-${kind}`
      : `${kind}-${id ?? crypto.randomUUID()}`;
    const existing = dock.getPanel(key);
    if (existing) {
      existing.api.setActive();
      if (noteId) setSelectedId(noteId);
      return;
    }
    const panel = dock.addPanel({
      id: key,
      component: ["document", "markdown"].includes(kind) ? "note" : kind,
      title: title ?? paneNames[kind],
      params: {
        noteId,
        mode: kind,
        sessionId: kind === "agent" ? id : undefined,
      },
      ...(kind === "agent" || kind === "terminal"
        ? {
            position: {
              referencePanel: dock.activePanel?.id,
              direction: "right" as const,
            },
          }
        : {}),
    });
    panel.api.setActive();
    if (["document", "markdown"].includes(kind) && noteId)
      setSelectedId(noteId);
  }, []);
  const create = async () => {
    try {
      const note = await bridge.call<Note>("notes.save", {
        title: "未命名笔记",
        body: "",
        tags: activeTag ? [activeTag] : view === "inbox" ? ["inbox"] : [],
        kind: view === "memo" ? "memo" : "document",
      });
      await refresh();
      open("document", note.id, note.title);
    } catch (error) {
      notify(safeMessage(error));
    }
  };
  const ready = async (event: DockviewReadyEvent) => {
    dockCleanup.current();
    api.current = event.api;
    try {
      const layout = await bridge.call<unknown>("settings.get", {
        key: "workspace.layout",
      });
      if (api.current !== event.api) return;
      if (layout) {
        event.api.fromJSON(layout as Parameters<DockviewApi["fromJSON"]>[0]);
      }
    } catch (error) {
      notify(`布局恢复失败：${safeMessage(error)}`);
    }
    if (api.current !== event.api) return;
    // Replace the legacy placeholder, keeping real documents and split groups.
    event.api.getPanel("empty")?.api.close();
    openHome();
    const activeNoteId = event.api.activePanel?.params?.noteId;
    if (activeNoteId) setSelectedId(activeNoteId);
    setActivePanelTitle(event.api.activePanel?.title ?? "主页");
    setActivePaneKind(event.api.activePanel?.params?.mode ?? "home");
    if (
      currentWritingView(chromeRef.current) === "focus" &&
      event.api.groups.length > 1
    ) {
      const note = event.api.activePanel;
      if (note) event.api.maximizeGroup(note);
    }
    let timer: ReturnType<typeof setTimeout>;
    const layoutListener = event.api.onDidLayoutChange(() => {
      setActivePanelTitle(event.api.activePanel?.title ?? "主页");
      setActivePaneKind(event.api.activePanel?.params?.mode ?? "home");
      clearTimeout(timer);
      timer = setTimeout(
        () =>
          void bridge
            .call("settings.set", {
              key: "workspace.layout",
              value: event.api.toJSON(),
            })
            .catch((error) => notify(safeMessage(error))),
        500,
      );
    });
    const activeListener = event.api.onDidActivePanelChange((event) => {
      setActivePanelTitle(event.panel?.title ?? "主页");
      setActivePaneKind(event.panel?.params?.mode ?? "home");
      const noteId = event.panel?.params?.noteId;
      setSelectedId(noteId ?? null);
    });
    let disposed = false;
    const removeListener = event.api.onDidRemovePanel(() => {
      // Dockview may be clearing/rebuilding a layout: wait until that operation finishes.
      queueMicrotask(() => {
        if (
          !disposed &&
          api.current === event.api &&
          event.api.panels.length === 0
        )
          openHome();
      });
    });
    dockCleanup.current = () => {
      disposed = true;
      clearTimeout(timer);
      layoutListener.dispose();
      activeListener.dispose();
      removeListener.dispose();
    };
  };
  const split = (direction: "right" | "below") => {
    setSurface("workspace");
    setInspector(false);
    const dock = api.current;
    if (!dock?.activePanel) return;
    dock.exitMaximizedGroup();
    setChrome((value) =>
      currentWritingView(value) === "focus"
        ? { ...writingViews.browse }
        : value,
    );
    dock.addPanel({
      id: `split-${crypto.randomUUID()}`,
      component: selectedRef.current ? "note" : "home",
      title:
        notesRef.current.find((n) => n.id === selectedRef.current)?.title ??
        "主页",
      params: {
        noteId: selectedRef.current,
        mode: selectedRef.current ? "markdown" : "home",
      },
      position: { referencePanel: dock.activePanel.id, direction },
    });
  };
  const layout = (kind: string) => {
    setSurface("workspace");
    setInspector(false);
    const dock = api.current;
    if (!dock) return;
    dock.exitMaximizedGroup();
    setChrome((value) =>
      currentWritingView(value) === "focus"
        ? { ...writingViews.browse }
        : value,
    );
    const id = selectedRef.current ?? notesRef.current[0]?.id;
    if (!id) return;
    dock.clear();
    const note = dock.addPanel({
      id: `note-${id}-document`,
      component: "note",
      title: notesRef.current.find((n) => n.id === id)?.title ?? "笔记",
      params: { noteId: id, mode: kind === "dev" ? "markdown" : "document" },
    });
    if (kind === "research") {
      const browser = dock.addPanel({
        id: "research-browser",
        component: "browser",
        title: "浏览器",
        position: { referencePanel: note.id, direction: "left" },
      });
      browser.api.setSize({ width: 480 });
      dock.addPanel({
        id: "research-ai",
        component: "agent",
        title: "知识助手",
        position: { referencePanel: note.id, direction: "right" },
      });
    } else {
      const terminal = dock.addPanel({
        id: "dev-terminal",
        component: "terminal",
        title: "终端",
        position: { referencePanel: note.id, direction: "right" },
      });
      dock.addPanel({
        id: "dev-ai",
        component: "agent",
        title: "知识助手",
        position: { referencePanel: terminal.id, direction: "below" },
      });
    }
  };
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.code === "Backslash" &&
        !event.altKey &&
        !settings &&
        !palette
      ) {
        if (event.shiftKey && surface !== "workspace") return;
        event.preventDefault();
        togglePanel(event.shiftKey ? "list" : "navigation");
        return;
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        ["1", "2", "3"].includes(event.key) &&
        !settings &&
        !palette &&
        surface === "workspace"
      ) {
        event.preventDefault();
        chooseWritingView(
          ({ "1": "focus", "2": "browse", "3": "full" } as const)[
            event.key as "1" | "2" | "3"
          ],
        );
        return;
      }
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !(
          event.target instanceof Element && event.target.closest(".cm-editor")
        ) &&
        !settings &&
        !palette &&
        compact &&
        sidebar
      ) {
        setSidebar(false);
        return;
      }
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !(
          event.target instanceof Element && event.target.closest(".cm-editor")
        ) &&
        !settings &&
        !palette &&
        surface === "workspace" &&
        currentWritingView(chrome) === "focus"
      ) {
        chooseWritingView("browse");
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        setPalette((value) => !value);
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "n") {
        event.preventDefault();
        void create();
      }
      if (event.key === "Escape") {
        setPalette(false);
        setSettings(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  const tags = useMemo(
    () => Array.from(new Set(notes.flatMap((n) => n.tags))).sort(),
    [notes],
  );
  const filtered = notes
    .filter(
      (note) =>
        (!activeTag || note.tags.includes(activeTag)) &&
        (view !== "inbox" || note.tags.includes("inbox")) &&
        (view !== "pinned" || note.pinned) &&
        (view !== "memo" || note.kind === "memo") &&
        (view !== "runbook" || note.kind === "runbook") &&
        (!filter ||
          `${note.title} ${note.body}`
            .toLowerCase()
            .includes(filter.toLowerCase())),
    )
    .sort((a, b) =>
      sort === "title"
        ? a.title.localeCompare(b.title, "zh-CN")
        : sort === "created"
          ? b.createdAt.localeCompare(a.createdAt)
          : b.updatedAt.localeCompare(a.updatedAt),
    );
  const context = useMemo(
    () => ({
      notes,
      selectedId,
      refresh,
      open,
      notify,
      overlay: settings || palette || (compact && sidebar),
      surface,
      activePaneKind,
      scope,
    }),
    [
      notes,
      selectedId,
      refresh,
      open,
      notify,
      settings,
      palette,
      compact,
      sidebar,
      surface,
      activePaneKind,
      scope,
    ],
  );
  return (
    <WorkbenchContext.Provider value={context}>
      <PluginRuntime
        onCommands={setPluginCommands}
        onPanel={(id, title, html) => {
          setSurface("workspace");
          const dock = api.current;
          if (!dock) return;
          const existing = dock.getPanel(id);
          if (existing) {
            existing.api.updateParameters({ html });
            existing.api.setActive();
          } else
            dock.addPanel({ id, component: "plugin", title, params: { html } });
        }}
      />
      <div
        className={`app-shell chrome-shell ${sidebar ? "" : "sidebar-collapsed"} ${showIndex ? "" : "index-collapsed"} ${currentWritingView(chrome) === "focus" && surface === "workspace" && !homeActive ? "focus-writing" : ""} ${macos ? "macos-native" : ""} ${homeActive ? "home-active" : ""}`}
      >
        <WorkspaceTitlebar
          macos={macos}
          surface={surface}
          homeActive={homeActive}
          panels={chrome}
          toggle={togglePanel}
          view={currentWritingView(chrome)}
          chooseView={chooseWritingView}
          name={name}
          title={
            surface === "workspace"
              ? ["document", "markdown"].includes(
                  api.current?.activePanel?.params?.mode,
                )
                ? (notes.find((note) => note.id === selectedId)?.title ??
                  activePanelTitle)
                : activePanelTitle
              : surface === "knowledge"
                ? "知识库管理"
                : surface === "plugins"
                  ? "插件与扩展"
                  : "研究浏览器"
          }
          search={() => setPalette(true)}
          create={() => void create()}
          home={openHome}
          split={split}
          layout={layout}
        />
        <LibraryNavigation
          expanded={sidebar}
          name={name}
          notes={notes}
          surface={surface}
          setSurface={(value) => {
            setSurface(value);
            if (compact) setSidebar(false);
          }}
          view={view}
          selectView={selectView}
          tag={activeTag}
          selectTag={(value) => {
            setActiveTag(value === activeTag ? "" : value);
            setView("all");
            setFilter("");
            revealList();
          }}
          settings={() => showSettings()}
          appearance={() => showSettings("appearance")}
          search={() => setPalette(true)}
          collapse={() => togglePanel("navigation")}
          dark={dark}
          theme={toggleTheme}
          agent={() => {
            open("agent");
            if (compact) setSidebar(false);
          }}
          terminal={() => {
            open("terminal");
            if (compact) setSidebar(false);
          }}
        />
        {(!sidebar || compact) && (
          <NavigationRail
            surface={surface}
            activeTool={api.current?.activePanel?.params?.mode}
            view={view}
            selectView={selectView}
            setSurface={(value) => {
              setSurface(value);
              if (compact) setSidebar(false);
            }}
            search={() => setPalette(true)}
            agent={() => {
              open("agent");
              if (compact) setSidebar(false);
            }}
            terminal={() => {
              open("terminal");
              if (compact) setSidebar(false);
            }}
            settings={() => showSettings()}
            appearance={() => showSettings("appearance")}
            dark={dark}
            theme={toggleTheme}
          />
        )}
        {compact && sidebar && (
          <button
            className="navigation-scrim"
            aria-label="关闭导航浮层"
            onClick={() => setSidebar(false)}
          />
        )}
        <main className="workbench">
          {!native && (
            <div className="preview-banner">
              <span className="preview-dot" />
              浏览器预览 ·
              笔记保存在当前浏览器；终端、系统凭据与同步需使用桌面客户端。
            </div>
          )}
          <div
            className={`workspace-body ${inspector ? "with-inspector" : ""} ${showIndex ? "" : "without-index"}`}
            hidden={surface !== "workspace"}
          >
            <NoteIndex
              visible={showIndex}
              collapse={() => togglePanel("list")}
              notes={filtered}
              selected={selectedId}
              title={activeTag ? `# ${activeTag}` : viewNames[view]}
              filter={filter}
              setFilter={setFilter}
              open={(note) => open("document", note.id, note.title)}
              create={() => void create()}
              sort={sort}
              setSort={setSort}
            />
            <div className="document-workspace">
              <div className="dock-area">
                <Suspense
                  fallback={<div className="empty-pane">正在打开工作空间…</div>}
                >
                  <DockviewReact
                    components={components}
                    watermarkComponent={HomePane}
                    onReady={(event) => void ready(event)}
                    theme={themeLight}
                    className="obryth-dock"
                    disableFloatingGroups
                  />
                </Suspense>
              </div>
            </div>
            {inspector && (
              <NoteInspector
                close={() => {
                  togglePanel("details");
                }}
              />
            )}
          </div>
          {surface === "knowledge" && (
            <KnowledgeManager
              useScope={(value) => {
                setScope(value);
                open("agent");
              }}
              settings={() => showSettings()}
            />
          )}
          {surface === "plugins" && <PluginSettings standalone />}
          <div
            className="browser-workspace-host"
            hidden={surface !== "browser"}
          >
            <BrowserWorkspace />
          </div>
        </main>
        {toast && (
          <div className="toast" role="status">
            <Check size={15} />
            {toast}
            <button aria-label="关闭通知" onClick={() => setToast("")}>
              <X size={13} />
            </button>
          </div>
        )}
        {settings && (
          <Suspense>
            <Settings
              close={() => setSettings(false)}
              initialTab={settingsTab}
              appearance={preferences}
              changeAppearance={setPreferences}
              reducedTransparency={reducedTransparency}
            />
          </Suspense>
        )}
        {palette && (
          <div
            className="modal-backdrop command-backdrop"
            onMouseDown={(event) =>
              event.target === event.currentTarget && setPalette(false)
            }
          >
            <div
              className="command-palette"
              role="dialog"
              aria-label="命令面板"
            >
              <label>
                <Search size={19} />
                <input
                  autoFocus
                  placeholder="搜索笔记或命令…"
                  value={paletteQuery}
                  onChange={(event) => setPaletteQuery(event.target.value)}
                />
                <kbd onClick={() => setPalette(false)}>esc</kbd>
              </label>
              <div className="command-results">
                {pluginCommands
                  .filter(
                    (command) =>
                      !paletteQuery || command.title.includes(paletteQuery),
                  )
                  .map((command) => (
                    <button
                      key={command.id}
                      onClick={() => {
                        command.run();
                        setPalette(false);
                      }}
                    >
                      <Command size={14} />
                      {command.title}
                    </button>
                  ))}
                {[
                  { label: "返回主页", icon: Home, run: openHome },
                  { label: "新建笔记", icon: Plus, run: create },
                  {
                    label: "专注写作 · ⌘1",
                    icon: FileText,
                    run: () => chooseWritingView("focus"),
                  },
                  {
                    label: "列表与编辑器 · ⌘2",
                    icon: Columns2,
                    run: () => chooseWritingView("browse"),
                  },
                  {
                    label: "完整布局 · ⌘3",
                    icon: PanelLeft,
                    run: () => chooseWritingView("full"),
                  },
                  {
                    label: "搜索知识库",
                    icon: Search,
                    run: () => open("search"),
                  },
                  {
                    label: "打开终端",
                    icon: TerminalSquare,
                    run: () => open("terminal"),
                  },
                  {
                    label: "知识助手",
                    icon: Sparkles,
                    run: () => open("agent"),
                  },
                  {
                    label: "研究浏览器",
                    icon: Globe,
                    run: () => open("browser"),
                  },
                  {
                    label: "设置与 API 服务",
                    icon: Settings2,
                    run: () => showSettings(),
                  },
                ]
                  .filter(
                    (c) => !paletteQuery || c.label.includes(paletteQuery),
                  )
                  .map((command) => (
                    <button
                      key={command.label}
                      onClick={() => {
                        void command.run();
                        setPalette(false);
                      }}
                    >
                      <command.icon size={16} />
                      {command.label}
                      <Command size={12} />
                    </button>
                  ))}
                {notes
                  .filter(
                    (note) =>
                      !paletteQuery ||
                      `${note.title} ${note.body}`
                        .toLowerCase()
                        .includes(paletteQuery.toLowerCase()),
                  )
                  .slice(0, 12)
                  .map((note) => (
                    <button
                      key={note.id}
                      onClick={() => {
                        open("document", note.id, note.title);
                        setPalette(false);
                      }}
                    >
                      <FileText size={16} />
                      {note.title}
                      <ArrowUpRight size={13} />
                    </button>
                  ))}
              </div>
              <footer>
                ⌘ N 新建笔记<span>Esc 关闭</span>
              </footer>
            </div>
          </div>
        )}
      </div>
    </WorkbenchContext.Provider>
  );
}
