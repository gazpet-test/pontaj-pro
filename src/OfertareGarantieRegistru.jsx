// Legătura licitație ↔ Registru garanții (01.10.2026, Răzvan): garanția de participare a licitației
// în tabela `garantii` (tip='participare', licitatie_id). Creează doar owner-ul sau cine are 'financiar.garantii'.
// NU trimite nimic — mailul către broker rămâne în fluxul „Cere ofertă poliță” de mai jos, pornit de om.
import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase.js'
import { poateCreaGarantie, stareGarantieOfertare } from './financiarAcces.js'

const C = { border:'#30363D', muted:'#8B949E', text:'#E6EDF3', green:'#3FB950', blue:'#58A6FF', bg:'#0D1117' }
const inp = { width:'100%', boxSizing:'border-box', background:C.bg, border:`1px solid ${C.border}`, borderRadius:6, padding:'6px 9px', color:C.text, fontSize:12.5, colorScheme:'dark' }
const btn = { padding:'6px 12px', background:C.blue + '22', color:C.blue, border:`1px solid ${C.blue}66`, borderRadius:7, cursor:'pointer', fontSize:12, fontWeight:700 }
const num = v => { const n = Number(String(v ?? '').replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : '' }

export default function GarantieRegistruLink({ licitatie: l, profile, valabilPana }) {
  const [g, setG] = useState(undefined)
  const [mods, setMods] = useState([])
  const [form, setForm] = useState(null)
  const [err, setErr] = useState(null)

  const load = async () => {
    const { data } = await supabase.from('garantii').select('id, stare, valoare, moneda, data_emitere, data_expirare, numar_document, emitent, forma')
      .eq('licitatie_id', l.id).eq('tip', 'participare').order('id', { ascending: false }).limit(1).maybeSingle()
    setG(data || null)
  }
  useEffect(() => { load() }, [l.id])
  useEffect(() => {
    if (!profile?.id) return
    supabase.from('user_module_access').select('module').eq('profile_id', profile.id).then(({ data }) => setMods((data || []).map(m => m.module)))
  }, [profile?.id])

  const poate = poateCreaGarantie(profile, mods)
  const deschide = () => setForm({ beneficiar: l.autoritate || '', valoare: num(l.garantie_participare), moneda: l.moneda || 'RON',
    data_expirare: valabilPana ? String(valabilPana).slice(0, 10) : '', forma: 'polita_asigurare' })
  const salveaza = async () => {
    if (!form.beneficiar.trim()) return setErr('Beneficiarul e obligatoriu.')
    setErr(null)
    const { error } = await supabase.from('garantii').insert({
      tip: 'participare', forma: form.forma, licitatie_id: l.id, beneficiar: form.beneficiar.trim(), lucrare: l.obiect || null,
      valoare: form.valoare === '' ? null : Number(form.valoare), moneda: form.moneda, data_expirare: form.data_expirare || null,
      observatii: `Creată din licitația ${l.nr_anunt || l.id}`,
    })
    if (error) return setErr(error.message)
    setForm(null); load()
  }

  if (g === undefined) return null
  return (
    <div style={{ border:`1px solid ${C.border}`, borderRadius:8, padding:'10px 12px', marginBottom:12, fontSize:12.5, color:C.text }}>
      <b>🏛 Registru garanții:</b>{' '}
      {g ? <>
        <span style={{ color:C.green, fontWeight:700 }}>{stareGarantieOfertare(g)}</span>
        <span style={{ color:C.muted }}>{g.valoare ? ` · ${Number(g.valoare).toLocaleString('ro-RO')} ${g.moneda}` : ''}{g.numar_document ? ` · nr. ${g.numar_document}` : ''}{g.emitent ? ` · ${g.emitent}` : ''}{g.data_expirare ? ` · valabilă până la ${new Date(g.data_expirare + 'T00:00:00').toLocaleDateString('ro-RO')}` : ''}</span>
        {' '}<a href="/financiar?tab=garantii" style={{ color:C.blue }}>deschide în Registru →</a>
      </> : <span style={{ color:C.muted }}>nicio garanție de participare înregistrată pentru licitație.</span>}
      {!g && poate && !form && <div style={{ marginTop:8 }}><button style={btn} onClick={deschide}>＋ Creează în Registru garanții</button></div>}
      {!g && form && (
        <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 80px 1fr 1fr', gap:8, marginTop:8, alignItems:'end' }}>
          <label>Beneficiar<input style={inp} value={form.beneficiar} onChange={e => setForm({ ...form, beneficiar: e.target.value })} /></label>
          <label>Valoare<input style={inp} type="number" value={form.valoare} onChange={e => setForm({ ...form, valoare: e.target.value })} /></label>
          <label>Monedă<input style={inp} value={form.moneda} onChange={e => setForm({ ...form, moneda: e.target.value })} /></label>
          <label>Valabilă până la<input style={inp} type="date" value={form.data_expirare} onChange={e => setForm({ ...form, data_expirare: e.target.value })} /></label>
          <label>Formă<select style={inp} value={form.forma} onChange={e => setForm({ ...form, forma: e.target.value })}>
            <option value="polita_asigurare">Poliță asigurare</option><option value="scrisoare_bancara">Scrisoare bancară</option>
            <option value="depozit_bancar">Depozit bancar</option><option value="depozit_trezorerie">Cont trezorerie</option></select></label>
          <div style={{ gridColumn:'1 / -1', display:'flex', gap:8 }}>
            <button style={btn} onClick={salveaza}>💾 Salvează în Registru</button>
            <button style={{ ...btn, color:C.muted, borderColor:C.border, background:'transparent' }} onClick={() => setForm(null)}>Renunță</button>
            {err && <span style={{ color:'#F85149' }}>{err}</span>}
          </div>
        </div>
      )}
    </div>
  )
}
