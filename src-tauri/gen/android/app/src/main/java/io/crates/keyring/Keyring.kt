package io.crates.keyring

import android.content.Context

class Keyring {
    companion object {
        init {
            // NOTE (adaptation of the crate README's Note 1): there is no
            // standalone libandroid_native_keyring_store.so in this app — the
            // crate's JNI symbols are linked into the Tauri app library,
            // which generated/Rust.kt already loads. Loading it again here
            // is a harmless no-op and keeps this shim order-independent.
            System.loadLibrary("pillowtome_lib")
        }

        @JvmStatic
        external fun initializeNdkContext(context: Context)
    }
}
