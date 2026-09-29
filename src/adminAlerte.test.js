import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  SURSE_ADMIN, areAccesAdministrator, areAccesSursa, ziBucuresti, zileRamase,
  alerteOfertare, alerteHr, alerteFirma, alerteFlota, alerteGbeAdmin,
  citesteToate, incarcaSursaAdmin, statusuriTransport,
  alerteConturi, descriereCandidati, PRIORITATE_CONTURI, sorteazaAlerte, SELECT_ADMIN,
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

describe('Conturi platformă (R1/R2): doar owner, numai citire', () => {
  const conturi = source('conturi')
  it('sursa e doar pentru owner cu cheia admin_alerte', () => {
    expect(conturi).toMatchObject({ module: 'admin_alerte', ownerOnly: true, path: '/admin?tab=managers' })
    expect(areAccesSursa(owner, conturi)).toBe(true)
    expect(areAccesSursa({ id: 'o', is_owner: true, module_access: [] }, conturi)).toBe(false)
    expect(areAccesSursa({ id: 'x', is_owner: false, can_modify_employees: true, module_access: ['admin_alerte', 'hr', 'administrativ'] }, conturi)).toBe(false)
    expect(areAccesSursa({ id: 'x', module_access: ['admin_alerte'] }, conturi)).toBe(false)
  })
  it('refuzul nu face nicio citire', async () => {
    const client = { from: vi.fn() }
    const result = await incarcaSursaAdmin(client, conturi, { id: 'x', can_modify_employees: true, module_access: ['admin_alerte', 'hr'] })
    expect(result.state).toBe('denied'); expect(client.from).not.toHaveBeenCalled()
  })
  it('owner-ul citește view-ul cu proiecție explicită, count exact și ordonare după id (fără rpc)', async () => {
    const calls = []
    const builder = {
      select: (cols, opts) => { calls.push(['select', cols, opts]); return builder },
      order: col => { calls.push(['order', col]); return builder },
      range: () => ({ abortSignal: async () => ({ data: [{ id: 'fara_angajat:p1', cod: 'fara_angajat', profile_id: 'p1', email: 'test.ofertare@gazpet.ro', candidati: [] }], count: 1 }) }),
    }
    const from = vi.fn(() => builder)
    const result = await incarcaSursaAdmin({ from }, conturi, owner, { now })
    expect(from).toHaveBeenCalledWith('v_admin_conturi_alerte')
    expect(calls[0]).toEqual(['select', SELECT_ADMIN.v_admin_conturi_alerte, { count: 'exact' }])
    expect(calls[1]).toEqual(['order', 'id'])
    expect(SELECT_ADMIN.v_admin_conturi_alerte).toBe('id,cod,profile_id,email,tip_cont,is_owner,employee_id,employee_name,employee_active,termination_date,banned_until,jurnal_id,inchis_la,candidati,alocari')
    expect(result.state).toBe('ok'); expect(result.rows[0].id).toBe('conturi:fara_angajat:p1')
  })
  it('un refuz 42501 din BD devine „denied”, nu eroare', async () => {
    const builder = { select: () => builder, order: () => builder, range: () => ({ abortSignal: async () => ({ data: null, error: { code: '42501' } }) }) }
    const result = await incarcaSursaAdmin({ from: () => builder }, conturi, owner, { now })
    expect(result.state).toBe('denied')
  })

  const base = { profile_id: 'p1', email: 'x@gazpet.ro', is_owner: false, employee_id: 57, employee_name: 'IOAN SORIN', jurnal_id: null, inchis_la: null, candidati: null, alocari: null }
  const row = (cod, extra = {}) => ({ ...base, id: `${cod}:${extra.profile_id ?? base.profile_id}`, cod, ...extra })

  it('prioritățile din specificație pentru fiecare cod', () => {
    expect(PRIORITATE_CONTURI).toEqual({
      fara_angajat: 'attention', cont_activ_fost_angajat: 'critical', inchis_dar_deblocat: 'critical', inchis_cu_acces_rest: 'critical',
      reactivat_acces_neredat: 'week', alocari_ramase: 'attention', inactiv_fara_data: 'missing',
    })
    const rows = alerteConturi(Object.keys(PRIORITATE_CONTURI).map(cod => row(cod, { jurnal_id: 3 })), today)
    expect(rows.map(r => r.priority)).toEqual(Object.values(PRIORITATE_CONTURI))
    expect(rows.every(r => r.source === 'conturi' && r.id.startsWith('conturi:'))).toBe(true)
    expect(rows.every(r => r.locator.startsWith('v_admin_conturi_alerte · '))).toBe(true)
    expect(alerteConturi([row('cod_nou_necunoscut')], today)).toEqual([])
  })
  it('link direct pe fiecare rând: contul sau fișa de angajat', () => {
    const [cont] = alerteConturi([row('cont_activ_fost_angajat')], today)
    expect(cont.path).toBe('/admin?tab=managers&cont=p1'); expect(cont.owner).toBe('Owner · Admin → Manageri')
    const [fisa] = alerteConturi([row('inactiv_fara_data', { profile_id: null, email: null, id: 'inactiv_fara_data:e57' })], today)
    expect(fisa.path).toBe('/admin?tab=employees&angajat=57'); expect(fisa.owner).toBe('HR · Admin → Angajați')
    expect(fisa.impact).toBe('Completează data încetării sau șterge fișa demo.')
    expect(fisa.reference).toContain('fără cont')
  })
  it('candidații: 0 / 1 ocupat / 2 descriși corect', () => {
    expect(descriereCandidati([])).toBe('niciun candidat')
    expect(descriereCandidati(null)).toBe('niciun candidat')
    expect(descriereCandidati([{ employee_id: 9, employee_name: 'OCUPAT GELU', profil_legat: 'p9' }])).toBe('1 candidat: OCUPAT GELU, are deja cont')
    expect(descriereCandidati([{ employee_id: 9, employee_name: 'LIBER ION', profil_legat: null }])).toBe('1 candidat: LIBER ION')
    expect(descriereCandidati([{ employee_id: 1, employee_name: 'POPESCU MIHAI' }, { employee_id: 2, employee_name: 'POPESCU MIHAI' }])).toBe('2 candidați: POPESCU MIHAI, POPESCU MIHAI')
    const [r] = alerteConturi([row('fara_angajat', { employee_id: null, employee_name: null, candidati: [] })], today)
    expect(r.impact).toContain('Leagă fișa (Editează → Fișă angajat) sau marchează tipul (extern/test/sistem)')
    expect(r.impact).toContain('niciun candidat')
  })
  it('owner-ul e marcat „nu se închide automat”; motivul dezactivării e explicat', () => {
    expect(alerteConturi([row('cont_activ_fost_angajat', { is_owner: true, termination_date: '2026-09-20' })], today)[0].impact).toBe('OWNER: nu se închide automat, decide manual.')
    expect(alerteConturi([row('cont_activ_fost_angajat', { termination_date: null })], today)[0].impact).toContain('fără dată de încetare')
    expect(alerteConturi([row('cont_activ_fost_angajat', { termination_date: '2026-10-05' })], today)[0].impact).toContain('înainte de data încetării (2026-10-05)')
    expect(alerteConturi([row('cont_activ_fost_angajat', { termination_date: '2026-09-20' })], today)[0].impact).toContain('Închide contul acum sau corectează fișa')
  })
  it('acțiunile pentru conturile închise și alocările rămase', () => {
    expect(alerteConturi([row('inchis_dar_deblocat', { jurnal_id: 12 })], today)[0].impact).toBe('Reaplică închiderea sau restaurează formal din jurnal #12.')
    expect(alerteConturi([row('reactivat_acces_neredat', { jurnal_id: 12 })], today)[0].impact).toContain('Restaurează din jurnal #12')
    expect(alerteConturi([row('alocari_ramase', { alocari: { comenzi_aprobatori: 1, hr_aprobatori: 2 } })], today)[0].impact).toBe('Reasignează: comenzi_aprobatori 1, hr_aprobatori 2.')
  })
  it('data alertei: data încetării sau ziua închiderii (România)', () => {
    expect(alerteConturi([row('cont_activ_fost_angajat', { termination_date: '2026-09-25' })], today)[0].date).toBe('2026-09-25')
    expect(alerteConturi([row('inchis_dar_deblocat', { termination_date: null, inchis_la: '2026-09-21T22:30:00Z' })], today)[0].date).toBe('2026-09-22')
  })
  it('sorteazaAlerte funcționează pe rezultat (critice primele)', () => {
    const rows = alerteConturi([row('inactiv_fara_data', { profile_id: 'a' }), row('fara_angajat', { profile_id: 'b' }), row('inchis_cu_acces_rest', { profile_id: 'c', jurnal_id: 1 })], today)
    expect(sorteazaAlerte(rows).map(r => r.priority)).toEqual(['critical', 'attention', 'missing'])
  })
})
