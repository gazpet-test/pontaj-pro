# Ofertare: aceeași cantitate, documente diferite — semnalare automată și propunere de clarificare (TKT-2026-0329) — specificație v1

Data: 25.11.2026 · Stare: propunere. Varianta A din `TKT-0329_variante.md` (recomandată), **de ales de owner** înainte de plan.

## 1. De ce

Pe o licitație, lungimea țevii era 6.400 m în F3 și 3.995 m în ATR. ERP-ul n-a observat diferența și n-a propus o clarificare. Un alt ofertant a întrebat, iar Autoritatea a răspuns. Avem nevoie ca diferențele mari între documentele aceleiași licitații să ajungă singure în fața echipei, ca propunere de clarificare cu ambele surse citate.

## 2. Ce există azi

- **`ofertare_cantitati`** (pe licitație):
  - `cantitate` = cantitatea din F3 / lista de cantități;
  - `cantitate_plansa` și `diferenta_nota` = o comparație cu planșa, completată manual sau de extragere, afișată cu `*` în `OfertareCantitati.jsx`;
  - `surse_document_ids` = documentele de unde vine rândul.
- **`ofertare_documente_atribuire`:**
  - tipuri: `lista_cantitati`, `plansa`, `cs_volum`, `fisa_date`, `formular`, `model_contract`, `raspuns_clarificare`, `alta` (ATR-ul intră azi la `alta`);
  - `text_extras` = textul citit.
- **`ofertare_clarificari`:** întrebările noastre, cu `surse_cantitati_ids` / `surse_document_ids` și `baza_generare`.
- **Răspunsul consolidat publicat de Autoritate** se urcă azi manual, ca document `raspuns_clarificare` (`OfertareClarificari.jsx`), și se citește. Veghea automată nu îl vede.

## 3. Ce se construiește (A)

1. **Măsurători din alte documente.**
   - La extragerea cantităților, pe lângă F3, generatorul existent caută **aceeași mărime** (țeava pe diametru și material; plus robinete, branșamente și alte rânduri cu UM fizică: m, buc, mc) în celelalte documente ale licitației: ATR, memoriu, planșe, caiet de sarcini.
   - Rezultatul: rânduri noi în tabelul `ofertare_cantitati_masuratori` (`cantitate_id`, `document_id`, `pagina`, `valoare`, `um`, `citat` cu fragmentul exact, `extras_de_ai`, `creat_la`), cu RLS ca la `ofertare_cantitati`.
   - Nu se suprascrie nimic în `ofertare_cantitati`.
2. **Regula de semnalare.**
   - Pentru un rând, dacă două surse diferă cu mai mult de **max(5%, 1 unitate)**, după conversia aceleiași UM, rândul primește semnalul „diferență între documente”.
   - Diferența pe ambele surse se vede în `OfertareCantitati` (lângă `*`-ul de azi) și în poarta graficului (`GraficPoarta.jsx`, care citește deja `diferenta_nota`).
   - Pragul e un parametru pe licitație (implicit 5%).
3. **Propunerea de clarificare.**
   - Pentru fiecare semnal, se propune automat o întrebare în `ofertare_clarificari`: `status` = `propusa`, `origine` = `diferenta_surse`, `baza_generare` = cele două citate, `surse_cantitati_ids` și `surse_document_ids` completate.
   - Textul are forma: „În F3 lungimea conductei DN… este X m (pagina…), iar în ATR Y m (pagina…). Vă rugăm să precizați valoarea corectă.”
   - Omul o aprobă, o modifică sau o respinge, ca pe orice clarificare. Nimic nu pleacă singur.
4. **Clarificările Autorității (pasul de legătură cu B).** Când se urcă un `raspuns_clarificare`, textul lui se compară cu semnalele deschise ale licitației (aceleași mărimi). Dacă răspunsul atinge un rând semnalat, rândul primește trimiterea la răspuns, iar propunerea noastră se marchează „acoperită de răspunsul Autorității”. Citirea automată din SEAP rămâne varianta B.

## 4. Ce NU face

- Nu schimbă cantitățile validate.
- Nu trimite clarificări.
- Nu citește SEAP automat (asta e B).
- Nu atinge prețuri.

## 5. Costuri și poartă

- Citirea suplimentară folosește extragerea AI existentă, în aceeași rulare plătită pornită de owner sau de responsabil (poarta pe cheltuială neschimbată).
- Pragul și tipurile de documente comparate limitează volumul. Documentele deja citite nu se recitesc.

## 6. Riscuri și probe

1. **Unități diferite** (m față de km, buc față de set): conversie explicită; fără conversie sigură nu se semnalează și nu se compară.
2. **Aceeași mărime pe obiecte diferite** (două tronsoane): potrivirea pe `obiect` + diametru + material. Ambiguu înseamnă „de verificat”, nu diferență.
3. **Citat inventat de AI:** citatul trebuie să existe literal în `text_extras` la pagina dată. Altfel măsurătoarea se respinge.
4. **Zgomot:** proba pe 3 licitații reale (cazul din tichet inclus). Semnalele false se numără înainte de livrare.

## 7. Livrare

- Spec → plan → Rocky: migrare (tabel + RLS + coloana `origine` în clarificări dacă lipsește) + extragerea + ecrane.
- Review Jakarinos și probă pe clonă. Aplicarea doar cu „da”.
