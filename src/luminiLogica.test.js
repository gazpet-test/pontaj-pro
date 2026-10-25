import { describe, it, expect } from 'vitest'
import { soare, oraLocala, planSimulare, evalueaza, decide, dataLocala } from '../supabase/functions/tuya/lumini_logica.ts'

const settings={lat:44.94,lon:26.03,roluri:{1:'interior',2:'mixt',3:'exterior'}}
const program={id:7,nume:'Test',tip:'simulare_prezenta',dispozitive:[1,2,3],parametri:{},activ:true,aprobat_de:'owner',aprobat_la:'2026-01-01T00:00:00Z'}
const local=(zi,ora)=>oraLocala(zi,ora)

describe('Lumini: soare NOAA si ora Bucuresti',()=>{
  it('Ploiesti: zi de vara mai lunga, momente plauzibile',()=>{
    const summer=soare('2026-06-21'),winter=soare('2026-12-21')
    expect(summer.rasarit).toBeLessThan(summer.apus)
    expect(winter.rasarit).toBeLessThan(winter.apus)
    expect(summer.apus-summer.rasarit).toBeGreaterThan(15*3600000)
    expect(winter.apus-winter.rasarit).toBeLessThan(10*3600000)
    expect(summer.rasarit).toBeGreaterThan(local('2026-06-21','05:00'))
    expect(summer.rasarit).toBeLessThan(local('2026-06-21','06:00'))
    expect(summer.apus).toBeGreaterThan(local('2026-06-21','20:30'))
    expect(summer.apus).toBeLessThan(local('2026-06-21','21:30'))
  })
  it('DST schimba ora locala, nu miscarea solara UTC',()=>{
    for(const [a,b,delta] of [['2026-03-28','2026-03-29',1],['2026-10-24','2026-10-25',-1]]){
      const x=soare(a).apus,y=soare(b).apus
      const utcMinutes=(y-x-86400000)/60000
      expect(Math.abs(utcMinutes)).toBeLessThan(4)
      const minutes=t=>{const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Bucharest',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(t)).split(':').map(Number);return parts[0]*60+parts[1]}
      expect(Math.abs(minutes(y)-minutes(x)-delta*60)).toBeLessThan(5)
    }
    expect(dataLocala('2026-06-20T22:30:00Z')).toBe('2026-06-21')
  })
})
describe('Simulare reproductibila',()=>{
  const start=soare('2026-10-24').apus,end=local('2026-10-24','23:30')
  it('acelasi seed reproduce, alta zi variaza',()=>{
    expect(planSimulare('2026-10-24:7',[1,2],start,end)).toEqual(planSimulare('2026-10-24:7',[1,2],start,end))
    expect(planSimulare('2026-10-24:7',[1,2],start,end)).not.toEqual(planSimulare('2026-10-25:7',[1,2],start,end))
  })
  it('cel mult doua simultan, 20-90 minute, pauze 5-30 minute',()=>{
    const plan=planSimulare('seed',[1,2,4,5,6],start,end)
    expect(plan.length).toBeGreaterThan(1)
    for(const p of plan){expect((p.end-p.start)/60000).toBeGreaterThanOrEqual(20);expect((p.end-p.start)/60000).toBeLessThanOrEqual(90)}
    for(let t=start;t<end;t+=60000)expect(plan.filter(p=>t>=p.start && t<p.end).length).toBeLessThanOrEqual(2)
    const groups=[...new Set(plan.map(p=>p.start))].map(t=>plan.find(p=>p.start===t))
    for(let i=1;i<groups.length;i++){const gap=(groups[i].start-groups[i-1].end)/60000;expect(gap).toBeGreaterThanOrEqual(5);expect(gap).toBeLessThanOrEqual(30)}
  })
  it('niciodata exterior si nimic in zi lucratoare fara vacanta/explicit',()=>{
    expect(decide(program,local('2026-10-26','20:00'),{1:false,2:false,3:false},settings)).toEqual([])
    const commands=decide(program,start+60000,{1:false,2:false,3:false},settings)
    expect(commands.length).toBeGreaterThan(0);expect(commands.some(c=>c.dispozitiv_id===3)).toBe(false)
    expect(decide({...program,parametri:{explicit:true}},soare('2026-10-26').apus+60000,{1:false,2:false,3:false},settings).length).toBeGreaterThan(0)
    expect(decide(program,soare('2026-10-26').apus+60000,{1:false,2:false,3:false},{...settings,vacanta_de:'2026-10-26',vacanta_pana:'2026-10-27'}).length).toBeGreaterThan(0)
  })
})

describe('Convergenta fara memorie',()=>{
  const solar={...program,tip:'solar',dispozitive:[3]}
  const now=local('2026-10-24','21:00')
  it('idempotenta; stinge orice lumina acoperita in afara ferestrei',()=>{
    expect(decide(solar,now,{3:false},settings)).toEqual([{dispozitiv_id:3,stare:true}])
    expect(decide(solar,now,{3:true},settings)).toEqual([])
    expect(decide(solar,local('2026-10-25','12:00'),{3:true},settings)).toEqual([{dispozitiv_id:3,stare:false}])
  })
  it('inactiv, sters sau necunoscut nu produce comanda',()=>{
    expect(decide({...solar,activ:false},now,{3:true},settings)).toEqual([])
    expect(decide({...solar,aprobat_de:null},now,{3:true},settings)).toEqual([])
    expect(decide(solar,now,{3:null},settings)).toEqual([])
  })
  it('orar peste miezul noptii respecta ziua pornirii',()=>{
    const p={...solar,tip:'orar',parametri:{pornire:'22:00',oprire:'02:00',zile:[6]}}
    expect(decide(p,local('2026-10-25','01:00'),{3:false},settings)).toEqual([{dispozitiv_id:3,stare:true}])
    expect(decide(p,local('2026-10-26','01:00'),{3:true},settings)).toEqual([{dispozitiv_id:3,stare:false}])
  })
  it('simularea propune OFF si pe segmentele de pauza, fara proprietate',()=>{
    const r=evalueaza(program,local('2026-10-24','23:30'),{1:true,2:true,3:true},settings)
    expect(r.comenzi).toEqual([{dispozitiv_id:1,stare:false},{dispozitiv_id:2,stare:false}])
    expect(r).not.toHaveProperty('runtime')
  })
})
