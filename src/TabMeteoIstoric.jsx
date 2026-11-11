// Execuție → proiect → 🌧️ Meteo (cererea lui Răzvan, 09.11.2026): istoricul meteo zilnic pe șantierele proiectului, calendarul zilelor
// nelucrabile pe lună și exportul Excel (dovezi pentru notificări / revendicări). Datele: v_meteo_zile (migrarea 20261206a), umplute de
// meteo-sync din arhiva Open-Meteo. „Zi nelucrabilă” vine calculată din vedere (o singură definiție, L19).
// Șantierele proiectului = sites.proiect_id. Pragurile le schimbă doar owner-ul (RPC fn_meteo_praguri_seteaza, CAS pe versiune).
// L18: erorile se afișează; „fără date” ≠ „lucrabilă”. L24: rezultatul unei încărcări se aplică doar dacă proiectul / șantierul e cel curent.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './lib/supabase.js'
import { aziBucuresti } from './hrDeciziiUtil.js'
import { calendarLuna, ZILE_SAPT, LUNI, vremeWmo, rezumatLuna, peLuni, numeLuna, eticheta, motiveText, pragText, toateZilele,
  construiesteExport, numeFisierMeteo, parsePrag, toateVersiunile } from './meteoIstoricUtil.js'

const G = { bg: '#0D1117', surface: '#161B22', card: '#1C2128', card2: '#21262D', text: '#E6EDF3', muted: '#8B949E', dim: '#6E7681',
  border: '#30363D', blue: '#58A6FF', green: '#2EA043', yellow: '#D29922', red: '#F85149', teal: '#2DD4BF' }
const S = {
  btn: { background: 'transparent', border: `1px solid ${G.border}`, borderRadius: 6, color: G.blue, cursor: 'pointer', fontSize: 13, padding: '6px 12px' },
  inp: { background: G.card2, border: `1px solid ${G.border}`, borderRadius: 6, color: G.text, fontSize: 13, padding: '6px 8px', width: 80 },
}

function descarca(bytes, nume) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a')
  a.href = url; a.download = nume
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}

export default function TabMeteoIstoric({ proiectId, codProiect = null, client = supabase }) {
  const azi = aziBucuresti()
  const [santiere, setSantiere] = useState(null)        // null = se încarcă
  const [siteId, setSiteId] = useState(null)
  const [zile, setZile] = useState(null)
  const [praguri, setPraguri] = useState(null)
  const [owner, setOwner] = useState(false)
  const [eroare, setEroare] = useState(null)
  const [luna, setLuna] = useState(() => ({ an: Number(azi.slice(0, 4)), luna: Number(azi.slice(5, 7)) }))
  const [ales, setAles] = useState(null)                // ziua deschisă (detalii)
  const [exp, setExp] = useState(null)                  // { tip, text }
  const [edit, setEdit] = useState(null)                // formularul pragurilor (owner)
  const gen = useRef(0)
  const siteCurent = useRef(null)
  siteCurent.current = siteId

  // reîncărcarea explicită a zilelor șantierului CURENT (după praguri / completare); efectul zilelor o urmărește (review r1 P1)
  const [reincarca, setReincarca] = useState(0)
  const citestePraguri = useCallback(async () => {
    const { data, error } = await client.from('meteo_praguri_nelucrabil').select('precipitatii_mm_min,zapada_cm_min,tmax_sub_c,tmin_max_c,versiune,actualizat_la').eq('id', 1).maybeSingle()
    if (error) throw new Error('pragurile nu se pot citi: ' + error.message)
    return data || null
  }, [client])

  // proiectul: TOATE șantierele lui (și cele închise: istoricul lor rămâne dovadă, review r1 P1), pragurile, dacă utilizatorul e owner
  const incarcaProiect = useCallback(async () => {
    const g = ++gen.current
    setSantiere(null); setEroare(null); setAles(null); setExp(null)   // zilele se reîncarcă la schimbarea șantierului (efectul de mai jos)
    try {
      const [{ data: st, error: es }, pr, { data: u }] = await Promise.all([
        client.from('sites').select('id,name,lat,lng,meteo_activ,active').eq('proiect_id', proiectId).order('name'),
        citestePraguri(),
        client.auth.getUser(),
      ])
      if (es) throw new Error('șantierele proiectului nu se pot citi: ' + es.message)
      let esteOwner = false
      if (u?.user?.id) {
        const { data: p } = await client.from('profiles').select('is_owner').eq('id', u.user.id).maybeSingle()
        esteOwner = p?.is_owner === true
      }
      if (g !== gen.current) return
      const lista = st || []
      setSantiere(lista); setPraguri(pr); setOwner(esteOwner)
      setSiteId(prev => (lista.some(s => s.id === prev) ? prev : (lista.find(s => s.active !== false) || lista[0])?.id ?? null))
    } catch (e) {
      if (g === gen.current) { setEroare(e.message || String(e)); setSantiere([]) }
    }
  }, [proiectId, client, citestePraguri])
  useEffect(() => { incarcaProiect(); return () => { gen.current++ } }, [incarcaProiect])

  // istoricul șantierului ales
  const genZile = useRef(0)
  const incarcaZile = useCallback(async (sid) => {
    const g = ++genZile.current
    setZile(null); setAles(null)
    if (sid == null) return
    try {
      const r = await toateZilele(client, [sid])
      if (g !== genZile.current) return
      setZile(r)
      // luna afișată: cea curentă dacă are date, altfel ultima lună cu date
      if (r.length && !r.some(x => x.data.startsWith(azi.slice(0, 7)))) {
        const u = r[r.length - 1].data
        setLuna({ an: Number(u.slice(0, 4)), luna: Number(u.slice(5, 7)) })
      }
    } catch (e) {
      if (g === genZile.current) { setEroare(e.message || String(e)); setZile([]) }
    }
  }, [client, azi])
  useEffect(() => { incarcaZile(siteId); return () => { genZile.current++ } }, [siteId, reincarca, incarcaZile])

  const site = santiere?.find(s => s.id === siteId) || null
  const peZi = useMemo(() => new Map((zile || []).map(r => [r.data, r])), [zile])
  const rez = useMemo(() => (zile ? rezumatLuna(zile, luna.an, luna.luna, azi) : null), [zile, luna, azi])
  const luni = useMemo(() => (zile ? peLuni(zile) : []), [zile])
  const muta = (d) => setLuna(({ an, luna: l }) => { const t = an * 12 + (l - 1) + d; return { an: Math.floor(t / 12), luna: (t % 12) + 1 } })

  const exporta = async () => {
    const g = gen.current
    setExp({ tip: 'lucru', text: 'Se pregătește fișierul…' })
    try {
      const lista = santiere || []
      const randuri = await toateZilele(client, lista.map(s => s.id))
      if (g !== gen.current) return
      if (!randuri.length) { setExp({ tip: 'info', text: 'Nu există încă istoric meteo pentru șantierele proiectului.' }); return }
      const jurnal = await toateVersiunile(client)          // pe chei, până la pagina goală (review r2 P2)
      if (g !== gen.current) return
      // pragurile declarate în fișier vin din rândurile exportate (aceeași versiune peste tot), nu din pagină (review r1 P1)
      const bytes = await construiesteExport({ santiere: lista, randuri, jurnal: jurnal || [], generatLa: new Date().toLocaleString('ro-RO') })
      if (g !== gen.current) return
      descarca(bytes, numeFisierMeteo(codProiect || `proiect_${proiectId}`, azi))
      setExp({ tip: 'ok', text: `✓ ${randuri.length} zile exportate` })
    } catch (e) {
      if (g === gen.current) setExp({ tip: 'eroare', text: 'Exportul nu s-a putut face: ' + (e.message || String(e)) })
    }
  }

  // completarea / refacerea istoricului de la începutul proiectului: doar owner-ul (meteo-sync reverifică rolul); se poate repeta —
  // rescrie zilele perioadei cu valorile curente din arhivă (review r1 P2: nu e „o singură dată” garantat, textele spun asta)
  const [compl, setCompl] = useState(null)
  // la schimbarea șantierului / proiectului: cererea în curs nu mai e a selecției, mesajul se golește și butonul redevine utilizabil (review r2 P2)
  const genCompl = useRef(0)
  useEffect(() => { genCompl.current++; setCompl(null) }, [siteId, proiectId])
  const completeaza = async () => {
    const g = gen.current, sid = siteId, c = ++genCompl.current
    const curenta = () => c === genCompl.current && g === gen.current && sid === siteCurent.current
    setCompl({ tip: 'lucru', text: 'Se completează istoricul… (poate dura un minut)' })
    try {
      const { data, error } = await client.functions.invoke('meteo-sync', { body: { istoric_backfill: true, site_id: sid } })
      if (!curenta()) return
      if (error) throw new Error(error.message || 'funcția meteo nu a răspuns')
      const ist = data?.istoric
      if (!ist || (ist.ok === false && !ist.rez)) throw new Error(ist?.eroare || data?.error || 'răspuns neașteptat')
      const r = (ist.rez || []).find(x => x.site === sid)
      const s = (ist.sarite || []).find(x => x.site_id === sid)
      if (s) { setCompl({ tip: 'info', text: `Nu s-a completat: ${s.motiv}.` }); return }
      if (!r) throw new Error('șantierul nu apare în răspuns')
      if (!r.ok) { setCompl({ tip: 'eroare', text: `Completarea s-a oprit: ${r.eroare} (${r.zile_scrise} zile scrise până atunci).` }); setReincarca(x => x + 1); return }
      const extra = `${r.lipsa ? ` · ${r.lipsa} încă fără date` : ''}${r.respinse ? ` · ${r.respinse} respinse la validare` : ''}${r.absente ? ` · ${r.absente} zile lipsă din arhivă` : ''}`
      setCompl({ tip: extra ? 'info' : 'ok', text: `${extra ? '' : '✓ '}${r.zile_scrise} zile scrise (${r.de.split('-').reverse().join('.')} – ${r.pana.split('-').reverse().join('.')})${extra}` })
      setReincarca(x => x + 1)
    } catch (e) {
      if (curenta()) setCompl({ tip: 'eroare', text: 'Completarea nu s-a putut face: ' + (e.message || String(e)) })
    }
  }

  // pragurile: fiecare câmp completat, număr cu cel mult o zecimală (virgula acceptată); câmpul gol NU devine 0 (review r1 P2)
  const salveazaPraguri = async () => {
    const g = gen.current
    const v = Object.fromEntries(['precipitatii_mm_min', 'zapada_cm_min', 'tmax_sub_c', 'tmin_max_c'].map(k => [k, parsePrag(edit[k])]))
    if (Object.values(v).some(x => x === null)) { setEdit(e => ({ ...e, eroare: 'Completează fiecare prag cu un număr cu cel mult o zecimală (ex. 10 sau -5,5).' })); return }
    const { error } = await client.rpc('fn_meteo_praguri_seteaza', { p_versiune: praguri.versiune, p_precipitatii_mm: v.precipitatii_mm_min,
      p_zapada_cm: v.zapada_cm_min, p_tmax_sub_c: v.tmax_sub_c, p_tmin_max_c: v.tmin_max_c })
    if (g !== gen.current) return                                   // alt proiect / tab închis între timp
    if (error) { setEdit(e => (e ? { ...e, eroare: error.message || 'pragurile nu s-au salvat' } : e)); return }
    let pr
    try { pr = await citestePraguri() } catch (e) { if (g === gen.current) setEroare(e.message || String(e)); return }
    if (g !== gen.current) return
    setPraguri(pr); setEdit(null)
    setReincarca(x => x + 1)          // clasificarea vine din vedere, cu pragurile noi — pentru șantierul selectat ACUM
  }

  const cadru = (copii) => <div style={{ padding: '16px 16px 40px', maxWidth: 980, margin: '0 auto', color: G.text }}>{copii}</div>
  if (santiere === null) return cadru(<div style={{ color: G.dim, padding: 30, textAlign: 'center' }}>Se încarcă…</div>)
  if (eroare && !santiere.length) return cadru(<div role="alert" style={{ color: G.red, padding: 16 }}>{eroare}</div>)
  if (!santiere.length) return cadru(<div style={{ color: G.muted, padding: 16 }}>Proiectul nu are șantiere legate în ERP (Șantiere → proiect).</div>)

  const fara = site && (!site.meteo_activ || site.lat == null || site.lng == null)
  const inchis = site && site.active === false
  const eticSantier = (s) => `${s.name}${s.active === false ? ' (închis)' : ''}`
  return cadru(<>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 12 }}>
      <div style={{ fontSize: 16, fontWeight: 700 }}>🌧️ Meteo — istoric zilnic</div>
      {santiere.length > 1 && (
        <select value={siteId ?? ''} onChange={e => setSiteId(Number(e.target.value))} style={{ ...S.inp, width: 'auto', maxWidth: 260 }}>
          {santiere.map(s => <option key={s.id} value={s.id}>{eticSantier(s)}</option>)}
        </select>
      )}
      {santiere.length === 1 && site && <span style={{ color: G.muted, fontSize: 13 }}>{eticSantier(site)}</span>}
      <button onClick={exporta} disabled={exp?.tip === 'lucru'} style={{ ...S.btn, marginLeft: 'auto' }} data-meteo-export>📥 Export Excel</button>
      {owner && site && !fara && !inchis && (
        <button onClick={completeaza} disabled={compl?.tip === 'lucru'} style={S.btn} data-meteo-completeaza
          title="Aduce istoricul de la data de început a proiectului până ieri. Se poate repeta oricând: rescrie zilele cu valorile curente din arhivă. După aceea istoricul se completează zilnic, automat.">⏬ Completează / reface istoricul</button>
      )}
    </div>
    {exp && <div role={exp.tip === 'eroare' ? 'alert' : 'status'} style={{ fontSize: 12, marginBottom: 8, color: { lucru: G.muted, ok: G.green, info: G.yellow, eroare: G.red }[exp.tip] }}>{exp.text}</div>}
    {compl && <div role={compl.tip === 'eroare' ? 'alert' : 'status'} style={{ fontSize: 12, marginBottom: 8, color: { lucru: G.muted, ok: G.green, info: G.yellow, eroare: G.red }[compl.tip] }} data-meteo-completare>{compl.text}</div>}
    {eroare && <div role="alert" style={{ color: G.red, fontSize: 13, marginBottom: 8 }}>{eroare}</div>}

    <div style={{ background: G.surface, border: `1px solid ${G.border}`, borderRadius: 8, padding: '8px 12px', fontSize: 12, color: G.muted, marginBottom: 12 }}>
      Zi nelucrabilă dacă: {pragText(praguri)}{praguri ? ` (pragurile v${praguri.versiune})` : ''}.
      {owner && !edit && praguri && <button onClick={() => setEdit({ ...praguri, eroare: null })} style={{ ...S.btn, fontSize: 12, padding: '2px 8px', marginLeft: 8 }}>Schimbă pragurile</button>}
      {owner && edit && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 8 }}>
          {[['precipitatii_mm_min', 'precipitații ≥ (mm)'], ['zapada_cm_min', 'zăpadă ≥ (cm)'], ['tmax_sub_c', 'Tmax < (°C)'], ['tmin_max_c', 'Tmin ≤ (°C)']].map(([k, t]) => (
            <label key={k} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>{t}
              <input value={edit[k] ?? ''} onChange={e => setEdit(x => ({ ...x, [k]: e.target.value }))} inputMode="decimal" style={S.inp} />
            </label>
          ))}
          <button onClick={salveazaPraguri} style={{ ...S.btn, color: G.green }}>Salvează</button>
          <button onClick={() => setEdit(null)} style={{ ...S.btn, color: G.muted }}>Renunță</button>
          {edit.eroare && <span role="alert" style={{ color: G.red }}>{edit.eroare}</span>}
        </div>
      )}
    </div>

    {inchis && <div style={{ color: G.muted, fontSize: 13, marginBottom: 12 }}>Șantier închis: istoricul existent rămâne consultabil și exportabil, dar nu se mai completează automat.</div>}
    {fara && !inchis && <div style={{ color: G.yellow, fontSize: 13, marginBottom: 12 }}>Șantierul nu are coordonate sau meteo activ în ERP: istoricul nu se poate prelua pentru el.</div>}

    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
      <button onClick={() => muta(-1)} style={S.btn} aria-label="luna anterioară">‹</button>
      <div style={{ fontWeight: 700, minWidth: 150, textAlign: 'center' }}>{LUNI[luna.luna - 1]} {luna.an}</div>
      <button onClick={() => muta(1)} style={S.btn} aria-label="luna următoare">›</button>
      {rez && <span style={{ fontSize: 12, color: G.muted }} data-meteo-rezumat>
        {rez.nelucrabile} nelucrabile din {rez.cuDate} zile cu date{rez.necunoscute ? ` · ${rez.necunoscute} necunoscute` : ''}{rez.faraDate ? ` · ${rez.faraDate} fără date` : ''}
      </span>}
    </div>

    {zile === null ? <div style={{ color: G.dim, padding: 20 }}>Se încarcă istoricul…</div> : (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4 }} data-meteo-calendar>
        {ZILE_SAPT.map(z => <div key={z} style={{ textAlign: 'center', fontSize: 11, color: G.dim }}>{z}</div>)}
        {calendarLuna(luna.an, luna.luna).flat().map((d, i) => {
          if (!d) return <div key={'g' + i} />
          const r = peZi.get(d)
          const bg = !r ? 'transparent' : r.zi_nelucrabila === true ? G.red + '33' : r.zi_nelucrabila === false ? G.green + '1A' : G.yellow + '1A'
          const bord = !r ? `1px dashed ${G.border}` : `1px solid ${r.zi_nelucrabila === true ? G.red : G.border}`
          return (
            <button key={d} onClick={() => setAles(r ? d : null)} data-zi={d} data-stare={r ? eticheta(r.zi_nelucrabila) : 'fara'}
              style={{ background: bg, border: bord, borderRadius: 6, color: G.text, padding: '4px 2px', minHeight: 58, cursor: r ? 'pointer' : 'default', textAlign: 'center', fontSize: 11 }}>
              <div style={{ fontWeight: 700, fontSize: 12 }}>{Number(d.slice(8))}</div>
              {r ? <>
                <div>{vremeWmo(r.cod_vreme).icon}</div>
                <div style={{ color: G.muted }}>{r.precipitatii_mm == null ? '—' : `${Number(r.precipitatii_mm).toLocaleString('ro-RO')} mm`}</div>
                <div style={{ color: G.dim }}>{r.tmin_c == null ? '—' : Math.round(r.tmin_c)}/{r.tmax_c == null ? '—' : Math.round(r.tmax_c)}°</div>
              </> : <div style={{ color: G.dim }}>·</div>}
            </button>
          )
        })}
      </div>
    )}

    {ales && peZi.get(ales) && (() => {
      const r = peZi.get(ales)
      return (
        <div style={{ background: G.card, border: `1px solid ${G.border}`, borderRadius: 8, padding: 12, marginTop: 12, fontSize: 13 }} data-meteo-detalii>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>{ales.split('-').reverse().join('.')} — {eticheta(r.zi_nelucrabila) === 'DA' ? 'zi nelucrabilă' : eticheta(r.zi_nelucrabila) === 'NU' ? 'zi lucrabilă' : 'necunoscut (date incomplete)'}</div>
          <div>{vremeWmo(r.cod_vreme).icon} {vremeWmo(r.cod_vreme).text} · precipitații {r.precipitatii_mm ?? '—'} mm (ploaie {r.ploaie_mm ?? '—'} mm) · zăpadă {r.zapada_cm ?? '—'} cm</div>
          <div>Tmin {r.tmin_c ?? '—'} °C · Tmax {r.tmax_c ?? '—'} °C · vânt max {r.vant_max_kmh ?? '—'} km/h · rafale {r.rafale_max_kmh ?? '—'} km/h</div>
          {r.motive?.length > 0 && <div style={{ color: G.red, marginTop: 4 }}>Motiv: {motiveText(r)}</div>}
          <div style={{ color: G.dim, marginTop: 4, fontSize: 11 }}>Sursa: Open-Meteo (arhivă), la {r.lat}, {r.lng} · preluat {String(r.preluat_la || '').slice(0, 16).replace('T', ' ')}</div>
        </div>
      )
    })()}

    {luni.length > 0 && (
      <div style={{ marginTop: 18 }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Pe luni ({site?.name})</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 12, minWidth: 360 }} data-meteo-luni>
            <thead><tr>{['Luna', 'Zile cu date', 'Nelucrabile', 'Necunoscute'].map(h => <th key={h} style={{ textAlign: 'left', padding: '4px 10px', color: G.muted, borderBottom: `1px solid ${G.border}` }}>{h}</th>)}</tr></thead>
            <tbody>{luni.map(l => (
              <tr key={l.luna} onClick={() => setLuna({ an: Number(l.luna.slice(0, 4)), luna: Number(l.luna.slice(5, 7)) })} style={{ cursor: 'pointer' }}>
                <td style={{ padding: '4px 10px' }}>{numeLuna(l.luna)}</td><td style={{ padding: '4px 10px' }}>{l.cuDate}</td>
                <td style={{ padding: '4px 10px', color: l.nelucrabile ? G.red : G.text, fontWeight: l.nelucrabile ? 700 : 400 }}>{l.nelucrabile}</td>
                <td style={{ padding: '4px 10px', color: G.muted }}>{l.necunoscute}</td>
              </tr>))}</tbody>
          </table>
        </div>
      </div>
    )}
    {zile && !zile.length && !fara && <div style={{ color: G.muted, fontSize: 13, marginTop: 12 }}>Încă nu există istoric meteo pentru acest șantier (se completează zilnic; perioada de la începutul proiectului o aduce owner-ul cu „Completează / reface istoricul”).</div>}
  </>)
}
