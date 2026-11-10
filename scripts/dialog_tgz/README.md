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
  enumerări închise, coduri care trebuie să existe în exportul ERP, numere mărginite. `claude#NNN.md` îl **compune
  orchestratorul** din JSON-ul validat, iar valorile ERP le ia direct din export. Orice câmp în plus, tip greșit sau valoare în afara listelor = nepublicat. stderr-ul agentului: în log doar lungimea.
- **Numerotare:** creare exclusivă, apoi re-verificare (imediat și după o fereastră de 90 s): dacă a apărut `juridic#NNN` cu
  același NNN, răspunsul se **mută** atomic pe următorul număr liber. Coliziune nerezolvată = EROARE.
- **Procese:** psql și claude rulează într-un **Job Object** (pornite suspendate, puse în job, apoi reluate); la final tot
  jobul se oprește și se confirmă `ActiveProcesses = 0`. Neconfirmat = EROARE + marcaj care blochează rulările următoare.
- **Publicare vs. cursor:** fiecare răspuns poartă `Cheie:` (amprenta mesajelor la care răspunde). La pornire, un GATA deja
  publicat pentru mesaje încă necursate = doar avans de cursor; un OPRIT deja publicat pentru exact aceleași mesaje = nu se reia.

**r4 (după Jakarinos r3 NO-GO, rundă mică):**
- **Fără text liber:** câmpul `nota` și `vocabular_nota.txt` sunt scoase complet. Răspunsul publicat conține doar coduri din
  liste, cifre (din mesaj, mărginite, și din export) și textele fixe ale orchestratorului. Un `nota` în `raspuns.json` (orice
  valoare, inclusiv gol / null) = câmp în afara contractului = nepublicat. Schema are acum `versiune: 2`, iar o schemă care
  conține „nota” (limită, etichetă, versiunea 1) e refuzată la încărcare: nu există cale de activare din configurare.
  `instaleaza_task.ps1 -Aplica` șterge un `vocabular_nota.txt` vechi din destinație și verifică schema **instalată** cu
  modulul instalat.
- **Coliziune și la OPRIT:** un OPRIT deja publicat trece prin aceeași recuperare a coliziunii de număr ca GATA, înainte
  de ieșirea „deja publicat”; nerezolvabilă → EROARE „de reparat manual”, nu „deja publicat”.

**r5 (după Jakarinos r4 NO-GO): ieșirea unică, aplicată peste tot, nu caz cu caz.**
- Tot ce ajunge în `claude#NNN.md`, în jurnal, în fișierele de stare (ultima linie, cursor, marcaj de procese), în
  `context.md` al agentului sau pe stdout trece printr-un singur constructor, `Format-Mesaj`: un șablon FIX din catalogul
  modulului + valori tipizate. Tipurile acceptate: număr, dată, da/nu, cod dintr-o listă închisă definită în modul, celulă
  de export validată pe formatul coloanei, text deja compus de `Format-Mesaj`. Un text oarecare (din export, nume de fișier,
  mesaj de eroare al unei unelte, cale, stdout / stderr, variabilă de mediu) nu are tip acceptat: în locul lui se scrie un
  contor, un cod sau o lungime.
- Scrierile pe disc (`Write-FisierSigur`, `Publish-RaspunsExclusiv`, și prin ele `Write-JurnalSigur` / `Write-StareSigura`)
  primesc DOAR obiecte produse de `Format-Mesaj`. Testul verifică **static** (pe arborele sintactic al modulului și al
  orchestratorului) că nu există alte apeluri de scriere și că obiectul „text sigur” se creează într-un singur loc.
- **Exportul ERP:** fiecare coloană are un format fix în modul (`$script:FormatColoane`): listă închisă (coduri de proiect,
  stări, calitate) sau tipar strict, ancorat (`uat3` = 3 litere mari, cod corespondență, întregi, zecimale, date). Antetul
  trebuie să fie exact lista din modul. O valoare care nu respectă formatul devine `nevalidat-N` la citire, înainte de orice
  folosire (context, filtre, tabel publicat); jurnalul notează doar câte valori s-au înlocuit, pe coloană.
  `versiune_lista_tgz` (text liber în BD): 1–4 cuvinte din lista `TGZ / TEST / LOT / utilizatori / necunoscuta`, `vNN`, an
  sau dată `ZZ.LL.AAAA` din 2020–2039, cel mult 40 de caractere (exemple reale: „TGZ 13.07.2026”, „v2”). Numele UAT-ului
  (text liber editabil) nu se mai exportă.
- **Erorile:** cele proprii poartă doar un cod și numere (`Stop-Dtgz`); orice altă excepție devine „eroare neprevăzută”
  (categorie, HRESULT, lungimea mesajului), mesajul nu se scrie. psql rulează cu `VERBOSITY=sqlstate`, iar gărzile din SQL
  au coduri proprii (`DTG01` rolul poate scrie, `DTG02` nu vede proiecte, `DTG03` fără READ ONLY): din stderr se păstrează
  doar clasa (listă închisă) și SQLSTATE-ul. Lansarea eșuată a unui proces = etapă (cod fix) + cod Win32.
- **Folderul rulării** (context, `raspuns.json` al agentului, configurația CLI) se șterge la orice ieșire (și la EROARE);
  resturile unei rulări oprite brusc se șterg la pornirea următoarei.
- **Schema** e fixată prin amprentă (sha256, fără CR) în modul: orice schimbare de text din schemă (și una benignă) = refuz
  la încărcare; contractul se schimbă doar prin PR care schimbă și amprenta.
- **Testul canar** (`Strada Noua 12 / 0722/123/456 / Ion Popescu`), injectat pe rând în fiecare sursă din inventarul de mai
  jos, nu apare în niciun fișier produs de rulare (căutare în tot folderul testului, UTF-8 și UTF-16), nici în stare,
  jurnal sau stdout / stderr ale orchestratorului real; un mutant fără validarea coloanelor e prins de același test.

### Inventarul surselor de text extern (r5) și unde e oprită fiecare

| Sursa | Ce ajunge în ieșire | Unde e oprită | Test |
|---|---|---|---|
| Export ERP, fiecare coloană din cele 7 secțiuni | valoarea doar dacă respectă formatul coloanei, altfel `nevalidat-N`; numărul de înlocuiri | `ConvertFrom-ExportContext` + `Test-ValoareFormat`; la scriere încă o dată tipul „celulă” | 15a (51 de coloane), 4b |
| Export: antet, titluri de secțiune, linii străine (NOTICE) | nimic (antetul = listă exactă; titlurile vin din schemă; liniile străine se ignoră) | `ConvertFrom-ExportContext`, `ConvertTo-ContextSigur` | 15a |
| stdout / stderr / cod psql | clasa (listă închisă), SQLSTATE (5 caractere), lungimea, codul numeric | `Get-ClasaEroarePsql`, `e.psql` | 9, 10i, 15b |
| stdout claude (JSON) | `type` / `subtype` / `is_error` ca coduri din listă (`alt` / `lipsa`), `num_turns` număr | `ConvertFrom-IesireClaude` | 8, 15c |
| stderr claude, cod, timeout, procese rămase | lungimea; cod / bool doar dacă au tipul corect; PID-uri doar ca `pid|ticks` numeric (altfel `necunoscut`) | `Invoke-DialogTgz` (indexare + tip), `Write-MarcajProcese` | 10g, 15c |
| `raspuns.json` (agent): valori și nume de câmpuri | coduri din schemă, numere, celule din export; motivul respingerii = cod + calea câmpului (nume din contract) | `Test-RaspunsAgent`, `Stop-Raspuns`, tipul `cale` | 5, 15d |
| Nume de fișiere / foldere din dialog (noi, șterse, modificate) | doar contoare | `Compare-InstantaneuDialog` | 7, 10d, 15e |
| Conținutul `juridic#`, `_CONVENTIE_JURIDIC.md`, `claude#` străine | nimic (numere, cheia hex, starea) | `Find-JuridicNoi`, `Get-RaspunsuriProprii` | 15e |
| Excepții PowerShell / .NET (căi, mesaje) | categorie, HRESULT, lungime | `ConvertTo-MesajEroare` | 15b, 15c |
| Cursor, marcaj, token (conținut și cale) | cod de eroare fix | `Read-Cursor`, `Test-MarcajProcese`, `Read-TokenFisier` | 15f |
| Configurare: căi, model, effort, id, MaxTurns, schemă, prompt, rădăcini NAS | coduri fixe; modelul / effortul doar dacă sunt în lista din modul; rădăcini = număr | `Invoke-DialogTgz` (pasul 0), `dialog_tgz.ps1` | 14, 15f |
| Variabile de mediu (inclusiv `PGPASSWORD`, `ANTHROPIC_API_KEY`) | nimic (doar mediul proceselor copil) | `Invoke-ProcesCapturat` | 15g |
| stdout / stderr ale orchestratorului | nimic (scriptul nu scrie pe consolă; modul neîncărcat = ieșire 1 fără text) | `dialog_tgz.ps1` | 13, 15g |

În afara rulării: `instaleaza_task.ps1` (pornit de mână de chat) afișează pe consolă propria configurare (acțiunea sarcinii,
căile de instalare); nu citește conținut extern.

## Fișiere

| Fișier | Rol |
|---|---|
| `dialog_tgz.ps1` | Orchestratorul (sarcina programată îl pornește). Lock, stare, log, cod de ieșire. |
| `DialogTgz.psm1` | Logica: fișiere noi, cursor, contractul JSON, compunerea, cheia, reconcilierea, publicarea, Job Object, fluxul `Invoke-DialogTgz`. |
| `raspuns_schema.json` | Contractul răspunsului (UTF-8): stări, motive, cereri, „de decis”, secțiunile exportului (chei + indicatori), limite, etichetele în română. Sursă unică pentru validare, compunere și prompt. |
| `dialog_tgz_prompt.md` | Promptul pentru `claude -p` (șablon; codurile și secțiunile se completează din schemă). |
| `sql/context_agregat.sql` | Singurul SQL: gardă de rol doar-citire, apoi cifre agregate din `red_*`, `BEGIN READ ONLY`, ieșire nealiniată (`|`). |
| `instaleaza_task.ps1` | Înlocuiește acțiunea sarcinii existente. Implicit **doar previzualizare**; scrie numai cu `-Aplica`. |
| `teste/test_dialog_tgz.ps1` | Autotest offline (611 verificări): psql și claude simulate, procese reale în Job Object, orchestratorul real cu psql / claude simulate prin `.cmd`, testul canar pe fiecare sursă, verificarea statică a scrierilor, mutantul. |
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
3. **Token** (`C:\Users\Gazpet-Ai\.secrete\claude_oauth_token.txt`, prefix `sk-ant-oat01-`), folderul de dialog și schema
   (versiunea 2, fără „nota”). Orice lipsă → EROARE clară, înainte de BD și de Claude.
4. **Cursor** (`dialog_tgz_cursor.txt`; lipsă / alt format → EROARE). Temporarele proprii rămase în dialog
   (`_dialog_tgz_<cheie>.tmp`, după o rulare oprită brusc) se șterg.
5. **Fișiere noi**: `juridic#NNN.md` cu NNN > cursor și „(verificare programată)” în antet; pentru fiecare, amprenta sha256.
6. **Reconciliere cu dialogul** (L05: starea se citește din dialog, nu dintr-un marcaj local):
   - un `claude#` al sarcinii, cu ultima linie GATA, pentru o parte din mesajele noi, cu `Cheie:` egală cu amprenta
     actuală a acelor mesaje → răspunsul există deja (rulare oprită între publicare și cursor): se rezolvă eventuala
     coliziune de număr, se mută cursorul, **fără inferență nouă**; dacă între timp a apărut un mesaj programat cu număr
     mai mic, neacoperit → EROARE (decide chat-ul);
   - un `claude#` OPRIT cu cheia exactă a mesajelor noi → întâi se rezolvă eventuala coliziune de număr (ca la GATA;
     nerezolvabilă → EROARE, de reparat manual), apoi `OPRIT deja publicat`, nu se reia (până se schimbă mesajele);
   - niciun mesaj nou → `NIMIC NOU`, fără BD și fără Claude.
7. **Folderul rulării**: `%TEMP%\dialog_tgz\rulari\<id>\intrare\` (context), `...\iesire\` (singurul loc unde agentul
   poate scrie) și `...\cfg\` (configurația Claude Code a rulării). Se șterge la orice ieșire (r5).
8. **Export**: psql `context_agregat.sql` (în Job Object, `VERBOSITY=sqlstate`) → citit ca tabele cu antetul exact din modul,
   fiecare valoare validată pe formatul coloanei (altfel `nevalidat-N`); trebuie să aibă toate secțiunile, cheile și
   indicatorii din schemă (altfel EROARE) → `intrare\context.md` recompus din valorile validate.
9. **Agentul**: `claude -p` în Job Object (detalii mai jos), cu directorul de lucru = `iesire\`. Scrie `iesire\raspuns.json`.
10. **Verificări după agent** (orice abatere = EROARE, nimic publicat, cursor neschimbat): oprirea confirmată, fără
    timeout, cod 0, JSON-ul CLI cu `subtype=success` și `is_error=false`; în `iesire\` exact `raspuns.json`; dialogul
    neatins (excepție: `juridic#` noi), aceleași amprente, niciun mesaj programat cu număr mai mic apărut între timp.
11. **Contractul** (`Test-RaspunsAgent`, vezi mai jos). EROARE din partea agentului = nepublicat.
12. **Compunerea** (`Format-RaspunsPublicat`): antetul (`De la`, `Data`, `Subiect`, `Raspuns la: juridic#…`, `Cheie:`),
    pe fiecare mesaj tabelul de verificare (secțiune, rând, indicator, valoarea din mesaj, **valoarea din export**, rezultatul
    calculat de program), afirmațiile neverificabile, atașamentele (doar numere), „De decis de Răzvan” (etichete din
    schemă); fără text liber; ultima linie `GATA` sau `OPRIT <eticheta motivului>`. Textul compus mai trece o dată prin
    filtrul de tipare (telefon, CNP, e-mail, adresă, act) și prin limita de 200 KB.
13. **Publicare**: temporar `_dialog_tgz_<cheie>.tmp` în dialog, apoi `File.Move` pe următorul număr liber (atomic, eșuează
    dacă destinația există: nu suprascrie niciodată; ocupat → alt număr). Apoi **re-verificare**: imediat și după
    `-AsteptareColiziuneSec` (implicit 90): dacă există `juridic#NNN` cu același număr, răspunsul se redenumește exclusiv pe
    următorul liber (conținutul nu depinde de număr), de cel mult 5 ori; nerezolvat (de ex. fișier deschis de un cititor) →
    EROARE, cursorul nu se mută, rularea următoare reconciliază (pasul 6) și reîncearcă mutarea.
14. **Cursor** (doar GATA): `juridic#<cel mai mare procesat> (raspuns claude#<numărul final>, …)`, CAS pe valoarea citită la
    pasul 4, scriere atomică. Eșec → EROARE; rularea următoare reconciliază.
15. **Stare + log**: doar texte din `Format-Mesaj` (șablon fix + valori tipizate), prin `Write-StareSigura` /
    `Write-JurnalSigur`; ultima barieră de tipare (telefon, CNP, e-mail, adresă, act) rămâne pe fiecare text produs.

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
                "de_decis": [ <coduri> ] } ] }
```

Reguli (fiecare încălcare = nepublicat; motivul din stare / log conține doar calea câmpului și codul, niciodată valoarea):
- nicio cheie în afara contractului, la niciun nivel; tipuri stricte (întreg ≠ text ≠ zecimal; bool respins);
- coduri doar din listele schemei; `filtru` doar cu cheile secțiunii, obligatoriu `proiect`, valori existente în export,
  și trebuie să aleagă **exact un rând**; valoarea ERP o ia programul din acel rând;
- `valoare_juridic`: număr 0 … 9.999.999,99 cu cel mult 2 zecimale (un telefon sau un CNP nu încap), sau un text care
  există deja în acea coloană a exportului;
- **niciun câmp de text liber** (r4): `nota` nu mai există; orice câmp în plus, inclusiv `nota`, e respins.
  Sondele din review (r2: `Ion Popescu`, `AB 123456`, `Strada Florilor 12`; r3: `0722/123/456`, `Strada Noua 12`) sunt
  respinse ca `nota`, în filtre, în coduri, în valori și în câmpuri în plus (testat, cu verificarea că valoarea nu apare în
  stare / jurnal), iar textul publicat pentru răspunsul valid maxim (GATA și OPRIT) nu conține niciuna.

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
GRANT SELECT (id, uat3) ON public.red_uat TO dialog_tgz_ro;
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

## Riscuri reziduale (r4 + r5, pentru decizia lui Răzvan)

r5: un proiect nou în dialog (alt cod decât `LOT1-PRUNISOR-JUPA` / `TEST-RAZVAN`) sau o versiune de listă într-o formă
nouă apar ca `nevalidat-N` până la un PR care le adaugă în modul (sigur, dar mai puțin util). Codurile reale de proiect și
valorile `versiune_lista_tgz` din BD le confirmă chat-ul înainte de instalare.

Ce nu se poate închide tehnic din partea noastră:

1. **Coliziunea târzie de număr (numită de Jakarinos r3 „acceptabilă ca risc rezidual scris”).** Juridicul (rutină în
   cloud, nu se poate schimba) alege NNN = max + 1 și nu rezervă numărul. Dacă scrie `juridic#NNN` cu același număr ca
   răspunsul nostru **după** ultima re-verificare (fereastra de 90 s; la OPRIT și la rularea următoare), ambele rămân cu
   același NNN. Condițiile pentru acceptare, de decis de Răzvan:
   - asocierea se face **obligatoriu** după antetul `Raspuns la: juridic#…` (regula din convenție), nu după număr;
   - exploatarea acceptă că un răspuns deja citit poate fi redenumit (`claude#043` → `claude#044`, același conținut);
   - o coliziune care rămâne (inclusiv pentru OPRIT, când mutarea e imposibilă) se **repară manual** de chat: starea arată
     EROARE cu numele fișierului.
   Închiderea completă cere o rezervare comună a numerelor (de schimbat la Juridic).
2. **Procese create în afara jobului de alt serviciu** (de ex. prin WMI / Task Scheduler la cererea unui copil) nu sunt în
   job. Agentul nu are linie de comandă (Bash / PowerShell interzise), deci calea cere o unealtă pe care nu o are.
3. **Comportamentul real al CLI-ului și al Task Scheduler** (opțiunile `claude -p`, regula `Edit(//c/...)`, jobul imbricat
   sub Task Scheduler) se verifică doar la testul de fum.

## Instalare (NU se face în PR-ul acesta)

1. „Da”-ul lui Răzvan pe PR + merge.
2. Chat-ul creează rolul `dialog_tgz_ro` + politicile (mai sus), îi setează parola și adaugă intrarea în `pgpass` al lui
   Gazpet-Ai; test: `psql -X -w -U dialog_tgz_ro.<ref> -f sql\context_agregat.sql` trece, iar cu `postgres.<ref>` e refuzat de gardă.
3. Tokenul există în `C:\Users\Gazpet-Ai\.secrete\claude_oauth_token.txt` (doar Gazpet-Ai are drept de citire).
4. Cursorul: `C:\Users\Public\paw-data\out\dialog_tgz_cursor.txt` cu un rând `juridic#NNN` = ultimul juridic# deja procesat.
5. `powershell -File scripts\dialog_tgz\instaleaza_task.ps1` → previzualizare; apoi, cu „da”, `-Aplica` (copiază și
   `raspuns_schema.json`; șterge un `vocabular_nota.txt` vechi și verifică schema instalată). Backup XML al definiției vechi în `C:\Users\Gazpet-Ai\claude-tasks\dialog_tgz_b\`;
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
- r5: psql-ul instalat acceptă `-v VERBOSITY=sqlstate` (PG ≥ 12) și gărzile ies cu `DTG01` / `DTG02` / `DTG03`; o versiune
  veche de psql ar scrie mesajul întreg pe stderr, dar orchestratorul tot nu îl scrie (doar clasa, din text).
- r5: `claude -p` cu `CLAUDE_CONFIG_DIR` nou la fiecare rulare (în folderul rulării) pornește fără pas interactiv.
- r5: `SELECT DISTINCT cod FROM red_proiecte` și `SELECT DISTINCT versiune_lista_tgz FROM red_import_loturi` se potrivesc
  listei / gramaticii din modul (altfel apar ca `nevalidat-N`).
- Cât de des agentul respectă contractul JSON (primele rulări: de urmărit `raspuns.json respins: …` în log; contractul se
  schimbă doar prin PR).
- Dacă sarcina e „Run whether user is logged on or not”, `Set-ScheduledTask` poate cere `-User`/`-Password`.

## Teste

```
npx vitest run scripts/dialog_tgz        # rulează teste/test_dialog_tgz.ps1 (611 verificări, offline, ~1 min)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dialog_tgz\teste\test_dialog_tgz.ps1
```

Acoperă: NNN, fișierele noi, cursorul; exportul citit ca tabele (rând cu `|` în plus, secțiune dublă / lipsă / neînchisă) și
paritatea schemă ↔ SQL; schema fără „nota” (versiunea 1 / limită / etichetă refuzate la încărcare); contractul JSON: sondele din review în fiecare loc posibil, telefon
/ CNP ca număr, chei în plus la orice nivel, tipuri, mesaje lipsă / în plus / repetate, filtre pe 0 / 2 rânduri, zecimale,
rezultatele calculate (diferență, potrivire zecimală, doar ERP, text din export); compunerea; fluxul complet cu psql / claude
simulate (OPRIT idempotent, conținut schimbat = rulare nouă, reconcilierea după publicare fără cursor, inclusiv cu mesaj nou
și cu mesaj mai mic apărut, coliziunea după publicare → mutare, mutare imposibilă → EROARE → rezolvată la rularea
următoare fără Claude, la GATA și la OPRIT, oprire neconfirmată la claude și la psql, marcaj `necunoscut`); publicarea exclusivă și mutarea;
Job Object cu procese reale (nepot la timeout, orfan după ieșire normală, proces pornit după start, stdin / mediu / cod,
copil care nu citește stdin); orchestratorul real (psql lipsă, `postgres` refuzat, flux GATA complet prin `.cmd`, lock ocupat).

Nu acoperă (cere rețea / BD reală): psql pe Supabase cu rolul nou și `claude -p` real — vezi testul de fum.
