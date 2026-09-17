// ─────────────────────────────────────────────────────────────────────────────
// ORGANIGRAMA — PROPUNERI (PROVIZORIU, 17.09.2026)
//
// Cerut de Silviu prin Răzvan: până se face organigrama propriu-zisă (departamente
// și subdepartamente, cu persoanele TESA folosite la licitații, autorizațiile lor
// vizibile în format fizic, export direct în propunerea tehnică și legătură cu
// REGES pentru răspunsul la clarificări), colegii au nevoie de un loc unde să
// scrie CE denumiri și funcții sunt de fapt corecte. Aici se strânge varianta lor;
// de acolo se preia structura finală.
//
// Deliberat simplu: un rând = o propunere, cu număr de ordine ca să poată fi citat
// în discuție (modelul „Inventar Corecții"). Nimic nu se aplică automat nicăieri —
// propunerea se acceptă sau se respinge de owner, iar preluarea în organigramă e un
// pas separat. Fișierul, ruta și tabelul se șterg la finalul proiectului.
//
// Acces: oricine e logat vede și propune (așa a fost cerut — „să poată propune toți").
// Deciziile (acceptă/respinge) le dă doar ownerul; RLS ține regula și pe server, nu
// doar aici în ecran.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from './lib/supabase.js'
import * as XLSX from 'xlsx-js-style'

const G = {
  bg:'#0D1117', surface:'#161B22', border:'#30363D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  orange:'#F0883E', purple:'#A371F7', blue:'#58A6FF',
  green:'#3FB950', yellow:'#D29922', red:'#F85149', teal:'#56D4DD',
}
const S = {
  page: { padding:'20px 22px', minHeight:'calc(100vh - 60px)', background:G.bg, color:G.text, fontFamily:'-apple-system,BlinkMacSystemFont,Inter,sans-serif' },
  card: { background:G.surface, borderRadius:12, border:`1px solid ${G.border}` },
  input:{ background:G.bg, border:`1px solid ${G.border}`, color:G.text, borderRadius:8, padding:'7px 11px', fontFamily:'inherit', fontSize:13, outline:'none', width:'100%' },
  btnP: { padding:'7px 13px', background:G.teal, color:'#0D1117', border:'none', borderRadius:8, cursor:'pointer', fontSize:12.5, fontWeight:800 },
  btnS: { padding:'6px 11px', background:'transparent', color:G.text, border:`1px solid ${G.border}`, borderRadius:8, cursor:'pointer', fontSize:12.5, fontWeight:600 },
  chip: (on, c) => ({ padding:'5px 11px', borderRadius:16, border:`1px solid ${on?c:G.border}`, background:on?c+'22':'transparent', color:on?c:G.muted, cursor:'pointer', fontSize:12.5, fontWeight:600, whiteSpace:'nowrap' }),
  th:   { textAlign:'left', padding:'8px 9px', fontSize:11, fontWeight:800, color:G.muted, textTransform:'uppercase', letterSpacing:.4, borderBottom:`1px solid ${G.border}`, whiteSpace:'nowrap' },
  td:   { padding:'7px 9px', fontSize:12.5, borderBottom:`1px solid ${G.border}55`, verticalAlign:'top' },
}

const ST = {
  propunere: { label:'de decis',  color:G.yellow, icon:'○' },
  acceptata: { label:'acceptată', color:G.green,  icon:'✔' },
  respinsa:  { label:'respinsă',  color:G.dim,    icon:'✕' },
}
// Rolurile pe care le cer autoritățile — lista scurtă, ca să nu scrie fiecare altfel
// același lucru și să nu mai putem grupa după ele la propunerea tehnică.
const ROLURI = ['—', 'Manager de proiect', 'Șef de șantier', 'RTE', 'CQ / Responsabil calitate',
  'Responsabil SSM', 'Inginer execuție', 'Topograf', 'Deviz / Ofertare', 'Altul']

const fmtZi = (d) => d ? new Date(d).toLocaleDateString('ro-RO', { day:'2-digit', month:'2-digit', year:'numeric' }) : '—'
const gol = (v) => !String(v || '').trim()

export default function OrganigramaPropuneri({ profile }) {
  const [randuri, setRanduri] = useState([])
  const [employees, setEmployees] = useState([])
  const [autori, setAutori] = useState({})
  const [loading, setLoading] = useState(true)
  const [eroare, setEroare] = useState(null)
  const [mesaj, setMesaj] = useState(null)
  const [filtru, setFiltru] = useState('toate')
  const [cauta, setCauta] = useState('')
  const [nou, setNou] = useState(null)
  const [salvez, setSalvez] = useState(false)

  const esteOwner = !!profile?.is_owner

  const incarca = useCallback(async () => {
    setLoading(true); setEroare(null)
    const [{ data: p, error: eP }, { data: e, error: eE }, { data: pr }] = await Promise.all([
      supabase.from('organigrama_propuneri')
        .select('*, emp:employees(id, name, functie, functie_cim, departament_hr, department)')
        .eq('activ', true).order('nr', { ascending: false }).limit(2000),
      supabase.from('employees').select('id, name, functie, functie_cim, departament_hr, department, active')
        .eq('active', true).order('name').limit(500),
      supabase.from('profiles').select('id, name').limit(500),
    ])
    if (eP || eE) { setEroare((eP || eE).message); setLoading(false); return }
    setRanduri(p || []); setEmployees(e || [])
    setAutori(Object.fromEntries((pr || []).map(x => [x.id, x.name])))
    setLoading(false)
  }, [])
  useEffect(() => { incarca() }, [incarca])

  // Un rând nou pornește PRECOMPLETAT cu ce știe deja platforma despre om, ca să se
  // vadă de la ce se pleacă — altfel fiecare rescrie de la zero și nu mai știm ce s-a schimbat.
  const startNou = (emp = null) => setNou({
    employee_id: emp?.id || '', nume_liber: '',
    departament: emp?.departament_hr || emp?.department || '',
    subdepartament: '', functie: emp?.functie || emp?.functie_cim || '',
    rol_licitatii: '—', tesa: false, observatii: '',
  })

  const alegeAngajat = (id) => {
    const emp = employees.find(x => String(x.id) === String(id))
    setNou(n => ({ ...n, employee_id: id,
      departament: gol(n.departament) ? (emp?.departament_hr || emp?.department || '') : n.departament,
      functie: gol(n.functie) ? (emp?.functie || emp?.functie_cim || '') : n.functie }))
  }

  const salveaza = async () => {
    if (!nou) return
    if (!nou.employee_id && gol(nou.nume_liber)) { setEroare('Alege un angajat sau scrie o poziție liberă'); return }
    if (gol(nou.departament) && gol(nou.functie)) { setEroare('Scrie măcar departamentul sau funcția — altfel propunerea n-are ce spune'); return }
    setSalvez(true); setEroare(null)
    const { error } = await supabase.from('organigrama_propuneri').insert({
      employee_id: nou.employee_id || null,
      nume_liber: gol(nou.nume_liber) ? null : nou.nume_liber.trim(),
      departament: gol(nou.departament) ? null : nou.departament.trim(),
      subdepartament: gol(nou.subdepartament) ? null : nou.subdepartament.trim(),
      functie: gol(nou.functie) ? null : nou.functie.trim(),
      rol_licitatii: (nou.rol_licitatii === '—' || gol(nou.rol_licitatii)) ? null : nou.rol_licitatii,
      tesa: nou.tesa, observatii: gol(nou.observatii) ? null : nou.observatii.trim(),
      propus_de: profile?.id || null,
    })
    setSalvez(false)
    if (error) { setEroare('Nu s-a salvat: ' + error.message); return }
    setNou(null); setMesaj('Propunere adăugată'); incarca()
  }

  const decide = async (r, status) => {
    if (!esteOwner) return
    const motiv = status === 'respinsa' ? (prompt('De ce se respinge? (opțional)') || null) : null
    const { error } = await supabase.from('organigrama_propuneri')
      .update({ status, decis_de: profile?.id || null, decis_la: new Date().toISOString(), decizie_motiv: motiv })
      .eq('id', r.id)
    if (error) setEroare('Nu s-a putut: ' + error.message)
    else { setMesaj(`#${r.nr} → ${ST[status].label}`); incarca() }
  }

  const sterge = async (r) => {
    if (!confirm(`Ștergi propunerea #${r.nr}?`)) return
    const { error } = await supabase.from('organigrama_propuneri').update({ activ: false }).eq('id', r.id)
    if (error) setEroare('Nu s-a putut: ' + error.message)
    else { setMesaj(`#${r.nr} ștearsă`); incarca() }
  }

  const numeRand = (r) => r.emp?.name || r.nume_liber || '—'
  const vizibile = useMemo(() => {
    const q = cauta.trim().toLowerCase()
    return randuri.filter(r => {
      if (filtru !== 'toate' && r.status !== filtru) return false
      if (!q) return true
      return [numeRand(r), r.departament, r.subdepartament, r.functie, r.rol_licitatii, r.observatii]
        .some(v => String(v || '').toLowerCase().includes(q))
    })
  }, [randuri, filtru, cauta])

  const nrPe = (s) => randuri.filter(r => r.status === s).length

  // Exportul e pentru mine: varianta acceptată, gata de preluat în organigrama reală.
  const exporta = () => {
    const sursa = vizibile.length ? vizibile : randuri
    if (!sursa.length) { setEroare('Nimic de exportat'); return }
    const rows = sursa.map(r => ({
      'Nr': r.nr, 'Persoană / poziție': numeRand(r),
      'Funcție acum (platformă)': r.emp?.functie || r.emp?.functie_cim || '—',
      'Departament acum (platformă)': r.emp?.departament_hr || r.emp?.department || '—',
      'DEPARTAMENT propus': r.departament || '—', 'SUBDEPARTAMENT propus': r.subdepartament || '—',
      'FUNCȚIE propusă': r.functie || '—', 'Rol la licitații': r.rol_licitatii || '—',
      'TESA': r.tesa ? 'da' : 'nu', 'Observații': r.observatii || '—',
      'Status': ST[r.status]?.label || r.status, 'Propus de': autori[r.propus_de] || '—',
      'Propus la': fmtZi(r.propus_la), 'Motiv respingere': r.decizie_motiv || '—',
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = [{wch:6},{wch:30},{wch:24},{wch:22},{wch:22},{wch:22},{wch:28},{wch:26},{wch:7},{wch:34},{wch:12},{wch:20},{wch:12},{wch:30}]
    Object.keys(rows[0]).forEach((_, i) => {
      const c = ws[XLSX.utils.encode_cell({ r:0, c:i })]
      if (c) c.s = { font:{ bold:true }, fill:{ fgColor:{ rgb:'E8EEF7' } } }
    })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Propuneri')
    XLSX.writeFile(wb, `organigrama_propuneri_${new Date().toISOString().slice(0,10)}.xlsx`)
  }

  return (
    <div style={S.page}>
      <div style={{ display:'flex', alignItems:'flex-start', gap:12, flexWrap:'wrap', marginBottom:14 }}>
        <div style={{ flex:1, minWidth:280 }}>
          <h1 style={{ margin:0, fontSize:20, fontWeight:800 }}>🧩 Organigramă — propuneri <span style={{ fontSize:11, fontWeight:700, color:G.yellow, border:`1px solid ${G.yellow}55`, borderRadius:8, padding:'2px 7px', verticalAlign:'middle' }}>PROVIZORIU</span></h1>
          <p style={{ margin:'6px 0 0', fontSize:12.5, color:G.muted, maxWidth:780, lineHeight:1.5 }}>
            Scrieți aici cum ar trebui să arate de fapt <strong style={{color:G.text}}>departamentele, subdepartamentele și funcțiile</strong>, mai ales
            pentru personalul TESA pe care îl folosim la licitații. Fiecare propunere primește un număr, ca s-o putem cita în discuție.
            Nimic nu se schimbă automat nicăieri — la final se ia varianta acceptată și din ea se face organigrama care se leagă de
            autorizații, diplome și export în propunerea tehnică.
          </p>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button style={S.btnS} onClick={exporta}>📤 Export XLSX</button>
          <button style={S.btnP} onClick={() => startNou()} disabled={!!nou}>➕ Propunere nouă</button>
        </div>
      </div>

      {eroare && <div style={{ ...S.card, borderColor:G.red, padding:'9px 12px', marginBottom:10, color:G.red, fontSize:12.5 }}>{eroare}</div>}
      {mesaj && <div style={{ ...S.card, borderColor:G.green, padding:'9px 12px', marginBottom:10, color:G.green, fontSize:12.5 }} onClick={() => setMesaj(null)}>{mesaj}</div>}

      {nou && (
        <div style={{ ...S.card, padding:14, marginBottom:14, borderColor:G.teal + '77' }}>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(210px, 1fr))', gap:10 }}>
            <label style={{ fontSize:11.5, color:G.muted, fontWeight:700 }}>ANGAJAT
              <select style={{ ...S.input, marginTop:4 }} value={nou.employee_id} onChange={e => alegeAngajat(e.target.value)}>
                <option value="">— niciunul (poziție scrisă liber) —</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </label>
            {!nou.employee_id && (
              <label style={{ fontSize:11.5, color:G.muted, fontWeight:700 }}>POZIȚIE / PERSOANĂ (text liber)
                <input style={{ ...S.input, marginTop:4 }} value={nou.nume_liber} placeholder="ex. Inginer drumuri (de angajat)"
                  onChange={e => setNou({ ...nou, nume_liber: e.target.value })} />
              </label>
            )}
            <label style={{ fontSize:11.5, color:G.muted, fontWeight:700 }}>DEPARTAMENT
              <input style={{ ...S.input, marginTop:4 }} value={nou.departament} placeholder="ex. Execuție"
                onChange={e => setNou({ ...nou, departament: e.target.value })} />
            </label>
            <label style={{ fontSize:11.5, color:G.muted, fontWeight:700 }}>SUBDEPARTAMENT
              <input style={{ ...S.input, marginTop:4 }} value={nou.subdepartament} placeholder="ex. Rețele apă-canal"
                onChange={e => setNou({ ...nou, subdepartament: e.target.value })} />
            </label>
            <label style={{ fontSize:11.5, color:G.muted, fontWeight:700 }}>FUNCȚIE (organigramă)
              <input style={{ ...S.input, marginTop:4 }} value={nou.functie} placeholder="ex. Șef de șantier"
                onChange={e => setNou({ ...nou, functie: e.target.value })} />
            </label>
            <label style={{ fontSize:11.5, color:G.muted, fontWeight:700 }}>ROL LA LICITAȚII
              <select style={{ ...S.input, marginTop:4 }} value={nou.rol_licitatii} onChange={e => setNou({ ...nou, rol_licitatii: e.target.value })}>
                {ROLURI.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
          </div>
          <div style={{ display:'flex', gap:12, alignItems:'center', marginTop:10, flexWrap:'wrap' }}>
            <label style={{ fontSize:12.5, display:'flex', alignItems:'center', gap:6, cursor:'pointer' }}>
              <input type="checkbox" checked={nou.tesa} onChange={e => setNou({ ...nou, tesa: e.target.checked })} />
              e personal TESA (se folosește la licitații)
            </label>
            <input style={{ ...S.input, flex:1, minWidth:220 }} value={nou.observatii} placeholder="Observații — de ce e nevoie de schimbare"
              onChange={e => setNou({ ...nou, observatii: e.target.value })} />
            <button style={S.btnP} onClick={salveaza} disabled={salvez}>{salvez ? 'Se salvează…' : 'Salvează'}</button>
            <button style={S.btnS} onClick={() => { setNou(null); setEroare(null) }}>Renunț</button>
          </div>
        </div>
      )}

      <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', marginBottom:10 }}>
        {['toate', 'propunere', 'acceptata', 'respinsa'].map(f => (
          <button key={f} style={S.chip(filtru === f, f === 'toate' ? G.blue : ST[f].color)} onClick={() => setFiltru(f)}>
            {f === 'toate' ? `Toate (${randuri.length})` : `${ST[f].icon} ${ST[f].label} (${nrPe(f)})`}
          </button>
        ))}
        <input style={{ ...S.input, width:230, marginLeft:'auto' }} value={cauta} placeholder="caută nume, funcție, departament…"
          onChange={e => setCauta(e.target.value)} />
      </div>

      <div style={{ ...S.card, overflowX:'auto' }}>
        {loading ? <div style={{ padding:20, color:G.muted, fontSize:13 }}>Se încarcă…</div>
        : !vizibile.length ? <div style={{ padding:20, color:G.muted, fontSize:13 }}>Nicio propunere încă. Apasă „Propunere nouă".</div>
        : (
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr>
                <th style={S.th}>#</th>
                <th style={S.th}>Persoană / poziție</th>
                <th style={S.th}>Acum în platformă</th>
                <th style={S.th}>Propus</th>
                <th style={S.th}>Rol licitații</th>
                <th style={S.th}>Observații</th>
                <th style={S.th}>Propus de</th>
                <th style={S.th}>Status</th>
                <th style={S.th}></th>
              </tr>
            </thead>
            <tbody>
              {vizibile.map(r => {
                const st = ST[r.status] || ST.propunere
                const alMeu = r.propus_de && r.propus_de === profile?.id
                return (
                  <tr key={r.id}>
                    <td style={{ ...S.td, fontWeight:800, color:G.dim, fontVariantNumeric:'tabular-nums' }}>{r.nr}</td>
                    <td style={{ ...S.td, fontWeight:700 }}>
                      {numeRand(r)}
                      {r.tesa && <span style={{ marginLeft:6, fontSize:10, fontWeight:800, color:G.purple, border:`1px solid ${G.purple}55`, borderRadius:8, padding:'1px 5px' }}>TESA</span>}
                      {!r.emp && <span style={{ marginLeft:6, fontSize:10, color:G.dim }}>(poziție)</span>}
                    </td>
                    <td style={{ ...S.td, color:G.dim, fontSize:11.5 }}>
                      {r.emp ? <>{r.emp.functie || r.emp.functie_cim || '—'}<br/>{r.emp.departament_hr || r.emp.department || '—'}</> : '—'}
                    </td>
                    <td style={{ ...S.td }}>
                      <div style={{ fontWeight:600 }}>{r.functie || '—'}</div>
                      <div style={{ color:G.muted, fontSize:11.5 }}>
                        {[r.departament, r.subdepartament].filter(Boolean).join(' › ') || '—'}
                      </div>
                    </td>
                    <td style={{ ...S.td, fontSize:11.5, color:r.rol_licitatii ? G.teal : G.dim }}>{r.rol_licitatii || '—'}</td>
                    <td style={{ ...S.td, color:G.muted, maxWidth:260 }}>{r.observatii || '—'}</td>
                    <td style={{ ...S.td, fontSize:11.5, color:G.dim, whiteSpace:'nowrap' }}>
                      {autori[r.propus_de] || '—'}<br/>{fmtZi(r.propus_la)}
                    </td>
                    <td style={{ ...S.td, whiteSpace:'nowrap' }}>
                      <span style={{ fontSize:11.5, fontWeight:800, color:st.color }}>{st.icon} {st.label}</span>
                      {r.decizie_motiv && <div style={{ fontSize:11, color:G.dim, maxWidth:180 }}>{r.decizie_motiv}</div>}
                    </td>
                    <td style={{ ...S.td, whiteSpace:'nowrap' }}>
                      {esteOwner && r.status === 'propunere' && (
                        <>
                          <button style={{ ...S.btnS, padding:'3px 8px', color:G.green, borderColor:G.green + '55' }} onClick={() => decide(r, 'acceptata')}>✔</button>{' '}
                          <button style={{ ...S.btnS, padding:'3px 8px', color:G.red, borderColor:G.red + '55' }} onClick={() => decide(r, 'respinsa')}>✕</button>{' '}
                        </>
                      )}
                      {(esteOwner || (alMeu && r.status === 'propunere')) && (
                        <button style={{ ...S.btnS, padding:'3px 8px', color:G.dim }} onClick={() => sterge(r)}>🗑</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
