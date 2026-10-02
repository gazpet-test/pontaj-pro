# Harta furnizorilor pentru cererile de ofertă (RFQ): PROPUNERE de confirmat

**Stare:** propunere, nimic aplicat. Lucrul s-a făcut doar prin citire: `SELECT` pe BD (proiect `dxczwkbciseqniprspcu`) și căutări Gmail pe metadate. Nu s-a scris nimic în baza de date și nu s-a trimis niciun mail.
**Cerere:** Răzvan, 02.10.2026: „un agent să vadă furnizorii folosiți în licitațiile vechi și să mapeze câțiva, poate să ia și din modulul de Achiziții, că sunt deja mapați”.
**SQL-ul de aplicat** (doar preview, rulează în mod „dry-run”) este în [`RFQ_FURNIZORI_PROPUNERE.sql`](RFQ_FURNIZORI_PROPUNERE.sql).

## Pe scurt

- **40 de furnizori propuși**: 17 sunt deja în `logistica_furnizori`, iar 23 sunt noi și trebuie adăugați în master. Dintre cei noi, 18 au dovezi bune; 5 au încredere mică și sunt lăsați comentați în SQL.
- **105 perechi furnizor ↔ categorie**: 77 cu încredere mare sau medie (active în SQL) și 28 cu încredere mică (comentate).
- **Emailuri**: 14 sigure, 13 probabile, 3 slabe, 10 lipsă. În master există azi email doar la 2 din 36 de furnizori: Vastrum și Swiso.
- **Categoria Cămine nu are niciun furnizor solid.** Pentru cămine prefabricate și capace de fontă trebuie identificat un furnizor.
- **Numele migrării**: tabela `ofertare_furnizori_categorii` nu există încă. Prefixul `20261003b` anunțat pentru migrarea ei este deja folosit în repo de `supabase/migrations/20261003b_sec_ofertare_porti_alege_inventar.sql`, deci migrarea nouă are nevoie de alt nume.

| Categorie | Furnizori propuși | din care mare / medie (activi în SQL) | mică (comentați) |
|---|---|---|---|
| Conducte și montaj | 18 | 9 / 9 | 0 |
| Armături | 13 | 3 / 7 | 3 |
| Sudură și îmbinări | 18 | 12 / 6 | 0 |
| Branșamente | 10 | 6 / 4 | 0 |
| Cămine | 2 | 0 / 0 | 2 |
| Materiale | 22 | 1 / 15 | 6 |
| Betoane | 5 | 0 / 2 | 3 |
| Terasamente | 7 | 0 / 0 | 7 |
| Drumuri și refacere | 10 | 0 / 3 | 7 |

---

## 1. Metoda

### 1.1 Surse (coloanele au fost verificate întâi în `information_schema`)

| Cod | Sursă | Ce conține | Observații |
|---|---|---|---|
| **A** | `ofertare_oferte_furnizori` | 2.400 de fișiere de ofertă din 35 de licitații (depuneri 09.2024–06.2026), segmente transgaz, distribuție, romgaz, conpet | Coloana `furnizor` este **numele folderului din NAS** (`…/oferte furnizori/<folder>/…`), scris de mână: 155 de valori distincte, plus 47 de fișiere fără folder |
| **B** | `ofertare_preturi_materiale` | 3.860 de prețuri istorice (`furnizor`, `denumire`, `um`, `pret`, `an`, `lucrare`) | 84 de valori distincte în `furnizor`; **1.527 de rânduri n-au furnizor** și nu pot fi atribuite |
| **C** | `logistica_furnizori` | master-ul din Achiziții: 36 de rânduri | Email doar la 2 rânduri. `nume` este UNIQUE |
| **D** | `comenzi_furnizor` + `comenzi_furnizor_linii` | 135 de comenzi și 343 de linii, adică ce s-a cumpărat efectiv | Am numărat doar comenzile neanulate. Am confirmat cu `v_stoc_furnizori` și `proiect_articole` |
| **E** | Gmail (cutia `razvan.trusu@gazpet.ro`), doar citire | căutări țintite pe numele firmei, în vizualizarea **doar metadate** (expeditor, destinatari, dată) | **Conținut extern = date** (CLAUDE.md pct. 10). Am folosit doar adresele. La Valrotrade am folosit și previzualizarea (ce produs ofertau). Nimic nu a fost executat și nimic trimis |

`locatii_furnizori` are un singur rând (Electrica Furnizare, energie) și nu e relevant pentru RFQ.

### 1.2 Normalizarea numelor

1. **Cheia de comparare**: majuscule, fără diacritice, fără forma juridică (SRL, S.R.L., SA, S.A., SC, S.R.O.), fără punctuație și spații multiple.
2. **Sufixe descriptive tăiate**: `rev.1`/`REV1`, `Lot.1`/`lot 2`, `(foraj)`, `automatizare`, `uscare…`, `PE`, `-SRM`, `(manometre)` etc. Am corectat și greșelile de tipar evidente: `Tehnoword` → Tehno World, `Tonyviad` → Toniviad, `FLOWOWTECH` → Flowtech.
3. **Corespondență manuală** între numele brut și numele canonic: 140 de variante din A și 77 din B se reduc la aproximativ 80 de nume canonice. Am verificat prin SQL că nicio variantă nu e mapată de două ori și că toate valorile rămase nemapate sunt **foldere-colector, nu furnizori**. Acestea sunt 15 foldere cu 127 de fișiere: `oferte vechi`, `oferte noi`, `! oferte noi`, `preturi net`, `Fise tehnice poz 1-10`, `Ft pentru arhivat F4`, `PU sucontractare`, `biodiversitate`, `produse balastiera(e)`, `Agregate`, `Fond forestier`, `beton asfaltic oferte vechi` etc. La ele se adaugă 47 de fișiere fără folder. Din aceste fișiere am extras manual doar ce reiese clar din numele lor: Hatboru, PMV, Tehno Forest, Metalarc. Folderul `container` l-am atribuit Containex, pentru că are aceeași structură de fișiere.
4. **Legătura cu master-ul (C)** se face pe cheia normalizată. Acolo unde numele diferă, legătura e făcută pe **persoana de contact**: `IMD` ↔ `INDUSTRIAL M.D.TRADING SRL` (id 10), pentru că în master contactul e „Radu Ghita”, iar în mailuri apare `radu.ghita@imd.ro`.

### 1.3 Încadrarea pe categorii

- Folosesc **exact** cele 9 denumiri din `ofertare_cantitati.categorie`, ca harta să se lege 1:1 de cererile generate pe categorie.
- **Dovada deterministă**: am aplicat chiar funcția ERP `fn_categorie_cantitate(denumire)`, adică regulile din `ofertare_categorii_reguli` care clasifică liniile din listele de cantități, pe denumirile din prețurile istorice (B) și din liniile comenzilor (D). Un furnizor primește categoriile în care cad produsele lui. De exemplu, la Petrouzinex 176 de rânduri cad în „Sudură și îmbinări” și 25 în „Armături”.
- **Ce nu prind regulile** am completat după felul în care apar produsele în listele de cantități:
  - manșoanele și benzile de izolare a îmbinărilor merg la *Sudură și îmbinări* („izolarea îmbinărilor sudate”);
  - inelele distanțiere și burdufurile, care echipează tubul de protecție, merg la *Conducte și montaj* („montarea…”);
  - curbele, coturile, weldolet-urile și flanșele merg la *Sudură și îmbinări*, la fel ca regula `cot|flanș|teu|reducție`;
  - electrozii și sârma de sudură merg la *Sudură și îmbinări*;
  - prezoanele, piulițele și garniturile merg la *Materiale*, la fel ca `șurub|garnitur` din reguli;
  - contorul, regulatorul și firida merg la *Branșamente*;
  - vopselele și geotextilul merg la *Materiale*.
- **Agregatele** (nisip, balast, piatră spartă) apar în liste la *Materiale* ca resursă, la *Terasamente* (pat sau umplutură cu nisip) și la *Drumuri și refacere* (straturi de agregate). Pentru balastiere propun *Materiale* ca categorie principală, iar celelalte două cu încredere mică.
- **Betoane**: în listele de cantități, „Betoane” înseamnă *turnare beton* (lucrarea), dar la RFQ se cere beton marfă. Furnizorii de beton primesc *Betoane* și, unde e cazul, *Materiale*.
- **Terasamente / Drumuri și refacere** sunt lucrări. Am pus aici doar furnizori de agregate și 2 subantreprenori de drumuri (Apazol, Sorchiv).
- **Echipamentele și serviciile** (SRM, automatizare, foraj FOD/FOP, uscare, containere, PSI, topografie, mediu) nu intră în cele 9 categorii. Sunt listate separat la §4.2.

### 1.4 Relevanța (ordinea din tabel)

`scor = 3 × licitații distincte cu ofertă (A) + comenzi neanulate în Achiziții (D, maximum 10) + 2 dacă are activitate în 2026 + 1 dacă are prețuri istorice (B) + 1 dacă e deja în master (C)`

### 1.5 Încrederea

- **Categorie**:
  - **mare** = cel puțin 2 surse independente (oferte în mai multe licitații plus prețuri sau comenzi) și identitate clară;
  - **medie** = o sursă solidă: ofertă cu cel puțin 5 poziții de preț, oferte în cel puțin 2 licitații sau 1–4 comenzi;
  - **mică** = o singură mențiune sau identitate neclară.
- **Email**:
  - **sigur** = adresă de rol a firmei (office@, contact@, ofertare@, marketing@, desfacere@) care apare ca expeditor de oferte sau în CC-ul răspunsurilor firmei, ori adresă deja trecută în master;
  - **probabil** = adresă la care Gazpet a trimis cereri, după care au venit oferte, sau adresă nominală a agentului care coincide cu persoana din master;
  - **slab** = adresă yahoo sau gmail văzută doar în cereri vechi.

---

## 2. Tabelul principal (40 de furnizori, în ordinea relevanței)

„id LF” = `logistica_furnizori.id`. „nou” = furnizorul lipsește din master; e propus în SQL (a).

| # | Furnizor (normalizat) | id LF | Categorii propuse (încredere) | Dovadă (exemple) | Email · sursa | Încredere |
|---|---|---|---|---|---|---|
| 1 | **KITMETAL** | 5 | Sudură și îmbinări (mare) · Conducte și montaj (mare) · Materiale (medie) | 23 de licitații 09.2024–05.2026 (ex. 177 Interconectare Podișor, 174 Inel București, 171 Rădăuți–Vicovu, 30 Sonda 16 Mironu); 202 prețuri; 28 de comenzi (ultima 02.10.2026). Produse: manșoane Covalence, benzi Polyken 942/955, inele distanțiere, burdufuri de etanșare, MIJ (îmbinare electroizolantă), weldolet | `contact@kitmetal.ro` · Gmail, trimite ofertele (ultima 27.07.2026) · **sigur** | mare |
| 2 | **PETROUZINEX** | 12 | Sudură și îmbinări (mare) · Armături (mare) · Conducte și montaj (medie) · Materiale (medie) | 10 licitații 12.2024–06.2026 (180 Tuzla–Podișor, 177, 176 SRM Craiova, 30, 53); 320 de prețuri: coturi/curbe EN 10253, flanșe, capace, teuri; robineți sferă/ventil/clapetă („oferta robineti 46653”); „oferta teava 46589”; 2 comenzi (garnituri spirometalice, robineți DN50 PN100) | `marketing@petrouzinex.ro` (CC `bucuresti@`, `office@petrouzinex.ro`) · Gmail, trimite ofertele (07.2026) · **sigur** | mare |
| 3 | **TERAPLAST** | 19 | Conducte și montaj (mare) · Sudură și îmbinări (mare) · Branșamente (mare) · Armături (medie) · Materiale (medie) · Cămine (mică) | 9 licitații 11.2024–06.2026 (52 Cristian, 48 Cazasu, 43 Sutești, 40 Hoghilag, 176); 45 de prețuri; 2 comenzi cu 26 de linii (țeavă PE100 D32–D315, fitinguri GF E+, teu branșament, robineți PE, folie avertizare, fir detector); piesă de trecere PE/OL D400 | `office@teraplast.ro` (agent `marius.florea@teraplast.ro`) · Gmail, trimite oferte (17.09.2026) · **sigur** | mare |
| 4 | **IZOCOND TECH** (în master: „Izocond”) | 23 | Conducte și montaj (mare) · Drumuri și refacere (medie) · Betoane (medie) · Materiale (medie) | 8 licitații 05.2025–06.2026 (173 Isaccea–Șendreni, 174, 171, 167, 168, 159, 151): ofertă „PM”, adică izolație de protecție mecanică cu rășină și fibră de sticlă pentru conducte trase prin foraj; lic. 40 Hoghilag: asfalt, agregate, beton C25/30 | `office@izocond.ro` · Gmail (24.04.2026); contact `dragos.burdea@izocond.ro`, aceeași persoană ca în master · **sigur** | mare |
| 5 | **VALROM INDUSTRIE** | 32 | Conducte și montaj (mare) · Sudură și îmbinări (mare) · Branșamente (mare) · Armături (medie) · Cămine (mică) | 6 licitații 02–05.2026 (52, 48, 43, 40, 38, 176); 30 de prețuri (țeavă VALGasio PE100, coturi/teuri/reducții, teu de branșament orientabil, vane cu tijă); 1 comandă 09.2026 cu 23 de linii, inclusiv o cutie PEHD pentru vană de gaz | `office@valrom.ro` · Gmail: cereri Gazpet 26.01 și 05.05.2026; răspunde `elena.trifanescu@valrom.ro` cu office@ în CC; `marius.ghiteanu@valrom.ro` este persoana din master · **sigur** | mare |
| 6 | **IMD** = INDUSTRIAL M.D.TRADING SRL | 10 | Armături (mare) · Sudură și îmbinări (medie) · Conducte și montaj (medie) | 5 licitații 09.2024–06.2026 (135, 145, 167, 177, 180); oferte de robineți din 10.01.2025 și 08.04.2026; 33 de prețuri (robineți API 6D cu sferă/cep, curbe DN500/DN800, benzi de închidere manșon, burdufuri) | `radu.ghita@imd.ro`, persoana din master; ofertele vin și de la `mihaela.pinzaru@imd.ro` (24.09.2026) · **probabil** | mare (identitatea IMD ↔ id 10 e de confirmat cu CUI 8270719) |
| 7 | **SEVLAR** | 3 | Sudură și îmbinări (mare) · Materiale (mare) | 14 comenzi cu 30 de linii: flanșe, weldolet DN150/DN200, reducții RCS, capace bombate, prezoane/piulițe 42CrMo4, inele R31; lic. 30 Mironu (fișe tehnice pentru teuri, curbe, weldolet, flanșe) și 167 | `ofertare@sevlar.ro` · Gmail, răspunde cu oferte (2023–10.2025) · **sigur** | mare |
| 8 | **SAMI PLASTIC SA** | nou | Conducte și montaj (mare) · Sudură și îmbinări (mare) · Branșamente (mare) · Armături (medie) · Materiale (medie) | 5 licitații 02–05.2026 (40, 43, 48, 52, 176); 54 de prețuri (țeavă PE100 SDR11, coturi/mufe EF, teu de branșament GASKIT, riser, robineți); 21 de rânduri în `proiect_articole` | `marketingsud@samiplastic.ro` (CC `comercial@samiplastic.ro`) · Gmail, trimite ofertele (03–07.2026) · **sigur** | mare |
| 9 | **TEHNO WORLD** | nou | Conducte și montaj (mare) · Sudură și îmbinări (mare) · Branșamente (mare) · Armături (medie) · Materiale (mică) | 5 licitații 02–05.2026 (38, 43, 48, 52, 176); 41 de prețuri (țeavă PE100, coturi/dopuri/mufe EF, teu de branșament GAZSTOP, cap de branșament, firidă, robineți PE) | `office@tehnoworld.ro` · Gmail: cereri Gazpet 10.03 și 05.05.2026; oferta din 08.05.2026 a venit de la `razvan.acasandrei@tehnoworld.ro` · **probabil** | mare |
| 10 | **INDUSTRIAL FLUID SRL** | nou | Conducte și montaj (mare) | 5 licitații 09.2024–02.2026 (135, 145, 148, 152, 171); 8 prețuri: inele distanțiere cu role, burdufuri de închidere conice pentru tubul de protecție | `office@ifluid.ro` · Gmail, trimite oferte (03–05.2025) · **sigur** | mare |
| 11 | **APAZOL** (subantreprenor) | nou | Drumuri și refacere (medie) · Betoane (mică) · Terasamente (mică) | 4 licitații 11.2024–05.2025 (28, 48, 146, 148), plus contracte de subantrepriză în dosarele 40 și 43; 249 de prețuri, un deviz complet: beton asfaltic, borduri, betoane C8/10–C25/30, oțel-beton | `office@apazol.ro` · Gmail (07–08.2026) · **sigur** | medie (e subantreprenor, nu furnizor de materiale) |
| 12 | **UPRUC CTR** | nou | Sudură și îmbinări (medie) | 4 licitații (135, 48, 146, 30). Folderul „Upruc-fitinguri” are oferte de tip PQ…FT (05.2026) | `ciprian.fratila@uprucctr.com` · Gmail (08–09.2026) · **probabil** | medie |
| 13 | **VALROTRADE** | nou | Conducte și montaj (medie) | 4 licitații (48, 38, 176, 30) cu oferte „GAZPET <dată>.pdf”; mail din 08.12.2025: țeavă izolată și neizolată din stoc, comandă confirmată pe 15.12.2025 | `desfacere@valrotrade.ro` (Departament Vânzări) · Gmail, trimite oferte (12.2025, 02.2026) · **sigur** | medie (gama de produse e de confirmat) |
| 14 | **VASTRUM TRANSCOM** | 4 | Sudură și îmbinări (mare) · Materiale (medie) | 11 comenzi în 2026, cu 26 de linii: flanșe cu gât și flanșe oarbe EN 1092-1, coturi ANSI B16.9/B16.11, coupling, niplu, prezoane/piulițe | `comercial@vastrum.ro` · deja în master; Gmail: cerere Gazpet 14.05.2026 · **sigur** | mare |
| 15 | **MEDA CONSTRUCT** | 25 | Sudură și îmbinări (mare) · Branșamente (mare) · Conducte și montaj (medie) · Materiale (medie) | 9 comenzi neanulate în 2026: mufe/teuri/reducții EF D32–D315, teu de branșament stop gaz, capăt de branșament, răsuflători, țeavă PE, tub de protecție PVC, bandă de avertizare | `bogdanalexandru@meda.com.ro` · Gmail (09.2026, schimb cu Achizițiile) · **probabil** | medie |
| 16 | **TONIVIAD** | nou | Conducte și montaj (mare) · Sudură și îmbinări (mare) · Branșamente (medie) · Armături (medie) · Materiale (mică) | 3 licitații 02–05.2026 (40, 176, 52); 24 de prețuri (țeavă PE100 D32–D400, curbe/reducții/mufe EF D400, fiting de tranziție PE-OL, riser, teu de branșament, robineți PEHD) | `office@toniviad.ro` · Gmail: cereri Gazpet 10.03 și 05.05.2026, după care au venit oferte pentru 176 și 52 · **probabil** | mare |
| 17 | **SIGSERV** | nou | Sudură și îmbinări (medie) · Conducte și montaj (medie) · Materiale (mică) | 3 licitații (146: fișe pentru inele, burdufuri, manșoane; 167 și 168: ofertă „la cererea de ofertă” din 2026); 180 de prețuri (benzi anticorozive, manșoane termocontractabile Canusa, țeavă OL) | `sig.serv_group@yahoo.com` · Gmail, doar cereri Gazpet din 2023–2024 · **slab** | medie |
| 18 | **AQUA COLOR** | nou | Materiale (medie) | 3 licitații 09.2025–06.2026 (165, 177, 173); 6 prețuri: vopsele Interseal 670HS și Interthane 990, plus aplicare | `office@aquacolor.ro` · Gmail, trimite oferte (2023–2024) · **sigur** | medie |
| 19 | **ALL INSTAL** | 21 | Branșamente (mare) · Sudură și îmbinări (mare) · Conducte și montaj (medie) · Armături (medie) · Materiale (medie) | 2 licitații 2026 (40, 52), plus ofertă în dosarul 16 Habau; 41 de prețuri (firide, teu de branșament EF, riser, fitinguri EF, țeavă PE100, robineți PEHD); 4 comenzi, din care 2 anulate | `licitatii@all-instal.ro` (alternativ `vanzari3@all-instal.ro`) · Gmail: cereri Gazpet 2025–2026 · **probabil** | mare |
| 20 | **SINTAX** | 1 | Conducte și montaj (mare) · Sudură și îmbinări (medie) | 6 comenzi în 2026: țeavă L360 izolată cu PEHD, Ø508×7,1 și Ø711×10, curbe SAWL/SMLS, reducții, capace bombate; lic. 30: specificații pentru țeavă SMLS izolată | **lipsă**: nu l-am găsit în Gmail; contactul din master e Gigi Kent, 0726747808 | mare |
| 21 | **METALARC INDUSTRIAL GAZ** | 6 | Sudură și îmbinări (mare) · Materiale (medie) | 9 comenzi neanulate cu 52 de linii: electrozi ESAB OK 55, Bohler EV Pipe, wolfram, discuri; factura Metalarc pentru sârmă și electrozi (09.2025) în dosarul 176 | `office@metalarc.ro` · Gmail (07.2025–08.2026) · **sigur** | mare |
| 22 | **ROMVALVES** | nou | Armături (mare) | 2 licitații în 2026 (177, cu oferta nr. 01.04_26; 180); 8 prețuri: robineți cu sferă API6D DBB trunnion, cep echilibrat MTM | `romvalves@romvalves.ro` · Gmail: cerere Gazpet din 24.03.2026 (în dosarul 177 există oferta nr. 01.04_26) · **probabil** | mare |
| 23 | **COLIAL** | nou | Materiale (medie) · Terasamente (mică) · Drumuri și refacere (mică) | 2 licitații (168, 176); 5 prețuri: balast, sorturi 0-4/4-8/8-16, piatră spartă 40-63 | **lipsă** | medie |
| 24 | **ARMAX** (SRL; manometre) | nou | Armături (mică) | lic. 146 și 167 (manometre, traductor APC-2000, robinet cu sferă cod 799), plus oferte în dosarele 145 și 177; 8 prețuri | `armaxsrl@yahoo.com` · cerere Gazpet din 2024 · **slab** | mică: **nu e același lucru cu ARMAX GAZ** (`sales@armaxgaz.ro`, coș gaze și SRMP) |
| 25 | **TIMOREX** | nou | Armături (medie) | 2 licitații în 2026 (30: fișe pentru robineți ROS/RRC/RSP/RVD; 180) | `sctimoreximpex@yahoo.com` · Gmail: cerere Gazpet din 21.04.2026 · **probabil** | medie |
| 26 | **FERBAT SERV** | nou | Sudură și îmbinări (medie) · Materiale (medie) | lic. 30 (oferta 1686 din 30.04.2026): 61 de prețuri pentru teuri/reducții P285NH/P355NL1, flanșe RTJ, garnituri plane | `office@ferbatserv.ro` · Gmail: cereri Gazpet din 02.2026 · **probabil** | medie |
| 27 | **ADREMAT** | nou | Betoane (medie) · Materiale (medie) · Terasamente (mică) · Drumuri și refacere (mică) | lic. 168 (01.2026): 12 prețuri pentru beton C20/25 și C25/30, pompare, balast 0-63 „pentru terasamente”, piatră spartă, nisip | **lipsă** | medie |
| 28 | **ROMCIM** | nou | Betoane (mică) | lic. 168 (01.2026): beton C20/25 și C25/30, plus transport | **lipsă** | mică |
| 29 | **SORCHIV** (subantreprenor de drumuri) | nou | Drumuri și refacere (medie) | lic. 176 (03.2026): deviz de refacere drumuri (F3, C6–C8) cu bitum, emulsie, asfalt turnat, filer; 27 de prețuri | `cms_sorchiv.gaz@yahoo.com` · Gmail: Gazpet i-a scris în 07.2026 · **slab** | medie |
| 30 | **KHINEZU** (în NAS: „Kinezu”) | nou | Materiale (mică) · Terasamente (mică) · Drumuri și refacere (mică) | lic. 30 (05.2026): balast, nisip, pietriș, piatră spartă (5 prețuri) | **lipsă** | mică |
| 31 | **KOROLIS** | nou | Betoane (mică) · Materiale (mică) · Terasamente (mică) · Drumuri și refacere (mică) | lic. 48 Cazasu (04.2026): ofertă „beton + agregat”, fără prețuri extrase | **lipsă** | mică |
| 32 | **NORD GAZ DISTRIBUȚIE** | 22 | Branșamente (medie) | lic. 146 (03.2025): ofertă pentru contor G10 și regulator Fiorentini (7 fișiere); o comandă din 2026, anulată: firidă echipată cu post de măsură și regulator | `nordgazdistributie@gmail.com` · Gmail, adresa de pe care trimite firma (2024–2026) · **sigur** | medie |
| 33 | **HOMPLEX** | 26 | Branșamente (medie) · Armături (mică) · Materiale (mică) | 5 prețuri din 2024: firide compozit/metal echipate cu regulator, contor smart AMR2407; documente în dosarul 21 Finta; o comandă 09.2026: robinet cu bilă gaz, bandă de avertizare | `marketing@homplex.ro` · Gmail (2025); la cererea din 2024 a răspuns `catalin.vlaicu@homplex.ro` · **probabil** | medie |
| 34 | **WINTER COM** | 31 | Branșamente (medie) · Sudură și îmbinări (medie) · Armături (mică) | 2 comenzi 09.2026: teu de branșament MB D90-32, reducție EF D63-32, robinet GF PE100 | `nicolae.avram@wintercom.ro`, persoana din master (plus `depozit.bucuresti@wintercom.ro`) · Gmail (09.2026) · **probabil** | medie |
| 35 | **SENAL-COM** | 14 | Conducte și montaj (medie) | 2 comenzi 09.2026: țeavă laminată la cald 60,3×10 și țeavă OL 1" | **lipsă**: în Gmail apare doar `certificate@senal.ro`, adresa de certificate | medie |
| 36 | **PALPLAST** | 30 | Conducte și montaj (medie) | o comandă 09.2026: țeavă de gaz PE100 D32–D140 | `daniel.dita@palplast.ro`, persoana din master · Gmail (07–09.2026) · **probabil** | medie |
| 37 | **BALASTIERA CĂRBEȘTI** | nou | Materiale (medie) · Terasamente (mică) · Drumuri și refacere (mică) | lic. 146 (03.2025): balast, nisip 0-4, sorturi, piatră spartă (6 prețuri) | **lipsă** | medie |
| 38 | **PMV** | nou | Materiale (medie) · Terasamente (mică) · Drumuri și refacere (mică) | lic. 135 (09.2024), plus o ofertă de agregate în dosarul 164; 5 prețuri pentru balast, nisip, pietriș, bolovani | **lipsă** | medie |
| 39 | **HATBORU RO** | nou | Conducte și montaj (medie) | lic. 135: oferta HBRO24-034 pentru țeavă DN500 și confirmarea comenzii din 19.03.2025; oferte noi pe mail în 03–06.2026, deci e mai relevant decât arată scorul | `leonardo.stanescu@hatboru.ro` · Gmail (05.2026) · **probabil** | medie |
| 40 | **CITADIN PREST SA** | nou | Drumuri și refacere (mică) | un preț („mixturi asfaltice cu bitum”) și un rând în `proiect_articole` | **lipsă** | mică |

**Rezervă** (dovezi prea slabe pentru tabel, dar posibil utile): INOVECO (geotextil, lic. 146); ETANSARI GRAFEX (id 35, garnitură spirometalică); GEOCONS TRADING (id 20, geomembrană HDPE); ROMPOLIMER (id 36, rășină și țesătură din fibră de sticlă); ADOXI (beton și nisip, `proiect_articole`); MINERALPORT (balast; în Gmail doar `facturare@mineralport.ro`); READYMIX (agregate Codlea); DACOREX (balastieră, lic. 146); RI PROTECTIVE SOLUTIONS (vopsele 2K, lic. 165); AGREGATE RUSU (id 2, fără nicio comandă); TEHNO FOREST (agregate și beton, dosarul 30).

---

## 3. Harta pe categorii (ce primește fiecare RFQ)

Pentru transport și distribuție am separat furnizorii de **OL** (oțel; transport: Transgaz, Romgaz, Conpet) de cei de **PE** (polietilenă; distribuție). La generarea RFQ-ului se filtrează după segmentul licitației.

**Conducte și montaj (18)**
- PE (distribuție): TERAPLAST (mare), VALROM (mare), SAMI PLASTIC (mare), TEHNO WORLD (mare), TONIVIAD (mare), ALL INSTAL (medie), MEDA CONSTRUCT (medie), PALPLAST (medie).
- OL (transport): SINTAX (mare), VALROTRADE (medie), HATBORU RO (medie), SENAL-COM (medie), PETROUZINEX (medie: curbe, țeavă de protecție), SIGSERV (medie).
- Accesorii pentru tubul de protecție și izolație: KITMETAL (mare), INDUSTRIAL FLUID (mare), IZOCOND (mare: protecție mecanică), IMD (medie).

**Armături (13)**
- OL / API 6D (transport): IMD (mare), ROMVALVES (mare), PETROUZINEX (mare), TIMOREX (medie).
- PE (distribuție): TERAPLAST, VALROM, SAMI PLASTIC, TEHNO WORLD, TONIVIAD, ALL INSTAL (toți medie).
- Încredere mică: ARMAX (robineți DN15, manometre), HOMPLEX, WINTER COM.

**Sudură și îmbinări (18)**
- Fitinguri și flanșe OL: PETROUZINEX (mare), SEVLAR (mare), VASTRUM (mare), FERBAT SERV (medie), UPRUC CTR (medie), SINTAX (medie).
- Izolarea îmbinărilor: KITMETAL (mare), SIGSERV (medie), IMD (medie).
- Consumabile de sudură: METALARC (mare).
- Fitinguri PE electrosudabile: TERAPLAST, VALROM, SAMI PLASTIC, TEHNO WORLD, TONIVIAD, ALL INSTAL, MEDA CONSTRUCT (toți mare), WINTER COM (medie).

**Branșamente (10)**: TERAPLAST, VALROM, SAMI PLASTIC, TEHNO WORLD, MEDA CONSTRUCT, ALL INSTAL (mare); TONIVIAD, NORD GAZ (contor + regulator), HOMPLEX (firide, contoare smart), WINTER COM (medie).

**Cămine (2)**: VALROM (cutii de protecție pentru vane) și TERAPLAST (piesă de trecere PE/OL), ambii cu încredere mică. **Golul de acoperit**: nu există niciun furnizor de cămine prefabricate sau capace de fontă. Cutiile de fontă apar în prețurile istorice ale lic. 43 și 48 fără furnizor.

**Materiale (22)**
- Prezoane și garnituri: SEVLAR (mare), VASTRUM, PETROUZINEX, FERBAT SERV (medie).
- Agregate: COLIAL, ADREMAT, BALASTIERA CĂRBEȘTI, PMV, IZOCOND (medie); KHINEZU, KOROLIS (mică).
- Benzi și mastic: KITMETAL (medie), SIGSERV (mică).
- Vopsele: AQUA COLOR (medie).
- Bandă de avertizare și fir trasor: TERAPLAST, SAMI PLASTIC, ALL INSTAL, MEDA CONSTRUCT (medie); TEHNO WORLD, TONIVIAD, HOMPLEX (mică).
- Consumabile: METALARC (medie).

**Betoane (5)**: IZOCOND, ADREMAT (medie); ROMCIM, KOROLIS, APAZOL (mică).

**Terasamente (7, toți cu încredere mică)**: APAZOL (subantreprenor) și furnizorii de agregate COLIAL, ADREMAT, BALASTIERA CĂRBEȘTI, PMV, KHINEZU, KOROLIS.

**Drumuri și refacere (10)**: IZOCOND, APAZOL, SORCHIV (medie); CITADIN PREST și agregatele COLIAL, ADREMAT, BALASTIERA CĂRBEȘTI, PMV, KHINEZU, KOROLIS (mică).

---

## 4. Furnizori din ofertele vechi care NU sunt în `logistica_furnizori`

### 4.1 Furnizori de materiale propuși pentru master (SQL secțiunea a)

Achizițiile îi pot folosi imediat. Am propus numele fără diacritice, cu forma juridică doar acolo unde apare în documente.

| Nume propus în master | Email propus | Recomandare |
|---|---|---|
| SAMI PLASTIC SA | marketingsud@samiplastic.ro (sigur) | (a1) activ |
| TEHNO WORLD | office@tehnoworld.ro (probabil) | (a1) activ |
| INDUSTRIAL FLUID SRL | office@ifluid.ro (sigur) | (a1) activ |
| TONIVIAD | office@toniviad.ro (probabil) | (a1) activ |
| ROMVALVES | romvalves@romvalves.ro (probabil) | (a1) activ |
| TIMOREX | sctimoreximpex@yahoo.com (probabil) | (a1) activ (denumirea legală e de confirmat, poate „Timorex Impex”) |
| UPRUC CTR | ciprian.fratila@uprucctr.com (probabil) | (a1) activ |
| VALROTRADE | desfacere@valrotrade.ro (sigur) | (a1) activ |
| FERBAT SERV | office@ferbatserv.ro (probabil) | (a1) activ |
| AQUA COLOR | office@aquacolor.ro (sigur) | (a1) activ |
| SIGSERV | — (`sig.serv_group@yahoo.com` e prea vechi; e notat în comentariu) | (a1) activ (denumirea legală e de confirmat, poate „Sig Serv Group”) |
| HATBORU RO | leonardo.stanescu@hatboru.ro (probabil) | (a1) activ |
| APAZOL | office@apazol.ro (sigur) | (a1) activ (e subantreprenor; vezi §6) |
| COLIAL | — | (a1) activ |
| ADREMAT | — | (a1) activ |
| SORCHIV | — (`cms_sorchiv.gaz@yahoo.com`, slab, e notat în comentariu) | (a1) activ (posibil „CMS Sorchiv Gaz”) |
| BALASTIERA CARBESTI | — | (a1) activ |
| PMV | — | (a1) activ |
| ARMAX | — (`armaxsrl@yahoo.com`, slab) | (a2) comentat: încredere mică și identitate de lămurit |
| ROMCIM | — | (a2) comentat |
| KHINEZU | — | (a2) comentat |
| KOROLIS | — | (a2) comentat |
| CITADIN PREST SA | — | (a2) comentat |

### 4.2 Servicii și echipamente (nu intră în hartă; decideți dacă îi trecem în master)

Toate lipsesc din `logistica_furnizori`, deși unele apar des:
- **Foraj FOD/FOP (subtraversări):** **CFI** (11 licitații, cel mai frecvent după Kitmetal), SUBTRANSCON (3), REVIVO (3);
- **SRM, automatizare, măsură:** VECTORGAZ (4), FLOWTECH (4), ATSD (3), HASEL INDUSTRIAL (2), SMARTECH (2), EMERSON, APLISENS, BAT, ARMAX GAZ (coș gaze, SRMP), CONFIND (habă, coș gaze);
- **Uscarea conductelor:** ATLAS COPCO (3), TACROM (3), ROMPETROL (3);
- **Containere:** CONTAINEX (3), PALMEX;
- **Altele:**
  - OPTIMATIC (atestare Ex/INSEMEX, 4);
  - racord LEA: ALMARGRUP, BASI PRODCOM;
  - fibră optică: GAUSS;
  - montaj conductă: DS1;
  - mediu: EUROCOGEN, USI;
  - plantare: DA BACCO;
  - topografie: TOPO;
  - protecție catodică: EXPCORO, ENERGOPLAY;
  - utilaje: MATECO, UTILBEN;
  - PSI: RONPS;
  - pompe: AXFLOW, SIMOTIL;
  - TOTAL GAZ, ROMSTAL;
  - instalații electrice și de securitate (oferte lic. 174): ACTEMIUM, MOLDOTECH, RASIROM, ROCONSULT.
- **COMESAD** apare cu 105 prețuri, dar este partener de asociere (lider), nu furnizor.

---

## 5. Dubluri și variante de nume găsite

**În ofertele vechi (A) și în prețuri (B)**, aceeași firmă apare sub mai multe nume:

| Firmă | Variante găsite |
|---|---|
| KITMETAL | `kitmetal`, `Kitmetal`, `kitmetal rev.1`, `KITMETAL REV1` |
| PETROUZINEX | `petrouzinex`, `Petrouzinex`, `PETROUZINEX` (plus fișierul `petrouzinex.pdf`, care nu e în niciun folder) |
| TERAPLAST | `Teraplast`, `teraplast`, `oferta Teraplast` |
| VALROM | `Valrom`, `valrom`, `Valrom PE`; în master `Valrom Industrie SRL` |
| SAMI PLASTIC | `Sami`, `sami`, `Samiplast`, `Samiplastic PE`, `Sami Plastic SA` |
| TEHNO WORLD | `Tehnoworld`, `tehnoworld`, `Tehnoword primit pe 18.03.dupa depunere` (greșeală de tipar), `oferta Tehnoword.pdf` |
| TONIVIAD | `Toniviad`, `toniviad`, `Tonyviad PE` |
| IMD | `IMD`, `imd`, `Lot.1 IMD`, `Lot.2 IMD`, `IMD (Lot 1/2)`; în master **`INDUSTRIAL M.D.TRADING SRL`** |
| IZOCOND | `izocond`, `Izocond`, `Izocond asfalt_agregate`, `Izocond Tech`, `IZOCOND TECH SRL` (în fișiere); în master `Izocond` |
| ARMAX | `armax`, `Armax SRL -manometre si traductor`, `Armax (manometre)` sunt o firmă; `armax gaz`, `Armax gaz - SRM`, `Armax Gaz (coș gaze)` sunt **probabil o altă firmă** |
| KHINEZU | `Kinezu-nisip,pietris,piatra` (NAS) și `Khinezu (beton)` (prețuri); ortografia e de confirmat |
| FLOWTECH | `Flowtech`, `FLOWOWTECH automatizare`, `Flowtech automatizare`, `Flowtech-SRM` |
| VECTORGAZ | `SRMP VECTORGAZ`, `VECTORGAZ`, `Vectorgaz-SRM`, `Vectorgaz`, `Vectorgaz (SRMP)` |
| CFI | `CFI`, `cfi`, `CFI lot 1`, `CFI lot 2`, `CFI foraj`, `asociat CFI`, `CFI (FOD)` |

Alte grupuri:
- `SUBTRANSCON`, `CONFIND`, `ROMPETROL`, `TACROM`, `ATLAS COPCO`, `ATSD`, `OPTIMATIC`, `CONTAINEX` (inclusiv folderul `container`): variante de majuscule și sufixe descriptive.
- `produse balastiera` și `produse balastiere`: același folder-colector, nu un furnizor.

**În master (`logistica_furnizori`)**:
- **Pseudo-furnizori:** `FAZA OFERTARE` (id 16, 2 comenzi anulate de servicii) și `TEST` (id 18, cu o comandă de test rămasă în stare `in_stoc`). Sunt de curățat, dar doar cu confirmare: au comenzi legate (FK `ON DELETE SET NULL`).
- **Formate inconsistente:** `SRL`, `S.R.L`, `SRL.` (`METATOOLS SRL.`), `SC SABLAST SRL`, `SENAL - COM SRL`.
- **CUI-uri neuniforme:** `RO23406840,` (cu virgulă), `RO 289666554` (cu spațiu), cu sau fără prefixul RO.
- **Câmpul `contact`** amestecă numele cu telefonul, iar `persoana_contact` și `telefon` sunt goale la 34 din 36 de rânduri.

**Între surse**:
- `FLEXON ALL SRL` (master) = `FLEXON-ALL SRL` (`productie_facturi`) = „Flexon-ALL” (în denumirea unei poziții AxFlow).
- `MEDA CONSTRUCT` (`meda.com.ro`) ≠ Meda Consulting (`medaconsulting.ro`), care apare și el în inbox.
- Tehno World ≠ Tehno Forest.
- Horia Enciu apare cu adrese pe **`imd.ro` și pe `hatboru.ro`**. Poate exista o legătură între IMD și Hatboru; e de verificat înainte să trimitem RFQ „concurențial” la amândoi.

---

## 6. Ce n-am putut stabili

1. **Emailuri lipsă (10)**: SINTAX, COLIAL, ADREMAT, ROMCIM, KHINEZU, KOROLIS, SENAL-COM, BALASTIERA CĂRBEȘTI, CITADIN PREST, PMV. Am căutat în Gmail pe numele firmei și n-am găsit nicio adresă folosită de ei. 13 adrese sunt doar **probabile** (nominale sau neconfirmate ca expeditor) și 3 sunt **slabe** (yahoo, cereri vechi).
2. **Identități de confirmat (după CUI)**:
   - IMD = INDUSTRIAL M.D.TRADING SRL (CUI 8270719 din master);
   - ARMAX SRL vs ARMAX GAZ;
   - Timorex vs „Timorex Impex”;
   - Sigserv vs „Sig Serv Group”;
   - Sorchiv vs „CMS Sorchiv Gaz”;
   - Kinezu vs Khinezu;
   - forma juridică la Tehno World, Toniviad, Colial, Adremat, Romcim.
3. **Valrotrade**: din datele noastre reiese doar „țeavă izolată/neizolată” (mail 12.2025). Gama exactă nu e în BD.
4. **Categoria Cămine** nu are niciun furnizor cu dovezi solide.
5. **Date neatribuibile**: 1.527 de prețuri istorice fără furnizor (11 lucrări) și 47 de fișiere NAS fără folder, plus 127 în foldere-colector. Le-am putea atribui doar citind PDF-urile, cu AI. Asta e procesare plătită, deci trece prin poarta pe cheltuială și n-am făcut-o.
6. **Schema `ofertare_furnizori_categorii`** nu există încă. Am presupus coloanele din cerere (`furnizor_id`, `categorie`, `sursa`, `note`) și **nu știu** dacă vor exista un CHECK pe `sursa`, o cheie unică `(furnizor_id, categorie)` sau o coloană `id`. SQL-ul e scris să meargă în toate cazurile: verifică prin `NOT EXISTS` și întoarce `RETURNING furnizor_id, categorie`.
7. **Apazol și Sorchiv** sunt subantreprenori de drumuri, nu furnizori de materiale. Trebuie decis dacă intră în `logistica_furnizori` sau doar în contractele de subcontractare.
8. **Relevanța Hatboru** e subestimată de scor: BD-ul are o singură licitație, dar inboxul arată oferte noi în 2026.

---

## 7. Cum se aplică (doar după confirmarea lui Răzvan)

Fișierul [`RFQ_FURNIZORI_PROPUNERE.sql`](RFQ_FURNIZORI_PROPUNERE.sql) urmează tiparul din CLAUDE.md pct. 3 (preview → confirmare → apply → verificare).

1. **(0)** Verifică că tabela `ofertare_furnizori_categorii` există, după migrarea ei, care **are nevoie de alt prefix decât `20261003b`**.
2. **(a)** Fiecare instrucțiune are la început `params.aplica = false`. Așa rulată, nu scrie nimic: arată ce ar insera, ce există deja și ce nume seamănă cu cele existente. Se trece pe `true` doar după confirmare. Instrucțiunea întoarce `ids_rollback`.
3. **(b)** Același mecanism pentru hartă. Furnizorii noi se rezolvă după nume abia după (a). Rândurile cu încredere mică sunt comentate.
4. **(c)** *Opțional, peste cererea inițială:* completează emailul la 14 furnizori existenți care n-au email în master. Fără email, RFQ-ul nu are unde pleca. Suprascrie doar câmpuri goale.
5. **(d)** Verificare după aplicare, plus rollback.

**Cum a fost validat SQL-ul** (pe 02.10, fără nicio scriere în producție):
- Sintaxa: cu parserul real PostgreSQL 16 (libpg_query). Sunt 8 instrucțiuni; (a) are 18 rânduri, (b) 77, (c) 14. Cu toate rândurile „mică” decomentate: (a) 23, (b) 105.
- Producția, doar `SELECT`: cele 17 nume existente se rezolvă fiecare la exact un id (21, 26, 10, 23, 5, 25, 6, 22, 30, 12, 14, 3, 1, 19, 32, 4, 31), iar cele 23 de nume noi nu există încă. Cele 9 categorii se potrivesc exact cu `ofertare_cantitati`.
- Test local într-un Postgres în proces (PGlite), cu cele 36 de rânduri reale din master și tabela țintă în două variante (fără id; cu id și UNIQUE `(furnizor_id, categorie)`):
  - dry-run = 0 scrieri;
  - apply = 18 furnizori noi, 77 de rânduri în hartă (Conducte 18 · Sudură 18 · Materiale 16 · Armături 10 · Branșamente 10 · Drumuri 3 · Betoane 2), 14 emailuri completate;
  - a doua rulare nu mai schimbă nimic;
  - rollback-ul (d.3) readuce exact starea inițială.

Harta nu trimite nimic. Trimiterea efectivă a RFQ-urilor către firme din afară rămâne o acțiune cu poartă umană (CLAUDE.md pct. 7 și pct. 10).

---

## Anexă: sursele adreselor de email (Gmail, doar metadate)

| Furnizor | Adresă | Ce arată firul | Fir Gmail (id) · dată |
|---|---|---|---|
| KITMETAL | contact@kitmetal.ro | trimite oferte | 19fa3a967d4f6123 · 27.07.2026; 19e07c536ad83700 · 05.2026 |
| PETROUZINEX | marketing@petrouzinex.ro | trimite oferte (CC bucuresti@, office@) | 19dd9eb837aea7ad · 27.07.2026 |
| TERAPLAST | office@teraplast.ro | trimite oferte | 1a0b0b83a0d3ce5f · 17.09.2026 |
| IZOCOND | office@izocond.ro | expeditor | 19dbe733d0c27e2a · 24.04.2026 |
| VALROM | office@valrom.ro | cerere Gazpet, răspuns cu office@ în CC | 19bd5d1e9a2d138b · 26.01.2026 |
| IMD | radu.ghita@imd.ro / mihaela.pinzaru@imd.ro | corespondență și oferte | 19feadc1fabb3867 · 08.2026; 1a0d30d85ff9c816 · 24.09.2026 |
| SEVLAR | ofertare@sevlar.ro | trimite oferte | 19a254d3b2e1d0d5 · 28.10.2025 |
| SAMI PLASTIC | marketingsud@samiplastic.ro | trimite oferte | 19df866194ed15d6 · 05.2026 |
| TEHNO WORLD | office@tehnoworld.ro | cereri Gazpet | 19cd6c719c566ed7 · 10.03.2026; 19df70326a763398 · 05.05.2026 |
| INDUSTRIAL FLUID | office@ifluid.ro | trimite oferte | 1965ceeb94b85444 · 04.2025 |
| APAZOL | office@apazol.ro | expeditor | 1a00010826e5dd09 · 14.08.2026 |
| UPRUC CTR | ciprian.fratila@uprucctr.com | expeditor | 1a034292b4034626 · 08–09.2026 |
| VALROTRADE | desfacere@valrotrade.ro | trimite oferte, confirmă comanda | 19afe2787904832a · 12.2025; 19c22cf3d65dcdfc · 03.02.2026 |
| VASTRUM | comercial@vastrum.ro | deja în master; cerere Gazpet | 19d9ae49ff75d826 · 14.05.2026 |
| MEDA CONSTRUCT | bogdanalexandru@meda.com.ro | corespondență cu Achizițiile | 1a07fc4d7f1116f3 · 09.2026 |
| TONIVIAD | office@toniviad.ro | cereri Gazpet | 19cd6c719c566ed7 · 10.03.2026; 19df70326a763398 · 05.05.2026 |
| SIGSERV | sig.serv_group@yahoo.com | cereri Gazpet (vechi) | 189fdd933a053e74 · 08.2023; 1904e70a35715334 · 06.2024 |
| AQUA COLOR | office@aquacolor.ro | trimite oferte | 18cf980c3d6d9ff3 · 01.2024 |
| ALL INSTAL | licitatii@all-instal.ro / vanzari3@ | cereri Gazpet | 19bd5d1e9a2d138b · 01.2026; 19cd6c719c566ed7 · 03.2026 |
| METALARC | office@metalarc.ro | expeditor | 1a033a32ed12504e · 25.08.2026 |
| ROMVALVES | romvalves@romvalves.ro | cerere Gazpet | 19d1fdeb24b43802 · 24.03.2026 |
| ARMAX (SRL) | armaxsrl@yahoo.com | cerere Gazpet | 1926c1947e895b91 · 10.2024 |
| TIMOREX | sctimoreximpex@yahoo.com | cerere Gazpet | 19daf649d726c7d3 · 21.04.2026 |
| FERBAT SERV | office@ferbatserv.ro | cereri Gazpet | 19c28166b733b105 · 04.02.2026 |
| SORCHIV | cms_sorchiv.gaz@yahoo.com | mesaje de la Gazpet | 19ef44ff898732f1 · 02.07.2026 |
| NORD GAZ | nordgazdistributie@gmail.com | expeditor | 19b129a40e2c8401 · 2025–2026 |
| HOMPLEX | marketing@homplex.ro | expeditor | 19a0f63e7c347436 · 10.2025 |
| WINTER COM | nicolae.avram@wintercom.ro | expeditor | 1a091a2c102f2d99 · 09.2026 |
| PALPLAST | daniel.dita@palplast.ro | expeditor | 1a09ed6a9405d58f · 09.2026 |
| HATBORU RO | leonardo.stanescu@hatboru.ro | trimite oferte | 19e173e65088ffa0 · 11.05.2026 |
