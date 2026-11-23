// ═══════════════════════════════════════════════════════════════════════════
// restDecontat/RestDecontatTab.jsx — Execuție → proiect → „💰 Rest de decontat” (Task 5, plan 2026-11-21-rest-de-decontat; BD 20270105a/b).
// Ce mai e de decontat pe proiect: bază (ofertă + acte adiționale + note) − situațiile confirmate, în bani pe proiect / obiect și în bani +
// cantități pe articol. Totul vine calculat din vederi (v_executie_rest_decontat*, L19); ecranul filtrează, grupează și exportă.
// Drepturi (spec): tab-ul există DOAR când fn_rest_decontat_drept(proiect, 'citire') e adevărat — întrebat prin RPC, nu dedus din rol; încărcarea
// cere 'confirmare' (situații, ofertă) / 'documente_baza' (devizele AA / NR / NCS). BD-ul impune regula; ecranul doar o oglindește.
// L18: eroare ≠ gol (o citire picată se arată, nu devine „nimic de decontat”). L23: citirile pe chei / pagini până la pagina goală.
// L24: token de generație pe fiecare citire; răspunsul altui proiect nu se aplică.
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import IncarcareDocument, { fmtLei, fmtCant } from './IncarcareDocument.jsx'
import { citesteToate, SURSE_BAZA } from './incarcareLogica.js'
import { totaluriProiect, semnalRisc, filtreazaArticole, grupePeObiect, grupeazaLipsuri, totalAjustari, nr0, PRAG_PROIECT_AVANSAT_PCT, PRAG_ARTICOL_SUB_PCT } from './tabLogica.js'
import { aziBucuresti } from '../hrDeciziiUtil.js'
import { useDreptRestDecontat } from './dreptRestDecontat.js'

const G = { bg: '#0D1117', surface: '#161B22', card: '#1C2128', card2: '#21262D', text: '#E6EDF3', muted: '#8B949E', dim: '#6E7681',
  border: '#30363D', blue: '#58A6FF', green: '#2EA043', yellow: '#D29922', orange: '#F0883E', red: '#F85149', purple: '#A371F7' }
const S = {
  btn: { background: 'transparent', border: `1px solid ${G.border}`, borderRadius: 6, color: G.blue, cursor: 'pointer', fontSize: 13, padding: '6px 12px', fontFamily: 'inherit' },
  inp: { background: G.card2, border: `1px solid ${G.border}`, borderRadius: 6, color: G.text, fontSize: 12.5, padding: '5px 7px', fontFamily: 'inherit' },
  th: { textAlign: 'left', fontSize: 11, color: G.dim, textTransform: 'uppercase', letterSpacing: 0.4, padding: '6px 8px', borderBottom: `1px solid ${G.border}`, whiteSpace: 'nowrap' },
  td: { fontSize: 12.5, color: G.text, padding: '5px 8px', borderBottom: `1px solid ${G.border}`, verticalAlign: 'top' },
  err: { color: G.red, background: G.red + '14', border: `1px solid ${G.red}44`, borderRadius: 8, padding: '8px 12px', fontSize: 13, margin: '10px 0', whiteSpace: 'pre-wrap' },
  lbl: { fontSize: 12.5, color: G.muted, display: 'flex', gap: 5, alignItems: 'center' },
}
const num = { textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }
export { useDreptRestDecontat }

/** citire pe pagini (range) până la pagina goală, pentru vederile fără cheie unică (obiecte, lipsuri) — ordinea completă dată de apelant */
async function citestePagini(cere, pas = 1000) {
  const tot = []
  for (let o = 0; ; o += pas) {
    const { data, error } = await cere(o, o + pas - 1)
    if (error) throw error
    if (!data || !data.length) return tot
    tot.push(...data)
    if (o > 200000) throw new Error('citire pe pagini: prea multe rânduri')
  }
}

export default function RestDecontatTab({ proiectId, codProiect = null, proiect = null, client = supabase, drept: dreptExtern = null }) {
  const pid = Number(proiectId)
  const dreptIntern = useDreptRestDecontat(dreptExtern ? null : client, dreptExtern ? null : pid)
  const drept = dreptExtern || dreptIntern
  const [date, setDate] = useState(null)       // null = se încarcă; { articole, obiecte, lipsuri, ajustari: {sl}|{eroare}, configurare }
  const [eroare, setEroare] = useState(null)
  const [reload, setReload] = useState(0)
  const [filtre, setFiltre] = useState({ obiect: '', doarCuRest: false, nedecontat: false, peste: false, text: '' })
  const [incarcare, setIncarcare] = useState(null)   // null | 'situatie' | 'baza'
  const [exportBusy, setExportBusy] = useState(false)
  const [config, setConfig] = useState(null)     // { motiv, stare, mesaj }
  const [lipsuriDeschise, setLipsuriDeschise] = useState(false)
  const gen = useRef(0)

  const poateCiti = drept?.stare === 'ok' && drept.citire === true
  useEffect(() => {
    const g = ++gen.current
    setDate(null); setEroare(null)
    if (!poateCiti) return
    ;(async () => {
      try {
        const [articole, obiecte, lipsuri] = await Promise.all([
          citesteToate((ultim, pas) => { let q = client.from('v_executie_rest_decontat').select('*').eq('proiect_id', pid).order('rand_id').limit(pas); if (ultim != null) q = q.gt('rand_id', ultim); return q }, 'rand_id'),
          citestePagini((a, b) => client.from('v_executie_rest_decontat_obiect').select('*').eq('proiect_id', pid).order('nivel').order('obiect_cod', { nullsFirst: true }).range(a, b)),
          citestePagini((a, b) => client.from('v_executie_rest_decontat_lipsuri').select('tip, referinta').eq('proiect_id', pid).order('tip').order('referinta').range(a, b)),
        ])
        // ajustările de preț (doar citite) și starea configurării: o eroare aici se arată pe rândul lor, nu oprește tab-ul
        let ajustari, configurare
        try {
          const sl = await citesteToate((ultim, pas) => { let q = client.from('executie_situatii_plata').select('id, nr_situatie, valoare_ajustare_lei').eq('proiect_id', pid).order('id').limit(pas); if (ultim != null) q = q.gt('id', ultim); return q }, 'id')
          ajustari = { sl }
        } catch (e) { ajustari = { eroare: e?.message || String(e) } }
        try {
          const { data, error } = await client.from('executie_proiecte').select('configurare_completa_la, configurare_exceptie_motiv').eq('id', pid).maybeSingle()
          configurare = error ? { eroare: error.message || String(error) } : (data || { eroare: 'proiectul nu a fost găsit' })
        } catch (e) { configurare = { eroare: e?.message || String(e) } }
        if (g !== gen.current) return
        setDate({ articole, obiecte, lipsuri, ajustari, configurare })
      } catch (e) { if (g === gen.current) setEroare(e?.message || String(e)) }
    })()
  }, [pid, client, poateCiti, reload])

  const tot = useMemo(() => totaluriProiect(date?.obiecte), [date])
  const risc = useMemo(() => semnalRisc(date?.articole, tot.pct), [date, tot.pct])
  const vizibile = useMemo(() => filtreazaArticole(date?.articole, filtre), [date, filtre])
  const grupe = useMemo(() => grupePeObiect(vizibile, date?.obiecte), [vizibile, date])
  const lipsuri = useMemo(() => grupeazaLipsuri(date?.lipsuri), [date])
  const obiecteLista = useMemo(() => (date?.obiecte || []).filter(o => o.nivel === 'obiect'), [date])

  if (!drept || drept.stare === 'incarcare') return <div style={{ padding: '24px 28px', color: G.dim }}>Se verifică dreptul…</div>
  if (drept.stare === 'eroare') return <div style={{ padding: '16px 28px' }}><div style={S.err}>Nu s-a putut verifica dreptul de citire pentru Rest de decontat: {drept.eroare}</div></div>
  if (!poateCiti) return <div style={{ padding: '16px 28px', color: G.muted, fontSize: 13 }} data-fara-drept="1">Restul de decontat al acestui proiect îl văd doar owner-ul, managerul proiectului și cei cu acces „Rest de decontat”.</div>
  if (eroare) return <div style={{ padding: '16px 28px' }}><div style={S.err}>Nu s-a putut citi restul de decontat: {eroare}</div><button style={S.btn} onClick={() => setReload(x => x + 1)}>Reîncearcă</button></div>
  if (!date) return <div style={{ padding: '24px 28px', color: G.dim }}>Se încarcă…</div>

  const poateSituatie = drept.confirmare === true
  const surseBaza = SURSE_BAZA.filter(s => (s.cod === 'contract_initial' ? drept.confirmare : drept.confirmare || drept.documente_baza)).map(s => s.cod)
  const ajust = date.ajustari.sl ? totalAjustari(date.ajustari.sl) : null
  const setF = (k, v) => setFiltre(f => ({ ...f, [k]: v }))

  const exporta = async () => {
    setExportBusy(true)
    try {
      const { construiesteExportRest, numeFisierRest } = await import('./restDecontatExport.js')
      const bytes = construiesteExportRest({ articole: date.articole, obiecte: date.obiecte, lipsuri: date.lipsuri, ajustari: ajust, proiect: proiect || { cod_intern: codProiect }, generatLa: new Date().toLocaleString('ro-RO') })
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      const a = document.createElement('a'); a.href = url; a.download = numeFisierRest(codProiect, aziBucuresti())
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 30000)
    } catch (e) { setEroare('Export: ' + (e?.message || String(e))) } finally { setExportBusy(false) }
  }

  const declaraConfigurare = async () => {
    const motiv = config?.motiv?.trim() || null
    setConfig(c => ({ ...c, stare: 'trimite', mesaj: null }))
    let r
    try { r = await client.rpc('fn_executie_proiect_configurare_completa', { p_proiect: pid, p_motiv: motiv }) } catch (e) { r = { error: { message: e?.message || String(e) } } }
    if (r?.error) { setConfig(c => ({ ...c, stare: 'eroare', mesaj: r.error.message || String(r.error) })); return }
    setConfig({ stare: 'ok', mesaj: r.data?.deja ? 'Configurarea era deja declarată.' : 'Configurarea proiectului e declarată completă.' })
    setReload(x => x + 1)
  }

  const cel = (et, v, culoare, extra = {}) => (
    <div style={{ background: G.card, border: `1px solid ${G.border}`, borderRadius: 10, padding: '8px 14px', minWidth: 170 }} {...extra}>
      <div style={{ fontSize: 11, color: G.dim, textTransform: 'uppercase', letterSpacing: 0.4 }}>{et}</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: culoare || G.text, ...num }}>{v}</div>
    </div>
  )
  const fataOferta = (date.lipsuri || []).some(l => l.tip === 'fara_oferta')
  const conf = date.configurare
  return (
    <div style={{ padding: '16px 28px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: G.text }}>💰 Rest de decontat</div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {poateSituatie && <button style={{ ...S.btn, color: incarcare === 'situatie' ? G.yellow : G.blue }} onClick={() => setIncarcare(x => (x === 'situatie' ? null : 'situatie'))}>📥 Încarcă situație de plată</button>}
          {surseBaza.length > 0 && <button style={{ ...S.btn, color: incarcare === 'baza' ? G.yellow : G.blue }} onClick={() => setIncarcare(x => (x === 'baza' ? null : 'baza'))}>📥 Încarcă deviz (ofertă / act adițional / notă)</button>}
          <button style={S.btn} onClick={() => setReload(x => x + 1)} title="Reîncarcă">↻</button>
          <button style={S.btn} disabled={exportBusy} onClick={exporta}>{exportBusy ? 'Se pregătește…' : '⬇ Excel'}</button>
        </div>
      </div>

      {incarcare && (
        <IncarcareDocument key={`${pid}:${incarcare}`} proiectId={pid} tip={incarcare} client={client} surse={incarcare === 'baza' ? surseBaza : undefined}
          onGata={() => setReload(x => x + 1)} onInchide={() => setIncarcare(null)} />
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }} data-totaluri-proiect="1">
        {cel('Bază (ofertă + acte)', tot.baza == null ? '—' : `${fmtLei(tot.baza)} lei`, null, { 'data-total': 'baza' })}
        {cel('Decontat', tot.decontat == null ? '—' : `${fmtLei(tot.decontat)} lei`, null, { 'data-total': 'decontat' })}
        {cel('Rest de decontat', tot.rest == null ? '—' : `${fmtLei(tot.rest)} lei`, tot.rest != null && tot.rest < 0 ? G.red : G.green, { 'data-total': 'rest' })}
        {cel('% decontat', tot.pct == null ? '—' : `${String(tot.pct).replace('.', ',')}%`, null, { 'data-total': 'pct' })}
        {cel('Ajustări de preț (separat)', date.ajustari.eroare ? 'eroare' : `${fmtLei(ajust)} lei`, G.muted, { 'data-total': 'ajustari', title: date.ajustari.eroare || 'Din situațiile de plată; informativ: nu intră în rest și nici în cantități' })}
      </div>
      {date.ajustari.eroare && <div style={S.err}>Ajustările de preț nu s-au putut citi: {date.ajustari.eroare}</div>}
      {!tot.coerent && <div style={S.err} data-incoerent="1">Totalul proiectului nu e egal cu suma obiectelor (bază {fmtLei(tot.sumaObiecte.baza)}, decontat {fmtLei(tot.sumaObiecte.decontat)}, rest {fmtLei(tot.sumaObiecte.rest)} lei pe obiecte) — anunțați administratorul.</div>}

      {poateSituatie && conf && !conf.eroare && !conf.configurare_completa_la && (
        <div style={{ background: G.card, border: `1px solid ${G.yellow}44`, borderRadius: 10, padding: '8px 12px', margin: '0 0 10px', fontSize: 12.5, color: G.muted, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          Proiectul e „în configurare”.
          {fataOferta && <input aria-label="motivul excepției" placeholder="motiv (doar owner, fără ofertă)" value={config?.motiv || ''} onChange={e => setConfig(c => ({ ...c, motiv: e.target.value }))} style={{ ...S.inp, minWidth: 260 }} />}
          <button style={{ ...S.btn, color: G.yellow }} disabled={config?.stare === 'trimite'} onClick={declaraConfigurare}>✓ Configurare completă</button>
          {config?.mesaj && <span style={{ color: config.stare === 'eroare' ? G.red : G.green }}>{config.mesaj}</span>}
        </div>
      )}
      {conf?.eroare && poateSituatie && <div style={S.err}>Starea configurării nu s-a putut citi: {conf.eroare}</div>}
      {conf?.configurare_completa_la && <div style={{ fontSize: 11.5, color: G.dim, marginBottom: 8 }}>Configurare completă din {String(conf.configurare_completa_la).slice(0, 10).split('-').reverse().join('.')}{conf.configurare_exceptie_motiv ? ` (excepție: ${conf.configurare_exceptie_motiv})` : ''}.</div>}

      {lipsuri.length > 0 && (
        <div style={{ background: G.card, border: `1px solid ${G.orange}44`, borderRadius: 10, padding: '8px 12px', marginBottom: 10 }} data-lipsuri="1">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: G.orange }}>Lipsuri ({(date.lipsuri || []).length})</div>
            <button style={{ ...S.btn, padding: '1px 8px', fontSize: 11.5 }} onClick={() => setLipsuriDeschise(v => !v)}>{lipsuriDeschise ? 'ascunde' : 'arată detaliile'}</button>
          </div>
          {lipsuri.map(l => (
            <div key={l.tip} style={{ fontSize: 12.5, color: G.text, marginTop: 4 }} data-lipsa={l.tip}>
              {l.eticheta}: <strong>{l.referinte.length}</strong>
              {lipsuriDeschise && <span style={{ color: G.muted }}> — {l.referinte.join('; ')}</span>}
            </div>
          ))}
        </div>
      )}

      {risc.length > 0 && (
        <div style={{ background: G.card, border: `1px solid ${G.red}44`, borderRadius: 10, padding: '8px 12px', marginBottom: 10 }} data-risc="1">
          <div style={{ fontSize: 13, fontWeight: 700, color: G.red }}>⚠ {risc.length} articole cu risc de a rămâne nedecontate</div>
          <div style={{ fontSize: 11.5, color: G.dim, marginBottom: 4 }}>Proiectul a trecut de {PRAG_PROIECT_AVANSAT_PCT}% decontat; aceste articole sunt nedecontate deloc sau sub {PRAG_ARTICOL_SUB_PCT}%.</div>
          {risc.slice(0, 15).map(a => (
            <div key={a.rand_id} style={{ fontSize: 12.5, color: G.text }} data-risc-articol={a.rand_id}>
              {a.obiect_cod} · {a.cod} {String(a.denumire || '').slice(0, 70)} — rest {fmtLei(a.rest_valoare)} lei ({a.pct_decontat == null ? '0' : String(a.pct_decontat).replace('.', ',')}%)
            </div>
          ))}
          {risc.length > 15 && <div style={{ fontSize: 11.5, color: G.dim }}>… încă {risc.length - 15} (filtrul „nedecontat deloc” / exportul le arată pe toate)</div>}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <select aria-label="obiectul" value={filtre.obiect} onChange={e => setF('obiect', e.target.value)} style={{ ...S.inp, minWidth: 200 }}>
          <option value="">toate obiectele ({obiecteLista.length})</option>
          {obiecteLista.map(o => <option key={o.obiect_cod ?? ''} value={o.obiect_cod ?? ''}>{o.obiect_cod || '— fără obiect —'} {o.obiect_nume || ''}</option>)}
        </select>
        <label style={S.lbl}><input type="checkbox" aria-label="doar cu rest" checked={filtre.doarCuRest} onChange={e => setF('doarCuRest', e.target.checked)} /> doar cu rest</label>
        <label style={S.lbl}><input type="checkbox" aria-label="nedecontat deloc" checked={filtre.nedecontat} onChange={e => setF('nedecontat', e.target.checked)} /> nedecontat deloc</label>
        <label style={S.lbl}><input type="checkbox" aria-label="peste ofertă" checked={filtre.peste} onChange={e => setF('peste', e.target.checked)} /> peste ofertă</label>
        <input aria-label="caută" placeholder="caută cod / denumire" value={filtre.text} onChange={e => setF('text', e.target.value)} style={{ ...S.inp, minWidth: 200 }} />
        <span style={{ fontSize: 12, color: G.dim }}>{vizibile.length} din {date.articole.length} articole</span>
      </div>

      {!date.articole.length ? (
        <div style={{ color: G.muted, fontSize: 13, padding: '14px 0' }} data-gol="1">Niciun articol încă: încărcați oferta financiară (📥 Încarcă deviz) și apoi situațiile de plată.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 1150 }}>
            <thead><tr>
              <th style={S.th}>Cod</th><th style={S.th}>Denumire</th><th style={S.th}>UM</th>
              <th style={{ ...S.th, ...num }}>Cant. bază</th><th style={{ ...S.th, ...num }}>Cant. decontată</th><th style={{ ...S.th, ...num }}>Rest cant.</th>
              <th style={{ ...S.th, ...num }}>Valoare bază</th><th style={{ ...S.th, ...num }}>Decontat</th><th style={{ ...S.th, ...num }}>Rest</th><th style={{ ...S.th, ...num }}>%</th><th style={S.th}>Semnale</th>
            </tr></thead>
            <tbody>
              {grupe.map(gr => (
                <GrupObiect key={gr.obiect_cod} gr={gr} />
              ))}
            </tbody>
          </table>
          {!vizibile.length && <div style={{ color: G.dim, fontSize: 13, padding: 12 }}>Nimic pentru filtrele alese.</div>}
        </div>
      )}
    </div>
  )
}

function GrupObiect({ gr }) {
  const o = gr.obiect
  return (
    <>
      <tr data-obiect={gr.obiect_cod} style={{ background: G.card2 }}>
        <td style={{ ...S.td, fontWeight: 700 }} colSpan={6}>{gr.obiect_cod || '— fără obiect —'} <span style={{ color: G.muted, fontWeight: 400 }}>{o?.obiect_nume || ''}</span>
          {o && <span style={{ color: G.dim, fontWeight: 400, fontSize: 11.5 }}> · {o.articole} articole{o.articole_nedecontate ? ` · ${o.articole_nedecontate} nedecontate` : ''}{o.articole_peste ? ` · ${o.articole_peste} peste ofertă` : ''}{o.articole_noi ? ` · ${o.articole_noi} noi` : ''}</span>}
        </td>
        <td style={{ ...S.td, ...num, fontWeight: 700 }}>{o ? fmtLei(o.baza_valoare) : '—'}</td>
        <td style={{ ...S.td, ...num, fontWeight: 700 }}>{o ? fmtLei(o.decontat_valoare) : '—'}</td>
        <td style={{ ...S.td, ...num, fontWeight: 700, color: o && nr0(o.rest_valoare) < 0 ? G.red : G.text }}>{o ? fmtLei(o.rest_valoare) : '—'}</td>
        <td style={{ ...S.td, ...num }}>{o?.pct_decontat == null ? '—' : `${String(o.pct_decontat).replace('.', ',')}%`}</td>
        <td style={S.td} />
      </tr>
      {gr.articole.map(a => (
        <tr key={a.rand_id} data-articol={a.rand_id}>
          <td style={{ ...S.td, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{a.cod}<div style={{ fontSize: 10.5, color: G.dim, fontFamily: 'inherit' }}>{a.deviz_cod}{a.nr ? ` #${a.nr}` : ''}</div></td>
          <td style={{ ...S.td, maxWidth: 380 }}>{a.denumire}{!a.cheie && <span style={{ color: G.purple, fontSize: 11 }}> · în afara ofertei</span>}</td>
          <td style={S.td}>{a.um}</td>
          <td style={{ ...S.td, ...num }}>{fmtCant(a.baza_cantitate)}</td>
          <td style={{ ...S.td, ...num }}>{fmtCant(a.decontat_cantitate)}</td>
          <td style={{ ...S.td, ...num, color: nr0(a.rest_cantitate) < 0 ? G.red : G.text }}>{fmtCant(a.rest_cantitate)}</td>
          <td style={{ ...S.td, ...num }}>{fmtLei(a.baza_valoare)}</td>
          <td style={{ ...S.td, ...num }}>{fmtLei(a.decontat_valoare)}</td>
          <td style={{ ...S.td, ...num, color: nr0(a.rest_valoare) < 0 ? G.red : G.text }}>{fmtLei(a.rest_valoare)}</td>
          <td style={{ ...S.td, ...num }}>{a.pct_decontat == null ? '—' : `${String(a.pct_decontat).replace('.', ',')}%`}</td>
          <td style={S.td}>
            {a.peste_oferta && <Eticheta c={G.red}>peste ofertă</Eticheta>}
            {a.nedecontat && <Eticheta c={G.orange}>nedecontat</Eticheta>}
            {a.um_incert && <Eticheta c={G.yellow}>UM incert</Eticheta>}
          </td>
        </tr>
      ))}
    </>
  )
}
const Eticheta = ({ c, children }) => <span style={{ display: 'inline-block', fontSize: 11, color: c, border: `1px solid ${c}55`, borderRadius: 10, padding: '1px 7px', margin: '0 4px 3px 0', whiteSpace: 'nowrap' }}>{children}</span>
