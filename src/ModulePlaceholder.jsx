// ════════════════════════════════════════════════════════════════
// ModulePlaceholder.jsx — Componentă reutilizabilă placeholder
// pentru module Comercial care sunt în dezvoltare (Faze 2-6)
// LIVE: 19.05.2026 (Etapa 15 Faza 1 — fundație BD + module placeholder)
// ════════════════════════════════════════════════════════════════
const G = { bg:'#0D1117',surface:'#161B22',border:'#21262D',border2:'#30363D',text:'#E6EDF3',muted:'#8B949E',dim:'#6E7681',blue:'#58A6FF',green:'#3FB950',red:'#F85149',yellow:'#D29922',purple:'#BC8CFF',orange:'#F0883E' }

export default function ModulePlaceholder({ icon, title, subtitle, color, faza, etapa, owner, features = [], statusBd = true, statusUi = false }) {
  return (
    <div style={{padding:'24px 32px',minHeight:'calc(100vh - 60px)',background:G.bg}}>
      {/* HERO */}
      <div style={{
        display:'flex',alignItems:'center',gap:18,marginBottom:24,padding:'24px 28px',
        background:`linear-gradient(135deg, ${color}22, ${G.surface})`,
        border:`1px solid ${color}44`,borderRadius:14
      }}>
        <div style={{
          fontSize:56,width:90,height:90,borderRadius:14,
          background:color+'33',border:`2px solid ${color}66`,
          display:'flex',alignItems:'center',justifyContent:'center'
        }}>{icon}</div>
        <div style={{flex:1}}>
          <div style={{fontSize:28,fontWeight:800,color,letterSpacing:'-0.5px',marginBottom:4}}>{title}</div>
          <div style={{fontSize:14,color:G.muted,lineHeight:1.5}}>{subtitle}</div>
          {owner && (
            <div style={{display:'inline-flex',alignItems:'center',gap:6,marginTop:10,padding:'4px 10px',background:G.bg,border:`1px solid ${G.border2}`,borderRadius:20}}>
              <span style={{fontSize:11,color:G.dim}}>Owner:</span>
              <span style={{fontSize:12,fontWeight:700,color}}>{owner}</span>
            </div>
          )}
        </div>
      </div>

      {/* STATUS BADGE */}
      <div style={{display:'flex',gap:10,marginBottom:24,flexWrap:'wrap'}}>
        <StatusBadge label="Schema BD" status={statusBd ? 'ready' : 'pending'} />
        <StatusBadge label="UI funcțional" status={statusUi ? 'ready' : 'pending'} />
        <StatusBadge label={`Faza ${faza}`} status="in_progress" />
        {etapa && <StatusBadge label={`Etapa ${etapa}`} status="active" color={color} />}
      </div>

      {/* COMING SOON CARD */}
      <div style={{
        background:G.surface,border:`1px solid ${G.border2}`,borderRadius:12,
        padding:'28px 32px',marginBottom:24
      }}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:6}}>
          <span style={{fontSize:24}}>🚧</span>
          <div style={{fontSize:18,fontWeight:700,color:G.text}}>În dezvoltare — Faza {faza}</div>
        </div>
        <div style={{fontSize:13,color:G.muted,lineHeight:1.6,marginBottom:18}}>
          Schema bazei de date e gata și activă în Supabase (tabele + RLS + GRANT + policies).
          Interfața vizuală pentru acest modul va fi construită în <strong style={{color}}>Faza {faza}</strong> a roadmap-ului Comercial.
        </div>

        {features.length > 0 && (
          <div>
            <div style={{fontSize:12,fontWeight:700,color:G.text,marginBottom:10,textTransform:'uppercase',letterSpacing:'0.5px'}}>
              📋 Features planificate
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              {features.map((f, i) => (
                <div key={i} style={{
                  display:'flex',alignItems:'flex-start',gap:10,padding:'10px 14px',
                  background:G.bg,border:`1px solid ${G.border}`,borderRadius:8
                }}>
                  <span style={{fontSize:14,marginTop:2,color}}>▸</span>
                  <div style={{fontSize:13,color:G.text,lineHeight:1.5,flex:1}}>{f}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* FOOTER INFO */}
      <div style={{
        textAlign:'center',padding:'18px',background:G.surface+'88',
        border:`1px dashed ${G.border2}`,borderRadius:10,color:G.dim,fontSize:12
      }}>
        💡 <strong style={{color:G.muted}}>Sfat:</strong> dacă vrei să prioritizezi acest modul mai sus în roadmap, contactează Razvan.
      </div>
    </div>
  )
}

function StatusBadge({ label, status, color }) {
  const cfg = {
    ready:       { bg:'#1F3D2B', border:G.green,  text:G.green,  icon:'✓', txt:'Gata' },
    pending:     { bg:'#3D2B1F', border:G.orange, text:G.orange, icon:'⏳', txt:'În așteptare' },
    in_progress: { bg:'#1F2A3D', border:G.blue,   text:G.blue,   icon:'🚧', txt:'Următoarea' },
    active:      { bg:(color||G.purple)+'22', border:(color||G.purple), text:(color||G.purple), icon:'●', txt:'Activă' },
  }[status] || {}
  return (
    <div style={{
      display:'inline-flex',alignItems:'center',gap:6,padding:'6px 12px',
      background:cfg.bg,border:`1px solid ${cfg.border}`,borderRadius:20,fontSize:12,fontWeight:600
    }}>
      <span style={{color:cfg.text}}>{cfg.icon}</span>
      <span style={{color:G.muted}}>{label}:</span>
      <span style={{color:cfg.text}}>{cfg.txt}</span>
    </div>
  )
}
