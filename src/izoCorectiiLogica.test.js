import { describe, it, expect } from 'vitest'
import { responsabil, propune, actiuni, campuri, DIRECT, IDENT, valori, delta, argumenteVerifica, serieCautare, cereStareIesire, diferenteDocument, mesajCorectie, rezumatDiff, pagini } from './izoCorectiiLogica.js'

const atr = { proiect_id:3, depozit_id:null, rol:'manager_aprobator', activ:true }
const manager = { id:'m', owner:false, nivelMagazie:'editor', atribuiri:[atr] }
describe('E3b: drepturi și patru ochi', () => {
  it('owner-ul nu își aprobă sau respinge propria propunere', () => {
    expect(actiuni({ ...manager, owner:true }, 3, { stare:'propusa', propus_de:'m' })).toEqual({ decide:false, retrage:true })
    expect(actiuni(manager, 3, { stare:'propusa', propus_de:'g' }).decide).toBe(true)
    expect(actiuni(manager, 3, { stare:'aplicata', propus_de:'g' }).decide).toBe(false)
  })
  it('cere modul editor/admin și atribuire valabilă pe proiect, fără depozit', () => {
    expect(responsabil(manager, 3)).toBe(true)
    for (const m of [{ ...manager, nivelMagazie:'viewer' }, { ...manager, atribuiri:[{ ...atr, depozit_id:4 }] }, { ...manager, atribuiri:[{ ...atr, activ:false }] }, { ...manager, atribuiri:[{ ...atr, valabil_pana:'2000-01-01' }] }, { ...manager, atribuiri:[{ ...atr, valabil_de:'2999-01-01' }] }]) expect(responsabil(m, 3)).toBe(false)
    expect(responsabil(manager, 9)).toBe(false)
    expect(responsabil({ ...manager, atribuiri:[{ ...atr, rol:'inlocuitor_aprobator' }] }, 3)).toBe(true)
  })
  it('gestionarul propune numai pentru depozitul atribuit', () => {
    const g = { ...manager, atribuiri:[{ ...atr, rol:'gestionar', depozit_id:7 }] }
    expect(propune(g, 3, 7)).toBe(true)
    expect(propune(g, 3, 8)).toBe(false)
    expect(responsabil(g, 3)).toBe(false)
    expect(actiuni(g, 3, { stare:'propusa', propus_de:'altul' }).retrage).toBe(false)
  })
})
describe('E3b: cereri și diferențe', () => {
  it('separă identitatea de câmpurile directe și geometria pe tip', () => {
    expect(DIRECT.filter(k => IDENT.includes(k))).toEqual([])
    expect(campuri('teava')).not.toContain('unghi_curba')
    expect(campuri('curba')).not.toContain('lungime_aviz_mm')
    expect(campuri('curba')).toContain('unghi_curba')
    expect(campuri('teava', true)).toEqual(DIRECT)
  })
  it('trimite numai câmpuri schimbate, fără derivate sau chei străine', () => {
    expect(delta({ serie:' A ', perete_mm:'7,25', lot:'', stare:'pierduta', lungime_mm:8 }, { serie:'A', perete_mm:7.25, lot:'L' }, ['serie', 'perete_mm', 'lot'])).toEqual({ lot:null })
    expect(() => valori({ perete_mm:'abc' }, ['perete_mm'])).toThrow()
  })
  it('verifică găsit nou cu proiect explicit și bucată null', () => {
    expect(argumenteVerifica('gasit_nou', 3, null, { serie:'S' })).toEqual({ p_corectie_id:null, p_tip:'gasit_nou', p_proiect:3, p_bucata_id:null, p_detalii:{ serie:'S' } })
    expect(serieCautare(' a / b._- 12 ')).toBe('AB12')
  })
  it('cere țintă explicită doar la nașterea în carantină fără document', () => {
    const nascut = { id:1, rol:'nascut', stare_dupa:'carantina' }
    expect(cereStareIesire({ miscari:[nascut] })).toBe(true)
    expect(cereStareIesire({ aviz_intrare_id:1, miscari:[nascut] })).toBe(false)
    expect(cereStareIesire({ miscari:[nascut, { id:2, rol:'stare', stare_inainte:'receptionat', stare_dupa:'carantina' }, { id:3, rol:'stare', stare_inainte:'pierduta', stare_dupa:'carantina' }] })).toBe(false)
  })
  it('compară lungimile și unghiul cu numele câmpurilor E3', () => {
    expect(diferenteDocument({ tip_cod:'teava', lungime_aviz_mm:6000, perete_mm:7.25 }, { lungime_doc_mm:6000, perete_mm:'7.25' })).toEqual([])
    expect(diferenteDocument({ tip_cod:'curba', unghi_curba:45 }, { unghi_doc:90, unghi_masurat:45 })).toEqual([])
    expect(diferenteDocument({ tip_cod:'teava', serie:'nou' }, { serie:'vechi' })).toContain('serie')
  })
  it('explică 40001 și rezumă toate secțiunile diff-ului', () => {
    expect(mesajCorectie({ code:'40001', message:'conflict' })).toContain('reîncarcă')
    expect(rezumatDiff({ aviz:{ lot:['1', '2'] }, randuri:{ adaugate:[{}], modificate:{ 1:{ serie:['a','b'] } } } }, false)).toContain('+1 / −0 rânduri; 2 câmpuri')
  })
  it('citește până la pagina goală, inclusiv când serverul reduce limita', async () => {
    const date = [{ id:1 }, { id:2 }, { id:3 }]
    const cerere = () => { let ultim = 0; const q = { gt(k, v) { ultim = v; return q }, order() { return q }, limit() { return Promise.resolve({ data:date.filter(r => r.id > ultim).slice(0, 1) }) } }; return q }
    expect(await pagini(cerere)).toEqual(date)
  })
})
