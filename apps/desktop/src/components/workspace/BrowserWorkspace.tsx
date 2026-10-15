import { useEffect, useRef, useState } from "react";
import {
  DockviewReact,
  themeLight,
  type DockviewApi,
  type DockviewReadyEvent,
} from "dockview-react";
import {
  ChevronDown,
  FileText,
  Globe,
  Link,
  Pin,
  Plus,
  Search,
  X,
} from "lucide-react";
import { BrowserPane } from "../BrowserPane";
import { bridge, safeMessage } from "../../lib/bridge";
import { useWorkbench } from "../../lib/workbench";
const components = { browser: BrowserPane };
type Page = { id: string; title: string; url: string; pinned: boolean };
export function BrowserWorkspace() {
  const w = useWorkbench();
  const dock = useRef<DockviewApi | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [active, setActive] = useState("");
  const [query, setQuery] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const snapshot = () => {
    const api = dock.current;
    if (!api) return;
    setPages(
      api.panels.map((p) => ({
        id: p.id,
        title: p.title ?? "新标签页",
        url: p.params?.url ?? "",
        pinned: p.params?.pinned ?? false,
      })),
    );
    setActive(api.activePanel?.id ?? "");
  };
  const add = () => {
    const api = dock.current;
    if (!api) return;
    const panel = api.addPanel({
      id: `page-${crypto.randomUUID()}`,
      component: "browser",
      title: "新标签页",
      params: { url: "", owner: "browser" },
    });
    panel.api.setActive();
    snapshot();
  };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        w.surface === "browser" &&
        (event.metaKey || event.ctrlKey) &&
        event.key === "t"
      ) {
        event.preventDefault();
        add();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [w.surface]);
  useEffect(() => {
    const changed = () => {
      snapshot();
      if (dock.current)
        void bridge
          .call("settings.set", {
            key: "browser.layout",
            value: dock.current.toJSON(),
          })
          .catch((error) => w.notify(safeMessage(error)));
    };
    window.addEventListener("obryth:browser-new", add);
    window.addEventListener("obryth:browser-pages-changed", changed);
    return () => {
      window.removeEventListener("obryth:browser-new", add);
      window.removeEventListener("obryth:browser-pages-changed", changed);
      clearTimeout(timer.current);
    };
  }, []);
  const ready = async (event: DockviewReadyEvent) => {
    dock.current = event.api;
    try {
      const layout = await bridge.call<unknown>("settings.get", {
        key: "browser.layout",
      });
      if (layout)
        event.api.fromJSON(layout as Parameters<DockviewApi["fromJSON"]>[0]);
    } catch (error) {
      w.notify(safeMessage(error));
    }
    if (!event.api.panels.length) add();
    snapshot();
    event.api.onDidActivePanelChange(snapshot);
    event.api.onDidLayoutChange(() => {
      snapshot();
      clearTimeout(timer.current);
      timer.current = setTimeout(
        () =>
          void bridge
            .call("settings.set", {
              key: "browser.layout",
              value: event.api.toJSON(),
            })
            .catch((error) => w.notify(safeMessage(error))),
        400,
      );
    });
  };
  const clips = w.notes.filter((note) => !!note.source);
  return (
    <div className="browser-manager">
      <aside className="browser-page-list">
        <header>
          <Globe size={15} />
          <strong>浏览空间</strong>
          <button aria-label="新建浏览器页面" onClick={add}>
            <Plus size={16} />
          </button>
        </header>
        <button className="browser-add-page" onClick={add}>
          <Plus size={14} />
          新标签页<kbd>⌘ T</kbd>
        </button>
        <label className="browser-page-search">
          <Search size={12} />
          <input
            aria-label="搜索浏览器页面"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="查找页面…"
          />
        </label>
        <div className="nav-section-heading">
          <ChevronDown size={11} />
          打开的页面<span>{pages.length}</span>
        </div>
        <div className="browser-pages">
          {[...pages]
            .sort((a, b) => Number(b.pinned) - Number(a.pinned))
            .filter((page) =>
              `${page.title} ${page.url}`
                .toLowerCase()
                .includes(query.toLowerCase()),
            )
            .map((page) => (
              <div
                className={`browser-page-row ${active === page.id ? "active" : ""}`}
                key={page.id}
              >
                <button
                  className="browser-select-page"
                  title={page.url || "新标签页"}
                  onClick={() =>
                    dock.current?.getPanel(page.id)?.api.setActive()
                  }
                >
                  <Globe size={14} />
                  <span>
                    <strong>{page.title}</strong>
                    <small>
                      {page.url
                        ? new URL(page.url).hostname
                        : "开始一次新的探索"}
                    </small>
                  </span>
                </button>
                <button
                  className={`page-pin ${page.pinned ? "pinned" : ""}`}
                  aria-label={page.pinned ? "取消固定页面" : "固定页面"}
                  onClick={() => {
                    dock.current
                      ?.getPanel(page.id)
                      ?.api.updateParameters({ pinned: !page.pinned });
                    snapshot();
                    void bridge.call("settings.set", {
                      key: "browser.layout",
                      value: dock.current?.toJSON(),
                    });
                  }}
                >
                  <Pin size={11} />
                </button>
                <button
                  aria-label={`关闭页面 ${page.title}`}
                  onClick={() => {
                    dock.current?.getPanel(page.id)?.api.close();
                    if (!dock.current?.panels.length) add();
                    snapshot();
                  }}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
        </div>
        <div className="browser-clips">
          <div className="nav-section-heading">
            <Link size={11} />
            已剪藏到笔记<span>{clips.length}</span>
          </div>
          {clips.slice(0, 8).map((note) => (
            <button
              key={note.id}
              onClick={() => w.open("document", note.id, note.title)}
            >
              <FileText size={13} />
              <span>{note.title}</span>
            </button>
          ))}
          {!clips.length && (
            <p>阅读网页时，选中内容并点击剪藏，即可保存到笔记。</p>
          )}
        </div>
      </aside>
      <div className="browser-dock">
        <DockviewReact
          components={components}
          onReady={(event) => void ready(event)}
          theme={themeLight}
          className="obryth-dock browser-pages-dock"
          disableFloatingGroups
        />
      </div>
    </div>
  );
}
