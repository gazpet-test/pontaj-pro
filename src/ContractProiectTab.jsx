// ═══════════════════════════════════════════════════════════════════════════
// ContractProiectTab.jsx — Execuție → proiect → „📜 Contract” (cererea lui Răzvan, 09.11.2026). Reutilizabil pe orice proiect.
// Fișa contractului: registrul evenimentelor (stare + următorul termen), căile de prelungire, termenele de notificare, clauzele principale,
// sursele. Citire: drept Execuție (RLS). Scriere: owner sau administrator Execuție, DOAR prin RPC-ul fn_executie_contract_salveaza
// (CAS pe versiune + cheie de idempotență per salvare). Arhivarea = activ false; nimic nu se șterge din aplicație.
// Date: executie_contract_repere (migrarea 20261203a). L24: încărcarea și salvarea au generația lor; un rezultat întârziat nu se aplică
// pe alt proiect sau pe altă fișă.
// ═══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './lib/supabase.js'
import { paginareKeyset } from './hrDeciziiUtil.js'
import { ziBucuresti } from './lib/izoTeren.js'
import {
  SECTIUNI_UI, STARI, PUTERI, STARE_INFO, PUTERE_INFO, CAMPURI, CAMPURI_DATA, COLOANE, LIMITE,
  fmtZi, urgenta, sorteaza, filtreaza, rezumat, codUrmator, formular, valideaza, payload, amprenta,
  aplicaRand, imbinaLista, mesajEroare, eAmbigua,
} from './executieContractRepere.js'

const G = {
  bg: '#0D1117', surface: '#161B22', surface2: '#1C2230', border: '#30363D', border2: '#21262D',
  text: '#E6EDF3', muted: '#8B949E', blue: '#58A6FF', green: '#3FB950', red: '#F85149', yellow: '#D29922', orange: '#F0883E', purple: '#BC8CFF',
}
const TON = { rosu: G.red, galben: G.yellow, albastru: G.blue, portocaliu: G.orange, verde: G.green, gri: G.muted }
const URG = { depasit: G.red, azi: G.red, urgent: G.red, curand: G.yellow, ok: G.green }
const S = {
  card: { background: G.surface, border: `1px solid ${G.border2}`, borderRadius: 12, padding: '10px 12px' },
  btn: { background: G.surface2, border: `1px solid ${G.border}`, color: G.text, borderRadius: 10, padding: '9px 14px', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  input: { background: G.bg, border: `1px solid ${G.border}`, color: G.text, borderRadius: 10, padding: '10px 12px', fontSize: 16, fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' },
  label: { fontSize: 12, color: G.muted, fontWeight: 600, display: 'block', marginBottom: 4 },
  chip: (activ, c) => ({ background: activ ? c + '33' : 'transparent', border: `1px solid ${activ ? c : G.border}`, color: activ ? G.text : G.muted, borderRadius: 999, padding: '6px 11px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }),
  badge: c => ({ display: 'inline-block', background: c + '22', color: c, border: `1px solid ${c}55`, borderRadius: 999, padding: '2px 8px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }),
}
const cheieNoua = () => globalThis.crypto.randomUUID()
const multiLinie = { whiteSpace: 'pre-wrap', wordBreak: 'break-word' }

function Badge({ text, culoare }) { return text ? <span style={S.badge(culoare)}>{text}</span> : null }

function Rezumat({ r }) {
  if (!r.total) return null
  return (
    <div style={{ ...S.card, marginBottom: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: r.urmatoare.length ? 8 : 0 }}>
        {STARI.filter(s => r.peStari[s]).map(s => <Badge key={s} text={`${STARE_INFO[s].label}: ${r.peStari[s]}`} culoare={TON[STARE_INFO[s].ton]} />)}
      </div>
      {r.urmatoare.length > 0 && (
        <div>
          <div style={{ fontSize: 12, color: G.muted, fontWeight: 700, marginBottom: 4 }}>Următoarele termene</div>
          {r.urmatoare.map(u => (
            <div key={u.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 13, padding: '3px 0', flexWrap: 'wrap' }}>
              <b style={{ color: URG[u.nivel] || G.text, minWidth: 82 }}>{fmtZi(u.termen)}</b>
              <Badge text={u.text} culoare={URG[u.nivel] || G.muted} />
              <span style={{ color: G.text }}>{u.cod} · {u.titlu}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Card({ x, deschis, onComuta, poateScrie, onEditeaza, azi }) {
  const u = x.sectiune === 'eveniment' ? urgenta(x.termen_urmator, azi) : null
  const deschisStare = ['de_notificat', 'in_curs', 'notificat', 'asteapta_raspuns', 'risc'].includes(x.stare)
  return (
    <div style={{ ...S.card, marginBottom: 8, opacity: x.activ === false ? 0.55 : 1 }}>
      <button onClick={onComuta} style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%' }} aria-expanded={deschis}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: G.muted }}>{x.cod}</span>
          <span style={{ fontSize: 15, fontWeight: 700, color: G.text, flex: '1 1 200px' }}>{x.titlu}</span>
          {x.activ === false && <Badge text="arhivat" culoare={G.muted} />}
        </div>
        {x.sectiune === 'eveniment' && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
            <Badge text={STARE_INFO[x.stare]?.label || x.stare} culoare={TON[STARE_INFO[x.stare]?.ton] || G.muted} />
            {x.termen_urmator && <Badge text={`${fmtZi(x.termen_urmator)}${deschisStare && u?.text ? ' · ' + u.text : ''}`} culoare={deschisStare ? (URG[u?.nivel] || G.muted) : G.muted} />}
            {x.putere && <Badge text={`putere: ${PUTERE_INFO[x.putere]?.label || x.putere}`} culoare={TON[PUTERE_INFO[x.putere]?.ton] || G.muted} />}
            {x.data_eveniment && <span style={{ fontSize: 12, color: G.muted }}>eveniment {fmtZi(x.data_eveniment)}</span>}
          </div>
        )}
        {x.sectiune !== 'eveniment' && x.clauze && <div style={{ fontSize: 12, color: G.blue, marginTop: 4 }}>{x.clauze}</div>}
      </button>
      {deschis && (
        <div style={{ marginTop: 10, borderTop: `1px solid ${G.border2}`, paddingTop: 8 }}>
          {CAMPURI[x.sectiune].filter(([c]) => x[c] != null && x[c] !== '' && !['stare', 'putere'].includes(c)).map(([c, et]) => (
            <div key={c} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: G.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px' }}>{et}</div>
              <div style={{ fontSize: 14, color: c === 'citat' ? G.yellow : G.text, ...multiLinie }}>{CAMPURI_DATA.includes(c) ? fmtZi(x[c]) : x[c]}</div>
            </div>
          ))}
          {poateScrie && <button style={{ ...S.btn, marginTop: 4 }} onClick={onEditeaza}>✏️ Editează</button>}
        </div>
      )}
    </div>
  )
}

function Formular({ f, setF, erori, nou, onSalveaza, onRenunta, inCurs, mesaj }) {
  const camp = (c, et) => {
    const lung = LIMITE[c] && LIMITE[c] > 600
    const val = f[c] ?? ''
    let input
    if (c === 'stare') input = <select style={S.input} value={val} onChange={e => setF({ ...f, stare: e.target.value })}>{STARI.map(s => <option key={s} value={s}>{STARE_INFO[s].label}</option>)}</select>
    else if (c === 'putere') input = <select style={S.input} value={val} onChange={e => setF({ ...f, putere: e.target.value })}><option value="">—</option>{PUTERI.map(p => <option key={p} value={p}>{PUTERE_INFO[p].label}</option>)}</select>
    else if (CAMPURI_DATA.includes(c)) input = <input type="date" style={S.input} value={val} onChange={e => setF({ ...f, [c]: e.target.value })} />
    else if (lung) input = <textarea rows={4} style={{ ...S.input, resize: 'vertical' }} value={val} maxLength={LIMITE[c]} onChange={e => setF({ ...f, [c]: e.target.value })} />
    else input = <input style={S.input} value={val} maxLength={LIMITE[c]} onChange={e => setF({ ...f, [c]: e.target.value })} />
    return (
      <div key={c} style={{ marginBottom: 10 }}>
        <label style={S.label}>{et}</label>{input}
        {erori[c] && <div style={{ color: G.red, fontSize: 12, marginTop: 3 }}>{erori[c]}</div>}
      </div>
    )
  }
  return (
    <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, background: '#000A', zIndex: 200, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', overflowY: 'auto', padding: '16px 10px' }}>
      <div style={{ ...S.card, width: '100%', maxWidth: 640, padding: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>{nou ? 'Rând nou' : `Editează ${f.cod}`} · {SECTIUNI_UI.find(s => s.key === f.sectiune)?.label}</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ width: 110 }}>
            <label style={S.label}>Cod</label>
            <input style={S.input} value={f.cod} disabled={!nou} onChange={e => setF({ ...f, cod: e.target.value.toUpperCase() })} />
            {erori.cod && <div style={{ color: G.red, fontSize: 12, marginTop: 3 }}>{erori.cod}</div>}
          </div>
          <div style={{ width: 90 }}>
            <label style={S.label}>Ordine</label>
            <input style={S.input} inputMode="numeric" value={f.ordine} onChange={e => setF({ ...f, ordine: e.target.value })} />
          </div>
        </div>
        <div style={{ marginTop: 10 }}>{camp('titlu', 'Titlu')}</div>
        {CAMPURI[f.sectiune].map(([c, et]) => camp(c, et))}
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, margin: '6px 0 12px' }}>
          <input type="checkbox" checked={f.activ === false} onChange={e => setF({ ...f, activ: !e.target.checked })} /> Arhivat (ascuns din listă)
        </label>
        {mesaj && <div style={{ color: mesaj.ton === 'ok' ? G.green : G.red, fontSize: 13, marginBottom: 10, ...multiLinie }}>{mesaj.text}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button style={S.btn} onClick={onRenunta} disabled={inCurs}>Renunță</button>
          <button style={{ ...S.btn, background: G.blue + '33', borderColor: G.blue }} onClick={onSalveaza} disabled={inCurs}>{inCurs ? 'Se salvează…' : 'Salvează'}</button>
        </div>
      </div>
    </div>
  )
}

// `client` se poate înlocui doar în teste (client fals); în aplicație e mereu clientul Supabase al sesiunii
export default function ContractProiectTab({ proiectId, client = supabase }) {
  const pid = Number(proiectId)
  const [randuri, setRanduri] = useState([])
  const [incarc, setIncarc] = useState(true)
  const [eroare, setEroare] = useState(null)
  const [poateScrie, setPoateScrie] = useState(false)
  const [eroareDrept, setEroareDrept] = useState(null)
  const [sectiune, setSectiune] = useState('eveniment')
  const [cauta, setCauta] = useState('')
  const [arhivate, setArhivate] = useState(false)
  const [deschis, setDeschis] = useState(null)
  const [fisa, setFisa] = useState(null)        // { nou, id, versiune, f }
  const [erori, setErori] = useState({})
  const [inCurs, setInCurs] = useState(false)
  const [mesaj, setMesaj] = useState(null)
  const [azi, setAzi] = useState(ziBucuresti())
  const gen = useRef(0)
  const fisaGen = useRef(0)
  const intentie = useRef(null)                 // { amprenta, cheie } — aceeași intenție = aceeași cheie la reîncercare (L04/L05)

  const incarca = useCallback(async () => {
    const g = ++gen.current
    setIncarc(true); setEroare(null); setEroareDrept(null)
    try {
      const [toate, drept] = await Promise.all([
        paginareKeyset((ultim, pas) => {
          let q = client.from('executie_contract_repere').select(COLOANE).eq('proiect_id', pid).order('id').limit(pas)
          if (ultim != null) q = q.gt('id', ultim)
          return q
        }),
        client.rpc('fn_executie_contract_drept', { p_proiect: pid, p_scriere: true }),
      ])
      if (g !== gen.current) return
      setRanduri(curente => imbinaLista(toate.filter(r => r.proiect_id === pid), curente))
      if (drept.error) { setPoateScrie(false); setEroareDrept('Nu am putut verifica dreptul de scriere: ' + drept.error.message) }
      else setPoateScrie(drept.data === true)
      setAzi(ziBucuresti())
    } catch (e) {
      if (g !== gen.current) return
      setRanduri([]); setEroare('Nu am putut încărca fișa contractului: ' + (e?.message || e))
    } finally { if (g === gen.current) setIncarc(false) }
  }, [pid, client])

  useEffect(() => {
    fisaGen.current += 1; intentie.current = null
    setRanduri([]); setFisa(null); setDeschis(null); setMesaj(null)
    incarca()
  }, [incarca])

  const vizibile = useMemo(() => sorteaza(filtreaza(randuri, { sectiune, text: cauta, arhivate }), sectiune), [randuri, sectiune, cauta, arhivate])
  const rez = useMemo(() => rezumat(randuri, azi), [randuri, azi])
  const numere = useMemo(() => Object.fromEntries(SECTIUNI_UI.map(s => [s.key, randuri.filter(x => x.sectiune === s.key && x.activ !== false).length])), [randuri])

  const deschideFisa = (rand) => {
    fisaGen.current += 1; intentie.current = null
    setErori({}); setMesaj(null)
    if (rand) setFisa({ nou: false, id: rand.id, versiune: rand.versiune, f: formular(rand.sectiune, rand) })
    else setFisa({ nou: true, id: null, versiune: null, f: { ...formular(sectiune), cod: codUrmator(randuri, sectiune) } })
  }
  const inchideFisa = () => { fisaGen.current += 1; intentie.current = null; setFisa(null); setErori({}); setMesaj(null) }

  const salveaza = async () => {
    if (!fisa || inCurs) return
    const v = valideaza(fisa.f, { nou: fisa.nou })
    setErori(v.erori)
    if (!v.ok) return
    const p = payload(fisa.f, { nou: fisa.nou })
    const a = amprenta(pid, fisa.id, fisa.versiune, p)
    if (!intentie.current || intentie.current.amprenta !== a) intentie.current = { amprenta: a, cheie: cheieNoua() }
    const { cheie } = intentie.current
    const fg = fisaGen.current, g = gen.current
    setInCurs(true); setMesaj(null)
    try {
      const { data, error } = await client.rpc('fn_executie_contract_salveaza', { p_proiect: pid, p_id: fisa.id, p_versiune: fisa.versiune, p_date: p, p_cheie: cheie })
      if (g !== gen.current) return                               // alt proiect / altă încărcare: nimic nu se aplică
      if (data?.rand) setRanduri(l => aplicaRand(l, data.rand))   // rândul serverului intră în listă doar dacă e mai nou
      if (fg !== fisaGen.current) return                          // fișa s-a închis / schimbat între timp
      if (error) {
        if (eAmbigua(error)) { setMesaj({ ton: 'eroare', text: 'Rezultat necunoscut (rețea). Apasă din nou „Salvează”: se reia aceeași salvare, fără dublură.' }); return }
        intentie.current = null
        setMesaj({ ton: 'eroare', text: mesajEroare(error) }); return
      }
      if (data?.ok === false && data?.motiv === 'conflict') {
        intentie.current = null
        setMesaj({ ton: 'eroare', text: 'Rândul a fost modificat între timp de altcineva. Am reîncărcat valorile: verifică și salvează din nou.' })
        if (data.rand) setFisa(fs => (fs && fs.id === data.rand.id ? { ...fs, versiune: data.rand.versiune, f: formular(data.rand.sectiune, data.rand) } : fs))
        return
      }
      if (data?.ok !== true || !data?.rand) { setMesaj({ ton: 'eroare', text: 'Răspuns neașteptat de la server; reîncarcă pagina.' }); return }
      intentie.current = null
      if (data.rand.sectiune !== sectiune) setSectiune(data.rand.sectiune)
      setDeschis(data.rand.id)
      fisaGen.current += 1
      setFisa(null)
    } catch (e) {
      if (fg !== fisaGen.current || g !== gen.current) return
      setMesaj({ ton: 'eroare', text: 'Rezultat necunoscut (' + (e?.message || 'rețea') + '). Apasă din nou „Salvează”: se reia aceeași salvare.' })
    } finally { setInCurs(false) }
  }

  return (
    <div style={{ padding: '14px 12px 40px', maxWidth: 980, margin: '0 auto', color: G.text }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ fontSize: 18, fontWeight: 800, flex: 1 }}>📜 Contract</div>
        <button style={S.btn} onClick={incarca} disabled={incarc}>{incarc ? 'Se încarcă…' : '↻ Reîncarcă'}</button>
        {poateScrie && <button style={{ ...S.btn, background: G.blue + '22', borderColor: G.blue }} onClick={() => deschideFisa(null)}>＋ Adaugă</button>}
      </div>
      {eroare && <div style={{ ...S.card, borderColor: G.red, color: G.red, marginBottom: 10 }}>{eroare}</div>}
      {eroareDrept && <div style={{ fontSize: 12, color: G.yellow, marginBottom: 8 }}>{eroareDrept}</div>}
      {!incarc && !eroare && randuri.length === 0 && (
        <div style={{ ...S.card, color: G.muted, marginBottom: 10 }}>Fișa contractului e goală pentru acest proiect.{poateScrie ? ' Adaugă primul rând cu „＋ Adaugă”.' : ''}</div>
      )}
      <Rezumat r={rez} />
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 6, marginBottom: 8 }}>
        {SECTIUNI_UI.map(s => (
          <button key={s.key} style={S.chip(sectiune === s.key, G.blue)} onClick={() => { setSectiune(s.key); setDeschis(null) }} title={s.label}>
            {s.icon} {s.scurt} <span style={{ color: G.muted }}>{numere[s.key] || 0}</span>
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <input style={{ ...S.input, flex: '1 1 220px' }} placeholder="Caută (cod, titlu, clauză, text)…" value={cauta} onChange={e => setCauta(e.target.value)} />
        <label style={{ fontSize: 13, color: G.muted, display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={arhivate} onChange={e => setArhivate(e.target.checked)} /> arată arhivate
        </label>
      </div>
      {vizibile.map(x => (
        <Card key={x.id} x={x} azi={azi} deschis={deschis === x.id} onComuta={() => setDeschis(d => (d === x.id ? null : x.id))}
          poateScrie={poateScrie} onEditeaza={() => deschideFisa(x)} />
      ))}
      {!incarc && randuri.length > 0 && vizibile.length === 0 && <div style={{ color: G.muted, fontSize: 13 }}>Niciun rând în această secțiune{cauta ? ' pentru căutarea curentă' : ''}.</div>}
      {fisa && (
        <Formular f={fisa.f} setF={f => setFisa(fs => (fs ? { ...fs, f } : fs))} erori={erori} nou={fisa.nou}
          onSalveaza={salveaza} onRenunta={inchideFisa} inCurs={inCurs} mesaj={mesaj} />
      )}
    </div>
  )
}
