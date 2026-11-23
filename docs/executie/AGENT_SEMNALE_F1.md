# Agentul verificator — faza 1: semnalele în ERP (migrarea 20270106a, NEAPLICATĂ)

Decizia de design: Tema 1 din dezbaterea cu Jakarinos („bun cu schimbări”). Agentul de noapte (serverul AI) verifică proiectele din Execuție
și scrie DOAR semnale; oamenii le văd și acționează. Faza 1 = infrastructura din ERP (tabel, drepturi, RPC-uri, ecran). Regulile de verificare
(ce document dovedește ce obligație, pragurile) le scrie coordonatorul separat, cu validarea responsabilului operațional; pilot: un proiect
Transgaz cu ordin de începere, apoi încă unul. Agentul NU atașează documente și NU scrie în alte tabele: are EXECUTE doar pe `fn_executie_semnal_scrie`.

## Ce e un semnal
Un rând în `executie_semnale`, unic pe **(proiect, tip, obiect)** — aceeași problemă actualizează semnalul, nu creează altul.

| câmp | ce înseamnă |
|---|---|
| `flux` | `lipsuri` / `tichete` / `corespondenta` (cele trei execuții izolate ale agentului) |
| `tip` | cod stabil, `^[a-z][a-z0-9_]{1,59}$` (ex. `termen_apropiat`, `document_negasit`, `camp_lipsa_erp`, `polita_expira`); un tip stă pe un singur flux |
| `obiect` | ce anume (ex. `contract:termen`, `polita:GBE`, `camp:nr_contract`), stocat DOAR în forma canonică `fn_executie_semnal_spatii` (vezi mai jos): RPC-ul o aplică, iar CHECK-ul `executie_semnale_obiect_ck` o cere pe orice cale — ` polita:GBE`, NBSP + `polita:GBE`, `polita:` + U+200B + `GBE` sunt același semnal (același id), nu rânduri noi. Literele contează (`polita:gbe` ≠ `polita:GBE`), un spațiu interior contează (`polita: GBE` ≠ `polita:GBE`); doar spațiu alb / caractere fără lățime = refuz 22023 |
| `gravitate` | `info` / `atentie` / `critic` |
| `titlu`, `detalii` | pentru om |
| `constatare` | `constatat` (cu dovadă) · `negasit_in_surse` (documentul NU a fost găsit în sursele consultate — NU înseamnă că lipsește) · `camp_lipsa` (câmp gol în ERP) — vezi contractul dovezii mai jos |
| `dovada_sursa` / `dovada_data` / `dovada_fragment` / `dovada_ref` | sursa (`document` / `mail` / `camp_erp`), data sursei, fragmentul scurt, linkul sau calea NAS |
| `dovada_amprenta` | md5 CANONIC al dovezii, pus de SERVER; decide „dovadă nouă” (ordinea / spațiul alb / majusculele / dublurile surselor consultate și spațiul alb din fragment / referință NU sunt dovadă nouă). Spațiul alb = O SINGURĂ funcție, `fn_executie_semnal_spatii`, în trei pași: 1. caracterele de format fără lățime (U+200B–U+200F, U+202A–U+202E, U+2060–U+2064, U+2066–U+2069, BOM U+FEFF, cratima moale U+00AD) se ELIMINĂ (nu sunt spațiu: `a<U+200B>b` = `ab`); 2. orice șir de spațiu alb — spațiu, tab, newline, CR, NBSP, U+2007, U+202F și celelalte spații Unicode — devine un spațiu; 3. capetele se taie (ordinea inversă lăsa un `\n` de la capete ca spațiu). Aceeași funcție normalizează cheia `obiect` și textele dovezii stocate de RPC (fragment, referință, surse) |
| `termen`, `termen_baza`, `termen_confirmat` | termenul identificat, baza calculului (OBLIGATORIE la termen confirmat), dacă e confirmat |
| `incertitudine`, `propunere` | explicația incertitudinii; ce propune agentul |
| `responsabil_employee_id`, `responsabil_sursa` | angajatul titular; `agent` (propus) sau `om` (stabilit SAU confirmat explicit de om — inclusiv „fără responsabil”, id NULL — agentul nu-l mai schimbă) |
| `stare` | `nou` → `in_lucru` / `asteapta_informatii` → `rezolvat` / `respins` (omul); `rezolvat` / `respins` → `nou` doar agentul, doar cu dovadă nouă |
| `stare_motiv`, `stare_dovada`, `actiune_ref`, `stare_de`, `stare_la` | decizia omului: motivul, dovada rezolvării / respingerii, legătura cu tichetul / acțiunea, cine, când; rezolvarea cere motiv + dovada SAU acțiunea |

### Contractul dovezii (CHECK `executie_semnale_constatare_ck` / `_termen_ck`, scrise cu `IS NULL` / `IS NOT NULL` / `IS DISTINCT FROM`, fără rezultat UNKNOWN)
| constatare | obligatoriu |
|---|---|
| `constatat` | `dovada_sursa` + `dovada_data` + `dovada_fragment` (calea / linkul singure nu dovedesc nimic; `dovada_ref` opțional) |
| `negasit_in_surse` | `surse_consultate` (≥ 1) + OBLIGAȚIA care cere documentul: `dovada_sursa` + `dovada_data` + `dovada_fragment` (clauza din contract / ordin), `dovada_ref` opțional. „Negăsit” fără obligație e zgomot, nu semnal; ecranul arată ambele |
| `camp_lipsa` | `dovada_sursa = 'camp_erp'` + `dovada_ref` (câmpul); data / fragmentul opționale |
| termen | fără termen = fără bază / confirmare; cu termen = `termen_confirmat` decis explicit; `termen_confirmat = true` cere `termen_baza` |

Cele 13 semnale ale testului „pe hârtie” al pilotului (sintetizate, fără date personale) stau în `scripts/pglite/executie_semnale_pilot.mjs` și se scriu
real prin RPC în proba PGlite (toate `creat`; fiecare piesă scoasă = refuz 23514); a doua rulare = 13 × `neschimbat`.
| `regula_versiune` | versiunea regulii care a produs semnalul |
| `detectat_la`, `ultima_verificare`, `versiune` | prima detectare; ultima rulare care l-a confirmat; versiunea rândului (CAS pentru ecran). `versiune` crește la ORICE scriere pe rând (garda), deci și la `neschimbat` / `neschimbat_inchis` (se scrie `ultima_verificare`): un formular deschis peste rularea de noapte primește „conflict” și ecranul reîncarcă; jurnalul NU crește la aceste două răspunsuri |

Jurnal doar-adăugare `executie_semnale_jurnal`: `creat` / `actualizat` / `redeschis` (agent), `stare` / `responsabil` (om), cu diferențele `{câmp: [vechi, nou]}`.

## Drepturile (o singură funcție, `fn_executie_semnal_drept`)
Citire = owner SAU managerul de proiect (`profiles.employee_id = executie_proiecte.mp_employee_id`) SAU responsabilul semnalului, TOȚI și cu
restricția pe proiect din 20261209a (`fn_executie_proiect_permis`). Schimbarea stării / responsabilului = aceiași. Un cont cu acces general pe
modul (viewer / editor / admin) sau șeful de șantier NU vede semnalele (0 rânduri) dacă nu e owner / MP / responsabil.

## RPC-ul agentului: `fn_executie_semnal_scrie(p_semnal jsonb)` — EXECUTE exclusiv `service_role`, fără JWT de utilizator
Cheile EXACTE (necunoscute = refuz 22023): `proiect_id`, `flux`, `tip`, `obiect`, `gravitate`, `titlu`, `constatare`, `regula_versiune`
(obligatorii) + `detalii`, `surse_consultate` (listă de texte), `dovada_sursa`, `dovada_data` (`AAAA-LL-ZZ`), `dovada_fragment`, `dovada_ref`,
`termen`, `termen_baza`, `termen_confirmat`, `incertitudine`, `propunere`, `responsabil_employee_id` (opționale; `null` = lipsă).
Cheia (proiect, tip, obiect) se compară pe forma canonică a lui `obiect` (`fn_executie_semnal_spatii`); `tip` e un cod ASCII strict (CHECK-ul lui
nu lasă niciun spațiu sau caracter fără lățime, deci nu are formă necanonică).
Răspuns `{ok, actiune, id, stare, versiune}` cu `actiune` ∈ `creat` · `actualizat` (ceva s-a schimbat, diferențele în jurnal) · `neschimbat`
(doar `ultima_verificare`; `versiune` + 1, fără jurnal) · `redeschis` (semnal închis de om, dovadă NOUĂ → `nou`) · `neschimbat_inchis` (semnal închis
de om, aceeași dovadă → NU reapare; doar `ultima_verificare`, `versiune` + 1, fără jurnal). Agentul nu poate atinge starea / motivul / dovada / acțiunea omului și nici responsabilul stabilit / confirmat de om; gărzile stau în BD
(trigger BEFORE), nu doar în RPC. `surse_consultate` se stochează în ordinea formei canonice, fără dubluri (aceeași listă în altă ordine =
`neschimbat`, nu `actualizat`); „dovadă nouă” = altă constatare / sursă / dată / fragment / cale sau o sursă consultată în plus / în minus.

Exemplu: `select fn_executie_semnal_scrie('{"proiect_id": 12, "flux": "lipsuri", "tip": "termen_apropiat", "obiect": "contract:termen", "gravitate": "atentie",
"titlu": "Termenul contractului se apropie", "constatare": "constatat", "dovada_sursa": "camp_erp", "dovada_data": "2026-11-21", "dovada_fragment": "data_termen = 2026-12-11",
"dovada_ref": "executie_proiecte.data_termen", "termen": "2026-12-11", "termen_baza": "câmpul data_termen", "termen_confirmat": true, "propunere": "Verificați dacă e nevoie de act adițional.",
"regula_versiune": "lipsuri-v1"}'::jsonb)`.

## RPC-ul omului: `fn_executie_semnal_stare(p_id, p_versiune, p_stare, p_motiv, p_dovada, p_actiune_ref, p_responsabil, p_schimba_responsabil)`
EXECUTE `authenticated`; dreptul de mai sus, verificat după lock; CAS pe `versiune` (`{ok: false, motiv: 'conflict', semnal}` = ecranul reîncarcă).
Rezolvarea cere motiv + dovada rezolvării SAU acțiunea rezultată; respingerea și redeschiderea cer motiv. `p_stare` NULL = starea rămâne (și
textele ei). `p_schimba_responsabil = true` aplică `p_responsabil` ca DECIZIE a omului (`responsabil_sursa = 'om'`): și când e același angajat
propus de agent (confirmare), și când e NULL („fără responsabil”); confirmarea fără altă schimbare e permisă (nu „nimic de schimbat”), iar o a
doua confirmare identică e „nimic de schimbat”. Omul nu poate pune înapoi `agent` și nu poate șterge confirmarea (garda le forțează la `om`).

Ecranul clasifică răspunsul RPC-ului (L05, `clasificaRaspunsStare`): doar un refuz HTTP 4xx (fără 408) e „nu s-a salvat”; eroarea de rețea
(status 0), 408, 5xx sau un corp neașteptat = rezultat NECUNOSCUT (tranzacția poate fi comisă, răspunsul pierdut) → formularul se închide, lista se
reîncarcă și omul verifică semnalul înainte să reia (nicio retrimitere automată).

## Ecranul
Execuție → proiect → fila „🔔 Semnale” (`src/ExecutieSemnale.jsx`); pentru owner, în Execuție → Proiecte, panoul „🔔 Semnale — toate proiectele”
(închis implicit). Filtre: gravitate, stare, flux, text, „arată și rezolvate / respinse”; sortare după termen sau gravitate; detalii cu dovada,
propunerea, decizia și istoricul; formular de schimbare a stării (motiv, dovadă, acțiune) și a responsabilului.

## Probe
`node scripts/pglite/test_executie_semnale_local.mjs` (PGlite, pașii reali L15 v2; drepturi pe 9 conturi, dedup, contractul dovezii, amprenta
canonică, confirmarea responsabilului, respins nu reapare, agentul nu atinge starea omului, pilotul cu 13 semnale, revenirea pe definiții
(blocul DEFINITII, regenerat cu `--scrie-definitii`; lista L15 cu `--scrie-obiecte`), spațiul alb din amprentă (newline / tab / NBSP la capete și în
mijloc pe respins / rezolvat / deschis = aceeași dovadă), cheia `obiect` canonică (reproducerea Jakarinos r3: `polita:GBE` respins, retrimis cu NBSP /
U+202F / U+200B la capete și în mijloc = același id, `neschimbat_inchis`; cheie cu spațiu interior; forma necanonică refuzată de CHECK pe calea
directă), 59 de mutanți, paritatea tranzițiilor, dry-run-ul pentru clonă D0–D6),
`npx vitest run src/executieSemnaleLogica.test.js src/ExecutieSemnale.test.jsx src/ExecutieSemnaleMutanti.test.jsx` (ultimul: mutanții JS ai
clasificării răspunsului RPC — orice eroare / 408 / 5xx / status lipsă = refuz, corp fără semnal = ok —, ai afișării obligației / datei și ai
ecranului — rezultatul necunoscut tratat ca „nu s-a salvat”, fără reîncărcare, excepția clientului ca refuz, dovada fără obligație —, fiecare
TREBUIE să pice). Pe clonă: `supabase/tests/20270106a_executie_semnale_dryrun.sql` (după aplicarea prin runner).

## Ce NU e în faza 1 (faza 2, coordonatorul)
Regulile de verificare și sursele permise ale fiecărui flux; agentul propriu-zis (programare, credențiale `service_role` pe server, limite de
consum, reluare); fișa de securitate în registrul automatizărilor; recapitularea de dimineață; pragurile de evaluare ale pilotului (semnale utile,
timp economisit minus timpul de verificare, dubluri, cost pe semnal util).
