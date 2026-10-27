# Raport de livrare - Runda 3 - 27.10.2026

## Baza si limite

Patch-ul r2 a fost verificat SHA-256:
`690b67f993997f17582b884919abe931906524b13763a221bcb511643465ab2b`.
Aplicat cu `git apply --whitespace=nowarn`, singura operatie Git autorizata
explicit pentru baza. Fara commit/push; interdictia initiala are prioritate
fata de cererea contradictorie de commit din finalul brief-ului.
Fisierul de lectii nu exista la calea indicata; citit din
`C:/Users/Public/paw-data/brief/_LECTII_REVIEW.md` inainte de editare.
Numai `docs/paw/paw_juridic/`: server.py, test_server.py, README.md, RAPORT.md.
Fisierele skill/ si PROIECT_INSTRUCTIUNI.md raman identice cu patch-ul r2.
Numai Python 3.13 standard library. Comentarii si editari ASCII.
Fara instalari, scrieri in ProgramData, lansator real, secrete, BD sau deploy.

## Defect -> fix -> dovada

- P1: serverul nu mai cere drept PROCESS_TERMINATE si nu mai contine cale de
  kill/TerminateProcess. `inspect_process` verifica doar identitatea/terminarea
  pe acelasi handle. `actualizeaza` pastreaza slotul pentru viu/necunoscut;
  dupa 3600 s procesul confirmat viu devine `blocat`, fara terminat_utc.
  `ACTIVE` include blocat la verificarea slotului si la validarea registrului.
  Numai terminarea confirmata plus markerul valid finalizeaza lucrarea;
  esecul cert de Popen ramane terminal, fara restituirea cotei.
  Teste: `test_timeout_never_kills_or_releases_live_slot`,
  `test_blocked_keeps_slot_until_confirmed_exit`,
  `test_unknown_identity_beyond_threshold_keeps_slot`,
  `test_real_parent_child_survive_timeout_and_block_until_exit`.
  Ultimul foloseste parinte si copil Python reali, verifica amandoi vii dupa
  41/60 minute simulate si eliberarea numai dupa terminarea parintelui.
- P2-a: `actualizeaza` verifica procesul oprit si markerul inaintea pragului;
  pragul se aplica exclusiv procesului viu.
  Teste: `test_completed_read_late_is_success` si testul real de mai jos,
  cu creat_utc vechi de doua ore si rezultat gata.
- P2-b: `curata_local` confirma poll, inchide fluxurile si handle-ul Windows,
  scoate Popen din dictionar. Apelata si pentru randuri deja terminale.
  `porneste` reconciliaza toate randurile terminale, inclusiv ale altui tip,
  fara a citi logurile lor.
  Test: `test_real_remote_finalization_closes_local_handles_on_read_and_launch`:
  proces Python real, alta instanta finalizeaza, prima instanta curata la
  citire si la lansarea altui tip; verifica explicit `_handle.closed`.
- Jakarinos: exact patru unelte; schema titlu/text identica, tip `jakarinos`,
  comanda exact `run_paw.cmd jak <brief> <log>` fara argument model;
  antetul existent plus linia fixa de rol. Marker GATA cu tip jak.
  Un slot propriu si aceeasi cota comuna 30/zi.
  Teste: `test_exact_four_tools_and_schemas`,
  `test_jakarinos_exact_args_header_marker_and_own_slot`,
  `test_jakarinos_shares_daily_quota`,
  `test_jakarinos_stdio_with_real_fake_launcher` (stdio si batch fals real).
- README: contractul fara kill, blocat si necunoscut, timeout-ul lansatorului
  (jak/cdx 1200 s, cop/gem 1800 s), procedura manuala si fisa a-e actualizate.
  Timeout-ul/Job Object al lansatorului sunt contractul primit, neverificat live.

## Verificare

Raportul a fost scris inaintea rularii suitei complete.
Comanda (Python nu este in PATH):

```powershell
& 'C:/Program Files/Python313/python.exe' -I -B -m unittest discover -s docs/paw/paw_juridic
```

Rezultat final: **37 teste, OK**, 1.826 s, fara teste omise pe Windows,
Python 3.13.7. Testul real parinte/copil include si identitate necunoscuta
dupa doua ore simulate, cu slot ocupat si ambele procese ramase vii.
Verificare suplimentara Python, fara Git: hash patch corect, exact cele patru
fisiere de mai sus diferite fata de baza; toate patru ASCII si fara whitespace
final; cele sase fisiere din skill/ si PROIECT_INSTRUCTIUNI.md identice cu
continutul patch-ului; niciun director temporar de test ramas.
Regresiile r2 sunt pastrate; asteptarile care cereau kill/eliberare la timeout
au fost inlocuite conform deciziei explicite r3. Nu se pretinde validarea
lansatorului real, Claude Desktop sau a protectiilor ACL din instalare.

## Reguli L01-L25

Referintele sunt functii/teste din cele patru fisiere de mai sus.
Adaptarile locale nu pretind garantii SQL sau contabilitate financiara.

| Regula | Aplicare / dovada |
| --- | --- |
| L01 | `registru`: lock inainte de citire/reconciliere/rezervare; testele `test_concurrent_processes_reserve_before_launch` si `test_concurrent_daily_quota_two_types` cu doua procese si bariera. |
| L02 | `salveaza`: flush/fsync/replace sub lock; rezervare inainte de Popen. Crash-ul ramane rezervat, nu tranzactie pretinsa intre fisiere/proces. `test_crash_reservation_not_relaunched`. |
| L03 | Identitatea PID + creation time si Popen original; fara actiune pe PID reutilizat. `test_restart_real_pid_creation_and_reuse_guard`; aceeasi poarta la citire/lansare sub lock. |
| L04 | n/a: fara bani/mail/cantitati; nu se ofera idempotenta per intentie client. README precizeaza ca un nou apel este o noua intentie. |
| L05 | Necunoscut/crash nu elibereaza slotul, nu sterge rezervarea si nu face retry. `test_unknown_identity_beyond_threshold_keeps_slot`, `test_crash_reservation_not_relaunched`. |
| L06 | Ordine unica documentata in `registru`, fara lock-uri secundare; teste concurente L01. |
| L07 | n/a: fara BD/RPC/RLS. |
| L08 | n/a: fara auth.uid/DEFINER; metadata procesului este stabilita de server. |
| L09 | n/a: fara service_role/entitati BD. Citirea locala cere ID din registru (`test_ids_and_traversal`). |
| L10 | Fara secrete; erori interne generice, fara exceptii brute. `test_launch_failure_no_raw_exception`. |
| L11 | n/a: nu se valideaza dovezi juridice; raspuns consultativ. |
| L12 | Trunchiere explicita in `coada`; `test_three_mb_log_bounded_tail_read`, `test_io_failures_and_oversize_logs_are_errors`. |
| L13 | Fullmatch pe ID si ultima linie fizica; newline si tip exact, inclusiv jak. `test_exact_terminal_marker_contract`, `test_jakarinos_exact_args_header_marker_and_own_slot`. |
| L14 | n/a: fara migrari. |
| L15 | n/a: fara porti SQL. |
| L16 | n/a: fara UNIQUE BD/deduplicare; ID aleator cu verificare coliziune sub lock si brief exclusiv. |
| L17 | `zi_bucuresti` si testul `test_day_rollover_bucharest_and_dst`; prag UTC exact testat la 2460/3601 s. |
| L18 | Necunoscut nu inseamna oprit; blocat ramane activ. Lista alba de stari si testele de registru/identitate/timeout. |
| L19 | `actualizeaza`, `stare_proces`, `curata_local`, `TIPURI`, `ACTIVE` comune; citire si lansare folosesc aceeasi poarta. `test_launch_skips_terminal_logs_and_reconciles_blocked`. |
| L20 | Succes/eroare/necunoscut/blocat/restart/cota citire si trei sloturi; `test_blocked_keeps_slot_until_confirmed_exit`, `test_jakarinos_shares_daily_quota`. Nu exista unealta stop supusa cotei. |
| L21 | n/a: nu se scriu raspunsuri AI structurate in date business/cache; GATA confirma proces/marker, nu adevarul juridic. |
| L22 | Rezervare durabila inainte de Popen, cota comuna, fara retry/fallback; teste de crash/concurenta/cota jak. Contractul nu include usage/tarife; README precizeaza lipsa unui buget monetar garantat. |
| L23 | n/a: fara PostgREST/paginare; registru citit integral. |
| L24 | n/a: fara React/UI asincron. |
| L25 | Procese Python reale pentru P1/P2-b si API Windows, expected literale, stdio si batch fals real, doua sesiuni cu bariera si motiv exact; toate regresiile rulate. |

## Limite ramase

Serverul presupune lansator sincron: asteapta consultantul si scrie markerul
final dupa rezultat. Markerii nu sunt autentificati criptografic. Terminarea
procesului lansat nu dovedeste singura oprirea descendentilor daca lansatorul
incalca acest contract. MCP nu incearca sa compenseze prin kill sau slot liber.
Procesul oprit fara marker, identitatea necunoscuta si rezervarea incompleta
cer verificare manuala; nici varsta, nici lipsa logului nu confirma oprirea.
Instalarea si orice actiune juridica raman la operatorul autorizat.
