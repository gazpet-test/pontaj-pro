// ════════════════════════════════════════════════════════════════
// OfertareClarificari.jsx — ❓ Clarificări către autoritate, per licitație (ecran separat)
// Răzvan 15.09.2026: până acum secțiunea stătea în josul ecranului „📋 Cantități” — la Domnești
// (1069 de poziții) ajungeai la ea după zeci de pagini derulate. Logica e MUTATĂ de acolo, nu rescrisă.
// Nou tot atunci: „📥 Răspuns primit de la autoritate (PDF)” — răspunsul consolidat publicat în SEAP
// (pe care veghea nu-l vede) se urcă de aici ca document raspuns_clarificare + aparut_ulterior, se citește
// cu AI (ofertare-document-nou-citeste → analiza.citire_noi) și se leagă de întrebările noastre.
// Adresa de clarificări se generează pe antet Gazpet (PDF) — se depune în SEAP. Antetul e OK;
// numele firmei nu are voie doar în TEXTUL întrebărilor, fiindcă SEAP le publică tuturor ofertanților.
// ════════════════════════════════════════════════════════════════
import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase.js'
import { poatePorniProcesarea, MOTIV_POARTA } from './OfertareTriere.jsx'
import { imageToPdf } from './CitesteOricePanel.jsx'
// R5 runda 9: baza cifrelor ciornelor automate (amprenta de la generare vs acum) — afișare, reconfirmare, export verificat în backend
import { deExportat, eCiornaAutomata, stareBazaCiorna, textDiferente } from './ofertareClarificariBaza.js'

const G = {
  bg:'#0D1117', surface:'#161B22', card:'#1C2128', border:'#30363D', border2:'#21262D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  ofertare:'#3FB6E2', green:'#3FB950', blue:'#58A6FF', orange:'#F0883E', yellow:'#E3B341', red:'#F85149', purple:'#A371F7',
}
const S = {
  input: { width:'100%', boxSizing:'border-box', background:G.bg, border:`1px solid ${G.border2}`, borderRadius:6, padding:'7px 10px', color:G.text, fontSize:12.5, outline:'none' },
  btnP: { padding:'8px 16px', background:G.ofertare, color:'#0D1117', border:'none', borderRadius:7, cursor:'pointer', fontSize:12.5, fontWeight:700 },
  btnS: { padding:'8px 16px', background:G.surface, color:G.text, border:`1px solid ${G.border2}`, borderRadius:7, cursor:'pointer', fontSize:12.5 },
  card: { background:G.card, border:`1px solid ${G.border}`, borderRadius:10 },
}
const CLAR_STATUS = {
  // 25.09.2026: propunere automată cu motiv NECONFIRMAT (ex. planșe necitibile) — nu intră la trimis până nu o confirmă responsabilul
  propunere: ['💭 propunere — motiv neconfirmat', G.yellow],
  de_trimis: ['📝 de trimis', G.orange],
  trimisa:   ['📮 trimisă',   G.blue],
  raspunsa:  ['✅ răspunsă',  G.green],
  retrasa:   ['⛔ retrasă',   G.dim],
}
const fmtData = d => d ? new Date(d).toLocaleString('ro-RO', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—'

// Potrivire întrebare-noastră ↔ „întrebare răspunsă” din citirea AI: suprapunere de cuvinte (>3 litere,
// fără diacritice). E doar o PROPUNERE de bifă — omul confirmă la „Leagă”, nimic nu se scrie singur.
const cuvinte = s => new Set(String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w.length > 3))
const scorPotrivire = (a, b) => {
  const A = cuvinte(a), B = cuvinte(b)
  if (!A.size || !B.size) return 0
  let comune = 0; A.forEach(w => { if (B.has(w)) comune++ })
  return comune / Math.min(A.size, B.size)
}

// #63: marcaj rezervat în ofertare_clarificari.sursa — token exact după virgulă, prefix 'revizie_'
// (ex. '…,revizie_v2_manual'). Parsare pe split(','), nu LIKE: textul liber al sursei conține virgule.
export const tokeniRevizie = (sursa) => String(sursa || '').split(',').slice(1).map(t => t.trim()).filter(t => /^revizie_[a-z0-9_]+$/i.test(t))
export const necesitaRevizie = (q) => tokeniRevizie(q?.sursa).length > 0
// R5 sarcina 2 (e): marcajul pus de ofertare_clarificare_planse_auto v6 pe o ciornă PROTEJATĂ (editată / aprobată de om) care nu mai
// corespunde planșelor — textul și statusul ei nu se ating automat. Omul îl scoate după revizie („✓ revizuită”); alte marcaje rămân.
export const MARCAJ_REVIZIE_AUTO = 'revizie_planse_auto'
export const faraMarcajRevizieAuto = (sursa) => { const p = String(sursa || '').split(','); return [p[0], ...p.slice(1).filter(t => t.trim() !== MARCAJ_REVIZIE_AUTO)].join(',') }

export default function ClarificariPanel({ licitatii, profile, showToast, initialLicId = null, onInapoi = null, onDeschideAnaliza = null }) {
  const active = (licitatii || []).filter(l => !['castigata', 'pierduta', 'abandonata'].includes(l.status))
  const [licId, setLicId] = useState(initialLicId)
  const [clar, setClar] = useState(null)
  const [profiles, setProfiles] = useState([])
  const [citind, setCitind] = useState(null)     // id clarificare în curs de citire AI
  const [docRasp, setDocRasp] = useState([])    // documentele SEAP de tip raspuns_clarificare ale licitației
  const [busy, setBusy] = useState(null)
  const [citindDoc, setCitindDoc] = useState(null) // id document răspuns în curs de citire AI
  const [legare, setLegare] = useState(null)       // { docId, bife:{clarId:true}, propuneri:{clarId:'raspuns_scurt'} } — panoul „La ce întrebări răspunde?”
  // R5 runda 9: starea bazei cifrelor ciornelor automate (v_ofertare_clarificari_baza) — eroare / view lipsă = „nu putem verifica” (fail-closed)
  const [baza, setBaza] = useState({ peId: new Map(), eroare: null })
  const numeProfil = (id) => profiles.find(p => p.id === id)?.name || '—'
  // Răzvan 07.09.2026: clarificările încărcate manual (PDF) sunt citite de platformă cu AI → citita_la + rezumat
  const citesteClarificare = async (q) => {
    setCitind(q.id)
    const { data, error } = await supabase.functions.invoke('ofertare-clarificare-citeste', { body: { clarificare_id: q.id } })
    setCitind(null)
    if (error || data?.error) return showToast('Citire AI: ' + (data?.error || error?.message), 'err')
    showToast('✓ Platforma a citit clarificarea: ' + (data?.rezumat || '').slice(0, 120))
    load()
  }
  // Butonul „Analizează impactul în registru” chema pana pe 12.09 `ofertare-clarificare-aplica`, care aplica ORB:
  // AI-ul modifica, anula si adauga cerinte, iar omul afla din toast DUPA ce se intamplase. Era ultima usa prin care
  // registrul se schimba nevazut. Acum duce in fluxul cu revizuire: fisa licitatiei → Documente, cu
  // documentul de raspuns deja bifat. Analiza o porneste omul acolo, fiindca ea costa bani.

  useEffect(() => {
    if (licId == null && active.length) {
      // implicit: licitația cu termenul cel mai apropiat
      const cuT = [...active].sort((a, b) => new Date(a.termen_depunere || '2099') - new Date(b.termen_depunere || '2099'))
      setLicId(cuT[0].id)
    }
  }, [licitatii])

  const load = async () => {
    if (!licId) return
    const [{ data: q }, { data: pr }, { data: dr }, rB] = await Promise.all([
      supabase.from('ofertare_clarificari').select('*').eq('licitatie_id', licId).order('nr'),
      supabase.from('profiles').select('id, name'),
      // PDF-urile de raspuns ale autoritatii, ca sa se poata lega de intrebarea careia ii raspund
      // 16.09.2026 (Racari SCN1179379): filtrul era `tip = raspuns_clarificare`, deci un CAIET DE
      // SARCINI revizuit, publicat de autoritate tot pe canalul de clarificari, nu aparea aici -
      // el ramane documentatie (tip cs_volum) ca sa nu iasa din motorul de acoperire. Oana l-a
      // cautat exact in ecranul asta. Acum se arata tot ce a aparut DUPA importul initial, iar
      // documentatia revizuita e marcata ca atare in lista.
      supabase.from('ofertare_documente_atribuire').select('id, nume_original, tip, seap_meta, text_extras, fisier_path, created_at, analiza, analiza_la, status_procesare, eroare')
        .eq('licitatie_id', licId).eq('aparut_ulterior', true).order('id'),
      supabase.from('v_ofertare_clarificari_baza').select('id, status, stare, mod_ciorna, mod_curent, amprenta_curenta, marcaj_planse, text, detalii').eq('licitatie_id', licId),
    ])
    setClar(q || []); setProfiles(pr || []); setDocRasp(dr || [])
    setBaza(rB?.error ? { peId: null, eroare: rB.error.message || 'eroare' } : { peId: new Map((rB?.data || []).map(r => [r.id, r])), eroare: null })
  }
  useEffect(() => { load(); setLegare(null) }, [licId])

  const lic = active.find(l => l.id === licId)

  // ── clarificări ──
  const setQ = (id, k, v) => setClar(qs => qs.map(q => q.id === id ? { ...q, [k]: v, _mod: true } : q))
  // R5 runda 9 (verificatorul UI, minor saveQ): `sursa` NU se mai scrie de aici — o copie locală veche ștergea marcajul „necesită revizie” și
  // amprentele puse între timp de server (serverul le păstrează oricum: trg_ofertare_clarificari_baza). Marcajul se scoate doar prin
  // reconfirmare (✓ revizuită). Eroarea serverului (ex. aprobarea / trimiterea unei ciorne cu cifrele schimbate) ajunge la om.
  const saveQ = async (q) => {
    if (!q._mod) return
    const { error } = await supabase.from('ofertare_clarificari').update({
      intrebare: q.intrebare, raspuns: q.raspuns || null,
      raspuns_document_id: q.raspuns_document_id || null,
      status: q.status, updated_at: new Date().toISOString(),
    }).eq('id', q.id)
    if (error) showToast('Nu s-a salvat: ' + error.message, 'err')
    await load()
  }
  // R5 runda 9 (ADDENDUM 3 Copilot, 2): reconfirmarea = omul vede diferențele și decide PE BAZA DE ACUM (amprenta văzută; dacă datele se schimbă din
  // nou, serverul refuză). Cifra veche din text: corectată de om (textul) sau păstrată EXPLICIT ca valoare istorică. Transmisă: doar „am luat act”.
  const reconfirma = async (q, decizie) => {
    const st = stareBazaCiorna(q, baza.peId, baza.eroare)
    if (!st.rand?.amprenta_curenta) { showToast('Nu putem verifica baza cifrelor acum — reîncarcă.', 'err'); return }
    const intrebari = {
      revizuit: 'Ai revizuit textul față de cifrele / planșele de ACUM? Scrie pe scurt ce ai verificat (min. 5 caractere):',
      istoric: 'Cifra veche rămâne în text, marcată explicit „valoare istorică … la data generării”. Scrie de ce o păstrezi (min. 5 caractere):',
      luat_act: 'Clarificarea e deja transmisă — textul NU se schimbă. Ce faci: completare de trimis / de ce nu e nevoie (min. 10 caractere):',
    }
    let nota = ''
    if (decizie !== 'regenereaza') { nota = window.prompt(intrebari[decizie] || 'Notă:') || ''; if (!nota.trim()) return }
    const { data, error } = await supabase.rpc('ofertare_clarificare_reconfirma', { p_id: q.id, p_amprenta: st.rand.amprenta_curenta, p_decizie: decizie, p_nota: nota })
    if (error || data?.error) { showToast('Reconfirmare refuzată: ' + (data?.error || error?.message), 'err'); await load(); return }
    showToast(decizie === 'regenereaza' ? '↻ Ciorna platformei a fost regenerată pe datele de acum — nimic trimis.' : '✓ Reconfirmată pe baza de acum — nimic trimis.')
    await load()
  }
  // 22.09.2026: „Propune clarificări” — generatorul rulează pe workerul NAS (ofertare_clarificari_coada):
  // goluri din acoperire + ambiguități din registru + diferențe de cantități + răspunsuri primite → propuneri de_trimis.
  const propuneServer = async () => {
    if (!licId) return
    if (!(profile?.is_owner || licitatii?.find(l => l.id === licId)?.responsabil_id === profile?.id)) { showToast('Propunerea de clarificări o pornește ownerul sau responsabilul licitației (costă).', 'err'); return }
    const { error } = await supabase.from('ofertare_clarificari_coada').upsert({ licitatie_id: licId, activ: true, cerut_de: profile?.id || null, cerut_la: new Date().toISOString(), terminat_la: null, nota: null, rezultat: null }, { onConflict: 'licitatie_id' })
    if (error) { showToast('Nu s-a putut porni: ' + error.message, 'err'); return }
    setBusy('Sonnet citește registrul, golurile, cantitățile și răspunsurile primite, pe server (1-3 min)...')
    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 5000))
      const { data: q } = await supabase.from('ofertare_clarificari_coada').select('activ, nota, ultimul_tick').eq('licitatie_id', licId).maybeSingle()
      if (!q || !q.activ) { if (q?.nota) showToast(q.nota, q.nota.startsWith('❌') ? 'err' : 'ok'); break }
      const vechi = q.ultimul_tick ? (Date.now() - new Date(q.ultimul_tick).getTime()) / 60000 : (i * 5) / 60
      if (vechi > 12) { showToast('⚠️ workerul NAS nu a mai scris de ' + Math.round(vechi) + ' min — verifică heartbeat-ul', 'err'); break }
    }
    setBusy(null); await load()
  }
  const addQ = async () => {
    const nr = (clar?.length ? Math.max(...clar.map(q => q.nr || 0)) : 0) + 1
    const { error } = await supabase.from('ofertare_clarificari').insert({ licitatie_id: licId, nr, intrebare: '', status: 'de_trimis' })
    if (error) { showToast('Eroare: ' + error.message, 'err'); return }
    await load()
  }
  const delQ = async (q) => {
    if (!window.confirm(`Ștergi întrebarea ${q.nr}?`)) return
    await supabase.from('ofertare_clarificari').delete().eq('id', q.id)
    await load()
  }

  // Adresa de clarificări — antet normal, dar CONȚINUTUL întrebărilor rămâne impersonal.
  // Răzvan 10.09.2026: clarificările sunt secrete față de CEILALȚI ofertanți, nu față de
  // autoritate — ea știe oricum cine întreabă, depunerea se face din contul nostru SEAP.
  // Dar SEAP publică întrebările și răspunsurile către toți operatorii, deci numele firmei
  // în textul întrebării ajunge la concurență. Antetul e emitentul adresei, e în regulă.
  const genereazaAdresa = async () => {
    // #63: întrebările marcate „revizie_*” în sursa NU intră în adresă (rămân vizibile în listă cu badge)
    // R5 runda 9 (ADDENDUM 3, C): starea bazei se RECITEȘTE din server chiar acum (nu din ecranul încărcat mai demult): o ciornă automată cu cifrele
    // schimbate / nereconfirmate sau necontrolabilă (view indisponibil) NU intră în adresă
    const [{ data: qProaspat, error: eQ }, rB] = await Promise.all([
      supabase.from('ofertare_clarificari').select('*').eq('licitatie_id', licId).order('nr'),
      supabase.from('v_ofertare_clarificari_baza').select('id, status, stare, marcaj_planse, text, amprenta_curenta').eq('licitatie_id', licId),
    ])
    if (eQ) { showToast('Nu pot reciti clarificările: ' + eQ.message, 'err'); return }
    const { incluse: deTrimis, excluse: exc } = deExportat(qProaspat || [], rB?.data || [], rB?.error ? (rB.error.message || 'eroare') : null)
    const excluse = exc.length
    if (excluse) showToast(`${excluse} excluse din adresă: ` + exc.slice(0, 3).map(x => `${x.q.nr}. ${x.motiv}`).join(' · ').slice(0, 400), 'warn')
    if (!deTrimis.length) { showToast(`Nicio întrebare cu status „de trimis" care să poată intra în adresă${excluse ? ` (${excluse} excluse)` : ''}.`, 'warn'); return }
    setBusy('PDF...')
    try {
      // HTML pe antet → html2canvas → A4 (fontul standard jsPDF nu are diacritice)
      const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      const azi = new Date().toLocaleDateString('ro-RO')
      const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;color:#111;padding:48px 56px;font-size:13.5px;line-height:1.55">
          <table style="width:100%;border-collapse:collapse"><tr>
            <td style="vertical-align:bottom">
              <div style="font-size:21px;font-weight:800;letter-spacing:.4px">GAZPET INSTAL S.R.L.</div>
              <div style="font-size:10.5px;color:#444;margin-top:3px">Str. Fluturilor nr. 34, Ploiești, Prahova &nbsp;·&nbsp; CUI RO 22029920 &nbsp;·&nbsp; J29/1650/2007<br/>office@gazpet.ro &nbsp;·&nbsp; tel/fax 0244/435005</div>
            </td>
            <td style="vertical-align:bottom;text-align:right;font-size:11px;color:#444">Ploiești, ${azi}</td>
          </tr></table>
          <div style="border-bottom:2.5px solid #111;margin:10px 0 26px"></div>
          <div style="margin-bottom:4px"><b>Către:</b> ${esc(lic?.autoritate || '—')}</div>
          <div style="font-size:11.5px;color:#444;margin-bottom:26px">În atenția comisiei de evaluare</div>
          <div style="text-align:center;font-size:16px;font-weight:800;letter-spacing:.5px;margin-bottom:6px">SOLICITARE DE CLARIFICĂRI</div>
          <div style="text-align:center;font-size:12px;color:#333;margin-bottom:24px">Referitor: anunțul de participare <b>${esc(lic?.nr_anunt || '')}</b> — „${esc(lic?.obiect || '')}"</div>
          <p style="text-align:justify;margin:0 0 14px">Stimate doamne / Stimați domni,</p>
          <p style="text-align:justify;margin:0 0 18px">În conformitate cu prevederile art. 160 din Legea nr. 98/2016 privind achizițiile publice, vă adresăm următoarele solicitări de clarificare cu privire la documentația de atribuire:</p>
          ${deTrimis.map(q => `
            <table style="width:100%;border-collapse:collapse;margin-bottom:14px"><tr>
              <td style="vertical-align:top;width:34px;font-weight:800;font-size:13.5px;padding-top:1px">${q.nr}.</td>
              <td style="text-align:justify">${esc(q.intrebare.trim())}</td>
            </tr></table>`).join('')}
          <p style="text-align:justify;margin:20px 0 0">Vă mulțumim și așteptăm răspunsul dumneavoastră în termenul legal, prin intermediul SEAP.</p>
          <table style="width:100%;border-collapse:collapse;margin-top:44px"><tr>
            <td style="width:55%"></td>
            <td style="text-align:center">
              <div style="font-weight:800">GAZPET INSTAL S.R.L.</div>
              <div style="font-size:12px;margin-top:2px">Administrator</div>
              <div style="font-size:12px;font-weight:700;margin-top:2px">Trușu Răzvan</div>
            </td>
          </tr></table>
        </div>`
      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([import('jspdf'), import('html2canvas')])
      const div = document.createElement('div')
      div.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;background:#fff'
      div.innerHTML = html
      document.body.appendChild(div)
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
      const canvas = await html2canvas(div, { scale: 2, backgroundColor: '#fff' })
      document.body.removeChild(div)
      const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
      const imgH = canvas.height * 210 / canvas.width
      const pagini = Math.max(1, Math.ceil(imgH / 297))
      for (let i = 0; i < pagini; i++) {
        if (i > 0) pdf.addPage()
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, -i * 297, 210, imgH)
      }
      pdf.save(`clarificari_${lic?.nr_anunt || licId}.pdf`)
      showToast(`Adresa cu ${deTrimis.length} întrebări generată${excluse ? ` (${excluse} excluse — necesită revizie)` : ''} — verifică să nu apară numele firmei în textul întrebărilor (SEAP le publică tuturor ofertanților), apoi depune și marchează-le „trimisă".`)
    } catch (e) { showToast('Eroare PDF: ' + (e?.message || e), 'err') }
    setBusy(null)
  }

  // ── răspunsuri primite de la autoritate (NOU, Răzvan 15.09.2026) ──
  const deschideDoc = async (d) => {
    const { data, error } = await supabase.storage.from('ofertare').createSignedUrl(d.fisier_path, 600)
    if (error || !data?.signedUrl) return showToast('Nu pot deschide fișierul: ' + (error?.message || 'URL lipsă'), 'err')
    window.open(data.signedUrl, '_blank')
  }
  // Citirea AI (Sonnet) a documentului de răspuns — aceeași edge fn ca în „📂 Documente noi din SEAP” din fișă.
  // Returnează true la succes, ca uploadul să poată deschide direct panoul de legare.
  const citesteDoc = async (d) => {
    setCitindDoc(d.id)
    const { data, error } = await supabase.functions.invoke('ofertare-document-nou-citeste', { body: { document_id: d.id } })
    setCitindDoc(null)
    if (error || data?.error) { showToast('Citirea a eșuat: ' + (data?.error || error?.message), 'err'); return null }
    showToast(`🤖 Citit: ${d.nume_original}`)
    await load()
    return data?.citire_noi || null
  }
  // Răspunsul consolidat publicat în SEAP (veghea nu-l vede) → document raspuns_clarificare + aparut_ulterior,
  // deci apare și în „📂 Documente noi din SEAP” din fișă. Valori verificate pe CHECK-urile tabelei (15.09.2026):
  // tip ∈ {…,'raspuns_clarificare',…}, status_procesare ∈ {'neprocesat',…}; sursa n-are CHECK — 'upload' e valoarea
  // uploadului manual din DocumenteSection (default coloană), o folosim și aici.
  const urcaRaspuns = async (file) => {
    if (!file || !licId) return
    setBusy('Urc răspunsul…')
    const safe = file.name.replace(/[^a-zA-Z0-9ăâîșțĂÂÎȘȚ._-]+/g, '_').slice(-160)
    const path = `${licId}/atribuire/raspunsuri/${Date.now()}_${safe}`
    const { error: eUp } = await supabase.storage.from('ofertare').upload(path, file, { upsert: false })
    if (eUp) { setBusy(null); return showToast('Upload: ' + eUp.message, 'err') }
    const { data: ins, error } = await supabase.from('ofertare_documente_atribuire').insert({
      licitatie_id: licId, fisier_path: path, nume_original: file.name, tip: 'raspuns_clarificare', sursa: 'upload',
      aparut_ulterior: true, status_procesare: 'neprocesat', size_bytes: file.size,
    }).select('id, nume_original').single()
    if (error) { setBusy(null); return showToast('Eroare la înregistrare: ' + error.message, 'err') }
    setBusy('🤖 Citesc răspunsul cu AI…')
    const citire = await citesteDoc(ins)
    setBusy(null)
    // docRasp din closure e vechi aici (load() abia a rulat) → panoul se deschide pe citirea întoarsă de edge fn
    if (citire) deschideLegare(ins.id, { id: ins.id, analiza: { citire_noi: citire } })
    else await load()
  }
  // TKT-2026-0251 (Răzvan): fișierul de răspuns urcat direct pe O întrebare. Același flux ca mai sus:
  // rând în ofertare_documente_atribuire (raspuns_clarificare, aparut_ulterior) legat prin raspuns_document_id
  // (coloană existentă), citit cu aceeași edge fn. Pozele → PDF în browser (edge-ul citește doar PDF);
  // doc/docx se păstrează și se leagă, fără citire AI. Citirea costă → doar owner/responsabil (poarta).
  // Textul propus intră în caseta de răspuns NESALVAT — omul îl verifică, salvarea e la ieșirea din casetă.
  const urcaRaspunsIntrebare = async (q, file0) => {
    if (!file0 || !licId) return
    setBusy('Urc răspunsul…')
    let file = file0
    try { if ((file0.type || '').startsWith('image/')) file = await imageToPdf(file0) }
    catch (e) { setBusy(null); return showToast('Conversie imagine: ' + e.message, 'err') }
    const ePdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
    const safe = file.name.replace(/[^a-zA-Z0-9ăâîșțĂÂÎȘȚ._-]+/g, '_').slice(-160)
    const path = `${licId}/clarificari/raspunsuri/${Date.now()}_q${q.nr || q.id}_${safe}`
    const { error: eUp } = await supabase.storage.from('ofertare').upload(path, file, { upsert: false })
    if (eUp) { setBusy(null); return showToast('Upload: ' + eUp.message, 'err') }
    const { data: ins, error } = await supabase.from('ofertare_documente_atribuire').insert({
      licitatie_id: licId, fisier_path: path, nume_original: file.name, tip: 'raspuns_clarificare', sursa: 'upload',
      aparut_ulterior: true, status_procesare: 'neprocesat', size_bytes: file.size,
    }).select('id, nume_original').single()
    if (error) { setBusy(null); return showToast('Eroare la înregistrare: ' + error.message, 'err') }
    const { error: eL } = await supabase.from('ofertare_clarificari').update({ raspuns_document_id: ins.id, updated_at: new Date().toISOString() }).eq('id', q.id)
    if (eL) { setBusy(null); return showToast('Legare: ' + eL.message, 'err') }
    if (!ePdf) { setBusy(null); showToast('Fișier urcat și legat de întrebare. Citirea AI merge doar pe PDF/poze — scrie răspunsul manual.', 'warn'); return load() }
    if (!poatePorniProcesarea(profile, lic)) { setBusy(null); showToast('Fișier urcat și legat. Citirea AI o pornește ownerul / responsabilul licitației.', 'warn'); return load() }
    setBusy('🤖 Citesc răspunsul cu AI…')
    const citire = await citesteDoc(ins)   // face și load()
    setBusy(null)
    if (!citire) return
    const lista = Array.isArray(citire.intrebari_raspunse) ? citire.intrebari_raspunse : []
    let best = null, bestS = 0
    lista.forEach(x => { const s = scorPotrivire(q.intrebare, x.intrebare_scurt); if (s > bestS) { bestS = s; best = x } })
    const propus = ((best && bestS >= 0.34 ? best.raspuns_scurt : (lista.length === 1 ? lista[0].raspuns_scurt : citire.rezumat)) || '').trim()
    if (!propus) return showToast('AI-ul n-a găsit un răspuns clar în fișier — scrie-l manual.', 'warn')
    if ((q.raspuns || '').trim()) return showToast('Întrebarea avea deja răspuns scris — l-am păstrat. Propunerea AI e în „📥 Primite de la autoritate”.', 'warn')
    setQ(q.id, 'raspuns', propus.slice(0, 20000))
    showToast('🤖 Am propus răspunsul din fișier — verifică-l în casetă; se salvează când ieși din ea.')
  }
  // Întrebările noastre care mai așteaptă răspuns — candidatele la legare
  const candidateLegare = () => (clar || []).filter(q => q.status === 'trimisa' || q.status === 'de_trimis')
  // Deschide panoul „La ce întrebări răspunde?”: propune bifele după potrivirea textului (omul decide).
  const deschideLegare = (docId, docFresh = null) => {
    const d = docFresh || docRasp.find(x => x.id === docId)
    const ir = d?.analiza?.citire_noi?.intrebari_raspunse
    const lista = Array.isArray(ir) ? ir : []
    const bife = {}, propuneri = {}
    candidateLegare().forEach(q => {
      let best = null, bestS = 0
      lista.forEach(x => { const s = scorPotrivire(q.intrebare, x.intrebare_scurt); if (s > bestS) { bestS = s; best = x } })
      if (best && bestS >= 0.34) { bife[q.id] = true; propuneri[q.id] = best.raspuns_scurt || '' }
    })
    setLegare({ docId, bife, propuneri })
  }
  const leaga = async () => {
    if (!legare) return
    const d = docRasp.find(x => x.id === legare.docId)
    const ids = Object.keys(legare.bife).filter(k => legare.bife[k]).map(Number)
    if (!ids.length) return showToast('Bifează măcar o întrebare.', 'warn')
    const rezumat = (d?.analiza?.citire_noi?.rezumat || '').trim()
    setBusy('Leg răspunsul…')
    let ok = 0
    for (const id of ids) {
      const q = (clar || []).find(x => x.id === id); if (!q) continue
      const patch = { raspuns_document_id: legare.docId, status: 'raspunsa', updated_at: new Date().toISOString() }
      if (!(q.raspuns || '').trim()) patch.raspuns = (legare.propuneri[id] || rezumat || '').slice(0, 20000) || null
      const { error } = await supabase.from('ofertare_clarificari').update(patch).eq('id', id)
      if (error) showToast(`Întrebarea ${q.nr}: ${error.message}`, 'err'); else ok++
    }
    setBusy(null); setLegare(null)
    showToast(`✓ ${ok} întrebări legate de „${d?.nume_original || 'document'}” și marcate răspunse — verifică textul răspunsurilor.`)
    await load()
  }

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14, flexWrap:'wrap', gap:10 }}>
        <div>
          <div style={{ fontSize:19, fontWeight:800 }}>❓ Clarificări către autoritate</div>
          <div style={{ fontSize:12, color:G.muted }}>Întrebările noastre (din diferențele de cantități sau manuale) → adresa PDF depusă în SEAP → răspunsul autorității legat de fiecare întrebare</div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center', flex:1, minWidth:260 }}>
          {onInapoi && <button style={{ ...S.btnS, padding:'8px 14px', whiteSpace:'nowrap' }} onClick={onInapoi} title="Înapoi la fișa licitației">← Înapoi la fișă</button>}
          <select style={{ ...S.input, flex:1, minWidth:200, maxWidth:760 }} title="Licitația de lucru" value={licId || ''} onChange={e => setLicId(Number(e.target.value))}>
            {active.map(l => <option key={l.id} value={l.id}>{l.nr_anunt} · {(l.obiect || '').slice(0, 44)}</option>)}
          </select>
        </div>
      </div>

      {busy && <div style={{ position:'fixed', top:76, right:20, zIndex:2000, padding:'11px 18px', borderRadius:9, fontSize:13, fontWeight:600, background:G.ofertare, color:'#0D1117' }}>{busy}</div>}

      {/* Răspunsuri primite de la autoritate */}
      <div style={{ ...S.card, padding:14, marginBottom:12 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8, flexWrap:'wrap', gap:8 }}>
          <div>
            <div style={{ fontWeight:800, fontSize:13.5 }}>📥 Primite de la autoritate ({docRasp.length})</div>
            <div style={{ fontSize:11.5, color:G.dim }}>tot ce a publicat autoritatea DUPĂ documentația inițială — răspunsuri, erate și documentație revizuită</div>
          </div>
          {/* răspunsul consolidat publicat în SEAP, pe care veghea nu-l vede — se urcă manual */}
          <label style={{ ...S.btnP, padding:'5px 14px', fontSize:12, cursor: busy ? 'default' : 'pointer', opacity: busy ? .6 : 1 }} title="Urcă PDF-ul cu răspunsul autorității (consolidat, din SEAP): îl citesc cu AI și îți propun la ce întrebări răspunde">
            📥 Răspuns primit de la autoritate (PDF)
            <input type="file" accept=".pdf" style={{ display:'none' }} disabled={!!busy} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; urcaRaspuns(f) }} />
          </label>
        </div>
        {!docRasp.length && <div style={{ color:G.dim, fontSize:12.5, padding:'8px 0 4px', textAlign:'center' }}>Nimic nou de la autoritate încă. Când publică ceva în SEAP, veghea îl aduce singură; dacă nu, urcă PDF-ul aici.</div>}
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {docRasp.map(d => {
            const c = d.analiza?.citire_noi
            const ph = !d.fisier_path || String(d.fisier_path).includes('/neincarcat/')
            const legate = (clar || []).filter(q => q.raspuns_document_id === d.id)
            const inLegare = legare?.docId === d.id
            const cand = candidateLegare()
            return (
              <div key={d.id} style={{ padding:'10px 12px', background:G.bg, borderRadius:8, border:`1px solid ${G.border2}`, borderLeft:`3px solid ${G.orange}` }}>
                <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
                  <div style={{ flex:1, minWidth:180, fontSize:13, fontWeight:600, wordBreak:'break-word' }}>
                    {d.nume_original}
                    {d.seap_meta?.inlocuieste && (
                      <span style={{ marginLeft:8, fontSize:10.5, fontWeight:700, color:G.orange, border:`1px solid ${G.orange}`, borderRadius:5, padding:'1px 6px', whiteSpace:'nowrap' }}
                        title={`Versiune nouă a documentului „${d.seap_meta.inlocuieste}”. Documentația veche NU mai e cea în vigoare.`}>
                        ♻ DOCUMENTAȚIE REVIZUITĂ
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize:11.5, color:G.dim, whiteSpace:'nowrap' }} title="data apariției în platformă">📅 {fmtData(d.created_at)}</span>
                </div>
                <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', marginTop:6 }}>
                  {ph
                    ? <span style={{ fontSize:11.5, color:G.yellow }} title={d.eroare || ''}>⚠ neadus automat — urcă-l din fișă → Documente</span>
                    : <button style={{ ...S.btnS, padding:'3px 9px', fontSize:11.5 }} onClick={() => deschideDoc(d)}>📎 Deschide documentul original</button>}
                  <button style={{ ...S.btnS, padding:'3px 9px', fontSize:11.5, color: ph ? G.dim : G.ofertare, borderColor: ph ? G.border2 : G.ofertare + '66', opacity: ph ? .5 : 1 }}
                    disabled={ph || !!citindDoc || !!busy} onClick={() => citesteDoc(d)} title={c ? 'Recitește documentul cu AI (Sonnet)' : 'Citește documentul cu AI (Sonnet): rezumat, modificări, întrebări răspunse'}>
                    {citindDoc === d.id ? '⏳ citesc…' : c ? '🤖 recitește' : '🤖 citește cu AI'}
                  </button>
                  {c?.citit_la && <span style={{ fontSize:11, color:G.green }}>✓ citit {fmtData(c.citit_la)}</span>}
                  {c?.termen_nou && <span style={{ fontSize:11.5, fontWeight:800, color:G.red }}>⏰ termen nou: {c.termen_nou}</span>}
                  {c && !inLegare && <button style={{ ...S.btnS, padding:'3px 9px', fontSize:11.5, color:G.green, borderColor:G.green + '66' }} disabled={!!busy} onClick={() => deschideLegare(d.id, d)}>🔗 La ce întrebări răspunde?</button>}
                  {legate.length > 0 && <span style={{ fontSize:11, color:G.muted }} title={legate.map(q => `${q.nr}. ${(q.intrebare || '').slice(0, 80)}`).join('\n')}>🔗 legat de întrebările: {legate.map(q => q.nr).join(', ')}</span>}
                </div>
                {!ph && <TextOriginalToggle docId={d.id} />}
                {c && (
                  <details style={{ marginTop:8, fontSize:12.5 }}>
                    <summary style={{ cursor:'pointer', fontWeight:700, color:G.muted }}>🤖 Rezumatul citirii{Array.isArray(c.intrebari_raspunse) && c.intrebari_raspunse.length ? ` · ${c.intrebari_raspunse.length} întrebări răspunse` : ''}{Array.isArray(c.modificari) && c.modificari.length ? ` · ${c.modificari.length} modificări` : ''}</summary>
                    <div style={{ marginTop:6, padding:'8px 10px', background:G.surface, borderRadius:8, borderLeft:`2px solid ${G.green}` }}>
                      <div style={{ whiteSpace:'pre-wrap', color:G.text }}>{c.rezumat || '(fără rezumat)'}</div>
                      {Array.isArray(c.modificari) && c.modificari.length > 0 && (
                        <details style={{ marginTop:6 }}>
                          <summary style={{ cursor:'pointer', fontWeight:700, color:G.orange }}>✏️ Modificări ({c.modificari.length})</summary>
                          <ul style={{ margin:'6px 0 0', paddingLeft:18 }}>
                            {c.modificari.map((m, i) => <li key={i} style={{ marginBottom:4 }}><b>{m.ce_se_schimba}</b>{m.unde ? <span style={{ color:G.muted }}> — {m.unde}</span> : null}{m.impact_oferta ? <div style={{ color:G.yellow, fontSize:12 }}>↳ {m.impact_oferta}</div> : null}</li>)}
                          </ul>
                        </details>
                      )}
                      {Array.isArray(c.intrebari_raspunse) && c.intrebari_raspunse.length > 0 && (
                        <details style={{ marginTop:6 }}>
                          <summary style={{ cursor:'pointer', fontWeight:700, color:G.blue }}>❓ Întrebări răspunse ({c.intrebari_raspunse.length})</summary>
                          <ul style={{ margin:'6px 0 0', paddingLeft:18 }}>
                            {c.intrebari_raspunse.map((q, i) => <IntrebareRaspunsItem key={i} q={q} />)}
                          </ul>
                        </details>
                      )}
                    </div>
                  </details>
                )}
                {/* Panoul de legare: bifele sunt PROPUSE după potrivirea textului, omul confirmă. La „Leagă”:
                    raspuns_document_id + status 'raspunsa'; textul răspunsului se pune doar dacă era gol. */}
                {inLegare && (
                  <div style={{ marginTop:8, padding:'9px 11px', background:G.surface, borderRadius:8, border:`1px solid ${G.green}55` }}>
                    <div style={{ fontWeight:800, fontSize:12.5, marginBottom:6 }}>🔗 La ce întrebări răspunde documentul?</div>
                    {!cand.length
                      ? <div style={{ fontSize:12, color:G.dim }}>Nicio întrebare cu status „trimisă” sau „de trimis” — toate sunt deja răspunse sau retrase.</div>
                      : cand.map(q => (
                        <label key={q.id} style={{ display:'flex', gap:8, alignItems:'flex-start', padding:'4px 0', fontSize:12.5, cursor:'pointer' }}>
                          <input type="checkbox" checked={!!legare.bife[q.id]} onChange={e => setLegare(l => ({ ...l, bife: { ...l.bife, [q.id]: e.target.checked } }))} style={{ marginTop:3 }} />
                          <div style={{ flex:1, minWidth:0 }}>
                            <span style={{ fontWeight:700, color:G.muted }}>{q.nr}.</span> {(q.intrebare || '').slice(0, 220)}{(q.intrebare || '').length > 220 ? '…' : ''}
                            {legare.propuneri[q.id] && <div style={{ fontSize:11.5, color:G.green, marginTop:2 }}>↳ propus: {legare.propuneri[q.id]}</div>}
                            {(q.raspuns || '').trim() && <div style={{ fontSize:11, color:G.dim, marginTop:2 }}>(are deja răspuns scris — se păstrează, se leagă doar documentul)</div>}
                          </div>
                        </label>
                      ))}
                    <div style={{ display:'flex', gap:8, marginTop:8 }}>
                      <button style={{ ...S.btnP, padding:'5px 14px', fontSize:12 }} disabled={!!busy || !cand.length} onClick={leaga}>🔗 Leagă ({Object.values(legare.bife).filter(Boolean).length})</button>
                      <button style={{ ...S.btnS, padding:'5px 12px', fontSize:12 }} onClick={() => setLegare(null)}>Renunță</button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Clarificări */}
      <div style={{ ...S.card, padding:14 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8, flexWrap:'wrap', gap:8 }}>
          <div style={{ fontWeight:800, fontSize:13.5 }}>❓ Întrebările noastre ({clar?.length ?? '...'})
            {!!clar?.length && <span style={{ fontSize:11, fontWeight:400, color:G.dim, marginLeft:8 }}>🤖 {clar.filter(q => q.origine !== 'manual').length} platformă · 👤 {clar.filter(q => q.origine === 'manual').length} manual{clar.some(q => q.origine === 'manual' && !q.citita_la) ? ` · ⚠ ${clar.filter(q => q.origine === 'manual' && !q.citita_la).length} necitite` : ''}</span>}
          </div>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            <button style={{ ...S.btnS, padding:'5px 12px', fontSize:12 }} onClick={addQ}>＋ întrebare</button>
            {/* clarificare depusă în afara generatorului (ex. de Mirela, direct în SEAP) — se urcă PDF-ul ca platforma să țină cont de ea */}
            <label style={{ ...S.btnS, padding:'5px 12px', fontSize:12, cursor:'pointer' }}>
              📎 Clarificare externă (PDF)
              <input type="file" accept=".pdf" style={{ display:'none' }} onChange={async e => {
                const file = e.target.files?.[0]; e.target.value = ''
                if (!file) return
                const path = `${licId}/clarificari/${Date.now()}_${file.name.replace(/[^\w.-]+/g, '_')}`
                const { error: eUp } = await supabase.storage.from('ofertare').upload(path, file, { upsert:false })
                if (eUp) return showToast('Upload: ' + eUp.message, 'err')
                const nr = (clar?.length ? Math.max(...clar.map(q => q.nr || 0)) : 0) + 1
                const { data: { user } } = await supabase.auth.getUser()
                const { data: ins, error } = await supabase.from('ofertare_clarificari').insert({
                  licitatie_id: licId, nr, sursa: 'extern', status: 'trimisa', fisier_path: path, origine: 'manual', creat_de: user?.id || null,
                  intrebare: `(clarificare depusă extern — ${file.name}; completează aici pe scurt ce s-a întrebat)`,
                }).select('id').single()
                if (error) return showToast('Eroare: ' + error.message, 'err')
                showToast('✓ PDF-ul e în platformă — îl citesc acum cu AI…')
                await load()
                if (ins?.id) citesteClarificare({ id: ins.id })
              }} />
            </label>
            <button style={{ ...S.btnS, padding:'5px 14px', fontSize:12 }} onClick={propuneServer} disabled={!!busy} title="Generatorul rulează pe workerul NAS: goluri din acoperire, ambiguități din registru, diferențe de cantități, răspunsuri primite — propuneri de_trimis, le verifici tu">☁️ Propune clarificări (Sonnet)</button>
            <button style={{ ...S.btnP, padding:'5px 14px', fontSize:12 }} onClick={genereazaAdresa} disabled={!!busy}>📄 Generează adresa</button>
          </div>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {(clar || []).map(q => {
            const [lbl, col] = CLAR_STATUS[q.status] || CLAR_STATUS.de_trimis
            return (
              <div key={q.id} style={{ padding:'10px 12px', background:G.bg, borderRadius:8, border:`1px solid ${G.border2}`, borderLeft:`3px solid ${col}` }}>
                <div style={{ display:'flex', gap:10, alignItems:'flex-start' }}>
                  <span style={{ fontWeight:800, color:G.muted, paddingTop:8 }}>{q.nr}.</span>
                  <div style={{ flex:1 }}>
                    <textarea style={{ ...S.input, minHeight:54, resize:'vertical' }} value={q.intrebare || ''} placeholder="Textul întrebării..."
                      onChange={e => setQ(q.id, 'intrebare', e.target.value)} onBlur={() => saveQ(q)} />
                    <div style={{ display:'flex', gap:10, alignItems:'center', marginTop:3, flexWrap:'wrap' }}>
                      {q.origine === 'manual'
                        ? <span title="PDF încărcat de un coleg (depus direct în SEAP)" style={{ fontSize:10.5, fontWeight:700, color:G.orange, background:G.orange + '1A', border:`1px solid ${G.orange}55`, borderRadius:5, padding:'1px 7px' }}>👤 încărcată manual{q.creat_de ? ` · ${numeProfil(q.creat_de)}` : ''}</span>
                        : <span title="Generată de platformă din analiza documentației" style={{ fontSize:10.5, fontWeight:700, color:G.blue, background:G.blue + '1A', border:`1px solid ${G.blue}55`, borderRadius:5, padding:'1px 7px' }}>🤖 generată de platformă</span>}
                      {q.origine === 'manual' && (q.citita_la
                        ? <span title={q.citita_rezumat || ''} style={{ fontSize:10.5, fontWeight:700, color:G.green }}>✓ citită de platformă {new Date(q.citita_la).toLocaleString('ro-RO', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}</span>
                        : <button style={{ ...S.btnS, padding:'2px 8px', fontSize:11, color:G.yellow, borderColor:G.yellow + '66' }} disabled={citind === q.id} onClick={() => citesteClarificare(q)}>{citind === q.id ? '⏳ citesc…' : '⚠ necitită — 🤖 citește PDF-ul'}</button>)}
                      {q.status === 'propunere' && <button style={{ ...S.btnS, padding:'2px 8px', fontSize:11, color:G.green, borderColor:G.green + '66' }}
                        title="Ai verificat că datele chiar lipsesc (nu sunt în memoriu, F3 sau alt document) — ciorna trece la „de trimis”"
                        onClick={() => { setQ(q.id, 'status', 'de_trimis'); saveQ({ ...q, status: 'de_trimis', _mod: true }) }}>✅ Confirm motivul — de trimis</button>}
                      {necesitaRevizie(q) && <span title={`Marcaj în sursă: ${tokeniRevizie(q.sursa).join(', ')} — exclusă din adresa generată până la revizie`} style={{ fontSize:10.5, fontWeight:700, color:G.red, background:G.red + '1A', border:`1px solid ${G.red}55`, borderRadius:5, padding:'1px 7px' }}>⚠ necesită revizie</span>}
                      {/* R5 runda 9: „✓ revizuită” (marcajul planșelor) = reconfirmarea din panoul bazei, de mai jos — legată de baza de acum */}
                      {q.sursa && <span style={{ fontSize:11, color:G.dim }}>sursa: {q.sursa}</span>}
                      {q.fisier_path && <button style={{ ...S.btnS, padding:'2px 8px', fontSize:11 }} onClick={async () => {
                        const { data } = await supabase.storage.from('ofertare').createSignedUrl(q.fisier_path, 600)
                        if (data?.signedUrl) window.open(data.signedUrl, '_blank')
                      }}>📄 PDF-ul depus</button>}
                    </div>
                    {eCiornaAutomata(q) && (() => {
                      // R5 runda 9: baza cifrelor ciornei față de acum — afișată oriunde e ciorna; aprobarea / trimiterea cer reconfirmarea (și serverul o cere)
                      const st = stareBazaCiorna(q, baza.peId, baza.eroare)
                      if (st.nivel === 'na' || (st.nivel === 'ok' && !st.blocheaza)) return null
                      const transmisa = q.status === 'trimisa' || q.status === 'raspunsa'
                      const dif = textDiferente(st.rand?.detalii)
                      const col = st.nivel === 'luat_act' ? G.muted : G.red
                      const std = String(q.sursa || '').split(',').slice(1).some(t => /^gen_[0-9a-f]{12}$/.test(t.trim())) && q.status === 'propunere'
                      return (
                        <div style={{ marginTop:6, padding:'7px 10px', background:G.surface, borderRadius:7, borderLeft:`3px solid ${col}`, fontSize:12 }}>
                          <div style={{ fontWeight:700, color:col }}>⚠ {transmisa && st.nivel === 'schimbata' ? 'baza cifrelor s-a schimbat DUPĂ transmitere — textul transmis rămâne neschimbat; evaluează o completare' : st.text}</div>
                          {st.rand?.detalii?.curent?.text && st.nivel !== 'nu_putem_verifica' && <div style={{ color:G.muted, marginTop:3 }}>acum: {st.rand.detalii.curent.text}</div>}
                          {dif.length > 0 && <details style={{ marginTop:3 }}><summary style={{ cursor:'pointer', color:G.muted }}>ce s-a schimbat față de baza ciornei ({dif.length})</summary>
                            <ul style={{ margin:'4px 0 0', paddingLeft:18 }}>{dif.map((t, i) => <li key={i}>{t}</li>)}</ul></details>}
                          {st.nivel !== 'nu_putem_verifica' && st.nivel !== 'luat_act' && (
                            <div style={{ display:'flex', gap:6, marginTop:5, flexWrap:'wrap' }}>
                              {transmisa
                                ? <button style={{ ...S.btnS, padding:'2px 8px', fontSize:11 }} onClick={() => reconfirma(q, 'luat_act')}>👁 Am luat act</button>
                                : <>
                                    <button style={{ ...S.btnS, padding:'2px 8px', fontSize:11, color:G.green, borderColor:G.green + '66' }} title="Ai corectat textul (cifra veche nu mai e în el) și l-ai verificat pe datele de acum" onClick={() => reconfirma(q, 'revizuit')}>✓ Am revizuit textul — reconfirm</button>
                                    {st.rand?.detalii?.mod_ciorna === 'cifra' && <button style={{ ...S.btnS, padding:'2px 8px', fontSize:11 }} title="Cifra veche rămâne în text, marcată explicit „valoare istorică … la data generării” (nu mai e prezentată drept valoare curentă)" onClick={() => reconfirma(q, 'istoric')}>📌 Păstrez cifra ca valoare istorică</button>}
                                    {std && <button style={{ ...S.btnS, padding:'2px 8px', fontSize:11 }} title="Ciorna platformei (needitată, neaprobată) se regenerează pe datele de acum" onClick={() => reconfirma(q, 'regenereaza')}>↻ Regenerează</button>}
                                  </>}
                            </div>
                          )}
                        </div>
                      )
                    })()}
                    {q.origine === 'manual' && q.citita_rezumat && <div style={{ fontSize:11.5, color:G.muted, marginTop:4, padding:'5px 8px', background:G.surface, borderRadius:6, borderLeft:`2px solid ${G.green}` }}>🤖 {q.citita_rezumat}</div>}
                    {/* Câmpul de răspuns apare de la „trimisă" încolo. Înainte era legat de status='raspunsa',
                        deci nimeni nu putea completa răspunsul fără să bifeze întâi că a primit unul. */}
                    {(q.status === 'trimisa' || q.status === 'raspunsa' || q.raspuns) && (
                      <>
                        <textarea style={{ ...S.input, minHeight:40, resize:'vertical', marginTop:6, borderColor:G.green + '55' }} value={q.raspuns || ''} placeholder="Răspunsul autorității..."
                          onChange={e => setQ(q.id, 'raspuns', e.target.value)} onBlur={() => saveQ(q)} />
                        {/* Răspunsurile vin din SEAP ca PDF-uri. Legarea lor aici e ce lipsea:
                            fără ea, PDF-ul era citit ca document oarecare și producea cerințe paralele,
                            neversionate, lângă cerințele pe care de fapt le modifica. */}
                        {docRasp.length > 0 && (
                          <div style={{ display:'flex', gap:6, alignItems:'center', marginTop:5, flexWrap:'wrap' }}>
                            <span style={{ fontSize:11, color:G.dim }}>📎 răspunsul e în documentul:</span>
                            <select style={{ ...S.input, width:'auto', fontSize:11.5, maxWidth:320 }} value={q.raspuns_document_id || ''}
                              onChange={e => {
                                const did = e.target.value ? Number(e.target.value) : null
                                const d = docRasp.find(x => x.id === did)
                                setQ(q.id, 'raspuns_document_id', did)
                                if (d && !(q.raspuns || '').trim() && (d.text_extras || '').trim()) {
                                  setQ(q.id, 'raspuns', d.text_extras.slice(0, 20000))
                                  showToast('Am pus textul documentului în răspuns — verifică-l și taie ce nu ține de întrebarea asta.')
                                }
                              }}>
                              <option value="">— niciunul —</option>
                              {docRasp.map(d => <option key={d.id} value={d.id}>{d.nume_original}</option>)}
                            </select>
                          </div>
                        )}
                        <div style={{ display:'flex', gap:6, alignItems:'center', marginTop:5, flexWrap:'wrap' }}>
                          <label style={{ ...S.btnS, padding:'3px 10px', fontSize:11.5, cursor: busy ? 'default' : 'pointer', opacity: busy ? .6 : 1 }}
                            title={poatePorniProcesarea(profile, lic) ? 'Urcă fișierul cu răspunsul autorității (PDF / poză / doc) pentru ÎNTREBAREA asta; PDF-ul și pozele le citesc cu AI și îți propun textul' : 'Urcă fișierul cu răspunsul (se leagă de întrebare). ' + MOTIV_POARTA}>
                            📎 Urcă fișier răspuns{poatePorniProcesarea(profile, lic) ? ' + citește AI' : ''}
                            <input type="file" accept=".pdf,image/*,.doc,.docx" style={{ display:'none' }} disabled={!!busy} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; urcaRaspunsIntrebare(q, f) }} />
                          </label>
                        </div>
                        {(q.raspuns_document_id || (q.raspuns || '').trim()) && (
                          <div style={{ marginTop:5 }}>
                            {q.raspuns_document_id ? (
                              <button style={{ ...S.btnS, padding:'3px 10px', fontSize:11.5, color:G.ofertare, borderColor:G.ofertare + '66' }}
                                disabled={!onDeschideAnaliza}
                                title={onDeschideAnaliza ? 'Deschide fișa licitației în Documente, cu acest document bifat. Analiza o pornești tu acolo.' : 'Deschide Clarificările din fișa licitației ca să poți intra în analiză'}
                                onClick={() => onDeschideAnaliza({ licitatieId: q.licitatie_id, documentId: q.raspuns_document_id })}>
                                📋 Analizează impactul în registru</button>
                            ) : (
                              // Fluxul nou citeste documentul, nu caseta de text: un raspuns scris de mana
                              // n-are ce inventaria. Spunem exact ce lipseste, nu „nu se poate".
                              <span style={{ fontSize:11.5, color:G.muted }}>
                                Pentru analiza în registru, leagă mai sus documentul autorității (PDF-ul din SEAP).
                              </span>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', gap:5, minWidth:120 }}>
                    <select style={{ ...S.input, fontSize:11.5 }} value={q.status} onChange={e => { setQ(q.id, 'status', e.target.value); }} onBlur={() => saveQ(q)}>
                      {Object.entries(CLAR_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                    <button onClick={() => delQ(q)} style={{ ...S.btnS, padding:'3px 8px', fontSize:11, color:G.red, borderColor:G.red + '66' }}>✕</button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        {clar !== null && !clar.length && <div style={{ color:G.dim, fontSize:12.5, padding:14, textAlign:'center' }}>Nicio clarificare — diferențele din cantități apar automat aici la extracție.</div>}
      </div>
    </div>
  )
}

// Răzvan 25.09.2026: colegii vor să citească și TEXTUL ORIGINAL al documentului primit, nu doar
// interpretarea AI. text_extras se încarcă leneș, doar la deschiderea toggle-ului.
export function TextOriginalToggle({ docId }) {
  const [open, setOpen] = useState(false)
  const [txt, setTxt] = useState(undefined)   // undefined = neîncărcat, null = eroare
  const toggle = async () => {
    const nou = !open; setOpen(nou)
    if (nou && txt === undefined) {
      const { data, error } = await supabase.from('ofertare_documente_atribuire').select('text_extras').eq('id', docId).maybeSingle()
      setTxt(error ? null : (data?.text_extras || ''))
    }
  }
  return (
    <div style={{ marginTop:6 }}>
      <button style={{ ...S.btnS, padding:'3px 9px', fontSize:11.5 }} onClick={toggle}>{open ? '▾' : '▸'} 📄 Text original</button>
      {open && (
        <div style={{ marginTop:6 }}>
          <div style={{ fontSize:11, color:G.dim, marginBottom:4 }}>text extras automat din PDF — pentru document oficial apăsați «deschide» (📎 Deschide documentul original)</div>
          {txt === undefined ? <div style={{ fontSize:12, color:G.muted }}>Se încarcă…</div>
            : txt === null ? <div style={{ fontSize:12, color:G.red }}>Nu am putut încărca textul.</div>
            : !txt.trim() ? <div style={{ fontSize:12, color:G.dim }}>Nu există text extras pentru acest document (poate e scanat) — deschide documentul original.</div>
            : <pre style={{ margin:0, maxHeight:400, overflow:'auto', whiteSpace:'pre-wrap', wordBreak:'break-word', fontFamily:'ui-monospace, Menlo, Consolas, monospace', fontWeight:300, fontSize:12, lineHeight:1.45, color:G.text, background:G.bg, border:`1px solid ${G.border2}`, borderRadius:8, padding:'8px 10px' }}>{txt}</pre>}
        </div>
      )}
    </div>
  )
}

// Î/R: textul original (verbatim, dacă AI l-a copiat) primul, interpretarea dedesubt, estompată.
export function IntrebareRaspunsItem({ q }) {
  const io = String(q.intrebare_originala || '').trim(), ro = String(q.raspuns_original || '').trim()
  if (!io && !ro) return <li style={{ marginBottom:4 }}><span style={{ color:G.muted }}>Î:</span> {q.intrebare_scurt}<div style={{ color:G.green, fontSize:12 }}>R: {q.raspuns_scurt}</div></li>
  return (
    <li style={{ marginBottom:8 }}>
      <div style={{ whiteSpace:'pre-wrap' }}><span style={{ color:G.muted }}>Î:</span> {io || q.intrebare_scurt}</div>
      <div style={{ whiteSpace:'pre-wrap', color:G.green, fontSize:12 }}>R: {ro || q.raspuns_scurt}</div>
      <div style={{ fontSize:11, color:G.dim, fontStyle:'italic', marginTop:2 }}>🤖 interpretare — Î: {q.intrebare_scurt} · R: {q.raspuns_scurt}</div>
    </li>
  )
}
