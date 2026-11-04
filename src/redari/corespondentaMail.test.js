import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { eEmailValid, eEmailGazpet, CAZURI_EMAIL, construiesteMailIntern, subiectIntern, OFFICE, motivFaraMail, ultimulMail, mesajRezultatMail } from './corespondentaMail.js'
import { normEtag, ePdf, escHtml } from '../../supabase/functions/_shared/redariCorespMail.mjs'
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
  it('eTag normalizat (W/) si semnatura PDF', () => {
    expect(normEtag(' W/"abc" ')).toBe('"abc"')
    expect(normEtag('"abc"')).toBe(normEtag('"abc"'))
    expect(normEtag(null)).toBe('')
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
  it('rezultatul edge: ok / eroare din corpul raspunsului / necunoscut', async () => {
    expect((await mesajRezultatMail({ data: { ok: true, catre: 'c@gazpet.ro', cc: [OFFICE] }, error: null })).ok).toBe(true)
    const r = await mesajRezultatMail({ data: null, error: { message: 'Edge Function returned a non-2xx status code', context: { json: async () => ({ error: 'mailul a fost deja pregatit acum 12 s; asteapta un minut' }) } } })
    expect(r).toEqual({ ok: false, necunoscut: false, text: 'mailul a fost deja pregatit acum 12 s; asteapta un minut' })
    const n = await mesajRezultatMail({ data: null, error: { message: 'x', context: { json: async () => ({ error: 'Nu se știe', necunoscut: true }) } } })
    expect(n.necunoscut).toBe(true)
    expect((await mesajRezultatMail({ data: null, error: { message: 'Failed to fetch' } })).text).toBe('Failed to fetch')
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
  it('foloseste modulul partajat, fara service_role, cu poarta prin RPC si idempotenta Resend', () => {
    expect(src).toContain("from '../_shared/redariCorespMail.mjs'")
    expect(src).not.toMatch(/SERVICE_ROLE/)
    expect(src).toContain("uc.rpc('fn_red_coresp_mail_incepe'")
    expect(src).toContain("uc.rpc('fn_red_coresp_mail_inchide'")
    expect(src).toContain("'Idempotency-Key'")
    expect(src).toContain('uc.auth.getUser(jwt)')
    expect(src).toMatch(/eEmailGazpet\(catre\)/)
  })
  it('fara scriere in BD din catch-ul exterior (anti-bug worker killed)', () => {
    const catchExt = src.slice(src.lastIndexOf('} catch (_e) {'))
    expect(catchExt).not.toMatch(/rpc\(|inchide\(|\.from\(/)
  })
})
