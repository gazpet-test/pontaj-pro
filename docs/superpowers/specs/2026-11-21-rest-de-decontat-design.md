# Rest de decontat (bani și cantități) pe proiect, tronson și articol — design

Data: 21.11.2026. Cerut de Răzvan (owner). Pilot: Lot 1 Prunișor–Jupa (proiect 1). Apoi toate proiectele.

## Intenția și de ce

Gazpet facturează pe baza situațiilor de lucrări lunare (valoarea confirmată prin certificatul de plată). La unele proiecte se decontează
greu și, la final, rămân articole din ofertă nedecontate — bani pierduți. Răzvan vrea ca, pentru fiecare proiect, să se vadă **cât mai
este de decontat, în bani și în cantități**: pe articol, adunat pe tronson / obiect (acolo unde proiectul e împărțit așa) și pe tot
proiectul. Strict partea financiară (nu execuția fizică din rapoartele zilnice, care există deja în „Deviz vs executat”).

Formula: **rest de decontat = (ofertă depusă la licitație + acte adiționale) − cumulat decontat prin situațiile de lucrări**.

## Cine îl folosește

Owner-ul, managerul de proiect (MP), directorul financiar și directorul tehnic: lunar, când pregătesc situația, ca să nu scape articole; și oricând,
ca să vadă cât mai e de încasat pe proiect.

## Obiective

- Pe fiecare proiect: tabel pe articol (cod, denumire, UM, cantitate și valoare ofertă+adiționale, cantitate și valoare decontată
  cumulat, rest cantitate, rest valoare, % decontat), grupat pe obiect / tronson, cu totaluri în bani pe obiect și pe proiect.
- Regulă de lucru (Răzvan): **fiecare situație de lucrări se încarcă în ERP, la toate proiectele**, lunar. Fișierele sunt mici.
- Semnal pentru articolele cu risc: ofertat, dar nedecontat deloc / sub un prag, pe măsură ce proiectul se apropie de final.
- Funcționează la orice proiect, nu doar la Lot 1.

## Non-obiective

- Execuția fizică (cât s-a lucrat pe teren) — rămâne în „Deviz vs executat” (v_executie_tinte, din rapoartele zilnice).
- Emiterea facturilor, certificatele de plată, ajustările de preț: există deja în Financiar → Situații de plată; aici doar se citesc.
- Nu se modifică fluxul existent de încărcare a borderoului / certificatului TGZ.

## Anti-obiective (ar fi un eșec chiar dacă „merge”)

- Cifre greșite fără semnal: un articol din situație legat de alt articol din ofertă, sau o situație citită pe jumătate, care dă un rest
  fals. Orice potrivire nesigură trebuie să ajungă la om, nu să intre tăcut în calcul.
- Cantități adunate între articole cu unități diferite.
- Dublarea unei situații (aceeași situație încărcată de două ori dublează decontatul).

## Ce există azi (constatat în cod și în BD, 21.11.2026)

- `proiect_articole` (id, proiect_id, obiect_cod, obiect_nume, deviz_cod, deviz_nume, nr, cod, denumire, um, cantitate, valoare,
  pret_unitar, sursa = contract_initial / act_aditional / extras_materiale, act_nr …) — articolele de deviz pe obiect. Încărcat azi doar
  la 2 proiecte (Ștefan cel Mare 284 articole / 6 obiecte, Hoghilag 78). Lot 1: nimic. Parserul `src/devizParser.js` (F3 din .docx /
  .xls, conversia UM „100 MC”, „HM” etc.) există și e folosit de `CatalogDevizPanel`.
- `executie_situatii_plata` + `_linii` (Financiar → `TabSituatiiPlata.jsx`): situațiile de plată la nivel de VALOARE pe situație
  (bază, ajustare, OS, certificat, factură); liniile sunt pe tip (lucr_cm / ajustare / reținere), fără articol / cantitate. Lot 1 are
  15 situații. Borderoul XLS și certificatul PDF sunt deja în Storage (`centralizator_xls_path`, `certificat_pdf_path`), parsate
  client-side (SheetJS) doar pentru totaluri.
- `executie_acte_aditionale`: doar număr / dată / valoare / descriere, fără articole.
- `v_executie_tinte` / `DevizVsExecutatTab`: deviz vs EXECUTAT fizic (rapoarte), pe obiect × activitate — altă măsură, nu se atinge.
- Cititoarele locale de pe serverul AI (LightOn + MinerU pe GPU, Docling pe CPU) pentru PDF-uri scanate; modelul local (Ollama) pentru
  potriviri pe text.

## Abordări (discutate cu Răzvan)

- **A. Pe articol (ALEASĂ).** Fiecare articol din ofertă + adiționale e legat de același articol din fiecare situație de lucrări; restul
  se calculează pe articol și se adună în bani pe obiect și pe proiect. Singura variantă care arată *ce* anume a rămas nedecontat și care
  dă și cantități (cerute explicit de Răzvan: „în bani și în cantități”).
- B. Doar valori pe tronson / obiect: mai simplu, dar nu arată articolele uitate și nu are cantități. Folosit doar ca rezervă pentru o
  situație care nu are detaliu pe articol (marcată „fără detaliu”, intră doar în totalul obiectului).
- C. Doar pe proiect (valoarea situațiilor, existentă): nu servește scopul.

## Designul

### Datele

1. **Baza (ofertă + adiționale)** = `proiect_articole` cu sursa `contract_initial` / `act_aditional` (refolosit, nu tabel nou). Se
   încarcă din oferta financiară depusă (F3 / devizele pe obiect) și din devizele fiecărui act adițional. Un act adițional poate adăuga
   articole, mări sau micșora cantități (cantitate negativă = diminuare) — baza pe articol = suma tuturor rândurilor lui.
2. **Decontat** = tabel nou `executie_situatii_lucrari_linii` (nume propus): pe fiecare rând — proiectul, situația (legată de
   `executie_situatii_plata` când există; altfel luna / nr. situației), obiect, cod articol, denumire, UM, cantitate în luna respectivă,
   preț unitar, valoare, legătura la articolul din bază (`proiect_articol_id`, poate fi NULL până se rezolvă), sursa (fișier + amprentă),
   cine a confirmat și când. Situațiile se încarcă o singură dată (cheie unică pe proiect + nr. situație + amprenta fișierului) — o
   reîncărcare nu dublează.
3. **Calculul** = o vedere (security_invoker) pe articol: bază, decontat cumulat, rest, % — și sume pe obiect / proiect (doar bani).
   O singură definiție a calculului (L19), citită de ecran și de export.

### Încărcarea (o dată pe situație)

- Din ecranul de situații de lucrări: omul încarcă fișierul situației (XLS sau PDF). XLS → parsare deterministă (refolosește
  `devizParser.js`, extins pentru coloanele „cantitate în perioadă / cumulat”); PDF scanat → cititoarele locale de pe serverul AI
  (nimic în cloud). Rezultatul e o **previzualizare**: fiecare rând cu articolul din bază propus.
- Potrivirea: întâi cod articol + obiect (exact); apoi cod articol singur; apoi descriere (modelul local propune, cu scor). Orice rând fără
  potrivire sigură = „de verificat” — omul alege articolul sau îl marchează „articol nou, în afara ofertei”. Nimic nesigur nu intră tăcut.
- Controale la confirmare: totalul situației citite = totalul din borderoul / certificatul deja existent pentru acea situație
  (diferență afișată, confirmare cerută peste un prag); UM-ul articolului din situație = UM-ul din bază (după conversia „100 MC” etc.),
  altfel „de verificat”.

### Ecranul

- În proiect (Execuție → proiect, tab nou „💰 Rest de decontat”; sau în Financiar lângă situații — decizia de plasare: vezi mai jos):
  totaluri sus (ofertă+AA, decontat, rest, %), apoi pe obiect / tronson (bani), apoi pe articol (bani + cantități), filtre „doar cu rest”,
  „nedecontat deloc”, „peste ofertă”. Export Excel.
- Semnal: articole nedecontate deloc / sub X% când proiectul trece de Y% din valoare decontată — listă scurtă sus.

### Drepturile (decis de Răzvan, 21.11.2026)

- Citire (cifrele cu bani): **owner-ul, managerul de proiect al proiectului respectiv, directorul financiar și directorul tehnic**.
  Nimeni altcineva, inclusiv cei care au azi acces la Execuție (șefi de șantier etc.) — restul de decontat NU se vede prin accesul
  general la Execuție.
- Managerul de proiect = câmp nou pe proiect (responsabilul proiectului), folosit pentru drept: un MP vede doar proiectele lui.
  Directorul financiar și directorul tehnic = un sub-modul nou în `user_module_access` (ex. `executie_rest_decontat`), acordat
  explicit, doar cu „da”-ul lui Răzvan (regula drepturilor); fără nume de persoane în cod sau în migrare.
- Încărcare / confirmare situații și devize de act adițional: owner, MP-ul proiectului, directorul financiar; responsabilul de
  contracte poate încărca actele adiționale + devizele lor (fără să vadă neapărat restul, dacă nu are dreptul de citire).
- Aceeași regulă în BD (RLS + o singură funcție de drept, L19), ecranul doar o oglindește.

### Cum ajung documentele în ERP (decis 21.11.2026)

Răzvan: situațiile de lucrări detaliate (cod articol, UM, cantitate, preț) **există** la fiecare lună, doar că nu au fost puse în
ERP; actele adiționale au fost puse până acum fără devize. De acum:
- **Regulă de lucru**: la fiecare situație lunară se pune în ERP și situația detaliată (pe articole), lângă borderou și certificat; la
  fiecare act adițional se pune și devizul lui (cu plus și minus). Ecranul arată lipsurile: „situația nr. N fără detaliu”, „act
  adițional fără deviz” — ca regula să se vadă, nu să depindă de memorie.
- **Tura de noapte (scannerul de pe server)** caută pe NAS / mail ce lipsește și **atașează singură fișierul** la situația / actul
  adițional corect (așa cum face deja cu documentele de proiect) și pregătește previzualizarea liniilor. **Nu confirmă liniile**:
  cifrele intră în calcul doar după confirmarea omului (MP / director financiar) — e conținut extern care ar scrie în bani (pct. 7 +
  10 din regulile proiectului: citește extern + scrie ⇒ poartă de confirmare).
- Încărcarea manuală din ecran rămâne posibilă (aceeași previzualizare, același pas de confirmare).
- **Actele adiționale la Transgaz vin cu diferențe (plus și minus)**: importul implicit = „doar diferențe” (se adună cu semn);
  „listă completă revizuită” rămâne opțiune, aleasă explicit.
- Recuperare (o dată): devizele actelor adiționale deja înregistrate fără deviz (Lot 1 are 6) și situațiile detaliate ale lunilor
  trecute (Lot 1: 15) — prin tura de noapte, apoi confirmare.

### Poarta la deschiderea unui proiect nou (decis de Răzvan, 21.11.2026)

- Un proiect / contract nou rămâne „în configurare” până se încarcă oferta financiară (F3 + devizele pe obiect) în
  `proiect_articole`; până atunci NU poate trece în „în execuție” (garda în BD, ecranul doar o oglindește).
- Poarta nu blochează munca de teren (pontaj, rapoarte, logistică merg de la prima zi) — doar trecerea de stare.
- Owner-ul are excepție cu motiv scris (jurnalizată), pentru urgențe.
- Proiectele deja deschise: listă „fără ofertă financiară” pe ecran, de completat o dată; poarta nu le schimbă starea retroactiv.

### Note de renunțare (NR) și note de comandă suplimentară (NCS) (decis de Răzvan, 21.11.2026)

- Surse noi în bază, ca actele adiționale: fiecare NR / NCS cu documentul și devizul ei (diferențe cu semn: NR minus, NCS plus),
  încărcate cu previzualizare + confirmare; ecranul arată „NR / NCS fără deviz”.
- O notă intră în bază din momentul aprobării de către beneficiar.
- **Fără dublare:** când vine actul adițional care preia notele, AA se LEAGĂ de notele respective și conținutul lor nu se mai adună
  încă o dată; din AA se adaugă doar ce aduce în plus față de notele legate. O notă legată de un AA rămâne vizibilă (istoric),
  dar baza o numără o singură dată.

### Pilotul (Lot 1)

1. Oferta financiară depusă + devizele actelor adiționale → `proiect_articole` (proiect 1).
2. Toate cele 15 situații de până acum → încărcate, potrivite, confirmate.
3. Verificarea: totalul decontat din ERP = suma certificatelor de plată (minus ajustări).

## Fără dependență de AI în cloud (decizia lui Răzvan, 21.11.2026)

Fluxul nu folosește niciun model din cloud (Anthropic sau altul), ca să nu depindă de un abonament / cont care poate fi suspendat:
- XLS / DOCX → parsare deterministă în browser (`devizParser.js`, SheetJS) — fără AI deloc;
- PDF scanat → cititoarele locale de pe serverul AI (LightOn / MinerU pe GPU; Docling pe CPU ca rezervă);
- potrivirea pe descriere (când codul de articol lipsește) → modelul local (Ollama) doar propune, omul confirmă.
Dacă serverul AI e oprit, XLS-urile se încarcă în continuare (totul în browser); doar PDF-urile scanate așteaptă serverul.

## Decizii luate de mine (propuneri, de corectat)

- Restul se calculează la **prețurile din ofertă / adiționale**; ajustările (coeficienții de actualizare din situații) se arată separat,
  nu modifică cantitățile.
- Cantitățile se compară doar pe articol (unități diferite nu se adună); pe obiect / proiect doar bani.
- „Articol nou, în afara ofertei” (lucrare decontată fără articol în bază) apare separat, cu valoarea lui, nu se pierde.
- Încărcarea situațiilor rămâne pe fiecare proiect la MP / Financiar; AI-ul local doar citește și propune.

- **Cantitatea lunii vs cumulat:** adevărul = cantitatea din perioadă (decontat = suma situațiilor); cumulatul din situație, dacă există,
  e control — diferență față de suma noastră = „de verificat”. Regularizările (cantități negative într-o lună) se adună cu semn.
- **Identitatea unui articol:** obiect + deviz + cod; dacă același cod apare de mai multe ori în același deviz, și poziția (`nr`).
  Legătura liniei de situație = la cheia articolului (nu la un singur rând din `proiect_articole`); baza pe cheie = suma rândurilor.
- **Act adițional:** la import se alege explicit „doar diferențe” (se adună) sau „listă completă revizuită” (înlocuiește rândurile vechi
  ale obiectelor atinse, cele vechi rămân pentru istoric); o schimbare doar de preț ia prețul actului cel mai recent.
- **Organizare de șantier, diverse / neprevăzute:** rânduri speciale în bază (din centralizatorul ofertei) și în decontat (din borderou,
  linia OS), ca totalul pe proiect să se împace cu contractul și cu certificatele.
- **Situație refăcută:** cheia unică = proiect + nr. situație; o reîncărcare cu alt fișier cere „înlocuiește” explicit (owner / Financiar
  editor), versiunea veche rămâne inactivă pentru audit; nu se adună niciodată două versiuni.

## Ce rămâne pentru constructor

- Formatul situațiilor: **întâi modelul Transgaz** (decizia lui Răzvan, 21.11 — același model îl folosesc Conpet, Romgaz, Depogaz); primăriile au alt format și vin într-o etapă ulterioară (eventual cu AI-ul local care doar recunoaște coloanele, cifrele le citește tot codul). Parserul trebuie să recunoască
  antetele; se pornește cu Lot 1 (Transgaz).
- Legătura situație de lucrări ↔ `executie_situatii_plata` (aceeași lună / nr.).
- Plasarea ecranului și numele exacte ale tabelelor / coloanelor, migrarea (L15 v2), testele.
