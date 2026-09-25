# R6 — Traseu de integritate documente licitație (25.09.2026)

Traseu: SEAP → arhivă originală → fișier extras → Storage → derivat (felii, text) → rezultat (analiză / source pack).
Doar SELECT-uri; nimic modificat.

## 1. Ce există azi
- `ofertare_documente_atribuire` (information_schema): id, licitatie_id, fisier_path, nume_original, size_bytes, text_extras, pagini, pagini_procesate, status_procesare, eroare, sursa, analiza (jsonb), seap_cod, seap_meta (jsonb), procesat_de, relevanta_*… **Nu există coloană de hash.**
- `seap_meta`: cheile folosite în toată tabela sunt doar `inlocuieste`, `publicat`, `titlu`. Niciun document nu are `sha256` în `analiza` sau în `seap_meta` (0 la 90/101/102).
- `seap_cod`: completat doar la 2 docuri (lic 90); 0 la 101 și 102.
- Worker `worker/ofertare/seap.ts:219` calculează sha256; `:328` pe fișierele locale; `:363-381` construiește manifestul (licitatie_id, arhiva_cheie, cale, marime, sha256, document_id, stare) și face upsert în `ofertare_seap_manifest`.
- **`ofertare_seap_manifest` există, dar e GOALĂ** (SELECT group by → null). Deci Huedin/Botoșani/Ibănești au fost importate pe alt drum (fără manifest) sau înainte de el.
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
- **770** `Studiu geotehnic__Transgaz+Anexe.pdf`, 99.9 MB, `in_lucru`, pagini_procesate=0, pagini=null, fără eroare. **Corectură revizor:** `procesat_la`=2026-09-25 15:12:35 UTC, la ~8 s înainte de `now()` (15:12:43) la verificare → e probabil în procesare ACUM, nu „blocat”; „blocat” = neverificat, de reverificat peste câteva ore.
- Toate trei: seap_cod null, seap_meta null → nu se poate dovedi că fișierul din Storage = cel din SEAP.

Botoșani: 2 `partial` (cu eroare), 3 `neprocesat`, 18 `ignorat`. Ibănești: 6 `ignorat` cu eroare, 4 neprocesate, 0 cu text → practic nerecuperată.

## 3. Propunere
Hash la:
1. **Import** (arhivă SEAP): sha256 al arhivei + al fiecărui fișier extras — deja în `seap.ts`; trebuie ca și drumul actual de import (cel folosit la 90/101/102) să scrie în `ofertare_seap_manifest` cu `document_id`.
2. **Urcare în Storage**: sha256 al byte-ilor urcați = cel din manifest (verificare egalitate).
3. **Derivare**: la felii (`api/plansa-felii.js`) și la extragere text — se scrie `sursa_sha256` (hash-ul fișierului citit) + sha256 al textului/feliei.
4. **Rezultat**: pack-ul deja are sha256 per document (`verifica_pack.mjs`) → comparat cu manifestul.

Stocare:
- **Fără schimbare de schemă (se poate acum, doar cod):** `analiza.integritate = {sha256, size, sursa_sha256, calculat_la, validator}` și `seap_meta.sha256`; plus popularea tabelei existente `ofertare_seap_manifest`.
- **Cu schimbare de schemă (cere GO):** coloane `sha256 text`, `sha256_la timestamptz` pe `ofertare_documente_atribuire` + index; eventual tabel `ofertare_derivate(document_id, tip, sha256, sursa_sha256)`.

Verificare periodică: job (worker/cron) care re-descarcă din Storage, recalculează sha256, compară cu manifest/analiza; divergențe → flag + alertă. E automatizare nouă → registru_automatizari + fișa de securitate (citește doar fișiere proprii, scrie doar flag; fără service_role unde nu e nevoie).

## 4. Pași concreți
1. (cod, fără GO BD) Drumul actual de import scrie manifest + `seap_meta.sha256`.
2. (cod) Felii/text scriu `analiza.integritate`.
3. (**GO — date**) Backfill: calculează sha256 pentru cele 763 docuri existente din 90/101/102 din Storage (fără re-analiză AI, deci fără cost).
4. (**GO — date, doar dacă rămâne în in_lucru după procesarea curentă**) Deblocare 770: resetare `in_lucru` → `neprocesat`/`ignorat` sau felii pe pagini.
5. (**GO — schemă**) Coloane dedicate + index.
6. (**GO — automatizare**) Cron de verificare periodică.
7. (**GO — plătit**) Re-procesare AI pentru 745/750/770 și Ibănești.
