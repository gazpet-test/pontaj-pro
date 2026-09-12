// ════════════════════════════════════════════════════════════════
// OfertarePropunere.jsx — „📑 Propunere tehnică": matricea de conformitate + poarta
//
// De ce există: la licitațiile de distribuție gaze nu se pierde pe preț, se pierde pe formă.
// Din 41 de licitații de distribuție din arhivă, 21 sunt marcate „NU." = n-am participat.
// Modulul ăsta nu e un editor de text — e o listă pe care nu poți s-o închizi mințind:
// fiecare cerință de tip „propunere" sau „formă" trebuie să iasă undeva (capitol / dovadă în
// registru / excepție cu motiv scris), altfel semaforul stă roșu.
//
// DOUĂ REGULI care au omorât prima variantă a modulului:
//
// 1. NU se scrie NICIODATĂ în ofertare_cerinte. Câmpul stare='nu_se_aplica' de acolo e verdictul
//    omului pe ACOPERIRE (citit de AcoperireSection și de v_ofertare_dashboard). Dacă modulul ăsta
//    ar folosi același bit, o singură acțiune în bloc ar stinge acoperiri deja probate — 235 doar
//    pe licitația 3. Excepția de propunere are rândul ei: ofertare_pt_legaturi.fel='exceptat'.
//
// 2. Semaforul nu poate da verde din lipsă de date. 68 din 73 de licitații n-au nicio cerință;
//    `poarta.some(r => r.stare==='block')` pe un array gol e false, adică VERDE pe un dosar necitit.
//    De aceea rândul 1 (cuprins inexistent) e BLOCK din start, iar v_ofertare_pt_stare întoarce
//    un rând pentru toate cele 73 de licitații, nu doar pentru cele cu cerințe.
// ════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo } from 'react'
import { supabase } from './lib/supabase.js'

const G = { bg:'#0D1117', surface:'#161B22', card:'#1C2128', border:'#30363D', border2:'#21262D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  ofertare:'#3FB6E2', green:'#3FB950', blue:'#58A6FF', orange:'#F0883E',
  yellow:'#E3B341', red:'#F85149', purple:'#A371F7', teal:'#2DD4BF' }
const S = {
  input: { width:'100%', boxSizing:'border-box', background:G.bg, border:`1px solid ${G.border2}`, borderRadius:6, padding:'8px 12px', color:G.text, fontSize:13, outline:'none' },
  lbl: { display:'block', fontSize:11, color:G.muted, marginBottom:4, fontWeight:600, textTransform:'uppercase', letterSpacing:'.3px' },
  btnP: { padding:'9px 18px', background:G.ofertare, color:'#0D1117', border:'none', borderRadius:7, cursor:'pointer', fontSize:13, fontWeight:700 },
  btnS: { padding:'9px 18px', background:G.surface, color:G.text, border:`1px solid ${G.border2}`, borderRadius:7, cursor:'pointer', fontSize:13 },
  card: { background:G.card, border:`1px solid ${G.border}`, borderRadius:10 },
}

// Cuprinsul stă în JS, nu în migrare: titlurile variază de la o autoritate la alta și se editează
// per licitație, fără să ceară migrare.
//
// Lista de mai jos e COPIATĂ din formularul real depus de Gazpet — „Formular Propunere tehnica
// Stefan cel Mare.docx" (SCN1146660, depusă 16.05.2024), din arhiva de pe Drive, la
// Calificare\model propuneri tehnice. Nu e o listă inventată: e formularul-cadru ANAP așa cum
// îl completează biroul de ofertare.
//
// `formular` e null peste tot INTENȚIONAT. În documentul citit apar doar „Formular 11" și
// „Formular 12", și nici alea legate clar de un capitol anume. Numerele de formular se iau din
// fișa de date a fiecărei licitații, nu se presupun.
//
// ATENȚIE, lista asta NU e „cuprinsul standard". E cuprinsul UNUI formular ANAP, cel folosit la o
// licitație Transgaz. Opisul propunerii depuse la Contești (distribuție gaze, 1144 pag.) spune
// negru pe alb: „Propunere Tehnică respecta capitolele din Fisa de date si cap9 pct 9.1". Acolo
// structura e cu totul alta — Secțiunea A (Cap. I-VI) + Secțiunea B, Planul calității (Cap. I-III)
// + ~20 de anexe, cu Graficul Gantt ca anexă, depus și PDF și Excel separat. Deci: punct de
// pornire pentru licitațiile pe formular ANAP, niciodată implicit tăcut pentru restul.
const CAPITOLE_ANAP = [
  { nr:1,  titlu:'Rezumat', obligatoriu:true, formular:null },
  { nr:2,  titlu:'Metodologia de executarea lucrărilor', obligatoriu:true, formular:null },
  { nr:3,  titlu:'Planul de management al calității în cadrul Contractului', obligatoriu:true, formular:null },
  { nr:4,  titlu:'Grafic general de realizare a investiției (fizic)', obligatoriu:true, formular:null },
  { nr:5,  titlu:'Personalul propus și managementul contractului pentru execuția lucrărilor', obligatoriu:true, formular:null },
  { nr:6,  titlu:'Infrastructura care va fi utilizată în realizarea activităților în cadrul Contractului', obligatoriu:true, formular:null },
  { nr:7,  titlu:'Modalitatea de efectuare a înregistrărilor și înregistrările efectuate în legătură cu indicatorii cantitativi și calitativi asociați execuției lucrărilor', obligatoriu:true, formular:null },
  { nr:8,  titlu:'Măsuri aplicabile de Ofertant pe perioada Contractului pentru asigurarea îndeplinirii obligațiilor din domeniul mediului', obligatoriu:true, formular:null },
  { nr:9,  titlu:'Măsuri aplicabile de Ofertant pe perioada Contractului pentru asigurarea îndeplinirii obligațiilor din domeniul social și al relațiilor de muncă', obligatoriu:true, formular:null },
  { nr:10, titlu:'Măsuri aplicate de Ofertant pentru supravegherea lucrărilor în perioada de garanție acordată', obligatoriu:true, formular:null },
  { nr:11, titlu:'Informații în legătură cu echipamentele incluse în lucrare după expirarea perioadei de garanție', obligatoriu:true, formular:null },
  { nr:12, titlu:'Adecvarea la constrângerile fizice impuse de amplasamentul lucrării', obligatoriu:true, formular:null },
  { nr:13, titlu:'Anexe la Propunerea Tehnică', obligatoriu:false, formular:null },
  { nr:14, titlu:'Orice alte informații relevante pentru demonstrarea conformității propunerii tehnice raportat la Cerințele Beneficiarului', obligatoriu:false, formular:null },
  { nr:15, titlu:'ASPECTE TEHNICE OFERTATE SUPLIMENTAR FAȚĂ DE CERINȚELE MINIME ALE DOCUMENTAȚIEI DE ATRIBUIRE', obligatoriu:false, formular:null },
]

// ATENȚIE: identic, caracter cu caracter, cu regexul din v_ofertare_pt_stare.
// Dacă cele două diferă, bannerul spune 15 capcane și lista arată 12.
const RX_CAPCANA = /(respins|neconform|descalific|inacceptabil|sub sanc[tț]iune|f[aă]r[aă] (posibilitatea de a solicita )?clarific|nu se accept)/i

const fmtZi = d => d ? new Date(d.length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('ro-RO') : '—'
const zileRamase = t => { if (!t) return null; const ms = new Date(t) - new Date(); return Math.ceil(ms / 86400000) }

// ─────────────────────────────────────────────────────────────────
// POARTA — 7 rânduri. Niciunul nu se sare, niciunul nu tace.
// ─────────────────────────────────────────────────────────────────
function PoartaPT({ st, onFiltru }) {
  const randuri = useMemo(() => {
    // st null = încă se încarcă. NU întoarcem array gol: un array gol înseamnă „nimic de blocat",
    // adică exact verdele fals din care s-a născut regula 2 din antet.
    if (!st) return null
    const r = []
    r.push({
      k:'cuprins', titlu:'Cuprinsul propunerii',
      stare: st.capitole > 0 ? 'ok' : 'block',
      detalii: st.capitole > 0 ? `${st.capitole} capitole` : 'niciun capitol — cuprinsul se ia din fișa de date, cap. 9 pct. 9.1',
    })
    r.push({
      k:'fara', titlu:'Cerințe fără capitol',
      stare: st.fara_capitol > 0 ? 'block' : 'ok',
      detalii: `${st.fara_capitol} din ${st.de_raspuns}` + (st.inchise_cu_dovada > 0 ? ` · ${st.inchise_cu_dovada} sunt închise cu dovadă în registru, nu cer capitol` : ''),
      filtru: 'fara',
    })
    r.push({
      k:'capcane', titlu:'Capcane de respingere descoperite',
      stare: st.capcane_descoperite > 0 ? 'block' : 'ok',
      detalii: st.capcane > 0
        ? `${st.capcane_descoperite} din ${st.capcane} cerințe cu clauză de respingere · găsite de regex — verifică textul`
        : 'nicio clauză de respingere găsită în cerințe',
      filtru: 'capcane',
    })
    r.push({
      k:'goale', titlu:'Capitole obligatorii goale',
      stare: st.capitole === 0 ? 'warn' : (st.capitole_goale > 0 ? 'block' : 'ok'),
      detalii: st.capitole === 0 ? '— (se aprinde după ce creezi cuprinsul)' : `${st.capitole_goale} capitole fără conținut și fără fișier`,
    })
    r.push({
      k:'nu_e_cazul', titlu:'„nu este cazul" în capitole',
      // WARN, nu BLOCK: formularul real depus la Ștefan cel Mare îl folosește de 3 ori. Îl interzice
      // explicit doar o parte din autorități (ex. Fința). Un block universal ar fi fals și ar învăța
      // omul să ocolească semaforul.
      stare: st.capitole_nu_e_cazul > 0 ? 'warn' : 'ok',
      detalii: st.capitole_nu_e_cazul > 0
        ? `${st.capitole_nu_e_cazul} capitole conțin „nu este cazul" — verifică fișa de date: unele autorități îl interzic explicit`
        : '0',
    })
    r.push({
      k:'docs', titlu:'Documentația de atribuire citită integral',
      stare: st.documente === 0 ? 'block' : (st.documente_necitite > 0 ? 'warn' : 'ok'),
      detalii: st.documente === 0
        ? 'niciun document încărcat — cerințele nu pot exista'
        : `${st.documente} documente` + (st.documente_necitite > 0 ? `, ${st.documente_necitite} necitite sau cu eroare — cerințele pot veni dintr-un corpus incomplet` : ', toate citite'),
    })
    r.push({
      k:'grafic', titlu:'Cap. 4 Grafic — versiune înghețată',
      stare: st.grafic_versiune ? 'ok' : 'warn',
      detalii: st.grafic_versiune ? `versiunea ${st.grafic_versiune}` : 'nicio versiune generată în grafic_versiuni',
    })
    return r
  }, [st])

  if (!randuri) return <div style={{ color:G.muted, fontSize:13, padding:12 }}>Se încarcă poarta…</div>

  const cul = s => s === 'block' ? G.red : s === 'warn' ? G.orange : G.green
  const ico = s => s === 'block' ? '⛔' : s === 'warn' ? '⚠️' : '✓'

  return (
    <div style={{ ...S.card, overflow:'hidden' }}>
      {randuri.map((r, i) => (
        <div key={r.k}
          onClick={r.filtru ? () => onFiltru?.(r.filtru) : undefined}
          style={{ display:'flex', gap:10, alignItems:'flex-start', padding:'10px 14px',
            borderTop: i ? `1px solid ${G.border2}` : 'none',
            cursor: r.filtru ? 'pointer' : 'default' }}>
          <span style={{ color:cul(r.stare), fontSize:14, lineHeight:'18px', width:18 }}>{ico(r.stare)}</span>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:13, fontWeight:600, color:G.text }}>
              {r.titlu}
              {r.filtru && <span style={{ color:G.dim, fontSize:11, fontWeight:400 }}> — click pentru listă</span>}
            </div>
            <div style={{ fontSize:12, color:G.muted, marginTop:2 }}>{r.detalii}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// MATRICEA — cerințele, cu filtre și cele două acțiuni în bloc
// ─────────────────────────────────────────────────────────────────
function MatriceCerinte({ cerinte, legaturi, capitole, dovedite, filtru, setFiltru, sel, setSel, onAtribuie, onExcepta, busy }) {
  const [capSel, setCapSel] = useState('')
  const [motiv, setMotiv] = useState('')

  const legPe = useMemo(() => {
    const m = new Map()
    for (const l of legaturi) {
      if (!m.has(l.cerinta_id)) m.set(l.cerinta_id, [])
      m.get(l.cerinta_id).push(l)
    }
    return m
  }, [legaturi])

  const lista = useMemo(() => cerinte.filter(c => {
    const ls = legPe.get(c.id) || []
    const areCap = ls.some(l => l.fel === 'capitol')
    const exceptat = ls.some(l => l.fel === 'exceptat')
    const cuDovada = dovedite.has(c.id)
    if (filtru === 'fara')    return !areCap && !exceptat && !cuDovada
    if (filtru === 'capcane') return RX_CAPCANA.test(c.text_cerinta || '') && !areCap && !exceptat
    if (filtru === 'forma')   return c.tip === 'forma'
    if (filtru === 'dovada')  return cuDovada && !areCap && !exceptat
    if (filtru === 'gata')    return areCap || exceptat
    return true
  }), [cerinte, legPe, dovedite, filtru])

  const CHIPS = [
    ['fara',    'fără capitol'],
    ['capcane', '🚫 capcane'],
    ['forma',   'de formă'],
    ['dovada',  'închise cu dovadă'],
    ['gata',    'rezolvate'],
    ['',        'toate'],
  ]
  const toggle = id => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  return (
    <div>
      <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:10, alignItems:'center' }}>
        {CHIPS.map(([k, lab]) => (
          <button key={k} onClick={() => { setFiltru(k); setSel(new Set()) }}
            style={{ padding:'5px 12px', border:'none', borderRadius:20, cursor:'pointer', fontSize:12, fontWeight:600,
              background: filtru === k ? G.ofertare + '22' : G.surface,
              color: filtru === k ? G.ofertare : G.muted }}>{lab}</button>
        ))}
        <span style={{ marginLeft:'auto', color:G.muted, fontSize:12 }}>{lista.length} cerințe</span>
      </div>

      {sel.size > 0 && (
        <div style={{ ...S.card, padding:12, marginBottom:10, borderColor:G.ofertare + '55' }}>
          <div style={{ fontSize:12, color:G.text, fontWeight:600, marginBottom:8 }}>{sel.size} selectate</div>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
            <select value={capSel} onChange={e => setCapSel(e.target.value)} style={{ ...S.input, width:'auto', minWidth:260 }}>
              <option value="">— alege capitolul —</option>
              {capitole.map(c => <option key={c.id} value={c.id}>{c.nr}. {c.titlu}</option>)}
            </select>
            <button disabled={!capSel || busy} onClick={() => { onAtribuie(Number(capSel)); setCapSel('') }}
              style={{ ...S.btnP, opacity: (!capSel || busy) ? .5 : 1 }}>→ atribuie capitolului</button>
          </div>
          <div style={{ display:'flex', gap:8, marginTop:8, alignItems:'center' }}>
            <input value={motiv} onChange={e => setMotiv(e.target.value)} placeholder="motivul excepției (obligatoriu)" style={{ ...S.input, flex:1 }} />
            <button disabled={!motiv.trim() || busy} onClick={() => { onExcepta(motiv.trim()); setMotiv('') }}
              style={{ ...S.btnS, opacity: (!motiv.trim() || busy) ? .5 : 1, borderColor:G.orange + '55', color:G.orange }}>
              ⊘ nu se aplică la propunere
            </button>
          </div>
          <div style={{ fontSize:11, color:G.dim, marginTop:6 }}>
            Excepția e doar pentru propunerea tehnică. Nu atinge registrul de cerințe și acoperire.
          </div>
        </div>
      )}

      <div style={{ ...S.card, overflow:'hidden' }}>
        {lista.length === 0 && <div style={{ padding:16, color:G.muted, fontSize:13 }}>Nicio cerință pe filtrul ăsta.</div>}
        {lista.map((c, i) => {
          const ls = legPe.get(c.id) || []
          const cap = ls.find(l => l.fel === 'capitol')
          const exc = ls.find(l => l.fel === 'exceptat')
          const capcana = RX_CAPCANA.test(c.text_cerinta || '')
          const capNr = cap && capitole.find(k => k.id === cap.capitol_id)
          return (
            <div key={c.id} style={{ display:'flex', gap:10, padding:'10px 12px', borderTop: i ? `1px solid ${G.border2}` : 'none' }}>
              <input type="checkbox" checked={sel.has(c.id)} onChange={() => toggle(c.id)} style={{ marginTop:3 }} />
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:3 }}>
                  <span style={{ fontSize:11, color:G.dim }}>#{c.nr_ordine ?? c.id}</span>
                  <span style={{ fontSize:11, color: c.tip === 'forma' ? G.purple : G.blue }}>{c.tip}</span>
                  {c.sursa_sectiune && <span style={{ fontSize:11, color:G.dim }}>{c.sursa_sectiune}{c.sursa_pagina ? ` p.${c.sursa_pagina}` : ''}</span>}
                  {capcana && <span style={{ fontSize:11, color:G.red, fontWeight:700 }}>🚫 CAPCANĂ</span>}
                  {dovedite.has(c.id) && !cap && !exc && <span style={{ fontSize:11, color:G.teal }}>✓ dovadă în registru</span>}
                  {capNr && <span style={{ fontSize:11, color:G.green, fontWeight:600 }}>→ cap. {capNr.nr}</span>}
                  {exc && <span style={{ fontSize:11, color:G.orange }} title={exc.motiv}>⊘ exceptată</span>}
                </div>
                <div style={{ fontSize:13, color:G.text, lineHeight:1.45 }}>{c.text_cerinta}</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// CUPRINSUL — capitolele licitației
// ─────────────────────────────────────────────────────────────────
function CuprinsCapitole({ capitole, numarPeCapitol, onCreeaza, busy }) {
  if (capitole.length === 0) {
    return (
      <div style={{ ...S.card, padding:16, textAlign:'center' }}>
        <div style={{ color:G.muted, fontSize:13, marginBottom:10 }}>
          Propunerea n-are încă niciun capitol. Cuprinsul NU e același la toate licitațiile: se ia din fișa de
          date, cap. 9 pct. 9.1. Butonul de mai jos pune formularul ANAP (15 capitole), folosit la Transgaz —
          la distribuție gaze structura e alta (Secțiuni A/B, capitole cu cifre romane, anexe). Editează după.
        </div>
        <button onClick={onCreeaza} disabled={busy} style={{ ...S.btnP, opacity: busy ? .5 : 1 }}>
          📋 Pornește de la formularul ANAP (15 capitole)
        </button>
      </div>
    )
  }
  return (
    <div style={{ ...S.card, overflow:'hidden' }}>
      {capitole.map((c, i) => {
        const n = numarPeCapitol.get(c.id) || 0
        const gol = !String(c.continut || '').trim() && !String(c.fisier_path || '').trim()
        return (
          <div key={c.id} style={{ display:'flex', gap:10, alignItems:'center', padding:'9px 14px', borderTop: i ? `1px solid ${G.border2}` : 'none' }}>
            <span style={{ width:24, color:G.dim, fontSize:12 }}>{c.nr}.</span>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:13, color:G.text }}>
                {c.titlu}
                {c.formular && <span style={{ color:G.purple, fontSize:11, marginLeft:6 }}>{c.formular}</span>}
                {!c.obligatoriu && <span style={{ color:G.dim, fontSize:11, marginLeft:6 }}>opțional</span>}
              </div>
            </div>
            <span style={{ fontSize:12, color: n ? G.green : G.dim }}>{n} cerințe</span>
            <span style={{ fontSize:11, color: gol && c.obligatoriu ? G.red : G.dim, width:64, textAlign:'right' }}>
              {gol ? 'gol' : 'scris'}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// REZUMATUL din fișa licitației (tab)
// ─────────────────────────────────────────────────────────────────
export function PropunereRezumat({ st, onDeschide }) {
  if (!st) return <div style={{ color:G.muted, fontSize:13, padding:12 }}>Se încarcă…</div>
  const blocat = st.capitole === 0 || st.fara_capitol > 0 || st.capcane_descoperite > 0 || st.documente === 0
  return (
    <div style={{ padding:'4px 0' }}>
      <div style={{ ...S.card, padding:14, borderColor: blocat ? G.red + '55' : G.green + '55', marginBottom:12 }}>
        <div style={{ fontSize:14, fontWeight:700, color: blocat ? G.red : G.green, marginBottom:6 }}>
          {blocat ? '🔴 NU se depune' : '🟢 Poarta e deschisă'}
        </div>
        <div style={{ fontSize:13, color:G.muted, lineHeight:1.6 }}>
          {st.de_raspuns} cerințe de răspuns ({st.de_raspuns - st.de_forma} propunere + {st.de_forma} formă) ·{' '}
          <b style={{ color: st.cu_capitol ? G.green : G.red }}>{st.cu_capitol} au capitol</b>
          {st.inchise_cu_dovada > 0 && <> · {st.inchise_cu_dovada} închise cu dovadă în registru</>}
          {st.capcane > 0 && <> · <b style={{ color:G.red }}>{st.capcane_descoperite} din {st.capcane} capcane de respingere, descoperite</b></>}
          {st.capitole === 0 && <> · cuprinsul propunerii nu e creat</>}
        </div>
      </div>
      <button onClick={onDeschide} style={S.btnP}>📑 Deschide matricea propunerii</button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// PANOUL
// ─────────────────────────────────────────────────────────────────
export default function PropunerePanel({ licitatii = [], showToast, initialLicId = null, onInapoi = null }) {
  const [licId, setLicId] = useState(initialLicId || (licitatii[0] && licitatii[0].id) || null)
  const [st, setSt] = useState(null)
  const [capitole, setCapitole] = useState([])
  const [cerinte, setCerinte] = useState([])
  const [legaturi, setLegaturi] = useState([])
  const [dovedite, setDovedite] = useState(new Set())
  const [filtru, setFiltru] = useState('fara')
  const [sel, setSel] = useState(new Set())
  const [busy, setBusy] = useState(false)
  const [eroare, setEroare] = useState(null)

  const lic = licitatii.find(l => String(l.id) === String(licId)) || null

  const load = async (id) => {
    if (!id) return
    setEroare(null)
    // Filtrele trebuie să fie IDENTICE cu cele din v_ofertare_pt_stare, altfel poarta
    // numără altceva decât arată lista. limit(5000): PostgREST taie implicit la 1000.
    const [rSt, rCap, rCer] = await Promise.all([
      supabase.from('v_ofertare_pt_stare').select('*').eq('licitatie_id', id).maybeSingle(),
      supabase.from('ofertare_pt_capitole').select('*').eq('licitatie_id', id).order('nr'),
      supabase.from('ofertare_cerinte')
        .select('id, nr_ordine, text_cerinta, tip, sursa_sectiune, sursa_pagina')
        .eq('licitatie_id', id).in('tip', ['propunere','forma'])
        .is('inlocuita_de', null).is('duplicat_al', null)
        .order('nr_ordine').limit(5000),
    ])
    const err = rSt.error || rCap.error || rCer.error
    if (err) { setEroare(err.message); showToast?.('Nu s-au putut încărca datele: ' + err.message, 'err'); return }
    const cer = rCer.data || []
    setSt(rSt.data || null); setCapitole(rCap.data || []); setCerinte(cer)

    const ids = cer.map(c => c.id)
    if (ids.length) {
      const [rLeg, rAcop] = await Promise.all([
        supabase.from('ofertare_pt_legaturi').select('id, cerinta_id, capitol_id, fel, motiv').in('cerinta_id', ids).limit(10000),
        supabase.from('ofertare_acoperire').select('cerinta_id').in('cerinta_id', ids).in('status', ['acoperit','acoperit_partener']).limit(10000),
      ])
      if (rLeg.error || rAcop.error) {
        const m = (rLeg.error || rAcop.error).message
        setEroare(m); showToast?.('Legăturile nu s-au putut citi: ' + m, 'err'); return
      }
      setLegaturi(rLeg.data || [])
      setDovedite(new Set((rAcop.data || []).map(a => a.cerinta_id)))
    } else { setLegaturi([]); setDovedite(new Set()) }
  }

  // showToast și load NU intră în deps: lecția casei (useCallback/useEffect cu showToast = loop infinit).
  useEffect(() => { setSel(new Set()); load(licId) }, [licId])

  const numarPeCapitol = useMemo(() => {
    const m = new Map()
    for (const l of legaturi) if (l.fel === 'capitol') m.set(l.capitol_id, (m.get(l.capitol_id) || 0) + 1)
    return m
  }, [legaturi])

  // Crearea cuprinsului e BUTON, nu useEffect: în StrictMode efectul rulează de două ori
  // și ar insera de două ori. UNIQUE(licitatie_id, nr) e plasa de siguranță.
  const creeazaCuprins = async () => {
    if (!licId) return
    setBusy(true)
    const { error } = await supabase.from('ofertare_pt_capitole')
      .insert(CAPITOLE_ANAP.map(c => ({ ...c, licitatie_id: licId })))
    setBusy(false)
    if (error && error.code !== '23505') { showToast?.('Cuprinsul nu s-a creat: ' + error.message, 'err'); return }
    if (error) showToast?.('Cuprinsul exista deja.', 'ok')
    else showToast?.(`Cuprinsul ANAP a fost creat (${CAPITOLE_ANAP.length} capitole). Verifică-l pe fișa de date, cap. 9 pct. 9.1.`, 'ok')
    await load(licId)
  }

  const atribuie = async (capitolId) => {
    if (!sel.size || !capitolId) return
    setBusy(true)
    const { error } = await supabase.from('ofertare_pt_legaturi')
      .upsert([...sel].map(id => ({ cerinta_id: id, capitol_id: capitolId, fel: 'capitol', sursa: 'om' })),
        { onConflict: 'cerinta_id,capitol_id' })
    setBusy(false)
    if (error) { showToast?.('Atribuirea a eșuat: ' + error.message, 'err'); return }
    showToast?.(`${sel.size} cerințe atribuite.`, 'ok')
    setSel(new Set()); await load(licId)
  }

  // Scrie DOAR în ofertare_pt_legaturi. Niciun .update() pe ofertare_cerinte — vezi regula 1.
  const excepta = async (motiv) => {
    if (!sel.size || !motiv) return
    setBusy(true)
    const { error } = await supabase.from('ofertare_pt_legaturi')
      .insert([...sel].map(id => ({ cerinta_id: id, capitol_id: null, fel: 'exceptat', motiv, sursa: 'om' })))
    setBusy(false)
    if (error) { showToast?.('Excepția a eșuat: ' + error.message, 'err'); return }
    showToast?.(`${sel.size} cerințe exceptate de la propunere.`, 'ok')
    setSel(new Set()); await load(licId)
  }

  const semneaza = async () => {
    if (!licId) return
    setBusy(true)
    // Se recitește starea din BD, nu din state: între încărcare și apăsare se poate schimba.
    const { data: proaspat, error: e1 } = await supabase.from('v_ofertare_pt_stare').select('*').eq('licitatie_id', licId).maybeSingle()
    if (e1 || !proaspat) { setBusy(false); showToast?.('Nu s-a putut reciti starea.', 'err'); return }
    const blocat = proaspat.capitole === 0 || proaspat.fara_capitol > 0 || proaspat.capcane_descoperite > 0
      || proaspat.documente === 0 || proaspat.capitole_goale > 0
    if (blocat) { setBusy(false); setSt(proaspat); showToast?.('Între timp s-a redeschis un rând roșu. Nu se semnează.', 'err'); return }
    const versiune = (proaspat.pt_versiune || 0) + 1
    const { error } = await supabase.from('ofertare_pt_poarta').insert({
      licitatie_id: licId, versiune, verdict: proaspat.documente_necitite > 0 || !proaspat.grafic_versiune ? 'galben' : 'verde',
      snapshot: proaspat,
    })
    setBusy(false)
    if (error) {
      if (error.code === '23505') { showToast?.('Altcineva a semnat între timp. Reîncarc.', 'err'); await load(licId); return }
      showToast?.('Semnarea a eșuat: ' + error.message, 'err'); return
    }
    showToast?.(`Propunerea marcată gata de depus (versiunea ${versiune}).`, 'ok')
    await load(licId)
  }

  const blocat = !st || st.capitole === 0 || st.fara_capitol > 0 || st.capcane_descoperite > 0
    || st.documente === 0 || st.capitole_goale > 0
  const zile = zileRamase(lic?.termen_depunere)

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
        {onInapoi && <button onClick={onInapoi} style={S.btnS}>← Înapoi la fișă</button>}
        <select value={licId || ''} onChange={e => setLicId(Number(e.target.value))} style={{ ...S.input, width:'auto', minWidth:340 }}>
          {licitatii.map(l => <option key={l.id} value={l.id}>{l.obiect || l.nr_anunt || `Licitația ${l.id}`}</option>)}
        </select>
        {lic?.termen_depunere && (
          <span style={{ fontSize:12, color: zile != null && zile <= 14 ? G.red : G.muted }}>
            termen {fmtZi(lic.termen_depunere)}{zile != null && zile >= 0 ? ` · ${zile} zile` : ''}
          </span>
        )}
        <button onClick={semneaza} disabled={blocat || busy}
          title={blocat ? 'Inactiv până se închid rândurile roșii' : 'Îngheață verdictul porții'}
          style={{ ...S.btnP, marginLeft:'auto', opacity: blocat || busy ? .45 : 1, cursor: blocat ? 'not-allowed' : 'pointer' }}>
          📦 Marchează propunerea gata de depus
        </button>
      </div>

      {eroare && <div style={{ ...S.card, padding:12, borderColor:G.red + '55', color:G.red, fontSize:13 }}>{eroare}</div>}

      <PoartaPT st={st} onFiltru={f => { setFiltru(f); setSel(new Set()) }} />

      <div>
        <div style={{ ...S.lbl, marginBottom:8 }}>Cuprinsul propunerii</div>
        <CuprinsCapitole capitole={capitole} numarPeCapitol={numarPeCapitol} onCreeaza={creeazaCuprins} busy={busy} />
      </div>

      <div>
        <div style={{ ...S.lbl, marginBottom:8 }}>Matricea de conformitate</div>
        <MatriceCerinte
          cerinte={cerinte} legaturi={legaturi} capitole={capitole} dovedite={dovedite}
          filtru={filtru} setFiltru={setFiltru} sel={sel} setSel={setSel}
          onAtribuie={atribuie} onExcepta={excepta} busy={busy}
        />
      </div>
    </div>
  )
}
