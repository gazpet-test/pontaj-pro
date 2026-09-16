// ════════════════════════════════════════════════════════════════
// GarantiiRegistru.jsx — Registrul de garanții constituite (16.09.2026)
//   Instrumentul, nu contractul: cont de trezorerie, depozit bancar, poliță de asigurare.
//   Acoperă și lucrările vechi care nu au rând în contracte_terti.
//   Rostul: să vezi ce mănâncă din plafonul de la asigurător și ce se poate elibera.
//   Evidența GBE pe contract (reținut/restituit) rămâne în GbeEvidenta.jsx — aici e sursa banilor blocați.
// ════════════════════════════════════════════════════════════════
import { useState, useEffect, useCallback } from 'react'
import { supabase } from './lib/supabase.js'

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

export default function GarantiiRegistru({ canEdit = false, showToast }) {
  const [randuri, setRanduri] = useState([])
  const [plafon, setPlafon]   = useState([])
  const [loading, setLoading] = useState(true)
  const [adresa, setAdresa]   = useState(null)
  const [doarActive, setDoarActive] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: g }, { data: p }] = await Promise.all([
      supabase.from('v_garantii_situatie').select('*').order('data_expirare', { ascending: true, nullsFirst: false }),
      supabase.from('v_garantii_plafon_emitent').select('*'),
    ])
    setRanduri(g || []); setPlafon(p || []); setLoading(false)
  }, [])
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

      <label style={{display:'inline-flex',alignItems:'center',gap:6,fontSize:12.5,color:G.muted,marginBottom:10,cursor:'pointer'}}>
        <input type="checkbox" checked={doarActive} onChange={e => setDoarActive(e.target.checked)} />
        doar garanțiile active
      </label>

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
      </div>

      {adresa && <AdresaPanel garantie={adresa} onClose={() => setAdresa(null)} showToast={showToast} />}
    </div>
  )
}
