# Gazpet Dialog TGZ — varianta B (token `claude setup-token`, fără conectori)

Decizia lui Răzvan, 06.11.2026. Sarcina Windows „Gazpet Dialog TGZ” rulează L–V la 10:40 și 16:40 pe serverul AI
(Gazpet-Claude) și răspunde la mesajele Proiectului Juridic marcate „(verificare programată)” din canalul de dialog
`C:\Users\Public\paw-data\dialog\` (convenția: `_CONVENTIE_JURIDIC.md` din folder și `docs/paw/paw_juridic/README.md`,
secțiunea „Dialog cu sesiunea chat”).

Varianta B rulează **doar** cu tokenul de un an din `claude setup-token`, care nu are conectorii claude.ai
(Gmail, Drive, Supabase). De aceea partea de BD o face orchestratorul, cu psql și o interogare fixă; agentul primește
doar fișiere locale.

**r2 (după Jakarinos r1 NO-GO):** ERP strict doar-citire (cursor local, SQL-ul refuză un rol care poate scrie), agentul
scrie doar în folderul privat al rulării, publicarea e a orchestratorului, timeout / cod nenul / rezultat fără succes =
EROARE.

**r3 (după Jakarinos r2 NO-GO, ultima rundă):**
- **Date personale:** agentul nu mai scrie text publicabil. Scrie `raspuns.json` cu câmpuri fixe (`raspuns_schema.json`):
  enumerări închise, coduri care trebuie să existe în exportul ERP, numere mărginite, o notă opțională limitată la
  `vocabular_nota.txt`. `claude#NNN.md` îl **compune orchestratorul** din JSON-ul validat, iar valorile ERP le ia direct din
  export. Orice câmp în plus, tip greșit sau valoare în afara listelor = nepublicat. stderr-ul agentului: în log doar lungimea.
- **Numerotare:** creare exclusivă, apoi re-verificare (imediat și după o fereastră de 90 s): dacă a apărut `juridic#NNN` cu
  același NNN, răspunsul se **mută** atomic pe următorul număr liber. Coliziune nerezolvată = EROARE.
- **Procese:** psql și claude rulează într-un **Job Object** (pornite suspendate, puse în job, apoi reluate); la final tot
  jobul se oprește și se confirmă `ActiveProcesses = 0`. Neconfirmat = EROARE + marcaj care blochează rulările următoare.
- **Publicare vs. cursor:** fiecare răspuns poartă `Cheie:` (amprenta mesajelor la care răspunde). La pornire, un GATA deja
  publicat pentru mesaje încă necursate = doar avans de cursor; un OPRIT deja publicat pentru exact aceleași mesaje = nu se reia.

## Fișiere

| Fișier | Rol |
|---|---|
| `dialog_tgz.ps1` | Orchestratorul (sarcina programată îl pornește). Lock, stare, log, cod de ieșire. |
| `DialogTgz.psm1` | Logica: fișiere noi, cursor, contractul JSON, compunerea, cheia, reconcilierea, publicarea, Job Object, fluxul `Invoke-DialogTgz`. |
| `raspuns_schema.json` | Contractul răspunsului (UTF-8): stări, motive, cereri, „de decis”, secțiunile exportului (chei + indicatori), limite, etichetele în română. Sursă unică pentru validare, compunere și prompt. |
| `vocabular_nota.txt` | Cuvintele permise în câmpul `nota` (ASCII, litere mici, fără nume de persoane). Se completează doar prin PR. |
| `dialog_tgz_prompt.md` | Promptul pentru `claude -p` (șablon; codurile, secțiunile și vocabularul se completează din schemă). |
| `sql/context_agregat.sql` | Singurul SQL: gardă de rol doar-citire, apoi cifre agregate din `red_*`, `BEGIN READ ONLY`, ieșire nealiniată (`|`). |
| `instaleaza_task.ps1` | Înlocuiește acțiunea sarcinii existente. Implicit **doar previzualizare**; scrie numai cu `-Aplica`. |
| `teste/test_dialog_tgz.ps1` | Autotest offline (274 de verificări): psql și claude simulate, procese reale în Job Object, orchestratorul real cu psql / claude simulate prin `.cmd`. |
| `teste/dialog_tgz.test.js` | Rulează autotestul PowerShell sub `npx vitest run` (doar pe Windows, cu powershell.exe; pe CI Linux se sare). |

Toate `.ps1` / `.psm1` sunt ASCII (PowerShell 5.1 citește fișierele fără BOM ca ANSI). Autotestul verifică acest lucru.

## Fișiere de stare (în `C:\Users\Public\paw-data\out\`)

| Fișier | Conținut |
|---|---|
| `dialog_tgz_cursor.txt` | Un singur rând: `juridic#NNN (raspuns claude#NNN, AAAA-LL-ZZ HH:MM)` = ultimul juridic# procesat. Îl scrie chat-ul la instalare (`juridic#NNN`), apoi doar orchestratorul, după un GATA publicat. |
| `dialog_tgz_ultima.txt` | `AAAA-LL-ZZ HH:MM:SS <ultima linie>` după fiecare rulare (chat-ul o citește). |
| `dialog_tgz_<AAAA-LL-ZZ>.log` | Log-ul zilei, cu id de rulare. |
| `dialog_tgz_procese_ramase.txt` | Există doar după o oprire neconfirmată: `pid|pornire` pe rând, sau `necunoscut`. Cât timp un proces listat trăiește (sau scrie `necunoscut`), rulările dau EROARE. `necunoscut` îl șterge chat-ul, după verificare. |
| `dialog_tgz.lock` | Lock-ul global (fișier deschis exclusiv). |

## Fluxul unei rulări

1. **Lock global** (`dialog_tgz.lock`, deschis exclusiv). Ocupat → notează în log și iese cu 0, fără să atingă starea.
2. **Procese rămase**: marcajul există și un proces din el e încă viu (același PID și moment de pornire) sau scrie
   `necunoscut` → EROARE, nu pornește nimic. Toate dispărute → marcajul se șterge.
3. **Token** (`C:\Users\Gazpet-Ai\.secrete\claude_oauth_token.txt`, prefix `sk-ant-oat01-`), folderul de dialog, schema și
   vocabularul. Orice lipsă → EROARE clară, înainte de BD și de Claude.
4. **Cursor** (`dialog_tgz_cursor.txt`; lipsă / alt format → EROARE). Temporarele proprii rămase în dialog
   (`_dialog_tgz_<cheie>.tmp`, după o rulare oprită brusc) se șterg.
5. **Fișiere noi**: `juridic#NNN.md` cu NNN > cursor și „(verificare programată)” în antet; pentru fiecare, amprenta sha256.
6. **Reconciliere cu dialogul** (L05: starea se citește din dialog, nu dintr-un marcaj local):
   - un `claude#` al sarcinii, cu ultima linie GATA, pentru o parte din mesajele noi, cu `Cheie:` egală cu amprenta
     actuală a acelor mesaje → răspunsul există deja (rulare oprită între publicare și cursor): se rezolvă eventuala
     coliziune de număr, se mută cursorul, **fără inferență nouă**; dacă între timp a apărut un mesaj programat cu număr
     mai mic, neacoperit → EROARE (decide chat-ul);
   - un `claude#` OPRIT cu cheia exactă a mesajelor noi → `OPRIT deja publicat`, nu se reia (până se schimbă mesajele);
   - niciun mesaj nou → `NIMIC NOU`, fără BD și fără Claude.
7. **Folderul rulării**: `%TEMP%\dialog_tgz\rulari\<id>\intrare\` (context) și `...\iesire\` (singurul loc unde agentul
   poate scrie). Configurația Claude Code stă în `%TEMP%\dialog_tgz\cfg\`.
8. **Export**: psql `context_agregat.sql` (în Job Object) → citit ca tabele; trebuie să aibă toate secțiunile, cheile și
   indicatorii din schemă (altfel EROARE) → `intrare\context.md`.
9. **Agentul**: `claude -p` în Job Object (detalii mai jos), cu directorul de lucru = `iesire\`. Scrie `iesire\raspuns.json`.
10. **Verificări după agent** (orice abatere = EROARE, nimic publicat, cursor neschimbat): oprirea confirmată, fără
    timeout, cod 0, JSON-ul CLI cu `subtype=success` și `is_error=false`; în `iesire\` exact `raspuns.json`; dialogul
    neatins (excepție: `juridic#` noi), aceleași amprente, niciun mesaj programat cu număr mai mic apărut între timp.
11. **Contractul** (`Test-RaspunsAgent`, vezi mai jos). EROARE din partea agentului = nepublicat.
12. **Compunerea** (`Format-RaspunsPublicat`): antetul (`De la`, `Data`, `Subiect`, `Raspuns la: juridic#…`, `Cheie:`),
    pe fiecare mesaj tabelul de verificare (secțiune, rând, indicator, valoarea din mesaj, **valoarea din export**, rezultatul
    calculat de program), afirmațiile neverificabile, atașamentele (doar numere), „De decis de Răzvan” (etichete din
    schemă), nota validată; ultima linie `GATA` sau `OPRIT <eticheta motivului>`. Textul compus mai trece o dată prin
    filtrul de tipare (telefon, CNP, e-mail, adresă, act) și prin limita de 200 KB.
13. **Publicare**: temporar `_dialog_tgz_<cheie>.tmp` în dialog, apoi `File.Move` pe următorul număr liber (atomic, eșuează
    dacă destinația există: nu suprascrie niciodată; ocupat → alt număr). Apoi **re-verificare**: imediat și după
    `-AsteptareColiziuneSec` (implicit 90): dacă există `juridic#NNN` cu același număr, răspunsul se redenumește exclusiv pe
    următorul liber (conținutul nu depinde de număr), de cel mult 5 ori; nerezolvat (de ex. fișier deschis de un cititor) →
    EROARE, cursorul nu se mută, rularea următoare reconciliază (pasul 6) și reîncearcă mutarea.
14. **Cursor** (doar GATA): `juridic#<cel mai mare procesat> (raspuns claude#<numărul final>, …)`, CAS pe valoarea citită la
    pasul 4, scriere atomică. Eșec → EROARE; rularea următoare reconciliază.
15. **Stare + log**: tot ce intră trece prin filtrul de token și de tipare de date personale.

Coduri de ieșire: **0** = GATA / NIMIC NOU / OPRIT / lock ocupat; **1** = EROARE.

`OPRIT` = mesajul cere altceva decât o verificare sau e suspect: răspunsul se publică, cursorul nu se mută; aceleași mesaje
nu se mai reiau cât timp au același conținut (cheia). Chat-ul / Răzvan decid (sau mută cursorul de mână). Pentru o reluare
forțată a unor mesaje deja răspunse, chat-ul mută cursorul înapoi **și** redenumește răspunsul vechi (altfel reconcilierea îl
găsește și doar avansează cursorul).

### Contractul `raspuns.json` (`raspuns_schema.json`)

```
{ "stare": "GATA" | "OPRIT" | "EROARE", "motiv_oprire": <cod> (doar OPRIT), "motiv_eroare": <cod> (doar EROARE),
  "mesaje": [ { "juridic": <întreg, exact mesajele procesate, fiecare o dată>, "cerere": <cod>,
                "verificari": [ { "sectiune": <cod>, "filtru": { <cheie a secțiunii>: <valoare din export>, … },
                                  "indicator": <coloană a secțiunii>, "valoare_juridic": <număr | valoare din coloană | null> } ],
                "neverificabile": <întreg>, "atasamente": { "citite", "negasite_local", "in_afara_radacinilor": <întregi> },
                "de_decis": [ <coduri> ], "nota": <text în vocabular, opțional> } ] }
```

Reguli (fiecare încălcare = nepublicat; motivul din stare / log conține doar calea câmpului și codul, niciodată valoarea):
- nicio cheie în afara contractului, la niciun nivel; tipuri stricte (întreg ≠ text ≠ zecimal; bool respins);
- coduri doar din listele schemei; `filtru` doar cu cheile secțiunii, obligatoriu `proiect`, valori existente în export,
  și trebuie să aleagă **exact un rând**; valoarea ERP o ia programul din acel rând;
- `valoare_juridic`: număr 0 … 9.999.999,99 cu cel mult 2 zecimale (un telefon sau un CNP nu încap), sau un text care
  există deja în acea coloană a exportului;
- `nota`: cel mult 600 de caractere, fără rânduri noi, doar litere / cifre / `. , ; : ( ) % / ? -`, referințe
  `juridic#NNN` / `claude#NNN`, date `AAAA-LL-ZZ` / `ZZ.LL.AAAA`; numere de cel mult 6 cifre (un lanț legat prin spațiu,
  punct sau cratimă se numără împreună: `0722 123 456` = 10 cifre); **fiecare cuvânt** din `vocabular_nota.txt`, din
  acronimele schemei sau din valorile exportului (cod proiect, uat3, nume UAT, calitate, stare, cod corespondență).
  Sondele din review (`Ion Popescu`, `AB 123456`, `Strada Florilor 12`) sunt respinse în notă, în filtre, în coduri,
  în valori și în câmpuri în plus (testat, cu verificarea că valoarea nu apare în stare / jurnal).

### Comanda Claude

```
claude -p --model claude-sonnet-5-5 --effort medium --max-turns 40 --restricted
  --tools Read,Glob,Grep,Edit,Write
  --allowedTools Read,Glob,Grep,Edit(//c/<TEMP>/dialog_tgz/rulari/<id>/iesire/**)
  --disallowedTools Bash,PowerShell,WebFetch,WebSearch
  --permission-mode dontAsk --strict-mcp-config --no-session-persistence --disable-slash-commands
  --output-format json
  --add-dir C:\Users\Public\paw-data\dialog --add-dir <TEMP>\dialog_tgz\rulari\<id>\intrare [--add-dir <rădăcină NAS> ...]
```

- Directorul de lucru = `iesire\` al rulării; promptul intră pe stdin (scris pe un fir separat: un copil care nu citește
  stdin nu blochează timeout-ul).
- Mediul procesului copil: `CLAUDE_CODE_OAUTH_TOKEN` = tokenul din fișier; `CLAUDE_CONFIG_DIR` = `%TEMP%\dialog_tgz\cfg`;
  `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` scoase.
- **Job Object**: `CreateProcess` cu `CREATE_SUSPENDED` → `AssignProcessToJobObject` (eșec = procesul suspendat se oprește,
  nu a executat nimic) → `ResumeThread`. Jobul are `KILL_ON_JOB_CLOSE` și nu permite ieșirea din job (fără
  `BREAKAWAY_OK`): copiii și nepoții, inclusiv cei porniți târziu, rămân în job. La ieșirea normală sau la timeout
  (50 min): `TerminateJobObject` pe tot jobul (și orfanii rămași după o ieșire normală, notați în log), apoi confirmare
  `ActiveProcesses = 0` în 30 s. Neconfirmat → EROARE + marcaj (PID-urile din job sau `necunoscut`). Dacă orchestratorul
  moare, sistemul închide handle-ul jobului și oprește tot ce era în el.

## Rolul de BD doar-citire (pas pentru chat, NU e făcut în PR)

Orchestratorul refuză din start utilizatorii care pot scrie (`postgres`, `service_role`, `supabase_admin`,
`authenticator`, `authenticated`, `anon`) și folosește implicit `dialog_tgz_ro.dxczwkbciseqniprspcu`. Garda din
`context_agregat.sql` refuză (cu lista exactă a drepturilor în plus): SUPERUSER / BYPASSRLS / CREATEROLE / CREATEDB /
REPLICATION, lipsa `default_transaction_read_only = on`, apartenența la orice alt rol, INSERT / UPDATE (și pe coloane) /
DELETE / TRUNCATE / TRIGGER pe orice relație din orice schemă non-sistem (și prin PUBLIC), USAGE / UPDATE pe secvențe,
CREATE pe scheme sau pe bază; plus „nu vede niciun proiect” (RLS fără politică = cifre false 0).

Propunere (de aplicat de chat, cu „da”-ul lui Răzvan; parola se setează separat cu `\password`, nu în fișier, iar
intrarea nouă din `pgpass` o adaugă chat-ul):

```sql
CREATE ROLE dialog_tgz_ro LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2;
ALTER ROLE dialog_tgz_ro SET default_transaction_read_only = on;
ALTER ROLE dialog_tgz_ro SET statement_timeout = '60s';
GRANT USAGE ON SCHEMA public TO dialog_tgz_ro;
GRANT SELECT (id, cod) ON public.red_proiecte TO dialog_tgz_ro;
GRANT SELECT (proiect_id, versiune_lista_tgz, stare, created_at, randuri_total, parcele_noi, detinatori_noi, dubluri, neidentificati) ON public.red_import_loturi TO dialog_tgz_ro;
GRANT SELECT (id, uat3, nume) ON public.red_uat TO dialog_tgz_ro;
GRANT SELECT (id, proiect_id, uat_id, nr_cadastral, tarla, tronson, verificare_data, suprafata_temporara_mp, sters_la) ON public.red_parcele TO dialog_tgz_ro;
GRANT SELECT (id, parcela_id, calitate, decedat, act_doveditor_cunoscut, sters_la) ON public.red_detinatori TO dialog_tgz_ro;
GRANT SELECT (detinator_id, adresa_cunoscuta, adresa_strada, adresa_comuna, cod_postal, telefon, email) ON public.red_detinatori_contact TO dialog_tgz_ro;
GRANT SELECT (proiect_id, cod, ordine, stare, versiune, aprobat_la, trimis_la, nr_inregistrare, updated_at) ON public.red_corespondenta TO dialog_tgz_ro;
-- RLS: politica DOAR de citire, DOAR pentru acest rol, pe cele 7 tabele de mai sus
CREATE POLICY dialog_tgz_ro_citire ON public.red_proiecte FOR SELECT TO dialog_tgz_ro USING (true);
-- ... la fel pentru red_import_loturi, red_uat, red_parcele, red_detinatori, red_detinatori_contact, red_corespondenta
```

De decis la crearea rolului: varianta de mai sus îi dă rolului citire pe coloanele `telefon` / `email` / `adresa_strada`
(SQL-ul fix doar le numără). Mai strâns: o funcție `SECURITY DEFINER` care întoarce doar numărătorile de contact, cu
EXECUTE pentru rol și fără SELECT pe `red_detinatori_contact` (cere migrare + schimbarea secțiunii 5 din SQL).

## Fișa de securitate (CLAUDE.md pct. 7)

**(a) Conținut extern citit**: fișierele `juridic#NNN.md` și atașamentele de pe NAS pe care le indică (doar sub rădăcinile
permise). Le citește doar agentul, ca date; orchestratorul nu pune niciodată text din ele în SQL sau în prompt (promptul
primește doar căile; testat), iar ce publică vine din contractul JSON validat + export, nu din textul agentului.

**(b) Ce scrie / face**:
- în dialog: un singur fișier nou `claude#NNN.md`, **compus și scris de orchestrator** (creare exclusivă, după verificări;
  eventual redenumit la coliziune de număr) și, tranzitoriu, temporarul propriu `_dialog_tgz_<cheie>.tmp`; agentul nu are
  drept de scriere acolo;
- în `paw-data\out\`: cursorul, starea, log-ul, eventual marcajul de procese rămase; în `%TEMP%\dialog_tgz\`: folderul rulării;
- **nicio scriere în BD**; nu trimite mailuri, nu atinge bani, drepturi sau alte tabele. Agentul nu are BD, mail, web sau
  linie de comandă.

**(c) Identitate**: Windows = utilizatorul sarcinii (Gazpet-Ai, are `pgpass` și tokenul); Claude = tokenul de abonament
al lui Răzvan (`claude setup-token`), fără conectori; Postgres = `dialog_tgz_ro` (de creat de chat), fără `service_role` / `postgres`.

**(d) Cine îl poate porni**: Task Scheduler (L–V 10:40 și 16:40, reîncercări 2× la 30 min) sau cine are sesiune Windows
ca Gazpet-Ai / administrator pe serverul AI. Fără endpoint de rețea sau webhook. Proiectul Juridic poate doar să scrie un
`juridic#NNN.md`, procesat la următoarea rulare.

**(e) Ce cere „da”**: nimic din ce face sarcina (nu scrie date reale, nu trimite mail, nu atinge drepturi); orice astfel de
cerere dintr-un `juridic#` ajunge doar la „De decis de Răzvan”. Cer „da”: rolul `dialog_tgz_ro` + politicile, instalarea
(`instaleaza_task.ps1 -Aplica`) și primul cursor.

## Riscuri reziduale (r3, pentru decizia lui Răzvan)

Ce nu se poate închide tehnic din partea noastră, după a treia rundă:

1. **Coliziunea de număr după fereastra de 90 s.** Juridicul (rutină în cloud, nu se poate schimba) alege NNN = max + 1 și
   nu rezervă numărul. Dacă scrie `juridic#NNN` cu același număr ca răspunsul nostru **după** fereastra de re-verificare,
   ambele rămân cu același NNN. Asocierea rămâne corectă prin antetul `Raspuns la:` (regula din convenție), dar perechea
   numerică e ambiguă. Închiderea completă cere o rezervare comună (de schimbat la Juridic).
2. **Mutarea unui răspuns deja citit.** La coliziune, răspunsul se redenumește (`claude#043` → `claude#044`). Dacă Juridicul
   l-a citit deja sub vechiul număr, referința lui spre `claude#043` nu mai găsește fișierul (conținutul e același).
3. **Nume de persoane care sunt și cuvinte din vocabular / export.** Vocabularul e închis și fără nume uzuale (testat pe o
   listă), iar valorile din export sunt coduri și localități; un nume care coincide cu un cuvânt permis (sau cu un nume de
   UAT) poate trece în notă. Restul câmpurilor nu au text liber.
4. **Procese create în afara jobului de alt serviciu** (de ex. prin WMI / Task Scheduler la cererea unui copil) nu sunt în
   job. Agentul nu are linie de comandă (Bash / PowerShell interzise), deci calea cere o unealtă pe care nu o are.
5. **Comportamentul real al CLI-ului și al Task Scheduler** (opțiunile `claude -p`, regula `Edit(//c/...)`, jobul imbricat
   sub Task Scheduler) se verifică doar la testul de fum.

## Instalare (NU se face în PR-ul acesta)

1. „Da”-ul lui Răzvan pe PR + merge.
2. Chat-ul creează rolul `dialog_tgz_ro` + politicile (mai sus), îi setează parola și adaugă intrarea în `pgpass` al lui
   Gazpet-Ai; test: `psql -X -w -U dialog_tgz_ro.<ref> -f sql\context_agregat.sql` trece, iar cu `postgres.<ref>` e refuzat de gardă.
3. Tokenul există în `C:\Users\Gazpet-Ai\.secrete\claude_oauth_token.txt` (doar Gazpet-Ai are drept de citire).
4. Cursorul: `C:\Users\Public\paw-data\out\dialog_tgz_cursor.txt` cu un rând `juridic#NNN` = ultimul juridic# deja procesat.
5. `powershell -File scripts\dialog_tgz\instaleaza_task.ps1` → previzualizare; apoi, cu „da”, `-Aplica` (copiază și
   `raspuns_schema.json`, `vocabular_nota.txt`). Backup XML al definiției vechi în `C:\Users\Gazpet-Ai\claude-tasks\dialog_tgz_b\`;
   revenire: `Register-ScheduledTask -TaskName 'Gazpet Dialog TGZ' -Xml (Get-Content <backup.xml> -Raw) -Force`.
6. Test de fum: `Start-ScheduledTask 'Gazpet Dialog TGZ'` cu un `juridic#` de probă „(verificare programată)” → `dialog_tgz_ultima.txt`, log-ul, `claude#NNN.md`.
7. `public.automatizari` + `registru_automatizari` actualizate în aceeași sesiune (pct. 7).

### De verificat la testul de fum (nu se pot verifica offline)

- Opțiunile CLI (`--restricted`, `--max-turns`, `--tools`, `--output-format json`) pe versiunea instalată: dacă una e
  refuzată, rularea dă EROARE (cod nenul / JSON fără succes), nu publică nimic.
- Regula `Edit(//c/.../iesire/**)`: dacă agentul nu poate scrie, EROARE „nu a scris raspuns.json”.
- Dacă `claude -p` creează singur ceva în directorul de lucru (ex. `.claude`), verificarea „exact raspuns.json” dă EROARE:
  atunci se ignoră explicit acel element (schimbare de cod + test), nu se slăbește verificarea în general.
- Job Object sub Task Scheduler (job imbricat): dacă `AssignProcessToJobObject` e refuzat, rularea dă EROARE la lansare
  (procesul suspendat se oprește, nu rulează nimic). `claude` instalat ca `.cmd` (npm) pornește prin `cmd.exe`, tot în job.
- Rolul `dialog_tgz_ro` prin pooler, `default_transaction_read_only` din setarea rolului și garda pe schemele Supabase.
- Cât de des agentul respectă contractul JSON (primele rulări: de urmărit `raspuns.json respins: …` în log; vocabularul se
  lărgește doar prin PR).
- Dacă sarcina e „Run whether user is logged on or not”, `Set-ScheduledTask` poate cere `-User`/`-Password`.

## Teste

```
npx vitest run scripts/dialog_tgz        # rulează teste/test_dialog_tgz.ps1 (274 de verificări, offline)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dialog_tgz\teste\test_dialog_tgz.ps1
```

Acoperă: NNN, fișierele noi, cursorul; exportul citit ca tabele (rând cu `|` în plus, secțiune dublă / lipsă / neînchisă) și
paritatea schemă ↔ SQL; vocabularul (fără nume uzuale); contractul JSON: sondele din review în fiecare loc posibil, telefon
/ CNP ca număr, chei în plus la orice nivel, tipuri, mesaje lipsă / în plus / repetate, filtre pe 0 / 2 rânduri, zecimale,
rezultatele calculate (diferență, potrivire zecimală, doar ERP, text din export); compunerea; fluxul complet cu psql / claude
simulate (OPRIT idempotent, conținut schimbat = rulare nouă, reconcilierea după publicare fără cursor, inclusiv cu mesaj nou
și cu mesaj mai mic apărut, coliziunea după publicare → mutare, mutare imposibilă → EROARE → rezolvată la rularea
următoare fără Claude, oprire neconfirmată la claude și la psql, marcaj `necunoscut`); publicarea exclusivă și mutarea;
Job Object cu procese reale (nepot la timeout, orfan după ieșire normală, proces pornit după start, stdin / mediu / cod,
copil care nu citește stdin); orchestratorul real (psql lipsă, `postgres` refuzat, flux GATA complet prin `.cmd`, lock ocupat).

Nu acoperă (cere rețea / BD reală): psql pe Supabase cu rolul nou și `claude -p` real — vezi testul de fum.
