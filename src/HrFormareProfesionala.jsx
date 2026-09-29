// ===========================================================================
// MODUL HR — „Formare profesională (2 ani)" (TKT-2026-0198, 28.09.2026)
// „Legea cere societății, aspect inclus și în CCM, să trimită la curs de calificare toți angajații
// la fiecare 2 ani. Doamna Mary ar dori un tabel în care, în baza calificărilor din ERP, să avem
// data la care angajatul a fost la curs." — Codul muncii art. 194 (≥21 salariați: cel puțin o dată
// la 2 ani). Răzvan a ales varianta „Registru formare": tabel nou `hr_formare_profesionala`.
//
// Scadența = ultimul curs + 24 luni; fără niciun curs, termenul curge de la data angajării.
// Certificatele de calificare din dosarele personale apar ca sugestie („📁 în dosar"), dar intră
// în registru doar când omul confirmă (buton „↳ adaugă"): data unui certificat nu e automat un curs.
// TKT-2026-0303 (30.09): la fel, cea mai recentă autorizație emisă (INSEMEX, RSVTI, ISCIR, SSM…) apare ca
// sugestie „📜 autorizație" — tot cu confirmare; fișele medicale și permisele nu sunt cursuri.
// Drepturi (RLS pe tabel): citire autentificați; scriere owner / can_modify_employees / superadmin /
// departamentele HR și Administrativ — aceleași ca la autorizații.
// ===========================================================================
import { useCallback, useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx-js-style'
import { supabase } from './lib/supabase.js'
import { calificariDetectate, imparteNume, normTxt } from './HrDiplomeCalificari.jsx'

const G = {
  bg:'#0D1117', surface:'#161B22', card:'#161B22', text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  border:'#30363D', border2:'#21262D',
  blue:'#1F6FEB', green:'#2EA043', yellow:'#D29922', orange:'#F0883E', red:'#F85149', purple:'#A371F7',
  hr:'#EC6CB9',
}
const S = {
  card: { background:G.card, borderRadius:12, border:`1px solid ${G.border}` },
  input: { width:'100%', background:G.bg, border:`1px solid ${G.border}`, borderRadius:8, padding:'8px 10px', color:G.text, fontSize:13, outline:'none', boxSizing:'border-box' },
  btnP: { padding:'8px 14px', background:G.hr, color:'#0D1117', border:'none', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:700 },
  btnS: { padding:'7px 12px', background:G.surface, color:G.text, border:`1px solid ${G.border}`, borderRadius:8, cursor:'pointer', fontSize:13 },
}
const th = { padding:'9px 10px', textAlign:'left', fontSize:11, fontWeight:700, color:G.muted, textTransform:'uppercase', letterSpacing:.5, whiteSpace:'nowrap' }
const td = { padding:'8px 10px', verticalAlign:'top', fontSize:12.5 }
const lbl = { fontSize:11, color:G.muted, fontWeight:700, marginBottom:4, display:'block' }

export const PERIOADA_LUNI = 24     // art. 194 Codul muncii, firme cu ≥21 salariați
export const PRAG_CURAND_ZILE = 60

const fmt = (d) => d ? new Date(d).toLocaleDateString('ro-RO') : '—'
const azi0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }
const isoAzi = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) }
export const plusLuni = (iso, n) => { const d = new Date(iso); d.setHours(0, 0, 0, 0); d.setMonth(d.getMonth() + n); return d }

// Starea unui angajat: 'depasit' | 'curand' | 'in_termen' | 'fara_date'
export function stareFormare(ultimCurs, dataAngajare, azi = azi0()) {
  const baza = ultimCurs || dataAngajare || null
  if (!baza) return { stare:'fara_date', scadenta:null, zile:null }
  const scadenta = plusLuni(baza, PERIOADA_LUNI)
  const zile = Math.round((scadenta - azi) / 86400000)
  return { stare: zile < 0 ? 'depasit' : zile <= PRAG_CURAND_ZILE ? 'curand' : 'in_termen', scadenta, zile }
}

const STARI = {
  depasit:   { label:'Depășit',            color:G.red,    ord:0 },
  curand:    { label:`Sub ${PRAG_CURAND_ZILE} zile`, color:G.orange, ord:1 },
  fara_date: { label:'Fără curs, fără dată angajare', color:G.yellow, ord:2 },
  in_termen: { label:'În termen',          color:G.green,  ord:3 },
}

const FORM_GOL = { employeeIds:[], data_curs:'', tema:'', tip_autorizatie_id:'', furnizor:'', numar_certificat:'', durata_ore:'', observatii:'' }

// Autorizații care nu vin dintr-un curs de formare (TKT-2026-0303)
const CATEGORII_FARA_CURS = new Set(['medical', 'altele'])
const nuEDinCurs = (a) => CATEGORII_FARA_CURS.has(a.tip_categorie) || /^(permis|card tahograf|declara)/i.test((a.tip_denumire || '').trim())

export default function HrFormareProfesionala({ employees = [], autorizatii = [], tipuri = [], profile, canAccessPersonal = false, showToast }) {
  const [cursuri, setCursuri] = useState([])
  const [loading, setLoading] = useState(true)
  const [dinDosar, setDinDosar] = useState({})        // employee_id → { data, fisier_nume, calificari }
  const [filtru, setFiltru] = useState('toate')
  const [cauta, setCauta] = useState('')
  const [selectie, setSelectie] = useState(() => new Set())
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [deschis, setDeschis] = useState(null)

  const canEdit = profile?.is_owner === true || profile?.can_modify_employees === true || profile?.role === 'superadmin'
    || ['HR', 'Administrativ'].includes(profile?.department)

  const incarca = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.from('hr_formare_profesionala')
      .select('*').order('data_curs', { ascending:false }).limit(20000)
    if (error) showToast?.('Eroare la citirea registrului: ' + error.message, 'error')
    setCursuri(data || [])
    setLoading(false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- fără showToast în deps (anti-bug)
  useEffect(() => { incarca() }, [incarca])

  // Sugestii din dosar (doar cine vede datele personale — RLS): cel mai recent certificat de calificare
  useEffect(() => {
    if (!canAccessPersonal) return
    let anulat = false
    supabase.from('hr_documente_personale')
      .select('employee_id, data_emitere, fisier_nume, observatii, tip:hr_documente_personale_tipuri!inner(cod)')
      .in('tip.cod', ['cert_calificare', 'supliment_calificare']).eq('activ', true).is('deleted_at', null)
      .not('data_emitere', 'is', null).lte('data_emitere', isoAzi()).limit(5000)
      .then(({ data }) => {
        if (anulat || !data) return
        const m = {}
        for (const d of data) {
          if (!m[d.employee_id] || d.data_emitere > m[d.employee_id].data)
            m[d.employee_id] = { data: d.data_emitere, fisier_nume: d.fisier_nume, calificari: calificariDetectate(d) }
        }
        setDinDosar(m)
      })
    return () => { anulat = true }
  }, [canAccessPersonal])

  const cursuriDupaAngajat = useMemo(() => {
    const m = new Map()
    for (const c of cursuri) { if (!m.has(c.employee_id)) m.set(c.employee_id, []); m.get(c.employee_id).push(c) }
    return m
  }, [cursuri])
  const calificariDupaAngajat = useMemo(() => {
    const m = new Map()
    for (const a of autorizatii) {
      if (!a.tip_denumire) continue
      if (!m.has(a.employee_id)) m.set(a.employee_id, new Set())
      m.get(a.employee_id).add(a.tip_denumire)
    }
    return m
  }, [autorizatii])
  // TKT-2026-0303: cea mai recentă autorizație emisă (nu expirarea), ca sugestie de curs
  const autDupaAngajat = useMemo(() => {
    const m = {}, azi = isoAzi()
    for (const a of autorizatii) {
      if (!a.data_emitere || a.data_emitere > azi || nuEDinCurs(a)) continue
      if (!m[a.employee_id] || a.data_emitere > m[a.employee_id].data)
        m[a.employee_id] = { data: a.data_emitere, tip_id: a.tip_id, tip_denumire: a.tip_denumire, emitent: a.emitent,
          numar: a.numar_autorizatie, fisier_nume: a.fisier_nume }
    }
    return m
  }, [autorizatii])
  const numeTip = useMemo(() => Object.fromEntries(tipuri.map(t => [t.id, t.denumire])), [tipuri])

  const randuri = useMemo(() => {
    const azi = azi0()
    return employees.filter(e => e.active !== false).map(e => {
      const lista = cursuriDupaAngajat.get(e.id) || []      // deja sortate desc după dată
      const ultim = lista[0] || null
      const st = stareFormare(ultim?.data_curs, e.hire_date, azi)
      const dosar = dinDosar[e.id]
      const aut = autDupaAngajat[e.id]
      return {
        e, ...imparteNume(e.name), lista, ultim, ...st,
        faraCurs: !ultim,
        calificari: [...(calificariDupaAngajat.get(e.id) || [])],
        dosar: dosar && (!ultim || dosar.data > ultim.data_curs) ? dosar : null,
        autorizatie: aut && (!ultim || aut.data > ultim.data_curs) ? aut : null,
      }
    })
  }, [employees, cursuriDupaAngajat, calificariDupaAngajat, dinDosar, autDupaAngajat])

  const numarare = useMemo(() => {
    const n = { toate: randuri.length, depasit:0, curand:0, in_termen:0, fara_date:0, fara_curs:0 }
    for (const r of randuri) { n[r.stare]++; if (r.faraCurs) n.fara_curs++ }
    return n
  }, [randuri])

  const vizibile = useMemo(() => {
    const s = normTxt(cauta.trim())
    return randuri
      .filter(r => filtru === 'toate' || (filtru === 'fara_curs' ? r.faraCurs : r.stare === filtru))
      .filter(r => !s || normTxt(`${r.e.name} ${r.e.functie || r.e.position || ''} ${r.calificari.join(' ')} ${r.ultim?.tema || ''}`).includes(s))
      .sort((a, b) => STARI[a.stare].ord - STARI[b.stare].ord || (a.zile ?? -1e9) - (b.zile ?? -1e9) || a.nume.localeCompare(b.nume, 'ro'))
  }, [randuri, filtru, cauta])

  const toateSelectate = vizibile.length > 0 && vizibile.every(r => selectie.has(r.e.id))
  const comutaSel = (id) => setSelectie(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const comutaToate = () => setSelectie(prev => {
    const n = new Set(prev)
    if (toateSelectate) vizibile.forEach(r => n.delete(r.e.id)); else vizibile.forEach(r => n.add(r.e.id))
    return n
  })

  const deschideForm = (employeeIds, dosar = null) => {
    const cal = dosar?.calificari?.length ? `Calificare ${dosar.calificari[0].toLowerCase()}` : ''
    setForm({ ...FORM_GOL, employeeIds, data_curs: dosar?.data || '', tema: cal,
      observatii: dosar?.fisier_nume ? `Din dosar: ${dosar.fisier_nume}` : '' })
  }
  const deschideFormAut = (employeeIds, aut) => {
    setForm({ ...FORM_GOL, employeeIds, data_curs: aut.data, tema: aut.tip_denumire || '',
      tip_autorizatie_id: aut.tip_id ? String(aut.tip_id) : '', furnizor: aut.emitent || '', numar_certificat: aut.numar || '',
      observatii: `Din autorizația: ${aut.fisier_nume || aut.tip_denumire || ''}` })
  }

  const salveaza = async () => {
    if (!form?.employeeIds?.length) return
    if (!form.data_curs) { showToast?.('Completează data cursului', 'error'); return }
    if (form.data_curs > isoAzi()) { showToast?.('Data cursului nu poate fi în viitor — registrul ține cursurile făcute', 'error'); return }
    if (form.data_curs < '1950-01-01') { showToast?.('Dată invalidă', 'error'); return }
    if (!form.tema.trim()) { showToast?.('Completează tema cursului / calificarea', 'error'); return }
    const ore = form.durata_ore === '' ? null : Number(String(form.durata_ore).replace(',', '.'))
    if (ore !== null && !(ore > 0)) { showToast?.('Durata în ore trebuie să fie un număr pozitiv', 'error'); return }
    setSaving(true)
    try {
      const rows = form.employeeIds.map(id => ({
        employee_id: id, data_curs: form.data_curs, tema: form.tema.trim(),
        tip_autorizatie_id: form.tip_autorizatie_id ? Number(form.tip_autorizatie_id) : null,
        furnizor: form.furnizor.trim() || null, numar_certificat: form.numar_certificat.trim() || null,
        durata_ore: ore, observatii: form.observatii.trim() || null,
      }))
      const { error } = await supabase.from('hr_formare_profesionala').insert(rows)
      if (error) throw error
      showToast?.(`✅ Curs înregistrat pentru ${rows.length} ${rows.length === 1 ? 'angajat' : 'angajați'}`, 'success')
      setForm(null); setSelectie(new Set())
      await incarca()
    } catch (e) {
      showToast?.('Eroare la salvare: ' + (e.message || e), 'error')
    } finally { setSaving(false) }
  }

  const sterge = async (c, numeAngajat) => {
    if (!window.confirm(`Ștergi cursul „${c.tema}" din ${fmt(c.data_curs)} pentru ${numeAngajat}?`)) return
    const { error } = await supabase.from('hr_formare_profesionala').delete().eq('id', c.id)
    if (error) { showToast?.('Eroare: ' + error.message, 'error'); return }
    showToast?.('Curs șters din registru', 'success')
    incarca()
  }

  const exportXlsx = () => {
    if (!vizibile.length) { showToast?.('Nimic de exportat', 'warning'); return }
    const rows = vizibile.map(r => ({
      'Nume': r.nume, 'Prenume': r.prenume, 'Funcție': r.e.functie || r.e.position || '',
      'Calificări în ERP': r.calificari.join(', '),
      'Data angajării': r.e.hire_date ? fmt(r.e.hire_date) : '',
      'Ultimul curs': r.ultim ? fmt(r.ultim.data_curs) : 'niciunul',
      'Tema': r.ultim?.tema || '', 'Furnizor': r.ultim?.furnizor || '',
      'Scadență următor curs': r.scadenta ? fmt(r.scadenta) : '',
      'Stare': STARI[r.stare].label + (r.faraCurs && r.stare !== 'fara_date' ? ' (fără curs în registru)' : ''),
      'În dosar (certificat)': r.dosar ? `${fmt(r.dosar.data)} — ${r.dosar.fisier_nume || ''}` : '',
      'Autorizație recentă': r.autorizatie ? `${fmt(r.autorizatie.data)} — ${r.autorizatie.tip_denumire || ''}${r.autorizatie.emitent ? ` (${r.autorizatie.emitent})` : ''}` : '',
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = [{wch:18},{wch:22},{wch:20},{wch:36},{wch:12},{wch:12},{wch:32},{wch:24},{wch:14},{wch:26},{wch:44},{wch:44}]
    Object.keys(rows[0]).forEach((_, i) => {
      const cell = ws[XLSX.utils.encode_cell({ r: 0, c: i })]
      if (cell) cell.s = { font: { bold: true }, fill: { fgColor: { rgb: 'E8EEF7' } } }
    })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Formare 2 ani')
    XLSX.writeFile(wb, `formare_profesionala_${isoAzi()}.xlsx`)
    showToast?.(`${rows.length} angajați exportați`, 'success')
  }

  const chip = (key, label, color) => {
    const sel = filtru === key
    return (
      <button key={key} onClick={() => setFiltru(key)} style={{
        padding:'7px 14px', borderRadius:18, fontSize:12.5, cursor:'pointer', fontWeight: sel ? 800 : 600,
        border:`1px solid ${sel ? color : G.border}`, background: sel ? color + '22' : 'transparent', color: sel ? color : G.text,
      }}>{label} <span style={{ opacity:.8 }}>({numarare[key] ?? 0})</span></button>
    )
  }

  return (
    <div>
      <div style={{ ...S.card, padding:14, marginBottom:14 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, flexWrap:'wrap' }}>
          <div>
            <div style={{ fontSize:15, fontWeight:800, color:G.hr }}>🎓 Formare profesională — la fiecare {PERIOADA_LUNI / 12} ani</div>
            <div style={{ fontSize:11.5, color:G.muted, marginTop:3, maxWidth:760 }}>
              Codul muncii art. 194 și CCM: fiecare angajat merge la un curs de formare/calificare cel puțin o dată la 2 ani.
              Scadența se calculează de la ultimul curs din registru; fără curs, de la data angajării.
              {canAccessPersonal && ' „📁 în dosar" = certificat de calificare găsit în dosarul personal — intră în registru doar dacă îl confirmi.'}
              {' „📜 autorizație" = cea mai recentă autorizație emisă (ex. INSEMEX, RSVTI, ISCIR) — tot sugestie, intră în registru doar dacă o confirmi.'}
            </div>
          </div>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            {canEdit && selectie.size > 0 && (
              <button onClick={() => deschideForm([...selectie])} style={S.btnP}>➕ Curs pentru {selectie.size} {selectie.size === 1 ? 'angajat' : 'angajați'}</button>
            )}
            <button onClick={exportXlsx} disabled={!vizibile.length}
              style={{ padding:'8px 13px', background:G.green, color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontSize:12, fontWeight:700, opacity: vizibile.length ? 1 : .5 }}>
              ⬇ Export Excel ({vizibile.length})
            </button>
          </div>
        </div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginTop:12 }}>
          {chip('toate', 'Toți', G.hr)}
          {chip('depasit', '🔴 Depășit', G.red)}
          {chip('curand', `🟠 Sub ${PRAG_CURAND_ZILE} zile`, G.orange)}
          {chip('in_termen', '🟢 În termen', G.green)}
          {chip('fara_curs', '⚪ Fără niciun curs în registru', G.yellow)}
          {numarare.fara_date > 0 && chip('fara_date', '❓ Fără dată de angajare', G.yellow)}
        </div>
        <input value={cauta} onChange={e => setCauta(e.target.value)} placeholder="🔍 Caută angajat, funcție, calificare, temă curs…" style={{ ...S.input, marginTop:10 }} />
      </div>

      {form && (
        <div style={{ ...S.card, padding:14, marginBottom:14, borderColor:G.hr + '66' }}>
          <div style={{ fontSize:13.5, fontWeight:800, color:G.hr, marginBottom:10 }}>
            ➕ Curs pentru {form.employeeIds.length === 1
              ? (employees.find(e => e.id === form.employeeIds[0])?.name || '1 angajat')
              : `${form.employeeIds.length} angajați`}
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))', gap:10 }}>
            <div><label style={lbl}>Data cursului *</label>
              <input type="date" value={form.data_curs} max={isoAzi()} onChange={e => setForm(f => ({ ...f, data_curs: e.target.value }))} style={S.input} /></div>
            <div style={{ gridColumn:'span 2' }}><label style={lbl}>Tema / calificarea *</label>
              <input list="formare-teme" value={form.tema} onChange={e => setForm(f => ({ ...f, tema: e.target.value }))} placeholder="ex. Perfecționare lăcătuș mecanic" style={S.input} />
              <datalist id="formare-teme">{tipuri.filter(t => t.activ !== false).map(t => <option key={t.id} value={t.denumire} />)}</datalist></div>
            <div><label style={lbl}>Legat de calificarea din ERP</label>
              <select value={form.tip_autorizatie_id} onChange={e => setForm(f => ({ ...f, tip_autorizatie_id: e.target.value }))} style={S.input}>
                <option value="">— (opțional)</option>
                {tipuri.filter(t => t.activ !== false).map(t => <option key={t.id} value={t.id}>{t.denumire}</option>)}
              </select></div>
            <div><label style={lbl}>Furnizor curs</label>
              <input value={form.furnizor} onChange={e => setForm(f => ({ ...f, furnizor: e.target.value }))} placeholder="ex. A.S.S.D. Dâmbovița" style={S.input} /></div>
            <div><label style={lbl}>Nr. certificat / adeverință</label>
              <input value={form.numar_certificat} onChange={e => setForm(f => ({ ...f, numar_certificat: e.target.value }))} style={S.input} /></div>
            <div><label style={lbl}>Durata (ore)</label>
              <input value={form.durata_ore} onChange={e => setForm(f => ({ ...f, durata_ore: e.target.value }))} inputMode="decimal" style={S.input} /></div>
            <div style={{ gridColumn:'1 / -1' }}><label style={lbl}>Observații</label>
              <input value={form.observatii} onChange={e => setForm(f => ({ ...f, observatii: e.target.value }))} style={S.input} /></div>
          </div>
          {form.employeeIds.length > 1 && (
            <div style={{ fontSize:11, color:G.muted, marginTop:8 }}>Se creează câte un rând pentru fiecare dintre cei {form.employeeIds.length} angajați selectați, cu aceleași date.</div>
          )}
          <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:12 }}>
            <button onClick={() => setForm(null)} disabled={saving} style={S.btnS}>Renunță</button>
            <button onClick={salveaza} disabled={saving} style={{ ...S.btnP, opacity: saving ? .6 : 1 }}>{saving ? '⏳ Se salvează…' : '💾 Salvează în registru'}</button>
          </div>
        </div>
      )}

      <div style={{ ...S.card, overflow:'hidden' }}>
        {loading ? (
          <div style={{ padding:30, textAlign:'center', color:G.muted }}>⏳ Se încarcă registrul…</div>
        ) : (
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead style={{ background:G.bg }}>
                <tr>
                  {canEdit && <th style={{ ...th, width:30 }}><input type="checkbox" checked={toateSelectate} onChange={comutaToate} title="Selectează toți cei afișați" /></th>}
                  <th style={th}>Angajat</th><th style={th}>Calificări în ERP</th><th style={th}>Ultimul curs</th>
                  <th style={th}>Scadență</th><th style={th}>Stare</th><th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {vizibile.map(r => {
                  const st = STARI[r.stare]
                  return [
                    <tr key={r.e.id} style={{ borderTop:`1px solid ${G.border}`, background: selectie.has(r.e.id) ? G.hr + '0D' : 'transparent' }}>
                      {canEdit && <td style={td}><input type="checkbox" checked={selectie.has(r.e.id)} onChange={() => comutaSel(r.e.id)} /></td>}
                      <td style={td}>
                        <div style={{ fontWeight:700 }}>{r.e.name}</div>
                        <div style={{ fontSize:10.5, color:G.muted }}>{r.e.functie || r.e.position || '—'}{r.e.hire_date ? ` · angajat ${fmt(r.e.hire_date)}` : ''}</div>
                      </td>
                      <td style={{ ...td, fontSize:11.5 }}>
                        {r.calificari.length ? r.calificari.slice(0, 3).join(', ') + (r.calificari.length > 3 ? ` +${r.calificari.length - 3}` : '') : <span style={{ color:G.dim }}>—</span>}
                      </td>
                      <td style={td}>
                        {r.ultim ? (
                          <>
                            <div style={{ fontWeight:600 }}>{fmt(r.ultim.data_curs)}</div>
                            <div style={{ fontSize:11, color:G.muted }}>{r.ultim.tema}{r.ultim.furnizor ? ` · ${r.ultim.furnizor}` : ''}</div>
                          </>
                        ) : <span style={{ color:G.yellow, fontSize:12 }}>niciun curs în registru</span>}
                        {r.dosar && (
                          <div style={{ fontSize:10.5, color:G.blue, marginTop:3 }} title={r.dosar.fisier_nume || ''}>
                            📁 în dosar: certificat {fmt(r.dosar.data)}
                            {canEdit && <button onClick={() => deschideForm([r.e.id], r.dosar)} style={{ marginLeft:6, padding:'0 6px', background:'transparent', border:`1px solid ${G.blue}55`, borderRadius:4, color:G.blue, fontSize:10, cursor:'pointer' }}>↳ adaugă</button>}
                          </div>
                        )}
                        {r.autorizatie && (
                          <div style={{ fontSize:10.5, color:G.purple, marginTop:3 }} title={r.autorizatie.fisier_nume || ''}>
                            📜 autorizație: {r.autorizatie.tip_denumire} {fmt(r.autorizatie.data)}
                            {canEdit && <button onClick={() => deschideFormAut([r.e.id], r.autorizatie)} style={{ marginLeft:6, padding:'0 6px', background:'transparent', border:`1px solid ${G.purple}55`, borderRadius:4, color:G.purple, fontSize:10, cursor:'pointer' }}>↳ adaugă</button>}
                          </div>
                        )}
                      </td>
                      <td style={td}>
                        {r.scadenta ? (
                          <>
                            <div style={{ fontWeight:600 }}>{fmt(r.scadenta)}</div>
                            <div style={{ fontSize:10.5, color: r.zile < 0 ? G.red : G.muted }}>{r.zile < 0 ? `depășit cu ${-r.zile} zile` : `peste ${r.zile} zile`}{r.faraCurs ? ' (de la angajare)' : ''}</div>
                          </>
                        ) : <span style={{ color:G.dim }}>—</span>}
                      </td>
                      <td style={td}>
                        <span style={{ padding:'2px 8px', borderRadius:10, fontSize:11, fontWeight:700, background: st.color + '22', color: st.color, whiteSpace:'nowrap' }}>{st.label}</span>
                      </td>
                      <td style={{ ...td, textAlign:'right', whiteSpace:'nowrap' }}>
                        {r.lista.length > 0 && (
                          <button onClick={() => setDeschis(d => d === r.e.id ? null : r.e.id)} style={{ ...S.btnS, padding:'3px 8px', fontSize:11 }}>
                            {deschis === r.e.id ? '▾' : '▸'} Istoric ({r.lista.length})
                          </button>
                        )}
                        {canEdit && <button onClick={() => deschideForm([r.e.id])} style={{ ...S.btnS, padding:'3px 8px', fontSize:11, marginLeft:6, color:G.hr, borderColor:G.hr + '55' }}>+ Curs</button>}
                      </td>
                    </tr>,
                    deschis === r.e.id && (
                      <tr key={r.e.id + '_ist'}>
                        <td colSpan={canEdit ? 7 : 6} style={{ padding:'4px 14px 12px 44px', background:G.bg }}>
                          {r.lista.map(c => (
                            <div key={c.id} style={{ display:'flex', gap:10, alignItems:'center', fontSize:12, padding:'5px 0', borderBottom:`1px solid ${G.border2}` }}>
                              <span style={{ fontWeight:700, minWidth:86 }}>{fmt(c.data_curs)}</span>
                              <span style={{ flex:1 }}>{c.tema}
                                <span style={{ color:G.muted }}>
                                  {c.tip_autorizatie_id && numeTip[c.tip_autorizatie_id] ? ` · ${numeTip[c.tip_autorizatie_id]}` : ''}
                                  {c.furnizor ? ` · ${c.furnizor}` : ''}{c.numar_certificat ? ` · nr. ${c.numar_certificat}` : ''}
                                  {c.durata_ore ? ` · ${c.durata_ore} h` : ''}{c.observatii ? ` · ${c.observatii}` : ''}
                                </span>
                              </span>
                              {canEdit && <button onClick={() => sterge(c, r.e.name)} title="Șterge din registru" style={{ padding:'2px 7px', background:G.red + '18', color:G.red, border:`1px solid ${G.red}44`, borderRadius:4, fontSize:11, cursor:'pointer' }}>🗑</button>}
                            </div>
                          ))}
                        </td>
                      </tr>
                    ),
                  ]
                })}
              </tbody>
            </table>
            {vizibile.length === 0 && <div style={{ padding:30, textAlign:'center', color:G.muted }}>Niciun angajat pentru filtrul ales.</div>}
          </div>
        )}
      </div>
    </div>
  )
}
