// ════════════════════════════════════════════════════════════════════════
// IZOMETRIE E2b — stocul de țeavă Transgaz pe proiect (registrul din magazie_bucati)
// ════════════════════════════════════════════════════════════════════════
// Folosit în:  Magazie → 🧱 Țeavă proiecte (gestionarul)  și  Execuție → Izometrie (doar citire, aceeași sursă).
// DOAR CITIRE: bucățile registrului se scriu exclusiv prin funcțiile registrului (BD le refuză altfel).
// Înainte de migrarea 20261102a coloanele nu există → ecranul spune „registrul nu e instalat”, nu dă eroare.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './lib/supabase.js'
import { TIPURI, CATEGORII, tipStoc, categorieStare, totaluri, filtreaza, fmtM, metri, lipsaRegistru } from './lib/izoStoc.js'

const G = {
  bg:'#0D1117', surface:'#161B22', border:'#21262D', border2:'#30363D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  blue:'#58A6FF', green:'#3FB950', red:'#F85149', yellow:'#D29922',
  purple:'#BC8CFF', orange:'#F0883E', magazie:'#FF7B72', cyan:'#2FB6C9',
}
const S = {
  card: { background:G.surface, border:`1px solid ${G.border}`, borderRadius:12 },
  input: { background:G.bg, border:`1px solid ${G.border2}`, color:G.text, borderRadius:8, padding:'9px 12px', fontFamily:'inherit', fontSize:14, outline:'none', width:'100%' },
  btnS: { background:'#161B22', color:'#E6EDF3', border:'1px solid #30363D', borderRadius:8, padding:'8px 14px', fontFamily:'inherit', fontSize:13, fontWeight:600, cursor:'pointer' },
  th: { textAlign:'left', padding:'8px 10px', fontSize:12, color:G.muted, fontWeight:700, borderBottom:`1px solid ${G.border2}`, whiteSpace:'nowrap' },
  td: { padding:'7px 10px', fontSize:13, borderBottom:`1px solid ${G.border}` },
}
const CAT_CULOARE = { disponibil:G.green, in_drum:G.yellow, carantina:G.red, pe_tronson:G.blue, montat:G.purple, rest:G.dim, iesit:G.dim, anulat:G.dim, alta:G.muted }
const PAGINA = 1000
const MAX_LISTA = 400

export default function IzoStocTeava({ proiectId: proiectFix = null, citire = false, proiectInitial = null }) {
  const [stare, setStare] = useState({ incarc: true, eroare: null, neinstalat: false })
  const [bucati, setBucati] = useState([])
  const [proiecte, setProiecte] = useState([])
  const [depozite, setDepozite] = useState([])
  const [tronsoane, setTronsoane] = useState([])
  const [proiectId, setProiectId] = useState(proiectFix || proiectInitial)
  const [f, setF] = useState({ depozitId: '', tip: '', categorie: '', cauta: '' })
  const [faraAcces, setFaraAcces] = useState(false)
  // proiectul afișat: cel fix (Execuție) sau cel ales (Magazie) — o singură sursă peste tot
  const pidActiv = proiectFix || proiectId
  // doar ultima încărcare se aplică (schimbarea rapidă a proiectului nu lasă un răspuns vechi să-l suprascrie pe cel nou)
  const ultimaCerere = useRef(0)

  const incarca = useCallback(async () => {
    const cerere = ++ultimaCerere.current
    const curenta = () => cerere === ultimaCerere.current
    setStare({ incarc: true, eroare: null, neinstalat: false })
    try {
      // proiectele cu registru activ (nivel ≠ off) + numele lor
      const [rProt, rProj, rDep] = await Promise.all([
        supabase.rpc('fn_izo_proiecte_protejate'),
        supabase.from('executie_proiecte').select('id, nume, site_id').order('id'),
        supabase.from('logistica_depozite').select('id, name, cod_3litere, site_id').order('id'),
      ])
      if (!curenta()) return
      if (lipsaRegistru(rProt.error)) { setStare({ incarc: false, eroare: null, neinstalat: true }); return }
      for (const r of [rProt, rProj, rDep]) if (r.error) throw r.error
      const protejate = new Set((rProt.data || []).map(r => r.proiect_id))
      const lista = (rProj.data || []).filter(p => protejate.has(p.id) || p.id === proiectFix)
      setProiecte(lista)
      setDepozite(rDep.data || [])
      const pid = pidActiv || lista[0]?.id || null
      if (!proiectFix && pid !== pidActiv) setProiectId(pid)
      if (!pid) { setBucati([]); setStare({ incarc: false, eroare: null, neinstalat: false }); return }
      // decizia Razvan 21.10 (A): stocul de țeavă îl văd doar owner-ul și cei atribuiți proiectului (RLS face filtrarea;
      // aici doar explicăm de ce lista e goală)
      const { data: poate, error: eCit } = await supabase.rpc('fn_izo_citire', { p_proiect: pid })
      if (!curenta()) return
      if (eCit) { if (lipsaRegistru(eCit)) { setStare({ incarc: false, eroare: null, neinstalat: true }); return } throw eCit }
      // doar un „false” explicit înseamnă „fără atribuire”
      const blocat = poate === false
      setFaraAcces(blocat)
      if (blocat) { setBucati([]); setStare({ incarc: false, eroare: null, neinstalat: false }); return }
      const { data: tr, error: eTr } = await supabase.from('executie_tronsoane').select('id, cod, proiect_id').eq('proiect_id', pid)
      if (eTr) throw eTr
      if (!curenta()) return
      setTronsoane(tr || [])
      // bucățile registrului, paginate pe CHEIE (id > ultimul), nu pe offset: orice bucată care există pe toată durata
      // încărcării apare exact o dată (mișcările concurente nu mută paginile); merge și sub limita max-rows a API-ului
      const toate = []
      for (let ultim = 0; ; ) {
        const { data, error } = await supabase.from('magazie_bucati')
          .select('id, proiect_id, tip_cod, serie, serie_canon, sarja, lungime_mm, perete_mm, unghi_curba, stare, depozit_id, tronson_id, atribute, nr_document, data_receptie, updated_at')
          .eq('proiect_id', pid).eq('provenienta', 'beneficiar').not('tip_cod', 'is', null)
          .gt('id', ultim).order('id').limit(PAGINA)
        if (!curenta()) return
        if (error) {
          if (lipsaRegistru(error)) { setStare({ incarc: false, eroare: null, neinstalat: true }); return }
          throw error
        }
        if (!data?.length) break
        toate.push(...data); ultim = data[data.length - 1].id
      }
      if (!curenta()) return
      setBucati(toate)
      setStare({ incarc: false, eroare: null, neinstalat: false })
    } catch (e) {
      console.error(e)
      if (!curenta()) return
      setStare({ incarc: false, eroare: e.message || String(e), neinstalat: false })
    }
  }, [proiectFix, pidActiv])
  useEffect(() => { incarca() }, [incarca])

  const depMap = useMemo(() => Object.fromEntries(depozite.map(d => [d.id, d.cod_3litere || d.name])), [depozite])
  const depNume = useMemo(() => Object.fromEntries(depozite.map(d => [d.id, d.name])), [depozite])
  const trMap = useMemo(() => Object.fromEntries(tronsoane.map(t => [t.id, t.cod])), [tronsoane])
  const proiect = proiecte.find(p => p.id === pidActiv)
  const depoziteProiect = useMemo(() => depozite.filter(d => proiect && d.site_id === proiect.site_id), [depozite, proiect])
  const tot = useMemo(() => totaluri(bucati, { depozite: depMap, tronsoane: trMap }), [bucati, depMap, trMap])
  const lista = useMemo(() => filtreaza(bucati, f), [bucati, f])

  if (stare.incarc) return <div style={{ padding:30, color:G.dim, textAlign:'center' }}>Se încarcă stocul de țeavă…</div>
  if (stare.neinstalat) return (
    <div style={{ ...S.card, padding:20, color:G.muted, fontSize:14 }}>
      🧱 Registrul de țeavă Transgaz nu e încă instalat (migrarea Izometrie E2a). Stocul LOT 2 se ține deocamdată în Excel.
    </div>
  )
  if (stare.eroare) return <div style={{ ...S.card, padding:20, color:G.red }}>Eroare la încărcare: {stare.eroare} <button style={{ ...S.btnS, marginLeft:10 }} onClick={incarca}>Reîncearcă</button></div>
  if (!proiecte.length && !proiectFix) return (
    <div style={{ ...S.card, padding:20, color:G.muted, fontSize:14 }}>Niciun proiect cu registru de țeavă activ. Stocul apare aici după importul soldului inițial.</div>
  )

  if (faraAcces) return (
    <div>
      {!proiectFix && proiecte.length > 1 && (
        <select style={{ ...S.input, maxWidth:360, marginBottom:14 }} value={pidActiv || ''} onChange={e => { setProiectId(Number(e.target.value)); setF({ depozitId:'', tip:'', categorie:'', cauta:'' }) }}>
          {proiecte.map(p => <option key={p.id} value={p.id}>{p.nume}</option>)}
        </select>
      )}
      <div style={{ ...S.card, padding:20, color:G.muted, fontSize:14 }}>
        🔒 Nu ești atribuit pe acest proiect, așa că nu vezi stocul lui de țeavă Transgaz. Îl văd doar oamenii atribuiți proiectului (inginer, manager de proiect, gestionar) și owner-ul; atribuirea o dă Răzvan.
      </div>
    </div>
  )

  const randuriMatrice = Object.keys(tot.matrice)
    .map(k => { const [cat, loc] = k.split('|'); return { cat, loc, v: tot.matrice[k] } })
    .sort((a, b) => CATEGORII.findIndex(c => c.cheie === a.cat) - CATEGORII.findIndex(c => c.cheie === b.cat) || a.loc.localeCompare(b.loc, 'ro', { numeric:true }))
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))

  return (
    <div>
      <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center', marginBottom:14 }}>
        {!proiectFix && (
          <select style={{ ...S.input, maxWidth:360 }} value={pidActiv || ''} onChange={e => { setProiectId(Number(e.target.value)); setF({ depozitId:'', tip:'', categorie:'', cauta:'' }) }}>
            {proiecte.map(p => <option key={p.id} value={p.id}>{p.nume}</option>)}
          </select>
        )}
        <div style={{ fontSize:12, color:G.muted, flex:1 }}>
          {citire ? '👁️ Doar citire — ' : ''}Stocul de țeavă și curbe Transgaz, din registru (aceeași sursă în Magazie și în Execuție). Mișcările se fac doar prin modulul de țeavă.
        </div>
        <button style={S.btnS} onClick={incarca}>🔄 Reîncarcă</button>
      </div>

      {/* KPI pe categorii */}
      <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:14 }}>
        {['disponibil', 'in_drum', 'pe_tronson', 'montat'].map(c => {
          const meta = CATEGORII.find(x => x.cheie === c)
          const v = tot.pe[c] || { n:0, m:0 }
          return (
            <button key={c} onClick={() => set('categorie', f.categorie === c ? '' : c)}
              style={{ ...S.card, padding:'12px 16px', flex:1, minWidth:170, textAlign:'left', cursor:'pointer', color:G.text,
                borderColor: f.categorie === c ? CAT_CULOARE[c] : G.border }}>
              <div style={{ fontSize:12, color:G.muted, marginBottom:4 }}>{meta.label}</div>
              <div style={{ fontSize:22, fontWeight:800, color:CAT_CULOARE[c] }}>{v.n} <span style={{ fontSize:13, color:G.muted, fontWeight:600 }}>buc · {fmtM(v.m)} m</span></div>
            </button>
          )
        })}
      </div>

      {/* matricea loc × tip */}
      <div style={{ ...S.card, padding:0, overflowX:'auto', marginBottom:14 }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr>
              <th style={S.th}>Stare</th><th style={S.th}>Loc</th>
              {TIPURI.map(t => <th key={t.cheie} style={{ ...S.th, textAlign:'right' }}>{t.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {randuriMatrice.length === 0 && <tr><td colSpan={2 + TIPURI.length} style={{ ...S.td, color:G.dim, textAlign:'center' }}>Nicio bucată în registru pentru acest proiect.</td></tr>}
            {randuriMatrice.map(r => (
              <tr key={`${r.cat}|${r.loc}`}>
                <td style={{ ...S.td, color:CAT_CULOARE[r.cat], fontWeight:700 }}>{CATEGORII.find(c => c.cheie === r.cat)?.label || r.cat}</td>
                <td style={{ ...S.td, fontWeight:700 }}>{r.loc}</td>
                {TIPURI.map(t => {
                  const v = r.v[t.cheie]
                  return <td key={t.cheie} style={{ ...S.td, textAlign:'right', fontVariantNumeric:'tabular-nums', color: v ? G.text : G.dim }}>
                    {v ? <>{v.n} buc{t.cheie !== 'curba' && <span style={{ color:G.muted }}> · {fmtM(v.m)} m</span>}</> : '—'}
                  </td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* filtre + listă */}
      <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:10 }}>
        <input style={{ ...S.input, maxWidth:260 }} placeholder="🔍 Serie (ultimele cifre) / șarjă" value={f.cauta} onChange={e => set('cauta', e.target.value)} />
        <select style={{ ...S.input, maxWidth:220 }} value={f.depozitId} onChange={e => set('depozitId', e.target.value)}>
          <option value="">Toate depozitele</option>
          {depoziteProiect.map(d => <option key={d.id} value={d.id}>{d.cod_3litere} — {d.name}</option>)}
        </select>
        <select style={{ ...S.input, maxWidth:200 }} value={f.tip} onChange={e => set('tip', e.target.value)}>
          <option value="">Toate tipurile</option>
          {TIPURI.map(t => <option key={t.cheie} value={t.cheie}>{t.label}</option>)}
        </select>
        <select style={{ ...S.input, maxWidth:240 }} value={f.categorie} onChange={e => set('categorie', e.target.value)}>
          <option value="">Toate (fără anulate)</option>
          {CATEGORII.map(c => <option key={c.cheie} value={c.cheie}>{c.label}</option>)}
        </select>
      </div>
      <div style={{ fontSize:12, color:G.muted, marginBottom:6 }}>
        {lista.length} bucăți · {fmtM(lista.reduce((s, b) => s + metri(b), 0))} m{lista.length > MAX_LISTA ? ` — se afișează primele ${MAX_LISTA}; restrânge cu filtrele` : ''}
      </div>
      <div style={{ ...S.card, padding:0, overflowX:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr>{['Serie', 'Șarjă', 'Tip', 'L (m)', 'Perete', 'Stare', 'Loc', 'Aviz intrare'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {lista.slice(0, MAX_LISTA).map(b => {
              const c = categorieStare(b.stare)
              const loc = (c === 'pe_tronson' || c === 'montat') ? (trMap[b.tronson_id] || '—') + (b.atribute?.depozit_origine_id ? ` (din ${depMap[b.atribute.depozit_origine_id] || '?'})` : '') : (depNume[b.depozit_id] || '—')
              return (
                <tr key={b.id}>
                  <td style={{ ...S.td, fontWeight:700, fontFamily:'monospace' }}>{b.serie}</td>
                  <td style={{ ...S.td, fontFamily:'monospace' }}>{b.sarja || '—'}</td>
                  <td style={S.td}>{TIPURI.find(t => t.cheie === tipStoc(b))?.scurt}{b.tip_cod === 'curba' && b.unghi_curba ? ` ${Number(b.unghi_curba)}°` : ''}</td>
                  <td style={{ ...S.td, textAlign:'right', fontVariantNumeric:'tabular-nums' }}>{b.lungime_mm != null ? fmtM(b.lungime_mm / 1000) : '—'}</td>
                  <td style={{ ...S.td, fontWeight:800, color: Number(b.perete_mm) >= 8.5 ? G.orange : G.cyan }}>{b.perete_mm != null ? String(b.perete_mm).replace('.', ',') : '—'}</td>
                  <td style={{ ...S.td, color:CAT_CULOARE[c] }}>{CATEGORII.find(x => x.cheie === c)?.label || b.stare}</td>
                  <td style={S.td}>{loc}</td>
                  <td style={{ ...S.td, color:G.muted }}>{b.nr_document || '—'}</td>
                </tr>
              )
            })}
            {!lista.length && <tr><td colSpan={8} style={{ ...S.td, color:G.dim, textAlign:'center' }}>Nimic pentru filtrele alese.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
