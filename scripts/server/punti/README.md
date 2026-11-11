# Punțile Remote Control v2 (server Gazpet-Claude)

Țin pornite cele 4 punți `claude remote-control` de pe serverul AI, prin care sesiunile din aplicație/telefon lucrează pe server:

| punte | folder | cont (config) | mod |
|---|---|---|---|
| chat | `C:\Users\Gazpet-Ai\gazpet-erp-chat` | principal (implicit) | same-dir |
| module | `C:\Users\Gazpet-Ai\gazpet-erp` | principal (implicit) | same-dir |
| ofertare | `C:\Users\Gazpet-Ai\gazpet-erp-ofertare` | principal (implicit) | same-dir |
| redari | `C:\Users\Gazpet-Ai\gazpet-erp-redari` | redari@ (`.claude-redari`) | worktree |

Lista e definită o singură dată, în `Get-ConfigPunti` din `punti_lib.ps1`.

**De ce:** pe 08.11.2026 a expirat logarea CLI-ului; punțile au trebuit oprite și repornite de mână, iar sesiunea Redari a stat „Can't reach Gazpet-Claude” până la repornire. v1 (`paw-data\punti\punti_remote_control.ps1`) doar pornea ce lipsea, fără verificare de login, fără limită de reporniri și fără să vadă o punte vie dar picată.

## Fișiere

| fișier | rol |
|---|---|
| `punti_remote_control.ps1` | **supervizorul**, rulat de sarcina Windows la logare + la 5 minute. Decide ce pornește/repornește. `-DoarVerifica` = simulare fără efecte. |
| `punte_releu.ps1` | **releul**: câte unul per punte, pornește `claude remote-control` și îi citește ieșirea; trăiește cât puntea. |
| `punti_lib.ps1` | funcțiile comune (config, clasificarea ieșirii, decizii, login, alarmă, procese). |
| `instaleaza.ps1` | instalare / dezinstalare (cere admin). |
| `autotest_punti.ps1` | teste fără rețea (146 de verificări). |

Unde scriu:
- `C:\Users\Public\paw-data\punti\punti.log` — jurnalul (citit de chat). Mascat: fără URL-uri, id-uri de sesiune, tokenuri, emailuri.
- `C:\Users\Public\paw-data\out\alarma_login.txt` — alarma de login (există doar cât e ceva de semnalat).
- `%LOCALAPPDATA%\Gazpet\punti\` (profilul Gazpet-Ai, privat) — starea fiecărei punți (`<nume>.stare.json`), starea supervizorului, ultimele linii ale fiecărei punți la oprire (`<nume>.ultimele.log`).

## Cum funcționează

```
Sarcina Windows (la 5 min, cont Gazpet-Ai, fără fereastră)
  └─ punti_remote_control.ps1  ── internet? login? punte veche? limită?
       └─ punte_releu.ps1 -Nume chat     (unul per punte, ascuns)
            └─ claude.exe remote-control --name "Chat - server AI"
                 └─ sesiunile (claude.exe --print --sdk-url ...)
```

La fiecare rulare, supervizorul:
1. **Internet**: conexiune TCP 443 la `api.anthropic.com` / `claude.ai`. Fără internet nu pornește și nu repornește nimic (scrie în jurnal o dată, apoi cel mult o dată pe oră).
2. **Login**: `claude auth status --json` pentru fiecare cont (o dată pe oră; la fiecare rulare dacă e invalid sau expiră în ≤ 5 zile). Login expirat/invalid → nu pornește punțile acelui cont (n-ar avea rost) și scrie alarma. Dacă `auth status` nu poate fi citit, starea e **necunoscută**, nu „invalidă”.
3. **Punte veche**: dacă o punte e încă pornită pe calea veche (v1, bucla `start_claude_rc*.cmd` sau un `claude remote-control --name "<nume>"` din afara releului), nu pornește a doua.
4. **Pornește** punțile lipsă și **repornește** punțile vii dar picate (mai jos). Maxim **3 porniri/oră pe punte** (fereastră glisantă); peste → doar avertisment în jurnal, o dată pe oră.

Releul pornește CLI-ul cu un mediu curățat: scoate `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` (cu oricare dintre ele puntea refuză să pornească) și variabilele `CLAUDE*`/`ANTHROPIC*` moștenite dintr-o sesiune Claude; setează `CLAUDE_CONFIG_DIR` explicit (sau îl scoate pentru contul principal). Un mutex per punte împiedică două relee pe aceeași punte.

### Ce semnal folosește repornirea și de ce e sigur

Ieșirea punții, redirectată, este ecranul ei TUI redesenat cam o dată pe secundă (~40 MB/zi/punte în v1). Releul o citește linie cu linie și păstrează doar starea, cu ora exactă. Textele vin din CLI 2.1.319 (verificate în binar):

| ce scrie puntea | ce înseamnă | ce face v2 |
|---|---|---|
| `Connected · repo · branch` / `Ready · …` | conectată | stare „conectat” |
| `Reconnecting · retrying in X · disconnected Y` | picată de Y; se redesenează la fiecare reîncercare (max. 2 min), iar blocul „Connected” **nu** se mai redesenează cât e picată | stare „reconectare”, de la prima linie; reține Y |
| `[HH:MM:SS] Reconnected after X` | și-a revenit singură (recuperare confirmată) | stare „conectat”; șterge semnalele de eroare anterioare |
| `[HH:MM:SS] Error: … claude remote-control …` / `… giving up.` | eroare după care CLI-ul cere repornirea | marcată „fatală” |
| `[HH:MM:SS] Warning: … Remote Control credential …` | serverul respinge credențialul punții; CLI-ul face o pauză (până la ~1 h) și reîncearcă singur | doar jurnal: dacă problema persistă, CLI-ul ajunge la eroare fatală și iese |

O punte **vie** e repornită doar dacă:
1. e în „reconectare” de **≥ 10 min** (după ceasul nostru sau după Y raportat de punte) **și** internetul merge de ≥ 5 min (deci propria ei reîncercare ar fi reușit deja). CLI-ul renunță singur după 10 min și iese (atunci v2 o vede „lipsă” și o pornește), dar **nu** și cât servește o sesiune de proiect — acela e cazul „proces viu, sesiuni deconectate”;
2. are o eroare fatală de **≥ 10 min**, fără `Reconnected` după ea, și procesul tot n-a ieșit;
3. login-ul contului a fost invalid/expirat cât rula și acum e din nou valid, sau a fost reînnoit înainte de expirare (punțile pornite cu logarea veche nu se refac singure).

Titlurile sesiunilor (scrise de utilizatori) apar și ele în ieșire, dar **indentate** în blocul de stare, pe când evenimentele și stările CLI-ului încep la coloana 0. De aceea o linie indentată nu e niciodată luată drept eveniment: un titlu ca `[10:00:00] Error: … giving up.` nu poate provoca o repornire (conținut extern = date).

Dacă releul moare și puntea rămâne vie (orfană, nesupravegheată), supervizorul o oprește verificat și pornește un releu nou — niciodată un al doilea releu lângă ea. Dacă oprirea nu se confirmă, nu pornește nimic (evită dublura) și reîncearcă la rularea următoare.

De ce e sigur:
- repornește **doar la text explicit de eroare de la punte**, niciodată din tăcere sau euristici (o punte care nu mai scrie nimic de 30 min primește doar o observație în jurnal); dacă un CLI nou schimbă textele, v2 nu mai vede problemele (nu repornește greșit) și scrie o observație;
- nimic fără internet stabil și login valid; maxim 3/oră, iar rezervarea în istoric se salvează **înainte** de oprire/pornire (dacă starea nu se poate salva, nu acționează);
- oprește doar procese verificate (PID + nume + ora pornirii din fișierul de stare) și tot arborele lor (`taskkill /T`), ca sesiunile copil să nu rămână orfane;
- nu acționează dacă e rulat din interiorul unei sesiuni Claude (s-ar opri singur sau și-ar lega punțile de sesiunea curentă): pornește sarcina programată în loc;
- după repornire, CLI-ul refolosește mediul înregistrat pentru folder, deci sesiunile existente se pot reatașa.

## Tokenul (setup-token) — rezultatul testului

Test izolat pe 08.11.2026 (folder `C:\Users\Gazpet-Ai\punte-test`, config separat, nume „TEST punte token”, CLI 2.1.319), cu `CLAUDE_CODE_OAUTH_TOKEN` din `.secrete`:

```
Error: Remote Control requires a full-scope login token. Long-lived tokens (from `claude setup-token`
or CLAUDE_CODE_OAUTH_TOKEN) are limited to inference-only for security reasons. Run `claude auth login`
to use Remote Control.
```

Deci **v2 nu folosește tokenul** (`$TokenTineRemoteControl = $false`): punțile rămân pe logarea normală, cu alarmă înainte de expirare. Mai mult, v2 scoate tokenul din mediul punților: dacă ar fi setat global, ar opri toate punțile.

## Alarma de login

`claude auth status` dă `loginExpiresAt` pentru fiecare cont. Cu **5 zile** înainte (sau dacă a expirat), supervizorul scrie `C:\Users\Public\paw-data\out\alarma_login.txt` (contul, data, comanda de reînnoire) și un rând `ALARMA LOGIN` în `punti.log` (la apariție, apoi o dată pe zi). După `claude auth login`, punțile contului se repornesc singure în max. 5 minute, iar fișierul de alarmă se șterge.

La 08.11.2026: contul principal expiră pe **08.12.2026**, contul redari@ pe **04.12.2026** (alarmă de pe 29.11).

**Propunere pentru telefon (fără mailuri):** rutina zilnică a sesiunii de chat verifică dacă există `alarma_login.txt`; dacă da, scrie conținutul în chat și trimite o notificare push în aplicația Claude a lui Răzvan. Nu e implementată aici (rutinele sunt ale chat-ului).

## Instalare (o face chat-ul / Răzvan, cu drepturi de admin)

Din PowerShell **Run as Administrator**, pe server, din clona chat-ului adusă la `main` după merge (`git -C C:\Users\Gazpet-Ai\gazpet-erp-chat pull --ff-only`):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\Gazpet-Ai\gazpet-erp-chat\scripts\server\punti\instaleaza.ps1
```

Ce face: copiază cele 3 scripturi în `C:\ProgramData\Gazpet\Punti` (ACL strict: SYSTEM + Administrators control total, Gazpet-Ai doar citire; verificat după copiere), creează sarcina **„Punti Remote Control (Gazpet)”** (la logarea Gazpet-Ai + la 5 minute, fără fereastră, o singură instanță), dezactivează (nu șterge) cele 4 sarcini vechi „Claude Remote Control (Gazpet)*”, redenumește scriptul v1 și pornește sarcina o dată. Punțile vechi **rămân pornite**; v2 le preia când cad singure sau la următoarea logare.

Preluare imediată (închide sesiunile de pe punți — doar cu acordul lui Răzvan, ideal dintr-o consolă care nu rulează într-o sesiune de pe punte):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\Gazpet-Ai\gazpet-erp-chat\scripts\server\punti\instaleaza.ps1 -PreiaAcum
```

De ce nu în `Paw\bin`: instalatorul Paw înlocuiește tot folderul `bin` la fiecare versiune și ar șterge fișierele punților.

Verificare după instalare:

```powershell
Get-ScheduledTask -TaskName 'Punti Remote Control (Gazpet)' | Get-ScheduledTaskInfo
Get-Content C:\Users\Public\paw-data\punti\punti.log -Tail 30
powershell -NoProfile -ExecutionPolicy Bypass -File C:\ProgramData\Gazpet\Punti\punti_remote_control.ps1 -DoarVerifica
```

Dezinstalare: același script cu `-Dezinstaleaza` (sarcina nouă ștearsă, sarcinile vechi reactivate, v1 pus la loc, folderul șters); cu `-OpresteSiPuntile` oprește și punțile v2 și pornește imediat sarcinile vechi.

## Fișa de securitate (CLAUDE.md pct. 7)

| | |
|---|---|
| **(a) conținut extern citit** | Niciunul. Citește doar ieșirea propriului proces `claude remote-control` (texte de stare ale CLI-ului) și `claude auth status`. Titlurile sesiunilor (scrise de utilizatori) trec prin ieșire, dar nu sunt interpretate ca instrucțiuni și nu ajung în `punti.log`. |
| **(b) ce scrie / face** | Pornește/oprește procesele punților (doar cele verificate). Scrie `punti.log`, `alarma_login.txt` și starea din profilul Gazpet-Ai. **Nu** scrie în ERP/BD, **nu** trimite mailuri, SMS-uri sau mesaje, nu atinge bani sau drepturi. |
| **(c) identitate** | Rulează ca **Gazpet-Ai**, fără drepturi ridicate (sarcină interactivă, `RunLevel Limited`). Nu folosește `service_role` și nicio cheie Supabase. Scripturile stau în folder protejat (doar adminii pot scrie). |
| **(d) cine îl pornește** | Sarcina Windows „Punti Remote Control (Gazpet)” (la logare + la 5 minute). Manual: oricine e logat ca Gazpet-Ai; rulat dintr-o sesiune Claude doar declanșează sarcina. Instalarea/dezinstalarea: doar un administrator. |
| **(e) confirmare umană** | Nicio acțiune ireversibilă. Repornirea închide sesiunile de pe puntea picată (oricum deconectate). Preluarea imediată (`-PreiaAcum`) cere acordul lui Răzvan. Reînnoirea login-ului o face Răzvan (`claude auth login`). |
| **secrete** | Niciunul folosit. `CLAUDE_CODE_OAUTH_TOKEN` (doar numele; fișierul din `.secrete` nu e citit, se verifică doar existența lui) — **nu** ține remote-control, de aceea e scos din mediul punților. |
| **la eșec** | Punte căzută → repornită la următoarea rulare (≤ 5 min). Punte vie dar picată ≥ 10 min → repornită. Peste 3 porniri/oră → avertisment, așteaptă. Fără internet → așteaptă. Login expirat → alarmă, așteaptă reînnoirea, apoi repornește singur. Eroare în supervizor → rând `EROARE supervizor` în jurnal, reîncearcă la 5 min. |

La instalare, chat-ul actualizează `registru_automatizari` și rândul din `public.automatizari` (Administrator → ⚙️ Automatizări) cu fișa de mai sus.

## Teste

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\server\punti\autotest_punti.ps1          # tot (≈ 30 s)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\server\punti\autotest_punti.ps1 -FaraProcese
```

Fără rețea și fără `claude.exe`: clasificarea liniilor reale ale punții, detecția „deconectat > 10 min”, limita de 3 reporniri/oră, lipsa tokenului și mediul curățat, internet picat → revenit, login expirat / reînnoit / necunoscut și alarma, punți vechi (fără dubluri), mascarea textelor, fișierele de stare; plus integrare cu procese reale (releu + punte falsă, mutex cu două relee concurente, oprire verificată).

## Limite cunoscute

- Detecția se bazează pe textele CLI 2.1.319. Dacă o versiune nouă le schimbă, v2 nu mai repornește punțile vii-dar-picate (rămân: pornirea punților căzute, alarma de login) și scrie o observație în jurnal după 30 min fără „Connected”.
- Prima pornire într-un folder neîncrezut sau o întrebare interactivă nouă a CLI-ului ar ține puntea blocată la pornire (fără terminal) → observație în jurnal, fără repornire.
- `claude daemon` (serviciul oficial) are instalarea de serviciu dezactivată în versiunea curentă; de reevaluat când devine disponibil.
