@echo off
call "C:\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >/dev/null 2>&1
set RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-msvc
set PATH=%USERPROFILE%\.cargo\bin;%PATH%
cd /d %~dp0..\src-tauri
cargo check -p pillowtome 2>&1
