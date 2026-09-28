// ===========================================================================
// MODUL HR — „Diplome & calificări din dosare" (TKT-2026-0196, 28.09.2026)
// Silviu: „un tabel cu toți angajații care au diplomă de lăcătuș — nume, prenume, calificarea,
// seria și numărul diplomei". Diplomele NU stau ca autorizații (tipul „Lăcătuș mecanic" are 0
// înregistrări), ci în dosarele personale: `hr_documente_personale` cu tip din categoria „studii"
// (diplomă școală profesională, certificat de calificare, supliment). De acolo citim — același loc
// din care citește și inventarul pentru organigramă. Ecranul NU scrie nimic.
//
// Calificarea nu e un câmp în BD: o deducem din numele fișierului + observații (ex. „CALIFICARE
// LACATUS - VERGA IULIAN.pdf"). E o potrivire pe text, deci se vede mereu documentul sursă, ca
// omul să judece (ex. „ENE MARIAN - LACATUS MECANIC - DIPLOMA ELECTROMECANIC" e prins la lăcătuș
// fiindcă funcția lui e în numele fișierului).
// Acces: RLS pe hr_documente_personale = owner sau can_access_personal_data — restul văd gol.
// ===========================================================================
import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx-js-style'
import { supabase } from './lib/supabase.js'

const G = {
  bg:'#0D1117', surface:'#161B22', card:'#161B22', text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  border:'#30363D', border2:'#21262D',
  blue:'#1F6FEB', green:'#2EA043', yellow:'#D29922', orange:'#F0883E', red:'#F85149', purple:'#A371F7',
  hr:'#EC6CB9',
}
const S = {
  card: { background:G.card, borderRadius:12, border:`1px solid ${G.border}` },
  input: { width:'100%', background:G.bg, border:`1px solid ${G.border}`, borderRadius:8, padding:'8px 10px', color:G.text, fontSize:13, outline:'none' },
  btnS: { padding:'7px 12px', background:G.surface, color:G.text, border:`1px solid ${G.border}`, borderRadius:8, cursor:'pointer', fontSize:13 },
}
const th = { padding:'9px 10px', textAlign:'left', fontSize:11, fontWeight:700, color:G.muted, textTransform:'uppercase', letterSpacing:.5, whiteSpace:'nowrap' }
const td = { padding:'8px 10px', verticalAlign:'top', fontSize:12.5 }
const BUCKET = 'documente-personal'

// Calificările căutate des. Cheile sunt fără diacritice (textul se normalizează la fel).
export const CALIFICARI_RAPIDE = [
  { label:'Lăcătuș',     chei:['lacatus'] },
  { label:'Sudor',       chei:['sudor', 'sudura'] },
  { label:'Instalator',  chei:['instalator'] },
  { label:'Electrician', chei:['electrician', 'electromecanic'] },
  { label:'Macaragiu',   chei:['macaragiu'] },
  { label:'Mecanic',     chei:['mecanic'] },
  { label:'Mașinist / operator utilaje', chei:['masinist', 'operator utilaj', 'excavator'] },
  { label:'Topograf',    chei:['topograf', 'cadastru'] },
]

export const normTxt = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
// Observațiile importului din Drive conțin numele DOSARULUI („dosarul „JIPA PETRU - LACATUS""),
// care ar lipi calificarea pe orice act din dosar (CI, cazier…). Îl scoatem înainte de potrivire.
export const textPotrivire = (d) => normTxt(`${d.fisier_nume || ''} ${String(d.observatii || '').replace(/dosarul\s+„[^"”]*["”]/gi, '')}`)
export const calificariDetectate = (d) => CALIFICARI_RAPIDE.filter(c => c.chei.some(k => textPotrivire(d).includes(k))).map(c => c.label)
// employees.name = „NUME_FAMILIE PRENUME" — primul cuvânt e numele de familie
export const imparteNume = (full) => {
  const p = String(full || '').trim().split(/\s+/)
  return { nume: p[0] || '', prenume: p.slice(1).join(' ') }
}
const fmtData = (d) => d ? new Date(d).toLocaleDateString('ro-RO') : ''

export default function HrDiplomeCalificari({ showToast, onClose }) {
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [calif, setCalif] = useState('Lăcătuș')     // cererea din tichet; se poate schimba
  const [cauta, setCauta] = useState('')
  const [doarActivi, setDoarActivi] = useState(true)

  useEffect(() => {
    let anulat = false
    ;(async () => {
      setLoading(true)
      const { data, error } = await supabase.from('hr_documente_personale')
        .select('id, employee_id, numar_document, emitent, data_emitere, observatii, fisier_path, fisier_nume, tip:hr_documente_personale_tipuri!inner(cod, denumire, categorie), angajat:employees!inner(id, name, active, functie, position)')
        .eq('tip.categorie', 'studii').eq('activ', true).is('deleted_at', null).limit(5000)
      if (anulat) return
      if (error) { showToast?.('Eroare la citirea dosarelor: ' + error.message, 'error'); setDocs([]) }
      else {
        // Dosarele au dubluri din importuri (același fișier de 2 ori) — un rând per (om, fișier, număr)
        const vazute = new Set(), unice = []
        for (const d of data || []) {
          const k = `${d.employee_id}|${normTxt(d.fisier_nume)}|${normTxt(d.numar_document)}`
          if (vazute.has(k)) continue
          vazute.add(k); unice.push(d)
        }
        setDocs(unice)
      }
      setLoading(false)
    })()
    return () => { anulat = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- fără showToast în deps (anti-bug: refetch la fiecare randare)

  const randuri = useMemo(() => {
    const def = CALIFICARI_RAPIDE.find(c => c.label === calif)
    const s = normTxt(cauta.trim())
    return docs
      .filter(d => !doarActivi || d.angajat?.active !== false)
      .filter(d => !def || def.chei.some(k => textPotrivire(d).includes(k)))
      .filter(d => !s || normTxt(`${d.angajat?.name} ${d.fisier_nume} ${d.numar_document} ${d.emitent} ${d.tip?.denumire}`).includes(s))
      .map(d => ({ ...d, ...imparteNume(d.angajat?.name), calificari: calificariDetectate(d) }))
      .sort((a, b) => a.nume.localeCompare(b.nume, 'ro') || a.prenume.localeCompare(b.prenume, 'ro'))
  }, [docs, calif, cauta, doarActivi])

  const oameni = useMemo(() => new Set(randuri.map(r => r.employee_id)).size, [randuri])
  const faraNumar = useMemo(() => randuri.filter(r => !r.numar_document).length, [randuri])

  const deschide = async (d) => {
    if (!d.fisier_path) { showToast?.('Documentul nu are fișier atașat', 'warning'); return }
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(d.fisier_path, 120)
    if (error) { showToast?.('Eroare deschidere: ' + error.message, 'error'); return }
    window.open(data.signedUrl, '_blank')
  }

  const exportXlsx = () => {
    if (!randuri.length) { showToast?.('Nimic de exportat — tabelul e gol', 'warning'); return }
    const rows = randuri.map(r => ({
      'Nume': r.nume, 'Prenume': r.prenume,
      'Funcție': r.angajat?.functie || r.angajat?.position || '',
      'Calificare': calif || r.calificari.join(', '),
      'Document': r.tip?.denumire || '',
      'Seria și nr. diplomei': r.numar_document || '',
      'Emitent': r.emitent || '',
      'Data emiterii': fmtData(r.data_emitere),
      'Fișier sursă': r.fisier_nume || '',
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = [{wch:18},{wch:22},{wch:20},{wch:16},{wch:30},{wch:22},{wch:40},{wch:12},{wch:50}]
    Object.keys(rows[0]).forEach((_, i) => {
      const cell = ws[XLSX.utils.encode_cell({ r: 0, c: i })]
      if (cell) cell.s = { font: { bold: true }, fill: { fgColor: { rgb: 'E8EEF7' } } }
    })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Diplome')
    const eticheta = normTxt(calif || 'toate').replace(/[^a-z0-9]+/g, '_')
    XLSX.writeFile(wb, `diplome_${eticheta}_${new Date().toISOString().slice(0, 10)}.xlsx`)
    showToast?.(`${rows.length} diplome (${oameni} oameni) exportate`, 'success')
  }

  return (
    <div style={{ ...S.card, padding:14, marginBottom:14, borderColor:G.hr + '55' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, marginBottom:10, flexWrap:'wrap' }}>
        <div>
          <div style={{ fontSize:14, fontWeight:800, color:G.hr }}>🎓 Diplome & calificări din dosarele personale</div>
          <div style={{ fontSize:11, color:G.muted, marginTop:2 }}>
            Diplome de școală profesională, certificate de calificare și suplimente. Calificarea se deduce din numele fișierului — verifică documentul sursă.
          </div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={exportXlsx} disabled={!randuri.length}
            style={{ padding:'7px 13px', background:G.green, color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontSize:12, fontWeight:700, opacity: randuri.length ? 1 : .5 }}>
            ⬇ Export Excel ({randuri.length})
          </button>
          {onClose && <button onClick={onClose} style={{ ...S.btnS, fontSize:12 }}>✕ Închide</button>}
        </div>
      </div>

      <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:10 }}>
        {[{ label:'' }, ...CALIFICARI_RAPIDE].map(c => {
          const sel = calif === c.label
          return (
            <button key={c.label || 'toate'} onClick={() => setCalif(c.label)} style={{
              padding:'5px 12px', borderRadius:16, fontSize:12, cursor:'pointer', fontWeight: sel ? 700 : 500,
              border:`1px solid ${sel ? G.hr : G.border}`, background: sel ? G.hr + '22' : 'transparent', color: sel ? G.hr : G.text,
            }}>{c.label || 'Toate diplomele'}</button>
          )
        })}
      </div>
      <div style={{ display:'flex', gap:10, alignItems:'center', marginBottom:10, flexWrap:'wrap' }}>
        <input value={cauta} onChange={e => setCauta(e.target.value)} placeholder="🔍 Caută nume, număr, emitent, fișier…" style={{ ...S.input, flex:1, minWidth:240 }} />
        <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, color:G.muted, cursor:'pointer', userSelect:'none' }}>
          <input type="checkbox" checked={doarActivi} onChange={e => setDoarActivi(e.target.checked)} /> doar angajați activi
        </label>
      </div>

      {loading ? (
        <div style={{ padding:24, textAlign:'center', color:G.muted }}>⏳ Se citesc dosarele…</div>
      ) : (
        <>
          <div style={{ fontSize:12, color:G.muted, marginBottom:8 }}>
            <strong style={{ color:G.text }}>{oameni}</strong> {oameni === 1 ? 'om' : 'oameni'} · {randuri.length} documente
            {faraNumar > 0 && <span style={{ color:G.yellow }}> · ⚠ {faraNumar} fără serie/număr completat în dosar</span>}
          </div>
          <div style={{ overflowX:'auto', border:`1px solid ${G.border}`, borderRadius:8 }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead style={{ background:G.bg }}>
                <tr>
                  <th style={th}>Nume</th><th style={th}>Prenume</th><th style={th}>Calificare</th>
                  <th style={th}>Seria și nr.</th><th style={th}>Document</th><th style={th}>Emitent / data</th><th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {randuri.map(r => (
                  <tr key={r.id} style={{ borderTop:`1px solid ${G.border}`, opacity: r.angajat?.active === false ? .6 : 1 }}>
                    <td style={{ ...td, fontWeight:700 }}>{r.nume}</td>
                    <td style={td}>
                      {r.prenume}
                      {(r.angajat?.functie || r.angajat?.position) && <div style={{ fontSize:10, color:G.muted }}>{r.angajat.functie || r.angajat.position}</div>}
                      {r.angajat?.active === false && <div style={{ fontSize:10, color:G.dim }}>inactiv</div>}
                    </td>
                    <td style={td}>{r.calificari.length ? r.calificari.join(', ') : <span style={{ color:G.dim }}>—</span>}</td>
                    <td style={{ ...td, fontFamily:'monospace', fontSize:12 }}>{r.numar_document || <span style={{ color:G.yellow, fontFamily:'inherit' }}>necompletat</span>}</td>
                    <td style={td}>
                      <div>{r.tip?.denumire}</div>
                      <div style={{ fontSize:10, color:G.muted, wordBreak:'break-word' }}>{r.fisier_nume}</div>
                    </td>
                    <td style={{ ...td, fontSize:11.5 }}>{r.emitent || <span style={{ color:G.dim }}>—</span>}{r.data_emitere && <div style={{ color:G.muted }}>{fmtData(r.data_emitere)}</div>}</td>
                    <td style={{ ...td, textAlign:'right' }}>
                      {r.fisier_path && <button onClick={() => deschide(r)} title="Deschide documentul din dosar"
                        style={{ padding:'4px 8px', background:G.green + '22', color:G.green, border:`1px solid ${G.green}55`, borderRadius:4, fontSize:11, cursor:'pointer' }}>📄</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {randuri.length === 0 && (
              <div style={{ padding:28, textAlign:'center', color:G.muted, fontSize:13 }}>
                {docs.length === 0 ? 'Nu văd niciun document de studii — ai nevoie de acces la datele personale.' : 'Niciun document pentru filtrul ales.'}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
