// ════════════════════════════════════════════════════════════════
// OfertareCerinte.jsx — ecranul PERECHE: cerința autorității ↔ dovada noastră, pe același rând.
//
// DE CE EXISTĂ: până acum registrul de cerințe și acoperirile erau două liste stivuite, fiecare cu
// numerele ei. Ca să verifici cerința #30 derulai până la al doilea card cu #30 și potriveai din
// ochi. La Domnești sunt 417 cerințe — nelucrabil. Comisia de evaluare nu gândește în liste
// paralele, ci în perechi: „cerința asta, din documentul ăsta, pagina aia — dovada asta, din
// documentul nostru". Ecranul ăsta arată exact perechea, cu PROVENIENȚA pe ambele părți.
//
// PASUL 1 din reproiectare (recenzie independentă, 18.09.2026): doar unificare vizuală, citire
// din aceleași tabele, FĂRĂ schimbări de schemă și fără să atingă acțiunile existente. Vederea
// veche rămâne pe loc; asta se adaugă lângă ea, ca să se poată compara pe o licitație reală.
//
// CE NU FACE ÎNCĂ (pașii 2-4, fiecare cere altceva decât JSX):
//   - o cerință cu MAI MULTE dovezi: încărcarea de mai jos reduce, ca și cea veche, mai multe
//     acoperiri la una singură (dovada verificată de om are întâietate). Indexul din BD permite
//     o singură acoperire neverificată per cerință, deci nu se rezolvă din ecran — cere migrare.
//   - deschiderea documentului la pagina dovezii (paginile lipsesc pentru multe documente);
//     unde nu se știe, scrie „pagină neindicată", nu se inventează.
//   - atribuiri persistente și protecție la editări simultane.
// ════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo } from 'react'
import { supabase } from './lib/supabase.js'

const G = {
  bg:'#0D1117', surface:'#161B22', card:'#1C2128', border:'#30363D', border2:'#21262D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  ofertare:'#3FB6E2', green:'#3FB950', blue:'#58A6FF', orange:'#F0883E',
  yellow:'#E3B341', red:'#F85149', purple:'#A371F7', teal:'#2DD4BF',
}
const S = {
  input: { boxSizing:'border-box', background:G.bg, border:`1px solid ${G.border2}`, borderRadius:6, padding:'7px 10px', color:G.text, fontSize:12.5, outline:'none' },
  btnS: { padding:'6px 12px', background:G.surface, color:G.text, border:`1px solid ${G.border2}`, borderRadius:7, cursor:'pointer', fontSize:12 },
  card: { background:G.card, border:`1px solid ${G.border}`, borderRadius:10 },
}

const PE_PAGINA = 50

// Verdictul afișat. „Neevaluat" e o stare de sine stătătoare: lipsa unei evaluări NU e același
// lucru cu lipsa unei dovezi, iar confuzia asta face omul să caute documente care nu lipsesc.
const VERDICT = {
  verificat:   { et:'✅ acoperit · verificat', col:G.green },
  acoperit:    { et:'🟢 acoperit',             col:G.teal },
  partener:    { et:'🤝 prin partener',        col:G.blue },
  rezerva:     { et:'🟠 cu rezervă',           col:G.orange },
  gol:         { et:'🔴 gol',                  col:G.red },
  nu_se_aplica:{ et:'— nu se aplică',          col:G.dim },
  regula:      { et:'📐 regulă de echipă',     col:G.purple },
  neevaluat:   { et:'⚪ neevaluat',            col:G.muted },
}

/** Verdictul unui rând, din acoperire + cerință. Fără acoperire = neevaluat, nu „gol". */
export function verdictRand(a) {
  if (!a) return 'neevaluat'
  if (a.status === 'nu_se_aplica') return 'nu_se_aplica'
  if (a.status === 'regula_propunere') return 'regula'
  if (a.status === 'gol') return 'gol'
  if (a.verificat_pe_scan) return 'verificat'
  if (a.reverificare_ceruta) return 'rezerva'
  if (a.valabil_la_depunere === false) return 'rezerva'
  if (a.status === 'acoperit_partener') return 'partener'
  if (a.status === 'acoperit') return 'acoperit'
  return 'neevaluat'
}

/** Ce dovadă e, în cuvinte, plus de unde vine ea (lanțul de proveniență). */
export function dovada(a) {
  if (!a) return null
  const au = a.autorizatie
  if (au) {
    const cine = au.emp?.name || au.ext?.nume || 'titular necunoscut'
    return {
      titlu: cine,
      detaliu: [au.tip?.denumire, au.numar_autorizatie ? 'nr. ' + au.numar_autorizatie : null,
        a.domeniu_rte ? 'domeniu ' + a.domeniu_rte : null].filter(Boolean).join(' · '),
      sursa: au.ext ? 'HR → colaborator extern → autorizație' : 'HR → angajat → autorizație',
      fisier: au.fisier_path || null,
    }
  }
  if (a.doc_firma) {
    const d = a.doc_firma
    return {
      titlu: d.denumire || d.tip || 'document de firmă',
      detaliu: [d.numar_document ? 'nr. ' + d.numar_document : null,
        d.data_valabilitate ? 'valabil până la ' + String(d.data_valabilitate).slice(0, 10) : null].filter(Boolean).join(' · '),
      sursa: 'Documentele firmei',
      fisier: d.pdf_path || null,
    }
  }
  if (a.experienta) {
    const e = a.experienta
    return {
      titlu: e.denumire || 'lucrare similară',
      detaliu: [e.beneficiar, e.data_pv ? 'PV ' + String(e.data_pv).slice(0, 10) : null,
        e.asociere ? 'în asociere' : null].filter(Boolean).join(' · '),
      sursa: 'Experiența similară',
      fisier: null,
    }
  }
  if (a.recomandare) {
    const r = a.recomandare
    return {
      titlu: r.emp?.name || r.ext?.nume || 'persoană',
      detaliu: [r.rol, r.beneficiar, r.verificat === false ? 'neverificată în HR' : null].filter(Boolean).join(' · '),
      sursa: 'HR → recomandare',
      fisier: null,
    }
  }
  if (a.studii) {
    const d = a.studii
    return {
      titlu: d.emp?.name || 'persoană',
      detaliu: [d.tip?.denumire, d.numar_document ? 'nr. ' + d.numar_document : null, d.emitent].filter(Boolean).join(' · '),
      sursa: 'HR → document personal',
      fisier: d.fisier_path || null,
    }
  }
  if (a.partener) {
    return { titlu: a.partener.nume, detaliu: 'partener', sursa: 'Parteneri', fisier: null }
  }
  return null
}

function Eticheta({ text, col, titlu }) {
  return <span title={titlu} style={{ fontSize:10.5, fontWeight:800, color:col, border:`1px solid ${col}55`,
    borderRadius:5, padding:'1px 6px', whiteSpace:'nowrap' }}>{text}</span>
}

// Numele fișierelor din SEAP sunt lungi; păstrăm coada, unde stă partea distinctivă.
const scurtNume = (n, max = 42) => {
  const s = String(n || '').replace(/\.(pdf|docx?|xlsx?)$/i, '')
  return s.length <= max ? s : '…' + s.slice(-max)
}

// TKT-2026-0254: clic pe document îl deschide la pagina pe care stă cerința. Fragmentul
// `#page=N` e înțeles de vizualizatoarele PDF din browser; la Word nu are efect, dar nici nu
// strică. Link semnat, valabil 10 minute, ca peste tot în Ofertare.
async function deschideSursa(c) {
  const path = c.doc?.fisier_path
  if (!path) return
  const { data, error } = await supabase.storage.from('ofertare').createSignedUrl(path, 600)
  if (error || !data?.signedUrl) return
  window.open(data.signedUrl + (c.sursa_pagina ? `#page=${c.sursa_pagina}` : ''), '_blank', 'noopener')
}

// TKT-2026-0234: Mari cerea să se vadă din ce fel de document vine cerința, nu doar numele
// fișierului. Numele real e adesea lung și nu spune nimic la o privire rapidă.
const FEL_DOC = [
  [/fis[aă]\s*de\s*date|\bfd\b|df[i]?\b/i, 'FD', 'fișa de date'],
  [/caiet\s*de\s*sarcini|\bcs\b/i, 'CS', 'caiet de sarcini'],
  [/proiect\s*tehnic|\bpth?\b|memoriu/i, 'PT', 'proiect tehnic'],
  [/clarific|r[aă]spuns/i, 'CLR', 'clarificare / răspuns'],
  [/formular/i, 'FORM', 'set de formulare'],
  [/contract|acord/i, 'CTR', 'model de contract'],
  [/deviz|cantit|list[aă]/i, 'LC', 'liste de cantități'],
]
function felDocument(nume) {
  for (const [re, scurt, lung] of FEL_DOC) if (re.test(nume || '')) return { scurt, lung }
  return null
}

function Rand({ c, a, lista = [], ingust, onAlege }) {
  const v = verdictRand(a)
  const d = dovada(a)
  const V = VERDICT[v]
  const fel = felDocument(c.doc?.nume_original)
  // Candidații pe care nu i-am ales. Până acum nu existau: motorul putea scrie unul singur.
  const altii = lista.filter(x => x.id !== a?.id)
  const stanga = (
    <div style={{ minWidth:0 }}>
      <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap', marginBottom:4 }}>
        <span style={{ fontWeight:800, fontSize:12.5, color:G.ofertare }}>#{c.nr_ordine ?? c.id}</span>
        {c.tip === 'eliminatorie' && <Eticheta text="ELIMINATORIE" col={G.red} />}
        {c.cand_se_prezinta && c.cand_se_prezinta !== 'depunere' &&
          <Eticheta text={c.cand_se_prezinta === 'duae' ? 'în DUAE' : 'doar la locul I'} col={G.blue}
            titlu="Documentul nu se depune cu oferta — se declară acum și se prezintă ulterior" />}
      </div>
      <div style={{ fontSize:12.5, lineHeight:1.45, color:G.text }}>{c.text_cerinta}</div>
      <div style={{ fontSize:11, color:G.muted, marginTop:5, display:'flex', gap:5, alignItems:'center', flexWrap:'wrap' }}>
        <span>📄</span>
        {fel && <Eticheta text={fel.scurt} col={G.blue} titlu={fel.lung} />}
        {c.doc?.nume_original ? (
          c.doc.fisier_path ? (
            <span onClick={() => deschideSursa(c)} title={`Deschide „${c.doc.nume_original}”${c.sursa_pagina ? ` la pagina ${c.sursa_pagina}` : ''}`}
              style={{ color:G.blue, cursor:'pointer', textDecoration:'underline', textUnderlineOffset:2 }}>
              {scurtNume(c.doc.nume_original)}
            </span>
          ) : <span title={c.doc.nume_original}>{scurtNume(c.doc.nume_original)}</span>
        ) : <span style={{ color:G.dim }}>document scos din licitație</span>}
        <span>· {c.sursa_sectiune || 'secțiune neindicată'}</span>
        <span>{c.sursa_pagina ? `· p. ${c.sursa_pagina}` : '· pagină neindicată'}</span>
      </div>
      {c.document_probant && (
        <div style={{ fontSize:11, color:G.dim, marginTop:2 }}>se dovedește cu: {c.document_probant}</div>
      )}
    </div>
  )
  const dreapta = (
    <div style={{ minWidth:0 }}>
      <div style={{ marginBottom:4 }}><Eticheta text={V.et} col={V.col} /></div>
      {d ? (
        <>
          <div style={{ fontSize:12.5, fontWeight:700, color:G.text }}>{d.titlu}</div>
          {d.detaliu && <div style={{ fontSize:11.5, color:G.muted, marginTop:2 }}>{d.detaliu}</div>}
          <div style={{ fontSize:11, color:G.dim, marginTop:5 }}>
            🔗 {d.sursa}{d.fisier ? '' : ' · fără scan atașat'}
          </div>
        </>
      ) : (
        <div style={{ fontSize:12, color: v === 'neevaluat' ? G.muted : G.dim }}>
          {v === 'neevaluat'
            ? 'nu s-a rulat încă nicio evaluare pe cerința asta'
            : (a?.referinta_text || a?.observatii || 'fără dovadă atașată')}
        </div>
      )}
      {a?.referinta_text && d && (
        <div style={{ fontSize:11, color:G.dim, marginTop:4, fontStyle:'italic' }}>{a.referinta_text}</div>
      )}
      {a?.raspuns_coleg && (
        <div style={{ fontSize:11, color:G.yellow, marginTop:4 }}>💬 {a.raspuns_coleg}</div>
      )}
      {altii.length > 0 && (
        <div style={{ marginTop:8, paddingTop:7, borderTop:`1px dashed ${G.border2}` }}>
          <div style={{ fontSize:10.5, color:G.muted, fontWeight:700, marginBottom:5 }}>
            ALTE VARIANTE ({altii.length})
          </div>
          {altii.map(x => {
            const dx = dovada(x)
            return (
              <div key={x.id} style={{ display:'flex', gap:8, alignItems:'flex-start', marginBottom:5 }}>
                <button onClick={() => onAlege?.(c.id, x.id)} title="Alege varianta asta în locul celei curente"
                  style={{ ...S.btnS, padding:'2px 9px', fontSize:10.5, whiteSpace:'nowrap', color:G.ofertare, borderColor:G.ofertare + '66' }}>
                  alege
                </button>
                <div style={{ minWidth:0, flex:1 }}>
                  <div style={{ fontSize:12, color:G.text }}>
                    {dx?.titlu || x.referinta_text || 'variantă fără descriere'}
                    {x.scor != null && <span style={{ color:G.dim, marginLeft:6, fontVariantNumeric:'tabular-nums' }}>· potrivire {x.scor}</span>}
                  </div>
                  {x.motiv && <div style={{ fontSize:11, color:G.muted, marginTop:1 }}>{x.motiv}</div>}
                  {!x.motiv && dx?.detaliu && <div style={{ fontSize:11, color:G.muted, marginTop:1 }}>{dx.detaliu}</div>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
  return (
    <div style={{ display:'grid', gridTemplateColumns: ingust ? '1fr' : '1fr 1fr', gap: ingust ? 8 : 14,
      padding:'10px 12px', borderTop:`1px solid ${G.border2}`, borderLeft:`3px solid ${V.col}` }}>
      {stanga}
      {ingust && <div style={{ height:1, background:G.border2 }} />}
      {dreapta}
    </div>
  )
}

export default function CerinteAcoperirePerechi({ licitatie }) {
  const [cerinte, setCerinte] = useState(null)
  const [acoperiri, setAcoperiri] = useState({})
  const [eroare, setEroare] = useState(null)
  const [cauta, setCauta] = useState('')
  const [filtru, setFiltru] = useState('toate')
  const [pagina, setPagina] = useState(0)
  // Pe telefon perechea se așază vertical, în același card — fără derulare orizontală.
  const [ingust, setIngust] = useState(typeof window !== 'undefined' && window.innerWidth < 900)
  useEffect(() => {
    const f = () => setIngust(window.innerWidth < 900)
    window.addEventListener('resize', f)
    return () => window.removeEventListener('resize', f)
  }, [])

  useEffect(() => {
    let viu = true
    const load = async () => {
      setCerinte(null); setEroare(null); setPagina(0)
      // Aceleași filtre ca în vederea veche: doar registrul de capabilități, fără repetări.
      // Dacă ar diferi, cele două ecrane ar număra altceva și n-ar mai fi comparabile.
      const { data: cs, error } = await supabase.from('ofertare_cerinte')
        .select('id, nr_ordine, sursa_sectiune, sursa_pagina, text_cerinta, tip, lot, cand_se_prezinta, document_probant, registru, sursa_document_id, doc:ofertare_documente_atribuire(id, nume_original, fisier_path)')
        .eq('licitatie_id', licitatie.id).is('inlocuita_de', null).is('duplicat_al', null)
        .or('registru.is.null,registru.eq.capabilitate')
        .in('tip', ['eliminatorie', 'propunere']).order('tip').order('nr_ordine').limit(5000)
      if (!viu) return
      if (error) { setEroare(error.message); setCerinte([]); return }
      setCerinte(cs || [])
      if (!cs?.length) { setAcoperiri({}); return }
      const { data: ac, error: e2 } = await supabase.from('ofertare_acoperire')
        .select('*, autorizatie:hr_autorizatii(id, numar_autorizatie, fisier_path, tip:hr_autorizatii_tipuri(denumire), emp:employees(name), ext:hr_personal_extern(nume)), partener:ofertare_parteneri(nume), doc_firma:documente_firma(id, tip, denumire, numar_document, pdf_path, data_valabilitate), experienta:ofertare_experienta(id, denumire, beneficiar, asociere, data_pv), recomandare:hr_recomandari(id, rol, beneficiar, verificat, emp:employees(name), ext:hr_personal_extern(nume)), studii:hr_documente_personale(id, numar_document, emitent, fisier_path, tip:hr_documente_personale_tipuri(denumire), emp:employees(name))')
        .in('cerinta_id', cs.map(c => c.id)).order('id').limit(5000)
      if (!viu) return
      if (e2) { setEroare(e2.message); return }
      // Păstrăm TOȚI candidații pe cerință, nu doar unul. Până azi nici nu puteau exista mai
      // mulți: un index unic în BD interzicea a doua propunere nevalidată, de-aia platforma
      // „alegea singură" mereu aceeași persoană. Ordinea: aleasa prima, apoi după scor.
      const m = {}
      ;(ac || []).forEach(a => (m[a.cerinta_id] ||= []).push(a))
      Object.values(m).forEach(lista => lista.sort((x, y) =>
        (y.ales ? 1 : 0) - (x.ales ? 1 : 0) ||
        (y.scor ?? -1) - (x.scor ?? -1) ||
        (y.verificat_pe_scan ? 1 : 0) - (x.verificat_pe_scan ? 1 : 0) ||
        x.id - y.id))
      setAcoperiri(m)
    }
    load()
    return () => { viu = false }
  }, [licitatie.id])

  const randuri = useMemo(() => (cerinte || []).map(c => {
    const lista = acoperiri[c.id] || []
    const a = lista.find(x => x.ales) || lista[0] || null
    return { c, a, lista, v: verdictRand(a) }
  }), [cerinte, acoperiri])

  // Alegerea unui alt candidat. Indexul unic `(cerinta_id) WHERE ales` cere ca vechea
  // variantă să fie scoasă ÎNAINTE de a o pune pe cea nouă — deci sunt două scrieri, iar
  // între ele cerința rămâne o clipă fără aleasă. Dacă a doua cade, o punem pe cea veche
  // înapoi: mai bine rămâne ce era decât să rămână cerința descoperită fără ca omul să știe.
  const alegeCandidat = async (cerintaId, idNou) => {
    const lista = acoperiri[cerintaId] || []
    const vechea = lista.find(x => x.ales)
    if (vechea?.id === idNou) return
    setAcoperiri(prev => ({ ...prev, [cerintaId]: (prev[cerintaId] || [])
      .map(x => ({ ...x, ales: x.id === idNou })) }))
    if (vechea) {
      const { error } = await supabase.from('ofertare_acoperire').update({ ales: false }).eq('id', vechea.id)
      if (error) { setEroare('Nu s-a putut schimba varianta aleasă: ' + error.message); return }
    }
    const { error } = await supabase.from('ofertare_acoperire').update({ ales: true }).eq('id', idNou)
    if (error) {
      if (vechea) await supabase.from('ofertare_acoperire').update({ ales: true }).eq('id', vechea.id)
      setAcoperiri(prev => ({ ...prev, [cerintaId]: (prev[cerintaId] || [])
        .map(x => ({ ...x, ales: x.id === vechea?.id })) }))
      setEroare('Nu s-a putut schimba varianta aleasă: ' + error.message)
    }
  }

  const numarate = useMemo(() => {
    const n = { toate: randuri.length, de_rezolvat: 0, eliminatorii: 0, neevaluate: 0, acoperite: 0 }
    for (const r of randuri) {
      if (r.v === 'gol' || r.v === 'rezerva' || r.v === 'neevaluat') n.de_rezolvat++
      if (r.v === 'neevaluat') n.neevaluate++
      if (r.v === 'acoperit' || r.v === 'verificat' || r.v === 'partener') n.acoperite++
      if (r.c.tip === 'eliminatorie' && (r.v === 'gol' || r.v === 'rezerva' || r.v === 'neevaluat')) n.eliminatorii++
    }
    return n
  }, [randuri])

  const filtrate = useMemo(() => {
    const q = cauta.trim().toLowerCase()
    return randuri.filter(r => {
      if (filtru === 'de_rezolvat' && !(r.v === 'gol' || r.v === 'rezerva' || r.v === 'neevaluat')) return false
      if (filtru === 'eliminatorii' && !(r.c.tip === 'eliminatorie' && (r.v === 'gol' || r.v === 'rezerva' || r.v === 'neevaluat'))) return false
      if (filtru === 'neevaluate' && r.v !== 'neevaluat') return false
      if (filtru === 'acoperite' && !(r.v === 'acoperit' || r.v === 'verificat' || r.v === 'partener')) return false
      if (!q) return true
      const d = dovada(r.a)
      // Căutarea merge pe TOATE cerințele, nu doar pe pagina afișată — altfel paginarea ar
      // ascunde exact rândul căutat, iar Ctrl+F al browserului vede doar pagina curentă.
      return [r.c.nr_ordine, r.c.text_cerinta, r.c.sursa_sectiune, r.c.document_probant,
        d?.titlu, d?.detaliu, r.a?.referinta_text].filter(Boolean).join(' ').toLowerCase().includes(q)
    })
  }, [randuri, filtru, cauta])

  useEffect(() => { setPagina(0) }, [filtru, cauta])

  if (eroare) return <div style={{ ...S.card, padding:12, borderColor:G.red + '55', color:G.red, fontSize:12.5 }}>Nu s-au putut citi cerințele: {eroare}</div>
  if (!cerinte) return <div style={{ ...S.card, padding:14, color:G.muted, fontSize:12.5 }}>Se încarcă…</div>
  if (!cerinte.length) return <div style={{ ...S.card, padding:14, color:G.muted, fontSize:12.5 }}>Licitația n-are încă cerințe de capabilitate extrase.</div>

  const nPagini = Math.max(1, Math.ceil(filtrate.length / PE_PAGINA))
  const p = Math.min(pagina, nPagini - 1)
  const felie = filtrate.slice(p * PE_PAGINA, (p + 1) * PE_PAGINA)

  const CHIPS = [
    ['toate', `Toate (${numarate.toate})`, G.muted],
    ['de_rezolvat', `De rezolvat (${numarate.de_rezolvat})`, G.orange],
    ['eliminatorii', `Eliminatorii cu probleme (${numarate.eliminatorii})`, G.red],
    ['neevaluate', `Neevaluate (${numarate.neevaluate})`, G.muted],
    ['acoperite', `Acoperite (${numarate.acoperite})`, G.green],
  ]

  return (
    <div style={{ ...S.card, overflow:'hidden' }}>
      <div style={{ padding:'10px 12px', borderBottom:`1px solid ${G.border}`, display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
        <div style={{ fontSize:13, fontWeight:800 }}>🔗 Cerință ↔ dovadă</div>
        <input value={cauta} onChange={e => setCauta(e.target.value)} placeholder="caută în cerințe, documente, titulari…"
          style={{ ...S.input, flex:'1 1 220px', minWidth:160 }} />
      </div>
      <div style={{ padding:'8px 12px', borderBottom:`1px solid ${G.border2}`, display:'flex', gap:6, flexWrap:'wrap' }}>
        {CHIPS.map(([k, lbl, col]) => (
          <button key={k} onClick={() => setFiltru(k)} style={{ ...S.btnS, fontSize:11.5,
            borderColor: filtru === k ? col : G.border2, color: filtru === k ? col : G.muted,
            fontWeight: filtru === k ? 800 : 400 }}>{lbl}</button>
        ))}
      </div>

      {felie.length === 0 ? (
        <div style={{ padding:16, color:G.muted, fontSize:12.5 }}>Niciun rând pe filtrul ăsta.</div>
      ) : felie.map(r => <Rand key={r.c.id} c={r.c} a={r.a} lista={r.lista} ingust={ingust} onAlege={alegeCandidat} />)}

      {nPagini > 1 && (
        <div style={{ padding:'10px 12px', borderTop:`1px solid ${G.border}`, display:'flex', gap:8, alignItems:'center', justifyContent:'center' }}>
          <button onClick={() => setPagina(Math.max(0, p - 1))} disabled={p === 0}
            style={{ ...S.btnS, opacity: p === 0 ? .4 : 1 }}>← anterioare</button>
          <span style={{ fontSize:12, color:G.muted }}>
            {p * PE_PAGINA + 1}–{Math.min((p + 1) * PE_PAGINA, filtrate.length)} din {filtrate.length}
          </span>
          <button onClick={() => setPagina(Math.min(nPagini - 1, p + 1))} disabled={p >= nPagini - 1}
            style={{ ...S.btnS, opacity: p >= nPagini - 1 ? .4 : 1 }}>următoarele →</button>
        </div>
      )}
    </div>
  )
}
