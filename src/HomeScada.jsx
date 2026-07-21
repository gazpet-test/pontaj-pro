// HomeScada — corpul home-ului (todo #693, iterat cu Razvan 15.07.2026).
// Randat de HomeDashboard (App.jsx), care păstrează header-ul + footer-ul existente.
// Salut + grid module (filtrate deja pe acces în App.jsx, cifre LIVE din BD) +
// emblemă Gazpet (SVG inline, animație discretă). Schema SCADA a fost scoasă la
// review (15.07): „telemetria e prea mult" — sigla arată mai bine.
import React, { useEffect, useState } from 'react'
import { supabase } from './lib/supabase.js'

const GAZ = '#FF7A1A', GAZ2 = '#FFB067', APA = '#2FB6C9'
const T = { text:'#E8EEF5', muted:'#8395A7', dim:'#4E5E6E', line:'#1C2836' }

// ─── Cifre live per modul (sursă verificată în BD; eroare → null → „—") ───
const COUNT_DEFS = {
  '/panou':        { sub:'angajați activi',   q: s => s.from('employees').select('id',{count:'exact',head:true}).eq('active',true) },
  '/financiar':    { sub:`facturi ${new Date().getFullYear()}`, q: s => s.from('facturi_emise').select('id',{count:'exact',head:true}).eq('an',new Date().getFullYear()) },
  '/logistica':    { sub:'active în flotă',   q: s => s.from('logistica_active').select('id',{count:'exact',head:true}) },
  '/ofertare':     { sub:'proiecte ofertare', q: s => s.from('proiecte_ofertare').select('id',{count:'exact',head:true}) },
  '/magazie':      { sub:'poziții stoc',      q: s => s.from('stocuri').select('id',{count:'exact',head:true}) },
  '/comercial':    { sub:'contracte active',  q: s => s.from('contracte_terti').select('id',{count:'exact',head:true}).eq('status','activ') },
  '/achizitii':    { sub:'comenzi în curs',   q: s => s.from('comenzi_furnizor').select('id',{count:'exact',head:true}).not('status','in','("in_stoc","anulata","respinsa")') },
  '/ctc':          { sub:'documente CTC',     q: s => s.from('ctc_documente').select('id',{count:'exact',head:true}) },
  '/administrativ':{ sub:'documente firmă',   q: s => s.from('documente_firma').select('id',{count:'exact',head:true}) },
  '/hr':           { sub:'autorizații',       q: s => s.from('hr_autorizatii').select('id',{count:'exact',head:true}) },
  '/tichete':      { sub:'tichete deschise',  q: s => s.from('tichete').select('id',{count:'exact',head:true}).neq('status','inchis') },
  '/executie':     { sub:'proiecte active',   q: s => s.from('executie_proiecte').select('id',{count:'exact',head:true}).eq('activ',true) },
}

const CSS = `
  .hs-mgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(232px,1fr));gap:14px}
  .hs-mod{background:linear-gradient(160deg,#121C28,#0C121A);border:1px solid ${T.line};border-radius:15px;
    padding:17px 18px 15px;cursor:pointer;transition:transform .18s,border-color .18s,box-shadow .18s;position:relative;overflow:hidden}
  .hs-mod::before{content:'';position:absolute;top:0;left:0;right:0;height:2.5px;
    background:linear-gradient(90deg,var(--mc,${GAZ}),transparent 70%);opacity:.85}
  .hs-mod::after{content:'';position:absolute;inset:0;background:radial-gradient(240px 110px at 18% 0%,var(--mc,${GAZ})14,transparent);opacity:.7;pointer-events:none}
  .hs-mod:hover{transform:translateY(-4px);border-color:var(--mc,${GAZ});box-shadow:0 14px 34px #00000066}
  .hs-mod .go{margin-left:auto;color:${T.dim};font-size:14px;transition:all .18s}
  .hs-mod:hover .go{color:var(--mc,${GAZ});transform:translateX(3px)}
  .hs-flame{transform-origin:450px 118px;animation:hsflk 2.6s ease-in-out infinite}
  .hs-flame2{transform-origin:450px 122px;animation:hsflk 2.6s ease-in-out .9s infinite}
  @keyframes hsflk{0%,100%{transform:scale(1)}50%{transform:scale(1.045) translateY(-2px)}}
  .hs-wave{animation:hswv 7s ease-in-out infinite}
  @keyframes hswv{0%,100%{transform:translateX(0)}50%{transform:translateX(-14px)}}
`

// ─── Emblemă Gazpet: flacără + conductă + val (SVG inline, fără librării) ───
function GazpetEmblem() {
  return (
    <div style={{ marginTop:34, display:'flex', justifyContent:'center' }}>
      <svg viewBox="0 0 900 300" style={{ width:'min(680px, 92%)', height:'auto', display:'block' }} role="img" aria-label="Gazpet Instal">
        <defs>
          <linearGradient id="hs-gflame" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#B22F0B"/><stop offset=".45" stopColor={GAZ}/><stop offset="1" stopColor="#FFD34E"/>
          </linearGradient>
          <linearGradient id="hs-gpipe2" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#57697c"/><stop offset=".5" stopColor="#2c3948"/><stop offset="1" stopColor="#1a2430"/>
          </linearGradient>
          <linearGradient id="hs-gwave" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#12586A"/><stop offset=".5" stopColor={APA}/><stop offset="1" stopColor="#12586A"/>
          </linearGradient>
          <linearGradient id="hs-gtext" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={GAZ}/><stop offset="1" stopColor={GAZ2}/>
          </linearGradient>
          <radialGradient id="hs-gglow" cx=".5" cy=".45" r=".55">
            <stop offset="0" stopColor="#FF7A1A22"/><stop offset="1" stopColor="transparent"/>
          </radialGradient>
        </defs>

        <rect x="0" y="0" width="900" height="300" fill="url(#hs-gglow)"/>

        {/* flacăra (două straturi, pâlpâie discret) */}
        <g className="hs-flame">
          <path fill="url(#hs-gflame)" d="M450 34
            C463 62 492 76 492 112 C492 143 473 162 450 164
            C427 162 408 143 408 112 C408 90 424 78 430 60
            C434 72 441 78 447 84 C452 70 448 50 450 34 Z"/>
        </g>
        <g className="hs-flame2">
          <path fill="#FFE9A8" opacity=".9" d="M450 86
            C457 100 468 108 468 126 C468 143 459 152 450 153
            C441 152 432 143 432 126 C432 114 441 106 444 96
            C446 102 448 104 450 106 C452 98 449 92 450 86 Z"/>
        </g>

        {/* conducta orizontală cu flanșe */}
        <g>
          <rect x="150" y="168" width="600" height="34" rx="17" fill="url(#hs-gpipe2)" stroke="#5c7186" strokeWidth="1.4"/>
          <rect x="150" y="174" width="600" height="7" rx="3.5" fill="#8ea3b8" opacity=".35"/>
          {[230, 660].map(x => (
            <rect key={x} x={x} y="160" width="16" height="50" rx="3" fill="#3a4a5c" stroke="#5c7186" strokeWidth="1.2"/>
          ))}
          <circle cx="450" cy="185" r="26" fill="#141d27" stroke={GAZ} strokeWidth="2"/>
          <path d="M450 171 v28 M436 185 h28" stroke={GAZ} strokeWidth="3.5" strokeLinecap="round"/>
        </g>

        {/* valul (alunecă lent) */}
        <g className="hs-wave">
          <path fill="url(#hs-gwave)" opacity=".9" d="M120 232
            C190 210 260 254 330 232 C400 210 470 254 540 232
            C610 210 680 254 750 232 C785 221 800 226 814 232
            L814 258 C580 258 350 258 120 258 Z"/>
          <path fill={APA} opacity=".28" d="M120 244
            C200 226 280 262 360 244 C440 226 520 262 600 244
            C680 226 760 262 814 246 L814 262 L120 262 Z"/>
        </g>

        {/* wordmark */}
        <text x="450" y="296" textAnchor="middle" fontFamily="system-ui, -apple-system, sans-serif" fontWeight="800" fontSize="15" letterSpacing="10" fill={T.muted}>C O N S T R U C Ț I I &#160; C O N D U C T E &#160; G A Z</text>
        <text x="290" y="152" textAnchor="end" fontFamily="system-ui, -apple-system, sans-serif" fontWeight="900" fontSize="52" letterSpacing="2" fill="url(#hs-gtext)">GAZPET</text>
        <text x="612" y="152" textAnchor="start" fontFamily="system-ui, -apple-system, sans-serif" fontWeight="900" fontSize="52" letterSpacing="2" fill={APA}>INSTAL</text>
      </svg>
    </div>
  )
}

export default function HomeScada({ profile, modules, onOpen }) {
  const [counts, setCounts] = useState({})
  useEffect(() => {
    let dead = false
    ;(async () => {
      const paths = modules.map(m => m.path).filter(p => COUNT_DEFS[p])
      const res = await Promise.allSettled(paths.map(p => COUNT_DEFS[p].q(supabase)))
      if (dead) return
      const out = {}
      res.forEach((r, i) => { out[paths[i]] = (r.status === 'fulfilled' && !r.value.error) ? r.value.count : null })
      setCounts(out)
    })()
    return () => { dead = true }
  }, [modules])

  const prenume = profile?.name ? profile.name.split(' ')[0] : ''
  const azi = new Date().toLocaleDateString('ro-RO', { weekday:'long', day:'numeric', month:'long' })

  return (
    <div style={{ maxWidth:1480, margin:'0 auto', padding:'0 32px 40px', width:'100%', boxSizing:'border-box' }}>
      <style>{CSS}</style>
      {/* salut */}
      <div style={{ margin:'30px 2px 20px' }}>
        <div style={{ fontSize:30, fontWeight:800, letterSpacing:.3, color:T.text }}>
          Bună{prenume ? <>, <span style={{ color:GAZ }}>{prenume}</span></> : ''}! 👋
        </div>
        <div style={{ color:T.muted, fontSize:13, marginTop:5 }}>{azi.charAt(0).toUpperCase() + azi.slice(1)} · alege modulul cu care vrei să lucrezi</div>
        <div style={{ height:2, width:120, marginTop:14, borderRadius:2, background:`linear-gradient(90deg,${GAZ},${APA})`, boxShadow:'0 0 12px #ff7a1a55' }}/>
      </div>
      {/* intrare rapidă teren — manageri de șantier / șefi echipă (+ owner pt. test) */}
      {(profile?.is_owner || ['manager_santier','sef_echipa'].includes(profile?.role)) && (
        <div onClick={() => onOpen('/m')} style={{
          display:'flex', alignItems:'center', gap:14, cursor:'pointer', marginBottom:22,
          padding:'16px 20px', borderRadius:14, background:'linear-gradient(90deg,#E3B34118,#E3B34106)',
          border:'1px solid #E3B34140',
        }}>
          <div style={{ fontSize:30, flexShrink:0 }}>📋</div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontWeight:700, fontSize:15, color:T.text }}>Raport zilnic de lucrare</div>
            <div style={{ fontSize:12, color:T.muted, marginTop:2 }}>Versiunea de teren (mobil) — trimite raportul zilei de pe telefon. Adaug-o pe ecranul de start.</div>
          </div>
          <div style={{ fontSize:18, color:'#E3B341' }}>→</div>
        </div>
      )}
      {/* module */}
      <div className="hs-mgrid">
        {modules.map((m, i) => (
          <div key={i} className="hs-mod" style={{ '--mc': m.color }} onClick={() => m.path && onOpen(m.path)}>
            <div style={{ display:'flex', alignItems:'center', gap:11 }}>
              <div style={{ width:42, height:42, borderRadius:11, display:'flex', alignItems:'center', justifyContent:'center', fontSize:21, background:m.color+'1c', border:`1px solid ${m.color}3a`, flexShrink:0 }}>{m.icon}</div>
              <div style={{ fontWeight:700, fontSize:15, color:T.text }}>{m.label}</div>
              <div className="go">→</div>
            </div>
            <div style={{ display:'flex', alignItems:'baseline', gap:8, marginTop:13 }}>
              <div style={{ fontFamily:'monospace', fontSize:21, color:m.color }}>{counts[m.path] != null ? counts[m.path].toLocaleString('ro-RO') : '—'}</div>
              <div style={{ fontSize:10.5, color:T.muted }}>{COUNT_DEFS[m.path]?.sub || m.desc}</div>
            </div>
          </div>
        ))}
      </div>
      {/* emblemă */}
      <GazpetEmblem />
    </div>
  )
}
