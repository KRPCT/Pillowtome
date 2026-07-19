# Pillowtome / 枕籍

**中文优先 · 本地优先 · 自托管同步的跨端电子书阅读器**

把书放进自己的 WebDAV，任何一端打开都是干净舒适的中文排版，进度、批注随时接上。

[特性](#特性) ·
[下载安装](#下载安装) ·
[中文排版](#中文排版) ·
[自托管同步](#自托管同步) ·
[技术栈](#技术栈) ·
[从源码构建](#从源码构建) ·
[路线图](#路线图) ·
[许可证](#许可证)

**[↓ 下载最新版（Windows / Android）](https://github.com/KRPCT/Pillowtome/releases/latest)**

---

枕籍（Pillowtome）是一款基于 **Tauri 2** 的电子书阅读器：一个 Rust 核心同时编译到 Windows 桌面和 Android，渲染层使用 foliate-js（MIT）跑在系统 WebView 里——而 WebView 恰好是免费可用的最强中文排版引擎。

一句话：**中文阅读质量是硬指标，不为「先英文跑通」让路。**

## 特性

- **中文排版一等公民**：中英混排自动加距（`text-autospace`，老 WebView 自动降级 JS shim）、标点避头尾（kinsoku）、词不拆行、两端对齐，逐特性探测、逐级回退。
- **简繁显示转换**：OpenCC 纯字符串转换，选接近等长的配置，CFI 定位与阅读进度不受影响，随时切换。
- **内置思源宋体**：应用自带 Noto Serif CJK 可变字体，全书渲染稳定，阅读中字体不会「现场变脸」；也保留了书内字体与系统字体选项。
- **两种翻页模式**：分页（仿真翻页）与连续滚动，CFI 精确定位，切换模式、切简繁、改字号后都能回到原位置。
- **批注与笔记**：划线高亮、批注编辑、选词气泡，批注锚点基于文本解析（anchor-resolver），书籍重新导入后仍能找回位置。
- **书库管理**：EPUB / TXT 导入、文件夹扫描、封面提取、按最近阅读 / 书名 / 作者 / 进度排序，在读 / 未读 / 读毕筛选。
- **书内搜索与目录**：全文搜索（中文友好）、目录跳转、阅读进度条。
- **自托管 WebDAV 同步**：书籍文件、阅读进度、批注经你自己的 WebDAV 互通；冲突有 reconcile 策略，密码存系统钥匙串，不进前端。
- **本地优先**：无账号、无广告、无追踪。不同步也能完整使用全部功能。

## 下载安装

前往 [Releases](https://github.com/KRPCT/Pillowtome/releases/latest) 下载对应平台安装包：

| 平台 | 安装包 |
|---|---|
| Windows | `Pillowtome_*_x64-setup.exe`（NSIS 安装器）或 `Pillowtome_*_x64_en-US.msi` |
| Android | `pillowtome-*-universal-release.apk`（universal，覆盖 arm64 / arm / x86_64） |

**首次运行提示**：当前版本未做商业代码签名。Windows 在 SmartScreen 选「更多信息 → 仍要运行」；Android 需允许「安装未知来源应用」。APK 使用自签名证书，后续版本覆盖安装时请保留同一签名。

## 中文排版

枕籍的差异化不在功能清单长度，而在每一页中文的渲染质量：

- **混排间距**：中文与拉丁字母 / 数字之间自动留出呼吸空间（CSS `text-autospace`），不支持的 WebView 自动启用 JS shim，两端体验一致。
- **标点纪律**：避头尾、悬挂标点、两端对齐共同保证页缘整齐。
- **字体稳定**：可变字重思源宋体内置于应用内并注入阅读视图，不受系统字体漂移影响。
- **简繁随心**：显示层转换，不动源文件，不丢进度。

## 自托管同步

同步不依赖任何专有云：填一个 WebDAV 地址（坚果云、Nextcloud、群晖均可），书籍、进度、批注都在你自己的存储里。凭证写入操作系统钥匙串（Windows Credential Manager / Android Keystore 体系），前端拿不到明文。

## 技术栈

| 层 | 选型 |
|---|---|
| 应用壳 | Tauri 2（Rust 核心，桌面 + Android 同一份代码） |
| 前端 | React 19 + TypeScript strict + Vite |
| 渲染内核 | foliate-js（MIT）跑在系统 WebView，继承完整 CSS 排版能力 |
| 中文能力 | OpenCC（简繁）+ CSS `text-autospace` / kinsoku + 自研 shim 回退 |
| 内置字体 | Noto Serif CJK 可变字体（本地打包） |
| 本地存储 | SQLite（书库 / 进度 / 批注） |
| 同步 | Rust reqwest 直连 WebDAV + 系统 keyring |

单元测试 200+，覆盖定位、锚点、排版 shim、同步调度等核心逻辑。

## 从源码构建

环境要求：Node 22（LTS）· Rust stable（rustup）· pnpm 10（经 corepack 激活）· Android 构建另需 Android Studio / SDK + NDK。

```bash
corepack enable
pnpm install            # 锁定版本
pnpm tauri dev          # 开发模式启动桌面应用
pnpm tauri build        # 打包 Windows 安装包（产物在 src-tauri/target/release/bundle/）
pnpm tauri android build --apk   # 构建 Android APK
```

三道门：`pnpm build && pnpm test`，Android 改动另需在模拟器 / 真机上以独立 APK 冷启动验收（详见 `docs/ANDROID-BUILD.md`）。

## 路线图

已完成 v0.1：EPUB / TXT 阅读、中文排版体系、简繁转换、批注、书内搜索、书库管理、WebDAV 同步、Windows + Android 双端。

还想做的：

- macOS / Linux 桌面构建
- 更多格式（MOBI / AZW3 / PDF / CBZ）
- 阅读统计、更多主题与字体
- Windows 代码签名

不打算做：账号体系、广告、书城、社交。

## 许可证

源代码当前以「保留所有权利」方式公开（暂未附加开源许可证），仅供学习与个人使用；商用或再分发请联系作者。后续版本将明确许可证条款。

---

*枕边有籍，随处可读。*
