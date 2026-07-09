/**
 * Ambient declaration for the vendored, pinned foliate-js engine (MIT).
 *
 * foliate-js is plain JavaScript with no bundled type declarations and is
 * vendored as a submodule at `src/vendor/foliate-js` (do NOT add a .d.ts inside
 * the submodule — it would dirty it). We import `view.js` only for its side
 * effect: it calls `customElements.define('foliate-view', …)`. The typed
 * surface we actually use is declared locally in `reader/FoliateView.tsx`.
 */
declare module "*/vendor/foliate-js/view.js";
