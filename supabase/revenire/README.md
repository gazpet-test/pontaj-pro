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
Redă MAINTAIN exact pe lista live din 01.10 (477 relații) + default ACL postgres; **redeschide** gaura. Fără GO de execuție.
```sql
BEGIN;
SELECT set_config('gazpet.rollback_tehnic_20261006a', 'REDESCHIDE_MAINTAIN:' || txid_current(), true);
-- <conținutul exact al fișierului>
COMMIT;
```
Testat în `scripts/test_sec_f1b_maintain.sh` pasul 5.
