# Proveniența marcajelor + trierea dezacordurilor (laborator OCR, 16.10.2026)

Decizia Razvan (varianta A, după proba arb-v2 pe r1): marcajele pipeline-ului se separă de textul citit ÎNAINTE de comparare; doar
dezacordurile cu cifre diferite în CONȚINUT merg la arbitrajul plătit.

## Proba care a motivat-o (r1, 117 decizii, 0,566 USD)
Doar 42/117 itemi „e_cantitate” difereau în cifre; 46/54 cu etichetă Opus sigură difereau doar ca format. 14 din 18 needs_human erau pe
„diferențe numerice” venite din marcaje (⟦rowspan=8⟧ vs ⟦rowspan=9⟧).

## Proveniența (compare.py)
Fiecare marcaj scris de pipeline trece prin `_m()`: ⟦rowspan=N⟧, ⟦…_invalid=…⟧, ⟦img …⟧, ⟦tabel_neparsat⟧, delimitatorii ⟦barat: …⟧ și
^{…}/_{…} (conținutul lor rămâne conținut). În modul normal `_m` e identitatea: segmentele, itemii, amprentele și BD NU se schimbă (190 de teste
vechi + noi OK). În modul proveniență (`segmente_provenienta`) marcajul e delimitat cu U+E000/U+E001, puse DOAR de `_m`; orice astfel de
caracter venit din citire e neutralizat (U+FFFD) înainte, iar paritatea cu parsarea normală se verifică — la eșec: fără măști, HIGH_RISK.
Paritate pe tot corpusul: 10.024/10.024 citiri (r1 + Răcari), normal și aplatizat.
Un „⟦rowspan=3⟧” scris de OCR ca text NU e marcaj (proveniența e a pipeline-ului, nu a formei) — test dedicat.

## Trierea (triere.py) — fără schimbare de item / amprentă / BD
- HIGH_RISK: numere diferite în conținut (multiset literal de tokeni NUMBER); bară de tăiere la un singur cititor; numere mutate între
  celule (poziția de la capătul rândului, după tăierea celulelor goale de la coadă); rând lipsă cu numere; proveniență nestabilită.
- MARCAJE: conținut identic, diferă doar marcajele.  DEFER: conținut diferit fără numere și fără bară.  OM: structura_tabele / banda_intreaga.
Clientul: `erp arbitreaza --triere` — doar HIGH_RISK la Claude; în probă restul se sare, în pasul normal restul → needs_human fără AI cu
motivul clasei (restant explicit pentru om, nu „corect”).

## Măsurat (triere_masurare.json, local, 0 USD)
| | dezacorduri | HIGH_RISK | DEFER | MARCAJE | OM | cost estimat arbitraj (0,0048 USD/apel, proba r1) |
|---|---|---|---|---|---|---|
| r1 (102) | 12.669 | 2.639 | 9.257 | 91 | 682 | ~12,7 USD (față de ~45 fără triere) |
| Răcari rt1 | 6.972 | 2.874 | 3.982 | 21 | 95 | ~13,8 USD |
Proba arb-v2 reclasificată: HIGH_RISK 57 (12 needs_human = 21%), DEFER 56 (3 needs_human), MARCAJE 4 (3 needs_human).
Risc rămas: pe HIGH_RISK, needs_human ~21% > pragul §8 de 15% — un arbitraj complet se poate opri pe prag (cazuri grele reale: rânduri
decalate, coduri, plus 2 răspunsuri Sonnet în afara schemei = defect separat al arbitrului).

## v2 — după Jakarinos r1 (NO-GO, `out\ocrlab_triere_r1_jak.log`)
Reparat, cu test pentru fiecare contraexemplu:
- **DEFER doar fără cifre**: conținut diferit + cel puțin o cifră în conținut (fragment + 2 tokeni vecini la text; rândul întreg la tabel) =
  HIGH_RISK. Prinde UM („6 bar”/„6 bai”, d204 p10), semn („= 0,0013”/„− 0,0013”, d203 p67), cod („NTPEE-2018”/„NTPER-2018”, d203 p49).
- **Imagini**: doar cadrul ⟦img ⟧ și valoarea lui `src` sunt marcaj; `alt`, `title` și celelalte atribute sunt conținut („10,5 mc”/„105 mc”).
- **Bara**: conținutul tăiat rămâne conținut, încadrat distinct (U+E002/U+E003 în proveniență) → „<s>10</s> 20” ≠ „10 <s>20</s>”.
- **Imbricare**: măștile pe adâncime, nu boolean (sup în alt).
- **Client**: cache-ul trierii pe (document, bandă), nu doar pe bandă (r1 d772/d1247 au benzi cu același id).
Paritate: 10.024/10.024 (normal + aplatizat). Teste: 193 OK.

| | dezacorduri | HIGH_RISK | DEFER | MARCAJE | OM | cost estimat (0,0048/apel) |
|---|---|---|---|---|---|---|
| r1 (102) | 12.669 | 5.926 | 5.973 | 88 | 682 | ~28 USD (față de ~45) |
| Răcari | 6.972 | 3.844 | 3.024 | 9 | 95 | ~18 USD |
Proba arb-v2 reclasificată: HIGH_RISK 109 (15 needs_human = 13,8%, sub pragul de 15%); DEFER 4; MARCAJE 4 (3 needs_human).

## Jakarinos r2 (ULTIMA rundă, #1766): NO-GO — `out\ocrlab_triere_r2b_jak.log` → decide Razvan
Sigur: proveniența (paritate, fără efect pe BD); nicio cantitate greșită acceptată — DEFER/MARCAJE merg la om fără AI și blochează pagina.
Rămas: diferențe reale care OCOLESC arbitrul (ajung direct la om): UM fără cifre pe rând (r1 d1247 p967 / p1284 „ore”/„cre”), cod fără cifre
în fereastră (Răcari d204 p62 „RGD”/„PGD”), exponent vs cifră („10²”/„102” → MARCAJE), „src” scris în textul alt (regex), bară pe text fără cifre.
Variante pentru Razvan: A) merge cu acest risc (AI pe HIGH_RISK, restul la om / la o trecere ieftină ulterioară); B) doar proveniența;
C) fără merge.
