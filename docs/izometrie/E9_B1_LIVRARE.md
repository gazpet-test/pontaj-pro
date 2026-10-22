# E9 B1 — coadă și persistență

Livrare locală: `supabase/migrations/20261108a_ocr_local_cereri.sql`, perechea
`supabase/revenire/20261108a_ocr_local_cereri_ROLLBACK.sql` și harness-ul
`scripts/pg/test_ocr_local_cereri.sh` + `.mjs`. Design citit integral: E9 r3.
Nu sunt implementate edge-ul, workerul sau UI-ul. În runda 2, cele cinci fișiere B1
au fost restaurate prin `git show origin/izometrie/e9-b1:<path>`; fără commit/push,
bază, rețea sau deploy.

Tabele noi: `ocr_local_cereri`, `ocr_local_worker`, `ocr_local_incercari`,
`ocr_local_config`; view invoker privat `v_ocr_local_probleme`. RLS pe toate;
authenticated nu are SELECT pe tabele, nici pe coloane. UI citește exclusiv
statusul sigur prin B2 → `fn_ocr_local_stare`; politica RLS de creator rămâne
fără grant direct.
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
| `stare(p_id uuid,p_user uuid)` | TABLE(stare text,ramura text,rezultat jsonb,eroare text,termen_local timestamptz,termen_fallback timestamptz) |
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

**MUST pentru B2 — frontieră de încredere:** toate RPC-urile, inclusiv cele JWT-side
(`admite`, `confirma_upload`, `drept_platit` pe fallback, `stare`), sunt executabile
numai de `service_role`; EXECUTE este revocat de la authenticated, anon și PUBLIC.
Singurul apelant al traseului JWT-side este edge-ul B2. Înaintea oricărui asemenea
RPC, B2 MUST verifica JWT-ul prin `caller.auth.getUser()` și MUST deriva `p_user`
exclusiv din utilizatorul verificat, niciodată din body. Pentru cereri existente,
perechea proiect/depozit verificată trebuie să fie cea a cererii, nu una aleasă în body.
B2 MUST aplica aceeași poartă ca
`supabase/functions/ocr-packing-list/avizE3Handler.ts`: toate citirile de profil
și drepturi se fac cu JWT-ul apelantului (RLS activ), înainte de service_role.
Owner-ul (`is_owner === true`) trece; altfel sunt obligatorii simultan acces
explicit `magazie` cu nivel editor/admin și atribuire gestionar activă pentru
**ambele** ID-uri, proiect ȘI depozit, valabilă la data curentă Europe/Bucharest,
conform helperului E3. Orice eroare/lipsă de drept refuză accesul înainte de RPC.
Identitatea, rolurile și atribuirea declarate de client nu sunt dovezi de acces.
Workerul și mentenanța rămân trasee separate B2, autentificate server-side.

B1 verifică suplimentar existența proiectului în `executie_proiecte` și a
depozitului în `logistica_depozite`, cu refuz jurnalizat `parametri_invalizi`.
Tabelul depozitelor este confirmat de FK-ul E3 din
`20261103b_izometrie_e3_documente.sql` (și E2a); nu sunt adăugate referințe la
obiectele domeniului de izometrie. Existența nu dovedește autorizarea B2.

Statusul pentru UI conține numai câmpurile din semnătura `stare` de mai sus;
`rezultat` este returnat numai în starea `gata`. `token_executie`, `worker_id`,
`rezervare_id`, `apel_faza` și `apel_raspuns` nu sunt accesibile authenticated,
nici direct, nici în status. B2 MUST păstra această proiecție în răspunsul HTTP
și nu retransmite UI-ului răspunsurile interne ale altor RPC-uri.

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
   După `acordat=false`, B2 citește `stare`: rezultatul final sigur sau in_curs/deja_consumat.
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

## Runda 2 — review și retenție D3

Rollback-ul este fail-closed: blochează ambele tabele de istoric și refuză dacă
există **orice rând** în `ocr_local_cereri` sau `ocr_local_incercari`, inclusiv
cereri gata/eșuate/expirate, tombstone-uri și încercări refuzate fără cerere.
Rollback după utilizare reală necesită decizia explicită a lui Răzvan privind
exportul/păstrarea istoricului și legăturilor financiare, înaintea oricărei reveniri.
Scriptul nu exportă și nu elimină automat aceste fapte; armarea singură nu le face dispensabile.

Recovery păstrează apelul `fn_ai_plafon_deconteaza(id,NULL)`: helperul din
`20261105a_ai_plafon_lunar.sql` revine fără modificări când starea rezervării
este diferită de `rezervat`. Harness-ul compară întregul rând al rezervării
(inclusiv `cost_real`) și totalurile lunare înainte/după recovery din
`preluata` și `expirata` cu apel deja `decontat`, inclusiv repetarea recovery.

D3 înseamnă **7 zile pentru PDF și conținutul OCR**, nu pentru toate metadatele:

- `sterge_dupa` este admitere + 7 zile, apoi T0 (confirmarea upload-ului) + 7 zile.
  Upload-ul abandonat poate fi curățat imediat după expirarea celor 60 secunde.
- B2 șterge PDF-ul prin Storage API, apoi confirmă succesul prin
  `curatenie_confirma`. B1 golește `pdf_cale`, `pdf_sha256`, `rezultat`,
  `apel_raspuns` și `stergere_eroare`, marcând `sters_la`. Payload-ul nu se
  șterge înaintea confirmării; la eroare rămâne pentru retry. Pragul de 7 zile
  este eligibilitatea, iar ștergerea efectivă depinde de jobul B2 și succesul I/O.
- Rândul cererii rămâne fără termen automat de ștergere: creator, proiect/depozit,
  șablon, dimensiune/pagini, stări/ramură, identificatori de execuție și rezervare,
  costuri, termene/timestamps și coduri de eroare/contori. Registrul AI rămâne intact.
- `ocr_local_incercari` păstrează utilizatorul, momentul și codul rezultatului
  timp de 30 zile; `expira()` șterge încercările strict mai vechi de 30 zile.
  Configurația și heartbeat-ul workerului nu sunt payload PDF/OCR și nu au TTL de 7 zile.

## Verificări și limite

Executat aici: verificare de sintaxă `node --check scripts/pg/test_ocr_local_cereri.mjs`
(Node local, fără npm), delimitare lexicală SQL, corespondența celor 17 funcții
CREATE/DROP și prezența RLS pe toate cele 4 tabele. Nu au fost rulate psql,
PostgreSQL, PostgREST, npm sau rețea.
SQL-ul nu este declarat validat de un server PG.
Runda 2: verificări statice locale repetate pe fișierele corectate; harness-ul PG
a fost extins pentru findings 1–4, dar nu a fost executat, conform restricției
explicite fără acces la baze de date. Poarta B2 este contract obligatoriu,
nu este pretinsă implementată sau demonstrată end-to-end de B1.

Reviewer: într-o clonă LOCALĂ izolată, PG16/17, cu migrările E3 și 20261105a deja
aplicate, `fn_izo_porti_lipsa() = '{}'`, două profiles existente, B1 încă neaplicat:

```sh
PGURI=postgresql://postgres@127.0.0.1/e9_b1_test_review bash scripts/pg/test_ocr_local_cereri.sh
```

Necesită `psql`, Node și execuție între 06:00–21:55 București pentru admiterile
reale; noaptea și DST sunt verificate separat pe helperul real, fără schimbarea
funcțiilor testate. Harness-ul nu resetează baza și nu alterează schema fixture-ului:
folosește profiles, un proiect și un depozit existente; cheia AI a proiectului
trebuie să fie complet nefolosită în ambele tabele financiare. Scrie doar tabele
B1 și acel context AI de test, fără modificări ale datelor de domeniu.
La succes elimină aceste date și rulează rollback-ul. La eșec păstrează instalarea
pentru inspecție. Nu se rulează pe o bază folosită de alt worker/cron.

Probe: roluri reale; SELECT refuzat pentru creator/alt UID/UID NULL, inclusiv
coloanele interne; DML/RPC refuzate; execuție efectivă refuzată authenticated/anon
pe toate RPC-urile JWT-side; proiecție status sigură; ID-uri inexistente refuzate;
două preluări cu primul lock ținut; token vechi; rezultat 89/90/91;
expirare contra rezultat în ambele ordini; rezultat început înainte de expirare,
dar deblocat după; arbitraj 49/51 și contra fallback; drept/rezerve repetate;
eroare injectată la legarea rezervării (niciun orfan în registru); rezervări
concurente; toate cele 4 faze de cădere pe ambele ramuri și costurile din registru;
răspuns pierdut; fallback 119/121; plafon/count_tokens eșuat; trei admiteri simultane;
ultimul loc orar/global concurent; 63 refuzuri comise; upload invalid/abandonat;
retry, alertă și retenție inclusiv apel_raspuns; revenire cu armare, refuz pe apeluri
active/terminale/curățate și încercări fără cereri; amprentă exactă a catalogului
înainte/după. Compară explicit granturile
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
