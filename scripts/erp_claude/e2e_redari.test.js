import { describe, it, expect } from 'vitest'
import { citesteArgs, clasificaCerere, esteProiectTest, esteProiectLot1, fisierProba, urlScurt, raportMd, esteAsteptata, TEST, PREFIX_PROBA, EroareUtilizare } from './e2e_redari.mjs'
import { parseazaTgz } from '../../src/redari/importTgz.js'

const SB = 'https://dxczwkbciseqniprspcu.supabase.co'

describe('e2e_redari — garda de rețea', () => {
  it('funcțiile edge de trimitere sunt blocate pe ORICE mod', () => {
    for (const fn of ['sms-trimite', 'redari-mail-trimite', 'send-email', 'notificari-push', 'smtp-relay'])
      for (const mod of ['scriere', 'citire']) expect(clasificaCerere({ url: `${SB}/functions/v1/${fn}`, metoda: 'POST' }, mod)).toBe('blocheaza')
  })
  it('pe TEST (scriere) tabelele, Storage și funcțiile obișnuite trec', () => {
    expect(clasificaCerere({ url: `${SB}/rest/v1/red_parcele`, metoda: 'POST' }, 'scriere')).toBe('permite')
    expect(clasificaCerere({ url: `${SB}/rest/v1/red_detinatori_contact?on_conflict=detinator_id`, metoda: 'POST' }, 'scriere')).toBe('permite')
    expect(clasificaCerere({ url: `${SB}/storage/v1/object/redari/x.docx`, metoda: 'POST' }, 'scriere')).toBe('permite')
    expect(clasificaCerere({ url: `${SB}/functions/v1/izo-e3-ocr-local`, metoda: 'POST' }, 'scriere')).toBe('permite')
  })
  it('pe LOT1 (citire) orice scriere e blocată, citirile trec', () => {
    const c = (url, metoda) => clasificaCerere({ url: SB + url, metoda }, 'citire')
    expect(c('/rest/v1/red_parcele?proiect_id=eq.x', 'GET')).toBe('permite')
    expect(c('/rest/v1/red_parcele', 'POST')).toBe('blocheaza')
    expect(c('/rest/v1/red_parcele?id=eq.1', 'PATCH')).toBe('blocheaza')
    expect(c('/rest/v1/red_parcele?id=eq.1', 'DELETE')).toBe('blocheaza')
    expect(c('/rest/v1/red_parcele', 'PUT')).toBe('blocheaza')
    expect(c('/storage/v1/object/redari/a.docx', 'POST')).toBe('blocheaza')
    expect(c('/storage/v1/object/sign/redari/a.docx', 'POST')).toBe('permite')
    expect(c('/functions/v1/izo-e3-ocr-local', 'POST')).toBe('blocheaza')
    expect(c('/rest/v1/rpc/fn_red_sms_stare', 'POST')).toBe('permite')       // citirea agregatelor SMS la încărcarea Registrului
    expect(c('/rest/v1/rpc/fn_sms_panou', 'POST')).toBe('permite')           // panoul SMS (citire) din Registru / Notificări
    expect(c('/rest/v1/rpc/fn_red_sms_trimite', 'POST')).toBe('blocheaza')
    expect(c('/rest/v1/rpc/fn_sms_setari_salveaza', 'POST')).toBe('blocheaza')
    expect(c('/rest/v1/rpc/fn_red_sms_stare_x', 'POST')).toBe('blocheaza')   // doar numele exacte din lista de citire
    expect(c('/auth/v1/token?grant_type=refresh_token', 'POST')).toBe('permite')
  })
  it('alte domenii nu sunt atinse de gardă', () => {
    expect(clasificaCerere({ url: 'https://pontaj-pro-sooty.vercel.app/redari/sabloane/pv_a.docx', metoda: 'GET' }, 'citire')).toBe('permite')
    expect(clasificaCerere({ url: 'nu e url', metoda: 'POST' }, 'citire')).toBe('permite')
  })
})

describe('e2e_redari — erori așteptate', () => {
  it('doar sonda detecteazaRezervare (parametri lipsa) e scoasă din „HTTP eșuate”', () => {
    expect(esteAsteptata(`${SB}/rest/v1/rpc/fn_red_convocare_rezerva`, 'redari: parametri lipsa')).toBeTruthy()
    expect(esteAsteptata(`${SB}/rest/v1/rpc/fn_red_convocare_rezerva`, 'calitatea s-a schimbat - regenereaza')).toBeNull()
    expect(esteAsteptata(`${SB}/rest/v1/rpc/fn_red_plic_creeaza`, 'redari: parametri lipsa')).toBeNull()
  })
})

describe('e2e_redari — proiectul selectat', () => {
  it('scrierea cere id-ul ȘI codul TEST-RAZVAN', () => {
    expect(esteProiectTest({ value: TEST.id, text: 'TEST-RAZVAN — TEST - proiect de test Razvan (NU productie)' })).toBe(true)
    expect(esteProiectTest({ value: TEST.id, text: 'LOT1-PRUNISOR-JUPA — Redare teren' })).toBe(false)
    expect(esteProiectTest({ value: 'alt-id', text: 'TEST-RAZVAN — x' })).toBe(false)
    expect(esteProiectTest({ value: TEST.id, text: 'TEST-RAZVAN2 — x' })).toBe(false)
    expect(esteProiectTest(null)).toBe(false)
    expect(esteProiectLot1({ value: 'x', text: 'LOT1-PRUNISOR-JUPA — Redare teren' })).toBe(true)
    expect(esteProiectLot1({ value: 'x', text: 'TEST-RAZVAN — x' })).toBe(false)
  })
})

describe('e2e_redari — fișierul de probă', () => {
  it('trece prin parserul real: 3 parcele, 4 deținători (2 coproprietari), fără erori', () => {
    const buf = fisierProba({ uat: 'Testare', judet: 'Prahova' })
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    const p = parseazaTgz(ab, { uats: [{ id: 'u1', nume: 'Testare', uat3: 'TST', judet: 'Prahova' }], versiune: 'E2E', sursa: 'TGZ' })
    expect(p.erori).toEqual([])
    expect(p.parcele).toHaveLength(3)
    expect(p.parcele.every(x => x.cheie_sursa && !x.ambigua)).toBe(true)
    expect(p.detinatori).toHaveLength(4)
    expect(p.detinatori.every(d => d.nume.startsWith(PREFIX_PROBA))).toBe(true)
    expect(p.detinatori.filter(d => d.calitate === 'coproprietar')).toHaveLength(2)
  })
})

describe('e2e_redari — argumente și raport', () => {
  it('argumente', () => {
    expect(citesteArgs([])).toEqual({ doarCitire: false, faraLot1: false, vizibil: false, out: null })
    expect(citesteArgs(['--doar-citire', '--fara-lot1', '--out', 'x'])).toMatchObject({ doarCitire: true, faraLot1: true, out: 'x' })
    expect(() => citesteArgs(['--trimite'])).toThrow(EroareUtilizare)
    expect(() => citesteArgs(['--out'])).toThrow(EroareUtilizare)
  })
  it('url scurtat și raport cu tabel', () => {
    expect(urlScurt(`${SB}/rest/v1/red_uat?proiect_id=eq.1`)).toBe('dxczwkbciseqniprspcu/rest/v1/red_uat?proiect_id=eq.1')
    const md = raportMd({ meta: { data: '2026-11-06', baza: 'b', email: 'e', browser: 'x', doarCitire: false, faraLot1: false, durata: '1m', blocate: [] }, oprire: null,
      pasi: [{ nr: 1, nume: 'a|b', proiect: 'TEST', rezultat: 'OK', vazut: 'v', consola: [], http: [], captura: '01_a.png' },
        { nr: 2, nume: 'c', proiect: 'LOT1', rezultat: 'EȘUAT', vazut: 'eroare', consola: ['x'], http: [{ status: 500, metoda: 'GET', url: 'u' }], captura: null }] })
    expect(md).toContain('**1 OK**, **1 eșuați**')
    expect(md).toContain('| 1 | a\\|b | TEST | OK |')
    expect(md).toContain('HTTP 500 GET `u`')
  })
})
