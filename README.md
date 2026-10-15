# Obryth

[![Rust](https://img.shields.io/badge/Rust-2021-000000?style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8D8?style=flat-square&logo=tauri&logoColor=white)](https://v2.tauri.app/)
[![React 19](https://img.shields.io/badge/React-19-149ECA?style=flat-square&logo=react&logoColor=white)](https://react.dev/)
[![Prospero](https://img.shields.io/badge/Prospero-Agent%20%26%20PTY-6D5AE6?style=flat-square&logo=github&logoColor=white)](https://github.com/linn0x/Prospero)

本地优先的笔记、终端与 AI 工作空间。桌面工作区、独立 CLI/TUI 与移动端共用 Rust 知识核心。

当前为可运行的 **0.1 开发版本**。已经实现核心笔记、加密同步、桌面工作区、独立终端入口、API 检索与 Prospero 适配。macOS 已完成本地构建；Windows、iOS/Android 仍需平台验收，完整移动编辑体验与正式签名升级尚未完成。

## 主要功能

- **本地知识库**：Markdown/frontmatter、全文搜索、标签、双向链接、保存历史与附件管理。
- **多面板工作区**：富文本、源码与 Vim 编辑，标签和分屏恢复，深浅主题与 Liquid Glass 材质。
- **日常记录**：主页快速输入、自动保存历史、可调时间范围的活动热力图与按日记录流。
- **终端与 Agent**：桌面终端、独立 CLI/TUI，以及基于 Prospero 的会话、任务和审批能力。
- **API 与同步**：用户配置的模型 API、知识范围检索、MCP、AI 修改审阅与加密 WebDAV 同步。

## 核心技术与开源基础

桌面应用采用 **Tauri 2 + React**，**Rust** 承担本地知识库、同步与 CLI/TUI 能力。**[Prospero](https://github.com/linn0x/Prospero)** 提供 Agent 会话、PTY 终端及加密连接的基础能力。

Prospero 以固定源码快照集成，当前提交为 [`b4e3424`](https://github.com/linn0x/Prospero/commit/b4e34246716cb5c74db620554cb9ba6bcfbe0f34)，保留其 MIT 许可证与作者署名。第三方来源及许可见 [THIRD_PARTY.md](THIRD_PARTY.md)。

## 快速开始

需要 Node.js 22、pnpm 11、Rust stable。macOS 桌面构建需要 Xcode Command Line Tools；Windows 需要 MSVC C++ Build Tools 与 WebView2。仓库中安装的 `.tools/` 工具链仅用于开发，不随应用分发。

```sh
git clone https://github.com/powernono/obryth.git
cd obryth
pnpm install --frozen-lockfile
pnpm protocol:build
pnpm prospero:build
pnpm desktop
```

只查看网页界面：`pnpm dev`。预览会明确标识运行环境，笔记存在当前浏览器；真实终端、系统密钥和同步使用原生客户端。

默认知识库为用户目录下的 `Obryth`，可通过 `OBRYTH_VAULT` 或 CLI 的 `--vault` 指定独立目录。项目目录本身不会自动成为知识库。

桌面启动时默认打开主页，同时恢复原有标签和分屏；关闭最后一个工作区标签后自动回到主页，也可以点击标题栏的主页按钮。主页支持快速保存随手记（`⌘/Ctrl+Enter`）、保留未提交草稿、最近编辑和星标入口。

主页的「保存活动」默认按设备时区展示最近 **30 天**，可切换最近 7/30/90/180 天、一年或历史年份。默认不选日期，记录流显示范围内全部记录；点击日期后以放大效果表示选中，再次点击可取消。跨天及休眠恢复时自动校准日期，不会自动选中新一天。每个成功保存的版本计一次（包含自动保存），可以按日期和笔记类型筛选；同篇笔记当天合并成一张卡片，展开「保存 N 次」查看只读版本。删除笔记后历史仍可回看，删除操作本身不计数。浏览器预览也会持久保存新版本；旧预览仅能迁移当前版本，会提示此前历史缺失。主页临时隐藏笔记索引、详情和写作工具，返回笔记后恢复布局偏好。

源码模式使用独立的宽版编辑区，行号随位数自然增长；正文由编辑器滚动，支持自动换行、折叠、撤销及 Vim。macOS 的原生窗口按钮与 46 px 顶部工具栏共用垂直中心线。

“设置 → 外观”默认使用雾蓝主题色，提供六种预设、取色器与 HEX 自定义输入；导航、按钮、主页热力图、玻璃光感和跟随外观的终端即时更新，自动保存，并适配深浅外观的对比度。Liquid Glass 覆盖导航、主页、编辑区与右侧面板。“设置 → 终端”提供液态玻璃、跟随外观、午夜、北境、松林、纸笺六套主题；也可以在终端工具栏直接切换。终端外观即时更新、自动保存，不重启 Shell 会话；系统减少透明度或增强对比度时使用实色。macOS 客户端使用系统材质，浏览器预览使用 CSS 模糊与透明效果。

## 独立 CLI / TUI

```sh
bash scripts/cargo.sh build --release -p obryth-cli
target/release/obryth --vault ~/Obryth init
target/release/obryth tui
target/release/obryth new --title "开发记录" --tag dev --editor nvim
target/release/obryth capture --title "测试记录" -- cargo test
target/release/obryth search WebDAV --tag dev --json
target/release/obryth terminal
```

`terminal [会话ID]` 创建或接管 Prospero PTY，`Ctrl+\` 返回而保留进程。TUI 中 `j/k` 导航、`/` 搜索、`/#tag` 筛选标签、`e` 编辑、`Ctrl+S` 保存、`v` 打开 `$VISUAL`/`$EDITOR`、`b` 查看反向链接、`a` 进入 Agent 工作台。窄窗口中按 Enter 切换笔记预览。内部编辑草稿保存在知识库的 `.obryth/drafts/`。

Agent 工作台可发送任务、查看时间线、审批、中断、创建 Codex 会话及接管已有 PTY。关闭面板与结束进程分别处理，恢复布局不会重放命令。

## API、知识与同步

桌面“设置”可以导入/导出模型 API 配置、管理系统凭据、配置 WebDAV、审阅 AI 修改建议及启用本地插件。支持 OpenAI compatible、Responses 和 Anthropic 协议；embedding 由用户配置的 API 提供。

基础全文搜索、标签、链接和反向链接完全离线。包含标签取并集，排除标签优先。MCP 只提供范围内的读取、检索、反向链接与修改建议，修改经审阅后应用。

```sh
obryth --vault ~/Obryth mcp --tag project --exclude-tag private
obryth ask "总结同步设计" --agent codex --tag project
obryth ask "总结同步设计" --profile SERVICE_ID --model MODEL --tag project
```

Agent 的 MCP 配置请使用上述 stdio 命令。Obryth 不修改现有 Agent 的全局账户或配置。标签范围只约束知识工具；Agent 的文件与 Shell 权限由其运行环境另行控制。

Markdown/frontmatter 保存正文，附件使用内容摘要去重。WebDAV 上传不可变加密版本及加密附件，记录父版本和删除标记；非重叠正文修改自动合并，重叠修改保留双方内容。配对文件包含恢复密钥。详细数据格式和现有限制见 [架构说明](docs/architecture.md)。

## 移动端

```sh
pnpm protocol:build
pnpm mobile:bindings
bash scripts/mobile-ios.sh       # 完整 Xcode
# 或设置 ANDROID_NDK_HOME 后：
bash scripts/mobile-android.sh
pnpm --filter @obryth/mobile prebuild
pnpm --filter @obryth/mobile ios # 或 android
```

需要 development build，Expo Go 无法加载 Rust 模块。已经生成 Swift/Kotlin 绑定，移动端 JS 可独立打包；当前开发环境未完成 iOS/Android 原生编译与真机验收。参见 [移动端构建](docs/mobile.md)。

## 检查与构建

```sh
pnpm typecheck
pnpm test
pnpm test:rust
pnpm --filter @obryth/desktop exec playwright install chromium
pnpm --filter @obryth/desktop test:e2e
bash scripts/cargo.sh build -p obryth-cli
pnpm smoke
python3 scripts/tui-smoke.py     # POSIX 真实终端回归
pnpm desktop:build
```

原生浏览器探针：`bash scripts/cargo.sh build --release -p obryth-desktop --features native-smoke,custom-protocol` 后运行 `python3 scripts/native-smoke.py`。探针特性仅用于本地验证，标准安装包不包含探针入口。

macOS 本地分发包：先构建 release CLI 与标准 `.app`。本地开发包可使用 `codesign --force --deep --sign - target/release/bundle/macos/Obryth.app` 添加 ad-hoc 签名，再运行 `python3 scripts/package-macos.py`；在 `artifacts/releases/` 输出 GUI zip、包含 Prospero 的 CLI/TUI tar.gz、实际大小与 SHA256。打包脚本校验签名，不使用 Developer ID、不公证或发布。

基准夹具：`bash scripts/cargo.sh run --release -p obryth-core --bin benchmark -- NEW_DIRECTORY 10000 200000`。生成一万条笔记、二十万条消息和五万字符文档；目录必须是新目录。使用批量夹具测量读取，生成时间不代表正常编辑的持久化吞吐。

浏览器扩展安装见 [Cookie bridge](docs/browser.md)，本地插件示例见 [插件开发](docs/plugins.md)。

## 代码结构

| 路径                   | 职责                                                          |
| ---------------------- | ------------------------------------------------------------- |
| `crates/obryth-core`   | Markdown、SQLite/FTS、历史、冲突、加密 WebDAV、API 与知识检索 |
| `crates/obryth-cli`    | 本地 RPC 服务、CLI/TUI、MCP、PTY 接管、Native Messaging       |
| `crates/obryth-mobile` | 移动端 Rust 接口                                              |
| `apps/desktop`         | 桌面界面、编辑器、多面板工作区与终端                          |
| `apps/mobile`          | 移动端界面、原生桥接及 Prospero 加密直连                      |
| `packages`             | Rust 生成的 TypeScript 契约、插件 SDK                         |
| `vendor/prospero`      | 保留 MIT 许可的 Prospero 固定快照                             |

没有内置模型下载、推理引擎或默认本地 embedding 模型。

## 许可证

Obryth 使用 [MIT License](LICENSE)。第三方依赖遵循各自的许可证，来源与随包许可说明见 [THIRD_PARTY.md](THIRD_PARTY.md)。
