# PowPatroll Context Registry: faza 1a (local)

*29.09.2026 · implementat și testat DOAR LOCAL, pe PostgreSQL 16 · nimic aplicat în producție.*

Poarta Copilot pentru noaptea asta: „Migrare și teste locale. Fără tabele noi în live, fără actualizarea registrelor live și fără transformarea recomandărilor agenților în decizii ale ownerului.” Am respectat-o:
- în producție n-am scris nimic (fără `apply_migration`, DML sau seed);
- n-am făcut commit, push sau checkout;
- `CLAUDE.md` și `AGENTS.md` au rămas neatinse, iar patch-ul lor rămâne propunere (§5 din propunere).

Din producție am citit doar câteva lucruri, read-only, listate la §6.

Propunerea aprobată: `docs/POWPATROLL/PROPUNERE_CONTEXT_REGISTRY.md`. Deciziile tale care o încadrează sunt în `claude_context` #1486 și #1490.

## 1. Ce s-a implementat

| Fișier | Ce e |
|---|---|
| `supabase/migrations/20261005a_powpatroll_registry.sql` | migrarea (idempotentă, o singură tranzacție) |
| `supabase/migrations/20261005a_powpatroll_registry_ROLLBACK.sql` | rollback-ul: refuzat dacă registry-ul are versiuni peste v1 |
| `scripts/test_powpatroll_registry.sh` | harness-ul: PG16 dedicat, `/tmp/pg_registry`, port 5437, doar 127.0.0.1, baze `*_test` cu gardă |
| `supabase/tests/powpatroll_registry.test.sql` | testele complete (T0–T16) |
| `supabase/tests/powpatroll_registry.prodlike.test.sql` | testele „prod-like” (P0–P4), rulate ca rol NOSUPERUSER + CREATEROLE + BYPASSRLS, ca `postgres` din Supabase |
| `supabase/tests/powpatroll_schelet_extra.sql` | supliment de schelet: `fn_is_app_owner` exact ca în producție. Scheletul comun `conturi_schelet_supabase.sql` a rămas **neschimbat** |
| `supabase/tests/powpatroll_registry.migrari.txt` | lista de migrări a harness-ului |

**Obiectele din BD** sunt toate în `public`, cu proprietarul `powpatroll_owner`:
- **Rolul `powpatroll_owner`**: NOLOGIN, fără alte atribute și nu e membru al niciunui rol.
- **`powpatroll_versions`**:
  - `version` e PK, iar `context_version = max(version)`;
  - `prev_sha`, `chain_sha` și `n_rows` le calculează triggerul;
  - `created_at` e forțat de trigger.
- **`powpatroll_log`**: schema din §2, cu CHECK-uri pe `kind`, `status` pe tip, `actor`, `item_key`, `refs`, `attrs` și `vizibilitate`. FK-ul spre versiune se numește `powpatroll_log_version_fk` și e DEFERRABLE INITIALLY DEFERRED.
- **Append-only**:
  - `trg_pp_log_ro` și `trg_pp_versions_ro` sunt BEFORE UPDATE OR DELETE OR TRUNCATE, FOR EACH STATEMENT, după tiparul J05;
  - refuză și pentru superuser, pe tabel gol și la `INSERT … ON CONFLICT DO UPDATE`.
- **Reguli la INSERT**: triggerul `fn_powpatroll_log_bi` rulează la fiecare INSERT, nu doar prin RPC:
  - `version` trebuie să fie head+1;
  - trece filtrul anti-secrete pe toate câmpurile text și, recursiv, prin `attrs`;
  - `refs` au formatul corect;
  - `decision` cere `actor='razvan'` + `attrs.citat` + o dată în `source`, iar sursa nu poate fi externă;
  - `copilot` scrie doar `go_no_go`/`note`; `jakarinos` și `miloi` scriu doar `note`;
  - `go_no_go` cere `attrs.scope` și `attrs.based_on_version`, un întreg ≤ head;
  - `conflict` cere `refs` nevid;
  - `handoff` are cel mult 3.000 de caractere;
  - `delivery` cere `pack_version` și `sha`;
  - `decizie_ref` trebuie să trimită la o decizie existentă;
  - `kind` rămâne stabil pe cheie;
  - închiderea cere `evidence`, iar redeschiderea cere `evidence` **nouă**.
- **Sigiliul**: triggerul `fn_powpatroll_versions_bi` refuză o versiune goală, apoi calculează `n_rows` și lanțul:
  `chain_sha(vN) = sha256(prev | N | session | created_us | hash(rând1),hash(rând2),… ordonate după id)`. Hash-ul unui rând se face pe JSON-ul canonic `jsonb`, cu `created_at` în microsecunde epoch, deci nu depinde de fusul orar. T15 recalculează lanțul independent, cu formula documentată.
- **`v_powpatroll_curent`**: are `security_invoker=on` și întoarce ultimul rând pe cheie (la GO, pe cheie + emitent), fără `handoff`/`delivery`/`note`.
- **RPC-uri** (EXECUTE doar pentru adminul migrării, adică `postgres`/MCP):
  - `powpatroll_write(p_known, p_session, p_rows)`:
    - advisory lock + o versiune nouă, atomic;
    - `STALE_KEY` înseamnă că o cheie cu stare din batch s-a schimbat material după `p_known`; atunci întoarce delta **fără să scrie**;
    - `CONTEXT_CONFLICT` când `p_known > head`;
    - câmpurile necunoscute sunt refuzate.
  - `powpatroll_check(p_known, p_refs, p_known_chain)` întoarce `OK`, `RESYNC` sau `BLOCKED`:
    - **BLOCKED**: lanț rupt, `p_known > head`, ancoră diferită sau conflict OPEN pe refs;
    - **RESYNC**: schimbări materiale pe refs după `p_known`;
    - separat întoarce `go_invalidate` și `go_valabile`;
    - un GO nu se invalidează prin propria înregistrare.
  - `powpatroll_render(format, p_since, p_keys)`:
    - `line` ≤300, `context` ≤25k, `copilot` ≤12k, `delta` / `delta_copilot` ≤4k, `task` ≤6k;
    - cele 11 secțiuni din §4;
    - `[EXTERN:<sursă>] «…»` pe o singură linie, cu santinelele neutralizate;
    - secretele sunt mascate la render;
    - tăierea se face de la coadă, cu `(+N omise)`, dar conflictele, HOLD-urile, GO-urile și deciziile nu se taie; dacă nu încap, render-ul dă eroarea `PPBUG`;
    - în `copilot` apar doar rândurile `copilot_ok` și numărul celor interne (`+K interne`).
- **17 funcții interne**, toate `SECURITY DEFINER SET search_path = public, pg_temp` și fără EXECUTE pentru PUBLIC, anon, authenticated sau service_role:
  - reguli: `fn_powpatroll_material`, `_cu_stare`, `_terminal`;
  - anti-secrete: `_secret_text`, `_secret_jsonb`;
  - render: `_esc`, `_text`, `_linie`, `_asambleaza`;
  - lanț: `_sha_rand`, `_sha_versiune`, `_verifica_lant`;
  - garda de JWT: `_garda_api`;
  - GO: `_go_invalidat`;
  - triggere: `_append_only`, `_log_bi`, `_versions_bi`.
- **RLS owner-only** pe ambele tabele:
  - politica e de SELECT, pentru `authenticated`, cu `(SELECT auth.uid()) IS NOT NULL AND (SELECT fn_is_app_owner((SELECT auth.uid())))`;
  - nu există nicio politică de scriere.
- **ACL**: `authenticated` are doar SELECT, filtrat de RLS; anon și service_role nu au nimic. Adminul migrării are SELECT și EXECUTE pe cele 3 RPC-uri.
- **Verificarea finală din migrare**: dacă proprietarul, RLS-ul, un ACL, `search_path`, `security_invoker` sau drepturile temporare rămase nu sunt cum trebuie, migrarea pică și nu aplică nimic.

## 2. Rezultatul testelor

Comanda, rulată din rădăcina worktree-ului: `bash scripts/test_powpatroll_registry.sh --reaplica --rollback`. **Exit 0, 730 de aserțiuni OK**, în circa 7 secunde.

| Trecere | Aserțiuni |
|---|---|
| A. prod-like: frână / ownership (ca `pp_sim_postgres`, după migrare aplicată **de 2 ori** fără superuser) | 22 |
| A. prod-like: teste complete (T0–T16) | 170 |
| A. prod-like: rollback ca `pp_sim_postgres` a șters rolul; schema = cea dinainte | 2 |
| A. prod-like: după rollback, doar BAZĂ | 8 |
| B. după migrare | 170 |
| B. după reaplicare (idempotență) | 170 |
| B. rollback: schema = cea dinainte, rolul șters, rollback rulat de 2 ori fără eroare | 3 |
| B. după rollback, doar BAZĂ | 8 |
| B. după rollback + reaplicare | 170 |
| C. concurență: sesiuni psql reale, date COMMIT-uite | 5 |
| D. rollback refuzat la v4, cu schema și datele neschimbate | 2 |
| **Total** | **730** |

**Acoperirea cerințelor din §8 pct. 2:**

| Cerință | Test |
|---|---|
| UPDATE/DELETE/TRUNCATE refuzate, inclusiv pentru postgres | T4, ca superuser, deci mai mult decât `postgres` din producție: UPDATE, UPDATE fără rânduri, DELETE, TRUNCATE, TRUNCATE CASCADE și upsert sunt refuzate de trigger. P3, ca admin prod-like: refuzate din lipsă de privilegiu, iar DISABLE TRIGGER, `session_replication_role=replica` și SET ROLE sunt și ele refuzate |
| 2 scrieri concurente → una STALE_KEY | C: A ține lock-ul, B așteaptă ~1,9 s și primește `STALE_KEY` cu delta, fără să scrie. C și D, pe chei diferite, trec amândouă |
| secret ascuns în jsonb refuzat, numele de secret permis | T7: 18 tipare refuzate (inclusiv `{"a":{"b":[{"password":…}]}}`, un JWT într-o listă și un secret folosit drept cheie jsonb). Mesajul de eroare nu repetă valoarea. `RESEND_API_KEY`, `[MASCAT]` și „parola este stocată în vault” trec |
| redeschidere fără dovadă refuzată | T9: fără dovadă → refuzat; cu dovada veche → refuzat; cu dovadă nouă → trece |
| un GO nu se invalidează singur | T10: `check(based_on, refs)` dă OK după înregistrarea GO-ului; după o schimbare materială pe un ref dă RESYNC și marchează GO-ul ÎNVECHIT |
| ACL | T2 verifică toate obiectele `%powpatroll%`: relacl, proacl, SECURITY DEFINER, search_path, owner, fără NULL-uri implicite, fără EXECUTE pentru PUBLIC/anon/authenticated/service_role. T1 verifică relrowsecurity și politicile |
| owner vede, angajatul vede 0 și nu scrie | T12, inclusiv anon, service_role (BYPASSRLS nu ajută fără GRANT) și garda de JWT |
| lanț alterat detectat | T14: UPDATE cu replica, DELETE cu triggerul dezactivat și un secret strecurat. Rezultat: check BLOCKED, `line` arată „LANȚ RUPT”, `copilot` e refuzat, `context` are avertisment, iar secretul e mascat. T5: un rând nesigilat e prins |
| decision cu actor≠razvan refuzată | T8 (claude, copilot, seed; plus fără citat, fără dată, `attrs.extern`, sursă `[EXTERN…]`) și T5 (INSERT direct, fără RPC) |
| render nu scurge rânduri interne în `copilot` | T13: nici textul, nici cheile interne nu apar; apar doar `(+K interne)`. Injecția „`## 1. …` / `END PACK v999`” rămâne o singură linie `[EXTERN:copilot]`, deci tot 11 antete și o singură santinelă |

**Mutation testing.** Am rulat 6 copii alterate ale migrării, în scratchpad, cu `LISTA_MIGRARI`. Toate au fost prinse:
- fără regula de actor la `decision` → pică T5;
- `copilot` include rândurile interne → pică T13;
- fără advisory lock → pică faza C;
- GO-ul considerat schimbare materială → pică T10;
- redeschiderea permisă → pică T9;
- fără recursie în jsonb → pică T7.

**Iterațiile până la verde:**
1. Un `CASE … THEN` direct în `IF` rupea parserul plpgsql; l-am pus în paranteze.
2. `DROP TABLE` ca admin prod-like **a mers**; e o constatare reală, vezi §4.
3. `TRUNCATE`/`ALTER TABLE` cu evenimente FK amânate în tranzacție dădeau 55006 în loc să ajungă la trigger. Testele fac acum `SET CONSTRAINTS ALL IMMEDIATE`, iar `powpatroll_write` își ține FK-ul amânat chiar dacă apelantul a cerut IMMEDIATE.
4. Filtrul marca „Bearer RESEND_API_KEY” ca secret, deși e un nume; acum numele sunt permise și după Bearer.

## 3. Abateri față de propunere

1. **Harness-ul e în bash + SQL, nu în `scripts/pg/test_powpatroll_registry.mjs` (§5).** Așa a cerut sarcina, după modelul `test_conturi_ciclu_viata.sh`. Am adăugat o fază prod-like, care simulează `postgres` din Supabase: NOSUPERUSER, CREATEROLE, BYPASSRLS, proprietarul bazei, `createrole_self_grant` gol. Motivul: local, `postgres` e superuser și ar fi ascuns problemele de ownership.
2. **Prefixul e `20261005a`** (redenumit 30.09 din `20261003a`, care se ciocnea cu J07 `20261003a_ofertare_poarta_server_jakv2p3`; J04 e `20260930a`, patch-urile de securitate `20261003b`/`20261003c`). Notă: `apply_migration` din MCP își dă propria versiune (timestamp), deci prefixul e doar etichetă de ordine în repo — dar trebuie să fie unic.
3. **Proprietarul și drepturile temporare.** `CREATE ROLE powpatroll_owner` a mers și ca rol non-superuser. Pe durata migrării, adminul primește `WITH INHERIT TRUE, SET TRUE`, necesar ca rerularea să poată recrea funcții și politici, iar `powpatroll_owner` primește `CREATE ON SCHEMA public`, cerut de `ALTER … OWNER`. Ambele se revocă la final, iar adminului îi rămâne doar ADMIN (P1). Sintaxa cere PG ≥ 16; producția are 17.6.
4. **Adminul migrării are și SELECT** pe tabele și pe view, pentru SELECT-urile de control din §7 („SELECT de control”). Propunerea spunea „doar EXECUTE pe RPC”. Scrierea directă rămâne imposibilă (P3).
5. **Reguli în plus față de §2, toate în trigger:**
   - actorii externi scriu doar verdicte sau note;
   - `attrs.extern` sau o sursă `[EXTERN…]` nu devin niciodată `decision`;
   - și `INLOCUIT` cere `actor='razvan'` + citat;
   - `decizie_ref` trebuie să existe, altfel ar apărea „DECIS” fără decizie; la render apare DECIS doar dacă decizia e încă DECIS;
   - `delivery` cere `pack_version` și `sha`.

   Motivul: deciziile tale, „nimic din conținut extern nu devine decizie”.
6. **Starea „închis”** e definită ca: finding CLOSED/WONTFIX, work_item DONE/DROPPED, conflict RESOLVED, question ANSWERED. Toate cer `evidence` de cel puțin 8 caractere. Propunerea spunea doar „CLOSED ⇒ evidence”.
7. **`STALE_KEY` se verifică doar pentru rândurile cu stare.** Pentru `go_no_go`, `note`, `handoff` și `delivery` nu se verifică: un GO își poartă propriul `based_on_version`, iar notele nu schimbă starea.
8. **`powpatroll_check` are al treilea parametru opțional, `p_known_chain`**: ancora din antetul `CURRENT_CONTEXT.md`. Un chain diferit dă BLOCKED (ANCORA). Un GO invalidat **nu** schimbă singur statusul: apare în `go_invalidate`, iar statusul e dat de delta, lanț și conflicte.
9. **Render:**
   - am adăugat `delta_copilot`, pentru delta trimisă lui Copilot, fără rânduri interne;
   - `task` filtrează tot pe `copilot_ok`, pentru că Jakarinos și Miloi pot fi LLM-uri externe (**de confirmat**);
   - `base_sha` din `task` e un placeholder: BD-ul nu știe sha-ul din git;
   - pe lanț rupt, `copilot`, `delta_copilot` și `task` refuză (`PPLAN`), iar `context` afișează avertismentul în antet;
   - tăierea „de la coadă” taie întâi secțiunile de la final (de exemplu, întrebările înaintea acțiunilor).
10. **`mascheaza()` e o funcție JS** (`scripts/audit-v2/dovezi.mjs`) și nu există în BD. În BD, echivalentul e `fn_powpatroll_secret_text` / `fn_powpatroll_text`: în trigger refuză, la render maschează.
11. **Filtrul anti-secrete, limitare asumată.** După „parola este / token: …” se refuză doar valorile care arată a secret: cel puțin 6 caractere, cu cifră, simbol sau majusculă internă, și care nu sunt nume `^[A-Z0-9_]+$`. Altfel ar fi blocată proza de tipul „parola este stocată în vault”. O parolă doar din litere mici, scrisă în proză, nu e prinsă. În jsonb, sub o cheie de tip secret, orice valoare în clar e refuzată.
12. **Garda de JWT în funcții**, apărare în adâncime: chiar dacă cineva ar da EXECUTE unui rol de API, o sesiune cu `request.jwt.*` sau `session_user='authenticator'` e refuzată. MCP-ul nu e afectat: rulează ca `postgres`, fără JWT, verificat read-only.
13. **Schelet.** `fn_is_app_owner` nu exista în scheletul comun. Am pus-o într-un supliment separat, cu definiția și ACL-ul copiate din producție. Scheletul comun e neatins, iar testele „conturi” nu sunt afectate.

## 4. Constatări noi, de decis la 1b

1. **`postgres` poate da DROP pe registry fără să dețină tabelele.** Verificat read-only în producție:
   - `datdba = postgres`, deci `postgres` e membru `pg_database_owner`, deci proprietarul schemei `public`;
   - testul P4 confirmă comportamentul.

   E o distrugere **vizibilă**: P0 pică, iar ancora din git nu mai are ce verifica. Nu e o falsificare tăcută. UPDATE, DELETE, TRUNCATE și DISABLE TRIGGER rămân blocate (P3).
   - **A)** Rămâne așa: e o frână documentată, iar pentru restaurare există backup-ul Supabase.
   - **B)** Tabelele se mută într-o schemă dedicată `powpatroll`, deținută de `powpatroll_owner`. Nu mai poate fi dată DROP fără ca adminul să-și reacorde rolul și nu e expusă prin PostgREST. Costul: ownerul nu mai citește registry-ul prin API (în faza 1 nu e nevoie), iar faza 2 ar cere un wrapper.

   **Recomand A pentru 1b**, cu B reevaluat în faza 2.
2. **`session_replication_role` are context `superuser` în producție**, deci `postgres` nu poate ocoli triggerele cu `replica` (P3). Local, ca superuser, se poate; T14 folosește tocmai asta ca să simuleze falsificarea.
3. **Frâna rămâne frână** (P4): `postgres` are CREATEROLE + ADMIN pe `powpatroll_owner` și își poate reda SET. Detecția rămâne lanțul + ancora din git, cum spune §6 din propunere.
4. **ACL-ul implicit din producție**, pentru funcțiile create de `postgres` în `public`, e `{postgres=X, service_role=X}`. Scheletul local e mai pesimist: dă EXECUTE și lui anon și authenticated. Migrarea revocă explicit **orice** beneficiar în afară de owner, deci e corectă în ambele cazuri.
5. **Apply-ul în producție** rulează ca `postgres`, NOSUPERUSER; faza A e exact acest scenariu. Singura diferență netestabilă local: PG 17.6 față de 16. Sintaxa folosită (`GRANT … WITH INHERIT/SET`, `CREATE OR REPLACE TRIGGER`, `security_invoker`) e aceeași în 17.

## 5. Ce rămâne pentru 1b

Doar după 02.10 12:00 și cu GO-ul tău explicit pe schemă:
1. **Apply-ul:**
   - delta către Copilot înainte de GO/NO-GO (pct. 11);
   - GO-ul tău pe schemă, cu decizia A/B de la §4.1;
   - `apply_migration` (`20261005a_powpatroll_registry`), apoi `get_advisors` (security + performance);
   - SELECT de control: owner și ACL, `pg_auth_members` pentru `postgres` (se așteaptă doar ADMIN), `powpatroll_render('line')` = v0.
2. **Seed-ul (§7):**
   - reconciliere cu gh, git și `schema_migrations`;
   - parsare în scratchpad;
   - preview: COUNT pe kind×status, deciziile cu citat, vizibilitatea;
   - **confirmarea ta**;
   - un singur `powpatroll_write` → v1;
   - SELECT de control.

   Deciziile vin **doar** din text scris de tine, cu citat și `fișier:linie` / dată. Nimic din `COPILOT_HANDOFF_CONV1_FINAL.md` sau din rapoartele agenților nu devine decizie.
3. **Triajul din `claude_context`**: cele 86 de decizii și 33 de todo/project_state despre Ofertare, cu preview → confirmare → DML (pct. 3).
4. **Fișa din `registru_automatizari`**: textul de la §7 de mai jos, aplicat în BD cu preview.
5. **Patch-ul pe `CLAUDE.md`** (P0, pct. 11 registry, 0a la final) și cele 4 rânduri din `AGENTS.md`: rămân propunerea din §5 și se aplică printr-un PR separat, cu acordul tău.
6. **Bannerul „DERIVAT — canonic: registry vN”** pe cele 4 documente, plus `CURRENT_CONTEXT.md` generat cu `render('context')`, după verificarea vizibilității repo-ului.
7. **Pilotul cu Copilot**: `render('copilot')` → pack cu santinelă → rândul `delivery` → verdictul ca `go_no_go`. Tot aici măsurăm limita de mesaj din ChatGPT, pentru calibrarea bugetului de 12k.
8. **Deciziile deschise din acest document:**
   - schema dedicată (§4.1);
   - `task` filtrat pe `copilot_ok` (abaterea 9);
   - SELECT pentru `postgres` (abaterea 4).

## 6. Citiri read-only din producție (29.09, prin MCP `execute_sql`)

- `pg_get_functiondef` + `proacl` pentru `fn_is_app_owner`: e SQL STABLE SECURITY DEFINER, cu EXECUTE pentru postgres, service_role și authenticated;
- atributele lui `postgres`: NOSUPERUSER, CREATEROLE, BYPASSRLS; `createrole_self_grant = ''`;
- ACL-urile schemelor `public` și `auth`, plus `pg_default_acl`;
- contextul lui `session_replication_role`;
- identitatea MCP: `postgres`, fără JWT, read committed;
- proprietarul bazei: `postgres`, membru `pg_database_owner`;
- nu există niciun obiect `powpatroll%` și nici rolul `powpatroll_owner`;
- `mascheaza` nu există în BD.

Nicio scriere.

## 7. Fișa pct. 7 (a–e), pentru `registru_automatizari`, la 1b

- **(a) Conținut extern citit:** niciunul automat. Triggerele și RPC-urile nu citesc mail, documente, chat-uri sau pagini. Transcrierea verdictelor Copilot și a rapoartelor Jakarinos/Miloi o face Claude, deliberat, ca `go_no_go` / `note`, cu `actor` și `source`. Textul lor apare la render doar ca `[EXTERN:<sursă>] «…»`, pe o linie, escapat.
- **(b) Ce scrie sau face:** scrie doar în `powpatroll_versions` și `powpatroll_log`, append-only. Nu trimite mail, nu atinge bani, drepturi de acces (`user_module_access`, roluri) sau alte tabele. Ieșirea de date e `render('copilot'|'delta_copilot'|'task')`, doar rândurile `copilot_ok`, livrat manual prin `cgpt_pw.py` / `cgpt_force.mjs`.
- **(c) Identitate:**
  - RPC-urile sunt SECURITY DEFINER și rulează ca `powpatroll_owner`, NOLOGIN, fără BYPASSRLS; RLS-ul nu i se aplică doar pentru că e proprietarul tabelelor;
  - apelantul e `postgres` prin MCP;
  - **fără `service_role`**, care nu are acces la nimic din registry.
- **(d) Cine o poate porni:**
  - orice sesiune care rulează ca `postgres` fără JWT: MCP, sesiuni paralele, subagenți, SQL Editor;
  - nu poate niciun rol de API (EXECUTE revocat + garda de JWT, testate în T2 și T12);
  - `verify_jwt` nu e relevant: nu există edge function;
  - de aici regula: **registry = memorie, NU autorizare**.
- **(e) Ce cere confirmare umană:** deciziile (doar din mesajul tău explicit, cu citat + dată, și ți se arată rândul), GO-ul pe merge/apply/depunere, seed-ul, triajul, rezolvarea conflictelor de judecată, `apply_migration` și rollback-ul.

  Regula (a)∩(b) nu se aplică: nimic nu citește conținut extern și scrie automat, pentru că nu există cron, edge function sau hook.

## 8. Cum rulezi

```bash
bash scripts/test_powpatroll_registry.sh --reaplica --rollback   # toate fazele (A prod-like, B, C, D)
bash scripts/test_powpatroll_registry.sh --fara-prodlike          # doar B + C + D
bash scripts/test_powpatroll_registry.sh --opreste                # oprește serverul la final
```

Harness-ul refuză:
- un port pe care rulează alt cluster;
- un cluster cu alte baze decât cele de test;
- baze care nu se termină în `_test`;
- variabile libpq moștenite.

Exit 0 = PASS · 1 = test sau migrare eșuată · 2 = mediu.

---

## 9. Verificarea adversarială (30.09.2026, ~00:30–01:00 RO) — VERDICT: **CU_CORECȚII** (nu NO-GO)

Doi verificatori independenți (securitate + principii) au reprodus harness-ul pe clustere separate (5438, 5439): **730/730 aserțiuni OK**. Nicio probă n-a spart append-only-ul, RLS-ul, poarta de rol, randarea sau concurența. Limita Copilot pentru noaptea asta e respectată (zero tabele/obiecte în producție, nicio decizie din recomandările agenților).

**Transparență:** în producție s-a citit doar prin SELECT, cu o excepție. Verificatorul de securitate a rulat o probă `SET LOCAL session_replication_role = 'replica'` într-o tranzacție închisă cu ROLLBACK. Asta schimbă doar configurația sesiunii, fără date sau schemă.

**De corectat ÎNAINTE de 1b** (apply după 02.10 12:00, cu GO explicit al lui Răzvan pe schemă):
1. **[RIDICATĂ] Proprietarul schemei `public` (`postgres`) poate dezactiva regulile în tăcere**, fără să-și reacorde rolul. Exemple:
   - `DROP FUNCTION fn_powpatroll_log_bi() CASCADE` scoate triggerul; după asta, o „decizie” cu `actor=claude`, fără citat, trece, iar `check` și lanțul rămân OK.
   - `DROP` + `CREATE` pe view sau pe `powpatroll_check` transformă BLOCKED în OK.

   UPDATE și TRUNCATE rămân refuzate. → Se reevaluează §4.1 spre **varianta B**:
   - schemă dedicată `powpatroll`, deținută de `powpatroll_owner`;
   - autoverificare structurală: triggere active, owner + `md5(prosrc)` pe funcții, ACL pe view;
   - SQL brut de control în git, rulat la P0;
   - test P5 pe aceste probe.
2. **[MEDIE] §4.2 și P3 sunt greșite pentru producție:** `postgres` POATE seta `session_replication_role = replica`, prin supautils (`privileged_role_allowed_configs`). Efectul e limitat, fără o cale nouă de scriere. Se corectează documentul și aserția P3 („valabil doar local”).
3. **[MEDIE] Ancora din git (`p_known_chain`) e opțională**, iar fluxul documentat apelează `powpatroll_check` fără ea. O rescriere consistentă a lanțului trece nedetectată. → Ancora devine obligatorie pentru acțiunile critice, sau lipsa ei dă avertisment zgomotos.
4. **[MEDIE]** `go_no_go` cu `actor=razvan` nu cere citat și dată, deci un verdict Copilot poate deveni „GO-ul ownerului”. `invariant`/freeze pot fi scrise de claude/seed fără citat. `check` nu urmează refs-urile cheii cerute, deci un GO învechit lasă OK.
5. **[MEDIE] Teste tautologice pe scurgerile din render:** mutațiile M1, M2 și M4 supraviețuiesc (177 de aserțiuni trec cu codul stricat). → Rânduri interne legate prin refs/decizie_ref + garda JWT testată pe `render`/`check`.
6. **[SCĂZUTĂ] Filtrul anti-secrete** ratează:
   - formulări uzuale („parola pentru NAS: X”, „codul de acces este…”);
   - `sk_live_`;
   - base64.

   Formatul `delta` nefiltrat include rânduri interne. Alte scurgeri minore în antetul pack-ului: proiectele rândurilor interne, U+2028, „END<ZWSP>PACK”. Mai sunt parole literale în `test.sql:230-232`.

Rapoartele complete ale verificatorilor sunt în jurnalul workflow-ului `wf_41d28b07-bf6` (sesiunea Claude din 29–30.09). Probele sunt în `registry_adv_securitate.sql` / `registry_adv_principii.sql`. Prefixul migrării e acum **`20261005a`** (vezi §3 pct. 2); harness-ul a fost re-rulat după redenumire: PASS, 730/730.
