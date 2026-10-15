import { test, expect, type Page } from "@playwright/test";

async function openAppearance(page: Page) {
  await page
    .getByLabel("外观设置", { exact: true })
    .filter({ visible: true })
    .click();
  return page.getByRole("dialog", { name: "设置", exact: true });
}

test("global accent migrates, updates all surfaces and persists custom colors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    if (!localStorage.getItem("obryth.appearance.v1"))
      localStorage.setItem(
        "obryth.appearance.v1",
        JSON.stringify({ theme: "light", material: "glass" }),
      );
  });
  await page.goto("/");
  const root = page.locator("html");
  await expect(root).toHaveAttribute("data-accent", "#3b73c4");
  await expect(root).toHaveAttribute("data-theme", "light");
  await expect(root).toHaveAttribute("data-material", "glass");
  const heat = page.locator(".heatmap-legend i").nth(3);
  const blueHeat = await heat.evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );
  await page.screenshot({
    animations: "disabled",
    path: "../../artifacts/theme-blue-home.png",
  });
  const dialog = await openAppearance(page);
  await expect(
    dialog.getByRole("button", { name: "雾蓝", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await dialog.screenshot({ path: "../../artifacts/theme-blue-settings.png" });
  await dialog.getByRole("button", { name: "青绿", exact: true }).click();
  await expect(root).toHaveAttribute("data-accent", "#218578");
  await expect
    .poll(() => heat.evaluate((el) => getComputedStyle(el).backgroundColor))
    .not.toBe(blueHeat);
  await expect(
    dialog.getByRole("button", { name: "青绿", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");

  const hex = dialog.getByLabel("主题色 HEX", { exact: true });
  await hex.fill("#0E7490");
  await hex.press("Enter");
  await expect(root).toHaveAttribute("data-accent", "#0e7490");
  await expect(dialog.getByLabel("自定义主题色", { exact: true })).toHaveValue(
    "#0e7490",
  );
  await hex.fill("badhex");
  await hex.press("Tab");
  await expect(hex).toHaveAttribute("aria-invalid", "true");
  await expect(root).toHaveAttribute("data-accent", "#0e7490");
  await hex.focus();
  await hex.press("Escape");
  await expect(hex).toHaveValue("#0E7490");
  await hex.fill("#abc");
  await hex.press("Tab");
  await expect(root).toHaveAttribute("data-accent", "#aabbcc");
  await dialog.getByLabel("自定义主题色", { exact: true }).fill("#a34562");
  await expect(root).toHaveAttribute("data-accent", "#a34562");
  await dialog.getByRole("button", { name: "深色", exact: true }).click();
  await expect(root).toHaveAttribute("data-theme", "dark");
  await expect(root).toHaveAttribute("data-material", "glass");
  await page.reload();
  await expect(root).toHaveAttribute("data-accent", "#a34562");
  await expect(root).toHaveAttribute("data-theme", "dark");
  await expect(root).toHaveAttribute("data-material", "glass");
  await openAppearance(page);
  await expect(hex).toHaveValue("#A34562");
  await dialog.getByRole("button", { name: "恢复默认蓝色" }).click();
  await expect(root).toHaveAttribute("data-accent", "#3b73c4");
  await dialog.screenshot({
    path: "../../artifacts/theme-blue-settings-dark.png",
  });
  await page.getByLabel("关闭设置", { exact: true }).click();
  await page.screenshot({
    animations: "disabled",
    path: "../../artifacts/theme-blue-home-dark.png",
  });
  expect(errors).toEqual([]);
});

test("custom accent keeps text readable and heatmap levels distinct in either theme", async ({
  page,
}) => {
  await page.goto("/");
  await page.addStyleTag({ content: "* { transition: none !important; }" });
  const dialog = await openAppearance(page);
  for (const theme of ["浅色", "深色"]) {
    await dialog.getByRole("button", { name: theme, exact: true }).click();
    for (const color of [
      "#ffffff",
      "#000000",
      "#ffff00",
      "#0000ff",
      "#3b73c4",
      "#218578",
      "#56804a",
      "#b47b22",
      "#bd5875",
      "#8065b3",
    ]) {
      await dialog.getByLabel("自定义主题色", { exact: true }).fill(color);
      await expect(page.locator("html")).toHaveAttribute("data-accent", color);
      const metrics = await page.evaluate(() => {
        const luminance = (css: string) =>
          css
            .match(/[\d.]+/g)!
            .slice(0, 3)
            .map(Number)
            .map((channel) => {
              const value = channel / 255;
              return value <= 0.04045
                ? value / 12.92
                : ((value + 0.055) / 1.055) ** 2.4;
            })
            .reduce(
              (sum, value, index) =>
                sum + value * [0.2126, 0.7152, 0.0722][index],
              0,
            );
        const contrast = (a: string, b: string) => {
          const [high, low] = [luminance(a), luminance(b)].sort(
            (a, b) => b - a,
          );
          return (high + 0.05) / (low + 0.05);
        };
        const selected = getComputedStyle(
          document.querySelector(
            '.appearance-options button[aria-pressed="true"]',
          )!,
        );
        const primary = getComputedStyle(
          document.querySelector(".home-capture .primary-button")!,
        );
        const fills = [...document.querySelectorAll(".heatmap-legend i")].map(
          (el) => getComputedStyle(el).backgroundColor,
        );
        return {
          selected: contrast(selected.color, selected.backgroundColor),
          primary: contrast(primary.color, primary.backgroundColor),
          heat: contrast(fills[0], fills[1]),
          levels: fills.slice(1).map(luminance),
        };
      });
      expect(
        metrics.selected,
        `${theme} ${color} selected text`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        metrics.primary,
        `${theme} ${color} button text`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        metrics.heat,
        `${theme} ${color} first heat level`,
      ).toBeGreaterThanOrEqual(1.7);
      expect(metrics.levels).toEqual(
        [...metrics.levels].sort((a, b) => (theme === "浅色" ? b - a : a - b)),
      );
    }
  }
  await page.setViewportSize({ width: 540, height: 800 });
  await dialog.getByRole("button", { name: "恢复默认蓝色" }).click();
  const bounds = await dialog
    .locator(".accent-presets")
    .evaluate((el) => ({ width: el.clientWidth, scrollWidth: el.scrollWidth }));
  expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.width);
  await expect(
    dialog.getByLabel("主题色 HEX", { exact: true }),
  ).toBeInViewport();
  await dialog.screenshot({
    path: "../../artifacts/theme-blue-settings-compact.png",
  });
});

test("invalid saved accent falls back to blue without losing appearance choices", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "obryth.appearance.v1",
      JSON.stringify({
        theme: "dark",
        material: "solid",
        accentColor: "invalid",
      }),
    ),
  );
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-accent", "#3b73c4");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-material", "solid");
});
