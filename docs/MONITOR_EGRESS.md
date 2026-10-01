# Monitor egress Storage (varianta C = A + B)

> **01.10.2026 (PR #543):** în PR intră doar migrarea + widgetul + workerul NAS. Edge-ul `egress-usage-api`, helperul `_shared/egress.ts` și cablarea în `ofertare-ingest-doc` au fost scoase din PR (AMÂNATE; CI „verifica” pica pe ingest-doc modificat fără deploy). Mențiunile de mai jos despre ele descriu varianta amânată.

Decizia lui Răzvan după incidentul din 24–25.09.2026 (`docs/INCIDENT_EGRESS_2026-09-25.md`, pe branch-ul `claude/erp-continuare-x4p5a7`): doc 770 (95 MB) descărcat de ~16.000 de ori de workerul NAS și de `ofertare-ingest-doc`, 1,6 TB cached egress, aflat din billing după 4 zile.

**Stare: PR draft. Nimic aplicat pe Supabase live, nimic deployat.**

## Ce face
### A) Alarmă + circuit breaker
- `storage_descarcari_jurnal` — un rând per descărcare (bucket, obiect, doc_id, bytes, sursă, created_at), indexat pe (bucket, obiect, created_at) și created_at. Purjare automată la 180 de zile.
- `egress_log_descarcare(...)` și `egress_obiect_blocat(...)` — RPC-uri **doar service_role**.
- `egress_detector()` — pg_cron `egress_detector_5min` (`*/5 * * * *`):
  - același obiect **> 20 descărcări/oră** → rând în `storage_obiecte_blocate` + notificare owner (o dată pe oră per obiect);
  - total zilnic (UTC) **> prag** (implicit 20 GB; normal ~0,6 GB/zi) → notificare, o dată pe zi;
  - cota ciclului (07→07) **≥ 50% / 80% din 250 GB** → notificare, o dată per prag per ciclu.
  - Pragurile stau în `storage_egress_config` (un rând); `blocare_activa = false` lasă doar alertele.
- Notificările merg în `notifications` către toți `profiles.is_owner` (tip `egress_alerta`, modul `general` — deja în CHECK, fără schimbare de schemă pe `notifications`), la fel ca `iot_alerta()`.
- **Circuit breaker**: înainte de descărcare, codul întreabă `egress_obiect_blocat`; dacă e blocat, NU descarcă și întoarce eroare explicită. Pe erori RPC (migrare neaplicată, rețea) e **fail-open** — monitorul nu oprește producția, doar un marcaj explicit o face.
- `egress_deblocheaza(bucket, obiect)` — doar `is_owner` (verificat în funcție, `42501` altfel). După deblocare, detectorul nu reblochează pe aceleași descărcări vechi timp de o oră.

### B) Widget ERP (doar owner)
- `src/MonitorEgress.jsx`, pe home (sub HomeScada), randat doar dacă `profile.is_owner`; datele vin din `egress_statistici(30)` (poarta owner e în BD, nu doar în UI).
- Arată: consumul ciclului vs 250 GB (bară cu marcaje 50/80%), trafic pe zi 30 de zile, top 10 obiecte, obiectele blocate cu buton **Deblochează** (confirmare).
- Sursa = **jurnalul propriu**. Acoperă doar descărcările instrumentate (mai jos), deci e o limită inferioară a egress-ului real.
- **Opțional, de activat cu acordul lui Răzvan:** `supabase/functions/egress-usage-api` citește usage-ul oficial din Supabase Management API. Nedeployată. Secret nou: **`SUPABASE_MGMT_TOKEN`** (Personal Access Token; opțional `MGMT_USAGE_PATH`). Endpoint-ul de usage nu e verificat pe contul nostru — se confirmă la activare. Nu e legată în widget până la activare.

## Ce e instrumentat
| Punct | Fișier | Sursa în jurnal |
|---|---|---|
| edge ingest (download PDF întreg) | `supabase/functions/ofertare-ingest-doc/index.ts` | `edge:ofertare-ingest-doc` |
| worker NAS, citire PDF obișnuit | `worker/ofertare/ingest.ts` (`citesteDocument`) | `nas:ingest` |
| worker NAS, Word ignorat → text | `worker/ofertare/ingest.ts` (`citesteWordLicitatie`) | `nas:ingest-word` |
| worker NAS, PDF mare pe disc (URL semnat) | `worker/ofertare/citire_mare.ts` | `nas:citire_mare` |

Helper: `supabase/functions/_shared/egress.ts` (edge) și copia `worker/ofertare/egress.ts` (workerul NAS rulează separat). `descarcaCuJurnal()` are aceeași formă `{ data, error }` ca `storage.download()`, deci logica nu se schimbă.

**Neinstrumentate încă** (download din Storage, volum mai mic / la cerere): hr-autorizatie-citeste, hr-autorizatii-scan, hr-extrage-ci, hr-recomandare-citeste, ofertare-citire-test, ofertare-clarificare-citeste, ofertare-document-nou-citeste, ofertare-e0-autofill, ofertare-garantie-mail, ofertare-inventar-ai, ofertare-plansa-citeste, ofertare-rfq-import, ofertare-triere, ofertare-word-text, parse-contract-proiect; plus descărcările din browser (signed URLs) și `plansa_cli_*` de pe PC. Se adaugă cu același helper, câte un rând per funcție.

## ⛔ Freeze Ofertare (până după depunerea Jilava, 02.10)
Modificările în `ofertare-ingest-doc`, `worker/ofertare/ingest.ts`, `worker/ofertare/citire_mare.ts` sunt **pregătite, nu aplicate**: **aplicare după freeze, cere excepție**. Ordinea recomandată la activare:
1. migrarea `20260930e_monitor_egress.sql` (apply_migration, cu acordul lui Răzvan) — independentă de freeze, nu atinge Ofertare; widget-ul merge imediat (gol);
2. după 02.10: merge + redeploy `ofertare-ingest-doc` + repornire worker NAS (instrumentarea e fail-open, deci ordinea 1↔2 nu strică nimic);
3. opțional: `egress-usage-api` + secretul `SUPABASE_MGMT_TOKEN`.

Rollback: `20260930e_monitor_egress_ROLLBACK.sql` (șterge și jurnalul).

## Teste
- SQL pe PG 16 local (stub auth/profiles/notifications): `supabase/tests/monitor_egress_stub.sql` + migrarea + `supabase/tests/monitor_egress_test.sql` — T1 sub prag → nimic; T2 25 descărcări → notificare owner (nu non-owner) + blocare; T3 poarta vede blocarea; T4 fără dublură la rerulare; T5 authenticated non-owner și anon refuzați (RLS, RPC-uri, insert direct, detector); T6 owner vede statistici și deblochează; T7 deblocarea e respectată; T8 prag zilnic + cotă 50%; T9 ciclul 07→07. Rollback testat.
- `deno test -A worker/ofertare/egress_test.ts` (blocat → fără download; liber → jurnal cu mărimea reală; RPC lipsă → fail-open) + testele existente `ingest_mare_test.ts`, `citire_mare_test.ts`.

## Fișa de securitate (pentru `registru_automatizari` — de copiat de Răzvan/sesiunea principală, NU scrisă în claude_docs)
**Automatizare:** pg_cron `egress_detector_5min` → `egress_detector()`; pg_cron `egress_jurnal_purge` (03:17 zilnic); RPC-uri `egress_log_descarcare` / `egress_obiect_blocat` apelate de `ofertare-ingest-doc` și workerul NAS; edge `egress-usage-api` (opțională, inactivă). Secret nou (doar la activarea opțiunii): `SUPABASE_MGMT_TOKEN`, în Edge Functions Secrets, folosit doar de `egress-usage-api`.
- **(a) Conținut extern citit:** niciunul. Detectorul citește doar jurnalul propriu (căi de obiect + mărimi scrise de cod intern). Căile de obiecte pot conține nume de fișiere venite din SEAP — tratate ca text, puse doar în mesajul notificării. `egress-usage-api` citește JSON de la api.supabase.com (date de uzaj, nu instrucțiuni).
- **(b) Ce scrie / face:** `storage_descarcari_jurnal`, `storage_obiecte_blocate`, `storage_egress_alerte`, `notifications` (doar către owner). Nu trimite mail, nu atinge bani, nu schimbă drepturi. Efect operațional: blocarea unui obiect oprește descărcările automate ale acelui fișier (sigur: refuză, nu șterge).
- **(c) Identitate:** detectorul rulează ca `postgres` din pg_cron; RPC-urile de jurnal/poartă doar `service_role` (edge și worker NAS au deja cheia; scrierea în jurnal trebuie să ocolească RLS fiindcă tabelele sunt read-only pentru utilizatori). `egress-usage-api` folosește `service_role` doar pentru a citi `profiles.is_owner` al apelantului.
- **(d) Cine o pornește:** cron-ul; RPC-urile de scriere nu sunt executabile de `anon`/`authenticated` (REVOKE + GRANT doar service_role). `egress_deblocheaza` și `egress_statistici` verifică `is_owner` în funcție. `egress-usage-api`: `auth.getUser(jwt)` + `profiles.is_owner` în cod (cheia anon singură e respinsă — lecția PR #318).
- **(e) Confirmări umane:** deblocarea unui obiect = acțiune manuală a owner-ului, cu confirmare în UI. Activarea `egress-usage-api` și crearea secretului = acordul lui Răzvan. Blocarea automată e sigură (fail-closed doar pe obiectul respectiv; restul fail-open).
- **Regula tare (a)+(b):** nu se ating — nu citește conținut extern scris de alții ca să decidă acțiuni; scrie doar în tabelele proprii și notificări owner.
