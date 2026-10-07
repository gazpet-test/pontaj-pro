// ════════════════════════════════════════════════════════════════
// 🎙 Mesaj vocal (/mesaj-vocal) — text → MP3 cu vocea Aoede (Google Cloud TTS), trimis din aplicație pe WhatsApp
// prin meniul de partajare al telefonului (Web Share API cu fișier); pe calculator, descărcare.
// Decizii Răzvan 07.10.2026: Google, vocea ro-RO-Chirp3-HD-Aoede, plafon lunar 950.000 caractere (în BD, fn_tts_rezerva):
// la plafon, generarea se oprește până la începutul lunii următoare. Același text a doua oară vine din cache, fără cost.
// Acces: owner sau cheia de modul 'mesaj_vocal' (doar cu acordul lui Răzvan); verificarea reală e în edge-ul tts-google.
// ════════════════════════════════════════════════════════════════
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from './lib/supabase.js'
import { genereazaVoce, fisierMp3, poatePartaja, partajeaza, descarca } from './ttsFlux.js'
import { textPentruVoce, nrCaractere, numeFisierMp3, lunaGoogle, MAX_CARACTERE, PLAFON_LUNAR, poateVoce } from './ttsUtil.js'

const G = { bg:'#0D1117', surface:'#161B22', text:'#E6EDF3', muted:'#8B949E', border:'#30363D', blue:'#1F6FEB', green:'#2EA043', yellow:'#D29922', red:'#F85149', voce:'#A371F7' }
const S = {
  card: { background:G.surface, borderRadius:12, border:`1px solid ${G.border}`, padding:16 },
  btnP: { padding:'12px 18px', background:G.voce, color:'#fff', border:'none', borderRadius:10, cursor:'pointer', fontSize:15, fontWeight:700 },
  btnS: { padding:'10px 14px', background:G.bg, color:G.text, border:`1px solid ${G.border}`, borderRadius:10, cursor:'pointer', fontSize:14 },
}
const fmt = n => Number(n || 0).toLocaleString('ro-RO')

export default function MesajVocal({ profile }) {
  const [text, setText] = useState('')
  const [curata, setCurata] = useState(true)
  const [lucru, setLucru] = useState(false)
  const [rez, setRez] = useState(null)       // { url, din_cache, caractere, ramase }
  const [fisier, setFisier] = useState(null) // File MP3, gata de partajat
  const [info, setInfo] = useState('')
  const [err, setErr] = useState('')
  const [cota, setCota] = useState(null)     // doar owner: { luna, caractere }

  async function incarcaCota() {
    if (!profile?.is_owner) return
    // luna curentă exactă (ora Google); fără rând ⇒ 0 — nu luna trecută (J13-5/P12-3)
    const luna = lunaGoogle()
    const { data } = await supabase.from('tts_cota_lunara').select('luna, caractere').eq('luna', luna).maybeSingle()
    setCota(data || { luna, caractere: 0 })
  }
  useEffect(() => { incarcaCota() }, [profile?.is_owner])   // eslint-disable-line react-hooks/exhaustive-deps

  if (!poateVoce(profile)) {
    return <div style={{ minHeight:'100vh', background:G.bg, color:G.text, padding:24 }}>Nu ai acces la Mesaj vocal. <Link to="/" style={{ color:G.blue }}>← Acasă</Link></div>
  }

  const deCitit = curata ? textPentruVoce(text) : text.trim()
  const n = nrCaractere(deCitit)
  const preaLung = n > MAX_CARACTERE

  async function genereaza() {
    if (!deCitit || preaLung || lucru) return
    setLucru(true); setErr(''); setRez(null); setFisier(null); setInfo('')
    try {
      const r = await genereazaVoce(deCitit)
      setRez(r)
      setFisier(await fisierMp3(r.url, numeFisierMp3()))
    } catch (e) { setErr(e.message) } finally {
      setLucru(false)
      incarcaCota().catch(() => {})   // și după eșec: bucățile plecate la Google rămân numărate (J14-2)
    }
  }

  return (
    <div style={{ minHeight:'100vh', background:G.bg, color:G.text, fontFamily:'inherit' }}>
      <div style={{ background:G.surface, borderBottom:`1px solid ${G.border}`, padding:'12px 20px', display:'flex', alignItems:'center', gap:14 }}>
        <Link to="/" style={{ color:G.muted, textDecoration:'none', fontSize:14 }}>← Acasă</Link>
        <div style={{ fontWeight:800, fontSize:18 }}>🎙 Mesaj vocal</div>
        <div style={{ fontSize:12, color:G.muted }}>vocea Aoede · Google</div>
      </div>
      <div style={{ maxWidth:820, margin:'0 auto', padding:'18px 16px', display:'flex', flexDirection:'column', gap:14 }}>
        <div style={S.card}>
          <div style={{ fontSize:13, color:G.muted, marginBottom:8 }}>Scrie sau lipește textul. Îl transform în voce, îl asculți și îl trimiți direct pe WhatsApp (sau îl descarci ca MP3).</div>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={10} placeholder="Bună ziua, ..."
            style={{ width:'100%', boxSizing:'border-box', background:G.bg, color:G.text, border:`1px solid ${preaLung ? G.red : G.border}`, borderRadius:10, padding:12, fontSize:16, lineHeight:1.5, resize:'vertical', fontFamily:'inherit' }} />
          <div style={{ display:'flex', flexWrap:'wrap', alignItems:'center', gap:12, marginTop:10 }}>
            <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, color:G.muted, cursor:'pointer' }}>
              <input type="checkbox" checked={curata} onChange={e => setCurata(e.target.checked)} />
              scoate simbolurile (*, #, linkuri, emoji) înainte de citire
            </label>
            <span style={{ marginLeft:'auto', fontSize:13, color: preaLung ? G.red : G.muted }}>{fmt(n)} / {fmt(MAX_CARACTERE)} caractere</span>
          </div>
          <div style={{ display:'flex', gap:10, marginTop:12 }}>
            <button onClick={genereaza} disabled={!deCitit || preaLung || lucru} style={{ ...S.btnP, opacity: (!deCitit || preaLung || lucru) ? .5 : 1 }}>
              {lucru ? '⏳ Generez…' : '🔊 Generează vocea'}
            </button>
            {text && <button onClick={() => { setText(''); setRez(null); setFisier(null); setErr(''); setInfo('') }} style={S.btnS}>Golește</button>}
          </div>
          {err && <div style={{ marginTop:12, padding:10, borderRadius:8, background:'#3F1A1F', color:G.red, fontSize:14 }}>{err}</div>}
        </div>

        {rez && (
          <div style={S.card}>
            <audio src={rez.url} controls autoPlay style={{ width:'100%' }} />
            <div style={{ display:'flex', flexWrap:'wrap', alignItems:'center', gap:10, marginTop:10 }}>
              {poatePartaja(fisier) && (
                <button onClick={() => partajeaza(fisier).then(ok => ok && setInfo('Trimis spre aplicația aleasă.')).catch(e => setErr(e.message))}
                  style={{ ...S.btnP, background:'#25D366' }}>📤 Trimite pe WhatsApp</button>
              )}
              {fisier && <button onClick={() => { descarca(fisier); if (!poatePartaja(fisier)) setInfo('Fișierul s-a salvat. În WhatsApp Web: agrafă → Document → alege fișierul.') }} style={S.btnS}>⬇ Descarcă MP3</button>}
              <span style={{ fontSize:13, color:G.muted }}>
                {rez.din_cache ? 'Din cache — același text a mai fost generat, fără consum.' : `${fmt(rez.caractere)} caractere folosite` + (rez.ramase != null ? ` · rămase luna aceasta: ${fmt(rez.ramase)}` : '')}
              </span>
            </div>
            {info && <div style={{ marginTop:10, fontSize:13, color:G.green }}>{info}</div>}
            {fisier && !poatePartaja(fisier) && <div style={{ marginTop:8, fontSize:12, color:G.muted }}>Pe telefon, butonul „Trimite pe WhatsApp” deschide direct lista de aplicații. Pe calculator se descarcă fișierul.</div>}
          </div>
        )}

        {profile?.is_owner && cota && (
          <div style={{ ...S.card, fontSize:13, color:G.muted }}>
            Consum luna curentă: <b style={{ color:G.text }}>{fmt(cota.caractere)}</b> din {fmt(PLAFON_LUNAR)} caractere
            {' '}({Math.round((cota.caractere || 0) * 100 / PLAFON_LUNAR)}%). La plafon, generarea se oprește până la începutul lunii următoare (gratuit la Google: 1.000.000/lună).
          </div>
        )}
      </div>
    </div>
  )
}
