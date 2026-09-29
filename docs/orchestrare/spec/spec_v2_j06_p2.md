# V2-J06 (Jakarinos): P2 BLACK-BOX pe clona 103, pregătire execuție
GO Răzvan (29.09, „pornește P2 în echipa PowPatroll”) + planul Copilot (P2 urcă în prioritate). Tu livrezi COD + PLAN DE RULARE, NU rulezi pe live. Rularea `--apply` o face Claude, după GO de la Copilot.

## Context
- Harness-ul e pe main (#518): `scripts/audit-v2/` (runner `scenariu.mjs`, scenarii 01–16, `verifica_lant.mjs`, `siguranta.js`, `retete.js`, `RETETE_UI.md`, `fixture.json`).
- Clona: `ofertare_licitatii.id = 103`, `nr_anunt LIKE 'SANDBOX-V2-%'`. Fișierele ei stau în bucketul `ofertare`, sub `103/...` (vezi `docs/AUDIT_OFERTARE_V2/00_PLAN_SI_FIXTURE.md` §Copilot pct. 2).
- Poarta live pe 103: R5 blochează `aprobat/depus` (62 de rânduri F3 nevalidate), iar R12 completitudinea (1 document citit parțial). Pentru P2 sunt **date reale ale clonei**, nu obstacole de ocolit: scenariile trebuie să le observe drept REFUZ corect.
- Plan P2 (Copilot): pentru fiecare pas: INPUT → acțiune → scrieri BD → stare server → verdict UI → artefact. Clasificare: IMPLEMENTED_BUT_NOT_USED / UI_ONLY / SERVER_ONLY / FALSE_GREEN / BYPASS / MISSING_LINK (+ MATCH).

## Ce faci
1. **Inconsistențe harness → fix.** `siguranta.js::verificaSandbox` refuză id 5 și cere `SANDBOX-V2-*`: OK. Dar `caleSandbox` cere `sandbox-v2/5/`, iar clona folosește `103/...`. Aliniază-l la `<fixture.licitatie_id>/` (fail-closed: orice altă cale → REFUZ). Actualizează testele.
2. **Retete/selectori:** folosește `RETETE_UI.md` + codul UI (`src/Ofertare*.jsx`) și completează `fixture.retete` DOAR pentru pașii cu traseu demonstrat în cod: P2.01–P2.12 (scenariile 01–12). Selector unic (`text=` exact sau `css=` existent în cod). Pașii fără traseu clar rămân `UNDETERMINED` cu motiv. Nu adaugi atribute în UI.
3. **Scenarii fără cost AI:** marchează fiecare fază cu `cost_ai: true/false`. P2 rulează întâi DOAR fazele `cost_ai:false`. Cele cu AI (recitire/extragere/acoperire/capitole) se listează separat, cu estimare, pentru GO de buget.
4. **Postcondiții reale:** pentru pașii 10 (pachet) și 11 (depunere) postcondițiile trebuie să arate REFUZ server (tranziția nu se produce) cu R5/R12 active, plus rândul de audit J05 unde e cazul. Niciun pas nu se bazează pe „rândul există”.
5. **Plan de rulare** `docs/AUDIT_OFERTARE_V2/P2_PLAN_RULARE.md`: ordinea comenzilor (preview → `--apply`), ce scrie fiecare pas în clonă (tabele, câte rânduri), cum se face rollback / ce rămâne permanent (audit append-only), cost AI estimat per fază, criteriul de oprire.
6. Teste: `node --test` pe tot `scripts/audit-v2/*.test.*` trebuie PASS. Nu rula nimic pe live (nici SELECT-uri); nu folosi service_role.

## Reguli
Lucrezi DOAR în worktree. Nu rula git. Fără producție, fără deploy. La final scrie `C:\Users\Public\jak_j06_rezumat.md`: fișiere, pași configurați / UNDETERMINED, teste, riscuri.
