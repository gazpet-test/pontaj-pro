// Redări teren — starea unei perechi (parcelă, deținător).
// Aceeași ierarhie ca vederea SQL red_v_stare_parcela (docs/redari/CONTRACT_SCHEMA.md §3):
// prima regulă adevărată câștigă, `ordine` = numărul regulii (1 = cel mai avansat).
// Modul pur, fără React și fără Supabase — se folosește în UI (etichete, culori, filtrare)
// și în teste ca oglindă a logicii din BD.

export const STARI = [
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
const convActiva = c => c && c.stare === 'activ'

// „Ultimul răspuns” = cel cu `data` cea mai mare (fallback created_at); la egalitate / fără dată, ultimul din listă.
export function ultimulRaspuns(raspunsuri) {
  if (!Array.isArray(raspunsuri) || raspunsuri.length === 0) return null
  let best = null, bestT = -Infinity, bestI = -1
  raspunsuri.forEach((r, i) => {
    if (!r) return
    let t = ms(r.data)
    if (Number.isNaN(t)) t = ms(r.created_at)
    if (Number.isNaN(t)) t = -Infinity
    if (t > bestT || (t === bestT && i > bestI)) { best = r; bestT = t; bestI = i }
  })
  return best
}

// Există convocare activă cu retur și nicio convocare activă confirmată ULTERIOR returului
// (referința returului = retur_data, altfel data_expediere; fără nicio dată, orice confirmare activă contează ca ulterioară).
function convocareReturnataFaraConfirmareUlterioara(convocari) {
  const active = convocari.filter(convActiva)
  const returnate = active.filter(c => c.retur != null && c.retur !== '')
  if (returnate.length === 0) return false
  const confirmate = active.filter(c => c.data_confirmare_primire != null && c.data_confirmare_primire !== '')
  return returnate.some(r => {
    const ref = Number.isNaN(ms(r.retur_data)) ? ms(r.data_expediere) : ms(r.retur_data)
    return !confirmate.some(c => c !== r && (Number.isNaN(ref) || ms(c.data_confirmare_primire) >= ref))
  })
}

/**
 * calculeazaStare({ calitate, adresa_cunoscuta, convocari, raspunsuri, pvs }) → { stare, ordine }
 *  - convocari: rândurile red_convocari ale deținătorului (active = stare 'activ')
 *  - raspunsuri: rândurile red_raspunsuri ale deținătorului
 *  - pvs: PV-urile relevante — tip 'A' ale deținătorului, tip 'B' ale parcelei (active = stare ≠ 'anulat' și sters_la null)
 */
export function calculeazaStare({ calitate, adresa_cunoscuta, convocari = [], raspunsuri = [], pvs = [] } = {}) {
  const conv = Array.isArray(convocari) ? convocari : []
  const pv = (Array.isArray(pvs) ? pvs : []).filter(pvActiv)

  const rezultat = cod => ({ stare: cod, ordine: PE_COD[cod].ordine })

  // 1. PV A semnat
  if (pv.some(p => p.tip === 'A' && p.stare === 'semnat')) return rezultat('PV_A_SEMNAT')
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
