# Monitor egress (#543 / #543b) — starea live la 02.10.2026

Citire **read-only** (doar `SELECT`) pe `dxczwkbciseqniprspcu`, 01.10.2026 ~20:35 UTC. **Nimic aplicat, nimic deployat în această sesiune.** Referințe: `docs/MONITOR_EGRESS.md`, `docs/AUDIT_OFERTARE_V2/543_DELTA_COPILOT.md`, `543b_DELTA_COPILOT.md`.

## 1. Ce e aplicat

| Migrare (fișier) | Versiune `schema_migrations` | Livrare |
|---|---|---|
| `20260930e_monitor_egress.sql` | **20261001175000** | prin `scripts/livrare_migrare.sh`, 01.10 (fișierul nu se mai modifică) |
| `20261002a_monitor_egress_fix.sql` | **20261001184500** | idem, 01.10 — md5 live al funcțiilor = varianta patch (detector `2cc00f0d…`, poartă `73cd68ed…`, log `ef4c8c01…`, deblocare `de5e29c4…`, helper `80cb4557…`) |

PR #543 e **merged** (01.10 18:16 UTC, `613d2fc`); #543b (fix-ul) a intrat în același PR. Nicio migrare egress nu mai e pending în repo.

## 2. Obiectele live (create de 20261001175000 / 184500)

### Tabele (toate RLS on, politică `<tabel>_owner_select` doar SELECT; grants: `authenticated` SELECT, `service_role` ALL, `anon` nimic)

| Tabel | Rânduri | Ce e |
|---|---|---|
| `storage_egress_config` | 1 | `prag_obiect_ora=20`, `prag_zilnic_bytes=21474836480` (20 GB), `cota_ciclu_bytes=268435456000` (250 GB), `ciclu_zi_start=7`, `alerte_procent={50,80}`, `blocare_activa=true`, `updated_at` 01.10 17:12 UTC |
| `storage_descarcari_jurnal` | **0** | un rând per descărcare instrumentată (bucket, obiect canonic, doc_id, bytes, sursa, created_at) |
| `storage_obiecte_blocate` | **0** (0 active) | circuit breaker per obiect |
| `storage_egress_alerte` | **0** | alerte dedublate (tip, cheie, detalii) |

Niciun view `*egress*` în `public` (monitorul nu are view-uri; widgetul citește prin RPC).

### Funcții `egress_*` (9)

| Funcție | SECURITY | EXECUTE |
|---|---|---|
| `egress_cheie_obiect(text)` | INVOKER, IMMUTABLE | service_role |
| `egress_log_descarcare(text,text,bigint,text,bigint)` | DEFINER | service_role |
| `egress_obiect_blocat(text,text)` | DEFINER | service_role |
| `egress_detector()` | DEFINER | service_role (+ postgres via cron) |
| `egress_notifica_owner(text,text)` | DEFINER | service_role |
| `egress_este_owner()` | DEFINER | authenticated, service_role |
| `egress_ciclu_start(timestamptz)` | INVOKER | authenticated, service_role |
| `egress_statistici(integer)` | DEFINER (poartă `is_owner` în corp) | authenticated, service_role |
| `egress_deblocheaza(text,text)` | DEFINER (poartă `is_owner`, `42501` altfel) | authenticated, service_role |

`anon`: niciuna.

### pg_cron

| Job | Program | Stare |
|---|---|---|
| `egress_detector_5min` (jobid 66) — `SELECT public.egress_detector()` | `*/5 * * * *` | activ; ultimele 8 rulări (19:55→20:30 UTC) `succeeded`, „1 row” |
| `egress_jurnal_purge` (jobid 67) — `DELETE … created_at < now() - 180 days` | `17 3 * * *` | activ |

## 3. Ce conține monitorul acum

- **Evenimente în jurnal: 0.** Ultimele 20: **niciunul** (tabelul e gol). Obiecte blocate: 0. Alerte: 0. Notificări `notifications.type='egress_alerta'`: 0.
- Explicație: singura sursă instrumentată care rulează (workerul NAS) nu descarcă nimic cât `ofertare_ingest_coada` e oprită (**0/10 active**). Detectorul rulează la 5 minute pe un jurnal gol ⇒ nimic de raportat. Deci monitorul e **live, dar neverificat cu trafic real**.

## 4. Instrumentarea — ce rulează efectiv

| Punct | Stare |
|---|---|
| Worker NAS `worker/ofertare/egress.ts` (`descarcaCuJurnal`, `egressBlocat`, `egressLog`) cablat în `ingest.ts` (`nas:ingest`, `nas:ingest-word`) și `citire_mare.ts` (`nas:citire_mare`) | **în cod pe `main`**; heartbeat `ofertare-worker` 01.10 20:33 UTC cu `detalii.sha = cf4c438`, `branch = main` ⇒ **workerul rulează deja codul instrumentat** (fail-open pe erori RPC; doar blocarea explicită refuză) |
| Edge `ofertare-ingest-doc` | versiunea Supabase 22 (cod v12), **neinstrumentată** — cablarea edge + `_shared/egress.ts` au fost scoase din #543 (amânate) |
| Edge `egress-usage-api` (usage oficial din Management API) | **nu există** în `supabase/functions` pe main, nedeployată; secretul `SUPABASE_MGMT_TOKEN` nu e creat (opțiune, cere acordul lui Răzvan) |
| Celelalte edge-uri care descarcă din Storage (hr-*, ofertare-*-citeste, parse-contract-proiect etc.) + signed URLs din browser | neinstrumentate (listate în `MONITOR_EGRESS.md`) ⇒ jurnalul e **limită inferioară** a egress-ului real |

## 5. Widget-ul UI (owner)

Ce e live: `src/MonitorEgress.jsx` pe `main`, importat lazy în `src/App.jsx` (linia ~57) și randat pe home doar pentru `isSuperAdmin` (linia ~1095) ⇒ **deployat pe Vercel odată cu merge-ul #543** (01.10 18:16 UTC). Date din `egress_statistici(30)` (consum ciclu vs 250 GB cu marcaje 50/80 %, trafic pe zi, top 10 obiecte, obiecte blocate + buton Deblochează → `egress_deblocheaza`).

Ce rămâne (nimic blocant pentru funcționare):
1. **Verificare vizuală LIVE** de către Răzvan (Ctrl+Shift+R): widgetul apare pe home, arată 0 descărcări / ciclul curent (07.09→07.10) la 0 GB, fără erori în consolă (RPC `egress_statistici` răspunde pentru owner). Nu s-a putut face din container.
2. Când jurnalul primește primele rânduri (vezi §7): confirmare că bara, graficul pe zile și top-ul obiectelor se umplu corect, inclusiv un obiect blocat + deblocarea lui.
3. Opțional, decizie separată: sursa oficială de usage (`egress-usage-api` + `SUPABASE_MGMT_TOKEN`) — azi widgetul vede doar descărcările instrumentate.
4. Opțional UI: afișarea `notificari_esuate` din rezultatul detectorului (azi vizibil doar în `cron.job_run_details`).

## 6. Worker NAS — ce rămâne

1. Codul instrumentat e deja pe NAS (`cf4c438`), **nu e nevoie de repornire** pentru #543.
2. Verificarea efectivă (coada e oprită): o descărcare controlată pe UN document mic ⇒ un rând în `storage_descarcari_jurnal` cu `sursa='nas:ingest'`/`'nas:citire_mare'`, `doc_id`, `bytes` reale. Asta e condiția „#543 verificat” cerută pentru reluarea ingestului (runbook-ul #553 §5/§6).
3. După merge-ul #553 (garda), workerul se reactualizează (curl din main + `docker-compose up -d --build`); ordinea în cod rămâne **garda → poarta egress → descărcare** (rezolvat în merge-ul din 02.10 pe branch-ul #553).
4. Teste Deno pe NAS/PC (`deno test -A worker/ofertare/egress_test.ts`): nerulate în container (fără deno).

## 7. Pași următori (toți cu acordul lui Răzvan, nimic automat)

1. Răzvan: verificare vizuală a widgetului (§5.1).
2. Proba de jurnal pe un document mic (§6.2), coada rămânând oprită; opțional proba de blocare (> 20 descărcări/oră pe același obiect ⇒ `storage_obiecte_blocate` + notificare owner ⇒ deblocare din widget). Dacă nu se vrea pe live, dovada rămâne harness-ul `scripts/test_monitor_egress_fix.sh` (A–D, PG local).
3. Abia apoi: #553 (gardă) → reluarea cozii pe o licitație, cu widgetul urmărit în prima oră.
4. Decizii deschise: instrumentarea edge-ului `ofertare-ingest-doc` (PR separat), `egress-usage-api`, instrumentarea celorlalte edge-uri.
5. `registru_automatizari` (claude_docs): fișa de securitate din `MONITOR_EGRESS.md` trebuie copiată acolo de sesiunea principală — de verificat dacă s-a făcut după aplicarea din 01.10.
