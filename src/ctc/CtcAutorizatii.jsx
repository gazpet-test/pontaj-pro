// CtcAutorizatii.jsx — CTC · „🪪 Autorizații pentru cartea tehnică” (TKT-2026-0389, migrarea 20261222b), doar citire.
// Autorizațiile SUDORILOR (valabile și expirate), cu câmpurile profesionale, pentru atașat la cartea tehnică — fără acces la modulul HR.
// Lista: RPC fn_ctc_autorizatii_sudori (dreptul CTC verificat în BD). Scanul: edge fn ctc-autorizatie-fisier (link de 60 s, doar pentru
// autorizații de sudor). Firmele de control nedistructiv (NDT) nu au încă autorizațiile ca date în platformă: se spune pe ecran.
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { G, inputSt, btnMic } from './ctcUi.jsx'
import { STARI, fmtZi, filtreaza, ordoneaza, clasificaEroare, incarcaAutorizatii, cereScan } from './ctcAutorizatiiUtil.js'

const th = { textAlign: 'left', padding: '7px 8px', fontSize: 11, color: G.muted, fontWeight: 700, borderBottom: `1px solid ${G.border}`, whiteSpace: 'nowrap' }
const td = { padding: '7px 8px', fontSize: 12, borderBottom: `1px solid ${G.border}`, verticalAlign: 'top' }

export default function CtcAutorizatii() {
  const [rows, setRows] = useState([])
  const [stareInc, setStareInc] = useState('incarc')   // incarc | gata | fara_drept | neactivat | eroare
  const [mesaj, setMesaj] = useState('')
  const [text, setText] = useState('')
  const [stare, setStare] = useState('toate')
  const [inlocuite, setInlocuite] = useState(true)
  const [busy, setBusy] = useState(null)
  const [eroareScan, setEroareScan] = useState('')
  const [reload, setReload] = useState(0)
  const gen = useRef(0)
  const activ = useRef(false)
  const ferestre = useRef(new Set())

  useEffect(() => {
    const g = ++gen.current   // L24: doar ultimul răspuns se aplică
    activ.current = true
    setStareInc('incarc'); setMesaj('')
    incarcaAutorizatii(supabase)
      .then(r => { if (g !== gen.current) return; setRows(r); setStareInc('gata') })
      .catch(e => { if (g !== gen.current) return; const c = clasificaEroare(e); setRows([]); setStareInc(c.tip); setMesaj(c.mesaj) })
    return () => { activ.current = false; for (const f of ferestre.current) f.close(); ferestre.current.clear() }
  }, [reload])

  const vizibile = useMemo(() => ordoneaza(filtreaza(rows, { text, stare, inlocuite })), [rows, text, stare, inlocuite])
  const nr = useMemo(() => ({
    valabila: rows.filter(r => r.stare === 'valabila').length,
    expirata: rows.filter(r => r.stare === 'expirata').length,
  }), [rows])

  const deschide = async (r) => {
    // fereastra se deschide sincron (altfel blocată de browser după await)
    const f = window.open('about:blank', '_blank')
    if (!f) { setEroareScan('Permite deschiderea unei file noi pentru scan.'); return }
    f.opener = null
    ferestre.current.add(f)
    setBusy(r.id); setEroareScan('')
    try {
      const rez = await cereScan(supabase, r.id)
      if (!activ.current || f.closed) return
      if (rez.url) f.location.replace(rez.url)
      else { f.close(); setEroareScan(rez.eroare) }
    } catch (e) {
      f.close()
      if (activ.current) setEroareScan(e?.message || 'Scanul nu poate fi deschis.')
    } finally {
      ferestre.current.delete(f)
      if (activ.current) setBusy(null)
    }
  }

  return (
    <div style={{ padding: '18px 28px' }}>
      <section style={{ background: G.surface, border: `1px solid ${G.border}`, borderRadius: 12, padding: 16, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
          <h3 style={{ margin: 0, color: G.ctc }}>🪪 Autorizații pentru cartea tehnică</h3>
          <span style={{ fontSize: 12, color: G.muted }}>doar citire · sudori (angajați și personal extern)</span>
        </div>
        <div style={{ fontSize: 12, color: G.muted, marginBottom: 12, lineHeight: 1.5 }}>
          Autorizațiile de sudor din evidența firmei, valabile și expirate, cu procedeul, diametrul și materialul. Scanul se deschide într-o filă
          nouă (link valabil un minut) și se poate atașa la cartea tehnică a lucrării.
        </div>

        {stareInc === 'gata' && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
            <input value={text} onChange={e => setText(e.target.value)} placeholder="Caută: nume, nr. autorizație, procedeu, firmă…" style={{ ...inputSt, maxWidth: 320 }} />
            <select value={stare} onChange={e => setStare(e.target.value)} style={{ ...inputSt, width: 'auto' }}>
              <option value="toate">Toate ({rows.length})</option>
              <option value="valabila">Valabile ({nr.valabila})</option>
              <option value="expirata">Expirate ({nr.expirata})</option>
              <option value="fara_data">Fără dată de expirare</option>
            </select>
            <label style={{ fontSize: 12, color: G.muted, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={inlocuite} onChange={e => setInlocuite(e.target.checked)} /> și cele înlocuite de o reînnoire
            </label>
          </div>
        )}

        {stareInc === 'incarc' && <div style={{ color: G.muted }}>Se încarcă autorizațiile…</div>}
        {stareInc === 'fara_drept' && <div role="alert" style={{ color: G.red }}>{mesaj}</div>}
        {stareInc === 'neactivat' && <div style={{ color: G.yellow }}>{mesaj}</div>}
        {stareInc === 'eroare' && (
          <div role="alert" style={{ color: G.red }}>{mesaj} <button onClick={() => setReload(x => x + 1)} style={btnMic(G.red)}>Reîncearcă</button></div>
        )}
        {eroareScan && <div role="alert" style={{ color: G.red, marginBottom: 8 }}>{eroareScan}</div>}
        {stareInc === 'gata' && !rows.length && <div style={{ color: G.muted }}>Nicio autorizație de sudor în evidență.</div>}
        {stareInc === 'gata' && rows.length > 0 && !vizibile.length && <div style={{ color: G.muted }}>Nicio autorizație nu corespunde filtrelor.</div>}

        {stareInc === 'gata' && vizibile.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                {['Titular', 'Tip', 'Nr. autorizație', 'Emitent', 'Emisă', 'Expiră', 'Procedeu', 'Ø țeavă (mm)', 'Material', 'Stare', 'Scan'].map(h => <th key={h} style={th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {vizibile.map(r => {
                  const st = STARI[r.stare] || { label: r.stare || '—', culoare: 'muted' }
                  return (
                    <tr key={r.id} style={{ opacity: r.inlocuita ? 0.6 : 1 }}>
                      <td style={td}>
                        <b>{r.titular || '—'}</b>
                        {r.extern && <div style={{ fontSize: 11, color: G.muted }}>extern{r.firma ? ' · ' + r.firma : ''}</div>}
                      </td>
                      <td style={td}>{r.tip || '—'}{r.subcategorie ? <div style={{ fontSize: 11, color: G.muted }}>{r.subcategorie}</div> : null}</td>
                      <td style={td}>{r.numar_autorizatie || '—'}</td>
                      <td style={td}>{r.emitent || '—'}</td>
                      <td style={td}>{fmtZi(r.data_emitere)}</td>
                      <td style={td}>{r.fara_expirare ? 'fără expirare' : fmtZi(r.data_expirare)}</td>
                      <td style={td}>{r.procedeu_sudura || '—'}</td>
                      <td style={td}>{r.diametru_teava_mm ?? '—'}</td>
                      <td style={td}>{r.calitate_material || '—'}</td>
                      <td style={td}>
                        <span style={{ color: G[st.culoare] || G.muted, fontWeight: 700 }}>{st.label}</span>
                        {r.inlocuita && <div style={{ fontSize: 11, color: G.muted }}>înlocuită de o reînnoire</div>}
                      </td>
                      <td style={td}>
                        <button disabled={!r.are_scan || busy !== null} onClick={() => deschide(r)} style={btnMic(G.blue)}>
                          {busy === r.id ? 'Se deschide…' : r.are_scan ? 'Deschide' : 'fără scan'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section style={{ background: G.surface, border: `1px solid ${G.border}`, borderRadius: 12, padding: 16 }}>
        <h3 style={{ margin: '0 0 8px', color: G.ctc }}>🔬 Firmele de control nedistructiv (NDT)</h3>
        <div style={{ fontSize: 12, color: G.muted, lineHeight: 1.5 }}>
          Autorizațiile laboratoarelor NDT nu sunt încă ținute ca date în platformă. Până atunci, documentul primit de la laborator se încarcă
          direct în cartea tehnică a lucrării, la poziția „Autorizație laborator NDT”.
        </div>
      </section>
    </div>
  )
}
