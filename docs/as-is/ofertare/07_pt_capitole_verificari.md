# 07 — AS-IS: Propunerea tehnică (PT) — capitole, legături, dovezi, verificări

Repo `/home/user/pontaj-pro` @ main 55779b5 · BD live `dxczwkbciseqniprspcu` (citit 23.09.2026). Doar constatare, fără remediere.

Surse citite integral: `supabase/functions/ofertare-genereaza-capitol/index.ts` (384 l.), `ofertare-verificare-finala/index.ts` (130), `ofertare-fisier-semnat/index.ts` (85), `src/OfertarePropunere.jsx` (2088), `src/ofertareControale.js` (661), `src/ofertarePoarta.js` (258), `src/ofertarePachet.js` (72), `src/OfertareRevizii.jsx` (279), `src/ofertareOrdine.js`, `src/ofertareCandidati.test.js`, `src/ofertareControale.test.js` (skim), `src/OfertareLicitatii.jsx` 130-160 și 3930-3985; SQL live: `fn_pt_legatura_coerenta`, `fn_pt_capitol_versioneaza`, `fn_pt_invalideaza_la_inlocuire`, `fn_pt_invalideaza_la_revizie_document`, `fn_gate_depunere`, `v_ofertare_pt_stare`, `v_ofertare_pt_conformitate`, triggere, CHECK/UNIQUE, RLS, coloane.

## 0. Stare BD live (context pentru tot ce urmează)

| Obiect | Live 23.09.2026 |
|---|---|
| `ofertare_pt_capitole` | 15 rânduri, TOATE pe licitația 5 (Domnești); **toate `sursa='ai'`**, **toate `stare='gol'`** (coloana `stare` nu e scrisă de niciun cod), `versiune` 2..5, 1 blocat, 7 conțin `[DE COMPLETAT`, 3 conțin „nu (este\|e) cazul" |
| `ofertare_pt_capitole_versiuni` | 32 rânduri, **`schimbat_de` = NULL pe toate 32** (scrise via service_role → `auth.uid()` null) |
| `ofertare_pt_legaturi` | 271: **270 `atribuita/ai`** (lic. 5, toate create 17.09.2026, 0 confirmate) + 1 `atribuita/om`. 0 `verificata`, 0 `blocata`. Niciun cod din repo nu scrie `sursa='ai'` pe legături — au fost inserate din afara aplicației (SQL). |
| `ofertare_pt_dovezi` | **0 rânduri** (0 cu `document_revizie`, 0 cu `pagina_globala`) |
| `ofertare_pt_afirmatii` | 0 rânduri (nici un cod din repo nu INSERT-ează; doar UPDATE în UI) |
| `ofertare_pt_observatii` | 0 |
| `ofertare_pt_declaratii` / `participanti` / `anexe_asteptate` / `garantie` | 0 / 0 / 0 / 1 |
| `ofertare_pt_poarta` (semnătură poartă) | 0 |
| `ofertare_pt_pachet` | 0 |
| `ofertare_verificari` | 2 rânduri: 1 `galben`, 1 `verdict=NULL` (arbitrul n-a returnat JSON valid) |

## A. PIPELINE

Câmpuri standard: Stage · Trigger · UI (fișier/funcție/linie) · Function/API/RPC · Tables/views · Input · Output · Status_before → Status_after · Human_gate · AI_action · Versioning · Provenance · Downstream_consumer · Failure/retry.

### P01 — Creare cuprins (capitole) din model sau manual
- **Stage**: Cuprins. **Trigger**: click „📋 {model}" sau „➕ Adaugă un capitol".
- **UI**: `OfertarePropunere.jsx` `creeazaCuprins` L1392-1403 (`insert(model.capitole.map(c => ({...c, licitatie_id, sursa:'sablon'})))`), `adaugaCapitol` L1408-1423 (fără `sursa` → default coloană). Modele `CAPITOLE_ANAP/HOGHILAG/CRISTIAN/MOTRU` L70-161.
- **Tables**: `ofertare_pt_capitole` INSERT. `nr` UNIQUE(licitatie_id,nr), `nr<=40`.
- **Status**: — → `stare='gol'` (default), `versiune=1`, `sursa='sablon'`|default.
- **Human_gate**: da (om apasă). **AI**: nu. **Versioning**: v1. **Provenance**: `creat_de` (coloană există; UI nu o setează explicit — default). **Downstream**: P02, P06, view `capitole`, `capitole_goale`.
- **Failure**: 23505 → toast „Cuprinsul exista deja".

### P02 — Atribuire cerință → capitol (legătură `fel='capitol'`)
- **Trigger**: selecție în matrice + „→ atribuie capitolului".
- **UI**: `atribuie` L1784-1794: `upsert([...sel].map(id => ({cerinta_id:id, capitol_id, fel:'capitol', sursa:'om'})), {onConflict:'cerinta_id,capitol_id'})`.
- **DB trigger**: `trg_pt_legaturi_coerenta` BEFORE INSERT/UPDATE → `fn_pt_legatura_coerenta`: refuză dacă `licitatie_id` cerință ≠ capitol.
- **Status**: — → `stare='atribuita'` (default), `sursa='om'`.
- **Human_gate**: da. **AI**: nu în cod; **dar** live 270 legături `sursa='ai'` pe lic. 5 create 17.09 (P02-bis: inserare externă, fără drum în repo).
- **Downstream**: generator P06 (citește `fel='capitol'`), view `cu_capitol`/`fara_capitol`/`cerinte_neverificate`.

### P03 — Exceptare (`fel='exceptat'`)
- **UI**: `excepta` L1797-1806: `insert({cerinta_id, capitol_id:null, fel:'exceptat', motiv, sursa:'om'})`. CHECK `ofertare_pt_legaturi_fel_chk`: exceptat ⇒ `capitol_id IS NULL AND motiv<>''`.
- **Human_gate**: motiv obligatoriu (UI L353 + CHECK). Nu atinge `ofertare_cerinte` (regula 1, header L12-15).

### P04 — Scriere/salvare capitol de om
- **UI**: `EditorCapitol` (`OfertareRevizii.jsx` L160-183) → `salveazaCapitol` L1506-1516: `update({continut:text, sursa:'om'}).eq('id', c.id)`. **Nu scrie `stare`** (rămâne `gol`).
- **DB trigger**: `trg_pt_capitol_versioneaza` BEFORE UPDATE → `fn_pt_capitol_versioneaza`: `IF NEW.continut IS DISTINCT FROM OLD.continut OR NEW.fisier_path IS DISTINCT FROM OLD.fisier_path THEN INSERT INTO ofertare_pt_capitole_versiuni (capitol_id, versiune, titlu, continut, fisier_path, sursa, stare, schimbat_de) VALUES (OLD.id, OLD.versiune, ..., auth.uid()) ON CONFLICT (capitol_id, versiune) DO NOTHING; NEW.versiune := OLD.versiune + 1;`
- **Versioning**: vechea versiune → istoric, `versiune++`. **Provenance**: `schimbat_de = auth.uid()` (NULL când scrie service_role).
- **Downstream**: legăturile `verificata` cu `verificat_la_versiunea < versiune` devin implicit stale (P08); `pachetDepasit` (P12); `capitole_nescrise_de_om` scade (sursa='om').
- **Concurrency**: UI update fără condiție de versiune (last-write-wins); doar generatorul e condiționat (P06).

### P05 — Lacăt capitol
- **UI**: `blocheazaCapitol` L1550-1557 `update({blocat})`. Respectat doar de generator (P06 interdicția 1). Editorul de om **nu** e oprit de lacăt (L574: „se poate edita la mână, dar nu se regenerează").

### P06 — Generare capitol cu AI (`ofertare-genereaza-capitol` v2.2)
- **Trigger**: „🤖 Generează din cerințe" L566-573 (dezactivat dacă `blocat` sau 0 cerințe) → `genereazaCapitol` L1522-1548 → `supabase.functions.invoke('ofertare-genereaza-capitol', {capitol_id, instructiune, peste_om})`.
- **Auth în funcție** (`autorizat` L181-199): service_role liber; anon respins; JWT user ⇒ `profiles.is_owner` sau `ofertare_licitatii.responsabil_id === uid`.
- **Interdicții în cod**: L227 blocat → refuz; L229-233 `sursa='om'` cu text ⇒ `cere_confirmare` (UI `window.confirm` L1535 → reapel `peste_om=true`); L244 fără cerințe atribuite → refuz; L364-370 UPDATE condiționat `.eq('versiune', cap.versiune||1)` (optimistic lock).
- **Model**: `claude-sonnet-5` (L36), `max_tokens 12000`, `thinking adaptive`, prompt cached; capitole mari pe părți de 20 cerințe în paralel (L265-322).
- **Citește** (`pachetFapte` L74-169): acoperiri+autorizații+recomandări+studii+experiență+parteneri+doc firmă, grafic_activitati, pt_garantie, pt_participanti, pt_declaratii, clarificări răspunse, celelalte capitole, documente_firma utilizabile, pt_afirmatii; plus cerințele legate, observațiile deschise.
- **Scrie**: `update({continut:text, sursa:'ai'}).eq('id').eq('versiune', v)`; `ai_usage_log`. **Nu scrie `stare`**, nu scrie legături, nu scrie afirmații.
- **Status**: `sursa` → `'ai'`; `versiune` → v+1 prin trigger P04; `stare` neschimbată (`gol`).
- **Human_gate după**: poarta rând `nescrise` (`capitole_nescrise_de_om` = obligatoriu ∧ continut≠'' ∧ sursa≠'om') e BLOCK până un om salvează (P04). **Provenance**: în istoric `schimbat_de=NULL` (service_role) — vezi BP-05.
- **Failure**: `stop_reason=max_tokens` → nu scrie (L349); conflict versiune → nu scrie (L368); erori de business ca 200+`error`.

### P07 — Dovadă pe legătură (`ofertare_pt_dovezi`)
- **UI**: `adaugaDovada` L1698-1720: alege document din `ofertare_documente_atribuire` (prompt cu număr), locator text, `pg = Number((loc.match(/\d+/)||[])[0])`; `insert({legatura_id, tip_dovada:'document_atribuire', document_id, document_revizie: d.revizie||null, locator_local, pagina_locala: pg})`; dacă `leg.stare==='atribuita'` → `update({stare:'dovedita'})`.
- **CHECK**: exact o țintă (document_id | autorizatie_id | doc_firma_id | fisier_path) când `tip_dovada<>'capitol'`.
- **`pagina_globala`**: **nu e scrisă nicăieri** (comentariu L1697: „se știe abia la asamblare (P0.5)"); nu e citită de niciun control.
- **Verificare față de fișier real**: nu există (nu se deschide PDF-ul, nu se validează `pagina_locala <= documente.pagini`).
- **Live**: 0 dovezi. Tranziția `redactata` (din enum) **nu e scrisă de niciun cod**.

### P08 — Verificare umană a legăturii
- **UI**: buton „✓ verific" (L404, ascuns când deja `verificata` la versiunea curentă) → `verificaLegatura` L1665-1680: prompt locator (obligatoriu) → `update({stare:'verificata', locator_raspuns, constatare:null, severitate:null, confirmat_de:uid, confirmat_la:now, verificat_la_versiunea: cap.versiune||1})`.
- **CHECK** `ofertare_pt_legaturi_stare_chk`: `verificata` ⇒ confirmat_de+confirmat_la+verificat_la_versiunea NOT NULL.
- **Comparație versiune (unde se folosește)**: (a) view `cer.verificata = EXISTS(... l.stare='verificata' AND l.verificat_la_versiunea = k.versiune)` → `cerinte_neverificate`; (b) UI filtru L312-313; (c) badge L386-391 („⚠ verificată la vN, capitolul e la vM"); (d) `ofertarePoarta.js` L36-47 rând `neverificate` BLOCK. **Nu există trigger** care schimbe `stare` la editarea capitolului — starea rămâne `verificata` în tabel, „stale" e doar derivat.
- **Blocare**: `blocheazaLegatura` L1682-1694 `update({stare:'blocata', constatare, severitate:'blocant'})`; CHECK cere constatare. Legătura blocată **nu e rând separat în poartă** — intră în `cerinte_neverificate` (nu e `verificata`).

### P09 — Observații (cereri de modificare)
- **UI**: `Observatii` (`OfertareRevizii.jsx` L196-279) → `adaugaObservatie` L1559-1570 INSERT; `inchideObservatie` L1576-1592 `update({stare, raspuns, rezolvat_la, rezolvat_in_versiunea: stare==='rezolvata' ? cap.versiune : null})`. CHECK: închidere ⇒ raspuns+rezolvat_la.
- Consumat de: generator (L254-255 observații deschise pe capitol intră în prompt), view `observatii_deschise` → poartă rând `observatii` WARN (L91-99).

### P10 — Afirmații / conformitate (`pt_afirmatii` → `v_ofertare_pt_conformitate`)
- **Creare**: **niciun INSERT în repo** (nici UI, nici edge). UI doar update: `exceptaAfirmatie` L1442-1453, `setTipCerut` L1455-1463, `setExtern` L1465-1472. Coloana `sursa IN ('om','ai')` există, dar nu e populată de nimic din repo.
- **View**: verdict `block` = om_negasit | om_plecat | (doua_roluri ∧ interzice_cumul); `warn` = extern fără disponibilitate, autorizație expirată, calificare lipsă, doua_roluri, utilaj/partener fără legătură; `exceptat`; altfel `ok`.
- **Poartă**: rând `conformitate` L75-82: 0 afirmații ⇒ **WARN** (nu ok), block>0 ⇒ BLOCK.

### P11 — Declarații / participanți / anexe așteptate / garanție
- **UI** (toate INSERT/UPSERT/DELETE directe, cu `confirmat_de/confirmat_la = uid/now`): `salveazaDeclaratie` L1356-1367 (upsert on `licitatie_id,forma`), `adaugaParticipant` L1302-1317, `adaugaAnexaAsteptata` L1321-1335, `salveazaGarantie` L1285-1298 (upsert, ștampilă la fiecare save), `capitolResponsabil` L1345-1352 (`participant_id` pe capitol).
- **Consumatori**: view (`declaratii_participare`, `participanti`, `participanti_acte`, `anexe_declarate`, `anexe_asteptate`, `anexe_responsabili`, `garantie_*`) → `controlParticipare`, `controlPachetComplet`, `controlGarantie`; generator P06 (`pachetFapte` L82-84, L152-156).
- **Human_gate**: tot om. **Versioning**: niciuna (upsert suprascrie; `garantie.confirmat_la` se rescrie la orice salvare).

### P12 — Poarta PT (evaluare), semnătură, aprobare pachet
- **Evaluare**: `evalueazaPoarta(st)` (`ofertarePoarta.js` L21-157) peste un rând `v_ofertare_pt_stare`; consumată de `PoartaPT` L250-280, `PropunereRezumat` L620-642, `aprobaPachet` L1728, `semneaza` L1816 (recitire din BD).
- **Semnătură**: `semneaza` L1808-1838 → INSERT `ofertare_pt_poarta {licitatie_id, versiune: pt_versiune+1, verdict: verdictSemnatura(ev) ('verde'|'galben'), snapshot: proaspat}`. Blocat dacă `ev.stare==='block'`. Live: 0.
- **Aprobare pachet**: `aprobaPachet` L1726-1782 → generează DOCX propunere+borderou din `capitole` (state), SHA-256 în browser, INSERT `ofertare_pt_pachet` (stare 'propus' → 'aprobat'), upload storage `pt/{lic}/v{n}/…`, INSERT `ofertare_pt_pachet_fisiere` cu `sursa_versiune = sursaVersiuneCapitole(capitole)` = `capitole@{id:vN,...}`. `pt_poarta_id: null` (L1752 — pachetul **nu** e legat de semnătura porții). Live: 0.
- **Depășire**: `pachetDepasit` (`ofertarePachet.js` L68-72) compară amprenta curentă cu cea din manifest → badge UI L2001-2003.

### P13 — Verificare finală (`ofertare-verificare-finala`)
- **Trigger**: `OfertareLicitatii.jsx` `VerificareFinalaSection` L3939-3975: parolă hard-codată în client (`'Gazpet2026'` L3952) → `fetch(.../ofertare-verificare-finala, {Authorization: Bearer session.access_token})`.
- **Auth în funcție**: `x-radar-secret` (Vault RPC) SAU orice JWT de user valid (L55-61) — **fără verificare de rol/owner/responsabil** (spre deosebire de P06).
- **Citește**: `ofertare_licitatii`, `ofertare_cerinte` + `ofertare_acoperire` (toate tipurile, `inlocuita_de IS NULL`), `v_dovezi_stare` roșii. **NU citește capitolele PT, legăturile, dovezile PT, `v_ofertare_pt_stare`** — textul cerinței tăiat la 220 caractere (L95).
- **Modele**: A determinist; B `claude-sonnet-5` (L103); C `claude-fable-5-1` cu `output_config.effort:'medium'`, `fallbacks:'default'`, beta `server-side-fallback-2026-07-01` (L109-114).
- **Scrie**: INSERT `ofertare_verificari {licitatie_id, verdict (NULL dacă invalid), raport jsonb, modele, rulat_de}`; `created_at` implicit. **Fără** referință la versiune PT/capitole/pachet/poartă — verdict per timestamp, nu per versiune.
- **Consumatori**: card licitație (L144 ultima `verdict, created_at`), secțiune L3944. **Nu** intră în `v_ofertare_pt_stare` / poarta PT; **nu** intră în `fn_gate_depunere`.

### P14 — Gate de depunere (DB)
- `trg_gate_depunere` BEFORE UPDATE `ofertare_licitatii` → `fn_gate_depunere`: la `status='depusa'` fără `derogare_depunere`, RAISE dacă cerințe neconfirmate / neacoperite / dovezi roșii. **Nu verifică nimic din PT** (capitole, legături, poartă semnată, pachet aprobat, verdict final).

### P15 — Invalidări
- `trg_pt_invalideaza_la_inlocuire` (AFTER UPDATE OF `inlocuita_de` ON `ofertare_cerinte`): legăturile `fel='capitol'` în `('verificata','dovedita','redactata')` → `stare='atribuita', verificat_la_versiunea=NULL, constatare += 'INVALIDATA <data>: cerinta a fost inlocuita...'`.
- `trg_pt_invalideaza_la_revizie_document` (AFTER UPDATE OF `revizie` ON `ofertare_documente_atribuire`): legăturile `verificata|dovedita` care au o dovadă cu `document_revizie IS DISTINCT FROM NEW.revizie` → `atribuita` + constatare.
- Nu există trigger pentru: capitol modificat (derivat prin comparație versiune), dovadă ștearsă, document șters/reîncărcat fără schimbare de `revizie`, `pagini` schimbate.

### P16 — Semnale în `v_ofertare_pt_stare` și clasificarea lor în poartă

| Semnal view | Calcul (rezumat) | Rând poartă (`ofertarePoarta.js`) | Blocant/advisory |
|---|---|---|---|
| `capitole` | count | `cuprins` L25 | BLOCK dacă 0 |
| `fara_capitol` | ¬are_capitol ∧ ¬exceptata ∧ ¬dovedita | `fara` L30 | BLOCK |
| `cerinte_neverificate` | are_capitol ∧ ¬(verificata la versiunea curentă) | `neverificate` L36 | BLOCK |
| `capcane`, `capcane_descoperite` | regex `RX_CAPCANA` pe `text_cerinta` | `capcane` L48 | BLOCK dacă descoperite>0 |
| `capitole_goale` | obligatoriu ∧ stare≠nu_se_aplica ∧ fără text/fișier | `goale` L56 | BLOCK (WARN dacă 0 capitole) |
| `capitole_nu_e_cazul` | `continut ~* 'nu (este\|e) cazul'` | `nu_e_cazul` L61 | **WARN** |
| `afirmatii`, `afirmatii_blocante`, `afirmatii_de_verificat` | din `v_ofertare_pt_conformitate` | `conformitate` L76 | 0 ⇒ WARN; block>0 ⇒ BLOCK; warn>0 ⇒ WARN |
| `capitole_nescrise_de_om` | obligatoriu ∧ text ∧ sursa≠'om' | `nescrise` L83 | BLOCK |
| `observatii_deschise` | count deschise | `observatii` L91 | WARN |
| `documente`, `documente_necitite` | count / eroare∨neprocesat∨partial | `docs` L100 | 0 doc ⇒ BLOCK; necitite ⇒ WARN |
| `grafic_versiune`, `grafic_avertismente` | max grafic_versiuni / poarta≠ok | `grafic` L107 | WARN |
| `lista_f3_m`, `lista_c6_m`, `memoriu_m`, `plansa_m`, `grafic_fronturi_m` | sume din `ofertare_cantitati`/`grafic_parametri` | `controlCantitati` | BLOCK dacă F3 lipsă sau Δ>0,1 %; altfel WARN/ok |
| `garantie_cerut_*`, `garantie_oferit_*`, `garantie_confirmata`, `garantie_justificata`, `garantie_luni_in_capitole` (regex), `garantie_cerinte_lucrari` (regex) | `ofertare_pt_garantie` + regex pe capitole/cerințe | `controlGarantie` | BLOCK dacă oferit<cerut / moment diferit / capitol cu alte luni / neasumată dar cerută; altfel WARN/ok |
| `anexe_referite` (regex), `anexe_existente`, `fraze_anexe` (regex), `capitole_ref` | din capitole | `controlAnexe` | BLOCK dacă trimitere fără piesă sau rol nepotrivit |
| `identitate_straine` | tokens din alte licitații găsiți în capitole | `controlIdentitate` | **WARN** |
| `bransamente_in_capitole`, `bransamente_in_cerinte` (regex) | | `controlNumereCheie` | BLOCK dacă niciun număr nu coincide; WARN conflict surse/mai multe |
| `participanti`, `participanti_acte`, `fraze_asociere` (regex), `semnale_asociere`, `declaratii_participare` | | `controlParticipare` | **niciodată BLOCK** (WARN) |
| `anexe_asteptate`, `anexe_declarate`, `anexe_responsabili`, `pachet_stare`, `pachet_fisiere` | | `controlPachetComplet` | BLOCK `SIGNED_DOCUMENT_MERGED` / `REQUIRED_ATTACHMENT_NOT_IN_FINAL_PACKAGE`; ok dacă nu există pachet |
| `grafic_activitati_declarate`, `grafic_versiune_mod` | | `controlGraficSursa`, `controlRelatiiGrafic` | BLOCK `SCHEDULE_NOT_FROM_FROZEN_VERSION`, `RELATION_DATE_CONFLICT`; altfel WARN/ok |
| `pt_versiune`, `pt_verdict`, `de_forma`, `cu_capitol`, `exceptate`, `inchise_cu_dovada`, `semnale_asociere` | | — (afișare / `semneaza`) | nu intră în verdict |

## B. OBJECT lifecycles

### PT chapter (`ofertare_pt_capitole`)
- **where_created**: UI `creeazaCuprins` L1392 (sursa 'sablon') / `adaugaCapitol` L1408.
- **where_updated**: UI `salveazaCapitol` L1509 (`continut`, `sursa:'om'`), `blocheazaCapitol` L1553, `capitolResponsabil` L1347; edge `ofertare-genereaza-capitol` L364 (`continut`, `sursa:'ai'`, condiționat de `versiune`). Coloanele `stare`, `stare_motiv`, `responsabil_id`, `fisier_path`, `formular` **nu sunt scrise de niciun cod** (mașina de stări `gol→in_lucru→scris→verificat→nu_se_aplica` este declarată în CHECK dar moartă; live 15/15 = `gol`).
- **how_versioned**: trigger `fn_pt_capitol_versioneaza` (doar la schimbare `continut`/`fisier_path`); istoric în `ofertare_pt_capitole_versiuni` UNIQUE(capitol_id,versiune), RLS SELECT-only pentru authenticated; `versiune++` pe rândul viu. Rândul viu nu e în istoric (`OfertareRevizii.jsx` L114-116).
- **how_invalidated**: nu se invalidează el; invalidează consumatorii: legături (comparație `verificat_la_versiunea` în view/UI), pachet (`pachetDepasit`).
- **how_confirmed**: singura „confirmare" = `sursa='om'` la salvare (P04). Nu există `verificat_de/la` pe capitol.
- **how_linked_to_source**: `ofertare_pt_legaturi` (cerință → capitol); `participant_id` (firma care furnizează piesa). Nu există legătură capitol → document-sursă (fișa de date) sau pagină.
- **how_linked_to_final_package**: `ofertare_pt_pachet_fisiere.sursa_versiune` = amprentă text `capitole@{id:vN,…}` (toate capitolele, într-un singur șir); DOCX-ul e generat din state-ul UI (`capitole`), nu din istoric.

### Link cerință → capitol (`ofertare_pt_legaturi`)
- **where_created**: UI `atribuie` L1787 (sursa 'om'), `excepta` L1800; **live 270 rânduri `sursa='ai'` fără cod în repo** (inserare externă 17.09.2026, lic. 5).
- **where_updated**: `verificaLegatura` L1671 (→verificata), `blocheazaLegatura` L1687 (→blocata), `adaugaDovada` L1714 (atribuita→dovedita), triggere invalidare P15 (→atribuita). Starea `redactata` nu e scrisă nicăieri.
- **how_versioned**: nu (UPDATE in place; constatările se concatenează la invalidare).
- **how_invalidated**: (1) capitol modificat → derivat (`verificat_la_versiunea ≠ k.versiune`), rândul rămâne `verificata` în tabel; (2) cerință înlocuită → trigger; (3) revizie document-dovadă → trigger.
- **how_confirmed**: `confirmat_de/confirmat_la/verificat_la_versiunea` + CHECK; `locator_raspuns` obligatoriu în UI (nu în CHECK).
- **how_linked_to_source**: `cerinta_id` (care are `sursa_document_id`, `sursa_pagina`, `sursa_pasaj` în `ofertare_cerinte`); `locator_raspuns` text liber.
- **how_linked_to_final_package**: nu (nici pachet, nici semnătura porții nu referențiază legături; `snapshot` din `pt_poarta` ține doar contorii view-ului).

### Evidence (`ofertare_pt_dovezi`)
- **where_created**: doar UI `adaugaDovada` L1709, `tip_dovada` fix `'document_atribuire'` (celelalte tipuri `autorizatie|document_firma|fisier|capitol` n-au drum în UI). Live 0.
- **where_updated**: nicăieri (nu există edit/ștergere în UI). RLS write `fn_are_acces_ofertare()`.
- **how_versioned**: nu. **how_invalidated**: indirect, prin trigger revizie document (legătura cade, dovada rămâne).
- **how_confirmed**: nu (dovada nu are confirmat_de; `creat_de` există, UI nu-l setează).
- **how_linked_to_source**: `document_id` + `document_revizie` (copiat din `documente_atribuire.revizie` la momentul legării) + `locator_local` (text) + `pagina_locala` (primul număr din text). `pagina_globala` niciodată scrisă. Fără verificare contra fișierului (pagini, hash).
- **how_linked_to_final_package**: nu.

### Annex expected (`ofertare_pt_anexe_asteptate`) și anexe derivate
- **where_created**: UI `adaugaAnexaAsteptata` L1325 (ref text, sursa_declaratie f4|opis|manifest|cerinta|alta, document_sursa, pagina, participant_id). UNIQUE(licitatie_id, ref). Live 0.
- A doua sursă de „așteptate": view `anexe_asteptate` = etichete/formulare din capitole care încep cu „anex|formular"; `anexe_referite` = regex pe textul capitolelor.
- **where_updated**: doar DELETE (`stergeAnexaAsteptata`). **how_versioned**: nu. **how_invalidated**: nu.
- **how_confirmed**: `confirmat_de/la` la inserare.
- **how_linked_to_source**: `document_sursa`+`pagina` text liber. **how_linked_to_final_package**: `controlPachetComplet` potrivește `normalizeazaRef(ref)` cu `pachet_fisiere.anexa_ref`/`nume` (potrivire pe tip+număr; piese neidentificabile → WARN `UNIDENTIFIED_DECLARED_PIECE`).

### Form (formular F-nn: F9, F23, F3, „Formular N")
- **F9 (personal)**: `ofertare_pt_echipa` + `_roluri` din acoperiri (`importaEchipa` L1843-1886), blocaje din view `v_ofertare_pt_echipa_blocaje`; export DOCX `exportaF9` L1905 (ciornă dacă blocaje). Nu e capitol, nu intră în pachet/manifest.
- **F23 (dotări)**: `exportaF23` L1618 din `v_ofertare_dotari` (`propus_f23`); DOCX direct, fără persistență, fără manifest.
- **Formular N ca piesă a PT**: doar `ofertare_pt_capitole.formular` (nescris de cod) / `eticheta` („Formular 5") + `pt_garantie.oferit_formular` text. Numerele de formular în textul AI vin „DOAR din cerințe" (prompt L66) — regulă de prompt, nu de cod.
- **how_versioned/confirmed/linked_to_package**: nu; DOCX-urile F9/F23 nu sunt hash-uite în `pachet_fisiere` (`aprobaPachet` produce doar `propunere_docx` + `borderou_docx`, L1736-1739).

## C. BREAK_POINTS

### BP-01 — Reguli duplicate (regex de două ori: SQL + JS)
| Regulă | SQL (`v_ofertare_pt_stare`/`v_ofertare_pt_conformitate`) | JS | Notă |
|---|---|---|---|
| Capcane de respingere | `cer.capcana = c.text_cerinta ~* '(respins\|resping[ăa-z]* (a \|la )?(ofert\|candidatur)\|neconform\|…)'` | `OfertarePropunere.jsx` L172 `RX_CAPCANA` (același text; comentariu L163: „identic, caracter cu caracter") | copie manuală, fără test de egalitate |
| Interzice cumul funcții | `v_ofertare_pt_conformitate.interzice_cumul` regex | `ofertareControale.js` L24 `REGEX_INTERZICE_CUMUL` (comentariu L22: „daca o schimbi aici, schimb-o si in view"); folosit L1233 ca `imatch` | 2 copii |
| Trimiteri anexe/formulare | view `ar` regex `((?:anex[aă]\|formular(?:ul)?\|cap(?:itolul\|\.)?\|plan[șs]a)\s*(?:nr\.?\s*)?(?:[0-9]+[a-z]?\|[IVXLC]+\y))` și `fraze_anexe` `(anex[aă]\|formular(ul)?)[[:space:]]*(nr\.?[[:space:]]*)?[0-9]` | `controlAnexe` L168 `/(anex[aă]\|formular(?:ul)?)\s*(?:nr\.?\s*)?[0-9]+/gi` + `normalizeazaRef` L114 | extragere în SQL, normalizare în JS — sintaxe diferite (POSIX vs JS) |
| Asociere/subcontractare | view `semnale_asociere` `(asocier[a-ză-ț]*\|asocia[țt][a-ză-ț]*\|subcontract[a-ză-ț]*)` și `fraze_asociere` `(asocier\|asocia[țt]\|subcontract)` | `clasificaFrazaParticipare` L273 `/asocier\|asocia[țt]\|subcontract/`, `FORME_PARTICIPARE` L308-312 | 2 copii |
| Garanție luni | view `gk` `garan[țt]i[^.]{0,120}?(\d{1,3})\s*(?:de\s*)?luni\|…` și `garantie_cerinte_lucrari` `garan[țt]i[^.]{0,120}\d{1,3}\s*(de\s*)?luni` ∧ `lucr[ăa]ri\|punere\|recep[țt]i` | `OfertarePropunere.jsx` L901 `RX_LUNI` + L917-918 candidate (`/garan[țt]i/`, `/lucr[ăa]ri\|punere\|recep[țt]i/`, exclude `participare\|bun[ăa] execu[țt]ie\|…`) | filtrul UI exclude „participare/bună execuție", view-ul NU |
| Branșamente | view `(\d{2,5})\s*(?:de\s+)?(?:bran[șs]ament\|racord)` ×2 (capitole, cerințe) | JS doar consumă (`controlNumereCheie`) | 2 copii SQL |
| „nu e cazul" | view `k.continut ~* 'nu (este\|e) cazul'` | prompt generator L60/L67 (regulă de text) | — |
| Verificată la versiunea curentă | view `l.verificat_la_versiunea = k.versiune` | UI L312-313, L386, L402 | 3 copii JS + 1 SQL |
| Poarta de depunere | `fn_gate_depunere` (cerințe/acoperire/doc firmă) | `evalueazaPoarta` (PT) | două porți independente, niciuna nu o citește pe cealaltă |

### BP-02 — UI vs server (ce e doar în client)
- `locator_raspuns` obligatoriu doar în UI (L1668); CHECK nu-l cere.
- Ștergerea capitolului „doar gol și fără cerințe" doar în UI (L1427-1431); BD permite DELETE (RLS `fn_are_acces_ofertare`) cu ON DELETE CASCADE pe legături.
- Parola verificării finale în client: `if (p !== 'Gazpet2026')` (`OfertareLicitatii.jsx` L3952); funcția acceptă orice JWT de user (`ofertare-verificare-finala` L55-61) — fără rol.
- `aprobaPachet` refuză pe `ev.stare==='block'` doar în client (L1729); INSERT în `ofertare_pt_pachet` nu are trigger/CHECK pe poartă; `pt_poarta_id: null`.
- `semneaza` evaluează în client (L1816); `ofertare_pt_poarta` nu validează verdictul contra view-ului.
- `salveazaCapitol` nu e condiționat de `versiune` (last-write-wins); doar generatorul e (L365).
- `capitolResponsabil` L1348 și `blocheazaCapitol` L1553 nu sunt oprite de lacăt.

### BP-03 — AI UNKNOWN → fact
- **„ofertant unic"**: `ofertare-genereaza-capitol` L156: `if (!pt.length && !dc.length) parti.push('PARTICIPANȚI: niciun asociat, subcontractant sau terț susținător declarat în ERP → oferta se tratează ca OFERTANT UNIC; nu inventa subcontractanți.')` — tabel gol (live: 0 participanți, 0 declarații pe toate licitațiile) devine afirmație de fapt în prompt; combinat cu L67 „«NU E CAZUL» se poate scrie DOAR când pachetul o confirmă (ex. participanți: «ofertant unic…»)" ⇒ modelul are voie să scrie „nu e cazul" pe baza absenței datelor. Poarta îl vede doar ca WARN (`nu_e_cazul`, L61-69). Live: 3 capitole conțin „nu (este|e) cazul".
- **Garanție**: L150: `'GARANȚIA LUCRĂRILOR: neconfirmată în ERP — dacă cerințele cer un număr de luni, îl iei din textul cerinței, altfel [DE COMPLETAT].'` — modelul preia „cerut" ca „oferit" fără obiect `pt_garantie`; `controlGarantie` blochează doar dacă `garantie_luni_in_capitole` ≠ `oferit_luni` (când oferit e NULL: block doar dacă `garantie_cerinte_lucrari>0`, altfel WARN).
- **Grafic**: L147 `'GRAFICUL DE EXECUȚIE: nu există încă activități în ERP — duratele și eșalonarea rămân [DE COMPLETAT].'` (corect marcat), dar L162 celelalte capitole „[scris]" se dau ca fapte indiferent de `sursa`.
- **Afirmații**: L165 `af.map(x => ({ tip: x.tip, text: x.text || x.afirmatie || x.valoare }))` — coloanele `tip/text/afirmatie/valoare` **nu există** în `ofertare_pt_afirmatii` (coloane reale: `fel, text_brut, rol_propus, …`) ⇒ ar produce `{tip: undefined, text: undefined}`; latent (0 afirmații live).
- **Reguli doar în prompt** (nu în cod): „nu inventa fapte", „formularele doar din cerințe", „fără preț în PT" (L45-67) — singurul control post-generare e `goluri = text.match(/\[DE COMPLETAT:/g)` (L372), doar pentru toast.
- **Verificare finală**: B/C nu citesc capitolele; „verde" = „nimic în neregulă în CE AM EXTRAS" (comentariu L14-18, `acoperire_verificare` L121); UI afișează totuși `'🟢 VERDE — depunere sigură'` (`OfertareLicitatii.jsx` L3967).

### BP-04 — Version lost
- `ofertare_verificari` nu ține nicio versiune (nu `pt_versiune`, nu `pachet_id`, nu amprentă capitole) — doar `created_at`; un verdict rămâne „ultimul" oricâte modificări urmează (card L144 ia cel mai recent după `id`).
- `ofertare_pt_poarta.snapshot` = rândul view (contori), nu versiunile capitolelor; `pt_pachet.pt_poarta_id` mereu NULL (L1752) ⇒ pachet ≠ semnătură.
- `ofertare_pt_garantie`/`pt_declaratii`/`pt_participanti`/`pt_anexe_asteptate`: upsert/insert/delete fără istoric; `confirmat_la` se suprascrie la fiecare save (L1292, L1362).
- `ofertare_pt_legaturi`: `verificata` rămâne în tabel după modificarea capitolului; stale doar derivat (view/UI) — niciun `constatare`, niciun `INVALIDATA` scris (spre deosebire de cele două triggere).
- `fn_pt_capitol_versioneaza`: schimbări de `titlu`, `sursa`, `blocat`, `participant_id`, `stare` fără text nou **nu** generează versiune (deliberat, comentariu în funcție) ⇒ istoricul nu spune când s-a schimbat proveniența (ai→om) fără editare de text; `ON CONFLICT DO NOTHING` poate înghiți tăcut o versiune dacă `versiune` a fost resetată manual.
- Import extern (`sursa='extern'`, `fisier_path`) — enum există, niciun drum în UI.

### BP-05 — Evidence without identity / provenance lost
- `ofertare_pt_capitole_versiuni.schimbat_de` = NULL pe toate 32 rândurile live: generatorul scrie cu service_role ⇒ `auth.uid()` NULL; istoricul nu distinge „scris de AI" de „scris de un om cu cheie de server" decât prin `sursa` a rândului VECHI.
- 270 legături `sursa='ai'` (lic. 5, 17.09.2026) fără cod în repo care să le scrie și fără `confirmat_de`; `v_ofertare_pt_stare.cu_capitol` le numără ca „au capitol", `fara_capitol` scade, iar generatorul le folosește ca listă de cerințe (L240-244). Singura barieră: rândul `neverificate` (BLOCK) — dar `sursa` nu e folosită nicăieri în poartă/UI pentru legături.
- `ofertare_pt_dovezi`: `creat_de` nesetat de UI; `pagina_locala` = primul număr din text liber (L1707; „cap. 3 p. 12" ⇒ 3); `pagina_globala` niciodată; nu se verifică `documente_atribuire.pagini`, nici hash-ul fișierului; `document_revizie` copiat ca text la momentul legării.
- `ofertare_pt_afirmatii.sursa IN ('om','ai')` și `pagina` — fără cod de creare; verdictul de conformitate nu poate exista (0 rânduri ⇒ poartă WARN permanent „nicio afirmație încărcată").
- `pt_declaratii`/`pt_participanti`/`pt_anexe_asteptate.document_sursa/pagina` — text liber, fără FK la `ofertare_documente_atribuire` sau la capitol/versiune.

### BP-06 — Working ≠ final
- Nu există „freeze" al textului capitolelor la pachet: `aprobaPachet` generează DOCX din `capitole` (state UI, posibil vechi față de BD), hash-uiește bytes-ii și scrie doar amprenta `capitole@{id:vN}`; textul înghețat există doar în istoric (versiunile ANTERIOARE) + rândul viu (care poate fi rescris imediat). Dacă se rescrie capitolul după aprobare, versiunea aprobată există în `capitole_versiuni` doar dacă a fost înlocuită (deci da), dar nu e legată de pachet decât prin string parsing al `sursa_versiune`.
- `fn_gate_depunere` (status → `depusa`) nu cere: poartă PT semnată, pachet aprobat, verdict verificare finală, capitole `sursa='om'`; toate porțile PT sunt doar client-side/vizuale.
- `semneaza` (verdict poartă) și `aprobaPachet` sunt independente; `pt_poarta_id` NULL ⇒ nu se poate demonstra că pachetul aprobat corespunde semnăturii.
- `ofertare-verificare-finala` nu citește PT-ul deloc ⇒ „verificarea finală" verifică registrul de cerințe/acoperire, nu documentul depus; verdictul e afișat pe cardul licitației lângă PT.
- `stare` capitol (gol/scris/verificat) niciodată actualizată ⇒ badge UI „gol/scris" (L535-537) e derivat din `continut`, nu din `stare`; `capitole_goale` folosește `stare <> 'nu_se_aplica'` care nu se setează niciodată (nu există drum UI pentru `nu_se_aplica` + `stare_motiv`).
- F9/F23 DOCX-uri se descarcă direct, fără hash/manifest; „Formular" ca piesă declarată se leagă doar prin regex de etichetă.

### BP-07 — Autorizare / gate diferențiat
- `ofertare-genereaza-capitol`: rol verificat în cod (owner/responsabil). `ofertare-verificare-finala`: orice JWT user (+ secret Vault); parola e în JS-ul public. `ofertare_verificari` RLS ALL `auth.uid() IS NOT NULL` ⇒ orice user logat poate INSERT/UPDATE/DELETE verdicte direct prin PostgREST.
- `ofertare_pt_capitole`/`legaturi`/`dovezi` write = `fn_are_acces_ofertare()`; `capitole_versiuni` doar SELECT (istoric append-only prin trigger SECURITY DEFINER).

## Răspunsuri scurte la întrebările-cheie
1. **Versiune păstrată?** Da — trigger `fn_pt_capitol_versioneaza` copiază OLD în `capitole_versiuni` la orice schimbare de `continut`/`fisier_path` (om sau AI) și incrementează `versiune`. **Legătura `verificata` invalidată?** Nu în tabel; doar derivat: view `l.verificat_la_versiunea = k.versiune`, UI L312-313/L386/L402, poartă `neverificate` (BLOCK). Fără constatare scrisă.
2. **AI poate seta `scris`/`verificat` sau crea legături?** Codul edge scrie doar `continut` + `sursa='ai'` (L365), niciodată `stare` sau legături; totuși live există 270 legături `sursa='ai'` (lic. 5) fără cod în repo → inserate extern (SQL). Niciun cod nu scrie `stare` pe capitol (mașina de stări e moartă).
3. **Dovezi legate de pagină/revizie?** `document_revizie` (text copiat), `pagina_locala` (primul număr din text), `pagina_globala` nescrisă; verificate doar de trigger la schimbarea `revizie`; nicio verificare contra fișierului. Live 0 dovezi.
4. **Duplicate SQL/JS**: capcane, interzice_cumul, anexe/formulare, asociere, garanție-luni, „verificată la versiunea curentă" (vezi BP-01).
5. **verificare-finala**: A determinist, B `claude-sonnet-5`, C `claude-fable-5-1`; citește cerințe+acoperire+dovezi roșii (nu capitole PT, nu poartă); verdict persistat doar cu `created_at`, fără versiune PT/pachet; un rând live cu `verdict=NULL`.
6. **Freeze la pachet?** Doar hash DOCX + amprentă `capitole@{id:vN}` în `pachet_fisiere.sursa_versiune`; textul rămâne în `capitole_versiuni` (trigger) fără FK la pachet; `pt_poarta_id` NULL; `fn_gate_depunere` ignoră PT-ul. Live: 0 pachete, 0 semnături.
