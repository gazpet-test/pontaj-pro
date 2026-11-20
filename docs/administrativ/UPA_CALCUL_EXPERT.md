# Administrativ → Unități protejate: contribuția calculată după răspunsul expertului contabil (20270101a)

Decizia owner-ului (20.11.2026): contribuția pentru fondul de handicap se **calculează** în platformă după răspunsul expertului contabil,
în locul plafonului fix din setări (7.000 lei). Migrarea `20270101a_administrativ_upa_calcul` (NEAPLICATĂ) + ecranul + edge-ul v11.
Contextul (alerta, jurnalul, drepturile, bucketul) rămâne cel din `docs/administrativ/UPA_FOND_HANDICAP.md` (20261229a / b / c).
Runda 2 (review PR #1154, 8 x P1 + P2) a corectat formula, numărul mediu de angajați, închiderea, tranzițiile și termenul din decembrie.

## Răspunsul expertului (date, 20.11.2026)

1. Salariul minim brut pe țară: 4.325 lei de la 1 iulie 2026; se schimbă în timp, deci **valori pe perioade**.
2. Achizițiile de la unitățile protejate se deduc la valoarea **fără TVA**.
3. Numărul mediu de angajați (NMA) = Σ pe angajați (zile calcul − zile CFS − zile suspendare) × normă / durata normală, împărțit la zilele
   calendaristice ale lunii; zile calcul = zilele lunii minus cele dinaintea angajării și de după încetare. Administratorii se scot.
   Calculul exact se face după înregistrarea pontajelor; înainte, doar previziuni.
4. De plată la stat = suma datorată − achizițiile (fără TVA). Achiziții < jumătate din suma datorată → se plătește diferența întreagă.
   Achiziții > jumătate → se plătește jumătate din suma datorată, iar diferența se reportează pe lunile următoare. Plata la stat până pe 25
   a lunii următoare; plata către unitatea protejată până la sfârșitul lunii pentru care se calculează.

„Suma datorată” din răspuns = **contribuția integrală** (Legea 448/2006 art. 78: salariul minim × locurile neocupate). Runda 1 o înjumătățea
de două ori (50% din salariu, apoi jumătate din asta); runda 2 aplică jumătatea o singură dată, pe contribuția integrală.

## Formula (o singură definiție: `fn_upa_calcul_la`, în BD)

| Pas | Ce | Sursa în ERP |
|---|---|---|
| zilele contractului | zilele lunii între `employees.hire_date` și `employees.termination_date` (ambele incluse) | `employees` |
| ziua de referință | pentru o zi lucrătoare, ea însăși; pentru weekend / sărbătoare legală, ultima zi lucrătoare dinainte (efectivul zilei nelucrătoare = efectivul zilei lucrătoare precedente) | `calendar_days` ('legal') |
| zile scoase | în ziua de referință: CFS (`CFP`), suspendare de drept (`CM`, `BO`, `BP`, `AM` = incapacitate de muncă, `M` = maternitate), suspendare fără cod (corecție HR), administrator, contract inexistent | `pontaj_records.norma`, `upa_angajat_perioade`, `hr_decizii_semnatari` |
| normă | `employees.procent_ocupare / 100`, sau corecția HR pe interval (act adițional) | `employees`, `upa_angajat_perioade` |
| NMA | Σ normele zilelor numărate / zilele lunii, rotunjit la 2 zecimale | — |
| posturi | 4% × NMA, cu 2 zecimale (fără rotunjire la întreg); 0 sub 50 de angajați | — |
| locuri neocupate | max(posturi − angajați cu handicap, 0) | `upa_parametri.angajati_handicap` |
| contribuția integrală B | locuri × salariul minim al lunii (rotunjit la bani) | `upa_parametri.salariu_minim` |
| deducerea maximă | jumătate din B (trunchiat la bani: la stat rămâne cel puțin jumătate) | — |
| achiziții A | Σ `valoare_fara_tva` ale lunii **plătite** (`stare_plata` = plătită) până la ultima zi a lunii | `upa_achizitii` |
| report intrat | reportul ieșit al lunii anterioare închise; la prima lună = `report_initial` | `upa_calcul_lunar`, `upa_parametri` |
| deducere | min(A + report intrat, deducerea maximă) | — |
| de plată la stat | B − deducere | — |
| report ieșit | A + report intrat − deducere | — |
| termenul la stat | 25 a lunii următoare (zi nelucrătoare → prima zi lucrătoare de după); pentru noiembrie: 21 decembrie (zi nelucrătoare → ziua lucrătoare dinainte), Codul de procedură fiscală art. 155 alin. (2) | `fn_upa_termen_stat` |

### Exemplul pentru expert: noiembrie 2026 (NMA ≈ 64)

Presupunem NMA = 64,00, niciun angajat cu handicap, salariul minim 4.325 lei, report intrat 0:

| Pas | Calcul | Rezultat |
|---|---|---|
| posturi | 4% × 64,00 | **2,56** |
| locuri neocupate | 2,56 − 0 | 2,56 |
| contribuția integrală | 2,56 × 4.325 | **11.072,00 lei** |
| la stat, cel puțin | 11.072,00 / 2 | 5.536,00 lei |
| deducerea maximă | 11.072,00 − 5.536,00 | **5.536,00 lei** |

| Achiziții fără TVA plătite în noiembrie | Deducere | De plată la stat până pe 21.12.2026 | Se reportează |
|---:|---:|---:|---:|
| 0 | 0,00 | 11.072,00 | 0,00 |
| 3.000,00 | 3.000,00 | 8.072,00 | 0,00 |
| 5.536,00 | 5.536,00 | 5.536,00 | 0,00 |
| 8.000,00 | 5.536,00 | 5.536,00 | 2.464,00 |

Verificat și pe exemplul din review (NMA 75, 3 posturi): fără achiziții 12.975,00 lei la stat; cu 8.000 lei achiziții 6.487,50 lei la stat
și 1.512,50 lei reportați.

## Stări

- **Previziune:** cât luna nu e închisă.
  - Luna în curs numără și facturile cu plata necompletată sau neplătite încă: se presupune plata la termen, cu avertisment.
  - După ultima zi a lunii se deduc doar facturile plătite până în ultima zi.
- **Închis (exact):** din 13 a lunii următoare, doar **owner-ul**, din ecran („Închide calculul”), confirmă luna:
  - confirmarea e pe **amprenta** datelor pe care le-a văzut: pontajul fiecărei zile, corecțiile HR, facturile, parametrii, reportul;
    dacă s-a schimbat ceva între afișare și clic, BD-ul refuză și ecranul se reîncarcă;
  - se scriu o singură dată `upa_calcul_lunar` și detaliul pe angajat `upa_calcul_angajat` (nemodificabile), cu cine a confirmat;
  - lunile se închid în ordine;
  - cronul NU mai închide: ERP-ul nu are istoricul normei și al administratorilor, deci un om confirmă. Cronul îl anunță zilnic pe
    owner („calcul_de_confirmat”) sau, dacă lipsesc date, și Administrativ / UPA („calcul_neinchis”).
- **Blocaje** (luna nu se închide):
  - o zi lucrătoare fără pontaj pentru un angajat cu contract (`pontaj_lipsa`);
  - angajat fără data angajării, fără normă, inactiv fără data încetării dar cu pontaj în lună;
  - calendarul sărbătorilor legale al anului neîncărcat (`calendar_incomplet`: lipsește vreo sărbătoare cu dată fixă);
  - factură cu plata necompletată, sau plătită la termen fără valoarea fără TVA;
  - salariul minim sau numărul angajaților cu handicap neînregistrat;
  - luna anterioară neînchisă.
- **Avertismente** (se văd, nu opresc închiderea):
  - factură neplătită în lună (nu se deduce) sau plătită după termen (nu se deduce);
  - angajați cu corecții HR.
- **După închidere:** ecranul arată dacă sursele lunii (pontaj / facturi) s-au schimbat. Calculul închis rămâne; o rectificare se discută
  cu contabilul (mecanismul de rectificare nu e în această migrare).

## Alerta

- **Alerta zilei** (previziune, din ziua `upa_alerta_zi`): „mai sunt X lei de cumpărat” = deducerea maximă − report − achiziții.
- **Alerta exactă** (felul nou `calcul`, cheia `calcul:AAAA-LL`): la prima rulare a cronului de după închidere, oricine a închis luna și
  chiar dacă jurnalul are deja rândul vechi `inchidere:AAAA-LL` (v10). Doar cu alerta pornită, contribuția > 0 și termenul încă înainte.
- Edge-ul v11 refuză un rând nou cu calcul incomplet (`calcul_invalid`, fără mail); rezervarea veche (fără `calcul`) are forma v10.

## Corecțiile HR (owner, „Detaliu NMA”)

`upa_angajat_perioade`: pe interval, pentru un angajat — norma (act adițional), administrator da / nu, suspendat fără cod de pontaj
(ex. creșterea copilului). Motivul e obligatoriu. Fără suprapuneri; o lună închisă nu se mai atinge.

## Intențiile salvate din formular (compatibilitate)

Amprenta intenției e **versionată** (`fn_upa_hash_intentie_v2`): fără valorile noi (valoare fără TVA, starea și data plății) e EXACT amprenta
din 20261229a, deci reîncercarea unei salvări de dinainte de migrare (sau a ecranului vechi) dă „existent”, și după revenire. Cu valorile noi:
`v2:` + md5 pe toate câmpurile. `fn_upa_campuri_intentie` / `fn_upa_hash_intentie` rămân neatinse.

## Plafonul fix de 7.000 lei: scos din calcul

Plafonul din setări nu mai e citit de alertă și nici de ecran. Îl înlocuiește deducerea calculată. O rezervă fixă ar ascunde datele lipsă (L18).
Tabelul `upa_plafon_lunar`, `fn_upa_luni` și `fn_upa_plafon_seteaza` rămân neatinse (ecranul vechi, până la merge); retragerea = migrare separată.

## Ce lipsește din ERP (și ce face calculul)

| Lipsă | Acum |
|---|---|
| Istoricul normei, al calității de administrator, suspendările fără cod | corecții HR pe interval (owner) + confirmarea owner-ului la închidere |
| Numărul angajaților cu handicap | parametru pe perioade; până se înregistrează (și 0), calculul e blocat |
| Calendarul sărbătorilor pe anii următori | blocaj până se încarcă (Setări → Calendar) |
| Lacătul pontajului în BD | nu există: închiderea folosește amprenta, iar ecranul semnalează schimbările de după |
| Valoarea fără TVA și plata pe facturile vechi / din Citește Orice | se completează din listă („fără TVA?”, „plătită ✓” / „neplătită”) |

## Întrebări pentru expert (de confirmat înainte de aplicare)

1. Exemplul de mai sus (contribuția integrală, posturi cu 2 zecimale, jumătate la stat) e corect? Suma se rotunjește la leu în declarație?
2. Rotunjirea celor 4% × NMA la 2 zecimale: matematic (2,5652 → 2,57) sau prin trunchiere?
3. Absențele nemotivate (N) se numără ca zile lucrate (contractul nu e suspendat până la o decizie)? Concediul paternal / de îngrijire a
   copilului bolnav au coduri proprii în pontaj?
4. Reportul expiră (de exemplu la sfârșitul anului)?
5. 21 decembrie nelucrător: termenul se mută pe ziua lucrătoare dinainte (cum e în cod) sau după? În 2026 și 2027 ziua e lucrătoare.
6. Angajatul cu contract din ziua de sâmbătă: regula „efectivul zilei lucrătoare precedente” îl scoate pentru sâmbăta și duminica de început.
7. Prima lună a calculului e octombrie 2026, cu report inițial 0. Există un excedent din lunile anterioare?

## Ordinea livrării (de coordonator, după review și „da”)

1. **Edge-ul `upa-plafon-alerta` v11**, publicat înainte. Merge și cu rezervarea veche (fără `calcul` → forma v10).
2. **Migrarea `20270101a`** (versiune 20270101120000), prin runner, cu plafon 5000 și amprenta globală L15 v2.
   - Lista obiectelor: `supabase/tests/20270101a_administrativ_upa_calcul.l15.obiecte.tsv`.
   - Lock: `upa_achizitii` și `upa_alerta_jurnal` ACCESS EXCLUSIVE (3 coloane noi + 2 CHECK-uri; 2 CHECK-uri înlocuite în jurnal).
   - Preflight-ul cere ca cele 13 funcții din 20261229a folosite sau înlocuite și cele 2 CHECK-uri ale jurnalului să fie EXACT cele revizuite.
3. **Merge-ul ecranului** (după migrare: ecranul cheamă RPC-urile noi).
4. **Din ecran:** numărul angajaților cu handicap (de la 01.10.2026; 0 dacă nu sunt); valoarea fără TVA și plata pe facturile din
   octombrie / noiembrie; corecțiile HR, dacă e cazul; calendarul 2027 înainte de calculul lui decembrie 2026.
5. Cronul (jobid 29, zilnic) nu se schimbă.

**Revenire:** `supabase/revenire/20270101a_administrativ_upa_calcul_ROLLBACK.sql` (versiune 20270101120001), prin runner cu plafon 2000.
- Reface IDENTIC cele 5 funcții înlocuite din 20261229a și CHECK-urile jurnalului; scoate tabelele, funcțiile și coloanele noi.
- Refuză: o lună închisă, un parametru din ecran, o corecție HR, o achiziție cu valorile noi (sau amprenta v2), o alertă exactă în jurnal,
  orice abatere de la amprenta obiectelor.
- Se face ÎNAINTEA revenirilor 20261229c → b → a. Ecranul se retrage înainte; edge-ul v11 poate rămâne.

## Fișa de securitate (CLAUDE.md pct. 7) — schimbările față de v10

- **(a) Conținut extern:** niciunul. Calculul citește doar BD-ul: pontaj, angajați, semnatari, calendar, achiziții, parametri, corecții.
- **(b) Ce scrie:** `upa_calcul_lunar` / `upa_calcul_angajat` (o dată pe lună, la confirmarea owner-ului); `upa_angajat_perioade` (owner);
  jurnalul și notificările, ca înainte. Mailul intern conține sumele, NMA-ul, posturile; fără nume de angajați.
- **(c) Identitate:** edge-ul folosește `service_role`, neschimbat; funcțiile de calcul sunt interne (fără EXECUTE pentru roluri); ecranul
  trece prin funcții SECURITY DEFINER care cer `auth.uid()` (agregatele: orice cont logat; detaliul, corecțiile și închiderea: doar owner-ul).
- **(d) Cine pornește:** edge-ul: cronul sau owner-ul, ca în v10; închiderea: owner-ul.
- **(e) Confirmare umană:** închiderea unei luni = confirmarea owner-ului, cu textul a ce confirmă, pe amprenta datelor văzute.

## Probe

- `scripts/pglite/test_upa_calcul_local.mjs` (PGlite, schelet Supabase + `supabase/tests/20270101a_administrativ_upa_calcul_schelet.sql`):
  - validatorul runnerului; blocul AMPRENTA identic în migrare și revenire; sursele și CHECK-urile refăcute;
  - aplicarea ca la livrare (L15 v2, după 20261229a / b / c);
  - scenariul octombrie / noiembrie 2026 cu valori calculate de mână: CFS L–V + weekend, CM, maternitate, BO de vineri care trece în
    luna următoare, normă schimbată, administrator de la jumătatea lunii, suspendare fără cod, angajat încetat sâmbăta, Sf. Andrei;
  - exemplele din review (NMA 75 și 64), un angajat cu handicap, factura neplătită, plata necunoscută, sub 50 de angajați;
  - toate blocajele, închiderea pe amprentă (greșită / veche / pontaj schimbat = refuz), editorul refuzat;
  - tranzițiile: intenția de dinainte de migrare, jurnalul legacy + închiderea din ecran înaintea cronului;
  - edge-ul cu Resend simulat; drepturile ca non-owner și fără identitate; refuzurile migrării și ale revenirii;
  - aplicare → revenire → reaplicare (cu intențiile vechi „existent” peste revenire), apoi revenirile c → b → a;
  - mutanți de comportament, rulați cu amprenta oprită.
- `src/upaAlerta.test.js` (vitest): textele ecranului, plata, corecțiile, mailul exact / previziunea, refuzul calculului invalid (P2).
- Rămân pentru clonă (chat-ul): PG17 real, manifestul L15, concurența cu două sesiuni (închiderea în paralel cu o corectură de pontaj).
