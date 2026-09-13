// ════════════════════════════════════════════════════════════════
// OfertareRevizii.jsx — reviziile propunerii tehnice: editor de capitol, istoric, observații
//
// Răspunsul la întrebarea „cum modificăm doar ce trebuie, fără să regenerăm tot":
//
// 1. Unitatea de schimbare e CAPITOLUL. La Contești propunerea depusă are 1144 de pagini;
//    nimeni nu regenerează 1144 de pagini fiindcă s-au cerut două rânduri în cap. 3.
// 2. Nu se regenerează ce a atins un om: `sursa` + `blocat` pe capitol. Generatorul sare peste ele.
// 3. Se versionează CAPITOLUL, nu documentul. O revizie = mulțimea versiunilor curente ale
//    capitolelor, nu o copie a întregii propuneri.
// 4. Se stochează textul INTEGRAL al versiunii vechi, iar diff-ul se calculează AICI, la afișare.
//    Un diff stocat îmbătrânește prost: dacă schimbi algoritmul, istoricul vechi rămâne mincinos.
//
// Versionarea în sine NU e aici — o face triggerul trg_pt_capitol_versioneaza. Dacă ar depinde de
// UI, prima scriere din alt loc (import, edge function, un fix la mână) ar sări peste istoric.
// ════════════════════════════════════════════════════════════════
import { useState, useMemo } from 'react'

const G = { bg:'#0D1117', surface:'#161B22', card:'#1C2128', border:'#30363D', border2:'#21262D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  ofertare:'#3FB6E2', green:'#3FB950', blue:'#58A6FF', orange:'#F0883E',
  yellow:'#E3B341', red:'#F85149', purple:'#A371F7' }
const S = {
  input: { width:'100%', boxSizing:'border-box', background:G.bg, border:`1px solid ${G.border2}`, borderRadius:6, padding:'8px 12px', color:G.text, fontSize:13, outline:'none' },
  lbl: { display:'block', fontSize:11, color:G.muted, marginBottom:4, fontWeight:600, textTransform:'uppercase', letterSpacing:'.3px' },
  btnP: { padding:'9px 18px', background:G.ofertare, color:'#0D1117', border:'none', borderRadius:7, cursor:'pointer', fontSize:13, fontWeight:700 },
  btn: { padding:'6px 12px', background:G.surface, color:G.text, border:`1px solid ${G.border2}`, borderRadius:6, cursor:'pointer', fontSize:12 },
  card: { background:G.card, border:`1px solid ${G.border}`, borderRadius:10 },
}

const fmtMoment = t => t ? new Date(t).toLocaleString('ro-RO', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—'

// Proveniența, ca etichetă. „om" nu primește insignă: e cazul normal, iar o insignă pe fiecare
// rând n-ar mai însemna nimic. Se marchează doar ce NU e scris de om.
export const INSIGNA_SURSA = {
  ai:     { t:'AI',     c:G.purple },
  extern: { t:'extern', c:G.orange },
  sablon: { t:'șablon', c:G.dim },
}

// ─────────────────────────────────────────────────────────────────
// DIFF pe linii (LCS clasic). Nu pe cuvinte: textul unui capitol de propunere se editează
// pe paragrafe, iar un diff pe cuvinte în paragrafe de 40 de rânduri e nectitibil.
// Plafon de siguranță: matricea LCS e O(n*m), deci peste PRAG cade pe „schimbat, vezi textele".
// ─────────────────────────────────────────────────────────────────
const PRAG_LINII = 400

export function diffLinii(vechi, nou) {
  // ''.split('\n') da [''], deci un capitol gol care se scrie prima oara ar arata un rand sters
  // gol. Nu e o stergere, e primul text.
  const spl = t => String(t || '') === '' ? [] : String(t).split('\n')
  const a = spl(vechi)
  const b = spl(nou)
  if (a.length > PRAG_LINII || b.length > PRAG_LINII) return null
  // lcs[i][j] = lungimea celui mai lung subsir comun intre a[i..] si b[j..]
  const lcs = Array.from({ length: a.length + 1 }, () => new Int32Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  const out = []
  let i = 0, j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push({ fel:'=', text:a[i] }); i++; j++ }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { out.push({ fel:'-', text:a[i] }); i++ }
    else { out.push({ fel:'+', text:b[j] }); j++ }
  }
  while (i < a.length) out.push({ fel:'-', text:a[i++] })
  while (j < b.length) out.push({ fel:'+', text:b[j++] })
  return out
}

// Se arată doar liniile schimbate plus CONTEXT linii în jurul lor. Un capitol de 300 de rânduri
// din care s-au schimbat două nu trebuie citit integral ca să vezi care două.
const CONTEXT = 2

function Diff({ vechi, nou }) {
  const randuri = useMemo(() => diffLinii(vechi, nou), [vechi, nou])
  if (randuri === null) return (
    <div style={{ fontSize:12, color:G.muted, padding:'6px 0' }}>
      Textele sunt prea lungi pentru un diff pe linii (peste {PRAG_LINII} rânduri). Deschide versiunile ca să compari.
    </div>
  )
  const schimbate = randuri.filter(r => r.fel !== '=').length
  if (!schimbate) return <div style={{ fontSize:12, color:G.muted, padding:'6px 0' }}>Fără diferențe de text.</div>
  const arata = new Set()
  randuri.forEach((r, k) => {
    if (r.fel === '=') return
    for (let d = -CONTEXT; d <= CONTEXT; d++) if (randuri[k + d]) arata.add(k + d)
  })
  const culoare = { '+': G.green, '-': G.red, '=': G.dim }
  const fundal  = { '+': G.green + '16', '-': G.red + '16', '=': 'transparent' }
  let ultim = -2
  return (
    <pre style={{ margin:'6px 0 0', fontSize:12, lineHeight:1.55, fontFamily:'ui-monospace, monospace',
                  whiteSpace:'pre-wrap', wordBreak:'break-word' }}>
      {randuri.map((r, k) => {
        if (!arata.has(k)) return null
        const rupt = k > ultim + 1
        ultim = k
        return (
          <div key={k}>
            {rupt && <div style={{ color:G.dim, padding:'2px 0' }}>⋯</div>}
            <div style={{ color:culoare[r.fel], background:fundal[r.fel], padding:'0 6px' }}>
              {r.fel === '=' ? '  ' : r.fel + ' '}{r.text || ' '}
            </div>
          </div>
        )
      })}
    </pre>
  )
}

// ─────────────────────────────────────────────────────────────────
// ISTORICUL unui capitol. Versiunile vin din ofertare_pt_capitole_versiuni (scrise de trigger),
// iar versiunea CURENTĂ e rândul viu din ofertare_pt_capitole — nu e în istoric, fiindcă
// istoricul păstrează ce a fost ÎNLOCUIT.
// ─────────────────────────────────────────────────────────────────
export function IstoricCapitol({ capitol, versiuni, nume }) {
  const [deschis, setDeschis] = useState(null)
  // Descrescător: cel mai recent sus. Perechea de comparat e (v, v+1), unde v+1 poate fi rândul viu.
  const lista = useMemo(() => [...versiuni].sort((a, b) => b.versiune - a.versiune), [versiuni])
  if (!lista.length) return (
    <div style={{ fontSize:12, color:G.muted }}>
      Capitolul e la versiunea 1 — n-a fost încă rescris, deci n-are istoric.
    </div>
  )
  const textulVersiunii = v => lista.find(x => x.versiune === v)?.continut ?? (v === capitol.versiune ? capitol.continut : null)
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
      {lista.map(v => {
        // ce a înlocuit versiunea asta: următoarea versiune (istoric sau rândul viu)
        const dupa = textulVersiunii(v.versiune + 1)
        const e = deschis === v.id
        return (
          <div key={v.id} style={{ borderLeft:`2px solid ${G.border}`, paddingLeft:10 }}>
            <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', fontSize:12 }}>
              <b style={{ color:G.text }}>v{v.versiune} → v{v.versiune + 1}</b>
              <span style={{ color:G.muted }}>{fmtMoment(v.created_at)}</span>
              <span style={{ color:G.muted }}>· {nume(v.schimbat_de)}</span>
              {v.motiv && <span style={{ color:G.muted }}>· {v.motiv}</span>}
              <button onClick={() => setDeschis(e ? null : v.id)} style={{ ...S.btn, padding:'2px 8px', fontSize:11 }}>
                {e ? 'ascunde' : 'ce s-a schimbat'}
              </button>
            </div>
            {e && (dupa === null
              ? <div style={{ fontSize:12, color:G.muted, padding:'6px 0' }}>Versiunea următoare nu e în istoric.</div>
              : <Diff vechi={v.continut} nou={dupa} />)}
          </div>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// EDITORUL unui capitol. Salvarea trece prin trigger, deci fiecare salvare cu text schimbat
// naște o versiune. De aceea butonul e „Salvează (versiune nouă)" — omul trebuie să știe
// că apasă pe o revizie, nu pe un autosave.
// ─────────────────────────────────────────────────────────────────
export function EditorCapitol({ capitol, onSalveaza, onInchide, busy }) {
  const [text, setText] = useState(capitol.continut || '')
  const schimbat = text !== (capitol.continut || '')
  return (
    <div style={{ padding:'10px 14px', background:G.bg, borderTop:`1px solid ${G.border2}` }}>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={16} autoFocus
        placeholder="Textul capitolului, așa cum intră în propunere."
        style={{ ...S.input, fontFamily:'ui-monospace, monospace', lineHeight:1.55, resize:'vertical' }} />
      <div style={{ display:'flex', gap:8, alignItems:'center', marginTop:8, flexWrap:'wrap' }}>
        <button disabled={busy || !schimbat}
          onClick={async () => { if (await onSalveaza(capitol, text)) onInchide() }}
          style={{ ...S.btnP, opacity: (busy || !schimbat) ? .45 : 1 }}>
          Salvează (versiune nouă)
        </button>
        <button onClick={onInchide} style={S.btn}>Renunță</button>
        <span style={{ fontSize:12, color:G.muted }}>
          {schimbat
            ? `la salvare devine v${capitol.versiune + 1}; textul de acum rămâne în istoric ca v${capitol.versiune}`
            : `v${capitol.versiune}, nemodificat`}
        </span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// OBSERVAȚIILE — cererile de modificare. Obiect separat de modificarea în sine.
//
// Fluxul ăsta EXISTĂ deja la ei, doar că trăiește în numele folderelor: licitația 148
// (Petroconst) are „completari_observatii propunere tehnica 29.04.2025" și „...30.04.2025",
// iar documentul de la Motru se numește literalmente „rev 1".
//
// O observație se închide DOAR cu răspuns scris — și în BD (CHECK), nu doar aici. Închiderea
// notează versiunea capitolului la acel moment: așa „ce s-a schimbat la revizia asta" se
// răspunde singur, fără raport scris de mână.
// ─────────────────────────────────────────────────────────────────
export function Observatii({ observatii, capitole, nume, onAdauga, onInchide, busy }) {
  const [nou, setNou] = useState(null)
  const [vechi, setVechi] = useState(false)

  const titluCap = id => {
    const c = capitole.find(x => x.id === id)
    return c ? `${c.eticheta || c.nr + '.'} ${c.titlu}` : 'întreaga propunere'
  }
  const deschise = observatii.filter(o => o.stare === 'deschisa')
  const inchise  = observatii.filter(o => o.stare !== 'deschisa')

  const rand = o => {
    const cap = capitole.find(x => x.id === o.capitol_id)
    return (
      <div key={o.id} style={{ padding:'10px 14px', borderTop:`1px solid ${G.border2}` }}>
        <div style={{ display:'flex', gap:8, alignItems:'baseline', flexWrap:'wrap', fontSize:12, color:G.muted }}>
          <span style={{ color: o.stare === 'deschisa' ? G.orange : o.stare === 'respinsa' ? G.dim : G.green, fontWeight:700 }}>
            {o.stare === 'deschisa' ? 'DESCHISĂ' : o.stare === 'respinsa' ? 'respinsă' : 'rezolvată'}
          </span>
          <span style={{ color:G.blue }}>{titluCap(o.capitol_id)}</span>
          <span>· {nume(o.cerut_de)} · {fmtMoment(o.cerut_la)}</span>
          {o.rezolvat_in_versiunea && <span>· rezolvată în v{o.rezolvat_in_versiunea}</span>}
        </div>
        <div style={{ fontSize:13, color:G.text, marginTop:4, whiteSpace:'pre-wrap' }}>{o.text}</div>
        {o.raspuns && (
          <div style={{ fontSize:12, color:G.muted, marginTop:4, paddingLeft:10, borderLeft:`2px solid ${G.border}` }}>
            ↳ {o.raspuns} <span style={{ color:G.dim }}>({nume(o.rezolvat_de)}, {fmtMoment(o.rezolvat_la)})</span>
          </div>
        )}
        {o.stare === 'deschisa' && (
          <div style={{ display:'flex', gap:8, marginTop:6 }}>
            <button disabled={busy} onClick={() => onInchide(o, 'rezolvata', cap)} style={S.btn}>✓ Am rezolvat-o</button>
            <button disabled={busy} onClick={() => onInchide(o, 'respinsa', cap)} style={S.btn}>✕ Nu se face</button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <div style={{ ...S.card, overflow:'hidden' }}>
        <div style={{ padding:'10px 14px', display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
          <span style={{ fontSize:13, color: deschise.length ? G.orange : G.muted }}>
            {deschise.length
              ? `${deschise.length} ${deschise.length === 1 ? 'observație deschisă' : 'observații deschise'}`
              : 'Nicio observație deschisă.'}
          </span>
          {!nou && (
            <button onClick={() => setNou({ capitol_id:'', text:'' })} disabled={busy}
              style={{ ...S.btn, marginLeft:'auto' }}>➕ Cere o modificare</button>
          )}
        </div>
        {nou && (
          <div style={{ padding:'10px 14px', borderTop:`1px solid ${G.border2}`, display:'flex', flexDirection:'column', gap:8 }}>
            <select value={nou.capitol_id} onChange={e => setNou({ ...nou, capitol_id: e.target.value })}
              style={{ ...S.input, width:'auto', minWidth:280 }}>
              <option value="">întreaga propunere (fără capitol anume)</option>
              {capitole.map(c => <option key={c.id} value={c.id}>{c.eticheta || c.nr + '.'} {c.titlu}</option>)}
            </select>
            <textarea value={nou.text} onChange={e => setNou({ ...nou, text: e.target.value })} rows={3} autoFocus
              placeholder="Ce trebuie schimbat și de ce. Scris ca pentru cel care o să facă modificarea, nu ca notiță."
              style={{ ...S.input, resize:'vertical' }} />
            <div style={{ display:'flex', gap:8 }}>
              <button disabled={busy || !nou.text.trim()}
                onClick={async () => { if (await onAdauga(nou)) setNou(null) }}
                style={{ ...S.btnP, opacity: (busy || !nou.text.trim()) ? .45 : 1 }}>Trimite observația</button>
              <button onClick={() => setNou(null)} style={S.btn}>Renunță</button>
            </div>
          </div>
        )}
        {deschise.map(rand)}
      </div>
      {inchise.length > 0 && (
        <div style={{ marginTop:8 }}>
          <button onClick={() => setVechi(!vechi)} style={S.btn}>
            {vechi ? 'ascunde' : 'arată'} cele {inchise.length} închise
          </button>
          {vechi && <div style={{ ...S.card, overflow:'hidden', marginTop:8 }}>{inchise.map(rand)}</div>}
        </div>
      )}
    </div>
  )
}
