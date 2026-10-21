import { describe, it, expect } from 'vitest'
import { bucatiPeLinii, bucatiProtejate, salveazaLiniiBon } from './bonLinii.js'

// BD simulată pentru executie_bonuri_consum_linii: stare reală (liniile), registru, refuzuri și o ștergere „filtrată”
function dbFals({ linii = [], registru = [], insertEroare = null, deleteEroare = null, deleteFiltrat = false } = {}) {
  let urm = Math.max(999, ...linii.map(l => l.id)) + 1
  const st = { linii: linii.map(l => ({ ...l })), jurnal: [] }
  const tabel = () => ({
    select: () => ({ eq: async (_c, bonId) => ({ data: st.linii.filter(l => l.bon_id === bonId).map(l => ({ id: l.id })), error: null }) }),
    insert: async rows => {
      st.jurnal.push(['insert', rows.length])
      if (insertEroare) return { error: insertEroare }
      for (const r of rows) st.linii.push({ ...r, id: urm++ })
      return { error: null }
    },
    delete: () => ({ eq: (_c, bonId) => ({ in: (_c2, ids) => ({ select: async () => {
      st.jurnal.push(['delete', ids])
      if (deleteEroare) return { data: null, error: deleteEroare }
      const tinta = st.linii.filter(l => l.bon_id === bonId && ids.includes(l.id)).slice(0, deleteFiltrat ? 1 : undefined)
      st.linii = st.linii.filter(l => !tinta.includes(l))
      return { data: tinta.map(l => ({ id: l.id })), error: null }
    } }) }) }),
  })
  return {
    st,
    rpc: async (_fn, { p_bucata }) => ({ data: registru.includes(p_bucata), error: null }),
    from: () => tabel(),
  }
}
const vechi = [{ id: 1, bon_id: 7, denumire: 'vechi1' }, { id: 2, bon_id: 7, denumire: 'vechi2' }]
const mixt = [{ bon_id: 7, magazie_bucata_id: 11 }, { bon_id: 7, magazie_bucata_id: 12 }, { bon_id: 7, magazie_bucata_id: null, denumire: 'cot' }]

describe('salveazaLiniiBon', () => {
  it('bon mixt cu o bucată din registru → refuz înainte de orice scriere', async () => {
    const db = dbFals({ linii: vechi, registru: [12] })
    expect(await salveazaLiniiBon(db, 7, mixt)).toMatchObject({ ok: false, motiv: 'registru', protejate: [12] })
    expect(db.st.jurnal).toEqual([])
    expect(db.st.linii.map(l => l.id)).toEqual([1, 2])
  })
  it('inserarea refuzată → liniile vechi rămân, nicio ștergere', async () => {
    const db = dbFals({ linii: vechi, insertEroare: { message: 'izo: refuz' } })
    expect((await salveazaLiniiBon(db, 7, mixt)).ok).toBe(false)
    expect(db.st.linii.map(l => l.id)).toEqual([1, 2])
  })
  it('succes: rămân exact liniile noi', async () => {
    const db = dbFals({ linii: vechi })
    expect(await salveazaLiniiBon(db, 7, mixt)).toEqual({ ok: true })
    expect(db.st.linii.length).toBe(3)
    expect(db.st.linii.some(l => l.id === 1 || l.id === 2)).toBe(false)
  })
  it('ștergere refuzată, apoi reîncercare → la final doar setul nou al reîncercării (fără duplicate)', async () => {
    const db = dbFals({ linii: vechi, deleteEroare: { message: 'RLS' } })
    expect((await salveazaLiniiBon(db, 7, mixt)).ok).toBe(false)
    expect(db.st.linii.length).toBe(5)              // vechi + setul nou al primei încercări
    const retry = dbFals({ linii: db.st.linii })     // aceeași stare, fără refuz
    expect(await salveazaLiniiBon(retry, 7, mixt)).toEqual({ ok: true })
    expect(retry.st.linii.length).toBe(3)
  })
  it('ștergerea afectează mai puține rânduri decât trebuia → conflict, nu succes', async () => {
    const db = dbFals({ linii: vechi, deleteFiltrat: true })
    const r = await salveazaLiniiBon(db, 7, mixt)
    expect(r.ok).toBe(false)
    expect(r.motiv).toMatch(/conflict/)
  })
  it('bon nou: fără ștergere', async () => {
    const db = dbFals()
    await salveazaLiniiBon(db, 7, mixt)
    expect(db.st.jurnal.some(([op]) => op === 'delete')).toBe(false)
  })
  it('bucatiProtejate + bucatiPeLinii', async () => {
    expect(await bucatiProtejate(dbFals({ registru: [11] }), mixt)).toEqual([11])
    expect(bucatiPeLinii([{ magazie_bucata_id: 3 }, { magazie_bucata_id: '3' }, { magazie_bucata_id: null }])).toEqual([3])
  })
})
