// Garda citirii (docs/INGEST_GARDA.md) pe partea de NAS: aceleași adaptoare ca edge-ul ofertare-ingest-doc.
// Containerul are tot repo-ul (git pull), deci se importă direct sursa comună — o singură implementare.
export { metaObiect, gardaIncearca, gardaRezultat } from '../../supabase/functions/_shared/gardaIngest.ts'
export { sha256Hex, dejaIngeratLaHash } from '../../supabase/functions/_shared/gardaIngestLogica.ts'
