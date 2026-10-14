# Predare Ofertare — 14.10.2026 (sesiunea session_015ZQAcgA2mSNb4K8aZXNjwK, ~887k context, rotație aprobată de Răzvan)

Copie în repo a rândului din `handoff_activ` (dacă scrierea în BD n-a primit aprobare, ASTA e sursa pentru sesiunea nouă).

## LIVE (făcut în sesiune)
- **#679 rigoare proveniență** — MERGED (7d284b3), migrarea **20261026a APLICATĂ** (v20261026120000, SHA faf9126a, da Răzvan prin chat,
  dry + apply cod 0 + gate 0e + sanity + proba revenirii OK; runner `C:\Users\Public\livrare\run679.sh`). Varianta A: garda a03 RĂMÂNE
  (aplicarea automată din seturi pe licitațiile cu loturi = manuală). 8 edge ofertare-* deployate.
- **#681 triere personal v1.9** — MERGED (5d7b9fd), **ofertare-triere DEPLOYATĂ**, verifica-edge-functions curat, 401 fără auth / cu anon.
  Criterii prin poartă, documente_firma (ET #13 până 2027-07-27) verificate la termen, coduri ANRE pe rol (D4 aprobat: fel + domeniu,
  coduri noi doar din Ordinul confirmat — tabel gol), preferința EGT (Trușu / Stănescu) fără cumul, bonus +2 Manager Proiect doar pe
  condiția simplă și în optimizare. Plafon #1724: confirmare automată DOAR ANRE de firmă din listă închisă (ET, EDIB, EDSB, EPI) pe
  formulări integral validate; restul „de verificat de om”. Botoșani ET (formulare în 2 segmente) → „de verificat”, candidat #13.

## Deschise
- **PR #680** (docs) — plan triere 102: D1 da, D2 A, D3 A, D5 închis (ET = #13), D4 = propunerea de echivalențe (aprobată).
- **PR #691** (docs) — SPECIFICAȚIA FINALĂ pilot OCR local pe 102 (`docs/paw/PLAN_OCR_LOCAL_OFERTARE.md`, f749689 + corecția 787bf5d):
  LightOnOCR-2-1B + MinerU2.5-Pro (vLLM), comparare cuvânt / cifră / triplet, **arbitraj automat Sonnet 5** cu ieșire strictă
  (ales_lighton / ales_mineru / text_propus / needs_human), triplet append-only, cantități „arbitrat de Claude” fără promovare automată,
  audit 100% text_propus + anomalii separator + 10% aleator (min. 20), pornire doar la comanda owner / responsabil, plafon 15 $ / rulare.
  Corecție MinerU: greutățile sunt DEJA în `C:\Users\Gazpet-Ai\Documents\Codex\2026-10-10\git\work\extra_model_mineru` (4,4 GB) —
  se referă calea existentă, fixată prin SHA-256; D3c = doar adaptarea pipeline-ului (azi un singur endpoint + prompt dots înghețat).

## „Da”-uri în așteptare (Răzvan le scrie EXACT în sesiunea executantă)
- **D2** `da D2: triere comun pentru documentele 532, 522, 1247 și 772 pe licitația 102, după preview`
  — SCHIMBAT față de varianta „1247 și 772” din spec: 532 (fișa de date) și 522 (detalierea criteriilor) trebuie și ele `comun`,
  altfel poarta blochează „Refă trierea” pe 102 (toate cele 507 documente sunt încă `lot_stare = necunoscut`). **Preview-ul D2 se
  reface în sesiunea nouă** (SELECT pe cele 4 documente, apoi `fn_ofertare_documente_lot_seteaza` cu `p_nota`, RETURNING).
- **D3a** `da D3a: apply migrarea OCR local <nume> cu SHA <sha256>` (după GO Copilot conv. 3 + Jakarinos)
- **D3b** `da D3b: deploy edge ofertare-ocr-cerere, ofertare-pdf-link, ofertare-ocr-scrie, ofertare-ocr-arbitreaza și secretul OCR_LOCAL_SECRET`
- **D3c** `da D3c: adaptează pipeline-ul la LightOn + MinerU`
- **D4** `da D4: scrie nota de proiectare pentru blocuri`
- **Pornire** `da pornire OCR local pe 102, plafon 15 USD, fereastră GPU <interval>`
- **Promovare** `da promovare OCR local pe 102 pentru rularea <id>, după audit`

## Starea licitației 102 (Botoșani CN1096645, depunere 30.10.2026, participăm Lot 2 + Lot 3)
- `are_loturi`; L1 Coșula–Săveni, L2 Săveni–Darabani, L3 Stăuceni–Ștefănești, L4 Dorohoi–Darabani.
- 507 documente / 3.435 pagini, **toate netriate**; 1.447 pagini necitite (#1247: 1.251, #772: 196).
- Triere personal afișată = cea din 24.09 (veche); re-trierea cere D2, apoi „Refă trierea” (cost AI).
- Factorul 2 (doc 522): Manager Proiect pe TRANSPORT gaze înaltă presiune — sub 2 = neconform, 2 = 1 p, 3 = 5 p, 4 = 9 p, ≥5 = 13 p,
  +2 p certificat curs manager de proiect (max 15).
- Triere pe loturi (plan #680): ~440 documente pe reguli de cale (folder „1_ Cosula-Saveni-Darabani” = {1,2} mixt, „2_ Stauceni” = {3},
  „3_ Dorohoi” = {4}, lot în nume = {N}), rădăcina + PT-Mem + PT FV = comun, avize / folder mixt cu AI propune → om confirmă.

## De știut
- `run_paw jak`: stdin fără UTF-8 → brief-urile Jakarinos DOAR ASCII (semnalat chatului).
- Clona `gazpet-erp-ofertare` are acum `core.autocrlf = false` (lecția #1707).
- Scrierile în `claude_docs` / `claude_context` din sesiune au fost refuzate o dată și o dată au expirat (`Invalid or expired requestState`).
- Rutine legate de session_015ZQAcg…: niciuna creată în această sesiune.
