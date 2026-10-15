import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Globe,
  Link,
  Code2,
  Download,
  ExternalLink,
} from "lucide-react";
import type { IDockviewPanelProps } from "dockview-react";
import { native, safeMessage, bridge } from "../lib/bridge";
import { useWorkbench } from "../lib/workbench";
export function BrowserPane(
  props: IDockviewPanelProps<{ url?: string; owner?: string }>,
) {
  const workbench = useWorkbench();
  const [url, setUrl] = useState(props.params.url ?? "");
  const [launchUrl, setLaunchUrl] = useState(props.params.url ?? "");
  const visibleInWorkspace =
    props.params.owner === "browser"
      ? workbench.surface === "browser"
      : workbench.surface === "workspace";
  const [error, setError] = useState("");
  const [imports, setImports] = useState<
    { id: string; host: string; count: number }[] | null
  >(null);
  const [script, setScript] = useState<string | null>(null);
  const [scriptHost, setScriptHost] = useState("");
  const host = useRef<HTMLDivElement>(null);
  const label = useRef(`browser-${crypto.randomUUID()}`);
  const created = useRef(false);
  const overlay = useRef(workbench.overlay);
  overlay.current =
    workbench.overlay ||
    !visibleInWorkspace ||
    imports !== null ||
    script !== null;
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        visibleInWorkspace &&
        props.api.isActive &&
        (event.metaKey || event.ctrlKey) &&
        event.key === "l"
      ) {
        event.preventDefault();
        const field =
          host.current?.parentElement?.querySelector<HTMLInputElement>(
            'input[aria-label="网页地址"]',
          );
        field?.focus();
        field?.select();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [visibleInWorkspace, props.api]);
  const navigate = async () => {
    try {
      let target = url.trim();
      if (!target) return;
      if (!/^[a-z][a-z\d+.-]*:\/\//i.test(target))
        target =
          !/\s/.test(target) && (/[.:]/.test(target) || target === "localhost")
            ? `${/^(localhost|127\.|\[::1\])/.test(target) ? "http" : "https"}://${target}`
            : `https://www.bing.com/search?q=${encodeURIComponent(target)}`;
      const parsed = new URL(target);
      if (!["http:", "https:"].includes(parsed.protocol))
        throw new Error("只支持 HTTP 与 HTTPS 网页");
      if (!native || !created.current) setLaunchUrl(parsed.href);
      else
        await invoke("browser_navigate", {
          label: label.current,
          url: parsed.href,
        });
      props.api.updateParameters({ url: parsed.href });
      props.api.setTitle(parsed.hostname.replace(/^www\./, ""));
      window.dispatchEvent(new Event("obryth:browser-pages-changed"));
      setUrl(parsed.href);
      setError("");
    } catch (error) {
      setError(safeMessage(error));
    }
  };
  useEffect(() => {
    if (!native) return;
    let disposed = false;
    const subscription = listen<{ label: string; url: string; title: string }>(
      "obryth-browser-state",
      (event) => {
        if (disposed || event.payload.label !== label.current) return;
        setUrl(event.payload.url);
        props.api.updateParameters({ url: event.payload.url });
        props.api.setTitle(
          event.payload.title || new URL(event.payload.url).hostname,
        );
        window.dispatchEvent(new Event("obryth:browser-pages-changed"));
      },
    );
    return () => {
      disposed = true;
      void subscription.then((unlisten) => unlisten());
    };
  }, []);
  useEffect(() => {
    if (!native || !host.current || !launchUrl) return;
    const childLabel = `browser-${crypto.randomUUID()}`;
    label.current = childLabel;
    created.current = false;
    let active = true;
    let ready = false;
    const bounds = () => {
      const rect = host.current!.getBoundingClientRect();
      return {
        x: rect.left,
        y: rect.top,
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height),
        visible:
          props.api.isVisible &&
          !overlay.current &&
          rect.width > 0 &&
          rect.height > 0,
      };
    };
    let chain = Promise.resolve();
    const resize = () => {
      if (!ready || !active) return;
      chain = chain
        .then(() =>
          invoke<void>("browser_bounds", {
            label: childLabel,
            bounds: bounds(),
          }),
        )
        .catch((error) => {
          if (active) setError(safeMessage(error));
        });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host.current);
    const visibility = props.api.onDidVisibilityChange(resize);
    window.addEventListener("resize", resize);
    const timer = setInterval(resize, 500);
    void invoke("browser_create", {
      label: childLabel,
      url: launchUrl,
      bounds: bounds(),
    })
      .then(() => {
        ready = true;
        if (!active) return invoke("browser_close", { label: childLabel });
        created.current = true;
        resize();
      })
      .catch((error) => active && setError(safeMessage(error)));
    return () => {
      active = false;
      clearInterval(timer);
      observer.disconnect();
      visibility.dispose();
      window.removeEventListener("resize", resize);
      if (label.current === childLabel) created.current = false;
      if (ready) void invoke("browser_close", { label: childLabel });
    };
  }, [launchUrl]);
  useEffect(() => {
    if (native && created.current && host.current) {
      const rect = host.current.getBoundingClientRect();
      void invoke("browser_bounds", {
        label: label.current,
        bounds: {
          x: rect.left,
          y: rect.top,
          width: Math.max(1, rect.width),
          height: Math.max(1, rect.height),
          visible:
            props.api.isVisible &&
            visibleInWorkspace &&
            rect.width > 0 &&
            rect.height > 0 &&
            !workbench.overlay &&
            !imports &&
            script === null,
        },
      });
    }
  }, [workbench.overlay, imports, script, visibleInWorkspace]);
  const action = async (action: string) => {
    try {
      const result = await invoke<{ id?: string; title?: string }>(
        "browser_action",
        { label: label.current, action },
      );
      if (result?.id) {
        await workbench.refresh();
        workbench.open("document", result.id, result.title ?? "网页剪藏");
      }
    } catch (error) {
      setError(safeMessage(error));
    }
  };
  return (
    <div className="browser-pane">
      <form
        className="browser-toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          void navigate();
        }}
      >
        <button
          type="button"
          aria-label="后退"
          onClick={() => void action("back")}
        >
          <ArrowLeft size={14} />
        </button>
        <button
          type="button"
          aria-label="前进"
          onClick={() => void action("forward")}
        >
          <ArrowRight size={14} />
        </button>
        <button
          type="button"
          aria-label="刷新网页"
          onClick={() => void action("reload")}
        >
          <RotateCw size={13} />
        </button>
        <label>
          <Globe size={13} />
          <input
            aria-label="网页地址"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <button
          title="剪藏选区"
          aria-label="剪藏选区"
          type="button"
          onClick={() => void action("clip")}
        >
          <Link size={14} />
        </button>
        <button
          title="站点脚本"
          aria-label="站点脚本"
          type="button"
          onClick={() => {
            try {
              setScriptHost(new URL(url).hostname);
              void bridge
                .call<{ host: string; code: string }[] | null>("settings.get", {
                  key: "browser.scripts",
                })
                .then((list) =>
                  setScript(
                    list?.find((item) => item.host === new URL(url).hostname)
                      ?.code ?? "",
                  ),
                );
            } catch (error) {
              setError(safeMessage(error));
            }
          }}
        >
          <Code2 size={14} />
        </button>
        <button
          title="导入登录态"
          aria-label="导入登录态"
          type="button"
          onClick={() =>
            void invoke<typeof imports>("browser_imports")
              .then(setImports)
              .catch((error) => setError(safeMessage(error)))
          }
        >
          <Download size={14} />
        </button>
      </form>
      {error && (
        <div className="inline-error">
          {error}
          <button onClick={() => setError("")}>关闭</button>
        </div>
      )}
      <div ref={host} className="browser-surface">
        {!launchUrl ? (
          <div className="browser-start">
            <span className="browser-start-icon">
              <Globe size={30} />
            </span>
            <h1>从好奇，开始探索</h1>
            <p>搜索、阅读、剪藏，让发现成为你的知识。</p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void navigate();
              }}
            >
              <Globe size={17} />
              <input
                aria-label="开始浏览地址"
                placeholder="搜索或输入网址…"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
              />
              <button type="submit" aria-label="打开网页">
                <ArrowRight size={17} />
              </button>
            </form>
            <div className="browser-shortcuts">
              {[
                { name: "GitHub", url: "https://github.com", icon: "G" },
                {
                  name: "MDN Web Docs",
                  url: "https://developer.mozilla.org",
                  icon: "M",
                },
                {
                  name: "Wikipedia",
                  url: "https://en.wikipedia.org",
                  icon: "W",
                },
              ].map((site) => (
                <button
                  key={site.name}
                  onClick={() => {
                    setUrl(site.url);
                    setLaunchUrl(site.url);
                    props.api.updateParameters({ url: site.url });
                    props.api.setTitle(site.name);
                    window.dispatchEvent(
                      new Event("obryth:browser-pages-changed"),
                    );
                  }}
                >
                  <span>{site.icon}</span>
                  {site.name}
                </button>
              ))}
            </div>
            <small>在同一个工作空间，连接阅读与思考。</small>
          </div>
        ) : (
          !native && (
            <div className="empty-pane">
              <Globe size={32} />
              <h3>把阅读，放进工作区</h3>
              <p>
                桌面客户端使用隔离的系统 WebView 打开网页。当前为浏览器预览。
              </p>
              <button
                className="primary-button"
                onClick={() =>
                  window.open(launchUrl, "_blank", "noopener,noreferrer")
                }
              >
                <ExternalLink size={14} />
                在浏览器打开
              </button>
            </div>
          )
        )}
      </div>
      {imports && (
        <div className="browser-sheet">
          <h3>导入登录态</h3>
          <p>
            在 Chrome / Edge 的 Obryth 扩展中按站点授权，然后选择导入。分区
            Cookie 会跳过。
          </p>
          {imports.length ? (
            imports.map((item) => (
              <div key={item.id}>
                <strong>{item.host}</strong> · {item.count} 个 Cookie{" "}
                <button
                  onClick={() =>
                    void invoke<{ imported: number; skipped: number }>(
                      "browser_import",
                      { label: label.current, id: item.id },
                    )
                      .then((result) => {
                        workbench.notify(
                          `已导入 ${result.imported}，跳过 ${result.skipped}`,
                        );
                        setImports(null);
                      })
                      .catch((error) => setError(safeMessage(error)))
                  }
                >
                  导入当前浏览器
                </button>
              </div>
            ))
          ) : (
            <p>暂无待导入项。</p>
          )}
          <button onClick={() => setImports(null)}>关闭</button>
        </div>
      )}
      {script !== null && (
        <div className="browser-sheet">
          <h3>{scriptHost} · 用户脚本</h3>
          <p>脚本会在该主机的页面加载时运行，仅对该主机启用。</p>
          <textarea
            aria-label="用户脚本代码"
            className="script-editor"
            value={script}
            onChange={(event) => setScript(event.target.value)}
          />
          <button
            className="primary-button"
            onClick={() =>
              void invoke("browser_script", { host: scriptHost, code: script })
                .then(() => {
                  setScript(null);
                  workbench.notify("脚本已保存，重新打开浏览器面板后生效");
                })
                .catch((error) => setError(safeMessage(error)))
            }
          >
            保存脚本
          </button>
          <button onClick={() => setScript(null)}>取消</button>
        </div>
      )}
    </div>
  );
}
