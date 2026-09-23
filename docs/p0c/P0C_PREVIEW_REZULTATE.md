# P0C_PREVIEW_REZULTATE — pilot Mânăstirea (pack id 2), STOP înainte de import

Data: 23.09.2026 · Sesiune: `session_01TYQw97aZXVXAoHSf25q68z` · Branch/PR: `claude/p0c-source-pack` → [PR #413](https://github.com/gazpet-test/pontaj-pro/pull/413) (draft)

**Stare la momentul raportului: 0 rânduri importate în `ofertare_cerinte` din pack-ul 2.** Registrul licitației 3 (DF1278266) are 927 cerințe active, toate confirmate (E2 trecută pe extracția veche), 125 eliminatorii. Pack-ul 2 rămâne `stare = primit`.

---

## 1. P0c-prep — livrat și verificat în producție

| Element | Stare |
|---|---|
| Migrare `p0c_prep_locator_interval` | ✅ aplicată (apply_migration) |
| `ofertare_cerinte.pagina_interval_start/end integer NULL` + CHECK pereche/ordine | ✅ |
| `locator_verificat` CHECK ∈ {pagina, interval, document} | ✅ |
| Trigger provenance blochează `pagina_interval_start/end` pe rândurile din pack | ✅ (refuzat la UPDATE → 9 și la NULL) |
| `fn_ofertare_source_pack_preview` +2 coloane (după `pagina_declarata`) | ✅ INVOKER, grants authenticated+service_role |
| `fn_ofertare_source_pack_import` scrie intervalul, `sursa_pagina = NULL` la interval | ✅ DEFINER |
| Fixture REQ-003/REQ-004 pe RPC-urile de producție (tranzacție rulată înapoi) | ✅ `locator_verificat=interval, sursa_pagina=NULL, pagina_declarata=4/1, interval 3..5`; REQ-001 pagina/1; REQ-002 document/2 (declarată 9) |
| Rânduri istorice atinse | 0 (`randuri_cu_interval = 0`, total 4283 neschimbat) |
| Validator `verifica_pack.mjs/3` + test fixture | ✅ 10/10 local; **Terra CLI încă rulează v2** (de actualizat la următoarea sesiune cu laptopul pornit — pack 2 e produs cu v2, fără intervale) |
| Worker `source_pack.ts` acceptă `interval` | ✅ în PR; ajunge pe Terra prin git auto-pull după merge |
| Grants stricte `v_ofertare_source_pack_nereusite` | ✅ aplicat (era anon ALL implicit; RLS+invoker îl neutralizau) |

## 2. P0c UI — ce s-a construit (`src/OfertareSourcePack.jsx`, sub tab-ul „📋 Cerințe & acoperire")

- listă Source Packs per licitație (stare, model, ture, cost, sha256, validator, contoare pagina/interval/document/respinse);
- preview prin `fn_ofertare_source_pack_preview`; filtre: neimportate / doar cu avertisment / toate;
- selecție umană: bifă pe rând, „bifează fără avertisment", „bifează toate", „debifează"; rândurile deja importate sau nemapate nu se pot bifa;
- badge locator dovedit: `📍 pagina n` (verde) / `📍 paginile a–b` (teal, cu „model a zis p.X") / `📄 în document` (galben); niciodată pagină inventată;
- incertitudine (sigur/probabil/neclar), maparea fișierului, excerptul verificat, documentul probant;
- ⚠ similaritate cu rând existent (id + %), click sare la rândul din acoperire;
- nereușite (din view), erate (cu locatorul lor verificat), documente citite integral / parțial / deloc;
- import DOAR la click + `window.confirm` (cu avertisment dacă sunt rânduri similare bifate), prin `fn_ofertare_source_pack_import`; butonul apare doar la owner/responsabil (RPC-ul verifică oricum);
- istoric importuri (append-only) cu actor și contoare;
- text permanent: **„pack importat ≠ registru complet"**; nicăieri nu apare „complet".
- `CerinteSection`: badge `📦 pack · incertitudine`, intervalul în proveniență, **respinge pe rând din pack = `nu_se_aplica` + motiv „respinsă la revizuire (Source Pack #id · REQ)" — fără DELETE fizic**; registrul se reîncarcă după import.
- `npx vite build` OK. Netestat vizual LIVE (PR draft, nemers).

## 3. Preview pack 2 (Mânăstirea) — rezultatul real, doar citire

| Contor | Valoare |
|---|---|
| Cerințe în pack | 42 (validator v2: 31 pagina, 11 document, 0 interval, 1 respinsă) |
| Importabile (document mapat) | 42/42 (`nume_exact`) |
| Deja importate | 0 |
| Tip | 13 eliminatorii · 11 propunere · 10 contractuale · 8 formă |
| Incertitudine | 41 sigur · 1 neclar (REQ-031) |
| Pagina declarată ≠ dovedită | 1 (REQ-020: declarată 6, marcaj 7 → `document`) |
| Seamănă cu rând existent (prag 0.45) | **29/42**: 2 ≥ 0.80 · 10 între 0.60–0.80 · 17 sub 0.60 |
| Fără nicio potrivire | 13 |
| Nereușite | 26: 19 „depășit buget" · 4 „fără text (scanat)" · 2 „format nesuportat" · 1 respinsă de validator (REQ-029, excerpt negăsit literal) · 4 dintre ele fără document mapat |
| Erate | 1: factorul preț 30% (Anexa 1) → 65% (Factorii de evaluare) |
| Documente în pack | 33: 9 integral · 1 parțial (caiet de sarcini, 113 p.) · 23 deloc |

### 3.1 Dubluri certe (NU se importă)
| Ref | Sim | Rând existent |
|---|---|---|
| REQ-019 | 1.00 | #207 (id 3660) — text identic („Fișierele trebuie să fie complete, lizibile…") |
| REQ-043 | 0.91 | #527 (id 2896) — Program rectificativ 48 h, identic în primele 120 caractere |

### 3.2 Parafraze ale unor rânduri existente (0.60–0.80) — propun NU (registrul le are deja)
REQ-018 (0.74 ↔ #175), REQ-012 (0.70 ↔ #107), REQ-008 (0.69 ↔ #73), REQ-017 (0.68 ↔ #158), REQ-033 (0.68 ↔ #31), REQ-007 (0.65 ↔ #68), REQ-040 (0.64 ↔ #521), REQ-023 (0.64 ↔ #851), REQ-016 (0.63 ↔ #143), REQ-009 (0.61 ↔ #81). Fiecare pereche spune aceeași obligație cu alte cuvinte.

### 3.3 Potriviri slabe (< 0.60) — 17, de decis rând cu rând
REQ-001…006 (preambulul „Ofertantul unic/asociat/subcontractant…" se potrivește cu cerințe DIFERITE din III.1.1), REQ-010, 011, 013, 014, 015, 022, 024, 025, 037, 038, 041. Similaritatea vine din formulare comune, nu neapărat din aceeași cerință; unele pot fi adaosuri reale (ex. REQ-004 ANRE EDSB, REQ-006 experiență 5 ani).

### 3.4 Fără potrivire — 13, candidate clare la import
REQ-020 (ajustare preț, `document`, declarată 6/ marcaj 7), REQ-021 (finanțare Anghel Saligny), REQ-026 (Planul calității), REQ-027, REQ-028 (măsurători cu șanțul deschis — eliminatorie), REQ-030 (experți cheie, Anexa 1), REQ-031 (preț 30%, **neclar** + erată), REQ-032 (preț 65%), REQ-034, REQ-035 (interzisă subcontractarea totală — eliminatorie), REQ-036, REQ-039, REQ-042.

⚠ REQ-030/031 vin din „2.1.-Anexa 1- Factori de evaluare" — documentul pe care erata îl arată ca ÎNLOCUIT de „Factorii de evaluare - detaliere" (65%). REQ-031 contrazice REQ-032. Propun: REQ-032 da, REQ-031 nu (sau import + `nu_se_aplica` cu motiv), REQ-030 de verificat dacă factorul „experți cheie" mai există în versiunea nouă.

## 4. Selecție controlată propusă (pentru confirmare, NU executată)

- **A — import (12):** REQ-020, 021, 026, 027, 028, 032, 034, 035, 036, 039, 042 + REQ-030 dacă factorul e confirmat în documentul nou.
- **B — de decis rând cu rând (17):** lista 3.3.
- **C — nu se importă (12):** 3.1 + 3.2.
- Cu A singură: pack-ul trece pe `importat_partial` (corect: 42 importabile, 12 importate). Registrul NU devine „complet": 23 documente necitite, caietul de sarcini citit parțial, 26 nereușite.

**STOP aici.** Importul real se face din UI (după merge #413 + deploy) sau prin RPC la GO explicit, pe lista confirmată.

## 5. Ce mai e de făcut
1. Verificare Copilot/Răzvan pe secțiunile 3–4 → GO cu lista finală.
2. Merge #413 → Vercel → test vizual pe fișa Mânăstirea (Ctrl+Shift+R) → import din UI pe lista confirmată → confirmare E2 pe rândurile noi (nu pe tot registrul).
3. Terra: `verifica_pack.mjs` v3 în containerul CLI (rebuild) — cu laptopul pornit.
4. Următorul pack real să fie rulat cu v3 ca să vedem `interval` pe date reale.
