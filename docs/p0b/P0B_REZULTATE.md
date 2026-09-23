# P0B_REZULTATE — Worker + CLI (23.09.2026, seara)

**Confirmare explicită: `0 rows imported into ofertare_cerinte`.** Fluxul testat s-a oprit la preview RPC, exact cum a cerut Copilot.
`ofertare_cerinte` = 4283 rânduri (baseline P0a), 0 cu `sursa_pack_id`; `ofertare_source_pack_importuri` = 0 rânduri.

## 1. PR / commit

- PR draft [#411](https://github.com/gazpet-test/pontaj-pro/pull/411), branch `claude/p0b-worker-cli` (din `main` 131cd42 = P0a merged).
- Commit-uri: `72c13bc` (cod P0b), `61a581a` (test validator), + commit-ul acestui raport.
- Edge function `ofertare-cerinte` republicată ca **v19** (verify_jwt on) cu `core.ts` din branch — altfel CI-ul `verifica` (repo ↔ funcții publicate) rămânea roșu.
- Pe Terra: workerul `gazpet-ofertare-worker` rulează commit `72c13bc` de pe `claude/p0b-worker-cli` (`.env REPO_BRANCH`), cu `out/` al CLI-ului montat ca `/packs`; containerul `gazpet-claude-cli` reconstruit cu launcher/validator/run_pilot noi. După merge: `REPO_BRANCH=main` înapoi în `.env`.

## 2. Fișiere schimbate

| Fișier | Ce s-a schimbat |
|---|---|
| `worker/claude-cli/verifica_pack.mjs` | validator **v2**: `locator.verificat` per cerință (`pagina`/`document`); la corecție `locator.pagina_declarata` (ce a afirmat modelul) + `locator.pagina_validata` (unde s-a găsit) și `locator.pagina` = validată; `⟦PAGINA n⟧` și `⟦PAGINA a-b⟧` (segmente cu interval, `pagina_interval` când e cazul); identitatea (`licitatie.licitatie_id`, `nr_anunt`) din argumente (launcher), nu din model — ce a scris modelul rămâne `nr_anunt_model`; `documente[].sha256` + `size_bytes` din `/data`; `pack.rulare` (model, effort, ture, cost estimat, tokeni, durată, CLI); `validare.validator = "verifica_pack.mjs/2"`. Câmpurile vechi top-level `verificat`/`pagina_declarata` sunt eliminate. |
| `worker/claude-cli/launcher.sh` | la `source_pack`: `LIC_ID`/`LIC_NR_ANUNT` obligatorii (jurnal + problemă de schemă fără ele), construiește `rulare` din JSON-ul CLI, apelează validatorul cu `--licitatie-id --nr-anunt --data-dir /data --rulare`, jurnalizează `PACK=… sha256=… size=…`. |
| `worker/claude-cli/run_pilot.sh` | `sh run_pilot.sh "<folder>" source_pack <licitatie_id> <nr_anunt>`; abort dacă lipsesc la `source_pack`. |
| `worker/claude-cli/docker-compose.yml` | `LIC_ID`, `LIC_NR_ANUNT` în environment. |
| `worker/ofertare/source_pack.ts` (nou) | `/packs/*.pack.json` → `ofertare_source_pack` și ATÂT; verificări fără AI (schema, liste, `licitatie_id` întreg, `validare` prezentă cu `probleme_schema=[]`, ref-uri unice, `locator.verificat` per cerință); identitate: `licitatie_id` există în ERP și `nr_anunt` coincide; **idempotent pe `pack_hash`** (sha256 al fișierului): dacă există → sidecar `.importat {duplicat:true}`, zero rânduri; **invalid → `stare='respins'` + motiv în `nota`** (rând în BD când licitația e cunoscută, altfel doar sidecar `.respins`); fișier scris în ultimele 30 s e lăsat pe ciclul următor. |
| `worker/ofertare/main.ts` | apelează `proceseazaSourcePacks` în bucla principală. |
| `worker/ofertare/docker-compose.yml`, `entrypoint.sh` | montare `${PACKS_DIR_HOST:-/Volume1/docker/gazpet-claude-cli/out}:/packs`; `--allow-read/--allow-write` + `/packs`. |
| `supabase/functions/ofertare-cerinte/core.ts` | reset: `.is('sursa_pack_id', null)` — cerințele din pack nu se șterg de extractorul vechi. |
| `test-fixtures/source_pack/verifica_pack_test.sh` (nou) | test repetabil fără AI (10 verificări). |

## 3. Rezultate validator (test sintetic, `verifica_pack_test.sh`)

10/10 ✔: identitate din argumente (model spunea `ALT-NR` → `nr_anunt_model`); REQ-001 `pagina`; REQ-002 pagina declarată 9 → validată 2, `pagina_declarata=9` păstrată; REQ-003 pagina 4 găsită în `⟦PAGINA 3-5⟧`; REQ-004 corectat în interval `[3,5]`; REQ-005 excerpt inexistent → `nereusite`; fără câmpuri top-level vechi; sha256/size_bytes pe `/data` + fișier lipsă marcat; `rulare` + `validare` prezente; fără `LIC_ID` → exit 3 (problemă de schemă, workerul respinge).

## 4. Rezultate Mânăstirea (rulare reală, lic 3, DF1278266)

`sh run_pilot.sh "<folder NAS>" source_pack 3 DF1278266` — 18:18:31 → 18:25:03 UTC.

| | Valoare |
|---|---|
| CLI / model / effort | Claude Code 2.1.280 / sonnet / medium, max 40 ture, timeout 20 min |
| inventar | 33 fișiere în `/data`, 30 texte extrase, 0 pagini OCR |
| ture / cost estimat / durată | 33 / 1,505 USD (estimare client, abonament) / 391 s |
| tokeni | in 54, out 32.226, cache_read 2.473.505, cache_create 172.092 |
| **VALIDARE** | `licitatie_id=3 nr_anunt=DF1278266 cerinte=42 (pagina=31 document=11) respinse=1 nereusite=26 solicitari=0 erate=1 sha256=33/33 probleme=niciuna` |
| pack final | `out/2026-09-23_1818_source_pack.pack.json`, **sha256 `131b068b8bd4c93be314c8c9cf7a935b6f7d61db6e4a6d55f5b19267e92f2dde`**, 51.624 B |
| cerințe pe tip | eliminatorie 13, propunere 11, contractuala 10, forma 8 |
| cand_se_prezinta (vocabular pack) | la_depunere 24, in_executie 11, DUAE 4, la_solicitare 3 |
| cerințe pe fișier | fișa de date 21, caiet de sarcini 7, acord contractual 5, formulare 3, condiții specifice 2, anexa factori 2, factori evaluare 2 |
| nereușite (26) | depasit buget 19, fara text (scanat) 4 (hotărâre scan + 3 planșe), format nesuportat 2 (dwg, xml DUAE), 1 = REQ-029 respinsă de validator (excerpt „Sudori pentru PE și/sau OL…” negăsit literal) |
| documente cu sha256 | 33/33, 339.664.395 B în total |

## 5. Reset regression test (obiectivele 8 + 9)

Tranzacție anulată pe producție: pack sintetic (2 cerințe) importat prin `fn_ofertare_source_pack_import` ca owner + 1 rând legacy (`extras_de_ai`, neconfirmat, fără pack).

| | Filtrul vechi (`extras_de_ai ∧ confirmata_de IS NULL`) | Filtrul nou (+ `sursa_pack_id IS NULL`) |
|---|---|---|
| ar șterge / a șters | 3 rânduri, **din care 2 din pack** | 1 rând (doar legacy) |
| cerințe din pack neconfirmate după reset | 0 | **2/2 supraviețuiesc** |

Rezultat brut: `{"reset_vechi_ar_sterge":3,"reset_vechi_ar_sterge_din_pack":2,"reset_nou_sters":1,"pack_supravietuiesc":2,"pack_supravietuiesc_toate":true}`. Nimic persistat (efect lateral: secvența `ofertare_source_pack_id_seq` a consumat id 1, de aceea pack-ul real e id 2).

## 6. Worker idempotency (obiectivele 5, 6, 7)

| Caz | Rezultat (docker logs) |
|---|---|
| pack-ul vechi B1 (`2026-09-23_1512`, validator v1, fără LIC_ID) | `RESPINS fără rând în BD (licitatie.licitatie_id lipsă (launcher fără LIC_ID); REQ-001: locator.verificat lipsă (validator vechi?))` + sidecar `.respins` |
| pack-ul nou (`2026-09-23_1818`) | `primit → ofertare_source_pack id 2 (lic 3, 42 cerințe, 26 nereușite, sha256 131b068b8bd4…, 51624 B)` + sidecar `.importat {id:2}` |
| **același conținut sub alt nume** (`cp` → `…_copie_idempotenta_…`) | `pack_hash deja în BD (id 2, primit) — nu creez duplicat` + sidecar `.importat {id:2, duplicat:true}`; `ofertare_source_pack` rămâne la 1 rând |

Workerul a scris DOAR în `ofertare_source_pack` (1 rând). `importuri` = 0, `ofertare_cerinte` neatins.

## 7. Row-ul Source Pack creat

`ofertare_source_pack` id **2**: `licitatie_id 3`, `stamp 2026-09-23_1818`, `fisier 2026-09-23_1818_source_pack.pack.json`, `pack_hash 131b068b…`, `sursa cli`, `model sonnet`, `cost_usd 1.505437`, `ture 33`, `durata_s 391`, `nr_cerinte 42`, `nr_nereusite 26`, `nr_erate 1`, `stare primit`, `ultim_import_la NULL`, `nota NULL`, `creat_la 2026-09-23 18:25:42 UTC`; `pack.licitatie = {licitatie_id:3, nr_anunt:"DF1278266"}`; `validare.validator = verifica_pack.mjs/2`; `pack.rulare` complet.

## 8. Preview RPC (`fn_ofertare_source_pack_preview(2)`, ca owner, SECURITY INVOKER prin RLS)

| | Valoare |
|---|---|
| rânduri | 42 |
| mapare la documente ERP | 42/42 `nume_exact`, 0 nemapate → 42 importabile |
| `locator_verificat` | pagina 31, document 11 (1 cu `pagina_declarata` ≠ pagina validată) |
| deja importate | 0 |
| „seamănă cu” (pg_trgm ≥ 0,45) | 29/42 au corespondent în registrul vechi, similaritate medie 0,598 |
| stare pack după preview | `primit` (preview-ul nu scrie) |
| view nereușite | 26 rânduri, 22 mapate la documente |
| primele 3 | REQ-001/002/003 = motive de excludere art. 167, fișa de date (doc 63) p. 7–9, `duae`, seamănă cu cerințele 3421/3425/3432 |

## 9. Abaterea față de B1 vechi (aceeași licitație, 23.09 15:12, validator v1)

| | B1 (15:12) | P0b (18:18) |
|---|---|---|
| ture / cost / durată | 30 / 1,586 USD / 506 s | 33 / 1,505 USD / 391 s |
| cerințe validate | 51 (33 pagina + 18 document) | 42 (31 pagina + 11 document) |
| respinse de validator | 1 (REQ-040) | 1 (REQ-029, sudori PE/OL) |
| nereușite | 27 | 26 |
| verdict per cerință în locator | NU (top-level, neimportabil) | DA |
| identitate în pack | absentă | licitatie_id 3 + nr_anunt din launcher |
| sha256 documente | absent | 33/33 |

Valorile 33/18 din B1 NU au fost retrofitate: validatorul v2 a produs 31/11 pe o rulare nouă. Diferența (51 → 42) vine din modelul nedeterminist (Sonnet, aceleași documente, altă distribuție a bugetului de ture: de data asta 33 de ture, mai multe pe fișa de date — 21 cerințe, față de 26 în B1 — și mai puține pe caietul de sarcini), NU din validator: ambele rulări au aceeași regulă de căutare literală a excerptului, iar raportul pagina/document (31:11 față de 33:18) reflectă doar unde a citat modelul. Ce e stabil între rulări: fișierele citite, documentele nereușite (buget, scanate, dwg/xml), maparea 100% pe nume exact, ~1 excerpt respins. Concluzia B1 rămâne: pack-ul e consolidat (o cerință pack ≈ mai multe rânduri din registrul vechi de 927), valoarea lui e proveniența verificată, nu acoperirea.

## 10. Ce NU s-a făcut (limitele P0b)

- **0 rows imported into ofertare_cerinte** — niciun apel la `fn_ofertare_source_pack_import` pe pack-ul real.
- P0c (UI preview/„Importă”, `respinge = DELETE` → marcare) neînceput. P1 neînceput.
- Rămas de făcut la merge: `REPO_BRANCH=main` în `.env`-ul workerului de pe Terra; fișierul de copie `…_copie_idempotenta_…` și sidecar-urile din `out/` pot fi șterse (sunt doar dovezi de test).

STOP. Aștept verificarea înainte de P0c.
