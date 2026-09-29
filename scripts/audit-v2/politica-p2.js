// Catalog conservator independent de etichetele editabile din fixture.
export const EFECTE = ['none', 'db', 'storage', 'seap', 'email', 'webhook', 'cron', 'alta_licitatie']
const observatii = new Set(['05_acoperire/AI_neverificata', '06_cantitati/diferenta_blocheaza',
  '10_pachet/pachet_incomplet', '10_pachet/aprobare', '10_pachet/semnare_poarta',
  '10_pachet/AI_neverificata_blocheaza', '09_verificari/verdict_invalideaza'])
export function politicaFaza(pas, nume) {
  const key = `${pas}/${nume}`
  const safe_rerun = observatii.has(key) || pas === '12_comparatie'
  const external_effect = safe_rerun ? 'none' : pas === '16_restart_worker' ? 'cron'
    : pas === '01_seap_documente' || ['asamblare', 'upload_readback_hash', 'modificare_fisier_dupa_aprobare', 'cu_depus_final_si_dovada'].includes(nume) ? 'storage' : 'db'
  return { external_effect, safe_rerun,
    rerun_behavior: safe_rerun ? 'Recitește starea; zero scrieri permise.'
      : 'Poate crea versiuni, audit sau obiecte suplimentare; orice reluare după tentativa înregistrată cere --confirm-rerun.',
    // Allowlist de efecte COMISE, distinctă de tentativa HTTP respinsă.
    expected_tables: [], expected_storage: [],
  }
}
export function verificaPolitica(phase, args, incercari = 0) {
  if (!EFECTE.includes(phase.external_effect) || !['none', 'db', 'storage'].includes(phase.external_effect))
    throw new Error(`endpoint: --apply refuzat pentru external_effect=${phase.external_effect}`)
  if (typeof phase.safe_rerun !== 'boolean' || !phase.rerun_behavior) throw new Error('fixture: marker de idempotență incomplet')
  if (!phase.safe_rerun && incercari && !args.includes('--confirm-rerun')) throw new Error('stare: tentativa anterioară cere --confirm-rerun')
  if (!Array.isArray(phase.expected_tables) || !Array.isArray(phase.expected_storage)) throw new Error('fixture: lipsesc scrierile așteptate')
  if (phase.external_effect === 'none' && (phase.expected_tables.length || phase.expected_storage.length)
    || phase.external_effect === 'db' && phase.expected_storage.length) throw new Error('fixture: scrierile așteptate contrazic external_effect')
}
export const EXIT_CRITIC = { FALSE_GREEN: 20, BYPASS: 21, OUT_OF_SCOPE: 22, UI_SERVER_DIVERGENCE: 23 }
export function incident(tip, motiv) { return Object.assign(new Error(motiv), { tip, verdict: tip === 'FALSE_GREEN' ? tip : 'BYPASS', exitCode: EXIT_CRITIC[tip] }) }
export function oprireCritica(rezultat, observatii = []) {
  if (EXIT_CRITIC[rezultat.tip]) return rezultat.tip
  if (['FALSE_GREEN', 'BYPASS'].includes(rezultat.verdict)) return rezultat.verdict
  if (observatii.some(o => o.critic && !o.trece) && rezultat.verdict === 'MATCH') return 'UI_SERVER_DIVERGENCE'
  return null
}
