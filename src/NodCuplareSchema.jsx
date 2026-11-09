// ═══════════════════════════════════════════════════════════════════════════
// NodCuplareSchema.jsx — Execuție → proiect → Izometrie → „🔩 Nod cuplare” (decizia lui Răzvan, 09.11.2026)
// Schema de montaj a nodului (ex. NOD-CUPLARE-PRUNISOR pe Lot 1), cu sudurile ca puncte colorate după stare; atingerea unui
// punct deschide fișa sudurii, de unde se schimbă starea (doar cu drept de scriere pe Execuție, prin RPC-ul
// fn_executie_nod_sudura_stare). Sus: contorul azi / cumulat / rest pe diametre. Sudurile fără punct pe vederea curentă
// se deschid dintr-o listă, cu aceeași fișă.
// Date: executie_noduri_suduri (migrarea 20261201a, RLS pe dreptul Execuție) + bucket-ul privat noduri-scheme
// (<proiect>/<nod>/vederi.json + imaginile, urcate de chat; citite prin signed URL scurt). Pagina nu scrie nimic altundeva.
// L24: încărcarea, imaginea și salvarea au fiecare generația lor; un rezultat întârziat nu se aplică pe alt context.
// ═══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './lib/supabase.js'
import { paginareKeyset } from './hrDeciziiUtil.js'
import { ziBucuresti } from './lib/izoTeren.js'
import {
  contor, filtreaza, parseManifest, puncteVedere, grupeazaPuncte, faraPunctPeVedere, cheieImagine, aplicaRand, imbinaLista,
  decideReincercare, payloadStare, incertPune, incertSterge,
} from './nodCuplareLogica.js'
import { G, S, ContorNod, Legenda, SchemaVedere, FisaSudura, FiltreNod, ListaGrup } from './NodCuplareVizualizare.jsx'

const BUCKET = 'noduri-scheme'
const COLOANE = 'id, proiect_id, nod_cod, cod, subansamblu, dn, diametru, poz1, poz2, certitudine, stare, data_stare, data_sudare, sudor, buletin_ndt, motiv, vedere, x_pct, y_pct, pozitie_certitudine, pozitii_secundare, versiune, modificat_la'
const FARA_PUNCT = '__fara_punct'
const cheieNoua = () => globalThis.crypto.randomUUID()
const citesteSesiune = k => { try { return sessionStorage.getItem(k) || '' } catch { return '' } }
const scrieSesiune = (k, v) => { try { sessionStorage.setItem(k, v) } catch { /* fără sessionStorage: doar în memorie */ } }

// `client` se poate înlocui doar în harness-ul de capturi (date sintetice); în aplicație e mereu clientul Supabase al sesiunii
export default function NodCuplareSchema({ proiectId, client = supabase }) {
  const [suduri, setSuduri] = useState([])
  const [eroare, setEroare] = useState(null)
  const [incarc, setIncarc] = useState(true)
  const [poateScrie, setPoateScrie] = useState(false)
  const [eroareDrept, setEroareDrept] = useState(null)
  const [nod, setNod] = useState('')
  const [manifest, setManifest] = useState(null)        // { vederi, erori } | null
  const [eroareManifest, setEroareManifest] = useState(null)
  const [vedere, setVedere] = useState('')
  const [imagine, setImagine] = useState(null)          // { url, cheie } — cheie = proiect/nod/vedere/fișier
  const [eroareImagine, setEroareImagine] = useState(null)
  const [stari, setStari] = useState([])
  const [dn, setDn] = useState('')
  const [selectat, setSelectat] = useState(null)
  const [grupDeschis, setGrupDeschis] = useState(null)   // cheia unui punct de grup sau FARA_PUNCT (lista sudurilor fără punct)
  const [inCurs, setInCurs] = useState(null)             // generația fișei pentru care rulează o salvare
  const [mesaj, setMesaj] = useState(null)
  const [sudor, setSudor] = useState(() => citesteSesiune('nod_cuplare_sudor'))
  const [azi, setAzi] = useState(ziBucuresti())
  const gen = useRef(0)              // încărcarea listei
  const genImg = useRef(0)           // imaginea vederii
  const fisaGen = useRef(0)          // contextul fișei: crește la deschidere / închidere / schimbarea nodului sau a proiectului
  const timerInchidere = useRef(null)
  const incerte = useRef(new Map())  // L05: id sudură -> { cheie, payload, seq } al unei salvări cu rezultat NECUNOSCUT
  const seqIntentie = useRef(0)
  const montat = useRef(true)        // după demontare nu se mai programează nimic (timer, stare)

  const contextNou = () => { fisaGen.current += 1; clearTimeout(timerInchidere.current); timerInchidere.current = null }
  useEffect(() => {
    montat.current = true
    return () => { montat.current = false; clearTimeout(timerInchidere.current); timerInchidere.current = null }
  }, [])

  // „azi” (Europe/Bucharest) se recalculează la revenirea în pagină și la schimbarea zilei
  useEffect(() => {
    const actualizeaza = () => setAzi(z => { const n = ziBucuresti(); return n === z ? z : n })
    const t = setInterval(actualizeaza, 60000)
    const vizibil = () => { if (document.visibilityState === 'visible') actualizeaza() }
    document.addEventListener('visibilitychange', vizibil)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vizibil) }
  }, [])

  // ── sudurile proiectului (toate nodurile), keyset pe id (pot depăși 1000) + dreptul de scriere ──
  const incarca = useCallback(async () => {
    const g = ++gen.current
    setIncarc(true); setEroare(null); setEroareDrept(null)
    try {
      const [toate, drept] = await Promise.all([
        paginareKeyset((ultim, pas) => {
          let q = client.from('executie_noduri_suduri').select(COLOANE).eq('proiect_id', proiectId).order('id').limit(pas)
          if (ultim != null) q = q.gt('id', ultim)
          return q
        }),
        client.rpc('fn_executie_nod_drept', { p_proiect: proiectId, p_scriere: true }),
      ])
      if (g !== gen.current) return
      // pe fiecare sudură rămâne versiunea maximă dintre citire și lista curentă (o salvare terminată între timp nu se pierde)
      setSuduri(curente => imbinaLista(toate.filter(r => r.proiect_id === proiectId), curente))
      if (drept.error) { setPoateScrie(false); setEroareDrept('Nu am putut verifica dreptul de scriere: ' + drept.error.message) }
      else setPoateScrie(drept.data === true)
      setAzi(ziBucuresti())
    } catch (e) {
      if (g !== gen.current) return
      setSuduri([]); setEroare('Nu am putut încărca sudurile: ' + (e?.message || e))
    } finally { if (g === gen.current) setIncarc(false) }
  }, [proiectId, client])
  useEffect(() => {
    contextNou(); incerte.current = new Map()
    setSuduri([]); setNod(''); setManifest(null); setVedere(''); setSelectat(null); setGrupDeschis(null); setMesaj(null)
    incarca()
  }, [incarca])

  const noduri = useMemo(() => [...new Set(suduri.map(s => s.nod_cod))].sort(), [suduri])
  useEffect(() => { if (!nod && noduri.length) setNod(noduri[0]) }, [nod, noduri])
  const aleNodului = useMemo(() => suduri.filter(s => s.nod_cod === nod), [suduri, nod])

  // ── manifestul vederilor nodului ──
  useEffect(() => {
    if (!nod) return undefined
    let viu = true
    setManifest(null); setEroareManifest(null)
    ;(async () => {
      try {
        const { data, error } = await client.storage.from(BUCKET).download(`${proiectId}/${nod}/vederi.json`)
        if (!viu) return
        if (error) { setEroareManifest('Schema nodului nu se poate citi (vederi.json): ' + (error.message || 'eroare') + '. Imaginile le urcă chat-ul; sudurile se deschid din lista de mai jos.'); return }
        const m = parseManifest(JSON.parse(await data.text()))
        if (!viu) return
        setManifest(m)
        setVedere(v => (m.vederi.some(x => x.vedere === v) ? v : (m.vederi[0]?.vedere || '')))
      } catch (e) { if (viu) setEroareManifest('Schema nodului nu se poate citi (vederi.json): ' + (e?.message || e)) }
    })()
    return () => { viu = false }
  }, [proiectId, nod, client])

  const vedereCurenta = manifest?.vederi.find(x => x.vedere === vedere) || null
  const cheieImg = cheieImagine({ proiectId, nod, vedere: vedereCurenta?.vedere, fisier: vedereCurenta?.fisier })
  // ── imaginea vederii: signed URL scurt (10 min). Orice schimbare de identitate golește imaginea și invalidează cererea veche ──
  useEffect(() => {
    const g = ++genImg.current
    setImagine(null); setEroareImagine(null)
    if (!cheieImg) return () => { genImg.current += 1 }
    const cale = `${proiectId}/${nod}/${vedereCurenta.fisier}`
    client.storage.from(BUCKET).createSignedUrl(cale, 600).then(({ data, error }) => {
      if (g !== genImg.current) return
      if (error || !data?.signedUrl) { setEroareImagine('Imaginea vederii nu se poate citi: ' + (error?.message || 'fără URL')); return }
      setImagine({ url: data.signedUrl, cheie: cheieImg })
    }).catch(e => { if (g === genImg.current) setEroareImagine('Imaginea vederii nu se poate citi: ' + (e?.message || e)) })
    return () => { genImg.current += 1 }
  }, [cheieImg, client]) // eslint-disable-line react-hooks/exhaustive-deps

  const c = useMemo(() => contor(aleNodului, azi), [aleNodului, azi])
  const dnuri = useMemo(() => [...new Set(aleNodului.map(s => s.dn).filter(Number.isInteger))].sort((a, b) => b - a), [aleNodului])
  const filtrate = useMemo(() => filtreaza(aleNodului, { stari, dn }), [aleNodului, stari, dn])
  // punctele vederii (principale + secundare), grupate pe coordonate identice (ex. rezervoarele „fără poziție pe planșă”)
  const peVedere = useMemo(() => puncteVedere(vedereCurenta ? filtrate : [], vedere), [filtrate, vedere, vedereCurenta])
  const grupuri = useMemo(() => grupeazaPuncte(peVedere), [peVedere])
  // sudurile fără punct pe vederea afișată (sau fără schemă deloc): se deschid din listă, cu aceeași fișă
  const faraPunct = useMemo(() => (vedereCurenta ? faraPunctPeVedere(filtrate, vedere) : filtrate), [filtrate, vedere, vedereCurenta])
  const faraNiciunPunct = aleNodului.filter(s => s.vedere == null).length
  const grupFara = useMemo(() => ({ cheie: FARA_PUNCT, puncte: faraPunct.map(s => ({ sudura: s, certitudine: null })) }), [faraPunct])
  const sudSel = aleNodului.find(s => String(s.id) === String(selectat)) || null
  const grupSel = grupDeschis === FARA_PUNCT ? grupFara : (grupuri.find(g => g.cheie === grupDeschis) || null)

  // ── fișa: deschidere / închidere = context nou (mesajele și timerul vechi nu mai ajung pe ea) ──
  // Reconcilierea unei cereri cu rezultat necunoscut (cheia ei e capturată): aduce rândul de pe server și șterge intrarea DOAR dacă
  // e tot a acelei cereri (incertSterge compară cheia). La închiderea fișei (fortat = false) intrarea rămâne cât timp cererea ei
  // încă se poate aplica (versiunea de pe server = cea din cerere), ca reîncercarea identică să-și păstreze cheia.
  const reconciliaza = async (id, cheie, fortat, g) => {
    let data = null, error = null
    try { ({ data, error } = await client.from('executie_noduri_suduri').select(COLOANE).eq('id', id).maybeSingle()) } catch (e) { error = e }
    if (!montat.current) return false
    if (error) { if (g === fisaGen.current) setMesaj({ ok: false, text: 'Nu am putut reîncărca sudura: ' + (error.message || error) }); return false }
    if (data) setSuduri(list => aplicaRand(list, data))
    const intrare = incerte.current.get(id)
    if (intrare && intrare.cheie === cheie && (fortat || !data || Number(data.versiune) !== Number(intrare.payload.p_versiune))) {
      incerte.current = incertSterge(incerte.current, id, cheie)
    }
    return true
  }
  const deschide = id => { contextNou(); setGrupDeschis(null); setSelectat(id); setMesaj(null) }
  const inchide = () => {
    // o salvare cu rezultat necunoscut pe fișa care se închide: se reconciliază cu serverul în fundal
    const intrare = selectat != null ? incerte.current.get(selectat) : null
    if (intrare) reconciliaza(selectat, intrare.cheie, false, -1)
    contextNou(); setSelectat(null); setMesaj(null)
  }
  const atingePunct = cheie => {
    const g = grupuri.find(x => x.cheie === cheie)
    if (!g) return
    if (g.puncte.length === 1) deschide(g.puncte[0].sudura.id)
    else setGrupDeschis(cheie)
  }
  const schimbaNod = n => { contextNou(); setNod(n); setSelectat(null); setGrupDeschis(null); setMesaj(null) }
  const schimbaSudor = v => { setSudor(v); scrieSesiune('nod_cuplare_sudor', v) }

  const salveaza = async form => {
    const s = sudSel
    const g = fisaGen.current
    if (!s || inCurs === g) return
    const payload = payloadStare(s, form)
    const intrare = incerte.current.get(s.id)
    const decizie = decideReincercare(intrare, payload)
    if (decizie === 'reconciliere') {
      // formularul s-a schimbat după un rezultat necunoscut: întâi starea reală de pe server, abia apoi o cerere nouă
      setInCurs(g)
      const ok = await reconciliaza(s.id, intrare.cheie, true, g)
      if (!montat.current) return
      setInCurs(x => (x === g ? null : x))
      if (ok && g === fisaGen.current) setMesaj({ ok: false, text: 'Cererea anterioară avea rezultat necunoscut; am adus starea reală a sudurii. Verifică și confirmă din nou.' })
      return
    }
    // aceeași cerere = aceeași cheie și același loc în ordinea intențiilor; altfel intenție nouă
    const cheie = decizie === 'aceeasi' ? intrare.cheie : cheieNoua()
    const seq = decizie === 'aceeasi' ? intrare.seq : ++seqIntentie.current
    setInCurs(g); setMesaj(null)
    let r = null, error = null
    try { ({ data: r, error } = await client.rpc('fn_executie_nod_sudura_stare', { ...payload, p_cheie: cheie })) } catch (e) { error = e }
    if (error) {
      // L05: rezultat necunoscut — se păstrează EXACT cererea și cheia, pe sudura ei (nu peste o intenție ulterioară)
      incerte.current = incertPune(incerte.current, payload.p_id, { cheie, payload, seq })
    } else {
      incerte.current = incertSterge(incerte.current, payload.p_id, cheie)
      if (r?.sudura) setSuduri(list => aplicaRand(list, r.sudura))
    }
    if (!montat.current) return
    setInCurs(x => (x === g ? null : x))
    if (g !== fisaGen.current) return
    if (error) setMesaj({ ok: false, text: 'Nu se știe dacă s-a salvat (' + (error.message || error) + '). Apasă din nou „Confirmă” fără să schimbi nimic; dacă schimbi ceva, întâi reîncarc sudura.' })
    else if (r?.ok) {
      setMesaj({ ok: true, text: r.duplicat ? 'Era deja salvată.' : 'Salvat.' })
      timerInchidere.current = setTimeout(() => { if (montat.current && g === fisaGen.current) { contextNou(); setSelectat(null); setMesaj(null) } }, 700)
    } else setMesaj({ ok: false, text: 'Sudura a fost schimbată între timp (altă apăsare sau alt utilizator). Am adus starea actuală — verifică și reîncearcă.' })
  }

  if (incarc && !suduri.length) return <Cadru><div style={{ color: G.dim, padding: 30, textAlign: 'center' }}>Se încarcă…</div></Cadru>
  if (eroare) return <Cadru><Alerta text={eroare} /><button onClick={incarca} style={{ ...S.btn, marginTop: 10 }}>Reîncearcă</button></Cadru>
  if (!noduri.length) return <Cadru><div style={{ color: G.muted, padding: 20, fontSize: 14 }}>Niciun nod de cuplare pe acest proiect (sau nu ai drept de citire pe Execuție). Lista sudurilor o încarcă chat-ul.</div></Cadru>

  return (
    <Cadru>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: G.text }}>🔩 Schema nod cuplare</div>
        {noduri.length > 1
          ? <select value={nod} onChange={e => schimbaNod(e.target.value)} style={{ ...S.input, width: 'auto', padding: '6px 10px', fontSize: 14 }}>{noduri.map(n => <option key={n} value={n}>{n}</option>)}</select>
          : <span style={{ fontSize: 13, color: G.muted, fontWeight: 700 }}>{nod}</span>}
        <button onClick={incarca} style={{ ...S.btn, marginLeft: 'auto', padding: '6px 12px', fontSize: 13 }}>↻ Reîncarcă</button>
      </div>
      <ContorNod c={c} ziAfisata={azi} />
      {eroareDrept && <Alerta text={eroareDrept} />}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '12px 0 8px' }}>
        {(manifest?.vederi || []).map(x => (
          <button key={x.vedere} onClick={() => setVedere(x.vedere)} title={x.titlu}
            style={{ ...S.btn, padding: '7px 12px', background: x.vedere === vedere ? G.blue : G.surface2, color: x.vedere === vedere ? '#0D1117' : G.text }}>
            {x.vedere === 'PLAN' ? 'Plan' : `Vedere ${x.vedere}`}
          </button>
        ))}
      </div>
      {eroareManifest && <Alerta text={eroareManifest} />}
      {manifest?.erori?.length > 0 && <Alerta text={'Vederi ignorate din manifest: ' + manifest.erori.join(' · ')} />}
      {vedereCurenta && <div style={{ fontSize: 12, color: G.muted, marginBottom: 6 }}>{vedereCurenta.titlu}</div>}
      <FiltreNod stari={stari} setStari={setStari} dn={dn} setDn={setDn} dnuri={dnuri} />
      <div style={{ height: 8 }} />
      {vedereCurenta && (
        <SchemaVedere imagineUrl={imagine?.cheie === cheieImg ? imagine.url : null} cheieImagine={cheieImg} w={vedereCurenta.w} h={vedereCurenta.h}
          grupuri={grupuri} selectatId={selectat} onSelect={atingePunct}
          onEroareImagine={() => setEroareImagine('Imaginea vederii nu s-a putut încărca (link expirat sau fișier lipsă). Reîncarcă pagina.')} />
      )}
      {eroareImagine && <Alerta text={eroareImagine} />}
      <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: G.muted }}>Pe această vedere: {new Set(peVedere.map(p => p.sudura.id)).size} suduri</span>
        {faraPunct.length > 0 && (
          <button onClick={() => setGrupDeschis(FARA_PUNCT)} style={{ ...S.btn, padding: '8px 12px', fontSize: 13, minHeight: 44 }}>
            📋 Suduri fără punct {vedereCurenta ? 'pe această vedere' : 'pe schemă'}: {faraPunct.length}
          </button>
        )}
        {faraNiciunPunct > 0 && <span style={{ fontSize: 12, color: G.dim }}>(fără niciun punct pe schemă: {faraNiciunPunct})</span>}
      </div>
      <div style={{ marginTop: 8 }}><Legenda /></div>

      <ListaGrup grup={grupSel} onAlege={deschide} onInchide={() => setGrupDeschis(null)}
        titlu={grupDeschis === FARA_PUNCT ? `Suduri fără punct ${vedereCurenta ? `pe vederea ${vedereCurenta.vedere === 'PLAN' ? 'Plan' : vedereCurenta.vedere}` : 'pe schemă'}${stari.length || dn !== '' ? ' (după filtre)' : ''}: ${faraPunct.length}` : null} />
      <FisaSudura sudura={sudSel} poateScrie={poateScrie} azi={azi} sudorSesiune={sudor} onSudorSesiune={schimbaSudor}
        onSalveaza={salveaza} onInchide={inchide} busy={inCurs != null && inCurs === fisaGen.current} mesaj={mesaj} />
    </Cadru>
  )
}

function Cadru({ children }) {
  return <div style={{ padding: '14px 12px 30px', maxWidth: 1200, margin: '0 auto', color: G.text }}>{children}</div>
}
function Alerta({ text }) {
  return <div style={{ margin: '8px 0', padding: '9px 12px', borderRadius: 10, background: G.red + '1F', color: G.red, fontSize: 13, fontWeight: 600 }}>{text}</div>
}
