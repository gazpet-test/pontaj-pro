// Fișa parcelei: date parcelă (valoare_lei doar admin), deținători + contact (admin/editor), cronologie unită
// (convocări, răspunsuri, PV, jurnal), fișiere cu link semnat, editare câmpuri de bază, soft delete cu motiv.
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { supabase } from '../../lib/supabase.js'
import ModalPv from './ModalPv.jsx'
import { normalizeazaNume } from '../idParcela.js'
import { genereazaConvocator, reincarcaConvocator } from '../docx.js'
import { dataDocumentConvocare } from '../convocatorNeexpediat.js'   // #991 r3: aceeași dată civilă București ca în Registru
import { termenConstatare, mesajTermenConstatare } from '../setari.js'
import { dataBucuresti } from '../plicuri.js'
import { citesteSmsStare, stareSmsPentru, rezumatSms, textBadge, intrariCronologie, STARI_SMS } from '../smsStare.js'
import { G, S, fmtDate, fmtDateTime, fmtNum, msgEroare, Modal, Camp, Gol, CALITATI, etichetaOptiune, etichetaRetur,
  SABLON_CONVOCATOR, COL_DETINATOR, COL_CONVOCARE, COL_RASPUNS, COL_RASPUNS_META, citesteTokenRaspuns, citestePaginat, citesteIn } from './comune.jsx'

const COL_PARCELA = 'id, proiect_id, uat_id, id_parcela, tronson, km_de_la, km_pana_la, sat, tarla, nr_cadastral, poz_hg, suprafata_temporara_mp, categoria_folosinta, articol_deviz, cantitate, observatii, sters_la, sters_motiv, created_at'
const CAMPURI_PARCELA = [
  ['sat', 'Sat'], ['tarla', 'Tarla'], ['nr_cadastral', 'Nr. cadastral'], ['poz_hg', 'Poz. HG'],
  ['suprafata_temporara_mp', 'Suprafață temporară (mp)', 'number'], ['categoria_folosinta', 'Categorie folosință'],
  ['articol_deviz', 'Articol deviz'], ['cantitate', 'Cantitate', 'number'], ['km_de_la', 'km de la', 'number'], ['km_pana_la', 'km până la', 'number'],
]
const CAMPURI_CONTACT = [['adresa_strada', 'Stradă / nr.'], ['adresa_sat', 'Sat'], ['adresa_comuna', 'Comună / oraș'], ['adresa_judet', 'Județ'], ['cod_postal', 'Cod poștal'], ['telefon', 'Telefon'], ['email', 'Email']]
const nrSauNull = (v) => (v === '' || v === null || v === undefined) ? null : Number(v)

/** Rândul „SMS: …” la fiecare deținător (20261130i, doar agregate). sms = { harta, eroare }; eroarea se afișează, nu devine „niciun SMS” (L18).
 *  Exportată pentru testul de randare. */
export function RandSms({ sms, detinatorId }) {
  if (!sms || sms.eroare) return <div data-testid="rand-sms" style={{ fontSize:12.5, marginTop:4, color:G.red }}>SMS: ⚠ starea nu s-a putut citi{sms?.eroare ? ` (${sms.eroare})` : ''}</div>
  if (!sms.harta) return <div data-testid="rand-sms" style={{ fontSize:12.5, marginTop:4, color:G.dim }}>SMS: …</div>
  const s = stareSmsPentru(sms.harta, detinatorId)
  if (!s) return <div data-testid="rand-sms" style={{ fontSize:12.5, marginTop:4, color:G.dim }}>SMS: niciun SMS</div>
  return (
    <div data-testid="rand-sms" style={{ fontSize:12.5, marginTop:4 }}>
      SMS: <span data-sms={s.ultima_stare} style={{ color:STARI_SMS[s.ultima_stare].culoare, fontWeight:600 }}>{textBadge(s)}</span>
      <span style={{ color:G.muted }}> · {rezumatSms(s)}</span>
    </div>
  )
}

/** Plan pct. 4.6: linia de avertisment neblocant pe rândul deținătorului (de confirmat claude#026 î.5). Exportată pentru testul de randare. */
export function AvertismentConstatare({ uat, detinator, raspunsuri, pvs, azi }) {
  if (!detinator || detinator.sters_la) return null
  const t = termenConstatare({ uat, detinatorId: detinator.id, raspunsuri, pvs, azi })
  const m = mesajTermenConstatare(t)
  return m ? <div data-testid="avertisment-constatare" style={{ fontSize:12.5, marginTop:4, color: t.depasit ? G.red : G.yellow }}>⚠ {m}</div> : null
}

export default function FisaParcela({ parcelaId, proiect, uats, nivel, profile, show, onInapoi, onSchimbat }) {
  const poateScrie = nivel === 'admin' || nivel === 'editor'
  const esteAdmin = nivel === 'admin'
  const [parcela, setParcela] = useState(null)
  const [tronsonLucru,setTronsonLucru]=useState(false)
  const tronsonGeneratie=useRef(0), tronsonOcupat=useRef(false)
  useEffect(()=>{
    tronsonGeneratie.current++;tronsonOcupat.current=false;setTronsonLucru(false)
    return ()=>{tronsonGeneratie.current++}
  },[parcelaId,proiect.id])
  const schimbaTronson=async valoare=>{
    // Copilot f8a r1 P1-01: tronsonul il schimba doar administratorul (impus si in BD)
    if(!esteAdmin||tronsonOcupat.current||!parcela||parcela.id!==parcelaId||parcela.proiect_id!==proiect.id)return
    const vechi=parcela.tronson, nou=valoare===''?null:Number(valoare)
    if(nou===vechi)return
    tronsonOcupat.current=true;setTronsonLucru(true)
    const token=tronsonGeneratie.current, id=parcelaId, proiectId=proiect.id
    const curent=()=>token===tronsonGeneratie.current
    try{
      let q=supabase.from('red_parcele').update({tronson:nou}).eq('id',id).eq('proiect_id',proiectId)
      q=vechi==null?q.is('tronson',null):q.eq('tronson',vechi)
      const {data,error}=await q.select('id,tronson')
      if(!curent())return
      if(error)throw error
      if(!Array.isArray(data))throw new Error('Raspuns necunoscut; reincarca fisa inainte de reluare')
      if(data.length!==1){
        const {data:p,error:e}=await supabase.from('red_parcele').select('id,tronson').eq('id',id).eq('proiect_id',proiectId).single()
        if(!curent())return
        if(e)throw e
        setParcela(v=>v?.id===id?{...v,tronson:p.tronson}:v)
        throw new Error('Conflict: tronsonul a fost modificat. Valoarea a fost reincarcata.')
      }
      setParcela(v=>v?.id===id?{...v,tronson:data[0].tronson}:v)
      show('Tronson actualizat','success');onSchimbat?.()
    }catch(e){if(curent())show((e.code?e.code+': ':'')+msgEroare(e),'error')}
    finally{if(curent()){tronsonOcupat.current=false;setTronsonLucru(false)}}
  }
  const [valoare, setValoare] = useState(null)   // valoare_lei — doar admin
  const [detinatori, setDetinatori] = useState([])
  const [contacte, setContacte] = useState({})    // detinator_id → contact
  const [convocari, setConvocari] = useState([])
  const [raspunsuri, setRaspunsuri] = useState([])
  const [metaRaspuns, setMetaRaspuns] = useState({})   // raspuns_id → { ip_sau_sursa, user_agent } — doar admin/editor
  const [pvs, setPvs] = useState([])
  const [jurnal, setJurnal] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)        // { tip:'parcela'|'detinator'|'sterge', ... }
  // SMS pe deținător (fn_red_sms_stare): un apel pe proiect, cu token de generație (L24) — un răspuns pentru alt proiect / parcelă se ignoră
  const [sms, setSms] = useState({ harta: null, eroare: null })
  const generatieSms = useRef(0)
  const incarcaSms = useCallback(async () => {
    const g = ++generatieSms.current
    setSms({ harta: null, eroare: null })
    try {
      const harta = await citesteSmsStare(supabase, proiect.id, () => g === generatieSms.current)
      if (g !== generatieSms.current) return
      setSms({ harta, eroare: null })
    } catch (e) { if (g === generatieSms.current) setSms({ harta: null, eroare: msgEroare(e) }) }
  }, [proiect.id])
  useEffect(() => { incarcaSms(); return () => { generatieSms.current++ } }, [incarcaSms, parcelaId])

  const incarca = useCallback(async () => {
    setLoading(true)
    try {
      const { data: p, error: e0 } = await supabase.from('red_parcele').select(COL_PARCELA).eq('id', parcelaId).single()
      if (e0) throw e0
      // P1-5: fișa aparține proiectului selectat; altfel (proiect schimbat între timp) se închide
      if (p.proiect_id !== proiect?.id) { show('Parcela nu aparține proiectului selectat — fișa s-a închis.', 'error'); onInapoi?.(); return }
      setParcela(p)
      if (esteAdmin) {
        // valoare_lei nu are privilegiu de coloană pentru authenticated: doar prin RPC (admin)
        const { data: v } = await supabase.rpc('fn_red_valoare_parcela', { p_parcela_id: parcelaId })
        setValoare(v ?? null)
      }
      // r4 P2-3: și deținătorii paginat (o parcelă cu mulți moștenitori nu se trunchiază)
      const det = await citestePaginat(() => supabase.from('red_detinatori').select(COL_DETINATOR).eq('parcela_id', parcelaId).order('sters_la', { nullsFirst:true }).order('nume').order('id'))
      setDetinatori(det)
      const ids = det.map(d => d.id)
      // r3 P2-3: toate listele se citesc paginat (range în bucle de 1000, `.in()` în loturi de 100) — fără limite ascunse
      const [conv, rasp, pvParcela, pvDet, cont] = await Promise.all([
        citesteIn(() => supabase.from('red_convocari').select(COL_CONVOCARE).order('created_at').order('id'), 'detinator_id', ids),
        // [r2] ordinea = data desc, seq desc (tie-break); meta (ip/user agent) e tabelă separată, citită mai jos doar de admin/editor
        citesteIn(() => supabase.from('red_raspunsuri').select(COL_RASPUNS).order('data', { ascending:false }).order('seq', { ascending:false }), 'detinator_id', ids),
        citestePaginat(() => supabase.from('red_procese_verbale').select('*').eq('parcela_id', parcelaId).order('created_at').order('id')),
        citesteIn(() => supabase.from('red_procese_verbale').select('*').order('created_at').order('id'), 'detinator_id', ids),
        poateScrie ? citesteIn(() => supabase.from('red_detinatori_contact').select('*').order('detinator_id'), 'detinator_id', ids) : Promise.resolve([]),
      ])
      const pvMap = new Map(); [...pvParcela, ...pvDet].forEach(p => pvMap.set(p.id, p))
      const pv = [...pvMap.values()].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      setConvocari(conv); setRaspunsuri(rasp); setPvs(pv)
      setContacte(Object.fromEntries(cont.map(c => [c.detinator_id, c])))
      if (poateScrie && rasp.length) {
        const m = await citesteIn(() => supabase.from('red_raspunsuri_meta').select(COL_RASPUNS_META).order('raspuns_id'), 'raspuns_id', rasp.map(x => x.id))
        setMetaRaspuns(Object.fromEntries(m.map(x => [x.raspuns_id, x])))
      } else setMetaRaspuns({})
      const toateId = [parcelaId, ...ids, ...conv.map(x => x.id), ...rasp.map(x => x.id), ...pv.map(x => x.id)]
      // P2-5: fără date_vechi/date_noi în listă — se citesc la cerere, per rând, doar de admin (vedeJurnal)
      const j = await citesteIn(() => supabase.from('red_jurnal').select('id, tabela, inregistrare_id, actiune, user_email, created_at').order('created_at').order('id'), 'inregistrare_id', toateId)
      setJurnal(j.sort((a, b) => (new Date(a.created_at) - new Date(b.created_at)) || (a.id - b.id)))
    } catch (e) { show('Fișa parcelei: ' + msgEroare(e), 'error') }
    finally { setLoading(false) }
  }, [parcelaId, proiect?.id, esteAdmin, poateScrie, show, onInapoi])
  useEffect(() => { incarca() }, [incarca])

  const uat = uats.find(u => u.id === parcela?.uat_id)
  const numeDet = useMemo(() => Object.fromEntries(detinatori.map(d => [d.id, d.nume])), [detinatori])

  // Cronologie unită, ordonată după timp
  const cronologie = useMemo(() => {
    const ev = []
    convocari.forEach(c => {
      ev.push({ t: c.created_at, tip:'convocare', text:`Convocator ${c.nr_document} generat (${c.canal})${c.stare === 'anulat' ? ' — ANULAT' : ''}${!c.fisier_convocator_path ? ' — fișier neîncărcat' : ''}`, cine: numeDet[c.detinator_id], path: c.fisier_convocator_path, conv: !c.fisier_convocator_path && c.stare === 'activ' ? c : null })
      if (c.data_expediere) ev.push({ t: c.data_expediere, tip:'convocare', text:`${c.nr_document} expediat${c.nr_tracking ? ' · ' + c.nr_tracking : ''}`, cine: numeDet[c.detinator_id] })
      if (c.data_confirmare_primire) ev.push({ t: c.data_confirmare_primire, tip:'convocare', text:`${c.nr_document} confirmare de primire`, cine: numeDet[c.detinator_id] })
      if (c.retur) ev.push({ t: c.retur_data || c.created_at, tip:'retur', text:`${c.nr_document} retur: ${etichetaRetur(c.retur)}`, cine: numeDet[c.detinator_id] })
    })
    raspunsuri.forEach(r => {
      const m = metaRaspuns[r.id]
      ev.push({ t: r.data || r.created_at, seq: r.seq, tip:'raspuns', text:`Răspuns (${r.canal}): ${etichetaOptiune(r.optiune)}${r.zi_sesiune_aleasa ? ' · ' + fmtDate(r.zi_sesiune_aleasa) : ''}${r.obiectii_text ? ' — „' + r.obiectii_text.slice(0, 160) + (r.obiectii_text.length > 160 ? '…' : '') + '”' : ''}`,
        cine: numeDet[r.detinator_id], meta: m ? [m.ip_sau_sursa, m.user_agent ? String(m.user_agent).slice(0, 60) : null].filter(Boolean).join(' · ') : null })
    })
    pvs.forEach(p => {
      ev.push({ t: p.created_at, tip:'pv', text:`PV ${p.tip} ${p.nr_pv} — ${p.stare}${p.obiectii_redare ? ' · cu obiecții' : ''}`, cine: numeDet[p.detinator_id], path: p.fisier_generat_path })
      if (p.semnat_primit_data) ev.push({ t: p.semnat_primit_data, tip:'pv', text:`PV ${p.nr_pv} semnat${p.semnat_fizic ? ' (fizic)' : ''}`, cine: numeDet[p.detinator_id], path: p.fisier_semnat_path })
    })
    // SMS: din agregate se știu cert doar ultima trimitere și ultima livrare (fără date per mesaj — rezumatul complet e pe rândul deținătorului)
    if (sms.harta) detinatori.forEach(d => intrariCronologie(stareSmsPentru(sms.harta, d.id)).forEach(x => ev.push({ t: x.data, tip:'sms', text: x.eticheta, cine: d.nume })))
    jurnal.forEach(j => ev.push({ t: j.created_at, tip:'jurnal', text:`${j.actiune} ${j.tabela.replace('red_', '')}`, cine: j.user_email || '', jurnal: true, jurnalId: j.id }))
    // cronologic crescător; la aceeași clipă răspunsurile se despart după seq (contract [r2])
    return ev.sort((a, b) => (new Date(a.t) - new Date(b.t)) || ((a.seq ?? 0) - (b.seq ?? 0)))
  }, [convocari, raspunsuri, metaRaspuns, pvs, jurnal, numeDet, sms.harta, detinatori])

  const fisiere = useMemo(() => [
    // P2-8: convocările active fără fișier (upload-ul a picat după inserarea rândului) apar „neîncărcat” + Reîncarcă
    ...convocari.filter(c => c.stare === 'activ').map(c => c.fisier_convocator_path ? { path: c.fisier_convocator_path, eticheta:`Convocator ${c.nr_document}` } : { conv: c, eticheta:`Convocator ${c.nr_document}` }),
    ...pvs.flatMap(p => [p.fisier_generat_path && { path: p.fisier_generat_path, eticheta:`PV ${p.nr_pv} generat` }, p.fisier_semnat_path && { path: p.fisier_semnat_path, eticheta:`PV ${p.nr_pv} semnat` }].filter(Boolean)),
  ], [convocari, pvs])

  // P2-7: link semnat obținut la click, deschis printr-un <a target=_blank rel=noopener> click-uit sincron după await (fără window.open);
  // dacă browserul îl blochează, rămâne butonul „Deschide” cu href-ul primit (valabil 10 min)
  const deschideFisier = async (path) => {
    try {
      const { data, error } = await supabase.storage.from('redari').createSignedUrl(path, 600)
      if (error) throw error
      const a = document.createElement('a')
      a.href = data.signedUrl; a.target = '_blank'; a.rel = 'noopener noreferrer'
      document.body.appendChild(a); a.click(); a.remove()
      setLinkSemnat({ path, url: data.signedUrl, nume: path.split('/').pop() })
    } catch (e) { show('Fișier: ' + msgEroare(e), 'error') }
  }

  const culoareTip = { convocare: G.blue, retur: G.orange, raspuns: G.green, pv: G.purple, sms: G.pink, jurnal: G.dim }
  const [arataJurnal, setArataJurnal] = useState(false)
  const [jurnalDetalii, setJurnalDetalii] = useState(null)   // { id, date_vechi, date_noi } — doar admin, la cerere
  const [reincarcId, setReincarcId] = useState(null)
  const [linkSemnat, setLinkSemnat] = useState(null)   // { path, url, nume } — ultimul link semnat, ca buton „Deschide” (P2-7)
  const dupaModal = () => { setModal(null); incarca(); onSchimbat?.() }

  // P2-5: detaliile unei intrări de jurnal (date_vechi / date_noi) se citesc la cerere, doar de admin
  const vedeJurnal = async (id) => {
    if (!esteAdmin) return
    try {
      const { data, error } = await supabase.from('red_jurnal').select('id, tabela, actiune, user_email, created_at, date_vechi, date_noi').eq('id', id).single()
      if (error) throw error
      setJurnalDetalii(data)
    } catch (e) { show('Jurnal: ' + msgEroare(e), 'error') }
  }

  // P2-8: regenerează documentul unei convocări existente (același nr_document, data originală) și îl încarcă în bucket
  const reincarca = async (c) => {
    if (!poateScrie || !parcela || !uat) return
    setReincarcId(c.id)
    try {
      const det = detinatori.find(d => d.id === c.detinator_id)
      if (!det) throw new Error('Deținătorul convocării nu mai e pe parcelă.')
      const [token, rs] = await Promise.all([citesteTokenRaspuns(c.detinator_id), fetch(SABLON_CONVOCATOR)])
      if (!rs.ok) throw new Error(`Șablonul convocatorului lipsește (${rs.status}).`)
      const templateArrayBuffer = await rs.arrayBuffer()
      // fișierele din bucket sunt imutabile: reincarcaConvocator scrie o cale nouă versionată ({nr_document}-v{n}.docx) și mută *_path
      const { blob, hash } = await genereazaConvocator({ detinator: det, contactDetinator: contacte[c.detinator_id] || null, contact: null, parcela, uat, proiect, nrDocument: c.nr_document, token, templateArrayBuffer, dataDocument: dataDocumentConvocare(c) })
      const { path } = await reincarcaConvocator(supabase, { convocareId: c.id, blob, hash, proiectCod: proiect.cod, uat3: uat.uat3, idParcela: parcela.id_parcela, nrDocument: c.nr_document })
      show(`Convocatorul ${c.nr_document} a fost reîncărcat (${path}).`, 'success')
      incarca()
    } catch (e) { show('Reîncărcare: ' + msgEroare(e), 'error') }
    finally { setReincarcId(null) }
  }

  if (loading && !parcela) return <Gol text="Se încarcă fișa…" />
  if (!parcela) return <Gol text="Parcela nu a fost găsită." />

  return (
    <div>
 
      {modal?.tip === 'pv' && <ModalPv key={parcelaId + ':' + (modal.det?.id || 'B') + ':' + proiect.id} parcelaId={parcelaId} detinatorId={modal.det?.id} tip={modal.det?'A':'B'} proiectId={proiect.id} nivel={nivel} show={show} onClose={() => setModal(null)} onGata={() => { incarca(); onSchimbat?.() }} />}
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12, flexWrap:'wrap' }}>
        <button style={S.btnS} onClick={onInapoi}>‹ Registru</button>
        <div style={{ fontSize:17, fontWeight:700, ...S.mono }}>{parcela.id_parcela}</div>
        <span style={{ color:G.muted, fontSize:13 }}>{uat ? `${uat.nume} (${uat.uat3})` : ''} · tronson {parcela.tronson ?? '-'}</span>
        {esteAdmin && !parcela.sters_la && <label>Tronson <select aria-label="Tronson parcela" style={S.select} disabled={tronsonLucru||parcela.id!==parcelaId||parcela.proiect_id!==proiect.id} value={parcela.tronson??''} onChange={e=>schimbaTronson(e.target.value)}>
          <option value="">-</option>{Array.from({length:11},(_,i)=><option key={i+1} value={i+1}>T{i+1}</option>)}
        </select></label>}
        {parcela.sters_la && <span style={{ ...S.tag, background:G.redDim, color:G.red }}>ȘTEARSĂ · {parcela.sters_motiv}</span>}
        <div style={{ flex:1 }} />
        {/* audit D14: PV B stă în bara fișei, nu deasupra ei */}
        {(poateScrie || pvs.some(p => p.tip === 'B' && p.stare !== 'anulat' && !p.sters_la)) && <button style={S.btnP} onClick={() => setModal({tip:'pv'})}>PV B (parcelă)</button>}
        {poateScrie && !parcela.sters_la && <button style={S.btnS} onClick={() => setModal({ tip:'parcela' })}>✎ Editează parcela</button>}
        {poateScrie && !parcela.sters_la && <button style={S.btnD} onClick={() => setModal({ tip:'sterge', tabela:'red_parcele', id: parcela.id, ce:`parcela ${parcela.id_parcela}` })}>Șterge</button>}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(320px, 1fr))', gap:12 }}>
        {/* Date parcelă */}
        <div style={S.card}>
          <div style={{ fontWeight:700, marginBottom:8 }}>Parcelă</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px 12px', fontSize:13 }}>
            {CAMPURI_PARCELA.map(([k, et, tip]) => <React.Fragment key={k}><span style={{ color:G.muted }}>{et}</span><span>{tip === 'number' ? fmtNum(parcela[k]) : (parcela[k] || '-')}</span></React.Fragment>)}
            {esteAdmin && <><span style={{ color:G.muted }}>Valoare (lei)</span><span>{fmtNum(valoare)}</span></>}
            <span style={{ color:G.muted }}>Observații</span><span>{parcela.observatii || '-'}</span>
            <span style={{ color:G.muted }}>Creată</span><span>{fmtDateTime(parcela.created_at)}</span>
          </div>
        </div>

        {/* Deținători */}
        <div style={S.card}>
          <div style={{ display:'flex', alignItems:'center', marginBottom:8 }}>
            <div style={{ fontWeight:700 }}>Deținători ({detinatori.filter(d => !d.sters_la).length})</div>
            <div style={{ flex:1 }} />
            {poateScrie && !parcela.sters_la && <button style={S.btnX} onClick={() => setModal({ tip:'detinator', det: null })}>＋ Adaugă</button>}
          </div>
          {detinatori.length === 0 && <Gol text="Niciun deținător." />}
          {detinatori.map(d => {
            const c = contacte[d.id]
            return (
              <div key={d.id} style={{ padding:'8px 0', borderTop:`1px solid ${G.border}`, opacity: d.sters_la ? 0.5 : 1 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                  <b>{d.nume}</b>{d.decedat && <span title="decedat" style={{ color:G.muted }}>†</span>}
                  <span style={{ ...S.tag, background:G.blueDim, color:G.blue }}>{d.calitate}</span>
                  {d.cota && <span style={{ color:G.muted, fontSize:12 }}>cota {d.cota}</span>}
                  {d.sters_la && <span style={{ ...S.tag, background:G.redDim, color:G.red }}>șters · {d.sters_motiv}</span>}
                  <div style={{ flex:1 }} />
                  {!d.sters_la && !parcela.sters_la && (poateScrie || pvs.some(p => p.tip === 'A' && p.detinator_id === d.id && p.stare !== 'anulat' && !p.sters_la)) && <button style={S.btnX} onClick={() => setModal({ tip:'pv', det: d })}>PV A</button>}
                  {poateScrie && !d.sters_la && <button style={S.btnX} onClick={() => setModal({ tip:'detinator', det: d, contact: c })}>✎</button>}
                  {poateScrie && !d.sters_la && <button style={{ ...S.btnX, color:G.red }} onClick={() => setModal({ tip:'sterge', tabela:'red_detinatori', id: d.id, ce:`deținătorul ${d.nume}` })}>Șterge</button>}
                </div>
                <div style={{ fontSize:12, color:G.muted, marginTop:3 }}>
                  {d.sursa_date && <span>sursă: {d.sursa_date} · </span>}{d.versiune_lista_tgz && <span>listă: {d.versiune_lista_tgz}</span>}
                </div>
                <AvertismentConstatare uat={uat} detinator={d} raspunsuri={raspunsuri} pvs={pvs} azi={dataBucuresti()} />
                <RandSms sms={sms} detinatorId={d.id} />
                {poateScrie && (
                  <div style={{ fontSize:12.5, marginTop:4 }}>
                    {c ? (<>
                      <span style={{ color: c.adresa_cunoscuta === false ? G.yellow : G.text }}>{c.adresa_cunoscuta === false ? 'Adresă necunoscută' : [c.adresa_strada, c.adresa_sat, c.adresa_comuna, c.adresa_judet, c.cod_postal].filter(Boolean).join(', ') || '(fără adresă)'}</span>
                      {(c.telefon || c.email) && <span style={{ color:G.muted }}> · {[c.telefon, c.email].filter(Boolean).join(' · ')}</span>}
                    </>) : <span style={{ color:G.dim }}>fără date de contact</span>}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Fișiere */}
        <div style={S.card}>
          <div style={{ fontWeight:700, marginBottom:8 }}>Fișiere ({fisiere.length})</div>
          {linkSemnat && (
            <div style={{ ...S.card, padding:'6px 10px', marginBottom:8, fontSize:12.5, display:'flex', gap:8, alignItems:'center' }}>
              <span style={{ color:G.muted, flex:1 }}>Dacă nu s-a deschis: </span>
              <a href={linkSemnat.url} target="_blank" rel="noopener noreferrer" style={{ ...S.btnX, color:G.blue, textDecoration:'none' }}>Deschide {linkSemnat.nume}</a>
              <button style={{ ...S.btnX, border:'none' }} onClick={() => setLinkSemnat(null)} title="Ascunde">✕</button>
            </div>
          )}
          {fisiere.length === 0 ? <Gol text="Niciun fișier." /> : fisiere.map((f, i) => (
            <div key={i} style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 0', borderTop:`1px solid ${G.border}`, fontSize:13 }}>
              <span style={{ flex:1 }}>{f.eticheta}</span>
              {f.path ? (<>
                <span style={{ ...S.mono, color:G.dim, fontSize:11 }}>{f.path.split('/').pop()}</span>
                <button style={S.btnX} onClick={() => deschideFisier(f.path)} disabled={!poateScrie} title={poateScrie ? 'Deschide (link semnat 10 min)' : 'Doar admin/editor pot deschide fișierele'}>⬇</button>
              </>) : (<>
                <span style={{ ...S.tag, background:G.yellowDim, color:G.yellow }}>neîncărcat</span>
                {poateScrie && <button style={S.btnX} onClick={() => reincarca(f.conv)} disabled={reincarcId === f.conv.id} title="Regenerează documentul și încarcă-l în arhivă">{reincarcId === f.conv.id ? '…' : '↻ Reîncarcă'}</button>}
              </>)}
            </div>
          ))}
        </div>
      </div>

      {/* Cronologie */}
      <div style={{ ...S.card, marginTop:12 }}>
        <div style={{ display:'flex', alignItems:'center', marginBottom:8 }}>
          <div style={{ fontWeight:700 }}>Cronologie</div>
          <div style={{ flex:1 }} />
          <label style={{ fontSize:12.5, color:G.muted, display:'flex', gap:6, alignItems:'center', cursor:'pointer' }}><input type="checkbox" checked={arataJurnal} onChange={e => setArataJurnal(e.target.checked)} /> arată și jurnalul tehnic ({jurnal.length})</label>
        </div>
        {cronologie.filter(e => arataJurnal || !e.jurnal).length === 0 ? <Gol text="Niciun eveniment încă." /> : (
          <div>
            {cronologie.filter(e => arataJurnal || !e.jurnal).map((e, i) => (
              <div key={i} style={{ display:'flex', gap:10, padding:'5px 0', borderTop:`1px solid ${G.border}`, fontSize:13, alignItems:'baseline' }}>
                <span style={{ color:G.muted, whiteSpace:'nowrap', fontSize:12, minWidth:120 }}>{fmtDateTime(e.t)}</span>
                <span style={{ width:8, height:8, borderRadius:'50%', background: culoareTip[e.tip] || G.muted, flexShrink:0, alignSelf:'center' }} />
                <span style={{ flex:1, color: e.jurnal ? G.muted : G.text }}>{e.text}</span>
                {e.cine && <span style={{ color:G.dim, fontSize:12 }}>{e.cine}</span>}
                {e.meta && <span style={{ color:G.dim, fontSize:11 }} title="sursă tehnică (red_raspunsuri_meta, doar admin/editor)">⌁ {e.meta}</span>}
                {e.path && poateScrie && <button style={S.btnX} onClick={() => deschideFisier(e.path)}>⬇</button>}
                {e.conv && poateScrie && <button style={S.btnX} onClick={() => reincarca(e.conv)} disabled={reincarcId === e.conv.id}>{reincarcId === e.conv.id ? '…' : '↻ Reîncarcă'}</button>}
                {e.jurnal && esteAdmin && <button style={S.btnX} onClick={() => vedeJurnal(e.jurnalId)} title="Detalii (date vechi / noi)">{'{ }'}</button>}
              </div>
            ))}
          </div>
        )}
      </div>

      {modal?.tip === 'parcela' && <ModalParcela parcela={parcela} valoare={valoare} esteAdmin={esteAdmin} show={show} onClose={() => setModal(null)} onGata={dupaModal} />}
      {modal?.tip === 'detinator' && <ModalDetinator parcela={parcela} det={modal.det} contact={modal.contact} show={show} onClose={() => setModal(null)} onGata={dupaModal} />}
      {modal?.tip === 'sterge' && <ModalSterge tabela={modal.tabela} id={modal.id} ce={modal.ce} profile={profile} show={show} onClose={() => setModal(null)} onGata={() => { dupaModal(); if (modal.tabela === 'red_parcele') onInapoi() }} />}
      {jurnalDetalii && (
        <Modal titlu={`Jurnal #${jurnalDetalii.id} — ${jurnalDetalii.actiune} ${String(jurnalDetalii.tabela || '').replace('red_', '')}`} onClose={() => setJurnalDetalii(null)} latime={720}>
          <div style={{ fontSize:12.5, color:G.muted, marginBottom:8 }}>{fmtDateTime(jurnalDetalii.created_at)} · {jurnalDetalii.user_email || '-'}</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            {[['Date vechi', jurnalDetalii.date_vechi], ['Date noi', jurnalDetalii.date_noi]].map(([et, v]) => (
              <div key={et}><label style={S.label}>{et}</label><pre style={{ ...S.mono, fontSize:11.5, background:G.bg, border:`1px solid ${G.border}`, borderRadius:7, padding:10, maxHeight:360, overflow:'auto', margin:0, whiteSpace:'pre-wrap' }}>{v ? JSON.stringify(v, null, 2) : '—'}</pre></div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─── Editare parcelă ────────────────────────────────────────────────────────
function ModalParcela({ parcela, valoare, esteAdmin, show, onClose, onGata }) {
  const [f, setF] = useState(() => ({ ...Object.fromEntries(CAMPURI_PARCELA.map(([k]) => [k, parcela[k] ?? ''])), observatii: parcela.observatii || '', valoare_lei: valoare ?? '' }))
  const [lucru, setLucru] = useState(false)
  const set = (k) => (e) => setF(x => ({ ...x, [k]: e.target.value }))
  const salveaza = async () => {
    setLucru(true)
    try {
      const upd = {}
      CAMPURI_PARCELA.forEach(([k, , tip]) => { upd[k] = tip === 'number' ? nrSauNull(f[k]) : (String(f[k]).trim() || null) })
      upd.observatii = f.observatii.trim() || null
      const valoareNoua = esteAdmin ? nrSauNull(f.valoare_lei) : undefined
      const { error } = await supabase.from('red_parcele').update(upd).eq('id', parcela.id)
      if (error) throw error
      if (esteAdmin && valoareNoua !== (valoare ?? null)) {
        const { error: eV } = await supabase.rpc('fn_red_valoare_parcela_seteaza', { p_parcela_id: parcela.id, p_valoare: valoareNoua })
        if (eV) throw eV
      }
      show('Parcela a fost salvată.', 'success'); onGata()
    } catch (e) { show('Parcelă: ' + msgEroare(e), 'error') }
    finally { setLucru(false) }
  }
  return (
    <Modal titlu={`Editează parcela ${parcela.id_parcela}`} onClose={onClose} latime={640}>
      {/* [r2] proiect_id / uat_id / id_parcela sunt imutabile după insert (trigger fn_red_legaturi): nu se oferă aici; corecția = ștergere (soft) + rând nou */}
      <div style={{ fontSize:12, color:G.muted, marginBottom:8 }}>UAT-ul și id-ul parcelei nu se pot schimba. Dacă parcela e în UAT-ul greșit: „Șterge” (cu motiv) și adaugă-o din nou prin import.</div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
        {CAMPURI_PARCELA.map(([k, et, tip]) => <Camp key={k} eticheta={et}><input type={tip === 'number' ? 'number' : 'text'} step="any" value={f[k]} onChange={set(k)} style={S.input} /></Camp>)}
        {esteAdmin && <Camp eticheta="Valoare (lei) — doar admin"><input type="number" step="any" value={f.valoare_lei} onChange={set('valoare_lei')} style={S.input} /></Camp>}
        <Camp eticheta="Observații" span={2}><textarea rows={3} value={f.observatii} onChange={set('observatii')} style={{ ...S.input, resize:'vertical' }} /></Camp>
      </div>
      <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:14 }}>
        <button style={S.btnS} onClick={onClose} disabled={lucru}>Renunță</button>
        <button style={S.btnP} onClick={salveaza} disabled={lucru}>Salvează</button>
      </div>
    </Modal>
  )
}

// ─── Adaugă / editează deținător + contact ──────────────────────────────────
function ModalDetinator({ parcela, det, contact, show, onClose, onGata }) {
  const [f, setF] = useState(() => ({
    nume: det?.nume || '', calitate: det?.calitate || 'proprietar', cota: det?.cota || '', decedat: !!det?.decedat, sursa_date: det?.sursa_date || '', versiune_lista_tgz: det?.versiune_lista_tgz || '',
    adresa_cunoscuta: contact ? contact.adresa_cunoscuta !== false : true,
    ...Object.fromEntries(CAMPURI_CONTACT.map(([k]) => [k, contact?.[k] || ''])),
  }))
  const [lucru, setLucru] = useState(false)
  const [detIdCreat, setDetIdCreat] = useState(null)   // P2-5: deținătorul s-a creat, dar contactul a picat → „Salvează” reia DOAR contactul
  const set = (k) => (e) => setF(x => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const salveaza = async () => {
    const nume = f.nume.trim()
    if (!nume) { show('Numele e obligatoriu.', 'error'); return }
    setLucru(true)
    try {
      let detId = det?.id || detIdCreat
      if (!detIdCreat) {
        const randDet = { nume, nume_normalizat: normalizeazaNume(nume), calitate: f.calitate, cota: f.cota.trim() || null, decedat: f.decedat, sursa_date: f.sursa_date.trim() || null, versiune_lista_tgz: f.versiune_lista_tgz.trim() || null }
        if (detId) {
          const { error } = await supabase.from('red_detinatori').update({ ...randDet, updated_at: new Date().toISOString() }).eq('id', detId)
          if (error) throw error
        } else {
          const { data, error } = await supabase.from('red_detinatori').insert({ ...randDet, parcela_id: parcela.id }).select('id').single()
          if (error) throw error
          detId = data.id
        }
      }
      const randContact = { detinator_id: detId, adresa_cunoscuta: f.adresa_cunoscuta, updated_at: new Date().toISOString() }
      CAMPURI_CONTACT.forEach(([k]) => { randContact[k] = String(f[k]).trim() || null })
      const { error: ec } = await supabase.from('red_detinatori_contact').upsert(randContact, { onConflict:'detinator_id' })
      if (ec) {
        if (!det) setDetIdCreat(detId)   // rândul de deținător există deja: la următorul „Salvează” nu se mai creează altul
        show('Deținătorul s-a salvat, dar contactul nu: ' + msgEroare(ec) + '. Corectează și apasă din nou „Salvează” — se reia doar contactul.', 'error')
        return
      }
      show(det ? 'Deținătorul a fost salvat.' : 'Deținătorul a fost adăugat.', 'success'); onGata()
    } catch (e) { show('Deținător: ' + msgEroare(e), 'error') }
    finally { setLucru(false) }
  }
  return (
    <Modal titlu={det ? `Editează deținătorul` : `Adaugă deținător — ${parcela.id_parcela}`} onClose={onClose} latime={680}>
      {/* [r2] parcela_id e imutabil după insert: deținătorul nu se „mută” pe altă parcelă; corecția = ștergere (soft) + rând nou pe parcela corectă */}
      {det && <div style={{ fontSize:12, color:G.muted, marginBottom:8 }}>Deținătorul rămâne pe parcela {parcela.id_parcela}. Dacă e pe parcela greșită: „Șterge” (cu motiv) și adaugă-l pe parcela corectă.</div>}
      {detIdCreat && <div style={{ ...S.card, borderColor:G.yellow, color:G.yellow, fontSize:12.5, marginBottom:8 }}>Deținătorul e creat; a rămas de salvat contactul. „Salvează” scrie doar contactul (datele persoanei nu se mai modifică aici).</div>}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
        <Camp eticheta="Nume (NUME Prenume)" span={2}><input value={f.nume} onChange={set('nume')} style={S.input} /></Camp>
        <Camp eticheta="Calitate"><select value={f.calitate} onChange={set('calitate')} style={{ ...S.select, width:'100%' }}>{CALITATI.map(c => <option key={c} value={c}>{c}</option>)}</select></Camp>
        <Camp eticheta="Cotă"><input value={f.cota} onChange={set('cota')} style={S.input} placeholder="ex. 1/2" /></Camp>
        <Camp eticheta="Sursa datelor"><input value={f.sursa_date} onChange={set('sursa_date')} style={S.input} placeholder="ex. TGZ zz.ll.aaaa" /></Camp>
        <Camp eticheta="Versiune listă TGZ"><input value={f.versiune_lista_tgz} onChange={set('versiune_lista_tgz')} style={S.input} /></Camp>
        <Camp eticheta=" "><label style={{ fontSize:13, display:'flex', gap:6, alignItems:'center', cursor:'pointer' }}><input type="checkbox" checked={f.decedat} onChange={set('decedat')} /> decedat</label></Camp>
        <Camp eticheta=" "><label style={{ fontSize:13, display:'flex', gap:6, alignItems:'center', cursor:'pointer' }}><input type="checkbox" checked={f.adresa_cunoscuta} onChange={set('adresa_cunoscuta')} /> adresă cunoscută</label></Camp>
        <div style={{ gridColumn:'span 2', borderTop:`1px solid ${G.border}`, paddingTop:8, fontSize:12, color:G.muted }}>Contact (PII — vizibil doar admin/editor)</div>
        {CAMPURI_CONTACT.map(([k, et]) => <Camp key={k} eticheta={et}><input value={f[k]} onChange={set(k)} style={S.input} /></Camp>)}
      </div>
      <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:14 }}>
        <button style={S.btnS} onClick={onClose} disabled={lucru}>Renunță</button>
        <button style={S.btnP} onClick={salveaza} disabled={lucru}>Salvează</button>
      </div>
    </Modal>
  )
}

// ─── Soft delete cu motiv obligatoriu (fără DELETE fizic — contract §2) ──────
function ModalSterge({ tabela, id, ce, profile, show, onClose, onGata }) {
  const [motiv, setMotiv] = useState('')
  const [lucru, setLucru] = useState(false)
  const sterge = async () => {
    if (motiv.trim().length < 5) { show('Motivul ștergerii e obligatoriu (minim 5 caractere).', 'error'); return }
    setLucru(true)
    try {
      const { error } = await supabase.from(tabela).update({ sters_la: new Date().toISOString(), sters_de: profile?.id || null, sters_motiv: motiv.trim() }).eq('id', id)
      if (error) throw error
      show(`Marcat ca șters: ${ce}.`, 'success'); onGata()
    } catch (e) { show('Ștergere: ' + msgEroare(e), 'error') }
    finally { setLucru(false) }
  }
  return (
    <Modal titlu={`Șterge ${ce}`} onClose={onClose}>
      <div style={{ fontSize:13, color:G.muted, marginBottom:10 }}>Înregistrarea nu se șterge fizic: rămâne în registru marcată ca ștearsă, cu motivul și autorul. Operația e reversibilă doar de administrator în BD.</div>
      <Camp eticheta="Motiv (obligatoriu)"><textarea rows={3} value={motiv} onChange={e => setMotiv(e.target.value)} style={{ ...S.input, resize:'vertical' }} autoFocus /></Camp>
      <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:14 }}>
        <button style={S.btnS} onClick={onClose} disabled={lucru}>Renunță</button>
        <button style={S.btnD} onClick={sterge} disabled={lucru}>Marchează șters</button>
      </div>
    </Modal>
  )
}
