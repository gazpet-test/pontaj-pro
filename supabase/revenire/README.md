# supabase/revenire/ — rollback-uri tehnice (NU migrări)

Aici stau fișierele de revenire tehnică ale patch-urilor de securitate. **Nu sunt migrări forward** și nu se aplică odată cu patch-ul.

## De ce e un director separat
- **Niciun runner nu parcurge acest director.** Migrările se aplică manual, fișier cu fișier (MCP `apply_migration`, cu conținutul exact al fișierului). În repo nu există `supabase/config.toml` și nici un flux `supabase db push` care să enumere directoare.
- **CI-ul nu-l atinge.** `.github/workflows/*` referă doar fișiere anume din `supabase/migrations/` (ex. `supabase/migrations/20260929b_ofertare_derogare_audit*.sql`), ca trigger de cale. Scripturile din `scripts/pg/` citesc fișiere numite explicit. Nimic nu referă `supabase/revenire/`. Harness-ul `scripts/test_sec_rsvti.sh` verifică static ambele lucruri, la fiecare rulare (pasul S).
- Armarea care face un rollback să eșueze **nu e** același lucru cu excluderea lui: un rollback descoperit ca migrare ar opri tot traseul de migrări. De aceea mutarea.

## Statut
Fiecare fișier de aici e **artefact de test / revenire excepțională, fără GO de execuție**. Harness-ul îl folosește ca să dovedească faptul că migrarea se desface curat. O folosire în producție cere decizia explicită a lui Răzvan, cu motivul consemnat, plus un review separat (Copilot). Comutatorul de armare nu e o autorizare.

## 20261003c — SEC RSVTI (`20261003c_sec_rsvti_poarta_jurnal_ROLLBACK.sql`)
Redeschide gaura RSVTI (RPC fără poartă, jurnal falsificabil). Revenirea care păstrează poarta e descrisă în `docs/SECURITATE_PATCH_RSVTI.md` §6.

**Procedura (doar după decizie + review).** Fișierul nu conține `BEGIN`/`COMMIT`, deci gestionarul tranzacției e operatorul. Se trimite **un singur string**:
```sql
BEGIN;
SELECT set_config('gazpet.rollback_tehnic_20261003c', 'REDESCHIDE_GAURA_RSVTI:' || txid_current(), true);
-- <conținutul exact al fișierului>
COMMIT;
```
1. Preview read-only: md5-urile curente (RPC, helper, politica jurnalului) și `SELECT * FROM pg_db_role_setting`.
2. Execuția string-ului de mai sus.
3. Verificare read-only: RPC `md5(prosrc)` = `527c0e4708dfe1f88cec03a77b6a26dd`, semnătura cu `DEFAULT CURRENT_DATE`, helper absent.

**Siguranțe:**
- Armarea e legată de tranzacția curentă (`txid_current()`): o setare rămasă în sesiune, una dintr-o tranzacție anterioară sau eșuată și o armare persistentă (`ALTER DATABASE/ROLE … SET`, verificată în `pg_db_role_setting`, cu numele comparat prin `lower()`) sunt refuzate.
- Precondițiile cer starea exactă a patch-ului. Postcondițiile cer starea exactă din 29.09.
- La final, fișierul dezarmează și sesiunea.

## 20260930k — garda citirii automate Ofertare (`20260930k_ofertare_ingest_garda_ROLLBACK.sql`, PR #553)
Scoate tabelul `ofertare_ingest_garda` și cele 4 funcții. Cu edge-ul `ofertare-ingest-doc` v13 deployat, citirea automată se oprește complet (fail-closed). Revenirea la v12 e o decizie separată.

**Procedura (doar după decizie + review).** Un singur string:
```sql
BEGIN;
SELECT set_config('gazpet.revenire_20260930k', 'SCOATE_GARDA_INGEST:' || txid_current(), true);
-- <conținutul exact al fișierului>
COMMIT;
```
Siguranțele (armare legată de txid, refuz la armare persistentă, precondiție pe amprenta exactă, DROP fără CASCADE) sunt descrise în antetul fișierului.
## 20261003d — SEC HR tokenuri concediu (NEAPLICAT)

Fișierele de aici **nu sunt migrări** și **nu le parcurge niciun runner** (Supabase CLI/MCP citesc doar
`supabase/migrations/`; CI-ul referă doar fișiere anume de acolo). Sunt reveniri tehnice păstrate pentru
test și pentru o eventuală revenire excepțională.

Reguli:
- **Fără GO de execuție.** Un fișier de aici se rulează doar la cererea explicită a lui Răzvan, după o decizie
  și un review specifice (Copilot). Existența comutatorului de armare nu e autorizare.
- **Gestionarul tranzacției e operatorul**: fișierele nu conțin `BEGIN/COMMIT`; se trimit într-un singur string
  `BEGIN; SELECT set_config('<comutator>', '<valoare>:' || txid_current(), true); <fișier> COMMIT;`
  (valoarea exactă e scrisă în antetul fiecărui fișier). Armarea persistentă (`ALTER DATABASE/ROLE … SET`) e refuzată.
- Fiecare fișier pornește doar dintr-o stare exactă cunoscută și are postcondiție înainte de `COMMIT`.
## 20261003e — SEC trezorerie (NEAPLICAT)

Reveniri tehnice (rollback) pentru migrările de securitate. **Nu sunt migrări forward.**

- Directorul e în afara `supabase/migrations/`, singurul pe care convenția Supabase CLI îl descoperă automat. Nimic de aici nu se aplică odată cu un patch.
- Un fișier de aici nu are GO de execuție implicit. Se folosește doar la o revenire excepțională, cu decizia lui Răzvan și review, prin procedura din antetul fișierului.
- Fișierele nu conțin `BEGIN`/`COMMIT`. Operatorul trimite un singur string, iar armarea stă în aceeași tranzacție, legată de `txid_current()`. Exemplu: `BEGIN; SELECT set_config('gazpet.rollback_tehnic_<id>', '<TOKEN>:' || txid_current(), true); <fișier> COMMIT;`.
- Fiecare revenire refuză armarea persistentă (`pg_db_role_setting`), pornește doar din starea exactă a patch-ului, are postcondiție înainte de COMMIT și se dezarmează la final.
## 20261001a — J05 gardă derogări Ofertare (NEAPLICAT)

Artefacte de **revenire** (rollback tehnic, oprire controlată). **Nu sunt migrări**: niciun runner nu parcurge directorul ăsta (`supabase db push`, `apply_migration` și harness-urile citesc doar `supabase/migrations/`).

- Fiecare fișier are antetul lui: ce redeschide, cine îl poate cere, cum se armează.
- Rollback-urile tehnice redeschid o gaură de securitate. Se rulează doar la cererea explicită a lui Răzvan, după decizie și review specifice (Copilot). Existența fișierului sau a comutatorului de armare nu e autorizare.
- Gestionarul tranzacției e operatorul. Fișierele nu conțin `BEGIN`/`COMMIT` și se trimit într-un singur string: `BEGIN;` + armarea legată de `txid_current()` + fișierul + `COMMIT;`.
- Directorul poate apărea și pe alte branch-uri, cu alte fișiere. La merge se păstrează toate fișierele, iar README-ul se unește.

## 20261005a — SEC RSVTI P1b + jurnal A (`20261005a_sec_rsvti_p1b_jurnal_insert_ROLLBACK.sql`)
Readuce starea 20261003c (poarta RPC rămâne): redeschide scrierea directă `rsvti_*` de către HR și INSERT-ul direct în jurnal. Același statut: fără GO de execuție.
```sql
BEGIN;
SELECT set_config('gazpet.rollback_tehnic_20261005a', 'REDESCHIDE_P1B_RSVTI:' || txid_current(), true);
-- <conținutul exact al fișierului>
COMMIT;
```
Precondiții = exact 20261005a; postcondiții = exact 20261003c (RPC `6185a9dd…`, fără trigger/funcții P1b, INSERT authenticated pe jurnal). Testat în `scripts/test_sec_rsvti_p1b.sh` pasul 6.
## 20261003b — SEC Ofertare (APLICAT 01.10, v20261001130000)

Aici stau fișierele de revenire ale patch-ului de securitate Ofertare 20261003b. Nu sunt migrări forward și nu trebuie descoperite ca migrări.

| Fișier | Ce face | Cine decide |
|---|---|---|
| `20261003b_sec_ofertare_porti_alege_inventar_OPRIRE_CONTROLATA.sql` | Păstrează corpurile patch-ului și retrage EXECUTE pe cele 2 funcții (authenticated, anon, PUBLIC, service_role). Funcționalitatea se **oprește**, nu se redeschide. | Răzvan, explicit (schimbare de drepturi). Efectivă doar după verificarea separată și reconcilierea apelurilor în curs (docs §12.3). |
| `20261003b_sec_ofertare_porti_alege_inventar_REPORNIRE.sql` | **Singura** ieșire din oprire: doar din starea „oprire”, reface GRANT-urile patch-ului; postcondiție = patch (ACL + privilegii efective). Migrarea refuză starea „oprire” (runda 4). | Răzvan, explicit. |
| `20261003b_sec_ofertare_porti_alege_inventar_ROLLBACK.sql` | ROLLBACK TEHNIC: readuce starea live din 29.09 și **redeschide bypass-ul**. Artefact **fără GO de execuție**. | Doar la cererea explicită a lui Răzvan, după o decizie și un review Copilot specifice. |

### De ce nu le rulează nimeni automat
- Niciun runner nu parcurge directorul: nu există `supabase/config.toml`, niciun workflow nu rulează `supabase db push`/`migration`, iar `.github/workflows/ofertare-regresie.yml` referă doar fișiere anume din `supabase/migrations` ca trigger de cale.
- `scripts/test_sec_ofertare.sh` verifică asta la fiecare rulare (pasul 0).

### Cum se execută (gestionarul tranzacției e operatorul)
Fișierele nu conțin `BEGIN`/`COMMIT`; fiecare e un singur bloc `DO`. Se trimit ca **un singur string** (ex. `execute_sql`), cu armarea legată de tranzacția curentă:

```sql
BEGIN;
SELECT set_config('gazpet.oprire_controlata_20261003b', 'OPRESTE_ALEGE_SI_PERECHE:' || txid_current(), true);
<conținutul integral al fișierului de oprire>
COMMIT;
```

Repornirea: `gazpet.repornire_20261003b` = `'REPORNESTE_ALEGE_SI_PERECHE:' || txid_current()`. Rollback-ul tehnic: `gazpet.rollback_tehnic_20261003b` = `'REDESCHIDE_BYPASS:' || txid_current()`.

Migrarea forward NU se rulează așa: ea trece doar prin `scripts/livrare_migrare.sh` (psql `--single-transaction`: marcaj de livrare + migrare + înregistrare în `schema_migrations`).

O armare din altă tranzacție (SET de sesiune, `set_config(…, false)`, o tranzacție eșuată, o conexiune refolosită) are alt txid și e refuzată. Armarea persistentă (`ALTER DATABASE/ROLE … SET`) e refuzată. Fiecare fișier verifică înainte de COMMIT că starea rezultată e exact cea țintă; altfel se anulează tot. Detalii: `docs/SECURITATE_PATCH_OFERTARE.md` §7 și §11.

## 20261006a — SEC F1b MAINTAIN (`20261006a_sec_f1b_maintain_revoke_ROLLBACK.sql`, NEAPLICAT)
Redă MAINTAIN exact pe lista live din 01.10, recitită după #540/#541 (474 relații) + default ACL postgres; **redeschide** gaura. Fără GO de execuție.
```sql
BEGIN;
SELECT set_config('gazpet.rollback_tehnic_20261006a', 'REDESCHIDE_MAINTAIN:' || txid_current(), true);
-- <conținutul exact al fișierului>
COMMIT;
```
Testat în `scripts/test_sec_f1b_maintain.sh` pasul 5.

## 20261006b — IBAN garanții (`20261006b_sec_garantii_iban_ROLLBACK.sql`, NEAPLICAT)
Readuce starea live din 01.10 (SELECT pe tot tabelul `garantii`, view/RPC cu `g.iban` direct, fără `fn_garantie_iban`) și **redeschide expunerea IBAN**. Fără GO de execuție.
```sql
BEGIN;
SELECT set_config('gazpet.rollback_tehnic_20261006b', 'REDESCHIDE_IBAN_GARANTII:' || txid_current(), true);
-- <conținutul exact al fișierului>
COMMIT;
```
Testat în `scripts/test_sec_garantii_iban.sh` pasul 5.
## 20261005b — RLS garanții (`20261005b_rls_garantii_scriere_ROLLBACK.sql`)
Redeschide scrierea pentru orice cont logat pe `garantii`, `gbe_polite`, `gbe_restituiri`, `contracte_terti` (politicile din 01.10) și șterge `fn_poate_scrie_garantii()`. Același statut: fără GO de execuție.
```sql
BEGIN;
SELECT set_config('gazpet.revenire_20261005b', 'REDESCHIDE_GARANTII:' || txid_current(), true);
-- <conținutul exact al fișierului>
COMMIT;
```
Precondiție = md5 politici `baf4aced…` (patch); postcondiție = `62f69c59…` (live 01.10). Testat în `scripts/test_rls_garantii.sh` pasul 5.

## 20261002b — Conturi, follow-up P2 (`20261002b_conturi_p2_followup_ROLLBACK.sql`, NEAPLICAT)
Readuce EXACT starea live r11 a pachetului Conturi (c v20261001230000 / d v20261001231500): cele 6 funcții înlocuite de `20261002b` (r2: + `fn_cont_coada_pune`) revin verbatim la corpurile din `20260929c` / `20260929d` (md5 r11) și coloanele `conturi_inchideri_coada.amanari` / `ultima_amanare_alertata` dispar. **Redeschide cele 4 P2** acceptate ca risc documentat pe #529 (deadlock la legarea pe loturi, garda fără tgqual/tgattr, notificări pierdute fără reluare, amânare nelimitată la contenție). Fără GO de execuție.
```sql
BEGIN;
SELECT set_config('gazpet.rollback_tehnic_20261002b', 'REVINE_P2_FOLLOWUP:' || txid_current(), true);
-- <conținutul exact al fișierului>
COMMIT;
```
Precondiție = md5 propriu 20261002b pe toate cele 6 funcții + coloanele prezente; postcondiție = md5 live r11 + ACL-uri neschimbate + coloanele absente; dezarmare la final. Testat în `scripts/test_conturi_ciclu_viata.sh --rollback` (harness-ul citește rollback-ul din `supabase/revenire/` și îl armează după antetul `-- harness-armare: <guc> <token>`; schema de după rollback = schema de după `20260929e`).

## 20261002c — Conturi, corecție gate 0e (`20261002c_conturi_0e_nowait_param_ROLLBACK.sql`, NEAPLICAT)
Readuce EXACT starea live r4 a lui `20261002b` (v20261002124500): `fn_cont_leaga_automat` revine verbatim la corpul din `20261002b` (md5 `a32cb851…`, cu cele două `PERFORM set_config(...)`) și `fn_cont_lot_nowait(boolean)` dispare. **Redeschide incidentul gate 0e** (`scripts/control_0e.sql` ⇒ 1 rând: `fn_cont_leaga_automat [set_config]`) — nu e o altă rezolvare. Fără GO de execuție. Ordine: ÎNAINTEA revenirii `20261002b` (care cere md5 `a32cb851…`).
```sql
BEGIN;
SELECT set_config('gazpet.rollback_tehnic_20261002c', 'REVINE_0E_NOWAIT:' || txid_current(), true);
-- <conținutul exact al fișierului>
COMMIT;
```
Precondiție = md5 propriu 20261002c (`b07f3800…` / `0477bce8…`), ACL-uri, unicitate, niciun alt apelant al lui `fn_cont_lot_nowait`; postcondiție = md5 live r4 pe `fn_cont_leaga_automat` + `fn_cont_revalideaza_candidat` (`ecbbd64c…`) + `fn_cont_lock_chei` (`db9b9899…`), ACL-uri neschimbate, funcția nouă absentă; dezarmare la final. Testat în `scripts/test_conturi_ciclu_viata.sh --rollback` (armare după antetul `-- harness-armare:`; schema de după revenire = schema de după `20261002b`).

## 20261002e — tip nou de garanție „car” (`20261002e_garantii_tip_car_ROLLBACK.sql`, NEAPLICAT)
Readuce `garantii_tip_check` la cele 4 valori din 02.10 și scoate `fn_garantii_tipuri()`. Nu redeschide o gaură de securitate, dar **refuză dacă există rânduri cu `tip = 'car'`** (datele nu se ating de aici — decizie separată). Același statut: fără GO de execuție.
```sql
BEGIN;
SELECT set_config('gazpet.rollback_tehnic_20261002e', 'SCOATE_TIP_CAR:' || txid_current(), true);
-- <conținutul exact al fișierului>
COMMIT;
```
