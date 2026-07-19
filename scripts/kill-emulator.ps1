$ErrorActionPreference = 'Continue'
Get-Process | Where-Object { $_.Name -like '*qemu*' -or $_.Name -like '*emulator*' } | ForEach-Object {
  Write-Output ("killing " + $_.Id + " " + $_.Name)
  Stop-Process -Id $_.Id -Force -ErrorAction Continue
}
Start-Sleep 2
$left = Get-Process | Where-Object { $_.Name -like '*qemu*' -or $_.Name -like '*emulator*' }
if ($left) { $left | ForEach-Object { Write-Output ("STILL RUNNING: " + $_.Id + " " + $_.Name) } } else { Write-Output "ALL_EMU_KILLED" }
