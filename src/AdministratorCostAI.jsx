import { useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase.js'
import { defaultMonths, formatMoney, formatMonth, groupCosts, monthRange, USD_TO_RON } from './lib/costAi.js'

const G = { surface: '#FFFFFF', border: '#E2E8EF', text: '#263642', muted: '#617282', blue: '#24778B', red: '#B74D55' }
const S = {
  panel: { background: G.surface, border: `1px solid ${G.border}`, borderRadius: 10, padding: 16, marginBottom: 16 },
  button: { background: G.surface, color: G.text, border: `1px solid ${G.border}`, borderRadius: 7, padding: '9px 12px', minHeight: 40, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 },
  small: { color: G.muted, fontSize: 12, lineHeight: 1.6 },
  row: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12 },
  cell: { padding: '10px 12px', borderBottom: `1px solid ${G.border}`, textAlign: 'left', fontSize: 13 },
}

function CostTable({ rows, monthly = false, label = 'Proiect / licitație' }) {
  return <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
    <thead><tr>{[label, ...(monthly ? ['Modul'] : []), 'Apeluri', 'USD', 'RON', 'Rezervat în curs (USD)'].map(label => <th key={label} scope="col" style={S.cell}>{label}</th>)}</tr></thead>
    <tbody>{rows.map((r, i) => <tr key={JSON.stringify([r.luna, r.tip_tinta, r.tinta_id, r.modul, r.nume, i])}>
      <td style={S.cell}>{r.nume}{r.tip_tinta && <div style={S.small}>{r.tip_tinta === 'licitatie' ? 'Licitație' : 'Proiect'} #{r.tinta_id}</div>}</td>
      {monthly && <td style={S.cell}>{r.modul}</td>}
      <td style={S.cell}>{r.apeluri.toLocaleString('ro-RO')}</td>
      <td style={{ ...S.cell, whiteSpace: 'nowrap' }}>{formatMoney(r.cost_usd)}</td>
      <td style={{ ...S.cell, whiteSpace: 'nowrap' }}>{formatMoney(r.cost_usd * USD_TO_RON, 'RON')}</td>
      <td style={{ ...S.cell, whiteSpace: 'nowrap' }}>{formatMoney(r.rezervat_in_curs_usd)}</td>
    </tr>)}</tbody>
  </table></div>
}

export default function AdministratorCostAI({ profile }) {
  const [interval, setInterval] = useState(defaultMonths)
  const [version, setVersion] = useState(0)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
  const owner = profile?.is_owner === true
  const key = JSON.stringify([profile?.id, owner, interval.de, interval.pana, version])
  // Nu afișăm un rezultat vechi sub un interval nou sau după schimbarea sesiunii.
  const visibleRows = result?.key === key && owner ? result.rows : []
  const report = useMemo(() => groupCosts(visibleRows), [visibleRows])
  const ready = result?.key === key && owner

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setResult(null); setError(''); setBusy(false)
    if (!owner || !profile?.id) return () => controller.abort()
    let args
    try { args = monthRange(interval.de, interval.pana) } catch (e) { setError(e.message); return () => controller.abort() }
    setBusy(true)
    const timeout = setTimeout(() => controller.abort(), 30000)
    async function load() {
      try {
        const { data: auth, error: authError } = await supabase.auth.getUser()
        if (authError || auth?.user?.id !== profile.id) throw new Error('Sesiunea s-a schimbat. Reconectează-te.')
        const rows = []
        // Paginăm agregatele: un răspuns PostgREST limitat nu trebuie prezentat drept total.
        let count = null
        do {
          const page = await supabase.rpc('fn_ai_cost_lunar', args, { count: 'exact' })
            .range(rows.length, rows.length + 499).abortSignal(controller.signal)
          if (page.error) throw page.error
          if (!Number.isInteger(page.count) || page.count < 0) throw new Error('Serverul nu a confirmat numărul de rânduri al raportului.')
          if (count != null && count !== page.count) throw new Error('Datele s-au schimbat în timpul citirii. Reîmprospătează raportul.')
          count = page.count
          if (!page.data?.length && rows.length < count) throw new Error('Raport incomplet. Reîmprospătează.')
          rows.push(...(page.data || []))
        } while (rows.length < count)
        if (rows.length !== count) throw new Error('Număr de rânduri inconsistent. Reîmprospătează.')
        // Validăm numerele înainte să publicăm rezultatul în UI.
        groupCosts(rows)
        if (active && !controller.signal.aborted) setResult({ key, rows })
      } catch (e) {
        if (active) setError(controller.signal.aborted ? 'Încărcarea a expirat. Reîncearcă.' : e.message || 'Raportul nu a putut fi citit.')
      } finally {
        clearTimeout(timeout)
        if (active) setBusy(false)
      }
    }
    load()
    return () => { active = false; clearTimeout(timeout); controller.abort() }
  }, [key, owner, profile?.id, interval.de, interval.pana])

  async function exportExcel() {
    setExporting(true)
    try {
      const XLSX = await import('xlsx-js-style')
      const book = XLSX.utils.book_new()
      const header = ['Luna', 'Proiect / licitație', 'Tip', 'ID', 'Modul', 'Apeluri', 'USD', 'RON estimat', 'Rezervat în curs USD']
      const data = report.monthly.map(r => [r.luna.slice(0, 7), r.nume, r.tip_tinta || '', r.tinta_id ?? '', r.modul, r.apeluri, r.cost_usd, r.cost_usd * USD_TO_RON, r.rezervat_in_curs_usd])
      const sheet = XLSX.utils.aoa_to_sheet([header, ...data])
      sheet['!cols'] = [12, 65, 14, 12, 28, 12, 16, 16, 24].map(wch => ({ wch }))
      // Numele externe rămân celule text; nu construim formule din ele.
      XLSX.utils.book_append_sheet(book, sheet, 'Cost AI')
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
        ['Curs orientativ USD/RON', USD_TO_RON], ['Total USD', report.total.cost_usd],
        ['Total RON estimat', report.total.cost_usd * USD_TO_RON], ['Rezervat în curs USD (exclus din cost)', report.total.rezervat_in_curs_usd],
      ]), 'Total')
      XLSX.writeFile(book, `Cost_AI_${interval.de}_${interval.pana}.xlsx`)
    } catch (e) { setError(`Export nereușit: ${e.message || 'eroare necunoscută'}`) } finally { setExporting(false) }
  }

  if (!owner) return null
  const months = [...new Set(report.monthly.map(r => r.luna))]
  return <section aria-label="Cost AI" style={{ color: G.text }}>
    <div style={{ ...S.row, marginBottom: 16 }}>
      <h2 style={{ fontSize: 20, margin: 0 }}>Cost AI</h2>
      <label style={S.small}>De la <input aria-label="Luna de început" type="month" value={interval.de} onChange={e => setInterval(v => ({ ...v, de: e.target.value }))} style={S.button} /></label>
      <label style={S.small}>Până la <input aria-label="Luna de sfârșit" type="month" value={interval.pana} onChange={e => setInterval(v => ({ ...v, pana: e.target.value }))} style={S.button} /></label>
      <button type="button" style={S.button} disabled={busy} onClick={() => setVersion(v => v + 1)}>Reîmprospătează</button>
      <button type="button" style={S.button} disabled={!ready || busy || exporting} onClick={exportExcel}>{exporting ? 'Se exportă…' : 'Export Excel'}</button>
    </div>
    <p style={{ ...S.small, marginBottom: 16 }}>Luni calendaristice în Europe/Bucharest · 1 USD ≈ {USD_TO_RON} RON (estimare). Apelurile includ rezervările E9 finalizate; cele în curs sunt separate. Costurile „păstrate” E9 folosesc suma rezervată.</p>
    {error && <p role="alert" style={{ ...S.panel, color: G.red }}>{error}</p>}
    {busy && <p role="status" style={S.small}>Se încarcă raportul…</p>}
    {ready && <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        {[
          ['Total cost', formatMoney(report.total.cost_usd)],
          ['Echivalent estimat', formatMoney(report.total.cost_usd * USD_TO_RON, 'RON')],
          ['Apeluri / rezervări finalizate', report.total.apeluri.toLocaleString('ro-RO')],
          ['Rezervat în curs · exclus din total', formatMoney(report.total.rezervat_in_curs_usd)],
        ].map(([label, value]) => <div key={label} style={S.panel}><div style={S.small}>{label}</div><strong style={{ fontSize: 22 }}>{value}</strong></div>)}
      </div>
      {!report.monthly.length && <p style={S.panel}>Nu sunt costuri sau rezervări în intervalul ales.</p>}
      {months.map(luna => <section key={luna} style={S.panel}>
        <h3 style={{ fontSize: 16, margin: '0 0 12px' }}>{formatMonth(luna)} · {formatMoney(report.monthly.filter(r => r.luna === luna).reduce((sum, r) => sum + r.cost_usd, 0))}</h3>
        <CostTable monthly rows={report.monthly.filter(r => r.luna === luna)} />
      </section>)}
      <section style={S.panel}><h3 style={{ fontSize: 16, marginTop: 0 }}>Cost pe module</h3><CostTable rows={report.modules} label="Modul" /></section>
      <section style={S.panel}><h3 style={{ fontSize: 16, marginTop: 0 }}>Top 10 proiecte / licitații în interval</h3>
        {report.top.length ? <CostTable rows={report.top} /> : <p style={S.small}>Nu există costuri atribuite unui proiect sau unei licitații.</p>}
      </section>
    </>}
  </section>
}
