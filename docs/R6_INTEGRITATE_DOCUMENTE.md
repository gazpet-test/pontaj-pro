# R6 — Traseu de integritate documente licitație (25.09.2026)

Traseu: SEAP → arhivă originală → fișier extras → Storage → derivat (felii, text) → rezultat (analiză / source pack).
Doar SELECT-uri; nimic modificat.

## 1. Ce există azi
- `ofertare_documente_atribuire` (information_schema): id, licitatie_id, fisier_path, nume_original, size_bytes, text_extras, pagini, pagini_procesate, status_procesare, eroare, sursa, analiza (jsonb), seap_cod, seap_meta (jsonb), procesat_de, relevanta_*… **Nu există coloană de hash.**
- `seap_meta`: cheile folosite în toată tabela sunt doar `inlocuieste`, `publicat`, `titlu`. Niciun document nu are `sha256` în `analiza` sau în `seap_meta` (0 la 90/101/102).
- `seap_cod`: completat doar la 2 docuri (lic 90); 0 la 101 și 102.
- Worker `worker/ofertare/seap.ts:219` calculează sha256; `:328` pe fișierele locale; `:363-381` construiește manifestul (licitatie_id, arhiva_cheie, cale, marime, sha256, document_id, stare) și face upsert în `ofertare_seap_manifest`.
- **`ofertare_seap_manifest` există, dar e GOALĂ** (count=0 la 25.09 15:24). Manifestul gol NU demonstrează singur un alt drum de import — vezi „Apelant efectiv” în Verdict Copilot.
- `worker/ofertare/source_pack.ts:14,57`: sha256 pe fișierul pack (pack_hash); `ofertare_source_pack` are 1 rând.
- `worker/claude-cli/verifica_pack.mjs:114-127`: sha256 + size_bytes per document din /data, scrise în pack (nu în BD documente).
- `api/plansa-felii.js:252`: „manifest” de felii, fără hash pe felie/pe sursă.
- NAS/Terra: în repo doar `scripts/nas_corespondenta_docker-compose.yml`; niciun manifest de hash pe NAS găsit.

## 2. Cazuri
| Licitație | Total | procesat | partial | ignorat | in_lucru/neprocesat | cu seap_cod | cu sha256 |
|---|---|---|---|---|---|---|---|
| 101 Huedin | 247 | 221 | 13 | 12 | 1 in_lucru | 0 | 0 |
| 102 Botoșani | 506 | 483 | 2 | 18 | 3 neprocesat | 0 | 0 |
| 90 Ibănești | 10 | 0 | 0 | 6 | 4 neprocesat | 2 | 0 |

Huedin:
- **745** `…2.3 Prot. catodica/3) 10035-PC-02.pdf`, 25.7 MB, `ignorat`: „planșă ~26 MB prea mare pentru citirea AI… Marcat 24.09 la cererea lui Răzvan”.
- **750** `…/8) 10035-PC-06.pdf`, 26.8 MB, `ignorat`, același motiv.
- **770** `Studiu geotehnic__Transgaz+Anexe.pdf`, 99.9 MB, `in_lucru`, pagini_procesate=0, pagini=null, fără eroare. **Reverificat 25.09 15:24:23 UTC:** `status=in_lucru`, `procesat_la`=15:24:18 (5 s înainte, era 15:12:35 la 15:12) — lease-ul se reîmprospătează, dar `pagini_procesate`=0 și `pagini`=null în continuare → worker-ul e viu, progres zero. Nu e „blocat” dovedit, dar nici nu avansează.
- Toate trei: seap_cod null, seap_meta null → nu se poate dovedi că fișierul din Storage = cel din SEAP.

Botoșani: 2 `partial` (cu eroare), 3 `neprocesat`, 18 `ignorat`. Ibănești: 6 `ignorat` cu eroare, 4 neprocesate, 0 cu text → practic nerecuperată.

## 3. Propunere
Hash la:
1. **Import** (arhivă SEAP): sha256 al arhivei + al fiecărui fișier extras — deja în `seap.ts`; manifestul existent (`ofertare_seap_manifest`) rămâne evidența principală, fără evidență paralelă.
2. **Urcare în Storage**: sha256 al byte-ilor urcați = cel din manifest (verificare egalitate).
3. **Derivare**: la felii (`api/plansa-felii.js`) și la extragere text — se scrie `sursa_sha256` (hash-ul fișierului citit) + sha256 al textului/feliei.
4. **Rezultat**: pack-ul deja are sha256 per document (`verifica_pack.mjs`) → comparat cu manifestul.

Stocare:
- **Fără schimbare de schemă (doar cod):** evidența principală = `ofertare_seap_manifest`. `analiza.integritate = {sha256, size, sursa_sha256, calculat_la, validator}` doar ca subarbore, scris atomic cu `jsonb_set` (nu rescrie `analiza`). Fără `seap_meta.sha256` paralel.
- **Cu schimbare de schemă (cere GO):** coloane `sha256 text`, `sha256_la timestamptz` pe `ofertare_documente_atribuire` + index; eventual tabel `ofertare_derivate(document_id, tip, sha256, sursa_sha256)`.

Verificare periodică: job (worker/cron) care re-descarcă din Storage, recalculează sha256, compară cu manifest/analiza; divergențe → flag + alertă. E automatizare nouă → registru_automatizari + fișa de securitate (citește doar fișiere proprii, scrie doar flag; fără service_role unde nu e nevoie).

## 4. Pași concreți
1. (cod, fără GO BD) Drumul actual de import scrie manifest + `seap_meta.sha256`.
2. (cod) Felii/text scriu `analiza.integritate`.
3. (**GO — date**) Backfill = „conținut observat acum în Storage”, NU certificare retroactivă că fișierul = cel din SEAP. Preview (count) → loturi → streaming (fără încărcare integrală în memorie) → reluare de unde a rămas → GO. `sursa_sha256` NU se completează retroactiv.
4. (**GO — date, doar dacă rămâne în in_lucru după procesarea curentă**) Deblocare 770: resetare `in_lucru` → `neprocesat`/`ignorat` sau felii pe pagini.
5. (**GO — schemă**) Coloane dedicate + index.
6. (**GO — automatizare**) Cron de verificare periodică.
7. (**GO — plătit**) Re-procesare AI pentru 745/750/770 și Ibănești.

## Verdict Copilot 25.09
**Apelant efectiv (grep repo + SELECT, 25.09):**
- Singurul scriitor în `ofertare_seap_manifest` din repo: `worker/ofertare/seap.ts:380` (upsert pe `licitatie_id,arhiva_cheie,cale`), introdus de PR #434 (commit 26d3a8f, 24.09). Migrarea manifestului e aplicată la `20260924150650` (24.09 15:06 UTC).
- Edge `supabase/functions/ofertare-seap-import/index.ts` scrie în `ofertare_documente_atribuire` (l.373-374) și Storage, dar **nu scrie manifest**.
- Ambele drumuri pun `sursa='seap'` → din BD nu se poate distinge apelantul.
- Datare: 101 creat 24.09 07:21–12:54, 102 majoritatea 07:21–12:11 → **înainte** de migrarea manifestului (explică golul fără alt drum). Dar 102 are rânduri create până la **25.09 05:24** (după migrare) și manifestul tot e 0 → acele rânduri au venit fie prin edge (fără manifest), fie prin worker cu upsert eșuat (eroarea ajunge doar în `eroriInterne`). Neverificat care — de citit logurile worker/edge. Lic 90: creat 16–23.09, înainte de manifest.
- **770 (SELECT 25.09 15:24):** `in_lucru`, `procesat_la` 15:24:18 (lease reîmprospătat), `pagini_procesate`=0, `pagini`=null, fără eroare.

**Reguli:**
- Manifestul existent = evidența principală; fără evidență paralelă (`seap_meta.sha256` scos).
- `analiza.integritate` doar subarbore, update atomic `jsonb_set`.
- Backfill = „conținut observat acum”, nu certificare retroactivă; `sursa_sha256` nu se completează retroactiv.
- 770 se judecă prin progres + lease, nu prin status.

**Ordinea pașilor:** (1) manifest pe fluxul curent (și în edge `ofertare-seap-import`, sau edge-ul trece prin worker); (2) backfill cu preview/loturi/streaming/reluare + GO; (3) cron de verificare = aprobare separată.

### Decizii umane
1. Care drum de import rămâne oficial (edge vs worker) → acolo se pune manifestul.
2. GO backfill (după preview).
3. GO separat pentru cron.
4. 770: aștepți progres sau oprești (reset / felii pe pagini).
