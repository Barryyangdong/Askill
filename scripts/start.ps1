# -Prebuilt:用已经打包好的页面(desktop\dist,由 vite preview 提供),不起开发服务器。免安装包用它
# -NoOpen:启动后不自动打开浏览器
# -Port / -ApiPort:页面 / 本机 API 端口。默认 5940 / 8770(orchestrator/src/brand.ts 的 UI_PORT / API_PORT,和 Vibe Research 的 5930 / 8765 错开)，被占用或被系统保留时自动换一个空闲的；指定了就只用它
param([switch]$Prebuilt, [switch]$NoOpen, [int]$Port = 0, [int]$ApiPort = 0)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$env:PYTHONUTF8 = "1"
# Node 运行时预检:版本不够或构建未启用 TypeScript 支持时给出指引,而不是 ERR_UNKNOWN_FILE_EXTENSION(#38)
function Test-NodeRuntime($candidate) {
  if (-not $candidate -or -not (Test-Path -LiteralPath $candidate -PathType Leaf)) { return $false }
  try {
    # Windows PowerShell 5 turns native stderr into error records under Stop.
    $ErrorActionPreference = "Continue"
    & $candidate (Join-Path $root "scripts\check-node.mjs") *> $null
    return ($? -and $LASTEXITCODE -eq 0)
  } catch { return $false }
}
$nodeExe = (Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source
if (-not (Test-NodeRuntime $nodeExe)) {
  $nodeExe = $null
  $versionsDir = Join-Path $env:USERPROFILE ".workbuddy\binaries\node\versions"
  foreach ($dir in (Get-ChildItem -LiteralPath $versionsDir -Directory -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)) {
    $candidate = Join-Path $dir.FullName "node.exe"
    if (Test-NodeRuntime $candidate) { $nodeExe = $candidate; break }
  }
  if (-not $nodeExe) { throw "未找到可运行 TypeScript 的 Node.js。请安装 Node 22.18+ 或 24 LTS，然后重新启动短线王。" }
  Write-Host "[start] 使用 WorkBuddy 的 Node.js：$nodeExe"
}
if ($Prebuilt -and -not (Test-Path (Join-Path $root "desktop\dist\index.html"))) {
  throw "缺少打包好的页面(desktop\dist)。先在 desktop 目录运行 npm run build,或去掉 -Prebuilt。"
}
# 选端口(规则见 orchestrator\src\startup_ports.ts):全部写在 stdout,说明是 [start] 开头的行,成功时最后一行是 {"ui":..,"api":..}
$portArgs = @()
if ($Port) { $portArgs += @("--port", "$Port") }
if ($ApiPort) { $portArgs += @("--api-port", "$ApiPort") }
$chosen = @(& $nodeExe (Join-Path $root "orchestrator\src\startup_ports.ts") @portArgs)
$portCode = $LASTEXITCODE
$chosen | Where-Object { "$_".StartsWith("[start]") } | ForEach-Object { Write-Host $_ }
if ($portCode -ne 0) { exit $portCode }
$last = if ($chosen.Count) { "$($chosen[-1])" } else { "" }
if (-not $last.StartsWith("{")) { throw "没拿到端口选择结果(orchestrator\src\startup_ports.ts 没有输出)。" }
$ports = $last | ConvertFrom-Json
$uiPortChosen = [int]$ports.ui
$apiPortChosen = [int]$ports.api
# 页面服务器(Vite)按这两个变量监听和转发 /api;就绪检查和 API 拼推送链接也用它们。
# 退出时还原:在自己的 PowerShell 窗口里直接运行本脚本时,不能把这次选的端口留给下一次(下一次会被当成「指定了端口」)
$prevUiPort = $env:VRA_UI_PORT
$prevApiPort = $env:VRA_API_PORT
$env:VRA_UI_PORT = "$uiPortChosen"
$env:VRA_API_PORT = "$apiPortChosen"
$uiUrl = "http://127.0.0.1:$uiPortChosen"
$api = $null
$ui = $null
# Each entry records an identity observed while its parent identity was still present.
$apiTree = @{}
$uiTree = @{}
$nextTreeSnapshot = [datetime]::MinValue
function Update-ProcessTree($Process, $Tree, $rows) {
  if (-not $Process) { return }
  try {
    $rootId = [int]$Process.Id
    foreach ($id in @($Tree.Keys | Where-Object { $_ -ne $rootId })) {
      if ($Tree[$id].process.HasExited) { $Tree[$id].process.Dispose(); $Tree.Remove($id) }
    }
    if (-not $Tree.ContainsKey($rootId)) {
      $Process.Refresh()
      if ($Process.HasExited) { return }
      $rootRow = @($rows | Where-Object { [int]$_.ProcessId -eq $rootId })
      if ($rootRow.Count -ne 1 -or $null -eq $rootRow[0].CreationDate) { return }
      $cimTicks = ([datetime]$rootRow[0].CreationDate).ToUniversalTime().Ticks
      $null = $Process.Handle
      $ticks = $Process.StartTime.ToUniversalTime().Ticks
      if (($ticks - ($ticks % 10)) -ne ($cimTicks - ($cimTicks % 10))) { return }
      $Tree[$rootId] = @{ cim = $cimTicks; ticks = $ticks; process = $Process }
    }
    do {
      $added = $false
      foreach ($row in $rows) {
        $id = [int]$row.ProcessId; $parent = [int]$row.ParentProcessId
        if ($Tree.ContainsKey($id) -or -not $Tree.ContainsKey($parent) -or $null -eq $row.CreationDate) { continue }
        $parentRow = @($rows | Where-Object { [int]$_.ProcessId -eq $parent })
        if ($parentRow.Count -ne 1 -or $null -eq $parentRow[0].CreationDate -or ([datetime]$parentRow[0].CreationDate).ToUniversalTime().Ticks -ne $Tree[$parent].cim -or $Tree[$parent].process.HasExited) { continue }
        $cimTicks = ([datetime]$row.CreationDate).ToUniversalTime().Ticks
        if ($cimTicks -lt $Tree[$parent].cim) { continue }
        $owned = $null
        try {
          $owned = Get-Process -Id $id -ErrorAction Stop
          $null = $owned.Handle # acquire and retain the OS handle, not merely a PID wrapper
          $ticks = $owned.StartTime.ToUniversalTime().Ticks
          if (($ticks - ($ticks % 10)) -ne ($cimTicks - ($cimTicks % 10)) -or $owned.HasExited) { $owned.Dispose(); continue }
          $Tree[$id] = @{ cim = $cimTicks; ticks = $ticks; process = $owned }
          $added = $true
        } catch { if ($owned) { $owned.Dispose() } }
      }
    } while ($added)
  } catch { }
}
function Update-OwnedTrees {
  if ([datetime]::UtcNow -lt $script:nextTreeSnapshot) { return }
  try {
    $rows = @(Get-CimInstance Win32_Process -ErrorAction Stop)
    $script:nextTreeSnapshot = [datetime]::UtcNow.AddSeconds(2)
    Update-ProcessTree $api $apiTree $rows
    Update-ProcessTree $ui $uiTree $rows
  } catch { $script:nextTreeSnapshot = [datetime]::UtcNow.AddSeconds(10) }
}

function Stop-ProcessTree($Process, $Tree) {
  if (-not $Process) { return }
  $rootId = [int]$Process.Id
  $rootExited = $true
  $rootHandle = $null
  $uncertain = $false
  try {
    $Process.Refresh()
    $rootExited = $Process.HasExited
    if (-not $rootExited) {
      # Pin the original process object before any PID-based tree operation.
      $rootHandle = $Process.Handle
      if ($null -eq $rootHandle -or $rootHandle -eq [IntPtr]::Zero) { throw 'Root handle unavailable' }
      $Process.Refresh()
      $rootExited = $Process.HasExited
    }
  } catch { $rootHandle = $null; $uncertain = $true }
  $rows = $null
  try { $rows = @(Get-CimInstance Win32_Process -ErrorAction Stop) }
  catch { Write-Host "[start] 警告：无法查询进程树，子孙清理无法确认。" }
  if ($null -eq $rows) { $uncertain = $true }
  # Stop the intact tree first. Killing an observed intermediate process first
  # can detach an unobserved leaf from the root taskkill is about to traverse.
  if (-not $rootExited -and $null -ne $rootHandle) {
    try {
      $Process.Refresh()
      if ($Process.HasExited) { $uncertain = $true }
      else {
        & taskkill.exe /PID $rootId /T /F *> $null
        $code = $LASTEXITCODE
        $Process.Refresh()
        if ($code -ne 0 -or -not $Process.HasExited) { $uncertain = $true }
      }
    } catch { $uncertain = $true }
  } else { $uncertain = $true } # No blind PID fallback when the handle cannot be acquired.
  if ($null -ne $rows) {
    foreach ($id in @($Tree.Keys | Where-Object { $_ -ne $rootId })) {
      $match = @($rows | Where-Object { [int]$_.ProcessId -eq $id })
      if ($match.Count -eq 0) { continue }
      if ($match.Count -ne 1 -or $null -eq $match[0].CreationDate -or ([datetime]$match[0].CreationDate).ToUniversalTime().Ticks -ne $Tree[$id].cim) { $uncertain = $true; continue }
      try {
        # Hold a process handle while checking identity and stopping this observed process.
        $owned = $Tree[$id].process
        if ($owned.HasExited) { continue }
        if ($owned.StartTime.ToUniversalTime().Ticks -ne $Tree[$id].ticks) { $uncertain = $true; continue }
        $owned.Kill()
        if (-not $owned.WaitForExit(5000)) { $uncertain = $true }
      } catch { $uncertain = $true }
    }
  }
  if ($null -ne $rows) {
    try {
      $after = @(Get-CimInstance Win32_Process -ErrorAction Stop)
      foreach ($id in @($Tree.Keys | Where-Object { $_ -ne $rootId })) {
        if (@($after | Where-Object { [int]$_.ProcessId -eq $id -and $null -ne $_.CreationDate -and ([datetime]$_.CreationDate).ToUniversalTime().Ticks -eq $Tree[$id].cim }).Count) { $uncertain = $true }
      }
    } catch { $uncertain = $true }
  }
  if ($uncertain) { Write-Host "[start] 警告：进程树 $rootId 清理未完全确认，请检查本次启动的残留进程。" }
}

$previousPath = $env:Path
try {
  $env:Path = (Split-Path -Parent $nodeExe) + [IO.Path]::PathSeparator + $previousPath
  $api = Start-Process -FilePath $nodeExe -ArgumentList @("orchestrator\src\api.ts", "--port", "$apiPortChosen", "--host", "127.0.0.1") -WorkingDirectory $root -PassThru -NoNewWindow
  # UI 由 Vite 按 VRA_LAN 决定绑定；默认回环，API 的回环绑定不变。打包好的页面由 vite preview 提供，同样只听回环。
  $viteArgs = @("node_modules\vite\bin\vite.js")
  if ($Prebuilt) { $viteArgs += "preview" }
  $ui = Start-Process -FilePath $nodeExe -ArgumentList $viteArgs -WorkingDirectory (Join-Path $root "desktop") -PassThru -NoNewWindow
  Update-OwnedTrees
  $ready = $false
  $readyDeadline = [DateTime]::UtcNow.AddSeconds(60)
  while ([DateTime]::UtcNow -lt $readyDeadline) {
    Update-OwnedTrees
    $api.Refresh()
    $ui.Refresh()
    if ($api.HasExited) { throw "API 启动失败（退出码 $($api.ExitCode)），请检查 $apiPortChosen 端口和产品配置。" }
    if ($ui.HasExited) { throw "界面启动失败（退出码 $($ui.ExitCode)）。" }
    # 经界面代理验证后端鉴权；令牌仍只留在本地服务，不传到浏览器或命令参数。
    & $nodeExe (Join-Path $root "orchestrator\src\startup_health.ts")
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Milliseconds 250
  }
  if (-not $ready) { throw "启动等待超过 60 秒。请检查上方日志、$apiPortChosen/$uiPortChosen 端口以及产品配置；浏览器尚未打开。" }
  $api.Refresh()
  $ui.Refresh()
  if ($api.HasExited) { throw "API 启动失败（退出码 $($api.ExitCode)），请检查 $apiPortChosen 端口和产品配置。" }
  if ($ui.HasExited) { throw "界面启动失败（退出码 $($ui.ExitCode)）。" }
  Write-Host "`n工作台已启动:$uiUrl`n按 Ctrl+C 或关掉这个窗口即退出。"
  if (-not $NoOpen) { Start-Process $uiUrl }
  while (-not $api.HasExited -and -not $ui.HasExited) {
    Start-Sleep -Milliseconds 250
    Update-OwnedTrees
    $api.Refresh()
    $ui.Refresh()
  }
  if ($api.HasExited) { throw "API 已停止（退出码 $($api.ExitCode)），界面同步关闭。" }
  if ($ui.HasExited) { throw "界面已提前停止（退出码 $($ui.ExitCode)）。" }
} finally {
  $env:Path = $previousPath
  try { Stop-ProcessTree $ui $uiTree } catch { Write-Host "[start] 警告：界面进程清理失败：$_" }
  try { Stop-ProcessTree $api $apiTree } catch { Write-Host "[start] 警告：API 进程清理失败：$_" }
  foreach ($tree in @($uiTree, $apiTree)) { foreach ($item in $tree.Values) { try { $item.process.Dispose() } catch { } } }
  if ($null -eq $prevUiPort) { Remove-Item Env:VRA_UI_PORT -ErrorAction SilentlyContinue } else { $env:VRA_UI_PORT = $prevUiPort }
  if ($null -eq $prevApiPort) { Remove-Item Env:VRA_API_PORT -ErrorAction SilentlyContinue } else { $env:VRA_API_PORT = $prevApiPort }
}
