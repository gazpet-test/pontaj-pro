// ===========================================================================
// MODUL HR — Tab „Recomandări" (15.09.2026, task #73 — mail Silviu Stănescu)
// Documente de experiență PER PERSOANĂ (manager de contract, șef de șantier, RTE, inginer):
// se urcă pe angajat sau pe personal extern, AI le citește (edge fn hr-recomandare-citeste),
// omul corectează și bifează „verificat". Motorul de acoperire din Ofertare le primește ca
// a cincea sursă de catalog (id-uri R) pentru cerințele de „experiență în proiect similar".
// Bucket: documente-personal, cale recomandari/<emp-<id>|ext-<id>>/<data>_<uuid>.<ext>
// ===========================================================================
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './lib/supabase.js'
import { compressFileBeforeUpload } from './utils/compressFile'

const G = {
  bg:'#0D1117', surface:'#161B22', card:'#161B22', text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  border:'#30363D', border2:'#21262D',
  blue:'#1F6FEB', green:'#2EA043', yellow:'#D29922', orange:'#F0883E', red:'#F85149', purple:'#A371F7',
  hr:'#EC6CB9',
}
const S = {
  card: { background:G.card, borderRadius:12, border:`1px solid ${G.border}` },
  input: { width:'100%', background:G.bg, border:`1px solid ${G.border}`, borderRadius:8, padding:'8px 10px', color:G.text, fontSize:13, outline:'none' },
  btnP: { padding:'8px 14px', background:G.hr, color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:600 },
  btnS: { padding:'7px 12px', background:G.surface, color:G.text, border:`1px solid ${G.border}`, borderRadius:8, cursor:'pointer', fontSize:13 },
}
const th = { padding:'9px 10px', textAlign:'left', fontSize:11, fontWeight:700, color:G.muted, textTransform:'uppercase', letterSpacing:.5, whiteSpace:'nowrap' }
const td = { padding:'9px 10px', verticalAlign:'top', fontSize:12.5 }
const BUCKET = 'documente-personal'
const ROLURI = ['manager de contract', 'șef de șantier', 'responsabil tehnic cu execuția (RTE)', 'inginer execuție', 'responsabil calitate', 'coordonator SSM', 'topograf', 'altul']
const fmtZi = (d) => d ? new Date(d).toLocaleDateString('ro-RO') : '—'
const fmtLei = (v) => (v == null || v === '') ? '' : Number(v).toLocaleString('ro-RO', { maximumFractionDigits: 0 }) + ' lei'
function caleStorage(persKey, fileName) {
  const ext = (fileName.split('.').pop() || 'pdf').toLowerCase()
  const today = new Date().toISOString().split('T')[0]
  const uuid = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10)
  return `recomandari/${persKey}/${today}_${uuid}.${ext}`
}

// #1399: natura obiectivului — decide ce se numără la o cerință pe distribuție / transport (regula transport→distribuție din triere)
const NATURI = ['transport', 'distributie', 'titei', 'apa_canal', 'altele']
const NATURA_ET = { transport: 'transport gaze', distributie: 'distribuție gaze', titei: 'țiței', apa_canal: 'apă-canal', altele: 'altele' }
const NATURA_SCURT = { transport: 'T', distributie: 'D', titei: 'Ț', apa_canal: 'A', altele: '?' }
function Lbl({ children }) { return <div style={{ fontSize:11, color:G.muted, fontWeight:700, marginBottom:3, textTransform:'uppercase', letterSpacing:.4 }}>{children}</div> }

// ─── Modal adăugare / editare ──────────────────────────────────────────────
function ModalRecomandare({ rec, employees, externi, canEdit, onClose, onSaved, showToast }) {
  const isNew = !rec?.id
  const [pers, setPers] = useState(rec?.employee_id ? `emp-${rec.employee_id}` : (rec?.extern_id ? `ext-${rec.extern_id}` : ''))
  const [f, setF] = useState({
    rol: rec?.rol || '', beneficiar: rec?.beneficiar || '', obiect_lucrare: rec?.obiect_lucrare || '',
    perioada_start: rec?.perioada_start || '', perioada_end: rec?.perioada_end || '', valoare_lei: rec?.valoare_lei ?? '',
    domenii: (rec?.domenii || []).join(', '), nr_document: rec?.nr_document || '', data_document: rec?.data_document || '',
    semnatar: rec?.semnatar || '', calificativ: rec?.calificativ || '', observatii: rec?.observatii || '',
  })
  // #1399: obiectivele structurate — câte un rând per obiectiv/contract; de aici numără trierea/acoperirea
  const [ob, setOb] = useState(Array.isArray(rec?.obiective) ? rec.obiective.map(o => ({ denumire: o.denumire || '', an: o.an ?? '', natura: o.natura || 'altele', beneficiar_final: o.beneficiar_final || '' })) : [])
  const setObRand = (i, k) => (e) => setOb(x => x.map((o, j) => j === i ? { ...o, [k]: e.target.value } : o))
  const [file, setFile] = useState(null)
  const [citesteAI, setCitesteAI] = useState(true)
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setF(x => ({ ...x, [k]: e.target.value }))

  const salveaza = async () => {
    if (!pers) { showToast('Alege persoana', 'warn'); return }
    if (isNew && !file) { showToast('Atașează recomandarea (PDF/JPG/PNG)', 'warn'); return }
    if (file && file.size > 20 * 1024 * 1024) { showToast('Fișierul depășește 20 MB', 'error'); return }
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    const [tip, idStr] = pers.split('-')
    const payload = {
      employee_id: tip === 'emp' ? Number(idStr) : null, extern_id: tip === 'ext' ? Number(idStr) : null,
      rol: f.rol || null, beneficiar: f.beneficiar || null, obiect_lucrare: f.obiect_lucrare || null,
      perioada_start: f.perioada_start || null, perioada_end: f.perioada_end || null,
      valoare_lei: f.valoare_lei === '' ? null : Number(String(f.valoare_lei).replace(/[^\d.]/g, '')) || null,
      domenii: f.domenii ? f.domenii.split(',').map(s => s.trim()).filter(Boolean) : null,
      nr_document: f.nr_document || null, data_document: f.data_document || null,
      semnatar: f.semnatar || null, calificativ: f.calificativ || null, observatii: f.observatii || null,
      obiective: ob.filter(o => o.denumire.trim()).length
        ? ob.filter(o => o.denumire.trim()).map(o => ({ denumire: o.denumire.trim().slice(0, 200), an: o.an === '' ? null : (Number(o.an) || null), natura: NATURI.includes(o.natura) ? o.natura : 'altele', beneficiar_final: o.beneficiar_final.trim() || null }))
        : null,
      updated_at: new Date().toISOString(),
    }
    if (file) {
      const path = caleStorage(pers, file.name)
      const comprimat = await compressFileBeforeUpload(file)
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, comprimat, { contentType: comprimat.type || file.type, upsert: false })
      if (upErr) { setSaving(false); showToast('Eroare upload: ' + upErr.message, 'error'); return }
      Object.assign(payload, { fisier_path: path, fisier_nume: file.name, fisier_mime: comprimat.type || file.type })
    }
    let id = rec?.id
    if (isNew) {
      const { data, error } = await supabase.from('hr_recomandari').insert({ ...payload, created_by: user?.id || null }).select('id').single()
      if (error) { setSaving(false); showToast('Eroare: ' + error.message, 'error'); return }
      id = data.id
    } else {
      const { error } = await supabase.from('hr_recomandari').update(payload).eq('id', id)
      if (error) { setSaving(false); showToast('Eroare: ' + error.message, 'error'); return }
    }
    if (file && citesteAI) {
      showToast('Salvat. AI citește recomandarea…', 'info')
      const { data: r, error: eFn } = await supabase.functions.invoke('hr-recomandare-citeste', { body: { recomandare_id: id } })
      if (eFn) showToast('Citire AI: ' + eFn.message, 'warn')
      else if (r?.error || r?.eroare) showToast('Citire AI: ' + (r.error || r.eroare), 'warn')
      else showToast(`AI: ${r.extras?.rol || '?'} la ${r.extras?.beneficiar || '?'} (încredere ${r.incredere})${r.avertisment ? ' — ' + r.avertisment : ''}`, r.avertisment ? 'warn' : 'success')
    } else showToast(isNew ? 'Recomandare adăugată' : 'Salvat', 'success')
    setSaving(false); onSaved()
  }

  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'#000a', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
      <div onClick={e => e.stopPropagation()} style={{ ...S.card, width:'min(760px, 100%)', maxHeight:'92vh', overflow:'auto', padding:18 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
          <b style={{ fontSize:15 }}>{isNew ? '📜 Recomandare nouă' : '📜 Editare recomandare'}</b>
          <button onClick={onClose} style={{ ...S.btnS, padding:'4px 10px' }}>✕</button>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          <div style={{ gridColumn:'1 / -1' }}><Lbl>Persoana recomandată</Lbl>
            <select value={pers} onChange={e => setPers(e.target.value)} disabled={!isNew} style={S.input}>
              <option value="">— alege —</option>
              <optgroup label="Angajați">{employees.map(e => <option key={'emp-' + e.id} value={'emp-' + e.id}>{e.name}{e.functie ? ' · ' + e.functie : ''}</option>)}</optgroup>
              <optgroup label="Personal extern">{externi.map(x => <option key={'ext-' + x.id} value={'ext-' + x.id}>{x.nume}{x.functie ? ' · ' + x.functie : ''}{x.firma ? ' (' + x.firma + ')' : ''}</option>)}</optgroup>
            </select>
          </div>
          <div><Lbl>Rolul în lucrare</Lbl><input list="roluri-rec" value={f.rol} onChange={set('rol')} placeholder="ex. șef de șantier" style={S.input} /><datalist id="roluri-rec">{ROLURI.map(r => <option key={r} value={r} />)}</datalist></div>
          <div><Lbl>Beneficiar (cine recomandă)</Lbl><input value={f.beneficiar} onChange={set('beneficiar')} style={S.input} /></div>
          <div style={{ gridColumn:'1 / -1' }}><Lbl>Lucrarea / contractul</Lbl><input value={f.obiect_lucrare} onChange={set('obiect_lucrare')} style={S.input} /></div>
          <div style={{ gridColumn:'1 / -1' }}>
            <Lbl>Obiective enumerate ({ob.length}) — câte unul pe rând; de aici numără trierea punctajul</Lbl>
            {ob.map((o, i) => (
              <div key={i} style={{ display:'grid', gridTemplateColumns:'1fr 130px 80px 1fr 28px', gap:6, marginBottom:4 }}>
                <input value={o.denumire} onChange={setObRand(i, 'denumire')} placeholder="obiectivul / contractul" style={S.input} />
                <select value={o.natura} onChange={setObRand(i, 'natura')} style={S.input}>{NATURI.map(n => <option key={n} value={n}>{NATURA_ET[n]}</option>)}</select>
                <input value={o.an} onChange={setObRand(i, 'an')} placeholder="an" style={S.input} />
                <input value={o.beneficiar_final} onChange={setObRand(i, 'beneficiar_final')} placeholder="beneficiar final (dacă diferă)" style={S.input} />
                <button type="button" onClick={() => setOb(x => x.filter((_, j) => j !== i))} style={{ ...S.btnS, padding:'2px 6px', color:G.red }} title="scoate rândul">✕</button>
              </div>
            ))}
            <button type="button" onClick={() => setOb(x => [...x, { denumire:'', an:'', natura:'altele', beneficiar_final:'' }])} style={{ ...S.btnS, fontSize:12 }}>+ obiectiv</button>
            {!ob.length && <span style={{ fontSize:11, color:G.dim, marginLeft:8 }}>gol = trierea numără din textul lucrării (mai puțin sigur)</span>}
          </div>
          <div><Lbl>Perioada — de la</Lbl><input type="date" value={f.perioada_start} onChange={set('perioada_start')} style={S.input} /></div>
          <div><Lbl>Perioada — până la</Lbl><input type="date" value={f.perioada_end} onChange={set('perioada_end')} style={S.input} /></div>
          <div><Lbl>Valoare lucrare (lei)</Lbl><input value={f.valoare_lei} onChange={set('valoare_lei')} placeholder="doar dacă scrie în document" style={S.input} /></div>
          <div><Lbl>Domenii (virgulă)</Lbl><input value={f.domenii} onChange={set('domenii')} placeholder="apa-canal, gaze, drumuri" style={S.input} /></div>
          <div><Lbl>Nr. document</Lbl><input value={f.nr_document} onChange={set('nr_document')} style={S.input} /></div>
          <div><Lbl>Data documentului</Lbl><input type="date" value={f.data_document} onChange={set('data_document')} style={S.input} /></div>
          <div><Lbl>Semnatar (nume, funcție)</Lbl><input value={f.semnatar} onChange={set('semnatar')} style={S.input} /></div>
          <div><Lbl>Calificativ</Lbl><input value={f.calificativ} onChange={set('calificativ')} style={S.input} /></div>
          <div style={{ gridColumn:'1 / -1' }}><Lbl>Observații</Lbl><textarea value={f.observatii} onChange={set('observatii')} style={{ ...S.input, minHeight:52 }} /></div>
          <div style={{ gridColumn:'1 / -1' }}><Lbl>{isNew ? 'Fișier (PDF/JPG/PNG)' : 'Înlocuiește fișierul (opțional)'}</Lbl>
            <input type="file" accept=".pdf,image/*" onChange={e => setFile(e.target.files?.[0] || null)} style={{ fontSize:12, color:G.text }} />
            {rec?.fisier_nume && !file && <div style={{ fontSize:11, color:G.dim, marginTop:3 }}>actual: {rec.fisier_nume}</div>}
            <label style={{ display:'flex', gap:6, alignItems:'center', fontSize:12, color:G.muted, marginTop:6 }}>
              <input type="checkbox" checked={citesteAI} onChange={e => setCitesteAI(e.target.checked)} /> după salvare, AI citește documentul și completează câmpurile (costă puțin; poți corecta după)
            </label>
          </div>
        </div>
        <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:14 }}>
          <button onClick={onClose} style={S.btnS}>Renunț</button>
          <button onClick={salveaza} disabled={saving || !canEdit} style={{ ...S.btnP, opacity: saving || !canEdit ? .6 : 1 }}>{saving ? 'Se salvează…' : 'Salvează'}</button>
        </div>
      </div>
    </div>
  )
}

// ─── Tab ───────────────────────────────────────────────────────────────────
export default function HrRecomandari({ profile, employees = [], canEdit, showToast }) {
  const [lista, setLista] = useState([])
  const [externi, setExterni] = useState([])
  const [load, setLoad] = useState(true)
  const [q, setQ] = useState('')
  const [doarNeverif, setDoarNeverif] = useState(false)
  const [modal, setModal] = useState(null) // null | 'nou' | rec
  const [busy, setBusy] = useState(null)
  const [toate, setToate] = useState(null)   // {facute, din} cât rulează citirea în serie
  const opresc = useRef(false)              // „Oprește" — ref, ca să fie citit sigur între două citiri

  const reload = async () => {
    setLoad(true)
    const [{ data: r }, { data: x }] = await Promise.all([
      supabase.from('hr_recomandari').select('*, emp:employees(name, functie), ext:hr_personal_extern(nume, functie, firma)').eq('activ', true).order('created_at', { ascending: false }).limit(2000),
      supabase.from('hr_personal_extern').select('id, nume, functie, firma').eq('activ', true).order('nume'),
    ])
    setLista(r || []); setExterni(x || []); setLoad(false)
  }
  useEffect(() => { reload() }, [])

  const numePers = (r) => r.emp?.name || r.ext?.nume || '?'
  const filtrate = useMemo(() => {
    const t = q.trim().toLowerCase()
    return lista.filter(r => (!doarNeverif || !r.verificat) && (!t || [numePers(r), r.rol, r.beneficiar, r.obiect_lucrare, (r.domenii || []).join(' ')].join(' ').toLowerCase().includes(t)))
  }, [lista, q, doarNeverif])

  const deschide = async (r) => {
    if (!r.fisier_path) return
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(r.fisier_path, 60)
    if (error) { showToast('Nu pot deschide: ' + error.message, 'error'); return }
    window.open(data.signedUrl, '_blank')
  }
  const citeste = async (r) => {
    setBusy(r.id)
    const { data, error } = await supabase.functions.invoke('hr-recomandare-citeste', { body: { recomandare_id: r.id } })
    setBusy(null)
    if (error) { showToast('Citire AI: ' + error.message, 'error'); return }
    if (data?.error || data?.eroare) { showToast('Citire AI: ' + (data.error || data.eroare), 'warn'); await reload(); return }
    showToast(`AI: ${data.extras?.rol || '?'} · ${data.extras?.beneficiar || '?'} (încredere ${data.incredere})${data.avertisment ? ' — ' + data.avertisment : ''}`, data.avertisment ? 'warn' : 'success')
    await reload()
  }
  // 17.09.2026: citirea în serie a celor necitite. E un buton care CHELTUIE de N ori dintr-un
  // singur clic, așa că: spune exact câte și cât înainte, merge una câte una (nu în paralel —
  // ar lovi rate limit-ul și n-ai ști care a picat), se poate opri din mers, iar la final
  // raportează pe bune ce-a ieșit. Nu bifează nimic „verificat": aia rămâne mâna omului.
  // „Necitit" nu inseamna doar `ai_citit_la IS NULL`: o incercare esuata SCRIE data citirii si un
  // avertisment, deci randul ramanea in afara filtrului si nu mai era reluat niciodata. De citit =
  // n-a fost citit vreodata SAU a fost, dar n-a iesit nimic din el.
  const nuAreNimic = (r) => !r.rol && !r.beneficiar && !r.obiect_lucrare
  const deCititAcum = (r) => r.fisier_path && (!r.ai_citit_la || nuAreNimic(r))

  const citesteToate = async (tot = false) => {
    const deCitit = filtrate.filter(r => r.fisier_path && (tot || deCititAcum(r)))
    if (!deCitit.length) { showToast('Nimic de citit — toate cele afișate au fost deja citite', 'warn'); return }
    // 0,07 $ e media MASURATA pe primele 25 de citiri reale (1,74 $ / 25), nu o estimare din burta.
    // Documentele groase trag media in sus: un pachet de 11 pagini costa de cateva ori cat unul de o pagina.
    const cost = (deCitit.length * 0.07).toFixed(2)
    if (!window.confirm(
      (tot
        ? `RECITESC cu AI toate cele ${deCitit.length} recomandări afișate, inclusiv pe cele deja citite.\n\n`
        : `Citesc cu AI ${deCitit.length} recomandări necitite sau eșuate din cele afișate acum.\n\n`) +
      `Costă aproximativ ${cost} $ (media măsurată: 0,07 $ pe document; un pachet gros costă mai mult). Merge una câte una și poți opri pe parcurs.\n\n` +
      `Un fișier poate conține mai multe scrisori: cele în plus apar ca rânduri noi, legate de acesta.\n` +
      `Câmpurile completate de AI rămân NEVERIFICATE — tot tu bifezi ✓ la final.`)) return
    let facute = 0, erori = 0, slabe = 0, dinPachete = 0
    opresc.current = false
    setToate({ facute: 0, din: deCitit.length })
    for (const r of deCitit) {
      if (opresc.current) break
      try {
        const { data, error } = await supabase.functions.invoke('hr-recomandare-citeste', { body: { recomandare_id: r.id } })
        if (error || data?.error || data?.eroare) erori++
        else { facute++; dinPachete += (data.randuri_noi || 0); if ((data.incredere ?? 0) < 60 || data.avertisment) slabe++ }
      } catch (e) { erori++ }
      setToate(t => t ? { ...t, facute: facute + erori } : t)
    }
    const oprit = opresc.current
    opresc.current = false
    setToate(null)
    await reload()
    showToast(
      `Citite ${facute} din ${deCitit.length}` + (oprit ? ' (oprit de tine)' : '') + (dinPachete ? ` · +${dinPachete} scrisori găsite în aceleași fișiere` : '') + (erori ? ` · ${erori} cu eroare` : '') +
      (slabe ? ` · ${slabe} de verificat cu ochiul (încredere mică sau avertisment)` : ''),
      erori || slabe ? 'warn' : 'success')
  }

  // #1399: structurează obiectivele din textul deja citit (fără fișier — apel mic, ~0,01 $/rând); omul corectează după
  const structureaza = async (tot = false) => {
    const deFacut = filtrate.filter(r => (r.obiect_lucrare || r.text_extras) && (tot || !(Array.isArray(r.obiective) && r.obiective.length)))
    if (!deFacut.length) { showToast('Toate cele afișate au deja obiectivele structurate', 'warn'); return }
    if (!window.confirm(`Structurez obiectivele (câte un rând per obiectiv, cu natura transport/distribuție) pentru ${deFacut.length} recomandări${tot ? ' — inclusiv cele deja structurate' : ''}, din textul citit deja. Cost ~${(deFacut.length * 0.01).toFixed(2)} $. Rămân de verificat de om.`)) return
    let ok = 0, erori = 0
    opresc.current = false
    setToate({ facute: 0, din: deFacut.length })
    for (const r of deFacut) {
      if (opresc.current) break
      try {
        const { data, error } = await supabase.functions.invoke('hr-recomandare-citeste', { body: { recomandare_id: r.id, doar_obiective: true } })
        if (error || data?.error || data?.eroare) erori++; else ok++
      } catch (e) { erori++ }
      setToate(t => t ? { ...t, facute: ok + erori } : t)
    }
    opresc.current = false; setToate(null); await reload()
    showToast(`Obiective structurate: ${ok} din ${deFacut.length}` + (erori ? ` · ${erori} cu eroare` : ''), erori ? 'warn' : 'success')
  }

  const verifica = async (r) => {
    const { error } = await supabase.from('hr_recomandari').update({ verificat: !r.verificat, verificat_de: r.verificat ? null : (profile?.id || null), verificat_la: r.verificat ? null : new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', r.id)
    if (error) { showToast('Eroare: ' + error.message, 'error'); return }
    await reload()
  }
  const sterge = async (r) => {
    if (!window.confirm(`Scoți recomandarea „${r.obiect_lucrare || r.fisier_nume || r.id}" a lui ${numePers(r)}? (rămâne în BD, inactivă)`)) return
    const { error } = await supabase.from('hr_recomandari').update({ activ: false, updated_at: new Date().toISOString() }).eq('id', r.id)
    if (error) { showToast('Eroare: ' + error.message, 'error'); return }
    await reload()
  }

  const nrNeverif = lista.filter(r => !r.verificat).length
  return (
    <div>
      <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap', marginBottom:12 }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="caută persoană, rol, beneficiar, lucrare, domeniu…" style={{ ...S.input, width:340 }} />
        <label style={{ fontSize:12, color:G.muted, display:'flex', gap:6, alignItems:'center' }}><input type="checkbox" checked={doarNeverif} onChange={e => setDoarNeverif(e.target.checked)} /> doar neverificate ({nrNeverif})</label>
        <span style={{ fontSize:12, color:G.dim }}>{filtrate.length} din {lista.length}</span>
        <span style={{ flex:1 }} />
        {canEdit && (toate
          ? <>
              <span style={{ fontSize:12, color:G.yellow, fontWeight:700 }}>🤖 citesc… {toate.facute}/{toate.din}</span>
              <button onClick={() => { opresc.current = true }} style={{ ...S.btnS, color:G.orange, borderColor:G.orange+'55' }}>Oprește</button>
            </>
          : <>
              <button onClick={() => citesteToate(false)} style={{ ...S.btnS, color:G.purple, borderColor:G.purple+'55', fontWeight:600 }}
                title="AI citește, una câte una, recomandările afișate care n-au fost citite sau la care citirea n-a scos nimic. Costă — îți spune câte și cât înainte.">
                🤖 Citește necitite ({filtrate.filter(deCititAcum).length})
              </button>
              <button onClick={() => citesteToate(true)} style={{ ...S.btnS, color:G.dim, fontSize:12 }}
                title="Recitește TOT ce e afișat, inclusiv ce a fost deja citit — util după ce cititorul a fost îmbunătățit. Costă de fiecare dată.">
                ↻ recitește tot ({filtrate.filter(r => r.fisier_path).length})
              </button>
            </>)}
        {canEdit && !toate && <button onClick={() => structureaza(false)} style={{ ...S.btnS, color:G.dim, fontSize:12 }} title="Din textul citit deja, fără fișier: câte un rând per obiectiv, cu natura (transport / distribuție). Ieftin. Tu verifici după.">
          ⊞ structurează obiectivele ({filtrate.filter(r => (r.obiect_lucrare || r.text_extras) && !(Array.isArray(r.obiective) && r.obiective.length)).length})
        </button>}
        {canEdit && <button onClick={() => setModal('nou')} style={S.btnP} disabled={!!toate}>+ Recomandare</button>}
      </div>
      <div style={{ fontSize:11.5, color:G.dim, marginBottom:10 }}>
        Recomandările sunt dovada de <b>experiență a persoanei</b> (manager de contract, șef de șantier, RTE…) cerută la licitații. Le urci aici, AI le citește, tu le verifici ✓ — motorul din Ofertare le propune singur pe cerințele de „experiență în proiect similar".
      </div>
      {load ? <div style={{ color:G.muted, padding:20 }}>Se încarcă…</div> : (
        <div style={{ ...S.card, overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr style={{ borderBottom:`1px solid ${G.border}` }}>
              <th style={th}>Persoana</th><th style={th}>Rol</th><th style={th}>Beneficiar / lucrare</th><th style={th}>Perioada</th><th style={th}>Valoare</th><th style={th}>Domenii</th><th style={th}>AI</th><th style={th}>Verificat</th><th style={th}></th>
            </tr></thead>
            <tbody>
              {filtrate.map(r => (
                <tr key={r.id} style={{ borderBottom:`1px solid ${G.border2}`, background: r.ai_avertisment ? G.red + '12' : undefined }}>
                  <td style={td}><b>{numePers(r)}</b><div style={{ fontSize:11, color:G.dim }}>{r.emp?.functie || r.ext?.functie || ''}{r.ext ? ' · extern' : ''}</div></td>
                  <td style={td}>{r.rol || <span style={{ color:G.dim }}>—</span>}</td>
                  <td style={td}><div>{r.beneficiar || <span style={{ color:G.dim }}>—</span>}</div><div style={{ fontSize:11.5, color:G.muted }}>{r.obiect_lucrare}</div>{Array.isArray(r.obiective) && r.obiective.length > 0 && (() => { const n = {}; r.obiective.forEach(o => { n[o.natura] = (n[o.natura] || 0) + 1 }); return <div style={{ fontSize:11, color:G.green, marginTop:2 }} title={r.obiective.map((o, i) => `${i + 1}. ${o.denumire}${o.an ? ' ' + o.an : ''} [${NATURA_ET[o.natura] || o.natura}]`).join('\n')}>⊞ {r.obiective.length} obiective · {Object.entries(n).map(([k, v]) => `${NATURA_SCURT[k] || '?'}${v}`).join(' ')}</div> })()}{r.ai_avertisment && <div style={{ fontSize:11, color:G.red, marginTop:2 }}>⚠ {r.ai_avertisment}</div>}</td>
                  <td style={{ ...td, whiteSpace:'nowrap' }}>{fmtZi(r.perioada_start)} → {fmtZi(r.perioada_end)}</td>
                  <td style={{ ...td, whiteSpace:'nowrap' }}>{fmtLei(r.valoare_lei)}</td>
                  <td style={td}>{(r.domenii || []).map(d => <span key={d} style={{ fontSize:10.5, border:`1px solid ${G.border}`, borderRadius:8, padding:'1px 6px', marginRight:4 }}>{d}</span>)}</td>
                  <td style={{ ...td, whiteSpace:'nowrap' }}>{r.parinte_id ? <span title={r.observatii || 'extrasă dintr-un fișier cu mai multe scrisori'} style={{ fontSize:10, fontWeight:800, color:G.blue, border:`1px solid ${G.blue}55`, borderRadius:8, padding:'1px 5px', marginRight:5 }}>📎 din pachet</span> : null}{r.ai_citit_la ? <span title={`citit ${new Date(r.ai_citit_la).toLocaleString('ro-RO')}`} style={{ color: (r.ai_confidenta || 0) >= 80 ? G.green : G.orange, fontWeight:700 }}>🤖 {r.ai_confidenta ?? '?'}</span> : <span style={{ color:G.dim }}>necitit</span>}</td>
                  <td style={td}><button onClick={() => canEdit && verifica(r)} title={r.verificat ? `verificat ${fmtZi(r.verificat_la)} — click pentru a anula` : 'bifează după ce ai comparat câmpurile cu documentul'} style={{ ...S.btnS, padding:'3px 8px', fontSize:12, color: r.verificat ? G.green : G.muted, borderColor: r.verificat ? G.green + '66' : G.border }}>{r.verificat ? '✓ verificat' : '○ neverificat'}</button></td>
                  <td style={{ ...td, whiteSpace:'nowrap' }}>
                    <button onClick={() => deschide(r)} disabled={!r.fisier_path} style={{ ...S.btnS, padding:'3px 8px', fontSize:12, marginRight:4 }} title={r.fisier_nume || ''}>📎</button>
                    {canEdit && <button onClick={() => citeste(r)} disabled={busy === r.id || !r.fisier_path} style={{ ...S.btnS, padding:'3px 8px', fontSize:12, marginRight:4 }} title="AI citește (re)documentul — costă puțin">{busy === r.id ? '…' : '🤖'}</button>}
                    {canEdit && <button onClick={() => setModal(r)} style={{ ...S.btnS, padding:'3px 8px', fontSize:12, marginRight:4 }}>✏️</button>}
                    {canEdit && <button onClick={() => sterge(r)} style={{ ...S.btnS, padding:'3px 8px', fontSize:12, color:G.red }}>🗑</button>}
                  </td>
                </tr>
              ))}
              {!filtrate.length && <tr><td colSpan={9} style={{ ...td, color:G.dim, textAlign:'center', padding:24 }}>Nicio recomandare{lista.length ? ' pe filtrul ăsta' : ' încă — apasă „+ Recomandare"'}.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {modal && <ModalRecomandare rec={modal === 'nou' ? null : modal} employees={employees} externi={externi} canEdit={canEdit} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload() }} showToast={showToast} />}
    </div>
  )
}
