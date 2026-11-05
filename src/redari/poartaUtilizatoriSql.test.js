// L15: baseline-urile provin din sursele independente 29i/29j/29k, nu din SQL-ul portii.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
const citeste = p => readFileSync(p, 'utf8')
const migrare = citeste('supabase/migrations/20261131c_redari_poarta_utilizatori.sql')
const dry = citeste('supabase/tests/20261131c_redari_poarta_utilizatori_dryrun.sql')
const blocPlicuri = s => s.slice(s.indexOf('  -- BEGIN L15_PLICURI_R2'), s.indexOf('  -- END L15_PLICURI_R2') + '  -- END L15_PLICURI_R2'.length)
describe('PR3a r2 L15 — inventar si DRY mutant', () => {
  it('DRY exercita exact blocul preflight pentru plicuri livrat in migrare', () => {
    expect(blocPlicuri(dry)).toBe(blocPlicuri(migrare))
    expect(blocPlicuri(dry)).toContain('fn_red_plic_propaga()')
  })
  it.each([
    ['20261129j_redari_plicuri_0e.sql', 'fn_red_plic_creeaza'],
    ['20261129j_redari_plicuri_0e.sql', 'fn_red_plic_reguli'],
    ['20261129i_redari_plicuri.sql', 'fn_red_plic_propaga'],
    ['20261129i_redari_plicuri.sql', 'fn_red_plic_scan_exista'],
    ['20261129k_redari_ar_calitate.sql', 'fn_red_plic_ar_calitate'],
  ])('corpul revizuit %s / %s este in allow-list', (file, name) => {
    const sursa = citeste('supabase/migrations/' + file).split('FUNCTION public.' + name + '(')[1]
    const corp = sursa.slice(sursa.indexOf('AS $fn$') + 7, sursa.indexOf('$fn$;', sursa.indexOf('AS $fn$') + 7))
    const hash = createHash('md5').update(corp).digest('hex')
    expect(blocPlicuri(migrare)).toContain(`'${hash}'`)
  })
})
