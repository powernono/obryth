import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const data = [
      {
        title: "Obryth · 产品与工作空间设计",
        tags: ["obryth", "dev"],
        body: "## 一个连接思考与行动的空间\n\n好的工具应当让知识自然地积累，让记录、研究和执行发生在同一个工作空间。\n\n### 设计原则\n\n- **笔记优先**：正文始终是界面的中心\n- **渐进展开**：需要的时候，再打开终端与 AI\n- **数据属于你**：普通 Markdown，本地保存\n\n### 工作空间的四个区域\n\n左侧导航负责分类，中间列表帮助定位，正文承载思考，右侧详情连接属性与关系。\n\n> 少一点界面噪声，多一点思考的空间。\n\n### 下一步\n\n整理 [[WebDAV 同步设计]]，将相关研究挂载到项目知识范围。",
      },
      {
        title: "WebDAV 同步设计",
        tags: ["dev", "obryth"],
        body: "## 多设备，保持同一个思路\n\n使用不可变版本与父版本判断并发。附件上传完成后，再发布引用它的笔记。",
        source: "https://developer.mozilla.org",
      },
      {
        title: "终端工作流与命令摘录",
        tags: ["dev"],
        kind: "runbook",
        body: "## 调试记录\n\n```sh\ncargo test --workspace\n```\n\n保留退出码、输出和问题发生时的上下文。",
      },
      {
        title: "一些还没成形的想法",
        tags: ["inbox"],
        kind: "memo",
        body: "让捕获足够轻，让整理发生在有空的时候。今天想到把研究网页与笔记放在一起。",
      },
      {
        title: "知识库的标签与关系",
        tags: ["obryth"],
        body: "## 标签是入口，关系是连接\n\n[[Obryth · 产品与工作空间设计]]\n\n通过标签建立可复用的知识范围。",
      },
      {
        title: "个人环境配置",
        tags: ["private", "dev"],
        body: "这篇笔记用于验证排除标签，不能进入公共项目知识范围。",
      },
      {
        title: "本周阅读清单",
        tags: ["inbox"],
        body: "阅读、摘录、再用自己的话解释。把有用的发现连接到项目。",
      },
    ];
    if (!localStorage.getItem("obryth.preview.notes.v1"))
      localStorage.setItem(
        "obryth.preview.notes.v1",
        JSON.stringify(
          data.map((item, index) => ({
            ...item,
            id: `design-${index}`,
            kind: item.kind ?? "document",
            source: item.source ?? null,
            pinned: index === 0,
            createdAt: new Date(Date.UTC(2026, 9, 14 - index)).toISOString(),
            updatedAt: new Date(Date.UTC(2026, 9, 14 - index)).toISOString(),
            revision: `design-version-${index}`,
            extra: {},
          })),
        ),
      );
    if (!localStorage.getItem("obryth.preview.plugins"))
      localStorage.setItem(
        "obryth.preview.plugins",
        JSON.stringify([
          {
            manifest: {
              id: "test.daily",
              name: "每日知识回顾",
              version: "0.1.0",
              apiVersion: 1,
              entry: "entry.js",
              platforms: ["desktop"],
              permissions: ["notes.read", "commands", "panels"],
            },
            code: "globalThis.ObrythPlugin={activate(){}};",
          },
        ]),
      );
  });
  await page.goto("/");
  await expect(
    page.locator(".home-pane").filter({ visible: true }),
  ).toBeVisible();
  await page.locator(".home-note").first().click();
  await expect(page.locator(".prose-editor")).toBeVisible();
});
test("four-column notes, tag scopes, plugin controls and browser pages", async ({
  page,
}) => {
  await page.getByRole("button", { name: "完整布局", exact: true }).click();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.locator(".note-inspector")).toBeVisible();
  await expect(page.locator(".index-note")).toHaveCount(7);
  await page.screenshot({
    animations: "disabled",
    path: "../../artifacts/ui-notes-v2.png",
  });
  await page.getByRole("button", { name: "知识库管理", exact: true }).click();
  await page.getByRole("button", { name: "新建知识范围", exact: true }).click();
  await page.getByLabel("知识范围名称").fill("开发项目上下文");
  await page
    .locator(".scope-tags")
    .nth(0)
    .getByRole("button", { name: "dev", exact: true })
    .click();
  await page
    .locator(".scope-tags")
    .nth(1)
    .getByRole("button", { name: "private", exact: true })
    .click();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem("obryth.preview.preferences.v1") ?? "{}",
          )["knowledge.mounts"]?.some(
            (mount: { name: string }) => mount.name === "开发项目上下文",
          ) ?? false,
      ),
    )
    .toBe(true);
  await page.getByLabel("关闭通知", { exact: true }).click();
  await expect(page.locator(".scope-note")).toHaveCount(3);
  await expect(page.locator(".scope-preview")).not.toContainText(
    "个人环境配置",
  );
  await page.screenshot({
    animations: "disabled",
    path: "../../artifacts/ui-knowledge-v2.png",
  });
  await page
    .getByRole("button", { name: "在知识助手中使用", exact: true })
    .click();
  await expect(page.locator(".agent-pane")).toBeVisible();
  await expect(page.getByLabel("知识包含标签", { exact: true })).toHaveValue(
    "dev",
  );
  await expect(page.getByLabel("知识排除标签", { exact: true })).toHaveValue(
    "private",
  );
  await page.getByRole("button", { name: "插件与扩展", exact: true }).click();
  await expect(page.locator(".plugin-row")).toHaveCount(1);
  await page.getByRole("switch", { name: "启用 每日知识回顾" }).click();
  await expect(
    page.getByRole("switch", { name: "启用 每日知识回顾" }),
  ).toHaveAttribute("aria-checked", "true");
  await page.getByLabel("查看 每日知识回顾 权限").click();
  await expect(page.locator(".plugin-detail")).toContainText("读取笔记");
  await page.screenshot({
    animations: "disabled",
    path: "../../artifacts/ui-plugins-v2.png",
  });
  await page.getByRole("button", { name: "研究浏览器", exact: true }).click();
  await expect(page.locator(".browser-start")).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    path: "../../artifacts/ui-browser-v2.png",
  });
  await page.getByLabel("开始浏览地址").fill("example.com");
  await page.getByLabel("开始浏览地址").press("Enter");
  await expect(page.locator(".browser-page-row")).toContainText("example.com");
  await page.getByRole("button", { name: "固定页面", exact: true }).click();
  await page.getByLabel("新建浏览器页面").click();
  await expect(page.locator(".browser-page-row")).toHaveCount(2);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Object.keys(
            JSON.parse(
              localStorage.getItem("obryth.preview.preferences.v1") ?? "{}",
            )["browser.layout"]?.panels ?? {},
          ).length,
      ),
    )
    .toBe(2);
  await page.reload();
  await page.getByRole("button", { name: "研究浏览器", exact: true }).click();
  await expect(page.locator(".browser-page-row")).toHaveCount(2);
  await expect(page.locator(".page-pin.pinned")).toHaveCount(1);
  expect(errors).toEqual([]);
});
test("dark and compact windows preserve a usable writing canvas", async ({
  page,
}) => {
  await page.getByRole("button", { name: "完整布局", exact: true }).click();
  await page.getByLabel("切换主题").click();
  await page.screenshot({
    animations: "disabled",
    path: "../../artifacts/ui-dark-v2.png",
  });
  await page.setViewportSize({ width: 1000, height: 780 });
  await expect(page.locator(".note-inspector")).not.toBeVisible();
  await expect(page.getByLabel("笔记标题")).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    path: "../../artifacts/ui-compact-v2.png",
  });
});

test("writing views independently collapse panels, preserve splits and restore preferences", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.locator(".library-nav")).not.toBeVisible();
  await expect(page.locator(".note-index")).toBeVisible();
  await expect(page.locator(".note-inspector")).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "列表与编辑器", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({
    animations: "disabled",
    path: "../../artifacts/ui-writing-browse.png",
  });
  const browseWidth = (await page.locator(".document-workspace").boundingBox())!
    .width;
  await page.getByRole("button", { name: "切换导航栏", exact: true }).click();
  await expect(page.locator(".library-nav")).toBeVisible();
  await page.getByRole("button", { name: "切换笔记列表", exact: true }).click();
  await expect(page.locator(".note-index")).not.toBeVisible();
  await expect(page.locator(".library-nav")).toBeVisible();
  await page.getByRole("button", { name: "完整布局", exact: true }).click();
  await expect(page.locator(".note-index")).toBeVisible();
  await expect(page.locator(".note-inspector")).toBeVisible();
  await page.getByLabel("向右拆分", { exact: true }).click();
  await expect(page.locator(".note-pane")).toHaveCount(2);
  await page.keyboard.press("ControlOrMeta+1");
  await expect(page.locator(".library-nav")).not.toBeVisible();
  await expect(page.locator(".note-index")).not.toBeVisible();
  await expect(page.locator(".note-inspector")).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "专注写作", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    (await page.locator(".document-workspace").boundingBox())!.width,
  ).toBeGreaterThan(browseWidth + 200);
  await page.screenshot({
    animations: "disabled",
    path: "../../artifacts/ui-writing-focus.png",
  });
  await page.keyboard.press("ControlOrMeta+2");
  await expect(
    page.locator(".note-pane").filter({ visible: true }),
  ).toHaveCount(2);
  await expect(page.locator(".note-index")).toBeVisible();
  await page.getByLabel("收起笔记列表", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "专注写作", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("obryth.workspace.chrome.v1") ?? "{}")
            .list,
      ),
    )
    .toBe(false);
  await page.reload();
  await expect(page.locator(".note-index")).not.toBeVisible();
  await expect(page.locator(".library-nav")).not.toBeVisible();
  await expect(
    page.locator(".home-pane").filter({ visible: true }),
  ).toBeVisible();
  await page.locator(".home-note").first().click();
  await page.getByRole("button", { name: "列表与编辑器", exact: true }).click();
  await page.getByRole("button", { name: "专注写作", exact: true }).click();
  const focusedNote = page.locator(".note-pane").filter({ visible: true });
  await focusedNote.getByRole("button", { name: "源码", exact: true }).click();
  await focusedNote
    .getByRole("button", { name: "VIM OFF", exact: true })
    .click();
  await focusedNote.locator(".cm-content").click();
  await page.keyboard.press("i");
  await page.keyboard.press("Escape");
  await expect(page.locator(".note-index")).not.toBeVisible();
  await expect(
    focusedNote.getByRole("button", { name: "VIM ON", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "专注写作", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".note-index")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+3");
  await expect(page.locator(".library-nav")).toBeVisible();
  await expect(page.locator(".note-inspector")).toBeVisible();
  expect(errors).toEqual([]);
});

test("collapsed navigation keeps shortcuts and selecting a collection restores its list", async ({
  page,
}) => {
  const rail = page.getByRole("navigation", { name: "快捷功能" });
  await expect(rail).toBeVisible();
  await rail.getByLabel("快速搜索", { exact: true }).click();
  await expect(page.getByRole("dialog", { name: "命令面板" })).toBeVisible();
  await page.keyboard.press("Escape");
  await rail.getByLabel("研究浏览器", { exact: true }).click();
  await expect(page.locator(".browser-start")).toBeVisible();
  await rail.getByLabel("笔记导航", { exact: true }).click();
  await expect(page.locator(".library-nav")).not.toBeVisible();
  await expect(page.locator(".note-index")).toBeVisible();
  await page.getByLabel("切换导航栏", { exact: true }).click();
  await expect(page.locator(".library-nav")).toBeVisible();
  await page.getByLabel("收起笔记列表", { exact: true }).click();
  await page
    .locator(".library-tags")
    .getByRole("button", { name: "dev 4", exact: true })
    .click();
  await expect(page.locator(".note-index")).toBeVisible();
  await expect(page.locator(".index-note")).toHaveCount(4);
  await page.getByLabel("筛选笔记").fill("多设备");
  await expect(page.locator(".index-note")).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+Shift+Backslash");
  await expect(page.locator(".note-index")).not.toBeVisible();
  await page.keyboard.press("ControlOrMeta+Shift+Backslash");
  await expect(page.getByLabel("筛选笔记")).toHaveValue("多设备");
  await expect(page.locator(".index-note")).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+Backslash");
  await expect(rail).toBeVisible();
  await expect(page.locator(".library-nav")).not.toBeVisible();
  await page.reload();
  await expect(rail).toBeVisible();
  await expect(page.locator(".library-nav")).not.toBeVisible();
  await expect(page.getByLabel("切换导航栏", { exact: true })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
});

for (const width of [1440, 1000]) {
  test(`collection shortcuts preserve collapsed navigation at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 960 });
    const rail = page.getByRole("navigation", { name: "快捷功能" });
    const expectCollapsed = async () => {
      await expect(rail).toBeVisible();
      await expect(page.locator(".library-nav")).not.toBeVisible();
      await expect(page.locator(".navigation-scrim")).toHaveCount(0);
      await expect(
        page.getByLabel("切换导航栏", { exact: true }),
      ).toHaveAttribute("aria-expanded", "false");
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              JSON.parse(localStorage.getItem("obryth.workspace.chrome.v1")!)
                .navigation,
          ),
        )
        .toBe(false);
    };

    await page.getByLabel("返回主页", { exact: true }).click();
    await rail.getByLabel("收件箱", { exact: true }).click();
    await expect(page.locator(".note-index > header strong")).toHaveText(
      "收件箱",
    );
    await expect(page.locator(".index-note")).toHaveCount(2);
    await expect(rail.getByLabel("收件箱", { exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expectCollapsed();

    await rail.getByLabel("研究浏览器", { exact: true }).click();
    await expect(page.locator(".browser-start")).toBeVisible();
    await rail.getByLabel("笔记导航", { exact: true }).click();
    await expect(page.locator(".index-note")).toHaveCount(7);
    await expectCollapsed();

    await page.getByRole("button", { name: "专注写作", exact: true }).click();
    await expect(page.locator(".note-index")).not.toBeVisible();
    await rail.getByLabel("收件箱", { exact: true }).click();
    await expect(page.locator(".index-note")).toHaveCount(2);
    await expectCollapsed();

    await page.reload();
    await expect(
      page.locator(".home-pane").filter({ visible: true }),
    ).toBeVisible();
    await expectCollapsed();
    await rail.getByLabel("收件箱", { exact: true }).click();
    await expect(page.locator(".index-note")).toHaveCount(2);
    await expectCollapsed();
  });
}

test("compact navigation overlays the canvas and closes after selecting a view", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 780 });
  const canvasWidth = (await page.locator(".document-workspace").boundingBox())!
    .width;
  await page.getByLabel("切换导航栏", { exact: true }).click();
  await expect(page.locator(".library-nav")).toBeVisible();
  expect((await page.locator(".document-workspace").boundingBox())!.width).toBe(
    canvasWidth,
  );
  await page
    .locator(".library-nav")
    .getByRole("button", { name: "星标笔记 1", exact: true })
    .click();
  await expect(page.locator(".library-nav")).not.toBeVisible();
  await expect(page.locator(".navigation-scrim")).toHaveCount(0);
  await expect(page.locator(".index-note")).toHaveCount(1);
  await page.getByLabel("切换导航栏", { exact: true }).click();
  await page
    .getByLabel("关闭导航浮层", { exact: true })
    .click({ position: { x: 800, y: 100 } });
  await expect(page.locator(".library-nav")).not.toBeVisible();
  await page.screenshot({
    animations: "disabled",
    path: "../../artifacts/ui-sidebar-compact.png",
  });
});

test("theme and glass material are independent, persisted and respect accessibility", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-material", "solid");
  await page
    .locator(".navigation-rail")
    .getByLabel("外观设置", { exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "设置", exact: true });
  await expect(
    dialog.getByRole("button", { name: "跟随系统", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await dialog.getByRole("button", { name: "浅色", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Liquid Glass", exact: false })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).toHaveAttribute("data-material", "glass");
  await page.getByLabel("关闭设置", { exact: true }).click();
  await page.getByLabel("切换导航栏", { exact: true }).click();
  await page.screenshot({
    animations: "disabled",
    path: "../../artifacts/ui-glass-light.png",
  });
  await page
    .locator(".library-nav")
    .getByLabel("切换主题", { exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-material", "glass");
  await page.screenshot({
    animations: "disabled",
    path: "../../artifacts/ui-glass-dark.png",
  });
  await page.getByLabel("收起导航栏", { exact: true }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-material", "glass");
  await expect(page.locator(".navigation-rail")).toBeVisible();
  await page.emulateMedia({ contrast: "more", reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveAttribute("data-material", "solid");
  await page
    .locator(".navigation-rail")
    .getByLabel("外观设置", { exact: true })
    .click();
  await expect(dialog).toContainText("已遵循系统的减少透明度或增强对比度设置");
  await expect(
    dialog.getByRole("button", { name: "Liquid Glass", exact: false }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.emulateMedia({ contrast: "no-preference" });
  await expect(page.locator("html")).toHaveAttribute("data-material", "glass");
  await dialog.getByRole("button", { name: "实色", exact: false }).click();
  await expect(page.locator("html")).toHaveAttribute("data-material", "solid");
  await dialog.getByRole("button", { name: "跟随系统", exact: true }).click();
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
