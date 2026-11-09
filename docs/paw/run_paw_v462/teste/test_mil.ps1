# Teste fara Pester pentru canalul mil (v4.6.2). Ruleaza: powershell -NoProfile -ExecutionPolicy Bypass -File teste\test_mil.ps1
# Nu porneste agy, nu scrie in paw-data, nu ia lock-uri: mil.ps1 se incarca cu Ruleaza inlocuit; citarea liniei de comanda se
# verifica cu parserul real Windows (CommandLineToArgvW, aceleasi reguli ca runtime-ul Go al agy).
# ASCII only. Compatibil Windows PowerShell 5.1.
$ErrorActionPreference = 'Stop'
$pachet = Split-Path $PSScriptRoot -Parent
$script:ok = 0; $script:rau = 0
function Caz([string]$nume, [scriptblock]$cod) {
  try { & $cod; $script:ok++; Write-Host ('PASS ' + $nume) }
  catch { $script:rau++; Write-Host ('FAIL ' + $nume + ' -> ' + $_.Exception.Message) }
}
function Egal($a, $b, [string]$ce) { if ($a -cne $b) { throw ($ce + ': asteptat [' + $b + '] primit [' + $a + ']') } }
function Refuza([scriptblock]$cod, [string]$motiv) {
  try { & $cod } catch { if ($_.Exception.Message -notlike ('*' + $motiv + '*')) { throw ('alt refuz: ' + $_.Exception.Message) }; return }
  throw ('nu a refuzat (asteptat ' + $motiv + ')')
}

if (-not ('PawTestArgv' -as [type])) {
  Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class PawTestArgv {
  [DllImport("shell32.dll", SetLastError=true)] static extern IntPtr CommandLineToArgvW([MarshalAs(UnmanagedType.LPWStr)] string cmd, out int n);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr p);
  public static string[] Parse(string cmd) {
    int n; IntPtr p = CommandLineToArgvW(cmd, out n); if (p == IntPtr.Zero) throw new System.ComponentModel.Win32Exception();
    try { var r = new string[n]; for (int i = 0; i < n; i++) r[i] = Marshal.PtrToStringUni(Marshal.ReadIntPtr(p, i * IntPtr.Size)); return r; }
    finally { LocalFree(p); }
  }
}
"@
}
function ArgvDin([string]$linie) { return [PawTestArgv]::Parse('agy.exe ' + $linie) | Select-Object -Skip 1 }

# Dependintele reale, fara efecte la incarcare: cdx_security.ps1 (garzi de cale) + mil.ps1 (canalul).
. (Join-Path $pachet 'cdx_security.ps1')
. (Join-Path $pachet 'mil.ps1')

# Lista alba: o singura definitie, in TOOLS din run_paw.ps1 (citita prin AST, fara a executa lansatorul).
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $pachet 'run_paw.ps1'), [ref]$null, [ref]$null)
$tools = $ast.FindAll({ param($n) $n -is [Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq '$TOOLS' }, $true) | Select-Object -First 1
$milKv = $tools.Right.Expression.KeyValuePairs | Where-Object { $_.Item1.Extent.Text -eq 'mil' }
$modele = @($milKv.Item2.Extent.Text | Select-String -Pattern '"([^"]*)"' -AllMatches | ForEach-Object { $_.Matches } | ForEach-Object { $_.Groups[1].Value } |
  Where-Object { $_ -notlike '*\*' })   # fara calea exe
$MODELE_REALE = @('', 'claude-opus-4-6-thinking', 'claude-sonnet-4-6', 'gemini-3.8-flash-high', 'gpt-oss-120b-medium')

Caz 'TOOLS.mil: lista alba = modelele reale din agy models, implicit primul' {
  Egal ($modele -join '|') ($MODELE_REALE -join '|') 'lista'
  Egal (MilModel '' $modele) 'claude-opus-4-6-thinking' 'implicit'
  Egal (MilModel 'gpt-oss-120b-medium' $modele) 'gpt-oss-120b-medium' 'permis'
}
Caz 'MilModel refuza modele in afara listei (si diferente de litere)' {
  foreach ($m in @('gpt-6-astra', 'CLAUDE-SONNET-4-6', 'claude-sonnet-4-6 --mode accept-edits', 'gemini-3.8-flash-thinking')) { Refuza { MilModel $m $modele } 'mil_model_nepermis' }
  Refuza { MilModel '' @('') } 'mil_fara_modele'
}

$briefOstil = "Titlu `"cu ghilimele`" si backslash \`" la final \\`n--mode accept-edits`n--dangerously-skip-permissions`n/agent rau`nC:\cale\cu\slash\`ndiacritice: " + [char]0x0103 + [char]0x021B + [char]0x0219 + "`n" + 'trailing\'
Caz 'MilArgumente: flaguri fixe intacte, brief-ul ramane UN singur argument -p= (ultimul), identic octet cu octet' {
  $prompt = MilPrompt 'C:\Users\Public\paw-data\brief\x.md' $briefOstil
  $argv = @(ArgvDin (MilArgumente 'claude-sonnet-4-6' $prompt))
  Egal $argv.Count 9 'numar argumente'
  Egal (($argv[0..7]) -join ' ') '--mode plan --sandbox --disable-slash-commands --model claude-sonnet-4-6 --print-timeout 160s' 'flaguri fixe'
  Egal $argv[8] ('-p=' + $prompt) 'prompt'
}
Caz 'ArgMil: ghilimele, backslash-uri (si inaintea ghilimelelor), linii noi, gol' {
  foreach ($v in @('', 'a b', 'a"b', 'a\"b', 'a\\"b', 'a\', 'a\\', "x`r`ny", '\\server\share\', '"', '\"', ' ')) {
    $argv = @(ArgvDin (ArgMil $v)); Egal $argv.Count 1 ('un argument pentru [' + $v + ']'); Egal $argv[0] $v 'valoare'
  }
  Refuza { ArgMil ("a" + [char]0 + "b") } 'mil_argument_nul'
}
Caz 'MilArgumente refuza fara trunchiere peste limita; exact la limita trece' {
  $lim = New-Object string ([char]'x', $MIL_PROMPT_MAX)
  [void](MilArgumente 'claude-sonnet-4-6' $lim)
  Refuza { MilArgumente 'claude-sonnet-4-6' ($lim + 'y') } 'mil_brief_prea_lung'
  $argv = @(ArgvDin (MilArgumente 'claude-sonnet-4-6' $lim)); Egal $argv[8].Length ($MIL_PROMPT_MAX + 3) 'lungime intacta'
  if ((MilArgumente 'claude-sonnet-4-6' $lim).Length + 'C:\Users\Gazpet-Ai\AppData\Local\agy\bin\agy.exe '.Length -gt 32766) { throw 'linia depaseste limita CreateProcess' }
}
Caz 'MilArgumente refuza model cu caractere de linie de comanda (a doua bariera)' {
  foreach ($m in @('a b', 'a"b', '--x', '', 'A')) { Refuza { MilArgumente $m 'p' } 'mil_model_invalid' }
}
Caz 'MilMediu: lista alba, fara chei/tokenuri/proxy, PATH doar de sistem' {
  $vechi = @{}
  foreach ($k in @('GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GH_TOKEN', 'GOOGLE_APPLICATION_CREDENTIALS', 'HTTPS_PROXY', 'PAW_TEST_SECRET')) {
    $vechi[$k] = [Environment]::GetEnvironmentVariable($k); [Environment]::SetEnvironmentVariable($k, 'NU-TREBUIE-SA-AJUNGA')
  }
  try {
    $m = MilMediu
    foreach ($k in $m.Keys) { if ($k -cne 'PATH' -and $MIL_ENV_PERMISE -cnotcontains $k) { throw ('cheie in afara listei: ' + $k) } }
    foreach ($v in $m.Values) { if ([string]$v -like '*NU-TREBUIE-SA-AJUNGA*') { throw 'valoare secreta in mediul copilului' } }
    $sr = [Environment]::GetEnvironmentVariable('SystemRoot')
    foreach ($d in ($m['PATH'] -split ';')) { if (-not $d.StartsWith($sr, [StringComparison]::OrdinalIgnoreCase)) { throw ('PATH in afara SystemRoot: ' + $d) } }
  } finally { foreach ($k in $vechi.Keys) { [Environment]::SetEnvironmentVariable($k, $vechi[$k]) } }
}

# Ruleaza inlocuit: inregistreaza apelurile si intoarce raspunsuri programate.
$script:apeluri = New-Object System.Collections.ArrayList
$script:raspunsuri = @{}
function Ruleaza([string]$exe, [string[]]$argv, [string]$stdinText, [string]$cwd, [int]$timeout, [hashtable]$env, [bool]$cleanEnvironment = $false, [bool]$trustedArguments = $false, [string]$argumenteGata = '') {
  [void]$script:apeluri.Add(@{ argv = @($argv); timeout = $timeout; curat = $cleanEnvironment; gata = $argumenteGata; env = $env })
  $cheie = if ($argumenteGata) { 'model' } else { ($argv -join ' ') }
  if ($script:raspunsuri.ContainsKey($cheie)) { return $script:raspunsuri[$cheie] }
  return @{ timeout = $false; exit = 0; out = 'RASPUNS'; err = '' }
}
function OkGol([string]$txt) { return @{ timeout = $false; exit = 0; out = $txt + "`r`n"; err = '' } }

Caz 'AssertMilFaraExtensii: doar raspunsul exact "gol" trece; MCP/plugin prezent, exit nenul sau timeout = refuz' {
  $script:raspunsuri = @{ 'mcp list' = (OkGol 'No MCP servers configured.'); 'plugin list' = (OkGol 'No plugins installed.') }
  AssertMilFaraExtensii 'x.exe' @{} 'C:\'
  $script:raspunsuri['mcp list'] = (OkGol "Configured MCP servers:`n  fs  enabled"); Refuza { AssertMilFaraExtensii 'x.exe' @{} 'C:\' } 'mil_extensii_refuzate (mcp list)'
  $script:raspunsuri['mcp list'] = @{ timeout = $false; exit = 1; out = 'No MCP servers configured.'; err = '' }; Refuza { AssertMilFaraExtensii 'x.exe' @{} 'C:\' } 'mil_extensii_refuzate'
  $script:raspunsuri['mcp list'] = @{ timeout = $true; exit = -1; out = ''; err = '' }; Refuza { AssertMilFaraExtensii 'x.exe' @{} 'C:\' } 'mil_preflight_timeout'
  $script:raspunsuri = @{ 'mcp list' = (OkGol 'No MCP servers configured.'); 'plugin list' = (OkGol 'Installed plugins: x') }; Refuza { AssertMilFaraExtensii 'x.exe' @{} 'C:\' } 'mil_extensii_refuzate (plugin list)'
}

Caz 'InvokeMil: preflight cu mediu curat, apoi UN apel cu linia gata citata; timeout = timpul ramas' {
  $script:apeluri.Clear()
  $script:raspunsuri = @{ 'mcp list' = (OkGol 'No MCP servers configured.'); 'plugin list' = (OkGol 'No plugins installed.') }
  function AssertMilExe([string]$exe) { }   # semnatura se testeaza separat, pe fisiere reale
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ('paw-mil-test-' + [guid]::NewGuid().ToString('N') + '.md')
  [IO.File]::WriteAllText($tmp, $briefOstil, (New-Object Text.UTF8Encoding($false)))
  try { $r = InvokeMil 'C:\x\agy.exe' 'claude-opus-4-6-thinking' $tmp 'C:\' 240 } finally { Remove-Item -LiteralPath $tmp -Force }
  Egal $r.out 'RASPUNS' 'rezultat'
  Egal $script:apeluri.Count 3 'apeluri'
  Egal ($script:apeluri[0].argv -join ' ') 'mcp list' 'primul'; Egal ($script:apeluri[1].argv -join ' ') 'plugin list' 'al doilea'
  foreach ($a in $script:apeluri) { if (-not $a.curat) { throw 'mediu necuratat' }; if ($a.env.Keys -contains 'GEMINI_API_KEY') { throw 'cheie in mediu' } }
  $m = $script:apeluri[2]; Egal $m.argv.Count 0 'argv gol la apelul principal'
  $argv = @(ArgvDin $m.gata); Egal $argv[8] ('-p=' + (MilPrompt $tmp $briefOstil)) 'prompt citat'
  if ($m.timeout -gt 240 -or $m.timeout -lt ($MIL_PRINT_TIMEOUT + 10)) { throw ('timeout neasteptat ' + $m.timeout) }
  Refuza { InvokeMil 'C:\x\agy.exe' 'claude-opus-4-6-thinking' 'C:\nu\exista.md' 'C:\' 240 } 'exista.md'
  Refuza { InvokeMil 'C:\x\agy.exe' 'claude-opus-4-6-thinking' (Join-Path $pachet 'mil.ps1') 'C:\' 100 } 'mil_timp_insuficient_dupa_preflight'
}
Remove-Item Function:\AssertMilExe -ErrorAction SilentlyContinue
. (Join-Path $pachet 'mil.ps1')   # AssertMilExe real din nou

Caz 'AssertMilExe: fisier nesemnat si semnatar strain refuzate; agy.exe real (daca exista) acceptat' {
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ('paw-mil-nesemnat-' + [guid]::NewGuid().ToString('N') + '.exe')
  [IO.File]::WriteAllBytes($tmp, [byte[]](0x4D, 0x5A, 0, 0))
  try { Refuza { AssertMilExe $tmp } 'mil_semnatura_invalida' } finally { Remove-Item -LiteralPath $tmp -Force }
  # fisierele din System32 au de obicei mai multe hardlink-uri (WinSxS): refuz inainte de semnatura
  Refuza { AssertMilExe (Join-Path $env:SystemRoot 'System32\notepad.exe') } 'cdx_hardlink_refused'
  # semnatura valida, dar alt semnatar: copia unui exe cu semnatura incorporata (node.exe, OpenJS Foundation)
  $strain = 'C:\Program Files\nodejs\node.exe'
  if (Test-Path -LiteralPath $strain) {
    $copie = Join-Path ([IO.Path]::GetTempPath()) ('paw-mil-strain-' + [guid]::NewGuid().ToString('N') + '.exe')
    Copy-Item -LiteralPath $strain -Destination $copie
    try { Refuza { AssertMilExe $copie } 'mil_semnatar_neasteptat' } finally { Remove-Item -LiteralPath $copie -Force }
  } else { Write-Host '  (node.exe lipsa: cazul semnatar strain omis)' }
  $agy = 'C:\Users\Gazpet-Ai\AppData\Local\agy\bin\agy.exe'
  if (Test-Path -LiteralPath $agy) { AssertMilExe $agy } else { Write-Host '  (agy.exe lipsa pe aceasta masina: ramura pozitiva omisa)' }
}

# Refuzurile de cale ale lansatorului (CaleSigura, comuna cu jak/gem/cop), extrasa prin AST din run_paw.ps1.
$def = $ast.FindAll({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'CaleSigura' }, $true) | Select-Object -First 1
. ([scriptblock]::Create($def.Extent.Text))
Caz 'CaleSigura: UNC, ADS, ghilimele, in afara radacinii si junction refuzate; cale buna acceptata' {
  $rad = Join-Path ([IO.Path]::GetTempPath()) ('paw-mil-rad-' + [guid]::NewGuid().ToString('N'))
  $brief = Join-Path $rad 'brief'; $alt = Join-Path $rad 'alt'
  [void](New-Item -ItemType Directory -Path $brief); [void](New-Item -ItemType Directory -Path $alt)
  [IO.File]::WriteAllText((Join-Path $brief 'ok.md'), 'x'); [IO.File]::WriteAllText((Join-Path $alt 'x.md'), 'x')
  try {
    Egal (CaleSigura (Join-Path $brief 'ok.md') @($brief) $true) (Join-Path $brief 'ok.md') 'cale buna'
    Refuza { CaleSigura '\\gazpet-tnas\Licitatii_Executate\x.md' @($brief) $true } 'UNC refuzat'
    Refuza { CaleSigura '//server/share/x.md' @($brief) $true } 'UNC refuzat'
    Refuza { CaleSigura ((Join-Path $brief 'ok.md') + ':ascuns') @($brief) $false } 'ADS refuzat'
    Refuza { CaleSigura ((Join-Path $brief 'ok.md') + '"') @($brief) $false } 'caractere interzise'
    Refuza { CaleSigura (Join-Path $brief '..\alt\x.md') @($brief) $true } 'in afara radacinilor'
    $j = Join-Path $brief 'leg'
    & cmd.exe /c mklink /J "$j" "$alt" | Out-Null
    if (-not (Test-Path -LiteralPath $j)) { throw 'junction necreat' }
    Refuza { CaleSigura (Join-Path $j 'x.md') @($brief) $true } 'reparse point refuzat'
  } finally {
    if (Test-Path -LiteralPath (Join-Path $brief 'leg')) { & cmd.exe /c rmdir "$(Join-Path $brief 'leg')" | Out-Null }
    Remove-Item -LiteralPath $rad -Recurse -Force
  }
}

Caz 'run_paw.ps1: ordinea pe canalul mil (validare -> Job -> lock_mil -> InvokeMil) si refuzurile la final' {
  $txt = [IO.File]::ReadAllText((Join-Path $pachet 'run_paw.ps1'))
  $iVal = $txt.IndexOf("if (`$Cine -eq 'mil') {"); $iStart = $txt.IndexOf('Set-Content -LiteralPath $script:OutFull -Value ("PAW_START')
  if ($iVal -lt 0 -or $iVal -gt $iStart -or $txt.IndexOf('AssertMilExe $T.exe', $iVal) -gt $iStart) { throw 'validarea mil nu e inainte de PAW_START' }
  $iCaz = $txt.IndexOf('"mil" {'); $iJob = $txt.IndexOf('LeagaCopiiiDeLansator', $iCaz); $iLock = $txt.IndexOf("LuaLock (Join-Path `$DATA 'lock_mil')", $iCaz); $iInv = $txt.IndexOf('InvokeMil ', $iCaz)
  if (-not ($iCaz -gt 0 -and $iCaz -lt $iJob -and $iJob -lt $iLock -and $iLock -lt $iInv)) { throw 'ordinea Job/lock/InvokeMil' }
  foreach ($s in @("Eroare ('mil_exit_' + `$rez.exit)", "Eroare 'mil_raspuns_gol'", 'permis: jak, cop, ollie, gem, cdx, mil')) { if ($txt.IndexOf($s) -lt 0) { throw ('lipseste: ' + $s) } }
  if ($txt -match '--mode\s+accept|dangerously-skip|--mode\s+auto') { throw 'mod de scriere in lansator' }
}
Caz 'pachet: install.ps1 copiaza mil.ps1; SHA256.json acopera toate fisierele, hash-urile se potrivesc' {
  $inst = [IO.File]::ReadAllText((Join-Path $pachet 'install.ps1'))
  if ($inst -notmatch "'jak_config_probe\.py','mil\.ps1','install\.ps1'\)") { throw 'mil.ps1 lipseste din lista installerului' }
  $man = Get-Content -LiteralPath (Join-Path $pachet 'SHA256.json') -Raw | ConvertFrom-Json
  $nume = @($man.PSObject.Properties | ForEach-Object { $_.Name })
  foreach ($n in @('run_paw.ps1', 'mil.ps1', 'install.ps1', 'jak.ps1', 'cdx.ps1')) { if ($nume -cnotcontains $n) { throw ('lipseste din manifest: ' + $n) } }
  foreach ($e in $man.PSObject.Properties) { Egal (HashCdx (Join-Path $pachet $e.Name)) $e.Value ('hash ' + $e.Name) }
}

Write-Host ('TESTE mil: ' + $script:ok + ' trec, ' + $script:rau + ' pica')
if ($script:rau) { exit 1 } else { exit 0 }
