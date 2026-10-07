// ════════════════════════════════════════════════════════════════
// HR → „📜 Decizii": registrul deciziilor HR (spec docs/HR/GENERATOR_DECIZII_SPEC.md §4, §7; PR3).
// Registru + filtre, antetul anului (contor + emitenți), „De rezolvat", istoric pe decizie, rezervare de număr,
// anulare, scan semnat (și de pe telefon, HrDeciziiScan), generatorul (HrDeciziiGenerator).
// Drepturile le decide serverul (fn_hr_decizii_poate, fail-closed); aici doar se ascund butoanele.
// Deep-link: /hr?tab=decizii&scan=<id> deschide direct scanul deciziei (VA30).
// ════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from './lib/supabase.js'
import HrDeciziiScan from './HrDeciziiScan.jsx'
import HrDeciziiGenerator from './HrDeciziiGenerator.jsx'
import { nrAfisat } from './hrDeciziiUtil.js'
import { rpc, drepturi, deschidePdf, uuid, fmtData, azi, numeAfis, mesajEroare, STARI } from './hrDeciziiFlux.js'

const G = {
  bg:'#0D1117', surface:'#161B22', card:'#161B22', text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681', border:'#30363D',
  blue:'#1F6FEB', green:'#2EA043', yellow:'#D29922', orange:'#F0883E', red:'#F85149', purple:'#A371F7', hr:'#EC6CB9',
  greenDim:'#0F2A1E', redDim:'#3F1A1F', yellowDim:'#332100', blueDim:'#0F1F3F',
}
const S = {
  card: { background:G.card, borderRadius:12, border:`1px solid ${G.border}` },
  input: { width:'100%', boxSizing:'border-box', background:G.bg, border:`1px solid ${G.border}`, borderRadius:8, padding:'9px 12px', color:G.text, fontSize:13, outline:'none' },
  btnP: { padding:'9px 16px', background:G.hr, color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:600 },
  btnS: { padding:'8px 14px', background:G.surface, color:G.text, border:`1px solid ${G.border}`, borderRadius:8, cursor:'pointer', fontSize:13 },
  btnMic: { padding:'4px 9px', background:G.bg, color:G.text, border:`1px solid ${G.border}`, borderRadius:6, cursor:'pointer', fontSize:12, whiteSpace:'nowrap' },
}
const th = { padding:'9px 10px', textAlign:'left', fontSize:11, fontWeight:700, color:G.muted, textTransform:'uppercase', letterSpacing:.4, whiteSpace:'nowrap' }
const td = { padding:'8px 10px', verticalAlign:'top', fontSize:12.5, borderTop:`1px solid ${G.border}` }
const ACTIUNI = ['citire', 'redactare', 'emitere', 'rezervare', 'scan', 'anulare', 'import', 'contor', 'owner']
const RSVTI_EMPLOYEE_ID = 81   // Adeverințe legător (G6, până la v2)

export default function HrDecizii({ profile, showToast }) {
  const loc = useLocation(), nav = useNavigate()
  const [drept, setDrept] = useState(null)
  const [dec, setDec] = useState([])
  const [tipuri, setTipuri] = useState([])
  const [semnatari, setSemnatari] = useState([])
  const [angajati, setAngajati] = useState([])
  const [proiecte, setProiecte] = useState([])
  const [contor, setContor] = useState([])
  const [emitenti, setEmitenti] = useState([])
  const [propuneri, setPropuneri] = useState([])
  const [load, setLoad] = useState(true)
  const [err, setErr] = useState('')
  const [f, setF] = useState({ an: String(new Date().getFullYear()), stare: '', tip: '', origine: '', q: '' })
  const [scan, setScan] = useState(null)            // {d, inlocuire}
  const [gen, setGen] = useState(null)              // {initial}
  const [rezerva, setRezerva] = useState(false)
  const [istoric, setIstoric] = useState(null)
  const [contorOp, setContorOp] = useState(null)    // 'init' | 'opreste' | 'corecteaza' | 'baza'
  const [deRez, setDeRez] = useState(false)
  const [mesaj, setMesaj] = useState('')

  const anCurent = new Date().getFullYear()

  const incarca = useCallback(async () => {
    setLoad(true); setErr('')
    try {
      const d = await drepturi(ACTIUNI)
      setDrept(d)
      if (!d.citire) { setLoad(false); return }
      const [rd, rt, rs, re, rp, rc, rem, rprop] = await Promise.all([
        supabase.from('hr_decizii').select('*').order('an', { ascending: false, nullsFirst: true }).order('numar', { ascending: false, nullsFirst: true }).order('id', { ascending: false }),
        supabase.from('hr_decizii_tipuri').select('*').order('ordine'),
        supabase.from('hr_decizii_semnatari').select('*').order('ordine'),
        supabase.from('employees').select('id, name, active, termination_date, position, functie').order('name'),
        supabase.from('executie_proiecte').select('id, nume, activ, nr_contract, data_contract, data_termen').order('nume'),
        supabase.from('hr_decizii_contor').select('*').order('an', { ascending: false }),
        supabase.rpc('fn_hr_decizii_emitenti'),
        supabase.from('executie_completari_propuse').select('id, proiect_id, camp, valoare_afisata, sursa, status, hr_decizie_id, created_at').not('hr_decizie_id', 'is', null).eq('status', 'propus'),
      ])
      if (rd.error) throw rd.error
      setDec(rd.data || []); setTipuri(rt.data || []); setSemnatari(rs.data || []); setAngajati(re.data || [])
      setProiecte(rp.data || []); setContor(rc.data || []); setEmitenti(rem.data || []); setPropuneri(rprop.data || [])
    } catch (e) { setErr(mesajEroare(e)) } finally { setLoad(false) }
  }, [])
  useEffect(() => { incarca() }, [incarca])

  const emp = useMemo(() => Object.fromEntries(angajati.map(e => [e.id, e])), [angajati])
  const tipDe = useMemo(() => Object.fromEntries(tipuri.map(t => [t.cod, t])), [tipuri])
  const proiectDe = useMemo(() => Object.fromEntries(proiecte.map(p => [p.id, p])), [proiecte])
  const decDe = useMemo(() => Object.fromEntries(dec.map(x => [x.id, x])), [dec])
  const semnDe = useMemo(() => Object.fromEntries(semnatari.map(s => [s.id, { ...s, nume: numeAfis(emp[s.employee_id]?.name) }])), [semnatari, emp])

  // rândul îmbogățit pentru afișare
  const randuri = useMemo(() => dec.map(d => ({
    ...d,
    nr_afisat: nrAfisat(d),
    pers: d.snapshot?.persoana?.nume || (d.employee_id ? numeAfis(emp[d.employee_id]?.name) : d.persoana_nume) || '—',
    employee_nume: emp[d.employee_id]?.name,
    semn: d.snapshot?.semnatar?.nume || semnDe[d.semnatar_id]?.nume || '—',
    proiect: d.nivel === 'proiect' ? (d.proiect_denumire || proiectDe[d.proiect_id]?.nume || `#${d.proiect_id}`) : 'firmă',
    tinta: d.inlocuieste_id || d.revoca_id ? decDe[d.inlocuieste_id || d.revoca_id] : null,
    dupa: dec.find(x => (x.inlocuieste_id === d.id || x.revoca_id === d.id) && !['draft', 'anulata'].includes(x.stare)),
  })), [dec, emp, semnDe, proiectDe, decDe])

  const filtrate = useMemo(() => {
    const q = f.q.trim().toLowerCase()
    return randuri.filter(d =>
      (!f.an || (d.an == null ? d.stare === 'draft' : String(d.an) === f.an)) &&
      (!f.stare || d.stare === f.stare) && (!f.tip || d.tip_cod === f.tip) && (!f.origine || d.origine === f.origine) &&
      (!q || `${d.nr_afisat} ${d.pers} ${d.proiect} ${d.eticheta_functie} ${d.descriere || ''}`.toLowerCase().includes(q)))
  }, [randuri, f])

  // „De rezolvat" (C45)
  const rezolvat = useMemo(() => {
    const prag = Date.now() - 7 * 864e5
    const nesemnate = randuri.filter(d => d.stare === 'emisa' && d.origine !== 'import' && d.emis_la && new Date(d.emis_la).getTime() < prag)
    const faraPdf = randuri.filter(d => d.stare === 'emisa' && d.origine === 'platforma' && !d.pdf_path)
    const importuri = randuri.filter(d => d.stare === 'emisa' && d.origine === 'import')
    const goluri = []
    for (const c of contor.filter(c => c.serie === 'HR' && c.ultimul_initial != null)) {
      const ocupate = new Set(dec.filter(d => d.serie === 'HR' && d.an === c.an && d.numar != null).map(d => d.numar))
      for (let n = c.ultimul_initial + 1; n <= c.ultimul && goluri.length < 200; n++) if (!ocupate.has(n)) goluri.push(`${n}/${c.an}`)
    }
    const g6 = randuri.filter(d => d.tip_cod === 'RSVTI' && d.stare === 'semnata' && d.employee_id && d.employee_id !== RSVTI_EMPLOYEE_ID)
    return { nesemnate, faraPdf, importuri, goluri, g6, propuneri, total: nesemnate.length + faraPdf.length + importuri.length + goluri.length + g6.length + propuneri.length }
  }, [randuri, contor, dec, propuneri])

  // Deep-link ?scan=<id> (VA30): după ce se știu dreptul și decizia; se scoate din URL ca să nu se redeschidă la refresh.
  useEffect(() => {
    const sp = new URLSearchParams(loc.search)
    const id = Number(sp.get('scan'))
    if (!id || load || !drept) return
    sp.delete('scan')
    nav({ pathname: loc.pathname, search: sp.toString() ? '?' + sp.toString() : '' }, { replace: true })
    const d = randuri.find(x => x.id === id)
    if (!d) { setMesaj(`Decizia #${id} nu există sau nu ai acces la ea.`); return }
    if (!drept.scan) { setMesaj('Nu ai drept de încărcare a scanului.'); return }
    if (d.stare === 'emisa') setScan({ d, inlocuire: false })
    else if (d.stare === 'semnata') setMesaj(`Decizia nr ${d.nr_afisat} e deja semnată (${fmtData(d.scan_la?.slice(0, 10))}).`)
    else setMesaj(`Decizia nr ${d.nr_afisat || '#' + d.id} e ${STARI[d.stare]?.t || d.stare}; scanul nu se mai încarcă.`)
  }, [loc.search, load, drept, randuri, loc.pathname, nav])

  async function anuleaza(d) {
    const motiv = window.prompt(`Anulezi decizia nr ${d.nr_afisat}? Numărul rămâne ocupat.\nMotivul (obligatoriu; pentru o rezervare nefolosită: „număr nefolosit”):`)
    if (!motiv?.trim()) return
    try { await rpc('fn_hr_decizie_anuleaza', { p_id: d.id, p_motiv: motiv.trim() }); showToast?.('Decizie anulată'); incarca() }
    catch (e) { showToast?.(mesajEroare(e), 'error') }
  }
  async function stergeDraft(d) {
    if (!window.confirm('Ștergi draftul? (rămâne în jurnal)')) return
    const { error } = await supabase.from('hr_decizii').delete().eq('id', d.id)
    if (error) showToast?.(mesajEroare(error), 'error'); else { showToast?.('Draft șters'); incarca() }
  }
  const deschide = async path => { try { await deschidePdf(path) } catch (e) { showToast?.(mesajEroare(e), 'error') } }

  if (load && !drept) return <div style={{ padding:30, color:G.muted }}>Se încarcă registrul…</div>
  if (drept && !drept.citire) return <div style={{ padding:30, color:G.muted }}>Nu ai acces la registrul deciziilor.</div>

  const cAn = contor.find(c => c.serie === 'HR' && c.an === anCurent)
  const ani = [...new Set([anCurent, ...dec.map(d => d.an).filter(Boolean)])].sort((a, b) => b - a)
  const lant = d => d.tinta ? `${d.inlocuieste_id ? 'înlocuiește' : 'revocă'} ${d.tinta.numar != null ? nrAfisat(d.tinta) : '#' + d.tinta.id}`
    : d.dupa ? `${d.dupa.inlocuieste_id === d.id ? 'înlocuită de' : 'revocată de'} ${d.dupa.numar != null ? nrAfisat(d.dupa) : '#' + d.dupa.id}` : ''

  return (
    <div>
      {err && <div style={{ padding:10, background:G.redDim, color:'#ffb3ad', borderRadius:8, marginBottom:12 }}>{err}</div>}
      {mesaj && <div style={{ padding:10, background:G.blueDim, borderRadius:8, marginBottom:12, display:'flex', gap:8 }}><span style={{ flex:1 }}>{mesaj}</span><button style={S.btnMic} onClick={() => setMesaj('')}>✕</button></div>}

      {/* Antetul anului: contor + emitenți (VA21) */}
      <div style={{ ...S.card, padding:14, marginBottom:12, display:'flex', flexWrap:'wrap', gap:14, alignItems:'center' }}>
        <div style={{ fontSize:13 }}>
          <b>{anCurent}</b> · ultimul nr: <b>{cAn?.ultimul ?? '—'}</b> · automat: {cAn?.auto_permis
            ? <span style={{ color:G.green }}>pornit{cAn.initializat_la ? ` din ${fmtData(cAn.initializat_la.slice(0, 10))}` : ''}</span>
            : <span style={{ color:G.yellow }}>oprit</span>}
          {cAn?.baza_fizica != null && <span style={{ color:G.muted }}> · baza registrului fizic: {cAn.baza_fizica}</span>}
        </div>
        {drept?.contor && !cAn?.auto_permis && <button style={S.btnS} onClick={() => setContorOp('init')}>▶ Pornește numerotarea automată pentru {anCurent}</button>}
        {drept?.contor && cAn?.auto_permis && <button style={S.btnMic} onClick={() => setContorOp('opreste')}>⏸ Oprește automatul</button>}
        {drept?.owner && cAn && <button style={S.btnMic} onClick={() => setContorOp('corecteaza')}>Corectează contorul</button>}
        {drept?.owner && cAn?.baza_fizica != null && <button style={S.btnMic} onClick={() => setContorOp('baza')}>Corectează baza</button>}
        <div style={{ flex:1 }} />
        <div style={{ fontSize:12, color:G.muted }}>Emit: {emitenti.map(e => `${numeAfis(e.nume)} (${e.cale === 'department = HR' ? 'HR' : e.cale})`).join(', ') || '—'}</div>
      </div>

      {/* Acțiuni + filtre */}
      <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom:12, alignItems:'center' }}>
        {drept?.redactare && <button style={S.btnP} onClick={() => setGen({ initial: null })}>＋ Decizie nouă</button>}
        {drept?.rezervare && <button style={S.btnS} onClick={() => setRezerva(true)}>🔖 Rezervă număr</button>}
        <button style={{ ...S.btnS, borderColor: rezolvat.total ? G.yellow : G.border }} onClick={() => setDeRez(v => !v)}>⚠ De rezolvat ({rezolvat.total})</button>
        <div style={{ flex:1 }} />
        <select value={f.an} onChange={e => setF({ ...f, an: e.target.value })} style={{ ...S.input, width:'auto' }}>
          <option value="">toți anii</option>{ani.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={f.stare} onChange={e => setF({ ...f, stare: e.target.value })} style={{ ...S.input, width:'auto' }}>
          <option value="">toate stările</option>{Object.entries(STARI).map(([k, v]) => <option key={k} value={k}>{v.t}</option>)}
        </select>
        <select value={f.tip} onChange={e => setF({ ...f, tip: e.target.value })} style={{ ...S.input, width:'auto', maxWidth:200 }}>
          <option value="">toate tipurile</option>{tipuri.map(t => <option key={t.cod} value={t.cod}>{t.denumire}</option>)}
        </select>
        <select value={f.origine} onChange={e => setF({ ...f, origine: e.target.value })} style={{ ...S.input, width:'auto' }}>
          <option value="">orice origine</option><option value="platforma">generată</option><option value="rezervare">rezervare</option><option value="import">import</option>
        </select>
        <input placeholder="caută nr, persoană, proiect…" value={f.q} onChange={e => setF({ ...f, q: e.target.value })} style={{ ...S.input, width:220 }} />
      </div>

      {deRez && <DeRezolvat r={rezolvat} decDe={decDe} proiectDe={proiectDe} drept={drept} onScan={d => setScan({ d: randuri.find(x => x.id === d.id), inlocuire: false })} />}

      <div style={{ ...S.card, overflowX:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead><tr>
            <th style={th}>Nr / data</th><th style={th}>Funcție</th><th style={th}>Persoană</th><th style={th}>Proiect / firmă</th>
            <th style={th}>Semnatar</th><th style={th}>Stare</th><th style={th}>Nr.</th><th style={th}>Fișiere</th><th style={th}>Lanț</th><th style={th}></th>
          </tr></thead>
          <tbody>
            {filtrate.map(d => (
              <tr key={d.id}>
                <td style={td}><b>{d.nr_afisat || '—'}</b>{d.data_emitere && !d.numar && <div style={{ color:G.muted }}>{fmtData(d.data_emitere)}</div>}</td>
                <td style={td}>{d.eticheta_functie}{d.descriere && <div style={{ color:G.muted, fontSize:11.5 }}>{d.descriere}</div>}</td>
                <td style={td}>{d.titlu ? d.titlu + ' ' : ''}{d.pers}</td>
                <td style={td}>{d.proiect}</td>
                <td style={td}>{d.semn}</td>
                <td style={td}><span style={{ color: STARI[d.stare]?.c, fontWeight:600 }}>{STARI[d.stare]?.t || d.stare}</span>
                  {d.origine !== 'platforma' && <div style={{ color:G.muted, fontSize:11 }}>{d.origine}</div>}</td>
                <td style={td} title={d.mod_numar === 'manual' ? 'număr manual' : 'număr automat'}>{d.mod_numar === 'manual' ? 'M' : d.mod_numar === 'auto' ? 'A' : ''}</td>
                <td style={td}>
                  {d.pdf_path && <button style={S.btnMic} onClick={() => deschide(d.pdf_path)}>PDF</button>}{' '}
                  {d.scan_path && <button style={{ ...S.btnMic, color:G.green }} onClick={() => deschide(d.scan_path)}>scan ✓</button>}
                </td>
                <td style={{ ...td, color:G.muted, fontSize:11.5 }}>{lant(d)}</td>
                <td style={{ ...td, whiteSpace:'nowrap' }}>
                  <div style={{ display:'flex', gap:4, flexWrap:'wrap', justifyContent:'flex-end' }}>
                    {d.stare === 'draft' && drept?.redactare && <button style={S.btnMic} onClick={() => setGen({ initial: d })}>✎ Deschide</button>}
                    {d.stare === 'draft' && drept?.redactare && (d.creat_de === profile?.id || drept?.owner) && <button style={{ ...S.btnMic, color:G.red }} onClick={() => stergeDraft(d)}>Șterge</button>}
                    {d.stare === 'emisa' && drept?.scan && <button style={{ ...S.btnMic, borderColor:G.hr }} onClick={() => setScan({ d, inlocuire: false })}>📷 Scan semnat</button>}
                    {d.stare === 'emisa' && drept?.anulare && <button style={S.btnMic} onClick={() => anuleaza(d)}>Anulează</button>}
                    {d.stare === 'semnata' && !d.dupa && drept?.redactare && !['REVOCARE', 'ALTA_DECIZIE'].includes(d.tip_cod) && <>
                      <button style={S.btnMic} onClick={() => setGen({ initial: { preset: 'inlocuire', tinta: d } })}>Înlocuiește</button>
                      <button style={S.btnMic} onClick={() => setGen({ initial: { preset: 'revocare', tinta: d } })}>Revocă</button>
                    </>}
                    {d.stare === 'semnata' && drept?.owner && <button style={S.btnMic} onClick={() => setScan({ d, inlocuire: true })}>Înlocuiește scanul</button>}
                    <button style={S.btnMic} onClick={() => setIstoric(d)}>Istoric</button>
                  </div>
                </td>
              </tr>
            ))}
            {!filtrate.length && <tr><td style={{ ...td, color:G.muted, textAlign:'center', padding:24 }} colSpan={10}>{load ? 'Se încarcă…' : 'Nicio decizie pentru filtrele alese.'}</td></tr>}
          </tbody>
        </table>
      </div>

      {scan && <HrDeciziiScan decizie={scan.d} inlocuire={scan.inlocuire} showToast={showToast} onClose={() => { setScan(null); incarca() }} onDone={() => {}} />}
      {gen && <HrDeciziiGenerator initial={gen.initial} profile={profile} tipuri={tipuri} semnatari={semnatari} semnDe={semnDe} angajati={angajati}
        proiecte={proiecte} decizii={dec} showToast={showToast} onClose={() => { setGen(null); incarca() }} />}
      {rezerva && <Rezerva tipuri={tipuri} semnatari={semnatari} semnDe={semnDe} angajati={angajati} proiecte={proiecte} showToast={showToast}
        onClose={() => { setRezerva(false); incarca() }} />}
      {istoric && <Istoric d={istoric} onClose={() => setIstoric(null)} />}
      {contorOp && <ContorOp op={contorOp} an={anCurent} c={cAn} showToast={showToast} onClose={() => { setContorOp(null); incarca() }} />}
    </div>
  )
}

// ─── De rezolvat (C45) ─────────────────────────────────────────────
function DeRezolvat({ r, proiectDe, drept, onScan }) {
  const bloc = (titlu, items, render) => items.length ? (
    <div style={{ marginBottom:10 }}>
      <div style={{ fontWeight:700, fontSize:13, marginBottom:4 }}>{titlu} ({items.length})</div>
      <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>{items.map(render)}</div>
    </div>) : null
  const chip = (k, txt, onClick) => <button key={k} onClick={onClick} disabled={!onClick} style={{ ...S.btnMic, cursor: onClick ? 'pointer' : 'default' }}>{txt}</button>
  return (
    <div style={{ ...S.card, padding:14, marginBottom:12, borderColor:G.yellow }}>
      {!r.total && <div style={{ color:G.muted }}>Nimic de rezolvat.</div>}
      {bloc('Emise nesemnate de peste 7 zile', r.nesemnate, d => chip(d.id, `${d.nr_afisat} · ${d.pers}`, drept?.scan ? () => onScan(d) : null))}
      {bloc('PDF neînregistrat (regenerează din conținut la încărcarea scanului)', r.faraPdf, d => chip(d.id, d.nr_afisat, drept?.scan ? () => onScan(d) : null))}
      {bloc('Importuri fără scan', r.importuri, d => chip(d.id, `${d.nr_afisat} · ${d.pers}`, drept?.scan ? () => onScan(d) : null))}
      {bloc('Propuneri de efect neconfirmate (Execuție → Completări propuse)', r.propuneri, p => chip(p.id, `${proiectDe[p.proiect_id]?.nume || '#' + p.proiect_id}: ${p.camp} → ${p.valoare_afisata}`))}
      {bloc('Goluri în registru (după inițializare)', r.goluri.map((g, i) => ({ id: i, g })), x => chip(x.id, x.g))}
      {bloc('G6: RSVTI din decizia activă ≠ cel din Adeverințe', r.g6, d => chip(d.id, `${d.nr_afisat} · ${d.pers}`))}
    </div>
  )
}

// ─── Istoric pe decizie ────────────────────────────────────────────
function Istoric({ d, onClose }) {
  const [ev, setEv] = useState(null)
  useEffect(() => {
    supabase.from('hr_decizii_evenimente').select('*').eq('decizie_id', d.id).order('la').then(({ data, error }) => setEv(error ? [] : data || []))
  }, [d.id])
  return (
    <Modal titlu={`Istoric — ${d.nr_afisat || 'draft #' + d.id}`} onClose={onClose} lat>
      {!ev ? <div style={{ color:G.muted }}>Se încarcă…</div> : !ev.length ? <div style={{ color:G.muted }}>Fără evenimente.</div> : ev.map(e => (
        <div key={e.id} style={{ padding:'8px 0', borderBottom:`1px solid ${G.border}`, fontSize:12.5 }}>
          <b>{e.eveniment}</b>{e.stare_veche || e.stare_noua ? <span style={{ color:G.muted }}> · {e.stare_veche || '—'} → {e.stare_noua || '—'}</span> : null}
          <span style={{ color:G.muted }}> · {new Date(e.la).toLocaleString('ro-RO')}</span>
          {e.detalii && Object.keys(e.detalii).length > 0 && <pre style={{ margin:'4px 0 0', whiteSpace:'pre-wrap', wordBreak:'break-word', fontSize:11, color:G.muted }}>{JSON.stringify(e.detalii, null, 1)}</pre>}
        </div>
      ))}
      {Array.isArray(d.avertismente) && d.avertismente.length > 0 && (
        <div style={{ marginTop:12 }}>
          <div style={{ fontWeight:700, marginBottom:4 }}>Avertismente la emitere / rezervare</div>
          {d.avertismente.map((a, i) => <div key={i} style={{ fontSize:12.5 }}>{a.cod} {a.mesaj}{a.confirmat_la ? <span style={{ color:G.muted }}> · confirmat {new Date(a.confirmat_la).toLocaleString('ro-RO')}</span> : ''}</div>)}
        </div>
      )}
    </Modal>
  )
}

// ─── Contorul pe an (§4.G) ─────────────────────────────────────────
function ContorOp({ op, an, c, onClose, showToast }) {
  const [v, setV] = useState(op === 'corecteaza' ? String(c?.ultimul ?? '') : op === 'baza' ? String(c?.baza_fizica ?? '') : '')
  const [t, setT] = useState('')
  const [lucru, setLucru] = useState(false)
  const [err, setErr] = useState('')
  const cfg = {
    init: { titlu: `Pornește numerotarea automată pentru ${an}`, camp: 'Ultimul număr dat în registrul fizic', text: 'Sursa (cine a verificat și unde)',
      info: 'Verifică întâi registrul de hârtie (pentru 2026: ce s-a dat după 28.09) și rezervă/importă numerele găsite.',
      fn: () => rpc('fn_hr_decizii_contor_initializeaza', { p_an: an, p_ultimul_fizic: parseInt(v, 10), p_sursa: t.trim() }) },
    opreste: { titlu: `Oprește numerotarea automată pentru ${an}`, text: 'Motivul', info: 'Repornirea se face doar prin re-inițializare.',
      fn: () => rpc('fn_hr_decizii_contor_opreste_auto', { p_an: an, p_motiv: t.trim() }) },
    corecteaza: { titlu: `Corectează contorul ${an} (owner)`, camp: 'Noul „ultimul număr”', text: 'Motivul', info: 'Nu poate coborî sub cel mai mare număr folosit și nici sub baza registrului fizic.',
      fn: () => rpc('fn_hr_decizii_contor_corecteaza', { p_an: an, p_ultimul: parseInt(v, 10), p_motiv: t.trim() }) },
    baza: { titlu: `Corectează baza registrului fizic ${an} (owner)`, camp: 'Baza corectă', text: 'Motivul', info: 'Baza nu poate trece peste „ultimul”; ridică întâi contorul dacă e nevoie.',
      fn: () => rpc('fn_hr_decizii_contor_corecteaza_baza', { p_an: an, p_baza: parseInt(v, 10), p_motiv: t.trim() }) },
  }[op]
  const ok = (!cfg.camp || /^\d{1,5}$/.test(v)) && t.trim()
  async function go() {
    setLucru(true); setErr('')
    try { await cfg.fn(); showToast?.('Contor actualizat'); onClose() } catch (e) { setErr(mesajEroare(e)) } finally { setLucru(false) }
  }
  return (
    <Modal titlu={cfg.titlu} onClose={onClose}>
      <div style={{ fontSize:12.5, color:G.muted, marginBottom:10 }}>{cfg.info}</div>
      {cfg.camp && <label style={{ display:'block', marginBottom:10, fontSize:13 }}>{cfg.camp}<input value={v} onChange={e => setV(e.target.value.replace(/\D/g, ''))} inputMode="numeric" style={{ ...S.input, marginTop:4 }} /></label>}
      <label style={{ display:'block', marginBottom:10, fontSize:13 }}>{cfg.text}<input value={t} onChange={e => setT(e.target.value)} style={{ ...S.input, marginTop:4 }} /></label>
      {err && <div style={{ padding:8, background:G.redDim, borderRadius:8, fontSize:13, marginBottom:8 }}>{err}</div>}
      <button style={{ ...S.btnP, opacity: ok && !lucru ? 1 : .5 }} disabled={!ok || lucru} onClick={go}>{lucru ? 'Se salvează…' : 'Confirmă'}</button>
    </Modal>
  )
}

// ─── Rezervă număr (§4.F; regula de tranziție) ─────────────────────
function Rezerva({ tipuri, semnatari, semnDe, angajati, proiecte, onClose, showToast }) {
  const [cerereId] = useState(uuid)
  const [p, setP] = useState({ tip_cod: 'ALTA_DECIZIE', descriere: '', data_emitere: azi(), numar: '', nivel: 'firma', proiect_id: '', employee_id: '',
    persoana_nume: '', titlu: '', semnatar_id: '', eticheta_functie: '' })
  const [conf, setConf] = useState({ coduri: [], salt: false, cerute: [], cereSalt: false })
  const [lucru, setLucru] = useState(false)
  const [err, setErr] = useState('')
  const [rez, setRez] = useState(null)
  const tip = tipuri.find(t => t.cod === p.tip_cod)
  const numire = p.tip_cod !== 'ALTA_DECIZIE'
  const tipuriOk = tipuri.filter(t => t.activ && t.cod !== 'REVOCARE')
  const niveluri = tip?.nivel === 'ambele' ? ['firma', 'proiect'] : [tip?.nivel || 'firma']
  const set = (k, v) => setP(x => ({ ...x, [k]: v }))
  useEffect(() => { if (tip && !niveluri.includes(p.nivel)) set('nivel', niveluri[0]) }, [p.tip_cod])  // eslint-disable-line react-hooks/exhaustive-deps

  const payload = () => {
    const o = { cerere_id: cerereId, tip_cod: p.tip_cod, data_emitere: p.data_emitere, nivel: p.nivel }
    if (p.numar) o.numar = parseInt(p.numar, 10)
    if (p.descriere.trim()) o.descriere = p.descriere.trim()
    if (p.nivel === 'proiect' && p.proiect_id) o.proiect_id = Number(p.proiect_id)
    if (p.employee_id) o.employee_id = Number(p.employee_id); else if (p.persoana_nume.trim()) o.persoana_nume = p.persoana_nume.trim()
    if (p.titlu) o.titlu = p.titlu
    if (p.semnatar_id) o.semnatar_id = Number(p.semnatar_id)
    if (p.eticheta_functie.trim()) o.eticheta_functie = p.eticheta_functie.trim()
    if (conf.coduri.length) o.confirmari = conf.coduri
    if (conf.salt) o.confirm_salt = true
    return o
  }
  const valid = p.data_emitere && (numire ? (p.employee_id || p.persoana_nume.trim()) && p.semnatar_id && p.titlu : p.descriere.trim()) && (p.nivel !== 'proiect' || p.proiect_id)

  async function go() {
    setLucru(true); setErr('')
    try {
      const r = await rpc('fn_hr_decizie_rezerva', { p_payload: payload() })
      setRez(r); showToast?.(`Număr rezervat: ${r.nr_afisat}`)
    } catch (e) {
      const m = mesajEroare(e)
      const cer = m.match(/confirmari necesare: ([A-Z0-9_, ]+)/)
      if (cer) setConf(c => ({ ...c, cerute: cer[1].split(',').map(s => s.trim()).filter(Boolean) }))
      if (/salt_mare/.test(m)) setConf(c => ({ ...c, cereSalt: true }))
      setErr(m)
    } finally { setLucru(false) }
  }

  if (rez) return (
    <Modal titlu="Număr rezervat" onClose={onClose}>
      <div style={{ fontSize:28, fontWeight:800, color:G.hr, margin:'8px 0' }}>{rez.nr_afisat}</div>
      <div style={{ fontSize:13, color:G.muted }}>Trece numărul în documentul Word. După semnare, încarcă scanul din registru (📷 Scan semnat) sau anulează rezervarea dacă nu ai folosit numărul.</div>
      {Array.isArray(rez.avertismente) && rez.avertismente.length > 0 && <div style={{ marginTop:10, fontSize:12.5 }}>{rez.avertismente.map((a, i) => <div key={i}>{a.cod} {a.mesaj}</div>)}</div>}
      <button style={{ ...S.btnS, marginTop:14 }} onClick={onClose}>Închide</button>
    </Modal>
  )

  return (
    <Modal titlu="Rezervă număr din registru" onClose={onClose}>
      <div style={{ fontSize:12.5, color:G.muted, marginBottom:12 }}>Regula de tranziție: orice decizie HR făcută încă în Word își ia numărul de aici sau din generator, niciodată din registrul de hârtie.</div>
      <L t="Tipul"><select value={p.tip_cod} onChange={e => set('tip_cod', e.target.value)} style={S.input}>{tipuriOk.map(t => <option key={t.cod} value={t.cod}>{t.denumire}</option>)}</select></L>
      <L t={numire ? 'Descriere (opțional)' : 'Descriere (obligatoriu)'}><input value={p.descriere} onChange={e => set('descriere', e.target.value)} style={S.input} /></L>
      {p.tip_cod === 'ALTA_DECIZIE' && <L t="Eticheta (ex. Pază, Gestionar, Împuternicire)"><input value={p.eticheta_functie} onChange={e => set('eticheta_functie', e.target.value)} style={S.input} /></L>}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
        <L t="Data emiterii"><input type="date" value={p.data_emitere} max={azi()} onChange={e => set('data_emitere', e.target.value)} style={S.input} /></L>
        <L t="Număr manual (gol = automat)"><input value={p.numar} onChange={e => set('numar', e.target.value.replace(/\D/g, ''))} inputMode="numeric" style={S.input} /></L>
      </div>
      {niveluri.length > 1 && <L t="Nivel"><select value={p.nivel} onChange={e => set('nivel', e.target.value)} style={S.input}><option value="firma">firmă</option><option value="proiect">proiect</option></select></L>}
      {p.nivel === 'proiect' && <L t="Proiectul"><select value={p.proiect_id} onChange={e => set('proiect_id', e.target.value)} style={S.input}>
        <option value="">— alege —</option>{proiecte.filter(x => x.activ).map(x => <option key={x.id} value={x.id}>{x.nume}</option>)}</select></L>}
      <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:10 }}>
        <L t={numire ? 'Persoana (obligatoriu)' : 'Persoana (opțional)'}><select value={p.employee_id} onChange={e => set('employee_id', e.target.value)} style={S.input}>
          <option value="">— angajat —</option>{angajati.filter(a => a.active !== false).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></L>
        <L t="Titlu"><select value={p.titlu} onChange={e => set('titlu', e.target.value)} style={S.input}><option value="">—</option><option>Dl.</option><option>D-na</option></select></L>
      </div>
      {!p.employee_id && <L t="…sau nume extern"><input value={p.persoana_nume} onChange={e => set('persoana_nume', e.target.value)} style={S.input} /></L>}
      <L t={numire ? 'Semnatarul (obligatoriu)' : 'Semnatarul (opțional)'}><select value={p.semnatar_id} onChange={e => set('semnatar_id', e.target.value)} style={S.input}>
        <option value="">—</option>{semnatari.filter(s => s.activ).map(s => <option key={s.id} value={s.id}>{semnDe[s.id]?.nume} — {s.calitate}</option>)}</select></L>
      {(conf.cerute.length > 0 || conf.cereSalt) && (
        <div style={{ padding:10, background:G.yellowDim, borderRadius:8, marginBottom:10, fontSize:13 }}>
          {conf.cerute.map(c => <label key={c} style={{ display:'block' }}><input type="checkbox" checked={conf.coduri.includes(c)}
            onChange={e => setConf(x => ({ ...x, coduri: e.target.checked ? [...x.coduri, c] : x.coduri.filter(y => y !== c) }))} /> Confirm avertismentul {c}</label>)}
          {conf.cereSalt && <label style={{ display:'block' }}><input type="checkbox" checked={conf.salt} onChange={e => setConf(x => ({ ...x, salt: e.target.checked }))} /> Confirm saltul mare de număr (R7)</label>}
        </div>
      )}
      {err && <div style={{ padding:8, background:G.redDim, borderRadius:8, fontSize:13, marginBottom:8 }}>{err}</div>}
      <button style={{ ...S.btnP, opacity: valid && !lucru ? 1 : .5 }} disabled={!valid || lucru} onClick={go}>{lucru ? 'Se rezervă…' : 'Rezervă numărul'}</button>
    </Modal>
  )
}

// Etichetă de câmp la nivel de modul (definită în componentă s-ar recrea la fiecare randare și inputul ar pierde focusul).
export const L = ({ t, children }) => <label style={{ display:'block', marginBottom:10, fontSize:13 }}>{t}<div style={{ marginTop:4 }}>{children}</div></label>

export function Modal({ titlu, children, onClose, lat = false }) {
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.7)', zIndex:900, display:'flex', justifyContent:'center', alignItems:'flex-start', overflowY:'auto' }} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ ...S.card, width:'100%', maxWidth: lat ? 760 : 520, margin:'32px 12px', padding:18, color:G.text, boxSizing:'border-box' }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:12, gap:8 }}>
          <div style={{ fontWeight:700, fontSize:15 }}>{titlu}</div>
          <button style={S.btnMic} onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}
