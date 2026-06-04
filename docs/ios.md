# iOS bring-up（Tauri iOS）

复用现有 React UI 打包成 iPhone/iPad 应用。当前状态与剩余步骤。

## 已就绪
- Tauri 2 已移动就绪(`#[cfg_attr(mobile, tauri::mobile_entry_point)]`、crate-type 含 `cdylib`/`staticlib`、bundle id `com.willyliu.cadence`)。
- **Rust iOS 目标已安装**:`aarch64-apple-ios`、`aarch64-apple-ios-sim`、`x86_64-apple-ios`。
- 移动端 UI 已落地(响应式看板 + 底部 Tab Bar,见 `feat/ios-app`)。

## 阻塞:需要完整 Xcode
当前机器只有 Command Line Tools(`/Library/Developer/CommandLineTools`)。`tauri ios init` 需要 **Xcode.app**(xcodebuild / iOS SDK / 模拟器)。

## 步骤(装好 Xcode 后)
```bash
# 1) 指向 Xcode 并接受许可
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept

# 2) 生成 iOS 工程(在 src-tauri/gen/apple/)
cd /Users/bytedance/Desktop/cadence
npx tauri ios init

# 3) 模拟器运行
npx tauri ios dev
# 真机/出包(需 Apple Developer 账号配置签名)
npx tauri ios build
```

## init 后还要做
- 配置签名(开发团队)、App 图标、启动屏。
- 安全区已处理(`viewport-fit=cover` + 底部 Tab Bar 预留 `env(safe-area-inset-bottom)`)。
- **音频**:`public/sounds/*.mp3`(~270MB)不要打进 iOS 包;首版可只带 `chime.mp3`,环境白噪音改为按需远端加载或在移动端隐藏。
- **同步**:设置页填 Turso URL/token 并勾「启用 libSQL 引擎」后,多设备同步即可在 iOS 与桌面间生效。
