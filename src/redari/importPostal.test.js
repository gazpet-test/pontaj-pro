import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx-js-style'
import { citesteFisierPostal, ghicesteMaparea, parseazaData, clasificaEveniment, motivRetur, propune, aplica } from './importPostal.js'

const mapare = { nr_document: 'doc', nr_tracking: 'awb', data: 'data', eveniment: 'status', motiv: 'motiv' }
const convocare = (extra = {}) => ({ id: 'conv-fictiva-1', nr_document: 'C-0012', nr_tracking: null,
  data_expediere: null, data_confirmare_primire: null, retur: null, retur_data: null, ...extra })
const rand = (extra = {}) => ({ doc: 'C-0012', data: '02.11.2026', __rand: 7, ...extra })
const propunere = (r = {}, c = {}, mod = 'expediere') => propune([rand(r)], mapare, mod, [convocare(c)])
const bytes = s => new TextEncoder().encode(s).buffer

describe('citesteFisierPostal', () => {
  it('detecteaza separatorii, trim, ghilimele si numarul fizic al randului', () => {
    for (const sep of [';', ',']) {
      const r = citesteFisierPostal(bytes(`\n Document${sep}Data${sep}Observatii\n C-0012 ${sep}02.11.2026${sep}"un${sep}text\ncontinuat"\nC-0013${sep}03.11.2026${sep}ok`), 'test.csv')
      expect(r.coloane).toEqual(['Document', 'Data', 'Observatii'])
      expect(r.randuri[0]).toMatchObject({ __rand: 3, Document: 'C-0012', Observatii: `un${sep}text\ncontinuat` })
      expect(r.randuri[1].__rand).toBe(5)
    }
  })
  it('citeste prima foaie XLSX si pastreaza serialul Excel', () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[], ['Doc', 'Data'], ['C-0012', 46023]]), 'Prima')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Ignorat']]), 'A doua')
    const r = citesteFisierPostal(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), 'test.xlsx')
    expect(r.coloane).toEqual(['Doc', 'Data'])
    expect(r.randuri[0]).toMatchObject({ Doc: 'C-0012', Data: 46023, __rand: 3 })
  })
  it('refuza antete duplicate, date fara antet, CSV invalid, extensii si depasirea limitei', () => {
    for (const s of ['Doc;Doc\na;b', 'Doc\na;b', 'Doc;Data\n"neinchis', 'Doc;Data\n"a"text;b']) {
      expect(() => citesteFisierPostal(bytes(s), 'test.csv')).toThrow()
    }
    expect(() => citesteFisierPostal(bytes('Doc\na'), 'test.txt')).toThrow()
    expect(() => citesteFisierPostal(bytes('Doc\n' + 'C-0012\n'.repeat(20001)), 'test.csv')).toThrow(/20000/)
    expect(citesteFisierPostal(bytes('Doc\n' + 'C-0012\n'.repeat(20000)), 'test.csv').randuri).toHaveLength(20000)
  })
})

describe('date, mapare si clasificare', () => {
  it.each([[46023, '2026-01-01'], [46023.5, '2026-01-01'], ['02.11.2026', '2026-11-02'],
    ['02/11/2026 14:05', '2026-11-02'], ['2026-11-02T14:05:00Z', '2026-11-02'],
    ['29.02.2028', '2028-02-29'], ['29.02.2026', null], ['31/04/2026', null],
    ['01.01.2024', null], ['2031-01-01', null], ['02.11.2026 25:00', null],
    ['2026-11-02junk', null], ['', null], [NaN, null]])('parseazaData %s', (v, expected) => {
    expect(parseazaData(v)).toBe(expected)
  })
  it('Excel cu baza 1904: serialul se decaleaza cu 1462 de zile (Copilot f9 r1 P3-01)', () => {
    expect(parseazaData(46328)).toBe('2026-11-02')
    expect(parseazaData(46328 - 1462, { date1904: true })).toBe('2026-11-02')
  })

  it('ghiceste antete cu diacritice si majuscule', () => {
    expect(ghicesteMaparea(['Referință', 'Cod trimitere', 'DATA', 'Status', 'Observații'])).toEqual({
      nr_document: 'Referință', nr_tracking: 'Cod trimitere', data: 'DATA', eveniment: 'Status', motiv: 'Observații',
    })
    expect(ghicesteMaparea(['Nume']).data).toBe('')
  })
  it.each([['destinatar necunoscut', 'destinatar_necunoscut'], ['plecat', 'mutat'], ['mutat', 'mutat'],
    ['avizat', 'avizat_neridicat'], ['expirat', 'avizat_neridicat'], ['neridicat', 'avizat_neridicat'],
    ['refuz', 'refuz'], ['adresă greșită', 'adresa_incompleta'], ['insuficient', 'adresa_incompleta'], ['altceva', null]])('motiv %s', (v, expected) => {
    expect(motivRetur(v)).toBe(expected)
  })
  it.each([['predat la poștă', 'expediere'], ['preluat', 'expediere'], ['depus', 'expediere'], ['expediat', 'expediere'],
    ['predat', 'ar'], ['AR', 'ar'], ['livrat', 'ar'], ['confirmat', 'ar'], ['retur AR', 'retur'],
    ['returnat', 'retur'], ['refuz', 'retur'], ['necunoscut', 'retur'], ['mutat', 'retur'],
    ['incomplet', 'retur'], ['neridicat', 'retur'], ['parcare', 'expediere'], ['', 'expediere']])('eveniment %s', (v, expected) => {
    expect(clasificaEveniment(v, 'expediere')).toBe(expected)
  })
  it('foloseste modul implicit necunoscutului', () => expect(clasificaEveniment('alt status', 'retur')).toBe('retur'))
})

describe('propune', () => {
  it('expediere noua cu patch si snapshot CAS, normalizare document si tracking', () => {
    const r = propunere({ doc: 'c 12', awb: ' ab 123 ' }).aplicabile[0]
    expect(r).toMatchObject({ conv_id: 'conv-fictiva-1', nr_document: 'C-0012', rand: 7, tip: 'expediere',
      patch: { data_expediere: '2026-11-02', nr_tracking: 'AB123' }, vechi: { data_expediere: null, nr_tracking: null } })
    expect(propunere({ doc: 'c-0012' }).aplicabile).toHaveLength(1)
  })
  it('expediere deja / conflict si tracking existent nu se suprascrie', () => {
    expect(propunere({ awb: 'ab123' }, { data_expediere: '2026-11-02', nr_tracking: 'AB123' }).deja).toHaveLength(1)
    expect(propunere({}, { data_expediere: '2026-11-01' }).exceptii[0].motiv).toMatch(/conflict/)
    expect(propunere({ awb: 'alt' }, { nr_tracking: 'AB123' }).exceptii[0].motiv).toMatch(/tracking/)
    expect(propunere({ awb: 'ab123' }, { nr_tracking: 'AB123' }).aplicabile[0].patch).toEqual({ data_expediere: '2026-11-02' })
    expect(propunere({ awb: 'nou' }, { data_expediere: '2026-11-02' }).exceptii).toHaveLength(1)
  })
  it('AR cere expediere, ordine cronologica si absenta returului', () => {
    expect(propunere({}, {}, 'ar').exceptii[0].motiv).toMatch(/fără expediere/)
    expect(propunere({}, { data_expediere: '2026-11-03' }, 'ar').exceptii[0].motiv).toMatch(/înainte/)
    expect(propunere({}, { data_expediere: '2026-11-01', retur: 'refuz' }, 'ar').exceptii[0].motiv).toMatch(/are retur/)
    expect(propunere({}, { data_expediere: '2026-11-02' }, 'ar').aplicabile[0].patch).toEqual({ data_confirmare_primire: '2026-11-02' })
    expect(propunere({}, { data_expediere: '2026-11-01', data_confirmare_primire: '2026-11-02' }, 'ar').deja).toHaveLength(1)
    expect(propunere({}, { data_expediere: '2026-11-01', data_confirmare_primire: '2026-11-01' }, 'ar').exceptii[0].motiv).toMatch(/conflict/)
  })
  it('retur cere motiv, refuza AR si trateaza deja/conflict inclusiv retur_data orfan', () => {
    expect(propunere({}, {}, 'retur').exceptii[0].motiv).toMatch(/motiv/)
    const exp = { data_expediere: '2026-11-01' }
    expect(propunere({ motiv: 'refuz' }, { ...exp, data_confirmare_primire: '2026-11-01' }, 'retur').exceptii[0].motiv).toMatch(/are AR/)
    expect(propunere({ motiv: 'refuz' }, exp, 'retur').aplicabile[0].patch).toEqual({ retur: 'refuz', retur_data: '2026-11-02' })
    expect(propunere({ motiv: 'refuz' }, { ...exp, retur: 'refuz', retur_data: '2026-11-02' }, 'retur').deja).toHaveLength(1)
    expect(propunere({ motiv: 'refuz' }, { ...exp, retur: 'mutat', retur_data: '2026-11-02' }, 'retur').exceptii).toHaveLength(1)
    expect(propunere({ motiv: 'refuz' }, { ...exp, retur_data: '2026-11-02' }, 'retur').exceptii).toHaveLength(1)
    // Gemini f9 r1 P2: retur fara expediere / inainte de expediere -> exceptie
    expect(propunere({ motiv: 'refuz' }, {}, 'retur').exceptii[0].motiv).toBe('retur fără expediere')
    expect(propunere({ motiv: 'refuz' }, { data_expediere: '2026-11-05' }, 'retur').exceptii[0].motiv).toBe('retur înainte de expediere')
  })
  it('tracking unic ca rezerva, ambiguu refuzat, document prioritar', () => {
    expect(propunere({ doc: '', awb: ' ab 123 ' }, { nr_tracking: 'AB123' }).aplicabile).toHaveLength(1)
    const cs = [convocare({ nr_tracking: 'AB123' }), convocare({ id: 'conv-fictiva-2', nr_document: 'C-0013', nr_tracking: 'AB123' })]
    expect(propune([rand({ doc: '', awb: 'ab123' })], mapare, 'expediere', cs).exceptii[0].motiv).toMatch(/mai multe/)
    // Copilot f9 r1 P2-01: documentul gasit, dar AWB-ul e (si) al altei convocari -> exceptie, nu alegere tacita
    expect(propune([rand({ awb: 'ab123' })], mapare, 'expediere', cs).exceptii[0].motiv).toMatch(/altei convoc/)
    expect(propune([rand({ awb: 'ab123' })], mapare, 'expediere', [cs[0]]).aplicabile).toHaveLength(1)
    expect(propune([rand({ awb: 'ab123' })], mapare, 'expediere', [convocare({ nr_tracking: null })]).aplicabile[0].conv_id).toBe('conv-fictiva-1')
    expect(propunere({ doc: 'C-9999' }).exceptii[0].motiv).toBe('convocare inexistentă pentru numărul din fișier')
    // Gemini f9 r1 P2: numar gresit + tracking al altei convocari -> NU cade pe tracking
    expect(propune([rand({ doc: 'C-9999', awb: 'ab123' })], mapare, 'expediere', cs).exceptii[0].motiv).toMatch(/inexistent/)
    expect(propune([rand({ awb: 'ZZ999', status: 'livrat' })], mapare, 'expediere', [convocare({ nr_tracking: 'AB123', data_expediere: '2026-11-01' })]).exceptii[0].motiv).toMatch(/tracking diferit/)
  })
  it('duplicatul nu dispare si evenimentul poate schimba modul implicit', () => {
    // Copilot f9 r1 P3-02: doua randuri valide pe aceeasi convocare -> AMBELE la exceptii (nu castiga primul)
    const r = propune([rand(), rand({ __rand: 8 })], mapare, 'expediere', [convocare()])
    expect(r.aplicabile).toHaveLength(0)
    expect(r.exceptii.map(e => e.motiv)).toEqual(['mai multe evenimente pentru aceeași convocare în fișier', 'mai multe evenimente pentru aceeași convocare în fișier'])
    // un rand invalid nu blocheaza randul valid de dupa el
    const r2 = propune([rand({ data: 'invalid' }), rand({ __rand: 8 })], mapare, 'expediere', [convocare()])
    expect(r2.aplicabile).toHaveLength(1); expect(r2.exceptii).toHaveLength(1)
    // Copilot f9 r1 P2-02: acelasi AWB nou pe doua convocari diferite in fisier -> ambele exceptii
    const doua = [convocare({ nr_tracking: null }), convocare({ id: 'conv-fictiva-2', nr_document: 'C-0013', nr_tracking: null })]
    const r3 = propune([rand({ awb: 'NOU1' }), rand({ doc: 'C-0013', awb: 'NOU1', __rand: 8 })], mapare, 'expediere', doua)
    expect(r3.aplicabile).toHaveLength(0); expect(r3.exceptii.every(e => /același AWB/.test(e.motiv))).toBe(true)
    expect(propunere({ status: 'livrat' }, { data_expediere: '2026-11-01' }).aplicabile[0].tip).toBe('ar')
    expect(propunere({ data: 'invalid' }).exceptii).toHaveLength(1)
    expect(() => propune([], {}, 'expediere', [])).toThrow()
  })
})

// scrierile (update) intra in calls; recitirile AWB de dinainte de scriere (select fara update) intra in pre si raspund din alteAwb
function fakeSupabase(responses, apres = () => {}, alteAwb = {}) {
  const calls = [], pre = []
  return { calls, pre, from(table) {
    const call = { table, filtres: [] }
    const citire = { filtres: [], eq(k, v) { this.filtres.push(['eq', k, v]); return this }, neq(k, v) { this.filtres.push(['neq', k, v]); return this },
      limit() { return this }, then(ok, ko) { const awb = this.filtres.find(f => f[1] === 'nr_tracking')?.[2]; return Promise.resolve({ data: alteAwb[awb] || [], error: null }).then(ok, ko) } }
    const q = {
      update(patch) { call.patch = patch; calls.push(call); return q },
      eq(k, v) { call.filtres.push(['eq', k, v]); return q },
      is(k, v) { call.filtres.push(['is', k, v]); return q },
      select(cols) {
        if (!call.patch) { pre.push(citire); return citire }
        call.select = cols; apres(calls.length)
        return (async () => { const r = responses.shift(); if (r instanceof Error) throw r; return r ?? { data: [{ id: 'conv-fictiva-1' }], error: null } })()
      },
    }
    return q
  } }
}

describe('aplica CAS', () => {
  const a = () => propunere({ awb: 'AB123' }).aplicabile[0]
  it('0 randuri = conflict; filtrele includ id, activ, posta, nesters, campuri NULL si select', async () => {
    const db = fakeSupabase([{ data: [], error: null }]), r = await aplica(db, [a()])
    expect(r.conflicte).toHaveLength(1); expect(r.aplicate).toHaveLength(0)
    expect(db.calls[0]).toMatchObject({ table: 'red_convocari', select: 'id', patch: { data_expediere: '2026-11-02', nr_tracking: 'AB123' } })
    expect(db.calls[0].filtres).toEqual(expect.arrayContaining([
      ['eq', 'id', 'conv-fictiva-1'], ['eq', 'stare', 'activ'], ['eq', 'canal', 'posta'], ['is', 'sters_la', null],
      ['is', 'data_expediere', null], ['is', 'nr_tracking', null], ['is', 'retur', null], ['is', 'data_confirmare_primire', null],
    ]))
  })
  it('snapshot AR protejeaza expedierea si absenta returului; tracking existent nu cere NULL', async () => {
    const db = fakeSupabase([])
    await aplica(db, propunere({}, { nr_tracking: 'VECHI', data_expediere: '2026-11-01' }, 'ar').aplicabile)
    expect(db.calls[0].filtres).toEqual(expect.arrayContaining([['eq', 'data_expediere', '2026-11-01'], ['eq', 'nr_tracking', 'VECHI'], ['is', 'retur', null]]))
    expect(db.calls[0].filtres).not.toContainEqual(['is', 'nr_tracking', null])
  })
  it('AWB-ul ajuns intre timp pe alta convocare -> conflict, fara scriere (Copilot f9 r2 P2-01)', async () => {
    const db = fakeSupabase([], () => {}, { AB123: [{ id: 'conv-fictiva-9' }] })
    const r = await aplica(db, [a()])
    expect(r.conflicte).toHaveLength(1); expect(r.conflicte[0].motiv).toMatch(/altă convocare/)
    expect(db.calls).toHaveLength(0); expect(db.pre[0].filtres).toEqual([['eq', 'nr_tracking', 'AB123'], ['neq', 'id', 'conv-fictiva-1']])
  })
  it('eroare continua, fara retry; succesul reseteaza numarul erorilor consecutive', async () => {
    const err = { data: null, error: { message: 'eroare fictiva' } }
    const db = fakeSupabase([err, new Error('retea fictiva'), { data: [{ id: 'conv-fictiva-1' }] }, err, err, err, err])
    const r = await aplica(db, Array.from({ length: 7 }, a))
    expect(r.aplicate).toHaveLength(1); expect(r.erori).toHaveLength(6); expect(db.calls).toHaveLength(7)
  })
  it('opreste dupa 5 erori consecutive si raporteaza neprocesatele', async () => {
    const db = fakeSupabase(Array.from({ length: 8 }, () => ({ error: { message: 'eroare fictiva' } })))
    const r = await aplica(db, Array.from({ length: 8 }, a))
    expect(db.calls).toHaveLength(5); expect(r.erori).toHaveLength(5); expect(r.neprocesate).toHaveLength(3)
  })
  it('esteCurent false opreste inainte de primul UPDATE si la limita de 25', async () => {
    const db = fakeSupabase([])
    expect((await aplica(db, [a()], { esteCurent: () => false })).neprocesate).toHaveLength(1)
    expect(db.calls).toHaveLength(0)
    let curent = true
    const db2 = fakeSupabase([], n => { if (n === 25) curent = false })
    const r = await aplica(db2, Array.from({ length: 30 }, a), { esteCurent: () => curent })
    expect(r.aplicate).toHaveLength(25); expect(r.neprocesate).toHaveLength(5)
  })
  it('raspuns fara lista nu este succes sau conflict determinist', async () => {
    const r = await aplica(fakeSupabase([{ data: null }]), [a()])
    expect(r.erori).toHaveLength(1); expect(r.aplicate).toHaveLength(0)
  })
  it('schimbarea proiectului opreste si in interiorul lotului', async () => {
    let curent = true
    const db = fakeSupabase([], () => { curent = false })
    const r = await aplica(db, [a(), a(), a()], { esteCurent: () => curent })
    expect(db.calls).toHaveLength(1)
    expect(r.aplicate).toHaveLength(1); expect(r.neprocesate).toHaveLength(2)
  })
  it('AR si retur din acelasi snapshot nu se pot aplica amandoua', async () => {
    const c = convocare({ data_expediere: '2026-11-01' })
    // in acelasi fisier ambele devin exceptii; aici simulam doua importuri pe acelasi snapshot (doua ferestre deschise)
    expect(propune([rand({ status: 'AR' }), rand({ status: 'retur', motiv: 'refuz', __rand: 8 })], mapare, 'expediere', [c]).aplicabile).toHaveLength(0)
    const prop = { aplicabile: [...propune([rand({ status: 'AR' })], mapare, 'expediere', [c]).aplicabile, ...propune([rand({ status: 'retur', motiv: 'refuz' })], mapare, 'expediere', [c]).aplicabile] }
    expect(prop.aplicabile).toHaveLength(2)
    const stare = { ...c, stare: 'activ', canal: 'posta', sters_la: null }
    const db = { from() {
      const filtre = []; let patch
      const q = {
        update(p) { patch = p; return q },
        eq(k, v) { filtre.push([k, v]); return q },
        is(k, v) { filtre.push([k, v]); return q },
        async select() {
          if (!filtre.every(([k, v]) => stare[k] === v)) return { data: [] }
          Object.assign(stare, patch)
          return { data: [{ id: stare.id }] }
        },
      }
      return q
    } }
    const r = await aplica(db, prop.aplicabile)
    expect(r.aplicate).toHaveLength(1); expect(r.conflicte).toHaveLength(1)
    expect(stare.data_confirmare_primire).toBe('2026-11-02'); expect(stare.retur).toBeNull()
  })
})
