import { describe, it, expect } from 'vitest'
import { roluriPermise, valideazaFisierCoresp, slugNume, stampilaUtc, caleFisierCoresp, sha8, sha256Hex, fisierDeAprobat, fisiereRand, mimeFisier,
  MAX_FISIER_CORESP, fmtMarime, aleator8, citesteFisiereProiect, listeazaFolder, orfani, folderCoresp, EMBED_PROIECT } from './corespondentaFisiere.js'
import { mesajEroareCoresp, COL_CORESPONDENTA } from './corespondenta.js'

const SHA = 'ab'.repeat(32)

// fake minimal pentru query builder-ul PostgREST: înregistrează apelurile, întoarce paginile pe rând
function fakeSupabase(pagini, obiecte = []) {
  const apeluri = []
  return { apeluri, from: tabel => {
    const q = { _f: [] }
    for (const op of ['select', 'eq', 'or', 'order', 'limit']) q[op] = (...a) => { q._f.push([op, ...a]); if (op === 'limit') { apeluri.push([tabel, ...q._f]); return Promise.resolve({ data: pagini.shift() || [], error: null }) } return q }
    return q
  }, storage: { from: () => ({ list: (folder, o) => { apeluri.push(['list', folder, o]); return Promise.resolve({ data: obiecte.slice(o.offset, o.offset + o.limit), error: null }) } }) } }
}

describe('fisierele corespondentei', () => {
  it('de_trimis nu se mai urca dupa trimis / raspuns / anulat; restul rolurilor oricand', () => {
    expect(roluriPermise({ stare: 'draft' })).toEqual(['de_trimis', 'dovada_trimitere', 'raspuns', 'altul'])
    expect(roluriPermise({ stare: 'aprobat' })).toContain('de_trimis')
    for (const stare of ['trimis', 'raspuns_primit', 'anulat']) expect(roluriPermise({ stare })).toEqual(['dovada_trimitere', 'raspuns', 'altul'])
  })
  it('validarea fisierului: tip, gol, 25 MB', () => {
    expect(valideazaFisierCoresp({ name: 'a.PDF', size: 10 })).toEqual([])
    expect(valideazaFisierCoresp({ name: 'a.docx', size: MAX_FISIER_CORESP })).toEqual([])
    expect(valideazaFisierCoresp({ name: 'a.exe', size: 10 })).toHaveLength(1)
    expect(valideazaFisierCoresp({ name: 'a.pdf', size: 0 })).toEqual(['Fișierul e gol.'])
    expect(valideazaFisierCoresp({ name: 'a.pdf', size: MAX_FISIER_CORESP + 1 })).toEqual(['Fișierul depășește 25 MB.'])
    expect(valideazaFisierCoresp(null)).toEqual(['Alege un fișier.'])
    expect(mimeFisier({ name: 'x.JPG', type: '' })).toBe('image/jpeg')
  })
  it('slug: fara diacritice / spatii, extensia in litere mici, nume gol -> fisier', () => {
    expect(slugNume('Scrisoare Transgaz – plan rev9 (final).PDF')).toBe('scrisoare-transgaz-plan-rev9-final.pdf')
    expect(slugNume('ăîșțâ.docx')).toBe('aista.docx')
    expect(slugNume('....pdf')).toBe('fisier.pdf')
    expect(slugNume('x'.repeat(100) + '.png')).toBe('x'.repeat(60) + '.png')
  })
  it('calea: {proiect}/corespondenta/{cod}/{AAAAMMDD-HHmmss}-{sha8}-{aleator8}-{slug}, in forma ceruta de trigger', () => {
    const d = new Date(Date.UTC(2026, 10, 4, 9, 5, 7))
    expect(stampilaUtc(d)).toBe('20261104-090507')
    const c = caleFisierCoresp({ proiectCod: 'LOT1-PRUNISOR-JUPA', corespCod: 'A1', sha256: SHA, nume: 'Scrisoare rev9.pdf', data: d, aleator: '0123abcd' })
    expect(c).toBe('LOT1-PRUNISOR-JUPA/corespondenta/A1/20261104-090507-abababab-0123abcd-scrisoare-rev9.pdf')
    // aceeasi regula ca fn_red_coresp_fisier_inainte (numele fisierului)
    expect(/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.(pdf|docx|jpe?g|png)$/i.test(c.split('/').pop())).toBe(true)
    expect(folderCoresp('P', 'A1')).toBe('P/corespondenta/A1')
    expect(() => caleFisierCoresp({ proiectCod: '../x', corespCod: 'A1', sha256: SHA, nume: 'a.pdf' })).toThrow(/invalidă/)
    expect(() => caleFisierCoresp({ proiectCod: 'P', corespCod: 'A1', sha256: 'x', nume: 'a.pdf' })).toThrow(/sha256/)
  })
  it('Copilot C-P3-02: doua cai generate in aceeasi secunda, acelasi continut si nume, sunt diferite', () => {
    const d = new Date(Date.UTC(2026, 10, 4, 9, 5, 7))
    const a = caleFisierCoresp({ proiectCod: 'P', corespCod: 'A1', sha256: SHA, nume: 'x.pdf', data: d })
    const b = caleFisierCoresp({ proiectCod: 'P', corespCod: 'A1', sha256: SHA, nume: 'x.pdf', data: d })
    expect(a).not.toBe(b)
    expect(aleator8()).toMatch(/^[0-9a-f]{8}$/)
  })
  it('sha256 hex (WebCrypto) si sha8', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(await sha256Hex(new Blob(['abc']))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha8(SHA)).toBe('abababab')
  })
  it('Jakarinos J-P1-2 (paritate cu PostgreSQL): helperii NU re-sorteaza — pastreaza ordinea din query (created_at desc, id desc)', () => {
    // ordinea PostgreSQL: 10:00:00.12 > 10:00:00 (ca text, '…00+00:00' vs '…00.12+00:00' s-ar fi comparat altfel)
    const dinBD = [
      { id: 'a', rol: 'de_trimis', created_at: '2026-11-04T10:00:00.12+00:00', corespondenta_id: 'r1' },
      { id: 'b', rol: 'de_trimis', created_at: '2026-11-04T10:00:00+00:00', corespondenta_id: 'r1' },
    ]
    expect(fisierDeAprobat(dinBD).id).toBe('a')
    expect(fisierDeAprobat([...dinBD].reverse()).id).toBe('b')   // nicio sortare locala: primul primit e cel ales
    const f = [{ id: 'c', rol: 'dovada_trimitere', corespondenta_id: 'r1' }, ...dinBD, { id: 'z', rol: 'de_trimis', corespondenta_id: 'r2' }]
    expect(fisiereRand(f, 'r1').map(x => x.id)).toEqual(['c', 'a', 'b'])
    expect(fisierDeAprobat(fisiereRand(f, 'r1')).id).toBe('a')
    expect(fisierDeAprobat(f.filter(x => x.rol !== 'de_trimis'))).toBeNull()
  })
  it('L23: citirea fisierelor proiectului e keyset pe (created_at desc, id desc), fara plafon tacut', async () => {
    const p1 = [{ id: 'f3', created_at: 't3', red_corespondenta: { proiect_id: 'p' } }, { id: 'f2', created_at: 't2', red_corespondenta: { proiect_id: 'p' } }]
    const p2 = [{ id: 'f1', created_at: 't1', red_corespondenta: { proiect_id: 'p' } }]
    const sb = fakeSupabase([p1, p2])
    const r = await citesteFisiereProiect(sb, 'p', { pagina: 2 })
    expect(r.map(x => x.id)).toEqual(['f3', 'f2', 'f1'])
    expect(r[0].red_corespondenta).toBeUndefined()
    expect(sb.apeluri).toHaveLength(2)
    const [, sel, eq, ...rest1] = sb.apeluri[0]
    expect(sel[1]).toContain(EMBED_PROIECT); expect(eq).toEqual(['eq', 'red_corespondenta.proiect_id', 'p'])
    expect(rest1).toEqual([['order', 'created_at', { ascending: false }], ['order', 'id', { ascending: false }], ['limit', 2]])
    expect(sb.apeluri[1]).toContainEqual(['or', 'created_at.lt."t2",and(created_at.eq."t2",id.lt.f2)'])
    // pagina plina exact la limita -> mai citeste o data (aici goala)
    const sb2 = fakeSupabase([p1, []])
    expect((await citesteFisiereProiect(sb2, 'p', { pagina: 2 })).length).toBe(2); expect(sb2.apeluri).toHaveLength(2)
    expect(await citesteFisiereProiect(fakeSupabase([p1]), 'p', { pagina: 5, esteCurent: () => false })).toBeNull()
  })
  it('Copilot C-P2-01: orfanii = obiecte din folder fara rand in tabel (listare paginata, fara foldere)', async () => {
    const ob = [{ id: '1', name: 'a.pdf', metadata: { size: 5 } }, { id: null, name: 'sub' }, { id: '2', name: 'b.pdf' }, { id: '3', name: 'c.pdf' }]
    const sb = fakeSupabase([], ob)
    const lista = await listeazaFolder(sb, 'P/corespondenta/A1', { pagina: 2 })
    expect(lista.map(o => o.path)).toEqual(['P/corespondenta/A1/a.pdf', 'P/corespondenta/A1/b.pdf', 'P/corespondenta/A1/c.pdf'])
    expect(sb.apeluri.map(a => a[2].offset)).toEqual([0, 2, 4])
    expect(orfani(lista, [{ path: 'P/corespondenta/A1/b.pdf' }]).map(o => o.nume)).toEqual(['a.pdf', 'c.pdf'])
  })
  it('mesajele noi din BD sunt traduse; coloanele noi sunt citite', () => {
    expect(mesajEroareCoresp({ code: '23514', message: 'redari: aproba doar dupa ce ai urcat fisierul de trimis' })).toMatch(/Urcă întâi/)
    expect(mesajEroareCoresp({ code: '23514', message: 'redari: intre timp s-a urcat alt fisier de trimis; reincarca si verifica' })).toMatch(/Între timp/)
    expect(mesajEroareCoresp({ code: '23514', message: 'redari: aprobarea trebuie sa indice fisierul de trimis confirmat; reincarca si verifica' })).toMatch(/confirmat/)
    expect(mesajEroareCoresp({ code: '23514', message: 'redari: obiectul nu are amprenta (eTag) in Storage; reincearca urcarea' })).toMatch(/eTag/)
    expect(mesajEroareCoresp({ code: '23514', message: 'redari: fisierul de trimis nu se mai urca dupa trimitere / anulare; urca dovada sau raspunsul' })).toMatch(/dovada trimiterii/)
    expect(mesajEroareCoresp({ code: '23514', message: 'redari: fisierul lipseste din Storage (x)' })).toMatch(/Storage/)
    expect(mesajEroareCoresp({ code: '23514', message: 'redari: fisierele corespondentei sunt imutabile; urca o varianta noua' })).toMatch(/nu se modifică/)
    expect(COL_CORESPONDENTA).toMatch(/aprobat_fisier_id, aprobat_sha256, aprobat_storage_etag/)
    expect(fmtMarime(2048)).toBe('2 KB'); expect(fmtMarime(3 * 1024 * 1024)).toBe('3.0 MB')
  })
})
