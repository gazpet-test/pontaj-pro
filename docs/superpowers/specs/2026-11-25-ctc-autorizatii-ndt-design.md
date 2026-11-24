# CTC: autorizațiile firmelor de control nedistructiv (NDT) la cartea tehnică — specificație v1

Data: 25.11.2026 · Stare: propunere, de aprobat · Origine: TKT-2026-0389, varianta A aleasă de owner („le urcăm ca documente pe firma de control, fără modul nou”).

## 1. De ce

Cartea tehnică are nevoie de două seturi de autorizații:
- **ale sudorilor:** sunt deja în CTC → „Autorizații”, livrate prin #1096, doar citire, cu scan;
- **ale firmelor care fac controlul nedistructiv** (radiografie, ultrasunete și altele): nu sunt nicăieri în ERP. Azi se trimit separat, pe mail.

## 2. Ce există azi

- **`ofertare_parteneri`:** 44 de firme, cu `tip_relatie` = `furnizor_servicii` / `subcontractant`. Firmele NDT sunt sau pot fi adăugate aici ca `furnizor_servicii`.
- **`ofertare_parteneri_documente`:**
  - documentele unei firme: categorie, număr, emitent, date de emitere / valabilitate, `fara_expirare`, `domeniu`, `fisier_path` în bucket-ul `ofertare`;
  - categorii permise azi: `autorizatie_isc`, `iso`, `certificat_legal`, `atestat`, `etalonare`, `alta`;
  - azi tabelul e **gol**;
  - RLS: citire și scriere doar cu `fn_are_acces_ofertare()`.
- **Ecranul „Parteneri” din Ofertare** (`src/OfertareParteneri.jsx`) adaugă și editează firmele și documentele lor.
- **CTC → „Autorizații”** (`src/ctc/CtcAutorizatii.jsx`) citește sudorii prin RPC-ul `fn_ctc_autorizatii_sudori()` (`SECURITY DEFINER`, dreptul `fn_ctc_autorizatii_drept()` = owner sau `ctc` / `ctc.*`). Scanul se deschide prin edge-ul `ctc-autorizatie-fisier`, care semnează doar calea întoarsă de BD. În ecran apare textul „Autorizațiile firmelor de control nedistructiv nu sunt încă în platformă”.

## 3. Ce se construiește (varianta A)

1. **Categorie nouă `autorizatie_ndt`.**
   - Se adaugă în CHECK-ul `ofertare_parteneri_documente_categorie_check` (același nume de constrângere).
   - `domeniu` primește metoda: RT, UT, PT, MT, VT, sau text liber dacă documentul acoperă mai multe metode.
   - Introducerea rămâne în Ofertare → Parteneri: cine are acces la Ofertare urcă documentul pe firmă, ca orice alt document. Nu e nevoie de ecran nou.
2. **RPC nou `fn_ctc_autorizatii_ndt()`**, după tiparul `fn_ctc_autorizatii_sudori`:
   - `SECURITY DEFINER`, `search_path` fix, dreptul `fn_ctc_autorizatii_drept()`;
   - întoarce doar rândurile `categorie = 'autorizatie_ndt'`, cu: firma (nume, CUI), număr, emitent, metodă (`domeniu`), date, valabil / expirat și dacă are fișier;
   - **nu** întoarce `fisier_path`, observații sau contact;
   - EXECUTE doar `authenticated`.
3. **Deschiderea scanului** se face prin edge-ul `ctc-autorizatie-fisier`, extins cu un tip de cerere `ndt`:
   - BD-ul întoarce calea doar pentru un document `autorizatie_ndt`, iar edge-ul semnează DOAR acea cale, în bucket-ul `ofertare`, pe 10 minute, ca la sudori;
   - nicio altă cale din `ofertare` nu se poate semna pe acest drum.
4. **Ecranul CTC → „Autorizații”:**
   - o a doua secțiune, „Firme de control nedistructiv”, sub sudori;
   - același stil (doar citire, filtru text, valabile / expirate, buton „Deschide scanul”);
   - textul „nu sunt încă în platformă” dispare.

## 4. Ce NU face

- Nu dă nimănui acces la Ofertare și nu schimbă politicile de pe `ofertare_parteneri_documente`.
- Nu leagă automat firma NDT de proiect sau de cartea tehnică. Atașarea la carte rămâne manuală.
- Nu importă documente: le urcă un om, din Parteneri.

## 5. Riscuri și probe

1. **Un utilizator CTC fără Ofertare:** vede lista NDT și deschide scanul NDT, dar nu poate obține prin RPC sau edge nicio altă cale din bucket-ul `ofertare` (de exemplu documentele unei licitații). Probă negativă cu o cale străină, plus un mutant fără filtrul de categorie.
2. **Utilizator fără CTC:** 42501 / 403.
3. **Document fără fișier:** butonul e ascuns, iar edge-ul răspunde 404, fără semnătură.
4. **Expirarea:** `fara_expirare` sau `data_valabilitate` în trecut → eticheta „expirat”.
5. **Migrarea:** L15 v2, doar CHECK-ul schimbat și funcția nouă. Revenirea refuză dacă există rânduri `autorizatie_ndt`.

## 6. Livrare

- Un PR, cu:
  - migrarea (CHECK + RPC, NEAPLICATĂ);
  - edge-ul extins (NEDEPLOYAT);
  - ecranul CTC;
  - probe PGlite cu mutanți și teste pentru edge.
- Review Jakarinos.
- Aplicarea migrării și deploy-ul edge-ului: doar cu „da”-ul owner-ului.
- După livrare: TKT-2026-0389 primește completarea în `descriere_interventie`, iar colegul de la CTC primește un mail (draft + „trimite”).
