<#
.SYNOPSIS
    Edits an issue: state (open/closed, with a reason), title, body, labels, assignees.
.EXAMPLE
    ./scripts/Update-Issue.ps1 -Repo "MyRepo" -Number 17 -State closed -Reason completed
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Repo,
    [Parameter(Mandatory)][int]$Number,
    [ValidateSet('','open','closed')][string]$State = '',
    [ValidateSet('','completed','not_planned')][string]$Reason = '',
    [string]$Title,
    [string]$Body,
    [string]$Labels,
    [string]$Assignees
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
$payload = @{ repo = $Repo; number = $Number }
if ($State) { $payload.state = $State }
if ($Reason) { $payload.stateReason = $Reason }
if ($PSBoundParameters.ContainsKey('Title')) { $payload.title = $Title }
if ($PSBoundParameters.ContainsKey('Body')) { $payload.body = $Body }
if ($PSBoundParameters.ContainsKey('Labels')) { $payload.labels = @($Labels -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ }) }
if ($PSBoundParameters.ContainsKey('Assignees')) { $payload.assignees = @($Assignees -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ }) }
Post-Api '/api/github/issues/update' $payload | ConvertTo-Json
