# R8 — Clarificarea #63 (lic. 95 Vâlcelele), ciornă v2

Stare: CIORNĂ. Nimic trimis, nimic scris în BD. Termen clarificări SEAP: **01.10.2026**.
Sursa textului v1: `SELECT intrebare, sursa, status FROM ofertare_clarificari WHERE id=63` (25.09.2026):
`status='propunere'`, `sursa='planse_auto:475,471'`, `md5(intrebare)='6bd72fc31cd31ce8a32801d800cf65e3'`.
Citatele de mai jos sunt DATE din documentație (`ofertare_documente_atribuire.text_extras`), copiate literal, cu greșelile originale. Poziția = `strpos` în `text_extras`.

## De ce v2 (motivul modificărilor)
1. v1 (pct. 3) cerea planșele „în format editabil (DWG/DXF) sau PDF cu text selectabil”, pe premisa că planșele nu pot fi citite. Premisa e **infirmată** (R3): PL1 (475) și PL5 (471) sunt lizibile, dar nu conțin lungimi pe tronsoane. Cererea de format e scoasă; rămâne întrebarea despre lungimi/corespondență.
2. v1 atribuia Caietului de sarcini fraze care sunt, de fapt, în memoriu (29.555 mp e doar în 468). v2 dă locator exact pentru fiecare cifră.
3. v1 presupunea că 54.200 e „suprafață”. v2 întreabă doar unitatea (m vs mp), fără presupunere.
4. Adăugate: corespondența tronsoane ↔ Lista de prețuri; Dn 160 absent din Schema tehnologică; tronsoanele din amonte (SRMP Ștefan Vodă → limita Vâlcelele) incluse sau nu; diferența Schema vs 44,355 km (formulată ca întrebare); CUI (punct separat, opțional).
5. Diferența de ~48,3 km din Schema tehnologică vine din reconcilierea R5 (citire AI a doc 470, **NEVALIDATĂ** vizual). În textul către autoritate e formulată prudent („din însumarea noastră”), fără cifră fermă atribuită autorității.

## Tabel locatori
| # | Cifră / text | Citat exact | Locator |
|---|---|---|---|
| L1 | 44,355 km | „executarea rețelei de distribuție gaze naturale propuse, cu o lungime de aproximativ 44,355 km” | doc 1276 (Caiet de sarcini p01), pct. 3.4, poz. 10 036 |
| L2 | Dn 200–40 | „cu diametru cuprinse între Dn 200 mm și Dn 40 mm” | doc 1276, poz. 6 007 |
| L3 | E1 11,525 km Dn200–160 | „PE 100 SDR 11 Dn 200. la Dn 160, care se executia in etapa I-a in lungime totala de 11,525 km” | doc 1276, cap. 4, poz. 16 094; idem doc 468 (memoriu), poz. 25 423 |
| L4 | E2 32,830 km Dn160–40 | „din etapa 2-a din material PE100 SDR 11 Dn 160 la Dn 40 in lungime totala de 32,830 km” | doc 1276, cap. 4, poz. 16 254; doc 468, poz. 25 581 |
| L5 | Dn160–40 = 44,355 km | „cu diametres cuprinse intre Dn 160 și Dn 40 mm, cu o lungime totala de cca 44,355 km (conform planurilor anexate)” | doc 1276, cap. 4 „Materiale”, poz. 17 922; doc 468 poz. 34 993 („…44,355 ml…”) |
| L6 | 44,355 ml / 29.555 mp | „DN-uri de la 160 mm la 40mm va fi de cca 44,355 ml reprezentand o suprafata de 29.555 mp” | doc 468 (memoriu tehnic), poz. 28 806 |
| L7 | Dn 200–40, 44,355 ml | „Diametrul – Dn 200 la Dn 40 mm / Lungimea – L = 44,355 ml” | doc 468, poz. 13 162 |
| L8 | 54200mp | „Lungimea totala a retelei de alimentare cu gaze naturale este de 54200mp,” | doc 475 (PL1 „Plan topografic comuna Vilcelele – Retea de Gaze Naturale”), zona de note a planșei (poziția exactă pe planșă neverificată vizual), poz. 624; repetat trunchiat în doc 471 (PL5), poz. 13 268 |
| L9 | UAT Vlad Țepeș / Vâlcelele | „UAT Vlad Tepes = 3200 mp ; UAT Vilcelele 51000 mp” | doc 475, aceeași notă, poz. 652; doc 471 poz. 12 468 |
| L10 | 51000mp | „Suprafata aferenta retelei de gaze naturale este de 51000mp” | doc 475, aceeași notă, poz. 422 |
| L11 | Tronsoane amonte (13.765 m Dn200) | „SRMP -> UAT Cuza Voda-Limita: 5485 m, Dn 200 mm” / „…-> UAT Gradistea-Limita: 4080 m” / „…-> UAT Independenta-Limita: 1980 m” / „UAT Independenta-Limita -> UAT Valcelele-Limita: 2220 m, Dn 200 mm” | doc 470 (Schema tehnologica Valcelele alimentare din Stefan Voda), tabel „Dimensionare – Tronson retea de distributie”, rândurile 1–4; poz. 385–720 (**text rezumat de citirea AI, nu extras literal** — de verificat vizual pe planșă) |
| L12 | Schema: ~48,3 km, fără Dn160 | însumare tabel „Dimensionare”: 48.305 m brut / 48.315 m după 2 corecții; niciun rând Dn 160 | R5_RECONCILIERE_CANTITATI_470.md (e), (f) — **NEVALIDAT** |
| L13 | Lista de prețuri | „Anexa la Formularul de ofertă – Lista de prețuri/Centralizator financiar;” | doc 479 (Fișa de date), poz. 67 713 |
| L14 | decontare | „Decotarea lucrărilor se face în funcție de stadiul fizic realizat pentru categoria de lucrări inclusă în Lista de prețuri anexă a formularului de ofertă.” | doc 1276, cap. 7 (pag. ~25), poz. 85 241 |
| L15 | liste de cantități | „Proiect Tehnic, Detalii de Execuție, memoriu tehnic, calete de sarcini, liste de cantități, piese scrise și desenate” | doc 1276, cap. 5, poz. 32 300 |
| L16 | Formulare | secțiunea formulare se încheie la Formularul nr. 11; fără model de Listă de prețuri | doc 481 (verificat în VALCELELE_95_INFO §1) |
| L17 | CUI 3796837 | „Cod de identificare fiscala: 3796837” | doc 479, Secțiunea I.1, poz. 289; idem doc 480 (contract), poz. 751 |
| L18 | CUI 379683 | „beneficiar UAT Vâlcelele, CUI 379683.” | doc 479, III.1.6.a, poz. 50 554 |

Notă: lungimi pe UAT (Vlad Țepeș / Vâlcelele) nu există în documentație exprimate în metri — singura defalcare pe UAT e L9, în „mp”.

---

## TEXT v2 (de propus în `intrebare`)

Solicitare de clarificare — lungimile rețelei de distribuție și Lista de prețuri

Referitor la procedura având ca obiect „Execuție lucrări pentru proiectul «Înființare rețea inteligentă de alimentare cu gaze naturale în comuna Vâlcelele cu sate aparținătoare Vâlcelele și Floroaica din județul Călărași»” (anunț CN1096479), în temeiul art. 160–161 din Legea nr. 98/2016, vă rugăm să ne comunicați următoarele clarificări:

1. Lungimea totală și defalcarea pe etape
Caietul de sarcini indică „o lungime de aproximativ 44,355 km” (pct. 3.4), iar la cap. 4 (ca și memoriul tehnic) Etapa 1 „PE 100 SDR 11 Dn 200. la Dn 160 […] în lungime totala de 11,525 km” și Etapa 2 „PE100 SDR 11 Dn 160 la Dn 40 in lungime totala de 32,830 km”. Vă rugăm să confirmați că lungimea conductelor de distribuție care fac obiectul contractului este de 44.355 m, din care 11.525 m în Etapa 1 și 32.830 m în Etapa 2.

2. Diametrele aferente lungimii de 44,355 km
Cap. 4, paragraful „Materiale”, indică diametre „cuprinse intre Dn 160 și Dn 40 mm, cu o lungime totala de cca 44,355 km”, iar memoriul tehnic „DN-uri de la 160 mm la 40mm […] de cca 44,355 ml reprezentand o suprafata de 29.555 mp”; în alte secțiuni gama indicată este Dn 200 – Dn 40, iar Etapa 1 este descrisă ca Dn 200 la Dn 160. Vă rugăm să precizați:
a) dacă lungimea de 44.355 m include tronsoanele Dn 200 din Etapa 1;
b) defalcarea lungimilor pe diametre nominale, pentru fiecare etapă;
c) ce mărime reprezintă valoarea de 29.555 mp din memoriul tehnic.

3. Schema tehnologică
Tabelul „Dimensionare – Tronson retea de distributie” din planșa „Schema tehnologica Valcelele alimentare din Stefan Voda” nu conține, în lectura noastră, tronsoane Dn 160, iar însumarea noastră a lungimilor din tabel conduce la o valoare diferită de 44.355 m. Vă rugăm să precizați:
a) dacă acest tabel este referința pentru cantitățile de conductă din ofertă;
b) dacă tronsoanele Dn 200 de la SRMP Ștefan Vodă până la limita UAT Vâlcelele (primele patru rânduri ale tabelului, de la SRMP până la limita UAT Vâlcelele, prin limitele UAT Cuza Vodă, Grădiștea și Independența) fac parte din obiectul contractului și, în caz afirmativ, cărei etape aparțin;
c) diametrele și lungimile tronsoanelor Dn 160 menționate în Caietul de sarcini.

4. Nota de pe planul topografic PL1
Pe planșa PL1 „Plan topografic comuna Vilcelele – Retea de Gaze Naturale”, în notele planșei, este înscris: „Lungimea totala a retelei de alimentare cu gaze naturale este de 54200mp,” și „UAT Vlad Tepes = 3200 mp ; UAT Vilcelele 51000 mp”. Vă rugăm să precizați unitatea de măsură a acestor valori (metri sau metri pătrați) și mărimea pe care o reprezintă, precum și, dacă este cazul, lungimea rețelei pe fiecare UAT (Vlad Țepeș, Vâlcelele). Precizăm că pe planurile topografice PL1–PL5 nu am identificat lungimi înscrise pe tronsoane.

5. Liste de cantități și Lista de prețuri
Caietul de sarcini (cap. 5) enumeră „liste de cantități” printre documentele tehnice puse la dispoziție, Fișa de date solicită „Anexa la Formularul de ofertă – Lista de prețuri/Centralizator financiar”, iar cap. 7 prevede decontarea „în funcție de stadiul fizic realizat pentru categoria de lucrări inclusă în Lista de prețuri anexă a formularului de ofertă”. În documentele publicate nu am identificat liste de cantități și nici un model pentru această anexă. Vă rugăm să precizați:
a) dacă listele de cantități fac parte din documentația de atribuire și, în caz afirmativ, să le publicați;
b) structura Listei de prețuri/Centralizatorului financiar (obiecte, categorii de lucrări, defalcare pe Etapa 1 și Etapa 2) și corespondența dintre tronsoanele rețelei și pozițiile acesteia.

6. (Opțional) Codul fiscal al autorității contractante
Fișa de date indică la Secțiunea I.1 „Cod de identificare fiscala: 3796837”, iar la III.1.6.a, pentru virarea garanției de participare, „beneficiar UAT Vâlcelele, CUI 379683.”. Vă rugăm să confirmați codul fiscal corect al beneficiarului viramentului.

Precizăm că informațiile solicitate sunt necesare exclusiv pentru elaborarea ofertei și nu urmăresc modificarea cerințelor documentației de atribuire.

---

## v1 — textul integral actual (istoric, neschimbat)

```
Solicitare de clarificare — listele de cantități și lungimea rețelei de distribuție

Referitor la procedura având ca obiect „Execuție lucrări pentru proiectul «Înființare rețea inteligentă de alimentare cu gaze naturale în comuna Vâlcelele cu sate aparținătoare Vâlcelele și Floroaica din județul Călărași»” (anunț CN1096479), vă rugăm să ne comunicați următoarele clarificări:

1. Listele de cantități și Lista de prețuri
Fișa de date prevede că propunerea tehnică se întocmește „pe baza informațiilor prevăzute în Caietul de sarcini, documentația tehnică, listele de cantități și celelalte documente puse la dispoziție de Autoritatea Contractantă”, iar propunerea financiară „în conformitate cu cerințele Caietului de sarcini, documentația tehnică, listele de cantități și prevederile contractuale”. Caietul de sarcini (cap. 5) enumeră „liste de cantități” printre documentele puse la dispoziție de Autoritatea Contractantă, iar Formularul nr. 11 face, de asemenea, trimitere la „listele de cantități”. În documentele publicate nu am identificat însă liste de cantități de lucrări.
Totodată, Fișa de date solicită, ca anexă la Formularul de ofertă, „Lista de prețuri/Centralizator financiar”, iar Caietul de sarcini (pct. 7.8.2) prevede decontarea „în funcție de stadiul fizic realizat pentru categoria de lucrări inclusă în Lista de prețuri anexă a formularului de ofertă”, „cu încadrarea în sume forfetare”. Secțiunea Formulare nu conține un model pentru această anexă.
Vă rugăm să ne precizați:
a) dacă listele de cantități la care fac trimitere documentele de mai sus fac parte din documentația de atribuire și, în caz afirmativ, să le publicați;
b) structura Listei de prețuri/Centralizatorului financiar (capitole, obiecte, categorii de lucrări, defalcare pe Etapa 1 și Etapa 2) pe baza căreia se va întocmi propunerea financiară.

2. Lungimea și diametrele rețelei de distribuție
Caietul de sarcini indică o rețea de distribuție „cu o lungime de aproximativ 44,355 km” (pct. 3.4), iar la cap. 4 (ca și memoriul tehnic) împarte această lungime pe etape: PE 100 SDR 11 Dn 200 la Dn 160 în Etapa 1, „în lungime totală de 11,525 km”, și PE 100 SDR 11 Dn 160 la Dn 40 în Etapa 2, „în lungime totală de 32,830 km”. Totodată, la paragraful „Materiale” (cap. 4) Caietul de sarcini indică diametre „cuprinse între Dn 160 și Dn 40 mm, cu o lungime totală de cca 44,355 km”, iar memoriul tehnic indică pentru rețeaua „din material PE 100 SDR 11 DN-uri de la 160 mm la 40 mm” o lungime „de cca 44,355 ml reprezentând o suprafață de 29.555 mp”.
Pe planșa PL1 „Plan topografic comuna Vilcelele – Retea de Gaze Naturale” este înscris: „Lungimea totala a retelei de alimentare cu gaze naturale este de 54200mp”, alături de „UAT Vlad Tepes = 3200 mp ; UAT Vilcelele 51000 mp”.
Vă rugăm să ne precizați:
a) dacă lungimea totală a conductelor de distribuție care fac obiectul contractului este de 44.355 m, respectiv 11.525 m în Etapa 1 și 32.830 m în Etapa 2;
b) defalcarea acestor lungimi pe diametre nominale, pentru fiecare etapă, și dacă tabelul „Dimensionare” din planșa „Schema tehnologica Valcelele alimentare din Stefan Voda” este referința pentru această defalcare;
c) ce reprezintă valoarea de 54.200 mp înscrisă pe planșă (suprafață de teren afectată de lucrări sau altă mărime), în condițiile în care memoriul tehnic indică pentru rețea o suprafață de 29.555 mp;
d) dacă lungimea de 44.355 m include și tronsoanele Dn 200 (Etapa 1) sau se referă doar la diametrele Dn 160 – Dn 40, având în vedere formulările diferite de mai sus.

3. Formatul planșelor
Dacă este posibil, vă rugăm să puneți la dispoziție planșele rețelei de distribuție (planurile topografice PL1–PL5 și Schema tehnologică) în format editabil (DWG/DXF) sau în format PDF cu text selectabil.

Precizăm că informațiile solicitate sunt necesare exclusiv pentru elaborarea ofertei și nu modifică cerințele documentației de atribuire.
```

## Revizie adversarială (25.09.2026, doar SELECT)
- Toți locatorii L1–L18 reverificați prin `substr(text_extras,poz)`: cifrele și citatele corespund. CN1096479 confirmat în `ofertare_licitatii` id 95 (nu în text_extras). `updated_at` există. md5/status/sursa #63 neschimbate.
- Pct. 3b: scoase ghilimelele de pe etichetele rândurilor 1–4 (L11 e text structurat de AI, nu citat literal; etichetele fuseseră și trunchiate).
- Pct. 3: „niciun tronson Dn 160” → „tronsoane Dn 160” (afirmație bazată pe R5 nevalidat, formulare mai prudentă).
- Pct. 4: „nota de lângă cartuș” → „notele planșei” (poziția pe planșă nu e verificată); ultima frază reformulată din afirmație în constatare proprie („nu am identificat”).
- Fără termeni interziși, fără formulări acuzatoare, fără dezvăluire de strategie în TEXT v2.

## Decizii pentru Razvan (A/B)
- Punctul 6 (CUI): A) îl păstrăm în #63; B) îl scoatem și verificăm doar în SEAP. Recomandare: A, costă o frază.
- Tokenul din `sursa`: v2 corectează motivul, deci **propun să NU se adauge** `,revizie_motiv_ilizibil_infirmat` (secțiunea 6 din R3_PREVIEW_CORECTURI.sql devine inutilă). Dacă tokenul a fost deja aplicat, SQL-ul de mai jos îl scoate. Se adaugă în schimb `,revizie_v2_manual`: tot nenumeric (filtrul RPC `x ~ '^\d+$'` îl ignoră) și marchează că textul e uman, ca RPC-ul să nu-l regenereze.
- Ordinea față de migrarea v4 (R3 §6, ATENȚIE): aplică v2 **după** v4 + rularea RPC, altfel RPC-ul poate rescrie `sursa`.

## SQL de aplicare (COMENTAT — nu rulat; cere confirmarea lui Razvan)
```sql
-- 1) PREVIEW
-- SELECT id, status, sursa, md5(intrebare) h, length(intrebare) FROM ofertare_clarificari WHERE id = 63;
--    așteptat: status='propunere', h='6bd72fc31cd31ce8a32801d800cf65e3'

-- 2) APPLY (înlocuiește $v2$…$v2$ cu TEXT v2 de mai sus, integral)
-- WITH v AS (SELECT id, intrebare, sursa, status, md5(intrebare) h FROM ofertare_clarificari
--            WHERE id = 63 AND status = 'propunere' AND md5(intrebare) = '6bd72fc31cd31ce8a32801d800cf65e3'
--            FOR UPDATE),
-- u AS (UPDATE ofertare_clarificari c
--          SET intrebare = $v2$<TEXT v2>$v2$,
--              sursa = replace(c.sursa, ',revizie_motiv_ilizibil_infirmat', '')
--                      || CASE WHEN c.sursa LIKE '%,revizie_v2_manual%' THEN '' ELSE ',revizie_v2_manual' END,
--              updated_at = now()            -- status și cheia rămân neatinse
--        FROM v WHERE c.id = v.id
--        RETURNING c.id, md5(c.intrebare) h_nou, c.sursa sursa_noua)
-- SELECT array_agg(u.id) ids, jsonb_agg(jsonb_build_object('id',v.id,'intrebare_v1',v.intrebare,'sursa_v1',v.sursa,
--        'status',v.status,'h_v1',v.h,'h_v2',u.h_nou,'sursa_v2',u.sursa_noua)) backup
-- FROM u JOIN v USING (id);
--    0 rânduri ⇒ textul s-a schimbat între timp: STOP, recitește.
--    Salvează `backup` (JSON) în acest doc / ofertare_licitatii notițe.

-- 3) SANITY
-- SELECT id, status, sursa, md5(intrebare), left(intrebare, 80) FROM ofertare_clarificari WHERE id = 63;

-- ROLLBACK (din backup):
-- UPDATE ofertare_clarificari SET intrebare = <intrebare_v1>, sursa = <sursa_v1>, updated_at = now()
--  WHERE id = 63 AND md5(intrebare) = <h_v2>;
```
