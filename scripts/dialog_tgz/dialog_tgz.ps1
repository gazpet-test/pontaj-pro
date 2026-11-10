# dialog_tgz.ps1 - sarcina Windows "Gazpet Dialog TGZ", varianta B (decizia Razvan 06.11.2026).
# Ruleaza DOAR cu tokenul de un an din `claude setup-token` (fara conectori claude.ai). BD: doar citire, prin psql,
# cu interogarea FIXA din sql\context_agregat.sql si un rol care nu poate scrie (verificat chiar in SQL).
# Agentul primeste doar fisiere locale, unelte Read/Glob/Grep si scriere DOAR in folderul privat al rularii, unde
# lasa raspuns.json (contract fix: raspuns_schema.json + vocabular_nota.txt). claude#NNN.md il compune si il publica
# acest orchestrator (creare exclusiva + re-verificarea numarului). psql si claude ruleaza in Job Object.
# Fisa de securitate: README.md.
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
  [string]$PgUser = 'dialog_tgz_ro.dxczwkbciseqniprspcu',
  [string]$PgDb = 'postgres',
  [string]$ClaudeExe = '',
  [string]$Model = 'claude-sonnet-5-5',
  [ValidateSet('low', 'medium', 'high')][string]$Effort = 'medium',
  [ValidateRange(1, 80)][int]$MaxTurns = 40,
  [ValidateRange(5, 55)][int]$TimeoutMin = 50,
  [ValidateRange(0, 300)][int]$AsteptareColiziuneSec = 90,
  [string[]]$RadaciniAtasamente = @('\\gazpet-tnas\Licitatii_Executate'),
  [string]$WorkDir = (Join-Path $env:TEMP 'dialog_tgz')
)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'DialogTgz.psm1') -Force

$acum = Get-Date
if (-not (Test-Path -LiteralPath $OutDir)) { [void](New-Item -ItemType Directory -Path $OutDir) }
$caleLog = Join-Path $OutDir ('dialog_tgz_{0}.log' -f $acum.ToString('yyyy-MM-dd'))
$caleStare = Join-Path $OutDir 'dialog_tgz_ultima.txt'
$idRulare = '{0}-{1}' -f $acum.ToString('yyyyMMdd_HHmmss'), $PID

# Orice linie de log trece prin ConvertTo-TextSigur: token mascat, iar textul cu date personale e inlocuit cu codurile.
$log = {
  param([string]$Mesaj)
  $linie = '{0} [{1}] {2}' -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $idRulare, (ConvertTo-TextSigur $Mesaj 25000 -PastreazaLiniiNoi)
  Write-TextUtf8 -Cale $caleLog -Text ($linie + "`r`n") -Adauga
}.GetNewClosure()

# lock global: fisier deschis exclusiv (merge intre sesiuni Windows; se elibereaza si la moartea procesului)
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
    RadaciniAtasamente = $RadaciniAtasamente; WorkDir = $WorkDir; IdRulare = ($idRulare -replace '[^A-Za-z0-9_\-]', '_')
    CaleCursor = (Join-Path $OutDir 'dialog_tgz_cursor.txt'); CaleMarcaj = (Join-Path $OutDir 'dialog_tgz_procese_ramase.txt')
    SqlDir = (Join-Path $PSScriptRoot 'sql'); PromptFile = (Join-Path $PSScriptRoot 'dialog_tgz_prompt.md')
    SchemaFile = (Join-Path $PSScriptRoot 'raspuns_schema.json'); VocabularFile = (Join-Path $PSScriptRoot 'vocabular_nota.txt')
    AsteptareColiziuneSec = $AsteptareColiziuneSec
  }
  if (-not (Test-Path -LiteralPath $PsqlExe -PathType Leaf)) {
    $rez = @{ Stare = 'EROARE'; Linie = 'EROARE psql lipseste: ' + $PsqlExe; Cod = 1 }
  } elseif (-not (Test-PgUserPermis $PgUser)) {
    $rez = @{ Stare = 'EROARE'; Linie = 'EROARE utilizatorul Postgres ' + $PgUser + ' poate scrie; sarcina cere rolul doar-citire'; Cod = 1 }
  } elseif (-not $ClaudeExe -or -not (Test-Path -LiteralPath $ClaudeExe -PathType Leaf)) {
    $rez = @{ Stare = 'EROARE'; Linie = 'EROARE executabilul claude nu a fost gasit'; Cod = 1 }
  } else {
    if (-not (Test-Path -LiteralPath $WorkDir)) { [void](New-Item -ItemType Directory -Path $WorkDir) }
    $psql = { param($FisierSql) Invoke-PsqlFisier -Config $config -FisierSql $FisierSql }.GetNewClosure()
    $claude = { param($Prompt, $Token, $Radacini, $DirIntrare, $DirIesire)
      Invoke-ClaudeReal -Config $config -Prompt $Prompt -Token $Token -Radacini $Radacini -DirIntrare $DirIntrare -DirIesire $DirIesire }.GetNewClosure()
    $rez = Invoke-DialogTgz -Config $config -Psql $psql -Claude $claude -Log $log -Acum $acum
  }
} catch {
  $rez = @{ Stare = 'EROARE'; Linie = 'EROARE ' + $_.Exception.Message; Cod = 1 }
} finally {
  try {
    if ($null -eq $rez) { $rez = @{ Stare = 'EROARE'; Linie = 'EROARE rulare intrerupta'; Cod = 1 } }
    # starea: data + ultima linie (tot prin filtrul de token / date personale)
    $linieStare = ConvertTo-TextSigur ([string]$rez.Linie) 400
    Write-TextUtf8 -Cale $caleStare -Text (('{0} {1}' -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $linieStare) + "`r`n")
    & $log ('final: ' + $linieStare + ' (cod iesire ' + $rez.Cod + ')')
  } finally {
    $lock.Dispose()
  }
}
exit $rez.Cod
