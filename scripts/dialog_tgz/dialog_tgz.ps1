# dialog_tgz.ps1 - sarcina Windows "Gazpet Dialog TGZ", varianta B (decizia Razvan 06.11.2026).
# Ruleaza DOAR cu tokenul de un an din `claude setup-token` (fara conectori claude.ai). BD: doar citire, prin psql,
# cu interogarea FIXA din sql\context_agregat.sql si un rol care nu poate scrie (verificat chiar in SQL).
# Agentul primeste doar fisiere locale, unelte Read/Glob/Grep si scriere DOAR in folderul privat al rularii, unde
# lasa raspuns.json (contract fix: raspuns_schema.json, fara text liber). claude#NNN.md il compune si il publica
# acest orchestrator (creare exclusiva + re-verificarea numarului). psql si claude ruleaza in Job Object.
# r5: jurnalul si starea se scriu DOAR prin Write-JurnalSigur / Write-StareSigura (texte din Format-Mesaj); scriptul nu
# scrie nimic pe stdout / stderr (o eroare la incarcarea modulului = iesire 1, fara text).
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
  [string]$Effort = 'medium',
  [ValidateRange(1, 80)][int]$MaxTurns = 40,
  [ValidateRange(5, 55)][int]$TimeoutMin = 50,
  [ValidateRange(0, 300)][int]$AsteptareColiziuneSec = 90,
  [string[]]$RadaciniAtasamente = @('\\gazpet-tnas\Licitatii_Executate'),
  [string]$WorkDir = (Join-Path $env:TEMP 'dialog_tgz')
)

$ErrorActionPreference = 'Stop'
$codIesire = 1
try {
  Import-Module (Join-Path $PSScriptRoot 'DialogTgz.psm1') -Force
  if (-not (Test-Path -LiteralPath $OutDir)) { [void](New-Item -ItemType Directory -Path $OutDir) }
} catch { exit 1 }

$acum = Get-Date
$caleLog = Join-Path $OutDir ('dialog_tgz_{0}.log' -f $acum.ToString('yyyy-MM-dd'))
$caleStare = Join-Path $OutDir 'dialog_tgz_ultima.txt'
$idRulare = '{0}-{1}' -f $acum.ToString('yyyyMMdd_HHmmss'), $PID

# Orice linie de jurnal = text sigur (Format-Mesaj); Write-JurnalSigur refuza orice altceva.
$log = {
  param($Text)
  Write-JurnalSigur -Cale $caleLog -IdRulare $idRulare -Text $Text
}.GetNewClosure()

# lock global: fisier deschis exclusiv (merge intre sesiuni Windows; se elibereaza si la moartea procesului)
$caleLock = Join-Path $OutDir 'dialog_tgz.lock'
try {
  $lock = [System.IO.File]::Open($caleLock, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
} catch {
  try { & $log (Format-Mesaj 'j.lock_ocupat') } catch { }
  exit 0
}

$rez = $null
try {
  & $log (Format-Mesaj 'j.start')
  if (-not $ClaudeExe) {
    $cmd = Get-Command claude -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cmd) { $ClaudeExe = $cmd.Source }
  }
  $config = @{
    DialogDir = $DialogDir; TokenFile = $TokenFile; PsqlExe = $PsqlExe; PgHost = $PgHost; PgPort = $PgPort; PgUser = $PgUser; PgDb = $PgDb
    ClaudeExe = $ClaudeExe; Model = $Model; Effort = $Effort; MaxTurns = $MaxTurns; TimeoutMin = $TimeoutMin
    RadaciniAtasamente = $RadaciniAtasamente; WorkDir = $WorkDir; IdRulare = $idRulare
    CaleCursor = (Join-Path $OutDir 'dialog_tgz_cursor.txt'); CaleMarcaj = (Join-Path $OutDir 'dialog_tgz_procese_ramase.txt')
    SqlDir = (Join-Path $PSScriptRoot 'sql'); PromptFile = (Join-Path $PSScriptRoot 'dialog_tgz_prompt.md')
    SchemaFile = (Join-Path $PSScriptRoot 'raspuns_schema.json')
    AsteptareColiziuneSec = $AsteptareColiziuneSec
  }
  # valorile din configurare nu se scriu niciodata: doar codul erorii
  if (-not (Test-Path -LiteralPath $PsqlExe -PathType Leaf)) { $rez = Get-RezultatEroare 'psql_lipsa' }
  elseif (-not (Test-PgUserPermis $PgUser)) { $rez = Get-RezultatEroare 'pguser' }
  elseif (-not $ClaudeExe -or -not (Test-Path -LiteralPath $ClaudeExe -PathType Leaf)) { $rez = Get-RezultatEroare 'claude_lipsa' }
  else {
    if (-not (Test-Path -LiteralPath $WorkDir)) { [void](New-Item -ItemType Directory -Path $WorkDir) }
    $psql = { param($FisierSql) Invoke-PsqlFisier -Config $config -FisierSql $FisierSql }.GetNewClosure()
    $claude = { param($Prompt, $Token, $Radacini, $DirIntrare, $DirIesire)
      Invoke-ClaudeReal -Config $config -Prompt $Prompt -Token $Token -Radacini $Radacini -DirIntrare $DirIntrare -DirIesire $DirIesire }.GetNewClosure()
    $rez = Invoke-DialogTgz -Config $config -Psql $psql -Claude $claude -Log $log -Acum $acum
  }
} catch {
  $rez = $null
  try { $rez = Get-RezultatExceptie $_ } catch { $rez = $null }
} finally {
  try {
    if ($null -eq $rez -or -not ($rez -is [hashtable]) -or -not (Test-TextSigur $rez.Text)) { $rez = Get-RezultatEroare 'intrerupta' }
    $codIesire = $rez.Cod
    Write-StareSigura -Cale $caleStare -Text $rez.Text
    & $log (Format-Mesaj 'j.final' @($rez.Text, $rez.Cod))
  } catch {
    $codIesire = 1
  } finally {
    $lock.Dispose()
  }
}
exit $codIesire
