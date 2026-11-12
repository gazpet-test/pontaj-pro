# Drepturile contului nelogat (`anon`): analiză și curățenie în trei trepte

**Stare:** DRAFT, nimic aplicat. E o schimbare de drepturi: fiecare treaptă se aplică doar cu „da”-ul owner-ului, după review.
**Fișiere:** migrările `20261218a` (T1), `20261218b` (T2), `20261218c` (T3) cu revenirile lor din `supabase/revenire/`, scriptul doar de citire
`scripts/anon_drepturi_citire.sql`, proba locală `scripts/pglite/test_anon_drepturi_local.mjs`, testul static `src/anonDrepturi.test.js`.

## 1. Pe scurt

- **Ce e `anon`:** rolul cu care ajunge în bază orice cerere făcută **fără cont**: pagina QR a șoferului, formularele publice, linkurile din
  mailuri. Cheia publică a aplicației e în orice browser, deci oricine poate face o astfel de cerere.
- **Ce are azi:** drepturi pe aproape toate tabelele, vederile și secvențele din schema `public`. Le are din setările implicite ale bazei
  (orice tabel nou le primește automat), nu pentru că le-ar folosi cineva.
- **De ce nu e o breșă azi:** toate tabelele au RLS pornit și nicio politică nu-l lasă pe `anon` să vadă sau să scrie vreun rând (cele care îl
  includ cer toate un cont logat). Vederile citesc cu drepturile celui care întreabă. Paginile publice merg doar prin funcții controlate.
- **Ce câștigăm:**
  - un strat de apărare în plus: dacă mâine o politică e scrisă greșit, `anon` tot nu are drept pe tabel;
  - tabelele noi nu mai primesc automat drepturi pentru `anon` (T3);
  - review-urile nu mai „îngheață” în baseline drepturi inutile pentru `anon` (semnalat la PR #1071, #1075, #1077, #1080).
- **Riscul general:** dacă ne-am înșelat și ceva chiar folosește un drept retras, acel lucru primește „nu ai drept” (eroare 42501 / 401) în loc
  de listă goală. Se repară cu revenirea treptei, care reface **exact** ce s-a retras.

## 2. Cine folosește de fapt `anon` (pct. 1, din cod)

Paginile fără login (`src/App.jsx:9002-9012`): `/login`, `/q/:id`, `/co`, `/rsvp/:token/:status`, `/redari/raspuns/:token`,
`/redari/informare`, `/aplica`. Fiecare acces făcut cu cheia publică, fără sesiune:

| Obiect | Operație | De unde | De ce merge fără drepturi pe tabele |
|---|---|---|---|
| `fn_sedinte_rsvp_submit` | RPC | `src/RsvpSedintaPage.jsx:23` | SECURITY DEFINER (citirea verifică `RPC_PUBLIC`) |
| `fn_red_formular_public` | RPC | `src/RedariRaspunsPublic.jsx:129` | SECURITY DEFINER (`20261126a`) |
| `fn_red_raspuns_public` | RPC | `src/RedariRaspunsPublic.jsx:161` | SECURITY DEFINER (`20261126a`) |
| `fn_red_informare_publicata` | RPC | `src/RedariInformarePublic.jsx:33` | SECURITY DEFINER (`20261130m`) |
| edge `qr-utilaj-info`, `qr-alimentare-submit`, `qr-bon-comun-lookup`, `rag-utilaj` | HTTP | `src/QrUtilajPage.jsx:35-74` | funcții edge (cod doar live); nu ating tabelele ca `anon` |
| edge `concediu-mobil` | HTTP | `src/ConcediuMobilPage.jsx:41-62` | funcție edge (cod doar live) |
| edge `recrutare-aplica` | HTTP | `src/AplicaPublic.jsx:25,33` | funcție edge cu `service_role` |
| edge `ingest-document` (script Google) | HTTP | `scripts/apps_script_ingestie_gmail.js:85` | funcție edge cu `service_role` |
| `/login` | doar autentificare | `src/App.jsx:1213` | nu atinge tabele |

- `api/`, `supabase/functions/`, `worker/`: cheia publică e folosită doar pentru verificarea utilizatorului sau cu JWT-ul utilizatorului
  transmis mai departe (deci ca `authenticated`, nu ca `anon`). Nicio cerere ca `anon` pe tabele, vederi sau secvențe.
- **Rezultat: niciun tabel, nicio vedere și nicio secvență nu e folosit direct de `anon`.** Lista „păstrate” din regulă e goală. Tot restul e
  candidat la retragere. Dreptul de apel al lui `anon` pe cele 4 RPC-uri **nu se atinge** (funcțiile nu sunt în aceste trepte).
- Edge-urile care au cod doar live nu pot fi citite din repo. Dacă vreunul ar interoga tabele ca `anon`, azi ar primi oricum 0 rânduri (RLS),
  deci pagina n-ar funcționa. Confirmarea se face prin citire, în secțiunea `STATISTICI` (interogările rulate ca `anon`).

## 3. Treptele

Regula e una singură (blocul `REGULA_ANON v1`, identic în citire și în cele trei migrări). Se aplică pe obiectele lui `postgres` din `public`,
cu drepturi acordate de `postgres`. Restul apare la „rămâne”, cu motivul.

### T1: secvențele (`20261218a`)
- **Ce face:** retrage de la `anon` drepturile pe secvențele din `public`. Excepție: secvențele din DEFAULT-ul tabelelor în care `anon` poate
  insera, adică cele folosite de o pagină publică (azi niciunul) sau cele cu o politică INSERT / ALL pentru `anon` / PUBLIC. Sunt păstrate prudent,
  chiar dacă politicile de azi cer toate cont. INSERT-ul pe o coloană IDENTITY nu cere drept pe secvență, deci acelea nu sunt excepții.
  Creează și jurnalul comun al treptelor (schemă separată, neexpusă, fără drepturi pentru nimeni în afară de `postgres`).
- **Ce se strică dacă greșim:** un INSERT făcut direct ca `anon` într-un tabel cu `serial` ar da 42501 pe secvență. Azi nu există niciunul.
- **Verificare înainte (citire):** `OBIECT` (lista T1), `POLITICI_ANON`, `STATISTICI` (niciun INSERT direct ca `anon`).
- **Risc:** foarte mic.

### T2: tabelele și vederile fără nicio politică pentru `anon` (`20261218b`)
- **Ce face:** retrage de la `anon` toate drepturile (pe obiect și pe coloane) pe tabelele fără politici pentru `anon` / PUBLIC și pe vederi.
  Tabelele cu politici pentru `anon` / PUBLIC rămân neatinse (vezi §4).
- **Ce se strică dacă greșim:** o cerere fără cont pe un astfel de obiect primește 42501 / 401 în loc de listă goală. Același lucru pentru o
  funcție fără SECURITY DEFINER apelată de `anon` care citește un obiect retras.
- **Verificare înainte (citire):** `SIMULARE` (ce vede `anon` azi: așteptat 0 obiecte cu rânduri vizibile), `FUNCTII_ANON` (funcțiile apelabile
  de `anon` fără DEFINER: niciuna folosită de o pagină publică), `STATISTICI` și jurnalele API (cereri `/rest/v1` fără utilizator).
- **Risc:** mic. E câștigul principal.

### T3: drepturile implicite (`20261218c`)
- **Ce face:** tabelele, vederile și secvențele **noi** create de `postgres` în `public` nu mai primesc drepturi pentru `anon`. Sonda din
  migrare creează un tabel și o vedere, verifică și le șterge.
- **Ce se strică dacă greșim:** nimic din ce există azi. O funcționalitate publică nouă care chiar are nevoie de `anon` pe un tabel trebuie să
  dea dreptul explicit în migrarea ei. Asta se revizuiește oricum.
- **Regula pentru migrările noi (după T2 / T3):** fără `GRANT ... TO anon`, decât pentru un acces public revizuit. Acel obiect intră și în lista
  pct. 1 a regulii, ca o citire ulterioară să nu-l propună la retragere.
- **Ce rămâne:** drepturile implicite ale lui `supabase_admin` (platforma) nu se pot schimba ca `postgres`, deci obiectele create de platformă
  în `public` (rar) ar primi drepturi pentru `anon`. **Control periodic:** după fiecare migrare (și lunar) se rulează scriptul de citire.
  Orice rând nou în T1 / T2 / T3 la `OBIECT` = un obiect cu drepturi pentru `anon` apărut între timp, de analizat. Controlul se poate muta în
  poarta automată a runnerului (cere aprobare separată).
- **Risc:** foarte mic.

## 4. Ce rămâne pentru `anon` după toate treptele

- tabelele cu politici pentru `anon` / PUBLIC (azi toate cer cont) și secvențele celor cu politică INSERT / ALL. Se pot retrage într-o treaptă
  ulterioară, cu o migrare separată, după ce `POLITICI_ANON` + `SIMULARE` arată că nu dau nimic fără cont;
- obiectele altui proprietar și drepturile implicite ale lui `supabase_admin`;
- dreptul de apel pe funcții (inclusiv cele 4 RPC-uri publice): în afara treptelor, îl urmărește controlul 0e al runnerului.

Secțiunea `RAMANE` a citirii dă numerele exacte după fiecare treaptă.

## 5. Cum se aplică și cum revenim

- **Cum se aplică:** fiecare treaptă e o livrare separată, prin runner, **doar cu plafonul de 2000 ms**. `20261218a` e prima (creează jurnalul).
  `20261218b` și `20261218c` cer jurnalul, dar nu se cer una pe alta.
- **Lista nu e scrisă de mână:** migrarea o calculează din catalog și o compară cu BASELINE-ul (număr de obiecte + amprenta listei) scos din
  producție de scriptul de citire. Necompletat sau diferit = refuz, nimic schimbat. La refuz, lista de acum apare în NOTICE.
- **Lock-uri:** REVOKE / GRANT iau doar ACCESS SHARE pe fiecare obiect (probat în PGlite) și rândul lui din catalog, până la COMMIT. Nu opresc
  nicio citire sau scriere. Așteaptă doar după un DDL ținut de altă tranzacție (100 ms, apoi refuz). Proba de scară (PGlite: ~400 de secvențe,
  ~520 de tabele / vederi) a durat 100–200 ms pe treaptă, deci nu e nevoie de împărțire. Timpul real se măsoară pe clonă, din NOTICE-ul
  „sfarsit la … ms”: țintă sub 1000 ms; la peste 1500 ms nu se aplică și se împarte.
- **Cum revenim:** revenirea fiecărei trepte reface **exact** drepturile din jurnal (pe obiect și pe coloane, cu acordantul) și verifică după.
  Ordinea: `c` → `b` → `a`. Refuză dacă între timp s-a schimbat ceva ce nu poate reface exact: obiect șters / redenumit, drept nou dat lui `anon`,
  sau `a` cât timp `b` / `c` au rânduri. Revenirea lui `c` nu dă drepturi retroactiv obiectelor create între timp.

### Pașii coordonatorului
1. Producție, doar citire: `scripts/anon_drepturi_citire.sql` (ieșirea rămâne pe server). Se verifică:
   - `RPC_PUBLIC`: toate cu `definer = true` și `anon_execute = true`;
   - `FUNCTII_ANON`: niciuna folosită de paginile publice;
   - `SIMULARE`: 0 relații cu rânduri vizibile;
   - `STATISTICI`: doar apelurile RPC ale paginilor publice;
   - `OBIECT`: lista pe trepte.
   Opțional: jurnalele API pe ultimele zile, cererile `/rest/v1/` fără utilizator.
2. Clonă: rândurile `BASELINE` lipite în migrări → `a` → `b` → `c` prin runner, cu plafon (NOTICE-urile de timp) → citirea din nou (T1 / T2 / T3 = 0)
   → reveniri `c` → `b` → `a` (instantaneul drepturilor = cel de la început) → re-aplicare.
3. Review pe diff-ul cu BASELINE-ul completat. Lista pe obiecte se revizuiește din ieșirea citirii.
4. „Da”-ul owner-ului pentru fiecare treaptă → producție, în ordine. După fiecare: citirea din nou și testul paginilor publice (RSVP, formularul
   și informarea Redări, QR, concediu, aplică), cu Ctrl+Shift+R.

## 6. Recomandare

**Toate trei, în ordinea T1 → T3 → T2, ca livrări separate.**
- T1 și T3 nu ating nimic folosit și opresc reapariția drepturilor.
- T2 e câștigul principal. Merge după o citire în care `SIMULARE` = 0 și `STATISTICI` arată doar RPC-urile publice, apoi testul paginilor publice.
- Tabelele cu politici pentru PUBLIC (§4) rămân pentru o treaptă ulterioară, separată.

## 7. Regulile de review respectate

- **L07** — regula se impune în bază, pe orice cale (dreptul lipsește, nu e doar ascuns în UI).
- **L09** — fiecare obiect e verificat pe oid + nume + tip înainte de REVOKE și la revenire.
- **L14** — o tranzacție prin runner, cu postcondiții; revenire testată aplicare → revenire → re-aplicare. Revenirea refuză la istoric nou (drept
  nou, obiect dispărut, ordinea treptelor).
- **L15** — lista calculată din catalog comparată cu BASELINE-ul din producție, înainte și după. Fără regex pe SQL. Lista e construită din
  catalog cu nume citate (`format('%I.%I')`), într-un singur REVOKE.
- **L20** — sunt testate și căile legitime: RPC-ul DEFINER al paginii publice merge, INSERT-ul permis de politică merge, obiectul declarat la
  pct. 1 rămâne.
- **L25** — verificări independente de regulă (instantaneul complet al drepturilor din catalog, cereri reale ca `anon`), mutanți pe migrări, pe
  reveniri și pe regulă.
