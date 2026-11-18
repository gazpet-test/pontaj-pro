// Redări e-mail — linkul PERSONAL de răspuns și câmpurile completate pe fiecare mesaj (19.11.2026, migrarea 20261131i): partea JS a probelor.
//  * forma „{NUME}” și câmpurile necunoscute: paritate L19 cu regex-ul din migrare, pe același tabel de cazuri (src/redari/__tests__/campuri_mail_cazuri.json;
//    partea SQL: scripts/pglite/test_redari_mail_link_local.mjs);
//  * linkul: aceeași definiție în JS (linkRaspuns, docx.js) și în SQL (fn_red_link_raspuns — prefixul citit din textul migrării);
//  * mascarea: tokenul (43 de caractere) nu apare în previzualizare, doar ultimele 6; textul fără link rămâne neschimbat;
//  * inventarul: motivul nou fara_token e cunoscut și numărat; ecranul: lista câmpurilor, avertismentul fără {LINK_RASPUNS}, crearea oprită la câmp greșit,
//    previzualizarea cu linkul mascat (tokenul nu e în HTML);
//  * dovada pe main (git show origin/main): mailLoturi.js de pe main nu cunoaște fara_token (inventarul aruncă), iar ecranul de pe main afișa textul brut.
import React, { useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect, vi } from 'vitest'
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
vi.mock('react', async importOriginal => {
  const actual = await importOriginal()
  return { ...actual, useState: vi.fn(actual.useState) }
})
vi.mock('../lib/supabase.js', () => ({ supabase: {} }))
vi.mock('./ui/comune.jsx', () => ({ S: {} }))
import { CAMPURI_MAIL, NUME_CAMPURI, CAMP_LINK, campuriDinText, campuriNecunoscute, areLinkRaspuns, mascheazaLink, MASCA_TOKEN, MESAJ_FARA_LINK, MOTIVE_MAIL, inventarMail } from './mailLoturi.js'
import { linkRaspuns } from './docx.js'
import MailLoturiEcran, { MESAJ_CAMP_NECUNOSCUT, MESAJ_LINK_IN_SUBIECT } from './ui/MailLoturiEcran.jsx'

const citeste = cale => readFileSync(cale, 'utf8').replace(/\r\n/g, '\n')
const MIG = citeste('supabase/migrations/20261131i_redari_mail_link_personal.sql')
const CAZURI = JSON.parse(citeste('src/redari/__tests__/campuri_mail_cazuri.json'))
const TOK = 'T1' + 'a'.repeat(41), TOK2 = 'T2' + 'b'.repeat(41)
const LINK = linkRaspuns(TOK)

describe('câmpurile textului: forma {NUME} (paritate cu SQL pe tabelul comun de cazuri)', () => {
  it('lista câmpurilor: LINK_RASPUNS obligatoriu suportat + cele patru ale lotului; numele apar în migrare', () => {
    expect(NUME_CAMPURI).toEqual(['LINK_RASPUNS', 'COMUNA', 'ZILE', 'PROGRAM', 'TEL'])
    expect(CAMP_LINK).toBe('LINK_RASPUNS')
    for (const n of NUME_CAMPURI) expect(MIG).toContain(`'${n}'`)
    expect(CAMPURI_MAIL.filter(c => c.perMesaj).map(c => c.nume)).toEqual(['LINK_RASPUNS'])
  })
  it('regex-ul din migrare e cel așteptat (forma SQL fără backslash, 1–40 de caractere fără acolade)', () => {
    expect(/regexp_matches\(p_text,'\[\{\]\(\[\^\{\}\]\{1,40\}\)\[\}\]','g'\)/.test(MIG)).toBe(true)
  })
  it.each(CAZURI.map(c => [c.text.slice(0, 40), c]))('%s', (_, c) => {
    expect(campuriDinText(c.text)).toEqual(c.campuri)
    expect(campuriNecunoscute(c.text)).toEqual(c.necunoscute)
    expect(areLinkRaspuns(c.text)).toBe(c.campuri.includes('LINK_RASPUNS'))
  })
  it('intrări nule / nestring = fără câmpuri', () => {
    expect(campuriDinText(null)).toEqual([]); expect(campuriDinText(undefined)).toEqual([]); expect(campuriNecunoscute('')).toEqual([])
  })
})

describe('linkul personal: o definiție (JS = SQL) și mascarea', () => {
  it('prefixul din fn_red_link_raspuns = linkRaspuns din docx.js (același ca în codul QR)', () => {
    const prefix = /'(https:\/\/[^']+\/redari\/raspuns\/)'\|\|p_token/.exec(MIG)?.[1]
    expect(prefix).toBe('https://redari.gazpet.ro/redari/raspuns/')
    for (const t of [TOK, TOK2, 'x'.repeat(43)]) expect(linkRaspuns(t)).toBe(prefix + t)
  })
  it('SQL-ul cere tokenul de 43 de caractere base64url (ca RPC-urile publice)', () => {
    expect(MIG).toContain(`p_token ~ '^[A-Za-z0-9_-]{43}$'`)
    expect(MIG).toContain(`t.token_raspuns ~ '^[A-Za-z0-9_-]{43}$' AND (t.token_expira_la IS NULL OR now()<=t.token_expira_la)`)
  })
  it('mascarea ascunde tokenul și lasă ultimele 6 caractere; două linkuri diferite rămân diferite', () => {
    const text = `Formular: ${LINK}\nAltul: ${linkRaspuns(TOK2)} gata.`
    const m = mascheazaLink(text)
    expect(m).not.toContain(TOK); expect(m).not.toContain(TOK2)
    expect(m).toContain(`/redari/raspuns/${MASCA_TOKEN}${TOK.slice(-6)}`); expect(m).toContain(`/redari/raspuns/${MASCA_TOKEN}${TOK2.slice(-6)}`)
    expect(m.split(MASCA_TOKEN)).toHaveLength(3)
    expect(m.endsWith(' gata.')).toBe(true)
  })
  it('textul fără link / cu token de altă lungime rămâne neschimbat; null = șir gol', () => {
    expect(mascheazaLink('fără link')).toBe('fără link')
    expect(mascheazaLink('/redari/raspuns/scurt')).toBe('/redari/raspuns/scurt')
    expect(mascheazaLink(`/redari/raspuns/${TOK}x`)).toBe(`/redari/raspuns/${TOK}x`)   // 44 de caractere nu e un token
    expect(mascheazaLink(null)).toBe('')
  })
})

describe('inventarul: motivul fara_token', () => {
  it('e în lista motivelor și se numără; rândul cu fara_token nu e eligibil', () => {
    expect(MOTIVE_MAIL.fara_token).toMatch(/token/)
    const r = inventarMail([{ id: 'a', motive: [] }, { id: 'b', motive: ['fara_token'] }, { id: 'c', motive: ['fara_token', 'fara_email'] }])
    expect(r).toMatchObject({ total: 3, eligibili: 1, exclusi: 2 }); expect(r.motive.fara_token).toBe(2)
  })
})

const lot = { id: 'lot-fictiv', uat_id: 'uat-fictiv', stare: 'ciorna', versiune: 1, lot_sha256: 'a'.repeat(64) }
const mesajCu = tok => ({ id: `m-${tok.slice(0, 2)}`, nr_document: `M-${tok.slice(0, 2)}`, catre: 'coleg.fictiv@gazpet.ro', stare: 'in_coada', subiect_final: 'Predarea terenului – Comuna Testeni', corp_text_final: `Răspuns: ${linkRaspuns(tok)}\nCu stimă.` })
// starea componentei, în ordinea useState-urilor: uat, lotId, loturi, mesaje, destinatari, selectie, subiect, text, eroare, ocupat, reload, confirm, integru, inventar, setari, rezultat, campuri
function randeaza({ uat = '', lotId = '', loturi = [], mesaje = [], subiect = '', text = '', campuri = null, destinatari = [] } = {}) {
  for (const v of [uat, lotId, loturi, mesaje, destinatari, [], subiect, text, '', false, 0, false, false, null, null, '', campuri]) useState.mockImplementationOnce(() => React.useState(v))
  return renderToStaticMarkup(<MailLoturiEcran proiect={{ id: 'fictiv', cod: 'TEST-RAZVAN' }} uats={[{ id: 'uat-fictiv', nume: 'UAT' }]} profile={{ is_owner: true }} />)
}
describe('ecranul „Lot e-mail”', () => {
  it('previzualizarea pe mesaj: destinatarul + textul completat cu linkul MASCAT; tokenul nu e în HTML', () => {
    const html = randeaza({ lotId: lot.id, loturi: [lot], mesaje: [mesajCu(TOK), mesajCu(TOK2)] })
    expect(html).not.toContain(TOK); expect(html).not.toContain(TOK2)
    expect(html).toContain(`/redari/raspuns/${MASCA_TOKEN}${TOK.slice(-6)}`); expect(html).toContain(`/redari/raspuns/${MASCA_TOKEN}${TOK2.slice(-6)}`)
    expect(html).toContain('coleg.fictiv@gazpet.ro'); expect(html).toContain('M-T1'); expect(html).toContain('M-T2'); expect(html).toContain('linkul personal de răspuns apare mascat')
  })
  it('lista câmpurilor lângă text, cu valorile lotului din RPC și „nu se poate completa” pentru cele lipsă', () => {
    const html = randeaza({ uat: 'uat-fictiv', campuri: { COMUNA: 'Comuna Testeni', ZILE: '24.11.2026 și 25.11.2026', PROGRAM: null, TEL: '0244 000 000' } })
    for (const n of NUME_CAMPURI) expect(html).toContain(`{${n}}`)
    expect(html).toContain('Comuna Testeni'); expect(html).toContain('24.11.2026 și 25.11.2026'); expect(html).toContain('0244 000 000')
    expect(html).toContain('nu se poate completa din datele proiectului'); expect(html).toContain(MOTIVE_MAIL.fara_token)
  })
  it('avertisment când textul nu conține {LINK_RASPUNS}; fără avertisment când îl conține', () => {
    expect(randeaza({ uat: 'uat-fictiv', subiect: 'S', text: 'text fără link' })).toContain(MESAJ_FARA_LINK)
    expect(randeaza({ uat: 'uat-fictiv', subiect: 'S', text: 'text cu {LINK_RASPUNS}' })).not.toContain(MESAJ_FARA_LINK)
  })
  it('câmp scris greșit sau {LINK_RASPUNS} în subiect: mesaj + butonul de creare dezactivat (serverul ar refuza oricum)', () => {
    const h1 = randeaza({ uat: 'uat-fictiv', subiect: 'S', text: 'text {LINK} {LINK_RASPUNS}', destinatari: [{ id: 'd1', nume: 'X', email: 'x@gazpet.ro' }] })
    expect(h1).toContain(MESAJ_CAMP_NECUNOSCUT(['LINK']).slice(0, 40))
    expect(h1).toMatch(/<button[^>]*disabled=""[^>]*>Creează ciorna/)
    const h2 = randeaza({ uat: 'uat-fictiv', subiect: 'S {LINK_RASPUNS}', text: 'text {LINK_RASPUNS}' })
    expect(h2).toContain(MESAJ_LINK_IN_SUBIECT)
  })
})

// ── DOVADA PE MAIN (sursele de pe origin/main prin git show) ──
describe('dovada pe main', () => {
  const vechi = n => { try { return execFileSync('git', ['show', `origin/main:${n}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\r\n/g, '\n') } catch { return null } }
  it('mailLoturi.js de pe main nu cunoaște fara_token (inventarul refuză rândul) și nu are mascarea; cel nou le are', async () => {
    const sursa = vechi('src/redari/mailLoturi.js'), comun = vechi('supabase/functions/_shared/redariMailF2.mjs')
    if (!sursa || !comun) return   // fără origin/main local (CI fără istoric): se sare, nu se simulează
    const TMP = join(process.cwd(), '.tmp'); mkdirSync(TMP, { recursive: true })
    const dir = mkdtempSync(join(TMP, 'mail_main_'))
    try {
      writeFileSync(join(dir, 'redariMailF2.mjs'), comun)
      writeFileSync(join(dir, 'mailLoturi.js'), sursa.replace("'../../supabase/functions/_shared/redariMailF2.mjs'", "'./redariMailF2.mjs'"))
      const mod = await import(pathToFileURL(join(dir, 'mailLoturi.js')).href + `?v=${Date.now()}`)
      expect(mod.MOTIVE_MAIL.fara_token).toBeUndefined()
      expect(() => mod.inventarMail([{ id: 'b', motive: ['fara_token'] }])).toThrow(/invalid/)
      expect(mod.mascheazaLink).toBeUndefined(); expect(mod.campuriNecunoscute).toBeUndefined()
    } finally { rmSync(dir, { recursive: true, force: true }) }
    expect(typeof mascheazaLink).toBe('function'); expect(inventarMail([{ id: 'b', motive: ['fara_token'] }]).motive.fara_token).toBe(1)
  })
  it('ecranul de pe main afișa textul brut al mesajului (tokenul în clar); cel nou îl maschează', () => {
    const ecranVechi = vechi('src/redari/ui/MailLoturiEcran.jsx')
    if (!ecranVechi) return
    expect(ecranVechi).toContain('{m.corp_text_final}</pre>'); expect(ecranVechi).not.toContain('mascheazaLink')
    const ecranNou = citeste('src/redari/ui/MailLoturiEcran.jsx')
    expect(ecranNou).toContain('{mascheazaLink(m.corp_text_final)}</pre>'); expect(ecranNou).not.toContain('{m.corp_text_final}</pre>')
  })
  it('migrarea 20261131a de pe main (încă în vigoare) scria același text pentru toți destinatarii: fn_red_mail_f2_text(p_text) direct în snapshot', () => {
    const m31a = vechi('supabase/migrations/20261131a_redari_mail_f2_loturi.sql')
    if (!m31a) return
    expect(m31a).toContain('msg.corp_text_final:=public.fn_red_mail_f2_text(p_text);')
    expect(MIG).toContain("msg.corp_text_final:=public.fn_red_mail_f2_text(public.fn_red_mail_f2_completeaza(p_text,campuri||jsonb_build_object('LINK_RASPUNS',public.fn_red_link_raspuns(tok))));")
  })
})
