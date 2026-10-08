// ═══════════════════════════════════════════════════════════════════════════
// 🔐 CONTURI — registrul „unde intru și cu ce cont” (Administrativ, owner-only)
// ═══════════════════════════════════════════════════════════════════════════
// Serviciu → utilizator/e-mail → titular → personal/firmă → locații legate.
// FĂRĂ parole: nicio coloană, niciun câmp de parolă — parolele stau în
// managerul de parole. Ștergerea = dezactivare (activ=false), nu DELETE.
// Tabel: public.conturi_registru (20261021a), RLS doar profiles.is_owner.
// Spec: claude_docs.spec_conturi_registru (Răzvan 08.10.2026, varianta C).
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from './lib/supabase.js'
import { CATEGORII, ORDINE_CATEGORII, LIMITE, urlSigur, filtreaza, grupeaza, pregatesteRand } from './conturiUtil.js'

const G = {
  bg:'#0D1117', surface:'#161B22', border:'#30363D', border2:'#21262D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  orange:'#F0883E', purple:'#A371F7', blue:'#58A6FF',
  green:'#3FB950', yellow:'#D29922', red:'#F85149',
}
const S = {
  page: { padding:'4px 0 24px', color:G.text, fontFamily:'-apple-system,BlinkMacSystemFont,Inter,sans-serif' },
  card: { background:G.surface, borderRadius:12, border:`1px solid ${G.border}` },
  input:{ background:G.bg, border:`1px solid ${G.border}`, color:G.text, borderRadius:8, padding:'8px 12px', fontFamily:'inherit', fontSize:14, outline:'none', width:'100%', boxSizing:'border-box' },
  btnP: { padding:'9px 16px', background:G.orange, color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:700 },
  btnS: { padding:'7px 13px', background:'transparent', color:G.text, border:`1px solid ${G.border}`, borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:600 },
  label:{ fontSize:11, color:G.muted, fontWeight:700, marginBottom:5, display:'block', textTransform:'uppercase', letterSpacing:.4 },
  th:   { textAlign:'left', fontSize:10, color:G.dim, fontWeight:700, textTransform:'uppercase', letterSpacing:.4, padding:'6px 10px', whiteSpace:'nowrap' },
  td:   { fontSize:13, padding:'8px 10px', borderTop:`1px solid ${G.border2}`, verticalAlign:'top' },
}
const FARA_PAROLE = 'fără parole — stau în managerul de parole'

function Mesaj({ mesaj, onClose }) {
  if (!mesaj) return null
  const c = mesaj.tip === 'error' ? G.red : mesaj.tip === 'warn' ? G.yellow : G.green
  return (
    <div style={{...S.card, padding:'10px 14px', marginBottom:14, borderColor:c+'55', background:c+'11',
                 display:'flex', justifyContent:'space-between', alignItems:'center', gap:12}}>
      <span style={{fontSize:13, color:c, fontWeight:600}}>{mesaj.text}</span>
      <button onClick={onClose} style={{...S.btnS, padding:'3px 9px', fontSize:12, color:G.muted}}>✕</button>
    </div>
  )
}

const Badge = ({ personal }) => (
  <span style={{fontSize:10, fontWeight:800, borderRadius:4, padding:'2px 6px', whiteSpace:'nowrap',
                color: personal ? G.purple : G.blue, background:(personal ? G.purple : G.blue) + '22'}}>
    {personal ? 'PERSONAL' : 'FIRMĂ'}
  </span>
)

// ─── Modal cont (adaugă / editează) ─────────────────────────────────────────
function FormCont({ cont, locatii, onSalvat, onClose, setMesaj }) {
  const [f, setF] = useState(() => ({
    categorie: cont?.categorie || 'utilitati', serviciu: cont?.serviciu || '', url: cont?.url || '',
    utilizator: cont?.utilizator || '', titular: cont?.titular || '', cod_client: cont?.cod_client || '',
    personal: cont?.personal ?? false, observatii: cont?.observatii || '', activ: cont?.activ ?? true,
    locatie_ids: (cont?.locatie_ids || []).map(Number),
  }))
  const [lucrez, setLucrez] = useState(false)
  const [eroare, setEroare] = useState('')
  const set = (k, v) => { setEroare(''); setF(p => ({ ...p, [k]: v })) }
  const comutaLocatie = (id) => set('locatie_ids', f.locatie_ids.includes(id) ? f.locatie_ids.filter(x => x !== id) : [...f.locatie_ids, id])

  const salveaza = async () => {
    const { rand, eroare: e } = pregatesteRand(f, locatii.map(l => l.id))
    if (e) { setEroare(e); return }
    setLucrez(true)
    try {
      if (cont) {
        // gardă optimistă (doi owneri): dacă rândul s-a schimbat între timp, nu suprascriem modificarea celuilalt
        const { data, error } = await supabase.from('conturi_registru').update(rand)
          .eq('id', cont.id).eq('updated_at', cont.updated_at).select('id')
        if (error) throw error
        if (!data || data.length === 0) {
          setEroare('Contul a fost modificat între timp (de altcineva sau din alt tab). Am reîncărcat lista — închide și redeschide contul, apoi reaplică modificarea.')
          onSalvat(); return
        }
      } else {
        const { error } = await supabase.from('conturi_registru').insert(rand)
        if (error) throw error
      }
      setMesaj({ tip:'success', text: cont ? `Cont actualizat: ${rand.serviciu}.` : `Cont adăugat: ${rand.serviciu}.` })
      onSalvat(); onClose()
    } catch (err) { setEroare('Eroare la salvare: ' + (err.message || err)) }
    finally { setLucrez(false) }
  }

  const camp = (k, eticheta, props = {}) => (
    <div>
      <label style={S.label}>{eticheta}</label>
      <input style={S.input} value={f[k]} maxLength={LIMITE[k]} onChange={e => set(k, e.target.value)}
             autoComplete="off" spellCheck={false} {...props} />
    </div>
  )

  return (
    <div onClick={onClose} style={{position:'fixed', inset:0, background:'#000A', zIndex:900, display:'flex', alignItems:'center', justifyContent:'center', padding:20}}>
      <div onClick={e => e.stopPropagation()} style={{...S.card, width:'min(720px, 96vw)', maxHeight:'92vh', overflow:'auto', padding:22}}>
        <div style={{fontSize:17, fontWeight:800, marginBottom:4}}>{cont ? '✏️ Editează contul' : '➕ Cont nou'}</div>
        <div style={{fontSize:12, color:G.dim, marginBottom:16}}>🔒 Registrul ține doar unde intri și cu ce cont — {FARA_PAROLE}.</div>

        <div style={{display:'grid', gridTemplateColumns:'1fr 2fr', gap:12, marginBottom:12}}>
          <div>
            <label style={S.label}>Categorie *</label>
            <select style={S.input} value={f.categorie} onChange={e => set('categorie', e.target.value)}>
              {ORDINE_CATEGORII.map(k => <option key={k} value={k}>{CATEGORII[k].icon} {CATEGORII[k].label}</option>)}
            </select>
          </div>
          {camp('serviciu', 'Serviciu *', { placeholder:'ex: MyElectrica, ghiseul.ro, Broadlink' })}
        </div>

        <div style={{marginBottom:12}}>{camp('url', 'Link (opțional)', { placeholder:'https://…', inputMode:'url' })}</div>

        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12}}>
          {camp('utilizator', 'Utilizator / e-mail de login', { placeholder:`e-mail sau user — ${FARA_PAROLE}` })}
          {camp('titular', 'Titular (dacă nu ești tu)', { placeholder:'numele de pe cont / cod' })}
        </div>

        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12, alignItems:'end'}}>
          {camp('cod_client', 'Cod client (opțional)', { placeholder:'codul furnizorului' })}
          <label style={{display:'flex', alignItems:'center', gap:8, fontSize:13, cursor:'pointer', paddingBottom:9}}>
            <input type="checkbox" checked={f.personal} onChange={e => set('personal', e.target.checked)} />
            <span>Cont personal <span style={{color:G.dim, fontSize:11}}>(nebifat = al firmei)</span></span>
          </label>
        </div>

        <div style={{marginBottom:12}}>
          <label style={S.label}>Locații legate (opțional)</label>
          {locatii.length === 0 ? (
            <div style={{fontSize:12, color:G.dim}}>Nu există locații în „Locații închiriate”. Poți scrie adresa în observații.</div>
          ) : (
            <div style={{display:'flex', flexWrap:'wrap', gap:6, maxHeight:140, overflow:'auto', padding:8, border:`1px solid ${G.border}`, borderRadius:8, background:G.bg}}>
              {locatii.map(l => {
                const on = f.locatie_ids.includes(Number(l.id))
                return (
                  <button key={l.id} type="button" onClick={() => comutaLocatie(Number(l.id))}
                          style={{...S.btnS, padding:'4px 9px', fontSize:12, borderColor: on ? G.orange : G.border,
                                  background: on ? G.orange+'22' : 'transparent', color: on ? G.orange : G.muted, opacity: l.activ === false ? .6 : 1}}>
                    {on ? '✓ ' : ''}{l.nume}{l.activ === false ? ' (inactivă)' : ''}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div style={{marginBottom:12}}>
          <label style={S.label}>Observații</label>
          <textarea style={{...S.input, minHeight:70, resize:'vertical'}} value={f.observatii} maxLength={LIMITE.observatii}
                    onChange={e => set('observatii', e.target.value)} placeholder={`locuri de consum, la ce folosește contul… — ${FARA_PAROLE}`} />
        </div>

        {cont && (
          <label style={{display:'flex', alignItems:'center', gap:8, fontSize:13, marginBottom:12, cursor:'pointer'}}>
            <input type="checkbox" checked={f.activ} onChange={e => set('activ', e.target.checked)} />
            <span>Cont activ <span style={{color:G.dim, fontSize:11}}>(debifat = ascuns din listă, rămâne în registru)</span></span>
          </label>
        )}

        {eroare && <div style={{fontSize:13, color:G.red, fontWeight:600, marginBottom:12}}>{eroare}</div>}

        <div style={{display:'flex', gap:10, justifyContent:'flex-end'}}>
          <button onClick={onClose} style={S.btnS}>Renunță</button>
          <button onClick={salveaza} disabled={lucrez} style={{...S.btnP, opacity:lucrez ? .6 : 1}}>{lucrez ? 'Salvez…' : 'Salvează'}</button>
        </div>
      </div>
    </div>
  )
}

// ─── Ecranul ────────────────────────────────────────────────────────────────
export default function ConturiRegistru({ profile }) {
  const [conturi, setConturi] = useState([])
  const [locatii, setLocatii] = useState([])
  const [load, setLoad]       = useState(true)
  const [eroareIncarcare, setEroareIncarcare] = useState('')
  const [mesaj, setMesaj]     = useState(null)
  const [form, setForm]       = useState(null)   // { cont } sau {} pentru nou
  const [categorie, setCategorie] = useState('toate')
  const [tip, setTip]         = useState('toate')
  const [text, setText]       = useState('')
  const [inactive, setInactive] = useState(false)
  const esteOwner = profile?.is_owner === true

  const incarca = useCallback(async () => {
    setLoad(true); setEroareIncarcare('')
    try {
      const [c, l] = await Promise.all([
        supabase.from('conturi_registru').select('*').order('categorie').order('serviciu').order('id'),
        supabase.from('locatii_inchiriate').select('id, nume, activ').order('activ', { ascending:false }).order('nume'),
      ])
      if (c.error) throw c.error
      if (l.error) throw l.error
      setConturi(c.data || []); setLocatii(l.data || [])
    } catch (e) { setEroareIncarcare(e.message || String(e)) }
    finally { setLoad(false) }
  }, [])

  useEffect(() => { if (esteOwner) incarca() }, [esteOwner, incarca])

  const numeLocatie = useMemo(() => Object.fromEntries(locatii.map(l => [Number(l.id), l.nume])), [locatii])
  const vizibile = useMemo(() => filtreaza(conturi, { categorie, tip, text, inactive }), [conturi, categorie, tip, text, inactive])
  const grupe = useMemo(() => grupeaza(vizibile), [vizibile])
  const peCategorie = useMemo(() => {
    const m = {}
    for (const r of filtreaza(conturi, { inactive })) m[r.categorie] = (m[r.categorie] || 0) + 1
    return m
  }, [conturi, inactive])
  const nrInactive = conturi.filter(r => r.activ === false).length

  const schimbaActiv = async (r, activ) => {
    if (!activ && !window.confirm(`Dezactivez „${r.serviciu}”${r.utilizator ? ` (${r.utilizator})` : ''}? Rămâne în registru, doar ascuns.`)) return
    const { data, error } = await supabase.from('conturi_registru').update({ activ })
      .eq('id', r.id).eq('updated_at', r.updated_at).select('id')
    if (error) { setMesaj({ tip:'error', text:'Eroare: ' + error.message }); return }
    if (!data || data.length === 0) {
      setMesaj({ tip:'warn', text:`„${r.serviciu}” a fost modificat între timp — am reîncărcat lista, încearcă din nou.` })
      incarca(); return
    }
    setMesaj({ tip:'success', text: activ ? `Reactivat: ${r.serviciu}.` : `Dezactivat: ${r.serviciu}.` })
    incarca()
  }

  if (!esteOwner) {
    return (
      <div style={{...S.card, padding:'30px 24px', textAlign:'center', color:G.muted, fontSize:13}}>
        🔒 Registrul de conturi e vizibil doar pentru owner.
      </div>
    )
  }

  return (
    <div style={S.page}>
      <Mesaj mesaj={mesaj} onClose={() => setMesaj(null)} />

      <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, flexWrap:'wrap', marginBottom:14}}>
        <div>
          <div style={{fontSize:18, fontWeight:800}}>🔐 Conturi și accesuri</div>
          <div style={{fontSize:12, color:G.muted, marginTop:4}}>
            Unde intri și cu ce cont · {FARA_PAROLE} · vizibil doar owner
          </div>
        </div>
        <button onClick={() => setForm({})} disabled={load || !!eroareIncarcare}
                style={{...S.btnP, opacity:(load || eroareIncarcare) ? .5 : 1, cursor:(load || eroareIncarcare) ? 'default' : 'pointer'}}>➕ Cont nou</button>
      </div>

      <div style={{...S.card, padding:12, marginBottom:14, display:'flex', gap:10, flexWrap:'wrap', alignItems:'center'}}>
        <select style={{...S.input, width:'auto', minWidth:170}} value={categorie} onChange={e => setCategorie(e.target.value)}>
          <option value="toate">Toate categoriile ({filtreaza(conturi, { inactive }).length})</option>
          {ORDINE_CATEGORII.map(k => <option key={k} value={k}>{CATEGORII[k].icon} {CATEGORII[k].label} ({peCategorie[k] || 0})</option>)}
        </select>
        <div style={{display:'flex', border:`1px solid ${G.border}`, borderRadius:8, overflow:'hidden'}}>
          {[['toate','Toate'], ['personal','Personale'], ['firma','Firmă']].map(([k, et]) => (
            <button key={k} onClick={() => setTip(k)} style={{padding:'7px 12px', border:'none', cursor:'pointer', fontSize:12, fontWeight:700,
                    background: tip === k ? G.orange+'33' : 'transparent', color: tip === k ? G.orange : G.muted}}>{et}</button>
          ))}
        </div>
        <input style={{...S.input, flex:'1 1 200px', width:'auto'}} value={text} onChange={e => setText(e.target.value)}
               placeholder="🔍 caută serviciu, utilizator, titular, cod client…" />
        {nrInactive > 0 && (
          <label style={{display:'flex', alignItems:'center', gap:6, fontSize:12, color:G.muted, cursor:'pointer'}}>
            <input type="checkbox" checked={inactive} onChange={e => setInactive(e.target.checked)} />
            arată și inactivele ({nrInactive})
          </label>
        )}
      </div>

      {load ? (
        <div style={{color:G.muted, fontSize:13, padding:20}}>Se încarcă…</div>
      ) : eroareIncarcare ? (
        <div style={{...S.card, padding:'24px 20px', textAlign:'center', borderColor:G.red+'55', background:G.red+'11'}}>
          <div style={{fontSize:14, fontWeight:700, color:G.red, marginBottom:6}}>Registrul nu s-a putut încărca</div>
          <div style={{fontSize:12, color:G.muted, marginBottom:12, wordBreak:'break-word'}}>{eroareIncarcare}</div>
          <button onClick={incarca} style={S.btnS}>↻ Reîncearcă</button>
        </div>
      ) : conturi.length === 0 ? (
        <div style={{...S.card, padding:'30px 20px', textAlign:'center', color:G.muted, fontSize:13}}>
          Registrul e gol. Adaugă primul cont cu „➕ Cont nou”.
        </div>
      ) : grupe.length === 0 ? (
        <div style={{...S.card, padding:'24px 20px', textAlign:'center', color:G.muted, fontSize:13}}>Niciun cont nu se potrivește filtrelor.</div>
      ) : grupe.map(g => (
        <div key={g.categorie} style={{...S.card, marginBottom:14, overflow:'hidden'}}>
          <div style={{padding:'10px 14px', background:G.bg, borderBottom:`1px solid ${G.border}`, fontSize:13, fontWeight:800, display:'flex', gap:8, alignItems:'center'}}>
            <span>{CATEGORII[g.categorie].icon}</span><span>{CATEGORII[g.categorie].label}</span>
            <span style={{color:G.dim, fontWeight:600}}>· {g.servicii.reduce((s, x) => s + x.randuri.length, 0)}</span>
          </div>
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%', borderCollapse:'collapse', minWidth:760}}>
              <thead>
                <tr>
                  <th style={S.th}>Serviciu</th><th style={S.th}>Utilizator</th><th style={S.th}>Titular</th>
                  <th style={S.th}>Cod client</th><th style={S.th}>Tip</th><th style={S.th}>Locații</th>
                  <th style={S.th}>Observații</th><th style={S.th}></th>
                </tr>
              </thead>
              <tbody>
                {g.servicii.flatMap(s => s.randuri.map((r, i) => (
                  <tr key={r.id} style={{opacity: r.activ === false ? .5 : 1}}>
                    <td style={{...S.td, fontWeight:700, whiteSpace:'nowrap'}}>
                      {i === 0 || urlSigur(r.url) ? (
                        urlSigur(r.url)
                          ? <a href={r.url.trim()} target="_blank" rel="noopener noreferrer" style={{color:G.blue, textDecoration:'none'}}>{r.serviciu} ↗</a>
                          : r.serviciu
                      ) : <span style={{color:G.dim}}>〃</span>}
                      {r.activ === false && <span style={{marginLeft:6, fontSize:9, fontWeight:800, color:G.dim, border:`1px solid ${G.border}`, borderRadius:4, padding:'1px 5px'}}>INACTIV</span>}
                    </td>
                    <td style={{...S.td, fontFamily:'ui-monospace,SFMono-Regular,Menlo,monospace', fontSize:12, wordBreak:'break-all'}}>{r.utilizator || <span style={{color:G.dim}}>—</span>}</td>
                    <td style={S.td}>{r.titular || <span style={{color:G.dim}}>—</span>}</td>
                    <td style={{...S.td, fontFamily:'ui-monospace,SFMono-Regular,Menlo,monospace', fontSize:12}}>{r.cod_client || <span style={{color:G.dim}}>—</span>}</td>
                    <td style={S.td}><Badge personal={r.personal} /></td>
                    <td style={{...S.td, fontSize:12, color:G.muted}}>
                      {(r.locatie_ids || []).length
                        ? r.locatie_ids.map(id => numeLocatie[Number(id)] || `#${id} (ștearsă)`).join(', ')
                        : <span style={{color:G.dim}}>—</span>}
                    </td>
                    <td style={{...S.td, fontSize:12, color:G.muted, whiteSpace:'pre-wrap', maxWidth:280}}>{r.observatii || ''}</td>
                    <td style={{...S.td, whiteSpace:'nowrap', textAlign:'right'}}>
                      <button onClick={() => setForm({ cont: r })} title="Editează" style={{...S.btnS, padding:'3px 8px', fontSize:12}}>✏️</button>
                      {r.activ === false
                        ? <button onClick={() => schimbaActiv(r, true)} title="Reactivează" style={{...S.btnS, padding:'3px 8px', fontSize:12, marginLeft:6}}>↺</button>
                        : <button onClick={() => schimbaActiv(r, false)} title="Dezactivează (rămâne în registru)" style={{...S.btnS, padding:'3px 8px', fontSize:12, marginLeft:6, color:G.red}}>🗑</button>}
                    </td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {form && (
        <FormCont cont={form.cont} locatii={locatii} onSalvat={incarca} onClose={() => setForm(null)} setMesaj={setMesaj} />
      )}
    </div>
  )
}
