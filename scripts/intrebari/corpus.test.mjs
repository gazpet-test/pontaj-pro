import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { CORPUS, BUCATA_MAX, taie, bucatiMd, bucatiJson, construiesteIndex, caleValida } from './corpus.mjs'

describe('corpusul pentru Întreabă echipa', () => {
  it('fișierele din corpus există și sunt doar cercetare normativă', () => {
    for (const c of CORPUS) {
      expect(caleValida(c)).toBe(true)
      expect(c.startsWith('docs/cercetare/')).toBe(true)
      expect(existsSync(c)).toBe(true)
    }
    expect(CORPUS.some(c => c.startsWith('docs/juridic/'))).toBe(false)
  })
  it('căi invalide', () => {
    for (const c of ['../x.md', 'docs/../src/App.jsx', 'src/App.jsx', 'docs/a.sql', 'C:/x/docs/a.md', null]) expect(caleValida(c)).toBe(false)
  })
  it('tăiere pe paragrafe, fără să depășească limita', () => {
    const b = taie(['a'.repeat(900), 'b'.repeat(900), 'c'.repeat(3200)].join('\n\n'), 1500)
    expect(b.every(x => x.length <= 1500)).toBe(true)
    expect(b[0]).toBe('a'.repeat(900))
    expect(b.join('').replace(/\s/g, '').length).toBe(5000)
  })
  it('markdown: bucăți pe secțiuni, cu calea titlurilor', () => {
    const md = '# Baza\nintro\n## NTPEE\nart. 228 sudura\n### Sudori\nautorizați ANRE\n## ISCIR\nexclus\n```\n# nu e titlu\n```'
    const b = bucatiMd('docs/cercetare/x.md', md)
    expect(b.map(x => x.titlu)).toEqual(['Baza', 'Baza › NTPEE', 'Baza › NTPEE › Sudori', 'Baza › ISCIR'])
    expect(b[3].text).toContain('# nu e titlu')
    expect(b.every(x => x.cale === 'docs/cercetare/x.md')).toBe(true)
  })
  it('JSON: o bucată pe înregistrare, titlu din id + locator', () => {
    const b = bucatiJson('docs/cercetare/registru_cerinte.json', [
      { requirement_id: 'REQ-1', locator: 'art. 160 alin. (1)', cerinta: 'Clarificări până la termen', evidenta_ceruta: ['SEAP'], snapshot_sha256: 'abc', prag: null },
      'gunoi', null,
    ])
    expect(b).toHaveLength(1)
    expect(b[0].titlu).toBe('REQ-1 · art. 160 alin. (1)')
    expect(b[0].text).toContain('cerinta: Clarificări până la termen')
    expect(b[0].text).toContain('evidenta_ceruta: SEAP')
    expect(b[0].text).not.toContain('abc')
    expect(b[0].text).not.toContain('prag')
  })
  it('indexul: raportează fișierele stricate, nu le ghicește', () => {
    const idx = construiesteIndex([
      { cale: 'docs/cercetare/a.md', continut: '# A\ntext', sha256: 'f'.repeat(64) },
      { cale: 'docs/cercetare/b.json', continut: '{stricat' },
      { cale: '../x.md', continut: 'x' },
    ], '2026-11-06T00:00:00Z')
    expect(idx.bucati).toHaveLength(1)
    expect(idx.fisiere.map(f => f.eroare || 'ok')).toEqual(['ok', 'JSON invalid', 'cale invalidă'])
    expect(idx.bucati.every(x => x.text.length <= BUCATA_MAX)).toBe(true)
  })
})
