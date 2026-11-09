// ═══════════════════════════════════════════════════════════════════════════
// NodCuplareSchema.jsx — Execuție → proiect → Izometrie → „🔩 Nod cuplare” (decizia lui Răzvan, 09.11.2026)
// Schema de montaj a nodului (ex. NOD-CUPLARE-PRUNISOR pe Lot 1), cu sudurile ca puncte colorate după stare; atingerea unui
// punct deschide fișa sudurii, de unde se schimbă starea (doar cu drept de scriere pe Execuție, prin RPC-ul
// fn_executie_nod_sudura_stare). Sus: contorul azi / cumulat / rest pe diametre.
// Date: executie_noduri_suduri (migrarea 20261201a, RLS pe dreptul Execuție) + bucket-ul privat noduri-scheme
// (<proiect>/<nod>/vederi.json + imaginile, urcate de chat; citite prin signed URL scurt). Pagina nu scrie nimic altundeva.
// ═══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './lib/supabase.js'
import { paginareKeyset } from './hrDeciziiUtil.js'
import { ziBucuresti } from './lib/izoTeren.js'
import { contor, filtreaza, parseManifest, puncteVedere, grupeazaPuncte } from './nodCuplareLogica.js'
import { G, S, ContorNod, Legenda, SchemaVedere, FisaSudura, FiltreNod, ListaGrup } from './NodCuplareVizualizare.jsx'

const BUCKET = 'noduri-scheme'
const COLOANE = 'id, proiect_id, nod_cod, cod, subansamblu, dn, diametru, poz1, poz2, certitudine, stare, data_stare, data_sudare, sudor, buletin_ndt, motiv, vedere, x_pct, y_pct, pozitie_certitudine, pozitii_secundare, versiune, modificat_la'
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
  const [imagine, setImagine] = useState(null)          // { url, vedere }
  const [eroareImagine, setEroareImagine] = useState(null)
  const [stari, setStari] = useState([])
  const [dn, setDn] = useState('')
  const [selectat, setSelectat] = useState(null)
  const [grupDeschis, setGrupDeschis] = useState(null)   // cheia unui punct de grup (mai multe suduri cu aceleași coordonate)
  const [busy, setBusy] = useState(false)
  const [mesaj, setMesaj] = useState(null)
  const [sudor, setSudor] = useState(() => citesteSesiune('nod_cuplare_sudor'))
  const [azi, setAzi] = useState(ziBucuresti())
  const gen = useRef(0)              // L24: rezultatul unei încărcări se aplică doar dacă e cea curentă
  const genImg = useRef(0)
  const intentie = useRef(null)      // L04: aceeași cheie la reîncercarea ACELEIAȘI apăsări

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
      setSuduri(toate)
      if (drept.error) { setPoateScrie(false); setEroareDrept('Nu am putut verifica dreptul de scriere: ' + drept.error.message) }
      else setPoateScrie(drept.data === true)
      setAzi(ziBucuresti())
    } catch (e) {
      if (g !== gen.current) return
      setSuduri([]); setEroare('Nu am putut încărca sudurile: ' + (e?.message || e))
    } finally { if (g === gen.current) setIncarc(false) }
  }, [proiectId, client])
  useEffect(() => { setNod(''); setManifest(null); setVedere(''); setSelectat(null); incarca() }, [incarca])

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
        if (error) { setEroareManifest('Schema nodului nu se poate citi (vederi.json): ' + (error.message || 'eroare') + '. Imaginile le urcă chat-ul.'); return }
        const m = parseManifest(JSON.parse(await data.text()))
        if (!viu) return
        setManifest(m)
        setVedere(v => (m.vederi.some(x => x.vedere === v) ? v : (m.vederi[0]?.vedere || '')))
      } catch (e) { if (viu) setEroareManifest('Schema nodului nu se poate citi (vederi.json): ' + (e?.message || e)) }
    })()
    return () => { viu = false }
  }, [proiectId, nod, client])

  const vedereCurenta = manifest?.vederi.find(x => x.vedere === vedere) || null
  // ── imaginea vederii: signed URL scurt (10 min), refăcut la schimbarea vederii ──
  useEffect(() => {
    if (!vedereCurenta) { setImagine(null); return }
    const g = ++genImg.current
    setEroareImagine(null)
    client.storage.from(BUCKET).createSignedUrl(`${proiectId}/${nod}/${vedereCurenta.fisier}`, 600).then(({ data, error }) => {
      if (g !== genImg.current) return
      if (error || !data?.signedUrl) { setImagine(null); setEroareImagine('Imaginea vederii nu se poate citi: ' + (error?.message || 'fără URL')); return }
      setImagine({ url: data.signedUrl, vedere: vedereCurenta.vedere })
    }).catch(e => { if (g === genImg.current) { setImagine(null); setEroareImagine('Imaginea vederii nu se poate citi: ' + (e?.message || e)) } })
  }, [proiectId, nod, vedereCurenta, client])

  const c = useMemo(() => contor(aleNodului, azi), [aleNodului, azi])
  const dnuri = useMemo(() => [...new Set(aleNodului.map(s => s.dn).filter(Number.isInteger))].sort((a, b) => b - a), [aleNodului])
  const filtrate = useMemo(() => filtreaza(aleNodului, { stari, dn }), [aleNodului, stari, dn])
  // punctele vederii (principale + secundare), grupate pe coordonate identice (ex. rezervoarele „fără poziție pe planșă”)
  const peVedere = useMemo(() => puncteVedere(filtrate, vedere), [filtrate, vedere])
  const grupuri = useMemo(() => grupeazaPuncte(peVedere), [peVedere])
  const faraPunct = aleNodului.filter(s => s.vedere == null).length
  const pePeAlteVederi = filtrate.length - new Set(peVedere.map(p => p.sudura.id)).size
  const sudSel = aleNodului.find(s => String(s.id) === String(selectat)) || null
  const grupSel = grupuri.find(g => g.cheie === grupDeschis) || null

  const deschide = id => { setGrupDeschis(null); setSelectat(id); setMesaj(null); intentie.current = null }
  const atingePunct = cheie => {
    const g = grupuri.find(x => x.cheie === cheie)
    if (!g) return
    if (g.puncte.length === 1) deschide(g.puncte[0].sudura.id)
    else setGrupDeschis(cheie)
  }
  const inchide = () => { setSelectat(null); setMesaj(null); intentie.current = null }
  const schimbaSudor = v => { setSudor(v); scrieSesiune('nod_cuplare_sudor', v) }

  const salveaza = async ({ stareNoua, data, sudor: sud, buletin, motiv }) => {
    const s = sudSel
    if (!s) return
    // cheia apăsării: aceeași la reîncercarea aceleiași intenții (sudură + versiune + țintă); alta pentru o intenție nouă
    const k = `${s.id}|${s.versiune}|${stareNoua}`
    if (intentie.current?.k !== k) intentie.current = { k, cheie: cheieNoua() }
    setBusy(true); setMesaj(null)
    const { data: r, error } = await client.rpc('fn_executie_nod_sudura_stare', {
      p_id: s.id, p_stare_veche: s.stare, p_versiune: s.versiune, p_stare_noua: stareNoua, p_data: data,
      p_sudor: sud || null, p_buletin_ndt: buletin || null, p_motiv: motiv || null, p_cheie: intentie.current.cheie,
    })
    setBusy(false)
    if (error) {
      // L05: eroare de rețea / server = rezultat necunoscut — cheia rămâne, reîncercarea nu dublează
      setMesaj({ ok: false, text: 'Nu s-a salvat (sau nu se știe dacă s-a salvat): ' + error.message + '. Reîncearcă; dacă persistă, reîncarcă pagina.' })
      return
    }
    if (r?.sudura) setSuduri(list => list.map(x => (x.id === r.sudura.id ? { ...x, ...r.sudura } : x)))
    intentie.current = null
    if (r?.ok) { setMesaj({ ok: true, text: r.duplicat ? 'Era deja salvată.' : 'Salvat.' }); setTimeout(() => setSelectat(x => (String(x) === String(s.id) ? null : x)), 700) }
    else setMesaj({ ok: false, text: 'Sudura a fost schimbată între timp (altă apăsare sau alt utilizator). Am adus starea actuală — verifică și reîncearcă.' })
  }

  if (incarc && !suduri.length) return <Cadru><div style={{ color: G.dim, padding: 30, textAlign: 'center' }}>Se încarcă…</div></Cadru>
  if (eroare) return <Cadru><Alerta text={eroare} /><button onClick={incarca} style={{ ...S.btn, marginTop: 10 }}>Reîncearcă</button></Cadru>
  if (!noduri.length) return <Cadru><div style={{ color: G.muted, padding: 20, fontSize: 14 }}>Niciun nod de cuplare pe acest proiect (sau nu ai drept de citire pe Execuție). Lista sudurilor o încarcă chat-ul.</div></Cadru>

  return (
    <Cadru>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: G.text }}>🔩 Schema nod cuplare</div>
        {noduri.length > 1
          ? <select value={nod} onChange={e => { setNod(e.target.value); setSelectat(null); setGrupDeschis(null) }} style={{ ...S.input, width: 'auto', padding: '6px 10px', fontSize: 14 }}>{noduri.map(n => <option key={n} value={n}>{n}</option>)}</select>
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
        <SchemaVedere imagineUrl={imagine?.vedere === vedereCurenta.vedere ? imagine.url : null} w={vedereCurenta.w} h={vedereCurenta.h}
          grupuri={grupuri} selectatId={selectat} onSelect={atingePunct}
          onEroareImagine={() => setEroareImagine('Imaginea vederii nu s-a putut încărca (link expirat sau fișier lipsă). Reîncarcă pagina.')} />
      )}
      {eroareImagine && <Alerta text={eroareImagine} />}
      <div style={{ marginTop: 8, fontSize: 12, color: G.muted }}>
        Pe această vedere: {peVedere.length} · pe alte vederi (după filtre): {pePeAlteVederi} · fără punct pe schemă: {faraPunct}
      </div>
      <div style={{ marginTop: 8 }}><Legenda /></div>

      <ListaGrup grup={grupSel} onAlege={deschide} onInchide={() => setGrupDeschis(null)} />
      <FisaSudura sudura={sudSel} poateScrie={poateScrie} azi={azi} sudorSesiune={sudor} onSudorSesiune={schimbaSudor}
        onSalveaza={salveaza} onInchide={inchide} busy={busy} mesaj={mesaj} />
    </Cadru>
  )
}

function Cadru({ children }) {
  return <div style={{ padding: '14px 12px 30px', maxWidth: 1200, margin: '0 auto', color: G.text }}>{children}</div>
}
function Alerta({ text }) {
  return <div style={{ margin: '8px 0', padding: '9px 12px', borderRadius: 10, background: G.red + '1F', color: G.red, fontSize: 13, fontWeight: 600 }}>{text}</div>
}
