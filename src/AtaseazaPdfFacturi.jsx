// AtaseazaPdfFacturi.jsx — „📎 Atașează PDF-uri existente” (Financiar → Facturi emise), DOAR owner (13.10.2026).
// Facturile emise în afara platformei: alegi PDF-urile din folderul NAS „Facturi <an>”, vezi potrivirea + SHA-256,
// apoi fiecare PDF potrivit sigur se urcă în facturi-emise (fără suprascriere) și se leagă prin fn_factura_ataseaza_pdf.
// Zero potriviri / ambiguu / are deja PDF = sărit. Jurnalul cu id-urile legate se descarcă la final (pentru revenire).
import { useState, useMemo } from 'react'
import { supabase } from './lib/supabase.js'
import { potriveste, cheieStorage, caleNas, numeSigur, sha256Hex } from './facturiPdfLogic.js'

const C = {
  bg:'#0D1117', surface:'#161B22', card:'#1C2128', text:'#E6EDF3', muted:'#8B949E',
  border:'#30363D', green:'#2EA043', yellow:'#D29922', red:'#F85149', blue:'#58A6FF',
}
const MAX_BYTES = 10 * 1024 * 1024
const ETICHETA = {
  ok:         ['✅ se atașează', C.green],
  nepotrivit: ['⏭ fără potrivire', C.muted],
  ambiguu:    ['⚠️ ambiguu — sărit', C.yellow],
  are_pdf:    ['⏭ are deja PDF', C.muted],
  invalid:    ['⛔ invalid', C.red],
}
const kb = n => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`
const btn = (bg, fg = '#0D1117') => ({ padding:'8px 16px', background:bg, color:fg, border:'none', borderRadius:7, cursor:'pointer', fontSize:13, fontWeight:700 })

export default function AtaseazaPdfFacturi({ facturi, onClose }) {
  const [randuri, setRanduri] = useState([])   // {fisier, stare, factura, motiv, sha, buf}
  const [citire, setCitire]   = useState(false)
  const [lucru, setLucru]     = useState(false)
  const [rezultat, setRezultat] = useState(null) // [{id, nr_complet, pdf_path, nas_path, sha256, ok, eroare}]
  const [dinNas, setDinNas]   = useState(false)  // nas_synced=true se bazează pe faptul că fișierele vin direct din folderul NAS

  const alege = async (e) => {
    const files = [...(e.target.files || [])]
    e.target.value = ''
    setRezultat(null); setDinNas(false); setCitire(true)  // selecție nouă = confirmare NAS nouă
    try {
      const rez = potriveste(files, facturi)
      const out = []
      for (const r of rez) {
        let { stare, motiv } = r
        // mărimea se verifică ÎNAINTE de citire: fișierele mari nu se încarcă în memorie
        if (r.fisier.size > MAX_BYTES || r.fisier.size === 0) {
          out.push({ ...r, stare: stare === 'ok' ? 'invalid' : stare, motiv: stare === 'ok' ? `mărime ${kb(r.fisier.size)} (max 10 MB)` : motiv, sha: null, buf: null })
          continue
        }
        const buf = await r.fisier.arrayBuffer()
        const sha = await sha256Hex(buf)
        if (stare === 'ok' && !numeSigur(r.fisier.name)) { stare = 'invalid'; motiv = 'nume de fișier nepermis' }
        else if (stare === 'ok' && !/^%PDF-/.test(new TextDecoder().decode(new Uint8Array(buf.slice(0, 5))))) { stare = 'invalid'; motiv = 'conținutul nu e PDF' }
        out.push({ ...r, stare, motiv, sha, buf: stare === 'ok' ? buf : null })
      }
      // același conținut (SHA) pe două facturi diferite = suspect → ambele sărite
      const peSha = new Map()
      for (const r of out) if (r.stare === 'ok') peSha.set(r.sha, (peSha.get(r.sha) || 0) + 1)
      setRanduri(out.map(r => r.stare === 'ok' && peSha.get(r.sha) > 1
        ? { ...r, stare: 'ambiguu', motiv: 'același fișier (SHA-256) pe mai multe facturi', buf: null } : r))
    } finally { setCitire(false) }
  }

  const deAtasat = useMemo(() => randuri.filter(r => r.stare === 'ok'), [randuri])

  const ataseaza = async () => {
    if (!deAtasat.length || lucru || !dinNas) return
    if (!window.confirm(`Atașez ${deAtasat.length} PDF-uri la facturile potrivite? Fișierele existente în Storage NU se suprascriu.`)) return
    setLucru(true)
    const jurnal = []
    for (const r of deAtasat) {
      const f = r.factura
      const pdf_path = cheieStorage(f, r.fisier.name)
      const nas_path = caleNas(f, r.fisier.name)
      const rand = { id: f.id, nr_complet: f.nr_complet, fisier: r.fisier.name, pdf_path, nas_path, sha256: r.sha, ok: false, eroare: '' }
      const { error: eUp } = await supabase.storage.from('facturi-emise')
        .upload(pdf_path, new Blob([r.buf], { type: 'application/pdf' }), { upsert: false, contentType: 'application/pdf' })
      if (eUp) { rand.eroare = `upload: ${eUp.message}`; jurnal.push(rand); continue }
      const args = { p_id: f.id, p_pdf_path: pdf_path, p_nas_path: nas_path }
      let { data, error: eRpc } = await supabase.rpc('fn_factura_ataseaza_pdf', args)
      if (eRpc) ({ data, error: eRpc } = await supabase.rpc('fn_factura_ataseaza_pdf', args))  // RPC idempotent: o reîncercare
      if (data?.ok) rand.ok = true
      else if (data && data.ok === false) {
        // răspuns DEFINITIV de la server (factura are alt PDF): obiectul urcat acum nu rămâne orfan
        rand.eroare = `legare: ${data.motiv || 'refuzat'}`
        const { error: eDel } = await supabase.storage.from('facturi-emise').remove([pdf_path])
        if (eDel) rand.eroare += ` · fișierul ${pdf_path} a rămas în Storage (${eDel.message})`
      } else {
        // stare neconfirmată (eroare / rețea): NU ștergem — poate legarea s-a făcut; fișierul rămâne, se verifică manual
        rand.eroare = `legare neconfirmată: ${eRpc?.message || 'fără răspuns'} · fișierul ${pdf_path} NU a fost șters`
      }
      jurnal.push(rand)
    }
    setRezultat(jurnal); setLucru(false)
    descarcaJurnal(jurnal)
  }

  const descarcaJurnal = (j) => {
    const blob = new Blob([JSON.stringify({ generat: new Date().toISOString(), atasate_ids: j.filter(x => x.ok).map(x => x.id), randuri: j }, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `facturi_pdf_atasate_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }

  const nrOk = rezultat?.filter(x => x.ok).length || 0
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.7)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
      <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, width:'min(1100px,100%)', maxHeight:'90vh', display:'flex', flexDirection:'column', color:C.text }}>
        <div style={{ padding:'14px 18px', borderBottom:`1px solid ${C.border}`, display:'flex', justifyContent:'space-between', alignItems:'center', gap:12 }}>
          <div>
            <div style={{ fontWeight:800, fontSize:16 }}>📎 Atașează PDF-uri existente</div>
            <div style={{ color:C.muted, fontSize:12, marginTop:2 }}>
              Alege PDF-urile din folderul NAS „Facturi &lt;an&gt;”. Potrivire doar după numărul GAZ din nume; orice neclaritate se sare.
            </div>
          </div>
          <button onClick={onClose} disabled={lucru} style={{ ...btn(C.card, C.text), border:`1px solid ${C.border}` }}>✕</button>
        </div>

        <div style={{ padding:'12px 18px', display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
          <label style={{ ...btn(C.blue), display:'inline-block', opacity: lucru ? .5 : 1, pointerEvents: lucru ? 'none' : 'auto' }}>
            📂 Alege PDF-uri
            <input type="file" accept="application/pdf,.pdf" multiple onChange={alege} style={{ display:'none' }} />
          </label>
          {citire && <span style={{ color:C.muted, fontSize:12 }}>Citesc fișierele și calculez SHA-256…</span>}
          {randuri.length > 0 && !citire && (
            <span style={{ color:C.muted, fontSize:12 }}>
              {randuri.length} PDF · <b style={{ color:C.green }}>{deAtasat.length} se atașează</b> · {randuri.length - deAtasat.length} sărite
            </span>
          )}
          <div style={{ flex:1 }} />
          {!rezultat && (
            <label style={{ fontSize:12, color: dinNas ? C.text : C.yellow, display:'flex', alignItems:'center', gap:6, cursor:'pointer' }}>
              <input type="checkbox" checked={dinNas} onChange={e => setDinNas(e.target.checked)} disabled={lucru} />
              Fișierele sunt alese direct din folderul NAS „Facturi &lt;an&gt;” (nu copii locale)
            </label>
          )}
          {!rezultat && (
            <button onClick={ataseaza} disabled={!deAtasat.length || lucru || !dinNas} style={{ ...btn(C.green), opacity: !deAtasat.length || lucru || !dinNas ? .5 : 1 }}>
              {lucru ? 'Se atașează…' : `Atașează ${deAtasat.length}`}
            </button>
          )}
          {rezultat && <button onClick={() => descarcaJurnal(rezultat)} style={{ ...btn(C.card, C.text), border:`1px solid ${C.border}` }}>⬇ Jurnal JSON</button>}
        </div>

        {rezultat && (
          <div style={{ margin:'0 18px 10px', padding:'10px 12px', borderRadius:8, background:(nrOk === rezultat.length ? C.green : C.yellow) + '22', fontSize:13 }}>
            {nrOk} din {rezultat.length} atașate. Jurnalul (cu id-urile pentru revenire) s-a descărcat.
            {rezultat.filter(x => !x.ok).map(x => <div key={x.id} style={{ color:C.red, fontSize:12, marginTop:4 }}>{x.nr_complet}: {x.eroare}</div>)}
          </div>
        )}

        <div style={{ overflow:'auto', padding:'0 18px 18px' }}>
          {randuri.length > 0 && (
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead>
                <tr style={{ color:C.muted, textAlign:'left' }}>
                  {['Fișier', 'Mărime', 'SHA-256', 'Factură', 'Beneficiar', 'Total', 'Stare'].map(h =>
                    <th key={h} style={{ padding:'6px 8px', borderBottom:`1px solid ${C.border}`, position:'sticky', top:0, background:C.surface }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {randuri.map((r, i) => {
                  const [et, col] = ETICHETA[r.stare] || [r.stare, C.muted]
                  return (
                    <tr key={i} style={{ borderBottom:`1px solid ${C.border}` }}>
                      <td style={{ padding:'6px 8px', maxWidth:340, wordBreak:'break-all' }}>{r.fisier.name}</td>
                      <td style={{ padding:'6px 8px', whiteSpace:'nowrap' }}>{kb(r.fisier.size)}</td>
                      <td style={{ padding:'6px 8px', fontFamily:'monospace' }} title={r.sha || ''}>{r.sha ? `${r.sha.slice(0, 12)}…` : '—'}</td>
                      <td style={{ padding:'6px 8px', whiteSpace:'nowrap' }}>{r.factura ? (r.factura.nr_complet || `GAZ-${r.factura.nr}`) : '—'}</td>
                      <td style={{ padding:'6px 8px' }}>{r.factura?.beneficiar_nume || '—'}</td>
                      <td style={{ padding:'6px 8px', whiteSpace:'nowrap' }}>{r.factura?.total != null ? Number(r.factura.total).toLocaleString('ro-RO', { minimumFractionDigits:2 }) : '—'}</td>
                      <td style={{ padding:'6px 8px', color:col }}>{et}{r.motiv ? <div style={{ color:C.muted, fontSize:11 }}>{r.motiv}</div> : null}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
