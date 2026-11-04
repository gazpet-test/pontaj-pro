// Redări — 📬 Notificări: ghidul modelelor (ce se trimite, cui, pe ce canal, de unde, ce lipsește), canalele de răspuns și
// centralizatorul pe deținător / UAT (ce am trimis, ce mai avem de trimis, lipsurile). Logică pură, fără React și fără Supabase.
//
// L19 — o singură definiție: lipsurile fiecărui model vin din ACELEAȘI gărzi pe care le folosesc generatorii (motivBlocareConvocator,
// verificaDatePvA/B/C, verificaDateAdresaUat, verificaDateCerereImputernicire, areImputernicire / TEXTE_AR, lipsuriUat, motivBlocareRedari,
// completeazaSablon). Aici nu se scrie nicio regulă nouă de „gata / blocat”: pentru gărzile care cer și date ale unui document anume
// (data PV, locul, numărul AU), le dăm valori-martor ca să rămână doar lipsurile proiectului / UAT-ului.
// Retur / ultimul răspuns: stare.js (aceeași ierarhie ca red_v_stare_parcela).
import { calculeazaStare, ultimulRaspuns } from './stare.js'
import { motivBlocareConvocator } from './ui/comune.jsx'
import { verificaDatePvA, verificaDatePvB, verificaDatePvC, STARI_TEREN, MOTIVE_PV_B } from './pv.js'
import { verificaDateAdresaUat, verificaDateCerereImputernicire, celulaCsv } from './docx.js'
import { areImputernicire, TEXTE_AR } from './plicuri.js'
import { lipsuriUat } from './setari.js'
import { motivBlocareRedari } from '../sms/smsLogica.js'
import { completeazaSablon } from '../sms/sablonRedari.js'
import { etichetaStareCoresp } from './corespondenta.js'

export const STARI_MODEL = {
  gata: { eticheta: 'gata', culoare: '#3FB950' },
  partial: { eticheta: 'parțial', culoare: '#D29922' },
  blocat: { eticheta: 'blocat', culoare: '#F85149' },
  nelivrat: { eticheta: 'nelivrat încă', culoare: '#8B949E' },
  manual: { eticheta: 'manual', culoare: '#58A6FF' },
}

const plin = v => v != null && String(v).trim() !== ''
const numeUat = u => u?.nume || u?.uat3 || '?'
const sorteazaUat = uats => [...(uats || [])].sort((a, b) => String(a?.nume ?? '').localeCompare(String(b?.nume ?? ''), 'ro'))

// Lipsuri pe UAT → o listă: ce lipsește la TOATE UAT-urile apare o dată, restul cu numele UAT-urilor.
export function comaseazaLipsuri(peUat) {
  const intrari = peUat.filter(x => x.lipsuri.length)
  if (!peUat.length) return []
  const toate = peUat.length > 1 ? [...new Set(peUat[0].lipsuri)].filter(l => peUat.every(x => x.lipsuri.includes(l))) : []
  const out = toate.map(l => `${l} (toate UAT-urile)`)
  const rest = new Map()
  for (const x of intrari) for (const l of new Set(x.lipsuri)) {
    if (toate.includes(l)) continue
    if (!rest.has(l)) rest.set(l, [])
    rest.get(l).push(x.nume)
  }
  for (const [l, nume] of rest) out.push(`${l}: ${nume.join(', ')}`)
  return out
}

const lipsuriProiectSiUat = (uats, fn) => comaseazaLipsuri(sorteazaUat(uats).map(u => ({ nume: numeUat(u), lipsuri: fn(u) })))
// motivBlocareConvocator întoarce motivele unite prin „; ” — le despărțim ca să le putem comasa.
const desparte = s => (s ? String(s).split('; ').filter(Boolean) : [])

// Valori-martor pentru câmpurile completate pe fiecare document (nu sunt lipsuri ale proiectului).
const PV_MARTOR = { data_pv: '2000-01-01', locul: 'x', constatare_mod: 'sediu', stare_teren: { [STARI_TEREN[0]]: true }, motiv_pv_b: MOTIVE_PV_B[0], tronson: 1 }
const PARCELA_MARTOR = { verificare_data: '2000-01-01', verificare_de_gazpet: 'x' }

/**
 * ghidModele({ proiect, uats, smsPanou, smsPanouEroare, corespondenta, parceleFaraTronson })
 * → [{ cod, model, ce, cui, canal, unde, lipsuri: [text], stare: cod din STARI_MODEL, nota }]
 * smsPanou: răspunsul fn_sms_panou (null dacă nu s-a citit); smsPanouEroare: textul erorii (eroare ≠ „nimic de spus”, L18).
 */
export function ghidModele({ proiect = {}, uats = [], smsPanou = null, smsPanouEroare = null, corespondenta = null, parceleFaraTronson = null } = {}) {
  const fara = !uats?.length ? ['proiectul nu are UAT-uri'] : []
  const stare = (lipsuri, ok = 'gata') => (lipsuri.length ? 'blocat' : ok)
  const out = []

  const lConv = [...fara, ...lipsuriProiectSiUat(uats, u => desparte(motivBlocareConvocator(proiect, u, null)))]
  out.push({ cod: 'convocator', model: 'Convocator (Model 1)', ce: 'Convocarea scrisă la constatare: zilele de sesiune, cod QR / link personal spre formular, informarea GDPR pe verso.',
    cui: 'Fiecare deținător identificat, cu adresă cunoscută', canal: 'Poștă recomandată cu AR (în plicul comun)',
    unde: '📋 Registru → 📄 Convocator (pe rând); ↻ Reîncarcă din 📄 Fișa parcelei', lipsuri: lConv, stare: stare(lConv),
    nota: 'Neidentificații și cei fără adresă nu primesc convocator: sunt convocați prin afișare la Primărie.' })

  const lPlic = areImputernicire(proiect) ? [] : ['fără împuternicirea Beneficiarului (nr. + dată în ⚙️ Setări proiect)']
  out.push({ cod: 'plic', model: 'Plic comun + opis + PV de plicuire + etichete', ce: 'Toate convocările unei persoane din UAT într-un plic, cu opisul conținutului și PV-ul de plicuire semnat de doi colegi.',
    cui: 'Deținătorul (adresa din plic)', canal: 'Poștă', unde: '✉️ Poștă → Plicuri de făcut → Creează plic / lot de plicuire',
    lipsuri: lPlic, stare: stare(lPlic), nota: 'Plicul se face din convocatoarele deja generate.' })

  const lAr = [...lPlic]
  if (!TEXTE_AR.proiecte.includes(proiect?.cod)) lAr.push('textul AR nu e validat juridic pentru acest proiect')
  out.push({ cod: 'ar', model: 'Confirmarea de primire (AR)', ce: 'Textul scris pe AR: câte convocări conține plicul și pentru ce lucrare.',
    cui: 'Vine înapoi de la Poștă (semnat de primitor)', canal: 'Poștă', unde: '✉️ Poștă → plic → AR primit / Retur; sau import CSV poștal (✉️ Poștă, sus)',
    lipsuri: lAr, stare: stare(lAr), nota: 'AR-ul și returul se înregistrează pe plic; trec singure pe toate convocările din plic.' })

  out.push({ cod: 'borderou', model: 'Borderou Poștă (CSV)', ce: 'Lista convocărilor poștale neexpediate, cu fișier și adresă cunoscută, pentru ghișeu.',
    cui: 'Oficiul poștal (intern)', canal: 'Poștă', unde: '📋 Registru → 📮 Borderou CSV', lipsuri: [], stare: 'gata',
    nota: 'Rândurile excluse (fără fișier / fără adresă) sunt listate cu motivul.' })

  const lForm = []
  if (!plin(proiect?.text_gdpr)) lForm.push('proiect fără text GDPR')
  if (!['contact_nume', 'contact_telefon', 'contact_email'].some(k => plin(proiect?.[k]))) lForm.push('proiect fără persoană de contact')
  const faraZile = sorteazaUat(uats).filter(u => lipsuriUat(u).includes('nicio zi de sesiune cu program')).map(numeUat)
  out.push({ cod: 'formular', model: 'Formularul public de răspuns (QR / link)', ce: '4 opțiuni: particip (+ zi), nu particip fără obiecții (+ declarație), nu particip cu obiecții, constatare pe teren.',
    cui: 'Deținătorul convocat (tokenul personal din QR)', canal: 'Online', unde: 'Se creează odată cu convocatorul; răspunsul intră singur în Registru',
    lipsuri: [...lForm, ...(faraZile.length ? [`„particip” indisponibil (fără zile de sesiune): ${faraZile.join(', ')}`] : [])],
    stare: lForm.length ? 'blocat' : faraZile.length ? 'partial' : 'gata', nota: 'Nu trimite nimic și nu generează PV (decizia 6): operatorul lucrează din Registru.' })

  const lGdpr = []
  if (!plin(proiect?.text_gdpr)) lGdpr.push('verso: lipsește textul GDPR (⚙️ Setări proiect)')
  if (!plin(proiect?.link_informare_gdpr)) lGdpr.push('pagina web de informare: nelivrată (PR #939 draft, așteaptă aprobarea TGZ a textului)')
  out.push({ cod: 'gdpr', model: 'Informarea GDPR', ce: 'Informarea privind datele personale: pe verso-ul convocatorului și (planificat) pe o pagină web.',
    cui: 'Deținătorii', canal: 'Poștă (verso) + web', unde: '⚙️ Setări proiect → Text GDPR / Link informare GDPR', lipsuri: lGdpr,
    stare: !plin(proiect?.text_gdpr) ? 'blocat' : lGdpr.length ? 'partial' : 'gata', nota: '' })

  const lPvA = [...fara, ...lipsuriProiectSiUat(uats, u => verificaDatePvA({ proiect, uat: u, parcela: {}, detinator: { nume: 'x' }, pv: PV_MARTOR }))]
  out.push({ cod: 'pv_a', model: 'PV A (Model 2) — constatare per deținător', ce: 'Procesul-verbal de constatare a readucerii terenului, cu propunerea din deviz.',
    cui: 'Deținătorul (semnează)', canal: 'La sesiune sau trimis spre semnare prin poștă', unde: '📄 Fișa parcelei → PV A; 🗓️ Sesiune → PV A',
    lipsuri: lPvA, stare: stare(lPvA), nota: 'Pe fiecare PV se completează data, locul, modul constatării și starea terenului.' })

  const lPvB = [...fara, ...lipsuriProiectSiUat(uats, u => verificaDatePvB({ proiect, uat: u, parcela: PARCELA_MARTOR, pv: PV_MARTOR, detinatori: [], pvs: [] }))]
  out.push({ cod: 'pv_b', model: 'PV B (Model 3) — constatare per parcelă', ce: 'Constatarea pe parcelă când deținătorul lipsește, refuză sau cere constatare pe teren.',
    cui: 'Comisia (Gazpet / TGZ / UAT); deținătorul dacă e prezent', canal: 'Pe teren / la sesiune', unde: '📄 Fișa parcelei → PV B (parcela)',
    lipsuri: lPvB, stare: stare(lPvB), nota: 'Pe fiecare PV: motivul PV B, data verificării și comisia parcelei.' })

  const lPvC = verificaDatePvC({ proiect, pv: PV_MARTOR, randuriTronson: [{ tip_pv: 'A', suprafata_temporara_mp: 1 }] })
  if (Number(parceleFaraTronson) > 0) lPvC.push(`${parceleFaraTronson} parcele fără tronson (🛤️ Tronsoane → atribuire pe interval HG)`)
  out.push({ cod: 'pv_c', model: 'PV C (Model 5) — centralizator pe tronson', ce: 'PV-ul de tronson, după ce toate parcelele au PV A semnat sau PV B.',
    cui: 'Transgaz (beneficiar)', canal: 'Predare la Beneficiar', unde: '🛤️ Tronsoane / PV C', lipsuri: lPvC,
    stare: lPvC.length ? 'blocat' : 'gata', nota: 'Pe fiecare tronson se verifică și că nu rămân parcele fără PV.' })

  const lAu = [...fara, ...lipsuriProiectSiUat(uats, u => verificaDateAdresaUat({ proiect, uat: u, nrDocument: u?.adresa_nr || 'AU-martor' }))]
  out.push({ cod: 'adresa_uat', model: 'Adresa către Primărie (Model 4, AU-nnnn)', ce: 'Înștiințarea Primăriei: afișarea, zilele și sala sesiunii, reprezentantul UAT; anexele cu parcelele.',
    cui: 'Primăria fiecărui UAT', canal: 'Registratură / poștă / e-mail (rândul C1 din Corespondență)', unde: '🏛️ UAT-uri → editare UAT → Generează adresa',
    lipsuri: lAu, stare: stare(lAu), nota: '' })

  const lAfis = [...fara, ...lipsuriProiectSiUat(uats, u => {
    const l = []
    if (!plin(u?.afisare_data_start) || !plin(u?.afisare_data_end)) l.push('perioada afișării')
    if (!plin(u?.afisare_pv_nr)) l.push('nr. PV de afișare')
    return l
  })]
  out.push({ cod: 'afisare', model: 'Afișarea la Primărie', ce: 'Convocarea prin afișare pentru deținătorii neidentificați sau fără adresă; PV-ul de afișare îl dă Primăria.',
    cui: 'Neidentificați / fără adresă', canal: 'Afișare', unde: '🏛️ UAT-uri → câmpurile afișării (perioadă, nr. PV afișare)',
    lipsuri: lAfis, stare: stare(lAfis), nota: 'Termenul: cel puțin 10 zile calendaristice înainte de ziua 1 de sesiune.' })

  const lCerere = verificaDateCerereImputernicire({ proiect, uats })
  out.push({ cod: 'cerere_imputernicire', model: 'Cererea de împuternicire', ce: 'Cererea către Transgaz (anexă la scrisoarea A1/A2) — DRAFT Juridic.',
    cui: 'Transgaz', canal: 'Corespondență (A2)', unde: '⚙️ Setări proiect → Generează cererea (DOCX, admin)', lipsuri: lCerere,
    stare: plin(proiect?.imputernicire_nr) && plin(proiect?.imputernicire_data) ? 'gata' : stare(lCerere, 'manual'),
    nota: plin(proiect?.imputernicire_nr) && plin(proiect?.imputernicire_data) ? 'Împuternicirea e deja înregistrată în Setări.' : 'Împuternicirea primită se trece în ⚙️ Setări proiect (nr. + dată).' })

  const coresp = Array.isArray(corespondenta) ? corespondenta : null
  const nAprobat = coresp ? coresp.filter(r => r.stare === 'aprobat').length : 0
  out.push({ cod: 'coresp', model: 'Corespondența: planul, scrisorile, înștiințările (A1–C2)', ce: 'Planul de verificare, cererile și adresele către Transgaz, ISC, DAJ, Primării; evidența trimiterii.',
    cui: 'Instituții', canal: 'E-mail / registratură / poștă', unde: '📨 Corespondență (aprobarea o dă owner-ul; „📧 Pregătește mailul” pe rândul aprobat)',
    lipsuri: coresp ? [] : ['corespondența nu s-a putut citi'], stare: coresp ? 'manual' : 'blocat',
    nota: coresp ? `${coresp.length} rânduri; ${nAprobat} aprobate, de trimis acum. Detaliul mai jos.` : '' })

  const lSms = []
  if (smsPanouEroare) lSms.push(`setările SMS nu se pot citi: ${smsPanouEroare}`)
  else if (smsPanou) { const m = motivBlocareRedari(smsPanou); if (m) lSms.push(m) }
  else lSms.push('setările SMS nu au fost citite')
  if (smsPanou?.kill_switch === true) lSms.push('trimiterea e oprită (kill-switch)')
  lSms.push(...lipsuriProiectSiUat(uats, u => (completeazaSablon({ uat: u, proiect, azi: aziIso() }).lipsuri || []).map(x => x.mesaj)))
  out.push({ cod: 'sms', model: 'SMS Redări pe UAT (șablon fix)', ce: 'Reamintirea zilei și orei sesiunii, cu telefonul de contact; un SMS de persoană.',
    cui: 'Deținătorii convocați din UAT, fără răspuns și fără PV semnat', canal: 'SMS', unde: '📋 Registru → 📱 SMS proprietari (lot draft) → 📱 SMS → Istoric (aprobare, trimitere)',
    lipsuri: lSms, stare: stare(lSms), nota: 'Textul final al SMS-ului trebuie aprobat de Juridic + Răzvan.' })

  out.push({ cod: 'mail_proprietari', model: 'E-mail către proprietari (F2)', ce: 'Trimiterea în loturi din redari@gazpet.ro.', cui: 'Deținătorii cu e-mail',
    canal: 'E-mail', unde: '—', lipsuri: ['neconstruit: planul PLAN_EMAIL_REDARI.md, felia F2'], stare: 'nelivrat',
    nota: 'E-mailul nu înlocuiește poșta cu AR (implicit (j) din plan).' })
  return out
}

// Data de azi la București (YYYY-MM-DD), pentru șablonul SMS.
function aziIso() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).map(x => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}`
}

// Canalele de răspuns: unde intră răspunsul în ERP și cum se înregistrează. `canal` = valoarea din red_raspunsuri.canal (null = nu e răspuns).
export const CANALE_RASPUNS = [
  { cod: 'online', canal: 'online', nume: 'Formular online (QR / link)', intra: 'Singur, prin fn_red_raspuns_public → red_raspunsuri (canal online) + metadatele tehnice.',
    cum: 'Operatorul nu face nimic. Al doilea răspuns pe același token e păstrat; contează ultimul.', activ: true },
  { cod: 'telefon', canal: 'telefon', nume: 'Telefon', intra: 'red_raspunsuri (canal telefon) + nota cu operatorul și sursa în red_raspunsuri_meta.',
    cum: '📋 Registru → 📞 Răspuns pe rândul deținătorului (opțiune, ziua din zilele UAT-ului, obiecții, declarația confirmată verbal).', activ: true },
  { cod: 'sesiune', canal: 'sesiune', nume: 'La sesiune (prezent)', intra: 'red_raspunsuri (canal sesiune, „particip”).',
    cum: '🗓️ Sesiune → Prezent; PV A / PV B din același ecran.', activ: true },
  { cod: 'scris', canal: 'scris', nume: 'Scris / poștă (scrisoare de la proprietar)', intra: 'Canalul „scris” există în BD, dar nu are buton.',
    cum: 'Azi: 📞 Răspuns cu nota „răspuns scris, nr. înregistrare …” (rămâne pe canalul telefon). AR / retur NU sunt răspunsuri: se trec pe plic, în ✉️ Poștă.', activ: false },
  { cod: 'sms', canal: 'sms', nume: 'SMS', intra: 'Nu există SMS de intrare: SMS-ul e doar de ieșire; se primește numai raportul de livrare.',
    cum: 'Dacă un proprietar răspunde prin SMS, se trece manual din 📞 Răspuns, cu nota „SMS”.', activ: false },
  { cod: 'email', canal: 'email', nume: 'E-mail redari@gazpet.ro', intra: 'Neactiv: citirea căsuței e felia F1 (PR #987 draft, migrări neaplicate).',
    cum: 'Până atunci: 📞 Răspuns cu nota „e-mail”. Mailul către instituții merge prin 📨 Corespondență.', activ: false },
]

// Câte răspunsuri (toate, nu doar ultimul) și câți deținători cu ULTIMUL răspuns pe fiecare canal.
export function statisticiCanale(raspunsuri, inregistrari) {
  const toate = {}, ultim = {}
  for (const r of raspunsuri || []) toate[r.canal] = (toate[r.canal] || 0) + 1
  for (const d of inregistrari || []) if (d.raspuns_canal) ultim[d.raspuns_canal] = (ultim[d.raspuns_canal] || 0) + 1
  return { toate, ultim }
}

// ───────────────────────── Centralizatorul pe deținător ─────────────────────────
const convActiva = c => c && c.stare === 'activ' && c.sters_la == null
const pvActiv = p => p && p.sters_la == null && p.stare !== 'anulat'
const grupeaza = (randuri, cheie) => {
  const m = new Map()
  for (const r of randuri || []) { const k = r?.[cheie]; if (k == null) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(r) }
  return m
}
const nivelPv = lista => (lista.some(p => p.stare === 'semnat') ? 'semnat' : lista.some(p => p.stare === 'trimis_spre_semnare') ? 'trimis' : lista.length ? 'generat' : null)

/**
 * agregaDetinatori({ randuri, convocari, raspunsuri, pvs, sms, cuTelefon, uats }) → o înregistrare per pereche parcelă × deținător
 *  randuri: red_v_stare_parcela (parcela_id, detinator_id, uat_id, uat3, uat_nume, id_parcela, tronson, nume, calitate, adresa_cunoscuta, stare)
 *  sms: Map din smsStare.citesteSmsStare (null = necitit / eroare → câmpurile SMS rămân null, nu „fără SMS”, L18)
 *  cuTelefon: Set(detinator_id) cu telefon (null = necunoscut, ex. viewer fără drept pe contact)
 */
export function agregaDetinatori({ randuri = [], convocari = [], raspunsuri = [], pvs = [], sms = null, cuTelefon = null, uats = [] } = {}) {
  const conv = grupeaza((convocari || []).filter(convActiva), 'detinator_id')
  const rasp = grupeaza(raspunsuri, 'detinator_id')
  const active = (pvs || []).filter(pvActiv)
  const pvA = grupeaza(active.filter(p => p.tip === 'A'), 'detinator_id')
  const pvB = grupeaza(active.filter(p => p.tip === 'B'), 'parcela_id')
  const uatPeId = new Map((uats || []).map(u => [u.id, u]))
  return (randuri || []).map(r => {
    const c = conv.get(r.detinator_id) || [], rs = rasp.get(r.detinator_id) || []
    const ultim = ultimulRaspuns(rs)
    const s = sms ? (sms.get(String(r.detinator_id).toLowerCase()) || null) : undefined
    const uat = uatPeId.get(r.uat_id)
    const neidentificat = r.calitate === 'neidentificat'
    const faraAdresa = !neidentificat && r.adresa_cunoscuta === false
    const afisat = (neidentificat || faraAdresa) && !!(uat && plin(uat.afisare_pv_nr) && plin(uat.afisare_data_start))
    const nivA = nivelPv(pvA.get(r.detinator_id) || []), nivB = nivelPv(pvB.get(r.parcela_id) || [])
    const ar = c.some(x => plin(x.data_confirmare_primire))
    const smsLivrat = s ? s.categorie === 'livrat' : s === null ? false : null
    const reusit = { ar, sms: smsLivrat === true, raspuns: !!ultim, pv: nivA === 'semnat' || nivB === 'semnat', afisare: afisat }
    const areCanal = Object.values(reusit).some(Boolean)
    const expediat = c.some(x => plin(x.data_expediere))
    const retur = calculeazaStare({ convocari: c }).stare === 'CONVOCARE_RETURNATA'
    // plecat, neconfirmat: o convocare expediată fără AR și fără retur, sau un SMS plecat fără confirmare de livrare
    const inCurs = c.some(x => plin(x.data_expediere) && !plin(x.data_confirmare_primire) && !plin(x.retur)) || (s ? s.categorie === 'trimis' || s.categorie === 'in_curs' : false)
    return {
      parcela_id: r.parcela_id, detinator_id: r.detinator_id, uat_id: r.uat_id, uat3: r.uat3, uat_nume: r.uat_nume || uat?.nume || r.uat3,
      id_parcela: r.id_parcela, tronson: r.tronson ?? null, nume: r.nume, calitate: r.calitate, stare: r.stare,
      convocator: c.some(x => plin(x.nr_document)), convocator_fisier: c.some(x => plin(x.fisier_convocator_path)), expediat, ar,
      retur,
      sms: s === undefined ? null : s ? s.categorie : 'fara', sms_trimise: s === undefined ? null : s ? s.nr_trimise : 0,
      raspuns_canal: ultim ? ultim.canal : null, raspuns_optiune: ultim ? ultim.optiune : null, raspunsuri: rs.length,
      pv_a: nivA, pv_b: nivB, afisat, neidentificat, fara_adresa: faraAdresa,
      fara_telefon: cuTelefon ? !cuTelefon.has(r.detinator_id) : null,
      canal_reusit: areCanal, canale_reusite: Object.keys(reusit).filter(k => reusit[k]),
      // „de trimis” = fără niciun canal reușit; dintre ei, „în curs” = plecat (expediat fără AR / SMS fără confirmare), restul = netrimis deloc
      de_trimis: !areCanal, in_curs: !areCanal && inCurs,
    }
  })
}

// Filtrele centralizatorului (aplicate pe înregistrări; cod necunoscut = eroare, nu „toate” tacit).
export const FILTRE_NOTIF = [
  { cod: '', eticheta: 'Toți deținătorii' },
  { cod: 'de_trimis', eticheta: 'De trimis (fără canal reușit)', f: d => d.de_trimis },
  { cod: 'netrimis', eticheta: 'Netrimis deloc', f: d => d.de_trimis && !d.in_curs },
  { cod: 'in_curs', eticheta: 'Plecat, fără confirmare', f: d => d.in_curs },
  { cod: 'fara_raspuns', eticheta: 'Fără răspuns', f: d => !d.raspunsuri },
  { cod: 'retur', eticheta: 'Cu retur', f: d => d.retur },
  { cod: 'sms_esuat', eticheta: 'SMS eșuat', f: d => d.sms === 'esuat' },
  { cod: 'fara_adresa', eticheta: 'Fără adresă', f: d => d.fara_adresa },
  { cod: 'neidentificat', eticheta: 'Neidentificat', f: d => d.neidentificat },
  { cod: 'fara_telefon', eticheta: 'Fără telefon', f: d => d.fara_telefon === true },
]
export function filtreaza(inregistrari, { uatId = '', filtru = '' } = {}) {
  const f = FILTRE_NOTIF.find(x => x.cod === filtru)
  if (!f) throw new Error(`Filtru necunoscut: ${filtru}`)
  return (inregistrari || []).filter(d => (!uatId || d.uat_id === uatId) && (!f.f || f.f(d)))
}

// Coloanele centralizatorului: [cheie, etichetă, numărare]. Numărarea întoarce null când sursa e necunoscută (SMS / telefon necitite).
const numara = (lista, f) => lista.reduce((n, d) => n + (f(d) ? 1 : 0), 0)
const numaraSauNull = (lista, camp, f) => (lista.some(d => d[camp] === null) ? null : numara(lista, f))
export const COLOANE_CENTRALIZATOR = [
  ['total', 'Deținători', l => l.length],
  ['convocator', 'Convocator generat', l => numara(l, d => d.convocator)],
  ['expediat', 'Expediat', l => numara(l, d => d.expediat)],
  ['ar', 'AR primit', l => numara(l, d => d.ar)],
  ['retur', 'Retur', l => numara(l, d => d.retur)],
  ['sms_trimis', 'SMS trimis', l => numaraSauNull(l, 'sms', d => d.sms_trimise > 0)],
  ['sms_livrat', 'SMS livrat', l => numaraSauNull(l, 'sms', d => d.sms === 'livrat')],
  ['sms_esuat', 'SMS eșuat', l => numaraSauNull(l, 'sms', d => d.sms === 'esuat')],
  ['raspuns', 'Răspuns primit', l => numara(l, d => d.raspunsuri > 0)],
  ['r_online', '· online', l => numara(l, d => d.raspuns_canal === 'online')],
  ['r_telefon', '· telefon', l => numara(l, d => d.raspuns_canal === 'telefon')],
  ['r_sesiune', '· la sesiune', l => numara(l, d => d.raspuns_canal === 'sesiune')],
  ['r_alt', '· alt canal', l => numara(l, d => d.raspuns_canal && !['online', 'telefon', 'sesiune'].includes(d.raspuns_canal))],
  ['pv_a_generat', 'PV A generat', l => numara(l, d => !!d.pv_a)],
  ['pv_a_semnat', 'PV A semnat', l => numara(l, d => d.pv_a === 'semnat')],
  ['pv_b_generat', 'PV B (parcelă)', l => numara(l, d => !!d.pv_b)],
  ['pv_b_semnat', 'PV B semnat', l => numara(l, d => d.pv_b === 'semnat')],
  ['afisat', 'Afișat la Primărie', l => numara(l, d => d.afisat)],
  ['de_trimis', 'De trimis', l => numara(l, d => d.de_trimis)],
  ['in_curs', '· plecat, neconfirmat', l => numara(l, d => d.in_curs)],
  ['fara_adresa', 'Fără adresă', l => numara(l, d => d.fara_adresa)],
  ['neidentificat', 'Neidentificat', l => numara(l, d => d.neidentificat)],
  ['fara_telefon', 'Fără telefon', l => numaraSauNull(l, 'fara_telefon', d => d.fara_telefon === true)],
]

/** centralizeaza(inregistrari) → { randuri: [{ uat_id, uat_nume, ...cifre }], total: {...cifre} } — UAT-urile sortate după nume. */
export function centralizeaza(inregistrari) {
  const cifre = lista => Object.fromEntries(COLOANE_CENTRALIZATOR.map(([k, , f]) => [k, f(lista)]))
  const pe = new Map()
  for (const d of inregistrari || []) {
    if (!pe.has(d.uat_id)) pe.set(d.uat_id, { uat_id: d.uat_id, uat_nume: d.uat_nume, lista: [] })
    pe.get(d.uat_id).lista.push(d)
  }
  const randuri = [...pe.values()].sort((a, b) => String(a.uat_nume ?? '').localeCompare(String(b.uat_nume ?? ''), 'ro'))
    .map(g => ({ uat_id: g.uat_id, uat_nume: g.uat_nume, ...cifre(g.lista) }))
  return { randuri, total: cifre(inregistrari || []) }
}

// ───────────────────────── Export (fără telefoane) ─────────────────────────
const daNu = v => (v === true ? 'DA' : v === false ? 'NU' : '')
const ETICHETE_SMS = { livrat: 'livrat', trimis: 'trimis (neconfirmat)', in_curs: 'în curs', esuat: 'eșuat', fara: 'fără SMS' }
export const ANTET_DETINATORI = ['ID parcelă', 'UAT', 'Tronson', 'Deținător', 'Calitate', 'Stare', 'Convocator', 'Expediat', 'AR primit', 'Retur',
  'SMS', 'Răspuns (canal)', 'Nr. răspunsuri', 'PV A', 'PV B', 'Afișat', 'Canale reușite', 'De trimis', 'Plecat, neconfirmat', 'Fără adresă', 'Neidentificat', 'Fără telefon']
export function randDetinator(d) {
  return [d.id_parcela ?? '', d.uat_nume ?? '', d.tronson ?? '', d.nume ?? '', d.calitate ?? '', d.stare ?? '', daNu(d.convocator), daNu(d.expediat), daNu(d.ar), daNu(d.retur),
    d.sms == null ? 'necunoscut' : ETICHETE_SMS[d.sms] ?? d.sms, d.raspuns_canal ?? '', d.raspunsuri, d.pv_a ?? '', d.pv_b ?? '', daNu(d.afisat),
    d.canale_reusite.join(', '), daNu(d.de_trimis), daNu(d.in_curs), daNu(d.fara_adresa), daNu(d.neidentificat), d.fara_telefon == null ? 'necunoscut' : daNu(d.fara_telefon)]
}
export function foaieCentralizatorNotif({ randuri, total }) {
  const cap = ['UAT', ...COLOANE_CENTRALIZATOR.map(([, e]) => e)]
  const val = v => (v == null ? 'necunoscut' : v)
  return [cap, ...randuri.map(r => [r.uat_nume, ...COLOANE_CENTRALIZATOR.map(([k]) => val(r[k]))]), ['TOTAL', ...COLOANE_CENTRALIZATOR.map(([k]) => val(total[k]))]]
}
// CSV cu ; și BOM (Excel RO), celule protejate de formula-injection (celulaCsv din docx.js).
export function csvDetinatori(inregistrari) {
  const linii = [ANTET_DETINATORI, ...(inregistrari || []).map(randDetinator)].map(r => r.map(celulaCsv).join(';'))
  return '﻿' + linii.join('\r\n') + '\r\n'
}

// Corespondența pentru ghid: rândurile sortate, cu eticheta stării. Eticheta „aprobat” fără nume (audit D1: aprobarea o poate da alt cont).
export function randuriCorespondenta(randuri) {
  return [...(randuri || [])].sort((a, b) => (a.ordine ?? 0) - (b.ordine ?? 0) || String(a.cod).localeCompare(String(b.cod)))
    .map(r => ({ cod: r.cod, destinatar: r.destinatar, subiect: r.subiect, stare: r.stare,
      eticheta: r.stare === 'aprobat' ? 'Aprobat' : etichetaStareCoresp(r.stare), trimis_la: r.trimis_la || null, depinde_de: r.depinde_de || '' }))
}
