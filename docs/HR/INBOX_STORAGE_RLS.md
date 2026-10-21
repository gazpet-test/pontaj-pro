# Coada «Citește orice» — bucket `ai-documente-inbox`: politici storage (20261103c)

**Stare: PREGĂTIT, NEAPLICAT.** Migrare: `supabase/migrations/20261103c_ai_inbox_storage_politici.sql` · revenire (redeschide gaura, fără GO): `supabase/revenire/20261103c_ai_inbox_storage_politici_ROLLBACK.sql` · test local: `scripts/test_ai_inbox_storage_politici.sh`. Atinge și `src/` (două linii, fără drum nou): panoul HR și wizard-ul „Angajat nou” pun `modul_tinta = 'hr'` de la upload — build validat (`vite build`).

## 1. Gaura (catalog live citit read-only, 21.10.2026)
- `storage.objects` are o singură politică pentru bucket: `ai_inbox_obj_all` = `FOR ALL TO authenticated USING / WITH CHECK (bucket_id = 'ai-documente-inbox')`.
- Efect: **orice cont logat** listează, descarcă, suprascrie (upsert / update / move) și șterge fișierele din coadă ale tuturor modulelor — inclusiv buletine, pașapoarte, cazier urcate în HR.
- Azi: 59 de obiecte (56 cu rând, 3 fără), toate în `<uid>/…` cu `owner_id` = uid = `uploadat_de`; 1330 de rânduri în coadă, toate cu calea `<uid>/…` a celui care a urcat, 0 căi dublate, 0 rânduri (de orice stare) cu obiectul altui cont. Stări: 1016 confirmate (fără obiect), 278 respinse (20 cu obiect — le șterge curățenia), 36 clasificate (cu obiect), 0 deschise „nedecise”. Bucket privat, fără versionare. Celelalte 109 politici pe `storage.objects` sunt legate de alte bucket-uri. `postgres` are BYPASSRLS (nu e membru al `supabase_storage_admin`); `storage.objects` are RLS activ.
- Tabela `ai_documente_inbox` are deja RLS pe rând (`ai_inbox_select` = `uploadat_de = uid OR modul_tinta IS NULL OR fn_ai_inbox_poate_confirma(modul_tinta, entitate_id)`), dar fișierul nu era legat de ea.
- **Rândul falsificat, exploatat prin service_role** (Jakarinos P1, verificat în cod): `ai_inbox_insert` cere doar `uploadat_de = uid`, iar `fisier_path` îl scrie clientul. Un cont oarecare își face un rând `in_asteptare` cu calea actului HR al altcuiva (căile rândurilor „nedecise” sunt vizibile oricui) → trigger-ul `trg_ai_inbox_clasificare` cheamă edge-ul `citeste-orice`, care descarcă `row.fisier_path` cu service_role (fără să compare `owner_id` cu `uploadat_de`) și scrie `payload_ai` (nume, CNP …) în rândul atacatorului, pe care acesta îl citește. Sau: își pune rândul fals pe „respins”, iar după retenție `cleanup-recycle-bin` (service_role) șterge **fișierul victimei** (ireversibil). Politicile storage singure nu opresc asta — edge-urile ocolesc RLS-ul.

## 2. Ce face 20261103c
| # | Obiect | Regulă |
|---|---|---|
| 1 | `ai_inbox_obj_insert` (INSERT) | doar în `<uid>/…` (primul segment = `auth.uid()`, comparat exact, ca text); sau `wizard-angajare/…` doar pentru owner / `can_access_personal_data` |
| 2 | `ai_inbox_obj_select` + `ai_inbox_obj_delete` | (a) `owner_id = auth.uid()` (cine a urcat) · (b) există rând în coadă cu `fisier_path = name` **și** `uploadat_de = owner_id`-ul obiectului **și** `fn_ai_inbox_poate_confirma(modul_tinta, entitate_id)` · (c) `profiles.is_owner`. Toate cer `auth.uid()` ne-NULL |
| 3 | fără UPDATE / ALL | nimeni în afară de `service_role` nu suprascrie, nu mută, nu redenumește |
| 4a | `trg_ai_inbox_fisier_legat` (BEFORE INSERT, DEFINER) | un cont logat creează rândul doar cu `uploadat_de` = el și doar pentru un obiect existent din bucket cu `owner_id` = el; altfel 42501, același mesaj pentru „lipsește” și „e al altcuiva”. service_role / postgres (uid NULL) neatinse |
| 4b | `trg_ai_inbox_fisier_imutabil` (BEFORE UPDATE, INVOKER) | `fisier_path`, `uploadat_de`, `fisier_nume`, `fisier_size_bytes`, `fisier_mime` nemodificabile după INSERT (23514, pentru oricine) |
| 4c | `idx_ai_inbox_fisier_path` **UNIC** | un rând per fișier + căutarea rândului legat, per obiect |
| 5 | lock-uri | `storage.objects` ACCESS EXCLUSIVE + `ai_documente_inbox` SHARE ROW EXCLUSIVE, luate **înaintea** precondițiilor și ținute **până la COMMIT** (toată migrarea, zeci de ms: în acest timp toate operațiile storage, pe toate bucket-urile, așteaptă; `lock_timeout` 5 s → cade curat) |

Precondiții (refuz, nimic schimbat): RLS activ pe ambele tabele; bucket privat, fără versionare; `ai_inbox_obj_all` exact cea live; nicio altă politică ce poate atinge bucket-ul; dependențele + drepturile pe coloane; `postgres` ocolește RLS (funcția DEFINER citește `storage.objects`); **date, pe toate rândurile (orice stare)**: niciun obiect cu alt `owner_id` decât `uploadat_de`, nicio cale dublă, nicio cale în afara folderului celui care a urcat (excepție `wizard-angajare/`). Postcondiții: cele 3 politici exact (deparse comparat), nicio politică UPDATE / ALL pe bucket, **celelalte politici storage identice integral cu cele de la precondiție** (amprentă md5), indexul unic, cele două funcții (DEFINER / INVOKER, `search_path` fix, fără EXECUTE pentru roluri) și trigger-ele (tip, funcție, activ), RLS încă activ, bucket privat.

De ce legătura (4a + 4b + 4c): după migrare, orice rând din coadă — vechi (verificat de precondiție) sau nou (verificat la INSERT) — arată doar spre un fișier al celui care l-a creat, și nu se mai schimbă. Edge-urile service_role (`citeste-orice`, `cleanup-recycle-bin`) rămân neschimbate (fără deploy), dar descarcă / șterg doar fișierul acelui cont. Testele T6a–T6v și T9a–T9c o fixează.

## 3. Toate drumurile de cod care ating bucket-ul
| Drum | Operație storage | Identitate | Cerință după 20261103c | Rezultat |
|---|---|---|---|---|
| `src/CitesteOricePanel.jsx` `urcaUnFisier` | `upload(<uid>/<ts>_<rand>.<ext>, upsert:false)` | JWT utilizator | INSERT în folderul propriu | ✅ (T3a, T3b) |
| idem, INSERT rând (după upload, același cont) | — | JWT | `trg_ai_inbox_fisier_legat`: obiect propriu, `uploadat_de` = el | ✅ (T7b, T6t) |
| idem, INSERT rând eșuat (dublură) | `remove([path])` | JWT, fără rând încă | DELETE ca cel care a urcat | ✅ (T7a) |
| `preview` | `createSignedUrl(path, 120)` | JWT | SELECT (a)/(b)/(c) | ✅ dacă vede rândul (T2) |
| `mutaFisier` (Execuție, HR, Logistică, UPA) | `download(path)` | JWT confirmator | SELECT (b) | ✅ (T7c, T7f, T7h) |
| `confirmFinanciar` | `download(path)` | JWT | SELECT (b) | ✅ (T2g) |
| `finalizeInbox` (după închiderea rândului) | `remove([path])` | JWT confirmator | DELETE (b) | ✅ (T5c, T7c) |
| `handleReject`, `mutaModul` | — (doar tabela) | — | — | neatins |
| `src/HrAngajatNouWizard.jsx` `handleFiles` | `upload(wizard-angajare/<ts>_<rand>/<nume>, upsert:false)` + rând cu `modul_tinta = 'hr'` | JWT HR | INSERT sub `wizard-angajare/` cu drept HR; rând legat | ✅ (T3g, T7d); fără drept → refuz (T3f) |
| wizard, INSERT rând eșuat / `scoateDoc` / abandon | `remove([path])` | JWT HR | DELETE (a) | ✅ (T7e) |
| wizard `finish` | `download` + `remove` după închidere | JWT HR | SELECT / DELETE (a)/(b) | ✅ (T7d) |
| edge `citeste-orice` | `download(row.fisier_path)` | `service_role` | ocolește RLS; rândul e legat de fișierul celui care l-a creat | ✅ doar fișierul lui (T2k, T6a, T9b) |
| edge `cleanup-recycle-bin` | `remove(paths)` pentru rânduri respinse | `service_role` | ocolește RLS; idem | ✅ doar fișierul lui (T5i, T9a, T9c) |
| `fn_ai_inbox_trigger_clasificare` | — (pg_net → edge, URL de producție fix) | — | — | neatins (vezi 6.0 pentru branch) |
| `/CitesteOricePanel.jsx` (copie veche în rădăcina repo-ului) | aceeași convenție `<uid>/…` | — | nu e importată în build (`src/ctc/ctcDb.js` importă `src/CitesteOricePanel.jsx`) | — |

Verificat și: nicio funcție din BD nu inserează în coadă și niciun job cron nu numește bucket-ul; edge-urile din repo care îl ating sunt doar cele două de mai sus. Edge-urile deployate fără sursă în repo n-au fost citite toate (am citit `fisier-intern` și `mail-cu-atasamente` — retrase, 410 —, `ingest-document`, `hr-clasifica` — alte bucket-uri); datele (toate obiectele și rândurile pe convenția panoului) nu arată alt scriitor. Un scriitor service_role nou nu e legat de 4a (e de încredere, ocolește RLS) — dacă apare, se discută.

## 4. Matricea așteptată (după 20261103c)
Profiluri: U = a urcat; HR = `can_access_personal_data`; L = `admin_logistica`; MP = are șantierul proiectului; F = `can_access_financiar`; O = owner; N = cont logat fără drepturi; anon.

| Obiect / acțiune | U | HR | L | MP | F | O | N | anon | service_role |
|---|---|---|---|---|---|---|---|---|---|
| act HR al lui U — vede / șterge | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ |
| document logistică — vede | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ |
| document Execuție cu proiect — vede | ✅ | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ |
| Execuție fără proiect / UPA — vede | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ |
| certificat financiar — vede | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ✅ |
| rând „nedecis” (modul NULL) — vede / șterge | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (limitarea a) | ❌ | ✅ |
| orfan (fără rând) — vede / șterge | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ |
| upload în `<propriul uid>/…` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| upload în folderul altcuiva / rădăcină / `/…` / `../…` / uid cu majuscule | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| upload în `wizard-angajare/…` | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ |
| suprascriere / upsert / move / update | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| rând nou pentru fișierul propriu | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| rând nou pentru fișierul altcuiva / inexistent / în numele altcuiva | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (de încredere) |
| al doilea rând pentru același fișier | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| schimbare `fisier_path` / `uploadat_de` / nume / mărime / tip pe rând | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

Cont logat fără rând în `profiles`: vede doar ce a urcat el. JWT fără `sub`: nimic.

## 5. Test local (făcut, 21.10.2026)
`PG_BIN=/c/Users/Public/pgsql/bin bash scripts/test_ai_inbox_storage_politici.sh` — PG17 local de unică folosință, `storage.objects` = stub cu coloanele, drepturile, RLS-ul și politicile vecine live; `fn_ai_inbox_poate_confirma` și politicile cozii = textul live. **PASS** (de două ori): schelet cu gaura reprodusă (contul fără drepturi vede 10/10), validatorul runnerului acceptă migrarea, 15 gărzi de precondiție (refuz fără nimic schimbat — inclusiv RLS oprit, rând **respins** falsificat, cale dublă, cale în afara folderului, `storage.objects` ținut de altă sesiune → `lock_timeout`), politica FOR ALL fără USING / WITH CHECK nu dă acces (fals pozitiv documentat), aplicare (10 → 1, celelalte politici și datele identice), 79 de teste × 3 rulări (căi-limită `/`, `..`, segment gol, majuscule; rânduri falsificate refuzate la INSERT; atacurile indirecte prin edge / curățenie), reaplicare refuzată, revenire (nearmată / persistentă / politică, corp de funcție, index fără UNIQUE, trigger dezactivat, ACL schimbate → refuz; armată → exact politica veche), reaplicare după revenire.
Stub-ul NU dovedește comportamentul storage-api (HTTP, `owner_id` pus de server, URL-uri semnate, listare) — de aceea pasul 6, obligatoriu înainte de producție.

## 6. Test pe un branch Supabase cu Storage real (OBLIGATORIU înainte de producție)
Branch-ul costă (Supabase branching) → se creează doar cu „da”-ul lui Răzvan; fără date reale (conturi și fișiere de test). Fără secrete de producție în Vault-ul branch-ului.
0. **Neutralizarea URL-urilor de producție — ÎNAINTE de orice INSERT pe branch.** `fn_ai_inbox_trigger_clasificare` (20261011a) cheamă FIX `https://dxczwkbciseqniprspcu.supabase.co/functions/v1/citeste-orice` cu `inbox_id`: un rând de test pe branch ar porni edge-ul de PRODUCȚIE, care ar clasifica rândul de producție cu același id (și ar plăti apelul AI). La fel ~36 de joburi `cron.job` au URL-ul de producție în comandă (ex. `recycle_bin_cleanup_zilnic`). Pe branch, ca postgres: (a) read-only — `pg_get_functiondef('public.fn_ai_inbox_trigger_clasificare()'::regprocedure)` și `SELECT jobid, jobname FROM cron.job WHERE command LIKE '%dxczwkbciseqniprspcu%'`; (b) `ALTER TABLE public.ai_documente_inbox DISABLE TRIGGER trg_ai_inbox_clasificare` sau funcția rescrisă cu URL-ul branch-ului (pentru testul edge-ului), plus `cron.alter_job(jobid, active := false)` pe fiecare job găsit; (c) read-only după — trigger-ul dezactivat / URL-ul branch-ului, 0 joburi active cu URL-ul de producție, Vault-ul branch-ului fără `INTERN_EDGE_SECRET` de producție. Abia apoi pașii de mai jos.
1. **Pregătire**: verifică read-only că bucket-ul există privat și `ai_inbox_obj_all` e exact cea live (dacă branch-ul nu are bucket-ul / politica, se creează exact ca live — fixture de test). 7 conturi de test în Auth-ul branch-ului + rânduri în `profiles`: U, HR, L, MP (cu `profile_sites` pe un proiect de test), **F** (`can_access_financiar`), O (`is_owner`), N.
2. **Înainte de migrare** (dovada găurii): cu N, `storage.from('ai-documente-inbox').list(<uid U>)` și `download` pe un fișier urcat de U → reușesc; N își creează un rând cu calea actului lui U → reușește (dovada rândului falsificat).
3. **Aplicare**: `scripts/livrare_migrare.sh` pe branch (endpoint-ul branch-ului, sha256 aprobat) — exact traseul de producție. Postcondiția confirmă pe ținta reală constantele de deparse (dacă diferă, migrarea cade fără să schimbe nimic → constantele se corectează, se reia).
4. **Drumuri reale** (storage-js cu cheia anon a branch-ului + sesiunea fiecărui cont; sau UI-ul dintr-un preview Vercel legat de branch):
   - U: panoul «Citește orice» → upload PDF + imagine (→ PDF); `owner_id` setat de server = uid **chiar la INSERT** (verifică read-only în `storage.objects`); `upload` = `INSERT … RETURNING` trece (cere politica SELECT pe rândul nou — clauza a); previzualizare (URL semnat) OK; upload cu același nume în 10 min → rândul refuzat de `trg_ai_inbox_dedup` → fișierul șters (nu rămâne orfan).
   - HR: vede actul lui U în coada HR, previzualizează, „✓ Confirmă” → document în `documente-personal`, staging-ul dispare (`remove` = `DELETE … RETURNING`); „Închide (e deja în dosar)” la fel; din panoul HR rândul nou are `modul_tinta = 'hr'` de la upload (nu trece prin „nedecis”); wizard „Angajat nou”: upload dosar (cale `wizard-angajare/…`, rând `modul_tinta = 'hr'`), Finish → documente salvate, staging șters; „scoate” un document din wizard → fișierul șters.
   - L / MP / F: fiecare confirmă un document din modulul lui; nu vede (listare, download, URL semnat → 400/403 „Object not found”) actul HR.
   - N: `list()` pe folderul lui U → gol; `list()` pe rădăcină cu / fără `delimiter`, `search`, `prefixes` (storage.search / list_objects_with_delimiter) → nimic din ce nu e al lui; `download` / `createSignedUrl` / `createSignedUrls` pe actul HR → eroare; `upload` în folderul lui U / în rădăcină / sub `wizard-angajare/` → 403 (RLS); căi-limită: `/<uid>/x`, `../<uid>/x`, `<uid>//x`, `<uid>/../<altul>/x`, `<UID MAJUSCULE>/x`, `%2F` codat → ce acceptă / normalizează storage-api și unde ajunge cheia; `upload(…, { upsert: true })` peste propriul fișier → 403; `move` / `copy` peste fișierul altcuiva → refuz; `remove` pe actul HR → 0 șterse.
   - **Owner spoofing**: N urcă cu metadate / antete care încearcă să pună alt owner (`metadata.owner`, `x-upsert`, `owner` în corpul multipart) → `owner_id` rămâne uid-ul lui N; un obiect urcat cu service_role (`owner_id` NULL) nu se leagă de niciun rând nou al unui cont logat.
   - **Atacurile indirecte**: N creează un rând cu calea actului lui U (orice stare: `in_asteptare`, `respins`) → 42501 de la `trg_ai_inbox_fisier_legat`; N își creează rândul pentru fișierul LUI, îl respinge, rulezi `cleanup-recycle-bin` pe branch (dry_run, apoi real) → se șterge doar fișierul lui N; edge-ul `citeste-orice` pe branch (URL-ul branch-ului, pasul 0) clasifică doar fișiere ale celui care a creat rândul.
   - **Concurență**: migrarea pornită în timp ce un cont urcă în buclă (4 fișiere în paralel, ca panoul) → upload-urile așteaptă zeci de ms, apoi trec; cu o sesiune care ține `storage.objects` > 5 s → migrarea cade pe `lock_timeout`, nimic schimbat; două upload-uri + rânduri simultane ale aceluiași cont → ambele trec (căi diferite).
   - O: vede și șterge un orfan.
   - service_role: edge-ul `citeste-orice` clasifică un fișier nou (descarcă OK); `cleanup-recycle-bin` șterge fișierele rândurilor respinse.
   - Trigger-e: din SQL editor cu rol `authenticated` simulat (sau PATCH PostgREST cu sesiunea N) pe un rând nedecis, `fisier_path` nou → 23514; INSERT în coadă cu calea altcuiva → 42501.
5. **Performanță**: `list()` pe folderul HR cu ~100 de obiecte — timp comparabil cu înainte (`EXPLAIN` pe politica SELECT: index scan pe `idx_ai_inbox_fisier_path`).
6. **Revenire pe branch**: rollback armat → N vede din nou tot (dovada că revenirea e exactă); reaplicare.
7. Trigger-ul / joburile neutralizate la pasul 0 rămân așa; branch-ul se șterge la final.

## 7. Livrare în producție (după GO)
Ordinea: PR-ul (frontend: `modul_tinta = 'hr'` în panoul HR și în wizard) se poate livra oricând — merge cu politica veche și cu cea nouă. Migrarea: după pasul 6 trecut → review Copilot / Jakarinos pe diff → „da” de la Răzvan (schemă + drepturi) → `livrare_migrare.sh` cu sha256 aprobat → read-only după: 3 politici `ai_inbox_obj_*`, `ai_inbox_obj_all` absentă, 2 trigger-e + indexul unic; smoke cu un cont HR (upload, previzualizare, confirmare) și cu un cont fără drepturi (nu vede nimic din HR, nu-și leagă un rând de fișierul altcuiva); Sentry / logurile storage 24 h pentru 403 neașteptate („new row violates row-level security policy” la upload = o cale nouă neacoperită → forward-fix, nu revenire; 42501 „fișierul rândului nu e în coadă…” = un drum care creează rândul fără upload propriu → analiză).

## 8. Rămân de decis (nu în 20261103c)
- **a.** Rândurile „nedecise” (`modul_tinta` NULL) și fișierele lor sunt vizibile / ștergibile de orice cont cu profil (regula cozii, `fn_ai_inbox_poate_confirma(NULL)` = true; Execuție confirmă nedecise). **Nu doar istoric**: orice upload fără modul pre-setat e nedecis cât îl clasifică AI-ul (secunde) și definitiv dacă ajunge în „eroare” fără modul. Din acest PR, panoul HR și wizard-ul „Angajat nou” pre-setează `hr` (clasificatorul v18 păstrează modulul pre-setat: `modulFinal = row.modul_tinta || modulParsed`, iar potrivirea angajatului rulează pentru `hr`); UPA și Execuție cu proiect erau deja pre-setate. Rămân nedecise upload-urile din Execuție fără proiect, Logistică și Financiar (rutate de AI între module — pre-setarea lor schimbă comportamentul, decizie separată). Restrângerea reală = migrare separată pe regula cozii.
- **b.** `ai_inbox_update` (WITH CHECK doar `auth.uid() IS NOT NULL`): un confirmator poate muta un rând al lui în „nedecis” → fișierul devine vizibil tuturor (T6n–T6o). Un cont fără drepturi NU poate muta nedecisul în alt modul (PostgreSQL aplică `ai_inbox_select` și rândului nou — T6m). Migrare separată pe politica UPDATE a cozii.
- **c.** Wizard-ul ar trebui să urce în `<uid>/wizard-angajare/…`; după acel fix, excepția `wizard-angajare/` din INSERT se scoate.
- **d.** Trigger-ul 4b acoperă și nume / mărime / tip (întărește garda 20261103a); dacă se vrea minimul strict, rămân doar `fisier_path` + `uploadat_de`.
- **e.** Ștergerea rândului de către wizard cere owner (`ai_inbox_delete`) — preexistent; pentru HR fără owner rândul rămâne în coadă fără fișier.
- **f.** Verificarea legăturii și în codul edge-urilor (apărare în adâncime: `owner_id` = `uploadat_de` înainte de `download` / `remove`) — cere deploy de edge (la Răzvan); invariantul din BD (4a–4c + precondiția pe toate rândurile) acoperă azi ambele edge-uri.
- **g.** Observat în catalogul live, în afara acestui patch: `ai_inbox_modul_chk` permite doar `executie / hr / logistica / financiar` — `upa` (pus de panoul UPA și de clasificator) ar fi refuzat la INSERT / UPDATE. De verificat separat.
