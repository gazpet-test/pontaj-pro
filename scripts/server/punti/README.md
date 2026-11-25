# Punțile Remote Control v3 (server Gazpet-Claude)

Țin pornite cele 4 punți `claude remote-control` de pe serverul AI, prin care sesiunile din aplicație/telefon lucrează pe server:

| punte | folder | cont (config) | mod |
|---|---|---|---|
| chat | `C:\Users\Gazpet-Ai\gazpet-erp-chat` | principal (implicit) | same-dir |
| module | `C:\Users\Gazpet-Ai\gazpet-erp` | principal (implicit) | same-dir |
| ofertare | `C:\Users\Gazpet-Ai\gazpet-erp-ofertare` | principal (implicit) | same-dir |
| redari | `C:\Users\Gazpet-Ai\gazpet-erp-redari` | redari@ (`.claude-redari`) | worktree |

Lista e definită o singură dată, în `Get-ConfigPunti` din `punti_lib.ps1`.

**De ce:** pe 08.11.2026 a expirat logarea CLI-ului; punțile au trebuit oprite și repornite de mână, iar sesiunea Redari a stat „Can't reach Gazpet-Claude” până la repornire. v1 (`paw-data\punti\punti_remote_control.ps1`) doar pornea ce lipsea, fără verificare de login, fără limită de reporniri și fără să vadă o punte vie dar picată.

**v3 (25.11.2026):** după o pană de internet de ~30 min, punțile repornite au primit de la server un **mediu nou**, iar sesiunile vechi (chat, module) au apărut în aplicație cu „Environment deleted”; le-a reatașat de mână o sesiune din cloud, cu `claude remote-control --session-id`. Apoi supervizorul v2 a intrat în buclă: la fiecare 5 min pornea o punte care ieșea în ~1 min cu „Exiting in about 50 seconds” (cauza reală, pe linia dinainte: „This folder is already served by another Claude Code on this device”, nu ajungea în jurnal). v3 reține sesiunile fiecărei punți și le reatașează singur, recunoaște „deja servit” și nu mai repornește degeaba.

## Fișiere

| fișier | rol |
|---|---|
| `punti_remote_control.ps1` | **supervizorul**, rulat de sarcina Windows la logare + la 5 minute. Decide ce pornește/repornește. `-DoarVerifica` = simulare fără efecte. |
| `punte_releu.ps1` | **releul**: câte unul per punte, pornește `claude remote-control` și îi citește ieșirea; trăiește cât puntea. |
| `punti_lib.ps1` | funcțiile comune (config, clasificarea ieșirii, decizii, login, alarmă, procese). |
| `instaleaza.ps1` | instalare / dezinstalare (cere admin). |
| `autotest_punti.ps1` | teste fără rețea (278 de verificări). |

Unde scriu:
- `C:\Users\Public\paw-data\punti\punti.log` — jurnalul (citit de chat). Mascat: fără URL-uri, id-uri de sesiune, tokenuri, emailuri.
- `C:\Users\Public\paw-data\out\alarma_login.txt` — alarma de login (există doar cât e ceva de semnalat).
- `%LOCALAPPDATA%\Gazpet\punti\` (profilul Gazpet-Ai, privat) — starea fiecărei punți (`<nume>.stare.json`), starea supervizorului (`supervizor.json`, cu memoria `punti` — mediul și sesiunile cunoscute ale fiecărei punți), ultimele linii ale fiecărei punți la oprire (`<nume>.ultimele.log`).

Ce citesc (doar citire, nu modifică): **indicatorul CLI-ului** `bridge-pointer.json`, scris de `claude remote-control` în `~/.claude/projects/<cheia folderului>/` (pentru redari în `.claude-redari\projects\…`): mediul (`environmentId`), sesiunea creată în folder (`sessionId`), PID-ul și ora pornirii punții care l-a scris.

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
3. **Punte veche sau străină**: dacă o punte e încă pornită pe calea veche (v1, bucla `start_claude_rc*.cmd` sau un `claude remote-control --name "<nume>"` din afara releului) **sau** indicatorul CLI-ului al folderului are un scriitor viu care nu e al nostru (`claude.exe` cu PID-ul și ora pornirii din indicator, de ex. o punte pornită de mână dintr-o sesiune cloud), nu pornește a doua. O linie în jurnal, apoi cel mult o dată pe oră.
4. **Pornește** punțile lipsă și **repornește** punțile vii dar picate (mai jos). Maxim **3 porniri/oră pe punte** (fereastră glisantă); peste → doar avertisment în jurnal, o dată pe oră.
5. **Reatașare (v3)**: ține minte, per punte, mediul și sesiunile din indicatorul CLI-ului. Dacă o punte pornită de el primește **alt mediu** decât cel cunoscut (sau CLI-ul scrie „Could not reuse the previous environment”), sesiunile vechi au rămas fără mediu → pornește puntea de reatașare, apoi revine la puntea normală (detalii mai jos).

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

### Ce scrie puntea pe stderr și ce face v3 (texte verbatim CLI 2.1.319, verificate în binar)

Releul citește acum stderr-ul linie cu linie (evenimente .NET, pipe-ul nu se poate umple), nu doar ultima linie la ieșire:

| ce scrie puntea (stderr) | ce înseamnă | ce face v3 |
|---|---|---|
| `Error: This folder is already served by another Claude Code on this device. Stop it first.` (409 la înregistrare), `Error: Another `claude remote-control` instance (pid N) is already running in this directory…`, `Error: Environment … is already being served by another `claude remote-control` instance (pid N)…` | altă punte servește folderul | stare „deja servit”; după ieșire supervizorul **nu** repornește la fiecare 5 min: dacă vede scriitorul indicatorului viu → „punte străină”, altfel reîncearcă abia după 60 min. O singură linie în jurnal. |
| `Exiting in about N seconds.` | doar numărătoarea dinaintea ieșirii | ignorată; în jurnal rămâne cauza reală (linia dinainte) |
| `Warning: Could not reuse the previous environment. Existing claude.ai/code sessions from the previous run will not reconnect.` | serverul a dat alt mediu; sesiunile vechi rămân „Environment deleted” | pornește reatașarea (vezi mai jos) |
| `Error: Session X not found. It may have been archived or expired.`, `… has no environment_id …`, `Error: Invalid session ID …` | id-ul dat la `--session-id` nu mai e bun | sesiunea e trecută la „negăsite”; se încearcă următoarea cunoscută (cel mult 3), apoi punte normală |

### Reatașarea sesiunilor (v3)

Cum funcționează CLI-ul (2.1.319): puntea scrie în `bridge-pointer.json` mediul ei (`environmentId`) și sesiunea creată în folder (`sessionId`). La o pornire nouă fără `--session-id`, dacă scriitorul indicatorului e mort, CLI-ul **cere refolosirea mediului** → sesiunile existente se reconectează singure (de aceea o repornire obișnuită nu pierde nimic). Dacă serverul nu mai are mediul (pana din 25.11), CLI-ul primește alt mediu, scrie avertismentul de mai sus și **șterge indicatorul**; sesiunile vechi rămân fără mediu. Singura cale de reatașare e `claude remote-control --session-id <id>`: CLI-ul cere serverului mediul sesiunii și îl reînvie — dar acea punte e în **mod cu o singură sesiune** (capacitate 1, fără spawn, iese când sesiunea se termină), deci nu poate rămâne puntea noastră.

De aceea v3 face doi pași, câte unul la fiecare rulare (5 min):

```
mediul puntii s-a schimbat (<env-id> -> <env-id>) ... reatasez sesiunea <session-id>
  └─ oprește puntea normală, pornește  claude remote-control --session-id <id>      (pasul „in-curs")
reatasare: puntea cu sesiunea <session-id> s-a conectat ...                           (pasul „conectata")
  └─ oprește puntea de reatașare, pornește puntea normală (--name, --spawn)          (pasul „revenire")
reatasare incheiata: sesiunea <session-id> e servita din nou, puntea normala refoloseste mediul ei
```

Puntea normală pornită după reatașare citește indicatorul scris de puntea de reatașare (mediul reînviat) și îl refolosește → sesiunea reatașată, plus toate celelalte de pe acel mediu, cu capacitatea normală. Memoria (`supervizor.json` → `punti.<nume>`): `mediu`, `sesiune` (cea din indicator, prima încercată), `sesiuniActive` (celelalte cunoscute, inclusiv sesiunea principală de dinainte), `negasite`, `renuntari`, `reatasare` (pasul curent), `rezervareRevenire`.

Revenirea se încheie întotdeauna cu un rezultat explicit, cu termen: **confirmată** (indicatorul puntii normale, scris de ea, arată mediul reatașat), **eșuată** (alt mediu, sau CLI-ul scrie „Could not reuse…”) sau **necunoscută** (după 10 min puntea normală e conectată, dar indicatorul lipsește ori nu e al ei) — ultimele două se numără ca încercare eșuată.

Ce **nu** se adoptă orbește: la o pornire normală, indicatorul lăsat în folder de o punte oprită (a noastră sau străină) e preluat în memorie doar dacă arată același mediu, sau dacă memoria nu știe încă nici mediu, nici sesiuni. Dacă arată **alt mediu** iar memoria are sesiuni, supervizorul scrie în jurnal și nu îl adoptă: puntea nouă îl va refolosi, diferența față de memorie pornește reatașarea, iar reconcilierea o face serverul prin `--session-id` (CLI-ul cere mediul sesiunii) — dacă sesiunea a fost mutată de cealaltă punte pe mediul nou, dus-întorsul confirmă asta și memoria trece pe mediul nou; dacă nu, mediul vechi e reînviat.

Limite ale reatașării, intenționate:
- plafonul de **3 porniri/oră** e bugetat pe tot dus-întorsul: reatașarea pornește numai dacă încap **două** porniri (dus cu `--session-id` + întors la normal), întoarcerea fiind rezervată atunci printr-un „jeton” în istoric; altfel e amânată (avertisment o dată pe oră) și sesiunile rămân „Environment deleted” până încap — ca azi, dar niciodată puntea cu o singură sesiune nu rămâne blocată de plafon. Nimic nu ocolește plafonul: jetonul e o intrare reală din istoric; la întoarcere el primește ora reală a pornirii (nu rămâne la ora plecării), o întoarcere notată dar neefectuată (întrerupere) se reia tot pe jeton, un jeton ieșit din fereastră nu mai contează (întoarcerea costă atunci o pornire obișnuită), iar un jeton neconsumat (renunț, nicio candidată) e scos;
- dacă puntea normală primește din nou alt mediu după reatașare, se mai încearcă **o dată**; a doua eșuare = se renunță la acea sesiune (rămâne „de verificat în aplicație”, în jurnal) și se reține mediul nou;
- puntea de reatașare neconectată după 10 min = încercare eșuată; ea nu trece prin regulile de repornire (în modul cu o sesiune titlul sesiunii stă chiar în linia de stare, deci clasificarea ieșirii nu e sigură) și trăiește cel mult până la rularea următoare; ieșirea ei se tratează o singură dată (starea rămâne pe disc);
- fără sesiune cunoscută (prima instalare, id lipsă sau invalid) → comportamentul de azi: mediul nou e doar reținut, fără reatașare;
- id-urile de sesiune ajung pe linia de comandă numai dacă trec de `Test-IdSigur` (`^[A-Za-z0-9][A-Za-z0-9_-]{3,79}$`); în jurnal apar mascate (`<session-id>`, `<env-id>`).

**Ne-testat pe sesiuni reale** (brief: fără punți reale pornite din această lucrare): că serverul reînvie mediul la `--session-id` pentru *toate* sesiunile lui, nu doar pentru cea cerută, și că puntea normală de după refolosește acel mediu. Succesiunea de pe 25.11 (reatașare manuală cu `--session-id` → oprire → puntea noastră „conectată” pe indicatorul rămas) o susține; proba pe o sesiune de probă e pasul chat-ului de la instalare.

De ce e sigur:
- repornește **doar la text explicit de eroare de la punte**, niciodată din tăcere sau euristici (o punte care nu mai scrie nimic de 30 min primește doar o observație în jurnal); dacă un CLI nou schimbă textele, v2 nu mai vede problemele (nu repornește greșit) și scrie o observație;
- nimic fără internet stabil și login valid; maxim 3/oră, iar rezervarea în istoric se salvează **înainte** de oprire/pornire (dacă starea nu se poate salva, nu acționează);
- oprește doar procese verificate (PID + nume + ora pornirii din fișierul de stare) și tot arborele lor (`taskkill /T`), ca sesiunile copil să nu rămână orfane;
- nu acționează dacă e rulat din interiorul unei sesiuni Claude (s-ar opri singur sau și-ar lega punțile de sesiunea curentă): pornește sarcina programată în loc;
- după repornire, CLI-ul refolosește mediul din indicatorul folderului, deci sesiunile existente se reconectează singure; dacă mediul s-a pierdut, v3 le reatașează (secțiunea de mai sus).

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

### Trecerea v2 → v3 (același instalator, aceleași 3 fișiere)

Rulezi `instaleaza.ps1` ca mai sus: copiază fișierele noi peste cele vechi (ACL verificat), re-creează sarcina (identică) și o pornește o dată. Punțile v2 pornite **rămân pornite**: starea lor (`<nume>.stare.json`, fără câmpurile v3) e citită ca „mod normal”, iar la prima rulare supervizorul citește el indicatorul CLI-ului al fiecărei punți vii (PID-ul din indicator = `claude.exe`-ul ei) și memorează mediul și sesiunea (rând nou `punti` în `supervizor.json`) — nu așteaptă un releu v3. Nicio repornire doar pentru upgrade; releele v3 intră în joc când o punte cade sau e repornită.

Dacă o punte a rămas în bucla „deja servit” (ca pe 25.11): v3 o vede în `<nume>.stare.json` abia după prima ieșire citită de un releu v3; până atunci regula veche (3/oră) o oprește oricum. Dacă indicatorul folderului are un scriitor viu (puntea pornită de mână), supervizorul scrie o dată „alta punte serveste folderul (claude PID N)” și nu pornește nimic; când acea punte se oprește, pornește puntea normală, care refolosește mediul ei.

**Proba pe o sesiune de probă (chat, înainte de a se baza pe ea):**
1. pe o punte fără sesiuni importante (de ex. ofertare), cu puntea v3 conectată, notează din `supervizor.json` → `punti.ofertare` mediul și sesiunea (sau din `~/.claude/projects/C--Users-Gazpet-Ai-gazpet-erp-ofertare/bridge-pointer.json`);
2. simulează pierderea mediului: oprește puntea (supervizorul o va reporni normal) **și** șterge `bridge-pointer.json` al folderului înainte ca ea să repornească — CLI-ul va înregistra un mediu nou, iar sesiunea veche va arăta „Environment deleted” în aplicație;
3. urmărește `punti.log`: „mediul puntii s-a schimbat … reatasez sesiunea <session-id>” → „punte de REATASARE pornita” → „reatasare: puntea cu sesiunea … s-a conectat” → „reatasare incheiata”; în aplicație sesiunea trebuie să redevină accesibilă, iar `-DoarVerifica` să arate `ofertare: nimic`;
4. dacă apare „renunt dupa 2 incercari”, oprește experimentul și raportează: ipoteza „puntea normală refolosește mediul reînviat” nu s-a confirmat pe acea versiune de CLI.

Dezinstalare: același script cu `-Dezinstaleaza` (sarcina nouă ștearsă, sarcinile vechi reactivate, v1 pus la loc, folderul șters); cu `-OpresteSiPuntile` oprește și punțile v2 și pornește imediat sarcinile vechi.

## Fișa de securitate (CLAUDE.md pct. 7)

| | |
|---|---|
| **(a) conținut extern citit** | Niciunul. Citește doar ieșirea (stdout + stderr) propriului proces `claude remote-control` (texte ale CLI-ului), `claude auth status` și indicatorul `bridge-pointer.json` scris de CLI. Titlurile sesiunilor (scrise de utilizatori) trec prin ieșire, dar nu sunt interpretate ca instrucțiuni și nu ajung în `punti.log`. Id-urile din indicator ajung pe linia de comandă doar după `Test-IdSigur`. |
| **(b) ce scrie / face** | Pornește/oprește procesele punților (doar cele verificate); la pierderea mediului pornește o punte `--session-id` pentru o sesiune cunoscută, apoi revine la puntea normală. Scrie `punti.log`, `alarma_login.txt` și starea din profilul Gazpet-Ai. **Nu** scrie în ERP/BD, **nu** trimite mailuri, SMS-uri sau mesaje, nu atinge bani sau drepturi. |
| **(c) identitate** | Rulează ca **Gazpet-Ai**, fără drepturi ridicate (sarcină interactivă, `RunLevel Limited`). Nu folosește `service_role` și nicio cheie Supabase. Scripturile stau în folder protejat (doar adminii pot scrie). |
| **(d) cine îl pornește** | Sarcina Windows „Punti Remote Control (Gazpet)” (la logare + la 5 minute). Manual: oricine e logat ca Gazpet-Ai; rulat dintr-o sesiune Claude doar declanșează sarcina. Instalarea/dezinstalarea: doar un administrator. |
| **(e) confirmare umană** | Nicio acțiune ireversibilă. Repornirea închide sesiunile de pe puntea picată (oricum deconectate). Preluarea imediată (`-PreiaAcum`) cere acordul lui Răzvan. Reînnoirea login-ului o face Răzvan (`claude auth login`). |
| **secrete** | Niciunul folosit. `CLAUDE_CODE_OAUTH_TOKEN` (doar numele; fișierul din `.secrete` nu e citit, se verifică doar existența lui) — **nu** ține remote-control, de aceea e scos din mediul punților. |
| **la eșec** | Punte căzută → repornită la următoarea rulare (≤ 5 min). Punte vie dar picată ≥ 10 min → repornită. Peste 3 porniri/oră → avertisment, așteaptă. Fără internet → așteaptă. Login expirat → alarmă, așteaptă reînnoirea, apoi repornește singur. Folder deja servit de altă punte → nu pornește dublura (reîncearcă după 60 min sau când cealaltă dispare). Mediu pierdut → reatașare în 2 pași; după 2 eșecuri renunță la sesiune și o scrie în jurnal. Eroare în supervizor → rând `EROARE supervizor` în jurnal, reîncearcă la 5 min. |

La instalare, chat-ul actualizează `registru_automatizari` și rândul din `public.automatizari` (Administrator → ⚙️ Automatizări) cu fișa de mai sus.

## Teste

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\server\punti\autotest_punti.ps1          # tot (≈ 30 s)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\server\punti\autotest_punti.ps1 -FaraProcese
```

Fără rețea și fără `claude.exe`: clasificarea liniilor reale ale punții, detecția „deconectat > 10 min”, limita de 3 reporniri/oră, lipsa tokenului și mediul curățat, internet picat → revenit, login expirat / reînnoit / necunoscut și alarma, punți vechi (fără dubluri), mascarea textelor, fișierele de stare; v3: clasificarea stderr-ului (texte verbatim), indicatorul CLI-ului (cheia folderului, FILETIME, scriitor viu/străin), pașii reatașării (pure + lumea falsă: pana din 25.11 rejucată, eșec → renunțare, revenire fără indicator → „necunoscut” cu termen, sesiune negăsită → următoarea, ieșire tratată o dată, bugetul 2 porniri în plafon + rezervare eliberată, indicator străin cu alt mediu neadoptat → reconciliat prin reatașare, punte v2 vie memorată la upgrade, „deja servit” fără buclă, punte străină, id lipsă/invalid, `-DoarVerifica`); plus integrare cu procese reale (releu + punte falsă care scrie și pe stderr „deja servit” + „Exiting in about”, releu în mod reatașare cu `--session-id` și indicator, id nesigur refuzat, mutex cu două relee concurente, oprire verificată).

## Limite cunoscute

- Detecția se bazează pe textele CLI 2.1.319 (stdout și stderr) și pe formatul `bridge-pointer.json`. Dacă o versiune nouă le schimbă, v3 nu mai repornește punțile vii-dar-picate și nu mai vede pierderea mediului (rămân: pornirea punților căzute, alarma de login) și scrie o observație în jurnal după 30 min fără „Connected”.
- Reatașarea e verificată doar cu punte falsă și lume falsă; proba pe o sesiune reală e la instalare (mai sus). Dacă serverul nu reînvie mediul la `--session-id`, v3 renunță după 2 încercări și lasă sesiunea „de verificat în aplicație” — ca azi, dar cu un rând clar în jurnal.
- Prima pornire într-un folder neîncrezut sau o întrebare interactivă nouă a CLI-ului ar ține puntea blocată la pornire (fără terminal) → observație în jurnal, fără repornire.
- `claude daemon` (serviciul oficial) are instalarea de serviciu dezactivată în versiunea curentă; de reevaluat când devine disponibil.
