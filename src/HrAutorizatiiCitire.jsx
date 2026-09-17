// ===========================================================================
// MODUL HR — Tab „Citire autorizații" (17.09.2026)
// 480 de autorizații în platformă, doar 21 legate de un document; 181 de documente personale
// arată a autorizație și nu sunt legate de nimic. Legarea pe metadate nu merge — potrivirea pe
// numărul documentului dă 13 rezultate și 0 pe autorizațiile fără scan, fiindcă exact alea n-au
// nici număr, nici emitent. Singurul drum e să deschizi documentul: edge fn hr-autorizatie-citeste.
//
// AI-ul NU scrie în hr_autorizatii. Scrie o propunere aici; omul o acceptă, iar abia atunci
// fn_hr_autorizatie_propunere_accepta leagă documentul sau creează autorizația. Motivul e concret:
// pe hr_autorizatii rulează alertele de expirare, deci o autorizație cu date greșite arată în
// regulă și nu mai atrage atenția nimănui.
// ===========================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './lib/supabase.js'

const G = {
  bg:'#0D1117', surface:'#161B22', card:'#161B22', text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  border:'#30363D', border2:'#21262D',
  blue:'#1F6FEB', green:'#2EA043', yellow:'#D29922', orange:'#F0883E', red:'#F85149', purple:'#A371F7',
  hr:'#EC6CB9',
}
const S = {
  card: { background:G.card, borderRadius:12, border:`1px solid ${G.border}` },
  input: { width:'100%', background:G.bg, border:`1px solid ${G.border}`, borderRadius:8, padding:'8px 10px', color:G.text, fontSize:13, outline:'none' },
  btnP: { padding:'8px 14px', background:G.hr, color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:600 },
  btnS: { padding:'7px 12px', background:G.surface, color:G.text, border:`1px solid ${G.border}`, borderRadius:8, cursor:'pointer', fontSize:13 },
}
const th = { padding:'9px 10px', textAlign:'left', fontSize:11, fontWeight:700, color:G.muted, textTransform:'uppercase', letterSpacing:.5, whiteSpace:'nowrap' }
const td = { padding:'9px 10px', verticalAlign:'top', fontSize:12.5 }
const BUCKET = 'documente-personal'
const fmtZi = (d) => d ? new Date(d).toLocaleDateString('ro-RO') : '—'
const MODELE = [['claude-opus-5', 'Opus 5 (~0,07 $/doc)'], ['claude-haiku-4-5', 'Haiku 4.5 (~0,014 $/doc)']]

// Sita STRICTĂ, cea măsurată: descrierea citită la import spune, de regulă, ce e documentul.
// Astea sunt cele ~181 care chiar arată a autorizație.
const PARE_AUTORIZATIE = /(autoriza|atestat|legitima|permis de lucru|ANRE|ISCIR|INSEMEX|RTE|macaragiu|stivuitor|legator|legător|sudor|sudura|sudură|PEHD)/i
// Sita LARGĂ: gălețile în care au aterizat fișierele aduse din Drive cărora nu li s-a putut deduce
// tipul din nume. Aici sunt ~1100 de documente în plus, majoritatea NU sunt autorizații — de-aia
// nu intră implicit: la 0,07 $ bucata, diferența dintre cele două site e ~13 $ față de ~90 $.
// Se pornește deliberat, cu numărul și costul pe ecran.
const TIPURI_LARG = new Set(['cert_calificare', 'neclasificat', 'supliment_calificare', 'alte_doc_personale'])
const eCandidatStrict = (d) => !!d.fisier_path && PARE_AUTORIZATIE.test(d.observatii || '')
const eCandidatLarg = (d) => !!d.fisier_path && (eCandidatStrict(d) || TIPURI_LARG.has(d.tip?.cod))

export default function HrAutorizatiiCitire({ profile, canEdit, showToast }) {
  const [load, setLoad] = useState(true)
  const [docs, setDocs] = useState([])
  const [prop, setProp] = useState([])
  const [legate, setLegate] = useState(new Set())
  const [q, setQ] = useState('')
  const [vedere, setVedere] = useState('propuneri')   // propuneri | necitite | respinse
  const [larg, setLarg] = useState(false)
  // Opus implicit: greseste mai rar pe scanuri proaste, iar o data de expirare gresita intra in
  // alertele de expirare si arata „in regula". Haiku e de 5 ori mai ieftin — de probat pe un lot
  // mic, comparat cu Opus pe aceleasi documente, inainte de a-l pune pe tot.
  const [model, setModel] = useState('claude-opus-5')
  const [toate, setToate] = useState(null)
  const opresc = useRef(false)

  const reload = useCallback(async () => {
    setLoad(true)
    const [dRes, pRes, aRes] = await Promise.all([
      supabase.from('hr_documente_personale')
        .select('id, employee_id, numar_document, emitent, data_emitere, observatii, fisier_path, fisier_mime, tip:hr_documente_personale_tipuri(cod, denumire), emp:employees(name)')
        .eq('activ', true).is('deleted_at', null).order('id').limit(6000),
      supabase.from('hr_autorizatii_propuneri')
        .select('*, doc:hr_documente_personale(id, observatii, fisier_path, tip:hr_documente_personale_tipuri(denumire)), emp:employees(name), aut:hr_autorizatii!hr_autorizatii_propuneri_autorizatie_potrivita_id_fkey(id, numar_autorizatie, tip:hr_autorizatii_tipuri(denumire))')
        .order('id', { ascending: false }).limit(3000),
      supabase.from('hr_autorizatii').select('document_personal_id').is('deleted_at', null).not('document_personal_id', 'is', null).limit(5000),
    ])
    const err = [dRes, pRes, aRes].find(r => r.error)?.error
    if (err) { showToast?.('Eroare la încărcare: ' + err.message, 'error'); setLoad(false); return }
    setDocs(dRes.data || [])
    setProp(pRes.data || [])
    setLegate(new Set((aRes.data || []).map(r => r.document_personal_id)))
    setLoad(false)
  }, [showToast])
  useEffect(() => { reload() }, [reload])

  // Un document cu propunere deschisă sau deja acceptată nu se recitește singur.
  const areDeschisa = useMemo(() => new Set(prop.filter(p => p.status === 'propus').map(p => p.document_id)), [prop])
  const areAcceptata = useMemo(() => new Set(prop.filter(p => p.status === 'acceptat').map(p => p.document_id)), [prop])
  const nedecis = (d) => !legate.has(d.id) && !areDeschisa.has(d.id) && !areAcceptata.has(d.id)
  const necitite = useMemo(
    () => docs.filter(d => (larg ? eCandidatLarg(d) : eCandidatStrict(d)) && nedecis(d)),
    [docs, larg, legate, areDeschisa, areAcceptata])
  // Cât ar aduce în plus sita largă — se arată pe eticheta bifei, ca să nu fie o surpriză de cost.
  const inPlusLarg = useMemo(
    () => docs.filter(d => eCandidatLarg(d) && !eCandidatStrict(d) && nedecis(d)).length,
    [docs, legate, areDeschisa, areAcceptata])

  const potrivesteText = (s) => !q.trim() || String(s || '').toLowerCase().includes(q.trim().toLowerCase())
  const propuneriAfisate = useMemo(() => prop.filter(p =>
    (vedere === 'respinse' ? p.status === 'respins' : p.status === 'propus') &&
    (potrivesteText(p.emp?.name) || potrivesteText(p.tip_cod) || potrivesteText(p.numar_autorizatie) || potrivesteText(p.emitent) || potrivesteText(p.citat))
  ), [prop, vedere, q])
  const necititeAfisate = useMemo(() => necitite.filter(d =>
    potrivesteText(d.emp?.name) || potrivesteText(d.observatii) || potrivesteText(d.tip?.denumire)), [necitite, q])

  const citeste = async (lista) => {
    if (!lista.length) { showToast?.('Nimic de citit', 'warn'); return }
    // 0,07 $/document e media MĂSURATĂ pe Opus, pe primele 25 de citiri reale ale recomandărilor
    // (1,74 $ / 25). Haiku 4.5 costă a cincea parte pe token (1/5 $ vs 5/25 $ pe milion), deci
    // estimarea se scalează la fel — rămâne o estimare până o măsurăm și pe ea.
    const perDoc = model === 'claude-haiku-4-5' ? 0.014 : 0.07
    const cost = (lista.length * perDoc).toFixed(2)
    if (!window.confirm(
      `Citesc cu AI ${lista.length} documente din dosarele de personal, ca să văd care sunt autorizații.\n\n` +
      `Model: ${MODELE.find(m => m[0] === model)?.[1] || model}.\n` +
      `Costă aproximativ ${cost} $ (${perDoc} $ pe document). Merge unul câte unul și poți opri pe parcurs.\n\n` +
      `NIMIC nu intră singur în Autorizații: fiecare citire devine o PROPUNERE pe care o accepți tu, rând cu rând.`)) return
    let ok = 0, erori = 0, aut = 0
    opresc.current = false
    setToate({ facute: 0, din: lista.length })
    for (const d of lista) {
      if (opresc.current) break
      try {
        const { data, error } = await supabase.functions.invoke('hr-autorizatie-citeste', { body: { document_id: d.id, model } })
        if (error || data?.error || data?.eroare) erori++
        else { ok++; if (data.este_autorizatie) aut++ }
      } catch (e) { erori++ }
      setToate(t => t ? { ...t, facute: ok + erori } : t)
    }
    const oprit = opresc.current
    opresc.current = false
    setToate(null)
    await reload()
    showToast?.(`Citite ${ok} din ${lista.length}` + (oprit ? ' (oprit de tine)' : '') +
      ` · ${aut} sunt autorizații` + (erori ? ` · ${erori} cu eroare` : ''), erori ? 'warn' : 'success')
  }

  const accepta = async (p) => {
    const ce = p.actiune === 'leaga'
      ? `LEG documentul de autorizația #${p.autorizatie_potrivita_id} (${p.aut?.tip?.denumire || '?'}) și completez ce lipsește acolo (număr, emitent, date).`
      : `CREEZ o autorizație nouă „${p.tip_cod}" pentru ${p.emp?.name || '?'}, cu scanul acesta atașat.`
    if (!window.confirm(`${ce}\n\nSigur? Se scrie în Autorizații, unde rulează alertele de expirare.`)) return
    const { data, error } = await supabase.rpc('fn_hr_autorizatie_propunere_accepta', { p_id: p.id })
    if (error) { showToast?.('Eroare: ' + error.message, 'error'); return }
    showToast?.(data?.actiune === 'leaga' ? `Legat de autorizația #${data.autorizatie_id}` : `Autorizație nouă #${data?.autorizatie_id}`, 'success')
    await reload()
  }
  const respinge = async (p) => {
    const motiv = window.prompt('De ce respingi propunerea? (rămâne notat)', 'citire greșită')
    if (motiv === null) return
    const { error } = await supabase.from('hr_autorizatii_propuneri')
      .update({ status: 'respins', motiv_respingere: motiv.slice(0, 300), decis_de: profile?.id || null, decis_la: new Date().toISOString() })
      .eq('id', p.id)
    if (error) { showToast?.('Eroare: ' + error.message, 'error'); return }
    await reload()
  }
  const vezi = async (path) => {
    if (!path) return
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300)
    if (error) { showToast?.('Nu pot deschide fișierul: ' + error.message, 'error'); return }
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  const nrPropuse = prop.filter(p => p.status === 'propus').length
  return (
    <div>
      <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap', marginBottom:12 }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="caută persoană, tip, număr, emitent…" style={{ ...S.input, width:320 }} />
        {[['propuneri', `📋 De confirmat (${nrPropuse})`], ['necitite', `📄 Necitite (${necitite.length})`], ['respinse', '🗑 Respinse']].map(([k, l]) => (
          <button key={k} onClick={() => setVedere(k)} style={{ ...S.btnS, ...(vedere === k ? { borderColor:G.hr, color:G.hr, fontWeight:700 } : {}) }}>{l}</button>
        ))}
        <label style={{ fontSize:11.5, color:G.muted, display:'flex', gap:6, alignItems:'center' }}
          title="Adaugă documentele încadrate generic (certificat de calificare, neclasificat, alte documente) — acolo au aterizat fișierele aduse din Drive fără tip. Majoritatea NU sunt autorizații, deci costă mult mai mult.">
          <input type="checkbox" checked={larg} onChange={e => setLarg(e.target.checked)} disabled={!!toate} />
          și cele încadrate generic (+{inPlusLarg})
        </label>
        <span style={{ flex:1 }} />
        {canEdit && !toate && (
          <select value={model} onChange={e => setModel(e.target.value)}
            title="Haiku e de 5 ori mai ieftin, dar citește mai slab scanurile proaste. Probează-l pe câteva documente și compară cu Opus înainte de a-l pune pe tot lotul."
            style={{ ...S.input, width:'auto', padding:'7px 10px', fontSize:12 }}>
            {MODELE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        )}
        {canEdit && (toate
          ? <>
              <span style={{ fontSize:12, color:G.yellow, fontWeight:700 }}>🤖 citesc… {toate.facute}/{toate.din}</span>
              <button onClick={() => { opresc.current = true }} style={{ ...S.btnS, color:G.orange, borderColor:G.orange+'55' }}>Oprește</button>
            </>
          : <button onClick={() => citeste(necititeAfisate)} disabled={!necititeAfisate.length}
              style={{ ...S.btnS, color:G.purple, borderColor:G.purple+'55', fontWeight:600, opacity: necititeAfisate.length ? 1 : .45 }}
              title="AI deschide fiecare document și spune dacă e o autorizație, care anume și cu ce valabilitate. Costă — îți spune câte și cât înainte.">
              🤖 Citește documentele ({necititeAfisate.length})
            </button>)}
      </div>
      <div style={{ fontSize:11.5, color:G.dim, marginBottom:10 }}>
        Documentele din dosarele de personal care <b>arată a autorizație</b>. AI-ul le citește și propune: <b>leagă</b> scanul de o autorizație existentă, ori <b>creează</b> una nouă.
        Nimic nu ajunge în Autorizații fără să apeși tu — acolo rulează alertele de expirare, iar o autorizație cu date greșite arată în regulă și nu mai atrage atenția nimănui.
      </div>

      {load ? <div style={{ color:G.muted, padding:20 }}>Se încarcă…</div> : vedere === 'necitite' ? (
        <div style={{ ...S.card, overflow:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr style={{ borderBottom:`1px solid ${G.border}` }}>
              <th style={th}>Persoană</th><th style={th}>Încadrat ca</th><th style={th}>Ce scrie în descriere</th><th style={th} />
            </tr></thead>
            <tbody>
              {necititeAfisate.slice(0, 400).map(d => (
                <tr key={d.id} style={{ borderBottom:`1px solid ${G.border2}` }}>
                  <td style={td}>{d.emp?.name || '—'}</td>
                  <td style={{ ...td, color:G.muted }}>{d.tip?.denumire || '—'}</td>
                  <td style={{ ...td, color:G.dim }}>{(d.observatii || '').slice(0, 130) || <i>fără descriere</i>}</td>
                  <td style={{ ...td, textAlign:'right', whiteSpace:'nowrap' }}>
                    <button onClick={() => vezi(d.fisier_path)} style={{ ...S.btnS, padding:'3px 9px', fontSize:11 }}>👁 vezi</button>
                    {canEdit && <button onClick={() => citeste([d])} disabled={!!toate} style={{ ...S.btnS, padding:'3px 9px', fontSize:11, marginLeft:6, color:G.purple, borderColor:G.purple+'55' }}>🤖 citește</button>}
                  </td>
                </tr>
              ))}
              {!necititeAfisate.length && <tr><td style={{ ...td, color:G.muted, padding:20 }} colSpan={4}>Nimic necitit aici.</td></tr>}
            </tbody>
          </table>
          {necititeAfisate.length > 400 && <div style={{ padding:10, fontSize:11.5, color:G.dim }}>Se afișează primele 400 din {necititeAfisate.length}. Butonul de citire le ia pe toate cele filtrate.</div>}
        </div>
      ) : (
        <div style={{ display:'grid', gap:8 }}>
          {propuneriAfisate.map(p => (
            <div key={p.id} style={{ ...S.card, padding:'10px 12px', borderLeft:`3px solid ${p.este_autorizatie ? (p.avertisment ? G.orange : G.green) : G.dim}` }}>
              <div style={{ display:'flex', gap:10, alignItems:'flex-start', flexWrap:'wrap' }}>
                <div style={{ flex:1, minWidth:280 }}>
                  <div style={{ fontWeight:700, fontSize:13 }}>
                    {p.emp?.name || '—'}
                    <span style={{ marginLeft:8, fontWeight:400, color:G.muted, fontSize:12 }}>
                      {p.este_autorizatie ? `${p.tip_cod}` : (p.ai_json?.ce_este || 'nu e autorizație')}
                    </span>
                    {p.incredere != null && <span style={{ marginLeft:8, fontSize:11, color: p.incredere >= 60 ? G.dim : G.orange }}>încredere {p.incredere}</span>}
                    {p.model && <span style={{ marginLeft:8, fontSize:10.5, color:G.dim }}>{p.model.replace('claude-', '')}</span>}
                  </div>
                  <div style={{ fontSize:12, color:G.muted, marginTop:3 }}>
                    {[p.numar_autorizatie && `nr. ${p.numar_autorizatie}`, p.emitent, p.data_emitere && `emis ${fmtZi(p.data_emitere)}`,
                      p.data_expirare ? `expiră ${fmtZi(p.data_expirare)}` : (p.fara_expirare ? 'fără expirare' : 'fără dată de expirare'),
                      (p.domenii || []).length ? `domenii: ${p.domenii.join(', ')}` : null,
                      p.procedeu_sudura && `procedeu ${p.procedeu_sudura}`].filter(Boolean).join(' · ') || <i>fără date pe document</i>}
                  </div>
                  {p.citat && <div style={{ fontSize:11.5, color:G.dim, marginTop:4, fontStyle:'italic' }}>„{p.citat}"</div>}
                  {p.avertisment && <div style={{ fontSize:11.5, color:G.orange, marginTop:4 }}>⚠ {p.avertisment}</div>}
                  {p.status === 'respins' && <div style={{ fontSize:11.5, color:G.dim, marginTop:4 }}>respinsă: {p.motiv_respingere || '—'}</div>}
                </div>
                <div style={{ textAlign:'right', whiteSpace:'nowrap' }}>
                  <div style={{ fontSize:11.5, color: p.actiune === 'leaga' ? G.blue : p.actiune === 'creeaza' ? G.green : G.dim, fontWeight:700, marginBottom:6 }}>
                    {p.actiune === 'leaga' ? `→ leagă de #${p.autorizatie_potrivita_id}` : p.actiune === 'creeaza' ? '→ creează autorizație' : '→ nimic de făcut'}
                  </div>
                  <button onClick={() => vezi(p.doc?.fisier_path)} style={{ ...S.btnS, padding:'3px 9px', fontSize:11 }}>👁 scan</button>
                  {canEdit && p.status === 'propus' && p.actiune !== 'nimic' &&
                    <button onClick={() => accepta(p)} style={{ ...S.btnS, padding:'3px 9px', fontSize:11, marginLeft:6, color:G.green, borderColor:G.green+'66', fontWeight:600 }}>✓ acceptă</button>}
                  {canEdit && p.status === 'propus' &&
                    <button onClick={() => respinge(p)} style={{ ...S.btnS, padding:'3px 9px', fontSize:11, marginLeft:6, color:G.red, borderColor:G.red+'55' }}>✕ respinge</button>}
                </div>
              </div>
            </div>
          ))}
          {!propuneriAfisate.length && <div style={{ ...S.card, padding:20, color:G.muted }}>
            {vedere === 'respinse' ? 'Nicio propunere respinsă.' : 'Nicio propunere de confirmat. Pornește citirea din fila „Necitite".'}
          </div>}
        </div>
      )}
    </div>
  )
}
