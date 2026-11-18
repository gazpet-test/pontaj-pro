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
export default function MailOauthRetur() {
  const [sp, setSp] = useSearchParams()
  const [stare, setStare] = useState({ tip: 'lucru', text: 'Se verifică răspunsul de la Google și căsuța…' })
  const pornit = useRef(false)
  useEffect(() => {
    if (pornit.current) return   // o singură încercare: state-ul se consumă o dată; o repetare ar primi state_invalid
    pornit.current = true
    const r = clasificaRetur(sp)
    setSp({}, { replace: true })
    if (r.tip !== 'callback') { setStare(r); return }
    ;(async () => {
      const { data, error } = await supabase.functions.invoke('redari-mail-oauth', { body: { actiune: 'callback', code: r.code, state: r.state } })
      if (error) {
        let cod = null
        try { cod = (await error.context?.json())?.cod ?? null } catch { /* fără corp */ }
        setStare({ tip: 'esuat', text: `Conectarea NU a reușit${cod ? ` (${cod})` : ''}. Nimic nu a fost salvat; dacă Google a emis un token, a fost revocat. Reia „Conectează” din Lot e-mail.` })
        return
      }
      setStare({ tip: 'ok', text: `Căsuța ${data?.casuta || 'redari@gazpet.ro'} este conectată pentru trimitere. Trimiterea rămâne oprită până o pornește owner-ul din Lot e-mail.` })
    })()
  }, [sp, setSp])
  return <div style={{ padding: 24, maxWidth: 720 }}>
    <h2>Conectarea căsuței pentru e-mailul Redări</h2>
    <p role={stare.tip === 'esuat' || stare.tip === 'invalid' || stare.tip === 'refuzat' ? 'alert' : 'status'}>{stare.text}</p>
    <Link to="/redari">Înapoi la Redări</Link>
  </div>
}
