//! IPC command surface (stub).
//!
//! Only small structured data (metadata, locators, settings) is allowed to
//! cross Tauri IPC here. **Book bytes never cross IPC (D-06)** — they stream to
//! the WebView exclusively via the `pillow://` custom protocol (see
//! [`crate::protocol`]). Plans 01-03+ fill real commands into this module.
