// r2 (P1, 20261130b): ecranul SMS citește istoricul și mesajele DOAR prin RPC-uri (telefon mascat din BD), niciodată direct din
// sms_mesaje / sms_v_loturi (acolo telefonul e în clar, iar citirea directă rămâne a owner-ului).
import { describe, expect, it, vi } from 'vitest'

const apeluri = []
vi.mock('../lib/supabase.js', () => ({
  supabase: {
    rpc: async (fn, args) => {
      apeluri.push(['rpc', fn, args])
      if (fn === 'fn_sms_loturi_lista') return { data: [{ id: 'l1', n_in_coada: 2, actiune_permisa: true }], error: null }
      if (fn === 'fn_sms_lot_redari_sablon_creeaza') return { data: { text_final: 'T', nr_destinatari: 2, preview: args.p_doar_preview }, error: null }
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

describe('smsApi — lotul Redări din șablon (20261130c)', () => {
  it('previzualizarea: RPC-ul șablonului, fără text (îl face BD-ul), UAT obligatoriu trimis', async () => {
    await smsApi.creeazaRedariSablon({ proiectId: 'p1', uatId: 'u1', textAfisat: 'ignorat', preview: true })
    expect(apeluri).toContainEqual(['rpc', 'fn_sms_lot_redari_sablon_creeaza', { p_proiect_id: 'p1', p_uat_id: 'u1', p_text_afisat: null, p_set_hash: null, p_doar_preview: true }])
  })
  it('crearea: trimite textul afișat și set_hash-ul listei, ca BD-ul să refuze dacă s-a schimbat', async () => {
    const j = await smsApi.creeazaRedariSablon({ proiectId: 'p1', uatId: 'u1', textAfisat: 'Gazpet pt Transgaz: ...', setHash: 'h1', preview: false })
    expect(j.preview).toBe(false)
    expect(apeluri).toContainEqual(['rpc', 'fn_sms_lot_redari_sablon_creeaza', { p_proiect_id: 'p1', p_uat_id: 'u1', p_text_afisat: 'Gazpet pt Transgaz: ...', p_set_hash: 'h1', p_doar_preview: false }])
  })
  it('fără preview explicit = previzualizare (fail-closed); textul liber nu mai există în API', async () => {
    await smsApi.creeazaRedariSablon({ proiectId: 'p1', uatId: 'u2' })
    expect(apeluri).toContainEqual(['rpc', 'fn_sms_lot_redari_sablon_creeaza', { p_proiect_id: 'p1', p_uat_id: 'u2', p_text_afisat: null, p_set_hash: null, p_doar_preview: true }])
    expect(smsApi.creeazaRedari).toBeUndefined()
    expect(apeluri.some(([, fn]) => fn === 'fn_sms_lot_redari_creeaza')).toBe(false)
  })
  it('eroarea BD ajunge la apelant (nu listă goală)', async () => {
    await expect(smsApi.aproba('x', 1)).rejects.toMatchObject({ code: '42883' })
  })
})
