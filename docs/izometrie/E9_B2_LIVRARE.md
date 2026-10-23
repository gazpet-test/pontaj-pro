# E9 B2 — context B1/B2 legat local

Completarea este autorizată explicit în chat. Pornire de la origin/main
(HEAD identic), fișierele B1 și B2 reconstruite prin git show din ramurile
origin/izometrie/e9-b1 și origin/izometrie/e9-b2, după listele git diff --name-only.
Nu s-au modificat fișiere B3. Nicio bază, credențială, configurare externă,
commit, push sau deploy accesat/executat.

Migrarea NEAPLICATĂ `20261108a_ocr_local_cereri.sql` este extinsă direct,
fără migrare nouă. Adaugă numai RPC-ul de context; definițiile și granturile
obiectelor B1 existente rămân cele din ramura B1. Rollback-ul elimină noul RPC.

`public.fn_ocr_local_context(p_id uuid, p_user uuid, p_token uuid)` întoarce
exclusiv `id, creat_de, proiect_id, depozit_id, sablon, drept_platit_de,
apel_faza, apel_raspuns, rezervare_id, cost_usd` (ContextCerere).
Este SECURITY DEFINER cu `SET search_path = public, pg_temp`, EXECUTE doar
pentru service_role; revocat de la PUBLIC, anon și authenticated. Fără SELECT
direct, fără expunere UI și fără efecte asupra cozii/costului.

Selectorii sunt exclusivi: creatorul p_user cu token NULL SAU tokenul curent
cu user NULL. Workerul cere stare preluata și `clock_timestamp() < termen_local`.
Creatorul poate citi după termenul local pentru stare/fallback. Ambele trasee
refuză retenția expirată, sters_la nenul și pdf_cale NULL. Lipsa accesului sau
rândului produce set gol, fără dezvăluirea existenței cererii.

Ordinea exactă pentru stare/fallback: separarea canalului → verificare JWT prin
caller.auth.getUser() → validare corp cu numai op/cerere_id → RPC context cu
p_user din identitatea verificată și p_token=NULL → verificare creator/context →
poarta `_shared/izoE3Poarta.ts` cu caller JWT pe proiectul/depozitul stocate →
RPC-urile cozii și eventual apelul plătit. Acest lookup este **unica excepție
explicită** de la „poarta înainte de orice RPC”. service_role transportă contextul
și operațiile cozii; toate deciziile de drepturi (owner/acces/atribuiri) folosesc
caller JWT. Contextul unei cereri existente nu vine niciodată din body.
La cere: JWT → validarea contextului inițial → poarta caller → admite/cotă →
validare PDF → Storage → confirma_upload. Placeholderul 503 a fost eliminat.

Worker: verificarea secretului dedicat → validare corp/token → verifica_token;
când are nevoie de ContextCerere, citește prin context cu p_user=NULL și tokenul
primit. Rezultatul local folosește contextul pentru model/cost/plafon, iar
arbitrajul repetat recuperează apel_raspuns și reverifică exact setul de celule,
fără alt apel AI. Dispariția contextului între pași nu expune răspunsul și nu
salvează propunerea. Workerul ignoră Authorization; UI refuză antetul secret.

Fișiere schimbate pentru completare: migrarea 20261108a, rollback-ul ei,
`scripts/pg/test_ocr_local_cereri.mjs`, `context.ts`, `handler.ts`,
`handler_test.ts` și rapoartele B1/B2. Restul fișierelor B1/B2 sunt reconstruite
identic din ramurile cerute. Fișierele B3 nu au fost reconstruite sau editate.

Verificări: harness-ul offline Node folosește adaptorul context RPC efectiv,
cu client Supabase simulat. Acoperă JWT invalid fără RPC, creator diferit,
drepturi expirate înainte de coadă, ordinea JWT/context/poartă/coadă, body
contrafăcut, erori RPC, recuperare arbitraj cu token și dispariția contextului,
plus suitele existente de cost, PDF simulat, normalizare și prefill.
Comandă: `node --test scripts/test-e9-b2-offline.mjs`.
Rezultat executat: **40/40 trecute**, zero eșecuri. Și `node --check
scripts/pg/test_ocr_local_cereri.mjs` trece (numai sintaxă JS, fără SQL executat).

Harness PG extins: ACL numai service_role (inclusiv refuz EXECUTE efectiv pentru
UI/anon și lipsă grant PUBLIC), creator vs alt utilizator, token curent vs vechi,
selectori lipsă/amestecați, termen local strict, token invalidat, retenție,
tombstone/PDF curățat, recuperare fază/răspuns/cost și citire fără mutații.
PG și PostgREST NU au fost executate: chatul interzice accesul la baze.
Deno/typecheck, pdf-lib/Worker real, Storage și vitest nu au fost executate.
Testele offline nu demonstrează ACL/atomicitate SQL sau API-ul PostgREST real.

Bucket/Vault/cron/verify_jwt și automatizările rămân pași de integrare pentru
Claude după verificările reale și aprobarea ownerului pentru aplicare.
