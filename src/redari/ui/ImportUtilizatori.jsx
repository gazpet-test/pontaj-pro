// Redări PR4b — ecranul importului de utilizatori / arendași (fișierul beneficiarului „Date de contact utilizatori”, coloanele 24–26).
// Pași: fișier → citire + plan (parseazaUtilizatori → citesteDatePlan → planUtilizatori, nimic scris) → previzualizare cu totaluri, tabel pe UAT
// și liste pe categorii → raport CSV → versiunea listei (obligatorie) → bifa separată pentru potrivirile după poziția HG → avertisment dacă alt
// import al proiectului rulează / a pornit recent → confirmare → scrieUtilizatori → rezultat reconstituit din BD (reconciliazaImport).
// Dreptul: același ca importul listei (ImportTgz): admin / editor în interfață; în BD politicile red_detinatori_ins / red_contact_ins /
// red_import_loturi_ins|upd cer fn_red_nivel() IN ('admin','editor'). Anularea pe lot: doar owner în interfață (vezi importUtilizatoriAnulare.js).
// Nu trimite nimic; convocarea utilizatorilor rămâne după poarta owner-ului (PR3a).
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { parseazaUtilizatori, citesteDatePlan, planUtilizatori, scrieUtilizatori, reconciliazaImport, eroareDeterminista, SURSA_UTILIZATORI } from '../importUtilizatori.js'
import { CATEGORII, totaluriImport, totaluriPeUat, randuriRaport, stareDupaScriere, numaraStari, csvRaportUtilizatori } from '../importUtilizatoriRaport.js'
import { pregatesteAnulare, executaAnulare, csvAnulare, MOTIV_MINIM } from '../importUtilizatoriAnulare.js'
import { G, S, fmtNum, msgEroare, Camp, Gol } from './comune.jsx'

const MAX_LISTA = 100
export const FEREASTRA_ALTE_IMPORTURI_MIN = 15
const EXPLICATII = {
  nou: 'Se adaugă ca deținător cu calitatea „utilizator” pe parcela existentă, cu adresa din fișier. Cele marcate „poziție HG” au fost potrivite după poziția HG unică în UAT (cheia exactă diferă): se importă DOAR cu bifa separată, după verificarea lor în raportul CSV.',
  deja: 'Persoana este deja deținător activ pe aceeași parcelă (proprietar sau utilizator dintr-un import anterior): nu se adaugă a doua oară.',
  negasita: 'Parcela din fișier nu există în proiect (nici după cheie, nici după o poziție HG unică): nu se creează parcele, rândul nu se importă.',
  coliziune: 'Același om pe aceeași parcelă din alt rând al fișierului. Cu adrese diferite, persoana NU se importă (nu se alege automat o adresă).',
  exclus: 'Primul rând al unei coliziuni cu adrese diferite: exclus din import, de verificat împreună cu rândul care îl contrazice.',
  dublura: 'Rând identic (persoană, parcelă, contact) cu un rând anterior din fișier: se numără o singură dată.',
  fara_cheie: 'Fără poziție HG și fără număr cadastral: parcela nu se poate identifica, rândul nu se importă.',
}
const TITLU_REZULTAT = { ok: 'Rezultatul importului', esuat: 'Import eșuat', ambiguu: 'Rezultat nesigur: nu știm sigur ce s-a scris — iată ce am găsit în bază' }

const descarcaCsv = (text, nume) => {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a'); a.href = url; a.download = nume; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
const numeFisierCsv = (cod, versiune, eticheta) => `utilizatori-${String(cod || 'proiect')}-${String(versiune || 'fara-versiune').trim()}-${eticheta}.csv`.replace(/[^\w.-]+/g, '_')

/** r2 pct. 1c: loturile de import ale proiectului (orice sursă) rămase „în curs” sau pornite în ultimele minute. Eroarea urcă (L18). */
export async function alteImporturi(client, proiectId, { minute = FEREASTRA_ALTE_IMPORTURI_MIN, acum = Date.now() } = {}) {
  const col = 'id, created_at, stare, sursa, versiune_lista_tgz'
  const deLa = new Date(acum - minute * 60000).toISOString()
  const [a, b] = await Promise.all([
    client.from('red_import_loturi').select(col).eq('proiect_id', proiectId).eq('stare', 'in_curs').order('created_at', { ascending: false }).limit(20),
    client.from('red_import_loturi').select(col).eq('proiect_id', proiectId).gte('created_at', deLa).order('created_at', { ascending: false }).limit(20),
  ])
  if (a.error) throw a.error
  if (b.error) throw b.error
  const tot = new Map([...(a.data || []), ...(b.data || [])].map(l => [l.id, l]))
  return [...tot.values()].sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)))
}

export default function ImportUtilizatori({ proiect, uats = [], nivel, profile = null, show, onImportat }) {
  const poateScrie = nivel === 'admin' || nivel === 'editor'
  const esteOwner = profile?.is_owner === true
  const [deschis, setDeschis] = useState(false)
  const [fisier, setFisier] = useState(null)
  const [versiune, setVersiune] = useState('')
  const [preview, setPreview] = useState(null)       // { proiectId, fisier, fisierNume, parsat, plan }
  const [includHg, setIncludHg] = useState(false)    // r2 pct. 5: potrivirile după poziția HG — confirmare separată, nebifată implicit
  const [lucru, setLucru] = useState(null)           // null | 'citire' | 'scriere'
  const [eroare, setEroare] = useState(null)         // eroarea citirii / planului (L18: afișată, nu „nimic de importat”)
  const [rezultat, setRezultat] = useState(null)
  const [subTab, setSubTab] = useState('nou')
  const [loturi, setLoturi] = useState(null)
  const [loturiStare, setLoturiStare] = useState({ lucru: false, eroare: null })
  const [anulare, setAnulare] = useState(null)       // { lotId, lucru, pregatire, eroare, motiv, rezultat }
  // L24: generații separate pentru citire, scriere, istoric și anulare; rezultatele se aplică doar pe ecranul montat, același proiect, același fișier
  const montat = useRef(true)
  const proiectRef = useRef(proiect?.id); proiectRef.current = proiect?.id
  const fisierRef = useRef(null)
  const genPreview = useRef(0), genScriere = useRef(0), genLoturi = useRef(0), genAnulare = useRef(0)
  const ocupat = useRef(false)                       // L05: zăvor sincron, pus înaintea primului await al scrierii
  const ocupatAnulare = useRef(false)
  useEffect(() => { montat.current = true; return () => { montat.current = false; genPreview.current++; genScriere.current++; genLoturi.current++; genAnulare.current++ } }, [])
  useEffect(() => {
    // proiect nou: tot ce ține de proiectul vechi dispare, iar citirile / scrierile în zbor nu se mai aplică aici
    genPreview.current++; genScriere.current++; genLoturi.current++; genAnulare.current++
    fisierRef.current = null
    setFisier(null); setPreview(null); setLucru(null); setEroare(null); setRezultat(null); setLoturi(null); setLoturiStare({ lucru: false, eroare: null }); setAnulare(null); setIncludHg(false)
  }, [proiect?.id])

  const alegeFisier = (f) => {
    // fișier nou: citirea în zbor (dacă e) se abandonează, previzualizarea veche nu mai e a acestui fișier
    genPreview.current++
    fisierRef.current = f || null
    setFisier(f || null); setPreview(null); setEroare(null); setRezultat(null); setIncludHg(false)
    if (lucru === 'citire') setLucru(null)
  }

  const previzualizeaza = async () => {
    if (!fisier) { show('Alege fișierul Excel (.xlsx) cu datele de contact ale utilizatorilor.', 'error'); return }
    if (!uats.length) { show('Proiectul nu are UAT-uri (sau nu s-au încărcat încă).', 'error'); return }
    if (ocupat.current || lucru === 'scriere') { show('O scriere e în curs; așteaptă rezultatul.', 'error'); return }
    const gen = ++genPreview.current; const proiectStart = proiect.id; const f = fisier
    const curent = () => montat.current && gen === genPreview.current && proiectRef.current === proiectStart && fisierRef.current === f
    setLucru('citire'); setPreview(null); setEroare(null); setRezultat(null); setIncludHg(false)
    try {
      if (!/\.xlsx$/i.test(f.name || '')) throw new Error('Fișierul trebuie să fie Excel .xlsx (fișierul beneficiarului „Date de contact utilizatori”).')
      const ab = await f.arrayBuffer()
      if (!curent()) return
      let parsat
      try { parsat = parseazaUtilizatori(ab, { uats: uats.map(u => ({ nume: u.nume, uat3: u.uat3 })) }) }
      catch (e) { throw new Error(`Fișierul nu se poate citi: ${msgEroare(e)}`) }
      if (!parsat?.statistici?.randuri) throw new Error('Fișierul nu are rânduri de date în formatul așteptat (foaia 1, antet pe 3 rânduri, UAT-ul în coloana A). Este fișierul „Date de contact utilizatori”?')
      const date = await citesteDatePlan(supabase, proiectStart)
      if (!curent()) return
      const plan = planUtilizatori(parsat.candidati, date)   // aruncă la „două parcele active cu aceeași cheie” — nimic nu se importă
      setPreview({ proiectId: proiectStart, fisier: f, fisierNume: f.name || null, parsat, plan })
      setSubTab('nou')
      const t = totaluriImport(parsat, plan)
      show(`Previzualizare: ${t.noi} utilizatori noi pe ${t.parcele_noi} parcele (${t.persoane_noi} persoane); nimic nu s-a scris.`, t.noi ? 'success' : 'info')
    } catch (e) {
      if (curent()) setEroare(msgEroare(e))
    } finally { if (curent()) setLucru(null) }
  }

  const t = useMemo(() => (preview ? totaluriImport(preview.parsat, preview.plan) : null), [preview])
  const peUat = useMemo(() => (preview ? totaluriPeUat(preview.parsat, preview.plan, uats) : []), [preview, uats])
  const raport = useMemo(() => (preview ? randuriRaport(preview.parsat, preview.plan) : []), [preview])
  // r2 pct. 5: ce se scrie efectiv = rândurile pe cheie exactă + (doar cu bifa) cele potrivite după poziția HG
  const scris = useMemo(() => {
    if (!preview) return null
    const hg = preview.plan.noi.filter(n => n.potrivire === 'hg')
    const noi = includHg ? preview.plan.noi : preview.plan.noi.filter(n => n.potrivire !== 'hg')
    return { noi, hg, hgExclus: includHg ? [] : hg, parcele: new Set(noi.map(n => n.parcela_id)).size, persoane: new Set(noi.map(n => n.nume_normalizat)).size }
  }, [preview, includHg])
  const previewValid = !!preview && preview.proiectId === proiect?.id && preview.fisier === fisier
  const versiuneOk = versiune.trim().length > 0
  const poateImporta = poateScrie && previewValid && versiuneOk && lucru === null && !!scris && scris.noi.length > 0
  const poateContacte = poateScrie && previewValid && versiuneOk && lucru === null && !!t && t.noi === 0 && (preview.plan.deja_detinatori || []).some(d => d.contact)

  const incarcaLoturi = async () => {
    const gen = ++genLoturi.current; const proiectId = proiectRef.current
    setLoturiStare({ lucru: true, eroare: null })
    const { data, error } = await supabase.from('red_import_loturi').select('id, created_at, stare, eroare, versiune_lista_tgz, fisier_nume, randuri_total, detinatori_noi, diferente')
      .eq('proiect_id', proiectId).eq('sursa', SURSA_UTILIZATORI).order('created_at', { ascending: false }).limit(20)
    if (!montat.current || gen !== genLoturi.current || proiectId !== proiectRef.current) return
    if (error) { setLoturi(null); setLoturiStare({ lucru: false, eroare: msgEroare(error) }); return }   // L18: eroare ≠ listă goală
    setLoturi(data || []); setLoturiStare({ lucru: false, eroare: null })
  }

  const scrie = async ({ doarContacte = false } = {}) => {
    if (ocupat.current) { show('Importul pornit anterior încă rulează; așteaptă rezultatul.', 'error'); return }   // L05: dublu-click = o singură scriere
    if (!(doarContacte ? poateContacte : poateImporta)) return
    const p = preview, ver = versiune.trim(), proiectStart = proiect.id, cod = proiect.cod, sc = scris
    // r2 pct. 5: planul trimis bibliotecii conține DOAR rândurile confirmate; potrivirile HG neconfirmate rămân în lot și în raport
    const planScris = doarContacte ? { ...p.plan, noi: [], hg_neconfirmate: [] } : { ...p.plan, noi: sc.noi, hg_neconfirmate: sc.hgExclus }
    ocupat.current = true                            // L05: zăvorul înaintea primului await (verificarea altor importuri)
    const gen = ++genScriere.current
    const curent = () => montat.current && gen === genScriere.current && proiectRef.current === proiectStart
    let pornit = false
    try {
      // r2 pct. 1c: alt import al proiectului în curs / pornit în ultimele minute → confirmare explicită separată; citirea eșuată = nu pornește
      let altele
      try { altele = await alteImporturi(supabase, proiectStart) }
      catch (e) { if (curent()) show(`Nu am putut verifica dacă rulează alt import în ${cod}: ${msgEroare(e)}. Importul NU a pornit.`, 'error'); return }
      if (!curent()) return
      const hgText = sc?.hg.length ? (includHg ? `\n${sc.hg.length} potriviți după poziția HG sunt INCLUȘI (bifa „le-am verificat în raport”).` : `\n${sc.hg.length} potriviți după poziția HG NU se importă acum (neconfirmați; rămân în raport și se pot importa ulterior, cu bifa).`) : ''
      const intrebare = doarContacte
        ? `Reiei importul utilizatorilor în ${cod} (lista „${ver}”) doar pentru completarea contactelor lipsă?\nNu se adaugă niciun deținător nou; un lot nou apare în istoric doar dacă există contacte de completat.`
        : `Confirmi importul în ${cod}?\n\n${sc.noi.length} utilizatori (${sc.persoane} persoane) pe ${sc.parcele} parcele, lista „${ver}”.${hgText}\n${t.deja_detinatori} deja deținători, ${t.parcela_negasita} cu parcela negăsită și ${t.coliziuni + t.exclusi} în coliziune NU se importă.\n\nNu se creează parcele, nu se schimbă proprietarii și nu se trimite nimic. Utilizatorii nu primesc convocator până când owner-ul aprobă convocarea utilizatorilor în Setări proiect.`
      if (!window.confirm(intrebare)) return
      if (altele.length) {
        const lista = altele.slice(0, 5).map(l => `• ${String(l.created_at || '').slice(0, 16).replace('T', ' ')} · ${l.sursa || '-'} · ${l.stare} · „${l.versiune_lista_tgz || '-'}”`).join('\n')
        const avert = `ATENȚIE: în ${cod} există ${altele.length} import(uri) în curs sau pornite în ultimele ${FEREASTRA_ALTE_IMPORTURI_MIN} minute:\n${lista}\n\nDouă importuri / corecturi de parcele în același timp pot pune un utilizator pe o parcelă care tocmai s-a schimbat. Regula: un singur operator, fără alte importuri sau corecturi de parcele în timpul importului.\n\nContinui oricum?`
        if (!window.confirm(avert)) return
      }
      if (!curent()) return
      pornit = true
      setLucru('scriere'); setEroare(null); setRezultat(null)
      let rez = null, eroareScriere = null
      try { rez = await scrieUtilizatori(supabase, planScris, { proiectId: proiectStart, versiune: ver, fisierNume: p.fisierNume }) }
      catch (e) { eroareScriere = e }
      // starea reală din BD, indiferent de rezultat (L05: după o eroare nu presupunem nici „nimic scris”, nici „tot scris”)
      const lotId = rez?.lotId ?? eroareScriere?.lotId ?? null
      let lot = null, rec = null, eroareRecitire = null
      try {
        if (lotId) {
          const { data, error } = await supabase.from('red_import_loturi').select('id, stare, eroare, detinatori_noi, diferente, created_at').eq('id', lotId).maybeSingle()
          if (error) throw error
          lot = data || null
        }
        rec = await reconciliazaImport(supabase, { proiectId: proiectStart, lotId, plan: planScris })
      } catch (e) { eroareRecitire = msgEroare(e) }
      // r2 pct. 3: tipul rezultatului — eroare determinată (cod SQL / PostgREST) vs. răspuns pierdut (nu știm ce s-a comis)
      const tip = !eroareScriere ? 'ok' : (eroareDeterminista(eroareScriere) ? 'esuat' : 'ambiguu')
      // reconcilierea decide reîncărcarea restului modulului: ceva scris de această operație în BD, contacte scrise, sau necunoscut
      const atins = (rez && !rez.nimicDeFacut && (rez.detinatoriNoi + rez.contacteNoi) > 0) || (rec?.scrise?.length ?? 0) > 0
        || (lot?.diferente?.contacte_scrise?.length ?? 0) > 0 || (!!eroareScriere && !!lotId && !rec)
      if (!curent()) {
        show(eroareScriere ? `Importul utilizatorilor în ${cod} a eșuat: ${msgEroare(eroareScriere)}` : `Importul utilizatorilor în ${cod} s-a terminat; rezultatul e în istoricul loturilor acelui proiect.`, eroareScriere ? 'error' : 'info')
        return
      }
      const planRaport = { ...p.plan, hg_neconfirmate: planScris.hg_neconfirmate }
      const dupa = stareDupaScriere(doarContacte ? planScris : planRaport, rec, lot, lotId)
      setRezultat({ tip, rez, eroare: eroareScriere ? msgEroare(eroareScriere) : null, lotNeinchis: eroareScriere?.lotNeinchis || null,
        lotId, lot, rec, eroareRecitire, inainte: p, planRaport: doarContacte ? planScris : planRaport, versiune: ver, cod, dupa, doarContacte })
      setPreview(null)   // planul confirmat nu mai e valid după o scriere (reușită sau nu): următorul pas pornește de la o previzualizare nouă
      if (tip === 'ambiguu') show('Rezultat nesigur la importul utilizatorilor: ' + msgEroare(eroareScriere) + '. Verificați ce s-a găsit în bază.', 'error')
      else if (eroareScriere) show('Importul utilizatorilor a eșuat: ' + msgEroare(eroareScriere), 'error')
      else if (rez.nimicDeFacut) show('Nimic de completat: utilizatorii au deja contact. Nu s-a creat niciun lot.', 'info')
      else show(`Import terminat: ${rez.detinatoriNoi} utilizatori și ${rez.contacteNoi} contacte noi${rez.sarite || rez.schimbate ? `; ${rez.sarite + rez.schimbate} sărite` : ''}${rez.deVerificat?.length ? `; ${rez.deVerificat.length} de verificat` : ''}.`, rez.deVerificat?.length ? 'error' : 'success')
      if (atins) onImportat?.()
      if (loturi) incarcaLoturi()
    } finally {
      ocupat.current = false
      if (pornit && curent()) setLucru(null)
    }
  }

  // ── r2 pct. 7: anularea unui lot de utilizatori (doar owner în interfață) ──
  const pregatesteAnulareLot = async (lotId) => {
    if (!esteOwner || ocupatAnulare.current) return
    const gen = ++genAnulare.current; const proiectId = proiectRef.current
    const curentA = () => montat.current && gen === genAnulare.current && proiectRef.current === proiectId
    setAnulare({ lotId, lucru: 'pregatire', pregatire: null, eroare: null, motiv: '', rezultat: null })
    try {
      const pregatire = await pregatesteAnulare(supabase, { proiectId, lotId })
      if (curentA()) setAnulare(a => (a && a.lotId === lotId ? { ...a, lucru: null, pregatire } : a))
    } catch (e) { if (curentA()) setAnulare(a => (a && a.lotId === lotId ? { ...a, lucru: null, eroare: msgEroare(e) } : a)) }
  }
  const executaAnulareLot = async () => {
    if (ocupatAnulare.current) { show('Anularea pornită anterior încă rulează.', 'error'); return }   // L05
    const a = anulare
    if (!esteOwner || !a?.pregatire || a.lucru) return
    const motiv = String(a.motiv || '').trim()
    if (motiv.length < MOTIV_MINIM) { show(`Motivul anulării e obligatoriu (minim ${MOTIV_MINIM} caractere).`, 'error'); return }
    const n = a.pregatire.anulabili.length
    if (!n) { show('Nimic de anulat în acest lot.', 'info'); return }
    if (!window.confirm(`Anulezi importul: ${n} utilizatori din lotul ${a.lotId} se marchează „șters” (ștergere logică, cu motivul dat)?\n${a.pregatire.raman.length} rămân (au urme în aval sau au fost modificați) și NU se ating.\n\nOperația se poate relua; nu se șterge nimic fizic.`)) return
    ocupatAnulare.current = true
    const gen = ++genAnulare.current; const proiectId = proiectRef.current
    const curentA = () => montat.current && gen === genAnulare.current && proiectRef.current === proiectId
    setAnulare(x => ({ ...x, lucru: 'anulare' }))
    try {
      let rezultat = null, eroareA = null
      try { rezultat = await executaAnulare(supabase, { proiectId, lotId: a.lotId, aratat: a.pregatire, motiv, profilId: profile?.id }) }
      catch (e) { eroareA = msgEroare(e) }
      if (rezultat && (rezultat.anulati.length || rezultat.necunoscute.length)) onImportat?.()
      if (!curentA()) return
      setAnulare(x => ({ ...x, lucru: null, rezultat, eroare: eroareA }))
      if (eroareA) show('Anularea nu a pornit: ' + eroareA, 'error')
      else show(`Anulare: ${rezultat.anulati.length} utilizatori marcați șterși; ${rezultat.raman.length} rămân${rezultat.necunoscute.length ? `; ${rezultat.necunoscute.length} cu rezultat necunoscut — reluați` : ''}.`, rezultat.necunoscute.length || rezultat.deVerificat.length ? 'error' : 'success')
      if (loturi) incarcaLoturi()
    } finally { ocupatAnulare.current = false }
  }

  const statCard = (et, val, culoare = G.text) => <div style={{ ...S.card, padding:'8px 12px', minWidth:110 }}><div style={{ fontSize:11.5, color:G.muted }}>{et}</div><div style={{ fontSize:18, fontWeight:700, color: culoare }}>{val ?? '-'}</div></div>
  const aprobata = proiect?.convocare_utilizatori_aprobata === true

  const listaCategorie = (cod) => {
    const randuri = raport.filter(r => r.categorie === cod)
    if (!randuri.length) return <Gol text="Nimic în această categorie." />
    return (
      <div style={{ overflow:'auto', maxHeight:380 }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead><tr>{['Rând', 'UAT', 'Parcelă', 'Nume', 'Adresă', 'Telefon', 'Motiv'].map(k => <th key={k} style={S.th}>{k}</th>)}</tr></thead>
          <tbody>{randuri.slice(0, MAX_LISTA).map((r, i) => (
            <tr key={i}>
              <td style={S.td}>{r.rand ?? '-'}</td><td style={S.td}>{r.uat}</td>
              <td style={{ ...S.td, ...S.mono }}>{r.id_parcela || '-'}{r.potrivire === 'hg' && <span data-marcaj="hg" style={{ ...S.tag, background:G.yellowDim, color:G.yellow, marginLeft:6 }}>poziție HG</span>}</td>
              <td style={S.td}>{r.nume || '-'}</td><td style={S.td}>{r.cu_adresa || '-'}</td><td style={S.td}>{r.cu_telefon || '-'}</td>
              <td style={{ ...S.td, fontSize:12, color:G.muted }}>{r.motiv}</td>
            </tr>))}
          </tbody>
        </table>
        {randuri.length > MAX_LISTA && <div style={{ fontSize:12, color:G.muted, padding:8 }}>… încă {randuri.length - MAX_LISTA} rânduri (toate sunt în raportul CSV).</div>}
      </div>
    )
  }

  // lista „de verificat” după scriere (r2 pct. 1b), cu numele din fișier (ecranul local; lotul nu ține nume)
  const numeRand = (r, rand) => (r?.inainte?.parsat?.candidati || []).find(c => c.rand === rand)?.nume || '-'
  const deVerificatRez = rezultat ? [...new Map([...(rezultat.rez?.deVerificat || []), ...(rezultat.rec?.deVerificat || [])].map(v => [v.id, v])).values()] : []
  const stari = rezultat ? numaraStari(rezultat.dupa) : null
  const scrisiDeOperatie = stari ? stari.scris + stari.scris_fara_contact + stari.de_verificat : 0

  return (
    <div style={{ ...S.card, marginTop:12 }} data-sectiune="import-utilizatori">
      <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
        <div style={{ fontWeight:700 }}>Import utilizatori / arendași (date de contact ale utilizatorilor)</div>
        <span style={{ ...S.tag, background: aprobata ? G.greenDim : G.yellowDim, color: aprobata ? G.green : G.yellow }}>convocarea utilizatorilor: {aprobata ? 'aprobată' : 'neaprobată'}</span>
        <div style={{ flex:1 }} />
        <button style={S.btnS} onClick={() => setDeschis(v => !v)}>{deschis ? 'Ascunde' : 'Deschide importul utilizatorilor'}</button>
      </div>
      {deschis && (<>
        <div style={{ fontSize:12.5, color:G.muted, margin:'8px 0 12px' }}>
          Adaugă pe parcelele EXISTENTE ale proiectului persoanele care folosesc terenul (altele decât proprietarul), cu calitatea „utilizator” și adresa din fișier.
          Nu creează parcele, nu schimbă proprietarii și nu trimite nimic. Până când owner-ul aprobă convocarea utilizatorilor (Setări proiect), ei nu primesc convocator.
          Regula importului real: un singur operator, fără alte importuri sau corecturi de parcele în același timp.
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:10, alignItems:'end' }}>
          <Camp eticheta="1. Fișierul beneficiarului (.xlsx) — foaia 1, antet pe 3 rânduri">
            <input type="file" accept=".xlsx" onChange={e => alegeFisier(e.target.files?.[0] || null)} style={{ ...S.input, padding:5 }} disabled={lucru === 'scriere'} />
          </Camp>
          <Camp eticheta="Versiunea listei (obligatoriu, fără valoare implicită)">
            <input value={versiune} onChange={e => setVersiune(e.target.value)} style={S.input} placeholder="ex. TGZ 13.07.2026 utilizatori" disabled={lucru === 'scriere'} />
          </Camp>
        </div>
        <div style={{ fontSize:12, color:G.muted, marginTop:4 }}>Versiunea se scrie pe fiecare utilizator importat și pe lot. Formatul folosit la celelalte loturi: „TGZ ZZ.LL.AAAA” (data listei primite), aici urmat de „utilizatori”.</div>
        <div style={{ display:'flex', justifyContent:'flex-end', marginTop:10 }}>
          <button style={S.btnS} onClick={previzualizeaza} disabled={!!lucru || !fisier}>{lucru === 'citire' ? 'Citesc fișierul și parcelele…' : '🔍 2. Citește și previzualizează'}</button>
        </div>
        {eroare && <div data-eroare="citire" style={{ ...S.card, borderColor:G.red, color:G.red, fontSize:13, marginTop:10 }}>Nu am putut pregăti importul: {eroare}<div style={{ color:G.muted, fontSize:12, marginTop:4 }}>Nimic nu s-a scris.</div></div>}

        {preview && t && (
          <div style={{ marginTop:12 }}>
            <div style={{ fontWeight:700, marginBottom:8 }}>3. Previzualizare — nimic nu s-a scris încă</div>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:10 }}>
              {statCard('Rânduri în fișier', fmtNum(t.randuri))}
              {statCard('Cu utilizator', fmtNum(t.cu_utilizator))}
              {statCard('În afara proiectului', fmtNum(t.in_afara_proiectului), G.muted)}
              {statCard('Fără cheie', fmtNum(t.fara_cheie), t.fara_cheie ? G.orange : G.text)}
              {statCard('Dubluri în fișier', fmtNum(t.dubluri_fisier))}
              {statCard('Candidați', fmtNum(t.candidati))}
              {statCard('Noi (rânduri)', fmtNum(t.noi), G.green)}
              {statCard('Persoane noi', fmtNum(t.persoane_noi), G.green)}
              {statCard('Parcele cu utilizatori noi', fmtNum(t.parcele_noi), G.green)}
              {statCard('Deja deținători', fmtNum(t.deja_detinatori), G.blue)}
              {statCard('Parcelă negăsită', fmtNum(t.parcela_negasita), t.parcela_negasita ? G.orange : G.text)}
              {statCard('Coliziuni', fmtNum(t.coliziuni + t.exclusi), (t.coliziuni + t.exclusi) ? G.red : G.text)}
              {statCard('Potrivite după poziția HG', fmtNum(t.potrivire_hg), t.potrivire_hg ? G.yellow : G.text)}
              {statCard('Noi cu adresă', fmtNum(t.cu_adresa))}
              {statCard('Noi cu telefon', fmtNum(t.cu_telefon))}
            </div>
            {t.cu_utilizator === 0 && <div style={{ fontSize:12.5, color:G.yellow, marginBottom:8 }}>⚠ Niciun rând nu are completat utilizatorul (coloana „Prenume și nume”). Verificați că este fișierul corect.</div>}

            <div style={{ overflow:'auto', marginBottom:10 }}>
              <table style={{ borderCollapse:'collapse' }}>
                <thead><tr>{['UAT', 'Candidați', 'Noi', 'Persoane noi', 'Poziție HG', 'Deja deținători', 'Negăsite', 'Coliziuni', 'Fără cheie', 'Dubluri'].map(k => <th key={k} style={S.th}>{k}</th>)}</tr></thead>
                <tbody>{peUat.map(u => (
                  <tr key={u.uat3}><td style={S.td}>{u.nume} <span style={{ color:G.muted }}>({u.uat3})</span></td>
                    {[u.candidati, u.noi, u.persoane, u.potrivire_hg, u.deja, u.negasite, u.coliziuni, u.fara_cheie, u.dubluri].map((v, i) => <td key={i} style={{ ...S.td, textAlign:'right' }}>{fmtNum(v)}</td>)}</tr>))}
                </tbody>
              </table>
            </div>

            <div style={{ display:'flex', gap:4, borderBottom:`1px solid ${G.border2}`, marginBottom:8, flexWrap:'wrap' }}>
              {CATEGORII.filter(c => c.cod !== 'in_afara').map(c => (
                <button key={c.cod} onClick={() => setSubTab(c.cod)} style={{ padding:'6px 10px', background:'transparent', border:'none', borderBottom: subTab === c.cod ? `2px solid ${G.green}` : '2px solid transparent', color: subTab === c.cod ? G.text : G.muted, cursor:'pointer', fontSize:12.5, fontWeight:600 }}>
                  {c.eticheta} ({raport.filter(r => r.categorie === c.cod).length})
                </button>
              ))}
            </div>
            {EXPLICATII[subTab] && <div style={{ fontSize:12, color:G.muted, marginBottom:6 }}>{EXPLICATII[subTab]}</div>}
            <div data-plafon="lista" style={{ fontSize:12, color:G.yellow, marginBottom:6 }}>Pe ecran se văd cel mult {MAX_LISTA} de rânduri pe categorie. Verificarea completă (mai ales a potrivirilor după poziția HG) se face din raportul CSV de mai jos.</div>
            {listaCategorie(subTab)}
            <div style={{ fontSize:12, color:G.muted, marginTop:6 }}>Rândurile din UAT-uri din afara proiectului ({fmtNum(t.in_afara_proiectului)}) se numără, nu se importă; sunt în raportul CSV.</div>

            {poateScrie && t.potrivire_hg > 0 && (
              <label data-bifa="hg" style={{ display:'flex', gap:8, alignItems:'center', marginTop:12, fontSize:13, color: includHg ? G.yellow : G.text }}>
                <input type="checkbox" checked={includHg} onChange={e => setIncludHg(!!e.target.checked)} disabled={lucru === 'scriere'} />
                Includ și cele {fmtNum(t.potrivire_hg)} potrivite după poziția HG (le-am verificat în raport)
              </label>
            )}
            {poateScrie && t.potrivire_hg > 0 && !includHg && <div style={{ fontSize:12, color:G.muted, marginTop:4 }}>Nebifat: cele {fmtNum(t.potrivire_hg)} rânduri rămân în raport „neimportate: potrivire după poziția HG, neconfirmată” și se pot importa ulterior (un al doilea import, cu bifa).</div>}

            <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', marginTop:12 }}>
              <button style={S.btnS} onClick={() => descarcaCsv(csvRaportUtilizatori(raport), numeFisierCsv(proiect.cod, versiune, 'previzualizare'))}>⬇ 4. Raportul previzualizării (CSV, {raport.length} rânduri)</button>
              <span style={{ fontSize:12, color:G.muted }}>Conține numele utilizatorilor (fără adrese / telefoane): se păstrează local, nu se trimite mai departe și nu se atașează la PR-uri.</span>
              <div style={{ flex:1 }} />
              {!poateScrie && <span style={{ fontSize:12.5, color:G.muted }}>Doar admin / editor pot importa.</span>}
              {poateScrie && !versiuneOk && <span style={{ fontSize:12.5, color:G.yellow }}>Completează versiunea listei.</span>}
              {poateScrie && t.noi > 0 && scris.noi.length === 0 && <span style={{ fontSize:12.5, color:G.yellow }}>Rămân doar potriviri după poziția HG: bifează-le după verificare sau nu importa nimic.</span>}
              {poateScrie && t.noi > 0 && <button style={S.btnP} onClick={() => scrie()} disabled={!poateImporta}>{lucru === 'scriere' ? 'Import în curs…' : `📥 Importă ${scris.noi.length} utilizatori pe ${scris.parcele} parcele${scris.hgExclus.length ? ` (fără potrivirile după HG: ${scris.hgExclus.length})` : ''}`}</button>}
              {poateScrie && t.noi === 0 && <span style={{ fontSize:12.5, color:G.muted }}>Nimic nou de importat.</span>}
              {poateContacte && <button style={S.btnS} onClick={() => scrie({ doarContacte: true })} title="Doar după un import întrerupt: completează adresa utilizatorilor scriși atunci fără contact; nu adaugă deținători.">Reia doar completarea contactelor lipsă (după un import întrerupt)</button>}
            </div>
          </div>
        )}

        {rezultat && (
          <div data-rezultat={rezultat.tip} style={{ ...S.card, borderColor: rezultat.tip === 'ok' ? G.green : rezultat.tip === 'ambiguu' ? G.orange : G.red, marginTop:12 }}>
            <div style={{ fontWeight:700, marginBottom:8, color: rezultat.tip === 'ok' ? G.text : rezultat.tip === 'ambiguu' ? G.orange : G.red }}>5. {TITLU_REZULTAT[rezultat.tip]}
              <span style={{ ...S.tag, marginLeft:8, background: rezultat.lot?.stare === 'finalizat' ? G.greenDim : G.redDim, color: rezultat.lot?.stare === 'finalizat' ? G.green : G.red }}>lot {rezultat.lot?.stare || (rezultat.lotId ? 'stare necitită' : 'necreat')}</span></div>
            {rezultat.tip !== 'ok' && <div style={{ fontSize:13, marginBottom:6 }}>{rezultat.eroare}</div>}
            {rezultat.tip === 'ambiguu' && <div style={{ fontSize:12.5, color:G.orange, marginBottom:6 }}>Răspunsul bazei s-a pierdut: o parte din scriere poate să se fi făcut. Cifrele de mai jos sunt citite ACUM din bază, după marcajul acestui lot.</div>}
            {rezultat.lotNeinchis && <div style={{ fontSize:12.5, color:G.red, marginBottom:6 }}>Lotul nu a putut fi marcat „eșuat” ({rezultat.lotNeinchis}); a rămas „în curs” în istoric.</div>}
            {rezultat.rez?.nimicDeFacut && <div style={{ fontSize:12.5, color:G.muted, marginBottom:6 }}>Nimic de completat: utilizatorii au deja contact. Nu s-a creat niciun lot.</div>}
            {stari && !rezultat.rez?.nimicDeFacut && (
              <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                {statCard('Scriși de această operație', fmtNum(scrisiDeOperatie), G.green)}
                {statCard('… din care contact lipsă', fmtNum(stari.scris_fara_contact), stari.scris_fara_contact ? G.orange : G.text)}
                {statCard('De verificat (țintă schimbată)', fmtNum(stari.de_verificat), stari.de_verificat ? G.red : G.text)}
                {statCard('Existau deja ca utilizator', fmtNum(stari.exista_utilizator))}
                {statCard('Existau cu altă calitate', fmtNum(stari.exista_alta_calitate), stari.exista_alta_calitate ? G.orange : G.text)}
                {statCard('Nescriși: țintă schimbată', fmtNum(stari.nescris_tinta), stari.nescris_tinta ? G.orange : G.text)}
                {statCard('Nescriși: oprit înainte', fmtNum(stari.nescris_oprit), stari.nescris_oprit ? G.orange : G.text)}
                {statCard('HG neconfirmate (neimportate)', fmtNum(stari.hg_neconfirmat), stari.hg_neconfirmat ? G.yellow : G.text)}
                {statCard('Contacte completate', fmtNum(stari.contact_completat), G.blue)}
                {statCard('Necunoscut', fmtNum(stari.necunoscut), stari.necunoscut ? G.red : G.text)}
              </div>
            )}
            <div style={{ fontSize:12, color:G.muted, marginTop:8 }}>Lot: <span style={S.mono}>{rezultat.lotId || '-'}</span> · lista „{rezultat.versiune}” · sursa {SURSA_UTILIZATORI}{rezultat.doarContacte ? ' · doar contacte' : ''}</div>
            {rezultat.eroareRecitire
              ? <div data-eroare="recitire" style={{ fontSize:12.5, color:G.red, marginTop:6 }}>Starea după scriere NU s-a putut reciti din BD ({rezultat.eroareRecitire}): raportul de mai jos o arată „necunoscut”. Refaceți previzualizarea.</div>
              : !rezultat.doarContacte && <div style={{ fontSize:12.5, color:G.muted, marginTop:6 }}>Recitit din BD: {fmtNum(scrisiDeOperatie)} din {fmtNum((rezultat.planRaport.noi || []).length - (stari?.hg_neconfirmat || 0))} rânduri confirmate sunt scrise de această operație.</div>}
            {rezultat.rez?.eroareVerificare && <div style={{ fontSize:12.5, color:G.red, marginTop:6 }}>Verificarea de după scriere nu s-a putut face ({rezultat.rez.eroareVerificare}): rândurile scrise trebuie verificate din raport.</div>}
            {deVerificatRez.length > 0 && (
              <div data-sectiune="de-verificat" style={{ marginTop:8 }}>
                <div style={{ fontWeight:600, fontSize:13, color:G.red }}>De verificat: ținta s-a schimbat în timpul importului ({deVerificatRez.length})</div>
                <div style={{ fontSize:12, color:G.muted }}>Persoanele de mai jos au fost scrise, dar parcela lor s-a schimbat între timp (detecție după scriere, nu prevenire). Verificați-le în Fișa parcelei; la nevoie, anulați lotul sau ștergeți-le de acolo.</div>
                <table style={{ borderCollapse:'collapse', marginTop:4 }}>
                  <thead><tr>{['Rând', 'Parcelă', 'Nume', 'Motiv'].map(k => <th key={k} style={S.th}>{k}</th>)}</tr></thead>
                  <tbody>{deVerificatRez.map(v => <tr key={v.id}><td style={S.td}>{v.rand ?? '-'}</td><td style={{ ...S.td, ...S.mono }}>{v.id_parcela || '-'}</td><td style={S.td}>{numeRand(rezultat, v.rand)}</td><td style={{ ...S.td, fontSize:12 }}>{v.motiv}</td></tr>)}</tbody>
                </table>
              </div>
            )}
            {rezultat.tip !== 'ok' && <div style={{ fontSize:12.5, color:G.yellow, marginTop:8 }}>Ce s-a scris rămâne (nu se șterge automat). Refaceți previzualizarea cu același fișier: rândurile deja scrise apar „deja deținători”, iar restul se pot importa din nou. Pentru retragere: „Anulează importul” pe lot (owner).</div>}
            <button style={{ ...S.btnS, marginTop:8 }} onClick={() => descarcaCsv(csvRaportUtilizatori(randuriRaport(rezultat.inainte.parsat, rezultat.planRaport, rezultat.dupa), { dupa: true }), numeFisierCsv(rezultat.cod, rezultat.versiune, 'dupa-scriere'))}>⬇ Raportul după scriere (CSV, cu ID-urile din BD)</button>
          </div>
        )}

        <div style={{ marginTop:12, borderTop:`1px solid ${G.border}`, paddingTop:10 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
            <div style={{ fontWeight:600, fontSize:13 }}>Loturile de import ale utilizatorilor</div>
            <button style={S.btnS} onClick={incarcaLoturi} disabled={loturiStare.lucru}>{loturiStare.lucru ? 'Încarc…' : (loturi ? '↻ Reîncarcă' : 'Arată loturile')}</button>
          </div>
          {loturiStare.eroare && <div style={{ fontSize:12.5, color:G.red, marginTop:6 }}>Nu am putut citi loturile: {loturiStare.eroare}</div>}
          {loturi && (loturi.length === 0 ? <Gol text="Niciun import de utilizatori pe acest proiect." /> : (
            <div style={{ marginTop:6 }}>
              {loturi.map(l => (
                <div key={l.id} data-lot={l.id} style={{ display:'flex', gap:10, padding:'5px 0', borderTop:`1px solid ${G.border}`, fontSize:12.5, flexWrap:'wrap', alignItems:'center' }}>
                  <span style={S.mono}>{String(l.created_at || '').slice(0, 16).replace('T', ' ')}</span>
                  <span>„{l.versiune_lista_tgz || '-'}” · stare <b>{l.stare}</b> · {fmtNum(l.detinatori_noi)} utilizatori · {fmtNum(l.diferente?.contacte_noi)} contacte</span>
                  <span style={{ color:G.muted }}>{fmtNum(l.diferente?.deja_detinatori?.length ?? 0)} deja · {fmtNum(l.diferente?.parcela_negasita?.length ?? 0)} negăsite · {fmtNum(l.diferente?.coliziuni?.length ?? 0)} coliziuni · {fmtNum(l.diferente?.schimbate_la_scriere?.length ?? 0)} schimbate la scriere · {fmtNum(l.diferente?.de_verificat_dupa_scriere?.length ?? 0)} de verificat · {fmtNum(l.diferente?.hg_neconfirmate?.length ?? 0)} HG neconfirmate{l.diferente?.anulari?.length ? ` · ${l.diferente.anulari.length} anulări` : ''}</span>
                  {l.eroare && <span style={{ color:G.red }}>{l.eroare}</span>}
                  {esteOwner && ((l.detinatori_noi ?? 0) > 0 || (l.diferente?.scrise?.length ?? 0) > 0) && <button style={S.btnD} onClick={() => pregatesteAnulareLot(l.id)} disabled={!!anulare?.lucru}>Anulează importul</button>}
                </div>
              ))}
              <div style={{ fontSize:12, color:G.muted, marginTop:4 }}>Ultimele 20 de loturi cu sursa {SURSA_UTILIZATORI} (toate stările). Loturile finalizate apar și în lista generală de mai sus.</div>
            </div>
          ))}
          {anulare && (
            <div data-sectiune="anulare" style={{ ...S.card, borderColor:G.red, marginTop:10 }}>
              <div style={{ fontWeight:700, marginBottom:6 }}>Anularea importului — lotul <span style={S.mono}>{anulare.lotId}</span></div>
              <div style={{ fontSize:12, color:G.muted, marginBottom:8 }}>Se marchează „șters” (ștergere logică, cu motiv, ca din Fișa parcelei) DOAR utilizatorii scriși de acest lot care nu au nicio urmă: convocare, răspuns, PV, plic, e-mail, și nu au fost modificați de un om după import. Ceilalți rămân și sunt listați. Nu se șterge nimic fizic.</div>
              {anulare.lucru === 'pregatire' && <div style={{ fontSize:12.5 }}>Verific ce se poate anula…</div>}
              {anulare.eroare && <div data-eroare="anulare" style={{ fontSize:12.5, color:G.red }}>{anulare.eroare}</div>}
              {anulare.pregatire && !anulare.rezultat && (<>
                <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:8 }}>
                  {statCard('Se pot anula', fmtNum(anulare.pregatire.anulabili.length), G.red)}
                  {statCard('Rămân (urme / modificați)', fmtNum(anulare.pregatire.raman.length), G.orange)}
                  {statCard('Deja anulați / șterși', fmtNum(anulare.pregatire.dejaAnulati.length))}
                  {statCard('În evidență, fără marcaj', fmtNum(anulare.pregatire.faraMarcaj.length))}
                </div>
                {anulare.pregatire.raman.length > 0 && (
                  <table style={{ borderCollapse:'collapse', marginBottom:8 }}>
                    <thead><tr>{['Rând', 'Parcelă', 'Nume', 'De ce rămâne'].map(k => <th key={k} style={S.th}>{k}</th>)}</tr></thead>
                    <tbody>{anulare.pregatire.raman.slice(0, MAX_LISTA).map(r => <tr key={r.id}><td style={S.td}>{r.rand ?? '-'}</td><td style={{ ...S.td, ...S.mono }}>{r.id_parcela || '-'}</td><td style={S.td}>{r.nume || '-'}</td><td style={{ ...S.td, fontSize:12 }}>{r.motive.join('; ')}</td></tr>)}</tbody>
                  </table>
                )}
                <Camp eticheta={`Motivul anulării (obligatoriu, minim ${MOTIV_MINIM} caractere)`}>
                  <textarea rows={2} value={anulare.motiv} onChange={e => { const v = e.target.value; setAnulare(a => (a ? { ...a, motiv: v } : a)) }} style={{ ...S.input, resize:'vertical' }} disabled={!!anulare.lucru} />
                </Camp>
                <div style={{ display:'flex', gap:8, marginTop:8, flexWrap:'wrap' }}>
                  <button style={S.btnS} onClick={() => descarcaCsv(csvAnulare(anulare.pregatire), `anulare-${String(proiect.cod || 'proiect')}-${anulare.lotId}-previzualizare.csv`.replace(/[^\w.-]+/g, '_'))}>⬇ Previzualizarea anulării (CSV)</button>
                  <div style={{ flex:1 }} />
                  <button style={S.btnS} onClick={() => { genAnulare.current++; setAnulare(null) }} disabled={anulare.lucru === 'anulare'}>Renunță</button>
                  <button style={S.btnD} onClick={executaAnulareLot} disabled={!!anulare.lucru || anulare.pregatire.anulabili.length === 0 || String(anulare.motiv || '').trim().length < MOTIV_MINIM}>{anulare.lucru === 'anulare' ? 'Anulez…' : `Anulează ${anulare.pregatire.anulabili.length} utilizatori`}</button>
                </div>
              </>)}
              {anulare.rezultat && (<>
                <div data-rezultat-anulare="1" style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:8 }}>
                  {statCard('Anulați acum', fmtNum(anulare.rezultat.anulati.length), G.green)}
                  {statCard('Rămân', fmtNum(anulare.rezultat.raman.length), anulare.rezultat.raman.length ? G.orange : G.text)}
                  {statCard('Necunoscut (reluați)', fmtNum(anulare.rezultat.necunoscute.length), anulare.rezultat.necunoscute.length ? G.red : G.text)}
                  {statCard('De verificat', fmtNum(anulare.rezultat.deVerificat.length), anulare.rezultat.deVerificat.length ? G.red : G.text)}
                </div>
                {anulare.rezultat.eroareLot && <div style={{ fontSize:12.5, color:G.red }}>Anularea nu a putut fi consemnată în lot ({anulare.rezultat.eroareLot}); rândurile anulate poartă oricum motivul cu id-ul lotului.</div>}
                {anulare.rezultat.eroareVerificare && <div style={{ fontSize:12.5, color:G.red }}>Verificarea de după anulare nu s-a putut face ({anulare.rezultat.eroareVerificare}).</div>}
                <div style={{ display:'flex', gap:8, marginTop:8 }}>
                  <button style={S.btnS} onClick={() => descarcaCsv(csvAnulare(anulare.rezultat), `anulare-${String(proiect.cod || 'proiect')}-${anulare.lotId}-rezultat.csv`.replace(/[^\w.-]+/g, '_'))}>⬇ Raportul anulării (CSV)</button>
                  <button style={S.btnS} onClick={() => pregatesteAnulareLot(anulare.lotId)}>↻ Verifică din nou / reia</button>
                </div>
              </>)}
            </div>
          )}
        </div>
      </>)}
    </div>
  )
}
