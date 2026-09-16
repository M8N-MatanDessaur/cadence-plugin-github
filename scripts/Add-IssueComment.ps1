<#
.SYNOPSIS
    Posts a comment on an issue (Markdown; @mentions work).
.EXAMPLE
    ./scripts/Add-IssueComment.ps1 -Repo "MyRepo" -Number 17 -Body "Reproduced on main."
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Repo,
    [Parameter(Mandatory)][int]$Number,
    [Parameter(Mandatory)][string]$Body
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
Post-Api '/api/github/issues/comment' @{ repo = $Repo; number = $Number; body = $Body } | ConvertTo-Json
