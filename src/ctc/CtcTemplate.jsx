// ════════════════════════════════════════════════════════════════
// CtcTemplate.jsx — tab „Template-uri": editarea template-urilor de carte tehnică per beneficiar.
// Modificările afectă DOAR cărțile create după (cele existente își păstrează checklist-ul, copiat la creare).
// Un template nou se face prin copierea celui selectat (ex. Distrigaz pornind de la Transgaz).
// ════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase.js'
import { G, inputSt, btn, btnMic, Modal, Camp, useToast } from './ctcUi.jsx'

const ok = (res, ctx) => { if (res.error) throw new Error(`${ctx}: ${res.error.message}`); return res.data }

function NouModal({ sursa, onClose, onCreat, showToast }) {
  const [f, setF] = useState({ beneficiar_nume: '', denumire: '' })
  const [busy, setBusy] = useState(false)
  const salveaza = async () => {
    if (!f.beneficiar_nume.trim() || !f.denumire.trim()) { showToast('Beneficiarul și denumirea sunt obligatorii.', 'error'); return }
    setBusy(true)
    try {
      const nou = ok(await supabase.from('ctc_templates').insert({ beneficiar_nume: f.beneficiar_nume.trim(), denumire: f.denumire.trim(), activ: true, observatii: sursa ? `Copie după: ${sursa.denumire}` : null }).select().single(), 'Creare template')
      if (sursa) {
        const poz = ok(await supabase.from('ctc_template_pozitii').select('*').eq('template_id', sursa.id).order('ordine'), 'Citire poziții')
        if (poz.length) {
          ok(await supabase.from('ctc_template_pozitii').insert(poz.map(p => ({
            template_id: nou.id, categorie: p.categorie, denumire_document: p.denumire_document, ordine: p.ordine,
            obligatoriu: p.obligatoriu, repetabil: p.repetabil, observatii: p.observatii,
          }))), 'Copiere poziții')
        }
      }
      showToast(sursa ? '✓ Template creat, cu pozițiile copiate.' : '✓ Template creat.')
      onCreat(nou.id)
    } catch (e) { showToast(e.message, 'error') } finally { setBusy(false) }
  }
  return (
    <Modal titlu={sursa ? `➕ Template nou (copie după „${sursa.denumire}")` : '➕ Template nou'} onClose={onClose} latime={520}>
      <Camp label="Beneficiar *"><input value={f.beneficiar_nume} onChange={e => setF({ ...f, beneficiar_nume: e.target.value })} style={inputSt} placeholder="ex. Distrigaz Sud" autoFocus /></Camp>
      <Camp label="Denumire template *"><input value={f.denumire} onChange={e => setF({ ...f, denumire: e.target.value })} style={inputSt} placeholder="ex. Distrigaz — rețea distribuție" /></Camp>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onClose} style={btn(G.muted)}>Anulează</button>
        <button onClick={salveaza} disabled={busy} style={btn(G.ctc, true)}>{busy ? 'Se creează…' : 'Creează'}</button>
      </div>
    </Modal>
  )
}

export default function CtcTemplate() {
  const { showToast, ToastEl } = useToast()
  const [templates, setTemplates] = useState([])
  const [sel, setSel] = useState(null)
  const [poz, setPoz] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalNou, setModalNou] = useState(false)

  const incarcaTemplates = useCallback(async (alege) => {
    setLoading(true)
    const { data, error } = await supabase.from('ctc_templates').select('*').order('beneficiar_nume')
    if (error) showToast('Eroare la încărcare: ' + error.message, 'error')
    const t = data || []
    setTemplates(t)
    setSel(prev => alege ?? prev ?? t[0]?.id ?? null)
    setLoading(false)
  }, [])   // showToast stabil; nu în deps
  useEffect(() => { incarcaTemplates() }, [incarcaTemplates])

  useEffect(() => {
    if (!sel) { setPoz([]); return }
    (async () => {
      const { data, error } = await supabase.from('ctc_template_pozitii').select('*').eq('template_id', sel).order('ordine').order('id')
      if (error) showToast('Eroare la poziții: ' + error.message, 'error')
      setPoz(data || [])
    })()
  }, [sel])

  const template = templates.find(t => t.id === sel)
  const categorii = useMemo(() => [...new Set(poz.map(p => p.categorie))], [poz])
  const sortate = useMemo(() => [...poz].sort((a, b) => a.ordine - b.ordine || a.id - b.id), [poz])

  const salveazaPoz = async (p, patch) => {
    try {
      const { data, error } = await supabase.from('ctc_template_pozitii').update(patch).eq('id', p.id).select().single()
      if (error) throw error
      setPoz(prev => prev.map(x => (x.id === p.id ? data : x)))
    } catch (e) { showToast('Eroare la salvare: ' + e.message, 'error') }
  }
  const adauga = async () => {
    try {
      const max = poz.reduce((m, p) => Math.max(m, p.ordine), 0)
      const ultima = sortate[sortate.length - 1]
      const { data, error } = await supabase.from('ctc_template_pozitii').insert({
        template_id: sel, categorie: ultima?.categorie || 'Altele', denumire_document: 'Poziție nouă', ordine: max + 10, obligatoriu: false, repetabil: false,
      }).select().single()
      if (error) throw error
      setPoz(prev => [...prev, data])
    } catch (e) { showToast('Eroare la adăugare: ' + e.message, 'error') }
  }
  const sterge = async (p) => {
    if (!window.confirm(`Ștergi poziția „${p.denumire_document}” din template?\nCărțile existente nu sunt afectate.`)) return
    try {
      const { error } = await supabase.from('ctc_template_pozitii').delete().eq('id', p.id)
      if (error) throw error
      setPoz(prev => prev.filter(x => x.id !== p.id))
    } catch (e) { showToast('Eroare la ștergere: ' + e.message, 'error') }
  }
  const comutaActiv = async () => {
    try {
      const { data, error } = await supabase.from('ctc_templates').update({ activ: !template.activ }).eq('id', template.id).select().single()
      if (error) throw error
      setTemplates(prev => prev.map(t => (t.id === data.id ? data : t)))
    } catch (e) { showToast('Eroare: ' + e.message, 'error') }
  }
  const redenumeste = async (denumire) => {
    const d = denumire.trim()
    if (!d || d === template.denumire) return
    try {
      const { data, error } = await supabase.from('ctc_templates').update({ denumire: d }).eq('id', template.id).select().single()
      if (error) throw error
      setTemplates(prev => prev.map(t => (t.id === data.id ? data : t)))
    } catch (e) { showToast('Eroare: ' + e.message, 'error') }
  }

  const celula = { padding: '5px 6px' }
  return (
    <div style={{ padding: '24px 28px', maxWidth: 1300, margin: '0 auto' }}>
      {ToastEl}
      <div style={{ background: G.card2, border: `1px solid ${G.border}`, borderRadius: 10, padding: '10px 14px', fontSize: 12, color: G.muted, marginBottom: 16 }}>
        💡 Template-ul se copiază în fiecare carte nouă. Ce modifici aici se vede doar la cărțile create <b>după</b>; cărțile existente își păstrează checklist-ul.
        <b> Repetabil</b> = poziția se repetă pe fiecare tronson sau probă a cărții.
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <select value={sel ?? ''} onChange={e => setSel(Number(e.target.value))} style={{ ...inputSt, width: 340 }}>
          {!templates.length && <option value="">— niciun template —</option>}
          {templates.map(t => <option key={t.id} value={t.id}>{t.denumire}{t.activ ? '' : ' (inactiv)'}</option>)}
        </select>
        {template && (
          <input key={template.id} defaultValue={template.denumire} onBlur={e => redenumeste(e.target.value)} title="Denumire template" style={{ ...inputSt, width: 340 }} />
        )}
        {template && <button onClick={comutaActiv} style={btn(template.activ ? G.yellow : G.green)}>{template.activ ? '⏸ Dezactivează' : '▶ Activează'}</button>}
        <div style={{ flex: 1 }} />
        <button onClick={() => setModalNou(true)} style={btn(G.ctc, true)}>{template ? '➕ Template nou (copie)' : '➕ Template nou'}</button>
      </div>

      {loading && <div style={{ padding: 40, textAlign: 'center', color: G.muted }}>Se încarcă…</div>}

      {template && (
        <div style={{ background: G.surface, border: `1px solid ${G.border}`, borderRadius: 12, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <colgroup><col style={{ width: 70 }} /><col style={{ width: 220 }} /><col /><col style={{ width: 80 }} /><col style={{ width: 80 }} /><col style={{ width: 240 }} /><col style={{ width: 44 }} /></colgroup>
            <thead>
              <tr style={{ background: G.card2, color: G.muted, fontSize: 11, textTransform: 'uppercase' }}>
                {['Ordine', 'Categorie', 'Document', 'Oblig.', 'Repet.', 'Observații', ''].map(h => <th key={h} style={{ ...celula, textAlign: 'left', padding: '9px 6px' }}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {sortate.map(p => (
                <tr key={p.id} style={{ borderTop: `1px solid ${G.border}` }}>
                  <td style={celula}><input type="number" defaultValue={p.ordine} key={p.id + ':o' + p.ordine} style={{ ...inputSt, padding: '4px 6px' }}
                    onBlur={e => { const n = Math.round(Number(e.target.value)); if (Number.isFinite(n) && n !== p.ordine) salveazaPoz(p, { ordine: n }) }} /></td>
                  <td style={celula}><input list="ctc-categorii" defaultValue={p.categorie} key={p.id + ':c' + p.categorie} style={{ ...inputSt, padding: '4px 6px' }}
                    onBlur={e => { const v = e.target.value.trim(); if (v && v !== p.categorie) salveazaPoz(p, { categorie: v }) }} /></td>
                  <td style={celula}><input defaultValue={p.denumire_document} key={p.id + ':d' + p.denumire_document} style={{ ...inputSt, padding: '4px 6px' }}
                    onBlur={e => { const v = e.target.value.trim(); if (v && v !== p.denumire_document) salveazaPoz(p, { denumire_document: v }) }} /></td>
                  <td style={{ ...celula, textAlign: 'center' }}><input type="checkbox" checked={!!p.obligatoriu} onChange={e => salveazaPoz(p, { obligatoriu: e.target.checked })} /></td>
                  <td style={{ ...celula, textAlign: 'center' }}><input type="checkbox" checked={!!p.repetabil} onChange={e => salveazaPoz(p, { repetabil: e.target.checked })} /></td>
                  <td style={celula}><input defaultValue={p.observatii || ''} key={p.id + ':n' + (p.observatii || '')} style={{ ...inputSt, padding: '4px 6px' }}
                    onBlur={e => { const v = e.target.value.trim() || null; if (v !== (p.observatii || null)) salveazaPoz(p, { observatii: v }) }} /></td>
                  <td style={celula}><button onClick={() => sterge(p)} style={btnMic(G.red)} title="Șterge poziția din template">🗑</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <datalist id="ctc-categorii">{categorii.map(c => <option key={c} value={c} />)}</datalist>
          <div style={{ padding: 12, borderTop: `1px solid ${G.border}`, display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={adauga} style={btn(G.ctc)}>➕ Poziție</button>
            <span style={{ fontSize: 12, color: G.muted }}>{poz.length} poziții · {poz.filter(p => p.obligatoriu).length} obligatorii · {poz.filter(p => p.repetabil).length} repetabile</span>
          </div>
        </div>
      )}

      {modalNou && <NouModal sursa={template} showToast={showToast} onClose={() => setModalNou(false)}
        onCreat={async (id) => { setModalNou(false); await incarcaTemplates(id) }} />}
    </div>
  )
}
