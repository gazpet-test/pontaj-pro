import { useRef, useState } from 'react'
import { supabase } from './lib/supabase.js'
import { DIRECT, TIPURI_CORECTII, campuri, valori, delta, argumenteVerifica, mesajCorectie, cereStareIesire } from './izoCorectiiLogica.js'
import { Camp, Modal, Verificare, S, G } from './izoCorectiiUI.jsx'

export default function IzoCorectieModal({ tip, bucata:b, proiectId, depozite, inchide, reincarca, flash }) {
  const direct = tip === 'direct', nou = tip === 'gasit_nou'
  const [form, setForm] = useState(() => direct || tip === 'camp' ? Object.fromEntries(campuri(b.tip_cod, direct).map(k => [k, b[k] ?? ''])) : { tip_cod:'teava', cauza:'disparuta' })
  const [motiv, setMotiv] = useState(''), [v, setV] = useState(null), [busy, setBusy] = useState(false), [err, setErr] = useState('')
  const lock = useRef(false)
  const set = (k, x) => { setForm(f => ({ ...f, [k]:x })); setV(null); setErr('') }
  const stareExplicita = tip === 'carantina_iesire' && cereStareIesire(b)
  const chei = nou ? ['tip_cod', 'depozit_id', ...campuri(form.tip_cod), ...DIRECT, 'document_intrare_id'] : direct || tip === 'camp' ? campuri(b.tip_cod, direct) : tip.startsWith('carantina') ? ['ncr_ref', ...(stareExplicita ? ['stare'] : [])] : tip === 'pierdut' ? ['cauza'] : form.depozit_id ? ['depozit_id'] : []
  function detalii() {
    if (direct || tip === 'camp') {
      const d = delta(form, b, chei)
      if (!Object.keys(d).length) throw new Error('Nimic de corectat.')
      return d
    }
    const d = valori(form, chei)
    if (tip.startsWith('carantina') && (!d.ncr_ref || d.ncr_ref.length > 80)) throw new Error('Referință NCR obligatorie (1–80 caractere).')
    if (stareExplicita && !['sosit', 'receptionat'].includes(d.stare)) throw new Error('Alege starea țintă pentru bucata născută în carantină.')
    if (nou) {
      for (const k of ['tip_cod', 'depozit_id', 'serie', 'sarja', 'perete_mm']) if (d[k] == null || d[k] === '') throw new Error(`Completează ${k}.`)
      if (d.tip_cod === 'teava' && !d.lungime_aviz_mm && !d.lungime_masurata_mm) throw new Error('Completează cel puțin o lungime în mm.')
      if (d.tip_cod === 'curba' && !d.unghi_curba) throw new Error('Completează unghiul curbei.')
      for (const k of Object.keys(d)) if (d[k] == null) delete d[k]
    }
    return d
  }
  async function executa(trimite) {
    if (lock.current) return
    lock.current = true; setBusy(true); setErr('')
    try {
      const d = detalii()
      if (trimite && (motiv.trim().length < 3 || motiv.trim().length > 1000)) throw new Error('Motivul trebuie să aibă 3–1000 de caractere.')
      if (trimite && (!v?.ok || v.blocante?.length)) throw new Error('Verifică înainte de trimitere.')
      const rpc = !trimite ? 'fn_izo_cor_verifica' : direct ? 'fn_izo_cor_camp' : 'fn_izo_cor_propune'
      const args = !trimite ? argumenteVerifica(direct ? 'camp' : tip, proiectId, b?.id ?? null, d) : direct
        ? { p_bucata_id:b.id, p_server_ver:b.server_ver, p_dupa:d, p_motiv:motiv.trim() }
        : { p_tip:tip, p_proiect:proiectId, p_bucata_id:b?.id ?? null, p_detalii:d, p_motiv:motiv.trim() }
      const { data, error } = await supabase.rpc(rpc, args)
      if (error) throw error
      if (!trimite) setV(data)
      else { flash('Corecția a fost ' + (direct ? 'aplicată.' : 'propusă.')); inchide(); await reincarca() }
    } catch (e) {
      setErr(mesajCorectie(e))
      if (e.code === '40001') { flash(mesajCorectie(e)); inchide(); await reincarca() }
    } finally { lock.current = false; setBusy(false) }
  }
  const input = k => <Camp key={k} nume={k.replaceAll('_', ' ') + (b ? ` (curent: ${b[k] ?? '—'})` : '')} value={form[k]} onChange={x => set(k, x)} />
  const depozit = <Camp nume="Depozit"><select style={S.input} value={form.depozit_id || ''} onChange={e => set('depozit_id', e.target.value)}><option value="">{nou ? 'Alege depozitul' : 'Păstrează depozitul anterior'}</option>{depozite.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Camp>
  return <Modal titlu={direct ? 'Corectează câmpuri' : TIPURI_CORECTII[tip]} busy={busy} inchide={inchide}>
    <fieldset disabled={busy} style={{ border:0, padding:0 }}>
      {b && <p>{b.serie} / {b.sarja} · {b.stare}</p>}
      {nou && <><p>Bucata va intra în carantină după aprobare.</p><Camp nume="Tip"><select style={S.input} value={form.tip_cod} onChange={e => set('tip_cod', e.target.value)}><option value="teava">Țeavă</option><option value="curba">Curbă</option></select></Camp>{depozit}</>}
      {(nou || direct || tip === 'camp') && chei.filter(k => !['tip_cod', 'depozit_id'].includes(k)).map(input)}
      {tip.startsWith('carantina') && input('ncr_ref')}
      {stareExplicita && <Camp nume="Starea țintă pentru bucata născută în carantină"><select style={S.input} value={form.stare || ''} onChange={e => set('stare', e.target.value)}><option value="">Alege starea</option><option value="sosit">Sosit</option><option value="receptionat">Recepționat</option></select></Camp>}
      {tip === 'carantina_iesire' && !stareExplicita && <p>Starea țintă este calculată de server la verificare.</p>}
      {tip === 'pierdut' && <Camp nume="Cauza"><select style={S.input} value={form.cauza} onChange={e => set('cauza', e.target.value)}><option value="disparuta">Dispărută</option><option value="lipsa_la_receptie">Lipsă la recepție</option></select></Camp>}
      {tip === 'gasit_recuperare' && !b.tronson_id && depozit}
      <Camp nume="Motiv obligatoriu" value={motiv} onChange={setMotiv} />
      <Verificare v={v} />
      {err && <p role="alert" style={{ color:G.red }}>{err}</p>}
      <button style={S.btn} onClick={() => executa(false)}>Verifică</button>
      <button style={S.btn} disabled={!v?.ok || !!v.blocante?.length || motiv.trim().length < 3} onClick={() => executa(true)}>{direct ? 'Aplică corecția' : 'Propune'}</button>
    </fieldset>
  </Modal>
}
