// Randare server-side (react-dom/server) a ecranelor UAT + Setări proiect: prinde erorile de randare și verifică ce vede fiecare nivel.
// Efectele (cererile Supabase) nu rulează la renderToString; supabase e oricum simulat.
import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderToString } from 'react-dom/server'

// Harness de hook-uri pentru evenimente fără DOM. Randarea SSR de mai jos folosește React real.
const hooks = vi.hoisted(() => ({ current: null }))
const raspunsuri = vi.hoisted(() => ({ singure: [], liste: [], apeluri: [] }))
vi.mock('react', async original => {
  const real = await original()
  return { ...real,
    useState: v => hooks.current ? hooks.current.state(v) : real.useState(v),
    useRef: v => hooks.current ? hooks.current.ref(v) : real.useRef(v),
    useEffect: (f, d) => hooks.current ? hooks.current.effect(f, d) : real.useEffect(f, d),
  }
})
afterEach(() => { hooks.current = null; raspunsuri.singure = []; raspunsuri.liste = []; raspunsuri.apeluri = [] })

vi.mock('../../lib/supabase.js', () => ({ supabase: { from: tabel => {
  const q = { then: r => Promise.resolve(raspunsuri.liste.shift() || { data: [], error: null, count: 0 }).then(r),
    maybeSingle: () => new Promise(resolve => raspunsuri.singure.push(resolve)) }
  for (const op of ['select', 'eq', 'is', 'not', 'update', 'insert', 'order', 'limit', 'gt']) q[op] = (...args) => { raspunsuri.apeluri.push([tabel, op, ...args]); return q }
  return q
} } }))

import UatEcran, { ModalUat, ModalUatNou } from './UatEcran.jsx'
import SetariProiect from './SetariProiect.jsx'
import FormularCampuri from './FormularCampuri.jsx'
import LegaturaExecutie from './LegaturaExecutie.jsx'
import { CAMPURI_UAT } from '../setari.js'
import { citestePaginat, motivBlocareConvocator } from './comune.jsx'

const proiect = { id: 'p1', cod: 'TEST-PR', denumire: 'Proiect test', text_gdpr: 'Text GDPR de test', text_declaratie: 'Declarație de test', contact_email: 'test@example.invalid' }
const uats = [
  { id: 'u1', proiect_id: 'p1', nume: 'Test UAT', uat3: 'TST', judet: 'Test', sesiune_zi1: '2026-12-10', program_zi1: '09:00 – 16:00', reprezentant_uat_nume: 'Repr test' },
  { id: 'u2', proiect_id: 'p1', nume: 'Alt UAT', uat3: 'ALT' },
]
const show = () => {}

function harness() {
  const valori = [], efecte = []
  let index = 0
  const h = {
    state: initial => {
      const i = index++
      if (!(i in valori)) valori[i] = typeof initial === 'function' ? initial() : initial
      return [valori[i], v => { valori[i] = typeof v === 'function' ? v(valori[i]) : v }]
    },
    ref: initial => { const i = index++; return valori[i] || (valori[i] = { current: initial }) },
    effect: (f, deps) => {
      const i = index++
      if (!efecte[i] || deps.some((v, j) => v !== efecte[i].deps[j])) {
        efecte[i]?.curata?.()
        efecte[i] = { deps, curata: f() }
      }
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

describe('ModalUatNou — inserare în curs', () => {
  it('blochează nume/cod/județ și ignoră onChange până la răspuns', async () => {
    const h = harness(), gata = vi.fn()
    const props = { proiect, uats, show, onClose: () => {}, onGata: gata }
    let tree = h.render(ModalUatNou, props)
    elemente(tree, 'input')[0].props.onChange({ target: { value: 'Sat FICTIV' } })
    tree = h.render(ModalUatNou, props)
    const pending = elemente(tree, 'button').at(-1).props.onClick()
    tree = h.render(ModalUatNou, props)
    const inputuri = elemente(tree, 'input')
    const valori = inputuri.map(n => n.props.value)
    expect(inputuri).toHaveLength(3)
    expect(inputuri.every(n => n.props.disabled)).toBe(true)
    inputuri.forEach(n => n.props.onChange({ target: { value: 'NU SE SCRIE' } }))
    expect(elemente(h.render(ModalUatNou, props), 'input').map(n => n.props.value)).toEqual(valori)
    await pending
    expect(gata).toHaveBeenCalledTimes(1)
    expect(elemente(h.render(ModalUatNou, props), 'input').every(n => !n.props.disabled)).toBe(true)
  })
  it('răspuns după unmount: fără toast sau callback pe ecranul vechi', async () => {
    const h = harness(), gata = vi.fn(), toast = vi.fn()
    const props = { proiect, uats, show: toast, onClose: () => {}, onGata: gata }
    let tree = h.render(ModalUatNou, props)
    elemente(tree, 'input')[0].props.onChange({ target: { value: 'Sat FICTIV' } })
    tree = h.render(ModalUatNou, props)
    const pending = elemente(tree, 'button').at(-1).props.onClick()
    h.unmount()
    await pending
    expect(gata).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
  })
})

describe('legătura Execuție — generații async', () => {
  it('ignoră răspunsul vechi după schimbarea proiectului; păstrează numai proiectul curent', async () => {
    const h = harness()
    expect(h.render(LegaturaExecutie, { proiectId: 1 })).toBeNull()
    expect(h.render(LegaturaExecutie, { proiectId: 2 })).toBeNull()
    raspunsuri.singure[0]({ data: { id: 'red-vechi' }, error: null })
    await Promise.resolve()
    expect(h.render(LegaturaExecutie, { proiectId: 2 })).toBeNull()
    raspunsuri.singure[1]({ data: { id: 'red-curent' }, error: null })
    await Promise.resolve()
    expect(h.render(LegaturaExecutie, { proiectId: 2 }).props.to).toBe('/redari?proiect=red-curent')
    expect(raspunsuri.apeluri).toContainEqual(['red_proiecte', 'eq', 'activ', true])
    expect(raspunsuri.apeluri).toContainEqual(['red_proiecte', 'eq', 'executie_proiect_id', 2])
  })
  it.each([{ data: null, error: null }, { data: null, error: { code: '42501' } }])('RLS gol sau eroare: fără buton %j', async rezultat => {
    const h = harness()
    h.render(LegaturaExecutie, { proiectId: 1 })
    raspunsuri.singure[0](rezultat)
    await Promise.resolve()
    expect(h.render(LegaturaExecutie, { proiectId: 1 })).toBeNull()
  })
})

describe('preluare contract — numai în formular', () => {
  it('preia nr/data/coordonator, fără UPDATE automat; blochează formularul cât citește', async () => {
    const h = harness(), toast = vi.fn()
    const props = { proiect: { ...proiect, executie_proiect_id: 12 }, nivel: 'admin', show: toast, onSchimbat: vi.fn() }
    raspunsuri.liste.push({ data: [{ id: 12, nume: 'Montaj FICTIV', cod_intern: 'TEST' }], error: null }, { data: [], error: null })
    h.render(SetariProiect, props)
    for (let i = 0; i < 8; i++) await Promise.resolve()
    let tree = h.render(SetariProiect, props)
    const preia = elemente(tree, 'button').find(b => b.props.children === 'Preia contractul din Execuție')
    expect(preia.props.disabled).toBe(false)
    const pending = preia.props.onClick()
    tree = h.render(SetariProiect, props)
    expect(elemente(tree, 'select')[0].props.disabled).toBe(true)
    raspunsuri.singure[0]({ data: { nr_contract: '30/22.01.2025', data_contract: '2025-01-22', coordonator_transgaz: 'Coordonator FICTIV' }, error: null })
    await pending
    tree = h.render(SetariProiect, props)
    const gasesteForm = node => {
      if (Array.isArray(node)) { for (const n of node) { const r = gasesteForm(n); if (r) return r } }
      if (node?.type === FormularCampuri) return node.props.form
      return node?.props?.children ? gasesteForm(node.props.children) : null
    }
    expect(gasesteForm(tree)).toMatchObject({ contract_nr: '30', contract_data: '2025-01-22', reprezentant_tgz_nume: 'Coordonator FICTIV', executie_proiect_id: 12 })
    expect(raspunsuri.apeluri.some(x => x[1] === 'update')).toBe(false)
    expect(props.onSchimbat).not.toHaveBeenCalled()
  })
})

describe('ecranul UAT', () => {
  it('admin: generează înainte de numerotare, descarcă și regenerează după numerotare; viewer fără acțiuni', () => {
    const randare = (admin, nr) => renderToString(<ModalUat proiect={proiect} uat={{ ...uats[0], adresa_nr: nr }} uats={uats} esteAdmin={admin} show={show} onClose={() => {}} onGata={() => {}} />)
    expect(randare(true, null)).toContain('Generează adresa UAT')
    expect(randare(true, 'AU-0001')).toContain('Descarcă adresa')
    expect(randare(true, 'AU-0001')).toContain('Regenerează')
    expect(randare(true, 'AU-0001')).not.toContain('Generează adresa UAT')
    for (const nr of [null, 'AU-0001']) {
      const h = randare(false, nr)
      expect(h).not.toContain('Generează adresa UAT')
      expect(h).not.toContain('Descarcă adresa')
      expect(h).not.toContain('Regenerează')
    }
  })
  it('admin: tabelul cu ambele UAT-uri și butonul de UAT nou', () => {
    const h = renderToString(<UatEcran proiect={proiect} uats={uats} nivel="admin" show={show} onSchimbat={() => {}} />)
    expect(h).toContain('Test UAT')
    expect(h).toContain('Alt UAT')
    expect(h).toContain('10.12')
    expect(h).toContain('UAT nou')
    expect(h).toContain('nicio zi de sesiune cu program')        // u2 nu e gata
    expect(h).toContain('proiect fără nr./dată contract')        // proiectul de test nu are contract
  })
  it('viewer: fără butonul de UAT nou', () => {
    const h = renderToString(<UatEcran proiect={proiect} uats={uats} nivel="viewer" show={show} onSchimbat={() => {}} />)
    expect(h).not.toContain('UAT nou')
    expect(h).toContain('Doar administratorul modifică UAT-urile')
  })
  it('termenul de 10 zile (plan pct. 4.3): avertisment în modal și în tabel, fără să blocheze; în termen nu apare nimic', () => {
    const tarziu = { ...uats[0], afisare_data_start: '2026-11-30', afisare_data_end: '2026-12-12' }
    const modal = renderToString(<ModalUat proiect={proiect} uat={tarziu} uats={uats} esteAdmin show={show} onClose={() => {}} onGata={() => {}} />)
    expect(modal).toContain('Afișarea la primărie începe pe 30.11.2026, sub 10 zile libere înainte de ziua 1 (10.12.2026)')
    expect(modal).toContain('cel târziu pe 29.11.2026')
    expect(modal).toMatch(/<button[^>]*>Salvează/)
    const tabel = renderToString(<UatEcran proiect={proiect} uats={[tarziu]} nivel="admin" show={show} onSchimbat={() => {}} />)
    expect(tabel).toContain('afișarea începe după 29.11.2026')
    const inTermen = renderToString(<ModalUat proiect={proiect} uat={{ ...tarziu, afisare_data_start: '2026-11-29' }} uats={uats} esteAdmin show={show} onClose={() => {}} onGata={() => {}} />)
    expect(inTermen).not.toContain('sub 10 zile libere înainte de ziua 1')
    // juridic#031: pe limita fermă, dar după ținta recomandată (ziua 1 − 15 = 25.11) → doar informarea non-blocantă
    expect(inTermen).toContain('după ținta recomandată 25.11.2026')
    expect(inTermen).toContain('recomandat cu cel puțin 15 zile înainte, pentru livrarea poștei')
    const inTinta = renderToString(<ModalUat proiect={proiect} uat={{ ...tarziu, afisare_data_start: '2026-11-25' }} uats={uats} esteAdmin show={show} onClose={() => {}} onGata={() => {}} />)
    expect(inTinta).not.toContain('Afișarea la primărie începe pe')
    // tabelul „Gata de convocare?” arată ținta recomandată ca informare
    expect(renderToString(<UatEcran proiect={proiect} uats={[{ ...tarziu, afisare_data_start: '2026-11-20' }]} nivel="admin" show={show} onSchimbat={() => {}} />)).toContain('ținta recomandată 25.11.2026')
  })
  it.each([[false, 0], [true, 1]])('concurent (Jakarinos f-v2 r2 P2): termenul se judecă pe rândul recitit + patch, înainte de UPDATE (confirmă=%s)', async (raspuns, update) => {
    const confirm = vi.fn(() => raspuns)
    vi.stubGlobal('window', { confirm })
    try {
      const h = harness(), gata = vi.fn()
      const baza = { ...uats[0], sesiune_zi1: '2026-12-20', afisare_data_start: '2026-11-20', afisare_data_end: '2026-12-22', versiune: 1 }
      const props = { proiect, uat: baza, uats, esteAdmin: true, show: vi.fn(), onClose: () => {}, onGata: gata }
      let tree = h.render(ModalUat, props)
      elemente(tree, FormularCampuri)[0].props.onChange('afisare_data_start', '2026-12-05')
      tree = h.render(ModalUat, props)
      // pe formular (ziua 1 = 20.12, limita 09.12) afișarea de 05.12 e în termen: fără casetă, fără confirmare înainte de recitire
      expect(renderToString(tree)).not.toContain('Afișarea la primărie începe pe')
      const pending = elemente(tree, 'button').find(b => String(b.props.children).startsWith('Salvează')).props.onClick()
      expect(confirm).not.toHaveBeenCalled()
      // între timp alt admin a mutat ziua 1 la 10.12 (câmp distinct, deci fără conflict) → limita devine 29.11
      raspunsuri.liste.push({ data: [{ ...baza, sesiune_zi1: '2026-12-10', afisare_data_start: '2026-12-05', versiune: 3 }], error: null })
      raspunsuri.singure[0]({ data: { ...baza, sesiune_zi1: '2026-12-10', versiune: 2 }, error: null })
      await pending
      expect(confirm).toHaveBeenCalledTimes(1)
      expect(confirm.mock.calls[0][0]).toContain('Afișarea la primărie începe pe 05.12.2026, sub 10 zile libere înainte de ziua 1 (10.12.2026)')
      const updates = raspunsuri.apeluri.filter(x => x[0] === 'red_uat' && x[1] === 'update')
      expect(updates).toHaveLength(update)
      if (update) { expect(updates[0][2]).toEqual({ afisare_data_start: '2026-12-05' }); expect(gata).toHaveBeenCalledTimes(1) }
      else expect(gata).not.toHaveBeenCalled()
    } finally { vi.unstubAllGlobals() }
  })
  it('fără UAT-uri: mesaj gol', () => {
    expect(renderToString(<UatEcran proiect={proiect} uats={[]} nivel="admin" show={show} onSchimbat={() => {}} />)).toContain('Proiectul nu are UAT-uri')
  })
})

describe('FormularCampuri', () => {
  it('paginarea keyset continuă după pagini plafonate și se oprește numai la gol', async () => {
    const apeluri = [], randuri = [{ id: 1 }, { id: 2 }, { id: 3 }]
    const fabrica = () => {
      let dupa = 0
      const q = { order: k => { expect(k).toBe('id'); return q }, limit: () => q,
        gt: (k, v) => { expect(k).toBe('id'); dupa = v; return q },
        then: r => { apeluri.push(dupa); return Promise.resolve({ data: randuri.filter(x => x.id > dupa).slice(0, 1), error: null }).then(r) } }
      return q
    }
    expect(await citestePaginat(fabrica, { cheie: 'id' })).toEqual(randuri)
    expect(apeluri).toEqual([0, 1, 2, 3])
  })
  it('paginarea nu transformă eroarea sau răspunsul invalid în listă goală', async () => {
    for (const raspuns of [{ data: null, error: new Error('Test refuz') }, { data: null, error: null }]) {
      const fabrica = () => { const q = { order: () => q, limit: () => q, then: r => Promise.resolve(raspuns).then(r) }; return q }
      await expect(citestePaginat(fabrica, { cheie: 'id' })).rejects.toThrow()
    }
  })
  it('blocat = toate input-urile dezactivate (salvare în curs, Jakarinos f2 r2 P2)', () => {
    const h = renderToString(<FormularCampuri campuri={CAMPURI_UAT} form={{}} onChange={() => {}} blocat />)
    const inputuri = h.match(/<input[^>]*>/g) || []
    expect(inputuri.length).toBe(CAMPURI_UAT.length)
    expect(inputuri.every(i => /disabled=""/.test(i))).toBe(true)
  })
  it('neblocat = editabil', () => {
    const h = renderToString(<FormularCampuri campuri={CAMPURI_UAT} form={{}} onChange={() => {}} />)
    expect(/disabled/.test(h)).toBe(false)
  })
})

describe('ecranul Setări proiect', () => {
  it('cererea: admin vede sectiunea si lipsurile ca indiciu (butonul NU e blocat de ele — Copilot f3a r2 P3-01); editor/viewer nu o vad', () => {
    const html = renderToString(<SetariProiect proiect={proiect} uats={[]} nivel="admin" show={show} />)
    expect(html).toContain('Cerere de împuternicire către Beneficiar')
    expect(html).toContain('Nr. înregistrare (opțional)')
    expect(html).toContain('Lipseste beneficiarul')
    expect(html).toContain('cel putin un UAT')
    expect(html).toContain('la generare se verifică datele actuale')
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>📄 Generează cererea \(DOCX\)<\/button>/)   // validarea reală e pe datele proaspete, la click
    expect(html).toMatch(/<button[^>]*>📄 Generează cererea \(DOCX\)<\/button>/)
    for (const nivel of ['editor', 'viewer']) {
      const h = renderToString(<SetariProiect proiect={proiect} uats={uats} nivel={nivel} show={show} />)
      expect(h).not.toContain('Cerere de împuternicire către Beneficiar')
      expect(h).not.toContain('Generează cererea')
    }
  })
  it('cererea: proiect complet permite generare, modificarile nesalvate o blocheaza', () => {
    const h = harness()
    const props = { proiect: { ...proiect, beneficiar: 'Beneficiar FICTIV', contract_nr: 'TEST-1', contract_data: '2025-01-22', reprezentant_tgz_nume: 'Delegat FICTIV', reprezentant_gazpet_nume: 'Semnatar FICTIV', reprezentant_gazpet_functie: 'coordonator' }, uats, nivel: 'admin', show }
    let tree = h.render(SetariProiect, props)
    const buton = t => elemente(t, 'button').find(b => b.props.children === '📄 Generează cererea (DOCX)')
    expect(buton(tree).props.disabled).toBe(false)
    elemente(tree, FormularCampuri)[0].props.onChange('contract_nr', 'EDITAT')
    tree = h.render(SetariProiect, props)
    expect(buton(tree).props.disabled).toBe(true)
    h.unmount()
  })
  it('cererea: blocheaza imediat dublul click si ignora fetch dupa unmount', async () => {
    const h = harness(), toast = vi.fn()
    const props = { proiect: { ...proiect, versiune: 1, beneficiar: 'Beneficiar FICTIV', contract_nr: 'TEST-1', contract_data: '2025-01-22', reprezentant_tgz_nume: 'Delegat FICTIV', reprezentant_gazpet_nume: 'Semnatar FICTIV', reprezentant_gazpet_functie: 'coordonator' }, uats, nivel: 'admin', show: toast }
    let rezolva
    const fetchMock = vi.fn(() => new Promise(r => { rezolva = r }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const tree = h.render(SetariProiect, props)
      const buton = elemente(tree, 'button').find(b => b.props.children === '📄 Generează cererea (DOCX)')
      await new Promise(r => setTimeout(r, 0))   // citirea executie_proiecte din efect (await pe thenable = microtask) consuma intai paginile implicite
      // Copilot f3a r1 P2: UAT-urile se citesc din BD la click (keyset: o pagina + una goala) — paginile se pun INAINTE de click
      raspunsuri.liste.push({ data: uats.map(u => ({ id: u.id, nume: u.nume })), error: null }, { data: [], error: null })
      const pending = buton.props.onClick()
      await buton.props.onClick()
      // apoi proiectul (maybeSingle), abia apoi sablonul: fluxul citeste intai proiectul (maybeSingle) si UAT-urile (keyset: o pagina + una goala) din BD, abia apoi sablonul
      for (let i = 0; i < 5 && !raspunsuri.singure.length; i++) await Promise.resolve()
      raspunsuri.singure[0]({ data: { ...props.proiect, versiune: props.proiect.versiune ?? 1 }, error: null })
      for (let i = 0; i < 20 && fetchMock.mock.calls.length === 0; i++) await new Promise(r => setTimeout(r, 0))
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(elemente(h.render(SetariProiect, props), 'input').every(n => n.props.disabled)).toBe(true)
      h.unmount()
      const arrayBuffer = vi.fn()
      rezolva({ ok: true, arrayBuffer })
      await pending
      expect(arrayBuffer).not.toHaveBeenCalled()
      expect(toast).not.toHaveBeenCalled()
    } finally { vi.unstubAllGlobals() }
  })
  it('admin: câmpuri editabile + butonul Salvează + lipsurile pentru convocator', () => {
    const h = renderToString(<SetariProiect proiect={proiect} nivel="admin" show={show} onSchimbat={() => {}} />)
    expect(h).toContain('TEST-PR')
    expect(h).toContain('<textarea')
    expect(h).toContain('Salvează')
    expect(h).toContain('Pentru convocări lipsește')
    expect(h).toContain('Reprezentant A.P.M.')
  })
  it('editor: citire, fără input-uri și fără Salvează', () => {
    const h = renderToString(<SetariProiect proiect={proiect} nivel="editor" show={show} onSchimbat={() => {}} />)
    expect(h).not.toContain('<input')
    expect(h).not.toContain('<textarea')
    expect(h).not.toContain('Salvează')
    expect(h).toContain('Text GDPR de test')
  })
})

// D3 (audit 04.11): butonul 📄 Convocator e blocat dacă lipsește oricare câmp de contact tipărit de șablon
describe('motivBlocareConvocator — contactul tipărit pe convocator', () => {
  const uat = { sesiune_zi1: '2026-11-10', program_zi1: '09-16' }
  const pr = { contract_nr: '30', contract_data: '2025-01-22', imputernicire_nr: '1', imputernicire_data: '2026-10-01', text_gdpr: 'x',
    reprezentant_tgz_nume: 'R', reprezentant_tgz_telefon: '0711', contact_nume: 'N', contact_telefon: '0700', contact_email: 'a@b.test' }
  it('complet → null; fiecare câmp lipsă e numit, cu locul din Setări proiect', () => {
    expect(motivBlocareConvocator(pr, uat, null)).toBeNull()
    expect(motivBlocareConvocator({ ...pr, contact_telefon: ' ' }, uat, null)).toBe('proiect fără contact Gazpet: telefon (Setări proiect → Contact pe convocări)')
    expect(motivBlocareConvocator({ ...pr, contact_nume: '', contact_email: null }, uat, null)).toBe('proiect fără contact Gazpet: persoană, e-mail (Setări proiect → Contact pe convocări)')
    expect(motivBlocareConvocator({ ...pr, reprezentant_tgz_telefon: '' }, uat, null)).toMatch(/telefonul reprezentantului TGZ \(Setări proiect → Reprezentanți\)/)
  })
})
