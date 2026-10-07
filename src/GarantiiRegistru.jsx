// ════════════════════════════════════════════════════════════════
// GarantiiRegistru.jsx — Registrul de garanții constituite (16.09.2026)
//   Instrumentul, nu contractul: cont de trezorerie, depozit bancar, poliță de asigurare.
//   Acoperă și lucrările vechi care nu au rând în contracte_terti.
//   Rostul: să vezi ce mănâncă din plafonul de la asigurător și ce se poate elibera.
//   Evidența GBE pe contract (reținut/restituit) rămâne în GbeEvidenta.jsx — aici e sursa banilor blocați.
//   02.10.2026 (#1519): „📨 Cere ofertă” — cererea de ofertă poliță către broker pentru GBE / avans / CAR
//   (GarantiiCerereOferta.jsx); CAR apare doar dacă BD-ul permite tipul (migrarea 20261002e).
//   03.10.2026 (#1544, decizia „1B”): „🧾 BO (n)” pe polițe — biletele la ordin date ca GARANȚIE la poliță (nu plata
//   primei), urmărite până la restituire (GarantiiBileteOrdin.jsx; tabela garantii_bilete_ordin, migrarea 20261003a).
//   07.10.2026 (TKT-2026-0331, varianta A): „＋ Poliță existentă” — o poliță deja emisă intră direct în registru
//   (forma polita_asigurare, același drum de scriere: RLS fn_poate_scrie_garantii, canEdit), ca să i se poată trece BO-urile.
// ════════════════════════════════════════════════════════════════
import { useState, useEffect, useCallback } from 'react'
import { supabase } from './lib/supabase.js'
import CerereOfertaPanel, { useTipuriGarantii } from './GarantiiCerereOferta.jsx'
import { TIPURI_CERERE } from './garantiiCerereOferta.js'
import BiletePanel from './GarantiiBileteOrdin.jsx'
import { rezumatBOPeGarantie } from './garantiiBileteOrdin.js'

const G = { bg:'#0D1117', surface:'#161B22', card:'#1C2128', border:'#30363D', border2:'#21262D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  green:'#3FB950', blue:'#58A6FF', orange:'#F0883E', yellow:'#E3B341', red:'#F85149', purple:'#A371F7' }
const S = {
  input:{ width:'100%', boxSizing:'border-box', background:G.bg, border:`1px solid ${G.border2}`, borderRadius:6, padding:'7px 10px', color:G.text, fontSize:12.5, outline:'none', colorScheme:'dark' },
  lbl:{ display:'block', fontSize:10.5, color:G.muted, marginBottom:3, fontWeight:600, textTransform:'uppercase', letterSpacing:'.3px' },
  btnS:{ padding:'6px 12px', background:G.surface, color:G.text, border:`1px solid ${G.border2}`, borderRadius:7, cursor:'pointer', fontSize:12, fontWeight:600 },
}
const fmtLei = v => v == null || v === '' ? '—' : Number(v).toLocaleString('ro-RO', { minimumFractionDigits:2, maximumFractionDigits:2 }) + ' lei'
const fmtZi  = d => d ? new Date(d.length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('ro-RO') : '—'

const FORMA = {
  depozit_trezorerie:{ e:'🏛', l:'Cont trezorerie' },
  depozit_bancar:    { e:'🏦', l:'Depozit bancar' },
  polita_asigurare:  { e:'📄', l:'Poliță asigurare' },
  scrisoare_bancara: { e:'✉️', l:'Scrisoare bancară' },
  retinere_din_situatii:{ e:'✂️', l:'Reținere din situații' },
}
const STARE = {
  activa:{ c:'#3FB950', l:'Activă' }, de_eliberat:{ c:'#E3B341', l:'De eliberat' },
  eliberata:{ c:'#8B949E', l:'Eliberată' }, executata:{ c:'#F85149', l:'Executată' },
  expirata:{ c:'#F0883E', l:'Expirată' },
}

// ── TKT-2026-0331: o poliță DEJA emisă (nu prin „Cere ofertă”) se înregistrează direct, ca să i se poată atașa BO-urile.
const TIP_POLITA = { buna_executie:'Bună execuție (GBE)', avans:'Returnare avans', participare:'Participare', mentenanta:'Mentenanță', car:'CAR' }
function PolitaExistentaPanel({ tipuriPermise, onClose, onDone, showToast }) {
  const [f, setF] = useState({ tip:'buna_executie', beneficiar:'', lucrare:'', contract_numar:'', contract_data:'', emitent:'', numar_document:'',
    valoare:'', moneda:'RON', data_emitere:'', data_expirare:'', observatii:'' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const tipuri = Object.keys(TIP_POLITA).filter(t => t !== 'car' || tipuriPermise.includes('car'))
  const lipsuri = [!f.beneficiar.trim() && 'beneficiarul', !f.emitent.trim() && 'asigurătorul', !f.numar_document.trim() && 'nr. poliței',
    !(Number(f.valoare) > 0) && 'valoarea'].filter(Boolean)
  const salveaza = async () => {
    if (lipsuri.length) return setErr('Completează: ' + lipsuri.join(', ') + '.')
    if (f.data_emitere && f.data_expirare && f.data_expirare < f.data_emitere) return setErr('Data expirării e înaintea datei emiterii.')
    setBusy(true); setErr(null)
    const { error } = await supabase.from('garantii').insert({
      forma:'polita_asigurare', tip:f.tip, beneficiar:f.beneficiar.trim(), lucrare:f.lucrare.trim() || null,
      contract_numar:f.contract_numar.trim() || null, contract_data:f.contract_data || null,
      emitent:f.emitent.trim(), numar_document:f.numar_document.trim(), valoare:Number(f.valoare), moneda:f.moneda || 'RON',
      data_emitere:f.data_emitere || null, data_expirare:f.data_expirare || null, stare:'activa', sursa_document:'manual',
      observatii:f.observatii.trim() || null,
    })
    setBusy(false)
    if (error) return setErr('Nu s-a salvat: ' + error.message)
    showToast?.('✓ Polița e în registru — acum îi poți trece biletele la ordin (🧾 BO)', 'ok')
    onDone?.(); onClose?.()
  }
  const camp = (k, l, props = {}) => (
    <div><label style={S.lbl}>{l}</label><input value={f[k]} onChange={e => set(k, e.target.value)} style={S.input} {...props} /></div>
  )
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.6)',zIndex:1000,display:'flex',alignItems:'flex-start',justifyContent:'center',overflowY:'auto',padding:'40px 12px'}}>
      <div style={{background:G.card,border:`1px solid ${G.border}`,borderRadius:12,width:'100%',maxWidth:620,padding:18,color:G.text}}>
        <div style={{display:'flex',alignItems:'center',marginBottom:6}}>
          <div style={{fontWeight:700,fontSize:15}}>＋ Poliță existentă</div>
          <button onClick={onClose} style={{...S.btnS,marginLeft:'auto'}}>✕</button>
        </div>
        <div style={{fontSize:12,color:G.muted,marginBottom:14}}>Pentru o poliță deja emisă (GBE, avans…). După salvare, pe rândul ei apare „🧾 BO” — acolo treci biletele la ordin date ca garanție.</div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:10}}>
          <div><label style={S.lbl}>Tip</label>
            <select value={f.tip} onChange={e => set('tip', e.target.value)} style={S.input}>{tipuri.map(t => <option key={t} value={t}>{TIP_POLITA[t]}</option>)}</select></div>
          {camp('beneficiar', 'Beneficiar *')}
          {camp('lucrare', 'Lucrare')}
          {camp('contract_numar', 'Nr. contract')}
          {camp('contract_data', 'Data contract', { type:'date' })}
          {camp('emitent', 'Asigurător *', { placeholder:'ex. Groupama, Euroins' })}
          {camp('numar_document', 'Nr. poliță *')}
          {camp('valoare', 'Valoare asigurată *', { inputMode:'decimal' })}
          <div><label style={S.lbl}>Monedă</label><select value={f.moneda} onChange={e => set('moneda', e.target.value)} style={S.input}><option>RON</option><option>EUR</option></select></div>
          {camp('data_emitere', 'Valabilă de la', { type:'date' })}
          {camp('data_expirare', 'Valabilă până la', { type:'date' })}
        </div>
        <div style={{marginTop:10}}><label style={S.lbl}>Observații</label>
          <textarea value={f.observatii} onChange={e => set('observatii', e.target.value)} rows={2} style={{...S.input,resize:'vertical'}} /></div>
        {err && <div style={{marginTop:10,padding:'8px 10px',borderRadius:7,background:G.red+'22',color:G.red,fontSize:12.5}}>{err}</div>}
        <div style={{display:'flex',gap:8,marginTop:14,justifyContent:'flex-end'}}>
          <button onClick={onClose} style={S.btnS}>Renunță</button>
          <button onClick={salveaza} disabled={busy} style={{...S.btnS,background:G.green+'22',color:G.green,border:`1px solid ${G.green}66`}}>{busy ? 'Se salvează…' : '✓ Salvează polița'}</button>
        </div>
      </div>
    </div>
  )
}

// ── panoul cu adresa generată. NU trimite nimic — doar text de copiat.
function AdresaPanel({ garantie, onClose, showToast }) {
  const [a, setA] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let viu = true
    supabase.rpc('garantii_adresa_eliberare', { p_id: garantie.id }).then(({ data, error }) => {
      if (!viu) return
      if (error) setErr(error.message)
      else setA(Array.isArray(data) ? data[0] : data)
    })
    return () => { viu = false }
  }, [garantie.id])

  const copiaza = async () => {
    try { await navigator.clipboard.writeText(a.corp); showToast?.('✓ Adresa copiată', 'ok') }
    catch { showToast?.('Nu am putut copia — selectează textul manual', 'err') }
  }

  return (
    <div onClick={onClose} style={{position:'fixed',inset:0,background:'#000A',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
      <div onClick={e => e.stopPropagation()} style={{background:G.card,border:`1px solid ${G.border}`,borderRadius:12,maxWidth:760,width:'100%',maxHeight:'88vh',overflow:'auto',padding:22}}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14}}>
          <div style={{fontSize:15,fontWeight:700}}>✉️ Adresă de eliberare a garanției</div>
          <button onClick={onClose} style={{marginLeft:'auto',...S.btnS}}>Închide</button>
        </div>

        {err && <div style={{color:G.red,fontSize:12.5}}>Eroare: {err}</div>}
        {!a && !err && <div style={{color:G.muted,fontSize:12.5}}>Se generează…</div>}

        {a && (
          <>
            {a.avertisment && (
              <div style={{background:G.orange+'18',border:`1px solid ${G.orange}55`,borderRadius:8,padding:'10px 12px',marginBottom:14,fontSize:12.5,color:G.orange,fontWeight:600}}>
                ⚠ {a.avertisment}
              </div>
            )}
            <div style={{fontSize:11,color:G.muted,marginBottom:3}}>CĂTRE</div>
            <div style={{fontSize:13,fontWeight:700,marginBottom:10}}>{a.destinatar}</div>
            <div style={{fontSize:11,color:G.muted,marginBottom:3}}>SUBIECT</div>
            <div style={{fontSize:13,marginBottom:12}}>{a.subiect}</div>
            <textarea readOnly value={a.corp} style={{...S.input, minHeight:320, fontFamily:'inherit', lineHeight:1.55, fontSize:12.5}} />
            <div style={{display:'flex',gap:8,marginTop:12,alignItems:'center'}}>
              <button onClick={copiaza} style={{...S.btnS, background:G.blue+'22', color:G.blue, border:`1px solid ${G.blue}55`}}>📋 Copiază textul</button>
              <div style={{fontSize:11.5,color:G.dim}}>
                Adresa nu se trimite din platformă. O trimiți tu, după ce o verifici.
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default function GarantiiRegistru({ canEdit = false, showToast, profile }) {
  const [randuri, setRanduri] = useState([])
  const [cerere, setCerere]   = useState(null)   // panoul de cerere ofertă: {} (gol) sau rândul din registru
  const tipuriPermise = useTipuriGarantii()
  const [plafon, setPlafon]   = useState([])
  const [loading, setLoading] = useState(true)
  const [adresa, setAdresa]   = useState(null)
  const [doarActive, setDoarActive] = useState(true)
  const [bilete, setBilete]   = useState(null)   // panoul 🧾 BO: rândul poliței
  const [politaNoua, setPolitaNoua] = useState(false)   // TKT-2026-0331
  const [boRezumat, setBoRezumat] = useState({}) // {garantie_id: {total, emise, scadente, depasite}} — un singur select, fără N+1

  // BO-urile tuturor polițelor din registru, într-un singur select; fără tabelă (migrarea 20261003a neaplicată) ⇒ {}
  const incarcaBo = useCallback(async (lista) => {
    const ids = (lista || []).filter(r => r.forma === 'polita_asigurare').map(r => r.id)
    if (!ids.length) { setBoRezumat({}); return }
    const { data } = await supabase.from('garantii_bilete_ordin').select('garantie_id, stare, data_scadenta').in('garantie_id', ids).order('garantie_id')
    setBoRezumat(rezumatBOPeGarantie(data || []))
  }, [])
  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: g }, { data: p }] = await Promise.all([
      supabase.from('v_garantii_situatie').select('*').order('data_expirare', { ascending: true, nullsFirst: false }),
      supabase.from('v_garantii_plafon_emitent').select('*'),
    ])
    setRanduri(g || []); setPlafon(p || []); setLoading(false)
    incarcaBo(g)
  }, [incarcaBo])
  useEffect(() => { load() }, [load])

  const marcheazaReceptie = async (r) => {
    const preData = r.data_receptie ? fmtZi(r.data_receptie) : ''
    const d = prompt(
      `Data recepției pentru „${r.lucrare || r.beneficiar}" (ZZ.LL.AAAA):` +
      (r.document_receptie ? `\n\nGăsit în arhivă: ${r.document_receptie}` : ''),
      preData)
    if (!d) return
    const m = d.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
    if (!m) { showToast?.('Format greșit. Scrie ZZ.LL.AAAA', 'err'); return }
    const doc = prompt('Documentul de recepție (ex. PVRTL nr. 8 din 24.06.2021):', r.document_receptie || '') || null
    const { error } = await supabase.from('garantii')
      .update({ lucrare_receptionata:true, data_receptie:`${m[3]}-${m[2]}-${m[1]}`, document_receptie:doc, updated_at:new Date().toISOString() })
      .eq('id', r.id)
    if (error) showToast?.('Eroare: ' + error.message, 'err')
    else { showToast?.('✓ Recepție înregistrată — garanția se poate cere', 'ok'); load() }
  }

  const vizibile = doarActive ? randuri.filter(r => r.stare === 'activa') : randuri
  const totalBlocat = vizibile.reduce((s, r) => s + Number(r.valoare || 0), 0)
  const recuperabil = vizibile.filter(r => r.lucrare_receptionata && !r.blocat_litigiu).reduce((s, r) => s + Number(r.valoare || 0), 0)
  const dePregatit  = vizibile.filter(r => !r.lucrare_receptionata && r.data_receptie && !r.blocat_litigiu).reduce((s, r) => s + Number(r.valoare || 0), 0)
  const inLitigiu   = vizibile.filter(r => r.blocat_litigiu).reduce((s, r) => s + Number(r.valoare || 0), 0)

  if (loading) return <div style={{color:G.muted,fontSize:13,padding:20}}>Se încarcă registrul…</div>

  return (
    <div>
      {/* KPI */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:12,marginBottom:18}}>
        {[
          ['Garanții active', vizibile.length, G.blue],
          ['Bani blocați', fmtLei(totalBlocat), G.orange],
          ['Recuperabil acum', fmtLei(recuperabil), recuperabil > 0 ? G.green : G.dim],
          ['PV găsit, de bifat', fmtLei(dePregatit), dePregatit > 0 ? G.yellow : G.dim],
          ...(inLitigiu > 0 ? [['Blocat de litigiu', fmtLei(inLitigiu), G.red]] : []),
        ].map(([l, v, c]) => (
          <div key={l} style={{background:G.card,border:`1px solid ${G.border2}`,borderRadius:10,padding:'12px 14px'}}>
            <div style={{fontSize:10.5,color:G.muted,fontWeight:600,textTransform:'uppercase',letterSpacing:'.3px'}}>{l}</div>
            <div style={{fontSize:19,fontWeight:700,color:c,marginTop:4}}>{v}</div>
          </div>
        ))}
      </div>

      {/* plafon per emitent */}
      {plafon.length > 0 && (
        <div style={{background:G.card,border:`1px solid ${G.border2}`,borderRadius:10,padding:'14px 16px',marginBottom:18}}>
          <div style={{fontSize:12.5,fontWeight:700,marginBottom:10}}>Expunere per emitent</div>
          <div style={{display:'grid',gap:6}}>
            {plafon.map((p, i) => (
              <div key={i} style={{display:'flex',alignItems:'center',gap:10,fontSize:12.5}}>
                <span style={{minWidth:230,fontWeight:600}}>{FORMA[p.forma]?.e} {p.emitent}</span>
                <span style={{color:G.muted}}>{p.active} active</span>
                <span style={{marginLeft:'auto',fontWeight:700}}>{fmtLei(p.valoare_blocata)}</span>
                {Number(p.valoare_recuperabila) > 0 && (
                  <span style={{color:G.green,fontWeight:700}}>↩ {fmtLei(p.valoare_recuperabila)} de cerut</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:10,flexWrap:'wrap'}}>
        <label style={{display:'inline-flex',alignItems:'center',gap:6,fontSize:12.5,color:G.muted,cursor:'pointer'}}>
          <input type="checkbox" checked={doarActive} onChange={e => setDoarActive(e.target.checked)} />
          doar garanțiile active
        </label>
        {canEdit && (
          <button onClick={() => setPolitaNoua(true)} style={{...S.btnS, marginLeft:'auto'}}
            title="Înregistrează o poliță deja emisă, ca să-i poți trece biletele la ordin (🧾 BO)">＋ Poliță existentă</button>
        )}
        {canEdit && (
          <button onClick={() => setCerere({})} style={{...S.btnS, background:G.blue+'18', color:G.blue, border:`1px solid ${G.blue}55`}}
            title="Cerere de ofertă către broker pentru poliță de bună execuție / returnare avans / CAR">📨 Cere ofertă poliță (GBE / avans{tipuriPermise.includes('car') ? ' / CAR' : ''})</button>
        )}
      </div>

      <div style={{background:G.card,border:`1px solid ${G.border2}`,borderRadius:10,overflow:'hidden'}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12.5}}>
          <thead>
            <tr style={{background:G.surface,color:G.muted,fontSize:11,textTransform:'uppercase',letterSpacing:'.3px'}}>
              {['Lucrare / beneficiar','Formă','Emitent','Valoare','Expiră','Stare','De făcut',''].map(h => (
                <th key={h} style={{textAlign:'left',padding:'9px 12px',fontWeight:600}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {vizibile.map(r => (
              <tr key={r.id} style={{borderTop:`1px solid ${G.border2}`}}>
                <td style={{padding:'9px 12px'}}>
                  <div style={{fontWeight:600}}>{r.lucrare || '—'}</div>
                  <div style={{fontSize:11,color:G.muted,marginTop:2}}>
                    {r.beneficiar}{r.contract_numar ? ` · ctr. ${r.contract_numar}` : ''}{r.contract_data ? `/${fmtZi(r.contract_data)}` : ''}
                  </div>
                </td>
                <td style={{padding:'9px 12px'}} title={r.iban || r.numar_document || ''}>
                  {FORMA[r.forma]?.e} {FORMA[r.forma]?.l}
                </td>
                <td style={{padding:'9px 12px',color:G.muted}}>{r.emitent || r.banca || '—'}</td>
                <td style={{padding:'9px 12px',fontWeight:700,whiteSpace:'nowrap'}}>{fmtLei(r.valoare)}</td>
                <td style={{padding:'9px 12px',whiteSpace:'nowrap'}}>
                  {r.data_expirare ? fmtZi(r.data_expirare) : '—'}
                  {r.zile_pana_expirare != null && r.zile_pana_expirare <= 60 && (
                    <div style={{fontSize:11,color:r.zile_pana_expirare < 0 ? G.red : G.orange,fontWeight:700}}>
                      {r.zile_pana_expirare < 0 ? `expirată de ${-r.zile_pana_expirare} zile` : `${r.zile_pana_expirare} zile`}
                    </div>
                  )}
                </td>
                <td style={{padding:'9px 12px'}}>
                  <span style={{padding:'3px 9px',borderRadius:20,fontSize:11,fontWeight:700,
                    background:(STARE[r.stare]?.c || G.dim)+'22', color:STARE[r.stare]?.c || G.dim}}>
                    {STARE[r.stare]?.l || r.stare}
                  </span>
                  {r.blocat_litigiu && (
                    <div title={r.litigiu_detalii || 'Litigiu în curs'} style={{fontSize:10.5,color:G.red,marginTop:3,fontWeight:700}}>⛔ litigiu</div>
                  )}
                  {boRezumat[r.id]?.scadente > 0 && (
                    <div title={`${boRezumat[r.id].scadente} bilet(e) la ordin emis(e) cu scadența în ≤ 14 zile${boRezumat[r.id].depasite ? `, ${boRezumat[r.id].depasite} cu scadența depășită` : ''}`}
                      style={{fontSize:10.5,color:boRezumat[r.id].depasite ? G.red : G.orange,marginTop:3,fontWeight:700}}>🧾 BO scadent</div>
                  )}
                  {r.lucrare_receptionata ? (
                    <div style={{fontSize:10.5,color:G.green,marginTop:3,fontWeight:600}}>✓ recepționată</div>
                  ) : r.data_receptie ? (
                    <div title={r.document_receptie || ''} style={{fontSize:10.5,color:G.yellow,marginTop:3,fontWeight:600}}>
                      📄 PV găsit — de bifat
                    </div>
                  ) : null}
                </td>
                <td style={{padding:'9px 12px',fontSize:11.5,color:r.de_facut?.startsWith('EXPIRATA') ? G.red : G.yellow,maxWidth:230}}>
                  {r.de_facut || <span style={{color:G.dim}}>—</span>}
                </td>
                <td style={{padding:'9px 12px',textAlign:'right',whiteSpace:'nowrap'}}>
                  {canEdit && !r.lucrare_receptionata && (
                    <button onClick={() => marcheazaReceptie(r)} style={{...S.btnS,marginRight:5}} title="Marchează lucrarea ca recepționată (PVR)">✓ Recepție</button>
                  )}
                  {canEdit && r.stare === 'activa' && TIPURI_CERERE[r.tip] && (
                    <button onClick={() => setCerere(r)} style={{...S.btnS,marginRight:5}} title={`Cere brokerului ofertă de poliță — ${TIPURI_CERERE[r.tip].eticheta}`}>📨 Cere ofertă</button>
                  )}
                  {r.forma === 'polita_asigurare' && (
                    <button onClick={() => setBilete(r)}
                      title="Bilete la ordin date ca garanție la această poliță (nu plata primei) — urmărite până la restituire"
                      style={{...S.btnS, marginRight:5,
                        background: boRezumat[r.id]?.emise ? G.yellow+'18' : G.surface,
                        color: boRezumat[r.id]?.emise ? G.yellow : G.text,
                        border:`1px solid ${boRezumat[r.id]?.emise ? G.yellow+'55' : G.border2}`}}>
                      🧾 BO ({boRezumat[r.id]?.total || 0})
                    </button>
                  )}
                  <button onClick={() => setAdresa(r)} disabled={r.blocat_litigiu}
                    title={r.blocat_litigiu ? 'Blocată de litigiu — nu se cere eliberarea' : 'Generează adresa către emitent'}
                    style={{...S.btnS,
                      background: r.blocat_litigiu ? 'transparent' : G.blue+'18',
                      color: r.blocat_litigiu ? G.dim : G.blue,
                      border:`1px solid ${r.blocat_litigiu ? G.border2 : G.blue+'55'}`,
                      cursor: r.blocat_litigiu ? 'not-allowed' : 'pointer'}}>
                    ✉️ Adresă
                  </button>
                </td>
              </tr>
            ))}
            {vizibile.length === 0 && (
              <tr><td colSpan={8} style={{padding:'22px 12px',textAlign:'center',color:G.dim}}>Nicio garanție în registru.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{fontSize:11.5,color:G.dim,marginTop:12,lineHeight:1.6}}>
        Expirarea unei polițe nu înseamnă automat eliberarea garanției — de regulă e nevoie de procesul-verbal de recepție
        de la beneficiar. De aceea butonul „Adresă" te avertizează dacă recepția nu e bifată.
        Evidența GBE pe contract (cât s-a reținut, cât s-a restituit) rămâne în tabul 🔐 Garanții GBE.
        Biletele la ordin date ca garanție la polițe (🧾 BO) nu sunt plata primei — se urmăresc până le restituie asigurătorul.
      </div>

      {adresa && <AdresaPanel garantie={adresa} onClose={() => setAdresa(null)} showToast={showToast} />}
      {politaNoua && <PolitaExistentaPanel tipuriPermise={tipuriPermise} showToast={showToast} onClose={() => setPolitaNoua(false)} onDone={load} />}
      {cerere && <CerereOfertaPanel initial={cerere.id ? cerere : null} tipuriPermise={tipuriPermise} profile={profile} showToast={showToast} onClose={() => setCerere(null)} onDone={load} />}
      {bilete && <BiletePanel garantie={bilete} canEdit={canEdit} showToast={showToast} onClose={() => setBilete(null)} onChanged={() => incarcaBo(randuri)} />}
    </div>
  )
}
