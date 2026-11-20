# Administrativ → Unități protejate: contribuția calculată după răspunsul expertului contabil (20270101a)

Decizia owner-ului (20.11.2026): contribuția pentru fondul de handicap se **calculează** în platformă după răspunsul expertului contabil,
în locul plafonului fix din setări (7.000 lei). Migrarea `20270101a_administrativ_upa_calcul` (NEAPLICATĂ) + ecranul + edge-ul v11.
Contextul (alerta, jurnalul, drepturile, bucketul) rămâne cel din `docs/administrativ/UPA_FOND_HANDICAP.md` (20261229a / b / c).

## Răspunsul expertului (date, 20.11.2026)

1. Salariul minim brut pe țară: 4.325 lei de la 1 iulie 2026; se schimbă în timp, deci **valori pe perioade**.
2. Achizițiile de la unitățile protejate se deduc la valoarea **fără TVA**.
3. Numărul mediu de angajați (NMA) = Σ pe angajați (zile calcul − zile CFS − zile suspendare) × normă / durata normală, împărțit la zilele
   calendaristice ale lunii; zile calcul = zilele lunii minus cele dinaintea angajării și de după încetare. Administratorii se scot.
   Calculul exact se face după înregistrarea pontajelor; înainte, doar previziuni.
4. De plată la stat = suma datorată − achizițiile (fără TVA). Achiziții < jumătate din suma datorată → se plătește diferența întreagă.
   Achiziții > jumătate → se plătește jumătate din suma datorată, iar diferența se reportează pe lunile următoare. Plata la stat până pe 25
   a lunii următoare; plata către unitatea protejată până la sfârșitul lunii pentru care se calculează.

## Formula (o singură definiție: `fn_upa_calcul_la`, în BD)

| Pas | Ce | Sursa în ERP |
|---|---|---|
| zile calcul | zilele lunii între `employees.hire_date` și `employees.termination_date` (ziua încetării inclusă, ca în `src/pontajOreSuplimentare.js`) | `employees` |
| CFS | zilele cu codul de pontaj `CFP` (concediu fără plată) | `pontaj_records.norma` |
| suspendare | zilele cu codul de pontaj `SUSP` (cod **nou propus**, vezi „Ce lipsește”) | `pontaj_records.norma` |
| normă | `employees.procent_ocupare / 100` (= ore normă / 8 ore, durata normală); NULL = 100% cu avertisment | `employees` |
| administratori | scoși: `hr_decizii_semnatari` activ cu calitatea „Administrator” | `hr_decizii_semnatari` |
| NMA | Σ (zile calcul − CFS − suspendare) × normă / zilele lunii, rotunjit la 2 zecimale | — |
| locuri neocupate | max(⌊4% × NMA⌋ − angajați cu handicap, 0); 0 dacă NMA < 50 (art. 78) | `upa_parametri.angajati_handicap` |
| suma datorată D | locuri × 50% × salariul minim al lunii (rotunjit la bani) | `upa_parametri.salariu_minim` |
| achiziții A | Σ `upa_achizitii.valoare_fara_tva` ale lunii, cu `data_plata` ≤ ultima zi a lunii | `upa_achizitii` |
| report intrat | reportul ieșit al lunii anterioare închise; la prima lună a calculului = `report_initial` | `upa_calcul_lunar`, `upa_parametri` |
| deducere | min(A + report intrat, D / 2) | — |
| de plată la stat | D − deducere, până pe 25 a lunii următoare | — |
| report ieșit | A + report intrat − deducere | — |

Cazurile expertului, verificate în proba PGlite cu valori calculate de mână:
- **Peste jumătate:** D = 4.325, A = 3.000. De plată 2.162,50, report 837,50.
- **Report consumat:** în luna următoare, report 837,50 + 500 = 1.337,50 < 2.162,50. Se deduce tot, nu rămâne report.
- **Sub jumătate:** A = 1.000. De plată 3.325, report 0.

Tot în proba PGlite: angajatul intrat la mijloc de lună, norma parțială, CFS, suspendarea, administratorul, angajatul încetat, cel inactiv fără dată de încetare și firma sub 50 de angajați.

## Stări

- **Previziune:** cât pontajul lunii nu e închis. Corecturile libere țin până pe 12 a lunii următoare (`src/pontajLunaInchisa.js`), deci pontajul e închis de pe 13.
  - Luna în curs numără și facturile încă neplătite: se presupune plata la termen, cu avertisment.
  - După ultima zi a lunii se numără doar facturile plătite până în ultima zi.
- **Închis (exact):** din 13 a lunii următoare, luna se închide o singură dată în `upa_calcul_lunar`, cu detaliul pe angajat în `upa_calcul_angajat` (ambele nemodificabile), dacă nimic nu blochează.
  - Închiderea o face rularea zilnică a alertei sau un editor, din ecran („Închide calculul”).
  - Lunile se închid în ordine.
- **Blocaje** (luna nu se închide, iar owner-ul și Administrativ / UPA primesc zilnic notificarea `calcul_neinchis`):
  - facturi fără valoarea fără TVA;
  - facturi fără data plății (după ultima zi a lunii);
  - salariul minim sau numărul angajaților cu handicap neînregistrat;
  - luna anterioară neînchisă.
- **Avertismente** (se văd, nu opresc închiderea):
  - facturi plătite după termen (nu intră în deducere);
  - angajați fără data angajării sau fără normă;
  - angajați inactivi fără data încetării, dar cu pontaj în lună.

## Plafonul fix de 7.000 lei: scos din calcul

Plafonul din setări nu mai e citit de alertă și nici de ecran. Îl înlocuiește deducerea calculată: jumătate din suma datorată, minus reportul. De ce nu l-am păstrat nici ca rezervă:
- O valoare fixă se depărtează în tăcere de cea legală. Cu NMA ≈ 64 ies 2 locuri, deci D = 4.325 și o deducere maximă de 2.162,50 lei/lună, nu 7.000.
- O rezervă care „merge” când lipsesc date ar ascunde lipsa (L18). Când lipsește o intrare, calculul arată „incomplet” și spune exact ce lipsește.

Tabelul `upa_plafon_lunar`, `fn_upa_luni` și `fn_upa_plafon_seteaza` rămân neatinse: le folosește doar ecranul vechi, până la merge. Retragerea lor se face într-o migrare separată, după deploy (regula „retragerea unui drept folosit de clientul vechi = separat”).

## Ce lipsește din ERP (și propunerea)

| Lipsă | Acum | Propunere |
|---|---|---|
| Suspendările contractului (creșterea copilului, suspendări disciplinare, detașări) | nu există nicio evidență; calculul citește codul de pontaj `SUSP`, pe care încă nu-l pune nimeni | A) codul `SUSP` în lista de pontaj (App.jsx, exporturile BRUT / NET), PR separat; sau B) un tabel HR de suspendări cu interval (mai bun la suspendările lungi) |
| Numărul angajaților cu handicap | nu există niciun câmp (e o dată de sănătate) | parametru pe perioade în ecran (`angajati_handicap`); până se înregistrează (și 0), calculul e blocat |
| Istoricul normei (acte adiționale) | doar norma de azi (`employees.procent_ocupare`); există și `employee_salaries.work_hours_per_day`, folosit doar la exportul NET | o schimbare de normă în cursul lunii nu se vede; propunere: normă cu dată de la care se aplică |
| Administratorii | doar semnatarii deciziilor HR (`hr_decizii_semnatari`, „Administrator”), fără istoric | dacă administratorul are contract de mandat (nu CIM), e oricum în afara calculului; altfel un câmp „administrator” cu perioadă |
| Închiderea pontajului | nu există lacăt în BD; regula e „corecturi până pe 12” (doar în UI) | o corectură după 12 (prin tichet HR) nu schimbă calculul închis; propunere: lacătul de pontaj din runda 2 (trigger) |
| Valoarea fără TVA și data plății pe facturile vechi | coloane noi, goale | se completează din ecran (lista achizițiilor, „fără TVA?” / „plătită ✓”); octombrie 2026 se poate închide doar după completare |
| Salariul minim înainte de 01.07.2026 | neînregistrat (doar valoarea confirmată de expert e pusă) | dacă se calculează luni dinainte, se adaugă din ecran (4.050 lei în 2025–06.2026, de confirmat) |

## Întrebări pentru expert (decizii luate în cod, de confirmat)

1. Rotunjirea: ⌊4% × NMA⌋ (în jos, la întreg), iar NMA cu 2 zecimale. E corect? Suma datorată se rotunjește la leu în declarație?
2. Ziua încetării contractului se numără (inclusiv)?
3. Ce coduri de pontaj sunt „suspendare”? Azi doar CFS (`CFP`) și `SUSP` scad. Concediul medical (CM, BO), maternitatea (M) și absențele nemotivate (N) se numără ca zile lucrate. Maternitatea și creșterea copilului?
4. Reportul expiră (de exemplu la sfârșitul anului) sau rămâne nelimitat?
5. O factură plătită după sfârșitul lunii se pierde sau se mută în luna plății? Azi nu intră în deducere și apare ca avertisment.
6. Prima lună a calculului e octombrie 2026, cu report inițial 0. Există un excedent din lunile anterioare?
7. Termenul de 25: când cade într-o zi nelucrătoare, ecranul arată tot 25. Nu calculăm ziua lucrătoare următoare.

## Ordinea livrării (de coordonator, după review și „da”)

1. **Edge-ul `upa-plafon-alerta` v11**, publicat înainte. Merge și cu rezervarea veche: fără câmpul `calcul` trimite mailul în forma v10.
2. **Migrarea `20270101a`** (versiune 20270101120000), prin runner, cu plafon 5000 și amprenta globală L15 v2.
   - Lista obiectelor: `supabase/tests/20270101a_administrativ_upa_calcul.l15.obiecte.tsv`.
   - Lock: `upa_achizitii` ACCESS EXCLUSIVE, pentru cele 2 coloane noi și CHECK.
   - Preflight-ul cere ca cele 12 funcții din 20261229a folosite sau înlocuite să fie EXACT cele revizuite (md5 sursă, drepturi, proprietar).
3. **Merge-ul ecranului.** Ecranul folosește `fn_upa_situatie` și formularul trimite câmpurile noi, deci merge doar după migrare.
4. **Parametrii, din ecran:**
   - numărul angajaților cu handicap (de la 01.10.2026; 0 dacă nu sunt);
   - completarea valorii fără TVA și a datei plății pe facturile din octombrie / noiembrie.
5. Cronul (jobid 29, zilnic) nu se schimbă.

**Revenire:** `supabase/revenire/20270101a_administrativ_upa_calcul_ROLLBACK.sql` (versiune 20270101120001), prin runner cu plafon 2000.
- **Ce face:**
  - reface IDENTIC cele 5 funcții din 20261229a (sursa copiată de `scripts/pglite/upa_calcul_genereaza_revenire.mjs`, verificată prin md5);
  - scoate tabelele, funcțiile și coloanele noi.
- **Când refuză:**
  - o lună închisă;
  - un parametru schimbat sau adăugat din ecran;
  - o achiziție cu valoarea fără TVA sau data plății completate;
  - orice abatere de la amprenta obiectelor.
- **Ordinea:** se face ÎNAINTEA revenirilor 20261229c → b → a. Proba verifică că după ea trec toate trei.
- **Alte componente:** ecranul se retrage înainte. Edge-ul v11 poate rămâne.

## Fișa de securitate (CLAUDE.md pct. 7) — schimbările față de v10

- **(a) Conținut extern:** niciunul. Calculul citește doar BD-ul: pontaj, angajați, semnatari, achiziții, parametri.
- **(b) Ce scrie:**
  - `upa_calcul_lunar` și `upa_calcul_angajat`, o dată pe lună, prin RPC-ul de închidere;
  - jurnalul și notificările, ca înainte;
  - mailul intern conține acum suma de plată, reportul, NMA-ul și numărul de locuri. Fără nume de angajați.
  - Detaliul pe angajat se citește doar de owner (`fn_upa_calcul_detaliu`, politica owner pe `upa_calcul_angajat`).
- **(c) Identitate:**
  - edge-ul folosește `service_role`, neschimbat;
  - funcțiile de calcul sunt interne (fără EXECUTE pentru roluri);
  - ecranul trece prin `fn_upa_situatie`, SECURITY DEFINER, care întoarce doar agregate.
- **(d) Cine pornește:**
  - edge-ul: cronul sau owner-ul, ca în v10;
  - închiderea din ecran: owner + Administrativ / UPA editor sau admin (`fn_upa_poate_scrie`).
- **(e) Confirmare umană:** pentru alertă nu e nevoie. Închiderea unei luni din ecran are confirmare explicită (`confirm`).

## Probe

- `scripts/pglite/test_upa_calcul_local.mjs` (PGlite, schelet Supabase + `supabase/tests/20270101a_administrativ_upa_calcul_schelet.sql`) acoperă:
  - validatorul runnerului;
  - blocul AMPRENTA identic în migrare și revenire, plus sursele refăcute;
  - aplicarea ca la livrare (L15 v2, după 20261229a / b / c);
  - cazurile expertului, stările, blocajele, alerta și edge-ul cu Resend simulat;
  - drepturile ca non-owner;
  - refuzurile migrării și ale revenirii;
  - aplicare → revenire → reaplicare, apoi revenirile c → b → a;
  - 24 de mutanți de comportament, rulați cu amprenta oprită, ca să se vadă că îi prind probele, nu doar amprenta.
- `src/upaAlerta.test.js` (vitest): textele ecranului (stări, coduri, parametri, validări) și mailul pe calcul (închiderea, previziunea, forma veche de rezervă).
