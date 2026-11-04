import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { BIFA_DA, BIFA_NU, valoriImplicitePv, salveazaImpliciteLaCreare, loculImplicit, propuneStareTeren, verificaDatePvA, verificaDatePvB, genereazaPvA } from './pv.js'

// L3 / D5 (04.11.2026): valorile implicite la creare; fixture fictiv, fără date reale
const uat = () => ({ nume:'UAT TEST', primarie_adresa:'Str. Principală nr. 1', sesiune_zi1:'2026-11-20', sesiune_zi2:'2026-11-21', sesiune_zi3:null })
const parcela = () => ({ sat:'Satu Test', articol_deviz:'Nivelare teren si insamantare', categoria_folosinta:'Arabil', tronson:3,
  verificare_data:'2026-11-10', verificare_de_gazpet:'FICTIV G', verificare_de_tgz:'FICTIV T' })
// rândul cum îl lasă fn_red_pv_creeaza: numărul, data de azi, starea și obiectii_redare=false (default BD)
const pvNou = () => ({ id:'pv1', tip:'A', nr_pv:'PVA-ZZZ-0001', data_pv:'2026-11-04', stare:'generat', obiectii_redare:false,
  locul:null, constatare_mod:null, lucrari:null, stare_teren:null, obiectii_text:null })

describe('valoriImplicitePv', () => {
  it('fără răspuns: locul = sediul Primăriei, modul = sediu, lucrări și stare din deviz; data rămâne cea din RPC', () => {
    const p = valoriImplicitePv({ tip:'A', pv:pvNou(), uat:uat(), parcela:parcela(), laCreare:true })
    expect(p.locul).toBe('Sediul Primăriei UAT TEST, Str. Principală nr. 1')
    expect(p.constatare_mod).toBe('sediu')
    expect(p.lucrari).toMatchObject({ nivelare:true, insamantare:true, arat:false })
    expect(p.stare_teren).toEqual({ nivelat:true, insamantat:true })
    expect(p).not.toHaveProperty('data_pv')
    expect(p).not.toHaveProperty('obiectii_redare')
  })
  it('locul fără adresa primăriei; pe teren; UAT fără nume -> fără loc (garda îl cere)', () => {
    expect(loculImplicit({ uat:{ nume:'X' } })).toBe('Sediul Primăriei X')
    expect(loculImplicit({ uat:{ nume:'X' }, parcela:{ sat:'S' }, mod:'teren' })).toBe('Pe teren, sat S, UAT X')
    expect(valoriImplicitePv({ tip:'A', pv:pvNou(), uat:{}, parcela:{} })).not.toHaveProperty('locul')
  })
  it('stare: fără potrivire în deviz -> goală, garda cere bifa; gard și drum -> gard / drum refăcut', () => {
    expect(propuneStareTeren(null)).toBeNull()
    expect(propuneStareTeren({ arat:true })).toBeNull()
    expect(propuneStareTeren({ gard:true, drum:true })).toEqual({ gard_drum:true })
    const pv = pvNou()
    const p = valoriImplicitePv({ tip:'A', pv, uat:uat(), parcela:{ ...parcela(), articol_deviz:'Lucrari diverse' }, laCreare:true })
    expect(p).not.toHaveProperty('stare_teren')
    Object.assign(pv, p)
    expect(verificaDatePvA({ proiect:{ contract_nr:'1', contract_data:'2026-01-01' }, uat:uat(), parcela:parcela(), detinator:{ nume:'FICTIV' }, pv }))
      .toEqual(['starea terenului'])
  })
  it('participă la o zi a UAT-ului -> data PV = ziua aleasă (la creare); zi străină de UAT -> ignorată', () => {
    const r = { optiune:'particip', zi_sesiune_aleasa:'2026-11-21' }
    expect(valoriImplicitePv({ tip:'A', pv:pvNou(), uat:uat(), parcela:parcela(), raspuns:r, laCreare:true }).data_pv).toBe('2026-11-21')
    // PV existent cu dată: fără laCreare nu se rescrie data
    expect(valoriImplicitePv({ tip:'A', pv:pvNou(), uat:uat(), parcela:parcela(), raspuns:r })).not.toHaveProperty('data_pv')
    expect(valoriImplicitePv({ tip:'A', pv:pvNou(), uat:uat(), parcela:parcela(), raspuns:{ ...r, zi_sesiune_aleasa:'2026-12-01' }, laCreare:true })).not.toHaveProperty('data_pv')
  })
  it('constatare pe teren cerută -> modul teren și locul pe teren', () => {
    const p = valoriImplicitePv({ tip:'A', pv:pvNou(), uat:uat(), parcela:parcela(), raspuns:{ optiune:'constatare_teren' } })
    expect(p.constatare_mod).toBe('teren')
    expect(p.locul).toBe('Pe teren, sat Satu Test, UAT UAT TEST')
  })
  it('obiecții din răspuns -> bifa „cu obiecții” + textul; fără text nu se bifează', () => {
    // Jakarinos #990 P2-3: textul se copiază exact (cu spațiile / liniile de la capete), plin() doar validează
    const text = '\n  Gard nerefăcut \n'
    const p = valoriImplicitePv({ tip:'A', pv:pvNou(), uat:uat(), parcela:parcela(), raspuns:{ optiune:'nu_particip_cu_obiectii', obiectii_text:text } })
    expect(p).toMatchObject({ obiectii_redare:true, obiectii_text:text })
    expect(valoriImplicitePv({ tip:'A', pv:pvNou(), uat:uat(), parcela:parcela(), raspuns:{ optiune:'nu_particip_cu_obiectii', obiectii_text:' ' } })).not.toHaveProperty('obiectii_redare')
    expect(valoriImplicitePv({ tip:'A', pv:pvNou(), uat:uat(), parcela:parcela(), raspuns:{ optiune:'nu_particip_fara_obiectii' } })).not.toHaveProperty('obiectii_redare')
  })
  it('constatare pe teren cu obiecții („Gard rupt”) -> mod teren + bifa cu obiecții + textul (Jakarinos #990 P1-1)', () => {
    const p = valoriImplicitePv({ tip:'A', pv:pvNou(), uat:uat(), parcela:parcela(), raspuns:{ optiune:'constatare_teren', obiectii_text:'Gard rupt' }, laCreare:true })
    expect(p).toMatchObject({ constatare_mod:'teren', obiectii_redare:true, obiectii_text:'Gard rupt' })
  })
  it('nu suprascrie câmpurile completate; PV final și PV C neatinse; PV B fără mod / răspuns', () => {
    const plin = { ...pvNou(), locul:'Ales', constatare_mod:'teren', lucrari:{ arat:true }, stare_teren:{ alta:'X' }, obiectii_redare:true, obiectii_text:'Ob' }
    expect(valoriImplicitePv({ tip:'A', pv:plin, uat:uat(), parcela:parcela(), raspuns:{ optiune:'nu_particip_cu_obiectii', obiectii_text:'alt' }, laCreare:true })).toEqual({})
    expect(valoriImplicitePv({ tip:'A', pv:{ ...pvNou(), stare:'semnat' }, uat:uat(), parcela:parcela() })).toEqual({})
    expect(valoriImplicitePv({ tip:'C', pv:{ ...pvNou(), tip:'C' }, uat:uat(), parcela:parcela() })).toEqual({})
    const b = valoriImplicitePv({ tip:'B', pv:{ ...pvNou(), tip:'B' }, uat:uat(), parcela:parcela(), raspuns:{ optiune:'constatare_teren' } })
    expect(b).not.toHaveProperty('constatare_mod')
    expect(b.locul).toBe('Sediul Primăriei UAT TEST, Str. Principală nr. 1')
  })
  it('PV B: implicitele acoperă locul și starea; motivul și reprezentantul UAT rămân la operator', () => {
    const pv = { ...pvNou(), tip:'B' }
    Object.assign(pv, valoriImplicitePv({ tip:'B', pv, uat:uat(), parcela:parcela(), laCreare:true }))
    const l = verificaDatePvB({ proiect:{ contract_nr:'1', contract_data:'2026-01-01' }, uat:uat(), parcela:parcela(), pv })
    expect(l).not.toContain('locul')
    expect(l).not.toContain('starea terenului')
    expect(l).toEqual(expect.arrayContaining(['motivul PV B', 'reprezentantul UAT']))
  })
})

describe('PV A generat din valorile implicite, fără tastare (fixture complet)', () => {
  it('garda trece și DOCX-ul se completează integral', async () => {
    const pv = pvNou()
    Object.assign(pv, valoriImplicitePv({ tip:'A', pv, uat:uat(), parcela:parcela(), raspuns:{ optiune:'particip', zi_sesiune_aleasa:'2026-11-20' }, laCreare:true }))
    const date = { proiect:{ contract_nr:'CTR-1', contract_data:'2026-11-02', denumire:'Proiect test', reprezentant_gazpet_nume:'FICTIV G', reprezentant_tgz_nume:'FICTIV T' },
      uat:uat(), parcela:parcela(), detinator:{ nume:'FICTIV ION', calitate:'proprietar' }, pv }
    expect(verificaDatePvA(date)).toEqual([])
    const r = await genereazaPvA({ ...date, templateArrayBuffer:readFileSync('public/redari/sabloane/pv_a.docx') })
    const xml = await (await JSZip.loadAsync(await r.blob.arrayBuffer())).file('word/document.xml').async('string')
    expect(xml).not.toContain('{{')
    expect(xml).toContain('Sediul Primăriei UAT TEST')
    expect(r.campuri.data_pv).toMatch(/20\.11\.2026/)
    expect(r.campuri.bifa_constatare_sediu).toBe(BIFA_DA)
    expect(r.campuri.bifa_constatare_teren).toBe(BIFA_NU)
    expect(r.campuri.bifa_st_nivelat).toBe(BIFA_DA)
    expect(r.campuri.bifa_nivelare).toBe(BIFA_DA)
    expect(r.campuri.bifa_fara_obiectii).toBe(BIFA_DA)
  })
})

// Jakarinos #990 P1-2: sursele implicitelor se verifică între citire și salvare
describe('salveazaImpliciteLaCreare — prospețimea surselor', () => {
  const sursa = (u = uat(), raspuns = { id:'r1', seq:1, optiune:'particip', zi_sesiune_aleasa:'2026-11-20' }) =>
    ({ pv:pvNou(), uat:{ id:'u1', versiune:1, ...u }, parcela:{ id:'p1', ...parcela() }, raspuns })
  const scrieMock = () => { const apeluri = []; return { apeluri, scrie: async (pv, patch) => { apeluri.push(patch); return { ...pv, ...patch } } } }

  it('surse neschimbate -> salvează fără confirmare', async () => {
    const s = sursa(), { apeluri, scrie } = scrieMock(), confirma = async () => { throw new Error('nu trebuia') }
    const r = await salveazaImpliciteLaCreare({ tip:'A', sursa:s, recitesteSurse: async () => s, scrie, confirma })
    expect(r.stare).toBe('salvat')
    expect(r.schimbatDupa).toBe(false)
    expect(apeluri[0].data_pv).toBe('2026-11-20')
  })
  it('ziua de sesiune mutată între citire și salvare -> recalculează și cere confirmare; refuzul nu scrie nimic', async () => {
    const s = sursa()
    // UAT-ul mută ziua 1 pe 22.11; ziua aleasă (20.11) nu mai e zi a UAT-ului -> data nu se mai propune
    const nou = sursa({ ...uat(), sesiune_zi1:'2026-11-22' }); nou.uat.versiune = 2
    const { apeluri, scrie } = scrieMock(), cerute = []
    const r = await salveazaImpliciteLaCreare({ tip:'A', sursa:s, recitesteSurse: async () => nou, scrie, confirma: async p => { cerute.push(p); return false } })
    expect(r.stare).toBe('renuntat')
    expect(apeluri).toEqual([])
    expect(cerute[0]).not.toHaveProperty('data_pv')
  })
  it('răspuns nou între citire și salvare -> la confirmare se scriu valorile recalculate, nu cele vechi', async () => {
    const s = sursa()
    const nou = sursa(uat(), { id:'r2', seq:2, optiune:'constatare_teren', obiectii_text:'Gard rupt' })
    const { apeluri, scrie } = scrieMock()
    const r = await salveazaImpliciteLaCreare({ tip:'A', sursa:s, recitesteSurse: async () => nou, scrie, confirma: async () => true })
    expect(r.stare).toBe('salvat')
    expect(apeluri[0]).toMatchObject({ constatare_mod:'teren', obiectii_redare:true, obiectii_text:'Gard rupt' })
    expect(apeluri[0]).not.toHaveProperty('data_pv')
  })
  it('schimbare apărută după UPDATE -> raportată (schimbatDupa), nu ascunsă', async () => {
    const s = sursa(), dupa = sursa(); dupa.uat.versiune = 3
    let n = 0
    const r = await salveazaImpliciteLaCreare({ tip:'A', sursa:s, recitesteSurse: async () => (n++ === 0 ? s : dupa), scrie: scrieMock().scrie, confirma: async () => true })
    expect(r).toMatchObject({ stare:'salvat', schimbatDupa:true })
  })
  it('PV schimbat la recitire -> eroare, fără scriere', async () => {
    const s = sursa(), alt = { ...sursa(), pv:{ ...pvNou(), id:'pv2' } }, { apeluri, scrie } = scrieMock()
    await expect(salveazaImpliciteLaCreare({ tip:'A', sursa:s, recitesteSurse: async () => alt, scrie, confirma: async () => true })).rejects.toThrow('PV schimbat')
    expect(apeluri).toEqual([])
  })
})
