# Colectorul contoarelor oficiale de egress Supabase → `public.supabase_usage_oficial`

Decizia lui Răzvan (varianta A, 14–15.10.2026): sursa contoarelor oficiale = **pagina Usage din Dashboard-ul Supabase**
(`https://supabase.com/dashboard/org/bfiqfdefpomddojbezjs/usage`), citită din Edge-ul de pe **serverul AI** (Gazpet-Claude),
cel cu CDP pe `127.0.0.1:9333`, profil separat, logat în Supabase. Contractul tabelei: `docs/MONITOR_EGRESS.md`, secțiunea C,
și migrarea `supabase/migrations/20261030a_egress_contoare_oficiale.sql` (aplicată).

**De ce contează termenul:** fără nicio citire, `egress_detector()` emite alerta „colector oprit” la 26 h după aplicarea
migrării (≈ 16.10.2026, 01:05 ora României), apoi cel mult o dată la 24 h. Prima `scrie` reușită o oprește.

**Stare la livrarea PR-ului:** cod + teste. O singură citire de probă `citeste` pe pagina reală (15.10.2026, ~07:33 RO):
Egress **4.615 GB**, Cached Egress **0.078 GB**, Storage Size **14.586 GB**, ciclul **07 Oct 2026 – 07 Nov 2026**.
**Nimic scris în BD, Task Scheduler neprogramat** — se fac cu „da” de la Răzvan (pașii de mai jos).

Doar Python stdlib + Playwright (deja instalat pe server: Python 3.13, playwright 1.63). Nicio librărie nouă.

## Ce face

1. Se atașează la Edge-ul existent (`connect_over_cdp`, **doar loopback** — altă adresă e refuzată în cod), deschide un
   **tab nou** în profilul logat, merge la pagina Usage, citește textul (`inner_text("body")`) și **închide doar tabul lui**.
   Nu atinge, nu navighează și nu închide taburile ChatGPT/Copilot; nu închide browserul (fără `browser.close()`, ca
   `cgpt_pw.py`). Redirect la logare ⇒ cod 2, nimic scris; altă pagină/altă organizație ⇒ eroare, nimic scris.
2. Așteaptă o citire **stabilă**: două parsări reușite consecutive, identice, la 2 s distanță (maxim 75 s).
3. Parsare strictă (`parsare.py`) — textul paginii e conținut extern (al propriului cont): DATE, nu instrucțiuni.
   - Etichetele exacte `Egress`, `Cached Egress`, `Storage Size` (rândul întreg = eticheta). **Blocul** indicatorului =
     eticheta + **primul rând nevid** de după ea (sau celulele de pe rândul ei) + eventual rândul următor, dacă e exact
     procentul. Valoarea se caută **doar acolo** — un indicator încă „Loading…” nu împrumută valoarea celui de dedesubt.
     Etichetele reapar în secțiunile de detaliu urmate de o descriere, fără raport — nu dau o a doua valoare; două valori
     **diferite** pentru aceeași etichetă ⇒ refuz.
   - Rândul valorii se validează **întreg, ancorat**: `X [unitate] / Y unitate [(p%)]`. Orice rând care doar seamănă cu un
     raport (`1 004.615 / 250 GB`, `- 4.615 / 250 GB (2%)`, `4.615 / 250 GiB`, text în jur) ⇒ refuz integral, nu se
     extrage un fragment.
   - Unități `B/KB/MB/GB/TB`, **zecimale** (1 GB = 10^9 bytes, ca pagina și ca monitorul).
   - **Cota afișată** pentru Egress și Cached Egress trebuie să fie **250 GB** (planul Pro) — altfel e valoarea altui
     indicator ⇒ refuz.
   - **Separatorul zecimal** se deduce din toate rapoartele `a / b` de pe pagină (ex. `70,803 / 2,000,000` dovedește că `,`
     e de mii); dovezi contradictorii ⇒ refuz; un număr ambiguu (`4.615`) fără nicio dovadă ⇒ refuz. Merge și cu
     virgulă zecimală + punct/NBSP de mii, dacă pagina e așa întreagă.
   - **Procentul afișat** (`(2%)`, `(<1%)`), pe rândul valorii sau pe rândul următor, e **obligatoriu** și trebuie să
     corespundă valoare/cotă (±1 punct) — prinde o citire greșită cu factor 1000. Singura excepție: valoarea exact `0`
     (pagina nu afișează procent la zero, ex. `0 / 50 MAU`; un `0` nu are separator, deci nu poate fi citit greșit) —
     altfel, la începutul ciclului, un Cached Egress încă zero ar opri colectorul.
   - Numere ≥ 0, maxim 10 PB, grupare de mii validă.
   - Ciclul `DD Mon YYYY - DD Mon YYYY` care conține ziua de azi (UTC; o zi toleranță înainte de start, ziua de sfârșit
     inclusă): exact unul, **07 → 07, de o lună** (ca CHECK-urile din BD); altfel refuz.
4. `scrie`: o a doua verificare, independentă (`bd.valideaza_document`: bytes întregi în interval, ciclu 07→07, `citit_la`
   în UTC, nu în viitor, în ciclu), apoi **un INSERT, o tranzacție** (`psql -X -w --single-transaction -v ON_ERROR_STOP=1`):

   | Coloană | Valoare |
   |---|---|
   | `citit_la` | momentul citirii stabile, UTC |
   | `ciclu_start` / `ciclu_sfarsit` | ex. `2026-10-07` / `2026-11-07` (exclusiv) |
   | `egress_bytes` / `cached_egress_bytes` / `storage_size_bytes` | GB pagină × 10^9 (ex. 4.615 → 4615000000) |
   | `sursa` | `'dashboard'` (literal în SQL) |
   | `raspuns_brut` | **doar** valorile parsate + rândurile relevante (nu pagina), ex. mai jos |

   ```json
   {"colector":"scripts/egress_colector","versiune":1,"pagina":"/dashboard/org/bfiqfdefpomddojbezjs/usage",
    "unitate":"GB zecimal (1 GB = 10^9 bytes)","separator_zecimal":".",
    "valori_gb":{"egress":"4.615","cached_egress":"0.078","storage_size":"14.586"},
    "cote_gb":{"egress":"250","cached_egress":"250","storage_size":"100"},
    "randuri":{"Egress":"4.615 / 250 GB (2%)","Cached Egress":"0.078 / 250 GB (<1%)",
               "Storage Size":"14.586 / 100 GB (15%)","ciclu":"07 Oct 2026 - 07 Nov 2026"}}
   ```
   **Anti-injecție:** nimic din pagină nu e interpolat în SQL. Documentul devine un JSON pe un singur rând (`ensure_ascii`),
   pus într-un literal dollar-quoted cu **tag aleator** (`egr_` + 128 de biți, verificat că nu apare în document);
   serverul îl parsează ca `jsonb` și convertește explicit fiecare câmp (`::timestamptz`, `::date`, `::bigint`). În afara
   literalului SQL-ul e fix (fără backslash); psql nu interpolează variabile și nu vede meta-comenzi în literal (testat
   cap-la-cap cu `$$`, `'`, `\i`, `\gexec`, `:'DBNAME'`, `:USER`, `DROP TABLE …`). Parola stă doar în pgpass; variabilele
   de mediu care pot schimba ținta (`PGPASSWORD`, `PGHOST`, `PGOPTIONS`, `PGSERVICE`, `PSQLRC` …) sunt scoase din mediul lui psql.
5. Un rând de jurnal per rulare în `%LOCALAPPDATA%\Gazpet\egress_colector\egress_colector_jurnal.log`
   (`ora UTC | comanda | cod | mesaj`) + lock `egress_colector.lock` (o singură rulare odată; unul mai vechi de 10 min se înlocuiește).

## Comenzi

Din folderul `scripts` al unei clone (sau `PYTHONPATH=scripts`):

```powershell
python -B -m egress_colector citeste               # citește pagina și AFIȘEAZĂ cifrele; NU scrie în BD
python -B -m egress_colector citeste --arata-sql   # + SQL-ul exact pe care l-ar rula `scrie` (nerulat)
python -B -m egress_colector scrie                 # citește + INSERT un rând (psql + pgpass)
python -B -m egress_colector stare                 # jurnal local + ultima citire din BD (tranzacție READ ONLY)
python -B -m egress_colector stare --fara-bd       # doar jurnalul local
```
Diagnostic local (fără BD): `citeste --salveaza-text F` păstrează textul paginii în F; `citeste --din-text F` parsează un
text salvat, fără browser. `scrie` citește **doar** pagina live (niciodată dintr-un fișier).

Coduri de ieșire: `0` OK · `1` eroare (nimic scris; la eroare psql tranzacția e anulată) · `2` pagina cere logare în
Supabase (cineva se loghează manual în Edge-ul de pe 9333) · `3` altă rulare e în curs.

## Pașii (după merge, cu „da” de la Răzvan)

```powershell
cd C:\Users\Gazpet-Ai\gazpet-erp\scripts      # clona de pe server, pe main, după git pull
python -B -m egress_colector citeste --arata-sql
python -B -m egress_colector scrie            # prima citire în BD ⇒ oprește alerta „colector oprit”
python -B -m egress_colector stare
```
Apoi programarea (mai jos) și registrul (fișa de mai jos: `public.automatizari` + `claude_docs.registru_automatizari`).

## Programare: Task Scheduler, din oră în oră (python direct, fără .ps1/.cmd)

Comandă unică, tastată o dată în PowerShell pe serverul AI, ca utilizatorul **Gazpet-Ai** (nu se salvează niciun fișier):

```powershell
$a = New-ScheduledTaskAction -Execute 'C:\Program Files\Python313\pythonw.exe' -Argument '-B -m egress_colector scrie' -WorkingDirectory 'C:\Users\Gazpet-Ai\gazpet-erp\scripts'
$t = New-ScheduledTaskTrigger -Once -At '00:17' -RepetitionInterval (New-TimeSpan -Hours 1)
$s = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskPath '\Gazpet\' -TaskName 'Egress colector Supabase' -Action $a -Trigger $t -Settings $s -Description 'Contoarele oficiale de egress Supabase (pagina Usage) -> public.supabase_usage_oficial, din ora in ora. scripts/egress_colector/README.md'
```
- `pythonw.exe` = fără fereastră de consolă la fiecare oră (psql pornește și el fără fereastră); ieșirea merge în jurnal.
  Pentru o rulare manuală cu ieșire pe ecran: `python.exe`.
- Trigger: azi 00:17, repetat la 1 h, fără sfârșit (verificat: `Repetition.Interval = PT1H`, `Duration` gol) ⇒ rulează la
  :17 în fiecare oră (pagina se reîmprospătează orar; :17 evită vârful de la :00).
- Fără `-User`/`-Password`: sarcina rulează **doar cu utilizatorul logat** — corect, fiindcă are nevoie de Edge-ul cu CDP
  din sesiunea lui (pornit de sarcina „Edge CDP 9333 Copilot (Gazpet)”). Edge oprit ⇒ cod 1, nimic scris.
- Verificare: `Get-ScheduledTaskInfo -TaskPath '\Gazpet\' -TaskName 'Egress colector Supabase'` (`LastTaskResult` 0/1/2/3)
  și `python -B -m egress_colector stare`.
- Oprire: `Unregister-ScheduledTask -TaskPath '\Gazpet\' -TaskName 'Egress colector Supabase' -Confirm:$false` + `stare` =
  `oprit` / `retras` în `public.automatizari` (nu DELETE).

## Fișa de automatizare (pentru `registru_automatizari` + `public.automatizari`)

- **Nume:** Colector contoare oficiale egress Supabase — `pythonw -B -m egress_colector scrie`, Task Scheduler
  `\Gazpet\Egress colector Supabase`, din oră în oră la :17, pe serverul AI Gazpet-Claude, contul Windows Gazpet-Ai.
- **(a) Conținut extern citit:** pagina Usage a **propriului cont** Supabase (org `bfiqfdefpomddojbezjs`), prin Edge-ul logat
  de pe 9333 — text generat de Supabase din datele noastre, nu scris de terți. Tratat totuși ca date: parsare strictă
  (3 etichete exacte, raport `a / b`, separator dedus + procent verificat, ciclu 07→07), nimic executat, nimic interpolat
  în SQL (literal dollar-quoted cu tag aleator, conversii explicite în BD).
- **(b) Ce scrie / face:** **un singur INSERT, un rând, într-un singur tabel**: `public.supabase_usage_oficial` (+ secvența
  ei). Nimic altceva în BD. Local: jurnal + lock în `%LOCALAPPDATA%\Gazpet\egress_colector`. În Edge: deschide și închide
  un tab propriu. **Fără mail, fără bani**, fără drepturi, fără alte tabele. Efect indirect: citirea alimentează
  `egress_detector()` (alertele 50/80% pe contoarele oficiale și „colector oprit” → notificări către owner — deja existente).
- **(c) Identitate:** rolul `postgres` prin pooler (`aws-1-eu-central-1.pooler.supabase.com:5432`, user
  `postgres.dxczwkbciseqniprspcu`), parola din `%APPDATA%\postgresql\pgpass.conf` de pe server — **sare peste RLS**.
  Justificare: tabela nu are intenționat nicio politică de scriere pentru `anon`/`authenticated` (doar SELECT owner);
  contractul migrării 20261030a spune că scrie doar colectorul, ca `postgres` sau `service_role`; scriptul local nu are JWT
  de utilizator; pgpass-ul există deja pe server (runnerul de migrări, BMW CarData). Etapa 2 propusă: un rol dedicat cu
  `INSERT` doar pe `supabase_usage_oficial` (+ `USAGE` pe secvență), în locul lui `postgres`.
- **(d) Cine o poate porni:** Task Scheduler local pe serverul AI (contul Gazpet-Ai, doar cu utilizatorul logat) sau o rulare
  manuală din consola serverului. Nimic expus în rețea: fără endpoint, webhook sau edge function; CDP acceptat doar pe
  loopback (verificat în cod).
- **(e) Confirmare umană:** prima `scrie` și programarea sarcinii = „da” de la Răzvan; logarea Edge-ului în Supabase =
  manuală. Rularea orară merge fără confirmare: (a) și (b) se ating doar formal — conținutul e al propriului cont, iar
  scrierea e un singur rând numeric validat de trei ori (parser, document, CHECK-urile/triggerul din BD) într-un tabel de
  monitorizare, fără efect în afară. **Decizia dacă această poartă ajunge îi aparține lui Răzvan** (CLAUDE.md pct. 7).
- **Secrete (doar nume):** `%APPDATA%\postgresql\pgpass.conf` (existent); sesiunea Supabase din profilul Edge
  `C:\Users\Gazpet-Ai\edge-cdp` (cookie-urile nu sunt citite de script). Nicio cheie nouă.

Rând propus pentru `public.automatizari`: `cod` = `egress_colector_supabase`, `tip` = `script_pc`,
`unde` = „Server AI Gazpet-Claude — Task Scheduler (cont Gazpet-Ai)”, `program` = „din oră în oră, la :17”,
`referinta` = „\Gazpet\Egress colector Supabase → pythonw -B -m egress_colector scrie (scripts/egress_colector)”,
`responsabil` = „Claude”, `citeste_extern` / `ce_scrie` / `identitate` / `cine_porneste` / `confirmare_umana` /
`secrete_nume` = punctele (a)–(e) și „Secrete” de mai sus, `stare` = `activ` după programare (`de_verificat` până atunci),
`decis_de` = „Răzvan”, `registru_sectiune` = „Colector contoare oficiale egress Supabase”.

## Teste

```bash
PYTHONPATH=scripts python -B -m unittest egress_colector.test_egress_colector -v   # 73 de teste, fără rețea, browser sau BD
PG_BIN=/c/Users/Public/pgsql/bin bash scripts/test_egress_colector.sh              # PG17 local: migrările + scriere cap-la-cap
```
- **Parser**: textul REAL al paginii (`fixture_usage_20261015.txt`, citit 15.10.2026, numele proiectului înlocuit);
  exemplul „4.402 / 250 GB”; virgulă/punct (mii și zecimal, NBSP), număr ambiguu fără dovadă, separatori contradictorii,
  procent nepotrivit (factorul 1000), procent lipsă (refuz; `0` fără procent acceptat), pagină goală / fără cifre / de
  logare, contor lipsă, două valori diferite, unitate necunoscută, negativ, malformat, absurd; regresiile din review-ul
  Jakarinos r1 cu exemplele exacte (`4,615 / 250 GB` + `(2%)` pe rândul următor; `1 004.615 / 250 GB`;
  `- 4.615 / 250 GB (2%)`; „Loading…” urmat de `Log Query … 97.865 / 2,000 GB`; cota ≠ 250 GB) — toate picau pe ce522ec; ciclu greșit (ziua 8, două luni, trecut, lipsă, ambiguu), decembrie→ianuarie,
  toleranța la capete, alte formate de dată.
- **SQL (anti-injecție)**: text ostil în rânduri ⇒ SQL-ul din afara literalului identic cu cel benign, documentul intact în
  literal, fără backslash în afara lui; tag aleator; tag prezent în document / tag invalid ⇒ refuz; validarea documentului
  (negativ, bool, float, text, prea mare, ciclu, fus orar, viitor, chei în plus, șir lung); comanda psql (`-X -w`,
  `--single-transaction`, `ON_ERROR_STOP`, fișier temporar șters, `PGPASSWORD`/`PGHOST`/`PGOPTIONS` scoase); exact o linie de rezultat.
- **Pagina (Playwright simulat)**: tab nou închis, taburile existente **neatinse** (orice atingere pică testul),
  `browser.close()` interzis, stabilitate, logare ⇒ `LogareNecesara`, Edge oprit / fără context, CDP non-loopback refuzat
  fără să pornească Playwright, URL-uri străine refuzate.
- **CLI**: `citeste` nu atinge BD, `scrie` (jurnal + lock eliberat), logare ⇒ 2, parsare eșuată ⇒ 1 fără scriere,
  lock ocupat ⇒ 3 / lock vechi înlocuit, `stare`.
- **Harness PG17 local** (`scripts/test_egress_colector.sh`): schelet + 20260930e + 20261002a + 20261030a; `stare` pe tabela
  goală; scriere cap-la-cap prin `bd.scrie` cu text ostil (md5 identic în `raspuns_brut`, tabela intactă); al doilea rând;
  `egress_detector()` vede citirea și nu emite „colector oprit”; eroarea BD urcă clar; unittest.
