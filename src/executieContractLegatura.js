// ===========================================================================
// TKT-2026-0333 — contracte introduse în Execuție care nu apar în Administrativ
// ===========================================================================
// Wizardul „Proiect nou” și „Editează” scriu nr_contract / data / valoare direct în
// executie_proiecte, fără rând în contracte_terti și fără contract_id. Sincronizarea
// există doar invers (Administrativ → Execuție, prin șantier). Aici stă logica pură:
// cine e „nelegat”, ce contracte din Administrativ se potrivesc și ce trebuie completat
// la înregistrare. Fără acces la BD — componenta UI face citirea și UPDATE-ul.
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
