# Runbook livrare — garda citirii automate Ofertare (PR #553)

Stare la **02.10.2026 (branch sincronizat cu `main` @ cf4c438, fără rebase)**: **garda NU e aplicată, edge v13 NU e deployat, workerul NAS nu rulează codul gărzii.** Fiecare pas de mai jos cere acordul lui Răzvan, în ordine. Copilot: GO pe mecanism (r4/r5), cu condiția: **nu se reia ingestul** până când #543 nu e live + **verificat** ȘI finding-ul de autorizare `ofertare-word-text` (JAK-V2-05 / S10-01) nu e închis.

Ordinea: **merge → secret → migrare → edge → worker → probe → coadă**.

## 0. Precondiții (preview read-only pe `dxczwkbciseqniprspcu`, 01.10.2026 ~20:35 UTC)

### 0.1 Ce s-a schimbat față de 01.10 (toate LIVE, aplicate prin `scripts/livrare_migrare.sh`)

| PR | Migrare | Versiune `schema_migrations` | Efect pentru acest runbook |
|---|---|---|---|
| #551 F1 | `20260930i_sec_f1_truncate_revoke` | 20261001123000 | TRUNCATE retras de la anon/authenticated — garda nu depinde |
| #551 F2 | `20260930j_sec_f2_profiles_uid_null` | 20261001124500 | triggerele profiles nu mai sar verificarea la `auth.uid()` NULL |
| #563 F1b | `20261006a_sec_f1b_maintain_revoke` | 20261001224000 | MAINTAIN retras (474 relații) + default ACL — tabelul nou `ofertare_ingest_garda` e creat DUPĂ, deci primește ACL-ul implicit nou; migrarea îi dă oricum doar SELECT prin RLS (verificare în §2) |
| #540 | `20261003d_sec_concediu_tokens` | 20261001200000 | fără legătură |
| #541 | `20261003e_sec_trezorerie` | 20261001201500 | fără legătură |
| #562 | `20261006b_sec_garantii_iban` | 20261001222000 | fără legătură |
| **#543** monitor egress | `20260930e_monitor_egress` | **20261001175000** | 4 tabele `storage_*` cu RLS, 8 RPC `egress_*`, 2 joburi cron |
| **#543b** fix | `20261002a_monitor_egress_fix` | **20261001184500** | helper `egress_cheie_obiect`, detector tolerant la notificare eșuată; md5 live = varianta patch (`2cc00f0d…`) |

Runner-ul `scripts/livrare_migrare.sh` (runda 9, verdict Copilot R9) e **singurul gestionar de tranzacție** pentru migrările forward: psql `--single-transaction` pe copie protejată, sha256 aprobat, pre-verificare read-only (db + `system_identifier` + endpoint de scriere + `pg_is_in_recovery()=false`), marcaj `gazpet.livrare_migrare`, înregistrare în `schema_migrations`, reconciliere + gate 0e. Nu se mai acceptă `--service`; parola doar din `~/.pgpass`.

### 0.2 Starea obiectelor acestui PR

| Verificare | Rezultat live | OK? |
|---|---|---|
| Obiecte noi (`ofertare_ingest_garda` + 4 funcții) | 0 | da (migrarea refuză dacă există) |
| `schema_migrations` cu `ingest_garda` | 0 | da |
| `fn_are_acces_ofertare()` — md5 `prosrc` / overload-uri | `429d28e2a61fb24c8009d67050c16c85` / 1 | da (= amprenta cerută; neschimbată de F1/F1b/F2) |
| `ofertare_documente_atribuire` (`id bigint`, `status_procesare text`), `profiles.is_owner` | prezente | da |
| Setări persistente `gazpet.livrare*` în `pg_db_role_setting` | 0 | da |
| `system_identifier` | `7632885393857617092` | pentru `--tinta-sistem` |
| Coada `ofertare_ingest_coada` active | 0 / 10 | da (ingest oprit) |
| Documente: neprocesat 40, in_lucru 2, partial 19, eroare 1, procesat 970, ignorat 139 | neschimbat față de 01.10 | `in_lucru` 2 de verificat (agățate?) |
| pg_cron `ofertare_ingest_worker` (`SELECT ofertare_ingest_tick()`, fiecare minut) | **activ** | inert cât workerul NAS bate (heartbeat); după deploy v13 apelurile lui anon → 401 (decizia A) |
| Heartbeat `ofertare-worker` | viu (01.10 20:33 UTC), `detalii.sha = cf4c438`, `branch = main` | workerul NAS rulează **main-ul curent** (instrumentarea egress din #543 e în el; garda din #553 NU) |
| Edge `ofertare-ingest-doc` | ACTIVE, versiunea Supabase 22, `verify_jwt=true` (cod v12) | de înlocuit cu v13 |
| Edge `ofertare-word-text` | ACTIVE, versiunea 5, **`verify_jwt=false`**, finding deschis | NU se redeployează până la închiderea finding-ului |
| Vault: secret cu `ingest` în nume | 0 | normal (secretul stă în env-ul edge + `.env` NAS, nu în Vault) |

### 0.3 #543 monitor egress — live, dar încă NEVERIFICAT cu trafic real

| Verificare | Rezultat live |
|---|---|
| Tabele `storage_egress_config`, `storage_descarcari_jurnal`, `storage_obiecte_blocate`, `storage_egress_alerte` | 4/4, RLS on, politică `*_owner_select` (SELECT), grants: `authenticated:SELECT`, `service_role:ALL`, `anon`: nimic |
| Funcții `egress_*` | 9 (8 + helper); EXECUTE `anon`: niciuna; `authenticated` doar `egress_ciclu_start`/`egress_este_owner`/`egress_deblocheaza`/`egress_statistici` (poarta `is_owner` e în funcție); logger/poartă/detector/notifica/helper doar `service_role` |
| Config | 1 rând: prag obiect 20/oră, prag zilnic 20 GB, cotă ciclu 250 GB, ciclu de la 07, alerte 50/80 %, `blocare_activa = true` |
| pg_cron | `egress_detector_5min` (`*/5 * * * *`) și `egress_jurnal_purge` (03:17) active; ultimele 8 rulări `succeeded` |
| Jurnal / blocate / alerte / notificări `egress_alerta` | **0 / 0 / 0 / 0** — coada e oprită, nimic nu descarcă |
| Widget `MonitorEgress` (owner) | în `src/App.jsx` pe main (lazy, doar `isSuperAdmin`), deployat Vercel odată cu #543 |
| Worker NAS | rulează `main` @ cf4c438 → `worker/ofertare/egress.ts` cablat în `ingest.ts` și `citire_mare.ts` |
| Edge `ofertare-ingest-doc` | **neinstrumentat** (cablarea edge a fost scoasă din #543; intră cu v13 doar dacă se decide — vezi §3) |

Concluzie: condiția „#543 live” e îndeplinită; condiția „**verificat**” (o descărcare apare în jurnal; un obiect peste prag se blochează + notificare owner) se închide la §5, pe un document mic, înainte de a reporni coada.

## 0.4 Merge-ul cu main (02.10)

Branch-ul a fost adus la zi cu `git merge origin/main` (fără rebase; sha-ul migrării `20260930k` rămâne `793074ca…697f`). Două conflicte, rezolvate:
- `supabase/revenire/README.md`: s-au păstrat toate secțiunile (20260930k + cele 9 din main).
- `worker/ofertare/ingest.ts`: ordinea decisă în `INGEST_GARDA.md` (3) — **garda → poarta egress → descărcare**: pe drumul local (`citesteDupaGarda`) și pe calea Word (`citesteWordLicitatie`) descărcarea e `cuTermen(descarcaCuJurnal(...))` — jurnalul egress + poarta pe obiect din #543 rămân, termenul și tokenul gărzii rămân. `citire_mare.ts` s-a unit automat (poarta egress + jurnal `nas:citire_mare`, iar `citesteMareCuGarda` îl înconjoară cu lease-ul gărzii).

Verificat după merge: `npx vite build` OK; `npx vitest run src/ingestGarda.test.js` OK. **Neverificat** (fără `deno` în container): `worker/ofertare/ingest_garda_test.ts`, `ingest_mare_test.ts`, `egress_test.ts`, `supabase/functions/ofertare-ingest-doc/garda_test.ts` — de rulat pe PC-ul de birou (`deno test -A worker/ofertare/`) înainte de merge.

## 1. Secret

- Nume: **`OFERTARE_INGEST_SECRET`** (≥ 32 caractere aleatoare, generat local, ex. `openssl rand -base64 48`). Valoarea NU intră în chat/repo.
- Unde: Edge Function secrets din proiect (`supabase secrets set OFERTARE_INGEST_SECRET=…` de pe PC-ul de birou) + `.env` workerului NAS (`chmod 600`).
- Cine îl folosește: workerul NAS → header `x-ingest-secret` → `ofertare-ingest-doc` (comparat în timp constant).
- Se actualizează `registru_automatizari` (doar numele).

## 2. Migrarea — doar prin runner, de pe PC-ul de birou

Fișier: `supabase/migrations/20260930k_ofertare_ingest_garda.sql`
**sha256 aprobat: `793074ca5ac9ab202ef8e329bbc14e430ca592479766db9f164f1b2f7d4a697f`** (neschimbat de la GO: identic în d5fd961, b9364f5, după merge-ul main din 01.10 și după merge-ul din 02.10). Garda `gazpet.livrare_migrare` (start + final) e deja în fișier; `livrare_validator.py` → OK 22 instrucțiuni.

```bash
git pull --ff-only
sha256sum supabase/migrations/20260930k_ofertare_ingest_garda.sql   # trebuie să iasă 793074ca…697f
bash scripts/livrare_migrare.sh \
  --migrare supabase/migrations/20260930k_ofertare_ingest_garda.sql \
  --sha256 793074ca5ac9ab202ef8e329bbc14e430ca592479766db9f164f1b2f7d4a697f \
  --versiune 20261002090000 \
  --tinta-db postgres --tinta-sistem 7632885393857617092 \
  --tinta-host <host-ul de scriere al proiectului> --tinta-port <port> [--user postgres]
```
Parola doar din `~/.pgpass`; fără `--service`, fără `PGSERVICE*`/`PGPASSWORD`/`PGOPTIONS` în mediu (runner-ul refuză). Coduri: 0 = aplicat + înregistrat; 11 = deja; 10 = neaplicat; 12 = nepornit; 20/21/22 = STOP, reconciliere manuală; 30/31 = comis dar gate-ul 0e a găsit/n-a rulat ⇒ analiză înainte de orice pas următor (vezi antetul runner-ului). Versiunea `20261002090000` e propunere (după ultima live, 20261001224000; cea veche `20260930000011` ar fi fost sub versiunile deja înregistrate) — se fixează la aprobare și nu se mai schimbă.
După: `get_advisors` (security) + verificare read-only: tabelul există, `anon` 0 privilegii, `authenticated` doar SELECT prin RLS (modul Ofertare), EXECUTE pe `_incearca`/`_rezultat` doar `service_role`; `scripts/control_0e.sql` = 0 rânduri (gate-ul rulează oricum în runner).

## 3. Edge functions

| Funcție | Ce | `verify_jwt` | Când |
|---|---|---|---|
| `ofertare-ingest-doc` | v13 (garda; fără cale anon; secret sau user cu modul Ofertare + poarta pe cheltuială) | **true** (ca acum; autorizarea reală e în cod) | după migrare |
| `ofertare-word-text` | trece prin gardă (`edge:ofertare-word-text`) | **false** (ca acum, autentificare proprie) | **NU** în acest pas — doar după închiderea finding-ului JAK-V2-05 (verificare de modul după `getUser`). Până atunci rămâne versiunea 5 deployată. |

Deploy: `supabase functions deploy ofertare-ingest-doc --project-ref dxczwkbciseqniprspcu` (include `_shared/gardaIngest*.ts`). Notă #543: cablarea egress în edge (`_shared/egress.ts`) NU e în acest PR; v13 descarcă prin gardă (plafon 80/document), dar nu scrie în `storage_descarcari_jurnal` — pe calea edge jurnalul rămâne limită inferioară până la un PR separat (amânat în #543).

## 4. Worker NAS (Terra, Docker)

Rulează pe NAS, proiect compose `gazpet-ofertare-worker` (`worker/ofertare/README.md`). Rulează acum `main` @ cf4c438 (egress cablat, fără gardă).
1. Adaugă `OFERTARE_INGEST_SECRET` în `.env` (chmod 600).
2. După merge-ul #553: actualizează fișierele (`curl` din `main`, ca în README — inclusiv `garda.ts` și `egress.ts`) și repornește: `docker-compose -p gazpet-ofertare-worker up -d --build`.
3. Verifică: heartbeat `worker_heartbeat.nume='ofertare-worker'` < 10 min cu `detalii.sha` = commit-ul de merge, logurile containerului fără `garda:` neașteptat.

Ordinea edge → worker evită ca workerul nou să trimită secretul unui edge vechi (care l-ar ignora). Cât coada e inactivă, workerul nu citește nimic, indiferent de versiune.

## 5. Probe (după 3 + 4, coada încă oprită)

- apel `ofertare-ingest-doc` cu cheia anon → **401**; secret greșit → **401**; `service_role` ca Bearer fără secret → **401/403**;
- user fără modul Ofertare → **403**; user cu modul dar nu owner/responsabil → **403** (poarta pe cheltuială);
- două apeluri simultane pe același document → unul `in_curs`, fără dublă descărcare;
- worker + edge concurent pe același document → o singură descărcare (rândul din `ofertare_ingest_garda`);
- tick-ul pg_cron: apelul lui primește 401 (fallback inert, decizia A din `INGEST_GARDA.md`);
- **verificarea #543 (condiția „verificat”)**: pe UN document mic ales de Răzvan, citit prin worker → un rând nou în `storage_descarcari_jurnal` (`sursa = 'nas:ingest'`, `doc_id`, `bytes` = mărimea reală) și apare în widgetul owner; apoi (opțional, pe același obiect, sub supraveghere) > 20 descărcări/oră → `storage_obiecte_blocate` + `notifications.type='egress_alerta'` la owneri + `egress_obiect_blocat()` = true + workerul refuză cu `MESAJ_BLOCAT`; deblocare din widget → poarta = false. Dacă nu se vrea proba de blocare pe live, rămâne dovada din harness (`scripts/test_monitor_egress_fix.sh`, A–D) + rândul din jurnal.

## 6. Criterii de reluare a cozii (`ofertare_ingest_coada.activ = true`)

Toate, simultan:
1. ~~#543 aplicat~~ **DONE 01.10** (20260930e v20261001175000 + fix 20261002a v20261001184500, cron activ, worker instrumentat) — rămâne **verificarea** din §5 (rând în jurnal; blocare + notificare, live sau harness).
2. Finding-ul `ofertare-word-text` (JAK-V2-05) închis — fix livrat și verificat sau funcția dezactivată.
3. Pașii 1–5 de mai sus trecuți, cu rezultat consemnat.
4. Verdict Copilot pe delta (stare după livrare) + acordul explicit al lui Răzvan.
5. Pornire pe O licitație, cu urmărirea egress-ului în prima oră (widget + `storage_descarcari_jurnal`).

## 7. Rollback

- **Coada:** `activ = false` (imediat, fără risc).
- **Worker:** revenire la imaginea anterioară (`docker-compose … up -d --build` pe fișierele din `main` @ cf4c438 — tot cu egress cablat).
- **Edge:** redeploy v12 = decizie separată (redeschide calea anon). Fără redeploy, cu migrarea scoasă, v13 e fail-closed (nu descarcă).
- **Migrare:** `supabase/revenire/20260930k_ofertare_ingest_garda_ROLLBACK.sql`, doar la decizie explicită + review Copilot; rollback-urile NU trec prin runner (el livrează doar forward) — gestionarul tranzacției e operatorul, un singur string:
  ```sql
  BEGIN;
  SELECT set_config('gazpet.revenire_20260930k', 'SCOATE_GARDA_INGEST:' || txid_current(), true);
  -- <fișierul întreg>
  COMMIT;
  ```
  Pierzi contoarele gărzii. Rândul din `schema_migrations` se tratează separat (reconciliere manuală).
- **Secret:** se șterge din edge + `.env` după rollback complet.
- **#543 nu se atinge** la rollback-ul gărzii (e independent; rollback-ul lui are propriul fișier `20261002a_monitor_egress_fix_ROLLBACK.sql` + `20260930e_monitor_egress_ROLLBACK.sql`).
