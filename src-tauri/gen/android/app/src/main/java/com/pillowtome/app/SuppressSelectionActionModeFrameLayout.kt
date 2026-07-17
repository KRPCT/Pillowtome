package com.pillowtome.app

import android.content.Context
import android.util.AttributeSet
import android.view.ActionMode
import android.view.View
import android.widget.FrameLayout

/**
 * FrameLayout that swallows the WebView's floating text-selection ActionMode
 * (复制/全选/分享) so the DOM-layer SelectionBubble (05-04) is not covered by the
 * native toolbar. Only TYPE_FLOATING is suppressed — the app's primary ActionMode
 * and anything else still routes through super, so nothing unrelated is broken.
 *
 * Persistence note: this file lives outside gen/android/.../generated/ (which
 * `tauri android build` regenerates) and is force-tracked via `git add -f`. See
 * docs/ANDROID-BUILD.md for the re-apply steps after `tauri android init`.
 */
class SuppressSelectionActionModeFrameLayout @JvmOverloads constructor(
  context: Context,
  attrs: AttributeSet? = null,
  defStyleAttr: Int = 0
) : FrameLayout(context, attrs, defStyleAttr) {

  override fun startActionModeForChild(
    originalView: View?,
    callback: ActionMode.Callback?
  ): ActionMode? {
    return super.startActionModeForChild(originalView, callback)
  }

  override fun startActionModeForChild(
    originalView: View?,
    callback: ActionMode.Callback?,
    type: Int
  ): ActionMode? {
    if (type == ActionMode.TYPE_FLOATING) {
      return null
    }
    return super.startActionModeForChild(originalView, callback, type)
  }
}
