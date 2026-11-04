// Copilot #992 r2 P2-04: 📬 Notificări montat real (react-dom în jsdom) — aceeași instanță, rerender admin → viewer cu datele admin încărcate:
// coloana „Fără telefon” devine „?”, contactul nu se mai citește, exportul nu mai poartă informația de telefon.
// jsdom nu e dependență a proiectului (nu instalăm pachete); se caută în node_modules sau în REDARI_JSDOM_DIR (ca în comuneModal.test.jsx).
// Fără el, suita e SĂRITĂ vizibil.
import React from 'react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'

const { ID, RAND, cereri, descarcari } = vi.hoisted(() => {
  const ID = '00000001-0000-4000-8000-000000000000'
  return { ID, cereri: [], descarcari: [], RAND: { parcela_id: 'p1', detinator_id: ID, uat_id: 'u1', uat3: 'ALF', uat_nume: 'Alfa', id_parcela: 'T1-ALF-0001',
    tronson: 1, nume: 'Persoana Unu', calitate: 'proprietar', adresa_cunoscuta: true, stare: 'DE_CONVOCAT' } }
})
// client fals: fiecare tabel întoarce rândurile lui la prima pagină și [] la pagina următoare (cu .or / .gt = keyset)
vi.mock('../../lib/supabase.js', () => {
  const RANDURI = { red_v_stare_parcela: [RAND], red_detinatori_contact: [{ detinator_id: ID }] }
  const builder = (tabel, rpc) => {
    const st = { filtre: [] }
    const b = new Proxy({}, { get: (_, k) => {
      if (k === 'then') {
        const pagUrm = st.filtre.some(f => f === 'or' || f === 'gt')
        const data = rpc === 'fn_sms_panou' ? { nivel: 'owner', redari_autorizat: false, kill_switch: true } : pagUrm ? [] : (RANDURI[tabel] || [])
        return res => res({ data, error: null })
      }
      return (...a) => { st.filtre.push(k); if (k === 'select') cereri.push(tabel); return b }
    } })
    return b
  }
  return { supabase: { from: t => builder(t), rpc: n => builder(null, n) } }
})
vi.mock('../docx.js', async (orig) => ({ ...(await orig()), descarcaBlob: (blob, nume) => { descarcari.push({ blob, nume }) } }))

import NotificariEcran from './NotificariEcran.jsx'

let JSDOM = null
for (const s of [import.meta.url, process.env.REDARI_JSDOM_DIR && path.join(process.env.REDARI_JSDOM_DIR, 'package.json')].filter(Boolean)) {
  try { JSDOM = createRequire(s)('jsdom').JSDOM; break } catch { /* următoarea sursă */ }
}
const MOTIV_SARIT = 'SĂRIT: lipsește jsdom (nu e dependență a proiectului; rulează cu REDARI_JSDOM_DIR=<dir cu jsdom instalat>)'
if (!JSDOM) console.warn(`[notificariDom.test] ${MOTIV_SARIT}`)
const dom = JSDOM ? describe : describe.skip

let curata = []
afterEach(() => { curata.forEach(f => f()); curata = [] })

dom(JSDOM ? 'NotificariEcran — rerender admin → viewer pe aceeași instanță (jsdom)' : `NotificariEcran DOM — ${MOTIV_SARIT}`, () => {
  it('datele admin nu rămân pentru viewer: „Fără telefon” = „?”, fără citire de contact, export „necunoscut”', async () => {
    const j = new JSDOM('<!doctype html><div id="r"></div>', { pretendToBeVisual: true })
    const vechi = { window: globalThis.window, document: globalThis.document }
    Object.assign(globalThis, { window: j.window, document: j.window.document })
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    const { createRoot } = await import('react-dom/client')
    const { act } = React
    const root = createRoot(j.window.document.getElementById('r'))
    curata.push(() => { act(() => root.unmount()); Object.assign(globalThis, vechi) })
    const d = j.window.document
    const proiect = { id: 'P', cod: 'TEST-P' }, uats = [{ id: 'u1', nume: 'Alfa', uat3: 'ALF' }]
    const ecran = nivel => <NotificariEcran proiect={proiect} uats={uats} nivel={nivel} utilizatorId="U1" subtabInitial="centralizator" />
    const asteapta = async () => { for (let i = 0; i < 20; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }
    const celulaTotal = cheie => {
      const ths = [...d.querySelectorAll('thead th')]
      const i = ths.findIndex(th => th.textContent.startsWith(cheie))
      return d.querySelector('tr[data-total="1"]').children[i].textContent
    }
    const exportCsv = async () => {
      const btn = [...d.querySelectorAll('button')].find(b => b.textContent.includes('Export CSV'))
      await act(async () => { btn.dispatchEvent(new j.window.MouseEvent('click', { bubbles: true })) })
      const t = await descarcari.at(-1).blob.text()
      return t.trim().split('\r\n').map(l => l.split(';'))
    }

    await act(async () => { root.render(ecran('admin')) }); await asteapta()
    expect(cereri).toContain('red_detinatori_contact')
    expect(celulaTotal('Fără telefon')).toBe('0')           // admin: telefonul e cunoscut
    let csv = await exportCsv()
    expect(csv[1][csv[0].indexOf('Fără telefon')]).toBe('NU')

    cereri.length = 0
    await act(async () => { root.render(ecran('viewer')) }); await asteapta()   // aceeași instanță (fără key), alt nivel
    expect(cereri).toContain('red_v_stare_parcela')                 // s-a recitit ca viewer
    expect(cereri).not.toContain('red_detinatori_contact')          // viewer-ul nu citește contactul
    expect(celulaTotal('Fără telefon')).toBe('?')
    expect(d.body.textContent).toContain('Telefon: necunoscut')
    csv = await exportCsv()
    expect(csv[1][csv[0].indexOf('Fără telefon')]).toBe('necunoscut')
  })
})
