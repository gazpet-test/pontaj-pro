// Lotul 2 de tichete, r2 (L15 + L19): amprenta stării de acces are O SINGURĂ definiție — corpul AMPRENTA_L15 din scriptul
// coordonatorului (scripts/tichete_lot2_amprente.sql) e copiat octet cu octet (fără CR) în cele trei migrări; fiecare migrare citește
// valorile de producție dintr-UN singur bloc marcat (BASELINE), le verifică ÎNAINTE și DUPĂ schimbare și își șterge funcțiile pg_temp.
// Comportamentul (refuzurile, aplicare → revenire → reaplicare) e probat pe PGlite: scripts/pglite/test_tichete_lot2_local.mjs.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const citeste = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r/g, '')
const SCRIPT = citeste('scripts/tichete_lot2_amprente.sql')
const MIGRARI = {
  '20261215a': citeste('supabase/migrations/20261215a_achizitii_note_interne.sql'),
  '20261215b': citeste('supabase/migrations/20261215b_probe_oferte_contact.sql'),
  '20261215c': citeste('supabase/migrations/20261215c_izometrie_muta_pozitie.sql'),
}
const A = '-- >>> AMPRENTA_L15 v1', B = '-- <<< AMPRENTA_L15 v1'
const blocuri = (t, a, b) => {
  const out = []
  for (let i = t.indexOf(a); i >= 0; i = t.indexOf(a, i + 1)) out.push(t.slice(i, t.indexOf(b, i) + b.length))
  return out
}
const nr = (t, s) => t.split(s).length - 1

describe('AMPRENTA_L15: o singură definiție (script = migrări)', () => {
  const dinScript = blocuri(SCRIPT, A, B)
  it('scriptul are corpul de trei ori (o secțiune pe migrare), identic', () => {
    expect(dinScript).toHaveLength(3)
    expect(new Set(dinScript).size).toBe(1)
  })
  for (const [x, t] of Object.entries(MIGRARI)) {
    it(`${x}: corpul e identic cu al scriptului, o singură dată`, () => {
      expect(blocuri(t, A, B)).toEqual([dinScript[0]])
    })
    it(`${x}: aceleași tabele ca secțiunea scriptului`, () => {
      const intrare = SCRIPT.slice(SCRIPT.indexOf(`-- >>> INTRARE ${x}`), SCRIPT.indexOf(`-- <<< INTRARE ${x}`))
      const tabeleScript = intrare.split('\n').find(l => l.startsWith('amp_tabele('))
      expect(tabeleScript).toBeTruthy()
      expect(t.split('\n').filter(l => l.startsWith('amp_tabele('))).toEqual([tabeleScript])
    })
    it(`${x}: BASELINE într-un singur loc marcat, funcțiile explicite citite DOAR din el`, () => {
      expect(nr(t, `-- >>> BASELINE ${x}`)).toBe(1)
      expect(nr(t, `-- <<< BASELINE ${x}`)).toBe(1)
      const bloc = t.slice(t.indexOf(`-- >>> BASELINE ${x}`), t.indexOf(`-- <<< BASELINE ${x}`))
      expect(bloc).toContain(`CREATE FUNCTION pg_temp.amp_baseline_${x}()`)
      // în afara blocului nu apare nicio valoare de tip md5 legată de baseline (VALUES-urile stau doar acolo)
      expect(nr(t, `CREATE FUNCTION pg_temp.amp_baseline_${x}()`)).toBe(1)
      expect(t).toContain(`amp_functii_explicite(oid) AS (SELECT to_regprocedure(substr(b.eticheta, 9))::oid FROM pg_temp.amp_baseline_${x}() b WHERE b.eticheta LIKE 'functie %'),`)
    })
    it(`${x}: verificarea rulează ÎNAINTE și DUPĂ schimbare, apoi funcțiile pg_temp se șterg`, () => {
      const iInainte = t.indexOf(`PERFORM pg_temp.amp_verifica_${x}('inainte')`)
      const iSchimbare = x === '20261215c' ? t.indexOf('CREATE FUNCTION public.fn_executie_tevi_muta_pozitie(') : t.indexOf('ALTER TABLE public.')
      const iPost = t.indexOf('DO $post$')
      const iDupa = t.indexOf(`PERFORM pg_temp.amp_verifica_${x}('dupa')`)
      const iDrop = t.indexOf(`DROP FUNCTION pg_temp.amp_verifica_${x}(text), pg_temp.amp_calc_${x}(), pg_temp.amp_baseline_${x}();`)
      expect(t.indexOf('DO $pre$')).toBeGreaterThanOrEqual(0)
      expect(iInainte).toBeGreaterThan(t.indexOf('DO $pre$'))
      expect(iSchimbare).toBeGreaterThan(iInainte)
      expect(iPost).toBeGreaterThan(iSchimbare)
      expect(iDupa).toBeGreaterThan(iPost)
      expect(iDrop).toBeGreaterThan(iDupa)
      // nimic după DROP în afara spațiilor (migrarea se termină cu curățenia)
      expect(t.slice(iDrop).trim().split('\n')).toHaveLength(1)
    })
    it(`${x}: baseline-ul e fie necompletat (→ refuz), fie completat din producție cu amprente md5 valide`, () => {
      const bloc = t.slice(t.indexOf(`-- >>> BASELINE ${x}`), t.indexOf(`-- <<< BASELINE ${x}`))
      const linii = bloc.split('\n').map(l => l.trim()).filter(l => /^(, )?\('/.test(l))
      expect(linii.length).toBeGreaterThan(0)
      if (linii.some(l => l.includes('DE_COMPLETAT'))) {
        expect(linii).toEqual([`('DE_COMPLETAT: scripts/tichete_lot2_amprente.sql, sectiunea ${x}', '-')`])
      } else {
        // completat: fiecare linie = (eticheta, md5), prima fără virgulă, restul cu virgulă, etichete unice
        linii.forEach((l, i) => expect(l).toMatch(i === 0 ? /^\('[^']+', '[0-9a-f]{32}'\)$/ : /^, \('[^']+', '[0-9a-f]{32}'\)$/))
        const et = linii.map(l => l.match(/\('([^']+)'/)[1])
        expect(new Set(et).size).toBe(et.length)
      }
      expect(t).toContain(`RAISE EXCEPTION '${x}: baseline L15 necompletat sau invalid`)
    })
    it(`${x}: fără marcaje de generare rămase și fără backslash în afara corpurilor`, () => {
      expect(t).not.toMatch(/@@/)
    })
  }
})

describe('scriptul coordonatorului e doar citire', () => {
  it('o tranzacție READ ONLY, încheiată cu ROLLBACK, fără scrieri', () => {
    expect(SCRIPT).toMatch(/^BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;$/m)
    expect(SCRIPT.trim().endsWith('ROLLBACK;')).toBe(true)
    const fara = SCRIPT.replace(/--[^\n]*/g, '')
    expect(fara).not.toMatch(/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE|TRUNCATE|COMMIT)\b/i)
    expect(fara).not.toMatch(/\bset_config\b/i)
  })
})
