import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx-js-style'
import { parseazaTgz, scrieImport, idParcela, tronsonOptional, tronsonDatInvalid } from './importTgz.js'

function excel() {
  const wb=XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([
    ['Nr.Crt.','Poz. HG','UAT','Nume','Nr. cadastral'],
    [1,'10','Husi','TEST UNU','CF100'],[2,'11','Husi','TEST DOI','CF101'],
  ]),'TGZ')
  return XLSX.write(wb,{type:'array',bookType:'xlsx'})
}
const opt={uats:[{id:'uat-test',nume:'Husi',uat3:'HUS'}]}

describe('import 8b - identitate fara tronson',()=>{
  it('TGZ fara configurare produce parcele neatribuite si ID provizoriu',()=>{
    const p=parseazaTgz(excel(),opt)
    expect(p.erori).toEqual([])
    expect(p.parcele).toHaveLength(2)
    expect(p.parcele.map(p=>[p.tronson,p.id_parcela])).toEqual([[null,'HUS-????'],[null,'HUS-????']])
  })
  it('tronsonul explicit valid ramane fara sa schimbe identitatea',()=>{
    const p=parseazaTgz(excel(),{...opt,tronsonPeUat:{HUS:11}})
    expect(p.parcele.map(p=>[p.tronson,p.id_parcela])).toEqual([[11,'HUS-????'],[11,'HUS-????']])
    expect(idParcela('HUS',1)).toBe('HUS-0001')
    expect(idParcela('HUS',9999)).toBe('HUS-9999')
    for(const n of [0,10000,1.5])expect(()=>idParcela('HUS',n)).toThrow()
    expect(()=>idParcela('HUSX',1)).toThrow()
    for(const v of [undefined,null,'',0,12,true,'3x'])expect(tronsonOptional(v)).toBeNull()
    expect(tronsonOptional('3')).toBe(3)
  })
  it('tronson dat explicit dar invalid -> eroare pe rand, nu NULL tacut (Copilot f8b r1 P3-01)',()=>{
    for(const v of [undefined,null,''])expect(tronsonDatInvalid(v)).toBe(false)
    for(const v of [0,12,true,'3x'])expect(tronsonDatInvalid(v)).toBe(true)
    const p=parseazaTgz(excel(),{...opt,tronsonPeUat:{HUS:12}})
    expect(p.parcele).toHaveLength(0)
    expect(p.erori).toHaveLength(2)
    expect(p.erori[0].motiv).toMatch(/Tronson invalid pentru UAT HUS/)
    expect(p.statistici.pe_uat.HUS.erori).toBe(2)
  })
  it('rezerva un singur bloc per UAT, inclusiv tronsoane diferite',async()=>{
    const apeluri=[], scrise=[]
    const db={
      rpc:async(nume,args)=>{apeluri.push({nume,args});return {data:1,error:null}},
      from(tabela){
        let op='select',payload,campuri
        const q={
          insert(v){op='insert';payload=v;return q},update(){op='update';return q},
          select(v){campuri=v;return q},eq(){return q},in(){return q},is(){return q},range(){return q},single(){return q},
          then(resolve,reject){
            let data=[]
            if(op==='insert'&&tabela==='red_import_loturi')data={id:'lot-test'}
            if(op==='insert'&&tabela==='red_parcele')scrise.push(...payload)
            if(op==='select'&&tabela==='red_parcele'&&campuri==='id, id_parcela')data=scrise.map((p,i)=>({...p,id:'p'+i}))
            return Promise.resolve({data,error:null}).then(resolve,reject)
          },
        };return q
      },
    }
    const parcele=[null,3,11].map((tronson,i)=>({cheie:'p'+i,cheie_sursa:'HUS|'+i,uat_id:'uat-test',uat3:'HUS',tronson}))
    const r=await scrieImport(db,{parcele,detinatori:[],contacte:[]},{proiectId:'proiect-test'})
    expect(r.parceleNoi).toBe(3)
    expect(apeluri).toEqual([{nume:'fn_red_rezerva_numere_parcele',args:{p_uat3:'HUS',p_n:3}}])
    expect(scrise.map(p=>[p.id_parcela,p.tronson])).toEqual([['HUS-0001',null],['HUS-0002',3],['HUS-0003',11]])
  })
})
