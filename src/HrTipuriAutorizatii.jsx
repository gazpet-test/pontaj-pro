// ===========================================================================
// MODUL HR — Tab „Tipuri de autorizații" (17.09.2026)
// Nomenclatorul `hr_autorizatii_tipuri` n-avea interfață deloc: se modifica doar prin SQL, deci
// prin Claude. O autorizație reală stătea blocată până prindea cineva o sesiune liberă — s-a
// întâmplat exact așa cu autorizația de topograf a lui Apostol Andruț. Ecranul ăsta scoate
// dependența: HR adaugă tipul singur și merge mai departe.
//
// Drepturile sunt deja pe tabel (RLS `hr_autorizatii_tipuri_write_authorized`): owner,
// can_modify_employees, superadmin sau departamentul HR/Administrativ. Nu se acordă nimic nou aici.
//
// Un tip NU se șterge: se dezactivează. Ștergerea ar rupe autorizațiile existente care trimit
// la el prin `tip_id` — iar alea sunt dovezi într-o ofertă, nu rânduri de nomenclator.
// ===========================================================================
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase.js'

const G = {
  bg:'#0D1117', surface:'#161B22', card:'#161B22', text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  border:'#30363D', border2:'#21262D',
  blue:'#1F6FEB', green:'#2EA043', yellow:'#D29922', orange:'#F0883E', red:'#F85149', purple:'#A371F7',
  hr:'#EC6CB9',
}
const S = {
  card: { background:G.card, borderRadius:12, border:`1px solid ${G.border}` },
  input: { width:'100%', background:G.bg, border:`1px solid ${G.border}`, borderRadius:8, padding:'8px 10px', color:G.text, fontSize:13, outline:'none' },
  btnP: { padding:'8px 14px', background:G.hr, color:'#0D1117', border:'none', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:700 },
  btnS: { padding:'7px 12px', background:G.surface, color:G.text, border:`1px solid ${G.border}`, borderRadius:8, cursor:'pointer', fontSize:13 },
}
const th = { padding:'9px 10px', textAlign:'left', fontSize:11, fontWeight:700, color:G.muted, textTransform:'uppercase', letterSpacing:.5, whiteSpace:'nowrap' }
const td = { padding:'9px 10px', verticalAlign:'top', fontSize:12.5 }
const CATEGORII = ['profesional', 'cursuri', 'transport', 'iscir', 'anre', 'isu', 'sudura', 'mediu', 'medical', 'autorizari', 'altele']
const GOL = {
  cod:'', denumire:'', detaliere:'', categorie:'profesional', emitent_default:'',
  perioada_default_luni:'', cod_cor:'', ordine:100, activ:true,
  necesita_domenii:false, necesita_procedura:false, necesita_subcategorie:false, necesita_calitate_material:false,
}
// Codul e cheia pe care o citesc motorul de ofertare și cititorul AI. Îl ținem previzibil.
const normCod = (s) => (s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)

function Lbl({ children }) { return <div style={{ fontSize:11, color:G.muted, fontWeight:700, marginBottom:3, textTransform:'uppercase', letterSpacing:.4 }}>{children}</div> }

export default function HrTipuriAutorizatii({ canEdit, showToast }) {
  const [load, setLoad] = useState(true)
  const [lista, setLista] = useState([])
  const [folosire, setFolosire] = useState({})
  const [q, setQ] = useState('')
  const [doarActive, setDoarActive] = useState(true)
  const [edit, setEdit] = useState(null)
  const [scriu, setScriu] = useState(false)

  const reload = useCallback(async () => {
    setLoad(true)
    const [t, a] = await Promise.all([
      supabase.from('hr_autorizatii_tipuri').select('*').order('categorie').order('denumire'),
      supabase.from('hr_autorizatii').select('tip_id').is('deleted_at', null).limit(20000),
    ])
    if (t.error) { showToast?.('Eroare: ' + t.error.message, 'error'); setLoad(false); return }
    setLista(t.data || [])
    const f = {}
    for (const r of (a.data || [])) if (r.tip_id) f[r.tip_id] = (f[r.tip_id] || 0) + 1
    setFolosire(f)
    setLoad(false)
  }, [showToast])
  useEffect(() => { reload() }, [reload])

  const afisate = useMemo(() => {
    const s = q.trim().toLowerCase()
    return lista.filter(r => (!doarActive || r.activ !== false) &&
      (!s || `${r.cod} ${r.denumire} ${r.detaliere || ''} ${r.categorie} ${r.emitent_default || ''}`.toLowerCase().includes(s)))
  }, [lista, q, doarActive])

  const salveaza = async () => {
    const e = edit
    const cod = normCod(e.cod)
    if (!cod) { showToast?.('Codul e obligatoriu', 'error'); return }
    if (!e.denumire.trim()) { showToast?.('Denumirea e obligatorie', 'error'); return }
    // Codul trebuie să fie unic: două tipuri cu același cod ar face imposibil de spus care
    // acoperă o cerință. Nu există constrângere în BD, deci verificăm aici.
    const ciocnire = lista.find(r => r.cod === cod && r.id !== e.id)
    if (ciocnire) { showToast?.(`Codul ${cod} e deja folosit de „${ciocnire.denumire}"`, 'error'); return }
    setScriu(true)
    const p = {
      cod, denumire: e.denumire.trim(), detaliere: e.detaliere?.trim() || null,
      categorie: e.categorie, emitent_default: e.emitent_default?.trim() || null,
      perioada_default_luni: e.perioada_default_luni === '' || e.perioada_default_luni == null ? null : Number(e.perioada_default_luni),
      cod_cor: e.cod_cor?.trim() || null, ordine: Number(e.ordine) || 100, activ: e.activ !== false,
      necesita_domenii: !!e.necesita_domenii, necesita_procedura: !!e.necesita_procedura,
      necesita_subcategorie: !!e.necesita_subcategorie, necesita_calitate_material: !!e.necesita_calitate_material,
    }
    const { error } = e.id
      ? await supabase.from('hr_autorizatii_tipuri').update(p).eq('id', e.id)
      : await supabase.from('hr_autorizatii_tipuri').insert(p)
    setScriu(false)
    if (error) { showToast?.('Eroare: ' + error.message, 'error'); return }
    showToast?.(e.id ? 'Tip actualizat' : `Tip adăugat: ${cod}`, 'success')
    setEdit(null); await reload()
  }

  const comutaActiv = async (r) => {
    const n = folosire[r.id] || 0
    if (r.activ !== false && n > 0 && !window.confirm(
      `„${r.denumire}" e folosit de ${n} autorizații.\n\nDezactivarea îl scoate din listele de alegere, dar autorizațiile existente rămân neatinse și se văd mai departe în Ofertare. Continui?`)) return
    const { error } = await supabase.from('hr_autorizatii_tipuri').update({ activ: r.activ === false }).eq('id', r.id)
    if (error) { showToast?.('Eroare: ' + error.message, 'error'); return }
    await reload()
  }

  return (
    <div>
      <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap', marginBottom:12 }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="caută cod, denumire, emitent…" style={{ ...S.input, width:320 }} />
        <label style={{ fontSize:12, color:G.muted, display:'flex', gap:6, alignItems:'center' }}>
          <input type="checkbox" checked={doarActive} onChange={e => setDoarActive(e.target.checked)} /> doar active
        </label>
        <span style={{ fontSize:12, color:G.dim }}>{afisate.length} din {lista.length}</span>
        <span style={{ flex:1 }} />
        {canEdit && <button onClick={() => setEdit({ ...GOL })} style={S.btnP}>+ Tip de autorizație</button>}
      </div>
      <div style={{ fontSize:11.5, color:G.dim, marginBottom:10 }}>
        Lista de tipuri pe care o vezi când adaugi o autorizație unui om. Codul e cheia citită de motorul din Ofertare
        și de cititorul AI — o dată pus, nu-l mai schimba fără motiv. Un tip nu se șterge, se <b>dezactivează</b>:
        autorizațiile care trimit la el sunt dovezi într-o ofertă, nu rânduri de nomenclator.
      </div>

      {load ? <div style={{ color:G.muted, padding:20 }}>Se încarcă…</div> : (
        <div style={{ ...S.card, overflow:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr style={{ borderBottom:`1px solid ${G.border}` }}>
              <th style={th}>Cod</th><th style={th}>Denumire</th><th style={th}>Categorie</th>
              <th style={th}>Emitent implicit</th><th style={th}>Valabilitate</th><th style={th}>Folosit</th><th style={th} />
            </tr></thead>
            <tbody>
              {afisate.map(r => (
                <tr key={r.id} style={{ borderBottom:`1px solid ${G.border2}`, opacity: r.activ === false ? .5 : 1 }}>
                  <td style={{ ...td, fontFamily:'ui-monospace, monospace', fontSize:11.5, color:G.purple }}>{r.cod}</td>
                  <td style={td}>{r.denumire}{r.detaliere && <div style={{ fontSize:11, color:G.dim }}>{r.detaliere}</div>}</td>
                  <td style={{ ...td, color:G.muted }}>{r.categorie}</td>
                  <td style={{ ...td, color:G.muted }}>{r.emitent_default || '—'}</td>
                  <td style={{ ...td, color:G.muted }}>{r.perioada_default_luni ? `${r.perioada_default_luni} luni` : '—'}</td>
                  <td style={{ ...td, color: (folosire[r.id] || 0) ? G.text : G.dim }}>{folosire[r.id] || 0}</td>
                  <td style={{ ...td, textAlign:'right', whiteSpace:'nowrap' }}>
                    {canEdit && <>
                      <button onClick={() => setEdit({ ...r, perioada_default_luni: r.perioada_default_luni ?? '', detaliere: r.detaliere || '', emitent_default: r.emitent_default || '', cod_cor: r.cod_cor || '' })}
                        style={{ ...S.btnS, padding:'3px 9px', fontSize:11 }}>✎ editează</button>
                      <button onClick={() => comutaActiv(r)} style={{ ...S.btnS, padding:'3px 9px', fontSize:11, marginLeft:6, color: r.activ === false ? G.green : G.orange, borderColor:(r.activ === false ? G.green : G.orange) + '55' }}>
                        {r.activ === false ? '↻ reactivează' : '⊘ dezactivează'}
                      </button>
                    </>}
                  </td>
                </tr>
              ))}
              {!afisate.length && <tr><td style={{ ...td, color:G.muted, padding:20 }} colSpan={7}>Niciun tip care să se potrivească.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {edit && (
        <div onClick={() => !scriu && setEdit(null)} style={{ position:'fixed', inset:0, background:'#000A', display:'flex', alignItems:'center', justifyContent:'center', zIndex:70, padding:16 }}>
          <div onClick={e => e.stopPropagation()} style={{ ...S.card, padding:18, width:'min(620px, 96vw)', maxHeight:'90vh', overflow:'auto' }}>
            <div style={{ fontWeight:800, fontSize:15, marginBottom:14 }}>{edit.id ? `Editează ${edit.cod}` : 'Tip nou de autorizație'}</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
              <div>
                <Lbl>Cod</Lbl>
                <input value={edit.cod} onChange={e => setEdit({ ...edit, cod: e.target.value })}
                  onBlur={e => setEdit(x => ({ ...x, cod: normCod(e.target.value) }))}
                  placeholder="TOPOGRAF_ANCPI" style={{ ...S.input, fontFamily:'ui-monospace, monospace' }} />
                <div style={{ fontSize:10.5, color:G.dim, marginTop:3 }}>Majuscule și underscore. Cheia citită de Ofertare.</div>
              </div>
              <div>
                <Lbl>Categorie</Lbl>
                <select value={edit.categorie} onChange={e => setEdit({ ...edit, categorie: e.target.value })} style={S.input}>
                  {CATEGORII.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div style={{ gridColumn:'1 / -1' }}>
                <Lbl>Denumire</Lbl>
                <input value={edit.denumire} onChange={e => setEdit({ ...edit, denumire: e.target.value })}
                  placeholder="Topograf autorizat ANCPI (cadastru, geodezie)" style={S.input} />
              </div>
              <div style={{ gridColumn:'1 / -1' }}>
                <Lbl>Detaliere (opțional)</Lbl>
                <input value={edit.detaliere} onChange={e => setEdit({ ...edit, detaliere: e.target.value })}
                  placeholder="ex. categoriile A, B, C sau D" style={S.input} />
              </div>
              <div>
                <Lbl>Emitent implicit</Lbl>
                <input value={edit.emitent_default} onChange={e => setEdit({ ...edit, emitent_default: e.target.value })} placeholder="ANCPI" style={S.input} />
              </div>
              <div>
                <Lbl>Valabilitate implicită (luni)</Lbl>
                <input type="number" min="0" value={edit.perioada_default_luni} onChange={e => setEdit({ ...edit, perioada_default_luni: e.target.value })} placeholder="ex. 24" style={S.input} />
              </div>
              <div>
                <Lbl>Cod COR (opțional)</Lbl>
                <input value={edit.cod_cor} onChange={e => setEdit({ ...edit, cod_cor: e.target.value })} placeholder="311201" style={S.input} />
              </div>
              <div>
                <Lbl>Ordine în listă</Lbl>
                <input type="number" value={edit.ordine} onChange={e => setEdit({ ...edit, ordine: e.target.value })} style={S.input} />
              </div>
            </div>
            <div style={{ marginTop:14, display:'grid', gap:6 }}>
              <Lbl>Ce se cere completat pe autorizațiile de tipul ăsta</Lbl>
              {[['necesita_domenii', 'Domenii / subdomenii (ex. RTE: 8.4D, 9.1)'],
                ['necesita_procedura', 'Procedeu de sudură (ex. 111, 141)'],
                ['necesita_subcategorie', 'Subcategorie'],
                ['necesita_calitate_material', 'Calitate material']].map(([k, l]) => (
                <label key={k} style={{ fontSize:12.5, color:G.text, display:'flex', gap:8, alignItems:'center' }}>
                  <input type="checkbox" checked={!!edit[k]} onChange={e => setEdit({ ...edit, [k]: e.target.checked })} /> {l}
                </label>
              ))}
              <label style={{ fontSize:12.5, color:G.text, display:'flex', gap:8, alignItems:'center', marginTop:4 }}>
                <input type="checkbox" checked={edit.activ !== false} onChange={e => setEdit({ ...edit, activ: e.target.checked })} /> activ (apare în listele de alegere)
              </label>
            </div>
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:16 }}>
              <button onClick={() => setEdit(null)} disabled={scriu} style={S.btnS}>Renunț</button>
              <button onClick={salveaza} disabled={scriu} style={S.btnP}>{scriu ? 'Salvez…' : 'Salvează'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
