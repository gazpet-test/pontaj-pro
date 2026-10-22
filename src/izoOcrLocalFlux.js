// E9 B4: numai transport și stări; aplicarea/salvarea rămân acțiuni umane.
export const TIMPI_OCR_LOCAL = Object.freeze({ local:90000, fallback:120000, marja:5000, polling:1500, backoffMax:5000 })
const ABANDON = Symbol('abandon'), TERMEN = Symbol('termen')

export function esteNoapteOCR(data = new Date()) {
  const ora = Number(new Intl.DateTimeFormat('en-GB', { timeZone:'Europe/Bucharest', hour:'2-digit', hourCycle:'h23' }).format(data))
  return ora >= 22 || ora < 6
}

export async function raspunsInvokeOCR(invoke, nume, body) {
  const { data, error } = await invoke(nume, { body })
  let raspuns = data
  if (error?.context?.json) { try { raspuns = await error.context.json() } catch { /* fără JSON */ } }
  return { raspuns, error, status:error?.context?.status }
}

function esec(r, cod) {
  return Object.assign(new Error(cod || r?.raspuns?.eroare || 'citire_esuata'), {
    status:r?.status, raspuns:cod ? { ...r?.raspuns, success:false, eroare:cod } : r?.raspuns || { success:false, eroare:'citire_esuata' },
  })
}

export function descrieSursaOCR(meta) {
  if (!meta) return ''
  if (meta.sursa?.ramura === 'haiku') return 'Haiku fallback'
  if (String(meta.model).startsWith('ocr_local:')) {
    return String(meta.model).includes('+claude-')
      ? `Local + Haiku pe ${meta.sursa?.dezacorduri ?? '?'} celule` : 'Local LightOn+MinerU'
  }
  return String(meta.model).includes('sonnet') ? 'Model superior direct' : 'Haiku direct'
}

export async function citesteLocal({ pdf_base64, proiect_id, depozit_id, sablon, actual, invoke,
  progres = () => {}, timers = { now:() => Date.now(), setTimeout, clearTimeout } }) {
  const { local, fallback, marja, polling, backoffMax } = TIMPI_OCR_LOCAL
  const verifica = () => { if (!actual()) throw ABANDON }
  const anunta = text => { verifica(); progres(text) }
  const pana = (stamp, limita) => Number.isFinite(Date.parse(stamp)) ? Math.min(limita, Date.parse(stamp) + marja) : limita
  // Nici un invoke blocat nu ține lock-ul la nesfârșit. Răspunsurile tardive nu au efecte.
  const asteapta = (promisiune, termen) => new Promise((resolve, reject) => {
    let gata = false, timer
    const inchide = (fn, v) => { if (gata) return; gata = true; timers.clearTimeout(timer); fn(v) }
    const pas = () => {
      if (!actual()) return inchide(reject, ABANDON)
      if (timers.now() >= termen) return inchide(reject, TERMEN)
      timer = timers.setTimeout(pas, Math.min(250, termen - timers.now()))
    }
    pas()
    Promise.resolve(promisiune).then(v => inchide(resolve, v), e => inchide(reject, e))
  })
  const pauza = ms => new Promise(resolve => timers.setTimeout(resolve, ms))
  const apel = async (body, termen) => {
    verifica()
    const r = await asteapta(raspunsInvokeOCR(invoke, 'izo-e3-ocr-local', body), termen)
    verifica()
    return r
  }
  try {
    verifica()
    if (esteNoapteOCR(new Date(timers.now()))) {
      anunta('Serverul local e oprit (noaptea 22–06) — citesc cu Haiku')
      return { haiku:true, motiv:'noapte' }
    }
    anunta('Citesc local…')
    const start = timers.now()
    let r = await apel({ op:'cere', pdf_base64, proiect_id, depozit_id, sablon }, start + local + marja)
    // B2 nu întoarce cerere_id la refuz: numai aici se folosește pilotul direct (R3-7).
    if ([409, 429].includes(r.status)) {
      anunta(r.raspuns?.eroare === 'noapte' ? 'Serverul local e oprit (noaptea 22–06) — citesc cu Haiku' : 'Citirea locală nu este disponibilă — citesc cu Haiku')
      return { haiku:true, motiv:r.raspuns?.eroare }
    }
    if (r.error || !r.raspuns?.success || !r.raspuns.cerere_id) throw esec(r)
    const id = r.raspuns.cerere_id
    let termen = pana(r.raspuns.termen_local, timers.now() + local + marja)
    let platit = false, delay = polling, ultimaStare = false
    const pornesteFallback = async motiv => {
      verifica()
      platit = true // înainte de transport: nici răspunsul pierdut nu permite al doilea apel.
      termen = timers.now() + fallback + marja
      ultimaStare = false; delay = polling
      anunta(motiv === 'structura_incerta' ? 'Cititoarele nu s-au înțeles — citesc cu Haiku' : 'Citirea locală nu a reușit — citesc cu Haiku')
      try { return await apel({ op:'fallback', cerere_id:id }, termen) }
      catch (e) {
        if (e === ABANDON) throw e
        // HTTP pierdut: recuperăm doar starea; niciun alt apel plătit.
        if (e?.context?.status && e.context.status < 500) throw e
        return null
      }
    }
    for (;;) {
      verifica()
      const d = r?.raspuns
      if (d?.tip === 'aviz_e3' && d.success && !r.error) return { raspuns:d }
      if (d?.stare === 'gata' && d.rezultat && !r.error) return { raspuns:d.rezultat }
      if (d?.stare === 'fallback' && !platit) {
        platit = true; termen = timers.now() + fallback + marja; ultimaStare = false
      }
      if (platit && d?.termen_fallback) termen = pana(d.termen_fallback, termen)
      if (r?.error && !(platit && (r.status >= 500 || r.status === 409 && d?.eroare === 'in_curs'))) throw esec(r)
      if (['esuata', 'expirata'].includes(d?.stare)) {
        if (platit || d.ramura === 'haiku' || d.eroare === 'pdf_invalid') throw esec(r, d.eroare || 'citire_esuata')
        r = await pornesteFallback(d.eroare); continue
      }
      if (ultimaStare) {
        if (platit) throw esec(r, 'termen_depasit')
        r = await pornesteFallback('timeout'); continue
      }
      try { await asteapta(pauza(Math.min(delay, Math.max(1, termen - timers.now()))), termen) }
      catch (e) { if (e !== TERMEN) throw e }
      verifica()
      // După termen consultăm serverul (expirarea e autoritativă), fără a prelungi termenul local.
      ultimaStare = timers.now() >= termen
      try { r = await apel({ op:'stare', cerere_id:id }, ultimaStare ? timers.now() + marja : termen) }
      catch (e) {
        if (e === ABANDON) throw e
        if (ultimaStare) throw esec(null, 'termen_depasit')
        r = null
      }
      delay = Math.min(backoffMax, Math.round(delay * 1.5))
    }
  } catch (e) {
    if (e === ABANDON) return { abandonat:true }
    if (e === TERMEN) throw esec(null, 'termen_depasit')
    throw e
  }
}
