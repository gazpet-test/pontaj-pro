import { describe, it, expect, vi } from 'vitest'
vi.mock('./lib/supabase.js', () => ({ supabase: {} }))
import { filtreazaAcoperiri, interzisCumulDin, cumulInterzisInText, rolConducereF9, construiesteNoduri, verificaOrganigrama } from './OfertareOrganigrama.jsx'

// Cazurile vin din auditul Ofertare 08.11.2026 (licitația de test 103 + o licitație reală, anonimizată): nume fictive.
const aut = (id, cod, denumire, emp, extra = {}) => ({ id, employee_id: id + 100, tip: { cod, denumire }, emp: { name: emp }, domenii: extra.domenii || null })
const rand = (id, cerinta_id, a, extra = {}) => ({ id, cerinta_id, status: 'acoperit', autorizatie: a, ...extra })

describe('filtreazaAcoperiri — alegerea omului și valabilitatea', () => {
  it('pe o cerință cu rând ales, alternativele AI nu mai intră', () => {
    const r = filtreazaAcoperiri([rand(1, 10, null), rand(2, 10, null, { ales: true }), rand(3, 10, null), rand(4, 11, null)])
    expect(r.map(x => x.id)).toEqual([2, 4])
  })
  it('ales_de setat contează ca alegere', () => {
    expect(filtreazaAcoperiri([rand(1, 10, null, { ales_de: 'u1' }), rand(2, 10, null)]).map(x => x.id)).toEqual([1])
  })
  it('alegerea nevalabilă NU readuce alternativele AI; se întoarce separat pentru semnalare (review Jakarinos #1031 P1)', () => {
    const r = filtreazaAcoperiri([rand(1, 10, null, { ales: true, valabil_la_depunere: false }), rand(2, 10, null), rand(3, 11, null)])
    expect(r.map(x => x.id)).toEqual([3])
    expect(r.aleseNevalabile.map(x => x.id)).toEqual([1])
  })
  it('rândurile nevalabile la depunere ies; necunoscut (null/lipsă) rămâne', () => {
    const r = filtreazaAcoperiri([rand(1, 10, null, { valabil_la_depunere: false }), rand(2, 11, null, { valabil_la_depunere: null }), rand(3, 12, null)])
    expect(r.map(x => x.id)).toEqual([2, 3])
  })
})

describe('interzisCumulDin — cerința de cumul din documentație', () => {
  it('textul real de pe 103: „O persoana nu poate indeplini in mod cumulativ mai multe functii…” → interzis', () => {
    expect(interzisCumulDin([{ text_cerinta: 'O persoana nu poate indeplini in mod cumulativ mai multe functii in cadrul echipei de proiect' }])).toBe(true)
    expect(interzisCumulDin([{ text_cerinta: 'Cumulul de funcții nu este permis în cadrul echipei.' }])).toBe(true)
    expect(interzisCumulDin([{ text_cerinta: 'O persoană nu poate ocupa mai multe poziții.' }])).toBe(true)
  })
  it('negațiile și formulările directe (review Jakarinos #1031 P2)', () => {
    expect(cumulInterzisInText('Cumulul de funcții nu este interzis.')).toBe(false)
    expect(cumulInterzisInText('Cumulul de funcții este permis pentru personalul auxiliar.')).toBe(false)
    expect(cumulInterzisInText('Se interzice cumulul de funcții între managerul de proiect și șeful de șantier.')).toBe(true)
    expect(cumulInterzisInText('Nu se permite cumulul de funcții.')).toBe(true)
    expect(cumulInterzisInText('Cumularea funcțiilor de Manager de proiect și Șef de șantier de aceeași persoană este interzisă.')).toBe(true)
  })
  it('cerințele obișnuite nu declanșează', () => {
    expect(interzisCumulDin([{ text_cerinta: 'Responsabilul tehnic cu execuția trebuie să dețină autorizație ISC' }, { text_cerinta: null }])).toBe(false)
    expect(interzisCumulDin([])).toBe(false)
  })
})

describe('rolConducereF9', () => {
  it.each([
    ['Manager de proiect', 'Manager de proiect'], ['Manager contract', 'Manager de proiect'], ['Director de proiect', 'Manager de proiect'],
    ['Șef de șantier', 'Șef de șantier'], ['Sef santier', 'Șef de șantier'], ['Șef punct de lucru', 'Șef de șantier'],
    ['Responsabil tehnic cu execuția (RTE)', null], ['Instalator autorizat ANRE tip EGT', null], ['', null],
  ])('%s → %s', (rol, asteptat) => expect(rolConducereF9(rol)).toBe(asteptat))
})

describe('construiesteNoduri — managerul de proiect / șeful de șantier / dirigintele', () => {
  const lic = { autoritate: 'Comuna Test' }
  const acop = [
    rand(1, 10, aut(1, 'MANAGER_PROIECT', 'Manager proiect', 'POPESCU ION')),          // certificat de curs
    rand(2, 11, aut(2, 'DIRIGINTE_SANTIER', 'Diriginte de șantier', 'IONESCU DAN')),   // rol al beneficiarului
    rand(3, 12, aut(3, 'RTE', 'Responsabil tehnic cu execuția', 'IONESCU DAN', { domenii: ['9.1'] })),
  ]
  it('fără Formular 9: managerul vine din certificat; dirigintele NU intră dacă documentația nu-l cere', () => {
    const N = construiesteNoduri({ licitatie: lic, acoperiri: acop, spec: { linii_cerute: { diriginte: false } } })
    expect(N.persoane.find(p => p.rol === 'Manager de proiect').nume).toBe('POPESCU ION')
    expect(N.persoane.some(p => p.rol === 'Diriginte de șantier')).toBe(false)
  })
  it('dirigintele intră doar când documentația cere explicit linia lui', () => {
    const N = construiesteNoduri({ licitatie: lic, acoperiri: acop, spec: { linii_cerute: { diriginte: true } } })
    expect(N.persoane.some(p => p.rol === 'Diriginte de șantier')).toBe(true)
  })
  it('cu Formular 9: managerul de proiect și șeful de șantier vin de acolo (cazul real: inversați între triere și F9)', () => {
    const echipaF9 = [{ nume: 'B PERSOANA', employee_id: 202, roluri: ['Manager de proiect', 'Instalator autorizat ANRE tip EGT'] },
      { nume: 'A PERSOANA', employee_id: 201, roluri: ['Șef de șantier', 'Responsabil SSM'] }]
    const N = construiesteNoduri({ licitatie: lic, acoperiri: acop, spec: null, echipaF9 })
    const mp = N.persoane.filter(p => p.rol === 'Manager de proiect'), ss = N.persoane.filter(p => p.rol === 'Șef de șantier')
    expect(mp.map(p => p.nume)).toEqual(['B PERSOANA'])          // certificatul de curs nu mai concurează
    expect(ss.map(p => p.nume)).toEqual(['A PERSOANA'])          // înainte: niciodată propus („de nominalizat”)
    expect(mp[0].sursa).toBe('F9')
  })
})

describe('verificaOrganigrama — cumul interzis și concordanța cu F9', () => {
  const noduri = (persoane) => ({ operatori: [{ id: 'op_lider', tip: 'lider', nume: 'Gazpet' }], persoane, formatii: [], suport: [] })
  const p = (nume, rol, cat = 'specialist', emp = null) => ({ id: nume + rol, nume, rol, categorie: cat, employee_id: emp, operator_id: 'op_lider' })
  it('cumul: roșu când documentația îl interzice, portocaliu altfel', () => {
    const N = noduri([p('X Y', 'RTE 9.1', 'specialist', 5), p('X Y', 'Manager QA/QC', 'specialist', 5)])
    expect(verificaOrganigrama({ noduri: N, spec: null, interzisCumul: true }).find(v => v.cod.startsWith('cumul_')).nivel).toBe('rosu')
    expect(verificaOrganigrama({ noduri: N, spec: null, interzisCumul: false }).find(v => v.cod.startsWith('cumul_')).nivel).toBe('portocaliu')
  })
  it('managerul de proiect diferit de F9 → roșu; același → ok; fără F9 → nicio verificare', () => {
    const N = noduri([p('POPESCU ION', 'Manager de proiect', 'conducere', 1)])
    const f9 = [{ nume: 'B PERSOANA', roluri: ['Manager de proiect'] }]
    expect(verificaOrganigrama({ noduri: N, spec: null, echipaF9: f9 }).find(v => v.cod === 'f9_manager de proiect').nivel).toBe('rosu')
    expect(verificaOrganigrama({ noduri: N, spec: null, echipaF9: [{ nume: 'Popescu Ion', employee_id: 1, roluri: ['Manager proiect'] }] }).find(v => v.cod === 'f9_manager de proiect').nivel).toBe('ok')
    expect(verificaOrganigrama({ noduri: N, spec: null }).some(v => v.cod.startsWith('f9_'))).toBe(false)
  })
  it('concordanța F9 pe identitate: același nume, alt angajat → roșu; mulțimi egale, nu incluziune (review Jakarinos #1031 P2)', () => {
    const N = noduri([p('POPESCU ION', 'Manager de proiect', 'conducere', 1)])
    expect(verificaOrganigrama({ noduri: N, spec: null, echipaF9: [{ nume: 'POPESCU ION', employee_id: 2, roluri: ['Manager de proiect'] }] }).find(v => v.cod === 'f9_manager de proiect').nivel).toBe('rosu')
    expect(verificaOrganigrama({ noduri: N, spec: null, echipaF9: [{ nume: 'POPESCU ION', employee_id: 1, roluri: ['Manager de proiect'] }] }).find(v => v.cod === 'f9_manager de proiect').nivel).toBe('ok')
    const doi = noduri([p('A', 'Manager de proiect', 'conducere', 1), p('B', 'Manager de proiect', 'conducere', 3)])
    expect(verificaOrganigrama({ noduri: doi, spec: null, echipaF9: [{ nume: 'A', employee_id: 1, roluri: ['Manager de proiect'] }] }).find(v => v.cod === 'f9_manager de proiect').nivel).toBe('rosu')
  })
  it('context necitit și alegeri nevalabile = roșu explicit (review Jakarinos #1031 P1, L18)', () => {
    const v = verificaOrganigrama({ noduri: noduri([]), spec: null, contextNecitit: true, aleseNevalabile: 2 })
    expect(v.find(x => x.cod === 'context_necitit').nivel).toBe('rosu')
    expect(v.find(x => x.cod === 'alese_nevalabile').nivel).toBe('rosu')
  })
})
