import { useMemo, useSyncExternalStore } from "react";
import type { ITheme } from "@xterm/xterm";
import { useMediaQuery } from "./appearance";

export const TERMINAL_KEY = "obryth.terminal.appearance.v1";
const changed = "obryth:terminal-appearance";
export const terminalThemes = [
  { id: "glass", name: "液态玻璃", detail: "通透光感 · 随界面明暗" },
  { id: "system", name: "跟随外观", detail: "与工作区保持一致" },
  { id: "midnight", name: "午夜", detail: "深石墨 · 柔和紫" },
  { id: "nord", name: "北境", detail: "冷灰蓝 · 冰川青" },
  { id: "forest", name: "松林", detail: "墨绿 · 苔藓金" },
  { id: "paper", name: "纸笺", detail: "暖白 · 清晰墨色" },
] as const;
export type TerminalThemeId = (typeof terminalThemes)[number]["id"];
export type TerminalPreferences = {
  theme: TerminalThemeId;
  font: "mono" | "nerd";
  fontSize: number;
  lineHeight: number;
};
export const defaultTerminalPreferences: TerminalPreferences = {
  theme: "glass",
  font: "mono",
  fontSize: 12,
  lineHeight: 1.6,
};
export function parseTerminalPreferences(
  raw: string | null,
): TerminalPreferences {
  try {
    const value = JSON.parse(raw ?? "null");
    return {
      theme: terminalThemes.some((theme) => theme.id === value?.theme)
        ? value.theme
        : "glass",
      font: value?.font === "nerd" ? "nerd" : "mono",
      fontSize:
        typeof value?.fontSize === "number" && Number.isFinite(value.fontSize)
          ? Math.max(11, Math.min(20, Math.round(value.fontSize)))
          : defaultTerminalPreferences.fontSize,
      lineHeight:
        typeof value?.lineHeight === "number" &&
        Number.isFinite(value.lineHeight)
          ? Math.max(1.2, Math.min(2, Math.round(value.lineHeight * 100) / 100))
          : defaultTerminalPreferences.lineHeight,
    };
  } catch {
    return { ...defaultTerminalPreferences };
  }
}
function subscribe(listener: () => void) {
  window.addEventListener(changed, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(changed, listener);
    window.removeEventListener("storage", listener);
  };
}
export function useTerminalPreferences() {
  const raw = useSyncExternalStore(subscribe, () =>
    localStorage.getItem(TERMINAL_KEY),
  );
  const preferences = useMemo(() => parseTerminalPreferences(raw), [raw]);
  const change = (patch: Partial<TerminalPreferences>) => {
    const next = {
      ...parseTerminalPreferences(localStorage.getItem(TERMINAL_KEY)),
      ...patch,
    };
    localStorage.setItem(
      TERMINAL_KEY,
      JSON.stringify(parseTerminalPreferences(JSON.stringify(next))),
    );
    window.dispatchEvent(new Event(changed));
  };
  return { preferences, change };
}
function subscribeAppearance(listener: () => void) {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "data-material", "data-accent"],
  });
  return () => observer.disconnect();
}
export function useTerminalEnvironment() {
  const appearance = useSyncExternalStore(
    subscribeAppearance,
    () =>
      `${document.documentElement.dataset.theme}:${document.documentElement.dataset.accent}:${document.documentElement.dataset.material}`,
  );
  const reduced = useMediaQuery("(prefers-reduced-transparency: reduce)");
  const contrast = useMediaQuery("(prefers-contrast: more)");
  const palette = useMemo(() => {
    const style = getComputedStyle(document.documentElement);
    return {
      background: style.getPropertyValue("--bg").trim(),
      foreground: style.getPropertyValue("--ink").trim(),
      cursor: style.getPropertyValue("--accent").trim(),
    };
  }, [appearance]);
  return {
    dark: appearance.startsWith("dark:"),
    glass: appearance.endsWith(":glass"),
    reducedTransparency: reduced || contrast,
    palette,
  };
}
function palette(
  background: string,
  foreground: string,
  cursor: string,
  colors: string[],
): ITheme {
  const [
    black,
    red,
    green,
    yellow,
    blue,
    magenta,
    cyan,
    white,
    brightBlack,
    brightRed,
    brightGreen,
    brightYellow,
    brightBlue,
    brightMagenta,
    brightCyan,
    brightWhite,
  ] = colors;
  return {
    background,
    foreground,
    cursor,
    cursorAccent: background,
    selectionBackground: `${cursor}40`,
    selectionForeground: foreground,
    black,
    red,
    green,
    yellow,
    blue,
    magenta,
    cyan,
    white,
    brightBlack,
    brightRed,
    brightGreen,
    brightYellow,
    brightBlue,
    brightMagenta,
    brightCyan,
    brightWhite,
  };
}
const midnight = palette("#181923", "#e0deef", "#c3b4ff", [
  "#353747",
  "#f38ba8",
  "#a6da95",
  "#eed49f",
  "#8aadf4",
  "#c6a0f6",
  "#8bd5ca",
  "#d7dce2",
  "#7e8199",
  "#f5a5b9",
  "#b8e6a5",
  "#f5e0ae",
  "#adc7ff",
  "#d7bafc",
  "#a4e8de",
  "#f4f2ff",
]);
const nord = palette("#252e3b", "#e5e9f0", "#88c0d0", [
  "#424e61",
  "#e08b93",
  "#a3be8c",
  "#ebcb8b",
  "#81a1c1",
  "#b48ead",
  "#8fbcbb",
  "#d8dee9",
  "#8290a5",
  "#ee9aa2",
  "#b8d3a2",
  "#f5d99f",
  "#9bbddd",
  "#cda6c5",
  "#a3d7d6",
  "#eceff4",
]);
const forest = palette("#172720", "#dce8dc", "#b6d7a8", [
  "#3e5145",
  "#ea9991",
  "#aad39b",
  "#e4c985",
  "#91b8cf",
  "#c4a5cf",
  "#8bc9b5",
  "#d8e3d5",
  "#809885",
  "#f2b0a8",
  "#c3e4b6",
  "#f1dca3",
  "#b0d1e5",
  "#ddc1e5",
  "#a6e2d0",
  "#f0f5e9",
]);
const paper = palette("#faf8f3", "#343a41", "#6c5fa5", [
  "#414650",
  "#a83948",
  "#35714b",
  "#866310",
  "#35649b",
  "#82549e",
  "#236b70",
  "#6d6a63",
  "#6d7077",
  "#ad354b",
  "#2b7041",
  "#846011",
  "#315fac",
  "#8d419d",
  "#146b70",
  "#3d4149",
]);
export function resolveTerminalTheme(
  preferences: TerminalPreferences,
  environment: {
    dark: boolean;
    glass: boolean;
    reducedTransparency: boolean;
    palette: Pick<ITheme, "background" | "foreground" | "cursor">;
  },
) {
  const isGlass =
    !environment.reducedTransparency &&
    (preferences.theme === "glass" ||
      (preferences.theme === "system" && environment.glass));
  const base =
    preferences.theme === "nord"
      ? nord
      : preferences.theme === "forest"
        ? forest
        : preferences.theme === "paper"
          ? paper
          : preferences.theme === "midnight"
            ? midnight
            : {
                ...(environment.dark ? midnight : paper),
                ...environment.palette,
                selectionBackground: `${environment.palette.cursor}40`,
              };
  return {
    // The pane owns the background, including the space around the cell grid.
    // Keeping xterm transparent avoids a second opaque surface and inset frame.
    colors: {
      ...base,
      background: "#00000000",
      cursorAccent: base.background,
    },
    surface: base.background!,
    foreground: base.foreground!,
    accent: base.cursor!,
    glass: isGlass,
    dark:
      preferences.theme === "paper"
        ? false
        : preferences.theme === "glass" || preferences.theme === "system"
          ? environment.dark
          : true,
  };
}
export function terminalFontFamily(font: TerminalPreferences["font"]) {
  return font === "nerd"
    ? '"JetBrains Mono Nerd", "JetBrains Mono", monospace'
    : '"JetBrains Mono", "JetBrains Mono Nerd", monospace';
}
export async function loadTerminalFont(
  font: TerminalPreferences["font"],
  size: number,
) {
  const family = font === "nerd" ? "JetBrains Mono Nerd" : "JetBrains Mono";
  await Promise.all([
    document.fonts.load(`${size}px "${family}"`),
    document.fonts.load(`bold ${size}px "${family}"`),
    document.fonts.load(`italic ${size}px "${family}"`),
    document.fonts.load(`bold italic ${size}px "${family}"`),
    document.fonts.load(`${size}px "JetBrains Mono Nerd"`),
  ]);
}
