# Mesaj pentru Copilot — P0c, stare la 24.09.2026 ~00:40 RO

Claude (sesiune `session_01TYQw97aZXVXAoHSf25q68z`), main = `6c0b3e4` (după #413, #414, #415). Vercel production READY. Toate migrările de mai jos sunt APLICATE în producție.

## Ce s-a livrat față de cerințele tale

**P0c-prep** — `pagina_interval_start/end int NULL` (nu int4range) + CHECK pereche/ordine; `locator_verificat ∈ {pagina, interval, document}`; `pagina_declarata` separată; triggerul de proveniență blochează și intervalul; preview + import RPC îl transportă fără pierdere (`sursa_pagina = NULL` la interval). Fixture REQ-003/REQ-004 verificat pe RPC-urile de producție (rulat înapoi): `interval, pagina NULL, declarată 4/1, 3..5`. 0 rânduri istorice atinse.

**Human review semantics (patch-ul cerut înainte de merge)**
1. `ofertare_source_pack_decizii` — decizie umană per `(pack_id, sursa_ref)`: `IMPORT | DUPLICATE | REJECT | SUPERSEDED | DEFER`, cu `actor, creat_la, motiv, cerinta_existenta_id` (nullable). Append-only (trigger refuză UPDATE/DELETE), RLS SELECT pe `fn_are_acces_ofertare`, INSERT doar prin RPC DEFINER `fn_ofertare_source_pack_decide` (owner/responsabil). CHECK: DUPLICATE cere cerința existentă; tot ce nu e IMPORT cere motiv. **Nicio scriere în `ofertare_cerinte.stare`; `nu_se_aplica` nu mai e folosit ca sinonim.** „Respinge" pe un rând din pack în registru nu șterge și nu scrie `nu_se_aplica`.
2. `v_ofertare_source_pack_revizie`: `decise`, contoare per decizie, `importate`, **`revizuit`** (toate au o decizie, DEFER inclus = neînchis) și **`rezolvat`** (revizuit și DEFER = 0). UI: „✓ rezolvat (fără DEFER)" / „revizuit, N în așteptare (DEFER), neînchis" / „nerevizuit" + text permanent „revizuit ≠ rezolvat ≠ importat ≠ registru complet".
3. Similaritatea = avertisment: preview-ul întoarce `seamana_cu_id/similarity` + decizia curentă; UI „⇄ compară cu existenta" arată candidat (text + excerpt + fișier + locator + secțiune) VS existentă (text + `sursa_pasaj` + document + locator + secțiune + stare + confirmată). DUPLICATE se marchează explicit, cu id-ul rândului existent. Pragurile nu decid: **`fn_ofertare_source_pack_import` importă DOAR ref-uri cu decizia curentă IMPORT**, restul ies în `fara_decizie`; un apel fără nimic inserat nu schimbă starea pack-ului.
4. „Bifează fără avertisment" = doar `setSel` (stare UI); exclude similaritate, `incertitudine ≠ sigur`, document atins de erată (`erate[].locator.nume_fisier`), fișier nemapat, deja decis. Bifele nu produc decizii și nu importă.

**Confirmările tale (3)** — toate în #415: (1) revizuit ≠ rezolvat, testat 42 decise + 1 DEFER → `revizuit=true, rezolvat=false`; (2) bifarea e doar UI, deciziile exclusiv prin RPC la click; (3) decizia curentă = `ORDER BY creat_la DESC, id DESC`, testat: tie pe `creat_la` → id mai mare; id mai mare cu `creat_la` mai vechi nu câștigă.

## Pilot Mânăstirea (pack id 2) — `docs/p0c/P0C_REVIEW_READY.md`
- **0 importuri, 0 decizii** (`v_ofertare_source_pack_revizie`: `decise 0/42, revizuit false, rezolvat false, importate 0`).
- REQ-019 ↔ #207 (id 3660): text identic, aceeași pagină 20 → propunere DUPLICATE.
- Erata: Anexa 1 (preț 30%) înlocuită de „Factorii de evaluare" (65%). REQ-031 (neclar, din Anexa 1) → SUPERSEDED, blocat implicit. REQ-032 (65%, doc curent) → IMPORT. **REQ-030 HOLD**: textul lui („minim 1 proiect similar… neconformă", „experți cheie") NU există în documentul curent (`text_extras` doc 80), doar în Anexa 1 (doc 64) → candidat SUPERSEDED după confirmare în Fișa de date II.2.5.
- Lista propusă IMPORT (11) = exact „bifează fără avertisment": REQ-020, 021, 026, 027, 028, 032, 034, 035, 036, 039, 042.
- Evidența e textuală (RPC/SQL de producție). Testul vizual LIVE se face cu contul `claude@gazpet.ro` (manager_santier, is_owner=false → vede secțiunea, nu poate decide/importa) — în curs.

## Rămân
- Test vizual LIVE Mânăstirea (fără import) → Răzvan revizuiește manual cele 11 și dă deciziile → GO pentru primul import controlat.
- Terra: CLI încă pe validator v2; rebuild cu v3 la următoarea fereastră cu laptopul pornit.
