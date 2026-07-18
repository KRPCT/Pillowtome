# Phase 7: WebDAV Self-Hosted Sync - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-18
**Phase:** 7-webdav-self-hosted-sync
**Areas discussed:** 同步触发时机, 服务器矩阵与 TLS, 书籍文件同步体验, 同步范围与远端布局

---

## 同步触发时机

**Q1: 基础同步节奏怎么定？（什么时候自动上传/下载变更）**

| Option | Description | Selected |
|--------|-------------|----------|
| 开书拉 + 合书推 + 手动兜底 | 打开书拉取最新状态；合书/退出阅读/切后台推送；书库手动「立即同步」兜底。KOReader 式，省电、请求少 | ✓ |
| 全自动实时推 | 变更后 debounce 几秒立即推送。最新性最强，但请求频繁、更耗电 | |
| 仅手动按钮 | 只有点按钮才同步。最简但用户忘了同步就读到旧进度 | |

**Q2: Android 后台要不要定时同步？（Doze 会限制后台任务）**

| Option | Description | Selected |
|--------|-------------|----------|
| 不做后台同步 | 同步只在 app 生命周期内；不加 WorkManager/前台服务，权限与电量面最小 | ✓ |
| WorkManager 周期同步 | 关着 app 也能推/拉，但受 Doze 限制且增加复杂度 | |
| 仅前台定时 | App 打开期间每 N 分钟对账，退后台即停 | |

**Q3: 开书时拉到「另一设备读得更远」的进度，界面上怎么处理？**

| Option | Description | Selected |
|--------|-------------|----------|
| 静默取最远 | 不打断阅读，但用户不知道「跳了」 | |
| 弹提示可撤销 | KOReader 式弹窗询问是否跳转 | |
| 静默跳 + 留痕迹 | 跳了但界面显示「已从其他设备同步」痕迹 | ✓ |

**User's choice:** 方案 3，并补充：**点击提示可弹窗撤回跳回原位**——撤回能力是交互核心。

**Q4: 同步状态在界面上怎么可见？**

| Option | Description | Selected |
|--------|-------------|----------|
| 状态点 + 设置页详情 | 书库同步按钮带状态点；设置页显示服务器/上次同步时间/失败原因；失败 toast 不弹模态 | ✓ |
| 极简不可见 | 只有失败才 toast | |
| 常驻状态图标 | 顶栏常驻图标，点击展开详情 | |

---

## 服务器矩阵与 TLS

**Q1: v1 必须兼容哪些 WebDAV 服务器？**

| Option | Description | Selected |
|--------|-------------|----------|
| 三类全过 | Nextcloud + 坚果云 Nutstore + 通用 RFC WebDAV（mod_dav/rclone serve/群晖）；防御性编码，坚果云限流怪癖处理 | ✓ |
| 只做标准 WebDAV | 按 RFC 4918 写，不验证具体服务 | |
| 只针对 Nextcloud | 优先 Nextcloud 私有 chunked 协议，其它「理论兼容」 | |

**Notes:** 坚果云是中文读者/KOReader 圈事实标准，必须进验证矩阵。

**Q2: TLS 与明文 HTTP 怎么处理？**

| Option | Description | Selected |
|--------|-------------|----------|
| 默认严格 + 显式放行开关 | 默认 HTTPS 严格校验；「允许 HTTP（仅局域网）」「信任自签名证书」两个独立开关 + 中文警示 | ✓ |
| 严格 HTTPS only | 自签名/HTTP 直接拒绝——家用 NAS 用户被挡 | |
| 全放行仅警告 | 明文 http 下 Basic 认证等于密码裸奔 | |

**Q3: 凭据输入与认证方式怎么设计？**

| Option | Description | Selected |
|--------|-------------|----------|
| 地址+用户名+应用密码 | 三字段；TLS 下 Basic，Digest 自动协商；keychain 存储；引导用应用密码 | ✓ |
| 三字段 + URL 粘贴导入 | 支持粘贴含凭据的 URL 快速导入 | |
| 仅 Basic/Digest 自动 | 等价于方案一 | |

**Q4: 保存服务器配置时要不要强制测试连接？**

| Option | Description | Selected |
|--------|-------------|----------|
| 保存前强制测试 | PROPFIND 探活 + 认证校验 + 远端目录自动创建；具体中文错误分类 | ✓ |
| 测试按钮不强制 | 未测试也能保存，错误延迟到首次同步 | |
| 保存即信任 | 首次同步才验证 | |

---

## 书籍文件同步体验

**Q1: SYNC-04 选择性文件同步的粒度怎么定？**

| Option | Description | Selected |
|--------|-------------|----------|
| 默认不同步，按书开启 | 每本书详情/长按菜单「同步此书」开关；带宽最小 | ✓ |
| 全局开关 + 按书排除 | 「自动上传所有书」默认关，开了按书排除 | |
| 两种模式都提供 | 默认手动按书，可切自动全部；边界复杂 | |

**Q2: 对端设备上「云端有、本地没」的书怎么呈现？**

| Option | Description | Selected |
|--------|-------------|----------|
| 占位卡 + 点击下载 | 书库显示云端书占位卡（封面+标题+云标记），点一下后台下载完即可读 | ✓ |
| 只显本地书 | 云端书要去专门界面手动拉 | |
| 占位卡 + 详情页下载 | 下载要点进详情页触发 | |

**Q3: 文件平面传什么？**

| Option | Description | Selected |
|--------|-------------|----------|
| 只传书文件，对端重解析 | 对端下载后走现有 import-pipeline 重解析元数据/封面；单一真相 | ✓ |
| 文件+元数据打包 | 对端免解析但引入两份真相 | |

**Q4: 大文件上传策略？**

| Option | Description | Selected |
|--------|-------------|----------|
| 阈值分块 + 断点续传 | 超阈值（约 10MB）分块：Nextcloud chunked v2，通用退化大块 PUT；抗代理 100MB 体上限/504 | ✓ |
| 整 PUT 重试 | 实现最简但大文件在真实代理环境易 504 | |
| 限大小上限 | 超过上限的书不同步文件 | |

**Notes:** ad-hoc Phase 6 已支持 PDF，几百 MB 的文件真实存在，分块不是可选项。

---

## 同步范围与远端布局

**Q1: 书库目录本身同步到什么程度？**

| Option | Description | Selected |
|--------|-------------|----------|
| 全书目同步 | 所有书上状态平面；未开文件同步的显示灰态「未同步」；两端书库视图一致 | ✓ |
| 只同步可用的书 | 对端只显示实际可读的书 | |

**Q2: 阅读设置要不要同步？**

| Option | Description | Selected |
|--------|-------------|----------|
| 不同步设置 | 字体/主题/CJK 开关各设备独立（手机夜间 vs 桌面日间） | ✓ |
| 同步阅读设置 | LWW per key，换设备连排版偏好跟过去 | |

**Q3: 远端目录路径怎么定？**

| Option | Description | Selected |
|--------|-------------|----------|
| 默认 pillowtome/ 可改 | 内含 books/、state/、devices/ 子结构；多设备必须同路径 | ✓ |
| 固定 pillowtome/ | 路径写死不可改 | |
| 完全自定义 | 连内部子结构都可配，配置漂移风险 | |

**Q4: 远端文件命名用人类可读还是哈希？**

| Option | Description | Selected |
|--------|-------------|----------|
| 人类可读命名 | 「作者 - 书名.格式」（重名追加短哈希）；change log 按 device_id 命名；网盘里可认可管理 | ✓ |
| 哈希命名 | 远端一堆乱码，隐私最强但无法手动管理 | |

---

## Claude's Discretion

- 分块阈值具体值（约 10MB 起）与续传状态持久化格式——research 对真实 Nextcloud/坚果云验证后定
- change log 传输格式细节（JSONL vs 单 JSON、压缩、rotate 策略）
- keyring 具体实现（`keyring` crate vs tauri-plugin-stronghold）——双端可用 + 精确钉版本
- device_id 生成与用户可见设备名（是否设置页可编辑）
- D-92 撤回弹窗的文案与布局细节（沿用 P2 UI-SPEC 纸感/朱砂语言）
- 远端结构是否带 format version 以便未来迁移

## Deferred Ideas

- Android 后台定时同步（WorkManager）——明确否决，用户反馈后再立 v2 项
- 阅读设置同步——v1 各端独立；v2 可重议
- KOReader kosync 协议互通——REQUIREMENTS v2 项（SYNC-06）
- 端到端加密（E2EE）同步——v1 基线 = keychain + TLS
- 同步冲突可视化管理界面——v1 全自动合并，可视化只到进度撤回弹窗
