// Același set rulează și standalone, și în comanda vitest a directorului.
const { test } = await import(process.env.VITEST ? 'vitest' : 'node:test');
import assert from 'node:assert/strict';
import { localTarget, sqlLocal } from './test_sql_local.mjs';

test('guard PostgreSQL refuză host extern și override host prin query', () => {
  for (const value of [undefined, 'postgres://db.supabase.co/test',
    'postgres://localhost/test?host=remote', 'postgres://localhost/test#remote',
    'https://localhost/test', 'postgres://localhost/a%2Fb']) {
    assert.throws(() => localTarget(value));
  }
  assert.equal(localTarget('postgres://127.0.0.1/audit_local'), 'postgres://127.0.0.1/audit_local');
});
test('preview implicit și tranzacție terminată exclusiv cu ROLLBACK', () => {
  const sql = sqlLocal();
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /v_mod text := 'preview'/);
  assert.match(sql, /ROLLBACK;\s*$/);
  assert.doesNotMatch(sql.replace(/--[^\n]*/g, ''), /\bCOMMIT\s*;/);
});
test('apply-test necesită UUID și remapează parametrul rollback din maparea clonei', () => {
  assert.throws(() => sqlLocal({ apply: true }));
  const sql = sqlLocal({ apply: true, responsabil: '00000000-0000-4000-8000-000000000007' });
  assert.equal((sql.match(/v_mod text := 'apply'/g) || []).length, 2);
  assert.match(sql, /v_clona bigint := \(SELECT id_nou FROM map_audit_v2/);
  assert.doesNotMatch(sql, /CREATE DATABASE|DROP DATABASE|session_replication_role/);
});
