import { test, expect, type Page } from "@playwright/test";

test.use({ timezoneId: "Asia/Shanghai" });
async function fixture(page: Page, clockAt?: Date) {
  if (clockAt) await page.clock.install({ time: clockAt });
  else await page.clock.setFixedTime(new Date("2026-10-15T04:00:00Z"));
  await page.addInitScript(() => {
    if (localStorage.getItem("obryth.preview.vault.v2")) return;
    const notes = Array.from({ length: 26 }, (_, i) => ({
      id: `activity-${i}`,
      title:
        i === 0
          ? "把日常，慢慢写成自己的知识"
          : i === 1
            ? "写作与思考的工作流"
            : `阅读与开发记录 ${i}`,
      body:
        i === 0
          ? "今天发现，**记录的价值在于回来再看**。\n\n把零散的想法放在一起，才看见它们之间的联系。\n\n- 一个更轻的输入入口\n- 一段可以回看的时间\n- 留给下一个想法的空间"
          : i === 1
            ? "## 写下来，再往前一步\n\n" +
              Array.from(
                { length: 24 },
                (_, n) => `第 ${n + 1} 个想法：保持清晰，也保持好奇。\n`,
              ).join("\n")
            : "整理今天的阅读与实践。让每次尝试都留下可以继续的线索。",
      kind:
        i === 0 || i % 3 === 0 ? "memo" : i % 3 === 1 ? "document" : "runbook",
      tags: i === 0 ? ["日常", "思考"] : [i % 2 ? "阅读" : "开发"],
      pinned: i < 3,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: i === 0 ? "2026-10-15T03:24:00Z" : "2026-10-14T04:00:00Z",
      revision: `head-${i}`,
      source: null,
      extra: {},
    }));
    const revisions = notes.slice(1).map((note) => ({
      id: note.revision,
      noteId: note.id,
      timestamp: note.updatedAt,
      note,
    }));
    for (let i = 0; i < 25; i++) {
      const timestamp = `2026-10-15T03:${String(i).padStart(2, "0")}:00Z`;
      const note = {
        ...notes[0],
        revision: `daily-${i}`,
        body: i === 24 ? notes[0].body : `当天的第 ${i + 1} 次修改。`,
        updatedAt: timestamp,
      };
      revisions.push({ id: note.revision, noteId: note.id, timestamp, note });
    }
    notes[0].revision = "daily-24";
    for (let day = 0; day < 210; day++) {
      if (day % 5 === 0 || day % 7 === 0) continue;
      const when = new Date(Date.UTC(2026, 2, 1 + day, 4));
      for (let edit = 0; edit < (day % 6) + 1; edit++) {
        const note = { ...notes[day % 26], revision: `past-${day}-${edit}` };
        revisions.push({
          id: note.revision,
          noteId: note.id,
          timestamp: when.toISOString(),
          note,
        });
      }
    }
    localStorage.setItem(
      "obryth.preview.vault.v2",
      JSON.stringify({
        version: 2,
        notes,
        revisions,
        historyIncomplete: false,
      }),
    );
    localStorage.setItem(
      "obryth.appearance.v1",
      JSON.stringify({ theme: "light", material: "glass" }),
    );
  });
  await page.goto("/");
  await expect(page.locator(".activity-card").first()).toBeVisible();
}

test("heatmap, grouped versions, filtering, pagination and saved layout", async ({
  page,
}) => {
  await fixture(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await expect(page.locator(".note-index")).toBeHidden();
  await expect(page.locator(".note-inspector")).toHaveCount(0);
  await expect(page.getByLabel("专注写作", { exact: true })).toHaveCount(0);
  const card = page
    .locator('.activity-card[data-note-id="activity-0"]')
    .first();
  await expect(card).toContainText("保存 25 次");
  await card.getByRole("button", { name: "保存 25 次" }).click();
  await expect(card.locator(".activity-versions details")).toHaveCount(20);
  await card.getByRole("button", { name: "更多保存版本" }).click();
  await expect(card.locator(".activity-versions details")).toHaveCount(25);
  await card.locator(".activity-versions summary").first().click();
  await expect(
    card.locator(".activity-versions details").first(),
  ).toContainText("记录的价值");
  await card.getByRole("button", { name: "保存 25 次" }).click();
  const today = page.locator('.heatmap-day[data-date="2026-10-15"]');
  await expect(today).toHaveAttribute("aria-label", /25 次保存 · 1 篇笔记/);
  await today.click();
  await expect(page.locator(".activity-card")).toHaveCount(1);
  await today.focus();
  await page.keyboard.press("ArrowUp");
  await expect(
    page.locator('.heatmap-day[data-date="2026-10-14"]'),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".activity-card")).toHaveCount(20);
  await page.getByRole("button", { name: "加载更多记录" }).click();
  await expect(page.locator(".activity-card")).toHaveCount(25);
  await page.getByLabel("清除日期筛选").click();
  await expect(page.locator(".activity-card")).toHaveCount(20);
  await page.locator('.heatmap-day[data-date="2026-10-14"]').click();
  await expect(page.locator(".activity-card")).toHaveCount(20);
  await page.getByLabel("清除日期筛选").click();
  await page
    .getByRole("navigation", { name: "记录类型" })
    .getByRole("button", { name: "文档", exact: true })
    .click();
  await expect(
    page.locator(".activity-card").first().locator(".activity-kind"),
  ).toHaveText("文档");
  await expect(today).toHaveAttribute("aria-label", /0 次保存/);
  await page
    .getByRole("navigation", { name: "记录类型" })
    .getByRole("button", { name: "全部", exact: true })
    .click();
  await page.locator(".activity-open").first().click();
  await page.getByLabel("完整布局", { exact: true }).click();
  await expect(page.locator(".note-inspector")).toBeVisible();
  const preferences = await page.evaluate(() =>
    localStorage.getItem("obryth.workspace.chrome.v1"),
  );
  await page.getByLabel("返回主页", { exact: true }).click();
  await expect(page.locator(".note-index")).toBeHidden();
  await expect(page.locator(".note-inspector")).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      localStorage.getItem("obryth.workspace.chrome.v1"),
    ),
  ).toBe(preferences);
  await page.locator(".activity-open").first().click();
  await expect(page.locator(".note-index")).toBeVisible();
  await expect(page.locator(".note-inspector")).toBeVisible();
  expect(errors).toEqual([]);
});

test("responsive home screenshots, long content and compact source gutters", async ({
  page,
}) => {
  await fixture(page);
  for (const width of [1440, 1024, 780]) {
    await page.setViewportSize({ width, height: 960 });
    for (const theme of ["light", "dark"]) {
      const rootTheme = await page.locator("html").getAttribute("data-theme");
      if (rootTheme !== theme)
        await page
          .getByRole("button", { name: "切换主题", exact: true })
          .click();
      await expect(page.locator(".home-pane")).toBeVisible();
      expect(
        await page
          .locator(".home-pane")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      await page.screenshot({
        path: `../../artifacts/home-activity-${width}-${theme}.png`,
        animations: "disabled",
      });
    }
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole("button", { name: "切换主题", exact: true }).click();
  await page
    .getByRole("navigation", { name: "记录类型" })
    .getByRole("button", { name: "文档", exact: true })
    .click();
  const document = page
    .locator('.activity-card[data-note-id="activity-1"]')
    .first();
  await document.getByRole("button", { name: "展开全文" }).click();
  await expect(document.locator(".activity-body")).toHaveClass(/expanded/);
  await document.getByRole("button", { name: "打开笔记" }).click();
  await page.getByRole("button", { name: "源码", exact: true }).click();
  const editor = page.locator(".cm-content");
  for (const lines of [1, 10, 100, 1000]) {
    await editor.click();
    await editor.press("ControlOrMeta+A");
    await page.keyboard.insertText(
      Array.from(
        { length: lines },
        (_, i) => `${i + 1}: 源码布局与行号检查`,
      ).join("\n"),
    );
    await expect(page.locator(".cm-gutters")).toBeVisible();
    const gutter = await page.locator(".cm-gutters").boundingBox();
    expect(gutter!.width).toBeLessThanOrEqual(60);
  }
  await expect(page.locator(".save-status")).toContainText("已保存");
  await editor.press("ControlOrMeta+Home");
  await page
    .locator(".cm-foldGutter .cm-gutterElement")
    .filter({ hasText: "⌄" })
    .first()
    .click();
  await expect(page.locator(".cm-foldPlaceholder")).toBeVisible();
  await page.locator(".cm-foldPlaceholder").click();
  await expect(page.locator(".cm-foldPlaceholder")).toHaveCount(0);
  await editor.press("ControlOrMeta+End");
  await editor.press("Enter");
  await page.keyboard.insertText("长行自动换行检查。".repeat(100));
  expect(
    await page
      .locator(".cm-scroller")
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
  await editor.press("ControlOrMeta+z");
  await expect(editor).not.toContainText("长行自动换行检查");
  expect(
    await page
      .locator(".editor-surface")
      .evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
  ).toBe(true);
  await page.getByRole("button", { name: "VIM OFF", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "VIM ON", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "VIM ON", exact: true }).click();
  await editor.press("ControlOrMeta+Home");
  await page.screenshot({
    path: "../../artifacts/source-gutter-1440.png",
    animations: "disabled",
  });
  await page.getByLabel("向右拆分", { exact: true }).click();
  await page.screenshot({
    path: "../../artifacts/source-gutter-split.png",
    animations: "disabled",
  });
  await page.setViewportSize({ width: 780, height: 700 });
  const toolbar = await page.locator(".app-titlebar").boundingBox();
  expect(toolbar!.height).toBe(46);
  const create = await page
    .locator(".app-titlebar .new-note-button")
    .boundingBox();
  expect(
    Math.abs(
      create!.y + create!.height / 2 - (toolbar!.y + toolbar!.height / 2),
    ),
  ).toBeLessThanOrEqual(1);
  expect(create!.x + create!.width).toBeLessThanOrEqual(780);
});

test("failed reads retry, failed saves preserve drafts and deleted history stays readable", async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(() => {
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) {
      if (
        key === "obryth.preview.vault.v2" &&
        get.call(this, "test.activityFault") === "read"
      )
        return "invalid-json";
      return get.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (
        key === "obryth.preview.vault.v2" &&
        get.call(this, "test.activityFault") === "write"
      )
        throw new DOMException("Storage full", "QuotaExceededError");
      return set.call(this, key, value);
    };
    localStorage.setItem("test.activityFault", "read");
  });
  await page.getByLabel("活动时间范围").selectOption("2026");
  await expect(page.locator(".home-activity .home-error")).toBeVisible();
  await expect(page.locator(".activity-stream .home-error")).toBeVisible();
  await page.evaluate(() => localStorage.removeItem("test.activityFault"));
  await page
    .locator(".home-activity")
    .getByRole("button", { name: "重试" })
    .click();
  await expect(page.locator(".home-error")).toHaveCount(0);
  await expect(page.locator(".activity-card").first()).toBeVisible();
  await page.evaluate(() =>
    localStorage.setItem("test.activityFault", "write"),
  );
  const input = page.locator(".home-capture textarea");
  await input.fill("失败后仍应保留的草稿 #验证");
  await input.press("ControlOrMeta+Enter");
  await expect(page.locator(".home-capture .home-error")).toContainText(
    "保存失败，草稿已保留",
  );
  await expect(input).toHaveValue("失败后仍应保留的草稿 #验证");
  await page.evaluate(() => localStorage.removeItem("test.activityFault"));
  await input.press("ControlOrMeta+Enter");
  await expect(input).toHaveValue("");
  await expect(page.locator(".activity-card").first()).toContainText(
    "失败后仍应保留的草稿",
  );
  await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem("obryth.preview.vault.v2")!);
    store.notes = store.notes.filter(
      (note: { id: string }) => note.id !== "activity-0",
    );
    localStorage.setItem("obryth.preview.vault.v2", JSON.stringify(store));
  });
  await page.reload();
  const removed = page
    .locator('.activity-card[data-note-id="activity-0"]')
    .first();
  await expect(removed).toContainText("已删除");
  await expect(removed.getByRole("button", { name: "打开笔记" })).toHaveCount(
    0,
  );
  await removed.getByRole("button", { name: "保存 25 次" }).click();
  await removed.locator(".activity-versions summary").first().click();
  await expect(
    removed.locator(".activity-versions details").first(),
  ).toContainText("记录的价值");
});

test("calendar contrast, equal spacing, tooltips and narrow glass layout", async ({
  page,
}) => {
  await fixture(page);
  await page.getByLabel("活动时间范围").selectOption("recent");
  await expect(page.locator(".heatmap-day")).toHaveCount(365);
  const measurements = [];
  for (const theme of ["light", "dark"]) {
    if ((await page.locator("html").getAttribute("data-theme")) !== theme)
      await page.getByRole("button", { name: "切换主题", exact: true }).click();
    for (const material of ["solid", "glass", "native-glass"]) {
      await page.evaluate((mode) => {
        document.documentElement.dataset.material =
          mode === "solid" ? "solid" : "glass";
        document.documentElement.dataset.nativeMaterial = String(
          mode === "native-glass",
        );
      }, material);
      const metrics = await page.locator(".home-activity").evaluate((panel) => {
        const context = document.createElement("canvas").getContext("2d")!;
        const rgba = (value: string) => {
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = value;
          context.fillRect(0, 0, 1, 1);
          return [...context.getImageData(0, 0, 1, 1).data];
        };
        const background = rgba(
          getComputedStyle(document.documentElement).getPropertyValue("--bg"),
        );
        const rgb = (color: string) => {
          const values = rgba(color);
          const alpha = values[3] / 255;
          return values
            .slice(0, 3)
            .map((channel, i) => channel * alpha + background[i] * (1 - alpha));
        };
        const luminance = (color: string) =>
          rgb(color)
            .slice(0, 3)
            .map((v) => {
              v /= 255;
              return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
            })
            .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
        const ratio = (a: string, b: string) => {
          const values = [luminance(a), luminance(b)].sort((a, b) => b - a);
          return (values[0] + 0.05) / (values[1] + 0.05);
        };
        const surface = getComputedStyle(panel).backgroundColor;
        const text = getComputedStyle(
          panel.querySelector(".heatmap-frame")!,
        ).color;
        const fills = Array.from(
          panel.querySelectorAll(".heatmap-legend i"),
        ).map((el) => getComputedStyle(el).backgroundColor);
        const rect = (day: string) =>
          panel.querySelector(`[data-date="${day}"]`)!.getBoundingClientRect();
        const a = rect("2026-10-05"),
          b = rect("2026-10-06"),
          c = rect("2026-10-12");
        return {
          surface,
          text,
          contrast: ratio(surface, text),
          fills,
          activityContrast: ratio(fills[0], fills[1]),
          luminance: fills.map(luminance),
          size: a.width,
          height: a.height,
          horizontalGap: c.x - a.x - a.width,
          verticalGap: b.y - a.y - a.height,
          surfaceAlpha: rgba(surface)[3] / 255,
          opaqueCells: fills.every((color) => rgba(color)[3] === 255),
          unoutlinedCells: [...panel.querySelectorAll(".heatmap-day")].every(
            (cell) => {
              const style = getComputedStyle(cell);
              return (
                style.stroke === "none" &&
                style.strokeWidth === "0px" &&
                style.strokeDasharray === "none"
              );
            },
          ),
          glassSurfaces: [
            ".home-activity",
            ".home-capture",
            ".activity-card",
            ".home-pinned",
            ".home-recent",
            ".home-actions > button",
            ".home-kind-filter",
          ].map((selector) => {
            const style = getComputedStyle(document.querySelector(selector)!);
            return {
              selector,
              alpha: rgba(style.backgroundColor)[3] / 255,
              blur: style.backdropFilter,
            };
          }),
          yearAlpha:
            rgba(
              getComputedStyle(panel.querySelector("select")!).backgroundColor,
            )[3] / 255,
        };
      });
      expect(metrics.opaqueCells).toBe(true);
      expect(metrics.unoutlinedCells).toBe(true);
      if (material === "solid") {
        expect(metrics.surfaceAlpha).toBe(1);
        expect(metrics.yearAlpha).toBe(1);
        for (const surface of metrics.glassSurfaces)
          expect(surface.blur).toBe("none");
      } else {
        expect(metrics.surfaceAlpha).toBeLessThan(1);
        expect(metrics.yearAlpha).toBeLessThan(1);
        for (const surface of metrics.glassSurfaces) {
          expect(surface.alpha, surface.selector).toBeLessThan(1);
          expect(surface.blur, surface.selector).toContain("blur");
        }
      }
      expect(metrics.contrast).toBeGreaterThanOrEqual(4.5);
      expect(metrics.activityContrast).toBeGreaterThanOrEqual(1.7);
      expect(metrics.size).toBeGreaterThanOrEqual(12);
      expect(metrics.size).toBe(metrics.height);
      expect(metrics.horizontalGap).toBe(3);
      expect(metrics.verticalGap).toBe(3);
      const levels = metrics.luminance.slice(1);
      expect(levels).toEqual(
        [...levels].sort((a, b) => (theme === "light" ? b - a : a - b)),
      );
      measurements.push({ theme, material, ...metrics });
    }
    await page.locator(".home-activity").screenshot({
      path: `../../artifacts/activity-calendar-v2-${theme}.png`,
    });
    await page.screenshot({
      path: `../../artifacts/home-glass-${theme}.png`,
      animations: "disabled",
    });
    const today = page.locator('.heatmap-day[data-date="2026-10-15"]');
    await today.hover();
    await expect(page.getByRole("tooltip")).toContainText("25 次保存");
    await expect(page.getByRole("tooltip")).toContainText("2026/10/15 · 今天");
    await today.focus();
    await page.keyboard.press("ArrowUp");
    const yesterday = page.locator('.heatmap-day[data-date="2026-10-14"]');
    await expect(yesterday).toBeFocused();
    await expect
      .poll(() => yesterday.evaluate((el) => getComputedStyle(el).transform))
      .toContain("1.22");
    expect(
      await yesterday.evaluate((el) => ({
        stroke: getComputedStyle(el).stroke,
        filter: getComputedStyle(el).filter,
        outline: getComputedStyle(el).outlineStyle,
      })),
    ).toEqual({ stroke: "none", filter: "none", outline: "none" });
    await expect(page.getByRole("tooltip")).toContainText("25 篇笔记");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await page.getByLabel("活动时间范围").focus();
  }
  await page.setViewportSize({ width: 780, height: 960 });
  const scroll = page.locator(".react-activity-calendar__scroll-container");
  await expect
    .poll(() => scroll.evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(0);
  expect(
    await scroll.evaluate(
      (el) => el.scrollWidth - el.clientWidth - el.scrollLeft,
    ),
  ).toBeLessThanOrEqual(1);
  expect(
    await page
      .locator(".home-pane")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await page.locator('.heatmap-day[data-date="2026-10-15"]').focus();
  await page.keyboard.press("Home");
  await expect(page.getByRole("tooltip")).toContainText("2025/10/16");
  await page.keyboard.press("End");
  await expect(page.getByRole("tooltip")).toContainText("2026/10/15");
  await page.getByLabel("活动时间范围").selectOption("2026");
  const future = page.locator('.heatmap-day[data-date="2026-10-16"]');
  await expect(future).toHaveAttribute("aria-disabled", "true");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(
    "../../artifacts/activity-calendar-v2-verification.json",
    JSON.stringify(measurements, null, 2),
  );
});

test("date changes preserve layout while loading and ignore superseded requests", async ({
  page,
}) => {
  // Instrument the module the app loads, including Vite's HMR timestamp URL.
  await page.route(/\/src\/lib\/bridge\.ts(?:\?.*)?$/, async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        `
      const originalCall = bridge.call.bind(bridge);
      window.pendingFeeds = [];
      bridge.call = async (method, params) => {
        const result = await originalCall(method, params);
        if (method !== "notes.activityFeed" || !window.delayFeeds) return result;
        return new Promise(resolve => window.pendingFeeds.push({
          from: params.range.from,
          complete: () => resolve(result),
        }));
      };
    `,
    });
  });
  await fixture(page);
  await page.setViewportSize({ width: 1440, height: 960 });
  const home = page.locator(".home-pane");
  const stream = page.locator(".activity-stream");
  const today = page.locator('.heatmap-day[data-date="2026-10-15"]');
  await today.scrollIntoViewIfNeeded();
  await home.evaluate((el) => {
    el.scrollTop = 100;
  });
  await page.evaluate(() => {
    (window as any).delayFeeds = true;
    (window as any).originalStream = document.querySelector(".activity-stream");
  });
  const geometry = () =>
    home.evaluate((el) => {
      const rect = el.querySelector(".home-activity")!.getBoundingClientRect();
      const feed = el
        .querySelector(".activity-stream")!
        .getBoundingClientRect();
      return {
        top: rect.top,
        width: rect.width,
        feedTop: feed.top,
        scroll: el.scrollTop,
      };
    });
  // Use real pointer coordinates: locator.click() can scroll SVG ancestors
  // through CDP before the click, which is unrelated to the app's update.
  const clickDay = async (date: string) => {
    const box = await page
      .locator(`.heatmap-day[data-date="${date}"]`)
      .boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  };
  const before = await geometry();
  await clickDay("2026-10-15");
  await expect(stream).toHaveAttribute("aria-busy", "true");
  await expect(page.locator(".activity-card")).toHaveCount(20);
  expect(await geometry()).toEqual(before);
  expect(
    await stream.evaluate((el) => el === (window as any).originalStream),
  ).toBe(true);
  await expect
    .poll(() => today.evaluate((el) => getComputedStyle(el).transform))
    .toContain("1.22");
  expect(
    await today.evaluate((el) => ({
      stroke: getComputedStyle(el).stroke,
      width: getComputedStyle(el).strokeWidth,
      dash: getComputedStyle(el).strokeDasharray,
      filter: getComputedStyle(el).filter,
    })),
  ).toEqual({ stroke: "none", width: "0px", dash: "none", filter: "none" });
  await clickDay("2026-10-14");
  expect(await geometry(), "after clicking yesterday").toEqual(before);
  await expect
    .poll(() => page.evaluate(() => (window as any).pendingFeeds.length))
    .toBe(2);
  await page.evaluate(() => (window as any).pendingFeeds[1].complete());
  await expect(stream).toHaveAttribute("aria-busy", "false");
  expect(await geometry(), "after yesterday loaded").toEqual(before);
  await expect(stream.locator(".activity-day-group > h2 time")).toHaveText(
    "2026.10.14",
  );
  await page.evaluate(() => (window as any).pendingFeeds[0].complete());
  await expect(stream.locator(".activity-day-group > h2 time")).toHaveText(
    "2026.10.14",
  );
  await clickDay("2026-10-15");
  expect(await geometry(), "after clicking today again").toEqual(before);
  await expect
    .poll(() => page.evaluate(() => (window as any).pendingFeeds.length))
    .toBe(3);
  await page.evaluate(() => (window as any).pendingFeeds[2].complete());
  await expect(page.locator(".activity-card")).toHaveCount(1);
  expect(await geometry()).toEqual(before);
  await page.screenshot({
    path: "../../artifacts/home-selection-stable.png",
    animations: "disabled",
  });
  // An empty day must also preserve the current scroll position.
  await clickDay("2026-10-13");
  await expect
    .poll(() => page.evaluate(() => (window as any).pendingFeeds.length))
    .toBe(4);
  await page.evaluate(() => (window as any).pendingFeeds[3].complete());
  await expect(page.locator(".activity-empty")).toBeVisible();
  expect(await geometry()).toEqual(before);
});

test("30-day default, selectable scales and compact glass heatmap", async ({
  page,
}) => {
  await fixture(page);
  const period = page.getByLabel("活动时间范围");
  const cells = page.locator(".heatmap-day");
  const selected = page.locator('.heatmap-day[aria-pressed="true"]');
  await expect(period).toHaveValue("30d");
  await expect(cells).toHaveCount(30);
  await expect(selected).toHaveCount(0);
  await expect(
    page.locator('.heatmap-day[aria-current="date"]'),
  ).toHaveAttribute("data-date", "2026-10-15");
  expect(
    await cells.evaluateAll((items) =>
      items.every((el) => getComputedStyle(el).transform === "none"),
    ),
  ).toBe(true);
  for (const [value, count] of [
    ["7d", 7],
    ["30d", 30],
    ["90d", 90],
    ["180d", 180],
    ["recent", 365],
    ["2026", 365],
  ] as const) {
    await period.selectOption(value);
    await expect(cells).toHaveCount(count);
    await expect(page.locator(".heatmap-frame")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(selected).toHaveCount(0);
  }
  await period.selectOption("30d");
  const today = page.locator('.heatmap-day[data-date="2026-10-15"]');
  await today.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(
    page.locator('.heatmap-day[data-date="2026-10-14"]'),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(selected).toHaveAttribute("data-date", "2026-10-14");
  await period.selectOption("7d");
  await expect(selected).toHaveCount(0);
  await period.selectOption("30d");
  await period.focus();
  for (const width of [1440, 780]) {
    await page.setViewportSize({ width, height: 960 });
    for (const theme of ["light", "dark"]) {
      if ((await page.locator("html").getAttribute("data-theme")) !== theme)
        await page
          .getByRole("button", { name: "切换主题", exact: true })
          .click();
      await expect(page.locator(".home-pane")).toBeVisible();
      expect(
        await page
          .locator(".home-pane")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      expect(
        await page
          .locator(".home-activity")
          .evaluate((el) => getComputedStyle(el).backdropFilter),
      ).toContain("blur");
      await page.screenshot({
        path: `../../artifacts/heatmap-30d-${width}-${theme}.png`,
        animations: "disabled",
      });
    }
  }
  await page.emulateMedia({ contrast: "more" });
  await expect(page.locator(".home-activity")).toHaveCSS(
    "backdrop-filter",
    "none",
  );
});

test("home rolls over midnight and resumes after sleep without selecting a new day", async ({
  page,
}) => {
  await fixture(page, new Date("2026-10-15T15:59:45Z"));
  const current = page.locator('.heatmap-day[aria-current="date"]');
  const selected = page.locator('.heatmap-day[aria-pressed="true"]');
  await expect(current).toHaveAttribute("data-date", "2026-10-15");
  await expect(selected).toHaveCount(0);
  await page.clock.fastForward(20_000);
  await expect(current).toHaveAttribute("data-date", "2026-10-16");
  await expect(page.locator(".home-heading > time")).toHaveAttribute(
    "datetime",
    "2026-10-16",
  );
  await expect(page.locator(".heatmap-day")).toHaveCount(30);
  await expect(
    page.locator('.heatmap-day[data-date="2026-09-16"]'),
  ).toHaveCount(0);
  await expect(selected).toHaveCount(0);
  await expect(page.locator(".heatmap-frame")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  expect(
    await current.evaluate((el) => ({
      stroke: getComputedStyle(el).stroke,
      dash: getComputedStyle(el).strokeDasharray,
      outline: getComputedStyle(el).outlineStyle,
      transform: getComputedStyle(el).transform,
    })),
  ).toEqual({
    stroke: "none",
    dash: "none",
    outline: "none",
    transform: "none",
  });
  await page.locator('.heatmap-day[data-date="2026-10-14"]').click();
  await expect(selected).toHaveAttribute("data-date", "2026-10-14");
  // A suspended window may wake days later without its timer having fired.
  await page.clock.setSystemTime(new Date("2026-10-19T01:00:00Z"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(current).toHaveAttribute("data-date", "2026-10-19");
  await expect(selected).toHaveAttribute("data-date", "2026-10-14");
  await page.clock.setSystemTime(new Date("2026-11-20T01:00:00Z"));
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(current).toHaveAttribute("data-date", "2026-11-20");
  await expect(selected).toHaveCount(0);
  await expect(page.getByLabel("清除日期筛选")).toHaveCount(0);
  // In the year grid the new day already exists as a disabled future cell.
  await page.getByLabel("活动时间范围").selectOption("2026");
  const tomorrow = page.locator('.heatmap-day[data-date="2026-11-21"]');
  await expect(tomorrow).toHaveAttribute("aria-disabled", "true");
  await page.clock.setSystemTime(new Date("2026-11-20T15:59:45Z"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.clock.fastForward(20_000);
  await expect(current).toHaveAttribute("data-date", "2026-11-21");
  await expect(tomorrow).toHaveAttribute("aria-disabled", "false");
  await expect(selected).toHaveCount(0);
  await expect(current).toHaveCSS("stroke", "none");
  await expect(current).toHaveCSS("stroke-dasharray", "none");
  await expect(current).toHaveCSS("outline-style", "none");
  await expect(current).toHaveCSS("transform", "none");
});
