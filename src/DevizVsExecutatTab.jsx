// Execuție → proiect → 📋 Deviz vs executat (decizia lui Răzvan, 10.11.2026; migrarea 20261208a): pe fiecare obiect × activitate
// cât e în deviz, cât s-a executat (rapoartele zilnice; la nod, sudurile din schema nodului), restul, % față de plan și alertele.
// Valorile și alertele vin calculate din v_executie_tinte (o singură definiție, L19); ecranul doar le arată / exportă.
// Setările țintelor (activitățile principale, factorul UM, baza, legarea obiectelor de deviz, perioadele de plan, pragurile) le vede și
// le schimbă doar Execuție editor / admin sau owner-ul (5A); BD-ul impune aceeași regulă (garda din 20261208a), ecranul doar o oglindește.
// L18: erorile se afișează (eroare ≠ gol). L23: citirile pe chei, până la pagina goală. L24: răspunsul vechi (alt proiect) nu se aplică.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './lib/supabase.js'
import { aziBucuresti, paginareKeyset } from './hrDeciziiUtil.js'
import { parseNumar } from './izoDocumenteLogica.js'
import { citesteTinte, ordoneaza, alerta, ALERTE, fmtNr, numeUnitate, propunePotrivire } from './devizTinte.js'

const G = { bg: '#0D1117', surface: '#161B22', card: '#1C2128', card2: '#21262D', text: '#E6EDF3', muted: '#8B949E', dim: '#6E7681',
  border: '#30363D', blue: '#58A6FF', green: '#2EA043', yellow: '#D29922', orange: '#F0883E', red: '#F85149', purple: '#A371F7' }
const S = {
  btn: { background: 'transparent', border: `1px solid ${G.border}`, borderRadius: 6, color: G.blue, cursor: 'pointer', fontSize: 13, padding: '6px 12px', fontFamily: 'inherit' },
  inp: { background: G.card2, border: `1px solid ${G.border}`, borderRadius: 6, color: G.text, fontSize: 12.5, padding: '5px 7px', fontFamily: 'inherit' },
  th: { textAlign: 'left', fontSize: 11, color: G.dim, textTransform: 'uppercase', letterSpacing: 0.4, padding: '6px 8px', borderBottom: `1px solid ${G.border}`, whiteSpace: 'nowrap' },
  td: { fontSize: 12.5, color: G.text, padding: '6px 8px', borderBottom: `1px solid ${G.border}`, verticalAlign: 'top' },
  err: { color: G.red, background: G.red + '14', border: `1px solid ${G.red}44`, borderRadius: 8, padding: '8px 12px', fontSize: 13, margin: '10px 0' },
}
const num = { textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }

function descarca(bytes, nume) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a')
  a.href = url; a.download = nume
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}

export default function DevizVsExecutatTab({ proiectId, codProiect = null, client = supabase }) {
  const pid = Number(proiectId)
  const [tinte, setTinte] = useState(null)          // null = se încarcă
  const [eroare, setEroare] = useState(null)
  const [poateConfig, setPoateConfig] = useState(false)
  const [doarAlerte, setDoarAlerte] = useState(false)
  const [doarPrincipale, setDoarPrincipale] = useState(false)
  const [obiect, setObiect] = useState('')          // '' = toate; 'null' = fără obiect; altfel id
  const [istoric, setIstoric] = useState(null)      // {cheie, titlu, randuri|null, eroare}
  const [setari, setSetari] = useState(false)
  const [exportBusy, setExportBusy] = useState(false)
  const [reload, setReload] = useState(0)
  const gen = useRef(0)

  useEffect(() => {
    const g = ++gen.current
    setTinte(null); setEroare(null); setIstoric(null)
    ;(async () => {
      try {
        const [t, d] = await Promise.all([
          citesteTinte(client, pid),
          client.rpc('fn_executie_tinte_drept', { p_proiect: pid, p_nivel: 'configurare' }),
        ])
        if (g !== gen.current) return
        if (d.error) throw d.error
        setTinte(t); setPoateConfig(d.data === true)
      } catch (e) { if (g === gen.current) setEroare(e?.message || String(e)) }
    })()
  }, [pid, client, reload])

  const obiecte = useMemo(() => {
    const m = new Map()
    for (const t of ordoneaza(tinte || [])) {
      const k = t.unitate_id == null ? 'null' : String(t.unitate_id)
      if (!m.has(k)) m.set(k, t.unitate_id == null ? '— fără obiect —' : numeUnitate({ cod: t.unitate_cod, nume: t.unitate_nume }))
    }
    return [...m.entries()]
  }, [tinte])

  const vizibile = useMemo(() => ordoneaza(tinte || []).filter(t =>
    (!doarAlerte || (t.alerte || []).length) && (!doarPrincipale || t.principala || t.activitate_id == null)
    && (obiect === '' || (obiect === 'null' ? t.unitate_id == null : String(t.unitate_id) === obiect))), [tinte, doarAlerte, doarPrincipale, obiect])

  const nrAlerte = useMemo(() => {
    const c = {}
    for (const t of tinte || []) for (const a of t.alerte || []) c[a] = (c[a] || 0) + 1
    return c
  }, [tinte])

  const deschideIstoric = useCallback(async (t) => {
    const cheie = t.id
    const titlu = `${t.activitate_nume || 'suduri fără activitate'} · ${t.unitate_id == null ? 'fără obiect' : numeUnitate({ cod: t.unitate_cod, nume: t.unitate_nume })}`
    if (t.executat_sursa === 'schema_nod') { setIstoric({ cheie, titlu, randuri: [], eroare: null, nod: true }); return }
    setIstoric({ cheie, titlu, randuri: null, eroare: null })
    try {
      const r = await paginareKeyset((ultim, pas) => {
        let q = client.from('raport_lucrari').select('id, cantitate, rapoarte_zilnice(data)').eq('activitate_id', t.activitate_id).order('id').limit(pas)
        q = t.unitate_id == null ? q.is('unitate_id', null) : q.eq('unitate_id', t.unitate_id)
        return ultim == null ? q : q.gt('id', ultim)
      })
      setIstoric(h => (h?.cheie === cheie ? { ...h, randuri: r.sort((a, b) => String(b.rapoarte_zilnice?.data || '').localeCompare(String(a.rapoarte_zilnice?.data || ''))) } : h))
    } catch (e) { setIstoric(h => (h?.cheie === cheie ? { ...h, eroare: e?.message || String(e) } : h)) }
  }, [client])

  const exporta = async () => {
    setExportBusy(true)
    try {
      const t = await citesteTinte(client, pid)   // rândurile exportate se citesc din nou: pragurile din fișier = cele ale rândurilor
      const { construiesteExportTinte, numeFisierTinte } = await import('./devizTinteExport.js')
      const azi = aziBucuresti()
      descarca(construiesteExportTinte({ tinte: t, proiect: { cod_intern: codProiect }, generatLa: new Date().toLocaleString('ro-RO') }), numeFisierTinte(codProiect, azi))
    } catch (e) { setEroare('Export: ' + (e?.message || String(e))) } finally { setExportBusy(false) }
  }

  if (eroare && !tinte) return <div style={{ padding: '16px 28px' }}><div style={S.err}>Nu s-au putut citi țintele: {eroare}</div><button style={S.btn} onClick={() => setReload(x => x + 1)}>Reîncearcă</button></div>
  if (!tinte) return <div style={{ padding: '24px 28px', color: G.dim }}>Se încarcă…</div>
  const meta = tinte[0]
  return (
    <div style={{ padding: '16px 28px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: G.text }}>📋 Deviz vs executat</div>
        <select value={obiect} onChange={e => setObiect(e.target.value)} style={{ ...S.inp, minWidth: 200 }}>
          <option value="">toate obiectele ({obiecte.length})</option>
          {obiecte.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
        </select>
        <label style={{ fontSize: 12.5, color: G.muted, display: 'flex', gap: 5, alignItems: 'center' }}><input type="checkbox" checked={doarAlerte} onChange={e => setDoarAlerte(e.target.checked)} /> doar alerte</label>
        <label style={{ fontSize: 12.5, color: G.muted, display: 'flex', gap: 5, alignItems: 'center' }}><input type="checkbox" checked={doarPrincipale} onChange={e => setDoarPrincipale(e.target.checked)} /> doar activitățile principale</label>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {poateConfig && <button style={{ ...S.btn, color: setari ? G.yellow : G.blue }} onClick={() => setSetari(v => !v)}>⚙️ Setări ținte</button>}
          <button style={S.btn} onClick={() => setReload(x => x + 1)}>↻</button>
          <button style={S.btn} disabled={exportBusy || !tinte.length} onClick={exporta}>{exportBusy ? 'Se pregătește…' : '⬇ Excel'}</button>
        </div>
      </div>
      {eroare && <div style={S.err}>{eroare}</div>}
      {setari && poateConfig && <SetariTinte pid={pid} client={client} onSalvat={() => setReload(x => x + 1)} />}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        {ALERTE.filter(a => nrAlerte[a.cod]).map(a => (
          <span key={a.cod} title={a.detaliu} style={{ fontSize: 11.5, color: a.culoare, border: `1px solid ${a.culoare}55`, background: a.culoare + '14', borderRadius: 12, padding: '2px 9px' }}>
            {a.eticheta}: {nrAlerte[a.cod]}
          </span>
        ))}
        {meta && <span style={{ fontSize: 11.5, color: G.dim }}>prag „în urmă” {fmtNr(meta.prag_in_urma_pp)} pp · „fără raport” {meta.zile_fara_raport == null ? 'oprit' : `${meta.zile_fara_raport} zile`} · calculat {String(meta.calculat_la || '').split('-').reverse().join('.')}</span>}
      </div>
      {!tinte.length ? (
        <div style={{ color: G.muted, fontSize: 13, padding: '14px 0', lineHeight: 1.6 }}>
          Nicio țintă încă. Ca să apară: catalogul de deviz încărcat (editare proiect → „Catalog deviz”), activitățile cu coduri de deviz și
          obiectele legate de deviz {poateConfig ? '(⚙️ Setări ținte)' : '(le leagă Execuție editor / admin)'}.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 900 }}>
            <thead><tr>
              <th style={S.th}>Obiect</th><th style={S.th}>Activitate</th><th style={{ ...S.th, ...num }}>Din deviz</th><th style={{ ...S.th, ...num }}>Executat</th>
              <th style={{ ...S.th, ...num }}>Rest</th><th style={S.th}>% executat / % plan</th><th style={S.th}>Alerte</th>
            </tr></thead>
            <tbody>
              {vizibile.map((t, i) => {
                const primul = i === 0 || vizibile[i - 1].unitate_id !== t.unitate_id
                const pct = t.pct_executat == null ? null : Number(t.pct_executat)
                return (
                  <tr key={t.id} onClick={() => deschideIstoric(t)} style={{ cursor: 'pointer', background: istoric?.cheie === t.id ? G.blue + '12' : 'transparent' }}>
                    <td style={{ ...S.td, color: primul ? G.text : G.dim, fontWeight: primul ? 600 : 400 }}>
                      {primul ? (t.unitate_id == null ? '— fără obiect —' : numeUnitate({ cod: t.unitate_cod, nume: t.unitate_nume })) : ''}
                      {primul && t.obiect_cod && <div style={{ fontSize: 11, color: G.dim }}>deviz {t.obiect_cod}{t.nod_cod ? ` · nod ${t.nod_cod}` : ''}</div>}
                    </td>
                    <td style={S.td}>
                      {t.activitate_id == null ? <span style={{ color: G.muted }}>suduri fără activitate (DN)</span> : t.activitate_nume}
                      {t.principala && <span style={{ marginLeft: 6, fontSize: 10.5, color: G.yellow }}>★</span>}
                      <div style={{ fontSize: 11, color: G.dim }}>{t.um || ''}{t.executat_sursa === 'schema_nod' ? ' · din schema nodului' : ''}{t.baza_deviz === 'oferta' ? ' · ofertă' : ''}</div>
                    </td>
                    <td style={{ ...S.td, ...num }}>{fmtNr(t.din_deviz)}</td>
                    <td style={{ ...S.td, ...num }}>{fmtNr(t.executat)}</td>
                    <td style={{ ...S.td, ...num, color: Number(t.peste_deviz) > 0 ? G.red : G.text }}>{Number(t.peste_deviz) > 0 ? `+${fmtNr(t.peste_deviz)}` : fmtNr(t.rest)}</td>
                    <td style={{ ...S.td, minWidth: 170 }}>
                      {pct == null ? <span style={{ color: G.dim }}>—</span> : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ position: 'relative', flex: 1, height: 8, background: G.bg, border: `1px solid ${G.border}`, borderRadius: 5, overflow: 'hidden' }}>
                            <div style={{ width: Math.min(100, pct) + '%', height: '100%', background: pct > 100 ? G.red : pct >= 100 ? G.green : G.blue }} />
                            {t.pct_plan != null && <div title={`plan ${fmtNr(t.pct_plan)}%`} style={{ position: 'absolute', top: -1, bottom: -1, left: Math.min(100, Number(t.pct_plan)) + '%', width: 2, background: G.yellow }} />}
                          </div>
                          <span style={{ fontSize: 11.5, ...num, color: G.muted }}>{fmtNr(pct)}%{t.pct_plan != null ? ` / ${fmtNr(t.pct_plan)}%` : ''}</span>
                        </div>
                      )}
                    </td>
                    <td style={S.td}>
                      {(t.alerte || []).map(c => { const a = alerta(c); return <span key={c} title={a.detaliu} style={{ display: 'inline-block', fontSize: 11, color: a.culoare, border: `1px solid ${a.culoare}55`, borderRadius: 10, padding: '1px 7px', margin: '0 4px 3px 0' }}>{a.eticheta}</span> })}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!vizibile.length && <div style={{ color: G.dim, fontSize: 13, padding: 12 }}>Nimic pentru filtrele alese.</div>}
        </div>
      )}
      {istoric && (
        <div style={{ marginTop: 14, background: G.card, border: `1px solid ${G.border}`, borderRadius: 10, padding: '10px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: G.text }}>Istoric · {istoric.titlu}</div>
            <button style={{ ...S.btn, marginLeft: 'auto', padding: '2px 8px' }} onClick={() => setIstoric(null)}>×</button>
          </div>
          {istoric.nod ? <div style={{ fontSize: 12.5, color: G.muted }}>Sudurile vin din schema nodului: Izometrie → 🔩 Nod cuplare (stările pe fiecare sudură).</div>
            : istoric.eroare ? <div style={S.err}>{istoric.eroare}</div>
            : !istoric.randuri ? <div style={{ color: G.dim, fontSize: 12.5 }}>Se încarcă…</div>
            : !istoric.randuri.length ? <div style={{ color: G.dim, fontSize: 12.5 }}>Nicio raportare.</div>
            : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 4 }}>
                {istoric.randuri.map(r => <div key={r.id} style={{ fontSize: 12.5, color: G.text }}>{String(r.rapoarte_zilnice?.data || '?').split('-').reverse().join('.')}: <strong>{fmtNr(r.cantitate, 3)}</strong></div>)}
              </div>}
        </div>
      )}
    </div>
  )
}

// ── Setările țintelor (Execuție editor / admin): activitățile, obiectele, pragurile. Fiecare salvare verifică rândul scris (0 rânduri = eroare). ──
function SetariTinte({ pid, client, onSalvat }) {
  const [d, setD] = useState(null)       // {acts, unis, obiecte, noduri, setari}
  const [err, setErr] = useState(null)
  const [msg, setMsg] = useState(null)
  const [prag, setPrag] = useState('')
  const [zile, setZile] = useState('')
  const gen = useRef(0)
  const incarca = useCallback(async () => {
    const g = ++gen.current
    setErr(null)
    try {
      const [ra, ru, rs, art, nod] = await Promise.all([
        client.from('proiect_activitati').select('id, nume, um, coduri_deviz, ordine, activ, principala, factor_um, sursa_executat, baza_deviz, dn_min, dn_max').eq('proiect_id', pid).order('ordine').order('id'),
        client.from('proiect_unitati').select('id, tip, cod, nume, ordine, activ, obiect_cod, nod_cod, plan_start, plan_final').eq('proiect_id', pid).order('ordine').order('id'),
        client.from('executie_tinte_setari').select('prag_in_urma_pp, zile_fara_raport').eq('proiect_id', pid).maybeSingle(),
        paginareKeyset((ultim, pas) => { const q = client.from('proiect_articole').select('id, obiect_cod, obiect_nume').eq('proiect_id', pid).not('obiect_cod', 'is', null).order('id').limit(pas); return ultim == null ? q : q.gt('id', ultim) }),
        paginareKeyset((ultim, pas) => { const q = client.from('executie_noduri_suduri').select('id, nod_cod').eq('proiect_id', pid).order('id').limit(pas); return ultim == null ? q : q.gt('id', ultim) }),
      ])
      for (const r of [ra, ru, rs]) if (r.error) throw r.error
      if (g !== gen.current) return
      const ob = new Map(); for (const a of art) if (a.obiect_cod && !ob.has(a.obiect_cod)) ob.set(a.obiect_cod, a.obiect_nume || '')
      setD({ acts: ra.data || [], unis: ru.data || [], obiecte: [...ob.entries()].map(([obiect_cod, obiect_nume]) => ({ obiect_cod, obiect_nume })).sort((a, b) => a.obiect_cod.localeCompare(b.obiect_cod)),
        noduri: [...new Set(nod.map(n => n.nod_cod))].sort(), setari: rs.data || null })
      setPrag(rs.data ? String(rs.data.prag_in_urma_pp) : '15')
      setZile(rs.data ? (rs.data.zile_fara_raport == null ? '' : String(rs.data.zile_fara_raport)) : '7')
    } catch (e) { if (g === gen.current) setErr(e?.message || String(e)) }
  }, [pid, client])
  useEffect(() => { incarca() }, [incarca])

  const scrie = async (tabel, idRand, patch, eticheta) => {
    setMsg(null)
    const { data, error } = await client.from(tabel).update(patch).eq('id', idRand).eq('proiect_id', pid).select('id')
    if (error || !data || data.length !== 1) { setMsg({ ok: false, text: `${eticheta}: ${error?.message || 'nu s-a salvat (rândul nu mai există sau nu ai drept)'}` }); await incarca(); return false }
    setD(x => ({ ...x, [tabel === 'proiect_activitati' ? 'acts' : 'unis']: x[tabel === 'proiect_activitati' ? 'acts' : 'unis'].map(r => (r.id === idRand ? { ...r, ...patch } : r)) }))
    onSalvat?.()
    return true
  }
  const salveazaPraguri = async () => {
    const p = parseNumar(prag), z = zile.trim() === '' ? null : parseNumar(zile)
    if (!Number.isFinite(p) || p < 1 || p > 100 || Math.abs(p * 10 - Math.round(p * 10)) > 1e-9) { setMsg({ ok: false, text: 'Pragul „în urmă”: între 1 și 100, cel mult o zecimală' }); return }
    if (z != null && (!Number.isInteger(z) || z < 1 || z > 90)) { setMsg({ ok: false, text: '„Fără raport”: zile întregi între 1 și 90 (gol = oprit)' }); return }
    const { data, error } = await client.from('executie_tinte_setari').upsert({ proiect_id: pid, prag_in_urma_pp: p, zile_fara_raport: z }, { onConflict: 'proiect_id' }).select('proiect_id')
    if (error || !data?.length) { setMsg({ ok: false, text: 'Praguri: ' + (error?.message || 'nu s-au salvat') }); return }
    setMsg({ ok: true, text: '✓ Pragurile salvate' }); onSalvat?.()
  }
  const propuneri = useMemo(() => (d ? propunePotrivire(d.unis, d.obiecte) : []), [d])
  const aplicaPropuneri = async () => {
    for (const p of propuneri) if (!(await scrie('proiect_unitati', p.unitate_id, { obiect_cod: p.obiect_cod }, 'Legarea obiectului'))) return
    setMsg({ ok: true, text: `✓ ${propuneri.length} obiecte legate de deviz` })
  }
  if (err) return <div style={S.err}>Setările nu s-au putut citi: {err}</div>
  if (!d) return <div style={{ color: G.dim, fontSize: 12.5, margin: '10px 0' }}>Se încarcă setările…</div>
  const zec = v => (v == null ? '' : String(v))
  const numar = (v, ok) => { const x = parseNumar(v); return x == null ? null : (Number.isFinite(x) && ok(x) ? x : NaN) }
  return (
    <div style={{ background: G.card, border: `1px solid ${G.yellow}44`, borderRadius: 10, padding: '12px 14px', margin: '0 0 14px' }}>
      {msg && <div style={{ fontSize: 12.5, color: msg.ok ? G.green : G.red, marginBottom: 8 }}>{msg.text}</div>}
      <div style={{ fontSize: 13, fontWeight: 700, color: G.text, marginBottom: 6 }}>Pragurile alertelor</div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 12.5, color: G.muted, marginBottom: 14 }}>
        „În urmă” peste <input value={prag} onChange={e => setPrag(e.target.value)} style={{ ...S.inp, width: 60 }} /> puncte procentuale ·
        „fără raport” după <input value={zile} onChange={e => setZile(e.target.value)} placeholder="oprit" style={{ ...S.inp, width: 60 }} /> zile
        <button style={S.btn} onClick={salveazaPraguri}>Salvează</button>
      </div>

      <div style={{ fontSize: 13, fontWeight: 700, color: G.text, marginBottom: 6 }}>Activitățile (ținta = articolele obiectului cu aceste coduri × factor)</div>
      <div style={{ overflowX: 'auto', marginBottom: 14 }}>
        <table style={{ borderCollapse: 'collapse', minWidth: 820 }}>
          <thead><tr><th style={S.th}>Activitate</th><th style={S.th}>Principală</th><th style={S.th}>Coduri deviz</th><th style={S.th}>Factor UM</th><th style={S.th}>Bază</th><th style={S.th}>Executat din</th><th style={S.th}>DN min – max</th></tr></thead>
          <tbody>{d.acts.map(a => (
            <tr key={a.id} style={{ opacity: a.activ === false ? 0.5 : 1 }}>
              <td style={S.td}>{a.nume} <span style={{ color: G.dim }}>{a.um || ''}</span></td>
              <td style={S.td}><input type="checkbox" checked={!!a.principala} onChange={e => scrie('proiect_activitati', a.id, { principala: e.target.checked }, a.nume)} /></td>
              <td style={{ ...S.td, fontFamily: 'monospace', color: a.coduri_deviz ? G.text : G.dim }}>{a.coduri_deviz || '—'}</td>
              <td style={S.td}><input defaultValue={zec(a.factor_um)} key={'f' + a.id + zec(a.factor_um)} style={{ ...S.inp, width: 70 }}
                onBlur={e => { const x = numar(e.target.value, v => v > 0 && v <= 1000000); if (x == null || x === Number(a.factor_um)) return; if (Number.isNaN(x)) { setMsg({ ok: false, text: `${a.nume}: factor invalid` }); return } scrie('proiect_activitati', a.id, { factor_um: x }, a.nume) }} /></td>
              <td style={S.td}><select value={a.baza_deviz} onChange={e => scrie('proiect_activitati', a.id, { baza_deviz: e.target.value }, a.nume)} style={S.inp}>
                <option value="revizuita">revizuită (contract + acte)</option><option value="oferta">ofertă (doar contractul inițial)</option></select></td>
              <td style={S.td}><select value={a.sursa_executat} onChange={e => scrie('proiect_activitati', a.id, { sursa_executat: e.target.value }, a.nume)} style={S.inp}>
                <option value="raport">raportul zilnic</option><option value="schema_nod">la nod: schema nodului</option></select></td>
              <td style={S.td}>{['dn_min', 'dn_max'].map(c => (
                <input key={c + a.id + zec(a[c])} defaultValue={zec(a[c])} placeholder={c === 'dn_min' ? 'min' : 'max'} style={{ ...S.inp, width: 56, marginRight: 4 }}
                  onBlur={e => { const x = numar(e.target.value, v => Number.isInteger(v) && v >= 1 && v <= 3000); if (x === (a[c] == null ? null : Number(a[c]))) return; if (Number.isNaN(x)) { setMsg({ ok: false, text: `${a.nume}: DN întreg 1–3000` }); return } scrie('proiect_activitati', a.id, { [c]: x }, a.nume) }} />))}</td>
            </tr>))}</tbody>
        </table>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: G.text }}>Obiectele (legarea de deviz, nodul, perioada din graficul de referință)</div>
        {propuneri.length > 0 && <button style={{ ...S.btn, color: G.yellow }} onClick={aplicaPropuneri} title={propuneri.map(p => `${d.unis.find(u => u.id === p.unitate_id)?.nume} ↔ ${p.obiect_cod} (${p.motiv})`).join('\n')}>
          Leagă {propuneri.length} propuse automat</button>}
      </div>
      {!d.obiecte.length && <div style={{ fontSize: 12, color: G.dim, marginBottom: 6 }}>Catalogul de deviz al proiectului nu are obiecte încă (editare proiect → „Catalog deviz”).</div>}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', minWidth: 820 }}>
          <thead><tr><th style={S.th}>Unitate</th><th style={S.th}>Obiect din deviz</th><th style={S.th}>Nod</th><th style={S.th}>Plan start</th><th style={S.th}>Plan final</th></tr></thead>
          <tbody>{d.unis.map(u => {
            const pr = propuneri.find(p => p.unitate_id === u.id)
            return (
              <tr key={u.id} style={{ opacity: u.activ === false ? 0.5 : 1 }}>
                <td style={S.td}>{numeUnitate(u)}</td>
                <td style={S.td}><select value={u.obiect_cod || ''} onChange={e => scrie('proiect_unitati', u.id, { obiect_cod: e.target.value || null }, numeUnitate(u))} style={{ ...S.inp, maxWidth: 260 }}>
                  <option value="">{pr ? `— (propus: ${pr.obiect_cod}) —` : '—'}</option>
                  {d.obiecte.map(o => <option key={o.obiect_cod} value={o.obiect_cod} disabled={o.obiect_cod !== u.obiect_cod && d.unis.some(x => x.obiect_cod === o.obiect_cod)}>{o.obiect_cod} {o.obiect_nume}</option>)}
                </select></td>
                <td style={S.td}><select value={u.nod_cod || ''} onChange={e => scrie('proiect_unitati', u.id, { nod_cod: e.target.value || null }, numeUnitate(u))} style={S.inp}>
                  <option value="">—</option>
                  {d.noduri.map(n => <option key={n} value={n} disabled={n !== u.nod_cod && d.unis.some(x => x.nod_cod === n)}>{n}</option>)}
                </select></td>
                {['plan_start', 'plan_final'].map(c => (
                  <td key={c} style={S.td}><input type="date" value={u[c] || ''} style={S.inp} onChange={e => {
                    const v = e.target.value || null
                    const alt = c === 'plan_start' ? 'plan_final' : 'plan_start'
                    // perioada se scrie întreagă (ambele date sau niciuna, final ≥ start), ca în constrângerea din BD
                    if (v && !u[alt]) { setD(x => ({ ...x, unis: x.unis.map(r => (r.id === u.id ? { ...r, [c]: v } : r)) })); return }
                    scrie('proiect_unitati', u.id, v ? { [c]: v, [alt]: u[alt] } : { plan_start: null, plan_final: null }, numeUnitate(u))
                  }} /></td>))}
              </tr>
            )
          })}</tbody>
        </table>
      </div>
      <div style={{ fontSize: 11, color: G.dim, marginTop: 8, lineHeight: 1.5 }}>
        Perioada de plan se citește din graficul de referință (pe viitor se poate lua direct din „📅 Grafic”). Codurile de deviz și UM-ul activităților
        se schimbă în editarea proiectului; la o activitate principală le schimbă doar Execuție editor / admin.
      </div>
    </div>
  )
}
