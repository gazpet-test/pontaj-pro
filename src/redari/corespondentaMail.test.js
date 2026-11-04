import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { eEmailValid, eEmailGazpet, CAZURI_EMAIL, construiesteMailIntern, subiectIntern, OFFICE, motivFaraMail, ultimulMail, mesajRezultatMail, MESAJ_INCERT } from './corespondentaMail.js'
import { etagPuternicEgal, replyToIntern, ePdf, escHtml, pregatesteMailIntern } from '../../supabase/functions/_shared/redariCorespMail.mjs'
import { CAMPURI_CONTINUT, stariInFormular, valideazaCorespondenta, mesajEroareCoresp, COL_CORESPONDENTA } from './corespondenta.js'

const BAZA = {
  cod: 'B1', proiectCod: 'LOT1-PRUNISOR-JUPA', destinatar: 'ISC Mehedinți', destinatarEmail: 'registratura@isc.ro',
  mailSubiect: 'Documente de calitate', mailText: 'Bună ziua,\nVă transmitem…', expeditorEmail: 'Cristina.Dumitrescu@gazpet.ro',
  fisierNume: 'Adresa_ISC.pdf', fisierEtag: '"etag-1"', aprobatLa: '2026-11-04T08:00:00Z', aprobatDeNume: 'TRUSU RAZVAN', pregatitDeNume: 'DUMITRESCU CRISTINA',
}

describe('e-mail: aceleasi reguli ca CHECK-urile din BD (tabelul de paritate e si in DRY-ul 20261130f)', () => {
  it.each(CAZURI_EMAIL)('%j -> valid %s, gazpet %s', (v, valid, gazpet) => {
    expect(eEmailValid(v)).toBe(valid)
    expect(eEmailGazpet(v)).toBe(gazpet)
  })
  it('limita de 254 de caractere', () => {
    expect(eEmailValid('a'.repeat(240) + '@gazpet.ro')).toBe(true)
    expect(eEmailValid('a'.repeat(250) + '@gazpet.ro')).toBe(false)
    expect(eEmailGazpet('a'.repeat(250) + '@gazpet.ro')).toBe(false)
  })
  it('DRY-ul SQL contine aceleasi cazuri ca tabelul JS (paritate L19)', () => {
    const dry = readFileSync(new URL('../../supabase/tests/20261130f_redari_coresp_mail_dryrun.sql', import.meta.url), 'utf8')
    for (const [v, valid, gazpet] of CAZURI_EMAIL) {
      const lit = v.includes('\n') ? `E'${v.replace(/\n/g, '\\n')}'` : `'${v}'`
      expect(dry).toContain(`(${lit},${valid},${gazpet})`)
    }
  })
})

describe('mailul intern', () => {
  it('merge doar la expeditor (@gazpet.ro, litere mici) cu CC office@; subiect intern pe un rand', () => {
    const m = construiesteMailIntern(BAZA)
    expect(m.erori).toBeUndefined()
    expect(m.catre).toBe('cristina.dumitrescu@gazpet.ro')
    expect(m.cc).toEqual([OFFICE])
    expect(m.subiect).toBe('[De trimis B1] Documente de calitate')
    expect(m.text).toContain('1. Către: registratura@isc.ro')
    expect(m.html).toContain('registratura@isc.ro')
    expect(m.html).not.toMatch(/mailto:/)
  })
  it('expeditorul = office@ -> fara CC dublat', () => {
    expect(construiesteMailIntern({ ...BAZA, expeditorEmail: 'office@gazpet.ro' }).cc).toEqual([])
  })
  it('refuza expeditor din afara firmei si campuri lipsa (nu construieste nimic)', () => {
    expect(construiesteMailIntern({ ...BAZA, expeditorEmail: 'cineva@gmail.com' }).erori).toContain('Expeditorul trebuie să aibă o adresă @gazpet.ro.')
    expect(construiesteMailIntern({ ...BAZA, expeditorEmail: 'x@gazpet.ro.evil.com' }).erori?.length).toBeGreaterThan(0)
    const r = construiesteMailIntern({ ...BAZA, destinatarEmail: 'nu-e-mail', mailSubiect: ' ', mailText: '', fisierNume: '' })
    expect(r.erori).toHaveLength(4)
    expect(r.html).toBeUndefined()
  })
  it('escapeaza tot textul scris de editori (HTML / ghilimele) si scoate CR/LF din subiect', () => {
    const m = construiesteMailIntern({ ...BAZA, destinatar: '<img src=x onerror=alert(1)>', mailSubiect: 'a\r\nBcc: x@y.ro', mailText: '<script>alert("x")</script> & \'q\'', fisierNume: '"><b>.pdf' })
    expect(m.html).not.toMatch(/<script|<img|<b>"/)
    expect(m.html).toContain('&quot;&gt;&lt;b&gt;.pdf')
    expect(m.html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;q&#39;')
    expect(m.subiect).toBe('[De trimis B1] a Bcc: x@y.ro')
    expect(m.subiect).not.toMatch(/[\r\n]/)
    expect(escHtml('<&>"\'')).toBe('&lt;&amp;&gt;&quot;&#39;')
  })
  it('subiectul intern e plafonat la 300', () => {
    expect(subiectIntern('A1', 'x'.repeat(400))).toHaveLength(300)
  })
  it('r2 C-P3-01: ETag slab (W/) refuzat; doar egalitate exacta cu valoarea puternica aprobata', () => {
    expect(etagPuternicEgal('W/"abc"', '"abc"')).toBe(false)
    expect(etagPuternicEgal('w/"abc"', '"abc"')).toBe(false)
    expect(etagPuternicEgal('"abc"', '"abc"')).toBe(true)
    expect(etagPuternicEgal(' "abc" ', '"abc"')).toBe(true)
    expect(etagPuternicEgal('abc', '"abc"')).toBe(false)
    expect(etagPuternicEgal(null, '"abc"')).toBe(false)
    expect(etagPuternicEgal('', '')).toBe(false)
  })
  it('r2 C-P2-03: reply_to doar adresa @gazpet.ro a utilizatorului, altfel office@', () => {
    expect(replyToIntern('Cristina@Gazpet.ro')).toBe('cristina@gazpet.ro')
    expect(replyToIntern('admin.extern@gmail.com')).toBe(OFFICE)
    expect(replyToIntern('x@gazpet.ro.evil.com')).toBe(OFFICE)
    expect(replyToIntern(null)).toBe(OFFICE)
  })
  it('semnatura PDF', () => {
    expect(ePdf(new TextEncoder().encode('%PDF-1.7\n'))).toBe(true)
    expect(ePdf(new TextEncoder().encode('PK\u0003\u0004'))).toBe(false)
    expect(ePdf(new Uint8Array())).toBe(false)
  })
})

describe('butonul „Pregateste mailul”', () => {
  const rand = { id: 'r1', stare: 'aprobat', aprobat_la: '2026-11-04T08:00:00Z', aprobat_fisier_id: 'f1', destinatar_email: 'a@b.ro', mail_subiect: 's', mail_text: 't', expeditor_email: 'c@gazpet.ro' }
  const fa = { id: 'f1', path: 'P/corespondenta/B1/x.pdf' }
  it('activ doar pentru admin/editor, rand aprobat, PDF aprobat, campuri complete', () => {
    expect(motivFaraMail(rand, { poateScrie: true, fisierAprobat: fa })).toBeNull()
    expect(motivFaraMail(rand, { poateScrie: false, fisierAprobat: fa })).toMatch(/admin \/ editor/)
    // Copilot r2 P2-04: istoricul mailurilor necitit -> buton oprit
    expect(motivFaraMail(rand, { poateScrie: true, fisierAprobat: fa, istoricCitit: false })).toBe('Nu am putut citi istoricul mailurilor — reîncarcă.')
    expect(motivFaraMail({ ...rand, stare: 'draft', aprobat_la: null }, { poateScrie: true, fisierAprobat: fa })).toMatch(/după aprobarea/)
    expect(motivFaraMail({ ...rand, aprobat_fisier_id: null }, { poateScrie: true, fisierAprobat: null })).toMatch(/fișier/)
    expect(motivFaraMail(rand, { poateScrie: true, fisierAprobat: { ...fa, path: 'P/corespondenta/B1/x.docx' } })).toMatch(/nu e PDF/)
    expect(motivFaraMail({ ...rand, expeditor_email: 'c@yahoo.com' }, { poateScrie: true, fisierAprobat: fa })).toMatch(/@gazpet\.ro/)
    expect(motivFaraMail({ ...rand, destinatar_email: null }, { poateScrie: true, fisierAprobat: fa })).toMatch(/instituție/)
    expect(motivFaraMail({ ...rand, mail_text: ' ' }, { poateScrie: true, fisierAprobat: fa })).toMatch(/subiectul și textul/)
  })
  it('ultimul mail al randului = primul din lista ordonata de query', () => {
    const l = [{ id: 'm3', corespondenta_id: 'r2' }, { id: 'm2', corespondenta_id: 'r1' }, { id: 'm1', corespondenta_id: 'r1' }]
    expect(ultimulMail(l, 'r1').id).toBe('m2')
    expect(ultimulMail(l, 'r9')).toBeNull()
  })
  it('rezultatul edge (varianta A): ok; refuz clar afisat ca atare; orice rezultat incert -> mesajul standard', async () => {
    expect(MESAJ_INCERT).toBe('Rezultat incert — verifică inboxul expeditorului; dacă mailul nu a venit, poți apăsa din nou după 60 s (poate produce un mail intern dublu).')
    expect(await mesajRezultatMail({ data: { ok: true, catre: 'c@gazpet.ro', cc: [OFFICE] }, error: null })).toMatchObject({ ok: true, incert: false })
    const clar = await mesajRezultatMail({ data: null, error: { message: 'Edge Function returned a non-2xx status code', context: { json: async () => ({ error: 'mailul a fost deja pregatit acum 12 s; asteapta un minut' }) } } })
    expect(clar).toEqual({ ok: false, incert: false, text: 'mailul a fost deja pregatit acum 12 s; asteapta un minut' })
    for (const rez of [
      { data: null, error: { message: 'x', context: { json: async () => ({ error: 'orice', incert: true }) } } },   // 5xx / timeout Resend / RPC netransparent
      { data: null, error: { message: 'Failed to fetch' } },                                                             // retea
      { data: null, error: { message: 'x', context: { json: async () => { throw new Error('html') } } } },             // raspuns fara corp JSON
      { data: { ok: false, incert: true, resend_acceptat: true, urma_inchisa: false, error: 'x' }, error: null },       // inchidere neconfirmata
    ]) expect(await mesajRezultatMail(rez)).toEqual({ ok: false, incert: true, text: MESAJ_INCERT })
  })
})

// ── Fluxul edge-ului cu BD / Storage / Resend simulate (r2: J-P3-5, C-P2-02, C-P2-03, C-P3-01, J-P2-2) ─────────────────────────────────────────
const CID = '11111111-1111-4111-8111-111111111111', MID = '44444444-4444-4444-8444-444444444444', FID = '33333333-3333-4333-8333-333333333333'
const PDF = new TextEncoder().encode('%PDF-1.7\nx')
const payloadRpc = (extra = {}) => ({ mail_id: MID, cod: 'B1', proiect_cod: 'TEST-RAZVAN', destinatar: 'ISC', destinatar_email: 'reg@isc.ro',
  mail_subiect: 'Subiect', mail_text: 'Text', expeditor_email: 'cristina@gazpet.ro', cc: OFFICE, aprobat_la: '2026-11-04T08:00:00Z', aprobat_de_nume: 'TRUSU', pregatit_de_nume: 'CRISTINA',
  fisier: { id: FID, path: 'TEST-RAZVAN/corespondenta/B1/x.pdf', nume_original: 'x.pdf', marime: 10, etag: '"etag-1"' }, ...extra })
const raspunsStorage = (etag = '"etag-1"', ok = true) => ({ ok, status: ok ? 200 : 403, headers: { get: k => (k === 'etag' ? etag : k === 'content-length' ? String(PDF.length) : null) }, arrayBuffer: async () => PDF.buffer, body: { cancel: async () => {} } })
function fals({ incepe = { data: payloadRpc(), error: null }, inchide = n => ({ data: n.p_stare, error: null }), storage = raspunsStorage(), resend = { ok: true, status: 200, json: async () => ({ id: 're_1' }) } } = {}) {
  const apeluri = { rpc: [], resend: [], descarca: 0 }
  const dep = {
    rpc: async (nume, arg) => { apeluri.rpc.push([nume, arg]); if (nume === 'fn_red_coresp_mail_incepe') return typeof incepe === 'function' ? incepe(arg) : incepe; return typeof inchide === 'function' ? inchide(arg) : inchide },
    descarca: async () => { apeluri.descarca++; if (storage instanceof Error) throw storage; return storage },
    trimiteResend: async (corp, cheie) => { apeluri.resend.push({ corp, cheie }); if (resend instanceof Error) throw resend; return resend },
    b64: () => 'QkFTRTY0',
  }
  return { dep, apeluri }
}
const CERERE = { corespondenta_id: CID, versiune: 3, fisier_id: FID, userEmail: 'cristina@gazpet.ro' }
const inchideri = a => a.rpc.filter(([n]) => n === 'fn_red_coresp_mail_inchide').map(([, x]) => x.p_stare)

describe('fluxul edge pregatesteMailIntern', () => {
  it('succes: RPC cu versiunea + fisierul confirmat (J-P2-3), Idempotency-Key = id-ul incercarii, urma inchisa trimis', async () => {
    const { dep, apeluri } = fals()
    const r = await pregatesteMailIntern(CERERE, dep)
    expect(r.status).toBe(200); expect(r.body).toMatchObject({ ok: true, resend_id: 're_1', catre: 'cristina@gazpet.ro', cc: [OFFICE] })
    expect(apeluri.rpc[0]).toEqual(['fn_red_coresp_mail_incepe', { p_corespondenta_id: CID, p_versiune_confirmata: 3, p_fisier_id_confirmat: FID }])
    expect(apeluri.resend).toHaveLength(1); expect(apeluri.resend[0].cheie).toBe(MID)
    expect(apeluri.resend[0].corp.to).toEqual(['cristina@gazpet.ro']); expect(apeluri.resend[0].corp.cc).toEqual([OFFICE])
    expect(inchideri(apeluri)).toEqual(['trimis'])
  })
  it('J-P3-5 / C-P2-02: Resend 200 + eroare la inchiderea urmei -> incert (resend_acceptat, urma_inchisa false), o singura trimitere', async () => {
    const { dep, apeluri } = fals({ inchide: { data: null, error: { code: '23514', message: 'redari: x' } } })
    const r = await pregatesteMailIntern(CERERE, dep)
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ ok: false, incert: true, resend_acceptat: true, urma_inchisa: false, mail_id: MID, error: MESAJ_INCERT })
    expect(apeluri.resend).toHaveLength(1)
  })
  it('J-P3-5: Resend 200 + timeout (exceptie) la inchidere -> incert', async () => {
    const { dep } = fals({ inchide: () => { throw new Error('timeout') } })
    const r = await pregatesteMailIntern(CERERE, dep)
    expect(r.body).toMatchObject({ ok: false, incert: true, resend_acceptat: true, urma_inchisa: false })
  })
  it('C-P2-03: utilizator cu adresa externa -> reply_to office@; @gazpet.ro -> adresa lui', async () => {
    const a = fals(); await pregatesteMailIntern({ ...CERERE, userEmail: 'admin@gmail.com' }, a.dep)
    expect(a.apeluri.resend[0].corp.reply_to).toBe(OFFICE)
    const b = fals(); await pregatesteMailIntern({ ...CERERE, userEmail: 'Editor@Gazpet.ro' }, b.dep)
    expect(b.apeluri.resend[0].corp.reply_to).toBe('editor@gazpet.ro')
  })
  it('C-P3-01: antet ETag slab W/"etag-1" fata de "etag-1" aprobat -> refuz, nimic trimis, urma eroare', async () => {
    const { dep, apeluri } = fals({ storage: raspunsStorage('W/"etag-1"') })
    const r = await pregatesteMailIntern(CERERE, dep)
    expect(r.status).toBe(409); expect(r.body.error).toMatch(/eTag/)
    expect(apeluri.resend).toHaveLength(0); expect(inchideri(apeluri)).toEqual(['eroare'])
  })
  it('Resend: 5xx / 429 / exceptie -> incert (urma necunoscut); 422 -> refuz clar (urma eroare); niciun retry automat', async () => {
    const a = fals({ resend: { ok: false, status: 503, json: async () => ({}) } }); const ra = await pregatesteMailIntern(CERERE, a.dep)
    expect(ra.body).toMatchObject({ incert: true, error: MESAJ_INCERT }); expect(inchideri(a.apeluri)).toEqual(['necunoscut']); expect(a.apeluri.resend).toHaveLength(1)
    const b = fals({ resend: new Error('timeout') }); const rb = await pregatesteMailIntern(CERERE, b.dep)
    expect(rb.body.incert).toBe(true); expect(inchideri(b.apeluri)).toEqual(['necunoscut'])
    const c = fals({ resend: { ok: false, status: 422, json: async () => ({ message: 'bad' }) } }); const rc = await pregatesteMailIntern(CERERE, c.dep)
    expect(rc.body.incert).toBeUndefined(); expect(rc.body.error).toMatch(/Resend a refuzat/); expect(inchideri(c.apeluri)).toEqual(['eroare'])
  })
  it('esec inainte de trimitere (descarcare cazuta) -> refuz clar, urma eroare, nimic trimis', async () => {
    const a = fals({ storage: new Error('retea') }); const r = await pregatesteMailIntern(CERERE, a.dep)
    expect(r.body.incert).toBeUndefined(); expect(inchideri(a.apeluri)).toEqual(['eroare']); expect(a.apeluri.resend).toHaveLength(0)
  })
  it('refuzurile RPC trec mai departe (403 / 409), fara descarcare; eroare neasteptata nu se expune; cerere incompleta -> 400 fara RPC', async () => {
    const a = fals({ incepe: { data: null, error: { code: '42501', message: 'redari: doar admin / editor pe Redari pregatesc mailul' } } })
    expect(await pregatesteMailIntern(CERERE, a.dep)).toEqual({ status: 403, body: { error: 'doar admin / editor pe Redari pregatesc mailul' } })
    const b = fals({ incepe: { data: null, error: { code: '23514', message: 'redari: randul s-a schimbat intre timp; reincarca si verifica' } } })
    expect((await pregatesteMailIntern(CERERE, b.dep)).status).toBe(409); expect(b.apeluri.descarca).toBe(0)
    // eroare RPC netransparenta -> incert, fara text brut (L10)
    const c = fals({ incepe: { data: null, error: { code: 'XX000', message: 'connection string secreta' } } })
    expect(await pregatesteMailIntern(CERERE, c.dep)).toEqual({ status: 500, body: { error: MESAJ_INCERT, incert: true } })
    const e = fals({ incepe: () => { throw new Error('retea') } })
    expect((await pregatesteMailIntern(CERERE, e.dep)).body).toEqual({ error: MESAJ_INCERT, incert: true })
    const d = fals(); expect((await pregatesteMailIntern({ ...CERERE, versiune: '3' }, d.dep)).status).toBe(400); expect(d.apeluri.rpc).toHaveLength(0)
  })
  it('expeditor din afara firmei in payload -> nimic trimis; fisier care nu e PDF -> nimic trimis', async () => {
    const a = fals({ incepe: { data: payloadRpc({ expeditor_email: 'x@gmail.com' }), error: null } }); await pregatesteMailIntern(CERERE, a.dep)
    expect(a.apeluri.resend).toHaveLength(0)
    const b = fals({ storage: { ...raspunsStorage(), arrayBuffer: async () => new TextEncoder().encode('PK..').buffer } }); await pregatesteMailIntern(CERERE, b.dep)
    expect(b.apeluri.resend).toHaveLength(0); expect(inchideri(b.apeluri)).toEqual(['eroare'])
  })
})

describe('continutul aprobat include campurile mailului (oglinda triggerului 20261130f)', () => {
  const r = { stare: 'aprobat', aprobat_la: '2026-11-04T08:00:00Z', destinatar: 'ISC', subiect: 'x', expeditor: 'C', documente: 'd',
    destinatar_email: 'a@b.ro', mail_subiect: 's', mail_text: 't', expeditor_email: 'c@gazpet.ro' }
  it.each(['destinatar_email', 'mail_subiect', 'mail_text', 'expeditor_email'])('%s schimbat dupa aprobare -> doar draft / la avocat / anulat', k => {
    expect(CAMPURI_CONTINUT).toContain(k)
    expect(stariInFormular(r, { ...r })).toContain('trimis')
    expect(stariInFormular(r, { ...r, [k]: 'altceva@gazpet.ro' })).toEqual(['draft', 'la_avocat', 'anulat'])
  })
  it('coloanele noi se citesc', () => {
    for (const k of ['destinatar_email', 'mail_subiect', 'mail_text', 'expeditor_email']) expect(COL_CORESPONDENTA).toContain(k)
  })
  it('validare: e-mailuri normalizate, expeditor doar @gazpet.ro, subiect pe un rand, fara trunchiere tacuta', () => {
    const baza = { ordine: 1, destinatar: 'a', subiect: 'b', stare: 'draft' }
    const ok = valideazaCorespondenta({ ...baza, destinatar_email: ' Registratura@ISC.ro ', expeditor_email: ' C@Gazpet.RO', mail_subiect: ' S ', mail_text: 'l1\r\nl2' })
    expect(ok.erori).toEqual([])
    expect(ok.valori).toMatchObject({ destinatar_email: 'registratura@isc.ro', expeditor_email: 'c@gazpet.ro', mail_subiect: 'S', mail_text: 'l1\nl2' })
    expect(valideazaCorespondenta({ ...baza, expeditor_email: 'c@gmail.com' }).erori).toEqual(['E-mailul expeditorului trebuie să fie o adresă @gazpet.ro.'])
    expect(valideazaCorespondenta({ ...baza, destinatar_email: 'fara-arond' }).erori).toEqual(['E-mailul instituției nu e o adresă validă.'])
    expect(valideazaCorespondenta({ ...baza, mail_subiect: 'a\nb' }).erori).toHaveLength(1)
    expect(valideazaCorespondenta({ ...baza, mail_subiect: 'x'.repeat(301) }).erori).toHaveLength(1)
    expect(valideazaCorespondenta({ ...baza, mail_text: 'x'.repeat(20001) }).erori).toHaveLength(1)
    expect(valideazaCorespondenta({ ...baza, destinatar_email: '', expeditor_email: '' }).valori).toMatchObject({ destinatar_email: null, expeditor_email: null })
  })
  it('erorile CHECK din BD sunt traduse', () => {
    expect(mesajEroareCoresp({ code: '23514', message: 'new row for relation "red_corespondenta" violates check constraint "red_corespondenta_expeditor_email_ck"' })).toMatch(/@gazpet\.ro/)
    expect(mesajEroareCoresp({ code: '23514', message: 'violates check constraint "red_corespondenta_destinatar_email_ck"' })).toMatch(/instituției/)
  })
})

describe('edge function redari-coresp-mail (verificari statice)', () => {
  const src = readFileSync(new URL('../../supabase/functions/redari-coresp-mail/index.ts', import.meta.url), 'utf8')
  const flux = readFileSync(new URL('../../supabase/functions/_shared/redariCorespMail.mjs', import.meta.url), 'utf8')
  it('foloseste fluxul partajat, fara service_role, getUser, Idempotency-Key = id-ul incercarii', () => {
    expect(src).toContain("import { pregatesteMailIntern } from '../_shared/redariCorespMail.mjs'")
    expect(src + flux).not.toMatch(/SERVICE_ROLE/)
    expect(src).toContain('uc.auth.getUser(jwt)')
    expect(src).toContain("'Idempotency-Key': cheie")
    expect(src + flux).not.toMatch(/intentie/)
    expect(flux).toContain('dep.trimiteResend(corp, mailId)')
  })
  it('fara scriere in BD din interiorul vreunui catch (anti-bug worker killed)', () => {
    expect(src.slice(src.lastIndexOf('} catch (_e) {'))).not.toMatch(/rpc\(|inchide\(|\.from\(/)
    const blocuri = flux.match(/catch\s*(\([^)]*\))?\s*\{[^}]*\}/g) || []
    expect(blocuri.length).toBeGreaterThan(0)
    for (const bloc of blocuri) expect(bloc).not.toMatch(/rpc|inchide|esec/)
  })
})
