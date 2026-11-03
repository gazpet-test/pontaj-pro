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

describe('Revizia — nivelul contului (20261130b)', () => {
  const det = { lot_id: 'l6', categorie: 'intern', stare: 'draft', versiune: 1, text: 'Test', lungime: 4, segmente: 1, nr_destinatari: 6, cost_estimat_eur: 0.294,
    nivel: 'test', actiune_permisa: false, destinatari: [] }
  it('contul de test pe un lot de 6: mesaj clar, aprobarea blocată', () => {
    const html = renderToStaticMarkup(<RevizieLot lotId="l6" detaliiInitiale={det} />)
    expect(html).toContain('Nivelul tău nu poate aproba acest lot')
    expect(html).toContain('maximum 5 destinatari')
    expect(html).toMatch(/<button[^>]*disabled[^>]*>✔ Aprob acest lot/)
  })
})

const panouOwner = { nivel: 'owner', kill_switch: true, plafon_zi: 200, plafon_luna: 1500, consum_zi: 0, consum_luna: 0, ramas_zi: 200, redari_autorizat: false, redari_modul: true, versiune: 1, max_destinatari: 5000 }
const panouUtilizator = { nivel: 'utilizator', kill_switch: false, ramas_zi: 150, redari_autorizat: false, redari_modul: false, max_destinatari: 5000 }
const panouTest = { nivel: 'test', kill_switch: false, ramas_zi: 7, redari_autorizat: true, redari_modul: false, max_destinatari: 5, buget_test_zi: 10 }

describe('📱 SMS — acces pe nivel (ruta /sms și Administrator)', () => {
  it('fără modulul sms și fără owner: nu randează nimic din modul', () => {
    const html = renderToStaticMarkup(<SmsPagina profile={{ id: 'x', is_owner: false, module_access: ['redari'] }} />)
    expect(html).toContain('nu ai acces la modul')
    expect(html).not.toContain('Compune')
  })
  it('owner: toate secțiunile (inclusiv Setări, Opt-out) și nota despre convocarea scrisă', () => {
    const html = renderToStaticMarkup(<SmsPagina profile={{ id: 'x', is_owner: true }} panouInitial={panouOwner} />)
    for (const t of ['Compune', 'Istoric loturi', '>⚙ Setări<', '>🚫 Opt-out<', 'Previzualizează', 'Creează lot (draft)', 'Azi: <b>0</b> / 200']) expect(html).toContain(t)
    expect(html).toContain('nu înlocuiește convocarea scrisă')
  })
  it('owner: soldul SMSLink în banda de sus (20261130d), marcat sub prag; ceilalți nu îl văd', () => {
    const sold = { credit: 120, citit_la: '2026-11-04T05:10:00Z', prag: 150, sub_prag: true, alerta: true }
    const html = renderToStaticMarkup(<SmsPagina profile={{ id: 'x', is_owner: true }} panouInitial={panouOwner} soldInitial={sold} />)
    expect(html).toContain('Sold SMSLink: 120 (la 04.11 07:10) ⚠')
    expect(html).toContain('Sub pragul de 150 SMS')
    const u = renderToStaticMarkup(<SmsPagina profile={{ id: 'u', is_owner: false, module_access: ['sms'] }} panouInitial={panouUtilizator} soldInitial={sold} />)
    expect(u).not.toContain('Sold SMSLink')
  })
  it('utilizator: compune / istoric, fără Setări și Opt-out, fără plafoane', () => {
    const html = renderToStaticMarkup(<SmsPagina profile={{ id: 'u', is_owner: false, module_access: ['sms'] }} panouInitial={panouUtilizator} />)
    for (const t of ['Compune', 'Istoric loturi', 'Previzualizează', 'Utilizator SMS', 'le gestionează owner-ul', 'Mai pot pleca azi']) expect(html).toContain(t)
    for (const t of ['>⚙ Setări<', '>🚫 Opt-out<', 'Plafon / zi', '/ 200']) expect(html).not.toContain(t)
  })
  it('test: mesajul „maximum 5 destinatari, fără Redări”, fără Setări / Opt-out, selecție manuală implicită', () => {
    const html = renderToStaticMarkup(<SmsPagina profile={{ id: 't', is_owner: false, module_access: ['sms'] }} panouInitial={panouTest} />)
    expect(html).toContain('Cont de test: maximum 5 destinatari într-un lot, doar intern (fără Redări)')
    expect(html).toContain('Cont de test SMS')
    // r2 (P2-01 / P2-02): bugetul zilnic al contului și „doar loturile create de tine”
    expect(html).toContain('Mai pot pleca azi: <b>7</b> SMS (bugetul contului de test: 10 / zi)')
    expect(html).toContain('doar loturile create de tine, cel mult 10 SMS pe zi')
    for (const t of ['>⚙ Setări<', '>🚫 Opt-out<']) expect(html).not.toContain(t)
    expect(html).toMatch(/<input type="radio" name="sms-mod" checked=""\/>Selecție manuală/)
  })
})

describe('Redări › 📱 SMS proprietari', () => {
  const proiect = { id: 'p1', cod: 'TEST-PROIECT' }
  it('owner: blocat cu mesajul „Așteaptă autorizarea scrisă Transgaz” cât comutatorul e oprit', () => {
    const html = renderToStaticMarkup(<RedariSmsButon proiect={proiect} uats={[]} panouInitial={{ nivel: 'owner', redari_autorizat: false }} />)
    expect(html).toContain('Așteaptă autorizarea scrisă Transgaz')
    expect(html).toContain('disabled')
  })
  it('owner / utilizator cu Redări: activ după autorizare', () => {
    for (const p of [{ nivel: 'owner', redari_autorizat: true }, { nivel: 'utilizator', redari_modul: true, redari_autorizat: true }]) {
      const html = renderToStaticMarkup(<RedariSmsButon proiect={proiect} uats={[]} panouInitial={p} />)
      expect(html).toContain('SMS proprietari')
      expect(html).not.toContain('Așteaptă autorizarea')
      expect(html).not.toContain('disabled')
    }
  })
  it('contul de test, utilizatorul fără Redări și contul fără nivel SMS nu văd butonul', () => {
    for (const p of [{ nivel: 'test', redari_autorizat: true }, { nivel: 'utilizator', redari_modul: false, redari_autorizat: true }, { fara_acces: true }]) {
      expect(renderToStaticMarkup(<RedariSmsButon proiect={proiect} uats={[]} panouInitial={p} />)).toBe('')
    }
  })
})
