# E3 — designul intrărilor API pentru documentele de intrare (r2) — pentru review ÎNAINTE de cod

**r2 (21.10.2026)** răspunde la review-ul r1 (Copilot: 5 × P1; Jakarinos: 8 × P1 + 1 × P2; 0 × P0). Se schimbă:
- protocolul de lock + autorizarea sub lock (§4);
- rolul separat, cu cel mai mic privilegiu (§3);
- salvarea draftului ca parte din frontieră (§5);
- hash-ul canonic versionat, cu manifestul scanurilor (§6);
- contractul complet al PV-ului (§8);
- unicitatea în BD (§7);
- marcajul pus după validări (§4);
- schema E2a reală: `ora_server`, fără `detalii`, CHECK-ul tipurilor de eveniment (§2);
- încrederea în gateway declarată ca atare (§3.3).

Decizia Razvan (21.10): Q-E3-2 = A — Janeta confirmă din UI, iar designul se revizuiește înainte de cod. Celelalte răspunsuri: tabelele `izo_*`; neconformitate → carantină; toleranțe ±10 mm / ±0,5° → avertisment; `lungime_mm` = măsurat ?? document; curba: serie = bend, șarjă = heat.

## 1. Frontiera, pe scurt

**Ce vine din API** (authenticated, cu atribuire):
- `fn_izo_doc_salveaza`: draft, creare / editare;
- `fn_izo_doc_verifica`: doar citire; întoarce hash-ul + verdictul;
- `fn_izo_doc_confirma`: draft → confirmat, cu bucățile în registru;
- `fn_izo_doc_pv`: confirmat → PV, bucățile `sosit` → `receptionat`.

**Ce rămâne exclusiv `postgres`** (N3 din E2a, neschimbat):
- activarea / dezactivarea;
- importul și storno-ul (inclusiv **anularea unui document confirmat** = storno pe evenimentele lui, prin funcția E2a);
- atribuirile;
- corecțiile pe bucăți.

Administrarea `postgres` e o cale separată. Nu primește o identitate umană fictivă: `aplicat_de` rămâne NULL, iar `aplicat_rol` = `postgres`.

## 2. Schema nouă (migrarea `20261103a_izometrie_e3_documente`; 20261102a aplicată NU se modifică)

**`izo_documente_intrare`** (antet):
- `id`, `proiect_id`, `depozit_id`, `sablon` ∈ {`aviz_teava`, `lista_ambalare_curbe`};
- identitatea: `furnizor_canon` (NOT NULL, upper + spații normalizate), `nr_document_canon` (NOT NULL, upper, fără spații), `data_document` (NOT NULL); **UNIQUE (`furnizor_canon`, `nr_document_canon`, `data_document`)**, fără NULL-uri care ar ocoli unicitatea;
- câmpurile de pe document, după șablon (vezi E3_PLAN §1), și totalurile;
- `stare` ∈ {`draft`, `confirmat`, `anulat`};
- `versiune` (bigint, +1 la fiecare salvare);
- `hash_verificat` și `hash_confirmat` (`e3-doc-v1:<sha256>`);
- confirmarea: `confirmat_de`, `confirmat_la`, `eveniment_intrare_id` (FK, UNIQUE);
- PV: `pv_nr_canon`, `pv_data`, `pv_pus_de`, `pv_pus_la`, `eveniment_pv_id` (FK, UNIQUE);
- `creat_de`, `creat_la`.

**`izo_documente_intrare_randuri`:**
- `document_id`, `nr_crt` (UNIQUE (`document_id`, `nr_crt`), > 0);
- câmpurile fizice: lungimile în **mm întregi**, kg cu **o zecimală**, unghiul cu **o zecimală**, perete / diametru;
- `decizie` ∈ {`primit`, `refuzat_la_receptie`, `primit_neconform`}, `motiv`;
- `bucata_id` (UNIQUE, pus doar de confirmare).

**`izo_documente_scanuri`** (manifestul):
- `document_id`, `cale` (uuid, dată de server, UNIQUE), `sha256_original`, `sha256_pdf`, `marime`, `mime`, `adaugat_la`;
- e parte din hash; după confirmare e imutabil.

**Evenimentele.** CHECK-ul `magazie_bucati_evenimente.tip` primește `intrare_lista_ambalare` și `receptie_pv`; `intrare_aviz` rămâne pentru avizul de țeavă (Copilot P3: tipurile se disting).
- **UNIQUE parțial:** un singur eveniment de intrare și un singur `receptie_pv` per (`document_tip`, `document_id`), fără storno (`storno_de_eveniment_id IS NULL`).
- Auditul folosește coloanele E2a reale: `aplicat_de`, `aplicat_rol`, `ora_server`, `document_tip` = `doc_intrare`, `document_id` = `<id>`, iar `motiv` = `<hash_confirmat>`. Hash-ul complet + manifestul stau pe document.

**Revenirea E3:** se rulează ÎNAINTEA oricărei reveniri E2a.
- Reface CHECK-ul tipurilor, `fn_izo_porti_lipsa` (definiția E2a salvată) și scoate rolurile / tabelele / funcțiile E3.
- Refuză dacă există documente confirmate (storno + decizie).
- Amprenta E2a din COMMENT se recalculează: după E3, revenirea E2a cere întâi revenirea E3. Asta se documentează și se testează.

## 3. Rolurile și încrederea

### 3.1 Două roluri noi, NOLOGIN NOINHERIT, membru doar `postgres` (SET, fără INHERIT), ca la E2a

| Rol | Deține | Drepturi |
|---|---|---|
| `izo_doc_editor` | `fn_izo_doc_salveaza`, `fn_izo_doc_verifica` | DML doar pe cele 3 tabele de document (doar `draft`, impus în funcție + trigger); SELECT pe registru (coliziuni), atribuiri, proiecte, depozite, profiles, user_module_access |
| `izo_receptie_writer` | `fn_izo_doc_confirma`, `fn_izo_doc_pv` | INSERT `magazie_bucati` (doar coloanele nașterii), UPDATE (`stare`) pe `magazie_bucati`, INSERT evenimente / mișcări, UPDATE pe documente (coloanele de confirmare / PV) |

`izo_registru_writer` NU e folosit de E3 (Copilot §9.2: o frontieră API își are propriul rol; fără ALTER pe config / importuri / atribuiri).

### 3.2 Garda E2a primește o ramură explicită pentru `izo_receptie_writer`

Fără ea, rolul nu poate scrie nimic în registru. Marcajul e propriu: `izo.receptie_tx` = txid. Ramura acceptă DOAR:
- **INSERT pe `magazie_bucati`:** `provenienta = 'beneficiar'`, `tip_cod` ∈ {teava, curba}, `stare` ∈ {sosit, carantina}, `aviz_intrare_id` NOT NULL, `proiect_id` / `depozit_id` = ale documentului din `aviz_intrare_id` (recitite de gardă), `parinte_id` NULL.
- **UPDATE pe `magazie_bucati`:** doar `stare` sosit → receptionat (+ `server_ver`); `to_jsonb(NEW) - stare - server_ver = to_jsonb(OLD) - …`; bucata să aibă `aviz_intrare_id` = documentul PV-ului.
- **INSERT pe evenimente:** `tip` ∈ {intrare_aviz, intrare_lista_ambalare, receptie_pv}.
- **INSERT pe mișcări:** `rol` ∈ {nascut, stare}.
- **Nimic altceva:** fără DELETE; fără TRUNCATE; fără config, importuri, atribuiri.

Ramura e cod în `fn_izo_garda_bucati` / `fn_izo_garda_*`, înlocuite de migrarea E3 (CREATE OR REPLACE, cu definiția E2a salvată pentru revenire). Porțile E3 le includ în amprentă.

### 3.3 Autentificarea: încredere declarată în gateway, nu o „dovadă”

- `session_user = 'authenticator'` (PostgREST);
- `auth.role() = 'authenticated'`;
- `auth.uid() IS NOT NULL`.

Se presupune că JWT-ul e validat de gateway-ul Supabase (PostgREST + GoTrue). Funcțiile nu pretind că dovedesc apelul direct.
- **ACL-urile:** REVOKE de la PUBLIC; EXECUTE doar `authenticated` pe cele 4 intrări, cu semnătura exactă; `anon` / `service_role` nimic.
- **SQL:** static, cu obiecte calificate, `search_path` fix.
- **Poarta pe wrapper-e / închiderea citirilor** (E2a r15) le include: e igienă a schemei (apărare în profunzime), nu o garanție la runtime.

### 3.4 Autorizarea: aceeași funcție internă `fn_izo_doc_autorizat(doc)`, chemată sub lock (§4)

- **owner:** `profiles.is_owner` (rândul profilului FOR SHARE);
- **SAU:**
  - dreptul de modul `magazie` ≥ editor (`user_module_access`, regula proiectului „acces dual”);
  - plus o atribuire `gestionar` **activă și valabilă azi** (`activ`, `valabil_de` ≤ azi ≤ `coalesce(valabil_pana, azi)`) pe **exact** `proiect_id` + `depozit_id` ale documentului (rândul atribuirii FOR SHARE).
  - Gestionarul fără depozit nu există (CHECK E2a). Răspunsul la §9.1 din r1 e deci NU.
- **Serializarea cu revocarea:** revocarea unei atribuiri (UPDATE `activ = false`, doar `postgres`) așteaptă confirmarea în curs, apoi intră în vigoare. O confirmare care începe după revocare o vede și refuză.
- **`is_owner`:** pe live, `profiles_update_own` permite UPDATE pe propriul rând, iar trigger-ele `prevent_role_escalation` / `fn_profiles_campuri_owner_only` blochează auto-promovarea.
  - Definițiile acestor trigger-e intră în amprenta porților E3: o slăbire a lor dă „porți lipsă”, iar intrările E3 refuză.
  - Test: auto-promovarea `is_owner` / `role` e refuzată.

## 4. Protocolul de lock (ordine UNICĂ, comună tuturor intrărilor E3 și anulării)

1. **Documentul** `FOR UPDATE`. Proiectul și depozitul se iau de pe document; nu există argumente de proiect / depozit.
2. **Autorizarea** (§3.4): rândul atribuirii / profilului `FOR SHARE`.
3. **`fn_izo_blocheaza_locuri(proiect, [depozit], {})`:** proiectul și depozitul `FOR SHARE`. O mutare de site sau o ștergere de depozit în curs e așteptată, iar una ulterioară așteaptă confirmarea (Jak P1-4).
4. **`fn_izo_blocheaza_tabele()`** (ACCESS SHARE; TRUNCATE / DDL așteaptă), apoi **advisory partajat** `pg_advisory_xact_lock_shared(73010, proiect)`, ca recepția E2a.
5. **Revalidarea, după toate lock-urile, pe starea comisă** (READ COMMITTED, snapshot nou):
   - documentul (stare, versiune, hash);
   - autorizarea (aceeași funcție);
   - `fn_izo_nivel(proiect) = 'stoc'`;
   - `depozit.site_id = proiect.site_id`;
   - **porțile:** `cardinality(fn_izo_porti_lipsa()) = 0` (E2a + E3). Un proiect deja activ nu scapă de porți (Jak P1-3).
6. **Toate verificările de business** (§7), fără nicio scriere.
7. **Abia aici:** `set_config('izo.receptie_tx', txid, true)` (marcajul DUPĂ validări — Copilot P1-5 / Jak P1-3); urmează doar blocul DML static.

**Anularea** unui document confirmat (`postgres`, storno E2a) urmează aceeași ordine: documentul `FOR UPDATE` → … → advisory **exclusiv** → bucățile. Deci document → advisory peste tot, fără ciclu document ↔ advisory (Jak P1-4).

**Salvarea draftului** (§5) ia doar documentul `FOR UPDATE` + autorizarea; nu atinge advisory-ul și nici registrul.

## 5. Salvarea draftului (`fn_izo_doc_salveaza`) — parte din frontieră (Jak P1-5 / Copilot P1-4)

- **Crearea** (`p_doc_id NULL`):
  - autorizarea pe (`proiect_id`, `depozit_id`) din argumente;
  - `stare = draft`, `versiune = 1`.
  - **`proiect_id` / `depozit_id` / `sablon` sunt IMUTABILE** după creare. Mutarea nu există: se creează un document nou. Un trigger pe tabel refuză UPDATE-ul lor.
- **Editarea:**
  - documentul `FOR UPDATE`;
  - autorizarea; `stare = 'draft'`, altfel refuz;
  - CAS pe `versiune`, apoi `versiune + 1`;
  - rândurile se înlocuiesc integral, sub același lock;
  - scanurile se adaugă sau se scot doar în draft;
  - `hash_verificat := NULL` la orice schimbare: trebuie verificat din nou.
- **După `confirmat` / `anulat`:**
  - un trigger refuză orice UPDATE / DELETE pe antet, rânduri și scanuri, în afară de coloanele de confirmare / PV;
  - acestea se scriu doar de `izo_receptie_writer` cu marcaj, o singură dată (NULL → valoare).

## 6. Hash-ul canonic `e3-doc-v1` (Copilot P1-4 / Jak P1-6)

`hash = 'e3-doc-v1:' || encode(sha256(convert_to(<json canonic>::text, 'UTF8')), 'hex')`. JSON-ul e construit de server cu `jsonb_build_object` (chei sortate de jsonb; NULL explicit ca `null`) și conține:
- `v` = `e3-doc-v1`, `proiect_id`, `depozit_id`, `sablon`, identitatea canonică, toate câmpurile antetului, totalurile;
- **rândurile**, ordonate după `nr_crt` (unic): toate câmpurile care ajung în registru + `decizie` / `motiv`;
- **numericele** canonice: mm întregi; kg / unghi `round(x, 1)::text`;
- **manifestul scanurilor**, ordonat după `cale`: `cale`, `sha256_original`, `sha256_pdf`, `marime`, `mime`.

**Limitarea de audit, păstrată:** `sha256_*` ale scanurilor sunt **declarate de client** până la E9 (edge-ul OCR le va calcula pe server). Hash-ul documentului dovedește că s-a confirmat exact manifestul declarat, nu octeții fișierului.

**Storage, bucket-ul `avize`:**
- INSERT doar în calea dată de server pentru un document `draft` al cărui editor e autorizat;
- **fără UPDATE** (deci fără upsert / înlocuire / mutare a obiectului);
- DELETE doar cât documentul e draft;
- SELECT pentru cei cu `fn_izo_citire(proiect)`.

**Cursa confirmare ↔ ștergerea scanului:** confirmarea ține documentul `FOR UPDATE`, iar politica de DELETE verifică `stare = 'draft'` printr-o funcție care ia rândul documentului `FOR SHARE`. Deci ștergerea așteaptă confirmarea și apoi e refuzată.

## 7. Confirmarea (`fn_izo_doc_confirma(p_doc_id, p_versiune, p_hash)`)

- **După §4, pașii 1–5:**
  - `stare = 'confirmat'` și `hash_confirmat = p_hash` → **idempotent**: întoarce `{document_id, eveniment_id, bucati: [id…] din rânduri}` fără scrieri;
  - `confirmat` cu alt hash sau `anulat` → refuz;
  - `draft`: `versiune = p_versiune` ȘI hash-ul recalculat = `p_hash` = `hash_verificat`, altfel 40001 „verifică din nou”.
- **Verificările blocante,** recalculate, niciodată luate de la client:
  - totalurile, cu rândurile refuzate incluse, pe **lungimile de document**;
  - motivul obligatoriu la `refuzat_la_receptie` / `primit_neconform`;
  - fiecare valoare fizică în interval (lungime 1–30000 mm, perete, diametru, unghi 0 < u ≤ 90);
  - serie validă, fără dubluri în document;
  - documentul are ≥ 1 rând.
- **Avertismentele** se salvează pe document: format, confuzii, măsurat ↔ document peste toleranțe (`abs(măsurat − document) > 10 mm`, respectiv `> 0,5°`; la prag exact nu există avertisment), scan dublat.
- **Coliziunile = unicitatea în BD** (Copilot P1-3 / Jak P2-9). Bucățile se inserează sub indexurile E2a: `ux_magbuc_izo_radacina` (țeavă: `serie_canon`, `dezambiguare`) și `ux_magbuc_izo_curba` (curbă: `serie_canon`, `sarja`, `unghi_curba`, `cod_bucata` — E3 scrie `cod_bucata = 'AB'`, ca importul; codul complet de pe listă stă în `atribute.cod`).
  - Un `unique_violation` în blocul DML anulează toată confirmarea și întoarce un refuz clar (seria / rândul).
  - Două documente cu aceeași bucată fizică, confirmate concurent → exact unul trece.
- **Scrierea** (după marcaj), totul sau nimic:
  1. evenimentul (`intrare_aviz` sau `intrare_lista_ambalare`, `aplicat_de = auth.uid()`);
  2. pe fiecare rând `primit` / `primit_neconform`: INSERT bucată (`sosit` / `carantina`, `lungime_mm` = măsurat ?? document, `lungime_aviz_mm`, `lungime_masurata_mm`, `aviz_intrare_id`, `nr_crt_aviz`, `lot`, `greutate_kg`, unghiul) + mișcarea `nascut` (`in_loc` = depozitul) + `rand.bucata_id`;
  3. documentul: `confirmat` + `eveniment_intrare_id`.
- **Reconcilierea în funcție, înainte de RETURN:** `count(mișcări nascut ale evenimentului)` = `count(rânduri cu bucata_id)` = numărul rândurilor primite. Altfel excepție, deci rollback total. Ledger-ul E2a e același pentru fiecare bucată (Copilot P2): nașterea, mișcarea și starea materializată sunt în aceeași tranzacție, legate de eveniment.
- **Răspunsul (minim, stabil):** `{document_id, eveniment_id, bucati: [id…], avertismente: […], idempotent}`. Nu întoarce date din registru în afara bucăților proprii abia create.

## 8. PV-ul (`fn_izo_doc_pv(p_doc_id, p_versiune, p_pv_nr, p_pv_data)`) — contract complet (Copilot P1-2 / Jak P1-7)

- **După §4, pașii 1–5:**
  - `stare = 'confirmat'` (draft / anulat → refuz);
  - PV-ul deja pus: (`pv_nr_canon`, `pv_data`) identice → **idempotent** (întoarce același `eveniment_pv_id`); diferite → refuz; altfel CAS pe `versiune`.
- **Mulțimea așteptată = cardinalitate exactă:** bucățile legate de rândurile `primit` ale documentului (`rand.bucata_id`), cu `aviz_intrare_id = doc`, pe proiectul / depozitul documentului.
  - **TOATE** trebuie să fie încă `sosit`; altfel refuz: „bucăți ieșite / modificate înainte de PV — decizie”.
  - În E3 nu există încă ieșiri din API. Când apar (E4+), contractul PV se extinde explicit; nu se acceptă „UPDATE ce mai găsesc”.
  - Bucățile `primit_neconform` (carantina) **nu** intră și rămân `carantina`.
- **Scrierea:** evenimentul `receptie_pv` (UNIQUE pe document) → `UPDATE … SET stare = 'receptionat' WHERE id = ANY(set) AND stare = 'sosit' RETURNING` → numărul întors = cardinalitatea, altfel excepție → mișcările `stare` (sosit → receptionat) din `RETURNING` → documentul (PV, `eveniment_pv_id`).

## 9. Testele (negative întâi; PG16 harness + PG17 branch + PostgREST / Storage reale, cu ACL-ul de producție)

1. **Autentificarea / autorizarea**, pe toate cele 4 intrări, inclusiv retry:
   - anon, service_role, authenticated fără modul;
   - atribuire expirată / viitoare / revocată / alt depozit / alt proiect;
   - auto-promovarea `is_owner` / `role` refuzată; owner-ul real trece.
2. **Curse cu barieră:**
   - confirmare ↔ confirmare (același document; două documente cu aceeași serie → exact unul);
   - confirmare ↔ editarea draftului;
   - confirmare ↔ mutarea depozitului pe alt site; confirmare ↔ stoc → off; confirmare ↔ revocarea atribuirii;
   - confirmare ↔ storno pe proiect;
   - PV ↔ PV; PV ↔ storno;
   - după așteptare: revalidare și refuz, fără scrieri.
3. **Integritatea:**
   - verifică → modifică antet / rând / decizie / scan → confirmă cu hash-ul vechi → 40001, zero efecte;
   - hash / versiune NULL → refuz;
   - mutarea proiectului / depozitului unui draft → refuz;
   - orice UPDATE / DELETE după confirmare → refuz.
4. **Atomicitatea:** eșec injectat după bucata N / după eveniment / după mișcare → documentul rămâne draft, zero bucăți / evenimente / mișcări.
5. **Marcajul:** un helper de validare care încearcă să scrie registrul înainte de marcaj → refuzat de gardă; `izo_receptie_writer` nu poate UPDATE / DELETE pe alte coloane sau tabele nici cu marcaj.
6. **PV:**
   - pe draft / anulat; PV diferit; retry identic;
   - bucată ieșită / modificată → refuz;
   - carantina rămâne carantină;
   - un singur eveniment `receptie_pv`.
7. **DML direct:** authenticated / service_role pe draft, registru, evenimente, mișcări, scanuri → refuz.
8. **Wrapper-e:** un wrapper static / dinamic, un overload, ACL / config modificate pe un proiect deja activ → porțile lipsesc → intrările refuză.
9. **Storage:** UPDATE / upsert / mutare refuzate; DELETE după confirmare refuzat; cursa DELETE ↔ confirmare.
10. **Toleranțele** exact la prag (10 mm / 0,5° → fără avertisment) și peste prag (avertisment).
11. **Revenirea:** E3 fără date → scoate tot și reface gărzile E2a; cu documente confirmate → refuz; revenirea E2a după E3 cere întâi revenirea E3.

## 10. Ce rămâne limitare (declarată)

- Hash-urile scanurilor sunt declarate de client până la E9.
- Încrederea în validarea JWT de gateway (Supabase).
- Porțile pe wrapper-e / citiri sunt analiză textuală: apărare în profunzime. Controlul principal rămâne procesul (nicio funcție DEFINER nouă pe prod fără migrare revizuită).
- PV-ul cere toate bucățile documentului încă `sosit`; ieșirile anterioare PV-ului vin cu extinderea contractului (E4+).
