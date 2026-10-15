export const DEFAULT_ACCENT = "#3b73c4";
export const accentPresets = [
  { name: "雾蓝", color: DEFAULT_ACCENT },
  { name: "青绿", color: "#218578" },
  { name: "森林", color: "#56804a" },
  { name: "琥珀", color: "#b47b22" },
  { name: "玫瑰", color: "#bd5875" },
  { name: "鸢紫", color: "#8065b3" },
] as const;

export function normalizeAccent(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const hex = value.trim().replace(/^#/, "");
  if (/^[\da-f]{6}$/i.test(hex)) return `#${hex.toLowerCase()}`;
  if (/^[\da-f]{3}$/i.test(hex))
    return `#${[...hex]
      .map((digit) => digit + digit)
      .join("")
      .toLowerCase()}`;
  return null;
}

function channels(hex: string) {
  return [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
}
function mix(from: string, to: string, amount: number) {
  const target = channels(to);
  return `#${channels(from)
    .map((value, index) =>
      Math.round(value + (target[index] - value) * amount)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}
function luminance(hex: string) {
  return channels(hex)
    .map((value) => {
      const channel = value / 255;
      return channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
    })
    .reduce(
      (sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index],
      0,
    );
}
function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

export function accentTokens(color: string, dark: boolean) {
  const source = normalizeAccent(color) ?? DEFAULT_ACCENT;
  const background = dark ? "#202020" : "#ffffff";
  const ink = dark ? "#e3e2df" : "#30302f";
  const target = dark ? "#ffffff" : "#000000";
  let accent = source;
  let soft = background;
  // Keep custom colors readable, including very pale and very dark choices.
  for (let step = 0; step <= 100; step++) {
    accent = mix(source, target, step / 100);
    soft = mix(background, accent, dark ? 0.16 : 0.08);
    if (contrast(accent, soft) >= 4.5) break;
  }
  return {
    "--accent": accent,
    "--accent-soft": soft,
    "--accent-contrast":
      contrast(accent, "#ffffff") > contrast(accent, "#202020")
        ? "#ffffff"
        : "#202020",
    "--heat-0": mix(background, ink, 0.09),
    "--heat-1": mix(background, accent, 0.55),
    "--heat-2": mix(background, accent, 0.78),
    "--heat-3": mix(background, accent, 0.94),
    "--heat-4": mix(accent, target, dark ? 0.35 : 0.25),
  };
}
