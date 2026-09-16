<#
.SYNOPSIS
    Edits a pull request: title, body, base, state, labels, assignees, reviewers (comma separated lists).
.EXAMPLE
    ./scripts/Update-PullRequest.ps1 -Repo "MyRepo" -Number 42 -Reviewers "alice,bob" -Labels "bug"
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Repo,
    [Parameter(Mandatory)][int]$Number,
    [string]$Title,
    [string]$Body,
    [ValidateSet('','open','closed')][string]$State = '',
    [string]$Base,
    [string]$Labels,
    [string]$Assignees,
    [string]$Reviewers
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
if ($PSBoundParameters.ContainsKey('Title')) { $payload.title = $Title }
if ($PSBoundParameters.ContainsKey('Body')) { $payload.body = $Body }
if ($State) { $payload.state = $State }
if ($Base) { $payload.base = $Base }
if ($PSBoundParameters.ContainsKey('Labels')) { $payload.labels = @($Labels -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ }) }
if ($PSBoundParameters.ContainsKey('Assignees')) { $payload.assignees = @($Assignees -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ }) }
if ($PSBoundParameters.ContainsKey('Reviewers')) { $payload.reviewers = @($Reviewers -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ }) }
Post-Api '/api/github/pulls/update' $payload | ConvertTo-Json
