// ═══════════════════════════════════════════════════════════════════════════
// verificariProiect.js — „ședința nu începe cu datele goale"
// Cerință Razvan 26.07.2026: la deschiderea unei ședințe pe proiect, sistemul
// verifică ce date NU sunt complete, le consemnează automat în raportul de
// ședință cu termen, iar ședința următoare începe cu verificarea lor.
//
// Măsurat pe 26.07.2026, din 20 de proiecte active: 20 fără garanție de bună
// execuție, 19 fără ordin de începere, 18 fără RTE/RTS/coordonator, 17 fără
// PCCVI. Nu din lene — nimeni n-avea un moment în care e obligat să se uite.
// Ședința devine acel moment.
// ═══════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase.js'

// Câmpurile urmărite, grupate ca în modalul de proiect (Execuție).
// `cheie` e stabilă — pe ea se face deduplicarea între ședințe.
export const VERIFICARI = [
  // Echipă proiect — responsabili execuție
  { cheie: 'lipsa:mp_employee_id', camp: 'mp_employee_id', grup: 'Echipă', eticheta: 'Manager proiect (MP) nealocat' },
  { cheie: 'lipsa:rte_employee_id', camp: 'rte_employee_id', grup: 'Echipă', eticheta: 'Responsabil tehnic execuție (RTE) nealocat' },
  { cheie: 'lipsa:rts_employee_id', camp: 'rts_employee_id', grup: 'Echipă', eticheta: 'Responsabil tehnic sudură (RTS) nealocat' },
  { cheie: 'lipsa:coordonator_transgaz', camp: 'coordonator_transgaz', grup: 'Echipă', eticheta: 'Coordonator Transgaz necompletat' },
  // Contract
  { cheie: 'lipsa:nr_contract', camp: 'nr_contract', grup: 'Contract', eticheta: 'Număr contract necompletat' },
  { cheie: 'lipsa:data_contract', camp: 'data_contract', grup: 'Contract', eticheta: 'Data semnării contractului necompletată' },
  { cheie: 'lipsa:valoare_lei', camp: 'valoare_lei', grup: 'Contract', eticheta: 'Valoarea contractului necompletată' },
  { cheie: 'lipsa:garantie_buna_exec_pct', camp: 'garantie_buna_exec_pct', grup: 'Contract', eticheta: 'Garanția de bună execuție (%) necompletată' },
  { cheie: 'lipsa:penalitati_zi_pct', camp: 'penalitati_zi_pct', grup: 'Contract', eticheta: 'Penalități/zi (%) necompletate' },
  // Termene
  { cheie: 'lipsa:data_start', camp: 'data_start', grup: 'Termene', eticheta: 'Ordin de începere — data necompletată' },
  { cheie: 'lipsa:data_termen', camp: 'data_termen', grup: 'Termene', eticheta: 'Termen de finalizare necompletat' },
  { cheie: 'lipsa:doc_ordin_incepere_path', camp: 'doc_ordin_incepere_path', grup: 'Termene', eticheta: 'Ordinul de începere (PDF) neatașat' },
  // Documente de contract
  { cheie: 'lipsa:doc_caiet_sarcini_path', camp: 'doc_caiet_sarcini_path', grup: 'Documente', eticheta: 'Caiet de sarcini neatașat' },
  { cheie: 'lipsa:doc_propunere_tehnica_path', camp: 'doc_propunere_tehnica_path', grup: 'Documente', eticheta: 'Propunere tehnică neatașată' },
  { cheie: 'lipsa:doc_propunere_financiara_path', camp: 'doc_propunere_financiara_path', grup: 'Documente', eticheta: 'Propunere financiară neatașată' },
  { cheie: 'lipsa:doc_itp_pccvi_path', camp: 'doc_itp_pccvi_path', grup: 'Documente', eticheta: 'PCCVI / ITP neatașat' },
]

const gol = (v) => v === null || v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v))

// ── Termenul EFECTIV: actele adiționale pot muta termenul contractului ──
// (pe Ștefan cel Mare, actul 1/2025 mutase termenul; a arăta data inițială ar
// speria degeaba). Sursele: contracte_acte_aditionale.data_termen_noua prin
// v_contract_efecte_acte, sau prelungirile din executie_acte_aditionale.
async function termenEfectiv(proiect) {
  let termen = proiect.data_termen || null
  let sursa = termen ? 'contract' : null
  if (proiect.contract_id) {
    const { data: ef } = await supabase.from('v_contract_efecte_acte')
      .select('termen_nou_din_acte, prelungire_luni_exec')
      .eq('contract_id', proiect.contract_id).maybeSingle()
    if (ef?.termen_nou_din_acte) { termen = ef.termen_nou_din_acte; sursa = 'act adițional' }
    else if (ef?.prelungire_luni_exec > 0 && termen) {
      const d = new Date(termen); d.setMonth(d.getMonth() + ef.prelungire_luni_exec)
      termen = d.toISOString().slice(0, 10); sursa = `+${ef.prelungire_luni_exec} luni din acte`
    }
  }
  return { termen, sursa }
}

// ── Stadiul fizic: cât s-a raportat față de cantitățile de contract ──
// Timpul singur nu spune nimic; „70% din timp consumat, 20% executat" spune tot.
async function stadiuFizic(proiectId) {
  const [{ data: acts }, { data: rl }, { data: art }] = await Promise.all([
    supabase.from('proiect_activitati').select('id, coduri_deviz').eq('proiect_id', proiectId).eq('activ', true),
    supabase.from('raport_lucrari').select('activitate_id, cantitate').eq('proiect_id', proiectId),
    supabase.from('proiect_articole').select('cod, cantitate, sursa').eq('proiect_id', proiectId).neq('sursa', 'extras_materiale'),
  ])
  if (!acts?.length) return null
  const realizat = {}
  for (const r of (rl || [])) if (r.activitate_id) realizat[r.activitate_id] = (realizat[r.activitate_id] || 0) + (Number(r.cantitate) || 0)
  let cuContract = 0, sumaPct = 0
  for (const a of acts) {
    const prefixe = (a.coduri_deviz || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
    if (!prefixe.length) continue
    const q = (art || []).filter(x => prefixe.some(p => (x.cod || '').toUpperCase().startsWith(p)))
      .reduce((s, x) => s + (Number(x.cantitate) || 0), 0)
    if (q <= 0) continue
    cuContract++
    sumaPct += Math.min(100, (realizat[a.id] || 0) / q * 100)
  }
  if (!cuContract) return null
  return { pct: sumaPct / cuContract, activitatiMasurate: cuContract, activitatiTotal: acts.length }
}

// ── Verificarea completă a unui proiect ──
export async function verificaProiect(proiectId) {
  const { data: p } = await supabase.from('executie_proiecte').select('*').eq('id', proiectId).maybeSingle()
  if (!p) return null

  const lipsuri = VERIFICARI.filter(v => gol(p[v.camp]))
  const { termen, sursa } = await termenEfectiv(p)
  const stadiu = await stadiuFizic(proiectId)

  let zileRamase = null, pctTimp = null
  if (termen) {
    const azi = new Date(new Date().toISOString().slice(0, 10))
    zileRamase = Math.round((new Date(termen) - azi) / 86400000)
    if (p.data_start) {
      const total = Math.round((new Date(termen) - new Date(p.data_start)) / 86400000)
      const scurs = Math.round((azi - new Date(p.data_start)) / 86400000)
      if (total > 0) pctTimp = Math.max(0, Math.min(100, scurs / total * 100))
    }
  }

  // Semnalul care contează la o ședință de progres: timp consumat vs. lucrare făcută
  let risc = null
  if (pctTimp != null && stadiu) {
    const decalaj = pctTimp - stadiu.pct
    risc = decalaj > 25 ? 'critic' : decalaj > 10 ? 'atentie' : 'ok'
  }

  return {
    proiect: p, lipsuri, termen, termenSursa: sursa, zileRamase, pctTimp,
    stadiu, risc,
    decalaj: (pctTimp != null && stadiu) ? pctTimp - stadiu.pct : null,
  }
}

// ── Consemnarea lipsurilor ca linii de ședință ──
// Dedup: dacă aceeași lipsă e deja deschisă (purtată din ședințele anterioare),
// NU o mai adăugăm — altfel după 5 ședințe avem 5× „lipsește RTE".
export async function consemneazaLipsuri(sedintaId, proiectId, { termenZile = 7, ordineStart = 0 } = {}) {
  const v = await verificaProiect(proiectId)
  if (!v || !v.lipsuri.length) return { adaugate: 0, existente: 0 }

  const { data: exist } = await supabase.from('sedinte_linii')
    .select('cheie_verificare').eq('sedinta_id', sedintaId).not('cheie_verificare', 'is', null)
  const deja = new Set((exist || []).map(x => x.cheie_verificare))

  const noi = v.lipsuri.filter(l => !deja.has(l.cheie))
  if (!noi.length) return { adaugate: 0, existente: deja.size }

  const t = new Date(); t.setDate(t.getDate() + termenZile)
  const rows = noi.map((l, i) => ({
    sedinta_id: sedintaId, ordine: ordineStart + i, tip: 'actiune',
    text: `[date proiect] ${l.eticheta}`,
    termen: t.toISOString().slice(0, 10),
    status: 'deschis', cheie_verificare: l.cheie, auto_generata: true,
  }))
  const { error } = await supabase.from('sedinte_linii').insert(rows)
  if (error) throw error
  return { adaugate: rows.length, existente: deja.size }
}
