import { describe, it, expect } from 'vitest'
import { estDovadaVerificataPT } from './ofertarePropunereDate.js'

// Paritate JS ↔ SQL pentru R06 (cerută de Copilot înainte de merge #530).
// Tabelul de adevăr de mai jos NU e calculat în JS: e rezultatul rulării pe PostgreSQL-ul de producție (29.09.2026)
// a exact aceluiași predicat pe care îl are live view-ul v_ofertare_pt_stare (pg_get_viewdef):
//   a.status = ANY (ARRAY['acoperit','acoperit_partener']) AND a.verificat_pe_scan AND (NOT COALESCE(a.reverificare_ceruta, false))
// într-un WHERE (NULL ⇒ rândul nu trece ⇒ false). Acoperă toate combinațiile true/false/NULL.
const LIVE_VIEW_FRAGMENT = "(a.status = ANY (ARRAY['acoperit'::text, 'acoperit_partener'::text])) AND a.verificat_pe_scan AND (NOT COALESCE(a.reverificare_ceruta, false))"
const R06_POSTGRES = [
  ['acoperit', false, false, false], ['acoperit', false, true, false], ['acoperit', false, null, false],
  ['acoperit', true, false, true], ['acoperit', true, true, false], ['acoperit', true, null, true],
  ['acoperit', null, false, false], ['acoperit', null, true, false], ['acoperit', null, null, false],
  ['acoperit_partener', false, false, false], ['acoperit_partener', false, true, false], ['acoperit_partener', false, null, false],
  ['acoperit_partener', true, false, true], ['acoperit_partener', true, true, false], ['acoperit_partener', true, null, true],
  ['acoperit_partener', null, false, false], ['acoperit_partener', null, true, false], ['acoperit_partener', null, null, false],
  ['neacoperit', false, false, false], ['neacoperit', false, true, false], ['neacoperit', false, null, false],
  ['neacoperit', true, false, false], ['neacoperit', true, true, false], ['neacoperit', true, null, false],
  ['neacoperit', null, false, false], ['neacoperit', null, true, false], ['neacoperit', null, null, false],
  [null, false, false, false], [null, false, true, false], [null, false, null, false],
  [null, true, false, false], [null, true, true, false], [null, true, null, false],
  [null, null, false, false], [null, null, true, false], [null, null, null, false],
]

describe('R06 — paritate JS ↔ PostgreSQL (inclusiv NULL)', () => {
  it('acoperă toate cele 36 de combinații status × verificat_pe_scan × reverificare_ceruta', () => {
    expect(R06_POSTGRES).toHaveLength(36)
  })
  it.each(R06_POSTGRES)('status=%s scan=%s rev=%s ⇒ %s (ca în Postgres)', (status, verificat_pe_scan, reverificare_ceruta, asteptat) => {
    expect(estDovadaVerificataPT({ status, verificat_pe_scan, reverificare_ceruta })).toBe(asteptat)
  })
  it('câmpuri absente (undefined) se comportă ca NULL', () => {
    expect(estDovadaVerificataPT({ status: 'acoperit', verificat_pe_scan: true })).toBe(true)
    expect(estDovadaVerificataPT({ status: 'acoperit' })).toBe(false)
    expect(estDovadaVerificataPT(null)).toBe(false)
  })
  it('predicatul din view-ul live e cel testat', () => {
    expect(LIVE_VIEW_FRAGMENT).toContain('a.verificat_pe_scan AND (NOT COALESCE(a.reverificare_ceruta, false))')
  })
})
