# Runbook livrare — garda citirii automate Ofertare (PR #553)

Stare la 01.10.2026: **NIMIC aplicat, nimic deployat.** Fiecare pas de mai jos cere acordul lui Răzvan, în ordine. Copilot: GO pe mecanism (r4/r5), cu condiția: **nu se reia ingestul** până când #543 nu e live + verificat ȘI finding-ul de autorizare `ofertare-word-text` (JAK-V2-05 / S10-01) nu e închis.

Ordinea: **secret → migrare → edge → worker → probe → coadă**.

## 0. Precondiții (preview read-only, 01.10.2026 ~16:00 UTC)

| Verificare | Rezultat live | OK? |
|---|---|---|
| Obiecte noi (`ofertare_ingest_garda` + 4 funcții) | 0 | da (migrarea refuză dacă există) |
| `schema_migrations` cu `ingest_garda` | 0 | da |
| `fn_are_acces_ofertare()` — md5 `prosrc` / overload-uri | `429d28e2a61fb24c8009d67050c16c85` / 1 | da (= amprenta cerută) |
| `ofertare_documente_atribuire` (`id bigint`, `status_procesare text`), `profiles.is_owner` | prezente | da |
| Setări persistente `gazpet.livrare*` în `pg_db_role_setting` | 0 | da |
| `system_identifier` | `7632885393857617092` | pentru `--tinta-sistem` |
| Coada `ofertare_ingest_coada` active | 0 / 10 | da (ingest oprit) |
| Documente: neprocesat 40, in_lucru 2, partial 19, eroare 1, procesat 970, ignorat 139 | — | `in_lucru` 2 de verificat (agățate?) |
| pg_cron `ofertare_ingest_worker` (`SELECT ofertare_ingest_tick()`, fiecare minut) | **activ** | inert cât workerul NAS bate (heartbeat); după deploy v13 apelurile lui anon → 401 |
| Heartbeat `ofertare-worker` | viu (01.10 16:01 UTC) | workerul NAS rulează codul VECHI |
| Edge `ofertare-ingest-doc` | ACTIVE, versiunea Supabase 22, `verify_jwt=true` (cod v12) | de înlocuit cu v13 |
| Edge `ofertare-word-text` | ACTIVE, versiunea 5, **`verify_jwt=false`**, finding deschis | NU se redeployează până la închiderea finding-ului |
| #543 monitor egress (`egress_*` tabele/RPC) | **0 obiecte live**, PR draft deschis | **BLOCANT pentru coadă** |
| Vault: secret cu `ingest` în nume | 0 | normal (secretul stă în env-ul edge + `.env` NAS, nu în Vault) |

## 1. Secret

- Nume: **`OFERTARE_INGEST_SECRET`** (≥ 32 caractere aleatoare, generat local, ex. `openssl rand -base64 48`). Valoarea NU intră în chat/repo.
- Unde: Edge Function secrets din proiect (`supabase secrets set OFERTARE_INGEST_SECRET=…` de pe PC-ul de birou) + `.env` workerului NAS (`chmod 600`).
- Cine îl folosește: workerul NAS → header `x-ingest-secret` → `ofertare-ingest-doc` (comparat în timp constant).
- Se actualizează `registru_automatizari` (doar numele).

## 2. Migrarea — doar prin runner, de pe PC-ul de birou

Fișier: `supabase/migrations/20260930k_ofertare_ingest_garda.sql`
**sha256 aprobat: `793074ca5ac9ab202ef8e329bbc14e430ca592479766db9f164f1b2f7d4a697f`** (neschimbat de la GO: identic în d5fd961, b9364f5 și după merge-ul main din 01.10). Garda `gazpet.livrare_migrare` (start + final) e deja în fișier; `livrare_validator.py` → OK 22 instrucțiuni.

```bash
git pull --ff-only
sha256sum supabase/migrations/20260930k_ofertare_ingest_garda.sql   # trebuie să iasă 793074ca…697f
bash scripts/livrare_migrare.sh \
  --migrare supabase/migrations/20260930k_ofertare_ingest_garda.sql \
  --sha256 793074ca5ac9ab202ef8e329bbc14e430ca592479766db9f164f1b2f7d4a697f \
  --versiune 20260930000011 \
  --tinta-db postgres --tinta-sistem 7632885393857617092 \
  --tinta-host <host-ul de scriere al proiectului> --tinta-port <port> [--user postgres]
```
Parola doar din `~/.pgpass`. Coduri: 0 = aplicat + înregistrat; 11 = deja; 10 = neaplicat; 20/21/22/30/31 = STOP, analiză (vezi antetul runner-ului). Versiunea `20260930000011` e propunere — se fixează la aprobare și nu se mai schimbă.
După: `get_advisors` (security) + verificare read-only: tabelul există, `anon` 0 privilegii, EXECUTE pe `_incearca`/`_rezultat` doar `service_role`.

## 3. Edge functions

| Funcție | Ce | `verify_jwt` | Când |
|---|---|---|---|
| `ofertare-ingest-doc` | v13 (garda; fără cale anon; secret sau user cu modul Ofertare + poarta pe cheltuială) | **true** (ca acum; autorizarea reală e în cod) | după migrare |
| `ofertare-word-text` | trece prin gardă (`edge:ofertare-word-text`) | **false** (ca acum, autentificare proprie) | **NU** în acest pas — doar după închiderea finding-ului JAK-V2-05 (verificare de modul după `getUser`). Până atunci rămâne versiunea 5 deployată. |

Deploy: `supabase functions deploy ofertare-ingest-doc --project-ref dxczwkbciseqniprspcu` (include `_shared/gardaIngest*.ts`).

## 4. Worker NAS (Terra, Docker)

Rulează pe NAS, proiect compose `gazpet-ofertare-worker` (`worker/ofertare/README.md`).
1. Adaugă `OFERTARE_INGEST_SECRET` în `.env` (chmod 600).
2. Actualizează fișierele (`curl` din `main` după merge, ca în README) și repornește: `docker-compose -p gazpet-ofertare-worker up -d --build`.
3. Verifică: heartbeat `worker_heartbeat.nume='ofertare-worker'` < 10 min, logurile containerului fără `garda:` neașteptat.

Notă: workerul rulează ACUM codul vechi; cât coada e inactivă nu citește nimic. Ordinea edge → worker evită ca workerul nou să trimită secretul unui edge vechi (care l-ar ignora).

## 5. Probe (după 3 + 4, coada încă oprită)

- apel `ofertare-ingest-doc` cu cheia anon → **401**; secret greșit → **401**; `service_role` ca Bearer fără secret → **401/403**;
- user fără modul Ofertare → **403**; user cu modul dar nu owner/responsabil → **403** (poarta pe cheltuială);
- două apeluri simultane pe același document → unul `in_curs`, fără dublă descărcare;
- worker + edge concurent pe același document → o singură descărcare (rândul din `ofertare_ingest_garda`);
- tick-ul pg_cron: apelul lui primește 401 (fallback inert, decizia A din `INGEST_GARDA.md`).
Probele pe documente reale se fac pe UN document mic ales de Răzvan.

## 6. Criterii de reluare a cozii (`ofertare_ingest_coada.activ = true`)

Toate, simultan:
1. #543 aplicat (migrarea `20260930e_monitor_egress` prin runner), instrumentarea live și **verificată** (o descărcare apare în jurnal; un obiect peste prag se blochează și owner-ul primește notificare).
2. Finding-ul `ofertare-word-text` (JAK-V2-05) închis — fix livrat și verificat sau funcția dezactivată.
3. Pașii 1–5 de mai sus trecuți, cu rezultat consemnat.
4. Verdict Copilot pe delta (stare după livrare) + acordul explicit al lui Răzvan.
5. Pornire pe O licitație, cu urmărirea egress-ului în prima oră.

## 7. Rollback

- **Coada:** `activ = false` (imediat, fără risc).
- **Worker:** revenire la imaginea anterioară (`docker-compose … up -d --build` pe fișierele vechi).
- **Edge:** redeploy v12 = decizie separată (redeschide calea anon). Fără redeploy, cu migrarea scoasă, v13 e fail-closed (nu descarcă).
- **Migrare:** `supabase/revenire/20260930k_ofertare_ingest_garda_ROLLBACK.sql`, doar la decizie explicită + review; un singur string:
  ```sql
  BEGIN;
  SELECT set_config('gazpet.revenire_20260930k', 'SCOATE_GARDA_INGEST:' || txid_current(), true);
  -- <fișierul întreg>
  COMMIT;
  ```
  Pierzi contoarele gărzii. Rândul din `schema_migrations` se tratează separat (reconciliere manuală).
- **Secret:** se șterge din edge + `.env` după rollback complet.
