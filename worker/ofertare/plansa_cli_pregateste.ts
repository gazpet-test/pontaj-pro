// deno run -A worker/ofertare/plansa_cli_pregateste.ts <doc_id> <dir_iesire>
import { INSTRUCTIUNI, INSTRUCTIUNI_LIPIRE } from '../../supabase/functions/ofertare-plansa-citeste/handler.ts'
import { citesteDoc, depsCliReale, descarca, listaFelii, perechiPosibile, sha256, verificaIdentitate, verificaManifest, verificaOwner, type DepsCli, type Manifest } from './plansa_cli_comun.ts'

export async function pregatestePlansa(docId: number, dir: string, d: DepsCli): Promise<Manifest> {
  await verificaOwner(d) // înainte de document, storage și orice fișier local
  const doc = await citesteDoc(d.supa, docId), p = doc.analiza?.plansa
  if (!p?.cale_felii || !p?.taiat_la || p.citibila === false) throw new Error('Planșa trebuie tăiată și citibilă')
  const nume = await listaFelii(d.supa, p.cale_felii)
  const m: Manifest = { doc_id: doc.id, licitatie_id: doc.licitatie_id, fisier_path: doc.fisier_path,
    taiat_la: p.taiat_la, cale_felii: p.cale_felii, felii: [], perechi_lipire: [], generat_la: new Date().toISOString() }
  const imagini = new Map<string, Uint8Array>()
  for (const n of nume) {
    const bytes = await descarca(d.supa, `${m.cale_felii}/${n}`), eticheta = n.slice(0, -4)
    imagini.set(n, bytes)
    m.felii.push({ eticheta, fisier: `felii/${n}`, sha256: await sha256(bytes) })
  }
  // Înaintea citirii nu știm ce note sunt tăiate: pregătim toate vecinătățile orizontale.
  // Handlerul importă numai perechile pe care le cere algoritmul lui existent.
  m.perechi_lipire = perechiPosibile(m.felii.map(f => f.eticheta))
  verificaManifest(m)
  verificaIdentitate(m, await citesteDoc(d.supa, docId))
  await Deno.mkdir(dir, { recursive: true })
  // Nu suprascriem un pachet anterior și nu lăsăm un manifest vechi lângă imagini noi.
  for await (const _ of Deno.readDir(dir)) throw new Error('Folderul de ieșire trebuie să fie gol')
  await Deno.mkdir(`${dir}/felii`)
  for (const [n, bytes] of imagini) await Deno.writeFile(`${dir}/felii/${n}`, bytes)
  await Deno.writeTextFile(`${dir}/INSTRUCTIUNI.md`, INSTRUCTIUNI + '\n')
  await Deno.writeTextFile(`${dir}/INSTRUCTIUNI_LIPIRE.md`, INSTRUCTIUNI_LIPIRE + '\n')
  // Manifestul ultimul: un export întrerupt nu este un pachet gata de citire.
  await Deno.writeTextFile(`${dir}/manifest.json`, JSON.stringify(m, null, 2) + '\n')
  return m
}

if (import.meta.main) {
  try {
    if (Deno.args.length !== 2) throw new Error('Folosire: plansa_cli_pregateste.ts <doc_id> <dir_iesire>')
    const m = await pregatestePlansa(Number(Deno.args[0]), Deno.args[1], depsCliReale())
    console.log(`Pregătit doc ${m.doc_id}: ${m.felii.length} felii, ${m.perechi_lipire.length} perechi`)
  } catch (e) { console.error((e as Error).message); Deno.exit(1) }
}
