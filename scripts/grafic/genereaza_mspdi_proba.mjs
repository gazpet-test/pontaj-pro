// Generează fișierele MSPDI de probă ale motorului graficului automat (src/graficMotor), pentru verificarea independentă
// cu MPXJ (scripts/grafic/verifica_mspdi.py) și pentru deschiderea manuală în MS Project (spec §10.3).
//   node scripts/grafic/genereaza_mspdi_proba.mjs <dosar_iesire>
// Scrie, pentru fiecare probă, <nume>.xml (fișierul MS Project) și <nume>.json (datele calculate de motor, referința).
// Probele: graficul Y din testul Jilava (docs/ofertare/grafic_automat_test_jilava, cu și fără sărbători) și un grafic
// sintetic cu SF, decalaje negative, oprire peste sărbători și sâmbete lucrate. Nu citește și nu scrie nimic în ERP.
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { calculeazaGrafic, genereazaMSPDI } from '../../src/graficMotor/index.js'
import { citesteGraficY } from './fixtura_jilava.mjs'

const iesire = process.argv[2]
if (!iesire) { console.error('utilizare: node scripts/grafic/genereaza_mspdi_proba.mjs <dosar_iesire>'); process.exit(2) }
mkdirSync(iesire, { recursive: true })
function sintetic() {
  const a = (cod, d, x = {}) => ({ cod, durata_zile_lucratoare: d, categorie: 'organizare', executant: 'Gazpet', sursa_durata: 'parametru:proba', ...x })
  return {
    activitati: [{ cod: 'R', rezumat: true }, a('S', 0, { jalon: true, categorie: 'jalon' }), a('A', 5, { parinte: 'R' }), a('B', 3, { parinte: 'R' }),
      a('C', 4, { parinte: 'R' }), a('D', 2), a('E', 6), a('G', 3), a('F', 0, { jalon: true, categorie: 'jalon' })],
    legaturi: [['S', 'A', 'FS', 0], ['A', 'B', 'SF', 2], ['A', 'C', 'FF', -2], ['A', 'D', 'SS', -1], ['B', 'E', 'FS', -3], ['C', 'E', 'SS', 4],
      ['D', 'G', 'FS', 7], ['E', 'F', 'FS', 0], ['G', 'F', 'FF', 1]].map(([de, la, tip, lag_zile]) => ({ de, la, tip, lag_zile })),
  }
}

const y = citesteGraficY(), s = sintetic()
const probe = [
  ['jilava_Y_cu_sarbatori', y, '2026-11-02', {}],
  ['jilava_Y_fara_sarbatori', y, '2026-11-02', { fara_sarbatori_legale: true }],
  ['sintetic_sf_lag_opriri', s, '2026-12-07', { opriri: [{ de: '2026-12-21', pana: '2027-01-08', motiv: 'oprire iarnă' }], lucratoare_suplimentare: ['2026-12-12', '2026-12-19'] }],
]
for (const [nume, g, start, calendar] of probe) {
  const r = calculeazaGrafic({ mod: 'schita', data_start: start, termen: { tip: 'luni', valoare: 3 }, activitati: g.activitati, legaturi: g.legaturi, parametri: { calendar } })
  if (!r.calculat) throw new Error(`${nume}: graficul nu s-a calculat: ${r.probleme.map(p => p.cod).join(', ')}`)
  writeFileSync(join(iesire, `${nume}.xml`), genereazaMSPDI(r, { titlu: `Probă motor grafic — ${nume}`, fisier: nume }))
  writeFileSync(join(iesire, `${nume}.json`), JSON.stringify({ start: r.prima_zi_lucratoare, final: r.data_final, pozitii: r.pozitii.map(p => ({ cod: p.cod, rezumat: p.rezumat, jalon: p.jalon, durata: p.durata, marja: p.marja, start: p.start_moment, final: p.final_moment, ls: p.ls_moment, lf: p.lf_moment })) }, null, 1))
  console.log(`${nume}: ${r.pozitii.length} poziții, final ${r.data_final}, ${r.durata_zile_lucratoare} zile lucrătoare`)
}
