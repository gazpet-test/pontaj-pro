// Ultimele versiuni ale documentelor unei licitații: un document pe care altul îl înlocuiește (seap_meta.inlocuieste_id) nu se mai extrage.
// Funcție pură, O SINGURĂ definiție (L19): folosită de extrageStructurat (ce se extrage) și de eligibilitatea comparației (ce poate fi „necitit”).
// (mutată din structurat.ts la PR-extragere TKT-0329 A, ca masuratori.ts s-o folosească fără import circular)
export function ultimeleVersiuni<T extends { id: number; seap_meta: any }>(docs: T[]): T[] {
  const inlocuite = new Set(docs.map((d) => Number(d?.seap_meta?.inlocuieste_id)).filter((x) => Number.isFinite(x) && x > 0))
  return docs.filter((d) => !inlocuite.has(d.id))
}
