import { describe, it, expect } from 'vitest'
import { bucatiPeLinii, salveazaLiniiBon } from './bonLinii.js'

// client supabase simulat: înregistrează apelurile; „registru” = bucățile protejate; insertEroare = refuz la inserare
function dbFals({ registru = [], insertEroare = null } = {}) {
  const jurnal = []
  return {
    jurnal,
    rpc: async (fn, { p_bucata }) => { jurnal.push(['rpc', p_bucata]); return { data: registru.includes(p_bucata), error: null } },
    from: () => ({
      insert: async rows => { jurnal.push(['insert', rows.length]); return { error: insertEroare } },
      delete: () => ({ eq: () => ({ in: async (_c, ids) => { jurnal.push(['delete', ids]); return { error: null } } }) }),
    }),
  }
}

describe('salveazaLiniiBon', () => {
  const mixt = [{ bon_id: 7, magazie_bucata_id: 11 }, { bon_id: 7, magazie_bucata_id: 12 }, { bon_id: 7, magazie_bucata_id: null, denumire: 'cot' }]
  it('bon mixt cu o bucată din registru → refuz înainte de orice scriere, liniile vechi neatinse', async () => {
    const db = dbFals({ registru: [12] })
    const r = await salveazaLiniiBon(db, 7, mixt, [1, 2])
    expect(r).toMatchObject({ ok: false, motiv: 'registru', protejate: [12] })
    expect(db.jurnal.some(([op]) => op === 'insert' || op === 'delete')).toBe(false)
  })
  it('inserarea refuzată (ex. trigger) → liniile vechi rămân', async () => {
    const db = dbFals({ insertEroare: { message: 'izo: bucata 11 e țeavă Transgaz' } })
    const r = await salveazaLiniiBon(db, 7, mixt, [1, 2])
    expect(r.ok).toBe(false)
    expect(db.jurnal.some(([op]) => op === 'delete')).toBe(false)
  })
  it('totul în regulă → inserare, apoi ștergerea liniilor vechi după id', async () => {
    const db = dbFals()
    expect(await salveazaLiniiBon(db, 7, mixt, [1, 2])).toEqual({ ok: true })
    const ops = db.jurnal.filter(([op]) => op !== 'rpc')
    expect(ops).toEqual([['insert', 3], ['delete', [1, 2]]])
  })
  it('bon nou: fără ștergere', async () => {
    const db = dbFals()
    await salveazaLiniiBon(db, 7, mixt, [])
    expect(db.jurnal.some(([op]) => op === 'delete')).toBe(false)
  })
  it('bucatiPeLinii: unice, fără null', () => {
    expect(bucatiPeLinii([{ magazie_bucata_id: 3 }, { magazie_bucata_id: '3' }, { magazie_bucata_id: null }])).toEqual([3])
  })
})
