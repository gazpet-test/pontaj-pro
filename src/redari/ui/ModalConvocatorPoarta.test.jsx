import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Exercitam handler-ele modalului real, inclusiv rand vechi proprietar -> detinator proaspat utilizator.
const h = vi.hoisted(() => ({ state: [], refs: [], i: 0, j: 0, rows: {}, rpc: vi.fn(), storage: vi.fn(), existente: [] }))
vi.mock('react', async original => {
  const real = await original()
  return { ...real, useState: initial => {
    const i = h.i++
    if (!(i in h.state)) h.state[i] = typeof initial === 'function' ? initial() : initial
    return [h.state[i], v => { h.state[i] = typeof v === 'function' ? v(h.state[i]) : v }]
  }, useRef: v => { const i = h.j++; return h.refs[i] ||= { current: v } }, useEffect: () => {}, useCallback: f => f }
})
vi.mock('../../lib/supabase.js', () => ({ supabase: {
  from: tab => {
    const rez = async () => ({ data: h.rows[tab], error: null })
    const q = { select: () => q, eq: () => q, single: rez, maybeSingle: rez }
    return q
  }, rpc: (...args) => h.rpc(...args), storage: { from: (...args) => h.storage(...args) },
} }))
vi.mock('../convocatorNeexpediat.js', async original => ({ ...(await original()),
  useConvocariNeexpediate: () => ({ existente: h.existente, eroare: null, reciteste: vi.fn() }),
}))
import { ModalConvocator } from '../../Redari.jsx'
import { motivBlocareConvocator } from './comune.jsx'

const proiect = { id: 'pr', cod: 'FICTIV', contract_nr: 'F', contract_data: '2026-11-05', imputernicire_nr: 'F', imputernicire_data: '2026-11-05',
  contact_nume: 'FICTIV', contact_telefon: '0000000000', contact_email: 'test@example.invalid', text_gdpr: 'FICTIV', reprezentant_tgz_nume: 'FICTIV', reprezentant_tgz_telefon: '0000000000' }
const uat = { id: 'u', sesiune_zi1: '2026-12-01', program_zi1: '09-15' }
const rand = { detinator_id: 'd', parcela_id: 'p', uat_id: 'u', calitate: 'proprietar' }
const gaseste = (node, text) => {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) { for (const n of node) { const r = gaseste(n, text); if (r) return r } return null }
  if (node.type === 'button' && typeof node.props?.children === 'string' && node.props.children.includes(text)) return node
  return gaseste(node.props?.children, text)
}
beforeEach(() => {
  h.i = 0; h.j = 0; h.state = []; h.refs = []; h.existente = []
  h.rpc.mockReset(); h.storage.mockReset()
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())

describe('PR3a r2 — modalul individual inainte de rezervare/upload', () => {
  it.each([['utilizator', false, 'utilizator - convocare neaprobata'], ['arendas', false, 'utilizator - convocare neaprobata']])(
    '%s / flag %s: randul vechi nu consuma numar si nu incarca sablon/fisier', async (calitate, flag, motiv) => {
      h.rows = { red_detinatori: { id: 'd', parcela_id: 'p', calitate }, red_parcele: { id: 'p', proiect_id: 'pr', uat_id: 'u' },
        red_detinatori_contact: null, red_detinatori_token: { token_raspuns: 'fictiv' }, red_proiecte: { ...proiect, convocare_utilizatori_aprobata: flag } }
      const show = vi.fn(), props = { rand, proiect, uats: [uat], show, onClose: vi.fn(), onGata: vi.fn() }
      let tree = ModalConvocator(props)
      const nou = gaseste(tree, 'Generează și descarcă')
      expect(nou.props.disabled).toBe(false) // prop-ul vechi permite: garda trebuie sa foloseasca datele proaspete
      await nou.props.onClick()
      expect(show).toHaveBeenCalledWith(motiv, 'error')
      expect(h.rpc).not.toHaveBeenCalled()
      expect(fetch).not.toHaveBeenCalled()
      expect(h.storage).not.toHaveBeenCalled()
      // Acelasi traseu de pregatire protejeaza si regenerarea cu numar existent.
      h.i = 0; h.j = 0; h.existente = [{ id: 'c', nr_document: 'C-0001', created_at: '2026-11-05' }]
      tree = ModalConvocator(props)
      await gaseste(tree, 'Regenerează același număr').props.onClick(h.existente[0])
      expect(h.rpc).not.toHaveBeenCalled(); expect(h.storage).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
      expect(props.onGata).not.toHaveBeenCalled()
    })
  it('PR3b: motivul comun permite utilizatorul aprobat; proprietarul rămâne permis', () => {
    expect(motivBlocareConvocator(proiect, uat, rand)).toBeNull()
    expect(motivBlocareConvocator({ ...proiect, convocare_utilizatori_aprobata: true }, uat, { ...rand, calitate: 'utilizator' })).toBeNull()
    expect(motivBlocareConvocator(proiect, uat, { ...rand, calitate: 'arendas' })).toBe('utilizator - convocare neaprobata')
  })
})
