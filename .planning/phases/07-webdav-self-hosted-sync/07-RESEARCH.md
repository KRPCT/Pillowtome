# Phase 7: WebDAV Self-Hosted Sync - Research

**Researched:** 2026-07-18
**Domain:** 自托管 WebDAV 同步（传输 / keychain / 状态合并 / 分块上传 / 冲突消解）
**Confidence:** HIGH（传输栈、keychain、Nextcloud 协议、坚果云限额均有官方源验证；合并模型设计为项目自有设计，按 CONTEXT 锁定规则落地）

## Summary

本阶段是「对账」而非「重写」：change_log 脊柱（schema V1）与 annotation/sync_meta（V7）已 sync-ready，本阶段接通 **Rust core 内的同步引擎** = WebDAV 传输（`reqwest_dav`）+ keychain 凭据（`keyring`）+ 客户端合并（furthest-progress / UUID 集合并 + tombstone）+ 生命周期触发调度（D-90/D-91，无后台轮询）。

关键发现：(1) STACK.md 锁定的 `reqwest_dav 0.2.1` 已过时，当前线 **0.3.3**（2026-03-02 发布，近 96 万下载，基于 reqwest 0.13），其高层方法不支持自定义头——**条件 PUT（If-Match）与 Nextcloud 分块必须走公开的 `client.agent`（reqwest::Client）原生请求**，`ClientBuilder::set_agent` 也正好允许注入带 `danger_accept_invalid_certs` 的自定义 agent 来实现 D-95 的自签名开关。(2) `keyring 4.1.5` 双端可用，但 Android 端需要 `ndk-context` 初始化，而 **tao 0.35.3（本项目在用）已移除该初始化**（tauri-apps/tao#1220）——必须在本项目已手工维护的 `gen/android/.../MainActivity.kt` 里加几行 Kotlin 初始化（有官方文档路径）。(3) 坚果云限额（免费 600 请求/30 分钟、单文件 500MB、PROPFIND 单页 750 项）决定了**状态平面必须请求节俭**：远端每设备一个自描述状态文件（进度寄存器 + 批注全量 + 书目），一次同步 ≈ 1 次 PROPFIND + 少量 GET + 1 次 PUT。(4) RFC 4918 通用服务器**没有服务端组装能力**，D-101 的「通用退化为大块 PUT 序列」在无组装语义下不成立——建议修正为：Nextcloud 走 chunked v2 断点续传，通用服务器走流式整 PUT + 失败重传（见 Open Questions Q1）。

**Primary recommendation:** Rust core 新建 `sync/` 模块（transport/reconcile/merge/scheduler 四件），传输用 `reqwest_dav =0.3.3`（高层方法管 PROPFIND/GET/MKCOL）+ 其公开 `agent` 管条件头与分块；凭据用 `keyring =4.1.5`（desktop 默认 store + `android-native-keyring-store` feature，MainActivity 补 ndk-context 初始化）；远端每设备单文件状态副本 + 每设备独立 change log 文件，写冲突按构造不存在；合并逻辑下沉 `pillowtome-core` 纯函数（off-device 全量单测）。

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**承接锁定（不重新决定）**
- **传输栈 = `reqwest_dav` 跑在 Rust core**（STACK.md 锁定）：双端共享一份实现；不做 JS 侧 WebDAV。
- **双平面架构**（ARCHITECTURE.md Pattern 3）：文件平面与状态平面独立通道——进度每会话都走，300MB 书文件只在用户开启时走一次。
- **合并规则已定（SYNC-05）**：进度取最远；批注按 UUID 集合并 + tombstone 去重；真正的冲突用明确的非破坏策略。**禁止整文件 LWW blob 同步**（PITFALLS #7）。
- **change_log 脊柱已在 schema V1**：UUID + device_id + 逐设备单调 logical_clock + payload；annotation（V7）带 revision/updated_at/content_hash/deleted tombstone——全部 sync-ready，本阶段是消费而非新建。
- **hash_algo 双算法警告**（annotation-store.ts 头注释）：work.content_hash 是 blake3，annotation content_hash 是 WebCrypto SHA-256——**同步必须按记录读 hash_algo，绝不假设单一算法**。
- **凭据入 OS keychain、永不同步**（SYNC-01 + roadmap）；**产品文案简体中文**（D-30）；**书字节不过 IPC**（D-06——同步引擎在 Rust core 直接读文件，与此兼容）。

**同步触发时机**
- **D-90：开书拉 + 合书推 + 手动按钮兜底（KOReader 式）**——打开书时拉取对账，合上书/退出阅读/切后台时推送本地 change log，书库页放手动「立即同步」。禁止变更即推的实时模型（电量与写入复杂度）。
- **D-91：不做 Android 后台定时同步**——同步只在 app 生命周期内发生（启动/开书/合书/手动）；不引入 WorkManager/前台服务/额外权限。阅读是长会话场景，后台偷跑价值低。
- **D-92：对端进度更远时：静默跳到最远 + 留痕迹 + 可撤回**——开书拉取后按 SYNC-05 静默取最远，不打断；界面留同步痕迹（如进度条旁「已从其他设备同步」提示），**点击该提示弹窗可撤回跳回原位**。
- **D-93：状态可见性 = 状态点 + 设置页详情**——书库同步按钮带状态点（同步中/失败）；设置页显示服务器、上次同步时间、失败原因；失败用 toast，**不弹模态**。

**服务器矩阵与 TLS**
- **D-94：兼容矩阵三类全过**——Nextcloud + 坚果云 Nutstore + 通用 RFC 4918 WebDAV（Apache mod_dav / rclone serve / 群晖）。客户端防御性编码（PROPFIND depth、尾斜杠、百分号编码、MOVE/COPY 差异）；坚果云限流怪癖需处理（PITFALLS #8）。验证矩阵须覆盖「真实代理后的 Nextcloud」而非只测本地裸服务器。
- **D-95：TLS 默认严格 + 显式放行开关**——默认 HTTPS 严格校验证书；设置页两个独立开关「允许 HTTP（明文，仅局域网）」「信任自签名证书」，开启时给简体中文警示文案。禁止全放行。
- **D-96：凭据 = 服务器地址 + 用户名 + 密码/应用密码**——TLS 下走 Basic（Nextcloud/坚果云均推荐应用密码），服务器要求 Digest 时自动协商；设置页引导文案提醒「用应用密码，不要用主密码」。凭据存 keychain（SYNC-01）。
- **D-97：保存前强制测试连接**——保存时执行 PROPFIND 探活 + 认证校验 + 远端目录（如 `pillowtome/`）自动创建；失败给出具体中文错误分类（地址不通 / 认证失败 / 证书问题 / 目录无权限）。不允许错误配置静默保存。

**书籍文件同步体验（SYNC-04）**
- **D-98：默认不同步，按书开启**——每本书在详情/长按菜单里有「同步此书」开关；不做全局「自动上传全部」开关。带宽最小、符合 SYNC-04「非强制全量」。
- **D-99：对端占位卡 + 点击下载**——书单经状态平面同步后，对端书库显示云端书占位卡（封面 + 标题 + 云标记），点一下后台下载完成即可读；进度/批注在文件落地后即生效。
- **D-100：文件平面只传书文件本体**——对端下载后走现有 `import-pipeline` 本地重新解析元数据/封面。单一真相，禁止「书文件+元数据打包」的双真相模型。
- **D-101：阈值分块 + 断点续传**——超过阈值（约 10MB，具体值 planner 定）走分块：Nextcloud 用其 chunked upload v2 协议（Destination 头、整数块名、423 Locked 重试语义），通用服务器退化为大块 PUT 序列；中断可续传。必须抗住代理 100MB 体上限与 504（PITFALLS #8）；不做文件大小上限、不做「整 PUT 失败整体重试」。

**同步范围与远端布局**
- **D-102：全书目同步**——所有书目都上状态平面：开了文件同步的显示可下载占位卡（D-99），没开的显示灰态「未同步」。两端书库视图完全一致；进度/批注对所有书生效（SYNC-02/03 不受文件平面限制）。
- **D-103：v1 不同步阅读设置**——字体/主题/CJK 开关各设备独立（手机夜间 vs 桌面日间场景不同）。状态平面只含：书目目录、进度、批注、文件同步标志位。
- **D-104：远端默认 `pillowtome/`、路径可改**——默认在服务器根下建 `pillowtome/`（内含 `books/`、`state/`、`devices/` 子结构），设置里可改成任意路径（如坚果云已有文件夹）。**多设备必须指向同一路径**，设置页明示此约束。
- **D-105：远端文件人类可读命名**——`books/` 下用「作者 - 书名.格式」命名（重名追加短哈希）；`state/` 下 change log 按 `device_id` 命名。用户在网盘里能认出自己的书并可手动管理；书名明文上传在自托管场景下可接受（不做哈希乱码命名）。

### Claude's Discretion
- **分块阈值具体值**（约 10MB 起）与续传状态持久化格式——research 对真实 Nextcloud/坚果云验证后定。
- **change log 传输格式细节**（JSONL vs 单 JSON 数组、压缩与否、单文件 rotate 策略）——依 ARCHITECTURE.md per-device append-only 模型定。
- **keyring 具体实现**（`keyring` crate vs tauri-plugin-stronghold 等）——须双端可用 + 精确钉版本，research 定。
- **device_id 生成与用户可见设备名**——sync_meta 已有 device 行；是否在设置页显示可编辑设备名由 planner 定。
- **冲突展示的颗粒度**——D-92 的撤回弹窗内文案与布局细节（沿用 P2 UI-SPEC 纸感/朱砂语言）。
- **远端结构版本号**（远端 `pillowtome/` 内是否带 format version 以便未来迁移）。

### Deferred Ideas (OUT OF SCOPE)
- **Android 后台定时同步（WorkManager）**——本阶段明确否决；若用户反馈「关着 app 也想同步」再立 v2 项。
- **阅读设置同步**——v1 各端独立（D-103）；v2 若做多端一致体验可重议（LWW per key 模型 ARCHITECTURE.md 已预留）。
- **KOReader kosync 协议互通**——已是 REQUIREMENTS v2 项（SYNC-06），本阶段不做但 per-device log 模型与之兼容。
- **端到端加密（E2EE）同步**——v1 基线 = keychain + TLS；加密同步是独立 phase 的事。
- **同步冲突的可视化管理界面**（如并列展示两端版本手动选）——v1 全部自动合并不丢数据；可视化只到 D-92 的进度撤回弹窗。
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SYNC-01 | 用户可配置并连接自托管 WebDAV 服务器（凭据安全存储于系统 keychain） | `keyring 4.1.5`（desktop 默认 store + `android-native-keyring-store`）[VERIFIED: crates.io]；MainActivity ndk-context 初始化路径 [CITED: tauri-apps/tao#1220 + android-native-keyring-store docs]；D-97 连接测试 = PROPFIND depth:0 + MKCOL 引导 + 中文错误分类 |
| SYNC-02 | 阅读进度可通过 WebDAV 在多设备间同步 | 远端每设备状态文件内 `progress` 寄存器（每 work 只保留最新值）；furthest-progress 合并规则（SYNC-05 锁定）；locator 写路径需补 change_log 追加（现状缺口，见 Architecture Patterns § 现状缺口） |
| SYNC-03 | 批注（高亮/笔记/书签）可通过 WebDAV 在多设备间同步 | annotation 表（V7）已带 UUID/revision/updated_at/content_hash/deleted tombstone；合并 = 按 annotation_id 集合并 + 确定性消解（见 Architecture Patterns § Pattern 3） |
| SYNC-04 | 用户可选择性地同步书籍文件本身（非强制全量） | 按书 `file_sync.enabled` 标志（D-98，走状态平面同步）；上传：小文件流式 PUT / Nextcloud chunked v2 [CITED: docs.nextcloud.com]；下载：Range 断点 + blake3 校验 + import-pipeline 重解析（D-100） |
| SYNC-05 | 同步冲突有明确策略且不丢数据 | 状态平面每设备独占一个远端文件（写冲突按构造不存在）+ If-Match 乐观并发兜底；merge 为 `pillowtome-core` 纯函数（可 off-device 穷举单测）；tombstone 防复活；永不静默丢数据 = 合并不丢弃任何单侧存在记录 |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| WebDAV 传输（PROPFIND/GET/PUT/MKCOL/MOVE、分块、ETag 并发） | Rust core（`pillowtome-core` + `src-tauri`） | — | STACK.md 锁定 `reqwest_dav` 在 Rust；双端共享一份实现；JS 侧不做 WebDAV |
| 凭据存储/读取（OS keychain） | Rust core（`keyring` crate） | src-tauri Android Kotlin stub（ndk-context 初始化胶水） | keychain 访问是原生能力；前端只拿「已配置/未配置」布尔与服务器地址，密码永不过 IPC |
| 合并/冲突消解（progress、annotation、catalog） | Rust core（纯函数，off-device 可测） | — | PITFALLS #7 要求 merge 模型；纯函数可在 cargo test 穷举双设备交错场景 |
| SQLite 合并写入（对端状态入库） | src-tauri（经 `tauri_plugin_sql::DbInstances` 共享同一连接池） | — | 单 SQLite binding 约束（Pitfall 6）：复用插件的 sqlx pool，不引入第二连接源 |
| 同步调度（开书拉/合书推/手动） | 前端 React（阅读生命周期钩子 + 书库按钮） | Rust core（执行引擎） | 触发点是 UI 生命周期；执行下沉 Rust；IPC 只传小结构（D-06） |
| 状态可见性（状态点/toast/设置页详情） | 前端 React（MUI/朱砂 UI） | Rust core（sync status 经 IPC 事件上报） | D-93；沿用既有 sheet/toast 模式与纸感 UI-SPEC |
| 占位卡/「同步此书」开关/撤回弹窗 | 前端 React（LibraryGrid 扩展 + reader 提示） | — | D-98/D-99/D-92；既有 LibraryCard 是扩展点 |
| 文件平面字节流（上传读盘/下载写盘） | Rust core（流式 IO，不经 IPC） | — | D-06 天然兼容：同步引擎在 Rust 直接读文件 |
| 远端布局/命名/版本号 | Rust core | — | D-104/D-105；命名清洗与百分号编码必须单点实现、双端一致 |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `reqwest_dav` | **=0.3.3**（精确钉；STACK.md 的 0.2.1 已过时，0.3.3 发布于 2026-03-02）[VERIFIED: cargo search / crates.io] | WebDAV 客户端：Basic/Digest 认证、PROPFIND list/GET/PUT/MKCOL/MOVE/COPY/DELETE | 项目锁定选型；async(tokio+reqwest 0.13)，双端同一实现；MIT/Apache-2.0 |
| `keyring` | **=4.1.5**（精确钉）[VERIFIED: cargo search / crates.io] | OS keychain 凭据读写（SYNC-01） | 1710 万总下载的事实标准；desktop 默认 store（Windows Credential Manager / macOS Keychain / Linux zbus Secret Service）+ `android-native-keyring-store` feature 覆盖 Android Keystore |
| `reqwest` | 0.13.4（已在 Cargo.lock，经 reqwest_dav 统一）[VERIFIED: Cargo.lock] | 自定义 agent：条件头（If-Match/If-None-Match/Destination/OC-Total-Length/Range）、流式 body、TLS 开关 | reqwest_dav 高层方法不暴露自定义头；`ClientBuilder::set_agent` 注入同一 agent |
| `tokio` | 1.52.3（已在 lock，dev-dep；运行时经 tauri 已有） | 异步运行时 | 现有 |
| `serde` / `serde_json` | 1.0.228 / 1.0.150（已在 lock） | 远端状态文件（JSON）序列化 | 现有 |
| `blake3` | 1.8.5（已在 core） | 下载完整性校验、书名短哈希 | 现有 |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `android-native-keyring-store` | 随 `keyring` feature 解析（钉入 lock） | Android Keystore + SharedPreferences 凭据 store | 仅 Android target（target-gated） |
| `wiremock` | =0.6.5（dev-dependency）[VERIFIED: crates.io 6250 万下载] | WebDAV 传输层 off-device 集成测试（PROPFIND/auth/423/504/ETag 矩阵） | `src-tauri` / `core` dev-tests |
| `percent-encoding`（经 `url` 间接） | 已在 lock（reqwest 依赖） | 远端路径段百分号编码 | D-94 防御性编码 |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `keyring` crate | `tauri-plugin-stronghold` | Stronghold 是加密快照文件（IOTA），**不是 OS keychain**——CONTEXT 锁定「凭据入 OS keychain」，排除 |
| `keyring` crate | `tauri-plugin-keyring-store` 0.2.0 | 社区插件、下载量极低、维护面窄；直接用 `keyring` crate 更可控且是上游本身 |
| `reqwest_dav` | 手写 reqwest WebDAV | PROPFIND XML 解析 + Digest 握手 + multistatus 处理是重复造轮子；reqwest_dav 覆盖，raw agent 补条件头 |
| 每设备远端单 JSON 状态文件 | 追加式 JSONL 逐条上传 | WebDAV 无 append 语义，JSONL 也要整文件重写；且坚果云限流下单文件远优于多小文件（见 Pattern 3） |

**Installation:**
```bash
# core/Cargo.toml — 合并引擎不需要新运行时依赖（serde/blake3/thiserror 已有）
# src-tauri/Cargo.toml（精确钉，提交 Cargo.lock — D-13）：
#   reqwest_dav = "=0.3.3"
#   keyring = { version = "=4.1.5", features = ["android-native-keyring-store"] }   # feature 仅 Android 生效；desktop 走默认 v1 store
# [dev-dependencies]
#   wiremock = "=0.6.5"
```

**Version verification:** `cargo search`/`cargo info` 2026-07-18 实测：reqwest_dav 0.3.3（2026-03-02，总 967,260 / 近期 251,021 下载）、keyring 4.1.5（2026-07-14，总 17,119,821 / 近期 6,637,352 下载）、wiremock 0.6.5（2025-08-24，总 62,503,262 下载）。reqwest_dav 0.3.3 依赖 reqwest 0.13 [VERIFIED: github.com/niuhuan/reqwest_dav Cargo.toml]，与本项目 lock 中已有 reqwest 0.13.4 统一，不引入第二版本。

## Package Legitimacy Audit

> 本阶段安装的外部包如下。`gsd-tools query package-legitimacy` 子命令在当前安装（gsd-sdk v1.42.3）不存在——已用 crates.io API + `cargo info` 手工执行同等检查。

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `reqwest_dav` | crates.io | 多线维护（0.3.3 为 2026-03 发布） | 967,260 总 / 251,021 近期 | github.com/niuhuan/reqwest_dav | [OK] | Approved（STACK.md 既定选型） |
| `keyring` | crates.io | 多年（4.1.5 为 2026-07-14） | 17,119,821 总 / 6,637,352 近期 | github.com/open-source-cooperative/keyring-rs | [OK] | Approved |
| `wiremock` (dev) | crates.io | 多年（0.6.5 为 2025-08-24） | 62,503,262 总 | github.com/LukeMathWalker/wiremock-rs | [OK] | Approved（dev-only） |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

*注意：STACK.md（2026-07-09 研究）钉的是 reqwest_dav 0.2.1；本次 registry 验证确认 0.3.x 是当前维护线且迁移到 reqwest 0.13（与 lock 已有版本一致）。推荐钉 `=0.3.3`，planner 照此执行；若坚持 0.2.1 反而会拖入 reqwest 0.12 第二版本。*

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────── 前端 React（WebView） ───────────────────────────┐
│ 书库页: [立即同步按钮+状态点] [占位卡+点击下载] [按书「同步此书」开关]          │
│ 阅读页: 开书钩子(拉) 合书/切后台钩子(推) [已同步提示→撤回弹窗 D-92]           │
│ 设置页: [服务器/用户名/应用密码] [允许HTTP] [信任自签名] [路径] [测试并保存]   │
└───────┬──────────────────────────────────────────────▲───────────────────┘
        │ IPC 小结构（配置/状态/结果；密码与书字节永不过 IPC — D-06）
        ▼                                              │ IPC 事件(sync status)
┌──────────────────────── Rust core（pillowtome-core + src-tauri） ────────────┐
│ sync/                                                                        │
│  ├─ transport.rs   reqwest_dav Client（PROPFIND/GET/MKCOL）                  │
│  │                + client.agent 原生请求（If-Match / Destination /           │
│  │                  OC-Total-Length / Range / 分块 PUT / MOVE 组装）          │
│  ├─ credentials.rs keyring Entry（service="pillowtome"）                     │
│  ├─ remote.rs      远端布局：pillowtome/{books,state,devices} + 命名清洗      │
│  ├─ reconcile.rs   拉：PROPFIND(ETag)→GET 变更设备文件→merge→写 SQLite        │
│  │                推：重建本设备状态文件→条件 PUT（If-Match / If-None-Match）  │
│  ├─ merge.rs       纯函数：furthest-progress / OR-Set+tombstone / 目录合并    │
│  ├─ fileplane.rs   按书上传（阈值→Nextcloud chunk v2 / 通用流式 PUT）         │
│  │                下载（Range 续传→blake3 校验→交 import-pipeline 重解析）     │
│  └─ scheduler.rs   开书拉/合书推/手动（无后台轮询 — D-90/D-91）               │
│ DB 访问：tauri_plugin_sql::DbInstances 共享 pool（单 SQLite binding）         │
└───────┬──────────────────────────────────────────────────────────────────────┘
        │ HTTPS（默认严格；开关放行 HTTP/自签名 — D-95）
        ▼
┌──────────────── WebDAV 服务器（哑存储，无服务端计算） ────────────────────────┐
│ pillowtome/                                                                  │
│  ├─ manifest.json          format:1 + app 标记（远端结构版本号）              │
│  ├─ books/作者 - 书名.epub  人类可读命名（重名+短哈希 — D-105）               │
│  ├─ state/{device_id}.json  每设备独占：进度寄存器+批注全量+书目（含 tombstone）│
│  └─ devices/{device_id}.json 设备注册表（友好名/first_seen/last_seen）        │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
core/src/
├── sync/
│   ├── mod.rs            # 引擎入口：SyncEngine（transport+reconcile+scheduler 组装）
│   ├── remote.rs         # 远端布局/路径清洗/百分号编码/manifest（纯函数，可测）
│   ├── merge.rs          # 合并纯函数：progress/annotation/catalog（off-device 全测）
│   └── model.rs          # 远端状态文件 serde 类型（DeviceStateFile/DeviceRecord）
src-tauri/src/
├── sync/
│   ├── mod.rs            # Tauri 侧引擎装配（DbInstances pool、AppHandle、事件发射）
│   ├── transport.rs      # reqwest_dav 封装 + agent 原生请求 + 错误分类（中文）
│   ├── credentials.rs    # keyring 读写删（密码不过 IPC；前端只收 bool）
│   ├── fileplane.rs      # 上传分块/续传状态机 + 下载 Range 续传 + 校验
│   └── commands.rs       # 新 IPC 命令（小结构）：sync_configure/test_and_save/
│                         #   sync_now/sync_status/sync_set_file_sync/
│                         #   sync_download_book/sync_revert_jump
└── capabilities/default.json + android.json   # 新命令授权面（最小授权）
```

### Pattern 1: 双平面 + 每设备独占状态文件（写冲突按构造不存在）

**What:** 状态平面与文件平面独立通道（ARCHITECTURE.md Pattern 3，已锁定）。远端 `state/{device_id}.json` 每个设备**只写自己的那一个文件**——跨设备写冲突在构造上不存在，不需要锁、不需要服务端事务。本设备文件用 ETag 做乐观并发：`If-None-Match: *` 首次创建；之后 `If-Match: <上次见到的 ETag>`，412 则重拉-合并-重试（防御同一设备双开实例的边界）。

**When to use:** 总是。这就是 PITFALLS #7（禁止整文件 LWW blob）的落地形态。

**远端设备状态文件格式（推荐，Claude's Discretion 项「change log 传输格式」的答案）:**

```json
{
  "format": 1,
  "device_id": "uuid",
  "device_name": "小明的 Pixel 8",
  "clock": 1234,
  "updated_at": 1780000000000,
  "progress": {
    "<work_id>": { "cfi": "epubcfi(...)", "progress_fraction": 0.42,
                   "text_pre": "…", "text_exact": "…", "text_post": "…",
                   "updated_at": 1780000000000 }
  },
  "annotations": {
    "<annotation_id>": { "work_id": "…", "type": "highlight", "cfi": "…",
                         "color": "cinnabar", "text_pre": "…", "text_exact": "…",
                         "text_post": "…", "progress_fraction": 0.4, "note": "…",
                         "created_at": 0, "updated_at": 0, "revision": 3,
                         "content_hash": "…", "hash_algo": "sha256", "deleted": 0 }
  },
  "library": {
    "<work_id>": { "title": "…", "author": "…", "format": "epub",
                   "content_hash": "blake3hex", "imported_at": 0, "deleted": 0,
                   "file_sync": { "enabled": true, "remote_path": "books/作者 - 书名.epub",
                                  "size": 12345678, "hash": "blake3hex" } }
  }
}
```

**Why this shape（而不是把本地 change_log 原始行直接上传）:**
- **进度是寄存器不是日志**——阅读中 locator upsert 每 500ms 一次，若按原始 change_log 上传，远端文件无界增长；合并语义本来就只要「每 work 最新值」。远端文件保留每 work 一条 = 有界。
- **批注必须全量携带（含 tombstone）**——新设备 bootstrap 只读状态文件就能重建全集，不依赖「从创世起完整重放日志」；tombstone 在文件内常驻，删除不会复活（v1 不做 tombstone GC，v2 用 devices/ 注册表做全设备确认后再清）。
- **请求节俭**——一次拉取 = 1 次 PROPFIND（拿全部设备文件 ETag）+ 每个 ETag 变化的设备 1 次 GET；一次推送 = 1 次 PUT。坚果云免费档 600 请求/30 分钟 [CITED: help.jianguoyun.com/?p=2064] 下毫无压力。多小文件方案（逐条 op 一个文件）在限流下直接死亡。
- **本地 change_log 的角色不变**——它是本地账本/审计（V1 既有），推送时从本地表重建远端文件（不逐行回放）；对端合入的记录**不写**本地 change_log（它们不是本机操作，避免时钟膨胀与循环）。

### Pattern 2: 合并引擎 = 纯函数（SYNC-05 的可测落地）

**What:** `core/src/sync/merge.rs` 提供三个纯函数，输入「本地行 + 对端记录」输出「胜出行 + 副产物（如撤回信息）」，不含任何 IO：

```rust
// progress：取最远（progress_fraction 大者胜；并列 updated_at 大者胜；再并列 device_id 字典序 —— 全序确定性）
pub fn merge_progress(local: &ProgressRow, remote: &ProgressRec, remote_device: &str)
    -> MergeOutcome<ProgressRow>;

// annotation：按 id 集合并；同 id 冲突 → revision 高者胜 → 等 revision 比 content_hash
//   （同 hash = 幂等无操作）→ updated_at → device_id；deleted=1 在 revision 不落后时胜出（tombstone 去重）
pub fn merge_annotation(local: Option<&AnnotationRow>, remote: &AnnotationRec, remote_device: &str)
    -> MergeOutcome<AnnotationRow>;

// library：按 work_id 集合并；file_sync 标志随目录行走；占位卡数据由此派生
pub fn merge_library(local: Option<&LibraryRow>, remote: &LibraryRec) -> MergeOutcome<LibraryRow>;
```

**关键规则（对应锁定决策）:**
- **永不静默丢数据**：合并不丢弃任何「只在一侧存在」的记录（集合并）；「撤回」信息（本地原位置）作为 MergeOutcome 副产物交给 D-92 的撤回弹窗。
- **hash_algo 按记录读**（锁定）：`hash_algo:"sha256"` 的批注 hash 只和 sha256 比；work 的 blake3 只和 blake3 比。绝不跨算法比较。
- **tombstone 防复活**：`deleted=1` 且 revision ≥ 对端时胜出；同 revision 下 `deleted=1` 胜出（删除优先是 OR-Set 的标准语义）。
- **时间戳只做决胜局**：时钟漂移不做信任假设（PITFALLS #8），全序链末端是 device_id 字典序——确定性高于「正确性」。
- **非破坏兜底**：任何无法判定的情况 = 保留双份（如同 id 同 revision 不同内容 → 对端副本以新 UUID 落库并标记 note 前缀「冲突副本」）——v1 实践中几乎不会触发，但规则必须显式存在。

### Pattern 3: 传输分层——reqwest_dav 高层方法 + 公开 agent 原生请求

**What:** `reqwest_dav` 高层方法（`list/get/put/mkcol/mv/delete`，Basic/Digest 自动协商 [CITED: github.com/niuhuan/reqwest_dav README]）覆盖无头请求；**自定义头场景走 `client.agent`（`pub agent: reqwest::Client`）[VERIFIED: docs.rs reqwest_dav 0.3.3 struct.Client]**：

| 场景 | 方法 | 头 |
|------|------|-----|
| 探活/认证校验（D-97） | `client.list(path, Depth::Zero)` | — |
| 首次创建状态文件 | agent PUT | `If-None-Match: *` |
| 更新状态文件 | agent PUT | `If-Match: "<etag>"` |
| Nextcloud 分块 v2 | agent MKCOL/PUT/MOVE | `Destination`（每个请求）、`OC-Total-Length`（配额预检）、`X-OC-Mtime`（保留 mtime）[CITED: docs.nextcloud.com chunking] |
| 下载续传 | agent GET | `Range: bytes=N-` |
| 上传书文件（<阈值） | agent PUT 流式 body | `If-None-Match: *` |

**自定义 agent 注入（TLS 开关的实现点 — D-95）:**

```rust
// Source: docs.rs reqwest_dav 0.3.3 ClientBuilder::set_agent（已验证签名存在）
let agent = reqwest::Client::builder()
    .user_agent("pillowtome/0.1")
    .timeout(Duration::from_secs(60))
    .danger_accept_invalid_certs(cfg.trust_self_signed)   // 仅当用户显式开启（D-95）
    .build()?;
let client = reqwest_dav::ClientBuilder::new()
    .set_host(cfg.server_url.clone())
    .set_auth(reqwest_dav::Auth::Basic(user, password))
    .set_agent(agent)          // 注入后高层方法与原生请求共享同一 TLS/超时策略
    .build()?;
```

**TLS 栈说明（reqwest 0.13）:** 默认特性 = rustls + `rustls-platform-verifier`（系统根证书）[VERIFIED: reqwest 0.13.4 Cargo.toml `rustls = ["__rustls-aws-lc-rs", "dep:rustls-platform-verifier", "__rustls"]`]。系统根证书对自托管场景是**优点**（用户导入设备的私有 CA 直接可用）；已知边缘：rustls-platform-verifier 在 Android 上 CRL 经 HTTP 拉取被 cleartext 规则拦截时可能误报吊销 [CITED: matrix-org/matrix-rust-sdk#6319]——我们的自签名开关 + 错误分类文案可兜底，保持默认栈不绕道。

### Pattern 4: 凭据 = keyring，密码不过 IPC

**What:** `keyring::Entry::new("pillowtome", &account_key)`；`account_key` = 服务器 URL 归一化后的派生串（支持改服务器后旧凭据可清理）。前端只经 IPC 拿 `{configured: bool, server_url, username}`——**密码从不序列化进 IPC/日志/toast**。

**平台矩阵 [VERIFIED: crates.io keyring 4.1.5 features + CITED: docs.rs android-native-keyring-store]:**
- Windows → Windows Credential Manager（默认 v1 feature）
- macOS → Keychain（默认 v1 feature）
- Linux → zbus Secret Service（GNOME Keyring/KWallet；无 provider 时软失败中文提示「系统密钥环不可用」）
- Android → `android-native-keyring-store` feature（Android Keystore 加密 + SharedPreferences）

**⚠ Android 集成关键坑（必须进计划）:** tao 自 0.35.x 起**不再初始化 ndk-context**（多窗口改造；本项目 lock 为 tao 0.35.3）[CITED: tauri-apps/tao#1220]。android-native-keyring-store 要求 ndk-context [CITED: docs.rs crate 说明]。本项目已手工维护 `src-tauri/gen/android/app/src/main/java/com/pillowtome/app/MainActivity.kt`（05-07 的 ActionMode 抑制即在此），按其官方「Manual initialization through Java/Kotlin Code」路径加一个伴生初始化即可（数行 Kotlin，`initializeNdkContext(applicationContext)`）。**Wave 0 必须先在 AVD 上做 keyring 读写冒烟**，失败则整个 SYNC-01 安卓侧阻塞——这是本阶段最高风险的集成点。

### Pattern 5: 文件平面——阈值分块 + Nextcloud chunk v2 + 流式续传

**Nextcloud chunked upload v2（实测语义，逐条对实现）** [CITED: docs.nextcloud.com/server/latest/developer_manual/client_apis/WebDAV/chunking.html]:
1. `MKCOL /remote.php/dav/uploads/<user>/pillowtome-<uuid>`（头带 `Destination: <最终文件 URL>`——**每个请求都要带**）
2. 分块 PUT 到 `<upload-dir>/<整数块名>`：块名 1..10000 整数、按名序组装、每块 5MB–5GB（最后一块可小）、带 `OC-Total-Length` 让配额在首块即 507 预检
3. `MOVE <upload-dir>/.file` → `Destination` 组装；组装期间可能 **423 Locked**（finalize 中）或慢存储 **504**——都按可重试处理（指数退避）
4. 上传目录 **24 小时不活动过期**——续传状态带时间戳，过期即整传
5. 中止 = DELETE 上传目录

**推荐参数（Claude's Discretion 答案）:** 阈值 = **10MB**；块大小 = **10MB**（满足 5MB 下限，100MB 代理体上限远够不着）；块名用 `1..N` 零填充整数。续传状态持久化进新表 `sync_file_state`（work_id、transfer_uuid、已确认块清单、文件 size/hash、开始时间戳）——中断后 PROPFIND 上传目录比对缺块，只补缺的。

**通用服务器（RFC 4918，无组装语义）:** 见 Open Questions Q1——推荐修正为流式整 PUT + 失败重传，`Body::from(tokio::fs::File)` 不缓冲（300MB 书不进内存）。

**下载：** GET 先探 `Accept-Ranges`；支持则分片 + `.part` 临时文件断点续传；完成后 **blake3 全量校验 == work_id**（D-100 单一真相：校验通过才交 `import-pipeline` 重解析元数据/封面）。

### Anti-Patterns to Avoid
- **整文件 LWW blob 同步**（PITFALLS #7，已锁定禁止）——用每设备状态文件 + merge.rs。
- **对端合入记录回写本地 change_log**——时钟膨胀 + 循环推送；change_log 只记本机操作。
- **密码/凭据进 SQLite、进远端、进日志/toast**——SYNC-01 + 锁定决策；keychain 外只有「已配置」布尔。
- **在 JS 侧做 WebDAV**——锁定 Rust core 单实现；前端只发触发信号。
- **reqwest_dav `put(Vec<u8>)` 传大书**——它要整文件进内存（docs 原文「transformed into a vector of bytes」）；大文件必须走 agent 流式。
- **为通用服务器发明「分块 PUT 序列」**——RFC 4918 无组装语义，零件文件拼不起来（见 Q1）。
- **后台轮询/定时同步**——D-91 明确否决；电量与限流双输。
- **比较 mtime 判定变更**——时钟不可信（PITFALLS #8）；用 ETag（不透明令牌，只等值比较，绝不解析）与 content hash。

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WebDAV 协议（PROPFIND XML/multistatus/Digest 握手） | 手写 reqwest 请求 + XML 解析 | `reqwest_dav =0.3.3` | RFC 4918 状态码/Depth/百分号编码的边角极多；Digest 质询握手已内置 |
| OS keychain（4 平台） | 自存加密文件 / tauri-plugin-store | `keyring =4.1.5` | 锁定「OS keychain」；自存加密文件 = 自造密码学（V6 红线） |
| Nextcloud 分块协议 | 「先整个 PUT 试试」 | chunk v2（MKCOL→PUT 块→MOVE .file） | 代理 100MB 体上限/504 是真实环境常态（PITFALLS #8）；423 重试语义官方明确 |
| 合并语义 | 现场 if-else 拼 | merge.rs 纯函数三件套 | 冲突消解必须 off-device 穷举测试；散在 IO 代码里无法测 |
| Mock WebDAV 服务器（测试） | 自写 hyper fake | `wiremock =0.6.5`（dev） | 6250 万下载的标准方案；reqwest_dav 自身 dev-dep 也是它 |

**Key insight:** 本阶段真正要自己写的是**合并语义与状态机**（项目自有设计，CONTEXT 已锁定规则），其余全是「选对库 + 防御性编码」。

## Common Pitfalls

### Pitfall 1: Android 上 keyring 静默失败（ndk-context 未初始化）
**What goes wrong:** 桌面端 keyring 一切正常；Android 上 `Entry::get_password` 直接 panic 或返回永久错误，SYNC-01 安卓侧整体不可用。
**Why it happens:** tao 0.35.x 移除了 ndk-context 初始化（tauri-apps/tao#1220），而 android-native-keyring-store 强依赖它。
**How to avoid:** Wave 0 即在 `MainActivity.kt`（项目已手工维护此文件）按官方手册路径加 ndk-context 初始化，并在 AVD 生产 APK 上做写入→读取→删除冒烟（CLAUDE.md 设备 gate：必须生产 APK，不能 `tauri android dev`）。
**Warning signs:** Android logcat 出现 `NullPointerException`/`android context` 相关 panic；`get_password` 返回 `NoEntry` 之外的硬错误。

### Pitfall 2: reqwest_dav 高层 API 不支持自定义头，条件并发悄悄失效
**What goes wrong:** 以为 `client.put(...)` 能带 `If-Match`，实际 ETag 并发从未生效，双开实例互相覆盖状态文件。
**Why it happens:** 高层方法签名无 headers 参数（0.3.3 源码确认）。
**How to avoid:** 条件写、分块、Range 一律走 `client.agent` 原生请求（共享同一 TLS/认证配置）；单测用 wiremock 断言 `If-Match` 头真实到达。
**Warning signs:** 412/冲突路径在测试中从未被触发。

### Pitfall 3: 坚果云限流（503）与分页截断
**What goes wrong:** 同步偶发 503；书目多时 PROPFIND 结果被截到 750 项，远端「少书」。[CITED: help.jianguoyun.com/?p=2064 免费 600 次/30min、付费 1500 次/30min；单请求 750 文件分页]
**Why it happens:** 多小文件设计 + 频繁 PROPFIND；忽略分页。
**How to avoid:** 每设备单文件模型（Pattern 1）把请求压到个位数；books/ 列表走分页防御（>750 时循环拉取）；503/429 一律指数退避 + 中文提示「服务器限流，请稍后重试」；D-90 触发模型天然低请求。
**Warning signs:** 免费坚果云账号上连续同步失败；大库时远端书目数对不上。

### Pitfall 4: 大文件经 `put(Vec<u8>)` 进内存，Android OOM
**What goes wrong:** 300MB PDF 上传时 Android 被杀（与 PITFALLS #11 同类）。
**Why it happens:** reqwest_dav `put` 签名要 `Vec<u8>`。
**How to avoid:** 超阈值文件一律 agent + `Body::from(File)` 流式；分块也流式（`Body::wrap_stream` 或按块 seek 读取）。
**Warning signs:** 上传大书时内存曲线陡升；低端机 sync 进程消失。

### Pitfall 5: 远端布局「半成品」状态被对端误读
**What goes wrong:** 推送中断，对端拉到半个状态文件/半个书目，合并出幽灵记录。
**Why it happens:** WebDAV PUT 不是原子的（尤其代理截断）。
**How to avoid:** 状态文件写临时名 `state/{device_id}.json.tmp-<uuid>` 再 MOVE 覆盖（MOVE 在 DAV 上是原子rename 语义，Nextcloud/sabre 均支持）；对端只读正式名；`If-Match` 保护写-写。
**Warning signs:** 对端偶发 JSON 解析错误；merge 后出现不存在设备的记录。

### Pitfall 6: hash_algo 混用导致「假变更」风暴
**What goes wrong:** 把 annotation 的 SHA-256 hash 拿去和 blake3 规则比（或反之），幂等性失效，每次同步都当变更重推。
**Why it happens:** 双算法 split（锁定决策中明确警告）。
**How to avoid:** 比较前先读记录的 `hash_algo`；merge.rs 单测覆盖双算法用例。
**Warning signs:** 每次同步 ops 数异常大；无操作时远端文件 updated_at 仍变化。

### Pitfall 7: 撤回（D-92）丢本地原位
**What goes wrong:** 静默跳到最远后，用户点撤回但本地原位置已被覆盖，无法跳回。
**Why it happens:** merge 直接覆盖本地 locator 行。
**How to avoid:** merge_progress 输出携带「被替换的本地原位置」；撤回窗口期内（本会话）保留在内存 + 同步痕迹 UI；落库前先把旧值暂存。
**Warning signs:** 撤回按钮点了没反应或跳到错误位置。

### Pitfall 8: 服务器怪癖差异（D-94 矩阵）
**What goes wrong:** 在本地 dufs 上全绿，换 Nutstore/群晖/代理后 Nextcloud 就挂：尾斜杠重定向丢 body、百分号双重编码、MOVE 到已存在路径 412/409、ETag 带引号与否、弱 ETag。
**Why it happens:**「WebDAV」是一个松散家族。
**How to avoid:** remote.rs 单点处理路径归一（始终无尾斜杠 + 逐段百分号编码）；MOVE 前先 DELETE 目标或用 `Overwrite: T`；ETag 只做不透明等值比较；验证矩阵含「真实代理后的 Nextcloud」（D-94）。
**Warning signs:** 某服务器上 409/404 比例异常；文件名含中文/空格时 404。

## Code Examples

### 连接测试 + 远端引导（D-97，保存前强制）
```rust
// Source: 设计样例（基于 reqwest_dav 0.3.3 API，docs.rs 已验证签名）
pub async fn test_and_bootstrap(client: &reqwest_dav::Client, root: &str)
    -> Result<(), SyncConfigError>
{
    // 1) PROPFIND depth:0 探活 + 认证校验（401→认证失败 / 证书→证书问题 / 超时→地址不通）
    client.list(root, reqwest_dav::Depth::Zero).await
        .map_err(SyncConfigError::classify)?;   // classify → 中文四类（D-97）
    // 2) 远端目录自动创建（已存在时的 405/409 视为成功）
    for sub in ["", "books", "state", "devices"] {
        match client.mkcol(&format!("{root}/{sub}")).await {
            Ok(_) => {}
            Err(e) if is_already_exists(&e) => {}
            Err(e) => return Err(SyncConfigError::classify(e)), // 403→目录无权限
        }
    }
    // 3) manifest.json（远端结构版本号，Claude's Discretion 项：推荐带 format 字段）
    put_if_absent(client, &format!("{root}/manifest.json"),
        br#"{"format":1,"app":"pillowtome"}"#).await?;
    Ok(())
}
```

### 条件 PUT（状态文件防并发覆盖）
```rust
// Source: 设计样例（agent 原生请求；If-None-Match/If-Match 语义为 RFC 9110 标准）
let resp = client.agent
    .put(client.host.clone() + "/state/" + device_id + ".json")
    .header("If-None-Match", "*")            // 首次创建；后续换 If-Match: "<etag>"
    .header("Content-Type", "application/json")
    .body(body_bytes)
    .send().await?;
match resp.status().as_u16() {
    200 | 201 | 204 => save_etag(resp.headers().get("etag")),
    412 => return Err(SyncError::RemoteChanged),  // 重拉-合并-重试
    s => return Err(SyncError::Http(s)),
}
```

### Nextcloud 分块上传（chunk v2 骨架）
```rust
// Source: docs.nextcloud.com chunking（语义逐条对应官方文档）
async fn chunked_upload(agent: &reqwest::Client, base: &str, dest: &str, file: &Path) -> Result<()> {
    let transfer = format!("pillowtome-{}", uuid::Uuid::new_v4());
    let up = format!("{base}/remote.php/dav/uploads/{user}/{transfer}");
    agent.request(Method::from_bytes(b"MKCOL")?, &up).header("Destination", dest).send().await?;
    let mut f = tokio::fs::File::open(file).await?;
    for (i, chunk) in plan_chunks(&f, CHUNK_SIZE).await?.iter().enumerate() {
        agent.put(format!("{up}/{}", i + 1))                    // 整数块名 1..=10000
            .header("Destination", dest)
            .header("OC-Total-Length", total_len.to_string())  // 配额首块预检（507）
            .body(chunk_body(&mut f, chunk).await?)            // 流式，不整读
            .send().await?.error_for_status()?;
    }
    // 组装：423 Locked / 504 = 可重试（指数退避），不是终态
    retry_backoff(|| agent.request(Method::from_bytes(b"MOVE")?, &format!("{up}/.file"))
        .header("Destination", dest)
        .header("OC-Total-Length", total_len.to_string())
        .header("X-OC-Mtime", mtime.to_string()).send()).await?;
    Ok(())
}
```

### keyring 凭据读写（密码不过 IPC）
```rust
// Source: keyring-rs 标准用法（docs.rs keyring 4.x Entry API）
pub fn save_password(server_url: &str, username: &str, password: &str) -> Result<()> {
    let entry = keyring::Entry::new("pillowtome", &account_key(server_url, username))?;
    entry.set_password(password)?;      // Windows CM / macOS Keychain / Secret Service / Android Keystore
    Ok(())
}
// 前端 IPC 只暴露：is_configured() -> bool、get_public_config() -> {url, username}
// 密码永远不进 serde 序列化结构体。
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `reqwest_dav` 0.2.1（STACK.md 2026-07-09 锁定） | `reqwest_dav` 0.3.3（reqwest 0.13 底座） | 2026-03-02 | 与 lock 已有 reqwest 0.13.4 统一；继续钉 0.2.1 会拖入 reqwest 0.12 双版本 |
| reqwest 0.12（native-tls / webpki-roots 时代） | reqwest 0.13：默认 rustls + rustls-platform-verifier（系统根证书） | 2025 末–2026 | 自托管私有 CA 导入系统即可用；Android CRL 边缘已知（matrix-rust-sdk#6319） |
| tao 初始化 ndk-context（老 Tauri Android） | tao 0.35.x 起移除，App 自行初始化 | 2026-05（tao#1220） | keyring-on-Android 必须改 MainActivity stub（项目已有手工维护先例） |
| keyring 3.x（分平台 crate 散装） | keyring 4.1.5（v1 默认 store + feature 化 Android store） | 2026 | 单 crate 覆盖四端；Android store 为显式 feature |

**Deprecated/outdated:**
- `reqwest_dav` 0.2.x 线：被 0.3.x（reqwest 0.13）取代。
- tauri-plugin-stronghold 作为本阶段凭据方案：非 OS keychain，违反 SYNC-01 锁定语义。

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `If-None-Match: *` / `If-Match` 在坚果云、群晖、rclone serve 上被正确执行（RFC 语义） | Pattern 1/3 | 中：并发覆盖检测在这些服务器上退化——防御：检测 ETag 响应头缺失时降级为「先 GET 比对」并记录 matrix 备注 |
| A2 | 坚果云 WebDAV 单文件 500MB 上限对本阶段可接受（超限书文件给出中文错误不同步文件平面，状态平面不受影响） | Environment/Pitfall 3 | 低：官方帮助中心明示 500MB 默认限制 [CITED]，超大书本就是边缘 |
| A3 | `rustls-platform-verifier` 的 Android CRL 边缘（matrix#6319）不影响主流自签/公网 CA 场景 | Pattern 3 TLS 说明 | 低：有 D-95 自签名开关 + 中文错误分类兜底 |
| A4 | `tauri_plugin_sql::DbInstances` 在 2.4.0 可从 AppHandle state 取出并复用 sqlx pool（合并写入复用同一连接） | Responsibility Map | 中：若不可行，备选 = 合并结果经 IPC 回前端走既有 plugin-sql 写路径（仍单 binding，只是多一跳） |
| A5 | 坚果云 503 即限流信号（社区报告），按 429 同等退避处理 | Pitfall 3 | 低：退避策略对两者一致 |

## Open Questions

1. **Q1（对 D-101 的修正建议）：通用服务器「大块 PUT 序列」在无服务端组装语义下不成立**
   - What we know: RFC 4918 没有分块组装；Nextcloud chunk v2 是私有协议；坚果云另有 500MB 单文件上限。D-101 锁定的「通用服务器退化为大块 PUT 序列；中断可续传」按字面实现会留下拼不起来的零件文件，违反 D-105（用户在网盘里能认出自己的书）。
   - What's unclear: 用户是否接受「通用服务器 = 流式整 PUT + 失败从头重传（仍不整读进内存）」作为 v1 退化语义。
   - Recommendation: 修正为：Nextcloud → chunk v2 断点续传；通用 → 流式整 PUT + 重试（进度可见、失败可手动重试）；代理 100MB/504 场景由「Nextcloud 路径 + 中文错误引导」覆盖。planner 在 07-03 计划中将此作为 D-101 的研究修正显式呈现给用户。

2. **Q2：书目删除是否跨端传播（library_item 目前是物理 DELETE）**
   - What we know: annotation 已 tombstone（D-80），但 `library-store.ts::deleteLibraryItem` 是物理删除；若目录删除不传播，对端会因集合并而「复活」已删书籍。
   - What's unclear: v1 是否接受「删除不跨端」（每端独立删）或落 SCHEMA_V8 给 library_item 加 `deleted` tombstone。
   - Recommendation: 加 tombstone（与 annotation 同一模式，改动小、语义一致），否则「复活」是用户可感知的数据诡异。planner 决断。

3. **Q3：占位卡触发下载时的并发打开边界**
   - What we know: D-99 点击下载→后台完成→可读；下载中再点/开书的交互细节未定。
   - Recommendation: 下载中卡片显示进度态并禁用打开；完成走 import-pipeline 后即正常书。细节留 planner/UI-SPEC。

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Rust/cargo | 全部 | ✓ | 1.96.0 | — |
| node / pnpm | 前端 + vitest | ✓ | node v22.15.0 | — |
| AVD（Medium_Phone_API_36.1 或物理机）+ 生产 APK 流程 | 设备 gate（CLAUDE.md 强制） | ✓（项目既有流程，docs/ANDROID-BUILD.md） | — | — |
| Docker Desktop | 「真实代理后的 Nextcloud」验证矩阵（D-94） | ⚠ 已安装但 daemon 未运行（npipe 不通，实测） | client 29.4.3 | 用户手动启动 Docker；或用真实远程 Nextcloud 实例 |
| dufs / rclone | 本地通用 WebDAV 测试服务器 | ✗ 未安装 | — | `cargo install dufs --locked` 或 wiremock（CI 内全 fake）；Nextcloud docker 兼测 |
| Nextcloud 实例（代理后） | D-94 验证矩阵 | ✗ 本机无 | — | docker 启动 nextcloud:stable + nginx 代理（需 daemon） |
| 坚果云账号（含应用密码） | D-94 验证矩阵 | 用户持有（人工） | — | 免费档即可覆盖限流路径 |
| 科学上网/HTTP 代理工具 | 模拟 100MB 体上限/504 | 未配置 | — | nginx `client_max_body_size 100m` 本地代理即可复现 |

**Missing dependencies with no fallback:** 无硬阻塞——docker daemon 停止仅影响「真实代理 Nextcloud」的启动时机（用户启动即可）。
**Missing dependencies with fallback:** dufs/rclone（wiremock 可覆盖 CI；本地手动验证可用 docker 或 cargo install）；坚果云账号（人工注册，验证矩阵项）。

## Validation Architecture

> `workflow.nyquist_validation = true`（.planning/config.json）。测试框架双轨：**vitest@3.2.4**（前端纯逻辑，`pnpm test`）+ **cargo test**（core 纯函数 + src-tauri，含 wiremock 传输层）。

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.2.4（前端）；cargo test + wiremock 0.6.5（Rust） |
| Config file | `vitest.config.ts`（既有）；cargo 无额外配置 |
| Quick run command | `pnpm test src/library/` / `cargo test -p pillowtome-core sync` |
| Full suite command | `pnpm test && tsc && pnpm build` + `cargo test --workspace` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SYNC-01 | keyring 存/取/删（desktop）+ 配置错误分类（地址不通/认证失败/证书/无权限） | unit + integration（wiremock 401/TLS/timeout 矩阵） | `cargo test -p pillowtome sync::credentials sync::transport` | ❌ Wave 0 |
| SYNC-01 | Android keyring 读写冒烟（ndk-context 初始化后） | manual（AVD 生产 APK，CLAUDE.md gate） | `pnpm tauri android build --debug --target x86_64 --apk` + 人工 | ❌ Wave 0 spike |
| SYNC-02 | progress merge：双设备交错场景全序确定性（含撤回副产物） | unit（穷举 fixture） | `cargo test -p pillowtome-core sync::merge` | ❌ Wave 0 |
| SYNC-02 | 开书拉到更远进度→静默跳+痕迹+撤回 | integration + manual | vitest（merge-undo UI 逻辑）+ AVD 人工 | ❌ Wave 0 |
| SYNC-03 | annotation merge：并集/tombstone 防复活/同 id 冲突消解/hash_algo 双算法 | unit（穷举 fixture：双端新增/删/改交错） | `cargo test -p pillowtome-core sync::merge` | ❌ Wave 0 |
| SYNC-03 | 端到端：A 端标注→推送→B 端拉取→重放渲染无丢失 | integration（双实例 + wiremock/dufs） | `cargo test -p pillowtome sync::e2e`（双 SqlitePool in-memory） | ❌ Wave 1 |
| SYNC-04 | 分块规划器（阈值/块名/续传状态）、流式不整读、下载 blake3 校验 | unit | `cargo test -p pillowtome-core sync::fileplane` | ❌ Wave 1 |
| SYNC-04 | Nextcloud chunk v2 全流程（MKCOL→块→MOVE，423/504 重试） | integration（wiremock 状态机模拟） | `cargo test -p pillowtome sync::chunked_upload` | ❌ Wave 1 |
| SYNC-05 | 远端写并发：If-None-Match/If-Match/412 重试路径 | integration（wiremock 断言请求头） | `cargo test -p pillowtome sync::conditional_put` | ❌ Wave 1 |
| SYNC-05 | 「不丢数据」性质测试：任意双侧操作序列合并后 = 集合并 | property-style 穷举（固定种子组合矩阵） | `cargo test -p pillowtome-core sync::merge::prop` | ❌ Wave 1 |
| SYNC-01..05 | 服务器矩阵（Nextcloud 代理后 / 坚果云 / 通用 dufs）手动验收 | manual checkpoint | 按 07-04 验收清单（D-94） | 手动 gate |

### Sampling Rate
- **Per task commit:** `cargo test -p pillowtome-core sync` + `pnpm test <touched>` + `tsc`
- **Per wave merge:** `cargo test --workspace` + `pnpm test && pnpm build`
- **Phase gate:** 全套绿 + **AVD 生产 APK 设备验收**（keychain 读写、开书拉/合书推、占位卡下载、撤回弹窗）+ 真实服务器矩阵三席至少各跑一轮 → 后 `/gsd-verify-work`

### Wave 0 Gaps
- [ ] 依赖落位：`reqwest_dav =0.3.3`、`keyring =4.1.5`（+android feature）、`wiremock =0.6.5`（dev）→ Cargo.lock 提交（D-13）
- [ ] **Android keyring spike**（最高风险）：MainActivity.kt ndk-context 初始化 + AVD 生产 APK 读写冒烟
- [ ] `core/src/sync/{model,merge,remote}.rs` 骨架 + merge 穷举 fixture（progress/annotation/library 三件套）
- [ ] `src-tauri/tests/sync_transport.rs` wiremock 骨架（401/423/504/412/ETag 矩阵）
- [ ] SCHEMA_V8（append-only）：`library_item.deleted`（Q2 若采纳）、`library_item.file_sync_enabled`、`sync_file_state`（分块续传状态）、`sync_state`（远端 ETag/上次同步时间/失败原因）
- [ ] locator 写路径补 change_log 追加（entity='locator'，现状缺口——见下）

## Security Domain

> `security_enforcement = true`，ASVS L1，`security_block_on = high`。本阶段引入**网络出入口 + 凭据**，攻击面显著大于前序阶段。

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | WebDAV Basic（仅 TLS 下）/Digest 自动协商（D-96）；应用密码引导文案；密码复杂度交给服务器，客户端不评判 |
| V3 Session Management | no | 无会话（每次请求独立认证） |
| V4 Access Control | yes（弱） | 远端操作 jailed 在用户配置的 `pillowtome/` 根下；`..`/绝对路径注入在 remote.rs 拒绝 |
| V5 Input Validation | yes | 远端路径逐段清洗 + 百分号编码（remote.rs 单点）；PROPFIND/multistatus XML 视为不可信输入（serde-xml-rs 不解析外部实体，仍做尺寸/深度上限）；远端状态文件 JSON 反序列化全字段校验（serde deny_unknown_fields 不必要，但数值范围断言） |
| V6 Cryptography | yes | TLS 默认严格（D-95）；「信任自签名」为用户显式开关 + 中文警示，绝不默认；**不自造密码学**；凭据存储委托 OS keychain（V6.2 级控制） |
| V7 Errors/Logging | yes | 中文错误分类（D-97）但**绝不回显密码/Authorization 头/完整带凭据 URL**；同步失败原因进设置页（D-93），敏感细节只进本地日志 |
| V12 Files/Resources | yes | 上传流式不整读（OOM 防护）；下载写 `.part` 临时文件 + blake3 校验后更名；远端文件名清洗（`/\:*?"<>\|` 与控制字符） |

### Known Threat Patterns for Tauri + WebDAV 自托管同步

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| 凭据落盘/随同步外泄 | Info Disclosure | keyring only；远端不存凭据；IPC 只传「已配置」布尔；日志脱敏 |
| 明文 HTTP 下 Basic = 密码裸奔 | Info Disclosure | D-95：HTTP 默认拒绝；「允许 HTTP」开关带「仅局域网」中文警示；Digest 仅在 TLS/显式放行下协商 |
| 自签名校验全放行 | MITM | 两个独立开关（D-95），禁止单一全放行；开关状态设置页可见 |
| 恶意/损坏服务器返回巨型或递归 multistatus | DoS | 响应体尺寸上限 + list 深度限制 + 超时（60s 默认） |
| 远端书目行注入非法路径（`../../`） | Tampering | remote.rs 白名单字符 + 拒绝分隔符；所有远端拼路径单点函数 |
| 状态文件被代理/服务器篡改 | Tampering | 自托管信任模型文档化（设置页明示「服务器可见书目明文」D-105 已接受）；E2EE 明确出 scope |
| 下载书文件被替换（中间人/服务器作恶） | Tampering | 下载后 blake3 == work_id 校验，不匹配即拒（D-100 单一真相） |
| 新 IPC 命令面扩大 | Elevation | capabilities 最小授权：仅 `sync_*` 命令进 default.json；无 fs/shell 新权限 |

## Project Constraints (from CLAUDE.md)

- **Android emulator gate (mandatory)**：凡改动阅读壳层/协议/导入等的任务，完成前必须在 AVD（Medium_Phone_API_36.1 或物理机）人工/截图验收，且**必须跑独立/生产 APK**（`pnpm tauri android build --debug --target x86_64 --apk` + `adb install -r` + force-stop 冷启动），不能只跑 `pnpm tauri android dev`。→ 适用：SYNC-01 安卓 keychain、开书拉/合书推钩子、占位卡下载、撤回弹窗。
- **Touch/scroll gate**：禁止在可滚动内容上盖全屏透明 `pointer-events:auto` 层；ScrollArea 父级 `min-h-0`；sheet 结构 `flex flex-col max-h-[…]` + body `flex-1 min-h-0 overflow-y-auto` + `touch-action: pan-y`。→ 适用：同步设置 sheet、占位卡列表、撤回弹窗。
- **Supply-chain**：精确钉版本（`=`），提交 Cargo.lock / pnpm-lock.yaml；不引入浮动区间。
- **单 SQLite binding**（Pitfall 6）：合并写入复用 tauri-plugin-sql 的 pool，不引入 rusqlite 或第二 sqlx 连接源。
- **软失败 + 简体中文**：所有用户可见文案简体中文（D-30）；同步失败 toast 不弹模态（D-93）。
- **GSD Workflow**：编辑经 GSD 命令入口（本研究由 /gsd-plan-phase 触发，合规）。

## Sources

### Primary (HIGH confidence)
- [docs.rs/reqwest_dav 0.3.3](https://docs.rs/reqwest_dav/0.3.3/reqwest_dav/) + [struct.Client](https://docs.rs/reqwest_dav/0.3.3/reqwest_dav/struct.Client.html) + [ClientBuilder](https://docs.rs/reqwest_dav/0.3.3/reqwest_dav/struct.ClientBuilder.html) — `pub agent`、`set_agent`、方法面（list/get/put/mkcol/mv/delete/unzip）
- [github.com/niuhuan/reqwest_dav Cargo.toml + README](https://github.com/niuhuan/reqwest_dav) — 0.3.3 依赖 reqwest 0.13；Basic/Digest 示例；put 需 Vec<u8>
- [docs.nextcloud.com chunking（chunked upload v2）](https://docs.nextcloud.com/server/latest/developer_manual/client_apis/WebDAV/chunking.html) — Destination 头、块名 1..10000、5MB–5GB、OC-Total-Length/507、MOVE .file 组装、423/504、24h 过期、X-OC-Mtime
- [help.jianguoyun.com/?p=2064（坚果云官方）](https://help.jianguoyun.com/?p=2064) — 应用密码生成、500MB 上传上限、600/1500 请求/30min、750 项/请求分页
- [crates.io API 实测](https://crates.io/api/v1/crates/) + `cargo search/info` — reqwest_dav 0.3.3 / keyring 4.1.5 / wiremock 0.6.5 版本与下载量
- [docs.rs keyring 4.1.5 + android-native-keyring-store](https://docs.rs/android-native-keyring-store/latest/android_native_keyring_store/) — Android store = SharedPreferences+Keystore，需 ndk-context
- [reqwest 0.13.4 Cargo.toml](https://raw.githubusercontent.com/seanmonstar/reqwest/v0.13.4/Cargo.toml) — 默认 default-tls=rustls→rustls-platform-verifier+aws-lc-rs；`danger_accept_invalid_certs` 存在（docs.rs ClientBuilder）
- [docs.rs tauri-plugin-sql 2.4.0 DbInstances](https://docs.rs/tauri-plugin-sql/2.4.0/tauri_plugin_sql/struct.DbInstances.html) — 公开 `RwLock<HashMap<String, DbPool>>`，Rust 侧复用同一 pool
- 项目内：`src-tauri/src/migrations.rs`（V1..V7）、`src/reader/annotation-store.ts`（change_log 追加 + hash_algo 警告）、`src/reader/locator-store.ts`（进度 upsert，无 change_log）、`src/library/library-store.ts`（物理 DELETE）、`Cargo.lock`（tao 0.35.3 / tauri 2.11.5 / reqwest 0.13.4）

### Secondary (MEDIUM confidence)
- [tauri-apps/tao#1220](https://github.com/tauri-apps/tao/issues/1220) — tao 移除 ndk-context 初始化（需 App 自行处理；android-native-keyring-store#21 有变通）
- [matrix-org/matrix-rust-sdk#6319](https://github.com/matrix-org/matrix-rust-sdk/issues/6319) — reqwest 0.13/rustls-platform-verifier 在 Android 的 CRL 边缘
- [android-keyring README（lib.rs）](https://lib.rs/crates/android-keyring) — ndk-context 就绪项目（Tauri Mobile 等）的开箱路径与手工 Kotlin 初始化代码
- 坚果云 503=限流的社区报告（gitcode/CSDN/Obsidian 中文论坛）——与官方频率限制互相印证

### Tertiary (LOW confidence)
- 各服务器对 `If-None-Match: *` 的支持一致性（A1）——需验证矩阵实测
- 群晖/Apache mod_dav 的 MOVE/尾斜杠怪癖细节——防御性编码覆盖，未逐一实测

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — 全部 registry + docs.rs 实测；reqwest_dav 版本漂移（0.2.1→0.3.3）已识别并修正
- Architecture: HIGH — 双平面/每设备状态文件/合并模型与 CONTEXT 锁定规则逐项对齐；Android keyring 集成有官方案例但有 tao 版本坑（已标注 Wave 0 spike）
- Pitfalls: HIGH — PITFALLS #7/#8 官方源复核 + 坚果云官方限额 + tao#1220 实证
- 合并模型（ROADMAP MEDIUM 标记项）: 现 **HIGH（设计层面）** — 规则已由 SYNC-05/CONTEXT 锁定，本研究给出可测的确定性全序与非破坏兜底；残余 MEDIUM 在「真实代理后 Nextcloud 行为」（验证矩阵项，非设计风险）

**Research date:** 2026-07-18
**Valid until:** 2026-08-17（crate 版本与 tao/ndk-context 状态为快变项；超过 30 天需复核 registry）
