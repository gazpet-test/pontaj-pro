import { describe, it, expect } from 'vitest'
import { scrieImport } from './importTgz.js'

// Parcela existenta: exercita scrierea reala fara rezervare de numere.
function client() {
  const inserari = []
  const persoane = []
  return {
    inserari,
    from(tabela) {
      let operatie = 'select'; let payload; let start = 0
      const q = {
        insert(v) { operatie = 'insert'; payload = v; return q },
        update(v) { operatie = 'update'; payload = v; return q },
        select() { return q }, eq() { return q }, in() { return q }, is() { return q },
        range(a) { start = a; return q }, single() { return q },
        then(resolve, reject) {
          let data = []
          if (operatie === 'insert') {
            inserari.push({ tabela, payload })
            if (tabela === 'red_import_loturi') data = { id: 'lot-test' }
            if (tabela === 'red_detinatori') for (const [i, d] of payload.entries()) persoane.push({ ...d, id: `det-${i}` })
          } else if (operatie === 'select' && start === 0) {
            if (tabela === 'red_parcele') data = [{ id: 'parcela-test', id_parcela: 'TST-0001', cheie_sursa: 'TST|HG1|CF1|' }]
            if (tabela === 'red_detinatori') data = [...persoane]
          }
          return Promise.resolve({ data, error: null }).then(resolve, reject)
        },
      }
      return q
    },
  }
}

describe('scrieImport - atribute detinator', () => {
  it('persista decedat strict boolean si actul cunoscut DA/NU/necunoscut', async () => {
    const db = client()
    const intrari = [
      { decedat: true, act_doveditor_cunoscut: true },
      { decedat: false, act_doveditor_cunoscut: false },
      { decedat: 'DA', act_doveditor_cunoscut: null },
      {}, // TGZ vechi: decedat false, act necunoscut NULL.
    ]
    const preview = {
      parcele: [{ cheie: 'p', cheie_sursa: 'TST|HG1|CF1|', uat3: 'TST', tronson: 3 }],
      detinatori: intrari.map((d, i) => ({ ...d, cheie: `d${i}`, cheie_parcela: 'p', nume: `TEST ${i}`, nume_normalizat: `TEST ${i}`, calitate: 'proprietar' })),
      contacte: [],
      proiect_id_previzualizare: 'proiect-test',   // r6: previzualizarea e legată de proiect (Anexa 7: fără numitor de rânduri)
    }
    const rezultat = await scrieImport(db, preview, { proiectId: 'proiect-test', versiune: 'TEST', sursa: 'ANEXA7' })
    expect(rezultat.detinatoriNoi).toBe(4)
    const scrise = db.inserari.filter(x => x.tabela === 'red_detinatori').flatMap(x => x.payload)
    expect(scrise.map(d => [d.decedat, d.act_doveditor_cunoscut])).toEqual([[true, true], [false, false], [false, null], [false, null]])
    expect(scrise.every(d => d.parcela_id === 'parcela-test')).toBe(true)
  })
})
