# supabase/revenire/

Reveniri tehnice (rollback) pentru migrările de securitate. **Nu sunt migrări forward.**

- Directorul e în afara `supabase/migrations/`, singurul pe care convenția Supabase CLI îl descoperă automat. Nimic de aici nu se aplică odată cu un patch.
- Un fișier de aici nu are GO de execuție implicit. Se folosește doar la o revenire excepțională, cu decizia lui Răzvan și review, prin procedura din antetul fișierului.
- Fișierele nu conțin `BEGIN`/`COMMIT`. Operatorul trimite un singur string, iar armarea stă în aceeași tranzacție, legată de `txid_current()`. Exemplu: `BEGIN; SELECT set_config('gazpet.rollback_tehnic_<id>', '<TOKEN>:' || txid_current(), true); <fișier> COMMIT;`.
- Fiecare revenire refuză armarea persistentă (`pg_db_role_setting`), pornește doar din starea exactă a patch-ului, are postcondiție înainte de COMMIT și se dezarmează la final.
