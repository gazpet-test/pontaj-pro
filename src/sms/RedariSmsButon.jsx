// Redări › Registru › „📱 SMS proprietari” (MVP 03.11.2026). Redari.jsx îl montează pentru owner și pentru Redări editor / admin; butonul
// se arată doar dacă BD-ul (fn_sms_panou) dă un nivel SMS care poate lucra cu Redări: owner, sau utilizator SMS cu modulul Redări
// (20261130b). Contul de test SMS și conturile fără nivel SMS nu îl văd. BD-ul refuză oricum crearea / aprobarea / trimiterea unui lot
// `redari` cât timp sms_setari.redari_autorizat = false sau nivelul nu permite.
// 20261130c (deciziile lui Razvan, 03.11.2026): ȘABLON FIX pe UAT. Operatorul alege primăria; textul se completează singur
// (sablonRedari.js: Setări UAT + telefonul de contact al proiectului) și NU se editează. Lipsește un câmp sau textul trece de 160 →
// crearea e blocată, cu motivul. Destinatarii îi fixează BD-ul (fn_sms_lot_redari_sablon_creeaza): doar deținătorii convocați din UAT
// care n-au răspuns încă și n-au PV semnat, un SMS de persoană; BD-ul refă textul și refuză lotul dacă diferă de cel afișat.
// Aici doar se previzualizează și se creează lotul (draft); aprobarea și trimiterea sunt în 📱 SMS → Istoric (ruta /sms), ca înainte.
// r2 (Jakarinos r1 P1): după creare se afișează lista FIXATĂ în lot (fn_sms_lot_destinatari: nume + telefon mascat) — aceeași listă și
// aceeași versiune pe care owner-ul le aprobă apoi din Istoric.
import { useEffect, useRef, useState } from 'react'
import { G, S, Modal } from '../redari/ui/comune.jsx'
import { smsApi, mesajEroare } from './smsApi.js'
import { motivBlocareRedari, fmtEur, zileLaPlafon } from './smsLogica.js'
import { completeazaSablon, aziBucuresti } from './sablonRedari.js'
import { MAX_GSM } from '../../supabase/functions/_shared/smsText.mjs'

/** Ce blochează crearea după previzualizare (null = se poate crea). */
export function motivBlocareCreare(sablon, preview) {
  if (!preview) return 'Previzualizează întâi'
  if (preview.text_final !== sablon?.text) return 'Textul din BD diferă de cel afișat (setările UAT / proiectului s-au schimbat între timp): închide și redeschide fereastra'
  if (preview.lot_activ_uat) return 'UAT-ul are deja un lot activ (draft / aprobat / în trimitere): anulează-l sau așteaptă-l din 📱 SMS → Istoric'
  if (!(Number(preview.nr_destinatari) > 0)) return 'Niciun proprietar de anunțat în acest UAT'
  return null
}

// aziInitial și previewInitial: doar pentru teste (ziua fixă, randare fără rețea)
export function RedariSmsFereastra({ proiect, uats, uatInitial, onClose, show, aziInitial = null, previewInitial = null }) {
  const [uatId, setUatId] = useState(uatInitial || '')
  const [preview, setPreview] = useState(previewInitial)
  const [lucru, setLucru] = useState(false)
  const [eroare, setEroare] = useState('')
  const [creat, setCreat] = useState(null)
  // token de generație: un răspuns sosit după schimbarea UAT-ului (sau după închidere) nu se mai aplică
  const gen = useRef(0)
  const primaRandare = useRef(true)
  const uat = (uats || []).find(u => u.id === uatId) || null
  const sablon = uat ? completeazaSablon({ uat, proiect, azi: aziInitial || aziBucuresti() }) : null
  useEffect(() => {
    if (primaRandare.current) { primaRandare.current = false; return }
    gen.current += 1; setPreview(null); setEroare(''); setLucru(false)
  }, [uatId])
  useEffect(() => () => { gen.current += 1 }, [])
  const previzualizeaza = async () => {
    const g = ++gen.current
    setLucru(true); setEroare('')
    try {
      const j = await smsApi.creeazaRedariSablon({ proiectId: proiect.id, uatId, preview: true })
      if (g === gen.current) setPreview(j)
    } catch (e) {
      if (g === gen.current) { setPreview(null); setEroare(mesajEroare(e)) }
    } finally {
      if (g === gen.current) setLucru(false)
    }
  }
  const blocareCreare = motivBlocareCreare(sablon, preview)
  const creeaza = async () => {
    if (blocareCreare || !window.confirm(`Creez lotul Redări (draft) pentru ${preview.nr_destinatari} proprietari, cost estimat ${fmtEur(preview.cost_estimat_eur)}?\n\nTextul:\n${preview.text_final}\n\nNu pleacă nimic până nu îl aprobi și îl trimiți din 📱 SMS → Istoric.`)) return
    const g = ++gen.current
    setLucru(true); setEroare('')
    try {
      const j = await smsApi.creeazaRedariSablon({ proiectId: proiect.id, uatId, textAfisat: preview.text_final, preview: false })
      show?.(`Lot Redări creat (draft, ${j.nr_destinatari} destinatari). Aprobarea: 📱 SMS → Istoric.`, 'success')
      const lista = await smsApi.destinatariLot(j.lot_id)
      if (g === gen.current) setCreat(lista)
    } catch (e) {
      if (g === gen.current) setEroare(mesajEroare(e))
    } finally {
      if (g === gen.current) setLucru(false)
    }
  }
  if (creat) return <Modal titlu={`📱 Lot Redări creat (draft) — ${proiect.cod}`} onClose={onClose} latime={620}>
    <p style={{ fontSize: 12.5, color: G.muted, marginTop: 0 }}>Lista e FIXATĂ în lot (versiunea {creat.versiune}). Aprobarea și trimiterea: 📱 SMS → Istoric, pe aceeași listă.</p>
    <div style={{ fontSize: 13 }}><b>Textul trimis:</b> {creat.text}</div>
    <div style={{ fontSize: 13, marginTop: 4 }}><b>{(creat.destinatari || []).length}</b> proprietari · {creat.segmente} SMS fiecare · cost estimat <b>{fmtEur(creat.cost_estimat_eur)}</b></div>
    <div style={{ ...S.card, marginTop: 10, maxHeight: 260, overflow: 'auto', padding: 0 }}>
      {(creat.destinatari || []).map(d => <div key={d.mesaj_id} style={{ display: 'flex', gap: 10, padding: '5px 10px', borderBottom: `1px solid ${G.border}`, fontSize: 13 }}>
        <span style={{ flex: 1 }}>{d.nume}</span><span style={{ color: G.muted }}>{d.telefon_mascat}</span>
      </div>)}
    </div>
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}><button onClick={onClose} style={S.btnS}>Închide</button></div>
  </Modal>
  const lungime = sablon?.text ? sablon.lungime : 0
  const poateCrea = !lucru && sablon?.ok === true && !blocareCreare
  return <Modal titlu={`📱 SMS proprietari — ${proiect.cod}`} onClose={onClose} latime={620}>
    <p style={{ fontSize: 12.5, color: G.muted, marginTop: 0 }}>Informare, nu convocare: SMS-ul NU înlocuiește convocarea scrisă cu confirmare de primire. Pleacă doar între 08:00 și 20:00, după aprobarea ta.</p>
    <label style={{ fontSize: 13, fontWeight: 600 }}>Primăria (UAT)</label>
    <select value={uatId} onChange={e => setUatId(e.target.value)} style={{ ...S.select, width: '100%', margin: '4px 0 10px' }}>
      <option value="">— alege UAT-ul —</option>
      {(uats || []).map(u => <option key={u.id} value={u.id}>{u.uat3} — {u.nume}</option>)}
    </select>
    <label style={{ fontSize: 13, fontWeight: 600 }}>Textul (șablon fix, nu se editează)</label>
    <div data-sablon="text" aria-readonly="true" style={{ ...S.card, marginTop: 4, fontSize: 13, minHeight: 40, color: sablon?.text ? G.text : G.muted }}>
      {sablon?.text || (uat ? 'Șablonul nu se poate completa (vezi mai jos ce lipsește).' : 'Alege UAT-ul: textul se completează din Setări UAT și Setări proiect.')}
    </div>
    <div style={{ fontSize: 12, color: sablon?.text && !sablon.ok ? G.red : G.muted, marginTop: 4 }}>{lungime}/{MAX_GSM} caractere GSM-7 · 1 SMS</div>
    {sablon?.motiv === 'lipsuri' && <div role="alert" style={{ fontSize: 12.5, color: G.red, marginTop: 6 }}>
      Nu se poate crea lotul. Lipsește:
      <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>{sablon.lipsuri.map(l => <li key={l.cod}>{l.mesaj}</li>)}</ul>
      <div style={{ color: G.muted, marginTop: 4 }}>Completează în Redări → UAT (Setări UAT) / Setări proiect, apoi redeschide fereastra.</div>
    </div>}
    {sablon?.motiv === 'prea_lung' && <div role="alert" style={{ fontSize: 12.5, color: G.red, marginTop: 6 }}>
      Nu se poate crea lotul: textul are {sablon.lungime} caractere GSM-7, maximum {MAX_GSM} într-un SMS. Scurtează numele UAT-ului în Setări UAT.
    </div>}
    {sablon?.motiv === 'caractere_nepermise' && <div role="alert" style={{ fontSize: 12.5, color: G.red, marginTop: 6 }}>
      Nu se poate crea lotul: caractere care nu există în GSM-7: {(sablon.nepermise || []).join(' ')} (Setări UAT / Setări proiect).
    </div>}
    {preview && <div style={{ ...S.card, marginTop: 10, fontSize: 13 }}>
      <div><b>{preview.nr_destinatari}</b> proprietari primesc SMS-ul · cost estimat <b>{fmtEur(preview.cost_estimat_eur)}</b></div>
      <div style={{ fontSize: 12, color: G.muted, marginTop: 4 }}>
        Din {preview.candidati} proprietari convocați în UAT, excluși: {preview.excluse_a_raspuns} au răspuns · {preview.excluse_pv_semnat} cu PV semnat ·
        {' '}{preview.excluse_fara_mobil} fără mobil RO · {preview.excluse_optout} opt-out · {preview.excluse_duplicat} telefon dublat (un SMS de persoană și de telefon)
      </div>
      {preview.depaseste_plafon_zi && <div style={{ fontSize: 12, color: G.yellow, marginTop: 4 }}>
        Peste plafonul zilnic{preview.plafon_zi != null ? ` (${preview.plafon_zi}): ~${zileLaPlafon(preview.nr_destinatari, preview.plafon_zi)} zile` : ''}.
      </div>}
      <div style={{ marginTop: 6 }}><b>Textul trimis (din BD):</b> {preview.text_final}</div>
      {blocareCreare && <div role="alert" style={{ fontSize: 12.5, color: G.yellow, marginTop: 6 }}>{blocareCreare}</div>}
    </div>}
    {eroare && <div role="alert" style={{ color: G.red, fontSize: 13, marginTop: 8 }}>{eroare}</div>}
    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
      <button onClick={onClose} style={S.btnS}>Închide</button>
      <button onClick={previzualizeaza} disabled={lucru || sablon?.ok !== true} style={S.btnS}>🔍 Previzualizează</button>
      <button onClick={creeaza} disabled={!poateCrea} style={{ ...S.btnP, opacity: poateCrea ? 1 : 0.5 }}>＋ Creează lot (draft)</button>
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
    // 42501 = fără nivel SMS: butonul nu apare; altă eroare = buton blocat, cu motivul
    smsApi.panou().then(p => { if (activ) setPanou(p) }).catch(e => { if (activ) setPanou(e?.code === '42501' ? { fara_acces: true } : { eroare: true }) })
    return () => { activ = false }
  }, [panouInitial])
  if (panou?.fara_acces || panou?.nivel === 'test' || (panou?.nivel && panou.nivel !== 'owner' && panou.redari_modul !== true)) return null
  const motiv = panou?.eroare ? 'Nu s-a putut verifica starea SMS' : motivBlocareRedari(panou)
  return <>
    <button onClick={() => !motiv && setDeschis(true)} disabled={!!motiv} title={motiv || 'Lot SMS din șablon către proprietarii convocați dintr-un UAT, care n-au răspuns încă'}
      style={{ ...S.btnS, opacity: motiv ? 0.5 : 1, cursor: motiv ? 'not-allowed' : 'pointer' }}>📱 SMS proprietari{motiv ? ` — ${motiv}` : ''}</button>
    {deschis && <RedariSmsFereastra proiect={proiect} uats={uats} uatInitial={uatId} show={show} onClose={() => setDeschis(false)} />}
  </>
}
