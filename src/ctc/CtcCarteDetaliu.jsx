// ════════════════════════════════════════════════════════════════
// CtcCarteDetaliu.jsx — o carte tehnică: checklist pe tronsoane/probe, upload PDF, N/A, verificat,
// „📎 din arhivă" (document din comenzile furnizor, prin referință), borderou PDF, ZIP cu documentele.
// Borderoul se numerotează doar pe pozițiile cu fișier; paginarea pornește după paginile borderoului.
// PDF unificat (concatenare) = F2, Edge Function cu pdf-lib.
// ════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase.js'
import { G, inputSt, btn, btnMic, Modal, Camp, STATUS_DOC_UI, STATUS_CARTE_UI, BaraProgres, fmtData, fmtMb, useToast } from './ctcUi.jsx'
import {
  actualizeazaDoc, adaugaPozitie, stergePozitie, incarcaFisier, ataseazaDinArhiva, scoateFisier, urlSemnat,
  populeazaCarte, adaugaUnitate, BUCKET_CTC,
} from './ctcDb.js'
import {
  grupeazaDocumente, progres, borderouCarte, calculeazaMutare, numeProba, PRESETURI_TRONSON, PRESETURI_PROBA, STATUSE_CARTE, esteProba, etichetaTronson,
} from './ctcUtil.js'
import { genereazaBorderouPdf, construiesteZip, descarcaBlob } from './ctcExport.js'

const FILTRE = [
  ['toate', 'Toate'], ['lipsa', 'Lipsă'], ['incarcat', 'Încărcate'], ['verificat', 'Verificate'], ['na', 'N/A'], ['oblig', 'Obligatorii lipsă'],
]

function ArhivaPicker({ carte, docs, onAlege, onClose }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [doarProiect, setDoarProiect] = useState(!!carte.proiect_id)
  const [search, setSearch] = useState('')
  useEffect(() => {
    (async () => {
      const [rD, rC, rF] = await Promise.all([
        supabase.from('comenzi_furnizor_documente').select('*').order('uploadat_la', { ascending: false }),
        supabase.from('comenzi_furnizor').select('id, numar_comanda, furnizor_id, proiect_id'),
        supabase.from('logistica_furnizori').select('id, nume'),
      ])
      const cm = Object.fromEntries((rC.data || []).map(c => [c.id, c]))
      const fz = Object.fromEntries((rF.data || []).map(f => [f.id, f.nume]))
      setRows((rD.data || []).map(d => ({ ...d, _cmd: cm[d.comanda_id]?.numar_comanda || '#' + d.comanda_id, _proiectId: cm[d.comanda_id]?.proiect_id || null, _furnizor: fz[cm[d.comanda_id]?.furnizor_id] || '—' })))
      setLoading(false)
    })()
  }, [])
  const folosite = useMemo(() => new Set(docs.map(d => d.cfd_id).filter(Boolean)), [docs])
  const vizibile = useMemo(() => {
    let l = rows
    if (doarProiect && carte.proiect_id) l = l.filter(r => r._proiectId === carte.proiect_id)
    const s = search.trim().toLowerCase()
    if (s) l = l.filter(r => [r.fisier_nume, r._furnizor, r._cmd, r.tip].some(v => String(v || '').toLowerCase().includes(s)))
    return l.slice(0, 120)
  }, [rows, doarProiect, search, carte.proiect_id])
  return (
    <Modal titlu="📎 Atașează din arhiva comenzilor furnizor" onClose={onClose} latime={760}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 fișier / furnizor / comandă…" style={{ ...inputSt, flex: 1, minWidth: 200 }} />
        {carte.proiect_id && (
          <label style={{ fontSize: 12, color: G.muted, display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={doarProiect} onChange={e => setDoarProiect(e.target.checked)} /> doar proiectul cărții
          </label>
        )}
      </div>
      {loading && <div style={{ color: G.muted, padding: 20, textAlign: 'center' }}>Se încarcă…</div>}
      {!loading && !vizibile.length && <div style={{ color: G.muted, padding: 20, textAlign: 'center' }}>Niciun document găsit.</div>}
      <div style={{ maxHeight: '55vh', overflowY: 'auto' }}>
        {vizibile.map(r => (
          <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '70px 1fr 140px 120px 90px', gap: 8, alignItems: 'center', padding: '7px 4px', borderBottom: `1px solid ${G.border}`, fontSize: 12 }}>
            <span style={{ color: G.muted, fontWeight: 700 }}>{r.tip}</span>
            <span title={r.fisier_nume} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.fisier_nume || r.fisier_path}</span>
            <span style={{ color: G.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>🏭 {r._furnizor}</span>
            <span style={{ color: G.dim, fontFamily: 'monospace' }}>🛒 {r._cmd}</span>
            {folosite.has(r.id)
              ? <span style={{ color: G.green, fontSize: 11 }}>✓ atașat</span>
              : <button onClick={() => onAlege(r)} style={btnMic(G.blue)}>Atașează</button>}
          </div>
        ))}
      </div>
    </Modal>
  )
}

function UnitateModal({ onClose, onAdauga }) {
  const [tip, setTip] = useState('tronson')
  const [eticheta, setEticheta] = useState('')
  const preseturi = tip === 'tronson' ? PRESETURI_TRONSON : PRESETURI_PROBA
  return (
    <Modal titlu="➕ Tronson / probă nouă" onClose={onClose} latime={520}>
      <Camp label="Tip">
        <select value={tip} onChange={e => { setTip(e.target.value); setEticheta('') }} style={inputSt}>
          <option value="tronson">Tronson de execuție (PVLA, suduri, buletine)</option>
          <option value="proba">Probă de presiune (PV fază + PV probă + diagramă)</option>
        </select>
      </Camp>
      <Camp label="Denumire"><input value={eticheta} onChange={e => setEticheta(e.target.value)} style={inputSt} autoFocus /></Camp>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 14 }}>
        {preseturi.map(p => <button key={p} type="button" onClick={() => setEticheta(p)} style={{ background: 'transparent', color: G.muted, border: `1px dashed ${G.border}`, borderRadius: 12, padding: '2px 9px', fontSize: 11, cursor: 'pointer' }}>{p}</button>)}
      </div>
      <div style={{ fontSize: 11.5, color: G.dim, marginBottom: 12 }}>Pozițiile repetabile din template se clonează pe această unitate.</div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onClose} style={btn(G.muted)}>Anulează</button>
        <button onClick={() => eticheta.trim() && onAdauga(tip === 'proba' ? numeProba(eticheta) : eticheta.trim())} style={btn(G.ctc, true)}>Adaugă</button>
      </div>
    </Modal>
  )
}

function DetaliiModal({ doc, onClose, onSalveaza }) {
  const [f, setF] = useState({ denumire_document: doc.denumire_document, observatii: doc.observatii || '', obligatoriu: !!doc.obligatoriu, nr_pagini: doc.nr_pagini ?? '' })
  return (
    <Modal titlu="✏️ Detalii poziție" onClose={onClose} latime={560}>
      <Camp label="Denumire document"><input value={f.denumire_document} onChange={e => setF({ ...f, denumire_document: e.target.value })} style={inputSt} /></Camp>
      <Camp label="Observații"><textarea value={f.observatii} onChange={e => setF({ ...f, observatii: e.target.value })} rows={3} style={{ ...inputSt, resize: 'vertical' }} /></Camp>
      <div style={{ display: 'flex', gap: 18, alignItems: 'center', marginBottom: 14 }}>
        <label style={{ fontSize: 12.5 }}><input type="checkbox" checked={f.obligatoriu} onChange={e => setF({ ...f, obligatoriu: e.target.checked })} /> Obligatoriu</label>
        <label style={{ fontSize: 12.5, display: 'flex', gap: 6, alignItems: 'center' }}>Nr. pagini
          <input type="number" min="1" value={f.nr_pagini} onChange={e => setF({ ...f, nr_pagini: e.target.value })} style={{ ...inputSt, width: 80 }} />
        </label>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onClose} style={btn(G.muted)}>Anulează</button>
        <button onClick={() => onSalveaza({
          denumire_document: f.denumire_document.trim() || doc.denumire_document,
          observatii: f.observatii.trim() || null, obligatoriu: f.obligatoriu,
          nr_pagini: Number(f.nr_pagini) > 0 ? Math.round(Number(f.nr_pagini)) : null,
        })} style={btn(G.ctc, true)}>Salvează</button>
      </div>
    </Modal>
  )
}

function RandDoc({ d, busy, muta, onMuta, onUpload, onDeschide, onStatus, onVerificat, onPagini, onDetalii, onArhiva, onScoate, onDuplica, onSterge }) {
  const st = STATUS_DOC_UI[d.status] || STATUS_DOC_UI.lipsa
  const areFisier = !!d.fisier_path
  const inputRef = useRef(null)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '26px minmax(0,1fr) 220px 70px 380px', gap: 10, alignItems: 'center', padding: '7px 14px', borderBottom: `1px solid ${G.border}`, fontSize: 12.5, opacity: d.status === 'na' ? 0.55 : 1 }}>
      <span title={st.label} style={{ fontSize: 15 }}>{st.emoji}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }} title={d.denumire_document}>
          {d.denumire_document}{d.obligatoriu && d.status === 'lipsa' && <span style={{ color: G.orange, marginLeft: 6, fontSize: 11 }} title="Obligatoriu">●</span>}
        </div>
        {d.observatii && <div style={{ fontSize: 11, color: G.dim }}>📝 {d.observatii}</div>}
      </div>
      <div style={{ minWidth: 0, fontSize: 11.5 }}>
        {areFisier ? (
          <button onClick={() => onDeschide(d)} title={d.fisier_nume} style={{ background: 'none', border: 'none', color: G.blue, cursor: 'pointer', fontFamily: 'inherit', fontSize: 11.5, padding: 0, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>
            {d.sursa === 'arhiva_comenzi' ? '📎 ' : '📄 '}{d.fisier_nume}
          </button>
        ) : <span style={{ color: G.dim }}>—</span>}
        {areFisier && <div style={{ color: G.dim, fontSize: 10.5 }}>{[fmtMb(d.fisier_size_bytes), fmtData(d.uploadat_la)].filter(Boolean).join(' · ')}{d.verificat_la ? ' · ✓ ' + fmtData(d.verificat_la) : ''}</div>}
      </div>
      <div>
        {areFisier
          ? <input key={d.id + ':' + (d.nr_pagini ?? '')} type="number" min="1" defaultValue={d.nr_pagini ?? ''} title="Număr de pagini (pentru paginarea borderoului)" placeholder="pag."
              onBlur={e => onPagini(d, e.target.value)} style={{ ...inputSt, padding: '4px 6px', fontSize: 12, textAlign: 'center' }} />
          : <span style={{ color: G.dim }}>&nbsp;</span>}
      </div>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {busy ? <span style={{ color: G.muted, fontSize: 11 }}>se lucrează…</span> : (
          <>
            {d.status !== 'na' && (
              <>
                <input ref={inputRef} type="file" accept="application/pdf,image/*" style={{ display: 'none' }}
                  onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onUpload(d, f) }} />
                <button onClick={() => inputRef.current?.click()} style={btnMic(G.ctc)} title="Încarcă PDF (imaginile se convertesc în PDF)">⬆ {areFisier ? 'Înlocuiește' : 'Încarcă'}</button>
                <button onClick={() => onArhiva(d)} style={btnMic(G.blue)} title="Atașează din arhiva comenzilor furnizor">📎 Arhivă</button>
              </>
            )}
            {(d.status === 'incarcat' || d.status === 'verificat') && (
              <button onClick={() => onVerificat(d)} style={btnMic(d.status === 'verificat' ? G.green : G.muted)} title="Marchează ca verificat">{d.status === 'verificat' ? '✅' : '☑'} Verif.</button>
            )}
            {!areFisier && <button onClick={() => onStatus(d, d.status === 'na' ? 'lipsa' : 'na')} style={btnMic(G.dim)}>{d.status === 'na' ? 'Reactivează' : 'N/A'}</button>}
            {muta && <button onClick={() => onMuta(d, -1)} disabled={!muta.sus} style={{ ...btnMic(G.muted), opacity: muta.sus ? 1 : 0.3 }} title="Mută mai sus în borderou">↑</button>}
            {muta && <button onClick={() => onMuta(d, 1)} disabled={!muta.jos} style={{ ...btnMic(G.muted), opacity: muta.jos ? 1 : 0.3 }} title="Mută mai jos în borderou">↓</button>}
            <button onClick={() => onDetalii(d)} style={btnMic(G.muted)} title="Detalii / observații">✏️</button>
            <button onClick={() => onDuplica(d)} style={btnMic(G.muted)} title="Duplică poziția (ex. un certificat pe sudor)">⧉</button>
            {areFisier && <button onClick={() => onScoate(d)} style={btnMic(G.red)} title="Scoate fișierul de pe poziție">✕ fișier</button>}
            {!areFisier && <button onClick={() => onSterge(d)} style={btnMic(G.red)} title="Șterge poziția">🗑</button>}
          </>
        )}
      </div>
    </div>
  )
}

export default function CtcCarteDetaliu({ carteId, profile, onBack }) {
  const { showToast, ToastEl } = useToast()
  const [carte, setCarte] = useState(null)
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [filtru, setFiltru] = useState('toate')
  const [search, setSearch] = useState('')
  const [busyDoc, setBusyDoc] = useState(null)
  const [busyAct, setBusyAct] = useState(null)   // 'borderou' | 'zip' | 'populare' | 'unitate'
  const [progresZip, setProgresZip] = useState(null)
  const [modal, setModal] = useState(null)       // { tip: 'unitate' | 'detalii' | 'arhiva', doc? }

  const incarca = useCallback(async () => {
    setLoading(true)
    const [rc, rd] = await Promise.all([
      supabase.from('ctc_carti').select('*').eq('id', carteId).single(),
      supabase.from('ctc_documente_carte').select('*').eq('carte_id', carteId).order('ordine').order('id'),
    ])
    if (rc.error || rd.error) showToast('Eroare la încărcare: ' + (rc.error || rd.error).message, 'error')
    setCarte(rc.data || null)
    setDocs(rd.data || [])
    setLoading(false)
  }, [carteId])   // showToast stabil; nu în deps
  useEffect(() => { incarca() }, [incarca])

  const inlocuieste = (row) => setDocs(prev => prev.map(d => (d.id === row.id ? row : d)))
  const cuBusy = async (id, fn) => {
    setBusyDoc(id)
    try { await fn() } catch (e) { showToast(e.message || String(e), 'error') } finally { setBusyDoc(null) }
  }

  const pr = useMemo(() => progres(docs), [docs])
  const vizibile = useMemo(() => {
    const s = search.trim().toLowerCase()
    return docs.filter(d => {
      if (filtru === 'oblig' && !(d.status === 'lipsa' && d.obligatoriu)) return false
      if (['lipsa', 'incarcat', 'verificat', 'na'].includes(filtru) && d.status !== filtru) return false
      if (s && !(`${d.denumire_document} ${d.categorie} ${d.fisier_nume || ''} ${d.observatii || ''}`.toLowerCase().includes(s))) return false
      return true
    })
  }, [docs, filtru, search])
  const grupe = useMemo(() => grupeazaDocumente(vizibile), [vizibile])
  const reordonareOk = filtru === 'toate' && !search.trim()   // ↑↓ doar pe lista completă (vecinii trebuie să fie cei reali)

  // ─── acțiuni pe poziție ───
  const upload = (d, file) => cuBusy(d.id, async () => {
    const { row, paginiDetectate } = await incarcaFisier({ carte, doc: d, file, profile })
    inlocuieste(row)
    showToast(paginiDetectate ? `✓ Încărcat (${paginiDetectate} pagini detectate)` : '✓ Încărcat. Nu am putut număra paginile: completează-le manual.', paginiDetectate ? 'success' : 'warn')
  })
  const deschide = (d) => cuBusy(d.id, async () => { window.open(await urlSemnat(d.fisier_bucket, d.fisier_path), '_blank') })
  const seteazaStatus = (d, status) => cuBusy(d.id, async () => { inlocuieste(await actualizeazaDoc(d.id, { status })) })
  const verificat = (d) => cuBusy(d.id, async () => {
    inlocuieste(await actualizeazaDoc(d.id, d.status === 'verificat'
      ? { status: 'incarcat', verificat_de: null, verificat_la: null }
      : { status: 'verificat', verificat_de: profile?.id || null, verificat_la: new Date().toISOString() }))
  })
  const pagini = (d, val) => {
    const n = Number(val) > 0 ? Math.round(Number(val)) : null
    if (n === (d.nr_pagini ?? null)) return
    cuBusy(d.id, async () => { inlocuieste(await actualizeazaDoc(d.id, { nr_pagini: n })) })
  }
  const salveazaDetalii = (d, patch) => cuBusy(d.id, async () => { inlocuieste(await actualizeazaDoc(d.id, patch)); setModal(null) })
  const ataseaza = (d, cfd) => cuBusy(d.id, async () => {
    inlocuieste(await ataseazaDinArhiva({ doc: d, cfd, profile })); setModal(null)
    showToast('✓ Atașat din arhivă. Completează numărul de pagini.', 'warn')
  })
  const scoate = (d) => {
    if (!window.confirm(`Scoți fișierul de pe poziția „${d.denumire_document}”?${d.sursa === 'upload' ? '\nFișierul încărcat aici se șterge din Storage.' : '\nDocumentul din arhiva comenzilor rămâne neatins.'}`)) return
    cuBusy(d.id, async () => { inlocuieste(await scoateFisier(d)) })
  }
  const muta = (d, dir, grup) => cuBusy(d.id, async () => {
    const upd = calculeazaMutare(grup, d.id, dir)
    if (!upd.length) return
    const rows = await Promise.all(upd.map(u => actualizeazaDoc(u.id, { ordine: u.ordine })))
    setDocs(prev => prev.map(x => rows.find(r => r.id === x.id) || x))
  })
  const duplica = (d) => cuBusy(d.id, async () => {
    const row = await adaugaPozitie(carteId, d, (d.ordine || 0) + 1)
    setDocs(prev => [...prev, row]); showToast('✓ Poziție duplicată')
  })
  const sterge = (d) => {
    if (!window.confirm(`Ștergi poziția „${d.denumire_document}”?`)) return
    cuBusy(d.id, async () => { await stergePozitie(d.id); setDocs(prev => prev.filter(x => x.id !== d.id)) })
  }

  // ─── acțiuni pe carte ───
  const schimbaStatus = async (status) => {
    try {
      const patch = { status }
      if (status === 'predata' && !carte.predat_la) patch.predat_la = new Date().toISOString().slice(0, 10)
      const { data, error } = await supabase.from('ctc_carti').update(patch).eq('id', carteId).select().single()
      if (error) throw error
      setCarte(data)
    } catch (e) { showToast('Eroare: ' + e.message, 'error') }
  }
  const populeaza = async () => {
    setBusyAct('populare')
    try { await populeazaCarte(carte); await incarca(); showToast('✓ Checklist populat din template') } catch (e) { showToast(e.message, 'error') } finally { setBusyAct(null) }
  }
  const adaugaUnit = async (unitate) => {
    setBusyAct('unitate')
    try { await adaugaUnitate(carte, unitate); setModal(null); await incarca(); showToast('✓ Unitate adăugată, poziții clonate') } catch (e) { showToast(e.message, 'error') } finally { setBusyAct(null) }
  }

  // Borderou: generează PDF, salvează pe carte + paginile pe poziții, și îl descarcă.
  const genereazaBorderou = async ({ descarca }) => {
    const b = borderouCarte(docs)
    if (!b.randuri.length) throw new Error('Nicio poziție cu fișier încărcat: borderoul ar fi gol.')
    const blob = await genereazaBorderouPdf({ carte, borderou: b, intocmitDe: profile?.name })
    // pagini + număr de poziție pe rânduri (doar ce s-a schimbat)
    const schimbate = b.randuri.filter(r => r.doc.nr_pozitie !== r.nr || r.doc.nr_pagina_start !== r.start || r.doc.nr_pagina_end !== r.end)
      .map(r => ({ ...r.doc, nr_pozitie: r.nr, nr_pagina_start: r.start, nr_pagina_end: r.end }))
    for (let i = 0; i < schimbate.length; i += 100) {
      const { error } = await supabase.from('ctc_documente_carte').upsert(schimbate.slice(i, i + 100), { onConflict: 'id' })
      if (error) throw new Error('Salvare paginare: ' + error.message)
    }
    const path = `carte-${carteId}/borderou.pdf`
    const up = await supabase.storage.from(BUCKET_CTC).upload(path, blob, { contentType: 'application/pdf', upsert: true })
    if (up.error) throw new Error('Upload borderou: ' + up.error.message)
    const { data, error } = await supabase.from('ctc_carti').update({ borderou_path: path, borderou_generat_at: new Date().toISOString() }).eq('id', carteId).select().single()
    if (error) throw error
    setCarte(data)
    const { data: rd } = await supabase.from('ctc_documente_carte').select('*').eq('carte_id', carteId).order('ordine').order('id')
    if (rd) setDocs(rd)
    if (descarca) descarcaBlob(blob, `Borderou_CTC_${carteId}.pdf`)
    return { blob, borderou: b }
  }
  const borderouClick = async () => {
    const b = borderouCarte(docs)
    if (b.faraPagini && !window.confirm(`${b.faraPagini} poziții cu fișier nu au număr de pagini: apar în borderou cu „—” și nu intră în paginare. Continui?`)) return
    setBusyAct('borderou')
    try { await genereazaBorderou({ descarca: true }); showToast('✓ Borderou generat și salvat pe carte') } catch (e) { showToast(e.message, 'error') } finally { setBusyAct(null) }
  }
  const zipClick = async () => {
    const b = borderouCarte(docs)
    if (b.faraPagini && !window.confirm(`${b.faraPagini} poziții cu fișier nu au număr de pagini. ZIP-ul le include oricum; borderoul le arată cu „—”. Continui?`)) return
    setBusyAct('zip')
    try {
      const { blob, borderou } = await genereazaBorderou({ descarca: false })
      const r = await construiesteZip({ carte, borderou, borderouBlob: blob, onProgres: (i, n, nume) => setProgresZip(`${i}/${n} · ${nume}`) })
      descarcaBlob(r.blob, r.nume)
      showToast(r.esuate.length ? `ZIP gata, dar ${r.esuate.length} fișiere nu s-au putut citi (vezi 000_EROARE_fisiere_necitite.txt).` : '✓ ZIP descărcat', r.esuate.length ? 'warn' : 'success')
    } catch (e) { showToast(e.message, 'error') } finally { setBusyAct(null); setProgresZip(null) }
  }

  if (loading && !carte) return <div style={{ padding: 40, textAlign: 'center', color: G.muted }}>Se încarcă…</div>
  if (!carte) return (
    <div style={{ padding: 40, textAlign: 'center' }}>
      <div style={{ color: G.muted, marginBottom: 12 }}>Cartea nu a fost găsită (sau nu ai acces).</div>
      <button onClick={onBack} style={btn(G.ctc)}>← Înapoi</button>{ToastEl}
    </div>
  )
  const st = STATUS_CARTE_UI[carte.status] || STATUS_CARTE_UI.in_lucru

  return (
    <div style={{ padding: '20px 28px', maxWidth: 1400, margin: '0 auto' }}>
      {ToastEl}
      <button onClick={onBack} style={{ ...btn(G.muted), marginBottom: 14 }}>← Toate cărțile</button>

      <div style={{ background: G.surface, border: `1px solid ${G.border}`, borderRadius: 12, padding: '16px 20px', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ fontSize: 16, fontWeight: 800 }}>📑 {carte.denumire_obiectiv}</div>
            <div style={{ fontSize: 12, color: G.muted, marginTop: 4 }}>
              {[carte.beneficiar_nume, carte.numar_contract && `contract ${carte.numar_contract}${carte.data_contract ? ' / ' + fmtData(carte.data_contract) : ''}`, [carte.localitate, carte.judet].filter(Boolean).join(', ')].filter(Boolean).join(' · ') || '—'}
            </div>
            {carte.borderou_generat_at && <div style={{ fontSize: 11, color: G.dim, marginTop: 3 }}>Borderou generat: {fmtData(carte.borderou_generat_at)}</div>}
          </div>
          <select value={carte.status} onChange={e => schimbaStatus(e.target.value)}
            style={{ ...inputSt, width: 140, color: st.color, fontWeight: 800 }}>
            {STATUSE_CARTE.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, margin: '14px 0 12px', fontSize: 12.5 }}>
          <div style={{ flex: 1 }}><BaraProgres valoare={pr.incarcate} total={pr.aplicabile} color={pr.obligatoriiLipsa ? G.blue : G.green} h={10} /></div>
          <b>{pr.incarcate}/{pr.aplicabile} documente</b>
          <span style={{ color: pr.obligatoriiLipsa ? G.orange : G.green }}>{pr.obligatoriiLipsa ? `⚠ ${pr.obligatoriiLipsa} obligatorii lipsă` : '✓ obligatorii complete'}</span>
          <span style={{ color: G.muted }}>{pr.verificate} verificate · {pr.pagini} pag.</span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={borderouClick} disabled={!!busyAct} style={btn(G.ctc, true)}>{busyAct === 'borderou' ? 'Se generează…' : '📄 Borderou PDF'}</button>
          <button onClick={zipClick} disabled={!!busyAct} style={btn(G.blue)}>{busyAct === 'zip' ? (progresZip ? `Se descarcă ${progresZip}` : 'Se pregătește…') : '📦 ZIP documente'}</button>
          <button onClick={() => setModal({ tip: 'unitate' })} disabled={!!busyAct} style={btn(G.orange)}>➕ Tronson / probă</button>
        </div>
        {!!(carte.tronsoane || []).length && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
            {carte.tronsoane.map(t => <span key={t} style={{ background: (esteProba(t) ? G.orange : G.blue) + '22', color: esteProba(t) ? G.orange : G.blue, borderRadius: 12, padding: '2px 10px', fontSize: 11, fontWeight: 700 }}>{esteProba(t) ? '🧪' : '🔧'} {etichetaTronson(t)}</span>)}
          </div>
        )}
      </div>

      {!docs.length && (
        <div style={{ background: G.card2, border: `1px dashed ${G.border}`, borderRadius: 12, padding: 28, textAlign: 'center', marginBottom: 14 }}>
          <div style={{ marginBottom: 10, color: G.muted }}>Cartea nu are poziții în checklist.</div>
          {carte.template_id && <button onClick={populeaza} disabled={busyAct === 'populare'} style={btn(G.ctc, true)}>{busyAct === 'populare' ? 'Se populează…' : 'Populează din template'}</button>}
        </div>
      )}

      {!!docs.length && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          {FILTRE.map(([k, l]) => (
            <button key={k} onClick={() => setFiltru(k)} style={{
              padding: '5px 13px', borderRadius: 16, fontSize: 12, fontWeight: 700, cursor: 'pointer',
              background: filtru === k ? G.ctc + '22' : 'transparent', color: filtru === k ? G.ctc : G.muted, border: `1.5px solid ${filtru === k ? G.ctc : G.border}`,
            }}>{l}</button>
          ))}
          <div style={{ flex: 1 }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Caută în checklist…" style={{ ...inputSt, width: 260 }} />
        </div>
      )}

      {grupe.map(g => {
        const gp = progres(g.docs)
        let catPrec = null
        return (
          <div key={g.cheie || 'general'} style={{ background: G.surface, border: `1px solid ${G.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: G.card2, borderBottom: `1px solid ${G.border}` }}>
              <span style={{ fontSize: 13.5, fontWeight: 800, flex: 1 }}>{g.eticheta}</span>
              <div style={{ width: 120 }}><BaraProgres valoare={gp.incarcate} total={gp.aplicabile} h={6} /></div>
              <span style={{ fontSize: 11.5, color: G.muted }}>{gp.incarcate}/{gp.aplicabile}</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              {g.docs.map((d, idx) => {
                const nouaCat = d.categorie !== catPrec
                catPrec = d.categorie
                return (
                  <div key={d.id}>
                    {nouaCat && <div style={{ padding: '5px 14px', fontSize: 10.5, fontWeight: 800, color: G.ctc, textTransform: 'uppercase', background: G.bg + '99' }}>{d.categorie}</div>}
                    <RandDoc d={d} busy={busyDoc === d.id} onUpload={upload}
                      muta={reordonareOk ? { sus: idx > 0, jos: idx < g.docs.length - 1 } : null} onMuta={(x, dir) => muta(x, dir, g.docs)} onDeschide={deschide} onStatus={seteazaStatus} onVerificat={verificat}
                      onPagini={pagini} onDetalii={(x) => setModal({ tip: 'detalii', doc: x })} onArhiva={(x) => setModal({ tip: 'arhiva', doc: x })}
                      onScoate={scoate} onDuplica={duplica} onSterge={sterge} />
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
      {!!docs.length && !vizibile.length && <div style={{ padding: 30, textAlign: 'center', color: G.muted }}>Nicio poziție pe filtrele curente.</div>}

      {modal?.tip === 'unitate' && <UnitateModal onClose={() => setModal(null)} onAdauga={adaugaUnit} />}
      {modal?.tip === 'detalii' && <DetaliiModal doc={modal.doc} onClose={() => setModal(null)} onSalveaza={(patch) => salveazaDetalii(modal.doc, patch)} />}
      {modal?.tip === 'arhiva' && <ArhivaPicker carte={carte} docs={docs} onClose={() => setModal(null)} onAlege={(cfd) => ataseaza(modal.doc, cfd)} />}
    </div>
  )
}
