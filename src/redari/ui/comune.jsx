// Redări teren — paletă, stiluri și helper-e comune celor trei ecrane (Registru, Fișa parcelei, Import).
// Contract: docs/redari/CONTRACT_SCHEMA.md §9. Fără date reale aici.
import React, { useState, useCallback } from 'react'
import { supabase } from '../../lib/supabase.js'
import { STARI } from '../stare.js'

export const SABLON_CONVOCATOR = '/redari/sabloane/convocator_provizoriu.docx'
// Proiecții explicite (review Jakarinos P2-5): fără token_raspuns pe red_detinatori — tokenul stă în red_detinatori_token
// și se citește DOAR la generarea / reîncărcarea convocatorului (admin/editor), prin citesteTokenRaspuns().
export const COL_DETINATOR = 'id, parcela_id, nume, nume_normalizat, calitate, cota, decedat, sursa_date, versiune_lista_tgz, sters_la, sters_de, sters_motiv, created_at, updated_at'
export const COL_CONVOCARE = 'id, detinator_id, canal, nr_document, data_expediere, nr_tracking, data_confirmare_primire, retur, retur_data, continut_hash, fisier_convocator_path, stare, motiv_anulare, created_by, created_at'
export const COL_RASPUNS_BAZA = 'id, detinator_id, canal, data, optiune, zi_sesiune_aleasa, obiectii_text, declaratie_confirmata, created_by, created_at'

export async function citesteTokenRaspuns(detinatorId) {
  const { data, error } = await supabase.from('red_detinatori_token').select('token_raspuns').eq('detinator_id', detinatorId).maybeSingle()
  if (error) throw error
  if (!data?.token_raspuns) throw new Error('Deținătorul nu are token de răspuns (red_detinatori_token).')
  return data.token_raspuns
}

// P2-11: convocatorul se generează doar dacă UAT-ul are o zi de sesiune cu program și proiectul are contact, text GDPR și reprezentant TGZ.
// Întoarce null când totul e în regulă, altfel motivul (text) pentru butonul dezactivat.
export function motivBlocareConvocator(proiect, uat) {
  const lipsa = []
  if (!uat) lipsa.push('UAT necunoscut')
  else if (![1, 2, 3].some(i => uat[`sesiune_zi${i}`] && String(uat[`program_zi${i}`] || '').trim())) lipsa.push('UAT fără zi de sesiune cu program')
  if (!String(proiect?.contact_nume || '').trim() && !String(proiect?.contact_telefon || '').trim() && !String(proiect?.contact_email || '').trim()) lipsa.push('proiect fără persoană de contact')
  if (!String(proiect?.text_gdpr || '').trim()) lipsa.push('proiect fără text GDPR')
  if (!String(proiect?.reprezentant_tgz_nume || '').trim()) lipsa.push('proiect fără reprezentant TGZ')
  return lipsa.length ? lipsa.join('; ') : null
}

export const G = { bg:'#0D1117', surface:'#161B22', border:'#21262D', border2:'#30363D', text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  blue:'#58A6FF', green:'#3FB950', red:'#F85149', yellow:'#D29922', purple:'#BC8CFF', orange:'#F0883E', pink:'#F778BA',
  greenDim:'#1A3A1A', redDim:'#3A1A1A', yellowDim:'#3A2A0A', blueDim:'#1A2A3A' }

export const S = {
  page:  { padding:'20px 24px', minHeight:'calc(100vh - 60px)', background:G.bg, color:G.text, fontFamily:'-apple-system,BlinkMacSystemFont,Inter,sans-serif' },
  card:  { background:G.surface, borderRadius:10, border:`1px solid ${G.border}`, padding:14 },
  input: { background:G.bg, border:`1px solid ${G.border2}`, color:G.text, borderRadius:7, padding:'7px 10px', fontFamily:'inherit', fontSize:13, outline:'none', width:'100%', boxSizing:'border-box' },
  select:{ background:G.bg, border:`1px solid ${G.border2}`, color:G.text, borderRadius:7, padding:'7px 10px', fontFamily:'inherit', fontSize:13, outline:'none' },
  btnP:  { padding:'8px 14px', background:G.green, color:'#0D1117', border:'none', borderRadius:7, cursor:'pointer', fontSize:13, fontWeight:700 },
  btnS:  { padding:'7px 12px', background:'transparent', color:G.text, border:`1px solid ${G.border2}`, borderRadius:7, cursor:'pointer', fontSize:12.5, fontWeight:600 },
  btnD:  { padding:'7px 12px', background:'transparent', color:G.red, border:`1px solid ${G.red}`, borderRadius:7, cursor:'pointer', fontSize:12.5, fontWeight:600 },
  btnX:  { padding:'5px 9px', background:'transparent', color:G.text, border:`1px solid ${G.border2}`, borderRadius:6, cursor:'pointer', fontSize:12, whiteSpace:'nowrap' },
  th:    { textAlign:'left', padding:'8px 10px', fontSize:11.5, color:G.muted, fontWeight:600, borderBottom:`1px solid ${G.border2}`, whiteSpace:'nowrap', textTransform:'uppercase', letterSpacing:0.3 },
  td:    { padding:'7px 10px', fontSize:13, borderBottom:`1px solid ${G.border}`, verticalAlign:'top' },
  label: { fontSize:11.5, color:G.muted, marginBottom:4, display:'block' },
  tag:   { display:'inline-block', padding:'2px 8px', borderRadius:12, fontSize:11.5, fontWeight:600, whiteSpace:'nowrap' },
  mono:  { fontFamily:'ui-monospace,SFMono-Regular,Menlo,monospace', fontSize:12.5 },
}

export const fmtDate = (d) => { if (!d) return '-'; const dt = new Date(d); return isNaN(dt) ? String(d) : dt.toLocaleDateString('ro-RO', { day:'2-digit', month:'2-digit', year:'numeric' }) }
export const fmtDateTime = (d) => { if (!d) return '-'; const dt = new Date(d); return isNaN(dt) ? String(d) : dt.toLocaleString('ro-RO', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) }
export const fmtNum = (n, dec = 2) => (n === null || n === undefined || n === '') ? '-' : Number(n).toLocaleString('ro-RO', { minimumFractionDigits: 0, maximumFractionDigits: dec })
export const azi = () => new Date().toISOString().slice(0, 10)

// Mesaj de eroare lizibil din răspunsul supabase / excepție
export const msgEroare = (e, fallback = 'Eroare necunoscută') => (e?.message || e?.error_description || e?.details || (typeof e === 'string' ? e : null) || fallback)

export const CALITATI = ['proprietar', 'coproprietar', 'mostenitor', 'arendas', 'utilizator', 'neidentificat']
export const CANALE_CONVOCARE = ['posta', 'sms', 'email', 'afisare', 'telefon']
export const MOTIVE_RETUR = [
  { cod:'destinatar_necunoscut', eticheta:'Destinatar necunoscut' },
  { cod:'mutat', eticheta:'Mutat' },
  { cod:'avizat_neridicat', eticheta:'Avizat, neridicat' },
  { cod:'refuz', eticheta:'Refuz' },
  { cod:'adresa_incompleta', eticheta:'Adresă incompletă' },
]
export const OPTIUNI_RASPUNS = [
  { cod:'particip', eticheta:'Particip la sesiune' },
  { cod:'nu_particip_fara_obiectii', eticheta:'Nu particip, fără obiecții' },
  { cod:'nu_particip_cu_obiectii', eticheta:'Nu particip, cu obiecții' },
  { cod:'constatare_teren', eticheta:'Cere constatare la teren' },
]
export const etichetaOptiune = (cod) => OPTIUNI_RASPUNS.find(o => o.cod === cod)?.eticheta || cod || '-'
export const etichetaRetur = (cod) => MOTIVE_RETUR.find(o => o.cod === cod)?.eticheta || cod || '-'

export const stareInfo = (cod) => STARI.find(s => s.cod === cod) || { cod, eticheta: cod || '-', culoare: G.muted, ordine: 99 }

export function TagStare({ cod }) {
  const s = stareInfo(cod)
  return <span style={{ ...S.tag, background: `${s.culoare}22`, color: s.culoare, border: `1px solid ${s.culoare}55` }}>{s.eticheta}</span>
}

// ─── Toast ──────────────────────────────────────────────────────────────────
export function useToast() {
  const [toasts, setToasts] = useState([])
  const show = useCallback((msg, type = 'info') => {
    const id = Math.random().toString(36).slice(2)
    setToasts(t => [...t, { id, msg, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), type === 'error' ? 7000 : 4000)
  }, [])
  const ToastContainer = () => (
    <div style={{ position:'fixed', top:20, right:20, zIndex:9999, display:'flex', flexDirection:'column', gap:8 }}>
      {toasts.map(t => (
        <div key={t.id} style={{ padding:'12px 18px', borderRadius:8, background: t.type === 'error' ? G.redDim : t.type === 'success' ? G.greenDim : G.surface,
          border:`1px solid ${t.type === 'error' ? G.red : t.type === 'success' ? G.green : G.border2}`, color:G.text, fontSize:14, maxWidth:420, boxShadow:'0 4px 20px rgba(0,0,0,0.5)' }}>
          {t.msg}
        </div>
      ))}
    </div>
  )
  return { show, ToastContainer }
}

// ─── Modal simplu ───────────────────────────────────────────────────────────
export function Modal({ titlu, onClose, children, latime = 520 }) {
  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.65)', zIndex:9000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
      <div onClick={e => e.stopPropagation()} style={{ ...S.card, width:'100%', maxWidth:latime, maxHeight:'92vh', overflow:'auto', padding:18 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
          <div style={{ fontSize:15, fontWeight:700 }}>{titlu}</div>
          <button onClick={onClose} style={{ ...S.btnX, border:'none', fontSize:16 }} title="Închide">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Camp({ eticheta, children, span = 1 }) {
  return (
    <div style={{ gridColumn: span > 1 ? `span ${span}` : undefined }}>
      <label style={S.label}>{eticheta}</label>
      {children}
    </div>
  )
}

export function Gol({ text = 'Nimic de afișat.' }) {
  return <div style={{ padding:24, textAlign:'center', color:G.dim, fontSize:13 }}>{text}</div>
}
