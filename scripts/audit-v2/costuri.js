// Catalog conservator: o fază care poate porni un model cere GO separat.
const ai = new Set([
  '02_citire/citire_integrala', '02_citire/recitire_idempotenta',
  '03_cerinte/extragere', '03_cerinte/reextragere_pastreaza_corectie', '03_cerinte/trunchiere_semnalata',
  '04_clarificari/aplica_D1', '04_clarificari/clarificare_dupa_PT',
  '05_acoperire/motor', '05_acoperire/retry_pastreaza_alegerea',
  '06_cantitati/revizie_F3', '07_grafic/generare_PT', '08_pt/generare',
  '09_verificari/verificare_finala', '16_restart_worker/porneste_citire',
  '16_restart_worker/dupa_restart', '16_restart_worker/retry_idempotent',
])
export function costFaza(pas, faza) {
  const cost_ai = ai.has(`${pas}/${faza}`)
  return { cost_ai, estimare_ai: cost_ai
    ? { usd: null, motiv: 'Necunoscut fără volum, model și tokeni; preview nu apelează AI. GO de buget separat.' }
    : { usd: 0 } }
}
export function selecteazaFaze(contract, cfg, args) {
  const index = args.indexOf('--faza')
  const ceruta = index < 0 ? null : args[index + 1]
  if (index >= 0 && !contract.faze.includes(ceruta)) throw new Error('Fază invalidă')
  const nume = ceruta ? [ceruta] : contract.faze
  return {
    selectate: nume.filter(n => cfg.faze[n]?.cost_ai === false || args.includes('--allow-ai') && cfg.faze[n]?.cost_ai === true),
    amanate_ai: nume.filter(n => cfg.faze[n]?.cost_ai !== false && !args.includes('--allow-ai')),
  }
}
