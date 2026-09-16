<#
.SYNOPSIS
    Lists the pull requests of a repository (open by default), as JSON.
.EXAMPLE
    ./scripts/Get-PullRequests.ps1 -Repo "MyRepo" -State all
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Repo,
    [ValidateSet('open','closed','all')][string]$State = 'open'
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
Out-Json @((Get-Api "/api/github/pulls?repo=$(Esc $Repo)&state=$State").pulls) 6
