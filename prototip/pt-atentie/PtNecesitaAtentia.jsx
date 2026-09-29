// ════════════════════════════════════════════════════════════════
// PtNecesitaAtentia.jsx — ecranul „Necesită atenția ta" (prototip B, TO-BE §4.1), READ-ONLY.
//
// NU e în aplicația de producție: se rulează separat (vite.prototip.config.js, port 5199), pe fixture-ul
// clonei de audit 103 (anonimizat). Nu importă supabase, nu face fetch, nu are niciun buton care scrie.
// Acțiunile umane apar ca INTENȚII („ai de făcut: …"); „Du-mă acolo" doar selectează capitolul aici.
// Verdictul e SIMULAT (J07 neaplicat) și nu înseamnă „gata de depus".
// ════════════════════════════════════════════════════════════════
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { construiesteAtentia, construiesteCuprins, normalizeazaSnapshot, ETICHETA_SIMULAT, NEGATIE_GATA, TABEL_SURSA } from './atentie.js'
import { CEASURI, SCENARII, SURSE_DE_STRICAT, LICITATIE_A, LICITATIE_B, acumPentru, creeazaIncarcator, snapshotScenariu, snapshotSintetic } from './scenarii.js'

const G = { bg: '#0D1117', surface: '#161B22', card: '#1C2128', border: '#30363D', border2: '#21262D',
  text: '#E6EDF3', muted: '#8B949E', dim: '#6E7681',
  ofertare: '#3FB6E2', green: '#3FB950', blue: '#58A6FF', orange: '#F0883E',
  yellow: '#E3B341', red: '#F85149', purple: '#A371F7', teal: '#2DD4BF' }
const S = {
  card: { background: G.card, border: `1px solid ${G.border}`, borderRadius: 10 },
  btn: { padding: '5px 11px', background: G.surface, color: G.text, border: `1px solid ${G.border2}`, borderRadius: 6, cursor: 'pointer', fontSize: 12 },
  lbl: { display: 'block', fontSize: 11, color: G.muted, marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.3px' },
  select: { background: G.bg, border: `1px solid ${G.border2}`, borderRadius: 6, padding: '6px 8px', color: G.text, fontSize: 12 },
  chip: c => ({ display: 'inline-block', padding: '1px 7px', borderRadius: 10, fontSize: 11, fontWeight: 600, color: c, border: `1px solid ${c}55`, background: `${c}18`, whiteSpace: 'nowrap' }),
  h: { fontSize: 13, fontWeight: 700, color: G.text, margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '.4px' },
}
const CLASE = [
  { k: 'BLOCK', icon: '⛔', c: G.red, nume: 'Blocaje', desc: 'fapte care opresc acțiunea finală — se rezolvă la sursă' },
  { k: 'HUMAN_DECISION', icon: '⚖', c: G.orange, nume: 'Decizii umane', desc: 'judecată individuală: sistemul nu propune rezultatul' },
  { k: 'CONFIRM', icon: '☐', c: G.yellow, nume: 'De confirmat de om', desc: 'munca e grupată pe capitol; judecata rămâne pe fiecare rând' },
  { k: 'WARN', icon: '⚠', c: G.blue, nume: 'Avertismente', desc: 'nu blochează final, dar rămân scrise' },
]
const CULOARE_VERDICT = { BLOCKED: G.red, INDISPONIBIL: G.purple, WARN: G.yellow, OK: G.teal }
const PROVENIENTA = { ai: ['AI', G.purple], om: ['om', G.green], server: ['server', G.blue], regula_client: ['regulă client', G.muted], mixt: ['mixt', G.orange], necunoscuta: ['necunoscută', G.dim],
  // a scris un om, dar nu printr-o judecată individuală — nu se colorează ca „om" (verde)
  om_in_bloc: ['om, în bloc (fără judecată individuală)', G.orange], om_fara_moment: ['om, fără moment', G.orange] }
const ECRAN = { propunere: 'Propunere tehnică', matrice: 'Matricea cerințelor', registru: 'Registrul cerințelor (E2)', acoperire: 'Acoperire / dovezi',
  documente: 'Documentația de atribuire', cantitati: 'Cantități', f9: 'Echipa F9', grafic: 'Graficul de execuție' }
const STARE_CERINTA = {
  verificata_om: ['✓ verificată de om', G.green], citat_candidat_ai: ['citat candidat AI', G.purple], atribuita_ai: ['atribuită (candidat AI)', G.purple],
  atribuita_om: ['atribuită de om, neverificată', G.yellow], atribuita_necunoscuta: ['atribuită (sursă necunoscută)', G.dim],
  blocata: ['⛔ blocată', G.red], versiune_veche: ['verificată pe altă versiune', G.orange],
  verificata_alt_capitol: ['verificată în alt capitol, nu aici', G.orange],
}
// Pe date vechi / expirate nimic nu rămâne verde: culoarea „bună" devine neutră și chipul spune de ce
const SUFIX_CALITATE = { stale: ' (date vechi)', expirat: ' (din date expirate)' }
const culoareStinsa = (c, calitate) => (calitate && calitate !== 'proaspat' && c === G.green ? G.dim : c)
const fmtIso = iso => (iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : '—')
const scurt = (t, n) => (t && t.length > n ? `${t.slice(0, n)}…` : t)

// ── bucăți mici ──────────────────────────────────────────────────────────────────────────────
function BandaSimulat() {
  return (
    <div style={{ background: `repeating-linear-gradient(135deg, ${G.yellow}26 0 12px, transparent 12px 24px)`, border: `1px solid ${G.yellow}`, borderRadius: 8,
      padding: '7px 12px', color: G.yellow, fontSize: 12, fontWeight: 700, letterSpacing: '.3px' }}>
      {ETICHETA_SIMULAT} · verdictul e calculat de prototip, în browser, nu de server · {NEGATIE_GATA}
    </div>
  )
}
function Prov({ p, calitate }) {
  if (!p) return null
  const [t, c] = PROVENIENTA[p.sursa] || [p.sursa, G.dim]
  return <span style={S.chip(culoareStinsa(c, calitate))} title={`${p.tabel || ''} · citit la ${fmtIso(p.citit_la)}`}>sursa: {t}</span>
}
function Intentie({ a }) {
  if (!a) return null
  return (
    <div style={{ fontSize: 12, color: G.text, marginTop: 6 }}>
      <span style={{ color: G.muted }}>ai de făcut: </span>{a.eticheta}
      <span style={{ ...S.chip(G.dim), marginLeft: 6 }} title="intenție de navigare — în prototip nu scrie nimic">{a.intent} · prototip read-only</span>
    </div>
  )
}

// ── antet + verdict ──────────────────────────────────────────────────────────────────────────
function Antet({ rezultat, snapshot }) {
  const v = rezultat.verdict
  const lic = snapshot?.licitatie_id === v.licitatie_id && snapshot?.surse?.licitatie?.stare === 'ok' ? snapshot.surse.licitatie.date : null
  const c = CULOARE_VERDICT[v.stare] || G.muted
  const sume = cl => rezultat.exceptii.filter(e => e.clasa === cl).reduce((s, e) => s + (e.numar ?? 1), 0)
  // regulile neevaluate pe clasa lor: „0" nu se afișează simplu când o parte din reguli n-a putut rula
  const nev = cl => (v.neevaluate_pe_clasa?.[cl] || []).length
  const plusNev = cl => (nev(cl) ? ` + ${nev(cl)} ${nev(cl) === 1 ? 'regulă neevaluată' : 'reguli neevaluate'}` : '')
  return (
    <div style={{ ...S.card, padding: 14, display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: G.text }}>
            {lic ? `${lic.nr_anunt} (${v.licitatie_id})` : `Licitația ${v.licitatie_id}`}
          </div>
          {lic && <div style={{ fontSize: 12, color: G.muted }}>{scurt(lic.obiect, 110)} · termen {fmtIso(lic.termen_depunere)} · {lic.status}</div>}
        </div>
        <div data-verdict={v.stare} style={{ padding: '6px 14px', borderRadius: 8, border: `2px solid ${c}`, color: c, fontWeight: 800, fontSize: 15, background: `${c}14` }}>
          {v.stare} <span style={{ fontSize: 11, fontWeight: 600 }}>· SIMULAT</span>
        </div>
      </div>
      <BandaSimulat />
      <div style={{ fontSize: 13, color: G.text }}>{v.eticheta}</div>
      {v.lista_construita === false ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <span style={S.chip(G.purple)}>contoare: — (lista nu a putut fi construită)</span>
          <span style={S.chip(G.purple)}>{v.contoare.indisponibile} indisponibile</span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <span style={S.chip(G.red)}>{v.contoare.BLOCK} blocaje{plusNev('BLOCK')}</span>
          <span style={S.chip(G.orange)}>{v.contoare.HUMAN_DECISION} decizii umane ({sume('HUMAN_DECISION')} rânduri){plusNev('HUMAN_DECISION')}</span>
          <span style={S.chip(G.yellow)}>{v.contoare.CONFIRM} grupuri de confirmat ({sume('CONFIRM')} rânduri){plusNev('CONFIRM')}</span>
          <span style={S.chip(G.blue)}>{v.contoare.WARN} avertismente{plusNev('WARN')}</span>
          <span style={S.chip(G.purple)}>{v.contoare.indisponibile} indisponibile</span>
          <span style={S.chip(G.muted)}>{v.contoare.ok} fără excepție</span>
        </div>
      )}
      <div style={{ fontSize: 11, color: G.dim }}>
        calculat la {fmtIso(v.calculat_la)} (ceasul de evaluare) · date capturate la {fmtIso(v.date_capturate_la)} · praguri: vechi după {v.praguri.stale_ms / 60e3} min, expirate după {v.praguri.expirat_ms / 3600e3} h
        {v.motive.length ? ` · decis de: ${v.motive.join(', ')}` : ''}
      </div>
    </div>
  )
}

// ── indisponibile ────────────────────────────────────────────────────────────────────────────
function Indisponibile({ lista }) {
  if (!lista.length) return null
  return (
    <div style={{ ...S.card, padding: 14, borderColor: G.purple }}>
      <h3 style={{ ...S.h, color: G.purple }}>Indisponibile ({lista.length}) — nu putem verifica, deci nu e verde</h3>
      <div style={{ display: 'grid', gap: 8 }}>
        {lista.map(i => (
          <div key={i.id} style={{ borderLeft: `3px solid ${G.purple}`, paddingLeft: 10 }}>
            <div style={{ fontSize: 13, color: G.text, fontWeight: 600 }}>
              {i.sursa === 'snapshot' ? 'Datele de pe ecran' : i.sursa === 'control' ? `Controlul ${i.reguli_afectate[0]}` : TABEL_SURSA[i.sursa] || i.sursa}
              <span style={{ ...S.chip(G.purple), marginLeft: 8 }}>{i.motiv}</span>
            </div>
            <div style={{ fontSize: 12, color: G.muted }}>{i.detaliu}</div>
            {i.reguli_afectate.length > 0 && <div style={{ fontSize: 11, color: G.dim }}>reguli neevaluate: {i.reguli_afectate.includes('*') ? 'toate' : i.reguli_afectate.join(', ')}</div>}
            <Intentie a={i.actiune_umana} />
          </div>
        ))}
      </div>
    </div>
  )
}

// ── lista „Necesită atenția ta" ──────────────────────────────────────────────────────────────
function Element({ x, onDuMa }) {
  const id = x.nr_ordine != null ? `#${x.nr_ordine}` : x.document_id != null ? `doc ${x.document_id}` : x.capitol_id != null && x.cerinta_id == null ? `cap. id ${x.capitol_id}` : x.acoperire_id != null ? `acoperire ${x.acoperire_id}` : ''
  const cap = x.actiune?.parametri?.capitol_id ?? (x.cerinta_id == null ? x.capitol_id : null)
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12, padding: '2px 0', borderBottom: `1px dashed ${G.border2}` }}>
      <span style={{ color: G.muted, minWidth: 52 }}>{id}</span>
      <span style={{ color: G.text, flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
        {scurt(x.motiv, 220)}
        {x.sursa && <span style={{ color: G.dim }}> · sursa {x.sursa}</span>}
        {x.detalii?.dovezi_atasate === null && <span style={{ color: G.purple }}> · dovezi atașate: necunoscut</span>}
        {x.candidat && <span style={{ color: G.purple }}> · citat candidat AI „{scurt(x.candidat.citat, 60)}" ({x.candidat.propunere_ai}) — doar afișare</span>}
        {x.alte_capitole && <span style={{ color: G.dim }}> · și în capitolele {x.alte_capitole.join(', ')}</span>}
      </span>
      {cap != null && <button type="button" style={{ ...S.btn, padding: '1px 7px' }} onClick={() => onDuMa({ capitol_id: cap, cerinta_id: x.cerinta_id })}>Du-mă →</button>}
    </div>
  )
}
// Unde duce „Du-mă acolo": capitolul țintă; „fără capitol" DOAR pentru regulile PT (vederea arată cerințele PT fără capitol);
// grupurile de registru / dovezi „fără capitol" (E2, R06) conțin și cerințe ne-PT → spunem ecranul din aplicație, nu o vedere care nu le arată
export const destinatieDuMa = e => (e.tinta?.capitol ? { capitol_id: e.tinta.capitol.id } : e.grup === 'fara_capitol' && e.domeniu === 'pt' ? { capitol_id: 'fara' } : null)
function ItemAtentie({ e, onDuMa, cls }) {
  const [deschis, setDeschis] = useState(false)
  const [toate, setToate] = useState(false)
  const [dest, setDest] = useState(null)
  const el = e.elemente || []
  const vizibile = toate ? el : el.slice(0, 8)
  const duMa = () => {
    const d = destinatieDuMa(e)
    if (d) return onDuMa(d)
    setDest(e.tinta); setDeschis(true)
  }
  return (
    <div style={{ borderLeft: `3px solid ${cls.c}`, background: G.surface, borderRadius: 6, padding: '9px 11px', opacity: e.din_date_expirate ? 0.6 : 1 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <span style={{ color: cls.c, fontWeight: 700 }}>{cls.icon}</span>
        <span style={{ color: G.text, fontWeight: 600, fontSize: 13, flex: '1 1 260px', minWidth: 0 }}>{e.titlu}</span>
        <span style={S.chip(e.blocheaza_final ? G.red : G.muted)}>{e.blocheaza_final ? 'blochează acțiunea finală' : 'nu blochează final'}</span>
        <span style={S.chip(G.dim)}>poarta: {e.porti.join(', ')}</span>
        <Prov p={e.provenienta} calitate={e.din_date_expirate ? 'expirat' : e.stale ? 'stale' : 'proaspat'} />
        {e.stale && <span style={S.chip(G.orange)}>date vechi</span>}
        {e.din_date_expirate && <span style={S.chip(G.purple)}>din date expirate — nu contează la verdict</span>}
        <span style={{ ...S.chip(G.dim) }}>{e.regula}</span>
      </div>
      <div style={{ fontSize: 12, color: G.muted, marginTop: 5 }}>{e.cauza}</div>
      {e.provenienta?.detaliu?.text_sursa && (
        <div style={{ fontSize: 12, color: G.text, marginTop: 5, padding: '5px 8px', background: G.bg, borderRadius: 5, borderLeft: `2px solid ${G.border}` }}>
          <span style={{ color: G.dim }}>textul sursei: </span>{scurt(e.provenienta.detaliu.text_sursa, 600)}
        </div>
      )}
      <Intentie a={e.actiune_umana} />
      <div style={{ display: 'flex', gap: 6, marginTop: 7, flexWrap: 'wrap' }}>
        <button type="button" style={S.btn} onClick={duMa}>Du-mă acolo</button>
        {el.length > 0 && <button type="button" style={S.btn} onClick={() => setDeschis(d => !d)}>{deschis ? '▾' : '▸'} Elemente ({el.length})</button>}
      </div>
      {dest && (
        <div style={{ fontSize: 12, color: G.yellow, marginTop: 6 }}>
          În aplicație te-ar duce la ecranul „{ECRAN[dest.ecran] || dest.ecran}"{dest.filtru ? ` (filtrul „${dest.filtru}")` : ''}. În prototip ecranul nu există — elementele sunt listate aici.
        </div>
      )}
      {deschis && el.length > 0 && (
        <div style={{ marginTop: 6 }}>
          {vizibile.map((x, i) => <Element key={i} x={x} onDuMa={onDuMa} />)}
          {el.length > 8 && <button type="button" style={{ ...S.btn, marginTop: 5 }} onClick={() => setToate(t => !t)}>{toate ? 'Arată mai puține' : `Arată toate (${el.length})`}</button>}
        </div>
      )}
    </div>
  )
}
function ListaAtentie({ exceptii, onDuMa, verdict }) {
  const total = exceptii.length
  // Fără date utilizabile (altă licitație, licitație nepermisă, toate sursele căzute) NU există listă: nu afișăm „(0)" și nici „nicio excepție"
  if (verdict?.lista_construita === false) return (
    <div style={{ ...S.card, padding: 14, borderColor: G.purple }}>
      <h3 style={{ ...S.h, color: G.purple }}>Necesită atenția ta — lista nu poate fi construită</h3>
      <div style={{ fontSize: 13, color: G.purple }}>Lista nu poate fi construită: {String(verdict.lista_motiv || 'datele nu pot fi folosite').replace(/\.\s*$/, '')}. Nu afișăm o listă goală în loc — vezi Indisponibile.</div>
    </div>
  )
  const nev = verdict?.reguli_neevaluate?.length || 0
  return (
    <div style={{ ...S.card, padding: 14 }}>
      <h3 style={S.h}>Necesită atenția ta ({total}{nev ? ` · ${nev} ${nev === 1 ? 'regulă neevaluată' : 'reguli neevaluate'}` : ''})</h3>
      {total === 0 && (nev
        ? <div style={{ fontSize: 13, color: G.purple }}>0 excepții în regulile care au putut fi evaluate; {nev} {nev === 1 ? 'regulă n-a putut fi evaluată' : 'reguli n-au putut fi evaluate'} ({verdict.reguli_neevaluate.join(', ')}) — vezi Indisponibile. {NEGATIE_GATA}.</div>
        : <div style={{ fontSize: 13, color: G.muted }}>Nicio excepție în sursele citite. {NEGATIE_GATA}.</div>)}
      <div style={{ display: 'grid', gap: 14 }}>
        {CLASE.map(cls => {
          const lst = exceptii.filter(e => e.clasa === cls.k)
          if (!lst.length) return null
          return (
            <section key={cls.k} data-clasa={cls.k}>
              <div style={{ fontSize: 12, color: cls.c, fontWeight: 700, marginBottom: 6 }}>
                {cls.icon} {cls.nume} ({lst.length}) <span style={{ color: G.dim, fontWeight: 400 }}>— {cls.desc}</span>
              </div>
              <div style={{ display: 'grid', gap: 7 }}>{lst.map(e => <ItemAtentie key={e.id} e={e} cls={cls} onDuMa={onDuMa} />)}</div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
function ListaOk({ ok }) {
  const [deschis, setDeschis] = useState(false)
  if (!ok.length) return null
  return (
    <div style={{ ...S.card, padding: '10px 14px' }}>
      <button type="button" style={{ ...S.btn, background: 'transparent', border: 'none', padding: 0, color: G.muted }} onClick={() => setDeschis(d => !d)}>
        {deschis ? '▾' : '▸'} {ok.length} rânduri fără excepție (doar din surse citite; proveniență om / server / regulă client — niciodată AI)
      </button>
      {deschis && (
        <div style={{ display: 'grid', gap: 4, marginTop: 8 }}>
          {ok.map(o => (
            <div key={o.id} style={{ fontSize: 12, color: G.text, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ color: G.muted }}>✓</span>{o.titlu}<Prov p={o.provenienta} calitate={o.stale ? 'stale' : 'proaspat'} />{o.stale && <span style={S.chip(G.orange)}>date vechi</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── cuprins + workspace ──────────────────────────────────────────────────────────────────────
function Progres({ p, calitate }) {
  if (!p.total) return <span style={{ fontSize: 11, color: G.dim }}>fără cerințe atribuite</span>
  const proc = Math.round((p.verificate_om / p.total) * 100)
  return (
    <div style={{ display: 'grid', gap: 3 }}>
      <div style={{ height: 5, background: G.border2, borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${proc}%`, height: '100%', background: culoareStinsa(G.green, calitate) }} />
      </div>
      <div style={{ fontSize: 11, color: G.muted }}>
        {p.verificate_om}/{p.total} verificate de om{SUFIX_CALITATE[calitate] || ''}
        {p.verificate_alt_capitol > 0 && <span style={{ color: G.orange }}> · {p.verificate_alt_capitol} verificate doar în alt capitol</span>}
        {p.candidati_ai > 0 && <span style={{ color: G.purple }}> · {p.candidati_ai} candidați AI</span>}
        {p.blocate > 0 && <span style={{ color: G.red }}> · {p.blocate} blocate</span>}
        {p.versiune_veche > 0 && <span style={{ color: G.orange }}> · {p.versiune_veche} pe versiune veche</span>}
        {p.atribuite_om > 0 && <span style={{ color: G.yellow }}> · {p.atribuite_om} atribuite de om</span>}
      </div>
    </div>
  )
}
function Cuprins({ cuprins, capSel, onSel, rezultat }) {
  const expirat = cuprins.calitate === 'expirat'
  const areCap02 = id => rezultat?.exceptii.some(e => e.id === `CAP02:cap:${id}`)
  return (
    <div style={{ ...S.card, padding: 12, display: 'grid', gap: 6, alignContent: 'start' }}>
      <h3 style={S.h}>Cuprins</h3>
      {cuprins.calitate !== 'proaspat' && <div style={{ fontSize: 11, color: expirat ? G.purple : G.orange }}>{expirat ? 'date expirate — cifre doar orientative, fără verde' : 'date vechi — recitește'}</div>}
      {cuprins.capitole.map(k => {
        const sel = capSel === k.id
        return (
          <button type="button" key={k.id} onClick={() => onSel(k.id)} style={{ textAlign: 'left', background: sel ? `${G.ofertare}1f` : 'transparent', border: `1px solid ${sel ? G.ofertare : G.border2}`,
            borderRadius: 7, padding: '7px 9px', cursor: 'pointer', color: G.text, display: 'grid', gap: 4 }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>
              {k.nr}. {scurt(k.titlu, 58)} {k.blocat && <span title="lacăt pe capitol">🔒</span>}
              {areCap02(k.id) && <span style={{ ...S.chip(G.purple), marginLeft: 4 }}>text AI necitit</span>}
            </div>
            <Progres p={k.progres} calitate={cuprins.calitate} />
          </button>
        )
      })}
      <button type="button" onClick={() => onSel('fara')} style={{ textAlign: 'left', background: capSel === 'fara' ? `${G.ofertare}1f` : 'transparent', border: `1px solid ${capSel === 'fara' ? G.ofertare : G.border2}`,
        borderRadius: 7, padding: '7px 9px', cursor: 'pointer', color: G.text, fontSize: 12 }}>
        Fără capitol ({cuprins.fara_capitol.length} cerințe PT)
      </button>
    </div>
  )
}
function RandCerinta({ c, evidentiat, calitate }) {
  const [t0, col0] = STARE_CERINTA[c.stare] || [c.stare, G.dim]
  const col = culoareStinsa(col0, calitate)
  const t = `${t0}${c.stare === 'verificata_alt_capitol' && c.verificata_in_capitol != null ? ` (cap. ${c.verificata_in_capitol})` : ''}${col !== col0 ? SUFIX_CALITATE[calitate] : ''}`
  return (
    <div id={`cer-${c.cerinta_id}`} style={{ padding: '7px 8px', borderRadius: 6, background: evidentiat ? `${G.ofertare}22` : G.surface, border: `1px solid ${evidentiat ? G.ofertare : G.border2}`, display: 'grid', gap: 4 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: G.muted, fontWeight: 700 }}>#{c.nr_ordine}</span>
        <span style={S.chip(col)}>{t}</span>
        <span style={S.chip(G.dim)}>{c.tip}</span>
        {c.capcana === true && <span style={S.chip(G.red)}>capcană de respingere</span>}
        {c.capcana === null && <span style={S.chip(G.orange)}>capcană: necunoscut</span>}
        {c.e2 === 'neconfirmata' && <span style={S.chip(G.yellow)}>E2 neconfirmată</span>}
        {c.e2 === null && <span style={S.chip(G.dim)}>E2: necunoscut</span>}
        {!c.principal && <span style={S.chip(G.dim)}>capitol secundar</span>}
        {c.exceptii.map(id => <span key={id} style={S.chip(G.muted)}>{id.split(':')[0]}</span>)}
      </div>
      <div style={{ fontSize: 12, color: G.text, overflowWrap: 'anywhere' }}>{scurt(c.text, 320)}{c.text_trunchiat && <span style={{ color: G.dim }}> (text trunchiat în fixture)</span>}</div>
      {c.stare === 'blocata' && <div style={{ fontSize: 11, color: G.red }}>constatare: {c.constatare || '— (nerecitită / lipsă)'} · severitate {c.severitate || '—'}</div>}
      {c.stare === 'versiune_veche' && <div style={{ fontSize: 11, color: G.orange }}>verificată pe v{c.verificat_la_versiunea}; textul capitolului s-a schimbat de atunci</div>}
      {c.candidat && <div style={{ fontSize: 11, color: G.purple }}>citat candidat AI ({c.candidat.propunere_ai}, {c.candidat.locator}): „{scurt(c.candidat.citat, 160)}" — candidat, nu verificare</div>}
      {c.candidat_invalid && <div style={{ fontSize: 11, color: G.orange }}>candidat de citat ignorat: {c.candidat_invalid.join(', ')}</div>}
      {c.nota && <div style={{ fontSize: 11, color: G.dim }}>notă atribuire: {scurt(c.nota, 160)}</div>}
    </div>
  )
}
function Workspace({ cuprins, capSel, cerSel }) {
  if (capSel === 'fara') {
    return (
      <div style={{ ...S.card, padding: 14, display: 'grid', gap: 8, alignContent: 'start' }}>
        <h3 style={S.h}>Cerințe PT fără capitol ({cuprins.fara_capitol.length})</h3>
        {cuprins.fara_capitol.length === 0 && <div style={{ fontSize: 12, color: G.muted }}>Nicio cerință PT fără capitol în sursele citite.</div>}
        {cuprins.fara_capitol.map(c => (
          <div key={c.cerinta_id} style={{ padding: '7px 8px', borderRadius: 6, background: G.surface, border: `1px solid ${G.border2}`, fontSize: 12, color: G.text, display: 'grid', gap: 4 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <b style={{ color: G.muted }}>#{c.nr_ordine}</b>
              {c.exceptata ? <span style={S.chip(culoareStinsa(c.sursa_exceptie === 'om' ? G.green : G.orange, cuprins.calitate))}>exceptată de {c.sursa_exceptie || 'necunoscut'}{c.sursa_exceptie === 'om' ? SUFIX_CALITATE[cuprins.calitate] || '' : ''}</span> : <span style={S.chip(G.red)}>fără capitol</span>}
              {c.exceptii.map(id => <span key={id} style={S.chip(G.muted)}>{id.split(':')[0]}</span>)}
            </div>
            <div>{scurt(c.text, 320)}</div>
            {c.motiv_exceptie && <div style={{ fontSize: 11, color: G.dim }}>motiv: {scurt(c.motiv_exceptie, 220)}</div>}
          </div>
        ))}
      </div>
    )
  }
  const k = cuprins.capitole.find(x => x.id === capSel)
  if (!k) return <div style={{ ...S.card, padding: 14, fontSize: 13, color: G.muted }}>Alege un capitol din cuprins sau apasă „Du-mă acolo" pe o excepție.</div>
  const contradictie = k.stare_stocata === 'gol' && k.continut_gol === false
  return (
    <div style={{ ...S.card, padding: 14, display: 'grid', gap: 10, alignContent: 'start' }}>
      <div>
        <h3 style={{ ...S.h, marginBottom: 4 }}>Workspace capitol {k.nr} · v{k.versiune}</h3>
        <div style={{ fontSize: 13, color: G.text, fontWeight: 600 }}>{k.titlu}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
          <span style={S.chip(culoareStinsa(k.sursa === 'om' ? G.green : k.sursa === 'ai' ? G.purple : G.dim, cuprins.calitate))}>scris de: {k.sursa ?? 'necunoscut'}</span>
          <span style={S.chip(G.dim)}>acceptat de om: acțiunea nu există încă (QW4)</span>
          {k.obligatoriu === false && <span style={S.chip(G.dim)}>opțional</span>}
          {k.blocat && <span style={S.chip(G.orange)}>🔒 lacăt</span>}
          {contradictie && <span style={S.chip(G.orange)}>stare stocată „gol", dar are text (INT03)</span>}
          <span style={S.chip(G.dim)}>md5 {String(k.continut_md5 || '—').slice(0, 8)}</span>
        </div>
        <div style={{ marginTop: 8 }}><Progres p={k.progres} calitate={cuprins.calitate} /></div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
        <div style={{ display: 'grid', gap: 6, alignContent: 'start' }}>
          <div style={S.lbl}>Cerințele capitolului ({k.cerinte.length})</div>
          {k.cerinte.length === 0 && <div style={{ fontSize: 12, color: G.muted }}>Nicio cerință atribuită acestui capitol.</div>}
          <div style={{ display: 'grid', gap: 6, maxHeight: 560, overflowY: 'auto', paddingRight: 4 }}>
            {k.cerinte.map(c => <RandCerinta key={c.cerinta_id} c={c} evidentiat={cerSel === c.cerinta_id} calitate={cuprins.calitate} />)}
          </div>
          <div style={{ fontSize: 11, color: G.dim }}>Nu există „confirmă toate": verificarea e pe fiecare cerință, lângă text, în aplicație — după GO.</div>
        </div>
        <div style={{ display: 'grid', gap: 6, alignContent: 'start' }}>
          <div style={S.lbl}>Textul capitolului (read-only)</div>
          <div style={{ whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.5, color: G.text, background: G.bg, border: `1px solid ${G.border2}`, borderRadius: 6, padding: 10, maxHeight: 560, overflowY: 'auto' }}>
            {k.text || '— fără text —'}
          </div>
          {k.text_trunchiat && <div style={{ fontSize: 11, color: G.orange }}>Fixture-ul păstrează doar primele 1500 de caractere din {k.continut_len} (md5 și lungimea sunt pe textul integral).</div>}
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// EcranAtentie — prezentare pură (primește rezultatul deja calculat)
// ════════════════════════════════════════════════════════════════
export function EcranAtentie({ rezultat, cuprins, snapshot, capSel: capInitial = null, controale = null, faraDate = null }) {
  const [capSel, setCapSel] = useState(capInitial)
  const [cerSel, setCerSel] = useState(null)
  const wsRef = useRef(null)
  const capEfectiv = capSel ?? (cuprins?.disponibil ? (rezultat?.exceptii.find(e => e.tinta?.capitol)?.tinta.capitol.id ?? cuprins.capitole[0]?.id ?? 'fara') : null)
  const onDuMa = ({ capitol_id, cerinta_id }) => {
    setCapSel(capitol_id); setCerSel(cerinta_id ?? null)
    if (typeof window !== 'undefined') window.requestAnimationFrame(() => {
      wsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      if (cerinta_id != null) document.getElementById(`cer-${cerinta_id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }
  return (
    <div style={{ minHeight: '100vh', background: G.bg, color: G.text, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', padding: '14px 16px 40px', boxSizing: 'border-box' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: G.ofertare }}>📑 PT — Necesită atenția ta <span style={{ fontSize: 12, color: G.muted, fontWeight: 500 }}>prototip B (Workspace V2)</span></div>
          <span style={S.chip(G.orange)}>prototip read-only — nicio acțiune nu scrie · fixture clona 103, anonimizat · nu e producție</span>
        </div>
        {controale}
        {!rezultat && faraDate && <div style={{ ...S.card, padding: 16, fontSize: 14, color: G.purple, borderColor: G.purple }}>{faraDate}</div>}
        {!rezultat && !faraDate && <div style={{ ...S.card, padding: 16, fontSize: 14, color: G.muted }}>Se încarcă… (nicio listă nu se afișează până nu avem datele licitației selectate)</div>}
        {rezultat && <>
          <Antet rezultat={rezultat} snapshot={snapshot} />
          <Indisponibile lista={rezultat.indisponibile} />
          <ListaAtentie exceptii={rezultat.exceptii} onDuMa={onDuMa} verdict={rezultat.verdict} />
          <ListaOk ok={rezultat.ok} />
          <div ref={wsRef} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' }}>
            {cuprins?.disponibil ? <>
              <div style={{ flex: '1 1 260px', maxWidth: 380, minWidth: 0 }}><Cuprins cuprins={cuprins} capSel={capEfectiv} onSel={id => { setCapSel(id); setCerSel(null) }} rezultat={rezultat} /></div>
              <div style={{ flex: '999 1 560px', minWidth: 0 }}><Workspace cuprins={cuprins} capSel={capEfectiv} cerSel={cerSel} /></div>
            </> : (
              <div style={{ ...S.card, padding: 14, fontSize: 13, color: G.purple, flex: '1 1 100%' }}>
                {cuprins?.motiv || 'Cuprinsul nu poate fi afișat.'}
              </div>
            )}
          </div>
          <div style={{ fontSize: 11, color: G.dim, lineHeight: 1.6 }}>
            Ce e simulat: verdictul agregat (J07 nu există în BD), ceasul de evaluare (dacă nu alegi ceasul real), încărcarea (întârzieri artificiale). Ce NU face: nu scrie în BD,
            nu rulează AI, nu confirmă, nu acceptă text, nu generează pachet. „Du-mă acolo" doar selectează capitolul aici.
          </div>
        </>}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// Containerul: scenarii + încărcare simulată cu gardă de concurență
// ════════════════════════════════════════════════════════════════
// Fixture-ul clonei 103 (date reale anonimizate euristic) NU se comite (prototip/pt-atentie/.gitignore). Îl încărcăm opțional:
// fără el, prototipul spune că nu are date — nu afișează nicio listă, niciun verdict.
const FIXTURI = import.meta.glob('./fixtures/l103.json', { eager: true, import: 'default' })
const fixture = FIXTURI['./fixtures/l103.json'] ?? null
const CAPT = fixture?.meta?.capturat_la ?? null
export default function PtNecesitaAtentia() {
  if (!fixture) return (
    <EcranAtentie rezultat={null} cuprins={null} snapshot={null} faraDate={
      'Fixture-ul clonei 103 (prototip/pt-atentie/fixtures/l103.json) lipsește din acest checkout: e date reale anonimizate și nu se comite fără review uman. ' +
      'Fără el prototipul nu are date — nu afișează nicio listă și niciun verdict.'} />
  )
  return <PtNecesitaAtentiaCuDate />
}
function PtNecesitaAtentiaCuDate() {
  const [scenariu, setScenariu] = useState('normal')
  const [sursaEroare, setSursaEroare] = useState('acoperire')
  const [ceas, setCeas] = useState('proaspat')
  const [licSel, setLicSel] = useState(LICITATIE_A)
  const [garda, setGarda] = useState(true)
  const [snapshot, setSnapshot] = useState(null)
  const [jurnal, setJurnal] = useState([])
  const [acumReal, setAcumReal] = useState(() => Date.now())
  const baza = useMemo(() => normalizeazaSnapshot(fixture), [])
  const snapA = useMemo(() => snapshotScenariu(baza, scenariu, sursaEroare), [baza, scenariu, sursaEroare])
  const snapARef = useRef(snapA); snapARef.current = snapA
  const gardaRef = useRef(garda); gardaRef.current = garda
  const licRef = useRef(licSel); licRef.current = licSel
  const t0 = useRef(Date.now())
  const timere = useRef([])
  const inc = useRef(null)
  if (!inc.current) inc.current = creeazaIncarcator({
    citeste: l => (l === LICITATIE_A ? snapARef.current : snapshotSintetic(l, CAPT)),
    aplica: snap => setSnapshot(snap),
    jurnal: e => setJurnal(j => [...j.slice(-24), { ...e, t: Date.now() - t0.current, garda: gardaRef.current }]),
    garda: () => gardaRef.current,
  })
  // (re)încarcă licitația curentă când se schimbă scenariul
  useEffect(() => { inc.current.incarca(licRef.current, 250) }, [snapA])
  useEffect(() => () => { inc.current.opreste(); timere.current.forEach(clearTimeout) }, [])
  useEffect(() => { if (ceas !== 'real') return; const t = setInterval(() => setAcumReal(Date.now()), 30e3); return () => clearInterval(t) }, [ceas])

  const alegeLic = l => { setLicSel(l); inc.current.incarca(l, l === LICITATIE_B ? 1800 : 300) }
  const ruleazaCursa = () => {
    timere.current.forEach(clearTimeout); t0.current = Date.now(); setJurnal([])
    alegeLic(LICITATIE_A)
    timere.current = [setTimeout(() => alegeLic(LICITATIE_B), 100), setTimeout(() => alegeLic(LICITATIE_A), 250)]
  }
  const alegeScenariu = id => { setScenariu(id); setCeas(SCENARII.find(s => s.id === id)?.ceas || 'proaspat'); if (id !== 'cursa' && licSel !== LICITATIE_A) alegeLic(LICITATIE_A) }

  const acum = ceas === 'real' ? acumReal : acumPentru(ceas, CAPT)
  const opts = { acum, licitatieId: licSel }
  const rezultat = useMemo(() => (snapshot ? construiesteAtentia(snapshot, opts) : null), [snapshot, acum, licSel])   // eslint-disable-line react-hooks/exhaustive-deps
  const cuprins = useMemo(() => (snapshot ? construiesteCuprins(snapshot, opts, rezultat) : null), [snapshot, acum, licSel, rezultat])   // eslint-disable-line react-hooks/exhaustive-deps

  const controale = (
    <div style={{ ...S.card, padding: 12, display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-end' }}>
      <label><span style={S.lbl}>Scenariu</span>
        <select style={S.select} value={scenariu} onChange={e => alegeScenariu(e.target.value)}>{SCENARII.map(s => <option key={s.id} value={s.id}>{s.eticheta}</option>)}</select>
      </label>
      {scenariu === 'eroare' && <label><span style={S.lbl}>Sursa care dă eroare</span>
        <select style={S.select} value={sursaEroare} onChange={e => setSursaEroare(e.target.value)}>{SURSE_DE_STRICAT.map(s => <option key={s.id} value={s.id}>{s.eticheta}</option>)}</select>
      </label>}
      <label><span style={S.lbl}>Ceasul de evaluare</span>
        <select style={S.select} value={ceas} onChange={e => setCeas(e.target.value)}>{CEASURI.map(c => <option key={c.id} value={c.id}>{c.eticheta}</option>)}</select>
      </label>
      <label><span style={S.lbl}>Licitația selectată</span>
        <select style={S.select} value={licSel} onChange={e => alegeLic(Number(e.target.value))}>
          <option value={LICITATIE_A}>A · 103 — clona de audit (Domnești)</option>
          <option value={LICITATIE_B}>B · {LICITATIE_B} — sintetică, fără date (răspuns lent)</option>
        </select>
      </label>
      {scenariu === 'cursa' && <>
        <label style={{ fontSize: 12, color: G.text, display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={garda} onChange={e => setGarda(e.target.checked)} /> gardă de concurență (request-id + golire la schimbare)
        </label>
        <button type="button" style={S.btn} onClick={ruleazaCursa}>▶ Rulează A→B→A (B întârziat 1,8 s)</button>
      </>}
      {scenariu === 'cursa' && jurnal.length > 0 && (
        <div style={{ flexBasis: '100%', fontSize: 11, color: G.muted, fontFamily: 'ui-monospace, monospace', display: 'grid', gap: 2 }}>
          {jurnal.map((e, i) => (
            <div key={i} style={{ color: e.tip === 'ignorat' ? G.yellow : e.tip === 'aplicat' && e.licitatieId !== licSel ? G.red : G.muted }}>
              +{e.t} ms · #{e.id} · {e.tip === 'cerere' ? `cerere pentru ${e.licitatieId} (răspuns în ${e.intarziereMs} ms)` : e.tip === 'ignorat'
                ? `IGNORAT: răspunsul pentru ${e.licitatieId} a venit târziu (cererea curentă e #${e.curent})` : `aplicat: datele licitației ${e.licitatieId}${e.garda ? '' : ' (fără gardă)'}`}
            </div>
          ))}
        </div>
      )}
    </div>
  )
  return <EcranAtentie key={licSel} rezultat={rezultat} cuprins={cuprins} snapshot={snapshot} controale={controale} />
}
