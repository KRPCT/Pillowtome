/**
 * 翻页动画开关（UX-01）：foliate paginator 的 `animated` 属性让点按翻页
 * 走 300ms easeOutQuad 滑动（paginator.js `#scrollTo` 仅在 reason==='snap'
 * 或显式 smooth 时动画，因此 TOC/进度条/恢复进度等程序化跳转保持瞬移）。
 *
 * 尊重系统「减弱动态效果」（prefers-reduced-motion）：开启时不装 animated。
 */

/** 是否允许翻页滑动动画（纯判定，可单测）。 */
export function paginateAnimationAllowed(reduceMotion: boolean): boolean {
  return !reduceMotion;
}

/** 当前系统是否请求减弱动态效果（无 window 环境按 false）。 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** 在 paginate renderer 上按系统偏好装/卸 `animated`。 */
export function applyPaginatorMotion(
  renderer:
    | {
        setAttribute?: (name: string, value: string) => void;
        removeAttribute?: (name: string) => void;
      }
    | null
    | undefined,
  reduceMotion: boolean,
): void {
  if (!renderer) return;
  if (paginateAnimationAllowed(reduceMotion)) {
    renderer.setAttribute?.("animated", "");
  } else {
    renderer.removeAttribute?.("animated");
  }
}
