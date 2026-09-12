// Proba de acoperire: trece parserul peste TOATE numele din arhiva, nu peste esantion.
// Scopul nu e sa treaca, ci sa arate unde NU stie.
import { readFileSync } from 'node:fs'
import { parseNumeLicitatie } from '../../src/lib/arhivaNume.js'
const linii = readFileSync(new URL('./toate-licitatiile.tsv', import.meta.url),'utf8').split('\n').filter(Boolean)
const R = linii.map(l => { const [cat, nume] = l.split('\t'); return { cat, nume, r: parseNumeLicitatie(nume, cat) } })
const lic = R.filter(x => x.r.este_licitatie !== false)
const nu  = R.filter(x => x.r.este_licitatie === false)
const cu = (f) => lic.filter(x => x.r[f] !== null && x.r[f] !== undefined && x.r[f] !== '').length
console.log(`TOTAL ${R.length} · licitatii ${lic.length} · non-licitatii ${nu.length}`)
console.log(`numar   ${cu('numar')}/${lic.length}`)
console.log(`termen  ${cu('termen')}/${lic.length}`)
console.log(`rol     ${cu('rol')}/${lic.length}`)
console.log(`partener ${cu('partener')}/${lic.length}`)
console.log(`id_seap ${cu('id_seap')}/${lic.length}`)
console.log(`participat=false ${lic.filter(x=>x.r.participat===false).length}`)
console.log(`stare!=null ${lic.filter(x=>x.r.stare).length}`)
const neint = lic.filter(x => x.r.neinterpretat.length)
console.log(`\nCU NEINTERPRETAT: ${neint.length}/${lic.length}`)
const frecv = {}
for (const x of neint) for (const f of x.r.neinterpretat) frecv[f] = (frecv[f]||0)+1
console.log('--- cele mai frecvente fragmente neinterpretate:')
Object.entries(frecv).sort((a,b)=>b[1]-a[1]).slice(0,25).forEach(([f,n])=>console.log(`  ${n}x  ${JSON.stringify(f)}`))
console.log('\n--- licitatii FARA numar (parserul nu le-a recunoscut ca numerotate):')
lic.filter(x=>x.r.numar===null).slice(0,20).forEach(x=>console.log(`  [${x.cat}] ${x.nume.slice(0,80)}`))
console.log('\n--- clasate NON-licitatie (verifica daca vreuna e de fapt licitatie):')
nu.forEach(x=>console.log(`  [${x.cat}] ${x.nume.slice(0,70)}`))
