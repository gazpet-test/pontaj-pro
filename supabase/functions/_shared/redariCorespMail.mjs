// redariCorespMail.mjs — Redări Corespondență, „📧 Pregătește mailul” (decizia Răzvan 04.11.2026, migrarea 20261130f).
// Modul PARTAJAT, JS simplu (fără TypeScript / dependențe): îl importă edge function-ul redari-coresp-mail (Deno) și UI-ul / testele (Vite / vitest),
// ca regulile de e-mail și HTML-ul mailului intern să aibă O SINGURĂ definiție (L19). Regex-urile de e-mail sunt și în CHECK-urile din BD
// (20261130f): DRY-ul migrării rulează același tabel de cazuri ca testul vitest (CAZURI_EMAIL), pentru paritate.
// Mailul intern merge DOAR la expeditor (@gazpet.ro) + CC office@: platforma NU trimite nimic în afara firmei; expeditorul copiază adresa,
// subiectul și textul într-un mail nou și îl trimite el.

export const OFFICE = 'office@gazpet.ro'
export const MAX_EMAIL = 254
export const MAX_SUBIECT_MAIL = 300
export const MAX_TEXT_MAIL = 20000

// Aceeași formă ca CHECK-ul red_corespondenta_destinatar_email_ck (PostgreSQL ARE): local@domeniu.tld, fără spații, etichete fără „-” la capete.
export const RX_EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/
// Aceeași formă ca CHECK-ul red_corespondenta_expeditor_email_ck: lower(x) ~ '^[a-z0-9._%+-]+@gazpet\.ro$'
export const RX_GAZPET = /^[a-z0-9._%+-]+@gazpet\.ro$/

export const normEmail = v => String(v ?? '').trim().toLowerCase()
export const eEmailValid = v => { const s = String(v ?? ''); return s.length > 0 && s.length <= MAX_EMAIL && RX_EMAIL.test(s) }
export const eEmailGazpet = v => { const s = String(v ?? ''); return s.length > 0 && s.length <= MAX_EMAIL && RX_GAZPET.test(s.toLowerCase()) }

// Tabelul de paritate JS ↔ SQL (același în supabase/tests/20261130f_redari_coresp_mail_dryrun.sql). [valoare, e-mail valid, @gazpet.ro]
export const CAZURI_EMAIL = [
  ['dccprunisorjupa@transgaz.ro', true, false],
  ['registratura@isc-mehedinti.ro', true, false],
  ['Office@Gazpet.ro', true, true],
  ['cristina.dumitrescu@gazpet.ro', true, true],
  ['a+b@gazpet.ro', true, true],
  ['x@gazpet.ro.evil.com', true, false],
  ['x@gazpet-ro.com', true, false],
  ['x@sub.gazpet.ro', true, false],
  ['x@gazpetXro', false, false],
  ['fara-arond.ro', false, false],
  ['a b@gazpet.ro', false, false],
  ['a@-gazpet.ro', false, false],
  ['a@gazpet', false, false],
  ['a@@gazpet.ro', false, false],
  ['<a@gazpet.ro>', false, false],
  ['a@gazpet.ro\nBcc: b@x.ro', false, false],
  ['', false, false],
]

export const escHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const linie = s => String(s ?? '').replace(/[\r\n\t]+/g, ' ').trim()

// eTag normalizat pentru comparație (antetul HTTP poate veni cu prefix „W/”; în storage.objects.metadata e cu ghilimele, ca antetul).
export const normEtag = v => String(v ?? '').trim().replace(/^W\//, '')
// PDF = începe cu „%PDF-” (primii 5 octeți)
export const ePdf = bytes => !!bytes && bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d

const fmtMoment = d => {
  if (!d) return '-'
  const t = new Date(d)
  return Number.isFinite(t.getTime()) ? t.toLocaleString('ro-RO', { timeZone: 'Europe/Bucharest', dateStyle: 'short', timeStyle: 'short' }) : '-'
}

// Subiectul mailului INTERN (nu al celui către instituție): un singur rând, maxim 300.
export const subiectIntern = (cod, mailSubiect) => linie(`[De trimis ${linie(cod)}] ${linie(mailSubiect)}`).slice(0, MAX_SUBIECT_MAIL)

// Construiește mailul intern. Toate câmpurile vin din BD (rândul aprobat citit de RPC), nu din browser; tot ce e text de utilizator e escapat,
// iar adresa instituției și textul apar ca TEXT (fără mailto / linkuri generate de noi).
// Întoarce { catre, cc, subiect, html, text } sau { erori: [...] } dacă datele nu permit mailul.
export function construiesteMailIntern(d) {
  const erori = []
  const catre = normEmail(d?.expeditorEmail)
  if (!eEmailGazpet(catre)) erori.push('Expeditorul trebuie să aibă o adresă @gazpet.ro.')
  if (!eEmailValid(String(d?.destinatarEmail ?? '').trim())) erori.push('Adresa de e-mail a instituției lipsește sau nu e validă.')
  if (!linie(d?.mailSubiect)) erori.push('Subiectul mailului lipsește.')
  if (!String(d?.mailText ?? '').trim()) erori.push('Textul mailului lipsește.')
  if (String(d?.mailText ?? '').length > MAX_TEXT_MAIL) erori.push('Textul mailului e prea lung.')
  if (!String(d?.fisierNume ?? '').trim()) erori.push('Fișierul aprobat lipsește.')
  if (erori.length) return { erori }
  const cc = [OFFICE].filter(e => e !== catre)
  const destEmail = String(d.destinatarEmail).trim()
  const subiect = subiectIntern(d.cod, d.mailSubiect)
  const subInst = linie(d.mailSubiect)
  const text = String(d.mailText).replace(/\r\n/g, '\n').trim()
  const bloc = (titlu, continut, mono = false) => `<div style="margin:12px 0"><div style="font-size:12px;color:#5a6b7b;margin-bottom:4px">${escHtml(titlu)}</div>` +
    `<div style="border:1px solid #d0d7de;border-radius:6px;padding:10px;background:#f6f8fa;${mono ? 'font-family:Consolas,monospace;' : ''}white-space:pre-wrap">${continut}</div></div>`
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1a232c;max-width:760px">` +
    `<h2 style="margin:0 0 6px;color:#0b4f8a">📧 Mail de trimis: ${escHtml(linie(d.cod))} — ${escHtml(linie(d.destinatar))}</h2>` +
    `<p style="margin:0 0 10px">Corespondența <b>${escHtml(linie(d.cod))}</b> (proiect ${escHtml(linie(d.proiectCod))}) a fost aprobată de ${escHtml(linie(d.aprobatDeNume) || 'owner')} la ${escHtml(fmtMoment(d.aprobatLa))}.</p>` +
    `<p style="margin:0 0 10px;padding:8px 10px;border-left:4px solid #d29922;background:#fff8e5"><b>Ce ai de făcut:</b> deschide un mail NOU (nu „Forward”), copiază mai jos adresa, subiectul și textul, ` +
    `atașează PDF-ul din acest mesaj și trimite-l tu. Platforma nu a trimis nimic către instituție.</p>` +
    bloc('1. Către (adresa instituției)', escHtml(destEmail), true) +
    bloc('2. Subiect', escHtml(subInst)) +
    bloc('3. Text', escHtml(text)) +
    `<p style="margin:12px 0 0">4. Atașament: <b>${escHtml(linie(d.fisierNume))}</b> — fișierul aprobat (amprenta serverului, eTag: <span style="font-family:Consolas,monospace">${escHtml(linie(d.fisierEtag))}</span>).</p>` +
    `<p style="color:#8a99a8;font-size:12px;margin-top:18px">Pregătit din Gazpet ERP (Redări → Corespondență) de ${escHtml(linie(d.pregatitDeNume) || '-')}. CC ${escHtml(OFFICE)} pentru evidență.</p></div>`
  const textSimplu = `Mail de trimis: ${linie(d.cod)} — ${linie(d.destinatar)}\n` +
    `Aprobat de ${linie(d.aprobatDeNume) || 'owner'} la ${fmtMoment(d.aprobatLa)}.\n\n` +
    `Deschide un mail NOU (nu Forward), copiază adresa, subiectul și textul, atașează PDF-ul și trimite-l tu.\n\n` +
    `1. Către: ${destEmail}\n2. Subiect: ${subInst}\n3. Text:\n${text}\n\n4. Atașament: ${linie(d.fisierNume)} (eTag ${linie(d.fisierEtag)})\n`
  return { catre, cc, subiect, html, text: textSimplu }
}
