// ═══════════════════════════════════════════════════════════════════════════
// RedariRaspunsPublic.jsx — pagină PUBLICĂ (fără login) a modulului Redări teren:
// /redari/raspuns/:token — proprietarul o deschide de pe telefon, din QR-ul sau
// linkul din convocator. Două RPC-uri SECURITY DEFINER (docs/redari/CONTRACT_SCHEMA.md §5):
//   fn_red_formular_public(p_token)  → { ok, id_parcela, uat_nume, proiect_denumire,
//                                       sesiune:[{zi, program}], deja_raspuns, expirat }
//   fn_red_raspuns_public(p_token, p_optiune, p_zi, p_obiectii, p_declaratie_confirmata, p_user_agent)
//                                    → { ok } | { ok:false, motiv:'token_invalid'|'prea_multe'|'deja_raspuns'|… }
// Fără date personale (RPC-ul nu le dă), fără urmărire externă, fără fonturi externe.
// Decizia 6 (Răzvan 01.11): răspunsul NU trimite mail/SMS și NU generează PV — operatorul le face din Registru.
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from './lib/supabase.js'

// Paletă deschisă — pagina se citește în soare, pe teren (ca AplicaPublic.jsx)
const G = { bg: '#f4f6f8', card: '#fff', text: '#1a2733', muted: '#5a6b7b', blue: '#0b4f8a', green: '#0b7a3b', red: '#b42318', amber: '#8a5a00', border: '#cdd6de', soft: '#eef5fb' }

const OPTIUNI = [
  { cod: 'particip', titlu: 'Particip la constatare', desc: 'Voi fi prezent pe teren, în una din zilele de mai sus.' },
  { cod: 'nu_particip_fara_obiectii', titlu: 'Nu particip — nu am obiecții', desc: 'Sunt de acord ca procesul-verbal să fie întocmit în lipsa mea.' },
  { cod: 'nu_particip_cu_obiectii', titlu: 'Nu particip — am obiecții', desc: 'Nu pot veni, dar vreau să semnalez ceva despre starea terenului.' },
  { cod: 'constatare_teren', titlu: 'Solicit constatare pe teren', desc: 'Cer să ne întâlnim pe parcelă; scrieți mai jos ce ați constatat.' },
]
const TITLU_OPTIUNE = Object.fromEntries(OPTIUNI.map(o => [o.cod, o.titlu]))
const DECLARATIE_STANDARD = 'Declar că am luat cunoștință de convocare, nu am obiecții privind readucerea terenului la starea inițială și sunt de acord ca procesul-verbal să fie întocmit în lipsa mea.'
const MAX_OBIECTII = 4000
const MSG_NEUTRU = 'Linkul nu este valid sau a expirat.'
const MSG_EROARE = 'A apărut o eroare, reîncercați.'

const fmtZi = (d) => {
  if (!d) return '—'
  const dt = new Date(String(d).slice(0, 10) + 'T00:00:00')
  if (isNaN(dt)) return String(d)
  const s = dt.toLocaleDateString('ro-RO', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// Stiluri comune — butoane mari (≥48px), text ≥16px în câmpuri (fără zoom pe iOS), lățime minimă 360px
const S = {
  pagina: { fontFamily: 'system-ui, Segoe UI, Arial, sans-serif', background: G.bg, minHeight: '100vh', margin: 0, padding: 12, color: G.text, boxSizing: 'border-box' },
  card: { maxWidth: 560, margin: '8px auto', background: G.card, borderRadius: 12, boxShadow: '0 2px 14px #0002', padding: '20px 16px', boxSizing: 'border-box' },
  h1: { fontSize: 20, margin: '0 0 2px', color: G.blue, letterSpacing: .3 },
  sub: { color: G.muted, fontSize: 13, marginBottom: 14 },
  eticheta: { fontSize: 12, fontWeight: 700, color: G.muted, textTransform: 'uppercase', letterSpacing: .4, margin: '14px 0 6px' },
  info: { fontSize: 13.5, background: G.soft, border: '1px solid #cfe3f5', borderRadius: 8, padding: '10px 12px', color: '#28425c', lineHeight: 1.45 },
  atentie: { fontSize: 13.5, background: '#fff8e6', border: '1px solid #f1dfa6', borderRadius: 8, padding: '10px 12px', color: G.amber, lineHeight: 1.45 },
  eroare: { fontSize: 14, background: '#fdeeee', border: '1px solid #f2c2c2', borderRadius: 8, padding: '10px 12px', color: G.red, lineHeight: 1.45 },
  tabel: { width: '100%', borderCollapse: 'collapse', fontSize: 14 },
  td: { padding: '9px 8px', borderBottom: `1px solid ${G.border}`, verticalAlign: 'top', lineHeight: 1.4 },
  optiune: (activ) => ({ display: 'block', width: '100%', textAlign: 'left', minHeight: 56, padding: '12px 14px', marginBottom: 10, borderRadius: 10, cursor: 'pointer', boxSizing: 'border-box',
    border: `2px solid ${activ ? G.blue : G.border}`, background: activ ? G.soft : '#fff', color: G.text, fontFamily: 'inherit' }),
  zi: (activ) => ({ display: 'block', width: '100%', textAlign: 'left', minHeight: 48, padding: '10px 14px', marginBottom: 8, borderRadius: 10, cursor: 'pointer', boxSizing: 'border-box',
    border: `2px solid ${activ ? G.green : G.border}`, background: activ ? '#e7f7ec' : '#fff', color: G.text, fontSize: 15, fontFamily: 'inherit' }),
  textarea: { width: '100%', minHeight: 130, padding: '10px 12px', border: `1px solid ${G.border}`, borderRadius: 8, fontSize: 16, boxSizing: 'border-box', background: '#fff', color: G.text, fontFamily: 'inherit', lineHeight: 1.4, resize: 'vertical' },
  bifa: { display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14, color: G.text, lineHeight: 1.45, marginTop: 10, cursor: 'pointer' },
  trimite: (dezactivat) => ({ marginTop: 18, width: '100%', minHeight: 52, padding: 13, background: G.green, color: '#fff', border: 'none', borderRadius: 10, fontSize: 17, fontWeight: 700, cursor: dezactivat ? 'default' : 'pointer', opacity: dezactivat ? .6 : 1, fontFamily: 'inherit' }),
  subsol: { textAlign: 'center', fontSize: 11.5, color: '#8a99a8', marginTop: 16, lineHeight: 1.5 },
  fieldset: { border: 'none', padding: 0, margin: 0, minWidth: 0 },
}

// Datele de contact apar DOAR dacă RPC-ul le trimite (contract §5 nu le promite; dacă vin, le afișăm)
function Contact({ f }) {
  if (!f) return null
  const nume = f.contact_nume, tel = f.contact_telefon, mail = f.contact_email
  if (!nume && !tel && !mail) return null
  return (
    <div style={{ ...S.info, marginTop: 14 }}>
      Pentru întrebări: {nume && <strong>{nume}</strong>}{nume && (tel || mail) && ' · '}
      {tel && <a href={`tel:${String(tel).replace(/\s+/g, '')}`} style={{ color: G.blue, fontWeight: 700, textDecoration: 'none' }}>{tel}</a>}
      {tel && mail && ' · '}
      {mail && <a href={`mailto:${mail}`} style={{ color: G.blue, fontWeight: 700, textDecoration: 'none', wordBreak: 'break-all' }}>{mail}</a>}
    </div>
  )
}

function Antet({ f }) {
  return (
    <>
      <h1 style={S.h1}>GAZPET INSTAL S.R.L.</h1>
      <div style={S.sub}>Readucerea terenului la starea inițială — răspuns la convocare</div>
      {f?.ok && (
        <div style={{ ...S.info, marginBottom: 4 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: G.blue }}>Parcela {f.id_parcela || '—'}{f.uat_nume ? ` · ${f.uat_nume}` : ''}</div>
          {f.proiect_denumire && <div style={{ marginTop: 4 }}>{f.proiect_denumire}</div>}
        </div>
      )}
    </>
  )
}

export default function RedariRaspunsPublic() {
  const { token } = useParams()
  const [form, setForm] = useState(null)       // răspunsul fn_red_formular_public (sau { ok:false })
  const [incarca, setIncarca] = useState(true)
  const [optiune, setOptiune] = useState('')
  const [zi, setZi] = useState('')
  const [obiectii, setObiectii] = useState('')
  const [declaratie, setDeclaratie] = useState(false)
  const [validare, setValidare] = useState('')  // mesaj de validare locală
  const [busy, setBusy] = useState(false)
  const [rezultat, setRezultat] = useState(null) // răspunsul fn_red_raspuns_public (sau eroare normalizată)
  const [instantaneu, setInstantaneu] = useState(null) // r5 P2-2: ce s-a TRIMIS efectiv — rezumatul îl arată pe el, nu starea curentă
  const tokenCurent = useRef(token)              // r3 P2-2: gardă la trimitere — rezultatul unei cereri pornite pe alt token se ignoră
  tokenCurent.current = token

  // Copilot FE r1 P2-01: tokenul e în URL → fără Referer către alte pagini (header-ul e și în vercel.json; meta = plasă de siguranță)
  useEffect(() => {
    let meta = document.querySelector('meta[name="referrer"]')
    const creat = !meta
    if (creat) { meta = document.createElement('meta'); meta.name = 'referrer'; document.head.appendChild(meta) }
    const vechi = meta.content
    meta.content = 'no-referrer'
    return () => { if (creat) meta.remove(); else meta.content = vechi }
  }, [])
  useEffect(() => {
    document.title = 'Răspuns convocare — Gazpet'
    // P2-6: alt token (navigare între două linkuri în același tab) = formular nou — nimic din răspunsul anterior nu rămâne pe ecran
    setForm(null); setIncarca(true); setOptiune(''); setZi(''); setObiectii(''); setDeclaratie(false); setValidare(''); setBusy(false); setRezultat(null); setInstantaneu(null)
    if (!token) { setForm({ ok: false }); setIncarca(false); return }
    let anulat = false
    ;(async () => {
      try {
        const { data, error } = await supabase.rpc('fn_red_formular_public', { p_token: token })
        if (anulat) return
        if (error || !data) setForm({ ok: false, eroare_retea: !!error })
        else setForm(data)
      } catch { if (!anulat) setForm({ ok: false, eroare_retea: true }) }
      if (!anulat) setIncarca(false)
    })()
    return () => { anulat = true }
  }, [token])

  // Zilele sesiunii: doar cele cu dată; `zi` e cheia trimisă ca p_zi (date ISO, YYYY-MM-DD)
  const sesiune = Array.isArray(form?.sesiune) ? form.sesiune.filter(s => s && s.zi) : []
  const textDeclaratie = (form?.text_declaratie && String(form.text_declaratie).trim()) || DECLARATIE_STANDARD
  const cereZi = optiune === 'particip'
  const cereDeclaratie = optiune === 'nu_particip_fara_obiectii'
  const cereObiectii = optiune === 'nu_particip_cu_obiectii' || optiune === 'constatare_teren'

  const alegeOptiune = (cod) => { setOptiune(cod); setValidare(''); if (cod !== 'particip') setZi('') }

  const trimite = async () => {
    if (busy) return
    if (!optiune) return setValidare('Alegeți una din cele patru variante.')
    if (cereZi && !zi) return setValidare('Alegeți ziua în care participați.')
    if (cereDeclaratie && !declaratie) return setValidare('Bifați declarația pentru a continua.')
    const obj = obiectii.trim()
    if (cereObiectii && !obj) return setValidare('Scrieți pe scurt obiecțiile dumneavoastră.')
    if (obj.length > MAX_OBIECTII) return setValidare(`Textul este prea lung (maxim ${MAX_OBIECTII} caractere).`)
    setValidare(''); setBusy(true)
    const tokenCerere = token   // capturat la pornirea cererii
    // r5 P2-2: instantaneul datelor trimise — formularul e blocat (fieldset disabled) cât durează cererea, iar rezumatul arată exact ce s-a trimis
    const trimis = { optiune, zi: cereZi ? zi : '', obiectii: cereObiectii ? obj : '', declaratie: cereDeclaratie ? declaratie : false, la: new Date() }
    try {
      const { data, error } = await supabase.rpc('fn_red_raspuns_public', {
        p_token: tokenCerere,
        p_optiune: trimis.optiune,
        p_zi: cereZi ? trimis.zi : null,
        p_obiectii: cereObiectii ? trimis.obiectii : null,
        p_declaratie_confirmata: trimis.declaratie,
        p_user_agent: (typeof navigator !== 'undefined' && navigator.userAgent) ? String(navigator.userAgent).slice(0, 500) : null,
      })
      if (tokenCerere !== tokenCurent.current) return   // tokenul s-a schimbat între timp: rezultatul nu e al acestui formular
      if (error || !data) setRezultat({ ok: false, motiv: 'eroare' })
      else { setInstantaneu(trimis); setRezultat(data) }
    } catch { if (tokenCerere === tokenCurent.current) setRezultat({ ok: false, motiv: 'eroare' }) }
    if (tokenCerere !== tokenCurent.current) return
    setBusy(false)
    window.scrollTo(0, 0)
  }

  // ── Ecrane terminale ─────────────────────────────────────────────────────
  if (incarca) {
    return (
      <div style={S.pagina}><div style={S.card}><Antet /><div style={{ color: G.muted, fontSize: 15, padding: '20px 0', textAlign: 'center' }}>Se încarcă…</div></div></div>
    )
  }

  const linkInvalid = !form?.ok || form.expirat === true || rezultat?.motiv === 'token_invalid' || rezultat?.motiv === 'expirat'
  if (linkInvalid) {
    return (
      <div style={S.pagina}>
        <div style={S.card}>
          <Antet />
          <div style={S.eroare}>
            <strong>{form?.eroare_retea && !rezultat ? MSG_EROARE : MSG_NEUTRU}</strong>
            <div style={{ marginTop: 6 }}>{form?.eroare_retea && !rezultat ? 'Verificați conexiunea la internet și deschideți din nou linkul din convocator.' : 'Dacă ați primit o convocare, folosiți linkul sau codul QR din document, sau contactați-ne.'}</div>
          </div>
          <Contact f={form} />
          <div style={S.subsol}>gazpet.ro</div>
        </div>
      </div>
    )
  }

  if (rezultat?.ok) {
    // rezumatul = instantaneul trimis (nu starea curentă a câmpurilor)
    const inst = instantaneu || { optiune, zi, obiectii: obiectii.trim(), declaratie, la: new Date() }
    const instZi = inst.optiune === 'particip', instDecl = inst.optiune === 'nu_particip_fara_obiectii', instObj = inst.optiune === 'nu_particip_cu_obiectii' || inst.optiune === 'constatare_teren'
    return (
      <div style={S.pagina}>
        <div style={S.card}>
          <Antet f={form} />
          <div style={{ textAlign: 'center', margin: '18px 0 10px' }}>
            <div style={{ fontSize: 44, color: G.green }}>✓</div>
            <div style={{ fontSize: 19, fontWeight: 800, color: G.green }}>Răspunsul a fost înregistrat</div>
            <div style={{ fontSize: 13.5, color: G.muted, marginTop: 4 }}>{rezultat.mesaj || 'Vă mulțumim. Puteți închide pagina.'}</div>
          </div>
          <div style={S.eticheta}>Rezumat</div>
          <table style={S.tabel}><tbody>
            <tr><td style={{ ...S.td, color: G.muted, width: '38%' }}>Opțiunea</td><td style={{ ...S.td, fontWeight: 700 }}>{TITLU_OPTIUNE[inst.optiune] || inst.optiune}</td></tr>
            {instZi && <tr><td style={{ ...S.td, color: G.muted }}>Ziua aleasă</td><td style={S.td}>{fmtZi(inst.zi)}{(() => { const s = sesiune.find(x => String(x.zi).slice(0, 10) === inst.zi); return s?.program ? ` · ${s.program}` : '' })()}</td></tr>}
            {instDecl && <tr><td style={{ ...S.td, color: G.muted }}>Declarație</td><td style={S.td}>{inst.declaratie ? 'Confirmată' : '—'}</td></tr>}
            {instObj && <tr><td style={{ ...S.td, color: G.muted }}>Obiecții</td><td style={{ ...S.td, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{inst.obiectii}</td></tr>}
            <tr><td style={{ ...S.td, color: G.muted, borderBottom: 'none' }}>Data</td><td style={{ ...S.td, borderBottom: 'none' }}>{(inst.la || new Date()).toLocaleString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td></tr>
          </tbody></table>
          <Contact f={form} />
          <div style={S.subsol}>gazpet.ro · răspunsul este păstrat în registrul lucrării și vizibil doar echipei Gazpet</div>
        </div>
      </div>
    )
  }

  // ── Formularul ───────────────────────────────────────────────────────────
  const dejaRaspuns = form.deja_raspuns === true || rezultat?.motiv === 'deja_raspuns' || rezultat?.deja_raspuns === true
  let bannerRezultat = null
  if (rezultat && !rezultat.ok) {
    if (rezultat.motiv === 'prea_multe') bannerRezultat = 'Prea multe încercări. Reîncercați peste 10 minute.'
    else if (rezultat.motiv === 'deja_raspuns') bannerRezultat = rezultat.mesaj || 'Există deja un răspuns înregistrat pentru această parcelă. Dacă doriți să îl schimbați, contactați-ne.'
    else bannerRezultat = rezultat.mesaj || MSG_EROARE
  }

  return (
    <div style={S.pagina}>
      <div style={S.card}>
        <Antet f={form} />

        {bannerRezultat && <div style={{ ...S.eroare, marginTop: 12 }} role="alert">{bannerRezultat}</div>}
        {dejaRaspuns && !bannerRezultat && (
          <div style={{ ...S.atentie, marginTop: 12 }}>Am primit deja un răspuns pentru această parcelă. Puteți trimite un răspuns nou; dacă este acceptat, el îl înlocuiește pe cel anterior.</div>
        )}

        <div style={S.eticheta}>Zilele constatării pe teren</div>
        {sesiune.length ? (
          <table style={S.tabel}><tbody>
            {sesiune.map((s, i) => (
              <tr key={i}>
                <td style={{ ...S.td, fontWeight: 700, whiteSpace: 'nowrap' }}>Ziua {i + 1}</td>
                <td style={S.td}>{fmtZi(s.zi)}{s.program ? <div style={{ color: G.muted, fontSize: 13 }}>{s.program}</div> : null}</td>
              </tr>
            ))}
          </tbody></table>
        ) : <div style={S.info}>Programul zilelor de constatare va fi comunicat separat.</div>}

        {/* r5 P2-2: cât durează trimiterea, tot formularul e blocat — nimic nu se mai poate schimba sub cererea în curs */}
        <fieldset disabled={busy} aria-busy={busy} style={S.fieldset}>
        <div style={S.eticheta}>Cum răspundeți?</div>
        <div role="radiogroup" aria-label="Varianta de răspuns">
          {OPTIUNI.map(o => {
            const activ = optiune === o.cod
            return (
              <button key={o.cod} type="button" role="radio" aria-checked={activ} onClick={() => alegeOptiune(o.cod)} style={S.optiune(activ)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: '50%', border: `2px solid ${activ ? G.blue : G.border}`, background: activ ? G.blue : '#fff', color: '#fff', fontSize: 14, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{activ ? '✓' : ''}</span>
                  <span style={{ fontSize: 16, fontWeight: 700 }}>{o.titlu}</span>
                </div>
                <div style={{ fontSize: 13, color: G.muted, marginTop: 4, paddingLeft: 32 }}>{o.desc}</div>
              </button>
            )
          })}
        </div>

        {cereZi && (
          <>
            <div style={S.eticheta}>În ce zi participați? *</div>
            {sesiune.length ? sesiune.map((s, i) => {
              const cheie = String(s.zi).slice(0, 10), activ = zi === cheie
              return (
                <button key={cheie} type="button" aria-pressed={activ} onClick={() => { setZi(cheie); setValidare('') }} style={S.zi(activ)}>
                  <strong>Ziua {i + 1}:</strong> {fmtZi(s.zi)}{s.program ? <span style={{ color: G.muted }}> · {s.program}</span> : null}
                </button>
              )
            }) : <div style={S.atentie}>Zilele nu au fost încă stabilite. Alegeți altă variantă sau contactați-ne.</div>}
          </>
        )}

        {cereDeclaratie && (
          <>
            <div style={S.eticheta}>Declarație *</div>
            <div style={S.info}>{textDeclaratie}</div>
            <label style={S.bifa}>
              <input type="checkbox" checked={declaratie} onChange={e => { setDeclaratie(e.target.checked); setValidare('') }} style={{ width: 22, height: 22, marginTop: 1, flexShrink: 0 }} />
              <span>Am citit și confirm declarația de mai sus.</span>
            </label>
          </>
        )}

        {cereObiectii && (
          <>
            <div style={S.eticheta}>{optiune === 'constatare_teren' ? 'Ce ați constatat pe teren? *' : 'Care sunt obiecțiile dumneavoastră? *'}</div>
            <textarea value={obiectii} onChange={e => { setObiectii(e.target.value.slice(0, MAX_OBIECTII)); setValidare('') }} maxLength={MAX_OBIECTII} rows={5} style={S.textarea}
              placeholder="Descrieți pe scurt starea terenului sau ce doriți să semnalați." aria-label="Obiecții" />
            <div style={{ fontSize: 12, color: G.muted, textAlign: 'right', marginTop: 4 }}>{obiectii.length} / {MAX_OBIECTII}</div>
          </>
        )}

        {validare && <div style={{ ...S.eroare, marginTop: 12 }} role="alert">{validare}</div>}

        <button type="button" onClick={trimite} disabled={busy} style={S.trimite(busy)}>{busy ? 'Se trimite…' : 'Trimite răspunsul'}</button>
        </fieldset>

        <Contact f={form} />
        <div style={S.subsol}>gazpet.ro · pagina nu afișează și nu cere date personale; răspunsul se leagă de convocarea dumneavoastră prin linkul primit</div>
      </div>
    </div>
  )
}
