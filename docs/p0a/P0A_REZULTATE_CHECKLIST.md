# PR-P0a — Source Pack → registru: rezultate checklist (23.09.2026)

**Stare: NEAPLICAT în producție.** Migrarea a fost verificată prin *dry-run cu rollback* pe proiectul de producție
(`dxczwkbciseqniprspcu`): migrare + checklist într-o singură tranzacție, terminată cu `RAISE EXCEPTION`, deci nimic
nu a persistat (verificat după: 0 obiecte rămase, 0 coloane noi, 0 funcții, `ofertare_cerinte` = 4283 rânduri, ca înainte).

**Abatere față de instrucțiunea Copilot („pe Supabase branch”)**: branching-ul Supabase nu a fost disponibil
(`create_branch` a expirat de două ori, `list_branches` gol). Înlocuitorul a fost tranzacția anulată de mai sus —
același efect (zero schimbări în producție), dar rulată pe datele reale, nu pe o copie. Aplicarea în producție
se face DOAR după verificarea lui Răzvan/Copilot, prin `apply_migration` cu fișierul din acest PR.

Fișiere:
- `supabase/migrations/20260923_p0a_source_pack.sql` — migrarea (md5 `5272251d8073072dee014a31dfc7699d`)
- `test-fixtures/manastirea/p0a_checks.sql` — checklist-ul executabil (fixture real B1 Mânăstirea + pack sintetic)
- `test-fixtures/manastirea/p0a_checks_rezultat_2026-09-23.json` — rezultatul brut al rulării

## 1. Checklist P0a (PLAN_TEHNIC_P0_v2 + cele 4 ajustări) — rezultate

| # | Criteriu | Așteptat | Obținut | ✔ |
|---|---|---|---|---|
| S1 | Tabel `ofertare_source_pack` cu 19 coloane, `pack_hash` UNIQUE sha256, `sursa` CHECK ('cli') | creat | 19 coloane, ordine corectă | ✔ |
| S2 | 8 coloane noi pe `ofertare_cerinte`, toate NULLABLE; rândurile vechi neatinse | 0 rânduri vechi cu valori noi | 0 / 4283 (total neschimbat) | ✔ |
| S3 | Index unic parțial `(sursa_pack_id, sursa_ref)` | există | 1 | ✔ |
| S4 | CHECK `cand_se_prezinta` extins cu `la_solicitare` | 5 valori | duae, depunere, primul_loc, executie, la_solicitare | ✔ |
| S5 | View `v_ofertare_source_pack_nereusite` cu `security_invoker=on` | on | `{security_invoker=on}` | ✔ |
| ID1 | Pack-ul real B1 se inserează cu `stare='primit'` | primit | primit (id 1) | ✔ |
| ID2 | Pack cu `licitatie.licitatie_id=5` pe rând `licitatie_id=3` → refuzat de CHECK | refuzat | `ofertare_source_pack_identitate_chk` | ✔ |
| ID2b | Pack cu `nr_anunt` diferit de licitație → import refuzat | refuzat | `import: pack ≠ licitatie (identitate)` | ✔ |
| SEC1 | RLS activ pe ambele tabele; doar policy SELECT pt. authenticated | da | rls=true ×2; 2 policies SELECT | ✔ |
| SEC2 | User fără acces ofertare vede 0 pack-uri; INSERT/UPDATE ca authenticated refuzate | 0 / refuzat | 0; `permission denied` ×2 | ✔ |
| SEC2 | Responsabilul licitației vede pack-urile | ≥1 | 2 | ✔ |
| SEC3 | preview + mapeaza_doc = SECURITY **INVOKER**, STABLE; import + triggere = DEFINER cu `search_path=public, pg_temp` | conform | conform (vezi JSON `SEC3_functii`) | ✔ |
| SEC3 | Grants: `import` EXECUTE doar authenticated (+service_role implicit), nimic pt. anon/PUBLIC | conform | authenticated, service_role | ✔ |
| SEC4 | Import cu `auth.uid()` NULL → refuzat | refuzat | `import: fără sesiune` | ✔ |
| SEC4 | Import de user fără rol (nici owner, nici responsabil) → refuzat | refuzat | `doar ownerul sau responsabilul licitației` | ✔ |
| SEC5 | Pe rând importat: modificarea `sursa_pasaj` → refuzat; modificarea `text_cerinta` → permisă + ștampilă `text_editat_la/de` | refuzat / ștampilat | refuzat; editat_la=true, editat_de=actor | ✔ |
| SEC5 | Rândurile vechi (fără pack) se editează ca înainte | ok | ok | ✔ |
| SEC6 | **Ajustarea 3 — imutabilitate pack**: UPDATE pack / licitatie_id / DELETE → refuzat; `nota` → permis | refuzat ×3 / ok | conform | ✔ |
| SEC6 | **Ajustarea 4 — istoric append-only**: UPDATE pe `importuri` → refuzat | refuzat | `permission denied` (și trigger în spate pt. service_role) | ✔ |
| SEC7 | INSERT direct în `ofertare_cerinte` cu `sursa_pack_id` (fără RPC) → refuzat | refuzat | `sursa_pack_id se setează doar prin fn_ofertare_source_pack_import` | ✔ |
| MAP | Mapare pack→documente pe Mânăstirea: 51/51 `nume_exact`, 0 nemapate | 51 | 51 nume_exact, 0 nemapate | ✔ |
| MAP | Preview NU schimbă starea pack-ului | primit | primit | ✔ |
| IMP1 | Import integral 51 refs: 51 inserate, `confirmata_de` NULL, `extras_de_ai` true, `stare='de_analizat'`, `nr_ordine` continuă după 927 | 51 | 51; cand {depunere 27, executie 16, duae 7, la_solicitare 1}; tip {elim 16, prop 16, contr 13, forma 6}; ordine 928–978 | ✔ |
| IMP1 | Dashboard lic 3: 927 → 978 | 978 | 978 | ✔ |
| IMP2 | Re-import aceleași refs: 0 inserate, 51 sărite (idempotent) | 0 / 51 | 0 / 51 | ✔ |
| IMP | Istoric: 2 rânduri după 2 importuri | 2 | 2 | ✔ |
| IMP3 | Import parțial sintetic (REQ-001, REQ-003 nemapat, REQ-NU-EXISTA) → 1 inserat, 1 nemapat, 1 refuzat, `importat_partial` | conform | conform | ✔ |
| IMP3b | Completare cu REQ-002 → `importat` | importat | importat, 2/2 | ✔ |
| **Ajustarea 1 — grounding** | `pasaj_verificat` = (locator.verificat ≠ NULL); `locator_verificat` copiat; `pagina_declarata` păstrată când validatorul a corectat pagina | REQ-001 pagina; REQ-002 document, 7→9 | REQ-001 loc=pagina p11; REQ-002 loc=document p9 pag_decl=7, pasaj_v=true | ✔ |
| **Ajustarea 1 — pack real** | Pack-ul B1 real NU are `verificat` per item → `pasaj_verificat=false`, `locator_verificat=NULL` pe toate 51 (EXTRACTED ≠ VALIDATED) | 0 verificate | 0 / 51 | ✔ (onest) |
| **Ajustarea 2 — preview INVOKER** | Preview rulează ca user (SET ROLE authenticated) și trece prin RLS | funcționează | 3 rânduri pt. responsabil | ✔ |
| SIM | „seamănă cu” pe pg_trgm: REQ-001 ↔ cerința 6238, similarity identică cu calculul direct; prag 0.99 → 0 potriviri | egal | 0.5629 = 0.5629; 0 la 0.99 | ✔ |
| NER | View nereușite: 27 rânduri, 23 mapate la documente | 27 / 23 | 27 / 23 | ✔ |
| RB | După ștergerea rândurilor inserate: total = baseline | 4283 | 4283, `RB_egal_baseline=true` | ✔ |

**Toate cele 33 de verificări au trecut. Nimic nu a persistat.**

## 2. Diff RPC / trigger / RLS (ce adaugă migrarea)

Obiecte NOI (nu modifică niciun RPC existent):

| Obiect | Tip | Securitate | Rol |
|---|---|---|---|
| `ofertare_source_pack` | tabel | RLS on; SELECT authenticated via `fn_are_acces_ofertare()`; INSERT/UPDATE doar service_role (workerul Terra); fără DELETE nimănui | stochează pack-ul integral + hash + stare |
| `trg_ofertare_source_pack_imutabil` | trigger BEFORE UPDATE/DELETE | DEFINER | blochează DELETE și orice schimbare în afară de `stare / ultim_import_la / nota` |
| `ofertare_source_pack_importuri` | tabel | RLS on; SELECT authenticated; INSERT service_role (și RPC-ul definer); fără UPDATE/DELETE | un rând per apăsare „Importă” |
| `trg_ofertare_source_pack_importuri_ro` | trigger BEFORE UPDATE/DELETE | DEFINER | append-only |
| `ofertare_cerinte` +8 coloane | ALTER | — | `sursa_pack_id, sursa_ref, locator_verificat, pagina_declarata, incertitudine, sursa_mapare, text_editat_la, text_editat_de` — toate NULL pe rândurile vechi |
| `ofertare_cerinte_cand_se_prezinta_check` | CHECK înlocuit | — | + `la_solicitare` (restul identic) |
| `trg_ofertare_cerinte_pack_protejeaza` | trigger BEFORE INSERT/UPDATE | DEFINER | INSERT cu `sursa_pack_id` doar cu flagul de sesiune al RPC-ului; pe rândurile din pack blochează proveniența, ștampilează editarea textului. **Rândurile fără pack: comportament neschimbat.** |
| `fn_ofertare_source_pack_mapeaza_doc` | fn STABLE | INVOKER | id_context > seap_cod > nume exact > nume normalizat > niciuna |
| `fn_ofertare_source_pack_cand` | fn IMMUTABLE | — | DUAE→duae, la_depunere→depunere, in_executie→executie, la_solicitare→la_solicitare |
| `fn_ofertare_source_pack_preview` | fn STABLE | **INVOKER** (trece prin RLS) | tabelul de preview per cerință + „seamănă cu” (pg_trgm, prag 0.45) + `deja_importat` + `importabil` |
| `fn_ofertare_source_pack_import` | fn | **DEFINER** — justificare: trebuie să scrie în `ofertare_cerinte` și `importuri` peste RLS; poarta e în cod: `auth.uid()` obligatoriu + owner sau responsabil + identitate pack↔licitație | singurul drum prin care apar rânduri cu `sursa_pack_id` |
| `v_ofertare_source_pack_nereusite` | view | security_invoker | lista documentelor necitite/respinse din pack |

Ce NU se schimbă: niciun RPC existent, nicio policy existentă, `fn_gate_depunere`, generatorul, `core.ts`. Rândurile vechi din `ofertare_cerinte` nu se ating (verificat S2).

## 3. Observații pentru P0b (nu sunt în acest PR)

- Validatorul CLI (`verifica_pack.mjs`) nu emite încă `locator.verificat` per cerință → pe pack-urile reale totul intră cu `pasaj_verificat=false`. Corect după regula EXTRACTED ≠ VALIDATED, dar P0b trebuie să emită verdictul per item ca importul să-l poată prelua.
- `core.ts:239` (`reset` șterge `extras_de_ai ∧ confirmata_de IS NULL`) ar șterge și rândurile din pack → în P0b, reset-ul trebuie să excludă `sursa_pack_id IS NOT NULL` (sau să treacă prin RESTRICT-ul FK).
- UI de preview/import (butonul „Importă”) = P0c.
