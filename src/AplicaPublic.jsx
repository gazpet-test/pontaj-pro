// ════════════════════════════════════════════════════════════════
// AplicaPublic.jsx — formularul PUBLIC de aplicare (linkul din anunțurile OLX/eJobs/Facebook): /aplica
// 07.09.2026: mutat din edge fn recrutare-aplica (Supabase rescrie răspunsurile HTML ale funcțiilor în text/plain,
// candidatul vedea codul sursă). Pagina e pe Vercel; edge fn rămâne backend-ul (GET ?format=json → poziții,
// POST multipart cu Accept: application/json → candidat + CV în bucketul privat recrutare-cv).
// Fără autentificare, fără Layout — e pentru candidați, nu pentru colegi.
// ════════════════════════════════════════════════════════════════
import { useEffect, useState } from 'react'

const FN = 'https://dxczwkbciseqniprspcu.supabase.co/functions/v1/recrutare-aplica'
const HR_TEL = '+40 722 146 845'
const HR_MAIL = 'natalia.udrea@gazpet.ro'
const C = { bg:'#f4f6f8', card:'#fff', text:'#1a2733', muted:'#5a6b7b', blue:'#0b4f8a', green:'#0b7a3b', border:'#cdd6de' }
const inp = { width:'100%', padding:'10px 12px', border:`1px solid ${C.border}`, borderRadius:8, fontSize:14, boxSizing:'border-box', background:'#fff', color:C.text }
const lbl = { display:'block', fontSize:12, fontWeight:600, margin:'12px 0 4px', color:'#3a4a5a', textTransform:'uppercase', letterSpacing:.3 }

export default function AplicaPublic() {
  const [pozitii, setPozitii] = useState(null)
  const [poz, setPoz] = useState('')
  const [stare, setStare] = useState(null)      // { tip:'ok'|'err', msg }
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    document.title = 'Aplică la Gazpet Instal'
    fetch(FN + '?format=json').then(r => r.json()).then(d => { const p = d.pozitii || []; setPozitii(p); if (p[0]) setPoz(String(p[0].id)) }).catch(() => setPozitii([]))
  }, [])

  const trimite = async (e) => {
    e.preventDefault()
    setBusy(true); setStare(null)
    try {
      const fd = new FormData(e.target)
      const r = await fetch(FN, { method:'POST', body: fd, headers: { Accept: 'application/json' } })
      const d = await r.json().catch(() => ({}))
      if (r.ok && d.ok) { setStare({ tip:'ok', msg:'✅ Aplicația a fost trimisă. Îți mulțumim! Te contactăm în cel mai scurt timp. / Your application was sent — thank you!' }); e.target.reset(); window.scrollTo(0, 0) }
      else setStare({ tip:'err', msg: d.error || 'A apărut o eroare la trimitere. Reîncearcă sau scrie la office@gazpet.ro.' })
    } catch (err) { setStare({ tip:'err', msg: 'Nu s-a putut trimite: ' + (err.message || err) }) }
    setBusy(false)
  }

  const descriere = (pozitii || []).find(p => String(p.id) === poz)?.descriere

  return (
    <div style={{ fontFamily:'system-ui, Segoe UI, Arial, sans-serif', background:C.bg, minHeight:'100vh', margin:0, padding:20, color:C.text }}>
      <div style={{ maxWidth:560, margin:'24px auto', background:C.card, borderRadius:12, boxShadow:'0 2px 14px #0002', padding:28 }}>
        <h1 style={{ fontSize:21, margin:'0 0 4px', color:C.blue }}>GAZPET INSTAL S.R.L.</h1>
        <div style={{ color:C.muted, fontSize:13, marginBottom:18 }}>Construcții conducte gaze naturale · Ploiești, Prahova</div>

        {stare && <div style={{ background: stare.tip === 'ok' ? '#e7f7ec' : '#fdeeee', border:`1px solid ${stare.tip === 'ok' ? '#b2e2c3' : '#f2c2c2'}`, color: stare.tip === 'ok' ? '#186a34' : '#a33', padding:12, borderRadius:8, fontSize:14, marginBottom:14 }}>{stare.msg}</div>}

        {pozitii === null ? <div style={{ color:C.muted, fontSize:14 }}>Se încarcă posturile…</div>
          : !pozitii.length ? <div style={{ fontSize:13, background:'#eef5fb', border:'1px solid #cfe3f5', borderRadius:8, padding:'10px 12px', color:'#28425c' }}>Momentan nu sunt posturi deschise. Revino curând!</div>
          : (
            <form onSubmit={trimite}>
              <label style={lbl}>Postul pentru care aplici / Position</label>
              <select name="pozitie_id" value={poz} onChange={e => setPoz(e.target.value)} required style={inp}>
                {pozitii.map(p => <option key={p.id} value={p.id}>{p.denumire}</option>)}
              </select>
              {descriere && <div style={{ fontSize:13, background:'#eef5fb', border:'1px solid #cfe3f5', borderRadius:8, padding:'10px 12px', color:'#28425c', marginTop:8, whiteSpace:'pre-wrap' }}>{descriere}</div>}
              <label style={lbl}>Nume și prenume / Full name *</label><input name="nume" required maxLength={120} style={inp} />
              <label style={lbl}>Telefon / Phone *</label><input name="telefon" required maxLength={30} style={inp} />
              <label style={lbl}>E-mail</label><input name="email" type="email" maxLength={120} style={inp} />
              <label style={lbl}>Localitatea / City</label><input name="oras" maxLength={80} style={inp} />
              <label style={lbl}>Mesaj / experiență pe scurt / Short message</label><textarea name="mesaj" rows={3} maxLength={2000} style={inp} />
              <label style={lbl}>CV (PDF sau Word, max 10 MB) *</label><input name="cv" type="file" accept=".pdf,.doc,.docx,.jpg,.png" required style={inp} />
              <div style={{ display:'flex', gap:8, alignItems:'flex-start', fontSize:12, color:C.muted, marginTop:14 }}>
                <input type="checkbox" name="gdpr" required id="g" style={{ marginTop:2 }} />
                <label htmlFor="g">Sunt de acord ca Gazpet Instal S.R.L. să îmi prelucreze datele personale și CV-ul în scop de recrutare, cu păstrare timp de 12 luni de la ultima interacțiune, conform GDPR. Pot cere oricând ștergerea datelor la office@gazpet.ro. / I agree that Gazpet Instal S.R.L. processes my personal data and CV for recruitment purposes (12-month retention, GDPR).</label>
              </div>
              <button type="submit" disabled={busy} style={{ marginTop:18, width:'100%', padding:13, background:C.green, color:'#fff', border:'none', borderRadius:8, fontSize:15, fontWeight:700, cursor:'pointer', opacity: busy ? .6 : 1 }}>{busy ? 'Se trimite…' : 'Trimite aplicația / Apply'}</button>
            </form>
          )}

        <div style={{ background:'#fff8e6', border:'1px solid #f1dfa6', borderRadius:8, padding:'10px 12px', fontSize:13, color:'#5a4a1a', marginTop:16 }}>
          📲 Preferi direct? Trimite CV-ul pe WhatsApp la <a href="https://wa.me/40722146845" style={{ color:C.blue, fontWeight:700, textDecoration:'none' }}>{HR_TEL}</a> sau pe e-mail la <a href={`mailto:${HR_MAIL}`} style={{ color:C.blue, fontWeight:700, textDecoration:'none' }}>{HR_MAIL}</a>. Te sunăm noi.
        </div>
        <div style={{ textAlign:'center', fontSize:11, color:'#8a99a8', marginTop:16 }}>gazpet.ro · datele sunt transmise securizat și vizibile doar echipei de recrutare</div>
      </div>
    </div>
  )
}
