// ===========================================================================
// TKT-2026-0333 — contracte introduse în Execuție care nu apar în Administrativ
// ===========================================================================
// Wizardul „Proiect nou” și „Editează” scriu nr_contract / data / valoare direct în
// executie_proiecte, fără rând în contracte_terti și fără contract_id. Sincronizarea
// există doar invers (Administrativ → Execuție, prin șantier). Aici stă logica pură:
// cine e „nelegat”, ce contracte din Administrativ se potrivesc și ce trebuie completat
// la înregistrare. Fără client Supabase importat: singura funcție cu I/O (aplicaLegaturaLaSalvare)
// primește clientul ca parametru, ca să fie testată cu un client fals.
import { norm } from './lib/diacritice.js'

export const ETICHETA_CONTRACT_NELEGAT = '⚠ Contract neînregistrat în Administrativ'
export const TOOLTIP_CONTRACT_NELEGAT =
  'Numărul de contract e completat doar în Execuție: contractul nu există în Administrativ → Contracte cu terți, ' +
  'deci nu apare acolo (acte adiționale, garanții, facturare). Leagă-l de un contract existent din Administrativ ' +
  'sau înregistrează-l acolo.'
// Administrativ citește ?tab= la deschidere (tab-ul nepermis cade pe primul disponibil)
export const LINK_ADMIN_CONTRACTE = '/administrativ?tab=contracte_terti'

const textCurat = v => String(v ?? '').trim()

// Proiect cu număr de contract scris doar în Execuție (fără legătură la contracte_terti)
export const eContractNelegat = p => !!p && p.contract_id == null && textCurat(p.nr_contract) !== ''

// Număr comparabil: fără „nr.”, diacritice și spații („Nr. 686 / 2024” → „686/2024”)
export const normNrContract = s => norm(textCurat(s)).replace(/^(nr\.?|numar)\s*/, '').replace(/\s+/g, '')
// Partea de dinainte de „/” („686/20.06.2024” → „686”)
const nrBaza = s => normNrContract(s).split('/')[0]

const ziua = d => textCurat(d).slice(0, 10)
export const fmtZi = d => { const z = ziua(d); return /^\d{4}-\d{2}-\d{2}$/.test(z) ? z.split('-').reverse().join('.') : '' }
export const fmtLeiSimplu = v => {
  const n = Number(v)
  return v != null && v !== '' && Number.isFinite(n) && n > 0
    ? n.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' lei' : ''
}

export const partenerContract = (c, benefMap = {}) => textCurat(c?.partener_text) || benefMap[c?.beneficiar_id] || '—'

// Cât de probabil e ca un contract din Administrativ să fie contractul proiectului
export function scorPotrivire(p, c) {
  let scor = 0
  const motive = []
  const np = normNrContract(p?.nr_contract), nc = normNrContract(c?.numar_contract)
  if (np && nc) {
    if (np === nc) { scor += 3; motive.push('același număr') }
    else if (nrBaza(np) && nrBaza(np) === nrBaza(nc)) { scor += 2; motive.push('număr asemănător') }
  }
  if (ziua(p?.data_contract) && ziua(p?.data_contract) === ziua(c?.data_semnare)) { scor += 2; motive.push('aceeași dată') }
  // valoarea INIȚIALĂ a proiectului (cea din contractul semnat) vs valoarea de bază a contractului
  const vp = Number(p?.valoare_initiala_lei ?? p?.valoare_lei), vc = Number(c?.valoare_lei)
  if (vp > 0 && vc > 0 && Math.abs(vp - vc) < 1) { scor += 2; motive.push('aceeași valoare') }
  if (p?.site_id != null) {
    const site = Number(p.site_id)
    if (Number(c?.site_id) === site || (c?.santiere_ids || []).map(Number).includes(site)) { scor += 1; motive.push('același șantier') }
  }
  return { scor, motive }
}

// Lista de ales: fără arhivate; implicit doar încasare (contractul cu beneficiarul);
// căutare fără diacritice pe număr, partener, denumire, dată, valoare; cele potrivite primele
export function filtreazaContracte(contracte, { cautare = '', doarIncasare = true, proiect = null, benefMap = {} } = {}) {
  const termeni = norm(cautare).split(/\s+/).filter(Boolean)
  return (contracte || [])
    .filter(c => c && !c.arhivat_la)
    .filter(c => !doarIncasare || c.sens === 'incasare')
    .filter(c => {
      if (!termeni.length) return true
      const text = norm([c.numar_contract, partenerContract(c, benefMap), c.denumire, ziua(c.data_semnare), fmtZi(c.data_semnare), c.valoare_lei].join(' '))
      return termeni.every(t => text.includes(t))
    })
    .map(c => ({ contract: c, ...scorPotrivire(proiect, c) }))
    .sort((a, b) => b.scor - a.scor
      || ziua(b.contract.data_semnare).localeCompare(ziua(a.contract.data_semnare))
      || Number(b.contract.id) - Number(a.contract.id))
}

// contract_id → proiectul care îl folosește deja (altul decât cel curent); Administrativ ține legătura 1:1
export function proiectLegatAltundeva(contractId, legaturi, proiectIdCurent) {
  const alt = (legaturi || []).find(l => l.contract_id != null && Number(l.contract_id) === Number(contractId) && Number(l.id) !== Number(proiectIdCurent))
  return alt || null
}

// Indexul unic executie_proiecte_contract_id_unic (20261030b) respinge a doua legare a aceluiași contract cu 23505
export const eContractOcupat = err => err?.code === '23505'
export function mesajEroareLegare(err) {
  if (eContractOcupat(err)) return 'Contractul tocmai a fost legat de alt proiect — lista s-a reîncărcat, alege altul.'
  return 'Legătura a fost refuzată: ' + (err?.message || 'eroare necunoscută')
}

// ── Administrativ → editorul de contract: legătura spre Execuție (Jakarinos r1 + r2 P2 pe #709) ──
// Înainte, editorul găsea proiectul legat DOAR prin șantier; la un proiect fără șantier (legat manual din Execuție)
// câmpul rămânea gol, iar salvarea dezlega proiectul. Iar o citire EȘUATĂ arăta ca „nicio legătură”: se ghicea un
// șantier după denumire și salvarea muta contractul pe alt proiect. Acum „citire eșuată” ≠ „nicio legătură”.

// Starea legăturii la deschiderea editorului, din rezultatul SELECT-ului după contract_id ({ data, error })
//  'ok' — citire reușită (proiectLegat = rândul sau null) · 'eroare' — nu știm ce e legat, deci nu atingem nimic
export function stareLegaturaDinCitire({ isNew, citire }) {
  if (isNew) return { stare: 'ok', proiectLegat: null, eroare: null }
  if (!citire || citire.error) return { stare: 'eroare', proiectLegat: null, eroare: citire?.error?.message || 'citire eșuată' }
  return { stare: 'ok', proiectLegat: citire.data || null, eroare: null }
}

// Ghicirea șantierului după denumire (regula veche din editor, neschimbată): cel mai bun scor ≥ 0.35, altfel null
const CUVINTE_IGNORATE = new Set(['gazpet', 'transgaz', 'gaze', 'natural', 'naturale', 'conducta', 'cond', 'transport'])
export function ghicesteSantier(denumire, sites) {
  const d = String(denumire || '').toLowerCase()
  let best = null, bestSc = 0
  for (const s of sites || []) {
    const kws = String(s?.name || '').toLowerCase().split(/[\s\-_/]+/).filter(w => w.length > 3 && !CUVINTE_IGNORATE.has(w))
    const sc = kws.length ? kws.filter(w => d.includes(w)).length / kws.length : 0
    if (sc > bestSc) { best = s; bestSc = sc }
  }
  return bestSc >= 0.35 ? best : null
}
// Ghicirea nu are voie să înlocuiască o legătură existentă și nici să ruleze când n-am putut citi legătura
export const autoDetectieSantierPermisa = ({ categorie, denumire, proiectLegat, citireOk }) =>
  citireOk === true && categorie === 'executie' && textCurat(denumire) !== '' && !proiectLegat

// Șantierul precompletat la deschidere: al proiectului legat; altfel ghicit — doar după o citire reușită
export function santierInitial({ stare, proiectLegat, categorie, denumire, sites }) {
  if (stare !== 'ok') return ''
  if (proiectLegat?.site_id != null) return String(proiectLegat.site_id)
  if (!autoDetectieSantierPermisa({ categorie, denumire, proiectLegat, citireOk: true })) return ''
  const s = ghicesteSantier(denumire, sites)
  return s?.id != null ? String(s.id) : ''
}

// Ce face salvarea cu legătura:
//  'blocat'             — legătura nu s-a citit (eroare / încă în curs): NU se atinge executie_proiecte
//  'leaga_prin_santier' — e ales un șantier: proiectul activ al șantierului (ca până acum)
//  'pastreaza'          — niciun șantier, dar contractul e legat de un proiect FĂRĂ șantier: legătura rămâne
//  'dezleaga'           — doar la cerere explicită: bifa „Dezleagă” sau golirea câmpului la un proiect care avea șantier
//  'avertizare'         — nimic legat, niciun șantier: doar avertismentul (fără UPDATE pe executie_proiecte)
//  'nimic'              — altă categorie decât execuție
// stareLegatura lipsă = 'blocat' (fail-closed)
export function decizieLegaturaLaSalvare({ categorie, siteSelectat, proiectLegat, dezleagaCerut = false, stareLegatura }) {
  if (categorie !== 'executie') return 'nimic'
  if (stareLegatura !== 'ok') return 'blocat'
  if (siteSelectat) return 'leaga_prin_santier'
  if (!proiectLegat) return 'avertizare'
  if (dezleagaCerut || proiectLegat.site_id != null) return 'dezleaga'
  return 'pastreaza'
}

const numeProiect = p => p?.cod_intern || p?.nume || (p?.id != null ? '#' + p.id : '')
// Execută decizia pe executie_proiecte; fiecare pas își verifică eroarea. Întoarce
// { ok, mesaj, dezlegat } — mesaj = ce vede utilizatorul (null = nimic de semnalat); dezlegat doar la succes.
export async function aplicaLegaturaLaSalvare(db, { decizie, contractId, siteSelectat, proiectLegat, dateSync }) {
  const salvatDar = '⚠️ Contractul a fost salvat, dar '
  if (decizie === 'nimic') return { ok: true, mesaj: null }
  if (decizie === 'blocat') return { ok: false, mesaj: salvatDar + 'legătura cu Execuția NU a fost atinsă: nu am putut citi proiectul legat. Apasă „↻ Reîncearcă citirea” la Șantier asociat și salvează din nou.' }
  if (decizie === 'avertizare') return { ok: false, mesaj: salvatDar + 'nu e legat la niciun Șantier! Selectează șantierul din câmpul de mai jos și re-salvează.' }
  if (decizie === 'pastreaza') {
    const { error } = await db.from('executie_proiecte').update(dateSync).eq('id', proiectLegat.id).eq('contract_id', contractId)
    return error ? { ok: false, mesaj: salvatDar + `datele nu s-au sincronizat în proiectul ${numeProiect(proiectLegat)}: ${error.message}` } : { ok: true, mesaj: null }
  }
  if (decizie === 'dezleaga') {
    const { error } = await db.from('executie_proiecte').update({ contract_id: null }).eq('contract_id', contractId)
    if (error) return { ok: false, mesaj: salvatDar + `dezlegarea de proiectul ${numeProiect(proiectLegat)} a eșuat (${error.message}); legătura a rămas.` }
    return { ok: true, dezlegat: true, mesaj: `⚠️ Contractul a fost salvat și dezlegat de proiectul ${numeProiect(proiectLegat)} din Execuție. Pentru o legătură nouă alege șantierul și re-salvează.` }
  }
  if (decizie === 'leaga_prin_santier') {
    const { data: gasit, error: eGasit } = await db.from('executie_proiecte').select('id')
      .eq('site_id', Number(siteSelectat)).eq('activ', true).maybeSingle()
    if (eGasit) return { ok: false, mesaj: salvatDar + `nu am putut găsi proiectul activ al șantierului (${eGasit.message}); legătura nu s-a modificat.` }
    if (!gasit) return { ok: true, mesaj: null }   // ca până acum: șantier fără proiect activ → nimic de legat
    // dezleagă eventualul proiect anterior (alt șantier), apoi leagă proiectul șantierului + sincronizează datele
    const { error: eDez } = await db.from('executie_proiecte').update({ contract_id: null }).eq('contract_id', contractId).neq('id', gasit.id)
    if (eDez) return { ok: false, mesaj: salvatDar + `dezlegarea proiectului anterior a eșuat (${eDez.message}); legătura nu s-a modificat.` }
    const { error: eLeg } = await db.from('executie_proiecte').update({ contract_id: contractId, ...dateSync }).eq('id', gasit.id)
    if (eLeg) return { ok: false, mesaj: salvatDar + (eContractOcupat(eLeg)
      ? 'contractul e deja legat de alt proiect; legătura nouă nu s-a făcut.'
      : `legarea de proiectul șantierului a eșuat (${eLeg.message}). Verifică în Execuție dacă proiectul anterior a rămas dezlegat.`) }
    return { ok: true, mesaj: null }
  }
  return { ok: false, mesaj: salvatDar + 'legătura cu Execuția nu s-a modificat (decizie necunoscută).' }
}

// Ce se completează în Administrativ → Contracte cu terți → „+ Contract nou”
export function instructiuniInregistrare(p) {
  const linii = [
    'Categorie: Execuție · Sens financiar: Încasare',
    `Partener: ${textCurat(p?.beneficiar) || 'beneficiarul lucrării'}`,
    `Număr contract: ${textCurat(p?.nr_contract) || '—'}${fmtZi(p?.data_contract) ? ` · Data semnare: ${fmtZi(p.data_contract)}` : ''}`,
  ]
  const val = fmtLeiSimplu(p?.valoare_initiala_lei ?? p?.valoare_lei)
  if (val) linii.push(`Valoare LEI: ${val}`)
  if (textCurat(p?.nume)) linii.push(`Denumire: ${textCurat(p.nume)}`)
  linii.push(p?.site_id != null
    ? `📍 Șantier asociat: ${textCurat(p.site_name) || `șantierul #${p.site_id}`} — obligatoriu, altfel legătura automată cu proiectul nu se face`
    : '📍 Proiectul nu are șantier, deci legătura automată din Administrativ nu se face: după salvare revino aici și apasă „Leagă de un contract din Administrativ”')
  return linii
}

export function textToastInregistrare(p) {
  const nr = textCurat(p?.nr_contract)
  return p?.site_id != null
    ? `În Administrativ → Contracte cu terți: „+ Contract nou”, Execuție · Încasare, nr. ${nr}, cu șantierul ${textCurat(p.site_name) || '#' + p.site_id} — legătura se face singură la salvare.`
    : `În Administrativ → Contracte cu terți: „+ Contract nou”, Execuție · Încasare, nr. ${nr}. Proiectul n-are șantier: după salvare revino și apasă „Leagă”.`
}
