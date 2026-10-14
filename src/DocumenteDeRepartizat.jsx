// ═══════════════════════════════════════════════════════════════════════════
// DocumenteDeRepartizat.jsx — coada corespondenței Gmail cu proiect neclar (13.10.2026)
// Scriptul „Ingestie Corespondența” v2 pune mesajele cu 2+ proiecte candidate în
// documente_de_repartizat. Aici un om alege proiectul: „Repartizează în X” (RPC
// fn_doc_repartizeaza — atomic, fără dublură) sau „Ignoră” (fn_doc_ignora).
// Apare pe dashboard-ul Execuție doar când există ceva în coadă (sau owner).
// 14.10.2026: implicit ÎNCHIS (o linie), lista cu scroll intern; ce nu ține de execuție
// (HR/CV, financiar, logistică, ofertare, mailuri pe 4+ proiecte) e ascuns — doar afișare,
// rândurile din BD rămân neatinse; „arată tot” le aduce înapoi.
// ═══════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from './lib/supabase.js'
import { potrivesteCandidati, candidatiFaraProiect, clasificaNonExecutie } from './documenteDeRepartizatLogic.js'

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
  const [deschis, setDeschis] = useState(false)
  const [tot, setTot] = useState(false)          // true = arată și ce nu ține de execuție
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

  const toate = useMemo(() => (rows || []).map(r => ({
    ...r, proiecteCandidate: potrivesteCandidati(r.candidati, proiecte), candidatiNegasiti: candidatiFaraProiect(r.candidati, proiecte),
    nonExec: clasificaNonExecutie(r),
  })), [rows, proiecte])
  const relevante = toate.filter(r => !r.nonExec)
  const ascunse = toate.length - relevante.length
  const grupe = tot ? toate : relevante

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

  if (rows === null || (!relevante.length && !owner)) return null   // non-owner: fără nimic de execuție, fără card
  return (
    <div style={{ margin: '14px 28px 0', background: G.surface, border: `1px solid ${relevante.length ? G.orange + '66' : G.border}`, borderRadius: 10, padding: deschis ? '12px 14px' : '8px 14px' }}>
      <div onClick={() => setDeschis(v => !v)} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13.5, fontWeight: 800, color: relevante.length ? G.orange : G.muted }}>📥 {relevante.length} de repartizat</span>
        {ascunse > 0 && <span style={{ fontSize: 12, color: G.dim }}>+ {ascunse} care nu țin de execuție (ascunse)</span>}
        <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: G.blue }}>{deschis ? 'Închide ▾' : 'Deschide ▸'}</span>
      </div>
      {deschis && <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: G.dim }}>mailuri cu 2+ proiecte posibile — alege proiectul corect</span>
          {ascunse > 0 && (
            <button onClick={() => setTot(v => !v)} style={{ ...btn(G.muted), marginLeft: 'auto' }}>
              {tot ? 'Doar execuție' : `Arată tot (${toate.length})`}
            </button>
          )}
        </div>
        {eroare && <div style={{ marginTop: 10, padding: '7px 10px', borderRadius: 8, background: G.red + '22', color: G.red, fontSize: 12.5 }}>{eroare}</div>}
        {!grupe.length && <div style={{ marginTop: 10, fontSize: 13, color: G.dim }}>Nimic de repartizat{ascunse ? ' pentru execuție.' : '.'}</div>}
        <div style={{ maxHeight: 420, overflowY: 'auto', marginTop: 4, paddingRight: 4 }}>
        {grupe.map(r => (
          <div key={r.id} style={{ marginTop: 10, padding: '10px 12px', background: G.bg, border: `1px solid ${G.border2}`, borderRadius: 9, opacity: busy === r.id ? .5 : 1 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <button onClick={() => deschide(r)} style={{ background: 'none', border: 'none', color: G.blue, fontWeight: 700, fontSize: 13, cursor: 'pointer', padding: 0, textAlign: 'left' }}>📄 {r.nume_fisier}</button>
              <span style={{ fontSize: 11.5, color: G.dim }}>{fmt(r.data_mail)}</span>
              {r.nonExec && <span title={`ascuns implicit: ${r.nonExec.motiv}`} style={{ fontSize: 10.5, fontWeight: 700, color: G.yellow, border: `1px solid ${G.yellow}55`, borderRadius: 5, padding: '1px 6px' }}>{r.nonExec.cat}</span>}
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
        </div>
      </>}
    </div>
  )
}
