# Cautarea pe portaluri - ce merge, pe unde, in ce ordine

Cine deschide paginile: Claude, in sesiunea de pe serverul AI (regula 27.10.2026, vezi `decizii_echipa.md` 1b). Consultantii doar propun linkuri. Fara intrebare se deschid doar domeniile de mai jos; orice alt domeniu cere acordul lui Razvan.

Metoda a fost verificata in cercetarea 01.10-27.10.2026. Sursele: `surse_lipsa.md`, `CORPUS_CJ_PAGINI`, handoff-ul juridic. Daca o cale nu mai merge, noteaza in livrabil ce ai incercat si data. Nu inventa continut.

## 1. O decizie CNSC: de la subiect la citat cu pagina

1. **Intai corpusul intern**: `cnsc_practica.md` are 216 decizii verificate, cu problema, solutia, rationamentul, citate cu pagina, link si control judiciar. Cauti dupa tema: experienta similara, PNS, propunere tehnica, clarificari, ANRE, ajustare pret.
2. **Descoperire**: achizia.ro cu `https://achizia.ro/decizii?q=<termeni>`. Fisa deciziei e la `/acte-cnsc/<id>`. achizia.ro serveste DOAR la gasit decizia, nu la citat.
3. **Motor de cautare**, cu termeni exacti si "CNSC" + "BO2024" etc. Cautarea interna de pe portal.cnsc.ro NU merge automat (connection reset / 503). Din browser real merge.
4. **Textul integral**: PDF-ul de pe portal.cnsc.ro:
   - forma linkului: `http://portal.cnsc.ro/sivadoc/download.aspx?docUID=...&filename=...` (base64 in parametri);
   - merge pe **http://**, nu pe https;
   - citesti TOT PDF-ul, nu doar dispozitivul.
5. **Citarea**:
   - decizie cu numar: "Decizia CNSC nr. 2683/C1/2979 din 23.09.2024, p. 19 - <link>";
   - decizie anonimizata: "Decizia CNSC publicata in BO nr. BO2024_1870 (nr./data anonimizate), p. 13 - <link>".
   Pagina se ia din PDF, in formatul "p. N (din M)".
6. **Numarul real al unei decizii anonimizate**: din SEAP ("Decizie CNSC.pdf" atasat la anuntul procedurii) sau din registrul de dosare de pe portal.cnsc.ro.
7. **Controlul judiciar** (plangerea la Curtea de Apel):
   - pe portal.just.ro sau rejust.ro, cautare manuala dupa parti sau dupa numarul deciziei CNSC;
   - e aplicatie JavaScript, deci merge din browser real (PC/server), nu din cloud;
   - la deciziile anonimizate iti trebuie intai procedura din SEAP;
   - marchezi rezultatul: mentinuta / modificata / necunoscut, cu data verificarii.

## 2. Legislatia

- **legislatie.just.ro** e sursa oficiala gratuita a formelor consolidate. Din cloud da eroare HTTP/2; de pe PC-ul din birou si de pe serverul AI merge din browser.
- **lege5.ro "Gratuit"** are forma din Monitorul Oficial, nu forma la zi. A fost suficienta pentru OUG 64/2022, OG 15/2021 si Ord. ANRE 17/2026. Forma consolidata e contra cost.
- **ANAP** publica forme consolidate doar pana la 13.06.2024. Pentru modificarile ulterioare verifici actul modificator in MO.
- Unde lipseste forma la zi: citezi forma MO + actele modificatoare gasite si scrii explicit "forma consolidata la zi neverificata".
- **CJUE**: curia.europa.eu si EUR-Lex. Cauti dupa numarul cauzei, de ex. C-336/12, C-387/14, C-403/21.
- **Standardele ASRO** (SR EN): sunt protejate, deci citezi doar metadate si cerinte rezumate. Editia si pretul le iei de pe magazin.asro.ro/Search?q=, care cere browser/JS. Atentie la editiile anulate: SR EN 12732+A1:2014 e anulat, in vigoare e SR EN 12732:2021.

## 3. Alte surse si trucuri tehnice

| Sursa | Ce merge |
|---|---|
| anap.gov.ro (anti-bot) | Firecrawl cu `proxy: enhanced`, `waitFor: 10000`, `maxAge: 0`. Fara waitFor primesti pagina de verificare (503). Altfel, browser real |
| anre.ro, isc.gov.ro, igsu/cnsipc | acces direct |
| delgaz.ro, specificatii tehnice | 403 automat, deci browser |
| transgaz.ro | norme tehnice si caiete de sarcini, acces direct |
| SEAP (e-licitatie.ro) | raspunsurile la clarificari NU sunt in GetDfNoticeSectionFiles; documentele procedurii se descarca manual |
| NAS-ul firmei | dosarele reale (oferte, contestatii) le da Razvan |

## 4. Ce pastrezi pentru fiecare sursa folosita

Link, data accesarii, pagina, editia/forma (MO vs consolidata) si, daca ai salvat textul, sha256-ul. Ce n-ai putut citi integral se marcheaza **de verificat**, cu motivul: inaccesibil, contra cost, anonimizat.
