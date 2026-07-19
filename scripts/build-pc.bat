@echo off
call "C:\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul
set RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-msvc
set PATH=C:\Users\Administrator\.cargo\bin;C:\Users\Administrator\AppData\Local\pnpm;C:\Users\Administrator\AppData\Local\Programs\kimi-desktop\resources\resources\runtime\node;C:\Users\Administrator\AppData\Roaming\npm;%PATH%
cd /d D:\Github\Pillowtome
echo === cargo version === > build-pc.log 2>&1
cargo --version >> build-pc.log 2>&1
echo === pnpm tauri build === >> build-pc.log 2>&1
pnpm tauri build >> build-pc.log 2>&1
echo EXITCODE=%ERRORLEVEL% >> build-pc.log
