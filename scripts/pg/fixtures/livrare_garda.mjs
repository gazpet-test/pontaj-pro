// Garda de livrare (scripts/livrare_migrare.sh) reprodusă în harness-uri: marcajul gazpet.livrare_migrare = '<nume>:<txid>',
// pus în ACEEAȘI tranzacție chiar înaintea migrării (ca runner-ul), ca migrările cu gardă start/final să se poată testa local.
export const cuGarda = (fisier, sql) => {
  const nume = String(fisier).replace(/^.*\//, '').replace(/\.sql$/, '')
  return `SELECT set_config('gazpet.livrare_migrare', '${nume}:' || txid_current(), true);\n${sql}`
}
