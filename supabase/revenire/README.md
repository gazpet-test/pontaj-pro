# supabase/revenire — reveniri pentru patch-ul 20261003b (NU sunt migrări)

Aici stau fișierele de revenire ale patch-ului de securitate Ofertare 20261003b. Nu sunt migrări forward și nu trebuie descoperite ca migrări.

| Fișier | Ce face | Cine decide |
|---|---|---|
| `20261003b_sec_ofertare_porti_alege_inventar_OPRIRE_CONTROLATA.sql` | Păstrează corpurile patch-ului și retrage EXECUTE pe cele 2 funcții (authenticated, anon, PUBLIC, service_role). Funcționalitatea se **oprește**, nu se redeschide. | Răzvan, explicit. |
| `20261003b_sec_ofertare_porti_alege_inventar_REPORNIRE.sql` | Ieșirea din oprire: doar din starea „oprire”, reface GRANT-urile patch-ului; postcondiție = patch. (Migrarea nu se reia: `scripts/livrare_migrare.sh` refuză o migrare deja înregistrată.) | Răzvan, explicit. |
| `20261003b_sec_ofertare_porti_alege_inventar_ROLLBACK.sql` | ROLLBACK TEHNIC: readuce starea live din 29.09 și **redeschide bypass-ul**. Artefact **fără GO de execuție**. | Doar la cererea explicită a lui Răzvan, după o decizie și un review Copilot specifice. |

## De ce nu le rulează nimeni automat
- Niciun runner nu parcurge directorul: nu există `supabase/config.toml`, niciun workflow nu rulează `supabase db push`/`migration`, iar `.github/workflows/ofertare-regresie.yml` referă doar fișiere anume din `supabase/migrations` ca trigger de cale.
- `scripts/test_sec_ofertare.sh` verifică asta la fiecare rulare (pasul 0).

## Cum se execută (gestionarul tranzacției e operatorul)
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
