// Val 2, PR-B1: inventarul de rânduri pe textele recitite (read-only, fără rețea, fără BD).
// deno run --allow-read scripts/recitire_val1/masoara_ancore.ts <texte.csv> [doc_id]
// texte.csv = ieșirea asambleaza.ts (document_id,text_b64). Se numără DOAR secțiunile F3 / C6 (sectiuni.ts), ca extractorul pe felii:
// F1 / F2 / C7 / C8 / C9 (lista_alt) au numerotare de referință, nu de poziții, și nu intră în poarta de completitudine.
// Fără doc_id: un rând TSV pe document; cu doc_id: golurile și rândurile incerte, cu linia lor în textul original.
import { inventarRanduri, type RandInventar, tabele, type Tabel } from '../../supabase/functions/_shared/cantAcoperire.ts'
import { sectiuniLista } from '../../supabase/functions/ofertare-cantitati-extrage/sectiuni.ts'

const [csv, doc] = Deno.args
if (!csv) { console.error('utilizare: masoara_ancore.ts <texte.csv> [doc_id]'); Deno.exit(2) }
const dec = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))
const randuri = (await Deno.readTextFile(csv)).split('\n').slice(1).filter((l) => l.trim()).map((l) => l.split(','))
if (!doc) console.log(['doc', 'caractere', 'sectiuni_f3c6', 'randuri', 'ancore', 'incerte', 'perechi_cod_cant', 'tabele', 'tabele_cu_goluri', 'goluri', 'reluari_atipice', 'tabele_nedeterminate'].join('\t'))
for (const [id, b64] of randuri) {
  const t = dec(b64)
  if (doc && id !== doc) continue
  const sec = sectiuniLista(t).filter((s) => s.tip === 'lista_f3' || s.tip === 'lista_c6')
  const inv: RandInventar[] = [], tb: Tabel[] = []
  for (const s of sec) {
    const r = inventarRanduri(t.slice(s.de, s.pana)).map((x) => ({ ...x, offset: x.offset + s.de }))
    inv.push(...r)
    tb.push(...tabele(r))
  }
  const linia = (off: number) => t.slice(0, off).split('\n').length
  if (!doc) {
    const anc = inv.filter((x) => x.stare === 'ancora')
    const perechi = new Set(anc.filter((x) => x.cod).map((x) => `${x.cod}|${x.cantitate}|${x.um}`)).size
    console.log([id, t.length, sec.length, inv.length, anc.length, inv.length - anc.length, perechi, tb.length,
      tb.filter((x) => x.goluri.length || x.goluri_ierarhice.length).length, tb.reduce((s, x) => s + x.goluri.length + x.goluri_ierarhice.length, 0), tb.reduce((s, x) => s + x.reluari_atipice, 0),
      tb.filter((x) => x.secventa_nedeterminata).length].join('\t'))
    continue
  }
  for (const x of tb.filter((x) => x.goluri.length || x.goluri_ierarhice.length)) {
    console.log(`gol — linia ${linia(x.de_la)}: nr. ${x.nr_min}-${x.nr_max}, lipsă ${[...x.goluri, ...x.goluri_ierarhice].join(', ')}`)
  }
  for (const r of inv.filter((x) => x.stare === 'incert').slice(0, 30)) console.log(`incert — linia ${linia(r.offset)} nr ${r.nr}: ${r.motiv}`)
}
