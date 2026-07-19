@echo off
rem Signed release APK build. Requires src-tauri/gen/android/keystore.properties
rem (gitignored) pointing at a valid release keystore.
set ProgramData=C:\ProgramData
set RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-msvc
set JAVA_HOME=D:\JDK\JDK21
set ANDROID_HOME=C:\Users\Administrator\AppData\Local\Android\Sdk
set NDK_HOME=C:\Users\Administrator\AppData\Local\Android\Sdk\ndk\27.2.12479018
set CARGO_BUILD_JOBS=6
set PATH=C:\Users\Administrator\.cargo\bin;C:\Users\Administrator\AppData\Local\pnpm;C:\Users\Administrator\AppData\Local\Programs\kimi-desktop\resources\resources\runtime\node;C:\Users\Administrator\AppData\Roaming\npm;%JAVA_HOME%\bin;%ANDROID_HOME%\platform-tools;%PATH%
cd /d D:\Github\Pillowtome
echo === pnpm tauri android build --apk ^(release by default^) === > build-android-release.log 2>&1
pnpm tauri android build --apk >> build-android-release.log 2>&1
echo EXITCODE=%ERRORLEVEL% >> build-android-release.log
