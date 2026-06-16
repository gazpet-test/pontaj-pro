// ===========================================================================
// BUG REPORT BUTTON 🐛 — buton flotant global (stânga-jos)
// 15.06.2026 v1 — Raportare bug-uri APP de către useri → tichet în departament IT
// 15.06.2026 v2 — Etichetă „Buuuuuuuug :(" deasupra butonului + comutator
//   🐛 Nu merge ceva (eroare_erp) / 💡 Vreau o îmbunătățire (cerere_functie)
//   Descriere obligatorie (min 30 car.) + poză obligatorie (captură viewport
//   cu html2canvas SAU upload/„fă poză" pe mobil). Auto: pagina + userAgent +
//   rezoluție în metadata. Notificare la owners prin trigger fn_tichete_notif_on_insert
//   (receive_tichete_it=true). Reuse modul Tichete — fără tabelă nouă.
//   Spec: claude_context „Buton Bug Report 🐛 integrat în Tichete IT" (11.06 + review 12.06)
// ===========================================================================

import React, { useState } from 'react'
import { supabase } from './lib/supabase.js'
import html2canvas from 'html2canvas'
import { compressFileBeforeUpload } from './compressFile.js'

const G = {
  bg:'#0D1117', surface:'#161B22', text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  border:'#30363D', orange:'#F0883E', red:'#F85149', green:'#2EA043', yellow:'#D29922', blue:'#1F6FEB',
}

const MIN_DESC = 30

export default function BugReportButton({ profile }) {
  const [open, setOpen] = useState(false)
  const [tip, setTip] = useState('bug')          // 'bug' | 'feature'
  const [hidden, setHidden] = useState(false)   // ascunde widgetul în timpul capturii
  const [desc, setDesc] = useState('')
  const [pozaFile, setPozaFile] = useState(null)
  const [pozaPreview, setPozaPreview] = useState('')
  const [capturing, setCapturing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [doneNr, setDoneNr] = useState('')

  if (!profile) return null

  function reset() {
    setDesc(''); setPozaFile(null); setPozaPreview(''); setErr(''); setDoneNr(''); setTip('bug')
  }
  function close() { setOpen(false); reset() }

  // Captură doar viewport-ul vizibil (ascunde modalul + 2× rAF înainte)
  async function captureScreen() {
    setErr(''); setCapturing(true); setHidden(true)
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    try {
      const canvas = await html2canvas(document.body, {
        x: window.scrollX, y: window.scrollY,
        width: window.innerWidth, height: window.innerHeight,
        windowWidth: document.documentElement.scrollWidth,
        windowHeight: document.documentElement.scrollHeight,
        scale: Math.min(window.devicePixelRatio || 1, 2),
        useCORS: true, logging: false, backgroundColor: G.bg,
      })
      const dataUrl = canvas.toDataURL('image/png')
      canvas.toBlob(blob => {
        if (blob) {
          setPozaFile(new File([blob], `screenshot_${Date.now()}.png`, { type: 'image/png' }))
          setPozaPreview(dataUrl)
        } else {
          setErr('Captura a eșuat — încarcă manual o poză.')
        }
        setHidden(false); setCapturing(false)
      }, 'image/png')
    } catch (e) {
      setErr('Captură eșuată: ' + (e.message || e) + ' — încarcă manual o poză.')
      setHidden(false); setCapturing(false)
    }
  }

  function handleUpload(file) {
    if (!file) return
    if (!file.type.startsWith('image/')) { setErr('Doar imagini.'); return }
    if (file.size > 12 * 1024 * 1024) { setErr('Imagine prea mare (max 12MB).'); return }
    setErr('')
    setPozaFile(file)
    const reader = new FileReader()
    reader.onload = () => setPozaPreview(reader.result)
    reader.readAsDataURL(file)
  }

  async function handleSubmit() {
    const d = desc.trim()
    if (d.length < MIN_DESC) { setErr(`Descrierea trebuie să aibă minim ${MIN_DESC} caractere (acum ${d.length}).`); return }
    if (!pozaFile) { setErr('Poza e obligatorie — capturează ecranul sau încarcă o imagine.'); return }
    setSaving(true); setErr('')
    try {
      const pagina = window.location.pathname + (window.location.search || '')
      const eFeature = tip === 'feature'
      const payload = {
        departament: 'it',
        subcategorie: eFeature ? 'cerere_functie' : 'eroare_erp',
        titlu: ((eFeature ? '💡 ' : '🐛 ') + d.split('\n')[0]).slice(0, 90),
        descriere: d + `\n\n— ${eFeature ? 'Cerere îmbunătățire' : 'Bug'} raportat(ă) automat din pagina: ${pagina}`,
        urgenta: 'normal',
        status: 'deschis',
        deschis_de: profile?.id,
        entitate_tip: 'pagina_app',
        entitate_descriere: pagina,
        metadata: {
          sursa: eFeature ? 'feature_request' : 'bug_report',
          tip,
          pagina,
          url: window.location.href,
          user_agent: navigator.userAgent,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          ecran: `${window.screen?.width || '?'}x${window.screen?.height || '?'}`,
          raportat_la: new Date().toISOString(),
        },
      }
      const { data: tk, error } = await supabase.from('tichete').insert(payload).select().single()
      if (error) throw error

      // upload poza → bucket tichete-atasamente (același ca în Tichete.jsx)
      // FIX 16.06.2026: comprimă/normalizează ca JPEG ≤2048px ÎNAINTE de upload.
      //   Bucket-ul acceptă doar jpeg/png/webp/heic/pdf + limită 10MB; pozele mari
      //   de pe telefon sau mime-uri neacceptate erau respinse silent → tichet fără poză.
      let toUpload = pozaFile
      try { toUpload = await compressFileBeforeUpload(pozaFile) } catch (_) { toUpload = pozaFile }
      const ext = (toUpload.name.split('.').pop() || 'jpg').toLowerCase()
      const path = `${tk.id}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
      const { error: upErr } = await supabase.storage.from('tichete-atasamente').upload(path, toUpload, { contentType: toUpload.type || 'image/jpeg' })
      if (upErr) {
        // tichetul s-a creat, dar poza nu — eroare VIZIBILĂ ca să poată reîncerca
        console.error('Upload poză bug:', upErr)
        setErr(`Tichetul ${tk.numar_tichet || '#' + tk.id} a fost creat, DAR poza nu s-a încărcat: ${upErr.message || 'eroare necunoscută'}. Deschide tichetul și reîncarcă poza, sau încearcă din nou cu altă imagine.`)
        setDoneNr((tk.numar_tichet || '#' + tk.id) + ' (⚠️ fără poză — vezi eroarea de sus)')
      } else {
        await supabase.from('tichete').update({ poze_paths: [path] }).eq('id', tk.id)
        setDoneNr(tk.numar_tichet || '#' + tk.id)
      }
    } catch (e) {
      setErr('Eroare la trimitere: ' + (e.message || e))
    } finally { setSaving(false) }
  }

  const descLen = desc.trim().length
  const canSubmit = descLen >= MIN_DESC && !!pozaFile && !saving

  return (
    <>
      {/* Buton flotant 🐛 + etichetă — stânga-jos (Nenicu e dreapta-jos) */}
      {!hidden && !open && (
        <div style={{
          position: 'fixed', bottom: 24, left: 24, zIndex: 9996,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
        }}>
          <div style={{
            background: G.surface, color: G.orange, border: `1px solid ${G.orange}66`,
            borderRadius: 8, padding: '3px 10px', fontSize: 12, fontWeight: 800,
            whiteSpace: 'nowrap', boxShadow: '0 3px 10px rgba(0,0,0,.4)',
          }}>Buuuuuuuug :(</div>
          <button
            onClick={() => setOpen(true)}
            title="Raportează un bug sau o cerere"
            style={{
              width: 52, height: 52, borderRadius: '50%',
              background: G.surface, color: '#fff', border: `2px solid ${G.orange}`,
              boxShadow: '0 6px 20px rgba(0,0,0,.45)', cursor: 'pointer', fontSize: 24,
              display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'transform .15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.1)' }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)' }}
          >🐛</button>
        </div>
      )}

      {/* Modal */}
      {open && !hidden && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 16,
        }} onClick={e => e.target === e.currentTarget && !saving && close()}>
          <div style={{
            background: G.surface, border: `1px solid ${G.border}`, borderRadius: 14,
            width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto', padding: 22,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: G.text }}>🐛 Raportează un bug / o cerere</div>
              <button onClick={close} disabled={saving} style={{ background: 'none', border: 'none', color: G.muted, cursor: 'pointer', fontSize: 22, lineHeight: 1 }}>×</button>
            </div>

            {doneNr ? (
              <div style={{ textAlign: 'center', padding: '20px 8px' }}>
                <div style={{ fontSize: 40, marginBottom: 10 }}>{err ? '⚠️' : '✅'}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: G.text, marginBottom: 6 }}>Mulțumim! {tip === 'feature' ? 'Cererea a fost trimisă' : 'Bug-ul a fost trimis'}.</div>
                <div style={{ fontSize: 13, color: G.muted, marginBottom: err ? 12 : 18 }}>Tichet <b style={{ color: G.text }}>{doneNr}</b> creat în departamentul IT. Se rezolvă cât de repede.</div>
                {err && <div style={{ padding: '9px 12px', background: G.red + '22', color: G.red, borderRadius: 8, fontSize: 12.5, marginBottom: 16, textAlign: 'left' }}>{err}</div>}
                <button onClick={close} style={{ padding: '9px 20px', background: G.orange, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>Închide</button>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 12, color: G.muted, marginBottom: 12, lineHeight: 1.5 }}>
                  Pagina curentă se atașează automat. Spune clar despre ce e vorba.
                </div>

                {/* Comutator: bug vs cerere îmbunătățire */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                  {[
                    { val: 'bug', label: '🐛 Nu merge ceva', color: G.red },
                    { val: 'feature', label: '💡 Vreau o îmbunătățire', color: G.yellow },
                  ].map(o => (
                    <button key={o.val} type="button" onClick={() => setTip(o.val)} style={{
                      flex: 1, padding: '10px 8px', borderRadius: 8, cursor: 'pointer', fontSize: 12.5, fontWeight: 700,
                      background: tip === o.val ? o.color + '22' : G.bg,
                      color: tip === o.val ? o.color : G.muted,
                      border: `2px solid ${tip === o.val ? o.color : G.border}`,
                    }}>{o.label}</button>
                  ))}
                </div>

                <label style={{ fontSize: 11, fontWeight: 700, color: G.muted, textTransform: 'uppercase', letterSpacing: 0.4, display: 'block', marginBottom: 4 }}>Descriere *</label>
                <textarea
                  value={desc} onChange={e => setDesc(e.target.value)} rows={4}
                  placeholder={tip === 'feature'
                    ? 'Ex: pe pagina Contracte aș vrea un buton de export în Excel și o coloană cu data scadenței...'
                    : 'Ex: pe pagina Logistică, când apăs pe Import EvoGPS, modalul nu se deschide și apare ecran alb...'}
                  style={{ width: '100%', padding: '10px 12px', background: G.bg, color: G.text, border: `1px solid ${descLen > 0 && descLen < MIN_DESC ? G.yellow : G.border}`, borderRadius: 8, fontSize: 13, outline: 'none', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit', colorScheme: 'dark' }} />
                <div style={{ fontSize: 11, color: descLen < MIN_DESC ? G.yellow : G.green, marginTop: 3, marginBottom: 14 }}>
                  {descLen < MIN_DESC ? `Încă ${MIN_DESC - descLen} caractere` : `✓ ${descLen} caractere`}
                </div>

                <label style={{ fontSize: 11, fontWeight: 700, color: G.muted, textTransform: 'uppercase', letterSpacing: 0.4, display: 'block', marginBottom: 6 }}>Poză * (obligatorie)</label>
                {pozaPreview ? (
                  <div style={{ marginBottom: 12 }}>
                    <img src={pozaPreview} alt="captură" style={{ width: '100%', maxHeight: 180, objectFit: 'contain', borderRadius: 8, border: `1px solid ${G.border}`, background: G.bg }} />
                    <button onClick={() => { setPozaFile(null); setPozaPreview('') }} style={{ marginTop: 6, padding: '4px 10px', background: 'transparent', color: G.red, border: `1px solid ${G.red}44`, borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>🗑 Șterge poza</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                    <button onClick={captureScreen} disabled={capturing} style={{ flex: 1, minWidth: 150, padding: '10px 12px', background: G.blue + '22', color: G.blue, border: `1px solid ${G.blue}55`, borderRadius: 8, cursor: capturing ? 'wait' : 'pointer', fontSize: 12.5, fontWeight: 700 }}>
                      {capturing ? '⏳ Se capturează...' : '📸 Capturează ecranul'}
                    </button>
                    <label style={{ flex: 1, minWidth: 150, padding: '10px 12px', background: G.bg, color: G.text, border: `1px solid ${G.border}`, borderRadius: 8, cursor: 'pointer', fontSize: 12.5, fontWeight: 700, textAlign: 'center' }}>
                      📷 Încarcă / Fă poză
                      <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={e => handleUpload(e.target.files?.[0])} />
                    </label>
                  </div>
                )}

                {err && <div style={{ padding: '9px 12px', background: G.red + '22', color: G.red, borderRadius: 8, fontSize: 12.5, marginBottom: 12 }}>⚠️ {err}</div>}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button onClick={close} disabled={saving} style={{ padding: '9px 16px', background: 'transparent', color: G.muted, border: `1px solid ${G.border}`, borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>Anulează</button>
                  <button onClick={handleSubmit} disabled={!canSubmit} style={{ padding: '9px 18px', background: canSubmit ? G.orange : G.border, color: '#fff', border: 'none', borderRadius: 8, cursor: canSubmit ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 700, opacity: saving ? 0.7 : 1 }}>
                    {saving ? '⏳ Se trimite...' : (tip === 'feature' ? '💡 Trimite cererea' : '🐛 Trimite bug-ul')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
