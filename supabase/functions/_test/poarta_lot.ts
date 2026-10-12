// Poarta pe loturi simulată peste un client fals (doar teste): fn_ofertare_eligibilitate / fn_ofertare_document_eligibil
// răspund din `motive` (document_id -> motiv; lipsă = 'comun', eligibil). Motivele eligibile sunt cele din SQL.
// `cade: true` = RPC-ul întoarce eroare (verifică fail-closed). Restul apelurilor rpc merg la clientul original.
const ELIGIBILE = ['fara_loturi', 'comun', 'lot_participam']

export function cuPoartaLot<T extends { rpc: (...a: any[]) => any }>(supa: T, docIds: number[],
  opt: { motive?: Record<number, string>; cade?: boolean } = {}) {
  const apeluri: { nume: string; args: any }[] = []
  const rpcVechi = supa.rpc.bind(supa)
  const motiv = (id: number) => opt.motive?.[id] ?? 'comun'
  const rpc = (nume: string, args?: any) => {
    if (nume === 'fn_ofertare_eligibilitate' || nume === 'fn_ofertare_document_eligibil') {
      apeluri.push({ nume, args })
      if (opt.cade) return Promise.resolve({ data: null, error: { message: 'cădere simulată' } })
      if (nume === 'fn_ofertare_document_eligibil') {
        const id = Number(args?.p_document_id)
        return Promise.resolve({ data: { eligibil: ELIGIBILE.includes(motiv(id)), motiv: motiv(id), licitatie_id: 1 }, error: null })
      }
      return Promise.resolve({ data: docIds.map((id) => ({ document_id: id, eligibil: ELIGIBILE.includes(motiv(id)), motiv: motiv(id) })), error: null })
    }
    return rpcVechi(nume, args)
  }
  return { supa: { ...supa, rpc } as T, apeluri }
}
