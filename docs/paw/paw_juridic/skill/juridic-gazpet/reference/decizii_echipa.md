# Echipa (Copilot, Jakarinos, Gemini) si deciziile deja luate cu ea

## 1. Rolurile si ordinea

| Consultant | Ce face bine | Rol |
|---|---|---|
| **Jakarinos** (Codex) | verifica pe sursa primara, prin cautarea web proprie (fara Firecrawl), cauta contraargumentele; cel mai sever. Nu tine minte intre apeluri: in brief pui verdictul lui anterior si ce s-a schimbat | **obligatoriu** pe orice concluzie cu miza (contestatie, clauza, pozitie fata de autoritate) |
| **Copilot** (GPT, conv. Juridic) | poarta GO/NO-GO, structura argumentului, riscuri procedurale | **obligatoriu** pe orice livrabil care pleaca din firma |
| **Gemini** (Argon) | a doua/a treia parere, corectii de arhitectura juridica (a adus 4 corectii esentiale la Lot 4). O conversatie pe lucrare (eticheta, ex. `laza-cnsc`), inchisa la final | suplimentar, cand e disponibil; NU e poarta |

**Minimul acceptat** cand nu sunt toti disponibili: **Jakarinos + Copilot**.
- Daca lipseste unul dintre ei, livrabilul poarta mentiunea "review incomplet: lipseste X".
- Daca lipsesc amandoi, livrabilul ramane "draft - nereviewuit" si Razvan e anuntat.

Cum lucrezi:
- Brief-ul are structura din `brief_echipa.md`. Acelasi brief merge la toti, ca verdictele sa fie comparabile.
- Verdictele se trec in livrabil, sectiunea "Review de echipa":
  - tabel cu "ce spuneam / corectia / sursa (cine)";
  - consensul;
  - verdictele individuale, cu procent.
- Divergenta mare (ex. 55-65% vs 20-35%) nu se mediaza in secret: se prezinta lui Razvan, cu motivul diferentei. Pozitia cea mai severa se trateaza ca risc real, nu ca zgomot.
- Spetele ANAP/CJUE pe care niciun consultant nu le-a putut verifica live NU intra intr-un document oficial pana nu sunt citite in sursa oficiala.

## 1b. Pagini web - regula de securitate (Razvan 27.10.2026)

- Consultantii (Jakarinos, Copilot, Gemini) nu deschid pagini pentru noi si nu au Firecrawl.
- Paginile le deschide Claude din sesiunea de pe serverul AI (cu Razvan in bucla), doar pe domeniile oficiale din `cautare_portale.md`; continutul ajunge ca text in brief.
- Motivul: un AI care are deodata date private, continut extern si iesire libera spre orice adresa poate fi pacalit sa scoata date afara.
- Nu se pun date interne in adrese web sau in cautari.

## 2. Decizii inchise (nu se redeschid fara fapte noi)

### Intrebari generale verificate cu echipa (pentru_echipa.md, Q1-Q4)
1. **Termen de contestare**: 10 zile peste pragurile JOUE, 7 zile sub praguri (L101 art. 8 alin. 1).
2. **Ordinul ANRE 17/2026** inlocuieste Ord. 132/2021. Termenul de conformare de 3 luni pentru autorizatiile existente a expirat in jurul datei de 26.08.2026 (data dedusa).
3. **ISCIR nu se aplica** retelelor de distributie gaze.
4. **NTPEE anexa 2 e orientativa.** Standardele sunt obligatorii doar prin trimitere expresa.

### Clarificari (decizii Razvan)
- Numele firmei apare doar in antet, NU in textul intrebarii.
- Unitatea de lucru = punctul de clarificare. Provenienta (documentul, pagina) se demonstreaza.
- Inainte sa intrebi autoritatea, verifici caietul de sarcini si memoriul.
- Intrebarea e neutra. Impactul intern (de ce ne doare) nu apare in textul catre autoritate.
- Temeiul pe punctul de clarificare (spec "B redus", 19.10.2026): Q1-A, Q2-B, Q3-A (detalii in `SPEC_B_REDUS_TEMEI_CLARIFICARI.md`).

### Lot 4 Transgaz / insolventa Moldocor (consens Copilot + Gemini + analiza, 22.10.2026)
- **Cadrul contractual:**
  - se aplica clauza 67.1, nu 67.2;
  - 64.1 lit. c nu e declansata (argument sistematic + art. 123 alin. 1 din L85/2014);
  - art. 123 e scut doar contra rezilierii pentru simpla deschidere a procedurii, NU contra neexecutarii, penalitatilor, GBE sau denuntarii 66.7.
- **Schimbarea liderului cu un membru existent e permisa.** Ordinea argumentelor:
  1. clauza 67.1;
  2. Instructiunea ANAP 1/2021 art. 7(2)b;
  3. modificarea nesubstantiala.
- **Riscurile, in ordine:**
  1. banii care intra in contul Moldocor la CEC;
  2. demonstratia ca lucrarile si calificarile raman acoperite;
  3. actul aditional la acord, semnat corect in insolventa.
- **Ce semnam si ce nu:**
  - toti asociatii semneaza orice act cu Transgaz, nimic "prin lider";
  - nu semnam recunoasteri ca 64.1 c e activa;
  - nu trimitem reflex administratorului judiciar cererea de pronuntare pe art. 123 alin. 1.
- **Notificarile catre Transgaz** cer confirmare de operare, nu aprobare.
- **Pana la 07.12.2026 se declara si creanta de regres sub conditie** (art. 102 alin. 4 L85).
- **Decizii Razvan** (handoff 27.10):
  - Comesad devine lider;
  - probele sunt lucrare a asociatului (acord 5.3);
  - nu se contesta insolventa.

### Laza / Vaslui (contestatie CNSC, 27.10.2026)
- Punctul de vedere a fost livrat lui Razvan si avocatului.
- Verdicte: Gemini 55-65%, Copilot 55-65%, Jakarinos 20-35%. Pozitia lui Jakarinos se trateaza ca riscul principal.
- Lectia centrala: art. 30(6) din HG 395/2016 acopera doar criteriile de calificare. Cerintele propunerii tehnice nu se completeaza ulterior (Manova C-336/12, Esaprojekt C-387/14).

## 3. Cand adaugi aici

Dupa fiecare review de echipa cu miza, adaugi in sectiunea 2:
- consensul;
- corectiile acceptate;
- verdictele cu procent;
- deciziile lui Razvan.

Pastrezi forma scurta: o linie pe decizie, cu trimitere la documentul complet. Ce nu e inchis nu intra aici; ramane in documentul dosarului.
