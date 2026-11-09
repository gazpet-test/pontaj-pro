# Teste fara Pester pentru canalul mil (v4.6.2 r2). Ruleaza: powershell -NoProfile -ExecutionPolicy Bypass -File teste\test_mil.ps1
# Nu porneste agy, nu scrie in paw-data, nu ia lock-uri: mil.ps1 se incarca cu Ruleaza inlocuit; citarea liniei de comanda se
# verifica cu parserul real Windows (CommandLineToArgvW, aceleasi reguli ca runtime-ul Go al agy). Copia doar-citire se face REAL,
# intr-un director temporar (ACL-uri reale). Integrarea cu agy.exe real, fara apel de model: teste\sonda_mil_reala.ps1.
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
$EXE = 'C:\Users\Gazpet-Ai\AppData\Local\agy\bin\agy.exe'
$JUR = 'C:\Users\Public\paw-data\mil\20261109-230000-abcdef-agy\rulare.log'
$TMP = [PawMilAcl]::Lunga([IO.Path]::GetTempPath())
function DirTemp([string]$p) { $d = Join-Path $TMP ($p + [guid]::NewGuid().ToString('N').Substring(0, 8)); [void](New-Item -ItemType Directory -Path $d); return $d }
function RunIdTest() { return (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 6) }

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
$FIXE = '--mode plan --sandbox --disable-slash-commands --model claude-sonnet-4-6 --print-timeout 160s --log-file ' + $JUR
Caz 'MilArgumente: flaguri fixe intacte (cu --log-file), brief-ul ramane UN singur argument -p= (ultimul), identic octet cu octet' {
  $prompt = MilPrompt 'C:\Users\Public\paw-data\brief\x.md' $briefOstil @('a.diff')
  if ($prompt -cnotmatch 'copie DOAR-CITIRE a materialului: brief\.md, a\.diff\.') { throw 'promptul nu descrie copia' }
  $argv = @(ArgvDin (MilArgumente $EXE 'claude-sonnet-4-6' $prompt $JUR))
  Egal $argv.Count 11 'numar argumente'
  Egal (($argv[0..9]) -join ' ') $FIXE 'flaguri fixe'
  Egal $argv[10] ('-p=' + $prompt) 'prompt'
}
Caz 'MilArgumenteSonda: aceleasi flaguri + stream-json, prompt gol atasat (zero ture)' {
  $argv = @(ArgvDin (MilArgumenteSonda $EXE 'claude-sonnet-4-6' $JUR))
  Egal ($argv -join ' ') ($FIXE + ' --input-format stream-json --output-format stream-json --print=') 'sonda'
}
Caz 'ArgMil: ghilimele, backslash-uri (si inaintea ghilimelelor), linii noi, gol' {
  foreach ($v in @('', 'a b', 'a"b', 'a\"b', 'a\\"b', 'a\', 'a\\', "x`r`ny", '\\server\share\', '"', '\"', ' ')) {
    $argv = @(ArgvDin (ArgMil $v)); Egal $argv.Count 1 ('un argument pentru [' + $v + ']'); Egal $argv[0] $v 'valoare'
  }
  Refuza { ArgMil ("a" + [char]0 + "b") } 'mil_argument_nul'
}
Caz 'P2 r1: limita pe linia FINALA (dupa citare, cu exe si NUL): 17.000 de ghilimele refuzate; exact la limita trece' {
  Refuza { MilArgumente $EXE 'claude-sonnet-4-6' (New-Object string ([char]'"', 17000)) $JUR } 'mil_brief_prea_lung (linia de comanda'
  Refuza { MilArgumente $EXE 'claude-sonnet-4-6' ((New-Object string ([char]'x', 16000)) + (New-Object string ([char]'\', 9000))) $JUR } 'mil_brief_prea_lung'
  Refuza { MilArgumente $EXE 'claude-sonnet-4-6' (New-Object string ([char]'x', ($MIL_PROMPT_MAX + 1))) $JUR } 'mil_brief_prea_lung'
  # baza = tot in afara continutului promptului: "exe" + spatiu + flaguri citate + spatiu + "-p=" + "" + NUL
  $baza = ('"' + $EXE + '" ' + (MilArgumente $EXE 'claude-sonnet-4-6' '' $JUR)).Length + 1
  $n = [int][Math]::Floor(($MIL_LINIE_MAX - $baza) / 2)   # fiecare ghilimea devine \" (2 caractere)
  $linie = MilArgumente $EXE 'claude-sonnet-4-6' (New-Object string ([char]'"', $n)) $JUR
  if (('"' + $EXE + '" ' + $linie).Length + 1 -gt $MIL_LINIE_MAX) { throw 'a trecut peste limita' }
  Egal (@(ArgvDin $linie)[10]) ('-p=' + (New-Object string ([char]'"', $n))) 'prompt intact la limita'
  Refuza { MilArgumente $EXE 'claude-sonnet-4-6' (New-Object string ([char]'"', ($n + 1))) $JUR } 'mil_brief_prea_lung'
}
Caz 'MilArgumente refuza model cu caractere de linie de comanda si jurnal relativ (a doua bariera)' {
  foreach ($m in @('a b', 'a"b', '--x', '', 'A')) { Refuza { MilArgumente $EXE $m 'p' $JUR } 'mil_model_invalid' }
  Refuza { MilArgumente $EXE 'claude-sonnet-4-6' 'p' 'rulare.log' } 'mil_jurnal_invalid'
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

# --- P1-1: configuratia / hooks (profil fals, cwd temporar) ---
Caz 'P1-1 AssertMilConfig: hooks global / vechi, config.json, .agents in cwd si in parinte, setari nepermise = refuz; curat trece' {
  $rad = DirTemp 'paw-mil-cfg-'
  try {
    $prof = Join-Path $rad 'profil'; $cwd = Join-Path $rad 'w\copie'
    foreach ($d in @("$prof\.gemini\config", "$prof\.gemini\antigravity-cli", $cwd)) { [void](New-Item -ItemType Directory -Path $d -Force) }
    AssertMilConfig $prof $cwd
    foreach ($f in @("$prof\.gemini\config\hooks.json", "$prof\.gemini\antigravity-cli\hooks.json", "$prof\.gemini\config\config.json")) {
      [IO.File]::WriteAllText($f, '{}'); Refuza { AssertMilConfig $prof $cwd } 'mil_config_refuzata'; Remove-Item -LiteralPath $f
    }
    $h = "$prof\.gemini\config\hooks.json"; [IO.File]::WriteAllText($h, '{}'); (Get-Item -LiteralPath $h).Attributes = 'Hidden'
    Refuza { AssertMilConfig $prof $cwd } 'mil_config_refuzata'; (Get-Item -LiteralPath $h -Force).Attributes = 'Normal'; Remove-Item -LiteralPath $h
    # r3 (Jakarinos r2 P1): toate cele patru nume documentate, in cwd, in parinte si intr-un parinte cu radacina Git
    [void](New-Item -ItemType Directory -Path "$rad\.git")
    foreach ($nume in @('.agents', '_agents', '.agent', '_agent')) {
      foreach ($a in @("$cwd\$nume", "$rad\w\$nume", "$rad\$nume")) {
        [void](New-Item -ItemType Directory -Path $a); Refuza { AssertMilConfig $prof $cwd } ('mil_config_refuzata (' + $a + ')'); Remove-Item -LiteralPath $a
      }
    }
    [IO.File]::WriteAllText("$rad\_agent", 'fisier, nu director'); Refuza { AssertMilConfig $prof $cwd } 'mil_config_refuzata'; Remove-Item -LiteralPath "$rad\_agent"
    AssertMilConfig $prof $cwd
    # r4 (Jakarinos r3 P1): redirectionarea din repo parinte (.gemini\config.json) si orice .gemini in afara profilului
    [void](New-Item -ItemType Directory -Path "$rad\.gemini"); Refuza { AssertMilConfig $prof $cwd } ('mil_config_refuzata (' + "$rad\.gemini" + ')')
    [IO.File]::WriteAllText("$rad\.gemini\config.json", '{"personal_customization_dir":"people/{user}"}'); Refuza { AssertMilConfig $prof $cwd } 'config.json'
    Remove-Item -LiteralPath "$rad\.gemini" -Recurse
    # cwd sub profil: .gemini al profilului e permis, dar nu si config.json direct in el
    $cwdP = Join-Path $prof 'lucru\copie'; [void](New-Item -ItemType Directory -Path $cwdP -Force)
    AssertMilConfig $prof $cwdP
    [IO.File]::WriteAllText("$prof\.gemini\config.json", '{}'); Refuza { AssertMilConfig $prof $cwdP } 'config.json'; Remove-Item -LiteralPath "$prof\.gemini\config.json"
    # r4 (decizie chat): sursele globale de pluginuri / agenti / hooks
    foreach ($r in @('config\plugins.json', 'config\agents.json', 'config.json')) {
      [IO.File]::WriteAllText("$prof\.gemini\$r", '{}'); Refuza { AssertMilConfig $prof $cwd } ('mil_config_refuzata (' + "$prof\.gemini\$r" + ')'); Remove-Item -LiteralPath "$prof\.gemini\$r"
    }
    foreach ($r in @('config\plugins', 'config\agents', 'config\hooks', 'antigravity-cli\plugins')) {
      [void](New-Item -ItemType Directory -Path "$prof\.gemini\$r"); Refuza { AssertMilConfig $prof $cwd } ('mil_config_refuzata (' + "$prof\.gemini\$r" + ')'); Remove-Item -LiteralPath "$prof\.gemini\$r"
    }
    AssertMilConfig $prof $cwd
    $s = "$prof\.gemini\antigravity-cli\settings.json"
    [IO.File]::WriteAllText($s, '{"colorScheme":"dark","trustedWorkspaces":["C:\\x"]}'); AssertMilConfig $prof $cwd
    [IO.File]::WriteAllText($s, '{"colorScheme":"dark","permissions":{"allow":["command(*)"]}}'); Refuza { AssertMilConfig $prof $cwd } 'mil_setari_refuzate (permissions)'
    [IO.File]::WriteAllText($s, '{"hooks":{}}'); Refuza { AssertMilConfig $prof $cwd } 'mil_setari_refuzate (hooks)'
    [IO.File]::WriteAllText($s, '{"perm\u0069ssions":{}}'); Refuza { AssertMilConfig $prof $cwd } 'mil_setari_refuzate (permissions)'
    [IO.File]::WriteAllText($s, '{nu e json'); Refuza { AssertMilConfig $prof $cwd } 'mil_setari_ilizibile'
    [IO.File]::WriteAllText($s, '[1,2]'); Refuza { AssertMilConfig $prof $cwd } 'mil_setari_ilizibile'
    Refuza { AssertMilConfig '' $cwd } 'mil_profil_necunoscut'
  } finally { Remove-Item -LiteralPath $rad -Recurse -Force }
}

$JS = @'
I1109 22:54:58.965113       1 hooks_manager.go:53] loaded 0 named hooks from 0 hooks.json file(s)
I1109 22:54:58.965635       1 session.go:87] Print mode: enabling terminal sandbox for this session
I1109 22:54:58.968468       1 hooks_manager.go:53] loaded 0 named hooks from 0 hooks.json file(s)
I1109 22:54:58.968468       1 printmode.go:889] Print mode: applying agent mode plan
I1109 22:55:01.455798       1 streaminput.go:161] Print mode: stream input closed after 0 turn(s)
'@
$JR = @'
I1109 22:54:58.965113       1 hooks_manager.go:53] loaded 0 named hooks from 0 hooks.json file(s)
I1109 22:54:58.965635       1 session.go:87] Print mode: enabling terminal sandbox for this session
I1109 22:54:58.968468       1 printmode.go:889] Print mode: applying agent mode plan
I1109 22:50:07.941068     919 http_helpers.go:653] URL: https://example.invalid/v1internal:streamGenerateContent?alt=sse
'@
Caz 'P1-1/P1-2 MilVerificaJurnal: jurnalele reale trec; hooks incarcate, sandbox indisponibil / nepornit, mod lipsa, tura la sonda = refuz' {
  MilVerificaJurnal $JS '' $true
  MilVerificaJurnal $JR '' $false
  Refuza { MilVerificaJurnal $JR '' $true } 'mil_sonda_cu_tura_de_model'
  Refuza { MilVerificaJurnal ($JS -replace 'loaded 0 named hooks from 0', 'loaded 1 named hooks from 1') '' $true } 'mil_hooks_incarcate'
  Refuza { MilVerificaJurnal ($JS -replace 'loaded 0 named hooks from 0 hooks', 'loaded 0 named hooks from 2 hooks') '' $true } 'mil_hooks_incarcate'
  Refuza { MilVerificaJurnal ($JS -replace '(?m)^.*named hooks.*$', '') '' $true } 'mil_hooks_neverificate'
  Refuza { MilVerificaJurnal ($JS -replace 'enabling terminal sandbox', 'x') '' $true } 'mil_sandbox_nepornit'
  Refuza { MilVerificaJurnal ($JS + "`nW1109 x.go:1] Terminal sandbox unavailable: no AppContainer") '' $true } 'mil_sandbox_indisponibil'
  Refuza { MilVerificaJurnal $JS 'warning: --mode plan is not available because the terminal sandbox is not available on this host' $true } 'mil_sandbox_indisponibil'
  Refuza { MilVerificaJurnal ($JS + "`nI1109 p.go:1] Print mode: --mode plan is unavailable (terminal sandbox unavailable), continuing in the default mode") '' $true } 'mil_sandbox_indisponibil'
  Refuza { MilVerificaJurnal ($JS -replace 'applying agent mode plan', 'applying agent mode auto') '' $true } 'mil_mod_plan_neaplicat'
  Refuza { MilVerificaJurnal '' '' $false } 'mil_jurnal_agy_lipsa'
}
Caz 'P2 r1: MilDiagCurat ascunde valori care arata a secrete si plafoneaza; MilDiag pastreaza diagnosticul' {
  $t = MilDiagCurat ("Authorization: Bearer ya29.abcDEF123-_x token=s3cr3t key: k1 " + (New-Object string ([char]'a', 50)) + "`n" + [char]27 + '[31mrosu')
  foreach ($s in @('ya29.abc', 's3cr3t', 'k1 ', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', [string][char]27)) { if ($t.Contains($s)) { throw ('a ramas: ' + $s) } }
  if ((MilDiagCurat (New-Object string ([char]'z', 5000)).Replace('zzzz', 'z z ')).Length -gt ($MIL_DIAG_MAX + 20)) { throw 'neplafonat' }
  $n = $script:MilDiagLinii.Count; MilDiag 'proba' 'stderr: x'; Egal $script:MilDiagLinii.Count ($n + 1) 'diag pastrat'
}

# Ruleaza inlocuit: inregistreaza apelurile si intoarce raspunsuri programate.
$script:apeluri = New-Object System.Collections.ArrayList
$script:raspunsuri = @{}
function Ruleaza([string]$exe, [string[]]$argv, [string]$stdinText, [string]$cwd, [int]$timeout, [hashtable]$env, [bool]$cleanEnvironment = $false, [bool]$trustedArguments = $false, [string]$argumenteGata = '') {
  [void]$script:apeluri.Add(@{ argv = @($argv); timeout = $timeout; curat = $cleanEnvironment; gata = $argumenteGata; env = $env; cwd = $cwd; stdin = $stdinText })
  $cheie = if ($argumenteGata) { 'model' } else { ($argv -join ' ') }
  if ($script:raspunsuri.ContainsKey($cheie)) { return $script:raspunsuri[$cheie] }
  return @{ timeout = $false; exit = 0; out = 'RASPUNS'; err = '' }
}
function OkGol([string]$txt) { return @{ timeout = $false; exit = 0; out = $txt + "`r`n"; err = '' } }

Caz 'AssertMilFaraExtensii: doar raspunsul exact "gol" trece; MCP/plugin prezent, exit nenul sau timeout = refuz; stderr in diagnostic' {
  $script:raspunsuri = @{ 'mcp list' = (OkGol 'No MCP servers configured.'); 'plugin list' = (OkGol 'No plugins installed.') }
  AssertMilFaraExtensii 'x.exe' @{} 'C:\'
  $script:raspunsuri['mcp list'] = (OkGol "Configured MCP servers:`n  fs  enabled"); Refuza { AssertMilFaraExtensii 'x.exe' @{} 'C:\' } 'mil_extensii_refuzate (mcp list)'
  $script:raspunsuri['mcp list'] = @{ timeout = $false; exit = 1; out = 'No MCP servers configured.'; err = 'eroare-preflight-vizibila' }; Refuza { AssertMilFaraExtensii 'x.exe' @{} 'C:\' } 'mil_extensii_refuzate'
  if (-not ($script:MilDiagLinii | Where-Object { $_ -like '*preflight mcp list*eroare-preflight-vizibila*' })) { throw 'stderr-ul preflight-ului nu a ajuns in diagnostic' }
  $script:raspunsuri['mcp list'] = @{ timeout = $true; exit = -1; out = ''; err = 'diag-timeout' }; Refuza { AssertMilFaraExtensii 'x.exe' @{} 'C:\' } 'mil_preflight_timeout'
  if (-not ($script:MilDiagLinii | Where-Object { $_ -like '*diag-timeout*' })) { throw 'stderr-ul la timeout nu a ajuns in diagnostic' }
  $script:raspunsuri = @{ 'mcp list' = (OkGol 'No MCP servers configured.'); 'plugin list' = (OkGol 'Installed plugins: x') }; Refuza { AssertMilFaraExtensii 'x.exe' @{} 'C:\' } 'mil_extensii_refuzate (plugin list)'
}

# --- P1-2: copia doar-citire (ACL-uri reale, director temporar) ---
Caz 'P1-2 copie: brief + material copiate; dupa blocare TOATE probele de scriere pica (si ACL-ul pe cale); curatarea o sterge' {
  $rad = DirTemp 'paw-mil-copie-'
  try {
    $liv = Join-Path $rad 'livrare'; $baza = Join-Path $rad 'mil'; [void](New-Item -ItemType Directory -Path $liv)
    $brief = Join-Path $rad 'brief.md'; [IO.File]::WriteAllText($brief, 'BRIEF'); [IO.File]::WriteAllText("$liv\a.diff", 'DIFF')
    $dir = MilPregatesteCopie $baza (RunIdTest) $brief @("$liv\a.diff") @($liv)
    Egal ((@([IO.Directory]::GetFiles($dir) | ForEach-Object { [IO.Path]::GetFileName($_) }) | Sort-Object) -join ',') 'a.diff,brief.md' 'continut'
    MilBlocheazaCopie
    AssertMilCopieReadOnly
    Egal ([IO.File]::ReadAllText("$dir\a.diff")) 'DIFF' 'citire dupa blocare'
    Refuza { [IO.File]::WriteAllText("$dir\nou.txt", 'x') } ''
    Refuza { $a = [IO.Directory]::GetAccessControl($dir); $a.SetOwner([Security.Principal.SecurityIdentifier]$script:MilCopie.sid); [IO.Directory]::SetAccessControl($dir, $a) } ''
    MilStergeCopie $false
    if (Test-Path -LiteralPath $dir) { throw 'copia a ramas' }
    if ($script:MilCopie) { throw 'starea copiei a ramas' }
  } finally { MilStergeCopie $false; Remove-Item -LiteralPath $rad -Recurse -Force }
}
Caz 'P1-2 mutatie: o copie NEBLOCATA declarata blocata e prinsa de probele de scriere; o copie neblocata nu trece verificarea' {
  $rad = DirTemp 'paw-mil-mut-'
  try {
    $brief = Join-Path $rad 'brief.md'; [IO.File]::WriteAllText($brief, 'BRIEF')
    [void](MilPregatesteCopie (Join-Path $rad 'mil') (RunIdTest) $brief @() @())
    Refuza { AssertMilCopieReadOnly } 'mil_copie_stare_invalida'
    $script:MilCopie.blocata = $true   # mutatie: fara DACL doar-citire
    Refuza { AssertMilCopieReadOnly } 'mil_copie_nu_e_read_only (fisier nou)'
    $script:MilCopie.blocata = $false
  } finally { MilStergeCopie $false; Remove-Item -LiteralPath $rad -Recurse -Force }
}
Caz 'P1-2 material: nume cu punct (.agents), duplicat, rezervat, in afara radacinilor, hardlink, prea mare = refuz; copia partiala se sterge' {
  $rad = DirTemp 'paw-mil-mat-'
  try {
    $liv = Join-Path $rad 'livrare'; $alt = Join-Path $rad 'alt'; $baza = Join-Path $rad 'mil'
    foreach ($d in @($liv, $alt, "$liv\sub")) { [void](New-Item -ItemType Directory -Path $d) }
    $brief = Join-Path $rad 'brief.md'; [IO.File]::WriteAllText($brief, 'B')
    foreach ($f in @('.agents', 'a.diff', 'brief.md')) { [IO.File]::WriteAllText("$liv\$f", 'x') }
    [IO.File]::WriteAllText("$liv\sub\a.diff", 'x'); [IO.File]::WriteAllText("$alt\x.diff", 'x')
    # refuzuri la validare: inainte de orice scriere (nicio copie creata, nicio stare)
    Refuza { MilPregatesteCopie $baza (RunIdTest) $brief @("$liv\.agents") @($liv) } 'mil_material_nume_invalid'
    Refuza { MilPregatesteCopie $baza (RunIdTest) $brief @("$liv\brief.md") @($liv) } 'mil_material_nume_invalid'
    Refuza { MilPregatesteCopie $baza (RunIdTest) $brief @("$liv\a.diff", "$liv\sub\a.diff") @($liv) } 'mil_material_nume_duplicat'
    Refuza { MilPregatesteCopie $baza (RunIdTest) $brief @("$alt\x.diff") @($liv) } 'mil_material_in_afara_radacinilor'
    Refuza { MilPregatesteCopie $baza (RunIdTest) $brief @("$liv\..\alt\x.diff") @($liv) } 'cdx_reserved_path'
    Refuza { MilPregatesteCopie $baza (RunIdTest) $brief @("$liv\lipsa.diff") @($liv) } 'mil_material_lipsa'
    Refuza { MilPregatesteCopie $baza 'x' $brief @() @() } 'mil_runid_invalid'
    if ($script:MilCopie -or @(Get-ChildItem -LiteralPath $baza -Force).Count) { throw 'refuzul la validare a lasat stare / copii' }
    # refuzuri la copiere (pe handle): copia partiala exista pana la curatare (InvokeMil o sterge in finally)
    [void](New-Item -ItemType HardLink -Path "$liv\leg.diff" -Target "$liv\a.diff")
    Refuza { MilPregatesteCopie $baza (RunIdTest) $brief @("$liv\leg.diff") @($liv) } 'mil_material_hardlink'
    MilStergeCopie $false
    $mare = "$liv\mare.bin"; $fs = [IO.File]::Create($mare); $fs.SetLength($MIL_MATERIAL_MAX_BYTES + 1); $fs.Close()
    Refuza { MilPregatesteCopie $baza (RunIdTest) $brief @($mare) @($liv) } 'mil_material_prea_mare'
    MilStergeCopie $false
    if (@(Get-ChildItem -LiteralPath $baza -Force).Count) { throw 'curatarea nu a sters copiile partiale' }
  } finally { MilStergeCopie $false; Remove-Item -LiteralPath $rad -Recurse -Force }
}
Caz 'MilCitesteLista: UTF-8 strict, fara NUL / UTF-16, plafon de intrari' {
  $rad = DirTemp 'paw-mil-lista-'
  try {
    $l = Join-Path $rad 'm.txt'
    [IO.File]::WriteAllText($l, "C:\a.diff`r`n`r`n  C:\b.diff  `n"); Egal ((@(MilCitesteLista $l)) -join '|') 'C:\a.diff|C:\b.diff' 'linii'
    [IO.File]::WriteAllText($l, 'C:\a.diff', [Text.Encoding]::Unicode); Refuza { MilCitesteLista $l } 'mil_material_lista_invalida'
    [IO.File]::WriteAllBytes($l, [byte[]](0x43, 0x3A, 0xC3, 0x28)); Refuza { MilCitesteLista $l } 'mil_material_lista_invalida (UTF-8)'
    [IO.File]::WriteAllText($l, ((1..($MIL_MATERIAL_MAX + 1) | ForEach-Object { "C:\f$_.txt" }) -join "`n")); Refuza { MilCitesteLista $l } 'mil_material_prea_multe'
  } finally { Remove-Item -LiteralPath $rad -Recurse -Force }
}

# --- InvokeMil cap-coada, cu Ruleaza inlocuit si copie reala ---
function SondaOk([string]$cwd, [string]$model) { return @{ timeout = $false; exit = 0; err = ''; out = ((@{ event = 'init'; init = @{ model = $model; cwd = $cwd; permission_mode = 'request-review' } } | ConvertTo-Json -Compress) + "`n") } }
$script:jurSonda = $JS; $script:jurRulare = $JR; $script:sonda = $null; $script:scriereInCopie = $null
function Ruleaza([string]$exe, [string[]]$argv, [string]$stdinText, [string]$cwd, [int]$timeout, [hashtable]$env, [bool]$cleanEnvironment = $false, [bool]$trustedArguments = $false, [string]$argumenteGata = '') {
  [void]$script:apeluri.Add(@{ argv = @($argv); timeout = $timeout; curat = $cleanEnvironment; gata = $argumenteGata; env = $env; cwd = $cwd; stdin = $stdinText })
  if (-not $argumenteGata) {
    if (($argv -join ' ') -ceq 'mcp list') { return (OkGol 'No MCP servers configured.') }
    if (($argv -join ' ') -ceq 'plugin list') { return (OkGol 'No plugins installed.') }
    throw 'apel neasteptat'
  }
  $a = @(ArgvDin $argumenteGata); $log = $a[[array]::IndexOf($a, '--log-file') + 1]
  if ($a -ccontains '--input-format') {
    [IO.File]::WriteAllText($log, $script:jurSonda)
    if ($script:sonda) { return (& $script:sonda $cwd) }
    return (SondaOk $cwd $a[[array]::IndexOf($a, '--model') + 1])
  }
  [IO.File]::WriteAllText($log, $script:jurRulare)
  $script:scriereInCopie = MilIncearca { [IO.File]::WriteAllText((Join-Path $cwd 'scris-de-agy.txt'), 'x') }
  return @{ timeout = $false; exit = 0; out = 'RASPUNS'; err = $script:errRulare }
}
Caz 'r3/r4 MilArboreGol real: fara Job verificabil = NECUNOSCUT (gol = $false, motiv), deci copia ar ramane doar-citire' {
  if ('PawV43.Job' -as [type]) { throw 'tipul Job exista in procesul de test (neasteptat)' }
  $a = MilArboreGol; Egal $a.gol $false 'fara job'; Egal $a.ramase 'fara Job' 'motiv'
}
Caz 'r4 AssertMilMediu: mediul real trece; variabile care redirectioneaza agy sau alt profil = refuz' {
  $m = MilMediu; AssertMilMediu $m
  foreach ($k in @('ANTIGRAVITY_CONFIG_REL_DIR', 'ANTIGRAVITY_PERM_GRANTS', 'AGY_ADC_AUTH', 'GEMINI_API_KEY', 'XDG_CONFIG_HOME', 'HOME')) {
    $x = @{}; foreach ($c in $m.Keys) { $x[$c] = $m[$c] }; $x[$k] = 'C:\alt'; Refuza { AssertMilMediu $x } ('mil_mediu_refuzat (' + $k + ')')
  }
  $x = @{}; foreach ($c in $m.Keys) { $x[$c] = $m[$c] }; $x['USERPROFILE'] = 'C:\Users\Public'; Refuza { AssertMilMediu $x } 'USERPROFILE diferit'
  # a doua bariera: chiar daca cineva ar pune o astfel de variabila in lista alba, prefixele raman refuzate
  $vechi = $MIL_ENV_PERMISE
  try {
    $script:MIL_ENV_PERMISE = @($vechi) + @('ANTIGRAVITY_CONFIG_REL_DIR', 'HOME')
    foreach ($k in @('ANTIGRAVITY_CONFIG_REL_DIR', 'HOME')) {
      $x = @{}; foreach ($c in $m.Keys) { $x[$c] = $m[$c] }; $x[$k] = 'C:\alt'; Refuza { AssertMilMediu $x } ('mil_mediu_refuzat (' + $k + ')')
    }
  } finally { $script:MIL_ENV_PERMISE = $vechi }
  $src = [IO.File]::ReadAllText((Join-Path $pachet 'mil.ps1'))
  if ($src.IndexOf('AssertMilMediu $mediu') -lt 0) { throw 'InvokeMil nu verifica mediul' }
}
function AssertMilExe([string]$exe) { }   # semnatura se testeaza separat, pe fisiere reale
function AssertMilGazda() { }
function AssertMilMediu([hashtable]$m) { }   # testat mai sus pe mediul real; aici profilul e fals
$script:profilFals = $null
function MilMediu() { return @{ USERPROFILE = $script:profilFals; SystemRoot = $env:SystemRoot; PATH = $env:SystemRoot + '\system32' } }
$script:arboreGol = $true
function MilArboreGol() { return @{ gol = $script:arboreGol; ramase = $(if ($script:arboreGol) { '' } else { 'pid 4242' }) } }   # in lansator: Pids + Wait-Process + Active() = 1
$script:errRulare = ''
function CuratPastrate() {
  # doar pentru teste: copiile pastrate doar-citire se curata prin handle-urile pastrate (cum ar face un admin, vezi runbook)
  foreach ($c in @($script:MilCopiiPastrate)) {
    foreach ($h in $c.handles) { [PawMilAcl]::SeteazaDacl($h, ('D:P(A;OICI;FA;;;' + $c.sid + ')(A;OICI;FA;;;SY)')) }
    foreach ($h in $c.handles) { $h.Close() }
  }
  $script:MilCopiiPastrate = @()
}

Caz 'InvokeMil: preflight + sonda + rulare in COPIA doar-citire (nu in repo); agy nu poate scrie; copia si jurnalele sterse' {
  $rad = DirTemp 'paw-mil-inv-'
  try {
    $script:profilFals = Join-Path $rad 'profil'; [void](New-Item -ItemType Directory -Path $script:profilFals)
    $liv = Join-Path $rad 'livrare'; [void](New-Item -ItemType Directory -Path $liv); [IO.File]::WriteAllText("$liv\a.diff", 'DIFF')
    $brief = Join-Path $rad 'brief.md'; [IO.File]::WriteAllText($brief, $briefOstil, (New-Object Text.UTF8Encoding($false)))
    $lista = Join-Path $rad 'm.txt'; [IO.File]::WriteAllText($lista, "$liv\a.diff")
    $baza = Join-Path $rad 'mil'; $id = RunIdTest
    $script:apeluri.Clear(); $script:scriereInCopie = $null
    $r = InvokeMil 'C:\x\agy.exe' 'claude-opus-4-6-thinking' $brief 300 $lista $baza $id @($liv)
    Egal $r.out 'RASPUNS' 'rezultat'
    Egal $script:apeluri.Count 4 'apeluri (mcp, plugin, sonda, rulare)'
    $copie = Join-Path ([PawMilAcl]::Lunga($baza)) $id
    foreach ($x in $script:apeluri) { Egal $x.cwd $copie 'cwd = copia'; if (-not $x.curat) { throw 'mediu necuratat' }; Egal $x.stdin '' 'stdin gol' }
    Egal $script:scriereInCopie $false 'agy a putut scrie in copie'
    $m = $script:apeluri[3]; Egal $m.argv.Count 0 'argv gol la apelul principal'
    $argv = @(ArgvDin $m.gata); Egal $argv[10] ('-p=' + (MilPrompt $brief $briefOstil @('a.diff'))) 'prompt citat'
    if ($m.timeout -gt 300 -or $m.timeout -lt ($MIL_PRINT_TIMEOUT + 10)) { throw ('timeout neasteptat ' + $m.timeout) }
    if (Test-Path -LiteralPath $copie) { throw 'copia a ramas' }
    if (Test-Path -LiteralPath ($copie + '-agy')) { throw 'jurnalele au ramas' }
  } finally { MilStergeCopie $false; Remove-Item -LiteralPath $rad -Recurse -Force }
}
Caz 'InvokeMil refuza (si sterge copia): sonda cu hooks / sandbox indisponibil / alt cwd / alte permisiuni / iesire in plus; rulare fara sandbox' {
  $rad = DirTemp 'paw-mil-neg-'
  try {
    $script:profilFals = Join-Path $rad 'profil'; [void](New-Item -ItemType Directory -Path $script:profilFals)
    $brief = Join-Path $rad 'brief.md'; [IO.File]::WriteAllText($brief, 'B'); $baza = Join-Path $rad 'mil'
    $cazuri = @(
      @{ js = ($JS -replace 'loaded 0 named hooks from 0', 'loaded 1 named hooks from 1'); jr = $JR; s = $null; m = 'mil_hooks_incarcate' },
      @{ js = ($JS + "`nW x.go:1] Terminal sandbox unavailable: x"); jr = $JR; s = $null; m = 'mil_sandbox_indisponibil' },
      @{ js = $JS; jr = $JR; s = { param($c) SondaOk 'C:\Users\Gazpet-Ai\gazpet-erp' 'claude-opus-4-6-thinking' }; m = 'mil_sonda_cwd' },
      @{ js = $JS; jr = $JR; s = { param($c) $o = SondaOk $c 'claude-opus-4-6-thinking'; $o.out = $o.out.Replace('request-review', 'bypass'); $o }; m = 'mil_sonda_permisiuni' },
      @{ js = $JS; jr = $JR; s = { param($c) $o = SondaOk $c 'claude-opus-4-6-thinking'; $o.out += '{"event":"result"}'; $o }; m = 'mil_sonda_iesire_neasteptata' },
      @{ js = $JS; jr = $JR; s = { param($c) @{ timeout = $false; exit = 1; out = ''; err = 'x' } }; m = 'mil_sonda_exit_1' },
      @{ js = $JS; jr = ($JR -replace 'enabling terminal sandbox', 'x'); s = $null; m = 'mil_sandbox_nepornit' }
    )
    foreach ($k in $cazuri) {
      $script:jurSonda = $k.js; $script:jurRulare = $k.jr; $script:sonda = $k.s; $id = RunIdTest
      Refuza { InvokeMil 'C:\x\agy.exe' 'claude-opus-4-6-thinking' $brief 300 '' $baza $id @() } $k.m
      if (Test-Path -LiteralPath (Join-Path ([PawMilAcl]::Lunga($baza)) $id)) { throw ('copia a ramas dupa ' + $k.m) }
      if ($script:MilCopie) { throw ('stare ramasa dupa ' + $k.m) }
    }
    $script:jurSonda = $JS; $script:jurRulare = $JR; $script:sonda = $null
    [void](New-Item -ItemType Directory -Path "$script:profilFals\.gemini\config" -Force); [IO.File]::WriteAllText("$script:profilFals\.gemini\config\hooks.json", '{}')
    $script:apeluri.Clear()
    Refuza { InvokeMil 'C:\x\agy.exe' 'claude-opus-4-6-thinking' $brief 300 '' $baza (RunIdTest) @() } 'mil_config_refuzata'
    Egal $script:apeluri.Count 0 'niciun copil pornit cu hooks.json prezent'
    Refuza { InvokeMil 'C:\x\agy.exe' 'claude-opus-4-6-thinking' $brief 100 '' $baza (RunIdTest) @() } 'mil_config_refuzata'
    Remove-Item -LiteralPath "$script:profilFals\.gemini\config\hooks.json"
    Refuza { InvokeMil 'C:\x\agy.exe' 'claude-opus-4-6-thinking' $brief 100 '' $baza (RunIdTest) @() } 'mil_timp_insuficient_dupa_preflight'
    Refuza { InvokeMil 'C:\x\agy.exe' 'claude-opus-4-6-thinking' (Join-Path $rad 'nu-exista.md') 300 '' $baza (RunIdTest) @() } 'nu-exista.md'
  } finally { MilStergeCopie $false; Remove-Item -LiteralPath $rad -Recurse -Force }
}
Caz 'r3 (Jakarinos r2 P1): arbore neconfirmat oprit => copia ramane DOAR-CITIRE pe orice cale (succes, timeout la sonda, exceptie de oprire)' {
  $rad = DirTemp 'paw-mil-arb-'
  try {
    $script:profilFals = Join-Path $rad 'profil'; [void](New-Item -ItemType Directory -Path $script:profilFals)
    $brief = Join-Path $rad 'brief.md'; [IO.File]::WriteAllText($brief, 'B'); $baza = Join-Path $rad 'mil'
    $script:jurSonda = $JS; $script:jurRulare = $JR; $script:arboreGol = $false
    $cai = @(
      @{ n = 'iesire normala cu urmasi'; s = $null; m = $null },
      @{ n = 'sonda: timeout, arbore neoprit'; s = { param($c) @{ timeout = $true; exit = -1; out = 'IESIRE-SONDA-PARTIALA'; err = ''; treeStopped = $false } }; m = 'mil_sonda_timeout' },
      @{ n = 'sonda: exceptie de oprire'; s = { param($c) throw 'tree_kill_failed: proba' }; m = 'tree_kill_failed' }
    )
    foreach ($k in $cai) {
      $script:sonda = $k.s; $id = RunIdTest; $copie = Join-Path ([PawMilAcl]::Lunga($baza)) $id
      # r4 (decizie chat): arbore neconfirmat = PAW_EROARE mil_arbore_neoprit cu PID-urile ramase, si dupa o rulare reusita
      try { [void](InvokeMil 'C:\x\agy.exe' 'claude-opus-4-6-thinking' $brief 300 '' $baza $id @()); throw 'nu a refuzat' }
      catch {
        $msg = $_.Exception.Message
        if ($msg -notlike '*mil_arbore_neoprit (pid 4242; copia ramane doar-citire: *') { throw ('alt refuz: ' + $msg) }
        if ($k.m -and $msg -notlike ('*dupa: *' + $k.m + '*')) { throw ('motivul initial lipseste: ' + $msg) }
      }
      if (-not (Test-Path -LiteralPath $copie)) { throw ('copia a fost stearsa: ' + $k.n) }
      if (MilIncearca { [IO.File]::WriteAllText((Join-Path $copie 'dupa.txt'), 'x') }) { throw ('copia a redevenit scriibila: ' + $k.n) }
      if (-not (@($script:MilCopiiPastrate) | Where-Object { $_.dir -ceq $copie })) { throw ('copia nu e in MilCopiiPastrate: ' + $k.n) }
      if (-not (Test-Path -LiteralPath ($copie + '-agy'))) { throw ('jurnalele au fost sterse: ' + $k.n) }
    }
    if (-not ($script:MilDiagLinii | Where-Object { $_ -like '*sonda de pornire*IESIRE-SONDA-PARTIALA*' })) { throw 'stdout-ul sondei lipseste din diagnostic' }
    if (-not ($script:MilDiagLinii | Where-Object { $_ -like '*sonda RESPINSA*mil_sonda_timeout*' })) { throw 'motivul respingerii sondei lipseste din diagnostic' }
  } finally { $script:arboreGol = $true; $script:sonda = $null; CuratPastrate; MilStergeCopie $false; Remove-Item -LiteralPath $rad -Recurse -Force }
}
Caz 'r3 (Jakarinos r2 P2): rularea respinsa lasa in log motivul, coada jurnalului agy si iesirea procesului, inainte de stergere' {
  $rad = DirTemp 'paw-mil-diag-'
  try {
    $script:profilFals = Join-Path $rad 'profil'; [void](New-Item -ItemType Directory -Path $script:profilFals)
    $brief = Join-Path $rad 'brief.md'; [IO.File]::WriteAllText($brief, 'B'); $baza = Join-Path $rad 'mil'
    # r4 (Jakarinos r3 P2): jurnal LUNG (30 de linii de 200 de caractere, ca in scenariul lui) + stdout + stderr
    $lungi = (1..40 | ForEach-Object { 'I1109 x.go:1] ' + ('linie lunga ' * 16) }) -join "`n"
    $script:jurSonda = $JS; $script:jurRulare = ($JR -replace 'enabling terminal sandbox', 'x') + "`n" + $lungi + "`nI1109 ultima.go:1] LINIE-DIN-COADA"; $script:sonda = $null
    $script:errRulare = 'EROARE-STD-DIN-RULARE'
    $n0 = $script:MilDiagLinii.Count; $id = RunIdTest
    Refuza { InvokeMil 'C:\x\agy.exe' 'claude-opus-4-6-thinking' $brief 300 '' $baza $id @() } 'mil_sandbox_nepornit'
    $noi = @($script:MilDiagLinii | Select-Object -Skip $n0)
    foreach ($p in @(@('rulare RESPINSA / motiv ---', 'mil_sandbox_nepornit'), @('rulare RESPINSA / jurnal (coada) ---', 'LINIE-DIN-COADA'),
                     @('rulare RESPINSA / stdout ---', 'RASPUNS'), @('rulare RESPINSA / stderr ---', 'EROARE-STD-DIN-RULARE'))) {
      if (-not ($noi | Where-Object { $_.Contains($p[0]) -and $_.Contains($p[1]) })) { throw ('lipseste din diagnostic: ' + $p[0] + ' ' + $p[1]) }
    }
    if (Test-Path -LiteralPath (Join-Path ([PawMilAcl]::Lunga($baza)) $id)) { throw 'copia a ramas (arbore gol)' }
  } finally { $script:jurRulare = $JR; $script:errRulare = ''; MilStergeCopie $false; Remove-Item -LiteralPath $rad -Recurse -Force }
}
Caz 'r3/r4: InvokeMil verifica arborele (MilArboreGol) dupa orice iesire, INAINTE de MilStergeCopie; neconfirmat = throw cu PID-uri' {
  $def = [IO.File]::ReadAllText((Join-Path $pachet 'mil.ps1'))
  $i = $def.IndexOf('function InvokeMil'); $f = $def.IndexOf('} catch { $eroare = $_ }', $i)
  $g = $def.IndexOf('$arb = MilArboreGol', $f); $s = $def.IndexOf('MilStergeCopie (-not $arb.gol)', $f); $t = $def.IndexOf("throw `$m", $s)
  if ($f -lt 0 -or $g -lt 0 -or $s -lt 0 -or $t -lt 0 -or $g -gt $s) { throw 'ordinea dupa iesirea din try' }
  if ($def.IndexOf('treeStopped', $i) -ge 0) { throw 'curatarea depinde inca de $rez.treeStopped' }
  $rp = [IO.File]::ReadAllText((Join-Path $pachet 'run_paw.ps1'))
  if ($rp.IndexOf('public static uint[] Pids()') -lt 0) { throw 'PawV43.Job::Pids lipseste' }
  $m = [IO.File]::ReadAllText((Join-Path $pachet 'mil.ps1'))
  foreach ($s2 in @('[PawV43.Job]::Pids()', '[PawV43.Job]::StopChildren(', 'Wait-Process -Id $pids -Timeout')) { if ($m.IndexOf($s2) -lt 0) { throw ('MilArboreGol fara: ' + $s2) } }
}
Remove-Item Function:\AssertMilExe, Function:\AssertMilGazda, Function:\AssertMilMediu, Function:\MilMediu, Function:\MilArboreGol -ErrorAction SilentlyContinue
. (Join-Path $pachet 'mil.ps1')   # functiile reale din nou

Caz 'AssertMilExe: fisier nesemnat si semnatar strain refuzate; agy.exe real (daca exista) acceptat' {
  $nesemnat = Join-Path $TMP ('paw-mil-nesemnat-' + [guid]::NewGuid().ToString('N') + '.exe')
  [IO.File]::WriteAllBytes($nesemnat, [byte[]](0x4D, 0x5A, 0, 0))
  try { Refuza { AssertMilExe $nesemnat } 'mil_semnatura_invalida' } finally { Remove-Item -LiteralPath $nesemnat -Force }
  # fisierele din System32 au de obicei mai multe hardlink-uri (WinSxS): refuz inainte de semnatura
  Refuza { AssertMilExe (Join-Path $env:SystemRoot 'System32\notepad.exe') } 'cdx_hardlink_refused'
  # semnatura valida, dar alt semnatar: copia unui exe cu semnatura incorporata (node.exe, OpenJS Foundation)
  $strain = 'C:\Program Files\nodejs\node.exe'
  if (Test-Path -LiteralPath $strain) {
    $copie = Join-Path $TMP ('paw-mil-strain-' + [guid]::NewGuid().ToString('N') + '.exe')
    Copy-Item -LiteralPath $strain -Destination $copie
    try { Refuza { AssertMilExe $copie } 'mil_semnatar_neasteptat' } finally { Remove-Item -LiteralPath $copie -Force }
  } else { Write-Host '  (node.exe lipsa: cazul semnatar strain omis)' }
  if (Test-Path -LiteralPath $EXE) { AssertMilExe $EXE } else { Write-Host '  (agy.exe lipsa pe aceasta masina: ramura pozitiva omisa)' }
}
Caz 'AssertMilGazda: pe aceasta masina (neelevat, build >= 26100) trece; build-ul minim e 24H2' {
  Egal $MIL_BUILD_MIN 26100 'build minim'
  AssertMilGazda
}

# Refuzurile de cale ale lansatorului (CaleSigura, comuna cu jak/gem/cop), extrasa prin AST din run_paw.ps1.
$def = $ast.FindAll({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'CaleSigura' }, $true) | Select-Object -First 1
. ([scriptblock]::Create($def.Extent.Text))
Caz 'CaleSigura: UNC, ADS, ghilimele, in afara radacinii si junction refuzate; cale buna acceptata' {
  $rad = DirTemp 'paw-mil-rad-'
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

Caz 'run_paw.ps1: ordinea pe canalul mil (validare -> Job -> lock_mil -> InvokeMil cu copia, nu repo-ul) si refuzurile la final' {
  $txt = [IO.File]::ReadAllText((Join-Path $pachet 'run_paw.ps1'))
  $iVal = $txt.IndexOf("if (`$Cine -eq 'mil') {"); $iStart = $txt.IndexOf('Set-Content -LiteralPath $script:OutFull -Value ("PAW_START')
  if ($iVal -lt 0 -or $iVal -gt $iStart -or $txt.IndexOf('AssertMilExe $T.exe', $iVal) -gt $iStart -or $txt.IndexOf('AssertMilGazda', $iVal) -gt $iStart) { throw 'validarea mil nu e inainte de PAW_START' }
  $iCaz = $txt.IndexOf('"mil" {'); $iJob = $txt.IndexOf('LeagaCopiiiDeLansator', $iCaz); $iLock = $txt.IndexOf("LuaLock (Join-Path `$DATA 'lock_mil')", $iCaz); $iInv = $txt.IndexOf('InvokeMil ', $iCaz)
  if (-not ($iCaz -gt 0 -and $iCaz -lt $iJob -and $iJob -lt $iLock -and $iLock -lt $iInv)) { throw 'ordinea Job/lock/InvokeMil' }
  $apel = $txt.Substring($iInv, $txt.IndexOf("`n", $iInv) - $iInv)
  if ($apel -match '\$REPO' -or $apel -notmatch [regex]::Escape("(Join-Path `$DATA 'mil') `$RUNID")) { throw ('InvokeMil nu foloseste copia: ' + $apel) }
  foreach ($s in @("Eroare ('mil_exit_' + `$rez.exit)", "Eroare 'mil_raspuns_gol'", 'permis: jak, cop, ollie, gem, cdx, mil', "if (`$Imagini -and `$Cine -eq 'mil')")) { if ($txt.IndexOf($s) -lt 0) { throw ('lipseste: ' + $s) } }
  if ($txt -match '--mode\s+accept|dangerously-skip|--mode\s+auto') { throw 'mod de scriere in lansator' }
  # codul din mil.ps1 (fara liniile de comentariu): niciun flag de scriere / auto-aprobare / setari ghicite
  $cod = (@([IO.File]::ReadAllLines((Join-Path $pachet 'mil.ps1')) | Where-Object { $_.TrimStart() -notlike '#*' })) -join "`n"
  if ($cod -match 'dangerously-skip-permissions|accept-edits|--mode\s*.?auto|--settings|remote-control|remote-agent') { throw 'flag nepermis in mil.ps1' }
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
