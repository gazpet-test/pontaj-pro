// deno run -A worker/ofertare/plansa_cli_importa.ts <fisier_plansa_felii.json> <dir_pregatire>
import { handler, INSTRUCTIUNI, INSTRUCTIUNI_LIPIRE } from '../../supabase/functions/ofertare-plansa-citeste/handler.ts'
import { citesteDoc, depsCliReale, descarca, listaFelii, MODEL_CLI, sha256, verificaIdentitate, verificaManifest, verificaOwner, type DepsCli, type Manifest, type RezultatCli } from './plansa_cli_comun.ts'

export function verificaRezultat(m: Manifest, r: RezultatCli) {
  verificaManifest(m)
  if (!r || r.doc_id !== m.doc_id || r.taiat_la !== m.taiat_la) throw new Error('doc_id / taiat_la din CLI diferă de manifest')
  if (!r.felii || Array.isArray(r.felii) || typeof r.felii !== 'object' || !r.lipiri || Array.isArray(r.lipiri) || typeof r.lipiri !== 'object')
    throw new Error('Ieșire CLI invalidă: felii / lipiri')
  const felii = new Map(m.felii.map(f => [f.eticheta, f]))
  for (const [et, f] of Object.entries(r.felii)) {
    if (!felii.has(et) || !f || f.sha256 !== felii.get(et)!.sha256) throw new Error(`SHA256 diferit de manifest: ${et}`)
    if (typeof f.text !== 'string') throw new Error(`Text CLI invalid: ${et}`)
  }
  const perechi = new Set(m.perechi_lipire.map(p => p.join('+')))
  for (const [et, p] of Object.entries(r.lipiri)) {
    if (!perechi.has(et) || !p || typeof p.text !== 'string') throw new Error(`Lipire CLI invalidă: ${et}`)
    // Lipirea legacy nu păstrează eroarea JSON ca reluabilă. O respingem înainte de scrieri.
    try {
      const json = p.text.match(/\{[\s\S]*\}/)?.[0]
      if (!json || !Array.isArray(JSON.parse(json).randuri)) throw new Error('randuri lipsă')
    } catch { throw new Error(`Lipire CLI cu JSON invalid: ${et}`) }
  }
  // Feliile absente sunt intenționat permise: handlerul le păstrează ca erori reluabile.
}

// Adaptor strict în memorie: niciun fallback la fetch global, nici măcar pentru imagini URL.
export function fetchDinCli(m: Manifest, r: RezultatCli): typeof fetch {
  verificaRezultat(m, r)
  const felii = new Map(m.felii.map(f => [f.eticheta, f]))
  const lipsa = () => Response.json({ error: { message: 'Răspuns CLI negăsit pentru imaginea/perechea cerută (SHA256 / etichetă)' } }, { status: 422 })
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.href !== 'https://api.anthropic.com/v1/messages') throw new Error('fetchDinCli: URL nepermis; rețeaua este interzisă')
    const req = new Request(input, init)
    if (req.method !== 'POST') throw new Error('fetchDinCli: doar POST Messages')
    const body = await req.json()
    const content = (body.messages || []).flatMap((x: any) => Array.isArray(x.content) ? x.content : [])
    const imagini = content.filter((x: any) => x.type === 'image')
    if (!imagini.length || imagini.length > 2) return lipsa()
    const hashuri: string[] = []
    for (const img of imagini) {
      if (img.source?.type !== 'base64' || img.source?.media_type !== 'image/jpeg' || typeof img.source?.data !== 'string') return lipsa()
      try { hashuri.push(await sha256(Uint8Array.from(atob(img.source.data), c => c.charCodeAt(0)))) } catch { return lipsa() }
    }
    const texte = content.filter((x: any) => x.type === 'text').map((x: any) => String(x.text))
    let raspuns: string | undefined
    if (hashuri.length === 1) {
      const et = texte.map((t: string) => /^Bucata (\S+) din plansa\./.exec(t)?.[1]).find(Boolean)
      const candidati = m.felii.filter(f => f.sha256 === hashuri[0] && (!et || f.eticheta === et))
      // Două JPEG identice pot avea răspunsuri diferite; fără etichetă nu alegem arbitrar.
      if (candidati.length === 1) raspuns = r.felii[candidati[0].eticheta]?.text
    } else {
      const et = texte.map((t: string) => /^Perechea (\S+)\. Reconstituie/.exec(t)?.[1]).find(Boolean)
      const candidati = m.perechi_lipire.filter(([a, b]) => felii.get(a)?.sha256 === hashuri[0] && felii.get(b)?.sha256 === hashuri[1] && (!et || `${a}+${b}` === et))
      if (candidati.length === 1) raspuns = r.lipiri[candidati[0].join('+')]?.text
    }
    if (!raspuns) return lipsa()
    return Response.json({ content: [{ type: 'text', text: raspuns }], usage: { input_tokens: 0, output_tokens: 0 }, stop_reason: 'end_turn' })
  }) as typeof fetch
}

export async function importaPlansa(fisier: string, dir: string, d: DepsCli) {
  await verificaOwner(d)
  if (!d.SERVICE) throw new Error('SERVICE lipsește')
  const m: Manifest = JSON.parse(await Deno.readTextFile(`${dir}/manifest.json`))
  const r: RezultatCli = JSON.parse(await Deno.readTextFile(fisier))
  verificaRezultat(m, r)
  let doc = await citesteDoc(d.supa, m.doc_id)
  verificaIdentitate(m, doc)
  // Un pachet vechi nu poate fi etichetat cu promptul versiunii actuale a handlerului.
  for (const [n, prompt] of [['INSTRUCTIUNI.md', INSTRUCTIUNI], ['INSTRUCTIUNI_LIPIRE.md', INSTRUCTIUNI_LIPIRE]])
    if ((await Deno.readTextFile(`${dir}/${n}`)).trim() !== prompt.trim()) throw new Error(`Prompt schimbat: ${n}; refă pregătirea și citirea`)
  const nume = await listaFelii(d.supa, m.cale_felii)
  if (JSON.stringify(nume) !== JSON.stringify(m.felii.map(f => `${f.eticheta}.jpg`).sort((a, b) => a.localeCompare(b))))
    throw new Error('Lista curentă din Storage diferă de manifest')
  const imagini = new Map<string, Uint8Array>()
  for (const f of m.felii) {
    const local = await Deno.readFile(`${dir}/${f.fisier}`)
    if (await sha256(local) !== f.sha256) throw new Error(`SHA256 local diferit de manifest: ${f.eticheta}`)
    const bytes = await descarca(d.supa, `${m.cale_felii}/${f.eticheta}.jpg`)
    if (await sha256(bytes) !== f.sha256) throw new Error(`SHA256 Storage diferit de manifest: ${f.eticheta}`)
    imagini.set(`${m.cale_felii}/${f.eticheta}.jpg`, bytes)
  }
  doc = await citesteDoc(d.supa, m.doc_id)
  verificaIdentitate(m, doc) // exportul poate fi retăiat în timpul verificărilor

  // Handlerul primește exact JPEG-urile verificate, fără un al doilea download după prima scriere.
  // DB/CAS rămân cele reale. Nicio coadă și nicio rezervare în bugetul API.
  const supa = {
    from: d.supa.from.bind(d.supa),
    rpc: (name: string, args: any) => {
      if (name === 'ofertare_plansa_analiza_cas') {
        const prev = args.p_analiza_veche?.citire_ai
        // Lipirea din handler nu are poartă de versiune. O citire API apărută concurent
        // nu trebuie să primească note CLI nici la rezervare, nici la reîncercarea CAS.
        if (prev?.taiat_la === m.taiat_la && (prev.model !== MODEL_CLI || prev.versiune?.model !== MODEL_CLI))
          return Promise.resolve({ data: null, error: { message: 'Versiune incompatibilă: citire API; import CLI oprit' } })
      }
      return d.supa.rpc(name, args)
    },
    storage: { from: (bucket: string) => {
      if (bucket !== 'ofertare') throw new Error('Bucket nepermis')
      return {
        list: (cale: string) => {
          if (cale !== m.cale_felii) throw new Error('Cale de felii schimbată')
          return Promise.resolve({ data: nume.map(name => ({ name })), error: null })
        },
        download: (cale: string) => {
          const bytes = imagini.get(cale)
          return Promise.resolve(bytes ? { data: new Blob([new Uint8Array(bytes)]), error: null } : { data: null, error: { message: 'Felie absentă din manifest' } })
        },
      }
    } },
  }
  const deps = { SERVICE: d.SERVICE, API_KEY: 'cli-abonament', modelEticheta: MODEL_CLI, supa,
    getUser: async () => null, fetch: fetchDinCli(m, r) }
  const asteptat = { licitatie_id: m.licitatie_id, fisier_path: m.fisier_path, taiat_la: m.taiat_la, cale_felii: m.cale_felii }
  const runde: any[] = []
  const apel = async (corp: any) => {
    const proaspat = await citesteDoc(d.supa, m.doc_id)
    verificaIdentitate(m, proaspat)
    const res = await handler(new Request('http://worker.local/plansa-cli', { method: 'POST',
      headers: { Authorization: `Bearer ${d.SERVICE}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ doc_id: m.doc_id, asteptat, ...corp }) }), deps)
    const out = await res.json()
    if (!res.ok) throw new Error(`Import oprit (HTTP ${res.status}): ${out.error || 'eroare handler'}`)
    runde.push(out)
    return out
  }
  const exista = doc.analiza?.citire_ai?.taiat_la === m.taiat_la
  let out = await apel(exista ? { mod: 'continua' } : { de_la: 0 })
  let pas = 0
  while (out.continua === true) {
    if (++pas > m.felii.length || !out.citite_acum) throw new Error('Import fără progres; reia manual')
    out = await apel({ mod: 'continua' })
  }
  // O nouă comandă manuală poate aduce răspunsuri pentru zone căzute în importul anterior.
  if (exista && out.zone_cazute?.length) {
    let sari: string[] = []
    do {
      out = await apel({ mod: 'reia_erori', sari })
      sari = out.reincercate || sari
      if (++pas > 2 * m.felii.length + 1) throw new Error('Reluare fără progres; reia manual')
    } while (out.continua === true)
  }
  if (out.lipire_necesara) {
    // Handlerul vechi marchează și lipirile fără text drept făcute. Nu-l chemăm cu
    // un pachet de lipiri incomplet; feliile deja importate rămân disponibile.
    const lipsesc = m.perechi_lipire.filter(p => !r.lipiri[p.join('+')]?.text)
    if (lipsesc.length) throw new Error(`Feliile sunt importate; lipsesc ${lipsesc.length} răspunsuri de lipire CLI. Completează pachetul și reia manual.`)
    let ramase = m.perechi_lipire.length + 1
    do {
      out = await apel({ doar_lipire: true })
      if (out.perechi_ramase && out.perechi_ramase >= ramase) throw new Error('Lipire fără progres; reia manual')
      ramase = out.perechi_ramase || 0
    } while (ramase)
  }
  return { doc_id: m.doc_id, model: MODEL_CLI, cost_usd: 0, runde }
}

if (import.meta.main) {
  try {
    if (Deno.args.length !== 2) throw new Error('Folosire: plansa_cli_importa.ts <fisier_plansa_felii.json> <dir_pregatire>')
    const out = await importaPlansa(Deno.args[0], Deno.args[1], depsCliReale())
    console.log(JSON.stringify(out, null, 2))
  } catch (e) { console.error((e as Error).message); Deno.exit(1) }
}
