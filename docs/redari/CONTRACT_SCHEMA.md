# Redări teren (Lot 1 Transgaz) — contractul comun al modulului

Sursa: brief-ul lui Răzvan din 01.11.2026 (`docs/redari/BRIEF_2026-11-01.md`). Deciziile lui Răzvan (01.11 seara, chat):
**2A** migrarea se aplică după GO Jakarinos + Copilot (regula #1877), **3A** drepturile prin `user_module_access`
(`module = 'redari'`), **4A** DOCX cu jszip (fără librărie nouă), **5A** QR generat local cu `qrcode` (singura librărie
nouă aprobată), **6 manual**: răspunsul public NU trimite automat email/SMS și NU generează automat PV A — operatorul
le face din Registru. Șabloanele Model_1..6 vin de la Răzvan; până atunci convocatorul e provizoriu.

Toți agenții codează STRICT pe numele de mai jos. Cine are nevoie de ceva în plus adaugă aici, nu inventează în cod.
Fără date reale de proprietari nicăieri (cod, teste, fixture-uri, brief-uri Paw): doar nume fictive evidente.

## 1. Drepturi (3A)
- Cheia de modul: `redari`. Niveluri în `user_module_access.access_level`: `admin` (= redari_admin), `editor`
  (= redari_operator), `viewer` (= redari_viewer). Owner (`profiles.is_owner`) = admin implicit.
- `public.fn_red_nivel() RETURNS text` — `admin` | `editor` | `viewer` | NULL pentru utilizatorul curent (fără parametru,
  ca `fn_are_acces_ofertare()`; SECURITY DEFINER, `SET search_path = public, pg_temp`, EXECUTE doar authenticated/service_role).
- UI: ruta `/redari` cu `requireModule="redari"`; nivelul din `profile.module_access_levels.redari` (owner → `admin`).

## 2. Tabele (`public`, prefix `red_`) — toate cu RLS, GRANT authenticated/service_role, fără DELETE fizic
Convenții: `id uuid PK default gen_random_uuid()`, `created_at timestamptz default now()`, `created_by uuid default auth.uid()`
unde scrie brief-ul. Soft delete = `sters_la timestamptz NULL` + `sters_de uuid` + `sters_motiv text` pe parcele, detinatori,
convocari, procese_verbale. Politicile de DELETE lipsesc pe toate tabelele (nu există DELETE), iar `red_jurnal` nu are
nici UPDATE pentru nimeni (REVOKE UPDATE, DELETE, TRUNCATE de la authenticated, anon, service_role, PUBLIC).

### red_proiecte
`id, cod text UNIQUE NOT NULL` (ex. `LOT1-PRUNISOR-JUPA`), `denumire, beneficiar, contract_nr, contract_data date,
imputernicire_nr, imputernicire_data date, reprezentant_tgz_nume, reprezentant_tgz_functie, reprezentant_gazpet_nume,
reprezentant_gazpet_functie, contact_nume, contact_telefon, contact_email` (ex. redari@gazpet.ro), `text_gdpr text,
activ bool default true, created_at`.

### red_uat
`id, proiect_id FK, nume text NOT NULL, uat3 text NOT NULL` (3 litere mari, ex. PRU/GOD/HUS/CAZ/ILO/BAL/SIS; UNIQUE (proiect_id, uat3)),
`judet, primarie_adresa, primarie_email, primarie_telefon, reprezentant_uat_nume, reprezentant_uat_functie,
sesiune_zi1 date, sesiune_zi2 date, sesiune_zi3 date, program_zi1 text, program_zi2 text, program_zi3 text,
afisare_pv_nr, afisare_data_start date, afisare_data_end date, created_at`.

### red_parcele
`id, proiect_id FK, uat_id FK, id_parcela text NOT NULL` (UNIQUE (proiect_id, id_parcela), format `T{tronson}-{uat3}-{nnnn}`),
`tronson int CHECK 1..11, km_de_la numeric, km_pana_la numeric, sat, tarla, nr_cadastral, poz_hg, suprafata_temporara_mp numeric,
categoria_folosinta, articol_deviz, cantitate numeric, valoare_lei numeric` (vizibilă doar admin — vezi §4), `observatii,
sters_la, sters_de, sters_motiv, created_at`.

### red_detinatori  (persoana, FĂRĂ contact)
`id, parcela_id FK, nume text NOT NULL, nume_normalizat text NOT NULL` (majuscule, fără diacritice, spații simple),
`calitate text CHECK IN ('proprietar','coproprietar','mostenitor','arendas','utilizator','neidentificat')`, `cota text,
decedat bool default false, sursa_date text, versiune_lista_tgz text, token_raspuns text UNIQUE` (32+ caractere aleatoare
url-safe, generat în BD la insert), `token_expira_la timestamptz` (= max(sesiune_zi1..3 ale UAT-ului) + 30 zile, recalculat
de o funcție la nevoie), `sters_la, sters_de, sters_motiv, created_at, updated_at`.
UNIQUE (parcela_id, nume_normalizat) WHERE sters_la IS NULL.

### red_detinatori_contact  (PII — doar admin/editor)
`detinator_id uuid PK FK red_detinatori, adresa_strada, adresa_sat, adresa_comuna, adresa_judet, cod_postal,
adresa_cunoscuta bool default true, telefon, email, updated_at`.
Abaterea față de brief (care le ținea pe red_detinatori) e intenționată: viewer-ul vede red_detinatori, dar RLS îi refuză
red_detinatori_contact — mascare reală, nu doar în UI.

### red_convocari
`id, detinator_id FK, canal text CHECK IN ('posta','sms','email','afisare','telefon'), nr_document text UNIQUE` (ex. `C-0001`),
`data_expediere date, nr_tracking, data_confirmare_primire date, retur text CHECK IN (NULL,'destinatar_necunoscut','mutat',
'avizat_neridicat','refuz','adresa_incompleta'), retur_data date, continut_hash text` (sha256 hex), `fisier_convocator_path text`
(cale în bucket `redari`), `stare text CHECK IN ('activ','anulat') default 'activ', motiv_anulare, created_by, created_at`.

### red_raspunsuri
`id, detinator_id FK, canal text CHECK IN ('online','telefon','scris','sesiune','email','sms'), data timestamptz default now(),
optiune text CHECK IN ('particip','nu_particip_fara_obiectii','nu_particip_cu_obiectii','constatare_teren'),
zi_sesiune_aleasa date, obiectii_text, declaratie_confirmata bool, ip_sau_sursa text, user_agent text,
semnatura_electronica_ref text, raw_payload jsonb, created_by uuid NULL` (NULL la online), `created_at`.

### red_procese_verbale
`id, parcela_id FK NULL` (NULL la tip C), `detinator_id FK NULL` (NULL la B/C), `uat_id FK, tronson int NULL` (tip C),
`tip text CHECK IN ('A','B','C'), nr_pv text UNIQUE` (`PVA-{uat3}-{nnnn}`, `PVB-{uat3}-{nnnn}`, `PVC-T{n}-{nnnn}`),
`data_pv date, locul, stare_teren_text, obiectii_redare bool default false, obiectii_text, termen_remediere date,
remediat_la date, stare text CHECK IN ('generat','trimis_spre_semnare','semnat','anulat') default 'generat', motiv_anulare,
trimis_spre_semnare_data date, semnat_primit_data date, semnat_fizic bool default false, fisier_generat_path, fisier_semnat_path,
semnatari jsonb, sters_la, sters_de, sters_motiv, created_by, created_at`.

### red_jurnal  (append-only)
`id bigserial PK, tabela text, inregistrare_id uuid, actiune text CHECK IN ('insert','update','delete'), date_vechi jsonb,
date_noi jsonb, user_id uuid, user_email text, created_at`. Trigger AFTER INSERT/UPDATE pe toate red_* (nu pe red_jurnal),
`user_email` din `auth.jwt() ->> 'email'`. SELECT pentru admin/editor/viewer, INSERT doar prin trigger (funcție SECURITY DEFINER).

### red_numere  (numerotare fără refolosire)
`cheie text PK` (ex. `C`, `PVA-HUS`, `PVB-HUS`, `PVC-T3`), `ultimul int NOT NULL default 0`.
`public.fn_red_numar_document(p_tip text, p_uat3 text, p_tronson int) RETURNS text` — SECURITY DEFINER, UPDATE … RETURNING
cu lock pe rând, EXECUTE doar authenticated (verifică `fn_red_nivel() IN ('admin','editor')` înăuntru). Formate: `C-0001`,
`PVA-HUS-0001`, `PVB-HUS-0001`, `PVC-T3-0001`.

### red_import_loturi
`id, proiect_id FK, versiune_lista_tgz text NOT NULL, sursa text` (TGZ / ANEXA7), `fisier_nume, randuri_total int,
parcele_noi int, detinatori_noi int, dubluri int, neidentificati int, diferente jsonb, created_by, created_at`.

## 3. Vederi (toate `WITH (security_invoker = on)`)
### red_v_stare_parcela — o linie per (parcela, detinator) activ (sters_la IS NULL)
Coloane: `parcela_id, detinator_id, proiect_id, uat_id, uat3, uat_nume, id_parcela, tronson, nume, calitate, cota, decedat,
adresa_cunoscuta` (din contact, prin LEFT JOIN — NULL pentru viewer), `stare text, stare_ordine int, ultima_convocare_data,
ultimul_raspuns_optiune, ultimul_raspuns_data, pv_nr, pv_stare`.
Ierarhia STĂRII, în ordinea asta (prima adevărată câștigă; aceeași logică și în `src/redari/stare.js`):
1. `PV_A_SEMNAT` — există PV tip A activ cu stare `semnat` pe deținător.
2. `PV_B_CONSTATARE` — există PV tip B activ pe parcelă (stare ≠ anulat).
3. `PV_TRIMIS_SPRE_SEMNARE` — PV tip A cu stare `trimis_spre_semnare`.
4. `OBIECTII_DE_TRATAT` — ultimul răspuns e `nu_particip_cu_obiectii` sau `constatare_teren`, fără PV A semnat.
5. `A_RASPUNS_FARA_OBIECTII` — ultimul răspuns `nu_particip_fara_obiectii`.
6. `A_RASPUNS_PARTICIPA` — ultimul răspuns `particip`.
7. `CONVOCARE_RETURNATA` — există convocare activă cu `retur IS NOT NULL` și nicio convocare activă confirmată ulterior.
8. `CONVOCAT_FARA_RASPUNS` — există convocare activă cu `data_confirmare_primire` și niciun răspuns.
9. `EXPEDIAT_ASTEPTAM_AR` — există convocare activă cu `data_expediere`, fără confirmare și fără retur.
10. `NEIDENTIFICAT_AFISARE` — `calitate = 'neidentificat'`.
11. `FARA_ADRESA_AFISARE` — `adresa_cunoscuta = false` (din contact; pentru viewer se evaluează tot în view, pe tabela
    de contact prin funcție SECURITY DEFINER `fn_red_adresa_cunoscuta(detinator_id)` care întoarce doar boolean-ul).
12. `DE_CONVOCAT` — restul.
`stare_ordine` = numărul de mai sus (1 = cel mai avansat).

### red_v_centralizator_uat
`proiect_id, uat_id, uat3, uat_nume, stare, numar int, total_uat int, procent_inchise numeric` (închise = PV_A_SEMNAT + PV_B_CONSTATARE,
procentul se repetă pe fiecare rând al UAT-ului).

### red_v_tronson
`proiect_id, tronson, uat_id, uat3, parcela_id, id_parcela, suprafata_temporara_mp, articol_deviz, cantitate, tip_pv text NULL`
(A dacă există PV A semnat, B dacă există PV B, altfel NULL), `obiectii_deschise bool`.

## 4. RLS (rezumat)
- SELECT pe red_proiecte/uat/parcele/detinatori/convocari/raspunsuri/procese_verbale/jurnal/import_loturi/numere: `fn_red_nivel() IS NOT NULL`.
- `red_parcele.valoare_lei`: coloană citită de toți prin RLS, dar UI-ul o ascunde sub admin; pentru mascare reală în BD se
  expune `red_v_parcele` (security_invoker) fără `valoare_lei`, iar valoarea se citește doar prin `fn_red_valoare_parcela(id)`
  (SECURITY DEFINER, doar admin). Agentul de migrare alege varianta și o notează aici.
- INSERT/UPDATE pe parcele, detinatori, contact, convocari, raspunsuri, procese_verbale, import_loturi: `fn_red_nivel() IN ('admin','editor')`.
- red_proiecte, red_uat: INSERT/UPDATE doar `admin`.
- red_detinatori_contact: SELECT doar `admin`/`editor`.
- anon: nimic direct pe nicio tabelă; doar cele două RPC publice din §5.

## 5. RPC public (formular `/redari/raspuns/{token}`), SECURITY DEFINER, EXECUTE pentru anon + authenticated
- `fn_red_formular_public(p_token text) RETURNS jsonb` — `{ok, id_parcela, uat_nume, proiect_denumire, sesiune: [{zi, program}],
  deja_raspuns: bool, expirat: bool}`; niciun nume/adresă/telefon. Token necunoscut → `{ok:false, motiv:'token_invalid'}` (același
  răspuns pentru inexistent și expirat ca să nu se poată enumera; timpul de răspuns constant nu e cerut).
- `fn_red_raspuns_public(p_token text, p_optiune text, p_zi date, p_obiectii text, p_declaratie_confirmata bool, p_user_agent text)
  RETURNS jsonb` — validează token + expirare + opțiune; `nu_particip_fara_obiectii` cere `p_declaratie_confirmata = true`;
  `constatare_teren` și `nu_particip_cu_obiectii` cer `p_obiectii` nevid (max 4000 caractere); inserează în red_raspunsuri cu
  `canal='online'`, `ip_sau_sursa` din `current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for'`, `created_by NULL`;
  rate limit în `red_rate_limit (cheie text PK, fereastra_start timestamptz, numar int)`: max 5 cereri / token / 10 min și max 30 /
  IP / 10 min → `{ok:false, motiv:'prea_multe'}`. NU trimite email/SMS, NU generează PV (decizia 6: manual).

## 6. Storage
Bucket privat `redari`; căi `{proiect_cod}/{uat3}/{id_parcela}/{nr_document}.docx|.pdf`. Politici: SELECT/INSERT/UPDATE pentru
`fn_red_nivel() IN ('admin','editor')`, fără DELETE. În tabele se salvează `*_path` (calea în bucket), nu URL-uri semnate.

## 7. Import (client-side, `src/redari/importTgz.js`)
Excel TGZ: o foaie, antetul pe rândul 3, coloane: `Nr.Crt., Nr.Poz.Hg., UAT, Județ, Nume Deținător, Adresă, Suprafață Afectată
Temporar, Categorie Folosință, Tarla/Nr. Topo, Nr. cadastral/Parcelă, Regim juridic`. Reguli: `Nr.Crt.` de forma `x/y` →
coproprietari (rânduri separate pe aceeași parcelă; `x` = parcela, `y` = indexul persoanei); nume care conține „neidentificat”
→ `calitate='neidentificat'`, `adresa_cunoscuta=false`; `nume_normalizat` pentru deduplicare; tronsonul se dă manual per UAT la
import (până la corelarea km); `id_parcela = T{tronson}-{uat3}-{nnnn}` cu `nnnn` continuat de la ultimul existent pe (proiect, uat).
Rezultatul previzualizării: `{parcele: [...], detinatori: [...], contacte: [...], dubluri, neidentificati, erori}`; commit-ul
scrie în ordinea parcele → detinatori → contact → red_import_loturi, în loturi de 200 (ținta: 2.728 parcele sub 1 minut).

## 8. Documente (client-side, `src/redari/docx.js`, 4A + 5A)
- `completeazaDocx(templateArrayBuffer, campuri) → Blob`: deschide DOCX cu jszip, înlocuiește `{{camp}}` în `word/document.xml`
  (și headers/footers), inclusiv când placeholder-ul e rupt între mai multe `<w:r>` (se reunesc run-urile unui paragraf înainte
  de înlocuire), escape XML pe valori; `{{qr}}` → imagine PNG inserată (QR generat local cu `qrcode`, `toDataURL`).
- Convocator provizoriu: `public/redari/sabloane/convocator_provizoriu.docx` (generat cu `docx` din devDependencies printr-un
  script `scripts/redari_sablon_provizoriu.mjs`, câmpuri: `{{nume}} {{id_parcela}} {{uat}} {{sat}} {{tarla}} {{nr_cadastral}}
  {{suprafata}} {{zi1}} {{program1}} {{zi2}} {{program2}} {{zi3}} {{program3}} {{link}} {{qr}} {{nr_document}} {{data}}
  {{contact_nume}} {{contact_telefon}} {{contact_email}} {{reprezentant_tgz}} {{text_gdpr}}`). Când vin Model_1..6, se
  înlocuiește doar fișierul.
- Link public: `${window.location.origin}/redari/raspuns/${token_raspuns}`.
- `hashBlob(blob) → sha256 hex` (WebCrypto) pentru `continut_hash`.
- Borderou Poștă CSV (UTF-8 cu BOM, `;`): `nr_document;nume;adresa;cod_postal;localitate;judet;id_parcela`.

## 9. UI (`src/Redari.jsx`, fișier nou; `src/App.jsx` primește DOAR ruta, importul lazy și intrarea în meniu)
Ecrane în felia de noapte: **Registru** (tabel din red_v_stare_parcela, filtre UAT/tronson/stare, căutare, STARE colorată,
acțiuni: generează convocator, marchează expediat / AR primit / retur, înregistrează răspuns telefonic), **Fișa parcelei**
(date, deținători + contact dacă nivelul permite, cronologie din convocări/răspunsuri/PV/jurnal), **Import** (previzualizare +
raport + commit). Restul (Dashboard, UAT, Sesiune, Setări, PV A/B/C) = după. Pagina publică: `src/RedariRaspunsPublic.jsx`,
ruta `/redari/raspuns/:token` fără login.
