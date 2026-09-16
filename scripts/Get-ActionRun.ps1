<#
.SYNOPSIS
    One Actions run with its jobs, steps, and the log tail of every failed job.
.EXAMPLE
    ./scripts/Get-ActionRun.ps1 -Repo "MyRepo" -Id 123456789
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Repo,
    [Parameter(Mandatory)][long]$Id
)
$ErrorActionPreference = 'Stop'
$CadenceApi = if ($env:CADENCE_API) { $env:CADENCE_API } else { 'http://127.0.0.1:3800' }
$headers = @{}
if ($env:CADENCE_TOKEN) { $headers['x-cadence-token'] = $env:CADENCE_TOKEN }
function Get-Api($path) { Invoke-RestMethod -Uri "$CadenceApi$path" -Headers $headers }
function Post-Api($path, $payload) { Invoke-RestMethod -Uri "$CadenceApi$path" -Method Post -Headers $headers -ContentType 'application/json' -Body ($payload | ConvertTo-Json -Depth 8) }
function Esc($s) { [uri]::EscapeDataString([string]$s) }
# Arrays always print as JSON arrays, an empty one included, so a caller can parse the output blindly.
function Out-Json($o, $d = 6) { ConvertTo-Json -InputObject $o -Depth $d }
Get-Api "/api/github/actions/run?repo=$(Esc $Repo)&id=$Id" | ConvertTo-Json -Depth 8
