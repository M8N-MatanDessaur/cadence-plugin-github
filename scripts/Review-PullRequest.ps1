<#
.SYNOPSIS
    Submits a review: APPROVE, REQUEST_CHANGES or COMMENT, with a body and optional inline comments (JSON array of {path,line,body}).
.EXAMPLE
    ./scripts/Review-PullRequest.ps1 -Repo "MyRepo" -Number 42 -Event REQUEST_CHANGES -Body "See inline." -Comments '[{"path":"src/a.js","line":12,"body":"null check"}]'
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Repo,
    [Parameter(Mandatory)][int]$Number,
    [ValidateSet('APPROVE','REQUEST_CHANGES','COMMENT')][string]$Event = 'COMMENT',
    [string]$Body = '',
    [string]$Comments = ''
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
$payload = @{ repo = $Repo; number = $Number; event = $Event }
if ($Body) { $payload.body = $Body }
# -InputObject, not the pipeline: Windows PowerShell 5.1 wraps a piped JSON array in a {value, Count} object.
if ($Comments) { $payload.comments = @(foreach ($c in (ConvertFrom-Json -InputObject $Comments)) { $one = @{ path = [string]$c.path; line = [int]$c.line; body = [string]$c.body }; if ($c.side) { $one.side = [string]$c.side }; $one }) }
Post-Api '/api/github/pulls/review' $payload | ConvertTo-Json
