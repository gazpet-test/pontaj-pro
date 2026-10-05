// ════════════════════════════════════════════════════════════════
// OfertareTermene.jsx — Registrul de termene al unei licitații (tab „Detalii” din modalul licitației).
// Lecția Mânăstirea (05.10.2026): întrebări / răspuns AC / contestație s-au calculat de mână, de mai multe ori,
// cu „3 zile” din memorie. Aici: o singură dată, din fișa de date (text extras) + termenul SEAP + actele publicate.
// Logica e în ofertareTermene.js (testată). Nimic nu se salvează: zilele editate de om rămân doar în ecran.
// Toate termenele sunt ORIENTATIVE (zile calendaristice, ora României) — confirmarea juridică rămâne a omului.
// ════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from './lib/supabase.js'
import { calculeazaTermene, combinaFise, canalDinAnunt, PRAG_LUCRARI_LEI } from './ofertareTermene.js'

const G = { bg:'#0D1117', surface:'#161B22', card:'#1C2128', border:'#30363D', border2:'#21262D', text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  ofertare:'#3FB6E2', green:'#3FB950', blue:'#58A6FF', orange:'#F0883E', yellow:'#E3B341', red:'#F85149' }
const CUL_STARE = { trecut: G.dim, azi: G.orange, viitor: G.green }
const TIP_ACT = { erata: '🔴 erată', raspuns_clarificare: '🟠 răspuns clarificare', document_nou: '⚪ documente noi' }
const LIMITA_ACTE = 500
const fmtZi = zi => zi ? zi.split('-').reverse().join('.') : '—'
const fmtLei = n => n == null ? '—' : Number(n).toLocaleString('ro-RO', { maximumFractionDigits: 0 }) + ' lei'
const inputMic = { width:54, background:G.bg, border:`1px solid ${G.border2}`, borderRadius:5, padding:'2px 6px', color:G.text, fontSize:12, textAlign:'center' }

export default function OfertareTermene({ licitatie: l }) {
  const [docs, setDocs] = useState(null)                   // null = se încarcă; [] = nimic
  const [fisa, setFisa] = useState(null)                   // null = se încarcă; { zileIntrebari, zileRaspuns, docId, lipsa }
  const [eroare, setEroare] = useState(null)
  const [zile, setZile] = useState({ intrebari: '', raspuns: '' })   // override uman — doar în ecran
  const editat = useRef({ intrebari: false, raspuns: false })   // câmpurile atinse de om nu sunt suprascrise de încărcare (per câmp)
  const [tick, setTick] = useState(0)                      // „azi” se recalculează și dacă modalul stă deschis peste miezul nopții
  useEffect(() => { const t = setInterval(() => setTick(x => x + 1), 60000); return () => clearInterval(t) }, [])
  const areTermen = !!l.termen_depunere
  useEffect(() => {
    let viu = true
    // Licitație nouă în aceeași instanță: starea veche nu rămâne afișată lângă termenul/valoarea celei noi.
    // Resetul NU se face la schimbarea termenului aceleiași licitații (ar pierde corecțiile omului — review Jakarinos r2, N1).
    setDocs(null); setFisa(null); setEroare(null); setZile({ intrebari: '', raspuns: '' }); editat.current = { intrebari: false, raspuns: false }
    if (!areTermen) return
    // Actele: ultimele LIMITA_ACTE după dată (cele recente contează pentru contestație); includem și eratele marcate de citirea AI
    // pe documente care nu sunt nici „apărute ulterior”, nici răspunsuri. Fișa: cifrele vin din TEXTUL EXTRAS, nu din rezumatul AI.
    supabase.from('ofertare_documente_atribuire')
      .select('id, nume_original, tip, aparut_ulterior, created_at, citire:analiza->citire_noi')
      .eq('licitatie_id', l.id).or('aparut_ulterior.eq.true,tip.eq.raspuns_clarificare,analiza->citire_noi->>tip.eq.erata')
      .order('created_at', { ascending: false }).limit(LIMITA_ACTE)
      .then(({ data, error }) => { if (!viu) return; if (error) setEroare(e => (e ? e + ' · ' : '') + 'actele: ' + error.message); setDocs(error ? [] : (data || [])) })
    supabase.from('ofertare_documente_atribuire')
      .select('id, text_extras').eq('licitatie_id', l.id).eq('tip', 'fisa_date').not('text_extras', 'is', null).order('id').limit(3)
      .then(({ data, error }) => {
        if (!viu) return
        if (error) { setEroare(e => (e ? e + ' · ' : '') + 'fișa: ' + error.message); setFisa({ zileIntrebari: null, zileRaspuns: null, lipsa: false, eroare: true }); return }
        const f = combinaFise(data || [])
        setFisa({ ...f, lipsa: !(data || []).length })
        setZile(z => ({ intrebari: editat.current.intrebari ? z.intrebari : (f.zileIntrebari ?? ''), raspuns: editat.current.raspuns ? z.raspuns : (f.zileRaspuns ?? '') }))
      })
    return () => { viu = false }
  }, [l.id, areTermen])   // eslint-disable-line react-hooks/exhaustive-deps

  const canal = canalDinAnunt(l.nr_anunt, l.canal)
  // Zile: ÎNTREG între 0 și 365 — orice altceva (gol, text, 18.5, -1, 1e9) = necunoscut, nu excepție la randare și nu rotunjire tăcută.
  const nr = v => { if (v === '' || v == null) return null; const n = Number(v); return Number.isInteger(n) && n >= 0 && n <= 365 ? n : null }
  const invalid = v => v !== '' && v != null && nr(v) == null
  const incarcat = docs !== null && fisa !== null
  const trunchiat = (docs?.length || 0) >= LIMITA_ACTE   // lista poate fi incompletă → nicio concluzie categorică
  const calc = useMemo(() => calculeazaTermene({
    termenDepunere: l.termen_depunere, zileIntrebari: nr(zile.intrebari), zileRaspuns: nr(zile.raspuns),
    canal, valoareEstimata: l.valoare_estimata, docs: docs || [],
  }), [l.termen_depunere, l.valoare_estimata, canal, zile, docs, tick])   // eslint-disable-line react-hooks/exhaustive-deps

  if (!l.termen_depunere) return (
    <div style={{ marginTop:14, padding:'10px 12px', borderRadius:8, border:`1px dashed ${G.border}`, color:G.muted, fontSize:12.5 }}>
      ⏱ Registrul de termene apare după ce licitația are termen de depunere (se completează la „Adu din SEAP” sau la editare).
    </div>
  )
  const editabil = (cheie, val) => (
    <input style={{ ...inputMic, borderColor: invalid(val) ? G.red : G.border2 }} type="number" min="0" max="365" step="1" value={val} placeholder="?" title="Zile înainte de termenul de depunere (întreg, 0–365) — se poate corecta aici, nu se salvează"
      onChange={e => { editat.current[cheie] = true; setZile(z => ({ ...z, [cheie]: e.target.value })) }} />
  )
  return (
    <div style={{ marginTop:14, padding:14, borderRadius:10, border:`1px solid ${G.border}`, background:G.card }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', marginBottom:8 }}>
        <div style={{ fontSize:13, fontWeight:800 }}>⏱ Registru termene</div>
        <span style={{ fontSize:11, color:G.dim }}>orientativ — zile calendaristice, ora României; confirmarea juridică rămâne a omului</span>
        {canal && canal !== (l.canal || null) && <span style={{ fontSize:11, color:G.yellow, marginLeft:'auto' }} title={`Câmpul „canal” din ERP spune ${l.canal || '—'}, numărul anunțului ${l.nr_anunt} spune altceva. Calculul folosește anunțul.`}>⚠️ canal după nr. anunț: {canal.replace('seap_', 'SEAP ').toUpperCase()}</span>}
      </div>
      {eroare && <div style={{ fontSize:12, color:G.red, marginBottom:8 }}>⚠️ Nu am putut încărca {eroare} — termenele de mai jos sunt incomplete.</div>}
      {fisa?.lipsa && <div style={{ fontSize:12, color:G.yellow, marginBottom:8 }}>⚠️ Nu există fișă de date citită (text extras) — completează zilele manual sau citește fișa în Documentație.</div>}
      {fisa && !fisa.lipsa && !fisa.eroare && fisa.zileIntrebari == null && fisa.zileRaspuns == null && <div style={{ fontSize:12, color:G.yellow, marginBottom:8 }}>⚠️ Fișa de date e citită, dar n-am găsit cifrele de zile în text — completează-le manual.</div>}
      {fisa === null && <div style={{ fontSize:11, color:G.dim, marginBottom:6 }}>se citește fișa de date…</div>}
      {(fisa?.docIntrebari || fisa?.docRaspuns) && <div style={{ fontSize:11, color:G.dim, marginBottom:6 }}>cifrele din fișă:{fisa.zileIntrebari != null ? ` întrebări ${fisa.zileIntrebari} zile (doc #${fisa.docIntrebari})` : ''}{fisa.zileRaspuns != null ? ` · răspuns ${fisa.zileRaspuns} zile (doc #${fisa.docRaspuns})` : ''}</div>}
      {(invalid(zile.intrebari) || invalid(zile.raspuns)) && <div style={{ fontSize:11.5, color:G.red, marginBottom:6 }}>Zilele trebuie să fie un număr întreg între 0 și 365 — valoarea tastată nu e folosită în calcul.</div>}

      {calc.repere.map(r => (
        <div key={r.cheie} style={{ display:'grid', gridTemplateColumns:'220px 110px 1fr', gap:10, alignItems:'center', padding:'6px 0', borderBottom:`1px solid ${G.border2}`, fontSize:12.5 }}>
          <span style={{ color:G.muted }}>{r.eticheta}</span>
          <b style={{ color: r.zi ? CUL_STARE[r.stare] : G.orange }}>{r.zi ? fmtZi(r.zi) : 'necunoscut'}{r.ora ? ` ${r.ora}` : ''}</b>
          <span style={{ color:G.dim, display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
            {r.zi && (r.stare === 'trecut' ? `trecut (acum ${-r.zile} zile)` : r.stare === 'azi' ? 'AZI' : `peste ${r.zile} zile`)}
            {r.cheie === 'intrebari' && <>· fișa: {editabil('intrebari', zile.intrebari)} zile înainte</>}
            {r.cheie === 'raspuns' && <>· fișa: {editabil('raspuns', zile.raspuns)} zile înainte{nr(zile.raspuns) == null && <span>({r.sursa})</span>}</>}
          </span>
        </div>
      ))}

      {/* Alertele doar după ce s-au încărcat actele: altfel „niciun răspuns” ar apărea și cât timp lista e goală pentru că încă vine. */}
      {incarcat && !eroare && !trunchiat && calc.intarziereAC && (
        <div style={{ marginTop:10, padding:'8px 10px', borderRadius:8, background:G.red + '14', border:`1px solid ${G.red}55`, color:G.red, fontSize:12.5 }}>
          ⛔ AC nu a publicat niciun răspuns la clarificări după termenul de întrebări, iar termenul de răspuns a trecut — temei pentru solicitare de decalare (L98 art. 161 / L99 art. 173).
        </div>
      )}
      {incarcat && !eroare && !calc.intarziereAC && calc.ultimRaspuns && calc.repere.find(r => r.cheie === 'raspuns')?.stare === 'trecut' && (
        <div style={{ marginTop:10, fontSize:12, color:G.yellow }}>
          ℹ️ Ultimul document de tip răspuns publicat de AC: {fmtZi(calc.ultimRaspuns)}. Verifică în Clarificări că e răspunsul <b>consolidat</b> (toate întrebările), nu doar liste sau planșe noi.
        </div>
      )}

      <div style={{ marginTop:12, fontSize:12.5, fontWeight:700 }}>
        Contestație (L101 art. 8): {calc.prag.zile ? `${calc.prag.zile} zile de la fiecare act` : 'necunoscut'}
        <span style={{ fontWeight:400, color:G.dim }}> · valoare estimată {fmtLei(l.valoare_estimata)} {calc.prag.peste == null ? '— completează valoarea' : calc.prag.peste ? '≥' : '<'} prag lucrări {fmtLei(PRAG_LUCRARI_LEI)}</span>
      </div>
      {docs == null ? <div style={{ fontSize:12, color:G.dim }}>se încarcă actele…</div>
        : calc.contestatii.length === 0 ? <div style={{ fontSize:12, color:G.dim, marginTop:4 }}>{eroare ? 'Actele nu s-au putut încărca — nu știm dacă există.' : calc.prag.zile ? 'Niciun act publicat după anunț (răspunsuri, erate, documente noi).' : ''}</div>
        : calc.contestatii.slice(0, 8).map(c => (
          <div key={c.zi} style={{ display:'grid', gridTemplateColumns:'220px 110px 1fr', gap:10, alignItems:'center', padding:'5px 0', borderBottom:`1px solid ${G.border2}`, fontSize:12.5 }}>
            <span style={{ color:G.muted }} title={c.sursaZi === 'citire' ? 'data documentului, din citirea AI' : c.sursaZi === 'mixt' ? 'unele documente au data din citirea AI, altele ziua importului' : 'ziua în care a apărut în platformă (import) — data reală a publicării în SEAP poate fi anterioară'}>{TIP_ACT[c.tip]} din {fmtZi(c.zi)}{c.sursaZi !== 'citire' ? ' *' : ''}</span>
            <b style={{ color:CUL_STARE[c.stare] }}>{fmtZi(c.pana_la)}</b>
            <span style={{ color:G.dim, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={c.docs.map(d => d.nume).join('\n')}>
              {c.stare === 'trecut' ? 'expirat' : c.stare === 'azi' ? 'AZI' : `${c.zile} zile`} · {c.docs.length === 1 ? c.docs[0].nume : `${c.docs.length} documente: ${c.docs.slice(0, 2).map(d => d.nume).join(', ')}…`}
            </span>
          </div>
        ))}
      {calc.contestatii.length > 8 && <div style={{ fontSize:11.5, color:G.dim, marginTop:4 }}>+ încă {calc.contestatii.length - 8} acte mai vechi</div>}
      {trunchiat && <div style={{ fontSize:11.5, color:G.yellow, marginTop:4 }}>⚠️ Sunt cel puțin {LIMITA_ACTE} documente eligibile — lista e limitată la cele mai recente {LIMITA_ACTE}, deci poate fi incompletă; alerta „AC nu a răspuns” nu se afișează în acest caz.</div>}
      <div style={{ fontSize:11, color:G.dim, marginTop:8 }}>
        Zilele de întrebări/răspuns vin din textul fișei de date (nu din rezumatul AI). Termenul de contestație curge de la luarea la cunoștință a actului; ziua afișată e ultima zi. * = ziua apariției în platformă (cel puțin pentru o parte din documente), nu neapărat ziua publicării în SEAP. Pragul pentru lucrări e cel din 2026 — se revizuiește din doi în doi ani.
      </div>
    </div>
  )
}
