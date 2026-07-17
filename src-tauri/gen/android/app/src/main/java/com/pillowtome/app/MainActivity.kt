package com.pillowtome.app

import android.os.Bundle
import android.util.Log
import android.view.ViewGroup
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
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
