// ═══════════════════════════════════════════════════════════════════════════
// SupapeDeclaratiiSection.jsx — v1 (29.06.2026)
// Gestiune supape de siguranță per utilaj + Declarație conformitate tehnică.
//
// Logica de business (decizii Razvan):
//  - Fiecare utilaj are nr_supape (1 compresor, 2-3 booster).
//  - Fiecare supapă are o serie + ultima verificare ISCIR (conform/neconform/în așteptare).
//  - O supapă "OK" = activă + rezultat=conform + data_valabilitate >= azi.
//  - Declarația de conformitate iese DOAR când TOATE supapele montate sunt OK
//    (gating prin view v_supape_status.poate_emite_declaratie).
//  - La emitere, starea supapelor se ÎNGHEAȚĂ în snapshot (arhivă imutabilă).
//  - Valabilitatea declarației = cea mai apropiată scadență de supapă.
//  - Semnatar: Mitrache Alexandru (id 71). Semnătura se trage automat dacă există
//    în hr_semnaturi_electronice; altfel rămâne linie pentru semnat manual.
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback } from 'react'
import { supabase } from './lib/supabase.js'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import LOGO_B64 from './logo.js'
import { compressFileBeforeUpload } from './utils/compressFile'

const G = {
  bg:'#0D1117', surface:'#161B22', border:'#21262D', border2:'#30363D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  blue:'#58A6FF', green:'#3FB950', red:'#F85149', yellow:'#D29922',
  purple:'#BC8CFF', orange:'#F0883E',
  greenDim:'#1A3A1A', redDim:'#3A1A1A', yellowDim:'#3A2A0A',
  logistica:'#E3B341',
}
const S = {
  card: { background:G.surface, border:`1px solid ${G.border}`, borderRadius:12 },
  input: { background:G.bg, border:`1px solid ${G.border2}`, color:G.text, borderRadius:8, padding:'8px 12px', fontFamily:'inherit', fontSize:14, outline:'none', width:'100%' },
  btnP: { background:'#1F6FEB', color:'white', border:'none', borderRadius:8, padding:'9px 18px', fontFamily:'inherit', fontSize:14, fontWeight:700, cursor:'pointer' },
  btnS: { background:G.surface, color:G.text, border:`1px solid ${G.border}`, borderRadius:8, padding:'7px 14px', fontFamily:'inherit', fontSize:13, fontWeight:600, cursor:'pointer' },
}

const BUCKET = 'documente-flota'
const SEMNATAR = { id: 71, nume: 'MITRACHE ALEXANDRU', functie: 'Director Departament Logistică', prefix: 'ing.' }

const daysUntil = (d) => d ? Math.ceil((new Date(d) - new Date()) / 86400000) : null
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'

const REZULTAT_META = {
  conform:      { label: 'conform',      emoji: '✅', color: G.green },
  neconform:    { label: 'neconform',    emoji: '❌', color: G.red },
  in_asteptare: { label: 'în așteptare', emoji: '⏳', color: G.yellow },
}

// Status efectiv al unei supape: conform-valid / expirat / neconform / așteptare / fără verificare
function supapaStatus(s) {
  if (!s.rezultat || s.rezultat === 'in_asteptare') return { key: 'asteptare', label: '⏳ În așteptare', color: G.yellow }
  if (s.rezultat === 'neconform') return { key: 'neconform', label: '❌ Neconform', color: G.red }
  const d = daysUntil(s.data_valabilitate)
  if (d === null) return { key: 'fara_data', label: '⚠️ Fără dată', color: G.orange }
  if (d < 0) return { key: 'expirat', label: '⛔ Expirat', color: G.red }
  if (d <= 30) return { key: 'expira', label: `✅ Valabil (${d}z)`, color: G.orange }
  return { key: 'ok', label: `✅ Valabil`, color: G.green }
}

// Fetch semnătură angajat ca dataURL (signed URL → blob → base64); null dacă lipsește
async function fetchSignatureDataURL(employeeId) {
  try {
    const { data: sig } = await supabase
      .from('hr_semnaturi_electronice')
      .select('fisier_path')
      .eq('employee_id', employeeId).eq('activ', true).maybeSingle()
    if (!sig?.fisier_path) return null
    const { data: signed } = await supabase.storage.from('hr-semnaturi').createSignedUrl(sig.fisier_path, 120)
    if (!signed?.signedUrl) return null
    const resp = await fetch(signed.signedUrl)
    const blob = await resp.blob()
    return await new Promise((res) => { const r = new FileReader(); r.onloadend = () => res(r.result); r.onerror = () => res(null); r.readAsDataURL(blob) })
  } catch { return null }
}

export default function SupapeDeclaratiiSection({ activ, canEdit, showToast }) {
  const [nrSupape, setNrSupape] = useState(activ?.nr_supape ?? 1)
  const [supape, setSupape] = useState([])
  const [declaratii, setDeclaratii] = useState([])
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editSupapa, setEditSupapa] = useState(null)  // {} nou sau obiect existent
  const [busy, setBusy] = useState(false)
  const [genBusy, setGenBusy] = useState(false)

  const load = useCallback(async () => {
    if (!activ?.id) return
    setLoading(true)
    const [rSup, rDecl, rSt] = await Promise.all([
      supabase.from('logistica_supape').select('*').eq('activ_id', activ.id).order('activa', { ascending: false }).order('serie'),
      supabase.from('logistica_declaratii').select('*').eq('activ_id', activ.id).order('generat_la', { ascending: false }),
      supabase.from('v_supape_status').select('*').eq('activ_id', activ.id).maybeSingle(),
    ])
    setSupape(rSup.data || [])
    setDeclaratii(rDecl.data || [])
    setStatus(rSt.data || null)
    if (rSt.data) setNrSupape(rSt.data.nr_supape_asteptat)
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activ?.id])

  useEffect(() => { load() }, [load])

  // ── Salvare nr. supape (update direct pe utilaj) ──
  const saveNrSupape = async (n) => {
    const val = Math.max(0, parseInt(n) || 0)
    setNrSupape(val)
    const { error } = await supabase.from('logistica_active').update({ nr_supape: val }).eq('id', activ.id)
    if (error) { showToast?.('Eroare la salvarea nr. supape', 'error'); return }
    await load()
  }

  // ── Salvare supapă (insert/update) + upload buletin PDF opțional ──
  const saveSupapa = async (f, file) => {
    if (!f.serie?.trim()) { showToast?.('Seria supapei e obligatorie', 'error'); return }
    setBusy(true)
    try {
      let pdf_path = f.pdf_path || null, pdf_nume = f.pdf_nume || null
      if (file) {
        const compressed = await compressFileBeforeUpload(file)
        const ext = (file.name.split('.').pop() || 'pdf').toLowerCase()
        const path = `${activ.id}/supape/${f.serie.replace(/[^a-zA-Z0-9]/g, '')}_${Date.now()}.${ext}`
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, compressed, { contentType: compressed.type || 'application/pdf', upsert: false })
        if (upErr) throw upErr
        pdf_path = path; pdf_nume = file.name
      }
      const payload = {
        activ_id: activ.id,
        serie: f.serie.trim(),
        producator: f.producator?.trim() || null,
        activa: f.activa !== false,
        nr_buletin: f.nr_buletin?.trim() || null,
        emitent: f.emitent?.trim() || null,
        data_verificare: f.data_verificare || null,
        data_valabilitate: f.data_valabilitate || null,
        rezultat: f.rezultat || null,
        pr_bari: f.pr_bari !== '' && f.pr_bari != null ? Number(f.pr_bari) : null,
        diametru_curgere_mm: f.diametru_curgere_mm !== '' && f.diametru_curgere_mm != null ? Number(f.diametru_curgere_mm) : null,
        pdf_path, pdf_nume,
        observatii: f.observatii?.trim() || null,
        updated_at: new Date().toISOString(),
      }
      if (f.id) {
        const { error } = await supabase.from('logistica_supape').update(payload).eq('id', f.id)
        if (error) throw error
      } else {
        const { data: { user } } = await supabase.auth.getUser()
        const { error } = await supabase.from('logistica_supape').insert({ ...payload, created_by: user?.id || null })
        if (error) throw error
      }
      showToast?.('Supapă salvată', 'success')
      setEditSupapa(null)
      await load()
    } catch (e) {
      showToast?.('Eroare: ' + (e.message || e), 'error')
    } finally { setBusy(false) }
  }

  const stergeSupapa = async (s) => {
    if (!window.confirm(`Ștergi supapa serie ${s.serie}?`)) return
    if (s.pdf_path) { try { await supabase.storage.from(BUCKET).remove([s.pdf_path]) } catch {} }
    const { error } = await supabase.from('logistica_supape').delete().eq('id', s.id)
    if (error) { showToast?.('Eroare la ștergere', 'error'); return }
    showToast?.('Supapă ștearsă', 'success')
    await load()
  }

  const veziPDF = async (path) => {
    if (!path) return
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 120)
    if (error || !data?.signedUrl) { showToast?.('Nu pot deschide documentul', 'error'); return }
    window.open(data.signedUrl, '_blank')
  }

  // ── Generare declarație conformitate (PDF) + arhivare cu snapshot ──
  const genereazaDeclaratie = async () => {
    if (!status?.poate_emite_declaratie) return
    setGenBusy(true)
    try {
      // Snapshot supape active conforme valide
      const supapeOk = supape.filter(s => s.activa && s.rezultat === 'conform' && daysUntil(s.data_valabilitate) >= 0)
      const supapeSnapshot = supapeOk.map(s => ({
        serie: s.serie, producator: s.producator, nr_buletin: s.nr_buletin,
        emitent: s.emitent, data_verificare: s.data_verificare, data_valabilitate: s.data_valabilitate,
        pr_bari: s.pr_bari, diametru_curgere_mm: s.diametru_curgere_mm,
      }))
      // Valabilitate declarație = cea mai apropiată scadență
      const dataValab = supapeSnapshot.reduce((min, s) => (!min || (s.data_valabilitate && s.data_valabilitate < min)) ? s.data_valabilitate : min, null)
      const utilajSnapshot = {
        marca: activ.marca, model: activ.model, serie: activ.serie || activ.serie_sasiu || activ.nr_inmatriculare,
        cod_intern: activ.cod_intern, an: activ.an_fabricatie, ore: activ.ore_functionare_actuale,
      }
      // Numerotare secvențială pe an
      const an = new Date().getFullYear()
      const { count } = await supabase.from('logistica_declaratii').select('id', { count: 'exact', head: true }).gte('data_emitere', `${an}-01-01`)
      const numar = `${String((count || 0) + 1).padStart(3, '0')}/${an}`
      const dataEmitere = new Date().toISOString().slice(0, 10)

      const semnaturaImg = await fetchSignatureDataURL(SEMNATAR.id)
      const blob = await construiestePDF({ numar, dataEmitere, dataValab, utilajSnapshot, supapeSnapshot, semnaturaImg })

      const path = `${activ.id}/declaratii/DC_${numar.replace(/\//g, '-')}_${Date.now()}.pdf`
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'application/pdf', upsert: false })
      if (upErr) throw upErr

      // Lipește buletinele PDF ale supapelor conforme în spatele declarației (Edge Function pdf-lib)
      const anexePaths = supapeOk.map(s => s.pdf_path).filter(Boolean)
      if (anexePaths.length) {
        try {
          await supabase.functions.invoke('merge-declaratie-anexe', { body: { bucket: BUCKET, decl_path: path, anexe_paths: anexePaths } })
        } catch { /* dacă merge-ul eșuează, declarația rămâne fără anexe — nu blocăm */ }
      }

      const { data: { user } } = await supabase.auth.getUser()
      const { error: insErr } = await supabase.from('logistica_declaratii').insert({
        activ_id: activ.id, numar, data_emitere: dataEmitere, data_valabilitate: dataValab,
        supape_snapshot: supapeSnapshot, utilaj_snapshot: utilajSnapshot,
        semnatar_nume: `${SEMNATAR.prefix} ${SEMNATAR.nume}`, semnatar_functie: SEMNATAR.functie,
        pdf_path: path, pdf_nume: `Declaratie_conformitate_${numar.replace(/\//g, '-')}.pdf`,
        generat_de: user?.id || null,
      })
      if (insErr) throw insErr

      // download imediat versiunea finală din storage (cu anexe lipite)
      let finalBlob = blob
      try { const { data: fb } = await supabase.storage.from(BUCKET).download(path); if (fb) finalBlob = fb } catch {}
      const url = URL.createObjectURL(finalBlob)
      const a = document.createElement('a'); a.href = url; a.download = `Declaratie_conformitate_${numar.replace(/\//g, '-')}.pdf`; a.click()
      URL.revokeObjectURL(url)
      showToast?.(`Declarație ${numar} generată și arhivată`, 'success')
      await load()
    } catch (e) {
      showToast?.('Eroare generare: ' + (e.message || e), 'error')
    } finally { setGenBusy(false) }
  }

  if (!activ?.id) return null

  const motivBlocat = (() => {
    if (!status) return null
    if (status.nr_supape_asteptat === 0) return 'Setează nr. supape > 0'
    if (status.nr_supape_active < status.nr_supape_asteptat) return `Lipsesc ${status.nr_supape_asteptat - status.nr_supape_active} supape din ${status.nr_supape_asteptat}`
    if (status.nr_neconforme > 0) return `${status.nr_neconforme} supapă/e neconformă/e`
    if (status.nr_in_asteptare > 0) return `${status.nr_in_asteptare} supapă/e fără buletin (în așteptare)`
    if (status.nr_expirate > 0) return `${status.nr_expirate} verificare/i expirată/e`
    return null
  })()

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: G.logistica, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 8 }}>
        🛡️ Supape de siguranță & Declarație conformitate
      </div>

      {/* Nr. supape + status gating */}
      <div style={{ ...S.card, padding: 14, marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: status ? 12 : 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, color: G.muted }}>Nr. supape montate:</span>
            <input type="number" min="0" max="12" value={nrSupape} disabled={!canEdit}
              onChange={e => setNrSupape(e.target.value)} onBlur={e => canEdit && saveNrSupape(e.target.value)}
              style={{ ...S.input, width: 64, textAlign: 'center', fontWeight: 800, fontSize: 16, padding: '6px 8px' }} />
            <span style={{ fontSize: 11, color: G.dim }}>(1 = compresor · 2-3 = booster)</span>
          </div>
        </div>

        {status && (
          <div style={{
            padding: '10px 12px', borderRadius: 8,
            background: status.poate_emite_declaratie ? G.greenDim + 'aa' : G.bg,
            border: `1px solid ${status.poate_emite_declaratie ? G.green + '55' : G.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
          }}>
            <div style={{ fontSize: 12.5, color: G.text }}>
              <strong style={{ color: status.poate_emite_declaratie ? G.green : G.orange }}>
                {status.nr_conforme_valide}/{status.nr_supape_asteptat}
              </strong> supape conforme & valabile
              {motivBlocat && <span style={{ color: G.orange, marginLeft: 8 }}>· {motivBlocat}</span>}
            </div>
            <button
              onClick={genereazaDeclaratie}
              disabled={!status.poate_emite_declaratie || genBusy || !canEdit}
              title={status.poate_emite_declaratie ? 'Generează declarația de conformitate' : (motivBlocat || 'Necesită toate supapele conforme + valide')}
              style={{
                ...S.btnP,
                background: status.poate_emite_declaratie ? G.green : G.border,
                color: status.poate_emite_declaratie ? '#0D1117' : G.dim,
                cursor: (status.poate_emite_declaratie && canEdit && !genBusy) ? 'pointer' : 'not-allowed',
                opacity: (status.poate_emite_declaratie && canEdit) ? 1 : .7,
              }}>
              {genBusy ? 'Se generează…' : '📄 Generează declarație'}
            </button>
          </div>
        )}
      </div>

      {/* Lista supape */}
      <div style={{ ...S.card, padding: 0, overflow: 'hidden', marginBottom: 10 }}>
        <div style={{ padding: '8px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: supape.length ? `1px solid ${G.border}` : 'none' }}>
          <span style={{ fontSize: 11, color: G.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px' }}>Supape ({supape.length})</span>
          {canEdit && <button onClick={() => setEditSupapa({ activa: true, emitent: 'TERMOKLIMA S.R.L.', rezultat: 'conform' })} style={{ ...S.btnS, padding: '5px 12px', fontSize: 12, color: G.green, borderColor: G.green + '55' }}>+ Adaugă supapă</button>}
        </div>
        {loading ? (
          <div style={{ padding: 16, color: G.dim, fontSize: 12, textAlign: 'center' }}>Se încarcă…</div>
        ) : supape.length === 0 ? (
          <div style={{ padding: 16, color: G.dim, fontSize: 12.5, textAlign: 'center', fontStyle: 'italic' }}>Nicio supapă înregistrată. Adaugă supapele de siguranță cu buletinul de verificare ISCIR.</div>
        ) : supape.map((s, idx) => {
          const st = supapaStatus(s)
          return (
            <div key={s.id} style={{ padding: '10px 14px', borderBottom: idx < supape.length - 1 ? `1px solid ${G.border}` : 'none', display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center', opacity: s.activa ? 1 : .5 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, color: G.text, fontFamily: 'monospace', fontSize: 13.5 }}>{s.serie}</span>
                  {s.producator && <span style={{ fontSize: 11, color: G.muted }}>{s.producator}</span>}
                  <span style={{ background: st.color + '22', color: st.color, borderRadius: 10, padding: '1px 9px', fontSize: 10.5, fontWeight: 800 }}>{st.label}</span>
                  {!s.activa && <span style={{ background: G.dim + '22', color: G.dim, borderRadius: 10, padding: '1px 9px', fontSize: 10, fontWeight: 700 }}>DEMONTATĂ</span>}
                </div>
                <div style={{ fontSize: 11, color: G.muted, marginTop: 3 }}>
                  {s.nr_buletin && <>Buletin <strong style={{ color: G.text }}>{s.nr_buletin}</strong></>}
                  {s.emitent && <> · {s.emitent}</>}
                  {s.pr_bari != null && <> · Pr {s.pr_bari} bari</>}
                  {s.data_valabilitate && <> · valabil până <strong style={{ color: st.color }}>{fmtDate(s.data_valabilitate)}</strong></>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {s.pdf_path && <button onClick={() => veziPDF(s.pdf_path)} title="Vezi buletin" style={{ ...S.btnS, padding: '5px 10px', fontSize: 12 }}>📄</button>}
                {canEdit && <button onClick={() => setEditSupapa({ ...s })} style={{ ...S.btnS, padding: '5px 10px', fontSize: 12 }}>✏️</button>}
                {canEdit && <button onClick={() => stergeSupapa(s)} style={{ ...S.btnS, padding: '5px 10px', fontSize: 12, color: G.red, borderColor: G.red + '44' }}>🗑</button>}
              </div>
            </div>
          )
        })}
      </div>

      {/* Arhivă declarații */}
      {declaratii.length > 0 && (
        <div style={{ ...S.card, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '8px 14px', borderBottom: `1px solid ${G.border}` }}>
            <span style={{ fontSize: 11, color: G.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px' }}>📜 Declarații emise ({declaratii.length})</span>
          </div>
          {declaratii.map((d, idx) => {
            const exp = daysUntil(d.data_valabilitate)
            const expColor = exp === null ? G.muted : exp < 0 ? G.red : exp <= 30 ? G.orange : G.green
            return (
              <div key={d.id} style={{ padding: '10px 14px', borderBottom: idx < declaratii.length - 1 ? `1px solid ${G.border}` : 'none', display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 700, color: G.text, fontSize: 13 }}>Declarație nr. {d.numar}</div>
                  <div style={{ fontSize: 11, color: G.muted, marginTop: 2 }}>
                    emisă {fmtDate(d.data_emitere)} · {(d.supape_snapshot || []).length} supape
                    {d.data_valabilitate && <> · valabilă până <strong style={{ color: expColor }}>{fmtDate(d.data_valabilitate)}{exp < 0 ? ' (EXPIRATĂ)' : ''}</strong></>}
                  </div>
                </div>
                {d.pdf_path && <button onClick={() => veziPDF(d.pdf_path)} style={{ ...S.btnS, padding: '6px 12px', fontSize: 12, color: G.blue, borderColor: G.blue + '55' }}>📄 Vezi PDF</button>}
              </div>
            )
          })}
        </div>
      )}

      {editSupapa && <SupapaModal initial={editSupapa} busy={busy} onSave={saveSupapa} onClose={() => setEditSupapa(null)} />}
    </div>
  )
}

// ── Modal adăugare/editare supapă ──
function SupapaModal({ initial, busy, onSave, onClose }) {
  const [f, setF] = useState(initial)
  const [file, setFile] = useState(null)
  const [parsing, setParsing] = useState(false)
  const [parseMsg, setParseMsg] = useState(null)
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))

  const citesteDinPDF = async () => {
    if (!file) return
    setParsing(true); setParseMsg(null)
    try {
      const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onloadend = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(file) })
      const { data, error } = await supabase.functions.invoke('parse-buletin-supapa', { body: { pdf_base64: b64 } })
      if (error || !data?.ok) throw new Error(data?.error || error?.message || 'eroare necunoscută')
      const d = data.date || {}
      setF(p => ({
        ...p,
        serie: d.serie || p.serie,
        nr_buletin: d.nr_buletin || p.nr_buletin,
        emitent: d.emitent || p.emitent,
        data_verificare: d.data_verificare || p.data_verificare,
        data_valabilitate: d.data_valabilitate || p.data_valabilitate,
        rezultat: d.rezultat || p.rezultat,
        pr_bari: d.pr_bari ?? p.pr_bari,
        diametru_curgere_mm: d.diametru_curgere_mm ?? p.diametru_curgere_mm,
      }))
      setParseMsg({ ok: true, text: '✅ Date completate din buletin — verifică-le și salvează' })
    } catch (e) {
      setParseMsg({ ok: false, text: '⚠️ Nu am putut citi buletinul: ' + (e.message || e) })
    } finally { setParsing(false) }
  }
  const lbl = { fontSize: 12, color: G.muted, marginBottom: 4, display: 'block' }
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 20 }} onClick={onClose}>
      <div style={{ ...S.card, padding: 22, maxWidth: 540, width: '100%', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 17, fontWeight: 800, color: G.text, marginBottom: 16 }}>{f.id ? '✏️ Editează supapă' : '➕ Supapă nouă'}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}><label style={lbl}>Serie supapă *</label><input style={S.input} value={f.serie || ''} onChange={e => set('serie', e.target.value)} placeholder="ex: 10293284" /></div>
            <div style={{ flex: 1 }}><label style={lbl}>Producător</label><input style={S.input} value={f.producator || ''} onChange={e => set('producator', e.target.value)} placeholder="ex: LESER / technical" /></div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: G.text, cursor: 'pointer' }}>
            <input type="checkbox" checked={f.activa !== false} onChange={e => set('activa', e.target.checked)} style={{ width: 16, height: 16, accentColor: G.green }} />
            Montată acum pe utilaj <span style={{ fontSize: 11, color: G.dim }}>(debifează dacă a fost demontată/înlocuită)</span>
          </label>

          <div style={{ height: 1, background: G.border, margin: '2px 0' }} />
          <div style={{ fontSize: 11, color: G.logistica, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px' }}>Buletin verificare ISCIR</div>

          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}><label style={lbl}>Rezultat</label>
              <select style={S.input} value={f.rezultat || 'conform'} onChange={e => set('rezultat', e.target.value)}>
                <option value="conform">✅ Conform</option>
                <option value="neconform">❌ Neconform</option>
                <option value="in_asteptare">⏳ În așteptare</option>
              </select>
            </div>
            <div style={{ flex: 1 }}><label style={lbl}>Nr. buletin</label><input style={S.input} value={f.nr_buletin || ''} onChange={e => set('nr_buletin', e.target.value)} placeholder="ex: 3467/19.06.2026" /></div>
          </div>
          <div><label style={lbl}>Emitent (unitate autorizată ISCIR)</label><input style={S.input} value={f.emitent || ''} onChange={e => set('emitent', e.target.value)} placeholder="ex: TERMOKLIMA S.R.L." /></div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}><label style={lbl}>Data verificare</label><input type="date" style={S.input} value={f.data_verificare || ''} onChange={e => set('data_verificare', e.target.value)} /></div>
            <div style={{ flex: 1 }}><label style={lbl}>Valabil până la</label><input type="date" style={S.input} value={f.data_valabilitate || ''} onChange={e => set('data_valabilitate', e.target.value)} /></div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}><label style={lbl}>Presiune reglare (bari)</label><input type="number" step="0.1" style={S.input} value={f.pr_bari ?? ''} onChange={e => set('pr_bari', e.target.value)} placeholder="ex: 74.0" /></div>
            <div style={{ flex: 1 }}><label style={lbl}>Diametru curgere (mm)</label><input type="number" step="0.1" style={S.input} value={f.diametru_curgere_mm ?? ''} onChange={e => set('diametru_curgere_mm', e.target.value)} placeholder="ex: 13.0" /></div>
          </div>
          <div><label style={lbl}>Observații</label><input style={S.input} value={f.observatii || ''} onChange={e => set('observatii', e.target.value)} /></div>
          <div>
            <label style={lbl}>Buletin PDF {f.pdf_nume && <span style={{ color: G.green }}>· atașat: {f.pdf_nume}</span>}</label>
            <input type="file" accept="application/pdf,image/*" onChange={e => { setFile(e.target.files?.[0] || null); setParseMsg(null) }} style={{ fontSize: 12, color: G.muted }} />
            {file && file.type === 'application/pdf' && (
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <button type="button" onClick={citesteDinPDF} disabled={parsing}
                  style={{ ...S.btnS, padding: '6px 14px', fontSize: 12.5, color: G.purple, borderColor: G.purple + '55', cursor: parsing ? 'wait' : 'pointer', opacity: parsing ? .6 : 1 }}>
                  {parsing ? '🔍 Se citește…' : '🔍 Citește datele din PDF'}
                </button>
                {parseMsg && <span style={{ fontSize: 11.5, color: parseMsg.ok ? G.green : G.orange }}>{parseMsg.text}</span>}
              </div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
          <button onClick={onClose} style={S.btnS}>Anulează</button>
          <button onClick={() => onSave(f, file)} disabled={busy || !f.serie?.trim()} style={{ ...S.btnP, opacity: (busy || !f.serie?.trim()) ? .5 : 1 }}>{busy ? 'Se salvează…' : '✓ Salvează'}</button>
        </div>
      </div>
    </div>
  )
}

// ── Construire PDF declarație (HTML offscreen → html2canvas → jsPDF A4) ──
async function construiestePDF({ numar, dataEmitere, dataValab, utilajSnapshot, supapeSnapshot, semnaturaImg }) {
  const fmt = (d) => d ? new Date(d).toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
  const utilajNume = [utilajSnapshot.marca, utilajSnapshot.model].filter(Boolean).join(' ') || utilajSnapshot.cod_intern || '—';

  const randuriSupape = supapeSnapshot.map(s => `
    <tr>
      <td style="border:1px solid #999;padding:6px 8px;font-family:monospace;">${s.serie || '—'}${s.producator ? ` (${s.producator})` : ''}</td>
      <td style="border:1px solid #999;padding:6px 8px;">${s.nr_buletin || '—'}</td>
      <td style="border:1px solid #999;padding:6px 8px;text-align:center;">${s.pr_bari != null ? s.pr_bari + ' bari' : '—'}</td>
      <td style="border:1px solid #999;padding:6px 8px;text-align:center;">${fmt(s.data_valabilitate)}</td>
    </tr>`).join('');

  const emitenti = [...new Set(supapeSnapshot.map(s => s.emitent).filter(Boolean))].join(', ') || 'unitate autorizată ISCIR';

  const html = `
    <div style="width:738px;padding:28px;background:#fff;color:#111;font-family:'Times New Roman',serif;font-size:13px;line-height:1.5;box-sizing:border-box;">
      <div style="display:flex;align-items:center;gap:14px;border-bottom:2px solid #E3B341;padding-bottom:12px;margin-bottom:18px;">
        <img src="${LOGO_B64}" style="height:54px;" />
        <div>
          <div style="font-size:18px;font-weight:bold;">S.C. GAZPET INSTAL S.R.L.</div>
          <div style="font-size:11px;color:#444;">Ploiești · CUI RO13038090</div>
        </div>
        <div style="margin-left:auto;text-align:right;font-size:11px;color:#444;">
          Nr. <strong>${numar}</strong><br/>Data: ${fmt(dataEmitere)}
        </div>
      </div>

      <div style="text-align:center;font-size:18px;font-weight:bold;letter-spacing:.5px;margin-bottom:4px;">DECLARAȚIE DE CONFORMITATE TEHNICĂ</div>
      <div style="text-align:center;font-size:12px;color:#555;margin-bottom:20px;">privind starea tehnică și utilizarea în siguranță a echipamentului</div>

      <p style="margin:0 0 12px 0;">
        Subscrisa <strong>S.C. GAZPET INSTAL S.R.L.</strong>, în calitate de deținător al echipamentului identificat mai jos,
        declarăm pe propria răspundere că:
      </p>

      <table style="width:100%;border-collapse:collapse;margin-bottom:14px;font-size:12.5px;">
        <tr><td style="padding:3px 6px;width:42%;color:#555;">Echipament</td><td style="padding:3px 6px;font-weight:bold;">${utilajNume}</td></tr>
        ${utilajSnapshot.serie ? `<tr><td style="padding:3px 6px;color:#555;">Serie / nr. identificare</td><td style="padding:3px 6px;">${utilajSnapshot.serie}</td></tr>` : ''}
        ${utilajSnapshot.cod_intern ? `<tr><td style="padding:3px 6px;color:#555;">Cod intern</td><td style="padding:3px 6px;">${utilajSnapshot.cod_intern}</td></tr>` : ''}
        ${utilajSnapshot.an ? `<tr><td style="padding:3px 6px;color:#555;">An fabricație</td><td style="padding:3px 6px;">${utilajSnapshot.an}</td></tr>` : ''}
        ${utilajSnapshot.ore ? `<tr><td style="padding:3px 6px;color:#555;">Ore funcționare</td><td style="padding:3px 6px;">${Number(utilajSnapshot.ore).toLocaleString('ro-RO')} ore</td></tr>` : ''}
      </table>

      <p style="margin:0 0 12px 0;">
        a fost supus operațiunilor de service și mentenanță, iar supapele de siguranță aferente au fost verificate și reglate
        de către ${emitenti}, rezultatele fiind <strong>conforme</strong> cu prescripția tehnică PT C7-2010, Colecția ISCIR:
      </p>

      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:12px;">
        <thead>
          <tr style="background:#f0e6c8;">
            <th style="border:1px solid #999;padding:6px 8px;text-align:left;">Supapă (serie)</th>
            <th style="border:1px solid #999;padding:6px 8px;text-align:left;">Buletin verificare</th>
            <th style="border:1px solid #999;padding:6px 8px;">Presiune reglare</th>
            <th style="border:1px solid #999;padding:6px 8px;">Valabil până</th>
          </tr>
        </thead>
        <tbody>${randuriSupape}</tbody>
      </table>

      <p style="margin:0 0 12px 0;">
        În urma verificărilor efectuate, declarăm că echipamentul <strong>corespunde din punct de vedere tehnic și poate fi
        utilizat în condiții de siguranță</strong>, în conformitate cu destinația sa și cu prescripțiile tehnice în vigoare.
      </p>

      <p style="margin:0 0 24px 0;font-size:12px;color:#333;">
        Prezenta declarație este valabilă până la data de <strong>${fmt(dataValab)}</strong>, corespunzătoare primei scadențe
        de verificare a supapelor de siguranță, și își încetează valabilitatea la expirarea, înlocuirea sau declararea ca
        neconformă a oricăreia dintre supapele de siguranță menționate mai sus.
      </p>

      <div style="display:flex;justify-content:flex-end;margin-top:10px;">
        <div style="text-align:center;width:280px;">
          <div style="font-size:12px;color:#333;margin-bottom:4px;">Întocmit,</div>
          ${semnaturaImg ? `<img src="${semnaturaImg}" style="height:48px;margin:2px 0;" />` : `<div style="height:48px;border-bottom:1px solid #111;margin:2px 20px 4px 20px;"></div>`}
          <div style="font-weight:bold;font-size:13px;">ing. MITRACHE ALEXANDRU</div>
          <div style="font-size:11px;color:#555;">Director Departament Logistică</div>
        </div>
      </div>

      <div style="margin-top:28px;padding-top:8px;border-top:1px solid #ccc;font-size:9px;color:#999;text-align:center;">
        Document generat electronic din sistemul Gazpet ERP · ${new Date().toLocaleString('ro-RO')} · valabil cu verificările supapelor de siguranță în termen
      </div>
    </div>`;

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-9999px;top:0;';
  host.innerHTML = html;
  document.body.appendChild(host);
  try {
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const canvas = await html2canvas(host.firstElementChild, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const imgW = 210, imgH = (canvas.height * imgW) / canvas.width;
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, imgW, Math.min(imgH, 297), undefined, 'FAST');
    return pdf.output('blob');
  } finally {
    document.body.removeChild(host);
  }
}
