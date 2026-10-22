# E9 B1 — coadă și persistență

Livrare locală: `supabase/migrations/20261108a_ocr_local_cereri.sql`, perechea
`supabase/revenire/20261108a_ocr_local_cereri_ROLLBACK.sql` și harness-ul
`scripts/pg/test_ocr_local_cereri.sh` + `.mjs`. Design citit integral: E9 r3.
Nu sunt implementate edge-ul, workerul sau UI-ul. Nicio operație Git, bază, rețea sau deploy.

Tabele noi: `ocr_local_cereri`, `ocr_local_worker`, `ocr_local_incercari`,
`ocr_local_config`; view invoker privat `v_ocr_local_probleme`. RLS pe toate;
authenticated are exclusiv SELECT pe cererile proprii, cu UID nenul.
Service_role are numai EXECUTE pe RPC-urile publice ale cozii, fără DML direct.
Helper-ele private nu au EXECUTE nici pentru service_role. Toate funcțiile sunt
SECURITY DEFINER cu `search_path = public, pg_temp`, fără EXECUTE pentru PUBLIC/anon/authenticated.

## Contractul RPC pentru B2

Prefixul tuturor funcțiilor din tabel este `public.fn_ocr_local_`.
`int` = `integer`; `timestamptz` = `timestamp with time zone`.

| Semnătură | Rezultat |
|---|---|
| `admite(p_user uuid,p_proiect bigint,p_depozit bigint,p_sablon text,p_bytes int)` | TABLE(id uuid,cale text,termen_upload timestamptz,status text,motiv text) |
| `confirma_upload(p_id uuid,p_user uuid,p_sha text,p_bytes int)` | TABLE(termen_preluare timestamptz,termen_local timestamptz) |
| `preia(p_worker text)` | TABLE(id uuid,token uuid,sablon text,cale text,sha text,termen_local timestamptz) |
| `verifica_token(p_id uuid,p_token uuid)` | TABLE(cale text,sablon text,termen_local timestamptz) |
| `drept_platit(p_id uuid,p_ramura text,p_token uuid,p_user uuid)` | TABLE(acordat boolean,stare text,drept_platit_de text,apel_faza text,proiect bigint,"user" uuid,sablon text,cale text) |
| `rezerva_apel(p_id uuid)` | TABLE(acordat boolean,rezervare_id bigint,status text) |
| `apel_faza(p_id uuid,p_faza text,p_rezervare bigint,p_raspuns jsonb,p_cost numeric)` | void |
| `rezultat(p_id uuid,p_token uuid,p_rezultat jsonb,p_eroare text,p_cost numeric)` | void |
| `inchide_fallback(p_id uuid,p_rezultat jsonb,p_eroare text,p_cost numeric)` | void |
| `stare(p_id uuid,p_user uuid)` | TABLE(stare text,ramura text,rezultat jsonb,eroare text,termen_local timestamptz,drept_platit_de text,apel_faza text,apel_raspuns jsonb,termen_fallback timestamptz) |
| `expira()` | int |
| `heartbeat(p_worker text,p_stare text,p_ora_server timestamptz,p_modele jsonb,p_versiune text)` | void |
| `curatenie_lista(p_limita int)` | TABLE(id uuid,cale text) |
| `curatenie_confirma(p_id uuid,p_ok boolean,p_eroare text)` | void |
| `probleme()` | TABLE(id uuid,stergere_incercari int,stergere_eroare text) |

Helper-e private: `expira_una(p_id uuid) → boolean`,
`disponibilitate(p_la timestamptz) → text` (NULL înseamnă disponibil).
Ultimul permite testarea orelor 06/22 și DST fără falsificarea ceasului funcțiilor de producție.

Flux: `admite` → Storage → `confirma_upload`. Nu există un RPC suplimentar `cere`:
pasul B2.6 din textul r2 este redundant după R3-6; confirmarea publică deja cererea.
`cale` păstrează formatul cerut de design: `ocr-local-cereri/<uuid>.pdf`;
B2 trebuie să folosească aceeași cheie pentru upload/link/delete, fără a reconstrui calea din client.
PDF mono/validarea propunerii și poarta E3 sunt responsabilitatea B2, cu JWT-ul real;
RPC-urile service_role nu sunt o poartă de autorizare pentru utilizator.

## Cele trei corecții cerute

1. **Rezervare atomică:** după `drept_platit`, edge-ul cheamă numai `rezerva_apel(id)`.
   Funcția blochează cererea, apelează `fn_ai_plafon_rezerva` și leagă rezervarea în
   aceeași tranzacție. Eșecul legării anulează și rezervarea. Nu acceptă rezervări
   externe; vechiul `apel_faza(...,'rezervat',...)` este refuzat. Parametrul
   `p_rezervare` a fost păstrat pentru semnătură, dar poate fi doar NULL sau id-ul
   deja legat. Suma maximă 0,05 USD și plafonul implicit 10 USD provin din config,
   cheia și creatorul provin din cerere. Nu se modifică funcțiile registrului AI.
   `acordat=false` la rezervare/repetare nu autorizează count/generare.

   `expira` și `stare` folosesc aceeași recuperare, cu ora reală citită **după lock**:
   acordat fără rezervare → 0; rezervat → eliberare cu 0; trimis → decontare NULL,
   conservatoare; răspuns persistat fără cost decontat → tot NULL, păstrând rezerva
   drept cost. Răspunsul valid de fallback este recuperat în `gata`; arbitrajul
   fără rezultat local ajunge `esuata/local_cazut_dupa_arbitraj`. Un răspuns marcat
   invalid nu devine succes. Un rezultat local deja finalizat rămâne păstrat la
   recuperarea costului. Se recuperează și decontat + rezultat HTTP/finalizare pierdută.

   B2 cheamă `apel_faza('decontat',p_cost)` **fără decontare separată**: RPC-ul
   decontează și avansează faza atomic; costul salvat se citește din registru.
   `esuat_inainte` eliberează, `esuat_dupa` păstrează conservator. Nu există avans
   înapoi, resetarea dreptului sau succes idempotent la `trimis`: ACK pierdut
   înainte de fetch înseamnă eșec conservator, niciodată încă un fetch automat.
   După `acordat=false`, B2 citește `stare`: răspunsul salvat sau in_curs/deja_consumat.
   Tokenul local se invalidează la închiderea/expirarea ramurii; repetările workerului
   cu token invalid sunt refuzate. Deadline local strict `< T0+90`, arbitraj `< T0+50`,
   fallback `< acordare+120`, upload `< admitere+60`; nu se prelungesc.

2. **Refuzuri persistente:** `admite` returnează `status='refuzata', motiv=<cod>`,
   cu id/cale/termen NULL. Nu ridică excepții pentru admitere/cote. Fiecare RPC
   PostgREST trebuie lăsat să se comită; B2 traduce refuzul în HTTP 409/429 abia
   după RPC. Un throw/rollback în aceeași tranzacție ar anula jurnalul și nu este
   un contract suportat. Identitatea inexistentă este refuzată fără FK invalid;
   restul parametrilor invalizi, workerul oprit și limitele se jurnalizează.
   Advisory lock global serializează numărătoarea și inserarea. Încercarea 61
   și toate cele ulterioare sunt refuzate și jurnalizate, inclusiv după repornirea
   workerului. Admisa fără upload consumă cota orară/zilnică. Orele sunt ferestre
   mobile de 60 minute; ziua globală este ziua calendaristică București.
   Încercările se șterg după 30 zile, nu în fereastra cotei.

3. **Retenție:** confirmarea ștergerii golește `pdf_cale`, `pdf_sha256`, `rezultat`,
   `apel_raspuns` și eroarea de ștergere. Celelalte texte din cerere sunt enum-uri,
   identificatori sau coduri limitate, fără mesaje OCR libere. Costul/jurnalul
   rămân. Un tombstone nu poate fi repopulat prin RPC-uri tardive. Upload-urile
   abandonate sunt eligibile pentru curățare imediat după expirarea celor 60s;
   restul după cele 7 zile de la T0. Lista are maximum 50; eșecul păstrează calea,
   incrementează contorul și rămâne reîncercabil. Peste 10 apare în `probleme()`.

## Verificări și limite

Executat aici: verificare de sintaxă `node --check scripts/pg/test_ocr_local_cereri.mjs`
(Node local, fără npm), delimitare lexicală SQL, corespondența celor 17 funcții
CREATE/DROP și prezența RLS pe toate cele 4 tabele. Nu au fost rulate psql,
PostgreSQL, PostgREST, npm sau rețea.
SQL-ul nu este declarat validat de un server PG.

Reviewer: într-o clonă LOCALĂ izolată, PG16/17, cu migrările E3 și 20261105a deja
aplicate, `fn_izo_porti_lipsa() = '{}'`, două profiles existente, B1 încă neaplicat:

```sh
PGURI=postgresql://postgres@127.0.0.1/e9_b1_test_review bash scripts/pg/test_ocr_local_cereri.sh
```

Necesită `psql`, Node și execuție între 06:00–21:55 București pentru admiterile
reale; noaptea și DST sunt verificate separat pe helperul real, fără schimbarea
funcțiilor testate. Harness-ul nu resetează baza și nu alterează schema fixture-ului:
folosește profiles existente, scrie doar tabele B1 și un context AI unic de test.
La succes elimină aceste date și rulează rollback-ul. La eșec păstrează instalarea
pentru inspecție. Nu se rulează pe o bază folosită de alt worker/cron.

Probe: roluri reale; SELECT creator/alt UID/UID NULL; DML/RPC refuzate;
două preluări cu primul lock ținut; token vechi; rezultat 89/90/91;
expirare contra rezultat în ambele ordini; rezultat început înainte de expirare,
dar deblocat după; arbitraj 49/51 și contra fallback; drept/rezerve repetate;
eroare injectată la legarea rezervării (niciun orfan în registru); rezervări
concurente; toate cele 4 faze de cădere pe ambele ramuri și costurile din registru;
răspuns pierdut; fallback 119/121; plafon/count_tokens eșuat; trei admiteri simultane;
ultimul loc orar/global concurent; 63 refuzuri comise; upload invalid/abandonat;
retry, alertă și retenție inclusiv apel_raspuns; revenire cu armare, refuz pe apeluri
active și amprentă exactă a catalogului înainte/după. Compară explicit granturile
existente și definițiile/proacl înainte/după instalare, plus gate-ul E3 real.
Amprenta nu promite restabilirea valorii secvenței registrului AI (NEXTVAL nu se
revine în PG); rollback-ul nu atinge registrul AI.

**Punct de integrare rămas:** brief-ul interzice schimbarea obiectelor existente.
De aceea B1 nu inserează în `storage.buckets`, nu modifică politicile Storage și
nu instalează cronuri în catalogul existent. B2/livrarea sa trebuie să provisioneze
bucket-ul privat (8 MiB, application/pdf), să verifice accesul efectiv Storage,
să programeze `expira()` la minut și `curata` la 30 minute cu Vault, plus ștergerea
orfanilor >1h prin Storage API. Nu sunt pretinse teste de I/O Storage în B1.
Rollback-ul refuză dacă găsește bucket-ul B2 sau un cron care invocă RPC-urile B1:
se revine întâi B2. Pe B1 curat nu există cron/bucket de șters. Acesta este un
decalaj explicit față de propoziția de revenire din design, impus de limita brief-ului.
Integrarea reală PostgREST/safeupdate și Storage rămâne de executat de reviewer/B2.
