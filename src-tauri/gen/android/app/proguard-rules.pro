# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# SYNC-01 (07-01): R8 must not rename/obfuscate the keyring shim — the Rust
# crate resolves it by the exact JNI-mangled name
# Java_io_crates_keyring_Keyring_00024Companion_initializeNdkContext on
# release builds (isMinifyEnabled = true).
-keep class io.crates.keyring.** { *; }

# Tauri mobile plugins are invoked from Rust via JNI/reflection — R8 must not
# strip or rename them on release builds. Without these keeps the android-fs
# plugin (SAF picker/read) dies at runtime in the signed release APK while
# debug builds keep working.
-keep class com.plugin.** { *; }
-keep class app.tauri.** { *; }
-keep class io.crates.** { *; }

# UPD-01: rustls-platform-verifier 的 JVM 组件（CertificateVerifier）只经
# Rust JNI 按类名反射加载，R8 会误判为死代码剥离/改名 —— 整包保留。
# 见 docs/ANDROID-BUILD.md § 固化的原生改动。
-keep class org.rustls.platformverifier.** { *; }
