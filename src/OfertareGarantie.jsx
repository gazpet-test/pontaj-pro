// ════════════════════════════════════════════════════════════════
// OfertareGarantie.jsx — tab „🛡 Garanție de participare” pe fișa licitației (Răzvan, 07.09.2026)
// Flux: 1) cerere ofertă poliță → mail broker (edge fn ofertare-garantie-mail, actiune cerere) + salvat în ofertare_garantii
//       2) draft + decont încărcate → mail automat Marilena Tudorache + Mirela Popescu (actiune plata)
//       3) OP încărcat + „achitată” → mail responsabilului licitației (actiune achitata) → cere originalul
//       4) polița în original (nr + primă) → status original → KPI „Garanție participare” verde
//       + termen decalat față de cel din cerere → propune mailul de actualizare a perioadei (actiune actualizare)
// ════════════════════════════════════════════════════════════════
import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase.js'

const G = { bg:'#0D1117', surface:'#161B22', card:'#1C2128', border:'#30363D', border2:'#21262D', text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  ofertare:'#3FB6E2', green:'#3FB950', blue:'#58A6FF', orange:'#F0883E', yellow:'#E3B341', red:'#F85149' }
const S = {
  input: { width:'100%', boxSizing:'border-box', background:G.bg, border:`1px solid ${G.border2}`, borderRadius:6, padding:'8px 12px', color:G.text, fontSize:13, outline:'none' },
  lbl: { display:'block', fontSize:11, color:G.muted, marginBottom:4, fontWeight:600, textTransform:'uppercase', letterSpacing:'.3px' },
  btnP: { padding:'9px 18px', background:G.ofertare, color:'#0D1117', border:'none', borderRadius:7, cursor:'pointer', fontSize:13, fontWeight:700 },
  btnS: { padding:'9px 18px', background:G.surface, color:G.text, border:`1px solid ${G.border2}`, borderRadius:7, cursor:'pointer', fontSize:13 },
  card: { background:G.card, border:`1px solid ${G.border}`, borderRadius:10 },
}
const PASI = [
  ['cerere_trimisa', '📨 Cerere trimisă brokerului'],
  ['draft_primit',   '📄 Draft + decont → la plată'],
  ['achitata',       '💳 Achitată (OP)'],
  ['original',       '🛡 Poliță în original'],
]
const fmtZi = d => d ? new Date(d.length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('ro-RO') : '—'
const fmtLei = (v, m = 'RON') => v == null || v === '' ? '—' : `${Number(v).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${m}`
const plusZile = (iso, n) => { const d = new Date(iso); d.setDate(d.getDate() + Number(n || 0)); return d.toISOString().slice(0, 10) }
const numar = s => { const m = String(s || '').replace(/\./g, '').replace(',', '.').match(/\d+(\.\d+)?/); return m ? Number(m[0]) : '' }

export default function GarantieSection({ licitatie: l, profile, onChanged }) {
  const [g, setG] = useState(undefined)         // undefined = se încarcă, null = nu există
  const [brokeri, setBrokeri] = useState([])
  const [docs, setDocs] = useState([])
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)          // { tip:'ok'|'err', text }
  const [form, setForm] = useState(null)        // formularul cererii (pasul 1)
  const [f2, setF2] = useState({ decont_valoare: '' })
  const [f4, setF4] = useState({ polita_nr: '', polita_prima: '' })

  const load = async () => {
    const [{ data: gg }, { data: bb }, { data: dd }] = await Promise.all([
      supabase.from('ofertare_garantii').select('*, broker:ofertare_brokeri(id, nume, email, contact)').eq('licitatie_id', l.id).neq('status', 'anulata').order('id', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('ofertare_brokeri').select('*').eq('activ', true).order('implicit', { ascending: false }).order('nume'),
      supabase.from('ofertare_documente_atribuire').select('id, nume_original, tip, fisier_path, size_bytes').eq('licitatie_id', l.id).in('tip', ['fisa_date', 'raspuns_clarificare', 'model_contract']).order('tip'),
    ])
    setG(gg || null); setBrokeri(bb || []); setDocs(dd || [])
    if (gg) setF2(x => ({ ...x, decont_valoare: gg.decont_valoare ?? '' }))
  }
  useEffect(() => { load() }, [l.id])

  // ── pasul 1: formularul cererii (valoare din fișă, zile din registrul de cerințe, text după modelul Cristinei)
  const pregateste = async () => {
    const { data: cs } = await supabase.from('ofertare_cerinte').select('text_cerinta').eq('licitatie_id', l.id).ilike('text_cerinta', '%garan%particip%').limit(20)
    let zile = 90
    for (const c of cs || []) { const m = /(\d{2,3})\s*(?:de\s*)?zile/i.exec(c.text_cerinta || ''); if (m) { zile = Number(m[1]); break } }
    const brokerId = brokeri.find(b => b.implicit)?.id || brokeri[0]?.id || ''
    const fisa = docs.filter(d => d.tip === 'fisa_date').map(d => d.id)
    const fm = { broker_id: brokerId, valoare: numar(l.garantie_participare), moneda: l.moneda || 'RON', zile, docs: fisa, text: '' }
    fm.text = textCerere(fm)
    setForm(fm)
  }
  const textCerere = (fm) => {
    const de = l.termen_depunere ? l.termen_depunere.slice(0, 10) : null
    const pana = de ? plusZile(de, fm.zile) : null
    return `Bună ziua,

Vă rugăm să ne transmiteți oferta dvs. pentru Polița de asigurare de garanție de participare, în vederea participării la următoarea procedură:

- Anunț nr. ${l.nr_anunt}${l.link_seap ? ` (${l.link_seap})` : ''} — „${l.obiect}”
- Autoritatea contractantă: ${l.autoritate}
- Valoarea garanției de participare: ${fmtLei(fm.valoare, fm.moneda)}
- Perioada de valabilitate a garanției: ${fm.zile} de zile de la data limită stabilită pentru depunerea ofertelor${de ? `: ${fmtZi(de)} – ${fmtZi(pana)}` : ''}
- Termen de depunere a ofertei: ${l.termen_depunere ? new Date(l.termen_depunere).toLocaleString('ro-RO', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
- Garanția va fi constituită în numele GAZPET INSTAL SRL.
- Atașat: fișa de date a achiziției${fm.docs.length > 1 ? ' și documentele aferente' : ''}.
- Instrumentul de garantare va fi emis conform cerințelor din Fișa de date a achiziției (secțiunea „Garanția de participare”).
- Garanția de participare trebuie să fie irevocabilă și să prevadă în mod expres că plata sumei se va face necondiționat, la prima cerere scrisă a autorității contractante, fără ca aceasta să aibă obligația de a-și motiva cererea, în oricare dintre situațiile: a) ofertantul își retrage oferta în perioada de valabilitate a acesteia; b) oferta sa fiind stabilită câștigătoare, nu constituie garanția de bună execuție în perioada stabilită prin contract; c) oferta sa fiind stabilită câștigătoare, refuză să semneze contractul de achiziție în perioada de valabilitate a ofertei.
- La depunerea ofertei polița trebuie prezentată în original.

Vă rugăm să ne transmiteți draftul poliței și decontul pentru plata primei de asigurare.

Vă mulțumim.`
  }
  const setF = (k, v) => setForm(fm => { const n = { ...fm, [k]: v }; if (k !== 'text') n.text = textCerere(n); return n })

  const trimiteCerere = async () => {
    if (!form.broker_id) return setMsg({ tip: 'err', text: 'Alege brokerul.' })
    setBusy('Se salvează și se trimite cererea…'); setMsg(null)
    const de = l.termen_depunere ? l.termen_depunere.slice(0, 10) : null
    const atas = docs.filter(d => form.docs.includes(d.id)).map(d => ({ path: d.fisier_path, nume: d.nume_original }))
    const { data: ins, error } = await supabase.from('ofertare_garantii').insert({
      licitatie_id: l.id, broker_id: form.broker_id, valoare: form.valoare || null, moneda: form.moneda, valabil_zile: form.zile,
      valabil_de: de, valabil_pana: de ? plusZile(de, form.zile) : null, termen_la_cerere: l.termen_depunere || null,
      cerere_text: form.text, cerere_atasamente: atas, status: 'cerere_trimisa',
    }).select('id').single()
    if (error) { setBusy(null); return setMsg({ tip: 'err', text: error.message }) }
    const { data, error: e2 } = await supabase.functions.invoke('ofertare-garantie-mail', { body: { actiune: 'cerere', garantie_id: ins.id } })
    setBusy(null)
    if (e2 || data?.error) { setMsg({ tip: 'err', text: 'Cererea e salvată, dar mailul nu a plecat: ' + (data?.error || e2?.message) }) }
    else setMsg({ tip: 'ok', text: `✓ Cererea a plecat la broker (${data.atasate} atașamente${data.sarite?.length ? `, sărite: ${data.sarite.join(', ')}` : ''}).` })
    setForm(null); await load(); onChanged?.()
  }

  // ── încărcare fișiere în bucketul ofertare
  const urca = async (file, eticheta) => {
    const path = `${l.id}/garantie/${Date.now()}_${eticheta}_${file.name.replace(/[^\w.\-]+/g, '_')}`
    const { error } = await supabase.storage.from('ofertare').upload(path, file)
    if (error) throw new Error(error.message)
    return path
  }
  const deschide = async (path) => {
    const { data } = await supabase.storage.from('ofertare').createSignedUrl(path, 600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }
  const patch = async (p) => { const { error } = await supabase.from('ofertare_garantii').update({ ...p, updated_at: new Date().toISOString() }).eq('id', g.id); if (error) throw new Error(error.message) }
  const mail = async (actiune) => { const { data, error } = await supabase.functions.invoke('ofertare-garantie-mail', { body: { actiune, garantie_id: g.id } }); if (error || data?.error) throw new Error(data?.error || error?.message); return data }

  // pasul 2: draft + decont → status draft_primit → mail plată
  const [fDraft, setFDraft] = useState(null); const [fDecont, setFDecont] = useState(null)
  const salveazaDraft = async () => {
    if (!fDraft && !g.draft_path) return setMsg({ tip: 'err', text: 'Încarcă draftul poliței (PDF).' })
    if (f2.decont_valoare === '' || isNaN(Number(f2.decont_valoare))) return setMsg({ tip: 'err', text: 'Completează valoarea decontului (prima de plătit).' })
    try {
      setBusy('Se încarcă draftul și se anunță plata…'); setMsg(null)
      const p = { decont_valoare: Number(f2.decont_valoare), status: 'draft_primit', draft_la: new Date().toISOString(), draft_de: profile?.id || null }
      if (fDraft) p.draft_path = await urca(fDraft, 'draft')
      if (fDecont) p.decont_path = await urca(fDecont, 'decont')
      await patch(p)
      const r = await mail('plata')
      setMsg({ tip: 'ok', text: `✓ Draftul e în platformă. Marilena și Mirela Popescu au primit mailul de plată (${r.atasate} atașamente).` })
      setFDraft(null); setFDecont(null); await load(); onChanged?.()
    } catch (e) { setMsg({ tip: 'err', text: e.message }) }
    setBusy(null)
  }
  // pasul 3: OP + achitată → mail responsabil
  const [fOp, setFOp] = useState(null)
  const marcheazaAchitata = async () => {
    if (!fOp && !g.op_path) return setMsg({ tip: 'err', text: 'Încarcă OP-ul (dovada plății).' })
    try {
      setBusy('Se înregistrează plata…'); setMsg(null)
      const p = { status: 'achitata', achitata_la: new Date().toISOString(), achitata_de: profile?.id || null }
      if (fOp) p.op_path = await urca(fOp, 'op')
      await patch(p)
      const r = await mail('achitata')
      setMsg({ tip: 'ok', text: `✓ Plata e înregistrată. Responsabilul (${(r.catre || []).join(', ')}) a fost anunțat să ceară originalul.` })
      setFOp(null); await load(); onChanged?.()
    } catch (e) { setMsg({ tip: 'err', text: e.message }) }
    setBusy(null)
  }
  // pasul 4: polița în original
  const [fPol, setFPol] = useState(null)
  const salveazaOriginal = async () => {
    if (!fPol) return setMsg({ tip: 'err', text: 'Încarcă polița originală scanată (PDF).' })
    if (!f4.polita_nr.trim()) return setMsg({ tip: 'err', text: 'Completează numărul poliței.' })
    try {
      setBusy('Se salvează polița…'); setMsg(null)
      const p = { status: 'original', original_la: new Date().toISOString(), original_de: profile?.id || null, polita_nr: f4.polita_nr.trim(), polita_prima: f4.polita_prima !== '' ? Number(f4.polita_prima) : g.decont_valoare }
      p.polita_path = await urca(fPol, 'polita')
      await patch(p)
      setMsg({ tip: 'ok', text: '✓ Polița în original e în platformă — indicatorul „Garanție participare” devine verde.' })
      setFPol(null); await load(); onChanged?.()
    } catch (e) { setMsg({ tip: 'err', text: e.message }) }
    setBusy(null)
  }
  // termen decalat → actualizare perioadă la broker
  const decalat = g && g.termen_la_cerere && l.termen_depunere && g.termen_la_cerere.slice(0, 10) !== l.termen_depunere.slice(0, 10) && g.status !== 'original'
  const trimiteActualizare = async () => {
    try {
      setBusy('Se trimite actualizarea perioadei…'); setMsg(null)
      const de = l.termen_depunere.slice(0, 10)
      await patch({ valabil_de: de, valabil_pana: plusZile(de, g.valabil_zile || 90), termen_la_cerere: l.termen_depunere })
      await mail('actualizare')
      setMsg({ tip: 'ok', text: '✓ Brokerul a primit perioada nouă de valabilitate.' }); await load()
    } catch (e) { setMsg({ tip: 'err', text: e.message }) }
    setBusy(null)
  }
  const anuleaza = async () => {
    if (!confirm('Anulezi această garanție? (rămâne în istoric, poți porni una nouă)')) return
    await patch({ status: 'anulata' }); await load(); onChanged?.()
  }

  const idx = g ? PASI.findIndex(p => p[0] === g.status) : -1
  const Fisier = ({ path, eticheta }) => path ? <button style={{ ...S.btnS, padding:'3px 10px', fontSize:11.5 }} onClick={() => deschide(path)}>📎 {eticheta}</button> : null
  const Lbl = ({ children }) => <label style={S.lbl}>{children}</label>

  return (
    <div style={{ ...S.card, padding:'16px 18px', background:G.surface }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', marginBottom:12 }}>
        <div style={{ fontSize:15, fontWeight:800 }}>🛡 Garanție de participare</div>
        <span style={{ fontSize:13, color:G.muted }}>cerută în fișa de date: <b style={{ color:G.text }}>{l.garantie_participare || '—'}</b></span>
        {g && <span style={{ marginLeft:'auto', fontSize:12, color:G.dim }}>{g.broker?.nume}{g.valabil_de ? ` · valabilă ${fmtZi(g.valabil_de)} – ${fmtZi(g.valabil_pana)}` : ''}</span>}
      </div>
      {msg && <div style={{ fontSize:12.5, color: msg.tip === 'err' ? G.red : G.green, marginBottom:10, padding:'8px 10px', background:G.card, borderRadius:7 }}>{msg.text}</div>}
      {busy && <div style={{ fontSize:12.5, color:G.ofertare, fontWeight:700, marginBottom:10 }}>⏳ {busy}</div>}

      {g === undefined ? <div style={{ color:G.muted, fontSize:12 }}>Se încarcă…</div> : (
        <>
          {/* pași */}
          {g && (
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:6, marginBottom:14 }}>
              {PASI.map(([k, lbl], i) => (
                <div key={k} style={{ padding:'8px 10px', borderRadius:8, fontSize:12, fontWeight:700, textAlign:'center',
                  background: i < idx ? G.green + '22' : i === idx ? G.ofertare + '22' : G.card,
                  color: i < idx ? G.green : i === idx ? G.ofertare : G.dim, border:`1px solid ${i <= idx ? (i === idx ? G.ofertare : G.green) + '55' : G.border2}` }}>{i < idx ? '✓ ' : ''}{lbl}</div>
              ))}
            </div>
          )}
          {decalat && (
            <div style={{ background:G.orange + '18', border:`1px solid ${G.orange}66`, borderRadius:8, padding:'10px 12px', marginBottom:12, fontSize:12.5, display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
              <span>⚠️ Termenul de depunere s-a decalat ({fmtZi(g.termen_la_cerere)} → <b>{fmtZi(l.termen_depunere)}</b>) — perioada de valabilitate a poliței trebuie actualizată la broker.</span>
              <button style={{ ...S.btnP, marginLeft:'auto', padding:'6px 12px', fontSize:12 }} disabled={!!busy} onClick={trimiteActualizare}>📨 Trimite actualizarea perioadei</button>
            </div>
          )}

          {/* pasul 1 — fără garanție: formular cerere */}
          {!g && !form && (
            <div style={{ fontSize:12.5, color:G.muted }}>
              Nicio cerere de poliță încă. Platforma pregătește mailul către broker după modelul folosit de Cristina (valoare, perioadă de valabilitate, condițiile de irevocabilitate, fișa de date atașată).
              <div style={{ marginTop:10 }}><button style={S.btnP} onClick={pregateste}>📨 Cere ofertă poliță</button></div>
            </div>
          )}
          {!g && form && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <div><Lbl>Broker</Lbl>
                <select style={S.input} value={form.broker_id} onChange={e => setF('broker_id', Number(e.target.value))}>
                  {brokeri.map(b => <option key={b.id} value={b.id}>{b.nume} — {b.email}{b.contact ? ` (${b.contact})` : ''}</option>)}
                </select></div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 90px 1fr', gap:8 }}>
                <div><Lbl>Valoare garanție</Lbl><input style={S.input} type="number" value={form.valoare} onChange={e => setF('valoare', e.target.value)} /></div>
                <div><Lbl>Monedă</Lbl><select style={S.input} value={form.moneda} onChange={e => setF('moneda', e.target.value)}><option>RON</option><option>EUR</option></select></div>
                <div><Lbl>Valabilitate (zile)</Lbl><input style={S.input} type="number" value={form.zile} onChange={e => setF('zile', Number(e.target.value))} title="din registrul de cerințe; 90 dacă nu s-a găsit" /></div>
              </div>
              <div style={{ gridColumn:'1 / -1' }}><Lbl>Documente atașate din documentația de atribuire</Lbl>
                {!docs.length ? <div style={{ fontSize:12, color:G.orange }}>Nu există fișa de date în documentație — cererea pleacă fără atașament (adaug-o din „Adu din SEAP” / „Urcă fișiere”).</div> :
                  docs.map(d => (
                    <label key={d.id} style={{ display:'flex', gap:8, alignItems:'center', fontSize:12.5, padding:'3px 0', cursor:'pointer' }}>
                      <input type="checkbox" checked={form.docs.includes(d.id)} onChange={e => setF('docs', e.target.checked ? [...form.docs, d.id] : form.docs.filter(x => x !== d.id))} />
                      <span style={{ color:G.dim, minWidth:120 }}>{d.tip}</span><span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{d.nume_original}</span>
                      <span style={{ color:G.dim }}>{d.size_bytes ? `${(d.size_bytes / 1048576).toFixed(1)} MB` : ''}</span>
                    </label>
                  ))}
              </div>
              <div style={{ gridColumn:'1 / -1' }}><Lbl>Textul cererii (se regenerează la schimbarea câmpurilor; poți edita)</Lbl>
                <textarea style={{ ...S.input, minHeight:300, fontFamily:'inherit', lineHeight:1.45 }} value={form.text} onChange={e => setForm(fm => ({ ...fm, text: e.target.value }))} /></div>
              <div style={{ gridColumn:'1 / -1', display:'flex', gap:8, justifyContent:'flex-end' }}>
                <button style={S.btnS} onClick={() => setForm(null)}>Renunță</button>
                <button style={S.btnP} disabled={!!busy} onClick={trimiteCerere}>📨 Trimite cererea la broker</button>
              </div>
            </div>
          )}

          {/* istoric + pasul curent */}
          {g && (
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              <div style={{ fontSize:12.5, color:G.muted, display:'flex', gap:14, flexWrap:'wrap', alignItems:'center' }}>
                <span>📨 cerere: <b style={{ color:G.text }}>{g.cerere_trimisa_la ? new Date(g.cerere_trimisa_la).toLocaleString('ro-RO', { dateStyle:'short', timeStyle:'short' }) : 'nu a plecat'}</b> · {fmtLei(g.valoare, g.moneda)} · {g.valabil_zile} zile</span>
                {g.actualizare_trimisa_la && <span>🔁 actualizare: {fmtZi(g.actualizare_trimisa_la)}</span>}
                <Fisier path={g.draft_path} eticheta="draft poliță" /><Fisier path={g.decont_path} eticheta="decont" /><Fisier path={g.op_path} eticheta="OP" /><Fisier path={g.polita_path} eticheta={`poliță nr. ${g.polita_nr || ''}`} />
                {g.status !== 'original' && <button style={{ ...S.btnS, padding:'3px 10px', fontSize:11.5, color:G.red, marginLeft:'auto' }} onClick={anuleaza}>✕ anulează</button>}
              </div>

              {g.status === 'cerere_trimisa' && (
                <div style={{ ...S.card, padding:12 }}>
                  <div style={{ fontSize:13, fontWeight:700, marginBottom:8 }}>📄 A venit draftul poliței + decontul? Încarcă-le — platforma anunță automat plata (Marilena Tudorache, Mirela Popescu).</div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 180px', gap:10, alignItems:'end' }}>
                    <div><Lbl>Draft poliță (PDF) *</Lbl><input type="file" accept=".pdf" style={S.input} onChange={e => setFDraft(e.target.files?.[0] || null)} /></div>
                    <div><Lbl>Decont / factură primă (PDF)</Lbl><input type="file" accept=".pdf,.jpg,.png" style={S.input} onChange={e => setFDecont(e.target.files?.[0] || null)} /></div>
                    <div><Lbl>Primă de plătit ({g.moneda}) *</Lbl><input style={S.input} type="number" step="0.01" value={f2.decont_valoare} onChange={e => setF2({ decont_valoare: e.target.value })} /></div>
                  </div>
                  <div style={{ marginTop:10, textAlign:'right' }}><button style={S.btnP} disabled={!!busy} onClick={salveazaDraft}>💳 Salvează și trimite la plată</button></div>
                </div>
              )}
              {g.status === 'draft_primit' && (
                <div style={{ ...S.card, padding:12 }}>
                  <div style={{ fontSize:13, fontWeight:700, marginBottom:4 }}>💳 De plătit: <span style={{ color:G.orange }}>{fmtLei(g.decont_valoare, g.moneda)}</span> — mail trimis {g.notificat_plata_la ? fmtZi(g.notificat_plata_la) : '(neconfirmat)'}</div>
                  <div style={{ fontSize:12, color:G.muted, marginBottom:8 }}>După plată, Marilena / Mirela încarcă OP-ul și bifează achitată → responsabilul primește automat mailul să ceară originalul.</div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 220px', gap:10, alignItems:'end' }}>
                    <div><Lbl>OP / dovada plății (PDF, poză) *</Lbl><input type="file" accept=".pdf,.jpg,.png" style={S.input} onChange={e => setFOp(e.target.files?.[0] || null)} /></div>
                    <button style={{ ...S.btnP, background:G.green }} disabled={!!busy} onClick={marcheazaAchitata}>✓ Achitată — anunță responsabilul</button>
                  </div>
                </div>
              )}
              {g.status === 'achitata' && (
                <div style={{ ...S.card, padding:12 }}>
                  <div style={{ fontSize:13, fontWeight:700, marginBottom:4 }}>🛡 Achitată {fmtZi(g.achitata_la)} — cere brokerului polița în original ({g.broker?.email}).</div>
                  <div style={{ fontSize:12, color:G.muted, marginBottom:8 }}>Când vine originalul, scanează-l și încarcă-l aici; indicatorul „Garanție participare” devine verde.</div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 160px 160px', gap:10, alignItems:'end' }}>
                    <div><Lbl>Poliță originală scanată (PDF) *</Lbl><input type="file" accept=".pdf" style={S.input} onChange={e => setFPol(e.target.files?.[0] || null)} /></div>
                    <div><Lbl>Nr. poliță *</Lbl><input style={S.input} value={f4.polita_nr} onChange={e => setF4({ ...f4, polita_nr: e.target.value })} /></div>
                    <div><Lbl>Primă plătită ({g.moneda})</Lbl><input style={S.input} type="number" step="0.01" placeholder={g.decont_valoare ?? ''} value={f4.polita_prima} onChange={e => setF4({ ...f4, polita_prima: e.target.value })} /></div>
                  </div>
                  <div style={{ marginTop:10, textAlign:'right' }}><button style={{ ...S.btnP, background:G.green }} disabled={!!busy} onClick={salveazaOriginal}>🛡 Salvează polița în original</button></div>
                </div>
              )}
              {g.status === 'original' && (
                <div style={{ ...S.card, padding:12, borderColor:G.green + '66' }}>
                  <div style={{ fontSize:13, fontWeight:700, color:G.green }}>✓ Polița nr. {g.polita_nr} este în original în platformă (primă {fmtLei(g.polita_prima, g.moneda)}, {fmtZi(g.original_la)}). Valabilă {fmtZi(g.valabil_de)} – {fmtZi(g.valabil_pana)}.</div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
