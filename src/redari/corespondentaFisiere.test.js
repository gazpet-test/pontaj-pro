import { describe, it, expect } from 'vitest'
import { roluriPermise, valideazaFisierCoresp, slugNume, stampilaUtc, caleFisierCoresp, sha8, sha256Hex, fisierDeAprobat, fisiereRand, mimeFisier,
  MAX_FISIER_CORESP, fmtMarime } from './corespondentaFisiere.js'
import { mesajEroareCoresp, COL_CORESPONDENTA } from './corespondenta.js'

const SHA = 'ab'.repeat(32)

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
  it('calea: {proiect}/corespondenta/{cod}/{AAAAMMDD-HHmmss}-{sha8}-{slug}, in forma ceruta de trigger', () => {
    const d = new Date(Date.UTC(2026, 10, 4, 9, 5, 7))
    expect(stampilaUtc(d)).toBe('20261104-090507')
    const c = caleFisierCoresp({ proiectCod: 'LOT1-PRUNISOR-JUPA', corespCod: 'A1', sha256: SHA, nume: 'Scrisoare rev9.pdf', data: d })
    expect(c).toBe('LOT1-PRUNISOR-JUPA/corespondenta/A1/20261104-090507-abababab-scrisoare-rev9.pdf')
    // aceeasi regula ca fn_red_coresp_fisier_inainte (numele fisierului)
    expect(/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.(pdf|docx|jpe?g|png)$/i.test(c.split('/').pop())).toBe(true)
    expect(() => caleFisierCoresp({ proiectCod: '../x', corespCod: 'A1', sha256: SHA, nume: 'a.pdf' })).toThrow(/invalidă/)
    expect(() => caleFisierCoresp({ proiectCod: 'P', corespCod: 'A1', sha256: 'x', nume: 'a.pdf' })).toThrow(/sha256/)
  })
  it('sha256 hex (WebCrypto) si sha8', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(await sha256Hex(new Blob(['abc']))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha8(SHA)).toBe('abababab')
  })
  it('fisierul de aprobat = ultimul de_trimis (created_at desc, id desc), ca in BD', () => {
    const f = [
      { id: 'b', rol: 'de_trimis', created_at: '2026-11-04T10:00:00.1+00:00', corespondenta_id: 'r1' },
      { id: 'c', rol: 'dovada_trimitere', created_at: '2026-11-04T12:00:00+00:00', corespondenta_id: 'r1' },
      { id: 'a', rol: 'de_trimis', created_at: '2026-11-04T10:00:00.12+00:00', corespondenta_id: 'r1' },
      { id: 'z', rol: 'de_trimis', created_at: '2026-11-05T10:00:00+00:00', corespondenta_id: 'r2' },
    ]
    expect(fisierDeAprobat(fisiereRand(f, 'r1')).id).toBe('a')
    expect(fisierDeAprobat([{ id: 'a', rol: 'de_trimis', created_at: 't' }, { id: 'b', rol: 'de_trimis', created_at: 't' }]).id).toBe('b')
    expect(fisierDeAprobat(f.filter(x => x.rol !== 'de_trimis'))).toBeNull()
    expect(fisiereRand(f, 'r1').map(x => x.id)).toEqual(['c', 'a', 'b'])
  })
  it('mesajele noi din BD sunt traduse; coloanele noi sunt citite', () => {
    expect(mesajEroareCoresp({ code: '23514', message: 'redari: aproba doar dupa ce ai urcat fisierul de trimis' })).toMatch(/Urcă întâi/)
    expect(mesajEroareCoresp({ code: '23514', message: 'redari: fisierul de trimis nu se mai urca dupa trimitere / anulare; urca dovada sau raspunsul' })).toMatch(/dovada trimiterii/)
    expect(mesajEroareCoresp({ code: '23514', message: 'redari: fisierul lipseste din Storage (x)' })).toMatch(/Storage/)
    expect(mesajEroareCoresp({ code: '23514', message: 'redari: fisierele corespondentei sunt imutabile; urca o varianta noua' })).toMatch(/nu se modifică/)
    expect(COL_CORESPONDENTA).toMatch(/aprobat_fisier_id, aprobat_sha256/)
    expect(fmtMarime(2048)).toBe('2 KB'); expect(fmtMarime(3 * 1024 * 1024)).toBe('3.0 MB')
  })
})
