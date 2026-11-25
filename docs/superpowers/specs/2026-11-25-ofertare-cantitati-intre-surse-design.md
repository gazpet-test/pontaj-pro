# Ofertare: aceeași cantitate, documente diferite — semnalare automată și propunere de clarificare (TKT-2026-0329) — specificație v3

Data: 25.11.2026 · Stare: v3 după a doua rundă de review NO-GO (5 puncte) · Varianta A din `TKT-0329_variante.md`, **de ales de owner** înainte de plan.

## 1. De ce

Pe o licitație, lungimea țevii era 6.400 m în F3 și 3.995 m în ATR. ERP-ul n-a observat diferența și n-a propus o clarificare; a întrebat un alt ofertant. Avem nevoie ca diferențele mari între documentele aceleiași licitații să ajungă în fața echipei ca **ciornă** de clarificare, cu dovada din ambele surse, fără să plece nimic singur.

## 2. Ce există azi (și se refolosește)

- **`ofertare_cantitati`:** `cantitate`, `cantitate_plansa`, `diferenta_nota`, `obiect`, `lot_nr`, `cod_articol`, `um`, `surse_document_ids`.
- **`ofertare_documente_atribuire`:** `tip`, `revizie`, `text_extras` pe pagini; ATR-ul intră azi la `alta`.
- **Ciornele automate de clarificare** (mecanismul „planșe”):
  - cheie `auto_planse_*` (`ofertareClarificariBaza.js`), unică pe `(licitatie_id, cheie)`;
  - starea bazei verificată pe server în `v_ofertare_clarificari_baza` (`ok`, `identitate_contradictorie`, `marcaj_planse` = baza s-a schimbat după editare / aprobare);
  - exportul prin RPC-ul `ofertare_clarificari_export`;
  - stările permise: `propunere`, `de_trimis`, `trimisa`, `raspunsa`, `retrasa`.
- **Răspunsul Autorității** (`raspuns_clarificare`) se leagă de întrebări prin `raspuns_document_id`, ca **propunere confirmată de om** (`OfertareClarificari.jsx`).
- **Poarta pe cheltuială:** doar owner-ul sau responsabilul licitației pornesc o procesare plătită.

## 3. Ce se construiește

### 3.1 Măsura comparabilă (rezolvă potrivirile greșite)

O **măsură** = (licitație, lot, obiect / tronson, element, natura măsurii, UM canonică):
- **element** = țeavă (DN + material), robinet (DN + tip), branșament (tip), săpătură, refacere și altele, din lista închisă `ofertare_elemente_masura`;
- **natura** ∈ {`furnizare`, `montaj`, `proba`, `total_lucrare`}. O poziție F3 de furnizare se compară doar cu „furnizare” sau „total_lucrare” din alt document, nu cu montajul sau cu proba aceleiași țevi;
- **agregarea** se face doar pe aceeași măsură: suma pozițiilor F3 de furnizare pe obiect se compară cu totalul ATR pe același obiect. Un total pe toată lucrarea se compară doar cu suma tuturor obiectelor, nu cu un singur tronson. Fiecare valoare intră o singură dată în agregare (identitatea poziției).
- O potrivire incompletă (lot, obiect, natură sau element necunoscut) dă **„de verificat”**, cu ambele surse afișate. Nu e nici „diferență”, nici „în regulă”.
- **Completitudinea agregării:** fiecare măsură agregată are un **inventar** al componentelor așteptate.
  - Pe partea F3: toate pozițiile `ofertare_cantitati` ale obiectului cu același element și aceeași natură.
  - Pe partea document: toate paginile și rândurile de tip „cantitate” ale secțiunii respective, cu paginile neprocesate (`pagini_necitite`, plafonul de pagini) marcate.
  - Verdictul `diferenta` sau `in_regula` se dă **doar** dacă inventarul e complet pe ambele părți: toate componentele au dovadă validă și nicio pagină din secțiune nu e neprocesată.
  - Altfel verdictul e `neverificat: agregare incompletă`, cu lista componentelor lipsă.

### 3.2 Dovada valorii (rezolvă citatele care nu dovedesc nimic)

Fiecare valoare comparată, **inclusiv cea din F3**, are o dovadă cu `document_id`, `revizie`, `pagina`, `rand` / `celula` (pentru tabele) sau `fragment` (pentru text), `antet_coloana`, `valoare_text`, `um_text`.

- **Verificarea pe server** (deterministă, fără AI): fragmentul există literal în `text_extras` la pagina dată. Pentru **tabele**: `valoare_text` e conținutul întreg al celulei de pe rândul declarat, în coloana al cărei antet e de cantitate (lista închisă: „cantitate”, „cant.”, „lungime”, „L (m)”, „nr. buc” și altele), iar UM vine din coloana sau antetul UM al aceluiași rând.
- Pentru **text liber**, sunt acceptate doar tiparele din lista închisă `ofertare_tipare_cantitate`, de forma `<cuvânt-cheie de cantitate> [:=]? <număr> <UM>` (ex. „lungime 250 m”, „L = 250 m”, „în lungime totală de 250 m”):
  - numărul e un token numeric **întreg**, delimitat (nu parte din „DN160” sau „Ø160”), lipit direct de UM;
  - numerele precedate de `DN`, `Ø`, `PN`, `SDR`, `De`, `Dn` sau urmate de `mm` sunt **interzise** ca valori de cantitate.
  - Orice alt text liber: `neverificat: valoare nelegată`, vizibil în ecran.
- Orice verificare picată: măsurătoarea e respinsă și nu poate produce un semnal.
- AI-ul doar propune unde e valoarea; nu e sursa adevărului.

### 3.3 Regula de semnalare

- **Unitatea canonică** pe element: m pentru lungimi, buc, mc, mp. Conversii acceptate doar din tabelul închis (km→m, ml→m, t→kg numai pentru elementele cu masă). Orice altă UM înseamnă „neverificat: unitate incompatibilă”.
- **Numerele:** format românesc (punct = separator de mii, doar în grupuri exacte de câte 3 cifre; virgulă = zecimale). „1.234” = 1234; „1,234” = 1,234; „1.23” sau „1.2345” (grup ≠ 3 cifre după punct) = `neverificat: format numeric ambiguu`. Același token interpretat diferit de cele două reguli nu se acceptă niciodată.
- **Formula:** `|a − b| / max(|a|, |b|) > p`, unde `p` e pragul licitației (implicit 5%). Diferențele absolute sub o unitate canonică se ignoră.
  - `a = b = 0`: în regulă.
  - Una dintre valori 0 sau lipsă: „de verificat”, nu diferență.
- Pe fiecare măsură, rezultatul e unul dintre `in_regula`, `diferenta`, `de_verificat` sau `neverificat` (cu motivul). Ecranul arată explicit `neverificat`; lipsa unui semnal nu înseamnă „verificat în regulă”.

### 3.4 Identitate, versiuni, invalidare

- **Trei lucruri separate:**
  - **identitatea semnalului** = amprenta *stabilă* (licitație + măsura canonică de la 3.1). Nu depinde de valori sau de prag;
  - **evaluarea** = versiunea curentă a comparației: amprenta tuturor intrărilor (valorile, dovezile cu revizia, inventarul agregării, pragul, cantitatea din ERP) și verdictul;
  - **decizia omului** pe ciornă: editată, aprobată, respinsă (`retrasa` cu `retrasa_de = 'om'`).
- **Ciorna** are cheia `auto_surse_<identitate>`, unică prin `(licitatie_id, cheie)`, și reține `evaluare_amprenta` de la generare.
- **Publicarea, atomic, într-un RPC:**
  - lock pe rândul semnalului;
  - se recitesc amprentele **curente** ale surselor (revizia documentelor, cantitatea, pragul). Dacă diferă de cele de la începutul extragerii, rezultatul se aruncă (`evaluare_depasita`) și rămâne cea curentă;
  - abia apoi se scrie evaluarea și se aplică tranzițiile de mai jos.
- **Tranzițiile ciornei:**
  - verdict `diferenta` și fără ciornă → se creează `propunere`;
  - verdict `diferenta`, iar ciorna e `retrasa` **automat** (`retrasa_de = 'sistem'`) → **se reactivează** în `propunere`, cu textul regenerat;
  - verdict `diferenta`, iar ciorna e `retrasa` **de om** → rămâne retrasă. Dacă amprenta evaluării s-a schimbat față de cea respinsă, apare semnalul „diferența a reapărut după respingere” în ecran, fără ciornă nouă;
  - verdictul nu mai e `diferenta`, iar ciorna e `propunere` needitată → `retrasa`, cu `retrasa_de = 'sistem'` și motivul;
  - ciornă editată, aprobată sau trimisă → nu se atinge; dacă `evaluare_amprenta` ≠ amprenta curentă, primește „baza s-a schimbat — de reverificat” (3.5).

### 3.5 Integrarea cu fluxul de clarificări (circuitul complet)

- Ciorna intră cu `status = 'propunere'`, cheie `auto_surse_*` și `origine = 'automat'`.
- **Fiecare punct** din circuitul de protecție al ciornelor `auto_planse_*` se extinde **explicit** la `auto_surse_*` (nu se bazează pe `origine`):
  - helperul `eCiornaAutomata` (regex `^auto_(planse|surse)_`);
  - RPC-ul de reconfirmare;
  - trigger-ul care protejează editarea, aprobarea, transmiterea și ștergerea (cheia selectată de trigger);
  - view-ul `v_ofertare_clarificari_baza`;
  - RPC-ul `ofertare_clarificari_export`.
  - Inventarul exact (fișier / funcție / linie) se face în plan, din SQL-ul existent (inclusiv `docs/R5_MIGRARE_PROPUSA_cantitati_nevalidate.sql`, liniile ~1142 și ~1178). Testele dovedesc fiecare punct cu o ciornă `auto_surse_*`.
- **Scrierea directă** pe ciornele `auto_surse_*` (UPDATE pe text / status / bază, DELETE) e blocată ca la `auto_planse_*`.
- **Baza validă pentru export** = amprenta **întregii evaluări** curente (valorile, dovezile cu revizia, inventarul complet, pragul, cantitatea din ERP) e egală cu `evaluare_amprenta` pe care omul a aprobat **textul exact**. Ciorna e blocată la export când:
  - amprenta s-a schimbat;
  - recalcularea e în curs (`evaluare_in_curs`);
  - ultimul verdict nu mai e `diferenta`.
  Mesajul e unul singur: „baza s-a schimbat — de reverificat”.
- Trimiterea rămâne manuală.

### 3.6 Răspunsul Autorității (rezolvă „acoperit” fals)

La urcarea unui `raspuns_clarificare`, sistemul propune doar **„răspuns posibil relevant”** pentru semnalele deschise care se referă la aceeași măsură. Omul confirmă, ca la legătura existentă `raspuns_document_id`. Abia după confirmare semnalul poate fi marcat `rezolvat_de_raspuns`, cu valoarea reținută aleasă de om. Corecturile ulterioare ale Autorității redeschid semnalul (revizie nouă, ca la 3.4).

### 3.7 Datele: integritate și drepturi

- **Tabel nou `ofertare_cantitati_masuratori`:**
  - `licitatie_id` obligatoriu;
  - FK spre cantitate și document;
  - trigger care verifică faptul că cantitatea, documentul și măsurătoarea sunt ale **aceleiași licitații**.
- **Scrierea:** doar prin RPC-ul de server (`SECURITY DEFINER`, cu drept `fn_are_acces_ofertare()` reverificat după lock-uri). Nicio scriere directă pentru `authenticated`: `REVOKE INSERT/UPDATE/DELETE`, iar coloanele de dovadă și verdictul de verificare sunt scrise doar de server.
- **Citirea:** RLS cu `auth.uid() IS NOT NULL AND fn_are_acces_ofertare()`, ca la cantități. Vizibilitatea pe licitație e verificată pentru fiecare referință.

### 3.8 Cost

- Comparația rulează **doar** în aceeași procesare plătită pornită de owner sau de responsabil (poarta existentă), și doar pe documentele de tip `lista_cantitati`, `formular` (F3), `alta` marcate ATR, `cs_volum` (memoriu) și `plansa`.
- **Plafonul:** număr maxim de pagini pe licitație pentru căutarea măsurilor (implicit 200), plus tokenii prin plafonul existent pe proiect. Rezervarea se face **înaintea** apelului, prin mecanismul existent.
- **Fără reîncercare automată** la cost necunoscut sau răspuns pierdut: starea devine `neverificat`, iar reluarea o pornește omul.
- **Urcarea unui răspuns al Autorității** nu declanșează apeluri plătite: potrivirea de la 3.6 e textuală (măsura canonică), fără AI.

## 4. Ce NU face

- Nu schimbă cantitățile validate.
- Nu trimite clarificări.
- Nu citește SEAP automat (asta e varianta B).
- Nu atinge prețuri.

## 5. Probe

1. **Cazul din tichet:** 6.400 față de 3.995, pe aceeași măsură, dă `diferenta`, cu ciornă și ambele dovezi.
2. **Negative:**
   - furnizare față de montaj, total față de tronson, două tronsoane cu același DN: fără semnal greșit;
   - citat autentic, dar valoarea de pe alt rând sau diametrul în loc de cantitate: măsurătoarea e respinsă;
   - unități incompatibile și număr ambiguu: `neverificat`;
   - răspunsul Autorității care doar pomenește rândul: rămâne „posibil relevant” până la confirmarea omului.
3. **Idempotență, concurență, versiuni:**
   - două rulări simultane ale extragerii dau o singură ciornă;
   - o extragere începută înaintea unei revizii noi nu publică (`evaluare_depasita`);
   - pragul crește apoi revine: ciorna retrasă de sistem se reactivează; respinsă de om, rămâne respinsă, cu semnalul „a reapărut”;
   - o revizie nouă invalidează doar propunerile needitate;
   - exportul e blocat după schimbarea cantității, a pragului sau a inventarului, chiar dacă citatele sunt valide.
3b. **Completitudine și text:**
   - o poziție F3 respinsă sau o pagină peste plafon dă `neverificat: agregare incompletă`;
   - „conductă DN 160, lungime 250 m” dă 250 m; „DN160 … 160 m” nu ia diametrul;
   - „1.23” dă `neverificat`.
3c. **Circuitul complet:** reconfirmarea, trigger-ul (editare / aprobare / transmitere / ștergere) și exportul, testate fiecare pe o ciornă `auto_surse_*`.
4. **Acces:**
   - utilizator fără acces la Ofertare: nu citește și nu scrie;
   - scriere directă în tabel: refuzată;
   - asocierea a două licitații diferite: refuzată de trigger.
5. **Cost:** plafonul de pagini e respectat; un răspuns pierdut nu duce la a doua generare.
6. **Măsurarea:** pe 3 licitații reale, cu numărătoarea pentru fiecare: semnale corecte, false, diferențe reale ratate (verificate manual pe o mostră) și „neverificat”.

## 6. Livrare

- Spec → plan → Rocky: migrare (tabel + trigger + RPC + extinderea view-ului de bază și a exportului) + extragerea + ecrane.
- Review Jakarinos, probă pe clonă. Aplicarea doar cu „da”.
