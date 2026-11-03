// Redări › Registru › „📱 SMS proprietari” (MVP 03.11.2026). Doar owner-ul îl vede (Redari.jsx îl montează cu profile.is_owner);
// BD-ul refuză oricum crearea / aprobarea / trimiterea unui lot `redari` cât timp sms_setari.redari_autorizat = false.
// Lotul se construiește din convocările ACTIVE ale proiectului (sau ale UAT-ului din filtru), către telefoanele din contactul deținătorului.
// Aici doar se previzualizează și se creează lotul (draft); aprobarea și trimiterea sunt în Administrator → 📱 SMS.
import { useEffect, useState } from 'react'
import { G, S, Modal } from '../redari/ui/comune.jsx'
import { smsApi, mesajEroare } from './smsApi.js'
import { contorText, motivBlocareRedari, fmtEur, zileLaPlafon } from './smsLogica.js'

export function RedariSmsFereastra({ proiect, uats, uatInitial, onClose, show }) {
  const [text, setText] = useState('')
  const [uatId, setUatId] = useState(uatInitial || '')
  const [preview, setPreview] = useState(null)
  const [lucru, setLucru] = useState(false)
  const [eroare, setEroare] = useState('')
  const c = contorText(text)
  useEffect(() => { setPreview(null) }, [text, uatId])
  const previzualizeaza = async () => {
    setLucru(true); setEroare('')
    try { setPreview(await smsApi.creeazaRedari({ text, proiectId: proiect.id, uatId, preview: true })) }
    catch (e) { setPreview(null); setEroare(mesajEroare(e)) }
    finally { setLucru(false) }
  }
  const creeaza = async () => {
    if (!preview || !window.confirm(`Creez lotul Redări (draft) pentru ${preview.nr_destinatari} proprietari, cost estimat ${fmtEur(preview.cost_estimat_eur)}?\n\nTextul:\n${preview.text_final}\n\nNu pleacă nimic până nu îl aprobi și îl trimiți din Administrator → 📱 SMS.`)) return
    setLucru(true); setEroare('')
    try {
      const j = await smsApi.creeazaRedari({ text, proiectId: proiect.id, uatId, preview: false })
      show?.(`Lot Redări creat (draft, ${j.nr_destinatari} destinatari). Aprobarea: Administrator → 📱 SMS.`, 'success')
      onClose()
    } catch (e) { setEroare(mesajEroare(e)) }
    finally { setLucru(false) }
  }
  return <Modal titlu={`📱 SMS proprietari — ${proiect.cod}`} onClose={onClose} latime={620}>
    <p style={{ fontSize: 12.5, color: G.muted, marginTop: 0 }}>Informare, nu convocare: SMS-ul NU înlocuiește convocarea scrisă cu confirmare de primire. Pleacă doar între 08:00 și 20:00, după aprobarea ta.</p>
    <label style={{ fontSize: 13, fontWeight: 600 }}>UAT</label>
    <select value={uatId} onChange={e => setUatId(e.target.value)} style={{ ...S.select, width: '100%', margin: '4px 0 10px' }}>
      <option value="">Tot proiectul</option>
      {(uats || []).map(u => <option key={u.id} value={u.id}>{u.uat3} — {u.nume}</option>)}
    </select>
    <label style={{ fontSize: 13, fontWeight: 600 }}>Textul (GSM-7, max 160)</label>
    <textarea value={text} onChange={e => setText(e.target.value)} rows={4} maxLength={600} style={{ ...S.input, width: '100%', marginTop: 4, resize: 'vertical' }}
      placeholder="Ex.: Reamintire: sesiunea de constatare a redarii terenului, la Primaria X, pe 12.11, ora 9. Info: 07xx xxx xxx (Gazpet)" />
    <div style={{ fontSize: 12, color: c.ok || !text ? G.muted : G.red, marginTop: 4 }}>{c.eticheta}</div>
    {c.avertismente.map(a => <div key={a} style={{ fontSize: 12, color: G.yellow, marginTop: 2 }}>{a}</div>)}
    {c.text && <div style={{ fontSize: 12.5, marginTop: 8 }}><b>Textul trimis:</b> {c.text}</div>}
    {preview && <div style={{ ...S.card, marginTop: 10, fontSize: 13 }}>
      <div><b>{preview.nr_destinatari}</b> proprietari · cost estimat <b>{fmtEur(preview.cost_estimat_eur)}</b></div>
      <div style={{ fontSize: 12, color: G.muted, marginTop: 4 }}>Excluși: {preview.excluse_fara_mobil} fără mobil RO · {preview.excluse_optout} opt-out · {preview.excluse_duplicat} telefon dublat (din {preview.candidati} deținători cu convocare activă)</div>
      {preview.depaseste_plafon_zi && <div style={{ fontSize: 12, color: G.yellow, marginTop: 4 }}>Peste plafonul zilnic ({preview.plafon_zi}): ~{zileLaPlafon(preview.nr_destinatari, preview.plafon_zi)} zile.</div>}
      <div style={{ marginTop: 6 }}><b>Textul trimis (din BD):</b> {preview.text_final}</div>
    </div>}
    {eroare && <div role="alert" style={{ color: G.red, fontSize: 13, marginTop: 8 }}>{eroare}</div>}
    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
      <button onClick={onClose} style={S.btnS}>Închide</button>
      <button onClick={previzualizeaza} disabled={lucru || !c.ok} style={S.btnS}>🔍 Previzualizează</button>
      <button onClick={creeaza} disabled={lucru || !preview} style={{ ...S.btnP, opacity: preview ? 1 : 0.5 }}>＋ Creează lot (draft)</button>
    </div>
  </Modal>
}

// panouInitial: doar pentru teste (randare fără rețea)
export default function RedariSmsButon({ proiect, uats, uatId, show, panouInitial = null }) {
  const [panou, setPanou] = useState(panouInitial)
  const [deschis, setDeschis] = useState(false)
  useEffect(() => {
    if (panouInitial) return
    let activ = true
    smsApi.panou().then(p => { if (activ) setPanou(p) }).catch(() => { if (activ) setPanou({ redari_autorizat: false }) })
    return () => { activ = false }
  }, [panouInitial])
  const motiv = motivBlocareRedari(panou)
  return <>
    <button onClick={() => !motiv && setDeschis(true)} disabled={!!motiv} title={motiv || 'Lot SMS către proprietarii cu convocare activă'}
      style={{ ...S.btnS, opacity: motiv ? 0.5 : 1, cursor: motiv ? 'not-allowed' : 'pointer' }}>📱 SMS proprietari{motiv ? ` — ${motiv}` : ''}</button>
    {deschis && <RedariSmsFereastra proiect={proiect} uats={uats} uatInitial={uatId} show={show} onClose={() => setDeschis(false)} />}
  </>
}
