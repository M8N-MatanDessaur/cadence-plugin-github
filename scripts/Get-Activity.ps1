<#
.SYNOPSIS
    What moved on a repository lately: commits and events over the last N days.
.EXAMPLE
    ./scripts/Get-Activity.ps1 -Repo "MyRepo" -Days 7
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Repo,
    [int]$Days = 14
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
Get-Api "/api/github/activity?repo=$(Esc $Repo)&days=$Days" | ConvertTo-Json -Depth 6
