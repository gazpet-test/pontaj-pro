import { useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase.js'
import { responsabil, pagini, mesajCorectie, lipsaCorectii, rezumatDiff } from './izoCorectiiLogica.js'
import { Camp, Modal, Comparatie, S, G } from './izoCorectiiUI.jsx'

// Componenta are propria citire și propriile mesaje; editorul E9 rămâne independent.
export default function IzoDocumentIstoric({ document:d, eu, blocat, reincarca }) {
  const [rows, setRows] = useState([]), [pvRows, setPvRows] = useState([]), [err, setErr] = useState(''), [msg, setMsg] = useState('')
  const [form, setForm] = useState(null), [busy, setBusy] = useState(false), [rev, setRev] = useState(0)
  const [incarc, setIncarc] = useState(true)
  const lock = useRef(false)
  useEffect(() => {
    let activ = true; setRows([]); setPvRows([]); setErr(''); setIncarc(true)
    if (!d?.id) return
    Promise.all([
      pagini(() => supabase.from('izo_documente_istoric').select('id, versiune, salvat_de, salvat_la, diff, baza, hash').eq('document_id', d.id)),
      pagini(() => supabase.from('izo_corectii').select('id, propus_de, propus_la, motiv, inainte, dupa').eq('document_intrare_id', d.id).eq('tip', 'pv')),
    ]).then(([h, p]) => { if (activ) { setRows(h.reverse()); setPvRows(p.reverse()) } }).catch(e => { if (activ) setErr(lipsaCorectii(e) ? 'Istoricul E3b este în pregătire.' : mesajCorectie(e)) }).finally(() => { if (activ) setIncarc(false) })
    return () => { activ = false }
  }, [d?.id, d?.versiune, rev])
  if (!d?.id) return null
  async function aplica() {
    if (lock.current || blocat) return
    lock.current = true; setBusy(true); setErr('')
    try {
      if (!form.nr.trim() || form.nr.trim().length > 80 || form.nr.includes('|') || !/^\d{4}-\d{2}-\d{2}$/.test(form.data) || form.motiv.trim().length < 3 || form.motiv.trim().length > 1000) throw new Error('Completează numărul PV (1–80 caractere, fără |), data și motivul (3–1000 caractere).')
      const { error } = await supabase.rpc('fn_izo_cor_pv', { p_doc_id:d.id, p_versiune:d.versiune, p_pv_nr:form.nr.trim(), p_pv_data:form.data, p_motiv:form.motiv.trim() })
      if (error) throw error
      setForm(null); setMsg('PV corectat.'); setRev(x => x + 1); await reincarca(d.id)
    } catch (e) { setErr(mesajCorectie(e)); if (e.code === '40001') { setForm(null); await reincarca(d.id) } }
    finally { lock.current = false; setBusy(false) }
  }
  const confirmat = rows.find(r => r.hash === d.hash_confirmat)
  return <section style={S.card}>
    {msg && <p role="status">{msg}</p>}{err && <p role="alert" style={{ color:G.yellow }}>{err}</p>}
    <details><summary>🕘 Istoric ({rows.length})</summary>
      {incarc && <p>Se încarcă istoricul…</p>}
      {!incarc && !rows.length && !err && <p>Fără istoric (anterior E3b).</p>}
      {confirmat && <p>Hash-ul confirmat = versiunea {confirmat.versiune}.</p>}
      {rows.map(r => <details key={r.id} style={{ marginTop:10 }}><summary>v{r.versiune} · {r.salvat_de} · {new Date(r.salvat_la).toLocaleString('ro-RO')} · {rezumatDiff(r.diff, r.baza)}</summary><pre style={{ whiteSpace:'pre-wrap', overflowWrap:'anywhere', fontSize:12 }}>{JSON.stringify(r.diff, null, 2)}</pre></details>)}
    </details>
    {d.stare === 'confirmat' && d.eveniment_pv_id && responsabil(eu, d.proiect_id) && <button style={S.btn} disabled={busy || blocat} onClick={() => setForm({ nr:d.pv_nr || d.pv_nr_canon || '', data:d.pv_data || '', motiv:'' })}>Corectează PV</button>}
    {!!pvRows.length && <details><summary>Corecții PV ({pvRows.length})</summary>{pvRows.map(c => <article key={c.id}><p>{c.propus_de} · {new Date(c.propus_la).toLocaleString('ro-RO')} · {c.motiv}</p><Comparatie inainte={c.inainte} dupa={c.dupa} /></article>)}</details>}
    {form && <Modal titlu="Corectează PV" busy={busy} inchide={() => setForm(null)}>{err && <p role="alert" style={{ color:G.red }}>{err}</p>}<fieldset disabled={busy || blocat} style={{ border:0, padding:0 }}>{[['nr', 'Număr PV'], ['data', 'Data PV (AAAA-LL-ZZ)'], ['motiv', 'Motiv obligatoriu']].map(([k, label]) => <Camp key={k} nume={label} value={form[k]} onChange={x => setForm(f => ({ ...f, [k]:x }))} />)}<button style={S.btn} onClick={aplica}>Aplică corecția PV</button></fieldset></Modal>}
  </section>
}
