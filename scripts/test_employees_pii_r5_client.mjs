import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read = p => readFileSync(new URL('../'+p,import.meta.url),'utf8')
const helper = read('src/employeesPersonal.js')
const isolated = helper.replace("import { supabase } from './lib/supabase.js'", 'const supabase = {}')
const { employeeMarimiCanWrite } = await import(`data:text/javascript;base64,${Buffer.from(isolated).toString('base64')}`)
test('Matrice marimi UI: owner/P sau Magazie editor/admin; rolul nu ajunge', () => {
  for (const [p,a,expected] of [
    [{},null,false],[{role:'magazie'},null,false],[{}, {module:'magazie',access_level:'viewer'},false],
    [{}, {module:'magazie',access_level:'editor'},true],[{}, {module:'magazie',access_level:'admin'},true],
    [{}, {module:'logistica',access_level:'admin'},false],[{is_owner:true},null,true],
    [{can_access_personal_data:true},null,true],
  ]) assert.equal(employeeMarimiCanWrite(p,a),expected)
})
test('Viewer nu scrie prin callback, chiar daca marimea a fost citita', async () => {
  const src=read('src/Magazie.jsx')
  const body=src.match(/const salveazaMasura = async \(empIdRow, valoare\) => \{([\s\S]*?)\n  \}/)[1]
  const save=new (async()=>{}).constructor('poateScrieMarimi',body)
  // Fara supabase/employees in scope: orice continuare dupa garda ar esua.
  await save(false)
  assert.match(src,/disabled=\{!poateScrieMarimi \|\| !employeeFieldRead\(e, campMasura\)\}/)
})
test('Paritate SQL/UI pe modul exact si niveluri; snapshot complet in apply si rollback',()=>{
  const sql=read('supabase/migrations/20261117a_employees_pii.sql')
  const rev=read('supabase/revenire/20261117a_employees_pii_ROLLBACK.sql')
  assert.match(sql,/u.module='magazie' AND u.access_level IN \('editor','admin'\)/)
  for(const fn of ['fn_employees_personal(bigint[])','fn_employees_marimi(bigint[])','fn_employees_pii_write_guard()','fn_employees_marimi_write_guard()']) {
    assert.ok(sql.includes(`'public.${fn}'`)); assert.ok(rev.includes(`'public.${fn}'`))
  }
  assert.match(rev,/saved.objects_after IS DISTINCT FROM/)
  assert.match(sql,/'catalog',to_jsonb\(p\)/)
  assert.ok(!sql.includes("U&'"))
})
