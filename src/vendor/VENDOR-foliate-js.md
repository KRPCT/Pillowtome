# Vendored: foliate-js

> Kept adjacent to the submodule (not inside `src/vendor/foliate-js/`) so it is
> tracked by this repo rather than dirtying the submodule working tree.

- **Upstream:** https://github.com/johnfactotum/foliate-js
- **License:** MIT (see `foliate-js/LICENSE`, Copyright (c) 2022 John Factotum) — retained unmodified.
- **Pinned commit:** `78914aef4466eb960965702401634c2cb348e9b1`
- **Pinned on:** 2026-07-09
- **Integration:** git submodule at `src/vendor/foliate-js` (see `.gitmodules`).

## Why vendored at a pinned commit (not an npm range)

Per D-02 and the supply-chain zero-trust baseline, foliate-js is vendored at an
explicit commit SHA rather than tracked through an npm version range. The author
explicitly warns that the API is unstable, so a floating range would risk silent
breaking changes and violates the "no floating ranges" rule. The submodule is
pinned; updates are a deliberate, reviewed commit-SHA bump.

## Clean-room note (D-11)

foliate-js (MIT) is the only vendored render engine. **No AGPL Readest source is
copied into this repository.** Readest is an architectural reference only.

## Updating the pin

```sh
git -C src/vendor/foliate-js fetch origin
git -C src/vendor/foliate-js checkout <new-sha>
git add src/vendor/foliate-js
# update the "Pinned commit" + "Pinned on" fields above in the same commit
```
