// ════════════════════════════════════════════════════════════════
// OfertarePropunere.jsx — „📑 Propunere tehnică": matricea de conformitate + poarta
//
// De ce există: la licitațiile de distribuție gaze nu se pierde pe preț, se pierde pe formă.
// Din 41 de licitații de distribuție din arhivă, 21 sunt marcate „NU." = n-am participat.
// Modulul ăsta nu e un editor de text — e o listă pe care nu poți s-o închizi mințind:
// fiecare cerință de tip „propunere" sau „formă" trebuie să iasă undeva (capitol / dovadă în
// registru / excepție cu motiv scris), altfel semaforul stă roșu.
//
// DOUĂ REGULI care au omorât prima variantă a modulului:
//
// 1. NU se scrie NICIODATĂ în ofertare_cerinte. Câmpul stare='nu_se_aplica' de acolo e verdictul
//    omului pe ACOPERIRE (citit de AcoperireSection și de v_ofertare_dashboard). Dacă modulul ăsta
//    ar folosi același bit, o singură acțiune în bloc ar stinge acoperiri deja probate — 235 doar
//    pe licitația 3. Excepția de propunere are rândul ei: ofertare_pt_legaturi.fel='exceptat'.
//
// 2. Semaforul nu poate da verde din lipsă de date. 68 din 73 de licitații n-au nicio cerință;
//    `poarta.some(r => r.stare==='block')` pe un array gol e false, adică VERDE pe un dosar necitit.
//    De aceea rândul 1 (cuprins inexistent) e BLOCK din start, iar v_ofertare_pt_stare întoarce
//    un rând pentru toate cele 73 de licitații, nu doar pentru cele cu cerințe.
// ════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo } from 'react'
import { supabase } from './lib/supabase.js'
import { EditorCapitol, IstoricCapitol, Observatii, INSIGNA_SURSA } from './OfertareRevizii.jsx'
import { construiestePropunere, construiesteBorderou, numeFisier, descarcaDocx, blobDocx } from './OfertareExport.js'
import { sha256Hex, sursaVersiuneCapitole, construiesteManifest, pachetDepasit } from './ofertarePachet.js'
import { evalueazaPoarta, verdictSemnatura } from './ofertarePoarta.js'
import { MOMENTE_GARANTIE } from './ofertareControale.js'

const G = { bg:'#0D1117', surface:'#161B22', card:'#1C2128', border:'#30363D', border2:'#21262D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  ofertare:'#3FB6E2', green:'#3FB950', blue:'#58A6FF', orange:'#F0883E',
  yellow:'#E3B341', red:'#F85149', purple:'#A371F7', teal:'#2DD4BF' }
const S = {
  input: { width:'100%', boxSizing:'border-box', background:G.bg, border:`1px solid ${G.border2}`, borderRadius:6, padding:'8px 12px', color:G.text, fontSize:13, outline:'none' },
  lbl: { display:'block', fontSize:11, color:G.muted, marginBottom:4, fontWeight:600, textTransform:'uppercase', letterSpacing:'.3px' },
  btnP: { padding:'9px 18px', background:G.ofertare, color:'#0D1117', border:'none', borderRadius:7, cursor:'pointer', fontSize:13, fontWeight:700 },
  btn: { padding:'6px 12px', background:G.surface, color:G.text, border:`1px solid ${G.border2}`, borderRadius:6, cursor:'pointer', fontSize:12 },
  btnS: { padding:'9px 18px', background:G.surface, color:G.text, border:`1px solid ${G.border2}`, borderRadius:7, cursor:'pointer', fontSize:13 },
  card: { background:G.card, border:`1px solid ${G.border}`, borderRadius:10 },
}

// Cuprinsul stă în JS, nu în migrare: titlurile variază de la o autoritate la alta și se editează
// per licitație, fără să ceară migrare.
//
// Lista de mai jos e COPIATĂ din formularul real depus de Gazpet — „Formular Propunere tehnica
// Stefan cel Mare.docx" (SCN1146660, depusă 16.05.2024), din arhiva de pe Drive, la
// Calificare\model propuneri tehnice. Nu e o listă inventată: e formularul-cadru ANAP așa cum
// îl completează biroul de ofertare.
//
// `formular` e null peste tot INTENȚIONAT. În documentul citit apar doar „Formular 11" și
// „Formular 12", și nici alea legate clar de un capitol anume. Numerele de formular se iau din
// fișa de date a fiecărei licitații, nu se presupun.
//
// ATENȚIE, lista asta NU e „cuprinsul standard". E cuprinsul UNUI formular ANAP, cel folosit la o
// licitație Transgaz. Opisul propunerii depuse la Contești (distribuție gaze, 1144 pag.) spune
// negru pe alb: „Propunere Tehnică respecta capitolele din Fisa de date si cap9 pct 9.1". Acolo
// structura e cu totul alta — Secțiunea A (Cap. I-VI) + Secțiunea B, Planul calității (Cap. I-III)
// + ~20 de anexe, cu Graficul Gantt ca anexă, depus și PDF și Excel separat.
//
// A treia structură, citită la Motru (distribuție gaze): fișa de date, secțiunea IV.4.1 „Modul de
// prezentare al propunerii tehnice" — 9 capitole numerotate 1-9, repetate identic în caietul de
// sarcini. Deci variază și lista, și locul din fișa de date unde e scrisă (Contești: cap. 9 pct.
// 9.1; Motru: IV.4.1). Se caută după TITLU, nu după număr.
//
// Trei licitații, trei structuri. Deci: punct de pornire pentru licitațiile pe formular ANAP,
// niciodată implicit tăcut pentru restul.
const CAPITOLE_ANAP = [
  { nr:1,  titlu:'Rezumat', obligatoriu:true, formular:null },
  { nr:2,  titlu:'Metodologia de executarea lucrărilor', obligatoriu:true, formular:null },
  { nr:3,  titlu:'Planul de management al calității în cadrul Contractului', obligatoriu:true, formular:null },
  { nr:4,  titlu:'Grafic general de realizare a investiției (fizic)', obligatoriu:true, formular:null },
  { nr:5,  titlu:'Personalul propus și managementul contractului pentru execuția lucrărilor', obligatoriu:true, formular:null },
  { nr:6,  titlu:'Infrastructura care va fi utilizată în realizarea activităților în cadrul Contractului', obligatoriu:true, formular:null },
  { nr:7,  titlu:'Modalitatea de efectuare a înregistrărilor și înregistrările efectuate în legătură cu indicatorii cantitativi și calitativi asociați execuției lucrărilor', obligatoriu:true, formular:null },
  { nr:8,  titlu:'Măsuri aplicabile de Ofertant pe perioada Contractului pentru asigurarea îndeplinirii obligațiilor din domeniul mediului', obligatoriu:true, formular:null },
  { nr:9,  titlu:'Măsuri aplicabile de Ofertant pe perioada Contractului pentru asigurarea îndeplinirii obligațiilor din domeniul social și al relațiilor de muncă', obligatoriu:true, formular:null },
  { nr:10, titlu:'Măsuri aplicate de Ofertant pentru supravegherea lucrărilor în perioada de garanție acordată', obligatoriu:true, formular:null },
  { nr:11, titlu:'Informații în legătură cu echipamentele incluse în lucrare după expirarea perioadei de garanție', obligatoriu:true, formular:null },
  { nr:12, titlu:'Adecvarea la constrângerile fizice impuse de amplasamentul lucrării', obligatoriu:true, formular:null },
  { nr:13, titlu:'Anexe la Propunerea Tehnică', obligatoriu:false, formular:null },
  { nr:14, titlu:'Orice alte informații relevante pentru demonstrarea conformității propunerii tehnice raportat la Cerințele Beneficiarului', obligatoriu:false, formular:null },
  { nr:15, titlu:'ASPECTE TEHNICE OFERTATE SUPLIMENTAR FAȚĂ DE CERINȚELE MINIME ALE DOCUMENTAȚIEI DE ATRIBUIRE', obligatoriu:false, formular:null },
]

// Cuprinsul depus la HOGHILAG (execuție distribuție gaze, 1192 pagini tipărite, dosarul de
// depunere). Titlurile sunt copiate din cuprinsul real, p. 2-4 al părții 1.
const CAPITOLE_HOGHILAG = [
  { nr:1,  titlu:'Abordarea generală și coordonarea activităților privind execuția lucrărilor', obligatoriu:true, formular:null },
  { nr:2,  titlu:'Metodologia de execuție lucrări', obligatoriu:true, formular:null },
  { nr:3,  titlu:'Planul de management al calității în cadrul contractului', obligatoriu:true, formular:null },
  { nr:4,  titlu:'Graficul general propus de realizare a investiției publice', obligatoriu:true, formular:null },
  { nr:5,  titlu:'Modalitatea de asigurare a accesului la specialiștii necesari pentru realizarea contractului', obligatoriu:true, formular:null },
  { nr:6,  titlu:'Planul cu măsurile privind protecția mediului', obligatoriu:true, formular:null },
  { nr:7,  titlu:'Planul privind normele de siguranță și protecție a muncii implementat la nivelul organizației ofertantului', obligatoriu:true, formular:null },
  { nr:8,  titlu:'Planul privind măsurile de supraveghere a lucrărilor în perioada de garanție acordată', obligatoriu:true, formular:null },
  { nr:9,  titlu:'Proiectul de management al traficului', obligatoriu:true, formular:null },
  { nr:10, titlu:'Anexe', obligatoriu:false, formular:null },
]

// Cuprinsul depus la CRISTIAN (execuție distribuție gaze, 545 pagini, folderul „documente depuse
// pe SEAP"). ATENȚIE la cap. 3 și 4: acolo graficul e capitolul 3, iar listele de cantități FĂRĂ
// VALORI au capitol separat — fișa de date (IV.4.1) cere cantități fără valori în propunerea
// tehnică și grafic CU valori în cea financiară. La Conpet e exact invers: graficul din propunerea
// tehnică trebuie să aibă valori. „Grafic tehnic" NU înseamnă universal „fără bani".
const CAPITOLE_CRISTIAN = [
  { nr:1,  titlu:'Metodologia de executare a lucrărilor, aplicată la lucrare', obligatoriu:true, formular:null },
  { nr:2,  titlu:'Planul de management al calității aplicat la lucrare', obligatoriu:true, formular:null },
  { nr:3,  titlu:'Graficul de execuție', obligatoriu:true, formular:null },
  { nr:4,  titlu:'Listele de cantități — FĂRĂ VALORI', obligatoriu:true, formular:null },
  { nr:5,  titlu:'Organigrama și modalitatea de asigurare a accesului la personalul necesar și obligatoriu', obligatoriu:true, formular:null },
  { nr:6,  titlu:'Modalitatea de acces la logistică, utilajele/echipamentele/instalațiile și mijloacele de transport', obligatoriu:true, formular:null },
  { nr:7,  titlu:'Măsurile aplicate pe perioada contractului pentru îndeplinirea obligațiilor de mediu, sociale și ale relațiilor de muncă', obligatoriu:true, formular:null },
  { nr:8,  titlu:'Declarație privind termenul de garanție acordat lucrărilor', obligatoriu:true, formular:null },
  { nr:9,  titlu:'Declarație pe proprie răspundere privind deținerea mașinilor/utilajelor/echipamentelor', obligatoriu:true, formular:null },
  { nr:10, titlu:'Formularele puse la dispoziție de autoritatea contractantă, completate și asumate prin semnătură', obligatoriu:true, formular:null },
  { nr:11, titlu:'Centralizatorul procentual aferent fiecărui asociat / subcontractant (după caz)', obligatoriu:true, formular:null },
  { nr:12, titlu:'Autorizații', obligatoriu:true, formular:null },
  { nr:13, titlu:'Anexe', obligatoriu:false, formular:null },
]

// MOTRU, din colecția „PROPUNERI TEHNICE DISTRIBUTIE GAZE". ATENȚIE: poziția într-un folder de
// modele NU dovedește că exemplarul ăsta s-a depus. Se folosește ca punct de pornire, nu ca
// referință de conformitate. Capitolul 8 conține deja o matrice cerință / modalitate de
// îndeplinire / document justificativ — adică fix ce face modulul ăsta, scris de ei la mână.
const CAPITOLE_MOTRU = [
  { nr:1,  titlu:'Modul în care ofertantul înțelege să execute categoriile de lucrări, cu resursele materiale și umane alocate și procedurile tehnice de execuție', obligatoriu:true, formular:null },
  { nr:2,  titlu:'Descrierea lucrărilor ce vor fi executate în cadrul organizării de șantier', obligatoriu:true, formular:null },
  { nr:3,  titlu:'Planul de management al calității', obligatoriu:true, formular:null },
  { nr:4,  titlu:'PCCVI — Programul de control al calității, verificări și încercări', obligatoriu:true, formular:null },
  { nr:5,  titlu:'Planul de securitate și sănătate în muncă (SSM)', obligatoriu:true, formular:null },
  { nr:6,  titlu:'Planul de management al mediului', obligatoriu:true, formular:null },
  { nr:7,  titlu:'Managementul riscurilor contractului', obligatoriu:true, formular:null },
  { nr:8,  titlu:'Matrice de conformitate și grafic general de execuție', obligatoriu:true, formular:null },
  { nr:9,  titlu:'Descrierea lucrărilor care vor fi executate de asociați și/sau subcontractanți', obligatoriu:true, formular:null },
  { nr:10, titlu:'Anexe', obligatoriu:false, formular:null },
]

// Punctele de pornire, nu „șabloanele". Fiecare are scris de unde vine si ce NU dovedeste.
// Al doilea si al treilea sunt cuprinsuri DEPUSE la licitatii de distributie gaze — tocmai
// familia la care firma pierde cel mai des, si singura pentru care formularul ANAP e nepotrivit.
const MODELE_CUPRINS = [
  { cod:'anap', nume:'Formular ANAP (Transgaz)', domeniu:'transport / formular ANAP',
    capitole: CAPITOLE_ANAP,
    sursa: 'Formular Propunere tehnică Ștefan cel Mare (SCN1146660, depus 16.05.2024)',
    atentie: 'Formular ANAP. La distribuție gaze structura e alta — vezi celelalte două.' },
  { cod:'hoghilag', nume:'Hoghilag — distribuție gaze', domeniu:'distribuție gaze',
    capitole: CAPITOLE_HOGHILAG,
    sursa: 'cuprinsul propunerii depuse la Hoghilag (1192 pag.), p. 2-4',
    atentie: 'Graficul e cap. 4. Fișa de date cerea grafic EDITABIL (.mpp) — la clarificări ni s-a cerut și a trebuit trimis.' },
  { cod:'cristian', nume:'Cristian — distribuție gaze', domeniu:'distribuție gaze',
    capitole: CAPITOLE_CRISTIAN,
    sursa: 'cuprinsul propunerii depuse la Cristian (545 pag.), p. 2-3',
    atentie: 'Graficul e cap. 3, iar cantitățile FĂRĂ VALORI au capitol separat (cap. 4). La Conpet e invers: graficul din tehnică trebuie să aibă valori.' },
  { cod:'motru', nume:'Motru — distribuție gaze', domeniu:'distribuție gaze',
    capitole: CAPITOLE_MOTRU,
    sursa: 'colecția de modele „Propuneri tehnice distribuție gaze", cuprins p. 2-4',
    atentie: 'NU e dovedit că exemplarul ăsta s-a depus — e dintr-un folder de modele. Punct de pornire, nu referință.' },
]

// ATENȚIE: identic, caracter cu caracter, cu regexul din v_ofertare_pt_stare.
// Dacă cele două diferă, bannerul spune 15 capcane și lista arată 12.
// Regexul e masurat pe date reale inainte de orice largire (13.09.2026, 2127 cerinte):
//   `resping` gol         -> +6, dar prinde "respingerea RECEPTIEI", care n-are legatura cu oferta
//   `exclu(dere|s)`       -> +22, aproape toate "responsabil EXCLUSIV". Zgomot curat, refuzat.
//   `[iî]ntocmai`         -> +2, din care 1 deja prins. Nu merita clasa de fals pozitive.
// Varianta pastrata: +4, toate reale ("necriptarea duce la respingerea ofertei"), 0 pierdute.
// `se considera lipsa` si `indiferent de modul de prezentare` sunt verbatim din documentatia
// Motru (repetat de 6 ori acolo); 0 potriviri azi fiindca documentele alea nu-s inca ingerate.
const RX_CAPCANA = /(respins|resping[ăa-z]* (a |la )?(ofert|candidatur)|neconform|descalific|inacceptabil|sub sanc[tț]iune|f[aă]r[aă] (posibilitatea de a solicita )?clarific|nu se accept|se consider[aă] (ca )?lips[aă]|indiferent de modul de prezentare)/i

const fmtZi = d => d ? new Date(d.length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('ro-RO') : '—'
const zileRamase = t => { if (!t) return null; const ms = new Date(t) - new Date(); return Math.ceil(ms / 86400000) }

// ─────────────────────────────────────────────────────────────────
// POARTA — 10 rânduri. Niciunul nu se sare, niciunul nu tace.
// ─────────────────────────────────────────────────────────────────
function PoartaPT({ st, onFiltru }) {
  // Toate rândurile vin din evalueazaPoarta — NU se mai scrie nicio condiție aici.
  const ev = useMemo(() => evalueazaPoarta(st), [st])
  const randuri = ev ? ev.randuri : null

  if (!randuri) return <div style={{ color:G.muted, fontSize:13, padding:12 }}>Se încarcă poarta…</div>

  const cul = s => s === 'block' ? G.red : s === 'warn' ? G.orange : G.green
  const ico = s => s === 'block' ? '⛔' : s === 'warn' ? '⚠️' : '✓'

  return (
    <div style={{ ...S.card, overflow:'hidden' }}>
      {randuri.map((r, i) => (
        <div key={r.k}
          onClick={r.filtru ? () => onFiltru?.(r.filtru) : undefined}
          style={{ display:'flex', gap:10, alignItems:'flex-start', padding:'10px 14px',
            borderTop: i ? `1px solid ${G.border2}` : 'none',
            cursor: r.filtru ? 'pointer' : 'default' }}>
          <span style={{ color:cul(r.stare), fontSize:14, lineHeight:'18px', width:18 }}>{ico(r.stare)}</span>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:13, fontWeight:600, color:G.text }}>
              {r.titlu}
              {r.filtru && <span style={{ color:G.dim, fontSize:11, fontWeight:400 }}> — click pentru listă</span>}
            </div>
            <div style={{ fontSize:12, color:G.muted, marginTop:2 }}>{r.detalii}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// MATRICEA — cerințele, cu filtre și cele două acțiuni în bloc
// ─────────────────────────────────────────────────────────────────
function MatriceCerinte({ cerinte, legaturi, capitole, dovedite, documente = [], filtru, setFiltru, sel, setSel,
                          onAtribuie, onExcepta, onVerifica, onBlocheaza, onDovada, busy }) {
  const [capSel, setCapSel] = useState('')
  const [motiv, setMotiv] = useState('')

  const legPe = useMemo(() => {
    const m = new Map()
    for (const l of legaturi) {
      if (!m.has(l.cerinta_id)) m.set(l.cerinta_id, [])
      m.get(l.cerinta_id).push(l)
    }
    return m
  }, [legaturi])

  const versiuneCap = useMemo(() => new Map(capitole.map(c => [c.id, c.versiune || 1])), [capitole])
  const lista = useMemo(() => cerinte.filter(c => {
    const ls = legPe.get(c.id) || []
    const areCap = ls.some(l => l.fel === 'capitol')
    const exceptat = ls.some(l => l.fel === 'exceptat')
    const cuDovada = dovedite.has(c.id)
    if (filtru === 'fara')    return !areCap && !exceptat && !cuDovada
    if (filtru === 'capcane') return RX_CAPCANA.test(c.text_cerinta || '') && !areCap && !exceptat
    if (filtru === 'forma')   return c.tip === 'forma'
    if (filtru === 'dovada')  return cuDovada && !areCap && !exceptat
    if (filtru === 'gata')    return areCap || exceptat
    // P0.3: are capitol, dar nimeni n-a verificat raspunsul — sau l-a verificat la o versiune
    // veche a capitolului. Aceeasi definitie ca `cerinte_neverificate` din view.
    if (filtru === 'neverificate') return ls.some(l => l.fel === 'capitol'
      && !(l.stare === 'verificata' && l.verificat_la_versiunea === versiuneCap.get(l.capitol_id)))
    return true
  }), [cerinte, legPe, dovedite, filtru, versiuneCap])

  const CHIPS = [
    ['fara',    'fără capitol'],
    ['neverificate', '⏳ neverificate'],
    ['capcane', '🚫 capcane'],
    ['forma',   'de formă'],
    ['dovada',  'închise cu dovadă'],
    ['gata',    'rezolvate'],
    ['',        'toate'],
  ]
  const toggle = id => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  return (
    <div>
      <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:10, alignItems:'center' }}>
        {CHIPS.map(([k, lab]) => (
          <button key={k} onClick={() => { setFiltru(k); setSel(new Set()) }}
            style={{ padding:'5px 12px', border:'none', borderRadius:20, cursor:'pointer', fontSize:12, fontWeight:600,
              background: filtru === k ? G.ofertare + '22' : G.surface,
              color: filtru === k ? G.ofertare : G.muted }}>{lab}</button>
        ))}
        <span style={{ marginLeft:'auto', color:G.muted, fontSize:12 }}>{lista.length} cerințe</span>
      </div>

      {sel.size > 0 && (
        <div style={{ ...S.card, padding:12, marginBottom:10, borderColor:G.ofertare + '55' }}>
          <div style={{ fontSize:12, color:G.text, fontWeight:600, marginBottom:8 }}>{sel.size} selectate</div>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
            <select value={capSel} onChange={e => setCapSel(e.target.value)} style={{ ...S.input, width:'auto', minWidth:260 }}>
              <option value="">— alege capitolul —</option>
              {capitole.map(c => <option key={c.id} value={c.id}>{c.nr}. {c.titlu}</option>)}
            </select>
            <button disabled={!capSel || busy} onClick={() => { onAtribuie(Number(capSel)); setCapSel('') }}
              style={{ ...S.btnP, opacity: (!capSel || busy) ? .5 : 1 }}>→ atribuie capitolului</button>
          </div>
          <div style={{ display:'flex', gap:8, marginTop:8, alignItems:'center' }}>
            <input value={motiv} onChange={e => setMotiv(e.target.value)} placeholder="motivul excepției (obligatoriu)" style={{ ...S.input, flex:1 }} />
            <button disabled={!motiv.trim() || busy} onClick={() => { onExcepta(motiv.trim()); setMotiv('') }}
              style={{ ...S.btnS, opacity: (!motiv.trim() || busy) ? .5 : 1, borderColor:G.orange + '55', color:G.orange }}>
              ⊘ nu se aplică la propunere
            </button>
          </div>
          <div style={{ fontSize:11, color:G.dim, marginTop:6 }}>
            Excepția e doar pentru propunerea tehnică. Nu atinge registrul de cerințe și acoperire.
          </div>
        </div>
      )}

      <div style={{ ...S.card, overflow:'hidden' }}>
        {lista.length === 0 && <div style={{ padding:16, color:G.muted, fontSize:13 }}>Nicio cerință pe filtrul ăsta.</div>}
        {lista.map((c, i) => {
          const ls = legPe.get(c.id) || []
          const cap = ls.find(l => l.fel === 'capitol')
          const exc = ls.find(l => l.fel === 'exceptat')
          const capcana = RX_CAPCANA.test(c.text_cerinta || '')
          const capNr = cap && capitole.find(k => k.id === cap.capitol_id)
          return (
            <div key={c.id} style={{ display:'flex', gap:10, padding:'10px 12px', borderTop: i ? `1px solid ${G.border2}` : 'none' }}>
              <input type="checkbox" checked={sel.has(c.id)} onChange={() => toggle(c.id)} style={{ marginTop:3 }} />
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:3 }}>
                  <span style={{ fontSize:11, color:G.dim }}>#{c.nr_ordine ?? c.id}</span>
                  <span style={{ fontSize:11, color: c.tip === 'forma' ? G.purple : G.blue }}>{c.tip}</span>
                  {c.sursa_sectiune && <span style={{ fontSize:11, color:G.dim }}>{c.sursa_sectiune}{c.sursa_pagina ? ` p.${c.sursa_pagina}` : ''}</span>}
                  {capcana && <span style={{ fontSize:11, color:G.red, fontWeight:700 }}>🚫 CAPCANĂ</span>}
                  {dovedite.has(c.id) && !cap && !exc && <span style={{ fontSize:11, color:G.teal }}>✓ dovadă în registru</span>}
                  {capNr && <span style={{ fontSize:11, color:G.green, fontWeight:600 }}>→ {capNr.eticheta || `cap. ${capNr.nr}`}</span>}
                  {exc && <span style={{ fontSize:11, color:G.orange }} title={exc.motiv}>⊘ exceptată</span>}
                  {/* P0.3: starea legaturii. Verde DOAR la 'verificata' la versiunea CURENTA a capitolului. */}
                  {cap && capNr && (() => {
                    const laZi = cap.stare === 'verificata' && cap.verificat_la_versiunea === (capNr.versiune || 1)
                    const veche = cap.stare === 'verificata' && !laZi
                    const cul = laZi ? G.green : cap.stare === 'blocata' ? G.red : veche ? G.orange : G.yellow
                    const txt = laZi ? `✓ verificată v${cap.verificat_la_versiunea}`
                      : veche ? `⚠ verificată la v${cap.verificat_la_versiunea}, capitolul e la v${capNr.versiune || 1}`
                      : cap.stare === 'blocata' ? '⛔ blocată' : `⏳ ${cap.stare}`
                    return <span style={{ fontSize:11, color:cul, fontWeight:600 }} title={cap.constatare || cap.locator_raspuns || ''}>{txt}</span>
                  })()}
                </div>
                <div style={{ fontSize:13, color:G.text, lineHeight:1.45 }}>{c.text_cerinta}</div>
                {cap && cap.locator_raspuns && <div style={{ fontSize:11, color:G.dim, marginTop:2 }}>răspunsul: {cap.locator_raspuns}</div>}
                {cap && cap.constatare && <div style={{ fontSize:11, color:G.red, marginTop:2 }}>constatare: {cap.constatare}</div>}
              </div>
              {/* Butoanele de verificare. Un om citeste raspunsul din capitol si bifeaza — sau blocheaza
                  cu constatare. Dovada e optionala aici: multe cerinte de propunere se satisfac prin
                  text, nu prin document; cele cu document probant primesc 📎. */}
              {cap && capNr && !(cap.stare === 'verificata' && cap.verificat_la_versiunea === (capNr.versiune || 1)) && (
                <div style={{ display:'flex', flexDirection:'column', gap:4, flexShrink:0 }}>
                  <button disabled={busy} onClick={() => onVerifica(cap, capNr)} title="Am citit răspunsul din capitol și satisface cerința"
                    style={{ ...S.btn, padding:'2px 8px', fontSize:11, color:G.green }}>✓ verific</button>
                  <button disabled={busy} onClick={() => onDovada(cap, documente)} title="Leagă o dovadă (document + pagină)"
                    style={{ ...S.btn, padding:'2px 8px', fontSize:11 }}>📎 dovadă</button>
                  <button disabled={busy} onClick={() => onBlocheaza(cap)} title="Răspunsul NU satisface cerința — scrie de ce"
                    style={{ ...S.btn, padding:'2px 8px', fontSize:11, color:G.red }}>⛔ blochez</button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// CUPRINSUL — capitolele licitației
// ─────────────────────────────────────────────────────────────────
function CuprinsCapitole({ capitole, numarPeCapitol, obsPeCapitol, versiuniPeCapitol, nume,
                          onCreeaza, onAdauga, onSterge, onSalveaza, onBlocheaza, onGenereaza, busy }) {
  const [nou, setNou] = useState(null)  // null = formularul e închis
  const [deschis, setDeschis] = useState(null)   // capitolul desfăcut (editor + istoric)
  const [editez, setEditez] = useState(null)

  // Formularul de capitol nou. Capitolele NU vin dintr-un șablon: opisul de la Contești spune
  // „respecta capitolele din Fisa de date si cap9 pct 9.1" — iar la Motru aceeasi sectiune e la
  // IV.4.1, cu alte 9 capitole. Variaza si lista, si locul unde e scrisa. Deci trebuie sa se poata tasta.
  const formular = nou && (
    <div style={{ ...S.card, padding:12, marginTop:10, display:'flex', flexWrap:'wrap', gap:8, alignItems:'center' }}>
      <input placeholder="Secțiune (ex. Secțiunea A, Anexe) — opțional" value={nou.sectiune}
        onChange={e => setNou({ ...nou, sectiune: e.target.value })}
        style={{ ...S.input, flex:'1 1 200px' }} />
      <input placeholder="Etichetă (Cap. I / 4 / Anexa 7)" value={nou.eticheta}
        onChange={e => setNou({ ...nou, eticheta: e.target.value })}
        style={{ ...S.input, flex:'0 0 150px' }} />
      <input placeholder="Titlul capitolului, ca în fișa de date" value={nou.titlu} autoFocus
        onChange={e => setNou({ ...nou, titlu: e.target.value })}
        style={{ ...S.input, flex:'2 1 260px' }} />
      <label style={{ fontSize:12, color:G.muted, display:'flex', gap:5, alignItems:'center' }}>
        <input type="checkbox" checked={nou.obligatoriu}
          onChange={e => setNou({ ...nou, obligatoriu: e.target.checked })} />
        obligatoriu
      </label>
      <button disabled={busy || !nou.titlu.trim()}
        onClick={async () => { if (await onAdauga(nou)) setNou(null) }}
        style={{ ...S.btnP, opacity: (busy || !nou.titlu.trim()) ? .5 : 1 }}>Adaugă</button>
      <button onClick={() => setNou(null)} style={S.btn}>Renunță</button>
    </div>
  )
  const btnAdauga = !nou && (
    <button onClick={() => setNou({ sectiune:'', eticheta:'', titlu:'', obligatoriu:true })}
      disabled={busy} style={{ ...S.btn, marginTop:10, opacity: busy ? .5 : 1 }}>
      ➕ Adaugă un capitol din fișa de date
    </button>
  )

  if (capitole.length === 0) {
    return (
      <div style={{ ...S.card, padding:16 }}>
        <div style={{ color:G.muted, fontSize:13, marginBottom:12 }}>
          Propunerea n-are încă niciun capitol. Cuprinsul NU e același la toate licitațiile: se ia din fișa de
          date, din secțiunea „Modul de prezentare al propunerii tehnice". Caut-o după titlu, nu după număr —
          la Contești e cap. 9 pct. 9.1, la Motru e IV.4.1. Modelele de mai jos sunt cuprinsuri REALE din
          arhiva firmei, ca punct de pornire — niciunul nu e „standardul". Editează după fișa de date.
        </div>
        {/* Fiecare model isi spune sursa si ce NU dovedeste. Un buton care zice doar „standard" ar
            invata omul sa nu mai deschida fisa de date — exact greseala care costa licitatii. */}
        {MODELE_CUPRINS.map(m => (
          <div key={m.cod} style={{ display:'flex', gap:10, alignItems:'flex-start', padding:'9px 0',
                                    borderTop:`1px solid ${G.border2}`, textAlign:'left' }}>
            <button onClick={() => onCreeaza(m)} disabled={busy}
              style={{ ...S.btnP, flex:'0 0 210px', opacity: busy ? .5 : 1, textAlign:'left' }}>
              📋 {m.nume} ({m.capitole.length})
            </button>
            <div style={{ flex:1, fontSize:12, color:G.muted, lineHeight:1.5 }}>
              <span style={{ color:G.dim }}>{m.sursa}</span>
              <div style={{ color:G.yellow, marginTop:2 }}>⚠ {m.atentie}</div>
            </div>
          </div>
        ))}
        <div>{btnAdauga}</div>
        <div style={{ textAlign:'left' }}>{formular}</div>
      </div>
    )
  }
  return (
    <div>
      <div style={{ ...S.card, overflow:'hidden' }}>
        {capitole.map((c, i) => {
          const n = numarPeCapitol.get(c.id) || 0
          const gol = !String(c.continut || '').trim() && !String(c.fisier_path || '').trim()
          // Antet de secțiune doar când secțiunea se schimbă față de capitolul de deasupra.
          const sect = String(c.sectiune || '').trim()
          const sectAnt = String(capitole[i - 1]?.sectiune || '').trim()
          const e = deschis === c.id
          const nObs = obsPeCapitol.get(c.id) || 0
          const insigna = INSIGNA_SURSA[c.sursa]
          return (
            <div key={c.id}>
              {sect && sect !== sectAnt && (
                <div style={{ padding:'8px 14px 4px', fontSize:11, fontWeight:700, letterSpacing:.4,
                              color:G.purple, textTransform:'uppercase', borderTop: i ? `1px solid ${G.border2}` : 'none' }}>
                  {sect}
                </div>
              )}
              <div style={{ display:'flex', gap:10, alignItems:'center', padding:'9px 14px',
                            borderTop: (i && !(sect && sect !== sectAnt)) ? `1px solid ${G.border2}` : 'none' }}>
                {/* eticheta reală din opis; nr e doar ordinea, iar „Cap. I" se repetă între secțiuni */}
                <span style={{ minWidth:24, color:G.dim, fontSize:12 }}>{c.eticheta || `${c.nr}.`}</span>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, color:G.text }}>
                    {c.titlu}
                    {c.formular && <span style={{ color:G.purple, fontSize:11, marginLeft:6 }}>{c.formular}</span>}
                    {!c.obligatoriu && <span style={{ color:G.dim, fontSize:11, marginLeft:6 }}>opțional</span>}
                  </div>
                </div>
                <span style={{ fontSize:12, color: n ? G.green : G.dim }}>{n} cerințe</span>
                {nObs > 0 && (
                  <span title={`${nObs} observații deschise pe capitolul ăsta`}
                        style={{ fontSize:11, color:G.orange, fontWeight:700 }}>✎ {nObs}</span>
                )}
                {/* Proveniența: se marchează doar ce NU e scris de om. O insignă pe fiecare rând
                    n-ar mai însemna nimic. */}
                {insigna && (
                  <span style={{ fontSize:10, fontWeight:700, color:insigna.c, border:`1px solid ${insigna.c}55`,
                                 borderRadius:4, padding:'1px 5px' }}>{insigna.t}</span>
                )}
                <span title={`versiunea ${c.versiune || 1}`} style={{ fontSize:11, color: (c.versiune || 1) > 1 ? G.blue : G.dim }}>
                  v{c.versiune || 1}
                </span>
                <span style={{ fontSize:11, color: gol && c.obligatoriu ? G.red : G.dim, width:64, textAlign:'right' }}>
                  {gol ? 'gol' : 'scris'}
                </span>
                {/* Lacătul: nici o regenerare nu rescrie un capitol blocat, indiferent de sursă. */}
                <button title={c.blocat ? 'Deblochează (regenerarea îl va putea rescrie)' : 'Blochează: nici o regenerare nu-l mai atinge'}
                  disabled={busy} onClick={() => onBlocheaza(c, !c.blocat)}
                  style={{ ...S.btn, padding:'2px 7px', fontSize:12, opacity: busy ? .5 : 1,
                           color: c.blocat ? G.yellow : G.dim }}>{c.blocat ? '🔒' : '🔓'}</button>
                <button disabled={busy} onClick={() => { setDeschis(e ? null : c.id); setEditez(null) }}
                  style={{ ...S.btn, padding:'2px 8px', fontSize:12 }}>{e ? 'închide' : '✎ text'}</button>
                {/* Ștergerea e permisă DOAR pe un capitol gol si fara cerinte atribuite: altfel
                    s-ar pierde tăcut legături din ofertare_pt_legaturi (ON DELETE CASCADE). */}
                <button
                  title={n || !gol ? 'Se poate șterge doar un capitol gol, fără cerințe atribuite' : 'Șterge capitolul'}
                  disabled={busy || n > 0 || !gol}
                  onClick={() => onSterge(c)}
                  style={{ ...S.btn, padding:'2px 7px', fontSize:12, opacity: (busy || n > 0 || !gol) ? .25 : 1 }}>🗑</button>
              </div>
              {e && (
                <div style={{ padding:'0 0 12px' }}>
                  {editez === c.id
                    ? <EditorCapitol capitol={c} busy={busy} onSalveaza={onSalveaza} onInchide={() => setEditez(null)} />
                    : (
                      <div style={{ padding:'0 14px 8px' }}>
                        <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:8 }}>
                          <button disabled={busy} onClick={() => setEditez(c.id)} style={S.btn}>
                            {gol ? '✎ Scrie capitolul' : '✎ Modifică textul'}
                          </button>
                          {/* Generarea costă bani la fiecare apăsare, deci nu e un buton pe care
                              îl apeși din curiozitate. Textul iese cu sursa='ai', adică poarta
                              rămâne roșie până când cineva îl citește și îl salvează. */}
                          <button disabled={busy || c.blocat || n === 0}
                            title={c.blocat ? 'Capitol blocat — deblochează-l întâi'
                              : n === 0 ? 'Atribuie-i întâi cerințe: fără ele iese text generic'
                              : 'Scrie capitolul pornind de la cerințele atribuite (costă un apel AI)'}
                            onClick={() => onGenereaza(c)}
                            style={{ ...S.btn, opacity: (busy || c.blocat || n === 0) ? .4 : 1 }}>
                            🤖 Generează din cerințe
                          </button>
                          {c.blocat && <span style={{ fontSize:12, color:G.yellow }}>capitol blocat — se poate edita la mână, dar nu se regenerează</span>}
                        </div>
                        {!gol && (
                          <pre style={{ margin:0, maxHeight:200, overflow:'auto', fontSize:12, lineHeight:1.55,
                                        color:G.muted, whiteSpace:'pre-wrap', wordBreak:'break-word',
                                        background:G.bg, border:`1px solid ${G.border2}`, borderRadius:6, padding:10 }}>
                            {c.continut}
                          </pre>
                        )}
                      </div>
                    )}
                  <div style={{ padding:'0 14px' }}>
                    <div style={{ ...S.lbl, marginBottom:6 }}>Istoricul capitolului</div>
                    <IstoricCapitol capitol={c} nume={nume} versiuni={versiuniPeCapitol.get(c.id) || []} />
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
      {btnAdauga}
      {formular}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// REZUMATUL din fișa licitației (tab)
// ─────────────────────────────────────────────────────────────────
export function PropunereRezumat({ st, onDeschide }) {
  if (!st) return <div style={{ color:G.muted, fontSize:13, padding:12 }}>Se încarcă…</div>
  // Același evaluator ca panoul. Copia veche de aici NU avea capitole_goale și
  // capitole_nescrise_de_om — cardul spunea „deschisă" când panoul bloca (P0.1, 13.09.2026).
  const blocat = evalueazaPoarta(st).stare === 'block'
  return (
    <div style={{ padding:'4px 0' }}>
      <div style={{ ...S.card, padding:14, borderColor: blocat ? G.red + '55' : G.green + '55', marginBottom:12 }}>
        <div style={{ fontSize:14, fontWeight:700, color: blocat ? G.red : G.green, marginBottom:6 }}>
          {blocat ? '🔴 NU se depune' : '🟢 Poarta e deschisă'}
        </div>
        <div style={{ fontSize:13, color:G.muted, lineHeight:1.6 }}>
          {st.de_raspuns} cerințe de răspuns ({st.de_raspuns - st.de_forma} propunere + {st.de_forma} formă) ·{' '}
          <b style={{ color: st.cu_capitol ? G.green : G.red }}>{st.cu_capitol} au capitol</b>
          {st.inchise_cu_dovada > 0 && <> · {st.inchise_cu_dovada} închise cu dovadă în registru</>}
          {st.capcane > 0 && <> · <b style={{ color:G.red }}>{st.capcane_descoperite} din {st.capcane} capcane de respingere, descoperite</b></>}
          {st.capitole === 0 && <> · cuprinsul propunerii nu e creat</>}
        </div>
      </div>
      <button onClick={onDeschide} style={S.btnP}>📑 Deschide matricea propunerii</button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// CONFORMITATEA — ce afirmă propunerea, față de ce are firma
// ─────────────────────────────────────────────────────────────────
const CULOARE_VERDICT = { block: G.red, warn: G.yellow, exceptat: G.dim, ok: G.green }
const ETICHETA_VERDICT = { block: 'BLOCHEAZĂ', warn: 'de verificat', exceptat: 'exceptat', ok: 'ok' }
// Autorizațiile externilor n-au nume de persoană în bază — doar numele fișierului scanat.
// Îl arătăm ca atare, ca omul să recunoască documentul pe care îl leagă.
const etichetaAut = a => (a.fisier_nume || a.observatii || `autorizația #${a.id}`).slice(0, 46)

function Conformitate({ afirmatii, tipuriAut = [], autExterne = [], onExcepta, onSetTip, onSetExtern, busy }) {
  // Ordonare dupa GRAVITATE. Nu prin .order('verdict') pe server: acolo sortarea e alfabetica
  // (block, exceptat, ok, warn), deci 'ok' ar urca inaintea lui 'warn' si problemele ar cadea la coada.
  const RANG = { block: 0, warn: 1, exceptat: 2, ok: 3 }
  const lista = useMemo(
    () => [...afirmatii].sort((a, b) => (RANG[a.verdict] ?? 9) - (RANG[b.verdict] ?? 9)),
    [afirmatii])
  if (afirmatii.length === 0) {
    return (
      <div style={{ ...S.card, padding:16, color:G.muted, fontSize:13, lineHeight:1.6 }}>
        Nicio afirmație încărcată. Aici intră ce <b>susține</b> propunerea despre firmă — oamenii
        nominalizați, utilajele, partenerii — ca să se poată confrunta cu ERP-ul înainte de depunere.
        <div style={{ marginTop:8, color:G.dim }}>
          La Motru, verificarea asta ar fi prins două lucruri: un sudor lichidat cu șase zile înainte
          de depunere, și un nume care nu există în firmă.
        </div>
      </div>
    )
  }
  return (
    <div style={{ ...S.card, overflow:'hidden' }}>
      {lista.map((a, i) => {
        const cul = CULOARE_VERDICT[a.verdict] || G.dim
        const motive = []
        if (a.om_negasit) motive.push('nu există în firmă sub numele ăsta')
        if (a.om_plecat)  motive.push(`plecat din firmă înainte de ${a.la_data || 'depunere'}`)
        if (a.autorizatii_expirate > 0) motive.push(`${a.autorizatii_expirate} autorizații expirate la acea dată`)
        if (a.extern_fara_disponibilitate) motive.push('extern — lipsește declarația de disponibilitate')
        if (a.autorizatie_extern_expirata) motive.push('autorizația externului era expirată la acea dată')
        if (a.calificare_lipsa) motive.push(`n-are ${a.tip_cerut_cod} valabil la acea dată`)
        if (a.doua_roluri) motive.push('aceeași persoană, două roluri')
        return (
          <div key={a.id} style={{ display:'flex', gap:10, alignItems:'flex-start', padding:'10px 14px',
                                   borderTop: i ? `1px solid ${G.border2}` : 'none' }}>
            <span style={{ fontSize:10, fontWeight:700, color:cul, minWidth:78, paddingTop:2 }}>
              {ETICHETA_VERDICT[a.verdict] || a.verdict}
            </span>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:13, color:G.text }}>
                {/* textul EXACT din propunere — omul trebuie să vadă ce scrie acolo, nu ce-am dedus */}
                „{a.text_brut}"
                {a.rol_propus && <span style={{ color:G.muted }}> — {a.rol_propus}</span>}
                {a.pagina && <span style={{ color:G.dim, fontSize:11 }}> · pag. {a.pagina}</span>}
              </div>
              {a.nume_in_erp && (
                <div style={{ fontSize:11, color:G.dim, marginTop:2 }}>
                  în ERP: {a.nume_in_erp}{a.functie_in_erp ? ` · ${a.functie_in_erp}` : ''}
                </div>
              )}
              {motive.length > 0 && (
                <div style={{ fontSize:11, color:cul, marginTop:3 }}>{motive.join(' · ')}</div>
              )}
              {a.exceptat && a.exceptat_motiv && (
                <div style={{ fontSize:11, color:G.dim, marginTop:3 }}>exceptat: {a.exceptat_motiv}</div>
              )}
            </div>
            {/* Persoană care NU e angajat: poate fi un terț legitim. Se leagă de autorizația lui
                și de declarația de disponibilitate — fișa de date o cere pe a doua. */}
            {a.fel === 'persoana' && !a.exceptat && !a.employee_id && (
              <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                <select value={a.autorizatie_id || ''} disabled={busy}
                  onChange={e => onSetExtern(a, { autorizatie_id: e.target.value ? Number(e.target.value) : null })}
                  title="Autorizația specialistului extern"
                  style={{ ...S.input, width:'auto', maxWidth:220, fontSize:11, padding:'3px 6px' }}>
                  <option value="">— extern: fără autorizație legată —</option>
                  {autExterne.map(x => <option key={x.id} value={x.id}>{etichetaAut(x)}</option>)}
                </select>
                {a.autorizatie_id && (
                  <select value={a.disponibilitate_id || ''} disabled={busy}
                    onChange={e => onSetExtern(a, { disponibilitate_id: e.target.value ? Number(e.target.value) : null })}
                    title="Declarația de disponibilitate a externului"
                    style={{ ...S.input, width:'auto', maxWidth:220, fontSize:11, padding:'3px 6px' }}>
                    <option value="">— fără declarație de disponibilitate —</option>
                    {autExterne.map(x => <option key={x.id} value={x.id}>{etichetaAut(x)}</option>)}
                  </select>
                )}
              </div>
            )}
            {a.fel === 'persoana' && !a.exceptat && (
              /* Calificarea ceruta de rol. Se verifica prin TIPUL autorizatiei
                 (hr_autorizatii_tipuri.cod), nu prin campurile de detaliu — alea sunt goale
                 legitim la tipurile care nu le cer. */
              <select value={a.tip_cerut_cod || ''} disabled={busy}
                onChange={e => onSetTip(a, e.target.value || null)}
                title="Ce autorizație cere rolul ăsta"
                style={{ ...S.input, width:'auto', maxWidth:190, fontSize:11, padding:'3px 6px' }}>
                <option value="">— calificare necerută —</option>
                {tipuriAut.map(t => <option key={t.cod} value={t.cod}>{t.cod} · {t.denumire.slice(0, 34)}</option>)}
              </select>
            )}
            {!a.exceptat && a.verdict !== 'ok' && (
              <button disabled={busy} onClick={() => onExcepta(a)}
                style={{ ...S.btn, padding:'2px 8px', fontSize:11, opacity: busy ? .5 : 1 }}>
                exceptează
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// PACHETUL DE ECHIPAMENTE — „infrastructura care va fi utilizată"
//
// Trei stări, nu două, si asta e decizia care conteaza. Masurat azi pe 288 de active in pool:
// 197 n-au NICIO scadenta in BD. Un filtru strict „doar valabile" ar lasa 75 si ar face firma
// sa para ca n-are utilaje. Deci se arata toate trei, bifate implicit doar cele valabile:
//   valabil     — are dovada si nu-i expirata la data depunerii
//   expirat     — are dovada, dar a expirat (16 azi, la 01.10.2026) — ASTEA se depun gresit acum
//   fara_dovezi — n-are nicio scadenta in sistem; nu-i o minciuna, e lista de lucru a Logisticii
// ─────────────────────────────────────────────────────────────────
const CULOARE_STATUS = { valabil: G.green, expirat: G.red, fara_dovezi: G.yellow }
const ETICHETA_STATUS = { valabil: 'valabile', expirat: 'expirate', fara_dovezi: 'fără dovezi în ERP' }

function PachetEchipamente({ randuri, laData, onGenereaza, busy, showToast }) {
  const [arata, setArata] = useState({ valabil: true, expirat: false, fara_dovezi: false })

  const peStatus = useMemo(() => {
    const m = { valabil: [], expirat: [], fara_dovezi: [] }
    for (const r of randuri) (m[r.status] || (m[r.status] = [])).push(r)
    return m
  }, [randuri])

  const alese = useMemo(() => randuri.filter(r => arata[r.status]), [randuri, arata])

  const copiaza = () => {
    const linii = alese.map(r => [
      r.denumire || '(fără denumire)', r.categorie_sub || r.categorie_tip || '',
      r.identificator || '(fără identificator)', r.an_fabricatie || '',
      r.itp_expira ? 'ITP ' + fmtZi(r.itp_expira) : '',
      r.verificare_expira ? 'verif. ' + fmtZi(r.verificare_expira) : '',
      r.status === 'fara_dovezi' ? 'FĂRĂ DOVEZI' : '',
    ].filter(Boolean).join(' · '))
    navigator.clipboard?.writeText(linii.join('\n'))
    showToast?.(`${linii.length} echipamente copiate.`, 'ok')
  }

  if (!randuri.length) {
    return (
      <div style={{ ...S.card, padding:14, textAlign:'center' }}>
        <div style={{ color:G.muted, fontSize:13, marginBottom:10 }}>
          Lista de echipamente se generează din Logistică, cu scadențele valabile la data depunerii
          {laData ? ` (${fmtZi(laData)})` : ''} — nu „azi". Ce se depune acum, la mână, e inventarul nefiltrat.
        </div>
        <button onClick={onGenereaza} disabled={busy} style={{ ...S.btnP, opacity: busy ? .5 : 1 }}>
          🚜 Generează lista de echipamente
        </button>
      </div>
    )
  }
  return (
    <div style={{ ...S.card, overflow:'hidden' }}>
      <div style={{ padding:'10px 14px', display:'flex', gap:12, alignItems:'center', flexWrap:'wrap' }}>
        {['valabil', 'expirat', 'fara_dovezi'].map(k => (
          <label key={k} style={{ fontSize:12, color:CULOARE_STATUS[k], display:'flex', gap:5, alignItems:'center' }}>
            <input type="checkbox" checked={!!arata[k]} onChange={e => setArata({ ...arata, [k]: e.target.checked })} />
            {(peStatus[k] || []).length} {ETICHETA_STATUS[k]}
          </label>
        ))}
        <span style={{ fontSize:12, color:G.muted, marginLeft:'auto' }}>la {fmtZi(laData) || 'azi'}</span>
        <button onClick={onGenereaza} disabled={busy} style={S.btn}>↻</button>
        {alese.length > 0 && <button onClick={copiaza} style={S.btn}>📋 Copiază {alese.length}</button>}
      </div>
      {(peStatus.expirat || []).length > 0 && !arata.expirat && (
        <div style={{ padding:'8px 14px', borderTop:`1px solid ${G.border2}`, fontSize:12, color:G.red }}>
          {peStatus.expirat.length} echipamente au dovada expirată la data depunerii. Bifează „expirate" ca să le vezi —
          alea se depun greșit dacă lista se face la mână din inventar.
        </div>
      )}
      <div style={{ maxHeight:320, overflow:'auto' }}>
        {alese.map(r => (
          <div key={r.activ_id} style={{ display:'flex', gap:10, alignItems:'center', padding:'6px 14px',
                                         borderTop:`1px solid ${G.border2}`, fontSize:12 }}>
            <span style={{ width:8, height:8, borderRadius:4, background:CULOARE_STATUS[r.status], flexShrink:0 }} />
            <span style={{ flex:1, color:G.text }}>{r.denumire || <i style={{ color:G.dim }}>fără denumire</i>}</span>
            <span style={{ color:G.muted, width:130 }}>{r.categorie_sub || r.categorie_tip || '—'}</span>
            <span style={{ color:G.muted, width:130 }}>{r.identificator || <i style={{ color:G.red }}>fără identificator</i>}</span>
            <span style={{ color:G.dim, width:46 }}>{r.an_fabricatie || ''}</span>
            <span style={{ color: r.status === 'expirat' ? G.red : G.dim, width:96, textAlign:'right' }}>
              {r.itp_expira ? 'ITP ' + fmtZi(r.itp_expira) : r.verificare_expira ? 'vf. ' + fmtZi(r.verificare_expira) : '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// PACHETUL DE PERSONAL — ce se trimite celui care scrie propunerea
// ─────────────────────────────────────────────────────────────────
function PachetPersonal({ randuri, laData, onGenereaza, busy, showToast }) {
  // Grupat pe tip. ATENȚIE: un om poate avea mai multe autorizații de același tip, deci
  // numărăm OAMENI (Set de employee_id), nu rânduri. La Motru: 6 sudori PEHD, 18 autorizații.
  const peTip = useMemo(() => {
    const m = new Map()
    for (const r of randuri) {
      if (!m.has(r.tip_cod)) m.set(r.tip_cod, { denumire: r.tip_denumire, oameni: new Map() })
      m.get(r.tip_cod).oameni.set(r.employee_id, r.nume)
    }
    return [...m.entries()]
      .map(([cod, v]) => ({ cod, denumire: v.denumire, nume: [...v.oameni.values()].sort() }))
      .sort((a, b) => b.nume.length - a.nume.length)
  }, [randuri])

  const copiaza = () => {
    const text = peTip.map(g => `${g.cod} — ${g.denumire} (${g.nume.length}):\n  ${g.nume.join('\n  ')}`).join('\n\n')
    navigator.clipboard?.writeText(`Personal cu autorizații valabile la ${laData || 'azi'}\n\n${text}`)
      .then(() => showToast?.('Pachetul e în clipboard.', 'ok'))
      .catch(() => showToast?.('Nu s-a putut copia.', 'err'))
  }

  return (
    <div style={{ ...S.card, padding:14 }}>
      <div style={{ color:G.muted, fontSize:12, lineHeight:1.6, marginBottom:10 }}>
        Cine scrie propunerea cere lista de personal și o primește din fișiere adunate manual.
        Așa a ajuns la Motru un sudor lichidat cu șase zile înainte de depunere. Lista de aici se
        face din ERP, <b>la data depunerii</b>{laData ? ` (${laData})` : ''}, deci n-are cum să fie veche.
      </div>
      <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
        <button onClick={onGenereaza} disabled={busy} style={{ ...S.btnP, opacity: busy ? .5 : 1 }}>
          👥 Generează pachetul de personal
        </button>
        {randuri.length > 0 && <button onClick={copiaza} style={S.btn}>📋 Copiază</button>}
      </div>
      {randuri.length > 0 && (
        <div style={{ marginTop:12, display:'flex', flexDirection:'column', gap:8 }}>
          {peTip.map(g => (
            <div key={g.cod}>
              <div style={{ fontSize:12, color:G.ofertare, fontWeight:600 }}>
                {g.cod} <span style={{ color:G.dim, fontWeight:400 }}>· {g.denumire}</span>
                <span style={{ color:G.green, marginLeft:6 }}>{g.nume.length} {g.nume.length === 1 ? 'om' : 'oameni'}</span>
              </div>
              <div style={{ fontSize:12, color:G.muted, marginLeft:10 }}>{g.nume.join(' · ')}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// H4 — GARANȚIA CA OBIECT: luni + momentul de start, cerut vs oferit.
// La Hoghilag momentul (PIF vs recepție) diferea între formular și capitol.
// ─────────────────────────────────────────────────────────────────
const RX_LUNI = /(\d{1,3})\s*(?:de\s*)?luni/i
function ghicesteMoment(t = '') {
  if (/punere[a]? [îi]n func|\bPIF\b/i.test(t)) return 'pif'
  if (/recep[țt]i[ae] final/i.test(t)) return 'receptie_finala'
  if (/recep[țt]i/i.test(t)) return 'receptie_terminare'
  if (/livrar/i.test(t)) return 'livrare'
  if (/semnar/i.test(t)) return 'semnare_contract'
  return ''
}
function Garantie({ g, cerinte, onSalveaza, busy, nume }) {
  const [f, setF] = useState({ cerut_luni: '', cerut_moment: '', cerut_cerinta_id: '', oferit_luni: '', oferit_moment: '', oferit_formular: '', oferit_justificare: '' })
  useEffect(() => { setF({
    cerut_luni: g?.cerut_luni ?? '', cerut_moment: g?.cerut_moment ?? '', cerut_cerinta_id: g?.cerut_cerinta_id ?? '',
    oferit_luni: g?.oferit_luni ?? '', oferit_moment: g?.oferit_moment ?? '', oferit_formular: g?.oferit_formular ?? '', oferit_justificare: g?.oferit_justificare ?? '',
  }) }, [g])
  // Candidate: cerințele care vorbesc de garanția LUCRĂRILOR cu un număr de luni (nu produse, nu participare).
  const candidate = useMemo(() => cerinte.filter(c => /garan[țt]i/i.test(c.text_cerinta || '') && RX_LUNI.test(c.text_cerinta || '')
    && /lucr[ăa]ri|punere|recep[țt]i/i.test(c.text_cerinta || '') && !/participare|bun[ăa] execu[țt]ie|supap|filtr|produs/i.test(c.text_cerinta || '')), [cerinte])
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const dinCerinta = (c) => setF(x => ({ ...x, cerut_cerinta_id: c.id, cerut_luni: Number((c.text_cerinta.match(RX_LUNI) || [])[1]) || x.cerut_luni, cerut_moment: ghicesteMoment(c.text_cerinta) || x.cerut_moment }))
  const sel = { ...S.input, width:'auto', minWidth:200 }
  const Mom = ({ k }) => (
    <select value={f[k]} onChange={e => set(k, e.target.value)} style={sel}>
      <option value="">— momentul de start —</option>
      {Object.entries(MOMENTE_GARANTIE).map(([v, l]) => <option key={v} value={v}>de la {l}</option>)}
    </select>
  )
  return (
    <div style={{ ...S.card, padding:14 }}>
      <div style={{ color:G.muted, fontSize:12, lineHeight:1.6, marginBottom:10 }}>
        Garanția nu e o propoziție, e două numere: <b>câte luni</b> și <b>de când</b>. Ce scrii aici e ce intră în
        formular și ce verifică poarta în toate capitolele care o pomenesc.
        {g?.confirmat_la && <span style={{ color:G.green }}> · confirmată de {nume?.(g.confirmat_de) || 'cineva'} la {String(g.confirmat_la).slice(0, 10)}</span>}
      </div>
      {candidate.length > 0 && (
        <div style={{ marginBottom:10 }}>
          <div style={{ fontSize:11, color:G.dim, marginBottom:4 }}>Din cerințe (click = preia luni + moment):</div>
          {candidate.map(c => (
            <div key={c.id} onClick={() => dinCerinta(c)} title="preia în „cerut”"
              style={{ fontSize:12, color: String(f.cerut_cerinta_id) === String(c.id) ? G.ofertare : G.muted, cursor:'pointer', padding:'2px 0' }}>
              {String(f.cerut_cerinta_id) === String(c.id) ? '● ' : '○ '}{c.text_cerinta}
            </div>
          ))}
        </div>
      )}
      <div style={{ display:'grid', gridTemplateColumns:'auto 1fr', gap:8, alignItems:'center', fontSize:12 }}>
        <span style={{ color:G.dim }}>Cerut</span>
        <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
          <input type="number" min="0" value={f.cerut_luni} onChange={e => set('cerut_luni', e.target.value)} placeholder="luni" style={{ ...S.input, width:80 }} />
          <Mom k="cerut_moment" />
        </div>
        <span style={{ color:G.dim }}>Oferit</span>
        <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
          <input type="number" min="0" value={f.oferit_luni} onChange={e => set('oferit_luni', e.target.value)} placeholder="luni" style={{ ...S.input, width:80 }} />
          <Mom k="oferit_moment" />
          <input value={f.oferit_formular} onChange={e => set('oferit_formular', e.target.value)} placeholder="formularul (ex. Formular 5)" style={{ ...S.input, width:200 }} />
        </div>
      </div>
      {Number(f.oferit_luni) > Number(f.cerut_luni || 0) && (
        <div style={{ marginTop:8 }}>
          <div style={{ fontSize:11, color:G.dim, marginBottom:4 }}>
            Oferim peste minim — documentația cere justificarea prin metodologie și dovezi de calitate:
          </div>
          <textarea value={f.oferit_justificare} onChange={e => set('oferit_justificare', e.target.value)} rows={3}
            placeholder="de ce putem da mai mult: materiale, proceduri, garanții de la furnizori…"
            style={{ ...S.input, width:'100%', resize:'vertical' }} />
        </div>
      )}
      <div style={{ marginTop:10 }}>
        <button onClick={() => onSalveaza(f)} disabled={busy || !f.oferit_luni || !f.oferit_moment} style={{ ...S.btnP, opacity: (busy || !f.oferit_luni || !f.oferit_moment) ? .5 : 1 }}>
          ✓ Confirm garanția
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// PANOUL
// ─────────────────────────────────────────────────────────────────
export default function PropunerePanel({ licitatii = [], showToast, initialLicId = null, onInapoi = null }) {
  const [licId, setLicId] = useState(initialLicId || (licitatii[0] && licitatii[0].id) || null)
  const [st, setSt] = useState(null)
  const [capitole, setCapitole] = useState([])
  const [cerinte, setCerinte] = useState([])
  const [legaturi, setLegaturi] = useState([])
  const [dovedite, setDovedite] = useState(new Set())
  const [afirmatii, setAfirmatii] = useState([])
  const [tipuriAut, setTipuriAut] = useState([])
  const [autExterne, setAutExterne] = useState([])
  const [pachet, setPachet] = useState([])
  const [echipamente, setEchipamente] = useState([])
  const [documente, setDocumente] = useState([])
  const [pachete, setPachete] = useState([])
  const [observatii, setObservatii] = useState([])
  const [versiuni, setVersiuni] = useState([])
  const [garantie, setGarantie] = useState(null)
  const [profiluri, setProfiluri] = useState(new Map())
  const [filtru, setFiltru] = useState('fara')
  const [sel, setSel] = useState(new Set())
  const [busy, setBusy] = useState(false)
  const [eroare, setEroare] = useState(null)

  const lic = licitatii.find(l => String(l.id) === String(licId)) || null

  const load = async (id) => {
    if (!id) return
    setEroare(null)
    // Filtrele trebuie să fie IDENTICE cu cele din v_ofertare_pt_stare, altfel poarta
    // numără altceva decât arată lista. limit(5000): PostgREST taie implicit la 1000.
    const [rSt, rCap, rCer, rAfi, rTip, rExt, rObs, rProf, rDoc, rPac, rGar] = await Promise.all([
      supabase.from('v_ofertare_pt_stare').select('*').eq('licitatie_id', id).maybeSingle(),
      supabase.from('ofertare_pt_capitole').select('*').eq('licitatie_id', id).order('nr'),
      supabase.from('ofertare_cerinte')
        .select('id, nr_ordine, text_cerinta, tip, sursa_sectiune, sursa_pagina')
        .eq('licitatie_id', id).in('tip', ['propunere','forma'])
        .is('inlocuita_de', null).is('duplicat_al', null)
        .order('nr_ordine').limit(5000),
      supabase.from('v_ofertare_pt_conformitate').select('*').eq('licitatie_id', id)
        .order('text_brut').limit(2000),
      supabase.from('hr_autorizatii_tipuri').select('cod, denumire, categorie')
        .eq('activ', true).order('categorie').order('cod'),
      // Autorizatiile FARA angajat = specialistii externi (terti sustinatori). Numele lor exista
      // doar in fisier_nume/observatii, deci legatura o face omul, nu o ghicim noi.
      supabase.from('hr_autorizatii').select('id, fisier_nume, observatii, data_expirare, tip_id')
        .is('employee_id', null).is('deleted_at', null).order('id').limit(500),
      supabase.from('ofertare_pt_observatii').select('*').eq('licitatie_id', id)
        .order('cerut_la', { ascending: false }).limit(1000),
      // Numele celor care au cerut/rezolvat. Fara ele istoricul arata uuid-uri, adica nimic.
      supabase.from('profiles').select('id, name').limit(500),
      supabase.from('ofertare_documente_atribuire').select('id, nume_original, revizie, pagini').eq('licitatie_id', id).order('id').limit(500),
      supabase.from('ofertare_pt_pachet').select('*, fisiere:ofertare_pt_pachet_fisiere(rol, nume, sha256, size_bytes, sursa_versiune)')
        .eq('licitatie_id', id).order('versiune', { ascending: false }).limit(50),
      supabase.from('ofertare_pt_garantie').select('*').eq('licitatie_id', id).maybeSingle(),
    ])
    const err = rSt.error || rCap.error || rCer.error || rAfi.error || rTip.error || rExt.error || rObs.error
    if (err) { setEroare(err.message); showToast?.('Nu s-au putut încărca datele: ' + err.message, 'err'); return }
    const cer = rCer.data || []
    setSt(rSt.data || null); setCapitole(rCap.data || []); setCerinte(cer)
    setAfirmatii(rAfi.data || []); setTipuriAut(rTip.data || []); setAutExterne(rExt.data || [])
    setObservatii(rObs.data || [])
    setDocumente(rDoc.data || [])
    setPachete(rPac.data || [])
    setGarantie(rGar.data || null)
    // profiles poate fi inchis de RLS pentru unii; atunci ramanem fara nume, nu fara ecran.
    setProfiluri(new Map((rProf.data || []).map(p => [p.id, p.name])))
    setPachet([]); setEchipamente([])  // pachetele-s per licitatie: altfel raman cele de la precedenta

    // Istoricul, pentru capitolele licitatiei asteia. Se cere dupa capitole fiindca tabelul de
    // versiuni n-are licitatie_id — atarna de capitol, si asa ramane o singura sursa de adevar.
    const capIds = (rCap.data || []).map(c => c.id)
    if (capIds.length) {
      const rVer = await supabase.from('ofertare_pt_capitole_versiuni')
        .select('*').in('capitol_id', capIds).order('versiune', { ascending: false }).limit(2000)
      if (rVer.error) { showToast?.('Istoricul nu s-a putut citi: ' + rVer.error.message, 'err'); setVersiuni([]) }
      else setVersiuni(rVer.data || [])
    } else setVersiuni([])

    const ids = cer.map(c => c.id)
    if (ids.length) {
      const [rLeg, rAcop] = await Promise.all([
        supabase.from('ofertare_pt_legaturi').select('id, cerinta_id, capitol_id, fel, motiv, stare, locator_raspuns, verificat_la_versiunea, confirmat_la').in('cerinta_id', ids).limit(10000),
        supabase.from('ofertare_acoperire').select('cerinta_id').in('cerinta_id', ids).in('status', ['acoperit','acoperit_partener']).limit(10000),
      ])
      if (rLeg.error || rAcop.error) {
        const m = (rLeg.error || rAcop.error).message
        setEroare(m); showToast?.('Legăturile nu s-au putut citi: ' + m, 'err'); return
      }
      setLegaturi(rLeg.data || [])
      setDovedite(new Set((rAcop.data || []).map(a => a.cerinta_id)))
    } else { setLegaturi([]); setDovedite(new Set()) }
  }

  // showToast și load NU intră în deps: lecția casei (useCallback/useEffect cu showToast = loop infinit).
  useEffect(() => { setSel(new Set()); load(licId) }, [licId])


  // H4 — upsert-ul garanției; ștampila = userul curent + acum. Reîncărcăm view-ul, că rândul porții vine de acolo.
  const salveazaGarantie = async (f) => {
    setBusy(true)
    const { data: u } = await supabase.auth.getUser()
    const n = v => (v === '' || v == null) ? null : Number(v)
    const { error } = await supabase.from('ofertare_pt_garantie').upsert({
      licitatie_id: licId, cerut_luni: n(f.cerut_luni), cerut_moment: f.cerut_moment || null,
      cerut_cerinta_id: n(f.cerut_cerinta_id), oferit_luni: n(f.oferit_luni), oferit_moment: f.oferit_moment || null,
      oferit_formular: f.oferit_formular || null, oferit_justificare: f.oferit_justificare || null, confirmat_de: u?.user?.id || null, confirmat_la: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    setBusy(false)
    if (error) { showToast?.('Nu s-a salvat garanția: ' + error.message, 'err'); return }
    showToast?.('Garanția e confirmată.', 'ok'); load(licId)
  }

  const numarPeCapitol = useMemo(() => {
    const m = new Map()
    for (const l of legaturi) if (l.fel === 'capitol') m.set(l.capitol_id, (m.get(l.capitol_id) || 0) + 1)
    return m
  }, [legaturi])

  // Crearea cuprinsului e BUTON, nu useEffect: în StrictMode efectul rulează de două ori
  // și ar insera de două ori. UNIQUE(licitatie_id, nr) e plasa de siguranță.
  const creeazaCuprins = async (model) => {
    if (!licId || !model?.capitole?.length) return
    setBusy(true)
    const { error } = await supabase.from('ofertare_pt_capitole')
      .insert(model.capitole.map(c => ({ ...c, licitatie_id: licId, sursa: 'sablon' })))
    setBusy(false)
    if (error && error.code !== '23505') { showToast?.('Cuprinsul nu s-a creat: ' + error.message, 'err'); return }
    if (error) showToast?.('Cuprinsul exista deja.', 'ok')
    else showToast?.(`Cuprins pornit de la „${model.nume}" (${model.capitole.length} capitole). ` +
      `Confruntă-l ACUM cu fișa de date, la „Modul de prezentare al propunerii tehnice" — modelul e un punct de pornire, nu o regulă.`, 'ok')
    await load(licId)
  }

  // Capitol adaugat de mana. `nr` e doar ordinea: il punem la coada, ca sa nu se ciocneasca de
  // UNIQUE(licitatie_id, nr). Eticheta reala ("Cap. I", "Anexa 7") sta separat, fiindca
  // numerotarea se repeta intre sectiuni si nu poate fi si cheie de ordine.
  const adaugaCapitol = async ({ sectiune, eticheta, titlu, obligatoriu }) => {
    if (!licId || !String(titlu || '').trim()) return false
    const nr = capitole.reduce((m, c) => Math.max(m, c.nr), 0) + 1
    if (nr > 40) { showToast?.('Cuprinsul are deja 40 de capitole — limita tabelului.', 'err'); return false }
    setBusy(true)
    const { error } = await supabase.from('ofertare_pt_capitole').insert({
      licitatie_id: licId, nr, titlu: titlu.trim(), obligatoriu: !!obligatoriu,
      sectiune: String(sectiune || '').trim() || null,
      eticheta: String(eticheta || '').trim() || null,
    })
    setBusy(false)
    if (error) { showToast?.('Capitolul nu s-a adăugat: ' + error.message, 'err'); return false }
    showToast?.('Capitol adăugat.', 'ok')
    await load(licId)
    return true
  }

  // Sterge doar capitole goale si fara cerinte: butonul e deja dezactivat altfel, dar verificam
  // si aici, fiindca ofertare_pt_legaturi are ON DELETE CASCADE si ar taia tacut legaturi.
  const stergeCapitol = async (c) => {
    if (!c?.id) return
    if ((numarPeCapitol.get(c.id) || 0) > 0) { showToast?.('Capitolul are cerințe atribuite. Mută-le întâi.', 'err'); return }
    if (String(c.continut || '').trim() || String(c.fisier_path || '').trim()) { showToast?.('Capitolul are conținut scris.', 'err'); return }
    if (!window.confirm(`Ștergi capitolul „${c.titlu}"?`)) return
    setBusy(true)
    const { error } = await supabase.from('ofertare_pt_capitole').delete().eq('id', c.id)
    setBusy(false)
    if (error) { showToast?.('Ștergerea a eșuat: ' + error.message, 'err'); return }
    showToast?.('Capitol șters.', 'ok')
    await load(licId)
  }

  // Exceptarea unei afirmatii. Motivul e OBLIGATORIU si la nivel de baza (CHECK), nu doar aici:
  // o exceptie fara motiv scris e cum ar fi sa stingi semaforul fara sa spui de ce.
  const exceptaAfirmatie = async (a) => {
    if (!a?.id) return
    const motiv = window.prompt(`De ce se acceptă „${a.text_brut}"?\n(ex. „e Trusu Dorel, greșeală de tastare" / „extern, are contract de prestări servicii")`)
    if (!motiv || !motiv.trim()) return
    setBusy(true)
    const { error } = await supabase.from('ofertare_pt_afirmatii')
      .update({ exceptat: true, exceptat_motiv: motiv.trim() }).eq('id', a.id)
    setBusy(false)
    if (error) { showToast?.('Excepția n-a fost salvată: ' + error.message, 'err'); return }
    showToast?.('Afirmație exceptată.', 'ok')
    await load(licId)
  }

  const setTipCerut = async (a, cod) => {
    if (!a?.id) return
    setBusy(true)
    const { error } = await supabase.from('ofertare_pt_afirmatii')
      .update({ tip_cerut_cod: cod }).eq('id', a.id)
    setBusy(false)
    if (error) { showToast?.('Nu s-a salvat calificarea cerută: ' + error.message, 'err'); return }
    await load(licId)
  }

  const setExtern = async (a, patch) => {
    if (!a?.id) return
    setBusy(true)
    const { error } = await supabase.from('ofertare_pt_afirmatii').update(patch).eq('id', a.id)
    setBusy(false)
    if (error) { showToast?.('Nu s-a salvat legătura cu externul: ' + error.message, 'err'); return }
    await load(licId)
  }

  const genereazaPachet = async () => {
    setBusy(true)
    // la data depunerii, nu "azi": lista trebuie sa fie cea valabila cand se depune
    const laData = lic?.termen_depunere ? String(lic.termen_depunere).slice(0, 10) : null
    const { data, error } = await supabase.rpc('fn_ofertare_personal_disponibil',
      laData ? { p_la_data: laData } : {})
    setBusy(false)
    if (error) { showToast?.('Pachetul nu s-a generat: ' + error.message, 'err'); return }
    setPachet(data || [])
    showToast?.(`${new Set((data || []).map(r => r.employee_id)).size} oameni cu autorizații valabile.`, 'ok')
  }

  const obsPeCapitol = useMemo(() => {
    const m = new Map()
    for (const o of observatii) if (o.stare === 'deschisa' && o.capitol_id) m.set(o.capitol_id, (m.get(o.capitol_id) || 0) + 1)
    return m
  }, [observatii])

  const versiuniPeCapitol = useMemo(() => {
    const m = new Map()
    for (const v of versiuni) { if (!m.has(v.capitol_id)) m.set(v.capitol_id, []); m.get(v.capitol_id).push(v) }
    return m
  }, [versiuni])

  const nume = id => profiluri.get(id) || (id ? 'utilizator necunoscut' : '—')

  // Salvarea textului unui capitol. Versiunea NU se incrementeaza de aici: o face triggerul
  // trg_pt_capitol_versioneaza, care scrie si textul vechi in istoric. Daca ar face-o UI-ul,
  // orice scriere din alt loc (import, edge function, fix la mana) ar sari peste istoric.
  //
  // sursa: 'om' — scrisul de mana bate proveniența anterioara, iar generatorul nu mai atinge
  // capitolul. Asta e regula „nu se regenereaza ce a atins un om".
  const salveazaCapitol = async (c, text) => {
    if (!c?.id) return false
    setBusy(true)
    const { error } = await supabase.from('ofertare_pt_capitole')
      .update({ continut: text, sursa: 'om' }).eq('id', c.id)
    setBusy(false)
    if (error) { showToast?.('Textul nu s-a salvat: ' + error.message, 'err'); return false }
    showToast?.(`Capitolul „${c.titlu}" salvat ca v${(c.versiune || 1) + 1}.`, 'ok')
    await load(licId)
    return true
  }

  // Generarea unui capitol. Regula de fond e in edge function, nu aici: textul iese cu
  // sursa='ai', deci poarta blocheaza depunerea pana cand un om il deschide, il citeste si il
  // salveaza. Aici doar cerem confirmarea cand s-ar rescrie peste munca unui om — functia
  // refuza din prima si ne spune ca trebuie confirmare, nu ghicim noi.
  const genereazaCapitol = async (c, peste_om = false) => {
    if (!c?.id) return
    const instructiune = window.prompt(
      `Ce trebuie să conțină „${c.titlu}", peste cerințele atribuite?
(lasă gol dacă n-ai nimic special de spus)`)
    if (instructiune === null) return   // Anulează — nu generăm, nu cheltuim
    setBusy(true)
    const { data, error } = await supabase.functions.invoke('ofertare-genereaza-capitol', {
      body: { capitol_id: c.id, instructiune: instructiune.trim() || null, peste_om },
    })
    setBusy(false)
    if (error) { showToast?.('Generarea a eșuat: ' + error.message, 'err'); return }
    if (data?.cere_confirmare) {
      if (window.confirm(`„${c.titlu}" are text scris de om (v${data.versiune}).
Îl rescrii? Textul de acum rămâne în istoric.`))
        return genereazaCapitol(c, true)
      return
    }
    if (data?.error) { showToast?.(data.error, 'err'); return }
    const g = data?.goluri_de_completat || 0
    showToast?.(
      `Capitol generat din ${data?.cerinte} cerințe (v${data?.versiune_noua}).` +
      (g ? ` ${g} locuri marcate [DE COMPLETAT] — alea sunt faptele pe care nu le-a inventat.` : '') +
      ' Citește-l și salvează-l: până atunci poarta stă roșie.',
      g ? 'err' : 'ok')
    await load(licId)
  }

  const blocheazaCapitol = async (c, val) => {
    if (!c?.id) return
    setBusy(true)
    const { error } = await supabase.from('ofertare_pt_capitole').update({ blocat: !!val }).eq('id', c.id)
    setBusy(false)
    if (error) { showToast?.('Nu s-a putut schimba lacătul: ' + error.message, 'err'); return }
    await load(licId)
  }

  const adaugaObservatie = async ({ capitol_id, text }) => {
    if (!licId || !String(text || '').trim()) return false
    setBusy(true)
    const { error } = await supabase.from('ofertare_pt_observatii').insert({
      licitatie_id: licId, capitol_id: capitol_id ? Number(capitol_id) : null, text: text.trim(),
    })
    setBusy(false)
    if (error) { showToast?.('Observația nu s-a trimis: ' + error.message, 'err'); return false }
    showToast?.('Observație trimisă.', 'ok')
    await load(licId)
    return true
  }

  // Inchiderea cere raspuns scris — si aici, si in BD (CHECK). O observatie inchisa tacut
  // e exact felul in care se pierd modificarile cerute intre doua revizii.
  // Versiunea notata e cea a capitolului IN MOMENTUL inchiderii: asa se vede in ce revizie
  // a intrat modificarea, fara sa scrie nimeni un raport de mana.
  const inchideObservatie = async (o, stare, cap) => {
    if (!o?.id) return
    const intrebare = stare === 'rezolvata'
      ? 'Ce ai schimbat, concret?'
      : 'De ce nu se face?'
    const raspuns = window.prompt(intrebare)
    if (!raspuns || !raspuns.trim()) return
    setBusy(true)
    const { error } = await supabase.from('ofertare_pt_observatii').update({
      stare, raspuns: raspuns.trim(), rezolvat_la: new Date().toISOString(),
      rezolvat_in_versiunea: stare === 'rezolvata' ? (cap?.versiune ?? null) : null,
    }).eq('id', o.id)
    setBusy(false)
    if (error) { showToast?.('Observația nu s-a închis: ' + error.message, 'err'); return }
    showToast?.(stare === 'rezolvata' ? 'Observație rezolvată.' : 'Observație respinsă, cu motiv.', 'ok')
    await load(licId)
  }

  const genereazaEchipamente = async () => {
    setBusy(true)
    const laData = lic?.termen_depunere ? String(lic.termen_depunere).slice(0, 10) : null
    const { data, error } = await supabase.rpc('fn_ofertare_echipamente_disponibile',
      laData ? { p_la_data: laData } : {})
    setBusy(false)
    if (error) { showToast?.('Lista de echipamente nu s-a generat: ' + error.message, 'err'); return }
    setEchipamente(data || [])
    const exp = (data || []).filter(r => r.status === 'expirat').length
    showToast?.(`${(data || []).filter(r => r.status === 'valabil').length} echipamente cu dovezi valabile` +
      (exp ? `, ${exp} cu dovada EXPIRATĂ la data depunerii.` : '.'), exp ? 'err' : 'ok')
  }

  // Exportul: doua fisiere, nu unul. Borderoul e piesa separata din dosar, iar propunerea o
  // deschide omul in Word ca sa puna cuprinsul (F9) si sa verifice inainte de tiparire.
  const exporta = async (fel) => {
    if (!capitole.length) { showToast?.('Nu există capitole de exportat.', 'err'); return }
    setBusy(true)
    try {
      const arg = { licitatie: lic, capitole }
      if (fel === 'borderou') await descarcaDocx(construiesteBorderou(arg), numeFisier('Borderou_PT', lic))
      else await descarcaDocx(construiestePropunere(arg), numeFisier('Propunere_tehnica', lic))
      const goale = capitole.filter(c => c.obligatoriu && !String(c.continut || '').trim() && !String(c.fisier_path || '').trim()).length
      showToast?.(goale
        ? `Exportat. ATENȚIE: ${goale} capitole obligatorii sunt necompletate și apar marcate roșu în document.`
        : 'Exportat. Deschide în Word și apasă F9 pe cuprins ca să se numeroteze paginile.', goale ? 'err' : 'ok')
    } catch (e) {
      showToast?.('Exportul a eșuat: ' + (e?.message || e), 'err')
    }
    setBusy(false)
  }

  // P0.3 — verificarea umana. Stampila = confirmat_de (userul curent) + confirmat_la + versiunea
  // capitolului ACUM. Daca textul se schimba dupa, versiunea creste si cerinta redevine
  // neverificata (view-ul compara versiunile). Locatorul raspunsului e cerut, nu optional: o
  // verificare care nu spune UNDE e raspunsul nu poate fi reverificata de altcineva.
  const verificaLegatura = async (leg, cap) => {
    if (!leg?.id) return
    const loc = window.prompt(`Unde în „${cap.titlu}" e răspunsul? (ex. „5.8.4", „paragraful 3", „tabelul de la p. 2")`, leg.locator_raspuns || '')
    if (loc === null || !loc.trim()) return
    setBusy(true)
    const { data: u } = await supabase.auth.getUser()
    const { error } = await supabase.from('ofertare_pt_legaturi').update({
      stare: 'verificata', locator_raspuns: loc.trim(), constatare: null, severitate: null,
      confirmat_de: u?.user?.id || null, confirmat_la: new Date().toISOString(),
      verificat_la_versiunea: cap.versiune || 1,
    }).eq('id', leg.id)
    setBusy(false)
    if (error) { showToast?.('Verificarea nu s-a salvat: ' + error.message, 'err'); return }
    showToast?.(`Verificată la v${cap.versiune || 1}.`, 'ok')
    await load(licId)
  }

  const blocheazaLegatura = async (leg) => {
    if (!leg?.id) return
    const c = window.prompt('De ce NU satisface răspunsul cerința? (constatarea rămâne pe cerință)', leg.constatare || '')
    if (c === null || !c.trim()) return
    setBusy(true)
    const { error } = await supabase.from('ofertare_pt_legaturi').update({
      stare: 'blocata', constatare: c.trim(), severitate: 'blocant',
    }).eq('id', leg.id)
    setBusy(false)
    if (error) { showToast?.('Blocarea nu s-a salvat: ' + error.message, 'err'); return }
    showToast?.('Cerință blocată, cu constatare.', 'ok')
    await load(licId)
  }

  // Dovada: document din documentatia de atribuire + locator local (pagina/capitol in document).
  // Pagina GLOBALA (in dosarul asamblat) nu se cere aici — se stie abia la asamblare (P0.5).
  const adaugaDovada = async (leg, docs) => {
    if (!leg?.id) return
    if (!docs.length) { showToast?.('Licitația n-are documente încărcate din care să legi o dovadă.', 'err'); return }
    const lista = docs.slice(0, 40).map((d, i) => `${i + 1}. ${d.nume_original}${d.revizie ? ' (rev. ' + d.revizie + ')' : ''}`).join('\n')
    const ales = window.prompt(`Care document e dovada? Scrie numărul:\n${lista}`)
    const d = docs[Number(ales) - 1]
    if (!d) return
    const loc = window.prompt(`Unde în „${d.nume_original}"? (pagină / capitol / rând)`)
    if (loc === null || !loc.trim()) return
    const pg = Number((loc.match(/\d+/) || [])[0]) || null
    setBusy(true)
    const { error } = await supabase.from('ofertare_pt_dovezi').insert({
      legatura_id: leg.id, tip_dovada: 'document_atribuire', document_id: d.id,
      document_revizie: d.revizie || null, locator_local: loc.trim(), pagina_locala: pg,
    })
    if (!error && leg.stare === 'atribuita') {
      await supabase.from('ofertare_pt_legaturi').update({ stare: 'dovedita' }).eq('id', leg.id)
    }
    setBusy(false)
    if (error) { showToast?.('Dovada nu s-a salvat: ' + error.message, 'err'); return }
    showToast?.('Dovadă legată. Rămâne de verificat de un om.', 'ok')
    await load(licId)
  }

  // P0.5 — APROBAREA PACHETULUI. Nu ingheata starea (asta o face semnatura portii), ingheata
  // BYTES-II: genereaza fisierele, le hash-uieste in browser, le urca in bucket, scrie manifestul,
  // apoi marcheaza pachetul aprobat. De aici, intrebarea "ce a aprobat X la momentul Y" are un
  // raspuns exact. Manifestul e append-only (RLS): o schimbare = versiune noua.
  const aprobaPachet = async () => {
    if (!licId || !capitole.length) return
    const ev = evalueazaPoarta(st)
    if (!ev || ev.stare === 'block') { showToast?.('Poarta are rânduri roșii — nu se aprobă un pachet blocat.', 'err'); return }
    if (!window.confirm(`Aprobi pachetul v${(pachete[0]?.versiune || 0) + 1}?\nSe generează fișierele, se calculează SHA-256 și se scriu în manifest. După aprobare NU se mai pot modifica — o schimbare înseamnă o versiune nouă.`)) return
    setBusy(true)
    try {
      const versiune = (pachete[0]?.versiune || 0) + 1
      const arg = { licitatie: lic, capitole }
      const surse = [
        { rol: 'propunere_docx', nume: numeFisier('Propunere_tehnica', lic), blob: await blobDocx(construiestePropunere(arg)) },
        { rol: 'borderou_docx',  nume: numeFisier('Borderou_PT', lic),       blob: await blobDocx(construiesteBorderou(arg)) },
      ]
      const fisiere = []
      for (const f of surse) fisiere.push({ ...f, mime: f.blob.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: f.blob.size, sha256: await sha256Hex(f.blob) })
      const manifest = construiesteManifest({ licitatieId: licId, versiune, fisiere, sursaVersiune: sursaVersiuneCapitole(capitole) })

      // 1. bytes-ii in bucket, EXACT cei hash-uiti
      for (let i = 0; i < fisiere.length; i++) {
        const { error } = await supabase.storage.from('ofertare').upload(manifest[i].fisier_path, fisiere[i].blob, { upsert: false, contentType: fisiere[i].mime })
        if (error) throw new Error(`upload ${fisiere[i].nume}: ${error.message}`)
      }
      // 2. pachetul (propus) + manifestul
      const { data: p, error: e1 } = await supabase.from('ofertare_pt_pachet').insert({
        licitatie_id: licId, versiune, grafic_versiune: st?.grafic_versiune || null,
        pt_poarta_id: null, nota: ev.rezerve.length ? `aprobat CU REZERVE: ${ev.rezerve.join(' · ')}` : null,
      }).select('id').single()
      if (e1) throw new Error('pachet: ' + e1.message)
      const { error: e2 } = await supabase.from('ofertare_pt_pachet_fisiere').insert(manifest.map(m => ({ ...m, pachet_id: p.id })))
      if (e2) throw new Error('manifest: ' + e2.message)
      // 3. aprobarea — dupa asta RLS nu mai lasa nicio modificare pe fisiere
      const { data: u } = await supabase.auth.getUser()
      const { error: e3 } = await supabase.from('ofertare_pt_pachet')
        .update({ stare: 'aprobat', aprobat_de: u?.user?.id || null, aprobat_la: new Date().toISOString() }).eq('id', p.id)
      if (e3) throw new Error('aprobare: ' + e3.message)
      showToast?.(`Pachet v${versiune} aprobat: ${manifest.length} fișiere, SHA-256 în manifest.` + (ev.rezerve.length ? ' Cu rezerve (vezi nota).' : ''), ev.rezerve.length ? 'err' : 'ok')
    } catch (e) {
      showToast?.('Aprobarea a eșuat, nimic nu s-a marcat aprobat: ' + (e?.message || e), 'err')
    }
    setBusy(false)
    await load(licId)
  }

  const atribuie = async (capitolId) => {
    if (!sel.size || !capitolId) return
    setBusy(true)
    const { error } = await supabase.from('ofertare_pt_legaturi')
      .upsert([...sel].map(id => ({ cerinta_id: id, capitol_id: capitolId, fel: 'capitol', sursa: 'om' })),
        { onConflict: 'cerinta_id,capitol_id' })
    setBusy(false)
    if (error) { showToast?.('Atribuirea a eșuat: ' + error.message, 'err'); return }
    showToast?.(`${sel.size} cerințe atribuite.`, 'ok')
    setSel(new Set()); await load(licId)
  }

  // Scrie DOAR în ofertare_pt_legaturi. Niciun .update() pe ofertare_cerinte — vezi regula 1.
  const excepta = async (motiv) => {
    if (!sel.size || !motiv) return
    setBusy(true)
    const { error } = await supabase.from('ofertare_pt_legaturi')
      .insert([...sel].map(id => ({ cerinta_id: id, capitol_id: null, fel: 'exceptat', motiv, sursa: 'om' })))
    setBusy(false)
    if (error) { showToast?.('Excepția a eșuat: ' + error.message, 'err'); return }
    showToast?.(`${sel.size} cerințe exceptate de la propunere.`, 'ok')
    setSel(new Set()); await load(licId)
  }

  const semneaza = async () => {
    if (!licId) return
    setBusy(true)
    // Se recitește starea din BD, nu din state: între încărcare și apăsare se poate schimba.
    const { data: proaspat, error: e1 } = await supabase.from('v_ofertare_pt_stare').select('*').eq('licitatie_id', licId).maybeSingle()
    if (e1 || !proaspat) { setBusy(false); showToast?.('Nu s-a putut reciti starea.', 'err'); return }
    // Acelasi evaluator ca butonul si cardul. Daca cele trei ar diverge, butonul ar fi activ
    // dar semnarea ar cadea — sau invers, mai rau.
    const ev = evalueazaPoarta(proaspat)
    const blocat = ev.stare === 'block'
    if (blocat) { setBusy(false); setSt(proaspat); showToast?.('Între timp s-a redeschis un rând roșu. Nu se semnează.', 'err'); return }
    const versiune = (proaspat.pt_versiune || 0) + 1
    // Rezervele vin din evaluator: alimenteaza si verdictul, si mesajul (P0.2).
    const rezerve = ev.rezerve
    const { error } = await supabase.from('ofertare_pt_poarta').insert({
      licitatie_id: licId, versiune,
      // Galben = se depune, dar ramane scris in istoric cu ce rezerve. Decide verdictSemnatura, nu noi.
      verdict: verdictSemnatura(ev),
      snapshot: proaspat,
    })
    setBusy(false)
    if (error) {
      if (error.code === '23505') { showToast?.('Altcineva a semnat între timp. Reîncarc.', 'err'); await load(licId); return }
      showToast?.('Semnarea a eșuat: ' + error.message, 'err'); return
    }
    showToast?.(rezerve.length
      ? `Versiunea ${versiune} semnată CU REZERVE (galben): ${rezerve.join(' · ')}. Nu e „gata de depus" — rezervele rămân scrise în istoric.`
      : `Propunerea marcată gata de depus (versiunea ${versiune}), fără rezerve.`,
      rezerve.length ? 'err' : 'ok')
    await load(licId)
  }

  // Cât timp st e null, evaluatorul întoarce null și butonul stă blocat: verde din lipsă de date, nu.
  const evPoarta = evalueazaPoarta(st)
  const blocat = !evPoarta || evPoarta.stare === 'block'
  const zile = zileRamase(lic?.termen_depunere)

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
        {onInapoi && <button onClick={onInapoi} style={S.btnS}>← Înapoi la fișă</button>}
        <select value={licId || ''} onChange={e => setLicId(Number(e.target.value))} style={{ ...S.input, width:'auto', minWidth:340 }}>
          {licitatii.map(l => <option key={l.id} value={l.id}>{l.obiect || l.nr_anunt || `Licitația ${l.id}`}</option>)}
        </select>
        {lic?.termen_depunere && (
          <span style={{ fontSize:12, color: zile != null && zile <= 14 ? G.red : G.muted }}>
            termen {fmtZi(lic.termen_depunere)}{zile != null && zile >= 0 ? ` · ${zile} zile` : ''}
          </span>
        )}
        <button onClick={() => exporta('propunere')} disabled={busy || !capitole.length}
          title="Propunerea tehnică în Word: pagină de titlu, cuprins automat, capitolele pe secțiuni"
          style={{ ...S.btnS, marginLeft:'auto', opacity: (busy || !capitole.length) ? .45 : 1 }}>
          📄 Propunerea (Word)
        </button>
        <button onClick={() => exporta('borderou')} disabled={busy || !capitole.length}
          title="Borderoul pieselor îndosariate"
          style={{ ...S.btnS, opacity: (busy || !capitole.length) ? .45 : 1 }}>
          📋 Borderoul
        </button>
        <button onClick={aprobaPachet} disabled={blocat || busy || !capitole.length}
          title={blocat ? 'Inactiv până se închid rândurile roșii' : 'Generează fișierele, le hash-uiește și îngheață manifestul (versiune nouă)'}
          style={{ ...S.btnS, opacity: (blocat || busy || !capitole.length) ? .45 : 1 }}>
          🔏 Aprobă pachetul
        </button>
        <button onClick={semneaza} disabled={blocat || busy}
          title={blocat ? 'Inactiv până se închid rândurile roșii' : 'Îngheață verdictul porții — verde dacă n-are rezerve, galben dacă are'}
          style={{ ...S.btnP, opacity: blocat || busy ? .45 : 1, cursor: blocat ? 'not-allowed' : 'pointer' }}>
          📦 Semnează verdictul porții
        </button>
      </div>

      {eroare && <div style={{ ...S.card, padding:12, borderColor:G.red + '55', color:G.red, fontSize:13 }}>{eroare}</div>}

      <PoartaPT st={st} onFiltru={f => { setFiltru(f); setSel(new Set()) }} />

      <div>
        <div style={{ ...S.lbl, marginBottom:8 }}>Cuprinsul propunerii</div>
        <CuprinsCapitole capitole={capitole} numarPeCapitol={numarPeCapitol} onCreeaza={creeazaCuprins}
          obsPeCapitol={obsPeCapitol} versiuniPeCapitol={versiuniPeCapitol} nume={nume}
          onAdauga={adaugaCapitol} onSterge={stergeCapitol}
          onSalveaza={salveazaCapitol} onBlocheaza={blocheazaCapitol}
          onGenereaza={genereazaCapitol} busy={busy} />
      </div>

      {pachete.length > 0 && (
        <div>
          <div style={{ ...S.lbl, marginBottom:8 }}>Pachete aprobate — ce bytes, când, de cine</div>
          <div style={{ ...S.card, overflow:'hidden' }}>
            {pachete.map((p, i) => (
              <div key={p.id} style={{ padding:'8px 14px', borderTop: i ? `1px solid ${G.border2}` : 'none', fontSize:12 }}>
                <div style={{ display:'flex', gap:10, flexWrap:'wrap', color:G.text }}>
                  <b>v{p.versiune}</b>
                  <span style={{ color: p.stare === 'depus' ? G.green : p.stare === 'aprobat' ? G.blue : G.yellow }}>{p.stare}</span>
                  <span style={{ color:G.muted }}>{p.aprobat_la ? `${nume(p.aprobat_de)} · ${new Date(p.aprobat_la).toLocaleString('ro-RO')}` : '—'}</span>
                  {p.grafic_versiune && <span style={{ color:G.dim }}>grafic v{p.grafic_versiune}</span>}
                  {/* P0.6: pachetul ramane istoric imuabil, dar daca vreun capitol s-a rescris de la
                      aprobare, amprenta nu mai corespunde — si asta trebuie sa se vada, nu sa se stie. */}
                  {i === 0 && pachetDepasit(p, capitole) === true && (
                    <span style={{ color:G.red, fontWeight:700 }}>⚠ DEPĂȘIT — un capitol s-a modificat după aprobare; aprobă o versiune nouă</span>
                  )}
                </div>
                {p.nota && <div style={{ color:G.orange, marginTop:2 }}>{p.nota}</div>}
                {(p.fisiere || []).map(f => (
                  <div key={f.rol + f.nume} style={{ color:G.dim, fontFamily:'ui-monospace, monospace', fontSize:11, marginTop:2 }}>
                    {f.rol} · {f.nume} · {f.size_bytes} B · {f.sha256.slice(0, 16)}… <span style={{ color:G.dim }}>{f.sursa_versiune}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div style={{ ...S.lbl, marginBottom:8 }}>Observații și revizii</div>
        <Observatii observatii={observatii} capitole={capitole} nume={nume}
          onAdauga={adaugaObservatie} onInchide={inchideObservatie} busy={busy} />
      </div>

      <div>
        <div style={{ ...S.lbl, marginBottom:8 }}>Pachetul de echipamente</div>
        <PachetEchipamente randuri={echipamente} busy={busy} showToast={showToast}
          laData={lic?.termen_depunere ? String(lic.termen_depunere).slice(0, 10) : null}
          onGenereaza={genereazaEchipamente} />
      </div>

      <div>
        <div style={{ ...S.lbl, marginBottom:8 }}>Pachetul de personal</div>
        <PachetPersonal randuri={pachet} busy={busy} showToast={showToast}
          laData={lic?.termen_depunere ? String(lic.termen_depunere).slice(0, 10) : null}
          onGenereaza={genereazaPachet} />
      </div>

      <div>
        <div style={{ ...S.lbl, marginBottom:8 }}>Garanția lucrărilor</div>
        <Garantie g={garantie} cerinte={cerinte} onSalveaza={salveazaGarantie} busy={busy} nume={nume} />
      </div>

      <div>
        <div style={{ ...S.lbl, marginBottom:8 }}>Afirmațiile propunerii, față de firmă</div>
        <Conformitate afirmatii={afirmatii} tipuriAut={tipuriAut} autExterne={autExterne}
          onExcepta={exceptaAfirmatie} onSetTip={setTipCerut} onSetExtern={setExtern} busy={busy} />
      </div>

      <div>
        <div style={{ ...S.lbl, marginBottom:8 }}>Matricea de conformitate</div>
        <MatriceCerinte
          cerinte={cerinte} legaturi={legaturi} capitole={capitole} dovedite={dovedite} documente={documente}
          filtru={filtru} setFiltru={setFiltru} sel={sel} setSel={setSel}
          onAtribuie={atribuie} onExcepta={excepta}
          onVerifica={verificaLegatura} onBlocheaza={blocheazaLegatura} onDovada={adaugaDovada} busy={busy}
        />
      </div>
    </div>
  )
}
