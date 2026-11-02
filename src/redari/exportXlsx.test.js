import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import * as XLSX from 'xlsx-js-style'
vi.mock('../lib/supabase.js', () => ({ supabase: {} }))
import { COLOANE_REGISTRU, randRegistru, randuriRegistru, foaieCentralizator, construiesteWorkbook, numeFisier } from './exportXlsx.js'
import { paginiExport, citesteDateExport } from './ui/ExportEcran.jsx'

const baza = () => ({ parcela: { id: 'p1', id_parcela: 'TEST-1', uat_id: 'u1', tronson: 'T1', observatii: 'strada Fictiva 7' },
  uat: { id: 'u1', nume: 'UAT Fictiv' }, detinator: { id: 'd1', parcela_id: 'p1', nume: 'EXEMPLU Unu', calitate: 'coproprietar', sursa_date: '0700000000 test@example.invalid' },
  contact: { telefon: '0700000000', adresa_cunoscuta: false }, stare: 'DE_CONVOCAT', responsabil: { name: 'RESP FICTIV' } })
const conv = (id, data, extra = {}) => ({ id, detinator_id: 'd1', stare: 'activ', sters_la: null, data_expediere: data, nr_document: id, ...extra })
const pv = (tip, extra = {}) => ({ id: tip, tip, parcela_id: 'p1', detinator_id: tip === 'A' ? 'd1' : null, stare: 'semnat', sters_la: null, nr_pv: `PV-${tip}`, ...extra })

describe('Model_6', () => {
  it('39 coloane cu antetele exacte din sursa independenta SABLOANE 5.4', () => {
    const text = readFileSync(new URL('../../docs/redari/SABLOANE.md', import.meta.url), 'utf8').split('### 5.4')[1].split('## 6.')[0]
    const asteptate = text.split('\n').filter(l => /^\|[^|]*\| [A-Z]{1,2} \|/.test(l)).map(l => l.split('|').slice(1, 4).map(x => x.trim()))
    expect(asteptate).toHaveLength(39)
    expect(COLOANE_REGISTRU.map(c => [c.col, c.antet])).toEqual(asteptate.map(c => [c[1], c[2]]))
    expect(COLOANE_REGISTRU.map(c => c.col).join(',')).toBe('A,B,C,D,E,F,G,H,I,J,K,L,M,N,O,P,Q,R,S,T,U,V,W,X,Y,Z,AA,AB,AC,AD,AE,AF,AG,AH,AI,AJ,AK,AL,AM')
  })
  it.each([
    [[conv('vechi','2026-01-01'), conv('nou','2026-02-01')], 'nou'],
    [[conv('activ','2026-01-01'), conv('anulat','2026-03-01',{ stare:'anulat' })], 'activ'],
    [[conv('activ','2026-01-01'), conv('sters','2026-03-01',{ sters_la:'2026-03-02' })], 'activ'],
    [[conv('a','2026-01-01',{created_at:'2026-01-01T10:00:00Z'}), conv('b','2026-01-01',{created_at:'2026-01-01T11:00:00Z'})], 'b'],
  ])('alege convocarea activa recenta %#', (convocari, asteptat) => expect(randRegistru({ ...baza(), convocari }).P).toBe(asteptat))
  it.each([
    [[pv('A',{stare:'anulat'}),pv('B')], 'B'],
    [[pv('A'),pv('B')], 'A'],
    [[pv('A',{detinator_id:'altul'}),pv('B')], 'B'],
    [[pv('A',{sters_la:'2026-01-01'})], ''],
    [[pv('B',{parcela_id:'alta'})], ''],
  ])('alege PV relevant %#', (pvs, asteptat) => expect(randRegistru({ ...baza(), pvs }).AC).toBe(asteptat))
  it('ultimul raspuns dupa data/seq; prezenta din orice raspuns sesiune', () => {
    const raspunsuri = [{detinator_id:'d1',canal:'sesiune',data:'2026-01-01',seq:1,optiune:'particip'},
      {detinator_id:'d1',canal:'scris',data:'2026-02-01',seq:2,optiune:'particip'},
      {detinator_id:'d1',canal:'telefon',data:'2026-02-01',seq:3,optiune:'constatare_teren',zi_sesiune_aleasa:'2026-02-03'},
      {detinator_id:'altul',data:'2026-12-01',seq:9,optiune:'particip'}]
    expect(randRegistru({...baza(),raspunsuri})).toMatchObject({ V:'Telefon', W:'01.02.2026', Z:'03.02.2026', AA:'DA', AB:'01.02.2026', M:'NU', AL:'RESP FICTIV' })
    expect(randRegistru(baza()).AA).toBe('')
    expect(randRegistru({...baza(),contact:{}}).M).toBe('')
  })
  it('coproprietari = doua randuri; TGZ elimina O si contactele inclusiv texte libere', () => {
    const a = baza(), b = {...baza(),detinator:{...baza().detinator,id:'d2',nume:'EXEMPLU Doi'}}
    expect(randuriRegistru([a,b])).toHaveLength(2)
    const randuri = randuriRegistru([a,b],{pentruTgz:true})
    expect(Object.keys(randuri[0])).toHaveLength(38)
    expect(randuri[0]).not.toHaveProperty('O')
    expect(JSON.stringify(randuri)).not.toMatch(/0700000000|example\.invalid|strada Fictiva/)
    expect(randuri[0].J).toBe('EXEMPLU Doi')
    // datele si AWB-ul nu sunt confundate cu telefoane in varianta TGZ
    const cu = {...baza(), convocari:[conv('c1','2026-02-01',{nr_tracking:'RO123456789RO', data_confirmare_primire:'2026-02-05'})]}
    expect(randuriRegistru([cu],{pentruTgz:true})[0]).toMatchObject({ Q:'01.02.2026', R:'RO123456789RO', S:'05.02.2026' })
    // Copilot f6 r1 P3-01: abrevierile de adresa in coloanele text ramase
    for (const t of ['Str. Lalelelor 7','Bd. Unirii 3','Aleea Rozelor','sos. Nationala']) {
      const x = {...baza(), detinator:{...baza().detinator, cota:t}}
      expect(randuriRegistru([x],{pentruTgz:true})[0].L).toBe('')
    }
    expect(randuriRegistru([a])[0].O).toBe('0700000000')
  })
  it('timestamp la miezul noptii se afiseaza in Bucuresti, data calendaristica ramane identica', () => {
    expect(randRegistru({...baza(),raspunsuri:[{detinator_id:'d1',data:'2026-11-01T23:30:00Z',optiune:'constatare_teren'}]})).toMatchObject({W:'02.11.2026',AB:'02.11.2026'})
    expect(randRegistru({...baza(),raspunsuri:[{detinator_id:'d1',data:'2026-03-29'}]}).W).toBe('29.03.2026')
  })
  it('centralizator: ordinea procesului, zero, procent ponderat si fara persoane', () => {
    const m = foaieCentralizator([{uat_id:'u1',stare:'PV_A_SEMNAT',numar:1},{uat_id:'u1',stare:'DE_CONVOCAT',numar:2}], [{id:'u1',nume:'B Fictiv'},{id:'u0',nume:'A Fictiv'}])
    expect(m[0]).toEqual(['Stare','A Fictiv','B Fictiv','TOTAL'])
    expect(m[1]).toEqual(['De convocat',0,2,2])
    expect(m[12]).toEqual(['PV A semnat',0,1,1])
    expect(m[13]).toEqual(['TOTAL randuri (parcela + persoana)',0,3,3])
    expect(m[14]).toEqual(['% randuri inchise (PV A sau B; perechi parcela + persoana)',0,33.3,33.3])
    expect(foaieCentralizator([],[]).at(-1)).toEqual(['% randuri inchise (PV A sau B; perechi parcela + persoana)',0])
    expect(() => foaieCentralizator([{uat_id:'u1',stare:'necunoscut',numar:1}],[{id:'u1',nume:'X'}])).toThrow()
  })
  it.each([false,true])('scriere/recitire XLSX si antete rand 2 TGZ=%s', pentruTgz => {
    const registru = randuriRegistru([baza()],{pentruTgz})
    const wb = construiesteWorkbook({registru,centralizator:foaieCentralizator([],[]),pentruTgz})
    const recitit = XLSX.read(XLSX.write(wb,{type:'array',bookType:'xlsx'}),{type:'array'})
    expect(recitit.SheetNames).toEqual(['Registru','Centralizator','Legenda'])
    const antete = XLSX.utils.sheet_to_json(recitit.Sheets.Registru,{header:1})[1]
    expect(antete).toHaveLength(pentruTgz ? 38 : 39)
    expect(antete[0]).toBe('ID parcel\u0103')
    expect(antete.includes('Telefon (dac\u0103 exist\u0103)')).toBe(!pentruTgz)
    expect(recitit.Sheets.Registru.A3.t).toBe('s')
    if (pentruTgz) {
      const direct = construiesteWorkbook({registru:randuriRegistru([baza()]),pentruTgz:true})
      expect(JSON.stringify(XLSX.utils.sheet_to_json(direct.Sheets.Registru,{header:1}))).not.toContain('0700000000')
    }
    expect(construiesteWorkbook({centralizator:[]}).SheetNames).toEqual(['Centralizator','Legenda'])
  })
  it('valideaza nume si data calendaristica', () => {
    expect(numeFisier({proiectCod:'LOT1-TEST',tip:'TGZ',azi:'2026-11-02'})).toBe('Registru_LOT1-TEST_TGZ_2026-11-02.xlsx')
    expect(numeFisier({proiectCod:'TEST',tip:'centralizator',azi:'2026-11-02'})).toBe('Centralizator_TEST_2026-11-02.xlsx')
    for (const proiectCod of ['../test','TEST X','TEST.xlsx','']) expect(() => numeFisier({proiectCod,tip:'intern'})).toThrow()
    expect(() => numeFisier({proiectCod:'TEST',tip:'intern',azi:'2026-02-30'})).toThrow()
  })
})

function clientFictiv(tabele) {
  const apeluri = [], pagini = new Map()
  return { apeluri, from(tabel) {
    const q = {}
    for (const op of ['select','eq','is','not','neq','in','order','or']) q[op] = (...args) => { apeluri.push([tabel,op,...args]); return q }
    q.range = async (...args) => {
      apeluri.push([tabel,'range',...args])
      const index = pagini.get(tabel) || 0; pagini.set(tabel,index+1)
      return {data:tabele[tabel]?.[index] ?? [],error:null}
    }
    return q
  } }
}

describe('citirea exportului', () => {
  it('pagina scurta nu opreste citirea; cursor si range 500 pana la gol', async () => {
    const c = clientFictiv({test:[[{id:'a'}],[{id:'b'}],[]]})
    expect(await paginiExport(() => c.from('test').select('id'),['id'],()=>true)).toEqual([{id:'a'},{id:'b'}])
    expect(c.apeluri.filter(a=>a[1]==='range')).toHaveLength(3)
    expect(c.apeluri).toContainEqual(['test','range',0,499])
    expect(c.apeluri).toContainEqual(['test','or','id.gt."a"'])
  })
  it('eroare, lista invalida, duplicate si schimbarea proiectului refuza partialul', async () => {
    await expect(paginiExport(()=>({order(){return this},range:async()=>({error:new Error('REFUZ')})}),['id'],()=>true)).rejects.toThrow('REFUZ')
    await expect(paginiExport(()=>({order(){return this},range:async()=>({data:null})}),['id'],()=>true)).rejects.toThrow('incompleta')
    const c = clientFictiv({t:[[{id:'a'}],[{id:'a'}]]})
    await expect(paginiExport(()=>c.from('t'),['id'],()=>true)).rejects.toThrow('duplicate')
    let activ = true
    await expect(paginiExport(()=>({order(){return this},range:async()=>{activ=false;return {data:[{id:'a'}]}}}),['id'],()=>activ)).rejects.toThrow('abandonat')
  })
  it('TGZ nu selecteaza telefon; centralizatorul nu citeste persoane', async () => {
    const tabele = {red_uat:[[{id:'u1',nume:'Fictiv'}]], red_v_centralizator_uat:[[{uat_id:'u1',stare:'DE_CONVOCAT',numar:1}]],
      red_v_parcele:[[{id:'p1',uat_id:'u1',id_parcela:'TEST'}]], red_detinatori:[[{id:'d1',parcela_id:'p1',nume:'FICTIV'}]],
      red_detinatori_contact:[[{detinator_id:'d1',adresa_cunoscuta:true}]],red_v_stare_parcela:[[{parcela_id:'p1',detinator_id:'d1',stare:'DE_CONVOCAT'}]]}
    const c = clientFictiv(tabele)
    expect((await citesteDateExport(c,'proiect','TGZ',()=>true)).numar).toBe(1)
    expect(c.apeluri.filter(a=>a[0]==='red_detinatori_contact' && a[1]==='select').every(a=>a[2]==='detinator_id,adresa_cunoscuta')).toBe(true)
    const agregat = clientFictiv(tabele)
    await citesteDateExport(agregat,'proiect','centralizator',()=>true)
    expect([...new Set(agregat.apeluri.map(a=>a[0]))]).toEqual(['red_uat','red_v_centralizator_uat'])
  })
  it('stare schimbata intre centralizator si registru refuza exportul (Copilot f6 r1 P2-01)', async () => {
    const tabele = {red_uat:[[{id:'u1',nume:'Fictiv'}]], red_v_centralizator_uat:[[{uat_id:'u1',stare:'DE_CONVOCAT',numar:1}]],
      red_v_parcele:[[{id:'p1',uat_id:'u1',id_parcela:'TEST'}]], red_detinatori:[[{id:'d1',parcela_id:'p1',nume:'FICTIV'}]],
      red_detinatori_contact:[[{detinator_id:'d1',adresa_cunoscuta:true}]],red_v_stare_parcela:[[{parcela_id:'p1',detinator_id:'d1',stare:'PV_A_SEMNAT'}]]}
    await expect(citesteDateExport(clientFictiv(tabele),'proiect','intern',()=>true)).rejects.toThrow('schimbat')
  })
})
