import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { BIFA_DA, BIFA_NU, CHEI_PV_A, propuneLucrari, verificaDatePvA, genereazaPvA, calePv, salveazaPv } from './pv.js'
const sablon = () => readFileSync('public/redari/sabloane/pv_a.docx')
const date = () => ({
  proiect: { contract_nr:'CTR & <1>', contract_data:'2026-11-02', denumire:'Test', reprezentant_gazpet_nume:'FICTIV G', reprezentant_tgz_nume:'FICTIV T' },
  uat: { nume:'UAT TEST' }, parcela: { tronson:3, categoria_folosinta:'Arabil', verificare_de_gazpet:'G', verificare_de_tgz:'T' },
  detinator: { nume:'FICTIV ION', calitate:'coproprietar', cota:'1/2' },
  pv: { nr_pv:'PVA-ZZZ-0001', data_pv:'2026-11-02', locul:'Test', constatare_mod:'teren',
    lucrari:{nivelare:true,altele:'Test'}, stare_teren:{nivelat:true}, plan_situatie:false, foto_nr:0,
    obiectii_redare:true, obiectii_text:'Prima & <linie>\nA doua linie' },
})
describe('PV A', () => {
  it('cheile corespund exact sablonului real, inclusiv antete', async () => {
    const z=await JSZip.loadAsync(sablon()), chei=new Set()
    for(const f of Object.values(z.files).filter(f=>/^word\/.*\.xml$/.test(f.name))) {
      const xml=await f.async('string')
      for(const m of xml.matchAll(/\{\{([^}]+)\}\}/g)) chei.add(m[1])
    }
    expect([...chei].sort()).toEqual([...CHEI_PV_A].sort())
    expect(chei.size).toBe(54)
  })
  it.each([
    ['Decopertare pamant fertil','sol_fertil'],['Nivelare teren','nivelare'],
    ['Arat teren','arat'],['Discuit','discuit'],['Insamantare iarba','insamantare'],
    ['Sem\u0103nat gazon','insamantare'],['Refacere gard','gard'],['Refacere drum','drum'],
  ])('propune din %s', (text,k) => { expect(propuneLucrari(text)[k]).toBe(true) })
  it('text lipsa nu confirma nicio lucrare',()=>{
    expect(Object.values(propuneLucrari(null)).filter(v=>v===true)).toEqual([])
    expect(propuneLucrari('FERTIL').sol_fertil).toBe(true)
  })
  it.each([
    ['proiect','contract_nr','numarul contractului'],['proiect','contract_data','data contractului'],
    ['uat','nume','UAT'],['parcela','tronson','tronson'],['detinator','nume','numele detinatorului'],
    ['pv','data_pv','data PV'],['pv','locul','locul'],['pv','constatare_mod','modul constatarii'],
    ['pv','stare_teren','starea terenului'],['pv','obiectii_text','textul obiectiilor'],
  ])('refuza lipsa %s.%s', (grup,k,mesaj)=>{
    for(const gol of [null,'','  ']) { const d=date(); d[grup][k]=gol; expect(verificaDatePvA(d)).toContain(mesaj) }
  })
  it('alta text e suficienta; false si text gol nu sunt bife',()=>{
    const d=date(); d.pv.stare_teren={alta:'Refacut'}; expect(verificaDatePvA(d)).toEqual([])
    d.pv.stare_teren={nivelat:false,alta:' '}; expect(verificaDatePvA(d)).toContain('starea terenului')
    d.pv.stare_teren={nivelat:'true'}; expect(verificaDatePvA(d)).toContain('starea terenului')
  })
  it('genereaza real: chei consumate, XML escapate, bife si obiectii multiline',async()=>{
    const r=await genereazaPvA({...date(),templateArrayBuffer:sablon()})
    const z=await JSZip.loadAsync(await r.blob.arrayBuffer()), xml=await z.file('word/document.xml').async('string')
    expect(xml).not.toContain('{{')
    expect(xml).toContain('CTR &amp; &lt;1&gt;')
    expect(xml).toContain('Prima &amp; &lt;linie&gt;')
    expect(xml).toMatch(/<w:br\s*\/>/)
    expect(xml).toContain('A doua linie')
    expect(r.campuri.bifa_nivelare).toBe('\u2612')
    expect(r.campuri.bifa_arat).toBe('\u2610')
    expect(r.campuri.bifa_plan_nu).toBe(BIFA_DA)
    expect(r.campuri.bifa_foto_da).toBe(BIFA_NU)
    expect(r.campuri.calitate_cota).toBe('coproprietar, cota 1/2')
    expect(r.campuri.act_identitate).toBe('')
    expect(r.campuri.act_doveditor).toBe('')
    expect(r.campuri.verificare_de).toBe('G (TGZ: T)')
    expect(r.hash).toMatch(/^[a-f0-9]{64}$/)
  })
  it('generatorul strict refuza date incomplete',async()=>{
    const d=date();d.pv.locul=null
    await expect(genereazaPvA({...d,templateArrayBuffer:sablon()})).rejects.toThrow('locul')
  })
})
const cheie={proiectCod:'TEST',uat3:'ZZZ',nrPv:'PVA-ZZZ-0001'}
describe('storage PV imutabil',()=>{
  it('cale valida si segmente/versiuni invalide',()=>{
    expect(calePv({...cheie,versiune:2})).toBe('TEST/ZZZ/pv/PVA-ZZZ-0001_v2.docx')
    for(const k of ['proiectCod','uat3','nrPv']) for(const v of ['','../x','x/y']) expect(()=>calePv({...cheie,[k]:v})).toThrow()
    for(const v of [0,-1,1.5,'2']) expect(()=>calePv({...cheie,versiune:v})).toThrow()
  })
  const client=(erori=[])=>{
    const upload=vi.fn(async()=>({error:erori.shift()??null}))
    const list=vi.fn().mockResolvedValueOnce({data:[{name:'PVA-ZZZ-0001_v3.docx'}],error:null}).mockResolvedValue({data:[],error:null})
    return {s:{storage:{from:()=>({list,upload})}},upload,list}
  }
  it('coliziune -> versiunea urmatoare; fara upsert',async()=>{
    const {s,upload,list}=client([{statusCode:'409'}])
    const r=await salveazaPv(s,{...cheie,blob:new Blob(['x'])})
    expect(r).toEqual({path:'TEST/ZZZ/pv/PVA-ZZZ-0001_v5.docx',versiune:5})
    expect(upload.mock.calls[0][2].upsert).toBe(false)
    expect(list).toHaveBeenCalledTimes(2)
    // Copilot f4b r1 P2-01: listarea se face în ACELAȘI folder în care se încarcă (TEST/ZZZ/pv), nu în cel al adreselor
    expect(list.mock.calls[0][0]).toBe('TEST/ZZZ/pv')
    expect(upload.mock.calls[0][0].startsWith('TEST/ZZZ/pv/')).toBe(true)
  })
  it('eroare ambigua nu reincearca automat',async()=>{
    const {s,upload}=client([{statusCode:500,message:'indisponibil'}])
    await expect(salveazaPv(s,{...cheie,blob:new Blob(['x'])})).rejects.toThrow('verifica starea')
    expect(upload).toHaveBeenCalledTimes(1)
  })
  it('listare esuata si operatie expirata nu incarca',async()=>{
    const {s,upload}=client()
    await expect(salveazaPv(s,{...cheie,esteCurent:()=>false})).rejects.toThrow()
    expect(upload).not.toHaveBeenCalled()
  })
})
