# Gemini 3.1 Pro — răspuns la tema „propunerea financiară + formularele F” (02.10.2026)

Canal: gem_pw.py (Edge CDP 9333), tema `TEMA_PROPUNERE_FINANCIARA_FORMULARE_F.md` + antet. Scriptul a prins doar antetul de gândire; textul de mai jos a fost copiat din tab de Răzvan și lipit în chat. Gemini se semnează „Copilot” pentru că antetul temei era adresat lui Copilot — autorul e Gemini. Text integral, formatarea refăcută minimal (tabelul de riscuri), conținut nealterat.

---

**Prioritate operațională:** Jilava (06.10.2026) rămâne 100% prioritară. Toate HOLD-urile pe Ofertare sunt menținute.

## Sinteză executivă & decizie recomandată
Arhitectura propusă de Claude este corectă conceptual și aliniată cu specificul achizițiilor publice din România, dar implementarea ei trebuie eșalonată strict după predarea proiectului Jilava. Separarea Propunerii Financiare (PF) de Propunerea Tehnică (PT) reflectă fidel modul real de lucru din firmele de construcții și cerințele legale privind protecția datelor financiare confidențiale până la momentul depunerii.

## A. Modul separat „💰 Propunere Financiară” vs. extinderea PT
**Poziție: DE ACORD cu modul SEPARAT (PF).**
- Segregarea rolurilor (SoD): echipa tehnică elaborează memoriile, graficul fizic, fișele tehnice, corelarea cu Caietul de Sarcini și nu are de ce să vadă adaosurile comerciale, cotele de indirecte, profitul sau prețurile negociate cu furnizorii critici. Echipa financiară / managementul stabilește marja, cotele de indirecte, discounturile și prețul final.
- Ciclu de viață distinct: PT se blochează (poartă semnată) mai devreme; PF e ultimul element ajustat, adesea cu câteva ore înainte de termenul SEAP (clarificări, oferte de ultim moment ale furnizorilor).
- Pachet unic la depunere: separarea în UI nu înseamnă pachete izolate — la nivel de BD și registru de depunere, PT + PF + formularele administrative E3 converg într-un pachet unic cu hash SHA-256.

## B. F3: derivat din cantități vs. introdus liber
**Poziție: DE ACORD cu DERIVAT (legătură tare cu ofertare_cantitati), cu mecanism de excepție motivată / reconciliere.**
- Risc critic de necorelare tehnic–financiar: F3 introdus liber ⇒ risc major de descalificare (ofertă neconformă/inacceptabilă) dacă nu coincide 100% cu cantitățile aprobate în PT și extrasul din PT/Caiet.
- Flux: F3 generat automat ca structură de articole și cantități din ofertare_cantitati (aprobate prin poartă). Valoare = cantitate aprobată × preț unitar.
- Excepție motivată pe rând: utilizatorul poate debloca local un rând; orice modificare manuală marchează rândul cu flag vizibil [EXCEPȚIE MANUALĂ], cere obligatoriu justificare și declanșează alertă de reconciliere la poarta de validare financiară.

## C. Unde stau prețurile unitare
**Poziție: DE ACORD cu tabel propriu per licitație (ofertare_pf_preturi_unitare), cu trasabilitate către Referințe Financiare.**
- Prețul e specific contextului: referința e punct de plecare (calibrare istorică / ofertă cadru); prețul final depinde de volum, condițiile de șantier (Jilava vs. Conpet/Distrigaz), termenii de plată și ofertele ferme obținute prin RFQ.
- Proveniență pe fiecare rând: SURSA_HISTORIC (calibrări), SURSA_RFQ (ofertă furnizor atașată licitației), SURSA_MANUAL (obligatoriu cu notă/motiv).
- Invariabilitate istorică (snapshot): modificarea ulterioară a unei referințe globale NU alterează retroactiv calculația unei licitații în derulare sau depuse.

## D. Ce NU facem acum
- ZERO linii de cod noi pe Ofertare / PF până la decizia finală a lui Răzvan și trecerea milestone-ului Jilava.
- Fără modificări pe ofertare_formulare_registru sau OfertareClauzeFormulare.jsx.
- Fără exporturi complexe de F-uri (XLSX/PDF cu formule) în această etapă.
- HOLD-urile existente rămân active.

## Matrice de riscuri
| Risc | Impact | Probabilitate | Măsură |
|---|---|---|---|
| Divergență F6 (grafic financiar) vs. graficul tehnic din PT | mare | medie | validare automată la poarta financiară: durata totală și eșalonarea din F6 trebuie să se potrivească cu milestones din PT |
| Prețuri unitare inconsistente (rânduri neacoperite) | mare | medie | poarta PF blochează generarea pachetului dacă există articole F3/F4/F5 cu preț 0 sau nevalidat |
| Modificări post-poartă / alterare hash | critic | scăzută | la semnarea porții financiare, tot modulul PF devine read-only; orice deblocare anulează semnătura și invalidează pachetul depus |
| Distragere resurse de la Jilava 06.10 | critic | ridicată | amânarea oricărei implementări până după 06.10.2026 |
