// HomeScada — corpul home-ului (todo #693, mockup home_scada5.html aprobat 14.07.2026).
// Randat de HomeDashboard (App.jsx), care păstrează header-ul + footer-ul existente.
// Salut + grid module (filtrate deja pe acces în App.jsx, cifre LIVE din BD) +
// secțiunea „PROCES LIVE": schemă SCADA animată (doar vizual, fără funcție de business).
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './lib/supabase.js'

const GAZ = '#FF7A1A', GAZ2 = '#FFB067', APA = '#2FB6C9'
const T = { text:'#E8EEF5', muted:'#8395A7', dim:'#4E5E6E', line:'#1C2836', card:'#111A24' }

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
  .hs-pipe{stroke:#22313f;stroke-width:7;fill:none;stroke-linecap:round;transition:stroke .5s}
  .hs-pipe.on{stroke:url(#hsgpipe)}
  .hs-flow{stroke:#ffd9b0;stroke-width:2.6;fill:none;stroke-linecap:round;stroke-dasharray:3 14;opacity:0;transition:opacity .4s}
  .hs-flow.on{opacity:.95;animation:hsfl 1s linear infinite}
  @keyframes hsfl{to{stroke-dashoffset:-17}}
  .hs-valve{cursor:pointer}
  .hs-valve .body{fill:#1A2632;stroke:#33465a;stroke-width:1.4;transition:all .35s}
  .hs-valve.open .body{fill:#2b1608;stroke:${GAZ}}
  .hs-valve .disc{fill:${T.dim};transition:all .35s}
  .hs-valve.open .disc{fill:${GAZ};filter:drop-shadow(0 0 5px #ff7a1a99)}
  .hs-puff{fill:#cfe9f0;opacity:0}
  .hs-puff.on{animation:hspf 1.1s ease-out}
  @keyframes hspf{0%{opacity:.9;transform:translateY(0) scale(.6)}100%{opacity:0;transform:translateY(-26px) scale(1.7)}}
  .hs-blink{animation:hsbl 1.4s infinite}
  @keyframes hsbl{50%{opacity:.25}}
`

// ─── Graf conductă: [segment, nodA, nodB, robinet(e) | null] ───
const EDGES = [
  ['in','SRC','n1',null],
  ['s1m','n1','n2','HV-01+HV-03'], ['s1b','n1','n2','HV-02'],
  ['mid','n2','n3',null],
  ['s2m','n3','n4','HV-04+HV-06'], ['s2b','n3','n4','HV-05'],
  ['man','n4','M',null], ['ref','n4','VENT','HV-07'],
  ['spA','M','A0',null], ['spB','M','B0',null],
  ['a1','A0','A1','HV-09'], ['a2','A1','A2','HV-10'], ['a3','A2','A3',null],
  ['b1','B0','B1',null], ['b2','B1','B2','HV-08'], ['b3','B2','B3',null],
  ['x1','A1','B1','XC-1'], ['x2','A2','B2','XC-2'],
  ['oA','A3','OUT',null], ['oB','B3','OUT',null],
]
const SEG_D = {
  in:'M40 250 H105', s1m:'M105 250 H250', s1b:'M105 250 V185 H250 V250', mid:'M250 250 H305',
  s2m:'M305 250 H450', s2b:'M305 250 V185 H450 V250', man:'M450 250 H560', ref:'M505 250 V95',
  spA:'M560 250 V180 H625', spB:'M560 250 V320 H625',
  a1:'M625 180 H800', a2:'M800 180 H1140', a3:'M1140 180 H1262',
  b1:'M625 320 H800', b2:'M800 320 H1140', b3:'M1140 320 H1262',
  x1:'M800 180 V320', x2:'M1140 180 V320',
  oA:'M1262 180 V250 H1380', oB:'M1262 320 V250',
}
const VALVE_POS = {
  'HV-01':{x:127,y:250}, 'HV-02':{x:177,y:185}, 'HV-03':{x:233,y:250},
  'HV-04':{x:327,y:250}, 'HV-05':{x:377,y:185}, 'HV-06':{x:433,y:250},
  'HV-07':{x:505,y:170,vert:true},
  'HV-09':{x:700,y:180}, 'HV-10':{x:1040,y:180}, 'HV-08':{x:960,y:320},
  'XC-1':{x:800,y:250,vert:true}, 'XC-2':{x:1140,y:250,vert:true},
}
const VALVES_INIT = {
  'HV-01':true,'HV-02':false,'HV-03':true,'HV-04':true,'HV-05':false,'HV-06':true,
  'HV-07':false,'HV-08':true,'HV-09':true,'HV-10':true,'XC-1':false,'XC-2':false,
}

function ScadaSchema() {
  const [valves, setValves] = useState(VALVES_INIT)
  const [auto, setAuto] = useState(true)
  const [izoA, setIzoA] = useState(false)
  const [reads, setReads] = useState({ pl:40, po:38.2, qa:8200, qb:11600 })
  const [lines, setLines] = useState(['Sistem inițializat · regim 40 bar'])
  const [puff, setPuff] = useState(false)
  const autoRef = useRef(true); autoRef.current = auto
  const valvesRef = useRef(valves); valvesRef.current = valves

  const log = msg => setLines(prev => [`[${new Date().toLocaleTimeString('ro-RO')}] ${msg}`, ...prev].slice(0, 6))
  const toggle = (ids, who) => {
    setValves(prev => {
      const next = { ...prev }
      for (const id of [].concat(ids)) {
        next[id] = !next[id]
        // log cu starea NOUĂ (după comutare)
      }
      return next
    })
    for (const id of [].concat(ids)) log(`${id} → ${!valvesRef.current[id] ? 'DESCHIS' : 'ÎNCHIS'} · ${who === 'auto' ? 'comutare automată' : 'comandă manuală'}`)
  }

  // Automatizări (doar vizual) — toate cu cleanup la unmount
  useEffect(() => {
    const t1 = setInterval(() => { if (autoRef.current) toggle(['HV-01','HV-02','HV-03'], 'auto') }, 3000)
    let t2
    const t2d = setTimeout(() => { t2 = setInterval(() => { if (autoRef.current) toggle(['HV-04','HV-05','HV-06'], 'auto') }, 3000) }, 1500)
    const t3 = setInterval(() => { if (autoRef.current) toggle(['HV-08'], 'auto') }, 5000)
    const t4 = setInterval(() => {
      if (!autoRef.current || valvesRef.current['HV-07']) return
      toggle(['HV-07'], 'auto'); setPuff(true)
      setTimeout(() => { toggle(['HV-07'], 'auto'); setPuff(false) }, 800)
    }, 7000)
    return () => { clearInterval(t1); clearTimeout(t2d); if (t2) clearInterval(t2); clearInterval(t3); clearInterval(t4) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Presurizare + flux (recalculat la orice comutare)
  const { press, flowSet } = useMemo(() => {
    const gateOpen = g => !g || g.split('+').every(id => valves[id])
    const reach = from => {
      const seen = new Set([from]); let ok = true
      while (ok) { ok = false
        for (const [, a, b, gt] of EDGES) { if (!gateOpen(gt)) continue
          if (seen.has(a) && !seen.has(b)) { seen.add(b); ok = true }
          if (seen.has(b) && !seen.has(a)) { seen.add(a); ok = true }
        } }
      return seen
    }
    const press = reach('SRC'), fromOut = reach('OUT')
    const flowSet = new Set()
    for (const [id, a, b, gt] of EDGES) {
      const g = !gt || gt.split('+').every(x => valves[x])
      if (g && press.has(a) && press.has(b) && fromOut.has(a) && fromOut.has(b) && press.has('OUT')) flowSet.add(id)
      if (id === 'ref' && g && press.has(a)) flowSet.add(id)
    }
    return { press, flowSet }
  }, [valves])
  const segOn = (id) => {
    const e = EDGES.find(x => x[0] === id)
    const g = !e[3] || e[3].split('+').every(x => valves[x])
    return g && press.has(e[1]) && press.has(e[2])
  }

  // Ținte readouts din starea rețelei + zgomot la 600ms
  useEffect(() => {
    const aOn = press.has('OUT') && valves['HV-09'] && valves['HV-10'] && press.has('A0')
    const bOn = press.has('OUT') && valves['HV-08'] && press.has('B0')
    const tgt = { pl: press.has('M') ? 40 : press.has('n2') ? 39 : 0, po: (aOn||bOn) ? 38.2 : 0, qa: aOn ? 8200 : 0, qb: bOn ? 11600 : 0 }
    const nz = (v,a) => v ? v + (Math.random()*2-1)*a : 0
    const t = setInterval(() => setReads({ pl:nz(tgt.pl,.35), po:nz(tgt.po,.4), qa:Math.round(nz(tgt.qa,140)), qb:Math.round(nz(tgt.qb,170)) }), 600)
    return () => clearInterval(t)
  }, [valves, press])

  const rd = (k, v, unit, cy) => (
    <div style={{ background:'#0C141D', border:`1px solid ${T.line}`, borderRadius:9, padding:'8px 10px' }}>
      <div style={{ fontFamily:'monospace', fontSize:9, color:T.dim, letterSpacing:1, textTransform:'uppercase' }}>{k}</div>
      <div style={{ fontFamily:'monospace', fontSize:16, color: cy ? APA : GAZ2, marginTop:2 }}>{v}<small style={{ fontSize:9, color:T.muted }}> {unit}</small></div>
    </div>
  )
  const btn = { width:'100%', padding:10, borderRadius:9, border:`1px solid ${T.line}`, background:'#101a25', color:T.text, fontWeight:600, fontSize:12.5, cursor:'pointer' }

  return (
    <div style={{ display:'flex', gap:18, background:'linear-gradient(180deg,#0D1620,#0B121A)', border:`1px solid ${T.line}`, borderRadius:16, padding:18, flexWrap:'wrap' }}>
      <div style={{ flex:1, minWidth:520 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:6 }}>
          <div style={{ fontWeight:700, fontSize:14, letterSpacing:2, color:APA }}>CONDUCTĂ TRANSPORT GAZE</div>
          <div style={{ display:'inline-flex', alignItems:'center', gap:6, fontFamily:'monospace', fontSize:10, color:'#3FD68F' }}>
            <i className="hs-blink" style={{ width:7, height:7, borderRadius:'50%', background:'#3FD68F', boxShadow:'0 0 8px #3FD68F', display:'inline-block' }}/>TELEMETRIE ACTIVĂ
          </div>
        </div>
        <svg viewBox="0 0 1420 470" style={{ width:'100%', height:'auto', display:'block' }}>
          <defs>
            <linearGradient id="hsgpipe" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#B24E0B"/><stop offset=".5" stopColor="#FF7A1A"/><stop offset="1" stopColor="#B24E0B"/>
            </linearGradient>
          </defs>
          <text x="46" y="232" fontSize="10" fill={T.dim} textAnchor="middle" fontFamily="monospace">INTRARE</text>
          <polygon points="20,250 40,242 40,258" fill="#33465a"/>
          <text x="1372" y="232" fontSize="10" fill={T.dim} textAnchor="middle" fontFamily="monospace">CONSUM</text>
          <polygon points="1400,250 1380,242 1380,258" fill="#33465a"/>
          {Object.entries(SEG_D).map(([id, d]) => (
            <g key={id}>
              <path className={'hs-pipe' + (segOn(id) ? ' on' : '')} d={d}/>
              <path className={'hs-flow' + (flowSet.has(id) ? ' on' : '')} d={d}/>
            </g>
          ))}
          <rect x="150" y="222" width="66" height="56" rx="8" fill="#0F1A25" stroke="#2FB6C955"/>
          <text x="183" y="298" fontSize="11" fontWeight="600" fill={APA} textAnchor="middle">STAȚIA 1</text>
          <rect x="350" y="222" width="66" height="56" rx="8" fill="#0F1A25" stroke="#2FB6C955"/>
          <text x="383" y="298" fontSize="11" fontWeight="600" fill={APA} textAnchor="middle">STAȚIA 2</text>
          <rect x="497" y="72" width="16" height="24" rx="3" fill="#1A2632" stroke="#33465a"/>
          <circle className={'hs-puff' + (puff ? ' on' : '')} cx="505" cy="66" r="7"/>
          <circle className={'hs-puff' + (puff ? ' on' : '')} cx="512" cy="70" r="5"/>
          <text x="547" y="80" fontSize="10" fill={T.dim} textAnchor="middle" fontFamily="monospace">REFULATOR</text>
          <text x="700" y="163" fontSize="10" fill={GAZ} textAnchor="middle" fontFamily="monospace">LINIA A · Ø20"</text>
          <text x="700" y="345" fontSize="10" fill={APA} textAnchor="middle" fontFamily="monospace">LINIA B · Ø32"</text>
          {Object.entries(VALVE_POS).map(([id, v]) => (
            <g key={id} className={'hs-valve' + (valves[id] ? ' open' : '')} onClick={() => toggle([id], 'manual')}>
              <g transform={`translate(${v.x} ${v.y}) rotate(${v.vert ? 90 : 0})`}>
                <rect className="body" x="-14" y="-11" width="28" height="22" rx="4"/>
                <path className="disc" d="M-9 -6 L0 0 L-9 6 Z"/><path className="disc" d="M9 -6 L0 0 L9 6 Z"/>
              </g>
              <text x={v.x + (v.vert ? 24 : 0)} y={v.y + (v.vert ? 4 : (v.y < 200 ? -17 : 27))} fontSize="10" fill={T.muted} textAnchor="middle" fontFamily="monospace">{id}</text>
            </g>
          ))}
        </svg>
        {/* consolă */}
        <div style={{ marginTop:10, background:'#080D12', border:`1px solid ${T.line}`, borderRadius:10, padding:'9px 14px', fontFamily:'monospace', fontSize:11, height:96, overflow:'hidden' }}>
          {lines.map((l, i) => <div key={i} style={{ color:T.muted, lineHeight:1.7, whiteSpace:'nowrap' }}>{l}</div>)}
        </div>
      </div>
      {/* panou dreapta */}
      <div style={{ width:250, flexShrink:0, display:'flex', flexDirection:'column', gap:10 }}>
        <div style={{ background:T.card, border:`1px solid ${T.line}`, borderRadius:12, padding:'10px 12px', textAlign:'center' }}>
          <div style={{ fontFamily:'monospace', fontSize:10, color:T.muted, letterSpacing:2 }}>PRESIUNE LINIE</div>
          <svg viewBox="0 0 200 130" style={{ width:170, margin:'4px auto 0' }}>
            <path d="M25 115 A 88 88 0 1 1 175 115" fill="none" stroke={T.line} strokeWidth="12" strokeLinecap="round"/>
            <path d="M25 115 A 88 88 0 1 1 175 115" fill="none" stroke={GAZ} strokeWidth="12" strokeLinecap="round" strokeDasharray="276" strokeDashoffset="86" opacity=".55"/>
            <g transform={`rotate(${-120 + (Math.max(0, Math.min(60, reads.pl)) / 60) * 240} 100 112)`}>
              <line x1="100" y1="112" x2="100" y2="34" stroke={T.text} strokeWidth="3" strokeLinecap="round"/>
              <circle cx="100" cy="112" r="7" fill={T.text}/>
            </g>
            <text x="100" y="102" textAnchor="middle" fontFamily="monospace" fontSize="21" fill={GAZ2}>{reads.pl.toFixed(1)}</text>
            <text x="100" y="126" textAnchor="middle" fontFamily="monospace" fontSize="9" fill={T.muted}>bar · 0–60</text>
          </svg>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
          {rd('P linie', reads.pl.toFixed(1), 'bar')}
          {rd('P ieșire', reads.po.toFixed(1), 'bar')}
          {rd('Debit A', reads.qa.toLocaleString('ro-RO'), 'Sm³/h', true)}
          {rd('Debit B', reads.qb.toLocaleString('ro-RO'), 'Sm³/h', true)}
        </div>
        {rd('Debit total', (reads.qa + reads.qb).toLocaleString('ro-RO'), 'Sm³/h')}
        <button style={btn} onClick={() => { setAuto(a => !a); log(`Comutare automată ${!auto ? 'PORNITĂ' : 'OPRITĂ'}`) }}>
          {auto ? '⏸ AUTOMAT: ON' : '▶ AUTOMAT: OFF'}
        </button>
        <button style={{ ...btn, borderColor: izoA ? GAZ : '#5a2a2a', color: izoA ? GAZ2 : T.text }} onClick={() => {
          const closing = !izoA
          setIzoA(closing)
          setValves(prev => ({ ...prev, 'HV-09': !closing, 'HV-10': !closing }))
          log(closing ? 'LINIA A izolată manual (HV-09 + HV-10 închise)' : 'LINIA A repusă în funcțiune')
        }}>{izoA ? '🔓 REPUNE LINIA A' : '🔒 IZOLEAZĂ LINIA A'}</button>
      </div>
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
      {/* proces live */}
      <div style={{ margin:'28px 2px 12px', fontWeight:700, fontSize:15, letterSpacing:2, color:APA }}>PROCES LIVE</div>
      <ScadaSchema />
    </div>
  )
}
