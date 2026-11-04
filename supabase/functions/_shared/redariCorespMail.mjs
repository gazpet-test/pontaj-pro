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

// r2 (C-P3-01): eTag-ul din antetul descărcării trebuie să fie PUTERNIC (fără „W/”) și EXACT egal cu valoarea aprobată (din storage.objects.metadata,
// cu ghilimele, ca antetul). Un ETag slab nu garantează aceiași octeți → refuz. Doar spațiile de la capete se ignoră.
export function etagPuternicEgal(antet, aprobat) {
  const a = String(antet ?? '').trim(), b = String(aprobat ?? '').trim()
  return a.length > 0 && !/^W\//i.test(a) && !/^W\//i.test(b) && a === b
}
// r2 (C-P2-03): reply_to = adresa utilizatorului DOAR dacă e @gazpet.ro, altfel office@ (fără adrese externe în mailul intern)
export const replyToIntern = email => eEmailGazpet(email) ? normEmail(email) : OFFICE
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

// ── Fluxul edge-ului (r2): logică pură cu dependențe injectate, ca să fie testată în vitest (Resend / BD / Storage simulate) ─────────────────────
// dep.rpc(nume, argumente) → { data, error } (clientul UTILIZATORULUI); dep.descarca(path) → Response; dep.trimiteResend(corp, cheie) → Response;
// dep.b64(Uint8Array) → string. cerere = { corespondenta_id, intentie_id, versiune, fisier_id, userEmail }. Întoarce { status, body }. Fără throw.
export const MAX_PDF = 25 * 1024 * 1024
const RX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const numeAtasament = (nume, path) => {
  const baza = String(nume || String(path || '').split('/').pop() || 'document.pdf').replace(/[^\p{L}\p{N}._ -]+/gu, '_').slice(0, 150).trim() || 'document.pdf'
  return /\.pdf$/i.test(baza) ? baza : `${baza}.pdf`
}
// mesajele RPC-ului („redari: …”) → text pentru UI; erorile neașteptate nu se trimit brut (L10)
export const mesajRpc = e => { const m = String(e?.message || ''); return /^redari: /.test(m) ? m.replace(/^redari: /, '').slice(0, 300) : 'pregătirea mailului a eșuat (eroare internă)' }
export const MESAJ_URMA_NECONFIRMATA = 'Resend a confirmat mailul, dar înregistrarea nu s-a confirmat — NU retrimite; verifică inboxul expeditorului.'
export const MESAJ_NECUNOSCUT = 'Rezultat neconfirmat — verifică inboxul expeditorului înainte de orice reluare.'
const anuleaza = async r => { try { await r?.body?.cancel?.() } catch { /* nimic */ } }

export async function pregatesteMailIntern(cerere, dep) {
  const raspuns = (status, body) => ({ status, body })
  const { corespondenta_id: cid, intentie_id: iid, versiune, fisier_id: fid } = cerere || {}
  if (!RX_UUID.test(String(cid || '')) || !RX_UUID.test(String(iid || '')) || !RX_UUID.test(String(fid || '')) || !Number.isInteger(versiune)) {
    return raspuns(400, { error: 'corespondenta_id, intentie_id, versiune și fisier_id sunt obligatorii' })
  }
  // 1. Poarta + intenția (pas atomic în BD, cu JWT-ul utilizatorului)
  const ri0 = await Promise.resolve().then(() => dep.rpc('fn_red_coresp_mail_incepe', { p_corespondenta_id: cid, p_intentie_id: iid, p_versiune_confirmata: versiune, p_fisier_id_confirmat: fid })).catch(() => null)
  if (ri0 === null) return raspuns(502, { error: 'BD indisponibilă la pornirea încercării; reia aceeași încercare', necunoscut: true })
  if (ri0.error) { const e = ri0.error; return raspuns(e.code === '42501' ? 403 : e.code === 'P0002' ? 404 : e.code === '23514' ? 409 : 500, { error: mesajRpc(e) }) }
  const p = ri0.data
  const mailId = String(p?.mail_id || '')
  const baza = { mail_id: mailId, intentie_id: iid, catre: p?.expeditor_email, cc: [p?.cc].filter(Boolean) }
  if (p?.mod === 'deja_trimis') return raspuns(200, { ok: true, deja_trimis: true, resend_id: p.resend_id, ...baza })
  const reluare = p?.mod === 'reluare'
  // închiderea intenției proprii: { ok, stare } sau { ok:false, eroare } — fără throw, fără scriere din catch
  const inchide = async (stare, resendId, eroare) => {
    const rz = await Promise.resolve().then(() => dep.rpc('fn_red_coresp_mail_inchide', { p_mail_id: mailId, p_stare: stare, p_resend_id: resendId, p_eroare: eroare ? String(eroare).slice(0, 500) : null })).catch(() => null)
    if (rz === null) return { ok: false, eroare: 'închiderea urmei nu s-a confirmat (rețea / timeout)' }
    return rz.error ? { ok: false, eroare: mesajRpc(rz.error) } : { ok: true, stare: rz.data }
  }
  // eșec ÎNAINTE de trimitere: la intenție nouă = eroare; la reluare rămâne necunoscut (o încercare anterioară cu aceeași cheie poate fi plecat)
  const esec = async (motiv, status = 409) => {
    const r = await inchide(reluare ? 'necunoscut' : 'eroare', null, motiv)
    return raspuns(status, { error: motiv, necunoscut: reluare, urma_inchisa: r.ok, ...baza })
  }
  // 2. Destinatarul mailului intern: obligatoriu @gazpet.ro (a doua verificare, după CHECK + RPC)
  const catre = normEmail(p?.expeditor_email)
  if (!eEmailGazpet(catre)) return esec('expeditorul nu are o adresă @gazpet.ro; nu se trimite nimic')
  const fis = p?.fisier || {}
  const path = String(fis.path || '')
  if (!path || !/\.pdf$/i.test(path)) return esec('fișierul aprobat nu e PDF')
  // 3. PDF-ul aprobat, descărcat cu JWT-ul UTILIZATORULUI; eTag-ul din ACELAȘI răspuns = cel aprobat (puternic, exact)
  // anti-bug edge: nicio scriere în BD din interiorul unui catch — excepțiile de rețea devin valori (null), tratate după
  const r = await Promise.resolve().then(() => dep.descarca(path)).catch(() => null)
  if (r === null) return esec('descărcarea PDF-ului aprobat a eșuat (rețea / timeout)', 502)
  if (!r?.ok) { await anuleaza(r); return esec(`descărcarea PDF-ului aprobat a fost refuzată (${r?.status})`, r?.status === 404 ? 409 : 502) }
  if (!etagPuternicEgal(r.headers.get('etag'), fis.etag)) { await anuleaza(r); return esec('PDF-ul din Storage nu are amprenta aprobată (eTag diferit, slab sau lipsă); nu se trimite nimic') }
  const lung = Number(r.headers.get('content-length'))
  if (Number.isFinite(lung) && lung > MAX_PDF) { await anuleaza(r); return esec('PDF-ul depășește 25 MB') }
  const buf = await Promise.resolve().then(() => r.arrayBuffer()).catch(() => null)
  if (buf === null) return esec('descărcarea PDF-ului aprobat s-a întrerupt', 502)
  const bytes = new Uint8Array(buf)
  if (bytes.length === 0 || bytes.length > MAX_PDF) return esec('PDF-ul descărcat e gol sau depășește 25 MB')
  if (!ePdf(bytes)) return esec('fișierul aprobat nu e un PDF valid')
  // 4. Mailul intern; câmpurile vin din BD (RPC), nu din cerere
  const numeF = numeAtasament(fis.nume_original, path)
  const m = construiesteMailIntern({ cod: p.cod, proiectCod: p.proiect_cod, destinatar: p.destinatar, destinatarEmail: p.destinatar_email, mailSubiect: p.mail_subiect,
    mailText: p.mail_text, expeditorEmail: catre, fisierNume: numeF, fisierEtag: fis.etag, aprobatLa: p.aprobat_la, aprobatDeNume: p.aprobat_de_nume, pregatitDeNume: p.pregatit_de_nume })
  if (m.erori) return esec(m.erori.join(' '))
  if (m.catre !== catre || m.cc.some(e => e !== OFFICE)) return esec('destinatarii mailului intern nu sunt cei așteptați')
  // 5. Trimiterea, cu Idempotency-Key = intentie_id (aceeași la reluare → Resend deduplică)
  const corp = { from: 'PontajPRO <rapoarte@gazpet.ro>', to: [m.catre], cc: m.cc.length ? m.cc : undefined, reply_to: replyToIntern(cerere.userEmail),
    subject: m.subiect, html: m.html, text: m.text, attachments: [{ filename: numeF, content: dep.b64(bytes) }] }
  const rr = await Promise.resolve().then(() => dep.trimiteResend(corp, iid)).catch(() => null)
  if (rr === null) {
    const ri = await inchide('necunoscut', null, 'Resend: rețea / timeout — nu se știe dacă mailul a plecat')
    return raspuns(502, { error: MESAJ_NECUNOSCUT, necunoscut: true, urma_inchisa: ri.ok, ...baza })
  }
  const j = (await Promise.resolve().then(() => rr.json()).catch(() => null)) || {}
  if (rr.ok && j?.id) {
    const ri = await inchide('trimis', String(j.id), null)
    // r2 (J-P3-5 / C-P2-02): succes complet DOAR dacă și urma s-a închis „trimis”
    if (ri.ok && ri.stare === 'trimis') return raspuns(200, { ok: true, resend_id: j.id, ...baza, catre: m.catre, cc: m.cc })
    return raspuns(200, { ok: false, resend_acceptat: true, urma_inchisa: false, resend_id: j.id, error: MESAJ_URMA_NECONFIRMATA, ...baza })
  }
  // fără id / 5xx / 429 / 409 (cerere concurentă sau cheie refolosită) / orice răspuns la o reluare = necunoscut (L05)
  if (rr.ok || rr.status >= 500 || rr.status === 429 || rr.status === 409 || reluare) {
    const ri = await inchide('necunoscut', null, `Resend ${rr.status}: rezultat neconfirmat`)
    return raspuns(502, { error: `${MESAJ_NECUNOSCUT} (Resend ${rr.status})`, necunoscut: true, urma_inchisa: ri.ok, ...baza })
  }
  const detaliu = String(j?.message || j?.name || '').slice(0, 200)
  const ri = await inchide('eroare', null, `Resend ${rr.status}: ${detaliu}`)
  return raspuns(502, { error: `Resend a refuzat mailul (${rr.status}): ${detaliu}`, urma_inchisa: ri.ok, ...baza })
}
