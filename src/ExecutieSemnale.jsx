// „🔔 Semnale” — Execuție (agentul verificator, faza 1; migrarea 20270106a).
// Agentul de noapte scrie semnale (DOAR el, prin RPC-ul lui); oamenii le văd și le schimbă starea (cu motiv) sau responsabilul, prin
// fn_executie_semnal_stare (CAS pe versiune: 0 rânduri = conflict → lista se reîncarcă). Două ecrane din aceeași componentă:
//   * <ExecutieSemnale proiectId={…} />           — fila proiectului (toate semnalele proiectului pe care contul le poate citi);
//   * <ExecutieSemnale mod="toate" />              — lista owner-ului, toate proiectele (RLS-ul dă exact ce are voie contul).
// Citirea: v_executie_semnale (security_invoker) prin paginare keyset pe id (L23); numele responsabililor din employees, separat.
// Orice încărcare / acțiune are token de generație (L24): un răspuns întârziat al proiectului vechi nu se aplică. Eroarea NU e listă goală (L18).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './lib/supabase.js'
import { paginareKeyset } from './hrDeciziiUtil.js'
import { ziBucuresti } from './lib/izoTeren.js'
import { G, S } from './NodCuplareVizualizare.jsx'
import {
  STARI, STARE_INFO, GRAVITATI, GRAVITATE_INFO, FLUXURI, FLUX_INFO, CONSTATARE_INFO, STARI_DESCHISE,
  stariUrmatoare, motivObligatoriu, fmtZi, fmtMoment, zilePanaLa, filtreaza, sorteaza, rezumat, dovadaText, eLink, parametriStare, validareStare,
} from './executieSemnaleLogica.js'

const TON = { rosu: G.red, galben: G.yellow, albastru: G.blue, portocaliu: '#F0883E', verde: G.green, gri: G.muted }
const Sx = {
  card: { background: G.surface, border: `1px solid ${G.border2}`, borderRadius: 12, padding: '10px 12px' },
  badge: c => ({ display: 'inline-block', background: c + '22', border: `1px solid ${c}66`, color: c, borderRadius: 999, padding: '2px 9px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }),
  mic: { fontSize: 12, color: G.muted },
  eroare: { background: G.red + '18', border: `1px solid ${G.red}66`, color: G.text, borderRadius: 10, padding: '10px 12px', fontSize: 13 },
  ok: { background: G.green + '18', border: `1px solid ${G.green}66`, color: G.text, borderRadius: 10, padding: '8px 12px', fontSize: 13 },
}
const Badge = ({ text, culoare }) => (text ? <span style={Sx.badge(culoare)}>{text}</span> : null)
const COLOANE = '*'
const MIGRARE_LIPSA = /v_executie_semnale|fn_executie_semnal_stare|does not exist|42P01|42883/i

// mesajul unei erori a clientului (L18: eroarea se arată, nu se confundă cu „nimic de arătat”)
const textEroare = e => {
  const m = e?.message || String(e || 'eroare necunoscută')
  if (MIGRARE_LIPSA.test(m)) return 'Semnalele nu sunt disponibile încă (baza de date nu are migrarea 20270106a aplicată).'
  return m
}

export default function ExecutieSemnale({ proiectId = null, client = supabase, mod = 'proiect', azi = ziBucuresti() }) {
  const pid = mod === 'toate' ? null : Number(proiectId)
  const [randuri, setRanduri] = useState([])
  const [nume, setNume] = useState({})                 // employee_id -> name (responsabilii din listă)
  const [angajati, setAngajati] = useState(null)       // lista pentru schimbarea responsabilului (la cerere)
  const [incarc, setIncarc] = useState(true)
  const [eroare, setEroare] = useState(null)
  const [mesaj, setMesaj] = useState(null)
  const [filtre, setFiltre] = useState({ gravitati: [], stari: [], fluxuri: [], text: '', doarDeschise: true })
  const [ordine, setOrdine] = useState('termen')
  const [deschis, setDeschis] = useState(null)         // id-ul semnalului cu detaliile deschise
  const [jurnal, setJurnal] = useState({})             // id -> { randuri | eroare }
  const [form, setForm] = useState(null)               // { id, stare, motiv, dovada, actiuneRef, responsabil, schimbaResponsabil }
  const [inCurs, setInCurs] = useState(false)
  const gen = useRef(0)
  const opGen = useRef(0)

  const incarca = useCallback(async () => {
    const g = ++gen.current
    setIncarc(true); setEroare(null)
    try {
      const toate = await paginareKeyset((ultim, pas) => {
        let q = client.from('v_executie_semnale').select(COLOANE).order('id').limit(pas)
        if (pid != null) q = q.eq('proiect_id', pid)
        if (ultim != null) q = q.gt('id', ultim)
        return q
      })
      if (g !== gen.current) return
      const lista = pid != null ? toate.filter(r => Number(r.proiect_id) === pid) : toate
      setRanduri(lista)
      const ids = [...new Set(lista.map(r => r.responsabil_employee_id).filter(x => x != null))]
      if (ids.length) {
        const { data, error } = await client.from('employees').select('id, name').in('id', ids)
        if (g !== gen.current) return
        if (!error) setNume(Object.fromEntries((data || []).map(e => [e.id, e.name])))
      } else setNume({})
    } catch (e) {
      if (g !== gen.current) return
      setRanduri([]); setEroare('Nu am putut încărca semnalele: ' + textEroare(e))
    } finally { if (g === gen.current) setIncarc(false) }
  }, [pid, client])

  useEffect(() => {
    opGen.current += 1
    setRanduri([]); setDeschis(null); setForm(null); setMesaj(null); setJurnal({}); setInCurs(false)
    incarca()
    return () => { gen.current += 1; opGen.current += 1 }
  }, [incarca])

  const vizibile = useMemo(() => sorteaza(filtreaza(randuri, filtre), ordine), [randuri, filtre, ordine])
  const rez = useMemo(() => rezumat(randuri), [randuri])
  const comuta = (cheie, val) => setFiltre(f => ({ ...f, [cheie]: f[cheie].includes(val) ? f[cheie].filter(x => x !== val) : [...f[cheie], val] }))

  async function incarcaJurnal(id) {
    const g = gen.current
    try {
      const rows = await paginareKeyset((ultim, pas) => {
        let q = client.from('executie_semnale_jurnal').select('*').eq('semnal_id', id).order('id').limit(pas)
        if (ultim != null) q = q.gt('id', ultim)
        return q
      })
      if (g !== gen.current) return
      setJurnal(j => ({ ...j, [id]: { randuri: rows } }))
    } catch (e) { if (g === gen.current) setJurnal(j => ({ ...j, [id]: { eroare: textEroare(e) } })) }
  }
  const deschide = id => {
    const nou = deschis === id ? null : id
    setDeschis(nou); setForm(null)
    if (nou != null && !jurnal[nou]) incarcaJurnal(nou)
  }
  async function deschideForm(r) {
    setForm({ id: r.id, stare: r.stare, motiv: '', dovada: '', actiuneRef: r.actiune_ref || '', responsabil: r.responsabil_employee_id ?? '', schimbaResponsabil: false })
    setMesaj(null)
    if (!angajati) {
      const g = gen.current
      try {
        const lista = await paginareKeyset((ultim, pas) => {
          let q = client.from('employees').select('id, name, active').order('id').limit(pas)
          if (ultim != null) q = q.gt('id', ultim)
          return q
        })
        if (g !== gen.current) return
        setAngajati(lista.filter(e => e.active !== false).sort((a, b) => String(a.name).localeCompare(String(b.name), 'ro')))
      } catch (e) { if (g === gen.current) setAngajati({ eroare: textEroare(e) }) }
    }
  }

  async function salveaza(r) {
    const v = validareStare(r, form)
    if (v) { setMesaj({ tip: 'eroare', text: v }); return }
    const op = ++opGen.current
    setInCurs(true); setMesaj(null)
    try {
      const { data, error } = await client.rpc('fn_executie_semnal_stare', parametriStare(r, form))
      if (op !== opGen.current) return
      if (error) { setMesaj({ tip: 'eroare', text: 'Schimbarea nu s-a salvat: ' + textEroare(error) }); return }
      if (!data || data.ok !== true) {
        if (data?.motiv === 'conflict') { setMesaj({ tip: 'eroare', text: 'Semnalul s-a schimbat între timp (altcineva a lucrat pe el). Lista s-a reîncărcat; verifică și reia.' }); setForm(null); incarca(); return }
        setMesaj({ tip: 'eroare', text: 'Răspuns neașteptat de la server: ' + JSON.stringify(data).slice(0, 200) }); return
      }
      const s = data.semnal
      setRanduri(lista => lista.map(x => (x.id === s.id ? { ...x, ...s } : x)))
      if (s.responsabil_employee_id != null && !nume[s.responsabil_employee_id]) {
        const e = Array.isArray(angajati) ? angajati.find(a => a.id === s.responsabil_employee_id) : null
        if (e) setNume(n => ({ ...n, [e.id]: e.name }))
      }
      setForm(null); setJurnal(j => { const c = { ...j }; delete c[s.id]; return c })
      if (deschis === s.id) incarcaJurnal(s.id)
      setMesaj({ tip: 'ok', text: `Salvat: ${STARE_INFO[s.stare]?.label || s.stare}.` })
    } catch (e) {
      if (op !== opGen.current) return
      setMesaj({ tip: 'eroare', text: 'Schimbarea nu s-a salvat (rezultat necunoscut, verifică lista): ' + textEroare(e) }); incarca()
    } finally { if (op === opGen.current) setInCurs(false) }
  }

  const titlu = mod === 'toate' ? '🔔 Semnale — toate proiectele' : '🔔 Semnale'
  return (
    <div style={{ padding: mod === 'toate' ? 0 : '16px 28px', color: G.text, fontFamily: 'inherit' }} data-ecran="semnale">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ fontSize: 16, fontWeight: 800 }}>{titlu}</div>
        <span style={Sx.mic}>semnalele agentului verificator: el le scrie, oamenii decid · {rez.deschise} deschise din {rez.total}</span>
        <button type="button" onClick={incarca} disabled={incarc} style={{ ...S.btn, padding: '6px 10px', fontSize: 12, marginLeft: 'auto' }}>↻ Reîncarcă</button>
      </div>
      {eroare && <div style={{ ...Sx.eroare, marginBottom: 10 }}>⚠️ {eroare} <button type="button" onClick={incarca} style={{ ...S.btn, padding: '4px 10px', fontSize: 12, marginLeft: 8 }}>Reîncearcă</button></div>}
      {/* filtre */}
      <div style={{ ...Sx.card, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        {GRAVITATI.map(g => <button key={g} type="button" onClick={() => comuta('gravitati', g)} style={S.chip(filtre.gravitati.includes(g), TON[GRAVITATE_INFO[g].ton])}>{GRAVITATE_INFO[g].label} {rez[g] ? `· ${rez[g]}` : ''}</button>)}
        <span style={{ color: G.border }}>|</span>
        {STARI.map(s => <button key={s} type="button" onClick={() => comuta('stari', s)} style={S.chip(filtre.stari.includes(s), TON[STARE_INFO[s].ton])}>{STARE_INFO[s].label}{rez.stari[s] ? ` · ${rez.stari[s]}` : ''}</button>)}
        <span style={{ color: G.border }}>|</span>
        {FLUXURI.map(f => <button key={f} type="button" onClick={() => comuta('fluxuri', f)} style={S.chip(filtre.fluxuri.includes(f), G.purple)}>{FLUX_INFO[f]}</button>)}
        <input value={filtre.text} onChange={e => setFiltre(f => ({ ...f, text: e.target.value }))} placeholder="caută în titlu / obiect / propunere" aria-label="caută" style={{ ...S.input, width: 240, padding: '6px 10px', fontSize: 13 }} />
        <label style={{ ...Sx.mic, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={!filtre.doarDeschise} onChange={e => setFiltre(f => ({ ...f, doarDeschise: !e.target.checked }))} /> arată și rezolvate / respinse
        </label>
        <select value={ordine} onChange={e => setOrdine(e.target.value)} aria-label="ordine" style={{ ...S.input, width: 'auto', padding: '6px 10px', fontSize: 13 }}>
          <option value="termen">după termen</option>
          <option value="gravitate">după gravitate</option>
        </select>
      </div>
      {mesaj && <div style={{ ...(mesaj.tip === 'ok' ? Sx.ok : Sx.eroare), marginBottom: 10 }}>{mesaj.text}</div>}
      {incarc && <div style={{ ...Sx.mic, padding: 8 }}>Se încarcă semnalele…</div>}
      {!incarc && !eroare && vizibile.length === 0 && (
        <div style={{ ...Sx.mic, padding: 8 }}>{randuri.length === 0 ? 'Niciun semnal pe care să-l poți vedea aici.' : 'Niciun semnal nu trece filtrele alese.'}</div>
      )}
      {vizibile.map(r => {
        const zile = zilePanaLa(r.termen, azi)
        const culTermen = zile == null ? G.muted : zile < 0 ? G.red : zile <= 7 ? G.red : zile <= 30 ? G.yellow : G.green
        const estDeschis = deschis === r.id
        const j = jurnal[r.id]
        const fm = form && form.id === r.id ? form : null
        return (
          <div key={r.id} style={{ ...Sx.card, marginBottom: 8, borderColor: GRAVITATE_INFO[r.gravitate] ? TON[GRAVITATE_INFO[r.gravitate].ton] + '55' : G.border2 }} data-semnal={r.id}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Badge text={GRAVITATE_INFO[r.gravitate]?.label || r.gravitate} culoare={TON[GRAVITATE_INFO[r.gravitate]?.ton] || G.muted} />
              {mod === 'toate' && <span style={{ fontSize: 12, fontWeight: 800, color: G.blue }}>{r.proiect_cod || `#${r.proiect_id}`}</span>}
              <button type="button" onClick={() => deschide(r.id)} style={{ background: 'transparent', border: 'none', color: G.text, fontSize: 15, fontWeight: 700, cursor: 'pointer', textAlign: 'left', flex: '1 1 200px', fontFamily: 'inherit', padding: 0 }}>
                {r.titlu}
              </button>
              <Badge text={STARE_INFO[r.stare]?.label || r.stare} culoare={TON[STARE_INFO[r.stare]?.ton] || G.muted} />
              {r.termen && <Badge text={`termen ${fmtZi(r.termen)}${zile != null ? (zile < 0 ? ` · depășit cu ${-zile} z` : ` · ${zile} z`) : ''}${r.termen_confirmat === false ? ' · neconfirmat' : ''}`} culoare={culTermen} />}
            </div>
            <div style={{ ...Sx.mic, marginTop: 4, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <span>{FLUX_INFO[r.flux] || r.flux} · {r.tip} · {r.obiect}</span>
              <span>responsabil: <b style={{ color: G.text }}>{r.responsabil_employee_id != null ? (nume[r.responsabil_employee_id] || `angajat #${r.responsabil_employee_id}`) : '—'}</b>{r.responsabil_sursa === 'agent' ? ' (propus de agent)' : ''}</span>
              <span>detectat {fmtMoment(r.detectat_la)} · verificat {fmtMoment(r.ultima_verificare)}</span>
            </div>
            {estDeschis && (
              <div style={{ marginTop: 8, display: 'grid', gap: 6, fontSize: 13 }}>
                {r.detalii && <div>{r.detalii}</div>}
                <div><span style={Sx.mic}>constatare: </span>{CONSTATARE_INFO[r.constatare] || r.constatare}</div>
                <div><span style={Sx.mic}>dovadă: </span>{dovadaText(r) || '—'}
                  {r.dovada_ref && r.constatare !== 'camp_lipsa' && <> · {eLink(r.dovada_ref) ? <a href={r.dovada_ref} target="_blank" rel="noreferrer" style={{ color: G.blue }}>link</a> : <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.dovada_ref}</span>}</>}
                </div>
                {r.constatare === 'constatat' && r.surse_consultate?.length > 0 && <div style={Sx.mic}>surse consultate: {r.surse_consultate.join(', ')}</div>}
                {r.termen && <div><span style={Sx.mic}>termen: </span>{fmtZi(r.termen)}{r.termen_baza ? ` · baza: ${r.termen_baza}` : ''} · {r.termen_confirmat ? 'confirmat' : 'NECONFIRMAT'}</div>}
                {r.incertitudine && <div><span style={Sx.mic}>incertitudine: </span>{r.incertitudine}</div>}
                {r.propunere && <div><span style={Sx.mic}>propunere: </span>{r.propunere}</div>}
                {r.stare !== 'nou' && <div><span style={Sx.mic}>decizia: </span>{STARE_INFO[r.stare]?.label} · {r.stare_motiv || '—'}{r.stare_dovada ? ` · dovadă: ${r.stare_dovada}` : ''}{r.actiune_ref ? ` · acțiune: ${r.actiune_ref}` : ''} · {fmtMoment(r.stare_la)}</div>}
                <div style={Sx.mic}>regula {r.regula_versiune} · versiunea rândului {r.versiune}</div>
                {!fm && <div><button type="button" onClick={() => deschideForm(r)} style={{ ...S.btn, padding: '6px 12px', fontSize: 13 }}>✏️ Schimbă starea / responsabilul</button></div>}
                {fm && (
                  <div style={{ ...Sx.card, background: G.bg, display: 'grid', gap: 8 }} role="form" aria-label="schimbă starea">
                    <label style={S.label}>Stare nouă
                      <select value={fm.stare} onChange={e => setForm(f => ({ ...f, stare: e.target.value }))} aria-label="stare nouă" style={{ ...S.input, marginTop: 4 }}>
                        <option value={r.stare}>{STARE_INFO[r.stare]?.label} (neschimbată)</option>
                        {stariUrmatoare(r.stare).map(s => <option key={s} value={s}>{STARE_INFO[s].label}</option>)}
                      </select>
                    </label>
                    <label style={S.label}>Motiv{motivObligatoriu(r.stare, fm.stare) ? ' (obligatoriu)' : ''}
                      <textarea value={fm.motiv} onChange={e => setForm(f => ({ ...f, motiv: e.target.value }))} aria-label="motiv" rows={2} style={{ ...S.input, marginTop: 4, fontSize: 14 }} placeholder="de ce / ce s-a făcut" />
                    </label>
                    <label style={S.label}>Dovada (document, mail, act adițional)
                      <input value={fm.dovada} onChange={e => setForm(f => ({ ...f, dovada: e.target.value }))} aria-label="dovada" style={{ ...S.input, marginTop: 4, fontSize: 14 }} />
                    </label>
                    <label style={S.label}>Acțiunea rezultată (nr. tichet / adresă)
                      <input value={fm.actiuneRef} onChange={e => setForm(f => ({ ...f, actiuneRef: e.target.value }))} aria-label="acțiune" style={{ ...S.input, marginTop: 4, fontSize: 14 }} />
                    </label>
                    <label style={{ ...Sx.mic, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                      <input type="checkbox" checked={fm.schimbaResponsabil} onChange={e => setForm(f => ({ ...f, schimbaResponsabil: e.target.checked }))} aria-label="schimbă responsabilul" /> schimbă responsabilul
                    </label>
                    {fm.schimbaResponsabil && (Array.isArray(angajati) ? (
                      <select value={fm.responsabil ?? ''} onChange={e => setForm(f => ({ ...f, responsabil: e.target.value }))} aria-label="responsabil" style={S.input}>
                        <option value="">— fără responsabil —</option>
                        {angajati.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                    ) : angajati?.eroare ? <div style={Sx.eroare}>Lista angajaților nu s-a putut încărca: {angajati.eroare}</div> : <div style={Sx.mic}>Se încarcă angajații…</div>)}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" onClick={() => salveaza(r)} disabled={inCurs} style={{ ...S.btn, background: G.blue + '33', borderColor: G.blue }}>{inCurs ? 'Se salvează…' : 'Salvează'}</button>
                      <button type="button" onClick={() => setForm(null)} disabled={inCurs} style={S.btn}>Renunță</button>
                    </div>
                  </div>
                )}
                <div style={{ marginTop: 4 }}>
                  <div style={{ ...Sx.mic, fontWeight: 700, marginBottom: 4 }}>Istoric</div>
                  {!j && <div style={Sx.mic}>Se încarcă istoricul…</div>}
                  {j?.eroare && <div style={Sx.eroare}>Istoricul nu s-a putut încărca: {j.eroare}</div>}
                  {j?.randuri && j.randuri.length === 0 && <div style={Sx.mic}>—</div>}
                  {j?.randuri?.map(x => (
                    <div key={x.id} style={{ ...Sx.mic, padding: '3px 0', borderTop: `1px solid ${G.border2}` }}>
                      {fmtMoment(x.creat_la)} · <b style={{ color: G.text }}>{x.actiune}</b> · {x.actor === 'agent' ? 'agent' : 'om'}
                      {x.stare_veche || x.stare_noua ? ` · ${STARE_INFO[x.stare_veche]?.label || x.stare_veche || '—'} → ${STARE_INFO[x.stare_noua]?.label || x.stare_noua || '—'}` : ''}
                      {x.motiv ? ` · ${x.motiv}` : ''}{x.dovada ? ` · dovadă: ${x.dovada}` : ''}
                      {x.valori && Object.keys(x.valori).length > 0 && x.actiune !== 'creat' ? ` · schimbat: ${Object.keys(x.valori).join(', ')}` : ''}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      })}
      {!incarc && !eroare && randuri.length > 0 && <div style={{ ...Sx.mic, marginTop: 6 }}>{vizibile.length} din {randuri.length} semnale · {STARI_DESCHISE.length} stări deschise (nou, în lucru, așteaptă informații)</div>}
    </div>
  )
}

/** Panoul owner-ului din Execuție → Proiecte: închis implicit, lista tuturor proiectelor se încarcă la deschidere. */
export function SemnaleOwnerPanel({ client = supabase }) {
  const [deschis, setDeschis] = useState(false)
  return (
    <div style={{ padding: '12px 28px 0' }}>
      <button type="button" onClick={() => setDeschis(d => !d)} style={{ ...S.btn, padding: '8px 14px', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 8 }} aria-expanded={deschis}>
        🔔 Semnale — toate proiectele {deschis ? '▴' : '▾'}
      </button>
      {deschis && <div style={{ marginTop: 10 }}><ExecutieSemnale mod="toate" client={client} /></div>}
    </div>
  )
}
