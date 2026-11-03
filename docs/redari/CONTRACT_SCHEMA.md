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
(Jakarinos r1 pe SQL + Copilot r1, NO-GO) cu **[r2]**; runda 3 (Jakarinos r2 + Copilot r2, NO-GO; șabloane v5) cu **[r3]**; runda 4 (Jakarinos r3) cu **[r4]**.

**[r2] Coerența și imutabilitatea legăturilor** (trigger `fn_red_legaturi`, BEFORE INSERT/UPDATE, pentru oricine): red_uat / red_import_loturi →
proiect existent; red_parcele → UAT-ul aparține proiectului parcelei; red_detinatori → parcelă activă (`sters_la IS NULL`); contact / token /
convocări / răspunsuri → deținător existent; red_raspunsuri_meta → răspuns existent; red_procese_verbale: tip A ⇒ `detinator_id` NOT NULL,
deținătorul e pe `parcela_id`, `uat_id` = UAT-ul parcelei; tip B ⇒ `parcela_id` NOT NULL, `detinator_id` NULL, `uat_id` = UAT-ul parcelei;
tip C ⇒ `parcela_id` NULL, `detinator_id` NULL, `tronson` și `uat_id` NOT NULL. **[r3]** red_parcele la INSERT: `id_parcela ~ '^{uat3}-[0-9]{4}$'`
(uat3 din red_uat). Coloanele `proiect_id, uat_id, parcela_id, detinator_id, raspuns_id, seq` **[r3]** și `red_parcele.id_parcela` sunt
IMUTABILE după insert (23514) — o corecție = rând nou + soft delete pe cel vechi (soft delete-ul unei parcele cu deținători și convocări active
trece; un deținător nou pe parcela ștearsă e refuzat; parcela ștearsă iese din vederi). Erori: 23503 (legătură lipsă), 23514 (coerență / imutabilitate).
**[r3] Validarea răspunsurilor și pentru operatori** (trigger `fn_red_raspunsuri_valideaza`, BEFORE INSERT/UPDATE pe red_raspunsuri): `particip` ⇒
`zi_sesiune_aleasa` NOT NULL ∈ sesiune_zi1..3 ale UAT-ului deținătorului; `nu_particip_cu_obiectii` / `constatare_teren` ⇒ `obiectii_text` nevid;
`nu_particip_fara_obiectii` ⇒ `declaratie_confirmata = true` DOAR pe canal `online` (telefon / scris / sesiune se acceptă fără bifă — operatorul
confirmă); **[r4]** `obiectii_text` ≤ 4000 și în trigger; la UPDATE verificările rulează DOAR când se schimbă `optiune` / `zi_sesiune_aleasa` /
`obiectii_text` / `declaratie_confirmata` / **[r5]** `canal`, iar apartenența zilei la sesiunile CURENTE ale UAT-ului se verifică la INSERT, la
schimbarea zilei și **[r5]** când opțiunea devine `particip`.
RPC-ul public își păstrează mesajele jsonb (verificările lui rămân înaintea insertului). **[r4] Proveniență**: `created_at` = `now()` pus de
trigger la INSERT și imutabil apoi; `authenticated` NU are privilegiu de coloană pe `seq` și `created_at` (nici `OVERRIDING SYSTEM VALUE`, nici
`created_at` explicit nu trec — 42501); INSERT/UPDATE pe red_raspunsuri doar pe coloanele de conținut (`select=*` rămâne).
**[r4]** `red_uat.uat3` (intră în `id_parcela`) nu se mai schimbă cât există parcele pe UAT; `nume` rămâne editabil. **[r6]** Schimbarea lui `uat3`
cere tranzacție READ COMMITTED (cum rulează PostgREST); sub REPEATABLE READ / SERIALIZABLE → 25001 (EXISTS-ul pe parcele n-ar vedea o parcelă
comisă după snapshot).
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
**Faza 2, felia 2 — 20261128a (pregătită, neaplicată aici):** `executie_proiect_id bigint NULL REFERENCES public.executie_proiecte(id)` (tipul PK-ului din Execuție);
index unic parțial `red_proiecte_executie_uq WHERE executie_proiect_id IS NOT NULL` (un montaj are cel mult un proiect Redări). RPC `fn_red_adresa_uat_rezerva(p_uat_id uuid, p_versiune int) → red_uat` (admin; FOR UPDATE + CAS pe versiune; idempotent dacă `adresa_nr` există): rezervă numărul AU și îl scrie pe UAT **înainte** de generarea documentului — un eșec de generare/upload lasă numărul pe UAT, reluarea e „Regenerează” pe același număr (Copilot f2b r1 P2-1).
`link_informare_gdpr text NULL`: CHECK NULL sau prefix exact `https://` și lungime ≤ 300. Fără politici sau GRANT-uri noi.
Contractul rămâne copiat în Redări; preluarea din Execuție este opțională, numai în formular, urmată de salvare explicită cu CAS.
Lipsa accesului Execuție nu blochează citirea copiilor Redări. Linkul gol omite propoziția „Informarea completă” din convocator.

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
`id, proiect_id FK, uat_id FK, id_parcela text NOT NULL` (UNIQUE (proiect_id, id_parcela), format `{uat3}-{nnnn}`),
`tronson int NULL CHECK 1..11, km_de_la numeric, km_pana_la numeric, sat, tarla, nr_cadastral, poz_hg, suprafata_temporara_mp numeric,
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
Felia 4c, 20261129c (versiune 20261129120200): trigger BEFORE UPDATE,
SECURITY INVOKER, search_path public, pg_temp. Generat -> trimis_spre_semnare /
semnat / anulat; trimis_spre_semnare -> semnat / anulat. Semnat si anulat sunt finale.
Cerintele starii se verifica la fiecare UPDATE, nu doar la tranzitie: starea trimis cere
trimis_spre_semnare_data; semnat cere semnat_primit_data si fisier_semnat_path nevid (la B si
motiv_pv_b); anulat cere motiv_anulare nevid. Identitatea PV-ului (id, tip, nr_pv, parcela_id,
detinator_id, uat_id, tronson, created_by, created_at) nu se schimba in nicio stare. Dupa starea
finala randul e inghetat integral (inclusiv scanul, datele, semnat_la_sesiune si stergerea logica);
singura exceptie e remediat_la (review f4c r1). Refuzurile au SQLSTATE 23514. Politicile nu se modifica.

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

### red_numere - completare 8a
public.fn_red_rezerva_numere_parcele(p_uat3 text, p_n int) RETURNS int:
rezerva 1..5000 numere pe cheia P-{uat3} si intoarce primul numar.
id_parcela = {uat3}-{nnnn}, imutabil; baza max(nnnn) pe UAT3, inclusiv
parcele sterse. Peste 9999: eroare. SECURITY DEFINER, search_path
public, pg_temp; EXECUTE authenticated/service_role; admin/editor prin fn_red_nivel.
### red_rate_limit  (contor pentru RPC-urile publice; fără acces authenticated/anon)
`cheie text PK` (`ip:<ip>` sau `t:<sha256 hex al tokenului>` — tokenul nu se stochează în clar), `fereastra_start timestamptz, numar int`.
**[r2]** NU e tabelă de business; formatul tokenului (exact 43 caractere `[A-Za-z0-9_-]`) se verifică ÎNAINTE de orice scriere în contor.
**[r3]** Index pe `fereastra_start`; curățarea (rânduri > 24 h, singurul DELETE din modul, ca owner — `fn_red_rate_limit_curata`) NU la fiecare
atingere, ci în ~2 % din apeluri sau când `pg_class.reltuples` > 10.000, o singură dată per apel RPC; **[r4]** cel mult o dată la 10 minute (rândul
de control `cheie = '_curatare'`, `fereastra_start` = ultima curățare), în loturi de 5000 (subselect pe `ctid`), și rulează DUPĂ verificarea limitei
IP, nu înaintea ei; **[r5]** intervalul e revendicat atomic (`UPDATE … RETURNING` pe rândul de control); **[r6]** fără așteptare pe lock-uri
(`FOR UPDATE SKIP LOCKED` pe rândul de control și pe candidații la ștergere — fără deadlock cu incrementarea contorului IP). **[r5]** `fn_red_legaturi` ia `FOR SHARE` pe
rândul UAT la inserarea parcelei (serializare cu schimbarea `uat3`). **Cheia de token se atinge DOAR pentru
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
(A numai daca exista minimum un detinator activ si fiecare detinator activ are PV A semnat activ; altfel B daca exista PV B activ, altfel NULL), `obiectii_deschise bool`.

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
  RETURNS jsonb` — ordinea **[r4]**: formatul tokenului (exact 43 caractere) → `token_invalid` fără a atinge contorul; căutarea tokenului;
  rate limit IP (30 / 10 min) → `prea_multe`; (curățare rară a contorului); token inexistent / expirat → `token_invalid` (fără cheie de token);
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
upload-urile se fac cu `upsert: false`). În tabele se salvează `*_path` (calea în bucket), nu URL-uri semnate. **[r4]** Postcondiția și TEST9 verifică
prin `fn_red_storage_expr_bucket` că nicio politică permisivă străină de pe `storage.objects` nu poate acoperi `redari`: expresia cerută a comenzii
(USING pentru SELECT/DELETE/UPDATE/ALL, WITH CHECK pentru INSERT; WITH CHECK NULL pe UPDATE/ALL moștenește USING, ca în PostgreSQL) trebuie să aibă
`bucket_id = '<alt bucket>'` ca prim operand al AND-ului de nivel superior, fără niciun OR la acel nivel sau mai sus (paranteze numărate, literale
sărite), **[r5]** nimic înainte (`NOT`) și nimic după închiderea grupului (`IS FALSE` / `IS NOT TRUE` / `OR` / `::`) — **[r6]** cu excepția
`((grup) IS TRUE)`, exact o dată, imediat după grup. Verificarea prin Storage API pe prod rămâne manuală după apply — `docs/redari/MIGRARE_20261126a.md`.

## 7. Import (client-side, `src/redari/importTgz.js`)
Excel TGZ: o foaie, antetul pe rândul 3, coloane: `Nr.Crt., Nr.Poz.Hg., UAT, Județ, Nume Deținător, Adresă, Suprafață Afectată
Temporar, Categorie Folosință, Tarla/Nr. Topo, Nr. cadastral/Parcelă, Regim juridic`. Reguli: `Nr.Crt.` de forma `x/y` →
coproprietari (rânduri separate pe aceeași parcelă; `x` = parcela, `y` = indexul persoanei); nume care conține „neidentificat”
→ `calitate='neidentificat'`, `adresa_cunoscuta=false`; `nume_normalizat` pentru deduplicare; tronsonul se dă manual per UAT la
import (până la corelarea km); **[r1]** `id_parcela = {uat3}-{nnnn}` cu `nnnn` rezervat server-side prin
`fn_red_rezerva_numere_parcele(uat3, n)` (un bloc per lot / UAT; primul număr întors, apoi consecutiv), nu calculat în client;
`cheie_sursa` se calculează pe fiecare rând și se trimite la INSERT — un rând cu cheie deja existentă pe proiect e „dublură” (se leagă de
parcela existentă, nu creează alta). Lotul se deschide (`red_import_loturi.stare = 'in_curs'`) înainte de scriere și se închide la final
(`finalizat` / `esuat` + `eroare`).
Rezultatul previzualizării: `{parcele: [...], detinatori: [...], contacte: [...], dubluri, neidentificati, erori}`; commit-ul
scrie în ordinea parcele → detinatori → contact → red_import_loturi, în loturi de 200 (ținta: 2.728 parcele sub 1 minut).

### Anexa 7 (faza 2, felia 3b)
`src/redari/importAnexa7.js`: `parseazaAnexa7(arrayBuffer, {uats, tronsonPeUat, versiune, sursa='ANEXA7'})`.
Antetul se cauta dupa continut (normalizare comuna TGZ), nu dupa numarul randului; tipizatul Model 7 are 30 de coloane pe randul 5.
Cele doua coloane Sat se disting prin pozitia fata de Nume / Adresa; coloanele lipsa sau duplicate ambigue refuza fisierul explicit.
Un rand = parcela + detinator, fara Nr.Crt. Identitatea este exact helperul TGZ `cheieSursa(uat3, poz_hg, nr_cadastral, tarla)`;
aceeasi cheie valida reuneste detinatorii. HG identic cu cadastru/tarla diferite NU inseamna aceeasi cheie.
Fara HG si cadastru, fiecare rand ramane parcela separata in `fara_cheie`, exclusa de scrierea existenta.
Contradictiile de sat/suprafata/categorie pastreaza prima valoare si sunt notate in observatiile parcelei; `ambigue=0`.
UAT se potriveste dupa nume normalizat sau cod; necunoscut, nume gol, tronson invalid ori suprafata invalida = eroare pe rand, rand sarit.
Tronsonul vine numai din configurare; Tronson / km din fisier se pastreaza in observatii. Suprafata foloseste helperul numeric TGZ;
textul de forma `1.234` este semnalat drept ambiguu in `sursa_date` (interpretarea helperului: 1234); nu se inventeaza zero pentru lipsa.
Calitatea se mapeaza prin prefix normalizat la cele sase valori CALITATI; necunoscuta = proprietar cu nota de verificare.
Neidentificat=DA impune calitatea neidentificat si adresa necunoscuta. Decedat=DA produce `decedat=true` in preview.
Cota ramane text; actul, mostenitorii/sursa lor, utilizatorul cunoscut, reprezentantul/mandatul, despagubirea, stadiul, observatiile
si data actualizarii se pastreaza ca note in `sursa_date`, dupa sursa din coloana 29 (rezerva ANEXA7). Nu se creeaza persoane din note.
Deduplicarea este pe parcela + nume normalizat; randurile duplicate sunt raportate si continutul lor se pastreaza in `sursa_date`.
Contactul apare numai daca exista cel putin un camp de contact in fisier; adresa vine direct din coloanele 13-17,
judetul lipsa se ia din UAT; telefon/e-mail din 18-19. Adresa cunoscuta necesita strada sau comuna si detinator identificat.
Preview-ul are aceleasi colectii si contoare ca TGZ, inclusiv contoarele eligibile `*_de_importat`; `antet={rand,chei}` foloseste
index 0-based (4 pentru tipizat), spre deosebire de antetul istoric TGZ. ID-urile sunt provizorii pana la RPC-ul existent.
UI selecteaza parserul dupa sursa si trimite `sursa='ANEXA7'` catre `scrieImport`, care ramane neschimbat.
**Limita existenta:** `scrieImport` nu include coloana booleana `decedat` la INSERT; valoarea este disponibila in preview si pastrata
textual in `sursa_date`, dar NU devine `red_detinatori.decedat=true` prin acest flux. Corectarea scrierii necesita felie separata.
Nu se actualizeaza atributele persoanelor/parcelelor deja existente. Importul real nu a fost rulat.

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

## 10. Șabloane reale (Model_1..7, Final_v2 din 03.11.2026; înlocuiesc v5 din 01.11.2026) — adăugat 01.11.2026, actualizat 03.11.2026 (PR #964)
Harta completă placeholder → sursă: `docs/redari/SABLOANE.md`. Originalele: `docs/redari/referinta/` (Model_1..5 .docx Final_v2 din
03.11.2026 — înlocuiesc v5, Model_6 registru .xlsx și cele 3 PDF-uri din pachetul v3, Model_7 tipizat Anexa 7 .xlsx v5 și v6). Șabloanele cu placeholder-e,
refăcute cu `node scripts/redari_sabloane_din_modele.mjs`, verificate cu `node scripts/redari_sabloane_verifica.mjs` (0 placeholder-e rupte) și
completate de probă cu `completeazaDocx` strict: `public/redari/sabloane/convocator.docx` (Model 1, 36 placeholder-e), `pv_a.docx`
(Model 2, 51 — fără fotografii), `pv_b.docx` (Model 3, 72 — fără foto / topo / jurnal), `adresa_uat.docx` (Model 4, 40, inclusiv
rândul-șablon `{{rand.*}}`; Final_v2 nu mai are antetul firmei), `pv_c.docx` (Model 5, 23).
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
  `stadiu_verificare text`; parserul Anexa 7 exista separat in `importAnexa7.js` (vezi sectiunea 7); aceste informatii raman note, fara coloane noi.
- `red_numere`: cheie `AU` (adrese UAT) dacă se numerotează în ERP.
- Decizii deschise: `link_afisare` (pagină publică pe UAT fără token sau se scoate din Anexa 2), `act_identitate`/`act_doveditor`
  (rămân de mână, nu se stochează), `pva_sesiune` vs `pva_corespondenta` (calcul pe `trimis_spre_semnare_data`), tabelul de
  parcele/articole din PV C (nu există în Model_5; anexa = export xlsx din registru).
# Schema PV - DECIS 02.11.2026, felia 4a (20261129a)

Schema pregatita, neaplicata aici. Coloanele sunt nullable, fara default, cu exceptia reluare.

| Tabel | Coloane noi / contract |
| --- | --- |
| red_procese_verbale | lucrari jsonb, stare_teren jsonb: NULL sau obiect; bife confirmate de operator, structura interna definita de UI ulterior |
| red_procese_verbale | plan_situatie boolean, foto_nr integer >= 0: anexe pe PV, nu pe parcela |
| red_procese_verbale | constatare_mod text: sediu/teren explicit; reverificare_la date; alte_observatii text |
| red_procese_verbale | motiv_pv_b text: declaratie/neprezentat/neidentificat/refuz, numai tip B; refuzul nu schimba formularul public |
| red_procese_verbale | semnat_la_sesiune boolean explicit pentru agregarea PV C; NULL = necunoscut, nu se deduce din data trimiterii |
| red_procese_verbale | identitate_verificata boolean: doar confirmarea verificarii; actul de identitate NU se stocheaza |
| red_parcele | verificare_data date, verificare_de_gazpet text, verificare_de_tgz text, jurnal_santier_ref text: comisia verifica o data inaintea sesiunii; referinta libera, Executie ulterior |
| red_detinatori | act_doveditor_cunoscut boolean: Anexa 7 col.12 DA=true, NU=false, altfel NULL; continutul actului nu este stocat |
| red_convocari | adresa_tgz_nr text; reluare boolean NOT NULL DEFAULT false; UNIQUE partial detinator_id WHERE reluare AND stare <> 'anulat' AND sters_la IS NULL |
| red_uat | responsabil_id uuid FK profiles(id): responsabil Gazpet pe primarie, Model 6 AL |

Cele 4 coloane ale parcelei au GRANT SELECT/INSERT/UPDATE explicit pentru authenticated si sunt adaugate la finalul
red_v_parcele. Vederea pastreaza optiunile, owner-ul si ACL. valoare_lei ramane exclusa.
Politicile/RLS si fn_red_jurnal nu se modifica; pre/post verifica amprenta celor 15 politici.
Importul nou persista decedat prin d.decedat === true si act_doveditor_cunoscut inclusiv false/NULL.
Nu modifica detinatorii deja existenti. Aceasta precizare inlocuieste limita istorica din felia 3b.


### PV C - 20261129d (versiune 20261129120300)

`fn_red_pv_c_creeaza(p_proiect_id uuid, p_tronson int) RETURNS red_procese_verbale`:
SECURITY DEFINER, search_path public, pg_temp; auth.uid() obligatoriu, doar admin.
Advisory lock pe red_pv_c|proiect|tronson precede verificarile. Tronson 1..11 (22023),
minimum o parcela activa (P0002), fara PV C activ in acelasi proiect/tronson (P0001),
fara parcele cu tip_pv NULL (P0001 cu numarul lipsurilor). Obiectiile nu blocheaza.
Numarul PVC si INSERT sunt in aceeasi tranzactie; data este Europe/Bucharest.
`uat_id` este numai ancora ceruta de schema: UAT cu cele mai multe parcele active,
egalitate rezolvata prin uat3 alfabetic. Tabela PV nu are proiect_id; se deduce prin UAT.
`fn_red_pv_creeaza('C',...)` indica noul RPC; restul corpului si ACL sunt pastrate.
Garda `red_pv_c_garda` pastreaza politicile existente: INSERT C direct ca authenticated este
refuzat (se foloseste RPC); orice UPDATE C cere admin. Triggerul 4c ramane intact.
Editor/viewer citesc ecranul si PV C. Accesul Storage ramane cel existent; viewer poate
primi refuz la descarcare (nu sunt extinse drepturile Storage in aceasta felie).
Revenirea armata refuza orice PV C existent, inclusiv anulat/sters, si restaureaza corpul 4b.
Limita: lock-ul serializeaza crearile C prin RPC; nu ingheata modificarile concurente ale
parcelelor sau PV A/B. PV C reprezinta verificarea la crearea/generarea lui, nu un snapshot SQL durabil.
PV C se scoate prin anulare; garda refuza schimbarea sters_la, inclusiv reactivarea.

### 8a - Tronson optional si atribuire HG (02.11.2026)

Contractul de mai sus este actualizat de 20261129g (versiune 20261129120600).
Importul nu mai cere tronson: id_parcela = UAT3-nnnn, fara prefix T; tronson
NULL inseamna neatribuit. Numerotarea este per UAT3 (cheie P-UAT3), globala
pentru codul UAT3; unicitatea existenta (proiect_id,id_parcela) ramane.
Tronson poate fi modificat dupa insert; triggerul refuza 23514 daca exista
PV C activ in proiect pe tronsonul vechi sau nou. Activ = tip C,
stare <> anulat, sters_la IS NULL. Identitatea parcelei ramane imutabila.

fn_red_seteaza_tronson(p_proiect_id uuid,p_uat_id uuid,p_hg_de_la integer,
p_hg_pana_la integer,p_tronson integer) RETURNS integer: SECURITY DEFINER,
search_path public, pg_temp; EXECUTE authenticated; exclusiv admin/owner.
NULL p_uat_id = toate UAT-urile proiectului; UAT strain/inexistent = 23503.
Interval inclusiv, limite >=1 si ordonate, tronson 1..11; invalid = 22023.
Numai parcele active; prefixul initial de cifre din poz_hg (12A -> 12).
Fara prefix numeric: ramane neatins; atribuirea individuala vine in 8b.
Conversia este numeric pentru a evita overflow int pe text liber.
Blocare PV table -> parcel table -> randuri ORDER BY id; refuz P0001
daca sursa sau destinatia are PV C activ; returneaza randurile actualizate,
inclusiv cele care aveau deja aceeasi valoare. UPDATE direct si RPC cer
READ COMMITTED (25001 altfel), pentru a nu valida pe snapshot vechi.

fn_red_pv_c_creeaza pastreaza semnatura/ACL/lock_timeout existente; dupa
lock-uri refuza P0001 daca proiectul are orice parcela activa cu tronson
NULL, chiar daca este din alt UAT/tronson. Nu schimba red_v_tronson,
fn_red_pv_creeaza sau red_pv_b_semnare; 20261129f poate lipsi din main.
8a nu modifica UI/importul. Regula noua priveste crearea C; semnarea si
adaugarea ulterioara a unor parcele neatribuite raman in contractele existente.
Migrarea refuza tabel red_parcele nevid. Revenirea armata blocheaza intai
tabelele si refuza orice parcela cu ID nou/NULL tronson, inclusiv stearsa.
Felia 7, migrarea 20261129f (20261129120500): red_v_tronson pastreaza lista/ordinea/tipurile coloanelor, security_invoker si ACL. Detinator activ = sters_la IS NULL; PV A semnat activ = stare semnat si sters_la IS NULL; PV B activ = stare <> anulat si sters_la IS NULL. Zero detinatori activi nu produce A: numai B activ poate acoperi parcela. Obiectiile deschise raman neschimbate. RPC-urile PV C folosesc aceasta vedere fara modificari.
