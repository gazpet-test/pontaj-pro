# dialog_tgz.ps1 - sarcina Windows "Gazpet Dialog TGZ", varianta B (decizia Razvan 06.11.2026).
# Ruleaza DOAR cu tokenul de un an din `claude setup-token` (fara conectori claude.ai). Toata partea de BD o face
# acest script, prin psql, cu interogari FIXE din sql\*.sql. Claude primeste doar fisiere locale si unelte
# Read/Glob/Grep + Edit in folderul de dialog. Fisa de securitate: README.md.
# Iesire: 0 = GATA / NIMIC NOU / OPRIT / rulare deja in curs; 1 = EROARE.
# Fisier ASCII (PowerShell 5.1).

[CmdletBinding()]
param(
  [string]$DialogDir = 'C:\Users\Public\paw-data\dialog',
  [string]$OutDir = 'C:\Users\Public\paw-data\out',
  [string]$TokenFile = 'C:\Users\Gazpet-Ai\.secrete\claude_oauth_token.txt',
  [string]$PsqlExe = 'C:\Users\Public\pgsql\bin\psql.exe',
  [string]$PgHost = 'aws-1-eu-central-1.pooler.supabase.com',
  [int]$PgPort = 5432,
  [string]$PgUser = 'postgres.dxczwkbciseqniprspcu',
  [string]$PgDb = 'postgres',
  [string]$ClaudeExe = '',
  [string]$Model = 'claude-sonnet-5-5',
  [ValidateSet('low', 'medium', 'high')][string]$Effort = 'medium',
  [ValidateRange(1, 80)][int]$MaxTurns = 40,
  [ValidateRange(5, 55)][int]$TimeoutMin = 50,
  [string[]]$RadaciniAtasamente = @('\\gazpet-tnas\Licitatii_Executate'),
  [string]$WorkDir = (Join-Path $env:TEMP 'dialog_tgz')
)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'DialogTgz.psm1') -Force

$acum = Get-Date
if (-not (Test-Path -LiteralPath $OutDir)) { [void](New-Item -ItemType Directory -Path $OutDir) }
$caleLog = Join-Path $OutDir ('dialog_tgz_{0}.log' -f $acum.ToString('yyyy-MM-dd'))
$caleStare = Join-Path $OutDir 'dialog_tgz_ultima.txt'
$idRulare = '{0}-{1}' -f $acum.ToString('HHmmss'), $PID

$log = {
  param([string]$Mesaj)
  $linie = '{0} [{1}] {2}' -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $idRulare, (ConvertTo-TextSigur $Mesaj 25000 -PastreazaLiniiNoi)
  Write-TextUtf8 -Cale $caleLog -Text ($linie + "`r`n") -Adauga
}.GetNewClosure()

# (g) lock global: fisier deschis exclusiv (merge intre sesiuni Windows; se elibereaza si la moartea procesului)
$caleLock = Join-Path $OutDir 'dialog_tgz.lock'
try {
  $lock = [System.IO.File]::Open($caleLock, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
} catch {
  & $log 'alta rulare Dialog TGZ este in curs (lock ocupat); ies fara sa ating starea'
  exit 0
}

$rez = $null
try {
  & $log ('start; dialog {0}; model {1}' -f $DialogDir, $Model)
  if (-not $ClaudeExe) {
    $cmd = Get-Command claude -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cmd) { $ClaudeExe = $cmd.Source }
  }
  $config = @{
    DialogDir = $DialogDir; TokenFile = $TokenFile; PsqlExe = $PsqlExe; PgHost = $PgHost; PgPort = $PgPort; PgUser = $PgUser; PgDb = $PgDb
    ClaudeExe = $ClaudeExe; Model = $Model; Effort = $Effort; MaxTurns = $MaxTurns; TimeoutMin = $TimeoutMin
    RadaciniAtasamente = $RadaciniAtasamente; WorkDir = $WorkDir
    SqlDir = (Join-Path $PSScriptRoot 'sql'); PromptFile = (Join-Path $PSScriptRoot 'dialog_tgz_prompt.md')
  }
  if (-not (Test-Path -LiteralPath $PsqlExe -PathType Leaf)) {
    $rez = @{ Stare = 'EROARE'; Linie = 'EROARE psql lipseste: ' + $PsqlExe; Cod = 1 }
  } elseif (-not $ClaudeExe -or -not (Test-Path -LiteralPath $ClaudeExe -PathType Leaf)) {
    $rez = @{ Stare = 'EROARE'; Linie = 'EROARE executabilul claude nu a fost gasit'; Cod = 1 }
  } else {
    $psql = { param($FisierSql, $Variabile, $Tuple) Invoke-PsqlFisier -Config $config -FisierSql $FisierSql -Variabile $Variabile -Tuple:$Tuple }.GetNewClosure()
    $claude = { param($Prompt, $Token, $Radacini) Invoke-ClaudeReal -Config $config -Prompt $Prompt -Token $Token -Radacini $Radacini }.GetNewClosure()
    $rez = Invoke-DialogTgz -Config $config -Psql $psql -Claude $claude -Log $log -Acum $acum
  }
} catch {
  $rez = @{ Stare = 'EROARE'; Linie = 'EROARE ' + (ConvertTo-TextSigur $_.Exception.Message 300); Cod = 1 }
} finally {
  try {
    if ($null -eq $rez) { $rez = @{ Stare = 'EROARE'; Linie = 'EROARE rulare intrerupta'; Cod = 1 } }
    # (f) starea: data + ultima linie
    Write-TextUtf8 -Cale $caleStare -Text (('{0} {1}' -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $rez.Linie) + "`r`n")
    & $log ('final: ' + $rez.Linie + ' (cod iesire ' + $rez.Cod + ')')
  } finally {
    $lock.Dispose()
  }
}
exit $rez.Cod
