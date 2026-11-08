# autotest_punti.ps1 - teste FARA retea pentru puntile v2 (08.11.2026, Rocky/redari@).
# Ruleaza: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\server\punti\autotest_punti.ps1
# Acopera: detectia "deconectat > 10 min", limita de reporniri, lipsa tokenului / mediul curatat, internet picat, login + alarma,
#          punte veche (fara dubluri), mascarea textelor, plus un test de integrare cu procese reale (releu + punte FALSA,
#          fara claude.exe, fara retea) si doi relee concurente pe acelasi mutex. -FaraProcese sare peste partea cu procese.
# Liniile de test sunt copiate din iesirea reala a CLI 2.1.319 (log-urile puntilor de pe server, cu id-uri inlocuite) si
# din textele CLI-ului ("Reconnecting . retrying in X . disconnected Y", "Error: ... claude remote-control ..."), nu generate de codul testat (L25).
# Fisier ASCII: caracterele speciale se construiesc cu [char].
param([switch]$FaraProcese)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'punti_lib.ps1')

$script:ok = 0; $script:esec = 0
function Verifica([string]$Nume, [bool]$Conditie, [string]$Detalii = '') {
  if ($Conditie) { $script:ok++; Write-Output "  ok   $Nume" } else { $script:esec++; Write-Output "  ESEC $Nume $Detalii" }
}
$E = [string][char]27; $BEL = [string][char]7; $B = [string][char]0xB7; $CK = [string][char]0x2714 + [string][char]0xFE0E; $EM = [string][char]0x2014
$PrefixTok = 'sk-' + 'ant-' + 'oat01-'   # tokenuri FALSE de test, construite din bucati
$T0 = New-Object DateTime 2026, 11, 8, 12, 0, 0, ([DateTimeKind]::Utc)
$Tmp = Join-Path ([IO.Path]::GetTempPath()) ('punti_autotest_' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $Tmp | Out-Null
$Cfg = @(Get-ConfigPunti)
$Chat = $Cfg | Where-Object { $_.Nume -eq 'chat' }

# ---------------------------------------------------------------------------------------------------------------------------
Write-Output 'T1 clasificarea liniilor reale ale puntii'
$L = @{
  connecting = "$B|$B Connecting $B pontaj-pro $B main"
  connected  = "$E[1A$E[J$B$CK$B Connected $B pontaj-pro $B main"
  ready      = "$E[7A$E[J$B$CK$B Ready $B pontaj-pro $B main"
  capacity   = "    Capacity: 1/32 $B New sessions will be created in the current directory"
  link       = "    $E]8;;https://claude.ai/code/session_TEST0123456789?from=cli${BEL}DE ARHIVAT $EM Chat server AI $EM 05.1$E]8;;$BEL"
  sessfail   = "$E[8A$E[J[15:32:56] Session failed: Process exited with error cse_TEST0123456789"
  reconn     = "$E[7A$E[J$B|$B Reconnecting $B retrying in 4s $B disconnected 12m 5s"
  reconnS    = "$B/$B Reconnecting $B retrying in 2s $B disconnected 45s"
  errFatal   = "[23:10:01] Error: Remote Control could not renew this environment's credential after repeated attempts. Restart ``claude remote-control`` to start fresh."
  errGiveUp  = "[23:10:01] Error: Server unreachable for 10 minutes, giving up."
  errSpawn   = "[23:10:01] Error: Failed to spawn session cse_TEST0123456789: worktree busy"
  warnCred   = "[23:10:01] Warning: The server keeps rejecting this computer's Remote Control credential, so Remote Control will wait about 47 minutes before renewing it again. New sessions can't start here until the server accepts it."
  reconnd    = "[23:12:40] Reconnected after 3m 2s"
  qr         = 'space to show QR code ' + $B + ' w to toggle spawn mode'
}
$c = Get-ClasaLinie $L.connecting; Verifica 'Connecting -> conectare' ($c.Tip -eq 'conectare') $c.Tip
$c = Get-ClasaLinie $L.connected; Verifica 'Connected (cu ESC[1A ESC[J) -> conectat' ($c.Tip -eq 'conectat') $c.Tip
$c = Get-ClasaLinie $L.ready; Verifica 'Ready -> conectat' ($c.Tip -eq 'conectat') $c.Tip
$c = Get-ClasaLinie $L.capacity; Verifica 'Capacity -> altceva' ($c.Tip -eq 'altceva') $c.Tip
$c = Get-ClasaLinie $L.link; Verifica 'link OSC 8 -> altceva, fara URL in text' ($c.Tip -eq 'altceva' -and $c.Text -notmatch 'https') $c.Text
$c = Get-ClasaLinie $L.sessfail; Verifica 'Session failed -> sesiune' ($c.Tip -eq 'sesiune') $c.Tip
$c = Get-ClasaLinie $L.reconn; Verifica 'Reconnecting 12m 5s -> reconectare, 725 s' ($c.Tip -eq 'reconectare' -and $c.Durata -eq 725) "$($c.Tip) $($c.Durata)"
$c = Get-ClasaLinie $L.reconnS; Verifica 'Reconnecting 45s -> 45 s' ($c.Tip -eq 'reconectare' -and $c.Durata -eq 45) "$($c.Durata)"
$c = Get-ClasaLinie $L.errFatal; Verifica 'Error "Restart claude remote-control" -> eroare fatala + credential' ($c.Tip -eq 'eroare' -and $c.Fatala -and $c.Credential) "$($c.Tip) $($c.Fatala)"
$c = Get-ClasaLinie $L.errGiveUp; Verifica 'Error "giving up" -> eroare fatala' ($c.Tip -eq 'eroare' -and $c.Fatala -and -not $c.Credential)
$c = Get-ClasaLinie $L.errSpawn; Verifica 'Error spawn -> eroare NEfatala' ($c.Tip -eq 'eroare' -and -not $c.Fatala)
$c = Get-ClasaLinie $L.warnCred; Verifica 'Warning credential -> avertizare + credential' ($c.Tip -eq 'avertizare' -and $c.Credential)
$c = Get-ClasaLinie $L.reconnd; Verifica 'Reconnected after -> reconectat' ($c.Tip -eq 'reconectat')
$c = Get-ClasaLinie $L.qr; Verifica 'linia QR -> altceva' ($c.Tip -eq 'altceva')
$c = Get-ClasaLinie 'Reconnected after 3m (fara ora) nu e eveniment'; Verifica 'negativ: text fara [HH:MM:SS] nu e eveniment' ($c.Tip -eq 'altceva') $c.Tip
$c = Get-ClasaLinie '[1:2:3] Error: x'; Verifica 'negativ: ora malformata nu e eveniment' ($c.Tip -ne 'eroare') $c.Tip
# titluri de sesiune (continut extern, indentate in blocul de stare) care imita evenimente/stari -> ignorate
$c = Get-ClasaLinie "    $E]8;;https://claude.ai/code/session_TEST0123456789?from=cli$BEL[10:00:00] Error: giving up.$E]8;;$BEL"
Verifica 'titlu de sesiune care imita o eroare fatala -> altceva' ($c.Tip -eq 'altceva') $c.Tip
$c = Get-ClasaLinie "    $E]8;;https://claude.ai/code/session_TEST0123456789?from=cli${BEL}Reconnecting $B retrying in 1s $B disconnected 2h$E]8;;$BEL"
Verifica 'titlu de sesiune care imita "Reconnecting ... disconnected 2h" -> altceva' ($c.Tip -eq 'altceva') $c.Tip
$c = Get-ClasaLinie "  [10:00:00] Warning: Remote Control credential (activitate indentata)"
Verifica 'linie indentata cu Warning credential -> altceva' ($c.Tip -eq 'altceva' -and -not $c.Credential) $c.Tip

Write-Output 'T2 durate'
Verifica '45s' ((ConvertFrom-DurataText '45s') -eq 45)
Verifica '1m 30s' ((ConvertFrom-DurataText '1m 30s') -eq 90)
Verifica '12m' ((ConvertFrom-DurataText '12m') -eq 720)
Verifica '1h 2m' ((ConvertFrom-DurataText '1h 2m') -eq 3720)
Verifica '500ms' ((ConvertFrom-DurataText '500ms') -eq 0.5)
Verifica '10 minutes' ((ConvertFrom-DurataText '10 minutes') -eq 600)
Verifica 'necunoscut -> null (nu 0)' ($null -eq (ConvertFrom-DurataText 'curand'))

Write-Output 'T3 starea din linii (succesiune reala)'
$S = New-StarePunte -Nume 'chat' -PidReleu 1 -StartReleu (Get-DataIso $T0) -Acum $T0
[void](Update-StareDinLinie $S (Get-ClasaLinie $L.connecting) $T0)
Verifica 'pornire -> conectare' ($S.stare -eq 'conectare')
$m = Update-StareDinLinie $S (Get-ClasaLinie $L.connected) $T0.AddSeconds(5)
Verifica 'conectare -> conectat, mesaj "conectata"' ($S.stare -eq 'conectat' -and @($m) -contains 'conectata') ($m -join '|')
$m = Update-StareDinLinie $S (Get-ClasaLinie $L.reconnS) $T0.AddMinutes(1)
Verifica 'conectat -> reconectare, stareDeLa = T0+1' ($S.stare -eq 'reconectare' -and (ConvertFrom-DataIso $S.stareDeLa) -eq $T0.AddMinutes(1))
[void](Update-StareDinLinie $S (Get-ClasaLinie $L.reconn) $T0.AddMinutes(13))
Verifica 'reconectare repetata pastreaza stareDeLa, actualizeaza durata' ((ConvertFrom-DataIso $S.stareDeLa) -eq $T0.AddMinutes(1) -and $S.deconectatSec -eq 725)
$m = Update-StareDinLinie $S (Get-ClasaLinie $L.reconnd) $T0.AddMinutes(14)
Verifica 'Reconnected -> conectat, durata 0' ($S.stare -eq 'conectat' -and $S.deconectatSec -eq 0)
[void](Update-StareDinLinie $S (Get-ClasaLinie $L.errFatal) $T0.AddMinutes(20))
[void](Update-StareDinLinie $S (Get-ClasaLinie $L.connected) $T0.AddMinutes(20))
Verifica 'eroarea fatala ramane marcata si dupa redesenarea "Connected"' ($S.eroareFatalaLa -and $S.credentialLa -and $S.ultimaEroare -match 'Restart')

# ---------------------------------------------------------------------------------------------------------------------------
Write-Output 'T4 detectia "deconectat > 10 min"'
function StareRec([double]$MinDeLa, [int]$Sec) {
  $s = New-StarePunte -Nume 'chat' -PidReleu 1 -StartReleu (Get-DataIso $T0) -Acum $T0.AddHours(-1)
  $s.stare = 'reconectare'; $s.stareDeLa = Get-DataIso $T0.AddMinutes(-$MinDeLa); $s.deconectatSec = $Sec
  return $s
}
function Dec($Stare, [bool]$Net = $true, [double]$Stabil = 30, $Valid = $true, $Rev = $null, $Ist = @(), [string]$Veche = '', [bool]$Releu = $true, [bool]$Cl = $true) {
  Get-DecizieSupraveghere -Punte $Chat -Stare $Stare -ReleuViu $Releu -ClaudeViu $Cl -Veche $Veche -InternetOk $Net -InternetStabilMin $Stabil -LoginValid $Valid -LoginRevalidatLa $Rev -Istoric $Ist -Acum $T0
}
$d = Dec (StareRec 11 0); Verifica 'reconectare de 11 min (ceasul nostru) -> reporneste' ($d.Actiune -eq 'reporneste') "$($d.Actiune) $($d.Motiv)"
$d = Dec (StareRec 9 0); Verifica 'reconectare de 9 min -> nimic' ($d.Actiune -eq 'nimic') $d.Actiune
$d = Dec (StareRec 1 725); Verifica 'puntea raporteaza "disconnected 12m 5s" -> reporneste' ($d.Actiune -eq 'reporneste') $d.Actiune
$d = Dec (StareRec 1 590); Verifica 'puntea raporteaza 9m 50s -> nimic' ($d.Actiune -eq 'nimic') $d.Actiune
$d = Dec (StareRec 11 0) -Stabil 2; Verifica 'internet revenit de 2 min -> asteapta (puntea se reconecteaza singura)' ($d.Actiune -eq 'asteapta') $d.Actiune
$s = New-StarePunte -Nume 'chat' -PidReleu 1 -StartReleu (Get-DataIso $T0) -Acum $T0.AddHours(-1); $s.stare = 'conectat'; $s.ultimaIesire = Get-DataIso $T0.AddHours(-5)
$d = Dec $s; Verifica 'tacere lunga fara semnal de eroare -> nimic (fara reporniri din euristici)' ($d.Actiune -eq 'nimic') $d.Actiune
$s = New-StarePunte -Nume 'chat' -PidReleu 1 -StartReleu (Get-DataIso $T0) -Acum $T0.AddHours(-1); $s.stare = 'conectat'; $s.eroareFatalaLa = Get-DataIso $T0.AddMinutes(-12)
$d = Dec $s; Verifica 'eroare fatala de 12 min, proces viu -> reporneste' ($d.Actiune -eq 'reporneste') $d.Motiv
$s.eroareFatalaLa = Get-DataIso $T0.AddMinutes(-3)
$d = Dec $s; Verifica 'eroare fatala de 3 min -> nimic (CLI-ul iese singur)' ($d.Actiune -eq 'nimic')
$s = New-StarePunte -Nume 'chat' -PidReleu 1 -StartReleu (Get-DataIso $T0) -Acum $T0.AddHours(-1); $s.stare = 'conectat'; $s.credentialLa = Get-DataIso $T0.AddMinutes(-15)
$d = Dec $s; Verifica 'credential respins de 15 min -> reporneste' ($d.Actiune -eq 'reporneste') $d.Motiv
$d = Dec $s -Valid $false; Verifica 'credential respins dar login expirat -> asteapta (repornirea nu ajuta)' ($d.Actiune -eq 'asteapta') $d.Motiv
$s = New-StarePunte -Nume 'chat' -PidReleu 1 -StartReleu (Get-DataIso $T0) -Acum $T0.AddHours(-2); $s.stare = 'conectat'
$d = Dec $s -Rev (Get-DataIso $T0.AddMinutes(-1)); Verifica 'login revalidat dupa pornirea puntii -> reporneste' ($d.Actiune -eq 'reporneste') $d.Motiv
$s.pornitLa = Get-DataIso $T0
$d = Dec $s -Rev (Get-DataIso $T0.AddMinutes(-1)); Verifica 'punte pornita dupa revalidare -> nimic' ($d.Actiune -eq 'nimic')

Write-Output 'T5 limita de reporniri (3/ora)'
$ist3 = @((Get-DataIso $T0.AddMinutes(-50)), (Get-DataIso $T0.AddMinutes(-30)), (Get-DataIso $T0.AddMinutes(-5)))
$d = Dec (StareRec 20 0) -Ist $ist3; Verifica '3 porniri in ultima ora -> asteapta + limita atinsa' ($d.Actiune -eq 'asteapta' -and $d.LimitaAtinsa) $d.Motiv
$d = Dec $null -Releu $false -Cl $false -Ist $ist3; Verifica 'limita se aplica si la pornirea puntii lipsa' ($d.Actiune -eq 'asteapta' -and $d.LimitaAtinsa)
$ist3b = @((Get-DataIso $T0.AddMinutes(-61)), (Get-DataIso $T0.AddMinutes(-30)), (Get-DataIso $T0.AddMinutes(-5)))
$d = Dec (StareRec 20 0) -Ist $ist3b; Verifica 'una din 3 e mai veche de 60 min -> reporneste' ($d.Actiune -eq 'reporneste') $d.Actiune
$r = Test-PotPorni -Istoric $ist3b -Acum $T0; Verifica 'istoricul curatat pastreaza doar ultima ora' ($r.Numar -eq 2)
$r = Test-PotPorni -Istoric @('gunoi', $null) -Acum $T0; Verifica 'istoric stricat -> ignorat, permis' ($r.Permis -and $r.Numar -eq 0)

Write-Output 'T6 lipsa tokenului si mediul puntii'
$pl = Get-PlanAutentificare -ExistaFisierToken $false -TokenTine $false
Verifica 'token lipsa + token netestat bun -> login normal + avertisment' (-not $pl.FolosesteToken -and $pl.Avertizare)
$pl = Get-PlanAutentificare -ExistaFisierToken $true -TokenTine $false
Verifica 'token prezent dar nu tine remote-control (test 08.11) -> NU se foloseste' (-not $pl.FolosesteToken -and $pl.Avertizare -match 'nu tine')
$pl = Get-PlanAutentificare -ExistaFisierToken $false -TokenTine $true
Verifica 'ipotetic: token bun dar fisier lipsa -> login normal + avertisment "lipseste"' (-not $pl.FolosesteToken -and $pl.Avertizare -match 'lipseste')
Verifica 'constanta din cod = rezultatul testului izolat (false)' ($script:TokenTineRemoteControl -eq $false)
$cur = @{ PATH = 'C:\x'; CLAUDE_CODE_OAUTH_TOKEN = ($PrefixTok + 'NUAPAREINLOG'); ANTHROPIC_API_KEY = 'k'; CLAUDECODE = '1'; CLAUDE_CODE_ENTRYPOINT = 'cli';
         CLAUDE_CONFIG_DIR = 'C:\Users\Gazpet-Ai\.claude-redari'; CLAUDE_CODE_GIT_BASH_PATH = 'C:\Git\bin\bash.exe'; USERPROFILE = 'C:\Users\Gazpet-Ai' }
$m = Get-MediuCopil -Curent $cur -NumePermanente @('Path', 'CLAUDE_CODE_GIT_BASH_PATH', 'CLAUDE_CODE_OAUTH_TOKEN') -ConfigDir ''
Verifica 'scoate CLAUDE_CODE_OAUTH_TOKEN si ANTHROPIC_API_KEY' (-not $m.Mediu.ContainsKey('CLAUDE_CODE_OAUTH_TOKEN') -and -not $m.Mediu.ContainsKey('ANTHROPIC_API_KEY'))
Verifica 'scoate CLAUDECODE/ENTRYPOINT mostenite din sesiune' (-not $m.Mediu.ContainsKey('CLAUDECODE') -and -not $m.Mediu.ContainsKey('CLAUDE_CODE_ENTRYPOINT'))
Verifica 'pastreaza CLAUDE_* setate permanent (GIT_BASH_PATH) si restul mediului' ($m.Mediu['CLAUDE_CODE_GIT_BASH_PATH'] -and $m.Mediu['PATH'] -eq 'C:\x' -and $m.Mediu['USERPROFILE'])
Verifica 'config implicit: CLAUDE_CONFIG_DIR mostenit e scos' (-not $m.Mediu.ContainsKey('CLAUDE_CONFIG_DIR'))
Verifica 'avertisment pentru tokenul setat permanent, fara valoarea lui' (@($m.Avertizari).Count -eq 1 -and (@($m.Avertizari) -join ' ') -notmatch 'NUAPARE')
$m = Get-MediuCopil -Curent $cur -NumePermanente @() -ConfigDir 'C:\Users\Gazpet-Ai\.claude-redari'
Verifica 'redari: CLAUDE_CONFIG_DIR setat explicit' ($m.Mediu['CLAUDE_CONFIG_DIR'] -eq 'C:\Users\Gazpet-Ai\.claude-redari')

Write-Output 'T7 mascarea textelor (fara secrete in jurnal)'
$t = Format-Sigur ("[23:10:01] Error: token $($PrefixTok)AbC_dEf-123 pentru test.user@example.com la https://claude.ai/code/session_01ABCDEFGHIJ?x=1 cse_01TESTTESTTESTTEST0000 " + ('Z' * 50))
Verifica 'mascheaza token, email, URL, id sesiune, sir lung' ($t -notmatch 'AbC_dEf' -and $t -notmatch 'example\.com' -and $t -notmatch 'https' -and $t -notmatch 'TESTTESTTEST' -and $t -notmatch 'ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ') $t
Verifica 'scurteaza la 300 + ...' ((Format-Sigur ('a ' * 400)).Length -le 303)

# ---------------------------------------------------------------------------------------------------------------------------
Write-Output 'T8 login si alarma'
$j = '{"loggedIn":true,"authMethod":"claude.ai","loginExpiresAt":"2026-12-08T02:29:54.820Z","email":"x"}'
$st = Get-StareLoginDinJson $j $T0; Verifica 'login valid, expira 08.12' ($st.Valid -eq $true -and $st.ExpiraLa -eq (New-Object DateTime 2026, 12, 8, 2, 29, 54, 820, ([DateTimeKind]::Utc)))
$st = Get-StareLoginDinJson '{"loggedIn":true,"authMethod":"claude.ai","loginExpiresAt":"2026-11-08T11:59:59Z"}' $T0; Verifica 'loginExpiresAt in trecut -> invalid (timestamp exact)' ($st.Valid -eq $false)
$st = Get-StareLoginDinJson '{"loggedIn":false}' $T0; Verifica 'loggedIn false -> invalid' ($st.Valid -eq $false)
$st = Get-StareLoginDinJson '{"loggedIn":true,"authMethod":"oauth_token"}' $T0; Verifica 'logare prin token (nu claude.ai) -> invalid pentru remote-control' ($st.Valid -eq $false)
$st = Get-StareLoginDinJson 'Error: ceva' $T0; Verifica 'raspuns stricat -> NECUNOSCUT (null), nu invalid' ($null -eq $st.Valid -and $st.Eroare)
$st = Get-StareLoginDinJson '' $T0; Verifica 'raspuns gol -> necunoscut' ($null -eq $st.Valid)
$con = @{ 'implicit' = @{ Valid = $true; ExpiraLa = (Get-DataIso $T0.AddDays(4)) }; 'c:\users\gazpet-ai\.claude-redari' = @{ Valid = $true; ExpiraLa = (Get-DataIso $T0.AddDays(26)) } }
$a = Get-TextAlarmaLogin -Conturi $con -Config $Cfg -Acum $T0
Verifica 'alarma la 4 zile: doar contul principal' ($a -match 'EXPIRA CURAND' -and $a -match 'contul principal' -and $a -notmatch 'redari\)') $a
$con['implicit'].ExpiraLa = Get-DataIso $T0.AddDays(6)
Verifica 'la 6 zile: fara alarma' ($null -eq (Get-TextAlarmaLogin -Conturi $con -Config $Cfg -Acum $T0))
$con['c:\users\gazpet-ai\.claude-redari'].Valid = $false
$a = Get-TextAlarmaLogin -Conturi $con -Config $Cfg -Acum $T0
Verifica 'login invalid redari: EXPIRAT + comanda cu CLAUDE_CONFIG_DIR' ($a -match 'EXPIRAT' -and $a -match "CLAUDE_CONFIG_DIR='c:\\users\\gazpet-ai\\.claude-redari'") $a
Verifica 'alarma fara emailuri' ($a -notmatch '@')
$d = Dec $null -Releu $false -Cl $false -Valid $false; Verifica 'punte lipsa + login invalid -> asteapta, nu porneste' ($d.Actiune -eq 'asteapta') $d.Motiv
$d = Dec $null -Releu $false -Cl $false -Valid $null; Verifica 'punte lipsa + login necunoscut -> porneste (necunoscut != invalid)' ($d.Actiune -eq 'porneste') $d.Motiv

Write-Output 'T9 punte veche si internet picat (decizii)'
$d = Dec $null -Releu $false -Cl $false -Veche 'bucla cmd veche'; Verifica 'punte veche activa -> nimic (fara dubluri)' ($d.Actiune -eq 'nimic' -and $d.Motiv -match 'veche')
$d = Dec $null -Releu $false -Cl $false -Net $false; Verifica 'punte lipsa + fara internet -> asteapta' ($d.Actiune -eq 'asteapta' -and $d.Motiv -match 'internet')
$d = Dec (StareRec 30 1800) -Net $false; Verifica 'deconectata 30 min + fara internet -> asteapta' ($d.Actiune -eq 'asteapta')
$d = Dec $null -Releu $true -Cl $false; Verifica 'releu viu fara punte -> reporneste' ($d.Actiune -eq 'reporneste')
$d = Dec $null -Releu $false -Cl $true; Verifica 'releu mort, punte vie (orfana) -> reporneste, NU porneste (r1 P1: fara dublura)' ($d.Actiune -eq 'reporneste' -and $d.Motiv -match 'releul a murit') $d.Actiune
$inst = @(
  [pscustomobject]@{ ProcessId = 4644; ParentProcessId = 2720; Name = 'cmd.exe'; CommandLine = '"cmd.exe" /c C:\Users\Public\claude-server\start_claude_rc_redari.cmd'; CreationDate = $T0 }
  [pscustomobject]@{ ProcessId = 18608; ParentProcessId = 4644; Name = 'claude.exe'; CommandLine = '"C:\x\claude.exe"    remote-control --name "Redari - server AI" --spawn=worktree'; CreationDate = $T0 }
  [pscustomobject]@{ ProcessId = 28900; ParentProcessId = 18608; Name = 'claude.exe'; CommandLine = 'C:\x\claude.exe --print --sdk-url https://api.anthropic.com/v1/code/sessions/cse_X --session-id cse_X'; CreationDate = $T0 }
  [pscustomobject]@{ ProcessId = 5000; ParentProcessId = 1; Name = 'claude.exe'; CommandLine = '"C:\x\claude.exe" remote-control --name "Chat - server AI"'; CreationDate = $T0 }
)
$red = $Cfg | Where-Object { $_.Nume -eq 'redari' }; $mod = $Cfg | Where-Object { $_.Nume -eq 'module' }
Verifica 'bucla cmd redari detectata' ((Get-PunteVeche -Punte $red -Instantaneu $inst -DirV1 '' -PidExclus @()) -match 'bucla cmd')
Verifica 'start_claude_rc.cmd (module) NU se confunda cu _redari' ($null -eq (Get-PunteVeche -Punte $mod -Instantaneu $inst -DirV1 '' -PidExclus @()))
Verifica 'claude remote-control "Chat - server AI" strain -> veche' ((Get-PunteVeche -Punte $Chat -Instantaneu $inst -DirV1 '' -PidExclus @()) -match 'PID 5000')
Verifica 'acelasi proces, dar e al releului nostru (exclus) -> nu e veche' ($null -eq (Get-PunteVeche -Punte $Chat -Instantaneu $inst -DirV1 '' -PidExclus @(5000)))
Verifica 'sesiunile copil (--print --sdk-url) nu sunt punti' ($null -eq (Get-PunteVeche -Punte $Chat -Instantaneu @($inst[2]) -DirV1 '' -PidExclus @()))
$v = @(Get-PuntiVechi -Punte $red -Instantaneu $inst -DirV1 '' -PidExclus @())
Verifica 'redari: o singura tinta de oprit (bucla; puntea ei e copilul buclei)' ($v.Count -eq 1 -and $v[0].Pid -eq 4644 -and $v[0].Tip -eq 'bucla-cmd') (($v | ForEach-Object { $_.Descriere }) -join '|')
$instV2 = @(
  [pscustomobject]@{ ProcessId = 700; ParentProcessId = 1; Name = 'powershell.exe'; CommandLine = 'powershell.exe -NoProfile -File "C:\ProgramData\Gazpet\Punti\punte_releu.ps1" -Nume chat'; CreationDate = $T0 }
  [pscustomobject]@{ ProcessId = 701; ParentProcessId = 700; Name = 'claude.exe'; CommandLine = '"C:\x\claude.exe" remote-control --name "Chat - server AI"'; CreationDate = $T0 }
)
Verifica 'puntea pornita de releul v2 nu e "veche" nici fara stare citita' ($null -eq (Get-PunteVeche -Punte $Chat -Instantaneu $instV2 -DirV1 '' -PidExclus @()))
$dirV1 = Join-Path $Tmp 'v1'; New-Item -ItemType Directory -Path $dirV1 | Out-Null
Set-Content -Path (Join-Path $dirV1 'gazpet-erp-chat.pid') -Value $PID
Verifica 'pid v1 catre un proces care nu e claude -> ignorat' ($null -eq (Get-PunteVeche -Punte $Chat -Instantaneu @() -DirV1 $dirV1 -PidExclus @()))
Set-Content -Path (Join-Path $dirV1 'gazpet-erp-chat.pid') -Value 'nu-e-numar'
Verifica 'pid v1 stricat -> ignorat' ($null -eq (Get-PunteVeche -Punte $Chat -Instantaneu @() -DirV1 $dirV1 -PidExclus @()))
$st = @(Get-Stramosi -Id 28900 -Instantaneu $inst)
Verifica 'stramosii sesiunii copil: punte + bucla cmd' (@($st | ForEach-Object { $_.ProcessId }) -join ',' -eq '18608,4644')
$pids = @(@(Get-Stramosi -Id 28900 -Instantaneu $inst) | ForEach-Object { [int]$_.ProcessId }) + @(28900)
Verifica 'expresia din instalator (-PreiaAcum): 2 stramosi -> lista de int, fara dubla impachetare (r1 P1)' ($pids.Count -eq 3 -and $pids[0] -is [int] -and ($pids -join ',') -eq '18608,4644,28900') ($pids -join ',')
$inst2 = @($inst) + @([pscustomobject]@{ ProcessId = 5001; ParentProcessId = 1; Name = 'claude.exe'; CommandLine = '"C:\x\claude.exe" remote-control --name "Chat - server AI"'; CreationDate = $T0 })
$v2 = @(Get-PuntiVechi -Punte $Chat -Instantaneu $inst2 -DirV1 '' -PidExclus @())
Verifica 'doua punti vechi pe aceeasi punte -> 2 elemente, fiecare cu identitate (Nume, StartIso)' ($v2.Count -eq 2 -and $v2[1].Pid -eq 5001 -and $v2[1].Nume -eq 'claude' -and (ConvertFrom-DataIso $v2[1].StartIso) -eq $T0) "$($v2.Count)"
$v0 = @(Get-PuntiVechi -Punte $mod -Instantaneu $inst -DirV1 '' -PidExclus @())
Verifica 'nicio punte veche -> tablou gol (Count 0)' ($v0.Count -eq 0)
Verifica 'proces din sesiune Claude detectat' (Test-InSesiuneClaude -Id 28900 -Instantaneu $inst)
Verifica 'proces din afara (bucla cmd) nu e in sesiune' (-not (Test-InSesiuneClaude -Id 4644 -Instantaneu $inst))

# ---------------------------------------------------------------------------------------------------------------------------
Write-Output 'T10 o rulare completa a supervizorului cu dependente false (internet picat -> revine; login; limita)'
# Lumea falsa sta in $script:W; blocurile de dependente o citesc prin $script: (fara GetNewClosure, ca sa vada functiile din lib).
function New-Lume {
  $l = @{ Net = $false; Login = @{}; Porniri = New-Object System.Collections.ArrayList; Opriri = New-Object System.Collections.ArrayList
          Jurnal = New-Object System.Collections.ArrayList; Sup = $null; Stari = @{}; Vii = @{}; Veche = @{}; Alarma = $null; LoginApeluri = 0 }
  foreach ($p in $Cfg) { $l.Login[(Get-CheieCont $p.ConfigDir)] = [pscustomobject]@{ Valid = $true; ExpiraLa = $T0.AddDays(20); Eroare = $null } }
  return $l
}
$script:W = New-Lume
$script:AcumTest = $T0
$Dp = @{
  Config = $Cfg
  PlanAutentificare = (Get-PlanAutentificare -ExistaFisierToken $true)
  Jurnal = { param($m) [void]$script:W.Jurnal.Add($m) }
  # dus-intors prin JSON, ca in productie (fisierul supervizor.json)
  CitesteStareSup = { if ($script:W.Sup) { ConvertTo-Hashtable (($script:W.Sup | ConvertTo-Json -Depth 8) | ConvertFrom-Json) } else { $null } }
  ScrieStareSup = { param($s) if ($script:W.ScriereEsueaza) { return $false }; $script:W.Sup = $s; $true }
  CitesteStarePunte = { param($p) $script:W.Stari[$p.Nume] }
  Procese = { param($p, $st) $v = $script:W.Vii[$p.Nume]; if ($v -is [string] -and $v -eq 'orfan') { @{ ReleuViu = $false; ClaudeViu = $true } } else { $b = [bool]$v; @{ ReleuViu = $b; ClaudeViu = $b } } }
  Veche = { param($p, $st) $script:W.Veche[$p.Nume] }
  Internet = { $script:W.Net }
  Login = { param($cfg) $script:W.LoginApeluri++; $script:W.Login[(Get-CheieCont $cfg)] }
  # o punte (re)pornita are stare noua, pornita "acum" (ca releul real)
  Porneste = { param($p)
    if ($script:W.PornireArunca -contains $p.Nume) { throw 'eroare simulata la pornire' }
    [void]$script:W.Porniri.Add($p.Nume); $script:W.Vii[$p.Nume] = $true
    $n = New-StarePunte -Nume $p.Nume -PidReleu 1 -StartReleu 'x' -Acum $script:AcumTest; $n.stare = 'conectat'; $script:W.Stari[$p.Nume] = $n
    @{ Ok = $true; Mesaj = 'fals' } }
  Opreste = { param($p, $st) [void]$script:W.Opriri.Add($p.Nume); -not $script:W.OprireEsueaza }
  ScrieAlarma = { param($t) $script:W.Alarma = $t; if ($t) { 'scris' } else { 'nimic' } }
}
function Ruleaza([int]$Min, [switch]$Dv) { $script:AcumTest = $T0.AddMinutes($Min); Invoke-Supervizor -Dep $Dp -Acum $script:AcumTest -DoarVerifica:$Dv }
function Cade([string]$Nume, [int]$DeLaMin) {
  $s = New-StarePunte -Nume $Nume -PidReleu 1 -StartReleu 'x' -Acum $T0.AddMinutes($DeLaMin - 1)
  $s.stare = 'reconectare'; $s.stareDeLa = Get-DataIso $T0.AddMinutes($DeLaMin); $script:W.Stari[$Nume] = $s
}
$W = $script:W
$W.Veche['redari'] = 'bucla cmd veche (test)'
[void](Ruleaza 0)
Verifica 'fara internet: nicio pornire' ($W.Porniri.Count -eq 0) ($W.Porniri -join ',')
Verifica 'avertismentul despre token scris o data' (@($W.Jurnal | Where-Object { $_ -match 'AVERTISMENT: puntile folosesc logarea normala' }).Count -eq 1)
$W.Net = $true
[void](Ruleaza 5)
Verifica 'internet revenit: pornite chat, module, ofertare; redari NU (punte veche)' ((($W.Porniri | Sort-Object) -join ',') -eq 'chat,module,ofertare') ($W.Porniri -join ',')
Verifica 'jurnal "internet revenit"' (@($W.Jurnal) -contains 'internet revenit')
Verifica 'stare supervizor salvata cu istoricul pornirii' (@($W.Sup.istoric['chat']).Count -eq 1)
[void](Ruleaza 10)
Verifica 'rulare idempotenta: nimic nou pornit' ($W.Porniri.Count -eq 3)
Verifica 'mesajul "punte veche" nu se repeta mai des de o ora' (@($W.Jurnal | Where-Object { $_ -match 'punte veche' }).Count -eq 1)
# chat cade de 3 ori la rand: repornita la 16 si 21 (cu pornirea de la 5 = 3 in ora), refuzata la 26 si 31, din nou la 66
Cade 'chat' 1; [void](Ruleaza 16)
Verifica 'deconectata 15 min -> oprire + pornire' ($W.Opriri.Count -eq 1 -and $W.Porniri.Count -eq 4) "$($W.Opriri.Count) $($W.Porniri.Count)"
Cade 'chat' 6; [void](Ruleaza 21)
Verifica 'a treia pornire a chat-ului in ora (5, 16, 21)' ($W.Opriri.Count -eq 2 -and @($W.Porniri | Where-Object { $_ -eq 'chat' }).Count -eq 3)
Cade 'chat' 11; [void](Ruleaza 26)
Verifica 'a patra in aceeasi ora -> refuzata' ($W.Opriri.Count -eq 2) "$($W.Opriri.Count)"
Verifica 'avertisment de limita in jurnal' (@($W.Jurnal | Where-Object { $_ -match 'AVERTISMENT \[chat\].*limita' }).Count -eq 1)
[void](Ruleaza 31)
Verifica 'tot refuzata la 31, avertismentul nu se repeta in ora' ($W.Opriri.Count -eq 2 -and @($W.Jurnal | Where-Object { $_ -match 'AVERTISMENT \[chat\].*limita' }).Count -eq 1)
[void](Ruleaza 66)
Verifica 'dupa ce iese pornirea de la 5 din fereastra: reporneste iar' ($W.Opriri.Count -eq 3) "$($W.Opriri.Count)"
# login: principalul expira, apoi e reinnoit
$W.Login['implicit'] = [pscustomobject]@{ Valid = $false; ExpiraLa = $T0.AddMinutes(60); Eroare = $null }
Cade 'module' 120
[void](Ruleaza 130)
Verifica 'login invalid -> rand in jurnal + alarma scrisa' ((@($W.Jurnal | Where-Object { $_ -cmatch 'LOGIN EXPIRAT' }).Count -eq 1) -and $W.Alarma -match 'EXPIRAT') (($W.Jurnal | Select-Object -Last 8) -join ' || ')
Verifica 'login invalid: puntea picata NU e repornita degeaba' ($W.Opriri.Count -eq 3)
$W.Stari['module'].stare = 'conectat'
$W.Login['implicit'] = [pscustomobject]@{ Valid = $true; ExpiraLa = $T0.AddDays(365); Eroare = $null }
$op0 = $W.Opriri.Count
[void](Ruleaza 135)
Verifica 'login reinnoit -> cele 3 punti ale contului principal repornite' (($W.Opriri.Count - $op0) -eq 3) "$($W.Opriri.Count - $op0)"
Verifica 'jurnal "login valid din nou"' (@($W.Jurnal | Where-Object { $_ -match 'login valid din nou' }).Count -eq 1)
Verifica 'alarma stearsa dupa reinnoire' ($null -eq $W.Alarma)
$apel = $W.LoginApeluri
[void](Ruleaza 140)
Verifica 'dupa reinnoire nu mai reporneste (punti pornite dupa revalidare)' (($W.Opriri.Count - $op0) -eq 3)
Verifica 'login valid: auth status NU la fiecare rulare (o data pe ora)' ($W.LoginApeluri -eq $apel) "$($W.LoginApeluri) vs $apel"
$W.Login['implicit'] = [pscustomobject]@{ Valid = $null; ExpiraLa = $null; Eroare = 'timeout auth status' }
[void](Ruleaza 200)
Verifica 'auth status esuat -> necunoscut: nu schimba Valid, rand de avertizare' ($W.Sup.conturi['implicit'].Valid -eq $true -and @($W.Jurnal | Where-Object { $_ -match 'nu pot citi starea login' }).Count -eq 1)
# reinnoire INAINTE de expirare: in fereastra de alarma, auth status la fiecare rulare; noul login -> repornire o singura data
$W.Login['implicit'] = [pscustomobject]@{ Valid = $true; ExpiraLa = $T0.AddMinutes(270).AddDays(3); Eroare = $null }
[void](Ruleaza 270)
Verifica 'expira peste 3 zile -> alarma EXPIRA CURAND' ($W.Alarma -match 'EXPIRA CURAND') $W.Alarma
$apel = $W.LoginApeluri; $op1 = $W.Opriri.Count
[void](Ruleaza 275)
Verifica 'in fereastra de alarma: auth status si la 5 min; fara repornire cat nu se schimba nimic' ($W.LoginApeluri -eq ($apel + 1) -and $W.Opriri.Count -eq $op1) "$($W.LoginApeluri) $($W.Opriri.Count)"
$W.Login['implicit'] = [pscustomobject]@{ Valid = $true; ExpiraLa = $T0.AddMinutes(280).AddDays(30); Eroare = $null }
[void](Ruleaza 280)
Verifica 'login reinnoit inainte de expirare -> cele 3 punti repornite, alarma stearsa' (($W.Opriri.Count - $op1) -eq 3 -and $null -eq $W.Alarma) "$($W.Opriri.Count - $op1)"
[void](Ruleaza 285)
Verifica 'o singura data' (($W.Opriri.Count - $op1) -eq 3)
$opDv = $W.Opriri.Count; $jDv = $W.Jurnal.Count; Cade 'chat' 320
$act = Ruleaza 340 -Dv
Verifica '-DoarVerifica intoarce deciziile fara efecte' (@($act).Count -ge 4 -and $W.Opriri.Count -eq $opDv -and $W.Jurnal.Count -eq $jDv -and (@($act) -join '|') -match 'chat: reporneste') (@($act) -join '|')
# --- remedieri r1 (Jakarinos): punte orfana, oprire neconfirmata, salvare esuata, exceptie la pornire ---
$W.PornireArunca = @(); $W.OprireEsueaza = $false; $W.ScriereEsueaza = $false
$o0 = $W.Opriri.Count; $p0 = $W.Porniri.Count
$W.Stari['chat'].stare = 'conectat'   # chat ramasese 'cazuta' din testul -DoarVerifica
$W.Vii['ofertare'] = 'orfan'
[void](Ruleaza 400)
Verifica 'releu mort + punte vie: oprire verificata, apoi releu nou' (($W.Opriri.Count - $o0) -eq 1 -and ($W.Porniri.Count - $p0) -eq 1 -and $W.Porniri[$W.Porniri.Count - 1] -eq 'ofertare')
$W.Vii['module'] = 'orfan'; $W.OprireEsueaza = $true; $o0 = $W.Opriri.Count; $p0 = $W.Porniri.Count
[void](Ruleaza 405)
Verifica 'oprire neconfirmata -> NU porneste alt releu (fara dublura)' (($W.Opriri.Count - $o0) -eq 1 -and ($W.Porniri.Count - $p0) -eq 0 -and @($W.Jurnal | Where-Object { $_ -match '\[module\] NU repornesc' }).Count -eq 1)
Verifica 'incercarea neconfirmata ramane in istoric (limita nu poate fi ocolita)' (@($W.Sup.istoric['module']) -contains (Get-DataIso $T0.AddMinutes(405)))
$W.OprireEsueaza = $false; $W.ScriereEsueaza = $true; $o0 = $W.Opriri.Count; $p0 = $W.Porniri.Count
[void](Ruleaza 410)
Verifica 'starea nu se poate salva -> nicio oprire/pornire (r1 P1)' (($W.Opriri.Count - $o0) -eq 0 -and ($W.Porniri.Count - $p0) -eq 0 -and @($W.Jurnal | Where-Object { $_ -match 'nu pot salva starea' }).Count -ge 1)
$W.ScriereEsueaza = $false; $W.PornireArunca = @('module'); Cade 'ofertare' 400; $p0 = $W.Porniri.Count
[void](Ruleaza 415)
Verifica 'exceptie la pornirea module: prinsa, rezervarea salvata inainte' ((@($W.Jurnal | Where-Object { $_ -match '\[module\] EROARE la \(re\)pornire' }).Count -eq 1) -and (@($W.Sup.istoric['module']) -contains (Get-DataIso $T0.AddMinutes(415))))
Verifica 'puntea urmatoare (ofertare) e tratata si dupa exceptia de la module' ($W.Porniri[$W.Porniri.Count - 1] -eq 'ofertare' -and ($W.Porniri.Count - $p0) -eq 1)
$W.PornireArunca = @()

Write-Output 'T11 fisierul de stare: dus-intors JSON (Windows PowerShell 5.1)'
$f = Join-Path $Tmp 'sup.json'
$W.Sup.istoric['chat'] = @((Get-DataIso $T0), (Get-DataIso $T0.AddMinutes(5))); $W.Sup.istoric['module'] = @((Get-DataIso $T0))
[void](Write-JsonAtomic $f $W.Sup)
$r = Read-JsonSigur $f
Verifica 'istoric = lista de texte ISO (nu {value,Count}), si cu un singur element' (@($r.istoric['chat']).Count -eq 2 -and @($r.istoric['module']).Count -eq 1 -and ($r.istoric['chat'] | Select-Object -First 1) -is [string] -and (ConvertFrom-DataIso ($r.istoric['chat'] | Select-Object -First 1))) (($r.istoric | ConvertTo-Json -Compress -Depth 5) + ' ' + ($W.Sup.istoric | ConvertTo-Json -Compress -Depth 5))
Verifica 'conturi pastrate' ($r.conturi['implicit'].Valid -eq $true)
Set-Content -Path $f -Value '{ stricat'
Verifica 'JSON stricat -> null (fara exceptie)' ($null -eq (Read-JsonSigur $f))

# ---------------------------------------------------------------------------------------------------------------------------
if (-not $FaraProcese) {
  Write-Output 'T12 integrare cu procese reale: releu + punte FALSA (fara claude.exe, fara retea)'
  $dirSt = Join-Path $Tmp 'stare'; $dirJ = Join-Path $Tmp 'jurnal'; $folder = Join-Path $Tmp 'folder'
  New-Item -ItemType Directory -Path $dirSt, $dirJ, $folder | Out-Null
  $fals = Join-Path $Tmp 'punte_falsa.ps1'
  $continut = @(
    '$E = [string][char]27; $B = [string][char]0xB7; $K = [string][char]0x2714 + [string][char]0xFE0E'
    '[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)'
    'function L($t) { [Console]::Out.WriteLine($t); [Console]::Out.Flush(); Start-Sleep -Milliseconds 30 }'
    'L ($B + "|" + $B + " Connecting " + $B + " pontaj-pro " + $B + " main")'
    'L ($E + "[1A" + $E + "[J" + $B + $K + $B + " Connected " + $B + " pontaj-pro " + $B + " main")'
    'L ("    " + $E + "]8;;https://claude.ai/code/session_TEST0123456789?from=cli" + [char]7 + "Attached" + $E + "]8;;" + [char]7)'
    'L ($E + "[7A" + $E + "[J" + $B + "|" + $B + " Reconnecting " + $B + " retrying in 4s " + $B + " disconnected 12m 5s")'
    'L "[23:10:01] Warning: The server keeps rejecting this computer''s Remote Control credential, so Remote Control will wait about 47 minutes"'
    'L "[23:10:02] Error: Server unreachable for 10 minutes, giving up."'
    'if ($env:CLAUDE_CODE_OAUTH_TOKEN) { L "[23:10:03] Error: TOKEN MOSTENIT" }'
    'if ($env:CLAUDE_CONFIG_DIR) { L ("[23:10:03] Info: config " + $env:CLAUDE_CONFIG_DIR) }'
    'if ($args.Count -gt 0) { Start-Sleep -Seconds ([int]$args[0]) }'
    '[Console]::Error.WriteLine("Error: test stderr pentru sk-ant-oat01-SECRET' + 'DETEST si cse_TEST0123456789")'
    'exit 3'
  )
  Set-Content -Path $fals -Value $continut -Encoding ASCII
  $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $releu = Join-Path $PSScriptRoot 'punte_releu.ps1'
  function Start-ReleuTest([string]$Nume, [string]$Asteapta = '0') {
    $a = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -Nume {1} -Folder "{2}" -Afisat "Test punte" -DirStare "{3}" -DirJurnal "{4}" -Claude "{5}" -TestScriptFals "{6}" -TestArg {7}' -f `
         $releu, $Nume, $folder, $dirSt, $dirJ, $ps, $fals, $Asteapta
    Start-Process -FilePath $ps -ArgumentList $a -WindowStyle Hidden -PassThru
  }
  $env:CLAUDE_CODE_OAUTH_TOKEN = $PrefixTok + 'TESTNUTREBUIESAAJUNGA'
  try { $r1 = Start-ReleuTest ('autotest-' + [guid]::NewGuid().ToString('N').Substring(0, 6)) } finally { Remove-Item Env:CLAUDE_CODE_OAUTH_TOKEN }
  $iesit = $r1.WaitForExit(60000)
  Verifica 'releul se termina cand puntea falsa iese' $iesit
  $fs = Get-ChildItem $dirSt -Filter '*.stare.json' | Select-Object -First 1
  $st = $null; if ($fs) { $st = Read-JsonSigur $fs.FullName }
  Verifica 'stare scrisa: oprit, cod 3' ($st -and $st.stare -eq 'oprit' -and $st.codIesire -eq 3) ($st | ConvertTo-Json -Compress)
  Verifica 'durata raportata de punte retinuta (725 s)' ($st -and $st.deconectatSec -eq 725)
  Verifica 'eroare fatala si credential marcate' ($st -and $st.eroareFatalaLa -and $st.credentialLa)
  Verifica 'ultima eroare = stderr mascat (fara token, fara id sesiune)' ($st -and $st.ultimaEroare -match 'test stderr' -and $st.ultimaEroare -notmatch 'SECRETDETEST' -and $st.ultimaEroare -notmatch 'TEST0123456789')
  $jt = ''; if (Test-Path (Join-Path $dirJ 'punti.log')) { $jt = [IO.File]::ReadAllText((Join-Path $dirJ 'punti.log')) }
  Verifica 'jurnal: pornita, conectata, deconectata, oprita' ($jt -match 'punte pornita' -and $jt -match '\] conectata' -and $jt -match 'deconectata' -and $jt -match 's-a oprit \(cod 3\)') $jt
  Verifica 'tokenul din mediu NU a ajuns la punte' ($jt -notmatch 'TOKEN MOSTENIT')
  Verifica 'CLAUDE_CONFIG_DIR nu a ajuns la puntea cu config implicit' ($jt -notmatch 'Info: config')
  Verifica 'jurnal fara URL-uri, tokenuri, id-uri' ($jt -notmatch 'https://' -and $jt -notmatch 'oat01' -and $jt -notmatch 'TEST0123456789')
  Verifica 'fisierul ultimele.log scris' (@(Get-ChildItem $dirSt -Filter '*.ultimele.log').Count -eq 1)

  Write-Output 'T13 doua relee pe aceeasi punte (mutex): al doilea iese fara sa porneasca a doua punte'
  $nume2 = 'autotest-' + [guid]::NewGuid().ToString('N').Substring(0, 6)
  $a1 = Start-ReleuTest $nume2 '6'
  $sf = Join-Path $dirSt "$nume2.stare.json"
  for ($i = 0; $i -lt 40 -and -not ((Read-JsonSigur $sf) -and (Read-JsonSigur $sf).pidClaude -gt 0); $i++) { Start-Sleep -Milliseconds 250 }
  $a2 = Start-ReleuTest $nume2 '6'
  $ok2 = $a2.WaitForExit(30000)
  Verifica 'al doilea releu iese repede cu cod 3 (deja activ)' ($ok2 -and $a2.ExitCode -eq 3) "cod $($a2.ExitCode)"
  $st1 = Read-JsonSigur $sf
  Verifica 'starea apartine tot primului releu' ($st1 -and [int]$st1.pidReleu -eq $a1.Id)
  Verifica 'identitate verificata: PID corect + ora pornirii -> gasit' ($null -ne (Get-ProcesVerificat -Id $a1.Id -Nume 'powershell' -StartIso $st1.startReleu))
  Verifica 'identitate: ora pornirii diferita -> NU (PID refolosit)' ($null -eq (Get-ProcesVerificat -Id $a1.Id -Nume 'powershell' -StartIso (Get-DataIso $T0)))
  Verifica 'identitate: nume diferit -> NU' ($null -eq (Get-ProcesVerificat -Id $a1.Id -Nume 'claude' -StartIso $st1.startReleu))
  $oprit = Stop-ArboreVerificat -Id $a1.Id -Nume 'powershell' -StartIso $st1.startReleu
  Verifica 'oprirea verificata opreste releul si puntea falsa (arbore)' ($oprit -and $null -eq (Get-ProcesVerificat -Id ([int]$st1.pidClaude) -Nume 'powershell' -StartIso $st1.startClaude))
}

Remove-Item -LiteralPath $Tmp -Recurse -Force -ErrorAction SilentlyContinue
Write-Output ''
Write-Output ("AUTOTEST punti v2: {0} ok, {1} esuate" -f $script:ok, $script:esec)
if ($script:esec -gt 0) { exit 1 }
exit 0
