// Val 2, PR-B1: metrica de completitudine pe textele recitite (read-only, fără rețea, fără BD).
// deno run --allow-read scripts/recitire_val1/masoara_ancore.ts <texte.csv> [doc_id]
// texte.csv = ieșirea asambleaza.ts (document_id,text_b64). Fără doc_id: un rând TSV pe document; cu doc_id: golurile, cu contextul lor.
import { ancoreRand, masoara, tabele } from '../../supabase/functions/_shared/cantAcoperire.ts'

const [csv, doc] = Deno.args
if (!csv) { console.error('utilizare: masoara_ancore.ts <texte.csv> [doc_id]'); Deno.exit(2) }
const dec = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))
const randuri = (await Deno.readTextFile(csv)).split('\n').slice(1).filter((l) => l.trim()).map((l) => l.split(','))
if (!doc) console.log(['doc', 'caractere', 'ancore', 'cu_cod', 'perechi_cod_cant', 'tabele', 'tabele_cu_goluri', 'goluri', 'reluari_atipice'].join('\t'))
for (const [id, b64] of randuri) {
  const t = dec(b64)
  if (doc && id !== doc) continue
  if (!doc) {
    const m = masoara(t)
    console.log([id, t.length, m.ancore, m.ancore_cu_cod, m.perechi_distincte, m.tabele, m.tabele_cu_goluri, m.goluri, m.reluari_atipice].join('\t'))
    continue
  }
  for (const tb of tabele(ancoreRand(t)).tabele.filter((x) => x.goluri.length)) {
    console.log(`linia ${t.slice(0, tb.de_la).split('\n').length}: nr. ${tb.nr_min}-${tb.nr_max}, lipsă ${tb.goluri.join(', ')}`)
  }
}
