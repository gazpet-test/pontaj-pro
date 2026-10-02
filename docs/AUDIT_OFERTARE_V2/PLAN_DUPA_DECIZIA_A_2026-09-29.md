PowPatroll — plan după decizia A (29.09.2026)

## Context (Copilot nu are acces la repo/BD)
- **Ofertare**: modulul ERP care duce o licitație SEAP până la artefactul depus. Ținta Audit V2: fără fals verde, fără bypass, fără pierdere de provenance.
- **Jilava** (licitația 93, PT93): depunere pe **02.10.2026, ora 12:00**. Până atunci producția Ofertare e înghețată: fără merge, apply, deploy sau SQL de scriere. Operațiunile de dosar făcute de oameni în UI continuă.
- **103**: clona Domnești, izolată. Smoke-urile și replay-urile rulează doar aici.
- **J04 (#524)**: SHA-256 calculat pe server pentru pachet, dovadă append-only și trigger aprobat→depus. Edge `ofertare-pachet-verifica`. GO pe cod, stă pe HOLD.
- **J05**: derogare owner, append-only, cu motiv. E live.
- **J07 (#527)**: 12 controale care acum există doar în UI (deci se pot ocoli prin API) trec pe server. Lipsă, stale sau eroare = BLOCK. Edge `ofertare-poarta-text`. GO pe cod, stă pe HOLD.
- **QW0 (#530)**: repară falsul verde „dovedită” (pe PT93, UI arată 128, iar R06 arată 0). GO pe cod.
- **P2 (#526)**: harness de replay pe 103, cu 149 de teste. Face T0 pe DB și Storage și se oprește la FALSE_GREEN, BYPASS sau la orice scriere în afara 103. GO pe rulare, amânat de Răzvan.
- **Decizii ale lui Răzvan**:
  - #1487, ordinea A: J04 → J07 → QW0 → P2 → invalidare/snapshot/concurență → EXIT REPORT;
  - #1486: principiile Context Registry.
- **Regulile casei**:
  - orice automatizare are o fișă (a)–(e) în `registru_automatizari`: conținutul extern citit, scrierile, identitatea, cine o pornește, confirmările;
  - datele reale trec prin preview → confirmarea lui Răzvan → apply;
  - drepturile și mailurile externe se fac doar la cererea lui.

## 0. Neconcordanțe
1. EXIT REPORT e depășit:
   - §7 și §8 au ordinea B;
   - §2 spune „P2 blocat până la GO J06b”, deși GO-ul s-a dat;
   - §6 spune 123 de teste.
   Se corectează în PR-ul de docs (Q3, Q10).
2. P2 poate cere un provider de supraveghere, adică un RPC nou și deci schemă. Ordinea A nu-l conține, așa că Q5 rămâne deschisă.
3. `handoff_activ` a rămas la v5 (28.09). Actualizarea e obligatorie la finalul sesiunii.
4. #526: body-ul spune 123 de teste, handoff-ul spune 149. Se reconfirmă înainte de P2.

## 1. Până la 02.10 12:00: Jilava
Termenele sunt propuse de Claude și le confirmă Răzvan. Oana nu le-a acceptat încă.

| # | Ce | Cine | Termen | Dovada |
|---|---|---|---|---|
| 1.1 | Cele 280 de cerințe neverificate de om se verifică rând cu rând în UI, **nu în bloc** | Răzvan (+ de stabilit) | 02.10, 10:00 | Contorul porții scade. Ce rămâne intră pe o listă nominală de risc, acceptată de Răzvan |
| 1.2 | Scanuri PV Bălăceanca, Poiana, Butimanu și cazierul administratorului (TKT-2026-0305; acum 0 documente) | Oana | 01.10, seara | Fișiere atașate și verificate de un om pe scan |
| 1.3 | Experiența similară, cerințele 11–12 (TKT-2026-0301) | Oana | 01.10 | Confirmare în tichet |
| 1.4 | Autorizația nouă de laborator ELCAS lipsește. Pe 4087, `referinta_text` spune încă „expirat” | Răzvan decide mailul, Claude îl redactează la cerere. Textul de pe 4087 îl corectează un om, din UI (prin SQL ar fi scriere în Ofertare, interzisă acum) | 01.10 | Fișier pe 4928/6208, textul 4087 verificat |
| 1.5 | Verificare read-only pe lista Copilot: poartă, `v_ofertare_pt_stare`, R5/R12, H1/H9/H10/H11, pachet, provenance | Claude | 30.09 | Raport și SQL de re-rulare |
| 1.6 | Re-rulare și delta față de 29.09, plus citirea read-only a `termen_depunere` pe 93 | Claude | 02.10, 08:00 | Delta cu blocajele numite. Copilot o citește înainte de depunere |
| 1.7 | Ziua depunerii (pașii mai jos) | (a) Claude sau Răzvan; (b–d) Răzvan; (e) Claude | 02.10, 12:00 | Raportul Jilava final |

Pașii din ziua depunerii:
- (a) Calea, mărimea și SHA-256 pentru fișierele finale se trec în raportul Jilava, nu în schemă. E o compensare până la J04.
- (b) Încărcarea în SEAP.
- (c) Salvarea dovezii SEAP.
- (d) Dacă poarta refuză „depusă”: derogare J05, cu motivul care numește invariantul ocolit.
- (e) Verificare read-only: auditul J05, starea, hash-urile.

## 2. După 02.10: ordinea A
**Porți comune:**
1. GO de la Copilot și acordul lui Răzvan pe merge/apply.
2. T0 pe 103 înainte de smoke. După smoke: diff față de T0, 0 scrieri în afara 103, doar conturi de test.
3. Fiecare edge nou are fișa (a)–(e) și verificare de rol în cod. `verify_jwt` nu ajunge: și cheia anon e un JWT valid.
4. Ordinea: apply migrare → `get_advisors` → deploy edge → merge → `verifica` verde.

**J04 (#524)**
- Precondiții:
  - suntem după 02.10 12:00 și 1.7(e) e gata;
  - branch-ul e rebazat pe main (acum e cu 14 commit-uri în urmă);
  - Q4 e decisă;
  - fișa pentru `ofertare-pachet-verifica` e completată.
- Smoke: CI verde, sau `verifica` roșu explicat. PG 23/23. Pe 103: A → verify PASS → înlocuire cu B → depunere REFUZ → reverify B → PASS.
- Rollback: `_ROLLBACK.sql`, revert, retragerea edge-ului.

**J07 (#527)**
- Precondiții: J04 e live și fișa pentru `ofertare-poarta-text` e completată. La rebase, în „Marchează depus”:
  - ambele verificări (hash-ul J04 și `citestePoartaServer`) rămân înainte de `stare='depus'`;
  - stale se decide prin hash, nu prin timestamp;
  - o eroare internă = BLOCK.
- Smoke: toate cele 12 controale dau BLOCK pe 103. O scriere directă prin API e refuzată. Parser, hash sau rezultat stale = BLOCK. UI-ul afișează verdictul serverului.
- GO: Copilot face re-review pe rezolvarea conflictului.
- Rollback: ROLLBACK, revert, retragerea edge-ului.

**Igienă după J07**
- PR separat, nu e pas din A. Locul în ordine îl aprobă Răzvan.
- Conține: REVOKE TRUNCATE pentru `authenticated` pe pachet, poartă și licitații; S09-11 (`.delete()` care eșuează tăcut); diff-ul `fn_ofertare_pt_pachet_poarta_documentatie` între repo și live.
- Dovada: `has_table_privilege('authenticated',…,'TRUNCATE')=false` pe toate 3 tabelele. Testul S09-11 trece din roșu în verde. Diff repo↔live = 0.

**QW0 (#530)**
- Precondiții: J07 e live. La rebase, citirea porții de pe server se mută în `citesteDatePT`, fail-closed: o eroare blochează, nu dă listă goală.
- Smoke:
  - paritatea NULL e verde (36 de combinații);
  - pe PT93, „dovedite” = R06;
  - o eroare simulată afișează banner, fără verde.
- Dacă Q7=A, în plus: o eroare auxiliară lasă pagina read-only, cu banner, iar aprobarea și semnarea sunt inactive; F9 nu golește selecția; Copilot face re-review pe tot diff-ul.
- Rollback: revert (e doar UI).

**P2 (#526)**
- Precondiții:
  - J04, J07 și QW0 sunt live.
  - Providerul intră **doar dacă Q5=A**: PR separat, RPC read-only doar pentru owner, fișă în registru (rulează peste RLS, deci trebuie justificat), GO Copilot, acordul lui Răzvan. Dacă Q5=B, fazele lui trec la NOT PROVEN.
  - Harness-ul are fixture-uri de rețete, auto-răspuns la dialoguri, `caleSandbox=103/` și `cdp_target_id`. Selectorii și ground truth-ul pe 103 le face Miloi.
  - Numărul de teste e reconfirmat. T0 e luat.
- Între T0 și raportul P2 nu se face niciun deploy pe Ofertare. Rularea o pornește Răzvan.
- GO: 0 FALSE_GREEN și 0 BYPASS. Fiecare fază neexecutată are una din trei justificări: (1) un test black-box echivalent, (2) un invariant de server demonstrat plus un test adversarial, (3) NOT_APPLICABLE pe fixture. Fără justificare, P2 e **PARTIAL**.
- Rollback: diff față de T0. O scriere în afara 103 înseamnă stop și incident.

**Invalidare / snapshot / concurență**
- Designul îl face Jakarinos, cu GO Copilot.
- Dovezi:
  - PG adversarial: aprob → schimb în amonte → verdele vechi blochează;
  - snapshot pe versiuni și hash-uri;
  - 2 sesiuni pe aprobare, pachet, manifest și depunere;
  - retry idempotent pe clarificări/supersession, revizii de cantități, verificare hash, aprobare și depunere;
  - inventarul „AI-only ≠ verde final” pe toate verigile;
  - testul „cantitate neverificată ≠ fapt”.

**Înainte de EXIT REPORT**
- CI pentru `scripts/audit-v2` și `supabase/tests`, cu job verde pe main.
- Verdict pe fiecare id (CONFIRMED sau închis, cu dovadă) pentru S03-01, S05-01/02/03, S06-01/02 și S08-02 (Claude).

**EXIT REPORT**
- Secțiunea „NOT PROVEN” completată.
- Dezactivarea `test.fara.modul` și `test.ofertare` (preview, apoi acordul lui Răzvan).
- Reverificarea ramurii seap-import cu secret.
- Verdictul Copilot și semnătura lui Răzvan pe limitări.

## 3. Piste paralele
Nimic din ce urmează nu atinge Ofertare înainte de 02.10. Responsabilii sunt propuși și rămân de confirmat.

- **Conturi** (R1: cont legat automat de fișă · R2: contract încetat → cont închis · R3: fost angajat ca extern)
  - `git pull --ff-only` pe `claude/erp-continuare-x4p5a7` înainte de orice edit.
  - Garda server-side „alt contract activ” pe R2 nu apare la grep în `20260929d`. Trebuie verificată sau implementată, cu test.
  - R1 nu se aplică cât timp înscrierea publică e pornită. Răzvan confirmă în Dashboard că D1=B e efectiv.
  - Dovada: testul gărzii trece. Testele R1, R2 și R3 rulează local, cu log la PR.
  - Traseu: D1–D6 → GO → Răzvan → apply → DML G.5/G.7 cu preview → fișă în registru.
- **#529**
  - Două PR-uri: docs (0 fișiere în `src/`/`supabase/`) și conturi.
  - Pe main doar după 02.10 12:00, cu excepția Q2=C.
- **Context Registry**
  - Respectă cele 5 principii #1486, printre ele: doar owner, decizia o ia doar Răzvan în chat, PAS 0 din BD.
  - Un tabel nou înseamnă schemă, deci cerere explicită.
- **Reguli de motor** (#1482, #1481, C.7)
  - Cazier pentru firmă și pentru fiecare administrator. PV legate de experiența aleasă. Anexa de personal fără nume. ATSD în loc de INSEMEX.
  - Traseu: spec → GO Copilot → Jakarinos. Locul în ordine: Q6.
- **Non-blocker pe #530** (Miloi, Jakarinos; Q7): read-only cu banner, `referinta_text` versionată, regresul `loadEchipa = load`.
- **Quick Wins PT**
  - Ordinea: QW10 + QW2/QW8 → QW3 + QW5 → QW7 + QW1 → QW4 → QW9.
  - Vin după QW0, fiecare cu GO. Poziția exactă: Q11.
  - QW4 atinge schema, deci cere aprobarea lui Răzvan.
  - QW4 și QW8 (RPC extins) → Jakarinos. Restul → Miloi.
- **Workspace V2**: doar prototip. Dovada e raportul de clickuri (a)–(g) pe 103. GO pe direcție, HOLD pe producție.
- **Verificatorul de citate**: dă doar candidați. Înainte de producție, evaluare oarbă pe Domnești și Jilava.
- **`vicare`** (edge-ul Clădire/IoT din cauza căruia `verifica` e roșu): diff între repo (28.09, 23:35) și live v9, apoi alegem versiunea canonică (Q4).
- **seap-veghe**: scrierea `termen_depunere` se exersează pe 103, după 02.10.
- **Todo-uri** #1188, #1198, #1423, #1424, #1432, #1436, #1438, #1442, #1443, #1444: listă pe fiecare id (închis / înlocuit-de / păstrat). UPDATE doar după confirmare, cu RETURNING.
- **Tichete 0303, 0304, 0306**: fix-ul local îl face Claude. Pentru 0304, care poate cere un tabel nou, întreb A/B/C. Dovada: PR, build și `descriere_interventie`. Deploy-ul depinde de Q2.

## 4. Întrebări pentru Răzvan
- **Q1.** Tichetele lui Sorin Ioan (0154 și 0157; contul lui e închis):
  - A: le reasignez, cu preview
  - B: le închid ca depășite
  - C: aștept R2
- **Q2.** Deploy și migrări până pe 02.10, 12:00:
  - A: niciunul
  - B: doar non-Ofertare, cu 0 fișiere Ofertare* și fără `App.jsx` sau routing (Vercel republică tot bundle-ul)
  - C: doar docs
- **Q3.** #529:
  - A: split (recomandat)
  - B: merge întreg după GO pe conturi
- **Q4.** `vicare`:
  - A: deploy după diff
  - B: după 02.10
  - C: `verifica` rămâne roșu
- **Q5.** Providerul pentru P2:
  - A: PR separat, înainte de P2
  - B: fără provider, cu NOT PROVEN
- **Q6.** Regulile de motor:
  - A: după EXIT REPORT
  - B: PR paralel pe HOLD, fără apply până la EXIT REPORT
  - C: schimbi ordinea A și le inserezi după QW0 (decizie nouă, consemnată)
- **Q7.** Observațiile non-blocker pe #530:
  - A: în același PR, cu re-review complet
  - B: PR separat, imediat după
- **Q8.** Confirmi deciziile pentru conturi?
  - D1: B acum (înscriere publică OFF), C mai târziu (edge `cont-nou` cu poartă owner)
  - D2: `test`
  - D3: A (doar alertă)
  - D4: Da
  - D5: Da
  - D6: Da pentru `department`
- **Q9.** ELCAS: redactez mailul către Mădălina, iar trimiterea o decizi tu? Dacă autorizația nu vine până pe 01.10, ce alternativă folosim pe 6208/6209?
- **Q10.** Corectez EXIT REPORT (§2, §6, §7, §8) în PR-ul de docs?
- **Q11.** Quick Wins:
  - A: după P2
  - B: după invalidare
  - C: după EXIT REPORT

## 5. Riscuri și ce NU facem
**Riscuri:**
- conflictele J04×J07 și J07×QW0: o verificare pierdută sau un fals verde reintrodus;
- ELCAS/4087;
- 280 de cerințe;
- `termen_depunere` neexersat;
- teste în afara CI;
- `handoff_activ` vechi.

**NU facem:**
- scrieri pe Ofertare înainte de 02.10, 12:00;
- confirmări în bloc (cerințe, citate „după scor”);
- exploit-uri pe date reale;
- P2 înainte ca J04, J07 și QW0 să fie live (plus providerul, dacă Q5=A);
- conturi fără D1–D6, GO Copilot și acordul lui Răzvan;
- tichete, drepturi sau todo-uri schimbate fără preview;
- mailuri externe fără cererea lui Răzvan;
- merge cu `verifica` roșu neexplicat;
- finding-uri închise redeschise fără dovadă nouă.

## 6. Criterii „MODUL ÎNCHIS”
| Criteriu | Stare | Pasul care îl închide |
|---|---|---|
| Replay 103 + Jilava | PARȚIAL | P2, 1.7 |
| 0 BYPASS / 0 FALSE_GREEN | PARȚIAL | J07, QW0, P2 |
| Aprobat/depus impuse pe server | PARȚIAL (#515, #519 live) | J04, J07 |
| Hash end-to-end, artefact depus | PARȚIAL | J04 |
| Invalidare, snapshot, clarificări versionate, retry/concurență | NEÎNCEPUT / NEDEMONSTRAT | Invalidare |
| AI-only, cantități neverificate | De verificat | Inventar + test |
| Permisiuni fail-closed | DEMONSTRAT | Igienă TRUNCATE |
| Derogări auditabile | DEMONSTRAT (J05) | — |
| Eliminatorii fără CONFLICT/UNDETERMINED/MISSING_LINK | De verificat | Raportul Jilava |
| Teste critice în CI | PARȚIAL | Pasul CI |

## Întrebări pentru Copilot
1. **Ordinea J04/J07.** Ordinea propusă e apply migrare → `get_advisors` → deploy edge → merge. Scenariu: migrarea e aplicată, edge-ul nu, iar cineva apasă „Marchează depus”. Accepți un refuz fail-closed în fereastra asta, sau ceri altă ordine? Ce dovadă ceri între pași?
2. **Conflictul J04×J07.** Propunem trei teste: hash-ul trece, dar poarta de pe server dă BLOCK; poarta e indisponibilă; hash-ul se schimbă după verify. Împreună cu rezolvarea propusă, ajung pentru GO pe merge?
3. **P2 cu Q5=B.** Accepți P2 PARTIAL, cu justificările (1)–(3), ca bază pentru EXIT REPORT? Ce faze trebuie executate obligatoriu, nu doar justificate?
4. **Jilava ca dovadă reală.** Dacă depunerea trece pe derogare J05, ajung hash-urile locale, dovada SEAP și auditul J05, sau marchezi Jilava drept limitare?
5. **TRUNCATE față de P2.** P2 caută BYPASS, iar TRUNCATE pentru `authenticated` e deschis. Igiena e precondiție pentru P2 (NO-GO fără ea), sau poate rămâne PR separat după J07?