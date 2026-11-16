// ═══════════════════════════════════════════════════════════════════════════
// UscareConducta.jsx — Execuție → proiect → „💨 Uscare conductă” (migrarea 20261225a), gândit pentru TELEFON, pe șantier.
// Lista operațiunilor de uscare ale proiectului (pe tronsoanele de probă sau pe un interval liber), formularul pe secțiuni (ordinea modelului
// beneficiarului), salvare pe parcurs (și o ciornă locală în browser, dacă semnalul cade), pozele pe categorii direct din cameră,
// temperatura / vremea propuse din vremea șantierului (omul le poate corecta; sursa se păstrează), avertismentul pentru notificarea sub 24 h,
// închiderea (doar completă), redeschiderea consemnată (admin) și PDF-ul raportului cu anexa foto.
// Scrierea: DOAR prin RPC-urile fn_executie_uscare_salveaza / _stare / _poza; citirea prin RLS (dreptul pe proiect).
// L05: fiecare apăsare are cheia ei, scrisă în registrul local ÎNAINTE de trimitere; un rezultat necunoscut (rețea) rămâne în registru și se
//   lămurește prin retrimiterea IDENTICĂ (aceeași cheie); 42501 nu dovedește nimic (cheia se caută în jurnal).
// L24: încărcările au generația lor; un răspuns întârziat nu se aplică pe alt proiect / alt raport.
// ═══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './lib/supabase.js'
import { paginareKeyset } from './hrDeciziiUtil.js'
import { G, S } from './NodCuplareVizualizare.jsx'
import { iconMeteo } from './Meteo.jsx'
import {
  ETICHETE_CATEGORII, ETICHETE_OBLIGATORII, ETICHETE_STARE, CULORI_STARE, RPC_USCARE, prefixRegistru,
  registruNou, clasificaReluare, formularNou, formularDinRand, payloadDinFormular, areModificari, lipsaDinRand, pozeLipsa,
  durataOre, vitezaMedie, diferentaBurete, verificare24h, avertismentMeteo, propunereMeteo, fmtZi, fmtMoment, fmtNr, fmtKm,
  actiuniPermise,
} from './uscareLogica.js'

const stocareImplicita = () => { try { return globalThis.localStorage || null } catch { return null } }
const BUCKET = 'executie-uscare'
const COL = 'id, proiect_id, proba_id, tronson, km_de_la_m, km_pana_la_m, lungime_m, inceput_planificat, notificare_la, notificare_ref, data_operatie, ora_inceput, ora_final, temperatura_c, temperatura_sursa, meteo_la, vreme, constructor, utilaje, pig_metalic_buc, piston_pu_buc, bureti_buc, cantariri, punct_roua_c, punct_roua_loc, presiune_bar, timp_deplasare_min, observatii, concluzie, semn_constructor_nume, semn_constructor_functie, semn_beneficiar_nume, semn_beneficiar_functie, stare, motiv_anulare, revizie, inchis_la, versiune, creat_la, modificat_la'
const COL_POZA = 'id, uscare_id, proiect_id, categorie, burete_nr, cale, legenda, creat_la'
const CONSTRUCTOR_IMPLICIT = 'GAZPET INSTAL S.R.L.'
const uuid = () => globalThis.crypto.randomUUID()
const pagini = (client, tabel, coloane, filtru) => paginareKeyset((ultim, pas) => {
  let q = filtru(client.from(tabel).select(coloane)).order('id').limit(pas)
  if (ultim != null) q = q.gt('id', ultim)
  return q
})
const lipsaTabel = e => ['42P01', 'PGRST205', 'PGRST202'].includes(e?.code)

// stiluri mari, pentru degetul de pe șantier (font 16 = fără zoom pe iPhone)
const ST = {
  card: { background: G.surface, border: `1px solid ${G.border}`, borderRadius: 14, padding: 14, margin: '10px 0' },
  h: { fontSize: 15, fontWeight: 800, margin: '0 0 10px', color: G.text },
  in: { ...S.input, minHeight: 46, fontSize: 16 },
  lab: { ...S.label, fontSize: 13, marginTop: 8 },
  btn: { ...S.btn, minHeight: 46, fontSize: 15 },
  mare: { ...S.btn, minHeight: 54, fontSize: 16, fontWeight: 800, width: '100%' },
  rand: { display: 'flex', gap: 8, alignItems: 'flex-end' },
}
const Camp = ({ eticheta, children, nota }) => (
  <label style={{ display: 'block', flex: 1, minWidth: 0 }}><span style={ST.lab}>{eticheta}</span>{children}{nota && <span style={{ fontSize: 12, color: G.muted }}>{nota}</span>}</label>
)

// JPEG comprimat (bucket-ul acceptă doar image/jpeg): latura mare ≤ 1920 px, calitate 0,82
async function comprimaJpeg(file) {
  if (!file?.type?.startsWith('image/')) throw new Error('Alege o fotografie.')
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((ok, nu) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => nu(new Error('Fotografia nu poate fi citită (alege JPEG).')); i.src = url })
    const k = Math.min(1, 1920 / Math.max(img.width, img.height))
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k))
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
    return await new Promise((ok, nu) => c.toBlob(b => (b ? ok(b) : nu(new Error('Comprimarea a eșuat.'))), 'image/jpeg', 0.82))
  } finally { URL.revokeObjectURL(url) }
}

export default function UscareConducta({ proiectId, client = supabase, stocare = stocareImplicita() }) {
  const [uscari, setUscari] = useState([])
  const [probe, setProbe] = useState([])
  const [incarc, setIncarc] = useState(true)
  const [eroare, setEroare] = useState(null)
  const [neactivat, setNeactivat] = useState(false)
  const [poateScrie, setPoateScrie] = useState(false)
  const [esteAdmin, setEsteAdmin] = useState(false)
  const [uid, setUid] = useState(null)
  const [selectat, setSelectat] = useState(null)       // id-ul raportului deschis; 'nou' = formular nou
  const [form, setForm] = useState(null)
  const [poze, setPoze] = useState([])
  const [miniaturi, setMiniaturi] = useState({})
  const [mesaj, setMesaj] = useState(null)              // { tip: 'ok' | 'eroare' | 'info', text }
  const [inCurs, setInCurs] = useState(false)
  const [nelamurite, setNelamurite] = useState([])
  const [motiv, setMotiv] = useState(null)              // { actiune, text } — pasul de confirmare pentru anulare / redeschidere
  const [meteoAlegere, setMeteoAlegere] = useState(null)
  const [ciornaGasita, setCiornaGasita] = useState(null)
  const [arataAnulate, setArataAnulate] = useState(false)
  const gen = useRef(0)
  const genPoze = useRef(0)
  const registru = useRef(null)
  const ctxProiect = useRef(0)
  const blocat = useRef(false)

  const rand = useMemo(() => (typeof selectat === 'number' ? uscari.find(u => u.id === selectat) || null : null), [uscari, selectat])
  const reimprospateazaNelamurite = () => setNelamurite(registru.current?.toate() || [])

  // ── încărcarea listei (keyset, L23) + drepturile; întoarce true doar dacă s-a aplicat ──
  const incarca = useCallback(async () => {
    const g = ++gen.current
    setIncarc(true); setEroare(null)
    try {
      const [u, p, scr, adm] = await Promise.all([
        pagini(client, 'executie_uscari', COL, q => q.eq('proiect_id', proiectId)),
        pagini(client, 'executie_probe_tronsoane', 'id, proiect_id, cod, denumire, km_de_la_m, km_pana_la_m, stare', q => q.eq('proiect_id', proiectId)).catch(e => ({ eroare: e })),
        client.rpc('fn_executie_nod_drept', { p_proiect: proiectId, p_scriere: true }),
        client.rpc('fn_executie_contract_drept', { p_proiect: proiectId, p_scriere: true }),
      ])
      if (g !== gen.current) return false
      setUscari(u.filter(x => x.proiect_id === proiectId)); setNeactivat(false)
      setProbe(Array.isArray(p) ? p.filter(x => x.proiect_id === proiectId && x.stare === 'activ') : [])
      setPoateScrie(!scr.error && scr.data === true)
      setEsteAdmin(!adm.error && adm.data === true)
      if (scr.error) setMesaj({ tip: 'eroare', text: 'Nu am putut verifica dreptul de scriere: ' + scr.error.message })
      return true
    } catch (e) {
      if (g !== gen.current) return false
      if (lipsaTabel(e)) setNeactivat(true)
      else setEroare('Nu am putut încărca rapoartele de uscare: ' + (e?.message || e))
      return false
    } finally { if (g === gen.current) setIncarc(false) }
  }, [client, proiectId])

  useEffect(() => {
    ctxProiect.current += 1
    const c = ctxProiect.current
    setUscari([]); setSelectat(null); setForm(null); setPoze([]); setMesaj(null); registru.current = null; setNelamurite([])
    incarca()
    ;(async () => {
      let id = null
      try { id = (await client.auth?.getSession?.())?.data?.session?.user?.id || null } catch { id = null }
      if (c !== ctxProiect.current) return
      setUid(id)
      const reg = registruNou(id ? stocare : null, id ? prefixRegistru(id, proiectId) : null, RPC_USCARE)
      if (reg.utilizabil && reg.toate() !== null) { registru.current = reg; setNelamurite(reg.toate()) }
    })()
    return () => { ctxProiect.current += 1 }
  }, [incarca, client, stocare, proiectId])

  // ── pozele raportului deschis + miniaturile (signed URL, 10 min) ──
  const incarcaPoze = useCallback(async id => {
    const g = ++genPoze.current
    if (typeof id !== 'number') { setPoze([]); setMiniaturi({}); return }
    const { data, error } = await client.from('executie_uscare_poze').select(COL_POZA).eq('uscare_id', id).order('id').limit(500)
    if (g !== genPoze.current) return
    if (error) { setMesaj({ tip: 'eroare', text: 'Pozele nu s-au putut citi: ' + error.message }); return }
    setPoze(data || [])
    if (data?.length) {
      const s = await client.storage.from(BUCKET).createSignedUrls(data.map(p => p.cale), 600)
      if (g !== genPoze.current) return
      setMiniaturi(Object.fromEntries((s.data || []).filter(x => x.signedUrl).map(x => [x.path, x.signedUrl])))
    } else setMiniaturi({})
  }, [client])

  // ── ciorna locală (salvare pe parcurs fără semnal): pe (utilizator, raport, versiune) ──
  const cheieCiorna = id => (uid ? `gazpet.uscare.ciorna.v1:${uid}:${proiectId}:${id}` : null)
  const scrieCiorna = (id, versiune, f) => { const k = cheieCiorna(id); if (!k || !stocare) return; try { stocare.setItem(k, JSON.stringify({ versiune, form: f, la: new Date().toISOString() })) } catch { /* stocare plină / blocată: ciorna e doar un ajutor */ } }
  const stergeCiorna = id => { const k = cheieCiorna(id); if (k && stocare) { try { stocare.removeItem(k) } catch { /* idem */ } } }

  const deschide = (u, proba = null) => {
    setMesaj(null); setMotiv(null); setMeteoAlegere(null); setCiornaGasita(null)
    if (u === 'nou') {
      setSelectat('nou'); setForm(formularNou({ proba, constructor: CONSTRUCTOR_IMPLICIT })); incarcaPoze(null); return
    }
    setSelectat(u.id); setForm(formularDinRand(u)); incarcaPoze(u.id)
    const k = cheieCiorna(u.id)
    if (k && stocare && u.stare === 'deschisa') {
      try {
        const c = JSON.parse(stocare.getItem(k) || 'null')
        if (c?.form && areModificari(c.form, u)) setCiornaGasita({ ...c, vecheVersiune: c.versiune !== u.versiune })
      } catch { /* ciorna stricată: ignorată */ }
    }
  }
  const inchideForm = () => { setSelectat(null); setForm(null); setPoze([]); setMotiv(null); setMesaj(null); genPoze.current += 1 }
  const schimba = patch => setForm(f => {
    const n = { ...f, ...patch }
    if (rand) scrieCiorna(rand.id, rand.versiune, n)
    return n
  })

  // ── trimiterea unei apăsări (L04 + L05) ──
  async function trimite(rpc, payload, tinta) {
    const reg = registru.current
    if (!reg) return { clasa: 'blocat', error: { message: 'Stocarea locală a browserului nu e disponibilă (navigare privată / blocată): salvarea e oprită, ca un rezultat nelămurit să nu se piardă.' } }
    const intrare = { tinta, rpc, cheie: uuid(), payload, pusLa: new Date().toISOString() }
    if (!reg.pune(intrare)) return { clasa: 'blocat', error: { message: 'Nu am putut scrie în stocarea locală: salvarea e oprită.' } }
    return lamureste(intrare)
  }
  async function lamureste(intrare) {
    const reg = registru.current
    let r = null, error = null
    try { ({ data: r, error } = await client.rpc(intrare.rpc, { ...intrare.payload, p_cheie: intrare.cheie })) } catch (e) { error = e }
    let clasa = clasificaReluare({ r, error })
    if (clasa === 'fara_drept') {
      const j = await client.from('executie_uscare_jurnal').select('id').eq('cheie', intrare.cheie).limit(1)
      clasa = j.error || !Array.isArray(j.data) ? 'necunoscut' : j.data.length ? 'aplicat' : 'fara_drept'
    }
    if (['aplicat', 'aplicat_acum', 'neaplicat'].includes(clasa)) reg?.scoate(intrare.cheie)
    reimprospateazaNelamurite()
    return { clasa, r, error }
  }
  const mesajRezultat = ({ clasa, r, error }, ce) => {
    if (clasa === 'aplicat_acum' || clasa === 'aplicat') return { tip: 'ok', text: `${ce}: gata${clasa === 'aplicat' ? ' (se salvase deja)' : ''}.` }
    if (clasa === 'neaplicat' && r?.motiv === 'conflict') return { tip: 'eroare', text: `${ce}: raportul s-a schimbat între timp (alt telefon / alt coleg). Am reîncărcat; verifică și reia.` }
    if (clasa === 'necunoscut') return { tip: 'eroare', text: `${ce}: rezultat necunoscut (rețea). Cererea a rămas în lista „de lămurit” de sus: retrimite-o identic când ai semnal.` }
    return { tip: 'eroare', text: `${ce}: ${error?.message || 'refuzat'}` }
  }

  async function salveaza() {
    if (blocat.current || !form) return
    const { date, erori } = payloadDinFormular(form)
    if (erori.length) { setMesaj({ tip: 'eroare', text: 'De corectat: ' + erori.join(' · ') }); return }
    blocat.current = true; setInCurs(true); setMesaj(null)
    const c = ctxProiect.current
    try {
      const nou = selectat === 'nou'
      const payload = { p_proiect: proiectId, p_id: nou ? null : rand.id, p_versiune: nou ? null : rand.versiune, p_date: date }
      const rez = await trimite('fn_executie_uscare_salveaza', payload, nou ? 'nou' : `u${rand.id}`)
      if (c !== ctxProiect.current) return
      setMesaj(mesajRezultat(rez, 'Salvarea'))
      if (rez.r?.uscare) {
        const u = rez.r.uscare
        if (rez.r.ok) { stergeCiorna(u.id); setUscari(l => [...l.filter(x => x.id !== u.id), u]); setSelectat(u.id); setForm(formularDinRand(u)); if (nou) incarcaPoze(u.id) }
        else await incarca()
      } else if (rez.clasa === 'neaplicat') await incarca()
    } finally { blocat.current = false; setInCurs(false) }
  }
  async function schimbaStare(actiune, textMotiv = null) {
    if (blocat.current || !rand) return
    blocat.current = true; setInCurs(true); setMesaj(null)
    const c = ctxProiect.current
    try {
      const rez = await trimite('fn_executie_uscare_stare', { p_id: rand.id, p_versiune: rand.versiune, p_actiune: actiune, p_motiv: textMotiv }, `u${rand.id}`)
      if (c !== ctxProiect.current) return
      setMesaj(mesajRezultat(rez, { inchide: 'Închiderea', redeschide: 'Redeschiderea', anuleaza: 'Anularea' }[actiune]))
      if (rez.r?.uscare && rez.r.ok) { const u = rez.r.uscare; setUscari(l => l.map(x => (x.id === u.id ? u : x))); setForm(formularDinRand(u)); setMotiv(null) }
      else await incarca()
    } finally { blocat.current = false; setInCurs(false) }
  }

  // ── pozele: fișierul întâi (cale nouă, fără suprascriere), apoi înregistrarea prin RPC ──
  const [incarcPoza, setIncarcPoza] = useState(null)     // { categorie, burete, legenda, blob, cale } păstrat pentru reîncercare
  async function urcaPoza(categorie, file, burete = null, legenda = '') {
    if (!rand || blocat.current) return
    blocat.current = true; setInCurs(true); setMesaj(null)
    const id = rand.id, c = ctxProiect.current
    let item = incarcPoza && !file ? incarcPoza : null
    try {
      if (!item) item = { categorie, burete, legenda, blob: await comprimaJpeg(file), cale: `${proiectId}/${id}/${uuid()}.jpg` }
      setIncarcPoza(item)
      const up = await client.storage.from(BUCKET).upload(item.cale, item.blob, { contentType: 'image/jpeg', upsert: false })
      if (up.error) {
        // un răspuns pierdut poate lăsa fișierul deja încărcat: verificăm citindu-l
        const ex = await client.storage.from(BUCKET).download(item.cale)
        if (ex.error) throw new Error('Fișierul nu s-a încărcat: ' + up.error.message)
      }
      const rez = await trimite('fn_executie_uscare_poza', { p_uscare: id, p_actiune: 'adauga', p_poza: null, p_cale: item.cale, p_categorie: item.categorie,
        p_burete_nr: item.burete ? Number(item.burete) : null, p_legenda: item.legenda || null }, `u${id}`)
      if (c !== ctxProiect.current) return
      if (rez.clasa === 'aplicat' || rez.clasa === 'aplicat_acum') { setIncarcPoza(null); setMesaj({ tip: 'ok', text: 'Poza a fost adăugată.' }); incarcaPoze(id) }
      else { if (rez.clasa !== 'necunoscut') setIncarcPoza(null); setMesaj(mesajRezultat(rez, 'Poza')) }
    } catch (e) {
      setMesaj({ tip: 'eroare', text: (e?.message || 'Încărcarea a eșuat') + ' — apasă „Reîncearcă poza”.' })
    } finally { blocat.current = false; setInCurs(false) }
  }
  async function scoatePoza(p) {
    if (!rand || blocat.current) return
    blocat.current = true; setInCurs(true)
    try {
      const rez = await trimite('fn_executie_uscare_poza', { p_uscare: rand.id, p_actiune: 'scoate', p_poza: p.id, p_cale: null, p_categorie: null, p_burete_nr: null, p_legenda: null }, `u${rand.id}`)
      setMesaj(mesajRezultat(rez, 'Scoaterea pozei'))
      incarcaPoze(rand.id)
    } finally { blocat.current = false; setInCurs(false) }
  }

  // ── meteo: vremea curentă a șantierului proiectului (meteo_cache); omul acceptă sau scrie el ──
  async function propuneMeteo() {
    setMesaj(null)
    const s = await client.from('sites').select('id, name').eq('proiect_id', proiectId).limit(50)
    if (s.error) { setMesaj({ tip: 'eroare', text: 'Șantierele proiectului nu s-au putut citi: ' + s.error.message }); return }
    if (!s.data?.length) { setMesaj({ tip: 'info', text: 'Proiectul nu are un șantier cu vreme: scrie temperatura citită pe termometru.' }); return }
    const m = await client.from('meteo_cache').select('site_id, curent, actualizat_la').in('site_id', s.data.map(x => x.id))
    if (m.error) { setMesaj({ tip: 'eroare', text: 'Vremea nu s-a putut citi: ' + m.error.message }); return }
    const opt = (m.data || []).map(r => ({ ...propunereMeteo(r), site: s.data.find(x => x.id === r.site_id)?.name, icon: r.curent?.icon })).filter(x => x.temperatura_c != null)
    if (!opt.length) { setMesaj({ tip: 'info', text: 'Nu există vreme recentă pentru șantierele proiectului: scrie temperatura citită.' }); return }
    if (opt.length === 1) aplicaMeteo(opt[0]); else setMeteoAlegere(opt)
  }
  const aplicaMeteo = o => { schimba({ temperatura_c: o.temperatura_c, vreme: o.vreme, temperatura_sursa: 'meteo', meteo_la: o.meteo_la }); setMeteoAlegere(null) }

  async function pdf() {
    if (!rand || blocat.current) return
    blocat.current = true; setInCurs(true)
    try {
      const { exportRaportUscarePDF } = await import('./uscarePdf.js')
      const { necitite } = await exportRaportUscarePDF({ client, uscare: rand, poze })
      setMesaj(necitite ? { tip: 'eroare', text: `PDF generat, dar ${necitite} fotografii n-au putut fi citite (apar cu mențiune în anexă). Reîncearcă cu semnal bun.` }
                        : { tip: 'ok', text: 'PDF generat.' + (areModificari(form, rand) ? ' Atenție: arată ultima versiune SALVATĂ, nu modificările de pe ecran.' : '') })
    } catch (e) { setMesaj({ tip: 'eroare', text: 'PDF-ul nu s-a putut genera: ' + (e?.message || e) }) }
    finally { blocat.current = false; setInCurs(false) }
  }

  // ── afișarea ──
  if (neactivat) return <div style={{ ...ST.card, margin: 16 }}>Rapoartele de uscare nu sunt încă activate pe server (migrarea bazei de date nu e aplicată). Până atunci se folosește modelul pe hârtie.</div>
  const banner = mesaj && <div role={mesaj.tip === 'eroare' ? 'alert' : 'status'} style={{ ...ST.card, borderColor: mesaj.tip === 'eroare' ? G.red : mesaj.tip === 'ok' ? G.green : G.blue, color: G.text }}>{mesaj.text}</div>
  const bannerNelamurite = nelamurite.length > 0 && (
    <div style={{ ...ST.card, borderColor: G.yellow }}>
      <div style={ST.h}>⚠ {nelamurite.length} {nelamurite.length === 1 ? 'salvare nelămurită' : 'salvări nelămurite'} (rețea)</div>
      {nelamurite.map(i => (
        <div key={i.cheie} style={{ ...ST.rand, marginBottom: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: G.muted, flex: 1 }}>{i.rpc.replace('fn_executie_uscare_', '')} · {fmtMoment(i.pusLa)}</span>
          <button style={ST.btn} disabled={inCurs} onClick={async () => { setInCurs(true); const r = await lamureste(i); setInCurs(false); setMesaj(mesajRezultat(r, 'Retrimiterea')); incarca() }}>Retrimite identic</button>
          <button style={ST.btn} disabled={inCurs} onClick={() => { if (window.confirm('Renunți la verificare? Verifică întâi în listă dacă modificarea s-a salvat.')) { registru.current?.scoate(i.cheie); reimprospateazaNelamurite() } }}>Renunț</button>
        </div>
      ))}
    </div>
  )

  if (!form) {
    const vizibile = [...uscari].filter(u => arataAnulate || u.stare !== 'anulata').sort((a, b) => String(b.data_operatie || b.creat_la).localeCompare(String(a.data_operatie || a.creat_la)) || b.id - a.id)
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '8px 12px 40px' }}>
        <div style={{ ...ST.rand, justifyContent: 'space-between', margin: '8px 0' }}>
          <h2 style={{ fontSize: 18, margin: 0, color: G.text }}>💨 Uscare conductă</h2>
          <button style={ST.btn} onClick={() => incarca()} disabled={incarc}>↻</button>
        </div>
        {banner}{bannerNelamurite}
        {eroare && <div role="alert" style={{ ...ST.card, borderColor: G.red }}>{eroare}</div>}
        {poateScrie && (
          <div style={ST.card}>
            <div style={ST.h}>Uscare nouă</div>
            <div style={{ display: 'grid', gap: 8 }}>
              {probe.map(p => <button key={p.id} style={ST.mare} onClick={() => deschide('nou', p)}>{p.cod}{p.denumire ? ` — ${p.denumire}` : ''} · km {fmtKm(p.km_de_la_m)} → {fmtKm(p.km_pana_la_m)}</button>)}
              <button style={{ ...ST.mare, background: 'transparent' }} onClick={() => deschide('nou')}>Alt interval / tot traseul</button>
            </div>
          </div>
        )}
        {incarc && !uscari.length ? <p style={{ color: G.muted }}>Se încarcă…</p> : vizibile.length === 0 ? <p style={{ color: G.muted }}>Nicio operațiune de uscare pe acest proiect.</p> : vizibile.map(u => {
          const v = verificare24h(u.notificare_la, u.ora_inceput, u.inceput_planificat)
          return (
            <button key={u.id} onClick={() => deschide(u)} style={{ ...ST.card, display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer', color: G.text, fontFamily: 'inherit' }}>
              <div style={{ ...ST.rand, justifyContent: 'space-between' }}>
                <b style={{ fontSize: 16 }}>{u.tronson}</b>
                <span style={{ fontSize: 12, fontWeight: 700, color: CULORI_STARE[u.stare] }}>{ETICHETE_STARE[u.stare]}{u.revizie ? ` · rev. ${u.revizie}` : ''}</span>
              </div>
              <div style={{ fontSize: 13, color: G.muted, marginTop: 4 }}>
                {u.data_operatie ? fmtZi(u.data_operatie) : 'fără dată'} · km {fmtKm(u.km_de_la_m)} → {fmtKm(u.km_pana_la_m)}
                {u.concluzie && <> · <b style={{ color: u.concluzie === 'conform' ? G.green : G.red }}>{u.concluzie.toUpperCase()}</b></>}
              </div>
              {v.stare === 'sub_24h' && <div style={{ fontSize: 12, color: G.yellow, marginTop: 4 }}>⚠ Notificarea beneficiarului: {fmtNr(v.ore)} h înainte (cerut minimum 24 h)</div>}
              {v.stare === 'necunoscut' && u.stare === 'deschisa' && <div style={{ fontSize: 12, color: G.muted, marginTop: 4 }}>Notificarea beneficiarului nu e consemnată</div>}
            </button>
          )
        })}
        {uscari.some(u => u.stare === 'anulata') && <button style={ST.btn} onClick={() => setArataAnulate(x => !x)}>{arataAnulate ? 'Ascunde anulatele' : 'Arată și anulatele'}</button>}
      </div>
    )
  }

  // ── formularul ──
  const deschis = selectat === 'nou' || rand?.stare === 'deschisa'
  const editabil = deschis && poateScrie
  const { date: val } = payloadDinFormular(form)
  const v24 = verificare24h(val.notificare_la, val.ora_inceput, val.inceput_planificat)
  const durata = durataOre(val.ora_inceput, val.ora_final)
  const viteza = vitezaMedie(val.lungime_m, val.timp_deplasare_min)
  const avMeteo = form.temperatura_sursa === 'meteo' ? avertismentMeteo(form.meteo_la, val.ora_inceput) : null
  const modificat = selectat === 'nou' || areModificari(form, rand)
  const lipsa = rand ? lipsaDinRand(rand) : []
  const pozeL = pozeLipsa(poze)
  const kmDif = Number.isFinite(val.km_de_la_m) && Number.isFinite(val.km_pana_la_m) && val.lungime_m != null && Math.abs(val.km_pana_la_m - val.km_de_la_m - val.lungime_m) > 0.05
  const inp = (k, extra = {}) => <input style={ST.in} value={form[k] ?? ''} disabled={!editabil} onChange={e => schimba({ [k]: e.target.value })} {...extra} />
  const nrInp = (k, extra = {}) => inp(k, { inputMode: 'decimal', ...extra })
  // funcții de randare apelate direct (NU componente definite în randare: acelea s-ar remonta la fiecare tastă și inputul ar pierde focusul)
  const sect = (titlu, continut) => <div style={ST.card}><div style={ST.h}>{titlu}</div>{continut}</div>
  const pozeCat = cat => poze.filter(p => p.categorie === cat)
  const blocPoze = (cat, burete = null) => {
    const lista = pozeCat(cat).filter(p => burete == null || p.burete_nr === burete)
    return (
      <div style={{ marginTop: 8 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {lista.map(p => (
            <div key={p.id} style={{ position: 'relative' }}>
              {miniaturi[p.cale] ? <a href={miniaturi[p.cale]} target="_blank" rel="noreferrer"><img alt={ETICHETE_CATEGORII[cat]} src={miniaturi[p.cale]} style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, border: `1px solid ${G.border}` }} /></a>
                : <div style={{ width: 72, height: 72, borderRadius: 8, border: `1px dashed ${G.border}`, fontSize: 11, color: G.muted, display: 'grid', placeItems: 'center' }}>poză</div>}
              {editabil && rand && <button aria-label="Scoate poza" disabled={inCurs} onClick={() => { if (window.confirm('Scoți poza din raport? (fișierul rămâne păstrat)')) scoatePoza(p) }} style={{ position: 'absolute', top: -6, right: -6, borderRadius: 999, border: 'none', background: G.red, color: '#fff', width: 24, height: 24, cursor: 'pointer' }}>×</button>}
            </div>
          ))}
        </div>
        {editabil && rand && (
          <label style={{ ...ST.btn, display: 'inline-flex', marginTop: 6, alignItems: 'center', gap: 6, opacity: inCurs ? 0.5 : 1 }}>
            📷 {lista.length ? 'Încă o poză' : 'Fotografiază'}{burete ? ` (buretele ${burete})` : ''}
            <input type="file" accept="image/*" capture="environment" disabled={inCurs} style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) urcaPoza(cat, f, burete) }} />
          </label>
        )}
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '8px 12px 96px' }}>
      <div style={{ ...ST.rand, justifyContent: 'space-between', margin: '8px 0' }}>
        <button style={ST.btn} onClick={() => { if (!modificat || !editabil || window.confirm('Ai modificări nesalvate (rămân în ciorna locală). Ieși?')) inchideForm() }}>← Lista</button>
        <span style={{ fontSize: 13, fontWeight: 700, color: rand ? CULORI_STARE[rand.stare] : G.blue }}>{rand ? ETICHETE_STARE[rand.stare] : 'Raport nou'}{rand?.revizie ? ` · rev. ${rand.revizie}` : ''}</span>
      </div>
      {banner}{bannerNelamurite}
      {ciornaGasita && (
        <div style={{ ...ST.card, borderColor: G.yellow }}>
          Ai modificări nesalvate din {fmtMoment(ciornaGasita.la)}{ciornaGasita.vecheVersiune ? ' (între timp raportul a fost salvat de altcineva: verifică înainte)' : ''}.
          <div style={{ ...ST.rand, marginTop: 8 }}>
            <button style={ST.btn} onClick={() => { setForm(ciornaGasita.form); setCiornaGasita(null) }}>Restaurez</button>
            <button style={ST.btn} onClick={() => { stergeCiorna(rand.id); setCiornaGasita(null) }}>Renunț la ciornă</button>
          </div>
        </div>
      )}
      {!poateScrie && <div style={{ ...ST.card, color: G.muted }}>Doar citire: nu ai drept de scriere pe Execuție pentru acest proiect.</div>}
      {rand?.stare === 'anulata' && <div style={{ ...ST.card, borderColor: G.muted }}>Raport anulat: {rand.motiv_anulare}</div>}

      {sect("1. Planificare și notificarea beneficiarului", <>
        <Camp eticheta="Începutul planificat">{inp('inceput_planificat', { type: 'datetime-local' })}</Camp>
        <Camp eticheta="Beneficiarul notificat la">{inp('notificare_la', { type: 'datetime-local' })}</Camp>
        <Camp eticheta="Referința notificării (nr. adresă / mail)">{inp('notificare_ref')}</Camp>
        {v24.stare === 'sub_24h' && <div role="alert" style={{ color: G.yellow, fontSize: 14, marginTop: 8 }}>⚠ Notificarea s-a făcut cu {fmtNr(v24.ore)} h înainte de începutul {v24.inceput === 'real' ? 'real' : 'planificat'}; beneficiarul cere minimum 24 h.</div>}
        {v24.stare === 'necunoscut' && <div style={{ color: G.muted, fontSize: 13, marginTop: 8 }}>Completează notificarea și începutul ca să se verifice cele 24 h cerute de beneficiar.</div>}
        {v24.stare === 'ok' && <div style={{ color: G.green, fontSize: 13, marginTop: 8 }}>✓ Notificare cu {fmtNr(v24.ore)} h înainte (minimum 24 h).</div>}
      </>)}

      {sect("2. Tronsonul", <>
        {probe.length > 0 && (
          <Camp eticheta="Tronsonul de probă">
            <select style={ST.in} disabled={!editabil} value={form.proba_id} onChange={e => {
              const p = probe.find(x => String(x.id) === e.target.value)
              schimba(p ? { proba_id: String(p.id), km_de_la: fmtKm(p.km_de_la_m), km_pana_la: fmtKm(p.km_pana_la_m), tronson: form.tronson || [p.cod, p.denumire].filter(Boolean).join(' — ') } : { proba_id: '' })
            }}>
              <option value="">— alt interval / tot traseul —</option>
              {probe.map(p => <option key={p.id} value={p.id}>{p.cod}{p.denumire ? ` — ${p.denumire}` : ''} (km {fmtKm(p.km_de_la_m)} → {fmtKm(p.km_pana_la_m)})</option>)}
            </select>
          </Camp>
        )}
        <Camp eticheta="Tronson (cum apare în raport)">{inp('tronson')}</Camp>
        <div style={ST.rand}>
          <Camp eticheta="De la km">{inp('km_de_la', { placeholder: '3+200' })}</Camp>
          <Camp eticheta="La km">{inp('km_pana_la', { placeholder: '3+900' })}</Camp>
        </div>
        <Camp eticheta="Lungime (m)" nota={kmDif ? 'Diferă de intervalul de km: verifică (lungimea reală poate fi alta decât diferența de km).' : null}>{nrInp('lungime_m')}</Camp>
        <Camp eticheta="Data operației">{inp('data_operatie', { type: 'date' })}</Camp>
        <Camp eticheta="Denumire constructor">{inp('constructor')}</Camp>
      </>)}

      {sect("3. Vremea", <>
        <div style={ST.rand}>
          <Camp eticheta="Temperatura exterioară (°C)">{inp('temperatura_c', { inputMode: 'decimal', onChange: e => schimba({ temperatura_c: e.target.value, temperatura_sursa: 'manual', meteo_la: '' }) })}</Camp>
          {editabil && <button style={ST.btn} onClick={propuneMeteo} disabled={inCurs}>🌡️ Din meteo</button>}
        </div>
        <Camp eticheta="Vremea">{inp('vreme')}</Camp>
        <div style={{ fontSize: 12, color: G.muted, marginTop: 6 }}>{form.temperatura_sursa === 'meteo' ? `Propusă din vremea șantierului, date de la ${fmtMoment(form.meteo_la)}. Dacă o corectezi, devine „citită de om”.` : form.temperatura_c ? 'Citită de om.' : ''}</div>
        {avMeteo && <div style={{ color: G.yellow, fontSize: 13, marginTop: 6 }}>⚠ {avMeteo}</div>}
        {meteoAlegere && <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>{meteoAlegere.map((o, i) => <button key={i} style={ST.btn} onClick={() => aplicaMeteo(o)}>{iconMeteo(o.icon)} {o.site}: {o.temperatura_c} °C, {o.vreme} ({fmtMoment(o.meteo_la)})</button>)}</div>}
        {blocPoze('temperatura')}
      </>)}

      {sect("4. Utilaje / echipamente", <>
        {form.utilaje.map((u, i) => (
          <div key={i} style={ST.rand}>
            <Camp eticheta={`Denumire ${i + 1}`}><input style={ST.in} disabled={!editabil} value={u.denumire} onChange={e => schimba({ utilaje: form.utilaje.map((x, j) => (j === i ? { ...x, denumire: e.target.value } : x)) })} /></Camp>
            <div style={{ width: 80 }}><Camp eticheta="Buc."><input style={ST.in} inputMode="numeric" disabled={!editabil} value={u.buc} onChange={e => schimba({ utilaje: form.utilaje.map((x, j) => (j === i ? { ...x, buc: e.target.value } : x)) })} /></Camp></div>
            {editabil && <button style={ST.btn} aria-label="Scoate utilajul" onClick={() => schimba({ utilaje: form.utilaje.filter((_, j) => j !== i) })}>×</button>}
          </div>
        ))}
        {editabil && form.utilaje.length < 20 && <button style={{ ...ST.btn, marginTop: 8 }} onClick={() => schimba({ utilaje: [...form.utilaje, { denumire: '', buc: '1' }] })}>+ Utilaj</button>}
        {blocPoze('utilaje')}
      </>)}

      {sect("5. Perioada", <>
        <Camp eticheta="Ora începerii">{inp('ora_inceput', { type: 'datetime-local' })}</Camp>
        <Camp eticheta="Ora finalizării">{inp('ora_final', { type: 'datetime-local' })}</Camp>
        <div style={{ fontSize: 14, marginTop: 8 }}>Durata: <b>{durata == null ? '—' : `${fmtNr(durata, 2)} ore`}</b></div>
      </>)}

      {sect("6. Configurația ansamblului de pistoane", <>
        <div style={ST.rand}>
          <Camp eticheta="PIG metalic [buc]">{nrInp('pig_metalic_buc', { inputMode: 'numeric' })}</Camp>
          <Camp eticheta="Piston poliuretan [buc]">{nrInp('piston_pu_buc', { inputMode: 'numeric' })}</Camp>
          <Camp eticheta="Bureți spumă [buc]">{nrInp('bureti_buc', { inputMode: 'numeric' })}</Camp>
        </div>
        {blocPoze('pistoane')}
      </>)}

      {sect("7. Cântărirea bureților", <>
        {form.cantariri.map((c, i) => {
          const d = diferentaBurete(val.cantariri[i])
          return (
            <div key={c.nr} style={{ borderTop: i ? `1px solid ${G.border2}` : 'none', paddingTop: i ? 8 : 0, marginTop: i ? 8 : 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Buretele {c.nr}{d != null && <span style={{ fontWeight: 400, color: G.muted }}> · diferența (ieșire − intrare): {fmtNr(d, 3)} kg</span>}</div>
              <div style={ST.rand}>
                <Camp eticheta="La intrare [kg]"><input style={ST.in} inputMode="decimal" disabled={!editabil} value={c.intrare_kg} onChange={e => schimba({ cantariri: form.cantariri.map((x, j) => (j === i ? { ...x, intrare_kg: e.target.value } : x)) })} /></Camp>
                <Camp eticheta="La ieșire [kg]"><input style={ST.in} inputMode="decimal" disabled={!editabil} value={c.iesire_kg} onChange={e => schimba({ cantariri: form.cantariri.map((x, j) => (j === i ? { ...x, iesire_kg: e.target.value } : x)) })} /></Camp>
                {editabil && form.cantariri.length > 1 && <button style={ST.btn} aria-label="Scoate buretele" onClick={() => schimba({ cantariri: form.cantariri.filter((_, j) => j !== i) })}>×</button>}
              </div>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>{blocPoze('cantar_intrare', c.nr)}{blocPoze('cantar_iesire', c.nr)}</div>
            </div>
          )
        })}
        {editabil && form.cantariri.length < 20 && <button style={{ ...ST.btn, marginTop: 8 }} onClick={() => schimba({ cantariri: [...form.cantariri, { nr: Math.max(0, ...form.cantariri.map(x => x.nr)) + 1, intrare_kg: '', iesire_kg: '' }] })}>+ Burete</button>}
      </>)}

      {sect("8. Punctul de rouă", <>
        <div style={ST.rand}>
          <Camp eticheta="Valoare (°C)">{nrInp('punct_roua_c')}</Camp>
          <Camp eticheta="Locul măsurării">{inp('punct_roua_loc')}</Camp>
        </div>
        <div style={{ fontSize: 12, color: G.muted, marginTop: 6 }}>Pragul de acceptare nu e dat de beneficiar: concluzia o pune omul.</div>
        {blocPoze('punct_roua')}
      </>)}

      {sect("9. Deplasarea buretelui", <>
        <div style={ST.rand}>
          <Camp eticheta="Presiunea în spatele buretelui (bar)">{nrInp('presiune_bar')}</Camp>
          <Camp eticheta="Timp deplasare (min)">{nrInp('timp_deplasare_min')}</Camp>
        </div>
        <div style={{ fontSize: 14, marginTop: 8 }}>Viteza medie (lungime / timp): <b>{viteza == null ? '—' : `${fmtNr(viteza, 2)} m/s`}</b></div>
        {blocPoze('manometru')}
      </>)}

      {sect("10. Observații și concluzie", <>
        <Camp eticheta="Observații"><textarea style={{ ...ST.in, minHeight: 90 }} disabled={!editabil} value={form.observatii} onChange={e => schimba({ observatii: e.target.value })} /></Camp>
        <div style={{ ...ST.rand, marginTop: 10 }}>
          {['conform', 'neconform'].map(c => (
            <button key={c} disabled={!editabil} onClick={() => schimba({ concluzie: form.concluzie === c ? '' : c })}
              style={{ ...ST.mare, background: form.concluzie === c ? (c === 'conform' ? G.green : G.red) + '44' : 'transparent', borderColor: form.concluzie === c ? (c === 'conform' ? G.green : G.red) : G.border }}>
              {form.concluzie === c ? '☒' : '☐'} {c.toUpperCase()}
            </button>
          ))}
        </div>
        {form.concluzie === 'neconform' && !form.observatii.trim() && <div style={{ color: G.yellow, fontSize: 13, marginTop: 6 }}>Scrie în observații ce nu a fost conform.</div>}
        {blocPoze('altele')}
      </>)}

      {sect("11. Semnături (se pot completa și de mână)", <>
        <div style={ST.rand}><Camp eticheta="Constructor — nume, prenume">{inp('semn_constructor_nume')}</Camp><Camp eticheta="Funcția">{inp('semn_constructor_functie')}</Camp></div>
        <div style={ST.rand}><Camp eticheta="Beneficiar — nume, prenume">{inp('semn_beneficiar_nume')}</Camp><Camp eticheta="Funcția">{inp('semn_beneficiar_functie')}</Camp></div>
      </>)}

      {rand && sect('Închiderea raportului', <>
          {lipsa.length > 0 && <div style={{ fontSize: 14, color: G.yellow }}>Pentru închidere lipsesc: {lipsa.map(k => ETICHETE_OBLIGATORII[k]).join(', ')}.</div>}
          {pozeL.length > 0 && <div style={{ fontSize: 14, color: G.yellow, marginTop: 6 }}>Fotografii cerute de beneficiar încă lipsă: {pozeL.map(c => ETICHETE_CATEGORII[c]).join(', ')}.</div>}
          {modificat && deschis && <div style={{ fontSize: 13, color: G.muted, marginTop: 6 }}>Salvează întâi modificările.</div>}
          <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
            {poateScrie && actiuniPermise(rand.stare).includes('inchide') && (
              <button style={{ ...ST.mare, borderColor: G.green }} disabled={inCurs || modificat || lipsa.length > 0}
                onClick={() => { if (window.confirm(`Închizi raportul cu concluzia ${String(rand.concluzie).toUpperCase()}? După închidere nu se mai poate modifica (doar redeschidere consemnată, de un administrator).`)) schimbaStare('inchide') }}>✓ Închide raportul</button>
            )}
            {esteAdmin && actiuniPermise(rand.stare).includes('redeschide') && <button style={ST.btn} disabled={inCurs} onClick={() => setMotiv({ actiune: 'redeschide', text: '' })}>Redeschide (corectură, cu motiv)</button>}
            {poateScrie && actiuniPermise(rand.stare).includes('anuleaza') && <button style={{ ...ST.btn, color: G.red }} disabled={inCurs} onClick={() => setMotiv({ actiune: 'anuleaza', text: '' })}>Anulează raportul</button>}
            {motiv && (
              <div>
                <Camp eticheta={motiv.actiune === 'redeschide' ? 'Motivul redeschiderii (rămâne în jurnal)' : 'Motivul anulării'}><input style={ST.in} value={motiv.text} maxLength={500} onChange={e => setMotiv({ ...motiv, text: e.target.value })} /></Camp>
                <div style={{ ...ST.rand, marginTop: 8 }}>
                  <button style={ST.btn} disabled={inCurs || !motiv.text.trim()} onClick={() => schimbaStare(motiv.actiune, motiv.text.trim())}>Confirm</button>
                  <button style={ST.btn} onClick={() => setMotiv(null)}>Renunț</button>
                </div>
              </div>
            )}
            <button style={ST.mare} disabled={inCurs} onClick={pdf}>📄 Raportul în PDF{rand.stare !== 'inchisa' ? ' (ciornă)' : ''}</button>
          </div>
        </>)}
      {selectat === 'nou' && <div style={{ ...ST.card, color: G.muted, fontSize: 13 }}>Salvează raportul ca să poți adăuga fotografii.</div>}
      {incarcPoza && !inCurs && <button style={{ ...ST.btn, width: '100%' }} onClick={() => urcaPoza(incarcPoza.categorie, null, incarcPoza.burete, incarcPoza.legenda)}>Reîncearcă poza ({ETICHETE_CATEGORII[incarcPoza.categorie]})</button>}

      {editabil && (
        <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, padding: 10, background: G.bg, borderTop: `1px solid ${G.border}`, zIndex: 20 }}>
          <div style={{ maxWidth: 720, margin: '0 auto' }}>
            <button style={{ ...ST.mare, background: modificat ? '#238636' : G.surface2, color: '#fff' }} disabled={inCurs || !modificat} onClick={salveaza}>
              {inCurs ? 'Se trimite…' : selectat === 'nou' ? '💾 Creează raportul' : modificat ? '💾 Salvează' : '✓ Salvat'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
