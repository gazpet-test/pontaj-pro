import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { BIFA_DA, BIFA_NU, CHEI_PV_A, propuneLucrari, verificaDatePvA, genereazaPvA, calePv, salveazaPv } from './pv.js'
import { CHEI_PV_B, verificaDatePvB, genereazaPvB, extensieScan, verificaContinutScan, referintaPvA, detinatoriFaraPvA } from './pv.js'
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
    expect(chei.size).toBe(51)
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
    ['uat','nume','UAT'],['detinator','nume','numele detinatorului'],
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
    // Final_v2: fara fotografii in PV A (camp scos din sablon si din generator)
    expect(r.campuri).not.toHaveProperty('bifa_foto_da')
    expect(r.campuri).not.toHaveProperty('foto_nr')
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

const dateB = () => {
  const d=date()
  d.uat.reprezentant_uat_nume='FICTIV U'
  d.parcela.verificare_data='2026-11-01'
  d.pv.motiv_pv_b='refuz'
  d.detinatori=[{id:'d1',nume:'FICTIV UNU'},{id:'d2',nume:'FICTIV DOI',adresa_cunoscuta:false},{id:'d3',nume:'STERS',sters_la:'2026-01-01'}]
  return d
}
const sablonB=()=>readFileSync('public/redari/sabloane/pv_b.docx')
it('PV B: conv_retur prezent și mențiunea AR doar scurtă (fără textul liber, către TGZ) — regresie Copilot/Jakarinos f10 r2',async()=>{
  const b=dateB()
  b.convocari=[{id:'c1',detinator_id:'d1',canal:'posta',stare:'activ',sters_la:null,created_at:'2026-11-01',data_expediere:'2026-11-02',data_confirmare_primire:'2026-11-05',retur:'decedat',ar_alta_persoana:'FICTIV text liber'}]
  const {campuri}=await genereazaPvB({...b,templateArrayBuffer:sablonB()})
  expect(campuri.conv_retur).toBe('decedat')
  expect(campuri.conv_data_confirmare).toBe('05.11.2026 (primit de altă persoană)')
  expect(JSON.stringify(campuri)).not.toContain('FICTIV text liber')
})
it('PV B (juridic#026): calitatea primitorului da, textul liber de pe AR nu',async()=>{
  const b=dateB()
  b.convocari=[{id:'c1',detinator_id:'d1',canal:'posta',stare:'activ',sters_la:null,created_at:'2026-11-01',data_expediere:'2026-11-02',data_confirmare_primire:'2026-11-05',
    ar_alta_persoana:'FICTIV text liber',ar_alta_calitate:'membru_familie'}]
  const {campuri}=await genereazaPvB({...b,templateArrayBuffer:sablonB()})
  expect(campuri.conv_data_confirmare).toBe('05.11.2026 (primit de altă persoană: membru de familie)')
  expect(JSON.stringify(campuri)).not.toContain('FICTIV text liber')
  // cod necunoscut: fara calitate, tot fara textul liber
  b.convocari[0].ar_alta_calitate='FICTIV NUME'
  const {campuri:c2}=await genereazaPvB({...b,templateArrayBuffer:sablonB()})
  expect(c2.conv_data_confirmare).toBe('05.11.2026 (primit de altă persoană)')
  expect(JSON.stringify(c2)).not.toMatch(/FICTIV NUME|FICTIV text liber/)
})
it('PV A si B accepta parcela fara tronson si lasa campul DOCX gol',async()=>{
  const a=date(), b=dateB()
  a.parcela.tronson=null;b.parcela.tronson=null
  expect(verificaDatePvA(a)).toEqual([])
  expect(verificaDatePvB(b)).toEqual([])
  expect((await genereazaPvA({...a,templateArrayBuffer:sablon()})).campuri.tronson).toBe('')
  expect((await genereazaPvB({...b,templateArrayBuffer:sablonB()})).campuri.tronson).toBe('')
})
it('PV A/B: tronsonul din document e cel de pe randul PV, nu cel curent al parcelei (Copilot f8a r3)',async()=>{
  const a=date(), b=dateB()
  a.parcela.tronson=5;b.parcela.tronson=5;a.pv={...a.pv,tronson:null};b.pv={...b.pv,tronson:null}
  expect((await genereazaPvA({...a,templateArrayBuffer:sablon()})).campuri.tronson).toBe('')
  expect((await genereazaPvB({...b,templateArrayBuffer:sablonB()})).campuri.tronson).toBe('')
  a.pv.tronson=4
  expect((await genereazaPvA({...a,templateArrayBuffer:sablon()})).campuri.tronson).toBe(4)
})
describe('PV B',()=>{
  it('72 chei din sablonul independent, inclusiv antete',async()=>{
    const z=await JSZip.loadAsync(sablonB()), chei=new Set()
    for(const f of Object.values(z.files).filter(f=>/^word\/.*\.xml$/.test(f.name)))
      for(const m of (await f.async('string')).matchAll(/\{\{([^}]+)\}\}/g)) chei.add(m[1])
    expect([...CHEI_PV_B].sort()).toEqual([...chei].sort());expect(chei.size).toBe(72)
  })
  it.each([
    ['proiect','contract_nr','numarul contractului'],['proiect','contract_data','data contractului'],
    ['uat','nume','UAT'],['pv','data_pv','data PV'],['pv','locul','locul'],
    ['pv','motiv_pv_b','motivul PV B'],['parcela','verificare_data','data verificarii pe teren'],
    ['uat','reprezentant_uat_nume','reprezentantul UAT'],['pv','stare_teren','starea terenului'],
  ])('refuza lipsa %s.%s',(grup,k,mesaj)=>{
    for(const gol of [null,'',' ']) {const d=dateB();d[grup][k]=gol;expect(verificaDatePvB(d)).toContain(mesaj)}
  })
  it('cere macar un verificator, admite TGZ singur si stare alta',()=>{
    const d=dateB();d.parcela.verificare_de_gazpet=' ';d.parcela.verificare_de_tgz=null
    expect(verificaDatePvB(d)).toContain('comisia de verificare')
    d.parcela.verificare_de_tgz='T';d.pv.stare_teren={alta:'Refacut'}
    expect(verificaDatePvB(d)).toEqual([])
    d.pv.motiv_pv_b='necunoscut';expect(verificaDatePvB(d)).toContain('motivul PV B')
  })
  it.each(['declaratie','neprezentat','neidentificat','refuz'])('genereaza real situatia %s',async motiv=>{
    const d=dateB();d.pv.motiv_pv_b=motiv
    const r=await genereazaPvB({...d,templateArrayBuffer:sablonB()})
    const z=await JSZip.loadAsync(await r.blob.arrayBuffer())
    for(const f of Object.values(z.files).filter(f=>/^word\/.*\.xml$/.test(f.name))) expect(await f.async('string')).not.toContain('{{')
    expect(r.campuri.nume).toBe('FICTIV UNU; FICTIV DOI')
    expect(r.campuri.bifa_fara_adresa).toBe(BIFA_DA)
    expect(r.campuri.bifa_reluare_nu_e_cazul).toBe(BIFA_DA)
    for(const k of ['declaratie','neprezentat','neidentificat','refuz']) expect(r.campuri['bifa_sit_'+k]).toBe(k===motiv?BIFA_DA:BIFA_NU)
    expect(r.campuri.semnatar_uat).toBe('FICTIV U');expect(r.hash).toMatch(/^[a-f0-9]{64}$/)
  })
  it('neidentificat si convocari: ultima activa, reluare separata, raspuns cu seq',async()=>{
    const d=dateB();d.detinatori=[{id:'d1',calitate:'neidentificat'}]
    d.convocari=[
      {id:'1',detinator_id:'d1',stare:'activ',canal:'posta',created_at:'2026-10-01',nr_tracking:'VECHI'},
      {id:'2',detinator_id:'d1',stare:'activ',canal:'posta',created_at:'2026-10-02',nr_tracking:'CORECT',data_expediere:'2026-10-02',retur:'refuz'},
      {id:'3',detinator_id:'d1',stare:'anulat',canal:'posta',created_at:'2026-10-05',nr_tracking:'ANULAT'},
      {id:'4',detinator_id:'d1',stare:'activ',canal:'posta',reluare:true,created_at:'2026-10-06',data_expediere:'2026-10-06',adresa_tgz_nr:'TGZ-2',nr_tracking:'REL'},
    ]
    d.raspunsuri=[{detinator_id:'d1',data:'2026-10-07',seq:1,optiune:'particip'},
      {detinator_id:'d1',data:'2026-10-07',seq:2,optiune:'nu_particip_fara_obiectii',canal:'scris'}]
    const {campuri:c}=await genereazaPvB({...d,templateArrayBuffer:sablonB()})
    expect(c.nume).toBe('neidentificat');expect(c.bifa_neidentificat).toBe(BIFA_DA)
    expect(c.conv_nr_tracking).toBe('CORECT');expect(c.bifa_conv_returnata).toBe(BIFA_DA)
    expect(c.reluare_adresa_tgz_nr).toBe('TGZ-2');expect(c.reluare_nr_tracking).toBe('REL')
    expect(c.bifa_reluare_raspuns).toBe(BIFA_DA);expect(c.bifa_raspuns_fara_obiectii).toBe(BIFA_DA)
    d.detinatori=[];expect((await genereazaPvB({...d,templateArrayBuffer:sablonB()})).campuri.nume).toBe('neidentificat')
  })
  it('scan: formate, limita si cale separate',()=>{
    expect(extensieScan(new Blob(['x'],{type:'image/jpeg'}))).toBe('jpg')
    expect(()=>extensieScan({type:'application/pdf',size:25*1024*1024+1})).toThrow('25 MB')
    expect(()=>extensieScan(new Blob(['x'],{type:'text/plain'}))).toThrow()
    expect(calePv({...cheie,extensieSemnat:'pdf',versiune:2})).toBe('TEST/ZZZ/pv/PVA-ZZZ-0001_semnat_v2.pdf')
  })
  it('scan: continutul trebuie sa corespunda tipului (Copilot f4c r1 P3-01)',async()=>{
    await expect(verificaContinutScan(new Blob(['%PDF-1.7 x'],{type:'application/pdf'}))).resolves.toBe('pdf')
    await expect(verificaContinutScan(new Blob([new Uint8Array([0xff,0xd8,0xff,0xe0,1])],{type:'image/jpeg'}))).resolves.toBe('jpg')
    await expect(verificaContinutScan(new Blob([new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0])],{type:'image/png'}))).resolves.toBe('png')
    await expect(verificaContinutScan(new Blob(['nu e pdf'],{type:'application/pdf'}))).rejects.toThrow('PDF valid')
    await expect(verificaContinutScan(new Blob(['%PDF-'],{type:'image/png'}))).rejects.toThrow('PNG valid')
  })
  it('scan versionat intre extensii, include orfani si reincearca doar coliziunile',async()=>{
    const list=vi.fn().mockResolvedValueOnce({data:[{name:'PVA-ZZZ-0001_semnat_v7.png'},{name:'PVA-ZZZ-0001_v99.docx'}]}).mockResolvedValue({data:[]})
    const upload=vi.fn().mockResolvedValueOnce({error:{statusCode:409}}).mockResolvedValue({error:null})
    const s={storage:{from:()=>({list,upload})}}
    expect(await salveazaPv(s,{...cheie,blob:new Blob(['scan'],{type:'application/pdf'}),semnat:true}))
      .toEqual({path:'TEST/ZZZ/pv/PVA-ZZZ-0001_semnat_v9.pdf',versiune:9})
    expect(list.mock.calls[0][0]).toBe('TEST/ZZZ/pv')
    expect(upload.mock.calls[0][2]).toEqual({contentType:'application/pdf',upsert:false})
    upload.mockReset().mockResolvedValue({error:{statusCode:500}})
    await expect(salveazaPv(s,{...cheie,blob:new Blob(['scan'],{type:'image/png'}),semnat:true})).rejects.toThrow('verifica starea')
    expect(upload).toHaveBeenCalledTimes(1)
  })
  it('generatorul B strict refuza motiv lipsa',async()=>{
    const d=dateB();d.pv.motiv_pv_b=null
    await expect(genereazaPvB({...d,templateArrayBuffer:sablonB()})).rejects.toThrow('motivul PV B')
  })
})
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

import { CHEI_PV_C, totaluriPvC, verificaDatePvC, genereazaPvC } from './pv.js'
const dateC=()=>({proiect:{contract_nr:'TEST',contract_data:'2026-11-02',apm_nume:'APM TEST'},pv:{tronson:5,data_pv:'2026-11-02',nr_pv:'PVC-T5-0001'},
  randuriTronson:[{parcela_id:'a',uat_id:'u',tip_pv:'A',suprafata_temporara_mp:100},{parcela_id:'b',uat_id:'u',tip_pv:'B',suprafata_temporara_mp:50,obiectii_deschise:true}],
  pvs:[{parcela_id:'a',tip:'A',stare:'semnat',semnat_la_sesiune:true}],uats:[{id:'u',nume:'UAT TEST'}],
  parcele:[{tronson:5,km_de_la:2,km_pana_la:4},{tronson:5,km_de_la:1,km_pana_la:6},{tronson:5,km_de_la:0,sters_la:'2026-01-01'}]})
describe('PV C',()=>{
  it('23 chei din DOCX independent',async()=>{
    const z=await JSZip.loadAsync(readFileSync('public/redari/sabloane/pv_c.docx')), chei=new Set()
    for(const f of Object.values(z.files).filter(f=>/^word\/.*\.xml$/.test(f.name)))
      for(const m of (await f.async('string')).matchAll(/\{\{([^}]+)\}\}/g))chei.add(m[1])
    expect([...CHEI_PV_C].sort()).toEqual([...chei].sort());expect(chei.size).toBe(23)
  })
  it.each([[true,1,0],[false,0,1],[null,0,1],[undefined,0,1]])('semnat_la_sesiune %s',(flag,s,c)=>{
    const d=dateC();d.pvs[0].semnat_la_sesiune=flag
    const r=totaluriPvC(d.randuriTronson,d.pvs)
    expect(r.pva_sesiune_nr).toBe(s);expect(r.pva_corespondenta_nr).toBe(c)
    expect(r.pvb_nr).toBe(1);expect(r.total_nr).toBe(2);expect(r.total_mp).toBe('150');expect(r.obiectii_deschise_mp).toBe('50')
  })
  it('coproprietari: o parcela o singura data; mp lipsa blocheaza (Copilot f4d r1 P2-02)',()=>{
    const d=dateC();d.pvs.push({...d.pvs[0]})
    expect(totaluriPvC(d.randuriTronson,d.pvs).pva_sesiune_nr).toBe(1)
    d.randuriTronson[0].suprafata_temporara_mp=null
    expect(()=>totaluriPvC(d.randuriTronson,d.pvs)).toThrow('Suprafata lipsa')
    expect(verificaDatePvC(d)).toContain('suprafata temporara lipsa la 1 parcele')
  })
  it('suma mp rotunjita la 2 zecimale',()=>{
    const d=dateC();d.randuriTronson[0].suprafata_temporara_mp=10.1;d.randuriTronson[1].suprafata_temporara_mp=20.2
    expect(totaluriPvC(d.randuriTronson,d.pvs).total_mp).toBe('30,3')
  })
  it('UAT necitit refuza generarea (Copilot f4d r1 P3-01)',async()=>{
    const d=dateC();d.randuriTronson[1].uat_id='v'
    await expect(genereazaPvC({...d,templateArrayBuffer:readFileSync('public/redari/sabloane/pv_c.docx')})).rejects.toThrow('UAT-uri necitite')
  })
  it('obiectiile nu blocheaza, lipsa PV blocheaza',()=>{
    const d=dateC();expect(verificaDatePvC(d)).toEqual([])
    d.randuriTronson[0].tip_pv=null;expect(verificaDatePvC(d)).toContain('parcele fara PV A semnat sau PV B')
    d.randuriTronson=[];expect(verificaDatePvC(d)).toContain('cel putin o parcela')
    d.pv.tronson=12;expect(verificaDatePvC(d)).toContain('tronson')
  })
  it('DOCX complet, MIN/MAX active si fara date personale',async()=>{
    const d=dateC(),r=await genereazaPvC({...d,templateArrayBuffer:readFileSync('public/redari/sabloane/pv_c.docx')})
    expect(r.campuri.km_de_la).toBe('1');expect(r.campuri.km_pana_la).toBe('6');expect(r.campuri.uat_uri).toBe('UAT TEST')
    expect(r.campuri.semnatar_apm).toBe('APM TEST');expect(Object.keys(r.campuri).sort()).toEqual([...CHEI_PV_C].sort())
    const z=await JSZip.loadAsync(await r.blob.arrayBuffer());expect(await z.file('word/document.xml').async('string')).not.toContain('{{')
    d.parcele=[];const gol=await genereazaPvC({...d,templateArrayBuffer:readFileSync('public/redari/sabloane/pv_c.docx')});expect(gol.campuri.km_de_la).toBe('')
  })
})
const aSemnat = (campuri = {}) => ({id:'a1',parcela_id:'p',detinator_id:'d1',tip:'A',stare:'semnat',
  nr_pv:'PVA-ZZZ-0001',data_pv:'2026-11-12',semnat_primit_data:'2026-11-13',...campuri})
const textReferinta = 'Pe aceasta parcela exista PV A semnat: PVA-ZZZ-0001 din 12.11.2026. Prezentul PV B priveste numai detinatorii fara PV A semnat.'
describe('PV B coproprietari - felia 7',()=>{
  it('fara PV A semnat activ pe parcela: referinta goala',()=>{
    expect(referintaPvA({parcela:{id:'p'},pvs:[]})).toBe('')
    for(const schimbare of [{stare:'anulat'},{stare:'generat'},{sters_la:'2026-11-14'},{tip:'B'},{parcela_id:'alta'}])
      expect(referintaPvA({parcela:{id:'p'},pvs:[aSemnat(schimbare)]})).toBe('')
  })
  it('un PV A: numar si data documentului, fara nume',()=>{
    expect(referintaPvA({parcela:{id:'p'},detinatori:[{id:'d1',nume:'NUME SECRET'},{id:'d2'}],pvs:[aSemnat()]})).toBe(textReferinta)
  })
  it('doua PV A, ordonare stabila, ignora anulate/sterse, compara cu cea mai recenta primire',()=>{
    const d={parcela:{id:'p',verificare_data:'2026-11-15'},pvs:[
      aSemnat({id:'a2',detinator_id:'d2',nr_pv:'PVA-ZZZ-0002',data_pv:'2026-11-14',semnat_primit_data:'2026-11-16'}),
      aSemnat(),aSemnat({nr_pv:'ANULAT',stare:'anulat'}),aSemnat({nr_pv:'STERS',sters_la:'2026-11-14'})]}
    expect(referintaPvA(d)).toBe('Pe aceasta parcela exista PV A semnat: PVA-ZZZ-0001 din 12.11.2026, PVA-ZZZ-0002 din 14.11.2026. Prezentul PV B priveste numai detinatorii fara PV A semnat.')
    d.parcela.verificare_data='2026-11-17'
    expect(referintaPvA(d)).toContain(' Verificare noua a terenului la data de 17.11.2026.')
  })
  it.each([['2026-11-12',false],['2026-11-13',false],['2026-11-14',true]])('verificare %s, noua: %s',(verificare_data,noua)=>{
    expect(referintaPvA({parcela:{id:'p',verificare_data},pvs:[aSemnat()]}))
      .toBe(textReferinta+(noua?' Verificare noua a terenului la data de 14.11.2026.':''))
  })
  it('data_pv este rezerva cand data primirii lipseste',()=>{
    expect(referintaPvA({parcela:{id:'p',verificare_data:'2026-11-13'},pvs:[aSemnat({semnat_primit_data:null})]}))
      .toBe(textReferinta+' Verificare noua a terenului la data de 13.11.2026.')
  })
  it('numai activi nesemnatari; zero detinatori nu inseamna toti semnatari',()=>{
    const d=dateB();d.parcela.id='p';d.pvs=[aSemnat()]
    expect(detinatoriFaraPvA(d).map(x=>x.id)).toEqual(['d2'])
    expect(verificaDatePvB(d)).toEqual([])
    d.pvs.push(aSemnat({id:'a2',detinator_id:'d2'}))
    expect(verificaDatePvB(d)).toContain('parcela acoperita prin PV A semnat')
    d.detinatori=[]
    expect(verificaDatePvB(d)).not.toContain('parcela acoperita prin PV A semnat')
  })
  it('sablon real: doar absentii, referinta completata, 72 chei consumate',async()=>{
    const d=dateB();d.parcela.id='p';d.pvs=[aSemnat()]
    d.convocari=[{id:'c1',detinator_id:'d1',stare:'activ',canal:'posta',nr_tracking:'DOAR-SEMNATAR',created_at:'2026-11-14'}]
    d.raspunsuri=[{detinator_id:'d1',data:'2026-11-14',seq:1,optiune:'particip'}]
    const r=await genereazaPvB({...d,templateArrayBuffer:sablonB()})
    expect(r.campuri.nume).toBe('FICTIV DOI')
    expect(r.campuri.pv_a_referinta).toBe(textReferinta)
    expect(r.campuri.conv_nr_tracking).toBe('')
    expect(r.campuri.bifa_fara_raspuns).toBe(BIFA_DA)
    expect(Object.keys(r.campuri).sort()).toEqual([...CHEI_PV_B].sort())
    const z=await JSZip.loadAsync(await r.blob.arrayBuffer())
    for(const f of Object.values(z.files).filter(f=>/^word\/.*\.xml$/.test(f.name))) expect(await f.async('string')).not.toContain('{{')
    expect(await z.file('word/document.xml').async('string')).toContain(textReferinta)
    d.pvs.push(aSemnat({id:'a2',detinator_id:'d2'}))
    await expect(genereazaPvB({...d,templateArrayBuffer:sablonB()})).rejects.toThrow('parcela acoperita prin PV A semnat')
  })
})
