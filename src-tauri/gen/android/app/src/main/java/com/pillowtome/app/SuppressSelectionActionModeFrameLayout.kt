package com.pillowtome.app

import android.content.Context
import android.graphics.Rect
import android.util.AttributeSet
import android.util.Log
import android.view.ActionMode
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.widget.FrameLayout

/**
 * FrameLayout that hides the WebView's floating text-selection toolbar (复制/全选/
 * 分享) so the DOM-layer SelectionBubble (05-04) is the only selection UI.
 *
 * It must KEEP the selection alive. Returning null from startActionModeForChild
 * makes Chromium's SelectionPopupController treat the action mode as failed and
 * call showActionModeOrClearOnFailure() → it CLEARS the selection ("长按只会闪一下",
 * and the DOM bubble never anchors). So instead we let a real ActionMode be created
 * (selection persists) but wrap the callback to strip every menu item — no toolbar
 * renders. TYPE_FLOATING requires an ActionMode.Callback2 (for onGetContentRect), so
 * the wrapper extends Callback2 and delegates the content rect.
 *
 * Only TYPE_FLOATING (text selection) is touched; the app's primary ActionMode and
 * everything else routes through super untouched.
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
    if (type == ActionMode.TYPE_FLOATING && callback != null) {
      Log.i("Pillowtome", "startActionModeForChild: emptying TYPE_FLOATING toolbar (keeping selection)")
      return super.startActionModeForChild(originalView, EmptyMenuCallback(callback), type)
    }
    return super.startActionModeForChild(originalView, callback, type)
  }

  /**
   * Delegates to the real WebView callback but clears the menu so no toolbar items
   * render. The ActionMode is still created (non-null) → Chromium keeps the text
   * selection, leaving the DOM SelectionBubble as the only selection UI.
   */
  private class EmptyMenuCallback(
    private val delegate: ActionMode.Callback
  ) : ActionMode.Callback2() {
    override fun onCreateActionMode(mode: ActionMode?, menu: Menu?): Boolean {
      delegate.onCreateActionMode(mode, menu)
      menu?.clear()
      return true
    }

    override fun onPrepareActionMode(mode: ActionMode?, menu: Menu?): Boolean {
      delegate.onPrepareActionMode(mode, menu)
      menu?.clear()
      return true
    }

    override fun onActionItemClicked(mode: ActionMode?, item: MenuItem?): Boolean {
      return false
    }

    override fun onDestroyActionMode(mode: ActionMode?) {
      delegate.onDestroyActionMode(mode)
    }

    override fun onGetContentRect(mode: ActionMode?, view: View?, outRect: Rect?) {
      val d = delegate
      if (d is ActionMode.Callback2) {
        d.onGetContentRect(mode, view, outRect)
      } else {
        super.onGetContentRect(mode, view, outRect)
      }
    }
  }
}
