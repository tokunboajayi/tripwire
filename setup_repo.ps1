<#  Tripwire - one-time GitHub repo setup (run on AJ's computer)
    Double-click SETUP_REPO.bat, or:  powershell -ExecutionPolicy Bypass -File setup_repo.ps1
    Edit the $Collaborators line first (GitHub usernames of teammates).  #>
param(
  [string]$RepoName   = "tripwire",
  [string]$Visibility = "public",           # public = free GitHub Pages + branch protection
  [string[]]$Collaborators = @()             # e.g. @("datadude","mcpguy","designgirl")
)
$ErrorActionPreference = "Stop"
function Need($cmd,$wingetId){ if(-not (Get-Command $cmd -ErrorAction SilentlyContinue)){
  Write-Host "Installing $cmd..." -f Yellow; winget install --id $wingetId -e --accept-source-agreements --accept-package-agreements
  $env:Path = [Environment]::GetEnvironmentVariable("Path","Machine")+";"+[Environment]::GetEnvironmentVariable("Path","User") } }
Need git "Git.Git"; Need gh "GitHub.cli"
gh auth status 2>$null; if($LASTEXITCODE -ne 0){ gh auth login --web -h github.com -p https }

# Git inside OneDrive can corrupt .git, so the working repo lives in %USERPROFILE%\dev\tripwire
$src = $PSScriptRoot
$dst = Join-Path $env:USERPROFILE "dev\$RepoName"
if(Test-Path (Join-Path $dst ".git")){ Write-Host "Repo already exists at $dst" -f Red; exit 1 }
New-Item -ItemType Directory -Force -Path $dst | Out-Null
robocopy $src $dst /E /XF setup_repo.ps1 SETUP_REPO.bat *.zip /NFL /NDL /NJH /NJS | Out-Null
Set-Location $dst

$me = gh api user --jq .login
(Get-Content .github\CODEOWNERS) -replace '@AJ_GITHUB',"@$me" | Set-Content .github\CODEOWNERS
(Get-Content README.md) -replace 'Owner · Engine \| @TODO',"Owner · Engine | @$me" | Set-Content README.md

git init -b main | Out-Null
git add -A
git commit -m "chore: initial Tripwire scaffold, docs, and backtest" | Out-Null
gh repo create $RepoName --$Visibility --source . --remote origin --push --description "AI investor that switches trading brains by market regime, with a Rust risk layer it can't override. Hacklanta '26."

foreach($u in $Collaborators){
  gh api -X PUT "repos/$me/$RepoName/collaborators/$u" -f permission=push | Out-Null
  Write-Host "Invited $u (they must accept the email/GitHub invite)" -f Green }

# Protect main: PR required, 1 approval; admins (AJ) can still merge
$rule = @'
{"required_status_checks":null,"enforce_admins":false,
 "required_pull_request_reviews":{"required_approving_review_count":1},
 "restrictions":null}
'@
$rule | gh api -X PUT "repos/$me/$RepoName/branches/main/protection" --input - | Out-Null
gh api -X POST "repos/$me/$RepoName/pages" -f build_type=workflow 2>$null | Out-Null

Write-Host "`nDONE  https://github.com/$me/$RepoName" -f Green
Write-Host "Local repo: $dst   (work here, not in OneDrive)"
Write-Host "Next: fill teammate handles in .github/CODEOWNERS + README Team table, commit on a branch, PR."
