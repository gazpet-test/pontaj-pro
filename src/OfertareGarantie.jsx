// ════════════════════════════════════════════════════════════════
// OfertareGarantie.jsx — tab „🛡 Garanție de participare” pe fișa licitației (Răzvan, 07.09.2026)
// Flux: 1) cerere ofertă poliță → mail broker (edge fn ofertare-garantie-mail, actiune cerere) + salvat în ofertare_garantii
//       2) draft + decont încărcate → mail automat Marilena Tudorache + Mirela Popescu (actiune plata)
//       3) OP încărcat + „achitată” → mail responsabilului licitației (actiune achitata) → cere originalul
//       4) polița în original (nr + primă) → status original → KPI „Garanție participare” verde
//       + termen decalat față de cel din cerere → propune mailul de actualizare a perioadei (actiune actualizare)
// R7 (26.09.2026): valabilitatea se citește în zile SAU luni (luni calendaristice), din registrul de cerințe + rezumatul
//       din fișa licitației; fără valoare implicită (câmp gol + „completează manual”); durate contradictorii ⇒ câmp gol.
//       Avertizarea de decalare rămâne și după „original”: cererea de prelungire NU schimbă perioada afișată a poliței
//       (polița fizică acoperă perioada veche) până la „act adițional primit”; mail eșuat ⇒ revenire în BD.
//       Logica e în ofertareGarantieValabilitate.js (pură, testată).
// R7 propagare (26.09.2026): termenul mutat ⇒ evalueazaGarantie() recalculează cerința și dă semnalul de reverificare —
//       același în tab, pe KPI-ul „Garanție participare” și pe eticheta tab-ului (useSemnalGarantie, în fișa licitației).
//       Polița acoperă dovedit termenul nou ⇒ „✓ Acoperă — verificat” (fără act adițional, cu urmă în observații).
//       Pasul 4 ia perioada DIN POLIȚA FIZICĂ (precompletată cu perioada cerută) — o cerere nu devine prelungire emisă.
// ════════════════════════════════════════════════════════════════
import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase.js'
import { ziDepunere, calculeazaValabilitate, propuneActualizare, textDurata, zileIntre, MESAJ_NECITIT,
  faraMarcaje, liniePrelungireCeruta, trimiteActualizareSigur, patchActAditional,
  evalueazaGarantie, patchVerificatAcoperire, perioadaPolita, NIVEL_REVERIFICARE } from './ofertareGarantieValabilitate.js'

// cerințele din registru care pot conține valabilitatea (garanție / ofertă) — aceeași interogare în tab și în KPI
const qCerinteGarantie = licId => supabase.from('ofertare_cerinte').select('id, text_cerinta, stare, inlocuita_de, sursa_document_id, sursa_pagina')
  .eq('licitatie_id', licId).is('inlocuita_de', null).or('text_cerinta.ilike.%garan%particip%,text_cerinta.ilike.%valabil%').order('id').limit(300)
const qGarantie = (licId, cols = '*') => supabase.from('ofertare_garantii').select(cols).eq('licitatie_id', licId).neq('status', 'anulata').order('id', { ascending: false }).limit(1).maybeSingle()

// Semnalul garanției pentru fișa licitației (KPI + eticheta tab-ului): undefined = se încarcă, null = fără garanție,
// altfel rezultatul evalueazaGarantie(). Se recalculează la fiecare reîncărcare a licitației (obiect `l` nou),
// deci și după mutarea termenului de depunere sau după o acțiune din tab-ul 🛡 (onChanged → load).
export function useSemnalGarantie(l) {
  const [ev, setEv] = useState(undefined)
  useEffect(() => {
    let viu = true
    if (!l?.id || !l.garantie_status) { setEv(null); return }
    setEv(undefined)
    Promise.all([qGarantie(l.id, 'id, status, valabil_de, valabil_pana, valabil_zile, termen_la_cerere, observatii, polita_nr'), qCerinteGarantie(l.id)])
      .then(([{ data: gg, error: e1 }, { data: cc, error: e2 }]) => {
        if (!viu) return
        // eroare de citire ⇒ NU verde: semnal „de reverificat” cu motivul
        if (e1 || e2) return setEv({ reverificare: { da: true, nivel: 'de_verificat', motive: [`garanția nu s-a putut citi: ${(e1 || e2).message}`], acoperaVerificat: false } })
        setEv(gg ? evalueazaGarantie({ g: gg, termenDepunere: l.termen_depunere, fisa: l.garantie_participare, cerinte: cc || [] }) : null)
      })
      .catch(e => { if (viu) setEv({ reverificare: { da: true, nivel: 'de_verificat', motive: [`garanția nu s-a putut citi: ${e?.message || e}`], acoperaVerificat: false } }) })
    return () => { viu = false }
  }, [l])
  return ev
}

const G = { bg:'#0D1117', surface:'#161B22', card:'#1C2128', border:'#30363D', border2:'#21262D', text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  ofertare:'#3FB6E2', green:'#3FB950', blue:'#58A6FF', orange:'#F0883E', yellow:'#E3B341', red:'#F85149' }
const S = {
  input: { width:'100%', boxSizing:'border-box', background:G.bg, border:`1px solid ${G.border2}`, borderRadius:6, padding:'8px 12px', color:G.text, fontSize:13, outline:'none' },
  lbl: { display:'block', fontSize:11, color:G.muted, marginBottom:4, fontWeight:600, textTransform:'uppercase', letterSpacing:'.3px' },
  btnP: { padding:'9px 18px', background:G.ofertare, color:'#0D1117', border:'none', borderRadius:7, cursor:'pointer', fontSize:13, fontWeight:700 },
  btnS: { padding:'9px 18px', background:G.surface, color:G.text, border:`1px solid ${G.border2}`, borderRadius:7, cursor:'pointer', fontSize:13 },
  card: { background:G.card, border:`1px solid ${G.border}`, borderRadius:10 },
}
const PASI = [
  ['cerere_trimisa', '📨 Cerere trimisă brokerului'],
  ['draft_primit',   '📄 Draft + decont → la plată'],
  ['achitata',       '💳 Achitată (OP)'],
  ['original',       '🛡 Poliță în original'],
]
const fmtZi = d => d ? new Date(d.length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('ro-RO') : '—'
const fmtLei = (v, m = 'RON') => v == null || v === '' ? '—' : `${Number(v).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${m}`
// durata din formular ({ valN, valU }) → { n, unitate } sau null dacă nu e completată
const durataDin = (n, unitate) => Number(n) > 0 && Number.isInteger(Number(n)) ? { n: Number(n), unitate } : null
const numar = s => { const m = String(s || '').replace(/\./g, '').replace(',', '.').match(/\d+(\.\d+)?/); return m ? Number(m[0]) : '' }

export default function GarantieSection({ licitatie: l, profile, onChanged }) {
  const [g, setG] = useState(undefined)         // undefined = se încarcă, null = nu există
  const [brokeri, setBrokeri] = useState([])
  const [docs, setDocs] = useState([])
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)          // { tip:'ok'|'err', text }
  const [form, setForm] = useState(null)        // formularul cererii (pasul 1)
  const [f2, setF2] = useState({ decont_valoare: '' })
  const [f4, setF4] = useState({ polita_nr: '', polita_prima: '', de: '', pana: '' })
  const [cerinte, setCerinte] = useState([])    // cerințele din registru care pot conține valabilitatea (garanție / ofertă)
  const [actEdit, setActEdit] = useState(null)  // durata editată în bannerul de decalare ({ n, unitate }); null = propunerea
  const [actAd, setActAd] = useState(null)      // „act adițional primit”: { de, pana } editate; null = perioada cerută

  const load = async () => {
    const [{ data: gg }, { data: bb }, { data: dd }, { data: cc }] = await Promise.all([
      qGarantie(l.id, '*, broker:ofertare_brokeri(id, nume, email, contact)'),
      supabase.from('ofertare_brokeri').select('*').eq('activ', true).order('implicit', { ascending: false }).order('nume'),
      supabase.from('ofertare_documente_atribuire').select('id, nume_original, tip, fisier_path, size_bytes').eq('licitatie_id', l.id).in('tip', ['fisa_date', 'raspuns_clarificare', 'model_contract']).order('tip'),
      qCerinteGarantie(l.id),
    ])
    setG(gg || null); setBrokeri(bb || []); setDocs(dd || []); setCerinte(cc || []); setActEdit(null); setActAd(null)
    if (gg) setF2(x => ({ ...x, decont_valoare: gg.decont_valoare ?? '' }))
    // pasul 4: perioada din polița fizică, precompletată cu perioada cerută (omul o confirmă / corectează)
    if (gg) setF4(x => ({ ...x, de: gg.valabil_de || '', pana: gg.valabil_pana || '' }))
  }
  useEffect(() => { load() }, [l.id])

  // valabilitatea cerută: registrul de cerințe + rezumatul din fișa licitației (fără valoare implicită), pe termenul CURENT;
  // aceeași evaluare ca pe KPI (evalueazaGarantie): cerința, ce acoperă polița, semnalul de reverificare
  const ev = evalueazaGarantie({ g, termenDepunere: l.termen_depunere, fisa: l.garantie_participare, cerinte })
  const { deAcum, propunere, necesar } = ev

  // ── pasul 1: formularul cererii (valoare din fișă, valabilitatea din fișă/registru, text după modelul Cristinei)
  const pregateste = () => {
    const brokerId = brokeri.find(b => b.implicit)?.id || brokeri[0]?.id || ''
    const fisa = docs.filter(d => d.tip === 'fisa_date').map(d => d.id)
    const fm = { broker_id: brokerId, valoare: numar(l.garantie_participare), moneda: l.moneda || 'RON',
      valN: propunere.durata?.n ?? '', valU: propunere.durata?.unitate || 'luni', docs: fisa, text: '' }
    fm.text = textCerere(fm)
    setForm(fm)
  }
  const textCerere = (fm) => {
    const dur = durataDin(fm.valN, fm.valU)
    const calc = dur ? calculeazaValabilitate(dur, deAcum) : null
    const perioada = dur
      ? `${textDurata(dur)} de la data limită stabilită pentru depunerea ofertelor${calc?.pana ? `: ${fmtZi(deAcum)} – ${fmtZi(calc.pana)}` : ''}`
      : '[DE COMPLETAT — valabilitatea nu a putut fi citită din cerință]'
    return `Bună ziua,

Vă rugăm să ne transmiteți oferta dvs. pentru Polița de asigurare de garanție de participare, în vederea participării la următoarea procedură:

- Anunț nr. ${l.nr_anunt}${l.link_seap ? ` (${l.link_seap})` : ''} — „${l.obiect}”
- Autoritatea contractantă: ${l.autoritate}
- Valoarea garanției de participare: ${fmtLei(fm.valoare, fm.moneda)}
- Perioada de valabilitate a garanției: ${perioada}
- Termen de depunere a ofertei: ${l.termen_depunere ? new Date(l.termen_depunere).toLocaleString('ro-RO', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
- Garanția va fi constituită în numele GAZPET INSTAL SRL.
- Atașat: fișa de date a achiziției${fm.docs.length > 1 ? ' și documentele aferente' : ''}.
- Instrumentul de garantare va fi emis conform cerințelor din Fișa de date a achiziției (secțiunea „Garanția de participare”).
- Garanția de participare trebuie să fie irevocabilă și să prevadă în mod expres că plata sumei se va face necondiționat, la prima cerere scrisă a autorității contractante, fără ca aceasta să aibă obligația de a-și motiva cererea, în oricare dintre situațiile: a) ofertantul își retrage oferta în perioada de valabilitate a acesteia; b) oferta sa fiind stabilită câștigătoare, nu constituie garanția de bună execuție în perioada stabilită prin contract; c) oferta sa fiind stabilită câștigătoare, refuză să semneze contractul de achiziție în perioada de valabilitate a ofertei.
- La depunerea ofertei polița trebuie prezentată în original.

Vă rugăm să ne transmiteți draftul poliței și decontul pentru plata primei de asigurare.

Vă mulțumim.`
  }
  const setF = (k, v) => setForm(fm => { const n = { ...fm, [k]: v }; if (k !== 'text') n.text = textCerere(n); return n })

  const trimiteCerere = async () => {
    if (!form.broker_id) return setMsg({ tip: 'err', text: 'Alege brokerul.' })
    const dur = durataDin(form.valN, form.valU)
    if (!dur) return setMsg({ tip: 'err', text: MESAJ_NECITIT })
    if (/\[DE COMPLETAT/.test(form.text)) return setMsg({ tip: 'err', text: 'Textul cererii are încă „[DE COMPLETAT…]” — reface-l din câmpuri sau corectează-l manual.' })
    setBusy('Se salvează și se trimite cererea…'); setMsg(null)
    const de = deAcum
    const calc = calculeazaValabilitate(dur, de)
    const atas = docs.filter(d => form.docs.includes(d.id)).map(d => ({ path: d.fisier_path, nume: d.nume_original }))
    const { data: ins, error } = await supabase.from('ofertare_garantii').insert({
      licitatie_id: l.id, broker_id: form.broker_id, valoare: form.valoare || null, moneda: form.moneda, valabil_zile: calc?.zile ?? null,
      valabil_de: de, valabil_pana: calc?.pana ?? null, termen_la_cerere: l.termen_depunere || null,
      cerere_text: form.text, cerere_atasamente: atas, status: 'cerere_trimisa',
    }).select('id').single()
    if (error) { setBusy(null); return setMsg({ tip: 'err', text: error.message }) }
    const { data, error: e2 } = await supabase.functions.invoke('ofertare-garantie-mail', { body: { actiune: 'cerere', garantie_id: ins.id } })
    setBusy(null)
    if (e2 || data?.error) { setMsg({ tip: 'err', text: 'Cererea e salvată, dar mailul nu a plecat: ' + (data?.error || e2?.message) }) }
    else setMsg({ tip: 'ok', text: `✓ Cererea a plecat la broker (${data.atasate} atașamente${data.sarite?.length ? `, sărite: ${data.sarite.join(', ')}` : ''}).` })
    setForm(null); await load(); onChanged?.()
  }

  // ── încărcare fișiere în bucketul ofertare
  const urca = async (file, eticheta) => {
    const path = `${l.id}/garantie/${Date.now()}_${eticheta}_${file.name.replace(/[^\w.\-]+/g, '_')}`
    const { error } = await supabase.storage.from('ofertare').upload(path, file)
    if (error) throw new Error(error.message)
    return path
  }
  const deschide = async (path) => {
    const { data } = await supabase.storage.from('ofertare').createSignedUrl(path, 600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }
  const patch = async (p) => { const { error } = await supabase.from('ofertare_garantii').update({ ...p, updated_at: new Date().toISOString() }).eq('id', g.id); if (error) throw new Error(error.message) }
  const mail = async (actiune) => { const { data, error } = await supabase.functions.invoke('ofertare-garantie-mail', { body: { actiune, garantie_id: g.id } }); if (error || data?.error) throw new Error(data?.error || error?.message); return data }

  // pasul 2: draft + decont → status draft_primit → mail plată
  const [fDraft, setFDraft] = useState(null); const [fDecont, setFDecont] = useState(null)
  const salveazaDraft = async () => {
    if (!fDraft && !g.draft_path) return setMsg({ tip: 'err', text: 'Încarcă draftul poliței (PDF).' })
    if (f2.decont_valoare === '' || isNaN(Number(f2.decont_valoare))) return setMsg({ tip: 'err', text: 'Completează valoarea decontului (prima de plătit).' })
    try {
      setBusy('Se încarcă draftul și se anunță plata…'); setMsg(null)
      const p = { decont_valoare: Number(f2.decont_valoare), status: 'draft_primit', draft_la: new Date().toISOString(), draft_de: profile?.id || null }
      if (fDraft) p.draft_path = await urca(fDraft, 'draft')
      if (fDecont) p.decont_path = await urca(fDecont, 'decont')
      await patch(p)
      const r = await mail('plata')
      setMsg({ tip: 'ok', text: `✓ Draftul e în platformă. Marilena și Mirela Popescu au primit mailul de plată (${r.atasate} atașamente).` })
      setFDraft(null); setFDecont(null); await load(); onChanged?.()
    } catch (e) { setMsg({ tip: 'err', text: e.message }) }
    setBusy(null)
  }
  // pasul 3: OP + achitată → mail responsabil
  const [fOp, setFOp] = useState(null)
  const marcheazaAchitata = async () => {
    if (!fOp && !g.op_path) return setMsg({ tip: 'err', text: 'Încarcă OP-ul (dovada plății).' })
    try {
      setBusy('Se înregistrează plata…'); setMsg(null)
      const p = { status: 'achitata', achitata_la: new Date().toISOString(), achitata_de: profile?.id || null }
      if (fOp) p.op_path = await urca(fOp, 'op')
      await patch(p)
      const r = await mail('achitata')
      setMsg({ tip: 'ok', text: `✓ Plata e înregistrată. Responsabilul (${(r.catre || []).join(', ')}) a fost anunțat să ceară originalul.` })
      setFOp(null); await load(); onChanged?.()
    } catch (e) { setMsg({ tip: 'err', text: e.message }) }
    setBusy(null)
  }
  // pasul 4: polița în original
  const [fPol, setFPol] = useState(null)
  const salveazaOriginal = async () => {
    if (!fPol) return setMsg({ tip: 'err', text: 'Încarcă polița originală scanată (PDF).' })
    if (!f4.polita_nr.trim()) return setMsg({ tip: 'err', text: 'Completează numărul poliței.' })
    // perioada DIN POLIȚĂ (nu cea doar cerută brokerului): o cerere de actualizare nu devine prelungire emisă
    const per = perioadaPolita(f4.de, f4.pana)
    if (!per) return setMsg({ tip: 'err', text: 'Completează perioada de valabilitate scrisă pe polița fizică (data de sfârșit după data de început).' })
    const scurt = [necesar?.pana && per.valabil_pana < necesar.pana ? `se termină pe ${fmtZi(per.valabil_pana)}, cerința cere până la ${fmtZi(necesar.pana)}` : null,
      deAcum && per.valabil_de > deAcum ? `începe pe ${fmtZi(per.valabil_de)}, după ziua depunerii (${fmtZi(deAcum)})` : null].filter(Boolean)
    if (scurt.length && !confirm(`⚠ Polița nu acoperă cerința: ${scurt.join('; ')}.\n\nSalvezi totuși polița cu perioada ei reală? (semnalul de reverificare rămâne)`)) return
    try {
      setBusy('Se salvează polița…'); setMsg(null)
      const p = { status: 'original', original_la: new Date().toISOString(), original_de: profile?.id || null, polita_nr: f4.polita_nr.trim(), polita_prima: f4.polita_prima !== '' ? Number(f4.polita_prima) : g.decont_valoare, ...per }
      p.polita_path = await urca(fPol, 'polita')
      await patch(p)
      setMsg({ tip: 'ok', text: scurt.length ? `✓ Polița în original e în platformă, cu perioada ei reală — indicatorul „Garanție participare” rămâne „⚠ nu acoperă termenul” (${scurt.join('; ')}).` : '✓ Polița în original e în platformă — indicatorul „Garanție participare” devine verde.' })
      setFPol(null); await load(); onChanged?.()
    } catch (e) { setMsg({ tip: 'err', text: e.message }) }
    setBusy(null)
  }
  // termen decalat → actualizare perioadă la broker. Rămâne vizibil și după „original”: polița emisă
  // acoperă perioada veche, deci trebuie prelungită (act adițional) — altfel verdele de pe KPI minte.
  // stareGarantie: ce acoperă EFECTIV polița (nu perioada doar cerută), decalare, prelungire în așteptare, insuficiență
  const st = ev.st, rev = ev.reverificare
  const decalat = !!st?.decalat, insuficient = !!st?.insuficient, nuAcopera = rev.nivel === 'nu_acopera'
  // durata propusă pe termenul nou: cerința citibilă, SINGURĂ; durata cererii anterioare doar ca rezervă
  const propAct = g ? propuneActualizare(propunere, g.valabil_zile) : null
  const actDur = actEdit ? durataDin(actEdit.n, actEdit.unitate) : propAct?.durata || null
  const actCalc = actDur && deAcum ? calculeazaValabilitate(actDur, deAcum) : null
  const brokerTxt = g?.broker?.email ? ` (${g.broker.email})` : ''
  const trimiteActualizare = async (retrimite) => {
    const original = g.status === 'original'
    // retrimiterea unei prelungiri în așteptare folosește perioada deja cerută; altfel propunerea din banner
    const de = retrimite ? st.prelungireCurenta.de : deAcum
    const pana = retrimite ? st.prelungireCurenta.pana : actCalc?.pana
    const dur = retrimite ? null : actDur
    if (!de || !pana) return setMsg({ tip: 'err', text: MESAJ_NECITIT })
    const perioada = `${fmtZi(de)} – ${fmtZi(pana)}${dur ? ` (${textDurata(dur)})` : ''}`
    // mailul automat (edge fn „actualizare”) spune doar: termen decalat + perioada nouă + „draftul poliței actualizat și decontul”
    const ceSpuneMailul = `Mailul automat către broker${brokerTxt} spune că termenul de depunere a fost decalat la ${fmtZi(l.termen_depunere)} și că perioada de valabilitate a poliței va fi ${perioada}, și cere draftul poliței actualizat și decontul.`
    const intrebare = original
      ? `Polița nr. ${g.polita_nr || '—'} e deja emisă în original pentru ${fmtZi(st.acoperaDe)} – ${fmtZi(st.acoperaPana)}.\n\n${ceSpuneMailul}\nMailul NU menționează nr. poliței și nici „act adițional” — completează în răspunsul la mail, dacă brokerul are nevoie.\n\nPână marchezi „act adițional primit”, platforma arată în continuare perioada reală a poliței (${fmtZi(st.acoperaDe)} – ${fmtZi(st.acoperaPana)}).\n\nTrimiți?`
      : `${ceSpuneMailul}\n\nTrimiți?`
    if (!confirm(intrebare)) return
    try {
      setBusy('Se trimite perioada nouă brokerului…'); setMsg(null)
      const cerut = { valabil_de: de, valabil_pana: pana, valabil_zile: zileIntre(de, pana), termen_la_cerere: l.termen_depunere }
      const linieObs = original ? liniePrelungireCeruta({ azi: ziDepunere(new Date().toISOString()), termenVechi: ziDepunere(g.termen_la_cerere), termenNou: deAcum,
        polita: g.polita_nr, acDe: st.acoperaDe, acPana: st.acoperaPana, de, pana, durata: dur }) : null
      const r = await trimiteActualizareSigur({ g, cerut, original, linieObs, patch, mail: () => mail('actualizare') })
      if (!r.mail) setMsg({ tip: 'err', text: r.revenire
        ? `Mailul NU a plecat (${r.eroare}) — perioada din fișă a revenit la cea anterioară; nimic nu s-a schimbat.`
        : `Mailul NU a plecat (${r.eroare}) și revenirea în BD a eșuat (${r.eroareRevenire}) — în fișă a rămas perioada ${perioada}, dar NU a fost trimisă. ${original ? `Polița acoperă de fapt ${fmtZi(st.acoperaDe)} – ${fmtZi(st.acoperaPana)}. ` : ''}Reîncarcă pagina și verifică.` })
      else if (original) setMsg(r.revenire
        ? { tip: 'ok', text: `✓ Brokerul a primit perioada nouă (${perioada}). Polița rămâne afișată cu perioada ei reală până marchezi „act adițional primit”.` }
        : { tip: 'err', text: `Mailul a plecat, dar revenirea la perioada reală a poliței nu s-a salvat (${r.eroareRevenire}). Evidența prelungirii e în observații; polița acoperă ${fmtZi(st.acoperaDe)} – ${fmtZi(st.acoperaPana)}.` })
      else setMsg({ tip: 'ok', text: `✓ Brokerul a primit perioada nouă de valabilitate (${perioada}).` })
      await load(); onChanged?.()   // KPI-ul și eticheta tab-ului se recalculează (useSemnalGarantie)
    } catch (e) { setMsg({ tip: 'err', text: 'Nu s-a salvat nimic: ' + e.message }) }
    setBusy(null)
  }
  // „act adițional primit”: perioada confirmată de broker devine perioada poliței
  const actAdDe = actAd?.de ?? st?.prelungireCurenta?.de ?? '', actAdPana = actAd?.pana ?? st?.prelungireCurenta?.pana ?? ''
  const confirmaActAditional = async () => {
    const p = patchActAditional({ g, de: actAdDe, pana: actAdPana, termenDepunere: l.termen_depunere, azi: ziDepunere(new Date().toISOString()) })
    if (!p) return setMsg({ tip: 'err', text: 'Completează perioada din actul adițional (data de sfârșit după data de început).' })
    const scurt = necesar?.pana && actAdPana < necesar.pana ? `\n\n⚠ Actul adițional acoperă mai puțin decât cerința (până la ${fmtZi(necesar.pana)}).` : ''
    if (!confirm(`Confirmi că ai primit actul adițional la polița nr. ${g.polita_nr || '—'}, care o face valabilă ${fmtZi(actAdDe)} – ${fmtZi(actAdPana)}?${scurt}`)) return
    try {
      setBusy('Se salvează actul adițional…'); setMsg(null)
      await patch(p)
      setMsg({ tip: 'ok', text: `✓ Polița nr. ${g.polita_nr || '—'} e acum valabilă ${fmtZi(actAdDe)} – ${fmtZi(actAdPana)} (act adițional).` })
      await load(); onChanged?.()
    } catch (e) { setMsg({ tip: 'err', text: e.message }) }
    setBusy(null)
  }
  // termen mutat, dar polița acoperă DOVEDIT noul termen + valabilitatea cerută ⇒ omul confirmă verificarea;
  // perioada poliței NU se schimbă (doar termenul de referință + urmă în observații)
  const confirmaVerificat = async () => {
    const p = patchVerificatAcoperire({ g, ev, termenDepunere: l.termen_depunere, azi: ziDepunere(new Date().toISOString()) })
    if (!p) return setMsg({ tip: 'err', text: 'Acoperirea nu e dovedită (cerința necitită, poliță mai scurtă sau care începe după depunere) — cere prelungirea la broker.' })
    if (!confirm(`Ai verificat că polița${g.polita_nr ? ` nr. ${g.polita_nr}` : ''} (${fmtZi(st.acoperaDe)} – ${fmtZi(st.acoperaPana)}) acoperă noul termen de depunere (${fmtZi(deAcum)}) și valabilitatea cerută (până la ${fmtZi(necesar.pana)}), fără act adițional?\n\nPerioada poliței NU se modifică; se notează verificarea în observații.`)) return
    try {
      setBusy('Se salvează verificarea…'); setMsg(null)
      await patch(p)
      setMsg({ tip: 'ok', text: `✓ Verificat: polița acoperă termenul ${fmtZi(deAcum)} și cerința (până la ${fmtZi(necesar.pana)}).` })
      await load(); onChanged?.()
    } catch (e) { setMsg({ tip: 'err', text: e.message }) }
    setBusy(null)
  }
  const anuleaza = async () => {
    if (!confirm('Anulezi această garanție? (rămâne în istoric, poți porni una nouă)')) return
    await patch({ status: 'anulata' }); await load(); onChanged?.()
  }

  const idx = g ? PASI.findIndex(p => p[0] === g.status) : -1
  const Fisier = ({ path, eticheta }) => path ? <button style={{ ...S.btnS, padding:'3px 10px', fontSize:11.5 }} onClick={() => deschide(path)}>📎 {eticheta}</button> : null
  const Lbl = ({ children }) => <label style={S.lbl}>{children}</label>

  return (
    <div style={{ ...S.card, padding:'16px 18px', background:G.surface }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', marginBottom:12 }}>
        <div style={{ fontSize:15, fontWeight:800 }}>🛡 Garanție de participare</div>
        <span style={{ fontSize:13, color:G.muted }}>cerută în fișa de date: <b style={{ color:G.text }}>{l.garantie_participare || '—'}</b></span>
        {g && <span style={{ marginLeft:'auto', fontSize:12, color: st?.inAsteptare ? G.orange : G.dim }}>{g.broker?.nume}{st?.antet ? ` · ${st.antet}` : ''}</span>}
      </div>
      {msg && <div style={{ fontSize:12.5, color: msg.tip === 'err' ? G.red : G.green, marginBottom:10, padding:'8px 10px', background:G.card, borderRadius:7 }}>{msg.text}</div>}
      {busy && <div style={{ fontSize:12.5, color:G.ofertare, fontWeight:700, marginBottom:10 }}>⏳ {busy}</div>}

      {g === undefined ? <div style={{ color:G.muted, fontSize:12 }}>Se încarcă…</div> : (
        <>
          {/* pași */}
          {g && (
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:6, marginBottom:14 }}>
              {PASI.map(([k, lbl], i) => (
                <div key={k} style={{ padding:'8px 10px', borderRadius:8, fontSize:12, fontWeight:700, textAlign:'center',
                  background: i < idx ? G.green + '22' : i === idx ? G.ofertare + '22' : G.card,
                  color: i < idx ? G.green : i === idx ? G.ofertare : G.dim, border:`1px solid ${i <= idx ? (i === idx ? G.ofertare : G.green) + '55' : G.border2}` }}>{i < idx ? '✓ ' : ''}{lbl}</div>
              ))}
            </div>
          )}
          {/* polița în original + prelungire cerută pentru termenul curent: în așteptare până la actul adițional */}
          {st?.prelungireCurenta && (
            <div style={{ background:G.orange + '18', border:`1px solid ${G.orange}66`, borderRadius:8, padding:'10px 12px', marginBottom:12, fontSize:12.5, display:'flex', flexDirection:'column', gap:8 }}>
              <span>⏳ Prelungire cerută brokerului{g.actualizare_trimisa_la ? ` pe ${fmtZi(g.actualizare_trimisa_la)}` : ''} la <b>{fmtZi(st.prelungireCurenta.de)} – {fmtZi(st.prelungireCurenta.pana)}</b> — <b>neconfirmată</b>.
                {' '}Până la actul adițional, polița nr. <b>{g.polita_nr || '—'}</b> acoperă doar <b>{fmtZi(st.acoperaDe)} – {fmtZi(st.acoperaPana)}</b>{insuficient ? <>, iar cerința cere până la <b>{fmtZi(necesar.pana)}</b></> : null}.</span>
              <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                <span style={{ color:G.muted }}>Act adițional — valabilă de la</span>
                <input style={{ ...S.input, width:150, padding:'5px 8px' }} type="date" value={actAdDe} onChange={e => setActAd({ de: e.target.value, pana: actAdPana })} />
                <span style={{ color:G.muted }}>până la</span>
                <input style={{ ...S.input, width:150, padding:'5px 8px' }} type="date" value={actAdPana} onChange={e => setActAd({ de: actAdDe, pana: e.target.value })} />
                {zileIntre(actAdDe, actAdPana) > 0 && <span style={{ color:G.dim }}>({zileIntre(actAdDe, actAdPana)} zile)</span>}
                <button style={{ ...S.btnS, marginLeft:'auto', padding:'6px 12px', fontSize:12 }} disabled={!!busy} onClick={() => trimiteActualizare(true)}>↻ Retrimite cererea</button>
                <button style={{ ...S.btnP, background:G.green, padding:'6px 12px', fontSize:12 }} disabled={!!busy || !(zileIntre(actAdDe, actAdPana) > 0)} onClick={confirmaActAditional}>✓ Act adițional primit</button>
              </div>
              {necesar?.pana && actAdPana && actAdPana < necesar.pana && <span style={{ color:G.red }}>⚠ Perioada din actul adițional e mai scurtă decât cerința (până la {fmtZi(necesar.pana)}).</span>}
            </div>
          )}
          {!st?.prelungireCurenta && decalat && (
            <div style={{ background:(nuAcopera ? G.red : G.orange) + '18', border:`1px solid ${nuAcopera ? G.red : G.orange}66`, borderRadius:8, padding:'10px 12px', marginBottom:12, fontSize:12.5, display:'flex', flexDirection:'column', gap:8 }}>
              {/* semnalul de reverificare: cerința recalculată pe termenul nou; polița emisă își păstrează perioada din poliță */}
              <span>⚠️ Termenul de depunere s-a decalat ({fmtZi(g.termen_la_cerere)} → <b>{fmtZi(l.termen_depunere)}</b>) — <b>garanția e de reverificat</b>: {g.status === 'original'
                ? <>polița nr. <b>{g.polita_nr || '—'}</b> e deja în original pentru {fmtZi(st.acoperaDe)} – {fmtZi(st.acoperaPana)}{nuAcopera
                  ? <>{necesar?.pana ? <>, iar cerința pe termenul nou cere până la <b>{fmtZi(necesar.pana)}</b></> : null}: trebuie <b>prelungită</b> la broker (act adițional).</>
                  : rev.acoperaVerificat ? <> și acoperă totuși noul termen și cerința (până la <b>{fmtZi(necesar.pana)}</b>) — verifică și marchează, sau cere prelungirea.</>
                  : <>; valabilitatea cerută pe termenul nou nu a putut fi calculată — verifică manual acoperirea.</>}</>
                : nuAcopera ? <>perioada de valabilitate a poliței trebuie actualizată la broker{necesar?.pana ? <> (cerința cere până la <b>{fmtZi(necesar.pana)}</b>)</> : null}.</>
                : rev.acoperaVerificat ? <>perioada cerută ({fmtZi(st.acoperaDe)} – {fmtZi(st.acoperaPana)}) acoperă totuși noul termen și cerința (până la <b>{fmtZi(necesar.pana)}</b>) — verifică și marchează, sau actualizează la broker.</>
                : <>valabilitatea cerută pe termenul nou nu a putut fi calculată — verifică manual perioada poliței.</>}</span>
              {rev.motive.length > 0 && <span style={{ color:G.muted }}>De ce: {rev.motive.join('; ')}.</span>}
              {rev.acoperaVerificat && !st.inAsteptare && <div><button style={{ ...S.btnS, padding:'6px 12px', fontSize:12, color:G.green, borderColor:G.green + '66' }} disabled={!!busy} onClick={confirmaVerificat}>
                ✓ Acoperă noul termen — marchează verificat (fără act adițional)</button></div>}
              {st.prelungireVeche && <span style={{ color:G.muted }}>Cererea de prelungire anterioară ({fmtZi(st.prelungireVeche.de)} – {fmtZi(st.prelungireVeche.pana)}) era pentru alt termen și nu mai acoperă termenul curent.</span>}
              <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                <span style={{ color:G.muted }}>Valabilitate nouă:</span>
                <input style={{ ...S.input, width:80, padding:'5px 8px' }} type="number" min="1" step="1" value={actEdit ? actEdit.n : (propAct?.durata.n ?? '')}
                  onChange={e => setActEdit({ n: e.target.value, unitate: actEdit?.unitate || propAct?.durata.unitate || 'luni' })} />
                <select style={{ ...S.input, width:90, padding:'5px 8px' }} value={actEdit ? actEdit.unitate : (propAct?.durata.unitate || 'luni')}
                  onChange={e => setActEdit({ n: actEdit ? actEdit.n : (propAct?.durata.n ?? ''), unitate: e.target.value })}><option value="luni">luni</option><option value="zile">zile</option></select>
                {actCalc?.pana
                  ? <span>→ <b>{fmtZi(deAcum)} – {fmtZi(actCalc.pana)}</b> ({actCalc.zile} zile){!actEdit && propAct ? <span style={{ color: propAct.rezerva ? G.orange : G.dim }}> · după {propAct.eticheta}</span> : null}</span>
                  : <span style={{ color:G.red, fontWeight:700 }}>{MESAJ_NECITIT}</span>}
                <button style={{ ...S.btnP, marginLeft:'auto', padding:'6px 12px', fontSize:12 }} disabled={!!busy || !actCalc?.pana} onClick={() => trimiteActualizare(false)}>
                  📨 Trimite brokerului perioada nouă</button>
              </div>
              {!actEdit && propAct && !propAct.rezerva && g.valabil_zile ? <span style={{ color:G.dim }}>Cererea anterioară: {g.valabil_zile} zile de la {fmtZi(g.termen_la_cerere)} — nu se copiază; durata se recalculează din cerință pe termenul nou.</span> : null}
              {g.status === 'original' && <span style={{ color:G.muted }}>Mailul automat transmite doar perioada nouă (nu menționează nr. poliței și nici „act adițional”); polița rămâne afișată cu perioada ei reală până marchezi „act adițional primit”.</span>}
              {necesar?.pana && actCalc?.pana && actCalc.pana < necesar.pana && (
                <span style={{ color:G.red }}>⚠ Mai scurtă decât cerința ({textDurata(propunere.durata)} de la {fmtZi(deAcum)} → {fmtZi(necesar.pana)}).</span>
              )}
            </div>
          )}
          {!st?.prelungireCurenta && !decalat && (insuficient || st?.incepeDupaTermen) && (
            <div style={{ background:G.red + '14', border:`1px solid ${G.red}66`, borderRadius:8, padding:'10px 12px', marginBottom:12, fontSize:12.5 }}>
              {insuficient
                ? <>⚠️ Polița {g.status === 'original' ? `nr. ${g.polita_nr || '—'} ` : ''}e valabilă doar până la <b>{fmtZi(st.acoperaPana)}</b>, dar cerința ({textDurata(propunere.durata)} de la {fmtZi(deAcum)}) cere până la <b>{fmtZi(necesar.pana)}</b>.</>
                : <>⚠️ Polița {g.status === 'original' ? `nr. ${g.polita_nr || '—'} ` : ''}începe abia pe <b>{fmtZi(st.acoperaDe)}</b>, după ziua depunerii (<b>{fmtZi(deAcum)}</b>).</>}
              <span style={{ color:G.muted }}>{propunere.sursa ? ` Sursa: ${propunere.sursa.eticheta} — „${propunere.sursa.fragment}” ·` : ''} verifică polița și cere brokerului corectarea perioadei.</span>
            </div>
          )}

          {/* pasul 1 — fără garanție: formular cerere */}
          {!g && !form && (
            <div style={{ fontSize:12.5, color:G.muted }}>
              Nicio cerere de poliță încă. Platforma pregătește mailul către broker după modelul folosit de Cristina (valoare, perioadă de valabilitate, condițiile de irevocabilitate, fișa de date atașată).
              <div style={{ marginTop:10 }}><button style={S.btnP} onClick={pregateste}>📨 Cere ofertă poliță</button></div>
            </div>
          )}
          {!g && form && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <div><Lbl>Broker</Lbl>
                <select style={S.input} value={form.broker_id} onChange={e => setF('broker_id', Number(e.target.value))}>
                  {brokeri.map(b => <option key={b.id} value={b.id}>{b.nume} — {b.email}{b.contact ? ` (${b.contact})` : ''}</option>)}
                </select></div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 90px 1fr', gap:8 }}>
                <div><Lbl>Valoare garanție</Lbl><input style={S.input} type="number" value={form.valoare} onChange={e => setF('valoare', e.target.value)} /></div>
                <div><Lbl>Monedă</Lbl><select style={S.input} value={form.moneda} onChange={e => setF('moneda', e.target.value)}><option>RON</option><option>EUR</option></select></div>
                <div><Lbl>Valabilitate</Lbl>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 76px', gap:6 }}>
                    <input style={{ ...S.input, borderColor: durataDin(form.valN, form.valU) ? G.border2 : G.red }} type="number" min="1" step="1" value={form.valN} placeholder="—"
                      onChange={e => setF('valN', e.target.value)} title="citită din registrul de cerințe / rezumatul din fișa licitației; fără valoare implicită" />
                    <select style={S.input} value={form.valU} onChange={e => setF('valU', e.target.value)}><option value="luni">luni</option><option value="zile">zile</option></select>
                  </div></div>
              </div>
              <div style={{ gridColumn:'1 / -1', fontSize:12, lineHeight:1.5 }}>
                {(() => {
                  const dur = durataDin(form.valN, form.valU)
                  const calc = dur ? calculeazaValabilitate(dur, deAcum) : null
                  return <>
                    {!dur && <div style={{ color:G.red, fontWeight:700 }}>⚠ {propunere.durata ? 'Completează valabilitatea garanției.' : propunere.motiv || MESAJ_NECITIT}</div>}
                    {propunere.conflict && <div style={{ color:G.orange }}>Variante găsite:{' '}
                      {propunere.alte.map((a, i) => <span key={i} style={{ display:'inline-flex', gap:6, alignItems:'center', marginRight:10 }}>
                        <b>{textDurata(a)}</b>{a.pana ? ` (→ ${fmtZi(a.pana)})` : ''} în {a.eticheta} — „{a.fragment}”
                        <button style={{ ...S.btnS, padding:'1px 8px', fontSize:11 }} onClick={() => setForm(fm => { const n = { ...fm, valN: a.n, valU: a.unitate }; n.text = textCerere(n); return n })}>folosește</button></span>)}
                    </div>}
                    {calc?.pana && <div>→ garanția valabilă <b>{fmtZi(deAcum)} – {fmtZi(calc.pana)}</b> ({calc.zile} zile{dur.unitate === 'luni' ? `, ${textDurata(dur)} calendaristice` : ''})</div>}
                    {dur && !deAcum && <div style={{ color:G.orange }}>Licitația nu are termen de depunere — data de expirare se calculează după ce îl completezi.</div>}
                    {propunere.durata && <div style={{ color:G.muted }}>📖 citit din {propunere.sursa.eticheta}{propunere.dinOferta ? ' (garanția trebuie să fie cel puțin egală cu valabilitatea ofertei)' : ''}: „{propunere.sursa.fragment}”</div>}
                    {propunere.durata && propunere.sursa.secundara && <div style={{ color:G.orange }}>⚠ Sursă secundară: rezumatul e scris în platformă, nu e citat din documentație — verifică durata în fișa de date înainte de trimitere.
                      {docs.filter(d => d.tip === 'fisa_date').map(d => <button key={d.id} style={{ ...S.btnS, padding:'1px 8px', fontSize:11, marginLeft:6 }} onClick={() => deschide(d.fisier_path)}>📎 {d.nume_original}</button>)}</div>}
                    {!propunere.conflict && propunere.alte.length > 0 && <div style={{ color:G.orange }}>⚠ Cerințele dau și: {propunere.alte.map(a => `${textDurata(a)}${a.pana ? ` (→ ${fmtZi(a.pana)})` : ''} în ${a.eticheta}`).join('; ')} — s-a propus durata cu expirarea cea mai târzie; verifică.</div>}
                    {calc?.pana && necesar?.pana && calc.pana < necesar.pana && <div style={{ color:G.red, fontWeight:700 }}>⚠ Mai scurtă decât cerința ({textDurata(propunere.durata)} → {fmtZi(necesar.pana)}).</div>}
                  </>
                })()}
              </div>
              <div style={{ gridColumn:'1 / -1' }}><Lbl>Documente atașate din documentația de atribuire</Lbl>
                {!docs.length ? <div style={{ fontSize:12, color:G.orange }}>Nu există fișa de date în documentație — cererea pleacă fără atașament (adaug-o din „Adu din SEAP” / „Urcă fișiere”).</div> :
                  docs.map(d => (
                    <label key={d.id} style={{ display:'flex', gap:8, alignItems:'center', fontSize:12.5, padding:'3px 0', cursor:'pointer' }}>
                      <input type="checkbox" checked={form.docs.includes(d.id)} onChange={e => setF('docs', e.target.checked ? [...form.docs, d.id] : form.docs.filter(x => x !== d.id))} />
                      <span style={{ color:G.dim, minWidth:120 }}>{d.tip}</span><span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{d.nume_original}</span>
                      <span style={{ color:G.dim }}>{d.size_bytes ? `${(d.size_bytes / 1048576).toFixed(1)} MB` : ''}</span>
                    </label>
                  ))}
              </div>
              <div style={{ gridColumn:'1 / -1' }}><Lbl>Textul cererii (se regenerează la schimbarea câmpurilor; poți edita)</Lbl>
                <textarea style={{ ...S.input, minHeight:300, fontFamily:'inherit', lineHeight:1.45 }} value={form.text} onChange={e => setForm(fm => ({ ...fm, text: e.target.value }))} /></div>
              <div style={{ gridColumn:'1 / -1', display:'flex', gap:8, justifyContent:'flex-end' }}>
                <button style={S.btnS} onClick={() => setForm(null)}>Renunță</button>
                <button style={S.btnP} disabled={!!busy} onClick={trimiteCerere}>📨 Trimite cererea la broker</button>
              </div>
            </div>
          )}

          {/* istoric + pasul curent */}
          {g && (
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              <div style={{ fontSize:12.5, color:G.muted, display:'flex', gap:14, flexWrap:'wrap', alignItems:'center' }}>
                <span>📨 cerere: <b style={{ color:G.text }}>{g.cerere_trimisa_la ? new Date(g.cerere_trimisa_la).toLocaleString('ro-RO', { dateStyle:'short', timeStyle:'short' }) : 'nu a plecat'}</b> · {fmtLei(g.valoare, g.moneda)} · {g.valabil_zile ? `${g.valabil_zile} zile` : 'valabilitate —'}</span>
                {g.actualizare_trimisa_la && <span>🔁 actualizare: {fmtZi(g.actualizare_trimisa_la)}</span>}
                <Fisier path={g.draft_path} eticheta="draft poliță" /><Fisier path={g.decont_path} eticheta="decont" /><Fisier path={g.op_path} eticheta="OP" /><Fisier path={g.polita_path} eticheta={`poliță nr. ${g.polita_nr || ''}`} />
                {g.status !== 'original' && <button style={{ ...S.btnS, padding:'3px 10px', fontSize:11.5, color:G.red, marginLeft:'auto' }} onClick={anuleaza}>✕ anulează</button>}
              </div>

              {g.status === 'cerere_trimisa' && (
                <div style={{ ...S.card, padding:12 }}>
                  <div style={{ fontSize:13, fontWeight:700, marginBottom:8 }}>📄 A venit draftul poliței + decontul? Încarcă-le — platforma anunță automat plata (Marilena Tudorache, Mirela Popescu).</div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 180px', gap:10, alignItems:'end' }}>
                    <div><Lbl>Draft poliță (PDF) *</Lbl><input type="file" accept=".pdf" style={S.input} onChange={e => setFDraft(e.target.files?.[0] || null)} /></div>
                    <div><Lbl>Decont / factură primă (PDF)</Lbl><input type="file" accept=".pdf,.jpg,.png" style={S.input} onChange={e => setFDecont(e.target.files?.[0] || null)} /></div>
                    <div><Lbl>Primă de plătit ({g.moneda}) *</Lbl><input style={S.input} type="number" step="0.01" value={f2.decont_valoare} onChange={e => setF2({ decont_valoare: e.target.value })} /></div>
                  </div>
                  <div style={{ marginTop:10, textAlign:'right' }}><button style={S.btnP} disabled={!!busy} onClick={salveazaDraft}>💳 Salvează și trimite la plată</button></div>
                </div>
              )}
              {g.status === 'draft_primit' && (
                <div style={{ ...S.card, padding:12 }}>
                  <div style={{ fontSize:13, fontWeight:700, marginBottom:4 }}>💳 De plătit: <span style={{ color:G.orange }}>{fmtLei(g.decont_valoare, g.moneda)}</span> — mail trimis {g.notificat_plata_la ? fmtZi(g.notificat_plata_la) : '(neconfirmat)'}</div>
                  <div style={{ fontSize:12, color:G.muted, marginBottom:8 }}>După plată, Marilena / Mirela încarcă OP-ul și bifează achitată → responsabilul primește automat mailul să ceară originalul.</div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 220px', gap:10, alignItems:'end' }}>
                    <div><Lbl>OP / dovada plății (PDF, poză) *</Lbl><input type="file" accept=".pdf,.jpg,.png" style={S.input} onChange={e => setFOp(e.target.files?.[0] || null)} /></div>
                    <button style={{ ...S.btnP, background:G.green }} disabled={!!busy} onClick={marcheazaAchitata}>✓ Achitată — anunță responsabilul</button>
                  </div>
                </div>
              )}
              {g.status === 'achitata' && (
                <div style={{ ...S.card, padding:12 }}>
                  <div style={{ fontSize:13, fontWeight:700, marginBottom:4 }}>🛡 Achitată {fmtZi(g.achitata_la)} — cere brokerului polița în original ({g.broker?.email}).</div>
                  <div style={{ fontSize:12, color:G.muted, marginBottom:8 }}>Când vine originalul, scanează-l și încarcă-l aici; indicatorul „Garanție participare” devine verde dacă perioada din poliță acoperă termenul de depunere și cerința.</div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 160px 160px', gap:10, alignItems:'end' }}>
                    <div><Lbl>Poliță originală scanată (PDF) *</Lbl><input type="file" accept=".pdf" style={S.input} onChange={e => setFPol(e.target.files?.[0] || null)} /></div>
                    <div><Lbl>Nr. poliță *</Lbl><input style={S.input} value={f4.polita_nr} onChange={e => setF4({ ...f4, polita_nr: e.target.value })} /></div>
                    <div><Lbl>Primă plătită ({g.moneda})</Lbl><input style={S.input} type="number" step="0.01" placeholder={g.decont_valoare ?? ''} value={f4.polita_prima} onChange={e => setF4({ ...f4, polita_prima: e.target.value })} /></div>
                  </div>
                  {/* perioada scrisă PE POLIȚĂ — precompletată cu perioada cerută; se corectează dacă polița spune altceva */}
                  <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', marginTop:10, fontSize:12.5 }}>
                    <span style={{ color:G.muted }}>Valabilă (scris pe poliță) de la *</span>
                    <input style={{ ...S.input, width:150, padding:'5px 8px' }} type="date" value={f4.de} onChange={e => setF4({ ...f4, de: e.target.value })} />
                    <span style={{ color:G.muted }}>până la *</span>
                    <input style={{ ...S.input, width:150, padding:'5px 8px' }} type="date" value={f4.pana} onChange={e => setF4({ ...f4, pana: e.target.value })} />
                    {zileIntre(f4.de, f4.pana) > 0 && <span style={{ color:G.dim }}>({zileIntre(f4.de, f4.pana)} zile)</span>}
                    <span style={{ color:G.dim, flexBasis:'100%' }}>Precompletat cu perioada cerută brokerului — verifică pe polița fizică; platforma reține perioada din poliță, nu pe cea cerută.</span>
                    {necesar?.pana && f4.pana && f4.pana < necesar.pana && <span style={{ color:G.red, flexBasis:'100%' }}>⚠ Mai scurtă decât cerința (până la {fmtZi(necesar.pana)}).</span>}
                    {deAcum && f4.de && f4.de > deAcum && <span style={{ color:G.red, flexBasis:'100%' }}>⚠ Începe după ziua depunerii ({fmtZi(deAcum)}).</span>}
                  </div>
                  <div style={{ marginTop:10, textAlign:'right' }}><button style={{ ...S.btnP, background:G.green }} disabled={!!busy} onClick={salveazaOriginal}>🛡 Salvează polița în original</button></div>
                </div>
              )}
              {g.status === 'original' && (
                <div style={{ ...S.card, padding:12, borderColor:(rev.da ? (nuAcopera ? G.red : G.orange) : G.green) + '66' }}>
                  <div style={{ fontSize:13, fontWeight:700, color:G.green }}>✓ Polița nr. {g.polita_nr} este în original în platformă (primă {fmtLei(g.polita_prima, g.moneda)}, {fmtZi(g.original_la)}). Valabilă {fmtZi(st.acoperaDe)} – {fmtZi(st.acoperaPana)}.</div>
                  {rev.da && <div style={{ fontSize:12.5, fontWeight:700, color: nuAcopera ? G.red : G.orange, marginTop:6 }}>⚠ Garanție {NIVEL_REVERIFICARE[rev.nivel]}: {rev.motive.join('; ')}.</div>}
                  {st.inAsteptare && (
                    <div style={{ fontSize:12.5, color:G.orange, marginTop:6 }}>⏳ Prelungire cerută brokerului{g.actualizare_trimisa_la ? ` pe ${fmtZi(g.actualizare_trimisa_la)}` : ''} la {fmtZi(st.inAsteptare.de)} – {fmtZi(st.inAsteptare.pana)} — neconfirmată; până la actul adițional polița acoperă doar până la {fmtZi(st.acoperaPana)}.</div>
                  )}
                  {g.observatii && <div style={{ fontSize:12, color:G.muted, marginTop:6, whiteSpace:'pre-wrap' }}>{faraMarcaje(g.observatii)}</div>}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
