import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { IDockviewPanelProps } from "dockview-react";
import type { TerminalPage } from "@obryth/contracts";
import { bridge, native, safeMessage } from "../lib/bridge";
import { useWorkbench } from "../lib/workbench";
import {
  TerminalSquare,
  Play,
  Copy,
  Square,
  Save,
  Settings2,
  X,
} from "lucide-react";
import "@xterm/xterm/css/xterm.css";
import { terminalFeed } from "../lib/terminal-feed";
import {
  loadTerminalFont,
  resolveTerminalTheme,
  terminalFontFamily,
  terminalThemes,
  useTerminalEnvironment,
  useTerminalPreferences,
} from "../lib/terminal-appearance";
import { TerminalTypography } from "./TerminalSettings";
export function TerminalPane(
  props: IDockviewPanelProps<{ sessionId?: string }>,
) {
  const workbench = useWorkbench();
  const host = useRef<HTMLDivElement>(null);
  const [sessionId, setSessionId] = useState(props.params.sessionId ?? "");
  const [status, setStatus] = useState("未启动");
  const [starting, setStarting] = useState(false);
  const [fontSettings, setFontSettings] = useState(false);
  const { preferences, change } = useTerminalPreferences();
  const environment = useTerminalEnvironment();
  const appearance = resolveTerminalTheme(preferences, environment);
  const appearanceRef = useRef({ preferences, appearance });
  appearanceRef.current = { preferences, appearance };
  const refit = useRef<() => void>(() => {});
  const selection = useRef("");
  const terminalRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const start = async () => {
    if (starting || !native) return;
    setStarting(true);
    try {
      const info = await bridge.call<{ root: string }>("vault.info");
      const session = await bridge.call<{ id: string }>(
        "agent.terminal.create",
        { title: "Shell", workspace: info.root, size: { cols: 100, rows: 30 } },
      );
      props.api.updateParameters({ sessionId: session.id });
      setSessionId(session.id);
    } catch (error) {
      setStatus(safeMessage(error));
    } finally {
      setStarting(false);
    }
  };
  useEffect(() => {
    const term = terminalRef.current;
    if (!term) return;
    term.options.theme = appearance.colors;
    term.options.lineHeight = preferences.lineHeight;
    let active = true;
    void loadTerminalFont(preferences.font, preferences.fontSize)
      .catch(() => {})
      .then(() => {
        if (!active || terminalRef.current !== term) return;
        term.options.fontFamily = terminalFontFamily(preferences.font);
        term.options.fontSize = preferences.fontSize;
        refit.current();
      });
    return () => {
      active = false;
    };
  }, [
    preferences,
    environment.dark,
    environment.glass,
    environment.reducedTransparency,
    environment.palette,
  ]);
  useEffect(() => {
    if (!sessionId || !host.current) return;
    let active = true;
    let destroy = () => {};
    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      const initialFont = appearanceRef.current.preferences;
      await loadTerminalFont(initialFont.font, initialFont.fontSize).catch(
        () => {},
      );
      if (!active || !host.current) return;
      const term = new Terminal({
        fontFamily: terminalFontFamily(appearanceRef.current.preferences.font),
        fontSize: appearanceRef.current.preferences.fontSize,
        allowTransparency: true,
        lineHeight: appearanceRef.current.preferences.lineHeight,
        scrollback: 5000,
        allowProposedApi: false,
        theme: appearanceRef.current.appearance.colors,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(host.current);
      fit.fit();
      terminalRef.current = term;
      let inputQueue = Promise.resolve();
      let inputFailed = false;
      const input = term.onData((data) => {
        if (inputFailed) return;
        const bytes = new TextEncoder().encode(data);
        inputQueue = inputQueue
          .then(async () => {
            if (inputFailed || !active) return;
            for (let offset = 0; offset < bytes.length; offset += 8192) {
              let binary = "";
              for (const byte of bytes.subarray(offset, offset + 8192))
                binary += String.fromCharCode(byte);
              await bridge.call("agent.terminal.input", {
                id: sessionId,
                dataB64: btoa(binary),
              });
            }
          })
          .catch((error) => {
            inputFailed = true;
            setStatus("输入未确认，请重新关联会话；未发送的输入不会重放");
            workbench.notify(safeMessage(error));
          });
      });
      const selected = term.onSelectionChange(() => {
        selection.current = term.getSelection();
      });
      let resizeTimer: ReturnType<typeof setTimeout>;
      const resize = () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          if (!active || !props.api.isVisible) return;
          fit.fit();
          void bridge
            .call("agent.terminal.resize", {
              id: sessionId,
              size: {
                cols: Math.max(20, Math.min(500, term.cols)),
                rows: Math.max(5, Math.min(300, term.rows)),
              },
            })
            .catch((error) => setStatus(safeMessage(error)));
        }, 100);
      };
      const observer = new ResizeObserver(resize);
      refit.current = resize;
      observer.observe(host.current);
      const visibility = props.api.onDidVisibilityChange(resize);
      resize();
      let feed: Awaited<ReturnType<typeof terminalFeed>> | null = null;
      destroy = () => {
        feed?.close();
        clearTimeout(resizeTimer);
        observer.disconnect();
        visibility.dispose();
        input.dispose();
        selected.dispose();
        term.dispose();
        terminalRef.current = null;
        refit.current = () => {};
      };
      const write = (dataB64: string) =>
        new Promise<void>((resolve) => {
          if (!active) {
            resolve();
            return;
          }
          const data = Uint8Array.from(atob(dataB64), (c) => c.charCodeAt(0));
          term.write(data, resolve);
        });
      let seq = 0;
      try {
        const snapshot = await bridge.call<{
          seq: number;
          dataB64: string;
        } | null>("agent.terminal.snapshot", { id: sessionId });
        if (!active) return;
        if (snapshot) {
          await write(snapshot.dataB64);
          seq = snapshot.seq;
        }
        setStatus("已连接");
        if (native) {
          feed = await terminalFeed(sessionId, seq);
          if (!active) {
            feed.close();
            return;
          }
        }
        while (active) {
          if (!props.api.isVisible) {
            await new Promise((resolve) => setTimeout(resolve, 200));
            continue;
          }
          const page = feed
            ? await feed.next()
            : await bridge.call<TerminalPage>("agent.terminal.output", {
                id: sessionId,
                afterSeq: seq,
                waitMs: 1000,
              });
          if (!active) break;
          if (page.resyncRequired) {
            const snapshot = await bridge.call<{
              seq: number;
              dataB64: string;
            } | null>("agent.terminal.snapshot", { id: sessionId });
            if (!snapshot) throw new Error("终端需要重新同步，快照暂不可用");
            term.reset();
            await write(snapshot.dataB64);
            seq = snapshot.seq;
            if (feed) {
              await feed.ack();
              feed.close();
              feed = await terminalFeed(sessionId, seq);
            }
            continue;
          }
          for (const event of page.events) {
            if (!active) break;
            if (event.type === "output") await write(event.dataB64);
          }
          seq = page.nextSeq;
          if (feed) await feed.ack();
          if (page.exited) {
            setStatus(`会话已结束 · ${page.exitCode ?? "未知退出码"}`);
            break;
          }
        }
      } catch (error) {
        if (active) setStatus(safeMessage(error));
      }
    })().catch((error) => {
      if (active) setStatus(safeMessage(error));
    });
    return () => {
      active = false;
      destroy();
    };
  }, [sessionId]);
  const capture = async () => {
    const body =
      selection.current ||
      terminalRef.current?.buffer.active
        .getLine(terminalRef.current.buffer.active.cursorY)
        ?.translateToString() ||
      "";
    if (!body) {
      workbench.notify("请先选择终端输出");
      return;
    }
    const note = await bridge.call<{ id: string }>("notes.save", {
      title: "终端摘录",
      body: `\`\`\`text\n${body.replace(/```/g, "``\u200b`")}\n\`\`\`\n`,
      tags: ["terminal"],
      kind: "runbook",
    });
    await workbench.refresh();
    workbench.open("document", note.id, "终端摘录");
  };
  return (
    <div
      className={`terminal-pane ${appearance.glass ? "terminal-glass" : ""}`}
      data-terminal-theme={preferences.theme}
      style={
        {
          "--terminal-surface": appearance.surface,
          "--terminal-foreground": appearance.foreground,
          "--terminal-accent": appearance.accent,
          "--terminal-font": terminalFontFamily(preferences.font),
          "--terminal-font-size": `${preferences.fontSize}px`,
          "--terminal-line-height": preferences.lineHeight,
          colorScheme: appearance.dark ? "dark" : "light",
        } as CSSProperties
      }
    >
      <div className="pane-toolbar">
        <TerminalSquare size={14} />
        <span>TERMINAL</span>
        <span className="grow" />
        <span className="terminal-status" role="status">
          {sessionId ? status : "本地 Shell"}
        </span>
        <select
          aria-label="终端主题"
          value={preferences.theme}
          onChange={(event) =>
            change({ theme: event.target.value as typeof preferences.theme })
          }
        >
          {terminalThemes.map((theme) => (
            <option key={theme.id} value={theme.id}>
              {theme.name}
            </option>
          ))}
        </select>
        <button
          className="icon-button"
          aria-label="终端字体设置"
          title="终端字体设置"
          aria-expanded={fontSettings}
          onClick={() => setFontSettings((value) => !value)}
        >
          <Settings2 size={14} />
        </button>
        <button
          className="icon-button"
          title="保存选区为笔记"
          aria-label="保存终端选区"
          onClick={() =>
            void capture().catch((error) =>
              workbench.notify(safeMessage(error)),
            )
          }
        >
          <Save size={14} />
        </button>
        <button
          className="icon-button"
          aria-label="复制终端选区"
          onClick={() => void navigator.clipboard.writeText(selection.current)}
        >
          <Copy size={14} />
        </button>
        {sessionId && (
          <button
            className="icon-button"
            aria-label="结束终端"
            onClick={() => {
              if (window.confirm("结束终端进程？关闭面板本身不会结束它。"))
                void bridge
                  .call("agent.terminal.close", { id: sessionId })
                  .then(() => setStatus("会话已结束"));
            }}
          >
            <Square size={12} />
          </button>
        )}
      </div>
      {fontSettings && (
        <section className="terminal-font-popover" aria-label="终端字体设置">
          <header>
            <strong>字体与排版</strong>
            <button
              className="icon-button"
              aria-label="关闭终端字体设置"
              onClick={() => setFontSettings(false)}
            >
              <X size={14} />
            </button>
          </header>
          <TerminalTypography />
        </section>
      )}
      {!sessionId ? (
        <div className="empty-pane">
          <TerminalSquare size={30} />
          <h3>在思考旁边，运行你的工具</h3>
          <p>
            {native
              ? "在当前知识库目录启动 Shell，随时把输出保存为笔记。"
              : "真实终端需要桌面客户端。预览中的分屏与笔记可以正常使用。"}
          </p>
          <div className="terminal-welcome-preview" aria-label="终端外观预览">
            <span>
              ~/obryth <b>on</b> main
            </span>
            <span>
              <b>❯</b> echo "Hello, Obryth"
            </span>
            <span>Hello, Obryth</span>
            <small>JetBrains Mono · {preferences.fontSize} px</small>
          </div>
          <button
            className="primary-button"
            disabled={starting || !native}
            onClick={() => void start()}
          >
            <Play size={14} />
            {starting ? "启动中…" : "启动终端"}
          </button>
          {status !== "未启动" && <p className="error-message">{status}</p>}
        </div>
      ) : (
        <div className="xterm-host" ref={host} />
      )}
    </div>
  );
}
