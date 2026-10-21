# E3b — corecțiile registrului de țeavă (design r1) — pentru review ÎNAINTE de cod

**r1 (21.10.2026).** Sursa: decizia Razvan 21.10 (varianta A, `claude_context` #1819), `E3_PLAN.md` §7b, lista de lipsuri `C:\Users\Public\livrare\izo_gaps.txt` + verificările ei (`izo_raspuns.md`, `izo_anexa.md`, `izo_critic.txt`). Se construiește peste E3 (`20261103b_izometrie_e3_documente`, design `E3_CONFIRMA_DESIGN.md` r5e) și peste E2a (`20261102a`), cu **același tipar**: rol scriitor separat, contextul operației în gardă, poarta completă sub lock-ul „schemă”, proiecții exacte, registru doar-adaug, motiv obligatoriu.

**Ordinea (neschimbată din E3_PLAN §7b):** design E3b → review Copilot + Jakarinos → migrare + harness → aplicare (chat-ul, după „da”-ul lui Razvan) → abia apoi prima recepție reală pe LOT 2.

**Faptele live (citire read-only, 21.10):**
- E3 **nu e aplicat** pe prod (nu există `izo_documente_intrare` și nici rolurile E3); E3b se aplică după E3, deci ambele sunt încă pe branch;
- proiectul 3 (LOT 2) e la nivelul `stoc`, cu un singur import (`sold-initial-lot2-v1`, `aplicat`), un eveniment `sold_initial` și 3352 de mișcări `nascut`;
- cele 3352 de bucăți: 1884 `receptionat`, 1466 `pe_tronson`, 2 `carantina`, 0 `sosit`;
- atribuirile active: 3 `gestionar`, 2 `inginer_izometrie`, 1 `manager_aprobator`.

## 0. Ce face E3b (și ce nu)

**Face (cele șase corecții din #1819):**
1. **corecția de câmp** pe o bucată din registru: eveniment `corectie` + mișcare `corectat`, cu `inainte` / `dupa` și motiv; o face doar responsabilul (§5.1);
2. **pierdut / găsit:** bucata lipsă fizic (`pierduta`), recuperarea ei și bucata găsită care nu e în registru (§5.3);
3. **carantina după recepție:** intrarea și ieșirea; gestionarul propune, responsabilul aprobă, cu referință NCR (§5.2);
4. **storno-ul parțial pe un import:** o listă de bucăți (§5.5);
5. **corecția doar pe PV** (număr / dată), fără storno pe intrare (§5.4);
6. **istoricul ciornei:** câte o copie a conținutului la fiecare salvare (cine, când, diferența), în afara hash-ului (§5.7).

**Nu face (rămân pentru etape ulterioare, fiecare cu designul ei):**
- storno-ul în lanț și anularea mutărilor / montajului / tăierii (E4, odată cu mutările);
- auditul pe `executie_tevi` / bonuri și restrângerea `executie_tevi_modify` (fix separat);
- filtrul TEST-IZO, KPI-urile din Stoc trasabil, `ReceptieBucatiModal` (UI separat; schița din §8 atinge doar ce cere E3b);
- verificările de plauzibilitate (lungime / șarjă față de certificat);
- certificatele 3.1 și reconcilierea ERP ↔ Excel, numite „E3b” în E3_PLAN §0 (Q-E3b-15: propun E3c);
- interzicerea scrierilor „de mână” ale unei sesiuni postgres care își ia rolul de writer (limitarea din `izo_critic.txt`, §10).

## 1. Frontiera, pe scurt

**Ce vine din API** (`authenticated`, cu atribuire; toate întorc `jsonb`):

| Intrare | Argumente | Întoarce | Cine | Owner (DEFINER) |
|---|---|---|---|---|
| `fn_izo_cor_propune` | `p_tip text, p_bucata_id bigint, p_detalii jsonb, p_motiv text` | `{corectie_id, versiune, stare: 'propusa', inainte}` | gestionarul depozitului bucății sau responsabilul (§3.4) | `izo_cor_editor` |
| `fn_izo_cor_retrage` | `p_corectie_id bigint, p_versiune bigint, p_motiv text` | `{corectie_id, versiune, stare: 'retrasa'}` | doar propunătorul (sau owner) | `izo_cor_editor` |
| `fn_izo_cor_respinge` | `p_corectie_id bigint, p_versiune bigint, p_motiv text` | `{corectie_id, versiune, stare: 'respinsa'}` | responsabilul, ≠ propunătorul | `izo_cor_editor` |
| `fn_izo_cor_verifica` (doar citire) | `p_corectie_id bigint, p_tip text, p_bucata_id bigint, p_detalii jsonb` (fie id-ul, fie celelalte trei) | `{ok, blocante[], avertismente[], inainte, dupa_efectiv, versiune}` | cine citește proiectul (`fn_izo_citire`) | `izo_cor_editor` |
| `fn_izo_cor_aproba` | `p_corectie_id bigint, p_versiune bigint` | `{corectie_id, eveniment_id, bucata_id, stare_dupa, versiune, idempotent}` | responsabilul, ≠ propunătorul | `izo_corectie_writer` |
| `fn_izo_cor_camp` | `p_bucata_id bigint, p_server_ver bigint, p_dupa jsonb, p_motiv text` | `{corectie_id, eveniment_id, inainte, dupa, server_ver}` | responsabilul | `izo_corectie_writer` |
| `fn_izo_cor_pv` | `p_doc_id bigint, p_versiune bigint, p_pv_nr text, p_pv_data date, p_motiv text` | `{corectie_id, eveniment_id, document_id, versiune}` | responsabilul | `izo_corectie_writer` |
| `fn_izo_doc_salveaza` (E3, **înlocuită**) | neschimbate | ca în E3 + `istoric_versiune` | neschimbat (gestionarul) | `izo_doc_editor` |

`p_tip` la propunere ∈ {`carantina_intrare`, `carantina_iesire`, `pierdut`, `gasit_recuperare`, `gasit_nou`}. `p_detalii` are chei pe listă albă, per tip (§5). `fn_izo_cor_verifica` are **o singură semnătură**, fără overload-uri: o semnătură înseamnă o singură intrare în amprentă și în ACL. Exact unul dintre moduri e nenul, altfel 22023.

**Ce rămâne exclusiv `postgres`** (N3, ca storno-ul E2a):
- `fn_izo_cor_storno_import(p_proiect bigint, p_import_id text, p_bucati bigint[], p_motiv text, p_cerut_de uuid) → {corectie_id, eveniment_id, bucati_anulate}`: owner `izo_corectie_writer`, EXECUTE doar `postgres`, cere `session_user = 'postgres'`; se rulează doar cu „da”-ul lui Razvan (Q-E3b-11).
- `p_cerut_de` = profilul omului care a cerut storno-ul (obligatoriu). Ajunge în `magazie_bucati_evenimente.declarat_de` (coloană E2a existentă, azi NULL), deci auditul are un om, nu doar `aplicat_rol = postgres`.

**Numele storno-ului parțial nu e întâmplător.** Poarta E2a caută wrapper-e cu expresia `fn_izo_(seteaza_nivel|import_sold_initial|import_storno|activeaza_si_importa)`, neancorată la dreapta, în `prosrc`-ul oricărei funcții cu alt owner decât `izo_registru_writer`. Un nume ca `fn_izo_import_storno_partial` ar declanșa ea însăși poarta: în corpul oricărei funcții care îl numește (inclusiv poarta E3b) ar apărea „wrapper nerevizuit”. De aici `fn_izo_cor_storno_import`.
- **Regula de cod:** niciun corp E3b nu numește cele patru funcții E2a, nici măcar în comentarii (`prosrc` include comentariile).
- Testul 13 o dovedește.

## 2. Schema nouă (migrarea `20261104a_izometrie_e3b_corectii`; 20261102a / 20261103b NU se modifică ca fișiere)

### 2.1 `izo_corectii` — „documentul” fiecărei corecții

Fiecare operație E3b (și cele directe) scrie exact un rând. El e legătura dintre om, decizie și registru, exact cum e documentul de intrare în E3.
- `id` (IDENTITY), `proiect_id` (NOT NULL, FK RESTRICT);
- `tip` ∈ {`camp`, `carantina_intrare`, `carantina_iesire`, `pierdut`, `gasit_recuperare`, `gasit_nou`, `pv`, `storno_import`};
- ținta:
  - `bucata_id` (FK RESTRICT): NOT NULL pentru `camp` / `carantina_*` / `pierdut` / `gasit_recuperare`; la `gasit_nou` NULL cât e `propusa` și NOT NULL după aplicare (bucata nouă); NULL la `pv` / `storno_import`;
  - `document_intrare_id` (FK RESTRICT): NOT NULL doar la `pv`; opțional la `gasit_nou` (referință, nu legătură de registru); NULL în rest;
  - `import_id` (text): NOT NULL doar la `storno_import`;
- conținutul:
  - `inainte` (jsonb, NOT NULL): instantaneul calculat de server (§5);
  - `dupa` (jsonb): valorile cerute (la `camp`, `pv`, `gasit_nou`, `carantina_iesire`, `gasit_recuperare`);
  - `ncr_ref` (text 1–80): NOT NULL doar la `carantina_*`;
  - `motiv` (text 3–1000, NOT NULL);
- decizia:
  - `stare` ∈ {`propusa`, `aplicata`, `respinsa`, `retrasa`}, `versiune` (bigint ≥ 1, +1 la fiecare scriere);
  - `propus_de` (uuid NOT NULL; la `storno_import` = `p_cerut_de`), `propus_rol` (`session_user`), `propus_la`;
  - `decis_de` (uuid; NULL la `storno_import`), `decis_rol`, `decis_la`, `motiv_decizie`;
  - `eveniment_id` (FK UNIQUE → `magazie_bucati_evenimente`);
- CHECK-uri de coerență: forma pe tip (lista de mai sus), `aplicata` ⇔ (`eveniment_id`, `decis_la`) NOT NULL; `respinsa` / `retrasa` ⇒ `motiv_decizie` NOT NULL și `eveniment_id` NULL; `propusa` ⇒ toate coloanele `decis_*` NULL;
- **`ux_izo_cor_deschisa` UNIQUE (`bucata_id`) WHERE `stare = 'propusa' AND bucata_id IS NOT NULL`**: cel mult o corecție deschisă pe bucată. Corecțiile directe trec și ele prin `propusa` (în aceeași tranzacție), deci indexul serializează și corecția directă cu o propunere deschisă (§4).

### 2.2 `izo_corectii_bucati` — lista storno-ului parțial

`corectie_id` (FK), `bucata_id` (FK), PK (`corectie_id`, `bucata_id`), index pe `bucata_id`. Se scrie doar pentru `tip = 'storno_import'`, cât corecția e `propusa`; după aceea e imutabilă.

### 2.3 `izo_documente_istoric` — istoricul ciornei

- `id`, `document_id` (FK RESTRICT), `versiune` (= versiunea documentului după salvare), UNIQUE (`document_id`, `versiune`);
- `salvat_de` (uuid NOT NULL), `salvat_rol`, `salvat_la`;
- `continut` (jsonb NOT NULL): **exact obiectul canonic din care se calculează hash-ul `e3-doc-v1`** (antet, aviz, listă, totaluri, rânduri ordonate după `nr_crt`, manifestul ordonat după `cale`), construit de `fn_izo_doc_instantaneu(doc)`;
- `hash` (text, `e3-doc-v1:…`): invariant `'e3-doc-v1:' || sha256(continut::text) = fn_izo_doc_hash(doc)` la acea versiune;
- `diff` (jsonb NOT NULL), calculat de `fn_izo_doc_diff(anterior, curent)`:
  - antet: `{cheie: [vechi, nou]}`;
  - rânduri, cheiate pe `nr_crt`: `adaugate`, `sterse`, `modificate: {nr_crt: {camp: [vechi, nou]}}`;
  - scanuri, cheiate pe `cale`: `adaugate`, `scoase`;
- `baza` (boolean): true la prima intrare a documentului (crearea, sau prima salvare după E3b a unei ciorne mai vechi; atunci `diff` = tot conținutul, ca „adăugat”).

### 2.4 Registrul: tipuri noi, motiv, legătura eveniment ↔ corecție

- CHECK-ul `magazie_bucati_evenimente_tip_check` (forma E3, verificată textual la precondiție) primește **`carantina_intrare`, `carantina_iesire`, `storno_partial`**. Restul se refolosesc, fiind rezervate din E2a: `corectie` (câmp + PV), `pierdut`, `gasit`.
- CHECK nou, numit, aditiv: `magbuc_ev_e3b_motiv CHECK (tip NOT IN ('carantina_intrare','carantina_iesire','storno_partial') OR motiv IS NOT NULL)`. CHECK-ul E2a anonim (motiv obligatoriu pentru `corectie` / `pierdut` / `gasit` …) rămâne neatins.
- **`ux_magbuc_ev_corectie`:**
  ```sql
  CREATE UNIQUE INDEX ux_magbuc_ev_corectie ON public.magazie_bucati_evenimente (document_id)
    WHERE document_tip = 'izo_corectie';
  ```
  Exact un eveniment per corecție, cu `document_tip = 'izo_corectie'` și `document_id = <corectie_id>`. `storno_de_eveniment_id` e mereu NULL pe evenimentele E3b (CHECK-ul E2a îl leagă de `tip = 'storno'`). De aceea storno-ul parțial NU e `tip = 'storno'`: UNIQUE-ul lui `storno_de_eveniment_id` ar consuma evenimentul importului, iar storno-ul complet de după n-ar mai avea pe ce să se lege.
- **Filtrul amprentei E2a nu prinde indexul** (`ux_magbuc_izo_% / ux_izo_% / ix_magbuc_ev_%`, lecția r5c), deci intră nominal în ștampila E3b (§3.6).
- `magazie_bucati`, `magazie_bucati_evenimente` și `magazie_bucati_miscari` **nu primesc coloane noi**. Altfel precondiția E3 0e / poarta E3 (mulțimea exactă `C`) ar refuza totul.

**Tip → eveniment / mișcare:**

| `izo_corectii.tip` | `evenimente.tip` | Mișcarea (`rol`, stări) | Propune | Aplică |
|---|---|---|---|---|
| `camp` | `corectie` | `corectat`, stările NULL | — (direct) | responsabilul |
| `carantina_intrare` | `carantina_intrare` | `stare`: X → `carantina` | gestionar / responsabil | responsabil ≠ propunător |
| `carantina_iesire` | `carantina_iesire` | `stare`: `carantina` → Y (§5.2) | idem | idem |
| `pierdut` | `pierdut` | `stare`: X → `pierduta` | idem | idem |
| `gasit_recuperare` | `gasit` | `stare`: `pierduta` → Y, cu `din_loc` / `in_loc` | idem | idem |
| `gasit_nou` | `gasit` | `nascut` (stare `carantina`, Q-E3b-6) | idem | idem |
| `pv` | `corectie` | — (zero mișcări) | — (direct) | responsabilul |
| `storno_import` | `storno_partial` | `anulat`: X → `anulata` | — | `postgres` |

### 2.5 Câmpurile corectabile — constanta `L` (lista revizuită, Q-E3b-10)

`fn_izo_coloane_corectabile(p_tip_cod text) RETURNS text[]`, IMMUTABLE, scrisă în migrare din aceeași sursă ca `C` (generatorul `scripts/izometrie/e3_gen`, extins cu șabloanele E3b):
- **țeavă:** `serie`, `sarja`, `lot`, `lungime_aviz_mm`, `lungime_masurata_mm`, `perete_mm`, `diametru_mm`, `greutate_kg`, `dimensiune`, `grad_otel`, `standard`, `izolatie`;
- **curbă:** `serie`, `sarja`, `lot`, `unghi_curba`, `perete_mm`, `diametru_mm`, `greutate_kg`, `dimensiune`, `grad_otel`, `standard`, `izolatie`;
- **derivatele `D`** (doar țeavă, doar dacă o lungime e în cerere; NU se pot cere direct): `lungime_mm = coalesce(lungime_masurata_mm, lungime_aviz_mm)` (regula E3 Q-E3-5 / importul), `lungime_m = lungime_originala_m = lungime_mm / 1000.0`. Bucățile E3b sunt rădăcini fără tăieri (§5.0), deci invariantul ține;
- **necorectabile, explicit:** tot restul din `C` (identitate, proiect, tip, proveniență, arbore, cod / capete, `dezambiguare`, legătura la document, `atribute`, locul, starea, `executie_teava_id` …). Locul se schimbă doar prin `gasit_recuperare` (§5.3), starea doar prin operațiile ei.
- **Validarea pe valoare** = regulile importului / E3, aplicate pe rezultat: serie și șarjă nevide (≤ 60), perete 3–40, diametru 10–2000, lungime 1–30000 (țeava cere `lungime_mm` NOT NULL după corecție), unghi 0 < u ≤ 90, greutate ≥ 0, izolație ∈ {`neizolata`, `PEHD`, `GRP`} sau NULL. Plus CHECK-urile E2a pe tabel (`magazie_bucati_izo_valori_check`, `_registru_check`), care rămân arbitrul final.

### 2.6 Precondițiile migrării (fail-closed, ca E2a / E3)

- garda de livrare (`gazpet.livrare_migrare` legată de txid) și `current_user = postgres`;
- E3 aplicat, cu porțile complete (`fn_izo_porti_lipsa()` gol), ștampilele `porti=` / `porti_e3=` consistente și amprenta de revenire = COMMENT;
- obiectele E3b absente (roluri, tabele, `fn_izo_cor_%`, indexul, evenimente cu `document_tip = 'izo_corectie'`);
- **md5-ul corpurilor înlocuite** = forma lor din 20261103b: `fn_izo_garda_bucati`, `fn_izo_garda_fapte`, `fn_izo_doc_garda`, `fn_izo_porti_lipsa`, `fn_izo_doc_salveaza`. Sub Q-E3b-1 = A, în plus: `fn_izo_import_storno` (forma 20261102a), `fn_izo_doc_anuleaza`, `fn_izo_garda_receptie`. Definițiile vechi se salvează pentru revenire. Migrarea se generează peste textul FINAL al 20261103b, deci o rundă nouă de review pe E3 = md5-uri regenerate;
- mulțimile de coloane = `C` / `_ev` / `_mis` (neschimbate) și textul CHECK-ului tipurilor = forma E3.

**Postcondițiile:**
- porțile complete;
- lista INSERT-ului din `gasit_nou` = `C` ∪ 4 (verificare textuală `/*C*/`, ca E3 P2);
- `pg_get_indexdef` exact pe `ux_magbuc_ev_corectie` / `ux_izo_cor_deschisa`;
- privilegiile pe coloane ale `izo_corectie_writer` = mulțimile din §3.5.

## 3. Rolurile, garda, privilegiile

### 3.1 Două roluri noi, NOLOGIN NOINHERIT, membru doar `postgres` (SET, fără INHERIT), ca la E2a / E3

| Rol | Deține (owner, DEFINER) | Scrie |
|---|---|---|
| `izo_cor_editor` | `fn_izo_cor_propune`, `_retrage`, `_respinge`, `_verifica` | doar `izo_corectii` (propunere / decizie negativă); nimic în registru |
| `izo_corectie_writer` | `fn_izo_cor_aproba`, `_camp`, `_pv`, `_storno_import`, `fn_izo_cor_marcheaza` | registrul (doar în contextul operației), `izo_corectii` (aplicarea), `izo_corectii_bucati`, coloanele PV ale documentului |

`izo_doc_editor` (E3) primește în plus doar INSERT pe `izo_documente_istoric`. `izo_registru_writer` și `izo_receptie_writer` nu primesc nimic nou. Excepție condiționată, doar sub Q-E3b-1 = A: EXECUTE pe helper-ul `fn_izo_lant_blocant` (§6).

**Postcondiția pe roluri** = cea din E3 §3.1, pe ambele roluri:
- `NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`;
- `postgres` membru (SET TRUE, INHERIT FALSE), rândul ADMIN automat al creatorului nesuperuser acceptat, nimic altceva;
- niciun rol API nu le poate prelua.

Migrarea și revenirea se rulează pe branch-ul PG17 cu `postgres` nesuperuser.

### 3.2 Garda: contextul operației, al treilea termen în `v_aut` (același tipar ca E3 §3.2)

**Contextul E3b.** GUC-ul `izo.corectie_ctx` = `<txid>|<op>|<corectie_id>|<proiect_id>|<versiunea corecției la intrare>`, cu `op` = `izo_corectii.tip`. Diferența față de E3: **nu există argument liber**. Tot ce așteaptă garda (valorile noi, ținta, NCR-ul, lista de bucăți) se citește din rândul corecției, blocat `FOR UPDATE` de intrare. Contextul îl scrie DOAR `fn_izo_cor_marcheaza` (owner `izo_corectie_writer`, INVOKER, EXECUTE doar owner-ul), chemată după toate validările (§4 pasul 10). Fiecare intrare E3b refuză la început dacă `izo.receptie_ctx` sau `izo.corectie_ctx` nu e gol, ori dacă `izo.registru_tx` = txid-ul curent.

**Integrarea în E2a / E3, fără RETURN timpuriu.** `fn_izo_garda_bucati` și `fn_izo_garda_fapte` (forma 20261103b, md5 verificat la precondiție) se înlocuiesc cu o singură modificare: al treilea termen al predicatului.
```
v_aut := public.fn_izo_garda_scriitor();                                     -- E2a
IF v_aut IS NOT TRUE AND current_user = 'izo_receptie_writer' THEN
  v_aut := public.fn_izo_garda_receptie(TG_TABLE_NAME, TG_OP, <old>, <new>);   -- E3, neschimbat
END IF;
IF v_aut IS NOT TRUE AND current_user = 'izo_corectie_writer' THEN
  v_aut := public.fn_izo_garda_corectie(TG_TABLE_NAME, TG_OP, <old>, <new>);   -- E3b: true sau RAISE 42501
END IF;
```
- Restul funcțiilor rămâne exact E3 / E2a, pentru toți scriitorii: lock-ul partajat pe proiect + READ COMMITTED, refuzul `rezervata` / `consumata`, DELETE refuzat, `off` refuzat, `tip_cod` = `fn_izo_tip_cod(tip_material_id)`.
- `fn_izo_doc_garda` (trigger-ul documentelor E3) primește o ramură nouă, înaintea refuzului final: `IF current_user = 'izo_corectie_writer' THEN PERFORM fn_izo_garda_corectie(…)`. Ramurile `izo_receptie_writer` / `izo_doc_editor` rămân neschimbate.
- **Trigger-e noi, ENABLE ALWAYS:**
  - `trg_izo_cor_garda` pe `izo_corectii` și `izo_corectii_bucati` (funcția `fn_izo_cor_garda`, regulile din §3.3);
  - `trg_izo_doc_ist_garda` pe `izo_documente_istoric` (§5.7);
  - plus TRUNCATE refuzat pe toate trei.

### 3.3 `fn_izo_garda_corectie` (owner `postgres`, INVOKER, EXECUTE doar `izo_corectie_writer`)

**Verificările comune, pe orice rând:**
1. contextul e bine format, cu `txid` = `txid_current()`;
2. `izo.receptie_ctx` e gol (o singură operație E3 / E3b per tranzacție);
3. rândul corecției există, cu `proiect_id`, `versiune` și `tip` = cele din context, și `stare = 'propusa'`. Excepție: UPDATE-ul final al corecției, care o trece în `aplicata`.

Orice combinație absentă din tabel → RAISE 42501.

| Tabel / operație | Ce acceptă |
|---|---|
| INSERT eveniment | proiecția pe `fn_izo_coloane_ev()` = `fn_izo_cor_eveniment_asteptat(corectie)`: `tip` după tabelul din §2.4, `proiect_id`, `document_tip = 'izo_corectie'`, `document_id = corectie_id::text`, `import_id` (doar `storno_import`), `storno_de_eveniment_id` NULL, `motiv = corectie.motiv`, `declarat_de = corectie.propus_de`, `aplicat_de = fn_izo_uid()` (NULL în sesiunea postgres), `aplicat_rol = session_user`, `ora_tableta` / `dispozitiv_id` NULL; niciun eveniment al corecției deja (indexul `ux_magbuc_ev_corectie` e arbitrul) |
| INSERT mișcare | `eveniment_id` = evenimentul corecției (identificat prin index, nu prin FK-ul corecției, scris la final); bucata ∈ ținta (`bucata_id` sau `izo_corectii_bucati`); nicio altă mișcare a aceluiași eveniment pe aceeași bucată; proiecția pe `fn_izo_coloane_mis()` = `fn_izo_cor_miscare_asteptata(corectie, bucata)`, calculată din rândul CURENT al bucății (mișcarea se scrie înaintea UPDATE-ului). La `gasit_nou`, mișcarea `nascut` după INSERT-ul bucății |
| UPDATE bucată | există deja mișcarea corecției pe bucată; proiecția pe `C` a lui `NEW` = proiecția pe `C` a `fn_izo_cor_bucata_dupa(corectie, OLD)`; `NEW.server_ver` NOT NULL și ≠ `OLD.server_ver`. Coloanele generate nu se citesc din `NEW` (E3 §3.2); seria canonică se calculează explicit (`fn_izo_canon_serie`) |
| INSERT bucată | doar `op = gasit_nou`: proiecția pe `C` = `fn_izo_cor_bucata_noua(corectie)` (ca `fn_izo_doc_bucata_asteptata` din E3), `radacina_id = id`, `uid` și `server_ver` NOT NULL |
| UPDATE `izo_documente_intrare` | doar `op = pv`: `OLD.stare = 'confirmat'` și `OLD.eveniment_pv_id` NOT NULL; (`OLD.pv_nr_canon`, `OLD.pv_data`, `OLD.versiune`) = `corectie.inainte`; NEW = `corectie.dupa` pe `pv_nr` / `pv_nr_canon` / `pv_data`; `versiune = OLD + 1`; orice altă coloană (fără cele generate) identică; evenimentul corecției deja scris |
| UPDATE `izo_corectii` | `propusa` → `aplicata`; doar `stare`, `versiune` (context + 1), `decis_de = fn_izo_uid()`, `decis_rol = session_user`, `decis_la`, `eveniment_id` = **exact** evenimentul corecției și, doar la `gasit_nou`, `bucata_id` NULL → bucata născută de acest eveniment |

**`fn_izo_cor_bucata_dupa(corectie, OLD)`** = `to_jsonb(jsonb_populate_record(OLD, delta))`. Rândul vechi se suprapune cu delta, normalizată prin tipul `magazie_bucati` (aceleași formate numerice ca la proiecția E3). Delta, pe operație:
- `camp`: `dupa` ∪ derivatele `D`, recalculate;
- `carantina_intrare`: `{stare: 'carantina'}`;
- `carantina_iesire`: `{stare: Y}`, cu Y din `fn_izo_cor_tinta_iesire(bucata)` (§5.2), egal cu `corectie.dupa.stare`;
- `pierdut`: `{stare: 'pierduta'}`;
- `gasit_recuperare`: `{stare: Y, depozit_id: dest}`; la tronson, doar `{stare: Y}`;
- `storno_import`: `{stare: 'anulata'}`.

Ce nu e în delta trebuie să rămână identic: proiecția acoperă tot `C`, deci și coloanele „interzise”.

**Scrierile dinaintea marcajului** (rândul `izo_corectii` la corecțiile directe și lista `izo_corectii_bucati`) nu trec prin context. Le verifică `fn_izo_cor_garda` după `current_user`:
- `izo_cor_editor`: INSERT doar `propusa`, `versiune = 1`, `propus_de = fn_izo_uid()`, `inainte` = **recalculat de trigger** (`fn_izo_cor_inainte(tip, bucata, …)`), `decis_*` / `eveniment_id` NULL; UPDATE doar `propusa` → `respinsa` / `retrasa`, pe coloanele deciziei, `versiune + 1`;
- `izo_corectie_writer`: INSERT doar pentru `tip` ∈ {`camp`, `pv`, `storno_import`}, aceleași reguli de formă; INSERT în `izo_corectii_bucati` doar pe o corecție `storno_import` `propusa`; UPDATE doar prin ramura de context de mai sus;
- oricine altcineva, DELETE, UPDATE după `aplicata` / `respinsa` / `retrasa` → 42501.

### 3.4 Autorizarea: `fn_izo_cor_autorizare_lock(p_proiect bigint, p_rol text, p_depozit integer)`

Owner `postgres`, DEFINER, neexpusă (EXECUTE doar `izo_cor_editor`, `izo_corectie_writer`); aceeași tehnică ca `fn_izo_doc_autorizare_lock` din E3 §3.4: condiția de drept stă în `WHERE`-ul interogării cu `FOR SHARE`, deci reevaluare EPQ.
1. `profiles` (`id = auth.uid()`) `FOR SHARE`; `is_owner` → true;
2. `user_module_access` (`magazie`, `editor` / `admin`) `FOR SHARE` (Q-E3b-12);
3. `izo_atribuiri` active și valabile azi, `FOR SHARE`:
   - `p_rol = 'responsabil'` → `rol IN ('manager_aprobator', 'inlocuitor_aprobator')` pe proiect, `depozit_id` NULL (Q-E3b-2). Toate rândurile potrivite se blochează: revocarea unuia, cât altul rămâne activ, nu schimbă dreptul;
   - `p_rol = 'gestionar'` → rândul exact (`proiect`, `profil`, `gestionar`, `p_depozit`), ca în E3.

**Patru ochi (Q-E3b-3):** la `aproba` / `respinge`, `fn_izo_uid() IS DISTINCT FROM corectie.propus_de`, inclusiv pentru owner. La `retrage`: `fn_izo_uid() = propus_de` sau owner.

**Cine propune, pe bucată:**
- în depozit: gestionarul acelui depozit (`depozit_id` al bucății) sau responsabilul;
- pe tronson (1466 de bucăți LOT 2): gestionarul depozitului de origine (`atribute.depozit_origine_id`), dacă există, sau responsabilul (Q-E3b-9);
- `gasit_nou`: gestionarul depozitului-destinație sau responsabilul.

Revocările (modul, atribuire, `is_owner`) se comportă exact ca în E3 §3.4: așteaptă operația în zbor sau o refuză după commit.

**`p_cerut_de` la storno-ul parțial:**
- helper separat, `fn_izo_cor_cerut_de_valid(p_proiect bigint, p_profil uuid) RETURNS boolean` (owner `postgres`, DEFINER, EXECUTE doar `izo_corectie_writer`);
- aceiași pași 1 și 3 (profilul și atribuirea de responsabil), `FOR SHARE`, dar pe uid-ul dat, nu pe `auth.uid()`;
- îl cheamă doar `fn_izo_cor_storno_import`, după verificarea `session_user = 'postgres'`. Helper-ul cu `auth.uid()` nu primește niciodată un uid din argumente.

### 3.5 Matricea privilegii ↔ operații

**Tabelele noi** (RLS activ; `anon` / `service_role`: nimic; `authenticated`: doar SELECT):

| Rol | `izo_corectii` | `izo_corectii_bucati` | `izo_documente_istoric` |
|---|---|---|---|
| `authenticated` | SELECT (RLS `fn_izo_citire(proiect_id)`) | SELECT (prin corecție) | SELECT (prin document) |
| `izo_cor_editor` | SELECT; INSERT (coloanele propunerii); UPDATE (`stare`, `versiune`, `decis_de`, `decis_rol`, `decis_la`, `motiv_decizie`) | SELECT | — |
| `izo_corectie_writer` | SELECT; INSERT (coloanele corecțiilor directe); UPDATE (`stare`, `versiune`, `decis_de`, `decis_rol`, `decis_la`, `eveniment_id`, `bucata_id`) | SELECT, INSERT | — |
| `izo_doc_editor` | — | — | SELECT, INSERT (toate coloanele, fără `id`) |

**Tabelele E2a / E3**, pentru `izo_corectie_writer` (GRANT + politici permisive noi `*_corectie_*`; cele RESTRICTIVE E2a pentru clienți rămân):

| Tabel | GRANT | Politica nouă |
|---|---|---|
| `magazie_bucati` | SELECT; **INSERT pe `C` ∪ {`id`, `uid`, `radacina_id`, `server_ver`}** (`gasit_nou`, aceeași constantă ca E3); **UPDATE pe `L_teava` ∪ `L_curba` ∪ `D` ∪ {`stare`, `depozit_id`, `server_ver`, `updated_at`}** (UPDATE e necesar și pentru `FOR UPDATE`) | `magbuc_izo_corectie_sel` (`provenienta = 'beneficiar'`), `_ins` / `_upd` (`… AND coalesce(fn_izo_nivel(proiect_id), 'off') IN ('stoc','montaj')`) |
| `magazie_bucati_evenimente`, `_miscari` | SELECT, INSERT | `izo_ev_corectie_sel/_ins`, `izo_mis_corectie_sel/_ins` (nivelul, ca mai sus) |
| `izo_documente_intrare` | SELECT; UPDATE (`pv_nr`, `pv_nr_canon`, `pv_data`, `versiune`, `updated_at`) | `izo_doc_corectie_sel`, `izo_doc_corectie_upd` (`proiect_id IS NOT NULL`; restricția reală e în gardă) |
| `izo_importuri` | SELECT (doar citire: starea importului e stabilă sub advisory-ul exclusiv, §4) | `izo_imp_corectie_sel` |
| `izo_proiect_config`, `izo_atribuiri` | nimic (nivelul prin `fn_izo_nivel`, atribuirea prin helper-ul de lock) | — |

`izo_cor_editor` pe tabelele E2a / E3: SELECT pe `magazie_bucati`, evenimente, mișcări (politici `*_coreditor_sel`) și pe `izo_documente_intrare` (referința de la `gasit_nou`). E nevoie de ele pentru instantaneul `inainte`, ținta ieșirii din carantină și coliziunile din `verifica`. Nimic altceva.

**Secvențe:** `izo_corectie_writer` are USAGE pe `magazie_bucati_id_seq` (`gasit_nou`, id-ul explicit pentru `radacina_id = id`) și pe `izo_server_ver_seq`.

**Helpere** (REVOKE de la PUBLIC / `anon` / `authenticated` / `service_role` pe toate cele interne):

| Funcție | Owner / mod | EXECUTE |
|---|---|---|
| intrările din §1 | rolul din §1, DEFINER | `authenticated` (semnătura exactă); `fn_izo_cor_storno_import`: doar `postgres` |
| `fn_izo_cor_marcheaza` | `izo_corectie_writer`, INVOKER | doar owner-ul |
| `fn_izo_garda_corectie`, `fn_izo_cor_eveniment_asteptat`, `fn_izo_cor_miscare_asteptata`, `fn_izo_cor_bucata_dupa`, `fn_izo_cor_bucata_noua` | `postgres`, INVOKER, STABLE | `izo_corectie_writer` |
| `fn_izo_cor_autorizare_lock` | `postgres`, DEFINER | `izo_cor_editor`, `izo_corectie_writer` |
| `fn_izo_cor_cerut_de_valid` | `postgres`, DEFINER | `izo_corectie_writer` |
| `fn_izo_cor_api_verifica` (lock schemă + identitate + contexte goale + poarta completă) | `postgres`, INVOKER | `izo_cor_editor`, `izo_corectie_writer` |
| `fn_izo_cor_inainte`, `fn_izo_cor_tinta_iesire`, `fn_izo_cor_valideaza` (blocantele), `fn_izo_coloane_corectabile` | `postgres`, INVOKER, STABLE / IMMUTABLE | `izo_cor_editor`, `izo_corectie_writer` |
| `fn_izo_doc_instantaneu`, `fn_izo_doc_diff` | `postgres`, INVOKER, STABLE / IMMUTABLE | `izo_doc_editor` |
| `fn_izo_lant_blocant` (doar Q-E3b-1 = A, §6) | `postgres`, DEFINER, STABLE | `izo_registru_writer`, `izo_receptie_writer`, `izo_corectie_writer` |
| E3: `fn_izo_doc_api_verifica`, `fn_izo_proiectie`, `fn_izo_coloane_c/_ev/_mis`, `fn_izo_canon_serie`, `fn_izo_doc_hash` | neschimbate | + rolurile E3b care le cheamă |
| E2a: `fn_izo_nivel`, `fn_izo_uid`, `fn_izo_porti_lipsa`, `fn_izo_loc_valid`, `fn_izo_citire`, `fn_izo_site_proiect`, `fn_izo_tip_material`, `fn_izo_tip_cod`, `fn_izo_garda_scriitor`, `fn_izo_blocheaza_locuri`, `fn_izo_blocheaza_tabele`, `fn_izo_lock_partajat`, `fn_izo_lock_proiect` | neschimbate | + `izo_corectie_writer` (cele de citire și + `izo_cor_editor`) |

**Apelurile tranzitive**, pe rol, se tabelează ca în E3 §3.5 și se verifică pe catalog (`has_*_privilege`) plus prin rularea fiecărei operații cap-coadă ca rolul real (testul 15). Prin gărzi, `izo_corectie_writer` cheamă: `fn_izo_garda_scriitor`, `fn_izo_garda_corectie`, `fn_izo_nivel`, `fn_izo_tip_cod`, `fn_izo_proiectie`, `fn_izo_coloane_*`, `fn_izo_cor_*_asteptat*`, `fn_izo_canon_serie`.

### 3.6 Porțile

- **Ștampila nouă `porti_e3b`** (COMMENT pe `fn_izo_porti_e3b_definitii`) inventariază:
  - indexurile `ux_magbuc_ev_corectie`, `ux_izo_cor_deschisa`, `izo_documente_istoric_document_id_versiune_key` + cele trei de unicitate E2a;
  - owner / ACL / RLS pe cele trei tabele noi, plus **privilegiile pe coloane** pe ele și pe `magazie_bucati`, evenimente, mișcări, `izo_documente_intrare`, `izo_importuri`;
  - constrângerile tabelelor noi + `magbuc_ev_e3b_motiv`;
  - toate politicile tabelelor noi + cele numite `*_corectie_*` / `*_coreditor_*` pe tabelele E2a / E3;
  - trigger-ele tabelelor noi + `tgenabled`;
  - rolurile `izo_cor_editor` / `izo_corectie_writer` + membership (direct și invers).
- **`fn_izo_porti_e3b_lipsa()`** verifică:
  - ștampila;
  - atributele / membrii rolurilor (ca E3);
  - trigger-ele ENABLE ALWAYS și RLS activ;
  - **mulțimile exacte de coloane:** UPDATE-ul writer-ului pe `magazie_bucati` = `L_teava ∪ L_curba ∪ D ∪ {stare, depozit_id, server_ver, updated_at}`, INSERT-ul = `C ∪ {id, uid, radacina_id, server_ver}`, fără DELETE;
  - `izo_cor_editor` fără nicio scriere în registru;
  - niciun rol E3b cu INSERT / UPDATE pe `izo_proiect_config` / `izo_importuri` / `izo_atribuiri`;
  - API-ul fără DML pe tabelele noi;
  - `anon` / `service_role` fără EXECUTE pe `fn_izo_cor_%`, `authenticated` fără EXECUTE pe helperele interne.
- **`fn_izo_porti_lipsa`** (forma E3, md5 la precondiție) se înlocuiește cu o singură linie în plus la final: `v := v || public.fn_izo_porti_e3b_lipsa();`. Astfel activarea / importul E2a, intrările E3 și intrările E3b refuză toate la orice lipsă E3b.
- **Recalculate la finalul migrării, după validare:**
  - `porti=` (E2a; acoperă automat toate funcțiile `fn_izo_*`, deci și pe cele E3b și cele înlocuite);
  - `porti_e3=` (se schimbă: privilegii pe coloane și politici noi pe tabelele pe care le inventariază);
  - `porti_e3b=`;
  - amprenta de revenire E2a, cu valoarea de dinainte păstrată în comentariu (`inainte_20261104a=…`), ca la E3.
- **Închiderea citirilor:** toate funcțiile E3b sunt `fn_izo_*`, deci în afara corpurilor scanate și în amprenta E2a (corp, owner, ACL, config). Singura DEFINER care citește registrul e `fn_izo_lant_blocant` (sub A), tot `fn_izo_*`, neexpusă. Nu apar view-uri.

## 4. Protocolul de lock (ordine UNICĂ, extinsă din E3 §13.2)

**Ordinea globală:** schemă (partajat) → **document de intrare** → **corecție** → profil → acces modul → atribuire → proiect / depozit → tabele → advisory proiect → **import** → bucăți (după `id`).

E3 folosește aceeași ordine fără pașii „corecție” și „import”. E2a (storno-ul complet) folosește sufixul tabele → advisory exclusiv → import → bucăți. Revocările ating un singur nivel. Deci nu există ciclu.

| Pas | `propune` / `retrage` / `respinge` | `aproba` (stări, găsit) | `camp` | `pv` | `storno_import` |
|---|---|---|---|---|---|
| 0. schemă `pg_advisory_xact_lock_shared(hashtext('gazpet.livrare_migrare'))` + poarta completă, instrucțiune separată | da | da | da | da | da |
| 1. document de intrare | — | `FOR SHARE`, dacă bucata are `aviz_intrare_id` (coloană imutabilă, citită fără lock) | — | `FOR UPDATE` | — |
| 2. corecția | nouă (`ux_izo_cor_deschisa` e arbitrul) / `FOR UPDATE` | `FOR UPDATE` | nouă | nouă | nouă |
| 3. autorizarea (§3.4) | gestionar / responsabil | responsabil, ≠ propunătorul | responsabil | responsabil | `p_cerut_de`: `fn_izo_cor_cerut_de_valid` (profilul + atribuirea `FOR SHARE`, owner / responsabil pe proiect) |
| 4. `fn_izo_blocheaza_locuri` | — | doar `gasit_*`: proiectul + depozitul-destinație `FOR SHARE`, apoi `fn_izo_loc_valid` | — | — | — |
| 5. `fn_izo_blocheaza_tabele` | — | da | da | da | da (prin `fn_izo_lock_proiect`) |
| 6. advisory `(73010, proiect)` | — | partajat | partajat | partajat | **exclusiv** (ca storno-ul E2a) |
| 7. import | — | — | — | — | citit (`stare = 'aplicat'`), stabil sub advisory-ul exclusiv: doar `fn_izo_import_storno` îl schimbă și ia același exclusiv |
| 8. bucăți `FOR UPDATE` | — (citire fără lock; aprobarea revalidează) | bucata | bucata | — | lista, după `id` |
| 9. revalidarea pe starea comisă, apoi verificările de business, fără scrieri | — | §5 | §5 | §5 | §5 |
| 10. `fn_izo_cor_marcheaza`, apoi doar DML static | — | da | da | da | da |

**De ce nu apare ciclu, pe cazurile E3 ↔ E3b:**
- PV-ul E3 ține documentul `FOR UPDATE` → … → bucățile. Aprobarea E3b pe o bucată a aceluiași document așteaptă la pasul 1 (`FOR SHARE`), înainte de orice alt lock.
- Anularea E3 ține documentul `FOR UPDATE`, apoi vrea advisory-ul exclusiv. O aprobare E3b deja trecută de pasul 1 ține advisory-ul partajat și ajunge la bucată înaintea anulării (care blochează bucățile abia după advisory). Anularea așteaptă commit-ul și vede faptul E3b (§6).
- Storno-ul complet / parțial (exclusiv) ↔ orice aprobare (partajat): serializare simplă pe advisory.
- Corecția directă ↔ o propunere deschisă pe aceeași bucată: INSERT-ul în `ux_izo_cor_deschisa` așteaptă tranzacția care aprobă / retrage propunerea; după commit-ul ei, corecția directă continuă și revalidează bucata la pasul 8.
- Unicitatea seriei (corecția seriei ↔ confirmarea E3 / importul suplimentar): indexul e arbitrul. A doua tranzacție primește `unique_violation`, prins și re-ridicat ca 23505 clar, cu rollback total.

**Revalidarea la pasul 9, mereu:**
- `coalesce(fn_izo_nivel(p), 'off') IN ('stoc','montaj')`;
- corecția încă `propusa` și cu `versiune = p_versiune` (CAS);
- bucata eligibilă (§5.0), cu starea și locul = `corectie.inainte` (la aprobare), respectiv `server_ver = p_server_ver` (la `camp`);
- regula PV (§5.0, Q-E3b-4).

Toate rulează sub READ COMMITTED (cerut de helperele E2a).

## 5. Operațiile

### 5.0 Eligibilitatea comună (orice operație pe o bucată existentă)

- `provenienta = 'beneficiar'`, `tip_cod` ∈ {`teava`, `curba`}, `proiect_id` = proiectul corecției;
- **rădăcină fără copii:** `parinte_id` NULL, `radacina_id = id`, nicio bucată cu `parinte_id = id`. Orice tăiere (E4) scoate bucata din E3b;
- **regula PV (Q-E3b-4 = A):** o bucată cu `aviz_intrare_id` NOT NULL al cărei document n-are PV (`eveniment_pv_id IS NULL`) acceptă doar `camp`. Operațiile de stare (carantină, pierdut, găsit) se refuză: „pune întâi PV-ul (sau anulează documentul)”. E aliniat cu E3 §8 („nicio ieșire înaintea PV-ului”) și cu regula pentru E4. `camp` nu atinge niciuna dintre verificările PV-ului (apartenență, stare, depozit, tronson).

### 5.1 Corecția de câmp — `fn_izo_cor_camp(p_bucata_id, p_server_ver, p_dupa, p_motiv)`

**Validări** (după pașii 0–8; toate blocante, recalculate):
- stările admise: `sosit`, `receptionat`, `carantina`, `pe_tronson`. `pierduta` → „recuperează întâi”; `anulata` → refuz;
- `p_dupa`: obiect nevid, chei ⊆ `fn_izo_coloane_corectabile(tip_cod)`; fiecare valoare validă (§2.5) și **diferită** de cea curentă (altfel „nimic de corectat”, fără scriere);
- derivatele se calculează pe server; o cheie din `D` în `p_dupa` → 22023;
- `server_ver = p_server_ver` (altfel 40001 „bucata s-a schimbat, reîncarcă”);
- **unicitatea**, dacă `serie` / `sarja` / o lungime / `unghi_curba` intră în corecție: pre-verificarea cu aceleași interogări ca importul (R1 c pentru rădăcină; frunza pe (`serie_canon`, `dezambiguare`, `sarja`, `lungime_cm`); curba), cu seria canonică calculată explicit și bucata însăși exclusă. Indexul rămâne arbitrul final.

**Scrierea** (totul sau nimic):
1. corecția (`tip = 'camp'`, `inainte` = proiecția rândului curent pe K, `dupa` = K → valorile noi, unde K = cheile cerute ∪ derivatele schimbate). Se scrie înaintea marcajului; o verifică `fn_izo_cor_garda`;
2. marcajul;
3. evenimentul `corectie`;
4. mișcarea `corectat` (`inainte` / `dupa` = cele de pe corecție, normalizate; `lungime_mm` = noua `lungime_mm`, dacă lungimea s-a schimbat, altfel NULL; stările și locurile NULL);
5. UPDATE-ul bucății (K + `server_ver` + `updated_at`);
6. corecția → `aplicata`.

**Răspunsul:** `{corectie_id, eveniment_id, inainte, dupa, server_ver}`.

**Nu atinge** documentul de intrare: rândul rămâne cum a fost confirmat (hash-ul E3 neschimbat). Diferența document ↔ bucată e vizibilă în audit (§8).

### 5.2 Carantina — propunere (gestionar) + aprobare (responsabil)

**Intrarea** (`p_tip = 'carantina_intrare'`, `p_detalii = {ncr_ref}`):
- X ∈ {`sosit`, `receptionat`}, cu `locatie_tip = 'depozit'`. O bucată de pe tronson nu intră în carantină prin E3b (demontajul / returul sunt E4);
- `ncr_ref` obligatoriu (1–80);
- `inainte = {stare: X, loc: {tip: 'depozit', depozit_id}}`.

**Ieșirea** (`p_tip = 'carantina_iesire'`, `p_detalii = {ncr_ref, stare?}`). Bucata e în `carantina`, iar ținta Y = `fn_izo_cor_tinta_iesire(bucata)`, singura sursă, folosită identic de `propune`, `verifica`, `aproba` și gardă (Q-E3b-5 = A):
1. **episodul de carantină:** ultima mișcare cu `stare_dupa = 'carantina'` și (`rol = 'nascut'` sau `stare_inainte` ∉ {`carantina`, `pierduta`}). Recuperarea unei bucăți pierdute din carantină nu deschide un episod nou;
2. dacă episodul a început cu o intrare E3b (`rol = 'stare'`) → Y = `stare_inainte` a ei;
3. dacă bucata s-a născut în carantină:
   - din document E3 (`primit_neconform`): Y = `receptionat` dacă documentul are PV, altfel refuz (regula PV);
   - din import (cele 2 țevi LOT 2) sau din `gasit_nou`: Y = `p_detalii.stare` ∈ {`sosit`, `receptionat`}, **obligatoriu**, ales de propunător și revalidat la aprobare;
- `ncr_ref` obligatoriu (referința deciziei / a închiderii NCR; poate fi același număr).

**Aprobarea** (`fn_izo_cor_aproba`, după pașii 0–8): starea și locul = `inainte` (altfel 40001 „bucata s-a schimbat de la propunere — propune din nou”), Y recalculat = `corectie.dupa.stare` → marcaj → evenimentul (`carantina_intrare` / `_iesire`, motivul de pe corecție) → mișcarea `stare` (X → `carantina` / `carantina` → Y) → UPDATE `stare` → corecția `aplicata`.

**Respingerea / retragerea:** doar rândul corecției (`motiv_decizie` obligatoriu), nimic în registru.

### 5.3 Pierdut / găsit — același flux de propunere + aprobare (Q-E3b-7)

**`pierdut`** (`p_detalii = {cauza}`, cauza ∈ {`lipsa_la_receptie`, `disparuta`}, păstrată în `inainte`):
- X ∈ {`sosit`, `receptionat`, `carantina`, `pe_tronson`} → `pierduta`; locul nu se schimbă (ultimul cunoscut);
- seria **rămâne ocupată** în indexurile de unicitate (`stare <> 'anulata'`). O piesă pierdută nu poate fi „înlocuită” tacit de una nouă cu aceeași serie, iar la recuperare nu există conflict;
- „n-a existat niciodată” pe o bucată din import se rezolvă cu storno-ul parțial (§5.5), nu cu `pierdut`.

**`gasit_recuperare`** (`p_detalii = {depozit_id?}`):
- bucata e `pierduta`; Y = `stare_inainte` a ultimei mișcări cu `stare_dupa = 'pierduta'`;
- locul:
  - dacă locul de dinainte era un depozit: destinația = acel depozit sau alt depozit activ de pe site-ul proiectului (`fn_izo_loc_valid`, după pasul 4);
  - dacă era un tronson: doar același tronson (fără `depozit_id`);
- mișcarea `stare` cu `din_loc` = locul curent și `in_loc` = destinația (pot fi egale).

**`gasit_nou`** — o bucată care nu e în registru (`p_bucata_id` NULL; `p_detalii = {tip: 'teava'|'curba', depozit_id, document_intrare_id?, serie, sarja, …}`, cheile = `L(tip)` + `depozit_id` + `document_intrare_id`):
- câmpurile obligatorii ca la import: serie, șarjă, perete, lungime la țeavă, unghi la curbă; destinația = depozit activ pe site-ul proiectului;
- `document_intrare_id`, dacă e dat, e doar o **referință** pe corecție: confirmat, același proiect și accesibil (altfel refuz generic, ca la înlocuirea din E3 r5e). Pe bucată, `aviz_intrare_id` / `nr_crt_aviz` rămân NULL. Rândurile documentului sunt imutabile, iar anularea documentului nu o atinge (e născută de evenimentul ei);
- la aprobare: unicitatea (pre-verificare + indexul arbitru, EXCEPTION → 23505 clar) → marcaj → evenimentul `gasit` → `id := nextval(...)` → INSERT-ul bucății din `fn_izo_cor_bucata_noua(corectie)` (lista de coloane = `C` ∪ 4, generată din aceeași constantă ca E3; postcondiție textuală `/*C*/` ca E3 P2) → mișcarea `nascut` (`in_loc` = depozitul, `lungime_mm`) → corecția `aplicata` cu `bucata_id`;
- **starea: `carantina`** (Q-E3b-6 = A): fără aviz / certificat, nu e disponibilă până la o ieșire din carantină aprobată (§5.2, Y explicit);
- `atribute = {sursa: 'e3b', corectie_id, document_ref?}`, `sursa_receptie = 'gasit'`. Celelalte coloane din `C`: valoarea explicită din bucata așteptată.

### 5.4 Corecția PV-ului — `fn_izo_cor_pv(p_doc_id, p_versiune, p_pv_nr, p_pv_data, p_motiv)`

- **Validări** (după pașii 0–8): documentul e `confirmat`, cu PV pus; CAS pe `versiune`; numărul are 1–80 de caractere, fără `|`, iar canonizarea e cea din E3 (`upper` + spații normalizate); (`pv_nr_canon`, `pv_data`) noi ≠ cele curente (altfel „nimic de corectat”).
- **Scrierea:** corecția (`tip = 'pv'`, `inainte = {pv_nr, pv_nr_canon, pv_data, versiune}`, `dupa = {pv_nr, pv_nr_canon, pv_data}`) → marcaj → evenimentul `corectie` (`document_tip = 'izo_corectie'`; documentul se găsește prin `izo_corectii.document_intrare_id`) → UPDATE antet (cele trei coloane PV, `versiune + 1`) → corecția `aplicata`. **Zero mișcări, zero bucăți atinse.**
- **Efecte:**
  - evenimentul `receptie_pv` rămâne neschimbat (registrul e doar-adaug; motivul lui păstrează PV-ul inițial), iar `eveniment_pv_id` rămâne același;
  - starea bucăților nu se schimbă;
  - un reapel al vechiului `fn_izo_doc_pv` cu valorile inițiale → 23505 („documentul are deja PV-ul …”), comportament E3 neschimbat.
- **Nu face:** scoaterea PV-ului fără anularea intrării (nu e cerută; Q-E3b-8 o lasă deschisă).

### 5.5 Storno-ul parțial pe import — `fn_izo_cor_storno_import(p_proiect, p_import_id, p_bucati, p_motiv, p_cerut_de)` (doar `postgres`)

**Validări** (după pașii 0–8, sub advisory-ul exclusiv; toate refuzurile dau lista completă):
- `p_bucati`: 1–10000 de elemente, fără dubluri, fără NULL;
- importul există pe proiect, cu `stare = 'aplicat'`;
- **fiecare** bucată s-a născut din evenimentul importului (mișcarea `nascut` pe `izo_importuri.eveniment_id`), nu e `anulata` și n-are propunere E3b deschisă („decide / retrage întâi”);
- lanțul: nicio mișcare blocantă (§6; sub A, faptele E3b aplicate nu blochează);
- `p_cerut_de`: profil existent, owner sau responsabil pe proiect la momentul apelului; motivul are 3–1000 de caractere.

**Scrierea:**
1. corecția (`storno_import`, `propus_de = p_cerut_de`) + lista în `izo_corectii_bucati`;
2. marcajul;
3. evenimentul `storno_partial` (`import_id`, `declarat_de = p_cerut_de`, `aplicat_de` NULL, `aplicat_rol = postgres`);
4. mișcările `anulat` (X → `anulata`, X = starea curentă);
5. `UPDATE … SET stare = 'anulata' … WHERE id = ANY(lista) AND stare <> 'anulata' RETURNING`; numărul întors = mărimea listei, altfel excepție;
6. corecția `aplicata`.

`izo_importuri` rămâne `aplicat`: storno-ul complet de mai târziu e încă posibil (§6).

**Efecte:**
- seriile se eliberează în indexuri, deci rândurile corecte se pot adăuga cu un **import suplimentar** E2a (`import_id` nou, cu sursă + sha256, cât proiectul e la `stoc`; la `montaj` importul E2a refuză);
- bucățile anulate rămân în registru ca `anulata`, cu tot istoricul.

### 5.6 Propunerea, retragerea, respingerea, verificarea

- **`fn_izo_cor_propune`:** schemă + poarta → validează forma (`p_tip` pe listă, cheile din `p_detalii` pe lista tipului, motivul) → autorizarea §3.4 → eligibilitatea (§5.0) și regula operației (§5.2–5.3), pe citirea curentă → INSERT `propusa`, cu `inainte` recalculat de trigger. Conflictul pe `ux_izo_cor_deschisa` → 23505 „există deja o corecție deschisă pe bucată”.
- **`fn_izo_cor_retrage` / `_respinge`:** corecția `FOR UPDATE` → autorizarea / patru ochi → `propusa` + CAS pe `versiune` → doar coloanele deciziei. Nimic în registru, deci fără advisory și fără porți de registru în afara celei complete de la intrare.
- **`fn_izo_cor_verifica`** (doar citire, nicio scriere, nici marcaj):
  - pentru o propunere: e încă aplicabilă? (starea și locul = `inainte`, ținta ieșirii, coliziuni, regula PV);
  - pentru o corecție de câmp încă netrimisă: delta efectivă (cu derivatele), coliziunile și avertismentele (diferența față de rândul documentului de intrare, dacă există);
  - întoarce `versiune` pe care o cere aprobarea.

### 5.7 Istoricul ciornei (în afara hash-ului)

- `fn_izo_doc_salveaza` (forma 20261103b, md5 la precondiție) se înlocuiește cu o singură adăugire: **la final**, după antet, rânduri și manifest, sub același `FOR UPDATE` al documentului:
  ```
  INSERT INTO izo_documente_istoric (document_id, versiune, salvat_de, salvat_rol, continut, hash, diff, baza)
  VALUES (d.id, d.versiune, v_uid, session_user, fn_izo_doc_instantaneu(d.id), fn_izo_doc_hash(d.id),
          fn_izo_doc_diff(<continutul ultimei intrări sau NULL>, fn_izo_doc_instantaneu(d.id)), <nu există intrare anterioară>);
  ```
  Răspunsul primește în plus `istoric_versiune`. Nicio altă schimbare: validările, CAS-ul și ordinea lock-urilor rămân cele E3.
- **`trg_izo_doc_ist_garda`:**
  - INSERT doar ca `izo_doc_editor`, doar pe un document `draft`, cu `versiune` = versiunea curentă a documentului, `salvat_de = fn_izo_uid()`;
  - `continut`, `hash`, `diff` și `baza` **recalculate de trigger și comparate exact** (nu se acceptă valori de la apelant);
  - UPDATE / DELETE / TRUNCATE → refuz pentru orice rol.
- **Hash-ul `e3-doc-v1` nu se schimbă** (`fn_izo_doc_hash` rămâne byte cu byte). Istoricul e un tabel separat.
  - Invariantul testat: `sha256(continut)` reproduce hash-ul acelei versiuni;
  - consecința utilă pentru audit: `hash_confirmat` al unui document confirmat = `hash`-ul exact al unei intrări din istoric (ultima).
- **Nu intră în istoric:**
  - anularea ciornei (conținutul nu se schimbă; se vede pe antet);
  - confirmarea (o arată hash-ul);
  - corecțiile PV (stau în `izo_corectii`).
- **Ciornele create înainte de E3b** (doar pe branch / proiectul de test, fiindcă E3 nu e pe prod): prima salvare după E3b scrie `baza = true`. Migrarea nu scrie date.

## 6. Storno-ul complet și corecțiile (Q-E3b-1)

**Problema.** Azi, `fn_izo_import_storno` (E2a, LIVE) refuză dacă vreo bucată a importului are **orice** mișcare pe alt eveniment decât al importului (`v_alt > 0`). La fel anularea documentului E3 (orice mișcare în afara nașterii și a PV-ului). Fără o decizie:
- prima corecție E3b pe o bucată LOT 2 ar bloca pentru totdeauna storno-ul complet al soldului (`izo_critic.txt`: „repar o bucată” și „anulez tot” se exclud);
- **chiar storno-ul parțial l-ar bloca** (mișcările `anulat` sunt pe alt eveniment), iar un storno complet după unul parțial ar reanula bucăți deja `anulata`.

**Varianta A (recomandată): faptele E3b nu blochează storno-ul; doar lanțurile E4+ blochează.**
- Faptele E3b (corecție de câmp, carantină intrare / ieșire, pierdut, găsit-recuperare) nu mută bucata pe tronson, nu creează copii și nu o consumă. Trecerea la `anulata`, din starea curentă, rămâne bine definită, iar istoricul rămâne întreg.
- **Un singur predicat**, `fn_izo_lant_blocant(p_bucati bigint[], p_ev_proprii bigint[]) RETURNS TABLE (bucata_id, miscare_id, eveniment_id, tip)`. Întoarce mișcările pe bucăți care NU sunt:
  - (a) pe un eveniment propriu al sursei;
  - (b) pe evenimentul unei corecții `aplicata` de tip ∈ {`camp`, `carantina_intrare`, `carantina_iesire`, `pierdut`, `gasit_recuperare`}, identificat prin (`document_tip = 'izo_corectie'`, `document_id = c.id`, `c.eveniment_id = e.id`).
- **Trei funcții înlocuite**, fiecare cu md5-ul corpului verificat la precondiție și definiția veche salvată pentru revenire:
  1. `fn_izo_import_storno` (E2a; owner, semnătură și ACL neschimbate):
     - mulțimea = bucățile născute din import cu `stare <> 'anulata'` (cele stornate parțial sunt deja închise);
     - blocantele = `fn_izo_lant_blocant(mulțime, {eveniment import})`;
     - mișcările `anulat` și UPDATE-ul doar pe mulțime;
     - `izo_importuri` → `stornat` ca azi, chiar și cu mulțimea goală (închide formal importul);
  2. `fn_izo_doc_anuleaza` (E3):
     - blocantele prin același predicat (`{intrare, PV}`);
     - storno-ul PV-ului readuce în `sosit` doar bucățile PV-ului aflate încă în `receptionat`;
     - storno-ul intrării anulează toate bucățile rămase, din starea lor curentă;
  3. `fn_izo_garda_receptie` (E3): la storno-ul intrării, starea veche admisă devine {`sosit`, `receptionat`, `carantina`, `pierduta`} (azi {`sosit`, `carantina`}). Mișcarea așteptată folosește deja starea curentă.
- **Regula pentru E4**, de scris în E4_PLAN, cu test acolo:
  - orice funcție E4 care mută / montează / taie refuză bucățile în `carantina` / `pierduta` și pe cele cu o corecție E3b deschisă;
  - storno-ul în lanț din E4 folosește `fn_izo_lant_blocant`, extins explicit, cu review.

**Varianta B (conservatoare): nimic din E2a / E3 nu se schimbă (doar gărzile și porțile).**
- După primul fapt E3b pe o bucată, storno-ul complet al importului ei și anularea documentului ei se refuză, ca azi.
- Storno-ul parțial acceptă faptele E3b (folosește predicatul local). „Tot importul” = storno parțial pe toate bucățile rămase; `izo_importuri` rămâne `aplicat`, ca diferență doar cosmetică.
- Un document E3 cu o bucată corectată / carantinată nu se mai poate anula deloc. Rămân doar corecțiile pe bucată.

**Varianta C:** A pentru import (E2a înlocuită), B pentru documentele E3 (fără a atinge `fn_izo_doc_anuleaza` / garda E3).

Testele 9–10 și regresia (testul 14) sunt scrise pe ambele ramuri. Sub A, testele E2a / E3 care cer refuzul la „orice mișcare” se adaptează explicit, cu lista lor în PR (nu se șterg).

## 7. Revenirea (`supabase/revenire/20261104a_izometrie_e3b_corectii_ROLLBACK.sql`; rulează ÎNAINTEA revenirii E3)

- **Refuză dacă există ORICE fapt E3b:**
  - vreun rând în `izo_corectii` / `izo_corectii_bucati` / `izo_documente_istoric`;
  - vreun eveniment cu `document_tip = 'izo_corectie'` sau cu `tip` ∈ {`carantina_intrare`, `carantina_iesire`, `storno_partial`};
  - vreo bucată cu `atribute->>'sursa' = 'e3b'`.
  
  Istoricul ciornei intră în listă (audit). Practic, revenirea e posibilă doar până la prima salvare de ciornă după E3b. După primul fapt, drumul e **înainte**, cu migrare revizuită.
- **Fără fapte:**
  - scoate trigger-ele / politicile / funcțiile / tabelele / rolurile E3b, indexul `ux_magbuc_ev_corectie` și `magbuc_ev_e3b_motiv`;
  - reface CHECK-ul tipurilor (forma E3) și funcțiile înlocuite, din definițiile salvate: gărzile E3, `fn_izo_doc_garda`, `fn_izo_porti_lipsa`, `fn_izo_doc_salveaza` și, sub A, `fn_izo_import_storno` / `fn_izo_doc_anuleaza` / `fn_izo_garda_receptie`;
  - reface ștampilele `porti=` / `porti_e3=` și COMMENT-ul amprentei de revenire, cu valoarea păstrată după `inainte_20261104a=`;
  - verifică egalitatea cu starea dinainte de E3b.
- Testat pe baza curată: E3b → revenire E3b → revenire E3 → revenire 2c → revenire E2a, toate trec.

## 8. UI (schiță; stilul G / S, fără librării noi)

**Magazie → „Stoc trasabil” (`IzoStocTeava.jsx`), fișa unei bucăți** (panou lateral):
- datele + **istoricul**: mișcările cu evenimentul, cine (declarat / aplicat), când, motivul, NCR-ul, înainte / după;
- un semn „diferă de documentul de intrare”, dacă o corecție de câmp a schimbat o valoare care vine din rândul documentului.

Butoanele, după rol (vizibilitatea se calculează pe client din atribuiri, ca hint; dreptul real e pe server):

| Buton | Cine | Ce deschide |
|---|---|---|
| 🚧 Propune carantină | gestionar / responsabil | NCR, motiv |
| ✅ Propune ieșire din carantină | gestionar / responsabil | NCR închidere, motiv; starea țintă afișată (din `verifica`); alegere `sosit` / `receptionat` doar pentru import / găsit |
| ❓ Lipsește fizic | gestionar / responsabil | cauza, motiv |
| 📍 Am găsit-o | gestionar / responsabil | depozitul (implicit cel de dinainte), motiv |
| ✏️ Corectează | responsabil | câmpurile din `L`, curent ↔ nou; previzualizarea din `verifica` (derivate, coliziuni, diferența față de document); motiv obligatoriu |

Butoanele de stare sunt dezactivate, cu explicație, pe bucățile unui document fără PV (regula din §5.0).

**Magazie → tab nou „🛠️ Corecții”:**
- coada pe proiect, cu filtre `propuse` / `aplicate` / `respinse` / `retrase`;
- responsabilul are „Aprobă” / „Respinge”, dezactivate pe propriile propuneri (patru ochi), cu înainte / după și avertismente; gestionarul are „Retrage” pe ale lui;
- „＋ Bucată găsită (nu e în registru)”: formularul `gasit_nou`.

**Magazie → „🧾 Documente de intrare” (E3, `IzoDocumenteIntrare.jsx`):**
- pe ciornă, tab „🕘 Istoric”: versiunile (cine, când, rezumatul diff-ului: „+2 rânduri, 3 câmpuri”), iar la click diff-ul detaliat;
- pe documentul confirmat, „hash-ul confirmat = versiunea N”;
- pe documentul cu PV, butonul „Corectează PV” (responsabil) + lista corecțiilor PV.

**Izometrie (`Izometrie.jsx`): doar citire.** În selectorul de țeavă și pe fișa tronsonului, bucățile `carantina` / `pierduta` apar indisponibile, cu motivul (badge + link spre fișa din Magazie). Niciun buton de corecție aici: corecțiile stau într-un singur loc.

**Mesajele de eroare** de la server se afișează așa cum vin: sunt în română și conțin lista (rânduri / bucăți / motive).

## 9. Testele (negative întâi; harness PG16 `scripts/test_izometrie_e3b.sh` + branch PG17 + PostgREST real, ACL-ul de producție; rezultatele vin la cod)

1. **Autentificarea / autorizarea**, pe toate intrările, inclusiv retry:
   - `anon`, `service_role`, `authenticated` fără modul / cu `viewer`;
   - atribuire expirată / viitoare / revocată / pe alt proiect / pe alt depozit;
   - gestionarul care încearcă `aproba` / `camp` / `pv`;
   - responsabilul care își aprobă / respinge propria propunere, inclusiv ca owner (patru ochi);
   - retragerea de către altcineva;
   - `fn_izo_cor_storno_import` din API; intrările API dintr-o sesiune postgres;
   - auto-promovarea `is_owner` refuzată; owner-ul real și responsabilul real trec.
2. **Curse cu barieră** (T1 oprit după pasul 3 sau 8 printr-un advisory de test; `pg_locks` confirmă așteptarea), în ambele ordini:
   - revocarea responsabilului / a modulului ↔ aprobarea;
   - două aprobări ale aceleiași propuneri; aprobare ↔ retragere; aprobare ↔ respingere;
   - corecție directă ↔ propunere deschisă pe aceeași bucată;
   - **corecția seriei ↔ confirmarea E3** a unui document cu aceeași serie (și ↔ importul suplimentar): exact una trece, cealaltă primește 23505 clar și zero efecte;
   - carantina ↔ PV-ul E3 pe același document;
   - aprobare ↔ anularea documentului E3; aprobare ↔ storno-ul complet; storno parțial ↔ storno complet; storno parțial ↔ aprobarea pe o bucată din listă;
   - `gasit_recuperare` ↔ mutarea depozitului-destinație pe alt site;
   - schemă ↔ runner-ul de migrări (cheia exclusivă).
3. **Garda pe context:** `izo_corectie_writer`, cu marcaj valid pentru corecția A, încearcă (toate refuzate):
   - un eveniment cu alt `document_id` / alt tip / al doilea eveniment;
   - o mișcare pe altă bucată / pe alt eveniment / a doua pe aceeași bucată / cu alt rol / cu alte stări / cu alt `in_loc`;
   - un UPDATE pe bucată fără mișcarea înainte / cu o coloană în plus / cu o valoare diferită de `dupa` / cu `server_ver` neschimbat;
   - un INSERT de bucată în alt context decât `gasit_nou`;
   - un UPDATE pe antetul documentului în afara `pv` / pe alte coloane;
   - `aplicata` cu alt `eveniment_id`;
   - un context cu alt `txid` / altă versiune / alt proiect; `izo.receptie_ctx` setat în aceeași tranzacție;
   - un helper care scrie înaintea marcajului.
4. **Proiecția:** pentru FIECARE coloană din `C`, un UPDATE care o schimbă în plus față de delta → refuz. Pentru fiecare cheie din `L_teava` / `L_curba`, corecția corectă trece. Cheie din `D` sau din afara `L` → 22023. Valoare egală → „nimic de corectat”, fără scriere. Derivatele: `lungime_mm` / `lungime_m` calculate altfel → refuz.
5. **Unicitatea:** o serie spre o serie vie (import / document / `pierduta`) → 23505; spre una `anulata` → trece. Coliziune de curbă pe unghi; coliziune de frunză pe `lungime_cm`. Mesaj clar, zero efecte.
6. **Stările:**
   - intrarea în carantină din `pe_tronson` / `pierduta` / `anulata` / `carantina` → refuz;
   - **orice operație de stare pe o bucată a unui document fără PV** → refuz; după PV trece;
   - ținta ieșirii, pe fiecare ramură a regulii din §5.2, inclusiv pierdut-din-carantină → găsit → ieșire;
   - `gasit_recuperare` din altă stare → refuz; depozit inactiv / pe alt site / alt tronson → refuz;
   - starea și locul schimbate între propunere și aprobare → 40001.
7. **`gasit_nou`:** serie dublată → 23505; perete / lungime / unghi lipsă → refuz; documentul de referință pe alt proiect / neconfirmat / inaccesibil → refuz generic; starea `carantina`; anularea documentului de referință nu atinge bucata găsită.
8. **PV:**
   - pe un document draft / anulat / confirmat fără PV → refuz; versiune veche → 40001; aceleași valori → refuz; `|` în număr → refuz;
   - după corecție: `receptie_pv` neschimbat, bucățile neatinse, reapelul vechiului `fn_izo_doc_pv` → 23505;
   - anularea documentului după o corecție PV trece (A și B: zero mișcări).
9. **Storno-ul parțial:**
   - din API → refuz; bucată din alt import / dintr-un document / deja anulată / cu propunere deschisă / cu o mișcare E4 simulată (scrisă ca `postgres`, pe branch) → refuz, cu lista;
   - listă goală / cu dubluri / cu NULL; `p_cerut_de` inexistent / fără rol → refuz;
   - după storno: seria e eliberată, iar importul suplimentar trece;
   - **storno complet după parțial:** A → anulează doar restul, `stornat`; B → refuz, iar parțialul pe rest trece.
10. **Storno-ul complet / anularea documentului peste fapte E3b:** după o corecție de câmp / carantină / pierdut / găsit:
    - A → trece; stările finale `anulata`, mișcările `anulat` din starea curentă, PV-ul stornat doar pe bucățile `receptionat`;
    - B → refuz, cu lista;
    - ambele: peste o mișcare non-E3b (E4 simulată) → refuz.
11. **Istoricul ciornei:**
    - fiecare salvare scrie exact o intrare, cu versiunea nouă; `sha256(continut)` = `fn_izo_doc_hash` la acea versiune;
    - diff corect pe antet / rânduri adăugate / șterse / modificate / scanuri; o renumerotare apare ca ștergere + adăugare (comportament declarat);
    - INSERT direct (orice rol API; editorul în afara salvării; valori date de apelant) / UPDATE / DELETE / TRUNCATE → refuz;
    - `hash_confirmat` = hash-ul ultimei intrări; ciorna veche → `baza = true`; anularea ciornei nu scrie intrare.
12. **Privilegiile:**
    - matricea din §3.5, pe catalog, pe fiecare celulă (`has_column_privilege` pe fiecare coloană a `magazie_bucati` pentru ambii writeri);
    - DML direct al `authenticated` / `service_role` pe tabelele noi → refuz;
    - `izo_cor_editor` nu scrie registrul; `izo_corectie_writer` nu scrie config / importuri / atribuiri și nici coloane din afara listei.
13. **Porțile**, fiecare mutație → porți lipsă, iar intrările E2a / E3 / E3b refuză:
    - o politică `*_corectie_*` slăbită; un GRANT de coloană în plus; un trigger `DISABLE` / `ENABLE` (în loc de `ALWAYS`);
    - un membership neașteptat; un `ALTER ROLE … BYPASSRLS`; o funcție `fn_izo_cor_*` modificată (corp / ACL / config);
    - scoaterea indexului `ux_magbuc_ev_corectie` / `ux_izo_cor_deschisa`;
    - **proba capcanei:** o funcție de test numită `fn_izo_import_storno_x` → „wrapper nerevizuit”; poarta E3b nu numește niciuna dintre cele patru funcții E2a.
14. **Regresia:** suitele E2a (180 de verificări) și E3 (`izometrie_e3.test.sql`) rulează nemodificate peste E3b (sub B). Sub A, cu lista explicită a testelor de storno adaptate. Testul diferențial al închiderii (E3 §14) rămâne verde.
15. **Apelurile tranzitive:** fiecare operație (propune / retrage / respinge / verifică / aprobă pe fiecare tip / câmp / PV / storno parțial / salvare cu istoric) rulată cap-coadă ca rolul real, fără `permission denied`.
16. **Atomicitatea:** eșec injectat după eveniment / după mișcare / după UPDATE → zero efecte, iar corecția rămâne `propusa` (la cele directe, nici rândul corecției nu rămâne).
17. **Idempotența:**
    - aprobarea repetată cu aceeași `p_versiune` (cea dinaintea aprobării), de același aprobator, pe o corecție deja `aplicata` → idempotentă (același `eveniment_id`, `idempotent: true`, fără scrieri); cu altă versiune sau de alt om → refuz;
    - `camp` cu `server_ver` vechi → 40001; `pv` cu versiune veche → 40001.
18. **Migrarea peste proiectul activ** (pe branch, cu o copie a LOT 2: 3352 de bucăți, 2 în carantină, 1466 pe tronson) și **revenirea** (§7):
    - porțile rămân complete după apply;
    - un import + storno E2a pe proiectul de test merge (sub A, și peste o corecție);
    - E3 (confirmare / PV / anulare) merge;
    - ieșirea din carantină a celor 2 țevi LOT 2 (cazul real cel mai apropiat) trece cap-coadă.

## 10. Ce rămâne limitare (declarată)

- Documentul de intrare confirmat nu se rescrie: corecția de câmp schimbă bucata, iar diferența față de rândul documentului rămâne vizibilă (intenționat).
- O corecție E3b nu are „storno”. Una greșită se repară cu altă corecție, în sens invers, auditată.
- `pierdut` nu distinge structural „n-a existat” de „a dispărut” (doar `cauza` + motiv). „N-a existat”, pe un import, înseamnă storno parțial.
- Anularea parțială a unui document E3 nu există (doar anularea întreagă, administrativă). Piesele lipsă după PV se tratează cu `pierdut`.
- NCR-ul e doar o referință text: documentul nu se atașează (E9).
- Sesiunea `postgres` care își ia rolul de writer și pune marcajul E2a poate în continuare să scrie fără eveniment (`izo_critic.txt`). Rămâne regula de lucru „doar cu da”; E3b nu închide această cale.
- Revenirea E3b se blochează la primul fapt E3b, inclusiv la o simplă salvare de ciornă.
- Istoricul începe la E3b pentru ciornele existente.
- Încrederea în validarea JWT de gateway, ca în E3.

## 11. Întrebări deschise (A / B / C; recomandarea e prima)

- **Q-E3b-1, storno-ul complet față de corecții (§6):**
  - **A** faptele E3b nu blochează storno-ul (import complet / parțial, anularea documentului); doar E4+ blochează. Se înlocuiesc `fn_izo_import_storno`, `fn_izo_doc_anuleaza` și `fn_izo_garda_receptie`;
  - **B** strict, nimic din E2a / E3 nu se schimbă: după prima corecție, storno-ul complet și anularea documentului se refuză, iar storno-ul parțial devine singura unealtă;
  - **C** A pe import, B pe documente.
- **Q-E3b-2, cine e „responsabilul”:**
  - **A** owner + `manager_aprobator` + `inlocuitor_aprobator` activ;
  - **B** owner + `manager_aprobator`;
  - **C** doar owner.
- **Q-E3b-3, patru ochi:**
  - **A** aprobatorul ≠ propunătorul, pentru toți, inclusiv owner;
  - **B** owner-ul își poate aproba propria propunere;
  - **C** responsabilul aplică direct și stările (fără propunere), ca la corecția de câmp.
- **Q-E3b-4, operațiile de stare înainte de PV, pe bucățile unui document E3:**
  - **A** refuz până la PV (corecția de câmp e permisă);
  - **B** permise, iar PV-ul E3 le sare (se înlocuiește `fn_izo_doc_pv`);
  - **C** permise, iar PV-ul rămâne blocat până revine `sosit`.
- **Q-E3b-5, starea după ieșirea din carantină:**
  - **A** regula din §5.2 (starea dinaintea episodului; din document, `receptionat` după PV; din import / găsit, aleasă explicit);
  - **B** mereu `sosit`;
  - **C** aleasă liber de responsabil.
- **Q-E3b-6, bucata găsită nouă:**
  - **A** intră în `carantina`;
  - **B** intră `sosit`;
  - **C** fără bucăți noi în E3b (doar recuperarea celor pierdute).
- **Q-E3b-7, pierdut / găsit:**
  - **A** fluxul carantinei (gestionarul propune, responsabilul aprobă);
  - **B** direct de responsabil.
- **Q-E3b-8, corecția PV-ului:**
  - **A** responsabilul, direct;
  - **B** gestionarul propune, responsabilul aprobă;
  - **C** doar administrativ (`postgres`). Tot aici: e nevoie și de „scoate doar PV-ul” (fără anularea intrării)? Recomandarea: nu acum.
- **Q-E3b-9, bucățile de pe tronson** (1466 pe LOT 2), cine propune:
  - **A** gestionarul depozitului de origine sau responsabilul;
  - **B** orice gestionar activ pe proiect;
  - **C** și `rts_rte` / `inginer_izometrie`.
- **Q-E3b-10, lista câmpurilor corectabile:**
  - **A** lista din §2.5;
  - **B** + atributele importului (`aviz_iesire`, `pv_receptie`, `data_aviz`, `nrcd`);
  - **C** + `furnizor` / `producator` / `nr_document` / `data_receptie`.
- **Q-E3b-11, storno-ul parțial:**
  - **A** administrativ (`postgres`, cu „da”), cu `p_cerut_de` obligatoriu;
  - **B** responsabilul din API, cu patru ochi.
- **Q-E3b-12, modulul cerut responsabilului:**
  - **A** `magazie` editor / admin (ca gestionarul);
  - **B** doar atribuirea;
  - **C** `executie`.
- **Q-E3b-13, istoricul ciornei:**
  - **A** instantaneul complet + diff la fiecare salvare;
  - **B** doar diff;
  - **C** A + o intrare la anularea ciornei.
- **Q-E3b-14, omul pe anularea administrativă E3** (`fn_izo_doc_anuleaza`, azi `aplicat_de` NULL):
  - **A** adăugăm `p_cerut_de` → `declarat_de`, doar dacă Q-E3b-1 = A (funcția se înlocuiește oricum);
  - **B** nu acum.
- **Q-E3b-15, certificatele 3.1 + reconcilierea ERP ↔ Excel** (numite „E3b” în E3_PLAN §0):
  - **A** devin E3c, după prima recepție reală;
  - **B** intră în E3b (întârzie recepția).
