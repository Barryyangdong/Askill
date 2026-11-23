$ErrorActionPreference = 'Stop'
$WarningPreference = 'Stop'
$tokens=$null; $errors=$null
$source=Join-Path $PSScriptRoot '..\..\scripts\start.ps1'
$ast=[System.Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw 'parse failed' }
foreach ($name in @('Update-ProcessTree','Update-OwnedTrees','Stop-ProcessTree')) {
  $f=$ast.Find({param($a) $a -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $a.Name -eq $name},$true)
  Invoke-Expression $f.Extent.Text
}
function Get-CimInstance { $script:queries++; if ($script:denied) { throw 'denied' }; return $script:rows }
function Get-Process {
  param($Id)
  $row=@($script:rows | Where-Object { $_.ProcessId -eq $Id })[0]
  $p=[pscustomobject]@{Id=$Id; StartTime=$row.CreationDate.AddTicks(7); Handle=1; HasExited=$false}
  $p | Add-Member ScriptMethod Kill { $script:killed += $this.Id; $script:rows=@($script:rows | Where-Object { $_.ProcessId -ne $this.Id }) }
  $p | Add-Member ScriptMethod WaitForExit { param($ms) return $true }
  $p | Add-Member ScriptMethod Dispose {}
  return $p
}
function taskkill.exe { $id=[int]$args[1]; $script:killed += $id; $script:rows=@($script:rows | Where-Object { $_.ProcessId -ne $id }); $global:LASTEXITCODE=0; if ($id -eq 100) { $script:proc.HasExited=$true } }
$time=[datetime]'2026-01-01T00:00:00Z'
$script:proc=[pscustomobject]@{Id=100;HasExited=$false;StartTime=$time.AddTicks(7);Handle=1}; $script:proc | Add-Member ScriptMethod Refresh {}
$script:rows=@([pscustomobject]@{ProcessId=100;ParentProcessId=1;CreationDate=$time},[pscustomobject]@{ProcessId=101;ParentProcessId=100;CreationDate=$time.AddSeconds(1)})
$tree=@{}; $script:killed=@(); $script:denied=$false
Update-ProcessTree $script:proc $tree $script:rows
if ($tree.Count -ne 2) { throw 'observation failed' }
$script:proc.HasExited=$true; $script:rows=@($script:rows | Where-Object ProcessId -ne 100)
Stop-ProcessTree $script:proc $tree
if (101 -notin $script:killed) { throw 'observed descendant not stopped' }
$script:killed=@(); $script:rows=@([pscustomobject]@{ProcessId=101;ParentProcessId=100;CreationDate=$time.AddSeconds(9)})
Stop-ProcessTree $script:proc $tree
if ($script:killed.Count) { throw 'reused PID was targeted' }
$script:proc.HasExited=$false; $script:denied=$true; $script:killed=@()
Stop-ProcessTree $script:proc $tree
if (100 -notin $script:killed) { throw 'live root not attempted after CIM failure' }
$script:denied=$false; $script:proc.HasExited=$false; $script:killed=@(); $script:rows=@([pscustomobject]@{ProcessId=100;ParentProcessId=1;CreationDate=$time})
Stop-ProcessTree $script:proc @{}
if (100 -notin $script:killed -or -not $script:proc.HasExited) { throw 'normal cleanup failed' }
# Shared snapshot is throttled; failures back off longer.
$api=$script:proc; $ui=$null; $apiTree=@{}; $uiTree=@{}; $script:queries=0
$script:nextTreeSnapshot=[datetime]::MinValue; $script:denied=$false
1..8 | ForEach-Object { Update-OwnedTrees }
if ($script:queries -ne 1) { throw "snapshot not shared or throttled" }
$script:nextTreeSnapshot=[datetime]::MinValue; $script:denied=$true
Update-OwnedTrees; 1..8 | ForEach-Object { Update-OwnedTrees }
if ($script:queries -ne 2 -or ($script:nextTreeSnapshot - [datetime]::UtcNow).TotalSeconds -lt 8) { throw "snapshot failure did not back off" }
# Exercise the real handler with a reachable but unobserved leaf. No real PID,
# CIM query or executable is used: taskkill traverses the synthetic live graph.
& {
  function Write-Host { param($Object) $script:diagnostics += [string]$Object }
  function Get-CimInstance { return @($script:liveRows | Where-Object { $_.ProcessId -ne 3333 }) }
  function Get-Process { param($Id) return $script:handles[[int]$Id] }
  function taskkill.exe {
    $target=[int]$args[1]
    $script:order += "tree:$target"
    if ($script:mode -eq 'tree-denied') { $global:LASTEXITCODE=5; return }
    $ids=@($target)
    do {
      $before=$ids.Count
      foreach ($row in $script:liveRows) {
        if ($row.ParentProcessId -in $ids -and $row.ProcessId -notin $ids) { $ids += [int]$row.ProcessId }
      }
    } while ($ids.Count -gt $before)
    foreach ($id in $ids) { $script:handles[$id].HasExited=$true }
    $script:liveRows=@($script:liveRows | Where-Object { $_.ProcessId -notin $ids })
    $global:LASTEXITCODE=0
  }
  foreach ($case in @('intact','handle-denied','handle-zero','root-exited','exit-on-handle','reused-child','tree-denied')) {
    $script:mode='setup'; $script:handles=@{}; $script:order=@(); $script:diagnostics=@()
    $script:liveRows=@()
    foreach ($id in @(1111,2222,3333)) {
      $parent=if ($id -eq 1111) { 1 } elseif ($id -eq 2222) { 1111 } else { 2222 }
      $created=$time.AddSeconds($id)
      $script:liveRows += [pscustomobject]@{ProcessId=$id;ParentProcessId=$parent;CreationDate=$created}
      $p=[pscustomobject]@{Id=$id;StartTime=$created.AddTicks(7);HasExited=$false}
      $p | Add-Member ScriptMethod Refresh {}
      $p | Add-Member ScriptMethod Dispose {}
      $p | Add-Member ScriptMethod WaitForExit { param($ms) return $this.HasExited }
      $p | Add-Member ScriptMethod Kill {
        $script:order += "handle-kill:$($this.Id)"
        $this.HasExited=$true
        $script:liveRows=@($script:liveRows | Where-Object { $_.ProcessId -ne $this.Id })
      }
      $p | Add-Member ScriptProperty Handle {
        $script:order += "handle:$($this.Id)"
        if ($this.Id -eq 1111 -and $script:mode -eq 'handle-denied') { throw 'handle access denied' }
        if ($this.Id -eq 1111 -and $script:mode -eq 'handle-zero') { return [IntPtr]::Zero }
        if ($this.Id -eq 1111 -and $script:mode -eq 'exit-on-handle') { $this.HasExited=$true }
        return [IntPtr]1
      }
      $script:handles[$id]=$p
    }
    $rootHandle=$script:handles[1111]; $observed=@{}
    Update-ProcessTree $rootHandle $observed (Get-CimInstance)
    if ($observed.Count -ne 2 -or $observed.ContainsKey(3333)) { throw 'leaf fixture must be unobserved' }
    $script:order=@(); $script:mode=$case
    if ($case -in @('root-exited','reused-child')) {
      $rootHandle.HasExited=$true
      $script:liveRows=@($script:liveRows | Where-Object { $_.ProcessId -ne 1111 })
    }
    if ($case -eq 'reused-child') {
      $script:handles[2222].HasExited=$true
      ($script:liveRows | Where-Object ProcessId -eq 2222).CreationDate=$time.AddDays(2)
    }
    Stop-ProcessTree $rootHandle $observed
    if ($case -eq 'intact') {
      if (-not $script:handles[3333].HasExited) { throw 'intact-root cleanup stranded the unobserved leaf' }
      if (($script:order -join ',') -ne 'handle:1111,tree:1111') { throw "root tree must be stopped first with a retained handle: $script:order" }
      if ($script:diagnostics.Count) { throw 'confirmed intact cleanup must not warn' }
    } else {
      if (-not $script:diagnostics.Count) { throw "uncertain cleanup must warn: $case" }
      if ($case -ne 'tree-denied' -and 'tree:1111' -in $script:order) { throw "unsafe PID operation: $case" }
      if ($case -eq 'reused-child') {
        if (@($script:order | Where-Object { $_ -like 'handle-kill:*' }).Count) { throw 'reused descendant was targeted' }
      } elseif ('handle-kill:2222' -notin $script:order) { throw "observed survivor was not reclaimed: $case" }
      if ($case -eq 'tree-denied' -and [array]::IndexOf($script:order,'tree:1111') -gt [array]::IndexOf($script:order,'handle-kill:2222')) { throw 'fallback ran before root tree attempt' }
    }
  }
}
$cleanup=$ast.Find({param($a) $a -is [System.Management.Automation.Language.TryStatementAst] -and $null -ne $a.Finally},$true).Finally
function Stop-ProcessTree { $script:attempts++; throw 'cleanup failure' }
foreach ($preference in @('Continue','Stop','SilentlyContinue')) {
$WarningPreference=$preference
$script:attempts=0; $ui=$script:proc; $api=$script:proc; $uiTree=@{}; $apiTree=@{}
$prevUiPort='before-ui'; $prevApiPort=$null; $env:VRA_UI_PORT='chosen'; $env:VRA_API_PORT='chosen'
$caught=''; try { try { throw 'original' } finally { & ([scriptblock]::Create($cleanup.Extent.Text.Trim().Substring(1,$cleanup.Extent.Text.Trim().Length-2))) } } catch { $caught=$_.Exception.Message }
if ($caught -ne 'original' -or $script:attempts -ne 2 -or $env:VRA_UI_PORT -ne 'before-ui' -or $null -ne $env:VRA_API_PORT) { throw 'cleanup masked error or failed to restore environment' }
}
Write-Output 'cleanup injection passed'
