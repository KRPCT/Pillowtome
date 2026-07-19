Get-Process | Where-Object { $_.ProcessName -match 'cargo|rustc|rustup|java|node' } | Select-Object Id, ProcessName, CPU | Format-Table -AutoSize
