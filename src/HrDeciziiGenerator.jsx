// ════════════════════════════════════════════════════════════════
// Registrul deciziilor HR — generatorul: draft → previzualizare (avertismente + pagina, B7) → emitere → PDF generat
// (spec docs/HR/GENERATOR_DECIZII_SPEC.md §4.A–D, §6; PR3). Se deschide din HR → Decizii și din Execuție → Echipă.
// Textul îl randează DOAR serverul (continut); avertismentele le calculează DOAR serverul (_hr_decizie_avertismente).
// Clientul: măsoară încadrarea (12pt → 11pt → B7), trimite fontul ales la emitere și urcă PDF-ul randat la acel font.
// Componenta își încarcă singură listele (tipuri, semnatari, angajați, proiecte), ca să poată fi deschisă și din Execuție.
// ════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './lib/supabase.js'
import { masoaraDecizie, renderDecizieHtml } from './hrDeciziiDoc.js'
import { normalizeazaDomeniiISC, acoperaDomeniul } from './iscRte.js'
import HrDeciziiScan, { GeneratScalat } from './HrDeciziiScan.jsx'
import { alteRteInVigoare } from './hrDeciziiUtil.js'
import { toateRandurile, rpc, inregistreazaPdfGenerat, deschidePdf, uuid, azi, numeAfis, mesajEroare, fmtData } from './hrDeciziiFlux.js'

const G = {
  bg:'#0D1117', surface:'#161B22', card:'#161B22', text:'#E6EDF3', muted:'#8B949E', border:'#30363D',
  blue:'#1F6FEB', green:'#2EA043', yellow:'#D29922', red:'#F85149', hr:'#EC6CB9',
  greenDim:'#0F2A1E', redDim:'#3F1A1F', yellowDim:'#332100', blueDim:'#0F1F3F',
}
const S = {
  input: { width:'100%', boxSizing:'border-box', background:G.bg, border:`1px solid ${G.border}`, borderRadius:8, padding:'9px 12px', color:G.text, fontSize:13, outline:'none' },
  btnP: { padding:'10px 18px', background:G.hr, color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontSize:14, fontWeight:600 },
  btnS: { padding:'9px 14px', background:G.surface, color:G.text, border:`1px solid ${G.border}`, borderRadius:8, cursor:'pointer', fontSize:13 },
}
const NIV = { B: { c: G.red, bg: G.redDim, t: 'blocant' }, R: { c: G.yellow, bg: G.yellowDim, t: 'confirmare' }, G: { c: G.blue, bg: G.blueDim, t: 'info' } }
// Coloanele pe care clientul le poate scrie pe draft (GRANT INSERT/UPDATE, §3.4).
const COLOANE = ['tip_cod', 'eticheta_functie', 'nivel', 'employee_id', 'proiect_id', 'proiect_denumire', 'autorizatie_id', 'domenii_isc', 'titlu',
  'temei', 'data_emitere', 'data_efect', 'data_efect_pana', 'semnatar_id', 'luare_la_cunostinta', 'propune_efect', 'inlocuieste_id', 'revoca_id']

const Camp = ({ t, children, nota }) => <label style={{ display:'block', marginBottom:10, fontSize:13 }}>{t}<div style={{ marginTop:4 }}>{children}</div>{nota && <div style={{ fontSize:11.5, color:G.muted, marginTop:3 }}>{nota}</div>}</label>

/**
 * initial: null (decizie nouă) | rândul unui draft | {preset:'inlocuire'|'revocare', tinta} | {preset:'proiect', proiect_id, tip_cod, employee_id}
 */
export default function HrDeciziiGenerator({ initial, onClose, showToast }) {
  const [liste, setListe] = useState(null)
  const [f, setF] = useState(null)                 // câmpurile draftului
  const [draftId, setDraftId] = useState(initial?.id && initial?.stare === 'draft' ? initial.id : null)
  const [pas, setPas] = useState('form')           // form | prev | emis
  const [prev, setPrev] = useState(null)           // {continut, avertismente, hash_previzualizare, fontPt, inaltimi}
  const [numar, setNumar] = useState('')
  const [conf, setConf] = useState([])
  const [salt, setSalt] = useState({ cerut: false, ok: false })
  const [emis, setEmis] = useState(null)           // rândul emis
  const [aut, setAut] = useState([])
  const [lucru, setLucru] = useState(false)
  const [err, setErr] = useState('')
  const [scan, setScan] = useState(false)
  const cerere = useRef({ cheie: null, id: null })
  const pdfStare = useRef({})

  // Listele + starea inițială a formularului
  useEffect(() => {
    let viu = true
    ;(async () => {
      const [rt, rs, re, rp, rd, ri, rat] = await Promise.all([
        supabase.from('hr_decizii_tipuri').select('*').eq('activ', true).order('ordine'),
        supabase.from('hr_decizii_semnatari').select('*').eq('activ', true).order('ordine'),
        supabase.from('employees').select('id, name, active, termination_date').order('name'),
        supabase.from('executie_proiecte').select('id, nume, activ, nr_contract, data_contract').order('nume'),
        toateRandurile(() => supabase.from('hr_decizii').select('id, employee_id, titlu, tip_cod, proiect_id, stare, nivel, domenii_isc, data_efect, data_efect_pana').order('id', { ascending: false })).then(data => ({ data }), () => ({ data: [] })),
        supabase.from('isc_rte_domenii').select('cod, denumire, activ').order('cod'),
        supabase.from('hr_autorizatii_tipuri').select('id, cod, denumire'),
      ])
      if (!viu) return
      const L = { tipuri: rt.data || [], semnatari: rs.data || [], angajati: re.data || [], proiecte: rp.data || [], decizii: rd.data || [],
        isc: (ri.data || []).filter(x => x.activ !== false), autTip: Object.fromEntries((rat.data || []).map(t => [t.id, t])) }
      setListe(L)
      const tinta = initial?.tinta
      const baza = { tip_cod: '', eticheta_functie: '', nivel: 'proiect', employee_id: '', proiect_id: '', proiect_denumire: '', autorizatie_id: '',
        domenii_isc: [], titlu: '', temei: '', data_emitere: azi(), data_efect: azi(), data_efect_pana: '', semnatar_id: '', luare_la_cunostinta: false,
        propune_efect: true, inlocuieste_id: null, revoca_id: null }
      let v = baza
      if (initial?.stare === 'draft') v = { ...baza, ...Object.fromEntries(COLOANE.map(k => [k, initial[k] ?? baza[k]])) }
      else if (initial?.preset === 'inlocuire') v = { ...baza, tip_cod: tinta.tip_cod, nivel: tinta.nivel, proiect_id: tinta.proiect_id || '', proiect_denumire: tinta.proiect_denumire || '',
        eticheta_functie: tinta.eticheta_functie, domenii_isc: tinta.domenii_isc || [], inlocuieste_id: tinta.id, temei: tinta.temei || '' }
      else if (initial?.preset === 'revocare') v = { ...baza, tip_cod: 'REVOCARE', nivel: tinta.nivel, proiect_id: tinta.proiect_id || '', employee_id: tinta.employee_id || '',
        eticheta_functie: tinta.eticheta_functie, titlu: tinta.titlu || '', revoca_id: tinta.id }
      else if (initial?.preset === 'proiect') v = { ...baza, tip_cod: initial.tip_cod || '', proiect_id: initial.proiect_id || '', employee_id: initial.employee_id || '' }
      if (initial?.stare !== 'draft' && v.tip_cod) {          // valorile implicite ale tipului (eticheta, temei, semnatar D2c)
        const t = L.tipuri.find(x => x.cod === v.tip_cod)
        v = { ...v, eticheta_functie: v.eticheta_functie || t?.eticheta_functie || '', temei: v.temei || t?.temei_implicit || '',
          semnatar_id: v.semnatar_id || t?.semnatar_implicit_id || '', nivel: t?.nivel && t.nivel !== 'ambele' ? t.nivel : v.nivel }
        if (initial?.preset === 'proiect' && v.employee_id) {
          const ult = L.decizii.find(d => d.employee_id === Number(v.employee_id) && d.titlu)
          if (ult) v.titlu = ult.titlu
        }
      }
      for (const k of ['employee_id', 'proiect_id', 'autorizatie_id', 'semnatar_id']) v[k] = v[k] == null ? '' : String(v[k])
      if (initial?.preset === 'proiect' && v.proiect_id) v.proiect_denumire = L.proiecte.find(p => String(p.id) === v.proiect_id)?.nume || ''
      setF(v)
    })()
    return () => { viu = false }
  }, [initial])

  const tip = useMemo(() => liste?.tipuri.find(t => t.cod === f?.tip_cod), [liste, f?.tip_cod])
  const revocare = f?.tip_cod === 'REVOCARE'
  const tinta = initial?.tinta
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))

  // La alegerea tipului: eticheta, temeiul, nivelul, semnatarul implicit (D2c)
  function alegeTip(cod) {
    const t = liste.tipuri.find(x => x.cod === cod)
    setF(x => ({ ...x, tip_cod: cod, eticheta_functie: t?.eticheta_functie || '', temei: t?.temei_implicit || '',
      nivel: t?.nivel === 'ambele' ? x.nivel : (t?.nivel || x.nivel), semnatar_id: x.semnatar_id || String(t?.semnatar_implicit_id || ''),
      autorizatie_id: '', domenii_isc: t?.necesita_domeniu_isc ? x.domenii_isc : [] }))
  }
  // Titlul propus din ultima decizie a persoanei (C41)
  function alegeAngajat(id) {
    const ult = liste.decizii.find(d => String(d.employee_id) === String(id) && d.titlu)
    setF(x => ({ ...x, employee_id: id, autorizatie_id: '', titlu: x.titlu || ult?.titlu || '' }))
  }
  function alegeProiect(id) {
    const p = liste.proiecte.find(x => String(x.id) === String(id))
    setF(x => ({ ...x, proiect_id: id, proiect_denumire: p?.nume || '' }))
  }

  // Atestatele angajatului, filtrate pe tipurile cerute de decizie (neșterse, neînlocuite)
  useEffect(() => {
    if (!f?.employee_id || !tip?.autorizatie_tipuri?.length || !liste) { setAut([]); return }
    supabase.from('hr_autorizatii').select('id, tip_id, numar_autorizatie, emitent, data_emitere, data_expirare, fara_expirare, domenii, verificat_pe_scan')
      .eq('employee_id', Number(f.employee_id)).is('deleted_at', null).is('inlocuita_de_id', null)
      .then(({ data }) => setAut((data || []).filter(a => tip.autorizatie_tipuri.includes(liste.autTip[a.tip_id]?.cod))))
  }, [f?.employee_id, tip, liste])

  const atestat = aut.find(a => String(a.id) === String(f?.autorizatie_id))
  const domeniiAtestat = useMemo(() => normalizeazaDomeniiISC(atestat?.domenii).coduri, [atestat])

  const lipsa = !f ? ['…'] : revocare
    ? [!f.data_emitere && 'data emiterii', !f.data_efect && 'data efectului', !f.semnatar_id && 'semnatarul', !f.titlu && 'titlul']
    : [!f.tip_cod && 'tipul', !f.employee_id && 'angajatul', !f.titlu && 'titlul', f.nivel === 'proiect' && !f.proiect_id && 'proiectul',
       !f.data_emitere && 'data emiterii', !f.data_efect && 'data efectului', !f.semnatar_id && 'semnatarul', !f.eticheta_functie && 'eticheta']
  const lipsaTxt = lipsa.filter(Boolean)

  async function salveazaDraft() {
    const rand = {}
    for (const k of COLOANE) {
      let v = f[k]
      if (['employee_id', 'proiect_id', 'autorizatie_id', 'semnatar_id'].includes(k)) v = v === '' || v == null ? null : Number(v)
      if (['data_efect_pana', 'temei', 'proiect_denumire', 'titlu', 'eticheta_functie'].includes(k) && v === '') v = null
      if (k === 'domenii_isc') v = v?.length ? v : null
      if (k === 'proiect_id' && f.nivel !== 'proiect') v = null
      if (k === 'proiect_denumire' && f.nivel !== 'proiect') v = null
      rand[k] = v
    }
    if (draftId) {
      const { error } = await supabase.from('hr_decizii').update(rand).eq('id', draftId).eq('stare', 'draft')
      if (error) throw new Error(mesajEroare(error))
      return draftId
    }
    const { data, error } = await supabase.from('hr_decizii').insert(rand).select('id').single()
    if (error) throw new Error(mesajEroare(error))
    setDraftId(data.id)
    return data.id
  }

  async function previzualizeaza() {
    setLucru(true); setErr('')
    try {
      const id = await salveazaDraft()
      const r = await rpc('fn_hr_decizie_previzualizeaza', { p_id: id, p_numar: numar ? parseInt(numar, 10) : null })
      let fontPt = null, inaltimi = {}
      if (r.continut) ({ fontPt, inaltimi } = await masoaraDecizie(r.continut, { previzualizare: true }))
      setPrev({ ...r, fontPt, inaltimi })
      setConf(c => c.filter(x => (r.avertismente || []).some(a => a.cod === x)))
      setPas('prev')
    } catch (e) { setErr(mesajEroare(e)) } finally { setLucru(false) }
  }

  const blocante = (prev?.avertismente || []).filter(a => a.nivel === 'B')
  const rosii = (prev?.avertismente || []).filter(a => a.nivel === 'R')
  const poateEmite = prev?.continut && prev.fontPt && !blocante.length && rosii.every(a => conf.includes(a.cod)) && (!salt.cerut || salt.ok)

  async function emite() {
    if (!poateEmite) return
    setLucru(true); setErr('')
    const params = { p_id: draftId, p_hash_previzualizare: prev.hash_previzualizare, p_font_pt: prev.fontPt,
      p_numar: numar ? parseInt(numar, 10) : null, p_confirmari: [...conf].sort(), p_confirm_salt: !!salt.ok }
    const cheie = JSON.stringify(params)
    if (cerere.current.cheie !== cheie) cerere.current = { cheie, id: uuid() }      // același cerere_id doar la retry identic (P2-5)
    try {
      let rand = emis
      if (!rand) {
        await rpc('fn_hr_decizie_emite', { ...params, p_cerere_id: cerere.current.id })
        const { data, error } = await supabase.from('hr_decizii').select('*').eq('id', draftId).single()
        if (error) throw new Error(mesajEroare(error))
        rand = data; setEmis(data); setPas('emis')
      }
      try {
        const path = await inregistreazaPdfGenerat(rand, pdfStare.current)
        setEmis(x => ({ ...x, pdf_path: path }))
        showToast?.('Decizie emisă — PDF înregistrat')
      } catch (e) {
        setErr('Decizia e emisă, dar PDF-ul nu s-a înregistrat: ' + mesajEroare(e) + '. Reîncearcă „Înregistrează PDF-ul” (numărul nu se pierde).')
      }
    } catch (e) {
      const m = mesajEroare(e)
      if (/salt_mare/.test(m)) setSalt({ cerut: true, ok: false })
      if (/draftul s-a schimbat|previzualizeaza din nou/.test(m)) { setPas('form'); setPrev(null) }
      setErr(m)
    } finally { setLucru(false) }
  }

  if (!liste || !f) return <Fereastra titlu="Decizie nouă" onClose={onClose}><div style={{ color:G.muted }}>Se încarcă…</div></Fereastra>

  const titlu = revocare ? `Revocare — decizia nr ${tinta ? (tinta.nr_afisat || tinta.numar) : ''}` : f.inlocuieste_id ? `Înlocuire — decizia nr ${tinta?.nr_afisat || ''}` : draftId ? `Draft #${draftId}` : 'Decizie nouă'
  const niveluri = tip?.nivel === 'ambele' ? ['proiect', 'firma'] : [tip?.nivel || f.nivel]
  const etichete = [tip?.eticheta_functie, ...(tip?.etichete_alternative || [])].filter(Boolean)
  const emiseRow = emis

  return (
    <Fereastra titlu={titlu} onClose={lucru ? () => {} : onClose} lat={pas !== 'form'}>
      {pas === 'form' && (
        <div>
          {revocare ? (
            <div style={{ padding:10, background:G.blueDim, borderRadius:8, marginBottom:12, fontSize:13 }}>
              Se revocă: <b>{tinta?.eticheta_functie}</b> · {tinta?.pers || numeAfis(liste.angajati.find(a => a.id === tinta?.employee_id)?.name)} · {tinta?.proiect || 'firmă'}.
              Nivelul, proiectul, persoana și eticheta se copiază din decizia revocată. În v1 efectul e imediat (data efectului ≤ data emiterii).
            </div>
          ) : (
            <>
              <Camp t="Tipul deciziei">
                <select value={f.tip_cod} disabled={!!f.inlocuieste_id} onChange={e => alegeTip(e.target.value)} style={S.input}>
                  <option value="">— alege —</option>
                  {liste.tipuri.filter(t => t.are_sablon && t.cod !== 'REVOCARE').map(t => <option key={t.cod} value={t.cod}>{t.denumire}</option>)}
                </select>
              </Camp>
              {niveluri.length > 1 && <Camp t="Nivel"><select value={f.nivel} disabled={!!f.inlocuieste_id} onChange={e => set('nivel', e.target.value)} style={S.input}><option value="proiect">proiect</option><option value="firma">firmă</option></select></Camp>}
              <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:10 }}>
                <Camp t="Angajatul"><select value={f.employee_id} onChange={e => alegeAngajat(e.target.value)} style={S.input}>
                  <option value="">— alege —</option>{liste.angajati.filter(a => a.active !== false).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Camp>
                <Camp t="Titlu"><select value={f.titlu} onChange={e => set('titlu', e.target.value)} style={S.input}><option value="">—</option><option>Dl.</option><option>D-na</option></select></Camp>
              </div>
              {f.nivel === 'proiect' && <>
                <Camp t="Proiectul"><select value={f.proiect_id} disabled={!!f.inlocuieste_id} onChange={e => alegeProiect(e.target.value)} style={S.input}>
                  <option value="">— alege —</option>{liste.proiecte.filter(p => p.activ || String(p.id) === String(f.proiect_id)).map(p => <option key={p.id} value={p.id}>{p.nume}</option>)}</select></Camp>
                <Camp t="Denumirea proiectului în decizie" nota="Precompletată din Execuție; se poate corecta ca în contract."><input value={f.proiect_denumire} onChange={e => set('proiect_denumire', e.target.value)} style={S.input} /></Camp>
              </>}
              {etichete.length > 1 && <Camp t="Funcția (cum apare în decizie)"><select value={f.eticheta_functie} onChange={e => set('eticheta_functie', e.target.value)} style={S.input}>{etichete.map(x => <option key={x}>{x}</option>)}</select></Camp>}
              {tip?.autorizatie_tipuri?.length > 0 && (
                <Camp t={`Atestatul (${tip.autorizatie_ceruta === 'obligatorie' ? 'obligatoriu' : 'recomandat'})`}>
                  <select value={f.autorizatie_id} onChange={e => set('autorizatie_id', e.target.value)} style={S.input}>
                    <option value="">— fără —</option>
                    {aut.map(a => <option key={a.id} value={a.id}>{liste.autTip[a.tip_id]?.denumire} nr {a.numar_autorizatie || '?'} / {fmtData(a.data_emitere)}{a.fara_expirare ? '' : ` · exp. ${fmtData(a.data_expirare)}`}{a.verificat_pe_scan ? '' : ' · neverificat pe scan'}</option>)}
                  </select>
                  {f.employee_id && !aut.length && <div style={{ fontSize:11.5, color:G.yellow, marginTop:3 }}>Angajatul nu are un atestat de tipul cerut în HR → Autorizații.</div>}
                </Camp>
              )}
              {tip?.necesita_domeniu_isc && (
                <Camp t="Domeniile ISC" nota={atestat ? `Atestatul acoperă: ${domeniiAtestat.join(', ') || '—'}` : 'Alege atestatul ca să vezi acoperirea.'}>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                    {liste.isc.map(x => {
                      const on = (f.domenii_isc || []).includes(x.cod)
                      const acop = atestat && acoperaDomeniul(x.cod, domeniiAtestat)
                      return <button key={x.cod} type="button" title={x.denumire} onClick={() => set('domenii_isc', on ? f.domenii_isc.filter(c => c !== x.cod) : [...(f.domenii_isc || []), x.cod])}
                        style={{ ...S.btnS, padding:'4px 9px', fontSize:12, background: on ? G.hr : G.bg, color: on ? '#fff' : (acop ? G.green : G.text), borderColor: acop ? G.green : G.border }}>{x.cod}</button>
                    })}
                  </div>
                </Camp>
              )}
              <Camp t="Temeiul" nota={tip?.temei_sursa === 'propunere' ? 'Temei propus, nevalidat juridic (R5).' : null}><input value={f.temei} onChange={e => set('temei', e.target.value)} style={S.input} /></Camp>
            </>
          )}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10 }}>
            <Camp t="Data emiterii"><input type="date" value={f.data_emitere} max={azi()} onChange={e => set('data_emitere', e.target.value)} style={S.input} /></Camp>
            <Camp t="Data efectului"><input type="date" value={f.data_efect} onChange={e => set('data_efect', e.target.value)} style={S.input} /></Camp>
            {!revocare && <Camp t="Valabilă până la (opțional)"><input type="date" value={f.data_efect_pana || ''} onChange={e => set('data_efect_pana', e.target.value)} style={S.input} /></Camp>}
          </div>
          {revocare && !tinta?.titlu && <Camp t="Titlu (decizia revocată nu-l are)"><select value={f.titlu} onChange={e => set('titlu', e.target.value)} style={S.input}><option value="">—</option><option>Dl.</option><option>D-na</option></select></Camp>}
          <Camp t="Semnatarul"><select value={f.semnatar_id} onChange={e => set('semnatar_id', e.target.value)} style={S.input}>
            <option value="">— alege —</option>{liste.semnatari.map(s => <option key={s.id} value={s.id}>{numeAfis(liste.angajati.find(a => a.id === s.employee_id)?.name)} — {s.calitate}</option>)}</select></Camp>
          <label style={{ display:'flex', gap:8, alignItems:'center', fontSize:13, marginBottom:6 }}><input type="checkbox" checked={!!f.luare_la_cunostinta} onChange={e => set('luare_la_cunostinta', e.target.checked)} /> Rubrica „ANGAJAT, am luat la cunoștință”</label>
          {!revocare && tip?.camp_efect && f.nivel === 'proiect' && (
            <label style={{ display:'flex', gap:8, alignItems:'center', fontSize:13, marginBottom:6 }}><input type="checkbox" checked={!!f.propune_efect} onChange={e => set('propune_efect', e.target.checked)} />
              După semnare, propune schimbarea echipei proiectului (se confirmă în Execuție)</label>
          )}
          {!revocare && f.tip_cod === 'RTE' && f.proiect_id && alteRteInVigoare(liste.decizii, f.proiect_id, f.employee_id, f.domenii_isc, azi()) && <div style={{ fontSize:12, color:G.yellow, marginBottom:6 }}>Pe proiect există deja un RTE în vigoare pe alt domeniu (G7, C11): debifează efectul pe echipă dacă noul RTE NU devine cel principal.</div>}
          {err && <div style={{ padding:8, background:G.redDim, borderRadius:8, fontSize:13, margin:'8px 0' }}>{err}</div>}
          <div style={{ display:'flex', gap:8, marginTop:12, alignItems:'center', flexWrap:'wrap' }}>
            <button style={{ ...S.btnP, opacity: lipsaTxt.length || lucru ? .5 : 1 }} disabled={!!lipsaTxt.length || lucru} onClick={previzualizeaza}>{lucru ? 'Se lucrează…' : '👁 Salvează și previzualizează'}</button>
            {lipsaTxt.length > 0 && <span style={{ fontSize:12, color:G.muted }}>Lipsește: {lipsaTxt.join(', ')}</span>}
          </div>
        </div>
      )}

      {pas === 'prev' && prev && (
        <div style={{ display:'flex', gap:16, flexWrap:'wrap' }}>
          <div style={{ flex:'1 1 360px', minWidth:0 }}>
            {prev.continut
              ? <GeneratScalat html={renderDecizieHtml(prev.continut, null, { fontPt: prev.fontPt || 12, previzualizare: true })} />
              : <div style={{ padding:20, color:G.muted, border:`1px dashed ${G.border}`, borderRadius:8 }}>Fără pagină: rezolvă întâi avertismentele blocante.</div>}
            {prev.continut && <div style={{ fontSize:12, color: prev.fontPt ? G.muted : G.red, marginTop:6 }}>
              {prev.fontPt ? `Încape pe o pagină A4 la ${prev.fontPt}pt.` : 'B7: textul nu încape pe o pagină A4 nici la 11pt — scurtează temeiul sau denumirea proiectului.'}</div>}
          </div>
          <div style={{ flex:'1 1 300px', minWidth:0 }}>
            <div style={{ fontWeight:700, marginBottom:8 }}>Avertismente</div>
            {!(prev.avertismente || []).length && <div style={{ color:G.muted, fontSize:13 }}>Niciunul.</div>}
            {(prev.avertismente || []).map((a, i) => (
              <div key={i} style={{ padding:'8px 10px', marginBottom:6, borderRadius:8, background: NIV[a.nivel]?.bg, borderLeft:`3px solid ${NIV[a.nivel]?.c}`, fontSize:13 }}>
                <b>{a.cod}</b> {a.mesaj}
                {a.nivel === 'R' && <label style={{ display:'flex', gap:6, alignItems:'center', marginTop:4 }}><input type="checkbox" checked={conf.includes(a.cod)}
                  onChange={e => setConf(c => e.target.checked ? [...c, a.cod] : c.filter(x => x !== a.cod))} /> Confirm și emit așa</label>}
              </div>
            ))}
            <Camp t="Număr manual (gol = următorul automat)" nota="Pentru o decizie pe anul trecut sau un număr dat deja pe hârtie."><input value={numar} onChange={e => { setNumar(e.target.value.replace(/\D/g, '')); setSalt({ cerut: false, ok: false }) }} inputMode="numeric" style={S.input} /></Camp>
            {salt.cerut && <label style={{ display:'flex', gap:6, alignItems:'center', fontSize:13, marginBottom:8, color:G.yellow }}><input type="checkbox" checked={salt.ok} onChange={e => setSalt({ cerut: true, ok: e.target.checked })} /> Confirm saltul mare de număr (R7)</label>}
            {numar && <div style={{ fontSize:12, color:G.muted, marginBottom:8 }}>Numărul manual schimbă avertismentele (B3/B8): previzualizează din nou dacă l-ai modificat.</div>}
            {err && <div style={{ padding:8, background:G.redDim, borderRadius:8, fontSize:13, margin:'8px 0' }}>{err}</div>}
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              <button style={S.btnS} disabled={lucru} onClick={() => { setPas('form'); setErr('') }}>← Modifică</button>
              <button style={S.btnS} disabled={lucru} onClick={previzualizeaza}>↻ Previzualizează din nou</button>
              <button style={{ ...S.btnP, background: poateEmite ? G.green : G.surface, color: poateEmite ? '#fff' : G.muted }} disabled={!poateEmite || lucru} onClick={emite}>{lucru ? 'Se emite…' : '✔ Emite decizia'}</button>
            </div>
          </div>
        </div>
      )}

      {pas === 'emis' && emiseRow && (
        <div>
          <div style={{ padding:14, background:G.greenDim, borderRadius:10, marginBottom:12 }}>
            <div style={{ fontSize:13, color:G.muted }}>Decizia a fost emisă cu numărul</div>
            <div style={{ fontSize:28, fontWeight:800, color:G.hr }}>{emiseRow.numar}/{fmtData(emiseRow.data_emitere)}</div>
            <div style={{ fontSize:13 }}>Cod de verificare: <b style={{ fontFamily:'monospace' }}>{emiseRow.cod_verificare}</b></div>
          </div>
          <div style={{ fontSize:13, color:G.muted, marginBottom:10 }}>Printează PDF-ul, semnează și ștampilează. Apoi încarcă scanul (merge și din poze de pe telefon: HR → Decizii → 📷 Scan semnat).</div>
          {err && <div style={{ padding:8, background:G.redDim, borderRadius:8, fontSize:13, margin:'8px 0' }}>{err}</div>}
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            {emiseRow.pdf_path
              ? <button style={S.btnP} onClick={() => deschidePdf(emiseRow.pdf_path).catch(e => setErr(mesajEroare(e)))}>⬇ Descarcă PDF-ul</button>
              : <button style={S.btnP} disabled={lucru} onClick={emite}>{lucru ? 'Se lucrează…' : '⟳ Înregistrează PDF-ul'}</button>}
            {emiseRow.pdf_path && <button style={S.btnS} onClick={() => setScan(true)}>📷 Încarcă scanul acum</button>}
            <button style={S.btnS} onClick={onClose}>Închide</button>
          </div>
        </div>
      )}
      {scan && emiseRow && <HrDeciziiScan decizie={{ ...emiseRow, nr_afisat: `${emiseRow.numar}/${fmtData(emiseRow.data_emitere)}` }} showToast={showToast} onClose={() => { setScan(false); onClose() }} />}
    </Fereastra>
  )
}

function Fereastra({ titlu, children, onClose, lat }) {
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.7)', zIndex:900, display:'flex', justifyContent:'center', alignItems:'flex-start', overflowY:'auto' }}>
      <div style={{ background:G.card, color:G.text, borderRadius:12, border:`1px solid ${G.border}`, width:'100%', maxWidth: lat ? 1100 : 640, margin:'24px 12px', padding:18, boxSizing:'border-box' }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:12, gap:8 }}>
          <div style={{ fontWeight:700, fontSize:16 }}>{titlu}</div>
          <button style={{ ...S.btnS, padding:'4px 10px' }} onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}
