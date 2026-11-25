# Ofertare: aceeași cantitate, documente diferite (TKT-2026-0329, varianta A) — planul de implementare

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Diferențele mari dintre documentele aceleiași licitații (ex. 6.400 m în F3, 3.995 m în ATR) ajung în fața echipei ca semnal cu dovezi verificate din ambele surse și ca ciornă de clarificare `auto_surse_*`, care intră în circuitul de protecție al ciornelor automate. Nimic nu pleacă singur.

**Architecture:**
- Trei PR-uri draft, în ordinea: PR-BD → PR-extragere → PR-UI. Fiecare e livrabil singur; cele două de cod se îmbină doar după aplicarea migrării.
- **PR-BD** = o migrare L15 v2 NEAPLICATĂ: listele închise (`ofertare_elemente_masura`, `ofertare_tipare_cantitate`), tabelele `ofertare_cantitati_masuratori` (dovezi) și `ofertare_cantitati_semnale` (identitate + evaluare), setările pe licitație, verificarea deterministă a dovezilor în SQL, RPC-ul de publicare atomică (semnal + ciornă) și extinderea explicită a circuitului `auto_planse_*` la `auto_surse_*`.
- **PR-extragere** = pasul determinist din modul `structurat` al edge-ului `ofertare-cantitati-extrage`: din observațiile deja extrase (AI-ul propune unde e valoarea) construiește măsurătorile candidate, le trimite serverului spre verificare și cere publicarea, sub plafonul de pagini.
- **PR-UI** = ecranul semnalelor (verdict + ambele dovezi + `neverificat` cu motiv), ciornele `auto_surse_*` în Clarificări, „răspuns posibil relevant” la urcarea unui răspuns al Autorității.

**Tech Stack:** PostgreSQL 17 (Supabase), plpgsql, PGlite pentru probe locale, Deno (edge) + testele `*_test.ts`, React 18 + Vite, vitest.

**Spec:** `docs/superpowers/specs/2026-11-25-ofertare-cantitati-intre-surse-design.md` (v3, GO Jakarinos r3). Executorul citește spec-ul integral; planul nu-l repetă.

## Global Constraints

- **Repo public.** Fără nume de persoane, firme, licitații, prețuri. Testele folosesc licitații sintetice (`id` 900001…), documente `DOC_F3_T`, `DOC_ATR_T`, uuid-uri `00000000-0000-4000-8000-0000000000NN`, cazul din tichet scris generic (6.400 / 3.995 m).
- **NEAPLICAT.** Migrarea și revenirea se livrează nerulate. Probele pe clonă, manifestul `.l15.tsv`, aplicarea (runner L15 v2) le face chat-ul după GO Jakarinos pe head și „da”-ul owner-ului. Rocky n-are acces la BD: amprentele md5 ale corpurilor din producție (secțiunea „Ce cere chat-ul”) vin de la chat în brief, nu se ghicesc.
- **Migrarea** urmează tiparul L15 v2 din `supabase/migrations/20270111a_ctc_autorizatii_ndt.sql` (migrare care MODIFICĂ obiecte existente): `$pre$` (garda de start, plafon 5000 ms pus de runner, `AMPRENTA_GLOBALA_LIPSA`, refuz la reaplicare, coloanele citite verificate prin `information_schema`, dependențele pe `md5(replace(prosrc, chr(13), ''))` + owner / DEFINER / ACL), `$lock$` (punct unic NOWAIT, buget 1 s, `gazpet.lock_puternic_la`), `$stare$` (starea exactă sub lock), obiectele, `$post$` (postcondiții exacte, lista triggerelor, drepturile ca `rol:drept`, „funcțiile noi cheamă doar…”). Fișier: `supabase/migrations/20270112a_ofertare_cantitati_masuratori.sql` (numărul verificat pe toate branch-urile `origin/*` la 25.11.2026: ultimul e `20270111a`).
- **Funcții.** RPC-urile UI / edge: `SECURITY DEFINER SET search_path = public, pg_temp`, nume calificate, identitatea doar din `auth.uid()` (L08), accesul reverificat DUPĂ lock-uri (L09). Drepturi: `REVOKE ALL … FROM PUBLIC, anon`, `GRANT EXECUTE` doar rolului care le cheamă (`authenticated` pentru UI, `service_role` pentru edge). Funcțiile de trigger și cele `*_intern`: fără EXECUTE pentru clienți. Erorile de business au cod stabil la începutul mesajului: `CM_<COD>: …` (SQLSTATE `P0001`); drept lipsă = `42501`.
- **Tabele noi:** `ENABLE ROW LEVEL SECURITY`, politică doar `FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL AND public.fn_are_acces_ofertare())`, `REVOKE ALL` + `GRANT SELECT TO authenticated, service_role`; nicio scriere directă (spec §3.7). Listele închise: SELECT pentru `authenticated`, scriere doar în migrare.
- **Ordinea lock-urilor (L06)**, aceeași în toate RPC-urile și triggerele noi, scrisă în comentariu în fiecare: (0) `pg_advisory_xact_lock(hashtextextended('ofertare_cantitati_semnale:' || licitatie_id, 0))`; (1) `ofertare_licitatii` rândul licitației `FOR SHARE`; (2) `ofertare_cantitati_semnale` rândul semnalului `FOR UPDATE`, în ordinea `id`; (3) `ofertare_clarificari` ciorna `FOR UPDATE`. Trigger-ul existent `trg_ofertare_cb_clarificari_jurnal` ia `ofertare_licitatii FOR NO KEY UPDATE NOWAIT` doar la `trimisa`, pe care RPC-urile noi nu o scriu niciodată.
- Respectă `docs/paw/LECTII_REVIEW.md` (L01–L25) și raportează matricea în fiecare PR. Fișiere SQL fără BOM; `.mjs` fără shebang; LF.
- **Nume de obiecte (toate PR-urile):** tabele `ofertare_elemente_masura`, `ofertare_tipare_cantitate`, `ofertare_cantitati_setari`, `ofertare_cantitati_masuratori`, `ofertare_cantitati_semnale`; funcții `fn_ofertare_masura_*` / `fn_ofertare_semnal*`; cheia ciornei `auto_surse_<identitate>` unde `identitate = left(md5(licitatie_id || '|' || masura_canonica), 16)`.

## Decizii de construcție (review-ul le poate întoarce înainte de cod)

1. **Două tabele, nu unul.** Spec §3.7 numește `ofertare_cantitati_masuratori`; spec §3.4 cere „lock pe rândul semnalului” și o identitate stabilă separată de evaluare. De aceea: `ofertare_cantitati_masuratori` = dovezile unei evaluări (imuabile, FK spre semnal, cantitate și document); `ofertare_cantitati_semnale` = un rând pe identitate (licitație + măsura canonică), cu evaluarea curentă. Abatere declarată față de litera §3.7, nu față de intenție.
2. **Sursa valorilor propuse = observațiile existente** (`ofertare_cant_obs`, 20261031a): au deja `document_id`, `doc_sha256`, `pagina`, `citat`, `cantitate_offset`, `um_norm`, `tip_lucrare`, `masura`, `dn_mm`, `material`, `obiect_cheie`, `lot_*`. Nu se face un al doilea apel AI; comparația rulează în aceeași rulare `structurat`, după extragere (spec §3.8). Partea F3 vine din `ofertare_cantitati` (rândurile cu `status <> 'retrasa'`), dovada ei = `surse_document_ids[1]` + citatul rândului în `text_extras`.
3. **Verificarea dovezilor și regula numerică trăiesc o singură dată, în SQL** (L19): `fn_ofertare_masura_verifica` și `fn_ofertare_numar_ro`. Edge-ul doar propune. `cantNumar.ts` (convenția documentului, pentru extragere) NU decide nimic la măsurători: regula spec §3.3 e mai strictă („1.23” = ambiguu). Testul de paritate (Task 7) dovedește că cele două NU se contrazic pe cazurile din spec și documentează unde diferă.
4. **Maparea observație → element / natură (lista închisă, în migrare, tabelul `ofertare_elemente_masura`):** `tip_lucrare` + `dn_mm` + `material` → `element` (`teava_pe_dn<N>`, `teava_ol_dn<N>`, `bransament_<tip>`, `robinet_dn<N>`, `sapatura`, `refacere`); `masura` → natura: `material` → `furnizare`, `montaj` → `montaj`, `proba` → `proba`, `lungime` → `total_lucrare` DOAR pentru rolurile de document `atr`, `cs`, `memoriu`, `plansa`, `raspuns`; `lungime` pe `f3` / `c6` / `lista_alt` fără cuvânt-cheie de natură = natură necunoscută → `de_verificat`. `alt` → fără măsură (nu intră).
5. **Pragul și plafonul stau pe licitație într-un tabel separat** `ofertare_cantitati_setari(licitatie_id PK, prag numeric(5,4) DEFAULT 0.0500, plafon_pagini int DEFAULT 200, setat_de, setat_la)`, scris doar prin `fn_ofertare_semnale_setari(p_licitatie_id, p_prag, p_plafon)` cu drept de decizie; `ofertare_licitatii` are gărzi de scriere (J05, loturi) și nu primește coloane (ca `ofertare_termen_clarificari`, 20261031a). Lipsa rândului = valorile implicite din spec.
6. **Documentul șters.** FK-urile măsurătorilor spre `ofertare_documente_atribuire` sunt `ON DELETE CASCADE` (dovezi derivate, recalculabile); semnalul rămâne, iar la următoarea evaluare componenta lipsă dă `neverificat: sursă dispărută`, ciorna `propunere` needitată se retrage de sistem. Fără CASCADE, ștergerea unui document din ecranul existent ar pica cu o eroare de FK pe care nimeni n-o așteaptă.
7. **Starea ciornelor `auto_surse_*` pentru circuit** = o funcție nouă `ofertare_semnal_baza_stare(p_clarificare_id)` (amprenta evaluării curente vs `evaluare_amprenta` aprobată, `evaluare_in_curs`, ultimul verdict), iar `ofertare_clarificare_baza_stare` (F3) rămâne pentru `auto_planse_*`. Dispecerul după prefixul cheii e **o singură funcție** `fn_ofertare_ciorna_auto_stare(c ofertare_clarificari)`, chemată din trigger, view și export (L19). Mesajul blocant e unul singur: `baza s-a schimbat — de reverificat` (constanta `MESAJ_SCHIMBATA` din `src/ofertareClarificariBaza.js`).
8. **Documentele comparate (spec §3.8)** = observațiile cu rolul `f3`, `c6`, `lista_alt`, `atr`, `cs`, `memoriu`, `plansa` din extragerea structurată; rolurile `fisa_date` și `raspuns` nu intră. Tipul `formular` nu e azi în `TIPURI_ELIGIBILE` ale modului structurat (`structurat.ts:46`) și planul NU îl adaugă (ar lărgi extragerea plătită); partea F3 vine oricum din `ofertare_cantitati`. `ofertare_cantitati.cantitate_plansa` nu e folosită ca valoare (n-are dovadă pe pagină); planșele intră doar prin observațiile lor cu `pozitie_dovedita`.
9. **Textul ciornei** e generat în SQL (RPC-ul de publicare), nu în edge, ca amprenta `gen_<md5[:12]>` și detecția „text needitat” să fie identice cu mecanismul `auto_planse_*` (`sursa = 'surse_auto:<doc_a>,<doc_b>,gen_<…>,ev_<…>'`).

## Inventarul circuitului de protecție `auto_planse_*` (spec §3.5) — ce se extinde, unde, cu ce test

Sursa de adevăr pentru corpurile LIVE nu e în `supabase/migrations/`: funcțiile R9b au fost aplicate prin MCP din `docs/R5_MIGRARE_PROPUSA_cantitati_nevalidate.sql` și rescrise în `docs/R5_MIGRARE_3_review_copilot.sql` (ultima formă cunoscută în repo). Migrarea verifică în `$pre$` amprenta fiecăruia (valorile le dă chat-ul de pe clonă) și refuză la orice diferență.

| # | Punct | Unde (fișier:linie, forma cunoscută) | Cheie azi | Extinderea în PR-BD | Testul |
|---|---|---|---|---|---|
| 1 | Helper UI `eCiornaAutomata` | `src/ofertareClarificariBaza.js:4`; consumatori: `OfertareClarificari.jsx:637`, `OfertareLicitatii.jsx:801` (filtru `like('cheie','auto_planse_%')`), `:806`, `:3926`, `:4055` | regex `^auto_planse_` | PR-UI Task 12: regex `^auto_(planse|surse)_`; filtrul din `OfertareLicitatii.jsx:801` rămâne pe `auto_planse_%` (e cardul planșelor), semnalele au cardul lor | `ofertareClarificariBaza.test.js`: `auto_surse_x` → automată; `auto_sursex` / `manual` → nu |
| 2 | RPC reconfirmare `ofertare_clarificare_reconfirma` | `docs/R5_MIGRARE_3_review_copilot.sql:556–591` (refuzul `NOT LIKE 'auto_planse_%'` la :565; baza F3 la :568, :578–579) | `LIKE 'auto_planse_%'` | Task 4: acceptă ambele prefixe; pentru `auto_surse_*` tokenul = `md5(evaluare_amprenta_curenta || '|' || md5(intrebare))`, scrie `baza_generare.reconfirmare` cu `evaluare_amprenta`; `luat_act` identic | `t4_reconfirmare_surse`: token corect → ok; după schimbarea cantității → `textul sau baza s-au schimbat`; fără drept de decizie → eroare |
| 3 | RPC excepție identitate `ofertare_clarificare_exceptie_identitate` | `docs/R5_MIGRARE_3_review_copilot.sql:612–647` (:620) | `LIKE 'auto_planse_%'` | Task 4: rămâne DOAR pe `auto_planse_*` (identitatea documentelor e un concept al bazei F3); pe `auto_surse_*` întoarce `error: 'nu se aplică ciornelor de surse'` | `t4_exceptie_surse_refuz` |
| 4 | Trigger `trg_ofertare_clarificari_baza` / `fn_trg_ofertare_clarificari_baza` | `docs/R5_MIGRARE_3_review_copilot.sql:53–124`: DELETE blocat :59; `v_auto` :65; INSERT client refuzat :95; `baza_generare` doar prin reconfirmare :96; `sursa` înghețată :97; editarea scoate aprobarea :99–106; `de_trimis`/`trimisa` cer stare `ok` :117–121 | `LIKE 'auto_planse_%'` în :59, :65 | Task 4: `v_auto := cheie ~ '^auto_(planse|surse)_'` (și pe OLD la UPDATE / DELETE); blocul :117–121 cheamă dispecerul (decizia 7) | `t4_trigger_surse`: ca `authenticated` cu drept: INSERT cu cheie `auto_surse_x` → refuz; UPDATE `baza_generare` → refuz; UPDATE `sursa` → păstrată; editarea textului → `propunere` + `text_editat_de`; `de_trimis` fără reconfirmare → refuz; DELETE → refuz; fără drept de decizie → `de_trimis` refuzat |
| 5 | View `v_ofertare_clarificari_baza` | `docs/R5_MIGRARE_PROPUSA_cantitati_nevalidate.sql:1267–1276` (`WHERE cheie LIKE 'auto_planse_%' AND status <> 'retrasa'`) | `LIKE 'auto_planse_%'` | Task 4: `WHERE cheie ~ '^auto_(planse|surse)_'`, starea prin dispecer; coloanele existente neschimbate (UI-ul le citește după nume) | `t4_view_surse`: ciorna `auto_surse_*` apare cu `stare`, `amprenta_curenta`, `text`; cea retrasă nu; `authenticated` fără acces Ofertare → 0 rânduri |
| 6 | RPC export `ofertare_clarificari_export` | `docs/R5_MIGRARE_3_review_copilot.sql:593–609` (:602–604) | `LIKE 'auto_planse_%'` | Task 4: blocul pe `~ '^auto_(planse|surse)_'`, starea prin dispecer; blocat la `schimbata`, `evaluare_in_curs`, `fara_diferenta` | `t4_export_surse`: aprobată pe bază → exportată; cantitate schimbată → `Export blocat: baza s-a schimbat — de reverificat`; prag schimbat → blocat; inventar schimbat → blocat; verdict devenit `in_regula` → blocat |
| 7 | Trigger proveniență `fn_ofertare_surse_valideaza` | `supabase/migrations/20261026a_ofertare_rigoare_provenienta.sql:96–170` (keyed pe `origine = 'automat'`, parsează doar `planse_auto:`) | `origine` | Neatins. RPC-ul de publicare scrie `surse_document_ids` și `surse_cantitati_ids` explicit (serverul are voie); trigger-ul le reunește | `t5_provenienta`: după publicare `surse_document_ids = {doc_a, doc_b}` și `surse_cantitati_ids` = rândurile F3 agregate; `authenticated` nu le poate schimba (42501) |
| 8 | Trigger jurnal `trg_ofertare_cb_clarificari_jurnal` | `supabase/migrations/20261031a_ofertare_cantitati_b.sql:1200–1260` | fără cheie | Neatins; retragerea de sistem (`retrasa`) jurnalizează ca azi | `t5_jurnal`: după `retrasa` de sistem există rândul în `ofertare_clarificari_jurnal` |
| 9 | Notificarea `ofertare_clarificari_notifica` | `supabase/migrations/20261121a_ofertare_responsabil2.sql:315–339` (:326 `LIKE 'auto_planse_%'`) | `LIKE 'auto_planse_%'` | Task 4: `~ '^auto_(planse|surse)_'`, starea prin dispecer; o notificare pe amprentă (`notificat_neactual`) | `t4_notifica_surse`: bază schimbată → 1 notificare responsabililor; a doua rulare → 0 |
| 10 | Generatorul planșelor `ofertare_clarificare_planse_auto` | `20261121a:387–557` (`LIKE 'auto_planse_%'` peste tot) | `auto_planse_%` | Neatins: cheile `auto_surse_*` nu intră în `v_acoperite` / `v_draft` (prefix diferit) | `t5_planse_neatins`: cu o ciornă `auto_surse_*` prezentă, apelul generatorului nu o modifică |
| 11 | Scrierea directă de client pe ciornă | `src/OfertareClarificari.jsx:147–151` (`saveQ`: `intrebare`, `raspuns`, `raspuns_document_id`, `status`), `:215` (`delQ`) | — | Acoperit de #4 (trigger). PR-UI ascunde „🗑” pe ciornele automate (azi trigger-ul refuză cu eroare brută) | `ui_fara_stergere_auto` în `ofertareSemnale.test.js` |
| 12 | Regresiile existente pe `auto_planse_*` | `scripts/pg/test_r5_review_f.mjs`, `scripts/pg/test_r9b_probe23.mjs`, `scripts/pglite/test_r9b_decisive.mjs`, `scripts/test_ofertare_rigoare_provenienta.sh`, `scripts/test_ofertare_provenienta_derivate.sh` | — | Rulate pe clonă DUPĂ migrare (L25); planul nu le schimbă | chat-ul, în proba pe clonă (secțiunea „Ce cere chat-ul”) |

## Review Focus

1. **Aceeași poziție F3 numărată de două ori** (felii suprapuse, același `hash_rand` în două extrageri, sau rând F3 cu `status = 'diferenta'` + rândul lui înlocuitor): suma agregată ar fi dublă. Test `t3_identitate_pozitiei` (Task 3) și `m_dedup_obs` (Task 7).
2. **Numere cu spațiu neîntrerupt sau zecimale** („6 400 m”, „3.995,50 m”, „6400,0”): primul și al treilea sunt întregi valide, al doilea e număr RO valid dar nu e întreg → la text liber `neverificat: format numeric ambiguu` (spec §3.2 cere întreg), în tabel acceptat. Test `t2_numar_ro` (Task 2).
3. **Semnal pe lotul greșit** (F3 pe lot 1, ATR pe lot 2, același DN): măsuri diferite, deci niciun semnal fals; lot necunoscut pe una dintre părți → `de_verificat`. Test `t3_loturi` (Task 3).
4. **Document șters sau înlocuit (revizie) între extragere și publicare / după publicare:** `evaluare_depasita` la publicare; după publicare, componenta dispărută dă `neverificat: sursă dispărută` și retrage ciorna needitată. Test `t3_document_sters` (Task 3) și `m_revizie_in_timpul_rularii` (Task 7).
5. **Două rulări pe aceeași licitație alocă același `nr` de clarificare** (nu există UNIQUE pe `(licitatie_id, nr)`): publicarea ia lock-ul consultativ pe licitație înaintea `max(nr)+1`. Test `c_doua_publicari` (Task 5, două sesiuni cu barieră).

---

## PR-BD — baza de date (branch `ofertare/0329-bd`)

### Task 1: Migrarea, partea 1 — gărzile, listele închise, tabelele, RLS, setările

**Files:**
- Create: `supabase/migrations/20270112a_ofertare_cantitati_masuratori.sql` (`$pre$`, `$lock$`, `$stare$`, secțiunile 1–2)
- Create: `supabase/tests/20270112a_ofertare_cantitati_masuratori_schelet.sql` (schema falsă: `ofertare_licitatii`, `ofertare_documente_atribuire` cu `tip`, `revizie`, `text_extras`, `pagini`, `pagini_necitite`, `seap_meta`; `ofertare_cantitati` cu coloanele din spec §2 + `status`, `lot_nr`, `obiect`, `tip_sursa`, `extras_de_ai`; `ofertare_clarificari` cu `cheie`, `origine`, `sursa`, `baza_generare`, `surse_*`, UNIQUE `(licitatie_id, cheie)`; `ofertare_cant_obs` ca în 20261031a; `fn_are_acces_ofertare`, `fn_ofertare_source_pack_poate_decide`, `fn_ofertare_poate_cheltui`; corpurile R9b din `docs/R5_MIGRARE_3_review_copilot.sql` exact, cu amprentele lor calculate)
- Create: `scripts/pglite/test_ofertare_cantitati_masuratori_local.mjs` (runnerul de probe, tiparul `test_ctc_autorizatii_ndt_local.mjs`: pașii L15 v2 reali, validatorul, garda finală; secțiunea t1)

**Interfaces:**
- Produces, tabelele:
  - `ofertare_elemente_masura(cod text PK CHECK (cod ~ '^[a-z0-9_]{3,40}$'), familie text CHECK IN ('teava','robinet','bransament','sapatura','refacere','alta'), um_canonica text CHECK IN ('m','buc','mc','mp','kg'), are_masa boolean NOT NULL DEFAULT false, activ boolean NOT NULL DEFAULT true)` — populat în migrare cu lista din decizia 4 (DN-urile 32…630 pentru țeavă PE și OL).
  - `ofertare_tipare_cantitate(id smallint PK, fel text CHECK IN ('antet_coloana','text_liber'), tipar text NOT NULL, activ boolean)` — `antet_coloana`: `cantitate`, `cant.`, `cant`, `lungime`, `l (m)`, `nr. buc`, `buc.`, `volum`, `suprafata`; `text_liber` (regex PostgreSQL ancorate pe token, L13, cu `\m` / `\M`): `lungime [:=]? N UM`, `L [:=]? N UM`, `in lungime( totala)? de N UM`, `N UM de conducta`, `N buc`. Regexul final = tiparul + grupul numeric `([0-9]{1,3}(\.[0-9]{3})*|[0-9]+)` + UM din lista `fn_ofertare_um_canonica`.
  - `ofertare_cantitati_setari` (decizia 5).
  - `ofertare_cantitati_semnale(id bigint identity PK, licitatie_id bigint NOT NULL REFERENCES ofertare_licitatii, lot_nr int, obiect_cheie text, element text REFERENCES ofertare_elemente_masura(cod), natura text CHECK IN ('furnizare','montaj','proba','total_lucrare'), um_canonica text, identitate text NOT NULL CHECK (identitate ~ '^[0-9a-f]{16}$'), verdict text CHECK IN ('in_regula','diferenta','de_verificat','neverificat'), motiv text, valoare_a numeric, valoare_b numeric, sursa_a text, sursa_b text, inventar jsonb NOT NULL DEFAULT '{}', evaluare_amprenta text CHECK (~ '^[0-9a-f]{64}$'), evaluare_in_curs boolean NOT NULL DEFAULT false, evaluare_la timestamptz, clarificare_id bigint REFERENCES ofertare_clarificari, reaparut_dupa_respingere boolean NOT NULL DEFAULT false, rezolvat_de_raspuns_id bigint REFERENCES ofertare_documente_atribuire, rezolvat_revizie int, valoare_retinuta numeric, UNIQUE (licitatie_id, identitate), CHECK ((rezolvat_de_raspuns_id IS NULL) = (rezolvat_revizie IS NULL)))`. `identitate = left(md5(licitatie_id::text || '|' || coalesce(lot_nr::text,'') || '|' || coalesce(obiect_cheie,'') || '|' || element || '|' || natura || '|' || um_canonica), 16)`, calculată de `fn_ofertare_masura_identitate(...)` IMMUTABLE și impusă prin CHECK.
  - `ofertare_cantitati_masuratori(id bigint identity PK, licitatie_id bigint NOT NULL, semnal_id bigint NOT NULL REFERENCES ofertare_cantitati_semnale ON DELETE CASCADE, parte text CHECK IN ('a','b'), cantitate_id bigint REFERENCES ofertare_cantitati ON DELETE CASCADE, document_id bigint NOT NULL REFERENCES ofertare_documente_atribuire ON DELETE CASCADE, revizie int NOT NULL, doc_sha256 text NOT NULL, pagina int NOT NULL CHECK (pagina BETWEEN 1 AND 99999), fel_dovada text CHECK IN ('tabel','text'), rand text, celula text, fragment text, antet_coloana text, valoare_text text NOT NULL, um_text text, valoare numeric, um_canonica text, verificare text NOT NULL CHECK IN ('ok','fragment_lipsa','rand_lipsa','coloana_necunoscuta','tipar_necunoscut','numar_ambiguu','diametru_nu_cantitate','unitate_incompatibila'), evaluare_amprenta text NOT NULL, creat_la timestamptz DEFAULT now(), CHECK ((fel_dovada = 'tabel') = (rand IS NOT NULL AND celula IS NOT NULL)), CHECK ((fel_dovada = 'text') = (fragment IS NOT NULL)), CHECK ((verificare = 'ok') = (valoare IS NOT NULL)))`. Index `(semnal_id, evaluare_amprenta)`.
  - Trigger `trg_ofertare_masuratori_licitatie` BEFORE INSERT/UPDATE: cantitatea (dacă e dată), documentul și semnalul au `licitatie_id` = al rândului (`CM_ALTA_LICITATIE`); documentul se citește `FOR KEY SHARE`.
  - Trigger de imuabilitate `trg_ofertare_masuratori_imuabil` (tiparul `fn_ofertare_cb_imuabil`, 20261031a): UPDATE refuzat oricui (`CM_IMUABIL`); DELETE permis doar prin CASCADE (`pg_trigger_depth() > 0`) sau din RPC-urile proprii (marcajul `set_config('ofertare.masuratori_rpc', '1', true)` pus de `fn_ofertare_semnale_publica` chiar înaintea ștergerii evaluării depășite și resetat imediat după; marcajul e doar pentru ștergere, nu pentru identitate — L08 rămâne pe `auth.uid()`).

- [ ] **Step 1: Teste PGlite `t1_*`:**
  - `t1_liste`: `ofertare_elemente_masura` are exact lista din decizia 4 (numărul și 3 coduri verificate), `ofertare_tipare_cantitate` are cele 9 antete + 5 tipare, `authenticated` are SELECT și nu are INSERT;
  - `t1_rls`: tabelele noi au RLS activ, nicio politică de scriere, `authenticated` fără acces Ofertare vede 0 rânduri, cu acces vede rândurile licitației lui;
  - `t1_identitate`: același (licitație, lot, obiect, element, natură, UM) → aceeași `identitate`; CHECK-ul refuză o identitate scrisă de mână;
  - `t1_alta_licitatie`: măsurătoare cu documentul altei licitații → `CM_ALTA_LICITATIE`;
  - `t1_imuabil`: UPDATE pe o măsurătoare → `CM_IMUABIL`; DELETE pe document → măsurătorile lui dispar (CASCADE), semnalul rămâne;
  - `t1_reaplicare`: a doua aplicare → `obiectele exista deja (reaplicare)`.
- [ ] **Step 2:** `node scripts/pglite/test_ofertare_cantitati_masuratori_local.mjs --sectiune t1` → FAIL (migrarea lipsește).
- [ ] **Step 3:** Scrie `$pre$`, `$lock$` (ACCESS EXCLUSIVE NOWAIT pe `ofertare_clarificari`, singurul tabel existent modificat prin trigger), `$stare$` (lista exactă a triggerelor de pe `ofertare_clarificari` azi: `trg_ofertare_clarificari_baza`, `trg_ofertare_cb_clarificari_jurnal`, trigger-ul surselor din 20261026a — numele exact îl dă chat-ul; CHECK-ul de status), secțiunile 1–2.
- [ ] **Step 4:** `--sectiune t1` → PASS.
- [ ] **Step 5:** Commit `feat(ofertare): măsurători între surse — liste, tabele, RLS (20270112a, NEAPLICATĂ)`.

### Task 2: Verificarea deterministă a dovezilor și regula numerică (spec §3.2–3.3)

**Files:**
- Modify: migrarea (secțiunea 3)
- Modify: testul (t2)
- Create: `supabase/tests/20270112a_cazuri_numar.json` (tabelul comun de cazuri: text → număr sau motiv; folosit de PGlite, de testul Deno din Task 7 și de vitest din Task 10 — L19)

**Interfaces:**
- `fn_ofertare_numar_ro(p_text text) RETURNS jsonb` IMMUTABLE: `{valoare: numeric|null, motiv: null|'format_numeric_ambiguu'|'nu_e_numar', intreg: boolean}`. Regula spec §3.3: punct = mii doar în grupuri exacte de 3; virgulă = zecimale; spațiu NBSP / fin între grupuri acceptat; `1.234` → 1234; `1,234` → 1.234; `1.23`, `1.2345`, `12.34.5` → ambiguu; `1.234,5` → 1234.5. Nu folosește `::numeric` direct pe textul brut.
- `fn_ofertare_um_canonica(p_um text, p_element text) RETURNS jsonb` IMMUTABLE pe listă: `{um: 'm'|'buc'|'mc'|'mp'|'kg'|null, factor: numeric, motiv}`; conversii doar `km→m ×1000`, `ml→m ×1`, `t→kg ×1000` (doar dacă `are_masa`); altceva → `unitate_incompatibila`.
- `fn_ofertare_masura_verifica(p_text_extras text, p_dovada jsonb) RETURNS jsonb` STABLE: `p_dovada = {pagina, fel_dovada, rand, celula, fragment, antet_coloana, valoare_text, um_text, element}`. Pași, în ordine, primul eșec oprește: (1) textul paginii = între marcajele `⟦PAGINA n⟧` și `⟦PAGINA n+1⟧` (lipsa marcajului → `rand_lipsa` / `fragment_lipsa`); (2) `tabel`: `rand` apare literal, o singură dată, pe pagină; `celula` e un token întreg al rândului (delimitat de ≥ 2 spații, `|` sau TAB) egal cu `valoare_text`; `antet_coloana` normalizat (minuscule, fără diacritice, fără spații duble) e în lista `antet_coloana` ȘI apare pe o linie dinaintea rândului în același tabel, pe aceeași poziție de coloană (±1 token); (3) `text`: `fragment` apare literal pe pagină și se potrivește EXACT cu un tipar `text_liber`; tokenul numeric e întreg, delimitat, lipit de UM; precedat de `DN`, `Dn`, `Ø`, `PN`, `SDR`, `De` sau urmat de `mm` → `diametru_nu_cantitate`; (4) numărul prin `fn_ofertare_numar_ro`, UM prin `fn_ofertare_um_canonica`. Întoarce `{verificare, valoare, um_canonica}`.
- Fără EXECUTE pentru clienți pe toate trei (chemate doar din RPC-urile Task 3); `postgres` le poate chema în probe.

- [ ] **Step 1: Teste `t2_*`:**
  - `t2_numar_ro`: toate cazurile din `20270112a_cazuri_numar.json` (minim: `6.400`→6400, `3.995`→3995, `1.234`→1234, `1,234`→1.234, `1.23`→ambiguu, `1.2345`→ambiguu, `6 400` (NBSP)→6400, `6400,0`→6400 neîntreg, `DN160`→nu_e_numar);
  - `t2_tabel_ok`: pagina sintetică F3 cu antet `Nr. | Cod | Denumire | UM | Cantitate` și rândul `003 SA11G1 TEAVA PE100 DN160 M 6.400` → `ok`, 6400, `m`;
  - `t2_tabel_alt_rand`: `valoare_text` de pe alt rând → `rand_lipsa`; valoarea diametrului (`160`) ca celulă → `coloana_necunoscuta`;
  - `t2_text_ok`: „conductă DN 160, lungime 250 m” → 250 m; „în lungime totală de 3.995 m” → 3995;
  - `t2_text_diametru`: „DN160 … 160 m” cu fragmentul „DN160” → `diametru_nu_cantitate`; „160 mm” → `diametru_nu_cantitate`;
  - `t2_text_nelegat`: „aproximativ 250 de metri” → `tipar_necunoscut`;
  - `t2_um`: `km`→m×1000; `t` pe țeavă → `unitate_incompatibila`; `t` pe element cu masă → kg×1000;
  - `t2_pagina_lipsa`: fragment prezent pe pagina 3, declarat pe 4 → `fragment_lipsa`.
- [ ] **Step 2:** `--sectiune t2` → FAIL. **Step 3:** implementează secțiunea 3. **Step 4:** `--sectiune t1,t2` → PASS. **Step 5:** commit.

### Task 3: Măsura comparabilă, inventarul și evaluarea (spec §3.1, §3.3) + publicarea atomică (spec §3.4)

**Files:**
- Modify: migrarea (secțiunea 4)
- Modify: testul (t3)

**Interfaces:**
- `fn_ofertare_semnale_setari(p_licitatie_id bigint, p_prag numeric, p_plafon_pagini int) RETURNS jsonb`: UI, DEFINER, drept de decizie (`fn_ofertare_source_pack_poate_decide`), `p_prag BETWEEN 0.001 AND 0.5`, `p_plafon_pagini BETWEEN 10 AND 2000`; UPSERT.
- `fn_ofertare_semnale_amprente(p_licitatie_id bigint) RETURNS jsonb` STABLE, `service_role` + `authenticated` cu acces: `{documente: [{id, revizie, sha}], cantitati_sha, prag, plafon}` — fotografia surselor; `cantitati_sha = sha256` peste `id|cantitate|um|status|lot_nr|obiect` ordonate.
- `fn_ofertare_masuratori_propune(p_licitatie_id bigint, p_amprente jsonb, p_candidate jsonb) RETURNS jsonb`: `service_role` (edge). `p_candidate = [{parte, element, natura, lot_nr, obiect_cheie, cantitate_id|null, document_id, dovada}]`. Sub lock-urile (0)–(1): (a) `p_amprente` = `fn_ofertare_semnale_amprente` acum, altfel `{refuz: 'evaluare_depasita'}` fără nicio scriere; (b) pentru fiecare măsură (identitate): UPSERT semnal cu `evaluare_in_curs = true`; (c) fiecare candidat → `fn_ofertare_masura_verifica` pe `text_extras` al documentului CURENT → rând în măsurători cu `verificare`, `evaluare_amprenta = sha256(identitate || amprente || candidate ordonate)`; (d) întoarce `{evaluare_amprenta, semnale: [{id, identitate}]}`. Textul de verificat vine din BD, nu din parametri.
- `fn_ofertare_semnale_publica(p_licitatie_id bigint, p_amprente jsonb, p_evaluare_amprenta text, p_inventar jsonb) RETURNS jsonb`: `service_role`. `p_inventar = {pagini_cautate, pagini_necitite: [{document_id, pagini: []}], componente_asteptate: {identitate: {a: [cantitate_id…], b: [document_id…]}}}`. Sub lock-urile (0)–(3), pentru fiecare semnal cu `evaluare_in_curs`: (a) reverifică `p_amprente` (altfel `evaluare_depasita`: șterge măsurătorile acestei evaluări, `evaluare_in_curs = false`, nimic altceva); (b) agregarea pe măsură: `a` = suma valorilor `ok` ale părții F3, `b` = suma părții document; **fiecare `cantitate_id` / `(document_id, pagina, rand|fragment)` o singură dată**; (c) completitudinea: toate componentele așteptate au măsurătoare `ok` ȘI nicio pagină din `pagini_necitite` nu aparține secțiunii → altfel `neverificat: agregare incompletă` cu lista; (d) formula §3.3 cu pragul licitației; `|a−b| < 1` unitate → `in_regula`; `a = b = 0` → `in_regula`; una 0 sau lipsă → `de_verificat`; (e) tranzițiile ciornei (§3.4): creare `propunere` cu cheie `auto_surse_<identitate>`, `origine = 'automat'`, `nr = max(nr)+1`, `sursa = 'surse_auto:<doc_a>,<doc_b>,gen_<md5(text)[:12]>,ev_<md5(evaluare)[:12]>'`, `baza_generare = {evaluare: 'surse_v1', evaluare_amprenta, text_hash, verdict, a, b, prag}`, `surse_document_ids`, `surse_cantitati_ids`; reactivarea celei retrase de sistem; respinsă de om → `reaparut_dupa_respingere = true` când amprenta diferă; nu mai e `diferenta` + `propunere` needitată (`gen_` = md5 text) → `retrasa` cu `baza_generare.retrasa_de = 'sistem'`, `retrasa_motiv`; editată / aprobată / trimisă → neatinsă. `evaluare_in_curs = false`. Întoarce `{semnale: [{identitate, verdict, motiv, clarificare: 'creata'|'reactivata'|'retrasa'|'neatinsa'|null}]}`.
- Textul ciornei (fix, în SQL): „Solicitare de clarificare — cantități diferite între documentele documentației de atribuire” + câte un paragraf pe măsură: elementul, documentul A (nume, pagina, rândul / fragmentul citat), valoarea A cu UM, documentul B la fel, „Vă rugăm să precizați cantitatea care stă la baza ofertei.” Fără nume de firmă.
- `fn_ofertare_semnal_raspuns_leaga(p_semnal_id bigint, p_document_id bigint, p_valoare numeric) RETURNS jsonb` (spec §3.6): UI, drept de decizie; documentul e `raspuns_clarificare` al aceleiași licitații; scrie `rezolvat_de_raspuns_id` și `valoare_retinuta`; o revizie nouă a documentului îl anulează la următoarea evaluare (coloana `rezolvat_revizie`).

- [ ] **Step 1: Teste `t3_*`** (fixtură: licitația 900001, `DOC_F3_T` cu rândul de 6.400 m, `DOC_ATR_T` cu „în lungime totală de 3.995 m”, rândul `ofertare_cantitati` 6400 m):
  - `t3_cazul_tichetului`: propune + publică → `diferenta`, ciornă `auto_surse_*` `propunere`, textul citează ambele pagini, `surse_document_ids = {DOC_F3_T, DOC_ATR_T}`;
  - `t3_natura`: furnizare F3 vs montaj ATR → două măsuri, fără semnal;
  - `t3_total_vs_tronson`: total pe lucrare vs un tronson → identități diferite; suma tronsoanelor vs total → o măsură;
  - `t3_identitate_pozitiei`: același `cantitate_id` propus de două ori → numărat o dată;
  - `t3_loturi`: lot 1 vs lot 2 → fără semnal; lot NULL pe o parte → `de_verificat`;
  - `t3_incomplet`: o poziție F3 respinsă (`rand_lipsa`) → `neverificat: agregare incompletă` cu lista; o pagină în `pagini_necitite` → idem;
  - `t3_formula`: 6400 vs 6080 (5%) → `in_regula` la prag 0.05, `diferenta` la 0.04; 3 vs 3.5 (sub o unitate) → `in_regula`; 0 vs 100 → `de_verificat`;
  - `t3_depasita`: amprente vechi → `evaluare_depasita`, zero rânduri scrise, `evaluare_in_curs = false`;
  - `t3_tranzitii`: prag 0.05 → 0.6 → ciorna `retrasa` de sistem → prag înapoi → reactivată `propunere`; retrasă de om (`retrasa_de = 'om'`) → rămâne, `reaparut_dupa_respingere = true` la amprentă nouă; ciornă editată (`text_editat_de`) → neatinsă la verdict schimbat;
  - `t3_document_sters`: DELETE pe `DOC_ATR_T` → măsurătorile b dispar; a doua evaluare → `neverificat: sursă dispărută`, ciorna needitată retrasă de sistem;
  - `t3_raspuns`: `fn_ofertare_semnal_raspuns_leaga` cu document de alt tip → refuz; corect → `rezolvat_de_raspuns_id`; revizie nouă a răspunsului → anulat la evaluare;
  - `t3_drept`: `authenticated` nu poate chema `fn_ofertare_masuratori_propune` / `_publica` (42501); `fn_ofertare_semnale_setari` fără drept de decizie → 42501, cu drept → rândul scris.
- [ ] **Step 2:** FAIL → **Step 3:** secțiunea 4 → **Step 4:** `--sectiune t1,t2,t3` PASS → **Step 5:** commit.

### Task 4: Extinderea circuitului `auto_planse_*` → `auto_surse_*` (inventarul #2–#6, #9)

**Files:**
- Modify: migrarea (secțiunea 5: `CREATE OR REPLACE` pe `fn_trg_ofertare_clarificari_baza`, `ofertare_clarificare_reconfirma`, `ofertare_clarificare_exceptie_identitate`, `ofertare_clarificari_export`, `ofertare_clarificari_notifica`; `DROP VIEW` + `CREATE VIEW v_ofertare_clarificari_baza`; funcțiile noi `ofertare_semnal_baza_stare`, `fn_ofertare_ciorna_auto_stare`)
- Modify: testul (t4)

**Interfaces:**
- `ofertare_semnal_baza_stare(p_id bigint) RETURNS jsonb` STABLE: pentru ciorna `auto_surse_*`: `stare ∈ ('ok','schimbata','necesita_review','evaluare_in_curs','fara_diferenta','indisponibila','luat_act')`, `amprenta_curenta = md5(semnal.evaluare_amprenta || '|' || md5(intrebare))`, `amprenta_baza = semnal.evaluare_amprenta`, `marcaj_planse = false`, `text` (blocant: `baza s-a schimbat — de reverificat`), `diferente` = `{verdict, a, b, prag}` vechi vs acum. `ok` ⇔ `baza_generare.reconfirmare.token = amprenta_curenta AND NOT evaluare_in_curs AND verdict = 'diferenta'`.
- `fn_ofertare_ciorna_auto_stare(c public.ofertare_clarificari) RETURNS jsonb` STABLE: `cheie LIKE 'auto_planse_%'` → `ofertare_clarificare_baza_stare(c.licitatie_id, c.intrebare, c.sursa, c.baza_generare)`; `LIKE 'auto_surse_%'` → `ofertare_semnal_baza_stare(c.id)`; altfel `{stare: 'na'}`.
- Corpurile rescrise = textul EXACT din `docs/R5_MIGRARE_3_review_copilot.sql` (reconfirmare, excepție, export, trigger) și `20261121a` (notifica), cu DOAR schimbările din inventar; `$pre$` refuză dacă amprenta LIVE a fiecăruia ≠ cea din antet (valorile de la chat); `$post$` verifică amprenta noilor corpuri și că `v_ofertare_clarificari_baza` are exact coloanele vechi.

- [ ] **Step 1: Teste `t4_*`** (din inventar: `t4_reconfirmare_surse`, `t4_exceptie_surse_refuz`, `t4_trigger_surse`, `t4_view_surse`, `t4_export_surse`, `t4_notifica_surse`) + `t4_planse_neschimbat`: scenariul R9b existent (ciornă `auto_planse_*`: reconfirmare → export → cantitate schimbată → export blocat) dă aceleași rezultate ca în `scripts/pglite/test_r9b_decisive.mjs` (valorile așteptate copiate de acolo, L25).
- [ ] **Step 2:** FAIL → **Step 3:** secțiunea 5 → **Step 4:** `--sectiune t1..t4` PASS → **Step 5:** commit.

### Task 5: Livrarea L15 v2 — revenire, postcondiții, dry-run, concurență, mutanți

**Files:**
- Modify: migrarea (`$post$`)
- Create: `supabase/revenire/20270112a_ofertare_cantitati_masuratori_ROLLBACK.sql`
- Create: `supabase/tests/20270112a_ofertare_cantitati_masuratori.l15.obiecte.tsv` (generat pe PGlite cu pașii reali, `--scrie-obiecte`)
- Create: `supabase/tests/20270112a_ofertare_cantitati_masuratori_dryrun.sql`
- Create: `supabase/tests/20270112a_ofertare_cantitati_masuratori_concurenta.sh` (tiparul `20270108a…_concurenta.sh`, cluster dispensabil, barieră prin `pg_locks`)
- Modify: testul (t5 + mutanți)

**Interfaces:**
- **Dry-run-ul pe clonă** (`_dryrun.sql`, tiparul `20270111a_…_dryrun.sql`: o tranzacție, `ROLLBACK` la final, conturi și licitații sintetice, fiecare pas ca `authenticated` cu JWT-ul contului, `auth.uid()` verificat la fiecare pas): `t_liste` (listele închise citibile, nescriibile), `t_cazul_tichetului` (6.400 vs 3.995 → `diferenta` + ciornă `auto_surse_*`), `t_dovezi` (rând greșit / diametru / „1.23” → respinse cu motivul), `t_circuit` (reconfirmare → export → cantitate schimbată → export blocat, pe ciorna `auto_surse_*`; aceleași rezultate pe o ciornă `auto_planse_*` ca înainte), `t_acces` (fără Ofertare: 0 rânduri, RPC-uri 42501; scriere directă refuzată; două licitații → `CM_ALTA_LICITATIE`). Rezultatul așteptat: fiecare secțiune tipărește `OK <nume>`, ultima linie `TOTUL OK`; orice `FAIL` oprește cu `ON_ERROR_STOP`.
- **Revenirea:** plafon 2000, fără amprentă globală (docs/LIVRARE_L15_V2.md §9); lock-urile ÎNAINTEA verificărilor (L14); refuză dacă există rânduri în `ofertare_cantitati_semnale` / `_masuratori` / `_setari` sau ciorne cu cheie `auto_surse_%` (se lămuresc de om); readuce cele 5 funcții R9b + view-ul la corpurile EXACTE de dinainte (amprentele din antet), scoate tabelele, listele, funcțiile noi; postcondiție pe amprente.
- **Mutanți** (fiecare PRINS de o probă existentă; textul mutat = o linie, text unic):
  - verificarea dovezii acceptă fragmentul ca subșir al altui token (`'DN160'` → 160);
  - `fn_ofertare_numar_ro` acceptă grup de 2 cifre după punct;
  - `_publica` fără reverificarea amprentelor;
  - `_publica` fără dedup pe `cantitate_id`;
  - verdict `diferenta` cu inventar incomplet;
  - reactivarea ciornei retrase de om;
  - trigger-ul cu `v_auto` doar pe `auto_planse_`;
  - exportul fără dispecer (ciorna `auto_surse_*` trece cu bază schimbată);
  - view-ul fără prefixul nou;
  - revenirea fără refuzul pe date.
- **Concurența** (2 sesiuni reale + barieră, motivul exact al erorii):
  - `c_doua_publicari`: două publicări pe aceeași licitație → o singură ciornă, `nr` distinct;
  - `c_publicare_vs_editare`: omul editează textul în timp ce sistemul publică → fie editarea vede `propunere` regenerată, fie publicarea vede `text_editat_de` și nu atinge;
  - `c_revizie_in_timpul_evaluarii`: `UPDATE revizie` pe document între `propune` și `publica` → `evaluare_depasita`;
  - `c_export_vs_publicare`: exportul (`FOR SHARE`) și publicarea (`FOR UPDATE`) pe aceeași ciornă → fără deadlock, ordinea (0)–(3).

- [ ] **Step 1:** Scrie revenirea, `$post$`, dry-run-ul, concurența, mutanții. Rulează:
  - `node scripts/pglite/test_ofertare_cantitati_masuratori_local.mjs` (complet) → 0 eșecuri, toți mutanții PRINȘI, manifestul generat = `.l15.obiecte.tsv`;
  - `CM_CLUSTER_DISPENSABIL=da bash supabase/tests/20270112a_ofertare_cantitati_masuratori_concurenta.sh <bază>` → `TOTUL OK` (pe server Rocky n-are cluster: scriptul se livrează validat sintactic + rulat pe PGlite secvențial unde se poate; rularea reală o face chat-ul pe clonă — declarat în PR).
- [ ] **Step 2:** `npx vitest run` + `npx vite build` verzi (nimic din `src/` nu se schimbă în PR-BD; verificare de regresie).
- [ ] **Step 3:** Commit, push, PR draft „Ofertare: diferențe de cantități între documente — PR-BD (20270112a NEAPLICATĂ)” cu: rezultatele reale ale rulărilor, matricea L01–L25, lista amprentelor cerute chat-ului, comenzile pentru proba pe clonă.

## PR-extragere — comparația în procesarea plătită (branch `ofertare/0329-extragere`, din PR-BD)

### Task 6: Candidatele de măsurători din observații și F3 (funcții pure, Deno)

**Files:**
- Create: `supabase/functions/_shared/cantMasura.ts`
- Create: `supabase/functions/_shared/cantMasura_test.ts`

**Interfaces:**
- `elementDinObs(o: {tip_lucrare, dn_mm: number[], material}) → string | null` (decizia 4; `dn_mm` cu 0 sau ≥ 2 valori → null).
- `naturaDinObs(o: {masura}, rol: string, denumire: string) → 'furnizare'|'montaj'|'proba'|'total_lucrare'|null` (decizia 4; cuvintele-cheie `furnizare`, `montaj`, `proba` în denumire au prioritate).
- `type Candidat` = forma `p_candidate[i]` din Task 3 (`{parte, element, natura, lot_nr, obiect_cheie, cantitate_id, document_id, dovada}`).
- `candidatDinObs(o, doc: {id, revizie, sha}) → Candidat | null`: `dovada` = `{pagina: o.pagina, fel_dovada: rol tabelar (f3/c6/lista_alt) ? 'tabel' : 'text', rand: linia citatului, celula: tokenul cantității din citat, fragment: citatul, antet_coloana: null (serverul o găsește), valoare_text, um_text}`; fără `pagina` sau fără `pozitie_dovedita` → null (candidat nedovedit nu se trimite).
- `candidatDinF3(c: RandCantitate, doc, textDoc) → Candidat | null`: dovada F3 = rândul din `text_extras` care conține `cod_articol` + `cantitate` (căutat determinist; lipsă → null și rândul intră în `componente_asteptate` fără dovadă = agregare incompletă).
- `inventar(docs, candidati, plafonPagini) → {pagini_cautate, pagini_necitite, componente_asteptate, peste_plafon: number[]}`: paginile se numără pe marcajele `⟦PAGINA n⟧`; de la pagina `plafonPagini + 1` încolo documentele NU se mai parcurg și intră în `pagini_necitite` (`pagini_necitite` existent al documentului se adaugă).
- `amprenteIdentice(a, b) → boolean` (comparație structurală a fotografiei).

- [ ] **Step 1: Teste Deno:** `elementDinObs` (PE100 DN160 → `teava_pe_dn160`; două DN → null); `naturaDinObs` (`material`/f3 → furnizare; `lungime`/atr → total_lucrare; `lungime`/f3 fără cuvânt → null); `candidatDinObs` fără pagină → null; `candidatDinF3` cu rândul din tichet → dovadă cu `celula = '6.400'`; `inventar` cu 3 documente de 100 pagini și plafon 200 → al treilea în `pagini_necitite`; `m_dedup_obs`: două observații cu același `hash_rand` → un candidat.
- [ ] **Step 2:** `node_modules/.bin/deno test -A --no-check --no-lock --node-modules-dir=none supabase/functions/_shared/cantMasura_test.ts` → FAIL → **Step 3:** implementare → **Step 4:** PASS → **Step 5:** commit.

### Task 7: Pasul de comparație în `extrageStructurat` + paritatea regulii numerice

**Files:**
- Create: `supabase/functions/ofertare-cantitati-extrage/masuratori.ts`
- Create: `supabase/functions/ofertare-cantitati-extrage/masuratori_test.ts`
- Modify: `supabase/functions/ofertare-cantitati-extrage/structurat.ts:112` (`extrageStructurat`: după bucla documentelor, dacă `oprit === null`, cheamă `comparaSurse`) și `handler.ts:508–561` (deps noi: `observatii`, `cantitati`, `amprente`)
- Modify: `supabase/functions/ofertare-cantitati-extrage/structurat_test.ts` (deps false pentru pasul nou)

**Interfaces:**
- `comparaSurse(deps: DepsMasuratori, p: {licitatie_id, cerere_id}) → Promise<RaportMasuratori>` în `masuratori.ts`. Pașii, în ordine: (1) `amprente0 = rpc('fn_ofertare_semnale_amprente')`; (2) `observatii` (ca utilizator: `ofertare_cant_obs` ale ultimei extrageri `gata` pe fiecare document, `pozitie_dovedita = true`), `cantitati` (`ofertare_cantitati` ale licitației, `status <> 'retrasa'`), documentele eligibile din rularea curentă; (3) candidatele + inventarul (Task 6) cu plafonul din `amprente0.plafon`; (4) `rpc('fn_ofertare_masuratori_propune', {p_licitatie_id, p_amprente: amprente0, p_candidate})` → `evaluare_depasita` = raport, stop; (5) `rpc('fn_ofertare_semnale_publica', {p_amprente: amprente0, p_evaluare_amprenta, p_inventar})`; (6) raportul: `{semnale, neverificate, pagini_necitite, evaluare_depasita}`. Nicio reîncercare; orice eroare de RPC = raport cu `eroare` (spec §3.8, L05). Zero apeluri AI aici.
- `DepsMasuratori = { rpc, observatii(licitatieId, docIds), cantitati(licitatieId), documente(licitatieId) }` — citirile ca utilizator (`dbUtilizator`), RPC-urile ca `service_role`.
- Răspunsul `extrageStructurat` primește `masuratori: RaportMasuratori | null` (null când extragerea s-a oprit pe timp / felii — comparația rulează doar pe o extragere terminată).

- [ ] **Step 1: Teste Deno (`masuratori_test.ts`, deps false):**
  - `m_cazul_tichetului`: observația ATR 3.995 + rândul F3 6400 → `propune` primește 2 candidate cu dovezile din Task 6, `publica` e chemată cu inventarul complet;
  - `m_revizie_in_timpul_rularii`: `propune` întoarce `evaluare_depasita` → `publica` NU e chemată, raportul o spune;
  - `m_fara_reincercare`: `rpc` aruncă → raport `eroare`, un singur apel;
  - `m_plafon`: 3 documente × 100 pagini, plafon 200 → candidatele paginii 201+ nu se trimit, `pagini_necitite` în inventar;
  - `m_fara_ai`: `deps.ai` nu e în `DepsMasuratori` (compilare) și numărul apelurilor AI din `structurat_test` nu crește cu pasul nou;
  - `paritate_numar`: cazurile din `supabase/tests/20270112a_cazuri_numar.json` trecute prin `cantNumar.valoareInDocument(tok, 'ro')`: unde SQL-ul dă valoare, TS-ul dă aceeași sau `ambigua`; unde SQL dă `ambiguu`, TS NU dă o valoare diferită de cea unică (documentează în test că `cantNumar` nu decide măsurători).
- [ ] **Step 2:** FAIL → **Step 3:** implementare → **Step 4:** toate testele Deno ale funcției PASS → **Step 5:** commit, push, PR draft „Ofertare: diferențe de cantități — PR-extragere (după aplicarea 20270112a)”. În PR: rularea reală a testelor, matricea L01–L25, nota că edge-ul se deployează DUPĂ migrare (fără ea `propune` lipsește → raport `eroare`, fail-closed, extragerea rămâne cum e azi).

## PR-UI — ecranul semnalelor și ciornele `auto_surse_*` (branch `ofertare/0329-ui`, din PR-BD)

### Task 8: Helperi puri pentru semnale

**Files:**
- Create: `src/ofertareSemnale.js`
- Create: `src/ofertareSemnale.test.js`

**Interfaces:**
- `eticheta(verdict, motiv) → {text, culoare}`: `in_regula` → verde „✓ în regulă”; `diferenta` → roșu „⚠ diferență”; `de_verificat` → portocaliu „? de verificat”; `neverificat` → gri „∅ neverificat: <motiv>”. Orice altă valoare → gri „stare necunoscută” (L18).
- `descriereDovada(m) → string`: „<document> p.<pagina>, rândul „<rand>” → <valoare_text> <um_text>” sau „fragment „<fragment>””; `verificare !== 'ok'` → „respinsă: <motiv>”.
- `grupeazaPeMasura(semnale, masuratori) → [{semnal, a: [], b: []}]` ordonat: `diferenta`, `de_verificat`, `neverificat`, `in_regula`.
- `poateStergeCiorna(q) → boolean` = `!eCiornaAutomata(q)` (inventar #11).
- `textDiferenteSemnal(detalii) → string[]` pentru panoul din Clarificări (verdict / a / b / prag vechi → acum).

- [ ] **Step 1: Teste vitest:** etichetele pentru toate verdictele + o valoare necunoscută; `descriereDovada` pe tabel / text / respinsă; ordinea grupării; `poateStergeCiorna` pe `auto_surse_x`, `auto_planse_1`, `manual`; `textDiferenteSemnal` pe prag schimbat.
- [ ] **Step 2:** `npx vitest run src/ofertareSemnale.test.js` → FAIL → **Step 3:** implementare → **Step 4:** PASS → **Step 5:** commit.

### Task 9: Ecranul semnalelor

**Files:**
- Create: `src/OfertareSemnale.jsx`
- Modify: `src/OfertareLicitatii.jsx:4014` (lângă `<OfertareProbaExtractor licitatie={l} />`: `<OfertareSemnale licitatie={l} profile={profile} showToast={showToast} />`)

**Interfaces:**
- Citește `ofertare_cantitati_semnale` + `ofertare_cantitati_masuratori` ale licitației (ambele paginat prin `citestePaginat`, L23) și `ofertare_cantitati_setari`; eroare de citire = mesaj „nu putem verifica semnalele” (nu listă goală, L18).
- Arată: tabelul pe măsură (element, natură, lot, obiect, A, B, verdict, motivul, „a reapărut după respingere”), dovezile ambelor părți cu `descriereDovada`, legătura la ciornă („deschide în ❓ Clarificări”), setările (prag, plafon) editabile doar cu drept de decizie (`fn_ofertare_source_pack_poate_decide`), prin `fn_ofertare_semnale_setari`.
- Fără buton de pornire: comparația rulează în extragerea structurată existentă (`OfertareProbaExtractor.jsx`), al cărei raport primește o linie „Semnale: N diferențe, M de verificat, K neverificate”.
- Token de generație pe încărcări (L24); stil inline cu `G` / `S`.

- [ ] **Step 1: Test de componentă** `src/OfertareSemnale.test.jsx` (jsdom, tiparul `OfertareOcrLocal.test.jsx`): randarea unui semnal `diferenta` cu două dovezi; eroarea de citire → mesajul fail-closed; fără drept → câmpurile setărilor dezactivate.
- [ ] **Step 2:** FAIL → **Step 3:** implementare → **Step 4:** PASS + `npx vite build` → **Step 5:** commit.

### Task 10: Ciornele `auto_surse_*` în Clarificări și „răspuns posibil relevant”

**Files:**
- Modify: `src/ofertareClarificariBaza.js:4` (regexul, inventar #1) și `:16–27` (`stareBazaCiorna`: stările noi `evaluare_in_curs`, `fara_diferenta` → `blocheaza: true`, textul serverului)
- Modify: `src/ofertareClarificariBaza.test.js`
- Modify: `src/OfertareClarificari.jsx:213–217` (`delQ` ascuns pentru `eCiornaAutomata`), `:637–660` (panoul bazei folosește `textDiferenteSemnal` când `detalii.evaluare === 'surse_v1'`), `:377–400` (la urcarea unui răspuns: propunerile „posibil relevant” = semnalele deschise ale licitației a căror `obiect_cheie` / `element` apar în `text_extras` al documentului — potrivire textuală, fără AI; omul bifează → `fn_ofertare_semnal_raspuns_leaga`)
- Modify: `src/OfertareLicitatii.jsx:3926` (citirea view-ului rămâne; cardul planșelor `:801` neschimbat)

**Interfaces:**
- `propuneRaspunsRelevant(semnale, textExtras) → [{semnal_id, motiv}]` în `src/ofertareSemnale.js`: potrivire pe `element` (ex. „DN160” / „Dn 160”) ȘI `obiect_cheie` normalizat; fără potrivire → listă goală (niciodată auto-legare).

- [ ] **Step 1: Teste:** `ofertareClarificariBaza.test.js`: `auto_surse_x` e automată; `stare = 'evaluare_in_curs'` → blochează cu textul serverului; `fara_diferenta` → blochează. `ofertareSemnale.test.js`: `propuneRaspunsRelevant` pe un text care pomenește rândul fără element → nimic; cu element + obiect → propus; `ui_fara_stergere_auto`.
- [ ] **Step 2:** FAIL → **Step 3:** implementare → **Step 4:** PASS + `npx vitest run` complet + `npx vite build` → **Step 5:** commit, push, PR draft „Ofertare: diferențe de cantități — PR-UI (după aplicarea 20270112a)”.

## Ordinea de livrare, probele pe clonă și ce cere chat-ului / owner-ului

1. **Ce cere Rocky chat-ului înainte de PR-BD** (nu are acces la BD): de pe clonă, pentru fiecare dintre `fn_trg_ofertare_clarificari_baza()`, `ofertare_clarificare_reconfirma(bigint,text,text,text)`, `ofertare_clarificare_exceptie_identitate(bigint,text,text)`, `ofertare_clarificari_export(bigint)`, `ofertare_clarificari_notifica(bigint)`, `ofertare_clarificare_baza_stare(bigint,text,text,jsonb)`: `md5(replace(prosrc, chr(13), ''))`, `prosecdef`, `proconfig`, `proowner`, `proacl`; definiția `pg_get_viewdef('public.v_ofertare_clarificari_baza')`; lista triggerelor de pe `ofertare_clarificari` (`tgname`, `tgfoid::regprocedure`, `tgtype`); coloanele reale ale `ofertare_cantitati`, `ofertare_documente_atribuire`, `ofertare_clarificari` (`information_schema.columns`); existența UNIQUE `(licitatie_id, cheie)`. Dacă corpurile LIVE diferă de `docs/R5_MIGRARE_3_review_copilot.sql`, chat-ul dă textul exact (`pg_get_functiondef`) și planul rămâne valabil (schimbările din inventar se aplică pe textul live).
2. **PR-BD:** review Jakarinos până la GO. Apoi chat-ul, pe clonă: `scripts/livrare_l15_manifest.sh --iesire` → `.l15.tsv` revizuit față de `.l15.obiecte.tsv`; aplicare prin runner (plafon 5000); `psql -f supabase/tests/20270112a_ofertare_cantitati_masuratori_dryrun.sql` → `TOTUL OK`; concurența pe clusterul dispensabil; revenire (plafon 2000) → re-aplicare; regresiile din inventar #12.
3. **„Da”-ul owner-ului** pentru aplicarea pe producție (fereastra L15, Răzvan pe manual). Ordinea: (1) migrarea; (2) deploy edge `ofertare-cantitati-extrage` (PR-extragere); (3) merge PR-UI. Ecranul nou înaintea migrării arată „încă neactiv” (42P01 / PGRST205); edge-ul nou înaintea migrării raportează `eroare` la `propune` fără să schimbe extragerea.
4. **Măsurarea (spec §5.6)** pe 3 licitații reale o face chat-ul după deploy, cu contul de test, și o raportează în `paw-data\out`; nu intră în repo.
5. **Întrebări care cer decizia lui Răzvan** (planul pornește cu răspunsul implicit din paranteză): (a) maparea `lungime` → `total_lucrare` doar pe ATR / CS / memoriu / planșă / răspuns, iar F3 fără cuvânt-cheie = `de_verificat` (implicit: da); (b) documentul șters → CASCADE pe măsurători + `neverificat: sursă dispărută` (implicit: da); (c) unde stă ecranul: fișa licitației, lângă proba extractorului (implicit: da; alternativa: filă în 📋 Cantități); (d) excepția de identitate rămâne doar pe `auto_planse_*` (implicit: da).
