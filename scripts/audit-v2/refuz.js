// HTTP respins + toast așteptat + read-back neschimbat: nicio piesă singură nu ajunge.
export function verificaRefuzServer(cerut, jurnal) {
  return jurnal.some(r => {
    try {
      const u = new URL(r.url)
      return r.metoda === cerut.metoda && r.status === cerut.status
        && u.pathname === `/rest/v1/${cerut.tabela}`
        && u.searchParams.get('id') === `eq.${cerut.id}`
        && r.durata_ms != null
    } catch { return false }
  })
}
