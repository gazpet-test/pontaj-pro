# E3 — designul intrărilor API pentru documentele de intrare (r3) — pentru review ÎNAINTE de cod

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
- identitatea: `furnizor_canon` (NOT NULL, upper + spații normalizate), `nr_document_canon` (NOT NULL, upper, fără spații), `data_document` (NOT NULL); **UNIQUE (`furnizor_canon`, `nr_document_canon`, `data_document`)**;
- câmpurile de pe document, după șablon (E3_PLAN §1), și totalurile;
- `stare` ∈ {`draft`, `confirmat`, `anulat`};
- `versiune` (bigint NOT NULL, ≥ 1): **+1 la fiecare scriere a documentului** — salvare, confirmare, PV, anulare (P2);
- `hash_confirmat` (`e3-doc-v1:<sha256>`). **Nu există `hash_verificat`** (r3, punctul 3);
- `avertismente` (jsonb, scris la confirmare);
- confirmarea: `confirmat_de`, `confirmat_la`, `eveniment_intrare_id` (FK, UNIQUE);
- PV: `pv_nr_canon`, `pv_data`, `pv_pus_de`, `pv_pus_la`, `eveniment_pv_id` (FK, UNIQUE);
- anularea: `anulat_de_rol`, `anulat_la`, `anulat_motiv`, `eveniment_storno_intrare_id`, `eveniment_storno_pv_id` (FK, UNIQUE);
- `creat_de`, `creat_la`;
- CHECK-uri de coerență: `confirmat` ⇒ coloanele de confirmare NOT NULL; PV parțial interzis (toate coloanele PV sau niciuna); `anulat` ⇒ coloanele de anulare NOT NULL; `draft` ⇒ confirmarea / PV-ul / anularea NULL.

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
- **UNIQUE parțial:** un singur eveniment de intrare și un singur `receptie_pv` per (`document_tip`, `document_id`) cu `tip` ≠ `storno`.
- Auditul folosește coloanele E2a reale: `aplicat_de`, `aplicat_rol`, `ora_server`, `document_tip` = `doc_intrare`, `document_id` = `<id>`, `motiv` = `<hash_confirmat>` (pe intrare) / `PV <nr>` (pe PV). Hash-ul complet + manifestul stau pe document.

## 3. Rolurile, încrederea, privilegiile

### 3.1 Două roluri noi, NOLOGIN NOINHERIT, membru doar `postgres` (SET, fără INHERIT), ca la E2a

| Rol | Deține (owner, DEFINER) |
|---|---|
| `izo_doc_editor` | `fn_izo_doc_salveaza`, `fn_izo_doc_verifica` |
| `izo_receptie_writer` | `fn_izo_doc_confirma`, `fn_izo_doc_pv`, `fn_izo_doc_anuleaza`, `fn_izo_receptie_marcheaza` |

`izo_registru_writer` NU e folosit de E3: fără ALTER pe config / importuri / atribuiri. Drepturile exacte stau în matricea din §3.5.

### 3.2 Garda: contextul operației, într-o ramură E3 locală (r3, punctul 2)

**Marcajul E3 = contextul operației**, nu doar tranzacția. GUC-ul `izo.receptie_ctx` conține:
`<txid>|<op>|<document_id>|<proiect_id>|<depozit_id>|<versiune la intrare>`, cu `op` ∈ {`confirma`, `pv`, `anulare`}.

- Îl scrie DOAR `fn_izo_receptie_marcheaza(...)` (owner `izo_receptie_writer`, EXECUTE doar owner-ul, deci neexpusă: gate-ul 0e rămâne curat pe cele 4 intrări). Intrările o cheamă la pasul 7 din §4, după toate validările.
- La intrare, fiecare funcție E3 refuză dacă `izo.receptie_ctx` nu e gol (un context rămas din altă operație a aceleiași tranzacții).
- **`fn_izo_garda_scriitor` (E2a) NU se schimbă.** Gărzile `fn_izo_garda_bucati` / `fn_izo_garda_fapte` primesc o singură ramură nouă, la început: `current_user = 'izo_receptie_writer'` → `fn_izo_garda_receptie(TG_TABLE_NAME, TG_OP, OLD, NEW)`, care întoarce true sau aruncă excepția. Toate verificările comune E2a rămân și se aplică după ramură: fără DELETE / TRUNCATE, fără UPDATE pe evenimente / mișcări, fără stările `rezervata` / `consumata`, `tip_cod` = cel al lui `tip_material_id`, fără rânduri de registru pe proiecte `off`.
- `fn_izo_garda_receptie` (INVOKER, citește cu drepturile rolului). Verifică întâi: `txid` = `txid_current()`; contextul e bine format. Apoi recitește documentul din context (rândul e deja `FOR UPDATE` de la pasul 1, deci nu se poate schimba sub gardă) și cere `proiect_id` / `depozit_id` / `versiune` = cele din context.

Ce acceptă ramura, pe operație (orice altceva → 42501):

| Tabel / operație | `op = confirma` (documentul: `draft`) | `op = pv` (documentul: `confirmat`, PV nepus) | `op = anulare` (documentul: `confirmat`) |
|---|---|---|---|
| INSERT eveniment | `tip` = `intrare_aviz` (șablon țeavă) / `intrare_lista_ambalare` (curbe); `document_tip = 'doc_intrare'`, `document_id` = doc, `proiect_id` = proiect; `storno_de_eveniment_id` NULL; niciun alt eveniment de intrare pe doc | `tip = 'receptie_pv'`, aceleași legături; niciun alt `receptie_pv` pe doc | `tip = 'storno'`, `storno_de_eveniment_id` ∈ {`doc.eveniment_pv_id`, `doc.eveniment_intrare_id`}; PV-ul întâi (§9) |
| INSERT bucată | `aviz_intrare_id` = doc; `nr_crt_aviz` = un rând al doc cu `decizie` ∈ {primit, primit_neconform} și `bucata_id` NULL; `stare` = `sosit` (primit) / `carantina` (primit_neconform); `serie_canon` = seria canonică a rândului; `proiect_id` / `depozit_id` = context; `provenienta = 'beneficiar'`; `tip_cod` după șablon; `parinte_id` NULL, `radacina_id` = `id`, `dezambiguare` NULL, `cod_bucata = 'AB'`; `tronson_id` NULL | — | — |
| UPDATE bucată | — | doar `stare` `sosit` → `receptionat` (+ `server_ver`, `updated_at`; restul rândului identic); bucata = `rand.bucata_id` al unui rând `primit` al doc | doar `stare` (+ `server_ver`, `updated_at`): `receptionat` → `sosit` (storno PV) sau `sosit` / `carantina` → `anulata` (storno intrare); bucata aparține doc |
| INSERT mișcare | `rol = 'nascut'`, `eveniment_id` = evenimentul de intrare al doc, bucata are `aviz_intrare_id` = doc, `stare_dupa` = starea bucății, `in_loc` = depozitul | `rol = 'stare'`, `eveniment_id` = `receptie_pv` al doc, `sosit` → `receptionat`, bucata din mulțimea PV | `rol = 'stare'` (`receptionat` → `sosit`) pe storno-ul PV; `rol = 'anulat'` (→ `anulata`) pe storno-ul intrării; bucata aparține doc |
| UPDATE `randuri` | doar `bucata_id` NULL → id, unde bucata are `aviz_intrare_id` = doc și `nr_crt_aviz` = `nr_crt` | — | — |
| UPDATE antet | `draft` → `confirmat`, doar coloanele de confirmare + `hash_confirmat` + `avertismente`; `versiune` = context + 1 | doar coloanele PV (NULL → valoare); `versiune` = context + 1 | `confirmat` → `anulat`, doar coloanele de anulare; `versiune` = context + 1 |

Ramura se aplică și trigger-ului de imutabilitate al tabelelor de document (§5): în afara ei, după `confirmat` / `anulat` nu se mai schimbă nimic.

Ramura e cod nou (`fn_izo_garda_receptie`) + o linie în fiecare dintre `fn_izo_garda_bucati` / `fn_izo_garda_fapte`, înlocuite de migrarea E3 (CREATE OR REPLACE). Definițiile E2a sunt salvate pentru revenire (§9.3).

### 3.3 Autentificarea: încredere declarată în gateway, nu o „dovadă” (neschimbat)

- `session_user = 'authenticator'` (PostgREST), `auth.role() = 'authenticated'`, `auth.uid() IS NOT NULL`.
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
| `fn_izo_garda_receptie` | `postgres`, INVOKER | cei care declanșează gărzile: `anon`, `authenticated`, `service_role`, `izo_registru_writer`, `izo_receptie_writer`, `izo_doc_editor` (întoarce refuz pentru oricine nu e `izo_receptie_writer`) |
| `fn_izo_doc_autorizare_lock` | `postgres`, DEFINER | `izo_doc_editor`, `izo_receptie_writer` |
| `fn_izo_doc_hash` (calculul canonic, §6) | `postgres`, INVOKER, STABLE | `izo_doc_editor`, `izo_receptie_writer` |
| `fn_izo_scan_exista(cale)` (citește `storage.objects`) | `postgres`, DEFINER, STABLE | `izo_doc_editor`, `izo_receptie_writer` |
| `fn_izo_scan_poate_sterge(name)` (politica Storage, §6.1) | `postgres`, DEFINER | `authenticated` (e evaluată ca apelantul politicii; întoarce false dacă apelantul nu e autorizat pe document) |
| E2a: `fn_izo_blocheaza_locuri`, `fn_izo_blocheaza_tabele`, `fn_izo_lock_partajat`, `fn_izo_lock_proiect`, `fn_izo_nivel`, `fn_izo_porti_lipsa`, `fn_izo_porti_definitii`, `fn_izo_uid` | neschimbate | + `izo_receptie_writer` |

**Porțile.** Migrarea E3 înlocuiește `fn_izo_porti_lipsa` și `fn_izo_porti_definitii`; definițiile E2a sunt salvate pentru revenire. Ce se schimbă:
- amprenta include obiectele E3: tabelele de document (RLS / ACL / owner), politicile `izo_doc_*`, `magbuc_izo_receptie_*`, `izo_ev_receptie_*`, `izo_mis_receptie_*`, funcțiile `fn_izo_*` noi, rolurile (membership), cele două trigger-e `profiles`;
- **excepțiile** pentru analiza wrapper-elor / citirilor sunt o listă constantă `c_e3_revizuite` (semnătura exactă → `md5(prosrc | proconfig | owner | proacl | prosecdef)`), ca `c_dinamice_revizuite` din E2a. Doar acele funcții, cu acea definiție, sunt acceptate ca scriitori ai registrului din afara `izo_registru_writer`. Orice altă funcție (sau o modificare a uneia din listă) rămâne refuzată exact ca în E2a.

## 4. Protocolul de lock (ordine UNICĂ, comună tuturor intrărilor E3 și anulării)

1. **Documentul** `FOR UPDATE`. Proiectul și depozitul se iau de pe document; nu există argumente de proiect / depozit.
2. **Autorizarea** (§3.4): `profiles` → `user_module_access` → `izo_atribuiri`, toate `FOR SHARE`, prin `fn_izo_doc_autorizare_lock`. (Anularea, făcută de `postgres`, sare peste acest pas: nu are utilizator.)
3. **`fn_izo_blocheaza_locuri(proiect, [depozit], {})`:** proiectul și depozitul `FOR SHARE`.
4. **`fn_izo_blocheaza_tabele()`** (ACCESS SHARE; TRUNCATE / DDL așteaptă), apoi advisory: **partajat** `(73010, proiect)` la confirmare / PV, **exclusiv** la anulare (ca storno-ul E2a).
5. **Bucățile documentului** `FOR UPDATE`, ordonate după `id` — doar la PV și anulare (confirmarea le creează).
6. **Revalidarea, după toate lock-urile, pe starea comisă** (READ COMMITTED, snapshot nou): documentul (stare, versiune, hash recalculat); autorizarea (rezultatul pasului 2); `fn_izo_nivel(proiect) = 'stoc'`; `depozit.site_id = proiect.site_id`; existența obiectelor din manifest (§6.1); **porțile** `cardinality(fn_izo_porti_lipsa()) = 0`.
7. **Toate verificările de business** (§7 / §8 / §9), fără nicio scriere.
8. **Abia aici:** `fn_izo_receptie_marcheaza(op, doc, proiect, depozit, versiune)`; urmează doar blocul DML static.

Ordinea globală: document → profil → acces modul → atribuire → proiect / depozit → tabele → advisory → bucăți. Toate intrările E3 și anularea o respectă. Revocările de drepturi și mutările de loc ating un singur nivel din lanț; storno-ul E2a ia advisory → bucăți (sufix al aceleiași ordini). Deci nu există ciclu.

**Salvarea draftului** (§5) ia doar pașii 1–2; nu atinge advisory-ul și nici registrul.

## 5. Salvarea draftului (`fn_izo_doc_salveaza`) și imutabilitatea

- **Crearea** (`p_doc_id NULL`): autorizarea pe (`proiect_id`, `depozit_id`) din argumente (aceleași lock-uri, §3.4); `stare = draft`, `versiune = 1`. `proiect_id` / `depozit_id` / `sablon` sunt **imutabile** (trigger).
- **Editarea:** documentul `FOR UPDATE` → autorizarea → `stare = 'draft'`, altfel refuz → CAS pe `versiune`, apoi `versiune + 1`. Rândurile se înlocuiesc integral, sub același lock. Scanurile se adaugă sau se scot din manifest doar aici (deci orice schimbare de manifest mărește versiunea și schimbă hash-ul). La adăugarea unui scan: obiectul trebuie să existe deja la calea dată de server (`fn_izo_scan_exista`).
- **Trigger-ul de imutabilitate** (BEFORE UPDATE / DELETE pe antet, rânduri, scanuri):
  - `draft`: scrie doar `izo_doc_editor` (sau `izo_receptie_writer` în ramura `confirma`), iar `versiune` crește exact cu 1;
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

1. evenimentul (`intrare_aviz` sau `intrare_lista_ambalare`, `aplicat_de = auth.uid()`);
2. pe fiecare rând `primit` / `primit_neconform`, în ordinea `nr_crt`: `id := nextval('magazie_bucati_id_seq')`; INSERT bucată cu coloanele nașterii — `id`, `proiect_id`, `tip_material_id`, `tip_cod`, `uid`, `parinte_id`, `radacina_id`, `cod_bucata`, `capat_stanga`, `capat_dreapta`, `serie`, `sarja`, `dimensiune`, `grad_otel`, `standard`, `izolatie`, `producator`, `furnizor`, `lungime_m`, `lungime_originala_m`, `lungime_aviz_mm`, `lungime_masurata_mm`, `lungime_mm`, `perete_mm`, `diametru_mm`, `unghi_curba`, `greutate_kg`, `cantitate`, `um`, `provenienta`, `sursa_receptie`, `nr_document`, `data_receptie`, `stare`, `locatie_tip`, `locatie_site_id`, `depozit_id`, `lot`, `aviz_intrare_id`, `nr_crt_aviz`, `bend_no`, `atribute`, `server_ver`, `observatii` (`lungime_mm` = măsurat ?? document) → mișcarea `nascut` (`in_loc` = depozitul) → `rand.bucata_id`;
3. documentul: `confirmat`, `hash_confirmat = p_hash`, `eveniment_intrare_id`, `avertismente`, `versiune + 1`.

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
- În E3 nu există ieșiri din API înaintea PV-ului. Când apar (E4+), contractul se extinde explicit.

## 9. Anularea și revenirea (r3, punctul 8)

### 9.1 `fn_izo_doc_anuleaza(p_doc_id, p_motiv)` — operație administrativă, doar `postgres`

Owner `izo_receptie_writer`, DEFINER, EXECUTE doar `postgres`, cere `session_user = 'postgres'` (N3, ca storno-ul E2a). `p_motiv` e obligatoriu (≥ 3 caractere).

- **Lock-uri:** §4 pașii 1, 3, 4 (advisory **exclusiv**), 5 (toate bucățile documentului — din `rand.bucata_id`, inclusiv carantina — `FOR UPDATE`, ordonate după `id`).
- **`draft`** → `anulat` direct (nicio scriere în registru; contextul `anulare` acoperă doar antetul).
- **`anulat`** → refuz (deja anulat).
- **`confirmat`**: refuz dacă vreo bucată a documentului are **vreo mișcare în afară de** `nascut` pe evenimentul de intrare al documentului și `stare` pe `receptie_pv`-ul lui (montaj, tăiere, mutare, bon, corecție, ieșire etc.): „stornează întâi lanțul, explicit”, cu lista. Ca la storno-ul importului: nicio inversare automată a operațiilor ulterioare.
- **Ordinea inversării** (totul într-o tranzacție, după marcajul `anulare`):
  1. dacă există PV: evenimentul `storno` cu `storno_de_eveniment_id = eveniment_pv_id` → bucățile `receptionat` → `sosit` (UPDATE + mișcările `stare`, `receptionat` → `sosit`); numărul = cel al mișcărilor PV-ului;
  2. evenimentul `storno` cu `storno_de_eveniment_id = eveniment_intrare_id` → toate bucățile documentului → `anulata` (UPDATE + mișcările `anulat`); numărul = cel al mișcărilor `nascut`;
  3. documentul: `confirmat` → `anulat` (coloanele de anulare, cele două `eveniment_storno_*`, `versiune + 1`). Rândurile, scanurile și `rand.bucata_id` rămân neatinse (audit).
- **Efect:** seriile se eliberează în indexurile de unicitate (`stare <> 'anulata'`), deci documentul corect se poate introduce din nou ca document nou. Evenimentele originale rămân (registrul e doar-adaug).

### 9.2 Trigger-ul de imutabilitate — ramura administrativă

Singura tranziție permisă după `confirmat`, în afară de PV: `confirmat` → `anulat`, doar sub contextul `op = anulare` al tranzacției curente (scris doar de `fn_izo_doc_anuleaza`), doar pe coloanele de anulare + `stare` + `versiune`. `anulat` e final.

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
11. **Anularea:** draft → anulat; confirmat fără PV; confirmat cu PV (ordinea: storno PV, apoi intrare; stările finale `anulata`); peste o mișcare ulterioară → refuz, zero efecte; dublă anulare → refuz; după anulare seria se poate reconfirma pe un document nou; apelată din `authenticated` → refuz.
12. **Revenirea:** E3 fără date → scoate tot, reface gărzile / porțile E2a, amprenta = cea dinainte; cu orice fapt E3 (draft, confirmat sau anulat) → refuz; revenirea E2a după E3 cere întâi revenirea E3.

## 11. Ce rămâne limitare (declarată)

- Hash-urile scanurilor sunt declarate de client până la E9.
- Încrederea în validarea JWT de gateway (Supabase).
- Porțile pe wrapper-e / citiri sunt analiză textuală: apărare în profunzime. Controlul principal rămâne procesul (nicio funcție DEFINER nouă pe prod fără migrare revizuită).
- Comportamentul API-ului Storage la DELETE refuzat de RLS e o presupunere verificată prin test pe branch, nu o garanție a schemei.
- PV-ul cere toate bucățile `primit` încă `sosit`, în depozit; ieșirile anterioare PV-ului vin cu extinderea contractului (E4+).
- După primul fapt E3, revenirea migrației e blocată prin design; corecțiile se fac înainte, cu migrare revizuită.
