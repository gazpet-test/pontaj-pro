# Redări FAN — fluxul simplu pentru operator: un singur buton, urmărire automată, arhiva AWB, comanda curierului (SPECIFICAȚIE)

Stare: 18.11.2026, după primul AWB real (Testul 1, lot de TEST cu un plic), comanda manuală a curierului și proba SMS pe proiectul de test;
**trecerea a doua** (seara) adaugă deciziile D8–D11: pachetul de tipărit, evidența tipăririlor, bifarea automată „tipărit” și verificarea
generate / tipărite / ridicate; **trecerea a treia** (18.11.2026, tot seara) închide întrebările proprietarului Q1–Q6 (§15.1, toate pe
varianta recomandată) și adaugă deciziile D12–D14: AWB-ul pe hârtie **A5** în buzunarul transparent al curierului, imprimanta proiectului
(laser A4 față-verso, două tăvi), ordinea față-verso pe proprietar și laptopul proiectului; **trecerea a patra** (18.11.2026, după review-ul
Jakarinos NO-GO cu 6 × P1 pe `673dce4e`) scrie confirmările proprietarului D15–D18 și corectează contractele: plafonul zilei pe AMBELE ramuri
(§7.2), separarea strictă între COMENZILE operatorului și ÎNSCRIEREA rezultatelor externe, cu garda „doar TEST” și în BD (§7.3), ordinea exactă
a primei trimiteri pe un lot nemarcat (§8.1), O SINGURĂ ordine a lock-urilor în tot documentul (§6.2), reluarea aceleiași intenții după
crash (§8.3) și tabelul tranzițiilor care închid lotul (§8.8). **Doar document.** Nu există cod, migrare sau
schimbare de date în acest PR; migrările sunt DESCRISE (§13), nu scrise. Deciziile proprietarului D1–D18 (§0) și Q1–Q6 (§15.1) sunt **luate**
și nu se redeschid aici; ce rămâne deschis sunt doar întrebările către curier și juridic (§15.2, §15.3). Orice migrare,
RPC, automatizare sau drept propus aici **necesită acordul proprietarului** și se livrează în felii separate (§13), fiecare cu review propriu
(Jakarinos + Fable), după `docs/paw/LECTII_REVIEW.md` (§14).

Documentul are doi cititori. **Partea I (§1–§5)** e pentru proprietar: cum arată ziua operatorului, ce rămâne la el, ce se întâmplă singur,
ce NU face platforma. **Partea II (§6–§16)** e pentru recenzent și implementator. Proiectarea integrării (câmpuri, răspunsuri, cazurile
urâte, fișa de securitate a lanțului de azi) rămâne în `FANCOURIER_INTEGRARE.md`; procedura Testului 1 rămâne în `FAN_TEST1_PASI.md`. Acest
document NU le repetă: spune ce se schimbă față de ele și de ce.

Termeni: **operator** = coleg numit explicit de proprietar să trimită plicuri la curier (§7.1); **owner** = proprietarul (`is_owner`);
**lot** = lotul de plicuire din ✉️ Poștă (PV de plicuire semnat de doi colegi); **plic** = un deținător + un UAT, toate convocările lui;
**AWB** = numărul de expediere al curierului; **ridicat** = evenimentul curierului „preluat de la expeditor” (codul C0); **AR** = confirmarea
de primire; **oPOD** = opțiunea curierului prin care confirmarea semnată se întoarce fizic; **tiraj** = mulțimea tipărită odată (AWB-uri +
pagina de control + documente), cu identificatorul ei; **pachet de tipărit** = cele două fișiere ale unui tiraj: **pachetul A4** (un fișier
Word: pagina de control, apoi convocările + opisul fiecărui plic, tipărit față-verso din tava A4) și **pachetul A5** (un PDF: câte un AWB pe o
pagină A5, tipărit pe o singură față din tava A5); **imprimanta proiectului** = laserul monocrom A4 cu față-verso automat și două tăvi (A4, A5),
dedicat proiectului (D12); **laptopul proiectului** = calculatorul de la șantier (D14); **tipărit** = fișierul a fost predat de platformă
pentru tipărire (nu „foaia a ieșit”, §8.7); **curierul** = FAN Courier. „Eticheta AWB” = pagina AWB primită de la curier (PDF), indiferent pe ce
hârtie se tipărește.

Cuprins: 0. Deciziile proprietarului · **I.** 1. Ziua operatorului · 2. Ce rămâne la proprietar · 3. Ce se întâmplă singur · 4. Ce NU face
platforma · 5. În ce ordine livrăm · **II.** 6. Starea de azi (6.1 ce a arătat Testul 1 · **6.2 ordinea unică a lock-urilor**) · 7. Modelul de
drepturi și plafonul (7.2 plafonul pe ambele ramuri · **7.3 comenzi vs. înscrierea rezultatelor externe**) · 8. Butonul unic (8.1 prima trimitere
pe un lot nemarcat · 8.3 reluarea aceleiași intenții · 8.4.1 anularea în doi pași · 8.6 pachetul de tipărit: A4 față-verso, AWB pe A5, imprimanta
și laptopul · 8.7 evidența tipăririlor · **8.8 stările, tranzițiile și „lotul încheiat”**) · 9. Urmărirea automată (9.5 verificarea generate /
tipărite / ridicate) · 10. Arhiva · 11. Comanda curierului · 12. De la test la real · 13. Feliile livrabile (F1 exact) · 14. Lecțiile L01–L25 ·
15. Întrebările (proprietar: toate decise; curier, juridic: deschise) · 16. Ce nu s-a putut stabili din cod.

---

## 0. Deciziile proprietarului (18.11.2026) — nu se redeschid

D1–D11 au fost luate în prima și a doua trecere; D12–D14 și răspunsurile la Q1–Q6 (§15.1) în a treia; D15–D18 (confirmările din 18.11.2026,
după trecerea a treia) în a patra. Unde o decizie nouă o precizează sau o înlocuiește pe una veche, rândul vechi rămâne (istoric) și spune asta.

| # | Decizia | Unde o pune în practică documentul |
|---|---|---|
| D1 | Operatorul are UN buton: alege plicurile și apasă „Trimite la curier”; propunerea, aprobarea, generarea AWB-urilor și descărcarea etichetelor + paginii de control se fac în spate, cu un rezultat pe înțelesul lui. | §1, §8 |
| D2 | Butonul îl apasă DOAR operatorii numiți de proprietar (listă explicită, administrată de owner), fiecare din contul lui; evidența ține cine a trimis ce. NU un cont comun cu drept de owner. | §7.1 |
| D3 | Frâna pe bani = un PLAFON pus de owner (AWB-uri pe zi fără aprobare); peste plafon butonul se oprește și cere aprobarea owner-ului. | §7.2 |
| D4 | Urmărirea rulează automat de trei ori pe zi (08:00, 13:00, 18:00, ora României) și bifează singură, pe codurile limpezi: ridicat → „expediat” (AWB + data ridicării, de unde curg cele 10 zile); livrat → AR; refuzat / întors → retur. Codurile nelimpezi nu bifează nimic și intră într-o listă „de verificat”. Fiecare bifare rămâne în evidență cu codul și ora curierului. | §3, §9 |
| D5 | Eticheta (PDF) și dovada de livrare se salvează în dosarul plicului, lângă convocare și opis; arhiva ZIP a lotului le cuprinde (fișiere separate pe plic). | §10 |
| D6 | Comanda curierului din platformă; punctul de ridicare = punctul de lucru al contului de curier; persoana de contact implicită, configurabilă pe proiect. | §11 |
| D7 | ~~Eticheta pe A6 — întrebare deschisă către curier. Până la răspuns: varianta de micșorare făcută de platformă, probată pe imprimanta reală.~~ **Înlocuită de D12** (formatul implicit e A5; eticheta autocolantă A6 / 100 × 150 rămâne doar alternativă). | §8.6.3, §8.6.4 |
| D8 | PACHETUL DE TIPĂRIT se face singur după „Trimite la curier”, pentru toate plicurile cu date complete și AWB generat: (1) etichetele AWB, pentru imprimanta de etichete; (2) convocările + opisul, în ordinea plicurilor, pentru imprimanta A4, cu pagina de control (ce etichetă merge pe ce plic) în față. Operatorul apasă „Tipărește” de două ori, o dată pe fiecare imprimantă. NU tipărire silențioasă. **Precizată de D12**: „cele două imprimante” = cele două tăvi ale imprimantei proiectului (A5 pentru AWB-uri, A4 pentru convocări + opis); tot două apăsări, fără schimbat hârtia. | §1, §8.6 |
| D9 | EVIDENȚA TIPĂRIRILOR, separată de evidența AWB-urilor și de cea a expedierii: pe fiecare plic — ce s-a tipărit (eticheta; convocările + opisul), când, de către cine, de câte ori (retipăriri), ce a rămas netipărit. | §8.7 |
| D10 | Bifarea „tipărit” e AUTOMATĂ, în clipa în care pachetul plicului e predat pentru imprimantă (fără buton „Am tiparit”). Limita, spusă limpede: platforma știe că fișierul a fost trimis la tipărit, nu că foaia a ieșit. | §3, §8.7 |
| D11 | VERIFICAREA cu datele curierului, la fiecare urmărire automată (08 / 13 / 18): pe lot și pe zi, AWB-uri GENERATE vs TIPĂRITE vs RIDICATE; operatorul vede doar EXCEPȚIILE: (a) tipărit dar neridicat după o zi; (b) generat dar netipărit; (c) ridicat dar netrecut ca tipărit. Sus, un rând de control („azi: N generate, N tipărite, N ridicate, K de verificat”). | §3, §9.5 |
| D12 | FORMATUL AWB (înlocuiește D7 ca format implicit): AWB-ul se tipărește pe hârtie **A5** (o pagină A5 pe plic), introdus în **plicul transparent autocolant al curierului (17 × 22,5 cm)** lipit pe plicul nostru. Imprimanta dedicată proiectului: **laser monocrom A4, față-verso automat, două tăvi** (A4 pentru convocări + opis, A5 pentru AWB-uri) → două tipăriri pe lot, fără schimbat hârtia. Eticheta autocolantă 100 × 150 rămâne alternativă. Pachetul A5 iese ca fișier separat de cel A4. | §1, §8.6.1, §8.6.3 |
| D13 | FAȚĂ-VERSO implicit pentru convocări: imprimanta proiectului setată pe față-verso din Windows; pachetul A4 are un număr **PAR** de pagini pe fiecare proprietar (convocarea = o foaie: fața convocarea, versoul informarea; pagină albă adăugată unde e nevoie), ca versoul unui proprietar să nu ajungă pe foaia altuia; **opisul pe foaie separată, doar pe față, imediat după convocările aceluiași proprietar**. | §1, §8.6.2 |
| D14 | CALCULATORUL DE LA ȘANTIER = un laptop dedicat proiectului (Windows 11 Pro), cu cont de operator fără drept de administrator, disc criptat și acces de la distanță pentru suport; are Word / LibreOffice. | §1, §8.6.5, §16 |
| D15 | TIPĂRIREA PORNEȘTE DOAR DUPĂ CE TRIMITEREA ÎNTREGULUI LOT S-A ÎNCHEIAT (confirmă regula „lot încheiat înainte de tiraj” găsită în trecerea a treia): niciun AWB nu se tipărește cât lotul mai are plicuri în așteptare, aprobate netrimise, în curs sau cu rezultat necunoscut; tabelul tranzițiilor care închid lotul e la §8.8, garda e în BD. | §1, §8.1, §8.8, F1 |
| D16 | CONFIRMAREA DE PRIMIRE ȘI RETURUL sunt ÎNCHISE pe decizia proprietarului (Q4 A): AR automat doar cu dovada curierului arhivată și primitorul = destinatarul; retur definitiv doar cu plicul fizic întors. La juridic rămân DOAR: data ridicării ca dată a expedierii; AWB-ul cu confirmare în locul scrisorii recomandate; durata păstrării dovezilor; informarea colegului de contact. | §10.3, §12.2, §15.3 |
| D17 | PROPUNEREA DE ANULARE (Q6) apare ȘI pe loturile de TEST, ca să fie probată pe `TEST-RAZVAN` înaintea proiectului real; anularea rămâne un click al omului. | §9.5.2, §9.5.4, §12.3 |
| D18 | FUNCȚIA VECHE DE ANULARE (`fn_red_fan_anulat`, owner) RĂMÂNE până se publică cea nouă (funcția edge nouă + ecranul nou); retragerea ei = migrare separată, după publicare. Până atunci primește aceleași gărzi în BD ca primitivele noi (§7.3). | §8.4.1, §13 F1, §16 |

Există un cont de operator fără owner pentru probe (`redari@`, editor pe modulul Redări): cu el se probează fiecare felie pe `TEST-RAZVAN` (§12.3).
Deciziile din 17.11.2026 din `FANCOURIER_INTEGRARE.md` §12 rămân: **arhiva ZIP** a lotului (exemplarele de la dosar, fișiere separate pe plic) nu
dispare — D8 adaugă, pe lângă ea, **pachetul de tipărit** (ce merge la imprimante), care e alt lucru decât arhiva (§8.6.1).

---

# Partea I — pe înțelesul proprietarului

## 1. Ziua operatorului

Operatorul intră în ✉️ Poștă, deschide lotul de plicuire pe care l-a pregătit (plicurile lipite, opisul la dosar, PV-ul de plicuire semnat de
doi colegi) și apasă **„📦 Trimite la curier”**. Ecranul îi arată lista plicurilor din lot, cu bifă pe fiecare (toate bifate implicit), și
lângă fiecare plic un semn: verde „gata” sau galben „lipsește telefonul / județul / strada”. Plicurile galbene nu pot fi bifate: le repară din
fișa deținătorului (telefonul, adresa), apoi revine. Sus scrie cât mai poate trimite azi fără aprobarea proprietarului („azi mai poți trimite
17 plicuri fără aprobare”). Dacă alege mai multe decât încap, butonul îi spune înainte că **toată trimiterea** va aștepta aprobarea
proprietarului (Q2, decis A) — poate debifa câteva și trimite azi doar cât încape.

Lucrează pe **laptopul proiectului** (D14: Windows 11 Pro, contul lui de operator, fără drept de administrator, disc criptat, Word / LibreOffice
instalat, acces de la distanță pentru suport), legat de **imprimanta proiectului** (D12: laser A4 cu față-verso și două tăvi, A4 și A5).

Apasă **„Trimite la curier (12 plicuri)”** → o singură confirmare („Trimiți 12 plicuri la curier? Fiecare AWB costă.”) → așteaptă câteva
secunde → primește un singur mesaj, de exemplu:

> **12 AWB-uri generate, 1 respins: PL-HUS-0007 — lipsește telefonul.** Tarif: 326,40 lei fără TVA.
> Pachetul de tipărit e gata (tirajul 7B2C91A0): **[🖨 Tipărește AWB-urile (A5)]** (12 foi A5, tava A5) și
> **[🖨 Tipărește convocările + opisul (A4)]** (12 plicuri, față-verso, pagina de control în față). Pune fiecare AWB în buzunarul transparent
> de pe plicul lui, după pagina de control (poziția, numărul plicului, AWB-ul), și cheamă curierul.
> PL-HUS-0007: după ce completezi telefonul, mută-l într-un lot nou de plicuire și trimite lotul nou.

În spate s-au întâmplat, fără să le vadă: propunerea, aprobarea sub plafon, rezervarea, apelul plătit către curier, scrierea rezultatului,
etichetele și pagina de control (§8). Dacă ceva nu e limpede (curierul n-a răspuns, răspunsul e ciudat), mesajul e unul singur și spune
exact ce are de făcut: **„Răspunsul curierului nu s-a confirmat pentru 12 plicuri. NU retrimite. Apasă «Verifică la curier» după 10 minute.”**
Nimic nu se retrimite singur — un AWB dublu costă dublu.

**Tipărirea (D8, D10, D12, D13).** Operatorul apasă de două ori, pe aceeași imprimantă, fără să schimbe hârtia:
1. **„Tipărește AWB-urile (A5)”** — se deschide fereastra de tipărire a calculatorului cu PDF-ul AWB-urilor (câte unul pe pagină); el alege
   imprimanta „AWB A5” (coada din Windows legată de tava A5, §8.6.5) și dă „Print”. Iese câte o foaie A5 pe plic, în ordinea pozițiilor.
2. **„Tipărește convocările + opisul (A4)”** — se descarcă un singur fișier Word (Q1, decis A), îl deschide în Word (sau LibreOffice) și dă
   „Print” pe imprimanta „Convocări A4 față-verso”. Ies, în ordine: pagina de control, apoi pentru fiecare plic convocările (fiecare pe o foaie:
   fața convocarea, versoul informarea) și opisul (o foaie separată, doar pe față). Platforma pune fiecare document pe o foaie nouă, deci versoul
   unui proprietar nu ajunge niciodată pe foaia altuia (D13, §8.6.2).

Nimic nu se tipărește singur, pe furiș: fiecare foaie pleacă dintr-un „Print” apăsat de el. În clipa în care platforma îi predă fișierul,
bifează singură, pe fiecare plic din fișier, „AWB tipărit” / „convocările + opisul tipărite”, cu ora și numele lui — fără buton „Am tipărit”
(sunt sute de plicuri). **Limita, spusă cinstit:** platforma știe că fișierul a fost trimis la tipărit, nu că foaia a ieșit din imprimantă
(hârtie blocată, imprimantă oprită, „Print” anulat). De aceea există „Retipărește…” (același tiraj, cu un motiv din listă: hârtie blocată, foaie
deteriorată, pierdută) — operatorul îl poate folosi singur (Q3, decis B) — și verificarea cu datele curierului de la §3: un plic „tipărit” pe
care curierul nu l-a ridicat apare la el ca excepție.

**AWB-ul pe A5 (D12).** Curierul întoarce AWB-ul pe o pagină A4 întreagă (cu conținutul pe toată foaia). Pe A5 încape întreg, micșorat cu
aproximativ 70 % (A4 și A5 au aceeași proporție, deci nimic nu se taie și nimic nu se întoarce); codul de bare e desenat cu linii, nu e o poză,
deci se micșorează fără să se strice, iar barele rămân de câteva ori mai groase decât punctul imprimantei laser. Dacă AWB-ul micșorat se
citește și **prin folia buzunarului transparent** se află DOAR pe imprimanta proiectului, cu un plic de test ridicat de curier (§8.6.3) —
proba se face înaintea oricărui cod. Foaia A5 (14,8 × 21 cm) intră în buzunarul curierului (17 × 22,5 cm) fără să fie îndoită. Eticheta
autocolantă de 100 × 150 mm pe o imprimantă de etichete rămâne doar alternativa (§8.6.4).

**Plicurile respinse** (telefon lipsă, adresă nerecunoscută) nu se mai trimit pe lotul deja tipărit (Q5, decis A): operatorul le corectează
în fișa deținătorului, le mută într-un lot nou de plicuire și trimite lotul nou; lotul tipărit nu se mai atinge.

**AWB-urile care nu pleacă** (Q6, decis A): dacă un AWB a rămas netipărit 3 zile lucrătoare sau tipărit dar neridicat 3 zile lucrătoare,
platforma îi propune anularea; operatorul o face cu un click (doar înainte de ridicare), iar proprietarul vede lista anulărilor.

Apoi operatorul cheamă curierul (azi: din contul curierului, manual, §11), predă plicurile și **nu mai are nimic de făcut**: de trei ori pe zi
platforma întreabă curierul ce s-a întâmplat cu fiecare AWB și bifează singură ridicarea, livrarea și returul (§3). Ce nu e limpede apare la el
într-o listă scurtă „De verificat”, cu un buton „Verifică la curier” și cu ce să caute în contul curierului. **Rândul de control (D11)**, sus în
ecran, îi spune dintr-o privire dacă azi totul s-a închis: „azi: 12 generate, 12 tipărite, 12 ridicate, 0 de verificat”.

**Și SMS-ul?** SMS-ul de redări (probat azi pe proiectul de test: lot pe comună, trei destinatari, toate livrate) e o reamintire a sesiunii și îl
trimite pe proprietar la „QR-ul din scrisoare”. Deci ordinea firească e: plicul pleacă (ridicat de curier) și ajunge, abia apoi SMS-ul. Legătura
celor două e un singur fapt: data ridicării de pe plic (bifată automat la §3). Cum anume ține cont lotul de SMS de ea (avertisment sau excludere a
proprietarilor cu plicul neridicat) se hotărăște în felia SMS, nu aici (§9.5.5).

**Schița ecranului (text):**

```
┌ 📦 Trimite la curier — lotul PP-0012 (UAT HUS) ──────────────────────────────────────────────┐
│ Azi mai poți trimite 17 plicuri fără aprobarea proprietarului (plafon 20/zi; 3 trimise).   │
│                                                                                              │
│ [x] PL-HUS-0005  POPESCU I.   Str. …, Băbeni, Vâlcea     ✓ gata                              │
│ [x] PL-HUS-0006  IONESCU M.   Str. …, Băbeni, Vâlcea     ✓ gata                              │
│ [ ] PL-HUS-0007  GEORGESCU A. Str. …, Băbeni, Vâlcea     ⚠ lipsește telefonul (fișa deținătorului) │
│ …                                                                                            │
│ Selectate: 12 din 13 plicuri.                                                                │
│                                                                                              │
│ [ Trimite la curier (12 plicuri) ]                                   [ Verifică la curier ]   │
│                                                                                              │
│ Ultimul rezultat: 12 AWB-uri generate, 1 respins (PL-HUS-0007 — lipsește telefonul).        │
│ Tarif 326,40 lei fără TVA. Tirajul 7B2C91A0 — pachetul de tipărit:                           │
│   [ 🖨 Tipărește AWB-urile (A5, 12 foi) ]  [ 🖨 Tipărește convocările + opisul (A4, 12 plicuri) ] │
│   [ Retipărește… ]  (același tiraj; cere motivul: hârtie blocată / foaie deteriorată / …)     │
│   PL-HUS-0007 respins → corectează telefonul, mută-l într-un lot nou de plicuire.            │
│                                                                                              │
│ Control azi: 12 generate · 12 tipărite (AWB 12, documente 12) · 9 ridicate · 1 de verif.     │
│ Ultima urmărire: 19.11.2026 13:02.                                                           │
│                                                                                              │
│ De verificat (3): PL-HUS-0002 — curierul a dat două date de ridicare; PL-HUS-0003 — cod S65 │
│ „în așteptare”; PL-HUS-0009 — AWB tipărit pe 16.11, neridicat de 3 zile lucrătoare          │
│ → [ Anulează AWB-ul ] (doar înainte de ridicare; proprietarul vede lista anulărilor).        │
│ Deschide contul curierului și verifică; proprietarul / adminul soluționează.                  │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

Pe fiecare plic din listă, după trimitere, apare și evidența tipăririi (D9): „AWB: tipărit 19.11 09:40 de I. Popescu · documente: tipărite
19.11 09:41 (retipărite 1×: hârtie blocată)”, sau „AWB: NETIPĂRIT” cu roșu.

**Ce mai poate face operatorul singur** (Q3, decis B), în afara butonului: „Retipărește…” (același tiraj, cu motiv din listă), „Anulează AWB-ul”
pe un AWB neridicat (platforma cere întâi ștergerea la curier și abia după răspunsul lui scrie „anulat”, §8.4.1), „Confirmă: găsit” la „Verifică
la curier” (platforma reverifică la curier că AWB-ul e în borderou înainte să-l scrie, §8.2), „Retrage din trimitere” un plic aprobat dar încă
netrimis (sau o cerere de aprobare încă nedecisă) și „Reia trimiterea” când o trimitere a rămas neîncheiată (§8.3). Rămân la proprietar:
confirmarea că un AWB **nu există** la curier, „Tiraj nou” și lămurirea excepțiilor „ridicat dar netipărit” / „anulat după tipărire” (§2).
**Ce nu poate face niciodată operatorul**, nici din ecran, nici apelând platforma direct: să scrie el un AWB, o ridicare, o livrare sau o anulare
— faptele curierului le înscrie doar serverul, după ce le-a primit de la curier (§7.3).

Butoanele vechi (1. Propune … 7. Confirmări) nu dispar: rămân într-o casetă „Pași detaliați (owner)”, strânsă implicit, pentru
proprietar și pentru situațiile rare (confirmarea absenței la reconciliere, tiraj nou, soluționare).

## 2. Ce rămâne la proprietar

- **Lista operatorilor** (§7.1): din ecranul Redări → „Operatori curier”: adaugi / retragi un coleg; fiecare trimitere poartă numele lui.
  Un coleg care nu e pe listă vede butonul, dar dezactivat, cu motivul „doar operatorii numiți de proprietar”.
- **Plafonul zilnic** (§7.2): câte AWB-uri se pot aproba într-o zi (ora României) fără tine, pentru tot modulul; implicit mic (20), îl
  schimbi din ecran. Rămâne și plafonul pe lot de azi (câte plicuri pe un lot).
- **Cererile peste plafon** (Q2, decis A): când un operator cere mai mult decât permite plafonul zilei, **toată** trimiterea lui așteaptă
  (nu se trimite o parte) într-o casetă „Cereri de aprobare” pe care o vezi în Poștă (și pe lotul respectiv); apeși „Aprobă” sau „Respinge”,
  cu motiv; după „Aprobă”, operatorul (sau tu) apasă din nou „Trimite” și plicurile pleacă, fără să mai consume din plafon.
- **Lista anulărilor** (Q6, decis A): operatorul anulează singur AWB-urile neridicate (cu motiv din listă); tu vezi în Poștă lista lor — cine,
  când, ce AWB, ce motiv, dacă AWB-ul avea foaia tipărită (atunci intră și la lămuriri, mai jos).
- **Excepțiile**: marcarea unui lot ca TEST pe un proiect real (ca să probezi fără efect juridic), „Tiraj nou” (când foile tipărite
  trebuie distruse și refăcute), confirmarea că un AWB **nu există** la curier (deschide drumul unui al doilea AWB, deci cost), soluționarea
  unei contradicții a urmăririi (azi: tu sau un admin Redări).
- **Întrerupătoarele**: urmărirea automată pornită / oprită; arhivarea automată pornită / oprită; plafonul zilei pe 0 = totul cere aprobarea ta;
  **„doar proiecte de TEST”** — comutatorul care ține toate efectele (AWB-uri, ridicări, anulări) pe proiectele de test stă și în baza de date,
  nu doar în codul funcției (§7.3); cade abia la F4, cu „da”-ul tău și al juridicului (§12).
- **Lămurirea excepțiilor de tipărire** (D11, §9.5; Q3, decis B): un AWB ridicat de curier fără să fie trecut ca tipărit în platformă (foaia
  AWB a fost tipărită din contul curierului sau de pe un tiraj înlocuit) îl lămurești tu sau un admin Redări, cu motivul; un AWB tipărit și apoi
  anulat cere confirmarea că foaia AWB a fost distrusă. Operatorul le vede, dar nu le poate închide singur.
- **Imprimanta și laptopul proiectului** (D12, D14): cozile de tipărire din Windows („AWB A5”, „Convocări A4 față-verso”, §8.6.5) le pune
  suportul, cu drept de administrator, o singură dată; operatorul nu le poate strica (contul lui nu are drept de administrator).
- **La „Tiraj nou”**: platforma îți arată exact ce foi ale tirajului vechi au fost tipărite (foi AWB și documente, pe plic), ca lista de distrus
  să fie completă — nu mai e „toate foile”, e o listă bifabilă (§8.7.4).

## 3. Ce se întâmplă singur

De trei ori pe zi (08:00, 13:00, 18:00, ora României), pentru fiecare AWB neîncheiat:

| Ce spune curierul | Ce bifează platforma, singură | Ce vede operatorul |
|---|---|---|
| ridicat de curier (codul C0), o singură dată | pe un lot REAL: plicul devine „expediat” cu AWB-ul și **data ridicării** (ora României) — de aici curg cele 10 zile; pe un lot de TEST: doar evidența | plicul trece în registru ca expediat |
| livrat (codul S2) | plicul primește faptul „livrat de curier la <data/ora>”; AR-ul (confirmarea de primire) se bifează **doar când dovada curierului e arhivată** în dosarul plicului (§10) — altfel rămâne „livrat, dovada în așteptare” | „livrat · dovada arhivată” sau „livrat · dovada în așteptare” |
| refuzat / adresă greșită / mutat / întors (codurile de retur) | plicul primește faptul „retur semnalat de curier (<motiv>) la <data>”; returul **definitiv** (cel din PV B) rămâne cu scanul plicului întors, ca azi (§9.4; Q4, decis A) | „retur semnalat · plicul se întoarce” + buton „Înregistrează returul…” când sosește plicul |
| în tranzit / avizat / contactat / „AWB înregistrat” | nimic pe plic; se vede starea | „în drum”, „avizat”, „neridicat încă” |
| orice cod nelimpede, două date diferite pentru acelaşi fapt, livrat ȘI retur, dată imposibilă | **nimic**; plicul intră în „De verificat” | lista „De verificat”, cu codul și ora curierului |

Fiecare bifare automată rămâne în jurnal cu codul și **data** primite de la curier (curierul dă ziua ridicării; ora lui nu e promisă, §9.2), cu
rularea care a făcut-o, și se vede pe plic („bifat automat din urmărirea curierului, C0 din 19.11.2026”). Dacă mai târziu curierul contrazice ce a spus (altă dată de ridicare), platforma NU
înlocuiește singură: păstrează ce știa, pune noua valoare alături și cere omului să aleagă (ca azi).

Arhiva (§10): eticheta fiecărui AWB și dovada de livrare (în forma în care o dă curierul) se salvează singure în dosarul plicului, lângă opis
și convocare; „Documente lot (ZIP)” le cuprinde, ca fișiere separate pe plic.

**Bifarea „tipărit” (D10)** se face singură, în clipa în care platforma predă fișierul pentru imprimantă: pe fiecare plic din fișier se scrie ce
s-a tipărit (eticheta / convocările + opisul), ora, cine a apăsat și a câta tipărire e (§8.7). Platforma nu știe dacă foaia a ieșit; de aceea:

**Verificarea cu datele curierului (D11)**, la fiecare din cele trei urmăriri, pe fiecare lot și pe fiecare zi: câte AWB-uri s-au generat, câte
au AWB-ul tipărit, câte a ridicat curierul. Dacă cele trei numere se potrivesc, operatorul nu vede nimic în plus — doar rândul de control.
Dacă nu, apar DOAR excepțiile, fiecare cu ce e de făcut (§9.5):

| Excepția | Când apare | Ce vede operatorul | Ce are de făcut |
|---|---|---|---|
| (a) AWB tipărit, plic neridicat | de la ora 08 a celei de-a doua zile lucrătoare după tipărire, dacă curierul nu a dat „ridicat” și AWB-ul nu e anulat | „PL-… — AWB tipărit 19.11, neridicat” | verifică plicul fizic și comanda curierului (a fost chemat? a venit?); de la a 3-a zi lucrătoare platforma îi propune anularea, **el o face** (un click, doar înainte de ridicare; Q6, decis A) |
| (b) AWB generat, netipărit | de la ora 08 a zilei lucrătoare următoare generării, dacă nu există nicio tipărire a AWB-ului pe tirajul curent | „PL-… — AWB plătit, netipărit” | „Tipărește AWB-urile” (sau „Retipărește…”); de la a 3-a zi lucrătoare netipărit, platforma îi propune anularea, **el o face** (Q6, decis A) |
| (c) ridicat de curier, netrecut ca tipărit | imediat, la urmărirea care aduce „ridicat” pentru un AWB fără tipărire pe tirajul curent | „PL-… — ridicat de curier, dar AWB-ul nu a fost tipărit din platformă” | nimic de făcut de el; proprietarul / adminul lămurește (tipărit din contul curierului? tiraj înlocuit?) (Q3, decis B) |
| (d) anulat după tipărire | imediat, la anularea unui AWB care are foaia tipărită | „PL-… — AWB anulat; foaia AWB tipărită trebuie distrusă” | distruge foaia; proprietarul / adminul confirmă (Q3, decis B) |

Sâmbăta și duminica nu se numără ca zile lucrătoare; sărbătorile legale nu sunt cunoscute de platformă (limita e spusă în ecran). Retipăririle nu
schimbă numerele (un plic tipărit de trei ori e tot UN plic tipărit); ele se văd pe plic. AWB-urile anulate ies din toate cele trei numere și se
arată separat („2 anulate”).

## 4. Ce NU face platforma

- Nu trimite nimic la curier fără apăsarea unui operator numit; nu retrimite niciodată singură un plic al cărui rezultat nu s-a confirmat.
- Nu cheamă curierul singură (nici după ce comanda din platformă va exista: fiecare comandă e un apăsat de om, §11).
- Nu înregistrează singură un retur definitiv și nu bifează AR fără o dovadă arhivată; nu scrie nimic pe plic la codurile nelimpezi.
- Nu schimbă singură un fapt deja bifat (data ridicării) — o contradicție o soluționează un om.
- Nu trimite mailuri, SMS-uri sau mesaje colegilor; nu dă drepturi; nu șterge fișiere.
- Nu pune date personale în fișierele de lucru (pagina de control are destinatarul mascat; borderoul CSV n-are nume / telefoane).
- Nu bifează nimic pe proiectele reale cât timp garda „doar proiecte de TEST” e pornită (§12).
- Nu tipărește nimic singură și nu trimite nimic la o imprimantă pe furiș: fiecare foaie pleacă dintr-un „Print” apăsat de un om. Un program pe
  laptopul proiectului care să tipărească singur rămâne o variantă viitoare, doar dacă volumul o va cere (§8.6.6, cu riscurile ei).
- Nu pretinde că știe că foaia a ieșit: „tipărit” înseamnă „predat pentru tipărire” (D10); dovada că plicul a plecat e ridicarea curierului.
- Nu modifică AWB-ul primit de la curier (conținutul, codul de bare); cel mult îl așază micșorat (≈ 70 %) pe o pagină A5, și asta doar după
  proba reușită pe imprimanta proiectului (§8.6.3). Originalul primit de la curier rămâne neschimbat în arhivă.
- Nu anulează singură niciun AWB: propune anularea, un om o face (Q6).
- Nu șterge fișierele descărcate pe laptopul proiectului (pachetele de tipărit au date personale): rămân în dosarul de descărcări al contului
  de operator, pe discul criptat (D14); curățarea lor e o regulă de lucru a șantierului, nu o funcție a platformei (§16).

## 5. În ce ordine livrăm (detaliile la §13)

0. **Proba de hârtie, zero cod** (înaintea lui F1b, se poate face oricând, în paralel cu F1): pe imprimanta proiectului, AWB-ul Testului 1
   tipărit pe A5, pus în buzunarul curierului și citit (telefon, apoi curierul la ridicarea unui lot de TEST), plus un fișier A4 de probă
   față-verso cu două convocări și un opis (§8.6.3, §8.6.2).
1. **F1 — Operatorii numiți + butonul unic** (încă pe proiecte de TEST): cea mai mare ușurare pentru operator (șapte pași → unul), cu riscul
   ținut de garda „doar TEST”, de plafonul zilei și de plafonul pe lot; în ea intră și anularea făcută de operator, cu lista anulărilor pentru
   tine, și regula „lotul tipărit nu se mai atinge” (conținutul exact: §13 F1).
2. **F1b — Pachetul de tipărit + evidența tipăririlor** (D8–D10, D12, D13): fișierul A5 al AWB-urilor și fișierul Word A4 față-verso, cele
   două butoane „Tipărește”, bifarea automată, „Retipărește…” cu motiv, evidența pe plic; tot pe proiecte de TEST. Forma fișierului A4 e
   decisă (Q1 A); felia așteaptă doar rezultatul probei de hârtie.
3. **F2 — Urmărirea automată + verificarea generate / tipărite / ridicate** (D4, D11): trei rulări pe zi; pe loturile de TEST scrie doar
   evidența, deci se probează fără efect juridic; rândul de control, excepțiile și propunerea de anulare se calculează la fiecare rulare.
4. **F3 — Arhiva** (AWB-ul pe plic, dovada de livrare, AR-ul automat doar cu dovadă și primitor = destinatar, Q4 A).
5. **F4 — Trecerea la proiectul real** (garda „doar TEST” cade; cere „da”-ul juridic, §12).
6. **F5 — Comanda curierului din platformă** (după răspunsul curierului la întrebările din §15.2).
7. **F6 — AWB-ul pe A5 făcut de platformă** (doar dacă e nevoie): dacă proba de hârtie arată că micșorarea din fereastra de tipărire
   depinde prea mult de setări (scara diferă de la o tipărire la alta), platforma face ea PDF-ul A5 (cod mic, §8.6.3); dacă proba merge cu
   fereastra de tipărire sau curierul dă A5 direct, rămâne zero cod.

Ce ne trebuie de la tine înainte de F1: **nimic din §15.1** — toate cele șase întrebări sunt decise (18.11.2026). Înainte de F1b: proba de
hârtie pe imprimanta proiectului. Înainte de F4 (proiectul real): „da”-urile de la §12.2. Întrebările către curier și juridic (§15.2, §15.3) nu
opresc F1.

---

# Partea II — pentru recenzent și implementator

## 6. Starea de azi (ce există și ce se refolosește)

Lanțul de azi (`FANCOURIER_INTEGRARE.md` §3–§6) are tot ce îi trebuie fluxului nou ca **primitive**; ce lipsește e orchestrarea, poarta de
operator, plafonul zilnic, cronul, arhiva și comanda curierului.

| Există azi (se refolosește neschimbat sau cu poarta lărgită) | Unde |
|---|---|
| corpul expedierii, hash-ul aprobat, amprenta surselor, bucățile de ≤ 100, interpretarea răspunsurilor, manifestul comun, cheia de tiraj | `supabase/functions/_shared/redariFan.mjs` |
| calea reală: login, creare în loturi cu claim → POST → rezultate (L04/L05/L22), urmărire / confirmări în bucăți, etichete pe manifest cu tiraj, reconciliere, ștergere | `redariFanTransport.mjs` |
| poarta funcției edge: JWT → utilizator → **owner** → cerere → lot (RLS) → flag → garda „doar TEST” → abia apoi secretele | `redariFanHandler.mjs`, `redari-fan-awb/index.ts` |
| tabelele `red_fan_awb` (un rând viu pe plic, stări, fapte + contradicții, versiune CAS), `red_fan_loturi` (marcaj TEST / real imuabil, tiraj + oprire), `red_fan_setari` (plafonul pe lot); 19 funcții `fn_red_fan_*`; RLS citire admin / editor; scrieri doar prin RPC | `20261212a_redari_fan_awb.sql` (aplicată 17.11.2026) |
| ecranul cu cei 7 pași + operațiile; simulatorul procedurii; testele | `src/redari/fanLot.js`, `ui/FanAwbPrevizualizare.jsx`, `fanCourier*.test.js` |
| bucket-ul privat `redari`, politici admin / editor (SELECT, INSERT; fără UPDATE / DELETE), calea plicului `plicuri/<plic_id>/…`, scanul AR / retur verificat în Storage de trigger | `20261126a`, `20261129i` |
| tiparul cron → edge cu poartă internă: pg_cron (postgres) → `net.http_post` cu antetul `x-intern-secret` din Vault → edge verifică prin `fn_verifica_secret` (EXECUTE doar `service_role`), fail-closed | `20261011a_sec_edge_poarta_intern.sql`, `cleanup-recycle-bin`, `api-consum-extern` |
| registrul automatizărilor (fișa a–e pe coloane) | `public.automatizari` (`20261010a`) |
| descărcările din ecran (`descarcaBlob`: legătură `download` pe un Blob — browserul doar salvează fișierul; nu există nicio cale de tipărire directă); pagina de control și opisul ca DOCX construite din zero (`docxSimplu`); convocatorul din șablonul `convocator.docx` completat în browser, cu QR-ul ca imagine (`adaugaRelatieImagine`) și versoul adăugat prin editarea `word/document.xml` cu JSZip (`adaugaVersoInformare`) — adică repo-ul știe deja să deschidă, să modifice și să reîmpacheteze DOCX-uri | `src/redari/docx.js`, `plicuri.js` |
| jurnalul modulului (`red_jurnal`: tabela, `user_id`, `date_noi` fără date personale) | existent |

### 6.1 Ce a arătat Testul 1 (18.11.2026) și intră în proiectare

- **Generarea**: un click, un AWB. Răspunsul acțiunii către ecran NU a adus AWB-ul și tariful; ambele au apărut în rândul din BD → ecranul le
  citește din rând după scrierea rezultatelor (corectat în #1132), iar mesajul operatorului (§8.5) se construiește din rândurile recitite, nu din
  răspunsul curierului. Tariful din rând a diferit de oferta comercială (§15.2 pct. 5).
- **Asocierea pe poziție** a mers: eticheta întoarsă de curier purta referința plicului (câmpurile de observații și conținut) — verificarea celor
  trei numere (`FANCOURIER_INTEGRARE.md` §12) stă în picioare, deci pagina de control rămâne cheia pachetului de tipărit (§8.6).
- **Eticheta a venit pe A4** (595 × 842 pt), cu conținutul pe toată pagina (190 × 277 mm), vectorial — text și linii, trei imagini mici — deși
  cererea a trimis `format=A6` (§8.6.3). **Expeditorul de pe etichetă = punctul de lucru al contului de curier**, nu sediul (D6, §11).
- **Comanda curierului** s-a dat manual din aplicația lui web; câmpurile și regulile observate sunt la §11 (nu se folosesc apelurile interne ale
  aplicației lor în platformă: nu sunt API-ul public).
- **SMS-ul de redări** a fost probat pe proiectul de test (lot pe comună, trei destinatari, livrate): e o reamintire care trimite la QR-ul din
  scrisoare → plicul întâi, SMS-ul după ridicare / livrare (§9.5.5).

Ce se schimbă la primitive (corectat în trecerea a patra, Jakarinos P1 „operatorul poate fabrica fapte ale curierului”): drumul butonului se
împarte în DOUĂ clase de RPC-uri (§7.3). **Comenzile** operatorului (propunere + aprobare + plafoane într-un RPC, începerea tirajului, cererea de
anulare, retragerea, reluarea) primesc poarta „operator numit SAU owner”, cu identitatea celui care apasă (`auth.uid()`) în coloanele de autor.
**Înscrierea rezultatelor externe** (rezervarea înaintea apelului plătit, rezultatele generării, urmărirea, confirmările, „găsit” la
reconciliere, anularea confirmată de curier, încheierea intenției) NU e apelabilă de niciun om: RPC-uri noi cu EXECUTE exclusiv `service_role`,
chemate doar de funcția edge după poarta omului. Primitivele owner de azi rămân pentru calea detaliată și pentru excepțiile manuale ale
owner-ului, cu gărzile noi în corp (§7.3, §13 F1).

### 6.2 Ordinea unică a lock-urilor (L06) — valabilă în TOT documentul

O singură ordine, pentru toate căile (om, funcție edge, cron, revenire) și pentru toate feliile; fiecare RPC / trigger care blochează rânduri din
mai multe tabele o scrie în comentariul lui și ia DOAR un subșir al ei, în această ordine (niciodată un element dinaintea altuia deja luat):

| # | Tabel (lock) | Cine îl ia | Observații |
|---|---|---|---|
| 1 | `red_loturi_plicuire` — rândul lotului `FOR UPDATE` | comanda, propunerea, aprobarea, claim-ul, tirajul (începere / oprire / înlocuire), înregistrarea tipăririi, marcajul | serializează tot ce schimbă manifestul sau marcajul unui lot |
| 2 | `red_plicuri` — plicurile atinse `ORDER BY id FOR UPDATE` | comanda, aprobarea, claim-ul, ridicarea (om și cron), anularea (cerere și înscriere), retragerea | **plicul înaintea rândului FAN** — aliniat cu `fn_red_fan_ridicat` și `fn_red_fan_anulat` existente (plic → AWB) |
| 3 | `red_fan_awb` — rândurile `ORDER BY id FOR UPDATE` | toate cele de mai sus + rezultatele, urmărirea, confirmările, soluționarea, reconcilierea, înregistrarea tipăririi | rezultatele / urmărirea / confirmările iau DOAR acest element (subșir) |
| 4 | `red_fan_loturi` — rândul lotului FAN `FOR UPDATE` | comanda (marcajul automat, citirea tirajului), tirajul, marcajul manual, înregistrarea tipăririi | DUPĂ rândurile FAN (corectat: §8.7.2 îl avea înaintea lor) |
| 5 | `red_fan_setari` — rândul unic `FOR UPDATE` | comanda (plafonul zilei), setările | serializează aprobările din tot modulul |
| 6 | `red_fan_zi` — rândul zilei (`SELECT … FOR UPDATE`, apoi `INSERT … ON CONFLICT`: lock-ul implicit pe aceeași cheie) + `red_fan_zi_consum` | comanda | §7.2 |
| 7 | `red_fan_cereri_aprobare` — cererea `FOR UPDATE` / `INSERT` | comanda, decizia owner-ului, retragerea cererii | — |
| 8 | `red_fan_intentii` — `INSERT … ON CONFLICT DO NOTHING` (lock implicit pe cheie) sau `FOR UPDATE` | comanda, încheierea, reluarea, închiderea `neincheiata` | intenția se blochează AICI, nu la începutul RPC-ului (corectat: §8.1 o avea prima, §13 după lot) |
| 9 | `red_fan_tiparire_pachete` (`INSERT … ON CONFLICT`) → `red_fan_tipariri` (F1b) | înregistrarea tipăririi | — |
| 10 | `red_fan_tiparire_lamuriri`, `red_fan_rulari` (F2); `red_fan_comenzi` (F5) | lămurirea; cronul; comanda curierului | — |
| 11 | `red_jurnal` — `INSERT`, ÎNTOTDEAUNA ULTIMUL | toate | nu se citește sub lock |

- **Lock-urile implicite** (numărate, L06): `INSERT` în `red_fan_awb` / `red_fan_loturi` / `red_fan_cereri_aprobare` / `red_fan_intentii` ia
  `KEY SHARE` prin cheile străine pe `red_proiecte`, `red_loturi_plicuire`, `red_plicuri` — rândurile lotului și ale plicurilor sunt deja ale
  noastre (1, 2); `red_proiecte` nu e luat `FOR UPDATE` de nicio cale FAN (doar `KEY SHARE`), deci nu intră în niciun ciclu. `INSERT … ON CONFLICT`
  blochează rândul-cheie existent (`red_fan_zi`, `red_fan_intentii`, `red_fan_tiparire_pachete`) exact în poziția tabelului lui. Trigger-ele
  BEFORE de pe `red_fan_awb` / `red_fan_loturi` / `red_plicuri` nu iau lock-uri pe alte tabele (citesc doar OLD / NEW).
- **Cronul** (§9): urmărirea / confirmările = o tranzacție pe bucată, DOAR elementul 3 (rânduri `ORDER BY id`); bifarea pe plic = **altă
  tranzacție**, pe rând: 2 (plic) → 3 (rândul FAN, CAS pe `versiune_urmarire`) → 11 — ca `fn_red_fan_ridicat`; niciodată plicul după rândul FAN
  și niciodată bifarea în aceeași tranzacție cu scrierea urmăririi (ar inversa 2 și 3).
- **Revenirile**: `LOCK TABLE … NOWAIT` pe tabelele atinse în aceeași ordine (1 → 11), apoi verificarea „fără date”.
- Proba: PGlite + două sesiuni pe clonă (comanda ∥ începerea tirajului; comanda ∥ cronul de bifare; înregistrarea tipăririi ∥ comanda) — fără
  deadlock (nici `40P01`, nici așteptare peste `lock_timeout`), rezultatele serializate.

## 7. Modelul de drepturi și plafonul

### 7.1 Operatorii numiți (D2)

**Unde se ține lista**: tabel nou `red_fan_operatori`, nu nivelul de acces existent. De ce: (1) nivelul `editor` pe modulul Redări e dat
multor colegi pentru alte lucrări (fișe, convocări, PV-uri) — a-l face „drept de a cheltui” ar lărgi tacit drepturi existente; (2) un nivel
nou în `user_module_access` ar schimba CHECK-ul unui tabel **comun** tuturor modulelor (CLAUDE.md pct. 6: nu se atinge fără cerere); (3) owner-ul
a cerut o listă explicită, cu istoric (cine a numit, când, cine a retras). Nivelul pe modul rămâne **precondiție**: un operator trebuie să fie
și admin / editor Redări (altfel RLS-ul nu îl lasă să citească plicurile și contactele) — două chei, nu una.

```
red_fan_operatori (
  profile_id uuid PRIMARY KEY,                -- contul colegului (fără FK spre profiles: ar cere lock la aplicare, ca în 20261212a)
  numit_de uuid NOT NULL, numit_la timestamptz NOT NULL DEFAULT now(),
  retras_de uuid, retras_la timestamptz,       -- retragerea NU șterge rândul (istoric); re-numire = rând nou? NU: același rând, retras_* golite, cu jurnal
  nota text CHECK (nota IS NULL OR length(nota) <= 200),
  CONSTRAINT red_fan_operatori_retras CHECK ((retras_de IS NULL) = (retras_la IS NULL))
)
```
- RLS: SELECT pentru `authenticated` cu `auth.uid() IS NOT NULL AND fn_red_nivel() IN ('admin','editor')` (operatorul își vede starea, ecranul
  afișează lista owner-ului); fără INSERT / UPDATE / DELETE pentru nimeni; scrieri doar prin RPC.
- `fn_red_fan_operator_seteaza(p_profile uuid, p_activ boolean, p_nota text)` — SECURITY DEFINER, `SET search_path = public, pg_temp`, EXECUTE
  doar `authenticated`, poarta în corp: `fn_red_fan_e_owner()`; refuză un profil fără nivel Redări admin / editor (verificare internă pe
  `user_module_access`, într-o funcție internă fără EXECUTE pentru roluri; nu sondează alte conturi din UI); refuză `p_profile = auth.uid()`?
  NU — owner-ul se poate numi și pe el (e oricum peste poartă); fiecare schimbare = rând în `red_jurnal` (tabela `red_fan_operatori`,
  `user_id = auth.uid()`). Coloanele de autor le pune serverul (L08).
- `fn_red_fan_e_operator()` — SECURITY DEFINER, STABLE, EXECUTE pentru `authenticated` (ecranul o cheamă ca să afișeze butonul):
  `fn_red_fan_e_owner() OR (auth.uid() IS NOT NULL AND fn_red_nivel() IN ('admin','editor') AND EXISTS (rând activ pentru auth.uid()))`.
  O SINGURĂ definiție (L19): o cheamă RPC-urile, funcția edge (`deps.operator()` în locul lui `deps.owner()` pe acțiunea `trimite`) și ecranul.
- **Pe server, niciodată din client**: identitatea = `auth.uid()` din JWT-ul omului (L08); funcția edge NU primește rolul în corp; RPC-urile
  verifică poarta în corp, nu doar prin EXECUTE. Testul negativ: contul `redari@` fără rând în listă → 403 pe `trimite`, 42501 pe RPC-uri;
  cu rândul retras → la fel; viewer cu rând → refuz (nivelul e precondiție).
- **Ce se întâmplă cu poarta owner de azi** (corectat în trecerea a patra — detaliul și tabelul complet la §7.3): rămâne owner pe
  `fn_red_fan_setari_seteaza` și setările noi, `fn_red_fan_lot_marcheaza` (marcajul manual TEST / real — excepțiile), înlocuirea tirajului,
  `fn_red_fan_reconciliaza` (confirmarea absenței = drum spre al doilea AWB; și forma manuală „găsit” a owner-ului), `fn_red_fan_ridicat`
  (ridicarea confirmată manual de owner), `fn_red_fan_anulat` (anularea verificată manual de owner în contul curierului, D18),
  `fn_red_fan_cerere_decide` (§7.2), lista operatorilor. Devine „operator sau owner” DOAR pentru **comenzi**: `fn_red_fan_comanda` (propunere +
  aprobare sub plafon + plafoane), începerea / confirmarea tirajului, cererea de anulare, retragerea din trimitere, reluarea intenției.
  **Nu devine niciodată apelabilă de operator** înscrierea unui fapt extern: rezervarea (claim), rezultatele generării, urmărirea, confirmările,
  „găsit” la reconciliere, anularea confirmată de curier, încheierea intenției — toate trec pe RPC-uri noi cu EXECUTE exclusiv `service_role`,
  chemate de funcția edge după ce a verificat omul (§7.3). Soluționarea contradicțiilor și lămurirea excepțiilor (c) / (d) rămân owner / admin
  Redări (Q3 B).

### 7.2 Plafonul (D3)

**Unitatea (D3): AWB-uri aprobate pe ZI (ora României), pe tot modulul** — nu pe lot (lotul e unitatea de tipărire, nu de cost) și
nu pe proiect (în primul val e un singur proiect). Plafonul pe lot de azi (`limita_lot`) rămâne ca a doua frână (un lot aberant de 1.400 de
plicuri nu trece oricum). Unitatea e decisă (D3); valoarea inițială: 20 pe zi până după Testul 2.

- `red_fan_setari` primește: `limita_zi integer NOT NULL DEFAULT 20 CHECK (limita_zi BETWEEN 0 AND 5000)` (0 = orice trimitere cere
  aprobarea owner-ului), `doar_proiecte_test boolean NOT NULL DEFAULT true` (garda „doar TEST” în BD, §7.3), `urmarire_auto_activa boolean NOT
  NULL DEFAULT false`, `arhivare_auto_activa boolean NOT NULL DEFAULT false`. **Semnătura veche rămâne** (Jakarinos: „păstrarea semnăturii vechi
  pentru setări”): `fn_red_fan_setari_seteaza(integer)` (plafonul pe lot) nu se schimbă, pentru ecranul vechi; setările noi au RPC-uri proprii,
  câte unul pe setare, owner: `fn_red_fan_setari_limita_zi(p_limita integer)` (0…5000), `fn_red_fan_setari_doar_test(p_activ boolean)`,
  în F2 / F3 `fn_red_fan_setari_urmarire_auto(boolean)` / `fn_red_fan_setari_arhivare_auto(boolean)`; fiecare schimbare în `red_jurnal`
  (tabela `red_fan_setari`, valoarea veche → nouă, `user_id = auth.uid()`). Fără supraîncărcare pe nume (PostgREST ar alege ambiguu între
  semnături). `limita_zi` și `doar_proiecte_test` vin în F1; cele două întrerupătoare vin în F2 / F3, odată cu funcțiile care le citesc (§13).
- **Numărarea atomică, pe AMBELE ramuri** (L01: lock înainte de verificare, fără insert-apoi-count; corectat în trecerea a patra — Jakarinos P1:
  forma `INSERT … ON CONFLICT DO UPDATE … WHERE … <= limita` verifica plafonul DOAR la actualizarea unui rând existent, iar prima inserare a zilei
  accepta orice `n`, inclusiv peste limită și la limita 0). Tabel `red_fan_zi (zi_ro date PRIMARY KEY, aprobate integer NOT NULL DEFAULT 0 CHECK
  (aprobate >= 0))` + registrul consumului `red_fan_zi_consum (awb_id uuid NOT NULL, zi_ro date NOT NULL, intentie uuid NOT NULL, la timestamptz
  NOT NULL, PRIMARY KEY (awb_id, zi_ro))`. În `fn_red_fan_comanda` (§8.1), în ordinea §6.2:
  1. `SELECT limita_zi INTO v_limita FROM red_fan_setari WHERE id FOR UPDATE` (un singur rând → serializează toate aprobările din modul;
     tranzacția e scurtă: doar scrieri în BD, apelul plătit e în afara ei);
  2. `v_azi := (clock_timestamp() AT TIME ZONE 'Europe/Bucharest')::date` (L17; `CURRENT_DATE` e UTC);
  3. `SELECT aprobate INTO v_acum FROM red_fan_zi WHERE zi_ro = v_azi FOR UPDATE; v_acum := coalesce(v_acum, 0)` — **zi absentă = 0, explicit**;
  4. `v_n` = rândurile care AR consuma plafonul acum (cele noi + cele re-propuse; NU cele deja numărate azi — rândul are deja `red_fan_zi_consum`
     pe `v_azi` — și NU cele `aprobat` rămase dintr-o trimitere anterioară sau aprobate de owner);
  5. **verificarea, o singură dată, înaintea oricărei scrieri, pe orice ramură**: `IF v_acum + v_n > v_limita THEN` → toate rândurile cererii →
     `de_aprobat` + cerere (Q2 A), **nimic scris în `red_fan_zi` / `red_fan_zi_consum`**, `RETURN`; cu `v_limita = 0` orice `v_n ≥ 1` ia această
     ramură, inclusiv prima trimitere a zilei;
  6. altfel `INSERT INTO red_fan_zi (zi_ro, aprobate) VALUES (v_azi, v_acum + v_n) ON CONFLICT (zi_ro) DO UPDATE SET aprobate = red_fan_zi.aprobate + v_n
     RETURNING aprobate INTO v_dupa` și `INSERT INTO red_fan_zi_consum (awb_id, zi_ro, intentie, la) SELECT …` pentru fiecare rând numărat;
  7. **postcondiție în RPC** (nu doar în teste): `IF v_dupa IS NULL OR v_dupa <> v_acum + v_n OR v_dupa > v_limita THEN RAISE … USING ERRCODE =
     'P0001'` — tranzacția cade, nimic aprobat (nu se poate întâmpla sub lock-ul setărilor; dacă se întâmplă, e un defect, nu o aprobare).
  **Garda în BD pe orice cale** (L07): trigger `BEFORE INSERT OR UPDATE ON red_fan_zi` (`fn_red_fan_zi_garda`): `NEW.aprobate > (SELECT limita_zi
  FROM red_fan_setari)` → refuz `P0001`; `NEW.aprobate < OLD.aprobate` → refuz (contorul nu scade; o retragere nu restituie plafonul). Nimeni nu
  are GRANT de scriere pe cele două tabele. **Paritatea** (postcondiție în probe, exactă): `red_fan_zi.aprobate` = `count(*)` din
  `red_fan_zi_consum` pe aceeași zi — sursa parității e registrul consumului, NU `aprobat_la` (care e rescris la re-propunere / re-aprobare, deci
  nu poate fi numitor; Jakarinos, „contorizarea la re-propunere”). **Re-propunerea** (datele plicului s-au schimbat după aprobare → rândul revine
  `propus`): la următoarea trimitere rândul consumă plafonul din nou DOAR dacă nu l-a consumat deja în aceeași zi (`PRIMARY KEY (awb_id, zi_ro)`:
  conflict = numărat deja azi → nu se mai numără); consumat într-o altă zi → se numără (e o aprobare nouă, în altă zi). Aprobarea owner-ului
  (`fn_red_fan_cerere_decide`, și calea veche `fn_red_fan_aproba`) pune `aprobare_owner_la = clock_timestamp()` și NU scrie în registru.
- **Probele obligatorii ale plafonului** (PGlite + două sesiuni pe clonă; așteptările din acest paragraf, nu din cod, L25):
  | # | Caz | Așteptat |
  |---|---|---|
  | P1 | zi absentă (niciun rând în `red_fan_zi`), `limita_zi = 0`, cerere cu 1 plic | 0 aprobate, 1 `de_aprobat`, cerere `deschisa`; `red_fan_zi` fără rând; `red_fan_zi_consum` gol |
  | P2 | zi absentă, `limita_zi = 5`, cerere cu 6 plicuri | 0 aprobate, 6 `de_aprobat`; `red_fan_zi` fără rând |
  | P3 | zi absentă, `limita_zi = 5`, cerere cu 5 | 5 aprobate; rândul zilei `(azi, 5)`; 5 rânduri în consum |
  | P4 | zi cu `aprobate = 3`, `limita_zi = 5`, cerere cu 3 | 0 aprobate, 3 `de_aprobat`; rândul zilei rămâne 3 |
  | P5 | **doi operatori pe muchie** (două sesiuni reale, barieră): zi absentă, `limita_zi = 5`, ambii cu 3 | exact unul trece (rândul zilei 3), celălalt `de_aprobat`; ordinea nu contează |
  | P6 | mutant: verificarea de la pasul 5 scoasă de pe ramura „zi absentă” | P1 și P2 trebuie să PICE (dovada că proba prinde defectul semnalat) |
  | P7 | re-propunere în aceeași zi (rând numărat azi, datele schimbate, retrimis) | plafonul nu crește a doua oară; paritatea `aprobate = count(consum)` ține |
  | P8 | cerere aprobată de owner (`cerere_decide`) | `aprobare_owner_la` pus, rândul zilei neschimbat, nimic în consum |
  | P9 | `fn_red_fan_setari_…` coboară `limita_zi` sub `aprobate` de azi, apoi o cerere cu 1 | `de_aprobat` (nu eroare); trigger-ul refuză orice `UPDATE` care ar depăși |
  | P10 | scriere directă `INSERT` / `UPDATE` în `red_fan_zi` ca `authenticated` | `42501` (fără GRANT), înaintea trigger-ului |
- Doi operatori deodată: al doilea așteaptă lock-ul rândului de setări (milisecunde), apoi vede contorul actualizat; nu pot trece amândoi
  „pe muchie” (P5).
- **Peste plafon**: tot clickul așteaptă (Q2, decis A; nu se trimite „câte încap”) — rândurile intră în starea nouă
  `de_aprobat` (adăugată în CHECK-ul `red_fan_awb.stare`; nu intră în manifest, nu se tipăresc, nu se rezervă), legate de un rând nou
  `red_fan_cereri_aprobare (id, lot_id, proiect_id, cerut_de, cerut_la, n, zi_ro, stare CHECK IN ('deschisa','aprobata','respinsa'), decis_de,
  decis_la, motiv ≤ 500)` cu `red_fan_awb.cerere_aprobare_id`; stările cererii: `deschisa` → `aprobata` | `respinsa` | `retrasa` (CHECK derivat din
  §8.8). Owner-ul vede cererile deschise (casetă în Poștă + pe lot) și apasă „Aprobă” / „Respinge” → `fn_red_fan_cerere_decide(p_id, p_aproba
  boolean, p_motiv)` (owner; ordinea §6.2: lot FOR UPDATE → plicurile rândurilor ORDER BY id → rândurile FAN ORDER BY id → cererea FOR UPDATE →
  jurnal; aprobare = rândurile încă `de_aprobat` ale cererii, cu plicul încă activ și în lot → `aprobat` cu `aprobat_de = auth.uid()` (owner),
  `aprobat_la` și `aprobare_owner_la = clock_timestamp()` — **nu consumă plafonul zilei** și nu scrie în `red_fan_zi_consum`; un rând al cărui plic
  nu mai e activ / în lot → `retras` (motiv `plic_mutat` / `plic_anulat`, §8.8); respingere = rândurile → `propus`, cererea `respinsa`; CAS pe
  `stare = 'deschisa'`). **Retragerea cererii** (Jakarinos P1-6): `fn_red_fan_cerere_retrage(p_id)` — operatorul care a cerut (`cerut_de =
  auth.uid()`) sau owner-ul; CAS `deschisa` → `retrasa`, rândurile → `propus`; aceeași ordine de lock. După aprobare, trimiterea efectivă (claim →
  POST) se face la următorul apăsat pe „Trimite” (operator sau owner), care găsește rânduri `aprobat` și NU le mai numără. Ecranul spune înainte
  de apăsare cât mai încape azi, ca operatorul să poată alege mai puține plicuri.
- Plafonul pe lot rămâne în `fn_red_fan_aproba` / în RPC-ul nou, neschimbat ca regulă (deja aprobate / trimise + cele de acum ≤ `limita_lot`);
  rândurile `de_aprobat` ale lotului se numără și ele la „deja” (conservator: o cerere aprobată ulterior nu poate duce lotul peste plafon).

### 7.3 Comenzile operatorului vs. înscrierea rezultatelor externe (Jakarinos P1: „operatorul poate fabrica fapte ale curierului”)

**Problema**: RPC-urile sunt apelabile direct prin PostgREST cu JWT-ul omului. Dacă poarta `rezultate` / `urmarire` / `confirmari` / `ridicat` /
`anulat` ar fi „operator sau owner”, un operator ar putea, fără niciun apel la curier, înscrie un AWB ales după un claim, o urmărire fabricată, o
ridicare (cu efect juridic pe un lot real) sau o anulare fără `DELETE /awb`. CAS-ul verifică starea rândului, NU confirmarea externă; garda „doar
TEST” din handler nu protejează apelurile directe.

**Regula**: fiecare RPC FAN e în exact UNA din trei clase; clasa e scrisă în comentariul funcției și verificată de postcondiții (EXECUTE exact).

| Clasa | Ce înscrie | Cine o poate apela (EXECUTE + poarta în corp) | Identitatea | Exemple |
|---|---|---|---|---|
| **A. Comenzi** | intenția omului: ce vrea să trimită / să tipărească / să anuleze / să retragă | `authenticated`; în corp `fn_red_fan_e_operator()` (operator numit sau owner) sau `fn_red_fan_e_owner()` | `auth.uid()` al omului, NULL = refuz (L08) | `fn_red_fan_comanda`, `fn_red_fan_tiraj` (începere / confirmare), `fn_red_fan_anulare_cere`, `fn_red_fan_retrage`, `fn_red_fan_cerere_retrage`, `fn_red_fan_tiparire_inregistreaza` (F1b), `fn_red_fan_operator_seteaza`, setările, `fn_red_fan_cerere_decide`, `fn_red_fan_lot_marcheaza`, înlocuirea tirajului |
| **B. Înscrierea rezultatelor externe** | ce a spus curierul sau ce a făcut serverul: rezervarea înaintea apelului plătit, AWB-urile și tarifele, urmărirea, confirmările, „găsit” în borderou, anularea confirmată de curier, încheierea intenției, bifarea automată | **EXCLUSIV `service_role`** (`REVOKE … FROM PUBLIC, anon, authenticated`); în corp: `auth.uid() IS NULL` (un JWT de om pe această cale = refuz `42501`), `p_actor` re-verificat intern ca operator / owner activ, legătura cu intenția / cererea / rularea | serverul (funcția edge sau cronul); omul care a apăsat = `p_actor uuid`, transmis de funcția edge DUPĂ ce l-a verificat ea din JWT (singura excepție L08: „cale server cu rol verificat explicit”); la cron `p_actor NULL` + `p_rulare` | `fn_red_fan_srv_claim`, `fn_red_fan_srv_rezultate`, `fn_red_fan_srv_urmarire`, `fn_red_fan_srv_confirmari`, `fn_red_fan_srv_reconciliaza` („găsit” reverificat în borderou), `fn_red_fan_srv_anuleaza`, `fn_red_fan_srv_intentie_incheie`; F2: `fn_red_fan_srv_bifeaza`, `fn_red_fan_srv_rulare`; F3: `fn_red_fan_srv_arhiva` |
| **C. Excepțiile manuale ale owner-ului** (D18) | un fapt pe care owner-ul l-a verificat EL în contul curierului | `authenticated`; în corp `fn_red_fan_e_owner()` | `auth.uid()` = owner | `fn_red_fan_ridicat(p_id, p_data)` (ridicare confirmată manual), `fn_red_fan_reconciliaza` (absența = `eroare`; și „găsit” manual), `fn_red_fan_anulat(p_id, p_awb, p_motiv)` (anulare verificată în selfAWB), `fn_red_fan_urmarire_solutioneaza` (owner / admin), `fn_red_fan_exceptie_lamureste` (F2) |

- **Primitivele owner de azi** `fn_red_fan_claim_lot`, `fn_red_fan_rezultate`, `fn_red_fan_urmarire`, `fn_red_fan_confirmari` rămân owner
  (clasa C de fapt: azi le cheamă funcția edge veche cu JWT-ul owner-ului pe acțiunea `genereaza` / `urmarire` / `confirmari`) **neschimbate ca
  semnătură și poartă** până la publicarea funcției edge noi; apoi retragerea lor e o migrare separată (lecția „dreptul folosit de clientul
  vechi”). În F1 primesc în corp DOAR gărzile noi: `fn_red_fan_lot_permis` (mai jos), `lot_tiparit` / „lot încheiat” unde e cazul (§8.8) —
  cu amprenta md5 a corpului vechi verificată înaintea `CREATE OR REPLACE`.
- **Cum dovedește serverul că rezultatul vine de la curier**: nu criptografic (curierul nu semnează răspunsurile). Dovada e **lanțul**: (1)
  secretele curierului există doar în funcția edge; (2) clasa B e apelabilă doar de `service_role`, cheie pe care niciun client (ecran, operator,
  owner) nu o are — un om primește `42501` înaintea oricărei verificări de corp; (3) funcția edge cheamă clasa B DOAR după poarta omului (JWT →
  operator → cerere → lot RLS → flag → garda TEST) și DOAR cu rezultatul formei stricte de succes a răspunsului curierului (ca azi:
  `interpreteazaRaspunsCreare`, `rezumatUrmarireFan`, forma de succes a lui `DELETE /awb`); (4) fiecare înscriere e legată de un pas durabil
  anterior creat de același lanț (claim → `cerere_id`; comandă → `intentie`; cron → `rulare_id`) și e CAS pe el; (5) jurnalul (`red_jurnal`) ține
  `sursa` (`edge` / `cron`), `actor` (p_actor) și `cerere_id` / `rulare_id`. Ce NU garantează: un răspuns fals al curierului (sau un server
  compromis) ar fi înscris — asta nu se schimbă față de azi și e acoperit de verificările omului (D11, reconciliere).
- **`service_role` în funcția edge `redari-fan-awb`** (nou; fișa a–e a funcției se actualizează în `FANCOURIER_INTEGRARE.md` §7 la F1): un al
  doilea client, construit din `SUPABASE_SERVICE_ROLE_KEY` (Edge Secret standard al proiectului), folosit **DOAR pentru RPC-urile clasei B**, DOAR
  după poarta omului, DOAR cu `p_actor` = `user.id` din JWT-ul verificat; **nicio citire** cu el (lotul, plicurile, contactele, rândurile FAN se
  citesc în continuare cu JWT-ul omului, sub RLS, L09); nicio scriere directă pe tabele (nu are GRANT de scriere: `REVOKE ALL … FROM service_role`
  pe tabelele FAN rămâne, iar RPC-urile sunt DEFINER). Justificarea (CLAUDE.md pct. 7 (c)): singura alternativă ar fi EXECUTE `authenticated`, ceea
  ce recreează exact defectul semnalat. Test negativ obligatoriu: clasa B cu cheia anon → `42501`; cu JWT de owner → `42501`; cu `service_role`
  dar `p_actor` fără rând de operator activ → `42501`; `p_actor` al unui operator **retras** între comandă și rezultat → rezultatele se scriu
  totuși (banii s-au cheltuit; L20) cu jurnal „operator retras între timp”, dar nicio comandă nouă.
- **Garda „doar TEST” în BD, pe tot ce produce efecte** (Jakarinos P1-2, ultima frază): funcție internă `fn_red_fan_lot_permis(p_lot_id uuid) →
  boolean` (fără EXECUTE pentru roluri; o singură definiție, L19) = `NOT red_fan_setari.doar_proiecte_test OR (red_fan_loturi.test IS TRUE AND
  red_proiecte.cod LIKE 'TEST-%')`, citită sub lock-urile deja luate (lotul, rândul FAN al lotului). O cheamă, înaintea oricărei scrieri de
  efect: `fn_red_fan_comanda` (aprobarea), toate RPC-urile clasei B, `fn_red_fan_ridicat`, `fn_red_fan_anulat`, `fn_red_fan_reconciliaza`,
  `fn_red_fan_claim_lot` / `fn_red_fan_rezultate` / `fn_red_fan_urmarire` / `fn_red_fan_confirmari` (cele vechi, cât rămân), începerea tirajului
  — refuz `RD032` „doar proiecte de TEST”, nimic scris. Handler-ul își păstrează constanta `DOAR_PROIECTE_TEST` ca PRIMA poartă (înaintea
  secretelor, fără citiri în plus); BD-ul e a doua, pe orice cale. F4 le schimbă pe amândouă în același PR (migrare `fn_red_fan_setari_doar_test(false)`
  cu „da”-ul proprietarului + constanta), cu un test de paritate (constanta și flagul din BD trebuie să coincidă; dezacord = `423` în handler).
  Probe: ca owner, `fn_red_fan_ridicat` pe un rând al unui lot marcat REAL cu flagul pornit → `RD032`; `fn_red_fan_srv_rezultate` (ca
  `service_role`) pe un lot real → `RD032`; `fn_red_fan_comanda` pe un lot al unui proiect fără prefix `TEST-` → `RD032` înaintea marcajului
  automat (§8.1); același set cu flagul oprit (pe PGlite) → trece.
- **Scriere directă pe tabele** (L07): rămâne fără niciun GRANT de INSERT / UPDATE / DELETE pentru `authenticated` și `service_role` pe toate
  tabelele FAN (vechi și noi); proba: `PATCH /red_fan_awb` ca operator → `42501`.

## 8. Butonul unic: orchestrarea peste lanțul existent

### 8.1 Ce refolosește, ce e nou

| Pas al butonului | Azi | În fluxul nou |
|---|---|---|
| citirea plicurilor, contactelor, corpului, hash-ului, amprentei surselor | ecran + funcția edge (`pregatestePlicuriFan`, `amprenteSurse`) | neschimbat, în funcția edge |
| propunere | `fn_red_fan_propune` (un plic pe apel, admin / editor) | logica ei devine funcție internă (fără EXECUTE), chemată din RPC-ul nou pentru fiecare plic |
| marcaj TEST / real | owner, manual, înainte de aprobare | **automat** la prima trimitere, ÎN `fn_red_fan_comanda`, sub lock, în ordinea exactă de mai jos (Jakarinos P1-3): `test = proiectul e TEST-` dacă lotul nu are marcaj; un marcaj pus de owner înainte (excepție) se respectă; după prima aprobare rămâne imuabil (trigger existent) |
| aprobare | `fn_red_fan_aproba` (owner, pe hash-urile văzute în ecran, plafon pe lot) | aceleași verificări + plafonul zilei (§7.2), în RPC-ul nou, autor = operatorul |
| rezervare → apel plătit → rezultate | `fn_red_fan_claim_lot` → `POST /intern-awb` → `fn_red_fan_rezultate` (owner, cu JWT-ul lui) | **clasa B** (§7.3): `fn_red_fan_srv_claim` → `POST` → `fn_red_fan_srv_rezultate`, chemate de funcția edge cu `service_role` + `p_actor` + `p_intentie`; corpurile = cele de azi + legătura cu intenția; niciun om nu le poate apela |
| etichete + pagina de control | acțiunea `eticheta` pe fiecare parte, apăsată de owner; tiraj | chemată **automat** de funcția edge pentru toate părțile, în același răspuns; pagina de control o face ecranul ca azi (`controlLotFan`) |
| rezultatul | mesajul tehnic („Generate: 1; respinse: 0; necunoscute: 0…”) | un mesaj pe înțelesul operatorului (§8.5) |

**RPC nou `fn_red_fan_comanda(p_lot_id uuid, p_intentie uuid, p_plicuri jsonb, p_hash_cerere text)`** — clasa A (§7.3): SECURITY DEFINER,
`search_path` fix, EXECUTE `authenticated`, poarta în corp `fn_red_fan_e_operator()`. `p_plicuri` = `[{plic_id, hash}]` (hash-ul corpului calculat
de funcția edge din citirile ei — același cu cel pe care l-ar fi aprobat owner-ul azi); `p_hash_cerere` = sha256 pe lista canonică a plicurilor
(idempotență, L04). Într-O tranzacție (L02), în **ordinea unică §6.2** (scrisă în comentariul funcției):

1. `red_loturi_plicuire FOR UPDATE` (lotul; `P0002` dacă lipsește) → `proiect_id`, `red_proiecte.cod` (citite, fără lock).
2. plicurile cerute `ORDER BY id FOR UPDATE` → rândurile FAN vii ale lotului `ORDER BY id FOR UPDATE` (toate, nu doar cele cerute: starea lotului
   — §8.8 — se evaluează sub lock).
3. `red_fan_loturi FOR UPDATE` → **marcajul, în ordinea exactă (Jakarinos P1-3)**: (a) dacă rândul lipsește: `IF doar_proiecte_test AND cod NOT
   LIKE 'TEST-%' THEN RAISE RD032` (niciun marcaj pe un proiect real cât garda e pornită); altfel `INSERT red_fan_loturi (lot_id, proiect_id,
   test = (cod LIKE 'TEST-%'), marcat_de = auth.uid())` + `red_jurnal` („marcaj automat la prima trimitere”); (b) dacă rândul există (owner-ul l-a
   marcat manual — excepția): se respectă așa cum e; (c) **verificarea completă**: `fn_red_fan_lot_permis(p_lot_id)` (§7.3) pe rândul acum
   existent → `RD032` dacă nu trece. Toate înaintea oricărei aprobări și a oricărui apel la curier (care e oricum în afara tranzacției).
   Trigger-ul existent al marcajului (`BEFORE UPDATE OR DELETE`) nu e atins: INSERT-ul automat e permis, iar după prima aprobare rândul e imuabil
   ca azi. `marcat_de` poate fi de acum și un operator (doar prin această cale, doar pe TEST).
4. tot sub `red_fan_loturi`: dacă `tiraj_cheie IS NOT NULL` → **lotul tipărit nu se mai atinge** (Q5 A): orice plic cerut fără rând viu `generat` /
   `ridicat` e exclus cu `motiv_cod = 'lot_tiparit'` („mută plicul într-un lot nou de plicuire”), iar rândul lui `propus` / `aprobat` (dacă există)
   trece în `retras` (§8.8) — niciun plic nou nu intră în manifestul unui lot deja tipărit; începerea tirajului ia și ea lotul `FOR UPDATE`, deci
   cele două se serializează.
5. pentru fiecare plic cerut: verificările din `fn_red_fan_propune` + `fn_red_fan_aproba` (activ, neexpediat, fără AWB, în lot; hash-ul cerut =
   hash-ul recalculat); un rând viu `propus` / `aprobat` / `de_aprobat` se refolosește (re-propunere: `lot_id` / `proiect_id` ale rândului se
   aliniază la plicul de azi — azi `fn_red_fan_propune` le lăsa pe cele vechi la un plic mutat), altul = refuz pe acel plic cu motiv, nu pe toată
   cererea — plicul intră la „excluse”; un rând `aprobat` / `de_aprobat` al cărui plic nu mai e activ / în lot → `retras` automat (§8.8).
6. `red_fan_setari FOR UPDATE` → plafonul pe lot (§7.2, ultimul punct) → **plafonul zilei pe ambele ramuri** (§7.2 pașii 2–7, inclusiv
   `red_fan_zi` / `red_fan_zi_consum`): dacă încape → `aprobat` (`aprobat_de = auth.uid()`, `aprobat_la`, `intentie_cheie = p_intentie`), altfel
   **toate** → `de_aprobat` + cerere `deschisa` (Q2 A; nicio aprobare parțială) — `red_fan_cereri_aprobare` la poziția 7.
7. `red_fan_intentii` (poziția 8): `INSERT … ON CONFLICT (cheie) DO NOTHING RETURNING`; fără rând → contractul de reluare / replay din §8.3 (se
   evaluează ACUM, cu toate lock-urile luate, nu la începutul funcției — o singură ordine); cu rând → `in_curs`, `lucru_pana_la =
   clock_timestamp() + 10 min`.
8. `red_jurnal` (ultimul): un rând pe comandă (`eveniment: 'comanda'`, intenția, numărul de aprobate / de_aprobat / excluse, fără PII).
9. întoarce `{intentie, reluare: boolean, aprobate: [id…], de_trimis: [id…] (aprobate acum + `aprobat` rămase din trimiteri anterioare sau din
   cereri aprobate de owner, nenumărate), de_aprobat: n, cerere_id, excluse: [{nr_plic, motiv_cod}], retrase: [{nr_plic, motiv_cod}]}`.

**Tirajul pornește doar pe lotul încheiat** (D15, urmare a Q5 A): etichetele (și deci tirajul) se cer doar când lotul e **încheiat** în sensul
exact din §8.8: niciun rând `de_aprobat` / `aprobat` / `in_curs` / `necunoscut` pe lot, nicio cerere `deschisa`, nicio intenție `in_curs` cu
`lucru_pana_la` în viitor. Rândurile `propus` rămase NU blochează (sunt resturi, nu trimiteri în curs; după tiraj ele nu mai pot intra în lot —
`lot_tiparit` → `retras`). Altfel (429, limita de 5 solicitări pe apăsat, cerere de aprobare încă deschisă, „necunoscut”, intenție în curs)
răspunsul spune „AWB-urile se tipăresc după ce se termină trimiterea lotului” și tirajul nu începe — ca manifestul să nu se schimbe după tipărire
(fără „Tiraj nou” din cauza unei trimiteri în două reprize). Garda stă în BD, într-o singură funcție internă `fn_red_fan_lot_incheiat(p_lot_id) →
boolean` (L19), chemată de `fn_red_fan_tiraj` la începere (refuz **`RD031`** „lot neîncheiat”; corectat: trecerea a treia scria `RD022`, cod deja
folosit de `fn_red_fan_tiraj` pentru „oprește și așteaptă 30 s”) și de `fn_red_fan_tiparire_inregistreaza` (F1b), nu doar în funcția edge (L07).
Fiecare stare care poate ține lotul deschis are o ieșire definită (tabelul §8.8), deci „neîncheiat” nu e permanent.

**Acțiune nouă în funcția edge: `trimite`** (`ACTIUNI_FAN` + `raspundeFan`): corp `{actiune:'trimite', lot_id, plic_ids:[uuid…] (1…2000),
intentie: uuid}`. **Ordinea exactă pentru un lot nemarcat** (Jakarinos P1-3 — garda de azi cere `fanLot.test === true` ÎNAINTE de RPC, ceea ce ar
bloca prima trimitere, pentru că marcajul automat se face în RPC):
1. JWT → utilizator → **operator** (nou: `deps.operator()` = `fn_red_fan_e_operator`; `403 non_operator`) → cerere → lot (RLS) → flag
   `TRANSPORT_REAL_ACTIV`;
2. garda „doar TEST” **pe proiect**: `transportPermis({ proiectCod, fanLot, cereMarcaj: false })` (parametrul există deja în `redariFanHandler.mjs`)
   — proiectul fără prefix `TEST-` → `423 transport_real_doar_test`, nimic chemat; un lot deja marcat REAL de owner → tot `423` aici (marcajul e
   citit și e `test = false`);
3. citirile cu JWT-ul omului → **`fn_red_fan_comanda`** (JWT-ul omului; marcajul automat sub lock, verificarea completă în BD — pasul 3 de mai sus);
4. **recitirea** `red_fan_loturi` (JWT, RLS) → `transportPermis({ …, cereMarcaj: true })` — verificarea completă, în handler, pe marcajul acum
   existent; refuz `423` dacă nu trece (nu se poate întâmpla după pasul 3; dacă se întâmplă e un defect și se oprește aici, nimic plătit);
5. abia acum secretele curierului → bucla claim → `POST` → rezultate, **cu clientul `service_role`** (`fn_red_fan_srv_claim(p_actor, p_intentie,
   …)` → `POST /intern-awb` → `fn_red_fan_srv_rezultate(p_actor, p_intentie, p_cerere, p_rezultate)`), oprire la primul „necunoscut” (L05); fiecare
   pas reînnoiește `lucru_pana_la` (§8.3);
6. dacă lotul e încheiat (`fn_red_fan_lot_incheiat`, recitit) și are cel puțin un AWB: etichetele pe toate părțile (logica `eticheta`,
   `fn_red_fan_tiraj` cu JWT-ul omului — e o comandă — început / confirmat / reverificat după PDF) → `fn_red_fan_srv_intentie_incheie` (§8.3) →
   răspuns `{rezultat, pdf_parti:[base64…], tiraj, manifest_cheie, ramase, tarif_total, respinse:[{nr_plic, motiv_cod}], excluse, retrase,
   necunoscute, oprit, reluare}`. `pdf_parti` sunt PDF-urile curierului **neschimbate** (pagini A4); trecerea pe A5 e la tipărire (§8.6.3).
Fără etichete când lotul nu e încheiat (manifestul nu e sigur). Dacă etichetele pică (502) după AWB-uri generate, răspunsul spune că AWB-urile
există și că se pot tipări cu „Tipărește AWB-urile” mai târziu (același tiraj, aceeași cerere la curier, nu costă). **Proba obligatorie** (vitest
pe handler + PGlite + live pe `TEST-RAZVAN`): un lot de TEST **fără niciun marcaj anterior** → `trimite` trece de pasul 2, RPC-ul inserează
marcajul `test = true` cu `marcat_de` = operatorul, pasul 4 trece, AWB-urile se generează; același lot pe un proiect fără prefix `TEST-` → `423` la
pasul 2 și, la apel direct al RPC-ului, `RD032` fără rând în `red_fan_loturi`; un lot marcat manual REAL de owner pe un proiect `TEST-` → `423` la
pasul 2 (marcajul owner-ului se respectă, nu se rescrie).

### 8.2 Atomicitate și reluare

- **Fiecare pas durabil e în BD înaintea pasului plătit** (L22): aprobarea (`fn_red_fan_comanda`) și rezervarea (`fn_red_fan_claim_lot`) sunt
  tranzacții separate; apelul plătit e între rezervare și rezultate; rezultatele unei solicitări se scriu toate odată (`fn_red_fan_rezultate`).
- **Întrerupere între aprobare și generare** (funcția edge moare, rețea): rândurile rămân `aprobat`, nimic plătit, intenția rămâne `in_curs` cu
  `lucru_pana_la` în viitor cel mult 10 minute. Reluarea e **aceeași intenție** (§8.3: „Reia trimiterea”, aceeași cheie, fără dublă aprobare);
  dacă operatorul nu reia, următorul apăsat pe „Trimite” cu o cheie nouă, după expirarea lui `lucru_pana_la`, închide intenția veche
  (`neincheiata`) și preia rândurile `aprobat` fără să le numere din nou (plafonul s-a consumat la aprobare). Ecranul arată „12 plicuri aprobate,
  netrimise” și butonul spune „Trimite (12 aprobate + 3 noi)”.
- **Întrerupere între rezervare și rezultate** (rândurile `in_curs`) sau răspuns „necunoscut”: **niciodată regenerare** (L05). Ecranul arată
  „trimitere neîncheiată: N plicuri cu rezultat necunoscut” și butonul „Trimite” e dezactivat pe acel lot până la reconciliere. „Verifică la
  curier” (operator) = acțiunea `reconciliaza` existentă pe ziua trimiterii, în funcția edge: ea citește borderoul curierului și propune
  „găsit: AWB …” / „nu apare în borderoul complet” / „de verificat în selfAWB”. **„Confirmă: găsit”** (operator) NU scrie AWB-ul din ecran: trimite
  funcției edge `{actiune:'reconciliaza', confirma:{id}}`, iar funcția edge **recitește borderoul**, verifică că AWB-ul e acolo pentru `nr_plic`-ul
  rândului și abia apoi cheamă clasa B `fn_red_fan_srv_reconciliaza(p_actor, p_id, p_awb, p_tarif, p_tva)` (CAS pe `necunoscut` / `in_curs` > 10
  min, `fn_red_fan_lot_permis`) — un operator nu poate alege el AWB-ul (Jakarinos P1-2). „Nu apare în borderoul complet” o confirmă DOAR owner-ul
  (`fn_red_fan_reconciliaza` cu `p_awb NULL`, clasa C: deschide un al doilea AWB); „de verificat în selfAWB” n-are buton. Fereastra de 10 minute
  pentru `in_curs` rămâne (ceasul efectiv, ca azi).
- **Rezultate scrise, etichete nedescărcate**: AWB-urile există; „Tipărește AWB-urile” / „Retipărește…” cere același tiraj (cheia manifestului
  curent = tirajul început → aceleași fișiere; altă cheie → refuz „tirajul s-a schimbat”, drumul „Tiraj nou” al owner-ului, ca azi).

### 8.3 Idempotență și reluare: dublu-click, două taburi, crash (L04 / L05, lecția „L05 în UI”; Jakarinos P1-5)

- **Cheia intenției**: ecranul generează un UUID la fiecare apăsare pe „Trimite” și îl scrie într-un **registru local** (`localStorage`, o
  intrare pe cheie, `{lot_id, plic_ids, hash_cerere, inceput_la}`) ÎNAINTE de apel; scrierea se verifică prin recitire (eșec = nu trimite).
  Intrarea iese din registru DOAR la rezultat dovedit (răspuns `ok` cu intenția `incheiata`, intenția găsită `neincheiata`, sau refuz determinist
  4xx cu cod cunoscut); un 42501 / 5xx / timeout nu dovedește nimic → intrarea rămâne, iar la redeschiderea ecranului se caută în BD
  (`red_fan_intentii`, RLS admin / editor) starea cheii și se oferă **„Reia trimiterea”** (aceeași cheie) sau se afișează rezultatul memorat.
- **În BD**: `red_fan_intentii (cheie uuid PRIMARY KEY, lot_id, proiect_id, operator uuid NOT NULL, hash_cerere text NOT NULL, stare CHECK IN
  ('in_curs','incheiata','neincheiata'), lucru_pana_la timestamptz NOT NULL, rezultat jsonb, inceput_la timestamptz NOT NULL, incheiata_la
  timestamptz, incheiata_de text CHECK IN ('edge','reconciliere','comanda_noua'))`; pe `red_fan_awb`: `intentie_cheie uuid` (intenția care a
  aprobat rândul; rămâne la re-propunere ca istoric, se rescrie la o nouă aprobare). **`lucru_pana_la` = arenda** (lease) intenției:
  `clock_timestamp() + 10 min` la comandă, **reînnoită de fiecare pas durabil** al aceleiași trimiteri (`fn_red_fan_srv_claim`,
  `fn_red_fan_srv_rezultate`, începerea tirajului): o trimitere vie nu expiră niciodată; una moartă expiră 10 minute după ultimul pas scris
  (aceeași fereastră ca reconcilierea `in_curs`; ceasul efectiv, L17).
- **Contractul complet al aceleiași chei**, evaluat de `fn_red_fan_comanda` după `INSERT … ON CONFLICT DO NOTHING` fără rând (toate lock-urile
  §6.2 deja luate), **replay-ul verificând lotul, apelantul și payloadul canonic**:
  | Găsit | Condiție | Răspuns |
  |---|---|---|
  | alt `lot_id`, sau alt `hash_cerere`, sau alt `operator` (și apelantul nu e owner) | — | `22023` „cerere coruptă” — nimic scris |
  | `incheiata` | aceeași cheie, lot, hash, operator / owner | **replay**: `{reluare:false, replay:true, rezultat memorat}` — nimic nou scris; funcția edge NU trimite nimic și **recitește rândurile** lotului cu JWT-ul omului ca să construiască răspunsul (memo-ul e doar afișare, §8.5) |
  | `in_curs`, `lucru_pana_la > clock_timestamp()` | aceeași cheie | `RD030` „trimiterea e în curs (alt tab sau încă rulează); așteaptă până la <lucru_pana_la>” — nimic scris |
  | `in_curs`, `lucru_pana_la <= clock_timestamp()` | aceeași cheie, lot, hash, operator / owner | **reluare**: aceeași tranzacție continuă pașii 4–6 din §8.1 idempotent: rândurile cu `intentie_cheie = cheie` și `aprobat` NU se re-aprobă și NU se numără din nou; rândurile revenite `propus` (date schimbate) se tratează ca noi (numărate o singură dată pe zi, §7.2); rândurile `in_curs` / `necunoscut` ale intenției → **refuz `RD033`** „N plicuri cu rezultat necunoscut; Verifică la curier” (L05: nu se reia peste o rezervare nelămurită); `lucru_pana_la` reînnoită; răspuns `{reluare:true, de_trimis:[…]}`, apoi funcția edge continuă claim → POST pe `de_trimis` |
  | `neincheiata` | aceeași cheie | `RD034` „trimiterea a fost închisă; apasă din nou «Trimite»” — ecranul șterge cheia din registru și generează una nouă la următoarea apăsare; rândurile `aprobat` rămase intră în `de_trimis` al noii intenții fără numărare |
  Nu există cheie nouă pentru reluare, nu există dublă aprobare (rândurile aprobate poartă cheia și sunt sărite) și nu există blocare permanentă
  (arenda expiră în cel mult 10 minute de la ultimul pas scris; după ea, fie reluarea, fie o cheie nouă închide intenția).
- **Cheie nouă pe același lot** (al doilea tab) cât există o intenție `in_curs`: cu `lucru_pana_la` în viitor → `RD030`; expirată → RPC-ul o
  închide `neincheiata` (`incheiata_de = 'comanda_noua'`, jurnal) și continuă cu cheia nouă, preluând rândurile `aprobat`. Rândurile `aprobat` nu
  pot fi oricum rezervate de două ori (claim-ul cere `aprobat` și le trece `in_curs`).
- `fn_red_fan_srv_intentie_incheie(p_actor, p_cheie, p_rezultat jsonb)` — **clasa B** (doar funcția edge, §7.3): CAS pe `stare = 'in_curs'`,
  `operator = p_actor` SAU `p_actor` owner; **rezultatul memorat nu e adevăr pentru că vine în `p_rezultat`**: RPC-ul **derivă** sumarul din rânduri
  (`count(*) FILTER (WHERE stare = …)` pe `red_fan_awb WHERE intentie_cheie = p_cheie`: generate, respinse, necunoscute, retrase, tarif total din
  `tarif`) și scrie DOAR sumarul derivat + cheile permise din `p_rezultat` (`tiraj`, `manifest_cheie`, `oprit`, `ramase`, `excluse` — listă albă;
  orice altă cheie = `22023`); `incheiata_de = 'edge'`. O intenție `in_curs` cu arenda expirată pe care nimeni n-o reia devine `neincheiata` la
  „Verifică la curier” (reconcilierea, `incheiata_de = 'reconciliere'`, după ce rândurile ei nu mai sunt `in_curs` / `necunoscut`) sau la prima
  comandă nouă pe lot (mai sus).
- **Dublu-click în același tab**: `ocupat` (ref) + butonul dezactivat cât `lucru` + registrul local (a doua apăsare cu intenție nouă e refuzată
  local cât prima e în registru pe același lot și `inceput_la` < 10 min).
- **Probele obligatorii** (PGlite; două sesiuni pe clonă pentru I5): I1 crash după aprobare (comanda comisă, nimic după) → reluare cu aceeași cheie
  după expirarea arendei: zero aprobări noi, `red_fan_zi` neschimbat, `de_trimis` = rândurile aprobate; I2 aceeași cheie înainte de expirare →
  `RD030`; I3 aceeași cheie, alt hash → `22023`, nimic scris; aceeași cheie, alt operator ne-owner → `22023`; I4 `incheiata` → replay, `red_fan_awb`
  neschimbat (sha pe tabel înainte / după); `p_rezultat` cu sumar fals la încheiere → sumarul scris e cel derivat din rânduri, nu cel trimis;
  cheie străină în `p_rezultat` → `22023`; I5 două sesiuni: cheie nouă pe lotul unei intenții expirate → cea veche `neincheiata`, rândurile preluate
  o singură dată; I6 reluare cu un rând `in_curs` al intenției → `RD033`, nimic scris; I7 `fn_red_fan_srv_intentie_incheie` ca `authenticated` →
  `42501`.

### 8.4 Tirajul și retipărirea

Neschimbate ca reguli (`FANCOURIER_INTEGRARE.md` §3 pasul 4, §5): prima descărcare fixează tirajul; toate părțile + arhiva cer aceeași cheie;
„Tiraj nou” în trei pași, owner (Q3 B). Ce se schimbă: (1) prima descărcare o face funcția edge imediat după generare, în aceeași apăsare,
doar pe lotul încheiat (§8.1); (2) operatorul are „Retipărește…” (același tiraj, cu motiv; refuz limpede dacă s-a schimbat; Q3 B); (3)
**regulă (Q5, decis A)**: un lot se trimite o singură dată, întreg; plicurile respinse și corectate se mută într-un lot nou de plicuire (azi
plicul poate schimba lotul înainte de expediere; lotul nou are PV-ul lui de plicuire, ca orice lot) și se trimit ca lot nou. Garda e în BD
(`lot_tiparit`, §8.1), nu doar în ecran. Singura cale care mai schimbă manifestul unui lot tipărit rămâne reconcilierea care găsește un AWB
„necunoscut” (§9.5.4) — atunci „Tiraj nou” e al owner-ului, ca azi; regula „lot încheiat înainte de tiraj” o face rară (un „necunoscut” oprește
tirajul până la reconciliere).

#### 8.4.1 Anularea unui AWB neridicat de către operator (Q3 B, Q6 A)

- **Anularea e în DOI pași, ca operatorul să nu poată scrie „anulat” fără curier** (Jakarinos P1-2): (1) **comanda** — acțiunea edge `sterge_awb`
  (poarta „operator sau owner”) cheamă întâi, cu JWT-ul omului, clasa A `fn_red_fan_anulare_cere(p_id, p_awb, p_motiv_cod, p_nota)`: ordinea §6.2
  (plic FOR UPDATE → rândul FAN FOR UPDATE), `fn_red_fan_lot_permis`, CAS `stare = 'generat' AND awb = p_awb AND ridicat_la IS NULL AND
  ridicat_contrazis IS NULL AND anulare_ceruta_la IS NULL` → scrie `anulare_ceruta_de = auth.uid()`, `anulare_ceruta_la = clock_timestamp()`,
  `motiv_anulare`, `anulare_nota`; `stare` rămâne `generat`; o cerere deja deschisă = `RD035` „anulare în curs” (fără al doilea `DELETE`); (2)
  funcția edge face `DELETE /awb` cu forma de succes strictă (ca azi) și apoi **înscrierea**, clasa B: `fn_red_fan_srv_anuleaza(p_actor, p_id,
  p_awb, p_rezultat ∈ {'sters','refuzat_ridicat','ambiguu'})` — `sters` → CAS `anulare_ceruta_la IS NOT NULL AND stare = 'generat'` → `stare =
  'anulat'`, `anulat_de = anulare_ceruta_de`, `anulat_la = clock_timestamp()`; `refuzat_ridicat` (curierul spune că AWB-ul e deja preluat, 4xx
  determinist) → cererea se golește (`anulare_ceruta_* NULL`, motivul în jurnal), rândul rămâne `generat` și intră în „De verificat” (ridicarea va
  veni la urmărire); `ambiguu` (5xx / timeout / formă necunoscută) → **nimic schimbat**, cererea rămâne deschisă, „Verifică la curier” (L05):
  reconcilierea pe borderou lămurește (AWB absent → `sters` prin aceeași clasă B; prezent → cererea se golește). `fn_red_fan_anulat` de azi rămâne
  owner (clasa C, D18), cu semnătura neschimbată, cât timp mai rulează funcția edge veche și ecranul owner-ului (§13 F1, §16); în F1 primește în
  corp `fn_red_fan_lot_permis` și scrie și coloanele noi (`motiv_anulare = 'alt_motiv'`, `anulare_nota` = textul vechi tăiat la 200, `anulat_de /
  anulat_la`).
- Motivul devine **cod din listă** (`motiv_anulare CHECK IN ('netiparit_3_zile','neridicat_3_zile','plic_retras','date_gresite','alt_motiv')`,
  `alt_motiv` cere notă ≤ 200), nu text liber; coloane noi `anulare_ceruta_de uuid`, `anulare_ceruta_la timestamptz`, `anulat_de uuid`, `anulat_la
  timestamptz`, `anulare_nota text` puse de server (`auth.uid()` / `p_actor`, `clock_timestamp()`; L08). **Trigger BEFORE UPDATE pe
  `red_fan_awb`** (L07): `anulat_de` / `anulat_la` / `motiv_anulare` se pot scrie DOAR dintr-una din funcțiile de pe lista EXACTĂ
  `fn_red_fan_srv_anuleaza`, `fn_red_fan_anulat` (corectat: trecerea a treia scria „doar din `fn_red_fan_anulat`”, deși RPC-ul nou era altul —
  Jakarinos), verificat prin `pg_trigger_depth()` + un marcaj de tranzacție pus de funcție (`set_config('redari_fan.anulare', <id rând>, true)`,
  comparat cu `NEW.id`), nu prin `current_user`; odată scrise, imuabile (`OLD.anulat_la IS NOT NULL AND NEW.* IS DISTINCT FROM OLD.*` → refuz
  `42501`); `stare = 'anulat'` cere `anulat_la IS NOT NULL` (CHECK); rând în `red_jurnal` la cerere și la înscriere.
- **Lista anulărilor pentru owner**: view `v_red_fan_anulari` (`security_invoker`; lot, nr. plic, AWB, cine, când, motivul, „avea foaia
  tipărită” din evidența §8.7 — până la F1b `NULL` = „necunoscut”, nu „nu”, L18); ecranul o arată owner-ului în Poștă, cu filtrul pe zi.
- Propunerea de anulare (excepțiile (a) / (b) după 3 zile lucrătoare, §9.5.2) vine în F2; anularea manuală, oricând înainte de ridicare, e în F1.

### 8.5 Mesajele pentru operator (o singură definiție în `fanLot.js`, L19; motivul în BD rămâne codul, nu textul)

| Ce s-a întâmplat (codul din răspuns / din rând) | Ce vede operatorul | Ce are de făcut |
|---|---|---|
| `generat` | „N AWB-uri generate” + tarif total (fără TVA) | tipărește AWB-urile (A5) și convocările + opisul (A4), pune fiecare AWB în buzunarul plicului după pagina de control, cheamă curierul |
| respins de curier, câmp `phone` | „PL-… — telefonul lipsește sau e greșit” | completează telefonul în fișa deținătorului, mută plicul într-un lot nou de plicuire și trimite lotul nou (Q5 A); dacă niciun plic din lot n-a primit AWB, „Trimite” din nou pe același lot |
| respins, câmpuri `county` / `locality` / `street` / `zipCode` | „PL-… — adresa nu e recunoscută de curier (județ / localitate / stradă)” | corectează adresa în fișă (localitatea ca în nomenclatorul curierului), apoi la fel: lot nou (Q5 A) |
| exclus: `lot_tiparit` (cod nou) | „PL-… — lotul e deja tipărit; plicul nu mai intră în el” | mută plicul într-un lot nou de plicuire și trimite lotul nou |
| lot neîncheiat (429 / `oprit` / cerere deschisă / „necunoscut”) | „AWB-urile se tipăresc după ce se termină trimiterea lotului” | termină trimiterea (rândurile de mai jos), apoi „Tipărește…” |
| respins, câmp `name` / fără câmp recunoscut | „PL-… — curierul a respins expedierea; detalii în contul curierului” | anunță proprietarul / adminul |
| exclus: „datele s-au schimbat după aprobare” | „PL-… — datele s-au schimbat între timp; nimic trimis pentru el” | „Trimite” din nou (se recalculează) |
| exclus: plic anulat / expediat manual / mutat din lot | „PL-… — plicul nu mai e în lot sau are deja expediere” | nimic |
| `de_aprobat` (peste plafon) | „Toate cele N plicuri așteaptă aprobarea proprietarului (azi mai încăpeau X)” | așteaptă; după aprobare, „Trimite” din nou (Q2 A) |
| `necunoscut` / `in_curs` rămas | „Răspunsul curierului nu s-a confirmat pentru N plicuri. NU retrimite.” | „Verifică la curier” după 10 minute |
| `RD030` (aceeași cheie sau alt tab, intenție în curs) | „Trimiterea e în curs (alt tab sau încă rulează); așteaptă până la HH:MM” | nimic; ecranul reîncearcă să afle starea |
| `reluare: true` (aceeași cheie după întrerupere) | „Trimiterea întreruptă a fost reluată: N plicuri aprobate deja, M noi” | nimic |
| `replay: true` (intenție deja încheiată) | rezultatul memorat, cu „(rezultat deja înregistrat la HH:MM)” — numerele din rândurile recitite | nimic |
| `RD033` (reluare peste rezultat necunoscut) | „N plicuri au rezultatul neconfirmat; întâi «Verifică la curier»” | „Verifică la curier” |
| `RD034` (intenția a fost închisă) | „Trimiterea anterioară a fost închisă; apasă din nou «Trimite»” | „Trimite” (cheie nouă) |
| `RD031` (tiraj cerut pe lot neîncheiat) | „AWB-urile se tipăresc după ce se termină trimiterea lotului” (același rând ca mai sus) | termină trimiterea |
| `RD032` (garda „doar TEST” din BD) | „Transportul e permis doar pe proiecte de TEST (Testul 1)” (același text ca 423) | nimic (anunță proprietarul) |
| retras automat (`plic_mutat` / `plic_anulat` / `lot_tiparit`) | „PL-… — scos din trimitere: plicul nu mai e în lot / e anulat / lotul e tipărit” | mută plicul într-un lot nou dacă mai trebuie trimis |
| `RD035` (anulare deja cerută) | „Anularea AWB-ului … e deja în curs; așteaptă răspunsul curierului” | „Verifică la curier” dacă durează |
| anulare `refuzat_ridicat` | „Nu s-a anulat: curierul spune că AWB-ul a fost deja preluat” | nimic (ridicarea vine la urmărire) |
| 429 | „Curierul a cerut o pauză; restul se trimite mai târziu” | „Trimite” din nou peste câteva minute (doar rândurile rămase `aprobat`) |
| `oprit` = limita de 5 solicitări pe apăsat | „S-au trimis 500; mai sunt N” | „Trimite” din nou |
| 423 `transport_real_doar_test` | „Transportul e permis doar pe proiecte de TEST (Testul 1)” | nimic (anunță proprietarul) |
| 503 `transport_neconfigurat` / `autentificare_fan_neconfirmata` | „Legătura cu curierul nu e configurată / nu răspunde; nimic trimis” | anunță proprietarul |
| 403 `non_operator` (cod nou) | „Doar operatorii numiți de proprietar pot trimite” | — |
| etichete 502 după AWB-uri generate | „AWB-urile există; foile AWB nu s-au putut descărca acum” | „Tipărește AWB-urile” (aceeași cerere, mai târziu) |
| anulare: curierul a confirmat ștergerea | „AWB-ul … anulat (motiv: …); proprietarul îl vede în lista anulărilor” | dacă foaia era tipărită: distruge-o (excepția (d)) |
| anulare: AWB deja ridicat / răspuns ambiguu | „Nu s-a anulat: AWB-ul a fost ridicat / răspunsul curierului nu s-a confirmat” | nimic / „Verifică la curier” |
| tipărirea refuzată de BD (`RD020` tiraj schimbat / `RD021` descărcări oprite / eroare) | „Fișierul nu s-a predat pentru tipărire: <motiv>” — nimic descărcat, nimic bifat | owner: „Tiraj nou”; altfel reîncearcă |

### 8.6 Pachetul de tipărit (D8)

#### 8.6.1 Ce e pachetul și prin ce diferă de arhivă

Pachetul de tipărit al unui tiraj = **două fișiere**, din ACELAȘI manifest (plicurile active cu AWB generat / ridicat, pozițiile 1…N — regula de
azi; plicurile respinse / fără AWB / anulate nu intră, sunt „rămase” pe pagina de control):

| Fișier | Pentru | Conținut | Cine îl face, când |
|---|---|---|---|
| **Pachetul A5 — AWB-urile** (PDF) | imprimanta proiectului, **tava A5**, o singură față (coada „AWB A5”, §8.6.5) | câte un AWB pe pagină, în ordinea pozițiilor; un fișier pe parte de ≤ 100 (limita cererii de etichete), deci loturile de până la 100 au un singur fișier; numele cu tirajul, ca azi (`…_AWB_A5_T<ID>.pdf`); pe un lot de TEST numele începe cu `TEST_` | funcția edge, în răspunsul lui `trimite` (§8.1), din PDF-urile curierului **neschimbate** (pagini A4); trecerea pe A5 o face fereastra de tipărire (micșorare cu proporția păstrată), iar dacă proba o cere, platforma (F6) — §8.6.3 |
| **Pachetul A4 — convocările + opisul** (un fișier Word) | imprimanta proiectului, **tava A4, față-verso** pe latura lungă (coada „Convocări A4 față-verso”, §8.6.5) | **prima: pagina de control** (poziție · nr. plic · AWB · destinatar mascat · nr. documente · bifă — aceeași de azi, `controlLotFan`), apoi, pentru fiecare plic în ordinea pozițiilor: **convocările** proprietarului (fiecare pe o foaie: fața convocarea, versoul informarea) și, imediat după ele, **opisul** (foaie separată, doar pe față) — D13, §8.6.2 | ecranul, din DOCX-urile arhivate în Storage (aceleași citiri ca arhiva ZIP: `planPachetPlicuire` cu manifestul), imediat după rezultat; unirea: §8.6.2 |

Cele două fișiere sunt **separate** (D12) și se tipăresc pe aceeași imprimantă, fiecare din tava lui, fără schimbat hârtia; ordinea pozițiilor e
aceeași în amândouă și pe pagina de control, deci foaia A5 cu poziția 7 merge în buzunarul plicului cu poziția 7. Ordinea în plic se schimbă față de
a doua trecere (acolo opisul era primul): D13 cere opisul **după** convocările aceluiași proprietar. Arhiva ZIP își păstrează numerotarea de dosar
(opis `000`, convocări `001…`); doar pachetul A4 urmează ordinea D13.

**Arhiva ZIP** („Documente lot”, decizia (b) din 17.11.2026) rămâne neatinsă: ea e **exemplarul de la dosar** (fișiere separate pe plic, descărcate
exact cum sunt arhivate) și primește în F3 AWB-ul și dovada pe plic (§10.1). Pachetul de tipărit e **ce merge la imprimantă**: ordonat pentru
plicuire, cu pagina de control în față, un fișier pe tavă. Ambele cer același tiraj; „Tiraj nou” le invalidează pe amândouă.

**„Se face singur”** (D8) înseamnă: pregătit automat, fără pași ai operatorului, în aceeași apăsare cu generarea — AWB-urile vin în răspunsul
funcției edge, fișierul A4 se construiește în ecran din arhivă. **Predarea** fiecărui fișier pentru imprimantă e însă o apăsare a lui
(„Tipărește AWB-urile (A5)” / „Tipărește convocările + opisul (A4)”): acela e momentul D10 (§8.7.2). Dacă operatorul închide ecranul înainte să
apese, la reîntoarcere butoanele sunt tot „Tipărește…” (nimic în evidență) și fișierele se refac (AWB-urile = aceeași cerere la curier pe același
tiraj; nu costă). Butonul devine „Retipărește…” abia când evidența are o tipărire pe tirajul curent.

#### 8.6.2 Fișierul A4: un singur fișier Word, față-verso corect pe fiecare proprietar (Q1 decis A; D13)

Azi convocatorul și opisul sunt DOCX (convocatorul din șablonul validat juridic, cu QR și cu informarea pe verso adăugată de
`adaugaVersoInformare`; opisul și pagina de control construite în browser de `docxSimplu`). **Decizia Q1 (18.11.2026): A — un singur fișier
Word unit**, tipărit din Word / LibreOffice pe laptopul proiectului. Cum:

- **Unirea**: ecranul descarcă DOCX-urile din Storage (ca la ZIP) și le unește cu JSZip într-un singur `document.xml`: fiecare document devine
  **secțiune proprie** cu început pe **pagină impară** (`w:sectPr` / `w:type w:val="oddPage"`); imaginile QR și relațiile lor se renumerotează
  (`rIdN`, `media/qrN.png`, `docPr id` unic); stilurile vin din șablonul convocatorului (același pentru toate) + cele ale `docxSimplu` (nume
  distincte, verificate la unire). Conținutul fiecărui document rămâne **identic** cu exemplarul arhivat (același XML).
- **Paritatea pe proprietar (D13)**: o secțiune care începe pe pagină impară = începe pe **fața** unei foi noi la tipărirea față-verso. Word
  (și LibreOffice) adaugă singur pagina albă dinaintea ei când documentul anterior s-a terminat pe o față. Rezultă, fără ca platforma să
  numere paginile: fiecare convocare (convocarea + informarea = 2 pagini = o foaie) începe pe foaia ei; opisul începe pe o foaie nouă, iar
  versoul lui rămâne alb, pentru că următorul document (convocarea proprietarului următor) cere iar o față nouă; pagina de control are și ea foaia
  ei. Deci pe fiecare proprietar numărul de pagini tipărite e **par** și niciun verso nu trece pe foaia altuia. Dacă o convocare iese
  neașteptat pe 3 pagini (text lung), regula ține tot (pagina albă se adaugă înaintea opisului), doar că plicul are o foaie în plus — cazul se
  vede la proba de hârtie și la previzualizarea din Word.
- **Opisul pe o singură față**: opisul e construit de platformă (`docxSimplu`), deci paginarea lui e a noastră: cel mult un număr fix de rânduri
  pe pagină (se măsoară pe șablon la proba de hârtie); un opis mai lung se împarte în pagini, fiecare în secțiune proprie cu început pe pagină
  impară — fiecare pagină de opis pe fața unei foi, verso alb (D13: „doar pe față”). Pagina de control se împarte la fel (nu intră în plic, dar
  așa primul plic începe sigur pe o foaie nouă).
- **Față-verso în imprimantă, nu în fișier**: fișierul nu poartă setarea de față-verso; o poartă coada din Windows „Convocări A4 față-verso”
  (față-verso pe latura lungă, A4, tava 1), setată de suport (§8.6.5). La LibreOffice trebuie bifat „tipărește paginile goale inserate automat”
  (de verificat la proba de hârtie dacă e implicit; dacă nu, se setează o dată pe laptop).
- **Numărul de foi** nu e cunoscut dinainte de platformă (doar Word îl știe după paginare); ecranul arată o estimare: 1 (control) + pe plic
  (convocări + 1 opis) — fără să o folosească la vreo verificare.
- **Ce s-a respins**: (B) PDF unic prin convertor pe un server al firmei — infrastructură nouă cu date personale în tranzit, redare diferită de
  Word pe un document validat juridic; rămâne doar rezerva dacă unirea pe șablonul real eșuează (§16). (C) arhiva ZIP tipărită fișier cu fișier —
  nu respectă D8. „DOCX → HTML → imagine → PDF în browser” (`html2canvas` + `jspdf`) — respinsă: redă aproximativ un document validat juridic și
  rasterizează textul.

Fișierul A4 poartă același identificator de tiraj în nume și pe pagina de control; pe un lot de TEST numele începe cu `TEST_`, iar pagina de control
cu „LOT DE TEST”.

#### 8.6.3 AWB-ul pe A5, în buzunarul transparent al curierului (D12 — formatul implicit)

**Ce s-a văzut pe PDF-ul real** (Testul 1): o pagină A4 (595 × 842 pt) cu conținutul pe toată pagina (190 × 277 mm), **vectorial**: text
(DejaVu Sans), 59 dreptunghiuri, ~1.250 segmente de linie (barele codului de bare; cea mai îngustă ≈ 1 pt = 0,35 mm), trei imagini mici (sigla,
un pătrat 78 × 78 px, o bandă 356 × 30 px); pagina e o redare HTML → PDF (matricea 0,75 = 96 → 72 dpi). Cererea a trimis `format=A6` și a primit
A4 (§15.2 pct. 1).

**Cum se pune pagina curierului pe A5 fără să se strice codul de bare:**

1. **Aceeași proporție, deci nimic tăiat și nimic întors**: A4 (210 × 297 mm) și A5 (148 × 210 mm) au aceeași proporție (√2). Pagina A4
   întreagă intră pe A5 **în picioare** (fără rotire), micșorată uniform cu **0,705** (148 / 210 — lățimea decide; înălțimea iese 209,3 mm).
   Conținutul de 190 × 277 mm devine ≈ 134 × 195 mm, deci rămân ≈ 7 mm margine pe fiecare latură — peste zona pe care o laser n-o poate
   tipări (≈ 4–5 mm): nimic nu se taie. Dacă fereastra de tipărire micșorează „la zona imprimabilă” (A5 minus marginile driverului), factorul
   coboară la ≈ 0,66–0,68: tot bine. **Plaja acceptată: 0,66–0,71**, mereu cu proporția păstrată.
2. **Codul de bare rămâne citibil**: micșorarea e vectorială (liniile se redesenează la rezoluția imprimantei, nu se pixelează). Bara cea mai
   îngustă ajunge la ≈ 0,23–0,25 mm; la o laser de 600 dpi (0,042 mm pe punct) asta înseamnă ≈ 5–6 puncte pe bară, la 1.200 dpi ≈ 11 — de
   câteva ori mai mult decât pe o etichetă termică de 100 × 150 mm (≈ 1,4 puncte la 203 dpi, §8.6.4). Zonele albe din jurul codului (necesare
   cititorului) se micșorează în aceeași proporție, deci raportul lor față de bare rămâne cel al curierului. **Textul** de 8 pt ajunge la ≈ 5,6 pt:
   mic, dar citibil de aproape (curierul citește oricum codul de bare).
3. **Ce NU e voie** (strică codul): micșorare neuniformă („întinde pe pagină”, alte proporții pe lățime și pe înălțime); „tipărește ca imagine” /
   rasterizare la rezoluție mică; decuparea unei zone (nu există o zonă A6 / A5 de păstrat — conținutul e pe toată foaia); orice redesenare a
   AWB-ului de către platformă. PDF-ul curierului rămâne **neschimbat** în arhivă și în evidență.
4. **Buzunarul** (17 × 22,5 cm): foaia A5 (14,8 × 21 cm) intră fără îndoire, cu ≈ 1 cm joc pe fiecare parte; codul de bare trebuie să stea în
   fereastra liberă a foliei, nu sub o cusătură / lipitură a buzunarului sau sub un text tipărit pe folie.
5. **Cine face micșorarea**: implicit **fereastra de tipărire** (zero cod): operatorul tipărește PDF-ul curierului pe coada „AWB A5”, a cărei
   setare implicită (aleasă la probă) e „potrivește la hârtie / zona imprimabilă”. Dacă proba arată că scara depinde prea mult de setări (Edge
   vs. Acrobat, driverul), platforma face ea fișierul A5 (F6): în funcția edge, o bibliotecă PDF care încorporează pagina A4 ca formular (pe
   Deno: `pdf-lib`, de probat acolo — în browser nu e în proiect și a dat probleme la build) o pune pe o pagină A5 cu factorul fix 0,705,
   centrată, fără rasterizare; fișierul se numește cu sufixul `_A5`, e DOAR pentru imprimantă și se tipărește la „dimensiune reală”. Tot în F6 se
   pot uni părțile de câte 100 într-un singur PDF A5 pe lot.

**Ce se probează pe imprimanta proiectului înainte de orice cod** (proba de hârtie, §5 pct. 0; rezultatul se scrie în `FANCOURIER_INTEGRARE.md`
§8, fără date personale):

| # | Proba | Reușită = |
|---|---|---|
| 1 | AWB-ul Testului 1 deschis în Edge (ca din platformă) → Print → coada „AWB A5”; trei variante: „potrivește la zona imprimabilă”, scară fixă 70 %, „dimensiune reală” (aceasta trebuie să taie — arată că setarea contează) | primele două: pagina întreagă pe A5, nimic tăiat; se notează setarea implicită a ferestrei și dacă „tipărește ca imagine” e oprit |
| 2 | lățimea codului de bare măsurată cu rigla pe foaia A5 vs. pe AWB-ul A4 | raportul = factorul ales (± 1 mm pe lățimea codului) — micșorare uniformă |
| 3 | scanarea cu telefonul (orice aplicație de coduri de bare): foaia goală, apoi foaia **în buzunar, prin folie**, sub lumina de birou | codul citit corect, din prima, în ambele cazuri; numărul citit = AWB-ul |
| 4 | adresa și numărul AWB citite de un om, la distanța de lucru | citibile fără lupă |
| 5 | foaia A5 în buzunarul de 17 × 22,5 cm, buzunarul pe plicul nostru | intră fără îndoire; codul de bare în fereastra liberă a foliei; buzunarul nu acoperă nimic de pe plic care trebuie să se vadă |
| 6 | tava: coada „AWB A5” trage din tava A5 fără să ceară hârtie / alimentare manuală; orientarea foii corectă | 5 foi la rând, fără intervenție |
| 7 | fișierul A4 de probă (două convocări + un opis) pe coada „Convocări A4 față-verso”, din Word și din LibreOffice | foaia 1 = control, apoi convocare/informare, convocare/informare, opis cu verso alb (§8.6.2) |
| 8 | **decisiv**: un lot de TEST cu un plic, AWB-ul pe A5 în buzunar, ridicat de curier (Testul 2a) | curierul l-a scanat la ridicare (evenimentul C0 apare la urmărire) |

Se notează: modelul imprimantei, rezoluția (600 / 1.200 dpi), driverul, factorul folosit, rezultatul fiecărei probe. **Până la proba reușită**
(inclusiv pct. 8), loturile de TEST folosesc AWB-ul A4, ca la Testul 1; nimic din F1b nu se livrează pe A5 fără proba scrisă.

**Ce se întreabă la curier** (§15.2 pct. 1 și 8): dacă `format=A5` (sau alt parametru) dă AWB-ul direct pe A5 — atunci nu mai e nevoie de
micșorare; dacă AWB-ul micșorat la ≈ 70 % în buzunarul lor transparent e acceptat de cititoarele curierilor (factorul minim).

#### 8.6.4 Alternativa: eticheta autocolantă 100 × 150 mm (nu e implicită)

Rămâne doar ca rezervă (de pildă dacă buzunarele lipsesc sau proiectul primește o imprimantă de etichete): pe o rolă termică de 100 × 150 mm
factorul cu proporția păstrată e **0,476** (100 / 210); barele cele mai înguste ajung la ≈ 0,17 mm — la 203 dpi ≈ 1,4 puncte pe bară (la
limită), la 300 dpi ≈ 2 puncte; textul de 8 pt ajunge la ≈ 3,8 pt (greu de citit). Aceleași reguli ca la A5 (proporție păstrată, fără
rasterizare, originalul neschimbat, sufixul `_100x150`), aceeași probă (pct. 1–4 și 8 de mai sus) pe imprimanta de etichete. Răspunsul bun
pentru varianta asta ar fi un șablon A6 al curierului cu litere pe măsura foii sau ieșirea **ZPL / EPL** (limbajul imprimantelor termice; cere un
program local, §8.6.6).

#### 8.6.5 Imprimanta și laptopul proiectului (D12, D14)

- **Laptopul** (D14): Windows 11 Pro, dedicat proiectului; operatorul lucrează din contul lui de Windows, **fără drept de administrator**;
  disc criptat; acces de la distanță pentru suport; Word sau LibreOffice instalat; un browser (Edge) cu sesiunea ERP a operatorului (contul lui
  ERP, D2 — nu un cont comun).
- **Două cozi de tipărire pe aceeași imprimantă** (puse de suport, cu drept de administrator, o singură dată; operatorul nu le poate schimba):
  „**AWB A5**” = hârtie A5, tava 2, o singură față, scara aleasă la proba de hârtie; „**Convocări A4 față-verso**” = hârtie A4, tava 1,
  față-verso pe latura lungă. Operatorul doar alege coada potrivită în fereastra de tipărire; nu schimbă hârtia și nu caută setări.
- **Ce rămâne pe laptop**: pachetele descărcate (Word A4, PDF A5) au date personale; stau în dosarul de descărcări al contului de operator, pe
  discul criptat. Platforma nu le șterge (nu are cum și nu trebuie); regula de lucru recomandată: dosarul de descărcări golit la sfârșitul
  fiecărei zile de tipărire (§16). Accesul de la distanță al suportului vede aceste fișiere — se folosește doar la cerere, cu operatorul de față.
- Limita D10 rămâne: coada Windows primește fișierul, dar platforma nu află dacă foaia a ieșit (§8.7).

#### 8.6.6 Tipărirea silențioasă: variantă viitoare, nu acum (D8)

Un program pe laptopul proiectului (agent local) ar putea lua pachetele din platformă și le-ar trimite singur la cele două cozi de tipărire
(PDF prin driver; ZPL direct, la varianta cu etichete). **Nu se face acum**; dacă volumul o va cere (sute de plicuri pe zi, în fiecare zi), se proiectează separat, cu fișa de
securitate a–e, pentru că aduce riscuri proprii: (1) un program de întreținut pe un calculator din șantier (instalare, actualizări, antivirus,
cine răspunde de el); (2) un **canal din cloud spre o imprimantă fizică** = o țintă: un cont ERP compromis ar putea tipări orice, oricând, pe
șantier (hârtie, etichete cu date personale) — agentul ar avea nevoie de secret propriu, legat de lot / tiraj, cu coada vizibilă unui om; (3)
„trimis la imprimantă” tot nu e „foaia a ieșit” (driverul confirmă intrarea în coadă, nu ieșirea); (4) date personale în coada locală / cache-ul
calculatorului; (5) amestecarea tirajelor dacă coada nu se golește la „Tiraj nou”; (6) dependența de calculatorul și imprimanta pornite. Varianta
de azi (două apăsări de „Print”, de un om) e lentă cu câteva secunde și sigură.

### 8.7 Evidența tipăririlor (D9) și bifarea automată (D10)

#### 8.7.1 Ce se ține și unde (separat de evidența AWB și de expediere)

```
red_fan_tiparire_pachete (            -- o predare de fișier pentru imprimantă = un pachet
  id uuid PRIMARY KEY,                -- cheia intenției, generată de ecran (registru local, L05 în UI)
  lot_id uuid NOT NULL, tiraj_cheie text NOT NULL, tiraj_nr smallint NOT NULL,
  tip text NOT NULL CHECK (tip IN ('eticheta','documente')),   -- 'eticheta' = pachetul A5 al AWB-urilor (numele din cod rămâne)
  parte smallint,                     -- partea etichetelor (NULL la documente)
  pozitii int[] NOT NULL,             -- pozițiile din manifest cuprinse în fișier (toate sau o alegere la retipărire)
  fisier_sha256 text NOT NULL CHECK (fisier_sha256 ~ '^[0-9a-f]{64}$'),
  retiparire boolean NOT NULL,        -- cel puțin un plic din fișier mai avea o tipărire de același tip pe acest tiraj
  motiv text CHECK (motiv IS NULL OR motiv IN ('hartie_blocata','foaie_deteriorata','pierduta','imprimanta_oprita','tava_gresita','alt_motiv')),
  CONSTRAINT red_fan_tiparire_pachete_motiv CHECK (retiparire = (motiv IS NOT NULL)),
  de uuid NOT NULL, la timestamptz NOT NULL DEFAULT clock_timestamp()
)
red_fan_tipariri (                    -- un rând pe plic și tip, la fiecare predare
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pachet_id uuid NOT NULL REFERENCES red_fan_tiparire_pachete(id),
  lot_id uuid NOT NULL, plic_id uuid NOT NULL, awb_id uuid NOT NULL,   -- rândul red_fan_awb (AWB-ul de pe etichetă / din manifest)
  tip text NOT NULL CHECK (tip IN ('eticheta','documente')),
  tiraj_cheie text NOT NULL, pozitie int NOT NULL,
  nr smallint NOT NULL CHECK (nr >= 1),  -- a câta tipărire a acestui tip pe acest plic pe acest tiraj (1 = prima; ≥ 2 = retipărire)
  de uuid NOT NULL, la timestamptz NOT NULL,
  UNIQUE (pachet_id, plic_id, tip),       -- replay-ul aceluiași pachet nu dublează
  UNIQUE (plic_id, tip, tiraj_cheie, nr)  -- numărătoarea e densă și unică
)
```
- RLS: SELECT pentru admin / editor Redări (`auth.uid() IS NOT NULL AND fn_red_nivel() IN ('admin','editor')`), nimic altceva pentru nimeni;
  scrieri DOAR prin RPC (L07). Fără date personale: numere de plic, poziții, id-uri, cine a apăsat (L10).
- **Separarea** (D9): tipărirea NU schimbă `red_fan_awb.stare` și NU scrie nimic pe `red_plicuri` (expedierea o scrie doar ridicarea C0, §9.2);
  niciun trigger nu leagă cele trei evidențe — D11 (§9.5) le COMPARĂ, nu le sincronizează (lecția Polițe #1043: fără copii sincronizate prin
  triggere).
- `v_red_fan_plic_tiparire` (view `security_invoker`): pe fiecare plic al unui lot FAN — `eticheta_tiparita_la` (prima pe tirajul **curent**),
  `eticheta_tipariri`, `eticheta_ultima_de`, `documente_tiparite_la`, `documente_tipariri`, `netiparit_eticheta` / `netiparit_documente`
  (boolean, derivate în view — clientul primește flagul, L19), `tipariri_pe_tiraj_inlocuit` (rânduri cu altă cheie decât a lotului). Ecranul
  afișează de aici (§1); nicio numărătoare în JS.

#### 8.7.2 Momentul D10 și ordinea pașilor (evidența nu rămâne niciodată în urma fișierului)

```
Apasă „Tipărește AWB-urile (A5)” / „Tipărește convocările + opisul (A4)” / „Retipărește… (motiv, poziții)”
  1. ecranul face fișierul în memorie (etichetele: răspunsul lui `trimite` sau o cerere nouă de etichete pe același tiraj;
     documentele: DOCX-ul unit §8.6.2) → sha256
  2. cheia pachetului (UUID) → registrul local (localStorage, o intrare pe cheie: lot, tiraj, tip, poziții, sha256), scris și RECITIT;
     eșec = nu se predă nimic (lecția „L05 în UI”)
  3. RPC fn_red_fan_tiparire_inregistreaza(p_pachet, p_lot_id, p_tiraj_cheie, p_tip, p_parte, p_plicuri [{plic_id, awb, pozitie}], p_sha256, p_motiv)
       — clasa A (§7.3): operator sau owner (fn_red_fan_e_operator, L08), într-O tranzacție (L02), lock-uri în ORDINEA UNICĂ §6.2
       (corectat: trecerea a treia lua red_fan_loturi înaintea rândurilor FAN):
       lot FOR UPDATE → red_fan_awb ORDER BY id FOR UPDATE (fiecare plic: AWB-ul din cerere = AWB-ul rândului, stare în {generat, ridicat, …}, nu anulat,
         plicul activ în lot; altfel 22023 pe toată cererea — un fișier parțial greșit nu se predă)
       → red_fan_loturi FOR UPDATE (tirajul: cheia = p_tiraj_cheie și neoprit, altfel RD020 / RD021 — același corp ca fn_red_fan_tiraj, L19;
         lotul încheiat — fn_red_fan_lot_incheiat, altfel RD031, D15)
       → INSERT pachet ON CONFLICT (id) DO NOTHING RETURNING; fără rând = recitește și compară CONTRACTUL SEMANTIC COMPLET (Jakarinos):
         aceeași cheie + același lot + același tiraj (cheie și nr) + același tip + aceeași parte + aceleași poziții (tablou egal, ordonat) +
         același sha256 + același motiv → REPLAY (întoarce evidența memorată, nimic nou); orice câmp diferit → 22023 (nu doar sha-ul)
       → INSERT rânduri cu nr = (câte există pe plic / tip / tiraj) + 1, sub lock-ul lotului (L01: numărătoarea e serializată)
       → red_jurnal: UN rând pe pachet (tabela red_fan_tiparire_pachete, date_noi: tip, tiraj, poziții, nr. plicuri, retipărire, motiv)
       → întoarce { pachet_id, randuri, retipariri: [{nr_plic, nr}], tiraj }
  4. DOAR după răspunsul ok: predarea fișierului — AWB-uri: fereastra de tipărire a browserului pe PDF (iframe + print()), operatorul alege
     coada „AWB A5”, cu „Salvează” ca rezervă; documente: descărcarea DOCX-ului unit (se deschide în Word / LibreOffice, „Print” pe coada
     „Convocări A4 față-verso”); intrarea din registrul local iese la rezultat dovedit (ok / refuz 4xx cu cod); 5xx / timeout =
     rămâne și se lămurește prin recitirea pachetului din BD la redeschidere (replay cu aceeași cheie)
```
De ce înregistrarea e ÎNAINTEA predării: astfel **nu există fișier predat fără rând în evidență** — evidența poate cel mult să fie în avans
(„Print” anulat, hârtie blocată), caz acoperit de limita D10 și de verificarea D11 (a). Invers (fișier predat, apoi RPC picat) ar lăsa foi tipărite
fără urmă, exact ce D9 vrea să excludă. Dublu-click: `ocupat` + registrul local (a doua apăsare pe același lot / tip cât prima e în registru e
refuzată local). Două taburi: replay sau pachet nou cu `nr` mai mare (= retipărire, cere motiv) — nimic dublat în evidență.

**Retipărirea**: „Retipărește…” cere motivul din listă și lasă alegerea pozițiilor (toate sau câteva) — etichetele pentru o alegere se cer la
curier doar pe AWB-urile alese (manifestul lotului nu se schimbă, deci tirajul rămâne); documentele pentru o alegere = DOCX-ul unit al acelor
plicuri (tot cu pagina de control în față și cu aceeași regulă față-verso pe proprietar, §8.6.2). Fiecare plic retipărit primește `nr` + 1.
Operatorul poate retipări singur (Q3, decis B; nu costă); numărul retipăririlor se vede pe plic și pe lot (D9) și intră în raportul lotului.

#### 8.7.3 Ce vede operatorul și proprietarul

- Pe plic (§1): „AWB: tipărit <data ora> de <nume> · documente: tipărite <data ora> (retipărite N×: <motiv>)” / „NETIPĂRIT”.
- Pe lot: „tipărite: AWB N / M, documente N / M; retipăriri R; netipărite: PL-…” (din view; `M` = plicurile din manifest).
- În jurnal (`red_jurnal`): câte un rând pe pachet, cu cine / când / ce; și rândul de la „Tiraj nou” cu lista de distrus (§8.7.4).
- În raportul lotului (PV / export): coloanele de tipărire NU intră în registrul juridic (expedierea e data ridicării); sunt evidență de lucru.

#### 8.7.4 Legătura cu tirajul și cu „Tiraj nou”

Evidența e **pe cheia de tiraj**: o tipărire aparține tirajului cu care s-a predat fișierul. La „Tiraj nou” (owner, trei pași, neschimbat):
rândurile vechi rămân (istoric), view-ul recalculează „tipărit” pe cheia **curentă** → toate plicurile devin „netipărite” până la retipărire;
pasul 2 („se adună și se distrug toate foile”) primește din evidență **lista exactă a foilor tipărite pe tirajul vechi** (pe plic: foaie AWB da / nu,
documente da / nu, de câte ori), ca listă bifabilă, iar înlocuirea tirajului scrie în `red_jurnal` numărul foilor de distrus. Excepția D11 (b)
reapare după fereastra ei dacă nu se retipărește. O descărcare cu cheie veche e refuzată de RPC-ul de înregistrare (RD020), deci nu poate intra
în evidență ca tipărire pe tirajul nou. Limita evidenței, spusă și aici: un fișier descărcat o dată poate fi tipărit din nou de pe laptop fără o
nouă înregistrare — evidența e a **predărilor din platformă**, nu a foilor (D10).

### 8.8 Stările rândului FAN, tranzițiile și „lotul încheiat” (Jakarinos P1-6; L20: CHECK-ul derivat din acest tabel)

**Stările** `red_fan_awb.stare` după F1: `propus`, `de_aprobat` (nou), `aprobat`, `in_curs`, `generat`, `ridicat`, `necunoscut`, `eroare`, `anulat`,
`retras` (nou, terminal: scos din trimitere fără să fi costat). **Vii** (indexul unic pe plic `red_fan_awb_plic_viu_uq`): toate în afară de
`eroare`, `anulat`, `retras`. **Țin lotul deschis** (blochează tirajul, D15): `de_aprobat`, `aprobat`, `in_curs`, `necunoscut`. **Nu țin lotul
deschis**: `propus` (rest), `generat`, `ridicat`, `eroare`, `anulat`, `retras`.

**Lot încheiat** := `NOT EXISTS (rând al lotului în ('de_aprobat','aprobat','in_curs','necunoscut')) AND NOT EXISTS (cerere 'deschisa' pe lot) AND
NOT EXISTS (intenție 'in_curs' pe lot cu lucru_pana_la > clock_timestamp())` — o singură funcție internă `fn_red_fan_lot_incheiat(p_lot_id)`
(L19), evaluată sub lock-ul lotului de `fn_red_fan_tiraj` (începere, `RD031`), `fn_red_fan_tiparire_inregistreaza` (F1b) și funcția edge înainte
de etichete.

**Tabelul tranzițiilor** (fiecare stare care poate ține lotul deschis are cel puțin o ieșire care nu depinde de curier):

| Din | În | Cine / cum | Observații |
|---|---|---|---|
| (nimic) | `propus` | `fn_red_fan_comanda` (intern) / `fn_red_fan_propune` (calea veche) | pe un lot cu tiraj → refuz `lot_tiparit` (`RD036` pe calea veche; exclus cu motiv în comandă) |
| `propus` | `aprobat` | comandă sub plafon / `fn_red_fan_aproba` (owner, calea veche: pune `aprobare_owner_la`) | `intentie_cheie` setată |
| `propus` | `de_aprobat` | comandă peste plafon (toate rândurile cererii) | cerere `deschisa` |
| `propus` | `retras` | `fn_red_fan_retrage(p_id)` (operator / owner); automat în comandă când plicul nu mai e activ / în lot (`plic_anulat` / `plic_mutat`) sau lotul e tipărit (`lot_tiparit`) | `retras_de`, `retras_la`, `motiv_retragere` puse de server |
| `de_aprobat` | `aprobat` | `fn_red_fan_cerere_decide(aprobă)` (owner) | fără consum de plafon; `aprobare_owner_la` |
| `de_aprobat` | `propus` | `fn_red_fan_cerere_decide(respinge)` (owner) · `fn_red_fan_cerere_retrage` (operatorul care a cerut / owner) | cererea `respinsa` / `retrasa`; `cerere_aprobare_id` rămâne ca istoric |
| `de_aprobat` | `retras` | automat la decizia owner-ului sau la comandă, dacă plicul nu mai e activ / în lot | cererea rămâne pe restul rândurilor; fără rânduri rămase → cererea `retrasa` automat |
| `aprobat` | `in_curs` | `fn_red_fan_srv_claim` (clasa B) | `cerere_id`; arenda intenției reînnoită |
| `aprobat` | `propus` | re-propunere când datele plicului s-au schimbat (comandă / `fn_red_fan_propune`) | consumul de plafon rămâne în registru (§7.2) |
| `aprobat` | `retras` | `fn_red_fan_retrage` (operator / owner) · automat la comandă / claim când plicul nu mai e activ / în lot | plafonul consumat nu se restituie (spus în ecran) |
| `in_curs` | `generat` / `eroare` / `necunoscut` | `fn_red_fan_srv_rezultate` (clasa B) | toate rândurile unei solicitări deodată |
| `in_curs` (> 10 min) | `generat` | `fn_red_fan_srv_reconciliaza` („găsit” reverificat în borderou de funcția edge) · `fn_red_fan_reconciliaza` (owner, manual) | |
| `in_curs` (> 10 min) | `eroare` | `fn_red_fan_reconciliaza(p_awb NULL)` (DOAR owner: „nu există în borderou”) | deschide un al doilea AWB (rând nou) |
| `necunoscut` | `generat` / `eroare` | aceleași două reconcilieri | |
| `generat` | `ridicat` | `fn_red_fan_srv_bifeaza` (cron, F2) · `fn_red_fan_ridicat` (owner, manual) | pe lot real: plicul → expediat |
| `generat` | `anulat` | `fn_red_fan_anulare_cere` → `DELETE /awb` → `fn_red_fan_srv_anuleaza` (clasa B) · `fn_red_fan_anulat` (owner, manual, D18) | doar fără C0 cunoscut / contrazis |
| `eroare` / `anulat` / `retras` | (terminal) | — | plicul poate primi un rând nou (în același lot doar dacă lotul n-are tiraj; altfel în lot nou) |

**Ieșirea din fiecare stare deschisă fără curier**: `de_aprobat` → owner decide sau operatorul retrage; `aprobat` → operatorul trimite sau
retrage; `in_curs` → după 10 minute reconcilierea (găsit / absență); `necunoscut` → reconcilierea. Cererea `deschisa` → decizie / retragere;
intenția `in_curs` → arenda expiră în ≤ 10 minute de la ultimul pas, apoi reluare sau închidere la comanda următoare (§8.3). Deci un lot nu rămâne
„neîncheiat” fără o acțiune disponibilă omului.

**Gărzile pe primitivele vechi care rămân apelabile** (owner, până la retragere): `fn_red_fan_propune` și `fn_red_fan_aproba` refuză pe un lot cu
`tiraj_cheie IS NOT NULL` (`RD036` „lotul e tipărit; plic nou doar într-un lot nou”); `fn_red_fan_aproba` pune `aprobare_owner_la` și ia
`red_fan_loturi FOR UPDATE` în poziția §6.2; `fn_red_fan_claim_lot` / `fn_red_fan_rezultate` / `fn_red_fan_urmarire` / `fn_red_fan_confirmari` /
`fn_red_fan_ridicat` / `fn_red_fan_anulat` / `fn_red_fan_reconciliaza` primesc `fn_red_fan_lot_permis` (`RD032`); `fn_red_fan_tiraj` primește
`fn_red_fan_lot_incheiat` la începere (`RD031`). Toate cu amprenta md5 a corpului vechi verificată înaintea `CREATE OR REPLACE` și cu probe pe
calea legitimă (owner, lot TEST fără tiraj, lot încheiat → trece).

**CHECK-urile derivate**: `red_fan_awb_aprobare`: `stare IN ('propus','de_aprobat','eroare','anulat','retras') OR (aprobat_de IS NOT NULL AND
aprobat_la IS NOT NULL)`; `red_fan_awb_generat`: `de_aprobat` și `retras` în lista „fără AWB”; `red_fan_awb_in_curs`: neschimbat (`de_aprobat` /
`retras` nu cer `cerere_id`); nou `red_fan_awb_retras`: `(stare = 'retras') = (retras_la IS NOT NULL)`; nou `red_fan_awb_anulat`: `stare <>
'anulat' OR anulat_la IS NOT NULL` (cu backfill pe rândurile `anulat` existente, §13 F1); nou `red_fan_awb_de_aprobat`: `stare <> 'de_aprobat'
OR cerere_aprobare_id IS NOT NULL` (`cerere_aprobare_id` rămâne ca istoric după decizie, deci nu poate fi egalitate). Testele CHECK-urilor =
fiecare rând al tabelului de mai sus (tranziția permisă trece, tranziția absentă din tabel e refuzată de RPC, iar scrierea directă e `42501`).

## 9. Urmărirea automată (D4)

### 9.1 Cine o pornește, cu ce identitate și de ce

- **Pornirea**: un job pg_cron **orar** `redari_fan_urmarire_tick` (`5 * * * *`, ca `postgres`) → `SELECT public.fn_red_fan_urmarire_tick()`.
  Funcția calculează ora României (`clock_timestamp() AT TIME ZONE 'Europe/Bucharest'`), și DOAR dacă ora e 8, 13 sau 18 și sloturile zilei
  nu au rulat (`red_fan_rulari`, UNIQUE `(zi_ro, slot)`, `INSERT … ON CONFLICT DO NOTHING RETURNING` = revendicare atomică, L04) → cheamă
  funcția edge cu `net.http_post` și antetul `x-intern-secret` citit din Vault (`REDARI_FAN_INTERN_SECRET`, generat în BD, valoarea nu iese
  niciodată — tiparul `20261011a`). De ce orar și nu trei intrări cron: pg_cron e în UTC, iar România schimbă ora de două ori pe an (L17);
  tick-ul orar cu decizia în ora României nu are nevoie de reprogramare. Dacă un slot e ratat (întrerupere), rulează la următorul tick al orei
  (nu se recuperează retroactiv mai mult de un slot: nu are rost).
- **Funcția edge nouă `redari-fan-urmarire`**: publicată în lista `NO_JWT` (nu are JWT de om); PRIMA verificare: antetul `x-intern-secret` prin
  `fn_verifica_secret('REDARI_FAN_INTERN_SECRET', antet)` cu clientul `service_role` — fail-closed (lipsă / greșit / eroare = 401, nimic
  altceva); apoi întrerupătorul `red_fan_setari.urmarire_auto_activa` (oprit → rularea `oprita`, return). Acțiunile de la ecran rămân în
  `redari-fan-awb` (JWT-ul omului): cele două funcții nu se amestecă.
- **Identitatea: `service_role`, cu justificare explicită.** Nu există un om: rularea pornește din cron. RLS-ul tabelelor FAN cere
  `fn_red_nivel()` admin / editor pe `auth.uid()`, iar RPC-urile de azi cer owner-ul — un cron nu are niciuna. Alternativa „un cont tehnic cu JWT”
  ar fi exact „contul comun cu drept de owner” pe care D2 îl interzice. De aceea: `service_role` în această funcție edge, folosit DOAR
  pentru (a) `fn_verifica_secret`, (b) citirile FAN de urmărit, (c) RPC-urile **clasei B** (§7.3), cu EXECUTE **exclusiv** pentru `service_role`
  (`REVOKE … FROM PUBLIC, anon, authenticated`): `fn_red_fan_srv_urmarire(p_actor NULL, p_rulare, p_lot_id, p_randuri)` și
  `fn_red_fan_srv_confirmari(…)` — aceleași funcții pe care le cheamă și funcția edge a omului cu `p_actor` (un singur corp pentru om și cron,
  L19; exact unul dintre `p_actor` / `p_rulare` e nenul), `fn_red_fan_srv_bifeaza(p_rulare, p_id, p_data, p_cod)` (bifarea pe plic, un rând pe
  apel, în tranzacție separată — ordinea §6.2: plic → rândul FAN → jurnal) și `fn_red_fan_srv_rulare(p_rulare, p_stare, p_numere)` (jurnalul
  rulării). Dreptul EXECUTE restrâns E poarta de rol („cale server cu rol verificat explicit”, L08); în corp funcțiile verifică și `auth.uid() IS
  NULL` (un JWT de om pe această cale = refuz) și existența rândului de rulare `in_curs` cu id-ul primit (o cheie pe rulare). Fără alte drepturi:
  nicio scriere directă pe tabele (service_role are doar SELECT pe tabelele FAN, ca azi), niciun apel către altă funcție. (Numele
  `fn_red_fan_urmarire_auto` / `fn_red_fan_bifeaza_auto` din trecerile anterioare sunt înlocuite de cele de mai sus.)
- **Ce citește din afară**: răspunsurile curierului la `GET /reports/awb/tracking` și `GET /reports/awb/confirmations` — **date**, nu
  instrucțiuni: coduri pe listă albă (`EVENIMENTE_FAN`), AWB numeric, date cu formă fixă; textele curierului nu se stochează; forma necunoscută =
  „de verificat de om” (ca azi, `interpreteazaUrmarire`).
- **Ce scrie**: `red_fan_awb` (câmpurile de urmărire + confirmare, cu CAS pe `versiune_urmarire` — logica `fn_red_fan_urmarire` /
  `fn_red_fan_confirmari` neschimbată, mutată într-un corp intern comun celor două porți: om și cron, L19), `red_fan_rulari` (jurnalul
  rulării), `red_jurnal` (câte un rând pe bifare automată) și, DOAR pe loturi reale și DOAR pe codurile limpezi, `red_plicuri` (§9.2).

### 9.2 Tabelul cod → efect în registru

Faptele se derivă ca azi (`rezumatUrmarireFan`): C0 = ridicat, S2 = livrat, categoriile `retur` / `refuz` / `adresa` / `mutat` = retur semnalat,
`avizat` / `neutru` / `tranzit` / `inregistrat` = nimic pe fapte, `de_verificat` + necunoscut + S50 = de verificat. **Două coloane, două
lucruri** (Jakarinos): `stare` = starea rândului (§8.8: `generat` → `ridicat` e singura tranziție pe care o face urmărirea; „livrat” NU e o stare a
rândului), iar `urmarire_stare` = ce a spus ultima urmărire (`neurmarit`, `fara_evenimente`, `in_tranzit`, `ridicat`, `livrat`, `retur`,
`de_verificat`). **Ce știm despre ora ridicării**: `ridicat_propus` e `date` (curierul dă ziua C0; ora C0 nu e păstrată), iar `ultim_eveniment_la`
e ora ULTIMULUI eveniment, nu a C0 → nici jurnalul, nici ecranul nu promit „ora ridicării”: scriu „ridicat (C0) în ziua de <data>” și, separat,
„ultimul eveniment <cod> la <ora>”; `ridicat_la` (timestamptz) = ziua C0 la 00:00 ora României, ca azi în `fn_red_fan_ridicat`.
**Contradicții în ACELAȘI răspuns** (Jakarinos, P1 înainte de F2 — proba lui: helperul din `main` cu două C0 diferite întoarce `ridicat` cu prima
dată, fără contradicție): `rezumatUrmarireFan` primește regula: două sau mai multe evenimente din categoria `ridicat` cu **zile diferite** →
`de_verificat`, motiv „două date de ridicare în același răspuns”; două `livrat` cu ore diferite → `de_verificat`; `livrat` și `retur` în același
răspuns → `de_verificat` (azi iese `retur` cu `livrat_la` completat, iar contradicția o prinde doar CHECK-ul din BD); evenimente identice repetate
(același cod, aceeași dată) = un singur fapt, nu contradicție. Probe (vitest pe helper, tabel de cazuri): două C0 în zile diferite →
`de_verificat`; două C0 în aceeași zi, ore diferite → `ridicat` cu ziua; C0 + S2 → `livrat`; S2 + S16 → `de_verificat`; S2 fără C0 → `livrat`,
`ridicat_propus` NULL. Regula e tot în `rezumatUrmarireFan` (o definiție, folosită și de `urmarire` la cerere, L19); poate intra în F1 ca fix
al helperului dacă chat-ul o cere (nu schimbă BD-ul), altfel e prima condiție a lui F2. Bifarea automată pe plic (`fn_red_fan_srv_bifeaza`) se
face DOAR din faptele **necontrazise** ale rândului, după scrierea urmăririi, în **altă tranzacție** (ordinea §6.2: plic → rândul FAN, CAS pe
`versiune_urmarire` citită după scrierea urmăririi), în aceeași rulare:

| Codul / situația (ultimul eveniment + faptele) | Efect pe `red_fan_awb` | Efect pe `red_plicuri` (DOAR lot real) | Jurnal |
|---|---|---|---|
| **C0** ridicat, o singură zi, dată validă, rândul `generat` | `ridicat_propus` = ziua C0 (`date`); `stare` → `ridicat`, `ridicat_la` = ziua C0 la 00:00 RO | `awb` + `data_expediere` = **ziua C0** (trigger-ele existente: convocările → expediate, termenul de 10 zile) — exact ce face azi `fn_red_fan_ridicat` apăsat de owner | `red_jurnal`: `ridicare_auto`, cod C0, `ridicat_propus` (ziua), `ultim_eveniment` + `ultim_eveniment_la` (ca „ultimul eveniment”, nu ca ora C0), `rulare_id`, `user_id NULL` |
| **S2** livrat, cu C0 cunoscut (sau bifat în aceeași rulare) | `urmarire_stare = 'livrat'`, `livrat_la` = ora S2; `stare` rămâne `ridicat` | coloană nouă `curier_livrat_la timestamptz` + `curier_livrat_cod text` (fapt, nu AR); AR-ul (`data_ar`, `ar_scan_path`, `ar_primit_de`) se completează DOAR de arhivarea dovezii (§10.3) | `livrare_auto`, cod S2 |
| **S2 fără C0** (livrat, dar curierul n-a dat ridicarea) | `urmarire_stare = 'livrat'`, `ridicat_propus` NULL; `stare` rămâne `generat` | **nimic** (data expedierii nu se poate deriva); în „De verificat” cu motivul „livrat fără ridicare: data expedierii lipsește” | — |
| **S16 / S33 / S43** retur, **S6** refuz, **S4/S10/S19/S20/S25/S27/S28/S42** adresă, **S5** mutat (ca ultim semnal), `returnAwbNumber` | `retur_cunoscut`, `retur_propus` = motivul din categorie (`refuz` / `adresa_incompleta` / `mutat` / `avizat_neridicat`) | coloane noi `curier_retur_semnalat_la timestamptz`, `curier_retur_motiv text` (aceleași coduri ca `red_plicuri.retur`), **fără** `retur` / `retur_data` / `retur_scan_path` (cer scanul plicului întors, CHECK `red_plicuri_retur_complet`; §9.4) | `retur_semnalat_auto`, codul |
| retur după **livrat** (ambele fapte) | contradicție (CHECK `red_fan_awb_fapte`) → `de_verificat` | nimic | — |
| **S3 / S11 / S21 / S22 / S24** avizat, **S30 / S12** contact, **tranzit** (C1, H*, S1, S35), **S98** înregistrat | doar `ultim_eveniment` / stare afișată | nimic | — |
| **S50** confirmare refuzată | `de_verificat` (judecată umană, ca azi) | nimic | — |
| **S7, S8, S9, S14, S15, S37, S38, S46, S47, S49, S54, S55, S56, S64, S65, S67, S69, S99** și orice cod necunoscut ca ultim eveniment | `de_verificat` | nimic | — |
| a doua dată de C0 diferită / altă oră S2 / alt motiv de retur | faptul cunoscut rămâne, valoarea nouă în `*_contrazis`, `de_verificat` (ca azi); **plicul nu se atinge** (data expedierii e imuabilă prin trigger-ul plicului odată scrisă) | nimic | — |
| dată **în viitor** (peste ora curentă RO + 60 min) sau **înainte de `generat_la`**, sau formă necunoscută | `de_verificat`, motiv „dată imposibilă” | nimic | — |
| C0 pe un rând al cărui plic nu mai e activ / are deja expediere manuală | `ridicat_propus` scris, dar plicul **nu**; „De verificat” cu motivul (ca refuzul de azi din `fn_red_fan_ridicat`) | nimic | — |
| răspuns fără evenimente / AWB absent / listă de formă necunoscută | ca azi: „păstrat” / `de_verificat`; nimic pe plic | nimic | — |

- **Corecții ulterioare ale curierului**: faptul bifat rămâne; contradicția se vede și o soluționează owner-ul / un admin
  (`fn_red_fan_urmarire_solutioneaza`, existent). Dacă soluționarea alege „nou” pentru ridicare pe un plic deja expediat, **plicul nu se schimbă
  automat** (trigger-ul `red_plicuri` refuză schimbarea `data_expediere`); ecranul spune „data expedierii de pe plic rămâne X; corectarea pe plic
  e o operație separată a proprietarului” (§15.3, juridic: care dată contează).
- **Loturi de TEST**: urmărirea scrie evidența FAN (inclusiv `ridicat`), niciodată plicul — ca azi.
- Bifarea e **o singură definiție** (L19): `fn_red_fan_ridicat` (owner, manual, clasa C) și `fn_red_fan_srv_bifeaza` (cron, clasa B) cheamă
  același corp intern, cu autorul diferit (`auth.uid()` vs `NULL` + `rulare_id`) și cu aceeași ordine de lock (plic → rândul FAN → jurnal).

### 9.3 Limite de apeluri, pauze, oprire la erori, întrerupător, jurnal

- Limita curierului pe minut e **necunoscută** (întrebare trimisă 15.11.2026, fără răspuns): bucăți de ≤ 100 (limita documentată), **pauză
  2 s**, cel mult **30 de solicitări pe rulare** la urmărire + 30 la confirmări (= 3.000 de AWB-uri pe rulare, 9.000 pe zi — peste primul val);
  rândurile neatinse (cursor pe `urmarit_la ASC, id`) vin în slotul următor. **Oprire la primul 429 / 5xx / timeout / formă necunoscută a
  listei**: rularea se închide `oprita_eroare` cu codul, fără reîncercare în aceeași rulare (L05); următorul slot reia.
- Ce se urmărește: rândurile `generat` / `ridicat` cu AWB, pe loturi marcate, **fără** AWB-urile încheiate (livrat cu dovada arhivată; retur
  definitiv înregistrat pe plic; anulat) și **fără** AWB-urile mai vechi de 60 de zile de la generare (plafon; peste el → „De verificat: AWB
  vechi neîncheiat”, o singură dată).
- **Întrerupătorul**: `red_fan_setari.urmarire_auto_activa` (owner, din ecran; implicit `false`; schimbarea în `red_jurnal`); în plus, chat-ul
  poate opri jobul cron (`cron.unschedule`) și poate șterge secretul din Vault (funcția refuză 401). Nicio rulare nu pornește cât e `false`.
  O rulare deja pornită se termină (cel mult ~2 minute); oprirea nu e instantanee (ca la generare, `FAN_TEST1_PASI.md` §13).
- **Jurnalul**: `red_fan_rulari (id uuid, zi_ro date, slot smallint CHECK IN (8,13,18), pornita_la, incheiata_la, stare CHECK IN
  ('in_curs','incheiata','oprita','oprita_eroare'), solicitari int, randuri int, scrise int, pastrate int, depasite int, bifari_expediat int,
  bifari_livrat int, bifari_retur int, de_verificat int, eroare_cod text, UNIQUE (zi_ro, slot))`; RLS SELECT admin / editor; scris doar de
  funcțiile cronului. Ecranul: „Ultima urmărire: 19.11.2026 13:02 — 212 AWB-uri, 3 bifări expediat, 1 de verificat”. Fiecare bifare = rând în
  `red_jurnal` (tabela `red_plicuri` / `red_fan_awb`, `date_noi` cu `eveniment`, `cod`, `eveniment_la`, `rulare_id`; fără date personale).

### 9.4 Fișa de securitate a–e (CLAUDE.md pct. 7) și regula tare

- **(a) Conținut extern**: răspunsurile curierului la urmărire și confirmări. Date, nu instrucțiuni: listă albă de coduri, AWB numeric, date cu
  formă fixă, listele acceptate doar în formele cunoscute; textele curierului nu se păstrează și nu se afișează; forma necunoscută = de verificat.
- **(b) Ce scrie / face**: `red_fan_awb` (urmărire, CAS), `red_fan_rulari`, `red_jurnal`, și pe loturi REALE `red_plicuri.awb + data_expediere`
  (efect juridic: termenul de 10 zile), `curier_livrat_*`, `curier_retur_*`. **Nu** cheltuie bani (apelurile de urmărire sunt gratuite), nu
  trimite mail / SMS, nu atinge drepturi, nu șterge, nu scrie AR-ul fără dovadă arhivată, nu scrie returul definitiv.
- **(c) Identitate**: `service_role` în funcția edge `redari-fan-urmarire` — justificat la §9.1 (fără om; RLS pe nivel de om; D2 interzice
  contul tehnic cu owner). Perimetru minim: `fn_verifica_secret`, SELECT pe tabelele FAN + plicurile legate, RPC-urile clasei B (§7.3) cu EXECUTE
  exclusiv `service_role`. **Privilegiile minime se demonstrează**, nu se declară (Jakarinos): postcondiție în migrare + test pe clonă — pentru
  `service_role`, pe fiecare tabel FAN și pe fiecare drept în parte, `has_table_privilege` adevărat DOAR pentru SELECT; `has_function_privilege`
  adevărat DOAR pe lista exactă a clasei B; `fn_verifica_secret` cu secret greșit → fals. Secretele curierului: aceleași trei (Edge Secrets),
  citite după poarta secretului intern și după întrerupător.
- **(d) Cine pornește**: DOAR pg_cron (`postgres`) cu `x-intern-secret` din Vault; `verify_jwt` nu e folosit (funcția e în `NO_JWT`) și NU ar fi
  suficient oricum (cheia anon e un JWT valid); un apel fără / cu alt secret = 401, nimic citit, nimic chemat la curier. Testele negative: fără
  antet, antet greșit, antet `_VECHI`, JWT de owner fără antet → 401.
- **(e) Confirmare umană**: tot ce nu e în lista albă a bifărilor: coduri nelimpezi, contradicții, livrat fără ridicat, AR fără dovadă, retur
  definitiv, AWB-uri vechi, corectarea datei de pe plic, anularea. Pornirea automatizării cere „da”-ul proprietarului (întrerupătorul) și, pe
  loturi reale, „da”-ul juridic (§12).
- **Regula tare (a)+(b)**: citește conținut extern ȘI scrie → **poarta** = (1) cine pornește: cron + secret în Vault (nimeni din afară nu poate
  declanșa o rulare, iar conținutul extern nu poate porni nimic — curierul răspunde doar la întrebările noastre); (2) ce poate scrie: o listă
  ÎNCHISĂ de tranziții, înainte-numai (neexpediat → expediat la C0; + livrat; + retur semnalat), fiecare derivată dintr-un cod pe listă albă, cu
  CAS pe versiune și fără suprascrierea unui fapt (contradicția → om); (3) niciun ban, niciun mesaj, niciun drept, nicio ștergere. **De ce
  bifarea pe coduri limpezi e acceptabilă fără om**: efectul e consemnarea unui fapt raportat de curier (ridicarea), exact cel pe care azi
  owner-ul îl confirmă rând cu rând fără altă informație decât același cod — confirmarea umană nu adaugă cunoaștere, doar întârziere; faptul
  rămâne verificabil (codul + ora curierului + rularea în jurnal) și corectabil de om (soluționare); iar efectul juridic (termenul curge de la
  ridicare) e același pe care îl cere D4 și pe care juridicul trebuie să-l confirme o dată, pentru regulă, nu pentru fiecare plic. Rămân la
  om, explicit: AR-ul (dovada) și returul definitiv (plicul fizic), pentru că acolo codul singur NU e dovada cerută de procedură (§15.3).
- La activare (F2): rând în `public.automatizari` (tip `edge_function` + `cron_bd`, `referinta` = `redari_fan_urmarire_tick` / `redari-fan-urmarire`,
  `secrete_nume` = `REDARI_FAN_INTERN_SECRET (Vault)`, `FAN_SELFAWB_USERNAME / FAN_SELFAWB_PASSWORD / FAN_CLIENT_ID (Edge Secrets)`) + secțiunea din
  `registru_automatizari` — de chat, în aceeași sesiune cu aplicarea.

### 9.5 Verificarea generate / tipărite / ridicate la fiecare rulare (D11)

#### 9.5.1 Definițiile exacte (o singură definiție, în SQL; ecranul primește numerele și flagurile, L19)

Toate pe **lot** și pe **zi** = ziua generării AWB-ului în ora României (`(generat_la AT TIME ZONE 'Europe/Bucharest')::date`, L17); „tirajul
curent” = `red_fan_loturi.tiraj_cheie`; „acum” = ora României la citire (view) sau la rulare (instantaneu):

| Numărul | Ce intră | Ce NU intră |
|---|---|---|
| **GENERATE** (lot, zi) | rândurile `red_fan_awb` cu `awb IS NOT NULL`, generate în ziua respectivă, `stare <> 'anulat'` (orice stare ulterioară: generat, ridicat, livrat, retur, de_verificat) | anulatele (număr separat: **ANULATE** (lot, zi)); rândurile fără AWB (propuse, aprobate, respinse, necunoscute — ele sunt „rămase”, nu AWB-uri) |
| **TIPĂRITE** (lot, zi) | dintre GENERATE, cele cu cel puțin UN rând `red_fan_tipariri` de tip `eticheta` pe tirajul **curent** al lotului; alături, în paranteză, același număr pentru `documente` | retipăririle (un plic = 1, oricâte tipăriri); tipăririle pe un tiraj înlocuit |
| **RIDICATE** (lot, zi) | dintre GENERATE, cele cu `ridicat_la IS NOT NULL` (faptul C0 necontrazis, §9.2), indiferent de ce a urmat (livrat, retur) | AWB-urile cu C0 contrazis (sunt în „de verificat” al urmăririi, nu aici) |
| **DE VERIFICAT** (lot) | numărul AWB-urilor lotului **din ultimele 60 de zile** (nu doar din zi) aflate în cel puțin o excepție (a)–(d) nelămurită (jos) | excepțiile urmăririi (coduri nelimpezi, contradicții) se numără separat, în lista „De verificat” de azi; ecranul le arată împreună, cu eticheta fiecăreia |

Rândul de control: „**azi**: N generate (K anulate) · N tipărite (documente N) · N ridicate · **K de verificat**”, cu „ultima urmărire: <data ora>”;
un selector arată aceleași numere pe oricare din ultimele 7 zile. Pe un lot de TEST, aceleași numere, cu „LOT DE TEST” în față.

#### 9.5.2 Excepțiile: definiție, fereastră, cine închide

Zilele lucrătoare: funcție SQL `fn_red_zi_lucratoare_dupa(p_zi date, p_n int) → date` (a `p_n`-a zi lucrătoare după `p_zi`; sâmbăta și duminica
excluse; **fără** sărbătorile legale — limită spusă în ecran și în §16), folosită de view și de testele de paritate; ora de început a unei zile e
08:00 ora României (prima rulare).

| Excepția | Condiția exactă (pe rândul `red_fan_awb` + evidența §8.7) | De când | Cine o închide și cum |
|---|---|---|---|
| **(a) tipărit, neridicat** | există tipărire `eticheta` pe tirajul curent, prima la `T`; `stare = 'generat'` (deci `ridicat_la IS NULL`); `ridicat_contrazis IS NULL`; `urmarire_stare NOT IN ('ridicat','livrat','retur')` (un C0 cunoscut sau contestat scoate rândul din (a) — Jakarinos) | din `fn_red_zi_lucratoare_dupa(T_ro, 2)` ora 08:00, cu `T_ro = (T AT TIME ZONE 'Europe/Bucharest')::date` (tipărit luni → excepție de miercuri 08:00; tipărit vineri → marți 08:00) | se închide singură la C0 sau la anulare; operatorul verifică plicul fizic și comanda curierului; de la `fn_red_zi_lucratoare_dupa(T_ro, 3)` ora 08:00 ecranul propune **anularea**, operatorul o face cu un click (`neridicat_3_zile`; Q6, decis A) |
| **(b) generat, netipărit** | `awb IS NOT NULL`; nicio tipărire `eticheta` pe tirajul curent; `stare = 'generat'`; `ridicat_contrazis IS NULL`; `urmarire_stare NOT IN ('ridicat','livrat','retur')` (un AWB ridicat NU poate fi „generat, netipărit” și nu primește propunere de anulare — Jakarinos; el intră, dacă e cazul, la (c)) | **ancora temporală** `G' = greatest(generat_la, red_fan_loturi.tiraj_la)` — după „Tiraj nou” fereastra se numără de la începutul tirajului curent, nu de la generarea veche (altfel un AWB vechi ar primi propunerea de anulare imediat — Jakarinos); din `fn_red_zi_lucratoare_dupa((G' AT TIME ZONE 'Europe/Bucharest')::date, 1)` ora 08:00 | se închide singură la tipărire sau anulare; de la `fn_red_zi_lucratoare_dupa(G'_ro, 3)` ora 08:00: „AWB plătit, netipărit de 3 zile lucrătoare — anulează-l înainte de ridicare”, operatorul anulează cu un click (`netiparit_3_zile`; Q6, decis A; factura: §15.2 pct. 9). După „Tiraj nou” reapare pentru toate plicurile, după aceeași fereastră de la `tiraj_la` |
| **(c) ridicat, netrecut ca tipărit** | `ridicat_la IS NOT NULL`; nicio tipărire `eticheta` pe tirajul curent; fără lămurire | imediat, la rularea care scrie C0 | DOAR owner / admin Redări: `fn_red_fan_exceptie_lamureste(p_awb_id, 'c_ridicat_netiparit', p_motiv ∈ {tiparit_din_contul_curierului, tiparit_pe_tiraj_inlocuit, alt_motiv}, p_nota ≤ 200)` → rând în `red_fan_tiparire_lamuriri (awb_id, tip, motiv, nota, de, la, PRIMARY KEY (awb_id, tip))` + `red_jurnal`; **nu** se fabrică un rând de tipărire (evidența rămâne adevărată: nu s-a tipărit din platformă) |
| **(d) anulat după tipărire** | `stare = 'anulat'`; există tipărire `eticheta` (pe orice tiraj); fără lămurire | imediat, la anulare | owner / admin (Q3 B): aceeași funcție cu `'d_anulat_tiparit'`, motiv `eticheta_distrusa`; până atunci plicul arată „foaia AWB tipărită trebuie distrusă” |

- Pe loturile de **TEST** (D17, confirmată de proprietar): aceleași excepții și aceeași propunere de anulare, cu „LOT DE TEST” (altfel propunerea
  Q6 n-ar putea fi probată pe `TEST-RAZVAN` înainte de proiectul real); anularea rămâne tot un click al omului, iar inventarul de închidere al
  probei (§12.3) o cuprinde.
- **Toate conversiile de timp** din view-uri și din `fn_red_zi_lucratoare_dupa` sunt explicite în `Europe/Bucharest`: niciodată `T::date` /
  `G::date` direct pe un `timestamptz` (ar lua fusul sesiunii, UTC pe server — L17); „ora 08:00” = `(zi_ro::timestamp + time '08:00') AT TIME ZONE
  'Europe/Bucharest'` comparat cu `clock_timestamp()`. Probe: un AWB generat la 23:30 RO (21:30 UTC) e „din ziua” RO, nu din cea UTC; schimbarea
  orei (ultima duminică din martie / octombrie) nu mută fereastra.
- AWB-urile mai vechi de 60 de zile ies din verificare (ca din urmărire, §9.3); ce era deschis apare o singură dată ca „AWB vechi neîncheiat”.
- Retipăririle nu creează și nu închid excepții; se văd pe plic.

#### 9.5.3 Cum se calculează și unde se păstrează

- **La citire**: view `v_red_fan_control_zi` (`security_invoker`, pe lot × zi) pentru rândul de control, și `v_red_fan_exceptii` (pe AWB, cu
  tipul excepției și textul-cod pentru ecran) — numere și flaguri calculate în SQL, nimic în JS (L19); RLS a tabelelor de dedesubt (admin / editor).
- **La fiecare rulare** (08 / 13 / 18): după scrierea urmăririi, `fn_red_fan_srv_rulare` (calea cron, §9.1) salvează în `red_fan_rulari` un
  instantaneu `control jsonb` (pe fiecare lot cu AWB-uri deschise: generate / anulate / tipărite / ridicate / de_verificat pe ziua curentă + numărul
  excepțiilor pe tip) și pune suma excepțiilor în `de_verificat`. Instantaneul e **istoric** („la 13:02 erau 2 de verificat”); ecranul arată
  numerele vii din view și ora ultimei rulări. Nicio scriere pe `red_fan_awb` / `red_plicuri` din această verificare: ea doar **compară** (fișa
  §9.4 (b) rămâne neschimbată; `red_fan_rulari` e deja în perimetru).
- Excepțiile (a) și (b) depind de ceas → se evaluează la citire cu ora României (o excepție poate „apărea” între două rulări; ecranul o arată
  oricum din view). (c) și (d) sunt fapte.

#### 9.5.4 Ce se întâmplă cu AWB-urile anulate, retipăririle și „Tiraj nou”

- **Anulat înainte de tipărire**: iese din GENERATE, intră în ANULATE; nicio excepție.
- **Anulat după tipărire**: excepția (d) până la lămurire; iese din GENERATE / TIPĂRITE / RIDICATE.
- **Anularea propusă** de platformă ((a) și (b) de la a 3-a zi lucrătoare, ora 08:00) e o PROPUNERE în ecran (text + butonul „Anulează AWB-ul”
  cu motivul precompletat `neridicat_3_zile` / `netiparit_3_zile`, spre anularea în doi pași din §8.4.1: `DELETE /awb` doar înainte de C0, forma
  de succes strictă, înscrierea doar de server). **Operatorul** o face (Q6, decis A), owner-ul o vede în lista anulărilor; nimic nu se anulează
  singur (anularea atinge banii și e decisă de om). Propunerea vine din `v_red_fan_exceptii` (flag `propune_anulare`, calculat în SQL, L19), nu
  din JS, și e **falsă** ori de câte ori rândul are un C0 cunoscut sau contestat (`ridicat_la IS NOT NULL OR ridicat_contrazis IS NOT NULL OR
  urmarire_stare IN ('ridicat','livrat','retur')`) sau o cerere de anulare deja deschisă — un AWB ridicat nu poate apărea simultan la „generat,
  netipărit” și „ridicat, netipărit” (Jakarinos). Probe pe view: AWB ridicat netipărit → doar (c), `propune_anulare = false`; AWB cu C0 contrazis →
  nicio propunere; AWB generat netipărit a 3-a zi → `propune_anulare = true`; după „Tiraj nou” → `false` până la a 3-a zi lucrătoare de la `tiraj_la`.
- **Retipăriri**: nu schimbă numerele; `retipariri` apare pe lot ca număr separat.
- **Tiraj nou**: TIPĂRITE scade la 0 pe lot (cheia curentă s-a schimbat) → (b) reapare după fereastră; lista foilor vechi (§8.7.4) e de distrus;
  excepțiile (c) de pe tirajul vechi (ridicat, dar tipărit pe tiraj înlocuit) se lămuresc cu motivul `tiparit_pe_tiraj_inlocuit`.
- **Reconciliere / AWB găsit ulterior** (`fn_red_fan_reconciliaza` cu `p_awb`): rândul primește AWB-ul și intră în GENERATE în ziua lui `generat_la`;
  excepția (b) apare după fereastră dacă nu se tipărește (etichetele pentru el se cer pe tirajul curent; manifestul se schimbă → „Tiraj nou” după
  regula de azi, §8.4).

#### 9.5.5 Unde se leagă SMS-ul (fără a proiecta SMS-ul aici)

Faptul comun e **ridicarea** (`red_fan_awb.ridicat_la` + `red_plicuri.data_expediere` pe loturile reale). Lotul de SMS (Registru → „SMS proprietari”)
exclude azi: au răspuns, PV semnat, fără mobil RO, opt-out, telefon dublat. Propunerea pentru felia SMS (de decis acolo): un număr nou în
previzualizare — „N cu plicul neridicat încă de curier” — ca avertisment sau ca excludere implicită, derivat din același view
(`v_red_fan_plic_tiparire` + ridicarea), nu din numărători în JS. Aici nu se scrie nimic în tabelele SMS.

## 10. Arhiva (D5)

### 10.1 Unde și cum

Bucket-ul privat `redari`, în dosarul plicului (aceeași rădăcină ca opisul și scanurile: `plicuri/<plic_id>/`), nume fără date personale:

| Fișier | Calea | Cine îl scrie, când |
|---|---|---|
| eticheta AWB-ului (PDF, un AWB) | `plicuri/<plic_id>/awb_<awb>_eticheta_T<tiraj>.pdf` | rularea automată (§9) la prima rulare după generare, `GET /awb/label?awbs[]=<un AWB>` (un apel pe AWB, cu pauză; nu se poate tăia PDF-ul lotului fără librărie nouă) — **pe loturile reale și de TEST** |
| etichetele lotului, pe părți (PDF, ≤ 100 AWB-uri) | `loturi/<lot_id>/tiraj_<ID>_etichete_parteNN.pdf` | funcția edge `trimite`, imediat, cu JWT-ul operatorului (politica `red_storage_ins`, admin / editor): rezerva dacă curierul nu mai întoarce eticheta pe AWB mai târziu |
| dovada de livrare | `plicuri/<plic_id>/awb_<awb>_dovada_livrare_<AAAALLZZ>.<ext>` (+ `.json` cu câmpurile primite) | rularea automată, la prima confirmare pentru AWB (forma: §10.3) |
| pagina de control | există în arhiva ZIP; opțional `loturi/<lot_id>/tiraj_<ID>_pagina_de_control.docx` | funcția edge `trimite` (același moment ca etichetele lotului) |

- Pe `red_fan_awb`: `eticheta_path`, `eticheta_sha256`, `eticheta_la`, `dovada_path`, `dovada_sha256`, `dovada_forma CHECK IN
  ('imagine','pdf','json_text','lipsa')`, `dovada_la`; scrise DOAR de RPC-ul cronului, după ce obiectul există în Storage (verificat ca la
  `opis_path`: `storage.objects` + eTag; fișier imutabil = o versiune nouă = altă cale). Pe un rând **anulat** nu se arhivează nimic.
- **Politici**: scrierea din cron se face cu `service_role` (sare peste RLS pe `storage.objects` — justificat de §9.1, perimetru: doar căile
  `plicuri/<plic_id>/awb_*` și `loturi/<lot_id>/tiraj_*`, verificate în RPC-ul care înregistrează calea); citirea rămâne admin / editor
  (`red_storage_sel`); fără UPDATE / DELETE pentru nimeni (ca azi).
- **Arhiva ZIP a lotului** („Documente lot”, `plicuri.js::planPachetPlicuire`): pe fiecare plic, după opis (`000`) și convocări (`001…`), vin
  `PPPP_<nr_plic>_900_awb_eticheta_T<ID>.pdf` și `PPPP_<nr_plic>_901_awb_dovada_livrare.<ext>` când există — sortarea rămâne ordinea de tipărire;
  pagina de control primește o coloană „etichetă arhivată / dovadă arhivată” (da / nu). Fișierele lipsă NU opresc arhiva (sunt informative, nu
  exemplare de la dosar), dar sunt numite.

### 10.2 Dacă curierul nu mai întoarce eticheta

Eticheta pe AWB se cere în prima rulare după generare; dacă 502 / formă non-PDF / 404, se reîncearcă la următoarele două rulări, apoi rândul
primește `eticheta_forma = 'lipsa'` și rămâne PDF-ul lotului (`loturi/…`) ca dovadă a ce s-a tipărit, cu poziția din pagina de control. Nimic
nu se cere la curier în bucle.

### 10.3 Dovada de livrare: forma e NECUNOSCUTĂ (se află la prima livrare reală)

Codul acceptă azi un element pe AWB în `GET /reports/awb/confirmations` → „primită, de verificat”. Variantele și ce am arhiva:

| Varianta | Ce arhivăm | AR automat? |
|---|---|---|
| (a) element cu URL (semnat) către imaginea confirmării | imaginea descărcată (`.jpg` / `.png` / `.pdf`), `sha256`, + `.json` cu câmpurile (nume primitor, data) | **da**, dacă numele primitorului = destinatarul plicului (normalizat: majuscule, fără diacritice, ordinea cuvintelor liberă) → `data_ar` = data confirmării, `ar_scan_path` = imaginea, `ar_primit_de = 'destinatar'`; altfel „livrat · dovada arhivată · AR de înregistrat” (omul alege `alta_persoana` + mențiunea) |
| (b) element cu imaginea inline (base64) | la fel ca (a) | la fel |
| (c) element doar cu text (nume, dată, fără imagine) | `.json` cu câmpurile; `dovada_forma = 'json_text'` | **nu** (CHECK-ul `red_plicuri_ar_scan` cere scanul; procedura cere confirmarea semnată) → „livrat · dovada doar text · AR de înregistrat” |
| (d) nimic la API; cartonașul oPOD vine fizic | nimic automat; omul scanează cartonașul ca azi | nu |

**Decis (Q4, varianta A, 18.11.2026; reconfirmat D16)**: la (a)/(b) AR-ul se bifează automat DOAR cu dovada arhivată și primitorul = destinatarul;
altfel, și la (c)/(d), omul înregistrează AR-ul. Juridicul mai confirmă doar data ridicării ca dată de expediere (§15.3 pct. 2).

**Contractul descărcării dovezii dintr-un URL extern** (varianta (a), F3 — Jakarinos): URL-ul din răspunsul curierului e **conținut extern** și nu se
urmează orbește: (1) doar `https`, doar gazde dintr-o **listă albă fixată în cod** (gazda API-ului curierului + gazda de stocare observată la prima
livrare reală și revizuită în PR, nu învățată din răspunsuri); (2) **fără redirecturi** (`redirect: 'manual'`; un 3xx = `dovada_forma = 'lipsa'`, de
verificat de om); (3) `Content-Type` pe listă albă (`image/jpeg`, `image/png`, `application/pdf`) și verificarea semnăturii de fișier (primii
octeți) — altfel refuz; (4) dimensiune ≤ 5 MB (citită cu limită, nu după `Content-Length`), timeout 20 s, un singur apel pe AWB pe rulare; (5)
sha256 pe conținut, calea `plicuri/<plic_id>/awb_<awb>_dovada_livrare_<AAAALLZZ>.<ext>` **legată de rândul `red_fan_awb`** (plicul și AWB-ul
rândului, nu câmpuri din răspuns), scrisă prin `fn_red_fan_srv_arhiva` după verificarea obiectului în Storage; (6) URL-ul NU se păstrează (poate fi
semnat), doar gazda și sha-ul în `.json`; (7) nicio dată internă în URL (nu se adaugă parametri). Probe: gazdă în afara listei → refuz, nimic
descărcat; 3xx → `lipsa`; `Content-Type` imagine cu conținut HTML → refuz; fișier > 5 MB → refuz; dovada unui AWB nu poate fi legată de alt plic.
**Date personale**: imaginea
confirmării poartă numele și semnătura primitorului; stă în bucket-ul privat, lângă scanurile AR de azi, cu aceleași drepturi (admin / editor);
păstrarea = cât dosarul proiectului (durata o spune juridicul, §15.3); nimic nu se șterge automat; numele din `.json` nu intră în `red_jurnal`.

## 11. Comanda curierului (D6)

**Ce se știe** (observat în aplicația web a curierului la Testul 1 și în documentație): formularul „Cheamă curier” cere numele expeditorului,
persoana de contact (≤ 25), telefon, e-mail, județ / localitate / stradă / număr / cod poștal (precompletate din punctul de lucru al contului),
tipul comenzii (Standard), data preluării, intervalul (început / sfârșit, din 15 în 15 minute, sfârșitul la cel puțin o oră după început în
formular; documentația API spune interval ≥ 2 ore), nr. plicuri / colete, greutate, observații (afișate tăiate la 50 de caractere în listă).
Reguli: **o comandă pe punct de lucru pe zi**; orele disponibile depind de localitate și de zi (în afara Bucureștiului L–V 09–17, S 09–14);
anularea `DELETE /order?clientId=&id=`. **Punctul de ridicare = punctul de lucru al contului** (D6): la Testul 1 eticheta a arătat ca expeditor
punctul de lucru al contului de TEST, nu sediul — pe contul real trebuie verificat că `FAN_CLIENT_ID` e punctul de unde pleacă plicurile.

**Ce NU se știe despre `POST /order`** (întrebări pentru curier, §15.2): câmpurile corpului (clientId e destul? adresa separată? interval în ce
format? greutatea?), forma răspunsului (id-ul comenzii, starea), ce întoarce la a doua comandă în aceeași zi (eroare / înlocuire), dacă se
leagă de AWB-uri sau doar de punct, dacă există citirea comenzilor zilei (reconciliere), fusul orar.

**Ce a arătat comanda manuală din 18.11.2026** (aplicația web a curierului, fila „Creare comandă”; detaliile câmpurilor stau în dosarul probei,
nu în repo): persoana de contact ≤ 25 de caractere; telefonul de contact înlocuiește telefonul contului DOAR pe comanda respectivă; data preluării
implicit azi; intervalul se alege din liste de ore date **pe localitate și pe zi**, din 15 în 15 minute, sfârșitul la cel puțin o oră după început
(în ziua probei, pentru localitatea punctului de lucru, fereastra oferită s-a încheiat la 16:30); un singur tip de comandă („Standard”);
comutator plicuri / colete cu număr; **fără câmp de AWB**, fără greutate (formularul a trimis singur 1 kg), fără cost afișat, fără confirmare la
„Plasează”; după trimitere comanda apare în raportul lor „În așteptare”, **fără număr** până la preluare; **observația apare tăiată la 50 de
caractere** în lista lor (nu se știe dacă la curier ajunge întreagă) → numerele de AWB puse în observație nu sunt un mijloc de legare. Legătura
comandă ↔ AWB-uri o face curierul la ridicare (raportul lor de comenzi are un câmp cu AWB-urile ridicate). Urmări pentru F5: `red_fan_comenzi`
nu stochează o listă de AWB-uri „promisă”; legătura se citește înapoi din raportul curierului (dacă API-ul îl expune, §15.2 pct. 2), altfel pe
punct + zi; observația ≤ 50 de caractere utile („Gazpet – N plicuri”), fără AWB-uri. Apelurile interne ale aplicației lor web NU se folosesc din
platformă (nu sunt API-ul public; se pot schimba oricând).

**Propunerea (felia F5, după răspunsuri)**: buton **„Cheamă curierul azi”** (operator sau owner), activ doar dacă pe punctul de lucru există
AWB-uri generate neridicate și nu există comandă vie azi; ecranul propune intervalul implicit (ora curentă rotunjită la sfert + 2 h → sfârșitul
programului localității; configurabil pe proiect) și contactul implicit al proiectului; confirmare cu ziua, intervalul, punctul, numărul de
plicuri; după răspuns: „Comanda nr. … pentru azi, 14:00–16:30” + „Anulează comanda” (doar înainte de început, cu motiv). Gărzi: tabel
`red_fan_comenzi (id, punct_client_id text, zi_ro, interval_start, interval_sfarsit, plicuri int, contact_nume, contact_telefon, fan_id, stare
CHECK IN ('in_curs','plasata','necunoscuta','anulata','refuzata','manuala'), cerut_de, cerut_la, motiv_anulare)` cu UNIQUE parțial `(punct_client_id,
zi_ro) WHERE stare IN ('in_curs','plasata','necunoscuta','manuala')` (L16; `manuala` = comanda dată de om în contul curierului și consemnată în
ecran — e „vie” pe ziua ei, deci intră și în CHECK, și în index — Jakarinos) + claim atomic ÎNAINTE de apel (L04 / L22), timeout / 5xx = `necunoscuta` fără retry
(L05; reconciliere cu lista comenzilor dacă apelul există), intervalul calculat în ora României (L17), refuz local înainte de apel pe reguli
(interval, program). **Contactul implicit pe proiect** (D6): tabel nou `red_fan_proiect_setari (proiect_id PRIMARY KEY, contact_nume ≤ 50,
contact_telefon, interval_implicit_start time, interval_implicit_sfarsit time, observatii_sablon ≤ 200)` scris prin RPC (owner / admin Redări),
nu coloane noi pe `red_proiecte` (`contact_nume` / `contact_telefon` de acolo sunt contactul de pe convocator, alt rol). Datele personale ale
colegului de contact: nume + telefon de serviciu, vizibile admin / editor.

**Până la răspuns rămâne manual**, dar ecranul ajută: „Pregătește comanda” arată textul de copiat (numărul de plicuri, contactul, intervalul
propus — fără AWB-uri, §11 mai sus) și linkul spre contul curierului; comanda se consemnează în ecran („comandă dată manual azi, 14:00–16:30, de
<operator>”) ca să nu se dea de două ori (același tabel, `stare = 'manuala'`). **Nu intră în F1** (corectat: §13 F5 spunea că „poate intra în
F1”, contrar excluderii explicite din F1 — Jakarinos): cere tabelul `red_fan_comenzi`, deci vine cu F5 sau ca felie UI proprie după F1b.

## 12. De la forma de test la proiectul real

### 12.1 Ce gărzi cad și în ce ordine

1. Azi: `TRANSPORT_REAL_ACTIV = true`, **`DOAR_PROIECTE_TEST = true`** (lot pe proiect `TEST-` + marcat TEST; restul 423). F1 și F2 se livrează
   și se probează **cu garda pornită** (nimic pe proiecte reale).
2. **„Da”-urile** (§12.2) — fără ele garda nu cade.
3. PR separat, revizuit: `DOAR_PROIECTE_TEST = false` în handler ȘI `fn_red_fan_setari_doar_test(false)` în BD (owner, cu „da”-ul lui; cele două
   trebuie să coincidă — test de paritate, §7.3). Rămân: marcajul automat real / TEST, plafonul zilei (mic la început: 20), plafonul pe lot (20
   până după Testul 2), lista operatorilor, aprobarea pe hash (recalculat la generare), claim-ul atomic, separarea comenzi / înscriere (§7.3).
4. Testul 2 (`FANCOURIER_INTEGRARE.md` §11) pe un lot real de 10–20 de plicuri, cu butonul unic, de un operator numit (nu de owner), cu
   urmărirea automată pornită doar după ce ridicarea reală a fost văzută o dată și comparată cu contul curierului.
5. Abia apoi plafoanele cresc (din ecran, owner).

### 12.2 „Da”-urile necesare

- **Juridic**: (1) expedierea convocărilor prin curier cu oPOD = „scrisoare recomandată cu confirmare de primire” (deschisă de la 09.11.2026);
  (2) **data ridicării din sistemul curierului (C0) = data expedierii** pentru termenul de 10 zile, înregistrată automat. AR-ul și returul nu
  mai sunt întrebări deschise: proprietarul a decis (Q4 A, 18.11.2026) — AR automat doar cu dovada arhivată și primitorul = destinatarul, retur
  definitiv doar cu plicul fizic întors; juridicul e informat (§15.3).
- **Proprietar**: răspunsurile din §15.1 sunt date (18.11.2026); rămân: „da” la pornirea urmăririi automate pe loturi reale, lista operatorilor,
  plafonul inițial, rezultatul probei de hârtie (A5 în buzunar, față-verso) văzut de el.
- **Curier**: contul real pe API, punctul de lucru corect, AWB-ul pe A5 (direct sau micșorat, §8.6.3), limita pe minut, forma dovezii.

### 12.3 Cum se probează înainte, pe `TEST-RAZVAN`, cu contul de operator fără owner

Fiecare felie se probează cu contul `redari@` (editor Redări, fără owner), după un document de pași în stilul `FAN_TEST1_PASI.md` (coloana
„Acțiune” stabilă, simulatorul procedurii extins): (1) fără rând în lista operatorilor → butonul dezactivat + 403 / 42501 la apel direct; (2)
owner-ul îl numește (jurnal); (3) lot de TEST cu 3 plicuri (unul cu localitate inexistentă, ca la Testul 1) → un apăsat → „2 AWB-uri generate,
1 respins: adresa”, tarif; în F1 AWB-urile se descarcă (ca azi), în F1b pachetul de tipărit e gata → „Tipărește AWB-urile (A5)” (fereastra de
tipărire, coada „AWB A5”) + „Tipărește convocările + opisul (A4)” (DOCX-ul unit se deschide în Word: pagina de control, apoi convocările fiecărui
plic, fiecare pe foaia ei, opisul după ele cu verso alb) → evidența pe plic bifată automat, cu ora și numele; „Retipărește…” pe o poziție cu
motiv → `nr` 2 pe acel plic; (3a) plicul respins, corectat, „Trimite” pe același lot → exclus `lot_tiparit`; mutat într-un lot nou → trimis
acolo (Q5 A); (3b) rândul de control: „2 generate · 2 tipărite · 0 ridicate · 0 de verificat” (a doua zi lucrătoare, fără ridicare: excepția (a)
pe ambele); (3c) operatorul anulează un AWB neridicat (motiv din listă) → owner-ul îl vede în lista anulărilor; (4) plafonul zilei pus pe 1 de
owner → al doilea lot cu 2 plicuri → „toate cele 2 așteaptă aprobarea” (Q2 A) → owner aprobă → operatorul trimite; (5) dublu-click și două
taburi (cheia intenției; al doilea primește replay / „în curs”); (6) întreruperea simulată (secretele șterse între aprobare și generare → 503;
rândurile `aprobat` rămân, tirajul nu începe; repunere → „Reia trimiterea” cu ACEEAȘI cheie după expirarea arendei reia fără a renumăra, apoi
tirajul; §8.3); (6a) **apeluri directe ca operator ne-owner** (REST, contul `redari@` numit operator): `fn_red_fan_srv_rezultate`,
`fn_red_fan_srv_claim`, `fn_red_fan_srv_urmarire`, `fn_red_fan_srv_anuleaza`, `fn_red_fan_srv_reconciliaza`, `fn_red_fan_srv_intentie_incheie` →
`42501`; `fn_red_fan_ridicat`, `fn_red_fan_anulat`, `fn_red_fan_reconciliaza`, `fn_red_fan_aproba`, `fn_red_fan_lot_marcheaza`, `fn_red_fan_tiraj`
cu `p_inlocuieste` → `42501`; `PATCH /red_fan_awb` → `42501`; (6b) lotul nemarcat: prima trimitere pe un lot de TEST FĂRĂ marcaj anterior trece și
scrie marcajul (§8.1); (6c) „Retrage din trimitere” pe un plic aprobat netrimis → `retras`, lotul devine încheiat, tirajul pornește (§8.8);
(7) comanda curierului manual; (8)
urmărirea automată pornită de owner → la 13:00 rularea bifează `ridicat` în evidență, **nu** pe plic (lot de TEST), jurnalul rulării; propunerea
de anulare apare pe un AWB lăsat neridicat 3 zile lucrătoare; (9) arhiva: AWB-ul pe plic + ZIP-ul lotului. Toate cu garda de rețea a probelor
(scrieri doar pe entitatea de test) și cu inventarul de închidere (AWB-uri anulate înainte de ridicare dacă nu se vrea transport). Proba de hârtie
(§8.6.3) se face separat, pe imprimanta proiectului, înaintea pasului (3) din F1b.

## 13. Feliile livrabile (în ordinea recomandată)

Reguli comune ale fiecărei migrări (CLAUDE.md pct. 4, lecțiile D): forma livrării L15 v2 (garda legată de nume + tranzacție, plafon, amprentă
globală, allow-list-ul complet din 31d înainte și după, bugetul de lock, ordinea fixă a lock-urilor la aplicare), **ordinea unică a lock-urilor
la rulare din §6.2 scrisă în comentariul fiecărei funcții** și verificată în probele cu două sesiuni, clasa fiecărui RPC (§7.3) scrisă în
comentariu și verificată de postcondiții (EXECUTE exact pe `authenticated` / `service_role`), tabele noi cu RLS + GRANT
explicit (`REVOKE ALL`, apoi doar ce trebuie; politici cu `auth.uid() IS NOT NULL`), funcții `SECURITY DEFINER SET search_path = public,
pg_temp` cu `REVOKE EXECUTE FROM PUBLIC, anon` și EXECUTE doar rolului care le cheamă, postcondiții pe fiecare drept în parte (nu
`has_table_privilege` cu listă), revenire în `supabase/revenire/` care refuză cu date (LOCK NOWAIT înainte de verificarea „fără date”), probe
PGlite + două sesiuni pe clonă (de chat). Numărul migrării se alege după `git ls-tree` pe toate branch-urile (ciocniri).

### F1 — Operatorii numiți + butonul unic „Trimite la curier” (garda „doar TEST” rămâne)
F1 se poate scrie direct după review-ul acestui document: nu mai depinde de nicio întrebare deschisă (Q2, Q3, Q5, Q6 decise; Q1 / D12 / D13
privesc F1b). Conținutul EXACT:

**(1) Migrarea `…a_redari_fan_operator`** (număr după `git ls-tree` pe toate branch-urile; revenire în `supabase/revenire/`; NEAPLICATĂ —
aplicarea e a chat-ului):

| Obiect | Ce | Drepturi |
|---|---|---|
| `red_fan_operatori` (nou) | §7.1 (profil, numit / retras de / la, notă ≤ 200, CHECK retras_de ↔ retras_la) | RLS SELECT admin / editor; fără INSERT / UPDATE / DELETE pentru nimeni |
| `red_fan_zi` (nou) + trigger `fn_red_fan_zi_garda` | `zi_ro date PRIMARY KEY`, `aprobate int ≥ 0`; trigger BEFORE INSERT OR UPDATE: `NEW.aprobate <= limita_zi` și nu scade (§7.2) | la fel |
| `red_fan_zi_consum` (nou) | registrul consumului: `PRIMARY KEY (awb_id, zi_ro)`, `intentie`, `la` — sursa parității (§7.2) | la fel |
| `red_fan_cereri_aprobare` (nou) | §7.2 (lot, proiect, cerut de / la, n, zi_ro, stare `deschisa / aprobata / respinsa / retrasa`, decis de / la, motiv ≤ 500); index unic parțial `(lot_id) WHERE stare = 'deschisa'` | la fel |
| `red_fan_intentii` (nou) | §8.3 (cheie, lot, proiect, operator, hash_cerere, stare `in_curs / incheiata / neincheiata`, **`lucru_pana_la`** (arenda), rezultat fără PII, început / încheiată la, `incheiata_de`) | la fel |
| `red_fan_setari` (existent) | + `limita_zi int NOT NULL DEFAULT 20 CHECK (0…5000)`, + `doar_proiecte_test boolean NOT NULL DEFAULT true` (§7.3) (întrerupătoarele urmăririi / arhivării NU intră aici: vin cu F2 / F3, odată cu cine le citește) | neschimbate |
| `red_fan_awb` (existent) | stările noi `de_aprobat` și `retras` în CHECK-ul stărilor (§8.8); coloanele `cerere_aprobare_id uuid`, `aprobare_owner_la timestamptz`, `intentie_cheie uuid`, `retras_de uuid`, `retras_la timestamptz`, `motiv_retragere text` (CHECK: `plic_mutat / plic_anulat / lot_tiparit / operator / owner`), `anulare_ceruta_de uuid`, `anulare_ceruta_la timestamptz`, `anulat_de uuid`, `anulat_la timestamptz`, `motiv_anulare text` (CHECK pe lista din §8.4.1), `anulare_nota text ≤ 200` (obligatorie la `alt_motiv`); CHECK-urile noi din §8.8 (`red_fan_awb_retras`, `red_fan_awb_anulat`, `red_fan_awb_de_aprobat`) și cele existente rescrise textual (`aprobare`, `generat`); **backfill** (L14) pe rândurile `anulat` existente: `anulat_la = updated_at`, `anulat_de = aprobat_de`, `motiv_anulare = 'alt_motiv'`, `anulare_nota = left(motiv, 200)` — preflight: numărul lor raportat, zero rânduri = nimic de făcut; trigger BEFORE UPDATE `fn_red_fan_awb_garda`: `anulat_*` / `motiv_anulare` scrise doar din lista EXACTĂ {`fn_red_fan_srv_anuleaza`, `fn_red_fan_anulat`} (marcaj de tranzacție, §8.4.1), `retras_*` doar din {`fn_red_fan_comanda`, `fn_red_fan_retrage`, `fn_red_fan_cerere_decide`, `fn_red_fan_srv_claim`}, toate imuabile după scriere (L07 / L08). **Inventar obligatoriu în PR** (Jakarinos): fiecare predicat pe `stare` din 20261212a recitit pentru `de_aprobat` și `retras`, cu decizia scrisă în migrare: CHECK `aprobare` → ambele în lista „fără aprobare”; CHECK `generat` → ambele în lista „fără AWB”; CHECK `ridicat` → neschimbat; CHECK `in_curs` → neschimbat; indexul viu `red_fan_awb_plic_viu_uq` → `retras` se adaugă la excluse (`NOT IN ('eroare','anulat','retras')`), `de_aprobat` e viu; garda marcajului `NOT IN ('propus','eroare','anulat')` din `fn_red_fan_lot_marcheaza` → devine `NOT IN ('propus','de_aprobat','eroare','anulat','retras')` (o cerere în așteptare nu e o aprobare); plafonul pe lot (`fn_red_fan_aproba` + comandă) → `de_aprobat` se numără la „deja”; claim → cere strict `aprobat`; `fn_red_fan_propune` re-propunere → acceptă `propus / aprobat / de_aprobat`; `fn_red_fan_urmarire` / `confirmari` / `solutioneaza` → doar `generat / ridicat`, neschimbat; `red_fan_awb_cerere_ix` → neschimbat | neschimbate (scrieri doar prin RPC) |
| `v_red_fan_plafon_azi` (view nou, `security_invoker`) | limita zilei, aprobate azi, **cât mai încape** — ziua în ora României (L17), aceeași expresie ca în `fn_red_fan_comanda` (L19) | SELECT `authenticated` (RLS-ul tabelelor de dedesubt) |
| `v_red_fan_anulari` (view nou, `security_invoker`) | §8.4.1; coloana „avea foaia tipărită” = `NULL` până la F1b; și cererile de anulare deschise (`anulare_ceruta_la` fără `anulat_la`) | la fel; ecranul îl arată doar owner-ului |
| `v_red_fan_intentii` (view nou, `security_invoker`) | §8.3: cheia, lotul, starea, `lucru_pana_la`, sumarul — pentru „Reia trimiterea” la redeschiderea ecranului | SELECT `authenticated` (RLS) |

| Funcție | Clasa (§7.3) / poarta | Ce face |
|---|---|---|
| `fn_red_fan_e_operator()` (nouă) | EXECUTE `authenticated` | §7.1, o singură definiție (RPC + edge + ecran, L19) |
| `fn_red_fan_lot_permis(uuid)`, `fn_red_fan_lot_incheiat(uuid)`, `fn_red_fan_e_operator_profil(uuid)` (noi, interne, fără EXECUTE pentru roluri) | interne | garda „doar TEST” în BD (§7.3); „lot încheiat” (§8.8); verificarea lui `p_actor` în clasa B |
| `fn_red_fan_operator_seteaza(p_profile, p_activ, p_nota)` (nouă) | A, owner | numește / retrage; refuză profil fără nivel Redări admin / editor; jurnal |
| `fn_red_fan_setari_limita_zi(integer)`, `fn_red_fan_setari_doar_test(boolean)` (noi) | A, owner | §7.2; semnătura veche `fn_red_fan_setari_seteaza(integer)` rămâne neschimbată |
| `fn_red_fan_comanda(p_lot_id, p_intentie, p_plicuri, p_hash_cerere)` (nouă) | A, operator sau owner | §8.1 pașii 1–9: marcajul automat sub lock, `lot_permis`, `lot_tiparit` (Q5), propunere + aprobare internă, plafonul pe lot, plafonul zilei pe ambele ramuri (Q2: toate sau nimic → `de_aprobat` + cerere), intenția (reluare / replay, §8.3) |
| `fn_red_fan_retrage(p_id, p_motiv_cod)` (nouă) | A, operator sau owner | §8.8: `propus` / `aprobat` → `retras`; plic FOR UPDATE → rând |
| `fn_red_fan_cerere_decide(p_id, p_aproba, p_motiv)` (nouă) | A, owner | §7.2: aprobare fără consum de plafon (`aprobare_owner_la`) / respingere → `propus`; CAS pe `deschisa` |
| `fn_red_fan_cerere_retrage(p_id)` (nouă) | A, operatorul care a cerut sau owner | §7.2 / §8.8: `deschisa` → `retrasa`, rândurile → `propus` |
| `fn_red_fan_anulare_cere(p_id, p_awb, p_motiv_cod, p_nota)` (nouă) | A, operator sau owner | §8.4.1 pasul 1: cererea de anulare (nu schimbă `stare`); `RD035` dacă e deja cerută |
| `fn_red_fan_propune` | A, operator sau owner (azi admin / editor) | corpul mutat într-o funcție internă fără EXECUTE, chemată și de `fn_red_fan_comanda`; + `RD036` pe lot cu tiraj; re-propunerea aliniază `lot_id` / `proiect_id` la plic |
| `fn_red_fan_tiraj` | A: începere / confirmare — operator sau owner; **înlocuire** (`p_inlocuieste` nenul = „Tiraj nou”) — owner | + refuz **`RD031`** la începere pe lot neîncheiat (`fn_red_fan_lot_incheiat`, §8.8) + `lot_permis` |
| `fn_red_fan_srv_claim(p_actor, p_intentie, p_lot_id, p_ids, p_hashuri, p_surse)` (nouă) | **B, EXECUTE exclusiv `service_role`** | corpul lui `fn_red_fan_claim_lot` + intenția `in_curs` a lui `p_actor` (arenda reînnoită), `lot_permis`, rândurile cu plic mutat / anulat → `retras` |
| `fn_red_fan_srv_rezultate(p_actor, p_intentie, p_cerere, p_rezultate)` (nouă) | B | corpul lui `fn_red_fan_rezultate` + legătura cu intenția (`cerere_id` creat sub aceeași intenție), `lot_permis`, arenda |
| `fn_red_fan_srv_urmarire(p_actor, p_rulare, p_lot_id, p_randuri)`, `fn_red_fan_srv_confirmari(…)` (noi) | B | corpurile lui `fn_red_fan_urmarire` / `_confirmari` (un corp pentru om și cron, L19); `p_actor` XOR `p_rulare` (în F1 doar `p_actor`; `p_rulare` prinde viață în F2) |
| `fn_red_fan_srv_reconciliaza(p_actor, p_id, p_awb, p_tarif, p_tva)` (nouă) | B | „găsit” reverificat în borderou de funcția edge (§8.2); CAS pe `necunoscut` / `in_curs` > 10 min |
| `fn_red_fan_srv_anuleaza(p_actor, p_id, p_awb, p_rezultat)` (nouă) | B | §8.4.1 pasul 2: `sters` → `anulat`; `refuzat_ridicat` → cererea golită; `ambiguu` → nimic |
| `fn_red_fan_srv_intentie_incheie(p_actor, p_cheie, p_rezultat)` (nouă) | B | §8.3: CAS pe `in_curs`, sumarul DERIVAT din rânduri, listă albă de chei |
| `fn_red_fan_ridicat`, `fn_red_fan_reconciliaza`, `fn_red_fan_anulat`, `fn_red_fan_urmarire_solutioneaza` | **C, owner** (admin la soluționare), ca azi | excepțiile manuale; + `lot_permis` (`RD032`); `fn_red_fan_anulat` scrie și coloanele noi (D18) |
| `fn_red_fan_claim_lot`, `fn_red_fan_rezultate`, `fn_red_fan_urmarire`, `fn_red_fan_confirmari` (vechi) | owner, ca azi (clientul vechi: funcția edge `genereaza` / `urmarire` / `confirmari`) | semnătura și poarta neschimbate; + `lot_permis`; retragerea lor = migrare separată, DUPĂ publicarea funcției edge noi |
| `fn_red_fan_aproba` (veche) | owner, ca azi | + `aprobare_owner_la`, + `RD036` pe lot cu tiraj, + `red_fan_loturi FOR UPDATE` în poziția §6.2 |
| rămân owner, neschimbate | `fn_red_fan_setari_seteaza(integer)`, `fn_red_fan_lot_marcheaza`, `fn_red_fan_tiraj_opreste` | — |

Toate DEFINER cu `search_path = public, pg_temp`, `REVOKE … FROM PUBLIC, anon`, EXECUTE exact pe clasă (A, C: `authenticated`; B:
`service_role`; interne: nimeni); `CREATE OR REPLACE` doar după amprenta md5 a corpului vechi (`replace(prosrc, chr(13), '')`) + owner / ACL
verificate; **ordinea unică a lock-urilor §6.2** scrisă în comentariul fiecărei funcții (L06). Postcondiții: numărul exact al funcțiilor
`fn_red_fan_*` (vechi + noi, listă scrisă), EXECUTE pe fiecare funcție și fiecare rol în parte, RLS pe fiecare tabel nou, CHECK-urile din §8.8,
coloanele noi, trigger-ele exact (`tgqual IS NULL`, `tgnargs`, `tgtype`), allow-list-ul din 31d înainte și după. **Revenirea COMPLETĂ**
(Jakarinos: „nu doar obiectele enumerate sumar”): `LOCK … NOWAIT` în ordinea §6.2; refuză dacă există operatori numiți, rânduri în `red_fan_zi` /
`red_fan_zi_consum`, cereri, intenții, rânduri `de_aprobat` / `retras`, `intentie_cheie` / `aprobare_owner_la` / `anulare_ceruta_la` / `anulat_de`
nenule, `limita_zi <> 20`, `doar_proiecte_test <> true`, sau rânduri noi în `red_jurnal` cu evenimentele noi (`comanda`, `marcaj_automat`,
`retragere`, `anulare_ceruta`, `cerere_*`, `intentie_*`); altfel: DROP view-urile → funcțiile noi (A, B, interne) → trigger-ele noi → coloanele
noi (în ordinea inversă creării) → tabelele noi; readuce textual corpurile vechi ale funcțiilor modificate (`propune`, `aproba`, `claim_lot`,
`rezultate`, `urmarire`, `confirmari`, `ridicat`, `reconciliaza`, `anulat`, `tiraj`, `lot_marcheaza`) cu amprenta md5 verificată DUPĂ revenire,
CHECK-urile și indexul viu în forma veche, `red_fan_setari` fără coloanele noi; testată apply → rollback → re-apply (pe clonă, de chat).

**(2) Funcția edge `redari-fan-awb`**: acțiunea nouă `trimite` (§8.1, cu ordinea exactă pe lot nemarcat și „tirajul doar pe lotul încheiat”);
`deps.operator()` = `fn_red_fan_e_operator`; poarta pe acțiune: `trimite`, `eticheta`, `urmarire`, `confirmari`, `evenimente`, `reconciliaza`,
`sterge_awb` → operator sau owner; `genereaza` (calea detaliată) → owner, ca azi; codul nou `non_operator` (403); `sterge_awb` primește motivul ca
cod din listă și face anularea în doi pași (§8.4.1); `reconciliaza` cu `confirma:{id}` reverifică borderoul (§8.2); **al doilea client,
`service_role`**, DOAR pentru RPC-urile clasei B, DOAR după poarta omului, cu `p_actor = user.id` (§7.3; fișa a–e a funcției actualizată în
`FANCOURIER_INTEGRARE.md` §7); ordinea porților: JWT → utilizator → operator / owner → cerere → lot (RLS) → flag → garda „doar TEST” pe proiect
(`cereMarcaj:false` la `trimite`) → RPC-ul comenzii → garda completă (`cereMarcaj:true`) → secretele. `DOAR_PROIECTE_TEST = true` rămâne și e
dublată de `red_fan_setari.doar_proiecte_test` în BD.

**(3) Ecranul** (`src/redari/fanLot.js` + componenta Poștă / `FanAwbPrevizualizare.jsx`): ecranul operatorului din §1 (lista cu semnele
„gata / lipsește …”, „azi mai poți trimite N” din `v_red_fan_plafon_azi` — eroare de citire = mesaj, nu „0”, L18 —, avertismentul Q2 înainte de
apăsare, butonul unic, confirmarea, mesajul unic din §8.5, „Verifică la curier”, „Anulează AWB-ul” cu motiv din listă, „Confirmă: găsit”);
registrul local al intenției (§8.3); AWB-urile se **descarcă** ca azi (`descarcaBlob`; fără evidență de tipărire până la F1b); pentru owner:
„Operatori curier”, „Cereri de aprobare”, „Lista anulărilor”, pașii vechi strânși în „Pași detaliați (owner)”. Butonul ascuns / dezactivat
pentru cine nu e operator, cu motivul (decizia vine din `fn_red_fan_e_operator`, nu din JS).

**(4) Ce NU intră în F1**: pachetul de tipărit și evidența tipăririlor (F1b); A5 / față-verso (proba de hârtie + F1b; F6 doar dacă e nevoie);
urmărirea automată, excepțiile D11 și propunerea de anulare (F2); întrerupătoarele urmăririi / arhivării (F2 / F3); arhiva pe plic (F3);
comanda curierului și „Pregătește comanda” (F5); orice efect pe proiecte reale (F4).

- **Probe**: vitest (handler: 403 `non_operator` pe fiecare acțiune cu poarta nouă și 403 pe `genereaza` pentru operatorul fără owner; ordinea
  porților pe `trimite` cu lot NEMARCAT: `cereMarcaj:false` → RPC → `cereMarcaj:true` → secretele, și 423 pe proiect ne-TEST înaintea RPC-ului;
  clasa B chemată DOAR cu clientul `service_role` și DOAR după poarta omului (deps separate, verificate în test); `trimite` pe lot neîncheiat → fără
  etichete și fără tiraj; mesajele §8.5 ca tabel de cazuri, inclusiv `lot_tiparit`, `RD030`–`RD036`, reluarea și anularea în doi pași; registrul
  local al intenției — „scris și verificat înainte de apel”, „iese doar la rezultat dovedit”, „Reia trimiterea” cu aceeași cheie; simulatorul
  procedurii operatorului), PGlite (plafonul zilei P1–P10 din §7.2, inclusiv mutantul P6; Q2: o cerere peste plafon → TOATE `de_aprobat`, zero
  aprobate; cererea aprobată nu consumă plafonul; intenția I1–I7 din §8.3; `lot_tiparit` pe lotul cu tiraj → `retras`; `RD031` pe tirajul unui lot
  neîncheiat și fiecare rând al tabelului §8.8 (tranziție permisă trece, cea absentă e refuzată); `RD032` pe lot real cu garda pornită pentru
  owner, `service_role` și comandă; marcajul automat pe lot nemarcat (TEST → `test = true`; proiect ne-TEST → `RD032` fără rând); anularea în doi
  pași: cerere → înscriere `sters` / `refuzat_ridicat` / `ambiguu`, `anulat_*` imuabile și refuzate la scriere directă; **ca operator ne-owner
  (`SET LOCAL ROLE authenticated` + `sub` de operator numit), apel direct**: fiecare funcție din clasa B → `42501`, fiecare din clasa C → `42501`,
  `fn_red_fan_tiraj` cu `p_inlocuieste` → `42501`, `PATCH` pe orice tabel FAN → `42501`; ca `service_role` cu `auth.uid()` nenul → `42501`;
  `p_actor` fără rând de operator → `42501`; RLS / EXECUTE ca editor non-owner fără rând de operator = `42501` pe clasa A, viewer = 0 rânduri;
  revenirea refuză cu date și readuce amprentele vechi), două sesiuni pe clonă (doi operatori pe același plafon pe muchie, zi absentă: unul
  trece, celălalt `de_aprobat` — P5; două intenții pe același lot (a doua `RD030`, apoi după arendă preluarea — I5); începerea tirajului
  concurentă cu `fn_red_fan_comanda` pe același lot și cu `fn_red_fan_tiparire_inregistreaza` (F1b): fără deadlock, §6.2), proba live §12.3
  pașii 1–7, 3a, 3c, 6a–6c.
- **Lecțiile L01–L25**: cum le respectă e la §14; PR-ul F1 le reia pe fiecare cu fișierul / testul.
- **Risc**: bani — ținut de garda „doar TEST”, plafonul zilei (implicit 20, în Testul 1: 1 / 3), plafonul pe lot, aprobarea pe hash, claim-ul
  atomic și regula „lotul tipărit nu se mai atinge”. Risc de drept: un editor numit greșit — lista e owner-only, cu jurnal; nivelul rămâne
  precondiție; anularea făcută de operator e vizibilă owner-ului (listă + jurnal) și nu poate atinge un AWB ridicat.

### F1b — Pachetul de tipărit + evidența tipăririlor (D8–D10, D12, D13; după proba de hârtie)
- **Precondiție**: proba de hârtie de la §8.6.3 scrisă (A5 în buzunar citit de telefon și de curier la ridicare; fișierul A4 față-verso corect
  din Word și din LibreOffice). Q1 e decisă (A — DOCX unit), deci forma nu mai e de ales.
- **Conține**: `red_fan_tiparire_pachete`, `red_fan_tipariri`, `v_red_fan_plic_tiparire`, `fn_red_fan_tiparire_inregistreaza` (operator / owner;
  corpul verificării tirajului comun cu `fn_red_fan_tiraj`, L19); coloana „avea foaia tipărită” din `v_red_fan_anulari` devine reală. UI: cele
  două butoane „Tipărește AWB-urile (A5)” (fereastra de tipărire a browserului pe PDF-ul curierului, coada „AWB A5”) și „Tipărește convocările +
  opisul (A4)” (descărcarea DOCX-ului unit), „Retipărește…” (motiv din listă, poziții), evidența pe plic și pe lot, lista de distrus la „Tiraj
  nou”; modulul nou `src/redari/docxUnit.js` (unirea DOCX-urilor: secțiuni `oddPage` pe fiecare document, renumerotarea `rId` / `media` /
  `docPr`, stilurile; funcții pure, testabile pe fixture-uri DOCX mici) și construirea fișierului A4 din `planPachetPlicuire` + pagina de control,
  în ordinea D13 (pe plic: convocările, apoi opisul); paginarea opisului și a paginii de control cu număr fix de rânduri pe pagină, fiecare
  pagină în secțiune proprie (§8.6.2); mesajele §8.5 noi. Edge: nimic nou (AWB-urile vin deja din `trimite` / `eticheta`, neschimbate). Tot cu
  `DOAR_PROIECTE_TEST = true`.
- **Migrare descrisă** (`…a2_redari_fan_tiparire`, număr ales după `git ls-tree` pe toate branch-urile): cele două tabele cu CHECK-urile din §8.7.1,
  indexuri `(lot_id, tiraj_cheie, tip)` și `(plic_id, tip, tiraj_cheie)`, RLS SELECT admin / editor, `REVOKE ALL` + GRANT SELECT, funcția (DEFINER,
  `search_path` fix, EXECUTE `authenticated`, poarta în corp), view-ul `security_invoker`, jurnalul; postcondiții pe fiecare drept în parte (un
  `has_table_privilege` pe drept, nu cu listă), pe UNIQUE-uri și pe CHECK-ul `retiparire = (motiv IS NOT NULL)`. Revenire: refuză dacă există
  pachete (istoric de tipărire); altfel DROP view → funcție → tabele (copil înaintea părintelui), `LOCK … NOWAIT`.
- **Probe**: vitest (`docxUnit`: ordinea = manifestul, pe plic convocările apoi opisul (D13), fiecare document și fiecare pagină de opis în
  secțiune proprie cu `oddPage`, QR-urile distincte după unire, stilurile fără coliziune, un document lipsă = refuz înainte de unire (L12); registrul local al pachetului: scris și recitit înainte, iese doar la rezultat
  dovedit; sha256 stabil pe același conținut), PGlite (`nr` crește dens sub lock; replay cu aceeași cheie = zero rânduri noi; aceeași cheie + alt
  sha = 22023; cheie de tiraj veche = RD020; tiraj oprit = RD021; UNIQUE-urile; RLS ca editor non-owner fără rând de operator = 42501; viewer = 0
  rânduri), două sesiuni pe clonă (doi operatori predau același tip pe același lot deodată → `nr` 1 și 2, fără dublare), live pe `TEST-RAZVAN`
  (un lot de TEST cu 2–3 plicuri, pe laptopul și imprimanta proiectului: cele două fișiere, Word deschide DOCX-ul unit și previzualizarea de
  tipărire arată fiecare document pe față nouă, opisul cu verso alb, număr par de pagini pe proprietar; foile A5 din tava A5; evidența pe plic;
  retipărirea unei poziții; „Tiraj nou” arată lista de distrus).
- **Risc**: date personale în fișierele descărcate (aceleași ca în ZIP-ul de azi: fișiere locale pe laptopul proiectului, disc criptat, nu în
  Storage; §8.6.5); evidența în avans față de hârtie (limita D10, acoperită de D11); unirea DOCX pe șablonul real (antete / subsoluri /
  numerotări) — probată înainte de PR; scara A5 dependentă de fereastra de tipărire — ținută de coada „AWB A5” setată de suport și, dacă proba o
  cere, de F6.

### F2 — Urmărirea automată + verificarea generate / tipărite / ridicate (D4, D11)
- **Precondiție (P1 înainte de F2, Jakarinos)**: regula contradicțiilor în ACELAȘI răspuns în `rezumatUrmarireFan` (§9.2), cu tabelul de cazuri.
- **Conține**: `red_fan_rulari` (+ `control jsonb`), `fn_red_fan_urmarire_tick` (postgres / pg_cron), secretul Vault `REDARI_FAN_INTERN_SECRET` (generat în BD),
  `fn_red_fan_srv_urmarire` / `fn_red_fan_srv_confirmari` cu `p_rulare` activ, `fn_red_fan_srv_bifeaza`, `fn_red_fan_srv_rulare` (clasa B, EXECUTE
  doar `service_role`; corp comun cu `fn_red_fan_ridicat`; bifarea în tranzacție separată, ordinea §6.2),
  coloanele `red_plicuri.curier_livrat_la / curier_livrat_cod / curier_retur_semnalat_la / curier_retur_motiv` (+ CHECK: motivul în lista de
  retur; trigger-ul plicului lasă aceste coloane scrise DOAR de funcția internă — proveniență, L08), jobul cron (`cron.schedule`, idempotent pe
  nume), funcția edge `redari-fan-urmarire` (în `NO_JWT`), întrerupătorul `red_fan_setari.urmarire_auto_activa` (implicit oprit; owner, din
  ecran, prin `fn_red_fan_setari_seteaza` extinsă), lista „De verificat” și „Ultima urmărire” în
  ecran, rândul `automatizari` + registrul (chat). **D11**: `fn_red_zi_lucratoare_dupa`, view-urile `v_red_fan_control_zi` și `v_red_fan_exceptii`,
  `red_fan_tiparire_lamuriri` + `fn_red_fan_exceptie_lamureste` (owner / admin Redări), instantaneul `control` scris de rulare, rândul de control
  și excepțiile în ecran (texte din coduri, în `fanLot.js`), propunerea de anulare (flagul `propune_anulare` din `v_red_fan_exceptii` + butonul „Anulează AWB-ul” din F1, apăsat de operator, Q6 A;
  nimic automat), și pe loturile de TEST (§9.5.2).
- **Probe D11** (în plus față de cele de jos): tabel de cazuri pentru (a)–(d) cu ceasul (vineri → marți 08:00; sâmbătă / duminică; 07:59 vs 08:00;
  ora de vară), paritate SQL ↔ așteptările din acest document (L25: așteptările din §9.5.2, nu din cod); anulat înainte / după tipărire; „Tiraj
  nou” → TIPĂRITE 0; replay-ul lămuririi (aceeași cheie primară = 23505 → mesaj „deja lămurit”).
- **Migrare descrisă** (`…b_redari_fan_urmarire_auto`): precondiții fail-closed ca în 20261011a (`fn_verifica_secret` pinuită, extensiile
  `pg_cron` / `pg_net` / Vault prezente, secretul inexistent și fără `_VECHI`), tabelul rulărilor, coloanele pe plic (ALTER cu lock SHARE ROW
  EXCLUSIVE pe `red_plicuri` în setul fix), funcțiile, trigger-ul plicului extins (amprenta corpului vechi verificată), jobul cron; postcondiții:
  EXECUTE exact (nimic pentru `authenticated` pe cele două funcții auto), jobul exact (nume, program, utilizator, activ), secretul o dată.
  Revenire: `cron.unschedule`, funcțiile, coloanele doar dacă sunt goale, secretul șters; refuză cu rulări sau bifări în jurnal.
- **Probe**: vitest pe handler-ul cronului (401 fără secret / secret greșit / JWT fără secret; întrerupătorul oprit = nimic chemat; oprirea la
  429; tabelul §9.2 ca tabel de cazuri cu paritate SQL ↔ JS, L19), PGlite (bifarea pe lot real vs TEST; CAS; contradicția nu atinge plicul; data
  în viitor; revendicarea slotului o singură dată), pe clonă două sesiuni (rulare + soluționare concurentă, ca C1 / C2), live pe `TEST-RAZVAN`
  (§12.3 pasul 8) cu un AWB ridicat real de curier pe un lot de TEST.
- **Risc**: `service_role` (perimetru minim, poarta pe secret, EXECUTE exclusiv); scriere cu efect juridic pe loturi reale — inertă până la F4
  și la „da”-ul juridic; întrerupătorul implicit oprit.

### F3 — Arhiva (etichete pe plic, PDF-ul lotului, dovada de livrare, AR automat doar cu dovadă)
- **Conține**: coloanele `eticheta_* / dovada_*` pe `red_fan_awb`, RPC `fn_red_fan_srv_arhiva` (clasa B, EXECUTE `service_role`, verifică obiectul
  în Storage + eTag, calea pe listă albă legată de rândul AWB), descărcarea dovezii din URL extern pe contractul §10.3 (gazde pe listă albă, fără
  redirecturi, tip și mărime verificate), pasul de arhivare în rularea automată (după urmărire; max 30 de apeluri de etichetă pe rulare), scrierea
  PDF-ului lotului din `trimite` (JWT-ul operatorului), AR-ul automat (varianta (a)/(b), doar cu primitorul = destinatarul; Q4 decis A), ZIP-ul lotului cu fișierele noi,
  coloana paginii de control, `arhivare_auto_activa`.
- **Migrare descrisă** (`…c_redari_fan_arhiva`): coloane + CHECK-uri (path pe forma `^plicuri/<uuid>/awb_[0-9]{6,20}_…$`, sha256 hex, forma),
  funcția, politica Storage nouă NU e necesară (service_role + politicile existente admin / editor); postcondiții pe verificatorul politicilor
  storage (`fn_red_storage_verifica_redari`, existent) — nimic nou expus.
- **Probe**: vitest (numele fișierelor, planul ZIP cu `900` / `901`, variantele dovezii (a)–(d) ca tabel de cazuri, potrivirea numelui
  normalizat), PGlite (RPC-ul refuză o cale în afara listei / un obiect lipsă), live (eticheta apare în dosarul plicului de test și în ZIP).
- **Risc**: PII în Storage (același bucket, aceleași drepturi ca scanurile de azi); apeluri în plus la curier (limitate, cu pauză).

### F4 — Trecerea la proiectul real
- PR cu constanta `DOAR_PROIECTE_TEST = false` + schimbarea flagului din BD de către owner (`fn_red_fan_setari_doar_test(false)`, fără migrare:
  e o setare), testul de paritate constantă ↔ flag, testele mutate, procedura Testului 2 cu butonul unic (document de pași + simulator), rândurile
  `automatizari` / registrul la zi (chat), plafoanele recitite din BD. Cere §12.2. Risc: cel real — ținut de plafonul zilei mic, de lista
  operatorilor, de separarea comenzi / înscriere (§7.3) și de urmărirea cu întrerupător.

### F5 — Comanda curierului din platformă (după răspunsurile curierului)
- `red_fan_comenzi` (cu `manuala` în CHECK și în indexul comenzilor vii, §11), `red_fan_proiect_setari`, `fn_red_fan_comanda_curier_claim`
  (clasa A) / `fn_red_fan_srv_comanda_curier_rezultat` (clasa B) / `fn_red_fan_comanda_curier_anuleaza`, acțiunile `comanda_curier` /
  `anuleaza_comanda` în funcția edge, ecranul §11; „Pregătește comanda” + consemnarea manuală (`stare = 'manuala'`) vin TOT aici (sau într-o
  felie UI proprie după F1b), **nu în F1** (corectat; contrazicea excluderea din F1 pct. (4)).

### F6 — AWB-ul pe A5 făcut de platformă (doar dacă proba de hârtie o cere)
- **Pasul 0, zero cod** (comun cu F1b): proba de hârtie de la §8.6.3 (tabelul pct. 1–8). Rezultatul se scrie în `FANCOURIER_INTEGRARE.md` §8
  (deschisa 17).
- **Dacă curierul dă A5 direct** (`format=A5` sau o setare a contului): o constantă + un test — preferat; nimic micșorat.
- **Dacă proba reușește din fereastra de tipărire și scara e stabilă** (aceeași la fiecare tipărire, pe coada „AWB A5”): F6 nu se face.
- **Altfel** (scara variază, părțile de câte 100 trebuie unite): în funcția edge, pasul de **așezare pe A5** (biblioteca PDF pe Deno, pagina A4
  încorporată ca formular, factorul fix 0,705, centrată, fără rasterizare; unirea părților într-un PDF A5 pe lot), DOAR pentru fișierul de
  imprimantă (sufixul `_A5`, tipărit la „dimensiune reală”); originalul rămâne pentru arhivă și evidență. Teste: dimensiunea paginii (A5),
  numărul paginilor = numărul AWB-urilor, ordinea = pozițiile, originalul neschimbat (sha256), un PDF de formă necunoscută (nu A4, mai multe
  pagini pe AWB) = fără transformare + mesaj (L12 / L13). Fără librărie nouă în browser. Aceeași cale servește și alternativa 100 × 150 (§8.6.4),
  cu factorul 0,476, dacă proiectul o alege vreodată.

## 14. Lecțiile L01–L25: cum le respectă implementarea descrisă

- **L01** lock înainte de verificare: `fn_red_fan_comanda` ia lotul, plicurile, rândurile, `red_fan_loturi`, setările (un rând = serializarea
  plafonului) și abia apoi verifică; plafonul zilei: `SELECT … FOR UPDATE` pe rândul zilei (absent = 0, explicit), verificarea ÎNAINTEA oricărei
  scrieri pe AMBELE ramuri, apoi `INSERT … ON CONFLICT DO UPDATE` + postcondiție în RPC + trigger-gardă (§7.2, P1–P10); revendicarea slotului cron
  prin `INSERT … ON CONFLICT DO NOTHING RETURNING`; `fn_red_fan_tiparire_inregistreaza` ia lotul FOR UPDATE și abia apoi numără tipăririle
  existente (`nr` dens, UNIQUE); regula `lot_tiparit`, marcajul automat și `RD031` se verifică sub lock-ul lotului, pe care îl ia și începerea
  tirajului (cele două se serializează).
- **L02** atomic: propunere + aprobare + plafon + cerere + intenție într-UN RPC; rezultatele unei solicitări într-un RPC (existent); bifarea pe
  plic + evidența FAN + jurnalul într-o tranzacție; Storage scris înainte, înregistrarea căii doar după verificarea obiectului; pachet + rânduri pe
  plic + jurnal într-UN RPC, iar fișierul se predă DOAR după rowcount confirmat (fără fișier predat fără evidență).
- **L03** rezultat vechi: CAS pe `versiune_urmarire` (existent) și la cron; tirajul (existent); intenția încheiată cu CAS pe `in_curs`.
- **L04** idempotență: cheia intenției UUID + hash-ul cererii (`UNIQUE`, aceeași cheie + alt hash / alt lot / alt operator = eroare; replay verifică
  lotul, apelantul și payloadul canonic, §8.3); consumul plafonului o singură dată pe rând și zi (`PRIMARY KEY (awb_id, zi_ro)`); cheia solicitării
  (existent); o rulare = un rând unic `(zi_ro, slot)`; pachetul de tipărire = cheie UUID + contractul semantic complet (lot, tiraj, tip, parte,
  poziții, sha256, motiv; replay doar la egalitate totală, 22023 altfel); lămurirea = cheie primară `(awb_id, tip)`; anularea = o cerere
  deschisă pe rând (`RD035` la a doua).
- **L05** ambiguu = necunoscut: fără retry la `necunoscut` / `in_curs`, butonul blocat până la reconciliere, registrul local nu iese la 5xx /
  42501, reluarea aceleiași intenții după crash (arenda `lucru_pana_la`, fără cheie nouă, fără dublă aprobare, `RD033` peste un rând nelămurit),
  replay-ul întoarce sumarul DERIVAT din rânduri (memo-ul nu e adevăr), cronul se oprește la primul 429 / 5xx; anularea cu răspuns ambiguu =
  cererea rămâne deschisă, nimic scris; la tipărire, un 5xx după RPC nu lasă fișierul „pierdut”: cheia rămâne în registrul local și pachetul se
  recitește din BD la redeschidere (replay).
- **L06** deadlock: O SINGURĂ ordine, §6.2, scrisă în fiecare RPC: lot → plicuri → rânduri FAN → `red_fan_loturi` → setări → `red_fan_zi` (+ consum)
  → cereri → intenții → pachete / tipăriri → lămuriri / rulări → jurnal; lock-urile implicite (FK `KEY SHARE`, `ON CONFLICT`) numărate; cronul:
  urmărirea doar pe rânduri FAN, bifarea în ALTĂ tranzacție plic → rând FAN → jurnal (ca `fn_red_fan_ridicat`), fără lock pe lot (nu schimbă marcaj
  / tiraj); revenirile `LOCK … NOWAIT` în aceeași ordine.
- **L07** toate căile: `de_aprobat`, `retras` și contorul zilei impuse în RPC + trigger-gardă pe `red_fan_zi` (fără GRANT de scriere); garda „doar
  TEST” în BD (`fn_red_fan_lot_permis`) pe TOATE funcțiile cu efect, vechi și noi, owner inclus; „lotul tipărit nu se mai atinge” și „tiraj doar pe
  lotul încheiat” impuse în `fn_red_fan_comanda` / `fn_red_fan_tiraj` / `fn_red_fan_propune` / `fn_red_fan_aproba`, nu doar în funcția edge;
  `anulat_*` / `motiv_anulare` / `retras_*` scrise doar din lista exactă de funcții și imuabile prin trigger BEFORE UPDATE; coloanele `curier_*` pe
  plic scrise doar de funcția internă (trigger BEFORE pe OLD / NEW); operatorii doar prin RPC; evidența tipăririi și lămuririle fără niciun GRANT de
  scriere (doar RPC), fără trigger care să sincronizeze „tipărit” pe `red_fan_awb` / `red_plicuri` — D11 compară, nu copiază.
- **L08** identitate: `auth.uid()` în clasele A și C; funcția edge nu primește rolul; **înscrierea rezultatelor externe (clasa B) nu e apelabilă de
  niciun om**: EXECUTE exclusiv `service_role` + `auth.uid() IS NULL` + `p_actor` verificat de funcția edge din JWT și re-verificat în corp ca
  operator / owner („cale server cu rol verificat explicit” — singura excepție admisă de L08, declarată și justificată la §7.3); calea cron la fel,
  cu secret în Vault (rol verificat explicit, nu claims); autorii puși de server (inclusiv `anulat_de` / `anulat_la`, `retras_de`, `marcat_de` la
  marcajul automat).
- **L09** entitatea țintă: lotul citit cu JWT-ul omului (RLS); fiecare plic verificat pe lotul lui; căile Storage pe listă albă legate de plicul
  rândului.
- **L10** secrete: secret propriu pentru poarta cronului (fără fallback, fără `_VECHI` în afara rotației), secretele curierului neschimbate,
  nimic în loguri / răspunsuri.
- **L12 / L13**: forma necunoscută = „de verificat”, nimic nu dispare (rândurile „depășite” / „păstrate” numărate); listele de coduri pe listă
  albă, regex-urile ancorate (existente).
- **L14 / L15**: migrări în forma L15 v2, cu preflight pe date, postcondiții, revenire testată apply → rollback → re-apply; allow-list-ul din 31d.
- **L16** unicitate: `red_fan_zi (zi_ro)`, `red_fan_rulari (zi_ro, slot)`, `red_fan_intentii (cheie)`, cererile deschise pe lot, comenzile vii pe
  punct / zi; hash-ul cererii pe lista canonică; `red_fan_tipariri (pachet_id, plic_id, tip)` și `(plic_id, tip, tiraj_cheie, nr)`; identitatea
  fișierului predat = sha256 pe conținut, nu numele.
- **L17** timp: ziua și orele în `Europe/Bucharest` (contorul zilei, sloturile, data expedierii = data C0 locală); tick orar în loc de cron fix
  (ora de vară); ziua generării și ferestrele excepțiilor D11 în ora României, zilele lucrătoare printr-o singură funcție SQL, „de la 08:00” pe
  timestamp exact (07:59 nu e 08:00).
- **L18** fail-open: eroare ≠ gol (RPC eșuat = mesaj, nu „nimic de trimis”); „azi mai poți trimite N” doar din citire reușită; necunoscut ≠ 0;
  tarif gol = „necunoscut”; „avea foaia tipărită” = `NULL` (necunoscut) până la F1b, nu „nu”.
- **L19** o definiție: `fn_red_fan_e_operator` (RPC + edge + ecran), corpul comun al urmăririi / bifării (om + cron), mesajele §8.5 în `fanLot.js`,
  tabelul cod → efect ca tabel de cazuri cu paritate JS ↔ SQL; „tipărit” / „netipărit” / excepțiile (a)–(d) / numerele D11 calculate o singură
  dată în SQL (view-uri) și primite de ecran ca flaguri; verificarea tirajului la înregistrarea tipăririi = corpul lui `fn_red_fan_tiraj`;
  manifestul pachetului de tipărit = `manifestTiparire` (același ca etichetele și arhiva).
- **L20** garda nouă testată și pe căile legitime: owner-ul fără rând de operator trece; prima trimitere pe un lot de TEST nemarcat trece și
  marchează; cererea aprobată se trimite; plicul respins mutat într-un lot nou se trimite acolo; lotul fără niciun AWB poate fi retrimis;
  anularea de operator pe un AWB neridicat trece (în doi pași), pe unul ridicat e refuzată; funcția edge veche (owner) continuă să anuleze până
  la publicarea celei noi (D18); retragerea unui operator cu intenție `in_curs` nu rupe încheierea (clasa B scrie rezultatele deja plătite, owner-ul
  poate încheia); reluarea aceleiași intenții după crash trece fără cheie nouă; retragerea din trimitere închide lotul și deblochează tirajul;
  CHECK-ul stărilor e derivat din tabelul tranzițiilor §8.8 și fiecare rând al lui are probă; întrerupătorul oprește doar rulările noi; refuzul
  local (plafon, `RD032`) raportat distinct de eșecul extern; retipărirea legitimă (motiv, poziții alese) trece, iar „Tiraj nou” nu șterge evidența
  veche (istoric); excepțiile (a) / (b) se închid singure la C0 / tipărire / anulare (nu rămân agățate) și nu apar pe AWB-uri ridicate, (c) / (d)
  doar prin lămurire.
- **L21 / L22**: nu e AI; pasul durabil înaintea apelului plătit (existent) + aprobarea / plafonul înaintea rezervării.
- **L23** paginare: citirile cronului cu keyset (`urmarit_la, id`), id-uri în bucăți de 100 (`citesteToate`, existent).
- **L24** async: generația + lotul la fiecare acțiune (existent); descărcările multiple după `await` reverifică generația; registrul local pe
  cheie.
- **L25** teste reale: așteptările din documentele curierului și din acest document, nu din codul testat; RLS / EXECUTE ca `authenticated` /
  `service_role` non-owner pe PGlite și pe clonă; două sesiuni reale cu barieră.

## 15. Întrebările: decise și deschise

### 15.1 Către proprietar — TOATE DECISE (18.11.2026, trecerea a treia)

Nu mai rămâne nicio întrebare deschisă pentru proprietar. Toate șase au fost decise pe varianta recomandată în trecerea a doua; variantele
respinse rămân aici doar ca istoric (de ce s-a ales așa). Două întrebări din prima trecere fuseseră scoase înainte, fiind deja decise:
unitatea plafonului (D3 — rămâne plafonul pe lot ca a doua frână și valoarea inițială 20 pe zi până după Testul 2) și forma listei operatorilor
(D2; că e una pe tot modulul, nu pe proiect, rămâne presupunere de proiectare, marcată la §16).

| # | Întrebarea | Decizia (18.11.2026) | Variantele respinse | Unde se aplică |
|---|---|---|---|---|
| Q1 | Fișierul pentru tava A4 (convocările + opisul într-un singur fișier, D8) | **A** — un singur fișier Word unit, fiecare document pe o față nouă (corect la față-verso), tipărit din Word / LibreOffice | B) PDF prin convertor pe un server al firmei (infrastructură nouă cu date personale; rămâne doar rezervă dacă unirea eșuează); C) arhiva ZIP fișier cu fișier (nu respectă D8) | §1, §8.6.2, F1b |
| Q2 | Trimiterea care nu încape în plafonul zilei | **A** — TOATĂ trimiterea așteaptă aprobarea owner-ului; operatorul vede dinainte cât mai încape | B) se trimit câte încap (două tiraje pe același lot); C) refuz sec | §1, §2, §7.2, §8.1, F1 |
| Q3 | Ce poate face operatorul în afara butonului | **B** — retipărește (același tiraj, motiv din listă), anulează un AWB neridicat, confirmă „găsit” la reconciliere; la owner rămân: confirmarea că un AWB NU există, „Tiraj nou”, lămurirea excepțiilor „ridicat dar netipărit” / „anulat după tipărire” | A) nimic în afara butonului; C) și absența + lămuririle la operator | §1, §2, §7.1, §8.4, §8.4.1, §9.5.2, F1 / F1b |
| Q4 | Ce bifează platforma singură, fără hârtie | **A** (decisă explicit de proprietar mai devreme) — ridicarea automat (de aici curg cele 10 zile); livrarea = fapt al curierului; AR-ul automat DOAR cu dovada curierului arhivată în dosar și primitorul = destinatarul; returul definitiv doar cu plicul fizic întors (automat doar „retur semnalat”). La juridic rămâne de confirmat **doar data ridicării ca dată de expediere** (§15.3 pct. 2) | B) AR și retur definitive din codul curierului; C) doar ridicarea automat | §3, §9.2, §10.3, §12.2, F2 / F3 |
| Q5 | Plicurile respinse și corectate | **A** — se mută într-un lot nou de plicuire și se trimit ca lot nou; lotul tipărit nu se mai atinge (garda `lot_tiparit` în BD) | B) același lot + „Tiraj nou” al owner-ului; C) „Tiraj nou” la operator | §1, §8.1, §8.4, §8.5, F1 |
| Q6 | AWB-uri plătite care nu pleacă: când se propune anularea și cine anulează | **A** — netipărit 3 zile lucrătoare SAU tipărit dar neridicat 3 zile lucrătoare → platforma propune anularea, operatorul o face (un click, doar înainte de ridicare), owner-ul vede lista anulărilor | B) anularea doar de owner; C) nimeni nu anulează din platformă | §1, §2, §3, §8.4.1, §9.5.2, §9.5.4, F1 (anularea, lista) + F2 (propunerea) |

Deciziile noi din aceeași trecere, care nu erau întrebări: **D12** (AWB pe A5 în buzunarul transparent; imprimanta proiectului cu două tăvi),
**D13** (față-verso, număr par de pagini pe proprietar, opisul după convocări, doar pe față), **D14** (laptopul proiectului) — §0.

**Ce mai cer de la proprietar înainte de felii** (nu sunt întrebări de proiectare, sunt pași): proba de hârtie pe imprimanta proiectului
(înainte de F1b, §8.6.3) și cozile de tipărire puse de suport pe laptop (§8.6.5).

### 15.2 Către curier

1. **Formatul AWB-ului (A5)**: cererea `GET /awb/label?…&pdf=1&format=A6` a întors A4; `format` e luat în seamă la `pdf=1`? Există `format=A5`
   (sau alt parametru) care dă AWB-ul direct pe o pagină A5? Formatul depinde de o setare a contului / punctului de lucru?
2. **`POST /order`**: câmpurile corpului (clientId, adresa de ridicare, data, interval, nr. plicuri / colete, greutate, contact, observații),
   forma răspunsului (id, stare), ce întoarce la a doua comandă pe zi pe același punct, dacă se leagă de AWB-uri, dacă există citirea comenzilor
   zilei, fusul orar al orelor, lungimea maximă a observației.
3. **Limita de solicitări pe minut / pe zi** la creare, urmărire, confirmări, etichete (întrebare trimisă 15.11.2026, fără răspuns).
4. **Forma dovezii de livrare** în `GET /reports/awb/confirmations`: câmpurile fiecărui element; imaginea confirmării vine ca URL, inline sau
   deloc; cum se obține cartonașul oPOD; când apare confirmarea față de evenimentul S2.
5. **Tariful**: tariful din răspunsul creării (fără TVA, cu `vat` separat) a diferit de oferta comercială pe primul AWB — de ce (opțiunea oPOD?
   punctul de lucru? contul de test)? Tariful contractual pe plic (1 kg, 32×24×1 cm, oPOD).
6. **Punctul de lucru**: `clientId`-ul contului real = punctul de unde pleacă plicurile? Un singur punct sau unul pe proiect?
7. **Eticheta pe un singur AWB**: `GET /awb/label` cu un AWB întoarce același PDF ca în lot (pentru arhiva pe plic)? Limita de AWB-uri pe apel;
   ordinea paginilor = ordinea `awbs[]`?
8. **AWB-ul micșorat în buzunarul transparent** (completează pct. 1): AWB-ul A4 tipărit pe A5 (micșorat la ≈ 70 %, laser 600 dpi), introdus în
   plicul transparent autocolant al curierului (17 × 22,5 cm), e acceptat de cititoarele curierilor la ridicare și la sortare? Care e factorul
   minim de micșorare acceptat? Buzunarele transparente se primesc de la curier (câte, cum se comandă, cu cost)? Pentru alternativa autocolantă
   (§8.6.4): există ieșire ZPL / EPL sau un șablon A6 / 100 × 150 cu litere pe măsura foii?
9. **AWB neridicat**: un AWB generat, dar niciodată predat curierului, se facturează? După cât timp expiră singur? Anularea înainte de ridicare
   (`DELETE /awb`) anulează și factura?
10. **Comanda și AWB-urile**: comanda de ridicare nu are câmp de AWB; legătura comandă ↔ AWB-uri se face la ridicare? Raportul de comenzi din API
    expune AWB-urile ridicate (câmpul din aplicația web)? Observația comenzii ajunge întreagă la curier (în lista web apare tăiată la 50 de caractere)?

### 15.3 Către juridic (lista confirmată de proprietar, D16, 18.11.2026: rămân DOAR 1, 2, 5, 6)

1. Convocarea trimisă prin curier cu oPOD (AWB-ul cu confirmare) = „scrisoare recomandată cu confirmare de primire” (deschisă din 09.11.2026)?
2. **Data expedierii = data ridicării de către curier** (evenimentul C0 din sistemul curierului), înregistrată automat; termenul de 10 zile
   curge de la ea? (Singura întrebare juridică rămasă din Q4; bifarea automată pe loturi REALE așteaptă acest răspuns, F4.) Dacă curierul corectează ulterior data ridicării, care dată contează și cum se consemnează corectarea?
3. ~~**AR-ul**: dovada electronică a curierului ține locul cartonașului oPOD fizic?~~ **Închisă prin decizia proprietarului (Q4 A,
   18.11.2026)**: AR-ul se bifează automat doar cu imaginea confirmării arhivată în dosar și primitorul = destinatarul; altfel îl înregistrează
   omul, ca azi (inclusiv mențiunea „altă persoană”). Juridicul e informat; dacă vrea altă regulă, se schimbă doar F3.
4. ~~**Returul**: codul curierului e suficient pentru PV B?~~ **Închisă prin decizia proprietarului (Q4 A, 18.11.2026)**: returul definitiv rămâne
   cu plicul fizic întors (scanat); codul curierului dă doar „retur semnalat”.
5. **Păstrarea** etichetelor și dovezilor (date personale) în dosarul plicului: cât timp, cine le vede, ce se șterge la închiderea proiectului.
6. Numele colegului de contact (persoana de la predare) și telefonul lui ajung în sistemul curierului: e nevoie de informarea lui / acordul lui?

## 16. Ce nu s-a putut stabili din cod (presupuneri marcate, de verificat la implementare)

- Forma reală a răspunsurilor curierului la urmărire / confirmări / borderou (deschisele 7, 10, 16 din `FANCOURIER_INTEGRARE.md` §8) — codul e
  defensiv; tabelul §9.2 se verifică pe răspunsuri reale la Testul 1 (ridicarea reală a primului AWB).
- Că `GET /awb/label` pe un singur AWB întoarce o etichetă echivalentă și că apelurile repetate nu au limită (§10.1, §15.2 pct. 7).
- Că pe mediul real există `pg_cron`, `pg_net` și Vault în forma folosită de `20261011a` (migrările de acolo le verifică fail-closed; pe clonă
  se probează) și că workflow-ul de publicare acceptă funcția nouă în lista `NO_JWT` (precedent: `cleanup-recycle-bin`).
- Că `service_role` poate scrie în `storage.objects` fără politică nouă (în Supabase sare peste RLS) — de confirmat pe clonă; altfel o
  politică restrânsă la căile `plicuri/<uuid>/awb_*`.
- Corpul exact al CHECK-ului `red_plicuri_retur_complet` / `red_plicuri_ar_scan` pe mediul real = cel din `20261129i` (coloanele `curier_*` noi
  nu îl ating; se verifică prin amprentă la aplicare).
- Că trigger-ul plicului (`20261129i`) acceptă scrierea coloanelor noi `curier_*` dintr-o funcție DEFINER fără să le trateze ca „AR / retur
  deja înregistrat” — se extinde explicit în F2, cu amprenta corpului vechi.
- Durata unei rulări de urmărire cu 3.000 de AWB-uri (30 de solicitări × timeout 30 s + pauze) față de limita de execuție a funcției edge:
  plafonul de 30 se poate reduce la 15 dacă proba pe clonă o cere.
- Existența unui ecran de setări pe proiect în Redări în care să intre contactul implicit (§11); altfel caseta se pune în ecranul proiectului.
- Că lista operatorilor e una pe tot modulul (nu pe proiect) — presupunere de proiectare, D2 nu spune; dacă proprietarul vrea pe proiect,
  `red_fan_operatori` primește `proiect_id` în cheie (schimbare mică, înainte de F1).
- Că șablonul real al convocatorului (`convocator.docx`) se poate uni cu alte documente fără conflicte de stiluri / antete / numerotări (§8.6.2)
  — se probează pe fixture-uri reale înainte de PR-ul F1b; dacă nu, varianta respinsă B (PDF prin convertor) revine ca propunere, cu „da”-ul
  proprietarului (Q1 a fost decisă pe A).
- Că o convocare (convocarea + informarea pe verso) are exact 2 pagini pe șablonul real și că opisul încape în numărul de rânduri ales pe pagină
  (§8.6.2, D13) — se văd la proba de hârtie; regula față-verso ține și altfel, doar numărul de foi crește.
- Că Word și LibreOffice tipăresc pagina albă cerută de secțiunile „pe pagină impară” la față-verso (la LibreOffice: opțiunea „paginile goale
  inserate automat”) — proba de hârtie pct. 7.
- **Laptopul proiectului** (D14): Windows 11 Pro, cont de operator fără drept de administrator, disc criptat, acces de la distanță pentru suport,
  Word / LibreOffice, Edge — presupus pregătit de suport înainte de F1b; cozile „AWB A5” și „Convocări A4 față-verso” le pune suportul (§8.6.5).
  Fișierele descărcate (date personale) rămân pe laptop; golirea dosarului de descărcări e o regulă de lucru, nu o funcție a platformei.
- **Imprimanta proiectului** (D12): laser monocrom A4, față-verso automat, două tăvi (A4 + A5), rezoluție presupusă ≥ 600 dpi; că tava A5 e
  aleasă automat de coada „AWB A5” (fără alimentare manuală) și că driverul nu rasterizează la rezoluție mică — proba de hârtie pct. 1 și 6.
- Că AWB-ul micșorat la ≈ 0,66–0,71 se citește prin folia buzunarului transparent (reflexii) și e acceptat de cititoarele curierului — se află
  doar la proba de hârtie și la ridicarea unui lot de TEST (pct. 3 și 8); că buzunarele de 17 × 22,5 cm vin de la curier (§15.2 pct. 8).
- Că fereastra de tipărire a Edge pe PDF-ul curierului păstrează proporția și o scară stabilă pe coada „AWB A5” (altfel F6).
- Pentru alternativa autocolantă (§8.6.4): rola de 100 × 150 mm (nu 105 × 148) și rezoluția imprimantei de etichete (203 / 300 dpi).
- Că o bibliotecă PDF care încorporează pagini (pdf-lib) rulează în funcția edge pe Deno fără probleme de dimensiune / timp — de probat în F6,
  doar dacă F6 e nevoie; altfel micșorarea pe A5 rămâne în fereastra de tipărire.
- Semnătura veche `fn_red_fan_anulat(uuid, text, text)` e chemată azi din DOUĂ locuri: funcția edge (`redariFanTransport.mjs`, după `DELETE /awb`)
  și ecranul owner-ului (`FanAwbPrevizualizare.jsx`, anularea după verificarea în contul curierului). Rămâne deci până sunt publicate AMÂNDOUĂ
  (funcția edge nouă și ecranul nou); retragerea ei e o migrare separată, după.
- Că `red_fan_awb.generat_la` / `ridicat_la` sunt `timestamptz` (ziua se derivă în ora României), iar `ridicat_propus` e `date` (verificat în
  20261212a: curierul dă ziua C0, ora C0 nu se păstrează); sărbătorile legale nu sunt cunoscute de `fn_red_zi_lucratoare_dupa` (excepțiile (a) /
  (b) pot apărea cu o zi mai devreme în jurul lor — spus în ecran).
- **Trecerea a patra**: că funcția edge `redari-fan-awb` poate construi un client `service_role` din `SUPABASE_SERVICE_ROLE_KEY` (Edge Secret
  standard, prezent în alte funcții ale proiectului) fără schimbare în workflow-ul de publicare — de verificat la F1; dacă nu, clasa B rămâne
  apelabilă DOAR prin funcția edge `redari-fan-urmarire` (care îl are prin design) sau printr-un secret propriu în Vault verificat în corp
  (`fn_verifica_secret`), niciodată prin EXECUTE `authenticated`. Că `transportPermis({ cereMarcaj:false })` din `redariFanHandler.mjs` rămâne
  cu semantica de azi (verificat pe `9f6fdada`). Că un marcaj de tranzacție (`set_config(…, true)`) pus de o funcție DEFINER e vizibil
  trigger-ului BEFORE din aceeași tranzacție și nu e setabil de un client PostgREST în afara unui RPC (nu există RPC care să-l expună) — probă
  PGlite + clonă. Că pe mediul real există rânduri `anulat` fără `anulat_la` (Testul 1) — preflight-ul le numără și le completează (L14).
  Că `red_fan_loturi.marcat_de` poate purta de acum un operator (marcajul automat, doar pe TEST); comentariul coloanei se actualizează.
- Că raportul de comenzi al curierului din API expune AWB-urile ridicate pe comandă (în aplicația web există); altfel legătura comandă ↔ AWB-uri
  rămâne pe punct + zi (§11).
