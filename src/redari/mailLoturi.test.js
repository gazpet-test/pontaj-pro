import { describe, it, expect, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { canonic, emailValid, gardaTrimitere, hashMesaj, hashLot, compuneMime, proceseazaMesaj, rezultatSend, potrivesteSent, TRANSPORT_REAL_ACTIV, DOAR_PROIECTE_TEST } from './mailLoturi.js'
import { raspundeTrimitere } from '../../supabase/functions/_shared/redariMailF2Handler.mjs'
import { citesteMail } from './mailLoturi.js'
if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto })
const id = '00000000-0000-4000-8000-000000000001'
const mesaj = () => ({ id, lot_id: id, catre: 'destinatar.fictiv@example.invalid', subiect_final: 'Convocare fictivă', corp_text_final: 'Text fictiv\nLinia 2', corp_html_final: null, message_id: `<${id}@gazpet.ro>`, stare: 'rezervat' })
const lot = () => ({ id, proiect_id: id, stare: 'aprobat', aprobat_de: id, aprobat_la: new Date().toISOString(), lot_sha256: 'a'.repeat(64), aprobat_lot_sha256: 'a'.repeat(64) })
// F2b: căsuța conectată face parte din setările „bune” (trimitere_conectata_la), ca în BD (red_mail_f2b_pornire_ck)
const garda = extra => gardaTrimitere({ owner: true, informare: true, setari: { trimitere_oprita: false, trimitere_conectata_la: '2026-11-18T10:00:00Z' }, lot: lot(), ...extra })
// Aceiași vectori ca DRY $hash_r2$. Expected din SHA256 .NET pe JSON canonic scris manual.
it.each([
  [false, '84926e2cb15dd2b2d219e296f441177f6a6087a672deabf0a585855e17937604'],
  [true, 'b1993ca04f6a78edc04a443885b40c2eb03f31f9c121b9f940d97d12bd1752ce'],
])('paritate SQL/JS: diacritice, CRLF, PDF=%s', async (pdf, expected) => {
  const m = { ...mesaj(), corp_text_final: 'Țară\r\nLinia 2' }
  if (pdf) Object.assign(m, { atasament_path: 'FICTIV/convocator.pdf', atasament_nume: 'convocator-fictiv.pdf', atasament_mime: 'application/pdf', atasament_marime: 7, atasament_sha256: 'a'.repeat(64) })
  expect(await hashMesaj(m)).toBe(expected)
})
describe('F2: garzi', () => {
  it('F2b: transportul real e pornit în cod DOAR cu garda „doar proiecte TEST”', () => { expect(TRANSPORT_REAL_ACTIV).toBe(true); expect(DOAR_PROIECTE_TEST).toBe(true) })
  it('calea legitimă trece gărzile de business', () => expect(garda()).toBe(null))
  it.each([null, false, undefined])('non-owner %s este refuzat', owner => expect(garda({ owner })).toBe('non_owner'))
  it.each([null, {}, { trimitere_oprita: true }])('comutator oprit sau necunoscut', setari => expect(garda({ setari })).toBe('trimitere_oprita'))
  it('căsuța neconectată este refuzată înaintea informării', () => expect(garda({ setari: { trimitere_oprita: false }, informare: false })).toBe('casuta_neconectata'))
  it.each([null, false, undefined])('informare nepublicata %s', informare => expect(garda({ informare })).toBe('informare_nepublicata'))
  it('aprobare expirată la timestamp exact', () => expect(garda({ acum: Date.parse('2026-11-12T00:00:00Z'), lot: { ...lot(), aprobat_la: '2026-11-05T00:00:00Z' } })).toBe('aprobare_expirata'))
  it('hash diferit', () => expect(garda({ lot: { ...lot(), aprobat_lot_sha256: 'b'.repeat(64) } })).toBe('lot_integritate'))
  it('stare lot necunoscută', () => expect(garda({ lot: { ...lot(), stare: 'alta' } })).toBe('lot_neaprobat'))
})
describe('F2: antete, JSON canonic, MIME', () => {
  it.each(['a@example.invalid', 'a+b@xn--test-9za.invalid'])('adresă unică validă %s', e => expect(emailValid(e)).toBe(true))
  it.each(['a@example.invalid,b@example.invalid', 'a@example.invalid\r\nBcc:x@x.invalid', '<a@example.invalid>', 'a..b@example.invalid', 'a@-example.invalid', 'a@example.invalid\n', 'a@é.invalid'])('adresă invalidă %s', e => expect(emailValid(e)).toBe(false))
  it('forma canonică are expected independent', () => expect(canonic({ z: ['a', 1], a: null })).toBe('{"a":null,"z":["a",1]}'))
  it('respinge PDF-ul schimbat după snapshot', async () => {
    const m = { ...mesaj(), atasament_path: 'FICTIV/convocator.pdf', atasament_nume: 'convocator-fictiv.pdf', atasament_mime: 'application/pdf', atasament_marime: 7, atasament_sha256: 'a'.repeat(64) }
    m.mesaj_sha256 = await hashMesaj(m)
    await expect(compuneMime(m, new TextEncoder().encode('%PDF-x!'))).rejects.toThrow('atasament_diferit')
  })
  it('subiectele lungi sunt împărțite în encoded-word RFC2047', async () => {
    const m = { ...mesaj(), subiect_final: 'ă'.repeat(200) }; m.mesaj_sha256 = await hashMesaj(m)
    const mime = await compuneMime(m)
    const words = mime.match(/=\?UTF-8\?B\?[^?]*\?=/g)
    expect(words.length).toBeGreaterThan(1); expect(words.every(w => w.length <= 75)).toBe(true)
  })
  it('hash-ul nu depinde de delimitatorul MIME', async () => {
    const m = mesaj(); m.mesaj_sha256 = await hashMesaj(m)
    const a = await compuneMime(m, null, 'aaa'), b = await compuneMime(m, null, 'bbb')
    expect(a).not.toBe(b); expect(await hashMesaj(m)).toBe(m.mesaj_sha256)
    expect(a.match(/^To:/gm)).toHaveLength(1); expect(a).not.toMatch(/^(Cc|Bcc):/m)
    expect(a).toContain('Content-Transfer-Encoding: base64')
  })
  it('refuză snapshot sau antet alterat', async () => {
    const m = mesaj(); m.mesaj_sha256 = await hashMesaj(m)
    await expect(compuneMime({ ...m, corp_text_final: 'modificat' })).rejects.toThrow('snapshot_diferit')
    await expect(hashMesaj({ ...m, subiect_final: 'x\r\nBcc: y' })).rejects.toThrow('antet_invalid')
  })
  it('normalizarea păstrează semantica și stabilizează NFC / CRLF', async () => {
    const m = mesaj()
    expect(await hashMesaj({ ...m, corp_text_final: 'a\r\nb  \r\nc' })).toBe(await hashMesaj({ ...m, corp_text_final: 'a\nb\nc' }))
    expect(await hashMesaj({ ...m, corp_text_final: 'a\nbc' })).not.toBe(await hashMesaj({ ...m, corp_text_final: 'a\nb\nc' }))
  })
  it('ordinea listei nu modifică hash-ul lotului; componența îl modifică', async () => {
    const a = { id: 'a', mesaj_sha256: 'a'.repeat(64) }, b = { id: 'b', mesaj_sha256: 'b'.repeat(64) }
    expect(await hashLot([a, b])).toBe(await hashLot([b, a])); expect(await hashLot([a])).not.toBe(await hashLot([a, b]))
  })
})
describe('F2: rezultat ambiguu / CAS / retry', () => {
  it.each([429, 500, 502, 0, 200])('%s fără răspuns complet este necunoscut', status => expect(rezultatSend(status, {})).toEqual({ stare: 'necunoscut', cod: 'rezultat_ambiguu' }))
  it('403 rate-limit este ambiguu, refuzul determinist nu', () => {
    expect(rezultatSend(403, { error: { errors: [{ reason: 'rateLimitExceeded' }] } }).stare).toBe('necunoscut')
    expect(rezultatSend(403, {}).stare).toBe('esuat_sigur')
    expect(rezultatSend(200, { id: 'fake-id', threadId: 'fake-thread' }).stare).toBe('trimis')
  })
  it('un mesaj care nu e rezervat e sărit fără efecte, chiar cu incepe=true', async () => {
    const deps = { incepe: vi.fn(async () => true), send: vi.fn(), rezultat: vi.fn(), descarca: vi.fn() }
    expect(await proceseazaMesaj({ ...mesaj(), stare: 'in_coada' }, deps)).toEqual({ stare: 'in_coada', sarit: true })
    for (const f of Object.values(deps)) expect(f).not.toHaveBeenCalled()
  })
  it('snapshot diferit: esuat_sigur persistat, niciun apel_incepe și niciun send', async () => {
    const m = mesaj(); m.mesaj_sha256 = 'b'.repeat(64)
    const deps = { incepe: vi.fn(async () => true), send: vi.fn(), rezultat: vi.fn(async (x, r) => r), descarca: vi.fn() }
    expect(await proceseazaMesaj(m, deps)).toEqual({ stare: 'esuat_sigur', cod: 'snapshot_diferit' })
    expect(deps.incepe).not.toHaveBeenCalled(); expect(deps.send).not.toHaveBeenCalled()
  })
  it('send ambiguu: un singur send, rezultatul necunoscut persistat cu retry doar pe persistare', async () => {
    const m = mesaj(); m.mesaj_sha256 = await hashMesaj(m)
    const rezultat = vi.fn().mockRejectedValueOnce(new Error('bd')).mockImplementation(async (x, r) => r)
    const deps = { incepe: vi.fn(async () => true), send: vi.fn(async () => ({ status: 503, json: async () => ({}) })), rezultat, descarca: vi.fn() }
    expect(await proceseazaMesaj(m, deps)).toEqual({ stare: 'necunoscut', cod: 'rezultat_ambiguu' })
    expect(deps.send).toHaveBeenCalledTimes(1); expect(rezultat).toHaveBeenCalledTimes(2)
  })
})
describe('F2: handler identitate și oprire', () => {
  const deps = () => ({ getUser: vi.fn(async () => ({ data: { user: { id } } })), owner: vi.fn(async () => ({ data: true })),
    lot: vi.fn(async () => ({ data: lot() })), proiect: vi.fn(async () => ({ data: { id, cod: 'LOT1-REAL' } })),
    setari: vi.fn(async () => ({ data: { trimitere_oprita: false, trimitere_conectata_la: '2026-11-18T10:00:00Z' } })), informare: vi.fn(async () => ({ data: true })),
    secret: vi.fn(async () => ({ data: 'rt' })), http: vi.fn(), rezerva: vi.fn(), incepe: vi.fn(), rezultat: vi.fn(), opreste: vi.fn(), descarca: vi.fn(), pauza: vi.fn() })
  it('anon JWT nu este utilizator; uid fals în body ignorat', async () => {
    const d = deps(); d.getUser.mockResolvedValue({ data: { user: null } })
    expect((await raspundeTrimitere({ jwt: 'fictiv', corp: { lot_id: id, is_owner: true, uid: id } }, d)).status).toBe(401)
    expect(d.owner).not.toHaveBeenCalled()
  })
  it('owner verificat în cod înaintea oricărei citiri a lotului', async () => {
    const d = deps(); d.owner.mockResolvedValue({ data: false })
    expect((await raspundeTrimitere({ jwt: 'fictiv', corp: { lot_id: id, is_owner: true } }, d)).status).toBe(403)
    expect(d.lot).not.toHaveBeenCalled()
  })
  it('setările/informarea eșuate nu sunt confundate cu zero (pe un proiect de TEST)', async () => {
    const d = deps(); d.proiect.mockResolvedValue({ data: { id, cod: 'TEST-RAZVAN' } }); d.informare.mockResolvedValue({ error: true })
    expect((await raspundeTrimitere({ jwt: 'fictiv', corp: { lot_id: id } }, d)).status).toBe(503)
    expect(d.secret).not.toHaveBeenCalled()
  })
  it('F2b: pe un proiect REAL, cu toate porțile trecute, transportul rămâne imposibil (423, înaintea setărilor și a secretului)', async () => {
    const d = deps()
    const r = await raspundeTrimitere({ jwt: 'fictiv', corp: { lot_id: id } }, d)
    expect(r.status).toBe(423); expect(r.body.cod).toBe('transport_real_doar_test')
    expect(d.setari).not.toHaveBeenCalled(); expect(d.secret).not.toHaveBeenCalled(); expect(d.http).not.toHaveBeenCalled()
  })
})
describe('F2: reconciliere fără încredere în antetul h', () => {
  it('corp alterat, duplicat sau CC: refuz; candidatul complet identic: potrivire', async () => {
    const m = { ...mesaj(), apel_inceput_la: '2026-11-05T12:00:00Z' }; m.mesaj_sha256 = await hashMesaj(m)
    const c = { messageIds: [m.message_id], to: [m.catre], subjects: [m.subiect_final], cc: [], bcc: [], internalDate: Date.parse('2026-11-05T12:00:01Z'), snapshot: { ...m } }
    expect(await potrivesteSent(m, [c])).toBe(true)
    expect(await potrivesteSent(m, [c, c])).toBe(false)
    expect(await potrivesteSent(m, [{ ...c, cc: ['fictiv@example.invalid'] }])).toBe(false)
    expect(await potrivesteSent(m, [{ ...c, snapshot: { ...m, corp_text_final: 'alt text' } }])).toBe(false)
  })
})
describe('F2: paginare', () => {
  it('continuă până la pagina goală chiar dacă serverul livrează o pagină mică', async () => {
    let n = 0
    const pagini = [[{ id: 'a' }], [{ id: 'b' }], []]
    const query = { select() { return this }, order() { return this }, limit() { return this }, eq() { return this }, gt() { return this }, then(fn) { return Promise.resolve({ data: pagini[n++] }).then(fn) } }
    expect(await citesteMail({ from: () => query }, 'red_mail_mesaje', {})).toEqual([{ id: 'a' }, { id: 'b' }])
    expect(n).toBe(3)
  })
})
