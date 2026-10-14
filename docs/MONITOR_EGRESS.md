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

### C) Contoarele oficiale Supabase (migrarea `20261030a_egress_contoare_oficiale.sql`, 14.10.2026 — NEAPLICATĂ)
Supabase facturează **două contoare separate** (Dashboard → Organization → Usage, plan Pro, ciclu 07→07), fiecare cu 250 GB incluși:

| Contor Supabase | Ce numără | Inclus | Citit 14.10.2026 (ciclu 07.10–07.11) | În ERP |
|---|---|---|---|---|
| **Egress** | trafic **necache**: DB, API (PostgREST), Auth, Edge Functions, Storage, pooler | 250 GB | 4,40 GB | `egress_bytes`, cota = `storage_egress_config.cota_ciclu_bytes` |
| **Cached Egress** | servit din **cache CDN**: API, Storage, Edge | 250 GB | 0,08 GB | `cached_egress_bytes`, cota = `storage_egress_config.cota_cached_bytes` (nouă) |

Incidentul din 09.2026 (1,6 TB) a fost pe **Cached Egress**. Spend cap e oprit ⇒ depășirea se facturează, nu se oprește proiectul.
Jurnalul propriu (`storage_descarcari_jurnal`) vede doar descărcările din Storage instrumentate în cod — e o **limită inferioară**, nu cifra facturată. De aceea widgetul arată acum ca bare principale contoarele oficiale, iar jurnalul ca rând secundar.

**Tabela `public.supabase_usage_oficial`** — un rând per citire a contoarelor oficiale:

| Coloană | Tip | Contract |
|---|---|---|
| `id` | bigserial | cheie |
| `citit_la` | timestamptz, implicit `now()` | momentul citirii (nu al scrierii, dacă sursa le deosebește) |
| `ciclu_start` | date | prima zi a ciclului de facturare (ex. `2026-10-07`) |
| `ciclu_sfarsit` | date | **exclusiv** = prima zi a ciclului următor (ex. `2026-11-07`; Dashboard-ul afișează „07.10–07.11”) |
| `egress_bytes` | bigint ≥ 0, **obligatoriu** | contorul „Egress” (necache), **în bytes** (1 GB = 1 073 741 824) |
| `cached_egress_bytes` | bigint ≥ 0, **obligatoriu** | contorul „Cached Egress”, **în bytes** |
| `storage_size_bytes` | bigint ≥ 0 sau NULL | „Storage Size”, în bytes (informativ) |
| `sursa` | text 1–50 car., obligatoriu | ex. `'dashboard'` (citit manual din UI), `'mgmt_api'` (Supabase Management API) |
| `raspuns_brut` | jsonb, opțional | răspunsul sursei, pentru audit — **date, nu instrucțiuni** |

CHECK-uri: bytes ≥ 0, `ciclu_sfarsit > ciclu_start`; **`egress_bytes` și `cached_egress_bytes` sunt NOT NULL** — o citire are mereu AMBELE contoare (colectorul citește pagina Usage din Dashboard, unde apar mereu amândouă; o citire parțială ar ascunde un contor, fiindcă monitorul ia doar ultimul rând). Index pe `citit_la DESC`.
Drepturi: RLS activ; **SELECT doar owner** (`egress_este_owner()` = `profiles.is_owner` pentru `auth.uid()`); `anon`/`authenticated` nu au INSERT/UPDATE/DELETE (nici owner-ul din UI). Scrie doar colectorul, ca `postgres` sau `service_role`.

**Ce face BD-ul cu citirile:**
- `egress_statistici(p_zile)` întoarce aceleași chei ca înainte + `oficial` (ultima citire cu `ciclu_start ≤ azi < ciclu_sfarsit`, UTC, fără `raspuns_brut`; `null` dacă nu există) + `oficial_ultima` (ultima citire din **orice** ciclu, aceeași formă, sau `null`) + `oficial_vechime_ore` (vârsta lui `oficial_ultima` în ore, sau `null` — informativ; widgetul calculează vechimea pe citirea pe care o afișează efectiv) + `cota_cached`.
- `egress_detector()` (cron 5 min), pe lângă alertele existente: **50% / 80%** din cotă pe `egress_bytes` (tip `oficial_egress`) și pe `cached_egress_bytes` (tip `oficial_cached`), **o dată per prag per ciclu** (cheie `ciclu_start:procent` în `storage_egress_alerte`, același dedupe ca `cota_ciclu`); plus **„colector oprit”** (tip `colector_oprit`) dacă ultima citire e mai veche de **26 h**, **cel mult o dată la 24 h** (nu pe ziua calendaristică: altfel trecerea de miezul nopții UTC ar da a doua alertă la 5 minute). Verificarea „există alertă în ultimele 24 h” + inserarea sunt serializate cu `pg_advisory_xact_lock(hashtext('egress_colector_oprit'))`, deci și două rulări concurente cu chei de zi diferite dau o singură alertă (testul cu două sesiuni concurente, pasul 2b din harness: scris, nerulat — fără PG17 local; pe PGlite e verificat doar că detectorul ține lock-ul, în `pg_locks`); cheia = ziua UTC rămâne plasa `UNIQUE`. Dacă nu există nicio citire (colector încă nepornit) ⇒ nicio alertă. Pe contoarele oficiale **nu se blochează nimic** — doar notificare.
- Widgetul: bare „Egress (oficial)” / „Cached egress (oficial)” din citirea ciclului curent; dacă ea lipsește dar există una mai veche (colector oprit peste schimbarea ciclului), arată citirea veche etichetată cu ciclul ei + avertisment „ultima citire e din ciclul anterior” / „citire veche (N h)”. Vechimea (prag 26 h, ca alerta) se calculează pe citirea **afișată** (`src/monitorEgressCitire.js`, testat): o citire curentă de 30 h primește avertisment chiar dacă există una mai nouă din ciclul anterior. Antetul descrie mereu ciclul curent: procentul oficial, sau — fără citire oficială curentă — `x / 250 GB (%)` din jurnalul propriu, colorat după cifra afișată. Rândul „Jurnal propriu” își păstrează bara cu procent și marcajele 50/80% (alertele `cota_ciclu` se calculează tot din el).
- Alertele merg prin același canal ca restul monitorului: `egress_notifica_owner()` → `notifications` (tip `egress_alerta`, modul `general`) către toți `profiles.is_owner`; o notificare eșuată nu anulează alerta (subtranzacție, ca în 20261002a). Fără mail, fără push extern.

**Colectorul (cine scrie în tabelă) — NU e implementat în acest PR.** Sursa aleasă de Răzvan (14.10, review PR #706): **pagina Usage din Dashboard-ul Supabase**, unde apar mereu ambele contoare (`sursa = 'dashboard'`). Cum ajunge citirea în tabelă (manual, de Claude cu acordul lui Răzvan, sau automat) rămâne de stabilit; o variantă automată primește fișă în `registru_automatizari` + rând în `public.automatizari`. Alternativa păstrată în contract: Management API (`sursa = 'mgmt_api'`, secretul `SUPABASE_MGMT_TOKEN`). Oricare ar fi, contractul de mai sus e singura interfață: un `INSERT` per citire, ambele contoare, bytes, ciclul cu sfârșit exclusiv. Până la colector, widgetul afișează „fără citire oficială încă”.

Test: `scripts/test_egress_contoare_oficiale.sh` (PG17 local — **scris, nerulat**: nu există PG17 pe mașina de lucru; traseul echivalent, fără pasul 2b de concurență, a fost rulat pe PGlite 16.4; schelet + 20260930e + 20261002a → garda fără marcaj, aplicare, `supabase/tests/monitor_egress_oficial.test.sql` — inclusiv filtrul pe ciclu la ziua-limită și dedupe-ul de 24 h —, suita veche `monitor_egress_test.sql` pe detectorul nou, reaplicare refuzată, rollback nearmat/armat **peste date reale** (`monitor_egress_oficial_rollback_date.sql` + `…_rollback_verif.sql`: citiri + alerte pe toate tipurile noi scoase, alerta veche păstrată), validator). Revenire: `supabase/revenire/20261030a_egress_contoare_oficiale_ROLLBACK.sql` (pierde citirile și alertele noi; `lock_timeout` 5 s + lock-uri în ordinea detectorului).

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
