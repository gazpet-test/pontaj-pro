import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../lib/supabase.js', () => ({ supabase: {} }))
import SmsPagina, { RevizieLot } from './SmsPagina.jsx'
import RedariSmsButon from './RedariSmsButon.jsx'

describe('Revizia înainte de aprobare (Jakarinos r1 P1)', () => {
  const det = { lot_id: 'l1', categorie: 'intern', stare: 'draft', versiune: 3, text: 'Sedinta maine', lungime: 13, segmente: 1, nr_destinatari: 2, cost_estimat_eur: 0.098,
    destinatari: [
      { mesaj_id: 'm1', nume: 'TEST UNU', telefon_mascat: '07** *** 001', destinatar_tip: 'angajat', stare: 'in_coada' },
      { mesaj_id: 'm2', nume: 'TEST DOI', telefon_mascat: '07** *** 002', destinatar_tip: 'angajat', stare: 'in_coada' },
    ] }
  it('arată lista FIXATĂ (nume + telefon mascat), textul, costul și versiunea; butonul e blocat până la bifă', () => {
    const html = renderToStaticMarkup(<RevizieLot lotId="l1" detaliiInitiale={det} />)
    for (const t of ['TEST UNU', 'TEST DOI', '07** *** 001', '07** *** 002', 'Sedinta maine', 'versiunea 3', 'Aprob acest lot', 'Am verificat lista de 2 destinatari']) expect(html).toContain(t)
    expect(html).not.toMatch(/\+407|07000000/)
    expect(html).toMatch(/<button[^>]*disabled[^>]*>✔ Aprob acest lot/)
  })
  it('nepotrivire listă / lot → avertisment', () => {
    const html = renderToStaticMarkup(<RevizieLot lotId="l1" detaliiInitiale={{ ...det, nr_destinatari: 3 }} />)
    expect(html).toContain('aprobarea va fi refuzată')
  })
})

describe('Administrator › 📱 SMS', () => {
  it('non-owner: nu randează nimic din modul', () => {
    const html = renderToStaticMarkup(<SmsPagina profile={{ id: 'x', is_owner: false }} />)
    expect(html).toContain('vizibil doar owner-ului')
    expect(html).not.toContain('Compune')
  })
  it('owner: secțiunile și nota despre convocarea scrisă', () => {
    const html = renderToStaticMarkup(<SmsPagina profile={{ id: 'x', is_owner: true }} />)
    for (const t of ['Compune', 'Istoric loturi', 'Setări', 'Opt-out', 'Previzualizează', 'Creează lot (draft)']) expect(html).toContain(t)
    expect(html).toContain('nu înlocuiește convocarea scrisă')
  })
})

describe('Redări › 📱 SMS proprietari', () => {
  const proiect = { id: 'p1', cod: 'TEST-PROIECT' }
  it('blocat cu mesajul „Așteaptă autorizarea scrisă Transgaz” cât comutatorul e oprit', () => {
    const html = renderToStaticMarkup(<RedariSmsButon proiect={proiect} uats={[]} panouInitial={{ redari_autorizat: false }} />)
    expect(html).toContain('Așteaptă autorizarea scrisă Transgaz')
    expect(html).toContain('disabled')
  })
  it('activ după autorizare', () => {
    const html = renderToStaticMarkup(<RedariSmsButon proiect={proiect} uats={[]} panouInitial={{ redari_autorizat: true }} />)
    expect(html).not.toContain('Așteaptă autorizarea')
    expect(html).not.toContain('disabled')
  })
})
