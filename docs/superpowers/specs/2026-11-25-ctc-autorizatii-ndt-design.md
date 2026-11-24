# CTC: autorizațiile firmelor de control nedistructiv (NDT) la cartea tehnică — specificație v4

Data: 25.11.2026 · Stare: v4 după a treia rundă de review NO-GO (25.11), de aprobat · Origine: TKT-2026-0389, varianta A aleasă de owner („le urcăm ca documente pe firma de control, fără modul nou”).

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
   - `domeniu` primește metoda: RT, UT, PT, MT, VT, sau text liber.
   - **Introducerea** rămâne în Ofertare → Parteneri. `src/OfertareParteneri.jsx` primește categoria în `CATEGORII_DOC` („Autorizație control nedistructiv (NDT)”), iar câmpul `domeniu` primește, pentru această categorie, eticheta „Metoda (RT/UT/PT/MT/VT)”. E singura schimbare în Ofertare.
2. **Calea fișierului, legată de documentul NDT.**
   - Documentele NDT se urcă într-un subdosar dedicat: `parteneri/<partener_id>/ndt/<timp>_<nume>`. Celelalte categorii rămân la calea de azi, `parteneri/<partener_id>/<timp>_<nume>`. Ecranul Parteneri alege subdosarul după categorie.
   - Un trigger `BEFORE INSERT OR UPDATE OF fisier_path, partener_id, categorie` pe `ofertare_parteneri_documente` (funcția `fn_ofertare_doc_cale_garda()`, `RETURNS trigger`, `SECURITY INVOKER`, `search_path` fix, fără EXECUTE pentru clienți), pentru TOATE categoriile:
     - un rând `autorizatie_ndt` cu fișier trebuie să aibă calea `^parteneri/<partener_id>/ndt/[^/]+$`;
     - un rând din ORICE altă categorie NU poate avea o cale sub `/ndt/` (așa nimeni nu poate pune în subdosarul NDT un document de altă natură);
     - nu sunt permise segmente `.` / `..` (un segment întreg egal cu `.` sau `..`), backslash, `%`, caractere de control sau o cale goală. Punctele din numele fișierului (`certificat..pdf`) sunt permise, iar regula privește doar segmentele de cale.
     - Validatorul și generatorul de nume din ecran folosesc **aceeași** regulă: `sanitize` din `OfertareParteneri.jsx` produce numai nume care trec garda, iar ecranul verifică înainte de upload, ca să nu rămână fișiere urcate și respinse la salvare.
     - **unicitate:** nicio cale nu poate fi folosită de două rânduri (index unic parțial pe `fisier_path` unde nu e NULL). Un rând NDT nu poate astfel arăta fișierul altui document.
   - RPC-ul de deschidere (punctul 4) **reverifică** forma căii (subdosarul `ndt` al aceleiași firme), iar edge-ul la fel. Un rând vechi sau scris ocolind trigger-ul nu produce o semnătură pe altă cale.
   - Datele de azi: tabelul e gol, deci indexul unic și trigger-ul nu lovesc niciun rând existent (verificat în $pre$).
   - **Schimbarea categoriei unui document cu fișier** (`alta` → `autorizatie_ndt` sau invers): calea veche nu mai e în subdosarul corect. Ecranul cere un fișier nou înainte de salvare și arată mesajul „Pentru categoria nouă, încărcați din nou fișierul (se mută în dosarul potrivit)”. Fișierul nou se urcă în subdosarul corect, iar cel vechi se șterge după salvarea reușită, ca azi la înlocuire. Fără fișier nou, salvarea e blocată în ecran; dacă trece totuși prin API, trigger-ul o refuză. Un document fără fișier își poate schimba liber categoria.

3. **RPC-ul de listă `fn_ctc_autorizatii_ndt()`**, după tiparul `fn_ctc_autorizatii_sudori`:
   - `SECURITY DEFINER`, `search_path` fix, dreptul `fn_ctc_autorizatii_drept()` evaluat pe `auth.uid()` al apelantului;
   - întoarce **DOAR** rândurile `categorie = 'autorizatie_ndt'` (filtru explicit, în corpul funcției), cu: id, firma (nume, CUI), număr, emitent, metodă, `data_emitere`, `data_valabilitate`, `fara_expirare`, `stare` și `are_fisier`;
   - **nu** întoarce `fisier_path`, observații sau contact;
   - EXECUTE doar `authenticated`.
4. **RPC-ul de deschidere `fn_ctc_autorizatie_ndt_fisier(p_document_id bigint) RETURNS text`**:
   - `SECURITY DEFINER`, același drept CTC, evaluat pe JWT-ul apelantului;
   - întoarce calea DOAR pentru un rând `autorizatie_ndt` care trece regula de la punctul 2; altfel NULL (edge-ul răspunde 404);
   - nu deosebește „nu există” de „nu e NDT” (fără oracol);
   - EXECUTE doar `authenticated`.
   - `fn_ctc_autorizatie_fisier(bigint)` (sudorii, `hr_autorizatii`) rămâne neatinsă.
5. **Edge-ul `ctc-autorizatie-fisier`** acceptă două forme de cerere, fiecare cu EXACT o cheie: `{autorizatie_id}` (sudori, neschimbată, semnătură de 60 s ca azi) și `{ndt_document_id}` (nou). Orice altă formă (chei în plus, ambele chei, tip necunoscut) → 400, fără apel la BD. Pentru `ndt_document_id`:
   - cheamă `fn_ctc_autorizatie_ndt_fisier` cu JWT-ul apelantului (nu cu service_role);
   - verifică din nou forma căii;
   - semnează cu service_role DOAR exact acea cale, în bucket-ul `ofertare`, pe 60 de secunde, ca la sudori.
   - Calea pentru sudori nu se schimbă.
6. **Starea „valabil / expirat”**, aceeași regulă ca la sudori, calculată în RPC:
   - `fara_expirare = true` → `valabil`;
   - altfel, `data_valabilitate` lipsă → `necunoscut`;
   - `data_valabilitate` < data curentă în `Europe/Bucharest` → `expirat`;
   - altfel → `valabil`.
7. **Ecranul CTC → „Autorizații”:**
   - o a doua secțiune, „Firme de control nedistructiv”, sub sudori, în același stil (doar citire, filtru text, stare, buton „Deschide scanul” doar când `are_fisier`);
   - textul „nu sunt încă în platformă” dispare.

## 4. Ce NU face

- Nu dă nimănui acces la Ofertare și nu schimbă politicile de pe `ofertare_parteneri_documente`.
- Nu leagă automat firma NDT de proiect sau de cartea tehnică. Atașarea la carte rămâne manuală.
- Nu importă documente: le urcă un om, din Parteneri.

## 5. Riscuri și probe

1. **Editare și nume:** schimbarea `alta` → NDT și NDT → `alta`, cu și fără fișier nou (fără = blocat; cu = cale corectă); un fișier `certificat..pdf` se salvează atât la NDT, cât și la `certificat_legal`.
1b. **Cale străină.** Un rând NDT care arată fișierul unui document `certificat_legal` al aceleiași firme → refuz (subdosar greșit + unicitate). Un document non-NDT pus sub `/ndt/` → refuz. Un utilizator Ofertare scrie direct `fisier_path` = un document de licitație pe un rând `autorizatie_ndt` → trigger-ul refuză. Un rând de test introdus ocolind trigger-ul (ca `postgres`) → RPC-ul de deschidere întoarce NULL, iar edge-ul răspunde 404. Mutanți: fără trigger, fără verificarea din RPC, fără verificarea din edge.
2. **Filtrul listei:** documentele non-NDT nu apar niciodată în `fn_ctc_autorizatii_ndt()`; mutant fără filtru → pică. **Fără drept CTC** → lista 42501, deschiderea NULL / 403. Un utilizator CTC fără Ofertare vede lista și deschide doar căile NDT valide.
3. **Document fără fișier:** butonul e ascuns; RPC-ul întoarce NULL, iar edge-ul răspunde 404, fără semnătură.
4. **Expirarea:** cele 4 cazuri de la §3.6 (inclusiv ziua de azi, ca valabil, și miezul nopții în Europe/Bucharest).
5. **Introducerea:** selectorul din Parteneri oferă categoria; salvarea cu un fișier urcat produce o cale validă.
6. **Migrarea** (L15 v2): CHECK-ul schimbat, trigger-ul, cele două RPC-uri noi.
7. **Revenirea:**
   - într-o tranzacție, lock pe `ofertare_parteneri_documente` înaintea verificării;
   - refuz dacă există rânduri `autorizatie_ndt`;
   - restaurează CHECK-ul vechi, apoi scoate trigger-ul, funcția `fn_ofertare_doc_cale_garda()`, indexul unic și cele două RPC-uri;
   - verifică la final absența TUTUROR obiectelor noi.
   - Ordinea la revenire: întâi UI-ul, apoi edge-ul (ramura `ndt` scoasă), apoi BD-ul.
   - Probe: apply → rollback → re-apply pe PGlite și pe clona 176; după rollback, Parteneri și sudorii din CTC merg ca înainte.

## 6. Livrare

- Un PR, cu:
  - migrarea (CHECK + funcția și trigger-ul de cale + index unic + 2 RPC-uri, NEAPLICATĂ) și revenirea;
  - edge-ul extins (NEDEPLOYAT);
  - ecranul CTC și selectorul din Ofertare → Parteneri;
  - probe PGlite cu mutanți și teste pentru edge.
- Review Jakarinos.
- Aplicarea migrării și deploy-ul edge-ului: doar cu „da”-ul owner-ului.
- După livrare: TKT-2026-0389 primește completarea în `descriere_interventie`, iar colegul de la CTC primește un mail (draft + „trimite”).
