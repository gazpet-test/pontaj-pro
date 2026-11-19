// Panoul „Verificare AI (a doua opinie)” din previzualizarea importului TGZ (pasul 2, 19.11.2026). Harness de hook-uri ca în importTgzRender.test.jsx,
// fără DOM; date FICTIVE; funcția edge și RPC-ul sunt mock-uite (niciun apel real).
import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'

const hooks = vi.hoisted(() => ({ current: null }))
const sb = vi.hoisted(() => ({ rpc: null, invoke: null, apeluriRpc: [], apeluriInvoke: [] }))
vi.mock('react', async original => {
  const real = await original()
  return { ...real,
    useState: v => hooks.current ? hooks.current.state(v) : real.useState(v),
    useRef: v => hooks.current ? hooks.current.ref(v) : real.useRef(v),
    useEffect: (f, d) => hooks.current ? hooks.current.effect(f, d) : real.useEffect(f, d),
    useMemo: (f, d) => hooks.current ? f() : real.useMemo(f, d),
  }
})
vi.mock('../../lib/supabase.js', () => ({ supabase: {
  rpc: (fn, args) => { sb.apeluriRpc.push([fn, args]); return sb.rpc(fn, args) },
  functions: { invoke: (fn, opt) => { sb.apeluriInvoke.push([fn, opt]); return sb.invoke(fn, opt) } },
} }))
afterEach(() => { hooks.current = null; vi.unstubAllGlobals(); sb.apeluriRpc = []; sb.apeluriInvoke = [] })

import VerificareAiImport from './VerificareAiImport.jsx'

function harness() {
  const valori = [], efecte = []
  let index = 0
  const h = {
    valori,
    state: initial => {
      const i = index++
      if (!(i in valori)) valori[i] = typeof initial === 'function' ? initial() : initial
      return [valori[i], v => { valori[i] = typeof v === 'function' ? v(valori[i]) : v }]
    },
    ref: initial => { const i = index++; return valori[i] || (valori[i] = { current: initial }) },
    effect: (f, deps) => {
      const i = index++
      if (!efecte[i] || deps.some((v, j) => v !== efecte[i].deps[j])) { efecte[i]?.curata?.(); efecte[i] = { deps, curata: f() } }
    },
    render: (component, props) => { index = 0; hooks.current = h; return component(props) },
    unmount: () => { for (const e of efecte) e?.curata?.() },
  }
  return h
}
const elemente = (node, tip) => {
  if (!node || typeof node !== 'object') return []
  if (Array.isArray(node)) return node.flatMap(n => elemente(n, tip))
  return [...(node.type === tip ? [node] : []), ...elemente(node.props?.children, tip)]
}
const text = node => !node ? '' : typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children)
const asteapta = () => new Promise(r => setTimeout(r, 0))
const P = '11111111-1111-4111-8111-111111111111'
// 150 de valori unice → 2 bucăți (100 + 50); valori FICTIVE
const preview = () => ({ proiect_id_previzualizare: P, de_verificat: [], identificare: Array.from({ length: 150 }, (_, k) => ({
  rand: k + 2, uat: 'FIC', nr_crt: String(k + 1), cheie_parcela: `FIC:${k + 1}`, poz_hg: String(100 + k), nr_cadastral: k === 7 ? 'IONESCU ANA' : String(5000 + k), tarla: 'T ' + k })) })
const fisier = { arrayBuffer: async () => new TextEncoder().encode('excel fictiv').buffer }
const props = (pv, extra = {}) => ({ proiect: { id: P, cod: 'TEST-FIC' }, preview: pv, fisier, fisierNume: 'fictiv.xlsx', show: vi.fn(), onSemnale: vi.fn(), ...extra })
const pornit = async (rpc, pv = preview(), extra = {}) => {
  sb.rpc = rpc
  const h = harness(); const p = props(pv, extra)
  h.render(VerificareAiImport, p); await asteapta()
  return { h, p, tree: h.render(VerificareAiImport, p) }
}
const butonAi = tree => elemente(tree, 'button').find(b => text(b).includes('Verificare AI'))

describe('panoul AI — butonul apare DOAR cu dreptul pe proiect', () => {
  it('fără drept (RPC = false) → nimic afișat (butonul ascuns)', async () => {
    const { tree } = await pornit(async () => ({ data: false, error: null }))
    expect(tree).toBeNull()
    expect(sb.apeluriRpc).toEqual([['fn_red_import_ai_poate', { p_proiect: P }]])
  })
  it('RPC lipsă (migrarea neaplicată) → nimic; altă eroare → avertisment, fără buton (eroare ≠ „fără drept”)', async () => {
    expect((await pornit(async () => ({ data: null, error: { code: 'PGRST202' } }))).tree).toBeNull()
    const { tree } = await pornit(async () => ({ data: null, error: { code: '500', message: 'x' } }))
    expect(text(tree)).toMatch(/nu am putut citi dreptul/)
    expect(butonAi(tree)).toBeUndefined()
  })
  it('cu drept → butonul și costul MAXIM estimat înainte de pornire; ce se trimite e spus', async () => {
    const { tree } = await pornit(async () => ({ data: true, error: null }))
    expect(text(butonAi(tree))).toBe('🤖 Verificare AI (a doua opinie)')
    expect(text(tree)).toMatch(/Cost estimat: cel mult/)
    expect(text(tree)).toMatch(/150 valori unice din 150 rânduri, 2 apeluri/)
    expect(text(tree)).toMatch(/fără nume \/ adrese \/ contacte/)
  })
  it('previzualizare fără valori de identificare → nimic de pornit', async () => {
    expect((await pornit(async () => ({ data: true, error: null }), { identificare: [] })).tree).toBeNull()
  })
})

describe('panoul AI — pornirea (plătită)', () => {
  const ok = semnale => async () => ({ data: { cod: 'ok', semnale, respinse: 0, cost_usd: 0.003, jurnal_confirmat: true }, error: null })
  it('fără confirmare → niciun apel', async () => {
    const { tree } = await pornit(async () => ({ data: true, error: null }))
    vi.stubGlobal('window', { confirm: () => false })
    sb.invoke = vi.fn()
    await butonAi(tree).props.onClick(); await asteapta()
    expect(sb.apeluriInvoke).toEqual([])
  })
  it('confirmat → câte un apel pe bucată, corpul are DOAR cheile contractului (rândurile: i + cele trei câmpuri); semnalele merg în previzualizare', async () => {
    const pv = preview()
    const { tree, p } = await pornit(async () => ({ data: true, error: null }), pv)
    vi.stubGlobal('window', { confirm: () => true })
    let n = 0
    sb.invoke = async () => (n++ === 0 ? ok([{ i: 7, camp: 'nr_cadastral', categorie: 'nume_persoana', motiv: 'pare un nume de persoană' }]) : ok([]))()
    await butonAi(tree).props.onClick(); await asteapta()
    expect(sb.apeluriInvoke.map(([fn]) => fn)).toEqual(['redari-import-verificare-ai', 'redari-import-verificare-ai'])
    for (const [, { body }] of sb.apeluriInvoke) {
      expect(Object.keys(body).sort()).toEqual(['bucata', 'bucati', 'cheie', 'fisier_sha256', 'proiect_id', 'randuri'])
      expect(body.proiect_id).toBe(P); expect(body.bucati).toBe(2); expect(body.fisier_sha256).toMatch(/^[0-9a-f]{64}$/)
      for (const r of body.randuri) expect(Object.keys(r).sort()).toEqual(['i', 'nr_cadastral', 'poz_hg', 'tarla'])
    }
    expect(sb.apeluriInvoke.map(([, o]) => [o.body.bucata, o.body.randuri.length])).toEqual([[1, 100], [2, 50]])
    expect(sb.apeluriInvoke[0][1].body.cheie).not.toBe(sb.apeluriInvoke[1][1].body.cheie)   // o cheie de intenție pe bucată
    expect(JSON.stringify(sb.apeluriInvoke)).not.toMatch(/"rand"|"uat"|"nr_crt"|cheie_parcela/)
    expect(p.onSemnale).toHaveBeenCalledTimes(1)
    const [pvArg, intrari, rez] = p.onSemnale.mock.calls[0]
    expect(pvArg).toBe(pv)
    expect(intrari).toEqual([{ rand: 9, uat: 'FIC', nr_crt: '8', cheie_parcela: 'FIC:8', camp: 'nr_cadastral', motive: ['ai_nume_persoana'], motiv: 'nr. cadastral / parcelă: AI: pare nume de persoană / firmă', sursa: 'ai' }])
    expect(rez).toMatchObject({ complet: true, bucati: 2, facute: 2, semnale: 1, randuri_semnalate: 1, respinse: 0, oprit: null })
  })
  it('un refuz / rezultat necunoscut la bucata 1 → bucla se OPREȘTE (fără reluare), nimic aplicat; la bucata 2 → rezultat parțial, marcat incomplet', async () => {
    let r = await pornit(async () => ({ data: true, error: null }))
    vi.stubGlobal('window', { confirm: () => true })
    sb.invoke = async () => ({ data: null, error: { context: { json: async () => ({ cod: 'plafon_cost_zi' }) } } })
    await butonAi(r.tree).props.onClick(); await asteapta()
    expect(sb.apeluriInvoke).toHaveLength(1); expect(r.p.onSemnale).not.toHaveBeenCalled()
    expect(r.p.show).toHaveBeenCalledWith(expect.stringMatching(/INCOMPLETĂ \(0 din 2/), 'error')
    sb.apeluriInvoke = []
    r = await pornit(async () => ({ data: true, error: null }))
    let n = 0
    sb.invoke = async () => (n++ === 0 ? ok([])() : { data: null, error: { context: { json: async () => ({ cod: 'ai_necunoscut' }) } } })
    await butonAi(r.tree).props.onClick(); await asteapta()
    expect(sb.apeluriInvoke).toHaveLength(2)
    expect(r.p.onSemnale.mock.calls[0][2]).toMatchObject({ complet: false, facute: 1, oprit: 'ai_necunoscut' })
  })
  it('ecranul închis în timpul buclei → niciun apel în plus, nimic aplicat (L24)', async () => {
    const { h, tree, p } = await pornit(async () => ({ data: true, error: null }))
    vi.stubGlobal('window', { confirm: () => true })
    let elibereaza
    sb.invoke = () => new Promise(res => { elibereaza = () => res({ data: { cod: 'ok', semnale: [], respinse: 0, cost_usd: 0.001, jurnal_confirmat: true }, error: null }) })
    const rulare = butonAi(tree).props.onClick(); await asteapta(); await asteapta()
    expect(sb.apeluriInvoke).toHaveLength(1)
    h.unmount(); elibereaza(); await rulare; await asteapta()
    expect(sb.apeluriInvoke).toHaveLength(1)
    expect(p.onSemnale).not.toHaveBeenCalled()
  })
})
