# 08 — AS-IS: pachet final → poartă → depunere (Ofertare / propunere tehnică)

Repo `/home/user/pontaj-pro`, branch main @ 55779b5, 23.09.2026. Read-only. Live DB dxczwkbciseqniprspcu.

## 0. Live data snapshot (23.09.2026)

| Query | Result |
|---|---|
| `SELECT stare,count(*) FROM ofertare_pt_pachet` | **0 rows** — tabelul e gol |
| `ofertare_pt_pachet_fisiere` | **0 rows** |
| `ofertare_pt_poarta` | **0 rows** — nicio semnătură de poartă vreodată |
| `storage.objects WHERE bucket_id='ofertare' AND name LIKE 'pt/%'` | **0** |
| `ofertare_pt_capitole` | 15 rânduri; `grafic_versiuni` 1; `ofertare_verificari` 2 |
| licitații cu status ∈ {depusa,castigata,pierduta} | 54 (3 `depusa`: id 1 Romgaz, 6 Transgaz, 85 Laza) — **toate 54 fără niciun pachet** (max(versiune)=NULL, stare=NULL) |
| `derogare_depunere=true` | 0 |
| Domnești (lic 5, termen 18.09.2026 12:00) | status **`in_lucru`** — depusă manual 18.09, dar în ERP nici `depusa`, nici pachet |

Concluzie de date: **întregul lanț P0.5/P0.6 (manifest, hash, storage, poartă semnată) n-a fost rulat nici o singură dată în producție.** Toate depunerile reale s-au făcut în afara ERP-ului; cele 3 `depusa` au trecut `fn_gate_depunere` (sau au fost setate înainte de trigger) fără pachet.

---

## (A) PIPELINE

Câmpuri: Stage · Trigger · UI/component · Function/API/RPC · Tables/views · Input · Output · Status_before → Status_after · Human_gate · AI_action · Versioning · Provenance · Downstream_consumer · Failure/retry

**F01 — Export DOCX propunere (descărcare locală)**
- Stage: export · Trigger: click „📄 Propunerea (Word)" · UI: `src/OfertarePropunere.jsx:1938` → `exporta('propunere')` L1641-1660 · Function: `construiestePropunere()` `src/OfertareExport.js:58-92` + `descarcaDocx()` L306-314 (`Packer.toBlob`, `<a download>`) · Tables: citește state `capitole` (din `ofertare_pt_capitole`), `lic` · Input: `{licitatie, capitole}` · Output: fișier `Propunere_tehnica_<nr_anunt>.docx` pe disc utilizator · Status: nimic nu se schimbă · Human_gate: nu (iese și cu capitole goale; L84 scrie `[CAPITOL NECOMPLETAT — nu depune documentul în starea asta]` în roșu) · AI: nu · Versioning: **nu** — nu se scrie nicăieri că s-a exportat, nici hash · Provenance: nu · Downstream: omul, Word · Failure: toast.

**F02 — Export Borderou (opis)**
- Stage: export · Trigger: click „📋 Borderoul" L1941 · Function: `construiesteBorderou()` `OfertareExport.js:98-135` · Output: DOCX cu 3 coloane, coloana „Nr. pag." **goală** (L116 `celula('')` + L129 „se completează la îndosariere") · Restul identic cu F01. Borderoul e lista **capitolelor** (titluCapitol), nu a fișierelor din pachet.

**F03 — Export F23 / F9** (L1635, L1913; `construiesteF23`, `construiesteF9(ciorna)`) — F9 iese cu antet „CIORNĂ" dacă `blocajeF9.length>0` (`OfertareExport.js:258-260`). Descărcare locală, fără manifest, **nu intră în pachet** (vezi F05: pachetul = doar propunere+borderou).

**F04 — Evaluare poartă (client, pur)**
- Stage: gate-eval · Trigger: la fiecare render / după `load()` · UI: `PoartaPT` L250-…, `evPoarta` L1920 · Function: `evalueazaPoarta(st)` `src/ofertarePoarta.js:21-157` (20 rânduri; `stare: block|warn|ok`) · Tables: `v_ofertare_pt_stare` (un rând/licitație, include `pachet_stare`, `pachet_fisiere` jsonb din ULTIMA versiune de pachet, `pt_versiune`, `pt_verdict`, `grafic_versiune`) · Output: `{stare, randuri, blocaje, rezerve}` · Human_gate: nu (e calcul) · AI: nu · Versioning: nu (recalcul continuu) · Downstream: F05, F06, butoane `disabled={blocat}` L1959, L1964.

**F05 — Aprobare pachet (generare + hash + upload + manifest + aprobat)**
- Stage: package · Trigger: click „🔏 Aprobă pachetul" L1959 → `aprobaPachet()` L1726-1783 · Function: client-side, 4 scrieri secvențiale, fără tranzacție/RPC:
  1. `evalueazaPoarta(st)`; `if ev.stare==='block' → return` (L1729) — pe **state-ul din memorie**, nu recitit din BD (spre deosebire de `semneaza`).
  2. `blobDocx(construiestePropunere)`, `blobDocx(construiesteBorderou)` (L1737-1738) → `sha256Hex(blob)` (`ofertarePachet.js:16-23`, `crypto.subtle.digest`) → `construiesteManifest()` L44-55 cu `sursaVersiune = sursaVersiuneCapitole(capitole)` = `capitole@{id:vN,...}`.
  3. `INSERT ofertare_pt_pachet {licitatie_id, versiune = max+1 (din state), grafic_versiune: st.grafic_versiune, pt_poarta_id: null, nota}` (L1750-1753) — stare default `propus`.
  4. `storage.from('ofertare').upload(pt/<licId>/v<versiune>/<nume>, blob, {upsert:false})`, la eroare **retry cu `upsert:true`** (L1762-1763).
  5. `INSERT ofertare_pt_pachet_fisiere` (manifest) L1767.
  6. `UPDATE ofertare_pt_pachet SET stare='aprobat', aprobat_de=auth user, aprobat_la=now()` L1771-1772.
- Tables: `ofertare_pt_pachet`, `ofertare_pt_pachet_fisiere`, bucket `ofertare` · Status: (none) → `propus` → `aprobat` · Human_gate: `window.confirm` (L1730) + poarta ≠ block · AI: nu · Versioning: `versiune` UNIQUE(licitatie_id, versiune); pachet aprobat = imuabil prin RLS (fișiere: fără UPDATE/DELETE pentru authenticated; pachet: UPDATE doar `propus`→* sau `aprobat`→`depus`) · Provenance: `sursa_versiune` (amprenta capitolelor), `grafic_versiune` (numeric, **necontrolat de FK**) · **`pt_poarta_id` se scrie mereu NULL** — legătura pachet↔semnătură poartă NU se face niciodată în cod · Downstream: lista „Pachete aprobate" L1988-2015, `pachetDepasit()`, view-uri (F09) · Failure: catch → `DELETE ofertare_pt_pachet WHERE id AND stare='propus'` (L1777) — dar `REVOKE DELETE ... FROM authenticated` în migrație L47 ⇒ ștergerea de rollback **eșuează silențios**; rămâne un rând `propus` orfan + fișiere în bucket + eventual manifest orfan.

**F06 — Semnare verdict poartă**
- Stage: gate-sign · Trigger: click „📦 Semnează verdictul porții" L1964 → `semneaza()` L1810-1838 · Function: recitește `v_ofertare_pt_stare` (L1813), `evalueazaPoarta(proaspat)`, block → refuz; `INSERT ofertare_pt_poarta {licitatie_id, versiune = pt_versiune+1, verdict: verdictSemnatura(ev) ('verde'|'galben'), snapshot: proaspat}` L1822-1827 · `poarta` jsonb rămâne default `'[]'` (nu se scriu rândurile evaluate!), `semnat_de` = default `auth.uid()`, `semnat_la` = now() · Status: n/a (nu schimbă nimic pe licitație/pachet) · Human_gate: click; **oricine cu `fn_are_acces_ofertare()`** · Versioning: UNIQUE(licitatie_id, versiune) · Provenance: `snapshot` = rândul view-ului (include `pachet_stare`/`pachet_fisiere` ale ultimului pachet, dar **nu id-ul pachetului, nu hash-uri**) · Downstream: `v_ofertare_pt_stare.pt_versiune/pt_verdict` (afișare) — **nimeni nu consumă verdictul ca o condiție**: nici `aprobaPachet`, nici `fn_gate_depunere`, nici RLS · Failure: 23505 → „Altcineva a semnat".
- Notă: verdict `'rosu'` e permis de CHECK dar nu poate fi scris niciodată din UI (`verdictSemnatura` întoarce doar verde/galben, block refuză). `ofertare_pt_poarta_upd` / `_del` policies permit UPDATE/DELETE oricui cu acces ofertare ⇒ semnătura NU e imuabilă.

**F07 — Pachet → `depus`**
- Stage: submit · **NOT IMPLEMENTED în UI**: grep `stare: 'depus'`/`depus_la` în `src/` ⇒ zero apeluri de scriere. Există doar politica RLS `ofertare_pt_pachet_depune` (`aprobat` → `depus`, `with_check stare='depus'`) și CHECK `ofertare_pt_pachet_stare_chk` (depus ⇒ aprobat_de, aprobat_la, depus_la NOT NULL). Nimeni nu apasă niciun buton; `depus_la` e scris doar dacă cineva rulează SQL manual.

**F08 — Licitație → status `depusa`**
- Stage: submit-status · Trigger: buton „📮 Marchează Depusă" `src/OfertareLicitatii.jsx:2987` (din `TRANZITII.in_lucru = ['depusa']` L50-57) → `schimbaStatus(l,'depusa')` L279-285: `UPDATE ofertare_licitatii SET status, updated_at` · Function DB: `trg_gate_depunere BEFORE UPDATE` → `fn_gate_depunere()` (SECURITY DEFINER):
  ```
  IF NEW.status='depusa' AND OLD.status IS DISTINCT FROM 'depusa' AND NOT COALESCE(NEW.derogare_depunere,false) THEN
    n_neconfirmate := count(ofertare_cerinte WHERE licitatie_id=NEW.id AND inlocuita_de IS NULL AND confirmata_de IS NULL)
    n_neacoperite  := count(cerinte fără ofertare_acoperire.status IN ('acoperit','acoperit_partener'))
    n_rosii        := count(acoperiri cu documente_firma NOT utilizabil OR data_valabilitate < termen + (0|90) zile)
    IF any > 0 THEN RAISE EXCEPTION 'BLOCAT LA DEPUNERE: ... Rezolvă-le sau setează derogare_depunere=true (doar cu decizia lui Razvan).'
  ```
- Tables: `ofertare_licitatii`, `ofertare_cerinte`, `ofertare_acoperire`, `documente_firma` · Status: `in_lucru` → `depusa` · Human_gate: click; **fără verificare de rol în UI** (`schimbaStatus` nu verifică `is_owner`, spre deosebire de `decide` L289) · AI: nu · **NU verifică**: existența unui pachet, `pt_pachet.stare='depus'`, `sha256`, `ofertare_pt_poarta`, `ofertare_verificari.verdict`, `pt_capitole`, `grafic_versiuni` · Bypass: `derogare_depunere` — coloană pe `ofertare_licitatii`, **fără UI care s-o seteze** (grep `derogare` în src ⇒ 0), setabilă prin UPDATE de orice user cu acces la tabel (politica de UPDATE pe `ofertare_licitatii` nu e restricționată la owner — confirmat de auditul R07); textul „doar cu decizia lui Razvan" e doar în mesajul de eroare · Downstream: F09, F10 · Failure: `RAISE EXCEPTION` → toast „Eroare: BLOCAT LA DEPUNERE…".

**F09 — Consumatori post-depunere: clarificări AC**
- `v_ofertare_solicitari_ac_stare` (CTE `dep`): `depus_la = COALESCE(max(pk.depus_la) WHERE pk.stare='depus', l.termen_depunere)`, `depus_sursa = 'pachet'|'termen_licitatie'`; CTE `anx`: `provenienta='retrimis'` dacă `a.sha256` = un `ofertare_pt_pachet_fisiere.sha256` dintr-un pachet `depus`. Consumat de `evalueazaPoartaClarificare` (`ofertarePoarta.js:180-255`) și `OfertareClarificariAC.jsx:194`. **Azi, cu 0 pachete, toate licitațiile cad pe `termen_licitatie` → rând warn `depus_sursa`.**

**F10 — Consumatori post-depunere: mail**
- `supabase/functions/ofertare-etapa1-mail/index.ts:186-197`: `reminder_depunere` se trimite o singură dată când `zile ≤ 5` și `status ∈ (go,in_lucru,analiza)`; dedupe pe `ofertare_mailuri.tip='reminder_depunere'`. Nu citește pachet/poartă; nu se declanșează după `depusa`.

**F11 — Verificare finală AI (paralelă, neconectată)**
- `ofertare-verificare-finala/index.ts`: A determinist (aceleași 3 numărători ca fn_gate_depunere) + B adversarial (sonnet) + C arbitru (fable) → `INSERT ofertare_verificari {verdict}`. Auth: JWT user SAU `x-radar-secret`. Rezultatul e doar **afișat** (`OfertareLicitatii.jsx:144,417,2844` „🟢 VERDE — depunere sigură") — **nu e condiție** nicăieri (nici trigger, nici RLS, nici UI la F08). Comentariul L14-18 din funcție: verdictul verde = „nimic în neregulă în CE AM EXTRAS", nu „depunere sigură" — UI-ul îl afișează totuși ca „depunere sigură".

**F12 — „Semnare" fișiere / ofertare-fisier-semnat**
- `supabase/functions/ofertare-fisier-semnat/index.ts`: **NU e semnare de document.** Emite **signed URLs** (`createSignedUrl`, L74-78) pentru `ofertare_documente_atribuire.fisier_path` și mod `pasaje` (JSON cu cerințe în `_temp/`). Auth: `x-fisier-secret` via `fn_verifica_fisier_secret`. Nu atinge `pt_pachet_fisiere.semnat`, nu verifică p7s/PAdES, nu scrie nimic în manifest.

---

## (B) OBJECT LIFECYCLES

### package (`ofertare_pt_pachet`)
- where_created: `aprobaPachet()` `OfertarePropunere.jsx:1750` (client INSERT, stare `propus`).
- where_updated: L1771 → `aprobat`. `aprobat`→`depus`: **nicăieri în cod** (doar RLS permite).
- how_versioned: `versiune = pachete[0].versiune+1` din state; UNIQUE(licitatie_id, versiune); versiune eșuată = număr sărit.
- how_invalidated: **doar vizual** — `pachetDepasit(p, capitole)` (`ofertarePachet.js:68-72`) compară `sursa_versiune` cu `sursaVersiuneCapitole(capitole)` la render (L2001 „⚠ DEPĂȘIT"). Niciun trigger pe `ofertare_pt_capitole`/`grafic_versiuni` nu atinge `pt_pachet` (triggere pe capitole: doar `fn_pt_capitol_versioneaza` + `set_updated_at`). Nu există coloană `depasit`/`invalidat`.
- how_confirmed: `aprobat_de/aprobat_la` = utilizatorul curent (= creatorul; **aprobator = creator, fără 4-eyes**). CHECK cere doar NOT NULL.
- how_linked_to_source: `grafic_versiune` (int, fără FK), `fisiere.sursa_versiune` (string `capitole@{…}`), `pt_poarta_id` **mereu NULL**.
- how_linked_to_final_package: obiectul ESTE pachetul; dar conține doar 2 DOCX generate (propunere + borderou). Anexele/F9/F23/PDF-urile scanate/ZIP-ul depus în SEAP **nu apar** — coloanele `anexa_ref, semnat, sursa_participant, unit_in` nu au niciun writer în `src/` (doar SELECT L1214 și view).

### package file / artifact (`ofertare_pt_pachet_fisiere` + `storage ofertare/pt/<lic>/v<n>/<nume>`)
- where_created: L1762 (upload) + L1767 (manifest INSERT), în pachet `propus`.
- where_updated: **niciodată** (REVOKE UPDATE/DELETE authenticated). Storage: politica `ofertare_storage_rw` = **ALL pentru authenticated pe tot bucket-ul** ⇒ obiectul din bucket poate fi suprascris/șters de oricine autentificat, în timp ce manifestul rămâne „imuabil".
- how_versioned: prin pachet (calea conține `v<n>`).
- how_invalidated: n/a.
- how_confirmed: `sha256` calculat pe blob-ul generat client-side **înainte** de upload (`sha256Hex(f.blob)` L1741, `Packer.toBlob`); niciodată re-verificat față de storage (NOT IMPLEMENTED); `semnat` default false, niciun writer.
- how_linked_to_source: `sursa_versiune` (aceeași amprentă pentru ambele fișiere; nu per capitol per fișier).
- how_linked_to_final_package: FK `pachet_id`.

### gate record (`ofertare_pt_poarta`)
- where_created: `semneaza()` L1822.
- where_updated: nicăieri în cod, dar RLS `ofertare_pt_poarta_upd/_del` permit UPDATE/DELETE pentru orice user cu acces ofertare ⇒ **mutabil**.
- how_versioned: `versiune = pt_versiune+1`, UNIQUE.
- how_invalidated: niciodată; `pt_verdict` din view = ultima versiune, indiferent de ce s-a schimbat după.
- how_confirmed: `semnat_de = auth.uid()` (default), `verdict ∈ verde|galben` (rosu nescriibil din UI).
- how_linked_to_source: `snapshot` = rândul întreg `v_ofertare_pt_stare` (conține `pachet_fisiere` cu nume/rol, nu hash; `grafic_versiune`; contoare). `poarta` jsonb rămâne `[]` (rândurile evaluate NU se persistă).
- how_linked_to_final_package: **NU** — `pt_pachet.pt_poarta_id` e scris NULL (L1752); niciun cod nu leagă poarta de pachet. Ordinea UI sugerează „aprobă pachetul, apoi semnează", dar ambele sunt independente și pot fi făcute în orice ordine sau doar una.

### signing record
- **NOT IMPLEMENTED.** Nu există tabel/coloană care să înregistreze o semnătură electronică (p7s/PAdES/XAdES) pe artefact. `pt_pachet_fisiere.semnat boolean` = intenție declarativă (migrația 20260913_…completitudine_semnatura L11-14: „un fișier SEMNAT nu se modifică pentru a fi unit"), fără writer și fără verificare criptografică. `ofertare-fisier-semnat` = signed URLs (F12). Semnătura porții (`semnat_de`) = click autentificat, nu semnătură pe bytes.

### submitted artifact (ce a primit efectiv autoritatea — ZIP/PDF SEAP)
- **NOT IMPLEMENTED.** Nu există upload al pachetului depus (ZIP SEAP, PDF asamblat, recipisă SEAP). `ofertare_licitatii.status='depusa'` e singura urmă, fără timestamp dedicat (`updated_at` generic), fără fișier, fără hash. Closest thing: `pt_pachet.depus_la` (fără writer) și `v_ofertare_solicitari_ac_stare` care cade pe `termen_depunere`.

---

## (C) FINAL_PACKAGE_FLOW (ordonat) — ce există / NOT IMPLEMENTED

1. **export** — EXISTS (F01-F03): DOCX generate client, `docx` 9.7.1; propunere+borderou+F23+F9. NOT IMPLEMENTED: asamblare anexe, numerotare pagini reale (`OfertareExport.js:15-19` o spune explicit), PDF final.
2. **borderou/opis** — EXISTS ca DOCX cu coloană pagini goală. NOT IMPLEMENTED: opis al fișierelor din pachet (borderoul listează capitole, nu manifestul); legătură opis→fișier→pagină.
3. **hash** — EXISTS: SHA-256 client (`crypto.subtle`) pe blob-ul generat, înainte de upload; CHECK regex în BD. NOT IMPLEMENTED: hash pe ce s-a depus efectiv; re-hash după upload/din storage; hash pe anexe/F9/F23.
4. **storage** — EXISTS: bucket `ofertare`, `pt/<licId>/v<n>/<nume_sanitizat>`, `upsert:false` cu fallback `upsert:true`. Bucket policy = ALL authenticated (nu e write-once). NOT IMPLEMENTED: verificare că obiectul din bucket are sha256 din manifest.
5. **manifest** — EXISTS: `ofertare_pt_pachet_fisiere` (rol, nume, mime, size_bytes, sha256, fisier_path, sursa_versiune) append-only prin RLS. Coloanele `anexa_ref, semnat, sursa_participant, unit_in` există în schemă + view + `controlPachetComplet`, dar **fără niciun writer** (NOT IMPLEMENTED în UI).
6. **approval** — EXISTS: `stare propus→aprobat`, `aprobat_de/la`, blocată de `evalueazaPoarta(st).stare==='block'` doar în UI (L1729), pe state posibil stale. NOT IMPLEMENTED: rol de aprobator, separare creator/aprobator, cerință de poartă semnată, verificare server-side a porții.
7. **gate** — EXISTS: `evalueazaPoarta` (pur, testat, 20 rânduri) + `ofertare_pt_poarta` (snapshot). NOT IMPLEMENTED: `pt_poarta_id` pe pachet; persistarea rândurilor (`poarta` jsonb rămâne `[]`); imutabilitate (RLS upd/del deschise); verdict `rosu`; consum al verdictului de către orice pas ulterior.
8. **signing** — NOT IMPLEMENTED (vezi B/signing record). `ofertare-fisier-semnat` ≠ semnare.
9. **depus (pachet)** — NOT IMPLEMENTED în UI (doar RLS + CHECK există).
10. **depusa (licitație)** — EXISTS: buton + `fn_gate_depunere` (cerințe confirmate/acoperite/dovezi valabile). NOT IMPLEMENTED: orice legătură cu pachet/poartă/hash/artefact depus; restricție owner pe `derogare_depunere`; UI pentru derogare; timestamp de depunere.
11. **post-submission** — EXISTS: `v_ofertare_solicitari_ac_stare` (provenienta anexelor prin sha256 vs pachet depus) și rând warn `depus_sursa='termen_licitatie'`; azi 100% pe fallback.

---

## (D) BREAK_POINTS

**BP-1 `depusa` fără dovadă de pachet** — `public.fn_gate_depunere` (trigger `trg_gate_depunere BEFORE UPDATE ON ofertare_licitatii`): condiția e exclusiv `n_neconfirmate>0 OR n_neacoperite>0 OR n_rosii>0`. Nu apare `ofertare_pt_pachet`, `ofertare_pt_poarta`, `ofertare_pt_capitole`, `ofertare_verificari`. Live: 54 licitații finale, 0 pachete, 0 porți. `OfertareLicitatii.jsx:279-285` `schimbaStatus` = UPDATE simplu, fără rol.

**BP-2 Derogare fără poartă de rol** — `fn_gate_depunere`: `AND NOT COALESCE(NEW.derogare_depunere,false)` — mesajul spune „doar cu decizia lui Razvan", dar nici funcția, nici RLS pe `ofertare_licitatii`, nici UI (0 apariții `derogare` în `src/`) nu impun owner. = R07 din `scratchpad/audit.txt:283-289`, **neremediat** (verificat 23.09: funcția e identică cu descrierea din audit).

**BP-3 Artefact depus fără hash** — nu există upload al ZIP/PDF-ului depus; `sha256` există doar pe DOCX-urile generate client (`OfertarePropunere.jsx:1741`), niciodată pe ce pleacă în SEAP. Hash-ul nu e re-verificat față de storage (NOT IMPLEMENTED); bucket `ofertare` = `ofertare_storage_rw ALL authenticated` ⇒ bytes-ii din `pt/…` pot fi înlocuiți după aprobare, manifestul rămânând „valid".

**BP-4 working ≠ final ≠ submitted** —
- working: `ofertare_pt_capitole` (versionate de `fn_pt_capitol_versioneaza` doar la schimbare de `continut`/`fisier_path`);
- final: `pt_pachet` cu `sursa_versiune` string; invalidarea e **doar la render** (`pachetDepasit`, L2001), fără trigger, fără coloană; capitolele pot fi rescrise oricând după `aprobat` fără nicio consecință în BD; `grafic_versiune` int fără FK (versiunea poate fi ștearsă/re-generată);
- submitted: inexistent ca obiect; `status='depusa'` nu e legat de nicio versiune de pachet/poartă/capitole. Poarta `semneaza()` poate fi semnată **înainte** de a exista pachetul (view: `pachet_stare NULL` ⇒ `controlPachetComplet` „ok dormant" — migrație L18-20), iar semnătura nu se re-evaluează niciodată.

**BP-5 Pachetul nu e legabil la surse/poartă** — `OfertarePropunere.jsx:1752 pt_poarta_id: null` (singurul writer). `ofertare_pt_poarta.poarta` rămâne `'[]'` (rândurile evaluate nu se salvează; doar `snapshot` brut). `sursa_versiune` e aceeași amprentă globală pe ambele fișiere, nu per-capitol per-fișier; anexele nu au `dovada_id`/`document_id` (coloanele `anexa_ref/sursa_participant` fără writer).

**BP-6 UI vs server** — regulile de aprobare/semnare trăiesc **doar în client**: `aprobaPachet` L1729 (`ev.stare==='block'` pe state din memorie, nu recitit), `semneaza` L1816 (recitit, dar tot client). Server-side nu există nicio verificare: RLS pe `pt_pachet` cere doar `fn_are_acces_ofertare()`; CHECK cere doar NOT NULL pe `aprobat_de/la`. Oricine cu modul `ofertare` poate insera direct un pachet `aprobat`/`depus` sau o poartă `verde` prin PostgREST, fără să treacă prin evaluator. Fallback de rollback (L1777 `DELETE … stare='propus'`) contrazice `REVOKE DELETE` din migrație ⇒ rânduri `propus` orfane la eșec.

**BP-7 Regulă duplicată** — verificarea „cerințe neconfirmate / neacoperite / dovezi roșii" există în 3 locuri: `fn_gate_depunere` (SQL, blocant), `ofertare-verificare-finala` trecerea A (TS, doar raport), `v_ofertare_pt_stare`+`evalueazaPoarta` (JS, altă semantică: `fara_capitol`, `cerinte_neverificate` pe `ofertare_pt_legaturi`, nu pe `confirmata_de`). Verdictele nu se citesc reciproc: `ofertare_verificari.verdict` e afișat ca „depunere sigură" (`OfertareLicitatii.jsx:2844`) dar nu condiționează nimic; `pt_poarta.verdict` nu condiționează `fn_gate_depunere`; `fn_gate_depunere` nu știe de poartă. `ofertarePoarta.js:1-13` recunoaște că a centralizat DOAR copia din `OfertarePropunere.jsx`, nu și pe cea din SQL/Edge.

**BP-8 „semnat" fără semnătură** — `pt_pachet_fisiere.semnat` (bool, default false, fără writer); `ofertare_pt_poarta.semnat_de` = click autentificat; `ofertare-fisier-semnat` = signed URL, nu semnătură. Nicio verificare p7s/PAdES nicăieri (grep `p7s|pades|xades|pkcs` ⇒ nimic în ofertare).

**BP-9 Opis → document → pagină: NOT IMPLEMENTED** — niciun pas nu recitește artefactul final. Closest: `controlPachetComplet` (`ofertareControale.js:490+`) compară **nume/ref** din `anexe_asteptate`/`anexe_declarate` cu `pachet_fisiere[].nume/anexa_ref` (string matching), nu conținut; `construiesteBorderou` lasă „Nr. pag." gol; `OfertareExport.js:15-19` declară explicit că asamblarea/paginarea nu se face.

---

## Răspunsuri scurte la întrebările cheie
1. `fn_gate_depunere`: cere 0 cerințe neconfirmate (`confirmata_de IS NULL`), 0 fără acoperire favorabilă, 0 dovezi roșii. **Nu** cere pachet `depus`, **nu** cere sha256, **nu** cere poartă. `derogare_depunere=true` = bypass total; setabilă de orice user cu UPDATE pe `ofertare_licitatii` (fără UI, fără owner-check în DB).
2. Re-citire artefact final / opis→document→pagină: **NOT IMPLEMENTED**. Closest: `controlPachetComplet` (nume), `pachetDepasit` (amprentă versiuni), borderou cu pagini goale.
3. sha256: client, `crypto.subtle`, pe `Packer.toBlob()` **înainte** de upload (aceiași bytes trimiși la upload, dar fără confirmare de la storage); niciodată re-verificat; bucket suprascriibil de authenticated.
4. `sursa_versiune` = `capitole@{id:vN,…}` (amprenta tuturor capitolelor, aceeași pe toate fișierele) + `grafic_versiune` int pe pachet. Neenforțat: fără FK, fără trigger; doar `pachetDepasit` la render.
5. Aprobare: oricine cu `fn_are_acces_ofertare()` (owner sau `user_module_access.module='ofertare'`); aprobator = creator (același `auth.uid()`); poarta trebuie ≠ block **doar în UI**; verdict semnat (`pt_poarta`) **nu** e cerut.
6. `semnat` = boolean declarativ fără writer; nicio semnătură criptografică; `ofertare-fisier-semnat` = signed URLs.
7. Da — capitolele/graficul se pot schimba liber după `aprobat`; niciun trigger nu atinge `pt_pachet`; invalidarea e vizuală (`⚠ DEPĂȘIT`) și doar pentru ultima versiune afișată.
8. R07 (audit.txt:283): „porțile de depunere au reguli diferite; derogarea nu e rezervată ownerului în DB" — **confirmat neremediat**: funcția live e identică; nici pachetul, nici legăturile PT, nici `reverificare_ceruta` nu sunt verificate; owner-check lipsește.
