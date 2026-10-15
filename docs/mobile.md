# 移动端开发与验证

Expo SDK 57、React Native 0.86.3、React 19.2.3；iOS 基线 16.4，Android minSdk 29。原生知识核心通过 UniFFI 0.29 生成 Swift/Kotlin，再由本地 Expo Module 导出 open/call。

## 构建

先 `pnpm install --frozen-lockfile`、`pnpm protocol:build`，然后 `pnpm mobile:bindings`。绑定从宿主机 Rust 动态库读取元数据，不要求手机 SDK。

### iOS

安装适配 Expo SDK 57 的完整 Xcode（官方当前矩阵要求 Xcode 26.4+）、iOS SDK 与 CocoaPods；Command Line Tools 不能代替 iOS SDK。

```sh
bash scripts/mobile-ios.sh
pnpm --filter @obryth/mobile prebuild --platform ios
pnpm --filter @obryth/mobile ios
```

脚本编译 arm64 真机和 arm64 模拟器静态库，创建 ObrythMobile.xcframework。Swift 接口和 FFI modulemap 与 framework 一起由 Pod 引入。

### Android

需要 JDK、Android SDK 36 和 NDK r28+，设置 ANDROID_NDK_HOME。

```sh
bash scripts/mobile-android.sh
pnpm --filter @obryth/mobile prebuild --platform android
pnpm --filter @obryth/mobile android
```

脚本编译 arm64-v8a 与 x86_64，并指定 16 KiB page alignment。生成的 Kotlin 绑定使用 JNA。

## 当前体验

手机采用笔记列表与单编辑面板，平板采用双栏。源码编辑支持等宽字体、Markdown 键盘栏、标题/标签、草稿保存和版本校验；预览是安全的基础文本/Markdown 视图。API Key 与 WebDAV 密码通过系统安全存储提供，不进入普通配置。完整富文本、图片/附件选择、分享扩展和复杂公式排版尚未完成。

WebDAV 可直接在手机调用 Rust 核心。当前“加入已有知识库”只有 CLI 配对流程，手机配对导入 UI 仍需补齐，不能把新创建的手机知识库当成已加入桌面知识库。

## 连接电脑上的 Agent

默认 Prospero 只监听 loopback。用户明确启用远程连接时，可在启动 Obryth 前设置 `OBRYTH_PROSPERO_BIND=0.0.0.0`，并使用自己的局域网或私人 VPN。已有 daemon 需要由用户重启后才应用新监听设置。

本机默认使用独立动态端口，避免与其他 Prospero 安装冲突；远程监听使用 Prospero 配置端口，可用 `OBRYTH_PROSPERO_PORT` 指定。

通过 Prospero 自身的配对入口或 `agent.request` 的 `/v1/pairings` 创建设备配对，手机“Agent”页粘贴 `prospero://pair?d=...`。主机公钥被固定，配对令牌和设备身份保存在 SecureStore。断线不排队重发任务，重新连接只恢复查看会话。

手机可以选已有结构化 Agent 会话、发送任务、附加当前笔记、查看输出、处理执行审批和中断。主机笔记同步状态当前显示“未验证”；尚未实现跨设备知识版本确认。多地址竞速、后台保活、远程任务完整管理和终端接管仍需完善。

## 验收边界

当前已完成 TypeScript 检查、Swift/Kotlin 生成及 iOS/Android JavaScript 导出。宿主机没有完整 Xcode、Android SDK/NDK，因此 **不代表移动端原生编译或真机验收已通过**。

需真机逐项验证：中文组合输入、Dynamic Type、键盘遮挡、预测返回、旋转/折叠屏、后台恢复、Activity 回收、权限拒绝、断网重连、文件分享、草稿竞争及附件恢复。

官方基线：[Expo SDK matrix](https://docs.expo.dev/versions/latest/)、[Expo Modules](https://docs.expo.dev/modules/overview/)、[UniFFI](https://mozilla.github.io/uniffi-rs/latest/)。
