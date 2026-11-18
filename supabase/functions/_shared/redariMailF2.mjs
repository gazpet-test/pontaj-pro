// F2: logică comună browser / edge. Intrările externe sunt numai date.
export const EXPEDITOR = 'redari@gazpet.ro'
// F2b (decizia proprietarului, 18.11.2026): transportul real PORNIT, DAR cu garda DOAR_PROIECTE_TEST = true — aceeași convenție ca FAN
// (redariFanHandler.mjs) și SMS (20261130c): e-mailul pleacă DOAR pentru loturi ale proiectelor al căror cod începe cu „TEST-”. Funcția edge
// verifică proiectul lotului (citit din bază, cu JWT-ul omului) ÎNAINTE de orice citire de secrete și de orice apel către Google; BD-ul
// impune aceeași regulă în fn_red_mail_f2_poate (coloana red_mail_setari.doar_proiecte_test, 20261131h). Proiectele reale = PR separat,
// după „da”-urile din plan (textul juridic, DKIM / DMARC, autorizarea Transgaz, extern_permis).
export const TRANSPORT_REAL_ACTIV = true
export const DOAR_PROIECTE_TEST = true
export const PREFIX_PROIECT_TEST = 'TEST-'
export const LIMITA_LOT = 300
export const LIMITA_INVOCARE = 20   // mesaje pe o invocare a funcției edge (≈ 2 s între apeluri, fn_red_mail_apel_incepe); UI-ul reia
export const MESAJ_TRANSPORT_OPRIT = 'transport oprit'
export const MESAJ_DOAR_PROIECT_TEST = `transport doar pe proiecte de TEST (codul proiectului începe cu „${PREFIX_PROIECT_TEST}”)`
/** Proiect de TEST = codul începe cu „TEST-” (exact, fără spații). Orice altceva (lipsă, null, „test-”) = proiect real. Paritate cu FAN (test). */
export const esteProiectTest = cod => typeof cod === 'string' && cod.startsWith(PREFIX_PROIECT_TEST)
/**
 * O SINGURĂ definiție (L19) a gărzii de activare, folosită identic de funcția edge (înaintea secretelor) și de ecran (butonul „Trimite”):
 * { ok, cod, motiv }. transportActiv / doarTest sunt parametri doar pentru teste; funcția edge le lasă pe cele din cod.
 */
export function transportPermis({ proiectCod = null, transportActiv = TRANSPORT_REAL_ACTIV, doarTest = DOAR_PROIECTE_TEST } = {}) {
  if (!transportActiv) return { ok: false, cod: 'transport_real_oprit', motiv: MESAJ_TRANSPORT_OPRIT }
  if (doarTest && !esteProiectTest(proiectCod)) return { ok: false, cod: 'transport_real_doar_test', motiv: MESAJ_DOAR_PROIECT_TEST }
  return { ok: true, cod: null, motiv: '' }
}
// ── Câmpurile textului (19.11.2026, migrarea 20261131i): completate PE FIECARE MESAJ de fn_red_mail_lot_creeaza, în snapshot, înaintea hash-ului.
// Definiția valorilor e DOAR în SQL (fn_red_mail_f2_campuri / fn_red_mail_f2_token / fn_red_link_raspuns — L19): ecranul primește valorile prin RPC și
// textul final din snapshot; aici stau doar numele câmpurilor, descrierile pentru ecran și forma „{NUME}” (paritate cu SQL pe tabelul de cazuri din
// src/redari/__tests__/campuri_mail_cazuri.json). {LINK_RASPUNS} e linkul PERSONAL al deținătorului (același ca în codul QR din convocator) — secret.
export const CAMP_LINK = 'LINK_RASPUNS'
export const CAMPURI_MAIL = Object.freeze([
  Object.freeze({ nume: CAMP_LINK, descriere: 'linkul personal de răspuns al destinatarului (același ca în codul QR din convocator); diferit pe fiecare mesaj', perMesaj: true }),
  Object.freeze({ nume: 'COMUNA', descriere: 'numele UAT-ului (red_uat.nume), ca în convocator', perMesaj: false }),
  Object.freeze({ nume: 'ZILE', descriere: 'zilele de sesiune ale UAT-ului, ZZ.LL.AAAA, legate cu „, ” și „ și ”', perMesaj: false }),
  Object.freeze({ nume: 'PROGRAM', descriere: 'programul sesiunii, doar dacă e același în toate zilele UAT-ului', perMesaj: false }),
  Object.freeze({ nume: 'TEL', descriere: 'telefonul de contact al proiectului (red_proiecte.contact_telefon), ca în convocator', perMesaj: false }),
])
export const NUME_CAMPURI = Object.freeze(CAMPURI_MAIL.map(c => c.nume))
// Ce e un câmp — O SINGURĂ definiție, aceeași ca în SQL (fn_red_mail_f2_completeaza, 20261131i): „{” + nume fără acolade, de ORICE lungime + „}”
// (sensibil la caz, fără spații în plus). Serverul înlocuiește câmpurile cunoscute și REFUZĂ orice acoladă rămasă (nume necunoscut oricât de lung,
// „{}”, „{ X }”, „{{COMUNA}}”, acoladă neînchisă) — aici: campuriNecunoscute + acoladeInvalide, probate pe același tabel de cazuri ca SQL-ul.
const RX_CAMP = /\{([^{}]+)\}/g
/** Numele câmpurilor găsite în text (în ordinea apariției, fără duplicate). */
export function campuriDinText(text) {
  const gasite = []
  for (const m of String(text ?? '').matchAll(RX_CAMP)) if (!gasite.includes(m[1])) gasite.push(m[1])
  return gasite
}
/** Câmpurile scrise greșit / necunoscute (serverul le refuză cu camp_necunoscut; ecranul oprește crearea înainte). */
export const campuriNecunoscute = text => campuriDinText(text).filter(n => !NUME_CAMPURI.includes(n))
/** Acolade care ar rămâne după completarea câmpurilor cunoscute (serverul refuză: camp_necunoscut) — orice formă, oricât de lungă. */
export const acoladeInvalide = text => /[{}]/.test(String(text ?? '').replace(RX_CAMP, (tot, nume) => NUME_CAMPURI.includes(nume) ? '' : tot))
export const areLinkRaspuns = text => campuriDinText(text).includes(CAMP_LINK)
export const MESAJ_FARA_LINK = `Textul nu conține {${CAMP_LINK}}: proprietarii n-ar primi linkul lor personal de răspuns.`
// Tokenul e secret: în ecran linkul se arată MASCAT (ultimele 6 caractere), în jurnale / erori / exporturi nu apare deloc.
const RX_LINK_TOKEN = /(\/redari\/raspuns\/)([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/g
export const MASCA_TOKEN = '••••••'
export const mascheazaLink = text => String(text ?? '').replace(RX_LINK_TOKEN, (_, cale, tok) => `${cale}${MASCA_TOKEN}${tok.slice(-6)}`)
// ── Linkul personal STRĂIN (r3, Jakarinos #1138 P1: tokenul procent-codificat trecea de căutarea literală): O SINGURĂ definiție, aceeași ca
// fn_red_mail_f2_link_strain din 20261131i (paritate pe src/redari/__tests__/link_strain_cazuri.json; tabelele de caractere de mai jos = blocul
// „TABEL-LINK 20261131i” din migrare, comparat de test). Căutarea se face pe FORMA DE CĂUTARE: (0) linkul EXACT al destinatarului → „#”; (1) NFKC;
// (2) până la punct fix (cel mult TRECERI_LINK; nestabil = străin): fără INVIZIBILE (spații, rupturi de linie, controale, formatare, semne combinante),
// liniuțele Unicode → „-”, %XX decodat într-un pas de la stânga la dreapta (ASCII tipăribil = caracterul, altfel eliminat), entitățile HTML decodate;
// (3) străin = calea „redari/raspuns” oriunde (litere ASCII mici, „\” = „/”, „//”, „.” și „..” rezolvate) SAU un token existent (≠ al destinatarului)
// în orice fereastră de 43 de caractere. Ecranul nu cunoaște tokenurile (secrete): verifică doar calea; serverul le verifică pe amândouă.
export const PREFIX_LINK_RASPUNS = 'https://redari.gazpet.ro/redari/raspuns/'
export const TRECERI_LINK = 12
export const INVIZIBILE_LINK = Object.freeze([[1, 32], [127, 160], [173, 173], [768, 879], [1564, 1564], [4447, 4448], [5760, 5760], [6155, 6158], [8192, 8207], [8232, 8239], [8287, 8303], [10240, 10240], [12288, 12288], [12644, 12644], [65024, 65039], [65279, 65279], [65440, 65440], [65529, 65531], [119155, 119162], [917504, 917631], [917760, 917999]])
export const LINIUTE_LINK = Object.freeze([[8208, 8213], [8722, 8722], [11834, 11835]])
export const ENTITATI_LINK = Object.freeze({ amp: '&', AMP: '&', lowbar: '_', UnderBar: '_', sol: '/', bsol: '\\', hyphen: '-', dash: '-', minus: '-', period: '.', colon: ':', num: '#', percnt: '%', quest: '?' })
const clasaLink = intervale => new RegExp('[' + intervale.map(([a, b]) => String.fromCodePoint(a) + '-' + String.fromCodePoint(b)).join('') + ']', 'gu')
const RX_INVIZIBILE = clasaLink(INVIZIBILE_LINK), RX_LINIUTE = clasaLink(LINIUTE_LINK)
const RX_PROCENT = /%[0-9A-Fa-f]{2}/g
const RX_ENTITATE = /&#[0-9]{1,7};?|&#[xX][0-9A-Fa-f]{1,6};?|&[A-Za-z][A-Za-z0-9]{1,31};/g
const asciiTiparibil = c => c >= 33 && c <= 126 ? String.fromCharCode(c) : ''
const decodeazaEntitate = e => e.startsWith('&#')
  ? asciiTiparibil(/^&#[xX]/.test(e) ? parseInt(/^&#[xX]([0-9A-Fa-f]+)/.exec(e)[1], 16) : parseInt(/^&#([0-9]+)/.exec(e)[1], 10))
  : (Object.hasOwn(ENTITATI_LINK, e.slice(1, -1)) ? ENTITATI_LINK[e.slice(1, -1)] : '')
/** Forma de căutare a unui text (pașii 1–2); null = nestabilă după TRECERI_LINK treceri (tratată ca link străin). */
export function formaCautareLink(text) {
  let v = String(text ?? '').normalize('NFKC')
  for (let i = 0; i < TRECERI_LINK; i++) {
    const ant = v
    v = v.replace(RX_INVIZIBILE, '').replace(RX_LINIUTE, '-')
    v = v.replace(RX_PROCENT, p => asciiTiparibil(parseInt(p.slice(1), 16)))
    v = v.replace(RX_ENTITATE, decodeazaEntitate)
    if (v === ant) return v
  }
  return null
}
/** Calea formularului de răspuns („redari/raspuns”) în forma de căutare, ca un browser (litere ASCII mici, „\”, „//”, „.”, „..”); null = nestabilă. */
export function areCaleRaspuns(forma) {
  let c = forma.replace(/[A-Z]/g, x => x.toLowerCase()).replace(/\\/g, '/')
  for (let i = 0; i < TRECERI_LINK; i++) {
    const ant = c
    c = c.replace(/\/+/g, '/').replace(/\/\.(?=\/|$)/g, '').replace(/\/[^/]+\/\.\.(?=\/|$)/g, '')
    if (c === ant) return c.includes('redari/raspuns')
  }
  return true
}
/** Textul conține un link personal STRĂIN de destinatarul cu tokenul dat (null = orice link personal e străin); tokeniExistenti = cei din bază (serverul). */
export function linkStrain(text, token = null, tokeniExistenti = []) {
  if (text == null) return false
  let v = String(text)
  if (token != null && /^[A-Za-z0-9_-]{43}$/.test(token)) v = v.split(PREFIX_LINK_RASPUNS + token).join('#')
  const f = formaCautareLink(v)
  if (f === null || areCaleRaspuns(f)) return true
  const alti = new Set(tokeniExistenti.filter(t => t !== token))
  if (!alti.size) return false
  for (const m of f.matchAll(/[A-Za-z0-9_-]{43,}/g)) for (let i = 0; i + 43 <= m[0].length; i++) if (alti.has(m[0].slice(i, i + 43))) return true
  return false
}
/**
 * Un link personal în ȘABLON (calea formularului, oricum scrisă — literală, %XX, entități, majuscule, rupt de spații): ar ajunge la TOȚI destinatarii —
 * serverul refuză crearea (link_literal; fn_red_mail_f2_link_strain, care prinde în plus tokenurile existente copiate fără adresă). Linkul intră doar
 * prin {LINK_RASPUNS}.
 */
export const areLinkLiteral = text => text != null && linkStrain(text, null, [])
export const MESAJ_LINK_LITERAL = `Textul sau subiectul conține un link personal de răspuns sau adresa formularului de răspuns (…/redari/raspuns/…, oricum scrisă): ar ajunge la toți destinatarii. Scoate-l și folosește {${CAMP_LINK}}.`
export const STARI_LOT = ['ciorna', 'aprobat', 'in_trimitere', 'blocat_integritate', 'incheiat']
export const STARI_MESAJ = ['in_coada', 'rezervat', 'in_apel', 'trimis', 'esuat_sigur', 'necunoscut', 'esuat_confirmat', 'anulat']
export function emailValid(v) {
  return typeof v === 'string' && v.length <= 254 && /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(v)
}
export const textNormal = v => v.normalize('NFC').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '')
export function antetValid(v, limita = 500) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= limita && !/[\x00-\x1f\x7f]/.test(v)
}
// Contract JS/SQL: chei ASCII fixe și întregi siguri; nu JSON general cu fracții/chei Unicode.
export function canonic(v) {
  if (v === null || typeof v === 'boolean' || typeof v === 'number' || typeof v === 'string') return JSON.stringify(v)
  if (Array.isArray(v)) return '[' + v.map(canonic).join(',') + ']'
  if (!v || typeof v !== 'object') throw new Error('forma_invalida')
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonic(v[k])).join(',') + '}'
}
export async function sha256(v) {
  const bytes = typeof v === 'string' ? new TextEncoder().encode(v) : v
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('')
}
export function formaMesaj(m) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(m.id) || !emailValid(m.catre) || !antetValid(m.subiect_final) || m.message_id !== `<${m.id}@gazpet.ro>`) throw new Error('antet_invalid')
  if (typeof m.corp_text_final !== 'string' || !m.corp_text_final.trim() || m.corp_text_final.length > 20000) throw new Error('corp_invalid')
  if (m.corp_html_final != null && (typeof m.corp_html_final !== 'string' || m.corp_html_final.length > 40000)) throw new Error('corp_invalid')
  const atasamente = m.atasament_path ? [{ nume: m.atasament_nume, mime: m.atasament_mime, marime: m.atasament_marime, sha256: m.atasament_sha256 }] : []
  if (atasamente.some(a => !antetValid(a.nume, 150) || a.mime !== 'application/pdf' || !Number.isSafeInteger(a.marime) || a.marime < 5 || a.marime > 10000000 || !/^[0-9a-f]{64}$/.test(a.sha256))) throw new Error('atasament_invalid')
  return { v: 1, mesaj_id: m.id, from: EXPEDITOR, to: m.catre.toLowerCase(), subiect: textNormal(m.subiect_final), message_id: m.message_id,
    in_reply_to: null, references: [], corp_text: textNormal(m.corp_text_final), corp_html: m.corp_html_final == null ? null : textNormal(m.corp_html_final), atasamente }
}
export const hashMesaj = async m => sha256(canonic(formaMesaj(m)))
export const hashLot = mesaje => sha256(canonic([...mesaje].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(m => m.mesaj_sha256)))
export function gardaTrimitere({ owner, setari, informare, lot, acum = Date.now() }) {
  if (owner !== true) return 'non_owner'
  if (!setari || setari.trimitere_oprita !== false) return 'trimitere_oprita'
  // F2b: trimiterea cere căsuța conectată (refresh token-ul în Vault; starea pe red_mail_setari, scrisă doar de fn_red_mail_secret_seteaza)
  if (!setari.trimitere_conectata_la) return 'casuta_neconectata'
  if (informare !== true) return 'informare_nepublicata'
  if (!lot || !['aprobat', 'in_trimitere'].includes(lot.stare) || !lot.aprobat_de) return 'lot_neaprobat'
  const aprobat = Date.parse(lot.aprobat_la)
  if (!Number.isFinite(aprobat) || acum >= aprobat + 7 * 86400000) return 'aprobare_expirata'
  if (!lot.lot_sha256 || lot.lot_sha256 !== lot.aprobat_lot_sha256) return 'lot_integritate'
  return null
}
export function rezultatSend(status, body, { apelEfectuat = true } = {}) {
  if (!apelEfectuat) return { stare: 'esuat_sigur', cod: 'apel_neefectuat' }
  if (status === 200 && /^[A-Za-z0-9_-]{1,64}$/.test(body?.id || '') && /^[A-Za-z0-9_-]{1,64}$/.test(body?.threadId || '')) return { stare: 'trimis', cod: 'acceptat_gmail', gmail_id: body.id, thread_id: body.threadId }
  const rate = body?.error?.errors?.some(e => ['rateLimitExceeded', 'userRateLimitExceeded'].includes(e?.reason))
  if (status === 400 || (status === 403 && !rate)) return { stare: 'esuat_sigur', cod: 'refuz_gmail' }
  return { stare: 'necunoscut', cod: 'rezultat_ambiguu' }
}
const b64 = bytes => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
const base64Text = s => b64(new TextEncoder().encode(s))
const linii64 = s => s.match(/.{1,76}/g)?.join('\r\n') || ''
// RFC2047: encoded-word <=75 octeți, fără tăiere în mijlocul unui caracter UTF-8.
const subiectMime = s => {
  const bucati = []; let bucata = ''
  for (const c of s) {
    if (new TextEncoder().encode(bucata + c).length > 42) { bucati.push(bucata); bucata = '' }
    bucata += c
  }
  if (bucata) bucati.push(bucata)
  return bucati.map(b => `=?UTF-8?B?${base64Text(b)}?=`).join('\r\n ')
}
/** Un To, fără CC/BCC; HTML-ul nu se randează în ERP. PDF-ul este verificat ca octeți. */
export async function compuneMime(m, atasament = null, delimitator = crypto.randomUUID()) {
  const f = formaMesaj(m)
  if (await hashMesaj(m) !== m.mesaj_sha256) throw new Error('snapshot_diferit')
  if (!/^[A-Za-z0-9-]{1,80}$/.test(delimitator)) throw new Error('delimitator_invalid')
  if (m.atasament_path && (!atasament || atasament.length !== m.atasament_marime || new TextDecoder().decode(atasament.subarray(0, 5)) !== '%PDF-' || await sha256(atasament) !== m.atasament_sha256)) throw new Error('atasament_diferit')
  const head = [`From: ${EXPEDITOR}`, `To: ${f.to}`, `Reply-To: ${EXPEDITOR}`, `Subject: ${subiectMime(f.subiect)}`, `Message-ID: ${f.message_id}`,
    'MIME-Version: 1.0', 'List-Unsubscribe: <mailto:redari@gazpet.ro?subject=dezabonare>', `X-Gazpet-Redari: ${m.id}; h=${m.mesaj_sha256}`, `Content-Type: multipart/mixed; boundary="${delimitator}"`]
  const parts = [`Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${linii64(base64Text(f.corp_text))}`]
  if (f.corp_html !== null) throw new Error('html_neimplementat') // F2 folosește text simplu; nu producem două corpuri contradictorii.
  if (m.atasament_path) parts.push(`Content-Type: application/pdf\r\nContent-Disposition: attachment; filename*=UTF-8''${encodeURIComponent(m.atasament_nume).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())}\r\nContent-Transfer-Encoding: base64\r\n\r\n${linii64(b64(atasament))}`)
  return head.join('\r\n') + '\r\n\r\n' + parts.map(p => `--${delimitator}\r\n${p}\r\n`).join('') + `--${delimitator}--\r\n`
}
/**
 * Un mesaj rezervat → MIME din snapshot → apel_incepe (CAS, commit înainte de apel) → UN singur send → rezultatul persistat (retry doar
 * pe persistare, cu aceleași argumente). Transportul e injectat (deps.send); nu repetă send niciodată la rezultat ambiguu (L05).
 * Garda TRANSPORT_REAL_ACTIV rămâne și aici (fără transport nu se atinge nici descărcarea, nici claim-ul).
 */
export async function proceseazaMesaj(m, deps) {
  if (!TRANSPORT_REAL_ACTIV) return { sarit: true, cod: 'transport_real_oprit' }
  if (m.stare !== 'rezervat') return { stare: m.stare, sarit: true }
  let raw
  try { raw = await compuneMime(m, m.atasament_path ? await deps.descarca(m.atasament_path) : null) }
  catch { return deps.rezultat(m, { stare: 'esuat_sigur', cod: 'snapshot_diferit' }) }
  if (await deps.incepe(m) !== true) return { sarit: true }
  let rezultat
  try {
    const res = await deps.send(raw)
    let body = null
    try { body = await res.json() } catch { /* 200 neinterpretabil = necunoscut */ }
    rezultat = rezultatSend(res.status, body)
  } catch { rezultat = rezultatSend(0, null) }
  // Retry doar persistarea rezultatului, cu aceleași argumente. Niciodată send.
  for (let i = 0; i < 3; i++) {
    try { return await deps.rezultat(m, rezultat) } catch { /* recitirea serverului va reconcilia in_apel */ }
  }
  return { stare: 'necunoscut', cod: 'persistare_neconfirmata' }
}
/** Primește candidatul complet decodat de cititor; nu acordă încredere antetului h=. */
export async function potrivesteSent(m, candidati) {
  if (!Array.isArray(candidati) || candidati.length !== 1) return false
  const c = candidati[0]
  if (c.messageIds?.length !== 1 || c.messageIds[0] !== m.message_id || c.to?.length !== 1 || c.to[0] !== m.catre || c.cc?.length || c.bcc?.length || c.subjects?.length !== 1 || c.subjects[0] !== m.subiect_final) return false
  if (!Number.isFinite(c.internalDate) || c.internalDate < Date.parse(m.apel_inceput_la) - 300000 || !Number.isFinite(Date.parse(m.apel_inceput_la))) return false
  try { return await hashMesaj({ ...c.snapshot, id: m.id }) === m.mesaj_sha256 } catch { return false }
}
