/* UatEcran.jsx — Redări faza 2, felia 1: UAT-urile proiectului (primărie, reprezentant, cele 3 zile de sesiune, afișarea).
   Scrie doar admin (RLS red_uat_ins / red_uat_upd = admin); editor și viewer văd în citire. uat3 intră în id_parcela: se schimbă doar cât UAT-ul
   nu are parcele (garda e și în BD, trigger-ul fn_red_legaturi). Schimbarea zilelor recalculează în BD expirarea tokenurilor (trg_red_uat_sesiuni). */
import React, { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../../lib/supabase.js'
import { G, S, Modal, Camp, Gol, fmtDate, msgEroare, motivBlocareConvocator, citestePaginat } from './comune.jsx'
import { verificaDateAdresaUat, genereazaAdresaUat, salveazaAdresaUat, descarcaBlob, versiuneMaximaInBucket, caleAdresaUat, aziBucuresti, BUCKET_REDARI } from '../docx.js'
import { uat3 as uat3Din } from '../idParcela.js'
import { CAMPURI_UAT, COL_UAT, ZILE_SESIUNE, normalizeaza, cheiSchimbate, valideazaUat, lipsuriUat, rezumatZile, conflicteConcurente } from '../setari.js'
import FormularCampuri from './FormularCampuri.jsx'

const CHEI_SESIUNE = [...ZILE_SESIUNE, 'program_zi1', 'program_zi2', 'program_zi3']

// parcele = active (afișare); parceleToate = inclusiv șterse logic (garda codului: trigger-ul BD le numără pe toate — Jakarinos f2 r1 P3)
async function numaraUat(uatId) {
  const [p, t, c] = await Promise.all([
    supabase.from('red_parcele').select('id', { count: 'exact', head: true }).eq('uat_id', uatId).is('sters_la', null),
    supabase.from('red_parcele').select('id', { count: 'exact', head: true }).eq('uat_id', uatId),
    supabase.from('red_v_stare_parcela').select('parcela_id', { count: 'exact', head: true }).eq('uat_id', uatId).not('ultima_convocare_data', 'is', null),
  ])
  const err = p.error || t.error || c.error
  if (err) throw err
  if (p.count == null || t.count == null || c.count == null) throw new Error('numărătoare indisponibilă')
  return { parcele: p.count, parceleToate: t.count, convocati: c.count }
}

export default function UatEcran({ proiect, uats, nivel, show, onSchimbat }) {
  const esteAdmin = nivel === 'admin'
  const [numaratori, setNumaratori] = useState({})   // uat_id → { parcele, convocati }
  const [editat, setEditat] = useState(null)         // rândul UAT deschis
  const [nou, setNou] = useState(false)
  const generatieNumaratori = useRef(0)

  const incarcaNumaratori = useCallback(async () => {
    const token = ++generatieNumaratori.current
    const rez = {}
    for (const u of uats) {
      if (generatieNumaratori.current !== token) return
      try { rez[u.id] = await numaraUat(u.id) }
      catch (e) { if (generatieNumaratori.current === token) show('Numărători UAT: ' + msgEroare(e), 'error'); return }
    }
    if (generatieNumaratori.current === token) setNumaratori(rez)
  }, [uats, show])
  useEffect(() => { setNumaratori({}); incarcaNumaratori(); return () => { generatieNumaratori.current++ } }, [incarcaNumaratori])

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{ fontSize: 13, color: G.muted }}>
          {uats.length} UAT-uri. {esteAdmin ? 'Click pe un rând ca să-l completezi.' : 'Doar administratorul modifică UAT-urile.'}
        </div>
        <div style={{ flex: 1 }} />
        {esteAdmin && <button onClick={() => setNou(true)} style={S.btnS}>＋ UAT nou</button>}
      </div>
      {uats.length === 0 ? <Gol text="Proiectul nu are UAT-uri." /> : (
        <div style={{ ...S.card, padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              {['UAT', 'Cod', 'Zile sesiune', 'Reprezentant primărie', 'Termen confirmare', 'Afișare', 'Parcele', 'Convocați', 'Gata de convocare?'].map(h => <th key={h} style={S.th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {uats.map(u => {
                const n = numaratori[u.id]
                const lips = [...lipsuriUat(u)]
                const pr = motivBlocareConvocator(proiect, u, null)
                return (
                  <tr key={u.id} onClick={() => setEditat(u)} style={{ cursor: 'pointer' }}>
                    <td style={S.td}><b>{u.nume}</b><div style={{ fontSize: 11.5, color: G.dim }}>{u.judet || ''}</div></td>
                    <td style={{ ...S.td, ...S.mono }}>{u.uat3}</td>
                    <td style={S.td}>{rezumatZile(u)}</td>
                    <td style={S.td}>{u.reprezentant_uat_nume || <span style={{ color: G.dim }}>-</span>}</td>
                    <td style={S.td}>{fmtDate(u.termen_confirmare)}</td>
                    <td style={S.td}>{u.afisare_data_start ? `${fmtDate(u.afisare_data_start)} – ${fmtDate(u.afisare_data_end)}` : '-'}</td>
                    <td style={S.td}>{n ? n.parcele : '…'}</td>
                    <td style={S.td}>{n ? n.convocati : '…'}</td>
                    <td style={{ ...S.td, fontSize: 12 }}>
                      {!lips.length && !pr ? <span style={{ color: G.green }}>✓ da</span>
                        : <span style={{ color: G.yellow }}>{[...lips, ...(pr ? [pr] : [])].join('; ')}</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {editat && <ModalUat key={editat.id} proiect={proiect} uat={editat} uats={uats} numarator={numaratori[editat.id]} esteAdmin={esteAdmin} poateDescarca={['admin', 'editor'].includes(nivel)} show={show}
        onClose={() => setEditat(null)} onGata={() => { setEditat(null); onSchimbat() }} />}
      {nou && <ModalUatNou proiect={proiect} uats={uats} show={show} onClose={() => setNou(false)} onGata={() => { setNou(false); onSchimbat() }} />}
    </div>
  )
}

export function ModalUat({ proiect, uat, uats, numarator, esteAdmin, poateDescarca = esteAdmin, show, onClose, onGata }) {
  const [form, setForm] = useState(() => ({ ...uat }))
  const [cod, setCod] = useState(uat.uat3)
  const [lucru, setLucru] = useState(false)
  const [erori, setErori] = useState([])
  const schimbate = cheiSchimbate(uat, form, CAMPURI_UAT)
  const codSchimbat = cod !== uat.uat3
  const poateSchimbaCod = esteAdmin && numarator && numarator.parceleToate === 0
  const generatie = useRef(0)
  const ocupat = useRef(false)
  useEffect(() => { generatie.current++; return () => { generatie.current++ } }, [uat.id, proiect?.id])
  const lipsuriAdresa = verificaDateAdresaUat({ proiect, uat, nrDocument: uat.adresa_nr || 'AU-rezervat-la-generare' })
  const nesalvat = schimbate.length > 0 || codSchimbat
  const adresa = async (doarDescarca = false) => {
    if (ocupat.current || lucru) return
    // Gemini f2b r1 P2: descărcarea e pentru admin + editor (bucket-ul are SELECT doar pentru ei — red_storage_sel), generarea doar admin
    if (doarDescarca && !poateDescarca) return
    if (!doarDescarca && (!esteAdmin || nesalvat || lipsuriAdresa.length)) return
    if (!doarDescarca && uat.adresa_nr && !window.confirm(`Regenerezi ${uat.adresa_nr}? Numărul rămâne același; se creează o versiune nouă.`)) return
    ocupat.current = true
    setLucru(true) // înainte de primul await, inclusiv înainte de citirea parcelelor
    const token = ++generatie.current
    const id = uat.id
    const curent = () => generatie.current === token && id === uat.id
    let rezervat = false   // Copilot f2b r2 P3-01: după o rezervare reușită, orice eșec ulterior reîncarcă lista (UAT-ul are numărul → „Regenerează”)
    try {
      if (doarDescarca) {
        const max = await versiuneMaximaInBucket(supabase, { proiectCod: proiect.cod, uat3: uat.uat3, idParcela: 'adresa', nrDocument: uat.adresa_nr, adresa: true }, { esteCurent: curent })
        if (!curent()) return
        if (max == null || max === 0) throw new Error('Fișierul adresei nu este disponibil; verifică versiunile din storage')
        const path = caleAdresaUat({ proiectCod: proiect.cod, uat3: uat.uat3, nrDocument: uat.adresa_nr, versiune: max })
        const { data, error } = await supabase.storage.from(BUCKET_REDARI).createSignedUrl(path, 600)
        if (!curent()) return
        if (error || !data?.signedUrl) throw new Error('Nu pot obține linkul de descărcare')
        window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
        return
      }
      const parcele = await citestePaginat(() => supabase.from('red_v_parcele')
        .select('id_parcela, sat, tarla, nr_cadastral, poz_hg, tronson, sters_la')
        .eq('proiect_id', proiect.id).eq('uat_id', id).is('sters_la', null), { cheie: 'id_parcela', esteCurent: curent })
      if (!curent()) return
      const raspuns = await fetch('/redari/sabloane/adresa_uat.docx')
      if (!raspuns.ok) throw new Error('Șablonul adresei nu a putut fi citit')
      const templateArrayBuffer = await raspuns.arrayBuffer()
      if (!curent()) return
      // Copilot f2b r1 P2-1: numărul se rezervă ȘI se scrie pe UAT într-un singur RPC (FOR UPDATE + CAS pe versiune), ÎNAINTE de generare.
      // Un eșec ulterior (șablon, upload) lasă numărul pe UAT; reluarea = „Regenerează” pe același număr. Fără numere pierdute, fără fișiere orfane.
      // Copilot f2b r2 P2-01: documentul se face din UAT-ul și proiectul PROASPETE (nu din rândurile deschise în fereastră); dacă UAT-ul s-a
      // schimbat între timp (altă versiune), adminul confirmă; după upload se reverifică versiunea — dacă s-a schimbat în timpul generării,
      // fișierul (versionat, imutabil) rămâne, dar utilizatorul e avertizat să regenereze. Rezervarea (RPC) rămâne atomică și idempotentă.
      const [{ data: uatProaspat, error: eu }, { data: proiectProaspat, error: ep }] = await Promise.all([
        supabase.from('red_uat').select(COL_UAT).eq('id', id).maybeSingle(),
        supabase.from('red_proiecte').select('*').eq('id', proiect.id).maybeSingle(),
      ])
      if (!curent()) return
      if (eu || ep) throw eu || ep
      if (!uatProaspat || !proiectProaspat) throw new Error('UAT-ul sau proiectul nu mai sunt vizibile (fără drept pe modul?)')
      if (uatProaspat.versiune !== uat.versiune && !window.confirm(
        `UAT-ul a fost modificat între timp de altcineva (versiunea ${uatProaspat.versiune}, tu ai deschis versiunea ${uat.versiune}).\nGenerez adresa cu datele ACTUALE din bază?`)) return
      const lipsuriProaspete = verificaDateAdresaUat({ proiect: proiectProaspat, uat: uatProaspat, nrDocument: uatProaspat.adresa_nr || 'AU-rezervat-la-generare' })
      if (lipsuriProaspete.length) throw new Error('Datele actuale nu permit generarea: ' + lipsuriProaspete.join('; '))
      let uatCurent = uatProaspat
      if (!uatCurent.adresa_nr) {
        const { data, error } = await supabase.rpc('fn_red_adresa_uat_rezerva', { p_uat_id: id, p_versiune: uatProaspat.versiune })
        if (!curent()) return
        if (error || !data?.adresa_nr) throw new Error('Rezervarea numărului adresei a eșuat: ' + (error?.message || 'răspuns gol') + '. Reîncarcă UAT-ul: dacă numărul a fost rezervat, e deja pe UAT și se reia cu „Regenerează”.')
        uatCurent = data
        rezervat = true
      }
      const nrDocument = uatCurent.adresa_nr
      const dataDocument = uatCurent.adresa_data || aziBucuresti()
      const { blob } = await genereazaAdresaUat({ proiect: proiectProaspat, uat: uatCurent, parcele, nrDocument, templateArrayBuffer, dataDocument })
      if (!curent()) return
      const { path } = await salveazaAdresaUat(supabase, { blob, proiectCod: proiectProaspat.cod, uat: uatCurent, nrDocument, esteCurent: curent })
      if (!curent()) return
      // Copilot f2b r3 P2-01: după upload se reverifică ȘI UAT-ul ȘI proiectul (ambele intră în document); o recitire eșuată NU e succes
      // (fail-closed: avertisment, nu „salvată”); P3-01: un singur mesaj final — succes SAU „salvat cu avertisment, regenerează”.
      const [{ data: uatDupa, error: e1 }, { data: prDupa, error: e2 }] = await Promise.all([
        supabase.from('red_uat').select('versiune').eq('id', id).maybeSingle(),
        supabase.from('red_proiecte').select('versiune').eq('id', proiect.id).maybeSingle(),
      ])
      if (!curent()) return
      const neverificat = !!(e1 || e2) || !uatDupa || !prDupa
      const schimbat = !neverificat && (uatDupa.versiune !== uatCurent.versiune || prDupa.versiune !== proiectProaspat.versiune)
      descarcaBlob(blob, `${nrDocument}.docx`)   // fișierul e deja în bucket (imutabil, versionat), indiferent de verdictul verificării
      if (neverificat) show(`Adresa ${nrDocument} e salvată (${path}), dar NU am putut verifica dacă UAT-ul sau proiectul s-au schimbat între timp. Reîncarcă și, dacă e cazul, apasă „Regenerează”.`, 'error')
      else if (schimbat) show(`Atenție: UAT-ul sau proiectul au fost modificate în timpul generării (${path}). Fișierul e salvat, dar poate avea date vechi — apasă „Regenerează”.`, 'error')
      else show(`Adresa ${nrDocument} salvată.`, 'success')
      onGata()
    } catch (err) { if (curent()) { show('Adresă UAT: ' + msgEroare(err), 'error'); if (rezervat) onGata() } }
    finally { if (curent()) { ocupat.current = false; setLucru(false) } }
  }

  const salveaza = async () => {
    const e = valideazaUat(form)
    if (codSchimbat) {
      if (!/^[A-Z]{3}$/.test(cod)) e.push('Codul UAT: exact 3 litere mari (A–Z)')
      else if (uats.some(x => x.id !== uat.id && x.uat3 === cod)) e.push(`Codul UAT ${cod} e deja folosit în proiect`)
      if (!poateSchimbaCod) e.push('Codul UAT nu se mai schimbă: UAT-ul are parcele (codul e în id_parcela)')
    }
    setErori(e)
    if (e.length) return
    if (!schimbate.length && !codSchimbat) { show('Nimic de salvat.', 'info'); return }
    if (lucru) return
    // Jakarinos f2 r3 P2: formularul (inclusiv codul) se blochează ÎNAINTE de primul await și se deblochează pe toate ieșirile;
    // form / schimbate / cod sunt fixate aici, iar câmpurile nu mai acceptă tastare până la final.
    const atingeSesiuni = schimbate.some(k => CHEI_SESIUNE.includes(k))
    const tot = normalizeaza(form, CAMPURI_UAT)
    const patch = Object.fromEntries(schimbate.map(k => [k, tot[k]]))
    if (codSchimbat) patch.uat3 = cod
    const cheiPatch = Object.keys(patch)   // include uat3 — conflictul pe cod se detectează la fel ca pe câmpuri (Jakarinos f2 r3 P2)
    if (ocupat.current) return
    ocupat.current = true
    const token = ++generatie.current
    const curent = () => generatie.current === token
    setLucru(true)
    try {
      // Jakarinos f2 r1 P2: numărătoarea se citește PROASPĂT la salvare; dacă nu se poate citi, nu salvăm (necunoscut ≠ zero convocați)
      let proaspat = null
      if (atingeSesiuni || codSchimbat) {
        try { proaspat = await numaraUat(uat.id) }
        catch (err) { if (curent()) show('Nu pot verifica convocările UAT-ului, nu salvez: ' + msgEroare(err), 'error'); return }
        if (!curent()) return
        if (codSchimbat && proaspat.parceleToate > 0) { setErori(['Codul UAT nu se mai schimbă: UAT-ul are parcele (codul e în id_parcela)']); return }
      }
      if (atingeSesiuni && proaspat.convocati > 0 && !window.confirm(
        `UAT-ul ${uat.nume} are ${proaspat.convocati} deținători deja convocați cu zilele vechi.\n` +
        'Convocatoarele trimise NU se modifică, iar răspunsurile noi se vor raporta la zilele noi. Expirarea linkurilor se recalculează automat.\n\nContinui?')) return
      // Copilot f2 r2 P2: rândul de acum + scriere doar pe versiunea verificată (blocare optimistă, trg_red_versiune)
      const { data: acum, error: ea } = await supabase.from('red_uat').select(COL_UAT).eq('id', uat.id).maybeSingle()
      if (!curent()) return
      if (ea) throw ea
      if (!acum) throw new Error('UAT-ul nu mai e vizibil (fără drept pe modul?)')
      if (acum.versiune !== uat.versiune) {
        const conf = conflicteConcurente(uat, acum, cheiPatch)
        const etichete = conf.map(k => k === 'uat3' ? 'Cod UAT' : (CAMPURI_UAT.find(c => c.cheie === k)?.eticheta || k))
        if (conf.length && !window.confirm(`Alt administrator a schimbat între timp: ${etichete.join(', ')}.\nSuprascrii cu valorile tale?`)) return
      }
      const { data, error } = await supabase.from('red_uat').update(patch).eq('id', uat.id).eq('versiune', acum.versiune).select(COL_UAT)
      if (!curent()) return
      if (error) throw error
      if (!data?.length) throw new Error('Nu s-a salvat: UAT-ul a fost modificat chiar acum de altcineva sau nu ai drept de administrator. Reîncarcă și reîncearcă.')
      show(`UAT ${uat.nume} salvat.`, 'success')
      onGata()
    } catch (err) { if (curent()) show('Salvare UAT: ' + msgEroare(err), 'error') }
    finally { if (curent()) { ocupat.current = false; setLucru(false) } }
  }

  return (
    <Modal titlu={`UAT ${uat.nume}`} onClose={onClose} latime={820}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', marginBottom: 12, flexWrap: 'wrap' }}>
        <Camp eticheta="Cod UAT (în id_parcela)">
          {poateSchimbaCod
            ? <input value={cod} disabled={lucru} onChange={e => { if (!lucru) setCod(e.target.value.toUpperCase().slice(0, 3)) }} style={{ ...S.input, ...S.mono, width: 90, ...(lucru ? { opacity: 0.6 } : null) }} />
            : <div style={{ ...S.mono, padding: '7px 0' }}>{uat.uat3}</div>}
        </Camp>
        <div style={{ fontSize: 12, color: G.dim, paddingBottom: 8 }}>
          {numarator ? `${numarator.parcele} parcele · ${numarator.convocati} deținători convocați` : 'se numără…'}
          {uat.adresa_nr ? ` · adresa ${uat.adresa_nr} din ${fmtDate(uat.adresa_data)}` : ''}
        </div>
      </div>
      <FormularCampuri campuri={CAMPURI_UAT} form={form} doarCitire={!esteAdmin} blocat={lucru} schimbate={schimbate}
        onChange={(k, v) => { if (!lucru) setForm(f => ({ ...f, [k]: v })) }} />
      {(esteAdmin || (poateDescarca && uat.adresa_nr)) && <div style={{ marginTop: 14 }}>
        {poateDescarca && uat.adresa_nr && <button style={S.btnS} disabled={lucru} onClick={() => adresa(true)}>Descarcă adresa {uat.adresa_nr}</button>}
        {esteAdmin && uat.adresa_nr && <>{' '}<button style={S.btnS} disabled={lucru || nesalvat || lipsuriAdresa.length > 0} onClick={() => adresa()}>Regenerează</button></>}
        {esteAdmin && !uat.adresa_nr && <button style={S.btnP} disabled={lucru || nesalvat || lipsuriAdresa.length > 0} onClick={() => adresa()}>Generează adresa UAT</button>}
        {esteAdmin && nesalvat && <div style={{ color: G.yellow }}>Salvează modificările înainte de generarea adresei.</div>}
        {esteAdmin && lipsuriAdresa.length > 0 && <div style={{ color: G.yellow, fontSize: 12 }}>{lipsuriAdresa.join('; ')}</div>}
      </div>}
      {erori.length > 0 && (
        <div style={{ marginTop: 12, padding: 10, borderRadius: 7, background: G.redDim, color: G.red, fontSize: 12.5 }}>
          {erori.map(e => <div key={e}>• {e}</div>)}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
        <button onClick={onClose} style={S.btnS}>{esteAdmin ? 'Renunț' : 'Închide'}</button>
        {esteAdmin && <button onClick={salveaza} disabled={lucru} style={{ ...S.btnP, opacity: lucru ? 0.6 : 1 }}>
          {lucru ? 'Se salvează…' : `Salvează${schimbate.length || codSchimbat ? ` (${schimbate.length + (codSchimbat ? 1 : 0)})` : ''}`}
        </button>}
      </div>
    </Modal>
  )
}

export function ModalUatNou({ proiect, uats, show, onClose, onGata }) {
  const [nume, setNume] = useState('')
  const [cod, setCod] = useState('')
  const [codAtins, setCodAtins] = useState(false)
  const [judet, setJudet] = useState(uats[0]?.judet || '')
  const [lucru, setLucru] = useState(false)
  const generatie = useRef(0)
  const ocupat = useRef(false)
  useEffect(() => { generatie.current++; return () => { generatie.current++ } }, [proiect.id])
  const codEfectiv = codAtins ? cod : (() => { try { return nume.trim() ? uat3Din(nume) : '' } catch { return '' } })()

  const salveaza = async () => {
    if (lucru || ocupat.current) return
    const n = nume.trim()
    if (!n) { show('Numele UAT-ului e obligatoriu.', 'error'); return }
    if (!/^[A-Z]{3}$/.test(codEfectiv)) { show('Codul UAT: exact 3 litere mari (A–Z).', 'error'); return }
    if (uats.some(x => x.uat3 === codEfectiv)) { show(`Codul ${codEfectiv} e deja folosit în proiect.`, 'error'); return }
    ocupat.current = true
    const token = ++generatie.current
    const curent = () => generatie.current === token
    setLucru(true)
    try {
      const { error } = await supabase.from('red_uat').insert({ proiect_id: proiect.id, nume: n, uat3: codEfectiv, judet: judet.trim() || null })
      if (!curent()) return
      if (error) throw error
      show(`UAT ${n} adăugat.`, 'success')
      onGata()
    } catch (err) { if (curent()) show('UAT nou: ' + msgEroare(err), 'error') }
    finally { if (curent()) { ocupat.current = false; setLucru(false) } }
  }

  return (
    <Modal titlu="UAT nou" onClose={onClose}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 10 }}>
        <Camp eticheta="Nume UAT *"><input value={nume} disabled={lucru} onChange={e => { if (!lucru) setNume(e.target.value) }} style={S.input} autoFocus /></Camp>
        <Camp eticheta="Cod (3 litere)">
          <input value={codEfectiv} disabled={lucru} onChange={e => { if (!lucru) { setCodAtins(true); setCod(e.target.value.toUpperCase().slice(0, 3)) } }} style={{ ...S.input, ...S.mono }} />
        </Camp>
        <Camp eticheta="Județ" span={2}><input value={judet} disabled={lucru} onChange={e => { if (!lucru) setJudet(e.target.value) }} style={S.input} /></Camp>
      </div>
      <div style={{ fontSize: 12, color: G.dim, marginTop: 8 }}>Codul intră în id-ul parcelelor (T3-{codEfectiv || 'XXX'}-0001) și nu se mai schimbă după primul import.</div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
        <button onClick={onClose} style={S.btnS}>Renunț</button>
        <button onClick={salveaza} disabled={lucru} style={{ ...S.btnP, opacity: lucru ? 0.6 : 1 }}>{lucru ? 'Se salvează…' : 'Adaugă'}</button>
      </div>
    </Modal>
  )
}
