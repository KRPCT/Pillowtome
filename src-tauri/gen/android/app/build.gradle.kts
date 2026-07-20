import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

val keystoreProperties = Properties().apply {
    val propFile = rootProject.file("keystore.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

// rustls-platform-verifier（reqwest/rustls 在 Android 的证书验证）需要随伴随
// crate `rustls-platform-verifier-android` 分发的 JVM 组件（CertificateVerifier
// AAR），否则任何 HTTPS（更新检查 / https WebDAV 同步）在首次连接时 panic。
// crate 把 maven 仓库打在本地 cargo registry 里，这里动态定位，避免硬编码
// 用户目录。AAR 版本必须与 Cargo.lock 中该 crate 版本一致（当前 0.1.1）。
// 注意：本文件在 gitignored 的 gen/android 内，但经 `git add -f` force-track —
// `tauri android init` 重刷后按 docs/ANDROID-BUILD.md § 固化的原生改动 还原。
val rustlsPlatformVerifierMaven: File = run {
    val cargoHome = System.getenv("CARGO_HOME")
        ?: File(System.getProperty("user.home"), ".cargo").absolutePath
    val registrySrc = File(cargoHome, "registry/src")
    val crate = registrySrc.listFiles()
        ?.flatMap { index -> index.listFiles()?.toList() ?: emptyList() }
        ?.filter { it.isDirectory && it.name.startsWith("rustls-platform-verifier-android-") }
        ?.maxByOrNull { it.name }
        ?: throw GradleException(
            "rustls-platform-verifier-android crate 未在 $registrySrc 找到；" +
                "请先跑一次 cargo 构建（tauri android build 会自动拉取依赖）"
        )
    File(crate, "maven")
}

repositories {
    maven { url = uri(rustlsPlatformVerifierMaven) }
}

android {
    compileSdk = 36
    namespace = "com.pillowtome.app"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "com.pillowtome.app"
        minSdk = 26
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    signingConfigs {
        create("release") {
            storeFile = rootProject.file(keystoreProperties.getProperty("storeFile", "pillowtome-release.keystore"))
            storePassword = keystoreProperties.getProperty("storePassword")
            keyAlias = keystoreProperties.getProperty("keyAlias")
            keyPassword = keystoreProperties.getProperty("keyPassword")
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            isMinifyEnabled = true
            signingConfig = signingConfigs.getByName("release")
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    // rustls TLS 验证的 JVM 组件（见上方 rustlsPlatformVerifierMaven；版本锁
    // 与 Cargo.lock 的 rustls-platform-verifier-android crate 一致）。
    implementation("rustls:rustls-platform-verifier:0.1.1@aar")
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")