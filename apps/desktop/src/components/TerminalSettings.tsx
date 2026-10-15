import { Check, Type } from "lucide-react";
import type { CSSProperties } from "react";
import {
  resolveTerminalTheme,
  terminalFontFamily,
  terminalThemes,
  useTerminalEnvironment,
  useTerminalPreferences,
} from "../lib/terminal-appearance";

export function TerminalTypography() {
  const { preferences, change } = useTerminalPreferences();
  return (
    <div className="terminal-typography">
      <label>
        <span>终端字体</span>
        <select
          aria-label="终端字体"
          value={preferences.font}
          onChange={(event) =>
            change({ font: event.target.value as "mono" | "nerd" })
          }
        >
          <option value="mono">JetBrains Mono</option>
          <option value="nerd">JetBrains Mono Nerd Font</option>
        </select>
      </label>
      <label>
        <span>
          字号 <output>{preferences.fontSize} px</output>
        </span>
        <input
          aria-label="终端字号"
          type="range"
          min="11"
          max="20"
          step="1"
          value={preferences.fontSize}
          onChange={(event) => change({ fontSize: Number(event.target.value) })}
        />
      </label>
      <label>
        <span>
          行距 <output>{preferences.lineHeight.toFixed(2)} 倍</output>
        </span>
        <input
          aria-label="终端行距"
          type="range"
          min="1.2"
          max="2"
          step="0.05"
          value={preferences.lineHeight}
          onChange={(event) =>
            change({ lineHeight: Number(event.target.value) })
          }
        />
      </label>
      <p>字体随应用内置，离线可用。Nerd Font 支持 Shell 提示符图标。</p>
    </div>
  );
}
export function TerminalSettings() {
  const { preferences, change } = useTerminalPreferences();
  const environment = useTerminalEnvironment();
  return (
    <div className="terminal-settings">
      <h3>终端主题</h3>
      <p>在所有终端中即时生效，保留正在运行的会话。</p>
      <div
        className="terminal-theme-grid"
        role="group"
        aria-label="终端主题方案"
      >
        {terminalThemes.map((theme) => {
          const preview = resolveTerminalTheme(
            { ...preferences, theme: theme.id },
            environment,
          );
          return (
            <button
              key={theme.id}
              aria-label={theme.name}
              aria-pressed={preferences.theme === theme.id}
              onClick={() => change({ theme: theme.id })}
            >
              <span
                className={`terminal-theme-preview ${preview.glass ? "is-glass" : ""}`}
                style={
                  {
                    "--terminal-surface": preview.surface,
                    "--terminal-foreground": preview.foreground,
                    "--terminal-accent": preview.accent,
                  } as CSSProperties
                }
              >
                <span>
                  ~/obryth <b>on</b> main
                </span>
                <span>
                  <b>❯</b> echo hello
                  <span className="terminal-preview-cursor" />
                </span>
                <span className="terminal-palette">
                  {[
                    preview.colors.red,
                    preview.colors.green,
                    preview.colors.yellow,
                    preview.colors.blue,
                    preview.colors.magenta,
                    preview.colors.cyan,
                  ].map((color) => (
                    <i key={color} style={{ background: color }} />
                  ))}
                </span>
              </span>
              <span className="terminal-theme-name">
                {theme.name}
                {preferences.theme === theme.id && <Check size={13} />}
              </span>
              <small>{theme.detail}</small>
            </button>
          );
        })}
      </div>
      {environment.reducedTransparency && (
        <p role="status">
          已遵循系统的减少透明度或增强对比度设置，玻璃主题暂以实色显示。
        </p>
      )}
      <h3 className="terminal-font-heading">
        <Type size={16} />
        字体与排版
      </h3>
      <TerminalTypography />
      <pre
        className="terminal-font-sample"
        style={{
          fontFamily: terminalFontFamily(preferences.font),
          fontSize: preferences.fontSize,
          lineHeight: preferences.lineHeight,
        }}
      >
        0O 1lI =&gt; != ~/obryth{"\n"}
        <strong>JetBrains Mono</strong> · <em>让思考保持流动</em>
      </pre>
    </div>
  );
}
