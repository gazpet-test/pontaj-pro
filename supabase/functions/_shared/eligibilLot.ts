// Poarta unică pe loturi (migrarea 20261024b): orice procesare plătită a unui document din Ofertare (citire AI, OCR,
// cerințe, cantități, planșe, răspunsuri, generare) întreabă ÎNTÂI baza dacă documentul e eligibil.
// Logica stă DOAR în SQL (fn_ofertare_eligibilitate); aici e doar apelul + fail-closed:
// orice eroare / răspuns neașteptat = NEELIGIBIL (nu se cheltuie pe un document netriat).
// Motive eligibile: bootstrap_fisa_date, fara_loturi, comun, lot_participam.
// Motive neeligibile: loturi_neinitializate, nicio_participare, de_triat, in_afara_loturilor, stare_invalida,
// document_inexistent, eroare_poarta (local, când RPC-ul pică).

export type Eligibilitate = { eligibil: boolean; motiv: string; licitatie_id: number | null }

type ClientRpc = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>
}

const MESAJ: Record<string, string> = {
  loturi_neinitializate: 'loturile licitației nu sunt setate (alege „fără loturi” sau definește loturile)',
  nicio_participare: 'nu e bifat niciun lot la care participăm',
  de_triat: 'documentul nu e triat pe lot (comun / lot)',
  in_afara_loturilor: 'documentul e doar pe loturi la care nu participăm',
  stare_invalida: 'stare de lot invalidă',
  document_inexistent: 'document inexistent',
  eroare_poarta: 'verificarea pe loturi nu a răspuns',
}

export function mesajLot(motiv: string): string {
  return 'Blocat pe loturi: ' + (MESAJ[motiv] || motiv)
}

export async function documentEligibil(db: ClientRpc, documentId: number): Promise<Eligibilitate> {
  try {
    const { data, error } = await db.rpc('fn_ofertare_document_eligibil', { p_document_id: documentId })
    const d = data as Partial<Eligibilitate> | null
    if (error || !d || typeof d.eligibil !== 'boolean' || typeof d.motiv !== 'string') {
      return { eligibil: false, motiv: 'eroare_poarta', licitatie_id: null }
    }
    return { eligibil: d.eligibil === true, motiv: d.motiv, licitatie_id: d.licitatie_id ?? null }
  } catch (_) {
    return { eligibil: false, motiv: 'eroare_poarta', licitatie_id: null }
  }
}

// Pentru liste (worker / extrageri pe toată licitația): Map document_id -> Eligibilitate.
// Documentele lipsă din răspuns sunt NEELIGIBILE (fail-closed); eroarea RPC = map gol + ok:false.
export async function eligibilitateLicitatie(db: ClientRpc, licitatieId: number):
  Promise<{ ok: boolean; harta: Map<number, Eligibilitate> }> {
  const harta = new Map<number, Eligibilitate>()
  try {
    const { data, error } = await db.rpc('fn_ofertare_eligibilitate', { p_licitatie_id: licitatieId })
    if (error || !Array.isArray(data)) return { ok: false, harta }
    for (const r of data as Array<{ document_id: number; eligibil: boolean; motiv: string }>) {
      if (typeof r?.document_id !== 'number') continue
      harta.set(Number(r.document_id), { eligibil: r.eligibil === true, motiv: String(r.motiv), licitatie_id: licitatieId })
    }
    return { ok: true, harta }
  } catch (_) {
    return { ok: false, harta }
  }
}

export function esteEligibil(harta: Map<number, Eligibilitate>, documentId: number): boolean {
  return harta.get(Number(documentId))?.eligibil === true
}
