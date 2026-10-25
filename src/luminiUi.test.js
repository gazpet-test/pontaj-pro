import { describe,it,expect } from 'vitest'
import { textStareLumina,dispozitiveImplicite,poateSelectaLumina,textUrmatoare,programPentruSalvare,textAmanareLumini } from './luminiUi.js'
import { parametriValizi } from '../supabase/functions/tuya/lumini_logica.ts'
describe('Afisare lumini',()=>{
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
