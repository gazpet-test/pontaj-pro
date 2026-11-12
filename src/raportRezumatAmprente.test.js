// Rezumatul raportului zilnic, r3 (L15 + L19): amprenta stării de acces a migrării 20261216a folosește O SINGURĂ definiție — corpul
// AMPRENTA_L15 v1 din scripts/tichete_lot2_amprente.sql (PR #1071), copiat octet cu octet (fără CR) în scriptul coordonatorului
// (scripts/raport_rezumat_amprente.sql) și în migrare. Valorile de producție stau într-UN singur bloc marcat (BASELINE), verificat
// ÎNAINTE și DUPĂ schimbare; funcțiile pg_temp se șterg la final. Comportamentul: scripts/pglite/test_raport_rezumat_local.mjs.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const citeste = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r/g, '')
const SURSA = citeste('scripts/tichete_lot2_amprente.sql')
const SCRIPT = citeste('scripts/raport_rezumat_amprente.sql')
const MIG = citeste('supabase/migrations/20261216a_executie_raport_rezumat.sql')
const X = '20261216a'
const A = '-- >>> AMPRENTA_L15 v1', B = '-- <<< AMPRENTA_L15 v1'
const blocuri = (t, a, b) => {
  const out = []
  for (let i = t.indexOf(a); i >= 0; i = t.indexOf(a, i + 1)) out.push(t.slice(i, t.indexOf(b, i) + b.length))
  return out
}
const nr = (t, s) => t.split(s).length - 1

describe('20261216a — AMPRENTA_L15: o singură definiție (PR #1071 = scriptul coordonatorului = migrarea)', () => {
  const canonic = blocuri(SURSA, A, B)[0]
  it('corpul canonic există și e același în toate secțiunile sursei', () => {
    expect(canonic).toBeTruthy()
    expect(new Set(blocuri(SURSA, A, B)).size).toBe(1)
  })
  it('scriptul coordonatorului: corpul o singură dată, identic', () => {
    expect(blocuri(SCRIPT, A, B)).toEqual([canonic])
  })
  it('migrarea: corpul o singură dată, identic', () => {
    expect(blocuri(MIG, A, B)).toEqual([canonic])
  })
  it('restul secțiunii scriptului (lanțul de callee, linia de baseline, atenționările) = cel din sursă', () => {
    const coada = t => t.slice(t.indexOf('amp_start(oid, sursa) AS ('), t.indexOf('ORDER BY c.eticheta COLLATE "C";') + 32)
    expect(coada(SCRIPT)).toBe(coada(SURSA))
  })
  it('aceleași tabele în script și în migrare; pornirea are salvarea, versiunea, dreptul pe șantier și auth.uid()', () => {
    const intrare = SCRIPT.slice(SCRIPT.indexOf(`-- >>> INTRARE ${X}`), SCRIPT.indexOf(`-- <<< INTRARE ${X}`))
    const tab = intrare.split('\n').find(l => l.startsWith('amp_tabele('))
    expect(tab).toBe("amp_tabele(oid) AS (VALUES ('public.rapoarte_zilnice'::regclass::oid), ('public.raport_zilnic_salvari'::regclass::oid)),")
    expect(MIG.split('\n').filter(l => l.startsWith('amp_tabele('))).toEqual([tab])
    for (const f of ["public.fn_raport_zilnic_salveaza(bigint, date, jsonb, jsonb, jsonb, integer, uuid)", 'public.fn_raport_zilnic_versiune()',
      'public.fn_raport_santier_drept(bigint)', 'auth.uid()']) expect(intrare).toContain(`to_regprocedure('${f}')`)
  })
  it('BASELINE într-un singur loc marcat, funcțiile explicite citite DOAR din el; necompletat = refuz', () => {
    expect(nr(MIG, `-- >>> BASELINE ${X}`)).toBe(1)
    expect(nr(MIG, `-- <<< BASELINE ${X}`)).toBe(1)
    const bloc = MIG.slice(MIG.indexOf(`-- >>> BASELINE ${X}`), MIG.indexOf(`-- <<< BASELINE ${X}`))
    expect(bloc).toContain(`CREATE FUNCTION pg_temp.amp_baseline_${X}()`)
    expect(nr(MIG, `CREATE FUNCTION pg_temp.amp_baseline_${X}()`)).toBe(1)
    expect(MIG).toContain(`amp_functii_explicite(oid) AS (SELECT to_regprocedure(substr(b.eticheta, 9))::oid FROM pg_temp.amp_baseline_${X}() b WHERE b.eticheta LIKE 'functie %'),`)
    const linii = bloc.split('\n').map(l => l.trim()).filter(l => /^(, )?\('/.test(l))
    expect(linii.length).toBeGreaterThan(0)
    if (linii.some(l => l.includes('DE_COMPLETAT'))) {
      expect(linii).toEqual([`('DE_COMPLETAT: scripts/raport_rezumat_amprente.sql, sectiunea ${X}', '-')`])
    } else {
      linii.forEach((l, i) => expect(l).toMatch(i === 0 ? /^\('[^']+', '[0-9a-f]{32}'\)$/ : /^, \('[^']+', '[0-9a-f]{32}'\)$/))
      const et = linii.map(l => l.match(/\('([^']+)'/)[1])
      expect(new Set(et).size).toBe(et.length)
    }
    expect(MIG).toContain(`RAISE EXCEPTION '${X}: baseline L15 necompletat sau invalid`)
  })
  it('verificarea rulează ÎNAINTE (înaintea lock-urilor și a schimbării) și DUPĂ (după postcondiții), apoi funcțiile pg_temp se șterg', () => {
    const iInainte = MIG.indexOf(`PERFORM pg_temp.amp_verifica_${X}('inainte')`)
    const iLock = MIG.indexOf('DO $lock$')
    const iSchimbare = MIG.indexOf('ALTER TABLE public.rapoarte_zilnice')
    const iPost = MIG.indexOf('DO $post$')
    const iDupa = MIG.indexOf(`PERFORM pg_temp.amp_verifica_${X}('dupa')`)
    const iDrop = MIG.indexOf(`DROP FUNCTION pg_temp.amp_verifica_${X}(text), pg_temp.amp_calc_${X}(), pg_temp.amp_baseline_${X}();`)
    expect(iInainte).toBeGreaterThan(MIG.indexOf('DO $pre$'))
    expect(iLock).toBeGreaterThan(iInainte)
    expect(iSchimbare).toBeGreaterThan(iLock)
    expect(iPost).toBeGreaterThan(iSchimbare)
    expect(iDupa).toBeGreaterThan(iPost)
    expect(iDrop).toBeGreaterThan(iDupa)
    expect(MIG.slice(iDrop).trim().split('\n')).toHaveLength(1)
  })
  it('excepțiile „după” sunt EXACT cele declarate: triggerul nou al fiecărui tabel + funcțiile lor', () => {
    const f = MIG.slice(MIG.indexOf(`CREATE FUNCTION pg_temp.amp_verifica_${X}`), MIG.indexOf(`DO $l15_inainte$`))
    expect(f).toContain("c.eticheta IN ('tabel rapoarte_zilnice | triggere', 'tabel raport_zilnic_salvari | triggere')")
    expect(f).toContain("c.eticheta IN ('functie fn_raport_rezumat_garda()', 'functie fn_raport_rezumat_dupa_salvare()')")
    expect(nr(f, "p_moment = 'dupa'")).toBe(2)
  })
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
