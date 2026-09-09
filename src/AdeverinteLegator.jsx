// ===========================================================================
// HR — Adeverințe „legător de sarcină"
// Registru continuu (hr_adeverinte_legator, numerotare de la 499 — registrul
// pe hârtie s-a oprit la 498). Textul și antetul reproduc modelul folosit până
// acum în Word (ex. GHERGHESCU AUREL, nr. 498.2).
// Poarta de generare (contract activ + fișă de aptitudini în termen) e în BD:
// hr_verifica_eligibilitate_legator(), expusă prin v_hr_adeverinte_legator_candidati.
// ===========================================================================
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase.js'
import { renderHtmlToPdfBlob, getSemnaturaDataURL } from './Achizitii.jsx'

const G = {
  bg:'#0D1117', surface:'#161B22', card:'#161B22', text:'#E6EDF3', muted:'#8B949E',
  border:'#30363D', blue:'#1F6FEB', green:'#2EA043', yellow:'#D29922', orange:'#F0883E',
  red:'#F85149', hr:'#EC6CB9',
  greenDim:'#0F2A1E', redDim:'#3F1A1F', orangeDim:'#3F2618', blueDim:'#0F1F3F',
}
const S = {
  card: { background:G.card, borderRadius:12, border:`1px solid ${G.border}` },
  input: { width:'100%', background:G.bg, border:`1px solid ${G.border}`, borderRadius:8, padding:'9px 12px', color:G.text, fontSize:13, outline:'none' },
  btnP: { padding:'9px 16px', background:G.hr, color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:600 },
  btnS: { padding:'8px 14px', background:G.surface, color:G.text, border:`1px solid ${G.border}`, borderRadius:8, cursor:'pointer', fontSize:13 },
}
const th = { padding:'10px 12px', textAlign:'left', fontSize:11, fontWeight:700, color:G.muted, textTransform:'uppercase', letterSpacing:.5 }
const td = { padding:'10px 12px', verticalAlign:'middle', fontSize:12.5 }

const BUCKET = 'autorizatii'
const DIRECTOR_EMPLOYEE_ID = 121   // TRUSU RAZVAN MIHAIL
const RSVTI_EMPLOYEE_ID    = 81    // NICA EUGEN — autorizatie RSVTI PL 1628

const fmtRo = d => d ? new Date(d).toLocaleDateString('ro-RO') : '—'
const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))

function Lbl({ children }) {
  return <div style={{fontSize:10, color:G.muted, fontWeight:700, textTransform:'uppercase', letterSpacing:.6, marginBottom:4}}>{children}</div>
}

// ─── Documentul ─────────────────────────────────────────────────────────────
// Randat ca HTML la 794px (A4 la 96dpi) și trecut prin html2canvas → jsPDF,
// ca restul PDF-urilor din platformă. Diacriticele vin din fontul browserului.
function htmlAdeverinta({ numar, nume, d, echipament, dataEmitere, semnDirector, semnRsvti }) {
  const semnBox = (img) => img
    ? `<img src="${img}" style="height:52px;object-fit:contain;margin:4px 0" />`
    : `<div style="height:52px"></div>`
  return `
<div style="font-family:'Times New Roman',Times,serif;color:#000;background:#fff;padding:48px 64px;box-sizing:border-box;width:794px;min-height:1123px;font-size:13px;line-height:1.55">
  <div style="text-align:center;border-bottom:1px solid #000;padding-bottom:8px;margin-bottom:38px;font-size:11.5px;line-height:1.45">
    <div style="font-weight:bold;font-size:13px">S.C. GAZPET INSTAL S.R.L.</div>
    <div>Str. Fluturilor, nr. 34, Mun. Ploiești, jud. Prahova</div>
    <div>RO 22029920; J29/1650/2007</div>
    <div>IBAN: RO25 BTRL RONC RT0T 1801 7E01</div>
    <div>BANCA TRANSILVANIA, Sucursala Ploiești</div>
    <div>Tel/Fax: 0244435005 &nbsp;E-mail: office@gazpet.ro</div>
  </div>

  <div style="text-align:center;font-weight:bold;font-size:19px;letter-spacing:1px;margin-bottom:34px">ADEVERINŢĂ</div>

  <div style="margin-bottom:24px">Nr. ${esc(numar)}</div>

  <div style="text-align:justify;margin-bottom:54px">
    Prin prezenta se adevereşte că domnul(doamna) <b>${esc(nume)}</b>,
    domiciliat/domiciliată în loc.(oraş/sat/comună) ${esc(d.domiciliu)},
    posesor/posesoare al/a cărţii de identitate seria ${esc(d.ci_serie)} nr. ${esc(d.ci_numar)},
    eliberată de ${esc(d.ci_eliberat_de)} la data ${esc(d.ci_eliberat_la)},
    CNP ${esc(d.cnp)} a fost instruit ca <b>LEGĂTOR DE SARCINĂ</b><sup>1)</sup>
    să deservească instalaţia/echipamentul ${esc(echipament)}.
  </div>

  <table style="width:100%;border-collapse:collapse;margin-bottom:34px">
    <tr>
      <td style="width:50%;text-align:center;vertical-align:top;padding:0 10px">
        <div style="font-weight:bold">DIRECTOR</div>
        <div style="font-size:10.5px;font-style:italic">(Numele şi prenumele, semnătura şi ştampila)</div>
        ${semnBox(semnDirector)}
        <div>TRUŞU RĂZVAN</div>
      </td>
      <td style="width:50%;text-align:center;vertical-align:top;padding:0 10px">
        <div style="font-weight:bold">OPERATOR RSVTI</div>
        <div style="font-size:10.5px;font-style:italic">(Numele şi prenumele, semnătura şi ştampila)</div>
        ${semnBox(semnRsvti)}
        <div>NICA EUGEN</div>
      </td>
    </tr>
  </table>

  <div>Eliberată la data de ${esc(dataEmitere)}.</div>
  <div style="margin-top:14px">Valabilă 1 (un) an de la data emiterii.</div>
  <div style="margin-top:34px;font-size:10.5px"><sup>1)</sup> Se înscrie legător de sarcină/manevrant.</div>
</div>`
}

// ─── Modal generare ─────────────────────────────────────────────────────────
// Datele de identificare nu există în employees, deci se completează o dată și
// se refolosesc la reînnoirea de anul viitor (din ultima adeverință a omului).
const GOL = { domiciliu:'', ci_serie:'', ci_numar:'', ci_eliberat_de:'', ci_eliberat_la:'', cnp:'' }

function ModalGenerare({ rand, onClose, onGata, showToast }) {
  const [d, setD] = useState(GOL)
  const [echipament, setEchipament] = useState('TOATE')
  const [incarc, setIncarc] = useState(true)
  const [lucrez, setLucrez] = useState(false)
  const [urmatorul, setUrmatorul] = useState(null)

  useEffect(() => {
    (async () => {
      try {
        const [{ data: ultima }, { data: max }] = await Promise.all([
          supabase.from('hr_adeverinte_legator')
            .select('date_identificare, echipament').eq('employee_id', rand.employee_id)
            .order('numar', { ascending:false }).limit(1).maybeSingle(),
          supabase.from('hr_adeverinte_legator').select('numar').order('numar', { ascending:false }).limit(1).maybeSingle(),
        ])
        if (ultima?.date_identificare) setD({ ...GOL, ...ultima.date_identificare })
        if (ultima?.echipament) setEchipament(ultima.echipament)
        setUrmatorul((max?.numar ?? 498) + 1)
      } finally { setIncarc(false) }
    })()
  }, [rand.employee_id])

  const lipsa = Object.entries(d).filter(([, v]) => !String(v || '').trim()).map(([k]) => k)

  const genereaza = async () => {
    if (lipsa.length) { showToast('Completează toate câmpurile de identificare', 'warn'); return }
    setLucrez(true)
    try {
      // 1. Re-verific eligibilitatea în BD, nu doar în lista încărcată la deschidere
      const { data: elig, error: eErr } = await supabase
        .rpc('hr_verifica_eligibilitate_legator', { p_employee_id: rand.employee_id })
      if (eErr) throw eErr
      const e = Array.isArray(elig) ? elig[0] : elig
      if (!e?.ok) throw new Error(e?.motiv || 'Nu se poate genera')

      // 2. Rândul din registru — numărul vine din secvență, nu din numărătoarea mea
      const azi = new Date()
      const expira = new Date(azi); expira.setFullYear(expira.getFullYear() + 1)
      const { data: { user } } = await supabase.auth.getUser()
      const { data: adev, error: iErr } = await supabase.from('hr_adeverinte_legator').insert({
        employee_id: rand.employee_id,
        autorizatie_id: rand.autorizatie_id,
        data_emitere: azi.toISOString().slice(0,10),
        data_expirare: expira.toISOString().slice(0,10),
        fisa_aptitudini_id: e.fisa_id || null,
        fisa_expira_la: e.fisa_expira_la || null,
        date_identificare: d,
        echipament,
        generat_de: user?.id || null,
      }).select().single()
      if (iErr) throw iErr

      // 3. PDF-ul, cu semnăturile disponibile (lipsa uneia lasă spațiu de semnat)
      const [semnD, semnR] = await Promise.all([
        getSemnaturaDataURL(DIRECTOR_EMPLOYEE_ID),
        getSemnaturaDataURL(RSVTI_EMPLOYEE_ID),
      ])
      const html = htmlAdeverinta({
        numar: adev.numar, nume: rand.angajat_nume, d, echipament,
        dataEmitere: fmtRo(adev.data_emitere), semnDirector: semnD, semnRsvti: semnR,
      })
      const blob = await renderHtmlToPdfBlob(html)
      const nume = `adeverinta_legator_${adev.numar}.pdf`
      const path = `${rand.employee_id}/${nume}`
      const { error: upErr } = await supabase.storage.from(BUCKET)
        .upload(path, blob, { contentType:'application/pdf', upsert:true })
      if (upErr) throw new Error('Upload eșuat: ' + upErr.message)

      await supabase.from('hr_adeverinte_legator').update({
        fisier_path: path, fisier_nume: nume, fisier_size_bytes: blob.size, fisier_mime: 'application/pdf',
        semnatura_director_id: null, semnatura_rsvti_id: null,
      }).eq('id', adev.id)

      // 4. Autorizația veche trece în arhivă (rămâne vizibilă), cea nouă are PDF
      if (rand.autorizatie_id) {
        await supabase.from('hr_autorizatii')
          .update({ deleted_at: new Date().toISOString(), deleted_by: user?.id || null })
          .eq('id', rand.autorizatie_id)
      }
      const { data: tip } = await supabase.from('hr_autorizatii_tipuri').select('id').eq('cod','LEGATOR_SARCINA').single()
      await supabase.from('hr_autorizatii').insert({
        employee_id: rand.employee_id, tip_id: tip.id,
        numar_autorizatie: String(adev.numar), emitent: 'GAZPET INSTAL SRL',
        data_emitere: adev.data_emitere, data_expirare: adev.data_expirare,
        fisier_path: path, fisier_nume: nume, fisier_size_bytes: blob.size, fisier_mime: 'application/pdf',
        observatii: `Adeverință generată din platformă (registru nr. ${adev.numar})`,
        uploadat_de: user?.id || null,
      })

      showToast(`✓ Adeverința nr. ${adev.numar} pentru ${rand.angajat_nume}`)
      onGata()
      onClose()
    } catch (err) {
      showToast(err.message || String(err), 'error')
    } finally { setLucrez(false) }
  }

  const camp = (k, eticheta, ph) => (
    <div style={{marginBottom:12}}>
      <Lbl>{eticheta}</Lbl>
      <input value={d[k]} placeholder={ph} disabled={lucrez}
        onChange={e=>setD(x=>({...x,[k]:e.target.value}))} style={S.input} />
    </div>
  )

  return (
    <div onClick={onClose} style={{position:'fixed', inset:0, background:'rgba(0,0,0,.85)', zIndex:300, display:'flex', alignItems:'center', justifyContent:'center', padding:20}}>
      <div onClick={e=>e.stopPropagation()} style={{...S.card, width:560, maxHeight:'90vh', overflowY:'auto', borderTop:`3px solid ${G.hr}`}}>
        <div style={{padding:'16px 20px', borderBottom:`1px solid ${G.border}`, display:'flex', justifyContent:'space-between', alignItems:'center'}}>
          <div>
            <div style={{fontSize:15, fontWeight:800}}>📄 Adeverință legător de sarcină</div>
            <div style={{fontSize:11, color:G.muted, marginTop:3}}>
              {rand.angajat_nume}{urmatorul ? ` · va primi nr. ${urmatorul}` : ''}
            </div>
          </div>
          <button onClick={onClose} disabled={lucrez} style={{background:'none', border:'none', color:G.muted, cursor:'pointer', fontSize:20}}>×</button>
        </div>
        <div style={{padding:20}}>
          {incarc ? (
            <div style={{textAlign:'center', padding:26, color:G.muted, fontSize:13}}>Se încarcă…</div>
          ) : (
            <>
              <div style={{padding:11, background:G.blueDim, borderLeft:`3px solid ${G.blue}`, borderRadius:6, marginBottom:16, fontSize:11, lineHeight:1.6, color:'#9CC9FF'}}>
                Datele de identificare nu sunt în platformă, deci se completează o singură dată —
                la reînnoirea de anul viitor se preiau automat de aici.
              </div>
              {camp('domiciliu', 'Domiciliu (localitate, județ)', 'COM. ILOVIȚA, SAT BAHNA, JUD. MEHEDINȚI')}
              <div style={{display:'grid', gridTemplateColumns:'1fr 2fr', gap:10}}>
                {camp('ci_serie', 'CI serie', 'MH')}
                {camp('ci_numar', 'CI număr', '600869')}
              </div>
              <div style={{display:'grid', gridTemplateColumns:'2fr 1fr', gap:10}}>
                {camp('ci_eliberat_de', 'Eliberată de', 'SPCLEP ORȘOVA')}
                {camp('ci_eliberat_la', 'La data', '30.07.2019')}
              </div>
              {camp('cnp', 'CNP', '1680818250569')}
              <div style={{marginBottom:16}}>
                <Lbl>Instalația/echipamentul deservit</Lbl>
                <input value={echipament} disabled={lucrez} onChange={e=>setEchipament(e.target.value)} style={S.input} />
              </div>
              <button onClick={genereaza} disabled={lucrez || lipsa.length > 0}
                style={{...S.btnP, width:'100%', opacity:(lucrez || lipsa.length) ? .5 : 1}}>
                {lucrez ? 'Se generează…' : '📄 Generează adeverința'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Tab-ul ─────────────────────────────────────────────────────────────────
export default function AdeverinteLegator({ profile, showToast }) {
  const [rows, setRows] = useState([])
  const [load, setLoad] = useState(true)
  const [q, setQ] = useState('')
  const [doarFaraPdf, setDoarFaraPdf] = useState(false)
  const [genPentru, setGenPentru] = useState(null)
  const [semnaturi, setSemnaturi] = useState({ director:false, rsvti:false })

  const hasAccess = profile?.can_access_personal_data === true || profile?.is_owner === true

  const load_ = useCallback(async () => {
    setLoad(true)
    try {
      const [candRes, semRes] = await Promise.all([
        supabase.from('v_hr_adeverinte_legator_candidati').select('*').order('angajat_nume'),
        supabase.from('hr_semnaturi_electronice').select('employee_id')
          .in('employee_id', [DIRECTOR_EMPLOYEE_ID, RSVTI_EMPLOYEE_ID]).eq('activ', true).is('deleted_at', null),
      ])
      setRows(candRes.data || [])
      const ids = (semRes.data || []).map(x => x.employee_id)
      setSemnaturi({ director: ids.includes(DIRECTOR_EMPLOYEE_ID), rsvti: ids.includes(RSVTI_EMPLOYEE_ID) })
    } catch (e) {
      showToast?.('Eroare încărcare: ' + (e.message || e), 'error')
    } finally { setLoad(false) }
  }, [showToast])

  useEffect(() => { if (hasAccess) load_(); else setLoad(false) }, [hasAccess, load_])

  const vizibile = useMemo(() => {
    let l = rows
    if (q.trim()) l = l.filter(r => (r.angajat_nume || '').toLowerCase().includes(q.trim().toLowerCase()))
    if (doarFaraPdf) l = l.filter(r => !r.are_pdf)
    return l
  }, [rows, q, doarFaraPdf])

  const stats = useMemo(() => ({
    total: rows.length,
    cuPdf: rows.filter(r => r.are_pdf).length,
    blocati: rows.filter(r => !r.poate_genera).length,
  }), [rows])

  const vezi = async (path) => {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 120)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
    else showToast?.('Fișierul nu a putut fi deschis', 'error')
  }

  if (!hasAccess) {
    return (
      <div style={{...S.card, padding:40, textAlign:'center'}}>
        <div style={{fontSize:42, marginBottom:14}}>🔒</div>
        <div style={{fontSize:16, fontWeight:700, color:G.red, marginBottom:8}}>Acces restricționat</div>
        <div style={{fontSize:12, color:G.muted, maxWidth:480, margin:'0 auto', lineHeight:1.6}}>
          Adeverințele conțin date personale. Necesită bifa <strong style={{color:G.text}}>„Acces Date Personale"</strong> pe profil.
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Fără ambele semnături, PDF-ul iese cu spațiu gol de semnat olograf */}
      {(!semnaturi.director || !semnaturi.rsvti) && (
        <div style={{...S.card, padding:'12px 16px', marginBottom:14, borderLeft:`3px solid ${G.orange}`, background:G.orangeDim, fontSize:12, lineHeight:1.6, color:'#FFC494'}}>
          ⚠ Lipsește semnătura {[!semnaturi.director && 'directorului', !semnaturi.rsvti && 'operatorului RSVTI (Nica Eugen)'].filter(Boolean).join(' și a ')}.
          Adeverințele se generează, dar cu spațiu gol în locul ei — trebuie semnate de mână.
          Semnătura se înregistrează din butonul 🖋️ din dreapta sus.
        </div>
      )}

      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(170px, 1fr))', gap:12, marginBottom:16}}>
        {[
          { l:'👥 Legători activi', v:stats.total, c:G.text },
          { l:'✓ Cu adeverință PDF', v:stats.cuPdf, c:G.green },
          { l:'⚠ Fără PDF', v:stats.total - stats.cuPdf, c:stats.total - stats.cuPdf > 0 ? G.orange : G.green },
          { l:'⛔ Blocați', v:stats.blocati, c:stats.blocati > 0 ? G.red : G.green },
        ].map(x => (
          <div key={x.l} style={{...S.card, padding:'14px 16px'}}>
            <div style={{fontSize:10, color:G.muted, fontWeight:700, textTransform:'uppercase', letterSpacing:.5, marginBottom:4}}>{x.l}</div>
            <div style={{fontSize:24, fontWeight:800, color:x.c}}>{x.v}</div>
          </div>
        ))}
      </div>

      <div style={{display:'flex', gap:10, marginBottom:14, flexWrap:'wrap', alignItems:'center'}}>
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Caută după nume…" style={{...S.input, width:260}} />
        <button onClick={()=>setDoarFaraPdf(v=>!v)}
          style={{...S.btnS, background: doarFaraPdf ? G.orange+'22' : G.surface, color: doarFaraPdf ? G.orange : G.text}}>
          {doarFaraPdf ? '✓ ' : ''}Doar fără PDF
        </button>
        <button onClick={load_} style={S.btnS}>↻ Reîncarcă</button>
      </div>

      <div style={{...S.card, overflow:'hidden'}}>
        {load ? (
          <div style={{padding:30, textAlign:'center', color:G.muted, fontSize:13}}>Se încarcă…</div>
        ) : !vizibile.length ? (
          <div style={{padding:30, textAlign:'center', color:G.muted, fontSize:13}}>Niciun rezultat</div>
        ) : (
          <table style={{width:'100%', borderCollapse:'collapse'}}>
            <thead><tr style={{background:G.bg}}>
              <th style={th}>Angajat</th><th style={th}>Valabilă până</th>
              <th style={th}>Ultima adeverință</th><th style={th}>Stare</th><th style={th}></th>
            </tr></thead>
            <tbody>
              {vizibile.map(r => (
                <tr key={r.employee_id} style={{borderTop:`1px solid ${G.border}`}}>
                  <td style={{...td, fontWeight:600}}>
                    {r.angajat_nume}
                    <div style={{fontSize:10.5, color:G.muted, fontWeight:400}}>{r.functie || '—'}</div>
                  </td>
                  <td style={td}>{fmtRo(r.autorizatie_expira)}</td>
                  <td style={td}>
                    {r.ultima_adeverinta_numar
                      ? <>nr. {r.ultima_adeverinta_numar} <span style={{color:G.muted, fontSize:11}}>· {fmtRo(r.ultima_adeverinta_emisa)}</span></>
                      : <span style={{color:G.muted}}>—</span>}
                  </td>
                  <td style={td}>
                    {!r.poate_genera
                      ? <span style={{color:G.red, fontSize:11.5}} title={r.motiv_blocare}>⛔ {r.motiv_blocare}</span>
                      : r.are_pdf
                        ? <span style={{color:G.green, fontSize:11.5}}>✓ are PDF</span>
                        : <span style={{color:G.orange, fontSize:11.5}}>fără PDF</span>}
                  </td>
                  <td style={{...td, textAlign:'right', whiteSpace:'nowrap'}}>
                    {r.are_pdf && (
                      <button onClick={()=>vezi(r.dovada_path || `${r.employee_id}/adeverinta_legator_${r.ultima_adeverinta_numar}.pdf`)}
                        style={{...S.btnS, padding:'5px 10px', marginRight:6}} title="Vezi PDF-ul">📄</button>
                    )}
                    <button onClick={()=>setGenPentru(r)} disabled={!r.poate_genera}
                      style={{...S.btnS, padding:'5px 12px', opacity:r.poate_genera?1:.4, cursor:r.poate_genera?'pointer':'not-allowed',
                        color:r.poate_genera?G.hr:G.muted, borderColor:r.poate_genera?G.hr+'55':G.border}}
                      title={r.poate_genera ? 'Generează adeverința' : r.motiv_blocare}>
                      {r.ultima_adeverinta_numar ? 'Reînnoiește' : 'Generează'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {genPentru && (
        <ModalGenerare rand={genPentru} onClose={()=>setGenPentru(null)} onGata={load_} showToast={showToast} />
      )}
    </div>
  )
}
