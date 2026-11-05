// L15: baseline-urile provin din sursele independente 29i/29j/29k, nu din SQL-ul portii.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
// Git autocrlf pe Windows nu schimba amprenta canonica LF: eliminam CR inainte de orice extragere/hash.
const normalizeazaSql = text => text.replace(/\r/g, '')
const citeste = p => normalizeazaSql(readFileSync(p, 'utf8'))
const migrare = citeste('supabase/migrations/20261131c_redari_poarta_utilizatori.sql')
const dry = citeste('supabase/tests/20261131c_redari_poarta_utilizatori_dryrun.sql')
const blocPlicuri = text => {
  const s = normalizeazaSql(text)
  return s.slice(s.indexOf('  -- BEGIN L15_PLICURI_R2'), s.indexOf('  -- END L15_PLICURI_R2') + '  -- END L15_PLICURI_R2'.length)
}
const amprentaCorp = (text, name) => {
  const sursa = normalizeazaSql(text).split('FUNCTION public.' + name + '(')[1]
  const inceput = sursa.match(/\bAS[ \t\n]+(\$[A-Za-z_0-9]*\$)/i)
  if (!inceput) throw new Error(`Lipseste delimitatorul corpului SQL: ${name}`)
  const start = inceput.index + inceput[0].length, end = sursa.indexOf(inceput[1], start)
  if (end < 0) throw new Error(`Lipseste sfarsitul corpului SQL: ${name}`)
  const corp = sursa.slice(start, end)
  return createHash('md5').update(corp).digest('hex')
}
const functii = [
  ['20261129j_redari_plicuri_0e.sql', 'fn_red_plic_creeaza'],
  ['20261129j_redari_plicuri_0e.sql', 'fn_red_plic_reguli'],
  ['20261129i_redari_plicuri.sql', 'fn_red_plic_propaga'],
  ['20261129i_redari_plicuri.sql', 'fn_red_plic_scan_exista'],
  ['20261129k_redari_ar_calitate.sql', 'fn_red_plic_ar_calitate'],
]
describe('PR3a r2 L15 — inventar si DRY mutant', () => {
  it('DRY exercita exact blocul preflight pentru plicuri livrat in migrare', () => {
    expect(blocPlicuri(dry)).toBe(blocPlicuri(migrare))
    expect(blocPlicuri(dry)).toContain('fn_red_plic_propaga()')
  })
  it('r5: comparatia blocurilor ramane identica si cu finaluri LF/CRLF diferite', () => {
    expect(blocPlicuri(dry.replace(/\n/g, '\r\n'))).toBe(blocPlicuri(migrare))
    expect(blocPlicuri(dry)).toBe(blocPlicuri(migrare.replace(/\n/g, '\r\n')))
  })
  it.each(functii.flatMap(([file, name]) => ['LF', 'CRLF'].map(eol => [file, name, eol])))(
    'corpul revizuit %s / %s (%s) este in allow-list', (file, name, eol) => {
      const text = citeste('supabase/migrations/' + file)
      const sursa = eol === 'CRLF' ? text.replace(/\n/g, '\r\n') : text
      expect(blocPlicuri(migrare)).toContain(`'${amprentaCorp(sursa, name)}'`)
    })
})


// R6: sursele allow-list-ului sunt ULTIMELE definitii din migrarile aplicate inaintea 31c.
const baselineFunctii = JSON.parse(citeste('supabase/tests/fixtures/20261131c_functii_baseline.json'))
const preflight = migrare.split('END $pre$;')[0]
const radacinaMigrari = 'supabase/migrations/'
const migrariProductie = readdirSync(radacinaMigrari).filter(f => f.endsWith('.sql') && f < '20261131').sort()
const surseMigrari = migrariProductie.map(file => ({ file, text: citeste(radacinaMigrari + file) }))
const prerechizite = citeste('supabase/tests/fixtures/20261131c_prerechizite_baseline.sql')
describe('PR3a r6 — baseline dupa 30j / PR1 / PR2 si fixture productie', () => {
  it.each(baselineFunctii)('$signature: ultima definitie este $migration, cu hash canonic', ({ signature, migration }) => {
    const name = signature.split('(')[0]
    const definitii = surseMigrari.filter(s => s.text.includes(`CREATE FUNCTION public.${name}(`) || s.text.includes(`CREATE OR REPLACE FUNCTION public.${name}(`))
    // PR1 este pe alt branch inainte de merge; copia read-only poarta ref-ul sursei verificate.
    const cale = radacinaMigrari + migration
    const text = existsSync(cale) ? citeste(cale) : prerechizite
    if (existsSync(cale)) expect(definitii.at(-1)?.file).toBe(migration)
    else expect(migration).toBe('20261130n_redari_pv_utilizatori.sql')
    const hash = amprentaCorp(text, name)
    const rand = preflight.split('\n').find(l => l.includes(`'${signature}|`) || l.includes(`'${signature}',`))
    expect(rand).toBeDefined()
    expect(rand).toContain(hash)
  })
  it('vederile folosite sunt definite exact ca in 31d; comparatia PG pastreaza owner/ACL/security_invoker', () => {
    for (const [vedere, temp] of [['red_v_stare_parcela','pr3a_stare_31d_asteptat'], ['red_v_centralizator_uat','pr3a_centralizator_31d_asteptat']]) {
      const inceput = prerechizite.indexOf(`CREATE OR REPLACE VIEW public.${vedere}`)
      const sql = prerechizite.slice(inceput, prerechizite.indexOf(';', inceput) + 1)
        .replace(`CREATE OR REPLACE VIEW public.${vedere}`, `CREATE TEMP VIEW pg_temp.${temp}`)
      expect(preflight).toContain('  ' + sql.replace(/\n/g, '\n  '))
      expect(preflight).toContain(`pg_get_viewdef(to_regclass('public.${vedere}'), true)`)
    }
    expect(preflight).not.toMatch(/md5\((?:p\.)?prosrc\)/)
  })
  it('PG17: toate cele sase baseline-uri ACL de tabel includ MAINTAIN, fara a schimba granturile', () => {
    const acl = preflight.split('-- drepturile pe tabele (relacl)')[1].split('-- drepturile de care are nevoie')[0]
    expect(acl.match(/postgres=arwdDxtm\/postgres/g)).toHaveLength(6)
    expect(acl).not.toContain('postgres=arwdDxt/postgres')
  })
  it('DRY foloseste profilurile on_auth_user_created cu rol valid si aceeasi tranzactie armata de runner', () => {
    expect(dry).not.toContain('INSERT INTO public.profiles')
    expect(dry).toContain("UPDATE public.profiles SET role = 'manager_santier'")
    expect(dry).toContain("gazpet.livrare_migrare")
    expect(dry).toContain('txid_current()')
    expect(dry).toContain('-- \\i supabase/migrations/20261131c_redari_poarta_utilizatori.sql')
    expect(dry).not.toMatch(/^BEGIN;|^ROLLBACK;/m)
  })
})
