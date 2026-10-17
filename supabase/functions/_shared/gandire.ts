// „Fără gândire” pe model (17.10.2026, trecerea Sonnet 5 → Sonnet 5.5). Sursa: skill-ul claude-api, Migrating to Claude Sonnet 5.5.
// Sonnet 5.5 dă 400 pe thinking {type:'disabled'}; cea mai joasă setare acolo e {type:'between_tools'} (fără gândire extinsă, doar note
// scurte între apeluri de unelte — aici nu avem unelte). between_tools: DOAR pe Sonnet 5.5, la effort high sau mai jos (implicit high —
// nu trimitem effort), fără alt câmp în `thinking`; orice alt model îl respinge cu 400. Haiku 5.5 / Sonnet 5 / Opus 5 rămân pe 'disabled'.
// Un apel care retrimite același corp altui model (cascadă, reîncercare) cere configurația PE MODEL — de aceea funcție, nu constantă.
export const SONNET_55 = 'claude-sonnet-5-5'
export const faraGandire = (model: string): { type: 'between_tools' } | { type: 'disabled' } =>
  model === SONNET_55 ? { type: 'between_tools' } : { type: 'disabled' }
