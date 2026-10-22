import { listaMesaje, textMesaj } from './izoCorectiiLogica.js'
export const G = { bg:'#0D1117', surface:'#161B22', border:'#30363D', text:'#E6EDF3', muted:'#8B949E', red:'#F85149', yellow:'#D29922', green:'#3FB950' }
export const S = {
  card:{ background:G.surface, color:G.text, border:`1px solid ${G.border}`, borderRadius:12, padding:14, marginBottom:12 },
  input:{ background:G.bg, color:G.text, border:`1px solid ${G.border}`, borderRadius:8, padding:8, width:'100%', boxSizing:'border-box', fontFamily:'inherit' },
  btn:{ background:G.surface, color:G.text, border:`1px solid ${G.border}`, borderRadius:8, padding:'8px 12px', cursor:'pointer', margin:3 },
}
export function Camp({ nume, value, onChange, children }) {
  return <label style={{ display:'block', marginBottom:10, color:G.muted, fontSize:13 }}>{nume}{children || <input style={S.input} value={value ?? ''} onChange={e => onChange(e.target.value)} />}</label>
}
export function Modal({ titlu, busy, inchide, children }) {
  return <div style={{ position:'fixed', inset:0, background:'#000b', zIndex:1100, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}><section role="dialog" aria-modal="true" aria-label={titlu} style={{ ...S.card, width:620, maxWidth:'100%', maxHeight:'90vh', overflowY:'auto' }}><button style={{ ...S.btn, float:'right' }} disabled={busy} onClick={inchide}>Închide</button><h3>{titlu}</h3>{children}</section></div>
}
export function Verificare({ v }) {
  if (!v) return null
  return <div style={S.card}><div>{v.ok ? 'Verificare fără blocante vizibile.' : 'Verificarea are blocante.'}</div>{['blocante', 'avertismente'].map(k => <div key={k} style={{ color:k === 'blocante' ? G.red : G.yellow }}>{listaMesaje(v[k]).map((x, i) => <p key={i}>{textMesaj(x)}</p>)}</div>)}<Comparatie inainte={v.inainte} dupa={v.dupa_efectiv} /><small>Unicitatea globală se verifică din nou la aplicare.</small></div>
}
export function Comparatie({ inainte, dupa }) {
  return <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>{[['Înainte', inainte], ['După', dupa]].map(([n, v]) => <div key={n} style={{ flex:1, minWidth:180 }}><strong>{n}</strong><pre style={{ whiteSpace:'pre-wrap', overflowWrap:'anywhere', fontSize:12 }}>{JSON.stringify(v || {}, null, 2)}</pre></div>)}</div>
}
