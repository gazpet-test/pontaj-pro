// ═══════════════════════════════════════════════════════════════════════════
// UscareConducta.jsx — Execuție → proiect → „💨 Uscare conductă” (migrarea 20261225a), gândit pentru TELEFON, pe șantier.
// Lista operațiunilor de uscare ale proiectului, formularul pe secțiuni (ordinea modelului beneficiarului), salvare pe parcurs + ciornă locală
// (și pentru raportul nou, înainte de prima salvare; erorile de stocare se arată), criteriul din caietul de sarcini (ultimul piston vehiculat
// iese uscat + fotografia lui), cântăririle pe fiecare burete declarat, pozele pe categorii direct din cameră (rezervare -> urcare ->
// înregistrare; încărcările nelămurite rămân vizibile din server, fără ștergere automată), poziția operațiunii (GPS la cerere / scrisă de
// mână), temperatura propusă din vremea șantierului PENTRU ORA ÎNCEPERII (instantaneul îl construiește serverul), închiderea (doar completă),
// redeschiderea consemnată (admin) și PDF-ul (coordonatele doar la cerere).
// Ecranul implicit (17.11.2026) e cel PE PAȘI (src/UscarePasi.jsx: tronson → etapa 1 → etapa 2 → rezumat → „Generează raportul”), cu pasul
// dedus din date (src/uscarePasi.js); formularul pe secțiuni de mai jos rămâne „Vezi / corectează toate datele”. Același formular, aceleași
// funcții de salvare / poze / PDF pentru ambele (spec §3a).
// Scrierea: DOAR prin RPC-urile fn_executie_uscare_salveaza / _stare / _poza; citirea prin RLS (dreptul pe proiect).
// L05: fiecare apăsare are cheia ei, scrisă în registrul local ÎNAINTE de trimitere; un rezultat necunoscut (rețea) rămâne în registru și se
//   lămurește prin retrimiterea IDENTICĂ (aceeași cheie) — o intenție nelămurită pe aceeași țintă (inclusiv o creare) blochează alta nouă.
//   „Renunț” NU mai șterge cheia pe baza markerului local (runda 3): întreabă serverul după cheie (fn_executie_uscare_retrage) — aplicată =
//   reușită (o creare deschide raportul creat), neaplicată = retrasă DEFINITIV pe server; fără răspuns sigur, cheia rămâne. Runda 5: se trimite
//   INTENȚIA din registru (RPC + parametri), serverul derivă proiectul și amprenta din ea; fără cotă (Renunț mereu posibil).
// CAS: formularul ține versiunea de BAZĂ; la conflict nu se salvează peste coleg: îmbinare pe câmpuri (momentele pe INSTANT) + alegere explicită.
// L24: orice rezultat asincron se aplică doar dacă proiectul, raportul și generația contextului sunt încă aceleași; propunerea meteo și GPS-ul
//   au în plus generația SURSEI (ora începerii / apariția ei / poziția): un răspuns pentru o sursă schimbată sau o captură mai veche se ignoră.
// ═══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase.js'
import { paginareKeyset } from './hrDeciziiUtil.js'
import { G, S } from './NodCuplareVizualizare.jsx'
import {
  ETICHETE_CATEGORII, ETICHETE_OBLIGATORII, ETICHETE_STARE, CULORI_STARE, RPC_USCARE, RPC_RETRAGE, prefixRegistru, MAX_BURETI, ETICHETE_POZ_SURSA,
  registruNou, clasificaReluare, formularNou, formularDinRand, payloadDinFormular, areModificari, lipsaDinRand, pozeLipsa, etichetaPozaLipsa,
  incarcariDeschise, cantaririPentru, imbinare, aleg, momenteLocale, invalidareMeteo, schimbaSursaMeteo, pozitieDinGps, distantaMeteo,
  durataOre, vitezaMedie, diferentaBurete, verificare24h, propunereMeteo, fmtZi, fmtMoment, fmtNr, fmtKm, actiuniPermise,
} from './uscareLogica.js'
import { parseNumar } from './izoDocumenteLogica.js'
import { pasCurent, formularPasNou, formularTrecereNoua, formularInregistreazaEtapa1, formularTerminaEtapa2 } from './uscarePasi.js'
import UscarePasi, { CardInLucru } from './UscarePasi.jsx'

const stocareImplicita = () => { try { return globalThis.localStorage || null } catch { return null } }
const BUCKET = 'executie-uscare'
const COL = 'id, proiect_id, proba_id, tronson, km_de_la_m, km_pana_la_m, lungime_m, inceput_planificat, notificare_la, notificare_ref, data_operatie, ora_inceput, ora_final, poz_lat, poz_lng, poz_sursa, poz_precizie_m, poz_la, poz_km_m, poz_traseu_versiune, temperatura_c, temperatura_sursa, meteo, vreme, constructor, utilaje, pig_metalic_buc, piston_pu_buc, bureti_buc, cantariri, punct_roua_c, punct_roua_loc, presiune_bar, timp_deplasare_min, piston_final_rezultat, poze_justificare, observatii, concluzie, semn_constructor_nume, semn_constructor_functie, semn_beneficiar_nume, semn_beneficiar_functie, stare, motiv_anulare, revizie, inchis_la, versiune, creat_la, modificat_la, creat_de, modificat_de'
const COL_POZA = 'id, uscare_id, proiect_id, categorie, burete_nr, cale, legenda, creat_la'
const COL_INC = 'id, uscare_id, proiect_id, cale, categorie, burete_nr, legenda, renuntat_motiv, renuntat_la, creat_la'
const CONSTRUCTOR_IMPLICIT = 'GAZPET INSTAL S.R.L.'
const uuid = () => globalThis.crypto.randomUUID()
const pagini = (client, tabel, coloane, filtru) => paginareKeyset((ultim, pas) => {
  let q = filtru(client.from(tabel).select(coloane)).order('id').limit(pas)
  if (ultim != null) q = q.gt('id', ultim)
  return q
})
const lipsaTabel = e => ['42P01', 'PGRST205', 'PGRST202'].includes(e?.code)
const MOMENTE_FORM = ['inceput_planificat', 'notificare_la', 'ora_inceput', 'ora_final']

// stiluri mari, pentru degetul de pe șantier (font 16 = fără zoom pe iPhone; butoane și câmpuri de cel puțin 48 px)
const ST = {
  card: { background: G.surface, border: `1px solid ${G.border}`, borderRadius: 14, padding: 14, margin: '10px 0' },
  h: { fontSize: 15, fontWeight: 800, margin: '0 0 10px', color: G.text },
  in: { ...S.input, minHeight: 48, fontSize: 16 },
  lab: { ...S.label, fontSize: 13, marginTop: 8 },
  btn: { ...S.btn, minHeight: 48, fontSize: 15 },
  mare: { ...S.btn, minHeight: 54, fontSize: 16, fontWeight: 800, width: '100%' },
  rand: { display: 'flex', gap: 8, alignItems: 'flex-end' },
  nota: { fontSize: 12, color: G.muted, marginTop: 6 },
}
// Proba pe telefon (17.11.2026): butoanele plutitoare ale platformei (🐛 stânga-jos; „Tichet” și asistentul dreapta-jos) stau la 24 px de jos
// și urcă până la ~106 px (🐛 52 px + eticheta de deasupra); acopereau bara de salvare (doar ~31% din buton se putea apăsa). Fără să atingem
// platforma: bara de salvare stă DEASUPRA zonei lor, iar formularul lasă jos spațiu cât zona + bara (ultimul câmp nu rămâne sub ea).
const REZERVA_PLUTITOARE = 112   // px de jos, ocupați de butoanele plutitoare
const INALTIME_BARA = 100        // bara (54 + 2×10 + chenar) cu marjă
const INALTIME_BARA_PASI = 150   // bara pașilor (runda 2): butonul mare (60) + „Salvează pe parcurs” (48) + spațiu (6) + 2×10 + chenare, cu marjă
// aceeași regulă pentru ecranul pe pași (o singură definiție, transmisă prin `p.jos`)
const JOS = { rezerva: REZERVA_PLUTITOARE, bara: INALTIME_BARA_PASI }
// ținta de atingere pe telefon (proba din 17.11.2026): cel puțin 44 × 44 px pentru „scoate poza” și pentru bifa coordonatelor
const TINTA_ATINGERE = 44
const Camp = ({ eticheta, children, nota }) => (
  <label style={{ display: 'block', flex: 1, minWidth: 0 }}><span style={ST.lab}>{eticheta}</span>{children}{nota && <span style={{ fontSize: 12, color: G.muted }}>{nota}</span>}</label>
)

// JPEG comprimat (bucket-ul acceptă doar image/jpeg): latura mare ≤ 1920 px, calitate 0,82
async function comprimaJpeg(file) {
  if (!file?.type?.startsWith('image/')) throw new Error('Alege o fotografie.')
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((ok, nu) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => nu(new Error('Fotografia nu poate fi citită (alege JPEG).')); i.src = url })
    const k = Math.min(1, 1920 / Math.max(img.width, img.height))
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k))
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
    return await new Promise((ok, nu) => c.toBlob(b => (b ? ok(b) : nu(new Error('Comprimarea a eșuat.'))), 'image/jpeg', 0.82))
  } finally { URL.revokeObjectURL(url) }
}

// ecranInitial: 'pasi' (telefonul: tronson → etapa 1 → etapa 2 → raport, src/UscarePasi.jsx) sau 'complet' (formularul pe secțiuni, „Vezi /
// corectează toate datele”, pentru birou și corecturi). Ambele lucrează pe ACELAȘI formular, cu aceleași RPC-uri, ciornă și reguli de conflict.
// onFormular (opțional, lansatorul de telefon /m): primește true / false când se deschide / se închide un raport — încadrarea își ascunde
// atunci „Înapoi”, ca ieșirea dintr-un raport să treacă prin „← Lista” (care întreabă la modificări nesalvate)
export default function UscareConducta({ proiectId, client = supabase, stocare = stocareImplicita(), comprima = comprimaJpeg, ecranInitial = 'pasi', acum = () => Date.now(), onFormular = null }) {
  const [uscari, setUscari] = useState([])
  const [probe, setProbe] = useState([])
  const [probeEroare, setProbeEroare] = useState(null)
  const [incarc, setIncarc] = useState(true)
  const [eroare, setEroare] = useState(null)
  const [neactivat, setNeactivat] = useState(false)
  const [poateScrie, setPoateScrie] = useState(false)
  const [esteAdmin, setEsteAdmin] = useState(false)
  const [uid, setUid] = useState(null)
  const [selectat, setSelectat] = useState(null)       // id-ul raportului deschis; 'nou' = formular nou
  const [form, setForm] = useState(null)
  const [baza, setBaza] = useState(null)               // rândul pe care s-a pornit formularul (versiunea trimisă la CAS)
  const [conflict, setConflict] = useState(null)       // { server, conflicte, alese: {camp: 'al_meu'|'al_colegului'}, schimbate }
  const [poze, setPoze] = useState([])
  const [incarcari, setIncarcari] = useState([])
  const [pozePentru, setPozePentru] = useState(null)   // id-ul raportului pentru care pozele / încărcările sunt citite
  const [miniaturi, setMiniaturi] = useState({})
  const [mesaj, setMesaj] = useState(null)              // { tip: 'ok' | 'eroare' | 'info', text }
  const [inCurs, setInCurs] = useState(false)
  const [nelamurite, setNelamurite] = useState([])
  const [motiv, setMotiv] = useState(null)              // { actiune, text } — pasul de confirmare pentru anulare / redeschidere
  const [renunt, setRenunt] = useState(null)            // { cale, text } — renunțarea la o încărcare nelămurită
  const [meteoAlegere, setMeteoAlegere] = useState(null)
  const [ciornaGasita, setCiornaGasita] = useState(null)
  const [ciornaEroare, setCiornaEroare] = useState(false)
  const [confirmConstructor, setConfirmConstructor] = useState(false)
  const [arataAnulate, setArataAnulate] = useState(false)
  const [coordPentru, setCoordPentru] = useState(null) // id-ul raportului pentru care s-a bifat „coordonatele în PDF” (nu se moștenește)
  const [incarcPoza, setIncarcPoza] = useState(null)   // { uscare, cale, categorie, burete, blob } — fișierul de reîncercat, legat de raport
  const [mod, setMod] = useState(ecranInitial)          // 'pasi' | 'complet' — ecranul raportului deschis
  const [ecranPas, setEcranPas] = useState(null)        // null | 'confirmare1' — confirmarea de după „Înregistrează etapa 1” (doar pe ecran)
  const [motivVerdict, setMotivVerdict] = useState('')  // runda 3: motivul verdictului contrar calculului, câmp DISTINCT (intră în observații la „Termină etapa 2”)
  const [confirmDetalii, setConfirmDetalii] = useState(null) // id-ul raportului ale cărui detalii precompletate au fost confirmate (nu se moștenește)
  const [pozeProiect, setPozeProiect] = useState({ lista: [], eroare: null }) // pozele rapoartelor DESCHISE (pasul din cardurile „în lucru”)
  const [autori, setAutori] = useState({ nume: {}, eroare: null })          // numele colegilor care au salvat ultima dată rapoartele deschise (cardurile)
  const [pdfInCurs, setPdfInCurs] = useState(false)                           // runda 2: PDF-ul (5–15 s pe telefon) se vede că lucrează
  const gen = useRef(0)
  const ctx = useRef(0)                                 // generația contextului (proiect / raport deschis)
  const genSursa = useRef(0)                            // generația sursei meteo: ora începerii (instantul) / poziția
  const genGps = useRef(0)                              // ultima captură GPS cerută (o captură mai veche sau o editare manuală o anulează)
  const registru = useRef(null)
  const blocat = useRef(false)
  const pdfOprire = useRef(null)                        // AbortController-ul exportului PDF în curs (runda 6)
  // runda 6: orice schimbare de context (alt raport, listă, alt proiect, ieșire) oprește și exportul PDF în zbor (citirile pozelor, capturile)
  const schimbaCtx = () => { ctx.current += 1; pdfOprire.current?.abort(); pdfOprire.current = null }
  const proiectCurent = useRef(proiectId)
  proiectCurent.current = proiectId                     // sincron, la randare: un răspuns care sosește înaintea efectului de schimbare tot e prins

  const rand = typeof selectat === 'number' ? uscari.find(u => u.id === selectat) || null : null
  const reimprospateazaNelamurite = () => setNelamurite(registru.current?.toate() || [])
  const tinta = selectat === 'nou' ? 'nou' : typeof selectat === 'number' ? `u${selectat}` : null
  const nelamuriteTinta = nelamurite.filter(i => i.tinta === tinta || (selectat === 'nou' && i.tinta === 'nou'))
  // runda 4 (verdict P2-3): contextul COMPLET al unei cereri (generația, proiectul, formularul deschis, registrul, contul), capturat ÎNAINTEA
  // ei și verificat după FIECARE await; un rezultat se aplică pe ecran (mesaj, listă, deschiderea raportului) doar dacă toate sunt încă cele
  // actuale. Registrul capturat primește dovada (scoaterea cheii lămurite) chiar dacă între timp s-a navigat: e registrul proiectului cererii.
  // Runda 5: TOATE acțiunile asincrone (salvare, stare, poze — inclusiv comprimarea —, meteo, GPS, PDF, lămurire) primesc contextul capturat
  // ÎNAINTEA primului await și îl transmit mai departe (nimic nu se recapturează după un await); o scriere se emite doar dacă contextul e încă
  // valid (trimite). Citirile (listă, poze, meteo, GPS, PDF) cer generația + proiectul; scrierile și registrul cer în plus același registru.
  // Runda 6: PDF-ul verifică contextul și ÎN exportator (după fiecare citire / captură, înainte de descărcare) — vezi pdf() și uscarePdf.js.
  const capteaza = (sel = selectat) => ({ t: ctx.current, proiect: proiectId, selectat: sel, reg: registru.current, uid })
  const ctxCitire = c => !!c && c.t === ctx.current && c.proiect === proiectCurent.current
  const ctxValid = c => ctxCitire(c) && c.reg === registru.current

  // ── încărcarea listei (keyset, L23) + drepturile; întoarce true doar dacă s-a aplicat ──
  const incarca = useCallback(async () => {
    const g = ++gen.current
    setIncarc(true); setEroare(null)
    try {
      const [u, p, scr, adm] = await Promise.all([
        pagini(client, 'executie_uscari', COL, q => q.eq('proiect_id', proiectId)),
        pagini(client, 'executie_probe_tronsoane', 'id, proiect_id, cod, denumire, km_de_la_m, km_pana_la_m, stare', q => q.eq('proiect_id', proiectId)).catch(e => ({ eroare: e })),
        client.rpc('fn_executie_nod_drept', { p_proiect: proiectId, p_scriere: true }),
        client.rpc('fn_executie_contract_drept', { p_proiect: proiectId, p_scriere: true }),
      ])
      // pașii rapoartelor DESCHISE (cardurile „în lucru”) se deduc și din pozele lor: citite pe bucăți de câte 100 de id-uri (keyset, L23);
      // o eroare NU e „nicio poză” (L18): cardul spune că pasul nu s-a putut determina
      if (g !== gen.current || proiectCurent.current !== proiectId) return false
      const ids = u.filter(x => x.proiect_id === proiectId && x.stare === 'deschisa').map(x => x.id)
      let pp = { lista: [], eroare: null }
      try {
        for (let i = 0; i < ids.length; i += 100) {
          const bucata = ids.slice(i, i + 100)
          const l = await pagini(client, 'executie_uscare_poze', 'id, uscare_id, proiect_id, categorie, burete_nr', q => q.in('uscare_id', bucata))
          if (g !== gen.current || proiectCurent.current !== proiectId) return false
          pp.lista = pp.lista.concat(l.filter(x => bucata.includes(x.uscare_id) && x.proiect_id === proiectId))
        }
      } catch (e) { pp = { lista: [], eroare: e?.message || String(e) } }
      // runda 2 (etapa 2 o poate face ALT coleg): cardul spune cine a salvat ultima dată raportul deschis (numele din profiles, pe bucăți de
      // câte 100 de id-uri, ca în IzoCorectii). Eroarea de citire NU e „fără nume” (L18): cardul spune că numele nu s-a putut citi.
      const uids = [...new Set(u.filter(x => x.proiect_id === proiectId && x.stare === 'deschisa').map(x => x.modificat_de).filter(Boolean))]
      let au = { nume: {}, eroare: null }
      try {
        for (let i = 0; i < uids.length; i += 100) {
          const bucata = uids.slice(i, i + 100)
          const l = await pagini(client, 'profiles', 'id, name', q => q.in('id', bucata))
          if (g !== gen.current || proiectCurent.current !== proiectId) return false
          for (const x of l) if (bucata.includes(x.id)) au.nume[x.id] = x.name
        }
      } catch (e) { au = { nume: {}, eroare: e?.message || String(e) } }
      // runda 5: și proiectul (sincron, din randare): un răspuns sosit între randarea noului proiect și efectul lui nu se aplică
      if (g !== gen.current || proiectCurent.current !== proiectId) return false
      setUscari(u.filter(x => x.proiect_id === proiectId)); setNeactivat(false); setPozeProiect(pp); setAutori(au)
      // L18: eroarea listei de tronsoane de probă NU e „nicio probă”
      if (Array.isArray(p)) { setProbe(p.filter(x => x.proiect_id === proiectId && x.stare === 'activ')); setProbeEroare(null) }
      else { setProbe([]); setProbeEroare('Tronsoanele de probă nu s-au putut citi: ' + (p?.eroare?.message || 'eroare')) }
      setPoateScrie(!scr.error && scr.data === true)
      setEsteAdmin(!adm.error && adm.data === true)
      if (scr.error) setMesaj({ tip: 'eroare', text: 'Nu am putut verifica dreptul de scriere: ' + scr.error.message })
      return true
    } catch (e) {
      if (g !== gen.current || proiectCurent.current !== proiectId) return false
      if (lipsaTabel(e)) setNeactivat(true)
      else setEroare('Nu am putut încărca rapoartele de uscare: ' + (e?.message || e))
      return false
    } finally { if (g === gen.current && proiectCurent.current === proiectId) setIncarc(false) }
  }, [client, proiectId])

  useEffect(() => {
    schimbaCtx()
    const c = ctx.current
    setUscari([]); setSelectat(null); setForm(null); setBaza(null); setConflict(null); setPoze([]); setIncarcari([]); setPozePentru(null)
    setMiniaturi({}); setMesaj(null); setIncarcPoza(null); setMeteoAlegere(null); registru.current = null; setNelamurite([]); setCoordPentru(null)
    setPozeProiect({ lista: [], eroare: null }); setAutori({ nume: {}, eroare: null }); setEcranPas(null); setConfirmDetalii(null); setMod(ecranInitial); setMotivVerdict('')
    genSursa.current += 1; genGps.current += 1
    incarca()
    ;(async () => {
      let id = null
      try { id = (await client.auth?.getSession?.())?.data?.session?.user?.id || null } catch { id = null }
      if (c !== ctx.current || proiectCurent.current !== proiectId) return
      setUid(id)
      const reg = registruNou(id ? stocare : null, id ? prefixRegistru(id, proiectId) : null, RPC_USCARE)
      if (reg.utilizabil && reg.toate() !== null) { registru.current = reg; setNelamurite(reg.toate()) }
    })()
    return () => { schimbaCtx() }
  }, [incarca, client, stocare, proiectId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── pozele + încărcările raportului deschis + miniaturile (signed URL, 10 min); totul legat de (context, raport) ──
  // c = contextul capturat de apelant (runda 5: generația + proiectul, nu doar generația)
  const incarcaPoze = useCallback(async (id, c) => {
    setPoze([]); setIncarcari([]); setMiniaturi({}); setPozePentru(null)
    if (typeof id !== 'number') return
    const valabil = () => !!c && c.t === ctx.current && c.proiect === proiectCurent.current
    try {
      const [p, i] = await Promise.all([
        pagini(client, 'executie_uscare_poze', COL_POZA, q => q.eq('uscare_id', id)),
        pagini(client, 'executie_uscare_incarcari', COL_INC, q => q.eq('uscare_id', id)),
      ])
      if (!valabil()) return
      setPoze(p); setIncarcari(i); setPozePentru(id)
      // cardul „în lucru” al acestui raport vede imediat pozele noi (fără reîncărcarea listei)
      setPozeProiect(s => ({ ...s, lista: s.lista.filter(x => x.uscare_id !== id).concat(p) }))
      if (p.length) {
        const s = await client.storage.from(BUCKET).createSignedUrls(p.map(x => x.cale), 600)
        if (!valabil()) return
        setMiniaturi(Object.fromEntries((s.data || []).filter(x => x.signedUrl).map(x => [x.path, x.signedUrl])))
      }
    } catch (e) {
      if (valabil()) setMesaj({ tip: 'eroare', text: 'Pozele nu s-au putut citi: ' + (e?.message || e) + ' (închiderea și PDF-ul așteaptă lista pozelor).' })
    }
  }, [client])

  // ── ciorna locală: pe (utilizator, proiect, raport | „nou”), cu rândul de BAZĂ (ca restaurarea să se poată îmbina) ──
  const cheieCiorna = id => (uid ? `gazpet.uscare.ciorna.v2:${uid}:${proiectId}:${id}` : null)
  const scrieCiorna = (id, b, f) => {
    const k = cheieCiorna(id)
    if (!k || !stocare) return false
    try { stocare.setItem(k, JSON.stringify({ baza: b, form: f, la: new Date().toISOString() })); return stocare.getItem(k) !== null } catch { return false }
  }
  const citesteCiorna = id => { const k = cheieCiorna(id); if (!k || !stocare) return null; try { return JSON.parse(stocare.getItem(k) || 'null') } catch { return null } }
  const stergeCiorna = id => { const k = cheieCiorna(id); if (k && stocare) { try { stocare.removeItem(k) } catch { /* se vede la următoarea scriere */ } } }
  // fiecare schimbare a formularului editabil se scrie în ciornă; un eșec se ARATĂ (nu „rămân în ciornă” dacă n-au rămas)
  const editabilAcum = (selectat === 'nou' || rand?.stare === 'deschisa') && poateScrie
  useEffect(() => {
    if (!form || !editabilAcum || ciornaGasita) return
    const id = selectat === 'nou' ? 'nou' : rand?.id
    if (id == null) return
    const modificat = selectat === 'nou' || areModificari(form, baza)
    if (!modificat) return
    setCiornaEroare(!scrieCiorna(id, baza, form))
  }, [form]) // eslint-disable-line react-hooks/exhaustive-deps

  const formDeschis = form != null
  useEffect(() => { if (typeof onFormular === 'function') onFormular(formDeschis) }, [formDeschis]) // eslint-disable-line react-hooks/exhaustive-deps

  const constructorPropus = () => {
    const ultim = [...uscari].filter(u => u.constructor).sort((a, b) => b.id - a.id)[0]
    return ultim?.constructor || CONSTRUCTOR_IMPLICIT
  }
  // opt.form = formularul propus pentru un raport nou (pașii: detaliile din ultimul raport / „trecere nouă”); opt.mod = ecranul ('pasi' / 'complet')
  const deschide = (u, proba = null, opt = {}) => {
    schimbaCtx(); genSursa.current += 1; genGps.current += 1
    setMesaj(null); setMotiv(null); setRenunt(null); setMeteoAlegere(null); setCiornaGasita(null); setConflict(null); setIncarcPoza(null); setCiornaEroare(false)
    setCoordPentru(null); setEcranPas(null); setConfirmDetalii(null); setMod(opt.mod || ecranInitial); setMotivVerdict('')
    if (u === 'nou') {
      setSelectat('nou'); setBaza(null); setConfirmConstructor(false)
      setForm(opt.form || formularNou({ proba, constructor: constructorPropus() })); incarcaPoze(null, capteaza('nou'))
      const c = citesteCiorna('nou')
      if (c?.form) setCiornaGasita({ ...c, pentru: 'nou' })
      return
    }
    setSelectat(u.id); setBaza(u); setForm(formularDinRand(u)); incarcaPoze(u.id, capteaza(u.id))
    if (u.stare === 'deschisa') {
      const c = citesteCiorna(u.id)
      if (c?.form && areModificari(c.form, c.baza || u)) setCiornaGasita({ ...c, pentru: u.id, vecheVersiune: (c.baza?.versiune ?? u.versiune) !== u.versiune })
    }
  }
  const inchideForm = () => {
    schimbaCtx(); genSursa.current += 1; genGps.current += 1
    setSelectat(null); setForm(null); setBaza(null); setConflict(null); setPoze([]); setIncarcari([]); setPozePentru(null); setMotiv(null); setMesaj(null); setIncarcPoza(null)
    setCoordPentru(null); setMeteoAlegere(null); setEcranPas(null); setConfirmDetalii(null); setMotivVerdict('')
  }
  // orice schimbare a formularului trece pe aici: o schimbare a INSTANTULUI orei începerii (inclusiv alegerea apariției la ora de iarnă) sau a
  // poziției invalidează propunerea meteo (patch-ul din invalidareMeteo) ȘI orice răspuns meteo încă în zbor / lista de alegere (genSursa)
  const schimba = patch => {
    if (form) {
      const s = schimbaSursaMeteo(form, patch)
      if (s.ora || s.poz) { genSursa.current += 1; setMeteoAlegere(null) }
    }
    setForm(f => ({ ...f, ...patch, ...invalidareMeteo(f, patch) }))
  }

  // restaurarea ciornei: pe aceeași versiune = direct; pe versiune veche = îmbinare pe câmpuri (conflictele le alege omul)
  const restaureazaCiorna = () => {
    const c = ciornaGasita
    setCiornaGasita(null)
    if (c.pentru === 'nou' || !c.baza || !rand || c.baza.versiune === rand.versiune) { setForm(c.form); return }
    const m = imbinare(c.baza, c.form, rand)
    setForm(m.form)
    setConflict({ server: rand, conflicte: m.conflicte, alese: {}, deLa: 'ciorna' })
  }

  // ── trimiterea unei apăsări (L04 + L05) ──
  // c = contextul capturat de apelant ÎNAINTEA primului lui await (runda 5, verdict r4 P2-3: înainte trimite recaptura contextul, deci o poză
  // comprimată cât s-a schimbat proiectul intra în registrul proiectului NOU). Context schimbat = nimic emis, nimic în registru.
  async function trimite(rpc, payload, tintaReg, c) {
    if (!ctxValid(c)) return { clasa: 'abandonat', error: { message: 'Ecranul s-a schimbat între timp: cererea nu a fost trimisă.' } }
    const reg = c.reg
    if (!reg) return { clasa: 'blocat', error: { message: 'Stocarea locală a browserului nu e disponibilă (navigare privată / blocată): salvarea e oprită, ca un rezultat nelămurit să nu se piardă.' } }
    const intrare = { tinta: tintaReg, rpc, cheie: uuid(), payload, pusLa: new Date().toISOString() }
    if (!reg.pune(intrare)) return { clasa: 'blocat', error: { message: 'Nu am putut scrie în stocarea locală: salvarea e oprită.' } }
    reimprospateazaNelamurite()
    return lamureste(intrare, c)
  }
  // c = contextul capturat de apelant ÎNAINTEA cererii (registrul și contul cererii nu se recitesc după await)
  async function lamureste(intrare, c) {
    const reg = c.reg
    let r = null, error = null
    try { ({ data: r, error } = await client.rpc(intrare.rpc, { ...intrare.payload, p_cheie: intrare.cheie })) } catch (e) { error = e }
    let clasa = clasificaReluare({ r, error })
    let uscareId = r?.uscare?.id ?? null
    // 42501 nu dovedește nimic (dreptul e verificat înaintea cheii); 23505 = cheia scrisă de alt apel: se caută cheia în jurnal — cheia e a
    // AUTORULUI (runda 4: jurnalul e unic pe (creat_de, cheie)), deci căutarea e pe contul cererii
    if (clasa === 'fara_drept' || error?.code === '23505') {
      const j = c.uid
        ? await client.from('executie_uscare_jurnal').select('id, uscare_id, actiune').eq('cheie', intrare.cheie).eq('creat_de', c.uid).limit(1)
        : { data: null, error: { message: 'contul cererii necunoscut' } }
      const g = Array.isArray(j.data) ? j.data[0] : null
      // o cheie retrasă („Renunț” din alt tab) = neaplicată, definitiv
      clasa = j.error || !Array.isArray(j.data) ? 'necunoscut' : g ? (g.actiune === 'cheie_retrasa' ? 'neaplicat' : 'aplicat') : (error?.code === '23505' ? 'necunoscut' : 'fara_drept')
      if (g && g.actiune !== 'cheie_retrasa') uscareId = g.uscare_id
    }
    if (['aplicat', 'aplicat_acum', 'neaplicat'].includes(clasa)) reg?.scoate(intrare.cheie)
    if (ctxValid(c)) reimprospateazaNelamurite()
    return { clasa, r, error, uscareId, ctx: c }
  }
  // o creare lămurită ca APLICATĂ (retrimitere / întrebarea serverului) cât formularul „nou” e încă deschis: se deschide raportul creat, ca
  // „Creează raportul” să nu mai poată emite o a doua creare (alt UUID = alt raport). Runda 4: doar dacă proiectul și formularul cererii sunt
  // încă cele actuale, verificat după FIECARE await (citirea raportului, reîncărcarea listei)
  async function dupaCreareAplicata(id, mesaj, c) {
    if (!ctxValid(c)) return
    if (c.selectat !== 'nou' || id == null) { await incarca(); return }
    const r = await client.from('executie_uscari').select(COL).eq('id', Number(id)).limit(1)
    if (!ctxValid(c)) return
    await incarca()
    if (!ctxValid(c)) return
    if (!r.error && r.data?.[0] && Number(r.data[0].proiect_id) === Number(c.proiect)) { stergeCiorna('nou'); deschide(r.data[0]); if (mesaj) setMesaj(mesaj) }
    else { inchideForm(); setMesaj({ tip: 'info', text: 'Raportul a fost creat (cererea se aplicase): îl găsești în listă.' }) }
  }
  // după lămurire, lista și pozele raportului CERERII se recitesc doar în contextul ei (altfel o reîncărcare a proiectului vechi ar suprascrie
  // lista proiectului nou)
  async function reimprospateazaDupa(c) {
    if (!ctxValid(c)) return
    await incarca()
    if (!ctxValid(c)) return
    if (typeof c.selectat === 'number') incarcaPoze(c.selectat, c)
  }
  async function retrimiteIdentic(i) {
    if (blocat.current) return
    const c = capteaza()
    if (!c.reg) return
    blocat.current = true; setInCurs(true)
    try {
      const r = await lamureste(i, c)
      if (!ctxValid(c)) return
      setMesaj(mesajRezultat(r, 'Retrimiterea'))
      if (i.tinta === 'nou' && (r.clasa === 'aplicat' || r.clasa === 'aplicat_acum')) await dupaCreareAplicata(r.uscareId, mesajRezultat(r, 'Retrimiterea'), c)
      else await reimprospateazaDupa(c)
    } finally { blocat.current = false; setInCurs(false) }
  }
  // „Renunț” (L05, runda 3): întâi serverul spune, după cheie, dacă cererea s-a aplicat; doar un răspuns SIGUR scoate cheia din registru:
  // aplicată -> reușită; neaplicată -> retrasă definitiv pe server (cererea pierdută, dacă ajunge mai târziu, e refuzată). Altfel cheia rămâne.
  // Runda 4: proiectul cererii și registrul ei se capturează înainte; ecranul se schimbă doar dacă contextul e încă același.
  // Runda 5: se trimite INTENȚIA din registru (RPC-ul + parametrii exacți ai cererii, fără cheie): serverul derivă din ea proiectul și amprenta,
  // deci retragerea e legată de cererea reală, nu de un proiect declarat. Fără cotă: „Renunț” rămâne mereu posibil.
  async function retrageCererea(i) {
    if (blocat.current) return
    if (!window.confirm('Renunți la această cerere? Întâi întreb serverul: dacă s-a aplicat, o păstrez ca reușită; dacă nu, o retrag definitiv (nu se mai aplică nici dacă ajunge mai târziu).')) return
    const c = capteaza()
    if (!c.reg) return
    blocat.current = true; setInCurs(true)
    try {
      let r = null, error = null
      try { ({ data: r, error } = await client.rpc(RPC_RETRAGE, { p_rpc: i.rpc, p_args: i.payload, p_cheie: i.cheie })) } catch (e) { error = e }
      if (!error && r?.ok === true && (r.aplicat === true || r.retrasa === true)) {
        c.reg.scoate(i.cheie)
        if (!ctxValid(c)) return
        reimprospateazaNelamurite()
        const m = r.aplicat ? { tip: 'ok', text: 'Cererea se aplicase deja pe server: nu s-a pierdut nimic și nu se repetă.' }
                            : { tip: 'ok', text: 'Cererea nu ajunsese pe server: am retras-o definitiv (nu se mai aplică nici dacă ajunge mai târziu).' }
        setMesaj(m)
        if (r.aplicat && i.tinta === 'nou') await dupaCreareAplicata(r.uscare_id, m, c)
        else await reimprospateazaDupa(c)
      } else {
        if (!ctxValid(c)) return
        setMesaj({ tip: 'eroare', text: `Serverul nu a putut confirma (${error?.message || 'răspuns necunoscut'}): cererea rămâne de lămurit. Încearcă din nou când ai semnal.` })
      }
    } finally { blocat.current = false; setInCurs(false) }
  }
  const mesajRezultat = ({ clasa, r, error }, ce) => {
    if (clasa === 'aplicat_acum' || clasa === 'aplicat') return { tip: 'ok', text: `${ce}: gata${clasa === 'aplicat' ? ' (se salvase deja)' : ''}.` }
    if (clasa === 'neaplicat' && r?.motiv === 'conflict') return { tip: 'eroare', text: `${ce}: raportul s-a schimbat între timp (alt telefon / alt coleg). NU am salvat peste el: verifică mai jos câmpurile și alege.` }
    if (clasa === 'necunoscut') return { tip: 'eroare', text: `${ce}: rezultat necunoscut (rețea). Cererea a rămas în lista „de lămurit” de sus: retrimite-o identic când ai semnal.` }
    return { tip: 'eroare', text: `${ce}: ${error?.message || 'refuzat'}` }
  }

  // opt.form = formularul de trimis (pașii: cu ora „acum” / data / timpul de deplasare / concluzia puse la apăsare; se pune și pe ecran);
  // opt.ce = eticheta mesajului; opt.faraConstructor = creare din pașii ecranului (constructorul se confirmă la rezumat, înainte de raport).
  // Întoarce rândul salvat (sau null): pașii trec la ecranul următor DOAR pe un rezultat dovedit, în contextul cererii.
  async function salveaza(opt = {}) {
    const f = opt.form || form
    if (blocat.current || !f) return null
    if (conflict) { setMesaj({ tip: 'eroare', text: 'Rezolvă întâi conflictul de mai sus (alege pentru fiecare câmp).' }); return null }
    if (nelamuriteTinta.length) { setMesaj({ tip: 'eroare', text: 'Ai o salvare nelămurită pe acest raport: retrimite-o identic sau verifică lista înainte de una nouă.' }); return null }
    const nou = selectat === 'nou'
    if (nou && !confirmConstructor && !opt.faraConstructor) { setMesaj({ tip: 'eroare', text: 'Confirmă constructorul (secțiunea 2) înainte de creare.' }); return null }
    const { date, erori } = payloadDinFormular(f)
    if (erori.length) { setMesaj({ tip: 'eroare', text: 'De corectat: ' + erori.join(' · ') }); return null }
    blocat.current = true; setInCurs(true); setMesaj(null)
    if (opt.form) setForm(opt.form)
    // runda 5: ce se trimite e formularul de ACUM; un GPS / o propunere meteo încă în zbor nu mai aterizează peste formularul înlocuit de
    // răspunsul salvării (s-ar pierde fără urmă) — se reiau după salvare
    genGps.current += 1; genSursa.current += 1; setMeteoAlegere(null)
    const c = capteaza()
    try {
      const payload = { p_proiect: c.proiect, p_id: nou ? null : rand.id, p_versiune: nou ? null : baza.versiune, p_date: date }
      const rez = await trimite('fn_executie_uscare_salveaza', payload, nou ? 'nou' : `u${rand.id}`, c)
      if (!ctxValid(c)) return null
      setMesaj(mesajRezultat(rez, opt.ce || (nou ? 'Crearea' : 'Salvarea')))
      const u = rez.r?.uscare
      if (u && rez.r.ok) {
        stergeCiorna(nou ? 'nou' : u.id)
        setUscari(l => [...l.filter(x => x.id !== u.id), u])
        if (nou) { schimbaCtx(); setSelectat(u.id); incarcaPoze(u.id, capteaza(u.id)) }
        setBaza(u); setForm(formularDinRand(u))
        return u
      } else if (u && rez.r?.motiv === 'conflict') {
        // NU se salvează peste coleg: formularul rămâne pe versiunea de bază, cu îmbinarea pe câmpuri de rezolvat explicit
        setUscari(l => l.map(x => (x.id === u.id ? u : x)))
        const m = imbinare(baza, f, u)
        setForm(m.form); setConflict({ server: u, conflicte: m.conflicte, alese: {}, deLa: 'salvare' })
      } else if (rez.clasa === 'aplicat' && nou) await dupaCreareAplicata(rez.uscareId, mesajRezultat(rez, 'Crearea'), rez.ctx)
      return null
    } finally { blocat.current = false; setInCurs(false) }
  }
  const confirmaConflict = () => {
    let f = form
    for (const c of conflict.conflicte) f = aleg(f, c, conflict.alese[c.camp], conflict.server)
    setForm(f); setBaza(conflict.server); setConflict(null)
    setMesaj({ tip: 'info', text: 'Am pus pe formular versiunea colegului cu alegerile tale. Verifică și salvează.' })
  }
  // întoarce rândul după tranziție (sau null), doar în contextul cererii
  async function schimbaStare(actiune, textMotiv = null) {
    if (blocat.current || !rand) return null
    blocat.current = true; setInCurs(true); setMesaj(null)
    genGps.current += 1; genSursa.current += 1; setMeteoAlegere(null)
    const c = capteaza()
    try {
      const rez = await trimite('fn_executie_uscare_stare', { p_id: rand.id, p_versiune: rand.versiune, p_actiune: actiune, p_motiv: textMotiv }, `u${rand.id}`, c)
      if (!ctxValid(c)) return null
      setMesaj(mesajRezultat(rez, { inchide: 'Închiderea', redeschide: 'Redeschiderea', anuleaza: 'Anularea' }[actiune]))
      if (rez.r?.uscare && rez.r.ok) { const u = rez.r.uscare; setUscari(l => l.map(x => (x.id === u.id ? u : x))); setBaza(u); setForm(formularDinRand(u)); setMotiv(null); return u }
      await incarca()
      return null
    } finally { blocat.current = false; setInCurs(false) }
  }

  // ── pașii (ecranul de telefon): fiecare buton mare trimite formularul complet al etapei, prin salvarea existentă (CAS, cheie, ciornă) ──
  // L24: contextul se capturează ÎNAINTEA cererii; ecranul următor (confirmarea etapei 1) apare doar dacă raportul e încă cel deschis.
  // L05: dublul click e oprit de `blocat` (sincron, înaintea primului await din salveaza) — o singură salvare.
  async function incepeUscarea() {
    if (selectat !== 'nou') return
    await salveaza({ ce: 'Începerea uscării', faraConstructor: true })
  }
  async function inregistreazaEtapa1() {
    if (!rand || !form || blocat.current) return
    const c = capteaza()
    const u = await salveaza({ form: formularInregistreazaEtapa1(form, acum()), ce: 'Înregistrarea etapei 1' })
    if (u && ctxValid(c) && c.selectat === u.id) setEcranPas('confirmare1')
  }
  async function terminaEtapa2() {
    if (!rand || !form || blocat.current) return
    const c = capteaza()
    const u = await salveaza({ form: formularTerminaEtapa2(form, acum(), motivVerdict), ce: 'Etapa 2' })
    if (u && ctxValid(c) && c.selectat === u.id) setMotivVerdict('')   // motivul e acum în observațiile salvate
  }
  // „Generează raportul” = închiderea (aceeași regulă ca azi: lipsaDinRand = fn_executie_uscare_lipsa) + PDF-ul raportului închis
  async function genereazaRaport() {
    if (!rand || blocat.current) return
    if (!window.confirm(`Generezi raportul cu concluzia ${String(rand.concluzie).toUpperCase()}? Raportul se închide (după aceea se poate corecta doar prin redeschidere consemnată, de un administrator), apoi se descarcă PDF-ul.`)) return
    const c = capteaza()
    const u = await schimbaStare('inchide')
    if (!u || u.stare !== 'inchisa' || !ctxValid(c) || c.selectat !== u.id) return
    await pdf(u)
  }
  const pornesteUscare = proba => deschide('nou', proba, { form: formularPasNou({ proba, uscari, constructor: constructorPropus(), acum: acum() }) })
  const trecereNoua = u => deschide('nou', null, { form: formularTrecereNoua(u, uscari, acum()) })

  // ── pozele: rezervarea căii (server) -> fișierul (fără suprascriere) -> înregistrarea. Rezervarea neînregistrată rămâne în server. ──
  // Runda 5 (verdict r4 P2-3): contextul (proiectul, raportul, registrul) se capturează ÎNAINTEA comprimării, se verifică după ea și se
  // transmite mai departe; calea și cererea se construiesc din contextul capturat. Proiect / raport schimbat în timpul comprimării = nimic emis.
  async function urcaPoza(categorie, file, burete = null) {
    if (!rand || blocat.current) return
    blocat.current = true; setInCurs(true); setMesaj(null)
    const id = rand.id, c = capteaza()
    try {
      const blob = await comprima(file)
      if (!ctxValid(c) || c.selectat !== id) return
      const cale = `${c.proiect}/${id}/${uuid()}.jpg`
      const rz = await trimite('fn_executie_uscare_poza', { p_uscare: id, p_actiune: 'rezerva', p_poza: null, p_cale: cale, p_categorie: categorie,
        p_burete_nr: burete ? Number(burete) : null, p_legenda: null }, `u${id}`, c)
      if (!ctxValid(c)) return
      if (rz.clasa !== 'aplicat' && rz.clasa !== 'aplicat_acum') { setMesaj(mesajRezultat(rz, 'Rezervarea pozei')); return }
      await urcaSiInregistreaza({ uscare: id, cale, categorie, burete, blob }, c)
    } catch (e) {
      if (ctxValid(c)) setMesaj({ tip: 'eroare', text: (e?.message || 'Încărcarea a eșuat') })
    } finally { blocat.current = false; setInCurs(false) }
  }
  // după un refresh, o rezervare fără fișier primește fișierul ales din ecran (aceeași cale rezervată: fără rezervare nouă, fără dublură)
  async function fisierPentruRezervare(i, file) {
    if (!rand || blocat.current || i.uscare_id !== rand.id) return
    blocat.current = true; setInCurs(true); setMesaj(null)
    const id = rand.id, c = capteaza()
    try {
      const blob = await comprima(file)
      if (!ctxValid(c) || c.selectat !== id) return
      await urcaSiInregistreaza({ uscare: id, cale: i.cale, categorie: i.categorie, burete: i.burete_nr, blob }, c)
    } catch (e) {
      if (ctxValid(c)) setMesaj({ tip: 'eroare', text: (e?.message || 'Încărcarea a eșuat') })
    } finally { blocat.current = false; setInCurs(false) }
  }
  async function urcaSiInregistreaza(item, c) {
    if (!ctxValid(c)) return
    setIncarcPoza(item)
    const up = await client.storage.from(BUCKET).upload(item.cale, item.blob, { contentType: 'image/jpeg', upsert: false })
    if (!ctxValid(c)) return
    if (up.error) {
      // un răspuns pierdut poate lăsa fișierul deja încărcat: verificăm citindu-l
      const ex = await client.storage.from(BUCKET).download(item.cale)
      if (!ctxValid(c)) return
      if (ex.error) { setMesaj({ tip: 'eroare', text: 'Fișierul nu s-a încărcat: ' + up.error.message + ' — apasă „Reîncearcă fișierul” (rezervarea rămâne în lista de lămurit).' }); incarcaPoze(item.uscare, c); return }
    }
    await inregistreaza(item.cale, item.uscare, c)
  }
  // runda 5: raportul e cel al cererii (parametru), nu `rand` citit după un await
  async function inregistreaza(cale, id, c) {
    const rez = await trimite('fn_executie_uscare_poza', { p_uscare: id, p_actiune: 'adauga', p_poza: null, p_cale: cale, p_categorie: null, p_burete_nr: null, p_legenda: null }, `u${id}`, c)
    if (!ctxValid(c)) return
    if (rez.clasa === 'aplicat' || rez.clasa === 'aplicat_acum') { setIncarcPoza(p => (p?.cale === cale ? null : p)); setMesaj({ tip: 'ok', text: 'Poza a fost adăugată.' }) }
    else setMesaj(mesajRezultat(rez, 'Înregistrarea pozei'))
    incarcaPoze(id, c)
  }
  // runda 5: și eroarea neprevăzută se arată doar în contextul acțiunii (înainte: mesajul ajungea pe alt raport / proiect)
  async function actiunePoza(fn) {
    if (!rand || blocat.current) return
    blocat.current = true; setInCurs(true); setMesaj(null)
    const c = capteaza()
    try { await fn(c, rand.id) } catch (e) { if (ctxValid(c)) setMesaj({ tip: 'eroare', text: e?.message || String(e) }) } finally { blocat.current = false; setInCurs(false) }
  }
  const scoatePoza = p => actiunePoza(async (c, id) => {
    const rez = await trimite('fn_executie_uscare_poza', { p_uscare: id, p_actiune: 'scoate', p_poza: p.id, p_cale: null, p_categorie: null, p_burete_nr: null, p_legenda: null }, `u${id}`, c)
    if (!ctxValid(c)) return
    setMesaj(mesajRezultat(rez, 'Scoaterea pozei')); incarcaPoze(id, c)
  })
  const renuntaIncarcare = (cale, text) => actiunePoza(async (c, id) => {
    const rez = await trimite('fn_executie_uscare_poza', { p_uscare: id, p_actiune: 'renunta', p_poza: null, p_cale: cale, p_categorie: null, p_burete_nr: null, p_legenda: text }, `u${id}`, c)
    if (!ctxValid(c)) return
    setMesaj(mesajRezultat(rez, 'Renunțarea')); setRenunt(null); setIncarcPoza(p => (p?.cale === cale ? null : p)); incarcaPoze(id, c)
  })

  // ── meteo: vremea curentă a șantierelor proiectului, PENTRU ORA ÎNCEPERII (observația la ≤ 3 h); instantaneul îl face serverul ──
  // L24: răspunsul se aplică doar dacă raportul (ctx) ȘI sursa (genSursa: instantul orei începerii, poziția) sunt aceleași ca la cerere.
  // L23: toate șantierele proiectului (keyset, fără plafon tăcut), vremea lor pe bucăți de câte 100 de id-uri.
  async function propuneMeteo() {
    setMesaj(null); setMeteoAlegere(null)
    const c = capteaza(), gs = genSursa.current
    const valabil = () => ctxCitire(c) && gs === genSursa.current
    const ora = payloadDinFormular(form).date.ora_inceput
    if (!ora) { setMesaj({ tip: 'info', text: 'Completează întâi ora începerii: vremea se propune pentru ea (nu vremea de acum pentru o operațiune trecută).' }); return }
    let s = null
    try { s = await pagini(client, 'sites', 'id, name, proiect_id', q => q.eq('proiect_id', c.proiect)) } catch (e) {
      if (valabil()) setMesaj({ tip: 'eroare', text: 'Șantierele proiectului nu s-au putut citi: ' + (e?.message || e) })
      return
    }
    if (!valabil()) return
    s = s.filter(x => x.proiect_id === c.proiect)
    if (!s.length) { setMesaj({ tip: 'info', text: 'Proiectul nu are un șantier cu vreme: scrie temperatura citită pe termometru.' }); return }
    const vreme = []
    for (let i = 0; i < s.length; i += 100) {
      const m = await client.from('meteo_cache').select('site_id, curent, actualizat_la, sursa').in('site_id', s.slice(i, i + 100).map(x => x.id))
      if (!valabil()) return
      if (m.error) { setMesaj({ tip: 'eroare', text: 'Vremea nu s-a putut citi: ' + m.error.message }); return }
      vreme.push(...(m.data || []))
    }
    const toate = vreme.map(r => ({ ...propunereMeteo(r, ora), site_id: r.site_id, site: s.find(x => x.id === r.site_id)?.name, furnizor: r.sursa }))
    const opt = toate.filter(x => x.ok)
    if (!opt.length) { setMesaj({ tip: 'info', text: 'Nicio propunere: ' + (toate.map(x => `${x.site}: ${x.motiv}`).join(' · ') || 'șantierele nu au vreme') + '.' }); return }
    if (opt.length === 1) aplicaMeteo(opt[0], gs, c); else setMeteoAlegere({ gen: gs, ctx: c, opt })
  }
  // runda 5: alegerea din listă verifică și contextul cererii (raportul / proiectul), nu doar sursa
  const aplicaMeteo = (o, gs, c) => {
    setMeteoAlegere(null)
    if (!ctxCitire(c)) return
    if (gs !== genSursa.current) { setMesaj({ tip: 'info', text: 'Ora începerii sau poziția s-au schimbat între timp: propune din nou vremea.' }); return }
    schimba({ temperatura_c: o.temperatura_c, vreme: o.vreme, temperatura_sursa: 'meteo',
      meteo_cerere: { site_id: o.site_id, site: o.site, temperatura_c: o.temperatura_c, ora_observatiei: o.ora_observatiei, preluat_la: o.preluat_la, furnizor: o.furnizor } })
  }

  // ── poziția: GPS DOAR la apăsarea omului (o singură citire, fără urmărire) ──
  function captureazaGps() {
    const geo = globalThis.navigator?.geolocation
    if (!geo) { setMesaj({ tip: 'eroare', text: 'Telefonul / browserul nu dă poziția: scrie coordonatele de mână.' }); return }
    // doar ULTIMA captură cerută se aplică (două capturi pot răspunde în ordine inversă); o editare manuală a poziției le anulează pe toate
    const c = capteaza(), g = ++genGps.current
    const curenta = () => ctxCitire(c) && g === genGps.current
    setMesaj({ tip: 'info', text: 'Se citește poziția GPS…' })
    geo.getCurrentPosition(pos => {
      if (!curenta()) return
      const p = pozitieDinGps(pos)
      if (!p) { setMesaj({ tip: 'eroare', text: 'Poziția primită e incompletă: reîncearcă sau scrie coordonatele.' }); return }
      genSursa.current += 1; setMeteoAlegere(null)
      setForm(f => ({ ...f, ...p, ...invalidareMeteo(f, p) }))
      setMesaj({ tip: 'ok', text: `Poziția GPS citită (precizie ±${p.poz_precizie_m} m). Verifică și salvează.` })
    }, err => { if (curenta()) setMesaj({ tip: 'eroare', text: 'Poziția nu s-a putut citi: ' + (err?.message || 'refuzat') + '. Poți scrie coordonatele de mână.' }) },
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 })
  }

  // u = raportul de exportat (implicit cel deschis; după „Generează raportul”, rândul închis întors de server)
  // Runda 2 (proba pe telefon: 5–15 s): cât se generează, butoanele PDF arată „Se generează raportul…” și sunt blocate (L05: `blocat` sincron,
  // deci a doua apăsare nu pornește un al doilea export), și pe raportul închis.
  async function pdf(u = rand) {
    if (!u || blocat.current || pozePentru !== u.id) return
    blocat.current = true; setInCurs(true); setPdfInCurs(true)
    setMesaj({ tip: 'info', text: 'Se generează raportul PDF (pozele se citesc și se așază în pagini: poate dura 5–15 secunde). Nu apăsa din nou.' })
    const c = capteaza()
    const oprire = typeof AbortController === 'function' ? new AbortController() : null
    pdfOprire.current = oprire
    try {
      const { exportRaportUscarePDF } = await import('./uscarePdf.js')
      if (!ctxCitire(c)) return                       // runda 5: raportul nu mai e deschis -> fără PDF pentru el
      // runda 6 (verdict r5 P2): verificarea contextului merge ÎN exportator (după fiecare citire / captură și chiar înainte de descărcare),
      // nu doar aici, după descărcare; schimbarea contextului anulează și semnalul (citirile pozelor în zbor se opresc)
      const r = await exportRaportUscarePDF({ client, uscare: u, poze, cuCoordonate: coordPentru === u.id, eValabil: () => ctxCitire(c), semnal: oprire?.signal || null })
      if (r?.anulat || !ctxCitire(c)) return
      const { necitite } = r
      setCoordPentru(null)          // consimțământul ține pentru UN export al acestui raport
      setMesaj(necitite ? { tip: 'eroare', text: `PDF generat, dar ${necitite} fotografii n-au putut fi citite (apar cu mențiune în anexă). Reîncearcă cu semnal bun.` }
                        : { tip: 'ok', text: 'PDF generat.' + (u === rand && areModificari(form, u) ? ' Atenție: arată ultima versiune SALVATĂ, nu modificările de pe ecran.' : '') })
    } catch (e) { if (ctxCitire(c)) setMesaj({ tip: 'eroare', text: 'PDF-ul nu s-a putut genera: ' + (e?.message || e) }) }
    finally { if (pdfOprire.current === oprire) pdfOprire.current = null; blocat.current = false; setInCurs(false); setPdfInCurs(false) }
  }

  // ── afișarea ──
  if (neactivat) return <div style={{ ...ST.card, margin: 16 }}>Rapoartele de uscare nu sunt încă activate pe server (migrarea bazei de date nu e aplicată). Până atunci se folosește modelul pe hârtie.</div>
  const banner = mesaj && <div role={mesaj.tip === 'eroare' ? 'alert' : 'status'} style={{ ...ST.card, borderColor: mesaj.tip === 'eroare' ? G.red : mesaj.tip === 'ok' ? G.green : G.blue, color: G.text }}>{mesaj.text}</div>
  const bannerNelamurite = nelamurite.length > 0 && (
    <div style={{ ...ST.card, borderColor: G.yellow }}>
      <div style={ST.h}>⚠ {nelamurite.length} {nelamurite.length === 1 ? 'cerere nelămurită' : 'cereri nelămurite'} (rețea)</div>
      {nelamurite.map(i => (
        <div key={i.cheie} style={{ ...ST.rand, marginBottom: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: G.muted, flex: 1 }}>{i.tinta === 'nou' ? 'creare raport' : i.rpc.replace('fn_executie_uscare_', '')} · {fmtMoment(i.pusLa)}</span>
          <button style={ST.btn} disabled={inCurs} onClick={() => retrimiteIdentic(i)}>Retrimite identic</button>
          <button style={ST.btn} disabled={inCurs} onClick={() => retrageCererea(i)}>Renunț</button>
        </div>
      ))}
    </div>
  )

  if (!form) {
    const pasi = ecranInitial === 'pasi'                // lista urmează ecranul implicit (nu ultimul raport deschis pe formularul complet)
    // cine a salvat ultima dată raportul (etapa 2 o poate face alt coleg decât cel care a făcut etapa 1): „tu” / numele / „numele nu s-a putut citi”
    const textAutor = u => (!u.modificat_de ? null : u.modificat_de === uid ? 'de tine' : autori.nume[u.modificat_de] ? `de ${autori.nume[u.modificat_de]}`
      : autori.eroare ? 'de un coleg (numele nu s-a putut citi)' : 'de un coleg')
    const vizibile = [...uscari].filter(u => arataAnulate || u.stare !== 'anulata').sort((a, b) => String(b.data_operatie || b.creat_la).localeCompare(String(a.data_operatie || a.creat_la)) || b.id - a.id)
    const creareNelamurita = nelamurite.some(i => i.tinta === 'nou')
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '8px 12px 40px' }}>
        <div style={{ ...ST.rand, justifyContent: 'space-between', margin: '8px 0' }}>
          <h2 style={{ fontSize: 18, margin: 0, color: G.text }}>💨 Uscare conductă</h2>
          <button style={ST.btn} onClick={() => incarca()} disabled={incarc}>↻</button>
        </div>
        {banner}{bannerNelamurite}
        {eroare && <div role="alert" style={{ ...ST.card, borderColor: G.red }}>{eroare}</div>}
        {pasi && (() => {
          // pașii: sus rapoartele ÎN LUCRU (reluarea la o atingere), apoi „Uscare nouă”; jos doar cele generate / anulate
          const inLucru = vizibile.filter(u => u.stare === 'deschisa')
          return <>
            {inLucru.map(u => (
              <CardInLucru key={u.id} u={u} ST={ST} eroarePoze={pozeProiect.eroare} autor={textAutor(u)}
                pas={pozeProiect.eroare ? null : pasCurent(u, pozeProiect.lista.filter(p => p.uscare_id === u.id))} onDeschide={() => deschide(u)} />
            ))}
            {poateScrie && (creareNelamurita
              ? <div style={{ ...ST.card, color: G.yellow, fontSize: 14 }}>Ai o creare de raport nelămurită (sus): retrimite-o identic sau verifică lista înainte să pornești alta.</div>
              : <button style={{ ...ST.mare, minHeight: 64, fontSize: 18, background: '#238636', color: '#fff', margin: '12px 0' }} onClick={() => pornesteUscare(null)}>＋ Uscare nouă</button>)}
          </>
        })()}
        {!pasi && poateScrie && (
          <div style={ST.card}>
            <div style={ST.h}>Uscare nouă</div>
            {creareNelamurita ? <div style={{ color: G.yellow, fontSize: 14 }}>Ai o creare de raport nelămurită (sus): retrimite-o identic sau verifică lista înainte să pornești alta.</div> : (
              <div style={{ display: 'grid', gap: 8 }}>
                {probeEroare && <div role="alert" style={{ color: G.red, fontSize: 13 }}>{probeEroare}</div>}
                {probe.map(p => <button key={p.id} style={ST.mare} onClick={() => deschide('nou', p)}>{p.cod}{p.denumire ? ` — ${p.denumire}` : ''} · km {fmtKm(p.km_de_la_m)} → {fmtKm(p.km_pana_la_m)}</button>)}
                <button style={{ ...ST.mare, background: 'transparent' }} onClick={() => deschide('nou')}>Alt interval / tot traseul</button>
              </div>
            )}
          </div>
        )}
        {pasi && vizibile.some(u => u.stare !== 'deschisa') && <div style={{ ...ST.h, marginTop: 16 }}>Rapoarte generate</div>}
        {incarc && !uscari.length ? <p style={{ color: G.muted }}>Se încarcă…</p> : vizibile.length === 0 ? <p style={{ color: G.muted }}>Nicio operațiune de uscare pe acest proiect.</p> : vizibile.filter(u => !pasi || u.stare !== 'deschisa').map(u => {
          const v = verificare24h(u.notificare_la, u.ora_inceput, u.inceput_planificat)
          return (
            <button key={u.id} onClick={() => deschide(u)} style={{ ...ST.card, display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer', color: G.text, fontFamily: 'inherit' }}>
              <div style={{ ...ST.rand, justifyContent: 'space-between' }}>
                <b style={{ fontSize: 16 }}>{u.tronson}</b>
                <span style={{ fontSize: 12, fontWeight: 700, color: CULORI_STARE[u.stare] }}>{ETICHETE_STARE[u.stare]}{u.revizie ? ` · rev. ${u.revizie}` : ''}</span>
              </div>
              <div style={{ fontSize: 13, color: G.muted, marginTop: 4 }}>
                {u.data_operatie ? fmtZi(u.data_operatie) : 'fără dată'} · km {fmtKm(u.km_de_la_m)} → {fmtKm(u.km_pana_la_m)}
                {u.concluzie && u.stare !== 'anulata' && <> · <b style={{ color: u.concluzie === 'conform' ? G.green : G.red }}>{u.concluzie.toUpperCase()}</b></>}
              </div>
              {v.stare === 'sub_24h' && <div style={{ fontSize: 12, color: G.yellow, marginTop: 4 }}>⚠ Notificarea beneficiarului: {fmtNr(v.ore)} h înainte (cerut minimum 24 h)</div>}
              {v.stare === 'necunoscut' && u.stare === 'deschisa' && <div style={{ fontSize: 12, color: G.muted, marginTop: 4 }}>Notificarea beneficiarului nu e consemnată</div>}
            </button>
          )
        })}
        {uscari.some(u => u.stare === 'anulata') && <button style={ST.btn} onClick={() => setArataAnulate(x => !x)}>{arataAnulate ? 'Ascunde anulatele' : 'Arată și anulatele'}</button>}
        {pasi && poateScrie && !creareNelamurita && (
          <div style={{ marginTop: 16 }}>
            <button style={{ ...ST.btn, background: 'transparent' }} onClick={() => deschide('nou', null, { mod: 'complet' })}>Raport nou pe formularul complet (birou)</button>
          </div>
        )}
      </div>
    )
  }

  // ── formularul ──
  const deschis = selectat === 'nou' || rand?.stare === 'deschisa'
  const editabil = deschis && poateScrie && !ciornaGasita
  const { date: val } = payloadDinFormular(form)
  const v24 = verificare24h(val.notificare_la, val.ora_inceput, val.inceput_planificat)
  const durata = durataOre(val.ora_inceput, val.ora_final)
  const viteza = vitezaMedie(val.lungime_m, val.timp_deplasare_min)
  const modificat = selectat === 'nou' || areModificari(form, baza)
  const pozeGata = rand && pozePentru === rand.id
  const deschise = pozeGata ? incarcariDeschise(incarcari, poze) : []
  const lipsa = rand && pozeGata ? lipsaDinRand(rand, poze, deschise.length) : []
  const pozeL = rand && pozeGata ? pozeLipsa(rand, poze) : []
  const kmDif = Number.isFinite(val.km_de_la_m) && Number.isFinite(val.km_pana_la_m) && val.lungime_m != null && Math.abs(val.km_pana_la_m - val.km_de_la_m - val.lungime_m) > 0.05
  const distMeteo = distantaMeteo(form)
  const inp = (k, extra = {}) => <input style={ST.in} value={form[k] ?? ''} disabled={!editabil} onChange={e => schimba({ [k]: e.target.value })} {...extra} />
  const nrInp = (k, extra = {}) => inp(k, { inputMode: 'decimal', ...extra })
  // valorile care pot fi NEGATIVE (iarna): tastatura „decimal” a iPhone-ului nu are semnul minus -> tastatura de text (are „123” cu „-” și „,”)
  const nrCuSemn = (k, extra = {}) => inp(k, { inputMode: 'text', autoComplete: 'off', autoCorrect: 'off', spellCheck: false, ...extra })
  // ora locală: la ora care apare de două ori (trecerea la ora de iarnă) se alege explicit prima sau a doua apariție
  const oraInp = k => {
    const c = form[k] ? momenteLocale(form[k]) : null
    return (
      <>
        {inp(k, { type: 'datetime-local' })}
        {c && c.length === 2 && (
          <select style={{ ...ST.in, marginTop: 6, borderColor: form.dst?.[k] ? G.border : G.yellow }} disabled={!editabil} value={form.dst?.[k] || ''}
            aria-label={`Apariția orei (${k})`} onChange={e => schimba({ dst: { ...(form.dst || {}), [k]: e.target.value } })}>
            <option value="">— ora apare de două ori (schimbarea orei): alege —</option>
            <option value="vara">prima apariție (încă ora de vară)</option>
            <option value="iarna">a doua apariție (după trecerea la ora de iarnă)</option>
          </select>
        )}
      </>
    )
  }
  const sect = (titlu, continut) => <div style={ST.card}><div style={ST.h}>{titlu}</div>{continut}</div>
  const pozeCat = cat => poze.filter(p => p.categorie === cat)
  // eticheta = textul butonului de cameră pe pași (ex. „Poza cântarului, cu kilogramele vizibile”)
  const blocPoze = (cat, burete = null, eticheta = null) => {
    const lista = pozeCat(cat).filter(p => burete == null || p.burete_nr === burete)
    return (
      <div style={{ marginTop: 8 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {lista.map(p => (
            <div key={p.id} style={{ position: 'relative' }}>
              {miniaturi[p.cale] ? <a href={miniaturi[p.cale]} target="_blank" rel="noreferrer"><img alt={ETICHETE_CATEGORII[cat]} src={miniaturi[p.cale]} style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, border: `1px solid ${G.border}` }} /></a>
                : <div style={{ width: 72, height: 72, borderRadius: 8, border: `1px dashed ${G.border}`, fontSize: 11, color: G.muted, display: 'grid', placeItems: 'center' }}>poză</div>}
              {editabil && rand && <button aria-label="Scoate poza" disabled={inCurs} onClick={() => { if (window.confirm('Scoți poza din raport? (fișierul rămâne păstrat)')) scoatePoza(p) }} style={{ position: 'absolute', top: -10, right: -10, borderRadius: 999, border: `2px solid ${G.bg}`, background: G.red, color: '#fff', width: TINTA_ATINGERE, height: TINTA_ATINGERE, fontSize: 22, lineHeight: 1, cursor: 'pointer', padding: 0 }}>×</button>}
            </div>
          ))}
        </div>
        {editabil && rand && pozeGata && (
          <label style={{ ...ST.btn, display: 'inline-flex', marginTop: 6, alignItems: 'center', gap: 6, opacity: inCurs ? 0.5 : 1 }}>
            📷 {eticheta ? (lista.length ? `Încă o poză · ${eticheta}` : eticheta) : <>{lista.length ? 'Încă o poză' : 'Fotografiază'}{burete ? ` (buretele ${burete}, ${cat === 'cantar_intrare' ? 'intrare' : 'ieșire'})` : ''}</>}
            <input type="file" accept="image/*" capture="environment" disabled={inCurs} style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) urcaPoza(cat, f, burete) }} />
          </label>
        )}
      </div>
    )
  }
  // Utilajele (ambele ecrane). Runda 2 (proba pe telefon): după o salvare fără utilaje, serverul întoarce lista goală și rândul gol dispărea
  // fără urmă → cât raportul e editabil se arată mereu cel puțin un rând (gol); rândul gol nu se trimite (payloadDinFormular îl sare).
  const UTILAJ_GOL = { denumire: '', buc: '1' }
  const blocUtilaje = () => {
    const lista = form.utilaje.length || !editabil ? form.utilaje : [UTILAJ_GOL]
    const pune = (i, patch) => schimba({ utilaje: lista.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
    return <>
      {lista.map((u, i) => (
        <div key={i} style={ST.rand}>
          <Camp eticheta={`Denumire ${i + 1}`}><input style={ST.in} disabled={!editabil} value={u.denumire} onChange={e => pune(i, { denumire: e.target.value })} /></Camp>
          <div style={{ width: 80 }}><Camp eticheta="Buc."><input style={ST.in} inputMode="numeric" disabled={!editabil} value={u.buc} onChange={e => pune(i, { buc: e.target.value })} /></Camp></div>
          {editabil && <button style={{ ...ST.btn, minWidth: TINTA_ATINGERE }} aria-label="Scoate utilajul" onClick={() => schimba({ utilaje: lista.filter((_, j) => j !== i) })}>×</button>}
        </div>
      ))}
      {editabil && lista.length < 20 && <button style={{ ...ST.btn, marginTop: 8 }} onClick={() => schimba({ utilaje: [...lista, UTILAJ_GOL] })}>+ Utilaj</button>}
    </>
  }
  const setBureti = text => {
    const n = parseNumar(text)
    schimba({ bureti_buc: text, cantariri: Number.isInteger(n) && n >= 0 && n <= MAX_BURETI ? cantaririPentru(n, form.cantariri) : form.cantariri })
  }
  const cant = (i, patch) => schimba({ cantariri: form.cantariri.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
  const etichetaCamp = k => ({ temperatura_c: 'temperatura', vreme: 'vremea', ora_inceput: 'ora începerii', ora_final: 'ora finalizării', observatii: 'observațiile', concluzie: 'concluzia',
    piston_final_rezultat: 'ultimul piston', presiune_bar: 'presiunea', timp_deplasare_min: 'timpul de deplasare', cantariri: 'cântăririle', utilaje: 'utilajele' }[k] || k.replace(/_/g, ' '))
  const arataValoare = v => (v == null || v === '' ? '(gol)' : typeof v === 'object' ? (Array.isArray(v) ? `${v.length} rânduri` : 'altă propunere meteo') : String(v))

  const laLista = () => { if (!modificat || !editabil || window.confirm(ciornaEroare ? 'Ai modificări nesalvate și ciorna locală NU s-a putut scrie: se pierd. Ieși?' : 'Ai modificări nesalvate (rămân în ciorna locală). Ieși?')) inchideForm() }
  // panourile comune ale ambelor ecrane (pași / formularul complet): mesajul, cererile nelămurite, ciorna, conflictul, doar citire, anularea
  const panouri = <>
      {banner}{bannerNelamurite}
      {ciornaEroare &&<div role="alert" style={{ ...ST.card, borderColor: G.red }}>Ciorna locală nu se poate scrie (stocare plină sau blocată): modificările de pe ecran se pierd la ieșire. Salvează pe server cât ai semnal.</div>}
      {ciornaGasita && (
        <div style={{ ...ST.card, borderColor: G.yellow }}>
          Ai modificări nesalvate din {fmtMoment(ciornaGasita.la)}{ciornaGasita.vecheVersiune ? ' — între timp raportul a fost salvat de altcineva: la restaurare vei alege câmp cu câmp' : ''}.
          <div style={{ ...ST.rand, marginTop: 8 }}>
            <button style={ST.btn} onClick={restaureazaCiorna}>Restaurez</button>
            <button style={ST.btn} onClick={() => { stergeCiorna(ciornaGasita.pentru); setCiornaGasita(null) }}>Renunț la ciornă</button>
          </div>
        </div>
      )}
      {conflict && (
        <div role="alert" style={{ ...ST.card, borderColor: G.red }}>
          <div style={ST.h}>Raportul s-a schimbat între timp (versiunea {conflict.server.versiune})</div>
          <div style={{ fontSize: 13, color: G.muted }}>Modificările colegului pe câmpurile pe care nu le-ai atins au fost puse pe formular. {conflict.conflicte.length ? 'Pe câmpurile de mai jos ați scris amândoi: alege.' : 'Nu sunteți în conflict pe niciun câmp.'}</div>
          {conflict.conflicte.map(c => (
            <div key={c.camp} style={{ marginTop: 8 }}>
              <b style={{ fontSize: 14 }}>{etichetaCamp(c.camp)}</b>
              <div style={{ ...ST.rand, flexWrap: 'wrap', marginTop: 4 }}>
                {['al_meu', 'al_colegului'].map(a => (
                  <button key={a} style={{ ...ST.btn, borderColor: conflict.alese[c.camp] === a ? G.green : G.border }} onClick={() => setConflict(x => ({ ...x, alese: { ...x.alese, [c.camp]: a } }))}>
                    {conflict.alese[c.camp] === a ? '☒' : '☐'} {a === 'al_meu' ? 'Al meu' : 'Al colegului'}: {arataValoare(a === 'al_meu' ? c.al_meu : c.al_colegului)}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <button style={{ ...ST.mare, marginTop: 10 }} disabled={conflict.conflicte.some(c => !conflict.alese[c.camp])} onClick={confirmaConflict}>Am ales — pun alegerile pe formular</button>
        </div>
      )}
      {!poateScrie && <div style={{ ...ST.card, color: G.muted }}>Doar citire: nu ai drept de scriere pe Execuție pentru acest proiect.</div>}
      {rand?.stare === 'anulata' && <div style={{ ...ST.card, borderColor: G.muted }}>Raport anulat: {rand.motiv_anulare}</div>}
  </>

  if (mod === 'pasi') {
    // pasul: regula comună a închiderii decide întâi (lipsaDinRand, cu încărcările nelămurite), apoi etapele (runda 3, P1)
    const pasDate = selectat === 'nou' ? 'tronson' : rand && pozeGata ? pasCurent(rand, poze, deschise.length) : null
    return (
      <UscarePasi p={{
        ST, Camp, form, rand, val, poze, pozeGata, editabil, poateScrie, inCurs, modificat, conflict, nelamuriteTinta, probe, probeEroare, uscari,
        pas: pasDate, ecranPas, setEcranPas, lipsa, pozeL, deschise, v24, durata, viteza, kmDif, panouri, acum, jos: JOS, pdfInCurs, motivVerdict, setMotivVerdict,
        confirmat: !!rand && confirmDetalii === rand.id, setConfirmat: x => setConfirmDetalii(x && rand ? rand.id : null),
        meteoAlegere, propuneMeteo, aplicaMeteo, schimba, cant, setBureti, inp, nrInp, nrCuSemn, oraInp, blocPoze, blocUtilaje,
        laLista, laComplet: () => setMod('complet'), salveaza: () => salveaza({ ce: 'Salvarea pe parcurs' }), incepeUscarea, inregistreazaEtapa1,
        terminaEtapa2, genereazaRaport, pdf: () => pdf(), trecereNoua,
      }} />
    )
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: `8px 12px ${REZERVA_PLUTITOARE + (editabil ? INALTIME_BARA : 16)}px` }}>
      <div style={{ ...ST.rand, justifyContent: 'space-between', margin: '8px 0' }}>
        <button style={ST.btn} onClick={laLista}>← Lista</button>
        {ecranInitial === 'pasi' && <button style={ST.btn} onClick={() => setMod('pasi')}>← Înapoi la pași</button>}
        <span style={{ fontSize: 13, fontWeight: 700, color: rand ? CULORI_STARE[rand.stare] : G.blue }}>{rand ? ETICHETE_STARE[rand.stare] : 'Raport nou'}{rand?.revizie ? ` · rev. ${rand.revizie}` : ''}</span>
      </div>
      {panouri}

      {/* runda 5: cât o cerere e în zbor, câmpurile formularului sunt blocate (fieldset nativ): ce s-ar scrie între timp ar fi înlocuit de
          răspunsul salvării, fără urmă */}
      <fieldset disabled={inCurs} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
      {sect('1. Planificare și notificarea beneficiarului', <>
        <Camp eticheta="Începutul planificat">{oraInp('inceput_planificat')}</Camp>
        <Camp eticheta="Beneficiarul notificat la">{oraInp('notificare_la')}</Camp>
        <Camp eticheta="Referința notificării (nr. adresă / mail)">{inp('notificare_ref')}</Camp>
        {v24.stare === 'sub_24h' && <div role="alert" style={{ color: G.yellow, fontSize: 14, marginTop: 8 }}>⚠ Notificarea s-a făcut cu {fmtNr(v24.ore)} h înainte de începutul {v24.inceput === 'real' ? 'real' : 'planificat'}; beneficiarul cere minimum 24 h.</div>}
        {v24.stare === 'necunoscut' && <div style={ST.nota}>Completează notificarea și începutul ca să se verifice cele 24 h cerute de beneficiar.</div>}
        {v24.stare === 'ok' && <div style={{ color: G.green, fontSize: 13, marginTop: 8 }}>✓ Notificare cu {fmtNr(v24.ore)} h înainte (minimum 24 h).</div>}
      </>)}

      {sect('2. Tronsonul', <>
        {probeEroare && <div role="alert" style={{ color: G.red, fontSize: 13 }}>{probeEroare}</div>}
        {probe.length > 0 && (
          <Camp eticheta="Tronsonul de probă">
            <select style={ST.in} disabled={!editabil} value={form.proba_id} onChange={e => {
              const p = probe.find(x => String(x.id) === e.target.value)
              schimba(p ? { proba_id: String(p.id), km_de_la: fmtKm(p.km_de_la_m), km_pana_la: fmtKm(p.km_pana_la_m), tronson: form.tronson || [p.cod, p.denumire].filter(Boolean).join(' — ') } : { proba_id: '' })
            }}>
              <option value="">— alt interval / tot traseul —</option>
              {probe.map(p => <option key={p.id} value={p.id}>{p.cod}{p.denumire ? ` — ${p.denumire}` : ''} (km {fmtKm(p.km_de_la_m)} → {fmtKm(p.km_pana_la_m)})</option>)}
            </select>
          </Camp>
        )}
        <Camp eticheta="Tronson (cum apare în raport)">{inp('tronson')}</Camp>
        <div style={ST.rand}>
          <Camp eticheta="De la km">{inp('km_de_la', { placeholder: '3+200' })}</Camp>
          <Camp eticheta="La km">{inp('km_pana_la', { placeholder: '3+900' })}</Camp>
        </div>
        <Camp eticheta="Lungime (m)" nota={kmDif ? 'Diferă de intervalul de km: verifică (lungimea reală poate fi alta decât diferența de km).' : null}>{nrInp('lungime_m')}</Camp>
        <Camp eticheta="Data operației">{inp('data_operatie', { type: 'date' })}</Camp>
        <Camp eticheta="Denumire constructor">{inp('constructor')}</Camp>
        {selectat === 'nou' && editabil && (
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, fontSize: 14 }}>
            <input type="checkbox" checked={confirmConstructor} onChange={e => setConfirmConstructor(e.target.checked)} style={{ width: 22, height: 22 }} />
            Confirm constructorul pentru acest raport (propus din ultimul raport al proiectului; se poate schimba)
          </label>
        )}
      </>)}

      {sect('3. Poziția operațiunii', <>
        <div style={ST.rand}>
          <Camp eticheta="Latitudine">{inp('poz_lat', { inputMode: 'decimal', placeholder: '44,941234', onChange: e => { genGps.current += 1; schimba({ poz_lat: e.target.value, poz_sursa: 'manual', poz_precizie_m: '', poz_km_m: '', poz_traseu_versiune: '', poz_la: new Date().toISOString() }) } })}</Camp>
          <Camp eticheta="Longitudine">{inp('poz_lng', { inputMode: 'decimal', placeholder: '22,500001', onChange: e => { genGps.current += 1; schimba({ poz_lng: e.target.value, poz_sursa: 'manual', poz_precizie_m: '', poz_km_m: '', poz_traseu_versiune: '', poz_la: new Date().toISOString() }) } })}</Camp>
        </div>
        {editabil && (
          <div style={{ ...ST.rand, marginTop: 8, flexWrap: 'wrap' }}>
            <button style={ST.btn} onClick={captureazaGps} disabled={inCurs}>📍 Poziția mea (GPS, o citire)</button>
            {form.poz_lat && <button style={ST.btn} onClick={() => { genGps.current += 1; schimba({ poz_lat: '', poz_lng: '', poz_sursa: '', poz_precizie_m: '', poz_la: '', poz_km_m: '', poz_traseu_versiune: '' }) }}>Șterge poziția</button>}
          </div>
        )}
        <div style={ST.nota}>
          {form.poz_lat && form.poz_sursa ? `Sursa: ${ETICHETE_POZ_SURSA[form.poz_sursa]}${form.poz_sursa === 'gps' ? `, precizie ±${form.poz_precizie_m} m` : ''}${form.poz_la ? `, la ${fmtMoment(form.poz_la)}` : ''}. ` : ''}
          GPS-ul se citește doar când apeși butonul (nu se urmărește nimic). Coordonatele NU apar în PDF decât dacă bifezi la export.
          {form.poz_sursa === 'traseu' ? ' Km-ul din traseu e calibrat pe borne: distanța geometrică nu e automat km contractual.' : ''}
        </div>
      </>)}

      {sect('4. Vremea', <>
        <div style={ST.rand}>
          <Camp eticheta="Temperatura exterioară (°C)">{nrCuSemn('temperatura_c', { onChange: e => schimba({ temperatura_c: e.target.value, temperatura_sursa: 'manual' }) })}</Camp>
          {editabil && <button style={ST.btn} onClick={propuneMeteo} disabled={inCurs}>🌡️ Din meteo</button>}
        </div>
        <Camp eticheta="Vremea">{inp('vreme')}</Camp>
        <div style={ST.nota}>
          {form.temperatura_sursa === 'meteo' && form.meteo_cerere ? `Propusă din vremea șantierului ${form.meteo_cerere.site} (${form.meteo_cerere.furnizor || 'furnizor necunoscut'}), observată la ${fmtMoment(form.meteo_cerere.ora_observatiei)}, preluată la ${fmtMoment(form.meteo_cerere.preluat_la)}; serverul o fixează la salvare. Dacă o corectezi, devine „măsurată” (valoarea automată se păstrează alături).`
            : form.temperatura_sursa === 'meteo' ? `Din meteo: ${form.meteo?.santier || ''}, observată la ${fmtMoment(form.meteo?.ora_observatiei)} pentru ora începerii ${fmtMoment(form.meteo?.ora_ceruta)}.`
              : form.temperatura_c ? 'Măsurată de om.' : 'Vremea se propune pentru ora începerii (observația furnizorului la cel mult 3 h de ea).'}
          {form.meteo_cerere && form.temperatura_sursa !== 'meteo' ? ` Valoarea automată propusă se păstrează la salvare: ${form.meteo_cerere.temperatura_c ?? '?'} °C (${form.meteo_cerere.site || 'șantier'}, observată la ${fmtMoment(form.meteo_cerere.ora_observatiei)}).`
            : form.meteo && form.temperatura_sursa !== 'meteo' ? ` Valoarea automată păstrată: ${fmtNr(form.meteo.temperatura_c, 1)} °C (${form.meteo.santier || 'șantier'}, observată la ${fmtMoment(form.meteo.ora_observatiei)}).` : ''}
          {distMeteo != null && distMeteo > 10000 ? ` ⚠ Șantierul vremii e la ${fmtNr(distMeteo / 1000, 1)} km de poziția operațiunii.` : ''}
        </div>
        {meteoAlegere && <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>{meteoAlegere.opt.map(o => <button key={o.site_id} style={ST.btn} onClick={() => aplicaMeteo(o, meteoAlegere.gen, meteoAlegere.ctx)}>{o.site}: {o.temperatura_c} °C, {o.vreme} (observată la {fmtMoment(o.ora_observatiei)})</button>)}</div>}
        {blocPoze('temperatura')}
      </>)}

      {sect('5. Utilaje / echipamente', <>
        {blocUtilaje()}
        {blocPoze('utilaje')}
      </>)}

      {sect('6. Perioada', <>
        <Camp eticheta="Ora începerii">{oraInp('ora_inceput')}</Camp>
        <Camp eticheta="Ora finalizării">{oraInp('ora_final')}</Camp>
        <div style={{ fontSize: 14, marginTop: 8 }}>Durata: <b>{durata == null ? '—' : `${fmtNr(durata, 2)} ore`}</b></div>
      </>)}

      {sect('7. Configurația ansamblului de pistoane', <>
        <div style={ST.rand}>
          <Camp eticheta="PIG metalic [buc]">{nrInp('pig_metalic_buc', { inputMode: 'numeric' })}</Camp>
          <Camp eticheta="Piston poliuretan [buc]">{nrInp('piston_pu_buc', { inputMode: 'numeric' })}</Camp>
          <Camp eticheta={`Bureți spumă [buc] (≤ ${MAX_BURETI})`}>{inp('bureti_buc', { inputMode: 'numeric', onChange: e => setBureti(e.target.value) })}</Camp>
        </div>
        {blocPoze('pistoane')}
      </>)}

      {sect('8. Cântărirea bureților (câte una pe fiecare burete declarat)', <>
        {form.cantariri.length === 0 && <div style={ST.nota}>Scrie numărul de bureți (secțiunea 7): apare câte un rând pe burete.</div>}
        {form.cantariri.map((c, i) => {
          const d = diferentaBurete(val.cantariri[i])
          const na = c.motiv != null && c.motiv !== ''
          return (
            <div key={c.nr} style={{ borderTop: i ? `1px solid ${G.border2}` : 'none', paddingTop: i ? 8 : 0, marginTop: i ? 8 : 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Buretele {c.nr}{d != null && <span style={{ fontWeight: 400, color: G.muted }}> · diferența (ieșire − intrare): {fmtNr(d, 3)} kg</span>}</div>
              {!na ? (
                <div style={ST.rand}>
                  <Camp eticheta="La intrare [kg]"><input style={ST.in} inputMode="decimal" disabled={!editabil} value={c.intrare_kg} onChange={e => cant(i, { intrare_kg: e.target.value })} /></Camp>
                  <Camp eticheta="La ieșire [kg]"><input style={ST.in} inputMode="decimal" disabled={!editabil} value={c.iesire_kg} onChange={e => cant(i, { iesire_kg: e.target.value })} /></Camp>
                </div>
              ) : (
                <Camp eticheta="Nu se aplică — motivul"><input style={ST.in} disabled={!editabil} value={c.motiv} maxLength={200} onChange={e => cant(i, { motiv: e.target.value })} /></Camp>
              )}
              {editabil && <button style={{ ...ST.btn, marginTop: 6 }} onClick={() => cant(i, na ? { motiv: '' } : { motiv: ' ', intrare_kg: '', iesire_kg: '' })}>{na ? 'Are cântăriri' : 'Nu se aplică (cu motiv)'}</button>}
              {!na && <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>{blocPoze('cantar_intrare', c.nr)}{blocPoze('cantar_iesire', c.nr)}</div>}
            </div>
          )
        })}
        <div style={ST.nota}>Diferența de greutate e doar informativă, în aplicație (beneficiarul n-a dat un prag; nu apare în PDF).</div>
      </>)}

      {sect('9. Punctul de rouă (opțional)', <>
        <div style={ST.rand}>
          <Camp eticheta="Valoare (°C)">{nrCuSemn('punct_roua_c')}</Camp>
          <Camp eticheta="Locul măsurării">{inp('punct_roua_loc')}</Camp>
        </div>
        <div style={ST.nota}>Caietul de sarcini nu dă un prag pentru punctul de rouă: dacă îl măsori, se trece în rubricile modelului; nu decide concluzia.</div>
        {form.punct_roua_c && !form.punct_roua_loc && <div style={{ color: G.yellow, fontSize: 13, marginTop: 6 }}>Scrie și locul măsurării.</div>}
        {blocPoze('punct_roua')}
      </>)}

      {sect('10. Deplasarea buretelui', <>
        <div style={ST.rand}>
          <Camp eticheta="Presiunea în spatele buretelui (bar)">{nrInp('presiune_bar')}</Camp>
          <Camp eticheta="Timp deplasare (min)">{nrInp('timp_deplasare_min')}</Camp>
        </div>
        <div style={{ fontSize: 14, marginTop: 8 }}>Viteza medie (lungime / timp): <b>{viteza == null ? '—' : `${fmtNr(viteza, 2)} m/s`}</b></div>
        {blocPoze('manometru')}
      </>)}

      {sect('11. Criteriul de acceptare: ultimul piston vehiculat', <>
        <div style={{ fontSize: 13, color: G.muted }}>Caietul de sarcini (cap. 4.1.8.5): „conducta se consideră uscată atunci când ultimul piston vehiculat iese uscat”. Fotografiază ultimul piston la ieșire.</div>
        <div style={{ ...ST.rand, marginTop: 10 }}>
          {[['uscat', 'IESE USCAT', G.green], ['umed', 'NU IESE USCAT', G.red]].map(([v, t, cul]) => (
            <button key={v} disabled={!editabil} onClick={() => schimba({ piston_final_rezultat: form.piston_final_rezultat === v ? '' : v })}
              style={{ ...ST.mare, background: form.piston_final_rezultat === v ? cul + '44' : 'transparent', borderColor: form.piston_final_rezultat === v ? cul : G.border }}>
              {form.piston_final_rezultat === v ? '☒' : '☐'} {t}
            </button>
          ))}
        </div>
        {blocPoze('piston_final')}
      </>)}

      {sect('12. Observații și concluzie', <>
        <Camp eticheta="Observații"><textarea style={{ ...ST.in, minHeight: 90 }} disabled={!editabil} value={form.observatii} onChange={e => schimba({ observatii: e.target.value })} /></Camp>
        <div style={{ ...ST.rand, marginTop: 10 }}>
          {['conform', 'neconform'].map(c => (
            <button key={c} disabled={!editabil} onClick={() => schimba({ concluzie: form.concluzie === c ? '' : c })}
              style={{ ...ST.mare, background: form.concluzie === c ? (c === 'conform' ? G.green : G.red) + '44' : 'transparent', borderColor: form.concluzie === c ? (c === 'conform' ? G.green : G.red) : G.border }}>
              {form.concluzie === c ? '☒' : '☐'} {c.toUpperCase()}
            </button>
          ))}
        </div>
        {form.concluzie === 'conform' && form.piston_final_rezultat !== 'uscat' && <div style={{ color: G.red, fontSize: 13, marginTop: 6 }}>CONFORM cere ca ultimul piston să iasă uscat (secțiunea 11).</div>}
        {form.concluzie === 'conform' && pozeGata && !poze.some(p => p.categorie === 'piston_final') && <div style={{ color: G.red, fontSize: 13, marginTop: 6 }}>CONFORM cere fotografia ultimului piston (secțiunea 11).</div>}
        {form.concluzie === 'neconform' && !form.observatii.trim() && <div style={{ color: G.yellow, fontSize: 13, marginTop: 6 }}>Scrie în observații ce nu a fost conform.</div>}
        {blocPoze('altele')}
      </>)}

      {sect('13. Semnături (se pot completa și de mână)', <>
        <div style={ST.rand}><Camp eticheta="Constructor — nume, prenume">{inp('semn_constructor_nume')}</Camp><Camp eticheta="Funcția">{inp('semn_constructor_functie')}</Camp></div>
        <div style={ST.rand}><Camp eticheta="Beneficiar — nume, prenume">{inp('semn_beneficiar_nume')}</Camp><Camp eticheta="Funcția">{inp('semn_beneficiar_functie')}</Camp></div>
      </>)}
      </fieldset>

      {rand && pozeGata && deschise.length > 0 && sect('Încărcări de fotografii nelămurite', <>
        <div style={{ fontSize: 13, color: G.muted }}>Fișiere rezervate, dar neînregistrate în raport (urcare întreruptă). Nu se șterge nimic automat: înregistrează-le (dacă fișierul a ajuns), reîncarcă fișierul sau renunță cu motiv.</div>
        {deschise.map(i => (
          <div key={i.cale} style={{ borderTop: `1px solid ${G.border2}`, paddingTop: 8, marginTop: 8 }}>
            <div style={{ fontSize: 14 }}>{ETICHETE_CATEGORII[i.categorie]}{i.burete_nr ? `, buretele ${i.burete_nr}` : ''} · rezervată la {fmtMoment(i.creat_la)}</div>
            {editabil && <div style={{ ...ST.rand, flexWrap: 'wrap', marginTop: 6 }}>
              <button style={ST.btn} disabled={inCurs} onClick={() => actiunePoza((c, id) => inregistreaza(i.cale, id, c))}>Înregistrează</button>
              {incarcPoza?.cale === i.cale && incarcPoza.uscare === rand.id && <button style={ST.btn} disabled={inCurs} onClick={() => actiunePoza(c => urcaSiInregistreaza(incarcPoza, c))}>Reîncearcă fișierul</button>}
              <label style={{ ...ST.btn, display: 'inline-flex', alignItems: 'center', gap: 6, opacity: inCurs ? 0.5 : 1 }}>
                📷 Alege fișierul pentru această rezervare
                <input type="file" accept="image/*" disabled={inCurs} style={{ display: 'none' }} aria-label={`Fișierul rezervării ${i.cale}`}
                  onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) fisierPentruRezervare(i, f) }} />
              </label>
              <button style={ST.btn} disabled={inCurs} onClick={() => setRenunt({ cale: i.cale, text: '' })}>Renunț…</button>
            </div>}
            {renunt?.cale === i.cale && (
              <div style={{ ...ST.rand, marginTop: 6 }}>
                <Camp eticheta="Motivul (rămâne în jurnal)"><input style={ST.in} value={renunt.text} maxLength={300} onChange={e => setRenunt({ ...renunt, text: e.target.value })} /></Camp>
                <button style={ST.btn} disabled={inCurs || !renunt.text.trim()} onClick={() => renuntaIncarcare(i.cale, renunt.text.trim())}>Confirm</button>
              </div>
            )}
          </div>
        ))}
      </>)}

      {rand && sect('Închiderea raportului', <>
          {!pozeGata && <div style={ST.nota}>Se citesc pozele raportului…</div>}
          {pozeGata && lipsa.length > 0 && <div style={{ fontSize: 14, color: G.yellow }}>Pentru închidere lipsesc: {lipsa.map(k => ETICHETE_OBLIGATORII[k]).join('; ')}.</div>}
          {pozeGata && pozeL.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 14, color: G.yellow }}>Fotografii cerute de beneficiar încă lipsă: {pozeL.map(etichetaPozaLipsa).join(', ')}.</div>
              <Camp eticheta="Justificarea lipsei (obligatorie dacă închizi fără ele; se salvează cu raportul)"><textarea style={{ ...ST.in, minHeight: 60 }} disabled={!editabil} value={form.poze_justificare} maxLength={1000} onChange={e => schimba({ poze_justificare: e.target.value })} /></Camp>
            </div>
          )}
          {modificat && deschis && <div style={ST.nota}>Salvează întâi modificările.</div>}
          <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
            {poateScrie && actiuniPermise(rand.stare).includes('inchide') && (
              <button style={{ ...ST.mare, borderColor: G.green }} disabled={inCurs || modificat || !pozeGata || lipsa.length > 0 || !!conflict}
                onClick={() => { if (window.confirm(`Închizi raportul cu concluzia ${String(rand.concluzie).toUpperCase()}? După închidere nu se mai poate modifica (doar redeschidere consemnată, de un administrator).`)) schimbaStare('inchide') }}>✓ Închide raportul</button>
            )}
            {esteAdmin && actiuniPermise(rand.stare).includes('redeschide') && <button style={ST.btn} disabled={inCurs} onClick={() => setMotiv({ actiune: 'redeschide', text: '' })}>Redeschide (corectură, cu motiv)</button>}
            {poateScrie && actiuniPermise(rand.stare).includes('anuleaza') && <button style={{ ...ST.btn, color: G.red }} disabled={inCurs} onClick={() => setMotiv({ actiune: 'anuleaza', text: '' })}>Anulează raportul</button>}
            {motiv && (
              <div>
                <Camp eticheta={motiv.actiune === 'redeschide' ? 'Motivul redeschiderii (rămâne în jurnal; versiunea închisă se păstrează)' : 'Motivul anulării'}><input style={ST.in} value={motiv.text} maxLength={500} onChange={e => setMotiv({ ...motiv, text: e.target.value })} /></Camp>
                <div style={{ ...ST.rand, marginTop: 8 }}>
                  <button style={ST.btn} disabled={inCurs || !motiv.text.trim()} onClick={() => schimbaStare(motiv.actiune, motiv.text.trim())}>Confirm</button>
                  <button style={ST.btn} onClick={() => setMotiv(null)}>Renunț</button>
                </div>
              </div>
            )}
            <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 14, minHeight: 48, padding: '4px 0', cursor: 'pointer' }}>
              <input type="checkbox" checked={coordPentru === rand.id} onChange={e => setCoordPentru(e.target.checked ? rand.id : null)} style={{ width: 28, height: 28, flexShrink: 0, margin: 0 }} />
              Include coordonatele exacte ale operațiunii în PDF (doar pentru acest raport, la următorul export)
            </label>
            <button style={ST.mare} disabled={inCurs || !pozeGata} onClick={() => pdf()}>{pdfInCurs ? '⏳ Se generează raportul…' : `📄 Raportul în PDF${rand.stare !== 'inchisa' ? ' (ciornă)' : ''}`}</button>
          </div>
        </>)}
      {selectat === 'nou' && <div style={{ ...ST.card, color: G.muted, fontSize: 13 }}>Salvează raportul ca să poți adăuga fotografii.</div>}

      {editabil && (
        <div style={{ position: 'fixed', left: 0, right: 0, bottom: REZERVA_PLUTITOARE, padding: 10, background: G.bg, borderTop: `1px solid ${G.border}`, borderBottom: `1px solid ${G.border}`, boxShadow: '0 -4px 16px rgba(0,0,0,.35)', zIndex: 20 }}>
          <div style={{ maxWidth: 720, margin: '0 auto' }}>
            <button style={{ ...ST.mare, background: modificat && !conflict ? '#238636' : G.surface2, color: '#fff' }} disabled={inCurs || !modificat || !!conflict || nelamuriteTinta.length > 0 || (selectat === 'nou' && !confirmConstructor)} onClick={() => salveaza()}>
              {inCurs ? 'Se trimite…' : conflict ? 'Rezolvă conflictul de sus' : nelamuriteTinta.length ? 'Lămurește cererea de sus' : selectat === 'nou' ? '💾 Creează raportul' : modificat ? '💾 Salvează' : '✓ Salvat'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
