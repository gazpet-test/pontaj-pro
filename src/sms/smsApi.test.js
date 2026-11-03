// r2 (P1, 20261130b): ecranul SMS citește istoricul și mesajele DOAR prin RPC-uri (telefon mascat din BD), niciodată direct din
// sms_mesaje / sms_v_loturi (acolo telefonul e în clar, iar citirea directă rămâne a owner-ului).
import { describe, expect, it, vi } from 'vitest'

const apeluri = []
vi.mock('../lib/supabase.js', () => ({
  supabase: {
    rpc: async (fn, args) => {
      apeluri.push(['rpc', fn, args])
      if (fn === 'fn_sms_loturi_lista') return { data: [{ id: 'l1', n_in_coada: 2, actiune_permisa: true }], error: null }
      if (fn === 'fn_sms_lot_destinatari') return { data: { lot_id: args.p_lot_id, destinatari: [{ mesaj_id: 'm1', telefon_mascat: '07** *** 001', stare: 'in_coada' }] }, error: null }
      return { data: null, error: { code: '42883' } }
    },
    from: tabel => { apeluri.push(['from', tabel]); throw new Error('citire directă interzisă: ' + tabel) },
  },
}))
const { smsApi } = await import('./smsApi.js')

describe('smsApi — istoricul și mesajele prin RPC', () => {
  it('loturi = fn_sms_loturi_lista (cu numărători și actiune_permisa din BD)', async () => {
    const l = await smsApi.loturi()
    expect(l[0]).toMatchObject({ id: 'l1', n_in_coada: 2, actiune_permisa: true })
    expect(apeluri).toContainEqual(['rpc', 'fn_sms_loturi_lista', { p_limit: 50 }])
  })
  it('mesaje = destinatarii din fn_sms_lot_destinatari, cu telefon mascat; fără niciun from(sms_*)', async () => {
    const m = await smsApi.mesaje('l1')
    expect(m).toEqual([{ mesaj_id: 'm1', telefon_mascat: '07** *** 001', stare: 'in_coada' }])
    expect(JSON.stringify(m)).not.toMatch(/\+407/)
    expect(apeluri.filter(([t, x]) => t === 'from' && ['sms_mesaje', 'sms_v_loturi', 'sms_loturi'].includes(x))).toEqual([])
  })
})
