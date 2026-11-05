// D4 (audit 04.11.2026): starea „convocator generat, neexpediat” — Registru + gardă la număr nou în ModalConvocator.
import { describe, it, expect, vi } from 'vitest'
import { COL_CONV_NEEXPEDIAT, filtruNeexpediate, grupeazaNeexpediate, etichetaNeexpediat, textConfirmareNumarNou, poateGeneraNou,
  citesteNeexpediatePeDetinatori, poateDescarcaExistent, poateDeschideConvocator, cititorCuGeneratie, dataDocumentConvocare,
  aparuteDupaVerificare, rezervaNumarConvocare, motivRelatieSchimbata, motivIdentitateDiferita, AVERTISMENT_CONCURENTA } from './convocatorNeexpediat.js'
import { formatDataRo } from './docx.js'

// fake red_convocari: filtrează pe detinator_id (in) și id > cursor (gt), ordonează pe id, plafonează pagina la `plafon`
// (indiferent de limit — ca un server cu max-rows mai mic). `suprascrie(n)` poate înlocui răspunsul paginii n.
const fakeConvocari = (randuri, { plafon = 1000, suprascrie = () => null } = {}) => {
  const cereri = []
  const supabase = { from: (tabel) => ({ select: (col) => {
    const st = { tabel, col, filtre: [], in: null, gt: null, limit: null }
    const q = {
      eq: (c, v) => { st.filtre.push(['eq', c, v]); return q }, is: (c, v) => { st.filtre.push(['is', c, v]); return q },
      in: (c, v) => { st.in = v; return q }, gt: (c, v) => { st.gt = v; return q }, order: () => q,
      limit: (n) => { st.limit = n; return q },
      then: (rez, rej) => {
        const n = cereri.push(st) - 1
        const alt = suprascrie(n, st)
        if (alt) return Promise.resolve(alt).then(rez, rej)
        const date = randuri.filter(r => st.in.includes(r.detinator_id) && (st.gt === null || r.id > st.gt)).sort((a, b) => a.id.localeCompare(b.id))
        return Promise.resolve({ data: date.slice(0, Math.min(plafon, st.limit)), error: null }).then(rez, rej)
      },
    }
    return q
  } }) }
  return { supabase, cereri }
}
const id = (i) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`

// fake PostgREST: înregistrează lanțul de apeluri
const lant = () => {
  const apeluri = []
  const q = new Proxy({}, { get: (_, m) => (...a) => { apeluri.push([m, ...a]); return q } })
  return { q, apeluri }
}

describe('convocatorNeexpediat', () => {
  it('filtrul: activ, neexpediat, neșters', () => {
    const { q, apeluri } = lant()
    filtruNeexpediate(q)
    expect(apeluri).toEqual([['eq', 'stare', 'activ'], ['is', 'data_expediere', null], ['is', 'sters_la', null]])
  })

  it('coloanele citite: fără PII, cu numărul și fișierul', () => {
    expect(COL_CONV_NEEXPEDIAT).not.toMatch(/adresa|telefon|token|email/)
    expect(COL_CONV_NEEXPEDIAT).toMatch(/nr_document/)
    expect(COL_CONV_NEEXPEDIAT).toMatch(/fisier_convocator_path/)
  })

  it('grupare pe deținător, cea mai recentă prima; rândurile fără deținător se ignoră', () => {
    const h = grupeazaNeexpediate([
      { id: 'a', detinator_id: 'd1', nr_document: 'C-0001', created_at: '2026-11-01T10:00:00Z' },
      { id: 'b', detinator_id: 'd1', nr_document: 'C-0003', created_at: '2026-11-04T01:58:00Z' },
      { id: 'c', detinator_id: 'd2', nr_document: 'C-0002', created_at: '2026-11-02T10:00:00Z' },
      { id: 'x', detinator_id: null, nr_document: 'C-9999' },
    ])
    expect([...h.keys()]).toEqual(['d1', 'd2'])
    expect(h.get('d1').map(c => c.nr_document)).toEqual(['C-0003', 'C-0001'])
    expect(grupeazaNeexpediate(null).size).toBe(0)
  })

  it('eticheta din Registru', () => {
    expect(etichetaNeexpediat([])).toBe('')
    expect(etichetaNeexpediat(undefined)).toBe('')
    expect(etichetaNeexpediat([{ nr_document: 'C-0002', fisier_convocator_path: 'P/HUS/x/C-0002-v1.docx' }])).toBe('Convocator generat C-0002 (neexpediat)')
    expect(etichetaNeexpediat([{ nr_document: 'C-0002', fisier_convocator_path: null }, { nr_document: 'C-0001', fisier_convocator_path: 'p' }]))
      .toBe('Convocator generat C-0002 (neexpediat, fișier neîncărcat) +1')
  })

  it('număr nou: blocat cât se citește și la eroare (fail-closed); liber fără existente; cu existente doar cu confirmare', () => {
    expect(poateGeneraNou({ existente: null })).toBe(false)
    expect(poateGeneraNou({ existente: null, confirmat: true })).toBe(false)
    expect(poateGeneraNou({ existente: [], eroare: 'rețea' })).toBe(false)
    expect(poateGeneraNou({ existente: [{ nr_document: 'C-0002' }], eroare: 'x', confirmat: true })).toBe(false)
    expect(poateGeneraNou({ existente: [] })).toBe(true)
    expect(poateGeneraNou({ existente: [{ nr_document: 'C-0002' }] })).toBe(false)
    expect(poateGeneraNou({ existente: [{ nr_document: 'C-0002' }], confirmat: 'da' })).toBe(false)
    expect(poateGeneraNou({ existente: [{ nr_document: 'C-0002' }], confirmat: true })).toBe(true)
  })

  it('r2 P2-3: keyset complet — 800 de rânduri cu plafon server 500 → toate 800, până la pagina goală, pe loturi de deținători', async () => {
    const randuri = Array.from({ length: 800 }, (_, i) => ({ id: id(i + 1), detinator_id: i < 790 ? 'd1' : `d${i}` }))
    const { supabase, cereri } = fakeConvocari(randuri, { plafon: 500 })
    const ids = ['d1', ...Array.from({ length: 150 }, (_, i) => `d${i + 700}`)]
    const tot = await citesteNeexpediatePeDetinatori(supabase, ids)
    expect(tot).toHaveLength(800)
    expect(new Set(tot.map(r => r.id)).size).toBe(800)
    expect(cereri[0].tabel).toBe('red_convocari')
    expect(cereri[0].filtre).toEqual([['eq', 'stare', 'activ'], ['is', 'data_expediere', null], ['is', 'sters_la', null]])
    expect(Math.max(...cereri.map(c => c.in.length))).toBeLessThanOrEqual(100)
    expect(cereri.every(c => c.limit === 1000)).toBe(true)
    expect(await citesteNeexpediatePeDetinatori(supabase, [])).toEqual([])
  })

  it('r2 P2-3: eroare, răspuns fără listă și paginare care nu avansează → aruncă (nu „nicio convocare”)', async () => {
    const randuri = [{ id: id(1), detinator_id: 'd1' }, { id: id(2), detinator_id: 'd1' }]
    await expect(citesteNeexpediatePeDetinatori(fakeConvocari(randuri, { suprascrie: () => ({ data: null, error: { message: 'RLS' } }) }).supabase, ['d1'])).rejects.toMatchObject({ message: 'RLS' })
    await expect(citesteNeexpediatePeDetinatori(fakeConvocari(randuri, { suprascrie: () => ({ data: null, error: null }) }).supabase, ['d1'])).rejects.toThrow(/fără listă/)
    await expect(citesteNeexpediatePeDetinatori(fakeConvocari(randuri, { suprascrie: (n) => (n === 1 ? { data: null, error: null } : null), plafon: 1 }).supabase, ['d1'])).rejects.toThrow(/fără listă/)
    await expect(citesteNeexpediatePeDetinatori(fakeConvocari(randuri, { suprascrie: () => ({ data: [randuri[0]], error: null }) }).supabase, ['d1'])).rejects.toThrow(/nu avansează/)
  })

  it('r2 P1-2: descărcarea unui fișier arhivat nu depinde de gărzile pentru document nou', () => {
    expect(poateDescarcaExistent({ fisier_convocator_path: 'P/HUS/x/C-0002-v1.docx' })).toBe(true)
    expect(poateDescarcaExistent({ fisier_convocator_path: null })).toBe(false)
    expect(poateDeschideConvocator({ motiv: null, existente: null })).toBe(true)
    expect(poateDeschideConvocator({ motiv: 'proiect fără contact', existente: [{ fisier_convocator_path: 'p' }] })).toBe(true)
    expect(poateDeschideConvocator({ motiv: 'proiect fără contact', existente: [{ fisier_convocator_path: null }] })).toBe(false)
    expect(poateDeschideConvocator({ motiv: 'proiect fără contact', existente: [] })).toBe(false)
    expect(poateDeschideConvocator({ motiv: 'proiect fără contact', existente: null })).toBe(false)
  })

  it('r2 P2-5: citire cu generație — răspunsuri inversate: doar ultima cerere se aplică; după invalideaza nimic', async () => {
    const amanate = []
    const citeste = (cheie) => new Promise((res, rej) => amanate.push({ cheie, res, rej }))
    const aplicate = []
    const c = cititorCuGeneratie(citeste, (x) => aplicate.push(x))
    const p1 = c.porneste('d1')
    const p2 = c.porneste('d1')
    expect(aplicate).toEqual([{ cheie: 'd1', existente: null, eroare: null }, { cheie: 'd1', existente: null, eroare: null }])
    amanate[1].res([{ nr_document: 'C-0003' }])   // răspunsul nou sosește primul
    await p2
    amanate[0].res([])                              // răspunsul vechi („nimic”) sosește apoi — ignorat
    await p1
    expect(aplicate.at(-1)).toEqual({ cheie: 'd1', existente: [{ nr_document: 'C-0003' }], eroare: null })
    expect(aplicate).toHaveLength(3)
    // eroare veche după succes nou: ignorată
    const p3 = c.porneste('d2'); const p4 = c.porneste('d2')
    amanate[3].res([]); await p4
    amanate[2].rej(new Error('veche')); await p3
    expect(aplicate.at(-1)).toEqual({ cheie: 'd2', existente: [], eroare: null })
    // unmount: răspunsul întârziat nu mai e aplicat
    const n = aplicate.length
    const p5 = c.porneste('d3'); c.invalideaza()
    amanate[4].res([{ nr_document: 'C-0009' }]); await p5
    expect(aplicate).toHaveLength(n + 1)   // doar starea sincronă „se citește”
    expect(aplicate.at(-1).existente).toBeNull()
  })

  it('r3 P2-2: invalideaza → porneste → nimic citit, nimic aplicat (reconcilierea după închiderea modalului)', async () => {
    let citiri = 0
    const aplicate = []
    const c = cititorCuGeneratie(async () => { citiri++; return [{ nr_document: 'C-0001' }] }, (x) => aplicate.push(x))
    c.invalideaza()
    await c.porneste('d1')
    expect(citiri).toBe(0)
    expect(aplicate).toEqual([])
  })

  it('r3 P2-1: data documentului la regenerare = data civilă București (limita zilei), nu prefixul UTC; fără dată → eroare', async () => {
    expect(dataDocumentConvocare({ created_at: '2026-11-03T22:30:00Z' })).toBe('2026-11-04')
    expect(dataDocumentConvocare({ created_at: '2026-11-03T21:59:59+00:00' })).toBe('2026-11-03')
    expect(dataDocumentConvocare({ created_at: '2026-07-01T21:30:00.123456+00:00' })).toBe('2026-07-02')   // EEST (UTC+3)
    expect(formatDataRo(dataDocumentConvocare({ created_at: '2026-11-03T22:30:00Z' }))).toBe('04.11.2026')
    expect(() => dataDocumentConvocare({ nr_document: 'C-0002', created_at: null })).toThrow(/C-0002.*dată de generare validă/)
    expect(() => dataDocumentConvocare({ created_at: 'nu e dată' })).toThrow(/dată de generare validă/)
  })

  it('r4 P2-01 (b): convocările apărute după verificare (alt utilizator / altă fereastră)', () => {
    expect(aparuteDupaVerificare([], [])).toEqual([])
    expect(aparuteDupaVerificare([], [{ id: 'a', nr_document: 'C-0101' }]).map(c => c.nr_document)).toEqual(['C-0101'])
    expect(aparuteDupaVerificare([{ id: 'a' }], [{ id: 'a' }, { id: 'b', nr_document: 'C-0102' }]).map(c => c.id)).toEqual(['b'])
    expect(aparuteDupaVerificare([{ id: 'a' }, { id: 'b' }], [{ id: 'a' }])).toEqual([])   // una expediată între timp: nimic nou
    expect(aparuteDupaVerificare(null, [{ id: 'a' }])).toHaveLength(1)
  })

  it('#989 r4: rezervaNumarConvocare = RPC-ul atomic fn_red_convocare_rezerva (bifa → p_numar_nou_confirmat, canal), fără cale alternativă', async () => {
    const apeluri = []
    const sb = (rez) => ({ rpc: async (f, a) => { apeluri.push([f, a]); return rez } })
    expect(await rezervaNumarConvocare(sb({ data: [{ convocare_id: 'cv1', nr_document: 'C-0103', parcela_id: 'p1', uat_id: 'u1', proiect_id: 'pr1' }], error: null }), { calitateAsteptata: 'proprietar', detinatorId: 'd1', confirmat: true, canal: 'email' }))
      .toEqual({ convocareId: 'cv1', nrDocument: 'C-0103', parcelaId: 'p1', uatId: 'u1', proiectId: 'pr1' })
    expect(apeluri[0]).toEqual(['fn_red_convocare_rezerva', { p_detinator_id: 'd1', p_numar_nou_confirmat: true, p_canal: 'email', p_calitate_asteptata: 'proprietar' }])
    await rezervaNumarConvocare(sb({ data: [{ convocare_id: 'cv2', nr_document: 'C-0104', parcela_id: 'p1', uat_id: 'u1', proiect_id: 'pr1' }], error: null }), { calitateAsteptata: 'proprietar', detinatorId: 'd1', confirmat: 'da' })
    expect(apeluri[1][1]).toEqual({ p_detinator_id: 'd1', p_numar_nou_confirmat: false, p_canal: 'posta', p_calitate_asteptata: 'proprietar' })   // doar `true` explicit confirmă
    expect(apeluri.every(([f]) => f !== 'fn_red_numar_document')).toBe(true)
    await expect(rezervaNumarConvocare(sb({ data: null, error: { code: 'PGRST202', message: 'x' }, status: 404 }), { calitateAsteptata: 'proprietar', detinatorId: 'd1' }))
      .rejects.toMatchObject({ code: 'FARA_RPC', message: expect.stringMatching(/aplicați migrarea 20261131c/) })
    await expect(rezervaNumarConvocare(sb({ data: null, error: { code: 'RD001', message: 'are deja' } }), { calitateAsteptata: 'proprietar', detinatorId: 'd1' })).rejects.toMatchObject({ code: 'RD001' })
    await expect(rezervaNumarConvocare(sb({ data: [], error: null }), { calitateAsteptata: 'proprietar', detinatorId: 'd1' })).rejects.toThrow(/nu a întors/)
    await expect(rezervaNumarConvocare(sb({ data: [], error: null }), {})).rejects.toThrow(/deținătorul/)
  })

  it('#989 r5 P1-01: relația deținător → parcelă → proiect → UAT și identitatea întoarsă de server', () => {
    const det = { id: 'd1', parcela_id: 'p1', sters_la: null }, parcela = { id: 'p1', proiect_id: 'pr1', uat_id: 'u1', sters_la: null }
    const proiect = { id: 'pr1' }, uat = { id: 'u1' }
    expect(motivRelatieSchimbata({ detinator: det, parcela, proiect, uat })).toBeNull()
    expect(motivRelatieSchimbata({ detinator: { ...det, parcela_id: 'p2' }, parcela, proiect, uat })).toMatch(/nu mai e pe parcela afișată/)
    expect(motivRelatieSchimbata({ detinator: det, parcela: { ...parcela, uat_id: 'u2' }, proiect, uat })).toMatch(/UAT-ul afișat/)
    expect(motivRelatieSchimbata({ detinator: det, parcela: { ...parcela, proiect_id: 'x' }, proiect, uat })).toMatch(/proiectul afișat/)
    expect(motivRelatieSchimbata({ detinator: { ...det, sters_la: 't' }, parcela, proiect, uat })).toMatch(/deținătorul/)
    expect(motivRelatieSchimbata({ detinator: det, parcela: { ...parcela, sters_la: 't' }, proiect, uat })).toMatch(/parcela/)
    const rez = { nrDocument: 'C-0007', parcelaId: 'p1', uatId: 'u1', proiectId: 'pr1' }
    expect(motivIdentitateDiferita(rez, { parcelaId: 'p1', uatId: 'u1', proiectId: 'pr1' })).toBeNull()
    expect(motivIdentitateDiferita({ ...rez, parcelaId: 'p2' }, { parcelaId: 'p1', uatId: 'u1', proiectId: 'pr1' })).toMatch(/C-0007.*fișier neîncărcat/)
  })

  it('avertismentul descrie verificarea finală a serverului', () => {
    expect(AVERTISMENT_CONCURENTA).toMatch(/verificarea finală o face serverul la rezervare/)
  })

  it('textul confirmării numește numerele existente și consumul unui număr nou', () => {
    const t = textConfirmareNumarNou([{ nr_document: 'C-0002' }])
    expect(t).toMatch(/număr C-nnnn NOU/)
    expect(t).toMatch(/2 convocatoare active neexpediate/)
    expect(t).toMatch(/există deja: C-0002/)
  })
})


describe('PR3a r3 — calitatea asteptata nu se reciteste in client', () => {
  it('transmite exact instantaneul si propaga RD008; lipsa asteptarii nu apeleaza serverul', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: 'RD008', message: 'calitatea s-a schimbat - regenereaza' } }))
    await expect(rezervaNumarConvocare({ rpc }, { detinatorId: 'd-fictiv', calitateAsteptata: 'coproprietar' })).rejects.toMatchObject({ code: 'RD008' })
    expect(rpc).toHaveBeenCalledWith('fn_red_convocare_rezerva', { p_detinator_id: 'd-fictiv', p_numar_nou_confirmat: false, p_canal: 'posta', p_calitate_asteptata: 'coproprietar' })
    rpc.mockClear()
    await expect(rezervaNumarConvocare({ rpc }, { detinatorId: 'd-fictiv' })).rejects.toThrow('Lipsește calitatea așteptată')
    expect(rpc).not.toHaveBeenCalled()
  })
})
