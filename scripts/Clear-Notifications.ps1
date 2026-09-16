<#
.SYNOPSIS
    Marks one notification thread (or all with -All) as read.
.EXAMPLE
    ./scripts/Clear-Notifications.ps1 -All
#>
[CmdletBinding()]
param(
    [string]$Id = '',
    [switch]$All
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
if (-not $Id -and -not $All) { throw 'Give -Id or -All.' }
Post-Api '/api/github/notifications/read' @{ id = $Id; all = [bool]$All } | ConvertTo-Json
