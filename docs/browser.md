# 浏览器与 Cookie bridge

桌面使用系统原生子 WebView，支持多个浏览器面板、导航、页面剪藏、按主机启用的用户脚本及 Cookie 导入。首版使用同一个知识库浏览器 Profile；Cookie 不写入笔记或 WebDAV。

左侧“研究浏览器”打开独立浏览空间：垂直页面列表支持查找、固定、关闭与布局恢复，底部可访问已剪藏的笔记。起始页支持网址或关键词搜索，`⌘/Ctrl+T` 新建页面，`⌘/Ctrl+L` 聚焦地址栏。完成页面加载后，列表标题与地址栏会跟随原生页面更新；SPA 的无加载路由变化尚需进一步适配。

## 安装 Chrome / Edge 扩展

1. 在扩展管理页启用开发者模式，加载 `extensions/browser-companion`。
2. 复制扩展 ID，构建 CLI 或桌面应用。
3. macOS 注册 Native Messaging host：

```sh
python3 scripts/install-browser-bridge.py \
  --extension-id EXTENSION_ID \
  --executable /absolute/path/to/obryth \
  --vault /absolute/path/to/vault \
  --browser chrome
```

`--browser edge` 用于 Edge。`--output NEW_DIRECTORY` 只生成 wrapper 与 manifest，可先检查文件再安装。脚本不会读取浏览器数据库。

4. 在目标站点打开扩展，授权该站点，点击导入。
5. Obryth 浏览器工具栏选择“导入登录态”，确认该站点。导入后刷新网页。

Cookie 来自当前浏览器 Profile 的官方 Cookie API，按站点过滤，经 Native Messaging 送入 Rust；待确认内容先加密保存。分区 Cookie 会跳过；设备绑定、LocalStorage 等其他状态可能仍要求登录。

## Windows 注册

构建 `obryth-browser-bridge.exe`，Native Messaging manifest 的 `path` 指向它，名称为 `app.obryth.browser_bridge`，`type` 为 `stdio`，`allowed_origins` 仅包含你的扩展 ID。默认知识库为 `%USERPROFILE%\Obryth`，可设置 `OBRYTH_VAULT`。

将 manifest 的绝对路径注册到以下 HKCU 项的默认值：

```text
Software\Google\Chrome\NativeMessagingHosts\app.obryth.browser_bridge
Software\Microsoft\Edge\NativeMessagingHosts\app.obryth.browser_bridge
```

Windows 注册流程尚未在当前 Mac 上验收。后续安装器应完成当前用户范围的注册与卸载。

## 权限与验证

外部页面不能调用笔记、凭据、PTY 或 Agent 接口。用户脚本只在声明的 hostname 执行，应用调用检查主视图及应用来源。网页、脚本和 Cookie 均作为不可信输入处理。

子 WebView 使用固定的 Tauri/wry 版本及 unstable API。缩放、DPI、多屏拖拽、系统弹窗遮挡、登录跳转和 Windows WebView2 行为仍需要平台人工验收；原生探针只覆盖受控网页的创建、几何、脚本、权限与 Cookie 路径。

参考：[Chrome Cookies](https://developer.chrome.com/docs/extensions/reference/api/cookies)、[Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)。
