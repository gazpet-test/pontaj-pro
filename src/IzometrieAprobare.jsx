import { useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase.js'
import { ziBucuresti } from './lib/izoTeren.js'
import { frontVechi } from './lib/izoSesiuni.js'
import { EmitereAviz, ArhivaAvize } from './izoAvizIesire.jsx'
import { CAS_MESAJ, creeazaControlBirou, eroareBirou, declaratiiLot, cheiDecizii, descendenti, cerereAprobare, cerereDecizie, cerereFront, cerereTranzitie, executaBirou, citestePagini } from './lib/izoBirou.js'

const G = { bg: '#F4F6F8', card: '#FFFFFF', text: '#152536', muted: '#4A5969', border: '#9BA9B6', blue: '#1259A7', red: '#9C2121', yellow: '#FFF0BA' }
const S = {
  page: { background: G.bg, color: G.text, padding: 16, borderRadius: 12 },
  card: { background: G.card, border: `1px solid ${G.border}`, borderRadius: 8, padding: 14, marginTop: 12 },
  row: { display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  input: { padding: 9, border: `1px solid ${G.border}`, borderRadius: 5, background: G.card, color: G.text, maxWidth: '100%' },
  btn: { padding: '9px 14px', borderRadius: 5, border: `1px solid ${G.border}`, background: G.blue, color: '#FFF', cursor: 'pointer' },
  pre: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12, maxHeight: 300, overflow: 'auto' },
}
const Json = ({ value, label }) => <details><summary>{label}</summary><pre style={S.pre}>{JSON.stringify(value, null, 2)}</pre></details>
const Input = props => <input style={S.input} {...props} />
const Select = props => <select style={S.input} {...props} />
const Button = props => <button style={S.btn} {...props} />
const labelPiece = b => `${b.serie || b.uid} · ${b.sarja || 'fără șarjă'} · ${b.lungime_mm} mm · perete ${b.perete_mm ?? '—'} mm · ${b.stare}`

function useBirou(proiectId) {
  const [busy, setBusy] = useState(false), [mesaj, setMesaj] = useState(''), [pending, setPending] = useState(null)
  const control = useRef(null)
  if (!control.current) control.current = creeazaControlBirou()
  useEffect(() => { control.current.invalideaza(); setPending(null); setMesaj('') }, [proiectId])
  useEffect(() => () => { control.current.invalideaza() }, [])
  async function run(fn) {
    const job = control.current.incepe()
    if (!job) return
    setBusy(true)
    const current = job.actuala
    try { await fn(current) } catch (e) { if (current()) setMesaj(eroareBirou(e)) }
    finally { if (job.incheie()) setBusy(false) }
  }
  async function send(request, refresh, current) {
    // Eroarea de transport păstrează cererea exactă pentru reluarea explicită.
    setPending(request)
    let result
    try { result = await executaBirou((n, a) => supabase.rpc(n, a), request) }
    catch (e) {
      if (current() && (e.code || eroareBirou(e) === CAS_MESAJ)) setPending(null)
      throw e
    }
    if (!current()) return
    setPending(null); setMesaj(`Operație confirmată: ${result.cod}.`)
    await refresh(current)
  }
  return { busy, mesaj, pending, run, send, setMesaj }
}

function Scope({ proiectId, proiecte = [], onProiect, tronsoane = [], tronson, setTronson, lockedMode, disabled }) {
  return <div style={S.row}>
    <label>Proiect <Select aria-label="Proiect" disabled={lockedMode || disabled} value={proiectId || ''} onChange={e => onProiect(Number(e.target.value))}>{proiecte.map(p => <option key={p.id} value={p.id}>{p.nume || p.cod || p.id}</option>)}</Select></label>
    <label>Tronson <Select aria-label="Tronson" disabled={disabled} value={tronson} onChange={e => setTronson(e.target.value)}><option value="">Toate tronsoanele</option>{tronsoane.filter(t => t.proiect_id === proiectId).map(t => <option key={t.id} value={t.id}>{t.cod}</option>)}</Select></label>
  </div>
}

function SesiuniAbandonate({ proiectId, onSelect }) {
  const ui = useBirou(proiectId)
  const [sessions, setSessions] = useState([]), [fronts, setFronts] = useState([]), [motiv, setMotiv] = useState('')
  const disabled = ui.busy || Boolean(ui.pending)
  async function refresh(current) {
    const [s, f] = await Promise.all([
      citestePagini((from, to) => supabase.from('izo_preverificari').select('*').eq('proiect_id', proiectId).eq('stare', 'deschisa').lt('zi', ziBucuresti()).order('id').range(from, to)),
      citestePagini((from, to) => supabase.from('izo_fronturi').select('*').eq('proiect_id', proiectId).eq('activ', true).order('id').range(from, to)),
    ])
    if (current()) { setSessions(s); setFronts(f) }
  }
  useEffect(() => { setSessions([]); setFronts([]); setMotiv(''); if (proiectId) ui.run(refresh) }, [proiectId])
  const staleFronts = fronts.filter(f => frontVechi(f) || sessions.some(s => s.tronson_id === f.tronson_id))
  return <div style={S.card}><h3>Sesiuni și fronturi rămase din zile precedente</h3>
    <Button disabled={disabled} onClick={() => ui.run(refresh)}>Reîncarcă sesiunile abandonate</Button>
    <p role="status">{ui.mesaj}</p>
    <p>Eliberarea frontului permite altei tablete să lucreze. Declarațiile rămân: autorul le trimite sau MP-ul le respinge cu motiv după eliberare. Dreptul de gestionar singur nu permite eliberarea.</p>
    {sessions.map(s => <p key={s.id}>{s.zi} · tronson {s.tronson_id} · sesiunea #{s.id} · autor {s.autor_profile_id} {onSelect && <Button disabled={disabled} onClick={() => onSelect(s)}>Deschide ciornele pentru respingere MP</Button>}</p>)}
    <Input aria-label="Motiv eliberare front vechi" disabled={disabled} placeholder="Motiv obligatoriu pentru eliberare MP" value={motiv} maxLength={1000} onChange={e => setMotiv(e.target.value)} />
    {staleFronts.map(f => <p key={f.id}>Tronson {f.tronson_id} · autor {f.profile_id} · expiră {f.expira_la} <Button disabled={disabled || motiv.trim().length < 3} onClick={() => ui.run(current => ui.send(cerereFront(f.tronson_id, motiv), refresh, current))}>Eliberează frontul (MP)</Button></p>)}
    {ui.pending && <Button disabled={ui.busy} onClick={() => ui.run(current => ui.send(ui.pending, refresh, current))}>Reîncearcă identic eliberarea neconfirmată</Button>}
    {!sessions.length && !staleFronts.length && <p>Nicio sesiune sau front vechi vizibil.</p>}
  </div>
}

export default function IzometrieAprobare(props) {
  const { proiectId } = props
  const ui = useBirou(proiectId)
  const [tronson, setTronson] = useState(''), [queue, setQueue] = useState([]), [preview, setPreview] = useState(null)
  const [alerts, setAlerts] = useState([]), [ids, setIds] = useState([]), [decisions, setDecisions] = useState({})
  const [target, setTarget] = useState(''), [reason, setReason] = useState(''), [deps, setDeps] = useState({}), [piece, setPiece] = useState('')
  const [wallReasons, setWallReasons] = useState({})
  const selection = useRef(0)
  const rows = declaratiiLot(preview)
  const decl = rows.find(d => String(d.id) === target)
  const descendants = decl ? descendenti(decl, preview.declaratii_proiect || [], preview.copii_proiect || []) : []
  const disabled = ui.busy || Boolean(ui.pending) || ui.mesaj === CAS_MESAJ
  function clearPreview() { selection.current++; setPreview(null); setIds([]); setDecisions({}); setTarget(''); setReason(''); setDeps({}); setPiece('') }
  async function refresh(current) {
    clearPreview()
    const [sessions, a] = await Promise.all([
      citestePagini((from, to) => supabase.from('izo_preverificari').select('*').eq('proiect_id', proiectId).eq('stare', 'trimisa').order('id').range(from, to)),
      citestePagini((from, to) => supabase.from('v_izo_alerte').select('*').eq('proiect_id', proiectId).order('declaratie_id').order('sudura_id').range(from, to)),
    ])
    if (current()) { setQueue(sessions); setAlerts(a) }
  }
  useEffect(() => { setQueue([]); setAlerts([]); setTronson(''); clearPreview(); if (proiectId) ui.run(refresh) }, [proiectId])
  async function load(session, current) {
    clearPreview()
    const ticket = selection.current
    const { data, error } = await supabase.rpc('fn_izo_aprobare_lot', { p_preverificare: session.id })
    if (error) throw error
    if (session.stare === 'deschisa') {
      // Preview-ul LIVE grupează doar sesiunile trimise. Ciornele sunt deja
      // în proiecția autorizată declaratii_proiect; deciziile RPC le reverifică.
      data.randuri = (data.declaratii_proiect || []).filter(d => d.preverificare_id === session.id).map(d => ({ declaratie: d }))
    }
    if (current() && selection.current === ticket) { setPreview(data); ui.setMesaj('Preview încărcat. Verifică simularea și selectează rândurile.') }
  }
  const send = build => ui.run(async current => { const request = build(); await ui.send(request, refresh, current) })
  return <div style={S.page}>
    <h2>Aprobare teren · MP</h2>
    <SesiuniAbandonate proiectId={proiectId} onSelect={s => ui.run(current => load(s, current))} />
    <Scope {...props} tronson={tronson} setTronson={v => { setTronson(v); clearPreview() }} disabled={disabled} />
    <p>Lotul grupează sesiunile trimise din aceeași zi și același tronson. Nimeni nu își poate aproba propriile declarații; serverul verifică drepturile și dependențele.</p>
    <Button disabled={ui.busy || Boolean(ui.pending)} onClick={() => ui.run(async current => { await refresh(current); if (current()) ui.setMesaj('Lista reîncărcată. Deschide din nou lotul și verifică selecția.') })}>Reîncarcă lista și lotul</Button>
    <p role="status" aria-live="polite" style={{ color: ui.mesaj === CAS_MESAJ ? G.red : G.text }}>{ui.mesaj}</p>
    {ui.pending && <div style={S.card}>Răspuns neconfirmat. Reia aceeași cerere înainte de o altă operație. <Button disabled={ui.busy} onClick={() => ui.run(current => ui.send(ui.pending, refresh, current))}>Reîncearcă identic</Button></div>}
    <div style={S.card}><h3>Sesiuni trimise ({queue.filter(s => !tronson || String(s.tronson_id) === tronson).length})</h3>
      {queue.filter(s => !tronson || String(s.tronson_id) === tronson).map(s => <div key={s.id} style={S.row}><span>{s.zi} · {props.tronsoane?.find(t => t.id === s.tronson_id)?.cod || s.tronson_id} · sesiunea #{s.id} · autor {s.autor_profile_id}</span><Button disabled={disabled} onClick={() => ui.run(current => load(s, current))}>Deschide preview</Button></div>)}
      {!queue.length && <p>Nicio sesiune trimisă.</p>}
    </div>
    {preview && <div style={S.card}>
      <h3>Lot {preview.preverificare?.zi} · {preview.tronson?.cod}</h3>
      <p>Simularea serverului pentru toate rândurile trimise: {preview.simulare?.refuz ? `REFUZ: ${preview.simulare.refuz}` : `ordine: ${(preview.simulare?.ordine || []).join(' → ')}`}. Aprobarea parțială este revalidată pe server pentru submulțimea selectată.</p>
      <Json label="Efecte simulate: bucăți și capete" value={preview.simulare} />
      <div style={S.row}><Button disabled={disabled} onClick={() => setIds(rows.filter(d => d.stare === 'trimisa').map(d => d.id))}>Selectează toate rândurile trimise</Button><Button disabled={disabled} onClick={() => setIds([])}>Golește selecția</Button></div>
      {preview.randuri.map(r => { const d = r.declaratie; const b = r.bucata || preview.registru?.find(x => x.id === (d.sursa_bucata_id || d.bucata_id)); return <div style={S.card} key={d.id}>
        <label><input type="checkbox" disabled={disabled || d.stare !== 'trimisa'} checked={ids.includes(d.id)} onChange={e => setIds(e.target.checked ? [...ids, d.id] : ids.filter(x => x !== d.id))} /> #{d.id} · {d.tip} · {d.stare} · v{d.versiune}</label>
        <p>{b ? labelPiece(b) : 'Bucată încă neidentificată / copil declarat'} · depinde de {d.depinde_de_uid || '—'} · {d.conflict_cod || d.blocata_motiv || ''}</p>
        {d.identificare === 'nerezolvata' && <div style={{ ...S.card, background: G.yellow }}><strong>Identificare nerezolvată · seria citită: {d.payload?.serie_bruta}</strong>
          <p>Lungime măsurată: {d.payload?.lungime_masurata_mm} mm · șarjă: {d.payload?.sarja_declarata || 'neprecizată'} · perete: {d.payload?.perete_declarat || 'necunoscut'}. Nu poate fi aprobată până la lămurirea seriei.</p>
          <Button disabled={disabled || d.stare !== 'in_verificare'} onClick={() => { setTarget(String(d.id)); setPiece(''); setReason(''); setDeps({}) }}>Alege acest rând pentru lămurirea seriei</Button>
        </div>}
        {alerts.filter(a => a.declaratie_id === d.id).map((a, i) => <p key={i} style={{ color: G.red }}>{a.cod}: {JSON.stringify(a.detalii)}</p>)}
        <Json label="Declarație, măsurători, copii și rezervări" value={r} />
      </div> })}
      {cheiDecizii(preview, ids).map(k => <label key={k} style={{ display: 'block', margin: 8 }}>Diferență față de aviz · {k} · motivul corecției <Input value={decisions[k] || ''} disabled={disabled} onChange={e => setDecisions({ ...decisions, [k]: e.target.value })} maxLength={1000} /></label>)}
      <Button disabled={disabled || !ids.length} onClick={() => send(() => cerereAprobare(preview, ids, decisions))}>{ids.length === rows.filter(d => d.stare === 'trimisa').length ? 'Aprobă toate rândurile selectate' : `Aprobă parțial (${ids.length})`}</Button>
      <Json label="Arbori / registru și rezervările proiectului" value={{ registru: preview.registru, copii: preview.copii_proiect, rezervari: preview.rezervari_proiect }} />
      <div style={S.card}><h3>Revizie, respingere sau serie în verificare</h3>
        <Select aria-label="Rând de corectat" value={target} disabled={disabled} onChange={e => { setTarget(e.target.value); setDeps({}); setPiece(''); setReason('') }}><option value="">Alege rândul</option>{rows.filter(d => !['aprobata', 'respinsa', 'stearsa'].includes(d.stare)).map(d => <option key={d.id} value={d.id}>#{d.id} {d.tip} · {d.stare}</option>)}</Select>
        <Input aria-label="Motiv decizie" placeholder="Motiv obligatoriu" disabled={disabled} value={reason} maxLength={1000} onChange={e => setReason(e.target.value)} />
        {descendants.map(d => <label key={d.id} style={{ display: 'block' }}>Descendent #{d.id} · {d.tip} · {d.stare} <Select disabled={disabled} value={deps[d.id] || ''} onChange={e => setDeps({ ...deps, [d.id]: e.target.value })}><option value="">Alege explicit</option><option value="blocheaza">Blochează pentru refacere</option><option value="respinge">Respinge în cascadă</option></Select></label>)}
        <p>Respingerea eliberează rezervările și anulează copiii declarați. O decizie este obligatorie pentru fiecare descendent afișat.</p>
        <div style={S.row}><Button disabled={disabled || reason.trim().length < 3 || !decl || descendants.some(d => !deps[d.id])} onClick={() => send(() => cerereDecizie('respinge', decl, reason, Object.fromEntries(descendants.map(d => [d.id, deps[d.id]]))))}>Respinge cu motiv</Button>
          <Button disabled={disabled || reason.trim().length < 3 || !decl || !['trimisa', 'in_verificare'].includes(decl.stare)} onClick={() => send(() => cerereDecizie('revizie_cere', decl, reason))}>Cere revizie (blochează descendenții)</Button></div>
        {decl?.stare === 'in_verificare' && <div style={S.card}><p>Serie citită: {decl.payload?.serie_bruta} · măsurată: {decl.payload?.lungime_masurata_mm} mm. Verifică fizic identitatea; lămurirea păstrează măsurătorile și lasă rândul de aprobat.</p><div style={S.row}><Select aria-label="Bucată reală" value={piece} disabled={disabled} onChange={e => setPiece(e.target.value)}><option value="">Alege bucata reală</option>{(preview.registru || []).filter(b => b.stare === 'pe_tronson' && b.tronson_id === decl.tronson_id).map(b => <option key={b.id} value={b.id}>{labelPiece(b)}</option>)}</Select><Button disabled={disabled || reason.trim().length < 3 || !piece} onClick={() => send(() => cerereDecizie('serie_lamureste', decl, reason, { bucata: piece }))}>Lămurește seria</Button></div></div>}
      </div>
    </div>}
    <div style={S.card}><h3>Alerte active ale proiectului</h3>{!alerts.length && <p>Nicio alertă activă.</p>}{alerts.filter(a => !tronson || String(a.tronson_id) === tronson).map(a => <div style={S.card} key={`${a.cod}-${a.declaratie_id}-${a.sudura_id}`}>
      <strong>{a.cod}</strong> · tronson {a.tronson_id} · declarație #{a.declaratie_id} <pre style={S.pre}>{JSON.stringify(a.detalii, null, 2)}</pre>
      {a.cod === 'izo_tranzitie_perete_neconfirmata' ? <div style={S.row}><Input disabled={disabled} aria-label={`Motiv tranziție ${a.sudura_id}`} placeholder="Motiv confirmare tranziție perete" value={wallReasons[a.sudura_id] || ''} onChange={e => setWallReasons({ ...wallReasons, [a.sudura_id]: e.target.value })} maxLength={1000} /><Button disabled={disabled} onClick={() => send(() => cerereTranzitie(a.sudura_id, wallReasons[a.sudura_id]))}>Confirmă tranziția sudurii #{a.sudura_id}</Button></div> : <p>Deschide sesiunea declarației; corecția se decide cu motiv la aprobare sau se cere revizie.</p>}
    </div>)}</div>
  </div>
}

export function IzometrieGestionar(props) {
  const { proiectId } = props
  const ui = useBirou(proiectId)
  const [tronson, setTronson] = useState(''), [depozit, setDepozit] = useState(''), [depozite, setDepozite] = useState([])
  const [bucati, setBucati] = useState([]), [rezervari, setRezervari] = useState([]), [fronturi, setFronturi] = useState([])
  const [ids, setIds] = useState([]), [arhiva, setArhiva] = useState(0), [reason, setReason] = useState('')
  const disabled = ui.busy || Boolean(ui.pending)
  async function refresh(current) {
    const project = props.proiecte?.find(p => p.id === proiectId)
    if (!project?.site_id) throw Error('Proiectul nu are șantier/depozite configurate.')
    const [pieces, reservations, fronts, depots] = await Promise.all([
      citestePagini((from, to) => supabase.from('magazie_bucati').select('id,uid,tip_cod,serie,sarja,lungime_mm,perete_mm,diametru_mm,greutate_kg,stare,depozit_id,tronson_id,atribute').eq('proiect_id', proiectId).eq('provenienta', 'beneficiar').not('tip_cod', 'is', null).is('executie_teava_id', null).in('stare', ['sosit', 'receptionat', 'retur', 'in_tranzit']).order('id').range(from, to)),
      citestePagini((from, to) => supabase.from('v_izo_rezervari_active').select('*').eq('proiect_id', proiectId).order('id').range(from, to)),
      citestePagini((from, to) => supabase.from('izo_fronturi').select('*').eq('proiect_id', proiectId).eq('activ', true).order('id').range(from, to)),
      citestePagini((from, to) => supabase.from('logistica_depozite').select('id,name').eq('site_id', project.site_id).eq('activ', true).order('id').range(from, to)),
    ])
    if (current()) { setBucati(pieces); setRezervari(reservations); setFronturi(fronts); setDepozite(depots); setIds([]) }
  }
  useEffect(() => { setBucati([]); setRezervari([]); setFronturi([]); setDepozite([]); setIds([]); setTronson(''); setDepozit(''); setReason(''); if (proiectId) ui.run(refresh) }, [proiectId])
  const available = bucati.filter(b => String(b.depozit_id) === depozit && ['sosit', 'receptionat', 'retur'].includes(b.stare))
  const send = build => ui.run(async current => { const request = build(); await ui.send(request, refresh, current) })
  return <div style={S.page}><h2>Gestionar · depozit</h2>
    <SesiuniAbandonate proiectId={proiectId} />
    <Scope {...props} tronson={tronson} setTronson={v => { setTronson(v); setIds([]) }} disabled={disabled} />
    <p role="status" aria-live="polite">{ui.mesaj}</p>
    {ui.pending && <div style={S.card}>Răspuns neconfirmat. <Button disabled={ui.busy} onClick={() => ui.run(current => ui.send(ui.pending, refresh, current))}>Reîncearcă aceeași operație</Button></div>}
    <Button disabled={disabled} onClick={() => ui.run(refresh)}>Reîncarcă depozitul și rezervările</Button>
    <EmitereAviz ui={ui} depozit={depozit} setDepozit={setDepozit} depozite={depozite} tronson={tronson} available={available} rezervari={rezervari} refresh={async current => { await refresh(current); setArhiva(x => x + 1) }} disabled={disabled} />
    <ArhivaAvize ui={ui} proiectId={proiectId} depozite={depozite} tronsoane={props.tronsoane} disabled={disabled} reincarca={arhiva} />
    <div style={S.card}><h3>Rezervări active ({rezervari.length})</h3>{rezervari.filter(r => !tronson || String(r.tronson_id) === tronson).map(r => <p key={r.id}>#{r.id} · bucata {r.bucata_id || `declarată ${r.bucata_decl_uid}`} · declarație #{r.declaratie_id} v{r.declaratie_versiune} · tronson {r.tronson_id} · expiră {r.expira_dupa || 'la decizie'}</p>)}</div>
    <div style={S.card}><h3>Fronturi active · eliberare MP</h3><p>Eliberarea oprește frontul. Inginerul trebuie să îl preia din nou înainte de sincronizare. Dreptul de gestionar singur nu permite această operație.</p>
      {fronturi.filter(f => !tronson || String(f.tronson_id) === tronson).map(f => <p key={f.id}>Tronson {f.tronson_id} · {f.profile_id} · expiră {f.expira_la}</p>)}
      <Input disabled={disabled} aria-label="Motiv eliberare front" placeholder="Motiv obligatoriu" maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /> <Button disabled={disabled || reason.trim().length < 3 || !tronson} onClick={() => send(() => cerereFront(Number(tronson), reason))}>Eliberează frontul tronsonului (MP)</Button>
    </div>
    <div style={S.card}><h3>Resturi în tranzit</h3>{bucati.filter(b => b.stare === 'in_tranzit' && (!depozit || String(b.depozit_id) === depozit)).map(b => <p key={b.id}>{labelPiece(b)}</p>)}<p>Primirea resturilor nu este disponibilă în acest ecran.</p></div>
  </div>
}
