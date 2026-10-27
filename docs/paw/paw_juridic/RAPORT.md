# Raport de livrare - Runda 2 - 27.10.2026

Baza rundei 1 a fost copiata prima in `docs/paw/paw_juridic/`, dupa citirea
_LECTII_REVIEW.md. Modificarile si fisierele temporare de test sunt exclusiv
in acest director. Livrarea foloseste numai Python 3.13 standard library.

## Schimbari

- P1, `server.py`: Popen este retinut in memorie; PID si creation time FILETIME
  sunt persistate sub lock. La restart se verifica identitatea prin ctypes
  OpenProcess/GetProcessTimes/GetExitCodeProcess/WaitForSingleObject. Un proces
  viu sau cu identitate necunoscuta ramane in curs indiferent de markerii logului.
  Finalizarea cere proces terminat si marker exact pe ultima linie fizica, cu
  newline final. GATA cere tipul cop/gem corespunzator; EROARE accepta motiv.
- Timeout la 2400 secunde: stare eroare, motiv timeout, slot eliberat, cota
  pastrata. Oprirea foloseste acelasi handle verificat prin creation time;
  PID reutilizat ori identitate lipsa nu permit oprirea altui proces.
- P2-1: `actualizeaza` persista stare, terminat_utc si optional motiv, atomic,
  sub lock. Logul sters dupa finalizare nu modifica starea, nici dupa restart.
- P2-2: `coada` face seek si citeste maxim 256 KiB per citire, cu maxim 60000
  caractere intoarse si indicator trunchiat. Elimina prima linie partiala.
  La lansare se reconciliaza numai lucrarile active ale tipului cerut;
  logurile istorice nu sunt recitite.
- `README.md`: contractul markerilor/procesului, timeout, persistenta, limitele
  citirii si fisa a-e actualizate. Configuratia/instalarea raman documentatie.
- `test_server.py`: 29 teste; cele 20 de scenarii anterioare sunt pastrate,
  fixture-urile de finalizare sunt adaptate la noul contract. Vechea asteptare
  ca o linie mare sa fie refuzata este inlocuita cu citire limitata explicit.

## Verificare executata

```powershell
& 'C:\Program Files\Python313\python.exe' -I -B -m unittest discover -s docs/paw/paw_juridic
```

Rezultat final: **29 teste, OK**, 1.214 secunde, fara teste omise pe Windows.

Dovezi principale:

- `test_forged_markers_cannot_release_live_slot`: marker fals la mijloc/final,
  inclusiv EROARE; stare in curs si a doua lansare refuzata cu motivul exact.
- `test_terminal_persisted_and_deleted_log_after_restart`: finalizare gata si
  eroare, timestamp durabil, log sters, instanta noua, stare terminala pastrata.
- `test_exact_terminal_marker_contract`: tip gresit, token incomplet, newline
  lipsa, linie goala/sufix dupa marker sunt refuzate; marker legitim acceptat.
- `test_three_mb_log_bounded_tail_read`: fisier de 3 MiB, instrumentare reala
  a read/seek, fiecare citire maxim 256 KiB, raspuns 60000 caractere. Citirea
  initiala de finalizare si cea de afisare sunt separat limitate.
- `test_timeout_frees_slot_and_persists_without_log`: 41 minute simulate,
  eroare timeout persistata, tentativa de oprire pe identitatea salvata,
  urmatoarea lansare permisa.
- `test_launch_skips_terminal_logs_and_reconciles_active_timeout`: interzice
  citirea logurilor istorice printr-o exceptie santinela si verifica
  eliberarea slotului expirat chiar pe calea de lansare.
- `test_restart_real_pid_creation_and_reuse_guard`: proces Python real local,
  instanta noua fara Popen, marker fals cu proces viu, slot ocupat, creation
  time diferit nu omoara procesul, identitate corecta permite oprirea;
  dupa exit finalizarea este acceptata.
- `test_unknown_identity_and_legacy_reservation_fail_closed`,
  `test_unknown_process_is_not_success_and_error_marker_has_reason`: identitate
  lipsa/eroare API nu devin succes din textul consultantului.
- Protocolul stdio cu proces copil si lansator batch fals, concurenta a doua
  procese cu bariera pentru slot si ultima rezervare zilnica raman verificate.

Nu s-au rulat Git, commit/push, instalari, lansatorul real, Claude Desktop,
credentiale, BD, deploy sau mail. Nu s-au modificat ACL-uri ori configuratii
reale. Cererea de commit de la finalul brief-ului contrazice interdictia expresa
initiala si AGENTS.md; am respectat interdictia. Nu s-a scris in afara worktree.

## Reguli L01-L25

Referintele sunt functii/teste din fisierele livrate. Adaptarile locale nu
pretind garantii SQL, autentificare de Proiect sau contabilitate financiara.

| Regula | Aplicare / dovada |
| --- | --- |
| L01 | `registru`: lock interproces inainte de citire, reconciliere si rezervare. `test_concurrent_processes_reserve_before_launch`, `test_concurrent_daily_quota_two_types`: doua procese reale + bariera + motiv exact. |
| L02 | `salveaza`: flush/fsync/replace atomic; rezervare durabila inainte de Popen; finalizarea se persista sub acelasi lock. Brief/proces nu formeaza tranzactie atomica, crash-ul ramane conservator. `test_crash_reservation_not_relaunched`. |
| L03 | Identitatea procesului include creation time, nu numai PID; verificare si TerminateProcess pe acelasi handle. `test_restart_real_pid_creation_and_reuse_guard` dovedeste refuzul opririi cu identitate diferita. Fara cache/lease distribuit. |
| L04 | n/a pentru bani/mail/cantitati si chei client UUID; ID aleator server, fara deduplicare semantica. Un apel nou este intentie noua, limita explicita in README. |
| L05 | Exceptiile/crash-ul nu sterg rezervarea si nu declanseaza retry/fallback platit. Identitate necunoscuta ramane in curs pana la timeout cerut explicit, care elibereaza slotul fara restituirea cotei. Testele de crash/identitate necunoscuta/timeout. |
| L06 | Ordine unica documentata: lock registru -> citire/verificari -> rezervare -> lansare. Fara lock secundar; testele concurente L01. |
| L07 | L07 n/a: fara BD/RPC/RLS/PostgREST. Poarta locala Windows/config protejat este descrisa, nu echivalata cu autorizare BD. |
| L08 | L08 n/a pentru auth.uid/DEFINER; ID, timestamp, PID, creation time si starea sunt stabilite de server, nu de argumentele modelului. `test_input_guards`. |
| L09 | L09 n/a pentru service_role/acces BD; citirea locala cere ID din registru. `test_ids_and_traversal`. |
| L10 | Fara secrete ori fallback de credentiale; exceptii interne fara mesaj brut. `test_launch_failure_no_raw_exception`, `test_unknown_process_is_not_success_and_error_marker_has_reason`. |
| L11 | L11 n/a: fara extragere de dovezi juridice; rezultatul ramane consultativ. |
| L12 | `coada`: trunchiat explicit pentru omiterea inceputului/limita textului, fara a declara continut complet. `test_three_mb_log_bounded_tail_read`, `test_io_failures_and_oversize_logs_are_errors`. |
| L13 | `ID.fullmatch`, fullmatch pe ultima linie fizica cu newline obligatoriu si tip exact la GATA. Testele de ID si `test_exact_terminal_marker_contract`, inclusiv cazuri negative/pozitive. |
| L14 | L14 n/a: fara migrari. |
| L15 | L15 n/a: fara schema/porti SQL. |
| L16 | L16 n/a pentru UNIQUE BD; ID aleator, coliziune verificata sub lock, brief creat exclusiv. Fara promisiune de deduplicare. |
| L17 | `zi_bucuresti` pastreaza regula DST UE pentru cota zilnica, testata la limite; durata timeout foloseste timestamp UTC exact, nu zi calendaristica. Testele DST si timeout simulat. |
| L18 | Identitate necunoscuta/acces refuzat nu devin proces terminat; stare pe lista alba, finalizare persistata. Testele de registru invalid, identitate lipsa/API esuat si log invalid. |
| L19 | `actualizeaza` este aceeasi poarta pentru citire si lansare; `coada` si `stare_proces` sunt helperi comuni. `test_launch_skips_terminal_logs_and_reconciles_active_timeout`. |
| L20 | Sunt testate calea legitima de succes, eroarea lansatorului, limitele, sloturile independente, citirea la cota epuizata, restart, timeout si PID nepotrivit. Refuzul local este distinct de eroarea consultantului. |
| L21 | L21 n/a: nu se scriu raspunsuri AI structurate in business/cache. GATA nu garanteaza corectitudinea sau completitudinea juridica. |
| L22 | Rezervare durabila inainte de Popen, plafon zilnic/slot sub lock, fara retry/fallback automat; testele concurente si crash. Contractul nu ofera usage/tarife: nu exista garantie de buget monetar/decontare, limita explicita in README. |
| L23 | L23 n/a: fara PostgREST/paginare; registrul este citit integral si validat. |
| L24 | L24 n/a: fara React/UI asincron. |
| L25 | Expected literale, protocol stdio real, batch fals cu flagurile reale Windows, concurenta intre doua procese reale + bariera. API-urile de proces Windows au fost exercitate cu proces Python local. Fara afirmatii de validare a lansatorului real/Claude Desktop/ACL. |

## Limite ramase

Nu s-a verificat lansatorul real. Contractul presupune ca asteapta consultantul
si scrie el ultimul marker dupa rezultat; runid poate fi diferit de ID-ul MCP.
Markerii nu sunt autentificati criptografic. Noua poarta elimina finalizarea
prematura prin text extern cat timp procesul lansat este viu; nu poate dovedi
singura provenienta ultimului rand daca un lansator incalca acel contract.

Timeout-ul este aplicat la urmatorul apel de citire/lansare, fara scheduler
in fundal. Oprirea vizeaza numai procesul lansat, nu descendentii, si poate
esua din cauza drepturilor. Slotul se elibereaza oricum dupa termen, conform
cerintei; costul real al consultantului poate continua. Identitatile lipsa
in rezervari vechi raman conservator in curs pana la termen.
