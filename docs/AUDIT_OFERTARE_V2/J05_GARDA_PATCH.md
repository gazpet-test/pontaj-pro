# J05 — garda derogării de depunere (patch `20261001a`) — PREGĂTIT LOCAL, NEAPLICAT

> **Runda 4 (30.09): traseul de livrare** — după verdictul Copilot pe #538 r3 (NO-GO pe apply cu COMMIT în fișier): tranzacția o deține `scripts/livrare_migrare.sh`, fișierul nu mai are BEGIN/COMMIT, înregistrarea e în aceeași tranzacție; **§14**. Logica gărzii J05 e neschimbată.
>
> **Stare:** doar local (worktree pe `claude/erp-continuare-x4p5a7-j05-garda`, pornit din `origin/main` @ `76fd89d`). Fără commit, push sau apply. Producția (`dxczwkbciseqniprspcu`, PG 17.6) a fost citită pe 30.09 **doar prin SELECT pe cataloage** (`prosrc` și atributele din `pg_proc`, `pg_get_functiondef`, `pg_trigger`, `pg_policies`, `relacl`/`proacl`, `pg_constraint`, `pg_attribute`). Nicio dată reală nu a fost citită.
>
> **Fișiere:** `supabase/migrations/20261001a_ofertare_derogare_garda_j05.sql` · `supabase/revenire/20261001a_ofertare_derogare_garda_j05_ROLLBACK.sql` (NU e migrare; vezi `supabase/revenire/README.md`) · `supabase/tests/j05_garda.test.sql` · `scripts/test_j05_garda.sh`. Prefixul `20261001a` nu există pe niciun branch remote (verificat cu `git ls-tree` pe toate branch-urile după `git fetch`).

## 0. Pe scurt

- **Finding J05** (OPEN, severitate ridicată): motivul derogării de depunere e editabil fără audit. Verdictul Copilot: detecția nu ajunge, e nevoie de prevenție autorizată separat, inclusiv DUPĂ depunere.
- **Patch:** un trigger `BEFORE UPDATE` pe `ofertare_licitatii`, **primul din lanț**. Schimbarea lui `derogare_depunere` sau `derogare_motiv` mai e permisă DOAR ownerului prin JWT (și doar înainte de depunere) sau administrării fără JWT (`postgres` / `supabase_admin`). Orice altă identitate primește `42501`. După `status = 'depusa'` câmpurile sunt înghețate, inclusiv pentru owner și inclusiv prin RPC.
- **Testul** rulează pe PG16, pe copia exactă a definițiilor live (22 de obiecte cu md5 = live și 8 ACL-uri = live):
  - pe live: 150 de aserțiuni, dintre care 50 pică, toate în cele 30 de cazuri de prevenție (gaura e reală și testul o prinde);
  - cu patch: 152 din 152 trec;
  - plus verificările de harness din §13 (3 runnere, erori injectate, 19 precondiții negative, rollback într-o singură sesiune, 15 mutanți, discriminare față de varianta anterioară).
- **Varianta atomică** (un singur `UPDATE` de owner cu `{derogare_depunere:true, derogare_motiv:M, status:'depusa'}`):
  - produce **exact 2 evenimente** (`derogare_acordata`, apoi `depusa_pe_derogare`), ambele cu motivul M identic (text și SHA-256) și cu actor = ownerul;
  - celelalte porți se comportă ca pe live;
  - un refuz nu lasă nimic în urmă, iar reluarea e no-op;
  - concurența e serializată.

  Varianta atomică e **preferabilă** variantei în doi pași, cu 3 condiții (§5). **Nu închide editarea după depunere** (demonstrat pe live: P20, C02, C03).
- **Gol consemnat, nerezolvat de patch** (§6): retragerea și schimbarea motivului făcute de OWNER prin `UPDATE` direct (fără RPC) trec și nu lasă rând de audit. Poarta jurnalizează doar acordarea și depunerea.

## 1. Ce face patch-ul

- **Funcția `public.fn_ofertare_derogare_garda_j05()`**
  - plpgsql, `SECURITY DEFINER`, proprietar `postgres`: are nevoie de asta ca să citească `profiles.is_owner` independent de RLS-ul apelantului. Nu scrie nimic.
  - `search_path = public, pg_temp`.
  - Nu e executabilă de `PUBLIC` / `anon` / `authenticated` / `service_role`. Revocarea anulează privilegiile implicite Supabase; testul K02 verifică asta.
- **Triggerul `a00_ofertare_derogare_garda_j05`** (`BEFORE UPDATE … FOR EACH ROW`)
  - Numele îl pune primul în ordinea de execuție: înaintea lui `a00_ofertare_licitatii_scriere` (a00, R-V2-07) și a lui `trg_gate_depunere` (poarta).
  - Consecința: refuzul vine uniform din gardă (`42501`), indiferent de ce face a00.
- **Regula:**
  - dacă `derogare_depunere` și `derogare_motiv` sunt `IS NOT DISTINCT FROM` valorile vechi, garda nu intervine. Un formular care retrimite valorile neschimbate trece (R05);
  - altfel decide identitatea (§2);
  - apoi înghețul: `OLD.status = 'depusa'` ⇒ refuz pentru orice identitate JWT, inclusiv ownerul.
- **Precondiții md5 față de live 30.09**, verificate înainte de orice DDL. Dacă oricare diferă, migrarea refuză și nu aplică nimic:
  - 6 funcții: poarta, RPC-ul, a00, `fn_are_acces_ofertare`, helperul owner, funcția append-only a auditului;
  - setul exact de triggere pe `ofertare_licitatii`, cu md5;
  - CHECK-ul `actiune` al auditului;
  - triggerul append-only activ;
  - tipurile coloanelor;
  - o gardă deja existentă e acceptată doar în versiunea acestui patch.
- **Verificare după aplicare, în aceeași tranzacție:**
  - md5-ul corpului, `SECURITY DEFINER`, `search_path`, proprietarul, ACL-ul;
  - md5-ul triggerului;
  - garda e primul trigger `BEFORE UPDATE`.
- **Aplicare:** `BEGIN`/`COMMIT` propriu, `lock_timeout = 5s`, `CREATE OR REPLACE FUNCTION` și `CREATE OR REPLACE TRIGGER` (idempotent, fără `DROP`).

## 2. Identitate: cine mai poate schimba `derogare_*`

Logica e copiată din S-A (`20260929g_profiles_campuri_owner_only.sql`), cu identitate explicită și fără ramura „`auth.uid()` IS NULL ⇒ sistem”. Două diferențe față de S-A:

- `service_role` **nu** mai trece. Niciun backend nu scrie legitim aceste coloane, iar a00 oprește oricum `service_role` pe ele.
- Se adaugă înghețul după depunere.

| Context (claims JWT / login) | Exemplu | Poate schimba `derogare_*`? | Teste |
|---|---|---|---|
| fără claims, login `postgres` / `supabase_admin` | MCP `execute_sql`, SQL editor, `pg_cron`, migrări | **da**, inclusiv după depunere (reparații documentate). a00 lasă să treacă doar `postgres`; `supabase_admin` e oprit tot de a00 | R17, D04, A07, R18 |
| `role=authenticated`, `sub` = profil `is_owner` | Răzvan din aplicație (PostgREST) sau MCP „în numele lui” (`SET ROLE authenticated` + claims) | **da, doar dacă `OLD.status <> 'depusa'`** | R01, R19, R20, A01, A06, D01, D02 / P09–P14, P17, P18, P20 |
| `authenticated` non-owner: editor / viewer / admin de modul / financiar | cei 9 non-owneri cu modul Ofertare | nu, `42501` | P01–P08, P19, H04, C03 |
| `service_role` | edge / worker cu cheia service | nu, `42501` (pe live: `P0001` din a00) | H01, H02 |
| `anon` | — | nu: direct, RLS dă 0 rânduri; printr-un RPC definer, `42501` | R14, H03 |
| claims fără `sub` / `sub` fără profil / rol străin cu `sub` owner | — | nu, `42501` | H05, H06, P16 |
| login `authenticator` / `supabase_auth_admin` fără claims | funcție care golește claims | nu, `42501` | H07, H08 |
| sesiune `postgres` cu claims de non-owner rămase setate | MCP cu `set_config` uitat | nu, `42501` (identitatea JWT are prioritate) | P15 |

## 3. Ce NU face patch-ul

Fiecare punct de mai jos are un test care îl descrie și care trece atât pe live, cât și pe patch.

- **D01, D02 — gol:** ownerul poate retrage derogarea sau schimba motivul prin `UPDATE` direct (fără RPC), înainte de depunere. **Nu rămâne niciun rând de audit.** Detalii în §6.
- **D03 — gol:** `INSERT` nu e acoperit. Un non-owner poate crea o licitație cu `derogare_motiv` completat și flagul `false`. Acordarea pe `INSERT` rămâne owner-only, prin poartă.
- **R17, D04 — reparații nejurnalizate:** reparațiile făcute de administrare fără JWT nu lasă audit. Trebuie documentate separat (claude_context sau handoff).
- **D05 — limitare:** înghețul e legat de `status = 'depusa'`. După `depusa → castigata / pierduta / in_lucru`, ownerul poate edita din nou; non-ownerii tot nu pot. Extinderea înseamnă o singură linie (`OLD.status IN ('depusa','castigata','pierduta')`), dar nu am făcut-o, pentru că specificația e `OLD.status = 'depusa'`.
- **D06 — motivul nu e validat:** în afara RPC-ului, motivul nu trece prin nicio validare. O variantă atomică fără motiv produce 2 evenimente cu `motiv NULL`.
- **Obiecte neatinse:** datele, poarta, RPC-ul, auditul (CHECK-ul rămâne cu 3 acțiuni), politicile și granturile.
- **Mesaj schimbat:** un non-owner care încearcă o **acordare** primește acum mesajul gărzii în loc de mesajul R07 al porții (R08, A04). Codul rămâne `42501` și mesajul conține tot „doar ownerul”; niciun cod din aplicație nu citește textul.
- **Derogarea nu se consumă la depunere:** redeschiderea (`depusa → in_lucru`) urmată de o nouă depunere o refolosește. Comportamentul există și azi și e în afara J05.

## 4. Rezultate: live (fără patch) vs patch

Rularea din 30.09: `bash scripts/test_j05_garda.sh` → `PASS`.

- **Faza 1, LIVE** (schelet cu definițiile din 30.09, fără patch): 150 de aserțiuni. 100 trec, 50 pică, toate în cele 30 de cazuri P/H, deci **fiecare caz de prevenție discriminează**. Regresia (R), varianta atomică (A), golurile (D) și cataloagele (L) trec pe live.
- **Faza 2, PATCH:** migrarea aplicată de 2 ori. 152 din 152 trec (inclusiv K01–K05: garda e corectă, iar definițiile live au rămas neatinse).
- **Fazele 3–8** (runnere, precondiții, rollback, reaplicare, mutanți, discriminare): §13.
- **Compatibilitate cu suita J05 existentă** (`scripts/pg/test_jakv205_derogare_audit.mjs`: matricea porții J03 + matricea auditului J05, ambele treceri). Am rulat-o pe același PG16 cu garda injectată (verificat că e activă), dintr-o copie de lucru care nu e livrată: **PASS**, identic cu rularea fără gardă.
  - Precondițiile md5 nu se pot aplica acolo, pentru că fixture-ul folosește versiunile din repo ale porții, cu comentarii, nu cele live.
  - Injecția a pus doar funcția și triggerul gărzii.

**Categorii:**

| Cat. | Ce înseamnă | Pe live | Pe patch |
|---|---|---|---|
| **P** | gaura J05 | live permite, deci cazul pică | trece |
| **H** | întărire | live refuză deja, dar cu `P0001` din a00, deci cazul pică pe cod | trece (`42501` din gardă) |
| **R** | flux legitim / celelalte porți | trece | trece |
| **A** | varianta atomică | trece | trece |
| **D** | gol consemnat | trece | trece |

Concurența (C01–C04) rulează cu două sesiuni reale prin `dblink`, B blocată pe lacătul rândului lui A.

| Cod | Cat. | Test | Live (fără patch) | Cu patch |
|---|---|---|---|---|
| P01 | P | editor (modul Ofertare) rescrie motivul unei derogări active [editor] | PICĂ: trece (1 rând) (aserțiuni picate în caz 2/2) | OK: 42501 J05: derogare_depunere / derogare_motiv le poate schimba doar ownerul (Razvan), prin o… (picate 0/2) |
| P02 | P | editor retrage derogarea (true→false) [editor] | PICĂ: trece (1 rând) (aserțiuni picate în caz 2/2) | OK: 42501 J05: derogare_depunere / derogare_motiv le poate schimba doar ownerul (Razvan), prin o… (picate 0/2) |
| P03 | P | editor retrage derogarea și șterge motivul [editor] | PICĂ: trece (1 rând) (aserțiuni picate în caz 2/2) | OK: 42501 J05: derogare_depunere / derogare_motiv le poate schimba doar ownerul (Razvan), prin o… (picate 0/2) |
| P04 | P | editor pre-completează motivul pe o licitație fără derogare (îl preia apoi o acordare doar pe flag) [editor] | PICĂ: trece (1 rând) (aserțiuni picate în caz 2/2) | OK: 42501 J05: derogare_depunere / derogare_motiv le poate schimba doar ownerul (Razvan), prin o… (picate 0/2) |
| P05 | P | viewer (access_level=viewer, ignorat de fn_are_acces_ofertare) rescrie motivul [viewer] | PICĂ: trece (1 rând) (aserțiuni picate în caz 2/2) | OK: 42501 J05: derogare_depunere / derogare_motiv le poate schimba doar ownerul (Razvan), prin o… (picate 0/2) |
| P06 | P | admin de modul Ofertare (non-owner) retrage derogarea [admmod] | PICĂ: trece (1 rând) (aserțiuni picate în caz 2/2) | OK: 42501 J05: derogare_depunere / derogare_motiv le poate schimba doar ownerul (Razvan), prin o… (picate 0/2) |
| P07 | P | editor rescrie motivul DUPĂ depunere (L12 depusă pe derogare) [editor] | PICĂ: trece (1 rând) (aserțiuni picate în caz 2/2) | OK: 42501 J05: licitația 12 este depusă; derogare_depunere / derogare_motiv sunt înghețate d… (picate 0/2) |
| P08 | P | editor retrage derogarea DUPĂ depunere [editor] | PICĂ: trece (1 rând) (aserțiuni picate în caz 2/2) | OK: 42501 J05: licitația 12 este depusă; derogare_depunere / derogare_motiv sunt înghețate d… (picate 0/2) |
| P09 | P | owner (JWT) rescrie motivul DUPĂ depunere [owner] | PICĂ: trece (1 rând) (aserțiuni picate în caz 2/2) | OK: 42501 J05: licitația 12 este depusă; derogare_depunere / derogare_motiv sunt înghețate d… (picate 0/2) |
| P10 | P | owner (JWT) retrage derogarea DUPĂ depunere [owner] | PICĂ: trece (1 rând) (aserțiuni picate în caz 2/2) | OK: 42501 J05: licitația 12 este depusă; derogare_depunere / derogare_motiv sunt înghețate d… (picate 0/2) |
| P11 | P | owner prin RPC reacordă cu alt motiv DUPĂ depunere (live: trece, auditat de RPC) [owner] | PICĂ: trece (1 rând) (aserțiuni picate în caz 2/2) | OK: 42501 J05: licitația 12 este depusă; derogare_depunere / derogare_motiv sunt înghețate d… (picate 0/2) |
| P12 | P | owner prin RPC retrage DUPĂ depunere (live: trece, auditat de RPC) [owner] | PICĂ: trece (1 rând) (aserțiuni picate în caz 2/2) | OK: 42501 J05: licitația 12 este depusă; derogare_depunere / derogare_motiv sunt înghețate d… (picate 0/2) |
| P13 | P | owner pune derogare pe o licitație depusă normal (derogare retroactivă) [owner] | PICĂ: trece (1 rând) (aserțiuni picate în caz 2/2) | OK: 42501 J05: licitația 15 este depusă; derogare_depunere / derogare_motiv sunt înghețate d… (picate 0/2) |
| P14 | P | sesiune postgres + SET ROLE authenticated + claims owner (MCP) rescrie motivul după depunere [owner_mcp] | PICĂ: trece (1 rând) (aserțiuni picate în caz 2/2) | OK: 42501 J05: licitația 12 este depusă; derogare_depunere / derogare_motiv sunt înghețate d… (picate 0/2) |
| P15 | P | sesiune postgres cu claims de non-owner rămase setate (identitatea JWT are prioritate) [admin_claims_editor] | PICĂ: trece (1 rând) (aserțiuni picate în caz 2/2) | OK: 42501 J05: derogare_depunere / derogare_motiv le poate schimba doar ownerul (Razvan), prin o… (picate 0/2) |
| P16 | P | claims cu sub = owner, dar role = „postgres” (doar role=authenticated trece) [rol_strain] | PICĂ: trece (1 rând) (aserțiuni picate în caz 2/2) | OK: 42501 J05: derogare_depunere / derogare_motiv le poate schimba doar ownerul (Razvan), prin o… (picate 0/2) |
| H01 | H | service_role (cheia de backend) rescrie motivul [service] | PICĂ: P0001 Contextul automat (service_role) poate modifica doar termen_depunere/documentatie_adus… (aserțiuni picate în caz 1/2) | OK: 42501 J05: derogare_depunere / derogare_motiv le poate schimba doar ownerul (Razvan), prin o… (picate 0/2) |
| H02 | H | service_role retrage derogarea [service] | PICĂ: P0001 Contextul automat (service_role) poate modifica doar termen_depunere/documentatie_adus… (aserțiuni picate în caz 1/2) | OK: 42501 J05: derogare_depunere / derogare_motiv le poate schimba doar ownerul (Razvan), prin o… (picate 0/2) |
| H03 | H | anon printr-un RPC SECURITY DEFINER (ocolește RLS) [anon] | PICĂ: P0001 Contextul curent nu poate modifica o licitație (aserțiuni picate în caz 1/2) | OK: 42501 J05: derogare_depunere / derogare_motiv le poate schimba doar ownerul (Razvan), prin o… (picate 0/2) |
| H04 | H | utilizator cu modulul financiar (trece de RLS) rescrie motivul [financiar] | PICĂ: P0001 Modulul financiar poate modifica doar contract_id pe o licitație (aserțiuni picate în caz 1/2) | OK: 42501 J05: derogare_depunere / derogare_motiv le poate schimba doar ownerul (Razvan), prin o… (picate 0/2) |
| H05 | H | claims authenticated FĂRĂ sub, prin RPC definer [fara_sub] | PICĂ: P0001 Contextul curent nu poate modifica o licitație (aserțiuni picate în caz 1/2) | OK: 42501 J05: derogare_depunere / derogare_motiv le poate schimba doar ownerul (Razvan), prin o… (picate 0/2) |
| H06 | H | claims authenticated cu sub fără profil, prin RPC definer [sub_fantoma] | PICĂ: P0001 Contextul curent nu poate modifica o licitație (aserțiuni picate în caz 1/2) | OK: 42501 J05: derogare_depunere / derogare_motiv le poate schimba doar ownerul (Razvan), prin o… (picate 0/2) |
| H07 | H | login authenticator cu claims golite, prin RPC definer [authenticator_gol] | PICĂ: P0001 Contextul curent nu poate modifica o licitație (aserțiuni picate în caz 1/2) | OK: 42501 J05: derogare_depunere / derogare_motiv le poate schimba doar ownerul (Razvan); conexi… (picate 0/2) |
| H08 | H | login supabase_auth_admin fără claims, prin RPC definer [auth_admin_gol] | PICĂ: P0001 Contextul curent nu poate modifica o licitație (aserțiuni picate în caz 1/2) | OK: 42501 J05: derogare_depunere / derogare_motiv le poate schimba doar ownerul (Razvan); conexi… (picate 0/2) |
| R01 | R | owner prin RPC ofertare_derogare_depunere acordă derogarea (L10) [owner] | OK: trece (1 rând) (aserțiuni picate în caz 0/8) | OK: trece (1 rând) (picate 0/8) |
| R02 | R | owner pune „depusa” după RPC [owner] | OK: trece (1 rând) (aserțiuni picate în caz 0/7) | OK: trece (1 rând) (picate 0/7) |
| P17 | P | după R02: owner rescrie motivul (UPDATE direct) [owner] | PICĂ: trece (1 rând) (aserțiuni picate în caz 1/1) | OK: 42501 J05: licitația 10 este depusă; derogare_depunere / derogare_motiv sunt înghețate d… (picate 0/1) |
| P18 | P | după R02: owner retrage prin RPC [owner] | PICĂ: trece (1 rând) (aserțiuni picate în caz 1/1) | OK: 42501 J05: licitația 10 este depusă; derogare_depunere / derogare_motiv sunt înghețate d… (picate 0/1) |
| P19 | P | după R02: editor retrage [editor] | PICĂ: trece (1 rând) (aserțiuni picate în caz 2/2) | OK: 42501 J05: licitația 10 este depusă; derogare_depunere / derogare_motiv sunt înghețate d… (picate 0/2) |
| R03 | R | editor depune pe derogarea acordată de owner (flux legitim) [editor] | OK: trece (1 rând) (aserțiuni picate în caz 0/2) | OK: trece (1 rând) (picate 0/2) |
| R04 | R | editor modifică alte câmpuri pe o licitație cu derogare [editor] | OK: trece (1 rând) (aserțiuni picate în caz 0/1) | OK: trece (1 rând) (picate 0/1) |
| R05 | R | editor retrimite derogare_* NESCHIMBATE împreună cu alt câmp (ca un formular) [editor] | OK: trece (1 rând) (aserțiuni picate în caz 0/1) | OK: trece (1 rând) (picate 0/1) |
| R06 | R | depunere normală (J02 satisfăcută, fără derogare) [editor] | OK: trece (1 rând) (aserțiuni picate în caz 0/2) | OK: trece (1 rând) (picate 0/2) |
| R07 | R | poarta J02 intactă: depunere fără pachet depus, fără derogare [editor] | OK: P0001 BLOCAT LA DEPUNERE: lipseste pachetul PT in stare depus pentru licitatia 13. (aserțiuni picate în caz 0/2) | OK: P0001 BLOCAT LA DEPUNERE: lipseste pachetul PT in stare depus pentru licitatia 13. (picate 0/2) |
| R08 | R | R07 intactă: non-ownerul nu poate ACORDA derogarea [editor] | OK: 42501 Derogarea de la poarta de depunere o poate da doar ownerul (Razvan). (aserțiuni picate în caz 0/2) | OK: 42501 J05: derogare_depunere / derogare_motiv le poate schimba doar ownerul (Razvan), prin o… (picate 0/2) |
| R09 | R | RPC-ul refuză non-ownerul [editor] | OK: 42501 Derogarea de la poarta de depunere o poate da doar ownerul (Razvan). (aserțiuni picate în caz 0/2) | OK: 42501 Derogarea de la poarta de depunere o poate da doar ownerul (Razvan). (picate 0/2) |
| R10 | R | service_role mută termen_depunere (veghea SEAP) — lista albă a lui a00 intactă [service] | OK: trece (1 rând) (aserțiuni picate în caz 0/1) | OK: trece (1 rând) (picate 0/1) |
| R11 | R | a00 intact: service_role nu scrie alte câmpuri [service] | OK: P0001 Contextul automat (service_role) poate modifica doar termen_depunere/documentatie_adus… (aserțiuni picate în caz 0/1) | OK: P0001 Contextul automat (service_role) poate modifica doar termen_depunere/documentatie_adus… (picate 0/1) |
| R12 | R | financiar leagă contract_id (GBE) — lista albă a lui a00 intactă [financiar] | OK: trece (1 rând) (aserțiuni picate în caz 0/1) | OK: trece (1 rând) (picate 0/1) |
| R13 | R | cont fără modul: RLS îl filtrează (0 rânduri, nicio eroare) [nomod] | OK: trece (0 rânduri) (aserțiuni picate în caz 0/2) | OK: trece (0 rânduri) (picate 0/2) |
| R14 | R | anon direct: RLS îl filtrează (0 rânduri) [anon] | OK: trece (0 rânduri) (aserțiuni picate în caz 0/2) | OK: trece (0 rânduri) (picate 0/2) |
| R15 | R | service_role nu are EXECUTE pe RPC [service] | OK: 42501 permission denied for function ofertare_derogare_depunere (aserțiuni picate în caz 0/1) | OK: 42501 permission denied for function ofertare_derogare_depunere (picate 0/1) |
| R16 | R | anon nu are EXECUTE pe RPC [anon] | OK: 42501 permission denied for function ofertare_derogare_depunere (aserțiuni picate în caz 0/1) | OK: 42501 permission denied for function ofertare_derogare_depunere (picate 0/1) |
| R17 | R | administrare fără JWT (postgres: MCP / SQL editor) repară motivul după depunere [admin] | OK: trece (1 rând) (aserțiuni picate în caz 0/2) | OK: trece (1 rând) (picate 0/2) |
| R18 | R | supabase_admin fără claims: garda îl lasă, a00 îl oprește în continuare (doar postgres e admin acolo) [supabase_admin_gol] | OK: P0001 Contextul curent nu poate modifica o licitație (aserțiuni picate în caz 0/2) | OK: P0001 Contextul curent nu poate modifica o licitație (picate 0/2) |
| R19 | R | owner acordă derogarea prin UPDATE direct (fără RPC) [owner] | OK: trece (1 rând) (aserțiuni picate în caz 0/2) | OK: trece (1 rând) (picate 0/2) |
| R20 | R | MCP care se dă drept owner (postgres + JWT owner), înainte de depunere [owner_mcp] | OK: trece (1 rând) (aserțiuni picate în caz 0/1) | OK: trece (1 rând) (picate 0/1) |
| R21 | R | RPC-ul validează în continuare motivul (min. 10 caractere) [owner] | OK: 22023 Motivul derogării trebuie să aibă minimum 10 caractere. (aserțiuni picate în caz 0/1) | OK: 22023 Motivul derogării trebuie să aibă minimum 10 caractere. (picate 0/1) |
| A01 | A | owner (JWT, ca PostgREST): UPDATE {derogare_depunere:true, derogare_motiv:M, status:depusa} pe L13 (fără pachet: J02 ar bloca) [owner] | OK: trece (1 rând) (aserțiuni picate în caz 0/11) | OK: trece (1 rând) (picate 0/11) |
| A02 | A | reluare: al doilea UPDATE identic [owner] | OK: trece (1 rând) (aserțiuni picate în caz 0/3) | OK: trece (1 rând) (picate 0/3) |
| P20 | P | reluare cu ALT motiv după depunerea atomică (live: rescrie motivul fără audit) [owner] | PICĂ: trece (1 rând) (aserțiuni picate în caz 2/2) | OK: 42501 J05: licitația 13 este depusă; derogare_depunere / derogare_motiv sunt înghețate d… (picate 0/2) |
| A03 | A | R5 blochează și varianta atomică (derogarea nu ocolește R5) [owner] | OK: P0001 BLOCAT LA DEPUNERE — cantități de verificat: total_invalidate = 1; verifică și v… (aserțiuni picate în caz 0/4) | OK: P0001 BLOCAT LA DEPUNERE — cantități de verificat: total_invalidate = 1; verifică și v… (picate 0/4) |
| A03.c | A | după rezolvarea R5, reluarea ACELUIAȘI UPDATE atomic trece [owner] | OK: trece (1 rând) (aserțiuni picate în caz 0/4) | OK: trece (1 rând) (picate 0/4) |
| A04 | A | varianta atomică încercată de non-owner [editor] | OK: 42501 Derogarea de la poarta de depunere o poate da doar ownerul (Razvan). (aserțiuni picate în caz 0/2) | OK: 42501 J05: derogare_depunere / derogare_motiv le poate schimba doar ownerul (Razvan), prin o… (picate 0/2) |
| A05 | A | al doilea eveniment de audit eșuează ⇒ tot UPDATE-ul cade [owner] | OK: 23514 new row for relation "ofertare_derogari_audit" violates check constraint "t_esec_j05" (aserțiuni picate în caz 0/2) | OK: 23514 new row for relation "ofertare_derogari_audit" violates check constraint "t_esec_j05" (picate 0/2) |
| A06 | A | varianta atomică prin MCP (postgres + SET ROLE authenticated + claims owner) [owner_mcp] | OK: trece (1 rând) (aserțiuni picate în caz 0/3) | OK: trece (1 rând) (picate 0/3) |
| A07 | A | varianta atomică din admin fără JWT [admin] | OK: trece (1 rând) (aserțiuni picate în caz 0/2) | OK: trece (1 rând) (picate 0/2) |
| A08 | A | varianta atomică pe o derogare DEJA acordată (L11, motiv M0) cu motiv nou [owner] | OK: trece (1 rând) (aserțiuni picate în caz 0/2) | OK: trece (1 rând) (picate 0/2) |
| D01 | D | GOL: owner retrage prin UPDATE direct (fără RPC), înainte de depunere [owner] | OK: trece (1 rând) (aserțiuni picate în caz 0/2) | OK: trece (1 rând) (picate 0/2) |
| D02 | D | GOL: owner schimbă motivul prin UPDATE direct, flagul rămâne true [owner] | OK: trece (1 rând) (aserțiuni picate în caz 0/2) | OK: trece (1 rând) (picate 0/2) |
| D03 | D | GOL: non-owner creează o licitație cu derogare_motiv completat (garda e doar pe UPDATE) [editor] | OK: trece (1 rând) (aserțiuni picate în caz 0/1) | OK: trece (1 rând) (picate 0/1) |
| D04 | D | admin fără JWT retrage după depunere (calea de reparație) [admin] | OK: trece (1 rând) (aserțiuni picate în caz 0/2) | OK: trece (1 rând) (picate 0/2) |
| D05 | D | LIMITARE: după depusa → castigata, ownerul poate edita iar (înghețul e pe status = depusa) [owner] | OK: trece (1 rând) (aserțiuni picate în caz 0/1) | OK: trece (1 rând) (picate 0/1) |
| D06 | D | GOL: varianta atomică FĂRĂ motiv (motivul se validează doar în RPC) [owner] | OK: trece (1 rând) (aserțiuni picate în caz 0/2) | OK: trece (1 rând) (picate 0/2) |
| C01 | A | două sesiuni owner, același UPDATE atomic (READ COMMITTED): B așteaptă lacătul, apoi trece fără efect | OK: A: trece (1) · B: trece (1) (aserțiuni picate în caz 0/3) | OK: A: trece (1) · B: trece (1) (picate 0/3) |
| C02 | P | cursă: B (owner) trimite același UPDATE atomic cu ALT motiv; după COMMIT-ul lui A licitația e deja depusă | PICĂ: A: trece (1) · B: trece (1) (aserțiuni picate în caz 2/3) | OK: A: trece (1) · B: 42501 J05: licitația 21 este depusă; derogare_depunere / derogare_motiv… (picate 0/3) |
| C03 | P | cursă: editorul rescrie motivul exact în timp ce ownerul depune | PICĂ: A: trece (1) · B: trece (1) (aserțiuni picate în caz 2/2) | OK: A: trece (1) · B: 42501 J05: licitația 22 este depusă; derogare_depunere / derogare_motiv… (picate 0/2) |
| C04 | A | B în REPEATABLE READ (instantaneu luat înainte de COMMIT-ul lui A): 40001, apoi reluarea trece fără efect | OK: B: 40001 could not serialize access due to concurrent update · reluare: trece (1) (aserțiuni picate în caz 0/2) | OK: B: 40001 could not serialize access due to concurrent update · reluare: trece (1) (picate 0/2) |

## 5. Varianta atomică: ce arată testul

Varianta: un singur `UPDATE` al ownerului, `SET derogare_depunere = true, derogare_motiv = M, status = 'depusa'`. Testul folosește L13, o licitație fără pachet și fără cerințe, pe care J02 ar bloca-o fără derogare. Rezultatele sunt aceleași pe live și pe patch.

1. **Exact 2 evenimente (A01):** `derogare_acordata`, apoi `depusa_pe_derogare`, în aceeași tranzacție (același `creat_la`).
   - Ambele au `motiv = M`, egalitate de text și același SHA-256. M conține diacritice, „ghilimele” și o linie nouă.
   - `actor` = ownerul (JWT), `session_user_name = authenticator`.
   - **Ambele** au `status_vechi = in_lucru` și `status_nou = depusa`. Atenție: în varianta în doi pași, `derogare_acordata` are `in_lucru → in_lucru` (R01).
2. **Celelalte porți se comportă ca live:**
   - J02 e sărită prin derogare, cum e proiectată;
   - **R5 blochează și varianta atomică** (A03, `P0001`);
   - R07 refuză un non-owner (A04);
   - a00 lasă ownerul să treacă.
3. **Refuzul nu lasă modificări parțiale:**
   - la R5 (A03), la non-owner (A04) și la eșecul celui de-al doilea eveniment de audit (A05: un CHECK temporar face să cadă `depusa_pe_derogare`) nu rămâne nimic;
   - în A05 dispare și `derogare_acordata`, deja scris în același statement.
   - După ce R5 e rezolvat, reluarea aceluiași `UPDATE` trece cu **exact 2** evenimente (A03.c/d): tentativa refuzată n-a lăsat nimic.
4. **Reluarea:**
   - un al doilea `UPDATE` identic e no-op: 0 evenimente noi, rândul neschimbat (A02);
   - în `REPEATABLE READ`, sesiunea concurentă primește `40001`, iar reluarea e no-op (C04).
5. **Concurența** (două sesiuni owner, `READ COMMITTED`): B așteaptă lacătul lui A, apoi trece fără efect. Rămân 2 evenimente, nu 4 (C01).
6. **Nu presupune că rulează ambele ramuri (A08).** Dacă derogarea e **deja acordată** (flag `true`, de exemplu prin RPC mai devreme) și `UPDATE`-ul atomic vine cu un motiv NOU, iese **un singur** eveniment: `depusa_pe_derogare` cu motivul nou. Nu se scrie `derogare_acordata`, iar schimbarea de motiv nu e jurnalizată separat.
7. **„Owner nominal” cere JWT.**
   - Din administrare fără JWT: `actor = NULL` (A07).
   - Prin MCP în numele ownerului (`SET ROLE authenticated` + claims): `actor = owner`, `session_user_name = postgres` (A06).
8. **Motivul nu e validat pe server** în afara RPC-ului. Varianta atomică fără motiv produce 2 evenimente cu `NULL` (D06).
9. **Nu închide editarea după depunere.** Pe live:
   - o reluare cu alt motiv rescrie coloana fără audit (P20);
   - în cursă, un al doilea owner (C02) sau un editor (C03) rescrie motivul imediat după depunere.

   Toate trec pe live și sunt refuzate de patch.

**Verdict: preferabilă variantei în doi pași (RPC, apoi `status='depusa'`).**

- (a) Nu are fereastră între acordare și depunere. Pe live, în acea fereastră un non-owner poate rescrie motivul (P01), iar `depusa_pe_derogare` ar copia motivul rescris.
- (b) Un singur statement, atomic inclusiv cu R5.
- (c) Aceeași dovadă: 2 evenimente, același motiv.

**Condiții:**

- (1) `derogare_depunere = false` înainte de `UPDATE`, altfel iese 1 eveniment (A08);
- (2) identitatea owner prin JWT (PostgREST sau MCP cu claims), altfel `actor NULL` (A07);
- (3) M verificat de om înainte, iar după aceea SHA-256-ul din audit comparat cu al lui M, pentru că serverul nu validează motivul (D06).

Cu patch-ul aplicat, ambele variante sunt sigure până la depunere. Varianta atomică rămâne preferabilă pentru (a) și (b); varianta în doi pași are în schimb validarea motivului pe server (minimum 10 caractere). Alegerea e a lui Răzvan, cu poarta Copilot.

## 6. Golul: retragerea directă făcută de owner

**Verificare (live, 30.09):** `fn_gate_depunere` scrie în `ofertare_derogari_audit` doar pe două ramuri:

- (1) flagul trece `false → true` → `derogare_acordata`;
- (2) statusul trece în `depusa` cu flagul `true` → `depusa_pe_derogare`.

Nu există ramură pentru `true → false` și nici pentru schimbarea motivului cu flagul `true`. `derogare_retrasa` e scris **doar** de RPC-ul `ofertare_derogare_depunere`. Testele D01 (retragere directă) și D02 (motiv schimbat direct) arată 0 evenimente, pe live și pe patch.

**Patch-ul nu închide golul:** conform cererii, golul e documentat, iar CHECK-ul nu e extins. De reținut: **retragerea nu cere extinderea CHECK-ului**, pentru că `derogare_retrasa` există deja. Doar un eveniment separat pentru „motiv schimbat” ar cere o acțiune nouă.

Variantele de mai jos sunt o decizie separată și nu se fac în freeze:

- **A.** Garda scrie `derogare_retrasa` la `true → false` făcut direct de owner, iar RPC-ul încetează să-l mai scrie, ca să nu apară dubluri.
  - Modifică RPC-ul; schema rămâne neschimbată.
  - Schimbarea de motiv cu flagul `true` rămâne neacoperită, sau se jurnalizează ca `derogare_acordata`, ca reconfirmarea din RPC.
- **B.** Garda refuză orice schimbare directă a ownerului, cu excepția acordării (`false → true`, jurnalizată de poartă). Retragerea și schimbarea de motiv trec doar prin RPC.
  - Garda trebuie să distingă „în RPC” de „UPDATE direct” fără un semnal falsificabil. Nu merge cu un GUC, pe care apelantul îl poate seta.
  - Exemplu: RPC-ul își scrie rândul de audit ÎNAINTE de `UPDATE`, iar garda acceptă doar dacă rândul corespunzător există în aceeași tranzacție. `authenticated` nu are `INSERT` pe audit, deci semnalul nu se poate falsifica.
  - Modifică RPC-ul.
- **C.** Acceptare explicită: calea e doar a ownerului și rară; auditul rămâne sursa de adevăr; interogarea de divergență din §10 rulează periodic.

## 7. Riscuri pentru fluxurile legitime

**Cine scrie `derogare_*` în cod.** `git grep -nE 'derogare_(depunere|motiv)|ofertare_derogare_depunere|derogari_audit' -- src supabase/functions api worker` pe `main` @ `76fd89d` → **0 rezultate**. Niciun ecran, edge function, rută API sau worker nu scrie aceste coloane. Toate scrierile din cod pe `ofertare_licitatii` au payload explicit, fără `derogare_*`:

- `OfertareLicitatii.jsx`: formularul, `schimbaStatus`, `decide` GO/NO-GO, responsabil / regim, identificatorii SEAP, promovarea din radar;
- `GbeEvidenta.jsx`: `contract_id`;
- `ofertare-seap-veghe`: `termen_depunere`;
- `ofertare-seap-import` și `api/seap-import.js`: `documentatie_adusa_la`.

Pe toate acestea garda iese imediat (R04, R10, R12).

**În BD.** Căutarea în `pg_proc.prosrc` pe live: singura funcție care face `UPDATE ofertare_licitatii` și atinge `derogare_*` e RPC-ul `ofertare_derogare_depunere`. Poarta doar citește.

**Refuzuri noi pentru owner.** După `depusa`, orice schimbare pe `derogare_*`, inclusiv retragerea sau reacordarea prin RPC, care pe live trec auditate (P11, P12). Reparația se face doar din administrare fără JWT, nejurnalizată, deci trebuie documentată.

**Ordinea față de J07.** `20261003a_ofertare_poarta_server_jakv2p3` (branch `jak/v2-j07-poarta-server`, planificat după 02.10) modifică chirurgical `fn_gate_depunere`.

- Dacă J07 intră **înainte**, migrarea asta refuză (md5 diferit) și trebuie reauditată, cu md5 nou.
- Dacă garda intră înainte, J07 nu e afectat: nu verifică triggerele de pe `ofertare_licitatii`.

**Triggere viitoare.** Un trigger `BEFORE UPDATE` nou care ar scrie `derogare_*` și ar veni înaintea gărzii în ordinea alfabetică ar ocoli-o. Precondiția prinde asta doar la momentul aplicării, deci e o regulă de review.

**Lacăt.** `CREATE OR REPLACE TRIGGER` ia `SHARE ROW EXCLUSIVE` pe `ofertare_licitatii`. Cu `lock_timeout = 5s`, migrarea cade curat dacă o tranzacție lungă ține tabela.

**Performanță.** Neglijabilă: garda iese imediat dacă `derogare_*` nu se schimbă.

**`supabase_admin`.** Trece de gardă (e login de administrare), dar a00 îl oprește în continuare (R18). Comportamentul exista și înainte.

## 8. Pașii de apply

**Nu se aplică fără toate trei:**

- (1) **GO Copilot** pe acest document, pe diff-ul celor 4 fișiere și pe ieșirea testului (trimise integral în chat);
- (2) **acordul explicit al lui Răzvan**;
- (3) **EXCEPȚIE DE FREEZE pe Ofertare**, acordată de Răzvan pe domeniul exact al acestui fișier. Freeze-ul ține până după depunerea Jilava, 02.10.2026 12:00.

**Pași:**

1. **Sync și test local:** `git pull --ff-only`, apoi `bash scripts/test_j05_garda.sh` → `PASS`.
2. **Preview read-only** (`execute_sql`):

   ```sql
   -- a) precondițiile: se rulează interogarea de amprente din migrare (constanta v_q din blocul $pre$), read-only.
   --    Așteptat: fn_ok = true pe gate/rpc/a00/acces/owner/imuabil (garda: absentă), trg_licitatii = setul live,
   --    trg_audit și chk = valorile din blocul $pre$, coloane = 4. Rezumat rapid pe corpuri (md5(prosrc), independent de versiune):
   SELECT proname, md5(prosrc) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
     AND proname IN ('fn_gate_depunere','ofertare_derogare_depunere','fn_ofertare_licitatii_scriere','fn_are_acces_ofertare',
                     'fn_gate_depunere_derogare_owner','fn_ofertare_derogari_audit_imuabil','fn_ofertare_derogare_garda_j05') ORDER BY 1;
   -- 4bddf68c… gate · 50656c3c… rpc · 7d7591ef… a00 · 429d28e2… acces · e97f0911… owner · 22bab03f… imuabil · (garda lipsă)
   -- b) date (read-only): derogările existente vs ultimul eveniment de audit (ce va îngheța garda)
   SELECT l.id, l.nr_anunt, l.status, l.derogare_depunere,
          encode(sha256(convert_to(l.derogare_motiv, 'UTF8')), 'hex') AS sha_coloana,
          a.actiune AS ultimul_eveniment, encode(sha256(convert_to(a.motiv, 'UTF8')), 'hex') AS sha_audit, a.creat_la
   FROM public.ofertare_licitatii l
   LEFT JOIN LATERAL (SELECT x.actiune, x.motiv, x.creat_la FROM public.ofertare_derogari_audit x
                      WHERE x.licitatie_id = l.id ORDER BY x.id DESC LIMIT 1) a ON true
   WHERE l.derogare_depunere OR l.derogare_motiv IS NOT NULL OR a.actiune IS NOT NULL
   ORDER BY l.id;
   -- c) Jilava (93): starea derogării (condiția (1) a variantei atomice: flag false înainte)
   SELECT id, status, derogare_depunere, derogare_motiv IS NOT NULL AS are_motiv FROM public.ofertare_licitatii WHERE id = 93;
   -- d) nimeni nu ține tabela (altfel lock_timeout)
   SELECT pid, mode, granted, now() - xact_start AS de_cand FROM pg_locks l JOIN pg_stat_activity USING (pid)
   WHERE l.relation = 'public.ofertare_licitatii'::regclass;
   ```

3. **Apply (runda 4, §14):** `bash scripts/livrare_migrare.sh supabase/migrations/20261001a_ofertare_derogare_garda_j05.sql -- "<URI postgres>"` — gestionarul unic: `psql --single-transaction` [marcaj + migrare + `INSERT` în `supabase_migrations.schema_migrations`].
   - Fișierul NU mai are `BEGIN`/`COMMIT`; NU `apply_migration` / `execute_sql` (garda de livrare le refuză, fail-closed).
   - Precondițiile, verificarea finală și înregistrarea sunt în aceeași tranzacție cu DDL-ul: orice eșec (inclusiv chiar la înregistrare) anulează tot.
   - Migrarea trebuie să ruleze ca `postgres`. Verificarea finală refuză altă identitate ca proprietar al funcției `SECURITY DEFINER` și anulează tot.
4. **Sanity după apply** (read-only):

   ```sql
   SELECT md5(prosrc) = 'f84c9aeeb80fd990ee6f5110865a1aac' AS corp_patch, prosecdef, proconfig, proacl
   FROM pg_proc WHERE oid = 'public.fn_ofertare_derogare_garda_j05()'::regprocedure;
   SELECT tgname, tgfoid::regprocedure, tgtype, tgenabled, tgqual IS NULL AS fara_when FROM pg_trigger
   WHERE tgrelid = 'public.ofertare_licitatii'::regclass AND NOT tgisinternal ORDER BY tgname COLLATE "C";
   -- așteptat: a00_ofertare_derogare_garda_j05 (19, O) primul, apoi a00_ofertare_licitatii_scriere (19, O), trg_gate_depunere (23, O)
   -- + interogarea a) de la pasul 2: true pe toate coloanele de funcții (migrarea nu atinge poarta / RPC-ul / a00);
   --   coloana `triggere` devine false, cum e normal: acum sunt 3 triggere (garda + cele 2 live, cu md5-urile de mai sus)
   ```

5. **Smoke opțional**, doar cu acordul lui Răzvan: pe clona 103, într-o tranzacție anulată, niciodată pe 93. `<uuid>` = profilul unui non-owner care are modulul Ofertare, ales de Răzvan.

   ```sql
   BEGIN;
   SET LOCAL ROLE authenticated;
   SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"<uuid>"}', true);
   UPDATE public.ofertare_licitatii SET derogare_motiv = coalesce(derogare_motiv, '') || ' [smoke J05]' WHERE id = 103;  -- așteptat: 42501 J05
   ROLLBACK;
   ```

6. **În aceeași sesiune:**
   - `claude_docs.registru_automatizari`, cu fișa de mai jos;
   - `handoff_activ`;
   - rând nou în jurnalul `COPILOT_HANDOFF.md` și în `handoff_copilot`;
   - lecție în `claude_context`.

**Fișa pentru `registru_automatizari`** (trigger nou, CLAUDE.md pct. 7):

- (a) conținut extern citit: niciunul (doar claims JWT, `session_user` și `profiles.is_owner`);
- (b) ce scrie: nimic, doar refuză (`42501`);
- (c) cu ce identitate rulează: `SECURITY DEFINER`, proprietar `postgres`, doar ca să citească `is_owner` independent de RLS; nu ocolește altceva și nu scrie;
- (d) cine o pornește: orice `UPDATE` pe `ofertare_licitatii`; verificarea de rol e în cod (owner JWT / login admin fără claims);
- (e) confirmare umană: nu e cazul, e o poartă de refuz.

## 9. Rollback

**Rollback TEHNIC (redeschide J05), doar la cererea explicită a lui Răzvan:**

Fișierul e în `supabase/revenire/` (nu e migrare) și nu are `BEGIN`/`COMMIT`: gestionarul tranzacției e operatorul, care trimite **un singur string**:

```sql
BEGIN;
SELECT set_config('gazpet.rollback_20261001a', 'SCOATE_GARDA_J05:' || txid_current(), true);
-- conținutul supabase/revenire/20261001a_ofertare_derogare_garda_j05_ROLLBACK.sql
COMMIT;
```

Comportament verificat de test (o singură sesiune psql, detaliile în §13):

- armare persistentă (`ALTER ROLE/DATABASE … SET`, orice majuscule) → refuz;
- fără armare, `SET` de sesiune (inclusiv valoarea veche), `set_config(…, false)` dintr-o tranzacție anterioară → refuz;
- armare + eroare + rollback, apoi reluare fără armare nouă → refuz;
- gardă modificată după patch (amprentă diferită) → refuz;
- armat corect → aplicat, dezarmat în aceeași tranzacție; a doua rulare → no-op;
- după rollback: schema identică cu cea de dinainte (`pg_dump`), iar gaura reapare exact ca pe live.

**Ordinea rollback-urilor:** `20261001a_ROLLBACK` se rulează **înaintea** lui `20260929b_ofertare_derogare_audit_ROLLBACK`.

- Rollback-ul auditului J05 face `DROP COLUMN derogare_motiv`, iar garda citește `NEW.derogare_motiv`.
- Cu garda încă instalată, orice `UPDATE` pe `ofertare_licitatii` ar cădea la execuție.
- În practică, rollback-ul 20260929b refuză oricum cât există audit sau motive salvate, deci după Jilava refuză sigur. Ordinea rămâne totuși regula.

**Revenire fără gaură:** nu e nevoie de un fișier separat. Un flux legitim refuzat de gardă îl face ownerul (JWT, înainte de depunere) sau administrarea fără JWT, documentat.

## 10. Alternativa: acceptarea explicită a riscului

Dacă Răzvan nu dă excepția de freeze, până la apply rămâne deschis:

- cei 9 non-owneri pot rescrie motivul sau retrage derogarea (P01–P08);
- după depunere, oricine are modulul, inclusiv ownerul, poate rescrie `derogare_*` fără audit (P07–P12, P20, C02, C03);
- în varianta în doi pași, o rescriere între RPC și `depusa` ajunge chiar în `depusa_pe_derogare`.

**Compensări:**

- (1) Jilava se depune cu varianta atomică, în condițiile din §5.
- (2) `ofertare_derogari_audit` e **singura sursă de adevăr** pentru motiv (append-only; nici aplicația, nici `postgres` nu pot face `UPDATE`/`DELETE`/`TRUNCATE`).
- (3) Interogarea de mai jos rulează după depunere și zilnic, până la apply.
- (4) Patch-ul se aplică imediat după freeze, înainte de J07, sau se reauditează md5-ul.

Decizia trebuie să fie explicită și consemnată: `claude_context`, handoff și jurnalul Copilot.

```sql
-- divergențe coloană ↔ ultimul eveniment de audit (read-only)
SELECT l.id, l.nr_anunt, l.status, l.derogare_depunere, a.actiune AS ultimul_eveniment, a.creat_la,
       l.derogare_motiv IS DISTINCT FROM a.motiv AS motiv_divergent,
       l.derogare_depunere IS DISTINCT FROM (a.actiune <> 'derogare_retrasa') AS flag_divergent
FROM public.ofertare_licitatii l
JOIN LATERAL (SELECT x.actiune, x.motiv, x.creat_la FROM public.ofertare_derogari_audit x
              WHERE x.licitatie_id = l.id ORDER BY x.id DESC LIMIT 1) a ON true
WHERE l.derogare_motiv IS DISTINCT FROM a.motiv OR l.derogare_depunere IS DISTINCT FROM (a.actiune <> 'derogare_retrasa');
-- derogare / motiv fără niciun eveniment de audit
SELECT id, nr_anunt, status, derogare_depunere, derogare_motiv IS NOT NULL AS are_motiv FROM public.ofertare_licitatii l
WHERE (derogare_depunere OR derogare_motiv IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM public.ofertare_derogari_audit a WHERE a.licitatie_id = l.id);
```

Limita: detecția arată **că** s-a schimbat ceva, nu **cine** a schimbat. Tocmai de aceea e nevoie de prevenție.

## 11. Rulare locală

```bash
bash scripts/test_j05_garda.sh          # PG16, 127.0.0.1:5481, PGDATA /tmp/pg_j05garda/data, baza j05_garda_test
KEEP=1 bash scripts/test_j05_garda.sh   # lasă clusterul pornit; PGPORT / PGBASE se pot schimba
```

- **Harness-ul refuză:** un port ocupat de alt cluster (compară `data_directory`), un server care nu e PG16 și bazele care nu sunt dedicate. Recreează baza la fiecare fază. Nu citește `.env` și nu atinge Supabase.
- **Ieșiri:** `$PGBASE/iesiri/*.out(.rez)`; tabelul Markdown în `$PGBASE/rezultate.md`.
- **Scheletul** conține copiile `pg_get_functiondef` ale funcțiilor live și verifică la setup că md5-urile (funcții, triggere, CHECK/FK/PK pe audit, politici RLS) și ACL-urile sunt identice cu cele live din 30.09.
  - Dependențele lui R5 sunt ciot de fixture; codul R5 e cel live.
  - `auth.uid()`, `auth.role()` și `auth.jwt()` sunt tot copiile live. Au un spațiu semnificativ după `select`, pe care md5-ul îl verifică.
- **Identitățile** sunt simulate ca în PostgREST, la fel ca testele S-A și sec-ofertare:
  - `SET SESSION AUTHORIZATION authenticator` + `SET ROLE <rol>` + `request.jwt.claims`;
  - „owner_mcp” = sesiune `postgres` + `SET ROLE authenticated` + claims owner.

## 12. Ce rămâne deschis

- Golul retragerii / schimbării de motiv făcute de owner prin `UPDATE` direct (§6): decizia A/B/C, după freeze.
- `INSERT` neacoperit (D03); înghețul doar pe `depusa` (D05); motivul nevalidat în afara RPC-ului (D06); reparațiile admin nejurnalizate (R17, D04).
- Preview-ul pe date (starea lic. 93, divergențele existente) **nu a fost rulat**: permisiunea acestei sarcini a fost doar SELECT pe cataloage. E pasul 2 din §8.
- Testul nu e în CI (`.github/workflows/ofertare-regresie.yml`); se poate adăuga după merge.
- **Fidelitatea mediului:**
  - live e PG 17.6, testul rulează pe PG 16.13; toate md5-urile și ACL-urile copiate coincid, deci formatarea `pg_get_*` e aceeași;
  - PostgREST real nu a fost exercitat; identitățile sunt simulate ca mai sus.
- **Ordinea față de J07:** dacă J07 intră primul, precondiția pe `fn_gate_depunere` trebuie reauditată (md5 nou).

## 13. Aliniere la standardul Copilot (30.09)

Standardul cerut de Copilot la NO-GO-urile din runda 2 pe #537 și #538, aplicat pe J05. Rularea din 30.09: `VECHI=<varianta anterioară> bash scripts/test_j05_garda.sh`, **de 2 ori, exit 0**, cu 53 de verificări de harness pe rulare, plus aserțiunile live/patch (150 / 152).

| Cerință | Ce s-a schimbat | Test | Rezultat |
|---|---|---|---|
| Amprente independente de versiunea PG | Funcțiile: `md5(prosrc)` + `SECURITY DEFINER`, `proconfig` exact, proprietar, limbaj, volatilitate, STRICT/LEAKPROOF/PARALLEL/COST/ROWS, fără supraîncărcări, argumente, tip întors, ACL sortat. Valorile `prosrc` sunt citite read-only din live (PG17.6) și coincid pe PG16. Triggerele: nume, funcția țintă, `tgtype`, `tgenabled`, `tgqual IS NULL`, `tgattr`. CHECK-ul: `contype` + `conkey` + `md5(pg_get_constraintdef)`; md5-ul e citit din PG17 și coincide cu PG16. Dacă o versiune viitoare deparsează altfel, precondiția **refuză** (fail-closed): operatorul compară textul CHECK-ului cu antetul și schimbă amprenta doar prin commit revizuit. | Faza 4: COST, corp, proprietar, ACL lărgit, `SECURITY INVOKER`, `search_path` resetat, supraîncărcare, trigger nou / dezactivat / cu WHEN, CHECK extins | toate refuzate, fără urme |
| NULL-safe | Toate comparațiile de amprente folosesc `IS DISTINCT FROM`; obiect lipsă = NULL = refuz | Funcție lipsă (redenumită), niciun trigger, CHECK lipsă; mutanți cu `<>` / `=` | refuz; mutanții sunt prinși |
| Postcondiție înainte de COMMIT, cu privilegii efective | Toate amprentele + `has_function_privilege` (include PUBLIC și moștenirea) pentru anon / authenticated / PUBLIC pe gardă și pe funcțiile de trigger ale porții (poartă, a00, helper owner, append-only) | anon cu `INHERIT` + membru `service_role` (ACL-ul direct nu se schimbă); mutant fără `REVOKE`; mutant cu corpul schimbat | refuz înainte de COMMIT, nimic comis |
| Un singur gestionar de tranzacție | Fișierul păstrează `BEGIN`/`COMMIT`. Emulări: (a) `psql -X -v ON_ERROR_STOP=1 -f`; (b) un singur simple query `psql -X -c "$(cat f)"`; (c) `BEGIN` propriu + fișier + `INSERT INTO supabase_migrations.schema_migrations` + `COMMIT` în același string | Aplicare + reaplicare pe fiecare runner; mutant `SELECT 1/0` după PRIMA schimbare (crearea funcției gărzii); mutant `PERFORM 1/0` în postcondiție | 3 × aplicare OK + înregistrată; 6 × stare inițială, migrare **neînregistrată** |
| Rollback în afara migrărilor, armare legată de tranzacție | Mutat în `supabase/revenire/` (+ `README.md`), fără `BEGIN`/`COMMIT`. Armarea: `set_config('gazpet.rollback_20261001a', 'SCOATE_GARDA_J05:' \|\| txid_current(), true)`. Refuză armarea persistentă (`pg_db_role_setting`, nume cu `lower()`). Verifică amprenta gărzii înainte, are postcondiție (stare = live), se dezarmează. Harness-ul refuză un `…_ROLLBACK.sql` rămas în `supabase/migrations`. | O singură sesiune psql: R4 persistent (majuscule, înainte ca GUC-ul să existe în sesiune), R1 nearmat, R2 `SET` de sesiune (valoarea veche), R3 `set_config(…, false)` dintr-o tranzacție anterioară, R5 armare + eroare + rollback → reluare fără armare nouă, R6 armat, R7 a doua rulare | R1–R5 refuz, garda intactă; R6 aplicat și dezarmat; R7 no-op; schema = cea dinainte |
| Mutanți pe fișierele noi | Fiecare protecție scoasă pe rând | Migrare: CHECK `<>`, triggere `=`, fără amprente de funcții, amprentă fără proprietar, fără ACL, fără verificarea gărzii existente, fără privilegii efective, corp schimbat, corp schimbat + postcondiție scoasă, fără `REVOKE`. Rollback: armare nelegată de txid, fără refuz persistent, fără `lower()`, fără dezarmare, fără amprenta gărzii | 15 / 15 prinși |
| Discriminare față de varianta anterioară | — | Aceleași cazuri pe fișierele de dinainte de aliniere | Varianta veche trece peste proprietar schimbat, ACL lărgit, supraîncărcare, stare mixtă (funcția gărzii fără trigger), privilegiu moștenit, iar rollback-ul vechi acceptă o armare de sesiune rămasă: **6 teste noi pică pe ea** |

Detalii despre mutanți:

- La „fără amprente de funcții”, „fără ACL” și „CHECK `<>`”, precondiția și postcondiția se acoperă reciproc. Mutantul e prins pentru că refuzul nu mai vine din precondiție (ci abia din postcondiție) sau nu mai vine deloc.
- „Postcondiție scoasă” e prins doar împreună cu un corp schimbat: fără postcondiție, garda greșită ajunge aplicată și o respinge amprenta verificată de harness.

**Amprentele noi** (în migrare și în rollback):

- garda `fn_ofertare_derogare_garda_j05`: `md5(prosrc)` = `f84c9aeeb80fd990ee6f5110865a1aac`, corp neschimbat; `SECURITY DEFINER`, `{"search_path=public, pg_temp"}`, `postgres`, plpgsql, volatile, `rez=trigger`, ACL `{postgres=X/postgres}`;
- funcțiile live, `md5(prosrc)` (PG17.6, citit read-only):
  - `fn_gate_depunere` `4bddf68cfe53107a622d210f4ef3ec51`;
  - `ofertare_derogare_depunere` `50656c3c958e3a822c9ea1c3f70ae7d9`;
  - `fn_ofertare_licitatii_scriere` `7d7591ef2bd5143ace505b85b1010977`;
  - `fn_are_acces_ofertare` `429d28e2a61fb24c8009d67050c16c85`;
  - `fn_gate_depunere_derogare_owner` `e97f091143d6b492b6fdedf03dd283ea`;
  - `fn_ofertare_derogari_audit_imuabil` `22bab03fb862ae7fbd95538aa4bd6b28`;
- triggere (`tgtype` / `tgenabled`):
  - `a00_ofertare_derogare_garda_j05` 19/O;
  - `a00_ofertare_licitatii_scriere` 19/O;
  - `trg_gate_depunere` 23/O;
  - `trg_ofertare_derogari_audit_imuabil` 58/O;
- CHECK: `c|{3}|ccb3f643d993ae9d68284aca20a58366`.

**Procedura de apply** (înlocuiește §8 pasul 3):

- Se trimite fișierul întreg, cu LF (cu CRLF, `md5(prosrc)` iese altfel și postcondiția refuză). **Runda 4:** singura formă de livrare e `scripts/livrare_migrare.sh` (§14); formele r3 (`psql -f`, un singur query, `apply_migration`) sunt refuzate de garda de livrare.
- **Nicio listă albă nu se actualizează automat.** Dacă o precondiție refuză pe live, se compară definiția și o amprentă nouă intră doar printr-un commit revizuit, cu un nou review Copilot.

## 14. Runda 4 — traseul de livrare (răspuns la verdictul Copilot #538 r3)
Verdict r3 (`docs/SECURITATE_PATCH_RSVTI_VERDICT_COPILOT_R3.md` pe #538): GO pe SQL, NO-GO pe apply, pentru că `COMMIT`-ul din fișier comitea patch-ul **înaintea** `INSERT`-ului în `supabase_migrations.schema_migrations`. Cerința: **un singur gestionar de tranzacție** care include DDL-ul, postcondițiile și înregistrarea. Logica patch-ului nu s-a schimbat; s-a schimbat doar artefactul de livrare. Totul e local; nimic aplicat, nimic pushat.

**a) Traseul efectiv: de ce NU `apply_migration` (MCP).** `apply_migration` trimite SQL-ul la Management API (`POST /v1/projects/{ref}/database/migrations`, cod server închis; issue public supabase/mcp#241). Nici documentația Supabase (`search_docs`), nici codul public al MCP-ului nu spun dacă execuția și `INSERT`-ul în `schema_migrations` sunt în aceeași tranzacție, deci **nu se poate demonstra**. Pentru comparație, CLI-ul public (`supabase db push`, `pkg/migration/file.go`) pune instrucțiunile și `INSERT`-ul într-un singur `pgconn.Batch`, „implicitly transactional”, dar un `COMMIT` din fișier ar rupe și acolo tranzacția. Concluzia: traseul oficial e unul demonstrabil local, cu `psql`.

**Procedura oficială** — `scripts/livrare_migrare.sh` (identic în #538 și #542, sha256 `9f921a0a…` la acest commit):
```
bash scripts/livrare_migrare.sh supabase/migrations/20261001a_ofertare_derogare_garda_j05.sql -- "<URI conexiune directă / Supavisor session mode, rol postgres>"
# = psql -X -q -v ON_ERROR_STOP=1 --single-transaction \
#       -f marcaj.sql  (SELECT set_config('gazpet.livrare_migrare', '20261001a_ofertare_derogare_garda_j05:' || txid_current(), true))
#       -f 20261001a_ofertare_derogare_garda_j05.sql
#       -f inregistrare.sql  (verifică marcajul; refuză dacă name='20261001a_ofertare_derogare_garda_j05' există deja;
#                              INSERT (version AAAALLZZHHMMSS UTC, name, statements = fișierul întreg))
```
- Refuză înainte de conexiune un fișier cu control de tranzacție (`BEGIN;`, `COMMIT`, `ROLLBACK`, `ABORT`, `START TRANSACTION`, `PREPARE TRANSACTION`, în afara comentariilor `--`) sau fără garda de livrare.
- `version` = timestamp UTC de 14 cifre (formatul folosit de `apply_migration` în producție, citit read-only din `schema_migrations`: ultimele versiuni `20260929…`); `name` = numele fișierului fără `.sql` (ca `20260929f_v_claude_context_start`); coloanele reale: `version, statements, name, created_by, idempotency_key, rollback` (information_schema, read-only).
- **Precondiție de operare:** un `psql` ≥ 16 și un URI de conexiune cu rol `postgres` (parola bazei). Din sesiunea Claude există doar MCP, deci livrarea o rulează Răzvan (sau o sesiune cu URI-ul dat explicit de el). Transaction-mode pooler (6543) nu e necesar; se folosește conexiunea directă sau session mode (5432).

**b) Fișierul fără BEGIN/COMMIT.** `BEGIN;` → garda de livrare de **start**; `COMMIT;` → garda de livrare de **final** (după postcondiții). Ambele: `current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261001a_ofertare_derogare_garda_j05:' || txid_current()` ⇒ `RAISE`. Ordinea în tranzacție: marcaj → gardă start → precondiții → DDL → postcondiții → gardă final → verificare + `INSERT` înregistrare → `COMMIT` (al runnerului). Postcondițiile rămân înainte de sfârșitul tranzacției (verificare statică în harness). Noul fișier: sha256 `66105ecd71c7ec571e3df4825e7e0aa5fb3627e716869572972cdf750c65d6c5`, 268 linii.

**c) Fișierul rulat singur, fără runner.** `transaction_timestamp() <> statement_timestamp()` nu e fiabil; soluția robustă e marcajul **legat de txid**: `set_config(..., true)` e local tranzacției, iar în autocommit fiecare instrucțiune are alt txid. Demonstrat în harness (toate refuzate de garda de start, `pg_dump` identic, nicio înregistrare): `psql -f` simplu; un singur query (`psql -c`, echivalentul `execute_sql`); `psql --single-transaction` fără marcaj; marcaj de **sesiune** dintr-o tranzacție anterioară; `SET` de sesiune fără txid. Deci `apply_migration` / `execute_sql` pe acest fișier **refuză** (fail-closed) — nu există cale accidentală spre „aplicat, neînregistrat”.
- **Limite documentate:** (1) cine pune manual marcajul corect în aceeași tranzacție (`BEGIN; set_config(…txid…); \i fișier; COMMIT;`) ocolește înregistrarea — e o acțiune deliberată, nu un accident; harness-ul o folosește intern (faza de patch fără tabel de înregistrare). (2) Un `END;` la nivel de instrucțiune (sinonim `COMMIT`) nu se poate deosebi textual de finalul unui corp plpgsql; îl prinde garda de **final** (marcajul dispare la COMMIT): runnerul eșuează și **nu înregistrează**, dar ce era înainte de `END;` rămâne comis. Testat ca mutant; regula de review: niciun `END;` în afara corpurilor `$…$`.
- Dacă apare totuși „aplicat, neînregistrat” (ex. livrare manuală), conform verdictului: stop, reconciliere prin verificări read-only (amprentele din pasul de sanity), fără rollback tehnic pentru a alinia istoricul.

**d) Harness (`scripts/test_j05_garda.sh, faza 3 rescrisă + faza S; `runner` din fazele 2/4/7 = aceeași tranzacție (marcaj + perturbare + migrare + INSERT)`), traseul real, pe o bază auxiliară cu `schema_migrations` având coloanele din producție:**

| Test | Rezultat |
|---|---|
| livrare fără eroare | patch + **o** înregistrare (version, name, `statements[1]` = fișierul octet cu octet) |
| reluare după succes (altă versiune) | refuz „deja înregistrată”, tot anulat, `pg_dump` identic, tot 1 înregistrare (fără dublare) |
| `1/0` după prima schimbare · `1/0` în postcondiție | stare inițială (`pg_dump` identic), 0 înregistrări |
| **eroare injectată CHIAR la `INSERT`-ul în `schema_migrations`** (trigger BEFORE INSERT care verifică întâi că patch-ul e instalat în tranzacție — deci toate postcondițiile și garda de final au trecut — apoi `RAISE`) | definiții/politici/ACL inițiale (`pg_dump` identic), **0 înregistrări** |
| reluarea permisă după eșecul înregistrării | patch + exact o înregistrare |
| fișierul singur (5 variante de mai sus) | refuzat de garda de start, fără urme |
| fișier cu `COMMIT;` / `select 1; commit ;` | runnerul refuză înainte de conexiune |
| fișier cu `END;` la nivel de instrucțiune | garda de final eșuează, neînregistrat (limita 2) |

Rezultat: `PGPORT=5627 PGBASE=/tmp/pg_livr4_j05 bash scripts/test_j05_garda.sh`, de 2 ori: **PASS, live 150 aserțiuni (50 picate, toate în cazurile P/H) · patch 152 (0 picate) · 65 verificări de harness, exit 0** de fiecare dată.

**Mutanți (runda 4):** în faza 7 a harness-ului, toți prinși la fiecare rulare: cei 15 mutanți existenți (migrare + rollback) și **7 noi**: fără garda de start (static + 3.5), fără garda de final (static + 3.6), garda fără txid (3.5, marcaj de sesiune), runner cu înregistrarea în tranzacție separată (**3.3, eroare la INSERT: urmă rămasă**), fără `--single-transaction` (3.1), fără refuzul „deja înregistrată” (3.2), fără refuzul controlului de tranzacție (3.6).

**Rămâne deschis:** GO Copilot pe runda 4 (diff-ul efectiv: migrare + `scripts/livrare_migrare.sh` + harness) și acordul lui Răzvan; accesul `psql` + URI pentru operator; rularea pe PG17 (producția) rămâne neverificată local — refuzul e fail-closed (§ amprente).

## Livrare: runner comun ed7ecb0 (GO Copilot R9)

Migrarea se livrează DOAR prin runnerul comun `scripts/livrare_migrare.sh` + `scripts/livrare_validator.py`, copiate
byte cu byte din ed7ecb0 (branch #538, validator a6188fb neschimbat):
sha256 runner `bb223d90dcd3e932d7be8211cffb24cbbb6d0053c21bba333beca833892efb71`,
sha256 validator `9356d2871ebd09b3184992193d3a249f29eca497c2ddce6c5488f1909cbb450d`.
Validatorul acceptă migrarea (`python3 scripts/livrare_validator.py supabase/migrations/20261001a_ofertare_derogare_garda_j05.sql <tag>` ⇒ `OK`).

```bash
bash scripts/livrare_migrare.sh --migrare supabase/migrations/20261001a_ofertare_derogare_garda_j05.sql \
  --sha256 66105ecd71c7ec571e3df4825e7e0aa5fb3627e716869572972cdf750c65d6c5 \
  --versiune <AAAALLZZHHMMSS> --tinta-db <baza> --tinta-sistem <system_identifier> \
  --tinta-host <host_scriere_aprobat> --tinta-port <port> [--tinta-proiect <marcaj>] [--user <operator>]
```
(sha256 de mai sus = artefactul la commitul acestei secțiuni; la livrare se folosește sha256-ul APROBAT atunci.)
Parola doar din `~/.pgpass`/`PGPASSFILE`; `--service`, URI-uri și opțiuni psql suplimentare sunt refuzate (exit 2).
- **Ofertare cere excepția de freeze** înainte de livrare.

Limite (verdict R9, `docs/LIVRARE_MIGRARE_VERDICT_COPILOT_R9.md` pe #538):
- GO-ul e pentru standardul de livrare, NU autorizează merge/apply.
- La fiecare livrare: SHA-256 artefact, țintă + operator aprobați, pre/postcondiții, acordul lui Răzvan.
- Opriri / reporniri / rollback — aprobate separat.
- PG17 neverificat (server de test PG16); `pg_control_system()` rămâne (verificarea țintei).
- Codurile 0/11 confirmă înregistrarea, nu înlocuiesc verificarea structurii + smoke.
- Rezultat necunoscut / conflict / țintă neconfirmată ⇒ fără retry sau rollback automat (reconciliere manuală).

**Stare test (30.09, rezolvat):** `scripts/test_j05_garda.sh` trece complet (fazele 1–7; faza 8 rulează doar cu `VECHI=<dir>`, nesetat), rulat de 2 ori. Mutanții de
RUNNER (`w_*`, 4 înainte / 4 după, niciunul scos sau slăbit) sunt generați acum pe textul runnerului ed7ecb0; runnerul și
validatorul rămân byte-identice (sha256 bb223d90…efb71 / 9356d287…b450d). Maparea proprietăților:

| Mutant | Proprietatea (runda 4) | Mecanismul în ed7ecb0 mutat | Prins de |
|---|---|---|---|
| `w_inreg_separata` | migrare + înregistrare atomice | apelul unic `psql --single-transaction` e spart în 2 tranzacții: [prolog+pre+COPIE] și [prolog+pre+3_inreg] | 3.3 (eroare injectată ⇒ înregistrare fără migrare) |
| `w_fara_single` | gestionar unic de tranzacție | `--single-transaction` scos din apelul principal | 3.1 (marcajul `SET LOCAL`/`set_config(...,true)` se pierde ⇒ garda de start refuză) |
| `w_fara_deja` | refuzul „deja înregistrată” | refuzul are acum 2 straturi: pre-verificarea (exit 11/21) + `IF EXISTS` nume/versiune din `1_pre`; mutantul le scoate pe AMBELE (unul singur e acoperit de celălalt) | 3.2 (a 2-a livrare ⇒ 2 rânduri în istoric, CONFLICT după livrare) |
| `w_fara_static` | refuzul controlului de tranzacție | refuzul trăiește în `livrare_validator.py`; mutantul nu mai apelează validatorul | 3.6 (COMMIT în fișier ajunge la server; refuzat doar de garda de final, nu „control de tranzacție la nivel superior”) |

Harness: validatorul se copiază lângă mutanți (runnerul îl apelează relativ la `BASH_SOURCE`) — fără copie, mutanții
păreau „prinși” fals la 3.1 (validator lipsă). Ieșirea fiecărui mutant de livrare rămâne în `iesiri/livm_<runner>_<migrare>.out`.
