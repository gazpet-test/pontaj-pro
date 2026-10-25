import { readFileSync } from 'node:fs'
import { it,expect } from 'vitest'
import { poateSelectaLumina, setariSchimbaProgramarea, confirmareSetariLumini } from './luminiUi.js'
import { decide,oraLocala,soare } from '../supabase/functions/tuya/lumini_logica.ts'

// Extragem din validarea SQL perechile interzise si verificam aceeasi matrice in UI/decide.
it('r5: fixture-uri setari partajate cu RPC si integrarea amanarilor in UI',()=>{
  const cases=JSON.parse(readFileSync(new URL('../test-fixtures/lumini_setari.json',import.meta.url),'utf8'))
  for(const c of cases)expect(setariSchimbaProgramarea(c.initial,c.salvat),c.nume).toBe(c.schimba)
  const ui=readFileSync(new URL('./CladireLumini.jsx',import.meta.url),'utf8')
  expect(ui).toContain('textAmanareLumini(setari,l.dispozitiv_id)')
  expect(ui).toContain('textAmanareLumini(setari,null,p.id)')
})

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

it('r4 P2-3: UI si SQL invalideaza numai modificarile de programare',()=>{
  const sql=readFileSync(new URL('../supabase/migrations/20261113a_iot_programe_lumini.sql',import.meta.url),'utf8')
  const fields=sql.match(/ROW\(s\.([^)]+)\) IS DISTINCT FROM/)[1].split(',s.')
  expect(fields).toEqual(['lat','lon','vacanta_de','vacanta_pana','simulare_pana_la'])
  const initial={lat:44.94,lon:26.03,vacanta_de:null,vacanta_pana:null,simulare_pana_la:'23:30:00',pauza_ore:3}
  expect(setariSchimbaProgramarea(initial,{...initial,pauza_ore:1,lat:'44.94',vacanta_de:'',simulare_pana_la:'23:30'})).toBe(false)
  expect(confirmareSetariLumini(initial,{...initial,pauza_ore:1})).toContain('se pastreaza')
  for(const key of fields) {
    const changed={...initial,[key]:{lat:45,lon:27,vacanta_de:'2026-12-24',vacanta_pana:'2026-12-31',simulare_pana_la:'22:00'}[key]}
    expect(setariSchimbaProgramarea(initial,changed)).toBe(true)
    expect(confirmareSetariLumini(initial,changed)).toContain('inclusiv cele ramase aprinse')
  }
  const ui=readFileSync(new URL('./CladireLumini.jsx',import.meta.url),'utf8')
  expect(ui).toContain('window.confirm(confirmareSetariLumini(initial,s))')
  expect(ui).toContain('Schimbarea rolului dezactiveaza programele afectate. ${avertismentAcoperire}')
  expect(ui).toContain('Salvarea dezactiveaza programul si cere o noua aprobare de la owner. {avertismentAcoperire}')
})
