// Redări › 📬 Notificări — ghidul modelelor, canalele de răspuns și centralizatorul (ce am trimis, ce mai avem de trimis, lipsurile).
// Doar citire: ecranul nu generează, nu trimite și nu scrie nimic. Logica: src/redari/notificari.js. Ghidul în text: docs/redari/GHID_NOTIFICARI.md.
// Citiri: keyset pe chei unice (L23, paginiExport), eroare ≠ gol (L18: o sursă opțională căzută = „necunoscut”, nu 0), token de generație (L24).
// Contactul (telefonul) se citește doar ca existență (detinator_id), doar pentru admin / editor; exportul nu are telefoane.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx-js-style'
import { supabase } from '../../lib/supabase.js'
import { G, S, msgEroare, Gol, TagStare } from './comune.jsx'
import { paginiExport } from './ExportEcran.jsx'
import { citesteSmsStare } from '../smsStare.js'
import { COL_CORESPONDENTA } from '../corespondenta.js'
import { descarcaBlob, aziBucuresti } from '../docx.js'
import { smsApi, mesajEroare } from '../../sms/smsApi.js'
import { STARI_MODEL, ghidModele, CANALE_RASPUNS, agregaDetinatori, centralizeaza, filtreaza, FILTRE_NOTIF, COLOANE_CENTRALIZATOR,
  ANTET_DETINATORI, randDetinator, foaieCentralizatorNotif, csvDetinatori, randuriCorespondenta, statisticiCanale } from '../notificari.js'

const LOT = 100, PARALEL = 4, AFISATE = 200

// .in() pe loturi de 100, câte PARALEL odată; fiecare lot paginat keyset (paginiExport). curent() fals = abandon (aruncă).
async function inLoturi(fabrica, coloana, ids, chei, curent) {
  const lista = [...new Set((ids || []).filter(Boolean))], loturi = []
  for (let i = 0; i < lista.length; i += LOT) loturi.push(lista.slice(i, i + LOT))
  const tot = []
  for (let i = 0; i < loturi.length; i += PARALEL) {
    if (!curent()) throw new Error('Citire abandonată: proiectul s-a schimbat.')
    const parti = await Promise.all(loturi.slice(i, i + PARALEL).map(l => paginiExport(() => fabrica().in(coloana, l), chei, curent)))
    for (const p of parti) tot.push(...p)
  }
  return tot
}

/** Citirea completă a centralizatorului. Aruncă la orice eroare a surselor obligatorii; SMS și telefon sunt opționale (eroare → null + mesaj). */
export async function citesteCentralizator(client, proiectId, { poateContact }, curent) {
  const randuri = await paginiExport(() => client.from('red_v_stare_parcela')
    .select('parcela_id,detinator_id,uat_id,uat3,uat_nume,id_parcela,tronson,nume,calitate,adresa_cunoscuta,stare').eq('proiect_id', proiectId),
  ['parcela_id', 'detinator_id'], curent)
  const ids = randuri.map(r => r.detinator_id), parcele = randuri.map(r => r.parcela_id)
  const [convocari, raspunsuri, pvs, tronsoane] = await Promise.all([
    inLoturi(() => client.from('red_convocari').select('id,detinator_id,canal,nr_document,data_expediere,data_confirmare_primire,retur,retur_data,fisier_convocator_path,stare,sters_la')
      .eq('stare', 'activ').is('sters_la', null), 'detinator_id', ids, ['id'], curent),
    inLoturi(() => client.from('red_raspunsuri').select('id,detinator_id,canal,data,optiune,seq,created_at'), 'detinator_id', ids, ['id'], curent),
    inLoturi(() => client.from('red_procese_verbale').select('id,tip,parcela_id,detinator_id,stare,sters_la').is('sters_la', null).neq('stare', 'anulat'),
      'parcela_id', parcele, ['id'], curent),
    // pentru ghidul PV C: parcelele reale pe tronson (aceeași vedere ca Dashboard / Tronsoane)
    paginiExport(() => client.from('red_v_tronson').select('parcela_id,tronson,tip_pv,suprafata_temporara_mp').eq('proiect_id', proiectId), ['parcela_id'], curent),
  ])
  const avertismente = []
  let sms = null
  try { sms = await citesteSmsStare(client, proiectId, curent) } catch (e) { if (!curent()) throw e; avertismente.push('SMS: ' + msgEroare(e)) }
  let cuTelefon = null
  if (poateContact) {
    try {
      const c = await inLoturi(() => client.from('red_detinatori_contact').select('detinator_id').not('telefon', 'is', null).neq('telefon', ''), 'detinator_id', ids, ['detinator_id'], curent)
      cuTelefon = new Set(c.map(x => x.detinator_id))
    } catch (e) { if (!curent()) throw e; avertismente.push('Telefon: ' + msgEroare(e)) }
  } else avertismente.push('Telefon: necunoscut (contactul îl văd doar admin / editor).')
  return { randuri, convocari, raspunsuri, pvs, tronsoane, sms, cuTelefon, avertismente }
}

const SUBTABURI = [['ghid', '📚 Ghidul modelelor'], ['raspuns', '↩ Canalele de răspuns'], ['centralizator', '📊 Centralizator']]

export function EticStare({ cod }) {
  const s = STARI_MODEL[cod] || { eticheta: cod, culoare: G.muted }
  return <span data-stare={cod} style={{ ...S.tag, background: `${s.culoare}22`, color: s.culoare, border: `1px solid ${s.culoare}55` }}>{s.eticheta}</span>
}

export function TabelGhid({ modele }) {
  return <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
    <thead><tr>{['Model', 'Ce e', 'Cui', 'Canal', 'De unde (tab → buton)', 'Stare', 'Ce lipsește pe proiect'].map(c => <th key={c} style={S.th}>{c}</th>)}</tr></thead>
    <tbody>{modele.map(m => <tr key={m.cod} data-model={m.cod}>
      <td style={{ ...S.td, fontWeight: 600 }}>{m.model}</td>
      <td style={{ ...S.td, color: G.muted, fontSize: 12.5 }}>{m.ce}{m.nota ? <div style={{ color: G.dim, marginTop: 4 }}>{m.nota}</div> : null}</td>
      <td style={S.td}>{m.cui}</td><td style={S.td}>{m.canal}</td><td style={{ ...S.td, fontSize: 12.5 }}>{m.unde}</td>
      <td style={S.td}><EticStare cod={m.stare} /></td>
      <td style={{ ...S.td, fontSize: 12.5 }}>{m.lipsuri.length ? <ul style={{ margin: 0, paddingLeft: 16 }}>{m.lipsuri.map(l => <li key={l}>{l}</li>)}</ul> : <span style={{ color: G.green }}>nimic</span>}</td>
    </tr>)}</tbody>
  </table></div>
}

export function TabelCorespondenta({ randuri, eroare }) {
  if (eroare) return <p role="alert" style={{ color: G.red, fontSize: 13 }}>Corespondența nu s-a putut citi: {eroare}</p>
  if (!randuri) return <p style={{ color: G.muted, fontSize: 12.5 }}>Se încarcă corespondența…</p>
  if (!randuri.length) return <Gol text="Nicio scrisoare în Corespondență pentru acest proiect." />
  return <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
    <thead><tr>{['Cod', 'Destinatar', 'Subiect', 'Stare', 'Trimis la', 'Depinde de'].map(c => <th key={c} style={S.th}>{c}</th>)}</tr></thead>
    <tbody>{randuri.map(r => <tr key={r.cod} data-coresp={r.cod}>
      <td style={{ ...S.td, ...S.mono }}>{r.cod}</td><td style={S.td}>{r.destinatar}</td><td style={{ ...S.td, fontSize: 12.5 }}>{r.subiect}</td>
      <td style={S.td}>{r.eticheta}</td><td style={S.td}>{r.trimis_la || '-'}</td><td style={{ ...S.td, fontSize: 12, color: G.muted }}>{r.depinde_de || '-'}</td>
    </tr>)}</tbody>
  </table></div>
}

export function TabelCanale({ statistici }) {
  return <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
    <thead><tr>{['Canal', 'Unde intră în ERP', 'Cum se înregistrează', 'Activ?', 'Răspunsuri', 'Deținători (ultimul răspuns)'].map(c => <th key={c} style={S.th}>{c}</th>)}</tr></thead>
    <tbody>{CANALE_RASPUNS.map(c => <tr key={c.cod} data-canal={c.cod}>
      <td style={{ ...S.td, fontWeight: 600 }}>{c.nume}</td><td style={{ ...S.td, fontSize: 12.5 }}>{c.intra}</td><td style={{ ...S.td, fontSize: 12.5 }}>{c.cum}</td>
      <td style={S.td}>{c.activ ? <span style={{ color: G.green }}>da</span> : <span style={{ color: G.yellow }}>nu (manual)</span>}</td>
      <td style={S.td}>{statistici ? statistici.toate[c.canal] || 0 : '…'}</td><td style={S.td}>{statistici ? statistici.ultim[c.canal] || 0 : '…'}</td>
    </tr>)}</tbody>
  </table></div>
}

const celula = v => (v == null ? <span title="sursa nu s-a putut citi" style={{ color: G.yellow }}>?</span> : v)
export function TabelCentralizator({ cent }) {
  return <div style={{ overflowX: 'auto' }}><table style={{ borderCollapse: 'collapse', width: '100%' }}>
    <thead><tr><th style={S.th}>UAT</th>{COLOANE_CENTRALIZATOR.map(([k, e]) => <th key={k} style={S.th}>{e}</th>)}</tr></thead>
    <tbody>
      {cent.randuri.map(r => <tr key={r.uat_id} data-uat={r.uat_id}><td style={S.td}>{r.uat_nume}</td>{COLOANE_CENTRALIZATOR.map(([k]) => <td key={k} style={S.td}>{celula(r[k])}</td>)}</tr>)}
      <tr data-total="1"><td style={{ ...S.td, fontWeight: 700 }}>TOTAL</td>{COLOANE_CENTRALIZATOR.map(([k]) => <td key={k} style={{ ...S.td, fontWeight: 700 }}>{celula(cent.total[k])}</td>)}</tr>
    </tbody>
  </table></div>
}

export function ListaDetinatori({ lista }) {
  if (!lista.length) return <Gol text="Niciun deținător pe filtrul ales." />
  return <div style={{ overflowX: 'auto' }}><table style={{ borderCollapse: 'collapse', width: '100%' }}>
    <thead><tr>{['ID parcelă', 'UAT', 'Deținător', 'Stare', 'De trimis', 'Convocare', 'SMS', 'Răspuns', 'PV', 'Lipsuri'].map(c => <th key={c} style={S.th}>{c}</th>)}</tr></thead>
    <tbody>{lista.slice(0, AFISATE).map(d => <tr key={d.parcela_id + '/' + d.detinator_id}>
      <td style={{ ...S.td, ...S.mono }}>{d.id_parcela}</td><td style={S.td}>{d.uat_nume}</td><td style={S.td}>{d.nume}</td><td style={S.td}><TagStare cod={d.stare} /></td>
      <td style={S.td} data-de-trimis={String(d.de_trimis)}>{d.de_trimis === null ? <span title={`necunoscut: ${d.canale_necunoscute.join(', ')}`} style={{ color: G.yellow }}>?</span> : d.de_trimis ? 'da' : 'nu'}</td>
      <td style={{ ...S.td, fontSize: 12.5 }}>{[d.convocator && 'generat', d.expediat && 'expediat', d.ar && 'AR', d.retur && 'retur'].filter(Boolean).join(' · ') || '-'}</td>
      <td style={S.td}>{d.sms == null ? '?' : d.sms === 'fara' ? '-' : d.sms}</td><td style={S.td}>{d.raspuns_canal || '-'}</td>
      <td style={{ ...S.td, fontSize: 12.5 }}>{[d.pv_a && `A ${d.pv_a}`, d.pv_b && `B ${d.pv_b}`].filter(Boolean).join(' · ') || '-'}</td>
      <td style={{ ...S.td, fontSize: 12.5, color: G.yellow }}>{[d.neidentificat && 'neidentificat', d.fara_adresa === true && 'fără adresă', d.fara_adresa === null && 'adresă ?', d.fara_telefon && 'fără telefon'].filter(Boolean).join(' · ')}</td>
    </tr>)}</tbody>
  </table>
  {lista.length > AFISATE && <p style={{ fontSize: 12, color: G.muted }}>Se afișează primii {AFISATE} din {lista.length}. Lista completă: exportul.</p>}
  </div>
}

// dateInitiale: doar pentru teste (randare fără rețea) — { ghid: { corespondenta, smsPanou, smsPanouEroare }, centralizator: rezultatul citesteCentralizator }
// dateInitiale / subtabInitial / uatInitial: doar pentru teste (randare fără rețea)
export default function NotificariEcran({ proiect, uats = [], nivel, dateInitiale = null, subtabInitial = 'ghid', uatInitial = '' }) {
  const [subtab, setSubtab] = useState(subtabInitial)
  const [ghidSurse, setGhidSurse] = useState(dateInitiale?.ghid || null)
  const [ghidEroare, setGhidEroare] = useState('')
  const [date, setDate] = useState(dateInitiale?.centralizator || null)
  const [eroare, setEroare] = useState('')
  const [reload, setReload] = useState(0)
  const [uatId, setUatId] = useState(uatInitial), [filtru, setFiltru] = useState('')
  const generatie = useRef(0)
  const poateContact = nivel === 'admin' || nivel === 'editor'

  useEffect(() => {
    if (dateInitiale) return
    const token = ++generatie.current, id = proiect.id, curent = () => token === generatie.current
    setGhidSurse(null); setGhidEroare(''); setDate(null); setEroare('')
    ;(async () => {
      let corespondenta = null, corespEroare = ''
      try { corespondenta = await paginiExport(() => supabase.from('red_corespondenta').select(COL_CORESPONDENTA).eq('proiect_id', id), ['id'], curent) }
      catch (e) { corespEroare = msgEroare(e) }
      let smsPanou = null, smsPanouEroare = null
      try { smsPanou = await smsApi.panou() } catch (e) { smsPanouEroare = e?.code === '42501' ? 'fără nivel pe SMS' : mesajEroare(e) }
      if (curent()) setGhidSurse({ corespondenta, corespEroare, smsPanou, smsPanouEroare })
    })().catch(e => { if (curent()) setGhidEroare(msgEroare(e)) })
    citesteCentralizator(supabase, id, { poateContact }, curent)
      .then(d => { if (curent()) setDate(d) })
      .catch(e => { if (curent()) setEroare(msgEroare(e)) })
    return () => { generatie.current++ }
  }, [proiect.id, reload, poateContact, dateInitiale])

  const inregistrari = useMemo(() => (date ? agregaDetinatori({ ...date, uats }) : null), [date, uats])
  const modele = useMemo(() => ghidModele({ proiect, uats, smsPanou: ghidSurse?.smsPanou || null, smsPanouEroare: ghidSurse ? ghidSurse.smsPanouEroare : null,
    corespondenta: ghidSurse?.corespondenta ?? null, tronsoane: date?.tronsoane ?? null }), [proiect, uats, ghidSurse, date])
  useEffect(() => { setUatId(''); setFiltru('') }, [proiect.id])
  const uatValid = uats.some(u => u.id === uatId) ? uatId : ''   // Jak #992 P2-5: un UAT din alt proiect nu mai filtrează
  const filtrate = useMemo(() => (inregistrari ? filtreaza(inregistrari, { uatId: uatValid, filtru }) : []), [inregistrari, uatValid, filtru])
  const cent = useMemo(() => (inregistrari ? centralizeaza(filtrate) : null), [inregistrari, filtrate])
  const statistici = useMemo(() => (date ? statisticiCanale(date.raspunsuri, inregistrari) : null), [date, inregistrari])

  const numeFisier = ext => `notificari_${String(proiect.cod || 'proiect').replace(/[^A-Za-z0-9_-]/g, '_')}_${aziBucuresti()}${filtru ? '_' + filtru : ''}.${ext}`
  const exportaXlsx = () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(foaieCentralizatorNotif(cent)), 'Centralizator')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([ANTET_DETINATORI, ...filtrate.map(randDetinator)]), 'Detinatori')
    descarcaBlob(new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), numeFisier('xlsx'))
  }
  const exportaCsv = () => descarcaBlob(new Blob([csvDetinatori(filtrate)], { type: 'text/csv;charset=utf-8' }), numeFisier('csv'))

  return <div style={S.card}>
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
      {SUBTABURI.map(([c, e]) => <button key={c} onClick={() => setSubtab(c)} style={{ ...S.btnS, borderColor: subtab === c ? G.green : G.border2, color: subtab === c ? G.text : G.muted }}>{e}</button>)}
      <div style={{ flex: 1 }} />
      <button style={S.btnS} disabled={!!dateInitiale || (!date && !eroare)} onClick={() => setReload(n => n + 1)}>↻ Reîncarcă</button>
    </div>

    {subtab === 'ghid' && <>
      <p style={{ fontSize: 12.5, color: G.muted, margin: '0 0 10px' }}>Fiecare model din ERP: ce e, cui merge, pe ce canal, de unde se generează și ce îi lipsește pe proiectul {proiect.cod}. Verificarea folosește aceleași reguli ca butoanele care generează documentele.</p>
      {ghidEroare && <p role="alert" style={{ color: G.red }}>{ghidEroare}</p>}
      <TabelGhid modele={modele} />
      <h3 style={{ fontSize: 14.5, fontWeight: 700, margin: '18px 0 6px' }}>Înștiințări și scrisori (📨 Corespondență)</h3>
      <TabelCorespondenta randuri={ghidSurse?.corespondenta ? randuriCorespondenta(ghidSurse.corespondenta) : null} eroare={ghidSurse?.corespEroare || ''} />
    </>}

    {subtab === 'raspuns' && <>
      <p style={{ fontSize: 12.5, color: G.muted, margin: '0 0 10px' }}>Toate răspunsurile ajung în același loc (red_raspunsuri); Registrul și Fișa arată „ultimul răspuns” (după dată, apoi ordinea înregistrării). Istoricul rămâne.</p>
      {eroare && <p role="alert" style={{ color: G.red }}>Cifrele nu s-au putut citi: {eroare}</p>}
      <TabelCanale statistici={eroare ? null : statistici} />
    </>}

    {subtab === 'centralizator' && <>
      {eroare && <p role="alert" style={{ color: G.red }}>Centralizatorul nu s-a putut citi: {eroare}</p>}
      {!date && !eroare && <p style={{ fontSize: 12.5, color: G.muted }}>Se încarcă…</p>}
      {date && <>
        {date.avertismente?.length > 0 && <div role="status" style={{ fontSize: 12.5, color: G.yellow, marginBottom: 8 }}>{date.avertismente.map(a => <div key={a}>⚠ {a}</div>)}</div>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <select aria-label="UAT" value={uatValid} onChange={e => setUatId(e.target.value)} style={S.select}>
            <option value="">Toate UAT-urile</option>{[...uats].sort((a, b) => String(a.nume).localeCompare(String(b.nume), 'ro')).map(u => <option key={u.id} value={u.id}>{u.nume}</option>)}
          </select>
          <select aria-label="Filtru" value={filtru} onChange={e => setFiltru(e.target.value)} style={S.select}>
            {FILTRE_NOTIF.map(f => <option key={f.cod} value={f.cod}>{f.eticheta}</option>)}
          </select>
          <div style={{ flex: 1 }} />
          <button style={S.btnS} onClick={exportaXlsx}>📥 Export xlsx (fără telefoane)</button>
          <button style={S.btnS} onClick={exportaCsv}>📥 Export CSV</button>
        </div>
        <p style={{ fontSize: 12, color: G.muted, margin: '0 0 8px' }}>Un rând = o pereche parcelă × deținător. „De trimis” = fără niciun canal reușit (AR primit, SMS livrat, răspuns pe orice canal, PV semnat, afișare la Primărie pentru neidentificați / fără adresă); „plecat, neconfirmat” = expediat fără AR sau SMS fără confirmare. „?” / „necunoscut” = sursa nu s-a putut citi (SMS) sau adresa nu se poate deduce: nu se numără nici „da”, nici „nu”.</p>
        <TabelCentralizator cent={cent} />
        <h3 style={{ fontSize: 14.5, fontWeight: 700, margin: '18px 0 6px' }}>Deținătorii pe filtrul ales ({filtrate.length})</h3>
        <ListaDetinatori lista={filtrate} />
      </>}
    </>}
  </div>
}
