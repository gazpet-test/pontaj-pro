import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from './lib/supabase.js'
import { ADMIN_ALERTE_KEY, SURSE_ADMIN, areAccesAdministrator, incarcaSursaAdmin, sorteazaAlerte } from './adminAlerte.js'

const G = { bg: '#0D1117', surface: '#161B22', border: '#30363D', text: '#E6EDF3', muted: '#8B949E', blue: '#58A6FF', green: '#3FB950', red: '#F85149', yellow: '#D29922' }
const S = {
  panel: { background: G.surface, border: `1px solid ${G.border}`, borderRadius: 12, padding: 18 },
  button: { background: G.surface, color: G.text, border: `1px solid ${G.border}`, borderRadius: 7, padding: '9px 12px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 },
  small: { color: G.muted, fontSize: 12, lineHeight: 1.6 },
  row: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
}
const PRIORITATI = { critical: ['Critică', G.red], week: ['În 7 zile', G.yellow], attention: ['De urmărit', G.blue], missing: ['Date lipsă', G.muted] }
const STARI = { idle: 'Neevaluată', loading: 'Se evaluează', ok: 'Evaluată', denied: 'Acces insuficient', error: 'Eroare de citire' }
const initial = () => Object.fromEntries(SURSE_ADMIN.map(s => [s.id, { state: 'idle', rows: [] }]))
const sourceById = Object.fromEntries(SURSE_ADMIN.map(s => [s.id, s]))
const fmtDate = value => value ? new Date(`${value}T00:00:00`).toLocaleDateString('ro-RO') : 'Necunoscut'
const fmtTime = value => value ? new Date(value).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Bucharest' }) : '—'
const money = row => Number.isFinite(row.amount) ? `${row.amount.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${row.currency || 'monedă neprecizată'}` : 'Valoare necunoscută'

function Badge({ children, color = G.muted }) {
  return <span style={{ color, background: color + '18', borderRadius: 5, padding: '3px 7px', fontSize: 12, fontWeight: 600 }}>{children}</span>
}

function RandAlerta({ item, evaluatedAt, openSource }) {
  const [expanded, setExpanded] = useState(false)
  const [label, color] = PRIORITATI[item.priority]
  const source = sourceById[item.source]
  return <article style={{ padding: 18, borderBottom: `1px solid ${G.border}` }}>
    <div style={{ ...S.row, justifyContent: 'space-between' }}>
      <div style={S.row}><Badge color={color}>{label}</Badge><span style={S.small}>{source.label}</span></div>
      <span style={S.small}>{item.estimated ? 'Estimare' : 'Termen'} · {item.timestamp ? new Date(item.timestamp).toLocaleString('ro-RO', { timeZone: 'Europe/Bucharest', dateStyle: 'short', timeStyle: 'short' }) : fmtDate(item.date)}</span>
    </div>
    <h3 style={{ fontSize: 15, margin: '11px 0 5px' }}>{item.title}</h3>
    {item.reference && <div style={S.small}>{item.reference}</div>}
    <p style={{ fontSize: 13, lineHeight: 1.6, margin: '8px 0' }}>{item.impact}</p>
    {item.amount != null && <div style={{ fontWeight: 700, marginBottom: 9 }}>{money(item)} · sold rămas</div>}
    <div style={S.small}>Responsabil: {item.owner}</div>
    <div style={{ ...S.row, justifyContent: 'space-between', marginTop: 12 }}>
      <div style={S.row}>
        <button type="button" style={{ ...S.button, color: G.blue }} onClick={() => openSource(source.path)}>Deschide {source.label} ↗</button>
        <button type="button" style={S.button} aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>{expanded ? 'Închide detaliile' : 'De ce apare'}</button>
      </div>
      <span style={S.small}>Evaluată · {fmtTime(evaluatedAt)}</span>
    </div>
    {expanded && <div style={{ marginTop: 12, padding: 12, borderRadius: 7, background: G.bg, fontSize: 13, lineHeight: 1.7 }}>
      <p>{item.reason}</p>
      <p style={{ ...S.small, marginTop: 7 }}>Sursă: {item.locator}. Folosește referința de mai sus pentru identificarea înregistrării în modulul sursă.</p>
      <p style={{ ...S.small, marginTop: 7 }}>Citirea alertei nu închide problema. Remedierea se face în evidența originală.</p>
    </div>}
  </article>
}

export default function AdministratorAlerte({ profile }) {
  const nav = useNavigate()
  const [sources, setSources] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [accessMessage, setAccessMessage] = useState('')
  const [priority, setPriority] = useState('all')
  const [moduleFilter, setModuleFilter] = useState('all')
  const [showSources, setShowSources] = useState(false)
  const [page, setPage] = useState(1)
  const request = useRef(0)
  const controller = useRef(null)
  const allowed = areAccesAdministrator(profile)

  const load = useCallback(async () => {
    const run = ++request.current
    controller.current?.abort()
    const abort = new AbortController()
    controller.current = abort
    // Nu păstrăm informații ale unei sesiuni anterioare și nu numărăm rezultate vechi ca actuale.
    setSources(initial()); setAccessMessage(''); setBusy(true)
    const timeout = setTimeout(() => abort.abort(), 30000)
    try {
      if (!profile?.id || !allowed) throw new Error('Accesul la Modulul Administratorului nu este acordat explicit.')
      const { data: auth, error: authError } = await supabase.auth.getUser()
      if (authError || auth?.user?.id !== profile.id) throw new Error('Sesiunea nu a putut fi verificată. Reconectează-te.')
      // Revalidare la fiecare încărcare: nu ne bazăm numai pe profilul din meniul ERP.
      const [rights, person] = await Promise.all([
        supabase.from('user_module_access').select('module').eq('profile_id', profile.id).abortSignal(abort.signal),
        supabase.from('profiles').select('id,name,is_owner').eq('id', profile.id).single().abortSignal(abort.signal),
      ])
      if (rights.error || person.error || !person.data) throw new Error('Nu s-au putut verifica drepturile. Nu au fost încărcate alertele.')
      const fresh = { ...person.data, module_access: (rights.data || []).map(r => r.module) }
      if (!areAccesAdministrator(fresh)) throw new Error(`Acces neacordat: ${ADMIN_ALERTE_KEY}. Acordarea se face explicit, după aprobarea lui Răzvan.`)
      if (run !== request.current || abort.signal.aborted) return
      setSources(Object.fromEntries(SURSE_ADMIN.map(s => [s.id, { state: 'loading', rows: [] }])))
      const now = new Date()
      await Promise.all(SURSE_ADMIN.map(async source => {
        const result = await incarcaSursaAdmin(supabase, source, fresh, { signal: abort.signal, now })
        if (run === request.current) setSources(prev => ({ ...prev, [source.id]: result }))
      }))
    } catch (error) {
      if (run === request.current) setAccessMessage(error.message || 'Încărcare nereușită.')
    } finally {
      clearTimeout(timeout)
      if (run === request.current) setBusy(false)
    }
  }, [profile?.id, allowed])

  useEffect(() => {
    load()
    return () => { request.current++; controller.current?.abort() }
  }, [load])
  useEffect(() => { setPage(1) }, [priority, moduleFilter])

  const alerts = useMemo(() => sorteazaAlerte(SURSE_ADMIN.filter(s => !s.approval).flatMap(s => sources[s.id].state === 'ok' ? sources[s.id].rows : [])), [sources])
  const approvals = SURSE_ADMIN.filter(s => s.approval).flatMap(s => sources[s.id].state === 'ok' ? sources[s.id].rows : [])
  const filtered = alerts.filter(a => (priority === 'all' || a.priority === priority) && (moduleFilter === 'all' || a.source === moduleFilter))
  const evaluated = Object.values(sources).filter(s => s.state === 'ok').length
  const incomplete = evaluated !== SURSE_ADMIN.length
  const pageCount = Math.max(1, Math.ceil(filtered.length / 25))
  const currentPage = Math.min(page, pageCount)
  const allApprovalsOk = SURSE_ADMIN.filter(s => s.approval).every(s => sources[s.id].state === 'ok')

  return <main style={{ padding: '24px clamp(12px, 3vw, 36px)', color: G.text, background: G.bg, minHeight: 'calc(100vh - 56px)', overflowWrap: 'anywhere' }}>
    <header style={{ ...S.row, justifyContent: 'space-between', marginBottom: 22 }}>
      <div><div style={S.small}>GAZPET ERP · Conducere</div><h1 style={{ fontSize: 26, margin: '6px 0' }}>Modulul Administratorului</h1><p style={S.small}>Priorități, termene și aprobări · numai citire</p></div>
      <button type="button" style={{ ...S.button, opacity: busy ? .6 : 1 }} disabled={busy || !allowed} onClick={load}>{busy ? 'Se evaluează…' : '↻ Reîmprospătează'}</button>
    </header>
    {accessMessage && <div role="alert" style={{ ...S.panel, color: G.yellow, marginBottom: 18 }}>{accessMessage}</div>}
    <section aria-label="Situații din sursele evaluate" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
      {[
        ['Critice identificate', alerts.filter(a => a.priority === 'critical').length, G.red],
        ['Următoarele 7 zile', alerts.filter(a => a.priority === 'week').length, G.yellow],
        ['Așteaptă aprobarea ta', approvals.length, G.blue],
      ].map(([label, value, color]) => <div key={label} style={{ ...S.panel, flex: '1 1 180px' }}><div style={{ fontSize: 28, fontWeight: 700, color }}>{evaluated ? value : '—'}</div><div style={S.small}>{label}</div></div>)}
    </section>
    <div style={{ ...S.row, justifyContent: 'space-between', padding: '12px 0 20px' }}>
      <span style={{ ...S.small, color: incomplete ? G.yellow : G.muted }} aria-live="polite">{evaluated}/{SURSE_ADMIN.length} surse evaluate · cifre numai din datele vizibile{incomplete ? ' · situație incompletă' : ''}</span>
      <button type="button" style={S.button} aria-expanded={showSources} onClick={() => setShowSources(v => !v)}>{showSources ? 'Ascunde sursele' : 'Vezi starea surselor'}</button>
    </div>
    <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <section aria-label="Alerte importante" style={{ flex: '3 1 540px', minWidth: 0 }}>
        <h2 style={{ fontSize: 18, marginBottom: 14 }}>Necesită atenție</h2>
        <div style={{ ...S.row, marginBottom: 14 }}>
          {[['all', 'Toate'], ...Object.entries(PRIORITATI).map(([key, [label]]) => [key, label])].map(([key, label]) => <button key={key} type="button" aria-pressed={priority === key} onClick={() => setPriority(key)} style={{ ...S.button, color: priority === key ? G.blue : G.muted, borderColor: priority === key ? G.blue : G.border }}>{label}</button>)}
          <select aria-label="Filtrează după modul" value={moduleFilter} onChange={e => setModuleFilter(e.target.value)} style={{ ...S.button, maxWidth: '100%' }}><option value="all">Toate modulele</option>{SURSE_ADMIN.filter(s => !s.approval).map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
        </div>
        <div style={{ ...S.small, marginBottom: 10 }} aria-live="polite">{filtered.length} alerte în selecție / {alerts.length} identificate · totalurile de sus nu se schimbă la filtrare</div>
        <div style={{ ...S.panel, padding: 0 }}>
          {filtered.slice((currentPage - 1) * 25, currentPage * 25).map(item => <RandAlerta key={item.id} item={item} evaluatedAt={sources[item.source].evaluatedAt} openSource={nav} />)}
          {!filtered.length && <p style={{ padding: 24, ...S.small }}>{busy ? 'Se evaluează sursele…' : incomplete ? 'Nu sunt alerte în selecție. Sursele neevaluate nu confirmă absența problemelor.' : 'Nu sunt alerte în selecția curentă, în datele vizibile.'}</p>}
        </div>
        {pageCount > 1 && <div style={{ ...S.row, marginTop: 12 }}><button type="button" style={S.button} disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Înapoi</button><span style={S.small}>Pagina {currentPage}/{pageCount}</span><button type="button" style={S.button} disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>Înainte</button></div>}
      </section>
      <aside style={{ flex: '1 1 270px', minWidth: 0 }}>
        <section style={S.panel}><h2 style={{ fontSize: 17, marginBottom: 6 }}>Așteaptă decizia mea</h2><p style={S.small}>Aprobări din fluxurile existente</p>
          {approvals.map(row => <article key={row.id} style={{ padding: '18px 0', borderBottom: `1px solid ${G.border}` }}><Badge>{sourceById[row.source].label}</Badge><h3 style={{ fontSize: 15, margin: '10px 0' }}>{row.title}</h3>{row.amount != null && <div style={{ fontWeight: 700 }}>{money(row)}</div>}{row.date && <div>{fmtDate(row.date)}</div>}<p style={{ ...S.small, margin: '8px 0 12px' }}>{row.impact}</p><button type="button" style={S.button} onClick={() => nav(row.path)}>Deschide în modulul sursă ↗</button></article>)}
          {!approvals.length && <p style={{ ...S.small, marginTop: 16 }}>{busy ? 'Se verifică aprobările…' : allApprovalsOk ? 'Nicio aprobare în așteptare pentru tine.' : 'Aprobările nu au putut fi evaluate integral.'}</p>}
        </section>
        <p style={{ ...S.small, marginTop: 15 }}>Execuție, Magazie, CTC, Pontaj și Salarii nu sunt integrate în V1.</p>
      </aside>
    </div>
    {(showSources || incomplete) && <section style={{ ...S.panel, marginTop: 24 }}><h2 style={{ fontSize: 17, marginBottom: 12 }}>Starea surselor</h2><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 235px), 1fr))', gap: 16 }}>{SURSE_ADMIN.map(source => {
      const result = sources[source.id]
      return <div key={source.id}><strong style={{ fontSize: 13 }}>{source.label}</strong><div style={{ ...S.small, color: result.state === 'error' ? G.red : result.state === 'denied' ? G.yellow : G.muted }}>{STARI[result.state]} · {fmtTime(result.evaluatedAt)}</div>{result.message && <p style={S.small}>{result.message}</p>}</div>
    })}</div><p style={{ ...S.small, marginTop: 14 }}>Evaluarea descrie datele citite acum, nu confirmă că evidența sursă este completă sau actualizată. Dispariția unei alerte nu este înregistrată ca rezolvare.</p></section>}
  </main>
}
