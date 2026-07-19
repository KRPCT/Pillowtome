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

        // Load-bearing shape: NO @JvmStatic. The crate exports
        // Java_io_crates_keyring_Keyring_00024Companion_initializeNdkContext —
        // the JNI mangled name of a native method declared ON the Companion.
        // Declaring this as @JvmStatic makes Kotlin emit an outer-class static
        // native forwarder, so the JVM looks up
        // Java_io_crates_keyring_Keyring_initializeNdkContext (without
        // 00024Companion), which does not exist in libpillowtome_lib.so →
        // UnsatisfiedLinkError at launch (07-01 AVD spike). Kotlin callers can
        // still write Keyring.initializeNdkContext(...) — the call resolves
        // through the Companion instance.
        external fun initializeNdkContext(context: Context)
    }
}
