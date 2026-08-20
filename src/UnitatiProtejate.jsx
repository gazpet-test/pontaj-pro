// ═══════════════════════════════════════════════════════════════════════════
// UNITĂȚI PROTEJATE — plafon lunar deductibil
// ═══════════════════════════════════════════════════════════════════════════
// Legea 448/2006 art. 78 + Legea 193/2020: neavând 4% angajați cu dizabilități,
// firma plătește lunar taxa de handicap, dar poate deduce până la 50% din ea
// cumpărând de la unități protejate autorizate (UPA).
// Plafonul NU se reportează — ce nu consumi într-o lună se pierde definitiv.
// De aici: contorul lunar, furnizorii UPA (cu valabilitatea autorizației) și
// legătura cu Consumabile, ca runda săptămânală să fie direcționată spre UPA.
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from './lib/supabase.js'
import CitesteOricePanel from './CitesteOricePanel.jsx'

const G = {
  bg:'#0D1117', surface:'#161B22', border:'#30363D', border2:'#21262D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  orange:'#F0883E', purple:'#A371F7', blue:'#58A6FF',
  green:'#3FB950', yellow:'#D29922', red:'#F85149',
}
const S = {
  card: { background:G.surface, borderRadius:12, border:`1px solid ${G.border}` },
  input:{ background:G.bg, border:`1px solid ${G.border}`, color:G.text, borderRadius:8, padding:'8px 12px', fontFamily:'inherit', fontSize:14, outline:'none', width:'100%' },
  btnP: { padding:'9px 16px', background:G.orange, color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:700 },
  btnS: { padding:'7px 13px', background:'transparent', color:G.text, border:`1px solid ${G.border}`, borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:600 },
  label:{ fontSize:11, color:G.muted, fontWeight:700, marginBottom:5, display:'block', textTransform:'uppercase', letterSpacing:.4 },
}

const lei = (n) => (Number(n) || 0).toLocaleString('ro-RO', { minimumFractionDigits:2, maximumFractionDigits:2 })
const lunaAcum = () => new Date().toISOString().slice(0, 7) + '-01'
const azi = () => new Date().toISOString().slice(0, 10)
const fmtLuna = (d) => d ? new Date(String(d).slice(0,10)+'T00:00:00').toLocaleDateString('ro-RO', { month:'long', year:'numeric' }) : '—'
const fmtData = (d) => d ? new Date(String(d).slice(0,10)+'T00:00:00').toLocaleDateString('ro-RO', { day:'2-digit', month:'short', year:'numeric' }) : '—'
// Câte zile au mai rămas din luna curentă (inclusiv azi)
const zileRamase = () => {
  const n = new Date()
  return new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate() - n.getDate() + 1
}

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

// ─── Modal achiziție ────────────────────────────────────────────────────────
function FormAchizitie({ furnizoriUpa, onSalvat, onClose, setMesaj }) {
  const [f, setF] = useState({
    furnizor_id:'', furnizor_nume:'', numar_factura:'', data_factura: azi(),
    valoare:'', descriere:'', luna: lunaAcum(),
  })
  const [lucrez, setLucrez] = useState(false)
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))

  const salveaza = async () => {
    if (!Number(f.valoare)) { setMesaj({ tip:'warn', text:'Pune valoarea facturii.' }); return }
    if (!f.furnizor_id && !f.furnizor_nume.trim()) { setMesaj({ tip:'warn', text:'Alege furnizorul sau scrie-i numele.' }); return }
    setLucrez(true)
    try {
      const { error } = await supabase.from('upa_achizitii').insert({
        furnizor_id: f.furnizor_id ? Number(f.furnizor_id) : null,
        furnizor_nume: f.furnizor_id ? null : f.furnizor_nume.trim(),
        numar_factura: f.numar_factura.trim() || null,
        data_factura: f.data_factura || null,
        luna: f.luna, valoare: Number(f.valoare),
        descriere: f.descriere.trim() || null,
      })
      if (error) throw error
      setMesaj({ tip:'success', text:`Adăugat: ${lei(f.valoare)} lei pe ${fmtLuna(f.luna)}` })
      onSalvat(); onClose()
    } catch (e) { setMesaj({ tip:'error', text:'Eroare: ' + (e.message || e) }) }
    finally { setLucrez(false) }
  }

  return (
    <div onClick={onClose} style={{position:'fixed', inset:0, background:'#000A', zIndex:900, display:'flex', alignItems:'center', justifyContent:'center', padding:20}}>
      <div onClick={e => e.stopPropagation()} style={{...S.card, width:'min(560px, 96vw)', padding:22}}>
        <div style={{fontSize:17, fontWeight:800, marginBottom:16}}>➕ Achiziție de la unitate protejată</div>

        <div style={{marginBottom:12}}>
          <label style={S.label}>Furnizor UPA</label>
          <select style={S.input} value={f.furnizor_id} onChange={e => set('furnizor_id', e.target.value)}>
            <option value="">— alt furnizor (scriu numele) —</option>
            {furnizoriUpa.map(fz => (
              <option key={fz.id} value={fz.id}>
                {fz.nume}{fz.upa_valabil_pana && fz.upa_valabil_pana < azi() ? ' ⚠️ AUTORIZAȚIE EXPIRATĂ' : ''}
              </option>
            ))}
          </select>
        </div>
        {!f.furnizor_id && (
          <div style={{marginBottom:12}}>
            <label style={S.label}>Nume furnizor</label>
            <input style={S.input} value={f.furnizor_nume} onChange={e => set('furnizor_nume', e.target.value)} placeholder="ex: Protected Unit SRL" />
          </div>
        )}

        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:12}}>
          <div>
            <label style={S.label}>Nr. factură</label>
            <input style={S.input} value={f.numar_factura} onChange={e => set('numar_factura', e.target.value)} />
          </div>
          <div>
            <label style={S.label}>Data facturii</label>
            <input style={S.input} type="date" value={f.data_factura}
                   onChange={e => { set('data_factura', e.target.value); if (e.target.value) set('luna', e.target.value.slice(0,7) + '-01') }} />
          </div>
          <div>
            <label style={S.label}>Valoare (lei)</label>
            <input style={S.input} type="number" step="0.01" value={f.valoare} onChange={e => set('valoare', e.target.value)} autoFocus />
          </div>
        </div>

        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:18}}>
          <div>
            <label style={S.label}>Se scade din luna</label>
            <input style={S.input} type="month" value={String(f.luna).slice(0,7)} onChange={e => set('luna', e.target.value + '-01')} />
          </div>
          <div>
            <label style={S.label}>Descriere</label>
            <input style={S.input} value={f.descriere} onChange={e => set('descriere', e.target.value)} placeholder="ex: hârtie A4, consumabile birou" />
          </div>
        </div>

        <div style={{display:'flex', gap:10, justifyContent:'flex-end'}}>
          <button onClick={onClose} style={S.btnS}>Renunță</button>
          <button onClick={salveaza} disabled={lucrez} style={{...S.btnP, opacity:lucrez ? .6 : 1}}>{lucrez ? 'Salvez…' : 'Adaugă'}</button>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
export default function UnitatiProtejate({ profile }) {
  const [setari, setSetari]       = useState({})
  const [achizitii, setAchizitii] = useState([])
  const [furnizori, setFurnizori] = useState([])
  const [rundaDeschisa, setRunda] = useState(null)
  const [cumulat, setCumulat]     = useState([])
  const [load, setLoad]           = useState(true)
  const [mesaj, setMesaj]         = useState(null)
  const [formAch, setFormAch]     = useState(false)
  const [citesteOpen, setCitesteOpen] = useState(false)
  const [editPlafon, setEditPlafon] = useState(false)
  const [plafonNou, setPlafonNou] = useState('')

  const incarca = useCallback(async () => {
    setLoad(true)
    try {
      const [st, ac, fz, rd] = await Promise.all([
        supabase.from('logistica_setari').select('key, value').like('key', 'upa_%'),
        supabase.from('upa_achizitii').select('*, furnizor:logistica_furnizori(nume, upa_valabil_pana)').order('luna', { ascending:false }).order('id', { ascending:false }),
        supabase.from('logistica_furnizori').select('id, nume, cui, este_upa, upa_autorizatie, upa_valabil_pana').eq('este_upa', true).eq('activ', true).order('nume'),
        supabase.from('necesar_runde').select('id, saptamana, status').in('status', ['deschisa','blocata']).order('saptamana', { ascending:false }).limit(1),
      ])
      setSetari(Object.fromEntries((st.data || []).map(r => [r.key, r.value])))
      setAchizitii(ac.data || [])
      setFurnizori(fz.data || [])
      const r = (rd.data || [])[0] || null
      setRunda(r)
      if (r) {
        const { data: cum } = await supabase.from('v_necesar_cumulat').select('categorie, articol, cantitate_totala, um, locatie').eq('runda_id', r.id)
        setCumulat(cum || [])
      }
    } catch (e) { setMesaj({ tip:'error', text:'Nu am putut încărca: ' + (e.message || e) }) }
    finally { setLoad(false) }
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { incarca() }, [incarca])

  const plafon = Number(setari.upa_plafon_lunar || 0)
  const luna = lunaAcum()

  const consumat = useMemo(() =>
    achizitii.filter(a => String(a.luna).slice(0,7) === luna.slice(0,7))
      .reduce((s, a) => s + Number(a.valoare || 0), 0), [achizitii, luna])
  const ramas = Math.max(0, plafon - consumat)
  const procent = plafon ? Math.min(100, Math.round(consumat / plafon * 100)) : 0
  const zile = zileRamase()

  // Categoriile pe care le vând tipic unitățile protejate — folosite ca să
  // estimăm cât din runda de consumabile ar putea merge pe plafon.
  const potrivitUpa = useMemo(() =>
    cumulat.filter(c => ['papetarie','curatenie','protocol','diverse'].includes(c.categorie)), [cumulat])

  const salveazaPlafon = async () => {
    const v = Number(plafonNou)
    if (!v || v <= 0) { setMesaj({ tip:'warn', text:'Plafonul trebuie să fie mai mare ca zero.' }); return }
    try {
      const { error } = await supabase.from('logistica_setari')
        .update({ value: String(v) }).eq('key', 'upa_plafon_lunar')
      if (error) throw error
      setSetari(p => ({ ...p, upa_plafon_lunar: String(v) }))
      setEditPlafon(false)
      setMesaj({ tip:'success', text:`Plafon lunar setat: ${lei(v)} lei` })
    } catch (e) { setMesaj({ tip:'error', text:'Eroare: ' + (e.message || e) }) }
  }

  const sterge = async (a) => {
    if (!confirm(`Ștergi achiziția de ${lei(a.valoare)} lei${a.numar_factura ? ' (factura ' + a.numar_factura + ')' : ''}?`)) return
    try {
      const { error } = await supabase.from('upa_achizitii').delete().eq('id', a.id)
      if (error) throw error
      setAchizitii(p => p.filter(x => x.id !== a.id))
      setMesaj({ tip:'success', text:'Șters.' })
    } catch (e) { setMesaj({ tip:'error', text:'Eroare: ' + (e.message || e) }) }
  }

  // Istoric pe ultimele 6 luni, ca să se vadă cât s-a pierdut
  const istoric = useMemo(() => {
    const m = {}
    for (const a of achizitii) {
      const k = String(a.luna).slice(0,7)
      m[k] = (m[k] || 0) + Number(a.valoare || 0)
    }
    return Object.entries(m).sort((a,b) => b[0].localeCompare(a[0])).slice(0, 6)
  }, [achizitii])

  const expirate = furnizori.filter(f => f.upa_valabil_pana && f.upa_valabil_pana < azi())

  if (load) return <div style={{color:G.muted, fontSize:14, padding:'40px 0', textAlign:'center'}}>Se încarcă…</div>

  const culoare = procent >= 100 ? G.green : (zile <= 7 && procent < 70) ? G.red : procent >= 50 ? G.yellow : G.orange

  return (
    <div style={{padding:'4px 0 24px', color:G.text}}>
      <Mesaj mesaj={mesaj} onClose={() => setMesaj(null)} />

      {/* Contorul lunii */}
      <div style={{...S.card, padding:'18px 20px', marginBottom:16, borderColor:culoare+'44'}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:14, flexWrap:'wrap', marginBottom:14}}>
          <div>
            <div style={{fontSize:11, color:G.muted, fontWeight:700, textTransform:'uppercase', letterSpacing:.4}}>Plafon deductibil · {fmtLuna(luna)}</div>
            <div style={{fontSize:30, fontWeight:800, marginTop:6, color:culoare}}>
              {lei(consumat)} <span style={{fontSize:17, color:G.muted, fontWeight:600}}>/ {lei(plafon)} lei</span>
            </div>
            <div style={{fontSize:12, color:G.muted, marginTop:5}}>
              {ramas > 0
                ? <>Mai ai <b style={{color:culoare}}>{lei(ramas)} lei</b> de consumat · {zile} {zile === 1 ? 'zi rămasă' : 'zile rămase'} din lună</>
                : <>Plafon consumat integral 🎉</>}
            </div>
          </div>
          <div style={{display:'flex', gap:8}}>
            {editPlafon ? (
              <>
                <input style={{...S.input, width:120}} type="number" value={plafonNou} onChange={e => setPlafonNou(e.target.value)} placeholder="lei" />
                <button onClick={salveazaPlafon} style={S.btnP}>Salvează</button>
                <button onClick={() => setEditPlafon(false)} style={S.btnS}>✕</button>
              </>
            ) : (
              <>
                <button onClick={() => { setPlafonNou(String(plafon)); setEditPlafon(true) }} style={S.btnS}>⚙️ Plafon</button>
                <button onClick={() => setCitesteOpen(true)} style={{...S.btnS, color:'#2DD4BF', borderColor:'#2DD4BF55'}}>🤖 Citește factura (AI)</button>
                <button onClick={() => setFormAch(true)} style={S.btnP}>➕ Achiziție</button>
              </>
            )}
          </div>
        </div>

        <div style={{height:12, background:G.bg, borderRadius:8, overflow:'hidden', border:`1px solid ${G.border}`}}>
          <div style={{width:procent + '%', height:'100%', background:culoare, transition:'width .3s'}} />
        </div>
        <div style={{fontSize:11, color:G.dim, marginTop:7}}>
          {procent}% consumat · plafonul <b>nu se reportează</b> — ce nu se consumă până la finalul lunii se pierde.
        </div>
      </div>

      {/* Alertă autorizații expirate */}
      {expirate.length > 0 && (
        <div style={{...S.card, padding:'11px 15px', marginBottom:14, borderColor:G.red+'55', background:G.red+'11', fontSize:13, color:G.red}}>
          ⚠️ <b>{expirate.length}</b> {expirate.length === 1 ? 'furnizor UPA are autorizația expirată' : 'furnizori UPA au autorizația expirată'}: {expirate.map(f => f.nume).join(', ')} — facturile de la ei nu se mai acceptă la deducere.
        </div>
      )}

      {/* Direcționarea rundei de consumabile */}
      {rundaDeschisa && potrivitUpa.length > 0 && ramas > 0 && (
        <div style={{...S.card, padding:'14px 18px', marginBottom:16, borderColor:G.purple+'44', background:G.purple+'0C'}}>
          <div style={{fontSize:13, fontWeight:800, color:G.purple, marginBottom:6}}>
            🛒 Runda de consumabile ({rundaDeschisa.saptamana}) — {potrivitUpa.length} poziții s-ar putea lua de la UPA
          </div>
          <div style={{fontSize:12, color:G.muted, lineHeight:1.6}}>
            Papetărie, curățenie, protocol și diverse din runda curentă intră în ce vând unitățile protejate.
            Mai ai <b style={{color:G.purple}}>{lei(ramas)} lei</b> de consumat luna asta — cere ofertă de la un furnizor UPA
            înainte să dai comanda pe Freshful/eMAG.
          </div>
          <div style={{fontSize:11, color:G.dim, marginTop:8}}>
            {potrivitUpa.slice(0, 8).map(c => `${c.articol} (${c.cantitate_totala} ${c.um})`).join(' · ')}
            {potrivitUpa.length > 8 ? ` · …și încă ${potrivitUpa.length - 8}` : ''}
          </div>
        </div>
      )}

      {/* Furnizori UPA */}
      <div style={{...S.card, marginBottom:16, overflow:'hidden'}}>
        <div style={{padding:'11px 16px', background:G.bg, borderBottom:`1px solid ${G.border}`, fontSize:13, fontWeight:800, display:'flex', justifyContent:'space-between', alignItems:'center', gap:10, flexWrap:'wrap'}}>
          <span>🏭 Furnizori — unități protejate ({furnizori.length})</span>
          <span style={{fontSize:11, color:G.dim, fontWeight:600}}>se marchează din Administrativ → Furnizori</span>
        </div>
        {furnizori.length === 0 ? (
          <div style={{padding:'22px 16px', textAlign:'center', color:G.muted, fontSize:13}}>
            Niciun furnizor marcat ca unitate protejată. Deschide <b>Administrativ → Furnizori</b>, editează furnizorul și bifează „Unitate protejată autorizată".
          </div>
        ) : furnizori.map(f => {
          const exp = f.upa_valabil_pana && f.upa_valabil_pana < azi()
          return (
            <div key={f.id} style={{padding:'9px 16px', borderBottom:`1px solid ${G.border2}`, display:'flex', gap:12, alignItems:'center', flexWrap:'wrap'}}>
              <span style={{fontSize:13, fontWeight:700, flex:'1 1 200px'}}>{f.nume}</span>
              <span style={{fontSize:11, color:G.muted}}>{f.cui || '—'}</span>
              <span style={{fontSize:11, color:G.muted}}>Aut.: {f.upa_autorizatie || '—'}</span>
              <span style={{fontSize:11, fontWeight:700, color: exp ? G.red : G.green}}>
                {f.upa_valabil_pana ? (exp ? '⚠️ expirată ' : 'valabilă până ') + fmtData(f.upa_valabil_pana) : 'fără dată'}
              </span>
            </div>
          )
        })}
      </div>

      {/* Achiziții luna curentă */}
      <div style={{...S.card, marginBottom:16, overflow:'hidden'}}>
        <div style={{padding:'11px 16px', background:G.bg, borderBottom:`1px solid ${G.border}`, fontSize:13, fontWeight:800}}>
          🧾 Achiziții {fmtLuna(luna)}
        </div>
        {achizitii.filter(a => String(a.luna).slice(0,7) === luna.slice(0,7)).length === 0 ? (
          <div style={{padding:'22px 16px', textAlign:'center', color:G.muted, fontSize:13}}>
            Nicio achiziție luna asta. Ai <b style={{color:G.orange}}>{lei(plafon)} lei</b> de consumat în {zile} {zile === 1 ? 'zi' : 'zile'}.
          </div>
        ) : achizitii.filter(a => String(a.luna).slice(0,7) === luna.slice(0,7)).map(a => (
          <div key={a.id} style={{padding:'10px 16px', borderBottom:`1px solid ${G.border2}`, display:'grid', gridTemplateColumns:'1fr 130px 110px 60px', gap:12, alignItems:'center'}}>
            <div style={{minWidth:0}}>
              <div style={{fontSize:13, fontWeight:700}}>{a.furnizor?.nume || a.furnizor_nume || '—'}</div>
              <div style={{fontSize:11, color:G.dim}}>
                {a.numar_factura ? 'Factura ' + a.numar_factura : 'fără număr'}{a.descriere ? ' · ' + a.descriere : ''}
              </div>
            </div>
            <div style={{fontSize:11, color:G.muted}}>{fmtData(a.data_factura)}</div>
            <div style={{fontSize:14, fontWeight:800, color:G.green, textAlign:'right', fontVariantNumeric:'tabular-nums'}}>{lei(a.valoare)}</div>
            <button onClick={() => sterge(a)} style={{...S.btnS, padding:'4px 8px', fontSize:11, color:G.red, borderColor:G.red+'44'}}>✕</button>
          </div>
        ))}
      </div>

      {/* Istoric */}
      {istoric.length > 1 && (
        <div style={{...S.card, overflow:'hidden'}}>
          <div style={{padding:'11px 16px', background:G.bg, borderBottom:`1px solid ${G.border}`, fontSize:13, fontWeight:800}}>📊 Ultimele luni</div>
          {istoric.map(([k, v]) => {
            const pierdut = Math.max(0, plafon - v)
            const eLunaCurenta = k === luna.slice(0,7)
            return (
              <div key={k} style={{padding:'9px 16px', borderBottom:`1px solid ${G.border2}`, display:'flex', gap:12, alignItems:'center', fontSize:12}}>
                <span style={{flex:'1 1 auto', fontWeight:600}}>{fmtLuna(k + '-01')}</span>
                <span style={{color:G.green, fontWeight:700}}>{lei(v)} lei</span>
                {!eLunaCurenta && pierdut > 0 && <span style={{color:G.red, fontSize:11}}>· {lei(pierdut)} lei neconsumați</span>}
                {!eLunaCurenta && pierdut === 0 && <span style={{color:G.green, fontSize:11}}>· plafon consumat ✓</span>}
                {eLunaCurenta && <span style={{color:G.muted, fontSize:11}}>· în curs</span>}
              </div>
            )
          })}
        </div>
      )}

      {formAch && (
        <FormAchizitie furnizoriUpa={furnizori} setMesaj={setMesaj}
                       onSalvat={incarca} onClose={() => setFormAch(false)} />
      )}

      {/* Citește Orice pe destinația UPA: arunci factura, AI extrage furnizor/număr/
          valoare, confirmi → intră în plafon cu PDF-ul ca dovadă. */}
      {citesteOpen && profile && (
        <CitesteOricePanel
          open={citesteOpen}
          modul="upa"
          profile={profile}
          onClose={() => setCitesteOpen(false)}
          onConfirmed={() => incarca()}
        />
      )}
    </div>
  )
}
