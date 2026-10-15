import { useEffect, useState, type CSSProperties } from "react";
import {
  Check,
  Monitor,
  Moon,
  Sun,
  Sparkles,
  Square,
  Laptop,
} from "lucide-react";
import type { AppearancePreferences } from "../lib/appearance";
import { accentPresets, DEFAULT_ACCENT, normalizeAccent } from "../lib/accent";
import { native } from "../lib/bridge";

export function AppearanceSettings(props: {
  preferences: AppearancePreferences;
  change: (preferences: AppearancePreferences) => void;
  reducedTransparency: boolean;
}) {
  const macos = native && /Mac/.test(navigator.platform);
  const [hex, setHex] = useState(props.preferences.accentColor.toUpperCase());
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setHex(props.preferences.accentColor.toUpperCase());
    setInvalid(false);
  }, [props.preferences.accentColor]);
  const chooseAccent = (accentColor: string) => {
    setHex(accentColor.toUpperCase());
    setInvalid(false);
    props.change({ ...props.preferences, accentColor });
  };
  const commitHex = () => {
    const color = normalizeAccent(hex);
    if (color) chooseAccent(color);
    else setInvalid(true);
  };
  return (
    <div className="appearance-settings">
      <section>
        <h3>主题</h3>
        <p>跟随系统，或选择你习惯的明暗外观。</p>
        <div className="appearance-options" role="group" aria-label="主题">
          {(
            [
              { id: "system", label: "跟随系统", Icon: Monitor },
              { id: "light", label: "浅色", Icon: Sun },
              { id: "dark", label: "深色", Icon: Moon },
            ] as const
          ).map(({ id, label, Icon }) => (
            <button
              key={id}
              aria-pressed={props.preferences.theme === id}
              onClick={() => props.change({ ...props.preferences, theme: id })}
            >
              <Icon size={20} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </section>
      <section aria-labelledby="accent-heading">
        <div className="accent-heading">
          <h3 id="accent-heading">主题色</h3>
          <button
            className="text-link"
            onClick={() => chooseAccent(DEFAULT_ACCENT)}
          >
            恢复默认蓝色
          </button>
        </div>
        <p>让导航、选中状态、热力图与玻璃光感用上你喜欢的颜色。</p>
        <div className="accent-presets" role="group" aria-label="预设主题色">
          {accentPresets.map(({ name, color }) => (
            <button
              key={color}
              aria-label={name}
              aria-pressed={props.preferences.accentColor === color}
              onClick={() => chooseAccent(color)}
              style={{ "--swatch": color } as CSSProperties}
            >
              <span className="accent-swatch" aria-hidden="true" />
              <span>{name}</span>
              {props.preferences.accentColor === color && <Check size={12} />}
            </button>
          ))}
        </div>
        <div className="accent-custom">
          <label className="accent-picker">
            <input
              type="color"
              aria-label="自定义主题色"
              value={props.preferences.accentColor}
              onChange={(event) => chooseAccent(event.target.value)}
            />
            <span>自定义颜色</span>
          </label>
          <label className="accent-hex">
            <span>HEX</span>
            <input
              aria-label="主题色 HEX"
              aria-invalid={invalid}
              aria-describedby="accent-help"
              value={hex}
              spellCheck={false}
              autoComplete="off"
              maxLength={7}
              onChange={(event) => {
                setHex(event.target.value);
                setInvalid(false);
              }}
              onBlur={commitHex}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitHex();
                if (event.key === "Escape") {
                  event.stopPropagation();
                  setHex(props.preferences.accentColor.toUpperCase());
                  setInvalid(false);
                }
              }}
            />
          </label>
        </div>
        <p id="accent-help" className="appearance-note" aria-live="polite">
          {invalid
            ? "请输入有效的 3 位或 6 位 HEX 色值，例如 #3B73C4。"
            : "颜色自动保存，并适配深浅外观的对比度。HEX 输入后按 Enter 或移开焦点应用。"}
        </p>
      </section>
      <section>
        <h3>界面材质</h3>
        <p>导航、主页与右侧工作区共享材质，可与任意明暗主题搭配。</p>
        <div className="appearance-options" role="group" aria-label="界面材质">
          {(
            [
              {
                id: "auto",
                label: "自动",
                detail: "使用平台默认材质",
                Icon: Laptop,
              },
              {
                id: "solid",
                label: "实色",
                detail: "清晰、简洁的表面",
                Icon: Square,
              },
              {
                id: "glass",
                label: "Liquid Glass",
                detail: "通透的完整工作空间",
                Icon: Sparkles,
              },
            ] as const
          ).map(({ id, label, detail, Icon }) => (
            <button
              key={id}
              aria-pressed={props.preferences.material === id}
              onClick={() =>
                props.change({ ...props.preferences, material: id })
              }
            >
              <Icon size={20} />
              <span>{label}</span>
              <small>{detail}</small>
            </button>
          ))}
        </div>
        <p className="appearance-note">
          {macos
            ? "macOS 26 及以上使用原生 Liquid Glass，较早版本使用系统毛玻璃。正文始终保持清晰。"
            : "自动模式使用实色；Liquid Glass 在此提供通透预览，macOS 桌面客户端使用系统原生材质。"}
        </p>
        {props.reducedTransparency && (
          <p role="status" className="appearance-note">
            已遵循系统的减少透明度或增强对比度设置，使用实色表面。
          </p>
        )}
      </section>
      <section className="appearance-shortcuts">
        <h3>侧栏快捷键</h3>
        <p>
          <span>展开 / 收起导航</span>
          <kbd>{/Mac/.test(navigator.platform) ? "⌘ \\" : "Ctrl + \\"}</kbd>
        </p>
        <p>
          <span>显示 / 隐藏笔记列表</span>
          <kbd>
            {/Mac/.test(navigator.platform) ? "⌘ ⇧ \\" : "Ctrl + Shift + \\"}
          </kbd>
        </p>
        <p>
          <span>专注 / 浏览 / 完整布局</span>
          <kbd>
            {/Mac/.test(navigator.platform)
              ? "⌘ 1 / 2 / 3"
              : "Ctrl + 1 / 2 / 3"}
          </kbd>
        </p>
      </section>
    </div>
  );
}
