// Redări e-mail — linkul PERSONAL de răspuns și câmpurile completate pe fiecare mesaj (19.11.2026, migrarea 20261131i): partea JS a probelor.
//  * forma „{NUME}” și câmpurile necunoscute: paritate L19 cu regex-ul din migrare, pe același tabel de cazuri (src/redari/__tests__/campuri_mail_cazuri.json;
//    partea SQL: scripts/pglite/test_redari_mail_link_local.mjs) — inclusiv refuzul oricărei acolade rămase (nume de orice lungime, „{}”, acoladă neînchisă)
//    și linkul personal literal (r2, Jakarinos #1138 P1 / P2);
//  * valorile câmpurilor lotului: paritate cu convocatorul (docx.js: formatDataRo pe sesiune_zi1..3, program_zi1..3, uat.nume, contact_telefon) pe tabelul
//    comun src/redari/__tests__/campuri_lot_cazuri.json, pe care PGlite îl dă lui fn_red_mail_f2_campuri (L19);
//  * linkul: aceeași definiție în JS (linkRaspuns, docx.js) și în SQL (fn_red_link_raspuns — prefixul citit din textul migrării);
//  * mascarea: tokenul (43 de caractere) nu apare în previzualizare, doar ultimele 6; textul fără link rămâne neschimbat;
//  * inventarul: motivul nou fara_token e cunoscut și numărat; ecranul: lista câmpurilor, avertismentul fără {LINK_RASPUNS}, crearea oprită la câmp greșit /
//    acolade rămase / link copiat, previzualizarea cu linkul mascat (tokenul nu e în HTML);
//  * dovada istorică (git show pe SHA-ul fix e13e7ef8 = main dinaintea PR-ului): mailLoturi.js nu cunoștea fara_token (inventarul arunca), ecranul afișa textul brut.
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
import { CAMPURI_MAIL, NUME_CAMPURI, CAMP_LINK, campuriDinText, campuriNecunoscute, acoladeInvalide, areLinkRaspuns, areLinkLiteral, mascheazaLink, MASCA_TOKEN,
  MESAJ_FARA_LINK, MESAJ_LINK_LITERAL, MOTIVE_MAIL, inventarMail } from './mailLoturi.js'
import { linkRaspuns, formatDataRo } from './docx.js'
import MailLoturiEcran, { MESAJ_CAMP_NECUNOSCUT, MESAJ_LINK_IN_SUBIECT, MESAJ_ACOLADE } from './ui/MailLoturiEcran.jsx'

const citeste = cale => readFileSync(cale, 'utf8').replace(/\r\n/g, '\n')
const MIG = citeste('supabase/migrations/20261131i_redari_mail_link_personal.sql')
const CAZURI = JSON.parse(citeste('src/redari/__tests__/campuri_mail_cazuri.json'))
const CAZURI_LOT = JSON.parse(citeste('src/redari/__tests__/campuri_lot_cazuri.json'))
const TOK = 'T1' + 'a'.repeat(41), TOK2 = 'T2' + 'b'.repeat(41)
const LINK = linkRaspuns(TOK)
// main dinaintea PR-ului #1138 (îmbinarea F2b #1134): dovada istorică nu depinde de ce mai intră pe main după îmbinare
const SHA_INAINTE = 'e13e7ef8'

describe('câmpurile textului: forma {NUME} (paritate cu SQL pe tabelul comun de cazuri)', () => {
  it('lista câmpurilor: LINK_RASPUNS obligatoriu suportat + cele patru ale lotului; numele apar în migrare', () => {
    expect(NUME_CAMPURI).toEqual(['LINK_RASPUNS', 'COMUNA', 'ZILE', 'PROGRAM', 'TEL'])
    expect(CAMP_LINK).toBe('LINK_RASPUNS')
    for (const n of NUME_CAMPURI) expect(MIG).toContain(`'${n}'`)
    expect(CAMPURI_MAIL.filter(c => c.perMesaj).map(c => c.nume)).toEqual(['LINK_RASPUNS'])
  })
  it('regex-ul din migrare e cel așteptat (forma SQL fără backslash, fără limită de lungime) și verificarea finală refuză ORICE acoladă', () => {
    expect(/regexp_matches\(p_text,'\[\{\]\(\[\^\{\}\]\+\)\[\}\]','g'\)/.test(MIG)).toBe(true)
    expect(MIG).toContain(` IF rez ~ '[{}]' THEN RAISE EXCEPTION 'camp_necunoscut`)
    expect(MIG).not.toContain('{1,40}')
  })
  it('tabelul de cazuri are toate coloanele paritatii (campuri, necunoscute, refuz, link_literal) și cazurile cerute de review', () => {
    for (const c of CAZURI) { expect(Array.isArray(c.campuri)).toBe(true); expect(Array.isArray(c.necunoscute)).toBe(true); expect(typeof c.refuz).toBe('boolean'); expect(typeof c.link_literal).toBe('boolean') }
    expect(CAZURI.some(c => c.campuri.some(n => n.length === 41) && c.refuz)).toBe(true)          // numele peste limita veche a parserului = refuz
    expect(CAZURI.some(c => c.text.includes('{}') && c.refuz)).toBe(true)                            // acolade goale = refuz
    expect(CAZURI.some(c => c.campuri.includes(' LINK_RASPUNS ') && c.refuz)).toBe(true)              // forma greșită cu spații = refuz
    expect(CAZURI.some(c => c.link_literal && c.campuri.includes('LINK_RASPUNS'))).toBe(true)       // link literal + {LINK_RASPUNS} în același text
    expect(CAZURI.some(c => c.link_literal && !/redari\.gazpet\.ro/.test(c.text))).toBe(true)       // altă origine
  })
  it.each(CAZURI.map(c => [c.text.slice(0, 40), c]))('%s', (_, c) => {
    expect(campuriDinText(c.text)).toEqual(c.campuri)
    expect(campuriNecunoscute(c.text)).toEqual(c.necunoscute)
    expect(areLinkRaspuns(c.text)).toBe(c.campuri.includes('LINK_RASPUNS'))
    expect(acoladeInvalide(c.text)).toBe(c.refuz)          // ce refuză serverul după completarea câmpurilor cunoscute (paritate SQL: fn_red_mail_f2_completeaza)
    expect(areLinkLiteral(c.text)).toBe(c.link_literal)    // paritate SQL: fn_red_mail_f2_link_strain(text, NULL) (SQL prinde în plus tokenul copiat fără adresă)
  })
  it('intrări nule / nestring = fără câmpuri, fără acolade, fără link', () => {
    expect(campuriDinText(null)).toEqual([]); expect(campuriDinText(undefined)).toEqual([]); expect(campuriNecunoscute('')).toEqual([])
    expect(acoladeInvalide(null)).toBe(false); expect(areLinkLiteral(undefined)).toBe(false)
  })
})

describe('valorile câmpurilor lotului: paritate cu convocatorul (același tabel îl primește fn_red_mail_f2_campuri în PGlite)', () => {
  // regula din migrare, scrisă aici din CÂMPURILE CONVOCATORULUI (docx.js: zi1..3 = formatDataRo(sesiune_zi*), program1..3 = program_zi*, uat = nume,
  // contact_telefon): ZILE = zilele legate cu „, ” și „ și ”; PROGRAM doar dacă e același (nevid) în toate zilele; COMUNA / TEL fără spații în plus
  const dinConvocator = (u, pr) => {
    const zile = [u.sesiune_zi1, u.sesiune_zi2, u.sesiune_zi3].map(formatDataRo).filter(Boolean)
    const programe = [u.sesiune_zi1 && (u.program_zi1 ?? ''), u.sesiune_zi2 && (u.program_zi2 ?? ''), u.sesiune_zi3 && (u.program_zi3 ?? '')].filter(p => p !== null && p !== undefined).map(p => String(p).trim())
    return {
      COMUNA: (u.nume ?? '').trim() || null,
      ZILE: zile.length ? (zile.length === 1 ? zile[0] : zile.slice(0, -1).join(', ') + ' și ' + zile[zile.length - 1]) : null,
      PROGRAM: zile.length && programe[0] && programe.every(p => p === programe[0]) ? programe[0] : null,
      TEL: (pr.contact_telefon ?? '').trim() || null,
    }
  }
  it('tabelul acoperă: două zile cu același program, fără sesiune, programe diferite', () => {
    expect(CAZURI_LOT.map(c => c.id)).toEqual(['A', 'FARA', 'DIF'])
    expect(CAZURI_LOT.find(c => c.id === 'A').asteptat.PROGRAM).not.toBeNull(); expect(CAZURI_LOT.find(c => c.id === 'DIF').asteptat.PROGRAM).toBeNull()
  })
  it.each(CAZURI_LOT.map(c => [c.id, c]))('UAT %s: valorile derivate din câmpurile convocatorului = cele așteptate (= SQL pe PGlite)', (_, c) => {
    expect(dinConvocator(c.uat, c.proiect)).toEqual(c.asteptat)
    // formatul datei e cel al convocatorului (ZZ.LL.AAAA), nu altă formă
    for (const z of [c.uat.sesiune_zi1, c.uat.sesiune_zi2, c.uat.sesiune_zi3].filter(Boolean)) expect(c.asteptat.ZILE).toContain(formatDataRo(z))
  })
  it('migrarea citește exact coloanele convocatorului și formatează data ca formatDataRo (DD.MM.YYYY)', () => {
    for (const col of ['sesiune_zi1', 'sesiune_zi2', 'sesiune_zi3', 'program_zi1', 'program_zi2', 'program_zi3', 'contact_telefon']) expect(MIG).toContain(col)
    expect(MIG).toContain(`to_char(s.z,'DD.MM.YYYY')`)
    expect(MIG).toContain(`array_to_string(zile[1:cardinality(zile)-1],', ')||' și '||zile[cardinality(zile)]`)
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
  it('acolade rămase (nume de 41 de caractere, „{}”, acoladă neînchisă) sau link personal copiat: mesaj + butonul dezactivat', () => {
    const dst = [{ id: 'd1', nume: 'X', email: 'x@gazpet.ro' }]
    for (const text of [`text {${'A'.repeat(41)}} {LINK_RASPUNS}`, 'text {} {LINK_RASPUNS}', 'text {LINK_RASPUNS și {COMUNA']) {
      const h = randeaza({ uat: 'uat-fictiv', subiect: 'S', text, destinatari: dst })
      expect(h).toMatch(/<button[^>]*disabled=""[^>]*>Creează ciorna/)
      expect(h.includes(MESAJ_ACOLADE) || h.includes('Câmp necunoscut în text')).toBe(true)
    }
    const h3 = randeaza({ uat: 'uat-fictiv', subiect: 'S', text: `Răspuns: ${LINK} și {LINK_RASPUNS}`, destinatari: dst })
    expect(h3).toContain(MESAJ_LINK_LITERAL); expect(h3).toMatch(/<button[^>]*disabled=""[^>]*>Creează ciorna/)   // (textarea arată ce a tastat owner-ul; nimic nu pleacă)
    const h4 = randeaza({ uat: 'uat-fictiv', subiect: `S ${LINK}`, text: 'text {LINK_RASPUNS}', destinatari: dst })
    expect(h4).toContain(MESAJ_LINK_LITERAL)
    // r3 (Jakarinos #1138 P1): linkul copiat cu %54 în loc de „T” (routerul îl decodează) și calea cu majuscule = tot link copiat, butonul oprit
    const h5 = randeaza({ uat: 'uat-fictiv', subiect: 'S', text: `Răspuns: https://redari.gazpet.ro/redari/raspuns/%54${TOK.slice(1)} și {LINK_RASPUNS}`, destinatari: dst })
    expect(h5).toContain(MESAJ_LINK_LITERAL); expect(h5).toMatch(/<button[^>]*disabled=""[^>]*>Creează ciorna/)
    expect(randeaza({ uat: 'uat-fictiv', subiect: 'S HTTPS://REDARI.GAZPET.RO/REDARI/RASPUNS/', text: 'text {LINK_RASPUNS}', destinatari: dst })).toContain(MESAJ_LINK_LITERAL)
    // „20%” și un URL străin codificat nu blochează nimic
    expect(randeaza({ uat: 'uat-fictiv', subiect: 'Reducere 20%', text: 'Plan: https://exemplu.invalid/plan%20lucrari.pdf {LINK_RASPUNS}', destinatari: dst })).not.toContain(MESAJ_LINK_LITERAL)
    // textul corect: nicio avertizare, butonul fără motiv de blocare (rămâne dezactivat doar pentru că nu e bifat niciun destinatar în această randare)
    const ok = randeaza({ uat: 'uat-fictiv', subiect: 'S {COMUNA}', text: 'text {COMUNA} {LINK_RASPUNS}', destinatari: dst })
    expect(ok).not.toContain(MESAJ_ACOLADE); expect(ok).not.toContain(MESAJ_LINK_LITERAL); expect(ok).not.toContain('role="alert"'); expect(ok).toMatch(/<button[^>]*title=""[^>]*>Creează ciorna/)
  })
})

// ── DOVADA ISTORICĂ (sursele de pe main dinaintea PR-ului, prin git show pe SHA fix) ──
describe('dovada pe main dinaintea PR-ului', () => {
  const vechi = n => { try { return execFileSync('git', ['show', `${SHA_INAINTE}:${n}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\r\n/g, '\n') } catch { return null } }
  it('mailLoturi.js de pe main nu cunoaște fara_token (inventarul refuză rândul) și nu are mascarea; cel nou le are', async () => {
    const sursa = vechi('src/redari/mailLoturi.js'), comun = vechi('supabase/functions/_shared/redariMailF2.mjs')
    if (!sursa || !comun) return   // fără istoric local (CI cu clonă superficială): se sare, nu se simulează
    expect(sursa).not.toContain('fara_token'); expect(comun).not.toContain('mascheazaLink')   // SHA-ul fix e chiar cel dinaintea PR-ului
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
  it('runda 1 a PR-ului (d0286c29) lăsa să treacă numele mai lungi de 40 de caractere și linkul literal; helperul nou le prinde', async () => {
    const comun = (() => { try { return execFileSync('git', ['show', 'd0286c29:supabase/functions/_shared/redariMailF2.mjs'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\r\n/g, '\n') } catch { return null } })()
    if (!comun) return
    const TMP = join(process.cwd(), '.tmp'); mkdirSync(TMP, { recursive: true })
    const dir = mkdtempSync(join(TMP, 'mail_r1_'))
    try {
      writeFileSync(join(dir, 'redariMailF2.mjs'), comun)
      const mod = await import(pathToFileURL(join(dir, 'redariMailF2.mjs')).href + `?v=${Date.now()}`)
      const lung = CAZURI.find(c => c.campuri.some(n => n.length === 41))
      expect(mod.campuriNecunoscute(lung.text)).not.toEqual(lung.necunoscute)   // runda 1: numele de 41 de caractere nu era văzut deloc
      expect(mod.acoladeInvalide).toBeUndefined(); expect(mod.areLinkLiteral).toBeUndefined()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
