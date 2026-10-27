# Izometrie — avizul de ieșire pe tronson (design, 27.10.2026)

Ecran: Execuție → Izometrie → Gestionar (depozit) → „Ieșire din depozit pe tronson” (`src/IzometrieAprobare.jsx`, `IzometrieGestionar`).
Azi: gestionarul alege depozitul, tastează avizul (CJPT / CJPJ …), data, bifează bucățile → `fn_izo_iesire_tronson` (wrapper peste `fn_izo_iesire_intern`): evenimente `iesire` cu motivul „Aviz <nr>”, jurnal în `izo_operatii`. Nu există număr generat, PDF, semnături sau arhivă.

## Deciziile lui Razvan (27.10.2026)
| # | Întrebare | Decizie |
|---|---|---|
| 1 | Numerotare | **A** — continuăm seriile existente, una pe depozit: CJPJ (DM Jupânești, id 9), CJPT (OS Topleț, id 11), CJPT-O (Orșova, id 10). Numărul de start se fixează la aplicare (preview → „da”); în registru ultimele sunt CJPJ 46, CJPT 29, CJPT-O 71 (doar ce s-a importat). |
| 2 | Șofer | **A** — din angajați SAU „șofer extern” cu nume tastat; fără semnătură salvată → loc gol marcat „se semnează olograf”. |
| 3 | Mașina | **A** — din flota Logistica (`logistica_active.nr_inmatriculare`) SAU nr. tastat (transportator extern). |
| 4 | Kg | **A** — din `magazie_bucati.greutate_kg` (completat pe toate cele 3.382 de bucăți), total pe aviz. |
| 5 | Arhivă | Da — listă de avize, redeschidere / retipărire. |
| 6 | Aviz greșit | Nu se șterge: rămâne cu numărul și se marchează **ANULAT** (motiv obligatoriu). Ieșirea legată se anulează separat, într-o etapă ulterioară. |
| 7 | Schema nouă | OK (contor, legătura aviz ↔ ieșire) — prin harness prodlike, Copilot, DRY, „da”. |

## Schema (migrarea `20261120a_izometrie_aviz_iesire` + revenire)
- **`izo_avize_serii`** (contorul): `depozit_id` PK → `logistica_depozite`, `serie` text UNIQUE, `ultim_nr` int ≥ 0, `activ` bool, `actualizat_la`. Rândurile (seria + numărul de start) se inserează în migrare cu valorile confirmate de Razvan la preview; seria se schimbă doar prin migrare.
- **`izo_avize_iesire`** (avizul, imuabil după emitere în afară de anulare + PDF):
  - `id`, `proiect_id`, `depozit_id`, `tronson_id`, `serie`, `numar` int, `nr_complet` text (`serie || ' ' || lpad(numar,4,'0')`), UNIQUE (`serie`,`numar`);
  - `data_aviz` date, `emis_de` uuid (profile), `emis_de_employee_id` int NULL, `emis_la` timestamptz;
  - `sofer_employee_id` int NULL → employees, `sofer_extern_nume` text NULL (exact unul dintre cele două, CHECK);
  - `vehicul_activ_id` int NULL → logistica_active, `nr_auto` text NOT NULL (copiat din activ sau tastat; normalizat majuscule, fără spații duble);
  - `op_cheie` uuid NOT NULL UNIQUE (cheia operației de ieșire, aceeași cu `izo_operatii.op_id`), `eveniment_ids` bigint[];
  - `continut` jsonb NOT NULL = instantaneu pe rânduri (bucata_id, serie, șarjă, diametru_mm, perete_mm, lungime_mm, greutate_kg), `total_bucati`, `total_m` numeric, `total_kg` numeric;
  - `stare` ∈ {`emis`,`anulat`}, `anulat_motiv`, `anulat_de`, `anulat_la`;
  - `pdf_path` text NULL, `pdf_sha256` text NULL (scris o singură dată).
- RLS: SELECT pentru `authenticated` cu `auth.uid() IS NOT NULL AND fn_izo_citire(proiect_id)` (ca `izo_operatii`); fără INSERT/UPDATE/DELETE direct — doar prin funcții. `izo_avize_serii`: SELECT pe același model prin depozit → site → proiect, fără scriere din API.
- Storage: bucket privat nou **`izo-avize`**, cale `<proiect_id>/<serie>-<numar>.pdf`. Doar politici pe `storage.objects` (fără trigger / ALTER acolo): INSERT doar de emitent, doar pe calea avizului lui și doar cât `pdf_path IS NULL`; SELECT cu `fn_izo_citire(proiect)`; fără UPDATE / DELETE.
- Semnătura șoferului: politica de azi pe `hr-semnaturi` lasă utilizatorul să-și citească doar folderul propriu (HR / owner văd tot). Se adaugă o politică SELECT îngustă: un utilizator poate citi folderul `<employee_id>` doar dacă există un aviz `emis` cu `sofer_employee_id` = acel angajat, pe care îl poate citi (`fn_izo_citire`), emis de el, și **încă fără PDF** (`pdf_path IS NULL`). Fereastra se închide singură după atașarea PDF-ului. Retipărirea folosește PDF-ul stocat, deci nu mai are nevoie de semnătură.

## Funcții (SECURITY DEFINER, `search_path = public, pg_temp`, EXECUTE doar `authenticated`)
1. **`fn_izo_iesire_cu_aviz(p_cheie uuid, p_depozit int, p_tronson bigint, p_bucati bigint[], p_data date, p_sofer_employee int, p_sofer_extern text, p_vehicul int, p_nr_auto text)`**
   - Idempotență ÎNAINTE de alocare: dacă există aviz cu `op_cheie = p_cheie` al aceluiași autor și același hash de cerere → întoarce avizul existent; cheie refolosită cu alt payload → `cheie_refolosita`.
   - Validează șofer (exact unul; angajat activ), vehicul (activ existent) / nr_auto (3–20 caractere), data ≤ azi (Europe/Bucharest).
   - Alocă numărul: `UPDATE izo_avize_serii SET ultim_nr = ultim_nr + 1 WHERE depozit_id = p_depozit AND activ RETURNING serie, ultim_nr` (blocare pe rând ⇒ fără dubluri; fără serie activă ⇒ `fara_serie`).
   - Apelează `fn_izo_iesire_intern(p_cheie, p_depozit, p_tronson, p_bucati, nr_complet, p_data)` în ACEEAȘI tranzacție: orice refuz face rollback și pe contor ⇒ fără găuri de numerotare. Autorizarea și toate verificările ieșirii rămân cele existente (neschimbate).
   - Inserează avizul cu instantaneul bucăților (după ieșire, din `magazie_bucati`) și întoarce `{cod:'iesit', aviz:{id, nr_complet, …}, eveniment_ids}`.
2. **`fn_izo_aviz_pdf_ataseaza(p_aviz bigint, p_path text, p_sha256 text)`** — doar emitentul (sau owner), o singură dată, calea trebuie să fie exact `<proiect>/<serie>-<numar>.pdf`.
3. **`fn_izo_aviz_anuleaza(p_aviz bigint, p_motiv text)`** — gestionarul autorizat pe depozit (aceeași regulă ca la ieșire) sau owner; motiv 3–1000; idempotent pe aviz deja anulat cu același motiv. NU atinge evenimentele de ieșire.
- `fn_izo_iesire_tronson` (manual) rămâne neschimbat în această etapă; UI-ul nu-l mai folosește.
- Fiind `fn_izo_*` noi, se schimbă amprentele E2a / porți: migrarea verifică baseline-ul exact și actualizează COMMENT-urile după regula din lecția #1818 (ca 20261109b); revenirea le restaurează.

## UI (`IzometrieGestionar` + fișiere noi `src/izoAvizIesire.jsx`, `src/lib/izoAviz.js`)
1. **Căutare** deasupra listei: serie / șarjă / DN / perete, filtrare live; bifele rămân pe bucățile ascunse; contor „X selectate · Y m · Z kg”; „Selectează tot ce se vede” / „Golește”.
2. Câmpul „Aviz CJPT / CJPJ” dispare; se arată „Nr. aviz: se alocă automat (următorul: CJPJ 0047)” din `izo_avize_serii`.
3. Șofer: listă de angajați activi (șoferii primii) + bifă „șofer extern” → nume. Mașina: listă din flotă (nr. înmatriculare) + „alt număr” → text.
4. Butonul „Emite avizul și înregistrează ieșirea” → RPC → generează PDF (html → html2canvas → jsPDF A4, ca în Achiziții) → upload `izo-avize` → `fn_izo_aviz_pdf_ataseaza` → previzualizare + Print. Dacă upload-ul pică, avizul e deja emis; în arhivă apare „PDF lipsă — regenerează” (doar emitentul).
5. PDF: antet firmă (`logistica_setari` `firma_*`, ca avizul din Logistica), „AVIZ DE ÎNSOȚIRE A MĂRFII nr. CJPJ 0047 / data”, de la depozit → tronson / proiect, tabel (nr. crt, serie, șarjă, DN × perete, lungime m, kg), totaluri (bucăți, m, kg), șofer + nr. auto, semnături Gestionar (semnătura proprie salvată) și Șofer (salvată sau loc gol „se semnează olograf”). Anulat → filigran „ANULAT” doar în vizualizare (PDF-ul stocat rămâne cel emis).
6. **Arhiva avizelor** (secțiune nouă în ecranul Gestionar, vizibilă și MP / owner prin `fn_izo_citire`): filtre depozit / tronson / perioadă / stare, coloane nr, data, tronson, bucăți, m, kg, șofer, stare; „Deschide PDF”, „Anulează” (cu motiv).
- `Logistica.jsx` NU se modifică (doar model). Semnăturile se citesc cu un helper local (`src/lib/izoSemnaturi.js`) după modelul `getSemnaturaDataURL` din `Achizitii.jsx` (signed URL → dataURL).

## Teste
- Harness prodlike PG16 (lanț peste `scripts/test_izometrie_e4b.sh`): numerotare concurentă (2 sesiuni → numere distincte, consecutive), refuz ieșire ⇒ contor neschimbat, idempotență (aceeași cheie → același aviz, fără număr nou), cheie refolosită, șofer / vehicul invalid, PDF atașat o singură dată și doar pe calea corectă, anulare (doar autorizat, motiv), politica de semnătură (citire permisă doar în fereastră, refuz după PDF, refuz pentru alt utilizator), revenire exactă, poarta `0e`.
- Vitest: filtrarea și contorul, construirea cererii, randarea PDF-ului (fără rețea).

## În afara etapei
Anularea ieșirii (storno) legată de avizul anulat; avizele de retur rest; trimitere pe mail (exclus: fără mail automat).
