// ═══════════════════════════════════════════════════════════════════════════
// UNITĂȚI PROTEJATE — contribuția pentru fondul de handicap
// ═══════════════════════════════════════════════════════════════════════════
// Legea 448/2006 art. 78: neavând 4% angajați cu dizabilități, firma datorează lunar
// salariul minim × locurile neocupate (contribuția integrală); cel puțin jumătate se
// plătește la stat, iar cealaltă jumătate se poate acoperi cu achiziții de la unități
// protejate autorizate (UPA).
// 20270101a (răspunsul expertului contabil, 20.11.2026; runda 2): contribuția e CALCULATĂ
// în BD (fn_upa_situatie / fn_upa_calcul_la = o singură definiție, L19): numărul mediu de
// angajați pe zile calendaristice (runda 4: CFS, CM / BO / M și suspendările scad pe
// perioada actului; pragul de 50 pe NMA-ul rotunjit), posturile = 4% cu 2 zecimale, salariul minim pe
// perioade, achizițiile FĂRĂ TVA plătite până la sfârșitul lunii; excedentul se reportează;
// plata la stat până pe 25 a lunii următoare (21.12 pentru noiembrie). Luna rămâne
// PREVIZIUNE până o închide OWNER-ul din ecran (din 13 a lunii următoare, fără blocaje),
// pe amprenta datelor pe care le vede (o schimbare între timp = reîncarcă).
// Plafonul fix din setări (7.000) nu mai e folosit: îl înlocuiește calculul.
// Scrierea (achiziții, parametri) doar owner + Administrativ / Unități protejate admin
// sau editor (fn_upa_poate_scrie); închiderea și corecțiile HR doar owner-ul.
// Salvarea manuală (runda 3, 20261229a): RPC-ul idempotent fn_upa_achizitie_adauga
// (cheie de intenție + amprenta valorilor); după un rezultat nesigur nimic nu se mai
// șterge; acțiunile async se aplică doar în epoca lor (L24).
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { supabase } from './lib/supabase.js'
import CitesteOricePanel from './CitesteOricePanel.jsx'
import { paginareKeyset } from './hrDeciziiUtil.js'
import { avertismenteAchizitie, ziRO, lunaDinZi, luniInapoi,
         stareSalvare, rezultatNesigur, poateScoatePdf, mesajRefuzAchizitie, pdfExistaDeja, caleaPdf, ordineFurnizori,
         paginaCuGarda, validaSuma, validaFaraTva, esteNumar, leiSauLipsa, textCod, nrZileLibere, stareCalculLuna, etichetaStare,
         CHEI_PARAMETRI, NUME_PARAMETRU, validaParametru, valoareVazuta, mesajParametru,
         validaPlata, textPlata, validaPerioada, mesajPerioada, mesajInchidere } from './upaLogica.js'

const G = {
  bg:'#0D1117', surface:'#161B22', border:'#30363D', border2:'#21262D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  orange:'#F0883E', purple:'#A371F7', blue:'#58A6FF',
  green:'#3FB950', yellow:'#D29922', red:'#F85149',
}
const S = {
  card: { background:G.surface, borderRadius:12, border:`1px solid ${G.border}` },
  input:{ background:G.bg, border:`1px solid ${G.border}`, color:G.text, borderRadius:8, padding:'8px 12px', fontFamily:'inherit', fontSize:14, outline:'none', width:'100%' },
  btnP: { padding:'9px 16px', background:G.orange, color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:700 },
  btnS: { padding:'7px 13px', background:'transparent', color:G.text, border:`1px solid ${G.border}`, borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:600 },
  label:{ fontSize:11, color:G.muted, fontWeight:700, marginBottom:5, display:'block', textTransform:'uppercase', letterSpacing:.4 },
}
const BUCKET = 'documente-upa'
const MAX_PDF = 10 * 1024 * 1024

const lei = (n) => (Number(n) || 0).toLocaleString('ro-RO', { minimumFractionDigits:2, maximumFractionDigits:2 })
const fmtLuna = (d) => d ? new Date(String(d).slice(0,10)+'T00:00:00').toLocaleDateString('ro-RO', { month:'long', year:'numeric' }) : '—'
const fmtData = (d) => d ? new Date(String(d).slice(0,10)+'T00:00:00').toLocaleDateString('ro-RO', { day:'2-digit', month:'short', year:'numeric' }) : '—'
const zileTxt = (z) => z === 1 ? '1 zi rămasă' : `${z} ${z >= 20 ? 'de ' : ''}zile rămase`
const tonCuloare = (t) => t === 'rosu' ? G.red : t === 'verde' ? G.green : t === 'galben' ? G.yellow : G.muted
const lst = (v) => Array.isArray(v) ? v : []

function Mesaj({ mesaj, onClose }) {
  if (!mesaj) return null
  const c = mesaj.tip === 'error' ? G.red : mesaj.tip === 'warn' ? G.yellow : G.green
  return (
    <div style={{...S.card, padding:'10px 14px', marginBottom:14, borderColor:c+'55', background:c+'11',
                 display:'flex', justifyContent:'space-between', alignItems:'center', gap:12}}>
      <span style={{fontSize:13, color:c, fontWeight:600}}>{mesaj.text}</span>
      <button onClick={onClose} style={{...S.btnS, padding:'3px 9px', fontSize:12, color:G.muted}}>✕</button>
    </div>
  )
}

// o cifră a calculului (etichetă + valoare); null = necunoscut („—”, nu 0)
function Cifra({ eticheta, valoare, culoare, mic }) {
  return (
    <div style={{minWidth:0}}>
      <div style={{fontSize:10.5, color:G.muted, fontWeight:700, textTransform:'uppercase', letterSpacing:.3}}>{eticheta}</div>
      <div style={{fontSize: mic ? 14 : 17, fontWeight:800, marginTop:3, color: culoare || G.text, fontVariantNumeric:'tabular-nums'}}>{valoare}</div>
    </div>
  )
}
// lista de blocaje (opresc închiderea) și avertismente (se iau în seamă)
function Coduri({ c }) {
  const bl = lst(c?.blocaje), av = lst(c?.avertismente)
  if (!bl.length && !av.length) return null
  return (
    <div style={{fontSize:12, lineHeight:1.6, marginTop:10}}>
      {bl.map(k => <div key={'b' + k} style={{color:G.red}}>⛔ {textCod(k)}</div>)}
      {av.map(k => <div key={'a' + k} style={{color:G.yellow}}>⚠️ {textCod(k)}</div>)}
    </div>
  )
}
// cifrele unei luni (curente sau anterioare)
function CifreLuna({ c }) {
  if (!c || c.stare === 'in_afara_calculului') return null
  return (
    <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(150px, 1fr))', gap:14, marginTop:12}}>
      <Cifra eticheta="Număr mediu angajați" valoare={esteNumar(c.nma) ? Number(c.nma).toLocaleString('ro-RO', { maximumFractionDigits:2 }) : '—'} mic />
      <Cifra eticheta="Posturi (4%)" valoare={esteNumar(c.posturi) ? Number(c.posturi).toLocaleString('ro-RO', { minimumFractionDigits:2, maximumFractionDigits:2 }) : '—'} mic />
      <Cifra eticheta="Locuri neocupate" valoare={esteNumar(c.locuri) ? Number(c.locuri).toLocaleString('ro-RO', { minimumFractionDigits:2, maximumFractionDigits:2 }) : '—'} mic />
      <Cifra eticheta="Salariu minim" valoare={leiSauLipsa(c.salariu_minim) + ' lei'} mic />
      <Cifra eticheta="Contribuția integrală" valoare={leiSauLipsa(c.suma_datorata) + ' lei'} />
      <Cifra eticheta="Deducere maximă (½)" valoare={leiSauLipsa(c.jumatate) + ' lei'} />
      <Cifra eticheta="Report intrat" valoare={leiSauLipsa(c.report_intrat) + ' lei'} />
      <Cifra eticheta="Achiziții fără TVA" valoare={leiSauLipsa(c.achizitii_fara_tva) + ' lei'} culoare={G.green} />
      <Cifra eticheta="Deducere" valoare={leiSauLipsa(c.deducere) + ' lei'} />
      <Cifra eticheta={`De plată la stat (până pe ${fmtData(c.termen_stat)})`} valoare={leiSauLipsa(c.de_plata) + ' lei'} culoare={G.red} />
      <Cifra eticheta="Se reportează" valoare={leiSauLipsa(c.report_iesit) + ' lei'} culoare={G.purple} />
    </div>
  )
}

// ─── Modal achiziție ────────────────────────────────────────────────────────
// Salvarea (runda 3, L04 / L05 / L24): o cheie de intenție pe formular, refolosită la reîncercare; RPC-ul fn_upa_achizitie_adauga
//   reconciliază pe server (cheia există cu aceleași valori = 'existent', cu alte valori = UPA02), deci nici dublură, nici „refuzat” fals.
//   PDF-ul se scoate DOAR la un refuz sigur (4xx) al unei intenții fără nicio încercare nesigură înainte (ambiguu): după un rezultat
//   necunoscut, nimic din intenția asta nu se mai șterge, iar formularul rămâne înghețat. Fiecare scriere (încărcarea, RPC-ul) pleacă doar
//   dacă formularul e încă montat ȘI ecranul e în aceeași epocă (același profil); rezultatele se aplică în aceleași condiții.
//   20270101a: valoarea FĂRĂ TVA (obligatorie, se deduce) și data plății (se deduce doar factura plătită până la sfârșitul lunii) intră în intenție.
function FormAchizitie({ furnizoriUpa, onSalvat, onClose, setMesaj, inEpoca }) {
  const [f, setF] = useState(() => {
    const zi = ziRO()
    return { furnizor_id:'', furnizor_nume:'', numar_factura:'', data_factura: zi, valoare:'', valoare_fara_tva:'', stare_plata:'', data_plata:'', descriere:'', luna: lunaDin(zi) }
  })
  const [pdf, setPdf] = useState(null)
  const [pdfVer, setPdfVer] = useState(0)            // versiunea fișierului ales: intră în cale (alt fișier = altă cale)
  const [lucrez, setLucrez] = useState(false)
  const [nesigur, setNesigur] = useState(false)      // rezultat necunoscut: câmpurile înghețate, doar „Reîncearcă”
  const cheie = useRef(null)
  if (cheie.current == null) cheie.current = crypto.randomUUID()
  const pdfSus = useRef(null)                        // calea PDF-ului încărcat pentru intenția asta (încă nelegat de un rând salvat)
  const ambiguu = useRef(false)                      // o încercare a avut rezultat nesigur: de acum nimic nu se mai șterge
  const viu = useRef(true)
  useEffect(() => { viu.current = true; return () => { viu.current = false } }, [])
  const activ = () => viu.current && inEpoca()       // formularul montat și ecranul în epoca în care s-a deschis
  const set = (k, v) => { if (!nesigur) setF(p => ({ ...p, [k]: v })) }
  const avertismente = avertismenteAchizitie({ dataFactura: f.data_factura, luna: f.luna, arePdf: !!pdf })

  const alegePdf = (file) => {
    if (nesigur) return
    if (!file) { setPdf(null); return }
    if (file.type !== 'application/pdf') { setMesaj({ tip:'warn', text:'Doar fișiere PDF.' }); return }
    if (file.size > MAX_PDF) { setMesaj({ tip:'warn', text:'PDF-ul are peste 10 MB.' }); return }
    setPdf(file); setPdfVer(x => x + 1)
  }

  const salveaza = async () => {
    if (lucrez) return
    if (!f.numar_factura.trim()) { setMesaj({ tip:'warn', text:'Numărul facturii e obligatoriu.' }); return }
    const vc = validaSuma(f.valoare, { ce: 'Valoarea cu TVA' })
    if (vc.eroare) { setMesaj({ tip:'warn', text: vc.eroare }); return }
    const vf = validaFaraTva(f.valoare_fara_tva, vc.valoare)
    if (vf.eroare) { setMesaj({ tip:'warn', text: vf.eroare }); return }
    const vp = validaPlata(f.stare_plata, f.data_plata)
    if (vp.eroare) { setMesaj({ tip:'warn', text: vp.eroare }); return }
    if (!f.furnizor_id && !f.furnizor_nume.trim()) { setMesaj({ tip:'warn', text:'Alege furnizorul sau scrie-i numele.' }); return }
    // avertismente, nu blocări: omul confirmă că vrea să salveze așa (la reîncercare a confirmat deja)
    if (!nesigur && avertismente.length && !confirm('Atenție:\n• ' + avertismente.map(a => a.text).join('\n• ') + '\n\nSalvezi oricum?')) return
    if (!activ()) return
    setLucrez(true)
    const cale = pdf ? caleaPdf(f.luna, cheie.current, pdfVer) : null
    // exact câmpurile intenției (CAMPURI_INTENTIE = fn_upa_campuri_intentie din BD); cheia separat
    const rand = {
      furnizor_id: f.furnizor_id ? Number(f.furnizor_id) : null,
      furnizor_nume: f.furnizor_id ? null : f.furnizor_nume.trim(),
      numar_factura: f.numar_factura.trim(),
      data_factura: f.data_factura || null,
      luna: f.luna, valoare: vc.valoare,
      descriere: f.descriere.trim() || null,
      document_path: cale,
      valoare_fara_tva: vf.valoare,
      data_plata: vp.data_plata,
      stare_plata: vp.stare_plata,
    }
    try {
      if (cale && pdfSus.current !== cale) {
        if (!activ()) return                           // L24: nicio scriere după demontare / alt cont
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(cale, pdf, { upsert:false, contentType:'application/pdf' })
        if (!activ()) return
        // „există deja” la calea intenției = încărcarea anterioară a acestui formular (cheia + versiunea fișierului sunt în cale)
        if (upErr && !pdfExistaDeja(upErr)) { setMesaj({ tip:'error', text:'PDF-ul nu s-a încărcat: ' + upErr.message }); return }
        pdfSus.current = cale
      }
      if (!activ()) return                             // L24: RPC-ul pleacă doar cât formularul e activ (runda 3, P2)
      let res
      try { res = await supabase.rpc('fn_upa_achizitie_adauga', { p_cheie: cheie.current, p_rand: rand }) } catch (e) { res = { error: e } }
      const st = stareSalvare(res, ambiguu.current)
      if (rezultatNesigur(st)) ambiguu.current = true
      if (poateScoatePdf(st) && pdfSus.current && activ()) {
        // refuz SIGUR al unei intenții fără nicio încercare nesigură: nimic scris → PDF-ul încărcat se scoate (doar cât formularul e activ)
        const p = pdfSus.current; pdfSus.current = null
        await supabase.storage.from(BUCKET).remove([p]).catch(() => {})
      }
      if (!activ()) return
      if (st === 'refuzat') { setNesigur(false); setMesaj({ tip:'error', text: mesajRefuzAchizitie(res?.error) }); return }
      if (st === 'salvat') {
        pdfSus.current = null
        setMesaj({ tip:'success', text:`Adăugat: ${lei(vf.valoare)} lei fără TVA pe ${fmtLuna(f.luna)}${cale ? '' : ' (fără PDF)'}${rand.stare_plata ? '' : ' · plata de completat'}${res.data.stare === 'existent' ? ' (salvarea anterioară intrase; nu s-a dublat)' : ''}` })
        onSalvat(); onClose()
        return
      }
      // necunoscut / diferit / refuzat_nesigur: nu se șterge nimic; câmpurile rămân înghețate, reîncercarea trimite aceeași cheie
      setNesigur(true)
      setMesaj({ tip:'warn', text: st === 'diferit'
        ? 'Există deja o salvare cu cheia acestui formular, dar cu alte valori. Închide formularul și verifică lista; nu am șters nimic.'
        : st === 'refuzat_nesigur'
          ? mesajRefuzAchizitie(res?.error) + ' O încercare anterioară are rezultat necunoscut: închide formularul și verifică lista; nu am șters nimic.'
          : 'Nu știu dacă s-a salvat (rețea sau server). Apasă „Reîncearcă”: aceeași factură nu se dublează.' })
    } catch (e) {
      // o excepție neprevăzută după încărcare = rezultat necunoscut: nu se șterge nimic, de acum nici la un refuz ulterior
      ambiguu.current = true
      if (activ()) { setNesigur(true); setMesaj({ tip:'warn', text:'Nu știu dacă s-a salvat: ' + (e.message || e) + '. Apasă „Reîncearcă”.' }) }
    }
    finally { if (viu.current) setLucrez(false) }
  }
  // închiderea: blocată cât lucrez; după un rezultat necunoscut, lista se reîncarcă (să se vadă dacă rândul a intrat)
  const inchide = () => { if (lucrez) return; if (nesigur) onSalvat(); onClose() }

  return (
    <div onClick={inchide} style={{position:'fixed', inset:0, background:'#000A', zIndex:900, display:'flex', alignItems:'center', justifyContent:'center', padding:20}}>
      <div onClick={e => e.stopPropagation()} style={{...S.card, width:'min(600px, 96vw)', padding:22}}>
        <div style={{fontSize:17, fontWeight:800, marginBottom:16}}>➕ Achiziție de la unitate protejată</div>
        {nesigur && (
          <div style={{...S.card, padding:'9px 12px', marginBottom:14, borderColor:G.yellow+'55', background:G.yellow+'11', fontSize:12, color:G.yellow, lineHeight:1.5}}>
            Salvarea are rezultat necunoscut. Câmpurile sunt blocate: „Reîncearcă” trimite exact aceeași achiziție (nu se dublează).
          </div>
        )}

        <fieldset disabled={nesigur || lucrez} style={{border:'none', padding:0, margin:0}}>
        <div style={{marginBottom:12}}>
          <label style={S.label}>Furnizor UPA</label>
          <select style={S.input} value={f.furnizor_id} onChange={e => set('furnizor_id', e.target.value)}>
            <option value="">— alt furnizor (scriu numele) —</option>
            {furnizoriUpa.map(fz => (
              <option key={fz.id} value={fz.id}>
                {fz.nume}{fz.upa_valabil_pana && fz.upa_valabil_pana < ziRO() ? ' ⚠️ AUTORIZAȚIE EXPIRATĂ' : ''}
              </option>
            ))}
          </select>
        </div>
        {!f.furnizor_id && (
          <div style={{marginBottom:12}}>
            <label style={S.label}>Nume furnizor</label>
            <input style={S.input} value={f.furnizor_nume} onChange={e => set('furnizor_nume', e.target.value)} placeholder="ex: Protected Unit SRL" />
          </div>
        )}

        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12}}>
          <div>
            <label style={S.label}>Nr. factură *</label>
            <input style={{...S.input, borderColor: f.numar_factura.trim() ? G.border : G.yellow+'88'}} value={f.numar_factura} onChange={e => set('numar_factura', e.target.value)} />
          </div>
          <div>
            <label style={S.label}>Data facturii</label>
            <input style={S.input} type="date" value={f.data_factura}
                   onChange={e => { set('data_factura', e.target.value); if (e.target.value) set('luna', lunaDin(e.target.value)) }} />
          </div>
        </div>

        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:12}}>
          <div>
            <label style={S.label}>Valoare cu TVA (lei) *</label>
            <input style={S.input} type="number" step="0.01" value={f.valoare} onChange={e => set('valoare', e.target.value)} autoFocus />
          </div>
          <div>
            <label style={S.label}>Valoare fără TVA (lei) *</label>
            <input style={{...S.input, borderColor: String(f.valoare_fara_tva).trim() ? G.border : G.yellow+'88'}} type="number" step="0.01"
                   value={f.valoare_fara_tva} onChange={e => set('valoare_fara_tva', e.target.value)} title="Se deduce valoarea fără TVA" />
          </div>
          <div>
            <label style={S.label}>Plata</label>
            <select style={S.input} value={f.stare_plata} onChange={e => { set('stare_plata', e.target.value); if (e.target.value !== 'platita') set('data_plata', '') }}
                    title="Factura se deduce doar dacă e plătită unității protejate până la sfârșitul lunii">
              <option value="">— completez mai târziu —</option>
              <option value="platita">Plătită</option>
              <option value="neplatita">Neplătită încă</option>
            </select>
            {f.stare_plata === 'platita' && (
              <input style={{...S.input, marginTop:6}} type="date" value={f.data_plata} onChange={e => set('data_plata', e.target.value)} title="Data plății către unitatea protejată" />
            )}
          </div>
        </div>

        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12}}>
          <div>
            <label style={S.label}>Se scade din luna</label>
            <input style={S.input} type="month" value={String(f.luna).slice(0,7)} onChange={e => e.target.value && set('luna', e.target.value + '-01')} />
          </div>
          <div>
            <label style={S.label}>Descriere</label>
            <input style={S.input} value={f.descriere} onChange={e => set('descriere', e.target.value)} placeholder="ex: hârtie A4, consumabile birou" />
          </div>
        </div>

        <div style={{marginBottom:14}}>
          <label style={S.label}>Factura (PDF)</label>
          <input type="file" accept="application/pdf" onChange={e => alegePdf(e.target.files?.[0] || null)} style={{fontSize:12, color:G.muted}} />
        </div>

        <div style={{fontSize:11.5, color:G.dim, marginBottom:12, lineHeight:1.5}}>
          Se deduce valoarea <b>fără TVA</b>, doar dacă factura e plătită unității protejate până la sfârșitul lunii. O factură neplătită nu blochează închiderea (nu se deduce); plata necompletată o blochează. Se poate completa și mai târziu, din listă.
        </div>

        {avertismente.length > 0 && (
          <div style={{...S.card, padding:'9px 12px', marginBottom:14, borderColor:G.yellow+'55', background:G.yellow+'11', fontSize:12, color:G.yellow, lineHeight:1.6}}>
            {avertismente.map(a => <div key={a.cod}>⚠️ {a.text}</div>)}
          </div>
        )}
        </fieldset>

        <div style={{display:'flex', gap:10, justifyContent:'flex-end'}}>
          <button onClick={inchide} disabled={lucrez} style={{...S.btnS, opacity:lucrez ? .6 : 1}}>{nesigur ? 'Închide (reîncarc lista)' : 'Renunță'}</button>
          <button onClick={salveaza} disabled={lucrez} style={{...S.btnP, opacity:lucrez ? .6 : 1}}>{lucrez ? 'Salvez…' : nesigur ? 'Reîncearcă' : 'Adaugă'}</button>
        </div>
      </div>
    </div>
  )
}
const lunaDin = (zi) => lunaDinZi(zi) || lunaDinZi(ziRO())

// ─── Completarea unei achiziții (valoarea fără TVA / plata) ───
// UPDATE = CAS pe valoarea văzută (.is(null) / .eq('stare_plata', 'neplatita') + .select('id')): 0 rânduri = schimbat între timp sau fără
//   drept → reîncarc (L01). Plata: necompletată -> plătită (cu data) sau neplătită; neplătită -> plătită.
function CompletareAchizitie({ a, onGata, setMesaj, inEpoca }) {
  const [tva, setTva] = useState('')
  const [plata, setPlata] = useState('')
  const [lucrez, setLucrez] = useState(false)
  const salveaza = async (ce) => {
    if (lucrez) return
    let schimbare, mesajOk
    if (ce === 'valoare_fara_tva') {
      const v = validaFaraTva(tva, a.valoare); if (v.eroare) { setMesaj({ tip:'warn', text: v.eroare }); return }
      schimbare = { valoare_fara_tva: v.valoare }; mesajOk = `Valoarea fără TVA: ${lei(v.valoare)} lei.`
    } else {
      const v = validaPlata(ce, plata); if (v.eroare) { setMesaj({ tip:'warn', text: v.eroare }); return }
      schimbare = v; mesajOk = ce === 'platita' ? `Plătită pe ${fmtData(v.data_plata)}.` : 'Marcată neplătită (nu se deduce dacă nu se plătește în lună).'
    }
    setLucrez(true)
    try {
      let q = supabase.from('upa_achizitii').update(schimbare).eq('id', a.id)
      q = ce === 'valoare_fara_tva' ? q.is('valoare_fara_tva', null) : a.stare_plata == null ? q.is('stare_plata', null) : q.eq('stare_plata', a.stare_plata)
      const { data, error } = await q.select('id')
      if (!inEpoca()) return
      if (error) { setMesaj({ tip:'error', text:'Nu am putut completa: ' + (error.message || error.code) }); return }
      if ((data || []).length !== 1) { setMesaj({ tip:'warn', text:'Nu s-a schimbat nimic (completat între timp sau fără drept). Am reîncărcat lista.' }); onGata(); return }
      setMesaj({ tip:'success', text: mesajOk })
      onGata()
    } catch (e) { if (inEpoca()) setMesaj({ tip:'error', text:'Nu știu dacă s-a salvat: ' + (e.message || e) + '. Reîncarc lista.' }); onGata() }
    finally { setLucrez(false) }
  }
  const mic = { ...S.input, padding:'3px 6px', fontSize:11, width:96 }
  return (
    <div style={{display:'flex', gap:6, flexWrap:'wrap', marginTop:5}}>
      {a.valoare_fara_tva == null && (
        <span style={{display:'flex', gap:4, alignItems:'center'}}>
          <input style={mic} type="number" step="0.01" placeholder="fără TVA" value={tva} onChange={e => setTva(e.target.value)} disabled={lucrez} />
          <button onClick={() => salveaza('valoare_fara_tva')} disabled={lucrez} style={{...S.btnS, padding:'2px 7px', fontSize:11}}>✓</button>
        </span>
      )}
      {a.stare_plata !== 'platita' && (
        <span style={{display:'flex', gap:4, alignItems:'center'}}>
          <input style={{...mic, width:130}} type="date" value={plata} onChange={e => setPlata(e.target.value)} disabled={lucrez} title="Data plății către unitatea protejată" />
          <button onClick={() => salveaza('platita')} disabled={lucrez} style={{...S.btnS, padding:'2px 7px', fontSize:11}}>plătită ✓</button>
          {a.stare_plata == null && <button onClick={() => salveaza('neplatita')} disabled={lucrez} style={{...S.btnS, padding:'2px 7px', fontSize:11}} title="Știm că nu e plătită: nu se deduce, dar nu blochează închiderea">neplătită</button>}
        </span>
      )}
    </div>
  )
}

// ─── Detaliul NMA pe angajat + corecțiile HR (owner) ───
// Corecțiile (normă / administrator / suspendare fără cod de pontaj, pe interval) le scrie doar owner-ul, prin RPC; o lună închisă nu se
//   mai atinge (UPA03), suprapunerile se refuză (UPA05). L24: citirea și acțiunile se aplică doar în generația și epoca lor.
const FORM_PERIOADA = { employee_id:'', de_la:'', pana_la:'', norma:'', administrator:'', suspendat:false, nota:'' }
function DetaliuNma({ luna, onClose, onSchimbat, setMesaj, inEpoca }) {
  const [d, setD] = useState(null)
  const [err, setErr] = useState(null)
  const [reload, setReload] = useState(0)
  const [form, setForm] = useState(null)
  const [lucrez, setLucrez] = useState(false)
  const gen = useRef(0)
  useEffect(() => {
    const g = ++gen.current
    setErr(null)
    supabase.rpc('fn_upa_calcul_detaliu', { p_luna: luna }).then(({ data, error }) => { if (g !== gen.current) return; if (error) setErr(error.message || error.code); else setD(data) },
      e => { if (g === gen.current) setErr(e.message || String(e)) })
    return () => { gen.current++ }
  }, [luna, reload])
  const rand = lst(d?.angajati)
  const perioade = lst(d?.perioade)
  const total = rand.reduce((s, x) => s + Number(x.contributie || 0), 0)
  const fara = rand.filter(x => Number(x.zile_fara_pontaj) > 0)
  const nr = v => Number(v || 0) ? Number(v).toLocaleString('ro-RO', { maximumFractionDigits:4 }) : ''
  const adauga = async () => {
    if (lucrez || !form) return
    const v = validaPerioada(form)
    if (v.eroare) { setMesaj({ tip:'warn', text: v.eroare }); return }
    setLucrez(true)
    try {
      const { error } = await supabase.rpc('fn_upa_perioada_adauga', v)
      if (!inEpoca()) return
      if (error) { setMesaj({ tip:'error', text: mesajPerioada(error) }); return }
      setMesaj({ tip:'success', text:'Corecția HR a fost înregistrată.' }); setForm(null); setReload(x => x + 1); onSchimbat()
    } catch (e) { if (inEpoca()) setMesaj({ tip:'error', text:'Nu știu dacă s-a salvat: ' + (e.message || e) + '. Reîncarc.' }); setReload(x => x + 1) }
    finally { setLucrez(false) }
  }
  const sterge = async (p) => {
    if (lucrez || !confirm(`Ștergi corecția pentru ${p.nume || '#' + p.employee_id} (${fmtData(p.de_la)} – ${fmtData(p.pana_la)})?`)) return
    setLucrez(true)
    try {
      const { data, error } = await supabase.rpc('fn_upa_perioada_sterge', { p_id: p.id })
      if (!inEpoca()) return
      if (error) { setMesaj({ tip:'error', text: mesajPerioada(error) }); return }
      setMesaj({ tip: Number(data?.sters) === 1 ? 'success' : 'warn', text: Number(data?.sters) === 1 ? 'Corecția a fost ștearsă.' : 'Corecția era deja ștearsă.' })
      setReload(x => x + 1); onSchimbat()
    } catch (e) { if (inEpoca()) setMesaj({ tip:'error', text:'Nu știu dacă s-a șters: ' + (e.message || e) + '. Reîncarc.' }); setReload(x => x + 1) }
    finally { setLucrez(false) }
  }
  const th = h => <th key={h} style={{padding:'5px 6px', borderBottom:`1px solid ${G.border}`}}>{h}</th>
  return (
    <div onClick={onClose} style={{position:'fixed', inset:0, background:'#000A', zIndex:900, display:'flex', alignItems:'center', justifyContent:'center', padding:20}}>
      <div onClick={e => e.stopPropagation()} style={{...S.card, width:'min(980px, 97vw)', maxHeight:'88vh', overflow:'auto', padding:20}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12}}>
          <div style={{fontSize:16, fontWeight:800}}>👥 Numărul mediu de angajați · {fmtLuna(luna)}{d ? (d.definitiv ? ' · închis' : ' · calcul de acum') : ''}</div>
          <button onClick={onClose} style={{...S.btnS, padding:'3px 9px'}}>✕</button>
        </div>
        {err && <div style={{color:G.red, fontSize:13}}>Nu am putut citi detaliul: {err}</div>}
        {!d && !err && <div style={{color:G.muted, fontSize:13}}>Se încarcă…</div>}
        {d && (
          <>
            <div style={{fontSize:12, color:G.muted, marginBottom:8, lineHeight:1.5}}>
              Pe fiecare zi calendaristică din contract. Nu se numără zilele de CFS, de suspendare (CM, BO, BP, AM, maternitate sau corecție HR) și
              cele ca administrator, pe perioada actului: weekendul / sărbătoarea dintre două zile cu același cod e în act, iar cea de după
              sfârșitul lui (ex. CM până vineri, luni la lucru) se numără. Dacă actul acoperă și zilele libere de la capăt, trece codul și pe ele
              în pontaj. Contribuția = suma normelor zilelor numărate; total {total.toLocaleString('ro-RO', { maximumFractionDigits:4 })} împărțit
              la zilele lunii = NMA.
            </div>
            {fara.length > 0 && (
              <div style={{fontSize:12, color:G.red, marginBottom:8}}>⛔ Fără pontaj în zile lucrătoare: {fara.map(x => `${x.nume || '#' + x.employee_id} (${x.zile_fara_pontaj})`).join(', ')}.</div>
            )}
            <table style={{width:'100%', borderCollapse:'collapse', fontSize:12}}>
              <thead><tr style={{color:G.muted, textAlign:'left'}}>
                {['Angajat', 'Zile contract', 'CFS', 'Suspendare', 'Administrator', 'Numărate', 'Contribuție'].map(th)}
              </tr></thead>
              <tbody>{rand.map(x => (
                <tr key={x.employee_id} style={{borderBottom:`1px solid ${G.border2}`}}>
                  <td style={{padding:'4px 6px'}}>{x.nume || '#' + x.employee_id}
                    {x.fara_data_angajare ? <span style={{color:G.red}}> · fără dată angajare</span> : null}
                    {x.fara_norma ? <span style={{color:G.red}}> · fără normă</span> : null}
                    {x.corectii ? <span style={{color:G.purple}}> · corecție HR</span> : null}
                    {x.zile_libere_langa_suspendare > 0 ? <span style={{color:G.yellow}}> · {nrZileLibere(x.zile_libere_langa_suspendare)} lângă o suspendare, numărate: verifică actul</span> : null}</td>
                  <td style={{padding:'4px 6px'}}>{x.zile_calcul}</td>
                  <td style={{padding:'4px 6px'}}>{nr(x.zile_cfs)}</td>
                  <td style={{padding:'4px 6px'}}>{nr(x.zile_suspendare)}</td>
                  <td style={{padding:'4px 6px'}}>{nr(x.zile_administrator)}</td>
                  <td style={{padding:'4px 6px'}}>{x.zile_numarate}</td>
                  <td style={{padding:'4px 6px', fontVariantNumeric:'tabular-nums'}}>{Number(x.contributie).toLocaleString('ro-RO', { maximumFractionDigits:4 })}</td>
                </tr>
              ))}</tbody>
            </table>

            <div style={{marginTop:16, display:'flex', justifyContent:'space-between', alignItems:'center', gap:10, flexWrap:'wrap'}}>
              <div style={{fontSize:13, fontWeight:800}}>Corecții HR (normă / administrator / suspendare fără cod de pontaj)</div>
              {!d.definitiv && !form && <button onClick={() => setForm({ ...FORM_PERIOADA, de_la: String(luna).slice(0,10) })} style={{...S.btnS, padding:'4px 10px', fontSize:12}}>➕ Corecție</button>}
            </div>
            <div style={{fontSize:11.5, color:G.dim, margin:'4px 0 8px', lineHeight:1.5}}>
              ERP-ul are doar norma de azi și administratorii de azi. Dacă în lună s-a schimbat norma (act adițional), calitatea de administrator sau
              contractul a fost suspendat fără cod în pontaj (ex. creșterea copilului), înregistrează aici intervalul, cu motivul.
            </div>
            {form && (
              <div style={{display:'flex', gap:8, flexWrap:'wrap', alignItems:'flex-end', marginBottom:10, padding:10, border:`1px solid ${G.border2}`, borderRadius:8}}>
                <label style={{flex:'1 1 200px'}}><span style={S.label}>Angajat</span>
                  <select style={S.input} value={form.employee_id} onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))}>
                    <option value="">— alege —</option>
                    {rand.map(x => <option key={x.employee_id} value={x.employee_id}>{x.nume || '#' + x.employee_id}</option>)}
                  </select></label>
                <label style={{flex:'0 1 140px'}}><span style={S.label}>De la</span>
                  <input style={S.input} type="date" value={form.de_la} onChange={e => setForm(f => ({ ...f, de_la: e.target.value }))} /></label>
                <label style={{flex:'0 1 140px'}}><span style={S.label}>Până la</span>
                  <input style={S.input} type="date" value={form.pana_la} onChange={e => setForm(f => ({ ...f, pana_la: e.target.value }))} /></label>
                <label style={{flex:'0 1 100px'}}><span style={S.label}>Normă</span>
                  <input style={S.input} type="number" step="0.0001" min="0" max="1" placeholder="ex. 0.5" value={form.norma} onChange={e => setForm(f => ({ ...f, norma: e.target.value }))} /></label>
                <label style={{flex:'0 1 130px'}}><span style={S.label}>Administrator</span>
                  <select style={S.input} value={form.administrator} onChange={e => setForm(f => ({ ...f, administrator: e.target.value }))}>
                    <option value="">ca în ERP</option><option value="da">da</option><option value="nu">nu</option>
                  </select></label>
                <label style={{flex:'0 1 120px', fontSize:12, display:'flex', gap:6, alignItems:'center', paddingBottom:8}}>
                  <input type="checkbox" checked={form.suspendat} onChange={e => setForm(f => ({ ...f, suspendat: e.target.checked }))} /> suspendat</label>
                <label style={{flex:'1 1 220px'}}><span style={S.label}>Motiv (act / decizie) *</span>
                  <input style={S.input} value={form.nota} maxLength={300} onChange={e => setForm(f => ({ ...f, nota: e.target.value }))} /></label>
                <button onClick={adauga} disabled={lucrez} style={S.btnP}>Salvează</button>
                <button onClick={() => setForm(null)} style={S.btnS}>✕</button>
              </div>
            )}
            {perioade.length === 0
              ? <div style={{fontSize:12, color:G.muted}}>Nicio corecție pentru luna asta.</div>
              : perioade.map(p => (
                <div key={p.id} style={{fontSize:12, padding:'5px 0', borderBottom:`1px solid ${G.border2}`, display:'flex', gap:10, alignItems:'center', flexWrap:'wrap'}}>
                  <b>{p.nume || '#' + p.employee_id}</b>
                  <span style={{color:G.muted}}>{fmtData(p.de_la)} – {fmtData(p.pana_la)}</span>
                  {p.norma != null && <span>normă {Number(p.norma).toLocaleString('ro-RO', { maximumFractionDigits:4 })}</span>}
                  {p.administrator != null && <span>{p.administrator ? 'administrator' : 'nu e administrator'}</span>}
                  {p.suspendat && <span style={{color:G.yellow}}>suspendat</span>}
                  <span style={{color:G.dim, flex:'1 1 200px'}}>{p.nota}</span>
                  {!d.definitiv && <button onClick={() => sterge(p)} disabled={lucrez} style={{...S.btnS, padding:'2px 8px', fontSize:11, color:G.red, borderColor:G.red+'44'}}>✕</button>}
                </div>
              ))}
          </>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
export default function UnitatiProtejate({ profile }) {
  const [achizitii, setAchizitii] = useState([])
  const [sit, setSit]             = useState(null)      // fn_upa_situatie: lunile (curenta prima) + in_alerta
  const [parametri, setParametri] = useState([])
  const [poateScrie, setPoateScrie] = useState(null)    // null = necunoscut (eroare la verificare)
  const [furnizori, setFurnizori] = useState([])
  const [rundaDeschisa, setRunda] = useState(null)
  const [cumulat, setCumulat]     = useState([])
  const [load, setLoad]           = useState(true)
  const [mesaj, setMesaj]         = useState(null)
  const [formAch, setFormAch]     = useState(false)
  const [citesteOpen, setCitesteOpen] = useState(false)
  const [formParam, setFormParam] = useState(null)      // { cheie, luna, valoare } cât formularul e deschis
  const [detaliu, setDetaliu]     = useState(null)      // luna pentru detaliul NMA (owner)
  const [lunaSel, setLunaSel]     = useState(() => lunaDin(ziRO()).slice(0,7))   // TKT-2026-0177: istoric comenzi pe luni
  const [cumulTrunchiat, setCumulTrunchiat] = useState(false)
  const [lucrez, setLucrez]       = useState(false)
  // L24: generatie = doar ultima încărcare își aplică rezultatul; epoca = se schimbă la demontare și la alt profil, iar o acțiune
  //   pornită înainte nu mai aplică nimic după ce s-a schimbat. Ambele se schimbă în curățarea efectului.
  const generatie = useRef(0)
  const epoca = useRef(0)
  const profilId = profile?.id ?? null
  const esteOwner = profile?.is_owner === true

  const incarca = useCallback(async () => {
    const gen = ++generatie.current
    const curent = () => gen === generatie.current
    setLoad(true)
    try {
      const deLa = luniInapoi(ziRO(), 11)
      const [st, ps, ac, fz, rd, pr] = await Promise.all([
        supabase.rpc('fn_upa_situatie', { p_azi: null, p_luni: 12 }),
        supabase.rpc('fn_upa_poate_scrie'),
        // L23: toate achizițiile din ultimele 12 luni, pe pagini (keyset pe id), nu un singur select tăiat la 1000;
        //   L24 (runda 3): pagina următoare nu mai pleacă după o încărcare nouă / demontare (paginaCuGarda -> Oprit)
        paginareKeyset(paginaCuGarda(curent, (ultim, pas) => {
          let q = supabase.from('upa_achizitii').select('*, furnizor:logistica_furnizori(nume, upa_valabil_pana)')
            .gte('luna', deLa).order('id', { ascending:true }).limit(pas)
          if (ultim != null) q = q.gt('id', ultim)
          return q
        })),
        // L23: furnizorii UPA tot pe pagini (keyset pe id), ordonați apoi după nume
        paginareKeyset(paginaCuGarda(curent, (ultim, pas) => {
          let q = supabase.from('logistica_furnizori').select('id, nume, cui, este_upa, upa_autorizatie, upa_valabil_pana')
            .eq('este_upa', true).eq('activ', true).order('id', { ascending:true }).limit(pas)
          if (ultim != null) q = q.gt('id', ultim)
          return q
        })),
        supabase.from('necesar_runde').select('id, saptamana, status').in('status', ['deschisa','blocata']).order('saptamana', { ascending:false }).limit(1),
        // parametrii pe perioade: câteva rânduri (o valoare pe schimbare de lege); numărul exact se compară cu ce a venit (L23)
        supabase.from('upa_parametri').select('cheie, de_la, valoare, sursa, nota, setat_la', { count:'exact' }).order('cheie').order('de_la', { ascending:false }),
      ])
      if (st.error) throw st.error
      if (gen !== generatie.current) return
      const atentie = []
      setSit(st.data || null)
      setPoateScrie(ps.error ? null : ps.data === true)
      if (ps.error) atentie.push('nu am putut verifica dreptul de modificare (butoanele de scriere sunt ascunse)')
      if (pr.error) { setParametri([]); atentie.push('nu am putut citi parametrii (' + (pr.error.message || pr.error.code) + ')') }
      else {
        setParametri(pr.data || [])
        if (!Number.isFinite(pr.count) || pr.count > (pr.data || []).length) atentie.push('lista parametrilor e incompletă')
      }
      setAchizitii([...ac].sort((a, b) => String(b.luna).localeCompare(String(a.luna)) || b.id - a.id))
      setFurnizori([...fz].sort(ordineFurnizori))
      // L18: eroarea la citirea rundei NU e „nicio rundă”; cumulul vechi se scoate oricum (runda s-a schimbat / a dispărut)
      setCumulat([]); setCumulTrunchiat(false)
      const r = rd.error ? null : (rd.data || [])[0] || null
      setRunda(r)
      if (rd.error) atentie.push('nu am putut citi runda de consumabile (' + (rd.error.message || rd.error.code || 'eroare') + ')')
      if (r) {
        const cum = await supabase.from('v_necesar_cumulat').select('categorie, articol, cantitate_totala, um, locatie', { count:'exact' }).eq('runda_id', r.id)
        if (gen !== generatie.current) return
        if (cum.error) atentie.push('nu am putut citi pozițiile rundei (' + (cum.error.message || cum.error.code || 'eroare') + ')')
        else {
          const rows = cum.data || []
          setCumulat(rows)
          // L23: plafonul de rânduri al serverului poate tăia lista: o arătăm ca incompletă, nu ca toată
          setCumulTrunchiat(!Number.isFinite(cum.count) || cum.count > rows.length)
        }
      }
      if (atentie.length) setMesaj({ tip:'warn', text:'Atenție: ' + atentie.join('; ') + '.' })
    } catch (e) { if (curent() && !e?.oprit) setMesaj({ tip:'error', text:'Nu am putut încărca: ' + (e.message || e) }) }
    finally { if (curent()) setLoad(false) }
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  // la alt profil: stare curată (nimic din contul vechi), formularele închise, încărcare nouă; la demontare / schimbare: tot ce era
  //   în curs (încărcări și acțiuni) nu mai aplică nimic
  useEffect(() => {
    setAchizitii([]); setSit(null); setParametri([]); setPoateScrie(null); setFurnizori([]); setRunda(null); setCumulat([]); setCumulTrunchiat(false)
    setFormAch(false); setCitesteOpen(false); setFormParam(null); setDetaliu(null)
    incarca()
    return () => { epoca.current++; generatie.current++ }
  }, [incarca, profilId])
  // după o acțiune: doar dacă suntem încă în aceeași epocă (același profil, componenta montată)
  const actiuneCurenta = (ep) => ep === epoca.current

  const luni = lst(sit?.luni)
  const cur = luni[0] || null
  const ant = luni[1] || null
  const luna = cur ? String(cur.luna).slice(0,10) : lunaDin(ziRO())
  const ramas = esteNumar(cur?.ramas_de_cumparat) ? Number(cur.ramas_de_cumparat) : null
  const tinta = esteNumar(cur?.jumatate) && esteNumar(cur?.report_intrat) ? Math.max(0, Number(cur.jumatate) - Number(cur.report_intrat)) : null
  const cumparat = esteNumar(cur?.achizitii_fara_tva) ? Number(cur.achizitii_fara_tva) : 0
  const procent = tinta ? Math.min(100, Math.round(cumparat / tinta * 100)) : (tinta === 0 ? 100 : 0)
  const zile = sit?.zile_ramase ?? 0

  // Categoriile pe care le vând tipic unitățile protejate — folosite ca să
  // estimăm cât din runda de consumabile ar putea merge pe deducere.
  const potrivitUpa = useMemo(() =>
    cumulat.filter(c => ['papetarie','curatenie','protocol','diverse'].includes(c.categorie)), [cumulat])

  const salveazaParametru = async () => {
    if (!formParam || lucrez) return
    const v = validaParametru(formParam.cheie, formParam.luna, formParam.valoare)
    if (v.eroare) { setMesaj({ tip:'warn', text: v.eroare }); return }
    const ep = epoca.current
    setLucrez(true)
    try {
      const { error } = await supabase.rpc('fn_upa_parametru_seteaza', { p_cheie: formParam.cheie, p_de_la: v.de_la, p_valoare: v.valoare,
        p_vechi: valoareVazuta(parametri, formParam.cheie, v.de_la), p_nota: null })
      if (!actiuneCurenta(ep)) return
      if (error) { setMesaj({ tip: error.code === '40001' ? 'warn' : 'error', text: mesajParametru(error) }); if (error.code === '40001') incarca(); return }
      setFormParam(null)
      setMesaj({ tip:'success', text:`${NUME_PARAMETRU[formParam.cheie]}: ${formParam.cheie === 'angajati_handicap' ? v.valoare : lei(v.valoare) + ' lei'} de la ${fmtLuna(v.de_la)}.` })
      incarca()
    } catch (e) { if (actiuneCurenta(ep)) setMesaj({ tip:'error', text:'Nu știu dacă s-a salvat: ' + (e.message || e) + '. Reîncarc.' }); incarca() }
    finally { setLucrez(false) }
  }

  // închiderea calculului unei luni (owner-ul, din 13 a lunii următoare, fără blocaje), pe AMPRENTA calculului afișat: dacă pontajul,
  //   facturile sau corecțiile s-au schimbat între timp, BD-ul refuză (40001) și ecranul se reîncarcă. Cronul nu închide.
  const inchideLuna = async (c) => {
    if (lucrez || !c?.amprenta) return
    const l = String(c.luna).slice(0, 10)
    if (!confirm(`Închizi calculul pentru ${fmtLuna(l)}?\n\nConfirmi că pentru toată luna:\n• normele și administratorii din „Detaliu NMA” sunt corecte (schimbările sunt înregistrate ca corecții HR);\n• suspendările fără cod în pontaj sunt înregistrate;\n• facturile au valoarea fără TVA și plata completate.\n\nDe plată la stat: ${lei(c.de_plata)} lei până pe ${fmtData(c.termen_stat)}. Valorile rămân fixe.`)) return
    const ep = epoca.current
    setLucrez(true)
    try {
      const { data, error } = await supabase.rpc('fn_upa_calcul_inchide', { p_luna: l, p_amprenta: c.amprenta })
      if (!actiuneCurenta(ep)) return
      if (error) { setMesaj({ tip: error.code === '40001' ? 'warn' : 'error', text: mesajInchidere(error) }); if (error.code === '40001') incarca(); return }
      if (data?.inchis) setMesaj({ tip:'success', text: data.deja ? 'Luna era deja închisă.' : `Închis: de plată la stat ${lei(data.calcul?.de_plata)} lei până pe ${fmtData(data.calcul?.termen_stat)}.` })
      else setMesaj({ tip:'warn', text:'Nu s-a închis: ' + (lst(data?.calcul?.blocaje).map(textCod).join('; ') || 'pontajul lunii nu e încă închis') + '.' })
      incarca()
    } catch (e) { if (actiuneCurenta(ep)) setMesaj({ tip:'error', text:'Nu știu dacă s-a închis: ' + (e.message || e) + '. Reîncarc.' }); incarca() }
    finally { setLucrez(false) }
  }

  const sterge = async (a) => {
    if (!confirm(`Ștergi achiziția de ${lei(a.valoare)} lei${a.numar_factura ? ' (factura ' + a.numar_factura + ')' : ''}?`)) return
    const ep = epoca.current
    try {
      // RLS filtrează tăcut o ștergere nepermisă (0 rânduri, fără eroare): confirmăm exact un rând
      const { data, error } = await supabase.from('upa_achizitii').delete().eq('id', a.id).select('id')
      if (!actiuneCurenta(ep)) return
      if (error) throw error
      if ((data || []).length !== 1) throw new Error('nu s-a șters nimic (nu ai drept sau a fost deja ștearsă)')
      setMesaj({ tip:'success', text:'Șters.' })
      incarca()
    } catch (e) { if (actiuneCurenta(ep)) setMesaj({ tip:'error', text:'Eroare: ' + (e.message || e) }) }
  }

  const deschidePdf = async (a) => {
    const ep = epoca.current
    let data = null, error = null
    try { ({ data, error } = await supabase.storage.from(BUCKET).createSignedUrl(a.document_path, 60)) } catch (e) { error = e }
    if (!actiuneCurenta(ep)) return
    if (error || !data?.signedUrl) { setMesaj({ tip:'error', text:'Nu am putut deschide PDF-ul: ' + (error?.message || 'link lipsă') }); return }
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  const azi = ziRO()
  const expirate = furnizori.filter(f => f.upa_valabil_pana && f.upa_valabil_pana < azi)
  const luniDisponibile = useMemo(() => {
    const set = new Set(luni.map(l => String(l.luna).slice(0,7)))
    achizitii.forEach(a => set.add(String(a.luna).slice(0,7)))
    set.add(luna.slice(0,7))
    return [...set].sort((a,b) => b.localeCompare(a))
  }, [achizitii, luni, luna])
  const achizitiiLuna = achizitii.filter(a => String(a.luna).slice(0,7) === lunaSel)
  const totalLunaSel = achizitiiLuna.reduce((s, a) => s + Number(a.valoare || 0), 0)
  const totalFaraTvaSel = achizitiiLuna.reduce((s, a) => s + Number(a.valoare_fara_tva || 0), 0)
  const faraTvaSel = achizitiiLuna.filter(a => a.valoare_fara_tva == null).length

  if (load && !sit) return <div style={{color:G.muted, fontSize:14, padding:'40px 0', textAlign:'center'}}>Se încarcă…</div>

  const culoare = ramas == null ? G.yellow : ramas === 0 ? G.green : sit?.in_alerta ? G.red : procent >= 50 ? G.yellow : G.orange
  const insigna = (c) => {
    const t = etichetaStare(c)
    if (!t) return null
    const col = c.stare === 'definitiv' ? G.green : c.pontaj_inchis ? G.orange : G.blue
    return <span style={{fontSize:10.5, fontWeight:800, color:col, border:`1px solid ${col}66`, borderRadius:6, padding:'1px 7px', marginLeft:8, letterSpacing:.4}}>{t}</span>
  }

  return (
    <div style={{padding:'4px 0 24px', color:G.text}}>
      <Mesaj mesaj={mesaj} onClose={() => setMesaj(null)} />

      {/* Alerta lunii (previziune): după ziua din setări, mai e de cumpărat ca să se folosească toată deducerea (in_alerta din BD) */}
      {sit?.in_alerta === true && (
        <div style={{...S.card, padding:'13px 16px', marginBottom:14, borderColor:G.red, background:G.red+'22', fontSize:14, color:G.red, fontWeight:700, lineHeight:1.5}}>
          🚨 Fond handicap {fmtLuna(luna)} (previziune): mai sunt <b>{lei(ramas)} lei</b> de cumpărat de la unități protejate, {zileTxt(zile)}.
          <div style={{fontSize:12, fontWeight:600, marginTop:3}}>Facturile se plătesc până la sfârșitul lunii; ce nu se deduce se plătește la bugetul de stat.</div>
        </div>
      )}
      {lst(sit?.erori_config).length > 0 && (
        <div style={{...S.card, padding:'10px 14px', marginBottom:14, borderColor:G.yellow+'55', background:G.yellow+'11', fontSize:12, color:G.yellow, lineHeight:1.6}}>
          ⚠️ Calculul / alerta nu pot rula complet: {lst(sit.erori_config).map(k => k === 'setare_zi_invalida' ? 'ziua de la care pornește alerta nu e setată corect (upa_alerta_zi)' : textCod(k)).join('; ')}.
        </div>
      )}

      {/* Luna curentă: PREVIZIUNE (pontajul se închide pe 12 a lunii următoare) */}
      <div style={{...S.card, padding:'18px 20px', marginBottom:16, borderColor:culoare+'44'}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:14, flexWrap:'wrap', marginBottom:6}}>
          <div>
            <div style={{fontSize:11, color:G.muted, fontWeight:700, textTransform:'uppercase', letterSpacing:.4}}>Fond handicap · {fmtLuna(luna)}{cur && insigna(cur)}</div>
            <div style={{fontSize:28, fontWeight:800, marginTop:6, color:culoare}}>
              {ramas == null ? 'calcul incomplet' : ramas > 0 ? <>mai sunt {lei(ramas)} <span style={{fontSize:16, color:G.muted, fontWeight:600}}>lei de cumpărat</span></> : <>deducerea e folosită integral ✓</>}
            </div>
            <div style={{fontSize:12, color:G.muted, marginTop:5}}>
              {tinta != null && <>Cumpărat {lei(cumparat)} din {lei(tinta)} lei (deducerea rămasă a lunii, fără TVA) · </>}
              {zileTxt(zile)} din lună{sit?.zi_prag ? ` · alerta pornește din ziua ${sit.zi_prag}` : ''}
            </div>
          </div>
          <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
            {poateScrie === true ? (
              <>
                <button onClick={() => setCitesteOpen(true)} style={{...S.btnS, color:'#2DD4BF', borderColor:'#2DD4BF55'}}>🤖 Citește factura (AI)</button>
                <button onClick={() => setFormAch({ ep: epoca.current })} style={S.btnP}>➕ Achiziție</button>
              </>
            ) : (
              <span style={{fontSize:11, color:G.dim, alignSelf:'center'}}>doar citire</span>
            )}
            {esteOwner && cur && cur.stare !== 'in_afara_calculului' && <button onClick={() => setDetaliu(luna)} style={S.btnS}>👥 Detaliu NMA</button>}
          </div>
        </div>

        <div style={{height:12, background:G.bg, borderRadius:8, overflow:'hidden', border:`1px solid ${G.border}`, marginTop:10}}>
          <div style={{width:procent + '%', height:'100%', background:culoare, transition:'width .3s'}} />
        </div>
        <CifreLuna c={cur} />
        <Coduri c={cur} />
        <div style={{fontSize:11, color:G.dim, marginTop:10, lineHeight:1.5}}>
          Previziune: se recalculează din pontaj și contracte; din 13 a lunii următoare, cu datele complete, owner-ul închide luna cu valoarea exactă.
          Se deduce valoarea fără TVA a facturilor plătite până pe {fmtData(cur?.termen_upa)}, cel mult jumătate din contribuția integrală; ce trece de jumătate se reportează pe lunile următoare.
        </div>
      </div>

      {/* Luna anterioară: previziune până la închiderea pontajului, apoi închisă (exact); de plată la stat până pe 25 */}
      {ant && ant.stare !== 'in_afara_calculului' && (
        <div style={{...S.card, padding:'16px 20px', marginBottom:16, borderColor: tonCuloare(stareCalculLuna(ant).ton) + '44'}}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap'}}>
            <div style={{fontSize:13, fontWeight:800}}>Luna anterioară · {fmtLuna(ant.luna)}{insigna(ant)}</div>
            <div style={{display:'flex', gap:8}}>
              {esteOwner && ant.poate_inchide === true && <button onClick={() => inchideLuna(ant)} disabled={lucrez} style={S.btnP}>🔒 Închide calculul</button>}
              {!esteOwner && ant.poate_inchide === true && <span style={{fontSize:11, color:G.dim, alignSelf:'center'}}>gata: îl închide owner-ul</span>}
              {esteOwner && <button onClick={() => setDetaliu(String(ant.luna).slice(0,10))} style={S.btnS}>👥 Detaliu NMA</button>}
            </div>
          </div>
          <div style={{fontSize:12.5, color: tonCuloare(stareCalculLuna(ant).ton), marginTop:6, fontWeight:600}}>{stareCalculLuna(ant).text}</div>
          {ant.stare === 'definitiv' && (ant.surse_schimbate?.achizitii === true || ant.surse_schimbate?.angajati === true) && (
            <div style={{fontSize:12, color:G.yellow, marginTop:4}}>⚠️ După închidere s-au schimbat {[ant.surse_schimbate?.achizitii ? `facturile lunii (acum ${lei(ant.achizitii_acum)} lei fără TVA, la închidere ${lei(ant.achizitii_fara_tva)})` : '', ant.surse_schimbate?.angajati ? 'datele de pontaj / contract ale lunii' : ''].filter(Boolean).join(' și ')}. Calculul închis nu se schimbă — vorbește cu contabilul.</div>
          )}
          <CifreLuna c={ant} />
          <Coduri c={ant} />
        </div>
      )}

      {/* Alertă autorizații expirate */}
      {expirate.length > 0 && (
        <div style={{...S.card, padding:'11px 15px', marginBottom:14, borderColor:G.red+'55', background:G.red+'11', fontSize:13, color:G.red}}>
          ⚠️ <b>{expirate.length}</b> {expirate.length === 1 ? 'furnizor UPA are autorizația expirată' : 'furnizori UPA au autorizația expirată'}: {expirate.map(f => f.nume).join(', ')} — facturile de la ei nu se mai acceptă la deducere.
        </div>
      )}

      {/* Direcționarea rundei de consumabile */}
      {rundaDeschisa && potrivitUpa.length > 0 && ramas > 0 && (
        <div style={{...S.card, padding:'14px 18px', marginBottom:16, borderColor:G.purple+'44', background:G.purple+'0C'}}>
          <div style={{fontSize:13, fontWeight:800, color:G.purple, marginBottom:6}}>
            🛒 Runda de consumabile ({rundaDeschisa.saptamana}) — {potrivitUpa.length} poziții s-ar putea lua de la UPA
          </div>
          <div style={{fontSize:12, color:G.muted, lineHeight:1.6}}>
            Papetărie, curățenie, protocol și diverse din runda curentă intră în ce vând unitățile protejate.
            Mai sunt <b style={{color:G.purple}}>{lei(ramas)} lei</b> (fără TVA) de cumpărat luna asta — cere ofertă de la un furnizor UPA
            înainte să dai comanda pe Freshful/eMAG.
          </div>
          <div style={{fontSize:11, color:G.dim, marginTop:8}}>
            {potrivitUpa.slice(0, 8).map(c => `${c.articol} (${c.cantitate_totala} ${c.um})`).join(' · ')}
            {potrivitUpa.length > 8 ? ` · …și încă ${potrivitUpa.length - 8}` : ''}
          </div>
        </div>
      )}
      {/* L18 / L23 (runda 3): trunchierea se arată ORICÂND lista rundei e tăiată */}
      {rundaDeschisa && cumulTrunchiat && (
        <div style={{...S.card, padding:'9px 14px', marginBottom:16, borderColor:G.yellow+'55', background:G.yellow+'11', fontSize:12, color:G.yellow}}>
          ⚠️ Lista rundei de consumabile ({rundaDeschisa.saptamana}) poate fi incompletă: serverul a întors doar o parte din poziții, deci estimarea de mai sus (sau lipsa ei) nu e sigură.
        </div>
      )}

      {/* Achizițiile lunii alese */}
      <div style={{...S.card, marginBottom:16, overflow:'hidden'}}>
        <div style={{padding:'11px 16px', background:G.bg, borderBottom:`1px solid ${G.border}`, fontSize:13, fontWeight:800, display:'flex', justifyContent:'space-between', alignItems:'center', gap:10, flexWrap:'wrap'}}>
          <span>🧾 Achiziții {fmtLuna(lunaSel + '-01')}{lunaSel === luna.slice(0,7) ? '' : ' (istoric)'}</span>
          <span style={{display:'flex', gap:8, alignItems:'center', flexWrap:'wrap'}}>
            <span style={{fontSize:12, color:G.green, fontWeight:800}}>{lei(totalFaraTvaSel)} lei fără TVA ({lei(totalLunaSel)} cu TVA) · {achizitiiLuna.length} {achizitiiLuna.length === 1 ? 'achiziție' : 'achiziții'}</span>
            {faraTvaSel > 0 && <span style={{fontSize:11, color:G.yellow, fontWeight:700}}>{faraTvaSel} fără valoarea fără TVA</span>}
            <select value={lunaSel} onChange={e => setLunaSel(e.target.value)} style={{...S.input, width:'auto', padding:'4px 8px', fontSize:12}}>
              {luniDisponibile.map(k => <option key={k} value={k}>{fmtLuna(k + '-01')}</option>)}
            </select>
          </span>
        </div>
        {achizitiiLuna.length === 0 ? (
          <div style={{padding:'22px 16px', textAlign:'center', color:G.muted, fontSize:13}}>
            {lunaSel === luna.slice(0,7)
              ? <>Nicio achiziție luna asta.{ramas > 0 && <> Mai sunt <b style={{color:G.orange}}>{lei(ramas)} lei</b> de cumpărat în {zileTxt(zile)}.</>}</>
              : <>Nicio achiziție înregistrată în {fmtLuna(lunaSel + '-01')}.</>}
          </div>
        ) : achizitiiLuna.map(a => {
          const lip = a.valoare_fara_tva == null || a.stare_plata !== 'platita'
          const pl = textPlata(a)
          return (
            <div key={a.id} style={{padding:'10px 16px', borderBottom:`1px solid ${G.border2}`, display:'grid', gridTemplateColumns:'1fr 100px 70px 110px 110px 44px', gap:10, alignItems:'center'}}>
              <div style={{minWidth:0}}>
                <div style={{fontSize:13, fontWeight:700}}>{a.furnizor?.nume || a.furnizor_nume || '—'}</div>
                <div style={{fontSize:11, color:G.dim}}>
                  {a.numar_factura ? 'Factura ' + a.numar_factura : <span style={{color:G.yellow}}>fără număr</span>}{a.descriere ? ' · ' + a.descriere : ''}
                  {a.data_factura && String(a.data_factura).slice(0,7) !== String(a.luna).slice(0,7) && <span style={{color:G.yellow}}> · factură din altă lună</span>}
                  <span style={{color: tonCuloare(pl.ton) === G.muted ? G.dim : tonCuloare(pl.ton)}}> · {pl.text}</span>
                </div>
                {lip && poateScrie === true && <CompletareAchizitie a={a} setMesaj={setMesaj} onGata={incarca} inEpoca={(ep => () => actiuneCurenta(ep))(epoca.current)} />}
              </div>
              <div style={{fontSize:11, color:G.muted}}>{fmtData(a.data_factura)}</div>
              <div>{a.document_path
                ? <button onClick={() => deschidePdf(a)} style={{...S.btnS, padding:'3px 8px', fontSize:11}}>📎 PDF</button>
                : <span style={{fontSize:11, color:G.yellow}}>fără PDF</span>}</div>
              <div style={{fontSize:12, color:G.muted, textAlign:'right', fontVariantNumeric:'tabular-nums'}} title="cu TVA">{lei(a.valoare)}</div>
              <div style={{fontSize:14, fontWeight:800, color: a.valoare_fara_tva == null ? G.yellow : G.green, textAlign:'right', fontVariantNumeric:'tabular-nums'}} title="fără TVA (se deduce)">
                {a.valoare_fara_tva == null ? '— fără TVA?' : lei(a.valoare_fara_tva)}
              </div>
              {poateScrie === true
                ? <button onClick={() => sterge(a)} style={{...S.btnS, padding:'4px 8px', fontSize:11, color:G.red, borderColor:G.red+'44'}}>✕</button>
                : <span />}
            </div>
          )
        })}
      </div>

      {/* Istoric pe 12 luni: calculul fiecărei luni (previziune / exact); click = achizițiile lunii (TKT-2026-0177) */}
      {luni.length > 0 && (
        <div style={{...S.card, overflow:'hidden', marginBottom:16}}>
          <div style={{padding:'11px 16px', background:G.bg, borderBottom:`1px solid ${G.border}`, fontSize:13, fontWeight:800}}>📊 Ultimele 12 luni</div>
          <div style={{padding:'6px 16px', display:'grid', gridTemplateColumns:'150px 70px 110px 110px 110px 1fr', gap:10, fontSize:10.5, color:G.dim, fontWeight:700, textTransform:'uppercase'}}>
            <span>Luna</span><span>NMA</span><span>Datorat</span><span>Achiziții</span><span>De plată</span><span>Stare</span>
          </div>
          {luni.map(l => {
            const k = String(l.luna).slice(0,7)
            const st = stareCalculLuna(l)
            return (
              <div key={k} onClick={() => setLunaSel(k)} title="Arată achizițiile lunii" style={{padding:'8px 16px', borderTop:`1px solid ${G.border2}`, display:'grid', gridTemplateColumns:'150px 70px 110px 110px 110px 1fr', gap:10, alignItems:'center', fontSize:12, cursor:'pointer', background: k === lunaSel ? G.bg : 'transparent'}}>
                <span style={{fontWeight:600}}>{fmtLuna(k + '-01')}{k === lunaSel ? ' ◂' : ''}</span>
                <span style={{color:G.muted}}>{esteNumar(l.nma) ? Number(l.nma).toLocaleString('ro-RO', { maximumFractionDigits:2 }) : '—'}</span>
                <span style={{color:G.muted}}>{leiSauLipsa(l.suma_datorata)}</span>
                <span style={{color:G.green, fontWeight:700}}>{leiSauLipsa(l.achizitii_fara_tva)}</span>
                <span style={{color:G.red, fontWeight:700}}>{leiSauLipsa(l.de_plata)}</span>
                <span style={{color: tonCuloare(st.ton), fontSize:11}}>{etichetaStare(l) ? etichetaStare(l) + ' · ' : ''}{st.text}</span>
              </div>
            )
          })}
        </div>
      )}

      {/* Parametrii calculului pe perioade (upa_parametri): salariul minim, angajații cu handicap, reportul inițial */}
      <div style={{...S.card, marginBottom:16, overflow:'hidden'}}>
        <div style={{padding:'11px 16px', background:G.bg, borderBottom:`1px solid ${G.border}`, fontSize:13, fontWeight:800, display:'flex', justifyContent:'space-between', alignItems:'center', gap:10, flexWrap:'wrap'}}>
          <span>⚙️ Parametrii calculului (pe perioade)</span>
          {poateScrie === true && !formParam && <button onClick={() => setFormParam({ cheie:'angajati_handicap', luna: luna.slice(0,7), valoare:'' })} style={{...S.btnS, padding:'4px 10px', fontSize:12}}>➕ Valoare nouă</button>}
        </div>
        {formParam && (
          <div style={{padding:'12px 16px', borderBottom:`1px solid ${G.border2}`, display:'flex', gap:10, flexWrap:'wrap', alignItems:'flex-end'}}>
            <label style={{flex:'1 1 220px'}}><span style={S.label}>Parametru</span>
              <select style={S.input} value={formParam.cheie} onChange={e => setFormParam(p => ({ ...p, cheie: e.target.value }))}>
                {CHEI_PARAMETRI.map(k => <option key={k} value={k}>{NUME_PARAMETRU[k]}</option>)}
              </select></label>
            <label style={{flex:'0 1 160px'}}><span style={S.label}>De la luna</span>
              <input style={S.input} type="month" value={formParam.luna} onChange={e => setFormParam(p => ({ ...p, luna: e.target.value }))} /></label>
            <label style={{flex:'0 1 140px'}}><span style={S.label}>Valoare</span>
              <input style={S.input} type="number" step={formParam.cheie === 'angajati_handicap' ? '1' : '0.01'} value={formParam.valoare} onChange={e => setFormParam(p => ({ ...p, valoare: e.target.value }))} /></label>
            <button onClick={salveazaParametru} disabled={lucrez} style={S.btnP}>Salvează</button>
            <button onClick={() => setFormParam(null)} style={S.btnS}>✕</button>
            <div style={{fontSize:11, color:G.dim, flexBasis:'100%'}}>Valoarea se aplică de la luna aleasă până la următoarea valoare; lunile deja închise nu se recalculează.</div>
          </div>
        )}
        {CHEI_PARAMETRI.map(k => {
          const r = parametri.filter(p => p.cheie === k)
          return (
            <div key={k} style={{padding:'9px 16px', borderBottom:`1px solid ${G.border2}`, fontSize:12.5}}>
              <div style={{fontWeight:700, marginBottom:3}}>{NUME_PARAMETRU[k]}</div>
              {r.length === 0
                ? <div style={{color:G.yellow, fontSize:12}}>neînregistrat — {k === 'angajati_handicap' ? 'calculul nu se poate face până nu se înregistrează (și 0, dacă nu sunt)' : 'de completat'}</div>
                : r.map(p => (
                  <div key={p.cheie + p.de_la} style={{color:G.muted, fontSize:12}}>
                    de la {fmtLuna(p.de_la)}: <b style={{color:G.text}}>{k === 'angajati_handicap' ? Number(p.valoare) : lei(p.valoare) + ' lei'}</b>
                    {p.nota ? <span style={{color:G.dim}}> · {p.nota}</span> : null}
                  </div>
                ))}
            </div>
          )
        })}
      </div>

      {/* Furnizori UPA */}
      <div style={{...S.card, marginBottom:16, overflow:'hidden'}}>
        <div style={{padding:'11px 16px', background:G.bg, borderBottom:`1px solid ${G.border}`, fontSize:13, fontWeight:800, display:'flex', justifyContent:'space-between', alignItems:'center', gap:10, flexWrap:'wrap'}}>
          <span>🏭 Furnizori — unități protejate ({furnizori.length})</span>
          <span style={{fontSize:11, color:G.dim, fontWeight:600}}>se marchează din Administrativ → Furnizori</span>
        </div>
        {furnizori.length === 0 ? (
          <div style={{padding:'22px 16px', textAlign:'center', color:G.muted, fontSize:13}}>
            Niciun furnizor marcat ca unitate protejată. Deschide <b>Administrativ → Furnizori</b>, editează furnizorul și bifează „Unitate protejată autorizată".
          </div>
        ) : furnizori.map(f => {
          const exp = f.upa_valabil_pana && f.upa_valabil_pana < azi
          return (
            <div key={f.id} style={{padding:'9px 16px', borderBottom:`1px solid ${G.border2}`, display:'flex', gap:12, alignItems:'center', flexWrap:'wrap'}}>
              <span style={{fontSize:13, fontWeight:700, flex:'1 1 200px'}}>{f.nume}</span>
              <span style={{fontSize:11, color:G.muted}}>{f.cui || '—'}</span>
              <span style={{fontSize:11, color:G.muted}}>Aut.: {f.upa_autorizatie || '—'}</span>
              <span style={{fontSize:11, fontWeight:700, color: exp ? G.red : G.green}}>
                {f.upa_valabil_pana ? (exp ? '⚠️ expirată ' : 'valabilă până ') + fmtData(f.upa_valabil_pana) : 'fără dată'}
              </span>
            </div>
          )
        })}
      </div>

      {formAch && (
        <FormAchizitie furnizoriUpa={furnizori} setMesaj={setMesaj} inEpoca={() => actiuneCurenta(formAch.ep)}
                       onSalvat={incarca} onClose={() => setFormAch(false)} />
      )}
      {detaliu && esteOwner && <DetaliuNma luna={detaliu} onClose={() => setDetaliu(null)} onSchimbat={incarca} setMesaj={setMesaj}
                                           inEpoca={(ep => () => actiuneCurenta(ep))(epoca.current)} />}

      {/* Citește Orice pe destinația UPA: arunci factura, AI extrage furnizor/număr/
          valoare, completezi valoarea fără TVA, confirmi → intră în calcul cu PDF-ul ca dovadă. */}
      {citesteOpen && profile && (
        <CitesteOricePanel
          open={citesteOpen}
          modul="upa"
          profile={profile}
          onClose={() => setCitesteOpen(false)}
          onConfirmed={() => incarca()}
        />
      )}
    </div>
  )
}
