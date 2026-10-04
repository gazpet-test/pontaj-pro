// 04.10.2026 J8: rezervăm perechile în ordinea distanței, nu în ordinea rândurilor BD.
export function matchWhatsAppUnic(alimentari, mesaje) {
  const perechi = []
  for (const alim of alimentari) for (const msg of mesaje) {
    if (!msg.parsed?.site || !msg.parsed?.vehicle || msg.parsed.vehicle.id !== alim.active_id) continue
    const diffH = Math.abs((new Date(msg.dt) - new Date(alim.data_alimentare)) / 3600000)
    if (diffH <= 96) perechi.push({ alim, msg, diffH })
  }
  perechi.sort((a, b) => a.diffH - b.diffH || String(a.alim.id).localeCompare(String(b.alim.id)))
  const folosite = new Set(), hashuri = new Set()
  return perechi.filter(({ alim, msg }) => {
    const key = msg.hash || msg
    if (folosite.has(alim.id) || hashuri.has(key)) return false
    folosite.add(alim.id); hashuri.add(key)
    return true
  }).map(p => ({ ...p, site: p.msg.parsed.site,
    confidence: p.msg.parsed.score >= 0.9 ? 'high' : 'medium',
    autoConfirm: p.msg.parsed.formatStrict && p.msg.parsed.score >= 0.95,
  }))
}

// 04.10.2026 J10: nu mascăm Oscar drept Rompetrol.
export const sursaBonComunValida = sursa => !sursa || ['rompetrol', 'benzinarie'].includes(sursa)

// 04.10.2026 J11: contradicția exclude bonul; lipsa identității cere confirmare.
export function identitateBonComun(bon, activId, card) {
  const ids = bon.active_ids || []
  if (activId != null && ids.length && !ids.includes(activId)) return 'exclus'
  const normal = v => String(v || '').replace(/\s+/g, '').toUpperCase()
  if (card && bon.card_combustibil && normal(card) !== normal(bon.card_combustibil)) return 'exclus'
  return (activId != null && ids.includes(activId)) || (card && bon.card_combustibil) ? 'verificat' : 'confirmare'
}

// 04.10.2026 J18: un singur câmp autoritar; revenim cu același obiect dacă nu se schimbă nimic.
export function recalculeazaPret(form, lastEdited, pretBaza) {
  const litri = Number(form.cantitate_litri)
  if (!(litri > 0)) return form
  let pret = form.pret_per_litru, total = form.pret_total
  if (lastEdited === 'total') pret = total === '' ? '' : (Number(total) / litri).toFixed(4)
  else if (lastEdited === 'pret') total = pret === '' ? '' : (Number(pret) * litri).toFixed(2)
  else if (pretBaza) { pret = Number(pretBaza).toFixed(4); total = (litri * Number(pretBaza)).toFixed(2) }
  return pret === form.pret_per_litru && total === form.pret_total ? form : { ...form, pret_per_litru: pret, pret_total: total }
}

// 04.10.2026 Nit: protecția concurenței nu este eroare de upload.
export const rezultatPoza = result => result.ok ? 'uploaded' : result.reason === 'stare_schimbata' ? 'skipped' : 'errors'

// 04.10.2026 J14: compensare locala; atomicitatea necesita ulterior un RPC separat.
export async function salveazaIntrariService(db, fisaId, intrari) {
  try {
    const { error } = await db.from('logistica_service_intrari').insert(intrari)
    if (error) throw error
  } catch (error) {
    try {
      const { data, error: rollbackError } = await db.from('logistica_service_fise')
        .delete().eq('id', fisaId).select('id')
      if (rollbackError) throw rollbackError
      if (!data?.length) throw new Error('niciun rand sters')
    } catch (rollbackError) {
      throw new Error(`Intrari nesalvate: ${error.message}. Fisa #${fisaId} a ramas incompleta; nu relua crearea, verifica aceasta fisa. Compensare esuata: ${rollbackError.message}`)
    }
    throw new Error(`Intrari nesalvate: ${error.message}. Fisa noua a fost stearsa; poti reincerca.`)
  }
}
