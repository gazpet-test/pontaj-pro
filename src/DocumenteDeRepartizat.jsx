// ═══════════════════════════════════════════════════════════════════════════
// DocumenteDeRepartizat.jsx — coada corespondenței Gmail cu proiect neclar (13.10.2026)
// Scriptul „Ingestie Corespondența” v2 pune mesajele cu 2+ proiecte candidate în
// documente_de_repartizat. Aici un om alege proiectul: „Repartizează în X” (RPC
// fn_doc_repartizeaza — atomic, fără dublură) sau „Ignoră” (fn_doc_ignora).
// Apare pe dashboard-ul Execuție doar când există ceva în coadă (sau owner).
// ═══════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from './lib/supabase.js'
import { potrivesteCandidati, candidatiFaraProiect } from './documenteDeRepartizatLogic.js'

const G = {
  bg: '#0D1117', surface: '#161B22', surface2: '#1C2230', border: '#21262D', border2: '#30363D',
  text: '#E6EDF3', muted: '#8B949E', dim: '#6E7681', blue: '#58A6FF', green: '#3FB950', red: '#F85149', yellow: '#D29922', orange: '#F0883E',
}
const fmt = (d) => d ? new Date(d).toLocaleString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
const btn = (c) => ({ background: c + '1E', border: `1px solid ${c}55`, color: c, borderRadius: 7, padding: '5px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' })

export default function DocumenteDeRepartizat({ profile, onRepartizat }) {
  const [rows, setRows] = useState(null)        // null = încă se încarcă sau tabel indisponibil
  const [proiecte, setProiecte] = useState([])
  const [busy, setBusy] = useState(null)
  const [alt, setAlt] = useState({})            // {rand_id: proiect_id ales manual (owner)}
  const [eroare, setEroare] = useState('')
  const [deschis, setDeschis] = useState(true)
  const owner = profile?.is_owner === true

  const load = useCallback(async () => {
    const [{ data, error }, { data: pr }] = await Promise.all([
      supabase.from('documente_de_repartizat').select('id, nume_fisier, mime_type, expeditor, subiect, data_mail, candidati, storage_path')
        .eq('stare', 'de_repartizat').order('data_mail', { ascending: false }).limit(300),
      supabase.from('executie_proiecte').select('id, nume, cod_intern, eticheta_gmail').eq('activ', true).order('nume'),
    ])
    if (error) { setRows(null); return }   // migrarea neaplicată sau fără drept → cardul nu apare
    setRows(data || [])
    setProiecte(pr || [])
  }, [])
  useEffect(() => { load() }, [load])

  const grupe = useMemo(() => (rows || []).map(r => ({
    ...r, proiecteCandidate: potrivesteCandidati(r.candidati, proiecte), candidatiNegasiti: candidatiFaraProiect(r.candidati, proiecte),
  })), [rows, proiecte])

  const deschide = async (r) => {
    const { data } = await supabase.storage.from('documente-proiect').createSignedUrl(r.storage_path, 300)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
    else setEroare('Nu pot deschide fișierul.')
  }
  const repartizeaza = async (r, proiectId) => {
    if (!proiectId) return
    setBusy(r.id); setEroare('')
    const { data, error } = await supabase.rpc('fn_doc_repartizeaza', { p_id: r.id, p_proiect_id: Number(proiectId) })
    setBusy(null)
    if (error) { setEroare(`${r.nume_fisier}: ${error.message}`); return }
    if (data && data.ok === false) setEroare(`${r.nume_fisier}: deja rezolvat (${data.motiv})`)
    setRows(list => (list || []).filter(x => x.id !== r.id))
    onRepartizat?.()
  }
  const ignora = async (r) => {
    if (!window.confirm(`Ignori „${r.nume_fisier}”? Nu intră în niciun proiect (fișierul rămâne în arhivă).`)) return
    setBusy(r.id); setEroare('')
    const { error } = await supabase.rpc('fn_doc_ignora', { p_id: r.id })
    setBusy(null)
    if (error) { setEroare(`${r.nume_fisier}: ${error.message}`); return }
    setRows(list => (list || []).filter(x => x.id !== r.id))
  }

  if (rows === null || (!rows.length && !owner)) return null
  return (
    <div style={{ margin: '18px 28px 0', background: G.surface, border: `1px solid ${rows.length ? G.orange + '66' : G.border}`, borderRadius: 12, padding: '14px 16px' }}>
      <div onClick={() => setDeschis(v => !v)} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
        <span style={{ fontSize: 15, fontWeight: 800, color: rows.length ? G.orange : G.muted }}>📥 Corespondență de repartizat ({rows.length})</span>
        <span style={{ fontSize: 12, color: G.dim }}>mailuri cu 2+ proiecte posibile — alege proiectul corect</span>
        <span style={{ marginLeft: 'auto', color: G.dim }}>{deschis ? '▾' : '▸'}</span>
      </div>
      {deschis && <>
        {eroare && <div style={{ marginTop: 10, padding: '7px 10px', borderRadius: 8, background: G.red + '22', color: G.red, fontSize: 12.5 }}>{eroare}</div>}
        {!rows.length && <div style={{ marginTop: 10, fontSize: 13, color: G.dim }}>Nimic de repartizat.</div>}
        {grupe.map(r => (
          <div key={r.id} style={{ marginTop: 10, padding: '10px 12px', background: G.bg, border: `1px solid ${G.border2}`, borderRadius: 9, opacity: busy === r.id ? .5 : 1 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <button onClick={() => deschide(r)} style={{ background: 'none', border: 'none', color: G.blue, fontWeight: 700, fontSize: 13, cursor: 'pointer', padding: 0, textAlign: 'left' }}>📄 {r.nume_fisier}</button>
              <span style={{ fontSize: 11.5, color: G.dim }}>{fmt(r.data_mail)}</span>
            </div>
            <div style={{ fontSize: 12, color: G.muted, marginTop: 3 }}>{[r.expeditor, r.subiect].filter(Boolean).join(' · ')}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
              {r.proiecteCandidate.map(p => (
                <button key={p.id} disabled={busy === r.id} onClick={() => repartizeaza(r, p.id)} style={btn(G.green)}>Repartizează în {p.nume}</button>
              ))}
              {r.candidatiNegasiti?.length > 0 && <span style={{ fontSize: 11, color: G.yellow }}>fără proiect activ: {r.candidatiNegasiti.join(', ')}</span>}
              {owner && (
                <span style={{ display: 'flex', gap: 4 }}>
                  <select value={alt[r.id] || ''} onChange={e => setAlt(m => ({ ...m, [r.id]: e.target.value }))} style={{ background: G.surface2, border: `1px solid ${G.border2}`, color: G.text, borderRadius: 7, padding: '4px 6px', fontSize: 12, maxWidth: 220 }}>
                    <option value="">alt proiect…</option>
                    {proiecte.map(p => <option key={p.id} value={p.id}>{p.nume}</option>)}
                  </select>
                  <button disabled={!alt[r.id] || busy === r.id} onClick={() => repartizeaza(r, alt[r.id])} style={btn(G.blue)}>OK</button>
                </span>
              )}
              <button disabled={busy === r.id} onClick={() => ignora(r)} style={{ ...btn(G.dim), marginLeft: 'auto' }}>Ignoră</button>
            </div>
          </div>
        ))}
      </>}
    </div>
  )
}
