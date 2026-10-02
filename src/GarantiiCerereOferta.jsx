// ════════════════════════════════════════════════════════════════
// GarantiiCerereOferta.jsx — panoul „📨 Cere ofertă poliță” pentru GBE / avans / CAR (Răzvan 02.10.2026, #1519)
//   Pornit din Financiar → 🏛 Registru garanții (buton pe rând sau butonul general). Logica textului e în
//   garantiiCerereOferta.js (pură, testată). Trimiterea: edge fn ofertare-garantie-mail, acțiunea `cerere_registru`
//   (poartă de rol în edge: fn_poate_scrie_garantii()). Dacă edge-ul nu are încă acțiunea, textul se copiază / se
//   deschide în clientul de mail — nimic nu se pierde. Fără tabele noi: urma trimiterii = marcaj în garantii.observatii.
//   CAR apare în listă DOAR dacă BD-ul permite tipul (fn_garantii_tipuri din migrarea 20261002e; altfel lista implicită).
// ════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo } from 'react'
import { supabase } from './lib/supabase.js'
import { TIPURI_CERERE, TIPURI_GARANTII_IMPLICITE, tipuriDisponibile, textCerereOferta, areGoluri, valoareDinProcent,
  marcajCerereTrimisa, adaugaMarcaj, precompleteazaDinContract, precompleteazaDinGarantie } from './garantiiCerereOferta.js'

const G = { bg:'#0D1117', surface:'#161B22', card:'#1C2128', border:'#30363D', border2:'#21262D', text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  green:'#3FB950', blue:'#58A6FF', orange:'#F0883E', yellow:'#E3B341', red:'#F85149' }
const S = {
  input:{ width:'100%', boxSizing:'border-box', background:G.bg, border:`1px solid ${G.border2}`, borderRadius:6, padding:'7px 10px', color:G.text, fontSize:12.5, outline:'none', colorScheme:'dark' },
  lbl:{ display:'block', fontSize:10.5, color:G.muted, marginBottom:3, fontWeight:600, textTransform:'uppercase', letterSpacing:'.3px' },
  btnS:{ padding:'6px 12px', background:G.surface, color:G.text, border:`1px solid ${G.border2}`, borderRadius:7, cursor:'pointer', fontSize:12, fontWeight:600 },
}

// tipurile permise de BD: RPC-ul fn_garantii_tipuri (20261002e) sau, dacă lipsește, lista dinaintea migrării
export function useTipuriGarantii() {
  const [tipuri, setTipuri] = useState(TIPURI_GARANTII_IMPLICITE)
  useEffect(() => {
    let viu = true
    supabase.rpc('fn_garantii_tipuri').then(({ data, error }) => {
      if (viu && !error && Array.isArray(data) && data.length) setTipuri(data)
    }).catch(() => {})
    return () => { viu = false }
  }, [])
  return tipuri
}

export default function CerereOfertaPanel({ initial, tipuriPermise, profile, showToast, onClose, onDone }) {
  const tipuri = tipuriDisponibile(tipuriPermise)
  const [f, setF] = useState(() => {
    const t = initial?.tip && tipuri.includes(initial.tip) ? initial.tip : (tipuri[0] || 'buna_executie')
    return { ...(initial?.garantie_id ? precompleteazaDinGarantie(initial) : precompleteazaDinContract({}, t)), ...(initial || {}), tip: t, broker_id: '', inregistreaza: false }
  })
  const [text, setText] = useState(null)         // null = textul urmărește câmpurile; string = editat de om
  const [brokeri, setBrokeri] = useState([])
  const [contracte, setContracte] = useState([])
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    let viu = true
    Promise.all([
      supabase.from('ofertare_brokeri').select('id, nume, email, contact, implicit').eq('activ', true).order('implicit', { ascending: false }).order('nume'),
      supabase.from('contracte_terti').select('id, numar_contract, denumire, data_semnare, data_termen, valoare_lei, valoare_eur, valoare_actuala_lei, garantie_buna_executie_pct, garantie_perioada_luni, partener_text, status, beneficiar:beneficiari(nume)')
        .eq('sens', 'incasare').neq('status', 'reziliat').is('arhivat_la', null).order('created_at', { ascending: false }).limit(300),
    ]).then(([{ data: b }, { data: c }]) => {
      if (!viu) return
      setBrokeri(b || []); setContracte(c || [])
      setF(x => x.broker_id ? x : { ...x, broker_id: (b || []).find(z => z.implicit)?.id || b?.[0]?.id || '' })
    })
    return () => { viu = false }
  }, [])

  const gen = useMemo(() => textCerereOferta(f.tip, f), [f])
  const corp = text ?? gen.corp
  const broker = brokeri.find(b => String(b.id) === String(f.broker_id))
  const set = (k, v) => setF(x => {
    const n = { ...x, [k]: v }
    // GBE: valoarea urmărește contract × procent cât timp omul n-a scris-o direct
    if ((k === 'procent' || k === 'valoare_contract') && n.tip === 'buna_executie') { const vv = valoareDinProcent(n.valoare_contract, n.procent); if (vv !== '') n.valoare = vv }
    return n
  })
  const alegeContract = id => {
    const c = contracte.find(z => String(z.id) === String(id))
    if (!c) return set('contract_terti_id', null)
    setF(x => ({ ...x, ...precompleteazaDinContract(c, x.tip), tip: x.tip, broker_id: x.broker_id, inregistreaza: x.inregistreaza, garantie_id: x.garantie_id || null }))
    setText(null)
  }
  const schimbaTip = t => { setF(x => ({ ...x, tip: t, procent: t === 'buna_executie' ? x.procent : '', valoare: t === 'car' ? (x.valoare_contract || x.valoare) : x.valoare })); setText(null) }

  const copiaza = async () => {
    try { await navigator.clipboard.writeText(`${gen.subiect}\n\n${corp}`); showToast?.('✓ Textul cererii e copiat', 'ok') }
    catch { showToast?.('Nu am putut copia — selectează textul manual', 'err') }
  }
  const mailto = broker?.email ? `mailto:${encodeURIComponent(broker.email)}?subject=${encodeURIComponent(gen.subiect)}&body=${encodeURIComponent(corp)}` : null

  // urma în platformă: marcaj în observații pe garanția existentă SAU rând nou în registru (opțional, bifat explicit)
  const scrieUrma = async () => {
    const marcaj = marcajCerereTrimisa({ broker: broker?.nume, cine: profile?.name || profile?.email, la: new Date().toISOString() })
    if (f.garantie_id) {
      const { data: g } = await supabase.from('garantii').select('observatii').eq('id', f.garantie_id).maybeSingle()
      const { error } = await supabase.from('garantii').update({ observatii: adaugaMarcaj(g?.observatii, marcaj), updated_at: new Date().toISOString() }).eq('id', f.garantie_id)
      if (error) throw new Error('mailul a plecat, dar marcajul din registru nu s-a salvat: ' + error.message)
      return
    }
    if (!f.inregistreaza) return
    const { error } = await supabase.from('garantii').insert({
      forma: 'polita_asigurare', tip: f.tip, beneficiar: f.beneficiar, contract_numar: f.contract_numar || null, contract_data: f.contract_data || null,
      lucrare: f.lucrare || null, contract_terti_id: f.contract_terti_id || null, valoare: Number(f.valoare) || null, moneda: f.moneda || 'RON',
      procent: f.procent !== '' && f.procent != null ? Number(f.procent) : null, emitent: broker?.nume || null,
      data_emitere: f.valabil_de || null, data_expirare: f.valabil_pana || null, stare: 'activa', sursa_document: 'cerere_oferta',
      observatii: adaugaMarcaj('Poliță în curs de emitere — completează numărul poliței și emitentul la primirea originalului.', marcaj),
    })
    if (error) throw new Error('mailul a plecat, dar rândul din registru nu s-a salvat: ' + error.message)
  }

  const trimite = async () => {
    if (!broker?.email) return setMsg({ tip:'err', text:'Alege un broker cu adresă de e-mail.' })
    if (gen.lipsuri.length) return setMsg({ tip:'err', text:'Completează: ' + gen.lipsuri.join(', ') + '.' })
    if (areGoluri(corp)) return setMsg({ tip:'err', text:'Textul mai are „[DE COMPLETAT…]” — completează câmpurile sau corectează textul.' })
    if (!confirm(`Trimit cererea la ${broker.nume} <${broker.email}> de pe rapoarte@gazpet.ro (răspunsul vine la tine)?`)) return
    setBusy('Se trimite cererea…'); setMsg(null)
    try {
      const { data, error } = await supabase.functions.invoke('ofertare-garantie-mail', { body: {
        actiune: 'cerere_registru', broker_id: broker.id, tip: f.tip, subiect: gen.subiect, text: corp, garantie_id: f.garantie_id || null,
      } })
      if (error || data?.error) throw new Error(data?.error || error?.message || 'eroare necunoscută')
      await scrieUrma()
      showToast?.('✓ Cererea a plecat la broker', 'ok')
      onDone?.(); onClose?.()
    } catch (e) {
      setMsg({ tip:'err', text:`Mailul nu a plecat din platformă: ${e.message}. Poți copia textul sau îl deschizi în clientul de mail (butoanele de mai jos).` })
    }
    setBusy(null)
  }

  // câmp de formular — funcție simplă (NU componentă): o componentă definită în corp s-ar recrea la fiecare randare și inputul ar pierde focusul
  const inp = ({ l, k, type = 'text', ph, w }) => (
    <div key={k} style={{ gridColumn: w ? `span ${w}` : undefined }}>
      <label style={S.lbl}>{l}</label>
      <input type={type} value={f[k] ?? ''} placeholder={ph} onChange={e => { set(k, e.target.value); setText(null) }} style={S.input} />
    </div>
  )

  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'#000A', zIndex:200, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background:G.card, border:`1px solid ${G.border}`, borderRadius:12, maxWidth:860, width:'100%', maxHeight:'92vh', overflow:'auto', padding:20 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12, flexWrap:'wrap' }}>
          <div style={{ fontSize:15, fontWeight:700 }}>📨 Cerere ofertă poliță — {TIPURI_CERERE[f.tip]?.eticheta || f.tip}</div>
          <button onClick={onClose} style={{ marginLeft:'auto', ...S.btnS }}>Închide</button>
        </div>
        {tipuri.length === 0 && <div style={{ color:G.red, fontSize:12.5, marginBottom:10 }}>Niciun tip de garanție disponibil pentru cerere.</div>}

        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(170px, 1fr))', gap:10, marginBottom:12 }}>
          <div style={{ gridColumn:'span 2' }}>
            <label style={S.lbl}>Tipul poliței</label>
            <select value={f.tip} onChange={e => schimbaTip(e.target.value)} style={S.input} disabled={!!f.garantie_id}>
              {tipuri.map(t => <option key={t} value={t}>{TIPURI_CERERE[t].eticheta}</option>)}
            </select>
          </div>
          <div style={{ gridColumn:'span 2' }}>
            <label style={S.lbl}>Contract din platformă (precompletează)</label>
            <select value={f.contract_terti_id || ''} onChange={e => alegeContract(e.target.value)} style={S.input}>
              <option value="">— manual —</option>
              {contracte.map(c => <option key={c.id} value={c.id}>{c.numar_contract || '—'} · {c.beneficiar?.nume || c.partener_text || '—'} · {(c.denumire || '').slice(0, 60)}</option>)}
            </select>
          </div>
          {inp({ l:'Beneficiar', k:'beneficiar', w:2 })}
          {inp({ l:'Contract nr.', k:'contract_numar' })}
          {inp({ l:'Data contract', k:'contract_data', type:'date' })}
          {inp({ l:'Obiectul contractului / lucrarea', k:'lucrare', w:4 })}
          {inp({ l:'Valoarea contractului (fără TVA)', k:'valoare_contract', type:'number' })}
          {f.tip === 'buna_executie' && inp({ l:'Procent GBE %', k:'procent', type:'number' })}
          {inp({ l:TIPURI_CERERE[f.tip]?.rolValoare || 'Valoarea', k:'valoare', type:'number' })}
          <div>
            <label style={S.lbl}>Moneda</label>
            <select value={f.moneda || 'RON'} onChange={e => { set('moneda', e.target.value); setText(null) }} style={S.input}><option>RON</option><option>EUR</option></select>
          </div>
          {inp({ l:'Valabilă de la', k:'valabil_de', type:'date' })}
          {inp({ l:'Valabilă până la', k:'valabil_pana', type:'date' })}
          {f.tip === 'buna_executie' && inp({ l:'Perioada de garanție (luni)', k:'perioada_garantie_luni', type:'number' })}
          {f.tip === 'car' && inp({ l:'Limită răspundere civilă terți', k:'limita_rc', type:'number', ph:'gol = de completat' })}
          {inp({ l:'Mențiuni (opțional)', k:'observatii', w:2 })}
          <div style={{ gridColumn:'span 2' }}>
            <label style={S.lbl}>Broker</label>
            <select value={f.broker_id} onChange={e => set('broker_id', e.target.value)} style={S.input}>
              <option value="">— alege —</option>
              {brokeri.map(b => <option key={b.id} value={b.id}>{b.nume}{b.email ? ` <${b.email}>` : ' (fără e-mail)'}</option>)}
            </select>
          </div>
        </div>

        {gen.lipsuri.length > 0 && <div style={{ fontSize:12, color:G.yellow, marginBottom:8 }}>⚠ De completat: {gen.lipsuri.join(', ')}.</div>}
        <div style={{ fontSize:11, color:G.muted, marginBottom:3 }}>SUBIECT</div>
        <div style={{ fontSize:13, marginBottom:10, fontWeight:600 }}>{gen.subiect}</div>
        <textarea value={corp} onChange={e => setText(e.target.value)} style={{ ...S.input, minHeight:300, fontFamily:'inherit', lineHeight:1.55 }} />
        <div style={{ display:'flex', gap:8, marginTop:6, alignItems:'center', flexWrap:'wrap' }}>
          {text != null && <button onClick={() => setText(null)} style={{ ...S.btnS, fontSize:11 }}>↺ Reface textul din câmpuri</button>}
          {!f.garantie_id && (
            <label style={{ display:'inline-flex', alignItems:'center', gap:6, fontSize:12, color:G.muted, cursor:'pointer' }}>
              <input type="checkbox" checked={!!f.inregistreaza} onChange={e => set('inregistreaza', e.target.checked)} />
              după trimitere, înregistrează garanția în registru (poliță în curs — completezi numărul la emitere)
            </label>
          )}
        </div>

        {msg && <div style={{ marginTop:10, fontSize:12.5, color: msg.tip === 'ok' ? G.green : G.red }}>{msg.text}</div>}
        <div style={{ display:'flex', gap:8, marginTop:14, alignItems:'center', flexWrap:'wrap' }}>
          <button onClick={trimite} disabled={!!busy || tipuri.length === 0} style={{ ...S.btnS, background:G.blue, color:'#0D1117', border:'none', fontWeight:700 }}>{busy || '📨 Trimite brokerului'}</button>
          <button onClick={copiaza} style={{ ...S.btnS, background:G.blue + '22', color:G.blue, border:`1px solid ${G.blue}55` }}>📋 Copiază textul</button>
          {mailto && <a href={mailto} style={{ ...S.btnS, textDecoration:'none' }}>✉️ Deschide în clientul de mail</a>}
          <div style={{ fontSize:11.5, color:G.dim }}>Mailul pleacă de pe rapoarte@gazpet.ro, cu răspuns către tine și copie la office.</div>
        </div>
      </div>
    </div>
  )
}
