# E3 — designul intrărilor API pentru documentele de intrare (r5) — pentru review ÎNAINTE de cod

**r5 (21.10.2026)** răspunde la Jakarinos pe r4 (NO-GO, 0 × P0, 2 × P1 rămase). Închise în r4 de Jak: anularea draftului, evenimentul fără FK circular, reintroducerea după anulare, `nivel <> 'off'`.

| # | P1 din r4 | Unde | Pe scurt |
|---|---|---|---|
| 1 | [Jak] Comparația JSON poate refuza bucata corectă (`radacina_id` rămâne; cheile nu sunt aceeași mulțime) | §3.2, §7.2 | o singură **proiecție explicită** `C` (lista constantă de coloane, cu NULL-urile incluse), aplicată identic pe ambele părți; `radacina_id` exclus din ambele și verificat separat `NEW.radacina_id = NEW.id`; INSERT-ul confirmării scrie TOATE coloanele din `C`, deci nicio valoare implicită nu intră în comparație |
| 2 | [Jak] Verificarea locației n-are drepturi | §3.5, §4 | `fn_izo_loc_valid` (E2a, DEFINER) pentru depozit ↔ site-ul proiectului; `fn_izo_site_proiect` pentru `locatie_site_id`; `fn_izo_tip_material` pentru `tip_material_id` — toate cu EXECUTE pentru `izo_receptie_writer`, trecute în matrice |

P2 (Jak r4), trecute în design: SQL-ul exact al celor două indexuri de eveniment (intrarea și PV-ul separat, §2); testul 14 reconciliat cu egalitatea brută a seriei (§10); explicația pentru `off` corectată: E2a refuză `stoc → off` după orice eveniment, deci cazul nu e accesibil prin API (§9.1). Testele din §10 sunt cerințe; rezultatele vin la cod, rulate cu rolurile reale.

---

Istoricul r4 (păstrat pentru review):

**r4 (21.10.2026)** răspunde la review-ul r3 (Copilot și Jakarinos: NO-GO, 0 × P0). Închise de ambii în r3: revocarea modulului, PV-ul, hash-ul recalculat, unicitatea țevii, scanul șters. Ce se schimbă în r4:

| # | P1 din r3 | Unde | Pe scurt |
|---|---|---|---|
| 1 | [Cop+Jak] Documentul corectat nu se mai poate reintroduce după anulare | §2, §9.1 | identitatea e unică doar pe documentele **neanulate** (index parțial) + legătura `inlocuieste_document_id` |
| 2 | [Cop] `= 'stoc'` contra `<> 'off'` | §4, §3.5, §9.1 | un singur predicat peste tot: `fn_izo_nivel(p) <> 'off'` (adică `stoc` sau `montaj`); anularea în `off`: decizie explicită |
| 3 | [Jak] Garda nu e o frontieră completă | §3.2 | un singur predicat de autorizare `v_aut`, calculat o dată și pus în locul celor 3 apeluri `fn_izo_garda_scriitor()` din E2a, fără RETURN timpuriu; `miscare.proiect_id`; bucata comparată câmp cu câmp cu rândul documentului (`fn_izo_doc_bucata_asteptata`) |
| 4 | [Jak] Apelurile tranzitive lipsesc din matrice | §3.5 | tabelul complet al funcțiilor chemate de gărzi / politici / intrări, pe fiecare rol (`fn_izo_tip_cod`, `fn_izo_garda_scriitor`, `fn_izo_nivel`, `fn_izo_uid`, porțile la editor) |
| 5 | [Jak] Anularea draftului se contrazice | §3.2, §5, §9.1 | context separat `anulare_draft`: doar antetul, fără evenimente |
| 6 | [Jak] Dependența circulară eveniment ↔ document | §3.2, §7.2 | evenimentul se identifică prin indexul unic parțial (document, tip), nu prin FK-ul antetului; antetul primește la final exact acel eveniment |

P2-urile din r3 (coloanele generate în BEFORE, evenimentul exact pe antet, atributele rolurilor, testul de migrare peste un proiect activ, regula pentru E4) sunt trecute ca cerințe în §3.1, §3.2, §8 și §10.

---

Istoricul r3 (păstrat pentru review):

**r3 (21.10.2026)** răspunde la review-ul r2 (Copilot: NO-GO, 4 × P1 + P2; Jakarinos: NO-GO, P1 deschise pe 1/3/6/7/8 + 2 P1 noi; 0 × P0). Ce se schimbă față de r2:

| # | Punctul din r2 | Unde | Pe scurt |
|---|---|---|---|
| 1 | Revocarea modulului poate depăși confirmarea | §3.4, §4 | rândul exact din `user_module_access` intră în protocolul de lock (`FOR SHARE`), cu teste cu barieră pe UPDATE / DELETE |
| 2 | Garda nu exprimă operația | §3.2 | marcajul devine **contextul operației** (`txid`, `op`, document, proiect, depozit, versiune); garda verifică legăturile fiecărui rând scris |
| 3 | `hash_verificat` nu poate fi satisfăcut | §2, §7 | coloana dispare; confirmarea recalculează hash-ul sub lock și îl compară cu `p_hash` + `p_versiune` |
| 4 | Unicitatea țevii | §7.1 | definițiile exacte ale indexurilor, `dezambiguare = NULL` ca importul, indexul nou (document, rând), test concurent cu două documente |
| 5 | Scanul șters înaintea confirmării | §6.1 | un obiect din manifest nu se poate șterge în nicio stare; ștergerile se serializează pe rândul documentului; confirmarea verifică existența obiectelor sub lock |
| 6 | PV: mulțimea așteptată | §8 | se pornește de la TOATE rândurile `primit`; fiecare bucată e verificată (existență, apartenență, stare, depozit), fără filtrare; zero eligibili = definit |
| 7 | Privilegii ↔ operații | §3.5 | matricea completă: GRANT-uri pe coloane, RLS pentru rolurile noi, helpere, secvențe, excepțiile porților |
| 8 | Storno / revenire | §9 | operația administrativă `fn_izo_doc_anuleaza` (PV-ul înaintea intrării, refuz peste dependențe), ramura administrativă din trigger-ul de imutabilitate, revenirea E3 refuză orice fapt E3 |
| P2 | Versiunea la confirmare / PV | §2, §7, §8 | `versiune` crește la fiecare scriere a documentului (salvare, confirmare, PV, anulare) |

Rămân din r2 (închise în review): încrederea în gateway (§3.3), ordinea lock-urilor locurilor (§4), salvarea draftului (§5), canonizarea hash-ului (§6), marcajul pus după validări (§4 pas 7), coliziunile procedurale.

Decizia Razvan (21.10): Q-E3-2 = A — Janeta confirmă din UI, iar designul se revizuiește înainte de cod. Celelalte răspunsuri: tabelele `izo_*`; neconformitate → carantină; toleranțe ±10 mm / ±0,5° → avertisment; `lungime_mm` = măsurat ?? document; curba: serie = bend, șarjă = heat.

## 1. Frontiera, pe scurt

**Ce vine din API** (`authenticated`, cu atribuire):
- `fn_izo_doc_salveaza`: draft, creare / editare;
- `fn_izo_doc_verifica`: **doar citire**; întoarce `{versiune, hash, verdict, avertismente}`; nu scrie nimic;
- `fn_izo_doc_confirma(p_doc_id, p_versiune, p_hash)`: draft → confirmat, cu bucățile în registru;
- `fn_izo_doc_pv(p_doc_id, p_versiune, p_pv_nr, p_pv_data)`: confirmat → PV, bucățile `sosit` → `receptionat`.

**Ce rămâne exclusiv `postgres`** (N3 din E2a, neschimbat):
- activarea / dezactivarea, importul și storno-ul importului, atribuirile, corecțiile pe bucăți;
- **anularea unui document** (`fn_izo_doc_anuleaza`, §9) — operație nouă, administrativă.

Administrarea `postgres` nu primește o identitate umană fictivă: `aplicat_de` rămâne NULL, iar `aplicat_rol` = `postgres`.

## 2. Schema nouă (migrarea `20261103b_izometrie_e3_documente`; 20261102a aplicată NU se modifică)

**`izo_documente_intrare`** (antet):
- `id`, `proiect_id`, `depozit_id`, `sablon` ∈ {`aviz_teava`, `lista_ambalare_curbe`};
- identitatea: `furnizor_canon` (NOT NULL, upper + spații normalizate), `nr_document_canon` (NOT NULL, upper, fără spații), `data_document` (NOT NULL);
  - **r4:** `ux_izo_doc_identitate` UNIQUE (`furnizor_canon`, `nr_document_canon`, `data_document`) **WHERE `stare <> 'anulat'`**. Un singur document viu (draft sau confirmat) per identitate. După anulare, identitatea se eliberează și documentul corectat se poate introduce din nou. Două creări concurente cu aceeași identitate: indexul e arbitrul (a doua → 23505, mesaj clar);
  - `inlocuieste_document_id` (FK → `izo_documente_intrare(id)`, UNIQUE, opțional, dat doar la creare): documentul nou poate indica documentul anulat pe care îl corectează. La creare se cere ca acela să fie `anulat`, cu aceeași identitate canonică și pe același proiect. Audit: lanțul anulat → corectat se citește din BD;
- câmpurile de pe document, după șablon (E3_PLAN §1), și totalurile;
- `stare` ∈ {`draft`, `confirmat`, `anulat`};
- `versiune` (bigint NOT NULL, ≥ 1): **+1 la fiecare scriere a documentului** — salvare, confirmare, PV, anulare (P2);
- `hash_confirmat` (`e3-doc-v1:<sha256>`). **Nu există `hash_verificat`** (r3, punctul 3);
- `avertismente` (jsonb, scris la confirmare);
- confirmarea: `confirmat_de`, `confirmat_la`, `eveniment_intrare_id` (FK, UNIQUE);
- PV: `pv_nr_canon`, `pv_data`, `pv_pus_de`, `pv_pus_la`, `eveniment_pv_id` (FK, UNIQUE);
- anularea: `anulat_de_rol`, `anulat_la`, `anulat_motiv`, `eveniment_storno_intrare_id`, `eveniment_storno_pv_id` (FK, UNIQUE);
- `creat_de`, `creat_la`;
- CHECK-uri de coerență:
  - `confirmat` ⇒ coloanele de confirmare NOT NULL;
  - PV parțial interzis (toate coloanele PV sau niciuna);
  - `anulat` ⇒ `anulat_de_rol` / `anulat_la` / `anulat_motiv` NOT NULL;
  - **r4:** (`eveniment_storno_intrare_id IS NOT NULL`) = (`eveniment_intrare_id IS NOT NULL AND stare = 'anulat'`), la fel perechea PV. Un draft anulat n-are evenimente (nici de intrare, nici storno), iar un confirmat anulat le are pe amândouă;
  - `draft` ⇒ confirmarea / PV-ul / anularea NULL.

**`izo_documente_intrare_randuri`:**
- `document_id`, `nr_crt` (UNIQUE (`document_id`, `nr_crt`), > 0);
- câmpurile fizice: lungimile în **mm întregi**, kg cu **o zecimală**, unghiul cu **o zecimală**, perete / diametru;
- `decizie` ∈ {`primit`, `refuzat_la_receptie`, `primit_neconform`}, `motiv`;
- `bucata_id` (UNIQUE, FK `magazie_bucati`, pus doar de confirmare; CHECK: `refuzat_la_receptie` ⇒ `bucata_id IS NULL`).

**`izo_documente_scanuri`** (manifestul):
- `document_id`, `cale` (text, dată de server: `<document_id>/<uuid>.pdf`, UNIQUE), `sha256_original`, `sha256_pdf`, `marime`, `mime`, `adaugat_la`;
- e parte din hash; după confirmare e imutabil.

**`magazie_bucati` (coloane E2a, nemodificate):** E3 adaugă doar:
- FK-ul `magazie_bucati_izo_aviz_fkey` (`aviz_intrare_id` → `izo_documente_intrare(id)`, ON DELETE RESTRICT; rândurile existente au NULL);
- indexul `ux_magbuc_izo_aviz_rand ON magazie_bucati (aviz_intrare_id, nr_crt_aviz) WHERE aviz_intrare_id IS NOT NULL AND stare <> 'anulata'` — o singură bucată vie per rând de document.

Ambele au nume care intră deja în amprenta porților E2a (`magazie_bucati_izo_%`, `ux_magbuc_izo_%`).

**Evenimentele.** CHECK-ul `magazie_bucati_evenimente.tip` primește `intrare_lista_ambalare` și `receptie_pv`; `intrare_aviz` rămâne pentru avizul de țeavă.
- **UNIQUE parțial (r5, SQL exact):** intrarea și PV-ul au indexuri SEPARATE, altfel PV-ul ar fi blocat de evenimentul de intrare al aceluiași document:
  ```sql
  CREATE UNIQUE INDEX ux_magbuc_ev_doc_intrare ON public.magazie_bucati_evenimente (document_id)
    WHERE document_tip = 'doc_intrare' AND tip IN ('intrare_aviz', 'intrare_lista_ambalare');
  CREATE UNIQUE INDEX ux_magbuc_ev_doc_pv ON public.magazie_bucati_evenimente (document_id)
    WHERE document_tip = 'doc_intrare' AND tip = 'receptie_pv';
  ```
  Storno-urile (`tip = 'storno'`) nu intră în niciunul; unicitatea lor vine din `storno_de_eveniment_id UNIQUE` (E2a).
- Auditul folosește coloanele E2a reale: `aplicat_de`, `aplicat_rol`, `ora_server`, `document_tip` = `doc_intrare`, `document_id` = `<id>`, `motiv` = `<hash_confirmat>` (pe intrare) / `PV <nr>` (pe PV). Hash-ul complet + manifestul stau pe document.

## 3. Rolurile, încrederea, privilegiile

### 3.1 Două roluri noi, NOLOGIN NOINHERIT, membru doar `postgres` (SET, fără INHERIT), ca la E2a

| Rol | Deține (owner, DEFINER) |
|---|---|
| `izo_doc_editor` | `fn_izo_doc_salveaza`, `fn_izo_doc_verifica` |
| `izo_receptie_writer` | `fn_izo_doc_confirma`, `fn_izo_doc_pv`, `fn_izo_doc_anuleaza`, `fn_izo_receptie_marcheaza` |

`izo_registru_writer` NU e folosit de E3: fără ALTER pe config / importuri / atribuiri. Drepturile exacte stau în matricea din §3.5.

**Postcondiție pe roluri (r4, P2):** ambele roluri `NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`. Membership-urile sunt exact: `postgres` membru în fiecare (SET TRUE, INHERIT FALSE, fără ADMIN), iar rolurile noi nu sunt membre în niciun alt rol. Migrarea verifică în `pg_roles` / `pg_auth_members` și refuză la orice abatere.

### 3.2 Garda: contextul operației, integrată în predicatul de autorizare E2a (r4, punctele 3, 5, 6)

**Marcajul E3 = contextul operației.** GUC-ul `izo.receptie_ctx` conține:
`<txid>|<op>|<document_id>|<proiect_id>|<depozit_id>|<versiune la intrare>`, cu `op` ∈ {`confirma`, `pv`, `anulare`, `anulare_draft`}.

- Îl scrie DOAR `fn_izo_receptie_marcheaza(...)` (owner `izo_receptie_writer`, EXECUTE doar owner-ul, deci neexpusă; gate-ul 0e rămâne curat pe intrările expuse). Intrările o cheamă la pasul 8 din §4, după toate validările.
- La intrare, fiecare funcție E3 refuză dacă `izo.receptie_ctx` nu e gol.

**Integrarea în E2a, fără RETURN timpuriu (r4, punctul 3).** În `fn_izo_garda_bucati` și `fn_izo_garda_fapte`, predicatul de autorizare se calculează **o singură dată, la începutul funcției**, într-o variabilă:
```
v_aut := public.fn_izo_garda_scriitor();                       -- E2a, neschimbată
IF NOT v_aut AND current_user = 'izo_receptie_writer' THEN      -- IF explicit: fără scurtcircuit presupus în SQL
  v_aut := public.fn_izo_garda_receptie(TG_TABLE_NAME, TG_OP, OLD, NEW);   -- true sau RAISE 42501, niciodată false tăcut
END IF;
```
- Cele **trei** locuri din E2a unde apare `fn_izo_garda_scriitor() IS NOT TRUE` sunt înlocuite cu `NOT v_aut`, fără nicio altă modificare: (1) rândul de registru (`tip_cod` setat), (2) beneficiar pe proiect cu nivel ≠ off, (3) `fn_izo_garda_fapte` după refuzurile TRUNCATE / DELETE / UPDATE.
- Funcția continuă exact ca în E2a, pentru toți scriitorii: lock-ul partajat pe proiect + READ COMMITTED, refuzul stărilor `rezervata` / `consumata`, DELETE refuzat, nivelul ≠ `off` pentru rândurile de registru, `tip_cod` = `fn_izo_tip_cod(tip_material_id)`. Nu există niciun `RETURN` înainte de aceste verificări.
- Pentru `izo_registru_writer` și pentru clienți comportamentul e identic cu E2a. Testul de regresie rulează suita E2a nemodificată după aplicarea E3 (§10, 13).

**`fn_izo_garda_receptie`** (owner `postgres`, INVOKER: citește cu drepturile `izo_receptie_writer`; EXECUTE doar acest rol):
1. contextul e bine format, iar `txid` = `txid_current()`;
2. recitește documentul din context (rândul e deja `FOR UPDATE` de la pasul 1) și cere `proiect_id` / `depozit_id` / `versiune` = cele din context, plus starea cerută de `op`;
3. aplică regula din tabelul de mai jos pentru (`TG_TABLE_NAME`, `TG_OP`, `op`). Orice combinație absentă → RAISE 42501.

**Coloanele generate în BEFORE ROW (r4, P2).** `serie_canon` și `lungime_cm` sunt STORED GENERATED: într-un trigger BEFORE, `NEW` nu le conține calculate. Garda nu le citește niciodată din `NEW`:
- seria canonică se calculează explicit (`upper(regexp_replace(NEW.serie, '[[:space:]._/-]', '', 'g'))`, aceeași expresie ca în coloana E2a, citită din catalog la migrare și comparată);
- comparațiile „restul rândului identic” la UPDATE scot din `to_jsonb(OLD)` / `to_jsonb(NEW)` coloanele modificabile **și toate coloanele generate** (lista din `pg_attribute.attgenerated = 's'`, fixată la migrare și verificată în porți).

**Identificarea evenimentului (r4, punctul 6).** Garda nu folosește FK-urile antetului (`eveniment_intrare_id` / `eveniment_pv_id`), care se scriu abia la final. „Evenimentul de intrare al documentului” = singurul rând din `magazie_bucati_evenimente` cu `document_tip = 'doc_intrare'`, `document_id = <doc>::text`, `proiect_id` = context, `tip` = cel cerut de șablon, `storno_de_eveniment_id IS NULL`. Unicitatea lui e garantată de indexul unic parțial din §2. La fel pentru `receptie_pv`. Mișcarea cere `NEW.eveniment_id` = id-ul acestui rând. Antetul, la final, trebuie să primească **exact** acest id (verificat de gardă la UPDATE antet).

**Proiecția comparată (r5, punctul 1).** Lista **`C`** = toate coloanele NEGENERATE ale `magazie_bucati`, mai puțin `id`, `uid`, `radacina_id`, `server_ver`, `created_at`, `updated_at`. E o constantă scrisă în migrare (array de nume). Migrarea verifică la precondiție, iar porțile E3 la fiecare intrare, că mulțimea coloanelor reale ale tabelului = `C` ∪ cele 6 excluse ∪ coloanele generate (`serie_canon`, `lungime_cm`). O coloană adăugată sau scoasă ulterior → porți lipsă → intrările E3 refuză până la o migrare revizuită.
- `fn_izo_proiectie_bucata(r jsonb) RETURNS jsonb` = `(SELECT jsonb_object_agg(k, r -> k) FROM unnest(C) k)`. Fiecare cheie din `C` apare **exact o dată**, cu `null` JSON când valoarea lipsește sau e NULL. Aceeași funcție se aplică pe ambele părți, deci mulțimile de chei sunt identice prin construcție.
- **`radacina_id`** e exclus din ambele părți și verificat separat: `NEW.radacina_id = NEW.id` (rădăcină, ca la import).
- **Câmpurile „interzise”** (`parinte_id`, `dezambiguare`, `tronson_id`, `executie_teava_id`, `bend_no`, `capat_marcaj`, `lungime_calculata` etc. — tot ce E3 nu completează) sunt în `C` cu valoarea **explicită** din bucata așteptată (NULL sau `false`), deci o valoare nenulă pe oricare dintre ele face comparația să pice.
- **Fără valori implicite în comparație:** INSERT-ul confirmării listează **toate** coloanele din `C` plus `id`, `uid`, `radacina_id`, `server_ver` (lista e generată din aceeași constantă, la migrare). Nicio coloană din `C` nu primește DEFAULT, deci `NEW` (BEFORE INSERT) are exact valorile scrise.

**Bucata așteptată.** `fn_izo_doc_bucata_asteptata(p_doc, p_nr_crt) RETURNS jsonb` (owner `postgres`, INVOKER, STABLE; EXECUTE `izo_receptie_writer`) construiește din antet + rând un obiect cu **toate** cheile din `C` (inclusiv cele NULL). Sursele sunt precizate în r5:
- `tip_material_id` = `fn_izo_tip_material('teava' | 'curba')` (E2a, DEFINER), după șablon; `tip_cod` = `'teava'` / `'curba'`, care trebuie să bată cu `fn_izo_tip_cod(tip_material_id)`;
- `locatie_tip` = `'depozit'`; `locatie_site_id` = `fn_izo_site_proiect(proiect_id)` (E2a, DEFINER), deci site-ul proiectului, egal cu al depozitului (verificat la §4 pasul 6);
- `serie` = textul **brut** din rând (nu forma canonică); restul câmpurilor fizice = rândul, cu regulile din §7.2.

E **singura sursă** pentru amândouă:
- confirmarea inserează bucata din acest jsonb (`jsonb_populate_record` pe toate coloanele din `C`), plus `id` / `radacina_id` / `uid` / `server_ver`;
- garda verifică `fn_izo_proiectie_bucata(to_jsonb(NEW)) = fn_izo_proiectie_bucata(fn_izo_doc_bucata_asteptata(doc, NEW.nr_crt_aviz))` (egalitate jsonb exactă, aceleași chei pe ambele părți) și, separat, `NEW.radacina_id = NEW.id`.

Ce acceptă ramura, pe operație (orice altceva → 42501):

| Tabel / operație | `op = confirma` (doc `draft`) | `op = pv` (doc `confirmat`, PV nepus) | `op = anulare` (doc `confirmat`) | `op = anulare_draft` (doc `draft`) |
|---|---|---|---|---|
| INSERT eveniment | `tip` = `intrare_aviz` (țeavă) / `intrare_lista_ambalare` (curbe); `document_tip = 'doc_intrare'`, `document_id` = doc, `proiect_id` = context; `storno_de_eveniment_id` NULL; niciun eveniment de intrare pe doc deja | `tip = 'receptie_pv'`, aceleași legături; niciun `receptie_pv` pe doc deja | `tip = 'storno'`, `proiect_id` = context, `document_*` = doc, `storno_de_eveniment_id` = evenimentul `receptie_pv` al doc (întâi, dacă există) apoi cel de intrare | — |
| INSERT bucată | proiecția `C` a lui `NEW` = proiecția `C` a `fn_izo_doc_bucata_asteptata(doc, NEW.nr_crt_aviz)` (seria brută inclusă); rândul are `decizie` ∈ {primit, primit_neconform} și `bucata_id` NULL; separat `NEW.radacina_id = NEW.id` | — | — | — |
| UPDATE bucată | — | doar `stare` `sosit` → `receptionat` (+ `server_ver`, `updated_at`; restul identic, fără coloanele generate); `proiect_id` = context; bucata = `rand.bucata_id` al unui rând `primit` al doc | doar `stare` (+ `server_ver`, `updated_at`): `receptionat` → `sosit` (storno PV) sau `sosit` / `carantina` → `anulata` (storno intrare); `proiect_id` = context; bucata = `rand.bucata_id` al doc | — |
| INSERT mișcare | `proiect_id` = context; `rol = 'nascut'`; `eveniment_id` = evenimentul de intrare al doc (identificat ca mai sus); bucata are `aviz_intrare_id` = doc; `stare_dupa` = starea bucății; `in_loc` = depozitul | `proiect_id` = context; `rol = 'stare'`; `eveniment_id` = `receptie_pv` al doc; `sosit` → `receptionat`; bucata din mulțimea PV | `proiect_id` = context; `rol = 'stare'` (`receptionat` → `sosit`) pe storno-ul PV; `rol = 'anulat'` (→ `anulata`) pe storno-ul intrării; bucata = `rand.bucata_id` al doc | — |
| UPDATE `randuri` | doar `bucata_id` NULL → id, unde bucata are `aviz_intrare_id` = doc și `nr_crt_aviz` = `nr_crt` | — | — | — |
| UPDATE antet | `draft` → `confirmat`; doar coloanele de confirmare + `hash_confirmat` + `avertismente`; `eveniment_intrare_id` = **exact** evenimentul de intrare al doc; `versiune` = context + 1 | doar coloanele PV (NULL → valoare); `eveniment_pv_id` = **exact** `receptie_pv`-ul doc; `versiune` = context + 1 | `confirmat` → `anulat`; doar coloanele de anulare; `eveniment_storno_*` = **exact** storno-urile scrise; `versiune` = context + 1 | `draft` → `anulat`; doar `stare`, `anulat_de_rol`, `anulat_la`, `anulat_motiv`, `versiune` (= context + 1); `eveniment_storno_*` rămân NULL |

`anulare_draft` nu scrie nimic în registru: nu există evenimente fictive. Rândurile, scanurile și antetul (în afara coloanelor de mai sus) rămân neatinse.

Ramura se aplică și trigger-ului de imutabilitate al tabelelor de document (§5). Ramura e cod nou (`fn_izo_garda_receptie`, `fn_izo_doc_bucata_asteptata`) + înlocuirea celor 3 predicate în `fn_izo_garda_bucati` / `fn_izo_garda_fapte` (CREATE OR REPLACE). Definițiile E2a sunt salvate pentru revenire (§9.3).

### 3.3 Autentificarea: încredere declarată în gateway, nu o „dovadă” (neschimbat)

- `session_user = 'authenticator'` (PostgREST), `auth.role() = 'authenticated'`, `auth.uid() IS NOT NULL`.
- **r4:** rolurile noi n-au drept pe schema `auth`, iar gate-ul 0e refuză textul `request.jwt` în corpurile expuse. De aceea intrările citesc identitatea doar prin helpere `postgres` DEFINER: `fn_izo_uid()` (E2a, `auth.uid()`) și `fn_izo_jwt_rol()` (nou, `auth.role()`), ambele neexpuse (EXECUTE doar rolurilor noi + `izo_registru_writer` pentru `fn_izo_uid`, ca în E2a).
- Se presupune că JWT-ul e validat de gateway-ul Supabase. Funcțiile nu pretind că dovedesc apelul direct.
- SQL static, obiecte calificate, `search_path` fix; porțile pe wrapper-e = apărare în profunzime.

### 3.4 Autorizarea: `fn_izo_doc_autorizare_lock(p_doc)` — blochează exact rândurile din care decurge dreptul (r3, punctul 1)

Helper nou, **owner `postgres`**, DEFINER, neexpus (EXECUTE doar `izo_doc_editor` și `izo_receptie_writer`). Motivul: blocările de rând (`FOR SHARE`) cer drept de UPDATE pe tabel. Nu dăm UPDATE pe `profiles` / `user_module_access` / `izo_atribuiri` rolurilor noi.

Ordinea (aceeași la toate intrările; condiția de drept e în `WHERE`-ul interogării cu lock, deci în READ COMMITTED o modificare comisă între timp e reevaluată — EvalPlanQual — și rândul nu mai e întors):
1. **`profiles`**, rândul `id = auth.uid()` `FOR SHARE`. Dacă `is_owner` → autorizat (pașii 2–3 nu mai sunt necesari).
2. **`user_module_access`**, rândul **exact** (`profile_id = auth.uid()`, `module = 'magazie'`) — unic prin `user_module_access_profile_id_module_key` — cu `access_level` ∈ {`editor`, `admin`} în `WHERE`, `FOR SHARE`. Fără rând → refuz.
3. **`izo_atribuiri`**, rândul activ (`proiect_id`, `profile_id`, `rol = 'gestionar'`, `depozit_id`) — unic prin `ux_izo_atribuiri_activ` — cu `activ AND current_date BETWEEN valabil_de AND coalesce(valabil_pana, current_date)` în `WHERE`, `FOR SHARE`. Fără rând → refuz.

Efectul, pe toate căile de revocare (verificate pe catalogul live, 21.10):
- `UPDATE user_module_access SET access_level = 'viewer'` sau `DELETE` (politicile owner din UI) → așteaptă confirmarea în curs; după commit-ul ei intră în vigoare. Dacă revocarea a comis prima, `FOR SHARE` nu mai întoarce rândul → refuz.
- `DELETE app_modules` (cascadă pe `user_module_access`), `DELETE profiles` (cascadă) → aceleași rânduri, același efect.
- `UPDATE profiles SET is_owner = false` → așteaptă (`FOR SHARE` pe profil).
- revocarea atribuirii (`activ = false`, doar `postgres`) → așteaptă.

Fără ciclu: revocările ating un singur rând (sau profil → cascadă, aceeași ordine ca la noi: profil → acces). Nu țin nimic din ce cerem noi după aceea.

`is_owner`: pe live, `profiles_update_own` permite UPDATE pe propriul rând, iar trigger-ele `prevent_role_escalation` / `fn_profiles_campuri_owner_only` blochează auto-promovarea. Definițiile lor intră în amprenta porților E3 (slăbire → „porți lipsă” → intrările refuză). Test: auto-promovarea e refuzată.

### 3.5 Matricea privilegii ↔ operații (r3, punctul 7)

**Tabelele de document** (RLS activ pe toate trei; `anon` / `service_role`: nimic):

| Rol | `izo_documente_intrare` | `_randuri` | `_scanuri` |
|---|---|---|---|
| `authenticated` | SELECT (RLS: `fn_izo_citire(proiect_id)`) | SELECT (RLS prin document) | SELECT (RLS prin document) |
| `izo_doc_editor` | SELECT; INSERT și UPDATE doar pe coloanele editabile + `versiune` (fără `stare`, confirmare, PV, anulare, `hash_confirmat`, `avertismente`) | SELECT, INSERT (fără `bucata_id`), DELETE | SELECT, INSERT, DELETE |
| `izo_receptie_writer` | SELECT; UPDATE doar pe `stare`, `versiune`, coloanele de confirmare / PV / anulare, `hash_confirmat`, `avertismente` | SELECT; UPDATE (`bucata_id`) | SELECT |

Politicile RLS ale rolurilor noi (nume `izo_doc_*`, deci intră în amprentă): editorul scrie doar rânduri cu `stare = 'draft'`; writer-ul are `USING / WITH CHECK (proiect_id IS NOT NULL)`, iar restricția reală e în gardă + trigger-ul de imutabilitate. DELETE-urile editorului trec și ele prin trigger: doar în `draft`, doar sub lock-ul documentului.

**Tabelele E2a**, pentru `izo_receptie_writer` (GRANT + politici permisive noi; politicile RESTRICTIVE E2a pentru `anon` / `authenticated` rămân neschimbate):

| Tabel | GRANT | Politica nouă |
|---|---|---|
| `magazie_bucati` | SELECT; INSERT pe coloanele nașterii (lista din §7.2); UPDATE (`stare`, `server_ver`, `updated_at`) — necesar și pentru `FOR UPDATE` la PV / anulare | `magbuc_izo_receptie_sel` (SELECT, `provenienta = 'beneficiar'`), `magbuc_izo_receptie_ins` / `_upd` (`provenienta = 'beneficiar' AND fn_izo_nivel(proiect_id) <> 'off'`) |
| `magazie_bucati_evenimente` | SELECT, INSERT | `izo_ev_receptie_sel`, `izo_ev_receptie_ins` (`fn_izo_nivel(proiect_id) <> 'off'`) |
| `magazie_bucati_miscari` | SELECT, INSERT | `izo_mis_receptie_sel`, `izo_mis_receptie_ins` (idem) |
| `izo_proiect_config`, `izo_importuri`, `izo_atribuiri` | nimic (nivelul se citește prin `fn_izo_nivel`, DEFINER; atribuirea prin helper-ul de lock) | — |

`izo_doc_editor` pe tabelele E2a: SELECT pe `magazie_bucati` (politica `magbuc_izo_doceditor_sel`, `provenienta = 'beneficiar' AND tip_cod IS NOT NULL`), pentru avertismentele de coliziune din `verifica`. Nimic altceva.

**Secvențe:** `izo_receptie_writer` — USAGE pe `magazie_bucati_id_seq` (id-ul bucății e luat explicit, ca la import, pentru `radacina_id = id`) și pe `izo_server_ver_seq`. Coloanele `id` ale evenimentelor, mișcărilor și tabelelor de document sunt IDENTITY: nu cer drept pe secvență.

**Helpere** (EXECUTE explicit; REVOKE de la PUBLIC / `anon` / `authenticated` / `service_role` pe toate cele interne):

| Funcție | Owner / mod | EXECUTE |
|---|---|---|
| `fn_izo_doc_salveaza`, `fn_izo_doc_verifica` | `izo_doc_editor`, DEFINER | `authenticated` (semnătura exactă) |
| `fn_izo_doc_confirma`, `fn_izo_doc_pv` | `izo_receptie_writer`, DEFINER | `authenticated` (semnătura exactă) |
| `fn_izo_doc_anuleaza` | `izo_receptie_writer`, DEFINER, cere `session_user = 'postgres'` | `postgres` |
| `fn_izo_receptie_marcheaza` | `izo_receptie_writer`, INVOKER (scrie doar `izo.receptie_ctx`) | doar owner-ul |
| `fn_izo_garda_receptie` | `postgres`, INVOKER | doar `izo_receptie_writer`. Gărzile o cheamă numai într-un `IF current_user = 'izo_receptie_writer'` explicit (§3.2), deci ceilalți nu ajung la ea |
| `fn_izo_doc_bucata_asteptata` | `postgres`, INVOKER, STABLE | `izo_receptie_writer` |
| `fn_izo_proiectie_bucata` | `postgres`, INVOKER, IMMUTABLE (doar lista constantă `C`) | `izo_receptie_writer` |
| `fn_izo_jwt_rol` | `postgres`, DEFINER, STABLE | `izo_doc_editor`, `izo_receptie_writer` |
| `fn_izo_doc_autorizare_lock` | `postgres`, DEFINER | `izo_doc_editor`, `izo_receptie_writer` |
| `fn_izo_doc_hash` (calculul canonic, §6) | `postgres`, INVOKER, STABLE | `izo_doc_editor`, `izo_receptie_writer` |
| `fn_izo_scan_exista(cale)` (citește `storage.objects`) | `postgres`, DEFINER, STABLE | `izo_doc_editor`, `izo_receptie_writer` |
| `fn_izo_scan_poate_sterge(name)` (politica Storage, §6.1) | `postgres`, DEFINER | `authenticated` (e evaluată ca apelantul politicii; întoarce false dacă apelantul nu e autorizat pe document) |
| E2a: `fn_izo_blocheaza_locuri`, `fn_izo_blocheaza_tabele`, `fn_izo_lock_partajat`, `fn_izo_lock_proiect`, `fn_izo_porti_definitii` | neschimbate | + `izo_receptie_writer` |
| E2a: `fn_izo_nivel`, `fn_izo_porti_lipsa`, `fn_izo_uid` | neschimbate | + `izo_receptie_writer`, + `izo_doc_editor` |
| E2a: `fn_izo_garda_scriitor`, `fn_izo_tip_cod` | neschimbate | + `izo_receptie_writer` (azi le au `anon` / `authenticated` / `service_role` / `izo_registru_writer`) |
| E2a: `fn_izo_loc_valid(bigint, integer, bigint)`, `fn_izo_site_proiect(bigint)`, `fn_izo_tip_material(text)` (r5, punctul 2) | neschimbate (DEFINER, owner `postgres`; azi EXECUTE doar `izo_registru_writer`) | + `izo_receptie_writer`; `fn_izo_loc_valid` și + `izo_doc_editor` (verificarea la creare) |

**Apelurile tranzitive, pe rol (r4, punctul 4).** Ce cheamă efectiv fiecare rol, inclusiv prin gărzi și politici, care rulează ca apelantul (INVOKER). Funcțiile DEFINER își fac apelurile interne ca owner-ul lor, deci nu cer drepturi de la apelant. Fiecare celulă se verifică pe catalog cu `has_function_privilege` / `has_table_privilege` / `has_column_privilege`, plus prin rularea reală a fiecărei operații pe branch (o permisiune lipsă = test roșu, nu descoperire în producție).

| Cine rulează | Ce cheamă (INVOKER, deci are nevoie de drept) |
|---|---|
| `izo_doc_editor` în `salveaza` / `verifica` | `fn_izo_uid`, `fn_izo_jwt_rol`, `fn_izo_doc_autorizare_lock`, `fn_izo_nivel`, `fn_izo_porti_lipsa` (r4: și salvarea, și verificarea refuză cu porți lipsă — fail-closed), `fn_izo_doc_hash`, `fn_izo_scan_exista`; trigger-ul de imutabilitate pe tabelele de document (funcția trigger-ului nu cere EXECUTE la declanșare; ce cheamă ea, da: `fn_izo_garda_receptie` doar pentru writer); politicile `izo_doc_*` |
| `izo_receptie_writer` în `confirma` / `pv` / `anuleaza` | tot ce are editorul + `fn_izo_blocheaza_locuri`, `fn_izo_blocheaza_tabele`, `fn_izo_lock_partajat` / `fn_izo_lock_proiect`, `fn_izo_receptie_marcheaza`, `fn_izo_doc_bucata_asteptata`, `fn_izo_proiectie_bucata`, `fn_izo_loc_valid`, `fn_izo_site_proiect`, `fn_izo_tip_material`; prin `fn_izo_garda_bucati` / `fn_izo_garda_fapte`: `fn_izo_garda_scriitor`, `fn_izo_garda_receptie`, `fn_izo_nivel`, `fn_izo_tip_cod`, `pg_advisory_xact_lock_shared` (fără drept); prin politicile `magbuc_izo_receptie_*` / `izo_ev_receptie_*` / `izo_mis_receptie_*`: `fn_izo_nivel`; FK-urile (verificate de sistem ca owner-ul tabelului, fără drept) |
| `authenticated` prin Storage | `fn_izo_scan_poate_sterge` (politica DELETE), `fn_izo_citire` (politica SELECT, E2a) |
| `anon` / `authenticated` / `service_role` / `izo_registru_writer` prin gărzile E2a | neschimbat față de E2a: `fn_izo_garda_scriitor`, `fn_izo_nivel`, `fn_izo_tip_cod`. Nu ajung la `fn_izo_garda_receptie` (IF explicit) |

**Porțile.** Migrarea E3 înlocuiește `fn_izo_porti_lipsa` și `fn_izo_porti_definitii`; definițiile E2a sunt salvate pentru revenire. Ce se schimbă:
- amprenta include obiectele E3: tabelele de document (RLS / ACL / owner), politicile `izo_doc_*`, `magbuc_izo_receptie_*`, `izo_ev_receptie_*`, `izo_mis_receptie_*`, funcțiile `fn_izo_*` noi, rolurile (membership), cele două trigger-e `profiles`;
- **excepțiile** pentru analiza wrapper-elor / citirilor sunt o listă constantă `c_e3_revizuite` (semnătura exactă → `md5(prosrc | proconfig | owner | proacl | prosecdef)`), ca `c_dinamice_revizuite` din E2a. Doar acele funcții, cu acea definiție, sunt acceptate ca scriitori ai registrului din afara `izo_registru_writer`. Orice altă funcție (sau o modificare a uneia din listă) rămâne refuzată exact ca în E2a.

## 4. Protocolul de lock (ordine UNICĂ, comună tuturor intrărilor E3 și anulării)

1. **Documentul** `FOR UPDATE`. Proiectul și depozitul se iau de pe document; nu există argumente de proiect / depozit.
2. **Autorizarea** (§3.4): `profiles` → `user_module_access` → `izo_atribuiri`, toate `FOR SHARE`, prin `fn_izo_doc_autorizare_lock`. (Anularea, făcută de `postgres`, sare peste acest pas: nu are utilizator.)
3. **`fn_izo_blocheaza_locuri(proiect, [depozit], {})`:** proiectul și depozitul `FOR SHARE`.
4. **`fn_izo_blocheaza_tabele()`** (ACCESS SHARE; TRUNCATE / DDL așteaptă), apoi advisory: **partajat** `(73010, proiect)` la confirmare / PV, **exclusiv** la anulare (ca storno-ul E2a).
5. **Bucățile documentului** `FOR UPDATE`, ordonate după `id` — doar la PV și anulare (confirmarea le creează).
6. **Revalidarea, după toate lock-urile, pe starea comisă** (READ COMMITTED, snapshot nou): documentul (stare, versiune, hash recalculat); autorizarea (rezultatul pasului 2); **`fn_izo_nivel(proiect) <> 'off'`** (r4: `stoc` sau `montaj`; același predicat ca politicile RLS și garda E2a, folosit identic peste tot în E3, deci E3 nu se oprește la trecerea pe `montaj`); **locația (r5):** `fn_izo_loc_valid(proiect, depozit, NULL)` (E2a, DEFINER: depozitul există, e activ și e pe site-ul proiectului — aceeași verificare ca importul), apelată DUPĂ `fn_izo_blocheaza_locuri`, care ține rândurile `FOR SHARE`, deci relația citită nu se poate schimba până la commit. Writer-ul nu primește SELECT pe `logistica_depozite` / `executie_proiecte`; existența obiectelor din manifest (§6.1); **porțile** `cardinality(fn_izo_porti_lipsa()) = 0`.
7. **Toate verificările de business** (§7 / §8 / §9), fără nicio scriere.
8. **Abia aici:** `fn_izo_receptie_marcheaza(op, doc, proiect, depozit, versiune)`; urmează doar blocul DML static.

Ordinea globală: document → profil → acces modul → atribuire → proiect / depozit → tabele → advisory → bucăți. Toate intrările E3 și anularea o respectă. Revocările de drepturi și mutările de loc ating un singur nivel din lanț; storno-ul E2a ia advisory → bucăți (sufix al aceleiași ordini). Deci nu există ciclu.

**Salvarea draftului** (§5) ia doar pașii 1–2; nu atinge advisory-ul și nici registrul.

## 5. Salvarea draftului (`fn_izo_doc_salveaza`) și imutabilitatea

- **Crearea** (`p_doc_id NULL`): autorizarea pe (`proiect_id`, `depozit_id`) din argumente (aceleași lock-uri, §3.4); `stare = draft`, `versiune = 1`. `proiect_id` / `depozit_id` / `sablon` sunt **imutabile** (trigger).
- **Editarea:** documentul `FOR UPDATE` → autorizarea → `stare = 'draft'`, altfel refuz → CAS pe `versiune`, apoi `versiune + 1`. Rândurile se înlocuiesc integral, sub același lock. Scanurile se adaugă sau se scot din manifest doar aici (deci orice schimbare de manifest mărește versiunea și schimbă hash-ul). La adăugarea unui scan: obiectul trebuie să existe deja la calea dată de server (`fn_izo_scan_exista`).
- **Trigger-ul de imutabilitate** (BEFORE UPDATE / DELETE pe antet, rânduri, scanuri):
  - `draft`: scrie `izo_doc_editor` (editarea), sau `izo_receptie_writer` doar în ramurile `confirma` (draft → confirmat) și **`anulare_draft`** (draft → anulat, doar coloanele de anulare fără evenimente; r4, punctul 5); `versiune` crește exact cu 1;
  - `confirmat`: doar ramura `pv` (coloanele PV) și ramura **administrativă** `anulare` (`confirmat` → `anulat`, doar coloanele de anulare), ambele prin `fn_izo_garda_receptie` cu contextul potrivit;
  - `anulat`: nimic;
  - DELETE: doar rânduri / scanuri ale unui `draft`, de către editor; antetul nu se șterge niciodată (un draft abandonat se anulează).

## 6. Hash-ul canonic `e3-doc-v1` (neschimbat față de r2)

`hash = 'e3-doc-v1:' || encode(sha256(convert_to(<json canonic>::text, 'UTF8')), 'hex')`, construit de server (`fn_izo_doc_hash`) cu `jsonb_build_object` (chei sortate de jsonb; NULL explicit ca `null`). Conține:
- `v` = `e3-doc-v1`, `proiect_id`, `depozit_id`, `sablon`, identitatea canonică, toate câmpurile antetului, totalurile;
- **rândurile**, ordonate după `nr_crt`: toate câmpurile care ajung în registru + `decizie` / `motiv`;
- **numericele** canonice: mm întregi; kg / unghi `round(x, 1)::text`;
- **manifestul scanurilor**, ordonat după `cale`: `cale`, `sha256_original`, `sha256_pdf`, `marime`, `mime`.

`versiune` NU intră în hash (hash-ul descrie conținutul; versiunea, momentul). Limitarea de audit, păstrată: `sha256_*` sunt **declarate de client** până la E9.

### 6.1 Storage, bucket-ul `avize`, și cursa cu ștergerea (r3, punctul 5)

Calea obiectului = `<document_id>/<uuid>.pdf`, dată de server; documentul se deduce din cale, nu din manifest.
- **INSERT:** doar în calea unui document `draft` pe care apelantul e autorizat;
- **fără UPDATE** (fără upsert / înlocuire / mutare);
- **DELETE:** politica cheamă `fn_izo_scan_poate_sterge(name)`, care:
  1. ia rândul documentului din cale `FOR SHARE`;
  2. cere apelantul autorizat pe document, `stare = 'draft'` și **calea absentă din manifest** (în orice stare a documentului).
  - Un obiect din manifest nu se poate șterge niciodată. Pentru a-l scoate, editorul îl scoate întâi din manifest prin `salveaza` (`versiune + 1`, hash nou) și abia apoi șterge obiectul rămas orfan.
- **SELECT:** cei cu `fn_izo_citire(proiect)`.

Cursele, pe rândul documentului (ștergerea ține `FOR SHARE` până la commit; salvarea și confirmarea iau `FOR UPDATE`):
- ștergere ↔ confirmare: dacă ștergerea ia rândul întâi, confirmarea așteaptă commit-ul ei, apoi la pasul 6 `fn_izo_scan_exista` vede obiectul lipsă → refuz (iar ștergerea oricum n-ar fi trecut dacă obiectul era în manifest). Dacă confirmarea e prima, ștergerea așteaptă și vede `confirmat` → refuz.
- ștergere ↔ salvare (adăugarea în manifest): serializate la fel; salvarea verifică existența obiectului după lock.
- Presupunere declarată, verificată pe branch cu Storage real: API-ul Storage șterge rândul din `storage.objects` sub RLS și elimină fișierul doar pentru rândurile efectiv șterse. Testul 9 o dovedește (refuzul politicii lasă fișierul intact).

## 7. Confirmarea (`fn_izo_doc_confirma(p_doc_id, p_versiune, p_hash)`) (r3, punctele 3 și 4)

- **După §4, pașii 1–6:**
  - `stare = 'confirmat'` și `hash_confirmat = p_hash` → **idempotent**: întoarce `{document_id, eveniment_id, bucati: [id…] din rânduri, versiune}` fără scrieri;
  - `confirmat` cu alt hash sau `anulat` → refuz;
  - `draft`: `versiune = p_versiune` ȘI `fn_izo_doc_hash(doc)` recalculat sub lock = `p_hash`; altfel 40001 „documentul s-a schimbat, verifică din nou”. Nu există precondiție persistentă de verificare: `verifica` doar arată clientului hash-ul și versiunea pe care le trimite înapoi.
- **Verificările blocante,** recalculate, niciodată luate de la client:
  - totalurile, cu rândurile refuzate incluse, pe **lungimile de document**;
  - motivul obligatoriu la `refuzat_la_receptie` / `primit_neconform`;
  - fiecare valoare fizică în interval (lungime 1–30000 mm, perete, diametru, unghi 0 < u ≤ 90);
  - serie validă, fără dubluri canonice în document;
  - documentul are ≥ 1 rând; obiectele din manifest există (§6.1).
- **Avertismentele** se salvează pe document: format, confuzii, măsurat ↔ document peste toleranțe (`abs(măsurat − document) > 10 mm`, respectiv `> 0,5°`; la prag exact nu există avertisment), scan dublat.

### 7.1 Unicitatea = indexurile E2a, cu aceleași valori ca importul

Definițiile exacte (20261102a, LIVE; intră deja în amprenta porților prin `ux_magbuc_izo_%`):
```sql
ux_magbuc_izo_radacina ON magazie_bucati (serie_canon, dezambiguare) NULLS NOT DISTINCT
  WHERE provenienta = 'beneficiar' AND tip_cod = 'teava' AND parinte_id IS NULL AND stare <> 'anulata'
ux_magbuc_izo_frunza   ON magazie_bucati (serie_canon, dezambiguare, sarja, lungime_cm) NULLS NOT DISTINCT
  WHERE provenienta = 'beneficiar' AND tip_cod = 'teava' AND stare NOT IN ('taiata','anulata')
ux_magbuc_izo_curba    ON magazie_bucati (serie_canon, sarja, unghi_curba, cod_bucata) NULLS NOT DISTINCT
  WHERE provenienta = 'beneficiar' AND tip_cod = 'curba' AND stare <> 'anulata'
```
`serie_canon` e coloană generată (`upper(regexp_replace(serie, '[[:space:]._/-]', '', 'g'))`), deci nu poate fi dată de client.

- **E3 scrie exact ce scrie importul** (`fn_izo_import_sold_initial`): `parinte_id` NULL, `radacina_id = id`, **`dezambiguare` NULL** (importul nu dezambiguizează; a doua rădăcină cu aceeași serie = conflict), `cod_bucata = 'AB'`, `capat_stanga` / `capat_dreapta` = `A` / `B`. Garda (§3.2) impune aceste valori. Cu `NULLS NOT DISTINCT`, două țevi vii cu aceeași `serie_canon` (din import, din alt document sau din același document) nu pot coexista. O bucată `carantina` blochează seria la fel ca una `sosit`. Doar `anulata` o eliberează (prin anularea documentului, §9).
- **Pre-verificarea** (pasul 7, aceeași interogare ca R1 c din import) dă un refuz clar pe rând, iar **indexul e arbitrul final**: două confirmări concurente (advisory-ul e partajat, deci nu se serializează) → inserția celei de-a doua așteaptă commit-ul primei, apoi `unique_violation`. Acesta e prins într-un bloc `EXCEPTION` în jurul DML-ului și re-ridicat ca 23505 „seria X (rândul N) a fost înregistrată între timp de alt document”, deci rollback total.
- **Migrarea E3 verifică la precondiție** `pg_get_indexdef` al celor trei indexuri = textul de mai sus (altfel refuză), iar testele îl compară din nou.

### 7.2 Scrierea (după marcaj), totul sau nimic

1. evenimentul (`intrare_aviz` sau `intrare_lista_ambalare`, `aplicat_de = fn_izo_uid()`), `RETURNING id INTO v_ev`. De aici încolo garda îl identifică prin indexul unic parțial (document, tip; §3.2), nu prin antet;
2. pe fiecare rând `primit` / `primit_neconform`, în ordinea `nr_crt`: `id := nextval('magazie_bucati_id_seq')`; INSERT bucată din `fn_izo_doc_bucata_asteptata(doc, nr_crt)` (aceeași funcție pe care o folosește garda la comparație), cu coloanele nașterii — `id`, `proiect_id`, `tip_material_id`, `tip_cod`, `uid`, `parinte_id`, `radacina_id`, `cod_bucata`, `capat_stanga`, `capat_dreapta`, `serie`, `sarja`, `dimensiune`, `grad_otel`, `standard`, `izolatie`, `producator`, `furnizor`, `lungime_m`, `lungime_originala_m`, `lungime_aviz_mm`, `lungime_masurata_mm`, `lungime_mm`, `perete_mm`, `diametru_mm`, `unghi_curba`, `greutate_kg`, `cantitate`, `um`, `provenienta`, `sursa_receptie`, `nr_document`, `data_receptie`, `stare`, `locatie_tip`, `locatie_site_id`, `depozit_id`, `lot`, `aviz_intrare_id`, `nr_crt_aviz`, `bend_no`, `atribute`, `server_ver`, `observatii` (`lungime_mm` = măsurat ?? document) → mișcarea `nascut` (`in_loc` = depozitul) → `rand.bucata_id`;
3. documentul: `confirmat`, `hash_confirmat = p_hash`, `eveniment_intrare_id = v_ev` (garda cere egalitatea cu evenimentul identificat la pasul 1), `avertismente`, `versiune + 1`.

Mișcările se scriu înaintea antetului: garda nu depinde de FK-ul antetului, deci nu există dependență circulară. La PV e la fel: `receptie_pv` `RETURNING id`, mișcările, apoi `eveniment_pv_id` = acel id.

**Reconcilierea în funcție, înainte de RETURN:** `count(mișcări nascut ale evenimentului)` = `count(rânduri cu bucata_id)` = numărul rândurilor `primit` + `primit_neconform`. Altfel excepție → rollback total.

**Răspunsul:** `{document_id, eveniment_id, bucati: [id…], avertismente: […], versiune, idempotent}`. Nu întoarce date din registru în afara bucăților proprii abia create.

## 8. PV-ul (`fn_izo_doc_pv(p_doc_id, p_versiune, p_pv_nr, p_pv_data)`) (r3, punctul 6)

- **După §4, pașii 1–6** (inclusiv pasul 5: bucățile documentului `FOR UPDATE`, ordonate după `id`):
  - `stare = 'confirmat'` (draft / anulat → refuz);
  - PV deja pus: (`pv_nr_canon`, `pv_data`) identice → **idempotent** (același `eveniment_pv_id`, aceeași `versiune`); diferite → refuz;
  - altfel CAS pe `versiune = p_versiune`.
- **Mulțimea așteptată pornește de la document, nu de la registru:** `R` = TOATE rândurile documentului cu `decizie = 'primit'`. Pentru **fiecare** rând din `R`, fără nicio filtrare prealabilă:
  1. `bucata_id` NOT NULL (altfel: „rândul N n-are bucată — document corupt”);
  2. bucata **există** (citită după `id`, nu după depozit / stare);
  3. **apartenența:** `aviz_intrare_id` = doc, `nr_crt_aviz` = `nr_crt`, `proiect_id` = proiectul documentului, `tip_cod` după șablon;
  4. **starea:** `sosit`;
  5. **locul:** `depozit_id` = depozitul documentului, `tronson_id` NULL.
  - Orice rând care pică vreo verificare → refuz cu lista completă (`nr_crt`, bucata, motivul): „bucăți ieșite / modificate înainte de PV — decizie”. Nu se acceptă „UPDATE ce mai găsesc”.
  - Bucățile `primit_neconform` (carantină) **nu** intră în `R` și rămân `carantina`; rândurile `refuzat_la_receptie` n-au bucată.
- **Zero eligibili** (`R` gol: toate rândurile refuzate și / sau în carantină): PV-ul **se acceptă**. Se scrie evenimentul `receptie_pv` (documentul are PV-ul lui fizic) cu zero mișcări, iar răspunsul are `bucati_receptionate: 0` + un avertisment „niciun rând primit conform”. Reconcilierea: 0 = 0.
- **Scrierea** (după marcaj): evenimentul `receptie_pv` → `UPDATE … SET stare = 'receptionat' WHERE id = ANY(set) AND stare = 'sosit' RETURNING` → numărul întors = `|R|`, altfel excepție → mișcările `stare` (`sosit` → `receptionat`) din `RETURNING` → documentul (coloanele PV, `eveniment_pv_id`, `versiune + 1`).
- În E3 nu există ieșiri din API înaintea PV-ului.
- **Regula pentru E4, obligatorie (r4, P2 Copilot):** până la o extindere formală a acestui contract, revizuită ca design, orice funcție E4+ care scoate, mută, taie sau montează o bucată **refuză bucățile cu `aviz_intrare_id` NOT NULL al căror document n-are PV** (`eveniment_pv_id IS NULL`). E4 nu poate schimba implicit semantica PV-ului. Regula se scrie în E4_PLAN și are test acolo.

## 9. Anularea și revenirea (r3, punctul 8)

### 9.1 `fn_izo_doc_anuleaza(p_doc_id, p_motiv)` — operație administrativă, doar `postgres`

Owner `izo_receptie_writer`, DEFINER, EXECUTE doar `postgres`, cere `session_user = 'postgres'` (N3, ca storno-ul E2a). `p_motiv` e obligatoriu (≥ 3 caractere).

- **Lock-uri:** §4 pașii 1, 3, 4 (advisory **exclusiv**), 5 (toate bucățile documentului — din `rand.bucata_id`, inclusiv carantina — `FOR UPDATE`, ordonate după `id`).
- **`draft`** → `anulat` (r4, punctul 5): tranziție administrativă separată, cu contextul **`anulare_draft`**. Se scrie doar antetul: `stare`, `anulat_de_rol = 'postgres'`, `anulat_la`, `anulat_motiv`, `versiune + 1`. Nu se scrie niciun eveniment și nicio mișcare. Nu cere advisory, nici bucăți (n-are), și merge la orice nivel, inclusiv `off`, fiindcă nu atinge registrul. Scanurile rămân (sunt în manifest, deci protejate).
- **`anulat`** → refuz (deja anulat).
- **Nivelul (r4, punctul 2; explicația corectată în r5):** anularea unui document **confirmat** cere `fn_izo_nivel(proiect) <> 'off'`, ca orice scriere în registru. Prin API-ul E2a cazul „confirmat pe `off`” **nu e accesibil**: `fn_izo_seteaza_nivel` refuză `stoc → off` după **orice** eveniment în registru, iar confirmarea scrie mereu un eveniment de intrare, chiar cu zero bucăți. Verificarea rămâne doar defensivă (fail-closed, mesaj explicit), nu e un flux normal.
- **`confirmat`**: refuz dacă vreo bucată a documentului are **vreo mișcare în afară de** `nascut` pe evenimentul de intrare al documentului și `stare` pe `receptie_pv`-ul lui (montaj, tăiere, mutare, bon, corecție, ieșire etc.): „stornează întâi lanțul, explicit”, cu lista. Ca la storno-ul importului: nicio inversare automată a operațiilor ulterioare.
- **Ordinea inversării** (totul într-o tranzacție, după marcajul `anulare`):
  1. dacă există PV: evenimentul `storno` cu `storno_de_eveniment_id = eveniment_pv_id` → bucățile `receptionat` → `sosit` (UPDATE + mișcările `stare`, `receptionat` → `sosit`); numărul = cel al mișcărilor PV-ului;
  2. evenimentul `storno` cu `storno_de_eveniment_id = eveniment_intrare_id` → toate bucățile documentului → `anulata` (UPDATE + mișcările `anulat`); numărul = cel al mișcărilor `nascut`;
  3. documentul: `confirmat` → `anulat` (coloanele de anulare, cele două `eveniment_storno_*`, `versiune + 1`). Rândurile, scanurile și `rand.bucata_id` rămân neatinse (audit).
- **Efect:** seriile se eliberează în indexurile de unicitate (`stare <> 'anulata'`), iar identitatea documentului se eliberează în `ux_izo_doc_identitate` (`stare <> 'anulat'`, r4, punctul 1). Documentul corect se poate introduce din nou ca document nou, cu `inlocuieste_document_id` = cel anulat. Evenimentele originale rămân (registrul e doar-adaug).

### 9.2 Trigger-ul de imutabilitate — ramurile administrative

Două tranziții administrative, fiecare doar sub contextul ei, scris doar de `fn_izo_doc_anuleaza`:
- `confirmat` → `anulat`, contextul `anulare`: coloanele de anulare + cele două `eveniment_storno_*` (exact storno-urile scrise) + `stare` + `versiune`;
- `draft` → `anulat`, contextul `anulare_draft`: coloanele de anulare + `stare` + `versiune`, iar `eveniment_storno_*` rămân NULL (CHECK-ul din §2 o impune).

`anulat` e final.

### 9.3 Revenirea migrației E3 (rulează ÎNAINTEA oricărei reveniri E2a)

- **Refuză dacă există ORICE fapt E3:** vreun rând în tabelele de document (inclusiv `draft` / `anulat`), vreun eveniment cu `document_tip = 'doc_intrare'` sau cu `tip` ∈ {`intrare_lista_ambalare`, `receptie_pv`}, vreo bucată cu `aviz_intrare_id` NOT NULL.
  - Motivul: registrul e doar-adaug. Storno-ul nu șterge evenimentele, deci CHECK-ul E2a al tipurilor nu se poate reface peste ele, iar ștergerea lor ar pierde auditul.
  - Odată ce E3 are fapte, drumul e **înainte** (migrare corectivă revizuită), nu revenirea. Asta se scrie în fișierul de revenire și în handoff.
- **Fără fapte:** scoate trigger-ele / politicile / funcțiile / tabelele / rolurile E3, FK-ul și indexul nou de pe `magazie_bucati`; reface CHECK-ul tipurilor, `fn_izo_garda_bucati`, `fn_izo_garda_fapte`, `fn_izo_porti_lipsa`, `fn_izo_porti_definitii` din definițiile E2a salvate; recalculează COMMENT-ul amprentei și verifică egalitatea cu amprenta E2a dinainte de E3 (`53f214ae…` pe PG17).
- Revenirea E2a după E3 cere întâi revenirea E3 (amprenta n-ar mai bate). Se documentează și se testează.

## 10. Testele (negative întâi; PG16 harness + PG17 branch + PostgREST / Storage reale, cu ACL-ul de producție)

1. **Autentificarea / autorizarea**, pe toate cele 4 intrări, inclusiv retry: `anon`, `service_role`, `authenticated` fără modul / cu `viewer`; atribuire expirată / viitoare / revocată / alt depozit / alt proiect; auto-promovarea `is_owner` / `role` refuzată; owner-ul real trece.
2. **Curse cu barieră** (T1 oprit după lock-urile de la pasul 2 printr-un advisory de test ținut de harness, T2 în paralel, `pg_locks` confirmă așteptarea):
   - **revocarea modulului:** (a) T1 ține `user_module_access` `FOR SHARE` → T2 `DELETE` / `UPDATE access_level = 'viewer'` așteaptă → T1 comite → T2 comite; (b) T2 revocă întâi (necomis) → T1 așteaptă la pasul 2 → T2 comite → T1 refuză, zero efecte; la fel pentru `DELETE profiles`, `UPDATE profiles SET is_owner = false` și revocarea atribuirii;
   - confirmare ↔ confirmare (același document); **două documente cu aceeași serie de țeavă** (și aceeași curbă), confirmate concurent → exact unul trece, celălalt 23505 cu mesajul clar, zero bucăți / evenimente;
   - confirmare ↔ editarea draftului; confirmare ↔ mutarea depozitului pe alt site; confirmare ↔ stoc → off; confirmare ↔ storno pe proiect;
   - PV ↔ PV; PV ↔ anulare; confirmare ↔ anulare;
   - după așteptare: revalidare și refuz, fără scrieri.
3. **Integritatea / hash-ul:** `verifica` → modifică antet / rând / decizie / manifest → `confirma` cu hash-ul / versiunea vechi → 40001, zero efecte; `verifica` → `confirma` cu aceleași valori → trece; hash / versiune NULL → refuz; mutarea proiectului / depozitului unui draft → refuz; orice UPDATE / DELETE după confirmare, în afara ramurilor PV / anulare → refuz.
4. **Atomicitatea:** eșec injectat după bucata N / după eveniment / după mișcare → documentul rămâne draft, zero bucăți / evenimente / mișcări.
5. **Garda, pe context:** cu marcaj valid pentru documentul A, `izo_receptie_writer` încearcă: bucată cu `aviz_intrare_id` = B; bucată pe alt `nr_crt` / rând refuzat / rând cu bucată deja; altă stare decât cea a deciziei; `dezambiguare` ≠ NULL; eveniment pe alt document / alt tip; al doilea eveniment de intrare; mișcare pe alt eveniment; UPDATE de stare pe o bucată din alt document; `rand.bucata_id` spre o bucată străină; context cu alt `txid` / `op` / versiune → toate refuzate. Un helper care scrie înainte de marcaj → refuzat. Contextul `pv` nu poate insera bucăți; contextul `confirma` nu poate face UPDATE pe bucăți.
6. **PV:** pe draft / anulat; PV diferit; retry identic; o bucată din `R` mutată (prin `postgres`) pe alt depozit / în alt proiect / în altă stare / anulată → refuz cu rândul respectiv (inclusiv cazul în care bucata ar fi fost exclusă de un filtru pe depozit); `rand.bucata_id` NULL pe un rând `primit` → refuz; carantina rămâne carantină; **zero eligibili** → PV acceptat, 0 bucăți, un singur `receptie_pv`.
7. **Scanurile / Storage:** UPDATE / upsert / mutare refuzate; DELETE pe un obiect din manifest refuzat în draft și după confirmare (fișierul rămâne); scos din manifest → `versiune + 1` → DELETE trece → confirmarea cu versiunea veche refuză; cursa DELETE ↔ confirmare în ambele ordini (cu barieră); obiect lipsă la confirmare → refuz.
8. **Privilegiile:** DML direct al `authenticated` / `service_role` pe documente, registru, evenimente, mișcări, scanuri → refuz; `izo_doc_editor` nu poate scrie `stare` / confirmare / `bucata_id` și nu poate scrie în registru; `izo_receptie_writer` nu poate scrie alte coloane / tabele (config, importuri, atribuiri) nici cu marcaj; matricea din §3.5 verificată pe catalog (`has_column_privilege` / `has_table_privilege` / `has_function_privilege`), pe fiecare celulă.
9. **Porțile:** un wrapper static / dinamic, un overload, ACL / config modificate pe o funcție din `c_e3_revizuite`, o politică `izo_doc_*` slăbită, un trigger `profiles` modificat → porțile lipsesc → intrările refuză.
10. **Toleranțele** exact la prag (10 mm / 0,5° → fără avertisment) și peste prag (avertisment).
11. **Anularea:** draft → anulat (zero evenimente, zero mișcări; și pe `off`); confirmat fără PV; confirmat cu PV (ordinea: storno PV, apoi intrare; stările finale `anulata`); confirmat pe `off` → refuz explicit; peste o mișcare ulterioară → refuz, zero efecte; dublă anulare → refuz; apelată din `authenticated` → refuz. **Reintroducerea (r4, punctul 1):** după anulare, același furnizor / număr / dată se creează din nou (cu și fără `inlocuieste_document_id`) și se confirmă, iar seria trece; două documente vii cu aceeași identitate → 23505; `inlocuieste_document_id` spre un document neanulat / cu altă identitate / pe alt proiect → refuz.
12. **Revenirea:** E3 fără date → scoate tot, reface gărzile / porțile E2a, amprenta = cea dinainte; cu orice fapt E3 (draft, confirmat sau anulat) → refuz; revenirea E2a după E3 cere întâi revenirea E3.
13. **Integrarea gărzii E2a (r4, punctul 3):** suita E2a (`izometrie_e2a.test.sql`, 180 de verificări) rulează **nemodificată** după aplicarea E3 și trece. În plus, pentru `izo_receptie_writer` cu context valid: starea `rezervata` / `consumata`, DELETE, un rând de registru pe un proiect `off`, un `tip_cod` care nu bate cu `tip_material_id` → refuzate de verificările comune (dovada că nu există ocolire prin RETURN timpuriu). `miscare.proiect_id` ≠ context → refuz. Pentru fiecare coloană din `fn_izo_doc_bucata_asteptata` (serie, șarjă, fiecare lungime, perete, diametru, unghi, greutate, lot, `tip_material_id`, `atribute`…), o bucată inserată cu acea singură coloană modificată → refuz.
14. **Coloanele generate și seria brută (P2; reconciliat în r5):** `NEW.serie` trebuie să fie **identică** cu textul brut din rând. O altă formă cu aceeași canonizare (de ex. `254-CA 09771` față de `254CA09771`) → **refuz**: egalitatea e pe proiecția `C`, care conține seria brută. Forma canonică se calculează explicit doar pentru pre-verificarea unicității (§7.1), niciodată din `NEW.serie_canon`, care în BEFORE nu e calculată. La UPDATE pe stare, `serie_canon` / `lungime_cm` necalculate în `NEW` nu dau fals „rând modificat”, fiind în afara lui `C`.
19. **Proiecția (r5, punctul 1):** bucata corectă (exact cea din `fn_izo_doc_bucata_asteptata`) → trece. Pentru FIECARE coloană din `C`, inclusiv cele „interzise” (`tronson_id`, `dezambiguare`, `parinte_id`, `executie_teava_id`…), o inserare cu acea singură coloană schimbată (sau nenulă) → refuz. `radacina_id` ≠ `id` → refuz. Migrarea pe o copie cu o coloană nouă în `magazie_bucati` → porți lipsă.
20. **Locația (r5, punctul 2):** depozit inactiv / pe alt site decât proiectul / mutat pe alt site concurent (barieră) → refuz, rulat ca `izo_receptie_writer` real, fără `permission denied`.
15. **Evenimentul exact pe antet (P2):** UPDATE antet cu `eveniment_intrare_id` / `eveniment_pv_id` spre alt eveniment permis (alt document, un storno) → refuz.
16. **Rolurile (P2):** postcondiția din §3.1 pe `pg_roles` / `pg_auth_members`; un `ALTER ROLE … BYPASSRLS` sau un GRANT de membership neașteptat → porțile lipsă.
17. **Migrarea peste un proiect activ (P2):** pe branch, cu un proiect E2a deja în `stoc` (și unul trecut pe `montaj` direct în config, pe branch) și porțile complete → apply E3 → porțile rămân complete (amprenta nouă), o operație E2a (import + storno pe proiectul de test) merge, E3 merge pe ambele niveluri. Apoi orice modificare a unei piese E3 (funcție, gardă, politică, ACL, trigger) → `fn_izo_porti_lipsa()` nevid, iar intrările E3 și activarea E2a refuză.
18. **Apelurile tranzitive (r4, punctul 4):** fiecare operație (salvare, verificare, confirmare țeavă / curbă, PV, anulare draft / confirmat) rulată cap-coadă pe branch, ca rolul real, fără nicio eroare `permission denied`. Plus verificarea pe catalog a fiecărei celule din tabelul de apeluri tranzitive (§3.5).

## 11. Ce rămâne limitare (declarată)

- Hash-urile scanurilor sunt declarate de client până la E9.
- Încrederea în validarea JWT de gateway (Supabase).
- Porțile pe wrapper-e / citiri sunt analiză textuală: apărare în profunzime. Controlul principal rămâne procesul (nicio funcție DEFINER nouă pe prod fără migrare revizuită).
- Comportamentul API-ului Storage la DELETE refuzat de RLS e o presupunere verificată prin test pe branch, nu o garanție a schemei.
- PV-ul cere toate bucățile `primit` încă `sosit`, în depozit; ieșirile anterioare PV-ului vin cu extinderea contractului (E4+). Până atunci E4 refuză bucățile fără PV (§8).
- Anularea unui document confirmat fără bucăți, pe un proiect trecut pe `off`, cere reactivarea proiectului (§9.1).
- După primul fapt E3, revenirea migrației e blocată prin design; corecțiile se fac înainte, cu migrare revizuită.
