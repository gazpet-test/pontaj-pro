## C1

- Adăugate `fn_izo_cor_propune`, `retrage`, `respinge`, `verifica` (o singură semnătură), `aproba`, în `e3b_operatii_tpl.sql`; migrarea și rollback-ul sunt regenerate, cu owneri, ACL și ștampilă. Nu există invocări implicite noi: lista fixă rămâne neschimbată.
- §1 / §3.3: lista albă și normalizarea refolosesc helper-ele B; aprobarea reconstruiește cererea din forma normalizată și reverifică instantaneul. Pentru `pierdut`, cauza rămâne în `inainte`; pentru `camp`, comparația include `server_ver`.
- §3.4 / §4: lock-urile urmează ordinea document → corecție → autorizare → locuri → tabele → advisory → bucată. Gestionarul de pe tronson se verifică după `atribute.depozit_origine_id`. Retragerea de owner refolosește ramura owner a autorizării (`gestionar`, depozit NULL; nicio atribuire nu poate satisface comparația cu NULL).
- §5.0 / §5.2 / §5.3: eligibilitatea, PV-ul și țintele de stare refolosesc B. Găsit nou intră în carantină, cu sursă manuală și `atribute.sursa=e3b`. §5.6 / Q18=A: verificarea arată doar coliziuni vizibile; aprobarea verifică global și păstrează indexul arbitru, cu 23505 generic. Retry-ul aprobatorului, cu versiunea anterioară, nu scrie din nou.
- Teste: generatorul, 6 teste PASS (inclusiv generare repetabilă, LIVE nemodificat, frontiera C1, lista INSERT C și rollback). SQL adăugat cu identitate `authenticator` + JWT + `authenticated`, integral în tranzacție anulată: negativele cerute, patru ochi inclusiv owner, CAS, toate fluxurile de stare, camp cu derivate, cele două verificări, retragere/respingere și retry.
- Nu am executat SQL, PostgreSQL 16, PostgREST sau harness-ul: restricția brief-ului interzice accesul la baze de date. Testele SQL rămân de executat de Claude; PASS-ul Python nu certifică execuția PL/pgSQL. Nu sunt incluse camp direct, PV, storno și istoric (C2/D).

## C2

- Adăugate `fn_izo_cor_camp` și `fn_izo_cor_pv` în `scripts/izometrie/e3b_gen/e3b_operatii_tpl.sql`: autorizare responsabil, CAS, ordinea lock-urilor §4, normalizare prin garda B, marcaj intern și audit. PV produce zero mișcări; recepția inițială rămâne intactă. Migrarea/rollback-ul regenerate includ ACL, owneri și ștampile.
- Teste SQL adăugate în `supabase/tests/izometrie_e3b.test.sql`, cu fixture E3 prin RPC și responsabil non-owner: refuz gestionar, identitate/listă/derivate/valori, CAS, draft/fără PV, propunere deschisă; succes camp/PV și verificarea auditului/invariantelor. Retry cu versiunea veche → 40001, fără duplicate, conform designului §9.17; retry-ul idempotent C1 rămâne neschimbat. `observatii` este exclus din L (§2.5); pozitivul folosește `perete_mm`.
- Verificare executată: generator + 7 teste Python PASS, inclusiv repetabilitate, LIVE nemodificat, ACL/owner/ștampile/rollback și frontiera 0e a noilor RPC-uri.
- Nu am rulat PostgreSQL 16, SQL, PostgREST sau harness-ul: brief-ul interzice accesul la baze de date. Execuția PL/pgSQL și concurența rămân de verificat de Claude. Fără modificări în `src/`, Git, secrete, rețea sau deploy.

## D1

- SQL în `scripts/izometrie/e3b_gen/e3b_d1_tpl.sql`: storno parțial administrativ, eligibilitate declarant, lock-uri §4, lista completă a refuzurilor, audit și `UPDATE RETURNING`; helper de lanț, istoric imutabil și diff inclusiv scan modificat pe aceeași cale. Migrarea `20261106a` și rollback-ul sunt regenerate.
- Salvarea E3 primește doar INSERT-ul istoricului și `istoric_versiune`; precondiție md5, înlocuire ca owner existent, restaurare exactă. Instantaneul extrage textual obiectul canonic din hash-ul LIVE; postcondiția verifică hash-ul neatins și expresia comună. Ștampile/ACL/lista fixă de trigger-e extinse.
- Executat: generator + 10 teste Python PASS. Adăugate teste SQL în tranzacție anulată: negative, două bucăți anulate inclusiv după corecție aplicată, două salvări cu diff, CAS, garda istoricului și comparație cu formula LIVE E3 a hash-ului.
- Nu am rulat SQL/PostgreSQL/PostgREST/harness (restricția „no database”); validarea pe PG16 rămâne la Claude. Storno-ul complet și prologurile E2a rămân D2. Fără modificări în `src/`, migrări LIVE, Git, rețea sau deploy.
