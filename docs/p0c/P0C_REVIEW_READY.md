# P0C_REVIEW_READY — Mânăstirea (pack id 2), gata de revizie umană; STOP înainte de primul import real

Data: 23.09.2026 ~23:55 RO · Sesiune `session_01TYQw97aZXVXAoHSf25q68z` · main = `337faee` ([PR #413](https://github.com/gazpet-test/pontaj-pro/pull/413) merged, squash) · Vercel production `dpl_DikFCeBeRiMPs6bc7Qu5A8unBJEd` READY pe 337faee.

**Stare BD la momentul raportului (toate citite ca owner, prin RPC-urile de producție):**

| Fapt | Valoare |
|---|---|
| `ofertare_cerinte` cu `sursa_pack_id = 2` | **0** (nimic importat) |
| `ofertare_source_pack_decizii` pentru pack 2 | **0** (nicio decizie dată încă — auditul e gol, așa cum trebuie înainte de revizie) |
| `v_ofertare_source_pack_revizie` pack 2 | `stare=primit · decise 0/42 · revizuit=false · importate 0` |
| Registrul licitației 3 | 927 cerințe active, toate confirmate (E2 pe extracția veche) |

Evidența de mai jos e **textuală** (rezultate RPC/SQL). Nu am cont în aplicație din sesiunea asta, deci nu am screenshot LIVE; testul vizual pe fișa Mânăstirea (tab „📋 Cerințe & acoperire" → secțiunea „📦 Source Packs", Ctrl+Shift+R) îl faci tu sau îl fac eu cu Playwright dacă îmi dai un cont de test.

---

## 1. Patch-ul „human review semantics" — ce s-a livrat (aplicat în producție)

| Cerință Copilot | Implementare | Verificat |
|---|---|---|
| Decizie umană explicită per `(pack_id, sursa_ref)`, append-only, auditată: `IMPORT / DUPLICATE / REJECT / SUPERSEDED / DEFER` cu `actor, timestamp, reason, linked_existing_requirement_id` | tabel `ofertare_source_pack_decizii` (`actor uuid, creat_la, motiv, cerinta_existenta_id nullable`), trigger append-only (UPDATE/DELETE refuzate), RLS SELECT pe `fn_are_acces_ofertare`, INSERT doar prin RPC DEFINER `fn_ofertare_source_pack_decide` (owner/responsabil). CHECK: `DUPLICATE` cere `cerinta_existenta_id`; tot ce nu e `IMPORT` cere motiv ≥ 3 caractere. | dry-run: UPDATE refuzat; DUPLICATE fără id refuzat; REJECT fără motiv refuzat; ref inexistent refuzat; re-decizie pe ref deja importat refuzată |
| Nu transforma deciziile în `nu_se_aplica` | Nicio scriere în `ofertare_cerinte.stare` din fluxul de revizie. `CerinteSection`: „✕" pe rând din pack nu mai scrie `nu_se_aplica` și nu șterge; explică unde se dă decizia. | cod |
| Review completion ≠ import completion | `v_ofertare_source_pack_revizie`: `decise, decise_import/duplicate/reject/superseded/defer, importate, revizuit`. UI: badge „revizuit / nerevizuit · decise X/N · importate Y" lângă starea pack-ului + text permanent „revizuit ≠ importat ≠ registru complet". | dry-run: după 4 decizii + 1 import → `decise 4, revizuit false, importate 1, stare importat_partial` |
| Similaritatea = warning, nu verdict; side-by-side | preview-ul întoarce `seamana_cu_id/similarity` + decizia curentă; UI „⇄ compară cu existenta": **candidat** (text + excerpt verificat + fișier + locator + secțiune) VS **existentă** (text + `sursa_pasaj` + document + locator + secțiune + stare + confirmată). Omul apasă `DUPLICATE` și confirmă id-ul rândului existent. Pragurile nu decid nimic: importul RPC cere decizia curentă `IMPORT`, nu similaritate. | dry-run import cu `[IMPORT, DUPLICATE, nedecis]` → 1 inserat, 2 `fara_decizie` |
| Default selection restrictivă | „bifează fără avertisment" = doar: fără similaritate, `incertitudine = sigur`, fișier NEatins de erată (fișierul din `erate[].locator.nume_fisier` = documentul cu valoarea veche), fișier mapat, nedecis. Bifele **nu importă**; importul ia doar rândurile cu decizia `IMPORT`. | SQL cu aceleași reguli → lista din §5 |

## 2. Disposition audit (evidence)

- Tabel: `ofertare_source_pack_decizii` — 0 rânduri pentru pack 2 (nimic decis încă).
- Vizibil în UI: „🧑‍⚖️ audit decizii (N, append-only)" sub lista de candidați: `#id · dată · actor · REQ → DECIZIE (→ cerința #nr) · motiv`.
- Dry-run (rulat înapoi, 23.09): `REQ-021: IMPORT → DEFER („răzgândit — test append-only") → IMPORT` a lăsat 3 rânduri; decizia curentă = ultimul (`IMPORT`); `UPDATE … SET motiv` → refuzat de trigger.

## 3. Comparație candidat vs existentă — REQ-019 (DUPLICATE cert)

| | CANDIDAT REQ-019 (pack) | EXISTENTĂ #207 (id 3660) |
|---|---|---|
| text | Fișierele trebuie să fie complete, lizibile, accesibile și neprotejate prin parole sau alte restricții. | Fișierele trebuie să fie complete, lizibile, accesibile și neprotejate prin parole sau alte restricții. |
| excerpt / pasaj sursă | identic cu textul | identic cu textul |
| document | Instructiuni_ofertanti_FisaDate_DF1278266.pdf | Instructiuni_ofertanti_FisaDate_DF1278266.pdf |
| locator | 📍 pagina 20 (verificat `pagina`) · secțiunea VI.3 | pagina 20 · secțiunea IV.4.1 |
| stare | nedecis (similarity 1.00 = **avertisment**) | `de_analizat`, confirmată |

Propunere: `DUPLICATE → #207 (id 3660)`, motiv „text identic, aceeași pagină". Decizia o dai tu din UI; eu nu am scris-o.

## 4. Erata factorilor de evaluare — REQ-031 / REQ-032 / REQ-030

Erata din pack (verificată literal, `pagina` 1): **de la** „2.1.-Anexa 1- Factori de evaluare - detaliere.pdf: preț 30%, personal 50%, fără factor de mediu" **la** „Factorii de evaluare - detaliere.pdf + Fișa de date II.2.5: preț 65%, manager de proiect 5%, mediu 10%". Fișierul atins de erată = Anexa 1 (doc id 64). UI-ul marchează toți candidații din Anexa 1 cu „⚠ document atins de erată / posibil înlocuit" și îi exclude din selecția implicită.

| Ref | Document | Text (scurt) | Verificat | Incert. | Ce spune documentul CURENT (id 80, „Factorii de evaluare - detaliere") | Status propus |
|---|---|---|---|---|---|---|
| REQ-031 | Anexa 1 (înlocuit) | „preț 30% … max 30 puncte … Calificarea și experiența personalului" | 📍 p.1 | **neclar** | conține „65%", NU conține „30%" | **SUPERSEDED** (avertizat/blocat implicit: erată + neclar) |
| REQ-032 | Factorii de evaluare (curent) | „preț 65% … max 65 puncte … Experiența profesională a Managerului" | 📍 p.1 | sigur | e chiar sursa | **IMPORT** (current) |
| REQ-030 | Anexa 1 (înlocuit) | „experți … minim 1 proiect similar … oferta neconformă" | 📍 p.7 | sigur | **NU** conține „minim 1 proiect similar", NU „neconformă", NU „experți cheie"; conține „mediu" | **HOLD (DEFER)** implicit; evidența arată că factorul „experți cheie" nu mai există în documentul curent → candidat la SUPERSEDED după ce confirmi și în Fișa de date II.2.5 |

Verificarea pe documentul curent e făcută pe `text_extras` din BD (doc 64: 23.212 caractere; doc 80: 29.542 caractere), căutare literală normalizată pe spații.

## 5. Lista finală propusă pentru IMPORT (11) — exact ce dă „bifează fără avertisment"

`REQ-020, REQ-021, REQ-026, REQ-027, REQ-028, REQ-032, REQ-034, REQ-035, REQ-036, REQ-039, REQ-042`

Criterii: fără similaritate în registru, `incertitudine = sigur`, document neatins de erată, fișier mapat, nedecis. (Față de raportul anterior a ieșit REQ-030 — e din Anexa 1, deci HOLD.)

Propuneri pentru restul (de decis de tine, rând cu rând, în UI):
- `DUPLICATE`: REQ-019 → #207; REQ-043 → #527 (0.91, Program rectificativ 48 h).
- parafraze 0.60–0.80 (REQ-007, 008, 009, 012, 016, 017, 018, 023, 033, 040): de comparat față în față; probabil `DUPLICATE` cu rândul propus.
- potriviri slabe < 0.60 (REQ-001…006, 010, 011, 013, 014, 015, 022, 024, 025, 037, 038, 041): `IMPORT` sau `DUPLICATE` după comparație — similaritatea vine din preambuluri comune.
- REQ-031 `SUPERSEDED`, REQ-030 `DEFER` (vezi §4).

## 6. STOP

- 0 importuri, 0 decizii scrise. Primul import real se face din UI, după ce dai deciziile (sau la GO explicit, prin RPC, pe lista din §5).
- Rămân: rebuild CLI Terra cu validatorul v3 (laptop pornit), test vizual LIVE.
