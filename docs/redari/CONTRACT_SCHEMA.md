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
migrare față de textul inițial sunt marcate mai jos cu **[mig]**; completările cerute de coordonator / Jakarinos r1 cu **[r1]**.

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
text_declaratie text NOT NULL` **[r1]** (textul declarației „nu particip — fără obiecții”, cu un implicit scurt în migrare; îl citește
formularul public), `activ bool default true, created_at`.

### red_uat
`id, proiect_id FK, nume text NOT NULL, uat3 text NOT NULL` (3 litere mari, ex. PRU/GOD/HUS/CAZ/ILO/BAL/SIS; UNIQUE (proiect_id, uat3)),
`judet, primarie_adresa, primarie_email, primarie_telefon, reprezentant_uat_nume, reprezentant_uat_functie,
sesiune_zi1 date, sesiune_zi2 date, sesiune_zi3 date, program_zi1 text, program_zi2 text, program_zi3 text,
afisare_pv_nr, afisare_data_start date, afisare_data_end date, created_at`.

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
neîncărcat, de reluat.

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
date_noi jsonb, user_id uuid, user_email text, created_at`. Trigger AFTER INSERT/UPDATE/DELETE pe red_* (nu pe red_jurnal),
`user_email` din `auth.jwt() ->> 'email'`. SELECT pentru admin/editor/viewer, INSERT doar prin trigger (funcție SECURITY DEFINER);
UPDATE/DELETE/TRUNCATE refuzate de trigger pentru oricine, inclusiv postgres.
**[mig]** Excepții: `red_rate_limit` (contor anonim — ar umple jurnalul) și `red_detinatori_token` (secret) NU se jurnalizează; pe `red_parcele`
`valoare_lei` e înlocuit cu `valoare_lei_setata` (bool); rândurile cu `tabela = 'red_detinatori_contact'` (PII) le văd doar admin/editor;
un UPDATE care schimbă doar `updated_at` nu produce rând. `inregistrare_id` = `id` (sau `detinator_id` la contact; NULL la red_numere).

### red_numere  (numerotare fără refolosire)
`cheie text PK` (ex. `C`, `PVA-HUS`, `PVB-HUS`, `PVC-T3`), `ultimul int NOT NULL default 0`.
`public.fn_red_numar_document(p_tip text, p_uat3 text, p_tronson int) RETURNS text` — SECURITY DEFINER, UPDATE … RETURNING
cu lock pe rând, EXECUTE doar authenticated (verifică `fn_red_nivel() IN ('admin','editor')` înăuntru). Formate: `C-0001`,
`PVA-HUS-0001`, `PVB-HUS-0001`, `PVC-T3-0001`.

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
  `false` la `ok:true`; timpul de răspuns constant nu e cerut). Token cu format greșit (nu 32..128 caractere `[A-Za-z0-9_-]`) → la fel,
  fără interogare. Rate limit **[mig]**: doar pe IP (30 / 10 min) → `{ok:false, motiv:'prea_multe'}`; contorul pe token nu se consumă la
  afișare, ca să nu blocheze trimiterea.
- `fn_red_raspuns_public(p_token text, p_optiune text, p_zi date, p_obiectii text, p_declaratie_confirmata bool, p_user_agent text)
  RETURNS jsonb` — ordinea: rate limit IP (30 / 10 min) → rate limit token (5 / 10 min, cheia = sha256 al tokenului, se consumă și pe
  tokenuri invalide) → `{ok:false, motiv:'prea_multe'}`; token (format, existență, expirare) → `token_invalid`; opțiune →
  `optiune_invalida`; `particip` cu `p_zi` dat care nu e una din zilele UAT-ului → `zi_invalida` (p_zi poate lipsi);
  `nu_particip_fara_obiectii` fără `p_declaratie_confirmata = true` → `declaratie_neconfirmata`; `constatare_teren` /
  `nu_particip_cu_obiectii` cu `p_obiectii` gol → `obiectii_lipsa`, peste 4000 caractere → `obiectii_prea_lungi` (la celelalte opțiuni
  obiecțiile se ignoră). Inserează în red_raspunsuri cu `canal='online'`, `ip_sau_sursa` = primul IP din
  `current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for'` (NULL dacă lipsește), `user_agent` (≤ 500), `raw_payload`
  (fără token), `created_by NULL`. Succes: `{ok:true, raspuns_id, optiune, deja_raspuns:false}`. **[r1]** Al doilea răspuns pe același token
  e ACCEPTAT (istoricul rămâne, ultimul contează în stare): `{ok:true, raspuns_id, optiune, deja_raspuns:true, mesaj:'Răspunsul anterior a
  fost înlocuit.'}`. NU trimite email/SMS, NU generează PV (decizia 6: manual). Toate erorile așteptate vin prin jsonb, nu prin EXCEPTION.
- `red_rate_limit`: fereastră fixă de 10 minute pe cheie (`fereastra_start`); când expiră, contorul pornește de la 1.

## 6. Storage
Bucket privat `redari` (**[mig]** 25 MB / fișier; MIME: `application/pdf`,
`application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `image/jpeg`, `image/png` — scanul PV-ului semnat poate fi
poză); căi `{proiect_cod}/{uat3}/{id_parcela}/{nr_document}.docx|.pdf`. Politici `red_storage_sel / _ins / _upd` pe storage.objects:
SELECT/INSERT/UPDATE pentru `fn_red_nivel() IN ('admin','editor')`, fără DELETE. În tabele se salvează `*_path` (calea în bucket), nu
URL-uri semnate.

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
