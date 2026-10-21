# Coada «Citește orice» — bucket `ai-documente-inbox`: politici storage (20261103c)

**Stare: PREGĂTIT, NEAPLICAT.** Migrare: `supabase/migrations/20261103c_ai_inbox_storage_politici.sql` · revenire (redeschide gaura, fără GO): `supabase/revenire/20261103c_ai_inbox_storage_politici_ROLLBACK.sql` · test local: `scripts/test_ai_inbox_storage_politici.sh`. Nu atinge `src/` (fără build).

## 1. Gaura (catalog live citit read-only, 21.10.2026)
- `storage.objects` are o singură politică pentru bucket: `ai_inbox_obj_all` = `FOR ALL TO authenticated USING / WITH CHECK (bucket_id = 'ai-documente-inbox')`.
- Efect: **orice cont logat** listează, descarcă, suprascrie (upsert / update / move) și șterge fișierele din coadă ale tuturor modulelor — inclusiv buletine, pașapoarte, cazier urcate în HR.
- Azi: 59 de obiecte (3 fără rând în coadă), toate în `<uid>/…` cu `owner_id` = uid = `uploadat_de`; 1330 de rânduri în coadă, toate cu calea `<uid>/…`. Bucket privat, fără versionare. Celelalte 109 politici pe `storage.objects` sunt legate de alte bucket-uri.
- Tabela `ai_documente_inbox` are deja RLS pe rând (`ai_inbox_select` = `uploadat_de = uid OR modul_tinta IS NULL OR fn_ai_inbox_poate_confirma(modul_tinta, entitate_id)`), dar fișierul nu era legat de ea.

## 2. Ce face 20261103c
| # | Obiect | Regulă |
|---|---|---|
| 1 | `ai_inbox_obj_insert` (INSERT) | doar în `<uid>/…` (primul segment = `auth.uid()`); sau `wizard-angajare/…` doar pentru owner / `can_access_personal_data` |
| 2 | `ai_inbox_obj_select` + `ai_inbox_obj_delete` | (a) `owner_id = auth.uid()` (cine a urcat) · (b) există rând în coadă cu `fisier_path = name` **și** `uploadat_de = owner_id`-ul obiectului **și** `fn_ai_inbox_poate_confirma(modul_tinta, entitate_id)` · (c) `profiles.is_owner`. Toate cer `auth.uid()` ne-NULL |
| 3 | fără UPDATE / ALL | nimeni în afară de `service_role` nu suprascrie, nu mută, nu redenumește |
| 4 | `trg_ai_inbox_fisier_imutabil` | `fisier_path`, `uploadat_de`, `fisier_nume`, `fisier_size_bytes`, `fisier_mime` nemodificabile după INSERT (23514, pentru oricine) |
| 5 | `idx_ai_inbox_fisier_path` | căutarea rândului legat, per obiect |

De ce legătura `uploadat_de = owner_id` și trigger-ul (4): `fisier_path` îl scrie clientul. Fără ele, oricine își face un rând „nedecis” (sau editează unul — `ai_inbox_update` are `WITH CHECK (auth.uid() IS NOT NULL)`) cu calea actului HR al altcuiva și îl descarcă. Testele T6a–T6l o fixează.

## 3. Toate drumurile de cod care ating bucket-ul
| Drum | Operație storage | Identitate | Cerință după 20261103c | Rezultat |
|---|---|---|---|---|
| `src/CitesteOricePanel.jsx` `urcaUnFisier` | `upload(<uid>/<ts>_<rand>.<ext>, upsert:false)` | JWT utilizator | INSERT în folderul propriu | ✅ (T3a, T3b) |
| idem, INSERT rând eșuat (dublură) | `remove([path])` | JWT, fără rând încă | DELETE ca cel care a urcat | ✅ (T7a) |
| `preview` | `createSignedUrl(path, 120)` | JWT | SELECT (a)/(b)/(c) | ✅ dacă vede rândul (T2) |
| `mutaFisier` (Execuție, HR, Logistică, UPA) | `download(path)` | JWT confirmator | SELECT (b) | ✅ (T7c, T7f, T7h) |
| `confirmFinanciar` | `download(path)` | JWT | SELECT (b) | ✅ (T2g) |
| `finalizeInbox` (după închiderea rândului) | `remove([path])` | JWT confirmator | DELETE (b) | ✅ (T5c, T7c) |
| `handleReject`, `mutaModul` | — (doar tabela) | — | — | neatins |
| `src/HrAngajatNouWizard.jsx` `handleFiles` | `upload(wizard-angajare/<ts>_<rand>/<nume>, upsert:false)` | JWT HR | INSERT sub `wizard-angajare/` cu drept HR | ✅ (T3g); fără drept → refuz (T3f) |
| wizard, INSERT rând eșuat / `scoateDoc` / abandon | `remove([path])` | JWT HR | DELETE (a) | ✅ (T7e) |
| wizard `finish` | `download` + `remove` după închidere | JWT HR | SELECT / DELETE (a)/(b) | ✅ (T7d) |
| edge `citeste-orice` | `download(row.fisier_path)` | `service_role` | ocolește RLS | neatins (T2k) |
| edge `cleanup-recycle-bin` | `remove(paths)` pentru rânduri respinse | `service_role` | ocolește RLS | neatins (T5i) |
| `fn_ai_inbox_trigger_clasificare` | — (pg_net → edge) | — | — | neatins |
| `/CitesteOricePanel.jsx` (copie veche în rădăcina repo-ului) | aceeași convenție `<uid>/…` | — | nu e importată în build (`src/ctc/ctcDb.js` importă `src/CitesteOricePanel.jsx`) | — |

Verificat și: nicio funcție din BD și niciun job cron nu numește bucket-ul; edge-urile din repo care îl ating sunt doar cele două de mai sus. Edge-urile deployate fără sursă în repo n-au fost citite toate (am citit `fisier-intern` și `mail-cu-atasamente` — retrase, 410 —, `ingest-document`, `hr-clasifica` — alte bucket-uri); datele (toate obiectele și rândurile pe convenția panoului) nu arată alt scriitor.

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
| upload în folderul altcuiva / rădăcină | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| upload în `wizard-angajare/…` | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ |
| suprascriere / upsert / move / update | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| schimbare `fisier_path` / `uploadat_de` / nume / mărime / tip pe rând | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

Cont logat fără rând în `profiles`: vede doar ce a urcat el. JWT fără `sub`: nimic.

## 5. Test local (făcut, 21.10.2026)
`PG_BIN=/c/Users/Public/pgsql/bin bash scripts/test_ai_inbox_storage_politici.sh` — PG17 local de unică folosință, `storage.objects` = stub cu coloanele, drepturile, RLS-ul și politicile vecine live; `fn_ai_inbox_poate_confirma` și politicile cozii = textul live. **PASS**: schelet cu gaura reprodusă (contul fără drepturi vede 10/10), validatorul runnerului acceptă migrarea, 10 gărzi de precondiție (refuz fără nimic schimbat), aplicare (10 → 1, celelalte politici și datele identice), 63 de teste × 3 rulări, reaplicare refuzată, revenire (nearmată / persistentă / stare modificată → refuz; armată → exact politica veche), reaplicare după revenire.
Stub-ul NU dovedește comportamentul storage-api (HTTP, `owner_id` pus de server, URL-uri semnate, listare) — de aceea pasul 6.

## 6. Test pe un branch Supabase cu Storage real (înainte de producție)
Branch-ul costă (Supabase branching) → se creează doar cu „da”-ul lui Răzvan; fără date reale (conturi și fișiere de test).
1. **Pregătire**: branch nou; verifică read-only că bucket-ul există privat și `ai_inbox_obj_all` e exact cea live (dacă branch-ul nu are bucket-ul / politica, se creează exact ca live — fixture de test). 6 conturi de test în Auth-ul branch-ului + rânduri în `profiles`: U, HR, L, MP (cu `profile_sites` pe un proiect de test), O (`is_owner`), N.
2. **Înainte de migrare** (dovada găurii): cu N, `storage.from('ai-documente-inbox').list(<uid U>)` și `download` pe un fișier urcat de U → reușesc.
3. **Aplicare**: `scripts/livrare_migrare.sh` pe branch (endpoint-ul branch-ului, sha256 aprobat) — exact traseul de producție.
4. **Drumuri reale** (storage-js cu cheia anon a branch-ului + sesiunea fiecărui cont; sau UI-ul dintr-un preview Vercel legat de branch):
   - U: panoul «Citește orice» → upload PDF + imagine (→ PDF); `owner_id` setat de server = uid (verifică read-only în `storage.objects`); previzualizare (URL semnat) OK; upload cu același nume în 10 min → rândul refuzat de `trg_ai_inbox_dedup` → fișierul șters (nu rămâne orfan).
   - HR: vede actul lui U în coada HR, previzualizează, „✓ Confirmă” → document în `documente-personal`, staging-ul dispare; „Închide (e deja în dosar)” la fel; wizard „Angajat nou”: upload dosar (cale `wizard-angajare/…`), Finish → documente salvate, staging șters; „scoate” un document din wizard → fișierul șters.
   - L / MP / F: fiecare confirmă un document din modulul lui; nu vede (listare, download, URL semnat → 400/403 „Object not found”) actul HR.
   - N: `list()` pe folderul lui U → gol; `download` / `createSignedUrl` pe actul HR → eroare; `upload` în folderul lui U / în rădăcină / sub `wizard-angajare/` → 403 (RLS); `upload(…, { upsert: true })` peste propriul fișier → 403; `move` / `copy` peste fișierul altcuiva → refuz; `remove` pe actul HR → 0 șterse.
   - O: vede și șterge un orfan.
   - service_role: edge-ul `citeste-orice` clasifică un fișier nou (descarcă OK); `cleanup-recycle-bin` șterge fișierele rândurilor respinse.
   - Trigger: din SQL editor cu rol `authenticated` simulat (sau PATCH PostgREST cu sesiunea N) pe un rând nedecis, `fisier_path` nou → 23514.
5. **Performanță**: `list()` pe folderul HR cu ~100 de obiecte — timp comparabil cu înainte (`EXPLAIN` pe politica SELECT: index scan pe `idx_ai_inbox_fisier_path`).
6. **Revenire pe branch**: rollback armat → N vede din nou tot (dovada că revenirea e exactă); reaplicare.
7. Branch-ul se șterge la final.

## 7. Livrare în producție (după GO)
Review Copilot / Jakarinos pe diff → „da” de la Răzvan (schemă + drepturi) → `livrare_migrare.sh` cu sha256 aprobat → read-only după: 3 politici `ai_inbox_obj_*`, `ai_inbox_obj_all` absentă, trigger + index; smoke cu un cont HR (upload, previzualizare, confirmare) și cu un cont fără drepturi (nu vede nimic din HR); Sentry / logurile storage 24 h pentru 403 neașteptate („new row violates row-level security policy” la upload = o cale nouă neacoperită → forward-fix, nu revenire).

## 8. Rămân de decis (nu în 20261103c)
- **a.** Rândurile „nedecise” (`modul_tinta` NULL) și fișierele lor sunt vizibile / ștergibile de orice cont cu profil (regula cozii, `fn_ai_inbox_poate_confirma(NULL)` = true; Execuție confirmă nedecise). Restrângere = schimbarea regulii cozii.
- **b.** `ai_inbox_update` (WITH CHECK doar `auth.uid() IS NOT NULL`): un confirmator poate muta un rând al lui în „nedecis” → fișierul devine vizibil tuturor (T6n–T6o). Un cont fără drepturi NU poate muta nedecisul în alt modul (PostgreSQL aplică `ai_inbox_select` și rândului nou — T6m).
- **c.** Wizard-ul ar trebui să urce în `<uid>/wizard-angajare/…`; după acel fix, excepția `wizard-angajare/` din INSERT se scoate.
- **d.** Trigger-ul (4) acoperă și nume / mărime / tip (întărește garda 20261103a); dacă se vrea minimul strict, rămân doar `fisier_path` + `uploadat_de`.
- **e.** Ștergerea rândului de către wizard cere owner (`ai_inbox_delete`) — preexistent; pentru HR fără owner rândul rămâne în coadă fără fișier.
