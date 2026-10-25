import { readFileSync } from 'node:fs'
import { it,expect } from 'vitest'
import { poateSelectaLumina } from './luminiUi.js'
import { decide,oraLocala,soare } from '../supabase/functions/tuya/lumini_logica.ts'

// Extragem din validarea SQL perechile interzise si verificam aceeasi matrice in UI/decide.
it('paritate rol/tip intre poarta SQL, UI si motor',()=>{
  const sql=readFileSync(new URL('../supabase/migrations/20261113a_iot_programe_lumini.sql',import.meta.url),'utf8')
  const interzise=[...sql.matchAll(/v_tip='([^']+)' AND l\.rol='([^']+)'/g)].map(m=>[m[1],m[2]])
  expect(interzise).toEqual([['simulare_prezenta','exterior'],['solar','interior']])
  for(const tip of ['solar','orar','simulare_prezenta'])for(const rol of ['exterior','interior','mixt']){
    const permis=!interzise.some(([t,r])=>t===tip && r===rol)
    expect(poateSelectaLumina({activ:true,rol},tip)).toBe(permis)
    const program={id:1,tip,dispozitive:[1],activ:true,aprobat_de:'owner',aprobat_la:'2026-01-01',parametri:tip==='orar'?{pornire:'18:00',oprire:'23:30',zile:[6]}:{}}
    const now=tip==='simulare_prezenta'?soare('2026-10-24').apus+60000:oraLocala('2026-10-24','21:00')
    expect(decide(program,now,{1:false},{roluri:{1:rol}}).length>0).toBe(permis)
  }
})
