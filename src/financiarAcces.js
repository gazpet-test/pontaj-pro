// Drepturi pe modulul Financiar (01.10.2026, varianta A — Răzvan):
// sub-modulul 'financiar.garantii' din user_module_access = „poate emite garanții”:
// vede și editează DOAR tab-urile de garanții (GBE + Registru). Facturile/contabilitatea rămân pe rolul vechi.
export const SUB_GARANTII = 'financiar.garantii'
export const TABURI_GARANTII = ['gbe', 'garantii']
export const TABURI_TOATE = ['emise', 'furnizori', 'consumuri', 'contab', 'gbe', 'garantii']

export function accesFinanciar(profile, module = []) {
  const isOwner = profile?.is_owner === true
  const canWrite = isOwner || ['superadmin', 'contabilitate'].includes(profile?.role)
  const ma = module || []
  const areGarantii = ma.includes(SUB_GARANTII)
  // acces complet: owner, rol financiar, cheia întreagă 'financiar' sau alt sub-modul decât garanții
  const complet = isOwner || canWrite || ma.some(m => m === 'financiar' || (m.startsWith('financiar.') && m !== SUB_GARANTII))
  const doarGarantii = !complet && areGarantii
  return {
    canWrite,                                   // facturi, contabilitate — neschimbat
    canWriteGarantii: canWrite || areGarantii,  // tab-urile de garanții
    doarGarantii,
    taburi: doarGarantii ? TABURI_GARANTII : TABURI_TOATE,
  }
}

// Cine poate crea garanția de participare din licitație (Ofertare → 🛡 Garanție): owner sau sub-modulul.
export const poateCreaGarantie = (profile, module = []) =>
  profile?.is_owner === true || (module || []).includes(SUB_GARANTII)

// Starea garanției din Registru, așa cum apare în Ofertare: cerută / emisă / depusă / eliberată
export function stareGarantieOfertare(g) {
  if (!g) return null
  if (g.stare === 'eliberata') return 'eliberată'
  if (g.stare === 'executata' || g.stare === 'expirata') return g.stare === 'executata' ? 'executată' : 'expirată'
  if (g.data_emitere && g.numar_document) return 'depusă'
  if (g.data_emitere || g.numar_document) return 'emisă'
  return 'cerută'
}
