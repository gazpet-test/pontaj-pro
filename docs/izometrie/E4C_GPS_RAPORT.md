E4c GPS — Q-E4-15 B, 24.10.2026
Migrare nouă: supabase/migrations/20261111a_izometrie_gps_curatare.sql; rollback în supabase/revenire/.
Generator: scripts/izometrie/e4_gen/gen_e4c_gps.py + e4c_gps_*_tpl.sql; reutilizează helperii/inventarul E4b.
Șterge rândurile GPS după >60 zile: aprobata/respinsa din decis_la, stearsa din updated_at; restul se păstrează.
Jurnal fără coordonate, RLS/ACL restrictive, triggere ALWAYS; ștergere și jurnalizare atomice.
Funcție DEFINER a writer-ului, EXECUTE doar postgres, context privat cu tranzacție și chei; lot implicit 5000.
Gardul LIVE și porțile E4/E4b au precondiții MD5; inventar fix înainte/după reștampilare; restore exact.
Cron zilnic 23 3 * * *, postgres; migrarea nu execută curățarea la aplicare.
Harness E4c reutilizează E4b, obligatoriu PRODLIKE/NOSUPERUSER; aplicare și rollback prin livrare_migrare.sh.
pg_cron este simulat doar în scheletul local; artefactul de producție apelează necondiționat cron.
Rulat: generator, 8 teste Python E4c (validator forward/rollback inclus), 30 E4b și 15 E4a — toate trecute.
SQL pregătit: retenție, ACL, context, lot, idempotență, atomicitate injectată, imutabilitate; marker final inclus.
NU am rulat PostgreSQL/harness/cron real; WSL necesită worktree cu permisiuni POSIX pentru initdb.
Rollback refuză jurnal nevid, pentru a păstra auditul; coordonatele șterse nu pot fi reconstruite.
E4a/E4b și ieșirile existente nu au fost editate; fără Git, secrete, baze de date sau deploy.
