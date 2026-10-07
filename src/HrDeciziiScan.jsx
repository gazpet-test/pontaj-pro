// ════════════════════════════════════════════════════════════════
// Registrul deciziilor HR — „Încarcă scan semnat", funcțional pe telefon (spec §4.A.6, §3.9, §7; D5, VA5, VA13, VA27–VA36).
// Două moduri: cu document generat (origine platforma: decizia randată alături + bifa „cod") și fără (rezervare/import:
// fișa din registru). Două surse, neamestecate: poze (📷 / 🖼 → UN PDF A4 compus în browser) sau un PDF de la scanner.
// Pe telefon NU se randează PDF-uri (VA14): generatul e HTML scalat, scanul din poze se vede din paginile procesate.
// Lista de pagini e doar în memorie (VA36). La eroare de rețea fișierul compus, calea și hash-ul se păstrează (VA34).
// Același modal face și înlocuirea scanului (owner, cu motiv și baseline-ul vechi).
// ════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useRef, useState } from 'react'
import { pregatestePagina, paginiToPdf, normalizeazaPdf, renderDecizieHtml, sha256Hex } from './hrDeciziiDoc.js'
import { numeScan, PAGINA } from './hrDeciziiUtil.js'
import { paginiDinBytes } from './ctc/ctcUtil.js'
import { rpc, caleFisier, urcaPdf, inregistreazaPdfGenerat, uuid, numeAfis, mesajEroare } from './hrDeciziiFlux.js'

const G = { bg:'#0D1117', surface:'#161B22', card:'#161B22', text:'#E6EDF3', muted:'#8B949E', border:'#30363D', hr:'#EC6CB9',
  green:'#2EA043', yellow:'#D29922', red:'#F85149', blue:'#1F6FEB', redDim:'#3F1A1F', yellowDim:'#332100', greenDim:'#0F2A1E' }
const btn = { padding:'12px 14px', borderRadius:10, border:`1px solid ${G.border}`, background:G.surface, color:G.text, fontSize:15, cursor:'pointer', fontWeight:600 }
const btnMic = { minWidth:40, minHeight:40, borderRadius:8, border:`1px solid ${G.border}`, background:G.bg, color:G.text, fontSize:17, cursor:'pointer' }

const MAX_PAGINI = 10
const MAX_POZA = 25 * 1024 * 1024
const MAX_PDF = 20 * 1024 * 1024
const MSG_FORMAT = 'format neacceptat: fă poza din aplicație sau trimite JPG/PDF; pe Android, dezactivează HEIF în setările camerei sau folosește «Fă poză»'

/** Bifele cerute de server (_hr_verificari_ok), în ordinea afișării. */
function bifeCerute(d) {
  if (d.tip_cod === 'ALTA_DECIZIE') return [['nr', 'Numărul și data de pe hârtie sunt cele din registru'], ['semnatura', 'Documentul e semnat']]
  const baza = [['nr', 'Numărul și data sunt corecte'], ['persoana', 'Persoana numită e cea corectă']]
  if (d.origine === 'platforma') return [...baza, ['semnatura', 'Semnătura există'], ['stampila', 'Ștampila există'], ['cod', `Codul de pe hârtie e ${d.cod_verificare || '—'}`]]
  return [...baza, ['semnatar', 'Semnatarul de pe hârtie e cel înregistrat'], ['semnatura', 'Semnătura există'], ['stampila', 'Ștampila există']]
}

export default function HrDeciziiScan({ decizie: d, inlocuire = false, onClose, onDone, showToast }) {
  const [pagini, setPagini] = useState([])          // [{id, file, rot, prep:{dataUrl,w,h}}]
  const [pdf, setPdf] = useState(null)              // {file, pagini|null}
  const [paginiManual, setPaginiManual] = useState('')
  const [bife, setBife] = useState({})
  const [observatie, setObservatie] = useState('')
  const [motiv, setMotiv] = useState('')
  const [lucru, setLucru] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState(null)
  const [vedeGenerat, setVedeGenerat] = useState(false)
  const pending = useRef(null)                      // {file, path, sha, verificari} — retry fără recompunere (VA34)
  const pdfGen = useRef({})
  const cerereId = useRef(uuid())
  const inCam = useRef(null), inGal = useRef(null), inPdf = useRef(null)
  const cuGenerat = d.origine === 'platforma' && !!d.continut
  const bifeLista = useMemo(() => bifeCerute(d), [d])
  const din = pagini.length ? 'foto' : pdf ? 'pdf' : null
  const ingust = typeof window !== 'undefined' && window.innerWidth < 700

  const htmlGenerat = useMemo(() => cuGenerat ? renderDecizieHtml(d.continut, d.snapshot, { cod_verificare: d.cod_verificare }) : '', [cuGenerat, d])

  const blocheaza = () => { if (lucru) return true; if (pending.current) { setErr('Fișierul compus așteaptă salvarea — apasă din nou „Salvează scanul” sau închide.'); return true } return false }

  async function adaugaPoze(e) {
    const files = Array.from(e.target.files || []); e.target.value = ''
    if (!files.length || blocheaza()) return
    setErr('')
    if (pdf) { setErr('Ai ales deja un PDF. Scoate-l ca să folosești poze (sursele nu se amestecă).'); return }
    if (pagini.length + files.length > MAX_PAGINI) { setErr(`Maximum ${MAX_PAGINI} pagini.`); return }
    setLucru(true)
    try {
      const noi = []
      for (const f of files) {
        if (f.type && !f.type.startsWith('image/')) throw new Error(`„${f.name}”: ${MSG_FORMAT}`)
        if (f.size > MAX_POZA) throw new Error(`„${f.name}” are peste 25 MB`)
        let prep
        try { prep = await pregatestePagina(f, 0) } catch { throw new Error(`„${f.name}”: ${MSG_FORMAT}`) }
        noi.push({ id: uuid(), file: f, rot: 0, prep })
      }
      setPagini(p => [...p, ...noi])
    } catch (x) { setErr(mesajEroare(x)) } finally { setLucru(false) }
  }

  async function alegePdf(e) {
    const f = e.target.files?.[0]; e.target.value = ''
    if (!f || blocheaza()) return
    setErr('')
    if (pagini.length) { setErr('Ai deja poze în listă. Scoate-le ca să folosești un PDF (sursele nu se amestecă).'); return }
    if (f.size > MAX_PDF) { setErr('PDF-ul are peste 20 MB.'); return }
    setLucru(true)
    try {
      const norm = await normalizeazaPdf(f)
      const n = paginiDinBytes(new Uint8Array(await norm.arrayBuffer()))
      if (n != null && n > MAX_PAGINI) throw new Error(`PDF-ul are ${n} pagini (maximum ${MAX_PAGINI}).`)
      setPdf({ file: norm, pagini: n })
      setPaginiManual('')
    } catch (x) { setErr(mesajEroare(x)) } finally { setLucru(false) }
  }

  const muta = (i, dir) => { if (blocheaza()) return; setPagini(p => { const a = [...p]; const j = i + dir; if (j < 0 || j >= a.length) return p; [a[i], a[j]] = [a[j], a[i]]; return a }) }
  const scoate = i => { if (blocheaza()) return; setPagini(p => p.filter((_, k) => k !== i)) }
  async function roteste(i) {
    if (blocheaza()) return
    const pg = pagini[i]; const rot = (pg.rot + 90) % 360
    setLucru(true)
    try {
      const prep = await pregatestePagina(pg.file, rot)          // din File-ul original, nu din pagina comprimată
      setPagini(p => p.map((x, k) => k === i ? { ...x, rot, prep } : x))
    } catch (x) { setErr(mesajEroare(x)) } finally { setLucru(false) }
  }

  const nrPagini = din === 'foto' ? pagini.length : din === 'pdf' ? (pdf.pagini ?? (parseInt(paginiManual, 10) || null)) : null
  const toateBifele = bifeLista.every(([k]) => bife[k] || (k === 'stampila' && d.origine === 'import' && observatie.trim())) && bife.lizibil
  const inghetat = !!pending.current      // după o încercare eșuată, payload-ul rămâne exact cel trimis (J10-4)
  const poateSalva = !lucru && din && (inghetat || (nrPagini >= 1 && nrPagini <= MAX_PAGINI && toateBifele && (!inlocuire || motiv.trim())))

  async function salveaza() {
    if (!poateSalva) return
    setErr(''); setLucru(true)
    try {
      if (!pending.current) {
        let file
        if (din === 'foto') file = paginiToPdf(pagini.map(p => p.prep))
        else file = new File([pdf.file], numeScan(), { type: 'application/pdf' })
        if (file.size > MAX_PDF) throw new Error(`PDF-ul compus are ${(file.size / 1048576).toFixed(1)} MB (maximum 20 MB). Scoate o pagină sau refă pozele.`)
        const verificari = { ...Object.fromEntries(bifeLista.map(([k]) => [k, !!bife[k]])), lizibil: true, sursa: din,
          pagini: nrPagini, pagini_sursa: din === 'foto' || pdf.pagini != null ? 'detectat' : 'manual', generat: cuGenerat }
        if (d.origine === 'import' && !bife.stampila && observatie.trim()) verificari.observatie = observatie.trim()
        pending.current = { file, path: caleFisier(d, file.name), sha: await sha256Hex(file), verificari, motiv: motiv.trim() }
      }
      const p = pending.current
      if (!inlocuire && d.origine === 'platforma' && !d.pdf_path) await inregistreazaPdfGenerat(d, pdfGen.current)   // J4-3: PDF-ul întâi
      await urcaPdf(p.path, p.file)
      const rez = inlocuire
        ? await rpc('fn_hr_decizie_inlocuieste_scan', { p_id: d.id, p_cerere_id: cerereId.current, p_scan_vechi_path: d.scan_path,
            p_scan_vechi_sha256: d.scan_sha256, p_path: p.path, p_sha256: p.sha, p_motiv: p.motiv, p_verificari: p.verificari })
        : await rpc('fn_hr_decizie_ataseaza_scan', { p_id: d.id, p_path: p.path, p_sha256: p.sha, p_verificari: p.verificari })
      pending.current = null
      setOk({ rez, galerie: din === 'foto' })
      showToast?.(inlocuire ? 'Scanul a fost înlocuit' : 'Scan salvat — decizia e semnată')
      onDone?.(rez)
    } catch (x) {
      setErr(mesajEroare(x) + (pending.current ? ' — fișierul compus e păstrat; apasă din nou „Salvează scanul”.' : ''))
    } finally { setLucru(false) }
  }

  const titlu = `${inlocuire ? 'Înlocuiește scanul' : 'Încarcă scan semnat'} — Decizia nr ${d.nr_afisat || (d.numar + '/' + d.an)}`

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.75)', zIndex:1000, display:'flex', justifyContent:'center', alignItems: ingust ? 'stretch' : 'flex-start', overflowY:'auto' }}>
      <div style={{ background:G.card, color:G.text, width:'100%', maxWidth: cuGenerat && !ingust ? 1100 : 640, minHeight: ingust ? '100%' : undefined,
        margin: ingust ? 0 : '24px 12px', borderRadius: ingust ? 0 : 14, border:`1px solid ${G.border}`, padding: ingust ? 12 : 20, boxSizing:'border-box' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8, marginBottom:12 }}>
          <div style={{ fontWeight:700, fontSize:16 }}>{titlu}</div>
          <button onClick={onClose} disabled={lucru} style={{ ...btnMic, flexShrink:0 }} aria-label="Închide">✕</button>
        </div>

        {ok ? (
          <div style={{ padding:16, background:G.greenDim, borderRadius:10 }}>
            <div style={{ fontWeight:700, fontSize:16, marginBottom:6 }}>✅ {inlocuire ? 'Scan înlocuit' : 'Decizia e semnată'}</div>
            {ok.rez?.propunere_id && <div style={{ fontSize:14 }}>S-a propus schimbarea echipei proiectului (Execuție → Completări propuse){ok.rez.concurente ? ` · ${ok.rez.concurente} propuneri concurente` : ''}.</div>}
            {ok.galerie && <div style={{ fontSize:14, marginTop:8, color:G.yellow }}>Dacă ai folosit poze din galerie: șterge-le din galerie (și din „Șterse recent”).</div>}
            <button onClick={onClose} style={{ ...btn, marginTop:14, width:'100%' }}>Închide</button>
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection: cuGenerat && !ingust ? 'row' : 'column', gap:16 }}>
            {/* Stânga: documentul de comparat */}
            <div style={{ flex:1, minWidth:0 }}>
              {cuGenerat ? (
                <>
                  <div style={{ fontSize:13, color:G.muted, marginBottom:6 }}>Documentul generat (caută pe hârtie codul):</div>
                  <div style={{ fontFamily:'monospace', fontSize:22, fontWeight:700, color:G.hr, marginBottom:8, letterSpacing:1 }}>{d.cod_verificare}</div>
                  <GeneratScalat html={htmlGenerat} onClick={() => setVedeGenerat(true)} />
                  <div style={{ fontSize:12, color:G.muted, marginTop:4 }}>Atinge pagina pentru ecran întreg.</div>
                </>
              ) : (
                <FisaRegistru d={d} />
              )}
            </div>

            {/* Dreapta: scanul */}
            <div style={{ flex:1, minWidth:0 }}>
              {inlocuire && (
                <label style={{ display:'block', marginBottom:12, fontSize:14 }}>Motivul înlocuirii (obligatoriu)
                  <textarea value={motiv} disabled={lucru || inghetat} onChange={e => setMotiv(e.target.value)} rows={2} style={{ width:'100%', boxSizing:'border-box', marginTop:4, background:G.bg, color:G.text, border:`1px solid ${G.border}`, borderRadius:8, padding:10, fontSize:15 }} />
                </label>
              )}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                <button style={{ ...btn, gridColumn:'1 / -1', background:G.hr, border:'none', color:'#fff', fontSize:17, padding:'16px 14px' }} disabled={lucru || !!pdf} onClick={() => inCam.current?.click()}>📷 Fă poză</button>
                <button style={btn} disabled={lucru || !!pdf} onClick={() => inGal.current?.click()}>🖼 Din galerie</button>
                <button style={btn} disabled={lucru || pagini.length > 0} onClick={() => inPdf.current?.click()}>📄 PDF</button>
              </div>
              <input ref={inCam} type="file" accept="image/*" capture="environment" multiple hidden onChange={adaugaPoze} />
              <input ref={inGal} type="file" accept="image/*" multiple hidden onChange={adaugaPoze} />
              <input ref={inPdf} type="file" accept="application/pdf,.pdf" hidden onChange={alegePdf} />

              {!din && (
                <div style={{ fontSize:13, color:G.muted, marginTop:10, lineHeight:1.45 }}>
                  Sfaturi: toată foaia în cadru, pe o suprafață închisă la culoare, lumină uniformă, fără bliț și fără umbra telefonului.
                  Pe iPhone poți folosi și Fișiere/Notițe → Scanează documente; pe Android, Google Drive → Scanează (apoi „📄 PDF”).<br />
                  Dacă pozele au dispărut când s-a deschis camera, fă-le cu aplicația Cameră și alege-le din „Din galerie”.
                </div>
              )}

              {pagini.length > 0 && (
                <div style={{ marginTop:12 }}>
                  <div style={{ fontSize:13, color:G.muted, marginBottom:6 }}>{pagini.length} pagin{pagini.length === 1 ? 'ă' : 'i'} — ordinea din listă e ordinea din PDF</div>
                  {pagini.map((p, i) => (
                    <div key={p.id} style={{ display:'flex', gap:8, alignItems:'center', padding:6, border:`1px solid ${G.border}`, borderRadius:10, marginBottom:6, background:G.bg }}>
                      <div style={{ fontWeight:700, width:22, textAlign:'center' }}>{i + 1}</div>
                      <img src={p.prep.dataUrl} alt={`pagina ${i + 1}`} style={{ width:64, height:84, objectFit:'contain', background:'#fff', borderRadius:4, flexShrink:0 }} />
                      <div style={{ flex:1 }} />
                      <button style={btnMic} disabled={lucru || i === 0} onClick={() => muta(i, -1)} aria-label="Sus">↑</button>
                      <button style={btnMic} disabled={lucru || i === pagini.length - 1} onClick={() => muta(i, 1)} aria-label="Jos">↓</button>
                      <button style={btnMic} disabled={lucru} onClick={() => roteste(i)} aria-label="Rotește">⟳</button>
                      <button style={{ ...btnMic, color:G.red }} disabled={lucru} onClick={() => scoate(i)} aria-label="Scoate">✕</button>
                    </div>
                  ))}
                </div>
              )}

              {pdf && (
                <div style={{ marginTop:12, padding:10, border:`1px solid ${G.border}`, borderRadius:10, background:G.bg }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <div style={{ flex:1, fontSize:14 }}>📄 PDF · {pdf.pagini != null ? `${pdf.pagini} pagin${pdf.pagini === 1 ? 'ă' : 'i'}` : 'pagini nedetectate'} · {(pdf.file.size / 1048576).toFixed(1)} MB</div>
                    <button style={btnMic} onClick={() => { const u = URL.createObjectURL(pdf.file); window.open(u, '_blank'); setTimeout(() => URL.revokeObjectURL(u), 60000) }} aria-label="Deschide">↗</button>
                    <button style={{ ...btnMic, color:G.red }} disabled={lucru} onClick={() => { if (!blocheaza()) setPdf(null) }} aria-label="Scoate">✕</button>
                  </div>
                  {pdf.pagini == null && (
                    <label style={{ display:'block', marginTop:8, fontSize:14 }}>Câte pagini are scanul? (obligatoriu)
                      <input type="number" min={1} max={MAX_PAGINI} value={paginiManual} disabled={lucru || inghetat} onChange={e => setPaginiManual(e.target.value)} style={{ width:90, marginLeft:8, background:G.card, color:G.text, border:`1px solid ${G.border}`, borderRadius:6, padding:6, fontSize:15 }} />
                    </label>
                  )}
                </div>
              )}

              {cuGenerat && nrPagini > 1 && <div style={{ marginTop:8, fontSize:13, color:G.yellow }}>Notă: scanul are {nrPagini} pagini, documentul generat are una (ex. luare la cunoștință pe verso). Nu blochează.</div>}

              {din && (
                <div style={{ marginTop:14 }}>
                  <div style={{ fontSize:13, color:G.muted, marginBottom:6 }}>Verificare (compară cu {cuGenerat ? 'documentul generat' : 'fișa din registru'}):</div>
                  {[...bifeLista, ['lizibil', 'Toate paginile sunt complete și lizibile']].map(([k, t]) => (
                    <label key={k} style={{ display:'flex', gap:10, alignItems:'center', padding:'10px 4px', fontSize:15, borderBottom:`1px solid ${G.border}`, cursor:'pointer' }}>
                      <input type="checkbox" checked={!!bife[k]} disabled={lucru || inghetat} onChange={e => setBife(b => ({ ...b, [k]: e.target.checked }))} style={{ width:22, height:22, flexShrink:0 }} />
                      <span>{t}</span>
                    </label>
                  ))}
                  {d.origine === 'import' && !bife.stampila && (
                    <label style={{ display:'block', marginTop:8, fontSize:14 }}>Fără ștampilă? Notează de ce (ex. „originalul nu are ștampilă”):
                      <input value={observatie} disabled={lucru || inghetat} onChange={e => setObservatie(e.target.value)} style={{ width:'100%', boxSizing:'border-box', marginTop:4, background:G.bg, color:G.text, border:`1px solid ${G.border}`, borderRadius:8, padding:10, fontSize:15 }} />
                    </label>
                  )}
                </div>
              )}

              {err && <div style={{ marginTop:12, padding:10, background:G.redDim, color:'#ffb3ad', borderRadius:8, fontSize:14 }}>{err}</div>}

              <button onClick={salveaza} disabled={!poateSalva} style={{ ...btn, width:'100%', marginTop:14, padding:'16px 14px', fontSize:17,
                background: poateSalva ? G.green : G.surface, color: poateSalva ? '#fff' : G.muted, border:'none' }}>
                {lucru ? 'Se lucrează…' : '💾 Salvează scanul'}
              </button>
            </div>
          </div>
        )}
      </div>

      {vedeGenerat && (
        <div onClick={() => setVedeGenerat(false)} style={{ position:'fixed', inset:0, zIndex:1001, background:'rgba(0,0,0,.92)', overflow:'auto', padding:8 }}>
          <GeneratScalat html={htmlGenerat} plin />
        </div>
      )}
    </div>
  )
}

/** Pagina A4 (794×1123) scalată la lățimea containerului — HTML, nu PDF (merge și pe telefon). */
export function GeneratScalat({ html, onClick, plin = false }) {
  const ref = useRef(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current; if (!el) return
    const upd = () => setW(el.clientWidth)
    upd()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(upd) : null
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [])
  const s = w ? Math.min(plin ? 2 : 1, w / PAGINA.w) : 0
  return (
    <div ref={ref} onClick={onClick} style={{ width:'100%', height: s ? PAGINA.h * s : 200, overflow:'hidden', cursor: onClick ? 'zoom-in' : 'default', background:'#fff', borderRadius:6 }}>
      {s > 0 && <div style={{ width:PAGINA.w, transform:`scale(${s})`, transformOrigin:'top left' }} dangerouslySetInnerHTML={{ __html: html }} />}
    </div>
  )
}

/** Fișa din registru pentru deciziile fără document generat (rezervare, import) (VA5). */
function FisaRegistru({ d }) {
  const r = (k, v) => v ? <div style={{ display:'flex', gap:8, padding:'6px 0', borderBottom:`1px solid ${G.border}`, fontSize:14 }}><span style={{ color:G.muted, minWidth:96 }}>{k}</span><span>{v}</span></div> : null
  const pers = d.snapshot?.persoana?.nume || d.persoana_nume || (d.employee_nume && numeAfis(d.employee_nume))
  return (
    <div>
      <div style={{ fontSize:13, color:G.muted, marginBottom:6 }}>Fișa din registru (compară cu hârtia):</div>
      <div style={{ background:G.bg, borderRadius:10, padding:'4px 12px', border:`1px solid ${G.border}` }}>
        {r('Nr. / data', d.nr_afisat || String(d.numar))}
        {r('Tip', d.eticheta_functie || d.tip_cod)}
        {r('Persoană', pers ? `${d.titlu ? d.titlu + ' ' : ''}${pers}` : null)}
        {r('Proiect', d.nivel === 'proiect' ? (d.proiect_denumire || `#${d.proiect_id}`) : 'firmă')}
        {r('Semnatar', d.snapshot?.semnatar?.nume)}
        {r('Descriere', d.descriere)}
      </div>
    </div>
  )
}
