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
