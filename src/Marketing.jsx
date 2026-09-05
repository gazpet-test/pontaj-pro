// ════════════════════════════════════════════════════════════════
// Marketing.jsx — postări pe pagina Facebook Gazpet Instal din rapoartele de șantier
// Flux (decizie Răzvan 04.09.2026): ciornă (poze din raport zilnic + text AI) → aprobată
// (Răzvan / Mari / Cristiana = marketing_aprobatori) → publicată (edge fn meta-publish).
// Nimic nu pleacă singur: postarea are întotdeauna un om care apasă „Publică".
// Șantierele se marchează „postabil" o dată (owner), cu descriere publică + restricții.
// Profilul personal „Gazpet Instal" nu e postabil prin API → butonul „Distribuie" deschide
// postarea de pe pagină ca s-o dai mai departe manual.
// ════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from './lib/supabase.js'

const G = {
  bg:'#0D1117', surface:'#161B22', card:'#1C2128', border:'#30363D', border2:'#21262D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  accent:'#1877F2', green:'#3FB950', blue:'#58A6FF', orange:'#F0883E', yellow:'#E3B341', red:'#F85149', purple:'#A371F7',
}
const S = {
  input: { boxSizing:'border-box', background:G.bg, border:`1px solid ${G.border2}`, borderRadius:6, padding:'6px 9px', color:G.text, fontSize:12.5, outline:'none', width:'100%' },
  btnP: { padding:'8px 16px', background:G.accent, color:'#fff', border:'none', borderRadius:7, cursor:'pointer', fontSize:13, fontWeight:700 },
  btnS: { padding:'7px 13px', background:G.surface, color:G.text, border:`1px solid ${G.border2}`, borderRadius:7, cursor:'pointer', fontSize:12.5 },
  card: { background:G.card, border:`1px solid ${G.border}`, borderRadius:10 },
}
const BUCKET = 'rapoarte-zilnice'
const STATUS = {
  ciorna:    { l:'Ciornă',     c:G.yellow },
  aprobata:  { l:'Aprobată',   c:G.blue },
  publicata: { l:'Publicată',  c:G.green },
  eroare:    { l:'Eroare',     c:G.red },
  anulata:   { l:'Anulată',    c:G.dim },
}
const fmtD = (d) => d ? new Date(d).toLocaleDateString('ro-RO', { day:'2-digit', month:'2-digit', year:'numeric' }) : ''
const fmtDT = (d) => d ? new Date(d).toLocaleString('ro-RO', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : ''

export default function Marketing() {
  const [profile, setProfile] = useState(null)
  const [aprobatori, setAprobatori] = useState([])
  const [profiles, setProfiles] = useState([])
  const [sites, setSites] = useState([])
  const [mk, setMk] = useState({})            // site_id → marketing_santiere
  const [postari, setPostari] = useState([])
  const [status, setStatus] = useState(null)  // răspunsul meta-publish/status
  const [tab, setTab] = useState('postari')
  const [nou, setNou] = useState(null)        // panoul de ciornă nouă
  const [edit, setEdit] = useState(null)      // {id, text}
  const [thumbs, setThumbs] = useState({})    // path → signed url
  const [busy, setBusy] = useState(null)
  const [toast, setToast] = useState(null)
  const showToast = (msg, tip = 'ok') => { setToast({ msg, tip }); setTimeout(() => setToast(null), 5000) }

  const poateAproba = !!profile?.is_owner || aprobatori.includes(profile?.id)
  const numeProfil = (id) => profiles.find(p => p.id === id)?.name || '—'

  const load = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    const [{ data: prof }, { data: apr }, { data: prs }, { data: st }, { data: m }, { data: ps }] = await Promise.all([
      user ? supabase.from('profiles').select('id, name, is_owner').eq('id', user.id).maybeSingle() : { data: null },
      supabase.from('marketing_aprobatori').select('profile_id'),
      supabase.from('profiles').select('id, name'),
      supabase.from('sites').select('id, name, beneficiar_principal, tip_locatie, active').order('name'),
      supabase.from('marketing_santiere').select('*'),
      supabase.from('marketing_postari').select('*').order('created_at', { ascending: false }).limit(100),
    ])
    setProfile(prof); setAprobatori((apr || []).map(a => a.profile_id)); setProfiles(prs || [])
    setSites((st || []).filter(s => s.active !== false))
    const map = {}; (m || []).forEach(x => { map[x.site_id] = x }); setMk(map)
    setPostari(ps || [])
    // thumbnails pentru pozele postărilor
    const paths = [...new Set((ps || []).flatMap(p => p.poze || []))]
    if (paths.length) {
      const { data } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600)
      const t = {}; (data || []).forEach(d => { if (d.signedUrl) t[d.path] = d.signedUrl }); setThumbs(x => ({ ...x, ...t }))
    }
  }
  useEffect(() => { load() }, [])
  useEffect(() => {
    supabase.functions.invoke('meta-publish', { body: { actiune: 'status' } })
      .then(({ data, error }) => setStatus(error ? { error: error.message } : (data?.error ? { error: data.error } : data)))
  }, [])

  const siteNume = (id) => sites.find(s => s.id === id)?.name || `site ${id}`
  const postabile = useMemo(() => sites.filter(s => mk[s.id]?.postabil), [sites, mk])

  // ── Șantiere postabile ──
  const setMkField = (siteId, k, v) => setMk(m => ({ ...m, [siteId]: { ...(m[siteId] || { site_id: siteId, postabil: false }), [k]: v, _dirty: true } }))
  const salveazaMk = async (siteId) => {
    const row = mk[siteId]; if (!row) return
    const { _dirty, ...payload } = row
    const { error } = await supabase.from('marketing_santiere').upsert({ ...payload, site_id: siteId, updated_at: new Date().toISOString(), updated_by: profile?.id || null }, { onConflict: 'site_id' })
    if (error) { showToast('Eroare: ' + error.message, 'err'); return }
    setMk(m => ({ ...m, [siteId]: { ...m[siteId], _dirty: false } })); showToast('Salvat.')
  }

  // ── Ciornă nouă ──
  const deschideNou = async (siteId) => {
    setNou({ site_id: siteId || postabile[0]?.id || null, rapoarte: [], pozeAlese: [], rapAlese: [], indicatii: '' })
    if (siteId || postabile[0]?.id) await incarcaRapoarte(siteId || postabile[0].id)
  }
  const incarcaRapoarte = async (siteId) => {
    const de = new Date(); de.setDate(de.getDate() - 21)
    const { data } = await supabase.from('rapoarte_zilnice').select('id, data, sef_santier, lucrari_efectuate, poze')
      .eq('site_id', siteId).gte('data', de.toISOString().slice(0, 10)).order('data', { ascending: false })
    const rap = data || []
    setNou(n => ({ ...n, site_id: siteId, rapoarte: rap, pozeAlese: [], rapAlese: rap.slice(0, 5).map(r => r.id) }))
    const paths = rap.flatMap(r => r.poze || []).filter(p => !thumbs[p])
    if (paths.length) {
      const { data: su } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600)
      const t = {}; (su || []).forEach(d => { if (d.signedUrl) t[d.path] = d.signedUrl }); setThumbs(x => ({ ...x, ...t }))
    }
  }
  const togglePoza = (p) => setNou(n => ({ ...n, pozeAlese: n.pozeAlese.includes(p) ? n.pozeAlese.filter(x => x !== p) : (n.pozeAlese.length >= 10 ? n.pozeAlese : [...n.pozeAlese, p]) }))
  const toggleRap = (id) => setNou(n => ({ ...n, rapAlese: n.rapAlese.includes(id) ? n.rapAlese.filter(x => x !== id) : [...n.rapAlese, id] }))

  const creeazaCiorna = async (cuAI) => {
    if (!nou?.site_id) return
    setBusy('Se creează ciorna...')
    const { data: ins, error } = await supabase.from('marketing_postari').insert({
      site_id: nou.site_id, raport_ids: nou.rapAlese, poze: nou.pozeAlese, text_postare: '', creat_de: profile?.id || null,
    }).select('id').single()
    if (error) { showToast('Eroare: ' + error.message, 'err'); setBusy(null); return }
    if (cuAI) {
      setBusy('AI scrie textul...')
      const { data, error: e2 } = await supabase.functions.invoke('meta-publish', { body: { actiune: 'genereaza', postare_id: ins.id, indicatii: nou.indicatii } })
      if (e2 || data?.error) showToast('Ciorna e creată, dar AI a dat eroare: ' + (e2?.message || data?.error), 'err')
    }
    setBusy(null); setNou(null); await load()
    setEdit({ id: ins.id, text: '' })
    showToast('Ciornă creată. Citește textul, ajustează, apoi Aprobă.')
  }

  // ── Acțiuni pe postare ──
  const upd = async (id, payload) => {
    const { error } = await supabase.from('marketing_postari').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) { showToast('Eroare: ' + error.message, 'err'); return false }
    await load(); return true
  }
  const regenereaza = async (p, indicatii) => {
    setBusy('AI rescrie textul...')
    const { data, error } = await supabase.functions.invoke('meta-publish', { body: { actiune: 'genereaza', postare_id: p.id, indicatii } })
    setBusy(null)
    if (error || data?.error) { showToast('Eroare AI: ' + (error?.message || data?.error), 'err'); return }
    setEdit({ id: p.id, text: data.text }); await load()
  }
  const publica = async (p) => {
    if (!window.confirm(`Publici ACUM pe pagina de Facebook postarea pentru „${siteNume(p.site_id)}" (${(p.poze || []).length} poze)?`)) return
    setBusy('Se publică pe Facebook...')
    const { data, error } = await supabase.functions.invoke('meta-publish', { body: { actiune: 'publica', postare_id: p.id } })
    setBusy(null)
    if (error || data?.error) { showToast('Publicarea a eșuat: ' + (error?.message || data?.error), 'err'); await load(); return }
    showToast(`Publicat! ${data.poze} poze. ${data.permalink ? 'Link salvat.' : ''}`); await load()
  }

  if (!profile) return <div style={{ background:G.bg, minHeight:'100vh', color:G.muted, padding:40 }}>Se încarcă...</div>
  const lbl = { fontSize:11, color:G.muted, display:'block', marginBottom:3 }

  return (
    <div style={{ background:G.bg, minHeight:'100vh', color:G.text, padding:'20px 24px', fontFamily:'system-ui, sans-serif' }}>
      {toast && <div style={{ position:'fixed', top:16, right:20, zIndex:2000, padding:'11px 18px', borderRadius:9, fontSize:13, fontWeight:600, background: toast.tip === 'err' ? G.red : G.green, color:'#0D1117', maxWidth:520 }}>{toast.msg}</div>}
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:6, flexWrap:'wrap' }}>
        <Link to="/" style={{ color:G.muted, textDecoration:'none', fontSize:13 }}>← înapoi</Link>
        <div style={{ fontSize:19, fontWeight:800 }}>📣 Marketing</div>
        <span style={{ fontSize:12.5, color:G.muted }}>Postări pe Facebook din rapoartele de șantier · o postare pe săptămână pe șantier · nimic nu pleacă fără aprobare</span>
        {busy && <span style={{ marginLeft:'auto', fontSize:12.5, color:G.accent, fontWeight:700 }}>{busy}</span>}
      </div>
      {/* Starea legăturii cu Meta */}
      <div style={{ ...S.card, padding:'8px 14px', marginBottom:14, display:'flex', gap:16, alignItems:'center', fontSize:12.5, flexWrap:'wrap' }}>
        {!status ? <span style={{ color:G.dim }}>Verific legătura cu Facebook...</span>
          : status.error ? <span style={{ color:G.red }}>Facebook: {status.error}</span>
          : <>
            <span style={{ color:G.green, fontWeight:700 }}>● Facebook conectat</span>
            <span>Pagina <b>{status.pagina?.name}</b> · {status.pagina?.followers_count ?? '—'} urmăritori</span>
            <span style={{ color: status.pagina?.instagram_business_account ? G.green : G.dim }}>Instagram: {status.pagina?.instagram_business_account ? '@' + status.pagina.instagram_business_account.username : 'nelegat'}</span>
            <span style={{ color:G.muted }}>Tu: {status.user} · {poateAproba ? 'poți aproba și publica' : 'poți pregăti ciorne'}</span>
          </>}
      </div>

      <div style={{ display:'flex', gap:6, marginBottom:14 }}>
        {[['postari', '📝 Postări'], ['santiere', '🏗️ Șantiere postabile']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{ ...S.btnS, background: tab === k ? G.accent : G.surface, color: tab === k ? '#fff' : G.text, fontWeight:700 }}>{l}</button>
        ))}
        {tab === 'postari' && <button style={{ ...S.btnP, marginLeft:'auto', opacity: postabile.length ? 1 : .5 }} disabled={!postabile.length} onClick={() => deschideNou()} title={postabile.length ? '' : 'Marchează întâi un șantier ca postabil'}>＋ Ciornă nouă</button>}
      </div>

      {/* ── Tab: șantiere ── */}
      {tab === 'santiere' && (
        <div style={{ display:'grid', gap:10 }}>
          <div style={{ fontSize:12, color:G.dim }}>Doar șantierele bifate „postabil" apar la ciorne. Descrierea publică e ce are voie AI-ul să spună (fără valori, clauze, nume). Restricțiile sunt pentru cine alege pozele.</div>
          {sites.filter(s => !/sediu|parc auto/i.test(s.name)).map(s => {
            const r = mk[s.id] || {}
            return (
              <div key={s.id} style={{ ...S.card, padding:12, display:'grid', gridTemplateColumns:'auto 1.2fr 1fr 1fr auto', gap:10, alignItems:'start', opacity: r.postabil ? 1 : .75 }}>
                <label style={{ display:'flex', gap:8, alignItems:'center', minWidth:260, fontSize:13, fontWeight:700, paddingTop:4 }}>
                  <input type="checkbox" checked={!!r.postabil} disabled={!profile.is_owner} onChange={e => setMkField(s.id, 'postabil', e.target.checked)} style={{ accentColor:G.green, width:16, height:16 }} />
                  <span>{s.name}<div style={{ fontSize:11, color:G.dim, fontWeight:400 }}>{s.beneficiar_principal || ''}</div></span>
                </label>
                <label><span style={lbl}>Descriere publică</span><textarea style={{ ...S.input, minHeight:54 }} value={r.descriere_publica || ''} onChange={e => setMkField(s.id, 'descriere_publica', e.target.value)} placeholder="ex: rețea de distribuție gaze naturale în Valchid și Prod, comuna Hoghilag, pentru primăria comunei" /></label>
                <label><span style={lbl}>Hashtag-uri</span><input style={S.input} value={r.hashtaguri || ''} onChange={e => setMkField(s.id, 'hashtaguri', e.target.value)} placeholder="#GazpetInstal #gazenaturale #Hoghilag" /></label>
                <label><span style={lbl}>Restricții poze/text</span><textarea style={{ ...S.input, minHeight:54 }} value={r.restrictii || ''} onChange={e => setMkField(s.id, 'restrictii', e.target.value)} placeholder="ex: fără poze cu stația, fără fețe, fără plăcuțe" /></label>
                <button style={{ ...S.btnS, opacity: r._dirty ? 1 : .4, marginTop:14 }} disabled={!r._dirty} onClick={() => salveazaMk(s.id)}>💾</button>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Panou: ciornă nouă ── */}
      {tab === 'postari' && nou && (
        <div style={{ ...S.card, padding:14, marginBottom:14, borderColor:G.accent }}>
          <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap', marginBottom:10 }}>
            <b>Ciornă nouă</b>
            <select style={{ ...S.input, width:360 }} value={nou.site_id || ''} onChange={e => incarcaRapoarte(Number(e.target.value))}>
              {postabile.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <span style={{ fontSize:12, color:G.muted }}>{nou.rapoarte.length} rapoarte în ultimele 21 zile · {nou.pozeAlese.length}/10 poze alese</span>
            <button style={{ ...S.btnS, marginLeft:'auto' }} onClick={() => setNou(null)}>✕</button>
          </div>
          {!nou.rapoarte.length && <div style={{ color:G.dim, fontSize:12.5 }}>Niciun raport zilnic în ultimele 3 săptămâni pe șantierul ăsta.</div>}
          {nou.rapoarte.map(r => (
            <div key={r.id} style={{ borderTop:`1px solid ${G.border2}`, padding:'8px 0' }}>
              <label style={{ display:'flex', gap:8, alignItems:'center', fontSize:12.5 }}>
                <input type="checkbox" checked={nou.rapAlese.includes(r.id)} onChange={() => toggleRap(r.id)} style={{ accentColor:G.accent }} />
                <b>{fmtD(r.data)}</b><span style={{ color:G.muted }}>{r.sef_santier}</span>
                <span style={{ color:G.dim, whiteSpace:'pre-wrap', fontSize:11.5 }} title={r.lucrari_efectuate || ''}>{(r.lucrari_efectuate || '(fără text)').replace(/\n/g, ' · ').slice(0, 160)}</span>
              </label>
              {!!(r.poze || []).length && (
                <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginTop:6, marginLeft:24 }}>
                  {(r.poze || []).map(p => (
                    <div key={p} onClick={() => togglePoza(p)} style={{ width:96, height:72, borderRadius:6, overflow:'hidden', cursor:'pointer', border:`3px solid ${nou.pozeAlese.includes(p) ? G.green : 'transparent'}`, background:G.bg, position:'relative' }}>
                      {thumbs[p] ? <img src={thumbs[p]} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} /> : <div style={{ color:G.dim, fontSize:10, padding:4 }}>…</div>}
                      {nou.pozeAlese.includes(p) && <span style={{ position:'absolute', top:2, left:4, color:G.green, fontWeight:800, fontSize:12 }}>{nou.pozeAlese.indexOf(p) + 1}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          <div style={{ display:'flex', gap:10, alignItems:'center', marginTop:10, flexWrap:'wrap' }}>
            <input style={{ ...S.input, flex:1, minWidth:280 }} value={nou.indicatii} onChange={e => setNou(n => ({ ...n, indicatii: e.target.value }))} placeholder="indicații pentru AI (opțional): ex. accent pe probele de presiune, ton mai scurt" />
            <button style={{ ...S.btnP, opacity: nou.pozeAlese.length && !busy ? 1 : .5 }} disabled={!nou.pozeAlese.length || !!busy} onClick={() => creeazaCiorna(true)}>🤖 Creează ciornă cu text AI</button>
            <button style={S.btnS} disabled={!nou.pozeAlese.length || !!busy} onClick={() => creeazaCiorna(false)}>Creează goală (scriu eu)</button>
          </div>
        </div>
      )}

      {/* ── Tab: postări ── */}
      {tab === 'postari' && (
        <div style={{ display:'grid', gap:12 }}>
          {!postari.length && !nou && <div style={{ ...S.card, padding:24, color:G.dim, textAlign:'center' }}>Nicio postare încă. Marchează un șantier postabil, apoi „＋ Ciornă nouă".</div>}
          {postari.map(p => {
            const st = STATUS[p.status] || { l: p.status, c: G.dim }
            const inEdit = edit?.id === p.id
            return (
              <div key={p.id} style={{ ...S.card, padding:14, display:'grid', gridTemplateColumns:'minmax(300px, 1fr) minmax(260px, 420px)', gap:16 }}>
                <div>
                  <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap', marginBottom:6 }}>
                    <span style={{ padding:'2px 9px', borderRadius:12, background: st.c + '22', color: st.c, fontWeight:700, fontSize:11.5 }}>{st.l}</span>
                    <b style={{ fontSize:13.5 }}>{siteNume(p.site_id)}</b>
                    <span style={{ fontSize:11.5, color:G.dim }}>#{p.id} · creată {fmtDT(p.created_at)} de {numeProfil(p.creat_de)}{p.ai_generat ? ' · text AI' : ''}</span>
                  </div>
                  {inEdit ? (
                    <textarea style={{ ...S.input, minHeight:170, fontSize:13, lineHeight:1.45 }} value={edit.text} onChange={e => setEdit({ id: p.id, text: e.target.value })} />
                  ) : (
                    <div style={{ whiteSpace:'pre-wrap', fontSize:13, lineHeight:1.45, color: p.text_postare ? G.text : G.dim }}>{p.text_postare || '(fără text încă)'}</div>
                  )}
                  {p.eroare && <div style={{ color:G.red, fontSize:12, marginTop:6 }}>Eroare: {p.eroare}</div>}
                  {p.text_distribuire && <div style={{ fontSize:12, marginTop:8, padding:'6px 9px', background:G.surface, borderRadius:6, color:G.muted }}><b style={{ color:G.text }}>Text pentru distribuirea de pe profilul vechi:</b> {p.text_distribuire}</div>}
                  {p.fb_permalink && <div style={{ fontSize:12, marginTop:6 }}><a href={p.fb_permalink} target="_blank" rel="noreferrer" style={{ color:G.blue }}>Vezi postarea pe Facebook ↗</a> · publicată {fmtDT(p.publicat_la)} de {numeProfil(p.publicat_de)}</div>}
                  <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:10 }}>
                    {(p.status === 'ciorna' || p.status === 'eroare') && !inEdit && <button style={S.btnS} onClick={() => setEdit({ id: p.id, text: p.text_postare || '' })}>✏️ Editează</button>}
                    {inEdit && <button style={S.btnP} onClick={async () => { if (await upd(p.id, { text_postare: edit.text })) setEdit(null) }}>💾 Salvează textul</button>}
                    {inEdit && <button style={S.btnS} onClick={() => setEdit(null)}>Renunță</button>}
                    {(p.status === 'ciorna' || p.status === 'eroare') && <button style={S.btnS} disabled={!!busy} onClick={() => { const ind = window.prompt('Indicații pentru AI (opțional):', '') ; if (ind !== null) regenereaza(p, ind) }}>🤖 Rescrie cu AI</button>}
                    {p.status === 'ciorna' && poateAproba && !inEdit && <button style={{ ...S.btnS, color:G.blue, borderColor:G.blue + '66' }} disabled={!(p.text_postare || '').trim()} onClick={() => upd(p.id, { status: 'aprobata', aprobat_de: profile.id, aprobat_la: new Date().toISOString() })}>✔ Aprobă</button>}
                    {p.status === 'aprobata' && poateAproba && <button style={{ ...S.btnP, background:G.green, color:'#0D1117' }} disabled={!!busy} onClick={() => publica(p)}>📣 Publică pe Facebook</button>}
                    {p.status === 'aprobata' && <button style={S.btnS} onClick={() => upd(p.id, { status: 'ciorna' })}>↩ Înapoi în ciornă</button>}
                    {p.status === 'eroare' && poateAproba && <button style={S.btnS} onClick={() => upd(p.id, { status: 'aprobata', eroare: null })}>🔁 Reîncearcă (re-aprobă)</button>}
                    {p.status === 'publicata' && p.fb_permalink && <a href={p.fb_permalink} target="_blank" rel="noreferrer" style={{ ...S.btnS, textDecoration:'none', color:G.text }}>↗ Distribuie de pe profil</a>}
                    {p.status === 'publicata' && p.text_distribuire && <button style={S.btnS} title={p.text_distribuire} onClick={() => { navigator.clipboard?.writeText(p.text_distribuire); showToast('Textul pentru profil e copiat — lipește-l la distribuire.') }}>📋 Copiază textul pentru profil</button>}
                    {(p.status === 'ciorna' || p.status === 'eroare') && <button style={{ ...S.btnS, color:G.red, marginLeft:'auto' }} onClick={() => { if (window.confirm('Anulezi ciorna?')) upd(p.id, { status: 'anulata' }) }}>✕ Anulează</button>}
                  </div>
                </div>
                {/* previzualizare tip Facebook */}
                <div style={{ background:'#fff', color:'#050505', borderRadius:8, overflow:'hidden', fontFamily:'Segoe UI, Helvetica, Arial, sans-serif', alignSelf:'start' }}>
                  <div style={{ padding:'10px 12px', display:'flex', gap:8, alignItems:'center' }}>
                    <div style={{ width:36, height:36, borderRadius:18, background:'#1877F2', color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800 }}>G</div>
                    <div><div style={{ fontWeight:600, fontSize:14 }}>Gazpet Instal</div><div style={{ fontSize:11, color:'#65676B' }}>{p.publicat_la ? fmtDT(p.publicat_la) : 'previzualizare'} · 🌐</div></div>
                  </div>
                  <div style={{ padding:'0 12px 10px', fontSize:13.5, whiteSpace:'pre-wrap', lineHeight:1.35 }}>{(inEdit ? edit.text : p.text_postare) || ' '}</div>
                  {!!(p.poze || []).length && (
                    <div style={{ display:'grid', gridTemplateColumns: (p.poze.length === 1 ? '1fr' : '1fr 1fr'), gap:2 }}>
                      {p.poze.slice(0, 4).map((ph, i) => (
                        <div key={ph} style={{ position:'relative', aspectRatio: p.poze.length === 1 ? '4/3' : '1/1', background:'#e4e6eb' }}>
                          {thumbs[ph] && <img src={thumbs[ph]} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} />}
                          {i === 3 && p.poze.length > 4 && <div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,.45)', color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontSize:24, fontWeight:700 }}>+{p.poze.length - 4}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ padding:'8px 12px', fontSize:12, color:'#65676B', borderTop:'1px solid #e4e6eb', display:'flex', gap:18 }}><span>👍 Apreciez</span><span>💬 Comentează</span><span>↗ Distribuie</span></div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
