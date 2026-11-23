$ErrorActionPreference = 'Stop'
$name = $env:ASKILL_NAME
if (!$env:ASKILL_TIME) {
    if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $name -Confirm:$false
    }
    return
}
$arguments = '"{0}" scheduled "{1}" "{2}"' -f $env:ASKILL_WORKER, $env:ASKILL_DATA, $env:ASKILL_REPO
$action = New-ScheduledTaskAction -Execute $env:ASKILL_NODE -Argument $arguments -WorkingDirectory $env:ASKILL_REPO
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At $env:ASKILL_TIME
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
