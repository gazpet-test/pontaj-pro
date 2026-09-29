# MODUL_OFERTARE_EXIT_REPORT: PowPatroll (DRAFT, 29.09.2026)

Stare: **DESCHIS**. Documentul se închide numai când toate criteriile Copilot sunt îndeplinite. Actualizat de Claude.

## 1. Ce am demonstrat (cu dovadă live sau test)
| Finding / control | Dovadă | Unde |
|---|---|---|
| Tranziții de pachet impuse pe server (JAK-V2-01) | #515 live; matrice propus→aprobat→depus, timpii puși de server | `20260928o` |
| RLS scriere + service_role restrâns | #516 live | `20260928p` |
| `depusa` cere pachet PT depus + ≥1 cerință (JAK-V2-03) | #519 live (J02) | `20260929a` |
| Poarta de rol pe 4 edge + 4 api (JAK-V2-05/06) | #521 live; smoke 16/16 (8×403 fără modul; cu modul: validare, 0 AI, 0 scrieri) | `_shared/poartaOfertare.ts` |
| Audit append-only pentru derogare (J05) | #522 live; smoke non-owner (403) + owner (acordare/retragere în audit; UPDATE/DELETE refuzate chiar ca postgres) | `20260929b` |
| JAK-V2-02 reprodus (izolat) | reproducere pe live, rollback total | `REPRO_JAK_V2_02_2026-09-29.md` |
| Fix JAK-V2-02 (J04) scris și testat | PG16 23/23 cu toate triggerele active; Copilot GO pe cod | #524 (HOLD) |

## 2. Ce NU am demonstrat încă
- J04 **live** (merge + deploy edge + apply + smoke A→B pe 103), după 02.10.
- P2 black-box: 4/51 faze configurate; rularea live e blocată până la GO Copilot pe planul J06b.
- P3: 12 controale BLOCK există doar în UI (J07 propus). Până la J07, un client cu modul care scrie direct prin API le ocolește.
- Criteriile Copilot încă deschise: invalidare downstream la schimbări upstream; snapshotul aprobării legat de versiunile exacte; AI-only ≠ verde final pe toate verigile; clarificări cumulative idempotente; concurență pe operațiile critice.

## 3. Limitări acceptate (cu cine a decis)
- Jilava 02.10: depunerea poate trece prin derogare owner (Răzvan), auditată de J05; pachetul se verifică manual (fără J04 live).
- R5/R12 pe clona 103 blochează independent; reproducerea JAK-V2-02 a fost izolată tranzacțional (formularea Copilot).

## 4. Fixture-uri
- Clona 103 `SANDBOX-V2-DOMNESTI` (ground truth: dosarul depus Domnești, 57 fișiere).
- Jilava id 93 (real, doar citire).
- Conturi de test: `test.fara.modul`, `test.ofertare` (după închidere: dezactivate, fără module, parolă rotită; nu șterse).

## 5. Commit-uri / migrări / edge
#515, #516, #519, #521, #522, #523, #514, #518→#525, #520; #524 (HOLD), #526 (draft).

## 6. Teste care protejează rezultatul
`scripts/pg/test_jakv2*` (PG16), `scripts/audit-v2/*` (123), `src/ofertarePachet.caracterizare.test.js` (M03), CI `verifica` (repo ↔ edge).

## 7. Criteriile de semnare Copilot (29.09, după planul Claude)
Ordinea după 02.10: **J04 apply + smoke → J07 apply + smoke → P2 final**.
P2: nu se cere 51/51. Fiecare fază neexecutată are una dintre justificări: (1) acoperită de un test black-box echivalent, (2) acoperită de un invariant server demonstrat + test adversarial, (3) NOT_APPLICABLE pe fixture. O tranziție critică fără probă echivalentă ⇒ **P2 PARTIAL, MODULE NOT YET CLOSED**.
Black-box obligatoriu pe lanț: cerințe (versiunea curentă) → clarificare/rezolvare → dovadă → PT/versiune → pachet → obiect final/hash → aprobare → depunere/derogare.
Pentru semnare mai trebuie:
- [ ] invalidare upstream→downstream **demonstrată** (aprobi, schimbi în amonte, verdele vechi blochează);
- [ ] snapshotul aprobării pe versiuni/hash-uri (cerințe, clarificări, dovezi, cantități, grafic, PT, artefacte);
- [ ] concurență reală: două sesiuni pe aprobare/pachet/manifest/depunere;
- [ ] retry/idempotență: clarificări/supersession, revizii de cantități, verificare hash, aprobare pachet, depunere;
- [ ] J04 live pe 103, A→B complet;
- [ ] J07 live pe 103: cele 12 BLOCK; parser/hash/rezultat stale = BLOCK; UI reflectă serverul;
- [ ] Jilava 02.10: dovada lanțului real, derogarea auditată, cu invariantul ocolit numit;
- [ ] 0 BYPASS / 0 FALSE_GREEN critice/high; pe eliminatorii 0 CONFLICT / UNDETERMINED / MISSING_LINK nerezolvate;
- [ ] CI pentru invarianții critici; ce rămâne manual e etichetat;
- [ ] secțiune separată „NOT PROVEN”: ori limitare acceptată explicit de Răzvan, ori modulul rămâne parțial.
