# CTC: autorizațiile firmelor de control nedistructiv (NDT) la cartea tehnică — specificație v2

Data: 25.11.2026 · Stare: v2 după review NO-GO (25.11), de aprobat · Origine: TKT-2026-0389, varianta A aleasă de owner („le urcăm ca documente pe firma de control, fără modul nou”).

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
2. **Calea fișierului, legată de firmă.**
   - Ecranul urcă azi la `parteneri/<partener_id>/<timp>_<nume>` în bucket-ul `ofertare`.
   - Un trigger `BEFORE INSERT OR UPDATE OF fisier_path, partener_id, categorie` pe `ofertare_parteneri_documente` refuză, DOAR pentru `categorie = 'autorizatie_ndt'`, orice `fisier_path` care nu respectă `^parteneri/<partener_id>/[^/]+$`. Nu sunt permise `..`, `\`, `%`, controale sau o cale goală pe un document cu fișier. Celelalte categorii nu sunt atinse.
   - RPC-ul de deschidere (punctul 4) **verifică din nou** aceeași regulă la citire. Un rând vechi sau modificat ocolind trigger-ul nu poate produce o semnătură pe altă cale.
3. **RPC-ul de listă `fn_ctc_autorizatii_ndt()`**, după tiparul `fn_ctc_autorizatii_sudori`:
   - `SECURITY DEFINER`, `search_path` fix, dreptul `fn_ctc_autorizatii_drept()` evaluat pe `auth.uid()` al apelantului;
   - întoarce: id, firma (nume, CUI), număr, emitent, metodă, `data_emitere`, `data_valabilitate`, `fara_expirare`, `stare` și `are_fisier`;
   - **nu** întoarce `fisier_path`, observații sau contact;
   - EXECUTE doar `authenticated`.
4. **RPC-ul de deschidere `fn_ctc_autorizatie_ndt_fisier(p_document_id bigint) RETURNS text`**:
   - `SECURITY DEFINER`, același drept CTC, evaluat pe JWT-ul apelantului;
   - întoarce calea DOAR pentru un rând `autorizatie_ndt` care trece regula de la punctul 2; altfel NULL (edge-ul răspunde 404);
   - nu deosebește „nu există” de „nu e NDT” (fără oracol);
   - EXECUTE doar `authenticated`.
   - `fn_ctc_autorizatie_fisier(bigint)` (sudorii, `hr_autorizatii`) rămâne neatinsă.
5. **Edge-ul `ctc-autorizatie-fisier`** primește parametrul `tip: 'ndt'`:
   - cheamă `fn_ctc_autorizatie_ndt_fisier` cu JWT-ul apelantului (nu cu service_role);
   - verifică din nou forma căii;
   - semnează cu service_role DOAR exact acea cale, în bucket-ul `ofertare`, pe 10 minute.
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

1. **Cale străină.** Un utilizator Ofertare scrie direct `fisier_path` = un document de licitație pe un rând `autorizatie_ndt` → trigger-ul refuză. Un rând de test introdus ocolind trigger-ul (ca `postgres`) → RPC-ul de deschidere întoarce NULL, iar edge-ul răspunde 404. Mutanți: fără trigger, fără verificarea din RPC, fără verificarea din edge.
2. **Fără drept CTC** → lista 42501, deschiderea NULL / 403. Un utilizator CTC fără Ofertare vede lista și deschide doar căile NDT valide.
3. **Document fără fișier:** butonul e ascuns; RPC-ul întoarce NULL, iar edge-ul răspunde 404, fără semnătură.
4. **Expirarea:** cele 4 cazuri de la §3.6 (inclusiv ziua de azi, ca valabil, și miezul nopții în Europe/Bucharest).
5. **Introducerea:** selectorul din Parteneri oferă categoria; salvarea cu un fișier urcat produce o cale validă.
6. **Migrarea** (L15 v2): CHECK-ul schimbat, trigger-ul, cele două RPC-uri noi.
7. **Revenirea:**
   - într-o tranzacție, lock pe `ofertare_parteneri_documente` înaintea verificării;
   - refuz dacă există rânduri `autorizatie_ndt`;
   - restaurează CHECK-ul vechi, apoi scoate trigger-ul și cele două RPC-uri.
   - Ordinea la revenire: întâi UI-ul, apoi edge-ul (ramura `ndt` scoasă), apoi BD-ul.
   - Probe: apply → rollback → re-apply pe PGlite și pe clona 176; după rollback, Parteneri și sudorii din CTC merg ca înainte.

## 6. Livrare

- Un PR, cu:
  - migrarea (CHECK + trigger + 2 RPC-uri, NEAPLICATĂ) și revenirea;
  - edge-ul extins (NEDEPLOYAT);
  - ecranul CTC și selectorul din Ofertare → Parteneri;
  - probe PGlite cu mutanți și teste pentru edge.
- Review Jakarinos.
- Aplicarea migrării și deploy-ul edge-ului: doar cu „da”-ul owner-ului.
- După livrare: TKT-2026-0389 primește completarea în `descriere_interventie`, iar colegul de la CTC primește un mail (draft + „trimite”).
