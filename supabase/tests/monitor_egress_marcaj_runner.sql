-- Simulează marcajul pus de scripts/livrare_migrare.sh (doar pentru testul local; rulează cu psql --single-transaction).
SELECT set_config('gazpet.livrare_migrare', '20260930e_monitor_egress:' || txid_current(), true);
