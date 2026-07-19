package com.pillowtome.app

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import android.util.Log
import android.view.ViewGroup
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import java.io.File
import kotlin.concurrent.thread

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // Initialize ndk-context for android-native-keyring-store (SYNC-01): tao
    // 0.35.x no longer does this (tauri-apps/tao#1220), and the keychain is
    // only ever used later via IPC, so post-super placement is safe.
    Log.i("Pillowtome", "keyring ndk-context init: invoking native initializeNdkContext")
    io.crates.keyring.Keyring.initializeNdkContext(applicationContext)
    Log.i("Pillowtome", "keyring ndk-context init: native init OK")
    handleOpenIntent(intent)
  }

  // launchMode=singleTask：已在前台时「打开方式」走这里。
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    handleOpenIntent(intent)
  }

  // 「打开方式」导入：把 VIEW 来的 content/file URI 立即复制进应用私有目录
  // （pending_open.epub + pending_open.name），前端轮询 take_pending_open 入库。
  // 复制走 .tmp 原子改名，避免前端读到写了一半的文件；临时 URI 授权只在本
  // Activity 存活期有效，所以必须趁热复制，不能存 URI 以后读。
  private fun handleOpenIntent(intent: Intent?) {
    if (intent?.action != Intent.ACTION_VIEW) return
    val uri = intent.data ?: return
    val displayName = queryDisplayName(uri) ?: "book.epub"
    thread {
      try {
        // Rust 端 take_pending_open 用 tauri app_data_dir()（Android 上是包根
        // /data/data/<pkg>，不是 files/ 子目录），两边必须指向同一处。
        val dir = applicationContext.dataDir
        val tmp = File(dir, "pending_open.tmp")
        contentResolver.openInputStream(uri)?.use { input ->
          tmp.outputStream().use { output -> input.copyTo(output) }
        } ?: run {
          Log.e("Pillowtome", "open-with: cannot open stream for $uri")
          return@thread
        }
        File(dir, "pending_open.name").writeText(displayName)
        File(dir, "pending_open.epub").delete()
        if (!tmp.renameTo(File(dir, "pending_open.epub"))) {
          tmp.copyTo(File(dir, "pending_open.epub"), overwrite = true)
          tmp.delete()
        }
        Log.i("Pillowtome", "open-with: staged $displayName for import")
      } catch (e: Exception) {
        Log.e("Pillowtome", "open-with: failed to stage $uri", e)
      }
    }
  }

  private fun queryDisplayName(uri: Uri): String? {
    if (uri.scheme == "file") return uri.lastPathSegment
    return try {
      contentResolver.query(uri, null, null, null, null)?.use { cursor ->
        val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        if (index >= 0 && cursor.moveToFirst()) cursor.getString(index) else null
      }
    } catch (e: Exception) {
      null
    }
  }

  // Reparent the RustWebView into a FrameLayout that suppresses the floating
  // text-selection ActionMode, so the DOM SelectionBubble (05-04) is reachable.
  // The wrapper does NOT consume window insets — they keep passing through to the
  // WebView, preserving enableEdgeToEdge() semantics.
  //
  // Timing: onWebViewCreate fires from WryActivity.setWebView BEFORE wry attaches
  // the WebView to the content view, so webView.parent is null here. Defer via
  // View.post{} — it runs once the view is attached (parent non-null).
  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webView.post { wrapInActionModeSuppressor(webView) }
  }

  private fun wrapInActionModeSuppressor(webView: WebView) {
    val parent = webView.parent as? ViewGroup
    if (parent == null) {
      Log.w("Pillowtome", "onWebViewCreate: webView still has no parent — cannot suppress ActionMode")
      return
    }
    if (parent is SuppressSelectionActionModeFrameLayout) {
      return // already wrapped
    }
    val index = parent.indexOfChild(webView)
    val params = webView.layoutParams
    parent.removeView(webView)
    val wrapper = SuppressSelectionActionModeFrameLayout(webView.context)
    wrapper.addView(
      webView,
      ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT
      )
    )
    parent.addView(wrapper, index, params)
    Log.i("Pillowtome", "onWebViewCreate: WebView reparented into ActionMode suppressor")
  }
}
