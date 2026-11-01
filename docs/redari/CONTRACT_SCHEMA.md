# Redări teren (Lot 1 Transgaz) — contractul comun al modulului

Sursa: brief-ul lui Răzvan din 01.11.2026 (`docs/redari/BRIEF_2026-11-01.md`). Deciziile lui Răzvan (01.11 seara, chat):
**2A** migrarea se aplică după GO Jakarinos + Copilot (regula #1877), **3A** drepturile prin `user_module_access`
(`module = 'redari'`), **4A** DOCX cu jszip (fără librărie nouă), **5A** QR generat local cu `qrcode` (singura librărie
nouă aprobată), **6 manual**: răspunsul public NU trimite automat email/SMS și NU generează automat PV A — operatorul
le face din Registru. Șabloanele Model_1..6 vin de la Răzvan; până atunci convocatorul e provizoriu.

Toți agenții codează STRICT pe numele de mai jos. Cine are nevoie de ceva în plus adaugă aici, nu inventează în cod.
Fără date reale de proprietari nicăieri (cod, teste, fixture-uri, brief-uri Paw): doar nume fictive evidente.

**Implementarea BD**: `supabase/migrations/20261126a_redari_teren.sql` (revenire `supabase/revenire/20261126a_redari_teren_ROLLBACK.sql`,
DRY `supabase/tests/20261126a_redari_teren_dryrun.sql`, detalii și harness local `docs/redari/MIGRARE_20261126a.md`). Abaterile agentului de
migrare față de textul inițial sunt marcate mai jos cu **[mig]**; completările cerute de coordonator / Jakarinos r1 cu **[r1]**; runda 2
(Jakarinos r1 pe SQL + Copilot r1, NO-GO) cu **[r2]**; runda 3 (Jakarinos r2 + Copilot r2, NO-GO; șabloane v5) cu **[r3]**.

**[r2] Coerența și imutabilitatea legăturilor** (trigger `fn_red_legaturi`, BEFORE INSERT/UPDATE, pentru oricine): red_uat / red_import_loturi →
proiect existent; red_parcele → UAT-ul aparține proiectului parcelei; red_detinatori → parcelă activă (`sters_la IS NULL`); contact / token /
convocări / răspunsuri → deținător existent; red_raspunsuri_meta → răspuns existent; red_procese_verbale: tip A ⇒ `detinator_id` NOT NULL,
deținătorul e pe `parcela_id`, `uat_id` = UAT-ul parcelei; tip B ⇒ `parcela_id` NOT NULL, `detinator_id` NULL, `uat_id` = UAT-ul parcelei;
tip C ⇒ `parcela_id` NULL, `detinator_id` NULL, `tronson` și `uat_id` NOT NULL. **[r3]** red_parcele la INSERT: `id_parcela ~ '^T{tronson}-{uat3}-[0-9]{4}$'`
(uat3 din red_uat). Coloanele `proiect_id, uat_id, parcela_id, detinator_id, raspuns_id, seq` **[r3]** și `red_parcele.id_parcela / tronson` sunt
IMUTABILE după insert (23514) — o corecție = rând nou + soft delete pe cel vechi (soft delete-ul unei parcele cu deținători și convocări active
trece; un deținător nou pe parcela ștearsă e refuzat; parcela ștearsă iese din vederi). Erori: 23503 (legătură lipsă), 23514 (coerență / imutabilitate).
**[r3] Validarea răspunsurilor și pentru operatori** (trigger `fn_red_raspunsuri_valideaza`, BEFORE INSERT/UPDATE pe red_raspunsuri): `particip` ⇒
`zi_sesiune_aleasa` NOT NULL ∈ sesiune_zi1..3 ale UAT-ului deținătorului; `nu_particip_cu_obiectii` / `constatare_teren` ⇒ `obiectii_text` nevid;
`nu_particip_fara_obiectii` ⇒ `declaratie_confirmata = true` DOAR pe canal `online` (telefon / scris / sesiune se acceptă fără bifă — operatorul
confirmă). RPC-ul public își păstrează mesajele jsonb (verificările lui rămân înaintea insertului). `created_at` e imutabil (timpul de recepție).
**[r2] Limita jurnalului (P2-10)**: `red_jurnal` e append-only față de rolurile aplicației (anon / authenticated / service_role: fără INSERT /
UPDATE / DELETE / TRUNCATE, trigger de imutabilitate). NU protejează față de administratorul bazei: `postgres` poate dezactiva trigger-ul sau
insera direct. E o garanție de aplicație, nu una criptografică; dovada față de terți rămâne exportul semnat / datat, nu tabela în sine.

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
imputernicire_nr, imputernicire_data date, reprezentant_tgz_nume, reprezentant_tgz_functie, reprezentant_tgz_telefon` **[r3]**, `reprezentant_gazpet_nume,
reprezentant_gazpet_functie, contact_nume, contact_telefon, contact_email` (ex. redari@gazpet.ro), `text_gdpr text,
text_declaratie text NOT NULL` **[r1]** (textul declarației „nu particip — fără obiecții”; îl citește formularul public), `activ bool
default true, created_at`. **[r2] DEFAULT-uri editabile** (texte confirmate de Proiectul Juridic 01.11.2026, puse pe coloane, nu în RPC):
`contact_email` = `redari@gazpet.ro` (adresa nu există încă — configurare); `text_gdpr` = „Operatori: S.N.T.G.N. TRANSGAZ S.A. … plângere la
ANSPDCP (www.dataprotection.ro).” (NOT NULL); `text_declaratie` = „Nu particip. Nu am obiecții privind starea terenului și sunt de acord să primesc
procesul-verbal completat, spre semnare, prin poștă / electronic.” Formularul public întoarce `text_declaratie` ȘI `text_gdpr`.

### red_uat
`id, proiect_id FK, nume text NOT NULL, uat3 text NOT NULL` (3 litere mari, ex. PRU/GOD/HUS/CAZ/ILO/BAL/SIS; UNIQUE (proiect_id, uat3)),
`judet, primarie_adresa, primarie_email, primarie_telefon, reprezentant_uat_nume, reprezentant_uat_functie,
sesiune_zi1 date, sesiune_zi2 date, sesiune_zi3 date, program_zi1 text, program_zi2 text, program_zi3 text,
sate_zi1 text, sate_zi2 text, sate_zi3 text` **[r3]** (satele / tarlalele programate pe zi, șabloane v5 — `docs/redari/SABLOANE.md` §2.1/§3),
`afisare_pv_nr, afisare_data_start date, afisare_data_end date, created_at`.

### red_parcele
`id, proiect_id FK, uat_id FK, id_parcela text NOT NULL` (UNIQUE (proiect_id, id_parcela), format `T{tronson}-{uat3}-{nnnn}`),
`tronson int CHECK 1..11, km_de_la numeric, km_pana_la numeric, sat, tarla, nr_cadastral, poz_hg, suprafata_temporara_mp numeric,
categoria_folosinta, articol_deviz, cantitate numeric, valoare_lei numeric` (vizibilă doar admin — vezi §4), `observatii,
cheie_sursa text` **[r1]** (identitatea stabilă a rândului din Excel-ul TGZ: `{uat3}|{poz_hg}|{nr_cadastral}|{tarla}`, majuscule, fără
diacritice / spații duble; NULL dacă poz_hg, nr_cadastral și tarla sunt toate goale; CHECK majuscule; UNIQUE parțial
`(proiect_id, cheie_sursa) WHERE cheie_sursa IS NOT NULL AND sters_la IS NULL` — reimportul aceluiași fișier cade pe parcela existentă),
`sters_la, sters_de, sters_motiv, created_at`.
**[mig]** `authenticated` are privilegii de coloană pe red_parcele FĂRĂ `valoare_lei` ⇒ `select=*` / `RETURNING *` pe tabel pică cu
42501: UI-ul citește **`red_v_parcele`** (toate coloanele fără valoare_lei) sau liste explicite de coloane; INSERT/UPDATE pe tabel merg cu
coloane explicite (supabase-js `.insert(...)` fără `.select()` e OK). `service_role` vede tot.

### red_detinatori  (persoana, FĂRĂ contact)
`id, parcela_id FK, nume text NOT NULL, nume_normalizat text NOT NULL` (majuscule, fără diacritice, spații simple),
`calitate text CHECK IN ('proprietar','coproprietar','mostenitor','arendas','utilizator','neidentificat')`, `cota text,
decedat bool default false, sursa_date text, versiune_lista_tgz text, sters_la, sters_de, sters_motiv, created_at, updated_at`
(updated_at îl pune trigger-ul). UNIQUE (parcela_id, nume_normalizat) WHERE sters_la IS NULL. `nume_normalizat` are CHECK majuscule.
**[r1] Tokenul NU mai stă pe red_detinatori** (viewer-ul are SELECT pe rând, deci ar fi văzut secretul) — vezi `red_detinatori_token`.

### red_detinatori_token  (secret — doar admin/editor) **[r1]**
`detinator_id uuid PK FK red_detinatori, token_raspuns text UNIQUE NOT NULL` (43 caractere base64url din `gen_random_bytes(32)`, generat de
trigger AFTER INSERT pe red_detinatori; clientul nu are nicio cale de scriere; imutabil — trigger BEFORE UPDATE îl păstrează),
`token_expira_la timestamptz` (= max(sesiune_zi1..3 ale UAT-ului) + 30 zile, ora 23:59:59 București; NULL dacă UAT-ul nu are încă zile ⇒
tokenul NU expiră până se pun zilele; recalculat de trigger-e la schimbarea zilelor UAT-ului, a UAT-ului parcelei sau a parcelei deținătorului).
RLS: SELECT doar admin/editor; fără INSERT/UPDATE pentru nimeni (nici service_role). Nu intră în jurnal. UI-ul (convocator, link, QR) îl
citește de aici: `red_detinatori_token.token_raspuns WHERE detinator_id = …`. RPC-urile publice îl caută ca SECURITY DEFINER.

### red_detinatori_contact  (PII — doar admin/editor)
`detinator_id uuid PK FK red_detinatori, adresa_strada, adresa_sat, adresa_comuna, adresa_judet, cod_postal,
adresa_cunoscuta bool default true, telefon, email, updated_at`.
Abaterea față de brief (care le ținea pe red_detinatori) e intenționată: viewer-ul vede red_detinatori, dar RLS îi refuză
red_detinatori_contact — mascare reală, nu doar în UI.

### red_convocari
`id, detinator_id FK, canal text CHECK IN ('posta','sms','email','afisare','telefon'), nr_document text UNIQUE` (ex. `C-0001`),
`data_expediere date, nr_tracking, data_confirmare_primire date, retur text CHECK IN (NULL,'destinatar_necunoscut','mutat',
'avizat_neridicat','refuz','adresa_incompleta'), retur_data date, continut_hash text` (sha256 hex), `fisier_convocator_path text`
(cale în bucket `redari`), `stare text CHECK IN ('activ','anulat') default 'activ', motiv_anulare, sters_la, sters_de, sters_motiv,
created_by, created_at`. **[r1]** `fisier_convocator_path` și `continut_hash` rămân NULL-abile: UI-ul inserează rândul ÎNTÂI (număr
rezervat), încarcă fișierul, apoi UPDATE cu path + hash (politica de UPDATE admin/editor o permite) — un rând fără path = convocator
neîncărcat, de reluat. **[r2]** Fișierele din bucket sunt imutabile (fără UPDATE pe storage): o regenerare = altă cale
(`{nr_document}-v{n}.docx`), iar `*_path` arată spre versiunea curentă (schimbarea lui e în jurnal).

### red_raspunsuri
`id, seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE` **[r2]** (nu se trimite de client; tie-break), `detinator_id FK, canal text CHECK IN
('online','telefon','scris','sesiune','email','sms'), data timestamptz default now(),
optiune text CHECK IN ('particip','nu_particip_fara_obiectii','nu_particip_cu_obiectii','constatare_teren')`,
`zi_sesiune_aleasa date, obiectii_text` (business — vizibil și viewer), `declaratie_confirmata bool, semnatura_electronica_ref text,
created_by uuid NULL` (NULL la online), `created_at`.
**[r2] „Ultimul răspuns” = `ORDER BY data DESC, seq DESC`** — în view, în RPC și în `src/redari/stare.js` (UI-ul trebuie să folosească `seq` ca
tie-break, nu ordinea din listă). **[r3] Semantica**: `data` = momentul DECLARAT al răspunsului (editabil de operator: „a sunat ieri”), `seq` =
ordinea de înregistrare (tie-break la `data` egală), `created_at` = momentul recepției, IMUTABIL (trigger). Starea urmărește declarația, nu recepția. **[r2]** `ip_sau_sursa`, `user_agent`, `raw_payload` NU mai sunt aici (Copilot r1 P2-02) — vezi
`red_raspunsuri_meta`.

### red_raspunsuri_meta  (tehnic — doar admin/editor) **[r2]**
`raspuns_id uuid PK FK red_raspunsuri, ip_sau_sursa text, user_agent text, raw_payload jsonb`. RLS: SELECT doar admin/editor; INSERT
admin/editor (sau RPC-ul public, SECURITY DEFINER); fără UPDATE/DELETE. Jurnal: doar hash-uri (ca la contact). UI-ul le citește separat, prin
`raspuns_id`; viewer-ul nu le vede.

### red_procese_verbale
`id, parcela_id FK NULL` (NULL la tip C), `detinator_id FK NULL` (NULL la B/C), `uat_id FK, tronson int NULL` (tip C),
`tip text CHECK IN ('A','B','C'), nr_pv text UNIQUE` (`PVA-{uat3}-{nnnn}`, `PVB-{uat3}-{nnnn}`, `PVC-T{n}-{nnnn}`),
`data_pv date, locul, stare_teren_text, obiectii_redare bool default false, obiectii_text, termen_remediere date,
remediat_la date, stare text CHECK IN ('generat','trimis_spre_semnare','semnat','anulat') default 'generat', motiv_anulare,
trimis_spre_semnare_data date, semnat_primit_data date, semnat_fizic bool default false, fisier_generat_path, fisier_semnat_path,
semnatari jsonb, sters_la, sters_de, sters_motiv, created_by, created_at`.

### red_jurnal  (append-only)
`id bigserial PK, tabela text, inregistrare_id uuid, actiune text CHECK IN ('insert','update','delete'), date_vechi jsonb,
date_noi jsonb, user_id uuid, user_email text, created_at`. Trigger AFTER INSERT/UPDATE/DELETE pe red_* (nu pe red_jurnal),
`user_email` din `auth.jwt() ->> 'email'`. SELECT pentru admin/editor/viewer, INSERT doar prin trigger (funcție SECURITY DEFINER);
UPDATE/DELETE/TRUNCATE refuzate de trigger pentru oricine, inclusiv postgres.
**[mig]** Excepții: `red_rate_limit` (contor anonim — ar umple jurnalul) și `red_detinatori_token` (secret) NU se jurnalizează; pe `red_parcele`
`valoare_lei` e înlocuit cu `valoare_lei_setata` (bool); rândurile cu `tabela IN ('red_detinatori_contact','red_raspunsuri_meta')` le văd doar
admin/editor; un UPDATE care schimbă doar `updated_at` nu produce rând. `inregistrare_id` = `id` (sau `detinator_id` la contact, `raspuns_id`
la meta; NULL la red_numere). **[r2] Fără copia PII (P2-6)**: pe `red_detinatori_contact` și `red_raspunsuri_meta` jurnalul primește DOAR
câmpurile schimbate (la insert: toate cele nenule), ca nume: **[r3]** `{"telefon":"modificat","adresa_strada":"modificat"}` — niciodată valorile și
nici hash-uri (sha256 pe telefon / adresă e reversibil prin dicționar — Copilot r2 P2-01); `date_vechi` are aceleași nume de câmpuri.

### red_numere  (numerotare fără refolosire)
`cheie text PK` (ex. `C`, `PVA-HUS`, `PVB-HUS`, `PVC-T3`), `ultimul int NOT NULL default 0`.
`public.fn_red_numar_document(p_tip text, p_uat3 text, p_tronson int) RETURNS text` — SECURITY DEFINER, UPDATE … RETURNING
cu lock pe rând, EXECUTE doar authenticated (verifică `fn_red_nivel() IN ('admin','editor')` înăuntru). Formate: `C-0001`,
`PVA-HUS-0001`, `PVB-HUS-0001`, `PVC-T3-0001`. **[r2]** Peste 9999 → `RAISE EXCEPTION` (nu număr trunchiat); la fel la rezervarea parcelelor.
**[r2] Limită cunoscută, NU se repară (Copilot P2-03)**: rezervarea e COMISĂ la apelul RPC (PostgREST = autocommit), ÎNAINTE de orice
document; un număr comunicat / tipărit și apoi neutilizat rămâne consumat (gol în numerotare, fără refolosire) — în fluxul UI nu se reface.
În teste / batch-uri, numerele se rezervă în afara tranzacției de probă (DRY-ul își pierde numerele la ROLLBACK).

### red_import_loturi
`id, proiect_id FK, versiune_lista_tgz text NOT NULL, sursa text` (TGZ / ANEXA7), `fisier_nume, randuri_total int,
parcele_noi int, detinatori_noi int, dubluri int, neidentificati int, diferente jsonb, stare text CHECK IN ('in_curs','finalizat','esuat')
default 'in_curs', eroare text` **[r1]** (UI-ul creează lotul la început și îl închide la final — reluarea unui lot eșuat e vizibilă),
`created_by, created_at`.

### red_numere — completare **[r1]**
`public.fn_red_rezerva_numere_parcele(p_uat3 text, p_tronson int, p_n int) RETURNS int` — rezervă un bloc de `p_n` numere (1..5000) pe
cheia `P-T{tronson}-{uat3}` și întoarce PRIMUL număr din bloc; `id_parcela = T{tronson}-{uat3}-{lpad(nr, 4, '0')}`. Pornește de la
max(nnnn) deja existent în red_parcele pe (tronson, uat3) (import anterior fără rezervare), sigură la concurență (UPDATE sub lock de rând),
SECURITY DEFINER, EXECUTE authenticated, cer nivel admin/editor; peste 9999 → eroare.

### red_rate_limit  (contor pentru RPC-urile publice; fără acces authenticated/anon)
`cheie text PK` (`ip:<ip>` sau `t:<sha256 hex al tokenului>` — tokenul nu se stochează în clar), `fereastra_start timestamptz, numar int`.
**[r2]** NU e tabelă de business; formatul tokenului (exact 43 caractere `[A-Za-z0-9_-]`) se verifică ÎNAINTE de orice scriere în contor.
**[r3]** Index pe `fereastra_start`; curățarea (rânduri > 24 h, singurul DELETE din modul, ca owner — `fn_red_rate_limit_curata`) NU la fiecare
atingere, ci în ~2 % din apeluri sau când `pg_class.reltuples` > 10.000, o singură dată per apel RPC. **Cheia de token se atinge DOAR pentru
tokenuri existente și valide** (mulțime finită — fără DoS prin chei arbitrare); pentru tokenuri cu format bun dar inexistente / expirate se
contorizează doar IP-ul. Fără `x-forwarded-for` cheia e `ip:necunoscut` cu aceeași limită de 30 — limita reală pentru traficul fără IP e la
gateway-ul Supabase, nu aici.

## 3. Vederi (toate `WITH (security_invoker = on)`)
### red_v_stare_parcela — o linie per (parcela, detinator) activ (sters_la IS NULL)
Coloane: `parcela_id, detinator_id, proiect_id, uat_id, uat3, uat_nume, id_parcela, tronson, nume, calitate, cota, decedat,
adresa_cunoscuta` (din contact, prin LEFT JOIN — NULL pentru viewer), `stare text, stare_ordine int, ultima_convocare_data,
ultimul_raspuns_optiune, ultimul_raspuns_data, pv_nr, pv_stare` (**[mig]** pv_nr / pv_stare = PV-ul tip A ne-anulat al deținătorului,
cu prioritate semnat > trimis_spre_semnare > generat; ultimul răspuns = max(`data`, `created_at`); `ultima_convocare_data` =
max(`data_expediere`) pe convocările active).
### red_v_parcele **[mig]**
Toate coloanele din red_parcele FĂRĂ `valoare_lei` — vederea pe care o citește UI-ul (vezi §4).
Ierarhia STĂRII, în ordinea asta (prima adevărată câștigă; aceeași logică și în `src/redari/stare.js`):
1. `PV_A_SEMNAT` — există PV tip A activ cu stare `semnat` pe deținător.
2. `PV_B_CONSTATARE` — există PV tip B activ pe parcelă (stare ≠ anulat).
3. `PV_TRIMIS_SPRE_SEMNARE` — PV tip A cu stare `trimis_spre_semnare`.
4. `OBIECTII_DE_TRATAT` — ultimul răspuns e `nu_particip_cu_obiectii` sau `constatare_teren`, fără PV A semnat.
5. `A_RASPUNS_FARA_OBIECTII` — ultimul răspuns `nu_particip_fara_obiectii`.
6. `A_RASPUNS_PARTICIPA` — ultimul răspuns `particip`.
7. `CONVOCARE_RETURNATA` — există convocare activă cu `retur IS NOT NULL` și nicio convocare activă confirmată ulterior
   (**[mig]** „ulterior” = `created_at` mai mare; „activă” = `stare = 'activ' AND sters_la IS NULL`, peste tot în view).
8. `CONVOCAT_FARA_RASPUNS` — există convocare activă cu `data_confirmare_primire` și niciun răspuns.
9. `EXPEDIAT_ASTEPTAM_AR` — există convocare activă cu `data_expediere`, fără confirmare și fără retur.
10. `NEIDENTIFICAT_AFISARE` — `calitate = 'neidentificat'`.
11. `FARA_ADRESA_AFISARE` — `adresa_cunoscuta = false` (din contact; pentru viewer se evaluează tot în view, pe tabela
    de contact prin funcție SECURITY DEFINER `fn_red_adresa_cunoscuta(detinator_id)` care întoarce doar boolean-ul). **[mig]** Un
    deținător FĂRĂ rând de contact e tratat tot `FARA_ADRESA_AFISARE` (`coalesce(…, false) = false`) — nu are unde fi convocat.
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
- `red_parcele.valoare_lei` — **[mig] varianta aleasă: privilegii de coloană.** `authenticated` primește SELECT/INSERT/UPDATE pe
  red_parcele pe TOATE coloanele în afară de `valoare_lei` (mascare reală în BD, indiferent de nivel); UI-ul citește `red_v_parcele`;
  valoarea se citește prin `fn_red_valoare_parcela(id) RETURNS numeric` și se scrie prin `fn_red_valoare_parcela_seteaza(id, valoare)`
  (ambele SECURITY DEFINER, EXECUTE authenticated, 42501 dacă nivelul nu e admin). Jurnalul primește doar `valoare_lei_setata` (bool).
- `red_detinatori_token`: SELECT doar admin/editor; fără scriere pentru nimeni. `red_jurnal`: SELECT orice nivel, dar rândurile
  `red_detinatori_contact` doar admin/editor. `red_numere`: SELECT orice nivel, scriere doar prin funcții. `red_rate_limit`: nimic.
- `service_role` (edge-uri): SELECT/INSERT/UPDATE pe toate tabelele (fără DELETE nicăieri, fără scriere pe jurnal / token), ocolește RLS;
  `fn_red_nivel()` îi dă NULL (fără `auth.uid()`), deci `fn_red_numar_document` / rezervarea / valoarea îl refuză — dacă un edge are nevoie,
  se adaugă explicit, cu decizie.
- INSERT/UPDATE pe parcele, detinatori, contact, convocari, raspunsuri, procese_verbale, import_loturi: `fn_red_nivel() IN ('admin','editor')`.
- red_proiecte, red_uat: INSERT/UPDATE doar `admin`.
- red_detinatori_contact: SELECT doar `admin`/`editor`.
- anon: nimic direct pe nicio tabelă; doar cele două RPC publice din §5.

## 5. RPC public (formular `/redari/raspuns/{token}`), SECURITY DEFINER, EXECUTE pentru anon + authenticated
- `fn_red_formular_public(p_token text) RETURNS jsonb` — la succes `{ok:true, id_parcela, uat_nume, proiect_denumire,
  sesiune: [{zi:'YYYY-MM-DD', program}]` (doar zilele setate, ordonate), `deja_raspuns: bool, expirat: false, text_declaratie,
  contact_nume, contact_telefon, contact_email}` (ultimele patru din red_proiecte — **[r1]**); niciun nume/adresă/telefon de deținător.
  Token necunoscut SAU expirat → `{ok:false, motiv:'token_invalid', contact_nume, contact_telefon, contact_email}` (contactul proiectului
  activ, ca omul să ne poată suna; același motiv pentru inexistent și expirat ca să nu se poată enumera — de aceea `expirat` e mereu
  `false` la `ok:true`; timpul de răspuns constant nu e cerut). **[r2]** Token cu format greșit (nu EXACT 43 caractere `[A-Za-z0-9_-]`) → `token_invalid` + contact, ÎNAINTE de contor (fără scriere în
  red_rate_limit). Întoarce și `text_gdpr` **[r2]**. Rate limit **[mig]**: doar pe IP (30 / 10 min) → `{ok:false, motiv:'prea_multe'}`; contorul
  pe token nu se consumă la afișare, ca să nu blocheze trimiterea.
- `fn_red_raspuns_public(p_token text, p_optiune text, p_zi date, p_obiectii text, p_declaratie_confirmata bool, p_user_agent text)
  RETURNS jsonb` — ordinea **[r3]**: formatul tokenului (exact 43 caractere) → `token_invalid` fără a atinge contorul; (curățare rară a
  contorului); căutarea tokenului; rate limit IP (30 / 10 min) → `prea_multe`; token inexistent / expirat → `token_invalid` (fără cheie de token);
  rate limit token (5 / 10 min, cheia = sha256 al tokenului, DOAR pentru tokenuri existente) → `{ok:false, motiv:'prea_multe'}`; opțiune →
  `optiune_invalida`; `particip` cere **[r2]**
  `p_zi` NOT NULL și egală cu una din `sesiune_zi1..3` ale UAT-ului deținătorului, altfel `zi_invalida`;
  `nu_particip_fara_obiectii` fără `p_declaratie_confirmata = true` → `declaratie_neconfirmata`; `constatare_teren` /
  `nu_particip_cu_obiectii` cu `p_obiectii` gol → `obiectii_lipsa`, peste 4000 caractere → `obiectii_prea_lungi` (la celelalte opțiuni
  obiecțiile se ignoră). Inserează în red_raspunsuri cu `canal='online'`, `created_by NULL`, și **[r2]** în `red_raspunsuri_meta`:
  `ip_sau_sursa` = primul IP din `current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for'` (NULL dacă lipsește), `user_agent`
  (≤ 500), `raw_payload` (fără token). Succes: `{ok:true, raspuns_id, optiune, deja_raspuns:false}`. **[r1]** Al doilea răspuns pe același token
  e ACCEPTAT (istoricul rămâne, ultimul contează în stare): `{ok:true, raspuns_id, optiune, deja_raspuns:true, mesaj:'Răspunsul anterior a
  fost înlocuit.'}`. NU trimite email/SMS, NU generează PV (decizia 6: manual). Toate erorile așteptate vin prin jsonb, nu prin EXCEPTION.
- `red_rate_limit`: fereastră fixă de 10 minute pe cheie (`fereastra_start`); când expiră, contorul pornește de la 1.

## 6. Storage
Bucket privat `redari` (**[mig]** 25 MB / fișier; MIME: `application/pdf`,
`application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `image/jpeg`, `image/png` — scanul PV-ului semnat poate fi
poză); căi `{proiect_cod}/{uat3}/{id_parcela}/{nr_document}.docx|.pdf`. Politici `red_storage_sel / _ins` pe storage.objects:
SELECT și INSERT pentru `fn_red_nivel() IN ('admin','editor')`; **[r2] fără UPDATE și fără DELETE** — fișierele sunt imutabile; o versiune
nouă = cale nouă (`{nr_document}-v{n}.docx|.pdf`), iar coloana `*_path` din tabele arată spre versiunea curentă (schimbarea ei e jurnalizată;
upload-urile se fac cu `upsert: false`). În tabele se salvează `*_path` (calea în bucket), nu URL-uri semnate.

## 7. Import (client-side, `src/redari/importTgz.js`)
Excel TGZ: o foaie, antetul pe rândul 3, coloane: `Nr.Crt., Nr.Poz.Hg., UAT, Județ, Nume Deținător, Adresă, Suprafață Afectată
Temporar, Categorie Folosință, Tarla/Nr. Topo, Nr. cadastral/Parcelă, Regim juridic`. Reguli: `Nr.Crt.` de forma `x/y` →
coproprietari (rânduri separate pe aceeași parcelă; `x` = parcela, `y` = indexul persoanei); nume care conține „neidentificat”
→ `calitate='neidentificat'`, `adresa_cunoscuta=false`; `nume_normalizat` pentru deduplicare; tronsonul se dă manual per UAT la
import (până la corelarea km); **[r1]** `id_parcela = T{tronson}-{uat3}-{nnnn}` cu `nnnn` rezervat server-side prin
`fn_red_rezerva_numere_parcele(uat3, tronson, n)` (un bloc per lot / UAT; primul număr întors, apoi consecutiv), nu calculat în client;
`cheie_sursa` se calculează pe fiecare rând și se trimite la INSERT — un rând cu cheie deja existentă pe proiect e „dublură” (se leagă de
parcela existentă, nu creează alta). Lotul se deschide (`red_import_loturi.stare = 'in_curs'`) înainte de scriere și se închide la final
(`finalizat` / `esuat` + `eroare`).
Rezultatul previzualizării: `{parcele: [...], detinatori: [...], contacte: [...], dubluri, neidentificati, erori}`; commit-ul
scrie în ordinea parcele → detinatori → contact → red_import_loturi, în loturi de 200 (ținta: 2.728 parcele sub 1 minut).

## 8. Documente (client-side, `src/redari/docx.js`, 4A + 5A)
- `completeazaDocx(templateArrayBuffer, campuri) → Blob`: deschide DOCX cu jszip, înlocuiește `{{camp}}` în `word/document.xml`
  (și headers/footers), inclusiv când placeholder-ul e rupt între mai multe `<w:r>` (se reunesc run-urile unui paragraf înainte
  de înlocuire), escape XML pe valori; `{{qr}}` → imagine PNG inserată (QR generat local cu `qrcode`, `toDataURL`).
- Convocator: `public/redari/sabloane/convocator.docx` (Model_1 v5 cu 36 de placeholder-e — harta completă în `docs/redari/SABLOANE.md`
  §2.1; calea stă în `SABLON_CONVOCATOR` din `src/redari/ui/comune.jsx`). `genereazaConvocator({ detinator, contactDetinator, contact, parcela,
  uat, proiect, nrDocument, token, origin, templateArrayBuffer, … })` furnizează cheile `CHEI_CONVOCATOR` (cele 36 + `id_parcela` pentru corelare);
  `contactDetinator` = rândul din `red_detinatori_contact` (PII — doar admin/editor îl pot citi; din el se compune `{{adresa}}`), separat de
  `contact` = persoana de contact Gazpet (fallback `proiect.contact_*`). `verificaDateConvocator` blochează generarea de trimis când lipsesc
  câmpurile obligatorii (contract, împuternicire, sesiune cu program, contact, text GDPR, reprezentant TGZ, adresă cunoscută). Convocatorul
  provizoriu (`convocator_provizoriu.docx`, 22 de câmpuri) a fost retras odată cu trecerea pe șablonul real (§10).
- Link public: `${window.location.origin}/redari/raspuns/${token_raspuns}`.
- `hashBlob(blob) → sha256 hex` (WebCrypto) pentru `continut_hash`.
- Borderou Poștă CSV (UTF-8 cu BOM, `;`): `nr_document;nume;adresa;cod_postal;localitate;judet;id_parcela`.

## 9. UI (`src/Redari.jsx`, fișier nou; `src/App.jsx` primește DOAR ruta, importul lazy și intrarea în meniu)
Ecrane în felia de noapte: **Registru** (tabel din red_v_stare_parcela, filtre UAT/tronson/stare, căutare, STARE colorată,
acțiuni: generează convocator, marchează expediat / AR primit / retur, înregistrează răspuns telefonic), **Fișa parcelei**
(date, deținători + contact dacă nivelul permite, cronologie din convocări/răspunsuri/PV/jurnal), **Import** (previzualizare +
raport + commit). Restul (Dashboard, UAT, Sesiune, Setări, PV A/B/C) = după. Pagina publică: `src/RedariRaspunsPublic.jsx`,
ruta `/redari/raspuns/:token` fără login.

## 10. Șabloane reale (Model_1..7, v5 din 01.11.2026 după review R3) — adăugat 01.11.2026, branch `redari/sabloane`
Harta completă placeholder → sursă: `docs/redari/SABLOANE.md`. Originalele: `docs/redari/referinta/` (Model_1..5 .docx v5,
Model_6 registru .xlsx și cele 3 PDF-uri din pachetul v3, Model_7 tipizat Anexa 7 .xlsx v5). Șabloanele cu placeholder-e,
verificate cu `node scripts/redari_sabloane_verifica.mjs` (0 placeholder-e rupte) și completate de probă cu `completeazaDocx`
strict: `public/redari/sabloane/convocator.docx` (Model 1, 36 placeholder-e), `pv_a.docx` (Model 2, 54), `pv_b.docx`
(Model 3, 77), `adresa_uat.docx` (Model 4, 44, inclusiv rândul-șablon `{{rand.*}}`), `pv_c.docx` (Model 5, 23).
`convocator_provizoriu.docx` rămâne doar până trece codul pe `convocator.docx`.

Schimbări față de §8 (convocatorul): placeholder-e noi `{{calitate}} {{adresa}} {{poz_hg}} {{tronson}} {{sate_zi1..3}}
{{imputernicire_nr}} {{imputernicire_data}} {{contract_nr}} {{contract_data}} {{proiect_denumire}} {{reprezentant_tgz_telefon}}
{{semnatar_gazpet}} {{semnatar_tgz}}`; `{{text_gdpr}}` e tot paragraful de informare (textul din Model_1 v5 = valoarea
implicită a `red_proiecte.text_gdpr`); `{{id_parcela}}` NU apare în model (de decis). Convenții noi: `{{bifa_*}}` → „☒”/„☐”,
`{{semnatar_*}}` → „Nume, funcție”, `{{rand.camp}}` → rând repetat (funcție viitoare `repetaRand` în docx.js; `RX_PLACEHOLDER`
nu acceptă punctul, deci azi rămân literal, fără eroare în strict).

Coloane/obiecte NOI necesare (fără sursă în §2; propuneri, de confirmat de Răzvan înainte de migrare):
- `red_proiecte`: `reprezentant_tgz_telefon text`, `apm_nume text`.
- `red_uat`: `sate_zi1, sate_zi2, sate_zi3 text` (sate/tarlale pe zi), `reprezentant_uat_telefon text`, `afisare_ora text`,
  `termen_confirmare date`, `adresa_nr text, adresa_data date` (adresa către primărie; cheie nouă `AU` în `red_numere` sau
  nr. din registratura Gazpet), `afisare_reprezentant_gazpet text` (cine afișează), `responsabil_id`/`responsabil text`.
- `red_parcele`: `verificare_data date, verificare_de_gazpet text, verificare_de_tgz text, jurnal_santier_ref text`
  (verificarea efectivă a comisiei pe teren, cerută de PV B v5 și de PV A „constatarea s-a făcut la sediu … pe baza
  verificării … la data …”).
- `red_procese_verbale`: `stare_teren` ca bife + „alta” (înlocuiește/completează `stare_teren_text`: nivelat, strat vegetal
  refăcut, însămânțat, gard/drum refăcut, alta text), `plan_situatie bool`, `foto_nr int`, `constatare_mod text CHECK
  ('sediu','teren')` (PV A), `reverificare_la date`, `alte_observatii text` (pct. 6, nu privesc redarea), `motiv_pv_b text
  CHECK ('declaratie','neprezentat','neidentificat','refuz')` (pct. 4 din PV B; „refuz” nu are azi nicio stare/opțiune),
  `lucrari jsonb` dacă bifele lucrărilor se aleg manual (altfel mapare `articol_deviz → bife`, de definit).
- `red_convocari`: `adresa_tgz_nr text` (reluarea convocării după date corectate de Beneficiar — a doua convocare pe
  deținător; Model_3 v5 rândul „Reluarea convocării”).
- `red_raspunsuri`: sursă pentru prezența la sesiune (`canal='sesiune'` = prezent) și `constatare_teren_data date`
  (data stabilită de comisie).
- `red_detinatori` (din Model_7): `act_doveditor_cunoscut bool`, `reprezentant_mandat text`, `despagubire_doc text`,
  `stadiu_verificare text`; parser nou în `importTgz.js` pentru formatul Anexa 7 (antet pe rândul 5, 30 de coloane).
- `red_numere`: cheie `AU` (adrese UAT) dacă se numerotează în ERP.
- Decizii deschise: `link_afisare` (pagină publică pe UAT fără token sau se scoate din Anexa 2), `act_identitate`/`act_doveditor`
  (rămân de mână, nu se stochează), `pva_sesiune` vs `pva_corespondenta` (calcul pe `trimis_spre_semnare_data`), tabelul de
  parcele/articole din PV C (nu există în Model_5; anexa = export xlsx din registru).
