# Gazpet Dialog TGZ — varianta B (token `claude setup-token`, fără conectori)

Decizia lui Răzvan, 06.11.2026. Sarcina Windows „Gazpet Dialog TGZ” rulează L–V la 10:40 și 16:40 pe serverul AI
(Gazpet-Claude) și răspunde la mesajele Proiectului Juridic marcate „(verificare programată)” din canalul de dialog
`C:\Users\Public\paw-data\dialog\` (convenția: `_CONVENTIE_JURIDIC.md` din folder și `docs/paw/paw_juridic/README.md`,
secțiunea „Dialog cu sesiunea chat”).

Varianta B rulează **doar** cu tokenul de un an din `claude setup-token`, care nu are conectorii claude.ai
(Gmail, Drive, Supabase). De aceea partea de BD o face orchestratorul, cu psql și o interogare fixă; agentul primește
doar fișiere locale.

**r2 (după Jakarinos r1 NO-GO):** ERP-ul e strict doar-citire (nicio scriere în BD; cursorul stă într-un fișier local,
iar SQL-ul refuză un rol care poate scrie). Agentul nu mai are drept de scriere în dialog: scrie un singur fișier în
folderul privat al rulării, iar orchestratorul îl verifică (stare, mărime, date personale) și îl publică el, prin creare
exclusivă. Timeout, cod de ieșire nenul sau rezultat fără succes = EROARE, fără publicare și fără avansul cursorului.
Oprirea proceselor la timeout se confirmă.

## Fișiere

| Fișier | Rol |
|---|---|
| `dialog_tgz.ps1` | Orchestratorul (sarcina programată îl pornește). Lock, stare, log, cod de ieșire. |
| `DialogTgz.psm1` | Logica: fișiere noi, cursor, date personale, publicare exclusivă, procese psql / claude, fluxul `Invoke-DialogTgz`. |
| `dialog_tgz_prompt.md` | Promptul pentru `claude -p` (șablon cu marcaje `{{...}}` completate doar cu căi și numere). |
| `sql/context_agregat.sql` | Singurul SQL: gardă de rol doar-citire, apoi cifre agregate din `red_*`, `BEGIN READ ONLY`, fără date personale. |
| `instaleaza_task.ps1` | Înlocuiește acțiunea sarcinii existente. Implicit **doar previzualizare**; scrie numai cu `-Aplica`. |
| `teste/test_dialog_tgz.ps1` | Autotest offline (234 de verificări): psql și claude simulate, procese reale, orchestratorul real cu psql / claude simulate prin `.cmd`. |
| `teste/dialog_tgz.test.js` | Rulează autotestul PowerShell sub `npx vitest run` (doar pe Windows, cu powershell.exe; pe CI Linux se sare). |

Toate `.ps1` / `.psm1` sunt ASCII (PowerShell 5.1 citește fișierele fără BOM ca ANSI). Autotestul verifică acest lucru.

## Fișiere de stare (în `C:\Users\Public\paw-data\out\`)

| Fișier | Conținut |
|---|---|
| `dialog_tgz_cursor.txt` | Un singur rând: `juridic#NNN (raspuns claude#NNN, AAAA-LL-ZZ HH:MM)` = ultimul juridic# procesat. Îl scrie chat-ul la instalare (`juridic#NNN`), apoi doar orchestratorul, după un GATA publicat. |
| `dialog_tgz_ultima.txt` | `AAAA-LL-ZZ HH:MM:SS <ultima linie>` după fiecare rulare (chat-ul o citește). |
| `dialog_tgz_<AAAA-LL-ZZ>.log` | Log-ul zilei, cu id de rulare. |
| `dialog_tgz_procese_ramase.txt` | Există doar după o oprire neconfirmată: `pid|pornire` pe rând. Cât timp un proces listat trăiește, rulările dau EROARE. |
| `dialog_tgz.lock` | Lock-ul global (fișier deschis exclusiv). |

## Fluxul unei rulări

1. **Lock global**: `dialog_tgz.lock` deschis exclusiv (merge între sesiuni Windows și se eliberează și dacă procesul
   moare). Dacă e ocupat, rularea notează în log și iese cu 0, fără să atingă starea.
2. **Procese rămase**: dacă există `dialog_tgz_procese_ramase.txt` și un proces din el e încă viu (același PID și
   același moment de pornire) → EROARE, nu pornește nimic. Dacă toate au dispărut, marcajul se șterge.
3. **Token**: citit din `C:\Users\Gazpet-Ai\.secrete\claude_oauth_token.txt`. Dacă lipsește sau nu începe cu
   `sk-ant-oat01-`, EROARE clară, înainte de BD și de Claude. Valoarea nu apare în log sau în stare.
4. **Cursor**: `dialog_tgz_cursor.txt`. Lipsă sau alt format → EROARE (nu se ghicește).
5. **Fișiere noi**: `juridic#NNN.md` cu NNN mai mare decât cursorul și cu „(verificare programată)” (cu sau fără
   diacritice) în antet. Niciunul → `NIMIC NOU`, ieșire 0, fără BD și fără Claude. Pentru fiecare se ține amprenta sha256.
6. **Folderul rulării**: `%TEMP%\dialog_tgz\rulari\<id>\intrare\` (context) și `...\iesire\` (singurul loc unde agentul
   poate scrie). Configurația Claude Code a sarcinii stă în `%TEMP%\dialog_tgz\cfg\`, în afara folderelor date agentului.
7. **Export**: psql `context_agregat.sql` → `intrare\context.md`. Garda din SQL oprește exportul dacă rolul poate scrie
   ceva sau nu vede niciun proiect (vezi „Rolul de BD”).
8. **Agentul**: `claude -p` (detalii mai jos), cu directorul de lucru = `iesire\`. Scrie `iesire\raspuns.md`, cu ultima
   linie `GATA`, `OPRIT <motiv>` sau `EROARE <motiv>`.
9. **Verificări după agent** (orice abatere = EROARE, nimic publicat, cursor neschimbat):
   - oprirea confirmată (altfel se scrie marcajul de procese rămase); fără timeout; cod de ieșire 0;
   - stdout JSON cu `type=result`, `subtype=success`, `is_error=false` (de ex. `error_max_turns` = eșec);
   - în `iesire\` există exact `raspuns.md`, fișier obișnuit, nimic altceva;
   - dialogul nu s-a schimbat (excepție: `juridic#NNN.md` noi), fișierele procesate au aceeași amprentă;
   - niciun `juridic#` programat apărut în timpul rulării cu număr mai mic decât cel mai mare procesat;
   - `raspuns.md`: UTF-8 valid, cel mult 200 KB (peste = refuz, nu tăiere), corp nevid, ultima linie recunoscută;
   - fără date personale în textul care s-ar publica (vezi mai jos). La detecție starea spune doar codurile (`TELEFON`, `CNP`…).
10. **Publicare** (doar GATA / OPRIT): NNN = următorul liber din folder **în acel moment**; textul complet se scrie într-un
    fișier temporar din dialog și se mută cu `File.Move` (atomic pe același volum, eșuează dacă destinația există: nu
    suprascrie niciodată). Dacă alt scriitor a luat `claude#NNN` sau `juridic#NNN`, se reia cu următorul număr.
    Antetul îl scrie programul: `De la`, `Data`, `Subiect`, `Raspuns la: juridic#…` (asocierea se face prin antet, ca în
    convenția canalului, nu prin egalitatea numerelor), apoi corpul agentului, apoi `GATA claude#NNN` / `OPRIT <motiv>`.
11. **Cursor** (doar GATA): `juridic#<cel mai mare procesat> (raspuns claude#NNN, …)`, cu CAS pe valoarea citită la pasul 4
    (dacă a fost mutat de mână între timp → EROARE, nu se suprascrie) și scriere atomică (temporar + `File.Replace`).
12. **Stare + log**: `dialog_tgz_ultima.txt` și log-ul zilei. Tot ce intră în log și în stare trece prin filtrul de token și
    de date personale.

Coduri de ieșire: **0** = GATA / NIMIC NOU / OPRIT / lock ocupat; **1** = EROARE.

`OPRIT` înseamnă că mesajul cere altceva decât o verificare sau e suspect: răspunsul se publică, cursorul nu se mută,
deci la rularea următoare aceleași fișiere se reiau până când chat-ul / Răzvan decid (sau mută cursorul de mână).
`EROARE` din partea agentului nu se publică; `raspuns.md` rămâne în folderul rulării pentru diagnostic.

### Date personale (filtrul din `Find-DatePersonale`)

Telefon (mobil și fix RO, cu +40 / 0040 / 0, cu sau fără separatori, `(0244) …`), CNP (13 cifre izolate), e-mail, adresă
(stradă / bulevard / calea / aleea / șosea / sat … `nr.` cifră; `bl. … sc. …`; `ap. N`), serie de act de identitate.
Granițele de cifre/litere evită hash-urile și codurile. **Numele de persoane nu se pot recunoaște sigur cu tipare**: pentru
ele rămân regula din prompt și faptul că exportul din BD nu conține nume. Filtrul se aplică pe tot textul înainte de
tăiere (o valoare la granița de tăiere nu scapă pe jumătate).

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

- Directorul de lucru = `iesire\` al rulării; promptul intră pe stdin (nu pe linia de comandă).
- Singura regulă de scriere e pe `iesire\` (unic pe rulare: un proces rămas dintr-o rulare veche nu scrie în cea nouă).
  Dialogul și contextul sunt doar `--add-dir` (citire). `dontAsk` refuză orice altceva.
- Mediul procesului copil: `CLAUDE_CODE_OAUTH_TOKEN` = tokenul din fișier; `CLAUDE_CONFIG_DIR` = `%TEMP%\dialog_tgz\cfg`
  (izolat de profilul Claude Code al serverului); `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` scoase.
- Timeout 50 min (sub limita de 1 h a sarcinii) → instantaneu al arborelui de procese (Win32_Process, cu momentul
  pornirii), `taskkill /T /F`, apoi `Stop-Process` pe ce a rămas, apoi verificare până la 30 s că nu mai trăiește niciunul.
  Neconfirmat → EROARE + `dialog_tgz_procese_ramase.txt`.
- Rădăcini pentru atașamente: `-RadaciniAtasamente` (implicit `\\gazpet-tnas\Licitatii_Executate`); se dau agentului doar
  cele care există la momentul rulării.

## Rolul de BD doar-citire (pas pentru chat, NU e făcut în PR)

Orchestratorul refuză din start utilizatorii care pot scrie (`postgres`, `service_role`, `supabase_admin`,
`authenticator`, `authenticated`, `anon`) și folosește implicit `dialog_tgz_ro.dxczwkbciseqniprspcu`. Garda din
`context_agregat.sql` refuză (cu lista exactă a drepturilor în plus): SUPERUSER / BYPASSRLS / CREATEROLE / CREATEDB /
REPLICATION, lipsa `default_transaction_read_only = on`, apartenența la orice alt rol, INSERT / UPDATE (și pe coloane) /
DELETE / TRUNCATE / TRIGGER pe orice relație din orice schemă non-sistem (și prin PUBLIC), USAGE / UPDATE pe secvențe,
CREATE pe scheme sau pe bază; plus „nu vede niciun proiect” (RLS fără politică = cifre false 0). Testată semantic pe
PGlite (17 cazuri, toate refuzate / acceptate corect; SQL-ul din r1 le accepta pe toate).

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
permise). Le citește doar agentul, ca date; promptul spune explicit că nu sunt instrucțiuni. Orchestratorul nu pune
niciodată text din ele în SQL sau în prompt (promptul primește doar căile; testat).

**(b) Ce scrie / face**:
- în dialog: un singur fișier nou `claude#NNN.md`, scris de **orchestrator** (creare exclusivă, după verificări); agentul nu
  are drept de scriere acolo;
- în `paw-data\out\`: cursorul, starea, log-ul, eventual marcajul de procese rămase; în `%TEMP%\dialog_tgz\`: folderul rulării;
- **nicio scriere în BD** (nici `claude_docs`, nici `red_*`): exportul e `BEGIN READ ONLY`, cu rol fără drepturi de scriere
  (verificat în SQL); nu trimite mailuri, nu atinge bani, drepturi sau alte tabele. Agentul nu are BD, mail, web sau linie de comandă.

**(c) Identitate**:
- Windows: utilizatorul sarcinii (Gazpet-Ai), care are `pgpass` și fișierul de token.
- Claude: tokenul de abonament al lui Răzvan (`claude setup-token`, un an), fără conectori claude.ai.
- Postgres: `dialog_tgz_ro` (de creat de chat, mai sus) prin pooler, parola din `pgpass`. Fără `service_role` sau `postgres`.

**(d) Cine îl poate porni**: Task Scheduler (L–V 10:40 și 16:40, reîncercări 2× la 30 min) sau cine are sesiune Windows
ca Gazpet-Ai / administrator pe serverul AI. Fără endpoint de rețea sau webhook. Proiectul Juridic poate doar să scrie un
`juridic#NNN.md`, procesat la următoarea rulare.

**(e) Ce cere „da”**: nimic din ce face sarcina, pentru că nu scrie date reale, nu trimite mail și nu atinge drepturi; orice
astfel de cerere dintr-un `juridic#` ajunge doar la „De decis de Răzvan” în răspuns. Cer „da”: crearea rolului
`dialog_tgz_ro` + politicile, instalarea (`instaleaza_task.ps1 -Aplica`) și primul cursor.

Regula tare de la pct. 7 (citește conținut extern **și** scrie): scrierea e limitată la un fișier nou în canalul de dialog,
scris de program după verificări, și la fișierele de stare locale; nu există acțiune externă declanșabilă prin conținut.

## Instalare (NU se face în PR-ul acesta)

1. „Da”-ul lui Răzvan pe PR + merge.
2. Chat-ul creează rolul `dialog_tgz_ro` + politicile (mai sus), îi setează parola și adaugă intrarea în `pgpass` al lui
   Gazpet-Ai; test: `psql -X -w -U dialog_tgz_ro.<ref> -f sql\context_agregat.sql` trece, iar cu `postgres.<ref>` e refuzat de gardă.
3. Tokenul există în `C:\Users\Gazpet-Ai\.secrete\claude_oauth_token.txt` (doar Gazpet-Ai are drept de citire).
4. Cursorul: `C:\Users\Public\paw-data\out\dialog_tgz_cursor.txt` cu un rând `juridic#NNN` = ultimul juridic# deja
   procesat (valoarea din rândul „Dialog TGZ” din `handoff_activ`, dacă există; altfel numărul ales de chat).
5. `powershell -File scripts\dialog_tgz\instaleaza_task.ps1` → previzualizare; apoi, cu „da”, `-Aplica`. Backup XML al
   definiției vechi în `C:\Users\Gazpet-Ai\claude-tasks\dialog_tgz_b\`; revenire:
   `Register-ScheduledTask -TaskName 'Gazpet Dialog TGZ' -Xml (Get-Content <backup.xml> -Raw) -Force`.
6. Test de fum: `Start-ScheduledTask 'Gazpet Dialog TGZ'` cu un `juridic#` de probă „(verificare programată)” → `dialog_tgz_ultima.txt`, log-ul, `claude#NNN.md`.
7. `public.automatizari` + `registru_automatizari` actualizate în aceeași sesiune (pct. 7). Rândul „Dialog TGZ” din
   `handoff_activ` nu mai e folosit de sarcină (sursa e cursorul local).

### De verificat la testul de fum (nu se pot verifica offline)

- Opțiunile CLI (`--restricted`, `--max-turns`, `--tools`, `--output-format json` cu `type/subtype/is_error`) pe versiunea
  instalată: dacă una e refuzată, rularea dă EROARE (cod nenul / JSON fără succes), nu publică nimic.
- Regula `Edit(//c/.../iesire/**)` (forma POSIX pentru Windows): dacă agentul nu poate scrie, EROARE „nu a scris raspuns.md”.
- Dacă `claude -p` creează singur ceva în directorul de lucru (ex. `.claude`), verificarea „exact raspuns.md” dă EROARE:
  atunci se ignoră explicit acel element (schimbare de cod + test), nu se slăbește verificarea în general.
- Rolul `dialog_tgz_ro` prin pooler (Supavisor, `rol.<ref>`), `default_transaction_read_only` venit din setarea rolului,
  și garda pe schemele gestionate de Supabase: dacă PUBLIC are un drept de scriere/CREATE pe o schemă de sistem
  Supabase, garda o listează și refuză; decizia (revocare sau excepție explicită în gardă) e a chat-ului.
- Dacă sarcina e „Run whether user is logged on or not”, `Set-ScheduledTask` poate cere `-User`/`-Password`.

## Teste

```
npx vitest run scripts/dialog_tgz        # rulează teste/test_dialog_tgz.ps1 (234 de verificări, offline)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dialog_tgz\teste\test_dialog_tgz.ps1
```

Acoperă: NNN, fișierele noi, cursorul (format, CAS, atomic, nu dă înapoi), ultima linie și `raspuns.md` (BOM, gol, fără
corp, peste 200 KB, UTF-8 invalid), filtrul de date personale (17 pozitive, 14 negative, granița de tăiere), argumentele
agentului (scriere doar în `iesire\`, nicio regulă pe dialog, JSON), rezultatul JSON (8 forme de eșec), SQL-ul (un singur
fișier, fără DML în afara șirurilor, fără variabile / meta-comenzi în afară de `\echo` / `\pset`, garda înaintea citirilor),
fluxul complet cu psql / claude simulate (marcate în test `[P1-ERP]`, `[P1-DIALOG]`, `[P1-DATE]`, `[P1-ESEC]`,
`[P1-NUMAR]`, `[P2-OPRIRE]`), publicarea exclusivă în concurență, oprirea reală a unui arbore de procese (copil + nepot)
și orchestratorul real (psql lipsă, utilizator `postgres` refuzat înainte de conectare, flux GATA complet cu psql / claude
simulate prin `.cmd`, lock ocupat).

Nu acoperă (cere rețea / BD reală): psql pe Supabase cu rolul nou și `claude -p` real — vezi testul de fum.
