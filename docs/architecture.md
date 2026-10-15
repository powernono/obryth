# 架构与持久化

## 运行边界

桌面 GUI 和独立 CLI/TUI 通过随机 loopback 端口访问同一个笔记服务。连接描述包含协议版本、PID 和随机令牌，保存在知识库私有元数据目录。服务使用文件锁保证单实例，Rust 写锁统一处理笔记修改，文件监听与定期补扫收集外部编辑。

GUI 退出后服务可继续运行；Prospero 在首次需要 Agent/PTY 时启动。桌面可执行文件支持内部 `serve` 入口，因此笔记服务无需额外运行环境。独立 CLI 可完全脱离 GUI。

移动端在本机调用 Rust 核心与 WebDAV。密钥使用 Expo SecureStore；网络工作使用独立数据库连接。远程 Agent 仍在电脑运行，手机通过 Prospero 配对协议、固定主机公钥、临时密钥与加密 WebSocket 直连，不自动重放任务。

## 知识库目录

```text
notes/<UUID>.md                   正文与 frontmatter
attachments/<SHA256>.<ext>        托管附件
.obryth/
  vault.json, device, sync.key    知识库身份、设备身份、恢复密钥
  index.sqlite                   可重建的笔记索引、FTS、embedding 缓存
  history.sqlite                 持久的 API 对话、服务配置与工作区设置
  events/<device>/<seq>.json      本机提交日志
  revisions/<revision>.json      版本档案
  heads/<note>.json              已物化版本与路径
  pending-*.json                 中断恢复记录
  conflicts/, proposals/        同步冲突与 AI 建议
  objects/                      附件历史内容
  drafts/                       TUI 草稿
  plugins/                      本地插件
  prospero/                     独立 Agent daemon 数据
  browser-imports/              加密的待确认 Cookie 导入
```

写入先记录持久事件，再物化 Markdown、索引与当前版本指针。中断记录用于恢复未完成操作。外部编辑版本、未知 frontmatter 和 Markdown 原文均保留；保存与删除校验基础版本和文件摘要。重建笔记索引不会删除 API 历史及服务配置。

## 同步

WebDAV 使用 `MKCOL`、`PROPFIND`、`GET`、`PUT`。传输层禁止携带认证信息的 URL、跨站重定向和非 loopback 明文认证。每个知识库拥有随机 256 位密钥，AES-256-GCM 为每个对象使用随机 nonce 与知识库绑定的 AAD。

版本记录包含 UUID、父版本、设备、序号、时间、笔记快照及附件引用。附件先上传并校验，再发布引用它的版本。下载先认证数据，再处理版本图；删除标记持久保存，迟到旧版本不会覆盖较新版本。正文可在元数据一致时三方合并；其余并发保留为冲突。解决正文冲突的版本记录双方父版本。

当前仍通过全量目录清单发现远端对象，仅下载未知版本；尚未实现按设备清单与持久增量游标的传输优化。删除竞争已保留双方证据，完整删除冲突交互、密钥轮换、远端清理和大附件分块续传还需后续实现。恢复密钥丢失时没有服务器代管副本。

## 编辑、工作区与终端

Tiptap 与 CodeMirror 共用 MarkdownCodec。富文本不能表达的 HTML、公式和引用定义被作为原文区块保护；未修改文档保持原始 Markdown。富文本改动删除或复制受保护区块时阻止静默保存，源码模式可直接编辑。

Dockview 保存分组、拆分、标签与面板参数。xterm 使用原生 Tauri Channel，每个订阅只允许一个待确认输出页，完成 `write` 后 ACK。输入分片并串行提交，失败时停止发送，resize 节流；隐藏面板暂停绘制，会话仍由 Prospero 持有。CLI capture 独立保存完整 stdout/stderr 附件、预览、时间和退出码。

首版 GUI 终端支持选区摘录；尚未自动安装 Bash/Zsh/PowerShell shell integration，也没有通过提示符推测命令边界。完整的 OSC 7/133 命令块记录属于后续工作。

## API、知识与扩展

系统凭据与普通配置分离。API 配置导出仅含 secretRef。SQLite/FTS 和标签过滤是默认检索；embedding API 仅在显式配置后调用，按版本缓存分块向量并返回段落位置。MCP 提供 search_notes、read_note、get_backlinks、propose_note_patch；建议需要应用审阅且再次检查版本。

本地插件使用打包的 JS entry，在独立 Worker 内运行，无 DOM 或应用原生桥。SDK 消息按声明校验读取、建议、命令、面板及网络能力；网络请求由服务再次核对 HTTPS origin。面板为无脚本的隔离 HTML。Node/Python 工具由用户现有环境运行，不捆绑解释器。

远程网页使用独立的原生子 WebView 与浏览数据存储；应用命令检查主视图标签和应用来源。页面与用户脚本没有笔记、凭据或执行权限。Cookie 不参与笔记同步。

## 依赖与来源

Tauri 固定 2.12.3，wry 由 Cargo.lock 固定为 0.57.0。子 WebView 使用 unstable feature，后续升级需重新执行原生探针及平台验收。

Prospero 快照：`b4e34246716cb5c74db620554cb9ba6bcfbe0f34`，来源 [linn0x/Prospero](https://github.com/linn0x/Prospero)，保留原 MIT LICENSE。复用 Rust client/protocol/daemon 与移动端加密协议；Obryth UI 独立实现。

接口依据：[Tauri WebView](https://docs.rs/tauri/2.12.3/tauri/webview/struct.WebviewBuilder.html)、[Dockview React](https://dockview.dev/docs/overview/quickstart/?framework=react)、[UniFFI](https://mozilla.github.io/uniffi-rs/latest/)、[Expo SDK](https://docs.expo.dev/versions/latest/)。
