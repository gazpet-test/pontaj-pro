// ═══════════════════════════════════════════════════════════════════════════
// UNITĂȚI PROTEJATE — plafon lunar deductibil
// ═══════════════════════════════════════════════════════════════════════════
// Legea 448/2006 art. 78 + Legea 193/2020: neavând 4% angajați cu dizabilități,
// firma plătește lunar contribuția, dar poate deduce o parte din ea cumpărând
// de la unități protejate autorizate (UPA), până la un plafon lunar SETAT de firmă.
// Plafonul NU se reportează — ce nu se cheltuie într-o lună se plătește la bugetul de stat.
// 20261229a: plafonul e VERSIONAT pe lună (upa_plafon_lunar); situația pe luni,
// banner-ul și alerta vin din BD (fn_upa_luni = o singură definiție, L19);
// luna încheiată rămâne în upa_luna_inchisa (instantaneul de la închidere).
// Scrierea (achiziții, plafon) doar owner + Administrativ / Unități protejate
// admin sau editor (fn_upa_poate_scrie, aceeași regulă ca în BD).
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { supabase } from './lib/supabase.js'
import CitesteOricePanel from './CitesteOricePanel.jsx'
import { paginareKeyset } from './hrDeciziiUtil.js'
import { avertismenteAchizitie, validaPlafon, starePlafonLuna, ziRO, lunaDinZi, luniInapoi } from './upaLogica.js'

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
const BUCKET = 'documente-upa'
const MAX_PDF = 10 * 1024 * 1024

const lei = (n) => (Number(n) || 0).toLocaleString('ro-RO', { minimumFractionDigits:2, maximumFractionDigits:2 })
const fmtLuna = (d) => d ? new Date(String(d).slice(0,10)+'T00:00:00').toLocaleDateString('ro-RO', { month:'long', year:'numeric' }) : '—'
const fmtData = (d) => d ? new Date(String(d).slice(0,10)+'T00:00:00').toLocaleDateString('ro-RO', { day:'2-digit', month:'short', year:'numeric' }) : '—'
const zileTxt = (z) => z === 1 ? '1 zi rămasă' : `${z} ${z >= 20 ? 'de ' : ''}zile rămase`

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
  const [f, setF] = useState(() => {
    const zi = ziRO()
    return { furnizor_id:'', furnizor_nume:'', numar_factura:'', data_factura: zi, valoare:'', descriere:'', luna: lunaDin(zi) }
  })
  const [pdf, setPdf] = useState(null)
  const [lucrez, setLucrez] = useState(false)
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const avertismente = avertismenteAchizitie({ dataFactura: f.data_factura, luna: f.luna, arePdf: !!pdf })

  const alegePdf = (file) => {
    if (!file) { setPdf(null); return }
    if (file.type !== 'application/pdf') { setMesaj({ tip:'warn', text:'Doar fișiere PDF.' }); return }
    if (file.size > MAX_PDF) { setMesaj({ tip:'warn', text:'PDF-ul are peste 10 MB.' }); return }
    setPdf(file)
  }

  const salveaza = async () => {
    if (lucrez) return
    if (!f.numar_factura.trim()) { setMesaj({ tip:'warn', text:'Numărul facturii e obligatoriu.' }); return }
    const v = Number(f.valoare)
    if (!Number.isFinite(v) || v <= 0) { setMesaj({ tip:'warn', text:'Pune valoarea facturii.' }); return }
    if (!f.furnizor_id && !f.furnizor_nume.trim()) { setMesaj({ tip:'warn', text:'Alege furnizorul sau scrie-i numele.' }); return }
    // avertismente, nu blocări: omul confirmă că vrea să salveze așa
    if (avertismente.length && !confirm('Atenție:\n• ' + avertismente.map(a => a.text).join('\n• ') + '\n\nSalvezi oricum?')) return
    setLucrez(true)
    let cale = null
    try {
      if (pdf) {
        cale = `manual/${String(f.luna).slice(0,7)}/${crypto.randomUUID()}.pdf`
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(cale, pdf, { upsert:false, contentType:'application/pdf' })
        if (upErr) { cale = null; throw new Error('PDF-ul nu s-a încărcat: ' + upErr.message) }
      }
      const { error } = await supabase.from('upa_achizitii').insert({
        furnizor_id: f.furnizor_id ? Number(f.furnizor_id) : null,
        furnizor_nume: f.furnizor_id ? null : f.furnizor_nume.trim(),
        numar_factura: f.numar_factura.trim(),
        data_factura: f.data_factura || null,
        luna: f.luna, valoare: v,
        descriere: f.descriere.trim() || null,
        document_path: cale,
      })
      if (error) {
        // L05: PDF-ul se scoate doar când serverul a răspuns clar cu refuz (cod de eroare); la rețea / timeout rămâne
        if (cale && error.code) await supabase.storage.from(BUCKET).remove([cale]).catch(() => {})
        throw error
      }
      setMesaj({ tip:'success', text:`Adăugat: ${lei(v)} lei pe ${fmtLuna(f.luna)}${pdf ? '' : ' (fără PDF)'}` })
      onSalvat(); onClose()
    } catch (e) {
      const drept = e?.code === '42501'
      setMesaj({ tip:'error', text: drept ? 'Nu ai drept să adaugi achiziții (cere acces Administrativ › Unități protejate, editor).' : 'Eroare: ' + (e.message || e) })
    }
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
                {fz.nume}{fz.upa_valabil_pana && fz.upa_valabil_pana < ziRO() ? ' ⚠️ AUTORIZAȚIE EXPIRATĂ' : ''}
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
            <label style={S.label}>Nr. factură *</label>
            <input style={{...S.input, borderColor: f.numar_factura.trim() ? G.border : G.yellow+'88'}} value={f.numar_factura} onChange={e => set('numar_factura', e.target.value)} />
          </div>
          <div>
            <label style={S.label}>Data facturii</label>
            <input style={S.input} type="date" value={f.data_factura}
                   onChange={e => { set('data_factura', e.target.value); if (e.target.value) set('luna', lunaDin(e.target.value)) }} />
          </div>
          <div>
            <label style={S.label}>Valoare (lei)</label>
            <input style={S.input} type="number" step="0.01" value={f.valoare} onChange={e => set('valoare', e.target.value)} autoFocus />
          </div>
        </div>

        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12}}>
          <div>
            <label style={S.label}>Se scade din luna</label>
            <input style={S.input} type="month" value={String(f.luna).slice(0,7)} onChange={e => e.target.value && set('luna', e.target.value + '-01')} />
          </div>
          <div>
            <label style={S.label}>Descriere</label>
            <input style={S.input} value={f.descriere} onChange={e => set('descriere', e.target.value)} placeholder="ex: hârtie A4, consumabile birou" />
          </div>
        </div>

        <div style={{marginBottom:14}}>
          <label style={S.label}>Factura (PDF)</label>
          <input type="file" accept="application/pdf" onChange={e => alegePdf(e.target.files?.[0] || null)} style={{fontSize:12, color:G.muted}} />
        </div>

        {avertismente.length > 0 && (
          <div style={{...S.card, padding:'9px 12px', marginBottom:14, borderColor:G.yellow+'55', background:G.yellow+'11', fontSize:12, color:G.yellow, lineHeight:1.6}}>
            {avertismente.map(a => <div key={a.cod}>⚠️ {a.text}</div>)}
          </div>
        )}

        <div style={{display:'flex', gap:10, justifyContent:'flex-end'}}>
          <button onClick={onClose} style={S.btnS}>Renunță</button>
          <button onClick={salveaza} disabled={lucrez} style={{...S.btnP, opacity:lucrez ? .6 : 1}}>{lucrez ? 'Salvez…' : 'Adaugă'}</button>
        </div>
      </div>
    </div>
  )
}
const lunaDin = (zi) => lunaDinZi(zi) || lunaDinZi(ziRO())

// ═══════════════════════════════════════════════════════════════════════════
export default function UnitatiProtejate({ profile }) {
  const [achizitii, setAchizitii] = useState([])
  const [luni, setLuni]           = useState([])        // fn_upa_luni: 12 luni, cea curentă prima
  const [poateScrie, setPoateScrie] = useState(null)    // null = necunoscut (eroare la verificare)
  const [furnizori, setFurnizori] = useState([])
  const [rundaDeschisa, setRunda] = useState(null)
  const [cumulat, setCumulat]     = useState([])
  const [load, setLoad]           = useState(true)
  const [mesaj, setMesaj]         = useState(null)
  const [formAch, setFormAch]     = useState(false)
  const [citesteOpen, setCitesteOpen] = useState(false)
  const [editPlafon, setEditPlafon] = useState(false)
  const [plafonNou, setPlafonNou] = useState('')
  const [lunaSel, setLunaSel]     = useState(() => lunaDin(ziRO()).slice(0,7))   // TKT-2026-0177: istoric comenzi pe luni
  const generatie = useRef(0)   // L24: doar ultima încărcare își aplică rezultatul

  const incarca = useCallback(async () => {
    const gen = ++generatie.current
    setLoad(true)
    try {
      const deLa = luniInapoi(ziRO(), 11)
      const [ln, ps, ac, fz, rd] = await Promise.all([
        supabase.rpc('fn_upa_luni', { p_azi: null, p_luni: 12 }),
        supabase.rpc('fn_upa_poate_scrie'),
        // L23: toate achizițiile din ultimele 12 luni, pe pagini (keyset pe id), nu un singur select tăiat la 1000
        paginareKeyset((ultim, pas) => {
          let q = supabase.from('upa_achizitii').select('*, furnizor:logistica_furnizori(nume, upa_valabil_pana)')
            .gte('luna', deLa).order('id', { ascending:true }).limit(pas)
          if (ultim != null) q = q.gt('id', ultim)
          return q
        }),
        supabase.from('logistica_furnizori').select('id, nume, cui, este_upa, upa_autorizatie, upa_valabil_pana').eq('este_upa', true).eq('activ', true).order('nume'),
        supabase.from('necesar_runde').select('id, saptamana, status').in('status', ['deschisa','blocata']).order('saptamana', { ascending:false }).limit(1),
      ])
      if (ln.error) throw ln.error
      if (fz.error) throw fz.error
      if (gen !== generatie.current) return
      setLuni(ln.data || [])
      setPoateScrie(ps.error ? null : ps.data === true)
      if (ps.error) setMesaj({ tip:'warn', text:'Nu am putut verifica dreptul de modificare; butoanele de scriere sunt ascunse.' })
      setAchizitii([...ac].sort((a, b) => String(b.luna).localeCompare(String(a.luna)) || b.id - a.id))
      setFurnizori(fz.data || [])
      const r = rd.error ? null : (rd.data || [])[0] || null
      setRunda(r)
      if (r) {
        const { data: cum } = await supabase.from('v_necesar_cumulat').select('categorie, articol, cantitate_totala, um, locatie').eq('runda_id', r.id)
        if (gen === generatie.current) setCumulat(cum || [])
      }
    } catch (e) { if (gen === generatie.current) setMesaj({ tip:'error', text:'Nu am putut încărca: ' + (e.message || e) }) }
    finally { if (gen === generatie.current) setLoad(false) }
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { incarca() }, [incarca])

  // luna curentă = rândul calculat de server (ziua din România)
  const cur = luni.find(l => l.e_curenta) || null
  const luna = cur ? String(cur.luna).slice(0,10) : lunaDin(ziRO())
  const plafon = cur && cur.plafon != null ? Number(cur.plafon) : null
  const consumat = cur ? Number(cur.consumat) || 0 : 0
  const ramas = plafon != null ? Math.max(0, plafon - consumat) : 0
  const procent = plafon ? Math.min(100, Math.round(consumat / plafon * 100)) : 0
  const zile = cur?.zile_ramase ?? 0

  // Categoriile pe care le vând tipic unitățile protejate — folosite ca să
  // estimăm cât din runda de consumabile ar putea merge pe plafon.
  const potrivitUpa = useMemo(() =>
    cumulat.filter(c => ['papetarie','curatenie','protocol','diverse'].includes(c.categorie)), [cumulat])

  const salveazaPlafon = async () => {
    const v = validaPlafon(plafonNou)
    if (v.eroare) { setMesaj({ tip:'warn', text: v.eroare }); return }
    try {
      const { error } = await supabase.rpc('fn_upa_plafon_seteaza', { p_plafon: v.valoare, p_vechi: plafon })
      if (error) {
        if (error.code === '40001') { setMesaj({ tip:'warn', text:'Plafonul s-a schimbat între timp (din alt ecran). Am reîncărcat valoarea curentă.' }); setEditPlafon(false); incarca(); return }
        if (error.code === '42501') throw new Error('nu ai drept de modificare a plafonului (cere acces Administrativ › Unități protejate, editor)')
        throw error
      }
      setEditPlafon(false)
      setMesaj({ tip:'success', text:`Plafon setat de la ${fmtLuna(luna)}: ${lei(v.valoare)} lei (lunile trecute își păstrează plafonul lor)` })
      incarca()
    } catch (e) { setMesaj({ tip:'error', text:'Eroare: ' + (e.message || e) }) }
  }

  const sterge = async (a) => {
    if (!confirm(`Ștergi achiziția de ${lei(a.valoare)} lei${a.numar_factura ? ' (factura ' + a.numar_factura + ')' : ''}?`)) return
    try {
      // RLS filtrează tăcut o ștergere nepermisă (0 rânduri, fără eroare): confirmăm exact un rând
      const { data, error } = await supabase.from('upa_achizitii').delete().eq('id', a.id).select('id')
      if (error) throw error
      if ((data || []).length !== 1) throw new Error('nu s-a șters nimic (nu ai drept sau a fost deja ștearsă)')
      setMesaj({ tip:'success', text:'Șters.' })
      incarca()
    } catch (e) { setMesaj({ tip:'error', text:'Eroare: ' + (e.message || e) }) }
  }

  const deschidePdf = async (a) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(a.document_path, 60)
    if (error || !data?.signedUrl) { setMesaj({ tip:'error', text:'Nu am putut deschide PDF-ul: ' + (error?.message || 'link lipsă') }); return }
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  const azi = ziRO()
  const expirate = furnizori.filter(f => f.upa_valabil_pana && f.upa_valabil_pana < azi)
  const luniDisponibile = useMemo(() => {
    const set = new Set(luni.map(l => String(l.luna).slice(0,7)))
    achizitii.forEach(a => set.add(String(a.luna).slice(0,7)))
    set.add(luna.slice(0,7))
    return [...set].sort((a,b) => b.localeCompare(a))
  }, [achizitii, luni, luna])
  const achizitiiLuna = achizitii.filter(a => String(a.luna).slice(0,7) === lunaSel)
  const totalLunaSel = achizitiiLuna.reduce((s, a) => s + Number(a.valoare || 0), 0)

  if (load && !luni.length) return <div style={{color:G.muted, fontSize:14, padding:'40px 0', textAlign:'center'}}>Se încarcă…</div>

  const culoare = plafon == null ? G.yellow : procent >= 100 ? G.green : cur?.in_alerta ? G.red : procent >= 50 ? G.yellow : G.orange

  return (
    <div style={{padding:'4px 0 24px', color:G.text}}>
      <Mesaj mesaj={mesaj} onClose={() => setMesaj(null)} />

      {/* Alerta lunii: după ziua din setări, sub plafon (in_alerta calculat de server) */}
      {cur?.in_alerta === true && (
        <div style={{...S.card, padding:'13px 16px', marginBottom:14, borderColor:G.red, background:G.red+'22', fontSize:14, color:G.red, fontWeight:700, lineHeight:1.5}}>
          🚨 Fond handicap {fmtLuna(luna)}: cheltuit {lei(consumat)} din {lei(plafon)} lei — rămân <b>{lei(ramas)} lei</b>, {zileTxt(zile)}.
          <div style={{fontSize:12, fontWeight:600, marginTop:3}}>Ce nu se cheltuie la unități protejate până la sfârșitul lunii se plătește la bugetul de stat.</div>
        </div>
      )}
      {cur && cur.zi_prag == null && (
        <div style={{...S.card, padding:'10px 14px', marginBottom:14, borderColor:G.yellow+'55', background:G.yellow+'11', fontSize:12, color:G.yellow}}>
          ⚠️ Ziua de la care pornește alerta nu e setată corect (upa_alerta_zi). Alerta zilnică nu rulează până se corectează.
        </div>
      )}

      {/* Contorul lunii */}
      <div style={{...S.card, padding:'18px 20px', marginBottom:16, borderColor:culoare+'44'}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:14, flexWrap:'wrap', marginBottom:14}}>
          <div>
            <div style={{fontSize:11, color:G.muted, fontWeight:700, textTransform:'uppercase', letterSpacing:.4}}>Plafon deductibil · {fmtLuna(luna)}</div>
            <div style={{fontSize:30, fontWeight:800, marginTop:6, color:culoare}}>
              {lei(consumat)} <span style={{fontSize:17, color:G.muted, fontWeight:600}}>/ {plafon != null ? lei(plafon) + ' lei' : 'plafon neînregistrat'}</span>
            </div>
            <div style={{fontSize:12, color:G.muted, marginTop:5}}>
              {plafon == null ? <>Setează plafonul lunii (⚙️ Plafon).</>
                : ramas > 0
                ? <>Mai ai <b style={{color:culoare}}>{lei(ramas)} lei</b> de cheltuit · {zileTxt(zile)} din lună{cur?.zi_prag ? ` · alerta pornește din ziua ${cur.zi_prag}` : ''}</>
                : <>Plafon consumat integral 🎉</>}
            </div>
          </div>
          <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
            {editPlafon ? (
              <>
                <input style={{...S.input, width:120}} type="number" step="0.01" value={plafonNou} onChange={e => setPlafonNou(e.target.value)} placeholder="lei" />
                <button onClick={salveazaPlafon} style={S.btnP}>Salvează</button>
                <button onClick={() => setEditPlafon(false)} style={S.btnS}>✕</button>
              </>
            ) : poateScrie === true ? (
              <>
                <button onClick={() => { setPlafonNou(plafon != null ? String(plafon) : ''); setEditPlafon(true) }} style={S.btnS} title="Plafonul nou se aplică de la luna curentă; lunile trecute își păstrează plafonul">⚙️ Plafon</button>
                <button onClick={() => setCitesteOpen(true)} style={{...S.btnS, color:'#2DD4BF', borderColor:'#2DD4BF55'}}>🤖 Citește factura (AI)</button>
                <button onClick={() => setFormAch(true)} style={S.btnP}>➕ Achiziție</button>
              </>
            ) : (
              <span style={{fontSize:11, color:G.dim, alignSelf:'center'}}>doar citire</span>
            )}
          </div>
        </div>

        <div style={{height:12, background:G.bg, borderRadius:8, overflow:'hidden', border:`1px solid ${G.border}`}}>
          <div style={{width:procent + '%', height:'100%', background:culoare, transition:'width .3s'}} />
        </div>
        <div style={{fontSize:11, color:G.dim, marginTop:7}}>
          {procent}% cheltuit · plafonul <b>nu se reportează</b> — ce nu se cheltuie până la finalul lunii se plătește la bugetul de stat.
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
            Mai ai <b style={{color:G.purple}}>{lei(ramas)} lei</b> de cheltuit luna asta — cere ofertă de la un furnizor UPA
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
          const exp = f.upa_valabil_pana && f.upa_valabil_pana < azi
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

      {/* Achizițiile lunii alese */}
      <div style={{...S.card, marginBottom:16, overflow:'hidden'}}>
        <div style={{padding:'11px 16px', background:G.bg, borderBottom:`1px solid ${G.border}`, fontSize:13, fontWeight:800, display:'flex', justifyContent:'space-between', alignItems:'center', gap:10, flexWrap:'wrap'}}>
          <span>🧾 Achiziții {fmtLuna(lunaSel + '-01')}{lunaSel === luna.slice(0,7) ? '' : ' (istoric)'}</span>
          <span style={{display:'flex', gap:8, alignItems:'center'}}>
            <span style={{fontSize:12, color:G.green, fontWeight:800}}>{lei(totalLunaSel)} lei · {achizitiiLuna.length} {achizitiiLuna.length === 1 ? 'achiziție' : 'achiziții'}</span>
            <select value={lunaSel} onChange={e => setLunaSel(e.target.value)} style={{...S.input, width:'auto', padding:'4px 8px', fontSize:12}}>
              {luniDisponibile.map(k => <option key={k} value={k}>{fmtLuna(k + '-01')}</option>)}
            </select>
          </span>
        </div>
        {achizitiiLuna.length === 0 ? (
          <div style={{padding:'22px 16px', textAlign:'center', color:G.muted, fontSize:13}}>
            {lunaSel === luna.slice(0,7)
              ? <>Nicio achiziție luna asta.{plafon != null && <> Ai <b style={{color:G.orange}}>{lei(plafon)} lei</b> de cheltuit în {zileTxt(zile)}.</>}</>
              : <>Nicio achiziție înregistrată în {fmtLuna(lunaSel + '-01')}.</>}
          </div>
        ) : achizitiiLuna.map(a => (
          <div key={a.id} style={{padding:'10px 16px', borderBottom:`1px solid ${G.border2}`, display:'grid', gridTemplateColumns:'1fr 120px 80px 110px 50px', gap:12, alignItems:'center'}}>
            <div style={{minWidth:0}}>
              <div style={{fontSize:13, fontWeight:700}}>{a.furnizor?.nume || a.furnizor_nume || '—'}</div>
              <div style={{fontSize:11, color:G.dim}}>
                {a.numar_factura ? 'Factura ' + a.numar_factura : <span style={{color:G.yellow}}>fără număr</span>}{a.descriere ? ' · ' + a.descriere : ''}
                {a.data_factura && String(a.data_factura).slice(0,7) !== String(a.luna).slice(0,7) && <span style={{color:G.yellow}}> · factură din altă lună</span>}
              </div>
            </div>
            <div style={{fontSize:11, color:G.muted}}>{fmtData(a.data_factura)}</div>
            <div>{a.document_path
              ? <button onClick={() => deschidePdf(a)} style={{...S.btnS, padding:'3px 8px', fontSize:11}}>📎 PDF</button>
              : <span style={{fontSize:11, color:G.yellow}}>fără PDF</span>}</div>
            <div style={{fontSize:14, fontWeight:800, color:G.green, textAlign:'right', fontVariantNumeric:'tabular-nums'}}>{lei(a.valoare)}</div>
            {poateScrie === true
              ? <button onClick={() => sterge(a)} style={{...S.btnS, padding:'4px 8px', fontSize:11, color:G.red, borderColor:G.red+'44'}}>✕</button>
              : <span />}
          </div>
        ))}
      </div>

      {/* Istoric pe 12 luni, cu plafonul FIECĂREI luni și suma necheltuită de la închidere; click = achizițiile lunii (TKT-2026-0177) */}
      {luni.length > 0 && (
        <div style={{...S.card, overflow:'hidden'}}>
          <div style={{padding:'11px 16px', background:G.bg, borderBottom:`1px solid ${G.border}`, fontSize:13, fontWeight:800}}>📊 Ultimele 12 luni</div>
          {luni.map(l => {
            const k = String(l.luna).slice(0,7)
            const st = starePlafonLuna(l)
            const c = st.ton === 'rosu' ? G.red : st.ton === 'verde' ? G.green : st.ton === 'galben' ? G.yellow : G.muted
            return (
              <div key={k} onClick={() => setLunaSel(k)} title="Arată achizițiile lunii" style={{padding:'9px 16px', borderBottom:`1px solid ${G.border2}`, display:'flex', gap:12, alignItems:'center', fontSize:12, cursor:'pointer', background: k === lunaSel ? G.bg : 'transparent', flexWrap:'wrap'}}>
                <span style={{flex:'1 1 140px', fontWeight:600}}>{fmtLuna(k + '-01')}{k === lunaSel ? ' ◂' : ''}</span>
                <span style={{color:G.muted, minWidth:120}}>plafon {l.plafon != null ? lei(l.plafon) + ' lei' : '—'}</span>
                <span style={{color:G.green, fontWeight:700, minWidth:110}}>{lei(l.consumat)} lei</span>
                <span style={{color:c, fontSize:11, flex:'1 1 220px'}}>· {st.text}</span>
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
