// TKT-2026-0329 A (PR-UI, Task 9): „📏 Cantități între documente” — ecranul semnalelor din fișa licitației (decizia (c) a owner-ului: lângă proba
// extractorului). Arată, pe fiecare măsură comparabilă, verdictul serverului (in_regula / diferenta / de_verificat / neverificat, cu motivul),
// ACTUALITATEA lui (sursele schimbate = rezultat istoric, imediat, fără reprocesare — decizia 8), dovezile ambelor părți, legătura la ciorna
// auto_surse_* și setările (prag, plafon) — editabile doar cu drept de decizie (fn_ofertare_source_pack_poate_decide, verificat și pe server).
// Fără buton de pornire: comparația rulează în extragerea structurată existentă (OfertareProbaExtractor). Nimic nu se calculează aici (L19):
// citește fn_ofertare_semnale_lista (paginat prin range până la pagina goală, L23) și afișează. Eroare de citire = mesaj, nu listă goală (L18).
import { useState, useEffect, useRef } from 'react'
import { supabase } from './lib/supabase.js'
import { eticheta, etichetaActualitate, descriereDovada, grupeazaPeMasura, eroareSetari, pragDinProcent, documenteNecitite, sha256Text,
  mesajEroareClarificare, CULORI, incarcaSemnale, eNeactiv } from './ofertareSemnale.js'
export { incarcaSemnale, eNeactiv }

const G = { bg:'#0D1117', surface:'#161B22', card:'#1C2128', border:'#30363D', border2:'#21262D', text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  ofertare:'#3FB6E2', green:'#3FB950', orange:'#F0883E', yellow:'#E3B341', red:'#F85149' }
const S = {
  btn: { padding:'5px 10px', background:G.surface, color:G.text, border:`1px solid ${G.border2}`, borderRadius:7, cursor:'pointer', fontSize:12 },
  btnP: { padding:'6px 12px', background:G.ofertare, color:'#0D1117', border:'none', borderRadius:7, cursor:'pointer', fontSize:12, fontWeight:700 },
  card: { background:G.card, border:`1px solid ${G.border}`, borderRadius:10 },
  inp: { width:70, padding:'5px 8px', background:G.surface, color:G.text, border:`1px solid ${G.border2}`, borderRadius:6, fontSize:12.5 },
  th: { textAlign:'left', padding:'6px 8px', fontSize:11, color:G.dim, textTransform:'uppercase', letterSpacing:.4, borderBottom:`1px solid ${G.border}`, whiteSpace:'nowrap' },
  td: { padding:'7px 8px', fontSize:12.5, borderBottom:`1px solid ${G.border2}`, verticalAlign:'top' },
}
export const MESAJ_NEACTIV = 'Semnalele de cantități nu sunt încă active pe server (migrarea 20270112a neaplicată) — nimic de verificat încă.'
export const MESAJ_EROARE = 'Nu putem verifica semnalele'

const fmtNr = v => (v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toLocaleString('ro-RO', { maximumFractionDigits: 6 }))
const fmtData = d => (d ? new Date(d).toLocaleString('ro-RO', { dateStyle: 'short', timeStyle: 'short' }) : '—')
const naturi = ms => [...new Set((ms || []).map(m => m?.natura).filter(Boolean))].join(' / ') || '—'
const NUME_OBIECT_TOT = 'toată lucrarea'

export default function OfertareSemnale({ licitatie: l, profile, showToast, onDeschideClarificari = null, deschisInitial = false }) {
  const [deschis, setDeschis] = useState(!!deschisInitial)
  const [st, setSt] = useState(null)       // { grupuri, setari, docs, evaluare, poateDecide, necitite }
  const [eroare, setEroare] = useState(null)
  const [busy, setBusy] = useState(false)
  const [prag, setPrag] = useState('')
  const [plafon, setPlafon] = useState('')
  const [reload, setReload] = useState(0)
  const gen = useRef(0)                    // L24: token de generație — doar rezultatul ultimei încărcări pe licitația curentă se aplică
  const toast = (m, t) => { if (typeof showToast === 'function') showToast(m, t) }

  useEffect(() => { gen.current++; setSt(null); setEroare(null); setPrag(''); setPlafon('') }, [l?.id])
  useEffect(() => {
    if (!deschis || !l?.id) return
    const g = ++gen.current, idCerut = l.id
    const aici = () => gen.current === g && idCerut === l.id
    ;(async () => {
      setEroare(null)
      const [lista, setari, docs, ev, drept] = await Promise.all([
        incarcaSemnale(supabase, idCerut),
        supabase.from('ofertare_cantitati_setari').select('prag, plafon_pagini').eq('licitatie_id', idCerut).maybeSingle(),
        supabase.from('ofertare_documente_atribuire').select('id, nume_original, tip, revizie').eq('licitatie_id', idCerut).order('id'),
        supabase.from('ofertare_cantitati_evaluari').select('id, stare, pagini, creat_la, inchisa_la').eq('licitatie_id', idCerut).order('id', { ascending: false }).limit(1).maybeSingle(),
        supabase.rpc('fn_ofertare_source_pack_poate_decide', { p_licitatie_id: idCerut }),
      ])
      if (!aici()) return
      if (lista.error) { setEroare(eNeactiv(lista.error) ? MESAJ_NEACTIV : `${MESAJ_EROARE} (${mesajEroareClarificare(lista.error)}) — nu înseamnă că sunt în regulă.`); return }
      // setările / evaluările lipsă (migrare neaplicată) nu ascund lista; o eroare pe ele se vede ca notă
      const note = []
      if (setari.error && !eNeactiv(setari.error)) note.push(`setările nu s-au citit (${setari.error.message})`)
      if (docs.error) note.push(`numele documentelor nu s-au citit (${docs.error.message})`)
      if (ev.error && !eNeactiv(ev.error)) note.push(`ultima evaluare nu s-a citit (${ev.error.message})`)
      const numeDoc = new Map((docs.data || []).map(d => [Number(d.id), d.nume_original]))
      const imbogateste = m => ({ ...m, document_nume: m?.document_id != null ? numeDoc.get(Number(m.document_id)) || null : null })
      const grupuri = grupeazaPeMasura(lista.data).map(gr => ({ ...gr, a: gr.a.map(imbogateste), b: gr.b.map(imbogateste) }))
      const s = setari.data || null
      setSt({ grupuri, setari: s, docs: docs.data || [], evaluare: ev.data || null, poateDecide: drept.error ? false : drept.data === true, note,
        necitite: documenteNecitite(lista.data, docs.data || []), numeDoc })
      setPrag(s ? String(Number((Number(s.prag) * 100).toFixed(4))).replace('.', ',') : '5')
      setPlafon(s ? String(s.plafon_pagini) : '200')
    })().catch(e => { if (aici()) setEroare(`${MESAJ_EROARE} (${e?.message || e}) — nu înseamnă că sunt în regulă.`) })
  }, [deschis, l?.id, profile?.id, reload])

  const salveazaSetari = async () => {
    const er = eroareSetari(prag, plafon)
    if (er) return toast(er, 'err')
    if (!window.confirm(`Pragul devine ${prag} % și plafonul ${plafon} pagini pentru ${l.nr_anunt}. Toate semnalele acestei licitații devin „rezultat istoric” până la următoarea extragere. Continui?`)) return
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_ofertare_semnale_setari', { p_licitatie_id: l.id, p_prag: pragDinProcent(prag), p_plafon_pagini: Number(plafon) })
    setBusy(false)
    if (error || data?.ok !== true) return toast('Setările au fost refuzate: ' + mesajEroareClarificare(error || { message: 'răspuns neconfirmat' }), 'err')
    toast('✓ Setările au fost salvate — semnalele se recalculează la următoarea extragere.')
    setReload(k => k + 1)
  }
  // decizia omului „nu e sursă cantitativă” pe TOT documentul (sectiune '*'): singurul mod prin care un document fără extragere (ex. al altui lot,
  // fără text) iese din „necitit” și nu mai blochează măsurile (raportul PR-extragere). Pe sha-ul textului de ACUM (ca în fotografie); fără text = sha('').
  const nuESursa = async (doc) => {
    if (!st?.poateDecide || busy) return
    const motiv = window.prompt(`„${doc.nume}” nu e o sursă de cantități pentru această licitație (alt lot, versiune veche, document fără cantități)?\nDocumentul iese din „necitit” și nu mai blochează verdictele. Motivul (minimum 5 caractere):`)
    if (motiv == null) return
    if (motiv.trim().length < 5) return toast('Motivul trebuie să aibă minimum 5 caractere.', 'err')
    setBusy(true)
    try {
      const { data: d, error: eD } = await supabase.from('ofertare_documente_atribuire').select('id, text_extras').eq('id', doc.id).eq('licitatie_id', l.id).maybeSingle()
      if (eD || !d) { toast('Nu am putut citi documentul: ' + (eD?.message || 'lipsă'), 'err'); return }
      const sha = await sha256Text(d.text_extras ?? '')
      const { data, error } = await supabase.rpc('fn_ofertare_cb_decizie', { p_document_id: doc.id, p_doc_sha256: sha, p_rol: 'alt', p_sectiune: '*', p_decizie: 'nu_e_sursa_cantitativa', p_motiv: motiv.trim() })
      if (error || data?.ok !== true) { toast('Decizia a fost refuzată: ' + mesajEroareClarificare(error || { message: 'răspuns neconfirmat' }), 'err'); return }
      toast('✓ Decizia a fost înregistrată — intră în calcul la următoarea extragere.')
      setReload(k => k + 1)
    } catch (e) { toast('Decizia nu a putut fi înregistrată: ' + (e?.message || e), 'err') }
    finally { setBusy(false) }
  }

  const rez = st ? st.grupuri.reduce((a, g) => { a[g.semnal.verdict in a ? g.semnal.verdict : 'altele']++; return a }, { diferenta: 0, de_verificat: 0, neverificat: 0, in_regula: 0, altele: 0 }) : null
  const plafonAtins = st?.evaluare?.pagini?.plafon_atins === true

  return (
    <div style={{ ...S.card, padding:'12px 16px', marginTop:16 }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer' }} onClick={() => setDeschis(d => !d)}>
        <span style={{ fontWeight:800, fontSize:13.5 }}>📏 Cantități între documente (F3 față de ATR / CS / memoriu)</span>
        <span style={{ fontSize:12, color:G.muted }}>verdictul și dovezile le dă serverul la fiecare extragere structurată · nimic nu pleacă singur</span>
        <span style={{ marginLeft:'auto', color:G.muted }}>{deschis ? '▴' : '▾'}</span>
      </div>
      {deschis && <div style={{ marginTop:12, fontSize:12.5 }}>
        {eroare && <div style={{ color: eroare === MESAJ_NEACTIV ? G.yellow : G.red, padding:'8px 10px', background:G.surface, borderRadius:7, borderLeft:`3px solid ${eroare === MESAJ_NEACTIV ? G.yellow : G.red}` }}>⚠ {eroare}</div>}
        {!eroare && !st && <div style={{ color:G.muted }}>Se încarcă…</div>}
        {!eroare && st && <>
          {st.note.map((n, i) => <div key={i} style={{ color:G.yellow, marginBottom:6 }}>⚠ {n}</div>)}
          {/* setările: prag + plafon, doar cu drept de decizie (serverul reverifică) */}
          <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap', marginBottom:10 }}>
            <label style={{ color:G.muted }}>Prag <input aria-label="prag (%)" style={S.inp} value={prag} onChange={e => setPrag(e.target.value)} disabled={!st.poateDecide || busy} /> %</label>
            <label style={{ color:G.muted }}>Plafon <input aria-label="plafon pagini" style={S.inp} value={plafon} onChange={e => setPlafon(e.target.value)} disabled={!st.poateDecide || busy} /> pagini</label>
            <button style={S.btn} disabled={!st.poateDecide || busy} onClick={salveazaSetari} title={st.poateDecide ? 'Salvează pragul și plafonul (fn_ofertare_semnale_setari)' : 'Doar ownerul / responsabilul licitației / adminul Ofertare pot schimba setările'}>Salvează setările</button>
            {!st.setari && <span style={{ color:G.dim }}>(valorile implicite: 5 % și 200 de pagini)</span>}
            {!st.poateDecide && <span style={{ color:G.dim }}>fără drept de decizie pe licitație — doar citire</span>}
          </div>
          {/* ultima evaluare + plafonul */}
          <div style={{ color:G.muted, marginBottom:8 }}>
            {st.evaluare
              ? <>Ultima evaluare: #{st.evaluare.id}, {st.evaluare.stare}, {fmtData(st.evaluare.inchisa_la || st.evaluare.creat_la)}{plafonAtins
                ? <b style={{ color:G.orange }}> · plafonul de pagini a fost atins ({st.evaluare.pagini?.plafon ?? '?'}) — paginile de peste limită sunt „necitite”; ridică plafonul dacă vrei să intre</b>
                : st.evaluare.pagini?.plafon_atins === false ? ' · plafonul de pagini nu a fost atins' : ''}</>
              : 'Nicio evaluare încă — rulează extragerea structurată (🧪 Probă extractor); comparația rulează la finalul ei.'}
          </div>
          {/* documentele necitite: blochează conservator TOATE măsurile (decizia 15); omul le scoate cu „nu e sursă cantitativă” sau reia extragerea */}
          {st.necitite.length > 0 && (
            <div style={{ padding:'8px 10px', background:G.surface, borderRadius:7, borderLeft:`3px solid ${G.orange}`, marginBottom:10 }}>
              <div style={{ fontWeight:700, color:G.orange }}>Documente necitite ({st.necitite.length}) — cât timp există, toate măsurile sunt „neverificat”</div>
              <div style={{ color:G.muted, fontSize:12, marginTop:2 }}>Fie reia extragerea (documentul primește text și extragere), fie decide că documentul nu e o sursă de cantități (alt lot, versiune veche, fără cantități) — și pe documentele fără text.</div>
              {st.necitite.map(doc => (
                <div key={doc.id} style={{ display:'flex', gap:8, alignItems:'center', marginTop:5, flexWrap:'wrap' }}>
                  <span>📄 {doc.nume}</span>
                  <button style={{ ...S.btn, padding:'2px 8px', fontSize:11, color:G.orange, borderColor:G.orange + '66' }} disabled={!st.poateDecide || busy} onClick={() => nuESursa(doc)}
                    title={st.poateDecide ? 'Înregistrează decizia „nu e sursă cantitativă” pe tot documentul (fn_ofertare_cb_decizie); intră în calcul la următoarea extragere' : 'Doar cu drept de decizie pe licitație'}>✗ Nu e sursă cantitativă</button>
                </div>
              ))}
            </div>
          )}
          {/* rezumatul */}
          {rez && st.grupuri.length > 0 && <div style={{ marginBottom:8 }}>
            <b style={{ color:CULORI.rosu }}>{rez.diferenta} diferențe</b> · <b style={{ color:CULORI.portocaliu }}>{rez.de_verificat} de verificat</b> · <b style={{ color:CULORI.gri }}>{rez.neverificat} neverificate</b> · <span style={{ color:CULORI.verde }}>{rez.in_regula} în regulă</span>{rez.altele ? <> · <span style={{ color:CULORI.gri }}>{rez.altele} cu stare necunoscută</span></> : null} · {st.grupuri.length} măsuri
          </div>}
          {st.grupuri.length === 0 && <div style={{ color:G.dim }}>Nicio măsură evaluată încă pentru această licitație (lipsa semnalelor nu înseamnă „verificat în regulă”).</div>}
          {st.grupuri.length > 0 && (
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse' }}>
                <thead><tr>
                  <th style={S.th}>Element</th><th style={S.th}>Natură A / B</th><th style={S.th}>Lot</th><th style={S.th}>Obiect</th>
                  <th style={{ ...S.th, textAlign:'right' }}>A (F3)</th><th style={{ ...S.th, textAlign:'right' }}>B (document)</th><th style={S.th}>Verdict</th><th style={S.th}>Dovezi · ciornă</th>
                </tr></thead>
                <tbody>
                  {st.grupuri.map(g => {
                    const s = g.semnal
                    const et = eticheta(s.verdict, s.motiv)
                    const act = etichetaActualitate(g)
                    const istoric = g.actual !== true && g.in_curs !== true
                    const docB = s.inventar?.document_b
                    const alteB = (Array.isArray(s.valori_b) ? s.valori_b : []).filter(v => v && String(v.document_id) !== String(docB ?? ''))
                    const rezolvare = s.rezolvare && typeof s.rezolvare === 'object' ? s.rezolvare : null
                    return (
                      <tr key={s.id}>
                        <td style={S.td}><b>{s.element}</b><div style={{ color:G.dim, fontSize:11 }}>{s.clasa}{s.um_canonica ? ` · ${s.um_canonica}` : ''}</div></td>
                        <td style={S.td}>{naturi(g.a)} / {naturi(g.b)}</td>
                        <td style={S.td}>{s.lot_nr ?? '—'}</td>
                        <td style={S.td}>{s.obiect_cheie === '*' || !s.obiect_cheie ? <i style={{ color:G.muted }}>{NUME_OBIECT_TOT}</i> : s.obiect_cheie}</td>
                        <td style={{ ...S.td, textAlign:'right', whiteSpace:'nowrap' }}>{fmtNr(s.valoare_a)} {s.valoare_a != null ? s.um_canonica : ''}</td>
                        <td style={{ ...S.td, textAlign:'right', whiteSpace:'nowrap' }}>{fmtNr(s.valoare_b)} {s.valoare_b != null ? s.um_canonica : ''}
                          {alteB.length > 0 && <div style={{ color:G.dim, fontSize:11, whiteSpace:'normal' }}>alte valori: {alteB.map(v => `${st.numeDoc.get(Number(v.document_id)) || `#${v.document_id}`}: ${fmtNr(v.valoare)}`).join('; ')}</div>}
                        </td>
                        <td style={S.td}>
                          <div data-verdict={s.verdict ?? ''} data-semnal={String(s.id)} style={{ fontWeight:700, color: istoric ? CULORI.gri : et.culoare, textDecoration: istoric ? 'line-through' : 'none' }}>{et.text}</div>
                          {act && <div style={{ color: act.culoare, fontSize:11.5, marginTop:2 }}>{act.text}</div>}
                          {s.reaparut_dupa_respingere === true && <div style={{ color:G.orange, fontSize:11.5, marginTop:2 }}>↩ a reapărut după respingere</div>}
                          {rezolvare && (g.rezolvat === true
                            ? <div style={{ color:G.green, fontSize:11.5, marginTop:2 }}>✓ rezolvat prin răspunsul Autorității — valoare reținută {fmtNr(rezolvare.valoare)}</div>
                            : <div style={{ color:G.orange, fontSize:11.5, marginTop:2 }}>⚠ răspuns revizuit / șters — de reconfirmat</div>)}
                        </td>
                        <td style={S.td}>
                          <details>
                            <summary style={{ cursor:'pointer', color:G.muted }}>dovezi: A {g.a.length} · B {g.b.length}</summary>
                            <div style={{ marginTop:4, fontSize:12 }}>
                              <div style={{ color:G.dim, fontSize:11, fontWeight:700 }}>A — pozițiile F3</div>
                              {g.a.length === 0 && <div style={{ color:G.dim }}>nicio poziție F3 pe această măsură</div>}
                              {g.a.map(m => <div key={m.id} style={{ color: m.verificare === 'ok' ? G.text : G.yellow }}>• {descriereDovada(m)}</div>)}
                              <div style={{ color:G.dim, fontSize:11, fontWeight:700, marginTop:4 }}>B — documentele</div>
                              {g.b.length === 0 && <div style={{ color:G.dim }}>nicio observație de document pe această măsură</div>}
                              {g.b.map(m => <div key={m.id} style={{ color: m.verificare === 'ok' ? G.text : G.yellow }}>• {descriereDovada(m)}</div>)}
                            </div>
                          </details>
                          {s.clarificare_id != null && (onDeschideClarificari
                            ? <button style={{ ...S.btn, marginTop:4, padding:'2px 8px', fontSize:11 }} onClick={() => onDeschideClarificari(s.clarificare_id)}>deschide în ❓ Clarificări (ciorna #{s.clarificare_id})</button>
                            : <div style={{ color:G.muted, fontSize:11.5, marginTop:4 }}>ciornă #{s.clarificare_id} — deschide în ❓ Clarificări</div>)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>}
      </div>}
    </div>
  )
}
