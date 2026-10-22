# E3b — corecțiile registrului de țeavă (design r5) — pentru review ÎNAINTE de cod

**r5 (21.10.2026, review Jakarinos r4: GO, fără P0 / P1; 4 P2 de text).**
- **Varianta B armonizată cu matricea:** descrierea din §6 și din Q-E3b-1 spune acum ce se schimbă totuși în E2a sub Q-E3b-17 = A (prologul în import și în storno). Testul 13 cere egalitatea textuală „corp fără prolog = 20261102a” doar unde funcția primește numai prologul. Sub Q-E3b-1 = A / C, storno-ul rescris se verifică doar prin md5-ul formei vechi (§6, §9, §11).
- **Limita de așteptare la `fn_izo_cor_doc_lock`:** `lock_timeout` se aplică fiecărei achiziții de lock, `statement_timeout` fiecărei instrucțiuni, iar valorile de 8 s sunt setări de rol. Cele efective se reverifică prin PostgREST în testul 2 (§3.5).
- **ACL-ul tranzitiv al identității API:** E3b nu refolosește `fn_izo_doc_api_verifica`. `fn_izo_cor_api_verifica` face aceeași verificare, prin `fn_izo_jwt_rol` (E3, DEFINER), deci cele două roluri E3b primesc explicit EXECUTE pe `fn_izo_jwt_rol`, `fn_izo_uid` și `fn_izo_porti_lipsa` (§3.5, testele 12 și 15).
- **Revenirea:** „testat… toate trec” devine criteriu obligatoriu de acceptare la cod, nu rezultat obținut (§7).

**r4 (21.10.2026, review Jakarinos r3: toate P1 r2 rezolvate, 2 P1 + 2 P2 noi).**
- **P1 propunerile deschise la storno:** `izo_registru_writer` / `izo_receptie_writer` n-au SELECT pe `izo_corectii`, iar funcțiile DEFINER rulează cu drepturile owner-ului. Citirea trece prin helper-ul intern `fn_izo_cor_deschise` (DEFINER `postgres`, fără lock), cu EXECUTE doar pentru writerii care îl cheamă (§3.5, §6).
- **P1 varianta C și revenirea:** matrice explicită Q-E3b-1 × Q-E3b-17 cu funcțiile înlocuite, helper-ele create / ACL-ul lor și ce restaurează revenirea, independent pe fiecare axă; test apply → revenire pe fiecare combinație (§6, §7, §9).
- **P2:** fără garanția „câteva milisecunde” (limita reală e `lock_timeout` / `statement_timeout` = 8 s, citite live); egalitatea textuală „corp fără prolog = 20261102a” doar unde se pune doar prologul; riscul variantei B corectat sub Q-E3b-17 = A; „nu există ciclu” limitat la operații, cu excepția declarată a revocărilor multi-rând; reîncercarea după 40P01 e un apel nou, care reautorizează.

**r3 (21.10.2026, review Jakarinos r2: P1-1 / P1-3 / P2-2 rezolvate, restul parțial + 4 P1 noi).**
- **P1 `FOR SHARE` pe document la propunere:** `izo_cor_editor` are doar SELECT pe documente, iar `FOR SHARE` cere și UPDATE pe o coloană. Documentul de referință al lui `gasit_nou` se blochează prin helper-ul intern `fn_izo_cor_doc_lock(p_doc, p_proiect)`. Helper-ul bucății primește și el proiectul (§3.5, §4).
- **P1 Q-E3b-16 = A, contract complet în trigger:** rândul `camp` în lista albă a propunerii (doar `L_ident`, cheile direct în `p_detalii`), cererile mixte refuzate, `server_ver` stocat în `inainte`. Trigger-ul limitează scrierea directă la `L \ L_ident` și verifică singur patru ochi pe aplicare / respingere, prin coloana nouă `cale` (§1, §2.1, §3.3, §5.1).
- **P1 garda storno-ului PV (sub A):** afirmația r2 („garda neschimbată refuză mișcarea falsă”) era falsă: ramura INSERT a mișcării nu citea starea. Garda E3 înlocuită verifică acum starea curentă, apartenența la PV și unicitatea mișcării, pe ambele storno-uri (§6).
- **P1 coliziunile globale:** indexurile de serie sunt globale (20261102a, liniile 260–265). `verifica` arată detalii doar din proiectele pe care apelantul le citește și nu certifică disponibilitatea globală. Aplicarea dă un 23505 generic pentru restul. Oracolul rămas e declarat (§10), iar decizia e Q-E3b-18 (§5.1, §5.6).
- **P2:** storno-ul complet / anularea documentului refuză explicit propunerile deschise, sub A / C (§6); `inainte = '{}'` la `gasit_nou`; testul ordinii FK corectat (`camp` ține advisory-ul partajat, deci storno-ul așteaptă advisory-ul, nu rândul, §9.2); lock-urile pe atribuiri `ORDER BY id` (§3.4); USAGE pe secvențele evenimentelor / mișcărilor (§3.5); lista DEFINER-elor care citesc registrul (§3.6); Q-E3b-17: recomandarea trece pe înlocuirea importului / storno-ului E2a (§11).

**r2 (21.10.2026, review Jakarinos r1).**
- **P1 lock-uri prin FK:** orice rând nou cu FK spre o bucată (`izo_corectii`, `izo_corectii_bucati`) se scrie abia după advisory și după lock-ul bucăților; propunerea blochează bucata `FOR SHARE` înaintea INSERT-ului (§4, regula FK). Plus cursele cu barieră pe interclasarea asta (§9.2).
- **P1 `gasit_nou`:** proiectul explicit (`p_proiect` pe propunere / verificare), lista albă completă, pe tip (§1), și ramura `nascut` a gărzii, cu id-ul bucății rezervat în context (§3.2–3.3).
- **P1 `sursa_receptie`:** bucata găsită are `'manual'` (CHECK-ul live acceptă doar `packing_list` / `aviz` / `mtc` / `manual`); originea E3b stă în `atribute.sursa = 'e3b'` (§5.3).
- **P1 specificația corecțiilor directe:** `fn_izo_cor_garda` validează lista albă pe tip și recalculează `inainte` / `dupa` la INSERT. RPC-ul aplică exact ce întoarce `RETURNING` (§3.3).
- **P1 porțile:** afirmația „toate intrările E2a refuză” era falsă (importul și storno-ul E2a nu cheamă poarta). Acum e corectată și acoperită (§3.6, Q-E3b-17).
- **P2:** așteptarea pe `ux_izo_cor_deschisa` separată pe cazuri, plus cursele noi (§4, §9.2); formula exactă a hash-ului din istoric, cazul ciornelor dinainte de E3b închis prin precondiție, diff-ul scanurilor cu `modificate` (§2.3, §5.7); riscul variantelor Q-E3b-1, filtrul pe starea curentă sub A (§6), semnificația lui `p_cerut_de` (§3.4) și Q-E3b-16 (patru ochi pe serie / șarjă / lungimi).

**r1 (21.10.2026).** Sursa: decizia Razvan 21.10 (varianta A, `claude_context` #1819), `E3_PLAN.md` §7b, lista de lipsuri `C:\Users\Public\livrare\izo_gaps.txt` + verificările ei (`izo_raspuns.md`, `izo_anexa.md`, `izo_critic.txt`). Se construiește peste E3 (`20261103b_izometrie_e3_documente`, design `E3_CONFIRMA_DESIGN.md` r5e) și peste E2a (`20261102a`), cu **același tipar**: rol scriitor separat, contextul operației în gardă, poarta completă sub lock-ul „schemă”, proiecții exacte, registru doar-adaug, motiv obligatoriu.

**Ordinea (neschimbată din E3_PLAN §7b):** design E3b → review Copilot + Jakarinos → migrare + harness → aplicare (chat-ul, după „da”-ul lui Razvan) → abia apoi prima recepție reală pe LOT 2.

**Faptele live (citire read-only, 21.10):**
- E3 **nu e aplicat** pe prod (nu există `izo_documente_intrare` și nici rolurile E3); E3b se aplică după E3, deci ambele sunt încă pe branch;
- proiectul 3 (LOT 2) e la nivelul `stoc`, cu un singur import (`sold-initial-lot2-v1`, `aplicat`), un eveniment `sold_initial` și 3352 de mișcări `nascut`;
- cele 3352 de bucăți: 1884 `receptionat`, 1466 `pe_tronson`, 2 `carantina`, 0 `sosit`;
- atribuirile active: 3 `gestionar`, 2 `inginer_izometrie`, 1 `manager_aprobator`.

**Notă de implementare (22.10.2026):** migrarea se numește `20261106a_izometrie_e3b_corectii` (numele `20261104a` / `20261105a` au fost luate pe main de Ofertare / E9). Matricea Q-E3b-1 × Q-E3b-17 se implementează doar pe celula aleasă (Q1 = A, Q17 = A, Q14 = A, Q16 = A, #1823); celelalte celule din §6 / §7 / §9.18 nu se construiesc.

## 0. Ce face E3b (și ce nu)

**Face (cele șase corecții din #1819):**
1. **corecția de câmp** pe o bucată din registru: eveniment `corectie` + mișcare `corectat`, cu `inainte` / `dupa` și motiv; o face doar responsabilul (§5.1; pe câmpurile de identitate, patru ochi dacă Q-E3b-16 = A);
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
| `fn_izo_cor_propune` | `p_tip text, p_proiect bigint, p_bucata_id bigint, p_detalii jsonb, p_motiv text` | `{corectie_id, versiune, stare: 'propusa', inainte, dupa}` | gestionarul depozitului bucății sau responsabilul (§3.4) | `izo_cor_editor` |
| `fn_izo_cor_retrage` | `p_corectie_id bigint, p_versiune bigint, p_motiv text` | `{corectie_id, versiune, stare: 'retrasa'}` | doar propunătorul (sau owner) | `izo_cor_editor` |
| `fn_izo_cor_respinge` | `p_corectie_id bigint, p_versiune bigint, p_motiv text` | `{corectie_id, versiune, stare: 'respinsa'}` | responsabilul, ≠ propunătorul | `izo_cor_editor` |
| `fn_izo_cor_verifica` (doar citire) | `p_corectie_id bigint, p_tip text, p_proiect bigint, p_bucata_id bigint, p_detalii jsonb` (fie id-ul, fie celelalte patru) | `{ok, blocante[], avertismente[], inainte, dupa_efectiv, versiune}`; coliziunile doar din proiectele citite de apelant (§5.6) | cine citește proiectul (`fn_izo_citire`) | `izo_cor_editor` |
| `fn_izo_cor_aproba` | `p_corectie_id bigint, p_versiune bigint` | `{corectie_id, eveniment_id, bucata_id, stare_dupa, versiune, idempotent}` | responsabilul, ≠ propunătorul | `izo_corectie_writer` |
| `fn_izo_cor_camp` | `p_bucata_id bigint, p_server_ver bigint, p_dupa jsonb, p_motiv text` | `{corectie_id, eveniment_id, inainte, dupa, server_ver}` | responsabilul | `izo_corectie_writer` |
| `fn_izo_cor_pv` | `p_doc_id bigint, p_versiune bigint, p_pv_nr text, p_pv_data date, p_motiv text` | `{corectie_id, eveniment_id, document_id, versiune}` | responsabilul | `izo_corectie_writer` |
| `fn_izo_doc_salveaza` (E3, **înlocuită**) | neschimbate | ca în E3 + `istoric_versiune` | neschimbat (gestionarul) | `izo_doc_editor` |

`p_tip` la propunere ∈ {`carantina_intrare`, `carantina_iesire`, `pierdut`, `gasit_recuperare`, `gasit_nou`}, plus `camp` pe câmpurile de identitate dacă Q-E3b-16 = A (§5.1). `fn_izo_cor_verifica` are **o singură semnătură**, fără overload-uri: o semnătură înseamnă o singură intrare în amprentă și în ACL. Exact unul dintre moduri e nenul, altfel 22023.

**`p_proiect` e obligatoriu pe propunere și pe verificare, pentru toate tipurile (r2):**
- pe o bucată existentă trebuie să fie proiectul bucății, altfel refuz generic („bucata nu există sau nu ai acces”);
- la `gasit_nou` e singura sursă a proiectului. Depozitul nu identifică proiectul (un depozit servește toate proiectele de pe site), iar documentul de referință e opțional.

**Lista albă `p_detalii`, pe tip** (aceeași constantă în RPC și în `fn_izo_cor_garda`, §3.3; orice altă cheie, inclusiv cele din `D`, → 22023):

| `p_tip` | `p_bucata_id` | Chei obligatorii | Chei opționale |
|---|---|---|---|
| `carantina_intrare` | NOT NULL | `ncr_ref` | — |
| `carantina_iesire` | NOT NULL | `ncr_ref` | `stare` ∈ {`sosit`, `receptionat`}: obligatorie pe ramura „născută în carantină din import / `gasit_nou`” (§5.2), interzisă pe celelalte |
| `pierdut` | NOT NULL | `cauza` ∈ {`lipsa_la_receptie`, `disparuta`} | — |
| `gasit_recuperare` | NOT NULL | — | `depozit_id` (interzisă dacă locul de dinainte era un tronson) |
| `gasit_nou` | NULL | `tip_cod` ∈ {`teava`, `curba`}, `depozit_id`, `serie`, `sarja`, `perete_mm`; țeava: `lungime_aviz_mm` și / sau `lungime_masurata_mm`; curba: `unghi_curba` | restul din `L(tip_cod)` (§2.5), `document_intrare_id` |
| `camp` (r3; doar sub Q-E3b-16 = A) | NOT NULL | cel puțin o cheie din `L_ident ∩ L(tip_cod)` (§5.1) | celelalte chei din `L_ident ∩ L(tip_cod)` |

Cheia `tip` din exemplul r1 devine `tip_cod`, ca să nu se confunde cu `p_tip`. La `gasit_nou`, `tip_material_id` = `fn_izo_tip_material(tip_cod)`, ca în E3 (`fn_izo_doc_bucata_asteptata`).

**Propunerea `camp` (r3):**
- cheile corecției stau **direct** în `p_detalii` (forma `{dupa: …}` din r2 dispare), cu valorile noi;
- o cerere mixtă (o cheie din `L_ident` și una din `L \ L_ident`) → 22023 „trimite separat: câmpurile de identitate prin propunere, restul direct”;
- o cheie din `D` sau din afara `L(tip_cod)` → 22023, ca la corecția directă.

**Ce rămâne exclusiv `postgres`** (N3, ca storno-ul E2a):
- `fn_izo_cor_storno_import(p_proiect bigint, p_import_id text, p_bucati bigint[], p_motiv text, p_cerut_de uuid) → {corectie_id, eveniment_id, bucati_anulate}`: owner `izo_corectie_writer`, EXECUTE doar `postgres`, cere `session_user = 'postgres'`; se rulează doar cu „da”-ul lui Razvan (Q-E3b-11).
- `p_cerut_de` = profilul omului care a cerut storno-ul (obligatoriu). Ajunge în `magazie_bucati_evenimente.declarat_de` (coloană E2a existentă, azi NULL), deci auditul are un om, nu doar `aplicat_rol = postgres`.
- **Ce dovedește `p_cerut_de` și ce nu (r2):** doar că profilul numit e eligibil (owner sau responsabil pe proiect, la momentul apelului). Nu dovedește că omul a cerut sau a fost de acord: uid-ul îl scrie sesiunea `postgres`, nu vine dintr-un JWT al lui. Acordul stă în afara BD (cererea scrisă + „da”-ul lui Razvan, notate în motiv / handoff). Auditul trebuie citit așa: „declarat de X”, nu „semnat de X”.

**Numele storno-ului parțial nu e întâmplător.** Poarta E2a caută wrapper-e cu expresia `fn_izo_(seteaza_nivel|import_sold_initial|import_storno|activeaza_si_importa)`, neancorată la dreapta, în `prosrc`-ul oricărei funcții cu alt owner decât `izo_registru_writer`. Un nume ca `fn_izo_import_storno_partial` ar declanșa ea însăși poarta: în corpul oricărei funcții care îl numește (inclusiv poarta E3b) ar apărea „wrapper nerevizuit”. De aici `fn_izo_cor_storno_import`.
- **Regula de cod:** niciun corp E3b nu numește cele patru funcții E2a, nici măcar în comentarii (`prosrc` include comentariile).
- Testul 13 o dovedește.

## 2. Schema nouă (migrarea `20261106a_izometrie_e3b_corectii`; 20261102a / 20261103b NU se modifică ca fișiere)

### 2.1 `izo_corectii` — „documentul” fiecărei corecții

Fiecare operație E3b (și cele directe) scrie exact un rând. El e legătura dintre om, decizie și registru, exact cum e documentul de intrare în E3. **Rândul se scrie abia după lock-ul pe bucată** (§4, regula FK): FK-ul `bucata_id` ia implicit KEY SHARE pe rândul bucății.
- `id` (IDENTITY), `proiect_id` (NOT NULL, FK RESTRICT; = `p_proiect`);
- `tip` ∈ {`camp`, `carantina_intrare`, `carantina_iesire`, `pierdut`, `gasit_recuperare`, `gasit_nou`, `pv`, `storno_import`};
- ținta:
  - `bucata_id` (FK RESTRICT): NOT NULL pentru `camp` / `carantina_*` / `pierdut` / `gasit_recuperare`; la `gasit_nou` NULL cât e `propusa` și NOT NULL după aplicare (bucata nouă, cu id-ul rezervat în context, §3.2); NULL la `pv` / `storno_import`;
  - `document_intrare_id` (FK RESTRICT): NOT NULL doar la `pv`; opțional la `gasit_nou` (referință, nu legătură de registru); NULL în rest;
  - `import_id` (text): NOT NULL doar la `storno_import`;
- conținutul:
  - `inainte` (jsonb, NOT NULL): instantaneul calculat de trigger (§3.3); apelantul trimite NULL. La `gasit_nou` e `'{}'` (bucata nu există încă). La `camp` conține și `server_ver`-ul bucății (r3), pe care aprobarea propunerii îl compară;
  - `dupa` (jsonb): valorile cerute, validate pe lista albă și **normalizate de trigger** (la `camp`, `pv`, `gasit_nou`, `carantina_iesire`, `gasit_recuperare`). Niciun rol nu are UPDATE pe `inainte` / `dupa`;
  - `ncr_ref` (text 1–80): NOT NULL doar la `carantina_*`;
  - `motiv` (text 3–1000, NOT NULL);
- decizia:
  - `stare` ∈ {`propusa`, `aplicata`, `respinsa`, `retrasa`}, `versiune` (bigint ≥ 1, +1 la fiecare scriere);
  - `cale` ∈ {`propunere`, `direct`} (r3), NOT NULL, scrisă de trigger din `current_user` la INSERT (`izo_cor_editor` → `propunere`, `izo_corectie_writer` → `direct`) și imutabilă. Pe ea se sprijină patru ochi în trigger (§3.3), independent de RPC. CHECK: `direct` ⇒ `tip` ∈ {`camp`, `pv`, `storno_import`}; `propunere` ⇒ `tip` ∉ {`pv`, `storno_import`};
  - `propus_de` (uuid NOT NULL; la `storno_import` = `p_cerut_de`), `propus_rol` (`session_user`), `propus_la`;
  - `decis_de` (uuid; NULL la `storno_import`), `decis_rol`, `decis_la`, `motiv_decizie`;
  - `eveniment_id` (FK UNIQUE → `magazie_bucati_evenimente`);
- CHECK-uri de coerență: forma pe tip (lista de mai sus), `aplicata` ⇔ (`eveniment_id`, `decis_la`) NOT NULL; `respinsa` / `retrasa` ⇒ `motiv_decizie` NOT NULL și `eveniment_id` NULL; `propusa` ⇒ toate coloanele `decis_*` NULL;
- **`ux_izo_cor_deschisa` UNIQUE (`bucata_id`) WHERE `stare = 'propusa' AND bucata_id IS NOT NULL`**: cel mult o corecție deschisă pe bucată. Corecțiile directe trec și ele prin `propusa` (în aceeași tranzacție), deci indexul e arbitrul final între o corecție directă și o propunere deschisă. Ordinea reală o dă lock-ul pe bucată, luat înaintea INSERT-ului (§4).

### 2.2 `izo_corectii_bucati` — lista storno-ului parțial

`corectie_id` (FK), `bucata_id` (FK), PK (`corectie_id`, `bucata_id`), index pe `bucata_id`. Se scrie doar pentru `tip = 'storno_import'`, cât corecția e `propusa`, **după ce toată lista e blocată `FOR UPDATE`** (§4); după aceea e imutabilă.

### 2.3 `izo_documente_istoric` — istoricul ciornei

- `id`, `document_id` (FK RESTRICT), `versiune` (= versiunea documentului după salvare), UNIQUE (`document_id`, `versiune`);
- `salvat_de` (uuid NOT NULL), `salvat_rol`, `salvat_la`;
- `continut` (jsonb NOT NULL): **exact obiectul canonic din care se calculează hash-ul `e3-doc-v1`** (antet, aviz, listă, totaluri, rânduri ordonate după `nr_crt`, manifestul ordonat după `cale`), construit de `fn_izo_doc_instantaneu(doc)`:
  - e același `jsonb_build_object(...)` ca în `fn_izo_doc_hash` (20261103b, liniile 352–376), cu **aceeași normalizare numerică**: `round(total_m, 3)::text`; `round(…, 1)::text` pe `total_kg`, `total_net_kg`, `total_brut_kg`, `perete_mm`, `greutate_kg`, `unghi_doc`, `unghi_masurat`, `net_kg`, `brut_kg`; întregii (`diametru_mm`, lungimile, `cantitate`, `total_bucati`, `total_pachete`) ca numere; cheia `v = 'e3-doc-v1'`;
  - ambele funcții se generează din același șablon (`e3_gen`), iar o postcondiție compară textual corpul obiectului din cele două funcții;
- `hash` (text): **formula exactă** `'e3-doc-v1:' || encode(sha256(convert_to(continut::text, 'UTF8')), 'hex')`, cu invariantul `hash = fn_izo_doc_hash(doc)` la acea versiune. `continut` e stocat ca jsonb, deci `continut::text` e textul canonic jsonb, identic cu cel calculat în `fn_izo_doc_hash`;
- `diff` (jsonb NOT NULL), calculat de `fn_izo_doc_diff(anterior, curent)` pe valorile deja normalizate din `continut`:
  - antet: `{cheie: [vechi, nou]}`;
  - rânduri, cheiate pe `nr_crt`: `adaugate`, `sterse`, `modificate: {nr_crt: {camp: [vechi, nou]}}`;
  - scanuri, cheiate pe `cale`: `adaugate`, `scoase` și **`modificate: {cale: {camp: [vechi, nou]}}`** pe `sha256_original` / `sha256_pdf` / `marime` / `mime`. Salvarea E3 înlocuiește integral manifestul (20261103b, liniile 1380–1383), deci aceeași cale poate reveni cu alte metadate;
- `baza` (boolean): true la prima intrare a documentului, adică la crearea lui (prima salvare); atunci `diff` = tot conținutul, ca „adăugat”. Recalculat de trigger ca „nu există nicio intrare anterioară”.

**Ciornele dinainte de E3b (r2):** precondiția migrării cere **zero documente în `draft`** (§2.6). Pe prod e adevărat azi: E3 nu e aplicat. Deci orice document care ajunge la confirmare după E3b a fost creat după E3b și are o intrare `baza`. Cazul „ciornă veche, confirmată fără o salvare nouă” nu poate apărea. Varianta „intrare de bază scrisă la confirmare” a fost cântărită și lăsată deoparte: ar înlocui `fn_izo_doc_confirma` și ar da `izo_receptie_writer` INSERT pe istoric, adică suprafață nouă pentru un caz pe care precondiția îl exclude. Documentele confirmate / anulate înainte de E3b (doar pe branch) n-au istoric, iar UI-ul arată „fără istoric (anterior E3b)”.

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
| `camp` | `corectie` | `corectat`, stările NULL | — (direct); sub Q-E3b-16 = A, câmpurile de identitate: gestionar / responsabil | responsabilul (≠ propunătorul, la propunere) |
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
- **md5-ul corpurilor înlocuite** = forma lor din 20261103b: `fn_izo_garda_bucati`, `fn_izo_garda_fapte`, `fn_izo_doc_garda`, `fn_izo_porti_lipsa`, `fn_izo_doc_salveaza`. Sub Q-E3b-1 = A, în plus: `fn_izo_import_storno` (forma 20261102a), `fn_izo_doc_anuleaza`, `fn_izo_garda_receptie`. Sub C, doar `fn_izo_import_storno`. Sub Q-E3b-17 = A (r3), în plus `fn_izo_import_sold_initial` și, dacă Q-E3b-1 = B, `fn_izo_import_storno` (forma 20261102a, doar prologul, §3.6). Definițiile vechi se salvează pentru revenire. Migrarea se generează peste textul FINAL al 20261103b, deci o rundă nouă de review pe E3 = md5-uri regenerate;
- mulțimile de coloane = `C` / `_ev` / `_mis` (neschimbate) și textul CHECK-ului tipurilor = forma E3;
- **textul `magazie_bucati_sursa_receptie_check`** = forma live (`packing_list`, `aviz`, `mtc`, `manual`). E3b nu-l extinde (bucata găsită folosește `manual`, §5.3), dar se sprijină pe el;
- **zero documente `draft`** în `izo_documente_intrare` (istoricul ciornei, §2.3).

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

`izo_doc_editor` (E3) primește în plus doar INSERT pe `izo_documente_istoric`. `izo_registru_writer` și `izo_receptie_writer` nu primesc nimic nou, cu excepțiile condiționate din matricea §6 (r4): EXECUTE pe `fn_izo_lant_blocant` și `fn_izo_cor_deschise`, doar pentru writerul care deține o funcție înlocuită care le cheamă (`izo_registru_writer` sub Q-E3b-1 = A / C, `izo_receptie_writer` sub A).

**Postcondiția pe roluri** = cea din E3 §3.1, pe ambele roluri:
- `NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`;
- `postgres` membru (SET TRUE, INHERIT FALSE), rândul ADMIN automat al creatorului nesuperuser acceptat, nimic altceva;
- niciun rol API nu le poate prelua.

Migrarea și revenirea se rulează pe branch-ul PG17 cu `postgres` nesuperuser.

### 3.2 Garda: contextul operației, al treilea termen în `v_aut` (același tipar ca E3 §3.2)

**Contextul E3b.** GUC-ul `izo.corectie_ctx` = `<txid>|<op>|<corectie_id>|<proiect_id>|<versiunea corecției la intrare>|<bucata_noua_id>`, cu `op` = `izo_corectii.tip`. Diferența față de E3: **nu există argument liber**. Tot ce așteaptă garda (valorile noi, ținta, NCR-ul, lista de bucăți) se citește din rândul corecției, blocat `FOR UPDATE` de intrare și validat de `fn_izo_cor_garda` la INSERT (§3.3).
- `bucata_noua_id` e nevid **doar la `op = gasit_nou`**: id-ul îl rezervă `fn_izo_cor_marcheaza` însăși (`nextval('magazie_bucati_id_seq')`), nu apelantul. Așa garda știe dinainte exact ce bucată se naște pentru corecția asta (ramura `nascut`, §3.3). La celelalte operații câmpul e gol, iar garda refuză un context `gasit_nou` fără el sau unul de alt tip cu el.
- Contextul îl scrie DOAR `fn_izo_cor_marcheaza` (owner `izo_corectie_writer`, INVOKER, EXECUTE doar owner-ul), chemată după toate validările (§4 pasul 11).
- Fiecare intrare E3b refuză la început dacă `izo.receptie_ctx` sau `izo.corectie_ctx` nu e gol, ori dacă `izo.registru_tx` = txid-ul curent.

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
| INSERT mișcare | `eveniment_id` = evenimentul corecției (identificat prin index, nu prin FK-ul corecției, scris la final); nicio altă mișcare a aceluiași eveniment pe aceeași bucată; proiecția pe `fn_izo_coloane_mis()` = `fn_izo_cor_miscare_asteptata(corectie, bucata)`, calculată din rândul CURENT al bucății (mișcarea se scrie înaintea UPDATE-ului). Ținta, pe ramuri: **(a)** `op` cu bucată existentă → bucata = `corectie.bucata_id`; **(b)** `storno_import` → bucata ∈ `izo_corectii_bucati` ale corecției; **(c) ramura `nascut`** (`op = gasit_nou`, singura cu `rol = 'nascut'`) → bucata = `ctx.bucata_noua_id`, deja inserată în acest context (rândul există, cu `atribute->>'corectie_id' = corectie_id` și `atribute->>'sursa' = 'e3b'`), exact o mișcare. `corectie.bucata_id` e încă NULL aici, deci ținta vine din context, nu din corecție |
| UPDATE bucată | există deja mișcarea corecției pe bucată; proiecția pe `C` a lui `NEW` = proiecția pe `C` a `fn_izo_cor_bucata_dupa(corectie, OLD)`; `NEW.server_ver` NOT NULL și ≠ `OLD.server_ver`. Coloanele generate nu se citesc din `NEW` (E3 §3.2); seria canonică se calculează explicit (`fn_izo_canon_serie`). La `gasit_nou`, niciun UPDATE pe bucată |
| INSERT bucată | doar `op = gasit_nou`: `NEW.id = ctx.bucata_noua_id`; evenimentul corecției deja scris și **nicio mișcare `nascut` pe el** (o singură bucată per corecție); proiecția pe `C` = `fn_izo_cor_bucata_noua(corectie)` (ca `fn_izo_doc_bucata_asteptata` din E3, din `corectie.dupa` deja normalizat), `radacina_id = id`, `uid` și `server_ver` NOT NULL |
| UPDATE `izo_documente_intrare` | doar `op = pv`: `OLD.stare = 'confirmat'` și `OLD.eveniment_pv_id` NOT NULL; (`OLD.pv_nr_canon`, `OLD.pv_data`, `OLD.versiune`) = `corectie.inainte`; NEW = `corectie.dupa` pe `pv_nr` / `pv_nr_canon` / `pv_data`; `versiune = OLD + 1`; orice altă coloană (fără cele generate) identică; evenimentul corecției deja scris |
| UPDATE `izo_corectii` | `propusa` → `aplicata`; doar `stare`, `versiune` (context + 1), `decis_de = fn_izo_uid()`, `decis_rol = session_user`, `decis_la`, `eveniment_id` = **exact** evenimentul corecției și, doar la `gasit_nou`, `bucata_id` NULL → `ctx.bucata_noua_id`, care are mișcarea `nascut` a acestui eveniment |

**`fn_izo_cor_bucata_dupa(corectie, OLD)`** = `to_jsonb(jsonb_populate_record(OLD, delta))`. Rândul vechi se suprapune cu delta, normalizată prin tipul `magazie_bucati` (aceleași formate numerice ca la proiecția E3). Delta, pe operație:
- `camp`: `corectie.dupa`, așa cum l-a validat și normalizat trigger-ul la INSERT (cu derivatele `D` incluse), nu valoarea cerută de RPC;
- `carantina_intrare`: `{stare: 'carantina'}`;
- `carantina_iesire`: `{stare: Y}`, cu Y din `fn_izo_cor_tinta_iesire(bucata)` (§5.2), egal cu `corectie.dupa.stare`;
- `pierdut`: `{stare: 'pierduta'}`;
- `gasit_recuperare`: `{stare: Y, depozit_id: dest}`; la tronson, doar `{stare: Y}`;
- `storno_import`: `{stare: 'anulata'}`.

Ce nu e în delta trebuie să rămână identic: proiecția acoperă tot `C`, deci și coloanele „interzise”.

**Scrierile dinaintea marcajului** (rândul `izo_corectii` la corecțiile directe și lista `izo_corectii_bucati`) nu trec prin context. Le verifică `fn_izo_cor_garda` (BEFORE INSERT / UPDATE, ENABLE ALWAYS). **Trigger-ul e sursa specificației, nu scriitorul (r2):** altfel garda de mai sus ar compara faptele cu o specificație scrisă de același rol care scrie și faptele.

La INSERT, pentru ambele roluri:
1. forma pe tip (§2.1), `stare = 'propusa'`, `versiune = 1`, `decis_*` / `eveniment_id` NULL; `inainte` vine NULL de la apelant (altfel 22023);
2. **lista albă pe tip** (cea din §1 pentru propuneri; pentru cele directe: `camp` → chei ⊆ `fn_izo_coloane_corectabile(tip_cod al bucății)`, fără `D`, nevid; `pv` → exact {`pv_nr`, `pv_data`}; `storno_import` → `dupa` NULL). Orice altă cheie → 22023. **`camp` pe cale (r3), sub Q-E3b-16 = A:** `direct` (`izo_corectie_writer`) → chei ⊆ `L(tip_cod) \ L_ident`; `propunere` (`izo_cor_editor`) → chei ⊆ `L(tip_cod) ∩ L_ident`; o cerere mixtă → 22023. Sub Q-E3b-16 = B, `camp` există doar pe `direct`, cu toate cheile din `L`. Constanta `L_ident` e generată din aceeași sursă ca `L` (§2.5), deci restricția nu depinde de corpul `fn_izo_cor_camp`;
3. **validarea pe valoare** (§2.5, §5.2–5.4) și **normalizarea**: `NEW.dupa` se rescrie cu forma normalizată (prin `jsonb_populate_record` pe tipul tabelului țintă), plus derivatele `D` recalculate (`camp`) sau `pv_nr_canon` calculat (`pv`). O valoare egală cu cea curentă → 22023 „nimic de corectat”;
4. **`NEW.inainte` recalculat** din rândul curent (bucata, deja blocată de RPC, §4; documentul la `pv`; importul la `storno_import`) prin `fn_izo_cor_inainte`. La `gasit_nou`: `'{}'`. La `camp` (ambele căi): proiecția pe K plus `server_ver`;
5. identitatea: `propus_de = fn_izo_uid()`; la `storno_import`, `session_user = 'postgres'`, `fn_izo_uid()` NULL și `propus_de` nenul. Autorizarea **nu** se reia în trigger: helper-ele §3.4 iau lock-uri pe profil / atribuiri, iar la pasul 10 ar veni după bucăți, contra ordinii din §4. Dreptul rămâne verificat o dată, la pasul 3, sub lock-urile care țin până la commit;
6. **`NEW.cale`** (r3) scrisă din `current_user`; o valoare de la apelant care diferă → 22023.

La UPDATE, pentru ambele roluri (r3, **patru ochi în trigger**, independent de RPC):
- `cale`, `tip`, `proiect_id`, `inainte`, `dupa`, `propus_*`, `ncr_ref`, `motiv`, `document_intrare_id`, `import_id` identice (`bucata_id` doar NULL → id la `gasit_nou`, prin ramura de context);
- `cale = 'propunere'`, trecerea în `aplicata` / `respinsa`: `NEW.decis_de` NOT NULL, `= fn_izo_uid()` și **`IS DISTINCT FROM OLD.propus_de`**, inclusiv pentru owner (Q-E3b-3 = A);
- `cale = 'propunere'`, trecerea în `retrasa`: `NEW.decis_de = fn_izo_uid()`. Regula „doar propunătorul sau owner-ul” rămâne în RPC: retragerea nu atinge registrul;
- `cale = 'direct'`, trecerea în `aplicata`: `decis_de = propus_de = fn_izo_uid()` (la `storno_import`, ambele `decis_de` / `fn_izo_uid()` NULL); `respinsa` / `retrasa` interzise.

**RPC-ul aplică exact ce întoarce trigger-ul:** `INSERT … RETURNING id, inainte, dupa`. Evenimentul, mișcarea și UPDATE-ul se construiesc din valorile întoarse, iar garda le compară cu rândul stocat. Niciun rol nu are UPDATE pe `inainte` / `dupa` (§3.5).

Pe roluri:
- `izo_cor_editor`: INSERT doar pentru tipurile propunerii (§1; `camp` doar sub Q-E3b-16 = A); UPDATE doar `propusa` → `respinsa` / `retrasa`, pe coloanele deciziei, `versiune + 1`;
- `izo_corectie_writer`: INSERT doar pentru `tip` ∈ {`camp`, `pv`, `storno_import`}; INSERT în `izo_corectii_bucati` doar pe o corecție `storno_import` `propusa`, cu bucata născută din evenimentul importului (mișcarea `nascut` pe `izo_importuri.eveniment_id`, același proiect), `stare <> 'anulata'` și fără propunere deschisă; UPDATE doar prin ramura de context de mai sus;
- oricine altcineva, DELETE, UPDATE după `aplicata` / `respinsa` / `retrasa` → 42501.

Golul acoperit e de apărare în adâncime, nu o escaladare dovedită prin API: RPC-ul validează oricum `p_dupa`. Trigger-ul face ca validarea să nu depindă de corpul RPC-ului.

### 3.4 Autorizarea: `fn_izo_cor_autorizare_lock(p_proiect bigint, p_rol text, p_depozit integer)`

Owner `postgres`, DEFINER, neexpusă (EXECUTE doar `izo_cor_editor`, `izo_corectie_writer`); aceeași tehnică ca `fn_izo_doc_autorizare_lock` din E3 §3.4: condiția de drept stă în `WHERE`-ul interogării cu `FOR SHARE`, deci reevaluare EPQ.
1. `profiles` (`id = auth.uid()`) `FOR SHARE`; `is_owner` → true;
2. `user_module_access` (`magazie`, `editor` / `admin`) `FOR SHARE` (Q-E3b-12);
3. `izo_atribuiri` active și valabile azi, `FOR SHARE`:
   - `p_rol = 'responsabil'` → `rol IN ('manager_aprobator', 'inlocuitor_aprobator')` pe proiect, `depozit_id` NULL (Q-E3b-2). Toate rândurile potrivite se blochează, **`ORDER BY id`** (r3): revocarea unuia, cât altul rămâne activ, nu schimbă dreptul;
   - `p_rol = 'gestionar'` → rândul exact (`proiect`, `profil`, `gestionar`, `p_depozit`), ca în E3.

**Ordinea pe atribuiri (r3).** `FOR SHARE` e compatibil cu `FOR SHARE`, deci două operații E3b nu se blochează între ele pe atribuiri. Conflictul e doar cu o revocare (UPDATE). O revocare pe un singur rând atinge un singur nivel și nu poate face ciclu. O revocare pe mai multe rânduri, într-o singură tranzacție, într-o ordine diferită de `id`, poate da `deadlock_detected` cu o aprobare care ține deja unul dintre rânduri. Consecința e doar disponibilitatea: PG anulează una dintre tranzacții, fără efecte parțiale. Reîncercarea e un apel nou, care reautorizează de la zero, deci poate fi refuzată dacă revocarea a trecut între timp. Regula de lucru: revocările multiple se fac pe rânduri, în ordinea `id` (UI-ul de atribuiri trimite câte un UPDATE). Testul 2 acoperă cazul.

**Patru ochi (Q-E3b-3):** la `aproba` / `respinge`, `fn_izo_uid() IS DISTINCT FROM corectie.propus_de`, inclusiv pentru owner. Regula e verificată de două ori: în RPC (mesaj clar) și în `fn_izo_cor_garda` la UPDATE (pe `cale = 'propunere'`, §3.3), deci nu depinde de corpul RPC-ului. La `retrage`: `fn_izo_uid() = propus_de` sau owner (doar în RPC).

**Cine propune, pe bucată:**
- în depozit: gestionarul acelui depozit (`depozit_id` al bucății) sau responsabilul;
- pe tronson (1466 de bucăți LOT 2): gestionarul depozitului de origine (`atribute.depozit_origine_id`), dacă există, sau responsabilul (Q-E3b-9);
- `gasit_nou`: gestionarul depozitului-destinație sau responsabilul.

Revocările (modul, atribuire, `is_owner`) se comportă exact ca în E3 §3.4: așteaptă operația în zbor sau o refuză după commit.

**`p_cerut_de` la storno-ul parțial:**
- helper separat, `fn_izo_cor_cerut_de_valid(p_proiect bigint, p_profil uuid) RETURNS boolean` (owner `postgres`, DEFINER, EXECUTE doar `izo_corectie_writer`);
- aceiași pași 1 și 3 (profilul și atribuirea de responsabil), `FOR SHARE`, dar pe uid-ul dat, nu pe `auth.uid()`;
- îl cheamă doar `fn_izo_cor_storno_import` (pasul 3 din §4), după verificarea `session_user = 'postgres'`. Helper-ul cu `auth.uid()` nu primește niciodată un uid din argumente;
- un `true` înseamnă doar „profilul e eligibil”, nu „omul a fost de acord” (§1).

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

`izo_cor_editor` pe tabelele E2a / E3: SELECT pe `magazie_bucati`, evenimente, mișcări (politici `*_coreditor_sel`) și pe `izo_documente_intrare` (referința de la `gasit_nou`). E nevoie de ele pentru instantaneul `inainte`, ținta ieșirii din carantină și coliziunile din `verifica`. Nimic altceva. **Fără UPDATE pe niciuna, deci fără `FOR SHARE` direct** (r3; PG cere UPDATE pe cel puțin o coloană pentru orice `FOR … ` lock): bucata și documentul de referință se blochează doar prin helper-ele DEFINER `fn_izo_cor_bucata_lock` / `fn_izo_cor_doc_lock` (mai jos).

**Secvențe (r3, completată):** `izo_corectie_writer` are USAGE pe:
- `magazie_bucati_id_seq` (`gasit_nou`: id-ul îl rezervă `fn_izo_cor_marcheaza` în context, §3.2, și e și `radacina_id`);
- `izo_server_ver_seq`;
- `magazie_bucati_evenimente_id_seq` și `magazie_bucati_miscari_id_seq` (coloane `serial`, ca la `izo_receptie_writer` în 20261103b, linia 1722; r2 le omitea).

`izo_corectii` / `izo_corectii_bucati` / `izo_documente_istoric` au `id` IDENTITY, deci fără privilegiu pe secvență. Mulțimea USAGE pe secvențe a fiecărui rol E3b intră în poarta `porti_e3b`.

**Helpere** (REVOKE de la PUBLIC / `anon` / `authenticated` / `service_role` pe toate cele interne):

| Funcție | Owner / mod | EXECUTE |
|---|---|---|
| intrările din §1 | rolul din §1, DEFINER | `authenticated` (semnătura exactă); `fn_izo_cor_storno_import`: doar `postgres` |
| `fn_izo_cor_marcheaza` | `izo_corectie_writer`, INVOKER | doar owner-ul |
| `fn_izo_garda_corectie`, `fn_izo_cor_eveniment_asteptat`, `fn_izo_cor_miscare_asteptata`, `fn_izo_cor_bucata_dupa`, `fn_izo_cor_bucata_noua` | `postgres`, INVOKER, STABLE | `izo_corectie_writer` |
| `fn_izo_cor_autorizare_lock` | `postgres`, DEFINER | `izo_cor_editor`, `izo_corectie_writer` |
| `fn_izo_cor_cerut_de_valid` | `postgres`, DEFINER | `izo_corectie_writer` |
| `fn_izo_cor_bucata_lock(p_bucata bigint, p_proiect bigint) → jsonb` (r2; r3: cu proiectul): `SELECT … WHERE id = p_bucata AND proiect_id = p_proiect AND provenienta = 'beneficiar' AND tip_cod IS NOT NULL FOR SHARE`, întoarce rândul comis cel mai nou sau NULL. O bucată din alt proiect nu se blochează și nu se întoarce. DEFINER, pentru că `FOR SHARE` cere UPDATE pe o coloană, iar `izo_cor_editor` n-are nicio scriere în registru. Chemat doar după autorizarea pe `p_proiect` (§4 pasul 3) | `postgres`, DEFINER | `izo_cor_editor` |
| `fn_izo_cor_doc_lock(p_doc bigint, p_proiect bigint) → boolean` (r3): `SELECT 1 … WHERE id = p_doc AND proiect_id = p_proiect AND stare = 'confirmat' FOR SHARE`; `false` pentru orice altceva (inexistent, alt proiect, neconfirmat), iar RPC-ul dă refuzul generic. Îl cheamă doar `fn_izo_cor_propune` (`verifica` nu blochează), la pasul 1 din §4, înaintea autorizării, ca în ordinea globală. Autorizarea pe același `p_proiect` vine la pasul 3; până la ea, un apelant neautorizat poate ține documentul `FOR SHARE` până la refuz. Durata nu e garantat scurtă: dacă autorizarea așteaptă un profil / modul / atribuire blocate de altă tranzacție, documentul rămâne blocat cât durează apelul. **Limita e per apel, nu una absolută (r5):** `lock_timeout` se aplică **fiecărei** achiziții de lock în parte (autorizarea ia mai multe lock-uri, pe profil, modul și atribuiri, deci așteptările se pot aduna), iar `statement_timeout` limitează **instrucțiunea**. Un RPC PostgREST e o singură instrucțiune (`SELECT fn_izo_cor_propune(…)`), deci `statement_timeout` e cel care mărginește tot apelul. Valorile citite pe 21.10 (`authenticator`: `lock_timeout = 8s`, `statement_timeout = 8s`; `authenticated`: `statement_timeout = 8s`) sunt **setări de rol** din `pg_roles.rolconfig`, nu garanții ale designului. Cele efective într-o cerere depind de cum le aplică PostgREST (setările rolului de login pe sesiune, cele ale rolului impersonat pe tranzacție) și pot fi schimbate de o reconfigurare. De aceea: precondiția migrării le recitește din catalog, iar testul 2 le citește **efectiv**, printr-o cerere PostgREST reală (`current_setting('lock_timeout')`, `current_setting('statement_timeout')` în aceeași tranzacție cu propunerea), și măsoară așteptarea maximă a unui PV pe documentul blocat. Efectul e doar de disponibilitate, nu de siguranță: nimic nu se scrie înaintea autorizării. Un PV / o anulare pe acel document așteaptă cel mult cât permit timeout-urile efective ale celor două tranzacții; dacă limita e atinsă, una dintre ele primește 55P03 / 57014, fără efecte parțiale, și se reîncearcă. E același tipar ca E3 (20261103b: documentul blocat, apoi `fn_izo_doc_autorizare_lock`, în `fn_izo_doc_confirma` liniile 1445–1448, `fn_izo_doc_pv` 1538–1540 și helper-ul de scanuri 342–346). Inversarea (autorizarea întâi) ar deschide un ciclu cu PV-ul E3 + o revocare | `postgres`, DEFINER | `izo_cor_editor` |
| `fn_izo_cor_api_verifica` (lock schemă + identitate API + contexte goale + poarta completă). Identitatea API (r5) se verifică exact ca în `fn_izo_doc_api_verifica` (20261103b, liniile 1255–1272): `session_user = 'authenticator'` și `fn_izo_jwt_rol() = 'authenticated'`, apoi `fn_izo_uid()` nenul. Fiind INVOKER, rulează ca owner-ul intrării care o cheamă (`izo_cor_editor` / `izo_corectie_writer`), deci acela are nevoie de EXECUTE pe cele trei funcții chemate (rândul „identitatea API” de mai jos) | `postgres`, INVOKER | `izo_cor_editor`, `izo_corectie_writer` |
| `fn_izo_cor_adm_verifica` (r2; varianta pentru `fn_izo_cor_storno_import`: lock schemă + `session_user = 'postgres'` + contexte goale + poarta completă) | `postgres`, INVOKER | `izo_corectie_writer` |
| `fn_izo_cor_inainte`, `fn_izo_cor_tinta_iesire`, `fn_izo_cor_valideaza` (blocantele), `fn_izo_coloane_corectabile` | `postgres`, INVOKER, STABLE / IMMUTABLE | `izo_cor_editor`, `izo_corectie_writer` |
| `fn_izo_doc_instantaneu`, `fn_izo_doc_diff` | `postgres`, INVOKER, STABLE / IMMUTABLE | `izo_doc_editor` |
| `fn_izo_lant_blocant` (r4: creat în toate variantele, îl folosește storno-ul parțial; §6) | `postgres`, DEFINER, STABLE | `izo_corectie_writer` mereu; `izo_registru_writer` sub Q-E3b-1 = A / C; `izo_receptie_writer` sub A (matricea §6) |
| `fn_izo_cor_deschise(p_bucati bigint[]) RETURNS TABLE (bucata_id, corectie_id, tip)` (r4): propunerile `propusa` pe bucățile date, citire simplă, **fără lock** pe corecții (§4). Există doar sub Q-E3b-1 = A / C | `postgres`, DEFINER, STABLE | `izo_registru_writer` sub A / C; `izo_receptie_writer` sub A |
| **Identitatea API și poarta (r5):** `fn_izo_jwt_rol` (E3), `fn_izo_uid`, `fn_izo_porti_lipsa` (E2a) | neschimbate (toate trei DEFINER) | **GRANT EXECUTE explicit către `izo_cor_editor` și `izo_corectie_writer`**, în migrare: le cheamă `fn_izo_cor_api_verifica` (INVOKER). Azi `fn_izo_jwt_rol` are EXECUTE doar pentru `izo_doc_editor` / `izo_receptie_writer` (20261103b, liniile 1739–1742), iar `fn_izo_uid` / `fn_izo_porti_lipsa` doar pentru `izo_registru_writer` și aceleași două roluri E3 (20261102a, liniile 1352–1355; 20261103b, liniile 1748–1749). Fără acest GRANT, orice intrare E3b ar da `permission denied` la primul pas. `fn_izo_cor_adm_verifica` (storno-ul parțial, `session_user = 'postgres'`) nu cheamă `fn_izo_jwt_rol`, doar `fn_izo_porti_lipsa` (acoperită de același GRANT pentru `izo_corectie_writer`) |
| E3: `fn_izo_proiectie`, `fn_izo_coloane_c/_ev/_mis`, `fn_izo_canon_serie`, `fn_izo_doc_hash` | neschimbate | + rolurile E3b care le cheamă |
| E3: `fn_izo_doc_api_verifica` (r5) | neschimbată | **fără GRANT nou: E3b n-o refolosește.** Intrările E3b au helper-ul propriu, `fn_izo_cor_api_verifica`. Singura funcție atinsă de E3b care o cheamă e `fn_izo_doc_salveaza` înlocuită, cu owner-ul E3 `izo_doc_editor`, care are deja EXECUTE (20261103b, liniile 1739–1742) |
| E2a: `fn_izo_nivel`, `fn_izo_uid`, `fn_izo_porti_lipsa`, `fn_izo_loc_valid`, `fn_izo_citire`, `fn_izo_site_proiect`, `fn_izo_tip_material`, `fn_izo_tip_cod`, `fn_izo_garda_scriitor`, `fn_izo_blocheaza_locuri`, `fn_izo_blocheaza_tabele`, `fn_izo_lock_partajat`, `fn_izo_lock_proiect` | neschimbate | + `izo_corectie_writer` (cele de citire și + `izo_cor_editor`) |

**Apelurile tranzitive**, pe rol, se tabelează ca în E3 §3.5 și se verifică pe catalog (`has_*_privilege`) plus prin rularea fiecărei operații cap-coadă ca rolul real (testul 15). Prin gărzi, `izo_corectie_writer` cheamă: `fn_izo_garda_scriitor`, `fn_izo_garda_corectie`, `fn_izo_nivel`, `fn_izo_tip_cod`, `fn_izo_proiectie`, `fn_izo_coloane_*`, `fn_izo_cor_*_asteptat*`, `fn_izo_canon_serie`. **Prin `fn_izo_cor_api_verifica` (r5), ambele roluri E3b cheamă `fn_izo_jwt_rol`, `fn_izo_uid` și `fn_izo_porti_lipsa`** (GRANT-ul explicit de mai sus); `fn_izo_doc_api_verifica` nu apare în lanțul niciunui rol E3b.

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
- **`fn_izo_porti_lipsa`** (forma E3, md5 la precondiție) se înlocuiește cu o singură linie în plus la final: `v := v || public.fn_izo_porti_e3b_lipsa();`.
- **Cine refuză la o lipsă E3b, exact (r2; r1 pretindea „toate intrările E2a”, fals):**

| Intrare | Cheamă poarta completă? | Sub lock-ul schemei? |
|---|---|---|
| intrările E3b din API (prin `fn_izo_cor_api_verifica`) și `fn_izo_cor_storno_import` (prin `fn_izo_cor_adm_verifica`) | da, înaintea oricărei scrieri | da |
| intrările E3 (prin `fn_izo_doc_api_verifica`, 20261103b liniile 1255–1272, și `fn_izo_doc_anuleaza`) | da: `fn_izo_porti_lipsa` înlocuită include E3b | da |
| `fn_izo_seteaza_nivel(…, 'stoc')` și `fn_izo_activeaza_si_importa` (care o cheamă) | da (20261102a linia 1048, doar la `p_nivel = 'stoc'`) | nu (E2a nu ia lock-ul schemei) |
| `fn_izo_import_sold_initial` chemată singură (importul suplimentar, 20261102a liniile 1077–1147) | sub Q-E3b-17 = A (r3, recomandat): **da**, corpul se înlocuiește (md5 la precondiție) doar cu prologul „lock schemă partajat + poarta completă”, înaintea `fn_izo_lock_proiect`; sub Q-E3b-17 = B: **nu** | sub Q-E3b-17 = A, da |
| `fn_izo_import_storno` (20261102a liniile 1258–1289) | sub Q-E3b-1 = B: da doar dacă Q-E3b-17 = A (atunci corpul primește doar prologul de mai sus), altfel **nu**; sub Q-E3b-1 = A / C, da: corpul e înlocuit oricum (md5 la precondiție), iar înlocuirea începe cu prologul de mai jos (lock-ul schemei fără așteptare + poarta completă), înaintea `fn_izo_lock_proiect` și a oricărei scrieri. Altfel predicatul `fn_izo_lant_blocant` ar citi `izo_corectii` fără să știe dacă politicile / gărzile lor sunt intacte | sub Q-E3b-1 = A / C sau Q-E3b-17 = A, da |

- **Prologul (r3, Q-E3b-17 = A)**, inserat imediat după verificarea `session_user = 'postgres'`, înaintea `fn_izo_lock_proiect` și a oricărei scrieri:
  - lock-ul schemei **fără așteptare**: `IF NOT pg_try_advisory_xact_lock_shared(hashtext('gazpet.livrare_migrare')) THEN RAISE … 55P03 'o migrare rulează; reîncearcă după ea'`. Nu `pg_advisory_xact_lock_shared` ca în `fn_izo_doc_anuleaza` (20261103b, linia 1614): `fn_izo_activeaza_si_importa` cheamă importul **după** `fn_izo_seteaza_nivel`, care ține deja advisory-ul exclusiv al proiectului și lock-urile pe tabele. O așteptare a lock-ului schemei în acel punct ar inversa ordinea globală față de runner-ul de migrări (schemă exclusiv → DDL pe tabele) și ar da `deadlock_detected`. Varianta „try” nu așteaptă niciodată, deci nu poate face ciclu; dacă lock-ul e deja ținut de aceeași tranzacție, PG îl acordă imediat;
  - apoi `fn_izo_porti_lipsa()` gol, altfel 42501.
  Unde funcția primește **doar** prologul (importul sub Q-E3b-17 = A; storno-ul sub Q-E3b-1 = B și Q-E3b-17 = A), restul corpului rămâne byte cu byte: postcondiția compară textual corpul nou fără liniile prologului cu forma 20261102a. Sub Q-E3b-1 = A / C, storno-ul e rescris (§6): acolo se verifică doar md5-ul formei vechi la precondiție, iar corpul nou trece prin review, ca celelalte funcții înlocuite. Owner, semnătură și ACL neschimbate, deci regex-ul „wrapper” nu se aplică (owner `izo_registru_writer`). `fn_izo_activeaza_si_importa` (neînlocuită) cheamă poarta de două ori (~0,4 s fiecare): o dată prin `fn_izo_seteaza_nivel`, o dată prin import. Sub Q-E3b-1 = A / C, storno-ul înlocuit folosește același prolog.
- **Golul rămas, doar sub Q-E3b-17 = B** (importul E2a și, sub Q-E3b-1 = B, storno-ul complet): ambele sunt N3, doar `postgres`, doar cu „da”. Se acoperă prin **procedura de rulare**: chat-ul rulează, în aceeași tranzacție, `pg_advisory_xact_lock_shared(hashtext('gazpet.livrare_migrare'))`, apoi un `DO` care ridică excepție dacă `fn_izo_porti_lipsa()` nu e gol, abia apoi apelul. E limitare declarată (§10), doar sub Q-E3b-17 = B.
- **Amprenta nu validează semantica tranzitivă.** Helperele noi `fn_izo_*` intră în amprenta E2a prin filtrul pe nume (20261102a liniile 383–386: corp, owner, ACL, config), deci orice modificare a lor e prinsă. Amprenta nu verifică însă ce cheamă ele. Lanțul de apeluri se validează prin review și prin testul 15, nu prin poartă. Expresia „wrapper nerevizuit” (20261102a liniile 473–478) e descrisă corect în §1.
- **Recalculate la finalul migrării, după validare:**
  - `porti=` (E2a; acoperă automat toate funcțiile `fn_izo_*`, deci și pe cele E3b și cele înlocuite);
  - `porti_e3=` (se schimbă: privilegii pe coloane și politici noi pe tabelele pe care le inventariază);
  - `porti_e3b=`;
  - amprenta de revenire E2a, cu valoarea de dinainte păstrată în comentariu (`inainte_20261106a=…`), ca la E3.
- **Închiderea citirilor:** toate funcțiile E3b sunt `fn_izo_*`, deci în afara corpurilor scanate și în amprenta E2a (corp, owner, ACL, config). Nu apar view-uri. **DEFINER-ele care citesc registrul / documentele, complet (r3; r2 spunea, greșit, „doar `fn_izo_lant_blocant`”):**
  - intrările din §1 (owner `izo_cor_editor` / `izo_corectie_writer`, NOLOGIN): citesc doar după autorizarea pe proiect, iar ce întorc e filtrat pe proiectul autorizat (coliziunile, §5.6);
  - `fn_izo_cor_bucata_lock`, `fn_izo_cor_doc_lock` (owner `postgres`, EXECUTE doar `izo_cor_editor`): filtrate pe `p_proiect`, chemate doar din `fn_izo_cor_propune`;
  - `fn_izo_lant_blocant` și `fn_izo_cor_deschise` (EXECUTE doar writerii din celula aleasă a matricei §6);
  - `fn_izo_cor_autorizare_lock`, `fn_izo_cor_cerut_de_valid` citesc doar profilul / modulul / atribuirile, nu registrul.
  Niciuna nu e executabilă de `anon` / `authenticated` / `service_role`, cu excepția intrărilor din §1 (verificat de `porti_e3b`).

## 4. Protocolul de lock (ordine UNICĂ, extinsă din E3 §13.2)

**Ordinea globală:** schemă (partajat) → **document de intrare** → **corecția existentă** → profil → acces modul → atribuire → proiect / depozit → tabele → advisory proiect → **import** → bucăți (după `id`) → **rândurile noi cu FK spre bucăți** → registru.

E3 folosește aceeași ordine fără pașii „corecție” și „import”. E2a (storno-ul complet) folosește sufixul tabele → advisory exclusiv → import → bucăți. O revocare pe un singur rând atinge un singur nivel. Deci nu există ciclu între operațiile E2a / E3 / E3b. Excepția declarată (r4): o revocare pe mai multe atribuiri, într-o tranzacție, în altă ordine decât `id` (§3.4) — doar disponibilitate (40P01, fără efecte parțiale).

**Regula FK (r2, Jakarinos r1 P1).** Un INSERT pe un rând cu FK ia implicit `FOR KEY SHARE` pe rândul referit (trigger-ul RI, după inserarea rândului), iar `KEY SHARE` intră în conflict cu `FOR UPDATE`. În r1, corecțiile directe și lista storno-ului parțial se scriau la pasul 2, înaintea advisory-ului:
- T1 (corecție directă / storno parțial) inserează rândul cu `bucata_id = B` → ține `KEY SHARE` pe B → așteaptă advisory-ul;
- T2 (storno-ul complet E2a sau alt storno parțial: advisory exclusiv, apoi bucățile `FOR UPDATE`, 20261102a liniile 1268–1273) ține advisory-ul și cere B `FOR UPDATE` → așteaptă T1;
- ciclu → `deadlock_detected`.

De aici regula: **niciun INSERT cu FK spre o bucată (`izo_corectii.bucata_id`, `izo_corectii_bucati.bucata_id`, mișcările) înainte ca tranzacția să țină deja bucata**: `FOR UPDATE` după advisory la scriitori, `FOR SHARE` la propunere.
- FK-ul spre documentul de intrare (`izo_corectii.document_intrare_id`) urmează aceeași regulă: documentul se ia explicit la pasul 1, înaintea INSERT-ului.
- FK-ul spre proiect (`executie_proiecte`) nu contează: nimeni nu ia `FOR UPDATE` pe rândul proiectului. Mutarea de site e un UPDATE fără cheie, compatibil cu `KEY SHARE`.
- UPDATE-urile pe `izo_corectii` (decizii) nu schimbă coloanele FK spre bucăți, în afară de `bucata_id` la `gasit_nou`, care țintește bucata născută chiar în tranzacția asta. Deci nu iau `KEY SHARE` pe alte bucăți.

**De ce și propunerea blochează explicit bucata.** În interiorul unui INSERT, ordinea e: trigger-ele BEFORE → rândul și verificarea indexurilor unice (poate aștepta o tranzacție neterminată cu aceeași cheie) → trigger-ele AFTER, inclusiv RI (`KEY SHARE`, poate aștepta un `FOR UPDATE`). Fără lock explicit:
- T1 propune pe B: intrarea în `ux_izo_cor_deschisa` e scrisă, apoi RI așteaptă `KEY SHARE` pe B;
- T2 (`camp` pe B) ține B `FOR UPDATE` și inserează corecția directă → indexul așteaptă T1;
- ciclu.

Cu `fn_izo_cor_bucata_lock` (`FOR SHARE`) înaintea INSERT-ului, T1 așteaptă T2, sau invers, înainte să scrie ceva în index. Același lucru pentru documentul de referință al lui `gasit_nou` (`fn_izo_cor_doc_lock`): FK-ul `document_intrare_id` ar lua altfel `KEY SHARE` pe document abia la INSERT, după atribuiri, contra ordinii globale.

| Pas | `propune` | `retrage` / `respinge` | `aproba` (stări, găsit) | `camp` | `pv` | `storno_import` |
|---|---|---|---|---|---|---|
| 0. schemă `pg_advisory_xact_lock_shared(hashtext('gazpet.livrare_migrare'))` + poarta completă, instrucțiune separată | da | da | da | da | da | da (`fn_izo_cor_adm_verifica`) |
| 1. document de intrare | doar `gasit_nou` cu `document_intrare_id`: `FOR SHARE` prin `fn_izo_cor_doc_lock(doc, p_proiect)` (r3; editorul n-are UPDATE pe documente) | — | `FOR SHARE`, dacă bucata are `aviz_intrare_id` (coloană imutabilă, citită fără lock) sau dacă `gasit_nou` are referință | — | `FOR UPDATE` | — |
| 2. corecția existentă `FOR UPDATE` | — | da | da | — | — | — |
| 3. autorizarea (§3.4) | gestionar / responsabil | propunătorul (sau owner) / responsabil ≠ propunătorul | responsabil ≠ propunătorul | responsabil | responsabil | `p_cerut_de`: `fn_izo_cor_cerut_de_valid` (profilul + atribuirea `FOR SHARE`) |
| 4. `fn_izo_blocheaza_locuri` | — | — | doar `gasit_*`: proiectul + depozitul-destinație `FOR SHARE`, apoi `fn_izo_loc_valid` | — | — | — |
| 5. `fn_izo_blocheaza_tabele` | — | — | da | da | da | da (prin `fn_izo_lock_proiect`) |
| 6. advisory `(73010, proiect)` | — | — | partajat | partajat | partajat | **exclusiv** (ca storno-ul E2a) |
| 7. import | — | — | — | — | — | citit (`stare = 'aplicat'`), stabil sub advisory-ul exclusiv: doar `fn_izo_import_storno` îl schimbă și ia același exclusiv |
| 8. bucăți | bucata `FOR SHARE` (`fn_izo_cor_bucata_lock(bucata, p_proiect)`; nu la `gasit_nou`) | — | bucata `FOR UPDATE` (nu la `gasit_nou`) | bucata `FOR UPDATE` | — | lista `FOR UPDATE`, după `id` |
| 9. revalidarea pe rândurile blocate, apoi verificările de business, fără scrieri | eligibilitatea + regula operației (§5.6) | `propusa` + CAS | §5 | §5 + „nicio propunere deschisă pe bucată” | §5 | §5 + „nicio propunere deschisă” pe toată lista |
| 10. **rândurile noi cu FK** (validate și normalizate de `fn_izo_cor_garda`, §3.3) | INSERT corecția `propusa` (ultima scriere) | — | — | INSERT corecția | INSERT corecția | INSERT corecția + `izo_corectii_bucati` |
| 11. `fn_izo_cor_marcheaza`, apoi doar DML static | — | UPDATE-ul deciziei (fără marcaj; nimic în registru) | da | da | da | da |

**De ce nu apare ciclu, pe cazuri:**
- PV-ul E3 ține documentul `FOR UPDATE` → … → bucățile. Aprobarea E3b pe o bucată a aceluiași document așteaptă la pasul 1 (`FOR SHARE`), înainte de orice alt lock.
- Anularea E3 ia documentul `FOR UPDATE`, apoi advisory-ul exclusiv, apoi bucățile. O aprobare E3b pe o bucată a aceluiași document ia documentul `FOR SHARE` la pasul 1, deci cele două se serializează pe document, înaintea oricărui alt lock: dacă aprobarea a luat documentul întâi, anularea îi așteaptă commit-ul și vede faptul E3b (§6); altfel aprobarea așteaptă anularea și revalidează pe bucata `anulata` → refuz. O aprobare pe o bucată fără document (import) nu atinge documentul, iar cu anularea nu are bucăți comune.
- Storno-ul complet / parțial (exclusiv) ↔ orice scriitor E3b (partajat): serializare pe advisory. Rândurile cu FK se scriu abia după advisory și după bucăți, deci niciun `KEY SHARE` nu e ținut în fața advisory-ului.
- Storno-ul (exclusiv → `FOR UPDATE`) ↔ propunerea (`FOR SHARE` pe bucată, fără advisory): după ce a luat bucata, propunerea nu mai cere nimic din ce ține storno-ul (trigger-ul ei doar citește, iar RI-ul ia `KEY SHARE` pe bucata pe care o ține deja). Cine ia primul bucata trece, iar celălalt așteaptă commit-ul și revalidează: propunerea vede `anulata` → refuz; storno-ul vede propunerea comisă → refuz, cu lista. **Unde e verificarea (r3):** storno-ul parțial o face mereu (§5.5); storno-ul complet și anularea documentului o fac doar când sunt înlocuite (Q-E3b-1 = A / C, §6), cu o citire simplă a `izo_corectii` după `FOR UPDATE` pe bucăți (instrucțiune nouă, deci snapshot nou sub READ COMMITTED). Corecțiile nu se blochează: o propunere în zbor ține bucata `FOR SHARE`, deci e deja așteptată la `FOR UPDATE`. Sub B, storno-ul complet neînlocuit nu vede propunerile; efectul e descris în §6.
- **Corecția directă ↔ propunerea, pe aceeași bucată: cazuri distincte (r2; r1 spunea, greșit, că INSERT-ul așteaptă mereu în index):**
  1. **propunere comisă, neatinsă:** corecția directă o vede la pasul 9 și refuză imediat: 23505 „există o propunere deschisă pe bucată — decide / retrage întâi”. Nu așteaptă nimic; și fără verificare, indexul ar da 23505 tot imediat;
  2. **propunere comisă, cu o aprobare în zbor:** aprobarea ține bucata `FOR UPDATE`, deci corecția directă așteaptă la pasul 8. După commit, CAS-ul pe `server_ver` → 40001 „bucata s-a schimbat, reîncarcă”;
  3. **propunere comisă, cu o retragere / respingere în zbor** (acestea nu iau bucata): corecția directă vede încă `propusa` la pasul 9 și refuză ca la 1. Reîncercarea după commit-ul deciziei trece;
  4. **propunere în zbor** (tranzacție neterminată): ea ține bucata `FOR SHARE`, deci corecția directă așteaptă la pasul 8, nu în index. După commit urmează cazul 1; după rollback, corecția continuă. Invers, dacă bucata a luat-o întâi corecția directă, propunerea așteaptă la pasul 8, apoi revalidează pe rândul nou.
- **Propunere ↔ propunere** pe aceeași bucată: `FOR SHARE` e compatibil cu `FOR SHARE`, deci singura așteptare e în `ux_izo_cor_deschisa`. A doua așteaptă commit-ul primei și primește 23505 „există deja o corecție deschisă pe bucată”, sau trece după rollback-ul ei.
- `camp` ↔ `camp` pe aceeași bucată: a doua așteaptă la `FOR UPDATE`, apoi CAS-ul pe `server_ver` → 40001.
- Unicitatea seriei (corecția seriei ↔ confirmarea E3 / importul suplimentar / `gasit_nou`): indexul e arbitrul. A doua tranzacție primește `unique_violation`, prins și re-ridicat ca 23505 clar, cu rollback total.
- **`gasit_nou` ↔ `gasit_nou` cu aceeași serie:** ambele propuneri pot fi deschise (`bucata_id` NULL, deci în afara `ux_izo_cor_deschisa`), iar `verifica` avertizează. La aprobare, a doua așteaptă în indexul seriei commit-ul primei și primește 23505.

**Revalidarea la pasul 9, mereu:**
- `coalesce(fn_izo_nivel(p), 'off') IN ('stoc','montaj')`;
- corecția încă `propusa` și cu `versiune = p_versiune` (CAS);
- bucata eligibilă (§5.0), cu starea și locul = `corectie.inainte` (la aprobare), respectiv `server_ver = p_server_ver` (la `camp`);
- la corecțiile directe și la storno-ul parțial: nicio propunere deschisă pe bucată / pe listă;
- regula PV (§5.0, Q-E3b-4).

Toate rulează sub READ COMMITTED (cerut de helperele E2a).

## 5. Operațiile

### 5.0 Eligibilitatea comună (orice operație pe o bucată existentă)

- `provenienta = 'beneficiar'`, `tip_cod` ∈ {`teava`, `curba`}, `proiect_id` = proiectul corecției;
- **rădăcină fără copii:** `parinte_id` NULL, `radacina_id = id`, nicio bucată cu `parinte_id = id`. Orice tăiere (E4) scoate bucata din E3b;
- **regula PV (Q-E3b-4 = A):** o bucată cu `aviz_intrare_id` NOT NULL al cărei document n-are PV (`eveniment_pv_id IS NULL`) acceptă doar `camp`. Operațiile de stare (carantină, pierdut, găsit) se refuză: „pune întâi PV-ul (sau anulează documentul)”. E aliniat cu E3 §8 („nicio ieșire înaintea PV-ului”) și cu regula pentru E4. `camp` nu atinge niciuna dintre verificările PV-ului (apartenență, stare, depozit, tronson).

### 5.1 Corecția de câmp — `fn_izo_cor_camp(p_bucata_id, p_server_ver, p_dupa, p_motiv)`

**Validări** (pasul 9 din §4, pe bucata blocată `FOR UPDATE`; toate blocante, recalculate):
- stările admise: `sosit`, `receptionat`, `carantina`, `pe_tronson`. `pierduta` → „recuperează întâi”; `anulata` → refuz;
- nicio propunere deschisă pe bucată (§4, cazurile 1 și 3), altfel 23505 „există o propunere deschisă pe bucată — decide / retrage întâi”;
- `p_dupa`: obiect nevid, chei ⊆ `fn_izo_coloane_corectabile(tip_cod)`; fiecare valoare validă (§2.5) și **diferită** de cea curentă (altfel „nimic de corectat”, fără scriere);
- derivatele se calculează pe server; o cheie din `D` în `p_dupa` → 22023;
- `server_ver = p_server_ver` (altfel 40001 „bucata s-a schimbat, reîncarcă”);
- **unicitatea**, dacă `serie` / `sarja` / o lungime / `unghi_curba` intră în corecție: pre-verificarea cu aceleași interogări ca importul (R1 c pentru rădăcină; frunza pe (`serie_canon`, `dezambiguare`, `sarja`, `lungime_cm`); curba), cu seria canonică calculată explicit și bucata însăși exclusă. Indexul rămâne arbitrul final.
- **coliziunile cu alte proiecte (r3, Q-E3b-18 = A):** indexurile de serie sunt **globale** (20261102a, liniile 260–265). Mesajul dă detalii (bucata, proiectul, starea) doar dacă `fn_izo_citire(proiectul coliziunii)`; altfel 23505 generic „seria / combinația există deja în registru, pe un proiect la care nu ai acces”, fără id, proiect sau stare. Același mesaj îl dă și `unique_violation`-ul prins de la index. Faptul că o combinație există undeva rămâne aflabil prin încercare (oracol inevitabil cu un index global): e declarat în §10 și e limitat la cei care pot scrie pe un proiect (responsabil / gestionar), nu la orice cititor.

**Scrierea** (totul sau nimic; abia după lock-ul bucății, §4 pașii 10–11):
1. corecția: `INSERT … (tip = 'camp', dupa = p_dupa, inainte = NULL) RETURNING id, inainte, dupa`. Trigger-ul `fn_izo_cor_garda` (§3.3) validează lista albă, normalizează valorile, adaugă derivatele schimbate și scrie `inainte` = proiecția rândului curent pe K (K = cheile cerute ∪ derivatele schimbate). **De aici înainte RPC-ul folosește doar valorile întoarse**, nu `p_dupa`;
2. marcajul;
3. evenimentul `corectie`;
4. mișcarea `corectat` (`inainte` / `dupa` = cele întoarse de pe corecție; `lungime_mm` = noua `lungime_mm`, dacă lungimea s-a schimbat, altfel NULL; stările și locurile NULL);
5. UPDATE-ul bucății (K + `server_ver` + `updated_at`);
6. corecția → `aplicata`.

**Răspunsul:** `{corectie_id, eveniment_id, inainte, dupa, server_ver}`.

**Nu atinge** documentul de intrare: rândul rămâne cum a fost confirmat (hash-ul E3 neschimbat). Diferența document ↔ bucată e vizibilă în audit (§8).

**Patru ochi pe câmpurile de identitate (Q-E3b-16, r2; contract complet r3).** Mai sus e corecția directă, făcută de un singur om (varianta B a întrebării). Sub Q-E3b-16 = A:
- cheile `L_ident` = {`serie`, `sarja`, `lot`, `lungime_aviz_mm`, `lungime_masurata_mm`, `unghi_curba`} nu mai trec prin `fn_izo_cor_camp`: RPC-ul le refuză cu 22023 „cere propunere + aprobare”, iar **trigger-ul refuză independent** orice INSERT `camp` pe `cale = 'direct'` cu o cheie din `L_ident` (§3.3 pasul 2);
- ele trec prin `fn_izo_cor_propune(p_tip = 'camp', p_proiect, p_bucata_id, p_detalii, p_motiv)`, cu cheile corecției **direct** în `p_detalii` (doar din `L_ident ∩ L(tip_cod)`, §1; cererea mixtă → 22023), de gestionarul depozitului sau de responsabil;
- trigger-ul scrie `inainte` = valorile curente ale cheilor + derivatele schimbate + **`server_ver`**, și `cale = 'propunere'`;
- aplicarea: `fn_izo_cor_aproba` (responsabil ≠ propunătorul). Revalidează la pasul 9 `bucata.server_ver = corectie.inainte.server_ver` (altfel 40001 „bucata s-a schimbat de la propunere — propune din nou”), eligibilitatea, unicitatea (pre-verificare + index), apoi exact pașii 2–6 ai scrierii de mai sus, cu valorile din rândul corecției. Patru ochi e verificat și de trigger la UPDATE (`cale = 'propunere'` ⇒ `decis_de ≠ propus_de`, §3.3);
- restul câmpurilor din `L` rămân directe.

Pe LOT 2 asta înseamnă: gestionarul propune, managerul aprobă. Dacă propune managerul, aprobă owner-ul sau înlocuitorul.

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

**Aprobarea** (`fn_izo_cor_aproba`, după pașii 0–9): starea și locul = `inainte` (altfel 40001 „bucata s-a schimbat de la propunere — propune din nou”), Y recalculat = `corectie.dupa.stare` → marcaj → evenimentul (`carantina_intrare` / `_iesire`, motivul de pe corecție) → mișcarea `stare` (X → `carantina` / `carantina` → Y) → UPDATE `stare` → corecția `aplicata`.

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

**`gasit_nou`** — o bucată care nu e în registru. Contractul complet (r2):
- **intrarea:** `p_tip = 'gasit_nou'`, `p_proiect` (obligatoriu, singura sursă a proiectului), `p_bucata_id` NULL, `p_detalii` pe lista albă din §1 (`tip_cod`, `depozit_id`, `serie`, `sarja`, `perete_mm`, lungimea / unghiul, restul din `L(tip_cod)`, `document_intrare_id` opțional);
- câmpurile obligatorii ca la import: serie, șarjă, perete, lungime la țeavă, unghi la curbă. Destinația = depozit activ pe site-ul lui `p_proiect` (`fn_izo_loc_valid(p_proiect, depozit_id, NULL)`), iar proiectul e la `stoc` / `montaj`;
- `fn_izo_cor_garda` validează aceeași listă albă la INSERT, normalizează `dupa` prin tipul `magazie_bucati` și verifică proiectul rândului (`NEW.proiect_id`, scris din `p_proiect`): nivel `stoc` / `montaj`, depozitul activ pe site-ul lui (`fn_izo_loc_valid`), plus `NEW.document_intrare_id = dupa.document_intrare_id`;
- `document_intrare_id`, dacă e dat, e doar o **referință** pe corecție: confirmat, pe `p_proiect` și accesibil (altfel refuz generic, ca la înlocuirea din E3 r5e). Pe bucată, `aviz_intrare_id` / `nr_crt_aviz` rămân NULL. Rândurile documentului sunt imutabile, iar anularea documentului nu o atinge (e născută de evenimentul ei);
- **la aprobare:** unicitatea (pre-verificare + indexul arbitru, EXCEPTION → 23505 clar) → marcajul, care **rezervă id-ul** (`ctx.bucata_noua_id := nextval('magazie_bucati_id_seq')`, §3.2) → evenimentul `gasit` → INSERT-ul bucății cu `id = ctx.bucata_noua_id`, din `fn_izo_cor_bucata_noua(corectie)` (lista de coloane = `C` ∪ 4, generată din aceeași constantă ca E3; postcondiție textuală `/*C*/` ca E3 P2) → mișcarea `nascut` pe aceeași bucată (`in_loc` = depozitul, `lungime_mm`; ramura `nascut` a gărzii, §3.3) → corecția `aplicata` cu `bucata_id = ctx.bucata_noua_id`;
- **`inainte = '{}'`** pe corecție (bucata nu există încă), scris de trigger;
- **starea: `carantina`** (Q-E3b-6 = A): fără aviz / certificat, nu e disponibilă până la o ieșire din carantină aprobată (§5.2, Y explicit);
- **`sursa_receptie = 'manual'`** (r2). CHECK-ul live `magazie_bucati_sursa_receptie_check` acceptă doar `packing_list` / `aviz` / `mtc` / `manual`, iar r1 cerea `'gasit'`, valoare respinsă. E3b nu modifică CHECK-ul; originea stă în `atribute = {sursa: 'e3b', corectie_id, document_ref?}`. Pe `atribute.sursa` se sprijină și revenirea (§7), și ramura `nascut` a gărzii. Celelalte coloane din `C`: valoarea explicită din bucata așteptată (`tip_material_id = fn_izo_tip_material(tip_cod)`, `proiect_id = p_proiect`, `locatie_site_id = fn_izo_site_proiect(p_proiect)`).

### 5.4 Corecția PV-ului — `fn_izo_cor_pv(p_doc_id, p_versiune, p_pv_nr, p_pv_data, p_motiv)`

- **Validări** (după pașii 0–9, pe documentul blocat `FOR UPDATE`): documentul e `confirmat`, cu PV pus; CAS pe `versiune`; numărul are 1–80 de caractere, fără `|`, iar canonizarea e cea din E3 (`upper` + spații normalizate); (`pv_nr_canon`, `pv_data`) noi ≠ cele curente (altfel „nimic de corectat”).
- **Scrierea:** corecția, `INSERT … (tip = 'pv', dupa = {pv_nr, pv_data}) RETURNING inainte, dupa`. Trigger-ul calculează `pv_nr_canon`, verifică lista albă (exact `pv_nr`, `pv_data`) și scrie `inainte = {pv_nr, pv_nr_canon, pv_data, versiune}` din document; RPC-ul folosește valorile întoarse → marcaj → evenimentul `corectie` (`document_tip = 'izo_corectie'`; documentul se găsește prin `izo_corectii.document_intrare_id`) → UPDATE antet (cele trei coloane PV, `versiune + 1`) → corecția `aplicata`. **Zero mișcări, zero bucăți atinse.**
- **Efecte:**
  - evenimentul `receptie_pv` rămâne neschimbat (registrul e doar-adaug; motivul lui păstrează PV-ul inițial), iar `eveniment_pv_id` rămâne același;
  - starea bucăților nu se schimbă;
  - un reapel al vechiului `fn_izo_doc_pv` cu valorile inițiale → 23505 („documentul are deja PV-ul …”), comportament E3 neschimbat.
- **Nu face:** scoaterea PV-ului fără anularea intrării (nu e cerută; Q-E3b-8 o lasă deschisă).

### 5.5 Storno-ul parțial pe import — `fn_izo_cor_storno_import(p_proiect, p_import_id, p_bucati, p_motiv, p_cerut_de)` (doar `postgres`)

**Validări** (după pașii 0–9, sub advisory-ul exclusiv, cu toată lista blocată `FOR UPDATE`; toate refuzurile dau lista completă):
- `p_bucati`: 1–10000 de elemente, fără dubluri, fără NULL;
- importul există pe proiect, cu `stare = 'aplicat'`;
- **fiecare** bucată s-a născut din evenimentul importului (mișcarea `nascut` pe `izo_importuri.eveniment_id`), nu e `anulata` și n-are propunere E3b deschisă („decide / retrage întâi”);
- lanțul: nicio mișcare blocantă după `fn_izo_lant_blocant` (§6): în toate variantele, faptele E3b aplicate nu blochează storno-ul parțial;
- `p_cerut_de`: profil existent, owner sau responsabil pe proiect la momentul apelului (dovedește doar eligibilitatea, nu acordul omului, §1); motivul are 3–1000 de caractere.

**Scrierea** (abia după lock-ul listei, §4 pasul 10):
1. corecția (`storno_import`, `propus_de = p_cerut_de`) + lista în `izo_corectii_bucati`; trigger-ul reverifică pe fiecare rând nașterea din import, starea și propunerile deschise (§3.3);
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

- **`fn_izo_cor_propune`**, în ordinea din §4:
  1. schemă + poarta;
  2. forma: `p_tip` pe listă, `p_proiect` nenul, cheile din `p_detalii` pe lista albă a tipului (§1), motivul;
  3. documentul de referință `FOR SHARE`, prin `fn_izo_cor_doc_lock(doc, p_proiect)` (doar `gasit_nou` cu `document_intrare_id`; `false` → refuz generic);
  4. autorizarea §3.4. Depozitul bucății e citit întâi fără lock, apoi reverificat la pasul 6;
  5. bucata `FOR SHARE` prin `fn_izo_cor_bucata_lock(p_bucata_id, p_proiect)` (nu la `gasit_nou`; NULL → refuz generic „bucata nu există sau nu ai acces”);
  6. pe rândul blocat: `proiect_id = p_proiect` (altfel refuz generic), depozitul = cel autorizat (altfel 40001 „bucata s-a mutat, reîncearcă”), eligibilitatea (§5.0) și regula operației (§5.2–5.3);
  7. INSERT `propusa`, cu `inainte` / `dupa` recalculate și normalizate de trigger.

  Mesajele de conflict sunt separate (§4):
  - o propunere deja comisă pe bucată → 23505 „există deja o corecție deschisă pe bucată”, imediat;
  - o propunere concurentă încă necomisă → așteptare în `ux_izo_cor_deschisa`, apoi același 23505 sau trecere după rollback-ul ei;
  - o corecție directă / o aprobare / un storno în zbor pe aceeași bucată → așteptare la pasul 5, apoi revalidare pe rândul nou.
- **`fn_izo_cor_retrage` / `_respinge`:** corecția `FOR UPDATE` → autorizarea / patru ochi → `propusa` + CAS pe `versiune` → doar coloanele deciziei. Nimic în registru, deci fără advisory și fără porți de registru în afara celei complete de la intrare.
- **`fn_izo_cor_verifica`** (doar citire, nicio scriere, nici marcaj):
  - pentru o propunere: e încă aplicabilă? (starea și locul = `inainte`, ținta ieșirii, coliziuni, regula PV);
  - pentru o corecție de câmp încă netrimisă: delta efectivă (cu derivatele), coliziunile și avertismentele (diferența față de rândul documentului de intrare, dacă există);
  - întoarce `versiune` pe care o cere aprobarea;
  - **coliziunile (r3, Q-E3b-18 = A):** caută doar în proiectele pentru care `fn_izo_citire` e adevărat și le dă cu detalii. `ok = true` înseamnă „niciun blocant vizibil pentru tine”, nu „seria e liberă în tot registrul”: arbitrul final rămâne indexul, la aplicare, cu mesajul generic din §5.1. Verificarea globală, cu detalii, nu există în API (doar owner-ul vede tot, prin `fn_izo_citire`).

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
  - `continut`, `hash`, `diff` și `baza` **recalculate de trigger și comparate exact** (nu se acceptă valori de la apelant): `continut = fn_izo_doc_instantaneu(doc)`, `hash = 'e3-doc-v1:' || encode(sha256(convert_to(continut::text, 'UTF8')), 'hex')` și, în plus, `hash = fn_izo_doc_hash(doc)`, `baza = NOT EXISTS (intrare anterioară)`;
  - UPDATE / DELETE / TRUNCATE → refuz pentru orice rol.
- **Hash-ul `e3-doc-v1` nu se schimbă** (`fn_izo_doc_hash` rămâne byte cu byte). Istoricul e un tabel separat.
  - Invariantul testat: formula exactă de la §2.3 aplicată pe `continut` reproduce `fn_izo_doc_hash` la acea versiune, inclusiv pe valori numerice cu zecimale „la limită” (`perete_mm` 7.25 / 7.35, `total_m` cu 4 zecimale);
  - consecința utilă pentru audit: `hash_confirmat` al unui document confirmat = `hash`-ul exact al **ultimei** intrări din istoric. Ține pentru orice document creat după E3b: are o intrare `baza` de la creare, iar confirmarea nu schimbă conținutul. Cazul „ciornă dinainte de E3b” e exclus de precondiție (§2.3).
- **Nu intră în istoric:**
  - anularea ciornei (conținutul nu se schimbă; se vede pe antet);
  - confirmarea (o arată hash-ul);
  - corecțiile PV (stau în `izo_corectii`).
- **Ciornele create înainte de E3b:** nu există la aplicare (precondiția „zero `draft`”, §2.6). Migrarea nu scrie date.

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
     - întâi prologul din §3.6 (lock-ul schemei partajat, fără așteptare, și poarta completă), înaintea oricărui alt lock și a oricărei scrieri;
     - mulțimea `M` = bucățile născute din import cu `stare <> 'anulata'` (cele stornate parțial sunt deja închise), calculată **o singură dată, după** `FOR UPDATE` pe toate bucățile importului, ca array;
     - blocantele = `fn_izo_lant_blocant(M, {eveniment import})`;
     - **propunerile deschise (r3; r4: prin helper):** `fn_izo_cor_deschise(M)`, în instrucțiune separată, după `FOR UPDATE` pe bucăți (`izo_registru_writer` n-are SELECT pe `izo_corectii`, iar funcția rulează ca owner-ul ei); orice rând → refuz cu lista („decide / retrage întâi propunerile: …”). Fără lock pe corecții (§4);
     - **filtrul pe starea curentă e explicit pe ambele scrieri** (azi, 20261102a liniile 1283–1287, ambele iau toate bucățile importului, inclusiv cele deja `anulata`): mișcările `anulat` doar `WHERE b.id = ANY(M)`, cu `stare_inainte = b.stare`; UPDATE-ul doar `WHERE id = ANY(M) AND stare <> 'anulata'`. `ROW_COUNT` = `cardinality(M)`, altfel excepție;
     - `izo_importuri` → `stornat` ca azi, chiar și cu `M` gol (închide formal importul);
  2. `fn_izo_doc_anuleaza` (E3):
     - blocantele prin același predicat (`{intrare, PV}`);
     - propunerile deschise pe `v_toate` (prin `fn_izo_cor_deschise`, ca `izo_receptie_writer`) → refuz cu lista, exact ca la import (r3);
     - **reconcilierea storno-ului PV filtrată pe starea curentă** (azi, 20261103b liniile 1654–1660, mișcările `receptionat → sosit` se scriu pe toate bucățile PV-ului, iar `ROW_COUNT` trebuie să fie egal cu toate; sub A, o bucată PV trecută între timp în `carantina` / `pierduta` ar rupe reconcilierea sau ar scrie o mișcare falsă): `v_pv` = bucățile evenimentului PV cu `stare = 'receptionat'`, calculat după lock-ul lor; mișcările doar pe `v_pv`; UPDATE-ul `WHERE id = ANY(v_pv) AND stare = 'receptionat'`, cu `ROW_COUNT = cardinality(v_pv)`;
     - storno-ul intrării anulează toate bucățile rămase (`stare <> 'anulata'`), din starea lor curentă, cu același tipar (array calculat o dată, mișcări + UPDATE pe el, verificarea numărului);
  3. `fn_izo_garda_receptie` (E3), ramurile anulării, pe ambele tabele (r3; r2 pretindea, greșit, că ramura INSERT a mișcării de storno PV verifică deja starea: 20261103b, liniile 676–677, construiește literal `receptionat → sosit`, fără să citească `v_b.stare`):
     - **UPDATE pe bucată, storno-ul intrării:** starea veche admisă devine {`sosit`, `receptionat`, `carantina`, `pierduta`} (azi {`sosit`, `carantina`}, linia 654). `receptionat` apare pe bucăți `primit_neconform` ieșite din carantină după PV (§5.2): nu sunt în evenimentul PV, deci storno-ul PV nu le atinge;
     - **INSERT mișcare, storno-ul PV:** în plus, `v_b.stare = 'receptionat'`, bucata are o mișcare pe `v_ev_pv` (apartenența la PV, nu doar la document) și nicio mișcare anterioară pe `v_st_pv`;
     - **INSERT mișcare, storno-ul intrării:** în plus, `v_b.stare` ∈ mulțimea de mai sus și nicio mișcare anterioară pe `v_st_intrare`. Mișcarea așteptată folosește deja starea curentă (linia 679);
     - UPDATE pe bucată, storno-ul PV: neschimbat (`receptionat → sosit`, linia 653).
     Cu ele, o mișcare falsă pe o bucată carantinată / pierdută e refuzată de gardă, independent de filtrul din funcție. Test direct al gărzii: §9 testul 10.
- **Regula pentru E4**, de scris în E4_PLAN, cu test acolo:
  - orice funcție E4 care mută / montează / taie refuză bucățile în `carantina` / `pierduta` și pe cele cu o corecție E3b deschisă;
  - storno-ul în lanț din E4 folosește `fn_izo_lant_blocant`, extins explicit, cu review.

**Varianta B (conservatoare): storno-ul și anularea din E2a / E3 nu se rescriu pentru corecții.**
- Ce se schimbă totuși în E2a / E3, exact celula B din matricea de mai jos (r5): setul comun (gărzile, `fn_izo_doc_garda`, `fn_izo_porti_lipsa`, `fn_izo_doc_salveaza`), iar sub Q-E3b-17 = A și **prologul** din §3.6 în `fn_izo_import_storno` și `fn_izo_import_sold_initial` (restul corpului byte cu byte, verificat textual). Sub Q-E3b-17 = B, nicio funcție E2a / E3 în afara setului comun.
- După primul fapt E3b pe o bucată, storno-ul complet al importului ei și anularea documentului ei se refuză, ca azi.
- Storno-ul parțial acceptă faptele E3b (folosește același predicat, `fn_izo_lant_blocant`, cu EXECUTE doar pentru `izo_corectie_writer`). „Tot importul” = storno parțial pe toate bucățile rămase; `izo_importuri` rămâne `aplicat`, ca diferență doar cosmetică.
- Un document E3 cu o bucată corectată / carantinată nu se mai poate anula deloc. Rămân doar corecțiile pe bucată.
- **Propunerile deschise (r3):** storno-ul complet / anularea neînlocuite nu le văd (o propunere nu scrie mișcări). Dacă bucata devine `anulata`, propunerea rămâne `propusa`; aprobarea ei refuză la pasul 9 (40001 „bucata nu mai e în starea propunerii”), iar responsabilul o respinge. UI-ul arată propunerile pe bucăți `anulata` ca „de închis”. Indexul `ux_izo_cor_deschisa` le ține până la respingere, fără efect pe registru. Același comportament sub C, pe documente.

**Varianta C:** A pentru import (E2a înlocuită, cu `fn_izo_lant_blocant` și `fn_izo_cor_deschise` pentru `izo_registru_writer`), B pentru documentele E3 (fără a atinge `fn_izo_doc_anuleaza` / garda E3).

**Matricea Q-E3b-1 × Q-E3b-17 (r4).** Peste setul comun (`fn_izo_garda_bucati`, `fn_izo_garda_fapte`, `fn_izo_doc_garda`, `fn_izo_porti_lipsa`, `fn_izo_doc_salveaza`), fiecare cu md5 la precondiție și definiția veche salvată:

| Q-E3b-1 | Q-E3b-17 = A (recomandat) | Q-E3b-17 = B |
|---|---|---|
| **A** | `fn_izo_import_storno` rescris (prolog + §6); `fn_izo_doc_anuleaza`, `fn_izo_garda_receptie` rescrise; `fn_izo_import_sold_initial` doar prolog. Helper-e: `fn_izo_lant_blocant` (EXECUTE `izo_registru_writer`, `izo_receptie_writer`, `izo_corectie_writer`), `fn_izo_cor_deschise` (`izo_registru_writer`, `izo_receptie_writer`) | ca la stânga, fără `fn_izo_import_sold_initial` |
| **B** | `fn_izo_import_storno` și `fn_izo_import_sold_initial` doar prolog. Helper-e: `fn_izo_lant_blocant` (doar `izo_corectie_writer`); fără `fn_izo_cor_deschise` | nicio funcție E2a / E3 în afara setului comun. `fn_izo_lant_blocant` (doar `izo_corectie_writer`) |
| **C** | `fn_izo_import_storno` rescris (prolog + §6); `fn_izo_import_sold_initial` doar prolog. Helper-e: `fn_izo_lant_blocant` (`izo_registru_writer`, `izo_corectie_writer`), `fn_izo_cor_deschise` (`izo_registru_writer`) | `fn_izo_import_storno` rescris; helper-ele ca la stânga |

Generatorul migrării primește cele două decizii ca parametri și produce exact celula aleasă. Revenirea (§7) restaurează **fiecare** funcție din celulă, pe fiecare axă independent, și scoate helper-ele create. Testul 18 rulează apply → revenire pe toate cele șase celule.

**Riscul, pe variante (r2; r4: pe axa Q-E3b-1, la Q-E3b-17 fixat):** **B e cea mai conservatoare** (nicio funcție E2a / E3 rescrisă pentru storno; sub Q-E3b-17 = A, importul și storno-ul primesc totuși prologul), **C e la mijloc** (storno-ul E2a LIVE rescris), **A are cea mai mare suprafață** (trei funcții rescrise, două dintre ele E3, plus două helper-e DEFINER care citesc registrul / corecțiile). Recomandarea A rămâne pe utilitate: fără ea, prima corecție pe o bucată blochează pentru totdeauna anularea întregului document / import. Dacă Razvan cântărește riscul mai sus decât utilitatea, alegerea corectă e B; C are sens dacă anularea documentelor E3 e considerată rară.

Testele 9–10 și regresia (testul 14) sunt scrise pe ambele ramuri. Sub A, testele E2a / E3 care cer refuzul la „orice mișcare” se adaptează explicit, cu lista lor în PR (nu se șterg).

## 7. Revenirea (`supabase/revenire/20261106a_izometrie_e3b_corectii_ROLLBACK.sql`; rulează ÎNAINTEA revenirii E3)

- **Refuză dacă există ORICE fapt E3b:**
  - vreun rând în `izo_corectii` / `izo_corectii_bucati` / `izo_documente_istoric`;
  - vreun eveniment cu `document_tip = 'izo_corectie'` sau cu `tip` ∈ {`carantina_intrare`, `carantina_iesire`, `storno_partial`};
  - vreo bucată cu `atribute->>'sursa' = 'e3b'`.
  
  Istoricul ciornei intră în listă (audit). Practic, revenirea e posibilă doar până la prima salvare de ciornă după E3b. După primul fapt, drumul e **înainte**, cu migrare revizuită.
- **Fără fapte:**
  - scoate trigger-ele / politicile / funcțiile / tabelele / rolurile E3b, indexul `ux_magbuc_ev_corectie` și `magbuc_ev_e3b_motiv`;
  - reface CHECK-ul tipurilor (forma E3) și funcțiile înlocuite, din definițiile salvate, exact celula din matricea §6 (r4): setul comun (gărzile E3, `fn_izo_doc_garda`, `fn_izo_porti_lipsa`, `fn_izo_doc_salveaza`) + `fn_izo_import_storno` dacă Q-E3b-1 ∈ {A, C} **sau** Q-E3b-17 = A + `fn_izo_doc_anuleaza` / `fn_izo_garda_receptie` dacă Q-E3b-1 = A + `fn_izo_import_sold_initial` dacă Q-E3b-17 = A; scoate `fn_izo_lant_blocant` și, dacă există, `fn_izo_cor_deschise` (după ce funcțiile care le cheamă au fost restaurate);
  - reface ștampilele `porti=` / `porti_e3=` și COMMENT-ul amprentei de revenire, cu valoarea păstrată după `inainte_20261106a=`;
  - verifică egalitatea cu starea dinainte de E3b.
- **Criteriu obligatoriu de acceptare (r5; rezultatele vin la cod, §9 testul 18):** pe baza curată, lanțul E3b → revenire E3b → revenire E3 → revenire 2c → revenire E2a trebuie să treacă integral, pe fiecare celulă a matricei §6. Fără rezultatul lui atașat, PR-ul de cod nu intră la review și migrarea nu se aplică.

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
- „＋ Bucată găsită (nu e în registru)”: formularul `gasit_nou`, pe proiectul selectat în tab (trimis explicit ca `p_proiect`); depozitele oferite sunt cele active de pe site-ul proiectului.

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
2. **Curse cu barieră** (T1 oprit după pasul 3, 8 sau 10 din §4 printr-un advisory de test; `pg_locks` confirmă așteptarea), în ambele ordini:
   - revocarea responsabilului / a modulului ↔ aprobarea;
   - două aprobări ale aceleiași propuneri; aprobare ↔ retragere; aprobare ↔ respingere;
   - **ordinea FK (r2, Jakarinos r1 P1)**, fiecare cu `pg_locks` care arată așteptarea pe rând sau pe advisory, nu pe amândouă, și fără `deadlock_detected`:
     - corecție directă (`camp`) ↔ storno-ul complet E2a pe aceeași bucată: T1 oprit după pasul 8 (advisory-ul partajat de la pasul 6 + bucata `FOR UPDATE`, înaintea INSERT-ului corecției); **T2 storno așteaptă advisory-ul exclusiv** (r3: nu rândul — r2 scria greșit „rândul”), iar `pg_locks` arată că T1 nu ține niciun `KEY SHARE` cerut de T2. Apoi invers: T2 ține advisory-ul exclusiv, iar T1 așteaptă advisory-ul fără să țină vreun `KEY SHARE`;
     - storno parțial ↔ storno complet și ↔ o aprobare pe o bucată din listă: așteptarea e tot pe advisory (exclusiv ↔ partajat / exclusiv), nu pe rând;
     - propunere ↔ `camp` pe aceeași bucată: T1 propune oprit după `fn_izo_cor_bucata_lock`, înaintea INSERT-ului; T2 `camp` așteaptă la `FOR UPDATE`, nu în index;
     - propunere ↔ storno parțial / complet, în ambele ordini (§4);
     - **testul-martor:** forma r1 (INSERT-ul corecției înaintea advisory-ului), reprodusă într-o funcție de test doar pe branch → `deadlock_detected` (40P01). Asta dovedește că bariera prinde interclasarea greșită;
   - corecție directă ↔ propunere pe aceeași bucată, pe cele patru cazuri din §4 (propunere comisă / cu aprobare în zbor / cu retragere în zbor / propunere necomisă): mesajul și codul fiecăruia, și locul unde se așteaptă (rândul sau nimic, niciodată indexul);
   - propunere ↔ propunere pe aceeași bucată: a doua așteaptă în `ux_izo_cor_deschisa` → 23505 după commit, trece după rollback;
   - `camp` ↔ `camp` pe aceeași bucată: a doua → 40001;
   - `gasit_nou` ↔ `gasit_nou` cu aceeași serie: ambele propuneri se deschid; la aprobări concurente, exact una trece, cealaltă primește 23505 clar și zero efecte (nicio bucată, niciun eveniment, id-ul rezervat nefolosit);
   - **corecția seriei ↔ confirmarea E3** a unui document cu aceeași serie (și ↔ importul suplimentar): exact una trece, cealaltă primește 23505 clar și zero efecte;
   - carantina ↔ PV-ul E3 pe același document;
   - aprobare ↔ anularea documentului E3; aprobare ↔ storno-ul complet; storno parțial ↔ storno complet; storno parțial ↔ aprobarea pe o bucată din listă;
   - `gasit_recuperare` ↔ mutarea depozitului-destinație pe alt site;
   - schemă ↔ runner-ul de migrări (cheia exclusivă);
   - **(r3)** `fn_izo_activeaza_si_importa` (Q-E3b-17 = A) oprit după `fn_izo_seteaza_nivel`, ↔ runner-ul care ține schema exclusiv: importul refuză imediat cu 55P03, fără `deadlock_detected` și fără efecte; același test cu prologul scris cu `pg_advisory_xact_lock_shared` (funcție de test, doar pe branch) → 40P01, ca martor;
   - **(r3)** o revocare pe două atribuiri de responsabil, în ordinea inversă `id`-ului, ↔ o aprobare care ține una dintre ele → una dintre tranzacții primește 40P01, zero efecte parțiale; reîncercarea reautorizează (refuzată dacă revocarea a trecut); revocarea pe rânduri, în ordinea `id`, nu produce așteptare circulară;
   - **(r3)** propunere `gasit_nou` cu document de referință ↔ anularea / PV-ul acelui document: așteptarea e pe document (`fn_izo_cor_doc_lock`), în ambele ordini;
   - **(r5) timeout-urile efective:** prin PostgREST real, în aceeași cerere cu propunerea, `current_setting('lock_timeout')` / `current_setting('statement_timeout')` = valorile reverificate la precondiție; cu propunerea oprită în autorizare (atribuire blocată de o tranzacție de test), PV-ul pe documentul de referință așteaptă cel mult cât permit acele valori, iar la depășire una dintre tranzacții primește 55P03 / 57014, fără efecte parțiale.
3. **Garda pe context:** `izo_corectie_writer`, cu marcaj valid pentru corecția A, încearcă (toate refuzate):
   - un eveniment cu alt `document_id` / alt tip / al doilea eveniment;
   - o mișcare pe altă bucată / pe alt eveniment / a doua pe aceeași bucată / cu alt rol / cu alte stări / cu alt `in_loc`;
   - un UPDATE pe bucată fără mișcarea înainte / cu o coloană în plus / cu o valoare diferită de `dupa` / cu `server_ver` neschimbat;
   - un INSERT de bucată în alt context decât `gasit_nou`; la `gasit_nou`: o bucată cu alt `id` decât `ctx.bucata_noua_id`, a doua bucată în același context, mișcarea `nascut` pe altă bucată sau înaintea INSERT-ului bucății, `aplicata` cu alt `bucata_id`; un context `gasit_nou` fără `bucata_noua_id` / unul de alt tip cu el;
   - **specificația scrisă de scriitor (r2):** INSERT direct în `izo_corectii` ca `izo_corectie_writer` cu `dupa` care conține o cheie interzisă (`stare`, `proiect_id`, `depozit_id`, `atribute`, `aviz_intrare_id`, o cheie din `D`), o valoare invalidă sau egală cu cea curentă, cu `inainte` nenul, cu `propus_de` străin → 22023 / 42501. Pe calea bună, `RETURNING` întoarce valorile normalizate de trigger, iar un UPDATE pe bucată construit din `p_dupa` brut (diferit de forma normalizată) e refuzat de gardă. UPDATE pe `inainte` / `dupa` → `permission denied`;
   - INSERT în `izo_corectii_bucati` cu o bucată din alt import / deja `anulata` / cu propunere deschisă → refuz de trigger;
   - **calea și patru ochi în trigger (r3):** INSERT cu `cale` dată de apelant diferită de cea din `current_user` → 22023; sub Q-E3b-16 = A, INSERT `camp` direct (`izo_corectie_writer`) cu o cheie din `L_ident` → 22023; propunere `camp` (`izo_cor_editor`) cu o cheie din `L \ L_ident`, cu una din `D` sau mixtă → 22023; propunere `camp` sub Q-E3b-16 = B → 22023; UPDATE `propusa` → `aplicata` / `respinsa` pe `cale = 'propunere'` cu `decis_de = propus_de`, ca oricare rol, inclusiv owner-ul → 42501 de la trigger (RPC-ul ocolit); UPDATE care schimbă `cale` / `tip` / `inainte` / `dupa` / `propus_de` → refuz; `cale = 'direct'` trecută în `respinsa` / `retrasa` → refuz;
   - un UPDATE pe antetul documentului în afara `pv` / pe alte coloane;
   - `aplicata` cu alt `eveniment_id`;
   - un context cu alt `txid` / altă versiune / alt proiect; `izo.receptie_ctx` setat în aceeași tranzacție;
   - un helper care scrie înaintea marcajului.
4. **Proiecția:** pentru FIECARE coloană din `C`, un UPDATE care o schimbă în plus față de delta → refuz. Pentru fiecare cheie din `L_teava` / `L_curba`, corecția corectă trece. Cheie din `D` sau din afara `L` → 22023. Valoare egală → „nimic de corectat”, fără scriere. Derivatele: `lungime_mm` / `lungime_m` calculate altfel → refuz.
5. **Unicitatea:** o serie spre o serie vie (import / document / `pierduta`) → 23505; spre una `anulata` → trece. Coliziune de curbă pe unghi; coliziune de frunză pe `lungime_cm`. Mesaj clar, zero efecte. **Coliziunile cu alte proiecte (r3):** o coliziune pe un proiect pe care apelantul nu-l citește → 23505 generic, fără id / proiect / stare (și la pre-verificare, și la `unique_violation`-ul indexului); `verifica` nu o listează, iar `ok = true` e documentat ca „niciun blocant vizibil”, nu „liberă global”; owner-ul vede detaliile; aceeași coliziune pe un proiect citit → detalii.
6. **Stările:**
   - intrarea în carantină din `pe_tronson` / `pierduta` / `anulata` / `carantina` → refuz;
   - **orice operație de stare pe o bucată a unui document fără PV** → refuz; după PV trece;
   - ținta ieșirii, pe fiecare ramură a regulii din §5.2, inclusiv pierdut-din-carantină → găsit → ieșire;
   - `gasit_recuperare` din altă stare → refuz; depozit inactiv / pe alt site / alt tronson → refuz;
   - starea și locul schimbate între propunere și aprobare → 40001.
7. **`gasit_nou`:**
   - serie dublată → 23505; perete / lungime / unghi lipsă → refuz; documentul de referință pe alt proiect / neconfirmat / inaccesibil → refuz generic; starea `carantina`; anularea documentului de referință nu atinge bucata găsită;
   - `p_proiect` lipsă → 22023; un depozit activ pe site, dar cerut cu un `p_proiect` de pe alt site → refuz; o cheie în afara listei albe (inclusiv vechiul `tip`, `lungime_mm`, `stare`) → 22023;
   - **(r3)** propunerea cu document de referință valid trece ca `izo_cor_editor` real (fără `permission denied`, prin `fn_izo_cor_doc_lock`); document pe alt proiect / neconfirmat / inexistent → `false` și refuz generic, iar `pg_locks` arată că documentul străin n-a fost blocat; `inainte = '{}'` pe corecție;
   - bucata născută are `sursa_receptie = 'manual'`, `atribute.sursa = 'e3b'`, `atribute.corectie_id` = corecția și `id` = cel rezervat în context; trece `magazie_bucati_sursa_receptie_check` neschimbat.
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
    - A → trece; stările finale `anulata`, mișcările `anulat` din starea curentă, PV-ul stornat doar pe bucățile `receptionat`. Cazul-limită: un document cu PV și o bucată în `carantina` (intrare E3b după PV) se anulează fără eroare de reconciliere, iar acea bucată primește doar mișcarea `anulat` (din `carantina`), nu și `receptionat → sosit`; storno-ul complet după un storno parțial nu scrie nicio mișcare pe bucățile deja `anulata`;
    - B → refuz, cu lista;
    - ambele: peste o mișcare non-E3b (E4 simulată) → refuz;
    - **(r3) propunerile deschise:** sub A / C (import) și A (documente), storno-ul complet / anularea cu o propunere `propusa` pe o bucată → refuz cu lista; după respingere trece. Sub B (și C pe documente): trece, propunerea rămâne `propusa`, aprobarea ei → 40001, respingerea trece;
    - **(r3) garda E3 înlocuită (sub A), direct, ocolind funcția:** ca `izo_receptie_writer` cu context `anulare` valid, INSERT al unei mișcări de storno PV (`receptionat → sosit`) pe o bucată `carantina` / `pierduta` / din afara evenimentului PV / a doua pe aceeași bucată → 42501; INSERT al unei mișcări de storno intrare pe o stare din afara mulțimii sau a doua pe aceeași bucată → 42501.
11. **Istoricul ciornei:**
    - fiecare salvare scrie exact o intrare, cu versiunea nouă; `'e3-doc-v1:' || encode(sha256(convert_to(continut::text, 'UTF8')), 'hex')` = `fn_izo_doc_hash` la acea versiune, inclusiv pe valorile numerice cu rotunjire (§5.7);
    - diff corect pe antet / rânduri adăugate / șterse / modificate / scanuri adăugate / scoase / **modificate** (aceeași `cale`, alt `sha256_*` / `marime` / `mime`); o renumerotare apare ca ștergere + adăugare (comportament declarat);
    - INSERT direct (orice rol API; editorul în afara salvării; valori date de apelant) / UPDATE / DELETE / TRUNCATE → refuz;
    - prima intrare (la creare) are `baza = true`; `hash_confirmat` = hash-ul ultimei intrări, pe orice document creat după E3b; anularea ciornei nu scrie intrare;
    - precondiția: migrarea refuză dacă există un document `draft`.
12. **Privilegiile:**
    - matricea din §3.5, pe catalog, pe fiecare celulă (`has_column_privilege` pe fiecare coloană a `magazie_bucati` pentru ambii writeri);
    - DML direct al `authenticated` / `service_role` pe tabelele noi → refuz;
    - `izo_cor_editor` nu scrie registrul; `izo_corectie_writer` nu scrie config / importuri / atribuiri și nici coloane din afara listei;
    - **(r4)** EXECUTE pe `fn_izo_lant_blocant` / `fn_izo_cor_deschise` = exact celula aleasă din matricea §6 (`has_function_privilege` pe fiecare writer; `fn_izo_cor_deschise` absentă sub Q-E3b-1 = B);
    - **(r5)** EXECUTE pe `fn_izo_jwt_rol`, `fn_izo_uid`, `fn_izo_porti_lipsa` pentru `izo_cor_editor` și `izo_corectie_writer` (§3.5); niciun GRANT nou pe `fn_izo_doc_api_verifica`;
    - **(r3)** USAGE pe secvențe, exact: `izo_corectie_writer` = {`magazie_bucati_id_seq`, `izo_server_ver_seq`, `magazie_bucati_evenimente_id_seq`, `magazie_bucati_miscari_id_seq`}, `izo_cor_editor` = ∅; `izo_cor_editor` fără UPDATE pe vreo coloană a `magazie_bucati` / `izo_documente_intrare`.
13. **Porțile**, fiecare mutație → porți lipsă. Refuză exact intrările din tabelul §3.6: E3b (API + storno parțial), E3, `fn_izo_seteaza_nivel('stoc')` / `fn_izo_activeaza_si_importa`, storno-ul complet înlocuit (sub Q-E3b-1 = A / C) și, sub Q-E3b-17 = A, `fn_izo_import_sold_initial` chemată singură și storno-ul cu prolog (sub Q-E3b-1 = B). Sub Q-E3b-17 = B, testul arată explicit golul declarat: importul chemat singur și (sub Q-E3b-1 = B) storno-ul **nu** refuză, iar procedura de rulare (§3.6) refuză. Mutațiile:
    - o politică `*_corectie_*` slăbită; un GRANT de coloană în plus; un trigger `DISABLE` / `ENABLE` (în loc de `ALWAYS`);
    - un membership neașteptat; un `ALTER ROLE … BYPASSRLS`; o funcție `fn_izo_cor_*` modificată (corp / ACL / config);
    - scoaterea indexului `ux_magbuc_ev_corectie` / `ux_izo_cor_deschisa`;
    - **proba capcanei:** o funcție de test numită `fn_izo_import_storno_x` → „wrapper nerevizuit”; poarta E3b nu numește niciuna dintre cele patru funcții E2a;
    - **postcondiția textuală (r5), exact pe celula aleasă din matricea §6, ca în §3.6:**
      - „corpul nou fără liniile prologului = forma 20261102a” se testează **doar** unde funcția primește numai prologul: `fn_izo_import_sold_initial` sub Q-E3b-17 = A (orice Q-E3b-1) și `fn_izo_import_storno` sub Q-E3b-1 = B și Q-E3b-17 = A. O modificare în afara prologului → migrarea refuză;
      - sub Q-E3b-1 = A / C, `fn_izo_import_storno` e rescris (§6): testul nu cere egalitatea textuală, ci doar md5-ul formei vechi la precondiție (o formă veche diferită → migrarea refuză) și prezența prologului la începutul corpului nou, înaintea `fn_izo_lock_proiect`.
14. **Regresia:** suitele E2a (180 de verificări) și E3 (`izometrie_e3.test.sql`) rulează nemodificate peste E3b (sub B). Sub A, cu lista explicită a testelor de storno adaptate. Testul diferențial al închiderii (E3 §14) rămâne verde.
15. **Apelurile tranzitive:** fiecare operație (propune / retrage / respinge / verifică / aprobă pe fiecare tip / câmp / PV / storno parțial / salvare cu istoric) rulată cap-coadă ca rolul real, fără `permission denied`. Inclusiv `fn_izo_cor_api_verifica` (deci `fn_izo_jwt_rol`, `fn_izo_uid`, `fn_izo_porti_lipsa`) ca fiecare dintre cele două roluri E3b, prin PostgREST real (r5), `fn_izo_cor_bucata_lock` / `fn_izo_cor_doc_lock` ca `izo_cor_editor` (care n-are UPDATE pe registru / pe documente), aprobarea unei propuneri `camp` (sub Q-E3b-16 = A), INSERT-urile de evenimente / mișcări ca `izo_corectie_writer` (secvențele `serial`, §3.5) și citirile trigger-ului `fn_izo_cor_garda` (bucata, documentul, importul și mișcările lui), ca fiecare dintre cele două roluri. Sub Q-E3b-17 = A, importul și storno-ul cu prolog, ca `izo_registru_writer`.
16. **Atomicitatea:** eșec injectat după eveniment / după mișcare / după UPDATE → zero efecte, iar corecția rămâne `propusa` (la cele directe, nici rândul corecției nu rămâne).
17. **Idempotența:**
    - aprobarea repetată cu aceeași `p_versiune` (cea dinaintea aprobării), de același aprobator, pe o corecție deja `aplicata` → idempotentă (același `eveniment_id`, `idempotent: true`, fără scrieri); cu altă versiune sau de alt om → refuz;
    - `camp` cu `server_ver` vechi → 40001; `pv` cu versiune veche → 40001.
18. **Migrarea peste proiectul activ** (pe branch, cu o copie a LOT 2: 3352 de bucăți, 2 în carantină, 1466 pe tronson) și **revenirea** (§7):
    - porțile rămân complete după apply;
    - un import + storno E2a pe proiectul de test merge (sub A, și peste o corecție);
    - E3 (confirmare / PV / anulare) merge;
    - ieșirea din carantină a celor 2 țevi LOT 2 (cazul real cel mai apropiat) trece cap-coadă;
    - **(r4) toate cele șase celule ale matricei Q-E3b-1 × Q-E3b-17** (§6): apply → porți complete → storno complet / anulare ca rolurile reale (`izo_registru_writer` / `izo_receptie_writer`, inclusiv `fn_izo_cor_deschise` fără `permission denied`) → revenire → amprenta și corpurile funcțiilor egale cu starea dinainte de E3b;
    - **(r5)** pe baza curată, lanțul complet de reveniri din §7 (E3b → revenire E3b → revenire E3 → revenire 2c → revenire E2a), cu rezultatul atașat la PR-ul de cod: criteriul obligatoriu de acceptare din §7.

## 10. Ce rămâne limitare (declarată)

- Documentul de intrare confirmat nu se rescrie: corecția de câmp schimbă bucata, iar diferența față de rândul documentului rămâne vizibilă (intenționat).
- O corecție E3b nu are „storno”. Una greșită se repară cu altă corecție, în sens invers, auditată.
- `pierdut` nu distinge structural „n-a existat” de „a dispărut” (doar `cauza` + motiv). „N-a existat”, pe un import, înseamnă storno parțial.
- Anularea parțială a unui document E3 nu există (doar anularea întreagă, administrativă). Piesele lipsă după PV se tratează cu `pierdut`.
- NCR-ul e doar o referință text: documentul nu se atașează (E9).
- Sesiunea `postgres` care își ia rolul de writer și pune marcajul E2a poate în continuare să scrie fără eveniment (`izo_critic.txt`). Rămâne regula de lucru „doar cu da”; E3b nu închide această cale.
- Revenirea E3b se blochează la primul fapt E3b, inclusiv la o simplă salvare de ciornă.
- Istoricul există doar pentru documentele create după E3b. Precondiția „zero `draft`” exclude ciornele vechi; documentele confirmate / anulate înainte (doar pe branch) rămân fără istoric.
- **Doar sub Q-E3b-17 = B:** importul E2a (`fn_izo_import_sold_initial`, chemat singur) și, sub Q-E3b-1 = B, storno-ul complet E2a nu cheamă poarta completă și nu iau lock-ul schemei (§3.6). Le acoperă doar procedura de rulare (poarta în aceeași tranzacție, sub lock-ul schemei). Sub Q-E3b-17 = A (recomandat r3), golul e închis în funcție.
- **Oracolul unicității globale (r3, Q-E3b-18):** indexurile de serie sunt globale, deci cine poate scrie pe un proiect (responsabil / gestionar) poate afla, prin încercare, că o combinație serie / șarjă / lungime există pe alt proiect. Nu află bucata, proiectul sau starea (mesaj generic, §5.1). `verifica` nu certifică disponibilitatea globală (§5.6).
- Revocarea mai multor atribuiri într-o singură tranzacție, în altă ordine decât `id`, poate da `deadlock_detected` cu o aprobare în zbor: fără efecte parțiale; reîncercarea e un apel nou, cu autorizarea reluată (§3.4).
- `p_cerut_de` (storno-ul parțial) dovedește doar că profilul e eligibil, nu că omul a cerut sau a fost de acord (§1).
- Amprenta porților nu validează semantica apelurilor tranzitive ale helperelor noi (review + testul 15, §3.6).
- Încrederea în validarea JWT de gateway, ca în E3.

## 11. Întrebări deschise (A / B / C; recomandarea e prima)

- **Q-E3b-1, storno-ul complet față de corecții (§6):**
  - **A** faptele E3b nu blochează storno-ul (import complet / parțial, anularea documentului); doar E4+ blochează. Se înlocuiesc `fn_izo_import_storno`, `fn_izo_doc_anuleaza` și `fn_izo_garda_receptie`;
  - **B** strict: storno-ul complet și anularea documentului nu se rescriu pentru corecții. După prima corecție ele se refuză, iar storno-ul parțial devine singura unealtă. În E2a / E3 se schimbă doar setul comun și, sub Q-E3b-17 = A, prologul în import și în storno (celula B din matricea §6, r5);
  - **C** A pe import, B pe documente.
  - **Riscul (r2):** B e cea mai conservatoare, C la mijloc, A cea mai largă (§6). Recomandarea A e pe utilitate. Sub A, filtrul pe starea curentă e explicit pe mișcările `anulat` și pe reconcilierea storno-ului PV (§6).
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
- **Q-E3b-16, patru ochi pe corecțiile de identitate** (`serie`, `sarja`, `lot`, lungimile, `unghi_curba`; în r1, directe, de un singur om; §5.1):
  - **A** propunere + aprobare (gestionarul / responsabilul propune, alt responsabil aprobă); restul câmpurilor din `L` rămân directe. Motivul: o serie schimbată de un singur om eliberează vechea serie în indexul de unicitate și poate acoperi o piesă lipsă;
  - **B** directe, de responsabil, ca în r1 (mai rapid; un singur om răspunde);
  - **C** toate corecțiile de câmp prin propunere + aprobare.
- **Q-E3b-17, poarta în importul / storno-ul E2a** (§3.6; r3: recomandarea s-a inversat după Jakarinos r2, iar literele s-au schimbat față de r2):
  - **A** se înlocuiesc `fn_izo_import_sold_initial` și, sub Q-E3b-1 = B, `fn_izo_import_storno`, cu md5 la precondiție, **doar cu prologul** (lock-ul schemei fără așteptare + poarta completă); restul corpului byte cu byte, verificat textual. Închide golul în funcție, nu prin disciplină. Costul: încă una-două funcții LIVE rescrise și testul E2a de 180 de verificări rerulat pe ele;
  - **B** nu se înlocuiesc. Golul se acoperă prin procedura de rulare (lock-ul schemei + poarta în aceeași tranzacție, înaintea apelului) și se declară în §10. Sunt funcții LIVE, N3, doar cu „da”; storno-ul se înlocuiește oricum sub Q-E3b-1 = A / C și atunci cheamă poarta.
- **Q-E3b-18, coliziunile de serie cu alte proiecte** (r3; indexurile sunt globale, §5.1, §5.6):
  - **A** detalii doar din proiectele citite de apelant; în rest, 23505 generic, fără bucată / proiect / stare; `verifica` nu certifică disponibilitatea globală; oracolul „există undeva” rămâne, declarat (§10);
  - **B** detalii complete pentru orice coliziune, oricui poate scrie pe proiect (mai util la recepție, dar dezvăluie bucăți și proiecte inaccesibile);
  - **C** ca A, plus o verificare globală cu detalii doar pentru owner, într-un ecran separat.
