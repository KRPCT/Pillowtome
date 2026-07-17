package com.pillowtome.app

import android.os.Bundle
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
  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    val parent = webView.parent as? ViewGroup ?: return
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
  }
}
