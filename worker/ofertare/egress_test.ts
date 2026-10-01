// deno test -A worker/ofertare/egress_test.ts — poarta + jurnalul monitorului de egress (fără rețea)
import { MESAJ_BLOCAT, descarcaCuJurnal } from './egress.ts'

const eq = (a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`) }
const fake = (blocat: boolean | 'eroare') => {
  const n = { dl: 0, log: [] as any[] }
  return { n, supa: {
    rpc: async (fn: string, a: any) => {
      if (fn === 'egress_obiect_blocat') return blocat === 'eroare' ? { data: null, error: { message: 'function does not exist' } } : { data: blocat, error: null }
      if (fn === 'egress_log_descarcare') { n.log.push(a); return { data: 1, error: null } }
      throw new Error('rpc neașteptat ' + fn)
    },
    storage: { from: () => ({ download: async () => { n.dl++; return { data: new Blob([new Uint8Array(1234)]), error: null } } }) },
  } }
}

Deno.test('obiect blocat → fără descărcare, fără jurnal, eroare explicită', async () => {
  const f = fake(true)
  const r = await descarcaCuJurnal(f.supa, 'ofertare', 'a.pdf', 'nas:ingest', 770)
  eq([f.n.dl, f.n.log.length, r.error?.message], [0, 0, MESAJ_BLOCAT])
})
Deno.test('obiect liber → descărcare + un rând de jurnal cu mărimea reală', async () => {
  const f = fake(false)
  const r = await descarcaCuJurnal(f.supa, 'ofertare', 'a.pdf', 'nas:ingest', 770)
  eq([f.n.dl, r.error, f.n.log], [1, null, [{ p_bucket: 'ofertare', p_obiect: 'a.pdf', p_bytes: 1234, p_sursa: 'nas:ingest', p_doc_id: 770 }]])
})
Deno.test('RPC lipsă (migrare neaplicată) → fail-open, descărcarea merge', async () => {
  const f = fake('eroare')
  const r = await descarcaCuJurnal(f.supa, 'ofertare', 'a.pdf', 'edge:ofertare-ingest-doc')
  eq([f.n.dl, r.error], [1, null])
})
