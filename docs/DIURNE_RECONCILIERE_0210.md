# Diurne — reconcilierea celor 4 persoane (read-only, 02.10.2026)

Scop: cele „4 persoane — 1.300 lei" rămase deschise la închiderea r5 (`claude_context` #1508): **17 BAIESU DARIUS OVIDIU, 57 IOAN SORIN ALEXANDRU, 71 MITRACHE ALEXANDRU, 166 TUDURACHI CORNEL**. Comparăm ce s-a SALVAT în `diurna_payments` / `diurna_payment_details` cu ce ar fi CUVENIT după alocarea comună LIVE (`src/diurneAlocare.js`, #545: C = zile lucrătoare − CO, bifele consumă și weekendul, plafon lunar). **Niciun UPDATE/INSERT — doar SELECT.** Orice corecție de date trece prin preview → confirmarea lui Răzvan → apply (CLAUDE.md pct. 3).

Tarif: `settings.diurna_amount = 50`. Sărbători legale aug–oct: doar 15.08 (sâmbătă). Zile lucrătoare: august 21, septembrie 22.

## 0. SELECT-urile folosite (toate read-only, proiect `dxczwkbciseqniprspcu`)

```sql
-- angajații
SELECT id, name, active, termination_date, site_id FROM employees WHERE id IN (17,57,166,71);
-- pontajul lor pe aug–sep
SELECT employee_id, date, diurna, norma FROM pontaj_records
 WHERE employee_id IN (17,57,166,71) AND date BETWEEN '2026-08-01' AND '2026-09-30' ORDER BY 1,2;
-- plățile din perioadă + rândurile lor de detaliu
SELECT p.id, p.period_from, p.period_to, p.payment_date, p.total_employees, p.total_amount,
       d.employee_id, d.employee_name, d.days, d.amount
  FROM diurna_payments p LEFT JOIN diurna_payment_details d ON d.payment_id = p.id AND d.employee_id IN (17,57,166,71)
 WHERE p.period_to >= '2026-08-01' ORDER BY p.period_from, d.employee_id;
-- cine are bife 19–25.09 și lipsește din plata #85
SELECT r.employee_id, e.name, e.active, e.termination_date, count(*) AS bife_19_25
  FROM pontaj_records r JOIN employees e ON e.id = r.employee_id
 WHERE r.diurna AND r.date BETWEEN '2026-09-19' AND '2026-09-25'
   AND NOT EXISTS (SELECT 1 FROM diurna_payment_details d WHERE d.payment_id = 85 AND d.employee_id = r.employee_id)
 GROUP BY 1,2,3,4;
-- calendar
SELECT date, type FROM calendar_days WHERE type='legal' AND date BETWEEN '2026-08-01' AND '2026-10-31';
```

Alocarea a fost recalculată cu funcția reală `alocaDiurneTransa` (script `scratchpad/recon.mjs`, datele de mai sus introduse ca liste de zile), nu de mână.

## 1. Starea angajaților

| id | Nume | active | termination_date | site |
|---|---|---|---|---|
| 17 | BAIESU DARIUS OVIDIU | false | 2026-09-11 | 4 |
| 57 | IOAN SORIN ALEXANDRU | false | 2026-09-25 | 26 |
| 71 | MITRACHE ALEXANDRU | true | — | 4 |
| 166 | TUDURACHI CORNEL | false | 2026-09-18 | 4 |

Tranșele salvate: #73 01–07.08 · #78 08–14.08 · #79 15–21.08 · #81 22–31.08 · #82 01–04.09 · #83 05–11.09 · #84 12–18.09 · #85 19–25.09 (plătită 30.09, 70 angajați). Tranșa 26–30.09 **nu e salvată** (241 de bife în 26–30.09 așteaptă — Natalia o salvează pe #545).

## 2. Tabel plată cu plată (C = plafon lunar, B = bife înaintea tranșei, N = bife în tranșă)

| Plată | Tranșă | Angajat | C | B | N | Zile diurnă (alocare) | Cuvenit | Plătit | Diferență |
|---|---|---|---|---|---|---|---|---|---|
| #73 | 01→07.08 | BAIESU DARIUS OVIDIU | 21 | 0 | 5 | 5 | 250 | 250 | 0 |
| #73 | 01→07.08 | IOAN SORIN ALEXANDRU | 21 | 0 | 5 | 5 | 250 | 250 | 0 |
| #73 | 01→07.08 | MITRACHE ALEXANDRU | 21 | 0 | 5 | 5 | 250 | **lipsă** | **−250** |
| #78 | 08→14.08 | BAIESU DARIUS OVIDIU | 21 | 5 | 5 | 5 | 250 | 250 | 0 |
| #78 | 08→14.08 | IOAN SORIN ALEXANDRU | 21 | 5 | 5 | 5 | 250 | 250 | 0 |
| #78 | 08→14.08 | MITRACHE ALEXANDRU | 21 | 5 | 5 | 5 | 250 | **lipsă** | **−250** |
| #78 | 08→14.08 | TUDURACHI CORNEL | 21 | 0 | 3 | 3 | 150 | 150 | 0 |
| #79 | 15→21.08 | BAIESU DARIUS OVIDIU | 21 | 10 | 5 | 5 | 250 | 250 | 0 |
| #79 | 15→21.08 | IOAN SORIN ALEXANDRU | 21 | 10 | 5 | 5 | 250 | 250 | 0 |
| #79 | 15→21.08 | MITRACHE ALEXANDRU | 21 | 10 | 5 | 5 | 250 | **lipsă** | **−250** |
| #79 | 15→21.08 | TUDURACHI CORNEL | 21 | 3 | 5 | 5 | 250 | 250 | 0 |
| #81 | 22→31.08 | BAIESU DARIUS OVIDIU | 21 | 15 | 6 | 6 | 300 | **lipsă** | **−300** |
| #81 | 22→31.08 | IOAN SORIN ALEXANDRU | 21 | 15 | 8 | 6 | 300 | 300 | 0 |
| #81 | 22→31.08 | MITRACHE ALEXANDRU | 21 | 15 | 5 | 5 | 250 | **lipsă** | **−250** |
| #81 | 22→31.08 | TUDURACHI CORNEL | 21 | 8 | 6 | 6 | 300 | 300 | 0 |
| #82 | 01→04.09 | BAIESU DARIUS OVIDIU | 22 | 0 | 4 | 4 | 200 | **lipsă** | **−200** |
| #82 | 01→04.09 | IOAN SORIN ALEXANDRU | 22 | 0 | 4 | 4 | 200 | 200 | 0 |
| #82 | 01→04.09 | MITRACHE ALEXANDRU | 22 | 0 | 4 | 4 | 200 | 150 (3 zile) | **−50** |
| #82 | 01→04.09 | TUDURACHI CORNEL | 21 | 0 | 4 | 4 | 200 | 200 | 0 |
| #83 | 05→11.09 | BAIESU DARIUS OVIDIU | 22 | 4 | 5 | 5 | 250 | **lipsă** | **−250** |
| #83 | 05→11.09 | IOAN SORIN ALEXANDRU | 22 | 4 | 5 | 5 | 250 | 250 | 0 |
| #83 | 05→11.09 | MITRACHE ALEXANDRU | 22 | 4 | 5 | 5 | 250 | **lipsă** | **−250** |
| #83 | 05→11.09 | TUDURACHI CORNEL | 21 | 4 | 5 | 5 | 250 | 250 | 0 |
| #84 | 12→18.09 | IOAN SORIN ALEXANDRU | 22 | 9 | 5 | 5 | 250 | 250 | 0 |
| #84 | 12→18.09 | MITRACHE ALEXANDRU | 22 | 9 | 5 | 5 | 250 | 250 | 0 |
| #84 | 12→18.09 | TUDURACHI CORNEL | 21 | 9 | 4 | 4 | 200 | **lipsă** | **−200** |
| #85 | 19→25.09 | IOAN SORIN ALEXANDRU | 22 | 14 | 7 | 7 | 350 | **lipsă** | **−350** |

(Tudurachi: C = 21 pentru că are CO pe 18.09. Ioan Sorin #81: 8 bife, dar plafonul lunar lasă 6 → 300, corect plătit.)

## 3. Concluzii

### 3a. SEPTEMBRIE — exact cele „1.300 lei" din #1508 (confirmat numeric)

| Angajat | Lipsă / diferență | Tranșe | Cauza probabilă |
|---|---|---|---|
| 17 BAIESU DARIUS | **450** | #82 (200) + #83 (250) | încetat 11.09 → `active=false` la momentul salvării; până la #545 filtrul era doar `active.eq.true` (bug cunoscut, listat chiar în comentariul din `savePayment`) |
| 57 IOAN SORIN | **350** | #85 (350) | încetat 25.09; plata #85 salvată 30.09 — singurul angajat cu bife 19–25.09 care lipsește din #85 (SELECT-ul 4 din §0 dă exact un rând). De verificat dacă #85 a fost salvată de pe #545 (filtrul cu `termination_date`) sau pe codul vechi |
| 71 MITRACHE | **300** | #82 (−50: 3 zile salvate, 4 bife 01–04.09) + #83 (250, lipsă) | nu e încetat și nu e site-scoped (plata o face admin/owner) → cel mai probabil bifele 01–11.09 au fost puse DUPĂ salvarea tranșelor (#82/#83 salvate pe 14.09, 21:29). Nu se poate dovedi din BD (pontaj_records nu are istoric al bifelor) |
| 166 TUDURACHI | **200** | #84 (200) | încetat 18.09 → același mecanism ca Baiesu |
| **Total** | **1.300** | | |

### 3b. AUGUST — în afara celor 1.300, dar reiese din aceleași SELECT-uri (de clarificat cu Răzvan / Mirela)

- **71 MITRACHE: lipsește din TOATE tranșele din august** (#73, #78, #79, #81) deși are 20 de zile cu diurnă bifată (03–07, 10–14, 17–21, 24–28.08) → **1.000 lei** necuveniți dacă bifele erau reale atunci. Posibil: bifele au fost puse retroactiv sau Mitrache (admin logistică) nu primește diurnă pe acest canal. Nu se trage nicio concluzie fără confirmare.
- **17 BAIESU: lipsește din #81 (22–31.08)** cu 6 bife (22, 24–27, 31.08) → **300 lei**. În august era activ (încetat abia 11.09) — nu e explicabil prin filtrul `active`; #81 a fost salvată pe 14.09, deci DUPĂ încetare → același bug ca în septembrie (angajatul era deja `active=false` la salvare).

Total brut aug+sep pentru cei 4, dacă toate bifele sunt reale: **2.600 lei** (1.300 sept + 1.300 aug).

## 4. Ce NU face acest raport

- Nu modifică nimic. Pentru plată: variante A) tranșă de regularizare separată (ex. 01–25.09 doar pentru cei 4 — blocată de verificarea de suprapunere din `savePayment`, ar trebui INSERT manual preview→confirm), B) rânduri de detaliu adăugate în plățile existente (schimbă `total_amount` al unor plăți deja trimise la bancă — nerecomandat), C) plată în afara sistemului + notă în `baza_calcul`/comentariu. Decizia e a lui Răzvan după verificarea la bancă cu Mirela.
- Nu validează că bifele din pontaj sunt corecte (nu există istoric al modificărilor pe `pontaj_records`).
- Exportul Excel din Diurne (r6) arată de-acum acești angajați cu „Diferență față de plătit" negativă chiar dacă nu mai au bife în tranșa curentă (#556), deci la exportul 26–30.09 cei 4 ar trebui să apară cu −450 / −350 / −300 / −200.
