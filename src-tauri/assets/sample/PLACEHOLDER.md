# Bundled sample slot

Plan 04 drops the DRM-free sample EPUB here as `sample.epub`.

`tauri.conf.json` bundles `assets/sample/*` as a resource, and the app registers
`assets/sample/sample.epub` (resolved via `BaseDirectory::Resource`) in the
`SourceRegistry` under id `"sample"` at Builder `.setup()` — so
`pillow://.../sample` resolves the moment `sample.epub` exists.

This placeholder keeps the resource glob non-empty until then.
