import { useEffect, useRef, useState } from "react";
import { Effect, EffectState, getCurrentWindow } from "@tauri-apps/api/window";
import { native } from "./bridge";
import { accentTokens, DEFAULT_ACCENT, normalizeAccent } from "./accent";

export type AppearancePreferences = {
  theme: "system" | "light" | "dark";
  material: "auto" | "solid" | "glass";
  accentColor: string;
};
export const APPEARANCE_KEY = "obryth.appearance.v1";

function readAppearance(): AppearancePreferences {
  try {
    const value = JSON.parse(localStorage.getItem(APPEARANCE_KEY) ?? "null");
    if (
      value &&
      ["system", "light", "dark"].includes(value.theme) &&
      ["auto", "solid", "glass"].includes(value.material)
    )
      return {
        theme: value.theme,
        material: value.material,
        accentColor: normalizeAccent(value.accentColor) ?? DEFAULT_ACCENT,
      };
  } catch {
    /* Recover invalid presentation preferences. */
  }
  const legacy = localStorage.getItem("obryth.theme");
  return {
    theme: legacy === "dark" || legacy === "light" ? legacy : "system",
    material: "auto",
    accentColor: DEFAULT_ACCENT,
  };
}

export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const media = matchMedia(query);
    const change = () => setMatches(media.matches);
    change();
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, [query]);
  return matches;
}

export function useAppearance() {
  const [preferences, setPreferences] = useState(readAppearance);
  const systemDark = useMediaQuery("(prefers-color-scheme: dark)");
  const reducedTransparency = useMediaQuery(
    "(prefers-reduced-transparency: reduce)",
  );
  const increasedContrast = useMediaQuery("(prefers-contrast: more)");
  const macos = native && /Mac/.test(navigator.platform);
  const dark =
    preferences.theme === "dark" ||
    (preferences.theme === "system" && systemDark);
  const glass =
    !reducedTransparency &&
    !increasedContrast &&
    (preferences.material === "glass" ||
      (preferences.material === "auto" && macos));
  // Serialize native changes so rapid theme/material selections cannot leave a stale effect.
  const nativeChanges = useRef(Promise.resolve());
  useEffect(() => {
    const root = document.documentElement;
    for (const [name, value] of Object.entries(
      accentTokens(preferences.accentColor, dark),
    ))
      root.style.setProperty(name, value);
    root.dataset.accent = preferences.accentColor;
  }, [preferences.accentColor, dark]);
  useEffect(() => {
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify(preferences));
  }, [preferences]);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = dark ? "dark" : "light";
    root.dataset.material = glass ? "glass" : "solid";
    delete root.dataset.nativeMaterial;
    localStorage.setItem("obryth.theme", dark ? "dark" : "light");
    let active = true;
    if (native)
      nativeChanges.current = nativeChanges.current.then(async () => {
        if (!active) return;
        const window = getCurrentWindow();
        try {
          await window.setTheme(
            preferences.theme === "system" ? null : dark ? "dark" : "light",
          );
          if (macos) {
            if (glass)
              await window.setEffects({
                effects: [Effect.LiquidGlassRegular, Effect.Sidebar],
                state: EffectState.FollowsWindowActiveState,
                radius: 12,
              });
            else await window.clearEffects();
            if (active) root.dataset.nativeMaterial = glass ? "true" : "false";
          }
        } catch (error) {
          console.warn("Window appearance", error);
        }
      });
    return () => {
      active = false;
    };
  }, [preferences.theme, dark, glass, macos]);
  return {
    preferences,
    setPreferences,
    dark,
    glass,
    reducedTransparency: reducedTransparency || increasedContrast,
  };
}
