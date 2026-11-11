// Rezumatul raportului zilnic (etapa 1): regula JS pe tabelul de cazuri (rezultatele scrise de mână, nu din cod — L25)
// + paritatea textelor care trebuie să fie identice între migrare, scriptul de probă și harness-ul SQL (L19).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { rezumatRaport, curata, trunchiaza, fmtNr, etichetaRezumat, valideazaEditat, MAX_EDITAT } from './raportRezumat.js'

const citeste = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r/g, '')
const CAZURI = JSON.parse(citeste('./raportRezumat.cazuri.json'))
const bloc = (text, start, end) => {
  const i = text.indexOf(start), j = text.indexOf(end)
  if (i < 0 || j < 0 || j < i) throw new Error(`blocul ${start} lipsește`)
  return text.slice(i + start.length, j)
}

describe('rezumatRaport — tabelul de cazuri (același pe care îl rulează și SQL-ul)', () => {
  it('are cazurile cerute în brief', () => {
    expect(CAZURI.length).toBeGreaterThanOrEqual(8)
    for (const c of CAZURI) expect(typeof c.asteptat).toBe('string')
  })
  for (const c of CAZURI) {
    it(c.nume, () => { expect(rezumatRaport(c.intrare)).toBe(c.asteptat) })
  }
  it('intrare care nu e obiect = doar titlul', () => {
    expect(rezumatRaport(null)).toBe('Raport zilnic')
    expect(rezumatRaport([1, 2])).toBe('Raport zilnic')
    expect(rezumatRaport('text')).toBe('Raport zilnic')
  })
  it('cifrele nu se rotunjesc și nu se adună (două linii pe aceeași activitate rămân două)', () => {
    const t = rezumatRaport({ linii: [
      { activitate: 'Sudură', um: 'buc', cantitate: 1.005 }, { activitate: 'Sudură', um: 'buc', cantitate: 2.999 }] })
    expect(t).toBe('Raport zilnic\nLucrări: Sudură 1,005 buc; Sudură 2,999 buc')
  })
  it('niciun număr nou față de intrare (în afara datei și a numărătorilor de utilaje)', () => {
    const c = CAZURI[0]
    const nr = (s) => (s.match(/[0-9]+(,[0-9]+)?/g) || [])
    // numerele intrării: lot / contract (9, 99, 2026), data (10, 11, 2026), meteo, oameni, utilaje (3 = numărul, 3 din „3CX”, 1 din „GEN-1”),
    // cantitățile, obiectele (TR1 / TR2), poze
    const permise = new Set(['9', '99', '2026', '10', '11', '8,3', '2,4', '17', '4', '3', '2', '1', '6', '35,5', '12', '147,25'])
    for (const n of nr(rezumatRaport(c.intrare))) expect(permise.has(n), n).toBe(true)
  })
})

describe('unelte de text', () => {
  it('curata: controale -> spațiu, spații repetate -> unul, capete fără spații', () => {
    expect(curata('  a\t\tb\r\nc  ')).toBe('a b c')
    expect(curata(null)).toBe('')
    expect(curata(12)).toBe('')
    // spațiul neîntrerupt (U+00A0) nu e spațiu obișnuit: rămâne (aceeași regulă ca în SQL)
    const nbsp = String.fromCharCode(160)
    expect(curata(`a${nbsp}b`)).toBe(`a${nbsp}b`)
  })
  it('trunchiaza: pe cuvinte, la limită, cuvânt unic lung', () => {
    expect(trunchiaza('unu doi trei', 7)).toBe('unu doi…')
    expect(trunchiaza('unu doi trei', 8)).toBe('unu doi…')
    expect(trunchiaza('unu doi trei', 12)).toBe('unu doi trei')
    expect(trunchiaza('abcdefghij', 4)).toBe('abcd…')
    // emoji = un singur caracter (ca length() din PostgreSQL)
    expect(trunchiaza('🚧🚧🚧 x', 3)).toBe('🚧🚧🚧…')
  })
  it('fmtNr: virgulă zecimală, nenumăr = null', () => {
    expect(fmtNr(12.5)).toBe('12,5')
    expect(fmtNr(-2.5)).toBe('-2,5')
    expect(fmtNr(10000000)).toBe('10000000')
    expect(fmtNr('3')).toBe(null)
    expect(fmtNr(NaN)).toBe(null)
  })
  it('eticheta rubricii și validarea textului corectat', () => {
    expect(etichetaRezumat({ rezumat_sursa: 'automat' })).toBe('generat automat')
    expect(etichetaRezumat({ rezumat_sursa: 'editat' }, 'NUME TEST')).toBe('editat de NUME TEST')
    expect(etichetaRezumat({ rezumat_sursa: null })).toBe(null)
    expect(valideazaEditat('  \n ')).toMatch(/gol/)
    expect(valideazaEditat('x'.repeat(MAX_EDITAT))).toBe(null)
    expect(valideazaEditat('x'.repeat(MAX_EDITAT + 1))).toMatch(/maximum/)
  })
})

describe('paritate între fișiere (L19)', () => {
  const MIG = citeste('../supabase/migrations/20261215a_executie_raport_rezumat.sql')
  it('blocul INTRARE din migrare = cel din scriptul de probă (aceeași intrare pentru SQL și JS)', () => {
    const PROBA = citeste('../scripts/raport_rezumat_proba.sql')
    expect(bloc(PROBA, '-- INTRARE-START', '-- INTRARE-END')).toBe(bloc(MIG, '-- INTRARE-START', '-- INTRARE-END'))
  })
  it('harness-ul SQL rulează EXACT tabelul de cazuri din src/raportRezumat.cazuri.json', () => {
    const H = citeste('../scripts/test_executie_raport_rezumat.sql')
    const j = bloc(H, '-- CAZURI-START', '-- CAZURI-END')
    const m = /\$cazuri\$([\s\S]*)\$cazuri\$/.exec(j)
    expect(m).not.toBe(null)
    expect(JSON.parse(m[1])).toEqual(CAZURI)
  })
  it('limitele de tăiere și maximul textului corectat sunt aceleași în SQL', () => {
    expect(MIG).toContain("fn_raport_rezumat_sir(x, 'lucrari'), 240)")
    expect(MIG).toContain("fn_raport_rezumat_sir(x, 'probleme'), 240)")
    expect(MIG).toContain("fn_raport_rezumat_sir(x, 'masini'), 160)")
    expect(MIG).toContain("fn_raport_rezumat_sir(q.e, 'motiv'), 80)")
    expect(MIG).toContain(`char_length(rezumat_text) <= ${MAX_EDITAT}`)
  })
  it('amprentele din revenire = corpurile funcțiilor din migrare (md5 fără CR, ca prosrc din BD)', async () => {
    const { createHash } = await import('node:crypto')
    const REV = citeste('../supabase/revenire/20261215a_executie_raport_rezumat_ROLLBACK.sql')
    const linii = bloc(REV, '-- AMPRENTE-START', '-- AMPRENTE-END').split('\n').filter(l => l.includes("('fn_raport_rezumat_"))
    expect(linii.length).toBe(8)
    for (const l of linii) {
      const [, nume, amp] = /\('(fn_raport_rezumat_[a-z_]+)', '[^']+', '([0-9a-f]{32})'\)/.exec(l)
      const i = MIG.indexOf(`CREATE FUNCTION public.${nume}(`)
      expect(i, nume).toBeGreaterThan(0)
      const a = /\bAS\s+(\$[A-Za-z_]*\$)/.exec(MIG.slice(i))
      const st = i + a.index + a[0].length
      expect(createHash('md5').update(MIG.slice(st, MIG.indexOf(a[1], st)), 'utf8').digest('hex'), nume).toBe(amp)
    }
  })
  it('migrarea nu atinge RPC-urile 20261208a (amprenta lor e ținută de 20261209a / 20261213a)', () => {
    expect(MIG).not.toMatch(/CREATE (OR REPLACE )?FUNCTION public\.fn_raport_zilnic_/)
    expect(MIG).not.toMatch(/GRANT /)
  })
})
