import React, { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase.js'

// /redari/mail-oauth — pagina de ÎNTOARCERE de la Google după consimțământul owner-ului (redirect URI-ul clientului „ERP Redări trimitere”).
// Google pune în adresă ?code=…&state=… (sau ?error=…). Pagina le trimite O SINGURĂ DATĂ funcției edge redari-mail-oauth (acțiunea
// callback, cu JWT-ul omului logat în ERP); serverul consumă state-ul atomic, verifică scope-urile și căsuța și pune refresh token-ul în Vault.
// Nimic din adresă nu e executat ca instrucțiune; codul nu se afișează și nu se reține. Parametrii se scot din adresă imediat (replace).
export const STATE_FORMA = /^[0-9a-f]{64}$/
export function clasificaRetur(sp) {
  const error = sp.get('error'), code = sp.get('code'), state = sp.get('state')
  if (error) return { tip: 'refuzat', text: 'Google nu a acordat accesul (consimțământ refuzat sau cerere invalidă). Nimic nu a fost salvat.' }
  if (!code || !state) return { tip: 'gol', text: 'Această pagină se deschide doar la întoarcerea de la Google. Nimic de făcut.' }
  if (!STATE_FORMA.test(state) || code.length > 512) return { tip: 'invalid', text: 'Răspunsul de la Google are o formă neașteptată. Nimic nu a fost salvat.' }
  return { tip: 'callback', code, state }
}
/**
 * Mesajul pentru om după un răspuns de refuz / lipsă (date, nu instrucțiuni). Nuanțat (runda 2): „nimic salvat” e sigur doar când serverul a RĂSPUNS
 * cu un cod de refuz (409 / 502 / 400); un răspuns pierdut (rețea, 503, timeout) nu dovedește nici salvarea, nici revocarea → starea se verifică
 * în Lot e-mail (Recitește) și, la nevoie, în contul Google.
 */
export const CODURI_CU_REVOCARE = /^(casuta_gresita|scope_diferit|fara_refresh_token|jwks_indisponibil|id_token_[a-z_]+)$/
export function textEsec(cod, statusHttp) {
  const verificare = 'Verifică în Lot e-mail (Recitește) dacă căsuța apare conectată; dacă nu, reia „Conectează”.'
  const revocare = 'Serverul a cerut revocarea la Google a accesului primit; dacă Google a confirmat-o nu se poate ști de aici (la nevoie, în contul redari@: Securitate → Conexiuni cu aplicații terțe).'
  if (cod === 'state_invalid') return `Pagina a fost deschisă a doua oară sau au trecut peste 10 minute (${cod}). Nimic nu a fost salvat; codul nu a fost schimbat la Google. Reia „Conectează” din Lot e-mail.`
  if (cod === 'schimb_esuat') return `Google nu a acceptat codul de autorizare (${cod}). Nimic nu a fost salvat. Reia „Conectează” din Lot e-mail.`
  if (typeof cod === 'string' && CODURI_CU_REVOCARE.test(cod)) return `Conectarea a fost REFUZATĂ de server (${cod}). Nimic nu a fost salvat în ERP. ${revocare} ${verificare}`
  if (cod === 'salvare_neconfirmata') return `Serverul a primit accesul, dar NU a putut confirma salvarea (${cod}). ${revocare} Starea reală: ${verificare}`
  if (cod && Number.isInteger(statusHttp) && statusHttp >= 400 && statusHttp < 500) return `Conectarea a fost refuzată (${cod}). Nimic nu a fost salvat. ${verificare}`
  return `Răspunsul serverului s-a pierdut sau a fost o eroare temporară${cod ? ` (${cod})` : ''}: nu se știe dacă căsuța a fost conectată, nici dacă serverul a apucat să revoce un acces primit. NU reîncărca pagina. ${verificare}`
}
export default function MailOauthRetur() {
  const [sp, setSp] = useSearchParams()
  const [stare, setStare] = useState({ tip: 'lucru', text: 'Se verifică răspunsul de la Google și căsuța…' })
  const pornit = useRef(false), montat = useRef(true)
  useEffect(() => { montat.current = true; return () => { montat.current = false } }, [])
  useEffect(() => {
    if (pornit.current) return   // o singură încercare: state-ul se consumă o dată; o repetare ar primi state_invalid
    pornit.current = true
    const r = clasificaRetur(sp)
    setSp({}, { replace: true })
    if (r.tip !== 'callback') { setStare(r); return }
    ;(async () => {
      let data, error
      try { ({ data, error } = await supabase.functions.invoke('redari-mail-oauth', { body: { actiune: 'callback', code: r.code, state: r.state } })) }
      catch { error = { context: null } }
      if (!montat.current) return   // L24: rezultatul nu se aplică după demontare (pagina a fost părăsită)
      if (error) {
        let cod = null, statusHttp = null
        try { statusHttp = error.context?.status ?? null; cod = (await error.context?.json())?.cod ?? null } catch { /* fără corp */ }
        if (montat.current) setStare({ tip: 'esuat', text: textEsec(cod, statusHttp) })
        return
      }
      if (data?.cod !== 'conectat') { setStare({ tip: 'esuat', text: textEsec(data?.cod ?? null, null) }); return }
      setStare({ tip: 'ok', text: `Căsuța ${data?.casuta || 'redari@gazpet.ro'} este conectată pentru trimitere. Trimiterea rămâne oprită până o pornește owner-ul din Lot e-mail.` })
    })()
  }, [sp, setSp])
  return <div style={{ padding: 24, maxWidth: 720 }}>
    <h2>Conectarea căsuței pentru e-mailul Redări</h2>
    <p role={stare.tip === 'esuat' || stare.tip === 'invalid' || stare.tip === 'refuzat' ? 'alert' : 'status'}>{stare.text}</p>
    <Link to="/redari">Înapoi la Redări</Link>
  </div>
}
