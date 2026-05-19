// ════════════════════════════════════════════════════════════════
// ContracteTertiTab.jsx — Sub-tab „Contracte cu terți" din Administrativ
// LIVE: 19.05.2026 (Etapa 15 Faza 1 — placeholder cu listă beneficiari real)
// Next: Faza 2 (CRUD beneficiari complet + Upload PDF contract + AI parser Claude Vision)
// ════════════════════════════════════════════════════════════════
import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase.js'

const G = {
  bg:'#0D1117', surface:'#161B22', border:'#21262D', border2:'#30363D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  blue:'#58A6FF', green:'#3FB950', red:'#F85149', yellow:'#D29922',
  purple:'#BC8CFF', orange:'#F0883E'
}

export default function ContracteTertiTab() {
  const [beneficiari, setBeneficiari] = useState([])
  const [contracte, setContracte] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [bRes, cRes] = await Promise.all([
        supabase.from('beneficiari').select('*').order('nume'),
        supabase.from('contracte_terti').select('id, beneficiar_id, denumire, status, data_termen, valoare_lei')
      ])
      if (cancelled) return
      setBeneficiari(bRes.data || [])
      setContracte(cRes.data || [])
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [])

  const contracteByBeneficiar = beneficiari.map(b => ({
    ...b,
    contracte: contracte.filter(c => c.beneficiar_id === b.id)
  }))

  if (loading) {
    return (
      <div style={{padding:40, textAlign:'center', color:G.muted, fontSize:13}}>
        ⏳ Se încarcă beneficiarii...
      </div>
    )
  }

  return (
    <div style={{display:'flex', flexDirection:'column', gap:18}}>
      {/* HERO */}
      <div style={{
        padding:'20px 24px',
        background:`linear-gradient(135deg, ${G.orange}22, ${G.surface})`,
        border:`1px solid ${G.orange}44`,borderRadius:12
      }}>
        <div style={{display:'flex', alignItems:'center', gap:14, marginBottom:6}}>
          <span style={{fontSize:32}}>📃</span>
          <div>
            <div style={{fontSize:20, fontWeight:800, color:G.orange}}>Contracte cu terți</div>
            <div style={{fontSize:12, color:G.muted, marginTop:2}}>
              Contracte de lucrări per beneficiar — folosite pentru asociere comenzi din modul Comercial
            </div>
          </div>
        </div>
        <div style={{display:'flex', gap:16, marginTop:14, fontSize:12, color:G.muted}}>
          <div>📊 <strong style={{color:G.text}}>{beneficiari.length}</strong> beneficiari activi</div>
          <div>📃 <strong style={{color:G.text}}>{contracte.length}</strong> contracte</div>
          <div style={{color:G.purple}}>🚧 CRUD complet la Faza 2 (AI parser PDF)</div>
        </div>
      </div>

      {/* TOOLBAR */}
      <div style={{display:'flex', gap:10, alignItems:'center'}}>
        <button 
          disabled
          title="Disponibil la Faza 2 (CRUD + AI parser)"
          style={{
            padding:'10px 16px', borderRadius:8, border:`1px dashed ${G.border2}`, cursor:'not-allowed',
            background:'transparent', color:G.dim, fontWeight:600, fontSize:13
          }}
        >
          + Adaugă contract (Faza 2)
        </button>
        <button 
          disabled
          title="Disponibil la Faza 2 (AI parser Claude Vision)"
          style={{
            padding:'10px 16px', borderRadius:8, border:`1px dashed ${G.border2}`, cursor:'not-allowed',
            background:'transparent', color:G.dim, fontWeight:600, fontSize:13
          }}
        >
          📄 Upload PDF + AI extract (Faza 2)
        </button>
      </div>

      {/* LISTĂ BENEFICIARI */}
      <div>
        <div style={{fontSize:13, fontWeight:700, color:G.text, marginBottom:10, textTransform:'uppercase', letterSpacing:'0.5px'}}>
          Beneficiari principali
        </div>
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(260px, 1fr))', gap:12}}>
          {contracteByBeneficiar.map(b => (
            <div key={b.id} style={{
              padding:'16px 18px',
              background:G.surface,
              border:`1px solid ${G.border}`,
              borderRadius:10
            }}>
              <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:8}}>
                <div style={{
                  width:38, height:38, borderRadius:8,
                  background:G.orange+'22', border:`1px solid ${G.orange}44`,
                  display:'flex', alignItems:'center', justifyContent:'center', fontSize:18
                }}>🏢</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:14, fontWeight:700, color:G.text}}>{b.nume}</div>
                  {b.cod_fiscal && (
                    <div style={{fontSize:11, color:G.dim, fontFamily:'monospace'}}>CUI: {b.cod_fiscal}</div>
                  )}
                </div>
              </div>
              {b.observatii && (
                <div style={{fontSize:11, color:G.muted, lineHeight:1.5, marginBottom:8, fontStyle:'italic'}}>
                  {b.observatii}
                </div>
              )}
              <div style={{
                display:'flex', alignItems:'center', gap:8, marginTop:10, paddingTop:10,
                borderTop:`1px solid ${G.border}`
              }}>
                <span style={{fontSize:11, color:G.dim}}>Contracte:</span>
                <span style={{
                  fontSize:12, fontWeight:700,
                  color:b.contracte.length > 0 ? G.green : G.dim
                }}>
                  {b.contracte.length}
                </span>
                {b.contracte.length === 0 && (
                  <span style={{fontSize:10, color:G.dim, marginLeft:'auto'}}>(de adăugat la Faza 2)</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* INFO FAZE */}
      <div style={{
        padding:'18px 22px',
        background:G.surface+'88',
        border:`1px dashed ${G.border2}`,
        borderRadius:10
      }}>
        <div style={{fontSize:12, fontWeight:700, color:G.purple, marginBottom:10}}>
          🚀 Roadmap modul Contracte cu terți
        </div>
        <div style={{display:'flex', flexDirection:'column', gap:6, fontSize:12, color:G.muted, lineHeight:1.6}}>
          <div>✅ <strong style={{color:G.green}}>Faza 1</strong> — Schema BD + seed 6 beneficiari principali</div>
          <div>🚧 <strong style={{color:G.blue}}>Faza 2</strong> — CRUD beneficiari + Upload PDF contract + AI parser Claude Vision (extract denumire/valoare/termen/clauze)</div>
          <div>⏳ <strong style={{color:G.dim}}>Faza 3</strong> — Legare șantier ↔ contract (din Administrativ → Șantiere dropdown)</div>
          <div>⏳ <strong style={{color:G.dim}}>Faza 4</strong> — Folosire contract ca FK la comenzile MP din modul Comercial</div>
        </div>
      </div>
    </div>
  )
}
