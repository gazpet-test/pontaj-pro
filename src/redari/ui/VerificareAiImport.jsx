// Import TGZ — panoul „Verificare AI (a doua opinie)” din previzualizare (pasul 2, deciziile lui Răzvan 19.11.2026).
// Butonul apare DOAR cu dreptul (fn_red_import_ai_poate: owner sau dreptul import_verificare_ai pe proiect); funcția edge verifică ea însăși dreptul.
// Înainte de pornire: ce pleacă (doar poz. HG / nr. cadastral / tarla, valorile unice) și costul MAXIM estimat; pornirea cere confirmare.
// Rezultatul intră în „De verificat” cu eticheta AI (prin onSemnale → adaugaSemnaleAi), deci e mascat și bifat ca semnalele fixe; aici se arată
// doar rândul, UAT, Nr.Crt., câmpul, categoria și o explicație FIXĂ după categorie (r2: niciun text scris de model) — niciodată valoarea.
// L24: generația + proiectul + previzualizarea curente, verificate înaintea fiecărui apel (bucla plătită se oprește la unmount / schimbare).
// L05: un rezultat necunoscut oprește bucla, fără reluare. r2 (L12): la o rulare incompletă se înlocuiesc semnalele AI DOAR pe rândurile bucăților
// verificate cu succes acum (randuriAcoperite); cele ale bucăților eșuate / neîncercate rămân (mascate, cu bifa obligatorie).
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { sha256Hex } from '../../../supabase/functions/_shared/redariImportAi.mjs'
import { pregatesteVerificareAi, semnaleAiInDeVerificat, randuriAcoperite, FUNCTIA_EDGE_AI, ETICHETA_CATEGORIE_AI, EXPLICATIE_CATEGORIE_AI, mesajCodAi } from '../importVerificareAi.js'
import { ETICHETA_CAMP_VERIFICAT } from '../importVerificareFixa.js'
import { G, S, fmtNum } from './comune.jsx'

// funcția RPC lipsă (migrarea neaplicată) = panoul nu apare; orice altă eroare = afișată (L18: eroare ≠ „nu ai drept”)
const RPC_LIPSA = e => e && (e.code === 'PGRST202' || e.code === '42883')
const usd = v => (Number.isFinite(v) ? `${v.toFixed(v < 0.1 ? 4 : 2)} USD` : '—')

export default function VerificareAiImport({ proiect, preview, fisier, fisierNume = null, show, onSemnale }) {
  const [drept, setDrept] = useState(null)            // null = se citește | true | false | 'lipsa' | { eroare }
  const [stare, setStare] = useState({ lucru: false, facut: 0, total: 0, mesaj: '', eroare: '' })
  const [explicatii, setExplicatii] = useState(null)  // [{ rand, uat, nr_crt, camp, categorie }] — ultima rulare (fără valori, fără text AI)
  const gen = useRef(0)          // generația rulării AI (bucla plătită)
  const genDrept = useRef(0)     // generația citirii dreptului
  const montat = useRef(true)
  const proiectRef = useRef(proiect?.id); proiectRef.current = proiect?.id
  const previewRef = useRef(preview); previewRef.current = preview
  useEffect(() => { montat.current = true; return () => { montat.current = false; gen.current++; genDrept.current++ } }, [])
  useEffect(() => {
    const g = ++genDrept.current; gen.current++; const id = proiect?.id
    setDrept(null); setExplicatii(null); setStare({ lucru: false, facut: 0, total: 0, mesaj: '', eroare: '' })
    if (!id) { setDrept(false); return undefined }
    ;(async () => {
      let r
      try { r = await supabase.rpc('fn_red_import_ai_poate', { p_proiect: id }) } catch (e) { r = { error: e } }
      if (!montat.current || g !== genDrept.current || proiectRef.current !== id) return
      if (r?.error) setDrept(RPC_LIPSA(r.error) ? 'lipsa' : { eroare: true })
      else setDrept(r?.data === true)
    })()
    return undefined
  }, [proiect?.id])
  // o previzualizare NOUĂ din parser (fără verificare_ai): rularea în zbor se oprește, explicațiile vechi dispar; previzualizarea întoarsă de
  // propria rulare (cu verificare_ai) le păstrează
  useEffect(() => {
    if (!preview?.verificare_ai) { gen.current++; setExplicatii(null); setStare({ lucru: false, facut: 0, total: 0, mesaj: '', eroare: '' }) }
  }, [preview])
  const plan = useMemo(() => pregatesteVerificareAi(preview), [preview])

  if (drept !== true) {
    if (drept && typeof drept === 'object') return <div style={{ fontSize:12, color:G.yellow, marginTop:8 }}>⚠ Verificarea AI: nu am putut citi dreptul pe proiect (reîncarcă pagina).</div>
    return null
  }
  if (!plan.unice) return null

  const porneste = async () => {
    if (stare.lucru) return
    const pvStart = preview; const proiectStart = proiect?.id
    if (!window.confirm(`Verificare AI (a doua opinie) pe ${proiect?.cod || 'proiect'}: se trimit la Anthropic (Claude) DOAR poziția HG, nr. cadastral și tarla — ${fmtNum(plan.unice)} valori unice din ${fmtNum(plan.randuri)} rânduri, în ${plan.bucati.length} apeluri. Nu pleacă nume, adrese, telefoane sau e-mailuri din coloanele lor.\nCost estimat: cel mult ${usd(plan.cost_max_usd)} (de obicei mult mai puțin). Rezultatul nu schimbă nimic din import: doar marchează rânduri de verificat.\nPornești?`)) return
    const g = ++gen.current
    const curent = () => montat.current && g === gen.current && proiectRef.current === proiectStart && previewRef.current === pvStart
    setStare({ lucru: true, facut: 0, total: plan.bucati.length, mesaj: '', eroare: '' }); setExplicatii(null)
    let sha
    try { sha = await sha256Hex(new Uint8Array(await fisier.arrayBuffer())) } catch { sha = null }
    if (!curent()) return
    if (!sha || typeof globalThis.crypto?.randomUUID !== 'function') { setStare(s => ({ ...s, lucru: false, eroare: 'Nu pot calcula amprenta fișierului în acest browser.' })); return }
    const semnale = []; const reusite = []; let respinse = 0, cost = 0, costNecunoscut = false, facute = 0, oprit = null, jurnalNeconfirmat = 0
    for (let k = 0; k < plan.bucati.length; k++) {
      if (!curent()) return   // ecran închis / alt proiect / altă previzualizare: nimic nu se mai aplică
      const corp = { proiect_id: proiectStart, fisier_sha256: sha, bucata: k + 1, bucati: plan.bucati.length, cheie: globalThis.crypto.randomUUID(), randuri: plan.bucati[k] }
      let data = null, error = null
      try { ({ data, error } = await supabase.functions.invoke(FUNCTIA_EDGE_AI, { body: corp })) } catch (e) { error = e }
      if (error) { try { data = typeof error.context?.json === 'function' ? await error.context.json() : null } catch { data = null } }
      if (!curent()) return
      if (data?.cod !== 'ok' || !Array.isArray(data?.semnale)) { oprit = data?.cod || 'ai_necunoscut'; break }   // L05: fără reluare automată
      // doar i / camp / categorie (lista albă): orice alt câmp din răspuns (text) nu se păstrează
      for (const s of data.semnale) semnale.push({ i: s?.i, camp: s?.camp, categorie: s?.categorie })
      respinse += Number(data.respinse) || 0; facute++; reusite.push(k)
      if (Number.isFinite(data.cost_usd)) cost += data.cost_usd; else costNecunoscut = true
      if (data.jurnal_confirmat !== true) jurnalNeconfirmat++
      setStare(s => ({ ...s, facut: facute }))
    }
    if (!curent()) return
    const intrari = semnaleAiInDeVerificat(semnale, plan.harta)
    const rezumat = { complet: facute === plan.bucati.length, bucati: plan.bucati.length, facute, semnale: semnale.length, randuri_semnalate: new Set(intrari.map(x => x.rand)).size,
      respinse, cost_usd: costNecunoscut ? null : Math.round(cost * 1e6) / 1e6, oprit, fisier: fisierNume }
    setExplicatii(intrari.map(x => ({ rand: x.rand, uat: x.uat, nr_crt: x.nr_crt, camp: x.camp, categorie: String(x.motive?.[0] || '').replace(/^ai_/, '') })))
    const mesaj = `${rezumat.complet ? 'Verificare AI încheiată' : `Verificare AI INCOMPLETĂ (${facute} din ${plan.bucati.length} apeluri)`}: ${rezumat.randuri_semnalate} rânduri semnalate`
      + `${respinse ? `, ${respinse} semnale AI respinse la validare` : ''}; cost ${rezumat.cost_usd == null ? 'necunoscut (socotit cel maxim)' : usd(rezumat.cost_usd)}.`
      + `${jurnalNeconfirmat ? ` Jurnalul n-a confirmat ${jurnalNeconfirmat} apeluri (rămân socotite la costul maxim).` : ''}`
      + `${rezumat.complet ? '' : ' Semnalele AI anterioare ale bucăților neverificate acum rămân în „De verificat”.'}`
    setStare({ lucru: false, facut: facute, total: plan.bucati.length, mesaj, eroare: oprit ? mesajCodAi(oprit) : '' })
    // previzualizare nouă cu semnalele AI (chiar parțiale): bifa „am verificat” se cere din nou; semnalele vechi se înlocuiesc DOAR pe rândurile
    // bucăților reușite acum (reusite → randuriAcoperite)
    if (facute > 0) onSemnale?.(pvStart, intrari, rezumat, randuriAcoperite(plan, reusite))
    show?.(mesaj, oprit ? 'error' : 'success')
  }

  return (
    <div style={{ ...S.card, borderColor:G.purple, marginTop:10 }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
        <div style={{ fontWeight:700 }}>Verificare AI (a doua opinie)</div>
        <button style={S.btnS} onClick={porneste} disabled={stare.lucru}>{stare.lucru ? `Verific… ${stare.facut} / ${stare.total}` : '🤖 Verificare AI (a doua opinie)'}</button>
      </div>
      <div style={{ fontSize:12, color:G.muted, marginTop:6 }}>
        Opțional, după verificarea fixă: un model AI (Claude) caută în poz. HG / nr. cadastral / tarla valori care par nume, adrese, telefoane, CNP-uri, e-mailuri sau text liber.
        Se trimit DOAR aceste trei câmpuri ({fmtNum(plan.unice)} valori unice din {fmtNum(plan.randuri)} rânduri, {plan.bucati.length} apeluri), fără nume / adrese / contacte.
        Cost estimat: cel mult <b>{usd(plan.cost_max_usd)}</b>. Nu blochează și nu schimbă nimic: rândurile semnalate apar în „De verificat” cu eticheta AI.
        {plan.prea_lungi > 0 && <span style={{ color:G.orange }}> {fmtNum(plan.prea_lungi)} rânduri NU se trimit (valoare prea lungă — verificați-le manual).</span>}
      </div>
      {stare.mesaj && <div style={{ fontSize:12.5, color: stare.eroare ? G.orange : G.green, marginTop:6 }}>{stare.mesaj}</div>}
      {stare.eroare && <div style={{ fontSize:12.5, color:G.red, marginTop:4 }}>{stare.eroare}</div>}
      {Array.isArray(explicatii) && explicatii.length > 0 && (
        <div style={{ overflow:'auto', maxHeight:260, marginTop:8 }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr>{['Rând', 'UAT', 'Nr.Crt.', 'Câmp', 'Categorie (AI)', 'Explicație'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>{explicatii.slice(0, 200).map((x, i) => <tr key={i}><td style={S.td}>{x.rand ?? '-'}</td><td style={S.td}>{x.uat}</td><td style={S.td}>{x.nr_crt}</td><td style={S.td}>{ETICHETA_CAMP_VERIFICAT[x.camp]}</td><td style={S.td}>{ETICHETA_CATEGORIE_AI[x.categorie]}</td><td style={{ ...S.td, fontSize:12 }}>{EXPLICATIE_CATEGORIE_AI[x.categorie]}</td></tr>)}</tbody>
          </table>
          {explicatii.length > 200 && <div style={{ fontSize:12, color:G.muted, padding:6 }}>… încă {explicatii.length - 200} (toate sunt în tab-ul „De verificat”).</div>}
        </div>
      )}
    </div>
  )
}
