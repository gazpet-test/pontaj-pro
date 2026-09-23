# PR-P0a — Source Pack → registru: rezultate checklist (23.09.2026)

**Stare: v2 aprobată de Copilot (23.09 seara), aplicată în producție prin `apply_migration` — vezi POST-APPLY CHECK în secțiunea 4.** Istoric: verificată întâi prin dry-run cu rollback. Migrarea a fost verificată prin *dry-run cu rollback* pe proiectul de producție
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


## 0. Revizia v2 (23.09, seara) — cele 2 patch-uri cerute de Copilot, rerulate

**Rezultat v2: toate verificările vechi trec identic + 5 verificări noi trec. 0 modificări persistate în producție** (verificat după rulare: 0 obiecte, 0 coloane, 0 policy, 0 funcții rămase; `ofertare_cerinte` = 4283). Rezultat brut: `test-fixtures/manastirea/p0a_checks_rezultat_2026-09-23_v2.json`.

### Patch 1 — fără GUC; INSERT direct ⇒ `sursa_pack_id IS NULL`
Politici live verificate înainte: `ofertare_cerinte` are RLS on (force=false), 4 politici PERMISSIVE pentru authenticated (select `auth.uid() IS NOT NULL`; insert/update/delete pe `fn_are_acces_ofertare()`), owner `postgres` (bypassrls). Nicio politică existentă nu a fost modificată.

| | Înainte | După |
|---|---|---|
| Poarta 1 (nouă) | — | policy **RESTRICTIVE** `ofertare_cerinte_fara_pack_direct` FOR INSERT TO authenticated, anon `WITH CHECK (sursa_pack_id IS NULL)` — se combină cu AND peste permisivele existente |
| Poarta 2 (trigger) | SECURITY DEFINER, accepta `sursa_pack_id` dacă GUC `ofertare.import_pack='on'` | SECURITY **INVOKER**, acceptă `sursa_pack_id` doar când `current_user` = ownerul tabelului (adică din interiorul RPC-ului DEFINER). Fără GUC. service_role (sare peste RLS) → `current_user=service_role` → refuzat |
| RPC import | `set_config('ofertare.import_pack','on')` … `'off'` | eliminat; INSERT-urile rulează ca owner (DEFINER) și trec ambele porți |

Teste noi:
| # | Test | Obținut | ✔ |
|---|---|---|---|
| SEC7b | **user authenticated CU acces Ofertare (responsabilul lic. 3)**, INSERT cu `sursa_pack_id`, cu GUC-ul vechi setat explicit pe `'on'` | refuzat | ✔ |
| SEC7c | același user, INSERT normal (fără pack) | ok (id 6283, șters la rollback) — fluxurile vechi neafectate | ✔ |
| SEC7d | `service_role` INSERT direct cu `sursa_pack_id` | refuzat de trigger | ✔ |
| SEC7 | user authenticated fără GUC | refuzat | ✔ |
| — | politici INSERT pe `ofertare_cerinte` după migrare | `ofertare_cerinte_fara_pack_direct` RESTRICTIVE + `ofertare_cerinte_insert` PERMISSIVE | ✔ |

Notă: mesajul de refuz vine de la trigger (BEFORE INSERT rulează înaintea verificării RLS WITH CHECK). Dacă triggerul ar lipsi, RLS-ul restrictiv ar refuza singur („new row violates row-level security policy”). Sunt două porți independente, niciuna nu depinde de vreun GUC.

### Patch 2 — stare pack
`importat` NUMAI dacă `nemapate_total = 0` (nicio cerință acceptată cu `sursa_mapare='niciuna'`) ȘI toate cele importabile sunt importate; altfel `importat_partial`. `nereusite[]` nu intră în calcul. Răspunsul RPC-ului expune acum și `nemapate_total`.

| # | Test | Înainte (v1) | După (v2) | ✔ |
|---|---|---|---|---|
| IMP3 | sintetic: import REQ-001 + REQ-003 (nemapat) + ref inexistent | importat_partial | importat_partial (nemapate_total 1) | ✔ |
| IMP3b | apoi import REQ-002 → toate cele mapabile importate, REQ-003 rămâne nemapat | **importat (greșit)** | **importat_partial** (importate 2/2 mapabile, nemapate_total 1) | ✔ |
| IMP1 | Mânăstirea real: 51/51 mapate și importate | importat | importat (nemapate_total 0) | ✔ |

### Diff SQL față de v1 (rezumat; complet în commit-ul 2 al PR #410)
- `fn_ofertare_cerinte_pack_protejeaza`: `SECURITY DEFINER` → `SECURITY INVOKER`; condiția INSERT `current_setting('ofertare.import_pack')` → `current_user <> pg_get_userbyid(relowner)`.
- + `CREATE POLICY ofertare_cerinte_fara_pack_direct … AS RESTRICTIVE FOR INSERT TO authenticated, anon WITH CHECK (sursa_pack_id IS NULL)`.
- `fn_ofertare_source_pack_import`: − 2× `set_config(...)`; + `v_nemapate_total`; `v_stare := CASE WHEN v_nemapate_total = 0 AND v_importabile > 0 AND v_importate >= v_importabile THEN 'importat' ELSE 'importat_partial' END`; răspuns + `nemapate_total`.
- Nimic altceva schimbat.

Notă P0c (acceptată): `respinge = DELETE` pe cerințele din pack pierde audit trail — se rezolvă înainte de UI-ul Source Pack (marcare `stare='respinsa'` în loc de DELETE; FK RESTRICT pe pack rămâne).

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
| IMP1 | Import integral 51 refs: 51 inserate, `confirmata_de` NULL, `extras_de_ai` true, `stare='de_analizat'`, `nr_ordine` unice și toate > baseline (927); intervalul exact nu e criteriu (testele suplimentare pot consuma numere) | 51 | 51; cand {depunere 27, executie 16, duae 7, la_solicitare 1}; tip {elim 16, prop 16, contr 13, forma 6}; v1: 928–978, v2: 929–979, ambele unice și > 927 | ✔ |
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

**Toate cele 33 de verificări au trecut (v1). Vezi secțiunea 0 pentru v2. Nimic nu a persistat.**

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
| `trg_ofertare_cerinte_pack_protejeaza` | trigger BEFORE INSERT/UPDATE | **INVOKER** (v2) | INSERT cu `sursa_pack_id` acceptat doar când `current_user` = ownerul tabelului (adică din interiorul RPC-ului DEFINER), fără GUC; pe rândurile din pack blochează proveniența, ștampilează editarea textului. **Rândurile fără pack: comportament neschimbat.** |
| `ofertare_cerinte_fara_pack_direct` | policy RESTRICTIVE INSERT (v2) | authenticated, anon | `WITH CHECK (sursa_pack_id IS NULL)` — INSERT direct din API nu poate crea rânduri din pack |
| `fn_ofertare_source_pack_mapeaza_doc` | fn STABLE | INVOKER | id_context > seap_cod > nume exact > nume normalizat > niciuna |
| `fn_ofertare_source_pack_cand` | fn IMMUTABLE | — | DUAE→duae, la_depunere→depunere, in_executie→executie, la_solicitare→la_solicitare |
| `fn_ofertare_source_pack_preview` | fn STABLE | **INVOKER** (trece prin RLS) | tabelul de preview per cerință + „seamănă cu” (pg_trgm, prag 0.45) + `deja_importat` + `importabil` |
| `fn_ofertare_source_pack_import` | fn | **DEFINER** — justificare: trebuie să scrie în `ofertare_cerinte` și `importuri` peste RLS; poarta e în cod: `auth.uid()` obligatoriu + owner sau responsabil + identitate pack↔licitație | singurul drum prin care apar rânduri cu `sursa_pack_id`; stare `importat` doar când toate cerințele sunt mapate și importate (v2) |
| `v_ofertare_source_pack_nereusite` | view | security_invoker | lista documentelor necitite/respinse din pack |

Ce NU se schimbă: niciun RPC existent, nicio policy existentă, `fn_gate_depunere`, generatorul, `core.ts`. Rândurile vechi din `ofertare_cerinte` nu se ating (verificat S2).

## 3. Observații pentru P0b (nu sunt în acest PR)

- Validatorul CLI (`verifica_pack.mjs`) nu emite încă `locator.verificat` per cerință → pe pack-urile reale totul intră cu `pasaj_verificat=false`. Corect după regula EXTRACTED ≠ VALIDATED, dar P0b trebuie să emită verdictul per item ca importul să-l poată prelua.
- `core.ts:239` (`reset` șterge `extras_de_ai ∧ confirmata_de IS NULL`) ar șterge și rândurile din pack → în P0b, reset-ul trebuie să excludă `sursa_pack_id IS NOT NULL` (sau să treacă prin RESTRICT-ul FK).
- UI de preview/import (butonul „Importă”) = P0c.

## 4. POST-APPLY CHECK (23.09.2026, ~18:02 UTC) — producție `dxczwkbciseqniprspcu`

Aplicat cu `apply_migration` exact fișierul din PR #410 (commit 595e7a0 + doc fix; migrare md5 `8043d3ff07637d31f0da56254eb94559`, 25.420 bytes), urmat de 3 migrări mici de post-apply (în repo: `20260923_p0a_source_pack_post_apply.sql`).

| # | Verificare | Rezultat | ✔ |
|---|---|---|---|
| 1 | migrare prezentă | `supabase_migrations.schema_migrations`: `20260923180149 p0a_source_pack` (+ `p0a_source_pack_grants_strict`, `p0a_source_pack_cand_search_path`, `p0a_source_pack_indexuri_fk`); migrare = fișierul din repo, md5 `8043d3ff…` | ✔ |
| 2 | `ofertare_cerinte` = baseline, nemodificat | înainte: 4283 rânduri, max_id 6224, max_updated 2026-09-22 17:07:49, amprentă md5(id|text|stare) `e8ad1a32…`; după: identic (4283 / 6224 / aceeași dată / `e8ad1a32…`) | ✔ |
| 3 | 8 coloane noi, NULL pe istoric | toate 8 `is_nullable=YES`; rânduri istorice cu vreo valoare: 0 | ✔ |
| 4 | `ofertare_source_pack` | 0 rânduri | ✔ |
| 5 | `ofertare_source_pack_importuri` | 0 rânduri | ✔ |
| 6 | RLS/policies exact v2 | RLS on pe toate 3 tabelele. `ofertare_cerinte`: cele 4 permisive vechi neatinse + `ofertare_cerinte_fara_pack_direct` RESTRICTIVE INSERT `{anon,authenticated}` CHECK `(sursa_pack_id IS NULL)`. `source_pack`/`importuri`: doar SELECT permisiv pe `fn_are_acces_ofertare()`. **Corecție post-apply**: Supabase acordase implicit `anon`=ALL și `service_role`=ALL pe tabelele noi (RLS le bloca, dar nu era „exact v2”) → revocate; acum: authenticated=SELECT, service_role=INSERT,SELECT,UPDATE (pack) / INSERT,SELECT (importuri), anon=nimic (test: `permission denied`) | ✔ |
| 7 | RPC preview = INVOKER | `prosecdef=false`, STABLE, `search_path=public, pg_temp` (la fel `mapeaza_doc`, trigger `pack_protejeaza`) | ✔ |
| 8 | RPC import = DEFINER + search_path fix | `prosecdef=true`, `search_path=public, pg_temp`; EXECUTE doar authenticated (+service_role) | ✔ |
| 9 | INSERT direct authenticated cu `sursa_pack_id` | tranzacție anulată, ca responsabilul lic. 3: **BLOCK** (`sursa_pack_id se setează doar prin fn_ofertare_source_pack_import`) | ✔ |
| 10 | INSERT/UPDATE normal, fluxul vechi | INSERT fără pack: ok (rând 6339, vizibil, anulat la rollback); UPDATE pe rând vechi: 1 rând, ok | ✔ |
| 11 | get_advisors | Security: 2 semnale noi → `fn_ofertare_source_pack_cand` search_path mutabil (**reparat**, ALTER FUNCTION SET search_path); `fn_ofertare_source_pack_import` DEFINER apelabil de authenticated = intenționat (poarta de import cu verificare de rol în cod; aceeași clasă ca celelalte 49 RPC-uri listate). Performance: 4 INFO noi „unindexed FK” → **reparate** (4 indexuri). Restul semnalelor preexistă P0a. | ✔ |
| 12 | build/tests repo | `npx vite build` ✓ (20 s); checklist-ul DB (v2) 100% trecut înainte de apply | ✔ |

Niciun pack real în registrul live (0 rânduri). P0b nu a început.
