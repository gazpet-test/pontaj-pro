// Avizul de ieșire pe tronson: formularul de emitere, PDF-ul și arhiva (design docs/izometrie/AVIZ_IESIRE_DESIGN.md).
import { useEffect, useMemo, useRef, useState } from 'react'
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import { supabase } from './lib/supabase.js'
import { ziBucuresti } from './lib/izoTeren.js'
import { citestePagini, eroareBirou } from './lib/izoBirou.js'
import { filtreazaBucati, totaluri, fmtNr, cerereIesireAviz, caleAviz, numeFisierAviz, htmlAviz, semnaturaUnica, refuzDefinitiv, reconciliazaAviz, reconciliazaLista } from './lib/izoAviz.js'

const G = { card: '#FFFFFF', text: '#152536', muted: '#4A5969', border: '#9BA9B6', blue: '#1259A7', red: '#9C2121', yellow: '#FFF0BA', green: '#1E6B3A' }
const S = {
  card: { background: G.card, border: `1px solid ${G.border}`, borderRadius: 8, padding: 14, marginTop: 12 },
  row: { display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  input: { padding: 9, border: `1px solid ${G.border}`, borderRadius: 5, background: G.card, color: G.text, maxWidth: '100%' },
  btn: { padding: '9px 14px', borderRadius: 5, border: `1px solid ${G.border}`, background: G.blue, color: '#FFF', cursor: 'pointer' },
  btn2: { padding: '7px 11px', borderRadius: 5, border: `1px solid ${G.border}`, background: '#FFF', color: G.text, cursor: 'pointer' },
  lista: { maxHeight: 420, overflow: 'auto', border: `1px solid ${G.border}`, borderRadius: 5, marginTop: 8 },
  rez: { background: G.yellow, padding: 10, borderRadius: 5, marginTop: 8 },
  th: { textAlign: 'left', padding: '6px 8px', borderBottom: `1px solid ${G.border}`, fontSize: 13 },
  td: { padding: '6px 8px', borderBottom: '1px solid #E3E8ED', fontSize: 13 },
}
const BUCKET = 'izo-avize'
const COLOANE_AVIZ = 'id,proiect_id,depozit_id,tronson_id,serie,numar,nr_complet,data_aviz,emis_de,emis_de_employee_id,emis_la,sofer_employee_id,sofer_extern_nume,sofer_confirmat,nr_auto,destinatar_tip,destinatar_denumire,destinatar_cui,destinatar_adresa,motiv,antet,continut,total_bucati,total_m,total_kg,stare,anulat_motiv,anulat_de,anulat_la,pdf_path,pdf_atasat_la'

const labelPiece = b => `${b.serie || b.uid} · ${b.sarja || 'fără șarjă'} · DN ${b.diametru_mm ?? '—'} × ${b.perete_mm ?? '—'} mm · ${b.lungime_mm ? fmtNr(b.lungime_mm / 1000, 2) + ' m' : (b.tip_cod === 'curba' ? 'curbă' : '— m')} · ${fmtNr(b.greutate_kg, 0)} kg`

async function dataUrl(url) {
  const blob = await (await fetch(url)).blob()
  return await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob) })
}
// Semnătura EMITENTULUI avizului, legată strict de emis_de_employee_id și doar când utilizatorul curent e emitentul.
// Owner / HR văd semnăturile tuturor: fără filtrul pe angajat s-ar putea lua semnătura altcuiva (Jakarinos P1). Fără cache persistent.
async function semnaturaEmitent(a) {
  try {
    const { data: u } = await supabase.auth.getUser()
    if (!a?.emis_de_employee_id || !u?.user?.id || u.user.id !== a.emis_de) return null
    const { data: rows } = await supabase.from('hr_semnaturi_electronice').select('employee_id,fisier_path')
      .eq('employee_id', a.emis_de_employee_id).eq('activ', true).is('deleted_at', null).limit(2)
    const path = semnaturaUnica(rows, a.emis_de_employee_id)
    if (!path) return null
    const { data: su } = await supabase.storage.from('hr-semnaturi').createSignedUrl(path, 60)
    return su?.signedUrl ? await dataUrl(su.signedUrl) : null
  } catch { return null }
}

// HTML → html2canvas → jsPDF A4, pe mai multe pagini (avizul are până la 200 de poziții).
export async function pdfDinHtml(html) {
  const holder = document.createElement('div')
  holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;background:#ffffff;z-index:-1;'
  holder.innerHTML = html
  document.body.appendChild(holder)
  try {
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    const canvas = await html2canvas(holder, { scale: 2, backgroundColor: '#ffffff', logging: false })
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const pagePx = Math.floor(canvas.width * 297 / 210)
    for (let y = 0, p = 0; y < canvas.height; y += pagePx, p++) {
      const h = Math.min(pagePx, canvas.height - y)
      const c = document.createElement('canvas'); c.width = canvas.width; c.height = h
      c.getContext('2d').drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h)
      if (p) doc.addPage()
      doc.addImage(c.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, 210, h * 210 / canvas.width, undefined, 'FAST')
    }
    return doc.output('blob')
  } finally { document.body.removeChild(holder) }
}

async function citesteAviz(id) {
  const { data, error } = await supabase.from('izo_avize_iesire').select(COLOANE_AVIZ).eq('id', id).single()
  if (error) throw error
  return data
}
// PDF-ul se construiește DOAR din avizul recitit după RPC; upload fără upsert, apoi atașarea verificată pe server.
export async function genereazaSiAtaseaza(avizId) {
  const a = await citesteAviz(avizId)
  if (a.pdf_path) return a
  const semnGestionar = await semnaturaEmitent(a)
  const blob = await pdfDinHtml(htmlAviz(a, { semnGestionar }))
  const { error: up } = await supabase.storage.from(BUCKET).upload(caleAviz(a), blob, { contentType: 'application/pdf', upsert: false })
  if (up && !/exist|duplicate|409/i.test(`${up.message} ${up.statusCode || ''}`)) throw up
  const { data, error } = await supabase.rpc('fn_izo_aviz_pdf_ataseaza', { p_aviz: a.id })
  if (error) throw error
  if (data && ['eroare', 'conflict'].includes(data.cod)) throw Error(data.motiv || data.cod)
  return await citesteAviz(a.id)
}
// Recitește avizul înainte de deschidere: un aviz anulat între timp se descarcă etichetat „ANULAT” (Jakarinos P2).
// laRecitire primește rândul proaspăt ÎNAINTE de Storage, ca starea din ecran să se reconcilieze și dacă signed URL-ul pică.
export async function deschidePdf(a, laRecitire) {
  // „anulat câștigă” și la descărcare: o recitire mai veche decât ecranul nu scoate eticheta ANULAT (Jakarinos r4 P2).
  const r = reconciliazaAviz(a, await citesteAviz(a.id))
  laRecitire?.(r)
  if (!r.pdf_path) throw Error(`Avizul ${r.nr_complet} nu are încă PDF salvat.`)
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(r.pdf_path, 300, { download: r.stare === 'anulat' ? `ANULAT ${numeFisierAviz(r)}` : false })
  if (error) throw error
  window.open(data.signedUrl, '_blank', 'noopener')
  return r
}

function useNomenclatoare(depozit) {
  const [angajati, setAngajati] = useState([]), [vehicule, setVehicule] = useState([]), [serii, setSerii] = useState([])
  useEffect(() => {
    let viu = true
    ;(async () => {
      const [e, v, s] = await Promise.all([
        citestePagini((f, t) => supabase.from('employees').select('id,name,position').eq('active', true).order('name').range(f, t)),
        citestePagini((f, t) => supabase.from('logistica_active').select('id,nr_inmatriculare,marca,model,categorie_vehicul').not('nr_inmatriculare', 'is', null).order('nr_inmatriculare').range(f, t)),
        supabase.from('izo_avize_serii').select('depozit_id,serie,ultim_nr,activ').then(r => r.data || []),
      ])
      if (!viu) return
      const sofer = x => /ofer/i.test(x.position || '') ? 0 : 1
      setAngajati([...e].sort((a, b) => sofer(a) - sofer(b) || String(a.name).localeCompare(String(b.name), 'ro')))
      const grea = x => /N3|N2/.test(x.categorie_vehicul || '') ? 0 : x.categorie_vehicul === 'N1' ? 1 : 2
      setVehicule([...v].sort((a, b) => grea(a) - grea(b) || String(a.nr_inmatriculare).localeCompare(String(b.nr_inmatriculare))))
      setSerii(s)
    })().catch(() => {})
    return () => { viu = false }
  }, [depozit])
  return { angajati, vehicule, serii }
}

// Formularul de emitere: înlocuiește vechiul „Aviz CJPT / CJPJ” tastat.
export function EmitereAviz({ ui, depozit, setDepozit, depozite, tronson, available, rezervari, refresh, disabled }) {
  const [q, setQ] = useState(''), [ids, setIds] = useState([]), [data, setData] = useState(ziBucuresti())
  const [soferExtern, setSoferExtern] = useState(false), [soferId, setSoferId] = useState(''), [soferNume, setSoferNume] = useState('')
  const [vehiculAlt, setVehiculAlt] = useState(false), [vehiculId, setVehiculId] = useState(''), [nrAuto, setNrAuto] = useState('')
  const [destExtern, setDestExtern] = useState(false), [dest, setDest] = useState({ denumire: '', cui: '', adresa: '' })
  const [emis, setEmis] = useState(null), [cerere, setCerere] = useState(null)
  const { angajati, vehicule, serii } = useNomenclatoare(depozit)
  // Schimbarea depozitului / tronsonului golește selecția, dar NU cererea neconfirmată (Copilot P1-01): ea se reia sau se verifică în arhivă.
  useEffect(() => { setIds([]) }, [depozit, tronson])
  const vizibile = useMemo(() => filtreazaBucati(available, q), [available, q])
  const tot = totaluri(available, ids), totViz = totaluri(available, vizibile.map(b => b.id).filter(id => ids.includes(id)))
  const ascunse = ids.length - totViz.n
  const serie = serii.find(s => String(s.depozit_id) === String(depozit))
  const urmator = serie ? `${serie.serie} ${String(serie.ultim_nr + 1).padStart(4, '0')}` : null
  const selectate = available.filter(b => ids.includes(b.id))

  function construieste() {
    return cerereIesireAviz({ depozit, tronson, bucati: ids, data,
      // Etapa 1 (decizia Razvan Q-B, Copilot P2-03): fără semnătura salvată a șoferului, deci fără bifa de confirmare.
      sofer: soferExtern ? { extern: soferNume } : { employeeId: soferId, confirmat: false },
      vehicul: vehiculAlt ? { nrAuto } : { id: vehiculId },
      destinatar: destExtern ? { tip: 'extern', ...dest } : { tip: 'intern' } })
  }
  const emite = req => ui.run(async current => {
    setCerere(req)
    const { data: r, error } = await supabase.rpc(req.nume, req.args)
    // Doar un refuz al bazei (tranzacție anulată) eliberează cererea; orice rezultat necunoscut păstrează aceeași cheie.
    if (error) { if (refuzDefinitiv(error)) setCerere(null); throw error }
    if (!r) throw Error('Răspuns lipsă: reîncearcă aceeași emitere (nu se dublează avizul).')
    if (['eroare', 'conflict', 'cas'].includes(r.cod)) { setCerere(null); throw Error(r.motiv || r.cod) }
    if (!current()) return
    setCerere(null); setIds([])
    const avizId = r.aviz?.id || r.aviz_id
    ui.setMesaj(`Aviz emis: ${r.aviz?.nr_complet || ''}. Se generează PDF-ul…`)
    let a = await citesteAviz(avizId)
    try { a = await genereazaSiAtaseaza(avizId); ui.setMesaj(`Aviz ${a.nr_complet} emis și arhivat.`) }
    catch (e) { ui.setMesaj(`Aviz ${a.nr_complet} emis, dar PDF-ul nu s-a salvat (${eroareBirou(e)}). Îl regenerezi din arhivă.`) }
    if (current()) setEmis(a)
    await refresh(current)
  })
  const pornit = () => { try { emite(construieste()) } catch (e) { ui.setMesaj(e.message) } }

  return <div style={S.card}><h3>Ieșire din depozit pe tronson · aviz de însoțire</h3>
    <div style={S.row}>
      <select style={S.input} disabled={disabled} aria-label="Depozit" value={depozit} onChange={e => setDepozit(e.target.value)}><option value="">Alege depozitul</option>{depozite.map(d => <option key={d.id} value={d.id}>{d.name || d.id}</option>)}</select>
      <label>Data avizului <input style={S.input} disabled={disabled} aria-label="Data avizului" type="date" max={ziBucuresti()} value={data} onChange={e => setData(e.target.value)} /></label>
      <span>Nr. aviz: se alocă la emitere{urmator ? <> (orientativ: <b>{urmator}</b>)</> : depozit ? <b style={{ color: G.red }}> — depozitul nu are serie de avize</b> : ''}</span>
    </div>
    {!tronson && <p style={{ color: G.red }}>Alege tronsonul de destinație (sus).</p>}
    <div style={{ ...S.row, marginTop: 10 }}>
      <input style={{ ...S.input, minWidth: 280 }} disabled={disabled || !depozit} aria-label="Caută bucăți" placeholder="Caută: serie, șarjă, DN, perete (ex. 247EK 8,8)" value={q} onChange={e => setQ(e.target.value)} />
      <button style={S.btn2} disabled={disabled || !vizibile.length} onClick={() => setIds([...new Set([...ids, ...vizibile.map(b => b.id)])].slice(0, 200))}>Selectează tot ce se vede ({vizibile.length})</button>
      <button style={S.btn2} disabled={disabled || !ids.length} onClick={() => setIds([])}>Golește selecția</button>
      <b>{tot.n} selectate · {fmtNr(tot.m, 2)} m · {fmtNr(tot.kg, 0)} kg</b>{ascunse > 0 && <span style={{ color: G.red }}>({ascunse} ascunse de filtru)</span>}
    </div>
    {depozit && <div style={S.lista}>{vizibile.map(b => <label key={b.id} style={{ display: 'block', padding: '6px 8px', borderBottom: '1px solid #E3E8ED' }}><input disabled={disabled} type="checkbox" checked={ids.includes(b.id)} onChange={e => setIds(e.target.checked ? (ids.length >= 200 ? ids : [...ids, b.id]) : ids.filter(x => x !== b.id))} /> {labelPiece(b)}{rezervari.some(r => r.bucata_id === b.id) ? ' · rezervată (regularizare)' : ''}</label>)}
      {!vizibile.length && <p style={{ padding: 8 }}>{available.length ? 'Nicio bucată nu se potrivește căutării.' : 'Nicio bucată pentru ieșire din acest depozit.'}</p>}</div>}

    <div style={{ ...S.row, marginTop: 12 }}>
      <label><input type="checkbox" disabled={disabled} checked={soferExtern} onChange={e => setSoferExtern(e.target.checked)} /> Șofer extern</label>
      {soferExtern
        ? <input style={S.input} disabled={disabled} aria-label="Nume șofer extern" placeholder="Nume și prenume șofer" maxLength={120} value={soferNume} onChange={e => setSoferNume(e.target.value)} />
        : <><select style={S.input} disabled={disabled} aria-label="Șofer" value={soferId} onChange={e => setSoferId(e.target.value)}><option value="">Alege șoferul</option>{angajati.map(a => <option key={a.id} value={a.id}>{a.name}{a.position ? ` · ${a.position}` : ''}</option>)}</select>
          <span style={{ color: G.muted }}>În această etapă șoferul semnează de mână pe avizul tipărit.</span></>}
    </div>
    <div style={{ ...S.row, marginTop: 8 }}>
      <label><input type="checkbox" disabled={disabled} checked={vehiculAlt} onChange={e => setVehiculAlt(e.target.checked)} /> Alt număr (transportator extern)</label>
      {vehiculAlt
        ? <input style={S.input} disabled={disabled} aria-label="Număr auto" placeholder="Nr. înmatriculare" maxLength={20} value={nrAuto} onChange={e => setNrAuto(e.target.value)} />
        : <select style={S.input} disabled={disabled} aria-label="Mașina" value={vehiculId} onChange={e => setVehiculId(e.target.value)}><option value="">Alege mașina</option>{vehicule.map(v => <option key={v.id} value={v.id}>{v.nr_inmatriculare} · {[v.marca, v.model].filter(Boolean).join(' ')}</option>)}</select>}
    </div>
    <div style={{ ...S.row, marginTop: 8 }}>
      <label><input type="checkbox" disabled={disabled} checked={destExtern} onChange={e => setDestExtern(e.target.checked)} /> Destinatar extern (implicit: transfer intern Gazpet)</label>
      {destExtern && <><input style={S.input} disabled={disabled} aria-label="Destinatar denumire" placeholder="Denumire firmă" maxLength={200} value={dest.denumire} onChange={e => setDest({ ...dest, denumire: e.target.value })} />
        <input style={S.input} disabled={disabled} aria-label="Destinatar CUI" placeholder="CUI" maxLength={20} value={dest.cui} onChange={e => setDest({ ...dest, cui: e.target.value })} />
        <input style={{ ...S.input, minWidth: 260 }} disabled={disabled} aria-label="Destinatar adresă" placeholder="Adresă" maxLength={300} value={dest.adresa} onChange={e => setDest({ ...dest, adresa: e.target.value })} /></>}
    </div>
    {ids.length > 0 && <div style={S.rez}><b>De emis: {tot.n} bucăți · {fmtNr(tot.m, 2)} m · {fmtNr(tot.kg, 0)} kg</b>{tot.kgLipsa ? ` · ${tot.kgLipsa} fără masă` : ''}
      <div style={{ fontSize: 12, marginTop: 4 }}>{selectate.map(b => b.serie || b.uid).join(', ')}</div></div>}
    {cerere && <div style={S.rez}>Răspuns neconfirmat de server: avizul poate fi deja emis. Reîncearcă aceeași cerere: serverul întoarce avizul existent sau îl emite acum, cu un singur număr. <button style={S.btn2} disabled={ui.busy} onClick={() => emite(cerere)}>Reîncearcă aceeași emitere (nu se dublează avizul)</button></div>}
    <div style={{ marginTop: 10 }}><button style={S.btn} disabled={disabled || !ids.length || !tronson || !depozit || Boolean(cerere)} onClick={pornit}>Emite avizul și înregistrează ieșirea ({ids.length})</button></div>
    {emis && <div style={{ ...S.rez, background: emis.stare === 'anulat' ? '#FBEAEA' : '#E5F3EA' }}>Aviz <b>{emis.nr_complet}</b>{emis.stare === 'anulat' && <b style={{ color: G.red }}> · ANULAT: {emis.anulat_motiv}</b>} · {emis.total_bucati} buc · {fmtNr(emis.total_m, 2)} m · {fmtNr(emis.total_kg, 0)} kg {emis.pdf_path && <button style={S.btn2} onClick={() => deschidePdf(emis, r => setEmis(prev => (prev && prev.id === r.id ? reconciliazaAviz(prev, r) : prev))).catch(e => ui.setMesaj(eroareBirou(e)))}>{emis.stare === 'anulat' ? 'PDF (document anulat)' : 'Deschide / tipărește PDF'}</button>}</div>}
  </div>
}

// Arhiva avizelor proiectului: filtre, PDF, regenerare (doar emitentul, cât PDF-ul lipsește), anulare cu motiv.
export function ArhivaAvize({ ui, proiectId, depozite, tronsoane = [], disabled, reincarca }) {
  const [avize, setAvize] = useState([]), [f, setF] = useState({ depozit: '', tronson: '', stare: '', de: '', pana: '' })
  const [eu, setEu] = useState(null), [anulez, setAnulez] = useState(null), [motiv, setMotiv] = useState('')
  // Ciclu propriu de încărcare (ui.run al părintelui e invalidat de efectul lui pe proiect). Orice încărcare poartă generația
  // + proiectul: un răspuns întârziat pentru alt proiect sau o încărcare mai veche nu suprascrie arhiva curentă (Jakarinos P2).
  const gen = useRef(0), proiectCurent = useRef(proiectId)
  async function incarca() {
    const g = ++gen.current, p = proiectId
    if (!p) return
    try {
      const r = await citestePagini((a, b) => supabase.from('izo_avize_iesire').select(COLOANE_AVIZ).eq('proiect_id', p).order('emis_la', { ascending: false }).range(a, b))
      if (g === gen.current && p === proiectCurent.current) setAvize(vechi => reconciliazaLista(vechi, r))
    } catch (e) { if (g === gen.current && p === proiectCurent.current) ui.setMesaj(eroareBirou(e)) }
  }
  const actualizeaza = r => { if (r.proiect_id === proiectCurent.current) setAvize(list => list.map(x => (x.id === r.id ? reconciliazaAviz(x, r) : x))) }
  useEffect(() => {
    let viu = true
    proiectCurent.current = proiectId; gen.current++
    setAvize([])
    if (proiectId) {
      incarca()
      supabase.auth.getUser().then(r => { if (viu) setEu(r.data?.user?.id || null) })
    }
    return () => { viu = false; gen.current++ }
  }, [proiectId, reincarca])
  const vizibile = avize.filter(a => (!f.depozit || String(a.depozit_id) === f.depozit) && (!f.tronson || String(a.tronson_id) === f.tronson)
    && (!f.stare || a.stare === f.stare) && (!f.de || a.data_aviz >= f.de) && (!f.pana || a.data_aviz <= f.pana))
  const numeTronson = id => tronsoane.find(t => t.id === id)?.cod || id
  const sofer = a => a.sofer_extern_nume ? `${a.sofer_extern_nume} (extern)` : (a.antet?.sofer_nume || `angajat #${a.sofer_employee_id}`)
  const anuleaza = () => ui.run(async current => {
    const { data, error } = await supabase.rpc('fn_izo_aviz_anuleaza', { p_aviz: anulez.id, p_motiv: motiv.trim() })
    if (error) throw error
    if (data && ['eroare', 'conflict'].includes(data.cod)) throw Error(data.motiv || data.cod)
    if (!current()) return
    ui.setMesaj(`Aviz ${anulez.nr_complet} anulat. Ieșirea bucăților rămâne înregistrată (se anulează separat).`); setAnulez(null); setMotiv('')
    await incarca()
  })
  return <div style={S.card}><h3>Arhiva avizelor de ieșire ({avize.length})</h3>
    <div style={S.row}>
      <select style={S.input} aria-label="Filtru depozit" value={f.depozit} onChange={e => setF({ ...f, depozit: e.target.value })}><option value="">Toate depozitele</option>{depozite.map(d => <option key={d.id} value={d.id}>{d.name || d.id}</option>)}</select>
      <select style={S.input} aria-label="Filtru tronson" value={f.tronson} onChange={e => setF({ ...f, tronson: e.target.value })}><option value="">Toate tronsoanele</option>{[...new Set(avize.map(a => a.tronson_id))].map(t => <option key={t} value={t}>{numeTronson(t)}</option>)}</select>
      <select style={S.input} aria-label="Filtru stare" value={f.stare} onChange={e => setF({ ...f, stare: e.target.value })}><option value="">Toate</option><option value="emis">Emise</option><option value="anulat">Anulate</option></select>
      <label>De la <input style={S.input} type="date" value={f.de} onChange={e => setF({ ...f, de: e.target.value })} /></label>
      <label>Până la <input style={S.input} type="date" value={f.pana} onChange={e => setF({ ...f, pana: e.target.value })} /></label>
      <button style={S.btn2} disabled={disabled} onClick={() => incarca()}>Reîncarcă</button>
    </div>
    <div style={{ overflowX: 'auto', marginTop: 8 }}><table style={{ borderCollapse: 'collapse', width: '100%' }}>
      <thead><tr>{['Nr. aviz', 'Data', 'Tronson', 'Buc', 'm', 'kg', 'Șofer · auto', 'Stare', ''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
      <tbody>{vizibile.map(a => <tr key={a.id} style={a.stare === 'anulat' ? { background: '#FBEAEA' } : null}>
        <td style={S.td}><b>{a.nr_complet}</b></td><td style={S.td}>{a.data_aviz}</td><td style={S.td}>{numeTronson(a.tronson_id)}</td>
        <td style={S.td}>{a.total_bucati}</td><td style={S.td}>{fmtNr(a.total_m, 2)}</td><td style={S.td}>{fmtNr(a.total_kg, 0)}</td>
        <td style={S.td}>{sofer(a)} · {a.nr_auto}</td>
        <td style={S.td}>{a.stare === 'anulat' ? <span style={{ color: G.red }} title={`${a.anulat_motiv} · ${a.anulat_la || ''}`}>ANULAT: {a.anulat_motiv}</span> : 'emis'}</td>
        <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
          {a.pdf_path ? <button style={S.btn2} onClick={() => deschidePdf(a, actualizeaza).catch(e => ui.setMesaj(eroareBirou(e)))}>{a.stare === 'anulat' ? 'PDF (document anulat)' : 'Deschide PDF'}</button>
            : a.emis_de === eu ? <button style={S.btn2} disabled={disabled} onClick={() => ui.run(async c => { const r = await genereazaSiAtaseaza(a.id); actualizeaza(r); if (c()) { ui.setMesaj(`PDF ${a.nr_complet} salvat.`); await incarca() } })}>PDF lipsă — regenerează</button>
            : <span style={{ color: G.muted }}>PDF lipsă (îl regenerează emitentul)</span>}
          {a.stare === 'emis' && <button style={{ ...S.btn2, marginLeft: 6 }} disabled={disabled} onClick={() => { setAnulez(a); setMotiv('') }}>Anulează</button>}
        </td></tr>)}</tbody></table>
      {!vizibile.length && <p>Niciun aviz.</p>}</div>
    {anulez && <div style={S.rez}><b>Anulezi avizul {anulez.nr_complet}?</b> Numărul rămâne ocupat, avizul apare ANULAT. Ieșirea bucăților NU se anulează aici.
      <div style={S.row}><input style={{ ...S.input, minWidth: 320 }} aria-label="Motiv anulare" placeholder="Motiv obligatoriu" maxLength={1000} value={motiv} onChange={e => setMotiv(e.target.value)} />
        <button style={S.btn} disabled={disabled || motiv.trim().length < 3} onClick={anuleaza}>Confirmă anularea</button><button style={S.btn2} onClick={() => setAnulez(null)}>Renunță</button></div></div>}
  </div>
}
