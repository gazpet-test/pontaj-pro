// Redări teren — starea unei perechi (parcelă, deținător).
// Aceeași ierarhie ca vederea SQL red_v_stare_parcela (docs/redari/CONTRACT_SCHEMA.md §3):
// prima regulă adevărată câștigă, `ordine` = numărul regulii (1 = cel mai avansat).
// Modul pur, fără React și fără Supabase — se folosește în UI (etichete, culori, filtrare)
// și în teste ca oglindă a logicii din BD.

export const STARI = [
  // Ambele stări A sunt închise (rang 1); semnătura proprie are prioritate la afișare.
  { cod: 'PV_A_ACOPERIT_PARCELA', ordine: 1, eticheta: 'Acoperit prin PV A pe parcelă', culoare: '#16a34a' },
  { cod: 'PV_A_SEMNAT',             ordine: 1,  eticheta: 'PV A semnat',                 culoare: '#16a34a' },
  { cod: 'PV_B_CONSTATARE',         ordine: 2,  eticheta: 'PV B constatare',             culoare: '#0d9488' },
  { cod: 'PV_TRIMIS_SPRE_SEMNARE',  ordine: 3,  eticheta: 'PV trimis spre semnare',      culoare: '#2563eb' },
  { cod: 'OBIECTII_DE_TRATAT',      ordine: 4,  eticheta: 'Obiecții de tratat',          culoare: '#dc2626' },
  { cod: 'A_RASPUNS_FARA_OBIECTII', ordine: 5,  eticheta: 'A răspuns — fără obiecții',   culoare: '#65a30d' },
  { cod: 'A_RASPUNS_PARTICIPA',     ordine: 6,  eticheta: 'A răspuns — participă',       culoare: '#0891b2' },
  { cod: 'CONVOCARE_RETURNATA',     ordine: 7,  eticheta: 'Convocare returnată',         culoare: '#ea580c' },
  { cod: 'CONVOCAT_FARA_RASPUNS',   ordine: 8,  eticheta: 'Convocat, fără răspuns',      culoare: '#ca8a04' },
  { cod: 'EXPEDIAT_ASTEPTAM_AR',    ordine: 9,  eticheta: 'Expediat, așteptăm AR',       culoare: '#7c3aed' },
  { cod: 'NEIDENTIFICAT_AFISARE',   ordine: 10, eticheta: 'Neidentificat — afișare',     culoare: '#a16207' },
  { cod: 'FARA_ADRESA_AFISARE',     ordine: 11, eticheta: 'Fără adresă — afișare',       culoare: '#b45309' },
  { cod: 'DE_CONVOCAT',             ordine: 12, eticheta: 'De convocat',                 culoare: '#6b7280' },
]

const PE_COD = Object.fromEntries(STARI.map(s => [s.cod, s]))

export function etichetaStare(cod) {
  return PE_COD[cod]?.eticheta ?? String(cod ?? '')
}

export function culoareStare(cod) {
  return PE_COD[cod]?.culoare ?? '#6b7280'
}

// Data ca număr (ms) sau NaN când lipsește / nu se poate parsa. Acceptă Date, 'YYYY-MM-DD', timestamptz.
function ms(v) {
  if (v == null || v === '') return NaN
  if (v instanceof Date) return v.getTime()
  const t = Date.parse(v)
  return Number.isNaN(t) ? NaN : t
}

const pvActiv = pv => pv && pv.sters_la == null && pv.stare !== 'anulat'
const convActiva = c => c && c.stare === 'activ' && c.sters_la == null

// „Ultimul răspuns” = ORDER BY data DESC, seq DESC (identitatea din BD, tie-break), apoi created_at DESC, apoi poziția în listă
// (compatibilitate cu obiecte fără seq). Identic cu LATERAL-ul din red_v_stare_parcela.
const numarSau = (v, implicit) => { const n = Number(v); return v == null || v === '' || Number.isNaN(n) ? implicit : n }
export function ultimulRaspuns(raspunsuri) {
  if (!Array.isArray(raspunsuri) || raspunsuri.length === 0) return null
  const cheie = (r, i) => {
    const t = ms(r.data)
    return [Number.isNaN(t) ? -Infinity : t, numarSau(r.seq, -Infinity), Number.isNaN(ms(r.created_at)) ? -Infinity : ms(r.created_at), i]
  }
  const maiMare = (a, b) => { for (let j = 0; j < a.length; j++) { if (a[j] !== b[j]) return a[j] > b[j] } return false }
  let best = null, bestK = null
  raspunsuri.forEach((r, i) => {
    if (!r) return
    const k = cheie(r, i)
    if (!bestK || maiMare(k, bestK)) { best = r; bestK = k }
  })
  return best
}

// Există convocare activă cu retur și nicio convocare activă confirmată ULTERIOR returului
// (referința returului = retur_data, altfel data_expediere; fără nicio dată, orice confirmare activă contează ca ulterioară).
// Confirmarea poate fi chiar pe convocarea returnată (P2-10): AR primit după retur stinge returul.
function convocareReturnataFaraConfirmareUlterioara(convocari) {
  const active = convocari.filter(convActiva)
  const returnate = active.filter(c => c.retur != null && c.retur !== '')
  if (returnate.length === 0) return false
  const confirmate = active.filter(c => c.data_confirmare_primire != null && c.data_confirmare_primire !== '')
  return returnate.some(r => {
    const ref = Number.isNaN(ms(r.retur_data)) ? ms(r.data_expediere) : ms(r.retur_data)
    return !confirmate.some(c => Number.isNaN(ref) || ms(c.data_confirmare_primire) >= ref)
  })
}

/**
 * calculeazaStare({ calitate, adresa_cunoscuta, convocari, raspunsuri, pvs }) → { stare, ordine }
 *  - convocari: rândurile red_convocari ale deținătorului (active = stare 'activ')
 *  - raspunsuri: rândurile red_raspunsuri ale deținătorului
 *  - pvs: PV-urile relevante — tip 'A' ale deținătorului, tip 'B' ale parcelei (active = stare ≠ 'anulat' și sters_la null)
 */
export function calculeazaStare({ calitate, adresa_cunoscuta, convocari = [], raspunsuri = [], pvs = [], parcela_acoperita_a = false } = {}) {
  const conv = Array.isArray(convocari) ? convocari : []
  const pv = (Array.isArray(pvs) ? pvs : []).filter(pvActiv)

  const rezultat = cod => ({ stare: cod, ordine: PE_COD[cod].ordine })

  // 1. PV A semnat
  if (pv.some(p => p.tip === 'A' && p.stare === 'semnat')) return rezultat('PV_A_SEMNAT')
  // Flag calculat de fn_red_parcela_acoperita_a, nu din răspunsul la convocare.
  if (parcela_acoperita_a === true) return rezultat('PV_A_ACOPERIT_PARCELA')
  // 2. PV B pe parcelă (stare ≠ anulat)
  if (pv.some(p => p.tip === 'B')) return rezultat('PV_B_CONSTATARE')
  // 3. PV A trimis spre semnare
  if (pv.some(p => p.tip === 'A' && p.stare === 'trimis_spre_semnare')) return rezultat('PV_TRIMIS_SPRE_SEMNARE')

  // 4–6. ultimul răspuns
  const ultim = ultimulRaspuns(raspunsuri)
  if (ultim) {
    if (ultim.optiune === 'nu_particip_cu_obiectii' || ultim.optiune === 'constatare_teren') return rezultat('OBIECTII_DE_TRATAT')
    if (ultim.optiune === 'nu_particip_fara_obiectii') return rezultat('A_RASPUNS_FARA_OBIECTII')
    if (ultim.optiune === 'particip') return rezultat('A_RASPUNS_PARTICIPA')
  }

  // 7. retur fără confirmare ulterioară
  if (convocareReturnataFaraConfirmareUlterioara(conv)) return rezultat('CONVOCARE_RETURNATA')

  const active = conv.filter(convActiva)
  // 8. confirmat primit și niciun răspuns
  const areRaspuns = Array.isArray(raspunsuri) && raspunsuri.some(Boolean)
  if (!areRaspuns && active.some(c => c.data_confirmare_primire != null && c.data_confirmare_primire !== '')) return rezultat('CONVOCAT_FARA_RASPUNS')
  // 9. expediat, fără confirmare și fără retur
  if (active.some(c => c.data_expediere != null && c.data_expediere !== ''
      && (c.data_confirmare_primire == null || c.data_confirmare_primire === '')
      && (c.retur == null || c.retur === ''))) return rezultat('EXPEDIAT_ASTEPTAM_AR')

  // 10–11. afișare
  if (calitate === 'neidentificat') return rezultat('NEIDENTIFICAT_AFISARE')
  if (adresa_cunoscuta === false) return rezultat('FARA_ADRESA_AFISARE')

  // 12. restul
  return rezultat('DE_CONVOCAT')
}

// Q5: o singură stare per parcelă, indiferent de numărul de proprietari/utilizatori.
// Fără acoperire A/B, starea cea mai puțin avansată păstrează vizibil lucrul rămas.
export const STARI_INCHISE = ['PV_A_SEMNAT', 'PV_A_ACOPERIT_PARCELA', 'PV_B_CONSTATARE']
export function stariParcele(randuri) {
  const pe = new Map()
  for (const r of randuri) {
    if (!r.parcela_id || !r.uat_id || !PE_COD[r.stare]) throw new Error('Stare parcelă incompletă sau necunoscută.')
    if (!pe.has(r.parcela_id)) pe.set(r.parcela_id, [])
    pe.get(r.parcela_id).push(r)
  }
  return [...pe.values()].map(lista => {
    if (lista.some(r => r.uat_id !== lista[0].uat_id)) throw new Error('Parcela are UAT-uri diferite.')
    const mostenite = lista.filter(r => r.stare_parcela != null)
    if (mostenite.length && (mostenite.length !== lista.length || mostenite.some(r => !PE_COD[r.stare_parcela] || r.stare_parcela !== mostenite[0].stare_parcela))) throw new Error('Starea întregii parcele este inconsistentă.')
    const stare = mostenite.length ? mostenite[0].stare_parcela : lista.some(r => r.stare === 'PV_A_ACOPERIT_PARCELA') ? 'PV_A_ACOPERIT_PARCELA'
      : lista.every(r => r.stare === 'PV_A_SEMNAT') ? 'PV_A_SEMNAT'
      : lista.some(r => r.stare === 'PV_B_CONSTATARE') ? 'PV_B_CONSTATARE'
      : lista.reduce((a, b) => PE_COD[a.stare].ordine >= PE_COD[b.stare].ordine ? a : b).stare
    return { ...lista[0], stare }
  })
}
export function centralizatorParcele(randuri) {
  const pe = new Map()
  for (const r of stariParcele(randuri)) {
    const k = JSON.stringify([r.uat_id, r.stare])
    if (!pe.has(k)) pe.set(k, { proiect_id: r.proiect_id, uat_id: r.uat_id, uat3: r.uat3, uat_nume: r.uat_nume, stare: r.stare, numar: 0 })
    pe.get(k).numar++
  }
  return [...pe.values()]
}

// Filtrarea persoanelor nu poate transforma semnătura unui coproprietar în acoperirea întregii parcele.
export function stariCuParcela(randuri) {
  const pe = new Map(stariParcele(randuri).map(p => [p.parcela_id, p.stare]))
  return randuri.map(r => ({ ...r, stare_parcela: pe.get(r.parcela_id) }))
}
