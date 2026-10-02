// ════════════════════════════════════════════════════════════════
// CtcCarti.jsx — tab „Cărți tehnice": lista cărților + creare carte nouă.
// Schema: ctc_carti / ctc_templates / ctc_template_pozitii / ctc_documente_carte (PR #548, aplicată 30.09.2026).
// O singură carte pe proiect (Q2-B). Checklist-ul se populează din template, cu pozițiile repetabile
// clonate pe tronsoane / probe. Detaliul cărții: CtcCarteDetaliu.jsx.
// ════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase.js'
import { G, inputSt, btn, Modal, Camp, STATUS_CARTE_UI, BaraProgres, fmtData, useToast } from './ctcUi.jsx'
import { creeazaCarte } from './ctcDb.js'
import { PRESETURI_TRONSON, PRESETURI_PROBA, numeProba, etichetaTronson, esteProba } from './ctcUtil.js'
import CtcCarteDetaliu from './CtcCarteDetaliu.jsx'

function ChipsUnitati({ valori, onChange, preseturi, prefixFn, placeholder, culoare }) {
  const [txt, setTxt] = useState('')
  const adauga = (eticheta) => {
    const e = String(eticheta || '').trim()
    if (!e) return
    const val = prefixFn ? prefixFn(e) : e
    if (!valori.includes(val)) onChange([...valori, val])
    setTxt('')
  }
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
        {valori.map(v => (
          <span key={v} style={{ background: culoare + '22', color: culoare, border: `1px solid ${culoare}55`, borderRadius: 14, padding: '2px 4px 2px 10px', fontSize: 12, fontWeight: 700 }}>
            {etichetaTronson(v)}
            <button onClick={() => onChange(valori.filter(x => x !== v))} style={{ background: 'none', border: 'none', color: culoare, cursor: 'pointer', fontSize: 13 }}>✕</button>
          </span>
        ))}
        {!valori.length && <span style={{ fontSize: 11.5, color: G.dim }}>niciuna (pozițiile repetabile vor apărea o singură dată)</span>}
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        <input value={txt} onChange={e => setTxt(e.target.value)} placeholder={placeholder} style={inputSt}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); adauga(txt) } }} />
        <button type="button" onClick={() => adauga(txt)} style={btn(culoare)}>Adaugă</button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {preseturi.filter(p => !valori.includes(prefixFn ? prefixFn(p) : p)).map(p => (
          <button key={p} type="button" onClick={() => adauga(p)}
            style={{ background: 'transparent', color: G.muted, border: `1px dashed ${G.border}`, borderRadius: 12, padding: '2px 9px', fontSize: 11, cursor: 'pointer' }}>+ {p}</button>
        ))}
      </div>
    </div>
  )
}

function CarteNouaModal({ proiecte, templates, proiecteCuCarte, onClose, onCreata, showToast }) {
  const [f, setF] = useState({ proiect_id: '', template_id: templates[0]?.id ? String(templates[0].id) : '', denumire_obiectiv: '', beneficiar_nume: '', numar_contract: '', data_contract: '', localitate: '', judet: '' })
  const [unitati, setUnitati] = useState([])
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const tronsoane = unitati.filter(u => !esteProba(u))
  const probe = unitati.filter(esteProba)

  const alegeProiect = (id) => {
    const p = proiecte.find(x => String(x.id) === String(id))
    setF(prev => ({
      ...prev, proiect_id: id,
      denumire_obiectiv: p ? (prev.denumire_obiectiv || p.nume || '') : prev.denumire_obiectiv,
      beneficiar_nume: p ? (prev.beneficiar_nume || p.beneficiar || '') : prev.beneficiar_nume,
      numar_contract: p ? (prev.numar_contract || p.nr_contract || '') : prev.numar_contract,
      data_contract: p ? (prev.data_contract || p.data_contract || '') : prev.data_contract,
    }))
    if (p?.beneficiar) {
      const t = templates.find(t => p.beneficiar.toLowerCase().includes(String(t.beneficiar_nume).toLowerCase()))
      if (t) set('template_id', String(t.id))
    }
  }

  const salveaza = async () => {
    if (!f.denumire_obiectiv.trim()) { showToast('Denumirea obiectivului e obligatorie.', 'error'); return }
    if (!f.template_id) { showToast('Alege un template (beneficiar).', 'error'); return }
    setBusy(true)
    try {
      const proiect = proiecte.find(x => String(x.id) === String(f.proiect_id))
      const carte = await creeazaCarte({
        proiect_id: f.proiect_id ? Number(f.proiect_id) : null,
        contract_id: proiect?.contract_id ?? null,
        template_id: Number(f.template_id),
        beneficiar_nume: f.beneficiar_nume.trim() || null,
        denumire_obiectiv: f.denumire_obiectiv.trim(),
        numar_contract: f.numar_contract.trim() || null,
        data_contract: f.data_contract || null,
        localitate: f.localitate.trim() || null,
        judet: f.judet.trim() || null,
      }, unitati)
      showToast('✓ Carte creată, checklist populat din template.')
      onCreata(carte.id)
    } catch (e) {
      const dup = /ctc_carti_proiect_unic|duplicate key/i.test(e.message)
      showToast(dup ? 'Proiectul are deja o carte tehnică.' : e.message, 'error')
      if (e.carte) onCreata(e.carte.id)   // cartea există fără poziții: se repopulează din detaliu
    } finally { setBusy(false) }
  }

  return (
    <Modal titlu="➕ Carte tehnică nouă" onClose={onClose} latime={640}>
      <Camp label="Proiect din Execuție" hint="Completează automat beneficiarul și contractul. O singură carte pe proiect.">
        <select value={f.proiect_id} onChange={e => alegeProiect(e.target.value)} style={inputSt}>
          <option value="">— fără proiect în Execuție —</option>
          {proiecte.map(p => {
            const are = proiecteCuCarte.has(p.id)
            return <option key={p.id} value={p.id} disabled={are}>{(p.cod_intern ? p.cod_intern + ' · ' : '') + (p.nume || '#' + p.id)}{are ? ' (are deja carte)' : ''}</option>
          })}
        </select>
      </Camp>
      <Camp label="Template (beneficiar)">
        <select value={f.template_id} onChange={e => set('template_id', e.target.value)} style={inputSt}>
          {!templates.length && <option value="">— niciun template activ —</option>}
          {templates.map(t => <option key={t.id} value={t.id}>{t.denumire}</option>)}
        </select>
      </Camp>
      <Camp label="Denumire obiectiv *"><input value={f.denumire_obiectiv} onChange={e => set('denumire_obiectiv', e.target.value)} style={inputSt} placeholder="Punere în siguranță subtraversare râu …" /></Camp>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Camp label="Beneficiar"><input value={f.beneficiar_nume} onChange={e => set('beneficiar_nume', e.target.value)} style={inputSt} /></Camp>
        <Camp label="Nr. contract"><input value={f.numar_contract} onChange={e => set('numar_contract', e.target.value)} style={inputSt} /></Camp>
        <Camp label="Data contract"><input type="date" value={f.data_contract || ''} onChange={e => set('data_contract', e.target.value)} style={inputSt} /></Camp>
        <Camp label="Localitate"><input value={f.localitate} onChange={e => set('localitate', e.target.value)} style={inputSt} /></Camp>
        <Camp label="Județ"><input value={f.judet} onChange={e => set('judet', e.target.value)} style={inputSt} /></Camp>
      </div>
      <Camp label="Tronsoane de execuție" hint="Pozițiile de execuție (PVLA, suduri, buletine) se repetă pe fiecare tronson. Se pot adăuga și ulterior.">
        <ChipsUnitati valori={tronsoane} onChange={v => setUnitati([...v, ...probe])} preseturi={PRESETURI_TRONSON} placeholder="ex. FOD, Mal drept, Conductă Dn400…" culoare={G.blue} />
      </Camp>
      <Camp label="Probe de presiune" hint="Fiecare probă are PV de fază determinantă + PV probă + diagramă.">
        <ChipsUnitati valori={probe} onChange={v => setUnitati([...tronsoane, ...v])} preseturi={PRESETURI_PROBA} prefixFn={numeProba} placeholder="ex. rezistență întreg fir…" culoare={G.orange} />
      </Camp>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
        <button onClick={onClose} style={btn(G.muted)}>Anulează</button>
        <button onClick={salveaza} disabled={busy} style={btn(G.ctc, true)}>{busy ? 'Se creează…' : 'Creează cartea'}</button>
      </div>
    </Modal>
  )
}

export default function CtcCarti({ profile }) {
  const { showToast, ToastEl } = useToast()
  const [carti, setCarti] = useState([])
  const [prog, setProg] = useState({})
  const [proiecte, setProiecte] = useState([])
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [deschisa, setDeschisa] = useState(null)
  const [modalNou, setModalNou] = useState(false)

  const incarca = useCallback(async () => {
    setLoading(true)
    const [rC, rG, rP, rT] = await Promise.all([
      supabase.from('ctc_carti').select('*').order('updated_at', { ascending: false }),
      supabase.from('v_ctc_carti_progres').select('*'),
      supabase.from('executie_proiecte').select('id, nume, cod_intern, beneficiar, nr_contract, data_contract, contract_id, activ').order('nume'),
      supabase.from('ctc_templates').select('*').eq('activ', true).order('beneficiar_nume'),
    ])
    const err = rC.error || rG.error || rP.error || rT.error
    if (err) showToast('Eroare la încărcare: ' + err.message, 'error')
    setCarti(rC.data || [])
    setProg(Object.fromEntries((rG.data || []).map(g => [g.carte_id, g])))
    setProiecte(rP.data || [])
    setTemplates(rT.data || [])
    setLoading(false)
  }, [])   // showToast e stabil (useCallback []); nu-l punem în deps ca să nu buclăm
  useEffect(() => { incarca() }, [incarca])

  const pjMap = useMemo(() => Object.fromEntries(proiecte.map(p => [p.id, p])), [proiecte])
  const proiecteCuCarte = useMemo(() => new Set(carti.filter(c => c.proiect_id).map(c => c.proiect_id)), [carti])
  const filtrate = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return carti
    return carti.filter(c => [c.denumire_obiectiv, c.beneficiar_nume, c.numar_contract, c.localitate, pjMap[c.proiect_id]?.cod_intern, pjMap[c.proiect_id]?.nume]
      .some(v => String(v || '').toLowerCase().includes(s)))
  }, [carti, search, pjMap])

  const kpi = useMemo(() => ({
    total: carti.length,
    inLucru: carti.filter(c => c.status === 'in_lucru').length,
    predate: carti.filter(c => c.status === 'predata').length,
    docs: Object.values(prog).reduce((s, g) => s + (g.pozitii_incarcate || 0), 0),
  }), [carti, prog])

  if (deschisa) {
    return <CtcCarteDetaliu carteId={deschisa} profile={profile} onBack={() => { setDeschisa(null); incarca() }} />
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1300, margin: '0 auto' }}>
      {ToastEl}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 12, marginBottom: 20 }}>
        {[['📑', 'Cărți tehnice', kpi.total, G.ctc], ['🛠', 'În lucru', kpi.inLucru, G.yellow], ['📦', 'Predate', kpi.predate, G.green], ['📄', 'Documente încărcate', kpi.docs, G.blue]].map(([em, lbl, val, col]) => (
          <div key={lbl} style={{ background: G.surface, border: `1px solid ${G.border}`, borderRadius: 12, padding: '14px 16px' }}>
            <div style={{ fontSize: 11, color: G.muted, fontWeight: 700, marginBottom: 6 }}>{em} {lbl.toUpperCase()}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: col }}>{val}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <button onClick={() => setModalNou(true)} style={btn(G.ctc, true)}>➕ Carte nouă</button>
        <div style={{ flex: 1 }} />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Caută carte / beneficiar / proiect / contract…"
          style={{ ...inputSt, width: 320 }} />
      </div>

      {loading && <div style={{ padding: 40, textAlign: 'center', color: G.muted }}>Se încarcă…</div>}

      {!loading && !filtrate.length && (
        <div style={{ padding: 50, textAlign: 'center', background: G.surface, borderRadius: 12, border: `1px dashed ${G.border}` }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>📑</div>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{search ? 'Nicio carte pe căutarea curentă.' : 'Nicio carte tehnică încă.'}</div>
          {!search && <div style={{ fontSize: 12, color: G.muted }}>Apasă „➕ Carte nouă": alegi proiectul, template-ul beneficiarului și tronsoanele, iar checklist-ul se populează singur.</div>}
        </div>
      )}

      {!loading && filtrate.map(c => {
        const g = prog[c.id] || {}
        const st = STATUS_CARTE_UI[c.status] || STATUS_CARTE_UI.in_lucru
        const p = pjMap[c.proiect_id]
        return (
          <div key={c.id} onClick={() => setDeschisa(c.id)} style={{ background: G.surface, border: `1px solid ${G.border}`, borderRadius: 12, padding: '14px 18px', marginBottom: 12, cursor: 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: 18 }}>📑</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.denumire_obiectiv}</div>
                <div style={{ fontSize: 11.5, color: G.muted, marginTop: 2 }}>
                  {[c.beneficiar_nume, p && (p.cod_intern || p.nume), c.numar_contract && 'contract ' + c.numar_contract, [c.localitate, c.judet].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}
                </div>
              </div>
              <span style={{ background: st.color + '22', color: st.color, border: `1px solid ${st.color}55`, borderRadius: 12, padding: '2px 11px', fontSize: 11, fontWeight: 800 }}>{st.label}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 12 }}>
              <div style={{ flex: 1 }}><BaraProgres valoare={g.pozitii_incarcate || 0} total={g.pozitii_aplicabile || 0} color={g.obligatorii_lipsa ? G.blue : G.green} /></div>
              <span style={{ fontWeight: 800, minWidth: 90 }}>{g.pozitii_incarcate || 0}/{g.pozitii_aplicabile || 0} documente</span>
              <span style={{ color: g.obligatorii_lipsa ? G.orange : G.green, minWidth: 130 }}>{g.obligatorii_lipsa ? `⚠ ${g.obligatorii_lipsa} obligatorii lipsă` : '✓ obligatorii complete'}</span>
              <span style={{ color: G.muted, minWidth: 70 }}>{g.total_pagini || 0} pag.</span>
              <span style={{ color: G.dim, minWidth: 80 }}>{fmtData(c.updated_at)}</span>
            </div>
          </div>
        )
      })}

      {modalNou && (
        <CarteNouaModal proiecte={proiecte} templates={templates} proiecteCuCarte={proiecteCuCarte} showToast={showToast}
          onClose={() => setModalNou(false)} onCreata={(id) => { setModalNou(false); setDeschisa(id) }} />
      )}
    </div>
  )
}
