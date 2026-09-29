# INCIDENT Audit V2 — „nu se aplică” și excepțiile puse doar de AI închid porțile (FALSE_GREEN)

- **Declanșare:** Copilot, 29.09 ~23:45 (ora RO): „Verificați read-only dacă cele 27 de eliminatorii și 36 de excepții AI sunt doar propuneri sau sunt tratate efectiv ca închideri definitive în poartă… În al doilea caz: incident Audit V2 și alertare internă imediată a lui Răzvan, fără corectări neautorizate.”
- **Verificare:** Claude, read-only, 29.09 ~23:50. **Rezultat: al doilea caz, confirmat.**
- **Corectări:** niciuna, până la decizia lui Răzvan și GO-ul lui Copilot.

## Dovezi (definițiile live, citite din `pg_proc` / `pg_views`)
1. **Poarta server J02, `fn_gate_depunere`** (live din #519). La contorul „neacoperite”, o cerință e socotită acoperită dacă are o acoperire:
   ```sql
   AND NOT EXISTS (SELECT 1 FROM ofertare_acoperire a WHERE a.cerinta_id = c.id
         AND (a.status = 'nu_se_aplica'
              OR (a.status IN ('acoperit','acoperit_partener') AND a.verificat_pe_scan AND NOT COALESCE(a.reverificare_ceruta, false))))
   ```
   Ramura `nu_se_aplica` nu verifică actorul (`raspuns_de` / `ales_de` / `verificat_de`). Un „nu se aplică” scris de scriitorul AI (`ofertare-acoperire/core.ts:360-371`: `referinta_text = motiv`, fără scor, fără scan, fără actor) **închide cerința pentru poartă, inclusiv pe eliminatorii**.
2. **Poarta UI, `v_ofertare_pt_stare`.** Formula e:
   ```
   fara_capitol = count(*) FILTER (WHERE NOT are_capitol AND NOT exceptata AND NOT dovedita AND NOT propusa)
   ```
   Deci o excepție (`ofertare_pt_legaturi.fel='exceptat'`) scoate cerința din rândul „fără capitol”. Pe Jilava sunt 36 de excepții, toate `sursa='ai'`, 0 confirmate de om. Rândul „fără capitol” arată 0, adică `ok`, deși nimeni n-a decis nimic.

## Expunere (licitații active, `nu_se_aplica` fără niciun actor uman)
| Licitație | Termen (ora RO) | „nu se aplică” doar AI | din care eliminatorii |
|---|---|---|---|
| 93 Jilava | 02.10 12:00 (intern; oficial probabil 06.10 15:00) | 218 | 27 |
| 15 Răcari | 12.10 15:00 | 629 | 74 |
| 3 Mânăstirea | 14.10 15:00 | 60 | 60 |
| 103 sandbox (clona Domnești) | — | 336 | 107 |
| celelalte 7 active | — | 0 | 0 |

**Jilava:** depunerea merge pe derogarea J05, care ocolește J02 oricum. Riscul practic nu e poarta, ci **dosarul**. Eliminatoriile închise greșit de AI pot lipsi din pachet:
- acordul F4 ELCAS;
- DUAE-ul subcontractantului;
- garanția de participare;
- conformitatea materialelor.

Detaliile sunt în `JILAVA_LISTE_LUCRU_2026-09-30.md` (A1).

**Răcari și Mânăstirea:** pe traseul normal, fără derogare, J02 ar socoti acoperite 74, respectiv 60 de eliminatorii fără ca un om să le fi văzut.

## Ce NU s-a făcut (conform limitei lui Copilot)
- Nicio corectare de date: nu am șters și nu am redeschis niciun „nu se aplică”.
- Nicio schimbare de funcție sau view: freeze-ul pe Ofertare rămâne până după 02.10.

## De decis (Răzvan + GO Copilot)
1. **Remedierea în cod, după 02.10**, pe ordinea A. J02 și poarta UI acceptă „nu se aplică” și excepțiile doar dacă le-a confirmat un om: actor + moment, legate de versiunea cerinței. AI-ul poate doar propune.
2. **Datele existente:** listă pe licitație cu cele „nu se aplică” și excepțiile doar AI, pentru confirmare umană, în ordinea eliminatoriilor. Nu se face redeschidere automată în bloc.
3. **Jilava acum:** verificarea umană a listei A1 înainte de asamblarea pachetului, chiar dacă J05 ocolește poarta.
