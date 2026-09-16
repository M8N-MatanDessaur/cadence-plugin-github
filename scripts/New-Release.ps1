<#
.SYNOPSIS
    Creates a release on a tag (created on the target if it does not exist yet).
.EXAMPLE
    ./scripts/New-Release.ps1 -Repo "MyRepo" -Tag v1.3.0 -Name "1.3.0" -Body "..." -Draft
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Repo,
    [Parameter(Mandatory)][string]$Tag,
    [string]$Name,
    [string]$Body = '',
    [string]$Target,
    [switch]$Draft,
    [switch]$Prerelease
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
$payload = @{ repo = $Repo; tag = $Tag; body = $Body; draft = [bool]$Draft; prerelease = [bool]$Prerelease }
if ($Name) { $payload.name = $Name }
if ($Target) { $payload.target = $Target }
Post-Api '/api/github/releases/create' $payload | ConvertTo-Json
