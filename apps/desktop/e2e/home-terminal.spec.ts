import { test, expect } from "@playwright/test";

test("home is the default, preserves memo drafts and returns after the last tab closes", async ({
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
  const home = page.locator(".home-pane").filter({ visible: true });
  await expect(home.getByRole("heading", { level: 1 })).toHaveText(
    "记录，让想法留下来。",
  );
  await expect(page.locator(".titlebar-context")).toContainText("主页");
  await home
    .getByLabel("记录一个想法")
    .fill("给灵感留一点空间 #设计\n明天继续探索。");
  await page.reload();
  await expect(home.getByLabel("记录一个想法")).toHaveValue(
    "给灵感留一点空间 #设计\n明天继续探索。",
  );
  await home.getByLabel("记录一个想法").press("ControlOrMeta+Enter");
  await expect(home.getByLabel("记录一个想法")).toHaveValue("");
  await expect(
    home.locator(".home-note").filter({ hasText: "给灵感留一点空间" }),
  ).toContainText("给灵感留一点空间");
  const memo = await page.evaluate(
    () => JSON.parse(localStorage.getItem("obryth.preview.vault.v2")!).notes[0],
  );
  expect(memo.kind).toBe("memo");
  expect(memo.tags).toEqual(["设计"]);
  await home
    .locator(".home-note")
    .filter({ hasText: "给灵感留一点空间" })
    .click();
  await expect(page.getByLabel("笔记标题")).toHaveValue(
    "给灵感留一点空间 #设计",
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Object.keys(
            JSON.parse(
              localStorage.getItem("obryth.preview.preferences.v1") ?? "{}",
            )["workspace.layout"]?.panels ?? {},
          ).length,
      ),
    )
    .toBe(2);
  await page.reload();
  await expect(home).toBeVisible();
  await expect(page.locator(".document-workspace .dv-tab")).toHaveCount(2);
  const workspace = page.locator(".document-workspace");
  await workspace
    .getByRole("tab", { name: "给灵感留一点空间 #设计", exact: true })
    .click();
  await workspace
    .getByRole("button", { name: "Close 给灵感留一点空间 #设计", exact: true })
    .click();
  await workspace
    .getByRole("button", { name: "Close 主页", exact: true })
    .click();
  await expect(home).toBeVisible();
  await expect(page.locator(".document-workspace .dv-tab")).toHaveCount(1);
  await page.screenshot({
    animations: "disabled",
    path: "../../artifacts/ui-home-glass-light.png",
  });
  await home.getByRole("button", { name: "打开终端", exact: false }).click();
  const terminal = page.locator(".terminal-pane");
  await expect(terminal).toHaveAttribute("data-terminal-theme", "glass");
  await expect(
    terminal.getByRole("button", { name: "启动终端" }),
  ).toBeDisabled();
  await expect(terminal).toHaveClass(/terminal-glass/);
  await terminal.getByLabel("终端主题", { exact: true }).selectOption("nord");
  await expect(terminal).not.toHaveClass(/terminal-glass/);
  await terminal.getByLabel("终端字体设置", { exact: true }).click();
  await terminal.getByLabel("终端字体", { exact: true }).selectOption("nerd");
  await terminal.getByLabel("终端字号", { exact: true }).fill("16");
  await terminal.getByLabel("关闭终端字体设置").click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem("obryth.terminal.appearance.v1")!),
      ),
    )
    .toEqual({ theme: "nord", font: "nerd", fontSize: 16, lineHeight: 1.6 });
  await page.getByLabel("返回主页", { exact: true }).click();
  await page.getByRole("button", { name: "切换主题", exact: true }).click();
  await page.screenshot({
    animations: "disabled",
    path: "../../artifacts/ui-home-terminal-dark.png",
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.values(
          JSON.parse(
            localStorage.getItem("obryth.preview.preferences.v1") ?? "{}",
          )["workspace.layout"]?.panels ?? {},
        ).some((panel: any) => panel.contentComponent === "terminal"),
      ),
    )
    .toBe(true);
  await page.reload();
  await expect(home).toBeVisible();
  await expect(page.locator(".terminal-pane")).toHaveAttribute(
    "data-terminal-theme",
    "nord",
  );
  await page.getByRole("button", { name: "设置与连接", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "终端", exact: true })
    .click();
  await expect(
    page
      .getByLabel("终端主题方案")
      .getByRole("button", { name: "北境", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByLabel("终端主题方案")
    .getByRole("button", { name: "液态玻璃", exact: true })
    .click();
  await expect(page.locator(".terminal-pane")).toHaveClass(/terminal-glass/);
  await page.screenshot({
    animations: "disabled",
    path: "../../artifacts/ui-terminal-settings.png",
  });
  await page.emulateMedia({ contrast: "more" });
  await expect(page.locator(".terminal-pane")).not.toHaveClass(
    /terminal-glass/,
  );
  await page.emulateMedia({ contrast: "no-preference" });
  await expect(page.locator(".terminal-pane")).toHaveClass(/terminal-glass/);
  expect(errors).toEqual([]);
});

test("empty vault home and compact glass surfaces remain usable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("obryth.preview.notes.v1", "[]");
    localStorage.setItem(
      "obryth.appearance.v1",
      JSON.stringify({ theme: "light", material: "glass" }),
    );
  });
  await page.setViewportSize({ width: 800, height: 650 });
  await page.goto("/");
  await expect(page.locator(".activity-empty")).toContainText(
    "这里还没有保存记录",
  );
  await expect(page.getByRole("button", { name: "保存想法" })).toBeDisabled();
  await expect(page.locator(".home-pane")).toBeVisible();
  for (const selector of [
    ".home-activity",
    ".home-capture",
    ".activity-empty",
    ".home-aside-toggle",
  ])
    await expect(page.locator(selector)).toHaveCSS("backdrop-filter", /blur/);
  await page.emulateMedia({ contrast: "more" });
  await expect(page.locator("html")).toHaveAttribute("data-material", "solid");
  for (const selector of [
    ".home-activity",
    ".home-capture",
    ".activity-empty",
    ".home-aside-toggle",
  ])
    await expect(page.locator(selector)).toHaveCSS("backdrop-filter", "none");
  await page.emulateMedia({ contrast: "no-preference" });
  await expect(page.locator("html")).toHaveAttribute("data-material", "glass");
  expect(
    await page
      .locator(".home-pane")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  expect(
    await page
      .locator(".note-index")
      .evaluate((el) => getComputedStyle(el).backdropFilter),
  ).toContain("blur");
  await page.screenshot({
    animations: "disabled",
    path: "../../artifacts/ui-home-compact.png",
  });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole("button", { name: "搜索笔记", exact: true }).click();
  await page.getByLabel("向右拆分", { exact: true }).click();
  await page.getByLabel("返回主页", { exact: true }).click();
  await expect(
    page.locator(".home-pane").filter({ visible: true }),
  ).toHaveCount(2);
  await expect(page.locator(".note-pane")).toHaveCount(0);
  await page
    .locator(".home-pane")
    .first()
    .getByLabel("记录一个想法")
    .fill("分屏共享草稿");
  await expect(
    page.locator(".home-pane").last().getByLabel("记录一个想法"),
  ).toHaveValue("分屏共享草稿");
  await page
    .locator(".home-pane")
    .last()
    .getByRole("button", { name: "保存想法" })
    .click();
  await expect(
    page.locator(".home-pane").first().getByLabel("记录一个想法"),
  ).toHaveValue("");
});

test("running xterm follows app colors and material without replacing the session", async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem("obryth.appearance.v1")) {
      localStorage.setItem(
        "obryth.appearance.v1",
        JSON.stringify({ theme: "light", material: "glass" }),
      );
    }
  });
  await page.goto("/");
  await page.getByRole("button", { name: "打开终端", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const saved = JSON.parse(
          localStorage.getItem("obryth.preview.preferences.v1") ?? "{}",
        );
        return Object.values(saved["workspace.layout"]?.panels ?? {}).some(
          (p: any) => p.contentComponent === "terminal",
        );
      }),
    )
    .toBe(true);
  await page.evaluate(() => {
    const saved = JSON.parse(
      localStorage.getItem("obryth.preview.preferences.v1")!,
    );
    for (const panel of Object.values(
      saved["workspace.layout"].panels,
    ) as any[]) {
      if (panel.contentComponent === "terminal")
        panel.params.sessionId = "appearance-test";
    }
    localStorage.setItem(
      "obryth.preview.preferences.v1",
      JSON.stringify(saved),
    );
  });
  // Exercise the real xterm renderer with a deterministic PTY transport.
  await page.route(/\/src\/lib\/bridge\.ts(?:\?.*)?$/, async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        `
      const originalCall = bridge.call.bind(bridge);
      window.terminalSnapshots = 0;
      window.terminalResizes = [];
      bridge.call = async (method, params) => {
        if (method === "agent.terminal.snapshot") {
          window.terminalSnapshots++;
          return { seq: 1, dataB64: btoa("\\x1b[32m~/obryth\\x1b[0m on main\\r\\n$ echo hello\\r\\nhello\\r\\n$ ") };
        }
        if (method === "agent.terminal.output") {
          await new Promise(resolve => setTimeout(resolve, 100));
          return { events: [], nextSeq: 1, exited: false };
        }
        if (method === "agent.terminal.resize") { window.terminalResizes.push(params.size); return null; }
        if (method === "agent.terminal.input") return null;
        return originalCall(method, params);
      };
    `,
    });
  });
  await page.reload();
  const terminal = page.locator(".terminal-pane");
  await page.getByRole("tab", { name: "终端", exact: true }).click();
  await expect(terminal.locator(".xterm-screen")).toBeVisible();
  await expect(terminal.getByRole("status")).toHaveText("已连接");
  await page.evaluate(() => {
    (window as any).originalXterm = document.querySelector(".xterm");
  });
  const surface = () =>
    terminal.evaluate((el) => {
      const style = getComputedStyle(el);
      const root = getComputedStyle(document.documentElement);
      return {
        matches:
          style.getPropertyValue("--terminal-surface").trim() ===
            root.getPropertyValue("--bg").trim() &&
          style.getPropertyValue("--terminal-foreground").trim() ===
            root.getPropertyValue("--ink").trim() &&
          style.getPropertyValue("--terminal-accent").trim() ===
            root.getPropertyValue("--accent").trim() &&
          getComputedStyle(el.querySelector(".xterm-rows")!).color ===
            root.color,
        padding: getComputedStyle(el.querySelector(".xterm-host")!).padding,
        viewport: getComputedStyle(el.querySelector(".xterm-viewport")!)
          .backgroundColor,
        blur: style.backdropFilter,
        font: getComputedStyle(el.querySelector(".xterm-rows")!).fontSize,
        rowHeight: getComputedStyle(el.querySelector(".xterm-rows > div")!)
          .height,
        scheme: style.colorScheme,
        sameRenderer:
          el.querySelector(".xterm") === (window as any).originalXterm,
      };
    });
  for (const theme of ["light", "dark", "light"]) {
    if ((await page.locator("html").getAttribute("data-theme")) !== theme) {
      await page.getByRole("button", { name: "切换主题", exact: true }).click();
    }
    await expect.poll(async () => (await surface()).matches).toBe(true);
    const metrics = await surface();
    expect(metrics.padding).toBe("0px");
    expect(metrics.viewport).toBe("rgba(0, 0, 0, 0)");
    expect(metrics.blur).toContain("blur");
    expect(metrics.scheme).toBe(theme);
    expect(metrics.font).toBe("12px");
    expect(parseFloat(metrics.rowHeight)).toBeGreaterThanOrEqual(19);
    expect(metrics.sameRenderer).toBe(true);
    await terminal.screenshot({
      path: `../../artifacts/terminal-running-${theme}.png`,
    });
  }
  const oldAccent = await terminal.evaluate((el) =>
    getComputedStyle(el).getPropertyValue("--terminal-accent"),
  );
  await page
    .getByLabel("外观设置", { exact: true })
    .filter({ visible: true })
    .click();
  await page.getByRole("button", { name: "青绿", exact: true }).click();
  await page.getByLabel("关闭设置", { exact: true }).click();
  await expect.poll(async () => (await surface()).matches).toBe(true);
  expect(
    await terminal.evaluate((el) =>
      getComputedStyle(el).getPropertyValue("--terminal-accent"),
    ),
  ).not.toBe(oldAccent);
  expect((await surface()).sameRenderer).toBe(true);
  await terminal.getByLabel("终端主题", { exact: true }).selectOption("system");
  await page.evaluate(() => {
    document.documentElement.dataset.material = "solid";
  });
  await expect(terminal).not.toHaveClass(/terminal-glass/);
  await page.evaluate(() => {
    document.documentElement.dataset.material = "glass";
  });
  await expect(terminal).toHaveClass(/terminal-glass/);
  await page.emulateMedia({ contrast: "more" });
  await expect(terminal).not.toHaveClass(/terminal-glass/);
  await page.emulateMedia({ contrast: "no-preference" });
  await expect(terminal).toHaveClass(/terminal-glass/);
  await expect
    .poll(() => page.evaluate(() => (window as any).terminalResizes.length))
    .toBeGreaterThan(0);
  const rows = await page.evaluate(
    () => (window as any).terminalResizes.at(-1).rows,
  );
  await terminal.getByLabel("终端字体设置", { exact: true }).click();
  await terminal.getByLabel("终端行距", { exact: true }).fill("1.9");
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).terminalResizes.at(-1).rows),
    )
    .toBeLessThan(rows);
  expect((await surface()).sameRenderer).toBe(true);
  await expect(terminal.locator(".xterm-rows")).toContainText("echo hello");
  expect(await page.evaluate(() => (window as any).terminalSnapshots)).toBe(1);
  await terminal.getByLabel("关闭终端字体设置").click();
  await terminal.getByLabel("终端主题", { exact: true }).selectOption("nord");
  const nord = await terminal.evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );
  await page.getByRole("button", { name: "切换主题", exact: true }).click();
  expect(
    await terminal.evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe(nord);
});
