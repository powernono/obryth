import { test, expect } from "@playwright/test";
test("plugin worker commands enforce permissions and isolate panel scripts", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "obryth.preview.preferences.v1",
      JSON.stringify({ "plugins.enabled": ["test.worker"] }),
    );
    localStorage.setItem(
      "obryth.preview.plugins",
      JSON.stringify([
        {
          manifest: {
            id: "test.worker",
            name: "Worker fixture",
            version: "0.1.0",
            apiVersion: 1,
            platforms: ["desktop"],
            permissions: ["commands", "panels"],
            entry: "entry.js",
          },
          code: `globalThis.ObrythPlugin={async activate(ctx){ctx.registerCommand({id:'check',title:'检查插件隔离',async run(){let denied=false;try{await ctx.search('',{});}catch(error){denied=String(error).includes('notes.read');}await ctx.registerPanel({id:'result',title:'插件探针',html:'<p>'+ (denied&&typeof window==='undefined'?'permission-denied-worker-ok':'FAILED')+'</p><script>parent.localStorage.setItem("plugin-escape","bad")<\\/script>'});await ctx.openPanel('result');}});}};`,
        },
      ]),
    );
  });
  await page.goto("/");
  await expect(
    page.locator(".home-pane").filter({ visible: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "笔记导航", exact: true }).click();
  await page.locator(".index-note").first().click();
  await expect(page.locator(".prose-editor")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("button", { name: "检查插件隔离", exact: true }).click();
  await expect(
    page.frameLocator('iframe[title="插件探针"]').locator("p"),
  ).toHaveText("permission-denied-worker-ok");
  expect(
    await page.evaluate(() => localStorage.getItem("plugin-escape")),
  ).toBeNull();
});
test("writes Markdown, preserves unknown blocks and restores a split layout", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.locator(".home-pane").filter({ visible: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "笔记导航", exact: true }).click();
  await page.locator(".index-note").first().click();
  await expect(page.locator(".prose-editor")).toBeVisible();
  await page
    .locator(".app-titlebar")
    .getByRole("button", { name: "新建笔记", exact: true })
    .click();
  await expect(page.getByLabel("笔记标题", { exact: true }).last()).toHaveValue(
    "未命名笔记",
  );
  await page
    .getByLabel("笔记标题", { exact: true })
    .last()
    .fill("可持久保存的研究记录");
  await page.getByRole("button", { name: "源码", exact: true }).last().click();
  const editor = page.locator(".cm-content").last();
  await editor.click();
  await editor.press("ControlOrMeta+A");
  await page.keyboard.insertText(
    '# 同步研究\n\n第一段内容。\n\n<custom-widget mode="x">保留原文</custom-widget>\n',
  );
  await expect(page.locator(".save-status").last()).toContainText("已保存");
  await page.getByRole("button", { name: "文档", exact: true }).last().click();
  await expect(page.locator(".prose-editor").last()).toContainText(
    "第一段内容",
  );
  await page
    .locator(".prose-editor")
    .last()
    .getByText("第一段内容。", { exact: true })
    .click();
  await page.keyboard.press("End");
  await page.keyboard.insertText("添加引用。");
  await expect(page.locator(".save-status").last()).toContainText("已保存");
  await page.getByRole("button", { name: "源码", exact: true }).last().click();
  await expect(page.locator(".cm-content").last()).toContainText(
    '<custom-widget mode="x">保留原文</custom-widget>',
  );
  await page.getByLabel("向右拆分", { exact: true }).click();
  await expect(page.locator(".note-pane")).toHaveCount(2);
  await expect(page.locator(".cm-content").last()).toContainText("同步研究");
  await expect
    .poll(async () =>
      page.evaluate(() =>
        JSON.parse(
          localStorage.getItem("obryth.preview.preferences.v1") ?? "{}",
        )["workspace.layout"]?.panels
          ? Object.keys(
              JSON.parse(
                localStorage.getItem("obryth.preview.preferences.v1") ?? "{}",
              )["workspace.layout"].panels,
            ).length
          : 0,
      ),
    )
    .toBe(4);
  await page.reload();
  await expect(
    page.locator(".home-pane").filter({ visible: true }),
  ).toBeVisible();
  await page
    .getByRole("tab", { name: "可持久保存的研究记录", exact: true })
    .first()
    .click();
  await expect(page.locator(".note-pane")).toHaveCount(2);
  await expect(page.getByLabel("笔记标题", { exact: true }).last()).toHaveValue(
    "可持久保存的研究记录",
  );
  expect(errors).toEqual([]);
  await page.screenshot({ path: "../../artifacts/desktop-split.png" });
});
test("search, terminal state and API credentials distinguish preview from native", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.locator(".home-pane").filter({ visible: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "笔记导航", exact: true }).click();
  await page.locator(".index-note").first().click();
  await expect(page.locator(".prose-editor")).toBeVisible();
  await page.getByRole("button", { name: "切换导航栏", exact: true }).click();
  await page.getByRole("button", { name: "终端工作区", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "启动终端", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".terminal-pane")).toContainText(
    "真实终端需要桌面客户端",
  );
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("button", { name: "搜索知识库", exact: true }).click();
  await page.getByLabel("搜索知识库", { exact: true }).fill("思考");
  await expect(page.locator(".search-result")).toHaveCount(1);
  await page.getByRole("button", { name: "设置与连接", exact: true }).click();
  await page.getByLabel("API Key", { exact: false }).fill("do-not-persist");
  await page.getByLabel("服务名称", { exact: true }).fill("测试配置");
  await page.getByRole("button", { name: "保存服务", exact: false }).click();
  await expect(page.locator(".settings-status")).toContainText(
    "native credential store",
  );
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    "do-not-persist",
  );
  await page.getByLabel("关闭设置", { exact: true }).click();
  await page.getByLabel("工作区布局", { exact: true }).selectOption("dev");
  await expect(page.locator(".terminal-pane")).toBeVisible();
  await expect(page.locator(".agent-pane")).toBeVisible();
  await page.screenshot({ path: "../../artifacts/desktop-developer.png" });
});
