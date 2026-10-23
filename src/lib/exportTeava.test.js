import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import XLSX from 'xlsx-js-style'
import JSZip from 'jszip'
import { citestePagini, grupeazaExport, totalExport, randExport, construiesteWorkbook, serializeazaWorkbook, numeFisier, VERIFICARE } from './exportTeava.js'

const depozite = [{id:1,name:'DM Jupânești',cod_3litere:'JUP'},{id:2,name:'OS Topleț',cod_3litere:'TOP'}]
const tronsoane = [{id:10,cod:'T12'},{id:11,cod:'T17'}]
const proiect = {id:7,cod_intern:'LOT2',nume:'Conductă Prunișor–Jupa (inclusiv alimentare cu energie electrică, protecție catodică și fibră optică)'}
const piesa = (id, extra = {}) => ({id,proiect_id:7,tip_cod:'teava',serie:`247EK${String(id).padStart(5,'0')}`,sarja:'SA04755',perete_mm:7.1,lungime_mm:12460,lungime_aviz_mm:12450,greutate_kg:1400,um:'m',stare:'receptionat',depozit_id:1,atribute:{},...extra})
const opt = {depozite,tronsoane,proiect}
const rows = ws => XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:true})

describe('export țeavă: selecție și grupare', () => {
  it('loc curent × tip, fără duplicarea originii și fără anulate', () => {
    const bucati=[piesa(1),piesa(2,{perete_mm:8.8}),piesa(3,{lungime_mm:6040}),piesa(4,{tip_cod:'curba',lungime_mm:null}),piesa(5,{stare:'pe_tronson',depozit_id:null,tronson_id:10,atribute:{depozit_origine_id:1}}),piesa(6,{stare:'anulata'})]
    const g=grupeazaExport(bucati,opt)
    expect(g.map(x=>[x.loc.cheie,x.tip,x.bucati.length])).toEqual([['depozit:1','t71',1],['depozit:1','t88',1],['depozit:1','t6m',1],['depozit:1','curba',1],['tronson:10','t71',1]])
    expect(grupeazaExport(bucati,{...opt,mod:'depozit',depozitId:'1'}).flatMap(g=>g.bucati).map(b=>b.id)).toEqual([1,2,3,4])
    expect(grupeazaExport(bucati,{...opt,mod:'tronson',tronsonId:'10'})[0].bucati.map(b=>b.id)).toEqual([5])
    expect(grupeazaExport(bucati,{...opt,mod:'tronsoane'})).toHaveLength(1)
    expect(grupeazaExport(bucati,{...opt,mod:'depozite'})).toHaveLength(4)
    expect(grupeazaExport(bucati,{...opt,mod:'depozit'})).toEqual([])
  })
  it('pragul de 7 m și prioritatea 8,8 sunt cele ale ecranului; descrierea nu suprascrie datele', () => {
    const g=grupeazaExport([piesa(1,{lungime_mm:6999}),piesa(2,{lungime_mm:7000}),piesa(3,{lungime_mm:6000,perete_mm:8.8}),piesa(4,{lungime_mm:12000,atribute:{descriere:'L=6m'}})],opt)
    expect(g.find(g=>g.tip==='t6m').bucati.map(b=>b.id)).toEqual([1])
    expect(g.find(g=>g.tip==='t88').bucati.map(b=>b.id)).toEqual([3])
    expect(g.find(g=>g.tip==='t71').bucati.map(b=>b.id)).toEqual([2,4])
  })
  it('nu amestecă depozite/tronsoane cu același id sau nume', () => {
    const g=grupeazaExport([piesa(1),piesa(2,{stare:'montata',tronson_id:1,depozit_id:null})],{depozite,tronsoane:[{id:1,cod:'JUP'}]})
    expect(g).toHaveLength(2)
  })
  it('păstrează piesele cu loc necunoscut în cumulat', () => {
    const g=grupeazaExport([piesa(1,{depozit_id:null})],opt)
    expect(g[0].loc.nume).toBe('Depozit necunoscut')
  })
})

describe('export țeavă: valori și totaluri', () => {
  it('bucăți / metri / kg, curbe pe bucăți, fără dublarea metrului și masei părintelui tăiat', () => {
    expect(totalExport([piesa(1),piesa(2,{tip_cod:'curba',lungime_mm:null,greutate_kg:547}),piesa(3,{stare:'taiata'}),piesa(4,{stare:'anulata'}),piesa(5,{lungime_mm:6040,greutate_kg:null})])).toEqual({bucati:4,metri:18.5,kg:1947,kgLipsa:1})
  })
  it('nu transformă o valoare absentă în zero și păstrează zero real', () => {
    const r=randExport(piesa(1,{sarja:null,greutate_kg:null,lungime_mm:null,lungime_aviz_mm:null,um:null}),1)
    for (const c of [3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24]) expect(r[c]).toBe('')
    expect(randExport(piesa(2,{greutate_kg:0}),1)[4]).toBe(0)
    const wb=construiesteWorkbook([piesa(1,{greutate_kg:null})],opt)
    expect(rows(wb.Sheets.Sumar)[1][4]).toBe('')
  })
  it('leagă documentul prin FK și proiect, fără a substitui numărul PV pentru NRCD E3', () => {
    const b=piesa(1,{aviz_intrare_id:12,lungime_masurata_mm:12460})
    const documente=[{id:12,proiect_id:7,stare:'confirmat',nr_document:'AV42',data_document:'2026-10-21',pv_nr:'PV99',pv_data:'2026-10-22'}]
    const r=randExport(b,1,documente)
    expect(r.slice(5,14)).toEqual(['AV42','21.10.2026',12.45,'m','','22.10.2026',12.46,2026,'octombrie'])
    expect(r[24]).toBe('PV99')
    expect(randExport(b,1,[{...documente[0],proiect_id:8}])[10]).toBe('')
    expect(randExport(b,1,[{...documente[0],stare:'anulat'}])[10]).toBe('')
    expect(randExport(b,1,[])[10]).toBe('')
    expect(randExport({...b,parinte_id:99},1,documente)[11]).toBe('')
  })
  it('restituie atributele importate, fără a ghici cantitatea istorică de ieșire', () => {
    const r=randExport(piesa(1,{stare:'pe_tronson',tronson_id:10,atribute:{sursa:{foaie:'TEAVA 7.1 MM'},descriere:'Țeavă izolată',pv_receptie:{nr:'39729',data:'2026-05-12'},aviz_iesire:{nr:'CJPT-O 0033',data:'2026-06-18',serie:'247EK00001'},gestiune:'LOT 2',dt_os:'DM JUPÂNEȘTI'}}),1,[],tronsoane)
    expect(r[2]).toBe('Țeavă izolată'); expect(r[9]).toBe('39729')
    expect(r.slice(14,20)).toEqual(['LOT 2','DM JUPÂNEȘTI','CJPT-O 0033','T12','247EK00001',''])
    expect(r[22]).toBe('18.06.2026')
  })
  it('nu prezintă PV-ul Topleț 7,1 drept număr NRCD și nu dublează prefixul OS', () => {
    const b=piesa(1,{depozit_id:2,atribute:{sursa:{foaie:'TEAVA 7.1 TOPLET'},pv_receptie:{nr:'36463',data:'2026-04-30'}}})
    const r=randExport(b,1)
    expect(r[9]).toBe(''); expect(r[24]).toBe('36463')
    const wb=construiesteWorkbook([{...b,tip_cod:'curba'}],{...opt,mod:'depozite'})
    expect(rows(wb.Sheets[wb.SheetNames[0]])[8][0]).toBe('OS Topleț')
  })
  it('curbă neconformă: motivul este disponibil, data nu se inventează', () => {
    const r=randExport(piesa(1,{tip_cod:'curba',atribute:{decizie:'primit_neconform',motiv:'Izolație deteriorată'}}),1)
    expect(r[7]).toBe(1); expect(r[14]).toBe('Izolație deteriorată'); expect(r[15]).toBe('')
  })
})

describe('paginare registru', () => {
  it('3352 piese, API limitat sub 1000, fără truncarea la prima pagină scurtă', async () => {
    const toate=Array.from({length:3352},(_,i)=>piesa(i+1)), cursori=[]
    const result=await citestePagini(async ultim => { cursori.push(ultim); return {data:toate.filter(b=>b.id>ultim).slice(0,300)} })
    expect(result).toHaveLength(3352); expect(new Set(result.map(b=>b.id)).size).toBe(3352)
    expect(cursori.at(-1)).toBe(3352)
  })
  it('unește pagini și elimină suprapunerile după id', async () => {
    const pagini=[[piesa(1),piesa(2)],[piesa(2),piesa(3)],[]]
    expect((await citestePagini(async()=>({data:pagini.shift()}))).map(b=>b.id)).toEqual([1,2,3])
  })
  it('propagă erorile și refuză cursorul blocat', async () => {
    await expect(citestePagini(async()=>({error:new Error('RLS')}))).rejects.toThrow('RLS')
    await expect(citestePagini(async()=>({data:[piesa(1)]}))).rejects.toThrow('nu avansează')
  })
})

describe('layout și workbook', () => {
  it('titlurile, antetul dublu, merge-urile, stilurile, lățimile și totalul de jos', () => {
    const wb=construiesteWorkbook([piesa(1)],{...opt,mod:'depozite'}), ws=wb.Sheets[wb.SheetNames[0]], r=rows(ws)
    expect(r[5][0]).toBe('Conductă Prunișor–Jupa')
    expect(r[6][0]).toBe('(inclusiv alimentare cu energie electrică, protecție catodică și fibră optică)')
    expect(r[8][0]).toBe('LIVRĂRI DM Jupânești'); expect(r[10][16]).toBe('LIVRATĂ ÎN TRONSON')
    expect(r[11].slice(16,20)).toEqual(['AVIZ NR.','TRONSON','SERIE','CANTITATE'])
    expect(ws['!merges']).toContainEqual({s:{r:10,c:0},e:{r:11,c:0}})
    expect(ws['!merges']).toContainEqual({s:{r:10,c:16},e:{r:10,c:19}})
    expect(ws.A11.s.font.bold).toBe(true); expect(ws.B13.s.border.top.style).toBe('thin')
    expect(ws['!cols'][2].width).toBe(52.5546875)
    expect(r[13].slice(0,5)).toEqual(['TOTAL','1 bucăți','12.46 m','',1400])
  })
  it('curbele au grupurile de neconformități, aviz și PV', () => {
    const wb=construiesteWorkbook([piesa(1,{tip_cod:'curba'})],{...opt,mod:'depozite'}), ws=wb.Sheets[wb.SheetNames[0]], r=rows(ws)
    expect(r[8][0]).toBe('OS DM Jupânești')
    expect([r[10][14],r[10][16],r[10][22]]).toEqual(['NECONFORMITĂȚI','AVIZ DE ÎNSOȚIRE','P-V'])
    expect(r[11].slice(14,16)).toEqual(['DESCRIERE','DATA'])
    expect(ws['!merges']).toContainEqual({s:{r:10,c:16},e:{r:10,c:18}})
  })
  it('opțiunea fizică adaugă patru coloane goale și linia Verifică', () => {
    for (const tip_cod of ['teava','curba']) {
      const wb=construiesteWorkbook([piesa(1,{tip_cod})],{...opt,mod:'depozite',verificare:true}), ws=wb.Sheets[wb.SheetNames[0]], r=rows(ws)
      expect(r[10].slice(-4)).toEqual(VERIFICARE)
      expect(r[12].slice(-4)).toEqual(['','','',''])
      expect(r[9][0]).toMatch(/^Verifică:.*1 bucăți/)
    }
    const wb=construiesteWorkbook([piesa(1)],{...opt,mod:'depozite'})
    expect(rows(wb.Sheets[wb.SheetNames[0]])[9][0]).toBe('')
  })
  it('Sumar are total și toate foile; fără foi goale sau UTILE', () => {
    const wb=construiesteWorkbook([piesa(1),piesa(2,{depozit_id:2,greutate_kg:10})],opt)
    expect(wb.SheetNames).toHaveLength(3); expect(wb.SheetNames[0]).toBe('Sumar')
    expect(rows(wb.Sheets.Sumar).at(-1)).toEqual(['TOTAL','',2,24.92,1410,0])
    expect(wb.SheetNames.some(n=>/UTILE|Curbe|8,8|6 m/.test(n))).toBe(false)
    expect(construiesteWorkbook([],opt)).toBeNull()
    expect(construiesteWorkbook([piesa(1,{stare:'anulata'})],opt)).toBeNull()
  })
  it('numele foilor sunt valide și unice după trunchiere', () => {
    const wb=construiesteWorkbook([piesa(1),piesa(2,{depozit_id:2})],{...opt,depozite:depozite.map(d=>({...d,cod_3litere:'A'.repeat(40)+'[]:*?/\\'}))})
    expect(new Set(wb.SheetNames).size).toBe(3)
    for (const n of wb.SheetNames) { expect(n.length).toBeLessThanOrEqual(31); expect(n).not.toMatch(/[\[\]:*?/\\]/) }
  })
  it('serializează efectiv panoul înghețat, stilurile, totalurile și text extern ca text', async () => {
    const wb=construiesteWorkbook([piesa(1,{serie:'=HYPERLINK("x")'})],opt)
    const bytes=await serializeazaWorkbook(wb), zip=await JSZip.loadAsync(bytes)
    const xml=await zip.file('xl/worksheets/sheet2.xml').async('string')
    expect(xml).toContain('ySplit="12"'); expect(xml).toContain('topLeftCell="A13"')
    expect(await zip.file('xl/worksheets/sheet1.xml').async('string')).toContain('ySplit="1"')
    const back=XLSX.read(bytes,{type:'array',cellStyles:true}), ws=back.Sheets[back.SheetNames[1]]
    expect(ws.B13.v).toBe('=HYPERLINK("x")'); expect(ws.B13.f).toBeUndefined()
    expect(ws.E14.v).toBe(1400); expect(ws['!merges'].length).toBeGreaterThan(20)
  })
  it('nume de fișier cu cod proiect și data locală', () => {
    expect(numeFisier(proiect,'JUP',new Date(2026,9,23))).toBe('LOT2_JUP_2026-10-23.xlsx')
    expect(numeFisier({...proiect,cod_intern:'A/B'},'T:12',new Date(2026,9,23))).toBe('A_B_T_12_2026-10-23.xlsx')
  })
})

// Modelele companiei sunt date de referință locale, nu dependențe ale suitei CI.
const modele='C:/Users/Public/paw-data/brief/modele_export/'
describe.skipIf(!existsSync(modele+'TOPLET_LOT_2_TEAVA.xlsx'))('modelele originale citite cu xlsx-js-style', () => {
  it('confirmă ordinea standard, dimensiunile și modelul țevilor scurte', () => {
    const j=XLSX.readFile(modele+'JUPANESTI_LOT_2_TEAVA.xlsx',{cellStyles:true})
    const t=XLSX.readFile(modele+'TOPLET_LOT_2_TEAVA.xlsx',{cellStyles:true})
    expect(j.Sheets['TEAVA 7.1 MM'].B11.v).toBe('SERIE UNICĂ DE IDENTIFICARE')
    expect(j.Sheets['TEAVA 7.1 MM']['!cols'][2].width).toBe(52.5546875)
    expect(t.Sheets['7.1 X 6ML'].C13.v).toContain('L=6m')
    expect(t.Sheets['7.1 X 6ML'].H13.v).toBe(6.04)
    expect(t.Sheets['CURBE LOT 2'].O11.v).toBe('NECONFORMITĂȚI')
    expect(t.Sheets['CURBE LOT 2'].Q11.v.trim()).toBe('AVIZ DE INSOTIRE')
    const v=XLSX.readFile(modele+'Esantion_sold_LOT2_2110.xlsx')
    expect(v.Sheets.Depozite.J3.v).toBe('Găsit DA/NU')
    expect(v.Sheets.Depozite.A2.v).toMatch(/^Verifică:/)
  })
})

import { locExport as _loc, totalExport as _tot } from './exportTeava.js'
describe('Copilot r1 export', () => {
  it('pierdută pe tronson rămâne la tronson', () => {
    expect(_loc({ stare:'pierduta', tronson_id:55, depozit_id:null }, [], [{ id:55, name:'T55' }]).tip).toBe('tronson')
  })
  it('părintele tăiat nu intră în metri', () => {
    const t = _tot([{ tip_cod:'teava', stare:'taiata', lungime_mm:12000 }, { tip_cod:'teava', stare:'receptionata', lungime_mm:5000 }, { tip_cod:'teava', stare:'receptionata', lungime_mm:7000 }])
    expect(t.metri).toBe(12)
  })
})
