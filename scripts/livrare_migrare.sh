#!/usr/bin/env bash
# ============================================================================
# Traseul OFICIAL de livrare pentru migrările cu gardă de livrare (runda 4, verdict Copilot #538 r3).
#
# UN SINGUR gestionar de tranzacție = psql --single-transaction, care include, în aceeași tranzacție:
#   (1) marcajul de livrare  set_config('gazpet.livrare_migrare', '<nume>:' || txid_current(), true)
#   (2) corpul migrării (fără BEGIN/COMMIT; precondiții, DDL, postcondiții, gardă de final)
#   (3) înregistrarea în supabase_migrations.schema_migrations (refuzată dacă numele e deja înregistrat)
# Orice eroare (inclusiv chiar la INSERT-ul înregistrării) ⇒ ROLLBACK la tot: stare inițială, nicio înregistrare.
#
# De ce NU Supabase MCP apply_migration: trimite SQL-ul la Management API
# (POST /v1/projects/{ref}/database/migrations), cod închis; nu se poate demonstra că execuția și
# înregistrarea sunt în aceeași tranzacție. Migrările cu gardă REFUZĂ rularea fără marcaj (fail-closed),
# deci nici apply_migration, nici execute_sql, nici un psql -f simplu nu le pot aplica.
#
# Utilizare:
#   bash scripts/livrare_migrare.sh supabase/migrations/<fișier>.sql -- <argumente de conexiune psql>
#   ex.: bash scripts/livrare_migrare.sh supabase/migrations/20261003c_sec_rsvti_poarta_jurnal.sql -- "$DB_URL"
# Variabile: PSQL_BIN (implicit psql), VERSIUNE_MIGRARE (implicit UTC acum, AAAALLZZHHMMSS, ca apply_migration)
# Cod de ieșire: 0 = aplicată + înregistrată; ≠0 = nimic comis.
# ============================================================================
set -Eeuo pipefail

[ $# -ge 2 ] && [ "$2" = "--" ] || { echo "Utilizare: $0 <migrare.sql> -- <argumente psql>" >&2; exit 2; }
MIG="$1"; shift 2
[ -f "$MIG" ] || { echo "Fișier lipsă: $MIG" >&2; exit 2; }
NUME="$(basename "$MIG" .sql)"
[[ "$NUME" =~ ^[0-9]{8}[a-z]?_[A-Za-z0-9_]+$ ]] || { echo "Nume de migrare invalid: $NUME" >&2; exit 2; }
VERSIUNE="${VERSIUNE_MIGRARE:-$(date -u +%Y%m%d%H%M%S)}"
[[ "$VERSIUNE" =~ ^[0-9]{14}$ ]] || { echo "VERSIUNE_MIGRARE invalidă: $VERSIUNE" >&2; exit 2; }

# Gestionarul unic: fișierul NU are voie să-și deschidă/închidă singur tranzacția (textul fără comentariile „--”).
# Limită: un „END;” la nivel de instrucțiune (sinonim COMMIT) nu se poate deosebi textual de finalul unui corp plpgsql;
# acel caz îl prinde garda de livrare de final (marcajul dispare la COMMIT) ⇒ runnerul eșuează, NEÎNREGISTRAT.
if sed 's/--.*$//' "$MIG" | grep -qiE '\b(COMMIT|ROLLBACK|ABORT|START\s+TRANSACTION|PREPARE\s+TRANSACTION)\b|\bBEGIN\s*(TRANSACTION|WORK)?\s*;'; then
  echo "REFUZ: $MIG conține control de tranzacție (BEGIN;/COMMIT/ROLLBACK/…) — tranzacția o deține runnerul" >&2; exit 3
fi
grep -qF "'gazpet.livrare_migrare'" "$MIG" \
  || { echo "REFUZ: $MIG nu are garda de livrare (gazpet.livrare_migrare)" >&2; exit 3; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
TAG="reg_$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
grep -qF "\$$TAG\$" "$MIG" && { echo "coliziune de tag dollar-quote" >&2; exit 2; }

printf "SELECT set_config('gazpet.livrare_migrare', '%s:' || txid_current(), true);\n" "$NUME" > "$TMP/1_marcaj.sql"
{
  printf 'DO $inreg$ BEGIN\n'
  printf "  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '%s:' || txid_current() THEN\n" "$NUME"
  printf "    RAISE EXCEPTION 'Înregistrare %s: marcajul de livrare lipsește — nu sunt în tranzacția runnerului';\n  END IF;\n" "$NUME"
  printf "  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = '%s') THEN\n" "$NUME"
  printf "    RAISE EXCEPTION 'Înregistrare %s: migrarea e deja înregistrată — reluare refuzată (fără dublare)';\n  END IF;\n" "$NUME"
  printf 'END $inreg$;\n'
  printf "INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('%s', '%s', ARRAY[\$%s\$" "$VERSIUNE" "$NUME" "$TAG"
  cat "$MIG"
  printf "\$%s\$]);\n" "$TAG"
} > "$TMP/3_inregistrare.sql"

echo "→ livrare $NUME (versiune $VERSIUNE): psql --single-transaction [marcaj + migrare + înregistrare]"
"${PSQL_BIN:-psql}" -X -q -v ON_ERROR_STOP=1 --single-transaction \
  -f "$TMP/1_marcaj.sql" -f "$MIG" -f "$TMP/3_inregistrare.sql" "$@"
echo "✓ $NUME aplicată și înregistrată în aceeași tranzacție"
