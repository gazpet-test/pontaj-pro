// ════════════════════════════════════════════════════════════════
// OfertareLicitatii.jsx — M1 Modul Ofertare: dashboard licitații + E0
// Caiet de sarcini: claude_docs / modul-ofertare-caiet-sarcini
// E0 = înregistrarea licitației + decizia GO/NO-GO (a lui Răzvan, cu motivare
// păstrată). Pipeline-ul complet (E1–E11) se construiește pe tabelele ofertare_*
// din migrarea ofertare_m1_schema; aici e primul ecran: listă + countdown +
// roșu pe cerințele eliminatorii neacoperite (v_ofertare_dashboard).
// Fișier separat de Ofertare.jsx ca tab-urile vechi (calitate/probe) să rămână
// neatinse; componentele stau la nivel de modul (lecția #105 — remount).
// ════════════════════════════════════════════════════════════════
import { useState, useEffect, useRef, useMemo } from 'react'
import { supabase } from './lib/supabase.js'
import { NotificationBell } from './App.jsx'
import RFQPanel from './OfertareRFQ.jsx'
import CantitatiPanel from './OfertareCantitati.jsx'
import ClarificariPanel from './OfertareClarificari.jsx'
import GarantieSection from './OfertareGarantie.jsx'
import PropunerePanel, { PropunereRezumat } from './OfertarePropunere.jsx'
import { GbeLicitatie } from './GbeEvidenta.jsx'
import { REGEX_INTERZICE_CUMUL } from './ofertareControale.js'
import CerinteAcoperirePerechi from './OfertareCerinte.jsx'
import OfertareTriere, { poatePorniProcesarea, MOTIV_POARTA, CostAI } from './OfertareTriere.jsx'

const G = {
  bg:'#0D1117', surface:'#161B22', card:'#1C2128', border:'#30363D', border2:'#21262D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  ofertare:'#3FB6E2', green:'#3FB950', blue:'#58A6FF', orange:'#F0883E',
  yellow:'#E3B341', red:'#F85149', purple:'#A371F7', teal:'#2DD4BF',
}
const S = {
  input: { width:'100%', boxSizing:'border-box', background:G.bg, border:`1px solid ${G.border2}`, borderRadius:6, padding:'8px 12px', color:G.text, fontSize:13, outline:'none' },
  lbl: { display:'block', fontSize:11, color:G.muted, marginBottom:4, fontWeight:600, textTransform:'uppercase', letterSpacing:'.3px' },
  btnP: { padding:'9px 18px', background:G.ofertare, color:'#0D1117', border:'none', borderRadius:7, cursor:'pointer', fontSize:13, fontWeight:700 },
  btnS: { padding:'9px 18px', background:G.surface, color:G.text, border:`1px solid ${G.border2}`, borderRadius:7, cursor:'pointer', fontSize:13 },
  card: { background:G.card, border:`1px solid ${G.border}`, borderRadius:10 },
}

export const LICITATIE_STATUS = {
  identificata: { label:'Identificată', color:G.muted,  icon:'🔍' },
  analiza:      { label:'În analiză',   color:G.yellow, icon:'🧐' },
  go:           { label:'GO',           color:G.teal,   icon:'🟢' },
  in_lucru:     { label:'În lucru',     color:G.blue,   icon:'🛠' },
  depusa:       { label:'Depusă',       color:G.purple, icon:'📮' },
  castigata:    { label:'Câștigată',    color:G.green,  icon:'🏆' },
  pierduta:     { label:'Pierdută',     color:G.red,    icon:'❌' },
  abandonata:   { label:'Abandonată',   color:G.dim,    icon:'⛔' },
}
// Tranzițiile permise din UI — restul curg prin deciziile dedicate (GO/NO-GO)
const TRANZITII = {
  identificata: ['analiza'],
  analiza:      [],                 // iese doar prin decizia GO / NO-GO
  go:           ['in_lucru'],
  in_lucru:     ['depusa'],
  depusa:       ['castigata','pierduta'],
  castigata:    [], pierduta: [], abandonata: [],
}

// Segmente de piață — dimensiune transversală (filtru pipeline, radar, calibrări), nu module separate
export const SEGMENTE = {
  transgaz:    { label:'Transgaz',         color:'#58A6FF' },
  romgaz:      { label:'Romgaz',           color:'#A371F7' },
  conpet:      { label:'Conpet',           color:'#F0883E' },
  distributie: { label:'Distribuție gaze', color:'#3FB950' },
  altele:      { label:'Altele',           color:'#8B949E' },
}
// Identificatorii SEAP deduși din nr. anunț + link (D, 07.09.2026): c_notice_id = numărul din .../view/<id>,
// sys_notice_type_id = 2 (CN/DF — anunț de participare), 17 (SCN — simplificată), 3 (ADV — publicitate). Radarul îi
// aduce direct, dar dacă lipsesc (promovare veche / anunț introdus manual) îi completăm din link.
export const deduIdSeap = (nr = '', link = '') => {
  const m = String(link || '').match(/\/view\/(\d{6,})/)
  const c_notice_id = m ? Number(m[1]) : null
  const sys_notice_type_id = /^SCN/i.test(nr) ? 17 : /^(CN|DF)/i.test(nr) ? 2 : /^ADV/i.test(nr) ? 3 : null
  return { c_notice_id, sys_notice_type_id }
}

export const detectSegment = (autoritate = '', obiect = '') => {
  const t = (autoritate + ' ' + obiect).toLowerCase()
  if (t.includes('transgaz')) return 'transgaz'
  if (t.includes('romgaz')) return 'romgaz'
  if (t.includes('conpet')) return 'conpet'
  if (/gaze|gaz metan|bransament|branșament/.test(t)) return 'distributie'
  return 'altele'
}

const fmtVal = v => (v || v === 0) ? new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 0 }).format(v) : '—'
const fmtTermen = t => t ? new Date(t).toLocaleString('ro-RO', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—'
// timestamptz → valoare pentru <input type="datetime-local"> (ora locală, nu UTC)
const toLocalInput = t => { if (!t) return ''; const d = new Date(t); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16) }

export default function OfertareLicitatiiTab() {
  const [profile, setProfile] = useState(null)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editRow, setEditRow] = useState(null)
  const [selected, setSelected] = useState(null)
  const [fStatus, setFStatus] = useState('active')
  const [fSegment, setFSegment] = useState('')
  const [fResp, setFResp] = useState('')          // filtru responsabil (profile id)
  const [cauta, setCauta] = useState('')          // TKT-2026-0260: căutare în listă, în loc de Ctrl+F
  const [echipa, setEchipa] = useState([])         // colegii cu acces la modulul Ofertare — candidați la „responsabil”
  const [toast, setToast] = useState(null)
  const [vedere, setVedere] = useState('licitatii')   // licitatii | experienta | radar
  const [cantLicId, setCantLicId] = useState(null)   // licitația cu care intri în Cantități din fișă (Răzvan 07.09: nu mai alegi din listă)
  const [clarLicId, setClarLicId] = useState(null)   // idem, pentru ❓ Clarificări (ecran separat din 15.09)
  const [ptLicId, setPtLicId] = useState(null)       // idem, pentru Propunere tehnică
  // Intrarea din Clarificări direct în analiza unui document: o „intenție" care coboară până la
  // DocumenteSection și se consumă o singură dată. Numărul de secvență există ca să deosebim două
  // intrări succesive pe aceeași licitație — altfel a doua n-ar mai remonta fișa.
  const secventaIntrare = useRef(0)
  const [intrareDocument, setIntrareDocument] = useState(null)
  const [cheieFisa, setCheieFisa] = useState(0)
  const consumaIntrare = (id) => setIntrareDocument(c => (c?.id === id ? null : c))
  const deschideAnaliza = ({ licitatieId, documentId }) => {
    const lic = rows.find(r => String(r.id) === String(licitatieId))
    if (!lic || !documentId) return showToast('Nu pot deschide analiza: licitația sau documentul lipsește.', 'err')
    const id = ++secventaIntrare.current
    setIntrareDocument({ id, licitatieId: lic.id, documentId })
    setCheieFisa(id)
    setCantLicId(lic.id); setClarLicId(lic.id)
    setVedere('licitatii')
    setSelected(lic)
  }

  const showToast = (msg, tip = 'ok') => { setToast({ msg, tip }); setTimeout(() => setToast(null), 4000) }

  const load = async () => {
    setLoading(true)
    const [{ data: v }, { data: full }] = await Promise.all([
      supabase.from('v_ofertare_dashboard').select('*').order('termen_depunere', { ascending: true, nullsFirst: false }),
      supabase.from('ofertare_licitatii').select('*'),
    ])
    const fullMap = {}; (full || []).forEach(l => { fullMap[l.id] = l })
    // Redesign #40 (GO Răzvan 07.09.2026): cifrele de pe carduri/KPI — acoperire, dovezi roșii, verdict, clarificări
    const ids = (v || []).map(r => r.id)
    const stats = {}
    ids.forEach(id => { stats[id] = { cerinte: 0, acoperite: 0, reverif: 0, rosii: 0, verdict: null, verdict_la: null, clarificari: 0 } })
    if (ids.length) {
      const [{ data: cs }, { data: vf }, { data: cl }, { data: tri }] = await Promise.all([
        // .limit explicit: implicit PostgREST întoarce 1.000 de rânduri, iar cerințele active sunt peste 2.000 —
        // Mănăstirea apărea cu 150/419 în loc de 226/655 (auditul 09.09.2026)
        supabase.from('ofertare_cerinte').select('id, licitatie_id, tip, cand_se_prezinta').in('licitatie_id', ids).is('inlocuita_de', null).is('duplicat_al', null).limit(20000),
        supabase.from('ofertare_verificari').select('licitatie_id, verdict, created_at').in('licitatie_id', ids).order('id', { ascending: false }),
        supabase.from('ofertare_clarificari').select('licitatie_id').in('licitatie_id', ids),
        supabase.from('ofertare_triere').select('licitatie_id, verdict').in('licitatie_id', ids),
      ])
      const cerLic = {}, cerCand = {}; (cs || []).forEach(c => { cerLic[c.id] = c.licitatie_id; cerCand[c.id] = c.cand_se_prezinta; stats[c.licitatie_id].cerinte++ })
      ;(tri || []).forEach(x => { if (stats[x.licitatie_id]) stats[x.licitatie_id].triere = x.verdict })
      const cIds = Object.keys(cerLic)
      if (cIds.length) {
        const { data: ac } = await supabase.from('ofertare_acoperire').select('cerinta_id, status, verificat_pe_scan, reverificare_ceruta, valabil_la_depunere, doc_firma:documente_firma(se_reemite, data_valabilitate)').in('cerinta_id', cIds).order('id').limit(20000)
        // O cerință poate avea mai multe rânduri de acoperire (cele verificate pe scan nu se
        // șterg la re-rulare). Numărătoarea pe RÂND umfla „acoperite" și putea depăși 100%.
        // Mai mult: numărând ORICE rând acoperit, KPI-ul spunea „acoperit" acolo unde ecranul
        // de detaliu arăta „gol" (acolo câștigă rândul verificat de om). Aceeași regulă în
        // ambele locuri — un singur rând per cerință, cel verificat are întâietate.
        const randCerinta = {}
        ;(ac || []).forEach(a => { const ex = randCerinta[a.cerinta_id]
          if (!ex || (a.verificat_pe_scan && !ex.verificat_pe_scan)) randCerinta[a.cerinta_id] = a })
        Object.values(randCerinta).forEach(a => { const lid = cerLic[a.cerinta_id]; const st = stats[lid]; if (!st) return
          // Dovada mutata de un raspuns al autoritatii pe textul NOU al cerintei nu e inca dovada:
          // omul n-a vazut noul text. Se numara separat, nu in „acoperite" — altfel ecranul spune
          // „gata" exact acolo unde cerinta tocmai s-a schimbat sub noi.
          if (a.status === 'acoperit' || a.status === 'acoperit_partener') { if (a.reverificare_ceruta) st.reverif++; else st.acoperite++ }
          // certificatele de 30 zile (se_reemite) se cer proaspete la depunere → roșii doar când depunerea e aproape și nu-s valabile atunci.
          // #72 (Silviu 15.09): dacă cerința se prezintă DOAR de ofertantul de pe locul I / se declară în DUAE, documentul
          // nu trebuie să fie valabil la depunere — nu e roșu (ONRC la Domnești/Răcari; la Conpet e „depunere" și rămâne roșu).
          const laDepunere = !['primul_loc', 'duae'].includes(cerCand[a.cerinta_id])
          if (a.doc_firma?.se_reemite) { if (laDepunere && reemisUrgent(a.doc_firma, fullMap[lid]?.termen_depunere)) st.rosii++ }
          else if (a.valabil_la_depunere === false && laDepunere) st.rosii++ })
      }
      ;(vf || []).forEach(x => { const st = stats[x.licitatie_id]; if (st && !st.verdict) { st.verdict = x.verdict; st.verdict_la = x.created_at } })
      ;(cl || []).forEach(x => { if (stats[x.licitatie_id]) stats[x.licitatie_id].clarificari++ })
    }
    const randuri = (v || []).map(r => ({ ...fullMap[r.id], ...r, _st: stats[r.id] }))
    setRows(randuri)
    setSelected(s => s ? (randuri.find(x => x.id === s.id) || s) : s)   // fișa deschisă vede KPI-urile noi (garanție, acoperire)
    setLoading(false)
  }
  useEffect(() => {
    load()
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) supabase.from('profiles').select('id, name, is_owner').eq('id', user.id).single()
        .then(({ data }) => setProfile(data))
    })
    // echipa de ofertare = cine are acces explicit la modul (+ ownerul)
    // (fără embed profiles — user_module_access nu are FK spre profiles, embed-ul cădea și rămâneau doar ownerii)
    supabase.from('user_module_access').select('profile_id').eq('module', 'ofertare').then(async ({ data }) => {
      const ids = (data || []).map(x => x.profile_id).filter(Boolean)
      const { data: ps } = await supabase.from('profiles').select('id, name, is_owner').or(`is_owner.eq.true${ids.length ? `,id.in.(${ids.join(',')})` : ''}`)
      setEchipa((ps || []).sort((a, b) => (a.name || '').localeCompare(b.name || '')))
    })
  }, [])

  const FINALE = ['castigata', 'pierduta', 'abandonata']
  const areProbleme = r => (r.eliminatorii_neacoperite > 0) || (r._st?.rosii > 0) || r._st?.verdict === 'rosu'
  // căutarea ignoră diacriticele și majusculele — „Domnesti" găsește „Domnești"
  const normText = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const cautaN = normText(cauta).trim()
  const filtrate = rows.filter(r => (fStatus === 'active' ? !FINALE.includes(r.status)
    : fStatus === 'finale' ? FINALE.includes(r.status)
    : fStatus === 'in_lucru' ? ['go', 'in_lucru', 'analiza'].includes(r.status)
    : fStatus === 'depuse' ? r.status === 'depusa'
    : fStatus === 'radar' ? /^Radar/i.test(r.observatii || '') && !FINALE.includes(r.status)
    : fStatus === 'probleme' ? areProbleme(r) && !FINALE.includes(r.status) : true)
    && (!fSegment || r.segment === fSegment) && (!fResp || r.responsabil_id === fResp)
    && (!cautaN || [r.obiect, r.autoritate, r.nr_anunt, r.responsabil_nume, r.observatii]
      .some(v => normText(v).includes(cautaN))))
  // contor pe responsabil: în lucru acum + total pe anul curent (cine ce are și câte face pe an)
  const anCurent = new Date().getFullYear()
  const perResp = {}
  rows.forEach(r => { if (!r.responsabil_id) return; const x = perResp[r.responsabil_id] ||= { nume: r.responsabil_nume, in_lucru: 0, an: 0 }
    if (!FINALE.includes(r.status)) x.in_lucru++
    if (new Date(r.created_at).getFullYear() === anCurent) x.an++ })
  const nrInLucru = rows.filter(r => ['go', 'in_lucru', 'analiza'].includes(r.status)).length
  const nrDepuse = rows.filter(r => r.status === 'depusa').length
  const nrArhiva = rows.filter(r => FINALE.includes(r.status)).length
  const fmtMil = v => v == null ? '—' : v >= 1e6 ? `${(v / 1e6).toLocaleString('ro-RO', { maximumFractionDigits: 2 })} mil` : new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 0 }).format(v)

  const salveaza = async (form) => {
    const payload = {
      nr_anunt: form.nr_anunt.trim(),
      autoritate: form.autoritate.trim(),
      obiect: form.obiect.trim(),
      link_seap: form.link_seap.trim() || null,
      valoare_estimata: form.valoare_estimata !== '' ? Number(form.valoare_estimata) : null,
      moneda: form.moneda,
      termen_depunere: form.termen_depunere ? new Date(form.termen_depunere).toISOString() : null,
      criteriu: form.criteriu.trim() || null,
      garantie_participare: form.garantie_participare.trim() || null,
      nas_path: form.nas_path.trim() || null,
      observatii: form.observatii.trim() || null,
      segment: form.segment || detectSegment(form.autoritate, form.obiect),
      ...(form.loturi_ai ? { loturi: form.loturi_ai } : {}),
      updated_at: new Date().toISOString(),
    }
    // Garda anti-dublură: la o licitație NOUĂ, dacă mai există una pe aceeași autoritate cu obiect
    // asemănător, omul e întrebat înainte — nu se creează tăcut a doua înregistrare a aceleiași proceduri.
    if (!editRow) {
      const candidati = (rows || []).filter(l =>
        suprapunere(l.autoritate, payload.autoritate) >= 0.5 &&
        suprapunere(l.obiect, payload.obiect) >= 0.6)
      if (candidati.length) {
        const lista = candidati.slice(0, 3).map(l =>
          `• ${l.nr_anunt} — ${(l.obiect || '').slice(0, 70)}${(l.obiect || '').length > 70 ? '…' : ''}` +
          ` (${l.status}${l.termen_depunere ? ', termen ' + new Date(l.termen_depunere).toLocaleDateString('ro-RO') : ''})`).join('\n')
        if (!window.confirm(
          `Există deja ${candidati.length === 1 ? 'o licitație' : candidati.length + ' licitații'} pe aceeași autoritate, cu obiect asemănător:\n\n${lista}\n\n` +
          `Aceeași procedură are și număr SCN, și număr DF — s-ar putea să fie aceeași.\n\n` +
          `OK = o înregistrez oricum ca licitație nouă · Anulează = mă întorc și o deschid pe cea existentă`)) return false
      }
    }
    let licId = editRow?.id
    if (editRow) {
      const { error } = await supabase.from('ofertare_licitatii').update(payload).eq('id', editRow.id)
      if (error) { showToast('Eroare la salvare: ' + error.message, 'err'); return false }
    } else {
      const { data: ins, error } = await supabase.from('ofertare_licitatii')
        .insert({ ...payload, created_by: profile?.id || null }).select('id').single()
      if (error) { showToast('Eroare la salvare: ' + error.message, 'err'); return false }
      licId = ins.id
    }
    // Fișa de date trasă în formular devine primul document al licitației (tip fisa_date)
    if (form.fisa_path && licId) {
      const { error: eDoc } = await supabase.from('ofertare_documente_atribuire').insert({
        licitatie_id: licId, fisier_path: form.fisa_path, nume_original: form.fisa_nume || 'fisa_date.pdf',
        // fișa a fost deja citită cu AI (E0 autofill) de cel care a completat formularul
        tip: 'fisa_date', procesat_la: new Date().toISOString(), procesat_de: profile?.id || null,
      })
      if (eDoc) showToast('Licitația s-a salvat, dar fișa nu s-a atașat: ' + eDoc.message, 'warn')
    }
    showToast(editRow ? 'Licitație actualizată.' : `Licitație înregistrată — ${payload.nr_anunt}.`)
    setShowForm(false); setEditRow(null)
    await load()
    return true
  }

  const schimbaStatus = async (l, status) => {
    const { error } = await supabase.from('ofertare_licitatii')
      .update({ status, updated_at: new Date().toISOString() }).eq('id', l.id)
    if (error) { showToast('Eroare: ' + error.message, 'err'); return }
    showToast(`${LICITATIE_STATUS[status].icon} ${l.nr_anunt} → ${LICITATIE_STATUS[status].label}.`)
    setSelected(null); await load()
  }

  // E0: decizia GO/NO-GO — doar owner, cu motivare păstrată
  const decide = async (l, decizie, motivare) => {
    if (!profile?.is_owner) { showToast('Decizia GO/NO-GO e doar a ownerului.', 'err'); return }
    const { error } = await supabase.from('ofertare_licitatii').update({
      decizie_go: decizie, decizie_motivare: motivare?.trim() || null,
      decizie_de: profile.id, decizie_la: new Date().toISOString(),
      status: decizie === 'go' ? 'go' : 'abandonata',
      updated_at: new Date().toISOString(),
    }).eq('id', l.id)
    if (error) { showToast('Eroare: ' + error.message, 'err'); return }
    showToast(decizie === 'go' ? `🟢 GO pe ${l.nr_anunt}.` : `⛔ NO-GO pe ${l.nr_anunt} — abandonată.`, decizie === 'go' ? 'ok' : 'warn')
    setSelected(null); await load()
  }

  const sterge = async (l) => {
    if (!profile?.is_owner) return
    if (!window.confirm(`Ștergi licitația ${l.nr_anunt}?\nSe șterg și documentele/cerințele/acoperirea ei. IREVERSIBIL.`)) return
    const { error } = await supabase.from('ofertare_licitatii').delete().eq('id', l.id)
    if (error) { showToast('Eroare: ' + error.message, 'err'); return }
    showToast(`🗑 ${l.nr_anunt} ștearsă.`, 'warn')
    setSelected(null); await load()
  }

  return (
    <div style={{ padding: 28, maxWidth: 1200, margin: '0 auto' }}>
      {toast && (
        <div style={{ position:'fixed', top:76, right:20, zIndex:2000, padding:'11px 18px', borderRadius:9, fontSize:13, fontWeight:600,
          background: toast.tip === 'err' ? G.red : toast.tip === 'warn' ? G.orange : G.green, color:'#0D1117' }}>{toast.msg}</div>
      )}

      {/* Comutator: pipeline-ul de licitații / catalogul de experiență similară */}
      <div style={{ display:'flex', gap:8, marginBottom:16, alignItems:'center', flexWrap:'wrap' }}>
        {[['licitatii', '🏛 Licitații'], ['cantitati', '📋 Cantități'], ['clarificari', '❓ Clarificări'], ['propunere', '📑 Propunere tehnică'], ['rfq', '🛒 Cereri ofertă'], ['experienta', '📚 Experiență similară'], ['radar', '📡 Radar'], ['referinte', '💰 Referințe']].map(([k, lbl]) => (
          <button key={k} onClick={() => setVedere(k)} style={{ ...S.btnS, padding:'7px 16px', fontSize:12.5, fontWeight:700,
            ...(vedere === k ? { background:G.ofertare + '22', color:G.ofertare, border:`1px solid ${G.ofertare}88` } : {}) }}>{lbl}</button>
        ))}
        {/* Clopoțelul modulului: doar alertele de ofertare (SEAP, pagini goale, clarificări nedepuse,
            extrageri terminate). Cel general le exclude — altfel se pierdeau printre cele de logistică. */}
        <div style={{ marginLeft:'auto' }}>
          <NotificationBell doarModul="Ofertare" icon="📣" titlu="Alerte ofertare" />
        </div>
      </div>

      {vedere === 'experienta' && <ExperientaCatalog licitatii={rows} profile={profile} showToast={showToast} />}

      {vedere === 'radar' && <RadarLicitatii profile={profile} showToast={showToast} onPromovat={load} />}

      {vedere === 'referinte' && <ReferinteFinanciare showToast={showToast} />}

      {vedere === 'rfq' && <RFQPanel licitatii={rows} profile={profile} showToast={showToast} />}

      {vedere === 'propunere' && <PropunerePanel licitatii={rows} profile={profile} showToast={showToast} initialLicId={ptLicId}
        onInapoi={ptLicId ? () => { const r = rows.find(x => x.id === ptLicId); setVedere('licitatii'); if (r) setSelected(r) } : null} />}

      {vedere === 'cantitati' && <CantitatiPanel licitatii={rows} profile={profile} showToast={showToast} initialLicId={cantLicId}
        onGoClarificari={(id) => { setIntrareDocument(null); setClarLicId(id); setVedere('clarificari') }}
        onInapoi={cantLicId ? () => { const r = rows.find(x => x.id === cantLicId); setIntrareDocument(null); setVedere('licitatii'); if (r) setSelected(r) } : null} />}

      {vedere === 'clarificari' && <ClarificariPanel licitatii={rows} profile={profile} showToast={showToast} initialLicId={clarLicId}
        onDeschideAnaliza={deschideAnaliza}
        onInapoi={clarLicId ? () => { const r = rows.find(x => x.id === clarLicId); setIntrareDocument(null); setVedere('licitatii'); if (r) setSelected(r) } : null} />}

      {vedere === 'licitatii' && <>
      {/* ── Redesign #40: antet cu contoare + filtre-chip + carduri aerisite (macheta redesign_lista, GO 07.09.2026) ── */}
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:16, flexWrap:'wrap' }}>
        <div style={{ fontSize:22, fontWeight:800 }}>📑 Licitații</div>
        <span style={{ background:'#1c2a44', color:G.blue, borderRadius:999, padding:'4px 14px', fontSize:12.5, fontWeight:800 }}>{nrInLucru} în lucru</span>
        <span style={{ background:'#2a2211', color:G.yellow, borderRadius:999, padding:'4px 14px', fontSize:12.5, fontWeight:800 }}>{nrDepuse} depuse</span>
        <span style={{ background:G.surface, color:G.muted, borderRadius:999, padding:'4px 14px', fontSize:12.5, fontWeight:800 }}>arhivă {nrArhiva}</span>
        <div style={{ marginLeft:'auto', display:'flex', gap:8, alignItems:'center' }}>
          <div style={{ position:'relative' }}>
            <input style={{ ...S.input, width:230, paddingRight:cauta ? 28 : undefined }} value={cauta} onChange={e => setCauta(e.target.value)}
              placeholder="🔍 caută lucrare, autoritate, nr. anunț" title="Caută în obiect, autoritate, nr. anunț, responsabil și observații" />
            {!!cauta && <button onClick={() => setCauta('')} title="Șterge căutarea"
              style={{ position:'absolute', right:6, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', color:G.muted, cursor:'pointer', fontSize:15, lineHeight:1, padding:2 }}>×</button>}
          </div>
          <select style={{ ...S.input, width:'auto' }} value={fResp} onChange={e => setFResp(e.target.value)} title="Filtru după responsabil">
            <option value="">Toți responsabilii</option>
            {echipa.map(p => <option key={p.id} value={p.id}>{p.name}{perResp[p.id] ? ` (${perResp[p.id].in_lucru} în lucru · ${perResp[p.id].an} în ${anCurent})` : ''}</option>)}
          </select>
          <select style={{ ...S.input, width:'auto' }} value={fSegment} onChange={e => setFSegment(e.target.value)}>
            <option value="">Toate segmentele</option>
            {Object.entries(SEGMENTE).map(([k, sg]) => <option key={k} value={k}>{sg.label}</option>)}
          </select>
          <button style={{ ...S.btnP, borderRadius:10, padding:'10px 18px' }} onClick={() => { setEditRow(null); setShowForm(true) }}>＋ Licitație nouă</button>
        </div>
      </div>
      <div style={{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap' }}>
        {[['active', 'Toate active'], ['in_lucru', '🔨 în lucru'], ['depuse', '📮 depuse'], ['radar', '🛰️ din radar'], ['probleme', '⚠️ cu probleme'], ['finale', '📦 arhivă'], ['toate', 'toate']].map(([k, lbl]) => (
          <button key={k} onClick={() => setFStatus(k)} style={{ borderRadius:999, padding:'7px 16px', fontSize:13, fontWeight:700, cursor:'pointer',
            background: fStatus === k ? '#3a3113' : G.surface, color: fStatus === k ? G.ofertare : G.muted, border:`1px solid ${fStatus === k ? '#5c4d1c' : G.border2}` }}>{lbl}</button>
        ))}
      </div>

      {loading && <div style={{ padding:40, textAlign:'center', color:G.muted }}>Se încarcă licitațiile...</div>}
      {!loading && !filtrate.length && (
        <div style={{ ...S.card, padding:40, textAlign:'center', color:G.dim, fontSize:14 }}>
          {cautaN ? `Nicio lucrare pentru „${cauta}" pe filtrul curent.` : rows.length ? 'Nimic pe filtrul curent.' : 'Nicio licitație încă. Apasă „＋ Licitație nouă" — primul pas e anunțul SEAP + termenul de depunere.'}
        </div>
      )}

      <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
        {filtrate.map(l => {
          const st = LICITATIE_STATUS[l.status] || LICITATIE_STATUS.identificata
          const sx = l._st || {}
          const zile = l.zile_ramase
          const activa = !FINALE.includes(l.status) && l.status !== 'depusa'
          const cZile = zile == null ? G.muted : zile <= 3 ? G.red : zile <= 7 ? G.orange : zile <= 21 ? G.yellow : G.green
          const pct = sx.cerinte ? Math.round(100 * sx.acoperite / sx.cerinte) : 0
          const probl = areProbleme(l)
          const cBord = probl && activa ? G.red : activa && zile != null && zile <= 21 ? G.yellow : l.status === 'depusa' ? G.purple : st.color
          const VC = { verde: ['VERDE', G.green], galben: ['GALBEN', G.yellow], rosu: ['ROȘU', G.red] }
          const TRIERE_V = { mergem: ['MERGEM', G.green], cu_clarificari: ['CU CLARIFICĂRI', G.yellow], nu_se_poate: ['NU SE POATE', G.red], neclar: ['NECLAR', G.muted] }
          const canalLbl = l.canal ? l.canal.replace('seap_', 'SEAP ').toUpperCase() : (l.tip_procedura || '')
          return (
            <div key={l.id} onClick={() => setSelected(l)} style={{ ...S.card, padding:'16px 22px', cursor:'pointer', borderRadius:14,
              display:'grid', gridTemplateColumns:'1fr auto', gap:'6px 20px', borderLeft:`4px solid ${cBord}` }}>
              <div style={{ minWidth:0 }}>
                <div style={{ fontSize:12.5, color:G.dim, fontWeight:700 }}>{l.nr_anunt}{canalLbl ? ` · ${canalLbl}` : ''} · {l.autoritate}
                  {l.segment && SEGMENTE[l.segment] && <span style={{ marginLeft:8, color:SEGMENTE[l.segment].color, border:`1px solid ${SEGMENTE[l.segment].color}55`, borderRadius:10, padding:'0 8px', fontSize:10.5 }}>{SEGMENTE[l.segment].label}</span>}
                </div>
                <div style={{ fontSize:15.5, fontWeight:700, margin:'3px 0 7px', overflow:'hidden', textOverflow:'ellipsis', display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical' }}>{l.obiect}</div>
                <div style={{ display:'flex', gap:18, fontSize:13, color:G.muted, flexWrap:'wrap' }}>
                  <span>💰 <b style={{ color:G.text }}>{fmtMil(l.valoare_estimata)}</b> {l.moneda || 'lei'}</span>
                  {sx.triere && <span title="Verdictul trierii din Fișa de date (tab ⚡ Triere)">⚡ triere: <b style={{ color: TRIERE_V[sx.triere]?.[1] || G.muted }}>{TRIERE_V[sx.triere]?.[0] || sx.triere}</b></span>}
                  {!sx.triere && !sx.cerinte && <span style={{ color:G.dim }} title="Nu s-a rulat trierea din Fișa de date">⚡ netriată</span>}
                  <span>📋 acoperire <b style={{ color:G.text }}>{sx.acoperite || 0}/{sx.cerinte || 0}</b>{!sx.cerinte ? <span style={{ color:G.dim }}> · registru negenerat</span> : ''}</span>
                  {l.eliminatorii_neacoperite > 0 && <span style={{ color:G.red }} title={'Eliminatorii fără rând de acoperire „acoperit”: goluri + neevaluate'}>🚫 eliminatorii fără dovadă: <b>{l.eliminatorii_neacoperite}</b></span>}
                  {sx.reverif > 0 && <span style={{ color:G.orange }} title="Dovezi mutate pe textul nou al cerinței de un răspuns al autorității — nimeni nu le-a reconfirmat încă">⟳ de reverificat: <b>{sx.reverif}</b></span>}
                  {sx.rosii > 0 && <span>🔴 dovezi roșii: <b style={{ color:G.red }}>{sx.rosii}</b></span>}
                  {sx.verdict && <span>🔍 verificare: <b style={{ color:(VC[sx.verdict] || [])[1] || G.muted }}>{(VC[sx.verdict] || [sx.verdict])[0]}</b></span>}
                  {sx.clarificari > 0 && <span>❓ clarificări: <b style={{ color:G.text }}>{sx.clarificari}</b></span>}
                  <span title="Responsabil licitație">👤 {l.responsabil_nume ? <b style={{ color:G.text }}>{l.responsabil_nume}</b> : <span style={{ color:G.orange }}>fără responsabil</span>}</span>
                </div>
              </div>
              <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:8, textAlign:'right' }}>
                <span style={{ background: st.color + '22', color: st.color, borderRadius:999, padding:'4px 14px', fontSize:12.5, fontWeight:800, whiteSpace:'nowrap' }}>{st.icon} {st.label}{l.decizie_go === 'go' ? ' · GO' : ''}</span>
                {activa && <span style={{ fontSize:13.5, color:G.muted, whiteSpace:'nowrap' }}>termen: <b style={{ fontSize:19, color:cZile }}>{zile == null ? '—' : zile === 0 ? 'AZI' : `${zile} ${zile === 1 ? 'zi' : 'zile'}`}</b></span>}
                {!activa && l.termen_depunere && <span style={{ fontSize:12.5, color:G.dim }}>depunere {fmtTermen(l.termen_depunere).slice(0, 10)}</span>}
                <span style={{ height:7, borderRadius:5, background:G.border, overflow:'hidden', width:190, display:'block' }}>
                  <i style={{ display:'block', height:'100%', width:`${pct}%`, background: probl ? G.red : 'linear-gradient(90deg,#D29922,#3FB950)' }} />
                </span>
              </div>
            </div>
          )
        })}
      </div>
      </>}

      {showForm && (
        <LicitatieFormModal licitatie={editRow} onClose={() => { setShowForm(false); setEditRow(null) }} onSave={salveaza} />
      )}
      {selected && (
        <LicitatieDetailModal key={`${selected.id}:${cheieFisa}`} licitatie={selected} profile={profile} echipa={echipa} onChanged={load}
          intrareDocument={intrareDocument} onIntrareConsumata={consumaIntrare} showToast={showToast}
          onClose={() => { setIntrareDocument(null); setSelected(null) }}
          onEdit={() => { setIntrareDocument(null); setEditRow(selected); setSelected(null); setShowForm(true) }}
          onStatus={schimbaStatus} onDecide={decide} onDelete={sterge} onGoCantitati={() => { setIntrareDocument(null); setCantLicId(selected.id); setVedere('cantitati') }}
          onGoClarificari={() => { setIntrareDocument(null); setClarLicId(selected.id); setVedere('clarificari') }}
          onGoPropunere={() => { setIntrareDocument(null); setPtLicId(selected.id); setVedere('propunere') }} />
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// MODAL: LICITAȚIE NOUĂ / EDITARE (E0 — înregistrarea)
// ════════════════════════════════════════════════════════════════
function LicitatieFormModal({ licitatie, onClose, onSave }) {
  const e0 = licitatie
  const [form, setForm] = useState({
    nr_anunt: e0?.nr_anunt || '', autoritate: e0?.autoritate || '', obiect: e0?.obiect || '',
    link_seap: e0?.link_seap || '', valoare_estimata: e0?.valoare_estimata ?? '', moneda: e0?.moneda || 'RON',
    termen_depunere: toLocalInput(e0?.termen_depunere), criteriu: e0?.criteriu || '',
    garantie_participare: e0?.garantie_participare || '', nas_path: e0?.nas_path || '', observatii: e0?.observatii || '',
    segment: e0?.segment || '', fisa_path: null, fisa_nume: null, loturi_ai: null,
  })
  const [saving, setSaving] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiMsg, setAiMsg] = useState(null)   // { tip:'ok'|'err', text }
  const [dragOver, setDragOver] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const valid = form.nr_anunt.trim() && form.autoritate.trim() && form.obiect.trim()

  // E0 auto-fill: PDF-ul fișei de date → Storage → edge fn → precompletare formular.
  // AI propune, omul verifică — nimic nu se salvează până nu apeși „Înregistrează".
  const citesteFisa = async (file) => {
    if (!file) return
    if (!/\.pdf$/i.test(file.name)) { setAiMsg({ tip:'err', text:'Doar PDF — exportă fișa de date din SEAP ca PDF.' }); return }
    setAiBusy(true); setAiMsg(null)
    try {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-80)
      const path = `e0/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safe}`
      const { error: eUp } = await supabase.storage.from('ofertare').upload(path, file, { contentType: 'application/pdf' })
      if (eUp) throw eUp
      const { data, error } = await supabase.functions.invoke('ofertare-e0-autofill', { body: { path, fisier_nume: file.name } })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      setForm(f => ({
        ...f,
        nr_anunt: data.nr_anunt || f.nr_anunt,
        autoritate: data.autoritate || f.autoritate,
        obiect: data.obiect || f.obiect,
        valoare_estimata: data.valoare_estimata ?? f.valoare_estimata,
        moneda: data.moneda || f.moneda,
        termen_depunere: data.termen_depunere ? toLocalInput(data.termen_depunere) : f.termen_depunere,
        criteriu: data.criteriu || f.criteriu,
        garantie_participare: data.garantie_participare || f.garantie_participare,
        loturi_ai: Array.isArray(data.loturi) && data.loturi.length ? data.loturi : f.loturi_ai,
        fisa_path: path, fisa_nume: file.name,
      }))
      const gasite = ['nr_anunt','autoritate','obiect','valoare_estimata','termen_depunere','criteriu','garantie_participare'].filter(k => data[k] != null).length
      setAiMsg({ tip:'ok', text:`✨ ${gasite}/7 câmpuri completate din „${file.name}" (încredere ${data.confidence}%). Verifică-le înainte de salvare — fișa se atașează automat licitației.` })
    } catch (e) {
      setAiMsg({ tip:'err', text:'Nu am putut citi fișa: ' + (e?.message || e) })
    } finally { setAiBusy(false) }
  }

  const submit = async () => {
    if (!valid) return
    setSaving(true)
    const ok = await onSave(form)
    if (!ok) setSaving(false)
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.7)', zIndex:1000, display:'flex', alignItems:'flex-start', justifyContent:'center', overflowY:'auto', padding:'30px 14px' }} onClick={onClose}>
      <div style={{ ...S.card, width:'min(760px,100%)', padding:24 }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize:17, fontWeight:800, marginBottom:12 }}>🏛 {e0 ? `Editează ${e0.nr_anunt}` : 'Licitație nouă'}</div>

        {/* Dropzone AI — trage fișa de date, formularul se completează singur */}
        <label onDragOver={e => { e.preventDefault(); setDragOver(true) }} onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); citesteFisa(e.dataTransfer.files?.[0]) }}
          style={{ display:'block', marginBottom:16, padding:'16px 18px', borderRadius:10, textAlign:'center', cursor:'pointer',
            border:`2px dashed ${dragOver ? G.ofertare : form.fisa_path ? G.green : G.border}`,
            background: dragOver ? G.ofertare + '15' : form.fisa_path ? G.green + '0D' : G.bg }}>
          <input type="file" accept="application/pdf,.pdf" style={{ display:'none' }} disabled={aiBusy}
            onChange={e => { citesteFisa(e.target.files?.[0]); e.target.value = '' }} />
          {aiBusy ? (
            <span style={{ fontSize:13, color:G.ofertare, fontWeight:700 }}>🤖 AI citește fișa de date... (câteva secunde)</span>
          ) : form.fisa_path ? (
            <span style={{ fontSize:13, color:G.green, fontWeight:700 }}>📎 {form.fisa_nume} — atașată. Trage alt PDF ca să recitești.</span>
          ) : (
            <span style={{ fontSize:13, color:G.muted }}>✨ <b style={{ color:G.text }}>Trage aici fișa de date / anunțul de participare (PDF)</b> sau apasă pentru a alege — AI completează formularul, tu doar verifici</span>
          )}
        </label>
        {aiMsg && (
          <div style={{ marginBottom:14, padding:'9px 13px', borderRadius:8, fontSize:12.5, fontWeight:600,
            border:`1px solid ${aiMsg.tip === 'err' ? G.red : G.green}55`,
            background:(aiMsg.tip === 'err' ? G.red : G.green) + '11', color: aiMsg.tip === 'err' ? G.red : G.green }}>{aiMsg.text}</div>
        )}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          <div><label style={S.lbl}>Nr. anunț SEAP *</label>
            <input style={S.input} value={form.nr_anunt} onChange={e => set('nr_anunt', e.target.value)} placeholder="ex: CN1094135" /></div>
          <div><label style={S.lbl}>Autoritate contractantă *</label>
            <input style={S.input} value={form.autoritate} onChange={e => set('autoritate', e.target.value)} placeholder="ex: SNGN Romgaz SA" /></div>
          <div><label style={S.lbl}>Segment</label>
            <select style={S.input} value={form.segment} onChange={e => set('segment', e.target.value)}>
              <option value="">auto ({SEGMENTE[detectSegment(form.autoritate, form.obiect)].label})</option>
              {Object.entries(SEGMENTE).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
            </select></div>
          <div style={{ gridColumn:'1 / -1' }}><label style={S.lbl}>Obiect *</label>
            <input style={S.input} value={form.obiect} onChange={e => set('obiect', e.target.value)} placeholder="ex: Conductă aducțiune Grup 9 Șincai – Grup 15 Râciu (Lot 2)" /></div>
          <div style={{ gridColumn:'1 / -1' }}><label style={S.lbl}>Link SEAP</label>
            <input style={S.input} value={form.link_seap} onChange={e => set('link_seap', e.target.value)} placeholder="https://e-licitatie.ro/..." /></div>
          <div><label style={S.lbl}>Valoare estimată</label>
            <div style={{ display:'flex', gap:6 }}>
              <input style={S.input} type="number" min="0" value={form.valoare_estimata} onChange={e => set('valoare_estimata', e.target.value)} placeholder="ex: 4500000" />
              <select style={{ ...S.input, width:90 }} value={form.moneda} onChange={e => set('moneda', e.target.value)}>
                <option value="RON">RON</option><option value="EUR">EUR</option>
              </select>
            </div></div>
          <div><label style={S.lbl}>Termen de depunere</label>
            <input style={S.input} type="datetime-local" value={form.termen_depunere} onChange={e => set('termen_depunere', e.target.value)} /></div>
          <div><label style={S.lbl}>Criteriu de atribuire</label>
            <input style={S.input} value={form.criteriu} onChange={e => set('criteriu', e.target.value)} placeholder="ex: prețul cel mai scăzut" /></div>
          <div><label style={S.lbl}>Garanție de participare</label>
            <input style={S.input} value={form.garantie_participare} onChange={e => set('garantie_participare', e.target.value)} placeholder="ex: 45.000 lei, SGB/virament" /></div>
          <div style={{ gridColumn:'1 / -1' }}><label style={S.lbl}>Folder NAS</label>
            <input style={S.input} value={form.nas_path} onChange={e => set('nas_path', e.target.value)} placeholder={'ex: Z:\\Oferte\\3.ROMGAZ\\31.Cond. SINCAI_BALDA...'} /></div>
          <div style={{ gridColumn:'1 / -1' }}><label style={S.lbl}>Observații</label>
            <textarea style={{ ...S.input, minHeight:60, resize:'vertical' }} value={form.observatii} onChange={e => set('observatii', e.target.value)} /></div>
        </div>
        <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:18 }}>
          <button style={S.btnS} onClick={onClose} disabled={saving}>Anulează</button>
          <button style={{ ...S.btnP, opacity: valid && !saving ? 1 : .5 }} onClick={submit} disabled={!valid || saving}>
            {saving ? 'Se salvează...' : e0 ? '💾 Salvează' : '✅ Înregistrează licitația'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// SECȚIUNE: DOCUMENTAȚIA DE ATRIBUIRE (E1 — ingestie)
// Regulile din claude_docs/ofertare-structura-nas-licitatii (corpus v5):
// - arhivele (7z/rar/zip/.001) NU se urcă din browser — se dezarhivează local
//   și se urcă FOLDERUL (regula 1); dedup pe (nume, mărime) la re-upload
// - gunoaie excluse: ~$*, .log, _Claude_*, .db, .tmp (regulile 7/23)
// - clasificarea din nume e doar INDICIU (regula 25 — „PALNSE"), omul o poate
//   schimba; conținutul decide în E2
// - procesarea AI: un document pe rând, cu continuare (pagini_procesate) —
//   edge fn ofertare-ingest-doc, felii mici sub IDLE_TIMEOUT-ul gateway-ului
// ════════════════════════════════════════════════════════════════
const JUNK_RE = /(^|\/)~\$|\.log$|_Claude_|\.db$|\.tmp$|(^|\/)Thumbs\.db$/i
const ARHIVA_RE = /\.(7z|rar|zip|z\d{2}|\d{3})$|\.part\d+\.rar$/i
const DOC_STATUS = {
  neprocesat: { label:'neprocesat', color:G.muted },
  in_lucru:   { label:'în lucru',   color:G.yellow },
  procesat:   { label:'✓ procesat', color:G.green },
  // are text, dar nu tot: paginile lipsă sunt în pagini_necitite (ingest v8)
  partial:    { label:'⚠ parțial',  color:G.orange },
  eroare:     { label:'eroare',     color:G.red },
  ignorat:    { label:'doar fișier',color:G.dim },
}
// Certificat cu valabilitate 30 zile (constatator ONRC, atestare fiscală, cazier fiscal): se emite proaspăt la depunere.
// Urgent (roșu) doar dacă termenul e în ≤ 10 zile și certificatul nu e valabil în ziua depunerii; altfel doar reminder portocaliu.
const reemisUrgent = (doc, termen) => {
  if (!doc?.se_reemite || !termen) return false
  const zile = Math.ceil((new Date(termen) - Date.now()) / 86400000)
  const valabil = doc.data_valabilitate && new Date(doc.data_valabilitate) >= new Date(termen.slice(0, 10))
  return zile <= 10 && !valabil
}
const ghicesteTip = (nume) => {
  const n = (nume || '').toLowerCase()
  if (/fisadate|fisa.de.date|instructiuni.?ofertanti/.test(n)) return 'fisa_date'
  if (/clarificare|raspuns.*consolidat|erata/.test(n)) return 'raspuns_clarificare'
  if (/formular|duae/.test(n)) return 'formular'
  if (/contract/.test(n)) return 'model_contract'
  if (/cantitat|antemasur|^f[1-3][_ .-]/.test(n)) return 'lista_cantitati'
  if (/desene|plans|palnse|\.dwg$|izometri/.test(n)) return 'plansa'
  if (/volum|caiet|memoriu|\bcs\b|sectiunea/.test(n)) return 'cs_volum'
  return 'alta'
}

// Rând de inventar fără fișier real în storage. fisier_path e NOT NULL în BD,
// așa că poziția „știm că există documentul, dar nu-l avem" poartă marcajul din cale.
const ESTE_PLACEHOLDER = d => !d.fisier_path || d.fisier_path.includes('/neincarcat/')

// Răzvan 07.09.2026: „clepsidră” — să se vadă că lucrează, nu că s-a blocat: spinner + cronometru + bară de progres pe pagini
function Lucru({ icon, text, pct, detaliu }) {
  const [t0] = useState(Date.now())
  const [sec, setSec] = useState(0)
  useEffect(() => { const t = setInterval(() => setSec(Math.floor((Date.now() - t0) / 1000)), 1000); return () => clearInterval(t) }, [t0])
  const mm = String(Math.floor(sec / 60)).padStart(2, '0'), ss = String(sec % 60).padStart(2, '0')
  return (
    <div style={{ marginBottom:8, padding:'8px 12px', borderRadius:8, background:G.ofertare + '14', border:`1px solid ${G.ofertare}44` }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, fontSize:12.5, color:G.ofertare, fontWeight:700 }}>
        <span className="sp" style={{ borderTopColor:G.ofertare, flexShrink:0 }} />
        <span style={{ flex:1 }}>{icon} {text}</span>
        <span style={{ fontVariantNumeric:'tabular-nums', color:G.muted, fontWeight:600 }}>⏱ {mm}:{ss}</span>
      </div>
      {pct != null && (
        <div style={{ marginTop:6 }}>
          <div style={{ height:6, borderRadius:4, background:G.border, overflow:'hidden' }}><i style={{ display:'block', height:'100%', width:`${Math.max(2, Math.min(100, pct))}%`, background:G.ofertare, transition:'width .6s' }} /></div>
          {detaliu && <div style={{ fontSize:11, color:G.dim, marginTop:3 }}>{detaliu}</div>}
        </div>
      )}
      <div style={{ fontSize:11, color:G.dim, marginTop:4 }}>Lucrează în fundal — poți lăsa pagina deschisă; se actualizează singură la fiecare felie citită.</div>
    </div>
  )
}

function DocumenteSection({ licitatie, profile, onChanged, intrareDocument = null, onIntrareConsumata = null, showToast = null }) {
  const [docs, setDocs] = useState(null)
  const [upBusy, setUpBusy] = useState(null)   // text progres upload
  const [procBusy, setProcBusy] = useState(null) // text progres procesare
  const [plansaBusy, setPlansaBusy] = useState(null) // text progres citire planșă
  const [seapBusy, setSeapBusy] = useState(null) // text progres aducere din SEAP
  const stopRef = useRef(false)                // ref, nu state — loop-ul citește valoarea LIVE
  const [warn, setWarn] = useState(null)
  const [coada, setCoada] = useState(null)     // rândul din ofertare_ingest_coada (worker server-side)

  // — Impact asupra cerințelor: selecția de documente de răspuns, rularea analizei și propunerea —
  const [selDoc, setSelDoc] = useState(() => new Set())
  const [anBusy, setAnBusy] = useState(null)   // text progres analiză
  const [setRasp, setSetRasp] = useState(null) // setul curent + propunerea
  const [opSel, setOpSel] = useState(() => new Set())
  const [cerTinta, setCerTinta] = useState({}) // id → textul CURENT al cerinței (pentru diff)
  const [aplBusy, setAplBusy] = useState(false)
  const [rezAplic, setRezAplic] = useState(null)

  const [eroareDocs, setEroareDocs] = useState(null)
  const load = async () => {
    const [{ data, error }, { data: c }] = await Promise.all([
      supabase.from('ofertare_documente_atribuire')
        .select('id, nume_original, tip, status_procesare, pagini, pagini_procesate, pagini_necitite, ocr, revizie, size_bytes, eroare, fisier_path, analiza, procesat_la, procesat_de, pornit:procesat_de(name)')
        .eq('licitatie_id', licitatie.id).order('id'),
      supabase.from('ofertare_ingest_coada').select('*').eq('licitatie_id', licitatie.id).maybeSingle(),
    ])
    // Eroarea la citire era inghitita: lista ramanea `null`, ecranul arata „se incarca" la nesfarsit
    // si nimeni nu afla de ce. Acum se vede, si intrarea din Clarificari stie ca n-are pe ce lucra.
    if (error) { setEroareDocs(error.message); setWarn('Nu pot incarca documentele: ' + error.message); setDocs([]) }
    else { setEroareDocs(null); setDocs(data || []) }
    setCoada(c || null)
  }
  useEffect(() => { load() }, [licitatie.id])
  // Cât timp workerul de pe server citește, reîmprospătăm lista la 20s ca să se vadă progresul
  useEffect(() => {
    if (!coada?.activ) return
    const t = setInterval(load, 20000)
    return () => clearInterval(t)
  }, [coada?.activ, licitatie.id])

  // Citire PE SERVER (09.09.2026): coada e bătută de un cron la fiecare minut (ofertare_ingest_tick),
  // deci nu mai depinde de tab-ul deschis / laptopul treaz. La final vine notificare în clopoțel.
  const proceseazaPeServer = async () => {
    const { error } = await supabase.from('ofertare_ingest_coada')
      .upsert({ licitatie_id: licitatie.id, activ: true, cerut_de: profile?.id || null, cerut_la: new Date().toISOString(), terminat_la: null, nota: null }, { onConflict: 'licitatie_id' })
    if (error) { setWarn(`Nu am putut porni citirea pe server: ${error.message}`); return }
    setWarn(null); await load()
  }
  const opresteServer = async () => {
    await supabase.from('ofertare_ingest_coada').update({ activ: false, nota: 'oprită manual' }).eq('licitatie_id', licitatie.id)
    await load()
  }

  // Numele minte. La Potlogi, „2. formular - propunere tehnica.- POTLOGI-GAZE pdf” (spațiu în loc
  // de punct, greșit tastat de cine l-a pus în SEAP) a fost catalogat „non-PDF” și sărit — formularul
  // propunerii tehnice a zăcut necitit de la început. Verificăm și semnătura reală a fișierului:
  // orice PDF începe cu octeții %PDF-. Numele rămâne prima verificare, fiindcă e gratis.
  const areSemnaturaPdf = async (f) => {
    if (/\.pdf$/i.test(f.name)) return true
    try {
      const c = new Uint8Array(await f.slice(0, 5).arrayBuffer())
      return c[0] === 0x25 && c[1] === 0x50 && c[2] === 0x44 && c[3] === 0x46 && c[4] === 0x2D
    } catch { return false }
  }

  const urca = async (fileList) => {
    const files = Array.from(fileList || [])
    if (!files.length) return
    const arhive = files.filter(f => ARHIVA_RE.test(f.name))
    const bune = files.filter(f => !JUNK_RE.test((f.webkitRelativePath || f.name)) && !ARHIVA_RE.test(f.name))
    setWarn(arhive.length ? `⚠️ ${arhive.length} arhive sărite (${arhive.slice(0, 3).map(f => f.name).join(', ')}${arhive.length > 3 ? '…' : ''}) — dezarhivează-le local și urcă folderul rezultat.` : null)
    if (!bune.length) { setUpBusy(null); return }
    // Dedup pe (nume, mărime) DOAR față de fișierele urcate efectiv (regula 1 — dublă-ingestie).
    // Rândurile-placeholder (poziții de inventar cu cale marcată „neincarcat" — ex. planșele
    // mari notate manual) NU blochează uploadul real: altfel „0 urcate, 3 sărite" și fișierul
    // nu ajunge niciodată în storage.
    const urcate = (docs || []).filter(d => !ESTE_PLACEHOLDER(d))
    const existente = new Set(urcate.map(d => `${d.nume_original}|${d.size_bytes || ''}`))
    const placeholders = new Map((docs || []).filter(ESTE_PLACEHOLDER).map(d => [d.nume_original, d.id]))
    setUpBusy(`0/${bune.length}`)
    let ok = 0, sarite = 0
    for (let i = 0; i < bune.length; i++) {
      const f = bune[i]
      const rel = (f.webkitRelativePath || f.name).replace(/^[^/]*\//, '') // fără folderul rădăcină
      if (existente.has(`${rel}|${f.size}`) || existente.has(`${rel}|`)) { sarite++; setUpBusy(`${i + 1}/${bune.length}`); continue }
      const safe = rel.replace(/[^a-zA-Z0-9ăâîșțĂÂÎȘȚ._/-]+/g, '_').slice(-180)
      const path = `${licitatie.id}/atribuire/${Date.now().toString(36)}_${safe}`
      const { error: eUp } = await supabase.storage.from('ofertare').upload(path, f)
      if (eUp) { setWarn(`Eroare la „${rel}": ${eUp.message}`); continue }
      const estePdf = await areSemnaturaPdf(f)
      const randNou = {
        licitatie_id: licitatie.id, fisier_path: path, nume_original: rel,
        tip: ghicesteTip(rel), size_bytes: f.size,
        status_procesare: estePdf ? 'neprocesat' : 'ignorat',
        eroare: estePdf ? null : 'non-PDF — rămâne ca fișier (docx/xls/dwg se parsează în M2)',
      }
      // dacă exista un placeholder cu acest nume, îl COMPLETĂM (nu lăsăm rând dublu)
      const idPlaceholder = placeholders.get(rel)
      let idNou = idPlaceholder
      if (idPlaceholder) await supabase.from('ofertare_documente_atribuire').update(randNou).eq('id', idPlaceholder)
      else { const { data: ins } = await supabase.from('ofertare_documente_atribuire').insert(randNou).select('id').single(); idNou = ins?.id }
      ok++
      if (estePdf && f.size > 20e6 && idNou && ghicesteTip(rel) !== 'plansa') await sparge({ id: idNou, nume_original: rel }, `${(f.size / 1e6).toFixed(0)} MB — sparg în bucăți`)
      setUpBusy(`${i + 1}/${bune.length}`)
    }
    setUpBusy(null)
    if (ok || sarite) setWarn(w => [w, `✅ ${ok} fișiere urcate${sarite ? `, ${sarite} sărite (deja există — dedup)` : ''}.`].filter(Boolean).join(' '))
    await load(); onChanged?.()
  }

  // Aducerea documentației DIRECT din SEAP — nimeni nu mai descarcă/urcă manual.
  // Edge fn-ul streamuiește arhiva publică a anunțului (butonul „Descarcă documentație
  // și clarificări") și urcă fișier cu fișier; dacă nu apucă tot într-o rulare
  // întoarce continua=true și reluăm de la indexul următor.
  const aduDinSeap = async () => {
    if (!licitatie.c_notice_id || !licitatie.sys_notice_type_id) {
      const d = deduIdSeap(licitatie.nr_anunt, licitatie.link_seap)
      if (d.c_notice_id && d.sys_notice_type_id) {
        const { error } = await supabase.from('ofertare_licitatii').update(d).eq('id', licitatie.id)
        if (!error) { Object.assign(licitatie, d); await load() }
        else { setWarn('Nu am putut salva identificatorii SEAP: ' + error.message); return }
      } else {
        setWarn('⚠️ Licitația nu are identificatorii SEAP și nu îi pot deduce: completează „Link SEAP” cu adresa anunțului (…/view/<număr>) și reîncearcă.')
        return
      }
    }
    setWarn(null); setSeapBusy('mă conectez la SEAP...')
    let deLa = 0, runde = 0, adaugate = 0, completate = 0, mari = []
    while (runde < 12) {
      setSeapBusy(`descarc din SEAP${runde ? ` (continuare ${runde + 1})` : ''} — poate dura, arhiva are sute de MB...`)
      const { data, error } = await supabase.functions.invoke('ofertare-seap-import', {
        body: { licitatie_id: licitatie.id, de_la_index: deLa },
      })
      if (error || data?.error) {
        // la non-2xx supabase-js nu populeaza data — citim corpul din error.context ca sa vedem motivul real (ex. „SEAP HTTP 500")
        let motiv = data?.error
        if (!motiv && error?.context) { try { motiv = (await error.context.json())?.error } catch { /* corp gol */ } }
        motiv = motiv || error?.message || 'eroare necunoscută'
        setWarn(`Eroare SEAP: ${motiv}${/SEAP HTTP 5\d\d/.test(motiv) ? ' — serverul SEAP nu livrează arhiva momentan (nu e platforma noastră). Descarcă documentația de pe pagina anunțului din SEAP și trage folderul cu „📁 Urcă folder”.' : ''}`)
        break
      }
      adaugate += data.adaugate || 0; completate += data.completate || 0
      if (data.sarite_mari?.length) mari = [...mari, ...data.sarite_mari]
      await load()
      if (!data.continua) {
        setWarn(`✅ Din SEAP: ${adaugate} documente noi${completate ? `, ${completate} completate` : ''}${data.sarite_existente ? `, ${data.sarite_existente} existau deja` : ''}.${mari.length ? ` Sărite (prea mari): ${mari.join(', ')}.` : ''}`)
        break
      }
      deLa = data.next_index; runde++
    }

    // A doua trecere, pentru ce a rămas: la arhivele foarte mari (sute de MB) bugetul
    // edge function-ului se consumă pe octeții parcurși, așa că documentele de la coada
    // arhivei nu sunt atinse. Aceeași treabă o face /api/seap-import (pe Vercel), unde
    // arhiva se poate parcurge integral într-o singură trecere.
    const { data: raman } = await supabase.from('ofertare_documente_atribuire')
      .select('id').eq('licitatie_id', licitatie.id).like('fisier_path', '%/neincarcat/%')
    if (raman?.length) {
      setSeapBusy(`aduc documentele grele (${raman.length}) — poate dura câteva minute...`)
      try {
        const { data: sesiune } = await supabase.auth.getSession()
        const r = await fetch('/api/seap-import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sesiune?.session?.access_token || ''}` },
          body: JSON.stringify({ licitatie_id: licitatie.id }),
        })
        const rez = await r.json().catch(() => ({}))
        if (r.ok) {
          adaugate += rez.adaugate || 0; completate += rez.completate || 0
          setWarn(`✅ Din SEAP: ${adaugate} documente noi${completate ? `, ${completate} completate` : ''}.${rez.erori?.length ? ` Rămase: ${rez.erori.slice(0, 2).join('; ')}` : ''}`)
        } else {
          setWarn(w => `${w || ''} ⚠️ Documentele grele nu au putut fi aduse: ${rez.error || `HTTP ${r.status}`}`)
        }
      } catch (e) {
        setWarn(w => `${w || ''} ⚠️ Documentele grele nu au putut fi aduse: ${e.message}`)
      }
    }
    setSeapBusy(null); await load(); onChanged?.()
  }

  // Procesare secvențială cu continuare — un doc pe rând, apeluri repetate cât continua=true.
  // Robustețe (cerut de Razvan 26.08): eroarea pe un document primește AUTO-RETRY
  // (pauză + reîncercare — worker-ul edge crapă intermitent pe PDF-uri grele),
  // la finalul cozii se face O A DOUA TRECERE peste restanțe, iar dacă tot rămân
  // erori pleacă NOTIFICARE în clopoțel (nu doar un text care dispare de pe ecran).
  const proceseazaDoc = async (d, eticheta) => {
    let continua = true, runde = 0, incercariEsuate = 0
    while (continua && runde < 60 && !stopRef.current) {
      setProcBusy(`${eticheta} · ${d.nume_original.split('/').pop()} (rundă ${runde + 1})`)
      const { data, error } = await supabase.functions.invoke('ofertare-ingest-doc', { body: { doc_id: d.id } })
      if (error || data?.error) {
        incercariEsuate++
        if (incercariEsuate > 2) { setWarn(`Eroare persistentă la „${d.nume_original}": ${data?.error || error.message}`); return false }
        setProcBusy(`${eticheta} · ${d.nume_original.split('/').pop()} — reîncerc (${incercariEsuate}/2)...`)
        await new Promise(r => setTimeout(r, 5000))
        continue
      }
      incercariEsuate = 0
      continua = !!data?.continua
      runde++
    }
    return !continua
  }

  // ANTI-BUG 15.09.2026 (prins de Răzvan pe DF1278266 + Clinceni): la „Procesează" intrau
  // două categorii de fișiere care n-aveau ce căuta acolo, fiecare cu zeci de MB citiți degeaba:
  //  1. PLANȘELE — au calea lor („📐 citește", ofertare-plansa-citeste); o scanare A0 citită ca
  //     PDF obișnuit nu dă text util, rămâne agățată pe „în lucru" și se reia la fiecare trecere.
  //  2. FIȘIERELE DEJA SPARTE — originalul de 84 MB, citit peste bucățile lui deja procesate:
  //     cost dublu, dar mai grav e că textul ar intra DE DOUĂ ORI în registrul de cerințe.
  // Marcajul „spart în N bucăți" trăia doar în textul din `eroare` și se pierdea la re-import
  // (veghea readuce fișierul ca rând nou, curat). De aceea regula se deduce din REALITATE:
  // dacă există bucăți pe numele lui, fișierul e spart — indiferent ce scrie în `eroare`.
  // Numele minte, partea a doua: SEAP normalizeaza "(2)" in " 2", deci extensia nu mai e la final
  // („Caiet de sarcini-LA PT.pdf 2"). Cu `\.pdf$` fisierele alea erau sarite TACUT si nu se citeau
  // niciodata. Acelasi tipar in ofertare_doc_de_citit (SQL) si in ofertare-ingest-doc.
  const E_PDF = /\.pdf *\d*$/i

  const areBucati = (d, toate) => {
    const baza = String(d.nume_original || '').replace(/\.pdf$/i, '')
    if (!baza) return false
    return (toate || []).some(x => x.id !== d.id &&
      new RegExp('^' + baza.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' — p\\d+_pag[\\d-]+\\.pdf$', 'i').test(x.nume_original || ''))
  }
  const deCititCaPdf = (ds) => (ds || []).filter(d =>
    ['neprocesat', 'in_lucru', 'eroare'].includes(d.status_procesare) &&
    E_PDF.test(d.nume_original || '') &&
    d.tip !== 'plansa' &&
    !areBucati(d, ds))

  const proceseaza = async () => {
    const listaPdf = deCititCaPdf
    let deRulat = listaPdf(docs)
    if (!deRulat.length) return
    // întâi sparg PDF-urile mari (altfel ingestia cade tăcut pe ele)
    const mari = deRulat.filter(eMare)
    if (mari.length) {
      for (const d of mari) await sparge(d, `${((d.size_bytes || 0) / 1e6).toFixed(0)} MB — sparg înainte de procesare`)
      const { data: fresh } = await supabase.from('ofertare_documente_atribuire').select('id, nume_original, status_procesare, size_bytes, tip, eroare').eq('licitatie_id', licitatie.id)
      deRulat = listaPdf(fresh)
      await load()
      if (!deRulat.length) return
    }
    stopRef.current = false
    // 3 documente ÎN PARALEL (cerut de Razvan — serial dura ~90 min pe un fixture);
    // edge functions scalează orizontal, fiecare doc e independent
    const PARALEL = 3
    for (let trecere = 1; trecere <= 2 && deRulat.length && !stopRef.current; trecere++) {
      let urmatorul = 0
      const total = deRulat.length
      const lucrator = async () => {
        while (!stopRef.current) {
          const idx = urmatorul++
          if (idx >= total) return
          const d = deRulat[idx]
          await proceseazaDoc(d, `${trecere === 2 ? 'reluare ' : ''}${idx + 1}/${total} (3 în paralel)`)
          await load()
        }
      }
      await Promise.all(Array.from({ length: Math.min(PARALEL, total) }, () => lucrator()))
      // A doua trecere: doar restanțele (eroare / neterminate)
      const { data: fresh } = await supabase.from('ofertare_documente_atribuire')
        .select('id, nume_original, status_procesare').eq('licitatie_id', licitatie.id)
      deRulat = listaPdf(fresh)
    }
    // Restanțe după ambele treceri → notificare persistentă în clopoțel
    if (deRulat.length && !stopRef.current && profile?.id) {
      await supabase.from('notifications').insert({
        // modul are CHECK în BD pe lista fixă de module (Comercial e cel al ofertării);
        // cu 'ofertare' insertul pica silențios și notificarea nu ajungea niciodată
        profile_id: profile.id, type: 'warning', modul: 'Comercial',
        title: `Ofertare: ${deRulat.length} documente neprocesate la ${licitatie.nr_anunt}`,
        message: `După 2 treceri au rămas cu probleme: ${deRulat.slice(0, 3).map(d => d.nume_original.split('/').pop()).join(', ')}${deRulat.length > 3 ? '…' : ''}. Deschide licitația și apasă „Procesează" din nou, sau lasă platforma să le spargă în bucăți mai mici (documentele mari se sparg automat).`,
        link_to: '/ofertare',
      })
      setWarn(`⚠️ ${deRulat.length} documente au rămas neprocesate după 2 treceri — ai primit notificare în clopoțel.`)
    }
    setProcBusy(null); stopRef.current = false
    await load(); onChanged?.()
  }

  const nrDeProcesat = deCititCaPdf(docs).length
  const fmtMB = b => b ? (b / 1e6).toFixed(1) + ' MB' : ''

  // Planșele mari nu se pot citi dintr-o bucată (o scanare A0 are ~140 de milioane de
  // pixeli), așa că se taie în felii care se suprapun și se citesc pe rând. De aici ies
  // tabelele de dimensionare — adică lungimile reale pe tronsoane și diametre.
  // Regula PDF-uri mari (Răzvan 07.09.2026): > 20 MB → /api/pdf-sparge (Vercel, pdf-lib) le taie pe pagini în bucăți ≤ 15 MB;
  // bucățile intră la procesare, originalul rămâne „🔀 spart în N”. Se apelează automat la urcare și înainte de „Procesează”.
  const sparge = async (d, eticheta) => {
    setPlansaBusy(`🔀 ${d.nume_original}: ${eticheta || 'sparg în bucăți'}…`)
    try {
      const { data: sesiune } = await supabase.auth.getSession()
      const r = await fetch('/api/pdf-sparge', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sesiune?.session?.access_token || ''}` }, body: JSON.stringify({ doc_id: d.id }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) setWarn(`Nu am putut sparge „${d.nume_original}”: ${j.error || `HTTP ${r.status}`}`)
      else if (j.plansa) setWarn(`📐 „${d.nume_original}”: ${j.motiv} — se citește ca planșă.`)
      else if (j.bucati) setWarn(w => [w, `🔀 „${d.nume_original}” spart în ${j.bucati} bucăți (${j.pagini} pagini) — intră la procesare.`].filter(Boolean).join(' '))
      return j
    } catch (e) { setWarn(`Spargere eșuată: ${e.message}`); return null }
    finally { setPlansaBusy(null) }
  }
  // `areBucati` e plasa de siguranță: marcajul din `eroare` se pierde la re-import, bucățile nu.
  const eMare = d => E_PDF.test(d.nume_original || '') && (d.size_bytes || 0) > 20e6 && !/spart .*în \d+ bucăți/i.test(d.eroare || '') && !areBucati(d, docs) && d.tip !== 'plansa' && ['neprocesat', 'in_lucru', 'eroare'].includes(d.status_procesare)

  const citestePlansa = async (d) => {
    setWarn(null); setPlansaBusy(`${d.nume_original}: pregătesc feliile...`)
    try {
      const { data: sesiune } = await supabase.auth.getSession()
      const tok = sesiune?.session?.access_token || ''
      const r = await fetch('/api/plansa-felii', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ doc_id: d.id }),
      })
      const felii = await r.json().catch(() => ({}))
      if (!r.ok) { setWarn(`Nu am putut pregăti planșa: ${felii.error || `HTTP ${r.status}`}`); return }
      if (felii.citibila === false) { setWarn(`⚠️ ${felii.motiv}`); await load(); return }

      let deLa = 0, runde = 0, sumar = null
      while (runde < 15) {
        setPlansaBusy(`${d.nume_original}: citesc ${deLa + 1}–${Math.min(deLa + 4, felii.felii)} din ${felii.felii} zone...`)
        const { data, error } = await supabase.functions.invoke('ofertare-plansa-citeste', { body: { doc_id: d.id, de_la: deLa } })
        if (error || data?.error) { setWarn(`Eroare la citire: ${data?.error || error.message}`); break }
        sumar = data.sumar
        if (!data.continua) break
        deLa = data.de_la_urmator; runde++
      }
      if (sumar) {
        setWarn(`✅ Planșă citită: ${sumar.tronsoane_gasite} tronsoane (${sumar.lungime_totala_m.toLocaleString('ro-RO')} m)` +
          `${sumar.tabele.length ? `, tabele: ${sumar.tabele.join(', ')}` : ''}` +
          `${sumar.subtraversari ? `, ${sumar.subtraversari} subtraversări` : ''}` +
          `${sumar.erori ? ` — ${sumar.erori} zone cu erori` : ''}.`)
      }
    } catch (e) {
      setWarn(`Eroare la citirea planșei: ${e.message}`)
    } finally {
      setPlansaBusy(null); await load(); onChanged?.()
    }
  }

  // Documentele care pot intra într-un set de răspuns: doar cele din care s-a extras text.
  const potIntra = (d) => ['procesat', 'partial'].includes(d.status_procesare) && !d.fisier_path?.includes('/neincarcat/')

  // Intrarea din Clarificari: bifeaza documentul cerut si atat — analiza o porneste tot omul, cu
  // butonul ei, fiindca ea costa bani. Se consuma o SINGURA data (ref, nu state: in StrictMode
  // efectul ruleaza de doua ori si a doua oara ar rebifa peste ce a schimbat omul intre timp).
  const intrareTratata = useRef(null)
  useEffect(() => {
    const intentie = intrareDocument
    if (!intentie || intrareTratata.current === intentie.id) return
    if (String(intentie.licitatieId) !== String(licitatie.id)) return
    if (docs === null) return                       // inca se incarca lista: asteptam, nu ratam intrarea
    intrareTratata.current = intentie.id
    const d = (docs || []).find(x => String(x.id) === String(intentie.documentId))
    const motiv = eroareDocs ? 'Documentele nu s-au putut incarca: ' + eroareDocs
      : !d ? 'Documentul legat de clarificare nu mai e in licitatia asta.'
      : !potIntra(d) ? 'Documentul legat nu are text extras — proceseaza-l intai, apoi bifeaza-l.'
      : null
    if (motiv) { setWarn(motiv); showToast?.(motiv, 'err') }
    else setSelDoc(new Set([d.id]))
    onIntrareConsumata?.(intentie.id)
  }, [intrareDocument, licitatie.id, docs, eroareDocs])

  const incarcaSet = async (setId) => {
    const { data: st, error } = await supabase.from('ofertare_raspuns_set')
      .select('id, titlu, lot, stare, propunere, cost_usd, aplicat_la').eq('id', setId).maybeSingle()
    if (error) { setWarn('Nu pot citi propunerea: ' + error.message); return null }
    setSetRasp(st)
    const ids = [...new Set(((st?.propunere?.operatii) || []).map(o => o.cerinta_id).filter(Boolean))]
    if (ids.length) {
      const { data: cc } = await supabase.from('ofertare_cerinte').select('id, text_cerinta, lot, tip').in('id', ids)
      const m = {}; (cc || []).forEach(c => { m[c.id] = c })
      setCerTinta(m)
    } else setCerTinta({})
    // Bifele pornesc NEBIFATE: omul alege ce aplică, nu debifează ce i s-a ales.
    setOpSel(new Set())
    setRezAplic(null)
    return st
  }

  const ruleazaAnaliza = async () => {
    const alese = (docs || []).filter(d => selDoc.has(d.id))
    if (!alese.length) return
    setWarn(null); setRezAplic(null)
    try {
      setAnBusy('pregătesc setul de răspuns…')
      const inv = async (b) => await supabase.functions.invoke('ofertare-raspuns-set', { body: b })
      const { data: cr, error: eCr } = await inv({
        actiune: 'creeaza_set', licitatie_id: licitatie.id,
        document_ids: alese.map(d => d.id),
        // Lotul rămâne NEDECLARAT în mod deliberat: folderul minte. Documentele din „LOT2" conțin
        // întrebări „pentru Lot 1, Lot 2, Lot 3", iar un filtru pe lot ar scoate din registru exact
        // cerințele la care se referă răspunsul. Lotul se pune pe operație, nu pe set.
        lot: null,
      })
      if (eCr || cr?.error) { setWarn('Creare set: ' + (cr?.error || eCr.message)); setAnBusy(null); return }
      const setId = cr.set.id
      if (cr.excluse?.length) setWarn(`${cr.excluse.length} document(e) excluse: ` + cr.excluse.map(x => `${x.nume || x.id} (${x.motiv})`).join('; '))

      // faza 1 — inventar, un document pe rundă
      for (let i = 0; i < 30; i++) {
        setAnBusy(`citesc documentul ${i + 1} din ${cr.documente.length}…`)
        const { data, error } = await inv({ actiune: 'inventar', set_id: setId })
        if (error || data?.error) { setWarn('Inventar: ' + (data?.error || error.message)); break }
        if (!data.continua) break
      }
      // faza 2 — comparare cu registrul
      for (let i = 0; i < 20; i++) {
        setAnBusy(`compar cu registrul de cerințe… (runda ${i + 1})`)
        const { data, error } = await inv({ actiune: 'compara', set_id: setId })
        if (error || data?.error) { setWarn('Comparare: ' + (data?.error || error.message)); break }
        if (!data.continua) break
      }
      await incarcaSet(setId)
    } catch (e) {
      setWarn('Analiză: ' + e.message)
    } finally { setAnBusy(null) }
  }

  const aplicaSelectia = async () => {
    if (!setRasp || !opSel.size) return
    const dupaDepunere = licitatie.status === 'depusa'
    let motiv = null
    if (dupaDepunere) {
      motiv = prompt('Licitația e DEPUSĂ. Confirmi actualizarea registrului după depunere și îți asumi reverificarea impactului asupra ofertei?\n\nScrie motivul (obligatoriu):')
      if (!motiv || !motiv.trim()) { setWarn('Aplicare anulată — pe o licitație depusă motivul e obligatoriu.'); return }
    }
    setAplBusy(true); setWarn(null)
    try {
      const { data, error } = await supabase.functions.invoke('ofertare-raspuns-set', {
        body: { actiune: 'aplica', set_id: setRasp.id, op_ids: [...opSel],
          dupa_depunere: dupaDepunere, motiv, idempotency_key: `${setRasp.id}-${[...opSel].sort().join('.')}` },
      })
      if (error || data?.error) { setWarn('Aplicare: ' + (data?.error || error.message)); return }
      setRezAplic(data)
      await incarcaSet(setRasp.id)
      onChanged?.()
    } finally { setAplBusy(false) }
  }

  return (
    <div style={{ marginTop:16, padding:14, borderRadius:10, border:`1px solid ${G.border}`, background:G.bg }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10, flexWrap:'wrap' }}>
        <div style={{ fontSize:13, fontWeight:800 }}>📥 Documentația de atribuire {docs ? `(${docs.length})` : ''}</div>
        {/* Clopoțel separat pe secțiune (cerut de Razvan): erorile rămân vizibile
            oricând reintri în pagină, nu doar cât rulează procesarea */}
        {(docs || []).some(d => d.status_procesare === 'eroare') && (
          <span style={{ fontSize:11, fontWeight:800, color:G.red, background:G.red + '18', border:`1px solid ${G.red}66`, borderRadius:12, padding:'3px 10px' }}>
            🔔 {(docs || []).filter(d => d.status_procesare === 'eroare').length} cu erori — apasă Procesează pentru reluare
          </span>
        )}
        <div style={{ marginLeft:'auto', display:'flex', gap:8 }}>
          {selDoc.size > 0 && !anBusy && (
            <button style={{ ...S.btnP, padding:'7px 12px', fontSize:12, background:G.purple }} onClick={ruleazaAnaliza}
              title="Citește răspunsul autorității și propune ce se schimbă în registrul de cerințe. Nimic nu se aplică fără bifa ta.">
              🔍 Analizează impactul ({selDoc.size})
            </button>
          )}
          {!seapBusy && (
            <button style={{ ...S.btnP, padding:'7px 12px', fontSize:12 }} disabled={!!upBusy || !!procBusy} onClick={aduDinSeap}
              title="Descarcă singură toată documentația publicată în SEAP (inclusiv planșele de zeci de MB)">
              ⬇️ Adu din SEAP
            </button>
          )}
          <label style={{ ...S.btnS, padding:'7px 12px', fontSize:12, cursor:'pointer' }}>
            📁 Urcă folder
            <input type="file" webkitdirectory="" directory="" multiple style={{ display:'none' }}
              disabled={!!upBusy} onChange={e => { urca(e.target.files); e.target.value = '' }} />
          </label>
          <label style={{ ...S.btnS, padding:'7px 12px', fontSize:12, cursor:'pointer' }}>
            📄 Urcă fișiere
            <input type="file" multiple style={{ display:'none' }}
              disabled={!!upBusy} onChange={e => { urca(e.target.files); e.target.value = '' }} />
          </label>
          {/* Poarta pe cheltuială (14.09.2026): citirea integrală o pornește doar ownerul sau responsabilul.
              Restul echipei face trierea din fișa de date (tab ⚡ Triere) — un apel, nu 40. */}
          {nrDeProcesat > 0 && !procBusy && !coada?.activ && !poatePorniProcesarea(profile, licitatie) && (
            <span style={{ fontSize:11.5, color:G.dim, alignSelf:'center' }} title={MOTIV_POARTA}>🔒 {nrDeProcesat} de citit — pornește ownerul / responsabilul</span>
          )}
          {nrDeProcesat > 0 && !procBusy && !coada?.activ && poatePorniProcesarea(profile, licitatie) && (
            <button style={{ ...S.btnP, padding:'7px 12px', fontSize:12 }} onClick={proceseaza}>🤖 Procesează ({nrDeProcesat})</button>
          )}
          {nrDeProcesat > 0 && !procBusy && !coada?.activ && poatePorniProcesarea(profile, licitatie) && (
            <button style={{ ...S.btnS, padding:'7px 12px', fontSize:12 }} onClick={proceseazaPeServer}
              title="Citirea rulează pe server, câte 3 documente pe minut — poți închide tab-ul; primești notificare în clopoțel când se termină">
              ☁️ Pe server
            </button>
          )}
          {coada?.activ && (
            <button style={{ ...S.btnS, padding:'7px 12px', fontSize:12, color:G.red, borderColor:G.red + '66' }} onClick={opresteServer}>⏹ Oprește serverul</button>
          )}
          {procBusy && (
            <button style={{ ...S.btnS, padding:'7px 12px', fontSize:12, color:G.red, borderColor:G.red + '66' }} onClick={() => { stopRef.current = true }}>⏹ Oprește</button>
          )}
        </div>
      </div>
      {seapBusy && <Lucru icon="⬇️" text={`SEAP: ${seapBusy}`} />}
      {upBusy && <Lucru icon="⬆️" text={`Se urcă… ${upBusy}`} />}
      {procBusy && (() => {
        const rel = (docs || []).filter(d => E_PDF.test(d.nume_original || '') && ['neprocesat', 'in_lucru', 'procesat', 'partial'].includes(d.status_procesare))
        const tot = rel.reduce((a, d) => a + (d.pagini || 0), 0)
        const done = rel.reduce((a, d) => a + (d.status_procesare === 'procesat' ? (d.pagini || 0) : d.status_procesare === 'partial' ? Math.max(0, (d.pagini || 0) - (d.pagini_necitite?.length || 0)) : (d.pagini_procesate || 0)), 0)
        const ramase = rel.filter(d => !['procesat', 'partial'].includes(d.status_procesare)).length
        return <Lucru icon="🤖" text={`AI citește: ${procBusy}`} pct={tot ? Math.round(100 * done / tot) : null} detaliu={tot ? `${done}/${tot} pagini citite · ${ramase} documente rămase` : `${ramase} documente rămase`} />
      })()}
      {coada?.activ && !procBusy && (() => {
        const rel = (docs || []).filter(d => E_PDF.test(d.nume_original || '') && ['neprocesat', 'in_lucru', 'procesat', 'partial'].includes(d.status_procesare))
        const tot = rel.reduce((a, d) => a + (d.pagini || 0), 0)
        const done = rel.reduce((a, d) => a + (d.status_procesare === 'procesat' ? (d.pagini || 0) : d.status_procesare === 'partial' ? Math.max(0, (d.pagini || 0) - (d.pagini_necitite?.length || 0)) : (d.pagini_procesate || 0)), 0)
        const ramase = rel.filter(d => !['procesat', 'partial'].includes(d.status_procesare)).length
        return <Lucru icon="☁️" text="Serverul citește documentația (poți închide pagina)" pct={tot ? Math.round(100 * done / tot) : null} detaliu={`${done}/${tot} pagini citite · ${ramase} documente rămase · ${coada.lansari || 0} lansări`} />
      })()}
      {coada && !coada.activ && coada.terminat_la && (
        <div style={{ fontSize:12, color:G.green, marginBottom:8 }}>☁️ Citire pe server terminată {new Date(coada.terminat_la).toLocaleString('ro-RO')}: {coada.nota}</div>
      )}
      {plansaBusy && <Lucru icon="📐" text={plansaBusy} />}
      {anBusy && <Lucru icon="🔍" text={`Impact asupra cerințelor: ${anBusy}`} />}
      {warn && <div style={{ fontSize:12, color:G.orange, marginBottom:8 }}>{warn}</div>}

      {docs === null ? <div style={{ fontSize:12, color:G.muted }}>Se încarcă...</div> :
        !docs.length ? (
          <div style={{ fontSize:12, color:G.dim }}>
            Niciun document încă. Dezarhivează local documentația din SEAP (7z/rar/zip nu se urcă direct) și trage folderul cu „📁 Urcă folder" — apoi „🤖 Procesează" extrage textul, antetele și reviziile.
          </div>
        ) : (
          <div style={{ maxHeight:260, overflowY:'auto', display:'flex', flexDirection:'column', gap:3 }}>
            {docs.map(d => {
              const st = DOC_STATUS[d.status_procesare] || DOC_STATUS.neprocesat
              // Eticheta „🔀 spart în N": întâi din realitate (câte bucăți există), apoi din textul
              // din `eroare` — textul se pierde la re-import, bucățile nu (anti-bug 15.09.2026).
              const nrBucati = areBucati(d, docs)
                ? docs.filter(x => new RegExp('^' + String(d.nume_original || '').replace(/\.pdf$/i, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' — p\\d+_pag[\\d-]+\\.pdf$', 'i').test(x.nume_original || '')).length
                : 0
              const spart = nrBucati ? [null, String(nrBucati)] : (d.status_procesare === 'ignorat' && /spart .*în (\d+) bucăți/i.exec(d.eroare || ''))
              const formularXml = d.status_procesare === 'ignorat' && /\.xml$/i.test(d.nume_original || '')
              return (
                <div key={d.id} style={{ display:'flex', alignItems:'center', gap:8, fontSize:12, padding:'5px 8px', borderRadius:6, background:G.surface }}>
                  {/* Bifa pentru setul de răspuns. Deliberat pe TOATE documentele cu text, nu doar pe
                      cele de tip „raspuns_clarificare": pe licitația 1 un răspuns real stă pe tip „alta". */}
                  <input type="checkbox" title={potIntra(d) ? 'Include în setul de răspuns de analizat' : 'Fără text extras — nu poate intra în analiză'}
                    disabled={!potIntra(d) || !!anBusy} checked={selDoc.has(d.id)}
                    onChange={e => setSelDoc(prev => { const n = new Set(prev); e.target.checked ? n.add(d.id) : n.delete(d.id); return n })} />
                  {/* Trasabilitate pe cheltuială (15.09.2026): la „cine a pornit procesarea pe asta?" nu exista
                      răspuns nicăieri. procesat_de se scrie în ofertare-ingest-doc din identitatea verificată acolo.
                      Documentele citite înainte de 15.09.2026 au NULL — de aceea eticheta cade pe eroare/gol. */}
                  <span style={{ color: spart ? G.ofertare : st.color, fontWeight:700, minWidth:86 }}
                    title={d.pornit?.name ? `Citire pornită de ${d.pornit.name}${d.procesat_la ? ` · ${new Date(d.procesat_la).toLocaleString('ro-RO')}` : ''}` : (d.eroare || '')}>
                    {spart ? `🔀 spart în ${spart[1]}` : formularXml ? '📎 formular' : st.label}
                  </span>
                  <span style={{ flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={d.eroare || d.nume_original}>
                    {d.nume_original}
                    {spart && <span style={{ color:G.muted, fontStyle:'italic' }}> — prea mare, s-a spart în {spart[1]} bucăți; se citesc bucățile, fișierul acesta NU intră în analiză</span>}
                    {formularXml && <span style={{ color:G.muted, fontStyle:'italic' }}> — DUAE/formular SEAP: se completează la depunere, nu se citește</span>}
                  </span>
                  <span style={{ color:G.dim, whiteSpace:'nowrap' }}>
                    {d.tip}{d.revizie ? ` · rev ${d.revizie}` : ''}{d.ocr ? ' · scan' : ''}
                    {d.pornit?.name && <span title={`Citire pornită de ${d.pornit.name}${d.procesat_la ? ` · ${new Date(d.procesat_la).toLocaleString('ro-RO')}` : ''}`}> · 👤 {d.pornit.name.split(' ')[0]}</span>}
                  </span>
                  <span style={{ color:G.dim, whiteSpace:'nowrap' }}>
                    {d.status_procesare === 'in_lucru' && d.pagini ? `${d.pagini_procesate}/${d.pagini} pag` : d.pagini ? `${d.pagini} pag` : fmtMB(d.size_bytes)}
                    {d.status_procesare === 'partial' && d.pagini_necitite?.length > 0 && (
                      <span style={{ color:G.orange, marginLeft:6 }} title={`Pagini necitite: ${d.pagini_necitite.join(', ')}`}>· {d.pagini_necitite.length} necitite</span>
                    )}
                  </span>
                  {d.status_procesare === 'in_lucru' && (
                    <span title={d.pagini ? `${Math.round(100 * (d.pagini_procesate || 0) / d.pagini)}%` : 'se pregătește'} style={{ width:64, height:5, borderRadius:3, background:G.border, overflow:'hidden', flexShrink:0 }}>
                      <i style={{ display:'block', height:'100%', width:`${d.pagini ? Math.max(3, Math.round(100 * (d.pagini_procesate || 0) / d.pagini)) : 3}%`, background:G.ofertare }} />
                    </span>
                  )}
                  {eMare(d) && (
                    <button style={{ ...S.btnS, padding:'2px 8px', fontSize:11, color:G.ofertare, borderColor:G.ofertare + '66' }} disabled={!!plansaBusy} title="PDF peste 20 MB — citirea AI cade pe el; îl sparg în bucăți ≤ 15 MB"
                      onClick={async () => { await sparge(d); await load() }}>🔀 sparge</button>
                  )}
                  {d.tip === 'plansa' && !d.fisier_path?.includes('/neincarcat/') && poatePorniProcesarea(profile, licitatie) && (
                    <button style={{ ...S.btnS, padding:'2px 8px', fontSize:11 }} disabled={!!plansaBusy}
                      title={d.analiza?.citire_ai ? 'Citește din nou planșa cu AI' : 'Taie planșa în zone și citește tabelele și adnotările'}
                      onClick={() => citestePlansa(d)}>
                      {d.analiza?.citire_ai ? '📐 recitește' : '📐 citește'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}

      {/* ── Impact asupra cerințelor ─────────────────────────────────────────────
          Antetul spune din prima cât se schimbă și câte acoperiri rămân de reverificat.
          Bifele pornesc NEBIFATE: omul alege ce aplică. Aplicarea trimite ID-uri de
          operații, nu texte — serverul execută exact ce a generat el însuși. */}
      {setRasp && (() => {
        const ops = (setRasp.propunere?.operatii) || []
        const ac = setRasp.propunere?.acoperire || []
        const disp = setRasp.propunere?.dispozitii || []
        const efect = disp.filter(d => d.tip === 'efect_posibil').length
        const comparate = (setRasp.propunere?.dispozitii_comparate || []).length
        const grupe = [
          ['anuleaza', '⛔ Anulări', G.red],
          ['modifica', '✏️ Modificări', G.orange],
          ['noua', '➕ Cerințe noi', G.teal],
        ]
        const netrecut = ac.some(x => x.acoperit_tot === false)
        // O analiza e completa doar daca s-a citit tot SI fiecare dispozitie comparata a primit
        // verdict SI codul n-a respins nimic. Oricare din cele trei lipseste → nu se da concluzie.
        const analizaIncompleta = netrecut || (setRasp.propunere?.sold > 0)
          || Object.keys(setRasp.propunere?.aruncate || {}).length > 0
        return (
          <div style={{ marginTop:14, padding:14, borderRadius:10, border:`1px solid ${G.purple}55`, background:G.purple + '0D' }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', marginBottom:8 }}>
              <div style={{ fontWeight:800, fontSize:13 }}>🔍 Impact asupra cerințelor — {setRasp.titlu}</div>
              <button style={{ ...S.btnS, padding:'3px 9px', fontSize:11 }} onClick={() => { setSetRasp(null); setOpSel(new Set()); setRezAplic(null) }}>✕ închide</button>
              <span style={{ marginLeft:'auto', fontSize:11, color:G.dim }}>
                {setRasp.lot ? `lot ${setRasp.lot} · ` : ''}{Number(setRasp.cost_usd || 0).toFixed(2)} $
              </span>
            </div>

            <div style={{ fontSize:12.5, marginBottom:6 }}>
              <b>{ops.length}</b> {ops.length === 1 ? 'schimbare propusă' : 'schimbări propuse'}
              {ops.length > 0 && <> · {grupe.map(([k, lbl]) => ops.filter(o => o.fel === k).length ? <span key={k} style={{ marginRight:8 }}>{lbl.split(' ')[0]} {ops.filter(o => o.fel === k).length}</span> : null)}</>}
            </div>
            {/* Indicatorul de acoperire: „fără efect" e credibil doar dacă s-a citit tot. */}
            <div style={{ fontSize:11.5, color:G.muted, marginBottom:10 }}>
              Din {disp.length} dispoziții citite: <b style={{ color:G.text }}>{efect}</b> cu efect posibil ({comparate} comparate),
              {' '}{disp.filter(d => d.tip === 'confirmare').length} confirmări („se menține"),
              {' '}{disp.filter(d => d.tip === 'neclar').length} neclare.
              {netrecut && <span style={{ color:G.orange }}> ⚠ un document nu a fost parcurs integral — rezultatul e incomplet.</span>}
            </div>
            {/* Ce a aruncat codul si ce nu s-a inchis. Fara randurile astea, o analiza care a pierdut
                jumatate din operatii arata pe ecran exact ca una curata. */}
            {(setRasp.propunere?.sold > 0 || Object.keys(setRasp.propunere?.aruncate || {}).length > 0) && (
              <div style={{ fontSize:12.5, color:G.orange, marginBottom:10, padding:'8px 10px', borderRadius:7, background:G.orange + '14', border:`1px solid ${G.orange}55` }}>
                {setRasp.propunere?.sold > 0 && (
                  <div>⚠ <b>{setRasp.propunere.sold} dispoziții fără verdict</b> — au fost trimise la comparare și n-au ieșit nici ca schimbare, nici ca „neclar":
                    {' '}{(setRasp.propunere?.fara_rezultat || []).map(x => x.nr || x.disp_id).join(', ')}. Reia analiza înainte să te bazezi pe rezultat.</div>
                )}
                {Object.entries(setRasp.propunere?.aruncate || {}).map(([m, n]) => (
                  <div key={m}>⚠ {n} {n === 1 ? 'propunere respinsă' : 'propuneri respinse'} de verificările platformei: {m}.</div>
                ))}
              </div>
            )}

            {/* „Fara efect" e o CONCLUZIE, si se poate da numai peste o analiza completa. Daca s-au pierdut
                dispozitii pe drum sau codul a respins propuneri, verdele dispare: la 23 noaptea omul
                citeste concluzia, nu avertismentul de deasupra ei. */}
            {!ops.length ? (
              <div style={{ fontSize:12.5, color: analizaIncompleta ? G.orange : G.green, fontWeight: analizaIncompleta ? 700 : 400 }}>
                {analizaIncompleta ? 'Analiză incompletă — impactul asupra cerințelor e încă nedeterminat. Reia analiza; vezi mai sus ce a rămas nerezolvat.'
                  : 'Nicio schimbare în registru. Răspunsul confirmă documentația existentă.'}
              </div>
            ) : grupe.map(([fel, titlu, culoare]) => {
              const lista = ops.filter(o => o.fel === fel)
              if (!lista.length) return null
              return (
                <div key={fel} style={{ marginBottom:10 }}>
                  <div style={{ fontSize:11.5, fontWeight:800, color:culoare, marginBottom:4 }}>{titlu} ({lista.length})</div>
                  {lista.map(o => {
                    const vechi = cerTinta[o.cerinta_id]
                    const bifat = opSel.has(o.op_id)
                    return (
                      <div key={o.op_id} style={{ display:'flex', gap:9, padding:'8px 10px', marginBottom:5, borderRadius:8,
                        background:'#1C2430', borderLeft:`3px solid ${o.necesita_revizuire ? G.orange : culoare}` }}>
                        <input type="checkbox" checked={bifat} disabled={aplBusy}
                          onChange={e => setOpSel(prev => { const n = new Set(prev); e.target.checked ? n.add(o.op_id) : n.delete(o.op_id); return n })} />
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:12.5 }}>
                            {o.cerinta_id ? <b>#{o.cerinta_id}</b> : <b style={{ color:G.teal }}>cerință nouă</b>}
                            {' '}<span style={{ color:G.muted }}>{o.motiv}</span>
                          </div>
                          {vechi && <div style={{ fontSize:12, color:G.dim, marginTop:4, textDecoration: fel === 'anuleaza' ? 'line-through' : 'none' }}>− {vechi.text_cerinta}</div>}
                          {(o.text_nou || o.text_cerinta) && <div style={{ fontSize:12, color:G.green, marginTop:2 }}>+ {o.text_nou || o.text_cerinta}</div>}
                          <div style={{ fontSize:11, color:G.muted, marginTop:5, fontStyle:'italic' }}>„{o.sursa_pasaj}"</div>
                          {o.necesita_revizuire && (
                            <div style={{ fontSize:11, color:G.orange, marginTop:4 }}>
                              ⚠ de revizuit: schimbarea pare să privească doar un lot, iar cerința e comună. Verifică înainte de a bifa.
                            </div>
                          )}
                        </div>
                        <span style={{ fontSize:10.5, fontWeight:800, whiteSpace:'nowrap',
                          color: o.incredere === 'ridicata' ? G.green : o.incredere === 'medie' ? G.orange : G.red }}>{o.incredere}</span>
                      </div>
                    )
                  })}
                </div>
              )
            })}

            {ops.length > 0 && (
              <div style={{ display:'flex', alignItems:'center', gap:10, marginTop:10, flexWrap:'wrap' }}>
                <button style={{ ...S.btnS, padding:'5px 11px', fontSize:11.5 }} disabled={aplBusy}
                  onClick={() => setOpSel(new Set(ops.filter(o => !o.necesita_revizuire).map(o => o.op_id)))}>
                  Selectează toate{ops.some(o => o.necesita_revizuire) ? ' (fără cele de revizuit)' : ''}</button>
                <button style={{ ...S.btnS, padding:'5px 11px', fontSize:11.5 }} disabled={aplBusy}
                  onClick={() => setOpSel(new Set())}>Deselectează</button>
                <button style={{ ...S.btnP, marginLeft:'auto', opacity: opSel.size && !aplBusy ? 1 : .5 }}
                  disabled={!opSel.size || aplBusy} onClick={aplicaSelectia}>
                  {aplBusy ? 'Se aplică…' : `✅ Aplică cele ${opSel.size} selectate`}
                </button>
              </div>
            )}

            {rezAplic && (
              <div style={{ marginTop:10, padding:10, borderRadius:8, background:G.surface, fontSize:12.5 }}>
                <b>Aplicat:</b> {rezAplic.modificate} modificate · {rezAplic.anulate} anulate · {rezAplic.noi} noi ·
                {' '}{rezAplic.acoperiri_mutate} acoperiri mutate (de reverificat).
                {rezAplic.conflicte?.length > 0 && (
                  <div style={{ color:G.orange, marginTop:6 }}>
                    {rezAplic.conflicte.length} neaplicate — s-au schimbat între analiză și aprobare:
                    <ul style={{ margin:'4px 0 0 16px' }}>
                      {rezAplic.conflicte.map((c, i) => <li key={i}>{c.cerinta_id ? `#${c.cerinta_id}: ` : ''}{c.motiv}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// SECȚIUNE: REGISTRUL DE CERINȚE (E2)
// Extragere pe Opus (edge fn ofertare-cerinte, un apel/secțiune — II/III/IV/rest),
// insert cu confirmata_de NULL. Poarta E2 = confirmarea umană de aici.
// Bucla de corecție (ai_feedback): Confirm → verdict 'confirmat'; Corectez →
// diff-ul AI↔om cu verdict 'corectat' (devine few-shot la extracțiile viitoare
// pe aceeași autoritate); Respinge → 'respins' + rândul dispare.
// ════════════════════════════════════════════════════════════════
const TIP_CERINTA = {
  eliminatorie: { label:'ELIMINATORIE', color:G.red },
  propunere:    { label:'propunere',    color:G.blue },
  forma:        { label:'formă',        color:G.muted },
  contractuala: { label:'contractuală', color:G.purple },
}
// Stările de lucru pe cerință (pct. 5) — ce face OMUL cu rândul, separat de dovada din acoperire.
// „nu se aplică" o scoate din numărătoarea de eliminatorii fără dovadă (aici și în v_ofertare_dashboard).
// Numele documentelor din SEAP sunt lungi și se termină cu partea utilă („— p03_pag41-64.pdf")
const right60 = (n) => (n || '').length > 58 ? '…' + n.slice(-58) : n

// Unde anume, în document, stă cerința. Pagina NU e proveniența potrivită peste tot:
// un .docx nu are paginație fixă (se schimbă cu fontul și imprimanta), iar pentru un
// acord contractual referința corectă e clauza, nu pagina. Așa că afișăm ce are sens
// pentru tipul documentului, și nu mai raportăm ca lipsă ceea ce e citare corectă.
const E_WORD = (n) => /\.(docx?|odt)$/i.test(n || '')
const locProvenienta = (c) => {
  if (c.sursa_pagina) return ` · pagina ${c.sursa_pagina}${c.sursa_sectiune ? ` · ${c.sursa_sectiune}` : ''}`
  if (c.sursa_sectiune) return ` · ${c.sursa_sectiune}`
  if (E_WORD(c.doc?.nume_original)) return ' · document Word, fără paginație fixă'
  return ' · pagină necunoscută (document citit înainte de marcaje)'
}
const STARE_CERINTA = {
  de_analizat:  { label:'⬜ de analizat', color:G.dim,    motiv:false },
  in_lucru:     { label:'🔧 în lucru',    color:G.orange, motiv:false },
  rezolvata:    { label:'✅ rezolvată',   color:G.green,  motiv:false },
  nu_se_aplica: { label:'⊘ nu se aplică', color:G.purple, motiv:true  },
  blocata:      { label:'⛔ blocată',     color:G.red,    motiv:true  },
}
// Garda anti-dublură la înregistrarea manuală (10.09.2026): aceeași procedură are și număr SCN
// (anunțul simplificat) și număr DF (documentația de atribuire). Răcari a intrat de două ori — o dată
// din SEAP ca SCN1179379, o dată manual ca DF1279352, din numele fișierului fișei. Nimeni n-a fost
// întrebat nimic. Comparăm pe autoritate + obiect, nu pe număr, fiindcă numărul e exact ce diferă.
const normText = (s) => (s || '').toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
const STOP_CUVINTE = new Set(['de','la','in','din','si','a','al','ale','cu','pe','pentru','judetul','jud','orasul','comuna','municipiul','sat','lucrari','executie','proiectare'])
const cuvinteCheie = (s) => new Set(normText(s).split(' ').filter(w => w.length > 3 && !STOP_CUVINTE.has(w)))
const suprapunere = (a, b) => {
  const A = cuvinteCheie(a), B = cuvinteCheie(b)
  if (!A.size || !B.size) return 0
  let comun = 0; A.forEach(w => { if (B.has(w)) comun++ })
  return comun / Math.min(A.size, B.size)
}

const contextCheie = (autoritate) =>
  `ofertare-cerinte|fisa_date|${/romgaz/i.test(autoritate||'') ? 'romgaz' : /transgaz/i.test(autoritate||'') ? 'transgaz' : /conpet/i.test(autoritate||'') ? 'conpet' : 'alta'}`

function CerinteSection({ licitatie, profile, onChanged, sel, setSel }) {
  const [cerinte, setCerinte] = useState(null)
  const [busy, setBusy] = useState(null)      // text progres extragere
  const [editId, setEditId] = useState(null)  // rând în editare
  const [editVal, setEditVal] = useState({})
  const [warn, setWarn] = useState(null)
  const [fTip, setFTip] = useState('')
  const [fStare, setFStare] = useState('')
  // Bifele sunt ținute de componenta părinte, ca aceeași selecție să se vadă și în
  // „Acoperirea cerințelor": bifezi #47 aici, îl vezi evidențiat acolo. Fără asta, omul
  // căuta de fiecare dată același număr de ordine în a doua listă. Fallback intern ca
  // secțiunea să meargă și dacă e randată singură.
  const [selIntern, setSelIntern] = useState([])
  const selC = sel ?? selIntern
  const setSelC = setSel ?? setSelIntern

  // Repetările (duplicat_al) nu se șterg — se scot din listă și se arată sub cerința păstrată,
  // ca proveniența multiplă („apare și în PT partea 4, pag. 29") să fie informație, nu gunoi.
  // Un document spart în felii își reia capitolele generale, deci aceeași obligație apare de
  // 6-8 ori; fără asta, omul bifează de șase ori aceeași acoperire.
  const [repetari, setRepetari] = useState({})   // id reprezentant → [repetări]
  const [aratRepetari, setAratRepetari] = useState(false)
  // Registrul în care trăiește cerința. Implicit se arată doar capabilitățile —
  // alea se dovedesc cu documente și alea decid dacă oferta trece. Restul se
  // vede la cerere, nu dispare.
  const [fRegistru, setFRegistru] = useState('capabilitate')
  const load = async () => {
    const camp = 'id, nr_ordine, sursa_sectiune, sursa_pagina, text_cerinta, tip, lot, document_probant, cand_se_prezinta, confirmata_de, extras_de_ai, stare, stare_motiv, duplicat_al, registru, registru_sursa, doc:ofertare_documente_atribuire!ofertare_cerinte_sursa_document_id_fkey(nume_original)'
    const { data, error } = await supabase.from('ofertare_cerinte')
      .select(camp)
      .eq('licitatie_id', licitatie.id).is('inlocuita_de', null).is('duplicat_al', null)
      .order('nr_ordine')
      .limit(5000)
    if (error) setWarn('Nu s-a încărcat registrul: ' + error.message)
    setCerinte(data || [])
    const { data: dup } = await supabase.from('ofertare_cerinte')
      .select('id, nr_ordine, sursa_pagina, duplicat_al, doc:ofertare_documente_atribuire!ofertare_cerinte_sursa_document_id_fkey(nume_original)')
      .eq('licitatie_id', licitatie.id).is('inlocuita_de', null).not('duplicat_al', 'is', null)
      .order('nr_ordine').limit(5000)
    const m = {}; (dup || []).forEach(d => { (m[d.duplicat_al] ||= []).push(d) })
    setRepetari(m)
  }
  const nrRepetari = Object.values(repetari).reduce((n, l) => n + l.length, 0)
  // Desface o repetare: cerința redevine de sine stătătoare în registru.
  const desfaRepetarea = async (id) => {
    const { error } = await supabase.from('ofertare_cerinte').update({ duplicat_al: null, duplicat_scor: null, duplicat_la: null }).eq('id', id)
    if (error) return setWarn('Nu s-a desfăcut: ' + error.message)
    load()
  }
  useEffect(() => { load() }, [licitatie.id])

  const extrage = async () => {
    // Plasa dinainte de cheltuială (10.09): la Răcari toate documentele fuseseră citite înainte să
    // existe marcajele de pagină. Extragerea a mers perfect și a ieșit un registru fără nicio pagină —
    // s-a văzut abia după ce s-au dat banii. Acum se vede înainte.
    const { data: pregatire } = await supabase.rpc('ofertare_pregatire_extragere', { p_lic: licitatie.id })
    const probleme = (pregatire || []).filter(d => d.problema)
    const faraMarcaje = probleme.filter(d => (d.problema || '').startsWith('FĂRĂ marcaje'))
    const gata = (pregatire || []).length - probleme.length
    if (probleme.length) {
      const lista = probleme.slice(0, 6).map(d => `• ${d.nume} — ${d.problema}`).join('\n')
      const cap = faraMarcaje.length
        ? `⚠ ${faraMarcaje.length} documente NU au marcaje de pagină. Cerințele extrase din ele vor ieși FĂRĂ număr de pagină, definitiv (până le recitești).\n\n`
        : ''
      if (!window.confirm(
        `${cap}Ce se întâmplă dacă pornești acum:\n` +
        `✓ ${gata} documente intră complet\n⚠ ${probleme.length} au probleme:\n\n${lista}` +
        `${probleme.length > 6 ? `\n… și încă ${probleme.length - 6}` : ''}\n\n` +
        `OK = extrag oricum · Anulează = recitesc întâi documentele („☁️ Pe server")`)) return
    }
    if (cerinte?.length && !window.confirm('Re-extragerea șterge cerințele NEconfirmate și le extrage din nou — din fișă ȘI din caiete/clarificări (cele confirmate rămân). Durează 15-25 min cu tot corpusul. Continui?')) return
    setWarn(null)
    const sectiuni = ['III', 'IV', 'II', 'rest']
    for (let i = 0; i < sectiuni.length; i++) {
      // v6: o bucată per apel — se continuă cât timp funcția mai are bucăți (nimic nu se mai taie la 180k)
      let bucata = 0, continua = true
      while (continua) {
        setBusy(`Opus citește fișa — secțiunea ${sectiuni[i]} (${i + 1}/4)${bucata ? ` · bucata ${bucata + 1}` : ''}...`)
        const { data, error } = await supabase.functions.invoke('ofertare-cerinte',
          { body: { licitatie_id: licitatie.id, sectiune: sectiuni[i], reset: i === 0 && bucata === 0, bucata } })
        if (error || data?.error) { setWarn(`Secțiunea ${sectiuni[i]}: ${data?.error || error.message}`); setBusy(null); await load(); return }
        continua = !!data?.continua; bucata = data?.bucata_urmatoare ?? bucata + 1
        await load()
      }
    }
    // Sweep pe corpus: caiete de sarcini + clarificări + „alta" procesate. Un original
    // spart în „— partea N" se sare (părțile îl înlocuiesc — cazul VOLUM III întreg).
    const { data: docs } = await supabase.from('ofertare_documente_atribuire')
      .select('id, nume_original, tip').eq('licitatie_id', licitatie.id)
      .in('status_procesare', ['procesat', 'partial']).in('tip', ['cs_volum', 'raspuns_clarificare', 'alta', 'formular'])
      .order('id')
    const toateNumele = (docs || []).map(d => d.nume_original || '')
    const deCitit = (docs || []).filter(d => {
      const baza = (d.nume_original || '').replace(/\.pdf$/i, '')
      return !toateNumele.some(n => n !== d.nume_original && n.startsWith(baza + ' — partea'))
    })
    let esecuri = 0
    for (let i = 0; i < deCitit.length; i++) {
      const d = deCitit[i]
      let bucata = 0, continua = true, esec = false
      while (continua) {
        setBusy(`Opus citește caietele/clarificările: ${i + 1}/${deCitit.length} · ${(d.nume_original || '').split('/').pop()}${bucata ? ` · bucata ${bucata + 1}` : ''}`)
        const { data, error } = await supabase.functions.invoke('ofertare-cerinte',
          { body: { licitatie_id: licitatie.id, doc_id: d.id, bucata } })
        if (error || data?.error) { esec = true; break }
        continua = !!data?.continua; bucata = data?.bucata_urmatoare ?? bucata + 1
        await load()
      }
      if (esec) {
        esecuri++
        if (esecuri >= 3) { setWarn('Prea multe erori la caiete — restul se reiau mai târziu cu „Re-extrage".'); break }
        continue
      }
    }
    setBusy(null); await load(); onChanged?.()
  }

  const feedback = async (c, verdict, corectat) => {
    await supabase.from('ai_feedback').insert({
      function_name: 'ofertare-cerinte', context_cheie: contextCheie(licitatie.autoritate),
      ref_table: 'ofertare_cerinte', ref_id: c.id,
      output_ai: { sursa_sectiune: c.sursa_sectiune, text_cerinta: c.text_cerinta, tip: c.tip, document_probant: c.document_probant },
      verdict, output_corectat: corectat || null,
      corectat_de: profile?.id || null, corectat_la: new Date().toISOString(),
    })
  }

  const confirma = async (c) => {
    await feedback(c, 'confirmat')
    await supabase.from('ofertare_cerinte').update({ confirmata_de: profile.id, confirmata_la: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', c.id)
    await load(); onChanged?.()
  }
  const salveazaCorectia = async (c) => {
    const nou = { sursa_sectiune: editVal.sursa_sectiune?.trim() || c.sursa_sectiune, text_cerinta: editVal.text_cerinta?.trim() || c.text_cerinta, tip: editVal.tip || c.tip, document_probant: editVal.document_probant?.trim() || null }
    await feedback(c, 'corectat', nou)
    await supabase.from('ofertare_cerinte').update({ ...nou, confirmata_de: profile.id, confirmata_la: new Date().toISOString(), extras_de_ai: false, updated_at: new Date().toISOString() }).eq('id', c.id)
    setEditId(null); await load(); onChanged?.()
  }
  const respinge = async (c) => {
    if (!window.confirm('Respingi cerința? (dispare din registru; respingerea se ține minte ca feedback)')) return
    await feedback(c, 'respins')
    await supabase.from('ofertare_cerinte').delete().eq('id', c.id)
    await load(); onChanged?.()
  }
  // Poarta E2 — confirmă tot ce a rămas neconfirmat, dintr-un click (după ce ai citit lista)
  const confirmaTot = async () => {
    const rest = (cerinte || []).filter(c => !c.confirmata_de)
    if (!rest.length) return
    if (!window.confirm(`Confirmi TOATE cele ${rest.length} cerințe neconfirmate? (poarta E2 — registrul devine oficial)`)) return
    setBusy('Se confirmă registrul...')
    for (const c of rest) await feedback(c, 'confirmat')
    await supabase.from('ofertare_cerinte').update({ confirmata_de: profile.id, confirmata_la: new Date().toISOString() })
      .eq('licitatie_id', licitatie.id).is('confirmata_de', null)
    setBusy(null); await load(); onChanged?.()
  }

  // „nu se aplică" și „blocată" cer motiv scris (CHECK în BD) — altfel nu se mai știe de ce a ieșit din calcul
  const setStare = async (c, stare) => {
    if (stare === c.stare) return
    let motiv = c.stare_motiv || null
    if (STARE_CERINTA[stare]?.motiv) {
      motiv = window.prompt(`De ce „${STARE_CERINTA[stare].label}"? (motivul rămâne scris pe cerință)`, motiv || '')
      if (!motiv || !motiv.trim()) return
      motiv = motiv.trim()
    }
    const patch = { stare, stare_motiv: motiv, stare_de: profile?.id || null, stare_la: new Date().toISOString(), updated_at: new Date().toISOString() }
    const { error } = await supabase.from('ofertare_cerinte').update(patch).eq('id', c.id)
    if (error) return setWarn('Nu s-a salvat starea: ' + error.message)
    setCerinte(cs => (cs || []).map(x => x.id === c.id ? { ...x, stare, stare_motiv: motiv } : x))
    onChanged?.()
  }

  // Aceeași regulă ca pe rândul singur (motiv obligatoriu la „nu se aplică"/„blocată"),
  // dar motivul se cere O SINGURĂ DATĂ pentru tot grupul — altfel 20 de rânduri = 20 de casete.
  const setStareSelectate = async (stare) => {
    const alese = (cerinte || []).filter(c => selC.includes(c.id))
    if (!alese.length) return
    let motiv = null
    if (STARE_CERINTA[stare]?.motiv) {
      motiv = window.prompt(`De ce „${STARE_CERINTA[stare].label}" pentru ${alese.length} cerințe? (același motiv se scrie pe toate)`, '')
      if (!motiv || !motiv.trim()) return
      motiv = motiv.trim()
    }
    const patch = { stare, stare_motiv: motiv, stare_de: profile?.id || null, stare_la: new Date().toISOString(), updated_at: new Date().toISOString() }
    const { error } = await supabase.from('ofertare_cerinte').update(patch).in('id', alese.map(c => c.id))
    if (error) return setWarn('Nu s-a salvat starea: ' + error.message)
    setCerinte(cs => (cs || []).map(x => selC.includes(x.id) ? { ...x, stare, stare_motiv: motiv } : x))
    setSelC([]); onChanged?.()
  }

  const potrivesteRegistru = (c) => {
    if (fRegistru === 'toate') return true
    if (fRegistru === 'capabilitate') return !c.registru || c.registru === 'capabilitate'
    return c.registru === fRegistru
  }
  const filtrate = (cerinte || []).filter(c => potrivesteRegistru(c) && (!fTip || c.tip === fTip) && (!fStare || (c.stare || 'de_analizat') === fStare))
  const nrPeRegistru = (cerinte || []).reduce((m, c) => {
    const k = c.registru || 'capabilitate'; m[k] = (m[k] || 0) + 1; return m
  }, {})
  const neconfirmate = (cerinte || []).filter(c => !c.confirmata_de).length
  // Regulile de alcatuire a echipei (Domnesti #4090) nu se „acopera" cu un document — se verifica la
  // propunere. Ca sa nu dispara sub `nu_se_aplica`, se arata aici, in registru, cu aceeasi expresie ca
  // in view-ul de conformitate (REGEX_INTERZICE_CUMUL).
  const rxCumul = new RegExp(REGEX_INTERZICE_CUMUL, 'i')
  const regulaCumul = (cerinte || []).filter(c => !c.duplicat_al && rxCumul.test(c.text_cerinta || ''))

  return (
    <div style={{ marginTop:14, padding:14, borderRadius:10, border:`1px solid ${G.border}`, background:G.bg }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10, flexWrap:'wrap' }}>
        <div style={{ fontSize:13, fontWeight:800 }}>📋 Registrul de cerințe {cerinte ? `(${cerinte.length}${neconfirmate ? ` · ${neconfirmate} neconfirmate` : ' · ✅ confirmat'})` : ''}</div>
        {nrRepetari > 0 && (
          <button onClick={() => setAratRepetari(v => !v)} title="Aceleași obligații, repetate în mai multe felii ale documentației. Se bifează o singură dată; aici vezi unde se mai repetă."
            style={{ ...S.btnS, padding:'4px 9px', fontSize:11, color: aratRepetari ? G.ofertare : G.dim, borderColor: (aratRepetari ? G.ofertare : G.border2) }}>
            🔁 {nrRepetari} repetări {aratRepetari ? '(ascunde unde)' : '(arată unde)'}
          </button>
        )}
        <div style={{ marginLeft:'auto', display:'flex', gap:8, alignItems:'center' }}>
          <select style={{ ...S.input, width:'auto', padding:'6px 10px', fontSize:12, borderColor: fRegistru === 'capabilitate' ? G.ofertare : G.border2 }}
            value={fRegistru} onChange={e => setFRegistru(e.target.value)}
            title="Capabilități = se dovedesc cu documente din catalog și decid calificarea. De depunere = garanție, formulare, acorduri — se fac la întocmirea ofertei. Informări pentru execuție = obligații de șantier (SSM, deșeuri, probe), se predau la câștigare.">
            <option value="capabilitate">🎯 capabilități ({nrPeRegistru.capabilitate || 0})</option>
            <option value="depunere">📎 de depunere ({nrPeRegistru.depunere || 0})</option>
            <option value="executie">🏗️ informări pentru execuție ({nrPeRegistru.executie || 0})</option>
            <option value="toate">toate registrele ({(cerinte || []).length})</option>
          </select>
          <select style={{ ...S.input, width:'auto', padding:'6px 10px', fontSize:12 }} value={fTip} onChange={e => setFTip(e.target.value)}>
            <option value="">toate tipurile</option>
            {Object.entries(TIP_CERINTA).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select style={{ ...S.input, width:'auto', padding:'6px 10px', fontSize:12 }} value={fStare} onChange={e => setFStare(e.target.value)}>
            <option value="">toate stările</option>
            {Object.entries(STARE_CERINTA).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          {!busy && poatePorniProcesarea(profile, licitatie) && <button style={{ ...S.btnS, padding:'7px 12px', fontSize:12 }} onClick={extrage}>🤖 {cerinte?.length ? 'Re-extrage' : 'Extrage cerințele'} (Opus)</button>}
          {!busy && !poatePorniProcesarea(profile, licitatie) && <span style={{ fontSize:11.5, color:G.dim, alignSelf:'center' }} title={MOTIV_POARTA}>🔒 registrul îl generează ownerul / responsabilul</span>}
          {!busy && neconfirmate > 0 && <button style={{ ...S.btnP, padding:'7px 12px', fontSize:12 }} onClick={confirmaTot}>✅ Confirmă registrul ({neconfirmate})</button>}
        </div>
      </div>
      {busy && <div style={{ fontSize:12, color:G.ofertare, fontWeight:700, marginBottom:8 }}>🤖 {busy}</div>}
      {warn && <div style={{ fontSize:12, color:G.red, marginBottom:8 }}>{warn}</div>}
      {regulaCumul.length > 0 && (
        <div style={{ padding:'8px 12px', marginBottom:8, borderRadius:7, border:`1px solid ${G.orange}77`, background:G.surface, fontSize:12.5, color:G.text }}>
          <b style={{ color:G.orange }}>⚠️ Cerințele interzic cumulul de funcții</b> — regulă de alcătuire a echipei, nu cerință de capabilitate: nu se acoperă cu un document, se verifică la Propunerea tehnică (aceeași persoană cu două roluri = block).
          <ul style={{ margin:'4px 0 0', paddingLeft:18, color:G.muted }}>
            {regulaCumul.map(c => <li key={c.id}>#{c.id}{c.nr_ordine ? ` (nr. ${c.nr_ordine})` : ''} · {c.tip}{c.sursa_sectiune ? ` · ${c.sursa_sectiune}` : ''}{c.sursa_pagina ? ` p. ${c.sursa_pagina}` : ''}: „{c.text_cerinta}"</li>)}
          </ul>
        </div>
      )}

      {!!filtrate.length && (
        <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:8, flexWrap:'wrap', padding:'6px 8px', background:G.surface, borderRadius:7 }}>
          <label style={{ fontSize:11.5, color:G.muted, display:'flex', alignItems:'center', gap:5, cursor:'pointer' }}>
            <input type="checkbox" style={{ accentColor:G.ofertare }}
              checked={selC.length > 0 && selC.length === filtrate.length}
              onChange={e => setSelC(e.target.checked ? filtrate.map(c => c.id) : [])} />
            bifează tot ce se vede ({filtrate.length})
          </label>
          <span style={{ fontSize:11.5, color: selC.length ? G.ofertare : G.dim, fontWeight:700 }}>{selC.length} selectate</span>
          {selC.length > 0 && (<>
            <span style={{ fontSize:11.5, color:G.dim }}>pune starea:</span>
            {Object.entries(STARE_CERINTA).map(([k, v]) => (
              <button key={k} onClick={() => setStareSelectate(k)}
                style={{ ...S.btnS, padding:'4px 10px', fontSize:11.5, color:v.color, borderColor:v.color + '66' }}>{v.label}</button>
            ))}
            <button onClick={() => setSelC([])} style={{ ...S.btnS, padding:'4px 10px', fontSize:11.5 }}>renunț</button>
          </>)}
        </div>
      )}

      {cerinte === null ? <div style={{ fontSize:12, color:G.muted }}>Se încarcă...</div> :
        !cerinte.length ? (
          <div style={{ fontSize:12, color:G.dim }}>Niciun rând încă. „🤖 Extrage cerințele" citește cu Opus fișa de date (secțiunile III, IV, II + restul) și apoi TOATE caietele de sarcini + clarificările procesate — apoi tu confirmi/corectezi fiecare rând. Corecțiile tale devin exemple pentru extracțiile viitoare.</div>
        ) : (
          <div style={{ maxHeight:340, overflowY:'auto', display:'flex', flexDirection:'column', gap:4 }}>
            {filtrate.map(c => {
              const t = TIP_CERINTA[c.tip] || TIP_CERINTA.propunere
              const st = STARE_CERINTA[c.stare || 'de_analizat'] || STARE_CERINTA.de_analizat
              const inEdit = editId === c.id
              return (
                <div key={c.id} style={{ padding:'7px 10px', borderRadius:7, background:G.surface, borderLeft:`3px solid ${c.stare === 'nu_se_aplica' ? G.purple : c.confirmata_de ? G.green : t.color}`, opacity: c.stare === 'nu_se_aplica' ? 0.72 : 1 }}>
                  <div style={{ display:'flex', alignItems:'flex-start', gap:8, flexWrap:'wrap' }}>
                    <input type="checkbox" style={{ accentColor:G.ofertare, marginTop:3 }}
                      checked={selC.includes(c.id)}
                      onChange={e => setSelC(v => e.target.checked ? [...v, c.id] : v.filter(x => x !== c.id))} />
                    <span title="Sari la aceeași cerință în „Acoperirea cerințelor”" onClick={() => {
                        const el = document.getElementById(`acop-${c.id}`)
                        if (el) el.scrollIntoView({ behavior:'smooth', block:'center' })
                      }}
                      style={{ fontSize:11.5, fontWeight:800, color:G.dim, minWidth:34, textAlign:'right', fontVariantNumeric:'tabular-nums', cursor:'pointer' }}>#{c.nr_ordine}</span>
                    <span style={{ fontSize:10.5, fontWeight:800, color:t.color, background:t.color + '18', border:`1px solid ${t.color}55`, borderRadius:10, padding:'2px 8px', whiteSpace:'nowrap' }}>{t.label}</span>
                    <span style={{ fontSize:11, color:G.muted, fontWeight:700, whiteSpace:'nowrap' }}>{c.sursa_sectiune}{c.lot && c.lot !== 'toate' ? ` · lot ${c.lot}` : ''}</span>
                    {!inEdit && <span style={{ flex:1, fontSize:12.5, minWidth:220 }}>{c.text_cerinta}</span>}
                    {!inEdit && (
                      <span style={{ display:'flex', gap:5, marginLeft:'auto', alignItems:'center' }}>
                        <select
                          title="Starea de lucru — „nu se aplică” scoate cerința din eliminatoriile fără dovadă"
                          value={c.stare || 'de_analizat'} onChange={e => setStare(c, e.target.value)}
                          style={{ ...S.input, width:'auto', padding:'3px 6px', fontSize:11, color:st.color, fontWeight:700, borderColor:st.color + '55' }}>
                          {Object.entries(STARE_CERINTA).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                        </select>
                        {c.confirmata_de ? <span style={{ fontSize:11, color:G.green, fontWeight:700 }}>✓</span> : (<>
                          <button title="Confirm" onClick={() => confirma(c)} style={{ ...S.btnS, padding:'3px 9px', fontSize:11, color:G.green, borderColor:G.green + '66' }}>✓</button>
                          <button title="Corectez" onClick={() => { setEditId(c.id); setEditVal({ sursa_sectiune: c.sursa_sectiune, text_cerinta: c.text_cerinta, tip: c.tip, document_probant: c.document_probant || '' }) }} style={{ ...S.btnS, padding:'3px 9px', fontSize:11, color:G.orange, borderColor:G.orange + '66' }}>✏️</button>
                          <button title="Resping" onClick={() => respinge(c)} style={{ ...S.btnS, padding:'3px 9px', fontSize:11, color:G.red, borderColor:G.red + '66' }}>✕</button>
                        </>)}
                      </span>
                    )}
                  </div>
                  {!inEdit && (c.doc?.nume_original || c.sursa_pagina || c.sursa_sectiune) && (
                    <div style={{ fontSize:11, color:G.dim, marginTop:3 }} title="De unde provine cerința în documentație">
                      📑 {c.doc?.nume_original ? right60(c.doc.nume_original) : (c.sursa_sectiune ? 'document scos din licitație' : 'document șters din licitație')}
                      {locProvenienta(c)}
                    </div>
                  )}
                  {!inEdit && repetari[c.id]?.length > 0 && (
                    <div style={{ fontSize:11, color:G.dim, marginTop:3 }} title="Aceeași obligație, repetată în alte felii ale documentației — se bifează o singură dată">
                      🔁 se repetă de {repetari[c.id].length} ori
                      {aratRepetari
                        ? <>: {repetari[c.id].map(r => (
                            <span key={r.id} style={{ marginLeft:6 }}>
                              #{r.nr_ordine} {right60(r.doc?.nume_original || '—')}{r.sursa_pagina ? ` p.${r.sursa_pagina}` : ''}
                              <button title="Nu e aceeași cerință — scoate-o din repetări" onClick={() => desfaRepetarea(r.id)}
                                style={{ ...S.btnS, padding:'0 5px', fontSize:10, marginLeft:4, color:G.orange, borderColor:G.orange + '55' }}>desfă</button>
                            </span>))}</>
                        : <> în documentație</>}
                    </div>
                  )}
                  {c.document_probant && !inEdit && <div style={{ fontSize:11, color:G.dim, marginTop:3 }}>📄 se dovedește cu: {c.document_probant}{c.cand_se_prezinta ? ` · ${c.cand_se_prezinta}` : ''}</div>}
                  {c.stare_motiv && !inEdit && <div style={{ fontSize:11, color:st.color, marginTop:3 }}>{st.label} — {c.stare_motiv}</div>}
                  {inEdit && (
                    <div style={{ marginTop:8, display:'flex', flexDirection:'column', gap:6 }}>
                      <textarea style={{ ...S.input, minHeight:54, resize:'vertical' }} value={editVal.text_cerinta} onChange={e => setEditVal(v => ({ ...v, text_cerinta: e.target.value }))} />
                      <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                        <input style={{ ...S.input, maxWidth:120 }} value={editVal.sursa_sectiune} onChange={e => setEditVal(v => ({ ...v, sursa_sectiune: e.target.value }))} placeholder="secțiune" />
                        <select style={{ ...S.input, maxWidth:150 }} value={editVal.tip} onChange={e => setEditVal(v => ({ ...v, tip: e.target.value }))}>
                          {Object.entries(TIP_CERINTA).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                        </select>
                        <input style={{ ...S.input, flex:1, minWidth:160 }} value={editVal.document_probant} onChange={e => setEditVal(v => ({ ...v, document_probant: e.target.value }))} placeholder="document probant" />
                        <button style={{ ...S.btnP, padding:'7px 12px', fontSize:12 }} onClick={() => salveazaCorectia(c)}>💾 Salvează corecția</button>
                        <button style={{ ...S.btnS, padding:'7px 12px', fontSize:12 }} onClick={() => setEditId(null)}>Anulează</button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
    </div>
  )
}


// ════════════════════════════════════════════════════════════════
// SECȚIUNE: VERIFICARE INDEPENDENTĂ (pct. 3) — ce a găsit al treilea cititor (Gemini/GPT)
// pe PDF-ul ORIGINAL și noi nu avem în registru. Perecherea se face în BD pe similaritate
// de text (RPC ofertare_inventar_pereche), nu cu un apel de model, deci nu costă nimic.
// Regula lui Răzvan: AI-ul propune, omul apasă. Nimic nu intră singur în registru.
// ════════════════════════════════════════════════════════════════
const FURNIZOR_LBL = { gemini: '🔷 Gemini', openai: '🟢 ChatGPT', anthropic: '🟣 Claude' }

function InventarIndependentSection({ licitatie, profile, onChanged }) {
  const [randuri, setRanduri] = useState(null)
  const [rulari, setRulari] = useState([])
  const [sel, setSel] = useState(null)        // {furnizor, versiune}
  const [busy, setBusy] = useState(false)
  const [warn, setWarn] = useState(null)
  const [doarLipsa, setDoarLipsa] = useState(true)
  const [sel2, setSel2] = useState([])       // id-uri bifate pentru acțiune în bloc

  const load = async (r = sel) => {
    const { data: toate } = await supabase.from('ofertare_inventar_ai')
      .select('id, furnizor, model, versiune, pagina, sectiune, obligatie, tip_principal, verdict, pereche_cerinta_id')
      .eq('licitatie_id', licitatie.id).order('versiune', { ascending: false }).order('nr').limit(5000)
    const lista = toate || []
    const chei = []
    lista.forEach(x => { const k = `${x.furnizor}|${x.versiune}`; if (!chei.some(c => c.k === k)) chei.push({ k, furnizor: x.furnizor, versiune: x.versiune, model: x.model, n: 0 }) })
    chei.forEach(c => { c.n = lista.filter(x => x.furnizor === c.furnizor && x.versiune === c.versiune).length })
    setRulari(chei)
    const cur = r && chei.some(c => c.furnizor === r.furnizor && c.versiune === r.versiune) ? r : chei[0] || null
    setSel(cur)
    setRanduri(cur ? lista.filter(x => x.furnizor === cur.furnizor && x.versiune === cur.versiune) : [])
  }
  useEffect(() => { load(null) }, [licitatie.id])

  const imperecheaza = async () => {
    if (!sel) return
    setBusy(true); setWarn(null)
    const { data, error } = await supabase.rpc('ofertare_inventar_pereche', { p_lic: licitatie.id, p_furnizor: sel.furnizor, p_versiune: sel.versiune })
    setBusy(false)
    if (error) return setWarn('Împerechere: ' + error.message)
    const r = Array.isArray(data) ? data[0] : data
    setWarn(`Împerechere gata: ${r?.imperecheate ?? 0} regăsite în registru, ${r?.ramase_fara_pereche ?? 0} fără pereche.`)
    await load()
  }

  // AI-ul propune, omul apasă: rândul devine cerință în registru doar la click, marcat ca neconfirmat
  const adaugaInRegistru = async (r) => {
    const tip = ['eliminatorie', 'propunere', 'forma', 'contractuala'].includes(r.tip_principal) ? r.tip_principal : 'propunere'
    const { error } = await supabase.from('ofertare_cerinte').insert({
      licitatie_id: licitatie.id, sursa_sectiune: r.sectiune || `Verificare ${FURNIZOR_LBL[r.furnizor] || r.furnizor}`,
      sursa_pagina: r.pagina || null, text_cerinta: r.obligatie, tip, extras_de_ai: true,
    })
    if (error) return setWarn('Nu s-a adăugat: ' + error.message)
    await supabase.from('ofertare_inventar_ai').update({ verdict: 'confirmat_de_om', verdict_de: profile?.id || null, verdict_la: new Date().toISOString() }).eq('id', r.id)
    await load(); onChanged?.()
  }
  // Acțiune în bloc (Răzvan 10.09): 89 de rânduri de triat înseamnă 89 de clickuri.
  // Bifezi ce e clar, apeși o dată. Decizia rămâne a omului — doar apăsatul se adună.
  const adaugaSelectate = async () => {
    const alese = (randuri || []).filter(r => sel2.includes(r.id) && r.verdict === 'lipsa_din_registru')
    if (!alese.length) return
    if (!window.confirm(`Adaug ${alese.length} obligații în registru, ca cerințe NEconfirmate (le confirmi tu pe fiecare după)?`)) return
    setBusy(true)
    const { error } = await supabase.from('ofertare_cerinte').insert(alese.map(r => ({
      licitatie_id: licitatie.id,
      sursa_sectiune: r.sectiune || `Verificare ${FURNIZOR_LBL[r.furnizor] || r.furnizor}`,
      sursa_pagina: r.pagina || null, text_cerinta: r.obligatie,
      tip: ['eliminatorie', 'propunere', 'forma', 'contractuala'].includes(r.tip_principal) ? r.tip_principal : 'propunere',
      extras_de_ai: true,
    })))
    if (error) { setBusy(false); return setWarn('Nu s-au adăugat: ' + error.message) }
    await supabase.from('ofertare_inventar_ai').update({ verdict: 'confirmat_de_om', verdict_de: profile?.id || null, verdict_la: new Date().toISOString() }).in('id', alese.map(r => r.id))
    setBusy(false); setSel2([]); await load(); onChanged?.()
    setWarn(`✓ ${alese.length} cerințe adăugate în registru, neconfirmate.`)
  }
  const respingeSelectate = async () => {
    const ids = (randuri || []).filter(r => sel2.includes(r.id) && r.verdict === 'lipsa_din_registru').map(r => r.id)
    if (!ids.length) return
    if (!window.confirm(`Marchez ${ids.length} rânduri ca „nu e cerință"?`)) return
    setBusy(true)
    await supabase.from('ofertare_inventar_ai').update({ verdict: 'respins_de_om', verdict_de: profile?.id || null, verdict_la: new Date().toISOString() }).in('id', ids)
    setBusy(false); setSel2([]); await load()
  }

  const respinge = async (r) => {
    await supabase.from('ofertare_inventar_ai').update({ verdict: 'respins_de_om', verdict_de: profile?.id || null, verdict_la: new Date().toISOString() }).eq('id', r.id)
    await load()
  }

  const lipsa = (randuri || []).filter(r => r.verdict === 'lipsa_din_registru')
  const afisate = doarLipsa ? lipsa : (randuri || [])

  return (
    <div style={{ marginTop:14, padding:14, borderRadius:10, border:`1px solid ${G.border}`, background:G.bg }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10, flexWrap:'wrap' }}>
        <div style={{ fontSize:13, fontWeight:800 }}>🔍 Verificare independentă {randuri ? `(${randuri.length} obligații citite${lipsa.length ? ` · ${lipsa.length} fără pereche în registru` : ''})` : ''}</div>
        <div style={{ marginLeft:'auto', display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
          {rulari.length > 1 && (
            <select style={{ ...S.input, width:'auto', padding:'6px 10px', fontSize:12 }} value={sel ? `${sel.furnizor}|${sel.versiune}` : ''}
              onChange={e => { const [f, v] = e.target.value.split('|'); load({ furnizor: f, versiune: Number(v) }) }}>
              {rulari.map(c => <option key={c.k} value={c.k}>{FURNIZOR_LBL[c.furnizor] || c.furnizor} v{c.versiune} ({c.n})</option>)}
            </select>
          )}
          <label style={{ fontSize:11.5, color:G.muted, display:'flex', alignItems:'center', gap:5, cursor:'pointer' }}>
            <input type="checkbox" checked={doarLipsa} onChange={e => setDoarLipsa(e.target.checked)} style={{ accentColor:G.yellow }} /> doar ce lipsește
          </label>
          <button style={{ ...S.btnS, padding:'7px 12px', fontSize:12 }} disabled={busy || !sel} onClick={imperecheaza} title="Compară obligațiile citite independent cu registrul nostru, pe similaritate de text (fără cost AI)">
            {busy ? '⏳ compar…' : '🔗 Compară cu registrul'}</button>
        </div>
      </div>
      {warn && <div style={{ fontSize:12, color:G.yellow, marginBottom:8 }}>{warn}</div>}

      {!!afisate.filter(r => r.verdict === 'lipsa_din_registru').length && (
        <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:8, flexWrap:'wrap', padding:'6px 8px', background:G.surface, borderRadius:7 }}>
          <label style={{ fontSize:11.5, color:G.muted, display:'flex', alignItems:'center', gap:5, cursor:'pointer' }}>
            <input type="checkbox" style={{ accentColor:G.ofertare }}
              checked={sel2.length > 0 && sel2.length === afisate.filter(r => r.verdict === 'lipsa_din_registru').length}
              onChange={e => setSel2(e.target.checked ? afisate.filter(r => r.verdict === 'lipsa_din_registru').map(r => r.id) : [])} />
            bifează tot ce se vede
          </label>
          <span style={{ fontSize:11.5, color: sel2.length ? G.ofertare : G.dim, fontWeight:700 }}>{sel2.length} selectate</span>
          {sel2.length > 0 && (<>
            <button disabled={busy} onClick={adaugaSelectate} style={{ ...S.btnS, padding:'4px 10px', fontSize:11.5, color:G.green, borderColor:G.green + '66' }}>➕ adaugă în registru ({sel2.length})</button>
            <button disabled={busy} onClick={respingeSelectate} style={{ ...S.btnS, padding:'4px 10px', fontSize:11.5, color:G.dim }}>✕ nu sunt cerințe ({sel2.length})</button>
            <button onClick={() => setSel2([])} style={{ ...S.btnS, padding:'4px 10px', fontSize:11.5 }}>renunț</button>
          </>)}
        </div>
      )}

      {randuri === null ? <div style={{ fontSize:12, color:G.muted }}>Se încarcă...</div> :
        !rulari.length ? (
          <div style={{ fontSize:12, color:G.dim }}>Nicio citire independentă pe licitația asta. Inventarul se generează cu funcția <code>ofertare-inventar-ai</code> (Gemini sau ChatGPT citesc PDF-ul ORIGINAL, nu textul extras de noi) — rostul lui e să prindă ce am ratat, nu să scrie în registru.</div>
        ) : !afisate.length ? (
          <div style={{ fontSize:12, color:G.green }}>✓ Nimic fără pereche — tot ce a citit {FURNIZOR_LBL[sel?.furnizor] || sel?.furnizor} se regăsește în registru. (Dacă n-ai apăsat „Compară cu registrul", apasă întâi.)</div>
        ) : (
          <div style={{ maxHeight:340, overflowY:'auto', display:'flex', flexDirection:'column', gap:4 }}>
            {afisate.map(r => {
              const t = TIP_CERINTA[r.tip_principal] || TIP_CERINTA.propunere
              const decis = r.verdict === 'confirmat_de_om' || r.verdict === 'respins_de_om'
              return (
                <div key={r.id} style={{ padding:'7px 10px', borderRadius:7, background:G.surface, borderLeft:`3px solid ${decis ? G.dim : t.color}`, opacity: decis ? .6 : 1 }}>
                  <div style={{ display:'flex', alignItems:'flex-start', gap:8, flexWrap:'wrap' }}>
                    {!decis && <input type="checkbox" style={{ accentColor:G.ofertare, marginTop:3 }}
                      checked={sel2.includes(r.id)}
                      onChange={e => setSel2(v => e.target.checked ? [...v, r.id] : v.filter(x => x !== r.id))} />}
                    <span style={{ fontSize:10.5, fontWeight:800, color:t.color, background:t.color + '18', border:`1px solid ${t.color}55`, borderRadius:10, padding:'2px 8px', whiteSpace:'nowrap' }}>{t.label}</span>
                    {r.pagina && <span style={{ fontSize:11, color:G.muted, fontWeight:700, whiteSpace:'nowrap' }}>p. {r.pagina}</span>}
                    {r.sectiune && <span style={{ fontSize:11, color:G.dim, whiteSpace:'nowrap' }}>{r.sectiune}</span>}
                    <span style={{ flex:1, fontSize:12.5, minWidth:220 }}>{r.obligatie}</span>
                    <span style={{ display:'flex', gap:5, marginLeft:'auto' }}>
                      {r.verdict === 'confirmat_de_om' ? <span style={{ fontSize:11, color:G.green, fontWeight:700 }}>✓ adăugată</span>
                        : r.verdict === 'respins_de_om' ? <span style={{ fontSize:11, color:G.dim, fontWeight:700 }}>✕ respinsă</span>
                        : (<>
                          <button title="O adaug în registru ca cerință neconfirmată" onClick={() => adaugaInRegistru(r)} style={{ ...S.btnS, padding:'3px 9px', fontSize:11, color:G.green, borderColor:G.green + '66' }}>➕ în registru</button>
                          <button title="Nu e cerință / e deja acoperită altfel" onClick={() => respinge(r)} style={{ ...S.btnS, padding:'3px 9px', fontSize:11, color:G.dim, borderColor:G.border2 }}>✕</button>
                        </>)}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// SECȚIUNE: ACOPERIREA CERINȚELOR (E3) — cine acoperă fiecare cerință
// Opus propune din catalogul REAL (hr_autorizatii + parteneri); omul verifică
// pe scan (R1 — CHECK în BD: verificat cere fișier; scanul vine din autorizație).
// Golurile devin tichete (modelul TKT-2026-0139). Poarta E3: zero eliminatorii GOL.
// ════════════════════════════════════════════════════════════════
const ACOPERIRE_STATUS = {
  acoperit:          { label:'✅ acoperit',  color:G.green },
  acoperit_partener: { label:'🤝 partener',  color:G.teal },
  gol:               { label:'🔴 GOL',       color:G.red },
  // Propunerea AI-ului, nu decizia omului: aia se ia in registru (cerinte.stare) si e
  // singura care scoate o eliminatorie din numaratoarea de „fara dovada" (vezi mai jos).
  nu_se_aplica:      { label:'⊘ AI: nu se aplică', color:G.purple },
  // #65 varianta A: regula de alcatuire a echipei (cumul functii etc.) — nu se acopera cu un document,
  // se verifica la propunerea tehnica. Distinct de nu_se_aplica ca sa nu dispara.
  regula_propunere:  { label:'👥 regulă → propunere', color:G.orange },
}

function AcoperireSection({ licitatie, profile, onChanged, sel = [] }) {
  const [cerinte, setCerinte] = useState(null)
  const [acoperiri, setAcoperiri] = useState({})   // cerinta_id -> rând acoperire (+ autorizația join)
  const [busy, setBusy] = useState(null)
  const [warn, setWarn] = useState(null)
  const [fDoarGoluri, setFDoarGoluri] = useState(false)
  // răspunsul colegilor la goluri / dovezi roșii — se citește de platformă (raport zilnic), nu pe mail (Răzvan 07.09)
  const [raspEdit, setRaspEdit] = useState(null)
  // Tichet din cerință (TKT-0220 Pantea + mail Silviu 15.09): pe ORICE cerință, cu departament + persoană alese pe loc,
  // nu doar pe goluri cu departament „hr" bătut în cuie. tktEdit = id-ul cerinței cu formularul deschis.
  const [tktEdit, setTktEdit] = useState(null)
  const [tktForm, setTktForm] = useState({ departament: 'hr', persoana: '' })
  const TKT_DEPARTAMENTE = [['hr','👥 HR'],['comercial','🛒 Comercial'],['logistica','🚜 Logistica'],['administrativ','🏢 Administrativ'],['financiar','💰 Financiar'],['it','💻 IT']]
  const [profiles, setProfiles] = useState({})
  useEffect(() => { supabase.from('profiles').select('id, name').then(({ data }) => { const m = {}; (data || []).forEach(p => { m[p.id] = p.name }); setProfiles(m) }) }, [])
  // #68 varianta B (Oana): „🔍 Cine poate acoperi" — candidați din BD potriviți lexical, FĂRĂ AI, cu
  // alegere manuală. Catalogul se încarcă o dată per licitație (lazy, la prima deschidere) și se refolosește.
  const [candCerinta, setCandCerinta] = useState(null)   // cerința cu panoul deschis
  const [catalog, setCatalog] = useState(null)           // candidați normalizați (toate sursele)
  const [catalogBusy, setCatalogBusy] = useState(false)
  useEffect(() => { setCatalog(null); setCandCerinta(null) }, [licitatie.id])
  const deschideCandidati = async (c) => {
    setCandCerinta(c)
    if (catalog || catalogBusy) return
    setCatalogBusy(true)
    try { setCatalog(await incarcaCatalogAcoperire()) }
    catch (e) { setWarn('Nu s-a putut încărca catalogul: ' + (e?.message || e)); setCandCerinta(null) }
    setCatalogBusy(false)
  }
  const alegeCandidat = async (c, cand) => {
    const a = acoperiri[c.id]
    if (a?.verificat_pe_scan) { setWarn('⚠️ Cerința are deja o dovadă verificată pe scan — nu o suprascriu. Dacă documentul s-a schimbat, verifică manual în HR.'); return }
    const termen = licitatie.termen_depunere ? new Date(String(licitatie.termen_depunere).slice(0, 10)) : null
    // valabil_la_depunere doar unde există „expirare" (autorizație / doc firmă); experiență, recomandare, partener → null
    let valabil = null
    if ((cand.sursa === 'autorizatie' || cand.sursa === 'firma') && termen) valabil = cand.expira === 'niciodata' ? true : (cand.expira ? new Date(cand.expira) >= termen : null)
    const mod = cand.sursa === 'autorizatie' ? (cand.extern ? 'partener' : 'personal') : cand.sursa === 'firma' ? 'firma' : cand.sursa
    const payload = {
      mod, status: cand.sursa === 'partener' ? 'acoperit_partener' : 'acoperit',
      autorizatie_id: cand.sursa === 'autorizatie' ? cand.id : null,
      doc_firma_id: cand.sursa === 'firma' ? cand.id : null,
      partener_id: cand.sursa === 'partener' ? cand.id : null,
      experienta_id: cand.sursa === 'experienta' ? cand.id : null,
      recomandare_id: cand.sursa === 'recomandare' ? cand.id : null,
      document_personal_id: (cand.sursa === 'studii' || cand.sursa === 'vechime') ? cand.id : null,
      referinta_text: `ales manual de ${profile?.name || 'coleg'} · ${cand.titlu}${cand.sub ? ' — ' + cand.sub : ''}`.slice(0, 300),
      valabil_la_depunere: valabil,
      // omul tocmai a ales pe textul curent al cerinței → cererea de reverificare se închide (ca la „Verificat")
      reverificare_ceruta: false, reverificare_motiv: null,
      updated_at: new Date().toISOString(),
    }
    const { error } = a
      ? await supabase.from('ofertare_acoperire').update(payload).eq('id', a.id)
      : await supabase.from('ofertare_acoperire').insert({ cerinta_id: c.id, verificat_pe_scan: false, domeniu_rte: null, ...payload })
    if (error) { setWarn('Nu s-a salvat acoperirea: ' + error.message); return }
    setCandCerinta(null)
    setWarn(`✅ #${c.nr_ordine}: acoperire aleasă manual — ${cand.titlu}.`)
    await load(); onChanged?.()
  }
  const salveazaRaspuns = async (a, text) => {
    const { error } = await supabase.from('ofertare_acoperire').update({ raspuns_coleg: text.trim() || null, raspuns_de: profile?.id || null, raspuns_la: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', a.id)
    if (error) return setWarn('Nu s-a salvat răspunsul: ' + error.message)
    setAcoperiri(m => ({ ...m, [a.cerinta_id]: { ...m[a.cerinta_id], raspuns_coleg: text.trim() || null, raspuns_de: profile?.id || null, raspuns_la: new Date().toISOString() } }))
    setRaspEdit(null)
  }

  const load = async () => {
    // Acoperirea se uită DOAR la registrul de capabilități. Cerințele mutate în
    // „de depunere" (garanție, formulare, acorduri) și „informări pentru execuție"
    // (SSM, deșeuri, probe) nu se dovedesc din catalogul HR — le rula degeaba și
    // înecau ecranul: la Răcari, 629 din 697 de rânduri erau „nu se aplică", iar
    // cele trei probleme reale se pierdeau printre ele.
    // `registru IS NULL` rămâne inclus: o licitație neclasificată încă se comportă
    // exact ca înainte, deci nimic existent nu se strică.
    const { data: cs } = await supabase.from('ofertare_cerinte')
      .select('id, nr_ordine, sursa_sectiune, text_cerinta, tip, lot, stare, stare_motiv, cand_se_prezinta, registru')
      .eq('licitatie_id', licitatie.id).is('inlocuita_de', null).is('duplicat_al', null)
      .or('registru.is.null,registru.eq.capabilitate')
      .in('tip', ['eliminatorie', 'propunere']).order('tip').order('nr_ordine').limit(5000)
    setCerinte(cs || [])
    if (cs?.length) {
      const { data: ac } = await supabase.from('ofertare_acoperire')
        .select('*, autorizatie:hr_autorizatii(id, numar_autorizatie, fisier_path, tip:hr_autorizatii_tipuri(denumire), emp:employees(name), ext:hr_personal_extern(nume)), partener:ofertare_parteneri(nume), doc_firma:documente_firma(id, tip, denumire, numar_document, pdf_path, se_reemite, data_valabilitate), experienta:ofertare_experienta(id, denumire, beneficiar, valoare_lei, valoare_executata_lei, asociere, data_pv), recomandare:hr_recomandari(id, rol, beneficiar, obiect_lucrare, perioada_start, perioada_end, verificat, emp:employees(name), ext:hr_personal_extern(nume)), studii:hr_documente_personale(id, numar_document, emitent, data_emitere, observatii, fisier_path, tip:hr_documente_personale_tipuri(denumire), emp:employees(name))')
        .in('cerinta_id', cs.map(c => c.id)).order('id').limit(5000)
      // O cerință poate avea mai multe rânduri (rândurile verificate pe scan nu se șterg la
      // re-rulare). Fără `.order()` PostgREST le putea întoarce în orice ordine, iar ultimul
      // venit câștiga — deci ecranul arăta ori dovada verificată, ori verdictul AI-ului, la
      // întâmplare. Acum: ordine stabilă, iar dovada verificată de om are întâietate.
      const map = {}; (ac || []).forEach(a => {
        const ex = map[a.cerinta_id]
        if (!ex || (a.verificat_pe_scan && !ex.verificat_pe_scan)) map[a.cerinta_id] = a
      })
      setAcoperiri(map)
    } else setAcoperiri({})
  }
  useEffect(() => { load() }, [licitatie.id])

  const propune = async () => {
    setWarn(null)
    const conflicte = []      // cerințe cu dovadă verificată de om, neatinse de AI
    let neacoperite = 0       // cerințe rămase neevaluate chiar și după reluare
    let neconfirmate = 0      // felii căzute la reluare: rezultatul lor e necunoscut, nu „vechi"
    let duplicate = 0         // rânduri vechi pe care ștergerea nu le-a prins
    const raspunsuriPierdute = []  // aceeași cerință, două răspunsuri de la colegi diferite
    const erori = []          // erorile nu se mai pierd sub nota finală
    // Felii de 55 (v3 cu ids) — registrul întreg nu încape în max_tokens la un singur apel.
    // O felie raportată „trunchiat" se reia la jumătate de mărime (o singură dată).
    const FELIE = 55
    for (const batch of ['eliminatorie', 'propunere']) {
      const ids = (cerinte || []).filter(c => c.tip === batch).map(c => c.id)
      if (!ids.length) continue
      const eticheta = batch === 'eliminatorie' ? 'eliminatoriile' : 'propunerile'
      const deReluat = []
      for (let i = 0; i < ids.length; i += FELIE) {
        const felie = ids.slice(i, i + FELIE)
        setBusy(`Opus confruntă ${eticheta} cu catalogul HR: ${Math.min(i + FELIE, ids.length)}/${ids.length}...`)
        const { data, error } = await supabase.functions.invoke('ofertare-acoperire',
          { body: { licitatie_id: licitatie.id, batch, ids: felie } })
        if (error || data?.error) { setWarn(`${batch}: ${data?.error || error.message}`); setBusy(null); await load(); onChanged?.(); return }
        // Lista de reluat e tăiată la 500 de funcție; dacă tot nu încape, reluăm toată felia,
        // altfel cerințele peste plafon n-ar mai fi cerute niciodată.
        const listaOk = data?.cerinte_fara_raspuns?.length && !data?.lista_fara_raspuns_taiata
        if (data?.trunchiat || data?.fara_raspuns > 0 || data?.felie_goala) deReluat.push(...(listaOk ? data.cerinte_fara_raspuns : felie))
        if (data?.conflicte_verificate?.length) conflicte.push(...data.conflicte_verificate)
        if (data?.duplicate_ramase > 0) duplicate += data.duplicate_ramase
        if (data?.conflicte_raspuns?.length) raspunsuriPierdute.push(...data.conflicte_raspuns)
        await load()
      }
      for (let i = 0; i < deReluat.length; i += 27) {
        const felie = deReluat.slice(i, i + 27)
        setBusy(`Reluare felii trunchiate (${eticheta}): ${Math.min(i + 27, deReluat.length)}/${deReluat.length}...`)
        const { data, error } = await supabase.functions.invoke('ofertare-acoperire',
          { body: { licitatie_id: licitatie.id, batch, ids: felie } })
        // Eroarea se ADUNĂ, nu se pune direct în warn: nota finală o suprascria, iar o cădere
        // de rețea dispărea de pe ecran, înlocuită de numărul de conflicte.
        if (error || data?.error) { erori.push(`${batch} (reluare): ${data?.error || error.message}`); neconfirmate += deReluat.length - i; break }
        // Reluarea își citește la rândul ei starea: dacă și ea s-a tăiat, cerințele rămase
        // păstrează verdictul vechi fără ca nimeni să afle. Le numărăm și le spunem.
        if (data?.conflicte_verificate?.length) conflicte.push(...data.conflicte_verificate)
        if (data?.fara_raspuns > 0) neacoperite += data.fara_raspuns
        if (data?.duplicate_ramase > 0) duplicate += data.duplicate_ramase
        if (data?.conflicte_raspuns?.length) raspunsuriPierdute.push(...data.conflicte_raspuns)
        await load()
      }
    }
    const note = []
    if (erori.length) note.push(`❌ ${erori.join(' · ')}`)
    // O felie picată pe timeout poate să fi apucat să scrie: rezultatul ei e NECONFIRMAT,
    // nu „a rămas verdictul vechi". Sunt două lucruri diferite pentru cine citește tabelul.
    if (neconfirmate > 0) note.push(`❓ ${neconfirmate} cerințe au rămas cu rezultat neconfirmat (reluarea a căzut) — reia propunerea.`)
    if (raspunsuriPierdute.length) note.push(`🔀 ${raspunsuriPierdute.length} cerințe au două răspunsuri/tichete diferite de la colegi — le-am lăsat NEATINSE, propunerea AI nu s-a scris la ele. Alege tu care rămâne.`)
    if (duplicate > 0) note.push(`⚠️ ${duplicate} rânduri vechi n-au putut fi șterse — pot exista acoperiri duplicate pe aceleași cerințe. Verifică înainte să te bazezi pe tabel.`)
    if (neacoperite > 0) note.push(`⚠️ ${neacoperite} cerințe n-au fost reevaluate nici la reluare — păstrează verdictul din rularea anterioară.`)
    if (conflicte.length) note.push(`🔒 ${conflicte.length} cerințe au dovadă verificată de om: propunerea AI-ului NU le-a suprascris. Verifică-le manual dacă documentul s-a schimbat.`)
    if (note.length) setWarn(note.join(' '))
    setBusy(null); await load(); onChanged?.()
  }

  // R1: verificarea copiază scanul autorizației în acoperire — fără scan nu se poate
  const verifica = async (a) => {
    const scan = a.autorizatie?.fisier_path
    if (!scan) { setWarn('Autorizația nu are scan încărcat în HR — încarcă scanul acolo întâi (R1).'); return }
    const { error } = await supabase.from('ofertare_acoperire').update({
      verificat_pe_scan: true, fisier_path: scan, verificat_de: profile?.id || null,
      verificat_la: new Date().toISOString(), updated_at: new Date().toISOString(),
      // omul tocmai s-a uitat pe textul NOU al cerintei: cererea de reverificare se inchide aici,
      // altfel semnalul ramane aprins pe veci si oamenii invata sa-l ignore
      reverificare_ceruta: false, reverificare_motiv: null,
    }).eq('id', a.id)
    if (error) { setWarn('Eroare: ' + error.message); return }
    await load(); onChanged?.()
  }

  // Nu orice dovada are scan de autorizatie (documente de firma, experienta, partener), deci butonul
  // „Verificat" nu poate stinge semnalul peste tot. Fara asta, „⟳ de reverificat" ar ramane aprins
  // pe veci pe jumatate din randuri si oamenii ar invata sa-l ignore — semnalul ar muri de uzura.
  const confirmaReverificare = async (a) => {
    const { error } = await supabase.from('ofertare_acoperire').update({
      reverificare_ceruta: false, reverificare_motiv: null,
      observatii: [a.observatii, `reverificat pe textul nou (${profile?.name || 'coleg'}, ${new Date().toLocaleDateString('ro-RO')})`].filter(Boolean).join(' · '),
      updated_at: new Date().toISOString(),
    }).eq('id', a.id)
    if (error) { setWarn('Eroare: ' + error.message); return }
    await load(); onChanged?.()
  }

  const creeazaTichet = async (c, a) => {
    const eElim = c.tip === 'eliminatorie'
    const persoana = tktForm.persoana || null
    const { data: tkt, error } = await supabase.from('tichete').insert({
      departament: tktForm.departament || 'hr', subcategorie: 'altele',
      // Cu persoană aleasă tichetul pleacă direct „atribuit" (același contract ca formularul din Tichete.jsx)
      ...(persoana ? { persoana_responsabila: persoana, atribuit_de: profile?.id || null, data_atribuire: new Date().toISOString(), asignat_la: 'intern' } : {}),
      titlu: `${eElim ? '🚫 ELIMINATORIE — ' : ''}${a?.status === 'gol' ? 'Gol' : 'Cerință'} ofertare: ${c.text_cerinta.slice(0, 80)}`,
      descriere: `Cerință neacoperită la licitația ${licitatie.nr_anunt} (${licitatie.autoritate}), sursa ${c.sursa_sectiune}:\n\n„${c.text_cerinta}"\n\nMotiv AI: ${a?.referinta_text || '—'}\n\nGenerat din modulul Ofertare (E3).`,
      urgenta: 'normal', status: persoana ? 'atribuit' : 'deschis', deschis_de: profile?.id || null,
      entitate_tip: 'altele', entitate_descriere: `Licitație ${licitatie.nr_anunt}`,
    }).select('id, numar_tichet').single()
    if (error) { setWarn('Tichet: ' + error.message); return }
    if (persoana) {
      const { error: eAsg } = await supabase.from('tichete_asignati').insert({ tichet_id: tkt.id, profile_id: persoana, asignat_de: profile?.id || null })
      if (eAsg) console.warn('tichete_asignati insert:', eAsg.message)
    }
    if (a) await supabase.from('ofertare_acoperire').update({ tichet_id: tkt.id, updated_at: new Date().toISOString() }).eq('id', a.id)
    setTktEdit(null)
    setWarn(`🎫 ${tkt.numar_tichet} creat${persoana ? ' și atribuit lui ' + (profiles[persoana] || 'coleg') : ''}${a ? '' : ' (cerința nu are încă evaluare, tichetul nu e legat de un rând de acoperire)'}.`)
    await load()
  }

  const stats = { acoperit: 0, acoperit_partener: 0, gol: 0, neevaluate: 0, goluriElim: 0, neevaluateElim: 0, nuSeAplica: 0, naElim: 0, nu_se_aplica: 0, reverif: 0, reverifElim: 0 }
  ;(cerinte || []).forEach(c => {
    const a = acoperiri[c.id]
    // marcate „nu se aplică" de om: nu mai sunt goluri, dar rămân numărate separat (nimic nu dispare tăcut)
    const scoasa = c.stare === 'nu_se_aplica'
    if (scoasa) stats.nuSeAplica++
    if (!a) { stats.neevaluate++; if (c.tip === 'eliminatorie' && !scoasa) stats.neevaluateElim++; return }
    // Dovada pusa pe textul VECHI al cerintei nu se numara la ✅ nici aici. Panoul isi face propriile
    // statistici, separat de KPI-uri: daca regula nu e scrisa in ambele locuri, ecranul se contrazice
    // exact acolo unde lucreaza omul — sus „de reverificat", jos „acoperit".
    const acop = a.status === 'acoperit' || a.status === 'acoperit_partener'
    if (acop && a.reverificare_ceruta) {
      stats.reverif++
      if (c.tip === 'eliminatorie' && !scoasa) stats.reverifElim++
      return
    }
    stats[a.status] = (stats[a.status] || 0) + 1
    if (a.status === 'gol' && c.tip === 'eliminatorie' && !scoasa) stats.goluriElim++
    // O eliminatorie pe care AI-ul o crede irelevantă rămâne în alarmă până confirmă un om
    // în registru (cerinte.stare). Altfel modelul ar putea stinge singur poarta E3.
    if (a.status === 'nu_se_aplica' && c.tip === 'eliminatorie' && !scoasa) stats.naElim++
  })
  // aceeași definiție ca v_ofertare_dashboard: eliminatorie fără rând „acoperit" = fără dovadă —
  // iar o dovadă care așteaptă reverificare NU ține loc de dovadă (view-ul face la fel din 12.09)
  const elimFaraDovada = stats.goluriElim + stats.neevaluateElim + stats.naElim + stats.reverifElim
  // Legătura cu registrul: ce e bifat sus se vede aici. Cu „doar bifatele" rămân doar
  // cerințele alese, ca să poți lucra pe un set restrâns fără să-l pierzi din ochi.
  const [fDoarBifate, setFDoarBifate] = useState(false)
  const nrBifateAici = (cerinte || []).filter(c => sel.includes(c.id)).length

  // ── Reviziile acoperirii ───────────────────────────────────────────────
  // 16.09.2026: acoperirea de la Răcari a trecut de la 195 „acoperit" la 57 după
  // o re-rulare, și n-a existat nicio cale de a spune ce s-a schimbat — a fost
  // nevoie de o oră de săpat în date ca să se stabilească că nu era regresie, ci
  // reclasificare. Fiecare rulare completă îngheață o revizie; aici se vede diferența.
  const [revizii, setRevizii] = useState([])
  const [diff, setDiff] = useState(null)
  const [diffBusy, setDiffBusy] = useState(false)
  const incarcaRevizii = async () => {
    const { data } = await supabase.from('ofertare_acoperire_revizii')
      .select('id, revizie, creat_la, motiv, nr_randuri, sumar, doc:ofertare_documente_atribuire(nume_original)')
      .eq('licitatie_id', licitatie.id).order('revizie', { ascending: false }).limit(20)
    setRevizii(data || [])
  }
  useEffect(() => { incarcaRevizii() }, [licitatie.id])
  const comparaRevizii = async (panaLa) => {
    setDiffBusy(true); setDiff(null)
    const { data, error } = await supabase.rpc('fn_ofertare_diff_revizii',
      { p_licitatie_id: licitatie.id, p_pana_la: panaLa, p_de_la: null })
    setDiffBusy(false)
    if (error) return setWarn('Nu s-a putut compara: ' + error.message)
    setDiff({ panaLa, randuri: data || [] })
  }
  const FEL_DIFF = {
    regresie:     { et:'🔴 avea dovadă, nu mai are', c:G.red },
    progres:      { et:'🟢 acum are dovadă',          c:G.green },
    reclasificat: { et:'🟣 reclasificat',             c:G.purple },
    schimbat:     { et:'🔵 altă sursă de dovadă',     c:G.ofertare },
    nou:          { et:'🆕 cerință nouă',             c:G.orange },
    disparut:     { et:'⬜ a dispărut',               c:G.dim },
  }
  useEffect(() => { if (!sel.length) setFDoarBifate(false) }, [sel.length])
  const randuri = (cerinte || [])
    .filter(c => !fDoarGoluri || acoperiri[c.id]?.status === 'gol' || acoperiri[c.id]?.reverificare_ceruta)
    .filter(c => !fDoarBifate || sel.includes(c.id))

  return (
    <div style={{ marginTop:14, padding:14, borderRadius:10, border:`1px solid ${G.border}`, background:G.bg }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10, flexWrap:'wrap' }}>
        <div style={{ fontSize:13, fontWeight:800 }}>🎯 Acoperirea cerințelor</div>
        {cerinte?.length > 0 && (
          <span style={{ fontSize:11.5, color:G.muted }}>
            ✅ {stats.acoperit} · 🤝 {stats.acoperit_partener} · 🔴 {stats.gol} goluri · ⬜ {stats.neevaluate} neevaluate{stats.reverif ? <span style={{ color:G.orange, fontWeight:700 }}> · ⟳ {stats.reverif} de reverificat</span> : ''}
            {stats.nu_se_aplica > 0 && <span style={{ color:G.purple }} title="AI-ul le-a clasat ca „nu se aplică”. E o propunere, nu o decizie: cele eliminatorii rămân în alarmă până le confirmi în registru."> · ⊘ {stats.nu_se_aplica} AI: nu se aplică</span>}
            {stats.regula_propunere > 0 && <span style={{ color:G.orange }} title="Reguli de alcătuire a echipei (ex. o persoană nu poate cumula funcții) — nu se acoperă cu document, se verifică la Propunerea tehnică."> · 👥 {stats.regula_propunere} reguli → propunere</span>}
            {stats.nuSeAplica > 0 && <span style={{ color:G.purple }} title="Marcate „nu se aplică” în registrul de cerințe — ies din numărătoarea de eliminatorii fără dovadă"> · ⊘ {stats.nuSeAplica} nu se aplică</span>}
            {elimFaraDovada > 0 && (
              <b style={{ color:G.red }} title={`Eliminatorii fără dovadă = goluri (${stats.goluriElim}) + neevaluate (${stats.neevaluateElim}) + clasate de AI ca „nu se aplică" dar neconfirmate de om (${stats.naElim}). Ies din numărătoare doar cele marcate „nu se aplică" în registru. Aceeași cifră ca în lista de licitații.`}>
                {' '}· {elimFaraDovada} ELIMINATORII fără dovadă ({stats.goluriElim} goluri + {stats.neevaluateElim} neevaluate{stats.naElim ? ` + ${stats.naElim} AI „nu se aplică" neconfirmate` : ''})
              </b>
            )}
          </span>
        )}
        <div style={{ marginLeft:'auto', display:'flex', gap:8, alignItems:'center' }}>
          <label style={{ fontSize:11.5, color:G.muted, display:'flex', alignItems:'center', gap:5, cursor:'pointer' }}>
            <input type="checkbox" checked={fDoarGoluri} onChange={e => setFDoarGoluri(e.target.checked)} style={{ accentColor:G.red }} /> de rezolvat (goluri + de reverificat)
          </label>
          {nrBifateAici > 0 && (
            <label title="Cerințele bifate în registrul de mai sus" style={{ fontSize:11.5, color:G.ofertare, fontWeight:700, display:'flex', alignItems:'center', gap:5, cursor:'pointer' }}>
              <input type="checkbox" checked={fDoarBifate} onChange={e => setFDoarBifate(e.target.checked)} style={{ accentColor:G.ofertare }} /> doar bifatele din registru ({nrBifateAici})
            </label>
          )}
          {!busy && poatePorniProcesarea(profile, licitatie) && <button style={{ ...S.btnP, padding:'7px 12px', fontSize:12 }} onClick={propune}>🤖 Propune acoperiri (Opus)</button>}
          {!busy && !poatePorniProcesarea(profile, licitatie) && <span style={{ fontSize:11.5, color:G.dim, alignSelf:'center' }} title={MOTIV_POARTA}>🔒 acoperirea o rulează ownerul / responsabilul</span>}
        </div>
      </div>
      {busy && <div style={{ fontSize:12, color:G.ofertare, fontWeight:700, marginBottom:8 }}>🤖 {busy}</div>}
      {warn && <div style={{ fontSize:12, color:G.orange, marginBottom:8 }}>{warn}</div>}

      {revizii.length > 0 && (
        <div style={{ marginBottom:8, padding:'7px 10px', borderRadius:7, background:G.surface, border:`1px solid ${G.border2}` }}>
          <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
            <span style={{ fontSize:11.5, fontWeight:700, color:G.muted }}>📚 Revizii:</span>
            {revizii.map(r => (
              <button key={r.id} onClick={() => comparaRevizii(r.revizie)} disabled={r.revizie === 1}
                title={`${r.motiv || 'fără motiv notat'}${r.doc?.nume_original ? ' · declanșată de: ' + r.doc.nume_original : ''} · ${r.nr_randuri} rânduri`}
                style={{ ...S.btnS, padding:'3px 8px', fontSize:11,
                  opacity: r.revizie === 1 ? 0.55 : 1,
                  cursor: r.revizie === 1 ? 'default' : 'pointer',
                  borderColor: diff?.panaLa === r.revizie ? G.ofertare : G.border2 }}>
                v{r.revizie} · {new Date(r.creat_la).toLocaleDateString('ro-RO')}
                {r.revizie > 1 && ' · compară'}
              </button>
            ))}
            {diffBusy && <span style={{ fontSize:11, color:G.ofertare }}>se compară…</span>}
            {diff && <button onClick={() => setDiff(null)} style={{ ...S.btnS, padding:'3px 8px', fontSize:11, marginLeft:'auto' }}>închide</button>}
          </div>
          {diff && (
            <div style={{ marginTop:7, maxHeight:210, overflowY:'auto' }}>
              {!diff.randuri.length
                ? <div style={{ fontSize:11.5, color:G.green }}>Nimic nu s-a schimbat față de revizia anterioară.</div>
                : <>
                    <div style={{ fontSize:11.5, color:G.muted, marginBottom:5 }}>
                      {diff.randuri.length} cerințe s-au schimbat față de revizia anterioară
                      {diff.randuri.filter(d => d.fel === 'regresie').length > 0 &&
                        <b style={{ color:G.red }}> · {diff.randuri.filter(d => d.fel === 'regresie').length} au pierdut dovada</b>}
                    </div>
                    {diff.randuri.map(d => {
                      const f = FEL_DIFF[d.fel] || FEL_DIFF.schimbat
                      return (
                        <div key={d.cerinta_id} style={{ fontSize:11.5, padding:'4px 7px', marginBottom:3, borderRadius:5,
                          background:G.bg, borderLeft:`3px solid ${f.c}` }}>
                          <b style={{ color:f.c }}>{f.et}</b>
                          <span style={{ color:G.dim }}> · #{d.cerinta_id}{d.sectiune ? ' · ' + d.sectiune : ''}{d.tip === 'eliminatorie' ? ' · ELIMINATORIE' : ''}</span>
                          <div style={{ color:G.text, marginTop:2 }}>{d.text_cerinta}</div>
                          <div style={{ color:G.muted, marginTop:2 }}>
                            {d.status_vechi || '—'} → {d.status_nou || '—'}
                            {d.motiv_nou ? ` · ${d.motiv_nou}` : ''}
                          </div>
                        </div>
                      )
                    })}
                  </>}
            </div>
          )}
        </div>
      )}

      {cerinte === null ? <div style={{ fontSize:12, color:G.muted }}>Se încarcă...</div> :
        !cerinte.length ? <div style={{ fontSize:12, color:G.dim }}>Întâi extrage registrul de cerințe (secțiunea de mai sus) — apoi aici Opus îl confruntă cu autorizațiile din HR și partenerii.</div> :
        (
          <div style={{ maxHeight:320, overflowY:'auto', display:'flex', flexDirection:'column', gap:4 }}>
            {randuri.map(c => {
              const a = acoperiri[c.id]
              // Randul de reverificat isi ia culoarea si eticheta din starea lui reala, nu din statusul
              // vechi: altfel bara ramane verde si portocaliul de langa ea pare o nota de subsol.
              const st = a ? (a.reverificare_ceruta ? { label:'⟳ de reverificat', color:G.orange } : (ACOPERIRE_STATUS[a.status] || ACOPERIRE_STATUS.gol)) : null
              // Acoperirea pe experiență trebuie să spună CU CE lucrare, altfel „acoperit" e o
              // afirmație fără sursă pe ecran. La asociere arătăm cota proprie, nu totalul.
              // #73: recomandarea (experiența PERSOANEI) — se spune cine, ce rol, la cine, pe ce lucrare
              // 17.09.2026: dovada de studii spune CINE și CU CE diplomă — altfel „acoperit" e o
              // afirmație fără sursă pe ecran, exact ca la experiență și la recomandare.
              // `studii` e embed-ul pe document_personal_id, deci vine și pentru mod='vechime':
              // acolo denumirea tipului (CV / adeverință REGES) e mai lămuritoare decât observațiile.
              const titular = a?.studii
                ? `${a.studii.emp?.name || '?'} — ${a.mod === 'vechime' ? (a.studii.tip?.denumire || 'dovadă de vechime') : (a.studii.observatii ? a.studii.observatii.slice(0, 70) : (a.studii.tip?.denumire || 'diplomă'))}${a.studii.emitent ? ' · ' + a.studii.emitent.slice(0, 50) : ''}`
                : a?.recomandare
                ? `${a.recomandare.emp?.name || a.recomandare.ext?.nume || '?'} — ${a.recomandare.rol || 'rol nespecificat'} la ${a.recomandare.beneficiar || '?'}${a.recomandare.obiect_lucrare ? ' („' + a.recomandare.obiect_lucrare.slice(0, 70) + '")' : ''}${a.recomandare.verificat ? '' : ' · recomandare NEVERIFICATĂ în HR'}`
                : a?.experienta
                ? `${a.experienta.denumire}${a.experienta.asociere ? ' (asociere — cota Gazpet ' + (a.experienta.valoare_executata_lei ? Math.round(a.experienta.valoare_executata_lei / 1000) + ' mii lei' : 'NECUNOSCUTĂ') + ')' : (a.experienta.valoare_lei ? ' (' + Math.round(a.experienta.valoare_lei / 1000) + ' mii lei)' : '')}`
                : (a?.doc_firma ? 'GAZPET INSTAL (firmă)' : (a?.autorizatie ? (a.autorizatie.emp?.name || a.autorizatie.ext?.nume) : a?.partener?.nume))
              const bifat = sel.includes(c.id)
              return (
                <div key={c.id} id={`acop-${c.id}`} style={{ padding:'7px 10px', borderRadius:7, background: bifat ? G.ofertare + '1a' : G.surface, borderLeft:`3px solid ${a ? st.color : G.border2}`, outline: bifat ? `1px solid ${G.ofertare}66` : 'none' }}>
                  <div style={{ display:'flex', alignItems:'flex-start', gap:8, flexWrap:'wrap' }}>
                    <span title={bifat ? 'Bifată în registrul de cerințe' : 'Număr de ordine — același în registrul de cerințe'}
                      style={{ fontSize:11.5, fontWeight:800, color: bifat ? G.ofertare : G.dim, minWidth:34, textAlign:'right', fontVariantNumeric:'tabular-nums' }}>#{c.nr_ordine}</span>
                    <span style={{ fontSize:10.5, fontWeight:800, color: a ? st.color : G.dim, whiteSpace:'nowrap', minWidth:82 }}>{a ? st.label : '⬜ neevaluat'}</span>
                    {c.tip === 'eliminatorie' && <span style={{ fontSize:10, fontWeight:800, color:G.red, border:`1px solid ${G.red}55`, borderRadius:8, padding:'1px 6px' }}>ELIM</span>}
                    {c.stare === 'nu_se_aplica' && <span title={c.stare_motiv || ''} style={{ fontSize:10, fontWeight:800, color:G.purple, border:`1px solid ${G.purple}55`, borderRadius:8, padding:'1px 6px' }}>⊘ NU SE APLICĂ</span>}
                    {c.stare === 'blocata' && <span title={c.stare_motiv || ''} style={{ fontSize:10, fontWeight:800, color:G.red, border:`1px solid ${G.red}55`, borderRadius:8, padding:'1px 6px' }}>⛔ BLOCATĂ</span>}
                    {a?.domeniu_rte && <span title="Domeniul ISC RTE pe care motorul a judecat cerința (din obiectul contractului + textul cerinței, după nomenclatorul Procedurii ISC)" style={{ fontSize:10, fontWeight:800, color:G.blue, border:`1px solid ${G.blue}55`, borderRadius:8, padding:'1px 6px', whiteSpace:'nowrap' }}>RTE {a.domeniu_rte}</span>}
                    <span style={{ fontSize:11, color:G.muted, fontWeight:700, whiteSpace:'nowrap' }}>{c.sursa_sectiune}</span>
                    <span style={{ flex:1, fontSize:12.5, minWidth:200 }}>{c.text_cerinta}</span>
                    <span style={{ display:'flex', gap:5, marginLeft:'auto', alignItems:'center' }}>
                      <button title="Cine poate acoperi cerința: candidați din BD (autorizații, documente firmă, parteneri, experiență, recomandări) potriviți pe cuvinte-cheie — fără AI, gratuit. Alegi manual."
                        onClick={() => deschideCandidati(c)}
                        style={{ ...S.btnS, padding:'3px 9px', fontSize:11, color:G.ofertare, borderColor:G.ofertare + '66', whiteSpace:'nowrap', opacity: a?.verificat_pe_scan ? .55 : 1 }}>🔍 Cine poate acoperi</button>
                      {a?.reverificare_ceruta && (
                        <button title={(a.reverificare_motiv || 'Textul cerinței s-a schimbat după ce dovada a fost pusă') + ' — apasă după ce ai citit textul nou și dovada ține în continuare'}
                          onClick={() => confirmaReverificare(a)}
                          style={{ ...S.btnS, padding:'3px 9px', fontSize:11, fontWeight:800, color:G.orange, borderColor:G.orange + '66', whiteSpace:'nowrap' }}>⟳ de reverificat</button>
                      )}
                      {a && a.status !== 'gol' && a.status !== 'nu_se_aplica' && a.status !== 'regula_propunere' && (!a.verificat_pe_scan || a.reverificare_ceruta) && (
                        <button title={a.autorizatie?.fisier_path ? 'Verificat pe scan (R1) — copiază scanul autorizației' : 'Autorizația nu are scan în HR'}
                          onClick={() => verifica(a)} style={{ ...S.btnS, padding:'3px 9px', fontSize:11, color:G.green, borderColor:G.green + '66', opacity: a.autorizatie?.fisier_path ? 1 : .45 }}>👁 Verificat</button>
                      )}
                      {a?.verificat_pe_scan && !a.reverificare_ceruta && <span style={{ fontSize:11, color:G.green, fontWeight:700 }} title="Verificat pe scan">✓✓</span>}
                      {!a?.tichet_id && c.stare !== 'nu_se_aplica' && (
                        <button title="Deschide tichet pe cerința asta către un departament / o persoană (nu doar pe goluri)" onClick={() => { setTktEdit(tktEdit === c.id ? null : c.id); setTktForm({ departament: 'hr', persoana: '' }) }}
                          style={{ ...S.btnS, padding:'3px 9px', fontSize:11, color:G.orange, borderColor:G.orange + '66', background: tktEdit === c.id ? G.orange + '22' : undefined }}>🎫 Tichet</button>
                      )}
                      {a?.tichet_id && <span style={{ fontSize:11, color:G.orange, fontWeight:700 }} title={`Are tichet deschis (id ${a.tichet_id})`}>🎫</span>}
                      {a && (a.status === 'gol' || a.valabil_la_depunere === false) && (
                        <button title="Răspunsul tău pentru platformă: ce ai găsit / ce ai făcut / până când rezolvi" onClick={() => setRaspEdit(raspEdit === a.id ? null : a.id)}
                          style={{ ...S.btnS, padding:'3px 9px', fontSize:11, color: a.raspuns_coleg ? G.green : G.blue, borderColor: (a.raspuns_coleg ? G.green : G.blue) + '66' }}>{a.raspuns_coleg ? '💬 răspuns ✓' : '💬 răspunde'}</button>
                      )}
                    </span>
                  </div>
                  {tktEdit === c.id && (
                    <div style={{ marginTop:6, display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
                      <select value={tktForm.departament} onChange={e => setTktForm(f => ({ ...f, departament: e.target.value }))} style={{ ...S.input, fontSize:12, padding:'4px 8px', width:'auto' }}>
                        {TKT_DEPARTAMENTE.map(([cod, nume]) => <option key={cod} value={cod}>{nume}</option>)}
                      </select>
                      <select value={tktForm.persoana} onChange={e => setTktForm(f => ({ ...f, persoana: e.target.value }))} style={{ ...S.input, fontSize:12, padding:'4px 8px', width:'auto', maxWidth:260 }}>
                        <option value="">— fără persoană (rămâne „deschis" pe departament) —</option>
                        {Object.entries(profiles).sort((x, y) => (x[1] || '').localeCompare(y[1] || '')).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                      </select>
                      <button style={{ ...S.btnP, padding:'5px 12px', fontSize:12 }} onClick={() => creeazaTichet(c, a)}>Creează tichetul</button>
                      <button style={{ ...S.btnS, padding:'5px 10px', fontSize:12 }} onClick={() => setTktEdit(null)}>Renunț</button>
                    </div>
                  )}
                  {a && raspEdit === a.id && (
                    <div style={{ marginTop:6, display:'flex', gap:6 }}>
                      <textarea autoFocus defaultValue={a.raspuns_coleg || ''} id={`rasp-${a.id}`} placeholder="ex: am cerut constatatorul la ONRC, vine joi / documentul e la Mirela / nu avem, propun partener X" style={{ ...S.input, minHeight:52, fontSize:12 }} />
                      <button style={{ ...S.btnP, padding:'6px 12px', fontSize:12, alignSelf:'flex-end' }} onClick={() => salveazaRaspuns(a, document.getElementById(`rasp-${a.id}`).value)}>Salvează</button>
                    </div>
                  )}
                  {a?.raspuns_coleg && raspEdit !== a.id && (
                    <div style={{ fontSize:11.5, color:G.text, marginTop:4, padding:'5px 8px', background:G.card, borderRadius:6, borderLeft:`2px solid ${G.blue}` }}>
                      💬 <b>{profiles[a.raspuns_de] || 'coleg'}</b> ({a.raspuns_la ? new Date(a.raspuns_la).toLocaleDateString('ro-RO') : ''}): {a.raspuns_coleg}
                    </div>
                  )}
                  {a && (titular || a.referinta_text) && (
                    <div style={{ fontSize:11, color:G.dim, marginTop:3 }}>
                      {titular && <b style={{ color:G.text }}>{titular}</b>}
                      {a.autorizatie?.tip?.denumire && <> · {a.autorizatie.tip.denumire}{a.autorizatie.numar_autorizatie ? ` nr. ${a.autorizatie.numar_autorizatie}` : ''}</>}
                      {a.doc_firma && <> · {a.doc_firma.tip}{a.doc_firma.numar_document ? ` nr. ${a.doc_firma.numar_document}` : ''}</>}
                      {a.doc_firma?.se_reemite
                        ? (['primul_loc', 'duae'].includes(c.cand_se_prezinta)
                            ? <b style={{ color:G.blue }}> · 🔄 {c.cand_se_prezinta === 'duae' ? 'se declară în DUAE' : 'se prezintă doar de ofertantul de pe locul I'} — certificatul se emite atunci (30 zile), nu la depunere</b>
                            : reemisUrgent(a.doc_firma, licitatie.termen_depunere)
                              ? <b style={{ color:G.red }}> · 🔄 DE REEMIS ACUM — certificat de 30 zile, nu e valabil la depunere!</b>
                              : <b style={{ color:G.orange }}> · 🔄 se emite proaspăt la depunere (valabil 30 zile){a.doc_firma.data_valabilitate ? ` — actualul până la ${fmtZi(a.doc_firma.data_valabilitate)}` : ''}</b>)
                        : a.valabil_la_depunere === false && (['primul_loc', 'duae'].includes(c.cand_se_prezinta)
                            ? <b style={{ color:G.orange }}> · expiră înainte de depunere, dar se cere {c.cand_se_prezinta === 'duae' ? 'în DUAE' : 'doar la locul I'} — de reînnoit până atunci</b>
                            : <b style={{ color:G.red }}> · EXPIRĂ înainte de depunere!</b>)}
                      {a.referinta_text && <> — {a.referinta_text}</>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      {candCerinta && (
        <CandidatiAcoperirePanel cerinta={candCerinta} acoperire={acoperiri[candCerinta.id]} catalog={catalog} busy={catalogBusy}
          termen={licitatie.termen_depunere} onAlege={cand => alegeCandidat(candCerinta, cand)} onClose={() => setCandCerinta(null)} />
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// #68 varianta B: „Cine poate acoperi" — potrivire LEXICALĂ (fără AI) între textul cerinței și
// catalogul din BD. Sugestii brute, sortate după nr. de cuvinte-cheie comune; omul alege.
// ════════════════════════════════════════════════════════════════
// cuvinte frecvente în cerințe care nu spun nimic despre CE document trebuie (peste STOP_CUVINTE)
const STOP_CERINTE = new Set(['ofertantul','ofertantii','ofertanti','ofertant','trebuie','prezinta','prezenta','prezentarea','dovada','dovedeasca','document','documente','documentul','documentele','minim','minimum','copie','copii','conform','conformitate','cerinta','cerinte','care','sunt','este','fiecare','catre','poate','prin','vor','fi','sa','se','ca','sau','ori','dupa','fara','intre','asupra','precum','respectiv','astfel','urmatoarele','declaratie','declaratia','formular','formularul','anexa','solicita','solicitat','solicitata','autoritatea','contractanta','contractant','contractului','contract','acord','cadru','obiectul','achizitie','achizitiei','oferta','ofertei','valabil','valabila','valabilitate','termen','termenul','data','depunere','depunerii','operatorul','operatorului','economic','economici','operatori','nivel','nivelul','cerut','ceruta','necesar','necesara','obligatoriu','indeplinire','indeplinirea','conditii','conditiile','cazul','caz','aceasta','acest','aceste','acestea','celor','unei','unui','unor','fost','avea','face','tuturi','toate','toti','orice','oricare','exista','existenta','forma','original','legalizata','legalizat','emis','emise','emisa','emitent','persoana','persoanele','persoanei','persoane'])
const cuvinteCerinta = (text) => [...cuvinteCheie(text)].filter(w => !STOP_CERINTE.has(w))
// potrivire pe cuvânt: egal sau același prefix de 6 litere (sudori/sudorilor, autorizat/autorizatie) — „brut", nu verdict
const potriveste = (w, tokens) => tokens.some(t => t === w || (w.length >= 6 && t.length >= 6 && t.slice(0, 6) === w.slice(0, 6)))
const scorCandidat = (cuvinte, cand) => cuvinte.filter(w => potriveste(w, cand.tokens))
const SURSE_CAND = {
  autorizatie: { icon:'🪪', label:'Autorizații personal (HR)', color:G.green },
  firma:       { icon:'🏢', label:'Documente firmă', color:G.blue },
  partener:    { icon:'🤝', label:'Parteneri', color:G.teal },
  experienta:  { icon:'🏗', label:'Experiență similară', color:G.orange },
  recomandare: { icon:'📜', label:'Recomandări (persoane)', color:G.purple },
  studii:      { icon:'🎓', label:'Diplome și calificări', color:G.ofertare },
  vechime:     { icon:'📆', label:'Vechime (CV, REGES, adeverințe)', color:G.blue },
}
// Aceleași filtre ca motorul AI (ofertare-acoperire): deleted_at null / activ / abandonat=false.
async function incarcaCatalogAcoperire() {
  const [aut, docs, part, exp, rec, stud, vech] = await Promise.all([
    supabase.from('hr_autorizatii').select('id, numar_autorizatie, data_expirare, fara_expirare, domenii, procedeu_sudura, diametru_teava_mm, emitent, observatii, fisier_path, document_personal_id, doc:hr_documente_personale(fisier_path), tip:hr_autorizatii_tipuri(denumire, cod), emp:employees(name, active), ext:hr_personal_extern(nume, activ)').is('deleted_at', null).order('id').limit(5000),
    supabase.from('documente_firma').select('id, tip, denumire, categorie, numar_document, autoritate_emitenta, data_valabilitate, fara_expirare, se_reemite').eq('activ', true).order('id').limit(5000),
    supabase.from('ofertare_parteneri').select('id, nume, tip_relatie, observatii').eq('activ', true).eq('abandonat', false).order('nume').limit(2000),
    supabase.from('ofertare_experienta').select('id, denumire, beneficiar, valoare_lei, valoare_executata_lei, data_pv, tip_pv, asociere, piese, observatii').eq('activ', true).order('id').limit(5000),
    supabase.from('hr_recomandari').select('id, rol, beneficiar, obiect_lucrare, perioada_start, perioada_end, valoare_lei, domenii, verificat, emp:employees(name, active), ext:hr_personal_extern(nume, activ)').eq('activ', true).order('id').limit(5000),
    // 17.09.2026: diplomele și calificările (categoria 'studii'). Restul dosarului de personal nu intră
    // aici — CI, cazier, extras de cont n-au ce dovedi în fața autorității și sunt date personale.
    supabase.from('hr_documente_personale').select('id, numar_document, emitent, data_emitere, observatii, fisier_path, tip:hr_documente_personale_tipuri!inner(cod, denumire, categorie), emp:employees(name, active)').eq('tip.categorie', 'studii').eq('activ', true).is('deleted_at', null).order('id').limit(5000),
    // 17.09.2026: dovezile de vechime de la angajatori anteriori (CV, extras REGES, adeverințe
    // de încetare, anexa 7). Acoperă cerințele de „minimum N ani experiență", pe care
    // recomandările nu le acoperă când perioadele din ele nu ajung la N.
    supabase.from('hr_documente_personale').select('id, numar_document, emitent, data_emitere, observatii, fisier_path, tip:hr_documente_personale_tipuri!inner(cod, denumire, categorie), emp:employees(name, active)').eq('tip.categorie', 'angajator_anterior').eq('activ', true).is('deleted_at', null).order('id').limit(5000),
  ])
  const err = [aut, docs, part, exp, rec, stud, vech].find(r => r.error)?.error
  if (err) throw err
  // 17.09.2026 (Răzvan): persoanele cu contract închis (employees.active=false) sau externii dezactivați
  // nu mai apar între candidați — Nicu Iosif Cătălin cu 4 autorizații apărea la „Cine poate acoperi”
  // deși nu mai e în firmă. Documentele lor rămân în HR, doar nu se mai propun la ofertare.
  const titularActiv = r => !(r.emp && r.emp.active === false) && !(r.ext && r.ext.activ === false)
  for (const r of [aut, rec, stud, vech]) r.data = (r.data || []).filter(titularActiv)
  const arr = (x) => Array.isArray(x) ? x.join(' ') : (x || '')
  const mk = (sursa, id, titlu, sub, text, extra = {}) => ({ sursa, id, titlu, sub, tokens: normText(text).split(' ').filter(Boolean), ...extra })
  const out = []
  ;(aut.data || []).forEach(a => {
    const titular = a.emp?.name || a.ext?.nume || '?'
    const tip = a.tip?.denumire || 'autorizație'
    out.push(mk('autorizatie', a.id, `${titular} — ${tip}`,
      [a.numar_autorizatie ? `nr. ${a.numar_autorizatie}` : null, a.emitent, arr(a.domenii), a.procedeu_sudura, a.diametru_teava_mm ? `Ø${a.diametru_teava_mm}` : null, a.ext ? 'EXTERN' : null].filter(Boolean).join(' · '),
      `${tip} ${a.tip?.cod || ''} ${titular} ${a.emitent || ''} ${arr(a.domenii)} ${a.procedeu_sudura || ''} ${a.observatii || ''}`,
      // 17.09.2026: scanul poate sta pe documentul personal LEGAT, nu pe autorizatie. Toate cele 21
      // de autorizatii legate erau tocmai alea fara `fisier_path` propriu — deci raportul „fara scan"
      // le numara pe toate 44, desi 21 aveau scanul la un click distanta. Aici e doar steagul
      // informativ; butonul „Verificat pe scan" ramane pe fisier_path, fiindca el copiaza calea si
      // cele doua scanuri stau in bucket-uri diferite (autorizatii vs documente-personal).
      { extern: !!a.ext, expira: a.fara_expirare ? 'niciodata' : (a.data_expirare || null), are_scan: !!(a.fisier_path || a.doc?.fisier_path) }))
  })
  ;(docs.data || []).forEach(d => {
    out.push(mk('firma', d.id, `${d.tip || 'document'}${d.denumire ? ' — ' + d.denumire : ''}`,
      [d.numar_document ? `nr. ${d.numar_document}` : null, d.categorie, d.autoritate_emitenta, d.se_reemite ? 'se reemite la depunere' : null].filter(Boolean).join(' · '),
      `${d.tip || ''} ${d.denumire || ''} ${d.categorie || ''} ${d.autoritate_emitenta || ''}`,
      { expira: d.fara_expirare ? 'niciodata' : (d.data_valabilitate || null), se_reemite: !!d.se_reemite }))
  })
  ;(part.data || []).forEach(p => {
    out.push(mk('partener', p.id, p.nume, [p.tip_relatie, p.observatii ? p.observatii.slice(0, 90) : null].filter(Boolean).join(' · '), `${p.nume} ${p.tip_relatie || ''} ${p.observatii || ''}`))
  })
  ;(exp.data || []).forEach(e => {
    const val = e.asociere ? (e.valoare_executata_lei ? `cota Gazpet ${Math.round(e.valoare_executata_lei / 1000)} mii lei` : 'asociere, cotă necunoscută') : (e.valoare_lei ? `${Math.round(e.valoare_lei / 1000)} mii lei` : null)
    out.push(mk('experienta', e.id, e.denumire, [e.beneficiar, val, e.data_pv ? `PV ${fmtZi(e.data_pv)}` : null, e.piese].filter(Boolean).join(' · '), `${e.denumire} ${e.beneficiar || ''} ${e.tip_pv || ''} ${e.piese || ''} ${e.observatii || ''}`))
  })
  ;(rec.data || []).forEach(r => {
    const cine = r.emp?.name || r.ext?.nume || '?'
    out.push(mk('recomandare', r.id, `${cine} — ${r.rol || 'rol nespecificat'}`,
      [r.beneficiar, r.obiect_lucrare ? r.obiect_lucrare.slice(0, 80) : null, r.perioada_start ? `${String(r.perioada_start).slice(0, 4)}–${r.perioada_end ? String(r.perioada_end).slice(0, 4) : '…'}` : null, r.verificat ? null : 'NEVERIFICATĂ în HR'].filter(Boolean).join(' · '),
      `${cine} ${r.rol || ''} ${r.beneficiar || ''} ${r.obiect_lucrare || ''} ${arr(r.domenii)}`))
  })
  ;(stud.data || []).forEach(d => {
    const cine = d.emp?.name || '?'
    const fel = d.tip?.denumire || 'document de studii'
    out.push(mk('studii', d.id, `${cine} — ${fel}`,
      [d.observatii ? d.observatii.slice(0, 90) : null, d.emitent, d.numar_document ? `nr. ${d.numar_document}` : null, d.data_emitere ? String(d.data_emitere).slice(0, 4) : null].filter(Boolean).join(' · '),
      `${cine} ${fel} ${d.tip?.cod || ''} ${d.observatii || ''} ${d.emitent || ''}`,
      { expira: 'niciodata', are_scan: !!d.fisier_path }))
  })
  ;(vech.data || []).forEach(d => {
    const cine = d.emp?.name || '?'
    const fel = d.tip?.denumire || 'dovadă de vechime'
    // Un CV e declarat de om, nu emis de un terț: se poate alege, dar scrie pe el ce e.
    const declarat = d.tip?.cod === 'cv'
    out.push(mk('vechime', d.id, `${cine} — ${fel}${declarat ? ' (declarat, nu probant)' : ''}`,
      [d.observatii ? d.observatii.slice(0, 90) : null, d.emitent, d.numar_document ? `nr. ${d.numar_document}` : null, d.data_emitere ? String(d.data_emitere).slice(0, 4) : null].filter(Boolean).join(' · '),
      `${cine} ${fel} ${d.tip?.cod || ''} vechime experienta ani ${d.observatii || ''} ${d.emitent || ''}`,
      { expira: 'niciodata', are_scan: !!d.fisier_path }))
  })
  return out
}
function CandidatiAcoperirePanel({ cerinta, acoperire, catalog, busy, termen, onAlege, onClose }) {
  const [cauta, setCauta] = useState('')
  const [scriu, setScriu] = useState(null)
  const cuvinte = useMemo(() => cuvinteCerinta(cerinta.text_cerinta), [cerinta.text_cerinta])
  const termenD = termen ? new Date(String(termen).slice(0, 10)) : null
  const q = normText(cauta)
  const { cuScor, restul } = useMemo(() => {
    const cuScor = [], restul = []
    ;(catalog || []).forEach(cand => {
      if (q && !normText(cand.titlu + ' ' + cand.sub).includes(q)) return
      const hits = scorCandidat(cuvinte, cand)
      ;(hits.length ? cuScor : restul).push({ ...cand, scor: hits.length, hits })
    })
    cuScor.sort((x, y) => y.scor - x.scor || x.titlu.localeCompare(y.titlu))
    restul.sort((x, y) => x.sursa.localeCompare(y.sursa) || x.titlu.localeCompare(y.titlu))
    return { cuScor, restul }
  }, [catalog, cuvinte, q])
  const blocat = !!acoperire?.verificat_pe_scan
  // marcaj valabilitate față de termenul de depunere (doar surse cu expirare)
  const valab = (cand) => {
    if (cand.sursa !== 'autorizatie' && cand.sursa !== 'firma') return null
    if (cand.expira === 'niciodata') return { t:'∞ fără expirare', c:G.green }
    if (!cand.expira) return { t:'expirare necunoscută', c:G.dim }
    const ok = termenD ? new Date(cand.expira) >= termenD : new Date(cand.expira) >= new Date()
    return { t:`${ok ? 'valabil' : 'EXPIRĂ'} · ${fmtZi(cand.expira)}`, c: ok ? G.green : G.red }
  }
  const alege = async (cand) => { setScriu(cand.sursa + cand.id); try { await onAlege(cand) } finally { setScriu(null) } }
  const Rand = ({ cand }) => {
    const s = SURSE_CAND[cand.sursa], v = valab(cand)
    return (
      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 8px', borderRadius:6, background:G.surface, borderLeft:`3px solid ${s.color}` }}>
        <span title={s.label} style={{ fontSize:14 }}>{s.icon}</span>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:12.5, fontWeight:700, color:G.text }}>{cand.titlu}
            {cand.extern && <span style={{ marginLeft:6, fontSize:10, color:G.teal, fontWeight:800 }}>EXTERN → partener</span>}
            {cand.sursa === 'autorizatie' && !cand.are_scan && <span style={{ marginLeft:6, fontSize:10, color:G.orange }} title="Fără scan în HR — nu se va putea „verifica pe scan” (R1)">fără scan</span>}
          </div>
          {cand.sub && <div style={{ fontSize:11, color:G.muted }}>{cand.sub}</div>}
          {cand.hits?.length > 0 && <div style={{ fontSize:10.5, color:G.dim }}>potrivit pe: {cand.hits.join(', ')}</div>}
        </div>
        {v && <span style={{ fontSize:10.5, fontWeight:700, color:v.c, whiteSpace:'nowrap' }}>{v.t}</span>}
        {cand.scor > 0 && <span style={{ fontSize:10.5, fontWeight:800, color:G.ofertare, border:`1px solid ${G.ofertare}66`, borderRadius:8, padding:'1px 6px' }} title="Număr de cuvinte-cheie comune (scor brut)">{cand.scor}</span>}
        <button disabled={blocat || !!scriu} onClick={() => alege(cand)}
          title={blocat ? 'Cerința are dovadă verificată pe scan — nu se suprascrie' : 'Scrie acoperirea manual pe această cerință'}
          style={{ ...S.btnP, padding:'4px 10px', fontSize:11.5, opacity: (blocat || scriu) ? .5 : 1, cursor: blocat ? 'not-allowed' : 'pointer' }}>{scriu === cand.sursa + cand.id ? '…' : 'Alege'}</button>
      </div>
    )
  }
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.7)', zIndex:1100, display:'flex', alignItems:'flex-start', justifyContent:'center', overflowY:'auto', padding:'30px 14px' }} onClick={onClose}>
      <div style={{ ...S.card, width:'100%', maxWidth:820, padding:16, display:'flex', flexDirection:'column', gap:10, maxHeight:'calc(100vh - 60px)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display:'flex', alignItems:'flex-start', gap:10 }}>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:14, fontWeight:800 }}>🔍 Cine poate acoperi cerința #{cerinta.nr_ordine}</div>
            <div style={{ fontSize:12, color:G.text, marginTop:4 }}>{cerinta.text_cerinta}</div>
            <div style={{ fontSize:11, color:G.orange, marginTop:4, fontWeight:700 }}>⚠️ Sugestii brute (potrivire pe cuvinte, fără AI), nu verdict — verifică documentul înainte să alegi.</div>
            <div style={{ fontSize:10.5, color:G.dim, marginTop:2 }}>cuvinte-cheie: {cuvinte.length ? cuvinte.join(', ') : '— (niciunul; vezi „restul")'}{termenD ? ` · valabilitate față de depunere ${fmtZi(String(termen).slice(0, 10))}` : ' · fără termen de depunere: valabilitatea se judecă la azi'}</div>
            {blocat && <div style={{ fontSize:11.5, color:G.red, marginTop:4, fontWeight:700 }}>🔒 Cerința are dovadă verificată pe scan — panoul e doar de consultat, „Alege" nu scrie.</div>}
            {acoperire && !blocat && <div style={{ fontSize:11, color:G.muted, marginTop:4 }}>Acoperirea actuală ({ACOPERIRE_STATUS[acoperire.status]?.label || acoperire.status}) se înlocuiește la „Alege".</div>}
          </div>
          <button style={{ ...S.btnS, padding:'5px 10px', fontSize:12 }} onClick={onClose}>✕</button>
        </div>
        <input style={{ ...S.input, fontSize:12, padding:'6px 10px' }} placeholder="filtrează după nume / tip / beneficiar…" value={cauta} onChange={e => setCauta(e.target.value)} />
        <div style={{ overflowY:'auto', display:'flex', flexDirection:'column', gap:4, minHeight:80 }}>
          {busy || !catalog ? <div style={{ fontSize:12, color:G.muted }}>Se încarcă catalogul (autorizații, documente firmă, parteneri, experiență, recomandări)…</div> : (
            <>
              {!cuScor.length && <div style={{ fontSize:12, color:G.dim }}>Niciun candidat cu cuvinte comune. Caută mai jos în „restul" sau folosește filtrul.</div>}
              {Object.keys(SURSE_CAND).map(k => {
                const grup = cuScor.filter(x => x.sursa === k)
                if (!grup.length) return null
                return (
                  <div key={k}>
                    <div style={{ fontSize:11, fontWeight:800, color:SURSE_CAND[k].color, margin:'6px 0 3px' }}>{SURSE_CAND[k].icon} {SURSE_CAND[k].label} ({grup.length})</div>
                    <div style={{ display:'flex', flexDirection:'column', gap:3 }}>{grup.map(cand => <Rand key={k + cand.id} cand={cand} />)}</div>
                  </div>
                )
              })}
              <details style={{ marginTop:8 }}>
                <summary style={{ fontSize:11.5, color:G.muted, cursor:'pointer', fontWeight:700 }}>restul catalogului — fără cuvinte comune ({restul.length})</summary>
                <div style={{ display:'flex', flexDirection:'column', gap:3, marginTop:4 }}>{restul.map(cand => <Rand key={cand.sursa + cand.id} cand={cand} />)}</div>
              </details>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// MODAL: DETALII + ACȚIUNI (pipeline + decizia GO/NO-GO)
// ════════════════════════════════════════════════════════════════
// ── „Documente noi din SEAP” (Răzvan 15.09.2026) ─────────────────────────────────────────
// Documentele apărute în SEAP DUPĂ importul inițial (aparut_ulterior=true, marcate de
// ofertare-seap-veghe v4): răspunsuri la clarificări, erate, planșe noi. Se văd separat, în
// tab-ul Clarificări, cu citire AI dedicată (edge fn ofertare-document-nou-citeste →
// analiza.citire_noi). Placeholder-ele (/neincarcat/) se pot doar semnala — fișierul se urcă
// din Documente. showToast vine din modal; fără el, mesajul rămâne inline.
const TIP_NOU = {
  raspuns_clarificare: ['🟠 răspuns clarificare', G.orange],
  erata: ['🔴 erată', G.red],
  document_nou: ['⚪ alt document', G.muted],
  altul: ['⚪ alt document', G.muted],
}
const estePlaceholderDoc = d => !d.fisier_path || String(d.fisier_path).includes('/neincarcat/')
const fmtDataScurt = d => d ? new Date(d).toLocaleString('ro-RO', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—'
function DocumenteNoiSection({ licitatie: l, showToast = null }) {
  const [docs, setDocs] = useState(null)
  const [busy, setBusy] = useState(null)      // id-ul documentului în curs de citire
  const [msg, setMsg] = useState(null)        // mesaj inline când nu avem showToast
  const [veghe, setVeghe] = useState(null)    // raportul ultimei verificări manuale
  const [verific, setVerific] = useState(false)
  const load = async () => {
    const { data } = await supabase.from('ofertare_documente_atribuire')
      .select('id, nume_original, tip, fisier_path, created_at, analiza, analiza_la, eroare')
      .eq('licitatie_id', l.id).eq('aparut_ulterior', true).order('created_at', { ascending: false })
    setDocs(data || [])
  }
  useEffect(() => { load() }, [l.id])   // eslint-disable-line react-hooks/exhaustive-deps
  const anunta = (t, tip = 'ok') => { if (showToast) showToast(t, tip); else setMsg({ t, tip }) }
  const deschide = async d => {
    const { data, error } = await supabase.storage.from('ofertare').createSignedUrl(d.fisier_path, 600)
    if (error || !data?.signedUrl) return anunta('Nu pot deschide fișierul: ' + (error?.message || 'URL lipsă'), 'err')
    window.open(data.signedUrl, '_blank')
  }
  const citeste = async d => {
    setBusy(d.id); setMsg(null)
    const { data, error } = await supabase.functions.invoke('ofertare-document-nou-citeste', { body: { document_id: d.id } })
    setBusy(null)
    if (error || data?.error) return anunta('Citirea a eșuat: ' + (data?.error || error?.message), 'err')
    anunta(`🤖 Citit: ${d.nume_original}`)
    load()
  }
  // Verificare la cerere. Pana acum veghea rula DOAR din cron (2x/zi), deci cand
  // autoritatea publica un raspuns dimineata, el aparea abia la pranz - si nu aveai
  // cum sa afli daca lipseste ceva sau doar n-a rulat inca.
  const verificaAcum = async () => {
    setVerific(true); setMsg(null); setVeghe(null)
    const { data, error } = await supabase.functions.invoke('ofertare-seap-veghe', { body: { licitatie_id: l.id } })
    setVerific(false)
    if (error || data?.error) return anunta('Verificarea a eșuat: ' + (data?.error || error?.message), 'err')
    const r = Array.isArray(data?.raport) ? data.raport.find(x => x.licitatie === l.nr_anunt) || data.raport[0] : data
    setVeghe(r || { info: 'SEAP nu a întors nimic pentru anunțul ăsta.' })
    const noi = (r?.adusi?.length || 0) + (r?.raspunsuri_aduse?.length || 0)
    anunta(noi ? `📂 ${noi} document(e) noi aduse din SEAP` : 'Nimic nou în SEAP acum.')
    load()
  }

  const badgeTip = d => {
    const t = d.analiza?.citire_noi?.tip || d.tip
    const [lbl, col] = TIP_NOU[t] || TIP_NOU.altul
    return <span style={{ fontSize:11, fontWeight:800, color:col, border:`1px solid ${col}55`, borderRadius:6, padding:'1px 7px', whiteSpace:'nowrap' }}>{lbl}</span>
  }
  return (
    <div style={{ ...S.card, padding:16, background:G.surface, marginBottom:14 }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10, flexWrap:'wrap' }}>
        <div style={{ fontWeight:800, fontSize:14 }}>📂 Documente noi din SEAP ({docs?.length ?? '…'})</div>
        <span style={{ fontSize:11.5, color:G.dim }}>apărute după importul inițial — răspunsuri, erate, planșe noi</span>
        <button style={{ ...S.btnS, marginLeft:'auto', padding:'4px 11px', fontSize:12, color:G.ofertare, borderColor:G.ofertare+'66', cursor: verific ? 'default' : 'pointer', opacity: verific ? .6 : 1 }}
          disabled={verific} onClick={verificaAcum}
          title="Întreabă SEAP acum dacă a apărut ceva nou pe anunțul ăsta. Altfel verificarea automată rulează de două ori pe zi.">
          {verific ? '⏳ verific SEAP…' : '🔄 Verifică SEAP acum'}
        </button>
      </div>
      {veghe && (
        <div style={{ marginBottom:10, padding:'9px 11px', background:G.bg, borderRadius:9, border:`1px solid ${G.border2}`, fontSize:12 }}>
          <div style={{ fontWeight:700, marginBottom:4 }}>Ce a răspuns SEAP</div>
          {veghe.eroare && <div style={{ color:G.red, marginBottom:4 }}>⚠ {veghe.eroare}</div>}
          {veghe.info && <div style={{ color:G.muted, marginBottom:4 }}>{veghe.info}</div>}
          <pre style={{ margin:0, whiteSpace:'pre-wrap', wordBreak:'break-word', color:G.muted, fontSize:11.5, maxHeight:220, overflow:'auto' }}>
            {JSON.stringify(veghe, null, 2)}
          </pre>
        </div>
      )}
      {msg && <div style={{ fontSize:12.5, color: msg.tip === 'err' ? G.red : G.green, marginBottom:8 }}>{msg.t}</div>}
      {docs === null ? <div style={{ color:G.muted, fontSize:13 }}>Se încarcă…</div>
        : !docs.length ? <div style={{ color:G.dim, fontSize:13 }}>Nimic nou apărut în SEAP după importul inițial.</div>
        : docs.map(d => {
          const ph = estePlaceholderDoc(d)
          const c = d.analiza?.citire_noi
          return (
            <div key={d.id} style={{ padding:'11px 13px', borderRadius:11, marginBottom:8, background:'#1C2430', borderLeft:`3px solid ${(TIP_NOU[c?.tip || d.tip] || TIP_NOU.altul)[1]}` }}>
              <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
                <div style={{ flex:1, minWidth:180, fontSize:13.5, fontWeight:600, wordBreak:'break-word' }}>{d.nume_original}</div>
                {badgeTip(d)}
                <span style={{ fontSize:11.5, color:G.dim, whiteSpace:'nowrap' }} title="data apariției în platformă">📅 {fmtDataScurt(d.created_at)}</span>
              </div>
              <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', marginTop:7 }}>
                {ph
                  ? <span style={{ fontSize:11.5, color:G.yellow }} title={d.eroare || ''}>⚠ neadus automat — urcă-l din Documente</span>
                  : <button style={{ ...S.btnS, padding:'3px 9px', fontSize:11.5 }} onClick={() => deschide(d)}>📎 deschide</button>}
                <button style={{ ...S.btnS, padding:'3px 9px', fontSize:11.5, color: ph ? G.dim : G.ofertare, borderColor: ph ? G.border2 : G.ofertare + '66', opacity: ph ? .5 : 1, cursor: ph || busy ? 'default' : 'pointer' }}
                  disabled={ph || !!busy} onClick={() => citeste(d)} title={ph ? 'Fișierul nu e în platformă — urcă-l întâi din Documente' : c ? 'Recitește documentul cu AI (Sonnet)' : 'Citește documentul cu AI (Sonnet): tip, rezumat, modificări, întrebări răspunse'}>
                  {busy === d.id ? '⏳ citesc…' : c ? '🤖 recitește' : '🤖 Citește cu AI'}
                </button>
                {c?.citit_la && <span style={{ fontSize:11, color:G.green }}>✓ citit {fmtDataScurt(c.citit_la)}</span>}
                {c?.termen_nou && <span style={{ fontSize:11.5, fontWeight:800, color:G.red }}>⏰ termen nou: {fmtZi(c.termen_nou)}</span>}
              </div>
              {c && (
                <div style={{ marginTop:8, padding:'8px 10px', background:G.surface, borderRadius:8, borderLeft:`2px solid ${G.green}`, fontSize:12.5 }}>
                  <div style={{ whiteSpace:'pre-wrap', color:G.text }}>{c.rezumat || '(fără rezumat)'}</div>
                  {Array.isArray(c.modificari) && c.modificari.length > 0 && (
                    <details style={{ marginTop:6 }}>
                      <summary style={{ cursor:'pointer', fontWeight:700, color:G.orange }}>✏️ Modificări ({c.modificari.length})</summary>
                      <ul style={{ margin:'6px 0 0', paddingLeft:18 }}>
                        {c.modificari.map((m, i) => <li key={i} style={{ marginBottom:4 }}><b>{m.ce_se_schimba}</b>{m.unde ? <span style={{ color:G.muted }}> — {m.unde}</span> : null}{m.impact_oferta ? <div style={{ color:G.yellow, fontSize:12 }}>↳ {m.impact_oferta}</div> : null}</li>)}
                      </ul>
                    </details>
                  )}
                  {Array.isArray(c.intrebari_raspunse) && c.intrebari_raspunse.length > 0 && (
                    <details style={{ marginTop:6 }}>
                      <summary style={{ cursor:'pointer', fontWeight:700, color:G.blue }}>❓ Întrebări răspunse ({c.intrebari_raspunse.length})</summary>
                      <ul style={{ margin:'6px 0 0', paddingLeft:18 }}>
                        {c.intrebari_raspunse.map((q, i) => <li key={i} style={{ marginBottom:4 }}><span style={{ color:G.muted }}>Î:</span> {q.intrebare_scurt}<div style={{ color:G.green, fontSize:12 }}>R: {q.raspuns_scurt}</div></li>)}
                      </ul>
                    </details>
                  )}
                </div>
              )}
            </div>)
        })}
    </div>
  )
}

function LicitatieDetailModal({ licitatie: l, profile, echipa = [], onChanged, onClose, onEdit, onStatus, onDecide, onDelete, onGoCantitati, onGoPropunere, onGoClarificari,
  intrareDocument = null, onIntrareConsumata = null, showToast = null }) {
  // Redesign #40 (macheta redesign_fisa, GO Răzvan 07.09.2026): antet + KPI + tab-uri + „Pe scurt” în lateral.
  // Secțiunile E1–E3 și verificarea finală rămân componentele existente, doar montate pe tab-uri.
  const [motivare, setMotivare] = useState(l.decizie_motivare || '')
  const [regim, setRegim] = useState(l.regim_achizitie || '')
  const [resp, setResp] = useState(l.responsabil_id || '')
  // Intrarea din Clarificări deschide fișa direct pe Documente; altfel, tabul obișnuit.
  // Etapa 0 (14.09.2026): fără registru generat, fișa se deschide pe ⚡ Triere — decizia vine din fișa de date, nu din 40 de documente citite
  const [tab, setTab] = useState(() => (intrareDocument ? 'documente' : (l._st?.cerinte || l.nr_cerinte) ? 'cerinte' : 'triere'))   // triere | cerinte | documente | clarificari | detalii | verificari
  // Dacă omul pleacă de pe Documente înainte să apuce bifarea, intenția nu mai are ce căuta:
  // altfel s-ar declanșa mai târziu, peste altceva.
  useEffect(() => {
    if (tab !== 'documente' && intrareDocument && onIntrareConsumata) onIntrareConsumata(intrareDocument.id)
  }, [tab, intrareDocument, onIntrareConsumata])
  // Bifele din registrul de cerințe stau aici, nu în secțiune, ca aceeași selecție să se
  // vadă și în „Acoperirea cerințelor" — altfel omul bifa sus și căuta manual, jos, același
  // număr de ordine. Se golește când schimbi licitația.
  const [selCerinte, setSelCerinte] = useState([])
  useEffect(() => { setSelCerinte([]) }, [l.id])
  const [clar, setClar] = useState(null)
  // Răzvan 07.09 (varianta C): mail „Etapa 1” către echipa Ofertare — previzualizare → confirmare → trimitere (edge fn ofertare-etapa1-mail)
  // #77 (15.09): lista de sarcini din mail se construiește în edge fn (stare() + htmlEtapa1) cu ACELEAȘI rânduri și aceeași ordine
  //   ca secțiunea „Cerințe & acoperire” filtrată „de rezolvat” (tip → nr_ordine, #nr_ordine pe rând); r.sarcini = rândurile listate.
  const [ultimMail, setUltimMail] = useState(null)
  const [etapa1Busy, setEtapa1Busy] = useState(false)
  useEffect(() => { supabase.from('ofertare_mailuri').select('id, tip, trimis_la, destinatari').eq('licitatie_id', l.id).eq('tip', 'etapa1').order('id', { ascending: false }).limit(1).maybeSingle().then(({ data }) => setUltimMail(data || null)) }, [l.id])
  const trimiteEtapa1 = async () => {
    setEtapa1Busy(true)
    const { data: pv, error } = await supabase.functions.invoke('ofertare-etapa1-mail', { body: { actiune: 'previzualizare', licitatie_id: l.id } })
    if (error || pv?.error) { setEtapa1Busy(false); return alert('Nu pot pregăti mailul: ' + (pv?.error || error?.message)) }
    const r = pv.rezumat
    const ok = window.confirm(`Trimit „Etapa 1” pentru ${l.nr_anunt} către ${pv.destinatari.length} colegi (responsabil: ${r.responsabil || 'NESETAT — sarcinile merg la toată echipa'}):\n\n` +
      `• documente: ${r.docs.procesate}/${r.docs.pdf} PDF citite${r.docs.in_lucru ? ` (${r.docs.in_lucru} încă neprocesate!)` : ''}\n• registru: ${r.cerinte.total} cerințe (${r.cerinte.eliminatorii} eliminatorii, ${r.cerinte.neconfirmate} neconfirmate)\n` +
      `• acoperire: ${r.acoperire.acoperite + r.acoperire.partener} acoperite, ${r.acoperire.goluri} goluri, ${r.acoperire.rosii} roșii, ${r.acoperire.reemis} de reemis\n• sarcini nominale în mail: ${r.sarcini}${r.neevaluate ? ` (+${r.neevaluate} cerințe neevaluate — rulează întâi „Propune acoperire” dacă vrei să intre)` : ''}\n\n` +
      (ultimMail ? `⚠️ A mai fost trimis pe ${new Date(ultimMail.trimis_la).toLocaleDateString('ro-RO')}. Retrimit?` : 'Continui?'))
    if (!ok) { setEtapa1Busy(false); return }
    const { data, error: e2 } = await supabase.functions.invoke('ofertare-etapa1-mail', { body: { actiune: 'etapa1', licitatie_id: l.id } })
    setEtapa1Busy(false)
    if (e2 || data?.error) return alert('Mailul nu a plecat: ' + (data?.error || e2?.message))
    setUltimMail({ trimis_la: new Date().toISOString(), destinatari: [...(data.to || []), ...(data.cc || [])] })
    alert(`✓ Etapa 1 trimisă: ${data.to.join(', ')}${data.cc?.length ? ` (+${data.cc.length} în CC)` : ''} — ${data.sarcini} sarcini.`)
  }
  const [ptSt, setPtSt] = useState(null)
  // Starea propunerii tehnice: un rand per licitatie, mereu (si pentru cele fara nicio cerinta).
  // Nu intra showToast/load in deps — lectia casei cu loop-ul infinit.
  useEffect(() => {
    supabase.from('v_ofertare_pt_stare').select('*').eq('licitatie_id', l.id).maybeSingle()
      .then(({ data }) => setPtSt(data || null))
  }, [l.id])
  const st = LICITATIE_STATUS[l.status] || LICITATIE_STATUS.identificata
  const next = TRANZITII[l.status] || []
  const sx = l._st || {}
  const zile = l.zile_ramase
  const cZile = zile == null ? G.muted : zile <= 3 ? G.red : zile <= 7 ? G.orange : zile <= 21 ? G.yellow : G.green
  const pct = sx.cerinte ? Math.round(100 * sx.acoperite / sx.cerinte) : 0
  const VC = { verde: ['🟢 VERDE — depunere sigură', G.green], galben: ['🟡 GALBEN — de rezolvat înainte de depunere', G.yellow], rosu: ['🔴 ROȘU — NU se depune', G.red] }
  const [vLbl, vCol] = VC[sx.verdict] || ['— verificare nerulată', G.dim]
  const fmtMil = v => v == null ? '—' : v >= 1e6 ? `${(v / 1e6).toLocaleString('ro-RO', { maximumFractionDigits: 2 })}` : new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 0 }).format(v)

  useEffect(() => {
    if (tab !== 'clarificari') return
    supabase.from('ofertare_clarificari').select('id, nr, intrebare, status, origine, citita_la, raspuns').eq('licitatie_id', l.id).order('nr')
      .then(({ data }) => setClar(data || []))
  }, [tab, l.id])

  const KPI = ({ l: lbl, v, unit, color }) => (
    <div style={{ background:G.surface, border:`1px solid ${G.border}`, borderRadius:14, padding:'14px 16px', minWidth:0 }}>
      <div style={{ fontSize:11, color:G.dim, textTransform:'uppercase', letterSpacing:.5, fontWeight:700, marginBottom:5 }}>{lbl}</div>
      <div style={{ fontSize: String(v ?? '').length > 9 ? 15 : 21, fontWeight:800, color: color || G.text, lineHeight:1.25, wordBreak:'break-word' }}>{v}{unit && <span style={{ fontSize:12.5, color:G.dim, marginLeft:5, fontWeight:600 }}>{unit}</span>}</div>
    </div>
  )
  const Row = ({ k, v, last }) => (
    <div style={{ display:'flex', justifyContent:'space-between', gap:12, padding:'9px 0', borderBottom: last ? 'none' : `1px solid ${G.border}`, fontSize:13.5 }}>
      <span style={{ color:G.muted, whiteSpace:'nowrap' }}>{k}</span><span style={{ textAlign:'right', wordBreak:'break-word' }}>{v || '—'}</span>
    </div>
  )
  const TABS = [
    ['triere', '⚡ Triere'],
    ['cerinte', `📋 Cerințe & acoperire${sx.cerinte ? ` (${sx.acoperite || 0}/${sx.cerinte})` : ''}`],
    ['perechi', '🔗 Cerință ↔ dovadă'],
    ['propunere', `📑 Propunere tehnică${ptSt ? ` (${ptSt.cu_capitol}/${ptSt.de_raspuns})` : ''}`],
    ['documente', `📥 Documentație (${l.nr_documente ?? 0})`],
    ['clarificari', `❓ Clarificări (${sx.clarificari || 0})`],
    ['garantie', `🛡 Garanție${l.garantie_status === 'original' ? ' · ✓' : l.garantie_status ? ' · în curs' : ''}`],
    ['detalii', '📝 Detalii & decizie'],
    ['verificari', `🔍 Verificări${sx.verdict ? ` · ${sx.verdict.toUpperCase()}` : ''}`],
  ]
  const CL_ST = { de_trimis: ['📝 de trimis', G.orange], trimisa: ['📮 trimisă', G.blue], raspunsa: ['✅ răspunsă', G.green] }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.75)', zIndex:1000, display:'flex', alignItems:'flex-start', justifyContent:'center', overflowY:'auto', padding:'22px 14px' }} onClick={onClose}>
      <div style={{ ...S.card, width:'min(1180px,100%)', padding:'22px 26px', borderRadius:16 }} onClick={e => e.stopPropagation()}>
        {/* antet */}
        <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
          <div style={{ fontSize:22, fontWeight:800, letterSpacing:-.3 }}>🏛 {l.nr_anunt}</div>
          <span style={{ background: st.color + '22', color: st.color, borderRadius:999, padding:'5px 15px', fontSize:12.5, fontWeight:800 }}>{st.icon} {st.label}</span>
          {l.decizie_go && <span style={{ background: l.decizie_go === 'go' ? '#12261a' : '#2b1517', color: l.decizie_go === 'go' ? G.green : G.red, borderRadius:999, padding:'5px 15px', fontSize:12.5, fontWeight:800 }}>decizie: {l.decizie_go === 'go' ? 'GO' : 'NO-GO'}</span>}
          <div style={{ marginLeft:'auto', display:'flex', gap:8, flexWrap:'wrap' }}>
            <button style={{ ...S.btnS, borderRadius:10 }} onClick={() => setTab('documente')}>⬇️ Adu din SEAP</button>
            <button style={{ ...S.btnS, borderRadius:10 }} onClick={() => setTab('clarificari')}>❓ Clarificări</button>
            <button style={{ ...S.btnS, borderRadius:10, color:G.ofertare, borderColor:G.ofertare + '66' }} disabled={!!etapa1Busy} onClick={trimiteEtapa1}
              title={ultimMail ? `Ultimul mail Etapa 1: ${new Date(ultimMail.trimis_la).toLocaleString('ro-RO', { dateStyle:'short', timeStyle:'short' })} → ${(ultimMail.destinatari || []).length} colegi` : 'Rezumatul Etapei 1 + sarcinile nominale, pe mail către echipa Ofertare (responsabilul în TO)'}>
              {etapa1Busy ? '⏳ …' : `📧 Etapa 1 → echipă${ultimMail ? ' ✓' : ''}`}</button>
            <button style={{ ...S.btnP, borderRadius:10, background:G.green }} onClick={() => setTab('verificari')}>🔍 Verificare finală</button>
            <button onClick={onClose} style={{ background:'transparent', border:'none', color:G.muted, fontSize:22, cursor:'pointer', padding:'0 4px' }}>✕</button>
          </div>
        </div>
        <div style={{ fontSize:15, color:G.muted, margin:'6px 0 18px', maxWidth:900 }}>{l.obiect}</div>
        <div style={{ margin:'-10px 0 12px' }}><CostAI licitatieId={l.id} /></div>

        {/* KPI */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(175px, 1fr))', gap:12, marginBottom:18 }}>
          <KPI l="Valoare estimată" v={fmtMil(l.valoare_estimata)} unit={l.valoare_estimata >= 1e6 ? `mil ${l.moneda || 'lei'}` : (l.moneda || 'lei')} />
          <KPI l="Termen depunere" v={zile == null ? (l.termen_depunere ? fmtTermen(l.termen_depunere).slice(0, 10) : '—') : zile === 0 ? 'AZI' : zile} unit={zile != null ? (zile === 1 ? 'zi' : 'zile') : ''} color={cZile} />
          <KPI l="Cerințe acoperite" v={sx.cerinte ? `${sx.acoperite || 0}` : '—'} unit={sx.cerinte ? `/${sx.cerinte}` : 'registru negenerat'} color={sx.cerinte && sx.acoperite >= sx.cerinte ? G.green : G.text} />
          <KPI l="Eliminatorii fără dovadă (goluri + neevaluate)" v={l.eliminatorii_neacoperite ?? 0} color={l.eliminatorii_neacoperite > 0 ? G.red : G.green} />
          <KPI l="Dovezi roșii" v={sx.rosii || 0} color={sx.rosii > 0 ? G.red : G.text} />
          {sx.reverif > 0 && <KPI l="Dovezi de reverificat (cerința s-a schimbat)" v={sx.reverif} color={G.orange} />}
          {/* roșu până când polița/SGB e în original în platformă (garantie_status = 'original' — fluxul complet vine cu tabelul ofertare_garantii) */}
          <div onClick={() => setTab('garantie')} style={{ cursor:'pointer', display:'contents' }} title="Deschide fluxul garanției (cerere poliță → plată → original)">
            <KPI l="Garanție participare" v={l.garantie_participare || '—'} unit={l.garantie_status === 'original' ? '✓ original' : l.garantie_status ? 'în curs' : ''} color={l.garantie_status === 'original' ? G.green : l.garantie_participare ? G.red : G.text} />
          </div>
        </div>

        {/* tab-uri */}
        <div style={{ display:'flex', gap:4, borderBottom:`1px solid ${G.border2}`, marginBottom:18, overflowX:'auto' }}>
          {TABS.map(([k, lbl]) => (
            <button key={k} onClick={() => setTab(k)} style={{ padding:'10px 16px', fontSize:13.5, fontWeight:700, whiteSpace:'nowrap', background:'none', border:'none', cursor:'pointer',
              color: tab === k ? G.ofertare : G.muted, borderBottom:`2.5px solid ${tab === k ? G.ofertare : 'transparent'}`, marginBottom:-1 }}>{lbl}</button>
          ))}
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'minmax(0, 2fr) minmax(260px, 1fr)', gap:18 }}>
          <div style={{ minWidth:0 }}>
            {tab === 'cerinte' && <>
              <CerinteSection licitatie={l} profile={profile} sel={selCerinte} setSel={setSelCerinte} />
              <InventarIndependentSection licitatie={l} profile={profile} />
              <AcoperireSection licitatie={l} profile={profile} sel={selCerinte} />
            </>}
            {/* Pasul 1 din reproiectare: aceleași date, dar cerința și dovada pe același rând, cu
                proveniența pe ambele părți. Stă ca tab separat cât se compară cu vederea veche. */}
            {tab === 'perechi' && <CerinteAcoperirePerechi licitatie={l} />}
            {tab === 'triere' && <OfertareTriere licitatie={l} profile={profile} showToast={showToast} onChanged={onChanged} onProceseaza={() => setTab('documente')} />}
            {tab === 'documente' && <DocumenteSection licitatie={l} profile={profile} onChanged={onChanged}
              intrareDocument={intrareDocument} onIntrareConsumata={onIntrareConsumata} showToast={showToast} />}
            {tab === 'garantie' && <>
              <GarantieSection licitatie={l} profile={profile} onChanged={onChanged} />
              {/* GBE (garanția de bună execuție) — aceeași evidență ca în Administrativ → Contracte comerciale (09.09.2026) */}
              <GbeLicitatie licitatie={l} profile={profile} accent={G.ofertare} onChanged={onChanged} />
            </>}
            {tab === 'propunere' && <PropunereRezumat st={ptSt} onDeschide={() => { onClose(); onGoPropunere?.() }} />}

            {tab === 'verificari' && <VerificareFinalaSection licitatie={l} />}
            {tab === 'clarificari' && <DocumenteNoiSection licitatie={l} showToast={showToast} />}
            {tab === 'clarificari' && (
              <div style={{ ...S.card, padding:16, background:G.surface }}>
                <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10, flexWrap:'wrap' }}>
                  <div style={{ fontWeight:800, fontSize:14 }}>❓ Clarificări către autoritate ({clar?.length ?? '…'})</div>
                  <button style={{ ...S.btnP, marginLeft:'auto', padding:'6px 13px', fontSize:12 }} onClick={() => { onClose(); onGoClarificari?.() }}>✏️ Editează / adaugă în ❓ Clarificări</button>
                </div>
                {clar === null ? <div style={{ color:G.muted, fontSize:13 }}>Se încarcă…</div>
                  : !clar.length ? <div style={{ color:G.dim, fontSize:13 }}>Nicio clarificare. Se generează din diferențele de cantități sau se adaugă manual în ❓ Clarificări.</div>
                  : clar.map(q => { const [lbl, col] = CL_ST[q.status] || CL_ST.de_trimis; return (
                    <div key={q.id} style={{ display:'flex', gap:12, padding:'11px 13px', borderRadius:11, marginBottom:8, background:'#1C2430', borderLeft:`3px solid ${col}`, alignItems:'flex-start' }}>
                      <span style={{ fontWeight:800, color:G.muted }}>{q.nr}.</span>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:13.5, whiteSpace:'pre-wrap' }}>{q.intrebare}</div>
                        <div style={{ fontSize:11.5, color:G.dim, marginTop:4 }}>{q.origine === 'manual' ? '👤 încărcată manual' : '🤖 generată de platformă'}{q.origine === 'manual' && (q.citita_la ? ' · ✓ citită de platformă' : ' · ⚠ necitită')}</div>
                        {q.raspuns && <div style={{ fontSize:12.5, color:G.green, marginTop:6, whiteSpace:'pre-wrap' }}>↳ {q.raspuns}</div>}
                      </div>
                      <span style={{ fontSize:11.5, fontWeight:800, color:col, whiteSpace:'nowrap' }}>{lbl}</span>
                    </div>) })}
              </div>
            )}
            {tab === 'detalii' && (
              <div style={{ ...S.card, padding:16, background:G.surface }}>
                <Row k="Link SEAP" v={l.link_seap ? <a href={l.link_seap} target="_blank" rel="noreferrer" style={{ color:G.blue }}>{l.link_seap}</a> : null} />
                <Row k="Identificatori SEAP" v={l.c_notice_id ? `${l.c_notice_id} / tip ${l.sys_notice_type_id}` : <span style={{ color:G.orange }}>lipsă — se completează din link la „Adu din SEAP”</span>} />
                <Row k="Folder NAS" v={l.nas_path} />
                <Row k="Grafic de execuție" v={<a href={`/grafic/licitatie/${l.id}`} style={{ color:G.blue }}>📅 Poarta grafic + Gantt (drum critic, MS Project, F9)</a>} />
                <Row k="Termen depunere" v={l.termen_depunere ? fmtTermen(l.termen_depunere) : null} />
                <Row k="Loturi" v={Array.isArray(l.loturi) && l.loturi.length ? `${l.loturi.length}` : null} />
                <Row k="Motivare decizie" v={l.decizie_motivare} />
                <Row k="Observații" v={l.observatii} last />

                {l.status === 'analiza' && profile?.is_owner && (
                  <div style={{ marginTop:16, padding:14, borderRadius:10, border:`1px solid ${G.teal}55`, background:G.teal + '0D' }}>
                    <div style={{ fontSize:13, fontWeight:800, marginBottom:8 }}>⚡ Decizia GO / NO-GO</div>
                    <input style={{ ...S.input, marginBottom:10 }} placeholder="Motivare (se păstrează — obligatorie la NO-GO)" value={motivare} onChange={e => setMotivare(e.target.value)} />
                    <div style={{ display:'flex', gap:10 }}>
                      <button style={{ ...S.btnP, background:G.teal }} onClick={() => onDecide(l, 'go', motivare)}>🟢 GO — intrăm</button>
                      <button style={{ ...S.btnS, color:G.red, borderColor:G.red + '66', opacity: motivare.trim() ? 1 : .5 }} disabled={!motivare.trim()} onClick={() => onDecide(l, 'no_go', motivare)}>⛔ NO-GO — abandonăm</button>
                    </div>
                  </div>
                )}
                <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:16, flexWrap:'wrap' }}>
                  {profile?.is_owner && <button style={{ ...S.btnS, color:G.red, borderColor:G.red + '66' }} onClick={() => onDelete(l)}>🗑 Șterge</button>}
                  <button style={S.btnS} onClick={onEdit}>✏️ Editează</button>
                  {next.map(s2 => (
                    <button key={s2} style={{ ...S.btnS, color:LICITATIE_STATUS[s2].color, borderColor:LICITATIE_STATUS[s2].color + '66', fontWeight:700 }} onClick={() => onStatus(l, s2)}>{LICITATIE_STATUS[s2].icon} Marchează {LICITATIE_STATUS[s2].label}</button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Pe scurt */}
          <div>
            <div style={{ ...S.card, padding:'16px 18px', background:G.surface, borderRadius:14 }}>
              <div style={{ fontSize:14, fontWeight:800, marginBottom:8 }}>⚡ Pe scurt</div>
              <Row k="Autoritate" v={l.autoritate} />
              <Row k="Responsabil" v={
                <select style={{ ...S.input, width:'auto', fontSize:12, padding:'3px 8px', color: resp ? G.text : G.orange }} value={resp} title="Colegul care are licitația în lucru — primește sarcinile nominal"
                  onChange={async e => { const v = e.target.value; setResp(v); await supabase.from('ofertare_licitatii').update({ responsabil_id: v || null, updated_at: new Date().toISOString() }).eq('id', l.id); onChanged && onChanged() }}>
                  <option value="">— fără responsabil —</option>
                  {echipa.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>} />
              <Row k="Regim" v={
                <select style={{ ...S.input, width:'auto', fontSize:12, padding:'3px 8px' }} value={regim} title="legea citată în fișa de date primează asupra tipului autorității"
                  onChange={async e => { const v = e.target.value; setRegim(v); await supabase.from('ofertare_licitatii').update({ regim_achizitie: v || null, updated_at: new Date().toISOString() }).eq('id', l.id) }}>
                  <option value="">— nestabilit —</option>
                  <option value="sectorial">⚡ sectorial (L99/2016)</option>
                  <option value="clasic">🏛 clasic (L98/2016)</option>
                </select>} />
              <Row k="Procedură" v={l.canal ? l.canal.replace('seap_', 'SEAP ').toUpperCase() : l.tip_procedura} />
              <Row k="Criteriu" v={l.criteriu} />
              <Row k="Rol Gazpet" v={l.rol_gazpet} />
              <Row k="Segment" v={l.segment && SEGMENTE[l.segment] ? SEGMENTE[l.segment].label : l.segment} last />
              <div style={{ marginTop:14, fontSize:12.5, color:G.muted }}>Acoperire cerințe</div>
              <div style={{ height:10, borderRadius:6, background:G.border, overflow:'hidden', margin:'8px 0 4px' }}><i style={{ display:'block', height:'100%', width:`${pct}%`, background:'linear-gradient(90deg,#D29922,#3FB950)' }} /></div>
              <div style={{ fontSize:12, color:G.dim }}>{sx.acoperite || 0} acoperite · {Math.max((sx.cerinte || 0) - (sx.acoperite || 0), 0)} rămase · {sx.rosii || 0} dovezi roșii{sx.reverif > 0 ? <span style={{ color:G.orange }}> · {sx.reverif} de reverificat</span> : ''}</div>
              <div style={{ display:'flex', alignItems:'center', gap:10, background:'#221c0d', border:`1px solid ${vCol}55`, borderRadius:12, padding:'12px 14px', marginTop:14, cursor:'pointer' }} onClick={() => setTab('verificari')}>
                <div><b style={{ color:vCol, fontSize:13.5 }}>{vLbl}</b>{sx.verdict_la && <div style={{ fontSize:12, color:G.muted }}>rulată {new Date(sx.verdict_la).toLocaleString('ro-RO', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}</div>}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// CATALOG EXPERIENȚĂ SIMILARĂ (ofertare_experienta)
// Sursa: Calificare/EXPERIENTA SIMILARA rev.1/ de pe NAS — un dosar pe lucrare
// (fișă, contract, PV recepție, DC, recomandare). Convenția valorilor: numărul
// din numele folderului = mii lei (excepția Bentu = lei, notată în observații).
// Fereastra de invocare (uzual 5 ani din termenul de depunere — Instrucțiunea
// ANAP 2/2017 art. 13) se calculează aici; combinația bifată se verifică pe
// prag valoric + număr maxim de contracte. La lucrările în ASOCIERE se invocă
// doar cota Gazpet — se verifică în fișa lucrării înainte de depunere.
// ════════════════════════════════════════════════════════════════
const TIP_PV_OPT = ['PVRTL', 'PV final', 'PV partial', 'PV PIF', 'PV']
const fmtLei = v => (v || v === 0) ? new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 2 }).format(v) : '—'
const fmtZi = d => d ? new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('ro-RO') : '—'

function ExperientaCatalog({ licitatii, profile, showToast }) {
  const [lucrari, setLucrari] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [editRow, setEditRow] = useState(null)
  const [termenRef, setTermenRef] = useState(() => new Date().toISOString().slice(0, 10))
  const [aniFereastra, setAniFereastra] = useState('5')
  const [prag, setPrag] = useState('29000000')
  const [maxCtr, setMaxCtr] = useState('3')
  const [sel, setSel] = useState(() => new Set())
  const [arataInactive, setArataInactive] = useState(false)
  // Regula valorii invocate (practica beneficiarilor): la Transgaz/Romgaz/Conpet se ia
  // valoarea TOTALĂ a contractului; la distribuții (primării) valoarea EXECUTATĂ real.
  const [regulaVal, setRegulaVal] = useState('totala')   // totala | executata
  const valInv = (l) => regulaVal === 'executata' ? (Number(l.valoare_executata_lei) || Number(l.valoare_lei) || 0) : (Number(l.valoare_lei) || 0)

  const load = async () => {
    const { data, error } = await supabase.from('ofertare_experienta').select('*')
    if (error) { showToast('Eroare la încărcarea catalogului: ' + error.message, 'err'); return }
    setLucrari(data || [])
  }
  useEffect(() => { load() }, [])

  const inceput = (() => { const d = new Date(termenRef + 'T00:00:00'); d.setFullYear(d.getFullYear() - (Number(aniFereastra) || 5)); return d })()
  const inFereastra = (l) => !!l.data_pv && new Date(l.data_pv + 'T12:00:00') >= inceput && new Date(l.data_pv + 'T00:00:00') <= new Date(termenRef + 'T23:59:59')

  const vizibile = (lucrari || []).filter(l => arataInactive || l.activ)
  // Ordinea: în fereastră (valoare desc) → ieșite din fereastră → fără dată PV
  const ordonate = [...vizibile].sort((a, b) => {
    const g = l => l.data_pv ? (inFereastra(l) ? 0 : 1) : 2
    return g(a) - g(b) || valInv(b) - valInv(a)
  })
  const nrFereastra = vizibile.filter(inFereastra).length

  const toggleSel = (id) => setSel(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const selectate = vizibile.filter(l => sel.has(l.id))
  const totalSel = selectate.reduce((s, l) => s + valInv(l), 0)
  const pragN = Number(prag) || 0
  const maxN = Number(maxCtr) || 3
  const selOK = selectate.length > 0 && selectate.length <= maxN && totalSel >= pragN
  const selAsocieri = selectate.filter(l => l.asociere)
  const selPartiale = selectate.filter(l => (l.tip_pv || '').toLowerCase().includes('partial'))
  // la regula "executată", asocierile fără cota Gazpet completată intră cu valoarea totală — pericol la evaluare
  const selFaraCota = regulaVal === 'executata' ? selectate.filter(l => l.asociere && !l.valoare_executata_lei) : []

  const salveaza = async (form) => {
    const payload = {
      denumire: form.denumire.trim(),
      beneficiar: form.beneficiar.trim() || null,
      valoare_lei: form.valoare_lei !== '' ? Number(form.valoare_lei) : null,
      valoare_executata_lei: form.valoare_executata_lei !== '' ? Number(form.valoare_executata_lei) : null,
      data_pv: form.data_pv || null,
      tip_pv: form.tip_pv || null,
      piese: form.piese.trim() || null,
      folder_nas: form.folder_nas.trim() || null,
      dosar_sursa_path: form.dosar_sursa_path.trim() || null,
      asociere: !!form.asociere,
      observatii: form.observatii.trim() || null,
      activ: !!form.activ,
      updated_at: new Date().toISOString(),
    }
    const { error } = editRow
      ? await supabase.from('ofertare_experienta').update(payload).eq('id', editRow.id)
      : await supabase.from('ofertare_experienta').insert(payload)
    if (error) { showToast('Eroare la salvare: ' + error.message, 'err'); return false }
    showToast(editRow ? 'Lucrare actualizată.' : `Lucrare adăugată — ${payload.denumire}.`)
    setShowForm(false); setEditRow(null)
    await load()
    return true
  }

  const sterge = async (l) => {
    if (!profile?.is_owner) return
    if (!window.confirm(`Ștergi „${l.denumire}" din catalog? IREVERSIBIL — de regulă e mai sigur să o faci inactivă.`)) return
    const { error } = await supabase.from('ofertare_experienta').delete().eq('id', l.id)
    if (error) { showToast('Eroare: ' + error.message, 'err'); return }
    showToast(`🗑 „${l.denumire}" ștearsă.`, 'warn')
    setShowForm(false); setEditRow(null)
    setSel(s => { const n = new Set(s); n.delete(l.id); return n })
    await load()
  }

  const cuTermen = (licitatii || []).filter(x => x.termen_depunere)

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14, flexWrap:'wrap', gap:10 }}>
        <div>
          <div style={{ fontSize:19, fontWeight:800 }}>📚 Experiență similară</div>
          <div style={{ fontSize:12, color:G.muted }}>
            Catalogul lucrărilor executate — dosarele din <b>Calificare\EXPERIENTA SIMILARA rev.1</b> de pe NAS. Bifează lucrările pe care le invoci și compară cu pragul licitației.
          </div>
        </div>
        <button style={S.btnP} onClick={() => { setEditRow(null); setShowForm(true) }}>＋ Lucrare</button>
      </div>

      {/* Fereastra de invocare + pragul licitației */}
      <div style={{ ...S.card, padding:14, marginBottom:12 }}>
        <div style={{ display:'flex', gap:12, flexWrap:'wrap', alignItems:'flex-end' }}>
          <div><label style={S.lbl}>Termen depunere (referință)</label>
            <input style={{ ...S.input, width:150 }} type="date" value={termenRef} onChange={e => e.target.value && setTermenRef(e.target.value)} /></div>
          {cuTermen.length > 0 && (
            <div><label style={S.lbl}>Preia din licitație</label>
              <select style={{ ...S.input, width:190 }} value="" onChange={e => {
                const x = cuTermen.find(y => String(y.id) === e.target.value)
                if (!x) return
                setTermenRef(x.termen_depunere.slice(0, 10))
                // regula valorii după segmentul licitației țintă
                const seg = x.segment || detectSegment(x.autoritate, x.obiect)
                setRegulaVal(['transgaz', 'romgaz', 'conpet'].includes(seg) ? 'totala' : 'executata')
              }}>
                <option value="">alege...</option>
                {cuTermen.map(x => <option key={x.id} value={x.id}>{x.nr_anunt} · {fmtZi(x.termen_depunere.slice(0, 10))}</option>)}
              </select></div>
          )}
          <div><label style={S.lbl}>Valoare invocată</label>
            <select style={{ ...S.input, width:230 }} value={regulaVal} onChange={e => setRegulaVal(e.target.value)}>
              <option value="totala">totală contract (Transgaz/Romgaz/Conpet)</option>
              <option value="executata">executată Gazpet (distribuții/primării)</option>
            </select></div>
          <div><label style={S.lbl}>Fereastră (ani)</label>
            <input style={{ ...S.input, width:70 }} type="number" min="1" max="15" value={aniFereastra} onChange={e => setAniFereastra(e.target.value)} /></div>
          <div><label style={S.lbl}>Prag valoare (lei fără TVA)</label>
            <input style={{ ...S.input, width:150 }} type="number" min="0" value={prag} onChange={e => setPrag(e.target.value)} /></div>
          <div><label style={S.lbl}>Max. contracte</label>
            <input style={{ ...S.input, width:70 }} type="number" min="1" max="10" value={maxCtr} onChange={e => setMaxCtr(e.target.value)} /></div>
          <div style={{ fontSize:12, color:G.muted, paddingBottom:9 }}>
            Fereastra: <b style={{ color:G.text }}>{fmtZi(inceput.toISOString().slice(0, 10))} → {fmtZi(termenRef)}</b> · {nrFereastra}/{vizibile.length} lucrări în fereastră
          </div>
        </div>

        {/* Combinația bifată vs. cerință */}
        {selectate.length > 0 && (
          <div style={{ marginTop:12, padding:'10px 14px', borderRadius:8, display:'flex', gap:14, alignItems:'center', flexWrap:'wrap',
            border:`1px solid ${selOK ? G.green : G.red}66`, background:(selOK ? G.green : G.red) + '11' }}>
            <span style={{ fontSize:13, fontWeight:800, color: selOK ? G.green : G.red }}>
              {selOK ? '✅' : '❌'} Selecție: {selectate.length}/{maxN} contracte · {fmtLei(totalSel)} lei
            </span>
            <span style={{ fontSize:12, color:G.muted }}>prag {fmtLei(pragN)} lei — {totalSel >= pragN ? `peste cu ${fmtLei(totalSel - pragN)}` : `lipsesc ${fmtLei(pragN - totalSel)}`}</span>
            {selectate.length > maxN && <span style={{ fontSize:12, color:G.red, fontWeight:700 }}>prea multe contracte!</span>}
            {regulaVal === 'totala' && selAsocieri.length > 0 && <span style={{ fontSize:12, color:G.muted }}>ℹ {selAsocieri.length} în asociere — la Transgaz/Romgaz/Conpet se invocă valoarea totală (practica acceptată)</span>}
            {selFaraCota.length > 0 && <span style={{ fontSize:12, color:G.red, fontWeight:700 }}>⚠ {selFaraCota.length} în asociere FĂRĂ cota executată completată — intră cu totalul, risc la evaluare!</span>}
            {regulaVal === 'executata' && selAsocieri.length > selFaraCota.length && <span style={{ fontSize:12, color:G.orange, fontWeight:700 }}>⚠ asocieri invocate cu cota Gazpet</span>}
            {selPartiale.length > 0 && <span style={{ fontSize:12, color:G.orange, fontWeight:700 }}>⚠ {selPartiale.length} cu recepție parțială</span>}
            <button style={{ ...S.btnS, padding:'4px 10px', fontSize:11, marginLeft:'auto' }} onClick={() => setSel(new Set())}>golește</button>
          </div>
        )}
      </div>

      {lucrari === null && <div style={{ padding:30, textAlign:'center', color:G.muted }}>Se încarcă catalogul...</div>}
      {lucrari !== null && !ordonate.length && (
        <div style={{ ...S.card, padding:30, textAlign:'center', color:G.dim, fontSize:13 }}>Catalogul e gol — adaugă lucrări cu „＋ Lucrare".</div>
      )}

      <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
        {ordonate.map(l => {
          const inWin = inFereastra(l)
          const faraData = !l.data_pv
          return (
            <div key={l.id} style={{ ...S.card, padding:'9px 12px', opacity: l.activ ? (inWin ? 1 : .55) : .35,
              borderLeft:`3px solid ${faraData ? G.orange : inWin ? G.green : G.border}` }}>
              <div style={{ display:'flex', alignItems:'center', gap:9, flexWrap:'wrap' }}>
                <input type="checkbox" checked={sel.has(l.id)} disabled={!inWin} onChange={() => toggleSel(l.id)}
                  title={inWin ? 'Include în combinația invocată' : 'În afara ferestrei — nu se poate invoca'} style={{ accentColor:G.green, cursor: inWin ? 'pointer' : 'not-allowed' }} />
                <span style={{ fontWeight:800, fontSize:13.5 }}>{l.denumire}</span>
                {l.beneficiar && <span style={{ fontSize:11, color:G.blue, fontWeight:700, border:`1px solid ${G.blue}44`, borderRadius:10, padding:'1px 8px', whiteSpace:'nowrap' }}>{l.beneficiar}</span>}
                {l.asociere && <span style={{ fontSize:10.5, color:G.orange, fontWeight:800, border:`1px solid ${G.orange}55`, borderRadius:10, padding:'1px 7px', whiteSpace:'nowrap' }} title="Executată în asociere — se invocă doar cota Gazpet">⚠ asociere</span>}
                {(l.tip_pv || '').toLowerCase().includes('partial') && <span style={{ fontSize:10.5, color:G.orange, fontWeight:800, whiteSpace:'nowrap' }}>recepție parțială</span>}
                {faraData && <span style={{ fontSize:10.5, color:G.orange, fontWeight:800, whiteSpace:'nowrap' }}>fără dată PV!</span>}
                {!l.activ && <span style={{ fontSize:10.5, color:G.dim, fontWeight:800 }}>inactivă</span>}
                <span style={{ marginLeft:'auto', display:'flex', gap:10, alignItems:'center', whiteSpace:'nowrap' }}>
                  <span style={{ textAlign:'right' }}>
                    <span style={{ fontSize:13.5, fontWeight:800, color: inWin ? G.green : G.muted }}>{fmtLei(valInv(l))} lei</span>
                    {regulaVal === 'executata' && l.valoare_executata_lei && Number(l.valoare_executata_lei) !== Number(l.valoare_lei) && (
                      <span style={{ display:'block', fontSize:10, color:G.dim }}>executat · contract {fmtLei(l.valoare_lei)}</span>
                    )}
                    {regulaVal === 'executata' && l.asociere && !l.valoare_executata_lei && (
                      <span style={{ display:'block', fontSize:10, color:G.red, fontWeight:700 }}>cota Gazpet necompletată!</span>
                    )}
                  </span>
                  <span style={{ fontSize:11.5, color:G.muted }}>{l.tip_pv || 'PV'} {fmtZi(l.data_pv)}</span>
                  <button title="Editează" onClick={() => { setEditRow(l); setShowForm(true) }}
                    style={{ ...S.btnS, padding:'3px 9px', fontSize:11 }}>✏️</button>
                </span>
              </div>
              <div style={{ fontSize:11, color:G.dim, marginTop:3, display:'flex', gap:12, flexWrap:'wrap' }}>
                {l.piese && <span>🗂 {l.piese}</span>}
                {l.folder_nas && <span title={'Calificare\\EXPERIENTA SIMILARA rev.1\\' + l.folder_nas} style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:420 }}>📁 {l.folder_nas}</span>}
                {l.observatii && <span style={{ color:G.muted }} title={l.observatii}>💬 {l.observatii.length > 110 ? l.observatii.slice(0, 110) + '…' : l.observatii}</span>}
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ display:'flex', gap:14, alignItems:'center', marginTop:10, fontSize:11.5, color:G.dim, flexWrap:'wrap' }}>
        <span>Convenție NAS: numărul din numele folderului = valoarea în <b>mii lei</b>.</span>
        <label style={{ display:'flex', alignItems:'center', gap:5, cursor:'pointer', marginLeft:'auto' }}>
          <input type="checkbox" checked={arataInactive} onChange={e => setArataInactive(e.target.checked)} style={{ accentColor:G.dim }} /> arată și inactivele
        </label>
      </div>

      {showForm && (
        <ExperientaFormModal lucrare={editRow} profile={profile}
          onClose={() => { setShowForm(false); setEditRow(null) }} onSave={salveaza} onDelete={sterge} />
      )}
    </div>
  )
}

function ExperientaFormModal({ lucrare, profile, onClose, onSave, onDelete }) {
  const e0 = lucrare
  const [form, setForm] = useState({
    denumire: e0?.denumire || '', beneficiar: e0?.beneficiar || '',
    valoare_lei: e0?.valoare_lei ?? '', valoare_executata_lei: e0?.valoare_executata_lei ?? '',
    data_pv: e0?.data_pv || '', tip_pv: e0?.tip_pv || 'PVRTL',
    piese: e0?.piese || '', folder_nas: e0?.folder_nas || '', dosar_sursa_path: e0?.dosar_sursa_path || '',
    asociere: e0?.asociere || false, observatii: e0?.observatii || '', activ: e0 ? !!e0.activ : true,
  })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const valid = form.denumire.trim()

  const submit = async () => {
    if (!valid) return
    setSaving(true)
    const ok = await onSave(form)
    if (!ok) setSaving(false)
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.7)', zIndex:1000, display:'flex', alignItems:'flex-start', justifyContent:'center', overflowY:'auto', padding:'30px 14px' }} onClick={onClose}>
      <div style={{ ...S.card, width:'min(680px,100%)', padding:24 }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize:17, fontWeight:800, marginBottom:14 }}>📚 {e0 ? `Editează „${e0.denumire}"` : 'Lucrare nouă în catalog'}</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          <div style={{ gridColumn:'1 / -1' }}><label style={S.lbl}>Denumire *</label>
            <input style={S.input} value={form.denumire} onChange={e => set('denumire', e.target.value)} placeholder="ex: Balaceanca - Cond. Dn500 Plataresti - Balaceanca" /></div>
          <div><label style={S.lbl}>Beneficiar</label>
            <input style={S.input} value={form.beneficiar} onChange={e => set('beneficiar', e.target.value)} placeholder="ex: TRANSGAZ" /></div>
          <div><label style={S.lbl}>Valoare contract (lei fără TVA)</label>
            <input style={S.input} type="number" min="0" step="0.01" value={form.valoare_lei} onChange={e => set('valoare_lei', e.target.value)} placeholder="ex: 33289000" /></div>
          <div><label style={S.lbl}>Valoare executată Gazpet (la asocieri)</label>
            <input style={S.input} type="number" min="0" step="0.01" value={form.valoare_executata_lei} onChange={e => set('valoare_executata_lei', e.target.value)} placeholder="cota reală — pt. distribuții" /></div>
          <div><label style={S.lbl}>Data PV recepție</label>
            <input style={S.input} type="date" value={form.data_pv} onChange={e => set('data_pv', e.target.value)} /></div>
          <div><label style={S.lbl}>Tip PV</label>
            <select style={S.input} value={form.tip_pv} onChange={e => set('tip_pv', e.target.value)}>
              {TIP_PV_OPT.map(t => <option key={t} value={t}>{t}</option>)}
            </select></div>
          <div style={{ gridColumn:'1 / -1' }}><label style={S.lbl}>Piese în dosar (F/C/DC/R/PV)</label>
            <input style={S.input} value={form.piese} onChange={e => set('piese', e.target.value)} placeholder="ex: F, C, DC, PVRTL" /></div>
          <div style={{ gridColumn:'1 / -1' }}><label style={S.lbl}>Folder NAS (în Calificare\EXPERIENTA SIMILARA rev.1)</label>
            <input style={S.input} value={form.folder_nas} onChange={e => set('folder_nas', e.target.value)} placeholder="numele exact al folderului" /></div>
          <div style={{ gridColumn:'1 / -1' }}><label style={S.lbl}>Dosar-sursă licitație (opțional)</label>
            <input style={S.input} value={form.dosar_sursa_path} onChange={e => set('dosar_sursa_path', e.target.value)} placeholder={'ex: 1.TRANSGAZ\\63. Cond. Dn500 Plataresti Balaceanca...'} /></div>
          <div style={{ gridColumn:'1 / -1' }}><label style={S.lbl}>Observații</label>
            <textarea style={{ ...S.input, minHeight:56, resize:'vertical' }} value={form.observatii} onChange={e => set('observatii', e.target.value)} /></div>
          <label style={{ display:'flex', alignItems:'center', gap:7, fontSize:13, cursor:'pointer' }}>
            <input type="checkbox" checked={form.asociere} onChange={e => set('asociere', e.target.checked)} style={{ accentColor:G.orange }} />
            Executată în asociere <span style={{ color:G.dim, fontSize:11 }}>(se invocă doar cota Gazpet)</span>
          </label>
          {e0 && (
            <label style={{ display:'flex', alignItems:'center', gap:7, fontSize:13, cursor:'pointer' }}>
              <input type="checkbox" checked={form.activ} onChange={e => set('activ', e.target.checked)} style={{ accentColor:G.green }} />
              Activă în catalog
            </label>
          )}
        </div>
        <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:18, flexWrap:'wrap' }}>
          {e0 && profile?.is_owner && (
            <button style={{ ...S.btnS, color:G.red, borderColor:G.red + '66', marginRight:'auto' }} onClick={() => onDelete(e0)} disabled={saving}>🗑 Șterge</button>
          )}
          <button style={S.btnS} onClick={onClose} disabled={saving}>Anulează</button>
          <button style={{ ...S.btnP, opacity: valid && !saving ? 1 : .5 }} onClick={submit} disabled={!valid || saving}>
            {saving ? 'Se salvează...' : e0 ? '💾 Salvează' : '✅ Adaugă în catalog'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 📡 Radar licitații — anunțuri SEAP scanate zilnic + scoring AI (gap-analysis) ──
// Sursa: tabela ofertare_radar, populată de edge function ofertare-radar-scan
// (cron zilnic + buton „Scanează acum"). Doar anunțurile relevante (CPV/cuvinte-cheie).
function RadarLicitatii({ profile, showToast, onPromovat }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [lastScan, setLastScan] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [fStat, setFStat] = useState('activ')   // activ = nou+interesant
  const [fScor, setFScor] = useState(0)
  const [expanded, setExpanded] = useState(null)

  const load = async () => {
    setLoading(true)
    const [{ data: r }, { data: log }] = await Promise.all([
      supabase.from('ofertare_radar').select('*').eq('relevant', true)
        .order('scor_potrivire', { ascending: false, nullsFirst: false })
        .order('termen_depunere', { ascending: true }),
      supabase.from('ofertare_radar_scan_log').select('*')
        .order('pornit_la', { ascending: false }).limit(1),
    ])
    setRows(r || []); setLastScan(log?.[0] || null); setLoading(false)
  }
  useEffect(() => { load() }, [])

  const scaneaza = async () => {
    setScanning(true)
    const { data, error } = await supabase.functions.invoke('ofertare-radar-scan', { body: { zile: 2 } })
    setScanning(false)
    if (error) { showToast('Scanarea a eșuat: ' + error.message, 'err'); return }
    showToast(`📡 Scanat: ${data?.anunturi_vazute ?? '?'} anunțuri, ${data?.anunturi_noi ?? 0} noi, ${data?.relevante_noi ?? 0} relevante.`)
    await load()
  }

  const setStatus = async (r, status) => {
    const { error } = await supabase.from('ofertare_radar')
      .update({ status, actualizat_la: new Date().toISOString() }).eq('id', r.id)
    if (error) { showToast('Eroare: ' + error.message, 'err'); return }
    showToast(status === 'interesant' ? `⭐ ${r.nr_seap} — marcat interesant.` : `🙈 ${r.nr_seap} — ignorat.`)
    await load()
  }

  // Promovarea creează licitația în pipeline (E0) și leagă rândul de radar de ea
  const promoveaza = async (r) => {
    if (!window.confirm(`Promovezi ${r.nr_seap} în pipeline-ul de licitații?`)) return
    const { data: ins, error } = await supabase.from('ofertare_licitatii').insert({
      nr_anunt: r.nr_seap, autoritate: r.autoritate, obiect: r.titlu,
      link_seap: r.link, valoare_estimata: r.valoare_lei, moneda: 'RON',
      segment: r.segment || detectSegment(r.autoritate, r.titlu),
      // canal = din prefixul nr. SEAP (constraint: seap_cn/seap_scn/seap_adv/non_seap) — 'radar' pica check-ul (Răzvan 07.09.2026)
      termen_depunere: r.termen_depunere, canal: /^SCN/i.test(r.nr_seap || '') ? 'seap_scn' : /^CN/i.test(r.nr_seap || '') ? 'seap_cn' : /^ADV/i.test(r.nr_seap || '') ? 'seap_adv' : 'non_seap', status: 'identificata',
      observatii: r.motiv_scor ? `Radar (scor ${r.scor_potrivire}): ${r.motiv_scor}` : null,
      // identificatorii SEAP merg mai departe: cu ei butonul „Adu din SEAP"
      // descarcă singur toată documentația de atribuire (inclusiv planșele mari)
      c_notice_id: r.c_notice_id || deduIdSeap(r.nr_seap, r.link).c_notice_id, sys_notice_type_id: r.sys_notice_type_id || deduIdSeap(r.nr_seap, r.link).sys_notice_type_id,
      created_by: profile?.id || null,
    }).select('id').single()
    if (error) { showToast('Eroare la promovare: ' + error.message, 'err'); return }
    await supabase.from('ofertare_radar')
      .update({ status: 'preluat', licitatie_id: ins.id, actualizat_la: new Date().toISOString() }).eq('id', r.id)
    showToast(`🏛 ${r.nr_seap} promovată în licitații — documentația se poate aduce din SEAP cu un buton.`)
    await load(); onPromovat?.()
  }

  const zileRamase = t => t ? Math.ceil((new Date(t) - Date.now()) / 86400000) : null
  const scorCul = s => s == null ? G.dim : s >= 70 ? G.green : s >= 40 ? G.yellow : G.dim

  const filtrate = rows.filter(r => {
    if (fStat === 'activ' && !['nou', 'interesant'].includes(r.status)) return false
    if (fStat !== 'activ' && fStat !== 'toate' && r.status !== fStat) return false
    if (fScor && (r.scor_potrivire == null || r.scor_potrivire < fScor)) return false
    return true
  })

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:18, flexWrap:'wrap', gap:10 }}>
        <div>
          <div style={{ fontSize:19, fontWeight:800 }}>📡 Radar licitații</div>
          <div style={{ fontSize:12, color:G.muted }}>
            Anunțuri SEAP scanate automat (conducte gaze + apă/canal) cu scor de potrivire AI
            {lastScan && ` · ultima scanare: ${fmtTermen(lastScan.pornit_la)} — ${lastScan.anunturi_vazute ?? 0} anunțuri, ${lastScan.relevante_noi ?? 0} relevante noi`}
          </div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <select style={{ ...S.input, width:'auto' }} value={fStat} onChange={e => setFStat(e.target.value)}>
            <option value="activ">Noi + interesante</option>
            <option value="interesant">Doar interesante</option>
            <option value="ignorat">Ignorate</option>
            <option value="preluat">Preluate</option>
            <option value="toate">Toate</option>
          </select>
          <select style={{ ...S.input, width:'auto' }} value={fScor} onChange={e => setFScor(Number(e.target.value))}>
            <option value={0}>Orice scor</option>
            <option value={70}>Scor ≥ 70</option>
            <option value={40}>Scor ≥ 40</option>
          </select>
          <button style={{ ...S.btnP, opacity: scanning ? .6 : 1 }} disabled={scanning} onClick={scaneaza}>
            {scanning ? '⏳ Scanez...' : '🔄 Scanează acum'}
          </button>
        </div>
      </div>

      {loading && <div style={{ padding:40, textAlign:'center', color:G.muted }}>Se încarcă radarul...</div>}
      {!loading && !filtrate.length && (
        <div style={{ ...S.card, padding:40, textAlign:'center', color:G.dim, fontSize:14 }}>
          Nimic pe filtrul curent. Radarul scanează zilnic anunțurile noi din SEAP.
        </div>
      )}

      <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
        {filtrate.map(r => {
          const zile = zileRamase(r.termen_depunere)
          const exp = expanded === r.id
          return (
            <div key={r.id} style={{ ...S.card, padding:'14px 18px', cursor:'pointer',
              opacity: ['ignorat'].includes(r.status) ? .55 : 1 }}
              onClick={() => setExpanded(exp ? null : r.id)}>
              <div style={{ display:'flex', alignItems:'flex-start', gap:14, flexWrap:'wrap' }}>
                <div style={{ minWidth:52, textAlign:'center' }}>
                  <div style={{ fontSize:21, fontWeight:800, color: scorCul(r.scor_potrivire) }}>{r.scor_potrivire ?? '—'}</div>
                  <div style={{ fontSize:9.5, color:G.dim, textTransform:'uppercase' }}>scor</div>
                </div>
                <div style={{ flex:1, minWidth:260 }}>
                  <div style={{ fontSize:14, fontWeight:700, lineHeight:1.35 }}>
                    {r.status === 'interesant' && '⭐ '}{r.status === 'preluat' && '🏛 '}{r.titlu}
                  </div>
                  <div style={{ fontSize:12, color:G.muted, marginTop:3 }}>
                    {r.autoritate} · {fmtVal(r.valoare_lei)} lei · {r.cpv}
                  </div>
                  <div style={{ fontSize:12, marginTop:4 }}>
                    <span style={{ color: zile != null && zile <= 7 ? G.red : zile != null && zile <= 14 ? G.orange : G.muted, fontWeight:700 }}>
                      ⏱ {fmtTermen(r.termen_depunere)}{zile != null && zile >= 0 ? ` — ${zile} zile` : zile != null ? ' — EXPIRAT' : ''}
                    </span>
                    {r.tip_procedura && <span style={{ color:G.dim }}> · {r.tip_procedura}</span>}
                    {r.are_loturi && <span style={{ color:G.dim }}> · pe loturi</span>}
                  </div>
                  {r.motiv_scor && <div style={{ fontSize:12, color:G.text, marginTop:6, opacity:.85 }}>{r.motiv_scor}</div>}
                  {exp && Array.isArray(r.lipsuri) && r.lipsuri.length > 0 && (
                    <div style={{ marginTop:8, padding:'8px 12px', background:G.bg, borderRadius:7, border:`1px solid ${G.border2}` }}>
                      <div style={{ fontSize:11, fontWeight:700, color:G.orange, marginBottom:4 }}>⚠ CE NE-AR LIPSI</div>
                      {r.lipsuri.map((l, i) => <div key={i} style={{ fontSize:12, color:G.muted, marginBottom:3 }}>• {l}</div>)}
                    </div>
                  )}
                  {exp && Array.isArray(r.documente) && r.documente.length > 0 && (
                    <div style={{ marginTop:8, padding:'8px 12px', background:G.bg, borderRadius:7, border:`1px solid ${G.border2}` }}>
                      <div style={{ fontSize:11, fontWeight:700, color:G.muted, marginBottom:4 }}>📎 DOCUMENTAȚIA PUBLICATĂ ({r.documente.length}) — descărcarea cere login SEAP</div>
                      {r.documente.map((d, i) => <div key={i} style={{ fontSize:12, color:G.dim, marginBottom:2 }}>• {d.nume}</div>)}
                    </div>
                  )}
                </div>
                <div style={{ display:'flex', flexDirection:'column', gap:6, alignItems:'stretch' }} onClick={e => e.stopPropagation()}>
                  {r.link && <a href={r.link} target="_blank" rel="noreferrer" style={{ ...S.btnS, padding:'6px 12px', fontSize:12, textAlign:'center', textDecoration:'none', color:G.blue }}>SEAP ↗</a>}
                  {['nou', 'interesant'].includes(r.status) && <>
                    {r.status === 'nou' && <button style={{ ...S.btnS, padding:'6px 12px', fontSize:12 }} onClick={() => setStatus(r, 'interesant')}>⭐ Interesant</button>}
                    <button style={{ ...S.btnS, padding:'6px 12px', fontSize:12 }} onClick={() => setStatus(r, 'ignorat')}>🙈 Ignoră</button>
                    <button style={{ ...S.btnP, padding:'6px 12px', fontSize:12 }} onClick={() => promoveaza(r)}>🏛 Promovează</button>
                  </>}
                  {r.status === 'ignorat' && <button style={{ ...S.btnS, padding:'6px 12px', fontSize:12 }} onClick={() => setStatus(r, 'nou')}>↩ Readu</button>}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── 💰 Referințe financiare — calibrări istorice + prețuri unitare + materiale ──
// Sursa: anatomia celor 5 oferte depuse (doc claude: anatomia-oferta-financiara).
// Calibrări = cu ce coeficienți s-a mers per beneficiar/an. Prețurile de materiale
// sunt istoric orientativ — fluxul viu va fi generatorul de cereri de ofertă (RFQ).
function ReferinteFinanciare({ showToast }) {
  const [cal, setCal] = useState([])
  const [pu, setPu] = useState([])
  const [mat, setMat] = useState([])
  const [norme, setNorme] = useState([])
  const [part, setPart] = useState([])
  const [loading, setLoading] = useState(true)
  const [cauta, setCauta] = useState('')
  const [particip, setParticip] = useState([])
  const [fEnt, setFEnt] = useState('')  // filtru entitate în tab Participări
  const [tab, setTab] = useState('calibrari')  // calibrari | participari | preturi | materiale | normative | parteneri | documente

  const loadAll = async () => {
    const [{ data: c }, { data: p }, { data: m }, { data: n }, { data: pa }] = await Promise.all([
      supabase.from('ofertare_calibrari').select('*').order('an', { ascending: false, nullsFirst: false }),
      supabase.from('ofertare_preturi_unitare').select('*').order('an', { ascending: false, nullsFirst: false }),
      supabase.from('ofertare_preturi_materiale').select('*').order('an', { ascending: false, nullsFirst: false }),
      supabase.from('ofertare_normative').select('*').order('created_at', { ascending: false }),
      supabase.from('ofertare_parteneri').select('*').order('nume'),
    ])
    const { data: pp } = await supabase.from('ofertare_participari').select('*').order('nr_seap', { ascending:false })
    setCal(c || []); setPu(p || []); setMat(m || []); setNorme(n || []); setPart(pa || []); setParticip(pp || []); setLoading(false)
  }
  useEffect(() => { loadAll() }, [])

  const q = cauta.toLowerCase()
  const fPu = pu.filter(r => !q || `${r.simbol} ${r.denumire} ${r.lucrare}`.toLowerCase().includes(q))
  const fMat = mat.filter(r => !q || `${r.denumire} ${r.furnizor} ${r.lucrare}`.toLowerCase().includes(q))
  const fmtPct = v => v == null ? '—' : `${Number(v)}%`
  const REZ = { castigata: ['🏆', G.green], pierduta: ['❌', G.red], depusa: ['📮', G.purple], anulata: ['⛔', G.dim] }

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16, flexWrap:'wrap', gap:10 }}>
        <div>
          <div style={{ fontSize:19, fontWeight:800 }}>💰 Referințe financiare</div>
          <div style={{ fontSize:12, color:G.muted }}>Cu ce coeficienți s-a mers istoric, pe segmente — plus prețuri unitare și materiale din ofertele depuse</div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          {[['calibrari', `⚙️ Calibrări (${cal.length})`], ['participari', `🛰️ Participări SEAP (${particip.length})`], ['sezonier', '📅 Sezonier'], ['preturi', `🔧 Prețuri unitare (${pu.length})`], ['materiale', `🧱 Materiale (${mat.length})`], ['normative', `📜 Normative (${norme.length})`], ['parteneri', `🤝 Parteneri (${part.length})`], ['documente', '🗂 Documente NAS']].map(([k, lbl]) => (
            <button key={k} onClick={() => setTab(k)} style={{ ...S.btnS, padding:'6px 13px', fontSize:12, fontWeight:700,
              ...(tab === k ? { background:G.ofertare + '22', color:G.ofertare, border:`1px solid ${G.ofertare}88` } : {}) }}>{lbl}</button>
          ))}
        </div>
      </div>

      {loading && <div style={{ padding:40, textAlign:'center', color:G.muted }}>Se încarcă referințele...</div>}

      {!loading && tab === 'calibrari' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {/* VS câștigat / pierdut (participările din inventar; rezultatele le completează Razvan) */}
          {(() => {
            const w = cal.filter(r => r.rezultat === 'castigata'), l = cal.filter(r => r.rezultat === 'pierduta')
            const p = cal.filter(r => r.rezultat === 'depusa'), decise = w.length + l.length
            const suma = a => a.reduce((s, r) => s + Number(r.valoare_lei || 0), 0)
            return (
              <div style={{ ...S.card, padding:'14px 18px', display:'flex', gap:18, flexWrap:'wrap', alignItems:'center' }}>
                <div style={{ fontWeight:800, fontSize:14 }}>⚔️ Câștigat vs Pierdut</div>
                {[['🏆 Câștigate', w.length, fmtVal(suma(w)) + ' lei', G.green],
                  ['❌ Pierdute', l.length, fmtVal(suma(l)) + ' lei', G.red],
                  ['📮 Fără rezultat', p.length, fmtVal(suma(p)) + ' lei', G.purple]].map(([lbl, n, v, c]) => (
                  <div key={lbl} style={{ background:G.bg, border:`1px solid ${G.border2}`, borderRadius:8, padding:'6px 14px' }}>
                    <div style={{ fontSize:10, color:G.dim, fontWeight:700 }}>{lbl}</div>
                    <div style={{ fontSize:16, fontWeight:800, color:c }}>{n} <span style={{ fontSize:11, color:G.muted, fontWeight:600 }}>· {v}</span></div>
                  </div>
                ))}
                {decise > 0 && <div style={{ fontSize:13, color:G.muted }}>Rată de câștig: <b style={{ color:G.ofertare }}>{Math.round(w.length * 100 / decise)}%</b> din {decise} decise</div>}
                {p.length > 0 && <div style={{ fontSize:12, color:G.purple }}>👉 completează rezultatele cu butoanele de pe rânduri</div>}
              </div>
            )
          })()}
          {cal.map(r => {
            const seg = SEGMENTE[r.segment] || SEGMENTE.altele
            const [rIcon, rCol] = REZ[r.rezultat] || ['❔', G.dim]
            return (
              <div key={r.id} style={{ ...S.card, padding:'14px 18px', borderLeft:`3px solid ${seg.color}` }}>
                <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                  <span style={{ color:seg.color, border:`1px solid ${seg.color}55`, borderRadius:10, padding:'1px 9px', fontSize:10.5, fontWeight:800 }}>{seg.label}</span>
                  <span style={{ fontWeight:700, fontSize:13.5, flex:1, minWidth:240 }}>{r.lucrare}</span>
                  <span style={{ color:rCol, fontWeight:800, fontSize:12 }}>{rIcon} {r.rezultat || '—'}</span>
                  {r.rezultat === 'depusa' && (
                    <span style={{ display:'flex', gap:6 }}>
                      <button title="Marchează câștigată" style={{ ...S.btnS, padding:'2px 9px', fontSize:11, color:G.green }} onClick={async () => {
                        const { error } = await supabase.from('ofertare_calibrari').update({ rezultat:'castigata', updated_at:new Date().toISOString() }).eq('id', r.id)
                        if (error) return showToast('Eroare: ' + error.message, 'err')
                        loadAll()
                      }}>🏆</button>
                      <button title="Marchează pierdută (+ câștigător)" style={{ ...S.btnS, padding:'2px 9px', fontSize:11, color:G.red }} onClick={async () => {
                        const cine = window.prompt('Cine a câștigat? (gol = necunoscut)')
                        if (cine === null) return
                        const nota = cine.trim() ? `${r.note ? r.note + ' · ' : ''}Câștigător: ${cine.trim()}` : r.note
                        const { error } = await supabase.from('ofertare_calibrari').update({ rezultat:'pierduta', note: nota || null, updated_at:new Date().toISOString() }).eq('id', r.id)
                        if (error) return showToast('Eroare: ' + error.message, 'err')
                        loadAll()
                      }}>❌</button>
                    </span>
                  )}
                  <span style={{ color:G.dim, fontSize:12 }}>{r.an || '—'}</span>
                </div>
                <div style={{ display:'flex', gap:16, marginTop:8, flexWrap:'wrap' }}>
                  {[['Valoare', r.valoare_lei != null ? fmtVal(r.valoare_lei) + ' lei' : '—'],
                    ['Indirecte', fmtPct(r.indirecte_pct)], ['Profit', fmtPct(r.profit_pct)],
                    ['Manoperă', r.tarif_manopera != null ? `${Number(r.tarif_manopera)} lei/h` : '—'],
                    ['OS', fmtPct(r.os_pct)]].map(([k, v]) => (
                    <div key={k} style={{ background:G.bg, border:`1px solid ${G.border2}`, borderRadius:7, padding:'5px 12px' }}>
                      <div style={{ fontSize:9.5, color:G.dim, textTransform:'uppercase', fontWeight:700 }}>{k}</div>
                      <div style={{ fontSize:13.5, fontWeight:800 }}>{v}</div>
                    </div>
                  ))}
                </div>
                {r.note && <div style={{ fontSize:12, color:G.muted, marginTop:8 }}>{r.note}</div>}
              </div>
            )
          })}
          <div style={{ fontSize:11.5, color:G.dim, padding:'6px 4px' }}>
            Formula devizului: directe (mat+man+uti+tra) + CAM 2,25% pe manoperă → + indirecte % → + profit %. Rândurile se completează la fiecare ofertă depusă.
          </div>
        </div>
      )}

      {!loading && tab === 'participari' && <ParticipariSeap particip={particip} fEnt={fEnt} setFEnt={setFEnt} />}
      {!loading && tab === 'sezonier' && <RadarSezonier />}

      {!loading && tab === 'normative' && <NormativeLista norme={norme} showToast={showToast} onChange={loadAll} />}

      {!loading && tab === 'parteneri' && (
        <>
          <input style={{ ...S.input, marginBottom:12, maxWidth:420 }} placeholder="🔍 Caută partener..." value={cauta} onChange={e => setCauta(e.target.value)} />
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {part.filter(p => !q || `${p.nume} ${p.observatii || ''}`.toLowerCase().includes(q)).map(p => (
              <div key={p.id} style={{ ...S.card, padding:'12px 16px', borderLeft:`3px solid ${p.tip_relatie === 'subcontractant' ? G.ofertare : G.blue}`, opacity: p.abandonat ? 0.5 : 1 }}>
                <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                  <span style={{ fontWeight:800, fontSize:13.5 }}>{p.nume}</span>
                  <span style={{ fontSize:10.5, fontWeight:700, color:G.muted, border:`1px solid ${G.border}`, borderRadius:10, padding:'1px 8px' }}>{p.tip_relatie === 'subcontractant' ? '🔧 subcontractant' : '📦 furnizor servicii'}</span>
                  {p.abandonat && <span style={{ fontSize:10.5, color:G.red, fontWeight:700 }}>⛔ abandonat{p.abandonat_motiv ? ` — ${p.abandonat_motiv}` : ''}</span>}
                  {p.cui && <span style={{ fontSize:11, color:G.dim }}>{p.cui}</span>}
                  {p.contact && <span style={{ fontSize:11, color:G.dim }}>{p.contact}</span>}
                </div>
                {p.observatii && <div style={{ fontSize:12, color:G.muted, marginTop:5 }}>{p.observatii}</div>}
              </div>
            ))}
          </div>
          <div style={{ fontSize:11.5, color:G.dim, padding:'8px 4px' }}>
            Sursa: folderele de pe NAS din <code>Oferte\Calificare\autorizari firme</code> — documentele fiecăruia se caută în tabul 🗂 Documente NAS.
          </div>
        </>
      )}

      {!loading && tab === 'documente' && <DocumenteNasCauta />}

      {!loading && (tab === 'preturi' || tab === 'materiale') && (
        <>
          <input style={{ ...S.input, marginBottom:12, maxWidth:420 }} placeholder="🔍 Caută (denumire, simbol, lucrare, furnizor...)" value={cauta} onChange={e => setCauta(e.target.value)} />
          <div style={{ ...S.card, overflow:'hidden' }}>
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12.5 }}>
                <thead>
                  <tr style={{ background:G.surface, color:G.muted, fontSize:11, textTransform:'uppercase' }}>
                    {(tab === 'preturi' ? ['Simbol', 'Denumire', 'UM', 'Preț', 'Tip', 'Lucrare', 'An']
                      : ['Denumire', 'UM', 'Preț', 'Furnizor', 'Lucrare', 'An']).map(h => (
                      <th key={h} style={{ textAlign:'left', padding:'9px 12px', borderBottom:`1px solid ${G.border}` }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(tab === 'preturi' ? fPu : fMat).map(r => (
                    <tr key={r.id} style={{ borderBottom:`1px solid ${G.border2}` }} title={r.note || ''}>
                      {tab === 'preturi' && <td style={{ padding:'8px 12px', color:G.ofertare, fontWeight:700, whiteSpace:'nowrap' }}>{r.simbol || '—'}</td>}
                      <td style={{ padding:'8px 12px', maxWidth:380 }}>{r.denumire}{r.note ? ' *' : ''}</td>
                      <td style={{ padding:'8px 12px', color:G.dim }}>{r.um || '—'}</td>
                      <td style={{ padding:'8px 12px', fontWeight:800, whiteSpace:'nowrap' }}>{fmtVal(r.pret)} lei</td>
                      {tab === 'preturi' ? <td style={{ padding:'8px 12px', color:G.muted }}>{r.tip}</td>
                        : <td style={{ padding:'8px 12px', color:G.muted }}>{r.furnizor || '—'}</td>}
                      <td style={{ padding:'8px 12px', color:G.dim, maxWidth:180, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.lucrare || '—'}</td>
                      <td style={{ padding:'8px 12px', color:G.dim }}>{r.an || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {tab === 'materiale' && (
            <div style={{ fontSize:11.5, color:G.dim, padding:'8px 4px' }}>
              ⚠️ Prețurile de materiale se învechesc — sunt referință, nu ofertă. Fluxul complet (generator cereri de ofertă → import oferte primite → comparativ → prețuri per licitație) e următorul pas al modulului.
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── 📜 Normative — ordine ANRE, prescripții, comunicări sudură, standarde ──
// Registrul "ordinelor în vigoare" (cerut de Razvan 28.08): echipa le găsește
// într-un loc, iar AI-ul citează din ele la cereri de ofertă / clarificări /
// propuneri tehnice. Statusul (în vigoare / abrogat / înlocuit) e vital.
const NORM_TIP = { ordin_anre:'Ordin ANRE', prescriptie_iscir:'Prescripție ISCIR', lege:'Lege', hg:'HG', oug:'OUG', ordin:'Ordin', standard:'Standard', comunicare:'Comunicare', norma_tehnica:'Normă tehnică', altele:'Altele' }
const NORM_APLIC = { 'achiziții SECTORIALE':['⚡ SECTORIAL (L99)', '#D68B4A'], 'achiziții CLASICE':['🏛 CLASIC (L98)', '#58A6FF'], 'cadru general':['cadru general', '#8B949E'], 'tehnic':['tehnic', '#3FB6E2'], 'ambele':['ambele', '#3FB950'] }
const NORM_STATUS = { in_vigoare:['✅ în vigoare', G.green], abrogat:['⛔ abrogat', G.red], inlocuit:['🔁 înlocuit', G.orange] }

// ── 🗂 Căutare în indexul NAS (nas_documente) — categoriile calificare_* + tot corpusul ──
// Nu descarcă fișiere: arată calea de pe NAS (Z:\), care se deschide de pe laptopurile din birou.
const NAS_CATEGORII = [
  ['', 'Toate categoriile'],
  ['calificare_autorizari_parteneri', '🤝 Autorizări parteneri'],
  ['calificare_firma', '🏢 Documente firmă (calificare)'],
  ['calificare_personal', '👷 Personal (calificare)'],
  ['calificare_experienta', '📚 Experiență similară'],
  ['calificare_experienta_manageri', '🎓 Experiență manageri'],
  ['calificare_model_propuneri', '📄 Modele propuneri tehnice'],
  ['calificare_instructiuni_lucru', '🛠 Instrucțiuni de lucru'],
  ['calificare_utilaje_echip', '🚜 Utilaje & echipamente'],
  ['calificare_declaratii', '✍️ Declarații disponibilitate'],
  ['calificare_invest', '🏗 Gazpet Invest'],
  ['calificare_semnaturi', '🔏 Semnături'],
  ['calificare_sablon_fise_post', '🗃 Șabloane fișe post'],
  ['seap', 'SEAP (toate licitațiile)'],
  ['propunere_tehnica', 'Propuneri tehnice (istoric)'],
  ['calitate', 'Calitate (istoric)'],
]

function DocumenteNasCauta() {
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('calificare_autorizari_parteneri')
  const [rez, setRez] = useState(null)
  const [loading, setLoading] = useState(false)

  const cautaDocs = async () => {
    if (!q.trim() && !cat) return
    setLoading(true)
    let query = supabase.from('nas_documente')
      .select('id, nas_path, denumire, extensie, categorie, size_bytes, data_modificare')
      .order('data_modificare', { ascending: false }).limit(200)
    if (cat) query = query.eq('categorie', cat)
    if (q.trim()) query = query.or(`denumire.ilike.%${q.trim()}%,nas_path.ilike.%${q.trim()}%`)
    const { data, error } = await query
    setRez(error ? [] : (data || []))
    setLoading(false)
  }

  const kb = b => b == null ? '—' : b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`
  const caleWin = p => 'Z:\\' + p.replace(/^Oferte\//, 'Oferte\\').replace(/\//g, '\\')

  return (
    <div>
      <div style={{ display:'flex', gap:8, marginBottom:12, flexWrap:'wrap' }}>
        <select style={{ ...S.input, maxWidth:300 }} value={cat} onChange={e => setCat(e.target.value)}>
          {NAS_CATEGORII.map(([v, lbl]) => <option key={v} value={v}>{lbl}</option>)}
        </select>
        <input style={{ ...S.input, flex:1, minWidth:220, maxWidth:420 }} placeholder="🔍 Caută în nume sau cale (min. o literă)..."
          value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && cautaDocs()} />
        <button style={{ ...S.btnP, padding:'8px 18px' }} onClick={cautaDocs} disabled={loading}>{loading ? '...' : 'Caută'}</button>
      </div>

      {rez === null && <div style={{ padding:30, textAlign:'center', color:G.dim, fontSize:12.5 }}>Alege o categorie și/sau scrie un cuvânt, apoi apasă Caută. Indexul acoperă tot NAS-ul de oferte (~248.000 fișiere).</div>}
      {rez !== null && (
        <>
          <div style={{ fontSize:12, color:G.muted, marginBottom:8 }}>{rez.length === 200 ? 'Primele 200 de rezultate (restrânge căutarea)' : `${rez.length} rezultate`} · sortate după data modificării</div>
          <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
            {rez.map(d => (
              <div key={d.id} style={{ ...S.card, padding:'8px 14px', display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                <span style={{ fontWeight:700, fontSize:12.5, flex:1, minWidth:220 }}>{d.denumire}</span>
                <span style={{ fontSize:10.5, color:G.dim }}>{kb(d.size_bytes)}</span>
                <span style={{ fontSize:10.5, color:G.dim }}>{d.data_modificare || ''}</span>
                <button style={{ ...S.btnS, fontSize:10.5, padding:'3px 10px' }} title={caleWin(d.nas_path)}
                  onClick={() => { navigator.clipboard.writeText(caleWin(d.nas_path)); }}>📋 Copiază calea</button>
                <div style={{ flexBasis:'100%', fontSize:10.5, color:G.dim, fontFamily:'monospace', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{d.nas_path}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function NormativeLista({ norme, showToast, onChange }) {
  const [showAdd, setShowAdd] = useState(false)
  const [fAplic, setFAplic] = useState('')
  const [fCauta, setFCauta] = useState('')
  const [f, setF] = useState({ tip:'ordin_anre', numar:'', titlu:'', emitent:'', data_emitere:'', status:'in_vigoare', inlocuit_de:'', domenii:'', link:'', note:'' })
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))

  const salveaza = async () => {
    if (!f.titlu.trim()) { showToast('Titlul e obligatoriu.', 'err'); return }
    const { error } = await supabase.from('ofertare_normative').insert({
      tip: f.tip, numar: f.numar.trim() || null, titlu: f.titlu.trim(), emitent: f.emitent.trim() || null,
      data_emitere: f.data_emitere || null, status: f.status, inlocuit_de: f.inlocuit_de.trim() || null,
      domenii: f.domenii.trim() ? f.domenii.split(',').map(s => s.trim()).filter(Boolean) : null,
      link: f.link.trim() || null, note: f.note.trim() || null,
    })
    if (error) { showToast('Eroare: ' + error.message, 'err'); return }
    showToast('Normativ adăugat.')
    setShowAdd(false); setF({ tip:'ordin_anre', numar:'', titlu:'', emitent:'', data_emitere:'', status:'in_vigoare', inlocuit_de:'', domenii:'', link:'', note:'' })
    onChange()
  }
  const schimbaStatus = async (n, status) => {
    await supabase.from('ofertare_normative').update({ status, updated_at: new Date().toISOString() }).eq('id', n.id)
    onChange()
  }
  const sterge = async (n) => {
    if (!window.confirm(`Ștergi „${n.titlu.slice(0, 60)}"?`)) return
    await supabase.from('ofertare_normative').delete().eq('id', n.id)
    onChange()
  }

  return (
    <div>
      <div style={{ display:'flex', gap:8, marginBottom:10, flexWrap:'wrap', alignItems:'center' }}>
        <select style={{ ...S.input, width:'auto' }} value={fAplic} onChange={e => setFAplic(e.target.value)}>
          <option value="">Toate aplicabilitățile</option>
          {Object.keys(NORM_APLIC).map(k => <option key={k} value={k}>{NORM_APLIC[k][0]}</option>)}
        </select>
        <input style={{ ...S.input, flex:1, minWidth:200, maxWidth:360 }} placeholder="🔍 Caută normativ / standard..." value={fCauta} onChange={e => setFCauta(e.target.value)} />
        <div style={{ flex:1 }} />
        <button style={S.btnP} onClick={() => setShowAdd(s => !s)}>{showAdd ? '✕ renunță' : '＋ Normativ'}</button>
      </div>
      {showAdd && (
        <div style={{ ...S.card, padding:14, marginBottom:12, display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:10 }}>
          <div><label style={S.lbl}>Tip</label>
            <select style={S.input} value={f.tip} onChange={e => set('tip', e.target.value)}>
              {Object.entries(NORM_TIP).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select></div>
          <div><label style={S.lbl}>Număr (ex: 89/2018)</label><input style={S.input} value={f.numar} onChange={e => set('numar', e.target.value)} /></div>
          <div><label style={S.lbl}>Emitent</label><input style={S.input} value={f.emitent} onChange={e => set('emitent', e.target.value)} placeholder="ANRE / ISCIR / Transgaz..." /></div>
          <div><label style={S.lbl}>Data emiterii</label><input style={S.input} type="date" value={f.data_emitere} onChange={e => set('data_emitere', e.target.value)} /></div>
          <div style={{ gridColumn:'1 / -1' }}><label style={S.lbl}>Titlu *</label><input style={S.input} value={f.titlu} onChange={e => set('titlu', e.target.value)} /></div>
          <div><label style={S.lbl}>Status</label>
            <select style={S.input} value={f.status} onChange={e => set('status', e.target.value)}>
              {Object.entries(NORM_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
            </select></div>
          <div><label style={S.lbl}>Înlocuit de</label><input style={S.input} value={f.inlocuit_de} onChange={e => set('inlocuit_de', e.target.value)} /></div>
          <div><label style={S.lbl}>Domenii (virgulă)</label><input style={S.input} value={f.domenii} onChange={e => set('domenii', e.target.value)} placeholder="distributie, sudura_pe" /></div>
          <div><label style={S.lbl}>Link</label><input style={S.input} value={f.link} onChange={e => set('link', e.target.value)} /></div>
          <div style={{ gridColumn:'1 / -1', display:'flex', gap:10, alignItems:'flex-end' }}>
            <div style={{ flex:1 }}><label style={S.lbl}>Note</label><input style={S.input} value={f.note} onChange={e => set('note', e.target.value)} /></div>
            <button style={S.btnP} onClick={salveaza}>Salvează</button>
          </div>
        </div>
      )}
      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
        {norme.filter(n => (!fAplic || n.aplicabilitate === fAplic) && (!fCauta || `${n.titlu} ${n.numar || ''} ${n.identificator || ''} ${n.note || ''}`.toLowerCase().includes(fCauta.toLowerCase()))).map(n => {
          const [stLbl, stCol] = NORM_STATUS[n.status] || NORM_STATUS.in_vigoare
          const neconf = (n.stare || '').includes('NECONFIRMAT')
          const aplic = NORM_APLIC[n.aplicabilitate]
          return (
            <div key={n.id} style={{ ...S.card, padding:'11px 15px', borderLeft:`3px solid ${neconf ? G.red : stCol}`, opacity: n.status === 'abrogat' ? .55 : 1 }}>
              <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                <span style={{ fontSize:11, color:G.ofertare, fontWeight:800, border:`1px solid ${G.ofertare}44`, borderRadius:10, padding:'1px 9px', whiteSpace:'nowrap' }}>{NORM_TIP[n.tip] || n.tip}{n.numar ? ' ' + n.numar : ''}</span>
                {aplic && <span style={{ fontSize:10, color:aplic[1], fontWeight:800, border:`1px solid ${aplic[1]}55`, borderRadius:10, padding:'1px 8px', whiteSpace:'nowrap' }}>{aplic[0]}</span>}
                {neconf && <span title={n.stare} style={{ fontSize:10, color:'#0D1117', background:G.red, fontWeight:800, borderRadius:10, padding:'1px 8px', whiteSpace:'nowrap' }}>⚠ NECONFIRMAT — nu cita fără verificare</span>}
                {n.stare && n.stare.includes('înlocuit') && <span style={{ fontSize:10, color:G.orange, fontWeight:800, border:`1px solid ${G.orange}55`, borderRadius:10, padding:'1px 8px' }}>⚠ {n.stare}</span>}
                <span style={{ fontWeight:700, fontSize:13, flex:1, minWidth:220 }}>{n.link ? <a href={n.link} target="_blank" rel="noreferrer" style={{ color:G.text }}>{n.titlu}</a> : n.titlu}</span>
                <span style={{ color:stCol, fontWeight:800, fontSize:11.5, whiteSpace:'nowrap' }}>{stLbl}{n.inlocuit_de ? ` → ${n.inlocuit_de}` : ''}</span>
                <select style={{ ...S.input, width:'auto', fontSize:11, padding:'3px 7px' }} value={n.status} onChange={e => schimbaStatus(n, e.target.value)}>
                  {Object.entries(NORM_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <button onClick={() => sterge(n)} style={{ ...S.btnS, padding:'3px 8px', fontSize:11, color:G.red, borderColor:G.red + '66' }}>✕</button>
              </div>
              <div style={{ fontSize:11.5, color:G.dim, marginTop:4, display:'flex', gap:14, flexWrap:'wrap' }}>
                {n.emitent && <span>🏛 {n.emitent}</span>}
                {n.data_emitere && <span>📅 {new Date(n.data_emitere).toLocaleDateString('ro-RO')}</span>}
                {Array.isArray(n.domenii) && n.domenii.length > 0 && <span>🏷 {n.domenii.join(', ')}</span>}
                {n.prioritate && <span style={{ color: n.prioritate === 'CRITIC' ? G.red : n.prioritate === 'IMPORTANT' ? G.orange : G.dim, fontWeight:700 }}>◆ {n.prioritate}</span>}
              </div>
              {n.modificari_ulterioare && <div style={{ fontSize:11.5, color:G.ofertare, marginTop:3 }}>📌 Se citează consolidat: {n.modificari_ulterioare}</div>}
              {n.note && <div style={{ fontSize:11.5, color:G.muted, marginTop:3 }}>💬 {n.note}</div>}
            </div>
          )
        })}
        {!norme.length && <div style={{ ...S.card, padding:26, textAlign:'center', color:G.dim, fontSize:13 }}>Niciun normativ încă — adaugă ordinele ANRE și comunicările de sudură cu „＋ Normativ".</div>}
      </div>
    </div>
  )
}

// ── 🛰️ Participări SEAP — Gazpet + competitori (atribuiri din API, winnerId) ──
function ParticipariSeap({ particip, fEnt, setFEnt }) {
  const ETICHETE = {
    gazpet_instal: ['GAZPET-INSTAL', '#3FB950'], gazpet_invest: ['GAZPET INVEST (grup)', '#58A6FF'],
    'competitor:inspet': ['INSPET', '#F85149'], 'competitor:moldocor': ['MOLDOCOR', '#F0883E'],
    'competitor:cis_gaz': ['CIS GAZ', '#BC8CFF'], 'competitor:habau': ['HABAU', '#D29922'],
    'competitor:instgaz': ['INSTGAZ', '#2FB6C9'], 'competitor:miral_instal': ['MIRAL INSTAL', '#FF7B72'],
    'competitor:armax_gaz': ['ARMAX GAZ', '#8B949E'], 'competitor:condmag': ['CONDMAG', '#8B949E'],
    'competitor:timgaz': ['TIMGAZ', '#8B949E'], 'competitor:amarad': ['AMARAD', '#8B949E'],
    'competitor:comesad': ['COMESAD', '#E3B341'], 'competitor:petroconst': ['PETROCONST', '#79C0FF'],
    'competitor:totalgaz': ['TOTALGAZ', '#56D364'], 'competitor:irigc': ['IRIGC', '#FFA657'],
    'competitor:ruxo': ['RUXO', '#D2A8FF'], 'competitor:cfi': ['CFI (Foraje)', '#7EE787'],
    'competitor:erdesign': ['EDGE ROUND DESIGN', '#A5D6FF'], 'competitor:prodrep_star': ['PRODREP STAR', '#FFAB70'],
    'competitor:talpac': ['TALPAC', '#8B949E'], 'competitor:invest_general_construct': ['INVEST GENERAL', '#F778BA'],
    'competitor:menada': ['MENADA', '#8B949E'], 'competitor:utilitar_fluid': ['UTILITAR FLUID', '#79C0FF'],
    'competitor:rominsta': ['ROMINSTA', '#E3B341'], 'competitor:rapid_complex': ['RAPID COMPLEX', '#56D364'],
  }
  const eticheta = (e) => ETICHETE[e] || [e.replace('competitor:', '').toUpperCase(), G.muted]
  const sumar = {}
  for (const p of particip) {
    sumar[p.entitate] = sumar[p.entitate] || { n:0, val:0 }
    sumar[p.entitate].n++; sumar[p.entitate].val += Number(p.valoare_ron || 0)
  }
  const ordonate = Object.entries(sumar).sort((a, b) => (a[0] === 'gazpet_instal' ? -1 : b[0] === 'gazpet_instal' ? 1 : b[1].val - a[1].val))
  const lista = particip.filter(p => !fEnt || p.entitate === fEnt)

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
      <div style={{ fontSize:12, color:G.muted }}>
        Atribuiri SEAP unde entitatea apare câștigător (direct din API, refresh automat lunea). La asocieri, valoarea e a întregului contract. Click pe o firmă filtrează lista.
      </div>
      {/* Sumar pe entitate — analiza pe competitor */}
      <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
        {ordonate.map(([ent, s]) => {
          const [lbl, col] = eticheta(ent)
          const activ = fEnt === ent
          return (
            <div key={ent} onClick={() => setFEnt(activ ? '' : ent)} style={{ ...S.card, padding:'8px 14px', cursor:'pointer', borderLeft:`3px solid ${col}`, ...(activ ? { background:col + '18', border:`1px solid ${col}88` } : {}) }}>
              <div style={{ fontSize:11, fontWeight:800, color:col }}>{lbl}</div>
              <div style={{ fontSize:14, fontWeight:800 }}>{s.n} <span style={{ fontSize:11.5, color:G.muted, fontWeight:600 }}>ctr. · {fmtVal(Math.round(s.val / 1e6))} mil lei</span></div>
            </div>
          )
        })}
        {fEnt && <button onClick={() => setFEnt('')} style={{ ...S.btnS, padding:'4px 12px', fontSize:12, alignSelf:'center' }}>✕ tot</button>}
      </div>
      {/* Lista atribuirilor */}
      {lista.map(p => {
        const [lbl, col] = eticheta(p.entitate)
        return (
          <div key={p.id} style={{ ...S.card, padding:'10px 16px', display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', fontSize:13, borderLeft:`3px solid ${col}` }}>
            <span style={{ fontSize:10.5, fontWeight:800, color:col, border:`1px solid ${col}55`, borderRadius:10, padding:'1px 8px', minWidth:88, textAlign:'center' }}>{lbl}</span>
            <a href={p.link || '#'} target="_blank" rel="noreferrer" style={{ fontWeight:700, color:G.blue, textDecoration:'none', flex:1, minWidth:260 }}>{p.titlu}</a>
            <span style={{ color:G.muted, fontSize:12 }}>{(p.autoritate || '').replace(/^[A-Z0-9]+ - /, '').slice(0, 40)}</span>
            <span style={{ color:G.dim, fontSize:11.5 }}>{p.nr_seap}</span>
            <span style={{ color:G.yellow, fontWeight:700, minWidth:105, textAlign:'right' }}>{p.valoare_ron != null ? fmtVal(p.valoare_ron) + ' lei' : '—'}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── 🔍 Poarta 4: verificarea finală anti-descalificare ──────────────────────
// 3 treceri: (A) determinist din registru, (B) adversarial (Sonnet 5),
// (C) arbitrul final (Fable 5.1). Rulează câteva minute; verdictul se salvează.
function VerificareFinalaSection({ licitatie: l }) {
  const [ultima, setUltima] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  useEffect(() => {
    supabase.from('ofertare_verificari').select('*').eq('licitatie_id', l.id).order('id', { ascending:false }).limit(1)
      .then(({ data }) => setUltima(data?.[0] || null))
  }, [l.id])

  // parolă cerută de Razvan (03.09) — verificarea consumă mult, nu se apasă „de curiozitate"
  const ruleaza = async () => {
    const p = window.prompt('⚠️ Această verificare consumă foarte multe resurse, este indicat să se folosească doar la finalul licitației, până la depunerea în SEAP!\n\nIntrodu parola pentru a continua:')
    if (p === null) return
    if (p !== 'Gazpet2026') { setErr('Parolă greșită — verificarea nu a pornit.'); return }
    setBusy(true); setErr(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch('https://dxczwkbciseqniprspcu.supabase.co/functions/v1/ofertare-verificare-finala', {
        method:'POST', headers: { Authorization: `Bearer ${session?.access_token}`, 'Content-Type':'application/json' },
        body: JSON.stringify({ licitatie_id: l.id }),
      })
      const j = await r.json()
      if (!j.ok) throw new Error(j.error || 'eroare necunoscută')
      const { data } = await supabase.from('ofertare_verificari').select('*').eq('id', j.verificare_id).single()
      setUltima(data)
    } catch (e) { setErr(String(e?.message || e)) } finally { setBusy(false) }
  }

  const VC = { verde:['🟢 VERDE — depunere sigură', G.green], galben:['🟡 GALBEN — de rezolvat punctele înainte de depunere', G.yellow], rosu:['🔴 ROȘU — NU se depune', G.red] }
  const arb = ultima?.raport?.arbitru || {}
  const [vLbl, vCol] = VC[ultima?.verdict] || ['— nerulată încă', G.dim]

  return (
    <div style={{ marginTop:16, padding:14, borderRadius:10, border:`1px solid ${vCol}55`, background:G.bg }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
        <div style={{ fontSize:13, fontWeight:800 }}>🔍 Verificare finală (anti-descalificare)</div>
        <span style={{ fontSize:12.5, fontWeight:800, color:vCol }}>{vLbl}</span>
        {ultima && <span style={{ fontSize:11, color:G.dim }}>rulată {new Date(ultima.created_at).toLocaleString('ro-RO')}</span>}
        <button style={{ ...S.btnP, marginLeft:'auto', padding:'6px 13px', fontSize:12, opacity: busy ? .6 : 1 }} disabled={busy} onClick={ruleaza}>
          {busy ? '⏳ Rulează cele 3 treceri…' : (ultima ? '🔁 Rulează din nou' : '🔍 Rulează verificarea')}
        </button>
      </div>
      {err && <div style={{ marginTop:8, fontSize:12.5, color:G.red }}>Eroare: {err}</div>}
      {ultima && (
        <div style={{ marginTop:10, fontSize:12.5 }}>
          {arb.motivare && <div style={{ color:G.muted, marginBottom:8 }}>{arb.motivare}</div>}
          {(arb.probleme_critice || []).map((p, i) => (
            <div key={i} style={{ padding:'6px 10px', marginBottom:5, borderRadius:7, background:G.surface, borderLeft:`3px solid ${vCol}` }}>
              <b>{p.titlu}</b>{p.actiune ? <span style={{ color:G.muted }}> — {p.actiune}</span> : null}
            </div>
          ))}
          {(arb.puncte_de_verificat_de_om || []).length > 0 && (
            <div style={{ marginTop:8 }}>
              <div style={{ fontWeight:800, fontSize:12, color:G.orange, marginBottom:4 }}>👤 De verificat de om:</div>
              {(arb.puncte_de_verificat_de_om || []).map((p, i) => <div key={i} style={{ color:G.muted, padding:'2px 0' }}>• {p}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── 📅 Radar sezonier (#39) — tiparul atribuirilor per autoritate + CPV ──────
// Sursa: v_radar_sezonier (atribuirile Gazpet + competitori din ofertare_participari).
// Autoritățile cu ani_distincti >= 2 au tipar de reapariție — luna tipică = când să fii pe fază.
function RadarSezonier() {
  const [rows, setRows] = useState(null)
  useEffect(() => {
    supabase.from('v_radar_sezonier').select('*').gte('ani_distincti', 2)
      .order('nr_atribuiri', { ascending:false }).limit(60)
      .then(({ data }) => setRows(data || []))
  }, [])
  const LUNI = ['', 'ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie']
  const lunaCurenta = new Date().getMonth() + 1
  if (rows === null) return <div style={{ padding:30, textAlign:'center', color:G.muted }}>Se încarcă tiparul sezonier...</div>
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
      <div style={{ fontSize:12, color:G.muted }}>
        Autorități cu atribuiri repetate pe același CPV (din istoricul Gazpet + competitori) — luna tipică arată când se atribuie de obicei, deci anunțurile apar cu ~2-4 luni înainte. Rândurile aprinse sunt în fereastra activă acum.
      </div>
      {rows.map((r, i) => {
        const activ = r.luna_tipica != null && [0, 1, 2, 3].includes((r.luna_tipica - lunaCurenta + 12) % 12)
        return (
          <div key={i} style={{ ...S.card, padding:'10px 16px', display:'flex', alignItems:'center', gap:12, flexWrap:'wrap', fontSize:13, borderLeft:`3px solid ${activ ? G.yellow : G.border2}` }}>
            {activ && <span title="Fereastra de atribuire se apropie — anunțul e probabil deja în lucru la autoritate">🔥</span>}
            <span style={{ fontWeight:700, flex:1, minWidth:240 }}>{r.autoritate}</span>
            <span style={{ color:G.muted, fontSize:12 }} title={r.cpv_exemplu}>{r.cpv_cod}</span>
            <span style={{ color:G.blue }}>{r.nr_atribuiri} atribuiri · {r.ani_distincti} ani ({r.ani?.[0]}–{r.ani?.[r.ani.length - 1]})</span>
            <span style={{ color:G.yellow, fontWeight:700 }}>vârf: {LUNI[r.luna_tipica] || '—'}</span>
            <span style={{ color:G.muted, fontSize:12 }}>{fmtVal(r.total_mil_ron)} mil lei</span>
          </div>
        )
      })}
    </div>
  )
}
