$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
# Python 子进程统一使用 UTF-8，避免中文 Windows 默认 GBK 解码失败。
$env:PYTHONUTF8 = "1"
# Node 运行时预检:版本不够或构建未启用 TypeScript 支持时给出指引,而不是 ERR_UNKNOWN_FILE_EXTENSION(#38)
& node (Join-Path $root "scripts\check-node.mjs")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& node (Join-Path $root "orchestrator\src\doctor.ts") @args
exit $LASTEXITCODE
