import { describe, it, expect } from 'vitest'
import { citesteArgs, clasificaCerere, ctxGarda, invataIduri, RPC_CITIRE, esteProiectTest, esteProiectLot1, fisierProba, urlScurt, raportMd, esteAsteptata, TEST, PREFIX_PROBA, EroareUtilizare } from './e2e_redari.mjs'
import { parseazaTgz } from '../../src/redari/importTgz.js'

const SB = 'https://dxczwkbciseqniprspcu.supabase.co'

describe('e2e_redari — garda de rețea', () => {
  it('funcțiile edge de trimitere sunt blocate pe ORICE mod', () => {
    for (const fn of ['sms-trimite', 'redari-mail-trimite', 'send-email', 'notificari-push', 'smtp-relay'])
      for (const mod of ['scriere', 'citire']) expect(clasificaCerere({ url: `${SB}/functions/v1/${fn}`, metoda: 'POST' }, mod)).toBe('blocheaza')
  })
  // ID-uri de test (inventate): X și Y apar într-un răspuns filtrat pe TEST-RAZVAN, ALT e un proiect străin, Z nu e dovedit
  const ALT = '11111111-2222-3333-4444-555555555555'
  const X = 'aaaaaaaa-0000-4000-8000-000000000001', Y = 'aaaaaaaa-0000-4000-8000-000000000002', Z = 'bbbbbbbb-0000-4000-8000-000000000009'
  const ctxCuX = () => {
    const ctx = ctxGarda()
    invataIduri({ url: `${SB}/rest/v1/red_convocari?select=*&proiect_id=eq.${TEST.id}`, metoda: 'GET' }, [{ id: X, detinator_id: Y }], 'scriere', ctx)
    return ctx
  }
  const s = (url, metoda, corp, ctx = ctxCuX(), antete = {}) => clasificaCerere({ url: SB + url, metoda, corp: corp === undefined ? undefined : (typeof corp === 'string' ? corp : JSON.stringify(corp)), antete }, 'scriere', ctx)

  it('pe TEST (scriere) trec doar scrierile legate dovedit de TEST-RAZVAN', () => {
    expect(s('/rest/v1/red_parcele', 'POST', [{ proiect_id: TEST.id, uat_id: X, nr: 1 }])).toBe('permite')
    expect(s('/rest/v1/red_parcele', 'POST', [{ id: Z, proiect_id: TEST.id, nr: 1 }])).toBe('permite')          // id nou la INSERT simplu
    expect(s(`/rest/v1/red_detinatori_contact?on_conflict=detinator_id`, 'POST', { detinator_id: Y, telefon_ok: true })).toBe('permite')
    expect(s(`/rest/v1/red_convocari?id=eq.${X}`, 'PATCH', { stare: 'generat' })).toBe('permite')
    expect(s('/rest/v1/rpc/fn_red_plic_creeaza', 'POST', { p_convocare_id: X })).toBe('permite')
    expect(s(`/storage/v1/object/redari/${TEST.cod}/UAT/${X}/C-1-v1.docx`, 'POST')).toBe('permite')
  })
  it('P1 r1: pe TEST (scriere) trimiterile și țintele nedovedite sunt blocate', () => {
    expect(s('/rest/v1/rpc/fn_red_sms_trimite', 'POST', { p_proiect_id: TEST.id })).toBe('blocheaza')          // trimitere, pe orice mod
    expect(s('/rest/v1/rpc/fn_red_mail_lot_aproba', 'POST', { p_proiect_id: TEST.id })).toBe('blocheaza')
    expect(s('/rest/v1/red_parcele', 'POST', [{ proiect_id: ALT, nr: 1 }])).toBe('blocheaza')                    // alt proiect
    expect(s('/rest/v1/red_parcele', 'POST', [{ proiect_id: TEST.id }, { proiect_id: ALT }])).toBe('blocheaza')  // un rând străin în lot
    expect(s('/rest/v1/red_parcele', 'POST', [{ proiect_id: TEST.id, uat_id: Z }])).toBe('blocheaza')            // FK nedovedit
    expect(s(`/rest/v1/red_convocari?id=eq.${Z}`, 'PATCH', { stare: 'x' })).toBe('blocheaza')                   // rând nedovedit
    expect(s('/rest/v1/red_convocari', 'PATCH', { stare: 'x' })).toBe('blocheaza')                               // UPDATE fără filtru
    expect(s(`/rest/v1/red_convocari?id=eq.${X}`, 'PATCH', { detinator_id: Z })).toBe('blocheaza')               // mută pe ID nedovedit
    expect(s(`/rest/v1/red_parcele?id=eq.${X}`, 'DELETE')).toBe('blocheaza')                                     // fără ștergeri
    expect(s(`/rest/v1/red_detinatori?on_conflict=id`, 'POST', [{ id: Z, proiect_id: TEST.id }])).toBe('blocheaza')   // upsert pe id nedovedit
    expect(s('/rest/v1/red_detinatori_contact', 'POST', { telefon_ok: true })).toBe('blocheaza')                // rând fără legătură cu TEST
    expect(s('/rest/v1/red_proiecte', 'POST', { cod: 'X' })).toBe('blocheaza')                                   // tabel în afara listei
    expect(s('/rest/v1/user_module_access', 'POST', { user_id: X })).toBe('blocheaza')
    expect(s('/rest/v1/red_parcele', 'POST', 'nu e json')).toBe('blocheaza')
    expect(s('/rest/v1/rpc/fn_red_plic_creeaza', 'POST', { p_convocare_id: Z })).toBe('blocheaza')
    expect(s('/rest/v1/rpc/fn_red_plic_creeaza', 'POST', {})).toBe('blocheaza')                                 // fără niciun ID de verificat
    expect(s('/rest/v1/rpc/fn_red_necunoscuta', 'POST', { p_id: X })).toBe('blocheaza')                         // RPC în afara listei
    expect(s(`/storage/v1/object/redari/LOT1-PRUNISOR-JUPA/UAT/x.docx`, 'POST')).toBe('blocheaza')
    expect(s(`/storage/v1/object/redari/${TEST.cod}/UAT/x.docx`, 'DELETE')).toBe('blocheaza')
    expect(s('/functions/v1/izo-e3-ocr-local', 'POST', {})).toBe('blocheaza')                                   // funcțiile edge non-GET
  })
  it('învățarea ID-urilor: doar din cereri legate dovedit de TEST-RAZVAN, doar în modul scriere', () => {
    const ctx = ctxGarda()
    expect(invataIduri({ url: `${SB}/rest/v1/red_convocari?id=eq.${Z}`, metoda: 'GET' }, [{ id: Z }], 'scriere', ctx)).toBe(0)        // fără filtru pe TEST
    expect(invataIduri({ url: `${SB}/rest/v1/red_parcele?proiect_id=eq.${ALT}`, metoda: 'GET' }, [{ id: Z }], 'scriere', ctx)).toBe(0) // alt proiect
    expect(invataIduri({ url: `${SB}/rest/v1/red_parcele?proiect_id=eq.${TEST.id}`, metoda: 'GET' }, [{ id: Z }], 'citire', ctx)).toBe(0) // modul citire
    expect(invataIduri({ url: `${SB}/rest/v1/red_parcele?proiect_id=eq.${TEST.id}`, metoda: 'GET' }, [{ id: X, parcela: { uat_id: Y } }], 'scriere', ctx)).toBe(2)
    expect(invataIduri({ url: `${SB}/rest/v1/red_plicuri`, metoda: 'POST', permisa: true }, [{ id: Z }], 'scriere', ctx)).toBe(1)    // scriere permisă
    expect(clasificaCerere({ url: `${SB}/rest/v1/red_plicuri?id=eq.${Z}`, metoda: 'PATCH', corp: '{"stare":"x"}' }, 'scriere', ctx)).toBe('permite')
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
  it('P1 r1: în modul citire trec DOAR RPC-urile din lista albă (funcții STABLE), orice alt RPC e blocat', () => {
    const c = (fn) => clasificaCerere({ url: `${SB}/rest/v1/rpc/${fn}`, metoda: 'POST', corp: `{"p_proiect_id":"${TEST.id}"}` }, 'citire')
    for (const fn of ['fn_red_plic_creeaza', 'fn_red_pv_creeaza', 'fn_red_pv_c_creeaza', 'fn_red_lot_plicuire_creeaza', 'fn_red_convocare_rezerva',
      'fn_red_convocare_leaga', 'fn_red_adresa_uat_rezerva', 'fn_red_seteaza_tronson', 'fn_red_valoare_parcela_seteaza', 'fn_red_raspuns_public', 'fn_ceva_nou'])
      expect(c(fn)).toBe('blocheaza')
    for (const fn of RPC_CITIRE) expect(c(fn)).toBe('permite')
    for (const fn of RPC_CITIRE) expect(/sms_trimite|seteaza|creeaza|rezerva|leaga|salveaza|aproba/.test(fn)).toBe(false)   // nicio scriere pe listă
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
