# P3: triajul celor 18 controale UI_ONLY (Claude, 29.09.2026)

Sursa listei: `MILOI_V2_M01_parity.md`. Stările din cod le-am verificat pe main, în `src/ofertarePoarta.js` și `src/ofertareControale.js`.
**Regula Copilot:** „Dacă dispariția JavaScript-ului poate permite un fals aprobat/depus, controlul nu are voie să existe numai în client.”
Test mecanic: dacă funcția UI poate întoarce `stare:'block'` (butonul de aprobare/depunere e dezactivat), controlul e **BLOCK** și se mută pe server. Dacă poate întoarce doar `warn`, e **WARN/UX** și rămâne în UI, documentat.

| # | Control (k) | Poate da `block`? | Clasă | Pe server prin | Notă |
|---|---|---|---|---|---|
| 1 | cuprins | da (0 capitole) | **BLOCK** | COUNT capitole > 0 | trivial în SQL |
| 2 | neverificate | da | **BLOCK + INVALIDATE** | cerințe cu capitol fără verificare la versiunea curentă a capitolului | depinde de versiunea capitolului; invalidare la editare |
| 3 | capcane | da | **BLOCK** | rândurile de capcane descoperite, deschise | datele stau în BD |
| 4 | goale | da | **BLOCK** | capitole obligatorii cu text gol | SQL pe lungime/text |
| 5 | nu_e_cazul | nu (warn) | WARN | — | rămâne în UI |
| 6 | nescrise | da | **BLOCK** | capitole AI necitite de om (lipsește marca de om) | coloana există în BD |
| 7 | observatii | nu (warn) | UX | — | rămâne în UI |
| 8 | docs | da (0 documente) | acoperit de **R12** | `v_ofertare_seap_completitudine` (live) | reclasificat: MATCH prin R12, fără cod nou |
| 9 | grafic | nu (warn) | WARN | — | versiunea înghețată contează la #18 |
| 10 | cantitati (H2) | da | **BLOCK** (parțial deja pe server) | R5 acoperă sursa; lipsește F3 vs grafic peste toleranță | extinde poarta R5 cu totalul F3 vs grafic |
| 11 | garantie (H4) | da | **BLOCK** | luni/moment cerute vs oferite | structurat în BD? de verificat; altfel parsare pe server |
| 12 | anexe (H5) | da | **BLOCK** | trimiteri din text la anexe inexistente | parsare text pe server (edge) |
| 13 | identitate (H1) | nu (azi doar warn) | WARN → **decizie Răzvan** | nume de localități din alte licitații | Copilot: „aproape sigur pe server”. A-l face BLOCK e **regulă business nouă** (azi e doar avertisment) |
| 14 | numere (H6) | da | **BLOCK** | numărul de branșamente din cerințe ≠ cel din capitole | parsare pe server |
| 15 | participare (HOG-08) | nu (warn) | WARN | — | rămâne în UI |
| 16 | pachet (H9) | da | **BLOCK** | piesele din opis au fișier; semnătura nu e ruptă | **J04** acoperă identitatea obiectului și hash-ul la depunere; H9 (opis → fișier) rămâne de mutat |
| 17 | grafic_relatii (H11) | da | **BLOCK** | conflict între relații și date | datele graficului sunt în BD |
| 18 | grafic_sursa (H10) | da | **BLOCK + INVALIDATE** | graficul din pachet = versiunea înghețată | invalidare la o versiune nouă |

**Rezumat:** 12 BLOCK (două și INVALIDATE), 1 acoperit deja de R12, 4 WARN/UX care rămân în UI, 1 decizie de business (identitate).

## Propunere de implementare (J07, după Jilava)
Cu un singur loc de evaluare pe server, UI-ul nu mai poate spune altceva decât serverul:
- funcție `ofertare_poarta_server(licitatie_id) returns jsonb`, SECURITY DEFINER, citire. Calculează în SQL controalele 1, 2, 3, 4, 6, 10, 11 (dacă garanția e structurată), 17 și 18;
- controalele care cer parsare de text (11 nestructurat, 12, 14, 16/H9) stau într-o edge fn `ofertare-poarta-text`. Ea scrie un rezultat **legat de versiunea capitolelor** (hash-ul textului), iar funcția SQL îl citește; un rezultat vechi înseamnă BLOCK (fail-closed);
- triggerul existent (`fn_ofertare_pt_pachet_poarta_documentatie` + `fn_gate_depunere`) cheamă `ofertare_poarta_server` la `aprobat` și la `depusa`. Orice `block` înseamnă RAISE;
- UI-ul (`evalueazaPoarta`) afișează rezultatul serverului, nu îl recalculează (un singur adevăr). Testele de paritate: M01.

Nimic din J07 nu se aplică înainte de 02.10 (Jilava).

## Verdict Copilot (29.09): P3 clasificare GO; J07 design GO cu condiții
- Regula „block UI ⇒ BLOCK server” e valabilă aici fiindcă cele 12 controale participă la verdictul de aprobare/depunere. Nu e principiu general.
- `ofertare_poarta_server()` **fără apel de rețea**: citește doar rezultate persistate.
- Un rezultat textual e legat de `control_code` + `parser_version` + hash-ul exact al sursei. Dacă se schimbă capitolul sau parserul, rezultatul devine invalid.
- Lipsă / stale / eroare de parser ⇒ **UNDETERMINED ⇒ BLOCK** la aprobare/depunere.
- Invalidare: o schimbare în amonte retrage sau face stale un verde existent. `neverificate` și `grafic_sursa`: BLOCK acum + INVALIDATE la schimbarea bazei.
- H9: J07 acoperă doar relația opis → fișier efectiv. Hash-ul rămâne la J04 (nu se dublează).
- Nu monolit: funcție agregatoare, dar fiecare control identificabil și testabil separat.
- **H1 identitate = BUSINESS_DECISION_REQUIRED** (azi WARN; server enforcement: none; nu poate contribui la verde) până decide Răzvan.
