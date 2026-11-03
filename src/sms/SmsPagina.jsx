// 📱 SMS (MVP 03.11.2026, decizii Razvan) — ruta proprie /sms (modulul `sms`) + tab-ul din Administrator (owner).
// Niveluri (20261130b, decizia lui Razvan din 03.11.2026): owner = tot; utilizator (modulul `sms` editor / admin) și test (modulul `sms`
// viewer, contul AI) compun, previzualizează, creează loturi interne, văd lista fixată, aprobă și trimit; test = maximum 5 destinatari,
// fără Redări; Setările și Opt-out-ul = doar owner. BD-ul decide (fn_sms_nivel, RLS, RPC-uri, triggere), edge-ul sms-trimite verifică din
// nou nivelul. Flux: Compune → Previzualizează (RPC, nu scrie) → Creează lot (draft) → Aprobă (pe versiunea văzută) → Trimite (edge;
// kill-switch + plafoane verificate atomic în BD). Telefoanele apar doar mascate (07** *** 123).
// r2 (Jakarinos r1 P1): înainte de „Aprobă” se vede lista FIXATĂ în lot (fn_sms_lot_destinatari: nume + telefon mascat, text,
// segmente, cost) și se aprobă exact versiunea afișată; dacă lotul s-a schimbat → 40001 în BD, lista se reîncarcă. Copilot r1 P2-01: lotul
// nu are stare „trimis” — „coada golită”, iar rezultatul real e pe mesaje (livrat / eșuat / necunoscut / anulat).
// SMS-ul NU înlocuiește convocarea scrisă din Redări — e doar informare.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { smsApi, mesajEroare } from './smsApi.js'
import {
  STARI_LOT, STARI_MESAJ, motivTrimitere, contorText, argumenteIntern, departamente, filtreazaAngajati, zileLaPlafon,
  poateAproba, poateTrimite, poateAnula, valideazaAutorizare, valideazaPlafoane, fmtEur, fmtData, mascheazaTelefon,
  rezumatMesaje, mesajAnulare, poateActiona, notaNivel, areModulSms, NIVELURI, MAX_TEST, textSold,
} from './smsLogica.js'

const G = { bg: '#F1F5F9', surface: '#FFFFFF', border: '#E2E8EF', text: '#263642', muted: '#617282', blue: '#24778B', green: '#38765A', red: '#B74D55', yellow: '#946B20' }
const S = {
  panel: { background: G.surface, border: `1px solid ${G.border}`, borderRadius: 10, padding: 16 },
  button: { background: G.surface, color: G.text, border: `1px solid ${G.border}`, borderRadius: 7, padding: '9px 12px', minHeight: 40, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 },
  primar: { background: G.blue, color: '#fff', border: `1px solid ${G.blue}`, borderRadius: 7, padding: '9px 14px', minHeight: 40, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600 },
  input: { border: `1px solid ${G.border}`, borderRadius: 7, padding: '8px 10px', fontFamily: 'inherit', fontSize: 13, color: G.text, background: G.surface },
  small: { color: G.muted, fontSize: 12, lineHeight: 1.6 },
  row: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
}
const azi = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bucharest' }).format(new Date())

function Badge({ children, color = G.muted }) {
  return <span style={{ color, background: color + '18', borderRadius: 5, padding: '3px 7px', fontSize: 12, fontWeight: 600 }}>{children}</span>
}
function Mesaj({ m }) {
  if (!m) return null
  return <div role={m.tip === 'eroare' ? 'alert' : 'status'} style={{ ...S.panel, marginBottom: 14, color: m.tip === 'eroare' ? G.red : m.tip === 'ok' ? G.green : G.text }}>{m.text}</div>
}

// ── Soldul SMSLink (20261130d): doar owner-ul (fn_sold_sms_citeste refuză în BD pe oricine altcineva) ──────────────────────────
export function SoldSmslink({ soldInitial = null }) {
  const [sold, setSold] = useState(soldInitial)
  const [eroare, setEroare] = useState('')
  const [lucru, setLucru] = useState(false)
  useEffect(() => {
    if (soldInitial) return
    let activ = true
    smsApi.sold().then(s => { if (activ) { setSold(s); setEroare('') } }).catch(e => { if (activ) setEroare(mesajEroare(e)) })
    return () => { activ = false }
  }, [soldInitial])
  const citesteAcum = async () => {
    setLucru(true); setEroare('')
    try { await smsApi.citesteSold(); setSold(await smsApi.sold()) } catch (e) { setEroare(mesajEroare(e)) } finally { setLucru(false) }
  }
  const culoare = sold?.sub_prag ? G.red : sold?.alerta ? G.yellow : G.muted
  return <span style={{ ...S.row, gap: 6 }}>
    <span style={{ ...S.small, color: culoare }} title={sold?.sub_prag ? `Sub pragul de ${sold.prag} SMS: reîncarcă creditul` : sold?.eroare_dupa_citire ? `Ultima citire a eșuat (${sold.eroare})` : ''}>
      {eroare ? `Sold SMSLink: eroare (${eroare})` : textSold(sold)}{sold?.sub_prag ? ' ⚠' : ''}
    </span>
    <button type="button" style={{ ...S.button, minHeight: 28, padding: '3px 8px', fontSize: 12 }} aria-label="Citește soldul SMSLink acum" title="Citește soldul acum" disabled={lucru} onClick={citesteAcum}>{lucru ? '…' : '↻'}</button>
  </span>
}

// ── Banda de sus: starea trimiterii, consumul (owner) / cât mai pleacă azi (ceilalți), Redări ─────────────────────────────────
function StarePanou({ panou, soldInitial }) {
  if (!panou) return null
  const owner = panou.nivel === 'owner'
  return <section aria-label="Starea trimiterii" style={{ ...S.panel, ...S.row, justifyContent: 'space-between', marginBottom: 14 }}>
    <div style={S.row}>
      {panou.kill_switch ? <Badge color={G.red}>⛔ Trimiterea e OPRITĂ</Badge> : <Badge color={G.green}>✅ Trimiterea e pornită</Badge>}
      {owner && panou.kill_switch && panou.kill_motiv && <span style={S.small}>{panou.kill_motiv}</span>}
      {!owner && <Badge color={G.blue}>{NIVELURI[panou.nivel] || panou.nivel}</Badge>}
    </div>
    <div style={S.row}>
      {owner
        ? <span style={S.small}>Azi: <b>{panou.consum_zi}</b> / {panou.plafon_zi} · Luna: <b>{panou.consum_luna}</b> / {panou.plafon_luna}</span>
        : <span style={S.small}>Mai pot pleca azi: <b>{panou.ramas_zi ?? '—'}</b> SMS{panou.buget_test_zi ? ` (bugetul contului de test: ${panou.buget_test_zi} / zi)` : ''}</span>}
      {owner && <SoldSmslink soldInitial={soldInitial} />}
      {(owner || panou.redari_modul === true) && <Badge color={panou.redari_autorizat ? G.green : G.yellow}>{panou.redari_autorizat ? `Redări autorizat${owner && panou.redari_autorizare_nr ? ` (${panou.redari_autorizare_nr})` : ''}` : 'Redări: așteaptă autorizarea Transgaz'}</Badge>}
    </div>
  </section>
}

// ── Compune: text + destinatari → previzualizare din BD → lot draft ────────────────────────────────────────────────────────
function Compune({ panou, onCreat, setMesaj }) {
  const test = panou?.nivel === 'test'
  const [text, setText] = useState('')
  const [mod, setMod] = useState(test ? 'selectie' : 'toti')
  const [angajati, setAngajati] = useState(null)
  const [depAlese, setDepAlese] = useState([])
  const [selectati, setSelectati] = useState(() => new Set())
  const [filtruDep, setFiltruDep] = useState('')
  const [cauta, setCauta] = useState('')
  const [preview, setPreview] = useState(null)
  const [lucru, setLucru] = useState(false)
  const c = contorText(text)

  useEffect(() => {
    let activ = true
    smsApi.angajati().then(l => { if (activ) setAngajati(l) }).catch(e => { if (activ) { setAngajati([]); setMesaj({ tip: 'eroare', text: 'Angajați: ' + mesajEroare(e) }) } })
    return () => { activ = false }
  }, [setMesaj])
  // orice schimbare de text / destinatari invalidează previzualizarea (lotul se creează exact din ce s-a văzut)
  useEffect(() => { setPreview(null) }, [text, mod, depAlese, selectati])

  const listaDep = useMemo(() => departamente(angajati), [angajati])
  const vizibili = useMemo(() => filtreazaAngajati(angajati, { departament: filtruDep, cauta }), [angajati, filtruDep, cauta])
  const cuMobil = (angajati || []).filter(a => a.telefon_mascat && !a.optout).length
  // contul de test: cel mult MAX_TEST bifați (BD-ul refuză oricum un lot mai mare, la creare, aprobare și trimitere)
  const plin = test && selectati.size >= MAX_TEST
  const comuta = id => setSelectati(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const args = () => ({ text, ...argumenteIntern(mod, { departamente: depAlese, selectati: [...selectati] }) })

  const previzualizeaza = async () => {
    setLucru(true); setMesaj(null)
    try { setPreview(await smsApi.creeazaIntern({ ...args(), preview: true })) }
    catch (e) { setPreview(null); setMesaj({ tip: 'eroare', text: mesajEroare(e) }) }
    finally { setLucru(false) }
  }
  const creeaza = async () => {
    if (!preview) return
    if (!window.confirm(`Creez lotul (draft) pentru ${preview.nr_destinatari} destinatari, cost estimat ${fmtEur(preview.cost_estimat_eur)}?\n\nTextul trimis:\n${preview.text_final}\n\nNimic nu pleacă până nu aprobi și apeși „Trimite”.`)) return
    setLucru(true)
    try {
      const j = await smsApi.creeazaIntern({ ...args(), preview: false })
      setMesaj({ tip: 'ok', text: `Lot creat (draft): ${j.nr_destinatari} destinatari. Verifică lista fixată în lot și aprobă-l.` })
      setText(''); setPreview(null); setSelectati(new Set())
      onCreat?.(j.lot_id)
    } catch (e) { setMesaj({ tip: 'eroare', text: mesajEroare(e) }) }
    finally { setLucru(false) }
  }

  return <section aria-label="Compune SMS" style={{ display: 'grid', gap: 14 }}>
    <div style={S.panel}>
      <label htmlFor="sms-text" style={{ fontWeight: 600, fontSize: 14 }}>Textul SMS-ului (intern, către angajați)</label>
      <textarea id="sms-text" value={text} onChange={e => setText(e.target.value)} rows={4} maxLength={600} placeholder="Ex.: Mâine, 8:00, ședință generală la sediu."
        style={{ ...S.input, width: '100%', marginTop: 8, resize: 'vertical' }} />
      <div style={{ ...S.row, justifyContent: 'space-between', marginTop: 6 }}>
        <span style={{ ...S.small, color: c.ok || !text ? G.muted : G.red }}>{c.eticheta}</span>
        <span style={S.small}>GSM-7 fără diacritice · max 160 · fără link-uri scurtate public</span>
      </div>
      {c.avertismente.map(a => <p key={a} style={{ ...S.small, color: G.yellow, margin: '4px 0 0' }}>{a}</p>)}
      {c.text && <p style={{ fontSize: 13, margin: '10px 0 0', padding: 10, background: G.bg, borderRadius: 7 }}><b>Textul trimis:</b> {c.text}</p>}
    </div>
    <div style={S.panel}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Destinatari</div>
      {test && <p style={{ ...S.small, color: G.yellow, margin: '0 0 8px' }}>Cont de test: maximum {MAX_TEST} destinatari într-un lot, doar angajați (fără Redări).</p>}
      <div role="radiogroup" aria-label="Destinatari" style={S.row}>
        {[['toti', `Toți angajații activi cu mobil (${angajati ? cuMobil : '…'})`], ['departament', 'Pe departament'], ['selectie', 'Selecție manuală']].map(([k, l]) =>
          <label key={k} style={{ ...S.row, gap: 6, fontSize: 13 }}><input type="radio" name="sms-mod" checked={mod === k} onChange={() => setMod(k)} />{l}</label>)}
      </div>
      {mod === 'departament' && <div style={{ ...S.row, marginTop: 10 }}>
        {listaDep.map(d => <label key={d} style={{ ...S.row, gap: 6, fontSize: 13 }}><input type="checkbox" checked={depAlese.includes(d)}
          onChange={() => setDepAlese(v => v.includes(d) ? v.filter(x => x !== d) : [...v, d])} />{d}</label>)}
        {!listaDep.length && <span style={S.small}>Nu s-au putut citi departamentele.</span>}
      </div>}
      {mod === 'selectie' && <div style={{ marginTop: 10 }}>
        <div style={S.row}>
          <input aria-label="Caută angajat" value={cauta} onChange={e => setCauta(e.target.value)} placeholder="Caută după nume…" style={{ ...S.input, minWidth: 220 }} />
          <select aria-label="Filtru departament" value={filtruDep} onChange={e => setFiltruDep(e.target.value)} style={S.input}>
            <option value="">Toate departamentele</option>{listaDep.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <span style={S.small}>{selectati.size} selectați</span>
        </div>
        <div style={{ maxHeight: 280, overflow: 'auto', marginTop: 8, border: `1px solid ${G.border}`, borderRadius: 7 }}>
          {vizibili.map(a => <label key={a.id} style={{ ...S.row, gap: 8, padding: '6px 10px', borderBottom: `1px solid ${G.border}`, fontSize: 13, opacity: a.telefon_mascat && !a.optout ? 1 : 0.5 }}>
            <input type="checkbox" disabled={!a.telefon_mascat || a.optout || (plin && !selectati.has(a.id))} checked={selectati.has(a.id)} onChange={() => comuta(a.id)} />
            <span style={{ flex: 1 }}>{a.nume}</span><span style={S.small}>{a.departament}</span>
            <span style={S.small}>{a.optout ? 'opt-out' : a.telefon_mascat || 'fără mobil valid'}</span>
          </label>)}
          {angajati && !vizibili.length && <p style={{ ...S.small, padding: 10 }}>Niciun angajat în filtru.</p>}
        </div>
      </div>}
    </div>
    <div style={S.row}>
      <button type="button" style={S.button} disabled={lucru || !c.ok} onClick={previzualizeaza}>🔍 Previzualizează (din BD)</button>
      <button type="button" style={{ ...S.primar, opacity: preview ? 1 : 0.5 }} disabled={lucru || !preview} onClick={creeaza}>＋ Creează lot (draft)</button>
      <span style={S.small}>Previzualizarea nu scrie nimic; lotul creat nu pleacă până nu e aprobat.</span>
    </div>
    {preview && <div style={{ ...S.panel, borderColor: G.blue }} aria-live="polite">
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Previzualizare</div>
      <p style={{ margin: '4px 0', fontSize: 13 }}><b>{preview.nr_destinatari}</b> destinatari · {preview.segmente} SMS fiecare · cost estimat <b>{fmtEur(preview.cost_estimat_eur)}</b> (0,049 EUR/SMS, fără TVA)</p>
      <p style={{ ...S.small, margin: '4px 0' }}>Excluși: {preview.excluse_fara_mobil} fără mobil RO valid · {preview.excluse_optout} cu opt-out · {preview.excluse_duplicat} telefon dublat (din {preview.candidati} angajați în selecție)</p>
      {preview.depaseste_plafon_zi && (preview.plafon_zi != null
        ? <p style={{ ...S.small, color: G.yellow, margin: '4px 0' }}>Peste plafonul zilnic ({preview.plafon_zi}): lotul pleacă în ~{zileLaPlafon(preview.nr_destinatari, preview.plafon_zi)} zile, dacă nu mărești plafonul.</p>
        : <p style={{ ...S.small, color: G.yellow, margin: '4px 0' }}>Peste plafonul zilnic: lotul pleacă în mai multe zile (plafonul îl stabilește owner-ul).</p>)}
      {preview.coada_libera != null && <p style={{ ...S.small, color: preview.coada_libera < preview.nr_destinatari ? G.red : G.muted, margin: '4px 0' }}>Coada contului de test: mai încap {preview.coada_libera} mesaje în așteptare{preview.coada_libera < preview.nr_destinatari ? ' — lotul nu se poate crea până nu trimiți sau anulezi din cele în așteptare.' : '.'}</p>}
      <p style={{ fontSize: 13, margin: '6px 0 0', padding: 10, background: G.bg, borderRadius: 7 }}><b>Textul trimis (din BD):</b> {preview.text_final}</p>
    </div>}
    {panou?.kill_switch && <p style={S.small}>Trimiterea e oprită: poți crea și aproba loturi, dar nu pleacă nimic până nu {panou?.nivel === 'owner' ? 'o pornești din Setări' : 'o pornește owner-ul'}.</p>}
  </section>
}

// ── Revizia înainte de aprobare: lista FIXATĂ în lot (din sms_mesaje), aprobarea pe versiunea afișată ─────────────────────────
export function RevizieLot({ lotId, onAprobat, onInchide, detaliiInitiale = null }) {
  const [det, setDet] = useState(detaliiInitiale)
  const [eroare, setEroare] = useState('')
  const [bifat, setBifat] = useState(false)
  const [lucru, setLucru] = useState(false)
  const incarca = useCallback(async () => {
    setDet(null); setBifat(false)
    try { setDet(await smsApi.destinatariLot(lotId)) } catch (e) { setEroare(mesajEroare(e)) }
  }, [lotId])
  useEffect(() => { if (!detaliiInitiale) incarca() }, [incarca, detaliiInitiale])
  const aproba = async () => {
    setLucru(true); setEroare('')
    try { await smsApi.aproba(det.lot_id, det.versiune); onAprobat?.() }
    catch (e) {
      if (e?.code === '40001') { await incarca(); setEroare('Lotul s-a schimbat între timp: am reîncărcat lista — verific-o din nou înainte de aprobare.') }
      else setEroare(mesajEroare(e))
    } finally { setLucru(false) }
  }
  if (!det) return <div style={{ ...S.panel, marginTop: 8 }}><span style={S.small}>{eroare || 'Se încarcă lista fixată în lot…'}</span></div>
  const lista = det.destinatari || []
  // nivelul contului permite aprobarea? (BD-ul o refuză oricum; test = doar interne de maximum 5)
  const permis = det.actiune_permisa !== false
  return <div style={{ ...S.panel, marginTop: 8, borderColor: G.blue }} aria-label="Revizia lotului înainte de aprobare">
    <div style={{ fontWeight: 600, marginBottom: 6 }}>Ce aprobi (fixat în lot, versiunea {det.versiune})</div>
    <p style={{ fontSize: 13, margin: '4px 0', padding: 10, background: G.bg, borderRadius: 7 }}><b>Textul trimis:</b> {det.text}</p>
    <p style={{ fontSize: 13, margin: '4px 0' }}><b>{lista.length}</b> destinatari · {det.lungime}/160 caractere · {det.segmente} SMS fiecare · cost estimat <b>{fmtEur(det.cost_estimat_eur)}</b>
      {det.categorie === 'redari' ? ' · 🌾 Redări (extern): informare, nu convocare; pleacă doar 08:00–20:00' : ''}</p>
    {lista.length !== det.nr_destinatari && <p style={{ ...S.small, color: G.red }}>Lista are {lista.length} mesaje, lotul declară {det.nr_destinatari}: aprobarea va fi refuzată — anulează lotul.</p>}
    <div style={{ maxHeight: 300, overflow: 'auto', border: `1px solid ${G.border}`, borderRadius: 7, margin: '8px 0' }}>
      {lista.map(d => <div key={d.mesaj_id} style={{ ...S.row, gap: 8, padding: '5px 10px', borderBottom: `1px solid ${G.border}`, fontSize: 13 }}>
        <span style={{ flex: 1 }}>{d.nume}</span><span style={S.small}>{d.telefon_mascat}</span>
        {d.stare !== 'in_coada' && <span style={{ ...S.small, color: G.yellow }}>{STARI_MESAJ[d.stare] || d.stare}</span>}
      </div>)}
    </div>
    {eroare && <p role="alert" style={{ ...S.small, color: G.red }}>{eroare}</p>}
    {!permis && <p role="alert" style={{ ...S.small, color: G.red }}>Nivelul tău nu poate aproba acest lot{det.nivel === 'test' ? ` (contul de test: doar loturi interne de maximum ${MAX_TEST} destinatari)` : ''}.</p>}
    <label style={{ ...S.row, gap: 6, fontSize: 13 }}><input type="checkbox" checked={bifat} disabled={!permis} onChange={e => setBifat(e.target.checked)} />Am verificat lista de {lista.length} destinatari și textul</label>
    <div style={{ ...S.row, marginTop: 8 }}>
      <button type="button" style={{ ...S.primar, opacity: permis && bifat && det.stare === 'draft' ? 1 : 0.5 }} disabled={lucru || !permis || !bifat || det.stare !== 'draft'} onClick={aproba}>✔ Aprob acest lot (versiunea {det.versiune})</button>
      <button type="button" style={S.button} disabled={lucru} onClick={onInchide}>Renunță</button>
    </div>
  </div>
}

// ── Istoric: loturi + aprobare / trimitere / anulare + mesajele unui lot ───────────────────────────────────────────────────
function Istoric({ panou, reincarcaPanou, evidentiat, setMesaj }) {
  const [loturi, setLoturi] = useState(null)
  const [revizie, setRevizie] = useState(evidentiat || null)
  const [deschis, setDeschis] = useState(null)
  const [mesaje, setMesaje] = useState(null)
  const [lucru, setLucru] = useState(false)
  const incarca = useCallback(async () => {
    try { setLoturi(await smsApi.loturi()) } catch (e) { setLoturi([]); setMesaj({ tip: 'eroare', text: 'Loturi: ' + mesajEroare(e) }) }
  }, [setMesaj])
  useEffect(() => { incarca() }, [incarca])
  useEffect(() => {
    if (!deschis) { setMesaje(null); return }
    let activ = true
    smsApi.mesaje(deschis).then(m => { if (activ) setMesaje(m) }).catch(e => { if (activ) setMesaj({ tip: 'eroare', text: 'Mesaje: ' + mesajEroare(e) }) })
    return () => { activ = false }
  }, [deschis, setMesaj])

  const actiune = async (fn, succes) => {
    setLucru(true); setMesaj(null)
    try { const r = await fn(); setMesaj({ tip: 'ok', text: succes(r) }) }
    catch (e) { setMesaj({ tip: 'eroare', text: mesajEroare(e) }) }
    finally { setLucru(false); await incarca(); reincarcaPanou(); if (deschis) setMesaje(await smsApi.mesaje(deschis).catch(() => null)) }
  }
  const dupaAprobare = async () => {
    setRevizie(null)
    setMesaj({ tip: 'ok', text: 'Lot aprobat (lista fixată, versiunea verificată). Apasă „Trimite” când vrei să plece.' })
    await incarca(); reincarcaPanou()
  }
  const trimite = l => {
    if (!window.confirm(`Trimit ACUM lotul aprobat (${l.n_in_coada} mesaje în coadă)?\nPlafon rămas azi: ${panou?.ramas_zi ?? '—'}.`)) return
    actiune(() => smsApi.trimite(l.id), r => `Trimise: ${r?.trimise ?? 0} · eșuate: ${r?.esuate ?? 0} · necunoscute: ${r?.necunoscute ?? 0}. ${motivTrimitere(r?.motiv)}`)
  }
  const anuleaza = l => {
    const motiv = window.prompt('Motivul anulării (opțional). Mesajele din coadă nu mai pleacă; cele deja predate furnizorului nu se pot opri și rămân în istoric.', '')
    if (motiv === null) return
    actiune(() => smsApi.anuleaza(l.id, motiv), r => mesajAnulare(r))
  }

  if (!loturi) return <p style={S.small}>Se încarcă loturile…</p>
  if (!loturi.length) return <p style={{ ...S.panel, ...S.small }}>Niciun lot încă. Creează unul din „Compune”.</p>
  return <section aria-label="Istoric loturi" style={{ ...S.panel, padding: 0 }}>
    {loturi.map(l => {
      const [eticheta, culoare] = STARI_LOT[l.stare] || [l.stare, G.muted]
      // butoanele de acțiune doar unde nivelul are voie: actiune_permisa vine din BD (fn_sms_loturi_lista); BD-ul refuză oricum
      const permis = typeof l.actiune_permisa === 'boolean' ? l.actiune_permisa : poateActiona(l, panou, true)
      const cine = [l.creat_nivel && `creat: ${NIVELURI[l.creat_nivel] || l.creat_nivel}`, l.aprobat_nivel && `aprobat: ${NIVELURI[l.aprobat_nivel] || l.aprobat_nivel}`,
        l.anulat_nivel && `anulat: ${NIVELURI[l.anulat_nivel] || l.anulat_nivel}`].filter(Boolean).join(' · ')
      return <article key={l.id} style={{ padding: '14px 16px', borderBottom: `1px solid ${G.border}`, background: l.id === evidentiat ? '#E9F1F5' : undefined }}>
        <div style={{ ...S.row, justifyContent: 'space-between' }}>
          <div style={S.row}><Badge color={culoare}>{eticheta}</Badge><Badge color={l.categorie === 'redari' ? G.yellow : G.blue}>{l.categorie === 'redari' ? '🌾 Redări (extern)' : '👷 Intern'}</Badge></div>
          <span style={S.small}>creat {fmtData(l.creat_la)}{l.aprobat_la ? ` · aprobat ${fmtData(l.aprobat_la)}` : ''}{l.coada_golita_la ? ` · coada golită ${fmtData(l.coada_golita_la)}` : ''}</span>
        </div>
        <p style={{ fontSize: 13, margin: '8px 0 4px' }}>{l.text}</p>
        <div style={S.small}>{l.nr_destinatari} destinatari · {fmtEur(l.cost_estimat_eur)} · <b>{rezumatMesaje(l)}</b>
          {l.aprobat_autorizare_nr ? ` · autorizare TGZ ${l.aprobat_autorizare_nr} / ${l.aprobat_autorizare_data}` : ''}{l.motiv_anulare ? ` · motiv anulare: ${l.motiv_anulare}` : ''}
          {cine ? ` · ${cine}` : ''}</div>
        {!permis && poateAnula(l) && <p style={{ ...S.small, color: G.yellow, margin: '6px 0 0' }}>Nivelul tău doar vede acest lot{panou?.nivel === 'test' ? ` (contul de test acționează doar pe loturile lui interne, de maximum ${MAX_TEST} destinatari)` : ''}.</p>}
        <div style={{ ...S.row, marginTop: 8 }}>
          {permis && poateAproba(l) && <button type="button" style={S.primar} disabled={lucru} aria-expanded={revizie === l.id} onClick={() => setRevizie(r => r === l.id ? null : l.id)}>🔍 Verifică lista și aprobă</button>}
          {permis && (l.stare === 'aprobat' || l.stare === 'in_trimitere') && <button type="button" style={{ ...S.primar, opacity: poateTrimite(l, panou) ? 1 : 0.5 }} disabled={lucru || !poateTrimite(l, panou)}
            title={poateTrimite(l, panou) ? '' : 'Trimiterea e oprită (kill-switch) — o pornește owner-ul din Setări'} onClick={() => trimite(l)}>📤 Trimite</button>}
          {permis && poateAnula(l) && <button type="button" style={{ ...S.button, color: G.red }} disabled={lucru} onClick={() => anuleaza(l)}>Anulează</button>}
          <button type="button" style={{ ...S.button, border: 'none', color: G.blue, background: 'transparent' }} aria-expanded={deschis === l.id} onClick={() => setDeschis(d => d === l.id ? null : l.id)}>{deschis === l.id ? 'Închide mesajele' : 'Mesajele lotului'}</button>
        </div>
        {revizie === l.id && permis && poateAproba(l) && <RevizieLot lotId={l.id} onAprobat={dupaAprobare} onInchide={() => setRevizie(null)} />}
        {deschis === l.id && <div style={{ marginTop: 8, maxHeight: 260, overflow: 'auto', background: G.bg, borderRadius: 7, padding: 8 }}>
          {!mesaje ? <span style={S.small}>Se încarcă…</span> : mesaje.map(m => <div key={m.mesaj_id} style={{ ...S.row, fontSize: 12, padding: '3px 0' }}>
            <span style={{ minWidth: 110 }}>{m.telefon_mascat}</span><span style={{ minWidth: 170 }}>{STARI_MESAJ[m.stare] || m.stare}</span>
            <span style={S.small}>{m.cod_eroare || ''} {m.livrat_la ? `livrat ${fmtData(m.livrat_la)}` : m.trimis_la ? `trimis ${fmtData(m.trimis_la)}` : ''}</span>
          </div>)}
        </div>}
      </article>
    })}
  </section>
}

// ── Setări: kill-switch, plafoane, comutatorul Redări (cu nr. + data autorizării scrise Transgaz) ───────────────────────────
function Setari({ panou, reincarcaPanou, setMesaj }) {
  const [zi, setZi] = useState(String(panou?.plafon_zi ?? ''))
  const [luna, setLuna] = useState(String(panou?.plafon_luna ?? ''))
  const [nr, setNr] = useState('')
  const [data, setData] = useState('')
  const [confirmat, setConfirmat] = useState(false)
  const [lucru, setLucru] = useState(false)
  useEffect(() => { setZi(String(panou?.plafon_zi ?? '')); setLuna(String(panou?.plafon_luna ?? '')) }, [panou?.plafon_zi, panou?.plafon_luna])
  if (!panou) return <p style={S.small}>Se încarcă setările…</p>
  const ruleaza = async (fn, succes) => {
    setLucru(true); setMesaj(null)
    try { await fn(); setMesaj({ tip: 'ok', text: succes }) } catch (e) { setMesaj({ tip: 'eroare', text: mesajEroare(e) }) }
    finally { setLucru(false); reincarcaPanou() }
  }
  const salveaza = killSwitch => {
    const p = valideazaPlafoane(zi, luna)
    if (p) { setMesaj({ tip: 'eroare', text: p }); return }
    if (killSwitch !== panou.kill_switch && !window.confirm(killSwitch ? 'Opresc ORICE trimitere SMS (kill-switch)?' : 'Pornesc trimiterea SMS? Pleacă doar loturile aprobate de tine, în plafoane.')) return
    ruleaza(() => smsApi.salveazaSetari({ killSwitch, plafonZi: Number(zi), plafonLuna: Number(luna), versiune: panou.versiune }), killSwitch ? 'Trimiterea e oprită.' : 'Setări salvate.')
  }
  const probleme = valideazaAutorizare({ nr, data, confirmat }, azi())
  const autorizeaza = () => {
    if (probleme.length) { setMesaj({ tip: 'eroare', text: probleme.join(' ') }); return }
    if (!window.confirm(`Pornesc SMS-ul EXTERN către proprietari (Redări), pe baza autorizării scrise Transgaz nr. ${nr.trim()} din ${data}?\n\nFiecare lot tot cere aprobarea ta; SMS-ul nu înlocuiește convocarea scrisă.`)) return
    ruleaza(() => smsApi.autorizareRedari({ autorizat: true, nr: nr.trim(), data, versiune: panou.versiune }), 'Redări autorizat: poți crea loturi din Redări → Registru.')
  }
  const retrage = () => {
    if (!window.confirm('Retrag autorizarea Redări? Loturile Redări (și cele deja aprobate) nu mai pleacă până la o nouă autorizare.')) return
    ruleaza(() => smsApi.autorizareRedari({ autorizat: false, versiune: panou.versiune }), 'Autorizarea Redări a fost retrasă.')
  }
  return <section aria-label="Setări SMS" style={{ display: 'grid', gap: 14 }}>
    <div style={S.panel}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Trimiterea (kill-switch) și plafoanele</div>
      <div style={S.row}>
        <label style={S.small}>Plafon / zi <input aria-label="Plafon pe zi" type="number" min="0" max="5000" value={zi} onChange={e => setZi(e.target.value)} style={{ ...S.input, width: 90 }} /></label>
        <label style={S.small}>Plafon / lună <input aria-label="Plafon pe lună" type="number" min="0" max="50000" value={luna} onChange={e => setLuna(e.target.value)} style={{ ...S.input, width: 100 }} /></label>
        <button type="button" style={S.button} disabled={lucru} onClick={() => salveaza(panou.kill_switch)}>Salvează plafoanele</button>
        {panou.kill_switch
          ? <button type="button" style={S.primar} disabled={lucru} onClick={() => salveaza(false)}>▶ Pornește trimiterea</button>
          : <button type="button" style={{ ...S.button, color: G.red, borderColor: G.red }} disabled={lucru} onClick={() => salveaza(true)}>⛔ Oprește tot (kill-switch)</button>}
      </div>
      <p style={{ ...S.small, marginTop: 8 }}>Plafoanele se verifică atomic în BD la fiecare rezervare (orice mesaj rezervat se numără). O eroare de cont / parolă / credit la furnizor oprește automat trimiterea.</p>
    </div>
    <div style={S.panel}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>🌾 Redări — SMS extern către proprietari</div>
      {panou.redari_autorizat ? <>
        <p style={{ fontSize: 13, margin: '0 0 8px' }}>Autorizat pe baza autorizării scrise Transgaz <b>nr. {panou.redari_autorizare_nr}</b> din <b>{panou.redari_autorizare_data}</b>.</p>
        <button type="button" style={{ ...S.button, color: G.red }} disabled={lucru} onClick={retrage}>Retrage autorizarea</button>
      </> : <>
        <p style={{ ...S.small, margin: '0 0 8px' }}>Blocat în BD până la autorizarea scrisă a Transgaz (Gazpet e împuternicit; furnizorul SMS e sub-împuternicit, art. 28 alin. (2) GDPR). Doar tu o setezi.</p>
        <div style={S.row}>
          <input aria-label="Număr autorizare Transgaz" value={nr} onChange={e => setNr(e.target.value)} placeholder="Nr. autorizare Transgaz" maxLength={100} style={{ ...S.input, minWidth: 200 }} />
          <input aria-label="Data autorizării" type="date" value={data} max={azi()} onChange={e => setData(e.target.value)} style={S.input} />
          <label style={{ ...S.row, gap: 6, fontSize: 13 }}><input type="checkbox" checked={confirmat} onChange={e => setConfirmat(e.target.checked)} />Am autorizarea scrisă Transgaz la dosar</label>
          <button type="button" style={{ ...S.primar, opacity: probleme.length ? 0.5 : 1 }} disabled={lucru || probleme.length > 0} onClick={autorizeaza}>Autorizează Redări</button>
        </div>
      </>}
    </div>
  </section>
}

// ── Opt-out ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
function Optout({ setMesaj }) {
  const [lista, setLista] = useState(null)
  const [tel, setTel] = useState('')
  const [motiv, setMotiv] = useState('')
  const [lucru, setLucru] = useState(false)
  const incarca = useCallback(async () => {
    try { setLista(await smsApi.optout()) } catch (e) { setLista([]); setMesaj({ tip: 'eroare', text: 'Opt-out: ' + mesajEroare(e) }) }
  }, [setMesaj])
  useEffect(() => { incarca() }, [incarca])
  const seteaza = async (t, activ, m) => {
    setLucru(true); setMesaj(null)
    try { const r = await smsApi.seteazaOptout(t, activ, m); setMesaj({ tip: 'ok', text: `${r.telefon_mascat}: ${r.activ ? 'nu mai primește SMS' : 'opt-out dezactivat'}.` }); setTel(''); setMotiv('') }
    catch (e) { setMesaj({ tip: 'eroare', text: mesajEroare(e) }) }
    finally { setLucru(false); incarca() }
  }
  return <section aria-label="Opt-out" style={{ display: 'grid', gap: 14 }}>
    <div style={S.panel}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Adaugă un număr care nu mai primește SMS</div>
      <div style={S.row}>
        <input aria-label="Telefon opt-out" value={tel} onChange={e => setTel(e.target.value)} placeholder="07xx xxx xxx" style={{ ...S.input, minWidth: 160 }} />
        <input aria-label="Motiv opt-out" value={motiv} onChange={e => setMotiv(e.target.value)} placeholder="Motiv (opțional)" maxLength={200} style={{ ...S.input, minWidth: 220 }} />
        <button type="button" style={S.primar} disabled={lucru || !tel.trim()} onClick={() => seteaza(tel, true, motiv)}>Adaugă opt-out</button>
      </div>
      <p style={{ ...S.small, marginTop: 8 }}>Verificat la crearea lotului și din nou la trimitere: numărul iese din lot, nu pleacă nimic spre el.</p>
    </div>
    <div style={{ ...S.panel, padding: 0 }}>
      {!lista ? <p style={{ ...S.small, padding: 14 }}>Se încarcă…</p> : !lista.length ? <p style={{ ...S.small, padding: 14 }}>Niciun opt-out.</p> : lista.map(o =>
        <div key={o.telefon} style={{ ...S.row, justifyContent: 'space-between', padding: '10px 14px', borderBottom: `1px solid ${G.border}` }}>
          <span style={{ fontSize: 13 }}>{mascheazaTelefon(o.telefon)} {o.activ ? <Badge color={G.red}>opt-out activ</Badge> : <Badge>dezactivat</Badge>}</span>
          <span style={S.small}>{o.motiv || ''} · {fmtData(o.actualizat_la)}</span>
          <button type="button" style={S.button} disabled={lucru} onClick={() => seteaza(o.telefon, !o.activ, null)}>{o.activ ? 'Dezactivează' : 'Reactivează'}</button>
        </div>)}
    </div>
  </section>
}

// panouInitial: doar pentru teste (randare fără rețea)
export default function SmsPagina({ profile, panouInitial = null, soldInitial = null }) {
  const [tab, setTab] = useState('compune')
  const [panou, setPanou] = useState(panouInitial)
  const [faraAcces, setFaraAcces] = useState(false)
  const [mesaj, setMesaj] = useState(null)
  const [evidentiat, setEvidentiat] = useState(null)
  const areModul = areModulSms(profile)
  const reincarcaPanou = useCallback(() => {
    smsApi.panou().then(p => { setPanou(p); setFaraAcces(false) }).catch(e => {
      if (e?.code === '42501') setFaraAcces(true)
      else setMesaj({ tip: 'eroare', text: 'Starea SMS: ' + mesajEroare(e) })
    })
  }, [])
  useEffect(() => { if (areModul && !panouInitial) reincarcaPanou() }, [areModul, panouInitial, reincarcaPanou])

  if (!areModul || faraAcces) return <p style={{ ...S.panel, ...S.small }}>📱 SMS: nu ai acces la modul. Îl acordă Razvan (nivel utilizator sau test).</p>
  if (!panou) return <div style={{ color: G.text }}><Mesaj m={mesaj} /><p style={S.small}>Se încarcă starea SMS…</p></div>
  // Setările și Opt-out-ul: doar owner-ul (în BD sunt oricum doar ale lui)
  const owner = panou.nivel === 'owner'
  const sectiuni = [['compune', '✍ Compune'], ['istoric', '📋 Istoric loturi'], ...(owner ? [['setari', '⚙ Setări'], ['optout', '🚫 Opt-out']] : [])]
  const nota = notaNivel(panou)
  return <div style={{ color: G.text }}>
    <StarePanou panou={panou} soldInitial={soldInitial} />
    {nota && <p role="note" style={{ ...S.panel, ...S.small, color: panou.nivel === 'test' ? G.yellow : G.muted, marginBottom: 14 }}>{panou.nivel === 'test' ? '🧪 ' : ''}{nota}</p>}
    <nav aria-label="Secțiuni SMS" style={{ ...S.row, marginBottom: 14 }}>
      {sectiuni.map(([k, l]) =>
        <button key={k} type="button" aria-pressed={tab === k} onClick={() => { setTab(k); setMesaj(null) }} style={{ ...S.button, fontWeight: 600, color: tab === k ? G.blue : G.muted, borderColor: tab === k ? G.blue : G.border }}>{l}</button>)}
    </nav>
    <Mesaj m={mesaj} />
    {tab === 'compune' && <Compune panou={panou} setMesaj={setMesaj} onCreat={id => { setEvidentiat(id); setTab('istoric') }} />}
    {tab === 'istoric' && <Istoric panou={panou} reincarcaPanou={reincarcaPanou} evidentiat={evidentiat} setMesaj={setMesaj} />}
    {owner && tab === 'setari' && <Setari panou={panou} reincarcaPanou={reincarcaPanou} setMesaj={setMesaj} />}
    {owner && tab === 'optout' && <Optout setMesaj={setMesaj} />}
    <p style={{ ...S.small, marginTop: 18 }}>Furnizor: SMSLink (adaptor unic în edge). Fără date personale în texte. SMS-ul nu înlocuiește convocarea scrisă din Redări — e doar informare.</p>
  </div>
}
