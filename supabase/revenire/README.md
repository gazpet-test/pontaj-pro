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

## 20261003e — SEC trezorerie (NEAPLICAT)

Reveniri tehnice (rollback) pentru migrările de securitate. **Nu sunt migrări forward.**

- Directorul e în afara `supabase/migrations/`, singurul pe care convenția Supabase CLI îl descoperă automat. Nimic de aici nu se aplică odată cu un patch.
- Un fișier de aici nu are GO de execuție implicit. Se folosește doar la o revenire excepțională, cu decizia lui Răzvan și review, prin procedura din antetul fișierului.
- Fișierele nu conțin `BEGIN`/`COMMIT`. Operatorul trimite un singur string, iar armarea stă în aceeași tranzacție, legată de `txid_current()`. Exemplu: `BEGIN; SELECT set_config('gazpet.rollback_tehnic_<id>', '<TOKEN>:' || txid_current(), true); <fișier> COMMIT;`.
- Fiecare revenire refuză armarea persistentă (`pg_db_role_setting`), pornește doar din starea exactă a patch-ului, are postcondiție înainte de COMMIT și se dezarmează la final.
