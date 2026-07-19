@echo off
set ProgramData=C:\ProgramData
set RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-msvc
set JAVA_HOME=D:\JDK\JDK21
set ANDROID_HOME=C:\Users\Administrator\AppData\Local\Android\Sdk
set NDK_HOME=C:\Users\Administrator\AppData\Local\Android\Sdk\ndk\27.2.12479018
set PATH=C:\Users\Administrator\.cargo\bin;C:\Users\Administrator\AppData\Local\pnpm;C:\Users\Administrator\AppData\Local\Programs\kimi-desktop\resources\resources\runtime\node;C:\Users\Administrator\AppData\Roaming\npm;%JAVA_HOME%\bin;%ANDROID_HOME%\platform-tools;%PATH%
cd /d D:\Github\Pillowtome
echo === pnpm tauri android build --debug --target x86_64 --apk === > build-android.log 2>&1
pnpm tauri android build --debug --target x86_64 --apk >> build-android.log 2>&1
echo EXITCODE=%ERRORLEVEL% >> build-android.log
