# 插件 SDK 0.1

示例：`examples/plugins/daily-review`。桌面左侧“插件与扩展”选择文件夹安装，然后启用。管理页可搜索插件、查看声明权限、启停和卸载；“设置 → 插件”也保留入口。命令面板出现“每日回顾：查看最近笔记”，会打开插件面板。

插件包含 manifest.json 与打包后的 entry.js，声明 apiVersion、平台、权限及入口。入口将插件对象赋值给 `globalThis.ObrythPlugin`：

```js
globalThis.ObrythPlugin = {
  activate(context) {
    context.registerCommand({
      id: 'hello', title: '插件：问候',
      run() { context.notify('Hello from Obryth'); }
    });
  }
};
```

运行环境是独立 Worker。JS/TS 插件应打包为 IIFE；没有 Node、DOM、应用对象或系统凭据。SDK 定义位于 `packages/plugin-sdk`：

| 能力 | 声明权限 |
|---|---|
| search(query, scope) | notes.read |
| propose(noteId, baseRevision, body) | notes.propose |
| registerCommand | commands |
| registerPanel / openPanel | panels |
| fetch(url) | network，另声明 networkHosts |

网络只允许清单中 HTTPS origin，经服务代理，不附带系统凭据且不跟随重定向。面板显示隔离的无脚本 HTML；交互通过命令完成。原生插件、编辑器扩展 API、移动插件、跨端声明式自动化及外部 stdio 工具安装尚未形成完整 SDK。

CLI 可通过 `obryth rpc plugins.install '{"path":"/absolute/path/plugin"}'` 安装同一插件，但当前 JS 插件只在桌面 GUI 中激活。
