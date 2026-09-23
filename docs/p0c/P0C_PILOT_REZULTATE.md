# P0C_PILOT_REZULTATE — primul import real controlat (Mânăstirea, pack #2)

Data: 24.09.2026 ~01:30 RO · GO explicit Răzvan în chat pe referințele **REQ-032, REQ-035, REQ-021** (lot mic, revizuite integral) · actor tehnic: contul `claude@gazpet.ro` (ofertare admin) · sesiune `session_01TYQw97aZXVXAoHSf25q68z`.

## 1. Înainte de import
- Test vizual LIVE cu drepturi: 9/9 PASS (butoane decizie pe 42 rânduri, „Importă 0" dezactivat, 42 candidați cu locator/avertismente, comparații REQ-019/043/018/012, nereușite/documente, selecție 11 fără scrieri, audit/istoric goale, BD 0/0/0).
- Decizii scrise (append-only): `ofertare_source_pack_decizii` #46 REQ-032, #47 REQ-035, #48 REQ-021 — toate `IMPORT`, motiv „GO Răzvan în chat, 24.09.2026 (pilot lot 1: …)".

## 2. Import (`fn_ofertare_source_pack_import(2, {REQ-032, REQ-035, REQ-021})`)
`import_id 6 · inserate [6352, 6353, 6354] · sărite [] · nemapate [] · refuzate [] · fara_decizie [] · stare pack importat_partial · importate_total 3`

## 3. Rândurile create (`ofertare_cerinte`)
| id | nr | ref | tip | document | locator verificat | secțiune | stare | confirmata_de | extras_de_ai | pasaj_verificat | mapare |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 6352 | 928 | REQ-032 | propunere | 80 (Factorii de evaluare) | `pagina` 1 | Factori de evaluare | de_analizat | **NULL** | true | true | nume_exact |
| 6353 | 929 | REQ-035 | eliminatorie | 99 (Formulare) | `document` (fără pagină) | Formularul nr. 7 | de_analizat | **NULL** | true | true | nume_exact |
| 6354 | 930 | REQ-021 | contractuală | 63 (Fișa de date) | `pagina` 13 | III.1.7 | de_analizat | **NULL** | true | true | nume_exact |

Proveniența e blocată de trigger (sursa_pack_id, sursa_ref, pasaj, pagină, locator, incertitudine). `pagina_declarata` NULL la toate trei (nu a fost corectată nicio pagină), interval NULL (pack v2).

## 4. Decizie + istoric
- `v_ofertare_source_pack_decizie_curenta`: cele 3 ref-uri = IMPORT; `v_ofertare_source_pack_revizie` pack 2: `decise 3/42 · revizuit false · rezolvat false · importate 3`.
- `ofertare_source_pack_importuri` #6 (import) și #7 (reimport de control).
- Preview: `deja_importat = true` pentru REQ-021, REQ-032, REQ-035.

## 5. Reimportul nu dublează
Al doilea apel identic → `inserate [] · sărite [REQ-032, REQ-035, REQ-021]`; rânduri cu pack 2 rămân 3; registrul licitației 3 = 930 active (927 + 3).

## 6. Observații
- REQ-021: `sursa_pasaj` („Nu se acordă avans. Plățile se efectuează…") ≠ `text_cerinta` („Finanțarea Contractului se asigură din bugetul de stat, prin PNI Anghel Saligny…"). Excerptul verificat literal de validator e alt pasaj din aceeași secțiune III.1.7 — importul transportă fidel pack-ul; la confirmarea E2 se citește documentul și, dacă e cazul, se corectează textul (proveniența rămâne).
- UI: audit/istoric la 0 intrări nu afișează un text „nimic încă" (finisaj minor).

## 7. Ce NU s-a făcut
- Confirmarea E2 pe cele 3 rânduri (separat, după verificarea conținutului).
- Decizii pe restul de 39 candidați (REQ-019/043 DUPLICATE propuse, REQ-031 SUPERSEDED propusă, REQ-030 DEFER).
- P1 nu începe.
