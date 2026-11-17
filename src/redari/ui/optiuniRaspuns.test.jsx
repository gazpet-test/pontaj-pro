// Opțiunea „Nu particip — am obiecții” retrasă pentru răspunsuri NOI (decizia Răzvan 17.11.2026, juridic#046), dar afișabilă la
// răspunsurile vechi. Date fictive; supabase e simulat (fără rețea).
// Aici: (1) randare server-side a listelor; (2) funcțiile care construiesc cererea către server (pregatesteRaspunsPublic /
// pregatesteRaspunsManual) — un cod retras nu produce cerere. Componentele montate în jsdom, cu clic / tastare și ce ajunge efectiv
// în rpc() / insert(): optiuniRaspunsDom.test.jsx.
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('../../lib/supabase.js', () => ({ supabase: { from: () => { throw new Error('fără BD în test') }, rpc: () => { throw new Error('fără BD în test') } } }))

import { ListaOptiuni, Rezumat, OPTIUNI_NOI, titluOptiune, pregatesteRaspunsPublic } from '../../RedariRaspunsPublic.jsx'
import { ModalRaspunsTelefon } from '../../Redari.jsx'
import { OPTIUNI_RASPUNS, OPTIUNI_RASPUNS_NOI, etichetaOptiune, pregatesteRaspunsManual } from './comune.jsx'
import { calculeazaStare } from '../stare.js'
import { randRegistru } from '../exportXlsx.js'

const html = el => renderToString(el).replace(/<!-- -->/g, '')
const RETRASA = 'nu_particip_cu_obiectii'
// cele trei opțiuni din modelul de convocator (juridic#046 pct. 1), în ordine
const TREI = ['particip', 'nu_particip_fara_obiectii', 'constatare_teren']
// coduri care nu au voie să plece la un răspuns nou
const NEPERMISE = [RETRASA, '', undefined, 'necunoscut', 'PARTICIP']

describe('formularul public', () => {
  it('oferă exact trei variante, fără opțiunea retrasă', () => {
    expect(OPTIUNI_NOI.map(o => o.cod)).toEqual(TREI)
    const x = html(<ListaOptiuni optiune="" onAlege={() => {}} />)
    expect([...x.matchAll(/data-optiune="([^"]+)"/g)].map(m => m[1])).toEqual(TREI)
    expect(x).not.toContain(RETRASA)
    expect(x).not.toContain('Nu particip — am obiecții')
  })
  it('opțiunea a doua: textul din model („spre semnare, electronic”), fără „întocmit în lipsa mea”', () => {
    const x = html(<ListaOptiuni optiune="nu_particip_fara_obiectii" onAlege={() => {}} />)
    expect(x).toContain('Sunt de acord să primesc procesul-verbal completat, spre semnare, electronic.')
    expect(x).not.toContain('întocmit în lipsa mea')
    expect(x).toContain('aria-checked="true"')
  })
  // Limita preexistentă (review #1117): la REDESCHIDEREA linkului, fn_red_formular_public întoarce doar `deja_raspuns`, nu și opțiunea
  // aleasă, deci pagina arată doar că există un răspuns. Testul de mai jos probează DOAR componenta Rezumat (ecranul de confirmare
  // din aceeași sesiune, după trimitere) când primește codul vechi — nu și pagina după reîncărcare.
  it('componenta Rezumat, primind direct codul vechi, îl afișează (titlu + obiecții) — nu probează pagina după reîncărcare', () => {
    expect(titluOptiune(RETRASA)).toBe('Nu particip — am obiecții')
    const x = html(<Rezumat inst={{ optiune: RETRASA, obiectii: 'Gard nerefăcut (text fictiv)', la: new Date('2026-11-17T10:00:00Z') }} />)
    expect(x).toContain('Nu particip — am obiecții')
    expect(x).toContain('Gard nerefăcut (text fictiv)')
    expect(x).toContain('Obiecții')
  })
})

describe('cererea către server din formularul public (pregatesteRaspunsPublic)', () => {
  it.each(NEPERMISE)('codul %j nu produce cerere: eroare de validare, fără parametri', cod => {
    // chiar și cu toate câmpurile completate, ca la o stare veche păstrată
    const r = pregatesteRaspunsPublic({ optiune: cod, zi: '2026-12-10', obiectii: 'Gard nerefăcut', declaratie: true })
    expect(r).toEqual({ eroare: 'Alegeți una din cele trei variante.' })
    expect(r).not.toHaveProperty('parametri')
  })
  it('cele trei opțiuni permise produc parametrii RPC, doar cu câmpurile opțiunii', () => {
    expect(pregatesteRaspunsPublic({ optiune: 'particip', zi: '2026-12-10', obiectii: 'x', declaratie: true }).parametri)
      .toEqual({ p_optiune: 'particip', p_zi: '2026-12-10', p_obiectii: null, p_declaratie_confirmata: false })
    expect(pregatesteRaspunsPublic({ optiune: 'nu_particip_fara_obiectii', zi: '2026-12-10', obiectii: 'x', declaratie: true }).parametri)
      .toEqual({ p_optiune: 'nu_particip_fara_obiectii', p_zi: null, p_obiectii: null, p_declaratie_confirmata: true })
    expect(pregatesteRaspunsPublic({ optiune: 'constatare_teren', zi: '2026-12-10', obiectii: '  Gard rupt  ', declaratie: true }).parametri)
      .toEqual({ p_optiune: 'constatare_teren', p_zi: null, p_obiectii: 'Gard rupt', p_declaratie_confirmata: false })
  })
  it('validările vechi rămân: zi, declarație, obiecții, lungime', () => {
    expect(pregatesteRaspunsPublic({ optiune: 'particip', zi: '' }).eroare).toBe('Alegeți ziua în care participați.')
    expect(pregatesteRaspunsPublic({ optiune: 'nu_particip_fara_obiectii', declaratie: false }).eroare).toBe('Bifați declarația pentru a continua.')
    expect(pregatesteRaspunsPublic({ optiune: 'constatare_teren', obiectii: '   ' }).eroare).toBe('Scrieți pe scurt obiecțiile dumneavoastră.')
    expect(pregatesteRaspunsPublic({ optiune: 'constatare_teren', obiectii: 'a'.repeat(4001) }).eroare).toMatch(/prea lung/)
  })
})

describe('ecranul intern (răspuns înregistrat de operator)', () => {
  const rand = { detinator_id: 'd1', uat_id: 'u1', nume: 'FICTIV UNU', uat3: 'TST' }
  const uats = [{ id: 'u1', nume: 'UAT Test', sesiune_zi1: '2026-12-10', program_zi1: '09:00 – 16:00' }]
  const modal = (u = uats) => html(<ModalRaspunsTelefon rand={rand} profile={{}} uats={u} proiect={{}} show={() => {}} onClose={() => {}} onGata={() => {}} />)
  it('lista de opțiuni nu mai are „Nu particip, cu obiecții” (cu și fără zile de sesiune)', () => {
    expect(OPTIUNI_RASPUNS_NOI.map(o => o.cod)).toEqual(TREI)
    for (const u of [uats, [{ id: 'u1', nume: 'UAT Test' }]]) {
      const x = modal(u)
      const optiuni = [...x.matchAll(/<option value="([^"]*)"/g)].map(m => m[1]).filter(v => [...TREI, RETRASA].includes(v))
      expect(optiuni).toEqual(TREI)
      expect(x).not.toContain('Nu particip, cu obiecții')
    }
  })
  it('eticheta codului vechi rămâne pentru registru, fișă și export; starea îl tratează ca obiecții', () => {
    expect(OPTIUNI_RASPUNS.map(o => o.cod)).toContain(RETRASA)
    expect(etichetaOptiune(RETRASA)).toBe('Nu particip, cu obiecții')
    expect(calculeazaStare({ calitate: 'proprietar', adresa_cunoscuta: true, convocari: [], raspunsuri: [{ optiune: RETRASA, data: '2026-11-20T10:00:00Z', seq: 1 }] }).stare).toBe('OBIECTII_DE_TRATAT')
    const r = randRegistru({ parcela: { id: 'p1', id_parcela: 'TEST-1' }, uat: { id: 'u1', nume: 'UAT Fictiv' }, detinator: { id: 'd1', nume: 'FICTIV UNU', calitate: 'proprietar' },
      convocari: [], raspunsuri: [{ detinator_id: 'd1', data: '2026-11-20', seq: 1, optiune: RETRASA, obiectii_text: 'X' }], stare: 'OBIECTII_DE_TRATAT' })
    expect(r.X).toBe('Nu particip, cu obiecții')
  })
})

describe('rândul de INSERT din ecranul operatorului (pregatesteRaspunsManual)', () => {
  const baza = { zi: '2026-12-10', zile: ['2026-12-10'], obiectii: 'Gard nerefăcut', declaratie: true, canal: 'telefon', detinatorId: 'd1', createdBy: 'u1' }
  it.each(NEPERMISE)('codul %j nu produce rândul: eroare, fără INSERT', cod => {
    const r = pregatesteRaspunsManual({ ...baza, optiune: cod })
    expect(r.eroare).toBe('Opțiunea aleasă nu se mai înregistrează la un răspuns nou: alege una din listă.')
    expect(r).not.toHaveProperty('rand')
  })
  it('cele trei opțiuni permise produc rândul, doar cu câmpurile opțiunii', () => {
    const comun = { detinator_id: 'd1', canal: 'telefon', created_by: 'u1' }
    expect(pregatesteRaspunsManual({ ...baza, optiune: 'particip' }).rand)
      .toEqual({ ...comun, optiune: 'particip', zi_sesiune_aleasa: '2026-12-10', obiectii_text: null, declaratie_confirmata: null })
    expect(pregatesteRaspunsManual({ ...baza, optiune: 'nu_particip_fara_obiectii' }).rand)
      .toEqual({ ...comun, optiune: 'nu_particip_fara_obiectii', zi_sesiune_aleasa: null, obiectii_text: null, declaratie_confirmata: true })
    expect(pregatesteRaspunsManual({ ...baza, optiune: 'constatare_teren', obiectii: ' Gard rupt ' }).rand)
      .toEqual({ ...comun, optiune: 'constatare_teren', zi_sesiune_aleasa: null, obiectii_text: 'Gard rupt', declaratie_confirmata: null })
  })
  it('validările vechi rămân: obiecții, UAT fără sesiune, zi din listă, declarație', () => {
    expect(pregatesteRaspunsManual({ ...baza, optiune: 'constatare_teren', obiectii: ' ' }).eroare).toBe('Pentru această opțiune obiecțiile sunt obligatorii.')
    expect(pregatesteRaspunsManual({ ...baza, optiune: 'particip', zile: [] }).eroare).toMatch(/nu are zile de sesiune/)
    expect(pregatesteRaspunsManual({ ...baza, optiune: 'particip', zi: '2026-12-11' }).eroare).toBe('Alege ziua de sesiune din lista UAT-ului.')
    expect(pregatesteRaspunsManual({ ...baza, optiune: 'nu_particip_fara_obiectii', declaratie: false }).eroare).toMatch(/confirmat verbal/)
  })
})
