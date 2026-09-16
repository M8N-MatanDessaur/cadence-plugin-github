<#
.SYNOPSIS
    Opens an issue with a title, a body and optional labels and assignees (comma separated).
.EXAMPLE
    ./scripts/New-Issue.ps1 -Repo "MyRepo" -Title "Login times out" -Body "Steps..." -Labels "bug,auth"
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Repo,
    [Parameter(Mandatory)][string]$Title,
    [string]$Body = '',
    [string]$Labels = '',
    [string]$Assignees = ''
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
$payload = @{ repo = $Repo; title = $Title; body = $Body }
$payload.labels = @($Labels -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$payload.assignees = @($Assignees -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
Post-Api '/api/github/issues/create' $payload | ConvertTo-Json
