// Fondul de handicap / unități protejate (UPA, 20261229a) — logica edge-ului upa-plafon-alerta, fără rețea proprie: clientul Supabase și fetch
// vin ca parametri (testele: src/upaAlerta.test.js cu BD / Resend simulate; scripts/pglite/test_upa_alerta_local.mjs pe BD-ul real al migrării).
// Ce e de trimis NU se decide aici: singura definiție e în BD (fn_upa_luni + fn_upa_alerta_rezerva, L19). Aici doar textul mailului, trimiterea
// rândurilor rezervate și marcarea rezultatului. Fără date personale în mail în afară de sume și numele furnizorilor UPA.
import { esc, stareDupaTrimitere } from './polite.mjs'

export const FROM = 'PontajPRO <rapoarte@gazpet.ro>'
export const APP = 'https://pontaj-pro-sooty.vercel.app'
const LUNI = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie']

// aceleași forme ca fn_upa_lei / fn_upa_luna_text / fn_upa_zile_text din migrare (testul PGlite le compară)
export const lei = n => Number(n).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export function lunaText(iso) {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(String(iso ?? ''))
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return '—'
  return `${LUNI[Number(m[2]) - 1]} ${m[1]}`
}
export const zileText = n => n === 1 ? 'mai este 1 zi' : (n % 100 === 0 || n % 100 >= 20) ? `mai sunt ${n} de zile` : `mai sunt ${n} zile`

// 'AAAA-LL-ZZ' -> 'ZZ.LL.AAAA' (termenele din calcul); altceva -> '—'
export const ziText = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? '')); return m ? `${m[3]}.${m[2]}.${m[1]}` : '—' }
// un număr din calcul (jsonb): finit sau null (L18: necunoscut != 0)
const nr = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) ? null : Number(v)
// 20270101a: rândul are `calcul` (fn_upa_calcul_la) cu toate numerele -> mailul pe calculul expertului; altfel (rezervarea veche) forma veche
export const areCalcul = r => !!r && typeof r.calcul === 'object' && r.calcul !== null && (r.calcul.stare === 'previziune' || r.calcul.stare === 'definitiv')
  && (r.fel !== 'inchidere' || (r.calcul.stare === 'definitiv' && nr(r.calcul.de_plata) !== null && nr(r.calcul.suma_datorata) !== null))
  && (r.fel !== 'zilnic' || (nr(r.calcul.jumatate) !== null && nr(r.calcul.report_intrat) !== null && nr(r.ramas) !== null))

function mailCalcul(r, { furnizori, app }) {
  const c = r.calcul, luna = lunaText(r.luna)
  const link = `<p style="margin-top:16px"><a href="${esc(app)}/administrativ?tab=upa" style="color:#1f6f8b">Deschide Administrativ → Unități protejate</a> (calculul pe luni și facturile)</p>`
  const subsol = `<p style="color:#8a99a8;font-size:12px;margin-top:18px">Mesaj trimis din platforma Gazpet ERP · nu răspundeți la acest mesaj.</p>`
  const tabel = (randuri) => `<table style="border-collapse:collapse;font-size:14px;margin:8px 0">${randuri.map(([e, v, rosu]) =>
    `<tr><td style="padding:5px 12px 5px 0;color:#44515c">${e}</td><td style="padding:5px 0;font-weight:700;text-align:right${rosu ? ';color:#b3261e' : ''}">${v}</td></tr>`).join('')}</table>`
  const fz = Array.isArray(furnizori) && furnizori.length
    ? `<p style="margin:14px 0 4px;font-weight:700">Furnizori UPA cu autorizația valabilă</p><ul style="margin:0;padding-left:18px">${furnizori.slice(0, 15).map(f => `<li>${esc(f)}</li>`).join('')}</ul>`
    : ''
  if (r.fel === 'inchidere') {
    const subiect = `Fond handicap ${luna}: de plată la bugetul de stat ${lei(c.de_plata)} lei până pe ${ziText(c.termen_stat)}`
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1a232c;max-width:680px">` +
      `<p>Bună ziua,</p><p>Calculul contribuției pentru persoanele cu handicap pe <b>${esc(luna)}</b> s-a încheiat, după închiderea pontajului:</p>` +
      tabel([['Număr mediu de angajați', esc(String(c.nma))], ['Locuri de muncă neocupate', esc(String(c.locuri))],
        ['Salariul minim brut al lunii', `${lei(c.salariu_minim)} lei`], ['Contribuția datorată', `${lei(c.suma_datorata)} lei`],
        ['Achiziții de la unități protejate (fără TVA)', `${lei(c.achizitii_fara_tva)} lei`], ['Report din lunile anterioare', `${lei(c.report_intrat)} lei`],
        ['Deducere (cel mult jumătate din contribuție)', `${lei(c.deducere)} lei`], [`De plată la bugetul de stat până pe ${esc(ziText(c.termen_stat))}`, `${lei(c.de_plata)} lei`, true],
        ['Se reportează pe lunile următoare', `${lei(c.report_iesit)} lei`]]) +
      link + subsol + `</div>`
    return { subiect: subiect.replace(/[\r\n]+/g, ' ').slice(0, 200), html }
  }
  const zile = zileText(Number(r.zile_ramase))
  const subiect = `Fond handicap ${luna} (previziune): mai sunt ${lei(r.ramas)} lei de cumpărat de la unități protejate, ${zile}`
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1a232c;max-width:680px">` +
    `<p>Bună ziua,</p><p>Pentru <b>${esc(luna)}</b>, <b>previziunea</b> contribuției pentru persoanele cu handicap arată că deducerea din achiziții de la unități protejate nu e folosită integral:</p>` +
    tabel([['Contribuția estimată', nr(c.suma_datorata) === null ? '—' : `${lei(c.suma_datorata)} lei`], ['Deducerea maximă (jumătate din contribuție)', `${lei(c.jumatate)} lei`],
      ['Report din lunile anterioare', `${lei(c.report_intrat)} lei`], ['Cumpărat până acum (fără TVA)', `${lei(c.achizitii_fara_tva)} lei`],
      ['Rămas de cumpărat', `${lei(r.ramas)} lei`, true], ['Zile rămase din lună', esc(zile.replace(/^mai (sunt|este) /, ''))]]) +
    `<p>Facturile se plătesc unității protejate până la sfârșitul lunii (${esc(ziText(c.termen_upa))}); ce nu se deduce se plătește la bugetul de stat până pe ${esc(ziText(c.termen_stat))}. ` +
    `Previziune: suma exactă se calculează după închiderea pontajului.</p>` +
    fz + link + subsol + `</div>`
  return { subiect: subiect.replace(/[\r\n]+/g, ' ').slice(0, 200), html }
}

// un rând rezervat -> {subiect, html}
export function mailUpa(r, { furnizori = [], app = APP } = {}) {
  if (areCalcul(r)) return mailCalcul(r, { furnizori, app })
  const luna = lunaText(r.luna)
  const link = `<p style="margin-top:16px"><a href="${esc(app)}/administrativ?tab=upa" style="color:#1f6f8b">Deschide Administrativ → Unități protejate</a> (acolo se înregistrează facturile)</p>`
  const fz = Array.isArray(furnizori) && furnizori.length
    ? `<p style="margin:14px 0 4px;font-weight:700">Furnizori UPA cu autorizația valabilă</p><ul style="margin:0;padding-left:18px">${furnizori.slice(0, 15).map(f => `<li>${esc(f)}</li>`).join('')}</ul>`
    : ''
  const subsol = `<p style="color:#8a99a8;font-size:12px;margin-top:18px">Mesaj trimis din platforma Gazpet ERP · nu răspundeți la acest mesaj.</p>`
  const tabel = (randuri) => `<table style="border-collapse:collapse;font-size:14px;margin:8px 0">${randuri.map(([e, v, rosu]) =>
    `<tr><td style="padding:5px 12px 5px 0;color:#44515c">${e}</td><td style="padding:5px 0;font-weight:700;text-align:right${rosu ? ';color:#b3261e' : ''}">${v}</td></tr>`).join('')}</table>`
  if (r.fel === 'inchidere') {
    const subiect = `Fond handicap ${luna}: necheltuit ${lei(r.ramas)} lei - se plătește la bugetul de stat`
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1a232c;max-width:680px">` +
      `<p>Bună ziua,</p><p>Luna <b>${esc(luna)}</b> s-a încheiat. Din plafonul pentru achiziții de la unități protejate autorizate (deductibil din contribuția pentru persoanele cu handicap) a rămas necheltuită o sumă care se plătește la bugetul de stat:</p>` +
      tabel([['Plafonul lunii', `${lei(r.plafon)} lei`], ['Cheltuit la unități protejate', `${lei(r.consumat)} lei`], ['Necheltuit (de plătit la stat)', `${lei(r.ramas)} lei`, true]]) +
      `<p>Plafonul nu se reportează în luna următoare.</p>` + link + subsol + `</div>`
    return { subiect: subiect.replace(/[\r\n]+/g, ' ').slice(0, 200), html }
  }
  const subiect = `Fond handicap ${luna}: cheltuit ${lei(r.consumat)} din ${lei(r.plafon)} lei, rămân ${lei(r.ramas)} lei, ${zileText(Number(r.zile_ramase))}`
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1a232c;max-width:680px">` +
    `<p>Bună ziua,</p><p>Pentru <b>${esc(luna)}</b>, plafonul de achiziții de la unități protejate autorizate (deductibil din contribuția pentru persoanele cu handicap) nu e cheltuit integral:</p>` +
    tabel([['Plafonul lunii', `${lei(r.plafon)} lei`], ['Cheltuit până acum', `${lei(r.consumat)} lei`], ['Rămas de cheltuit', `${lei(r.ramas)} lei`, true],
      ['Zile rămase din lună', esc(zileText(Number(r.zile_ramase)).replace(/^mai (sunt|este) /, ''))]]) +
    `<p>Ce nu se facturează de la o unitate protejată până la sfârșitul lunii se plătește la bugetul de stat. Idei rapide: hârtie, papetărie, produse de curățenie, echipamente de protecție, tipizate.</p>` +
    fz + link + subsol + `</div>`
  return { subiect: subiect.replace(/[\r\n]+/g, ' ').slice(0, 200), html }
}

// cheia de idempotență Resend = cheia rândului din jurnal (zilnic:<zi> / inchidere:<luna>): o reluare nu dublează mailul
export async function cheieIdempotenta(cheie) {
  const h = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(cheie)))
  return 'upa-' + [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 48)
}

// Doar adrese INTERNE primesc mailul (decizia owner-ului, 19.11.2026). BD-ul (fn_upa_destinatari) le alege deja și le ignoră pe celelalte
//   (numărul lor e jurnalizat); edge-ul reverifică fiecare adresă înainte de trimitere, cu ACEEAȘI formă (paritate testată pe un tabel de
//   cazuri, L19): un rând rezervat cu o adresă din afara domeniului = contract încălcat -> nu se trimite NIMIC (eroare rezervare_invalida).
export const DOMENIU_INTERN = 'gazpet.ro'
export const ADRESA_INTERNA = new RegExp('^[a-z0-9._%+-]{1,64}@' + DOMENIU_INTERN.replace(/[.]/g, '[.]') + '$')
const COD = /^[a-z_]{1,40}$/
export const destinatariValizi = d => Array.isArray(d) && d.length >= 1 && d.length <= 10 && d.every(e => typeof e === 'string' && ADRESA_INTERNA.test(e))

// Pașii unei rulări (după poarta cronSauOwner a edge-ului). Întoarce {status, body}; body fără adrese de mail și fără textul erorilor furnizorului
//   (răspunsul cronului e păstrat de pg_net), în afara probei (?dry=1, doar owner-ul ajunge aici cu dry).
export async function ruleazaAlertaUpa({ sb, fetchFn = globalThis.fetch, resendKey, dry = false, app = APP, from = FROM }) {
  const raspuns = (status, body) => ({ status, body })
  if (dry) {
    const { data, error } = await sb.rpc('fn_upa_alerta_proba', {})
    if (error || !data || typeof data !== 'object') return raspuns(500, { ok: false, error: 'proba_indisponibila' })
    return raspuns(200, { ok: true, dry: true, ...data })
  }
  // fără cheie nu se rezervă nimic (altfel rândurile ar rămâne „rezervat” fără să plece)
  if (!resendKey) return raspuns(500, { ok: false, error: 'resend_neconfigurat' })
  const { data: rez, error } = await sb.rpc('fn_upa_alerta_rezerva', {})
  if (error) return raspuns(500, { ok: false, error: 'rezervare_indisponibila' })
  if (!rez || typeof rez !== 'object' || !Array.isArray(rez.randuri) || rez.n !== rez.randuri.length
      || !Array.isArray(rez.erori_config) || !rez.erori_config.every(c => typeof c === 'string' && COD.test(c))
      || !Number.isSafeInteger(rez.destinatari_ignorati) || rez.destinatari_ignorati < 0) return raspuns(500, { ok: false, error: 'rezervare_incompleta' })
  // erori_config = codurile de business ale configurării (setare_zi_invalida / fara_plafon), calculate de BD la FIECARE rulare (nu doar la
  //   prima din zi, când se scriu în jurnal): o zi cu configurare defectă nu arată ca o zi fără alertă (L18)
  // destinatari_ignorati = câte adrese din setări NU sunt interne (nu primesc nimic); doar numărul, fără adrese
  const baza = { zi: rez.zi ?? null, luna_inchisa: rez.inchis?.luna ?? null, reconciliate: Number(rez.reconciliate) || 0, erori_config: rez.erori_config,
                 destinatari_ignorati: rez.destinatari_ignorati }
  if (rez.activ !== true) return raspuns(200, { ok: true, skip: 'alerta_oprita', ...baza })
  const contor = { trimis: 0, eroare: 0, necunoscut: 0, fara_mail: 0, nemarcat: 0 }
  for (const r of rez.randuri) {
    if (r?.stare !== 'rezervat') { if (r?.stare === 'fara_mail') contor.fara_mail++; continue }
    let rezultat, resendId = null
    if (!destinatariValizi(r.destinatari) || !Number.isSafeInteger(Number(r.id))) {
      rezultat = { stare: 'eroare', eroare: 'rezervare_invalida' }
    } else {
      const { subiect, html } = mailUpa(r, { furnizori: rez.furnizori_upa, app })
      try {
        const res = await fetchFn('https://api.resend.com/emails', {
          method: 'POST', signal: AbortSignal.timeout(15000),
          headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': await cheieIdempotenta(r.cheie) },
          body: JSON.stringify({ from, to: r.destinatari, subject: subiect, html }),
        })
        const j = await res.json().catch(() => ({}))
        rezultat = stareDupaTrimitere({ ok: res.ok, status: res.status })
        if (res.ok && typeof j?.id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(j.id)) resendId = j.id
        if (!res.ok) console.error('resend', res.status)
      } catch (_) {
        rezultat = stareDupaTrimitere({ eroareRetea: true })
      }
    }
    const { data: n, error: em } = await sb.rpc('fn_upa_alerta_marcheaza', { p_id: Number(r.id), p_stare: rezultat.stare, p_resend_id: resendId, p_eroare: rezultat.eroare })
    if (em || Number(n) !== 1) { contor.nemarcat++; console.error('marcare', em?.code ?? n) }
    contor[rezultat.stare]++
  }
  // configurare defectă = ok:false + error 'configurare_invalida' (statusul 200: rularea a mers până la capăt, eroarea e de business)
  const cfg = baza.erori_config.length > 0
  return raspuns(contor.nemarcat ? 500 : 200, { ok: contor.nemarcat === 0 && !cfg, ...(cfg ? { error: 'configurare_invalida' } : {}), rezervate: rez.n, ...contor, ...baza })
}
