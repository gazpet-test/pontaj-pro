# V2-J04 / JAK-V2-02 — livrare locală, 29.09.2026

Implementat conform `spec_v2_j04.md`. Fără git, producție, secrete sau publicare. Aplicarea rămâne după Jilava 02.10. Raportul este în worktree, nu în `C:\Users\Public`, conform instrucțiunii directe de a lucra numai aici.

## Fișiere

- `supabase/migrations/20260930a_ofertare_pachet_hash_server_jakv202.sql`: audit append-only, ACL/RLS, cale obligatorie la INSERT, RPC read-only de snapshot și verificare server la tranziția în `depus`.
- `supabase/migrations/20260930a_ofertare_pachet_hash_server_jakv202_ROLLBACK.sql`: restaurează exact funcția 20260928k; retrage scrierea/snapshot-ul serviciului și triggerul nou de cale. Păstrează dovezile și protecția lor append-only. Nu șterge date.
- `supabase/functions/ofertare-pachet-verifica/index.ts`: poartă înainte de body/service_role, paginare manifest, persistare PASS/REFUZ per fișier, actor autentificat.
- `supabase/functions/ofertare-pachet-verifica/verificare.mjs`: SHA-256 streaming, comparație snapshot înainte/după, limită 32 MiB și anularea streamului peste limită.
- `src/OfertarePropunere.jsx`: verificare server înainte de `depus`, refuzuri afișate per fișier, reluare fără rescriere/dublare de manifest.
- `scripts/test-jakv202-hash-server.mjs`: teste de logică, handler, poartă și paritate SQL/edge/roluri UI.
- `scripts/pg/test_jakv202_hash_server.mjs`: harness PG16 local tranzacțional, fără DROP DATABASE; triggerul documentație/R5, matricea și triggerul depunerii sunt toate active.
- `docs/AUDIT_OFERTARE_V2/V2_J04_PR_DRAFT.md`: textul PR-ului, pregătit local. PR extern necreat.

## Comportament

Roluri extrase din cod: `propunere_docx`, `borderou_docx`, `depus_final`, `dovada_seap`. Pentru fiecare rând, `depus` cere PASS pentru același fișier de manifest, bucket/cale, SHA declarat și calculat, id de obiect, updated_at, eTag și mărime pozitivă. Timestamp-ul nu trece prin `Date`, deci nu pierde microsecundele. Triggerul blochează rândul Storage cu `FOR SHARE` până la commit. Nu modifică matricea 20260928o, politicile Storage R12 sau poarta R5.

RPC-ul nou `ofertare_pt_fisier_snapshot(bigint)` citește direct `storage.objects`; nu depinde de expunerea schemei `storage` în PostgREST. Primește numai id-ul fișierului din manifest și fixează bucket-ul `ofertare`. Acces EXECUTE doar pentru service_role. Este necesar pentru snapshot-ul exact al rândului Storage, inclusiv microsecunde și eTag.

Schema cerută are câmpuri NOT NULL chiar pentru obiect inexistent. Pentru aceste REFUZ-uri se folosesc explicit sentinele: UUID zero, epoch, size 0, SHA-256 al șirului gol când hash-ul nu a putut fi calculat, cale goală dacă istoricul are NULL. Aceste valori NU reprezintă un obiect verificat. CHECK-ul PASS exclude UUID zero/size zero/cale goală; rezultatul și motivul disting orice refuz. Pentru fișier descărcat integral cu SHA diferit se păstrează hash-ul efectiv calculat.

Limita este 32 MiB per fișier, verificată în metadata și pe bytes citiți. Peste limită: REFUZ `prea mare, worker Terra`. Workerul nu este implementat. Descărcarea are timeout 30 s; eroarea devine REFUZ persistat. Eșecul scrierii auditului întoarce 503 și nu permite depunerea. Verificarea nu schimbă starea pachetului; numai acțiunea UI ulterioară încearcă tranziția, verificată din nou în SQL.

## Verificări executate

| Verificare | Rezultat |
| --- | --- |
| `node --test --test-isolation=none scripts/test-jakv202-hash-server.mjs` | **PASS: 41/41** |
| `node --check scripts/pg/test_jakv202_hash_server.mjs` | **PASS**, numai sintaxă JavaScript |
| `deno check --no-lock --node-modules-dir=none supabase/functions/ofertare-pachet-verifica/index.ts` | **PASS** după corectarea tipului listei de manifest |
| Probă directă `deno run` pe `verificaFisier`, bytes `abc` | **PASS**: SHA identic → PASS; SHA declarat diferit → REFUZ |
| `node scripts/pg/test_jakv202_hash_server.mjs` | **NEEXECUTAT pe PG16**: lipsesc PGURI și psql; harness-ul se oprește înaintea conexiunii |
| `deno test -A --no-lock --node-modules-dir=none scripts/test-jakv202-hash-server.mjs` | **BLOCAT de mediu**: Deno 2.9.7 panic la pipe Windows, acces refuzat; nu este un rezultat de test trecut |
| `npm run build` / `npm test -- --run` | **BLOCATE de mediu**: vite/vitest lipsesc. `npm ci` nu poate instala: cache incomplet, apoi ECONNREFUSED către registry |

Test runnerul Node în mod implicit a întâlnit `spawn EPERM`; opțiunea `--test-isolation=none` permite rularea aceleiași suite fără proces copil.

Cache-urile locale de validare `.cache/npm` și `.cache/deno` au rămas în worktree: revizuirea automată a respins comanda de curățare prin politica de execuție, fără motiv mai specific. `node_modules` poate conține directoare parțiale din instalarea eșuată; nu reprezintă dependențe instalate complet.

Cele 41 de teste trecute acoperă obiect absent/gol, metadata invalidă, SHA diferit, snapshot pre/post schimbat (id, timestamp, eTag, cale, bucket, size, dispariție), obiecte omonime cu bytes diferiți, limita inclusiv când metadata minte, stream întrerupt, cale invalidă, 401/403 înainte de body, fail-closed, audit nereușit, roluri lipsă, toate PASS și paginare cu 501 fișiere și ultimul refuzat.

Harness-ul PG16 pregătit verifică scenariile obligatorii plus istoricul fără cale, PASS pentru alt hash/cale, rolurile obligatorii R11, schimbarea eTag/size, refuzurile ACL, UPDATE/DELETE/TRUNCATE inclusiv postgres, FK RESTRICT, RLS la SELECT, snapshot numai service_role/bucket ofertare, matricea R12, Storage R12, poarta R5/completitudine și rollback urmat de reaplicare. Fixture-urile folosesc tabelele/politicile pachetului și corpurile triggerelor din migrările reale; sursele agregate R5/completitudine sunt fixtures controlate. Aceste teste NU sunt declarate trecute.

## Registru / fișă de securitate

Automatizarea `ofertare-pachet-verifica` citește bytes externi numai din bucket-ul `ofertare`, la calea deja înscrisă în manifest; conținutul este hash-uit, nu interpretat ca instrucțiuni. Citește pachetul/manifestul și snapshot-urile Storage, scrie numai în `ofertare_pt_pachet_verificari`; nu trimite mesaje și nu modifică bani, drepturi, manifeste sau obiecte Storage. Rulează cu service_role pentru descărcare, RPC-ul de snapshot și INSERT-ul auditului, inaccesibil utilizatorilor obișnuiți. Înainte de body, `poartaOfertare` validează utilizatorul prin getUser și accesul prin `fn_are_acces_ofertare`, cu refuz 401/403 inclusiv la eroare. Cheia rămâne numai pe server; download-ul are bucket fix, cale validată și redirect-uri interzise. Pornirea este acțiunea explicită de înregistrare a depunerii; marcarea finală rămâne protejată de trigger. Registrul live nu a fost atins.

## Ce rămâne pentru verificarea lui Claude

Rularea PG16, verificarea API-ului real PostgREST/Storage și build/vitest într-un mediu cu dependențe instalate. Nu am testat producția și nu pot afirma că un build validează RPC-ul nou. Nu am publicat PR și nu am aplicat migrarea sau deployat funcția. Aplicarea necesită migrarea și funcția înaintea folosirii noului UI; rollback-ul păstrează auditul și cere revenirea UI-ului/funcției împreună cu SQL-ul.
