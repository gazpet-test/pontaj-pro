import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { descarcaBlob } from '../docx.js'
import { sesiuneEcran } from '../corespondenta.js'
import { propune, aplica } from '../importPostal.js'
import { grupeazaPentruPlicuri, textAR, genereazaOpis, genereazaPvPlicuire, csvEtichete, dataBucuresti, adresaPlic, areImputernicire,
  termenExpediere, textTermenExpediere, avertismentExpediere, confirmaExpediereRecitita } from '../plicuri.js'
import { TERMEN_CONVOCARE_ZILE } from '../setari.js'
import { G, S, Camp, Gol, Modal, MOTIVE_RETUR, msgEroare, fmtDate, citestePaginat } from './comune.jsx'
import { CALITATI_AR, descriereArPlic } from '../arMentiune.js'

const COL_PLIC = 'id,proiect_id,uat_id,nr_plic,destinatar_nume,lot_id,awb,data_expediere,data_ar,ar_scan_path,ar_primit_de,ar_primit_calitate,ar_mentiune,opis_path,retur,retur_detaliu,retur_data,retur_scan_path,stare,motiv_anulare,versiune'
const COL_LOT = 'id,proiect_id,nr_lot,data_plicuire,semnatar1_id,semnatar2_id,pv_path,observatii,versiune'
const starea = p => p.stare === 'anulat' ? 'anulat' : p.data_ar ? 'AR' : p.retur ? 'retur' : p.data_expediere ? 'expediat' : p.lot_id ? 'in_lot' : 'fara_lot'
// Jakarinos + Copilot f10 UI P2: 55P03 (operație concurentă, din protocolul pe UAT) are mesajul lui, separat de rezultatul neconfirmat (rețea)
const eroareScriere = e => e?.code === '42501' ? 'Accesul de scriere a fost refuzat.' : e?.code === '55P03' ? `Operație concurentă: ${msgEroare(e)} Reîncarcă datele și reîncearcă.`
  : e?.code === 'P0001' || e?.code === '23514' || e?.code === '22023' || e?.code === '0A000' ? msgEroare(e) : 'Rezultat neconfirmat. Reîncarcă și verifică starea înainte de reluare.'

export async function citesteDatePlicuri(client, proiectId, poateScrie, esteCurent) {
  const pagini = (t, c, filtru = q => q, cheie = 'id') => citestePaginat(() => filtru(client.from(t).select(c)), { cheie, esteCurent })
  const inLoturi = async (ids, t, c, coloana, filtru = q => q, cheie = 'id') => {
    const tot = [], unice = [...new Set(ids)]
    for (let i = 0; i < unice.length; i += 100) {
      if (!esteCurent()) throw new Error('Citire abandonată.')
      tot.push(...await pagini(t, c, q => filtru(q.in(coloana, unice.slice(i, i + 100))), cheie))
    }
    return tot
  }
  const [plicuri, loturi, parcele, acces, owneri] = await Promise.all([
    pagini('red_plicuri', COL_PLIC, q => q.eq('proiect_id', proiectId)),
    pagini('red_loturi_plicuire', COL_LOT, q => q.eq('proiect_id', proiectId)),
    pagini('red_parcele', 'id,uat_id,id_parcela,tarla,nr_cadastral,poz_hg', q => q.eq('proiect_id', proiectId).is('sters_la', null)),
    pagini('user_module_access', 'id,profile_id', q => q.eq('module', 'redari')),
    pagini('profiles', 'id,name', q => q.eq('is_owner', true)),
  ])
  // juridic#021 pct. 4: semnatarii PV de plicuire se aleg din utilizatorii cu drept pe Redări (owner sau acces explicit); BD-ul verifică la fel
  const idsAcces = [...new Set(acces.map(a => a.profile_id))]
  const cuAcces = idsAcces.length ? await inLoturi(idsAcces, 'profiles', 'id,name', 'id') : []
  const utilizatori = [...new Map([...owneri, ...cuAcces].map(p => [p.id, { id: p.id, name: p.name || '(fără nume)' }])).values()].sort((a, b) => a.name.localeCompare(b.name, 'ro'))
  const det = await inLoturi(parcele.map(p => p.id), 'red_detinatori', 'id,parcela_id,nume,nume_normalizat', 'parcela_id', q => q.is('sters_la', null))
  const [conv, contacte] = await Promise.all([
    inLoturi(det.map(d => d.id), 'red_convocari', 'id,detinator_id,nr_document,plic_id,data_expediere', 'detinator_id', q => q.eq('stare', 'activ').eq('canal', 'posta').is('sters_la', null)),
    poateScrie ? inLoturi(det.map(d => d.id), 'red_detinatori_contact', 'detinator_id,adresa_strada,adresa_sat,adresa_comuna,adresa_judet,cod_postal,adresa_cunoscuta', 'detinator_id', q => q, 'detinator_id') : Promise.resolve([]),
  ])
  const ps = new Map(parcele.map(p => [p.id, p])), ds = new Map(det.map(d => [d.id, d])), cs = new Map(contacte.map(c => [c.detinator_id, c]))
  const randuri = conv.map(c => {
    const d = ds.get(c.detinator_id), p = ps.get(d.parcela_id), a = cs.get(d.id)
    return { ...p, ...c, conv_id: c.id, detinator_nume: d.nume, nume_normalizat: d.nume_normalizat,
      adresa: { strada: a?.adresa_strada, sat: a?.adresa_sat, comuna: a?.adresa_comuna, judet: a?.adresa_judet, cod_postal: a?.cod_postal, cunoscuta: a?.adresa_cunoscuta === true } }
  })
  return { plicuri, loturi, randuri, utilizatori }
}

// Fiecare UPDATE verifică snapshot-ul complet al deciziei și RETURNING. Fișierele nu se șterg la rezultat ambiguu.
async function actualizeaza(tabel, rand, patch, esteCurent) {
  if (!esteCurent()) throw new Error('Operație abandonată.')
  let q = supabase.from(tabel).update(patch).eq('id', rand.id).eq('proiect_id', rand.proiect_id).eq('versiune', rand.versiune)
  const campuri = tabel === 'red_plicuri' ? ['stare', 'lot_id', 'opis_path', 'awb', 'data_expediere', 'data_ar', 'ar_scan_path', 'retur', 'retur_data', 'retur_scan_path'] : ['pv_path', 'semnatar1_id', 'semnatar2_id']   // Gemini f10 r1 P3
  for (const k of campuri) q = rand[k] == null ? q.is(k, null) : q.eq(k, rand[k])
  const { data, error } = await q.select('id')
  if (error) throw error
  if (!Array.isArray(data)) throw new Error('Scriere neconfirmată.')
  if (data.length !== 1) throw { code: '23514', message: 'Conflict: rând modificat sau inaccesibil. Reîncarcă datele.' }
}

function verificaFisier(f) {
  const extensii = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' }
  const ext = extensii[f?.type]
  if (!ext || !f.size || f.size > 15 * 1024 * 1024) throw { code: '23514', message: 'Alege un singur PDF, JPG sau PNG, maximum 15 MB. Pentru față-verso folosește un PDF.' }
  return ext
}
const stampila = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date()).replace(/\D/g, '')

export default function PlicuriEcran({ proiect, uats = [], nivel, reloadKey = 0, onSchimbat }) {
  const [date, setDate] = useState(null), [reload, setReload] = useState(0), [lucru, setLucru] = useState(false)
  const [mesaj, setMesaj] = useState(''), [incarcare, setIncarcare] = useState(true), [selectate, setSelectate] = useState([]), [uatId, setUatId] = useState(''), [filtru, setFiltru] = useState('')
  const [modal, setModal] = useState(null), [f, setF] = useState({}), [arText, setArText] = useState('')
  const sesiune = useRef(sesiuneEcran()), ocupat = useRef(false), identitate = useRef(`${proiect.id}/${nivel}`)
  const cheie = `${proiect.id}/${nivel}`
  if (identitate.current !== cheie) { identitate.current = cheie; sesiune.current.noua() }
  const poateScrie = ['admin', 'editor'].includes(nivel)
  const captureaza = () => { const expirat = sesiune.current.captureaza(), id = cheie; return () => !expirat() && identitate.current === id }
  useEffect(() => {
    sesiune.current.noua(); ocupat.current = false; setLucru(false); setDate(null); setModal(null); setSelectate([]); setMesaj(''); setArText(''); setUatId(''); setFiltru('')
    return () => { sesiune.current.noua() }
  }, [cheie])
  useEffect(() => {
    const curent = captureaza(); let abandonat = false
    const valid = () => curent() && !abandonat
    setDate(null); setIncarcare(true)
    citesteDatePlicuri(supabase, proiect.id, poateScrie, valid).then(r => { if (valid()) { setDate({ ...r, cheie }); setSelectate([]) } })
      .catch(() => { if (valid()) setMesaj(m => [m, 'Citirea completă a plicurilor a eșuat. Reîncarcă datele.'].filter(Boolean).join(' ')) })
      .finally(() => { if (valid()) setIncarcare(false) })
    return () => { abandonat = true }
  }, [cheie, reload, reloadKey])
  const randuri = (date?.cheie === cheie ? date.randuri : []).map(r => ({ ...r, uat3: uats.find(u => u.id === r.uat_id)?.uat3, uat_nume: uats.find(u => u.id === r.uat_id)?.nume }))
  const plicuri = (date?.cheie === cheie ? date.plicuri : []).map(p => ({ ...p, uat_nume: uats.find(u => u.id === p.uat_id)?.nume, proiect }))
  const utilizatori = date?.cheie === cheie ? (date.utilizatori || []) : []
  const numeUtil = id => utilizatori.find(u => u.id === id)?.name || ''
  const loturi = (date?.cheie === cheie ? date.loturi : []).map(l => ({ ...l, semnatar1_nume: numeUtil(l.semnatar1_id), semnatar2_nume: numeUtil(l.semnatar2_id) }))
  const imputernicire = areImputernicire(proiect)
  const pePlic = randuri.reduce((a, r) => { if (r.plic_id) (a[r.plic_id] ||= []).push(r); return a }, {})
  const grupare = grupeazaPentruPlicuri(randuri.filter(r => !r.plic_id && !r.data_expediere))
  // plan pct. 4.2: termenul de expediere pe UAT (ziua 1 − 10 zile), pentru UAT-urile care au de expediat (plicuri propuse sau neexpediate)
  const uatDe = id => uats.find(u => u.id === id)
  const azi = dataBucuresti()
  const uatDeExpediat = [...new Set([...grupare.grupuri.map(g => g.uat_id), ...plicuri.filter(p => p.stare === 'activ' && !p.data_expediere).map(p => p.uat_id)])]
    .map(uatDe).filter(Boolean).sort((a, b) => String(a.nume).localeCompare(String(b.nume), 'ro'))
  async function executa(fn, scriere = false) {
    if (ocupat.current || incarcare || (scriere && (!poateScrie || !date))) return
    ocupat.current = true; setLucru(true); setMesaj('')
    const curent = captureaza()
    try { const m = await fn(curent); if (curent()) setMesaj(m || 'Operație încheiată.') }
    catch (e) { if (curent()) setMesaj(eroareScriere(e)) }
    finally { if (curent()) { ocupat.current = false; setLucru(false); if (scriere) { setReload(n => n + 1); onSchimbat?.() } } }
  }
  function deschide(tip, rand) { setModal({ tip, rand }); setF({ data: dataBucuresti(), awb: '', motiv: MOTIVE_RETUR[0].cod, detaliu: '', semnatar1_id: rand?.semnatar1_id || '', semnatar2_id: rand?.semnatar2_id || '', observatii: rand?.observatii || '', primit_de: 'destinatar', calitate: '', mentiune: '' }) }
  const camp = (k, v) => setF(x => ({ ...x, [k]: v }))
  // coloana „AWB / expediat”: neexpediat → data-limită; expediat după limită → semnalat (plan pct. 4.2)
  const textExpediat = p => {
    const baza = `${p.awb || '-'} / ${fmtDate(p.data_expediere)}`
    if (p.data_expediere) return termenExpediere(uatDe(p.uat_id), p.data_expediere).depasit ? `${baza} ⚠ după termen` : baza
    return p.stare === 'activ' ? `${baza} · ${textTermenExpediere(uatDe(p.uat_id))}` : baza
  }
  const btn = (titlu, fn, disabled = false) => <button style={S.btnX} disabled={lucru || incarcare || disabled} onClick={fn}>{titlu}</button>
  async function creeaza(curent) {
    let create = 0, consecutive = 0, procesate = 0; const erori = []
    for (const g of grupare.grupuri) {
      if (!curent() || consecutive >= 5) break
      procesate++
      try {
        const { data, error } = await supabase.rpc('fn_red_plic_creeaza', { p_proiect_id: proiect.id, p_convocari: g.convocari.map(c => c.conv_id) })
        if (!curent()) return
        if (error) throw error
        if (!(Array.isArray(data) ? data[0]?.id : data?.id)) throw new Error('Rezultat necunoscut.')
        create++; consecutive = 0
      } catch (e) { if (!curent()) return; erori.push(`${g.destinatar}: ${eroareScriere(e)}`); consecutive++ }
    }
    return `Create: ${create}; erori: ${erori.length}; neprocesate: ${grupare.grupuri.length - procesate}. ${erori.join('; ')}`
  }
  async function document(tip, rand, curent) {
    const lista = plicuri.filter(p => p.lot_id === rand.id)
    if (tip === 'csv' && !imputernicire) throw { code: '23514', message: 'Fără împuternicirea Beneficiarului nu se generează textele AR (etichete).' }
    // Jakarinos + Copilot f10 UI P2: opisul atașat la dosar se descarcă EXACT cum e arhivat (fără regenerare), ca exemplarul din plic să fie identic
    if (tip === 'opis' && rand.opis_path) {
      const { data: arhivat, error } = await supabase.storage.from('redari').download(rand.opis_path)
      if (error || !arhivat) throw { code: 'P0001', message: 'Exemplarul de la dosar nu poate fi citit; nu se regenerează un opis diferit. Reîncearcă sau verifică în Storage.' }   // Copilot r2 P3-01: mesaj vizibil
      if (curent()) descarcaBlob(arhivat, `${rand.nr_plic}-opis.docx`)
      return 'Opis descărcat (exemplarul arhivat la dosar).'
    }
    const blob = tip === 'opis' ? await genereazaOpis(rand, pePlic[rand.id] || [], { proiect, uat: uats.find(u => u.id === rand.uat_id) })
      : tip === 'pv' ? await genereazaPvPlicuire(rand, lista, pePlic, { proiect }) : new Blob([csvEtichete(lista.filter(p => p.stare === 'activ'), pePlic)], { type: 'text/csv;charset=utf-8' })
    // juridic#021 pct. 3: opisul în 2 exemplare — ACELAȘI fișier: întâi se atașează la dosar, apoi se descarcă pentru plic (o singură generare)
    if (tip === 'opis' && poateScrie && rand.stare === 'activ' && !rand.data_expediere) {
      if (!curent()) return
      const path = `plicuri/${rand.id}/opis-${stampila()}.docx`
      const { error } = await supabase.storage.from('redari').upload(path, blob, { upsert: false, contentType: blob.type })
      if (error) throw { code: 'P0001', message: 'Exemplarul de la dosar nu s-a încărcat; opisul NU s-a descărcat. Reîncearcă „Opis”.' }
      if (!curent()) return
      await actualizeaza('red_plicuri', rand, { opis_path: path }, curent)
      if (curent()) descarcaBlob(blob, `${rand.nr_plic}-opis.docx`)
      return 'Exemplarul de la dosar a fost atașat la plic; același opis s-a descărcat pentru plic.'
    }
    if (curent()) descarcaBlob(blob, `${rand.nr_plic || rand.nr_lot}-${tip}.${tip === 'csv' ? 'csv' : 'docx'}`)
    return tip === 'csv' ? `Etichete descărcate pentru ${lista.filter(p => p.stare === 'activ').length} plicuri active; anulate excluse: ${lista.filter(p => p.stare === 'anulat').length}.` : 'Document descărcat.'
  }
  async function salveaza(curent) {
    const { tip, rand: r } = modal
    const invalid = message => { throw { code: '23514', message } }
    if (tip === 'lot') {
      if (!f.data || !selectate.length || selectate.length > 2000) invalid('Alege data și între 1 și 2000 de plicuri fără lot.')
      const { data, error } = await supabase.rpc('fn_red_lot_plicuire_creeaza', { p_proiect_id: proiect.id, p_plicuri: selectate, p_data: f.data })
      if (error) throw error
      if (!curent()) return
      const lot = Array.isArray(data) ? data[0] : data
      if (!lot?.id) throw new Error('Lot neconfirmat.')
      setModal(null)
      // Lotul este deja creat: un eșec DOCX se rezolvă prin regenerare, fără un nou RPC.
      try {
        const blob = await genereazaPvPlicuire(lot, plicuri.filter(p => selectate.includes(p.id)), pePlic, { proiect })
        if (curent()) descarcaBlob(blob, `${lot.nr_lot}.docx`)
      } catch { return `Lotul ${lot.nr_lot} a fost creat. Descarcă PV-ul din Loturi; generarea automată a eșuat.` }
      return `Lotul ${lot.nr_lot} a fost creat; PV descărcat.`
    }
    let patch, tabel = tip === 'pv_semnat' || tip === 'semnatari' ? 'red_loturi_plicuire' : 'red_plicuri'
    if (tip === 'semnatari') {
      if (f.semnatar1_id && f.semnatar1_id === f.semnatar2_id) invalid('Semnatarii trebuie să fie două persoane diferite (cine plicuiește și cine verifică).')
      patch = { semnatar1_id: f.semnatar1_id || null, semnatar2_id: f.semnatar2_id || null, observatii: f.observatii.trim() || null }
    }
    else if (tip === 'anulare') {
      if (!f.detaliu.trim()) invalid('Motivul anulării este obligatoriu.')
      patch = { stare: 'anulat', motiv_anulare: f.detaliu.trim() }
    } else if (tip === 'expediere') {
      // Aceeași regulă și aceeași recitire AWB ca la CSV; nu avem o a doua cale de expediere.
      const preview = propune([{ doc: r.nr_plic, awb: f.awb, data: f.data }], { nr_document: 'doc', nr_tracking: 'awb', data: 'data' }, 'expediere', plicuri, { imputernicire })   // Gemini f10 r2 P3
      if (preview.exceptii.length) invalid(preview.exceptii.map(e => e.motiv).join('; '))
      if (preview.deja.length) { if (curent()) setModal(null); return 'Expedierea este deja înregistrată.' }
      // Copilot f-v2 r4 P2: ziua 1 recitită din BD chiar acum; confirmarea termenului de 10 zile se calculează pe valoarea recitită
      const termen = await confirmaExpediereRecitita(supabase, { uatId: r.uat_id, data: f.data, confirm: m => window.confirm(m) })
      if (!curent()) return
      if (!termen.ok) return 'Expedierea nu s-a salvat: este după termenul de 10 zile și nu ai confirmat.'
      const raport = await aplica(supabase, preview.aplicabile, { esteCurent: curent })
      if (!curent()) return
      if (raport.erori.length || raport.neprocesate.length) throw new Error('Expediere neconfirmată.')
      if (raport.conflicte.length) invalid(raport.conflicte[0].motiv)
      if (raport.aplicate.length !== 1) throw new Error('Expediere neconfirmată.')
      setModal(null)
      return 'Expediere salvată.'
    } else {
      if (tip !== 'pv_semnat' && (r.stare !== 'activ' || !r.data_expediere || r.data_ar || r.retur)) invalid('AR sau retur se înregistrează o singură dată, pe un plic activ expediat, fără AR și fără retur.')
      if (tip !== 'pv_semnat' && (!f.data || f.data < r.data_expediere)) invalid('Data AR/retur trebuie să fie cel puțin data expedierii.')
      if (tip === 'retur' && (!MOTIVE_RETUR.some(m => m.cod === f.motiv) || (f.motiv === 'altul' && !f.detaliu.trim()))) invalid('Alege motivul; pentru „Altul” completează detaliul.')
      if (tip === 'ar' && !['destinatar', 'alta_persoana'].includes(f.primit_de)) invalid('Alege cine a semnat AR-ul.')
      // juridic#026 pct. 1: la „altă persoană” calitatea (din listă) și mențiunea de pe cartonaș sunt obligatorii
      if (tip === 'ar' && f.primit_de === 'alta_persoana' && (!CALITATI_AR.some(c => c.cod === f.calitate) || !f.mentiune.trim())) invalid('Pentru „altă persoană” alege calitatea primitorului și completează mențiunea de pe cartonaș.')
      if (tip === 'pv_semnat' && (!r.semnatar1_id || !r.semnatar2_id)) invalid('Alege întâi cei doi semnatari ai PV-ului de plicuire.')
      const ext = verificaFisier(f.fisier)
      const folder = tip === 'pv_semnat' ? `plicuire/${r.id}/pv` : `plicuri/${r.id}/${tip}`
      const path = f.path || `${folder}-${stampila()}.${ext}`
      if (!f.path) {
        const { error } = await supabase.storage.from('redari').upload(path, f.fisier, { upsert: false, contentType: f.fisier.type })
        if (error) throw new Error('Încărcare neconfirmată.')
        if (!curent()) return
        setF(x => ({ ...x, path }))
      }
      // juridic#026: ar_primit_calitate se trimite doar la „altă persoană” (la destinatar rămâne NULL, cum cere BD-ul)
      const alta = f.primit_de === 'alta_persoana'
      patch = tip === 'pv_semnat' ? { pv_path: path }
        : tip === 'ar' ? { data_ar: f.data, ar_scan_path: path, ar_primit_de: f.primit_de, ar_mentiune: alta ? f.mentiune.trim() : null, ...(alta ? { ar_primit_calitate: f.calitate } : {}) }
        : { retur: f.motiv, retur_data: f.data, retur_scan_path: path, retur_detaliu: f.detaliu.trim() || null }
    }
    if (!curent()) return
    await actualizeaza(tabel, r, patch, curent)
    if (curent()) setModal(null)
    return 'Înregistrare salvată.'
  }
  return <div style={{ marginTop: 20 }}>
    <h3>Plicuri de făcut</h3>
    {poateScrie ? <>
      <p>{grupare.grupuri.length} plicuri propuse. Maximum 200 de convocări într-un plic.</p>
      {uatDeExpediat.length > 0 && <div style={{ ...S.card, marginBottom: 10 }}>
        <b>Termen de expediere</b> (plan pct. 4.2: recomandata pleacă cu cel puțin {TERMEN_CONVOCARE_ZILE} zile înainte de ziua 1 de sesiune)
        {uatDeExpediat.map(u => <div key={u.id} style={{ color: termenExpediere(u, azi).depasit ? G.red : undefined }}>
          {u.nume}: {textTermenExpediere(u)}{termenExpediere(u, azi).depasit ? ' — termenul a trecut: expedierea de azi nu mai respectă cele ' + TERMEN_CONVOCARE_ZILE + ' zile' : ''}
        </div>)}
      </div>}
      {grupare.prea_mari?.length > 0 && <p style={{ color: G.yellow }}>Peste 200 de convocări la aceeași persoană în același UAT (nu se împart, serverul cere un singur plic complet): {grupare.prea_mari.map(g => `${g.destinatar} (${g.convocari.length})`).join('; ')}. Necesită o decizie separată.</p>}
      {grupare.grupuri.map(g => <details key={g.cheie} style={{ marginBottom: 8 }}><summary>{g.uat3} · {g.destinatar} · {adresaPlic(g.convocari[0]?.adresa)} · {g.convocari.length} convocări · {textTermenExpediere(uatDe(g.uat_id))}</summary><p>{g.convocari.map(c => `${c.nr_document} (${c.id_parcela})`).join('; ')}</p></details>)}
      {btn(`Creează ${grupare.grupuri.length} plicuri`, () => { if (window.confirm(`Creează ${grupare.grupuri.length} plicuri în ${proiect.cod}?`)) executa(creeaza, true) }, !date || !grupare.grupuri.length)}
      <p>Fără adresă (afișare): {grupare.fara_adresa.length}</p>
      {grupare.fara_adresa.map(c => <p key={c.conv_id}>{c.nr_document} · {c.detinator_nume} · {c.id_parcela}</p>)}
    </> : <p>Gruparea după adresă și modificările sunt disponibile pentru admin/editor.</p>}
    {btn('Reîncarcă datele', () => { setModal(null); setReload(n => n + 1) })}
    {lucru && <p role="status">Se prelucrează…</p>}
    {mesaj && <p role="status" style={{ color: G.yellow, whiteSpace: 'pre-wrap' }}>{mesaj}</p>}
    <h3>Plicuri</h3>
    <div style={{ display: 'flex', gap: 10 }}>
      <Camp eticheta="UAT"><select style={S.select} value={uatId} onChange={e => setUatId(e.target.value)}><option value="">Toate</option>{uats.map(u => <option key={u.id} value={u.id}>{u.nume}</option>)}</select></Camp>
      <Camp eticheta="Stare"><select style={S.select} value={filtru} onChange={e => setFiltru(e.target.value)}><option value="">Toate</option>{Object.entries({ fara_lot: 'Fără lot', in_lot: 'În lot, neexpediat', expediat: 'Expediat', AR: 'AR', retur: 'Retur', anulat: 'Anulat' }).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Camp>
    </div>
    {!date ? <Gol text="Date indisponibile sau în curs de încărcare." /> : <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr>{['', 'Nr. plic', 'UAT', 'Destinatar', 'Convocări', 'Lot', 'AWB / expediat', 'AR', 'Retur', 'Stare', 'Acțiuni'].map((h, i) => <th key={i} style={S.th}>{h}</th>)}</tr></thead><tbody>
      {plicuri.filter(p => (!uatId || p.uat_id === uatId) && (!filtru || starea(p) === filtru)).map(p => <tr key={p.id}>
        <td style={S.td}>{poateScrie && starea(p) === 'fara_lot' && <input type="checkbox" disabled={lucru} checked={selectate.includes(p.id)} onChange={e => setSelectate(a => e.target.checked ? [...a, p.id] : a.filter(id => id !== p.id))} />}</td>
        {[p.nr_plic, p.uat_nume, p.destinatar_nume, (pePlic[p.id] || []).length, loturi.find(l => l.id === p.lot_id)?.nr_lot || '-', textExpediat(p),
          p.data_ar ? `${fmtDate(p.data_ar)}${descriereArPlic(p)}` : '-', p.retur || '-', `${starea(p)}${p.opis_path ? '' : ' · fără opis la dosar'}`].map((v, i) => <td key={i} style={S.td}>{v}</td>)}
        <td style={S.td}>
          {btn(p.opis_path ? 'Opis (DOCX)' : 'Opis (DOCX) + exemplar la dosar', () => executa(c => document('opis', p, c), !p.opis_path), !poateScrie || !(pePlic[p.id]?.length))}
          {btn('Text AR', () => executa(async curent => { const t = textAR(p, pePlic[p.id] || [], { proiect }); setArText(t); try { await navigator.clipboard.writeText(t); return curent() ? 'Text AR copiat.' : '' } catch { return 'Textul AR este afișat pentru copiere manuală.' } }), !(pePlic[p.id]?.length) || !imputernicire)}
          {poateScrie && p.stare === 'activ' && <>
            {p.lot_id && !p.data_expediere && btn('Expediere…', () => deschide('expediere', p), !p.opis_path || !imputernicire)}
            {p.data_expediere && !p.data_ar && !p.retur && <>{btn('AR…', () => deschide('ar', p))}{btn('Retur…', () => deschide('retur', p))}</>}
            {!p.data_expediere && btn('Anulează', () => deschide('anulare', p))}
          </>}
        </td>
      </tr>)}
    </tbody></table></div>}
    {!imputernicire && <p style={{ color: G.yellow }}>Proiectul nu are încă împuternicirea Beneficiarului (Setări proiect): textele AR nu se generează și plicurile nu se pot expedia.</p>}
    {arText && <div style={S.card}><b>Text AR (validat de Juridic, juridic#021)</b><p style={{ whiteSpace: 'pre-wrap' }}>{arText}</p></div>}
    {poateScrie && btn(`Lot de plicuire (${selectate.length})`, () => deschide('lot'), !selectate.length || selectate.length > 2000)}
    <h3>Loturi</h3>
    {loturi.length ? loturi.map(l => <div key={l.id} style={{ ...S.card, marginBottom: 10 }}>
      <b>{l.nr_lot}</b> · {fmtDate(l.data_plicuire)} · {plicuri.filter(p => p.lot_id === l.id).length} plicuri
      <p>Semnatari: {l.semnatar1_nume || '-'} (plicuiește) / {l.semnatar2_nume || '-'} (verifică)</p><p>{l.observatii}</p>
      {btn('PV (DOCX)', () => executa(c => document('pv', l, c)))}
      {btn('Etichete CSV', () => executa(c => document('csv', l, c)), !poateScrie || !imputernicire)}
      {poateScrie && <>{btn('Editează semnatarii / observațiile', () => deschide('semnatari', l))}{!l.pv_path && btn('Atașează PV semnat', () => deschide('pv_semnat', l))}</>}
      {l.pv_path && <p>PV semnat atașat.</p>}
    </div>) : <Gol />}
    {modal && <Modal titlu={({ lot: 'Lot de plicuire', semnatari: 'Semnatari și observații', pv_semnat: 'PV semnat', anulare: 'Anulare plic', expediere: 'Expediere plic', ar: 'Confirmare AR', retur: 'Retur' })[modal.tip]} onClose={() => { if (!lucru) setModal(null) }}>
      <div style={{ display: 'grid', gap: 12 }}>
        {['lot', 'expediere', 'ar', 'retur'].includes(modal.tip) && <Camp eticheta="Data"><input style={S.input} disabled={lucru} type="date" min={['ar', 'retur'].includes(modal.tip) ? modal.rand.data_expediere : undefined} value={f.data} onChange={e => camp('data', e.target.value)} /></Camp>}
        {modal.tip === 'expediere' && <Camp eticheta="AWB"><input style={S.input} disabled={lucru} value={f.awb} onChange={e => camp('awb', e.target.value)} /></Camp>}
        {modal.tip === 'expediere' && <p style={{ margin: 0 }}>{modal.rand.uat_nume || 'UAT'}: {textTermenExpediere(uatDe(modal.rand.uat_id))} (cu cel puțin {TERMEN_CONVOCARE_ZILE} zile înainte de ziua 1, plan pct. 4.2).</p>}
        {modal.tip === 'expediere' && avertismentExpediere(uatDe(modal.rand.uat_id), f.data) && <p role="alert" style={{ margin: 0, padding: 8, borderRadius: 6, background: G.yellowDim, color: G.yellow }}>
          ⚠ {avertismentExpediere(uatDe(modal.rand.uat_id), f.data)} Se poate salva (data e cea reală), dar termenul de convocare nu e respectat.</p>}
        {modal.tip === 'retur' && <><Camp eticheta="Motiv retur"><select style={S.select} disabled={lucru} value={f.motiv} onChange={e => camp('motiv', e.target.value)}>{MOTIVE_RETUR.map(m => <option key={m.cod} value={m.cod}>{m.eticheta}</option>)}</select></Camp>{f.motiv === 'decedat' && <p style={{ color: G.yellow }}>Deținătorii din plic vor fi marcați decedați; cererea către TGZ pentru moștenitori se face separat.</p>}</>}
        {(modal.tip === 'anulare' || modal.tip === 'retur') && <Camp eticheta="Motiv / detaliu"><textarea style={S.input} disabled={lucru} value={f.detaliu} onChange={e => camp('detaliu', e.target.value)} /></Camp>}
        {['ar', 'retur', 'pv_semnat'].includes(modal.tip) && <Camp eticheta="Un singur fișier PDF / JPG / PNG, maximum 15 MB (față-verso într-un PDF)"><input disabled={lucru} type="file" accept="application/pdf,image/jpeg,image/png" onChange={e => setF(x => ({ ...x, fisier: e.target.files?.[0], path: null }))} /></Camp>}
        {modal.tip === 'ar' && <><Camp eticheta="Primit de (de pe cartonaș)"><select style={S.select} disabled={lucru} value={f.primit_de} onChange={e => camp('primit_de', e.target.value)}><option value="destinatar">Destinatarul</option><option value="alta_persoana">Altă persoană</option></select></Camp>
          {f.primit_de === 'alta_persoana' && <><Camp eticheta="Calitatea primitorului (ajunge în registrul pentru Transgaz și în PV B)"><select style={S.select} disabled={lucru} value={f.calitate} onChange={e => camp('calitate', e.target.value)}><option value="">— alege —</option>{CALITATI_AR.map(c => <option key={c.cod} value={c.cod}>{c.eticheta}</option>)}</select></Camp>
            <Camp eticheta="Mențiunea de pe cartonaș (text liber, rămâne doar în registrul intern)"><input style={S.input} disabled={lucru} maxLength={500} value={f.mentiune} onChange={e => camp('mentiune', e.target.value)} /></Camp></>}</>}
        {modal.tip === 'semnatari' && <>{[['semnatar1_id', 'Semnatar 1 — plicuiește'], ['semnatar2_id', 'Semnatar 2 — verifică']].map(([k, et]) => <Camp key={k} eticheta={et}><select style={S.select} disabled={lucru} value={f[k]} onChange={e => camp(k, e.target.value)}><option value="">—</option>{utilizatori.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Camp>)}
          <Camp eticheta="Observații"><input disabled={lucru} style={S.input} value={f.observatii} onChange={e => camp('observatii', e.target.value)} /></Camp></>}
        {f.path && <p>Fișier încărcat. La rezultat neconfirmat, reîncarcă și verifică înregistrarea înainte de reluare.</p>}
        {btn('Salvează', () => executa(salveaza, true))}
      </div>
    </Modal>}
  </div>
}
