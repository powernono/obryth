let tab, site;
const button = document.getElementById("import"),
  status = document.getElementById("status");
chrome.tabs
  .query({ active: true, currentWindow: true })
  .then((tabs) => {
    tab = tabs[0];
    site = new URL(tab.url);
    if (!["http:", "https:"].includes(site.protocol))
      throw new Error("请在 HTTP 或 HTTPS 站点打开此扩展。");
    document.getElementById("site").textContent = site.hostname;
    button.disabled = false;
  })
  .catch((error) => {
    status.textContent = error.message;
  });
button.addEventListener("click", async () => {
  button.disabled = true;
  try {
    const allowed = await chrome.permissions.request({
      origins: [`${site.protocol}//${site.hostname}/*`],
    });
    if (!allowed) throw new Error("站点授权已取消。");
    const stores = await chrome.cookies.getAllCookieStores();
    const store = stores.find((item) => item.tabIds.includes(tab.id));
    if (!store) throw new Error("无法识别当前浏览器 Profile。");
    const cookies = (await chrome.cookies.getAll({ storeId: store.id })).filter(
      (cookie) => {
        const domain = cookie.domain.replace(/^\./, "");
        return site.hostname === domain || site.hostname.endsWith(`.${domain}`);
      },
    );
    const result = await chrome.runtime.sendNativeMessage(
      "app.obryth.browser_bridge",
      { version: 1, url: site.origin, cookies },
    );
    if (!result.ok) throw new Error(result.error ?? "导入失败");
    status.textContent = `已安全交给本机 Obryth：${result.count} 个 Cookie。\n请打开 Obryth 浏览器 → 导入登录态，确认此站点。`;
  } catch (error) {
    status.textContent = error.message ?? String(error);
  } finally {
    button.disabled = false;
  }
});
