import { useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase.js'
import { FAZE, cereManometru, ceLipseste, codEroare, confirmaSalt, fazaUrmatoare, formularActiune, mesajEroare, operatieValida, pregatesteCreare, pregatestePayload, programCitire } from './probeTerenLogica.js'

const G = { bg: '#0D1117', surface: '#1C2128', border: '#30363D', text: '#E6EDF3', muted: '#8B949E', blue: '#58A6FF', green: '#3FB950', red: '#F85149' }
const S = {
  input: { width: '100%', boxSizing: 'border-box', background: G.bg, color: G.text, border: `1px solid ${G.border}`, borderRadius: 10, padding: 16, fontSize: 18, margin: '8px 0' },
  card: { background: G.surface, border: `1px solid ${G.border}`, borderRadius: 14, padding: 16, margin: '12px 0' },
  button: { width: '100%', minHeight: 60, background: '#238636', border: `1px solid ${G.border}`, borderRadius: 12, padding: 16, fontSize: 18, fontWeight: 750, color: '#fff', margin: '6px 0', cursor: 'pointer' },
}
const uuid = () => crypto.randomUUID()
const check = r => { if (r.error) throw r.error; return r.data }
const num = n => n == null ? 'nedovedit' : Number(n).toLocaleString('ro-RO', { maximumFractionDigits: 1 })
const durata = ms => `${Math.floor(Math.max(0, ms) / 3600000)}h ${Math.floor(Math.max(0, ms) / 60000) % 60}m`
function Button({ children, onClick, disabled, secondary, danger }) {
  return <button disabled={disabled} onClick={onClick} style={{ ...S.button, background: danger ? '#59252a' : secondary ? '#21262D' : '#238636', opacity: disabled ? .5 : 1 }}>{children}</button>
}
function Select({ label, value, onChange, rows, disabled }) {
  return <label>{label}<select disabled={disabled} style={S.input} value={value || ''} onChange={e => onChange(e.target.value)}><option value="">Alege...</option>{rows.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
}

// Comprimare inainte de upload. File-ul si calea se pastreaza la retry.
async function comprima(file) {
  if (!file.type.startsWith('image/')) throw new Error('Alege o imagine.')
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('Imaginea nu poate fi citita. Alege JPEG.')); i.src = url })
    const scala = Math.min(1, 1600 / Math.max(img.width, img.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.width * scala)); canvas.height = Math.max(1, Math.round(img.height * scala))
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
    return await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Comprimarea a esuat.')), 'image/jpeg', .8))
  } finally { URL.revokeObjectURL(url) }
}
function Photo({ calcId, value, onChange, onBusy, disabled }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const retained = useRef(null)
  const lock = useRef(false)
  const latest = useRef({ onChange, onBusy })
  latest.current = { onChange, onBusy }
  async function upload(file) {
    if (lock.current) return
    lock.current = true; setBusy(true); latest.current.onBusy?.(1); setErr('')
    try {
      if (file) retained.current = { file, path: `teren/${calcId}/${uuid()}.jpg` }
      const item = retained.current
      if (!item.blob) item.blob = await comprima(item.file)
      const r = await supabase.storage.from('probe-citiri').upload(item.path, item.blob, { contentType: 'image/jpeg', upsert: false })
      // Un raspuns pierdut poate lasa obiectul deja incarcat. Verificam prin download autentificat.
      if (r.error) {
        const existing = await supabase.storage.from('probe-citiri').download(item.path)
        if (existing.error) throw r.error
      }
      latest.current.onChange(item.path)
    } catch (e) { setErr(e.message || 'Upload esuat. Reincearca.') }
    finally { lock.current = false; setBusy(false); latest.current.onBusy?.(-1) }
  }
  return <div style={S.card}>
    <label style={{ display: 'block', color: value ? G.green : G.blue, fontWeight: 700 }}>
      {busy ? 'Se incarca poza...' : value ? 'Poza incarcata. Schimba poza' : 'Fotografiaza / alege poza'}
      <input aria-label="Poza dovada" style={{ display: 'block', marginTop: 12, maxWidth: '100%' }} disabled={busy || disabled} type="file" accept="image/*" capture="environment" onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }} />
    </label>
    {err && <><p role="alert" style={{ color: G.red }}>{err}</p><Button disabled={busy || disabled} onClick={() => upload()}>Reincearca upload</Button></>}
  </div>
}

export default function ProbeTerenMobil({ profile, onBack }) {
  const [projects, setProjects] = useState([])
  const [project, setProject] = useState('')
  const [sections, setSections] = useState([])
  const [section, setSection] = useState('')
  const [fluid, setFluid] = useState('')
  const [benef, setBenef] = useState('')
  const [refType, setRefType] = useState('comanda')
  const [refId, setRefId] = useState('')
  const [refText, setRefText] = useState('')
  const [client, setClient] = useState('')
  const [refs, setRefs] = useState([])
  const [list, setList] = useState([])
  const [step, setStep] = useState(0)
  const [proba, setProba] = useState(null)
  const [active, setActive] = useState([])
  const [assets, setAssets] = useState([])
  const [logs, setLogs] = useState([])
  const [report, setReport] = useState(null)
  const [form, setForm] = useState(null)
  const [page, setPage] = useState(0)
  const [busy, setBusy] = useState(false)
  const [uploads, setUploads] = useState(0)
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState('')
  const [allowed, setAllowed] = useState(false)
  const [now, setNow] = useState(Date.now())
  const offset = useRef(0)
  const mutationLock = useRef(false)
  const operation = useRef(null)
  const createKey = useRef(null)
  const [pending, setPending] = useState(false)
  const [salt, setSalt] = useState(false)
  const [saltReason, setSaltReason] = useState('')
  const storageKey = `probe-teren-operatie:${profile?.id}`
  function storeOperation(op) {
    // Daca persistenta nu functioneaza, nu trimitem o operatie imposibil de recuperat.
    if (op) sessionStorage.setItem(storageKey, JSON.stringify(op))
    else sessionStorage.removeItem(storageKey)
    operation.current = op; setPending(!!op)
  }
  async function load() {
    setLoading(true); setError('')
    try {
      const drept = check(await supabase.rpc('probe_teren_drept', { p_scriere: true })) === true
      setAllowed(drept)
      if (!drept) return
      const rows = check(await supabase.from('executie_proiecte').select('id,nume,cod_intern').eq('activ', true).order('nume'))
      setProjects(rows || [])
      setAssets(check(await supabase.from('logistica_active').select('id,nume,cod').order('nume')) || [])
      const saved = sessionStorage.getItem(storageKey)
      if (saved) {
        const op = JSON.parse(saved)
        if (!operatieValida(op)) throw new Error('Operatie locala invalida. Cere verificare.')
        operation.current = op; setPending(true)
      }
    } catch (e) { setError(mesajEroare(e)) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, []) // Identitatea este cea a sesiunii /m.
  useEffect(() => { const t = setInterval(() => setNow(Date.now() + offset.current), 1000); return () => clearInterval(t) }, [])
  useEffect(() => {
    if (!project) return
    let live = true
    setSections([]); setSection(''); setList([]); setLoading(true)
    Promise.all([
      supabase.from('executie_tronsoane').select('id,cod,denumire').eq('proiect_id', project).order('ordine'),
      supabase.from('probe_calcule').select('id,proiect_id,tronson_id,tip_fluid,status,beneficiar_tip,tert_client,tert_ref_tip,tert_ref_id,tert_ref_text,faza_curenta,ora_start').eq('proiect_id', project).in('status', ['planificata', 'in_executie']).order('id', { ascending: false }),
    ]).then(results => {
      const [s, l] = results.map(check)
      if (live) { setSections(s || []); setSection(s?.length === 1 ? String(s[0].id) : ''); setList(l || []) }
    }).catch(e => { if (live) setError(mesajEroare(e)) }).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [project, revision])
  useEffect(() => {
    setRefs([]); setRefId('')
    if (benef !== 'tert' || refType === 'comanda') return
    let live = true
    const q = refType === 'oferta' ? supabase.from('probe_oferte').select('id,nr_oferta,client') : supabase.from('contracte_terti').select('id,numar_contract,denumire,partener_text')
    q.order('id', { ascending: false }).then(r => { const d = check(r); if (live) setRefs(d || []) }).catch(e => { if (live) setError(mesajEroare(e)) })
    return () => { live = false }
  }, [benef, refType])
  async function open(id) {
    setLoading(true)
    try {
      const results = await Promise.all([
        supabase.from('probe_calcule').select('id,tip_fluid,status,faza_curenta,ora_start,beneficiar_tip,tert_client').eq('id', id).single(),
        supabase.from('probe_exec_utilaje').select('active_id,rol').eq('calc_id', id).is('ora_stop', null),
        supabase.from('probe_log_executie').select('id,faza,limita_faza,ora_citire,presiune_citita_bar').eq('calc_id', id).order('ora_citire'),
        supabase.from('v_probe_raport').select('calc_id,status,durata_reala_h,faze,citiri_hidraulice').eq('calc_id', id).single(),
      ])
      const [p, a, l, r] = results.map(check)
      setProba(p); setActive(a || []); setLogs(l || []); setReport(r); setError('')
    } catch (e) { setError(mesajEroare(e)) }
    finally { setLoading(false) }
  }
  async function send(op = operation.current) {
    if (mutationLock.current || !operatieValida(op)) return
    mutationLock.current = true; setBusy(true); setError('')
    let successId = null
    try {
      storeOperation(op)
      const data = check(await supabase.rpc(op.nom, op.args))
      if (data?.ora_server) { offset.current = Date.parse(data.ora_server) - Date.now(); setNow(Date.now() + offset.current) }
      successId = op.nom === 'fn_probe_creeaza_teren' ? data : op.args.p_calc_id
      if (op.nom === 'fn_probe_creeaza_teren') createKey.current = null
      storeOperation(null); setSalt(false); setForm(null); setPage(0)
    } catch (e) {
      setError(mesajEroare(e))
      if (codEroare(e) === 'pt_bord_salt') setSalt(true)
      else if (e.code && !['', 'PGRST000'].includes(e.code)) {
        // Eroare SQL explicita = tranzactie refuzata. Retea incerta = payload inghetat.
        storeOperation(null)
      }
    } finally { mutationLock.current = false; setBusy(false) }
    // Un echec de relecture ne transforme jamais un succes en nouvelle ecriture.
    if (successId != null) await open(successId)
  }
  function startAction(action, result, asset) {
    setError(''); setPage(0)
    setForm(formularActiune(proba, action, result, asset ? [asset] : active))
  }
  async function create() {
    if (mutationLock.current || operation.current) return
    if (!createKey.current) createKey.current = uuid()
    try {
      await send(pregatesteCreare({ proiect: project, tronson: section, nrTronsoane: sections.length, fluid,
        beneficiar: benef, referintaTip: refType, referintaId: refId, comanda: refText, client }, createKey.current))
    } catch (e) { setError(e.message) }
  }
  function submit() {
    if (operation.current || mutationLock.current || uploads) return
    try { send(pregatestePayload(form, uuid())) } catch (e) { setError(e.message) }
  }
  const patch = p => setForm(f => ({ ...f, ...p }))
  const uploadBusy = delta => setUploads(n => Math.max(0, n + delta))
  const assetLabel = id => { const a = assets.find(x => String(x.id) === String(id)); return a ? `${a.cod || ''} ${a.nume}` : `Utilaj #${id}` }
  const assetRows = assets.map(a => ({ id: a.id, label: assetLabel(a.id) }))
  const listRows = list.filter(p => String(p.tronson_id || '') === String(section || ''))
  const planned = listRows.filter(p => p.status === 'planificata' && p.tip_fluid === fluid && p.beneficiar_tip === benef &&
    (benef !== 'tert' || (p.tert_ref_tip === refType && (refType === 'comanda' ? p.tert_ref_text === refText.trim() : String(p.tert_ref_id) === String(refId)) && p.tert_client === client.trim())))
  const benefOk = benef === 'gazpet' || (benef === 'tert' && client.trim() && (refType === 'comanda' ? refText.trim().length >= 3 : !!refId))
  const closed = proba && ['finalizata', 'respinsa'].includes(proba.status)
  const schedule = proba ? programCitire(proba, logs, now) : null
  const next = proba && fazaUrmatoare(proba)
  const canRead = proba && (proba.tip_fluid === 'apa' ? proba.faza_curenta === 'presurizare' && !logs.some(l => l.faza === 'presurizare' && !l.limita_faza) : proba.faza_curenta === 'proba')

  function utilajEditor(u, update, choose) {
    return <div>
      {choose ? <Select disabled={uploads > 0} label="Utilaj" value={u.active_id} rows={assetRows} onChange={v => update({ ...u, active_id: v, ore_bord: '', poza_path: '' })} /> : <h3>{assetLabel(u.active_id)}</h3>}
      {(choose || form.actiune === 'porneste') && proba.tip_fluid === 'aer' && <Select label="Rol" value={u.rol} rows={['compresor', 'booster', 'pompa'].map(id => ({ id, label: id }))} onChange={v => update({ ...u, rol: v })} />}
      {proba.tip_fluid === 'aer' && <><label>Ore de bord<input style={S.input} type="number" min="0" step="any" inputMode="decimal" value={u.ore_bord} onChange={e => update({ ...u, ore_bord: e.target.value })} /></label>
        <Photo calcId={proba.id} value={u.poza_path} onBusy={uploadBusy} onChange={v => update({ ...u, poza_path: v })} /></>}
    </div>
  }
  function renderForm() {
    const gauge = cereManometru(proba, form.actiune, form.rezultat)
    const panels = []
    if (gauge) panels.push(<div key="gauge"><h2>Manometru</h2><label>Presiune (bar)<input style={S.input} type="number" min="0" step="any" inputMode="decimal" value={form.presiune} onChange={e => patch({ presiune: e.target.value })} /></label><Photo calcId={proba.id} value={form.poza} onBusy={uploadBusy} onChange={v => patch({ poza: v })} /></div>)
    if (form.actiune === 'porneste') panels.push(<div key="assets"><h2>{proba.tip_fluid === 'apa' ? 'Pompe (optional)' : 'Utilaje la pornire'}</h2>
      {form.utilaje.map((u, i) => <div key={i} style={S.card}><Select label={`Utilaj ${i + 1}`} value={u.active_id} rows={assetRows} onChange={v => patch({ utilaje: form.utilaje.map((x, j) => i === j ? { ...x, active_id: v, ore_bord: '', poza_path: '' } : x) })} /><Button secondary disabled={uploads > 0} onClick={() => patch({ utilaje: form.utilaje.filter((_, j) => i !== j) })}>Scoate din lista</Button></div>)}
      <Button secondary disabled={uploads > 0} onClick={() => patch({ utilaje: [...form.utilaje, { active_id: '', rol: proba.tip_fluid === 'apa' ? 'pompa' : 'compresor', ore_bord: '', poza_path: '' }] })}>+ Alege utilaj</Button></div>)
    if (proba.tip_fluid === 'aer') form.utilaje.forEach((u, i) => panels.push(<div key={`utilaj-${i}`}>{utilajEditor(u, v => patch({ utilaje: form.utilaje.map((x, j) => i === j ? v : x) }), false)}</div>))
    if (form.actiune === 'opreste_utilaj') panels.push(<div key="stop"><h2>Oprire {assetLabel(form.utilaje[0].active_id)}</h2>
      <Select label="Motiv" value={form.motiv} rows={['terminat', 'defect', 'inlocuit', 'altul'].map(id => ({ id, label: id }))} onChange={v => patch({ motiv: v })} />
      <label><input type="checkbox" disabled={uploads > 0} checked={!!form.inlocuitor} onChange={e => patch({ inlocuitor: e.target.checked ? { active_id: '', rol: proba.tip_fluid === 'apa' ? 'pompa' : 'compresor', ore_bord: '', poza_path: '' } : null })} /> Pun un inlocuitor</label>
      {form.inlocuitor && utilajEditor(form.inlocuitor, v => patch({ inlocuitor: v }), true)}</div>)
    panels.push(<div key="confirm"><h2>{form.actiune === 'inchide' ? `Inchidere: ${form.rezultat}` : 'Verifica si trimite'}</h2>
      <p>{form.actiune === 'schimba_faza' ? `Trec la ${next}` : form.actiune === 'porneste' ? 'Pornesc proba' : form.actiune === 'citire' ? 'Salvez citirea' : 'Confirm actiunea'}</p>
      {form.actiune !== 'porneste' && <label>{form.rezultat === 'respins' ? 'Motiv respingere (obligatoriu)' : 'Observatii'}<textarea style={S.input} rows={3} value={form.observatii} onChange={e => patch({ observatii: e.target.value })} /></label>}
      <p>{ceLipseste(form).join(' / ')}</p>
      <Button disabled={ceLipseste(form).length > 0 || busy || uploads > 0} onClick={submit}>{form.actiune === 'inchide' ? 'Confirm inchiderea probei' : 'Confirm si trimit'}</Button></div>)
    const index = Math.min(page, panels.length - 1)
    const key = panels[index].key
    const currentAsset = key.startsWith('utilaj-') ? form.utilaje[Number(key.slice(7))] : null
    const validNumber = v => v !== '' && v != null && Number.isFinite(Number(v)) && Number(v) >= 0
    const complete = key === 'gauge' ? !!form.poza && validNumber(form.presiune)
      : key === 'assets' ? (proba.tip_fluid === 'apa' || form.utilaje.length > 0) && form.utilaje.every(u => u.active_id) && new Set(form.utilaje.map(u => String(u.active_id))).size === form.utilaje.length
        : currentAsset ? !!currentAsset.poza_path && validNumber(currentAsset.ore_bord) : true
    return <><p style={{ color: G.muted }}>Pas {index + 1} / {panels.length}</p>{panels[index]}
      {index < panels.length - 1 && <Button disabled={uploads > 0 || !complete} onClick={() => setPage(index + 1)}>Continua</Button>}
      {index > 0 && <Button secondary disabled={uploads > 0} onClick={() => setPage(index - 1)}>Pasul anterior</Button>}
      <Button secondary disabled={uploads > 0} onClick={() => setForm(null)}>Renunt la formular</Button></>
  }
  return <main style={{ minHeight: '100vh', maxWidth: 520, margin: '0 auto', padding: '20px 16px', boxSizing: 'border-box', background: G.bg, color: G.text, fontFamily: '-apple-system, Segoe UI, sans-serif' }}>
    <h1 style={{ fontSize: 23 }}>Probe presiune {proba ? `#${proba.id}` : ''}</h1>
    {error && <div role="alert" style={{ ...S.card, color: G.red }}>{error}{!pending && !form && <Button secondary disabled={loading} onClick={() => { if (proba) open(proba.id); else { load(); setRevision(n => n + 1) } }}>Reincearca incarcarea</Button>}</div>}
    {loading ? <p>Se incarca...</p> : pending ? <div style={S.card}>
      <h2>{salt ? 'Saltul e mare, confirmi?' : 'Operatie de recuperat'}</h2>
      <p>{salt ? 'Verifica toate contoarele din aceasta actiune. Motivul se salveaza pentru fiecare utilaj trimis.' : 'Reincercarea pastreaza aceeasi cheie si aceleasi date. Nu porni alta actiune pana la raspuns.'}</p>
      {salt && [...(operation.current.args.p_utilaje || [{ active_id: operation.current.args.p_active_id, ore_bord: operation.current.args.p_ore_bord }]), ...(operation.current.args.p_inlocuitor ? [operation.current.args.p_inlocuitor] : [])].map(u => <p key={u.active_id}>{assetLabel(u.active_id)}: {u.ore_bord} ore</p>)}
      {salt && <label>Motiv salt ore<textarea style={S.input} value={saltReason} onChange={e => setSaltReason(e.target.value)} /></label>}
      <Button disabled={busy || (salt && !saltReason.trim())} onClick={() => send(salt ? confirmaSalt(operation.current, saltReason) : operation.current)}>{busy ? 'Se trimite...' : salt ? 'Confirm saltul si retrimit' : 'Reincearca trimiterea'}</Button>
      {salt && <Button secondary disabled={busy} onClick={() => { storeOperation(null); setSalt(false); setError('Salt neconfirmat. Corecteaza contoarele.'); }}>Nu confirm, corectez</Button>}
    </div> : !allowed ? <><p>Ai nevoie de drept explicit de scriere probe_teren.</p><Button secondary onClick={load}>Reverifica accesul</Button></> : form ? renderForm() : proba ? <>
      <div style={S.card}><strong>{proba.tip_fluid === 'apa' ? 'Hidraulica - apa' : 'Pneumatica - aer'}</strong><p>{proba.status} / {proba.faza_curenta || 'fara faze'}</p>
        <div style={{ display: 'flex', gap: 5 }}>{FAZE[proba.tip_fluid]?.map((f, i) => <span key={f} title={f} style={{ flex: 1, height: 7, borderRadius: 4, background: i <= FAZE[proba.tip_fluid].indexOf(proba.faza_curenta) ? G.green : G.border }} />)}</div>
        {proba.ora_start && !closed && <p>Ore scurse: {durata(now - Date.parse(proba.ora_start))}</p>}
        {!closed && report?.faze?.find(f => f.faza === proba.faza_curenta)?.inceput && <p>In faza curenta: {durata(now - Date.parse(report.faze.find(f => f.faza === proba.faza_curenta).inceput))}</p>}
        {proba.tip_fluid === 'apa' && <p>Citirea {schedule.numar}/3 {proba.faza_curenta === 'umplere' ? '- fara citiri la umplere' : '- durata orientativa 6h'}</p>}
        {schedule.urmatoarea && !closed && <p style={{ color: schedule.intarziata ? G.red : G.blue }}>{schedule.intarziata ? 'Citire intarziata peste 8h' : schedule.ramaseMs <= 0 ? 'Este timpul pentru citire' : `Urmatoarea citire in ${durata(schedule.ramaseMs)}`} (orientativ{proba.tip_fluid === 'apa' ? ', jumatate' : ''})</p>}
      </div>
      {closed ? <><h2>Rezumat</h2><p>{proba.status} / {num(report?.durata_reala_h)} ore</p>
        {proba.tip_fluid === 'apa' ? report?.citiri_hidraulice?.map((c, i) => <p key={c.log_id}>Citirea {i + 1}/3: {num(c.presiune_bar)} bar - {new Date(c.ora).toLocaleString('ro-RO')}</p>) : report?.faze?.map(f => <div key={f.faza} style={S.card}><strong>{f.faza} - {num(f.durata_h)} h</strong>{f.utilaje.map(u => <p key={u.active_id}>{assetLabel(u.active_id)}: {num(u.ore_lucrate)} ore / {num(u.litri_estimati)} litri estimati</p>)}</div>)}
      </> : proba.status === 'planificata' ? <Button onClick={() => startAction('porneste')}>Porneste proba</Button> : !proba.faza_curenta ? <p>Executie veche fara faze. Necesita ecranul existent.</p> : <>
        {next && <Button onClick={() => startAction('schimba_faza')}>Trec la faza urmatoare: {next}</Button>}
        {canRead && <Button onClick={() => startAction('citire')}>{proba.tip_fluid === 'apa' ? 'Citirea 2/3 - la jumatate' : 'Citire la 6 ore'}</Button>}
        {active.map(u => <div key={u.active_id} style={S.card}><strong>{assetLabel(u.active_id)}</strong><Button secondary onClick={() => startAction('opreste_utilaj', null, u)}>Opreste / inlocuieste</Button></div>)}
        {proba.faza_curenta === (proba.tip_fluid === 'apa' ? 'presurizare' : 'proba') && <Button secondary onClick={() => startAction('inchide', 'admis')}>Inchide - Admis</Button>}
        <Button danger onClick={() => startAction('inchide', 'respins')}>Inchide - Respins</Button>
      </>}
      <Button secondary onClick={() => open(proba.id)}>Reincarca proba</Button><Button secondary onClick={() => { setProba(null); setStep(0); setProject(''); }}>Alta lucrare</Button>
    </> : <>
      <p style={{ color: G.muted }}>Pregatire {step + 1}/5</p>
      {step === 0 && <><Select label="Lucrarea" value={project} rows={projects.map(p => ({ id: p.id, label: `${p.cod_intern || ''} ${p.nume}` }))} onChange={v => { setError(''); setProject(v); }} />
        <Button disabled={!project || !!error} onClick={() => setStep(sections.length > 1 ? 1 : 2)}>Continua</Button></>}
      {step === 1 && <><Select label="Tronsonul" value={section} rows={sections.map(s => ({ id: s.id, label: `${s.cod || ''} ${s.denumire}` }))} onChange={setSection} /><Button disabled={!section} onClick={() => setStep(2)}>Continua</Button></>}
      {step === 2 && <>{listRows.filter(p => p.status === 'in_executie').map(p => <Button secondary key={p.id} onClick={() => open(p.id)}>Continua #{p.id} - {p.tip_fluid} / {p.faza_curenta || 'veche'} / {p.tert_client || p.beneficiar_tip}</Button>)}<h2>Tipul probei noi</h2><Button onClick={() => { setFluid('aer'); setStep(3) }}>Pneumatica (aer)</Button><Button secondary onClick={() => { setFluid('apa'); setStep(3) }}>Hidraulica (apa)</Button></>}
      {step === 3 && <><h2>Beneficiar</h2><Select label="Pentru cine?" value={benef} rows={[{ id: 'gazpet', label: 'Gazpet' }, { id: 'tert', label: 'Tert' }]} onChange={setBenef} />
        {benef === 'tert' && <><Select label="Referinta" value={refType} rows={['oferta', 'contract', 'comanda'].map(id => ({ id, label: id }))} onChange={setRefType} />
          {refType === 'comanda' ? <label>Comanda (minim 3 caractere)<input style={S.input} value={refText} onChange={e => setRefText(e.target.value)} /></label> : <Select label="Alege referinta" value={refId} rows={refs.map(r => ({ id: r.id, label: refType === 'oferta' ? `${r.nr_oferta || r.id} ${r.client || ''}` : `${r.numar_contract || r.id} ${r.denumire || ''}` }))} onChange={v => { setRefId(v); const r = refs.find(x => String(x.id) === v); setClient(r?.client || r?.partener_text || '') }} />}
          <label>Client (obligatoriu)<input style={S.input} value={client} onChange={e => setClient(e.target.value)} /></label></>}
        <Button disabled={!benefOk} onClick={() => setStep(4)}>Continua</Button></>}
      {step === 4 && <><h2>Alege proba</h2>{listRows.filter(p => p.status === 'in_executie').map(p => <Button secondary key={p.id} onClick={() => open(p.id)}>Continua #{p.id} - {p.tip_fluid} / {p.faza_curenta || 'veche'} / {p.tert_client || p.beneficiar_tip}</Button>)}
        {planned.map(p => <Button secondary key={p.id} onClick={() => open(p.id)}>Foloseste proba planificata #{p.id}</Button>)}
        <Button disabled={busy || !benefOk || !fluid || (sections.length > 1 && !section)} onClick={create}>Creeaza proba noua</Button></>}
      {step > 0 && <Button secondary onClick={() => { setError(''); setStep(step === 2 && sections.length <= 1 ? 0 : step - 1) }}>Inapoi</Button>}
    </>}
    {!pending && !form && <Button secondary disabled={busy} onClick={onBack}>Inapoi la /m</Button>}
  </main>
}
