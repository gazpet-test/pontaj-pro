# P0B_CLOSEOUT — 23.09.2026, ~21:45 RO

P0b este închis. P0c NU a început.

## 1. Patch final: precizia locatorului pe marcaje interval (`⟦PAGINA a-b⟧`)

Regula (Copilot): o pagină exactă se afirmă NUMAI când excerptul stă într-un segment de o singură pagină. Un interval dovedește doar intervalul.

| Caz | `verificat` | `pagina` | `pagina_declarata` | `pagina_validata` | `pagina_interval` |
|---|---|---|---|---|---|
| `⟦PAGINA 4⟧` + excerpt literal, model a declarat 4 | `pagina` | 4 | — | 4 | — |
| `⟦PAGINA 7⟧` + excerpt literal, model a declarat 9 | `document` | 7 | 9 | 7 | — |
| `⟦PAGINA 3-5⟧` + excerpt literal, model a declarat 4 | `document` | **null** | 4 | — | [3,5] |
| `⟦PAGINA 3-5⟧` + excerpt literal, model a declarat 1 | `document` | **null** | 1 | — | [3,5] |

Output JSON exact din testul actual (`test-fixtures/source_pack/verifica_pack_test.sh`, 10/10 ✔, commit `0baa721`):

```json
{"ref":"REQ-003","locator":{"nume_fisier":"doc/fisa.pdf","seap_cod":null,"pagina":null,"sectiune":"III.1.1.b",
  "excerpt":"forma de inregistrare legala in conditiile legii","verificat":"document","pagina_declarata":4,"pagina_interval":[3,5]}}
{"ref":"REQ-004","locator":{"nume_fisier":"doc/fisa.pdf","seap_cod":null,"pagina":null,"sectiune":null,
  "excerpt":"Ofertantul trebuie sa dovedeasca o forma de inregistrare","verificat":"document","pagina_declarata":1,"pagina_interval":[3,5]}}
```

Reprezentarea aleasă e cea preferată de Copilot (`pagina_declarata` = valoarea modelului, `pagina_interval`, `verificat = document`), plus `pagina = null` ca pagina exactă să nu ajungă nicăieri ca fapt.

**Compatibilitate cu schema P0a (`fn_ofertare_source_pack_import`)**: `sursa_pagina = COALESCE(pagina_validata, pagina)` → **NULL**; `pagina_declarata` → 4 / 1; `locator_verificat` → `document`; `pasaj_verificat` → true. Deci nimic fals nu intră în `ofertare_cerinte`, dar **intervalul se pierde** (nu există coloană).

**Extensie minimă necesară înainte de P0c** (nu e aplicată, cere GO):
```sql
ALTER TABLE public.ofertare_cerinte ADD COLUMN pagina_interval int4range;   -- NULL pe rândurile vechi
-- fn_ofertare_source_pack_import: + pagina_interval = int4range((locator.pagina_interval[0])::int, (locator.pagina_interval[1])::int, '[]')
-- fn_ofertare_source_pack_preview: + coloana pagina_interval
-- trigger fn_ofertare_cerinte_pack_protejeaza: pagina_interval intră între câmpurile de proveniență blocate
```
Fără ea, UI-ul P0c ar afișa „pagina: —” pentru cerințele din intervale, deși știm că sunt în paginile 3–5. Pe pack-ul real Mânăstirea (id 2) nu apare cazul: pdftotext produce doar marcaje simple; intervalele apar la textele din ingest-ul Deno (bucăți `⟦PAGINA a-b⟧`).

## 2. Închidere operațională

| Pas | Rezultat |
|---|---|
| merge PR #411 | ✔ `84618fc` pe `main` (CI `verifica` verde pe `0baa721`) |
| `REPO_BRANCH=main` pe Terra | ✔ `.env` → `REPO_BRANCH=main`; compose + entrypoint din main |
| restart worker | ✔ `docker-compose up -d --force-recreate` |
| commit efectiv al workerului | ✔ `[entrypoint] pornesc workerul la commit 84618fc (main)` · heartbeat `pornit · commit 84618fc (main)` |
| edge function `ofertare-cerinte` = sursa din main | ✔ publicată v19 la 18:22:54 UTC; ultimul commit pe `core.ts` în main = `72c13bc` 18:15:19 UTC (înainte de deploy); CI run #81 (merge-preview pe main) verde |
| CLI Terra | ✔ launcher/validator (cu `pagina_interval`)/run_pilot/compose din main, imagine reconstruită |
| curățenie | ✔ șterse DOAR `…_1818_copie_idempotenta_….pack.json` + sidecar-ul ei. Rămân: pack-ul real `2026-09-23_1818_source_pack.pack.json` + `.importat` (id 2) și pack-ul vechi B1 `…_1512…` + `.respins` (împiedică reprocesarea) |
| fixture P0b | ✔ `ofertare_source_pack` id 2 (hash `131b068b…`, stare `primit`) păstrat; 0 rânduri în `ofertare_cerinte` cu `sursa_pack_id`; 0 importuri |

## 3. Notă obligatorie pentru P0c

```
PACK_IMPORTED  !=  TENDER_REQUIREMENTS_COMPLETE
```

B1 a găsit 51 de cerințe, P0b 42, pe aceeași documentație și același model: pack-ul e un set **grounded** de cerințe găsite în limita rulării (ture, buget, documente citite), NU dovada acoperirii exhaustive a documentației. Consecințe pentru UI-ul P0c:
- starea `importat` a pack-ului înseamnă „toate cerințele DIN PACK sunt în registru”, nu „registrul e complet”; UI-ul nu afișează „complet”/„acoperit” pe baza ei;
- `nereusite[]` (26 la Mânăstirea: 19 buget depășit, 4 scanate, 2 formate nesuportate, 1 respinsă de validator) se afișează lângă pack ca listă de „necitit”, nu se ascunde;
- completitudinea registrului rămâne o judecată umană (sau o rulare ulterioară pe documentele nereușite), separată de import.

## 4. Stare proiect

```
P0 design                  ✅
P0 security review         ✅
P0a dry-run                ✅
P0a blocker patches        ✅
P0a regression v2          ✅
P0a production apply       ✅
P0b Worker/CLI             ✅ (închis, PR #411 merged)
P0c UI                     ⏸  (așteaptă GO + decizia pe pagina_interval)
P1 clarificări             ⏸
```
