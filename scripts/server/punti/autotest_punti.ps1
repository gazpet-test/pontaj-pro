# autotest_punti.ps1 - teste FARA retea pentru puntile v3 (08.11.2026 / 25.11.2026, Rocky/redari@).
# Ruleaza: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\server\punti\autotest_punti.ps1
# Acopera: detectia "deconectat > 10 min", limita de reporniri, lipsa tokenului / mediul curatat, internet picat, login + alarma,
#          punte veche (fara dubluri), mascarea textelor, plus un test de integrare cu procese reale (releu + punte FALSA,
#          fara claude.exe, fara retea) si doi relee concurente pe acelasi mutex. -FaraProcese sare peste partea cu procese.
#          v3: clasificarea stderr-ului ("deja servit", "sesiune negasita", "mediu pierdut"), indicatorul CLI-ului
#          (bridge-pointer.json), reatasarea dupa ID (lume falsa + releu real), id lipsa/invalid -> comportamentul de azi.
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
$d = Dec $s; Verifica 'avertisment de credential de 15 min, singur -> nimic (CLI-ul reincearca singur; r2 P1)' ($d.Actiune -eq 'nimic') $d.Motiv
$d = Dec $s -Valid $false; Verifica 'avertisment de credential + login expirat -> nimic pe puntea vie (doar alarma)' ($d.Actiune -eq 'nimic') $d.Motiv
# succesiunea ceruta in r2: avertizare/eroare -> recuperare confirmata ("Reconnected") -> prag depasit => fara repornire
$s = New-StarePunte -Nume 'chat' -PidReleu 1 -StartReleu (Get-DataIso $T0) -Acum $T0.AddHours(-1)
[void](Update-StareDinLinie $s (Get-ClasaLinie $L.connected) $T0.AddMinutes(-30))
[void](Update-StareDinLinie $s (Get-ClasaLinie $L.warnCred) $T0.AddMinutes(-20))
[void](Update-StareDinLinie $s (Get-ClasaLinie $L.errFatal) $T0.AddMinutes(-19))
[void](Update-StareDinLinie $s (Get-ClasaLinie $L.connected) $T0.AddMinutes(-19))
$d = Dec $s; Verifica 'fara recuperare: eroare fatala de 19 min -> reporneste' ($d.Actiune -eq 'reporneste') $d.Motiv
[void](Update-StareDinLinie $s (Get-ClasaLinie $L.reconnd) $T0.AddMinutes(-15))
[void](Update-StareDinLinie $s (Get-ClasaLinie $L.connected) $T0.AddMinutes(-15))
$d = Dec $s; Verifica 'avertizare + eroare -> Reconnected -> 15 min mai tarziu: nimic (semnalele sterse)' ($d.Actiune -eq 'nimic' -and -not $s.eroareFatalaLa -and -not $s.credentialLa) $d.Motiv
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
Write-Output 'T14 v3: stderr-ul puntii (texte verbatim CLI 2.1.319)'
$c = Get-ClasaStderr 'Error: This folder is already served by another Claude Code on this device. Stop it first.'
Verifica '409 la inregistrare -> deja-servit' ($c.Tip -eq 'deja-servit' -and $null -eq $c.PidStrain) $c.Tip
$c = Get-ClasaStderr 'Error: Another `claude remote-control` instance (pid 36424) is already running in this directory. Exiting to avoid a split-brain conflict.'
Verifica 'alta instanta in folder -> deja-servit + pid' ($c.Tip -eq 'deja-servit' -and $c.PidStrain -eq 36424) "$($c.Tip) $($c.PidStrain)"
$c = Get-ClasaStderr 'Error: Environment env_01TEST0123456789 is already being served by another `claude remote-control` instance (pid 7696) in C:\x. Use that terminal, or stop it first.'
Verifica 'mediul sesiunii servit de alta instanta -> deja-servit + pid, text mascat' ($c.Tip -eq 'deja-servit' -and $c.PidStrain -eq 7696 -and $c.Text -notmatch 'TEST0123456789') $c.Text
$c = Get-ClasaStderr 'Exiting in about 50 seconds.'
Verifica '"Exiting in about" -> iesire-programata (nu e cauza)' ($c.Tip -eq 'iesire-programata') $c.Tip
$c = Get-ClasaStderr 'Error: Session session_01TEST0123456789 not found. It may have been archived or expired.'
Verifica 'sesiune negasita (arhivata/expirata)' ($c.Tip -eq 'sesiune-negasita' -and $c.Text -match '<session-id>') $c.Text
$c = Get-ClasaStderr 'Error: Session session_01TEST0123456789 has no environment_id. It may never have been attached to a bridge.'
Verifica 'sesiune fara environment_id -> sesiune-negasita' ($c.Tip -eq 'sesiune-negasita')
$c = Get-ClasaStderr 'Error: Invalid session ID "a b". Session IDs must not contain unsafe characters.'
Verifica 'id invalid -> sesiune-negasita' ($c.Tip -eq 'sesiune-negasita')
$c = Get-ClasaStderr 'Error: No recent session found in this directory or its worktrees. Run `claude remote-control` to start a new one.'
Verifica 'niciun indicator (--continue) -> sesiune-negasita' ($c.Tip -eq 'sesiune-negasita')
$c = Get-ClasaStderr 'Warning: Could not reuse the previous environment. Existing claude.ai/code sessions from the previous run will not reconnect.'
Verifica 'avertismentul "Could not reuse" -> mediu-pierdut' ($c.Tip -eq 'mediu-pierdut')
$c = Get-ClasaStderr 'Error: Could not reach the server to look up session session_01X. Check your network or run `claude /login`, then try again.'
Verifica 'alta eroare -> altceva (negativ: nu e sesiune-negasita)' ($c.Tip -eq 'altceva') $c.Tip
$c = Get-ClasaStderr '   '; Verifica 'linie goala -> gol' ($c.Tip -eq 'gol')
$s0 = New-StarePunte -Nume 'chat' -PidReleu 1 -StartReleu (Get-DataIso $T0) -Acum $T0
$m = @(Update-StareDinStderr $s0 (Get-ClasaStderr 'Error: This folder is already served by another Claude Code on this device. Stop it first.') $T0)
$m2 = @(Update-StareDinStderr $s0 (Get-ClasaStderr 'Exiting in about 50 seconds.') $T0.AddSeconds(1))
Verifica 'stare: dejaServit + ultimaEroare = cauza reala, nu numaratoarea' ($s0.dejaServit -and $s0.ultimaEroare -match 'already served' -and $m.Count -eq 1 -and $m2.Count -eq 0) "$($s0.ultimaEroare) | $($m -join '|')"
[void](Update-StareDinStderr $s0 (Get-ClasaStderr 'Warning: Could not reuse the previous environment. Existing claude.ai/code sessions from the previous run will not reconnect.') $T0.AddSeconds(2))
Verifica 'stare: mediuPierdutLa setat, ultimaEroare neschimbata, ultimele 2 linii retinute' ($s0.mediuPierdutLa -and $s0.ultimaEroare -match 'already served' -and @($s0.stderrUltimele).Count -eq 3)

Write-Output 'T15 v3: indicatorul CLI-ului (bridge-pointer.json)'
Verifica 'cheia proiectului ca la CLI' ((Get-CheieProiect 'C:\Users\Gazpet-Ai\gazpet-erp-chat') -eq 'C--Users-Gazpet-Ai-gazpet-erp-chat')
Verifica 'calea indicatorului: cont implicit' ((Get-CaleIndicator $Chat -DirConfigImplicit 'C:\Users\Gazpet-Ai\.claude') -eq 'C:\Users\Gazpet-Ai\.claude\projects\C--Users-Gazpet-Ai-gazpet-erp-chat\bridge-pointer.json')
$red = $Cfg | Where-Object { $_.Nume -eq 'redari' }
Verifica 'calea indicatorului: cont redari (CLAUDE_CONFIG_DIR)' ((Get-CaleIndicator $red -DirConfigImplicit 'C:\Users\Gazpet-Ai\.claude') -eq 'C:\Users\Gazpet-Ai\.claude-redari\projects\C--Users-Gazpet-Ai-gazpet-erp-redari\bridge-pointer.json')
# procStart real din indicatorul puntii chat de pe server (25.11.2026) = ora pornirii claude.exe din stare.json (134401117631176444)
$ps1 = ConvertFrom-ProcStart '134401117631176444'
Verifica 'procStart (FILETIME) -> 2026-11-25T20:22:43.1176444Z' ($ps1 -and (Get-DataIso $ps1) -eq '2026-11-25T20:22:43.1176444Z') (Get-DataIso $ps1)
Verifica 'procStart necitibil -> null' ($null -eq (ConvertFrom-ProcStart 'abc') -and $null -eq (ConvertFrom-ProcStart '12') -and $null -eq (ConvertFrom-ProcStart $null))
$indJson = '{"sessionId":"session_01TESTSESIUNE0001","environmentId":"env_01TESTMEDIU00001","source":"standalone","pid":32256,"procStart":"134401117631176444","activeSessionIds":["session_01TESTSESIUNE0002","nu e id","session_01TESTSESIUNE0001"]}'
$ind = ConvertFrom-Indicator -Obiect ($indJson | ConvertFrom-Json) -ScrisLa $T0
Verifica 'indicator normalizat: mediu, sesiune, pid, startIso, scrisLa' ($ind.mediu -eq 'env_01TESTMEDIU00001' -and $ind.sesiune -eq 'session_01TESTSESIUNE0001' -and $ind.pid -eq 32256 -and $ind.startIso -eq '2026-11-25T20:22:43.1176444Z' -and $ind.scrisLa -eq (Get-DataIso $T0)) ($ind | ConvertTo-Json -Compress)
Verifica 'activeSessionIds: doar id-urile sigure' ((@($ind.sesiuniActive) -join ',') -eq 'session_01TESTSESIUNE0002,session_01TESTSESIUNE0001')
Verifica 'indicator fara mediu sigur -> null' ($null -eq (ConvertFrom-Indicator -Obiect ('{"sessionId":"s","environmentId":"env 01"}' | ConvertFrom-Json) -ScrisLa $null))
Verifica 'Test-IdSigur: accepta session_/env_, refuza spatii, ghilimele, gol' ((Test-IdSigur 'session_01AbC-xyz') -and -not (Test-IdSigur 'a b') -and -not (Test-IdSigur 'x"y') -and -not (Test-IdSigur '') -and -not (Test-IdSigur 'ab'))
$fIndicator = Join-Path $Tmp 'bridge-pointer.json'
Set-Content -Path $fIndicator -Value $indJson -Encoding ASCII
$ind2 = Read-Indicator $fIndicator
Verifica 'Read-Indicator din fisier' ($ind2 -and $ind2.mediu -eq 'env_01TESTMEDIU00001' -and $ind2.scrisLa)
Verifica 'Read-Indicator fisier lipsa -> null' ($null -eq (Read-Indicator (Join-Path $Tmp 'nu-exista.json')))
# scriitorul indicatorului: viu, claude, aceeasi ora de pornire -> strain; altfel nu
$cautaViu = { param($i) @{ Nume = 'claude'; StartUtc = (New-Object DateTime 2026, 11, 25, 20, 22, 43, 117, ([DateTimeKind]::Utc)) } }
Verifica 'scriitor viu (claude, aceeasi ora) -> strain' ((Get-ScriitorIndicatorStrain -Indicator $ind -PidExclus @() -Cauta $cautaViu) -match 'PID 32256')
Verifica 'scriitorul e puntea noastra (exclus) -> nu e strain' ($null -eq (Get-ScriitorIndicatorStrain -Indicator $ind -PidExclus @(32256) -Cauta $cautaViu))
Verifica 'pid refolosit (alta ora de pornire) -> nu e strain' ($null -eq (Get-ScriitorIndicatorStrain -Indicator $ind -PidExclus @() -Cauta { param($i) @{ Nume = 'claude'; StartUtc = $T0 } }))
Verifica 'pid-ul nu e claude -> nu e strain' ($null -eq (Get-ScriitorIndicatorStrain -Indicator $ind -PidExclus @() -Cauta { param($i) @{ Nume = 'powershell'; StartUtc = $null } }))
Verifica 'pid mort -> nu e strain' ($null -eq (Get-ScriitorIndicatorStrain -Indicator $ind -PidExclus @() -Cauta { param($i) $null }))
$indFaraStart = @{ mediu = 'env_01X'; sesiune = $null; sesiuniActive = @(); pid = 5; startIso = $null }
Verifica 'fara procStart: se accepta dupa nume (claude)' ((Get-ScriitorIndicatorStrain -Indicator $indFaraStart -PidExclus @() -Cauta { param($i) @{ Nume = 'claude'; StartUtc = $null } }) -match 'PID 5')
Verifica 'argumente normale' ((Get-ArgumentePunte -Afisat 'Chat - server AI' -Spawn '' -SesiuneId '') -eq 'remote-control --name "Chat - server AI"')
Verifica 'argumente worktree' ((Get-ArgumentePunte -Afisat 'Redari - server AI' -Spawn 'worktree' -SesiuneId '') -eq 'remote-control --name "Redari - server AI" --spawn=worktree')
Verifica 'argumente reatasare: --session-id, fara --spawn si fara --name' ((Get-ArgumentePunte -Afisat 'Redari - server AI' -Spawn 'worktree' -SesiuneId 'session_01TESTSESIUNE0001') -eq 'remote-control --session-id session_01TESTSESIUNE0001')
$arunca = $false; try { [void](Get-ArgumentePunte -Afisat 'x' -Spawn '' -SesiuneId 'a b') } catch { $arunca = $true }
Verifica 'id nesigur la reatasare -> refuz (exceptie)' $arunca

Write-Output 'T16 v3: memoria puntii si pasii reatasarii (pure)'
$sup0 = @{}
$mem = Get-MemoriePunte -Sup $sup0 -Nume 'chat'
Verifica 'memorie noua: goala, hashtable-uri pentru negasite/renuntari' ($null -eq $mem.mediu -and $mem.negasite -is [hashtable] -and $sup0.punti['chat'] -eq $mem)
$mem.sesiune = 'session_01A'; $mem.sesiuniActive = @('session_01B', 'nu e id', 'session_01A', 'session_01C'); $mem.negasite['session_01B'] = 'x'; $mem.renuntari['session_01C'] = 'x'
Verifica 'candidati: principala intai, fara dubluri, fara negasite/renuntari/id-uri nesigure' ((@(Get-SesiuniDeReatasat $mem) -join ',') -eq 'session_01A')
$mem = Get-MemoriePunte -Sup @{} -Nume 'chat'
function StNorm([string]$Mediu, [int]$PidC = 1, [string]$Stare = 'conectat', [string]$Ses = 'session_01S1') {
  $s = New-StarePunte -Nume 'chat' -PidReleu 1 -StartReleu 'x' -Acum $T0.AddMinutes(-5); $s.stare = $Stare; $s.pidClaude = $PidC
  if ($Mediu) { $s.indicator = @{ mediu = $Mediu; sesiune = $Ses; sesiuniActive = @('session_01S2'); pid = $PidC; startIso = $null } }
  return $s
}
$m = @(Update-Reatasare -Mem $mem -Stare (StNorm 'env_01A') -Vie $true -Acum $T0)
Verifica 'prima data: adopta mediul si sesiunile puntii noastre, fara mesaj' ($mem.mediu -eq 'env_01A' -and $mem.sesiune -eq 'session_01S1' -and (@($mem.sesiuniActive) -contains 'session_01S2') -and $m.Count -eq 0) ($m -join '|')
$m = @(Update-Reatasare -Mem $mem -Stare (StNorm 'env_01A' 1 'conectat' 'session_01S1') -Vie $true -Acum $T0.AddMinutes(5))
Verifica 'acelasi mediu: nimic de spus' ($m.Count -eq 0 -and $null -eq $mem.reatasare)
$stStrain = StNorm 'env_01Z' 999; $stStrain.pidClaude = 1
$m = @(Update-Reatasare -Mem $mem -Stare $stStrain -Vie $true -Acum $T0.AddMinutes(6))
Verifica 'indicator scris de alt pid (nu puntea noastra): nu e pierdere de mediu' ($m.Count -eq 0 -and $null -eq $mem.reatasare -and $mem.mediu -eq 'env_01A')
$m = @(Update-Reatasare -Mem $mem -Stare (StNorm 'env_01B') -Vie $true -Acum $T0.AddMinutes(10))
Verifica 'mediu diferit la puntea noastra -> reatasare ceruta pentru sesiunea principala' ($mem.reatasare -and $mem.reatasare.pas -eq 'cerut' -and $mem.reatasare.sesiune -eq 'session_01S1' -and $mem.reatasare.mediuVechi -eq 'env_01A' -and $mem.reatasare.mediuNou -eq 'env_01B' -and ($m -join '|') -match 'Environment deleted') ($m -join '|')
Verifica 'memoria pastreaza mediul vechi pana la reatasare' ($mem.mediu -eq 'env_01A')
$d = Get-DecizieSupraveghere -Punte $Chat -Stare (StNorm 'env_01B') -ReleuViu $true -ClaudeViu $true -Veche '' -InternetOk $true -InternetStabilMin 30 -LoginValid $true -LoginRevalidatLa $null -Istoric @() -Acum $T0.AddMinutes(10) -Mem $mem -Strain ''
Verifica 'decizie: punte normala vie + reatasare ceruta -> reporneste in mod reatasare cu sesiunea' ($d.Actiune -eq 'reporneste' -and $d.Mod -eq 'reatasare' -and $d.Sesiune -eq 'session_01S1') "$($d.Actiune) $($d.Mod)"
$d = Get-DecizieSupraveghere -Punte $Chat -Stare (StNorm 'env_01B') -ReleuViu $true -ClaudeViu $true -Veche '' -InternetOk $false -InternetStabilMin 0 -LoginValid $true -LoginRevalidatLa $null -Istoric @() -Acum $T0.AddMinutes(10) -Mem $mem -Strain ''
Verifica 'reatasarea respecta "fara internet"' ($d.Actiune -eq 'asteapta' -and $d.Motiv -match 'internet')
$d = Get-DecizieSupraveghere -Punte $Chat -Stare (StNorm 'env_01B') -ReleuViu $true -ClaudeViu $true -Veche '' -InternetOk $true -InternetStabilMin 30 -LoginValid $true -LoginRevalidatLa $null -Istoric $ist3 -Acum $T0 -Mem $mem -Strain ''
Verifica 'reatasarea respecta limita de 3 porniri/ora' ($d.Actiune -eq 'asteapta' -and $d.LimitaAtinsa)
$d = Get-DecizieSupraveghere -Punte $Chat -Stare (StNorm 'env_01B') -ReleuViu $false -ClaudeViu $false -Veche '' -InternetOk $true -InternetStabilMin 30 -LoginValid $true -LoginRevalidatLa $null -Istoric @() -Acum $T0 -Mem $mem -Strain 'alta punte serveste folderul (claude PID 4242, din indicatorul CLI-ului)'
Verifica 'punte straina vie (indicator) -> nimic, fara dublura' ($d.Actiune -eq 'nimic' -and $d.Motiv -match 'PID 4242')
# puntea de reatasare: pornita, conectata -> revenire la normal
$mem.reatasare.pas = 'in-curs'
$stR = StNorm 'env_01A' 2 'pornire'; $stR.mod = 'reatasare'; $stR.sesiuneReatasare = 'session_01S1'; $stR.pornitLa = Get-DataIso $T0.AddMinutes(11)
$m = @(Update-Reatasare -Mem $mem -Stare $stR -Vie $true -Acum $T0.AddMinutes(13))
Verifica 'punte de reatasare pornita, inca neconectata (2 min) -> astept' ($m.Count -eq 0 -and $mem.reatasare.pas -eq 'in-curs')
$d = Get-DecizieSupraveghere -Punte $Chat -Stare $stR -ReleuViu $true -ClaudeViu $true -Veche '' -InternetOk $true -InternetStabilMin 30 -LoginValid $true -LoginRevalidatLa $null -Istoric @() -Acum $T0.AddMinutes(13) -Mem $mem -Strain ''
Verifica 'decizie: punte de reatasare in curs -> nimic (fara regulile de problema)' ($d.Actiune -eq 'nimic')
$stR.stare = 'conectat'; $stR.aFostConectat = $true
$m = @(Update-Reatasare -Mem $mem -Stare $stR -Vie $true -Acum $T0.AddMinutes(14))
Verifica 'punte de reatasare conectata -> pas "conectata" + mesaj' ($mem.reatasare.pas -eq 'conectata' -and ($m -join '|') -match 's-a conectat') ($m -join '|')
$d = Get-DecizieSupraveghere -Punte $Chat -Stare $stR -ReleuViu $true -ClaudeViu $true -Veche '' -InternetOk $true -InternetStabilMin 30 -LoginValid $true -LoginRevalidatLa $null -Istoric @() -Acum $T0.AddMinutes(14) -Mem $mem -Strain ''
Verifica 'decizie: reatasare conectata -> reporneste in mod normal' ($d.Actiune -eq 'reporneste' -and $d.Mod -eq 'normal') "$($d.Actiune) $($d.Mod)"
$mem.reatasare.pas = 'revenire'; $mem.reatasare.mediuReatasat = 'env_01A'
$m = @(Update-Reatasare -Mem $mem -Stare (StNorm 'env_01A' 3) -Vie $true -Acum $T0.AddMinutes(20))
Verifica 'puntea normala refoloseste mediul reatasat -> incheiata, memoria pe mediul reatasat' ($null -eq $mem.reatasare -and $mem.mediu -eq 'env_01A' -and ($m -join '|') -match 'incheiata') ($m -join '|')
# esec: puntea normala primeste alt mediu de doua ori -> renunt
$mem.reatasare = @{ sesiune = 'session_01S1'; mediuVechi = 'env_01A'; mediuNou = 'env_01B'; pas = 'revenire'; incercari = 0; candidati = 0; deLa = 'x'; mediuReatasat = 'env_01A' }
$m = @(Update-Reatasare -Mem $mem -Stare (StNorm 'env_01C' 4) -Vie $true -Acum $T0.AddMinutes(30))
Verifica 'alt mediu dupa revenire -> incercarea 1 esuata, cerut din nou' ($mem.reatasare.pas -eq 'cerut' -and $mem.reatasare.incercari -eq 1 -and ($m -join '|') -match 'incerc din nou') ($m -join '|')
$mem.reatasare.pas = 'revenire'
$m = @(Update-Reatasare -Mem $mem -Stare (StNorm 'env_01C' 5) -Vie $true -Acum $T0.AddMinutes(40))
Verifica 'a doua esuare -> renunt: sesiunea in renuntari, memoria fara mediu, mesaj "de verificat in aplicatie"' ($null -eq $mem.reatasare -and $mem.renuntari.ContainsKey('session_01S1') -and $null -eq $mem.mediu -and ($m -join '|') -match 'renunt') ($m -join '|')
$m = @(Update-Reatasare -Mem $mem -Stare (StNorm 'env_01C' 5) -Vie $true -Acum $T0.AddMinutes(45))
Verifica 'dupa renuntare: adopta mediul curent, fara alta reatasare' ($mem.mediu -eq 'env_01C' -and $null -eq $mem.reatasare -and $m.Count -eq 0)
# sesiune negasita -> urmatoarea candidata, apoi "nu mai am alta"
$mem = Get-MemoriePunte -Sup @{} -Nume 'chat'; $mem.mediu = 'env_01A'; $mem.sesiune = 'session_01S1'; $mem.sesiuniActive = @('session_01S2')
$mem.reatasare = @{ sesiune = 'session_01S1'; mediuVechi = 'env_01A'; mediuNou = 'env_01B'; pas = 'in-curs'; incercari = 0; candidati = 0; deLa = 'x'; mediuReatasat = $null }
$stN = StNorm '' 6 'oprit'; $stN.mod = 'reatasare'; $stN.sesiuneReatasare = 'session_01S1'; $stN.sesiuneNegasita = $true; $stN.codIesire = 1
$m = @(Update-Reatasare -Mem $mem -Stare $stN -Vie $false -Acum $T0.AddMinutes(50))
Verifica 'sesiunea negasita -> trec la urmatoarea candidata' ($mem.reatasare.sesiune -eq 'session_01S2' -and $mem.reatasare.pas -eq 'cerut' -and $mem.negasite.ContainsKey('session_01S1')) ($m -join '|')
$stN.sesiuneReatasare = 'session_01S2'
$m = @(Update-Reatasare -Mem $mem -Stare $stN -Vie $false -Acum $T0.AddMinutes(55))
Verifica 'nicio candidata ramasa -> fara reatasare, retin mediul nou' ($null -eq $mem.reatasare -and ($m -join '|') -match 'nu mai am alta') ($m -join '|')
# puntea de reatasare a iesit fara sa se conecteze (alt motiv) -> incercare esuata, nu renunt la prima
$mem.reatasare = @{ sesiune = 'session_01S3'; mediuVechi = 'env_01A'; mediuNou = 'env_01B'; pas = 'in-curs'; incercari = 0; candidati = 0; deLa = 'x'; mediuReatasat = $null }
$stE = StNorm '' 7 'oprit'; $stE.mod = 'reatasare'; $stE.sesiuneReatasare = 'session_01S3'; $stE.codIesire = 1
$m = @(Update-Reatasare -Mem $mem -Stare $stE -Vie $false -Acum $T0.AddMinutes(60))
Verifica 'iesire fara conectare -> incercare esuata, cerut din nou' ($mem.reatasare.pas -eq 'cerut' -and $mem.reatasare.incercari -eq 1)
# "deja servit" la iesire: reatasarea ramane ceruta; decizia asteapta 60 min (fara bucla)
$stE.dejaServit = $true; $stE.iesitLa = Get-DataIso $T0.AddMinutes(60); $mem.reatasare.pas = 'in-curs'
$m = @(Update-Reatasare -Mem $mem -Stare $stE -Vie $false -Acum $T0.AddMinutes(61))
Verifica 'deja servit la iesirea puntii de reatasare -> ramane ceruta, fara incercare numarata' ($mem.reatasare.pas -eq 'cerut' -and $mem.reatasare.incercari -eq 1)
$d = Get-DecizieSupraveghere -Punte $Chat -Stare $stE -ReleuViu $false -ClaudeViu $false -Veche '' -InternetOk $true -InternetStabilMin 30 -LoginValid $true -LoginRevalidatLa $null -Istoric @() -Acum $T0.AddMinutes(70) -Mem $mem -Strain ''
Verifica 'deja servit de 10 min -> asteapta (nu pornesc dublura)' ($d.Actiune -eq 'asteapta' -and $d.DejaServit) $d.Motiv
$d = Get-DecizieSupraveghere -Punte $Chat -Stare $stE -ReleuViu $false -ClaudeViu $false -Veche '' -InternetOk $true -InternetStabilMin 30 -LoginValid $true -LoginRevalidatLa $null -Istoric @() -Acum $T0.AddMinutes(125) -Mem $mem -Strain ''
Verifica 'deja servit de 65 min -> porneste (in mod reatasare, cerut)' ($d.Actiune -eq 'porneste' -and $d.Mod -eq 'reatasare' -and $d.Sesiune -eq 'session_01S3') "$($d.Actiune) $($d.Mod)"
# fara sesiuni cunoscute (id lipsa / invalid): mediu nou -> doar retinut, comportamentul de azi
$mem = Get-MemoriePunte -Sup @{} -Nume 'chat'; $mem.mediu = 'env_01A'; $mem.sesiune = 'nu e id'; $mem.sesiuniActive = @('a b')
$m = @(Update-Reatasare -Mem $mem -Stare (StNorm 'env_01B' 8 'conectat' $null) -Vie $true -Acum $T0)
Verifica 'id lipsa/invalid: mediu nou retinut, fara reatasare' ($null -eq $mem.reatasare -and $mem.mediu -eq 'env_01B' -and ($m -join '|') -match 'nu stiu nicio sesiune') ($m -join '|')
# avertismentul CLI "Could not reuse" tratat o singura data
$mem = Get-MemoriePunte -Sup @{} -Nume 'chat'; $mem.mediu = 'env_01A'; $mem.sesiune = 'session_01S1'
$stW = StNorm 'env_01B' 9; $stW.mediuPierdutLa = Get-DataIso $T0
$m = @(Update-Reatasare -Mem $mem -Stare $stW -Vie $true -Acum $T0)
Verifica 'avertisment "Could not reuse" -> reatasare ceruta' ($mem.reatasare -and $mem.reatasare.pas -eq 'cerut')
$mem.reatasare = $null; $mem.mediu = 'env_01B'
$m = @(Update-Reatasare -Mem $mem -Stare $stW -Vie $true -Acum $T0.AddMinutes(1))
Verifica 'acelasi avertisment la rularea urmatoare -> nu porneste a doua reatasare' ($null -eq $mem.reatasare -and $m.Count -eq 0) ($m -join '|')
# punte veche (v2) fara campurile v3 in stare -> tratata ca normala, fara exceptii
$stV2 = @{ stare = 'conectat'; pidClaude = 1; pornitLa = (Get-DataIso $T0) }
$m = @(Update-Reatasare -Mem (Get-MemoriePunte -Sup @{} -Nume 'chat') -Stare $stV2 -Vie $true -Acum $T0)
Verifica 'stare v2 (fara mod/indicator) -> nimic' ($m.Count -eq 0)

# ---------------------------------------------------------------------------------------------------------------------------
Write-Output 'T10 o rulare completa a supervizorului cu dependente false (internet picat -> revine; login; limita)'
# Lumea falsa sta in $script:W; blocurile de dependente o citesc prin $script: (fara GetNewClosure, ca sa vada functiile din lib).
function New-Lume {
  $l = @{ Net = $false; Login = @{}; Porniri = New-Object System.Collections.ArrayList; Opriri = New-Object System.Collections.ArrayList
          Jurnal = New-Object System.Collections.ArrayList; Sup = $null; Stari = @{}; Vii = @{}; Veche = @{}; Alarma = $null; LoginApeluri = 0
          # v3: indicatorul CLI-ului per punte, punte straina, mediul pe care il primeste urmatoarea punte (normala / de reatasare)
          Indicatoare = @{}; Strain = @{}; MediuUrmator = @{}; MediuReatasare = @{}; SesiuneIndicator = @{}; ReatasareConecteaza = $true
          PorniriMod = New-Object System.Collections.ArrayList }
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
  CitesteIndicator = { param($p) $script:W.Indicatoare[$p.Nume] }
  Strain = { param($p, $st, $ind) $script:W.Strain[$p.Nume] }
  Internet = { $script:W.Net }
  Login = { param($cfg) $script:W.LoginApeluri++; $script:W.Login[(Get-CheieCont $cfg)] }
  # o punte (re)pornita are stare noua, pornita "acum" (ca releul real); indicatorul ei = mediul pe care "il da serverul"
  Porneste = { param($p, $mod, $sesiune)
    if ($script:W.PornireArunca -contains $p.Nume) { throw 'eroare simulata la pornire' }
    [void]$script:W.Porniri.Add($p.Nume); [void]$script:W.PorniriMod.Add(('{0}:{1}:{2}' -f $p.Nume, $mod, $sesiune)); $script:W.Vii[$p.Nume] = $true
    $n = New-StarePunte -Nume $p.Nume -PidReleu 1 -StartReleu 'x' -Acum $script:AcumTest; $n.stare = 'conectat'; $n.pidClaude = 1; $n.aFostConectat = $true
    $mediu = $script:W.MediuUrmator[$p.Nume]
    if ($mod -eq 'reatasare') {
      $n.mod = 'reatasare'; $n.sesiuneReatasare = $sesiune; $mediu = $script:W.MediuReatasare[$p.Nume]
      if (-not $script:W.ReatasareConecteaza) { $n.stare = 'pornire'; $n.aFostConectat = $false }
    }
    if ($mediu) {
      $n.indicator = @{ mediu = $mediu; sesiune = $script:W.SesiuneIndicator[$p.Nume]; sesiuniActive = @(); pid = 1; startIso = $null }
      $script:W.Indicatoare[$p.Nume] = $n.indicator
    }
    $script:W.Stari[$p.Nume] = $n
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

# ---------------------------------------------------------------------------------------------------------------------------
Write-Output 'T17 v3: reatasarea sesiunilor in lumea falsa (pana de internet 25.11.2026 rejucata; deja servit; punte straina)'
$script:W = New-Lume; $W = $script:W; $W.Net = $true
function Jurnal-Numar([string]$Rx) { return @($W.Jurnal | Where-Object { $_ -match $Rx }).Count }
[void](Ruleaza 1000)
Verifica 'pornire initiala: 4 punti, toate in mod normal' ($W.Porniri.Count -eq 4 -and @($W.PorniriMod | Where-Object { $_ -notmatch ':normal:$' }).Count -eq 0) ($W.PorniriMod -join ' ')
# releul vede indicatorul puntii chat: mediul A, sesiunea A1 (+ A2 activa)
$W.Indicatoare['chat'] = @{ mediu = 'env_01AAAA'; sesiune = 'session_01AAAA1'; sesiuniActive = @('session_01AAAA2'); pid = 1; startIso = $null }
$W.Stari['chat'].indicator = $W.Indicatoare['chat']
[void](Ruleaza 1005)
Verifica 'memoria chat: mediul si sesiunile adoptate din indicator, fara porniri' ($W.Sup.punti['chat'].mediu -eq 'env_01AAAA' -and $W.Sup.punti['chat'].sesiune -eq 'session_01AAAA1' -and (@($W.Sup.punti['chat'].sesiuniActive) -contains 'session_01AAAA2') -and $W.Porniri.Count -eq 4) ($W.Sup.punti['chat'] | ConvertTo-Json -Compress -Depth 4)
# pana: puntea chat a iesit; cand revine, serverul ii da alt mediu (B) -> sesiunile vechi "Environment deleted"
$W.Vii['chat'] = $false; $W.Stari['chat'].stare = 'oprit'; $W.Stari['chat'].codIesire = 1; $W.Stari['chat'].iesitLa = Get-DataIso $T0.AddMinutes(1060)
$W.MediuUrmator['chat'] = 'env_01BBBB'; $W.SesiuneIndicator['chat'] = 'session_01BBBB0'; $W.MediuReatasare['chat'] = 'env_01AAAA'
$p0 = $W.Porniri.Count
[void](Ruleaza 1070)
Verifica 'puntea cazuta e pornita normal (memoria ramane pe mediul A: indicatorul de dinainte era al mediului A)' (($W.Porniri.Count - $p0) -eq 1 -and $W.PorniriMod[$W.PorniriMod.Count - 1] -eq 'chat:normal:' -and $W.Sup.punti['chat'].mediu -eq 'env_01AAAA') ($W.PorniriMod -join ' ')
[void](Ruleaza 1075)
Verifica 'mediul nou (B) != cel cunoscut (A) -> oprire + punte de REATASARE cu sesiunea A1' (($W.Porniri.Count - $p0) -eq 2 -and $W.PorniriMod[$W.PorniriMod.Count - 1] -eq 'chat:reatasare:session_01AAAA1' -and $W.Sup.punti['chat'].reatasare.pas -eq 'in-curs') ($W.PorniriMod -join ' ')
Verifica 'jurnal: mediul s-a schimbat, reatasez' ((Jurnal-Numar '\[chat\] mediul puntii s-a schimbat .*reatasez sesiunea <session-id>|\[chat\] mediul puntii s-a schimbat .*reatasez sesiunea session_01AAAA1') -eq 1) (($W.Jurnal | Select-Object -Last 4) -join ' || ')
$W.MediuUrmator['chat'] = 'env_01AAAA'   # puntea normala va refolosi mediul reinviat
[void](Ruleaza 1080)
Verifica 'puntea de reatasare conectata -> inlocuita cu puntea normala; pasul "revenire" cu mediul reatasat' (($W.Porniri.Count - $p0) -eq 3 -and $W.PorniriMod[$W.PorniriMod.Count - 1] -eq 'chat:normal:' -and $W.Sup.punti['chat'].reatasare.pas -eq 'revenire' -and $W.Sup.punti['chat'].reatasare.mediuReatasat -eq 'env_01AAAA') ($W.Sup.punti['chat'].reatasare | ConvertTo-Json -Compress)
Verifica 'jurnal: puntea de reatasare s-a conectat' ((Jurnal-Numar '\[chat\] reatasare: puntea cu sesiunea .* s-a conectat') -eq 1)
[void](Ruleaza 1085)
Verifica 'puntea normala pe mediul reatasat -> reatasare incheiata, memoria pe mediul A, fara alte porniri' ($null -eq $W.Sup.punti['chat'].reatasare -and $W.Sup.punti['chat'].mediu -eq 'env_01AAAA' -and ($W.Porniri.Count - $p0) -eq 3 -and (Jurnal-Numar '\[chat\] reatasare incheiata') -eq 1) (($W.Jurnal | Select-Object -Last 3) -join ' || ')
# puntea normala noua si-a creat sesiunea ei (B0, din indicator): devine principala, iar A1 ramane cunoscuta (rezerva)
Verifica 'memoria: sesiunea principala = cea din indicatorul puntii noi; cea veche ramane in lista' ($W.Sup.punti['chat'].sesiune -eq 'session_01BBBB0' -and (@($W.Sup.punti['chat'].sesiuniActive) -contains 'session_01AAAA1') -and (@($W.Sup.punti['chat'].sesiuniActive) -contains 'session_01AAAA2')) ($W.Sup.punti['chat'] | ConvertTo-Json -Compress -Depth 3)
$sesEsec = 'session_01BBBB0'
Cade 'chat' 1075
[void](Ruleaza 1090)
Verifica 'cele 3 porniri ale reatasarii intra in plafonul de 3/ora: a patra asteapta' (($W.Porniri.Count - $p0) -eq 3 -and (Jurnal-Numar 'AVERTISMENT \[chat\].*limita') -ge 1)
$W.Stari['chat'].stare = 'conectat'; $W.Stari['chat'].pidClaude = 1; $W.Stari['chat'].indicator = $W.Indicatoare['chat']
# esec: dupa reatasare, puntea normala primeste alt mediu (D) de doua ori -> renunt la sesiune, raman pe mediul nou
[void](Ruleaza 1200)
$W.Stari['chat'].indicator = @{ mediu = 'env_01CCCC'; sesiune = 'session_01CCCC0'; sesiuniActive = @(); pid = 1; startIso = $null }
$p0 = $W.Porniri.Count
[void](Ruleaza 1205)
Verifica 'mediu schimbat la o punte vie -> reatasare (1) cu sesiunea principala curenta' (($W.Porniri.Count - $p0) -eq 1 -and $W.PorniriMod[$W.PorniriMod.Count - 1] -eq ('chat:reatasare:' + $sesEsec)) ($W.PorniriMod[$W.PorniriMod.Count - 1])
$W.MediuUrmator['chat'] = 'env_01DDDD'
[void](Ruleaza 1210)
Verifica 'revenire la normal (2)' (($W.Porniri.Count - $p0) -eq 2 -and $W.PorniriMod[$W.PorniriMod.Count - 1] -eq 'chat:normal:')
[void](Ruleaza 1215)
Verifica 'puntea normala pe alt mediu (D) -> incercarea 1 esuata -> reatasare din nou (3)' (($W.Porniri.Count - $p0) -eq 3 -and $W.PorniriMod[$W.PorniriMod.Count - 1] -eq ('chat:reatasare:' + $sesEsec) -and (Jurnal-Numar '\[chat\] reatasare: .*incerc din nou') -eq 1) (($W.Jurnal | Select-Object -Last 3) -join ' || ')
[void](Ruleaza 1220)
Verifica 'a patra pornire in ora -> asteapta (plafonul ramane)' (($W.Porniri.Count - $p0) -eq 3)
[void](Ruleaza 1275)
Verifica 'dupa ora: revenire la normal (4)' (($W.Porniri.Count - $p0) -eq 4 -and $W.PorniriMod[$W.PorniriMod.Count - 1] -eq 'chat:normal:')
[void](Ruleaza 1280)
Verifica 'tot alt mediu -> renunt: sesiunea in renuntari, fara reatasare, mesaj "de verificat in aplicatie"' ($null -eq $W.Sup.punti['chat'].reatasare -and $W.Sup.punti['chat'].renuntari.ContainsKey($sesEsec) -and (Jurnal-Numar '\[chat\] reatasare: .*renunt dupa 2 incercari') -eq 1) (($W.Jurnal | Select-Object -Last 3) -join ' || ')
[void](Ruleaza 1285)
Verifica 'dupa renuntare: mediul nou (D) adoptat, nicio alta pornire' ($W.Sup.punti['chat'].mediu -eq 'env_01DDDD' -and ($W.Porniri.Count - $p0) -eq 4)
# sesiune negasita: prima candidata e arhivata -> a doua; a doua la fel -> punte normala, mediul nou retinut
[void](Ruleaza 1400)
$W.Sup.punti['chat'].sesiune = 'session_01DDDD1'; $W.Sup.punti['chat'].sesiuniActive = @('session_01DDDD2')
$W.Stari['chat'].indicator = @{ mediu = 'env_01EEEE'; sesiune = $null; sesiuniActive = @(); pid = 1; startIso = $null }
$W.ReatasareConecteaza = $false; $W.MediuReatasare['chat'] = $null
$p0 = $W.Porniri.Count
[void](Ruleaza 1405)
Verifica 'reatasare ceruta pentru D1' (($W.Porniri.Count - $p0) -eq 1 -and $W.PorniriMod[$W.PorniriMod.Count - 1] -eq 'chat:reatasare:session_01DDDD1')
$W.Vii['chat'] = $false; $W.Stari['chat'].stare = 'oprit'; $W.Stari['chat'].codIesire = 1; $W.Stari['chat'].sesiuneNegasita = $true; $W.Stari['chat'].iesitLa = Get-DataIso $T0.AddMinutes(1406)
[void](Ruleaza 1410)
Verifica 'D1 negasita -> urmatoarea candidata D2' (($W.Porniri.Count - $p0) -eq 2 -and $W.PorniriMod[$W.PorniriMod.Count - 1] -eq 'chat:reatasare:session_01DDDD2' -and (Jurnal-Numar '\[chat\] reatasare: sesiunea .* nu mai exista .*incerc sesiunea') -eq 1)
$W.Vii['chat'] = $false; $W.Stari['chat'].stare = 'oprit'; $W.Stari['chat'].codIesire = 1; $W.Stari['chat'].sesiuneNegasita = $true; $W.Stari['chat'].iesitLa = Get-DataIso $T0.AddMinutes(1411)
$W.MediuUrmator['chat'] = 'env_01EEEE'
[void](Ruleaza 1415)
Verifica 'D2 negasita -> nu mai am alta: punte normala, fara reatasare' (($W.Porniri.Count - $p0) -eq 3 -and $W.PorniriMod[$W.PorniriMod.Count - 1] -eq 'chat:normal:' -and $null -eq $W.Sup.punti['chat'].reatasare -and (Jurnal-Numar '\[chat\] reatasare: .*nu mai am alta') -eq 1) ($W.PorniriMod -join ' ')
[void](Ruleaza 1420)
Verifica 'mediul E adoptat; fara alte porniri' ($W.Sup.punti['chat'].mediu -eq 'env_01EEEE' -and ($W.Porniri.Count - $p0) -eq 3)
$W.ReatasareConecteaza = $true
# "deja servit" (bucla din 25.11.2026): puntea iese cu 409 la fiecare pornire -> acum NU se mai reporneste la 5 min
[void](Ruleaza 1600)
$W.Vii['module'] = $false; $W.Stari['module'].stare = 'oprit'; $W.Stari['module'].codIesire = 1; $W.Stari['module'].dejaServit = $true
$W.Stari['module'].ultimaEroare = 'Error: This folder is already served by another Claude Code on this device. Stop it first.'; $W.Stari['module'].iesitLa = Get-DataIso $T0.AddMinutes(1601)
$p0 = $W.Porniri.Count; $j0 = $W.Jurnal.Count
[void](Ruleaza 1605); [void](Ruleaza 1610); [void](Ruleaza 1615); [void](Ruleaza 1620)
Verifica 'deja servit: 4 rulari, ZERO porniri (fara bucla)' (($W.Porniri.Count - $p0) -eq 0) ($W.PorniriMod -join ' ')
Verifica 'deja servit: o singura linie in jurnal' ((@($W.Jurnal | Select-Object -Skip $j0 | Where-Object { $_ -match '\[module\] astept: folderul era servit' }).Count) -eq 1) (($W.Jurnal | Select-Object -Skip $j0) -join ' || ')
[void](Ruleaza 1665)
Verifica 'dupa 60 min fara punte straina vizibila: o singura repornire' (($W.Porniri.Count - $p0) -eq 1 -and $W.PorniriMod[$W.PorniriMod.Count - 1] -eq 'module:normal:')
# punte straina vie (indicatorul CLI-ului are un scriitor viu, din afara releului): nimic, o linie pe ora
[void](Ruleaza 1700)
$W.Vii['ofertare'] = $false; $W.Stari['ofertare'].stare = 'oprit'; $W.Stari['ofertare'].codIesire = 1; $W.Stari['ofertare'].iesitLa = Get-DataIso $T0.AddMinutes(1700)
$W.Strain['ofertare'] = 'alta punte serveste folderul (claude PID 4242, din indicatorul CLI-ului)'
$p0 = $W.Porniri.Count; $j0 = $W.Jurnal.Count
[void](Ruleaza 1705); [void](Ruleaza 1710); [void](Ruleaza 1715)
Verifica 'punte straina vie -> nicio pornire, o linie in jurnal' (($W.Porniri.Count - $p0) -eq 0 -and (@($W.Jurnal | Select-Object -Skip $j0 | Where-Object { $_ -match '\[ofertare\] alta punte serveste folderul .*PID 4242.*nu pornesc dublura' }).Count) -eq 1) (($W.Jurnal | Select-Object -Skip $j0) -join ' || ')
$W.Strain['ofertare'] = ''
[void](Ruleaza 1720)
Verifica 'punte straina disparuta -> pornim' (($W.Porniri.Count - $p0) -eq 1 -and $W.PorniriMod[$W.PorniriMod.Count - 1] -eq 'ofertare:normal:')
# punte straina care s-a oprit a lasat indicatorul ei: la pornirea normala il adoptam (mediul in care sunt sesiunile acum)
[void](Ruleaza 1800)
$W.Vii['redari'] = $false; $W.Stari['redari'].stare = 'oprit'; $W.Stari['redari'].codIesire = 1; $W.Stari['redari'].iesitLa = Get-DataIso $T0.AddMinutes(1800)
$W.Indicatoare['redari'] = @{ mediu = 'env_01RRRR'; sesiune = 'session_01RRRR1'; sesiuniActive = @(); pid = 777; startIso = $null }
$W.MediuUrmator['redari'] = 'env_01RRRR'; $W.SesiuneIndicator['redari'] = 'session_01RRRR1'
[void](Ruleaza 1805)
Verifica 'la pornirea normala memoria adopta indicatorul existent (mediul R, sesiunea R1)' ($W.Sup.punti['redari'].mediu -eq 'env_01RRRR' -and $W.Sup.punti['redari'].sesiune -eq 'session_01RRRR1') ($W.Sup.punti['redari'] | ConvertTo-Json -Compress -Depth 3)
[void](Ruleaza 1810)
Verifica 'puntea noua pe acelasi mediu R -> nicio reatasare' ($null -eq $W.Sup.punti['redari'].reatasare)
# -DoarVerifica arata si pasul de reatasare, fara efecte
$W.Stari['redari'].indicator = @{ mediu = 'env_01SSSS'; sesiune = $null; sesiuniActive = @(); pid = 1; startIso = $null }
$opDv = $W.Opriri.Count; $jDv = $W.Jurnal.Count
$act = Ruleaza 1815 -Dv
Verifica '-DoarVerifica: "redari: reporneste [reatasare]" fara efecte' ((@($act) -join '|') -match 'redari: reporneste \[reatasare\]' -and $W.Opriri.Count -eq $opDv -and $W.Jurnal.Count -eq $jDv) (@($act) -join '|')

Write-Output 'T11 fisierul de stare: dus-intors JSON (Windows PowerShell 5.1)'
$f = Join-Path $Tmp 'sup.json'
$W.Sup.istoric['chat'] = @((Get-DataIso $T0), (Get-DataIso $T0.AddMinutes(5))); $W.Sup.istoric['module'] = @((Get-DataIso $T0))
$W.Sup.punti['chat'].reatasare = @{ sesiune = 'session_01AAAA1'; mediuVechi = 'env_01AAAA'; mediuNou = 'env_01BBBB'; pas = 'cerut'; incercari = 1; candidati = 0; deLa = (Get-DataIso $T0); mediuReatasat = $null }
[void](Write-JsonAtomic $f $W.Sup)
$r = Read-JsonSigur $f
Verifica 'istoric = lista de texte ISO (nu {value,Count}), si cu un singur element' (@($r.istoric['chat']).Count -eq 2 -and @($r.istoric['module']).Count -eq 1 -and ($r.istoric['chat'] | Select-Object -First 1) -is [string] -and (ConvertFrom-DataIso ($r.istoric['chat'] | Select-Object -First 1))) (($r.istoric | ConvertTo-Json -Compress -Depth 5) + ' ' + ($W.Sup.istoric | ConvertTo-Json -Compress -Depth 5))
Verifica 'conturi pastrate' ($r.conturi['implicit'].Valid -eq $true)
$mc = Get-MemoriePunte -Sup $r -Nume 'chat'
Verifica 'memoria puntii dupa dus-intors: mediu, sesiuni (lista), renuntari (hashtable), reatasare (hashtable cu pas)' ($mc.mediu -eq 'env_01EEEE' -and @($mc.sesiuniActive).Count -ge 1 -and $mc.renuntari -is [hashtable] -and $mc.renuntari.ContainsKey($sesEsec) -and $mc.reatasare -is [hashtable] -and $mc.reatasare.pas -eq 'cerut' -and $mc.reatasare.incercari -eq 1) ($mc | ConvertTo-Json -Compress -Depth 4)
$mr = Get-MemoriePunte -Sup $r -Nume 'redari'
Verifica 'memorie cu sesiuniActive goala dupa dus-intors: tablou gol, nu null' ($null -ne $mr.sesiuniActive -and @($mr.sesiuniActive).Count -eq 0)
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
    # ca pe 25.11.2026 (409 la inregistrare): cauza pe o linie, numaratoarea pe urmatoarea (textele CLI 2.1.319)
    '[Console]::Error.WriteLine("Error: This folder is already served by another Claude Code on this device. Stop it first.")'
    '[Console]::Error.WriteLine("Exiting in about 50 seconds.")'
    'exit 3'
  )
  Set-Content -Path $fals -Value $continut -Encoding ASCII
  $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $releu = Join-Path $PSScriptRoot 'punte_releu.ps1'
  function Start-ReleuTest([string]$Nume, [string]$Asteapta = '0', [string]$Extra = '') {
    $a = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -Nume {1} -Folder "{2}" -Afisat "Test punte" -DirStare "{3}" -DirJurnal "{4}" -Claude "{5}" -TestScriptFals "{6}" -TestArg {7} {8}' -f `
         $releu, $Nume, $folder, $dirSt, $dirJ, $ps, $fals, $Asteapta, $Extra
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
  Verifica 'stderr citit linie cu linie, mascat (fara token, fara id sesiune)' ($st -and (@($st.stderrUltimele) -join '|') -match 'test stderr' -and (@($st.stderrUltimele) -join '|') -notmatch 'SECRETDETEST' -and (@($st.stderrUltimele) -join '|') -notmatch 'TEST0123456789') (@($st.stderrUltimele) -join '|')
  Verifica 'ultima eroare = cauza reala (409 deja servit), NU "Exiting in about"' ($st -and $st.ultimaEroare -match 'already served' -and $st.ultimaEroare -notmatch 'Exiting' -and $st.dejaServit -eq $true) $st.ultimaEroare
  Verifica 'stare: mod normal, argumente retinute, aFostConectat' ($st -and $st.mod -eq 'normal' -and $st.argumente -match '--name' -and $st.aFostConectat -eq $true)
  $jt = ''; if (Test-Path (Join-Path $dirJ 'punti.log')) { $jt = [IO.File]::ReadAllText((Join-Path $dirJ 'punti.log')) }
  Verifica 'jurnal: pornita, conectata, deconectata, oprita cu cauza reala + marcaj deja servit' ($jt -match 'punte pornita' -and $jt -match '\] conectata' -and $jt -match 'deconectata' -and $jt -match 's-a oprit \(cod 3\): .*already served.*\[deja servit') $jt
  Verifica 'jurnal: linia "folderul e deja servit" o singura data' (@([regex]::Matches($jt, 'folderul e deja servit de alta punte')).Count -eq 1)
  Verifica 'tokenul din mediu NU a ajuns la punte' ($jt -notmatch 'TOKEN MOSTENIT')
  Verifica 'CLAUDE_CONFIG_DIR nu a ajuns la puntea cu config implicit' ($jt -notmatch 'Info: config')
  Verifica 'jurnal fara URL-uri, tokenuri, id-uri' ($jt -notmatch 'https://' -and $jt -notmatch 'oat01' -and $jt -notmatch 'TEST0123456789')
  Verifica 'fisierul ultimele.log scris' (@(Get-ChildItem $dirSt -Filter '*.ultimele.log').Count -eq 1)

  Write-Output 'T12b releu in mod REATASARE (--session-id) + indicatorul CLI-ului citit in stare'
  $fInd = Join-Path $Tmp 'indicator_test.json'
  Set-Content -Path $fInd -Value '{"sessionId":"session_01TESTREATASARE01","environmentId":"env_01TESTMEDIU00001","source":"standalone","pid":1,"procStart":"134401117631176444"}' -Encoding ASCII
  $numeR = 'autotest-' + [guid]::NewGuid().ToString('N').Substring(0, 6)
  $rR = Start-ReleuTest $numeR '0' ('-SesiuneId session_01TESTREATASARE01 -TestCaleIndicator "' + $fInd + '"')
  $iesitR = $rR.WaitForExit(60000)
  $stR = $null; if ($iesitR) { $stR = Read-JsonSigur (Join-Path $dirSt "$numeR.stare.json") }
  Verifica 'releul de reatasare se termina' $iesitR
  Verifica 'stare: mod reatasare, sesiunea retinuta, argumentele CLI = --session-id fara --spawn/--name' ($stR -and $stR.mod -eq 'reatasare' -and $stR.sesiuneReatasare -eq 'session_01TESTREATASARE01' -and $stR.argumente -match '--session-id' -and $stR.argumente -notmatch 'spawn' -and $stR.argumente -notmatch '--name') ($stR | ConvertTo-Json -Compress)
  Verifica 'indicatorul CLI-ului citit in stare (mediu, sesiune, pid, startIso)' ($stR -and $stR.indicator -and $stR.indicator.mediu -eq 'env_01TESTMEDIU00001' -and $stR.indicator.sesiune -eq 'session_01TESTREATASARE01' -and $stR.indicator.pid -eq 1 -and $stR.indicator.startIso -eq '2026-11-25T20:22:43.1176444Z') ($stR.indicator | ConvertTo-Json -Compress)
  $jt2 = [IO.File]::ReadAllText((Join-Path $dirJ 'punti.log'))
  Verifica 'jurnal: "punte de REATASARE pornita pentru sesiunea <session-id>" (id mascat)' ($jt2 -match 'punte de REATASARE pornita pentru sesiunea <session-id>' -and $jt2 -notmatch 'TESTREATASARE01')
  $rI = Start-ReleuTest ('autotest-' + [guid]::NewGuid().ToString('N').Substring(0, 6)) '0' '-SesiuneId "a b"'
  $iesitI = $rI.WaitForExit(30000)
  Verifica 'id de sesiune nesigur -> releul refuza (cod 2), fara punte' ($iesitI -and $rI.ExitCode -eq 2) "cod $($rI.ExitCode)"

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
Write-Output ("AUTOTEST punti v3: {0} ok, {1} esuate" -f $script:ok, $script:esec)
if ($script:esec -gt 0) { exit 1 }
exit 0
