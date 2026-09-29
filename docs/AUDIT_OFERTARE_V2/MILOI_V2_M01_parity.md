# V2-M01 — Parity poartă UI ↔ server (Miloi)

Owner: Miloi (Gemini, `agy` mod plan, doar citire). Review: Claude, 28.09.2026 noaptea.
Scop: pentru fiecare rând al porții de aprobare/depunere din `src/ofertarePoarta.js` + `src/ofertareControale.js`, ce impune serverul.

**Verificare Claude:** 7 rânduri citite pe `main`. 6 sunt corecte la linie. La `pachet`, linia 616 e comentariul de deasupra funcției, deci decalaj de o linie; conținutul e corect. Clasificările MATCH/SERVER_ONLY verificate pe migrări: `neconfirmate` (r07:19) și `fisiere_depunere` (r11:18).

| Control | Fișier:linie UI | Clasificare | Dovadă server (fișier:linie) | Notă |
|---|---|---|---|---|
| cuprins | src/ofertarePoarta.js:28 | UI_ONLY | NEDETERMINAT | Absența capitolelor se verifică doar în UI. |
| fara | src/ofertarePoarta.js:33 | PARTIAL | supabase/migrations/20260928f_gate_depunere_r07.sql:21 | UI numără cerințele fără capitol; serverul verifică lipsa acoperirii (`n_neacoperite`). |
| dovada_propusa | src/ofertarePoarta.js:41 | PARTIAL | supabase/migrations/20260928n_gate_depunere_r06.sql:12 | UI dă doar WARN; serverul blochează la depunere fără `verificat_pe_scan`. |
| neverificate | src/ofertarePoarta.js:51 | UI_ONLY | NEDETERMINAT | Verificarea textului din capitole nu blochează pe server. |
| neconfirmate | src/ofertarePoarta.js:68 | MATCH | supabase/migrations/20260928f_gate_depunere_r07.sql:19 | Ambele blochează pe `confirmata_de IS NULL`. |
| documentatie | src/ofertarePoarta.js:83 | MATCH | docs/R5_MIGRARE_3_review_copilot.sql:216 | Același view: `v_ofertare_seap_completitudine`. |
| capcane | src/ofertarePoarta.js:90 | UI_ONLY | NEDETERMINAT | Regex doar în UI. |
| goale | src/ofertarePoarta.js:98 | UI_ONLY | NEDETERMINAT | |
| nu_e_cazul | src/ofertarePoarta.js:106 | UI_ONLY | NEDETERMINAT | |
| conformitate | src/ofertarePoarta.js:118 | PARTIAL | supabase/migrations/20260928f_gate_depunere_r07.sql:24 | UI verifică afirmațiile față de firmă; serverul verifică valabilitatea documentelor (`n_rosii`). |
| nescrise | src/ofertarePoarta.js:126 | UI_ONLY | NEDETERMINAT | |
| observatii | src/ofertarePoarta.js:135 | UI_ONLY | NEDETERMINAT | WARN doar în UI. |
| docs | src/ofertarePoarta.js:142 | UI_ONLY | NEDETERMINAT | Documentația de atribuire citită integral. |
| grafic | src/ofertarePoarta.js:153 | UI_ONLY | NEDETERMINAT | Avertisment client-side. |
| sursa_cantitati | src/ofertarePoarta.js:219 | MATCH | docs/R5_MIGRARE_3_review_copilot.sql:8 | `ofertare_r5_blocaj_sursa` pe același view. |
| cantitati | src/ofertareControale.js:49 | UI_ONLY | NEDETERMINAT | H2 (F3 vs grafic). |
| garantie | src/ofertareControale.js:191 | UI_ONLY | NEDETERMINAT | H4. |
| anexe | src/ofertareControale.js:278 | UI_ONLY | NEDETERMINAT | H5. |
| identitate | src/ofertareControale.js:328 | UI_ONLY | NEDETERMINAT | H1 (nume din alte licitații). |
| numere | src/ofertareControale.js:350 | UI_ONLY | NEDETERMINAT | H6. |
| participare | src/ofertareControale.js:440 | UI_ONLY | NEDETERMINAT | HOG-08. |
| pachet | src/ofertareControale.js:616 (≈617) | UI_ONLY | NEDETERMINAT | H9: piese F4/Opis vs fișiere atașate. |
| grafic_relatii | src/ofertareControale.js:737 | UI_ONLY | NEDETERMINAT | H11 (precedențe). |
| grafic_sursa | src/ofertareControale.js:780 | UI_ONLY | NEDETERMINAT | H10. |
| fisiere_depunere | — | SERVER_ONLY | supabase/migrations/20260928k_ofertare_pachet_depus_r11.sql:18 | `depus` cere rolurile `depus_final` + `dovada_seap`. |
| derogare_depunere | — | SERVER_ONLY | supabase/migrations/20260928f_gate_depunere_r07.sql:13 | Doar owner. |

**Rezumat:** MATCH 3 · PARTIAL 3 · UI_ONLY 18 · SERVER_ONLY 2.

**Concluzie pentru audit (Claude):** 18 din 26 de controale există doar în browser. Un client care scrie direct prin API (PostgREST) le ocolește pe toate. Serverul impune doar confirmarea cerințelor, acoperirea, completitudinea SEAP, sursa cantităților și rolurile de fișiere. Candidați pentru mutare pe server (propunere, nu task pornit): H9 `pachet`, H1 `identitate`, `cuprins`.
