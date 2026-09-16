<#
.SYNOPSIS
    One pull request: detail, files, commits, checks, timeline, and its unified diff.
.EXAMPLE
    ./scripts/Get-PullRequest.ps1 -Repo "MyRepo" -Number 42 -NoDiff
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Repo,
    [Parameter(Mandatory)][int]$Number,
    [switch]$NoDiff
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
$q = "repo=$(Esc $Repo)&number=$Number"
$out = [ordered]@{
  detail   = Get-Api "/api/github/pulls/detail?$q"
  files    = (Get-Api "/api/github/pulls/files?$q").files
  commits  = (Get-Api "/api/github/pulls/commits?$q").commits
  checks   = Get-Api "/api/github/pulls/checks?$q"
  timeline = (Get-Api "/api/github/pulls/timeline?$q").timeline
}
if (-not $NoDiff) { $d = Get-Api "/api/github/pulls/diff?$q"; $out.diff = $d.diff; $out.truncated = $d.truncated }
[pscustomobject]$out | ConvertTo-Json -Depth 8
