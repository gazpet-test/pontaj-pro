// ===========================================================================
// Rândurile tabelului „Conținut transport” din avizul de însoțire a mărfii.
// Mutat din AvizInsotireMarfaModal (Logistica.jsx) fără schimbare de afișare (TKT-2026-0379 r2):
// datele vin din randuriContinutAviz (avizContinut.js), aceeași definiție folosită de PV-ul de predare-primire.
// ===========================================================================

import { randuriContinutAviz } from './avizContinut.js'

const TD = { padding:'8px 8px', verticalAlign:'top', borderBottom:'1px solid #D1D5DB' }
const TD_COD = { ...TD, fontFamily:'monospace', fontSize:10 }
const TD_CENTRU = { padding:'8px 8px', textAlign:'center', verticalAlign:'top', borderBottom:'1px solid #D1D5DB' }
const REGIM = <div style={{fontSize:9, color:'#DC2626', fontWeight:'bold', marginTop:2}}>⚠️ REGIM TRANSPORT SPECIAL</div>

function LinieIdentificare({ i }) {
  if (i.camp === 'nr_inventar') return <div style={{fontWeight:'bold', color:'#1E40AF'}}>{i.eticheta}: <strong>{i.valoare}</strong></div>
  if (i.camp === 'cod_intern') return <div>{i.eticheta}: <strong>{i.valoare}</strong></div>
  if (i.camp === 'serie_sasiu') return <div style={{color:'#6B7280'}}>{i.eticheta}: {i.valoare}</div>
  return <div>{i.eticheta}: {i.valoare}</div>
}

export default function AvizContinutRanduri({ transport, continutItems }) {
  return randuriContinutAviz(transport, continutItems).map(r => (
    <tr key={r.key}>
      <td style={TD}>{r.nr}</td>
      <td style={TD}>
        {r.forma === 'multiplu' ? (
          <>
            <div style={{fontWeight:'bold'}}>{r.denumire}</div>
            <div style={{fontSize:9, color:'#6B7280', marginTop:2}}>
              {r.isUtilaj ? '🚛 Utilaj' : '📦 Marfă'}
            </div>
            {r.regimSpecial && REGIM}
            {r.observatii && (
              <div style={{fontSize:9, color:'#6B7280', marginTop:2, fontStyle:'italic'}}>{r.observatii}</div>
            )}
          </>
        ) : r.isUtilaj ? (
          <>
            <div style={{fontWeight:'bold'}}>{r.denumire}</div>
            {r.regimSpecial && REGIM}
          </>
        ) : (
          <div style={{whiteSpace:'pre-wrap'}}>{r.descriere}</div>
        )}
      </td>
      <td style={TD_COD}>
        {r.identificare ? <>{r.identificare.map(i => <LinieIdentificare key={i.camp} i={i} />)}</> : '—'}
      </td>
      <td style={TD_CENTRU}>{r.um}</td>
      <td style={{...TD_CENTRU, fontWeight:'bold'}}>{r.cantitate}</td>
    </tr>
  ))
}
