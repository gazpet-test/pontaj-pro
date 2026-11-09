// ═══════════════════════════════════════════════════════════════════════════
// ProbeTronsoane.jsx — Execuție → proiect → „🧪 Probe pe tronsoane” (cererea lui Răzvan, 09.11.2026), mobil întâi (șantier, telefon)
// Tronsoanele de probă (P1, P2…) = intervale de km pe proiect; pentru fiecare: din ce tronsoane de execuție e format (calculat din
// executie_tronsoane), cele 4 etape cu starea lor (pistonare, uscare, calibrare, presiune), presiunea curentă și jurnalul operațiilor.
// Sus: banda traseului (ce e acoperit de probe și ce nu). Scrierea: doar cu drept de scriere pe Execuție, prin RPC-urile
// fn_executie_proba_salveaza / _anuleaza / _etapa (migrarea 20261202a); citirea prin RLS. Pagina nu scrie nimic altundeva.
// L05: o salvare cu rezultat necunoscut se reia cu aceeași cheie doar dacă cererea e identică; altfel întâi se reîncarcă.
// L24: încărcarea, jurnalul și lista de probe din modulul Probe au fiecare generația lor; un rezultat întârziat nu se aplică pe alt context.
// ═══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { supabase } from './lib/supabase.js'
import { paginareKeyset } from './hrDeciziiUtil.js'
import { ziBucuresti } from './lib/izoTeren.js'
import { G, S } from './NodCuplareVizualizare.jsx'
import {
  ETAPE, ETICHETE_ETAPA, ETICHETE_STARE, ICON_STARE, culoareStare, stariUrmatoare, etichetaActiune, cereMotiv, faraValori,
  FLUIDE, PLACI, CAMPURI, parseKm, fmtKm, fmtLungime, fmtInterval, tronsoaneCuKm, compozitie, acoperire, STARE_PROBA, stareProba,
  presiuneCurenta, fmtBar, fmtZi, fmtOra, valoriDinFormular, formularDinEtapa, valideazaEtapa, payloadEtapa, valideazaProba,
  suprapuneri, payloadProba, codUrmator, aplicaRand, imbinaLista, ordoneazaProbe, textJurnal, esteRefuzDeterminist,
  clasificaReluare, prefixRegistru, registruNou, aceeasiIntentie,
} from './probeTronsoaneLogica.js'

// stocarea browserului pentru registrul cererilor nelămurite (lipsă / blocată = salvarea oprită, cu mesaj)
const stocareImplicita = () => { try { return globalThis.localStorage || null } catch { return null } }

const COL_PROBA = 'id, proiect_id, cod, denumire, km_de_la_m, km_pana_la_m, observatii, stare, motiv_anulare, versiune, creat_la, modificat_la'
const COL_ETAPA = 'id, proba_id, proiect_id, etapa, stare, data_start, data_final, data_stare, nr_treceri, punct_roua_c, placa, fluid, presiune_proba_bar, presiune_curenta_bar, presiune_curenta_la, durata_ore, probe_calc_id, rezultat, observatii, motiv, versiune, modificat_la'
const COL_JURNAL = 'id, proba_id, etapa_id, actiune, stare_veche, stare_noua, data_operatie, valori, creat_la'
const cheieNoua = () => globalThis.crypto.randomUUID()
const pagini = (client, tabel, coloane, filtru) => paginareKeyset((ultim, pas) => {
  let q = filtru(client.from(tabel).select(coloane)).order('id').limit(pas)
  if (ultim != null) q = q.gt('id', ultim)
  return q
})

// `client` și `stocare` se pot înlocui doar în testele de componentă (date sintetice); în aplicație: clientul Supabase al sesiunii și
// localStorage-ul browserului
export default function ProbeTronsoane({ proiectId, client = supabase, stocare = stocareImplicita() }) {
  const [probe, setProbe] = useState([])
  const [etape, setEtape] = useState([])
  const [tronsoane, setTronsoane] = useState([])
  const [eroareTronsoane, setEroareTronsoane] = useState(null)
  const [incarc, setIncarc] = useState(true)
  const [incarcat, setIncarcat] = useState(false)      // prima încărcare a proiectului a reușit (apoi lista nu mai dispare la reîncărcări)
  const [eroare, setEroare] = useState(null)
  const [poateScrie, setPoateScrie] = useState(false)
  const [eroareDrept, setEroareDrept] = useState(null)
  const [eroareReimprospatare, setEroareReimprospatare] = useState(null)
  const [azi, setAzi] = useState(ziBucuresti())
  const [selectat, setSelectat] = useState(null)          // id-ul tronsonului de probă deschis în fișă
  const [formProba, setFormProba] = useState(null)        // { proba } (null în proba = tronson nou)
  const [formEtapa, setFormEtapa] = useState(null)        // { id, laDeschidere } — etapa și rândul ei la deschiderea formularului
  const [formAnulare, setFormAnulare] = useState(null)    // id-ul tronsonului de probă
  const [arataAnulate, setArataAnulate] = useState(false)
  const [mesaj, setMesaj] = useState(null)
  const [inCurs, setInCurs] = useState(false)
  const [jurnalKey, setJurnalKey] = useState(0)
  const gen = useRef(0)
  const ctx = useRef(0)                 // contextul formularului deschis: crește la deschidere / închidere / schimbarea proiectului
  const proiectCtx = useRef(0)          // contextul proiectului: crește la schimbarea proiectului și la demontare (L24)
  // L05: registrul cererilor cu rezultat NECUNOSCUT ({ tinta, rpc, cheie, payload }), pe (utilizator, proiect), în browser; null = nepregătit
  const registru = useRef(null)
  const [registruGata, setRegistruGata] = useState(false)
  const [eroareRegistru, setEroareRegistru] = useState(null)
  const [nrNelamurite, setNrNelamurite] = useState(0)
  const [renunta, setRenunta] = useState(false)          // pasul de confirmare al renunțării la verificare
  const recitesteNelamurite = reg => { if (reg === registru.current) setNrNelamurite((reg?.toate() || []).length) }
  const montat = useRef(true)
  useEffect(() => { montat.current = true; return () => { montat.current = false; proiectCtx.current += 1 } }, [])

  // „azi” (Europe/Bucharest) se recalculează la revenirea în pagină și la schimbarea zilei
  useEffect(() => {
    const actualizeaza = () => setAzi(z => { const n = ziBucuresti(); return n === z ? z : n })
    const t = setInterval(actualizeaza, 60000)
    const vizibil = () => { if (document.visibilityState === 'visible') actualizeaza() }
    document.addEventListener('visibilitychange', vizibil)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vizibil) }
  }, [])

  // ── probele, etapele, tronsoanele de execuție și dreptul de scriere; keyset pe id (L23) ──
  // Întoarce true DOAR dacă citirea a reușit și s-a aplicat (nu a fost depășită de o încărcare mai nouă); altfel false (L18).
  // `silentios` (reîmprospătarea după o salvare / reconcilierea): la eșec lista rămâne pe ecran, cu un avertisment, nu pagina de eroare.
  const incarca = useCallback(async ({ silentios = false } = {}) => {
    const g = ++gen.current
    setIncarc(true); setEroareDrept(null)
    if (!silentios) setEroare(null)
    try {
      const [p, e, t, drept] = await Promise.all([
        pagini(client, 'executie_probe_tronsoane', COL_PROBA, q => q.eq('proiect_id', proiectId)),
        pagini(client, 'executie_probe_etape', COL_ETAPA, q => q.eq('proiect_id', proiectId)),
        pagini(client, 'executie_tronsoane', 'id, cod, km_start_m, km_end_m', q => q.eq('proiect_id', proiectId))
          .then(r => ({ r }), err => ({ err })),
        client.rpc('fn_executie_nod_drept', { p_proiect: proiectId, p_scriere: true }),
      ])
      if (g !== gen.current) return false
      setProbe(cur => imbinaLista(p.filter(x => x.proiect_id === proiectId), cur))
      setEtape(cur => imbinaLista(e.filter(x => x.proiect_id === proiectId), cur))
      // L18: tronsoanele necitite ≠ „niciun tronson”: compoziția nu se calculează, se spune de ce
      if (t.err) { setTronsoane([]); setEroareTronsoane('Tronsoanele de execuție nu s-au putut citi (' + (t.err.message || t.err) + '): compoziția și banda nu se pot calcula.') }
      else { setTronsoane(t.r); setEroareTronsoane(null) }
      if (drept.error) { setPoateScrie(false); setEroareDrept('Nu am putut verifica dreptul de scriere: ' + drept.error.message) }
      else setPoateScrie(drept.data === true)
      setAzi(ziBucuresti())
      setEroareReimprospatare(null)
      setIncarcat(true)
      return true
    } catch (err) {
      if (g !== gen.current) return false
      if (silentios) { setEroareReimprospatare('Lista nu s-a putut reîmprospăta (' + (err?.message || err) + '). Ce vezi poate fi vechi: apasă ↻ Reîncarcă.'); return false }
      setProbe([]); setEtape([])
      setEroare('Nu am putut încărca probele: ' + (err?.message || err))
      return false
    } finally { if (g === gen.current) setIncarc(false) }
  }, [proiectId, client])
  useEffect(() => {
    // proiect nou (sau alt client): orice răspuns al unei acțiuni pornite înainte nu mai are niciun efect aici (registrul lui se
    // actualizează totuși, pe cheia proiectului lui)
    proiectCtx.current += 1; ctx.current += 1
    const pg = proiectCtx.current
    // până când registrul persistent e gata, NU se trimite nimic (o cerere fără registru durabil s-ar putea pierde ca nelămurită)
    registru.current = null; setRegistruGata(false); setNrNelamurite(0)
    setProbe([]); setEtape([]); setTronsoane([]); setSelectat(null); setFormProba(null); setFormEtapa(null); setFormAnulare(null); setMesaj(null); setInCurs(false)
    setIncarcat(false); setEroareReimprospatare(null); setEroareRegistru(null)
    incarca()
    // registrul persistent al utilizatorului pe acest proiect (identitatea din sesiune; fără ea / fără stocare: salvarea rămâne oprită)
    let curatare = () => {}
    ;(async () => {
      let uid = null
      try { const s = client.auth?.getSession ? await client.auth.getSession() : null; uid = s?.data?.session?.user?.id || null } catch { uid = null }
      if (pg !== proiectCtx.current) return
      const reg = registruNou(uid ? stocare : null, uid ? prefixRegistru(uid, proiectId) : null)
      if (!reg.utilizabil || reg.toate() === null) {
        setEroareRegistru('Stocarea locală a browserului nu e disponibilă (navigare privată, stocare blocată sau sesiune neidentificată): salvarea e oprită, ca un rezultat nelămurit să nu se piardă.')
        return
      }
      registru.current = reg
      setRegistruGata(true)
      setNrNelamurite(reg.toate().length)
      // alt tab al aceluiași browser a pus / scos o cerere pe acest proiect: bannerul se actualizează
      const laSchimbare = e => { if (pg === proiectCtx.current && (e.key == null || e.key.startsWith(prefixRegistru(uid, proiectId)))) setNrNelamurite((reg.toate() || []).length) }
      globalThis.addEventListener?.('storage', laSchimbare)
      curatare = () => globalThis.removeEventListener?.('storage', laSchimbare)
    })()
    return () => curatare()
  }, [incarca, client, stocare, proiectId])

  const etapePeProba = useMemo(() => {
    const m = new Map()
    for (const e of etape) { if (!m.has(e.proba_id)) m.set(e.proba_id, []); m.get(e.proba_id).push(e) }
    for (const l of m.values()) l.sort((a, b) => ETAPE.indexOf(a.etapa) - ETAPE.indexOf(b.etapa))
    return m
  }, [etape])
  const ordonate = useMemo(() => ordoneazaProbe(probe), [probe])
  const active = ordonate.filter(p => p.stare === 'activ')
  const anulate = ordonate.filter(p => p.stare !== 'activ')
  const ac = useMemo(() => acoperire(probe, eroareTronsoane ? [] : tronsoane), [probe, tronsoane, eroareTronsoane])
  const probaSel = probe.find(p => p.id === selectat) || null
  const etapaForm = (formEtapa && etape.find(e => e.id === formEtapa.id)) || null

  const deschide = fn => { ctx.current += 1; setMesaj(null); fn() }
  const inchideForm = () => { ctx.current += 1; setMesaj(null); setFormProba(null); setFormEtapa(null); setFormAnulare(null) }

  // rândurile întoarse de server, doar pe proiectul curent
  const aplicaRezultat = r => {
    if (r?.proba?.proiect_id === proiectId) setProbe(l => aplicaRand(l, r.proba))
    if (r?.etapa?.proiect_id === proiectId) setEtape(l => aplicaRand(l, r.etapa))
  }

  // ── L05: lămurirea DEFINITIVĂ a unei cereri nelămurite: o retrimitem IDENTIC (același RPC, payload, cheie). Serverul e idempotent:
  // „duplicat” = se scrisese (sau s-a scris între timp, în altă conexiune); ok = nu ajunsese, s-a aplicat acum, cu valorile de atunci;
  // conflict / refuz al regulilor = nu se aplicase (serverul verifică cheia înaintea lor). Refuzul de DREPT (verificat înaintea cheii) nu
  // dovedește nimic: atunci doar cheia GĂSITĂ în jurnal dovedește că se scrisese; altfel (negăsită sau jurnal necitit) rămâne nelămurită.
  // Iese din registru DOAR la aplicat / aplicat acum / neaplicat.
  // Aceeași regulă pentru ORICE răspuns al unei cereri înregistrate — și pentru PRIMA ei încercare: o copie a aceleiași cereri (aceeași
  // cheie, retrimisă din alt tab) poate fi aplicată oricând, deci un refuz al acestei încercări nu dovedește că cheia nu s-a scris.
  // `prinJurnal` = aplicarea e dovedită doar de jurnal: NU există rezultat RPC (r e null), starea reală vine din reîncărcare. ──
  const rezolva = async (reg, intrare, { r, error }) => {
    let clasa = clasificaReluare({ r, error })
    let prinJurnal = false
    if (clasa === 'fara_drept') {
      let data = null, err2 = null
      try { ({ data, error: err2 } = await client.from('executie_probe_jurnal').select('id').eq('cheie', intrare.cheie).limit(1)) } catch (e) { err2 = e }
      if (err2 || !Array.isArray(data)) clasa = 'necunoscut'
      else if (data.length) { clasa = 'aplicat'; prinJurnal = true }
    }
    // curățarea locală e separată de rezultatul serverului: o ștergere eșuată din stocare se spune, nu se ascunde (intrarea ar reapărea)
    if ((clasa === 'aplicat' || clasa === 'aplicat_acum' || clasa === 'neaplicat') && !reg.scoate(intrare.cheie)) {
      setEroareRegistru('O salvare lămurită nu s-a putut scoate din registrul local al browserului (stocare blocată); va reapărea ca nelămurită — retrimiterea ei e sigură (aceeași cheie).')
    }
    return { intrare, clasa, r: prinJurnal ? null : r, error, prinJurnal }
  }
  const lamureste = async (reg, intrare) => {
    let r = null, error = null
    try { ({ data: r, error } = await client.rpc(intrare.rpc, { ...intrare.payload, p_cheie: intrare.cheie })) } catch (e) { error = e }
    return rezolva(reg, intrare, { r, error })
  }
  const mesajLamurire = ({ clasa, error, prinJurnal }) => ({
    aplicat: prinJurnal ? 'Cererea anterioară SE salvase (confirmat din jurnal; nu mai ai drept de scriere).' : 'Cererea anterioară SE salvase (cu valorile de atunci).',
    aplicat_acum: 'Cererea anterioară nu ajunsese; am trimis-o acum, cu valorile de atunci.',
    neaplicat: error ? `Cererea anterioară nu s-a aplicat (serverul a refuzat-o: ${String(error.message || error).replace(/^probe: /, '')}).`
      : 'Cererea anterioară nu s-a salvat (între timp s-a schimbat starea).',
    fara_drept: 'Cererea anterioară nu se poate lămuri acum: nu mai ai drept de scriere pe Execuție (rămâne de verificat).',
    necunoscut: `Cererea anterioară e tot fără rezultat sigur (${error?.message || error || 'fără răspuns valid'}).`,
  }[clasa])
  const ramaneNelamurita = x => x.clasa === 'necunoscut' || x.clasa === 'fara_drept'

  // bannerul: toate cererile nelămurite ale utilizatorului pe acest proiect (din orice tab, rămase de data trecută etc.)
  const lamuresteToate = async () => {
    const pg = proiectCtx.current, reg = registru.current
    if (!reg) return
    const valid = () => montat.current && pg === proiectCtx.current
    const lista = reg.toate()
    if (lista === null) { setMesaj({ ok: false, text: 'Registrul local nu se poate citi acum; reîncearcă.' }); return }
    setInCurs(true); setMesaj(null); setRenunta(false)
    const rezultate = []
    for (const x of lista) {
      const rez = await lamureste(reg, x)
      if (!valid()) return
      rezultate.push(rez); aplicaRezultat(rez.r)
    }
    setInCurs(false); recitesteNelamurite(reg); setJurnalKey(k => k + 1)
    incarca({ silentios: true })
    setMesaj({ ok: !rezultate.some(ramaneNelamurita),
      text: rezultate.length ? rezultate.map(mesajLamurire).join(' ') + ' Verifică starea în listă.' : 'Nimic de lămurit.' })
  }
  // renunțarea EXPLICITĂ la verificarea cererilor rămase (decizia omului, după confirmare): rezultatul lor nu se mai verifică
  const renuntaLaVerificare = () => {
    const reg = registru.current
    if (!reg) return
    const lista = reg.toate()
    setRenunta(false)
    if (lista === null) { setMesaj({ ok: false, text: 'Registrul local nu se poate citi acum; nu am scos nimic. Reîncearcă.' }); return }
    for (const x of lista) reg.scoate(x.cheie)
    const ramase = reg.toate()
    recitesteNelamurite(reg)
    if (ramase === null || ramase.length) {
      setMesaj({ ok: false, text: `Nu am putut scoate toate salvările din registrul local (${ramase === null ? 'registru necitibil' : `rămase: ${ramase.length}`}); vor reapărea. Reîncearcă.` })
      return
    }
    setMesaj({ ok: true, text: 'Am renunțat la verificarea salvărilor nelămurite. Verifică starea în listă și în jurnal.' })
  }

  // ── execuția unui RPC cu cheie de idempotență (L04 / L05 / L24) ──
  // 1. Dacă pe aceeași țintă există cereri nelămurite (din acest tab, din altul sau de data trecută), întâi se lămuresc TOATE prin
  //    retrimitere identică; o cerere nouă pleacă abia când niciuna nu mai e nelămurită. Dacă una dintre ele e chiar intenția de acum
  //    (aceeași cerere, reapăsată), rezultatul ei definitiv e rezultatul apăsării.
  // 2. O cerere nouă primește o cheie nouă, scrisă DURABIL în registru ÎNAINTE de trimitere (scriere eșuată = nu se trimite) și scoasă
  //    doar la un rezultat definitiv — pe registrul capturat la pornire, deci și după o schimbare de proiect.
  // Efectele asupra datelor se aplică doar dacă proiectul (și componenta) sunt aceleași ca la pornire; cele asupra formularului (mesaj,
  // închidere) doar dacă și formularul e același (`actual`). Întoarce { r, actual } sau null.
  const executa = async (tinta, rpc, payload) => {
    const g = ctx.current, pg = proiectCtx.current, reg = registru.current
    const valid = () => montat.current && pg === proiectCtx.current
    if (!reg) { setMesaj({ ok: false, text: 'Salvarea locală nu e pregătită încă (sau stocarea browserului nu e disponibilă); nu trimit nimic.' }); return null }
    const vechi = reg.pentruTinta(tinta)
    if (vechi === null) { setMesaj({ ok: false, text: 'Registrul local nu se poate citi acum; nu trimit nimic. Reîncearcă.' }); return null }
    if (vechi.length) {
      setInCurs(true); setMesaj(null)
      const rezultate = []
      for (const x of vechi) {
        const rez = await lamureste(reg, x)
        if (!valid()) return null
        rezultate.push(rez); aplicaRezultat(rez.r)
      }
      setInCurs(false); recitesteNelamurite(reg)
      if (rezultate.some(x => x.r?.ok)) setJurnalKey(k => k + 1)
      const actual = g === ctx.current
      const aceeasi = rezultate.length === 1 && aceeasiIntentie(rezultate[0].intrare, rpc, payload) ? rezultate[0] : null
      if (aceeasi && (aceeasi.clasa === 'aplicat' || aceeasi.clasa === 'aplicat_acum')) {
        incarca({ silentios: true })
        if (aceeasi.r?.ok) return { r: aceeasi.r, actual }   // reapăsarea aceleiași cereri: acum e lămurită și salvată
        // dovedită doar de jurnal (fără rezultat RPC): nu se presupune niciun rând; starea reală vine din reîncărcare
        if (actual) setMesaj({ ok: true, text: mesajLamurire(aceeasi) + ' Reîncarc starea din listă.' })
        return null
      }
      if (!rezultate.some(ramaneNelamurita)) incarca({ silentios: true })
      if (actual) {
        setMesaj({ ok: false, text: rezultate.map(mesajLamurire).join(' ') + (rezultate.some(ramaneNelamurita)
          ? ' Noua schimbare se poate trimite abia după ce o lămurim: reîncearcă „Salvează” peste câteva secunde.'
          : aceeasi ? ' Am adus starea actuală — verifică și reîncearcă.' : ' Verifică, apoi confirmă din nou noua schimbare.') })
      }
      return null
    }
    const cheie = cheieNoua()
    const intrare = { tinta, rpc, cheie, payload, pusLa: new Date().toISOString() }
    if (!reg.pune(intrare)) {
      setMesaj({ ok: false, text: 'Nu pot păstra local cererea (stocarea browserului e plină sau blocată), deci nu o trimit: un rezultat nelămurit s-ar pierde. Eliberează spațiu în browser și reîncearcă.' })
      return null
    }
    setInCurs(true); setMesaj(null)
    let r = null, error = null
    try { ({ data: r, error } = await client.rpc(rpc, { ...payload, p_cheie: cheie })) } catch (e) { error = e }
    // aceeași clasificare ca la retrimitere (cererea poate fi retrimisă concurent din alt tab, cu aceeași cheie): iese din registru doar
    // la un rezultat dovedit; registrul se actualizează și dacă între timp s-a schimbat proiectul
    const rez = await rezolva(reg, intrare, { r, error })
    if (!valid()) return null    // alt proiect / pagina închisă: niciun alt efect
    setInCurs(false); recitesteNelamurite(reg)
    const actual = g === ctx.current
    if (rez.clasa === 'aplicat' || rez.clasa === 'aplicat_acum') {
      setJurnalKey(k => k + 1)
      incarca({ silentios: true })   // etapele unui tronson nou, compoziția, starea celorlalți
      if (rez.r?.ok) { aplicaRezultat(rez.r); return { r: rez.r, actual } }
      // dovedită doar de jurnal (o copie din alt tab a fost aplicată; aici a venit un refuz de drept): fără rând presupus
      if (actual) setMesaj({ ok: true, text: 'Salvarea s-a făcut (confirmată din jurnal; între timp ți s-a schimbat dreptul de scriere). Reîncarc starea din listă.' })
      return null
    }
    if (rez.clasa === 'neaplicat') {
      aplicaRezultat(r)
      if (actual) setMesaj({ ok: false, text: error ? String(error.message || error).replace(/^probe: /, '')
        : 'S-a schimbat între timp (alt utilizator sau altă apăsare). Am adus starea actuală — verifică și reîncearcă.' })
      return null
    }
    // necunoscut / fără drept nedovedit: cererea rămâne în registru, de lămurit
    if (actual) {
      setMesaj({ ok: false, text: rez.clasa === 'fara_drept'
        ? String(error?.message || error).replace(/^probe: /, '') + ' Cererea rămâne de verificat (o copie a ei ar fi putut fi trimisă din alt tab).'
        : error && esteRefuzDeterminist(error)
          ? String(error.message || error).replace(/^probe: /, '') + ' Apasă din nou „Salvează” peste câteva secunde (aceeași cerere).'
          : 'Nu se știe dacă s-a salvat (' + (error?.message || error || 'răspuns gol') + '). Apasă din nou „Salvează” fără să schimbi nimic; dacă schimbi ceva, întâi verific ce s-a întâmplat.' })
    }
    return null
  }

  const salveazaProba = async ({ proba, cod, deLa, panaLa, denumire, observatii }) => {
    const payload = payloadProba({ proiectId, proba, cod, deLa, panaLa, denumire, observatii })
    const x = await executa(proba ? `proba:${proba.id}` : 'nou', 'fn_executie_proba_salveaza', payload)
    if (x?.actual && x.r?.proba) { inchideForm(); setSelectat(x.r.proba.id); setMesaj({ ok: true, text: x.r.duplicat ? 'Era deja salvat.' : 'Salvat.' }) }
  }
  const anuleaza = async (proba, motiv) => {
    const payload = Object.freeze({ p_id: proba.id, p_versiune: proba.versiune, p_motiv: motiv.trim() || null })
    const x = await executa(`anulare:${proba.id}`, 'fn_executie_proba_anuleaza', payload)
    if (x?.actual && x.r?.ok) { inchideForm(); setSelectat(null); setMesaj({ ok: true, text: `${proba.cod} anulat.` }) }
  }
  const salveazaEtapa = async (et, form) => {
    const x = await executa(`etapa:${et.id}`, 'fn_executie_proba_etapa', payloadEtapa(et, form))
    if (x?.actual && x.r?.ok) { inchideForm(); setMesaj({ ok: true, text: x.r.duplicat ? 'Era deja salvat.' : 'Salvat.' }) }
  }

  if (!incarcat && !eroare) return <Cadru><div style={{ color: G.dim, padding: 30, textAlign: 'center' }}>Se încarcă…</div></Cadru>
  if (eroare) return <Cadru><Alerta text={eroare} /><button onClick={() => incarca()} style={{ ...S.btn, marginTop: 10, minHeight: 44 }}>Reîncearcă</button></Cadru>

  return (
    <Cadru>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: G.text }}>🧪 Probe pe tronsoane</div>
        <button onClick={() => incarca()} style={{ ...S.btn, marginLeft: 'auto', padding: '6px 12px', fontSize: 13, minHeight: 40 }}>↻ Reîncarcă</button>
      </div>
      {eroareDrept && <Alerta text={eroareDrept} />}
      {eroareReimprospatare && <Alerta text={eroareReimprospatare} galben />}
      {eroareRegistru && <Alerta text={eroareRegistru} />}
      {nrNelamurite > 0 && !formProba && !formEtapa && !formAnulare && (
        <div style={{ margin: '8px 0', padding: '9px 12px', borderRadius: 10, background: G.yellow + '1F', color: G.yellow, fontSize: 13, fontWeight: 600 }}>
          ⚠ {nrNelamurite === 1 ? 'O salvare are' : `${nrNelamurite} salvări au`} rezultat nelămurit (de exemplu fără semnal, sau pagina închisă înainte de răspuns).
          <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button disabled={inCurs} onClick={lamuresteToate} style={{ ...S.btn, minHeight: 44 }}>{inCurs ? 'Se verifică…' : 'Lămurește acum'}</button>
            {!renunta
              ? <button disabled={inCurs} onClick={() => setRenunta(true)} style={{ ...S.btn, minHeight: 44, color: G.muted }}>Renunță la verificare</button>
              : <button disabled={inCurs} onClick={renuntaLaVerificare} style={{ ...S.btn, minHeight: 44, color: G.red }}>Sigur? Rezultatul lor nu se mai verifică — da, renunț</button>}
          </div>
        </div>
      )}
      {eroareTronsoane && <Alerta text={eroareTronsoane} galben />}
      {!poateScrie && !eroareDrept && <div style={{ fontSize: 12, color: G.muted, marginBottom: 8 }}>Doar citire: completările le fac cei cu drept de scriere pe Execuție.</div>}
      {mesaj && !probaSel && !formProba && !formEtapa && !formAnulare && <Mesaj m={mesaj} />}

      <Banda probe={active} tronsoane={eroareTronsoane ? [] : tronsoane} ac={ac} etapePeProba={etapePeProba} selectat={selectat} onAlege={id => deschide(() => setSelectat(id))} />
      <Sumar ac={ac} tronsoane={tronsoane} eroareTronsoane={eroareTronsoane} />

      {poateScrie && (
        <button onClick={() => deschide(() => setFormProba({ proba: null }))} style={{ ...S.btn, width: '100%', minHeight: 48, margin: '10px 0', background: G.blue, color: '#0D1117', border: 'none' }}>
          ＋ Tronson de probă nou
        </button>
      )}
      {!active.length && <div style={{ color: G.muted, padding: '16px 4px', fontSize: 14 }}>Niciun tronson de probă pe acest proiect{poateScrie ? ' — adaugă primul cu butonul de mai sus.' : '.'}</div>}
      <div style={{ display: 'grid', gap: 10 }}>
        {active.map(p => (
          <CardProba key={p.id} p={p} etape={etapePeProba.get(p.id) || []} tronsoane={tronsoane} faraTronsoane={!!eroareTronsoane}
            selectat={p.id === selectat} onDeschide={() => deschide(() => setSelectat(p.id))} />
        ))}
      </div>
      {anulate.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <button onClick={() => setArataAnulate(x => !x)} style={{ ...S.btn, fontSize: 13, minHeight: 40 }}>{arataAnulate ? '▾' : '▸'} Anulate ({anulate.length})</button>
          {arataAnulate && <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
            {anulate.map(p => (
              <button key={p.id} onClick={() => deschide(() => setSelectat(p.id))} style={{ ...S.btn, textAlign: 'left', opacity: 0.75, minHeight: 44 }}>
                <b>{p.cod}</b> · {fmtInterval(p.km_de_la_m, p.km_pana_la_m)} · anulat: {p.motiv_anulare}
              </button>
            ))}
          </div>}
        </div>
      )}

      {probaSel && !formProba && !formEtapa && !formAnulare && (
        <FisaProba p={probaSel} etape={etapePeProba.get(probaSel.id) || []} tronsoane={tronsoane} faraTronsoane={!!eroareTronsoane}
          poateScrie={poateScrie} client={client} jurnalKey={jurnalKey} mesaj={mesaj}
          onInchide={() => { ctx.current += 1; setSelectat(null); setMesaj(null) }}
          onEtapa={id => deschide(() => setFormEtapa({ id, laDeschidere: etape.find(e => e.id === id) || null }))}
          onModifica={() => deschide(() => setFormProba({ proba: probaSel }))}
          onAnuleaza={() => deschide(() => setFormAnulare(probaSel.id))} />
      )}
      {formProba && (
        // baza formularului = rândul CURENT din listă (după un conflict are versiunea nouă); câmpurile scrise de om rămân în formular
        <FormProba proba={formProba.proba ? (probe.find(p => p.id === formProba.proba.id) || formProba.proba) : null} probaLaDeschidere={formProba.proba}
          probe={probe} tronsoane={tronsoane} faraTronsoane={!!eroareTronsoane} busy={inCurs} nepregatit={!registruGata} mesaj={mesaj}
          onSalveaza={salveazaProba} onInchide={inchideForm} />
      )}
      {etapaForm && (
        <FormEtapa et={etapaForm} laDeschidere={formEtapa.laDeschidere} proba={probe.find(p => p.id === etapaForm.proba_id)} azi={azi} busy={inCurs} nepregatit={!registruGata} mesaj={mesaj}
          client={client} proiectId={proiectId} onSalveaza={f => salveazaEtapa(etapaForm, f)} onInchide={inchideForm} />
      )}
      {formAnulare != null && probe.find(p => p.id === formAnulare) && (
        <FormAnulare proba={probe.find(p => p.id === formAnulare)} busy={inCurs} nepregatit={!registruGata} mesaj={mesaj} onAnuleaza={anuleaza} onInchide={inchideForm} />
      )}
    </Cadru>
  )
}

// ── banda traseului: sus probele (culoarea = starea), hașurat = neacoperit; jos tronsoanele de execuție ──
function Banda({ probe, tronsoane, ac, etapePeProba, selectat, onAlege }) {
  const idHasura = 'h' + useId().replace(/[^a-zA-Z0-9]/g, '')
  if (!(ac.pana_la > ac.de_la)) return null
  const W = 1000, H = 104
  const x = m => ((m - ac.de_la) / (ac.pana_la - ac.de_la)) * W
  const w = (a, b) => Math.max(0, x(b) - x(a))
  const { valide } = tronsoaneCuKm(tronsoane)
  return (
    <div style={{ background: G.surface, border: `1px solid ${G.border2}`, borderRadius: 12, padding: '10px 8px 6px', marginBottom: 6 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }} role="img" aria-label="Banda traseului: probe și tronsoane">
        <defs>
          <pattern id={idHasura} width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="14" height="14" fill={G.red + '22'} /><line x1="0" y1="0" x2="0" y2="14" stroke={G.red} strokeWidth="4" />
          </pattern>
        </defs>
        {ac.neacoperit.map((g, i) => <rect key={'g' + i} x={x(g.de_la)} y={4} width={w(g.de_la, g.pana_la)} height={42} fill={`url(#${idHasura})`} />)}
        {probe.map(p => {
          const st = stareProba(etapePeProba.get(p.id) || [])
          const lat = w(p.km_de_la_m, p.km_pana_la_m)
          return (
            <g key={p.id} onClick={() => onAlege(p.id)} style={{ cursor: 'pointer' }}>
              <rect x={x(p.km_de_la_m) + 1} y={4} width={Math.max(2, lat - 2)} height={42} rx={5}
                fill={STARE_PROBA[st].culoare + (p.id === selectat ? 'FF' : 'BB')} stroke={p.id === selectat ? G.text : 'none'} strokeWidth={3} />
              {lat > 46 && <text x={x(p.km_de_la_m) + lat / 2} y={33} textAnchor="middle" fontSize={24} fontWeight={800} fill="#0D1117">{p.cod}</text>}
            </g>
          )
        })}
        {valide.map((t, i) => (
          <g key={t.id ?? t.cod}>
            <rect x={x(t.de_la)} y={54} width={w(t.de_la, t.pana_la)} height={16} fill={i % 2 ? G.border : '#3D444D'} />
            {w(t.de_la, t.pana_la) > 38 && <text x={x(t.de_la) + w(t.de_la, t.pana_la) / 2} y={94} textAnchor="middle" fontSize={22} fill={G.muted}>{t.cod}</text>}
          </g>
        ))}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: G.dim, padding: '0 2px' }}>
        <span>km {fmtKm(ac.de_la)}</span><span>km {fmtKm(ac.pana_la)}</span>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 11, color: G.muted, marginTop: 4 }}>
        {['gata', 'in_lucru', 'refacere', 'neinceput'].map(k => (
          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><i style={{ width: 10, height: 10, borderRadius: 3, background: STARE_PROBA[k].culoare, display: 'inline-block' }} />{STARE_PROBA[k].eticheta}</span>
        ))}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><i style={{ width: 10, height: 10, borderRadius: 3, background: G.red + '66', border: `1px solid ${G.red}`, display: 'inline-block' }} />Fără probă</span>
      </div>
    </div>
  )
}

function Sumar({ ac, tronsoane, eroareTronsoane }) {
  if (eroareTronsoane) return null
  const { faraKm } = tronsoaneCuKm(tronsoane)
  const arata = ac.neacoperit.slice(0, 6)
  // procentul doar pe un traseu cunoscut (total > 0); altfel necunoscut, nu „100%” (L18)
  const pct = Number.isFinite(ac.total) && ac.total > 0 ? Math.round((ac.acoperit / ac.total) * 1000) / 10 : null
  return (
    <div style={{ fontSize: 13, color: G.muted, lineHeight: 1.5 }}>
      {pct != null
        ? <div>Acoperit de probe: <b style={{ color: G.text }}>{fmtLungime(ac.acoperit)}</b> din {fmtLungime(ac.total)} ({String(pct).replace('.', ',')}%)</div>
        : <div>Tronsoanele de execuție nu au km: lungimea traseului e necunoscută, deci procentul acoperit nu se poate calcula{ac.acoperit > 0 ? ` (probele însumează ${fmtLungime(ac.acoperit)})` : ''}.</div>}
      {arata.length > 0 && <div>Fără probă: {arata.map(g => `${fmtKm(g.de_la)}–${fmtKm(g.pana_la)}`).join(', ')}{ac.neacoperit.length > arata.length ? ` și încă ${ac.neacoperit.length - arata.length}` : ''}</div>}
      {ac.inAfara.length > 0 && <div style={{ color: G.yellow }}>⚠ Probe în afara tronsoanelor cunoscute: {ac.inAfara.map(g => `${fmtKm(g.de_la)}–${fmtKm(g.pana_la)}`).join(', ')}</div>}
      {faraKm.length > 0 && <div style={{ color: G.yellow }}>⚠ Tronsoane fără km (nu intră în calcul): {faraKm.join(', ')}</div>}
    </div>
  )
}

function ChipEtapa({ e }) {
  const c = culoareStare(e?.stare)
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 9px', borderRadius: 999, fontSize: 12, fontWeight: 700,
      background: c + '22', border: `1px solid ${c}`, color: G.text, whiteSpace: 'nowrap' }}>
      <span style={{ color: c }}>{ICON_STARE[e?.stare] || '?'}</span>{ETICHETE_ETAPA[e?.etapa] || e?.etapa}
    </span>
  )
}

function CardProba({ p, etape, tronsoane, faraTronsoane, selectat, onDeschide }) {
  const st = stareProba(etape)
  const comp = faraTronsoane ? null : compozitie(p.km_de_la_m, p.km_pana_la_m, tronsoane)
  const pc = presiuneCurenta(etape)
  return (
    <div role="button" tabIndex={0} onClick={onDeschide} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onDeschide() } }}
      style={{ ...S.btn, textAlign: 'left', padding: 12, display: 'block', width: '100%', boxSizing: 'border-box', borderColor: selectat ? G.blue : G.border, borderWidth: selectat ? 2 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 20, fontWeight: 900 }}>{p.cod}</span>
        <span style={{ fontSize: 13, color: G.muted }}>{fmtInterval(p.km_de_la_m, p.km_pana_la_m)} · {fmtLungime(p.km_pana_la_m - p.km_de_la_m)}</span>
        <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 800, color: STARE_PROBA[st].culoare }}>{STARE_PROBA[st].eticheta}</span>
      </div>
      {p.denumire && <div style={{ fontSize: 13, color: G.text, marginTop: 2 }}>{p.denumire}</div>}
      {comp && <div style={{ fontSize: 13, color: G.text, marginTop: 4 }}>{comp.text || 'pe niciun tronson de execuție cunoscut'}</div>}
      {comp?.neacoperit.length > 0 && <div style={{ fontSize: 12, color: G.yellow }}>⚠ în afara tronsoanelor: {comp.neacoperit.map(g => `${fmtKm(g.de_la)}–${fmtKm(g.pana_la)}`).join(', ')}</div>}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
        {ETAPE.map(x => <ChipEtapa key={x} e={etape.find(e => e.etapa === x) || { etapa: x, stare: null }} />)}
      </div>
      {pc && (
        <div style={{ marginTop: 8, fontSize: 15, fontWeight: 800, color: pc.stare === 'in_curs' ? G.blue : G.text }}>
          🧭 {fmtBar(pc.bar)}{pc.proba != null ? <span style={{ fontWeight: 600, color: G.muted, fontSize: 13 }}> (probă {fmtBar(pc.proba)})</span> : null}
          <span style={{ fontWeight: 600, color: G.muted, fontSize: 12 }}> · citită {fmtOra(pc.la)}</span>
        </div>
      )}
    </div>
  )
}

// ── fișa unui tronson de probă: compoziția, etapele (cu buton de completare), jurnalul în ordine ──
function FisaProba({ p, etape, tronsoane, faraTronsoane, poateScrie, client, jurnalKey, mesaj, onInchide, onEtapa, onModifica, onAnuleaza }) {
  const [jurnal, setJurnal] = useState(null)
  const [eroareJurnal, setEroareJurnal] = useState(null)
  useEffect(() => {
    let viu = true
    setJurnal(null); setEroareJurnal(null)
    pagini(client, 'executie_probe_jurnal', COL_JURNAL, q => q.eq('proba_id', p.id))
      .then(r => { if (viu) setJurnal(r) }, e => { if (viu) setEroareJurnal('Jurnalul nu se poate citi: ' + (e?.message || e)) })
    return () => { viu = false }
  }, [p.id, jurnalKey, client])
  const comp = faraTronsoane ? null : compozitie(p.km_de_la_m, p.km_pana_la_m, tronsoane)
  const peId = useMemo(() => new Map(etape.map(e => [e.id, e])), [etape])
  const activ = p.stare === 'activ'
  return (
    <Foaie titlu={`${p.cod} · ${fmtInterval(p.km_de_la_m, p.km_pana_la_m)}`} onInchide={onInchide}>
      {mesaj && <Mesaj m={mesaj} />}
      {!activ && <Alerta text={`Anulat: ${p.motiv_anulare}`} galben />}
      <div style={{ fontSize: 14, color: G.text }}>{fmtLungime(p.km_pana_la_m - p.km_de_la_m)}{p.denumire ? ` · ${p.denumire}` : ''}</div>
      {comp && (
        <div style={{ margin: '8px 0', fontSize: 13, color: G.muted }}>
          <div style={{ color: G.text, fontWeight: 700 }}>{comp.text || 'pe niciun tronson de execuție cunoscut'}</div>
          {comp.bucati.map(b => <div key={b.cod + b.de_la}>{b.cod}: {fmtKm(b.de_la)} → {fmtKm(b.pana_la)} ({fmtLungime(b.lungime)}{b.integral ? ', tot tronsonul' : ` din ${fmtLungime(b.lungimeTronson)}`})</div>)}
          {comp.neacoperit.length > 0 && <div style={{ color: G.yellow }}>⚠ în afara tronsoanelor: {comp.neacoperit.map(g => `${fmtKm(g.de_la)}–${fmtKm(g.pana_la)}`).join(', ')}</div>}
        </div>
      )}
      {p.observatii && <div style={{ fontSize: 13, color: G.muted, whiteSpace: 'pre-wrap', marginBottom: 6 }}>{p.observatii}</div>}

      <div style={{ display: 'grid', gap: 8, margin: '10px 0' }}>
        {ETAPE.map(x => {
          const e = etape.find(y => y.etapa === x)
          if (!e) return <Alerta key={x} text={`Etapa „${ETICHETE_ETAPA[x]}” lipsește`} />
          return <RandEtapa key={x} e={e} poateScrie={poateScrie && activ} onEtapa={() => onEtapa(e.id)} />
        })}
      </div>

      {poateScrie && activ && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <button onClick={onModifica} style={{ ...S.btn, minHeight: 44 }}>✎ Modifică intervalul</button>
          <button onClick={onAnuleaza} style={{ ...S.btn, minHeight: 44, color: G.red }}>Anulează</button>
        </div>
      )}

      <div style={{ fontSize: 13, fontWeight: 800, color: G.text, margin: '6px 0' }}>Jurnal</div>
      {eroareJurnal && <Alerta text={eroareJurnal} />}
      {!jurnal && !eroareJurnal && <div style={{ fontSize: 12, color: G.dim }}>Se încarcă…</div>}
      {jurnal && !jurnal.length && <div style={{ fontSize: 12, color: G.dim }}>Nicio operație.</div>}
      {jurnal && jurnal.map(j => (
        <div key={j.id} style={{ borderLeft: `3px solid ${j.stare_noua ? culoareStare(j.stare_noua) : G.border}`, padding: '4px 8px', marginBottom: 6, fontSize: 13 }}>
          <div style={{ color: G.dim, fontSize: 11 }}>{j.data_operatie ? fmtZi(j.data_operatie) + ' · ' : ''}scris {fmtOra(j.creat_la)}</div>
          <div style={{ color: G.text }}>{textJurnal(j, peId)}</div>
        </div>
      ))}
    </Foaie>
  )
}

/** Valorile unei etape, pe scurt (fișa și avertismentul de conflict din formular). */
function detaliiEtapa(e) {
  const detalii = []
  if (e.data_start) detalii.push(`început ${fmtZi(e.data_start)}`)
  if (e.data_final) detalii.push(`gata ${fmtZi(e.data_final)}`)
  if (e.nr_treceri != null) detalii.push(`${e.nr_treceri} treceri`)
  if (e.punct_roua_c != null) detalii.push(`rouă ${String(e.punct_roua_c).replace('.', ',')} °C`)
  if (e.placa) detalii.push(PLACI[e.placa] || e.placa)
  if (e.fluid) detalii.push(FLUIDE[e.fluid] || e.fluid)
  if (e.presiune_proba_bar != null) detalii.push(`probă ${fmtBar(e.presiune_proba_bar)}`)
  if (e.presiune_curenta_bar != null) detalii.push(`acum ${fmtBar(e.presiune_curenta_bar)} (${fmtOra(e.presiune_curenta_la)})`)
  if (e.durata_ore != null) detalii.push(`${String(e.durata_ore).replace('.', ',')} h`)
  if (e.probe_calc_id != null) detalii.push(`legată de proba #${e.probe_calc_id} din Probe`)
  if (e.rezultat) detalii.push(`rezultat: ${e.rezultat}`)
  if (e.motiv) detalii.push(`motiv: ${e.motiv}`)
  return detalii
}
function RandEtapa({ e, poateScrie, onEtapa }) {
  const c = culoareStare(e.stare)
  const detalii = detaliiEtapa(e)
  return (
    <div style={{ background: G.surface, border: `1px solid ${G.border2}`, borderLeft: `4px solid ${c}`, borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <b style={{ fontSize: 14 }}>{ETICHETE_ETAPA[e.etapa]}</b>
        <span style={{ fontSize: 12, fontWeight: 800, color: c }}>{ICON_STARE[e.stare] || '?'} {ETICHETE_STARE[e.stare] || e.stare}</span>
        {poateScrie && stariUrmatoare(e.stare).length > 0 && (
          <button onClick={onEtapa} style={{ ...S.btn, marginLeft: 'auto', padding: '8px 12px', fontSize: 13, minHeight: 44 }}>
            {e.etapa === 'presiune' && e.stare === 'in_curs' ? '🧭 Citire / actualizare' : 'Completează'}
          </button>
        )}
      </div>
      {detalii.length > 0 && <div style={{ fontSize: 12, color: G.muted, marginTop: 4 }}>{detalii.join(' · ')}</div>}
      {e.observatii && <div style={{ fontSize: 12, color: G.muted, whiteSpace: 'pre-wrap' }}>{e.observatii}</div>}
    </div>
  )
}

// ── formularul unei etape (pasul, data, valorile etapei, motivul când e cerut) ──
// pasul propus: citirea pe o probă de presiune în curs, corectura pe o etapă făcută (nu „de refăcut”), altfel primul pas înainte
function pasImplicit(et) {
  const urm = stariUrmatoare(et.stare)
  return (et.stare === 'in_curs' && et.etapa === 'presiune') || et.stare === 'facut' ? et.stare : (urm.find(s => s !== et.stare) || urm[0])
}
const dataImplicita = (et, pas, azi) => (et.stare === 'facut' && pas === 'facut' && et.data_final ? et.data_final : azi)

function FormEtapa({ et, laDeschidere, proba, azi, busy, nepregatit, mesaj, client, proiectId, onSalveaza, onInchide }) {
  const urm = stariUrmatoare(et.stare)
  const [stareNoua, setStareNoua] = useState(() => pasImplicit(et))
  const [data, setData] = useState(() => dataImplicita(et, pasImplicit(et), azi))
  const [f, setF] = useState(() => formularDinEtapa(et))
  // versiunea pe care se bazează formularul: după un conflict, `et` (rândul curent) are altă versiune -> avertisment cu valorile de pe
  // server; „Salvează” ar scrie valorile din formular peste ele, iar „Ia valorile de pe server” reface formularul din rândul curent
  const [baza, setBaza] = useState(() => (laDeschidere || et).versiune)
  const schimbatPeServer = et.versiune !== baza
  const iaDePeServer = () => { const p = pasImplicit(et); setStareNoua(p); setData(dataImplicita(et, p, azi)); setF(formularDinEtapa(et)); setBaza(et.versiune) }
  const [calcule, setCalcule] = useState(null)
  const [eroareCalcule, setEroareCalcule] = useState(null)
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  useEffect(() => {
    if (et.etapa !== 'presiune') return undefined
    let viu = true
    // keyset pe id (L23); cele mai noi primele în listă
    pagini(client, 'probe_calcule', 'id, tronson_id, tip_fluid, presiune_bar, lungime_m, status, data_executie', q => q.eq('proiect_id', proiectId))
      .then(d => { if (viu) setCalcule([...d].reverse()) },
        e => { if (viu) setEroareCalcule('Probele din modulul Probe nu se pot citi (' + (e?.message || e) + ').') })
    return () => { viu = false }
  }, [et.etapa, proiectId, client])

  const goale = faraValori(stareNoua)
  // valorile etapei se trimit doar când pasul le are; observațiile mereu; motivul doar când e cerut (altfel nu se vede, deci nu se trimite)
  const v = { ...valoriDinFormular(et.etapa, goale ? { obs: f.obs } : f), motiv: cereMotiv(et.stare, stareNoua) ? (f.motiv.trim() || null) : null }
  const erori = valideazaEtapa({ etapa: et.etapa, stareVeche: et.stare, stareNoua, data, azi, dataStart: et.data_start, v })
  const campuri = new Set(goale ? [] : CAMPURI[et.etapa])
  const nrInput = (k, eticheta, ajutor) => (
    <label style={{ display: 'block', marginBottom: 10 }}>
      <span style={S.label}>{eticheta}</span>
      <input inputMode="decimal" value={f[k]} onChange={e => set(k, e.target.value)} style={S.input} />
      {ajutor && <span style={{ fontSize: 11, color: G.dim }}>{ajutor}</span>}
    </label>
  )
  const butoane = (k, optiuni) => (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
      {Object.entries(optiuni).map(([val, et2]) => (
        <button key={val} type="button" onClick={() => set(k, f[k] === val ? '' : val)}
          style={{ ...S.btn, minHeight: 44, flex: '1 1 120px', background: f[k] === val ? G.blue : G.surface2, color: f[k] === val ? '#0D1117' : G.text }}>{et2}</button>
      ))}
    </div>
  )
  const calcSel = f.calc ? Number(f.calc) : null
  return (
    <Foaie titlu={`${proba?.cod || ''} · ${ETICHETE_ETAPA[et.etapa]}`} onInchide={onInchide}>
      <div style={{ fontSize: 13, color: G.muted, marginBottom: 8 }}>Acum: <b style={{ color: culoareStare(et.stare) }}>{ETICHETE_STARE[et.stare]}</b></div>
      {schimbatPeServer && (
        <div style={{ margin: '8px 0', padding: '9px 12px', borderRadius: 10, background: G.yellow + '1F', color: G.yellow, fontSize: 13, fontWeight: 600 }}>
          Între timp etapa s-a schimbat pe server: acum e „{ETICHETE_STARE[et.stare] || et.stare}”{detaliiEtapa(et).length ? ` · ${detaliiEtapa(et).join(' · ')}` : ''}.
          {' '}Valorile tale de mai jos au rămas; „Salvează” le scrie peste cele de pe server.
          <div style={{ marginTop: 8 }}>
            <button type="button" onClick={iaDePeServer} style={{ ...S.btn, minHeight: 44 }}>Ia valorile de pe server</button>
          </div>
        </div>
      )}
      <span style={S.label}>Pasul</span>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        {urm.map(s => (
          <button key={s} type="button" onClick={() => setStareNoua(s)}
            style={{ ...S.btn, minHeight: 44, flex: '1 1 140px', background: stareNoua === s ? culoareStare(s) : G.surface2, color: stareNoua === s ? '#0D1117' : G.text }}>
            {etichetaActiune(et.stare, s)}
          </button>
        ))}
      </div>
      <label style={{ display: 'block', marginBottom: 10 }}>
        <span style={S.label}>Data operației</span>
        <input type="date" value={data} max={azi} onChange={e => setData(e.target.value)} style={S.input} />
      </label>
      {/* citirea de pe șantier (proba în curs): presiunea curentă vine prima */}
      {campuri.has('pcur') && et.stare === 'in_curs' && nrInput('pcur', 'Presiunea curentă citită acum (bar)', 'Ora citirii o pune serverul la salvare.')}
      {campuri.has('nr') && nrInput('nr', 'Număr de treceri (total)')}
      {campuri.has('roua') && nrInput('roua', 'Punct de rouă (°C, dacă s-a măsurat)', 'ex. -20,5')}
      {campuri.has('placa') && <><span style={S.label}>Placa de calibrare</span>{butoane('placa', PLACI)}</>}
      {campuri.has('fluid') && <><span style={S.label}>Fluidul de probă</span>{butoane('fluid', FLUIDE)}</>}
      {campuri.has('pproba') && nrInput('pproba', 'Presiunea de probă (bar)')}
      {campuri.has('pcur') && et.stare !== 'in_curs' && nrInput('pcur', 'Presiunea curentă citită acum (bar)', 'Ora citirii o pune serverul la salvare.')}
      {campuri.has('durata') && nrInput('durata', 'Durata probei (ore)')}
      {campuri.has('calc') && (
        <label style={{ display: 'block', marginBottom: 10 }}>
          <span style={S.label}>Legătură cu proba din modulul Probe (opțional; PV-ul rămâne acolo)</span>
          <select value={f.calc} onChange={e => set('calc', e.target.value)} style={S.input}>
            <option value="">— fără legătură —</option>
            {calcSel != null && !(calcule || []).some(c => c.id === calcSel) && <option value={String(calcSel)}>Proba #{calcSel} (detaliile nu se văd)</option>}
            {(calcule || []).map(c => (
              <option key={c.id} value={String(c.id)}>#{c.id} · {c.tip_fluid || '?'} · {fmtBar(c.presiune_bar)} · {c.lungime_m != null ? fmtLungime(Number(c.lungime_m)) + ' · ' : ''}{c.status}{c.data_executie ? ' · ' + fmtZi(c.data_executie) : ''}</option>
            ))}
          </select>
          {eroareCalcule && <span style={{ fontSize: 11, color: G.yellow }}>{eroareCalcule}</span>}
          {calcule && !calcule.length && <span style={{ fontSize: 11, color: G.dim }}>Nicio probă în modulul Probe pe acest proiect.</span>}
        </label>
      )}
      {!goale && (
        <label style={{ display: 'block', marginBottom: 10 }}>
          <span style={S.label}>Rezultat (opțional)</span>
          <input value={f.rez} onChange={e => set('rez', e.target.value)} style={S.input} maxLength={300} />
        </label>
      )}
      <label style={{ display: 'block', marginBottom: 10 }}>
        <span style={S.label}>Observații</span>
        <textarea value={f.obs} onChange={e => set('obs', e.target.value)} rows={2} style={{ ...S.input, resize: 'vertical' }} maxLength={2000} />
      </label>
      {cereMotiv(et.stare, stareNoua) && (
        <label style={{ display: 'block', marginBottom: 10 }}>
          <span style={S.label}>Motiv (obligatoriu)</span>
          <input value={f.motiv} onChange={e => set('motiv', e.target.value)} style={S.input} maxLength={500} />
        </label>
      )}
      {erori.length > 0 && <ul style={{ margin: '0 0 10px', paddingLeft: 18, color: G.yellow, fontSize: 13 }}>{erori.map(x => <li key={x}>{x}</li>)}</ul>}
      {mesaj && <Mesaj m={mesaj} />}
      <button disabled={busy || nepregatit || erori.length > 0} onClick={() => onSalveaza({ stareNoua, data, v })}
        style={{ ...S.btn, width: '100%', minHeight: 50, background: erori.length ? G.surface2 : G.green, color: erori.length ? G.muted : '#0D1117', border: 'none', opacity: busy ? 0.6 : 1 }}>
        {busy ? 'Se salvează…' : 'Salvează'}
      </button>
    </Foaie>
  )
}

// ── formularul unui tronson de probă: cod, km (10+400 sau metri), previzualizarea compoziției, suprapunerile ──
function FormProba({ proba, probaLaDeschidere, probe, tronsoane, faraTronsoane, busy, nepregatit, mesaj, onSalveaza, onInchide }) {
  const schimbatPeServer = !!proba && !!probaLaDeschidere && proba.versiune !== probaLaDeschidere.versiune
  const [cod, setCod] = useState(proba?.cod || codUrmator(probe))
  const [deLaTxt, setDeLaTxt] = useState(proba ? fmtKm(proba.km_de_la_m) : '')
  const [panaLaTxt, setPanaLaTxt] = useState(proba ? fmtKm(proba.km_pana_la_m) : '')
  const [denumire, setDenumire] = useState(proba?.denumire || '')
  const [observatii, setObservatii] = useState(proba?.observatii || '')
  const deLa = parseKm(deLaTxt), panaLa = parseKm(panaLaTxt)
  const erori = valideazaProba({ cod, deLa, panaLa, denumire, observatii })
  const ok = erori.length === 0
  const supr = ok ? suprapuneri(deLa, panaLa, probe, proba?.id ?? null) : []
  const comp = ok && !faraTronsoane ? compozitie(deLa, panaLa, tronsoane) : null
  const neschimbat = proba && cod.trim().toUpperCase() === proba.cod && deLa === proba.km_de_la_m && panaLa === proba.km_pana_la_m
    && (denumire.trim() || null) === (proba.denumire || null) && (observatii.trim() || null) === (proba.observatii || null)
  const camp = (eticheta, val, setVal, extra = {}) => (
    <label style={{ display: 'block', marginBottom: 10, flex: '1 1 140px' }}>
      <span style={S.label}>{eticheta}</span>
      <input value={val} onChange={e => setVal(e.target.value)} style={S.input} {...extra} />
    </label>
  )
  return (
    <Foaie titlu={proba ? `Modifică ${proba.cod}` : 'Tronson de probă nou'} onInchide={onInchide}>
      {schimbatPeServer && (
        <Alerta galben text={`Între timp tronsonul s-a schimbat: acum e ${proba.cod}${proba.stare !== 'activ' ? ' (anulat)' : ''}, ${fmtInterval(proba.km_de_la_m, proba.km_pana_la_m)}. Valorile tale de mai jos au rămas; „Salvează” le scrie peste versiunea nouă.`} />
      )}
      {camp('Cod', cod, setCod, { autoCapitalize: 'characters', maxLength: 6 })}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {camp('De la km', deLaTxt, setDeLaTxt, { placeholder: '10+000', inputMode: 'text' })}
        {camp('Până la km', panaLaTxt, setPanaLaTxt, { placeholder: '14+000', inputMode: 'text' })}
      </div>
      <div style={{ fontSize: 11, color: G.dim, marginTop: -6, marginBottom: 10 }}>Scrie „10+400” sau metri de la origine („10400”). Capetele se pot atinge cu alt tronson de probă.</div>
      {camp('Denumire (opțional)', denumire, setDenumire, { maxLength: 200 })}
      <label style={{ display: 'block', marginBottom: 10 }}>
        <span style={S.label}>Observații</span>
        <textarea value={observatii} onChange={e => setObservatii(e.target.value)} rows={2} style={{ ...S.input, resize: 'vertical' }} maxLength={2000} />
      </label>
      {ok && (
        <div style={{ fontSize: 13, color: G.muted, marginBottom: 10 }}>
          <div><b style={{ color: G.text }}>{fmtLungime(panaLa - deLa)}</b> · {fmtInterval(deLa, panaLa)}</div>
          {comp && <div style={{ color: G.text }}>{comp.text || 'pe niciun tronson de execuție cunoscut'}</div>}
          {comp?.neacoperit.length > 0 && <div style={{ color: G.yellow }}>⚠ în afara tronsoanelor: {comp.neacoperit.map(g => `${fmtKm(g.de_la)}–${fmtKm(g.pana_la)}`).join(', ')}</div>}
          {faraTronsoane && <div style={{ color: G.yellow }}>Compoziția nu se poate calcula (tronsoanele nu s-au citit).</div>}
        </div>
      )}
      {supr.length > 0 && <Alerta text={`Se suprapune cu ${supr.map(p => `${p.cod} (${fmtKm(p.km_de_la_m)}–${fmtKm(p.km_pana_la_m)})`).join(', ')}`} />}
      {erori.length > 0 && (deLaTxt || panaLaTxt) && <ul style={{ margin: '0 0 10px', paddingLeft: 18, color: G.yellow, fontSize: 13 }}>{erori.map(x => <li key={x}>{x}</li>)}</ul>}
      {mesaj && <Mesaj m={mesaj} />}
      <button disabled={busy || nepregatit || !ok || supr.length > 0 || neschimbat} onClick={() => onSalveaza({ proba, cod, deLa, panaLa, denumire, observatii })}
        style={{ ...S.btn, width: '100%', minHeight: 50, background: ok && !supr.length && !neschimbat ? G.green : G.surface2, color: ok && !supr.length && !neschimbat ? '#0D1117' : G.muted, border: 'none', opacity: busy ? 0.6 : 1 }}>
        {busy ? 'Se salvează…' : 'Salvează'}
      </button>
    </Foaie>
  )
}

function FormAnulare({ proba, busy, nepregatit, mesaj, onAnuleaza, onInchide }) {
  const [motiv, setMotiv] = useState('')
  return (
    <Foaie titlu={`Anulează ${proba.cod}`} onInchide={onInchide}>
      <div style={{ fontSize: 13, color: G.muted, marginBottom: 10 }}>
        {fmtInterval(proba.km_de_la_m, proba.km_pana_la_m)}. Intervalul și codul se eliberează; etapele și jurnalul rămân de citit la „Anulate”.
      </div>
      <label style={{ display: 'block', marginBottom: 10 }}>
        <span style={S.label}>Motiv (obligatoriu)</span>
        <input value={motiv} onChange={e => setMotiv(e.target.value)} style={S.input} maxLength={500} />
      </label>
      {mesaj && <Mesaj m={mesaj} />}
      <button disabled={busy || nepregatit || !motiv.trim()} onClick={() => onAnuleaza(proba, motiv)}
        style={{ ...S.btn, width: '100%', minHeight: 50, background: motiv.trim() ? G.red : G.surface2, color: motiv.trim() ? '#0D1117' : G.muted, border: 'none', opacity: busy ? 0.6 : 1 }}>
        {busy ? 'Se salvează…' : 'Anulează tronsonul de probă'}
      </button>
    </Foaie>
  )
}

// ── piese comune ──
function Foaie({ titlu, onInchide, children }) {
  const inchide = useRef(onInchide)
  inchide.current = onInchide
  useEffect(() => {
    const tasta = e => { if (e.key === 'Escape') inchide.current() }
    document.addEventListener('keydown', tasta)
    return () => document.removeEventListener('keydown', tasta)
  }, [])
  return (
    <div role="dialog" aria-modal="true" aria-label={titlu} onClick={e => { if (e.target === e.currentTarget) onInchide() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 9000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div style={{ background: G.bg, border: `1px solid ${G.border}`, borderRadius: '16px 16px 0 0', width: '100%', maxWidth: 640, maxHeight: '92vh', overflowY: 'auto', padding: '14px 14px 24px', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, position: 'sticky', top: -14, background: G.bg, padding: '4px 0' }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: G.text, flex: 1 }}>{titlu}</div>
          <button onClick={onInchide} aria-label="Închide" style={{ ...S.btn, minHeight: 44, minWidth: 44, padding: 0 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}
function Cadru({ children }) {
  return <div style={{ padding: '14px 12px 30px', maxWidth: 900, margin: '0 auto', color: G.text }}>{children}</div>
}
function Alerta({ text, galben }) {
  const c = galben ? G.yellow : G.red
  return <div style={{ margin: '8px 0', padding: '9px 12px', borderRadius: 10, background: c + '1F', color: c, fontSize: 13, fontWeight: 600 }}>{text}</div>
}
function Mesaj({ m }) {
  return <div style={{ margin: '8px 0', padding: '9px 12px', borderRadius: 10, background: (m.ok ? G.green : G.red) + '1F', color: m.ok ? G.green : G.red, fontSize: 13, fontWeight: 600 }}>{m.text}</div>
}
