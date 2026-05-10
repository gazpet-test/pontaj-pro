// ===========================================================================
// MODUL ADMINISTRATIV — Documente firma · Furnizori · Ticketing
// ===========================================================================
import { useState } from 'react'

const G = {
  bg:'#0D1117', surface:'#161B22', card:'#161B22', text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  border:'#30363D', orange:'#F0883E', purple:'#A371F7', blue:'#1F6FEB', green:'#2EA043',
}

const S = {
  page: { padding:'24px 28px', minHeight:'calc(100vh - 60px)', background:G.bg, color:G.text, fontFamily:'-apple-system,BlinkMacSystemFont,Inter,sans-serif' },
  card: { background:G.card, borderRadius:12, border:`1px solid ${G.border}` },
  btnP: { padding:'9px 16px', background:G.orange, color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:600 },
}

export default function AdministrativPage() {
  const [tab, setTab] = useState('documente')
  
  const tabs = [
    { key: 'documente',  icon: '📁', label: 'Documente firmă' },
    { key: 'furnizori',  icon: '🏢', label: 'Furnizori' },
    { key: 'ticketing',  icon: '🎫', label: 'Ticketing' },
    { key: 'contracte',  icon: '📜', label: 'Contracte comerciale' },
  ]
  
  return (
    <div style={S.page}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18}}>
        <div>
          <div style={{fontSize:22, fontWeight:800, color:G.text, display:'flex', alignItems:'center', gap:10}}>
            <span style={{fontSize:28}}>🏢</span> 
            <span style={{background: `linear-gradient(135deg, ${G.orange} 0%, ${G.purple} 100%)`, WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent'}}>Administrativ</span>
          </div>
          <div style={{fontSize:12, color:G.muted, marginTop:4}}>
            Documente firmă · Furnizori · Ticketing · Contracte comerciale
          </div>
        </div>
      </div>
      
      <div style={{display:'flex', gap:6, marginBottom:18, padding:6, background:G.surface, borderRadius:12, border:`1px solid ${G.border}`}}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding:'10px 16px', borderRadius:8, border:'none', cursor:'pointer',
            background: tab === t.key ? G.orange + '33' : 'transparent',
            color: tab === t.key ? G.orange : G.muted,
            fontWeight:700, fontSize:13, display:'flex', alignItems:'center', gap:8
          }}>
            <span>{t.icon}</span> {t.label}
          </button>
        ))}
      </div>
      
      {/* Toate tab-urile sunt placeholder pentru moment */}
      <div style={{...S.card, padding:50, textAlign:'center'}}>
        <div style={{fontSize:48, marginBottom:14}}>
          {tab === 'documente' && '📁'}
          {tab === 'furnizori' && '🏢'}
          {tab === 'ticketing' && '🎫'}
          {tab === 'contracte' && '📜'}
        </div>
        <div style={{fontSize:18, fontWeight:700, color:G.text, marginBottom:8}}>
          {tab === 'documente' && 'Documente Firmă'}
          {tab === 'furnizori' && 'Furnizori'}
          {tab === 'ticketing' && 'Ticketing'}
          {tab === 'contracte' && 'Contracte Comerciale'}
        </div>
        <div style={{fontSize:13, color:G.muted, maxWidth:520, margin:'0 auto 16px', lineHeight:1.6}}>
          {tab === 'documente' && (
            <>Aici vor fi <strong>documentele oficiale ale firmei</strong>:<br/>
            CUI · Acte constitutive · Statut · Bilanțuri · Audit · Asigurări companie</>
          )}
          {tab === 'furnizori' && (
            <>Bază de date <strong>furnizori</strong> cu:<br/>
            Date contact · Contracte · Plăți · Istoric comenzi · Termenele de plată</>
          )}
          {tab === 'ticketing' && (
            <>Sistem <strong>tickete interne</strong>:<br/>
            Solicitări de la angajați · Diviziuni · Asignare · SLA · Closure</>
          )}
          {tab === 'contracte' && (
            <>Contracte <strong>cu clienți și parteneri</strong>:<br/>
            Generare automată · Date firmă · Templates · Semnare digitală</>
          )}
        </div>
        <div style={{padding:'8px 16px', background:G.purple+'22', color:G.purple, borderRadius:6, display:'inline-block', fontSize:11, fontWeight:700, letterSpacing:.5}}>
          🚧 ÎN CURÂND — Faza 2
        </div>
      </div>
    </div>
  )
}
