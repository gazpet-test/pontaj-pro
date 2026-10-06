# Temă pentru Copilot + Paw team — unde punem în platformă propunerea financiară și formularele F de ofertă

Data: 02.10.2026 · Cerut de: Răzvan · Status: DRAFT (se trimite după acordul lui Răzvan)

## Starea de fapt (ce există deja în Ofertare)
- **Propunerea tehnică (PT)**: `OfertarePropunere.jsx` — capitole (`ofertare_pt_capitole` + versiuni), legături cerință→capitol cu dovezi, poartă semnată (`ofertare_pt_poarta`), pachet de depunere cu fișiere + sha256 (`ofertare_pt_pachet`, `ofertare_pt_pachet_fisiere`), echipă, declarații, participanți (asociere/subcontractori), anexe așteptate, garanție (`ofertare_pt_garantie`).
- **Formulare de depus (E3)**: `OfertareClauzeFormulare.jsx` → `ofertare_formulare_registru` (cod, denumire, aplicabil, cine completează/semnează, stare pregătire/depunere, fișier + hash, ciornă AI prin edge fn `ofertare-clauze-formulare`, poartă pe cheltuială owner/responsabil). Formularele F (F1–F6 după HG 907/2016, centralizatoare, liste cantități) NU sunt modelate ca structură — doar ca rânduri în registru.
- **Cantități**: `OfertareCantitati.jsx` (extragere + aprobare + invalidare, poartă).
- **Referințe financiare**: `ReferinteFinanciare` în `OfertareLicitatii.jsx` (calibrări istorice, prețuri unitare, materiale; doc claude „anatomia-oferta-financiara").
- **Propunerea financiară**: NU există ca modul. Există doar `doc_propunere_financiara_path` pe proiect în Execuție (documentul depus, după câștig).

## Propunerea Claude (de contestat)
Un modul nou **„💰 Propunere financiară"** în Ofertare, frate cu PT, pe aceeași licitație, cu aceeași disciplină (versiuni, poartă semnată, pachet cu hash):
1. **Formularele F ca structură**, nu ca registru: F1 centralizator obiective, F2 centralizator obiecte, F3 liste cantități cu prețuri (derivate din `ofertare_cantitati` aprobate × prețuri din Referințe financiare), F4 utilaje, F5 manoperă, F6 grafic fizic/valoric (legat de graficul din PT — la Conpet e invers, vezi nota din OfertarePropunere.jsx:135).
2. **Sursa unică a prețurilor**: prețuri unitare cu proveniență (calibrare istorică / ofertă furnizor din RFQ / manual cu motiv) — nimic „scris de mână" fără urmă.
3. **Formularele administrative** rămân în E3 (`ofertare_formulare_registru`); F-urile financiare se mută în modulul nou și registrul le referă (cod + fișier generat + hash), ca pachetul de depunere să fie unul singur.
4. **Export**: xlsx (format autoritate) + PDF semnat în pachet; totalul propunerii = numărul care intră în formularul de ofertă (F-ul de ofertă financiară propriu-zis).
5. **Poartă**: ca la PT — verdict, semnat de responsabil, snapshot; după depunere, blocat.

## Întrebările pentru Copilot (GO/NO-GO pe direcție, nu pe cod)
- A. Modul separat „Propunere financiară" vs. extinderea PT cu o secțiune financiară? (Claude: separat — alte persoane lucrează, alte drepturi, alt moment.)
- B. F3 derivat din cantitățile aprobate (legătură tare) sau introdus liber cu reconciliere? (Claude: derivat, cu excepție motivată pe rând.)
- C. Unde stau prețurile unitare: tabel propriu per licitație cu proveniență, sau direct în Referințe financiare? (Claude: per licitație, cu referință la sursa din Referințe.)
- D. Ce NU trebuie să facem acum (Jilava 06.10 e prioritatea; HOLD-urile existente).

## Întrebările pentru Paw team (Gemini / Jakarinos / Ollie)
- Jakarinos (UX ofertare): fluxul de lucru real al Oanei/Silviu la F-uri — cine completează, în ce ordine, ce se corectează de 5 ori.
- Gemini: cercetare normativă — care sunt formularele F obligatorii azi (HG 907/2016, L98/2016 + normele, formulare SEAP) și ce diferă la Transgaz/Conpet/Distrigaz față de autoritățile locale.
- Ollie: riscuri de integritate (prețuri modificate după poartă, pachet cu hash, cine poate schimba totalul).

Livrabilul fiecăruia: o pagină, poziție + argumente; Răzvan decide. Nimic nu se construiește până la decizie.
