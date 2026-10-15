export type PanelVisibility = {
  navigation: boolean;
  list: boolean;
  details: boolean;
};
export type WritingView = "focus" | "browse" | "full";
export const CHROME_KEY = "obryth.workspace.chrome.v1";
export const writingViews: Record<WritingView, PanelVisibility> = {
  focus: { navigation: false, list: false, details: false },
  browse: { navigation: false, list: true, details: false },
  full: { navigation: true, list: true, details: true },
};
export function readChrome(): PanelVisibility {
  try {
    const value = JSON.parse(localStorage.getItem(CHROME_KEY) ?? "null");
    if (
      value &&
      ["navigation", "list", "details"].every(
        (key) => typeof value[key] === "boolean",
      )
    )
      return value;
  } catch {
    /* Ignore invalid presentation preferences; note content is separate. */
  }
  return { ...writingViews.browse };
}
export function currentWritingView(value: PanelVisibility): WritingView | null {
  return (
    (Object.keys(writingViews) as WritingView[]).find((key) =>
      Object.entries(writingViews[key]).every(
        ([field, enabled]) => value[field as keyof PanelVisibility] === enabled,
      ),
    ) ?? null
  );
}
