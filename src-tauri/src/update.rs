//! 应用更新检查（UPD-01）。
//!
//! 架构约束：WebView 的 CSP `connect-src` 不放行外网，且 GitHub API 需要
//! User-Agent —— 检查在 Rust 侧用 reqwest（同步功能已锁定的同一 crate，
//! dep edge only，D-13 零新包）完成，只有小小的 `UpdateInfo` 结构跨 IPC。
//!
//! 数据源：GitHub Releases `latest`（正式发布；draft / prerelease 该端点
//! 不会返回）。发行即推送：发新 Release 后，各端下次启动即检出弹窗。
//! 网络失败只回 `Err`，前端决定静默（自动检查）还是 toast（手动检查）。

use serde::Serialize;

/// GitHub Releases `latest` 端点（只含正式发布，不含 draft/prerelease）。
const LATEST_RELEASE_API: &str =
    "https://api.github.com/repos/KRPCT/Pillowtome/releases/latest";

/// Android：初始化 rustls-platform-verifier 的 JVM 上下文（进程级 OnceCell，
/// 重复调用安全）。reqwest 0.13 的 rustls TLS 在 Android 上**未初始化即
/// panic**（「Expect rustls-platform-verifier to be initialized」）——不只是
/// `check_update`，https WebDAV 同步也走同一条验证器路径。VM/context 原始
/// 指针来自 ndk-context（tao 启动时已初始化，与 keychain 同一路径）。
/// JVM 组件（CertificateVerifier）经 `gen/android/app/build.gradle.kts`
/// 打入 APK。桌面端为 no-op。
#[cfg(target_os = "android")]
pub(crate) fn ensure_tls_verifier_init() -> Result<(), String> {
    use jni::objects::JObject;

    let ctx = ndk_context::android_context();
    let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) };
    vm.attach_current_thread(|env| {
        let context = unsafe { JObject::from_raw(env, ctx.context().cast()) };
        rustls_platform_verifier::android::init_with_env(env, context)
    })
    .map_err(|e| format!("设备 TLS 组件初始化失败：{e}"))
}

#[cfg(not(target_os = "android"))]
pub(crate) fn ensure_tls_verifier_init() -> Result<(), String> {
    Ok(())
}


/// 一次可用更新，形状按 WebView 需要裁剪（camelCase 跨 IPC）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    /// 新版本号（去掉 tag 前导 `v`），如 `1.1.0`。
    pub version: String,
    /// Release 正文（更新内容，markdown 原文，弹窗按原样排版）。
    pub notes: String,
    /// Release 页面 URL（「立即更新」在系统浏览器打开，由系统接管下载/安装）。
    pub url: String,
    /// 发布时间（ISO 8601，可为空串）。
    pub published_at: String,
    /// 当前运行版本（`CARGO_PKG_VERSION`）。
    pub current: String,
}

/// 解析 `1.2.3` / `v1.2.3`（忽略 `-prerelease` 与 `+build` 后缀）为可比较三元组。
pub fn parse_version(tag: &str) -> Option<(u64, u64, u64)> {
    let core = tag
        .trim()
        .trim_start_matches(['v', 'V'])
        .split(['-', '+'])
        .next()?;
    let mut parts = core.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next().unwrap_or("0").parse().ok()?;
    let patch = parts.next().unwrap_or("0").parse().ok()?;
    Some((major, minor, patch))
}

/// `latest` 是否严格新于 `current`（仅按数值三元组，预发布后缀不参与比较）。
pub fn is_newer_version(latest: &str, current: &str) -> bool {
    match (parse_version(latest), parse_version(current)) {
        (Some(l), Some(c)) => l > c,
        _ => false,
    }
}

/// 检查是否有新版本。`Ok(None)` = 已是最新；`Err` = 网络/接口失败。
#[tauri::command]
pub async fn check_update() -> Result<Option<UpdateInfo>, String> {
    // Android: rustls-platform-verifier 未初始化时 reqwest HTTPS 直接 panic —
    // 这里幂等兜底（正常路径已在 setup 初始化，失败则转成干净的 Err 文案）。
    ensure_tls_verifier_init()?;
    fetch_latest_release(LATEST_RELEASE_API, env!("CARGO_PKG_VERSION")).await
}

/// 从 Releases `latest` 端点取并判定更新（与 `check_update` 的唯一差异是
/// 端点可注入——wiremock 测试用；线上恒为 [`LATEST_RELEASE_API`]）。
pub async fn fetch_latest_release(api: &str, current: &str) -> Result<Option<UpdateInfo>, String> {
    let current = current.to_string();
    let agent = reqwest::Client::builder()
        .user_agent(format!("pillowtome/{current}"))
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("无法发起更新检查：{e}"))?;
    let resp = agent
        .get(api)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("检查更新失败（网络错误）：{e}"))?;
    let status = resp.status();
    if status.as_u16() == 404 {
        // 仓库尚无任何 Release —— 视为已是最新，不打扰用户。
        return Ok(None);
    }
    if !status.is_success() {
        return Err(format!("检查更新失败（HTTP {}）", status.as_u16()));
    }
    let text = resp
        .text()
        .await
        .map_err(|e| format!("检查更新失败（读取响应错误）：{e}"))?;
    let body: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("检查更新失败（响应解析错误）：{e}"))?;

    let tag = body
        .get("tag_name")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "检查更新失败（响应缺少版本号）".to_string())?;
    let version = tag.trim().trim_start_matches(['v', 'V']).to_string();
    if !is_newer_version(&version, &current) {
        return Ok(None);
    }

    // 更新内容：优先 Release 正文，退回 Release 标题；超长截断防御。
    let raw_notes = body
        .get("body")
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .or_else(|| body.get("name").and_then(|v| v.as_str()))
        .unwrap_or("");
    let mut notes = raw_notes.trim().to_string();
    const MAX_NOTES: usize = 8000;
    if notes.len() > MAX_NOTES {
        notes.truncate(MAX_NOTES);
        notes.push_str("\n…");
    }
    let url = body
        .get("html_url")
        .and_then(|v| v.as_str())
        .filter(|s| s.starts_with("https://"))
        .unwrap_or("https://github.com/KRPCT/Pillowtome/releases")
        .to_string();
    let published_at = body
        .get("published_at")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    Ok(Some(UpdateInfo {
        version,
        notes,
        url,
        published_at,
        current,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_version_handles_tags_and_suffixes() {
        assert_eq!(parse_version("1.2.3"), Some((1, 2, 3)));
        assert_eq!(parse_version("v1.2.3"), Some((1, 2, 3)));
        assert_eq!(parse_version("V2.0"), Some((2, 0, 0)));
        assert_eq!(parse_version("1.10.0-beta.1"), Some((1, 10, 0)));
        assert_eq!(parse_version("  1.0.0+build5 "), Some((1, 0, 0)));
        assert_eq!(parse_version("abc"), None);
        assert_eq!(parse_version(""), None);
    }

    #[test]
    fn is_newer_version_compares_numerically() {
        assert!(is_newer_version("1.0.1", "1.0.0"));
        assert!(is_newer_version("1.1.0", "1.0.9"));
        assert!(is_newer_version("2.0.0", "1.9.9"));
        assert!(is_newer_version("v1.0.1", "1.0.0"));
        assert!(!is_newer_version("1.0.0", "1.0.0"));
        assert!(!is_newer_version("1.0.0", "1.0.1"));
        assert!(!is_newer_version("0.9.9", "1.0.0"));
        assert!(!is_newer_version("garbage", "1.0.0"));
    }
}
