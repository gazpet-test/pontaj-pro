import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  SURSE_ADMIN, areAccesAdministrator, areAccesSursa, ziBucuresti, zileRamase,
  alerteOfertare, alerteHr, alerteFirma, alerteFlota, alerteGbeAdmin,
  citesteToate, incarcaSursaAdmin, statusuriTransport,
} from './adminAlerte.js'

const today = '2026-09-22'
const now = new Date('2026-09-22T12:00:00Z')
const owner = { id: 'owner', is_owner: true, module_access: ['admin_alerte'] }
const source = id => SURSE_ADMIN.find(s => s.id === id)

describe('Acces explicit, fără efecte asupra drepturilor', () => {
  it('nu acceptă owner, administrator sau HR fără cheia explicită', () => {
    for (const p of [null, { id: 'x', is_owner: true }, { id: 'x', can_modify_employees: true }, { id: 'x', role: 'superadmin' }, { id: 'x', module_access: ['admin_alerte.orice'] }]) expect(areAccesAdministrator(p)).toBe(false)
    expect(areAccesAdministrator(owner)).toBe(true)
  })
  it('cheia transversală nu acordă acces la sursele financiare', () => {
    const p = { id: 'x', module_access: ['admin_alerte', 'hr', 'administrativ.documente'] }
    expect(areAccesSursa(p, source('hr'))).toBe(true)
    expect(areAccesSursa(p, source('firma'))).toBe(true)
    expect(areAccesSursa(p, source('gbe'))).toBe(false)
    expect(areAccesSursa({ ...p, module_access: ['admin_alerte', 'administrativ.furnizori'] }, source('firma'))).toBe(false)
  })
  it('nu face query când accesul lipsește', async () => {
    const client = { from: vi.fn() }
    const result = await incarcaSursaAdmin(client, source('gbe'), { id: 'x', module_access: ['admin_alerte'] })
    expect(result.state).toBe('denied'); expect(client.from).not.toHaveBeenCalled()
  })
  it('meniul și ruta folosesc cheia nouă, iar adaptorii nu au mutații', () => {
    const app = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8')
    expect(app).toContain('path="/administrator" element={<ProtectedRoute requireModule={ADMIN_ALERTE_KEY}>')
    expect(app).toContain('if (moduleName === ADMIN_ALERTE_KEY) return areAccesAdministrator(profile)')
    for (const file of ['./adminAlerte.js', './AdministratorAlerte.jsx']) {
      expect(readFileSync(new URL(file, import.meta.url), 'utf8')).not.toMatch(/\.(insert|update|upsert|delete|rpc|invoke)\(/)
    }
  })
})

describe('Termene, stări și excluderi', () => {
  it('folosește ziua României, inclusiv la miezul nopții și schimbarea orei', () => {
    expect(ziBucuresti(new Date('2026-09-21T22:30:00Z'))).toBe(today)
    expect(zileRamase('2026-10-26', '2026-10-24')).toBe(2)
    expect(zileRamase('2026-02-30', today)).toBeNull()
    expect(zileRamase(null, today)).toBeNull()
  })
  it('nu marchează documentul valabil până azi ca expirat', () => {
    const [row] = alerteFirma([{ id: 1, activ: true, data_valabilitate: today }], today)
    expect(row.priority).toBe('week'); expect(row.impact).toContain('astăzi')
  })
  it('exclude certificate de reemis, nelimitate și documente inactive', () => {
    expect(alerteFirma([
      { id: 1, activ: true, se_reemite: true, data_valabilitate: '2020-01-01' },
      { id: 2, activ: true, fara_expirare: true }, { id: 3, activ: false },
    ], today)).toEqual([])
  })
  it('date lipsă rămâne distinct de critic și valid', () => {
    expect(alerteFirma([{ id: 1, activ: true }], today)[0].priority).toBe('missing')
    expect(alerteHr([{ id: 2 }], today)[0].priority).toBe('missing')
  })
  it('verifică viza RSVTI și când autorizația este fără expirare', () => {
    const result = alerteHr([{ id: 1, fara_expirare: true, necesita_confirmare_rsvti: true, rsvti_urmatoarea_confirmare: '2026-09-21' }], today)
    expect(result).toHaveLength(1); expect(result[0].id).toBe('hr:1:viza'); expect(result[0].priority).toBe('critical')
  })
  it('licitația GO fără responsabil are o singură alertă cu ambele cauze', () => {
    const [row] = alerteOfertare([{ id: 1, status: 'go', termen_depunere: '2026-09-24T12:00:00Z' }], now)
    expect(row.priority).toBe('critical'); expect(row.impact).toContain('Responsabil neatribuit')
  })
  it('termenul licitației se compară la ora exactă; stările închise sunt excluse', () => {
    const base = { id: 1, status: 'in_lucru', responsabil_id: 'x', termen_depunere: '2026-09-22T11:59:00Z' }
    expect(alerteOfertare([base], now)[0].priority).toBe('critical')
    expect(alerteOfertare([{ ...base, termen_depunere: '2026-09-22T12:01:00Z' }], now)[0].priority).toBe('week')
    for (const status of ['depusa', 'castigata', 'pierduta', 'abandonata']) expect(alerteOfertare([{ ...base, status }], now)).toEqual([])
    expect(alerteOfertare([{ ...base, decizie_go: 'no_go' }], now)).toEqual([])
  })
  it('o licitație identificată încă nu este o depunere asumată', () => {
    expect(alerteOfertare([{ id: 1, status: 'identificata', termen_depunere: '2026-09-20T12:00:00Z' }], now)[0].priority).toBe('week')
  })
  it('exclude active vândute, deep-sleep și documente ale altor entități', () => {
    const docs = [1, 2, 3, 4].map(id => ({ id, active_id: id, data_expirare: '2026-09-20' }))
    const assets = [{ id: 1, vandut: true }, { id: 2, deep_sleep: true }, { id: 3 }, { id: 4 }]
    docs[3].entitate_tip = 'personal'
    const result = alerteFlota(docs, assets, [], today)
    expect(result.map(r => r.id)).toEqual(['flota:3'])
  })
  it('estimarea GBE depășită nu devine scadență contractuală critică', () => {
    const row = { contract_id: 1, status: 'activ', gbe_ramas: '84000', gbe_data_estimata_recuperare: '2026-09-20' }
    const result = alerteGbeAdmin([row], [], [], today)
    expect(result[0].priority).toBe('attention'); expect(result[0].estimated).toBe(true)
    expect(result[0].amount).toBe(84000)
    expect(alerteGbeAdmin([{ ...row, gbe_ramas: 0 }], [], [], today)).toEqual([])
    expect(alerteGbeAdmin([{ ...row, status: 'reziliat' }], [], [], today)).toEqual([])
  })
  it('include polița fără sold de reținere, dar nu pe un contract reziliat', () => {
    const policy = { id: 1, contract_id: 2, activ: true, data_expirare: '2026-09-21' }
    expect(alerteGbeAdmin([], [policy], [{ id: 2, status: 'activ' }], today)[0].priority).toBe('critical')
    expect(alerteGbeAdmin([], [policy], [{ id: 2, status: 'reziliat' }], today)).toEqual([])
  })
  it('păstrează pașii existenți ai aprobării transporturilor', () => {
    expect(statusuriTransport({ name: 'Cristiana Pușcașu' })).toEqual(['aprobata_mitrache'])
    expect(statusuriTransport({ name: 'Alexandru Mitrache' })).toEqual(['submitata'])
    expect(statusuriTransport(owner)).toHaveLength(2)
    expect(statusuriTransport({ name: 'Alt coleg' })).toEqual([])
  })
})

describe('Citire completă și erori reale', () => {
  function query(response) { return { range: () => ({ abortSignal: async () => response }) } }
  it('paginează peste limita implicită a API-ului', async () => {
    const responses = [{ data: Array.from({ length: 500 }, (_, id) => ({ id })), count: 501 }, { data: [{ id: 500 }], count: 501 }]
    expect(await citesteToate(() => query(responses.shift()))).toHaveLength(501)
  })
  it('nu returnează succes parțial după eroare pe a doua pagină', async () => {
    const responses = [{ data: Array(500).fill({}), count: 600 }, { data: null, error: { code: '42501' } }]
    await expect(citesteToate(() => query(responses.shift()))).rejects.toMatchObject({ code: '42501' })
  })
  it('respinge trunchierea, depășirea limitei și lipsa numărului total', async () => {
    for (const response of [{ data: [{}], count: 501 }, { data: [{}], count: 20001 }, { data: [] }]) await expect(citesteToate(() => query(response))).rejects.toBeTruthy()
  })
  it('zero rânduri vizibile este un rezultat valid, fără a pretinde acoperire globală', async () => {
    expect(await citesteToate(() => query({ data: [], count: 0 }))).toEqual([])
  })
  it('eroarea unei surse este separată de zero alerte', async () => {
    const builder = { select: () => builder, in: () => builder, order: () => builder, ...query({ data: null, error: { code: 'PGRST200' } }) }
    const result = await incarcaSursaAdmin({ from: () => builder }, source('ofertare'), owner, { now })
    expect(result.state).toBe('error'); expect(result.rows).toEqual([]); expect(result.evaluatedAt).toBeUndefined()
  })
})
