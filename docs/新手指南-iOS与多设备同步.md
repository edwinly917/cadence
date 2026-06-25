# 新手指南 · 苹果端 App + 多设备同步

> 这份指南假设你**完全没开发过 App**，每一步都告诉你在**哪台设备、哪个界面、点哪里**。
> 这条线有两件事，可以分开做：
> - **A. 把 Cadence 装到 iPhone / iPad 上**（需要装 Xcode）。
> - **B. 让电脑和手机的任务自动同步**（需要一个叫 Turso 的云数据库）。

---

## 0. 名词解释（看不懂就回来查）

| 名词 | 大白话 |
|---|---|
| **终端 / Terminal** | Mac 上**黑色的命令窗口**。按 `⌘+空格` 输入 `终端` 回车即可打开。 |
| **Xcode** | 苹果官方的开发软件，**装在 Mac 电脑上**（不是手机！）。打包 iPhone App 必须用它。 |
| **命令行工具(CLT)** | Xcode 的「精简版」，你电脑现在只装了这个，**不够**，要装完整 Xcode。 |
| **模拟器(Simulator)** | Mac 上一个**假的 iPhone 窗口**，用来在电脑上预览 App，不用真手机。 |
| **真机** | 你真实的 iPhone/iPad。装到真机上需要「签名」和苹果开发者账号。 |
| **Apple Developer 账号** | 苹果开发者会员，**99 美元/年**。只有装到**真机**或**上架**才需要；用模拟器**不需要**。 |
| **Turso** | 一个云端数据库服务，免费额度够个人用。电脑和手机都连它，从而实现同步。 |
| **同步** | 你在电脑上加的任务，手机上也能看到；反之亦然。 |

---

# A 部分 · 把 App 装到 iPhone / iPad

## A1. 安装完整 Xcode（在 **Mac 电脑**上）

> ❓ 你问的「App Store 安装 Xcode 是在电脑还是手机」——
> 👉 **在你的 Mac 电脑上的 App Store**（Dock 程序坞里那个蓝色「A」图标），**不是 iPhone 上的 App Store**。

1. 在 Mac 上打开 **App Store**（不是浏览器，是那个应用）。
2. 右上角搜索框输入 **`Xcode`**，回车。
3. 找到苹果出的那个 **Xcode**（开发者是 Apple），点「**获取 / 安装**」。
   - 它**很大（十几 GB）**，下载要等一会儿，电脑要留够硬盘空间。
4. 装完后**打开一次 Xcode**，它可能会让你「安装附加组件」，点同意，等它装完。

## A2. 告诉系统「用完整 Xcode」（在终端跑两条命令）

打开终端，逐条粘贴回车（会要你输入**开机密码**，输入时屏幕不显示是正常的）：
```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept
```

## A3. 生成 iPhone 工程并预览（在终端跑）

> Rust 相关的 iOS 组件**已经帮你装好了**，你直接跑下面两条即可。

```bash
cd /Users/bytedance/Desktop/cadence
npx tauri ios init
```
等它跑完（会生成一个 iOS 工程）。然后在**模拟器**里预览：
```bash
npx tauri ios dev
```
- 第一次会比较慢（要编译）。成功后会弹出一个**假 iPhone 窗口**，里面就是 Cadence。
- 这一步**不需要**苹果开发者账号、不需要真手机。

> 做到这里你已经在「iPhone（模拟器）」上看到 App 了 🎉。
> 想做完后告诉我，我可以帮你跑 `tauri ios init` 并排查问题。

## A4. 装到「真 iPhone」上（可选，需要开发者账号）

1. 注册 **Apple Developer**（https://developer.apple.com，99 美元/年）。
2. 用数据线把 iPhone 连到 Mac。
3. 在 Xcode 里给项目配置「签名（Signing）」选你的开发者账号。
4. 终端跑：`npx tauri ios build`（或在 Xcode 里选你的手机直接运行）。

## A5. 关于声音文件（小提醒）

「心流计时」的环境白噪音 mp3 很大（约 270MB），**不适合打进手机 App**。
首版建议：手机端只保留计时、不放白噪音（或以后改成「用时再从网上下载」）。这块等装到手机后再决定，不影响先跑起来。

---

# B 部分 · 多设备同步（电脑 ↔ 手机）

> 原理：电脑和手机都连同一个云数据库（Turso），各自本地存一份、自动对账。
> 同步**默认是关闭的**，要你做完下面几步并在设置里打开。

## B1. 注册 Turso、建一个云数据库（在 **电脑浏览器**里做）

1. 电脑浏览器打开：https://turso.tech ，**注册 / 登录**（可用 GitHub 账号登录）。
2. 按页面引导**安装 Turso 命令行工具**，或直接在网页 Dashboard 里「**Create Database**」建一个库（名字随便，比如 `cadence`）。
3. 拿到两样东西（Dashboard 里或用命令）：
   - **数据库 URL**：形如 `libsql://cadence-你的名字.turso.io`
   - **Auth Token**：一长串字符（在「Database → Tokens / Create Token」生成）。
   把这两样贴到备忘录。

> 如果用命令行，常见三条（装好 turso CLI 后）：
> ```bash
> turso db create cadence
> turso db show cadence --url        # 拿 URL
> turso db tokens create cadence     # 拿 token
> ```

## B2. 在 Cadence 里填上并开启同步（在电脑的 Cadence 应用里做）

1. 打开 **Cadence 应用**，点右上角的**齿轮 ⚙（设置）**。
2. 在「**账户与同步**」里：
   - **数据库 URL** 填 B1 拿到的 `libsql://...`
   - **Auth Token** 填 B1 拿到的 token
   - 点「**连接**」。
3. 往下找「**实验性 · 数据引擎**」，勾上「**启用 libSQL 引擎（实验）**」。
4. **完全退出并重新打开 Cadence**（这样新引擎才生效）。
5. 回到设置页，点「**立即同步**」。看到「上次同步：刚刚」就成功了。

## B3. 手机端同步

等 A 部分把 App 装到手机后，在手机的 Cadence 设置里**填同一个 URL 和 token**、同样打开开关。
之后两边任务就会自动同步。

---

## 常见问题

| 现象 | 解决 |
|---|---|
| `tauri ios init` 报错说要 Xcode | 没装完整 Xcode，或没跑 A2 那两条命令。回 A1/A2。 |
| 模拟器没弹出来 | 第一次编译慢，多等几分钟；或先在 Xcode 里手动打开一次模拟器。 |
| 点「立即同步」报「引擎尚未接入」 | 没勾「启用 libSQL 引擎」或没重启应用。回 B2 第 3–4 步。 |
| 同步连不上 | URL 或 token 填错；确认 B1 拿的是同一个库的。 |
| 装真机提示签名问题 | 需要 Apple Developer 账号并在 Xcode 配置签名。见 A4。 |

---

## 收尾（可选）

- 设计稿在 **PR #2**：https://github.com/edwinly917/cadence/pull/2
- 苹果端开发在 **PR #3**：https://github.com/edwinly917/cadence/pull/3
确认无误后在网页点「**Merge pull request**」合并。

---

## 你现在最少要做的两件事
1. **装 Xcode**（A1）→ 然后告诉我，我帮你跑 `tauri ios init` 上模拟器。
2. **注册 Turso 拿 URL/token**（B1）→ 给我，或自己按 B2 填进设置页开同步。
