import { describe,it,expect } from 'vitest'
import { textStareLumina,dispozitiveImplicite,poateSelectaLumina,textUrmatoare,programPentruSalvare,textAmanareLumini,textConsumTuya,textCitireLumina } from './luminiUi.js'
import { parametriValizi } from '../supabase/functions/tuya/lumini_logica.ts'
describe('Afisare lumini',()=>{
  it('afiseaza consumul si toate starile cotei fara a ascunde lipsa datelor',()=>{
    const consum={azi:12,n:31500,buget:45000,stare:'ok'}
    expect(textConsumTuya(consum)).toBe('Consum Tuya: azi 12, ciclu 31500 / 45000 - ok')
    expect(textConsumTuya({...consum,stare:'economie'})).toContain('economie')
    expect(textConsumTuya({...consum,stare:'doar_off'})).toContain('doar OFF si comenzi manuale owner')
    expect(textConsumTuya({...consum,stare:'blocata',cota_blocata_pana:'2026-10-26T12:00:00Z'})).toContain('blocata pana la 26.10, 14:00')
    expect(textConsumTuya(null)).toBe('Consum Tuya indisponibil')
  })
  it('afiseaza momentul citirii independent de cat de veche este starea',()=>{
    expect(textCitireLumina('2026-10-26T12:00:00Z')).toBe('stare citita la 26.10, 14:00')
    expect(textCitireLumina('invalid')).toBe('stare fara citire disponibila')
    expect(textCitireLumina(null)).toBe('stare fara citire disponibila')
  })
  it('arata amanarea ultimului tick doar pe lumina/programul afectat si o elimina dupa convergenta',()=>{
    const setari={runtime:{motor:{amanate:[{dispozitiv_id:3,program_id:20,motiv:'plafon_comun_2'}]}}}
    expect(textAmanareLumini(setari,3)).toBe('amanat: plafon comun')
    expect(textAmanareLumini(setari,null,20)).toBe('amanat: plafon comun')
    expect(textAmanareLumini(setari,2)).toBe('')
    expect(textAmanareLumini(setari,null,21)).toBe('')
    expect(textAmanareLumini(null,3)).toBe('')
    setari.runtime.motor.amanate=[]
    expect(textAmanareLumini(setari,3)).toBe('')
  })
  it('formularul trimite numai parametrii tipului selectat, la creare si editare',()=>{
    const parametri={offset_pornire:0,offset_oprire:0,pornire:'18:00',oprire:'23:30',zile:[0],sfarsit:'23:30',explicit:false}
    for(const tip of ['solar','orar','simulare_prezenta'])expect(parametriValizi(programPentruSalvare({tip,parametri}))).toBe(true)
  })
  const lumini=[{dispozitiv_id:1,rol:'exterior',activ:true},{dispozitiv_id:2,rol:'interior',activ:true},{dispozitiv_id:3,rol:'mixt',activ:true}]
  it('alege rolurile din BD, inclusiv mixt pentru prezenta',()=>{
    expect(dispozitiveImplicite(lumini,'solar')).toEqual([1])
    expect(dispozitiveImplicite(lumini,'simulare_prezenta')).toEqual([2,3])
    expect(poateSelectaLumina(lumini[0],'simulare_prezenta')).toBe(false)
    expect(poateSelectaLumina(lumini[2],'solar')).toBe(true)
  })
  it('nu prezinta citirea expirata drept stare reala',()=>{
    const now=Date.parse('2026-10-25T12:00:00Z')
    expect(textStareLumina({pornit:true},new Date(now).toISOString(),now)).toBe('Pornita')
    expect(textStareLumina({pornit:false},new Date(now).toISOString(),now)).toBe('Oprita')
    expect(textStareLumina({pornit:true},'2026-10-24T12:00:00Z',now)).toContain('necunoscuta')
    expect(textStareLumina({},null,now)).toContain('necunoscuta')
  })
  it('explica aprobarea si urmatoarele evenimente in fus local',()=>{
    expect(textUrmatoare({activ:false},Date.now(),{},lumini)).toContain('ownerului')
    expect(textUrmatoare({id:1,tip:'solar',activ:true,aprobat_de:'owner',aprobat_la:'2026-10-24',parametri:{}},'2026-10-25T12:00:00Z',{},lumini)).toContain('ora Bucuresti')
  })
})
