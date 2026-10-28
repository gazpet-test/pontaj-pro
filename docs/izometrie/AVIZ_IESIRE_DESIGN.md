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
| 8 | Semnătura șoferului (după Copilot r1) | Șofer angajat → semnătura salvată (dacă există); șofer extern → olograf. |
| 9 | Felul avizului (după Copilot r1) | **A** — transfer intern Gazpet (depozit → front de lucru) implicit, cu bifă „destinatar extern” (denumire, CUI, adresă tastate). |

## Schema (migrarea `20261120a_izometrie_aviz_iesire` + revenire)
- **`izo_avize_serii`** (contorul): `depozit_id` PK → `logistica_depozite`, `serie` text UNIQUE, `ultim_nr` int ≥ 0, `activ` bool, `actualizat_la`. Rândurile (seria + numărul de start) se inserează în migrare cu valorile confirmate de Razvan la preview; seria se schimbă doar prin migrare.
- **`izo_avize_iesire`** (avizul, imuabil după emitere în afară de anulare + PDF):
  - `id`, `proiect_id`, `depozit_id`, `tronson_id`, `serie`, `numar` int, `nr_complet` text (`serie || ' ' || lpad(numar,4,'0')`), UNIQUE (`serie`,`numar`);
  - `data_aviz` date, `emis_de` uuid (profile), `emis_de_employee_id` int NULL, `emis_la` timestamptz;
  - `sofer_employee_id` int NULL → employees, `sofer_extern_nume` text NULL (exact unul dintre cele două, CHECK);
  - `sofer_confirmat` bool NOT NULL — gestionarul bifează „șoferul a fost prezent și a confirmat preluarea”; fără bifă, semnătura salvată NU se aplică și locul rămâne olograf (P2-05);
  - `semnatura_pana_la` timestamptz NULL — fereastra de citire a semnăturii șoferului (vezi Storage);
  - `destinatar_tip` ∈ {`intern`,`extern`}; la `extern`: `destinatar_denumire`, `destinatar_cui`, `destinatar_adresa` NOT NULL (CHECK); `motiv` text NOT NULL (implicit „Transfer intern — materiale puse la dispoziție de beneficiar”; la extern „Livrare către <denumire>”);
  - `vehicul_activ_id` int NULL → logistica_active, `nr_auto` text NOT NULL (copiat din activ sau tastat; normalizat majuscule, fără spații duble);
  - `op_cheie` uuid NOT NULL UNIQUE (cheia operației de ieșire, aceeași cu `izo_operatii.op_id`), `hash_cerere` text NOT NULL (sha256 pe payload-ul canonic al cererii), `eveniment_ids` bigint[];
  - `antet` jsonb NOT NULL = instantaneul datelor de identificare folosite pe PDF (firma din `logistica_setari` `firma_*`, proiect, beneficiar, contract, depozit, tronson) — retipărirea nu schimbă istoricul (P2-02);
  - `continut` jsonb NOT NULL = instantaneu pe rânduri (bucata_id, serie, șarjă, diametru_mm, perete_mm, lungime_mm, greutate_kg), `total_bucati`, `total_m` numeric, `total_kg` numeric;
  - `stare` ∈ {`emis`,`anulat`}, `anulat_motiv`, `anulat_de`, `anulat_la`;
  - `pdf_path` text NULL, `pdf_etag` text NULL, `pdf_bytes` bigint NULL, `pdf_atasat_la` (scrise o singură dată, atomic, din `storage.objects`, nu din browser).
- RLS: SELECT pentru `authenticated` cu `auth.uid() IS NOT NULL AND fn_izo_citire(proiect_id)` (ca `izo_operatii`); fără INSERT/UPDATE/DELETE direct — doar prin funcții. `izo_avize_serii`: SELECT pe același model prin depozit → site → proiect, fără scriere din API.
- Storage: bucket privat nou **`izo-avize`**, cale `<proiect_id>/<serie>-<numar>.pdf`. Doar politici pe `storage.objects` (fără trigger / ALTER acolo): INSERT doar de emitent, doar pe calea avizului lui și doar cât `pdf_path IS NULL`; SELECT cu `fn_izo_citire(proiect)`; fără UPDATE / DELETE.
- Semnătura șoferului (P1-02): politica de azi pe `hr-semnaturi` lasă utilizatorul să-și citească doar folderul propriu (HR / owner văd tot). Se adaugă o politică SELECT îngustă, pe **obiectul exact**: `name` = `fisier_path` al rândului activ (`activ AND deleted_at IS NULL`) din `hr_semnaturi_electronice` pentru `sofer_employee_id`, numai dacă există un aviz cu: `emis_de = auth.uid()`, `stare = 'emis'`, `sofer_confirmat`, `pdf_path IS NULL`, `semnatura_pana_la > now()` și `fn_izo_citire(proiect_id)` adevărat acum. Predicatul stă într-un helper `fn_izo_aviz_semnatura_permisa(bucket, name)` (SECURITY DEFINER, STABLE). Fereastra = 10 minute de la emitere; dacă generarea PDF pică, emitentul o redeschide cu `fn_izo_aviz_fereastra_semnatura(p_aviz)` (doar el, doar cât PDF-ul lipsește, +10 minute, jurnalizat). Clientul cere signed URL de 60 s și nu păstrează semnătura în cache persistent. Retipărirea folosește PDF-ul stocat.

## Funcții (SECURITY DEFINER, `search_path = public, pg_temp`, EXECUTE doar `authenticated`)
1. **`fn_izo_iesire_cu_aviz(p_cheie uuid, p_depozit int, p_tronson bigint, p_bucati bigint[], p_data date, p_sofer_employee int, p_sofer_extern text, p_sofer_confirmat boolean, p_vehicul int, p_nr_auto text, p_destinatar jsonb)`** — `p_destinatar` = `{"tip":"intern"}` sau `{"tip":"extern","denumire","cui","adresa"}` (chei exacte, lungimi limitate); `semnatura_pana_la` = now() + 10 min doar pentru șofer angajat cu `p_sofer_confirmat`; `antet` se compune pe server (firma, proiect, beneficiar, contract, depozit, tronson, destinatar, motiv).
   - Idempotență sub lock (P1-01): ÎNTÂI `pg_advisory_xact_lock(hashtextextended('izo.aviz|'||fn_izo_uid()||'|'||p_cheie,0))` — aceeași cheie canonică pe care o folosește `fn_izo_iesire_intern` pentru ieșire se ia după, deci ordinea e mereu aviz-cheie → serie → (în `fn_izo_iesire_intern`) cheia ieșirii → locuri → bucăți. Sub lock: recitește avizul cu `op_cheie = p_cheie`: același autor + același `hash_cerere` → întoarce avizul existent (fără număr nou); alt autor sau alt hash → `cheie_refolosita`. Numai pentru cheie nouă se trece la validări și alocare. „Fără găuri” = tranzacțiile eșuate nu consumă numere; numerele anulate rămân ocupate.
   - Validează șofer (exact unul; angajat activ), vehicul (activ existent) / nr_auto (3–20 caractere), data ≤ azi (Europe/Bucharest).
   - Alocă numărul: `UPDATE izo_avize_serii SET ultim_nr = ultim_nr + 1 WHERE depozit_id = p_depozit AND activ RETURNING serie, ultim_nr` (blocare pe rând ⇒ fără dubluri; fără serie activă ⇒ `fara_serie`).
   - Apelează `fn_izo_iesire_intern(p_cheie, p_depozit, p_tronson, p_bucati, nr_complet, p_data)` în ACEEAȘI tranzacție: orice refuz face rollback și pe contor ⇒ fără găuri de numerotare. Autorizarea și toate verificările ieșirii rămân cele existente (neschimbate).
   - Inserează avizul cu instantaneul bucăților (după ieșire, din `magazie_bucati`) și întoarce `{cod:'iesit', aviz:{id, nr_complet, …}, eveniment_ids}`.
2. **`fn_izo_aviz_pdf_ataseaza(p_aviz bigint)`** (P1-03) — doar emitentul; `SELECT … FOR UPDATE` pe aviz; calea e calculată de server (`<proiect>/<serie>-<numar>.pdf`), nu primită; citește din `storage.objects` (bucket `izo-avize`, acel `name`): obiectul trebuie să existe, `owner_id` = emitentul, `metadata->>'mimetype'` = `application/pdf`, mărime 1 KB–10 MB; scrie atomic `pdf_path`, `pdf_etag` (`metadata->>'eTag'`), `pdf_bytes`. Reapel cu același obiect → idempotent; obiect diferit de cel atașat → `conflict`. Obiectul nu se poate înlocui: politica Storage permite doar INSERT (fără upsert / UPDATE / DELETE), deci conținutul atașat e cel încărcat prima dată, iar eTag-ul îl dă Storage, nu browserul. PDF-ul se construiește în client DOAR din rândul avizului recitit după RPC (`continut` + `antet`), nu din starea formularului.
3. **`fn_izo_aviz_anuleaza(p_aviz bigint, p_motiv text)`** — gestionarul autorizat pe depozit (aceeași regulă ca la ieșire) sau owner; motiv 3–1000; idempotent pe aviz deja anulat cu același motiv. NU atinge evenimentele de ieșire.
- `fn_izo_iesire_tronson` (manual) rămâne neschimbat în această etapă; UI-ul nu-l mai folosește.
- Fiind `fn_izo_*` noi, se schimbă amprentele E2a / porți: migrarea verifică baseline-ul exact și actualizează COMMENT-urile după regula din lecția #1818 (ca 20261109b); revenirea le restaurează.

## UI (`IzometrieGestionar` + fișiere noi `src/izoAvizIesire.jsx`, `src/lib/izoAviz.js`)
1. **Căutare** deasupra listei: serie / șarjă / DN / perete, filtrare live; bifele rămân pe bucățile ascunse; contor „X selectate · Y m · Z kg”; „Selectează tot ce se vede” / „Golește”. Înainte de emitere, rezumatul arată TOATE bucățile bifate (inclusiv cele ascunse de filtru); schimbarea depozitului sau a tronsonului golește selecția (P2-04).
2. Câmpul „Aviz CJPT / CJPJ” dispare; se arată „Nr. aviz: se alocă la emitere (orientativ: CJPJ 0047)” din `izo_avize_serii` — numărul final îl dă serverul (P2-01).
3. Șofer: listă de angajați activi (șoferii primii) + bifă „șofer extern” → nume; la angajat, bifa „șoferul a fost prezent și a confirmat preluarea”. Mașina: listă din flotă (nr. înmatriculare) + „alt număr” → text. Destinatar: implicit intern; bifă „destinatar extern” → denumire, CUI, adresă.
4. Butonul „Emite avizul și înregistrează ieșirea” → RPC → generează PDF (html → html2canvas → jsPDF A4, ca în Achiziții) → upload `izo-avize` → `fn_izo_aviz_pdf_ataseaza` → previzualizare + Print. Dacă upload-ul pică, avizul e deja emis; în arhivă apare „PDF lipsă — regenerează” (doar emitentul).
5. PDF (P1-04), construit doar din `antet` + `continut` ale avizului:
   - titlu „AVIZ DE ÎNSOȚIRE A MĂRFII”, seria, numărul, data emiterii;
   - **Expeditor**: Gazpet Instal SRL — denumire, CUI, Reg. Com., adresă (din `logistica_setari` `firma_*`);
   - **Destinatar**: intern → Gazpet Instal SRL, punct de lucru proiectul (nume, cod) / tronsonul; extern → denumire, CUI, adresă tastate;
   - **Loc de încărcare**: depozitul (nume); **loc de destinație**: tronsonul (cod, km de la–la) și proiectul;
   - **Motivul**: „Transfer intern — materiale puse la dispoziție de beneficiar <beneficiar>, contract nr. <nr_contract> / <data_contract>” (din `executie_proiecte`) sau „Livrare către <denumire>”;
   - tabel pe poziții: nr. crt, denumire („Țeavă oțel DN … × … mm”), serie, șarjă, UM, lungime (m), masă (kg), 1 buc; totaluri: bucăți, m, kg;
   - mijloc de transport (nr. auto), delegat / șofer (nume; act de identitate necompletat → rubrică olografă);
   - semnături: **Predător** (gestionarul emitent: semnătura proprie salvată), **Șofer** (angajat cu `sofer_confirmat` și semnătură salvată → imaginea; altfel rubrică olografă marcată), **Primitor** (rubrică olografă).
   - Conformitatea fiscală a formularului (câmpuri obligatorii) se confirmă de contabilitate înainte de folosirea ca document justificativ; designul acoperă câmpurile de mai sus. Anulat → în arhivă și în vizualizare apar clar ANULAT, motivul, autorul și momentul; descărcarea PDF-ului original e etichetată „document anulat”, fișierul stocat rămâne neschimbat (P2-03).
6. **Arhiva avizelor** (secțiune nouă în ecranul Gestionar, vizibilă și MP / owner prin `fn_izo_citire`): filtre depozit / tronson / perioadă / stare, coloane nr, data, tronson, bucăți, m, kg, șofer, stare; „Deschide PDF”, „Anulează” (cu motiv).
- `Logistica.jsx` NU se modifică (doar model). Semnăturile se citesc cu un helper local (`src/lib/izoSemnaturi.js`) după modelul `getSemnaturaDataURL` din `Achizitii.jsx` (signed URL → dataURL).

## Teste
- Harness prodlike PG16 (lanț peste `scripts/test_izometrie_e4b.sh`): numerotare concurentă (2 sesiuni → numere distincte, consecutive), refuz ieșire ⇒ contor neschimbat, idempotență (aceeași cheie → același aviz, fără număr nou), cheie refolosită, șofer / vehicul invalid, PDF atașat o singură dată și doar pe calea corectă, anulare (doar autorizat, motiv), politica de semnătură (permisă: emitentul, obiectul exact, în fereastră; refuz: alt fișier din același folder, alt aviz / alt șofer, alt emitent, aviz anulat, `sofer_confirmat` fals, fereastră expirată, după atașarea PDF; redeschiderea ferestrei doar de emitent și doar fără PDF), PDF (obiect lipsă, alt owner, alt mimetype, mărime în afara limitelor, reapel idempotent, a doua încercare cu alt obiect → conflict), două sesiuni reale cu aceeași cheie → un singur aviz și un singur număr, chei diferite pe același depozit → numere consecutive, refuz după alocare → contor neschimbat, destinatar extern incomplet refuzat, revenire exactă, poarta `0e`.
- Vitest: filtrarea și contorul, construirea cererii, randarea PDF-ului (fără rețea).

## În afara etapei
Anularea ieșirii (storno) legată de avizul anulat; avizele de retur rest; trimitere pe mail (exclus: fără mail automat).
