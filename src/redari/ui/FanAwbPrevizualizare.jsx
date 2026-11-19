/* FanAwbPrevizualizare.jsx — FAN Courier pe un lot de plicuire: previzualizarea (ce s-ar trimite pentru fiecare plic și ce lipsește) +
   pașii propune → aprobă → generează → etichete (toate părțile, cu pagina de control) → comandă curier → urmărire → confirmări / retururi,
   plus operațiile procedurii: reconcilierea (cu confirmarea omului), plafonul lotului pilot, anularea AWB-ului, lista de evenimente.
   După primul AWB real (18.11.2026): tariful fiecărui AWB și totalul lotului sunt afișate (gol = „tarif necunoscut”, evidențiat — procedura
   cere oprire); „1. Propune” e dezactivat când nu mai e nimic de propus (starePropunere); „2b. Marchează real” e dezactivat cât garda „doar TEST”
   e pornită (stareMarcajReal); butonul și fișierul etichetelor nu mai afirmă A6 (prima probă a venit A4; formatul se verifică pe PDF).
   oPOD (18.11.2026, 27,16 lei în loc de 13,16 pe primul AWB): bifa „Confirmare de primire în original (oPOD)” e a owner-ului, pe lot, după
   marcaj și înainte de prima aprobare (fn_red_fan_lot_opod; red_fan_loturi.opod, implicit oprit), intră în corp și în hash; dialogul de aprobare
   spune dacă oPOD e cerut și costul estimat; rândul plicului arată „oPOD” și ultimul eveniment de urmărire cu ora României (textUltimEveniment).
   Cât coloana `opod` lipsește (codul publicat înaintea migrării 20261227a), „1. Propune” / „2c. Aprobă” / „3. Generează AWB” sunt dezactivate cu
   motivul lor (citesteEvidentaFan.opodInstalat → stariPasi): nicio aprobare „fără B” înaintea deducerii istorice a migrării; restul merge.
   Cât timp TRANSPORT_REAL_ACTIV = false (redariFanHandler.mjs) TOȚI pașii și TOATE operațiile sunt vizibile și dezactivate, cu „transport
   oprit”; nu se cheamă funcția edge și nu se scrie nimic. Activarea pentru Testul 1 (DOAR_PROIECTE_TEST = true): activ DOAR pe un proiect
   „TEST-…” cu lotul marcat TEST (aceeași gardă ca funcția edge, transportPermis); pe orice alt lot, pașii rămân dezactivați cu motivul.
   Proiectare: docs/redari/FANCOURIER_INTEGRARE.md, docs/redari/FAN_TEST1_PASI.md. Contactul (PII) se citește cu
   JWT-ul omului (RLS: doar admin/editor). Răspunsurile FAN sunt date: ridicarea, reconcilierea și returul le confirmă omul. */
import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { pregatestePlicuriFan, contactPePlic, LIMITA_LOT_PILOT_IMPLICITA, FORMAT_ETICHETA, manifestTiparire, partiManifest, cheieTiraj, idTiraj, tirajDin,
  ASTEPTARE_DUPA_OPRIRE_S, COST_OPOD_ESTIMAT_LEI, citesteLotFan, lipsaColoana } from '../../../supabase/functions/_shared/redariFan.mjs'
import { stariPasi, stareMarcaj, stareMarcajReal, starePropunere, stariOperatii, TRANSPORT_REAL_ACTIV, transportPermis, MESAJ_TRANSPORT_OPRIT, ETICHETE_STARE_FAN, ETICHETE_URMARIRE, ETICHETE_CONFIRMARE,
  prefixLot, titluLot, csvBorderouFan, mesajEdgeFan, numeEtichete, numeControl, controlLotFan, confirmaTirajFinal, stareOprireTiraj, textFapteUrmarire,
  fapteContrazise, optiuniSolutionare, solutioneazaUrmarire, etichetaUrmarire, textTarif, textTotalTarif, totalTarifLot, MESAJ_TARIF_NECUNOSCUT,
  stareOpod, TEXT_OPOD, opodLot, textAprobare, textUltimEveniment, textOpodRand } from '../fanLot.js'
import { docxPaginaControl } from '../plicuri.js'
import { descarcaBlob } from '../docx.js'
import { G, S, Modal, msgEroare, citestePaginat, etichetaRetur, MOTIVE_RETUR } from './comune.jsx'

export { contactPePlic }   // compatibil cu testele vechi (definiția e în redariFan.mjs, comună cu funcția edge)
const LOT_IN = 100
// runda 4: faptele urmăririi + contradicțiile (Jakarinos #1118 r3 P2)
const COL_FAN = 'id,plic_id,nr_plic,stare,hash_date,awb,tarif,tva,motiv,urmarire_stare,ultim_eveniment,ultim_eveniment_la,ridicat_propus,livrat_la,retur_propus,'
  + 'retur_cunoscut,ridicat_contrazis,livrat_contrazis,retur_contrazis,confirmare_stare,versiune_urmarire'   // runda 5: versiunea = CAS-ul soluționării; 18.11: tva (lângă tarif)
const ETICHETE_RETUR = Object.fromEntries(MOTIVE_RETUR.map(m => [m.cod, etichetaRetur(m.cod)]))
const COST_OPOD_TEXT = `${COST_OPOD_ESTIMAT_LEI} lei`   // 18.11: costul estimat al oPOD-ului (oferta), doar în dialoguri
// tabelul FAN lipsește (migrarea neaplicată) ≠ eroare de citire (L18)
export const lipsaTabel = e => ['PGRST205', '42P01'].includes(e?.code) || /does not exist|could not find the table/i.test(e?.message || '')

// coloana lipsește (migrarea 20261227a neaplicată încă) ≠ eroare de citire: evidența rămâne citibilă, alegerea oPOD e „neinstalată” (opod: null);
// definiția e în redariFan.mjs (comună cu funcția edge, L19), re-exportată pentru testele vechi
export { lipsaColoana }
const COL_LOT = 'lot_id,test,prima_aprobare_la,tiraj_cheie,tiraj_nr,tiraj_la,tiraj_oprit_la'

/** Evidența FAN a unui lot, citită cu JWT-ul omului: { instalata, fanLot, randuri, limita, opodInstalat }. Tabel lipsă = neinstalată; altă eroare =
 *  aruncată (L18). fanLot.opod (18.11.2026): alegerea oPOD a lotului (boolean); null = coloana nu e instalată încă (bifa dezactivată) — aceeași
 *  citire ca în funcția edge (citesteLotFan). opodInstalat (runda 3) = coloana `opod` există, confirmat de citire (și pe un lot nemarcat, fără
 *  rând); cât e false, ecranul nu propune / nu aprobă / nu generează (stariPasi). Folosită și de ecranul Plicuri (arhiva documentelor). */
export async function citesteEvidentaFan(client, lotId, esteCurent = () => true) {
  try {
    const randuri = await citestePaginat(() => client.from('red_fan_awb').select(COL_FAN).eq('lot_id', lotId), { cheie: 'id', esteCurent })
    const { data: fl, error: e1, opodInstalat } = await citesteLotFan(coloane => client.from('red_fan_loturi').select(coloane).eq('lot_id', lotId).maybeSingle(), COL_LOT)
    if (e1) throw e1
    const { data: st, error: e2 } = await client.from('red_fan_setari').select('limita_lot').maybeSingle()
    if (e2) throw e2
    return { instalata: true, randuri, fanLot: fl || null, limita: st?.limita_lot ?? null, opodInstalat: opodInstalat === true }
  } catch (e) { if (lipsaTabel(e)) return { instalata: false, randuri: [], fanLot: null, limita: null, opodInstalat: false }; throw e }
}

// convocariPePlic = convocările pe plic din ecranul Plicuri (aceleași citiri ca arhiva documentelor): numărul documentelor pe pagina de control
export default function FanAwbPrevizualizare({ proiect, lot, plicuri, convocariPePlic = {}, esteOwner = false, esteAdmin = false, poateScrie = false, onClose, onRetur }) {
  const [randuri, setRanduri] = useState(null), [fan, setFan] = useState(null), [eroare, setEroare] = useState(''), [mesaj, setMesaj] = useState('')
  const [lucru, setLucru] = useState(false), [reload, setReload] = useState(0)
  const [dataRec, setDataRec] = useState(''), [propuneri, setPropuneri] = useState(null), [plafonNou, setPlafonNou] = useState('')
  // runda 5: formularul de soluționare a unei contradicții — rândul EXACT văzut (valori + versiune), alegerile și motivul; unul odată
  const [sol, setSol] = useState(null)
  const gen = useRef(0), ocupat = useRef(false)
  // L24 (Jakarinos #1118 r1 P2): acțiunile au generația lor + lotul pentru care au pornit; schimbarea lotului / închiderea le invalidează
  const genActiune = useRef(0), lotCurent = useRef(lot.id)
  const active = (plicuri || []).filter(p => p.stare === 'activ')
  const cheie = active.map(p => p.id).join(',')   // lista nouă la fiecare randare a părintelui → efectul depinde de id-uri, nu de referință
  useEffect(() => {
    lotCurent.current = lot.id; genActiune.current++; ocupat.current = false
    setLucru(false); setMesaj(''); setPropuneri(null); setPlafonNou(''); setSol(null)
    return () => { genActiune.current++ }
  }, [lot.id])
  useEffect(() => {
    const token = ++gen.current, curent = () => gen.current === token
    setRanduri(null); setEroare('')
    ;(async () => {
      const ids = active.map(p => p.id)
      const conv = []
      for (let i = 0; i < ids.length; i += LOT_IN) conv.push(...await citestePaginat(() => supabase.from('red_convocari').select('id,plic_id,detinator_id')
        .in('plic_id', ids.slice(i, i + LOT_IN)).eq('stare', 'activ').is('sters_la', null), { cheie: 'id', esteCurent: curent }))
      const det = [...new Set(conv.map(c => c.detinator_id))]
      const cont = []
      for (let i = 0; i < det.length; i += LOT_IN) cont.push(...await citestePaginat(() => supabase.from('red_detinatori_contact')
        .select('detinator_id,telefon,adresa_strada,adresa_sat,adresa_comuna,adresa_judet,cod_postal').in('detinator_id', det.slice(i, i + LOT_IN)), { cheie: 'detinator_id', esteCurent: curent }))
      const stare = await citesteEvidentaFan(supabase, lot.id, curent)   // evidența FAN (după migrare): rândurile, marcajul, oPOD-ul, plafonul
      // corpurile (și hash-urile) se construiesc cu alegerea oPOD a lotului CITITĂ acum: ce se propune / aprobă = ce va pleca (aceeași funcție ca în edge)
      const pregatite = await pregatestePlicuriFan({ plicuri: active, convocari: conv, contacte: cont, proiectCod: proiect.cod, opod: opodLot(stare.fanLot) })
      if (!curent()) return
      setRanduri(pregatite); setFan(stare)
    })().catch(e => { if (curent()) setEroare(msgEroare(e)) })
    return () => { gen.current++ }
  }, [proiect.cod, lot.id, cheie, reload])   // eslint-disable-line react-hooks/exhaustive-deps

  const awb = fan?.randuri || []
  const pePlic = new Map(awb.filter(r => !['eroare', 'anulat'].includes(r.stare)).map(r => [r.plic_id, r]))
  const gata = randuri?.filter(r => r.ok).length ?? 0
  // 18.11.2026: DE PROPUS = plicurile gata FĂRĂ rând FAN viu cu datele de acum (starePropunere, aceeași definiție ca în simulatorul procedurii)
  const propunere = starePropunere({ pregatite: randuri || [], randuri: awb })
  // garda „doar TEST” (aceeași ca în funcția edge): proiectul lotului + marcajul lui; marcajul cere doar proiectul de TEST
  const st = { transportActiv: TRANSPORT_REAL_ACTIV, evidentaInstalata: !!fan?.instalata, esteOwner, esteAdmin, randuri: awb, fanLot: fan?.fanLot, proiectCod: proiect?.cod }
  // runda 3: fără coloana opod (migrarea 20261227a neaplicată) nu se propune / aprobă / generează — doar ce e confirmat de citire trece
  const pasi = stariPasi({ ...st, poateScrie, gataDePropus: propunere.dePropus.length, motivPropunere: propunere.motiv, opodInstalat: fan?.opodInstalat === true })
  const operatii = stariOperatii(st)
  const marcajTest = stareMarcaj(st), marcajReal = stareMarcajReal(st)   // 18.11: „real” e oprit cât garda „doar TEST” e pornită
  const opodSt = stareOpod(st)   // 18.11: alegerea oPOD (owner, după marcaj, înainte de prima aprobare)
  const permis = transportPermis({ proiectCod: proiect?.cod, fanLot: fan?.fanLot })
  const AJUTOR_MARCAJ = 'doar owner-ul, înainte de prima aprobare: lot de TEST sau lot real'
  const AJUTOR_OPOD = 'doar owner-ul, după marcaj și înainte de prima aprobare: confirmarea de primire se întoarce în original (cost suplimentar pe plic); implicit oprit = confirmarea electronică de pe terminalul curierului'
  const pas = k => (k === 'marcaj_test' ? { ...marcajTest, cheie: k, titlu: 'Marcaj TEST', ajutor: AJUTOR_MARCAJ }
    : k === 'marcaj_real' ? { ...marcajReal, cheie: k, titlu: 'Marcaj real', ajutor: AJUTOR_MARCAJ }
    : k === 'opod' ? { ...opodSt, cheie: k, titlu: 'oPOD', ajutor: AJUTOR_OPOD }
    : pasi.find(p => p.cheie === k) || operatii.find(p => p.cheie === k))
  const tarifLot = totalTarifLot(awb)
  // manifestul COMUN (aceeași funcție ca funcția edge și arhiva documentelor): mulțimea și ordinea etichetelor
  const manifest = manifestTiparire({ randuri: awb, plicuri })
  const parti = partiManifest(manifest.tiparite)
  // runda 3: cheia tirajului pentru manifestul de acum (afișată lângă tirajul început; „Tiraj nou” o folosește), calculată asincron
  const [cheieAcum, setCheieAcum] = useState(null)
  useEffect(() => {
    let viu = true
    setCheieAcum(null)
    if (manifest.tiparite.length) cheieTiraj(manifest).then(c => { if (viu) setCheieAcum(c) }).catch(() => { if (viu) setCheieAcum(null) })
    return () => { viu = false }
  }, [manifest.cheie])   // eslint-disable-line react-hooks/exhaustive-deps
  const tirajInceput = fan?.fanLot?.tiraj_cheie ? { id: idTiraj(fan.fanLot.tiraj_cheie), nr: fan.fanLot.tiraj_nr, cheie: fan.fanLot.tiraj_cheie } : null
  // runda 4: ceasul ecranului pentru cele 30 s de după oprire (doar afișare; BD-ul impune cu ora lui), pornit doar cât tirajul e oprit
  const [acum, setAcum] = useState(() => Date.now())
  const opritLa = fan?.fanLot?.tiraj_oprit_la || null
  useEffect(() => {
    if (!opritLa) return undefined
    setAcum(Date.now())
    const t = setInterval(() => setAcum(Date.now()), 1000)
    return () => clearInterval(t)
  }, [opritLa])

  // garda unei acțiuni: generația + lotul de la pornire; fiecare apel dintr-o buclă o verifică ÎNAINTE (L24)
  async function executa(cheiePas, fn) {
    if (ocupat.current || !pas(cheiePas)?.activ) return   // dublă gardă: butonul e dezactivat, iar funcția refuză oricum
    const token = genActiune.current, lotId = lot.id
    const curent = () => genActiune.current === token && lotCurent.current === lotId
    ocupat.current = true; setLucru(true); setMesaj('')
    try { const m = await fn(curent); if (curent()) setMesaj(m || 'Operație încheiată.') }
    catch (e) { if (curent()) setMesaj(`Eroare: ${msgEroare(e)}. Reîncarcă evidența înainte de reluare.`) }
    finally { if (curent()) { ocupat.current = false; setLucru(false); setReload(n => n + 1) } }
  }
  const OPRIT = 'Oprit: lotul s-a schimbat sau ecranul s-a închis; reîncarcă evidența.'
  async function edge(actiune, extra = {}) {
    const rez = await supabase.functions.invoke('redari-fan-awb', { body: { actiune, lot_id: lot.id, ...extra } })
    let corp = rez.data
    if (rez.error && typeof rez.error.context?.json === 'function') { try { corp = await rez.error.context.json() } catch { corp = null } }
    return { corp, mesaj: mesajEdgeFan({ data: corp, error: corp ? null : rez.error }) }
  }
  // o buclă de RPC-uri pe rânduri: generația verificată înaintea FIECĂRUI apel; oprirea e raportată, nu tăcută
  async function bucla(curent, lista, apel, eticheta) {
    let n = 0; const erori = []
    for (const x of lista) {
      if (!curent()) return `${OPRIT} Făcute înainte de oprire: ${n}.`
      const { error } = await apel(x)
      if (error) erori.push(`${x.nr_plic || x.plic?.nr_plic}: ${msgEroare(error)}`); else n++
    }
    return `${eticheta}: ${n}; erori: ${erori.length}. ${erori.join('; ')}`
  }
  // 18.11: se trimit DOAR plicurile de propus (nu și cele deja propuse / aprobate cu același hash: RPC-ul le-ar readuce la „propus”)
  const propune = () => executa('propune', curent => bucla(curent, propunere.dePropus,
    r => supabase.rpc('fn_red_fan_propune', { p_plic_id: r.plic.id, p_hash: r.hash, p_tarif_estimat: null }), 'Propuse'))
  const marcheaza = test => executa(test ? 'marcaj_test' : 'marcaj_real', async curent => {
    if (!window.confirm(test ? `Marchezi ${lot.nr_lot} ca LOT DE TEST? AWB-urile lui nu vor fi expedieri ale convocărilor.` : `Marchezi ${lot.nr_lot} ca lot REAL (convocări cu efect juridic)?`)) return 'Nimic schimbat.'
    if (!curent()) return OPRIT
    const { error } = await supabase.rpc('fn_red_fan_lot_marcheaza', { p_lot_id: lot.id, p_test: test }); if (error) throw error
    return test ? 'Lot marcat: TEST.' : 'Lot marcat: real.'
  })
  // 18.11: alegerea oPOD a lotului (owner, după marcaj, înainte de prima aprobare): RPC-ul refuză după prima aprobare; schimbarea = alte corpuri /
  // hash-uri → plicurile deja propuse se re-propun (ecranul le arată „datele s-au schimbat după propunere”)
  const schimbaOpod = cere => executa('opod', async curent => {
    if (!window.confirm(cere ? `Ceri oPOD pentru ${lot.nr_lot}: confirmarea de primire semnată se întoarce în ORIGINAL, cu cost suplimentar estimat de ${COST_OPOD_TEXT} pe plic? Plicurile deja propuse trebuie propuse din nou.`
      : `Renunți la oPOD pentru ${lot.nr_lot}: confirmarea de primire rămâne cea electronică, de pe terminalul curierului (fără cost suplimentar)? Plicurile deja propuse trebuie propuse din nou.`)) return 'Nimic schimbat.'
    if (!curent()) return OPRIT
    const { data, error } = await supabase.rpc('fn_red_fan_lot_opod', { p_lot_id: lot.id, p_opod: cere }); if (error) throw error
    if (data !== cere) throw new Error('rezultat neconfirmat')
    return cere ? 'oPOD cerut pe lot: confirmarea de primire în original (+ cost pe plic). Propune din nou plicurile.' : 'Fără oPOD pe lot: confirmarea electronică a curierului. Propune din nou plicurile.'
  })
  const aproba = () => executa('aproba', async curent => {
    const h = new Map(randuri.filter(r => r.ok).map(r => [r.plic.id, r.hash]))
    const propuse = awb.filter(r => r.stare === 'propus' && h.get(r.plic_id) === r.hash_date)
    if (!propuse.length) return 'Niciun plic propus cu datele de acum: propune din nou.'
    // dialogul spune dacă oPOD e cerut și costul estimat suplimentar, DIN corpurile care se aprobă (ce intră în hash), nu din rândul lotului
    const ids = new Set(propuse.map(r => r.plic_id))
    const t = textAprobare({ n: propuse.length, shipments: randuri.filter(r => ids.has(r.plic.id)).map(r => r.shipment), titlu: titluLot(lot, fan.fanLot) })
    if (!t.ok) return t.text
    if (!window.confirm(t.text)) return 'Nimic aprobat.'
    if (!curent()) return OPRIT
    const { data, error } = await supabase.rpc('fn_red_fan_aproba', { p_lot_id: lot.id, p_ids: propuse.map(r => r.id), p_hashuri: propuse.map(r => r.hash_date) })
    if (error) throw error
    return `Aprobate: ${data}.`
  })
  const genereaza = () => executa('genereaza', async curent => {
    if (!window.confirm(`Generezi AWB-urile aprobate pentru ${titluLot(lot, fan.fanLot)}? Se plătesc.`)) return 'Nimic trimis.'
    if (!curent()) return OPRIT
    const { corp, mesaj } = await edge('genereaza')
    return corp?.cod === 'ok' ? `Generate: ${corp.generat}; respinse: ${corp.eroare}; necunoscute: ${corp.necunoscut}; rămase: ${corp.ramase}.${corp.asociere_pe_pozitie ? ` Asociate pe poziție (de verificat în selfAWB): ${corp.asociere_pe_pozitie}.` : ''}${corp.oprit ? ' Oprit: ' + corp.oprit : ''}` : mesaj
  })
  // pagina de control: ACEEAȘI funcție și aceleași intrări ca arhiva documentelor (controlLotFan: manifest + plicuri + convocări + tirajul din BD)
  const paginaControl = tiraj => docxPaginaControl(controlLotFan({ lot, fanLot: fan?.fanLot, manifest, plicuri, convocariPePlic, tiraj }).continut)
  const etichete = parte => executa('etichete', async curent => {
    if (!curent()) return OPRIT
    const { corp, mesaj } = await edge('eticheta', { parte, manifest_cheie: manifest.cheie })
    if (corp?.cod !== 'ok' || typeof corp.pdf_base64 !== 'string') return mesaj
    if (!curent()) return OPRIT
    // runda 3: tirajul vine din BD (verificat de funcția edge) și trebuie să fie al manifestului afișat; altfel nimic descărcat
    const tiraj = corp.manifest_cheie === manifest.cheie && cheieAcum ? tirajDin({ stare: 'acelasi', cheie: corp.tiraj?.cheie, nr: corp.tiraj?.nr, inceput_la: corp.tiraj?.inceput_la }, cheieAcum) : null
    if (!tiraj) return 'Tirajul din răspuns nu corespunde manifestului afișat: nimic descărcat. Reîncarcă evidența.'
    const bin = atob(corp.pdf_base64), bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    let control = null
    if (corp.parte === 1) { control = await paginaControl(tiraj); if (!curent()) return OPRIT }   // L24: generația reverificată după await
    // runda 4 (Jakarinos #1118 r3 P1): funcția edge a reverificat tirajul după PDF; ecranul îl reverifică încă o dată ÎNAINTE de salvare
    // (după pagina de control): oprit / înlocuit între timp = nimic descărcat
    await confirmaTirajFinal({ rpc: (n, a) => supabase.rpc(n, a), lot, tiraj })
    if (!curent()) return OPRIT
    descarcaBlob(new Blob([bytes], { type: 'application/pdf' }), numeEtichete({ lot, fanLot: fan.fanLot, parte: corp.parte, parti: corp.parti, tiraj }))
    if (control) descarcaBlob(control, numeControl({ lot, fanLot: fan.fanLot, tiraj }))
    // 18.11: formatul cerut curierului e A6, dar prima probă a venit A4 → mesajul nu afirmă formatul; omul îl verifică pe PDF înainte de tipărire
    return `Etichete PDF, tirajul ${tiraj.id}: ${corp.nr_plicuri.length} plicuri (pozițiile ${corp.pozitii[0]}…${corp.pozitii.at(-1)})${corp.parti > 1 ? `, partea ${corp.parte} din ${corp.parti}` : ''}.${corp.ramase?.length ? ` Rămase netipărite: ${corp.ramase.join(', ')}.` : ''} Formatul paginii (cerut: ${FORMAT_ETICHETA}) se verifică pe PDF înainte de tipărire.`
  })
  // „Tiraj nou” (owner), runda 4 (Jakarinos #1118 r3 P1) — procedura în ordine, impusă de BD: (1) OPREȘTE descărcările tirajului început
  // (nicio descărcare a lui nu se mai termină, nici cele începute); (2) așteaptă 30 s; (3) distruge foile ȘI fișierele descărcate ale tirajului;
  // (4) ÎNLOCUIEȘTE tirajul cu manifestul de acum (CAS pe cheia veche; BD-ul refuză fără oprire / înainte de 30 s). „Reia” = renunțare, fără tiraj nou.
  const oprire = stareOprireTiraj(fan?.fanLot, acum)
  const opresteTiraj = () => executa('tiraj', async curent => {
    if (!tirajInceput) return 'Niciun tiraj început: prima descărcare (etichete sau arhiva documentelor) îl începe.'
    if (!window.confirm(`Oprești descărcările tirajului ${tirajInceput.id} (nr. ${tirajInceput.nr})? Din acest moment nicio descărcare a lui nu se mai termină, nici cele începute deja. `
      + `Pasul următor: după ${ASTEPTARE_DUPA_OPRIRE_S} de secunde, adună și DISTRUGE toate foile tirajului ${tirajInceput.id} (etichete, pagina de control, documente) și ȘTERGE fișierele lui descărcate, inclusiv cele primite chiar acum; abia apoi „Înlocuiește tirajul”.`)) return 'Nimic schimbat.'
    if (!curent()) return OPRIT
    const { data, error } = await supabase.rpc('fn_red_fan_tiraj_opreste', { p_lot_id: lot.id, p_cheie: tirajInceput.cheie, p_opreste: true })
    if (error) throw error
    if (data?.stare !== 'oprit' || data?.cheie !== tirajInceput.cheie) throw new Error('rezultat neconfirmat')
    return `Descărcările tirajului ${tirajInceput.id} sunt OPRITE. Așteaptă ${ASTEPTARE_DUPA_OPRIRE_S} de secunde, distruge foile și fișierele lui, apoi „Înlocuiește tirajul”.`
  })
  const reiaTiraj = () => executa('tiraj', async curent => {
    if (!tirajInceput || !oprire.oprit) return 'Descărcările nu sunt oprite.'
    if (!window.confirm(`Reiei descărcările tirajului ${tirajInceput.id} (nr. ${tirajInceput.nr}), FĂRĂ tiraj nou? Foile lui rămân valabile doar dacă nu le-ai distrus deja.`)) return 'Nimic schimbat.'
    if (!curent()) return OPRIT
    const { data, error } = await supabase.rpc('fn_red_fan_tiraj_opreste', { p_lot_id: lot.id, p_cheie: tirajInceput.cheie, p_opreste: false })
    if (error) throw error
    if (data?.stare !== 'reluat') throw new Error('rezultat neconfirmat')
    return `Descărcările tirajului ${tirajInceput.id} au fost reluate.`
  })
  const inlocuiesteTiraj = () => executa('tiraj', async curent => {
    if (!tirajInceput) return 'Niciun tiraj început: prima descărcare (etichete sau arhiva documentelor) îl începe.'
    if (!cheieAcum) return 'Manifestul de acum nu are plicuri tipăribile.'
    if (cheieAcum === tirajInceput.cheie) return `Manifestul de acum = tirajul ${tirajInceput.id}: nimic de înlocuit.`
    if (!oprire.oprit) return 'Oprește întâi descărcările tirajului început (pasul 1).'
    if (!oprire.gataDeInlocuit) return `Mai așteaptă ${oprire.secundeRamase} s de la oprire, apoi distruge foile și fișierele tirajului ${tirajInceput.id}.`
    if (!window.confirm(`Confirm că: (1) descărcările tirajului ${tirajInceput.id} (nr. ${tirajInceput.nr}) au fost oprite și au trecut cel puțin ${ASTEPTARE_DUPA_OPRIRE_S} de secunde; `
      + `(2) am adunat și am DISTRUS toate foile tirajului ${tirajInceput.id} (etichete, pagina de control, documente) și am ȘTERS fișierele lui descărcate, inclusiv cele primite după oprire. `
      + `Tirajul nou ${idTiraj(cheieAcum)} începe acum; se descarcă din nou TOATE părțile etichetelor și arhiva documentelor.`)) return 'Nimic schimbat.'
    if (!curent()) return OPRIT
    const { data, error } = await supabase.rpc('fn_red_fan_tiraj', { p_lot_id: lot.id, p_cheie: cheieAcum, p_inlocuieste: tirajInceput.cheie })
    if (error) throw error
    const t = tirajDin(data, cheieAcum)
    if (!t) throw new Error('rezultat neconfirmat')
    return `Tirajul nou ${t.id} (nr. ${t.nr}) a început. Descarcă din nou toate părțile etichetelor și arhiva documentelor.`
  })
  const urmarire = () => executa('urmarire', async curent => { if (!curent()) return OPRIT; const { corp, mesaj } = await edge('urmarire')
    return corp?.cod === 'ok' ? `Urmărire actualizată: ${corp.scrise} AWB-uri${corp.pastrate ? `; ${corp.pastrate} fără evenimente noi (informația cunoscută păstrată, doar „verificat”)` : ''}${corp.depasite ? `; ${corp.depasite} depășite de o rulare mai nouă (nescrise)` : ''}.` : mesaj })
  const confirmari = () => executa('confirmari', async curent => { if (!curent()) return OPRIT; const { corp, mesaj } = await edge('confirmari')
    return corp?.cod === 'ok' ? `Confirmări verificate: ${corp.scrise} AWB-uri${corp.depasite ? `; ${corp.depasite} depășite` : ''}.` : mesaj })
  const evenimente = () => executa('evenimente', async curent => { if (!curent()) return OPRIT; const { corp, mesaj } = await edge('evenimente')
    return corp?.cod === 'ok' ? `Coduri lipsă la FAN: ${corp.lipsa_la_fan.join(', ') || '-'}; coduri FAN neclasificate: ${corp.neclasificate.map(c => c.cod).join(', ') || '-'}.` : mesaj })
  // runda 4: o ridicare CONTRAZISĂ (FAN a dat două date) nu se confirmă în bloc: omul o verifică în selfAWB
  const deConfirmatRidicare = awb.filter(r => r.stare === 'generat' && r.ridicat_propus && !r.ridicat_contrazis)
  const confirmaRidicarea = () => executa('urmarire', async curent => {
    const efect = fan.fanLot?.test ? 'Lot de TEST: se marchează doar în evidența FAN.' : 'Lot real: plicurile primesc AWB-ul și data expedierii (pornește termenul de 10 zile).'
    if (!window.confirm(`Confirmi ridicarea de către curier pentru ${deConfirmatRidicare.length} plicuri, la datele evenimentului C0? ${efect}`)) return 'Nimic confirmat.'
    return bucla(curent, deConfirmatRidicare, r => supabase.rpc('fn_red_fan_ridicat', { p_id: r.id, p_data: r.ridicat_propus }), 'Ridicări confirmate')
  })
  // reconcilierea: funcția edge doar PROPUNE; omul confirmă fiecare rând (L05). „De verificat” = nicio confirmare din ecran (selfAWB).
  const reconciliaza = () => executa('reconciliere', async curent => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataRec)) return 'Alege ziua borderoului (ziua generării).'
    if (!curent()) return OPRIT
    const { corp, mesaj } = await edge('reconciliaza', { data: dataRec })
    if (corp?.cod !== 'ok' || !Array.isArray(corp.propuneri)) return mesaj
    if (curent()) setPropuneri({ data: dataRec, complet: corp.complet, neinterpretabile: corp.neinterpretabile || 0, lista: corp.propuneri })
    return `Propuneri: ${corp.propuneri.length}${corp.neinterpretabile ? `; ${corp.neinterpretabile} elemente ale borderoului neinterpretabile: TOATE rândurile rămân de verificat în selfAWB` : ''}.`
  })
  const confirmaReconciliere = p => executa('reconciliere', async curent => {
    const gasit = p.stare === 'gasit'
    if (!gasit && p.stare !== 'lipsa') return 'Rândul e de verificat în selfAWB: nicio confirmare din ecran.'
    if (!window.confirm(gasit ? `Confirmi pentru ${p.nr_plic} AWB-ul ${p.awb}, găsit în borderoul din ${propuneri.data}?`
      : `Confirmi că pentru ${p.nr_plic} NU există niciun AWB în borderoul COMPLET din ${propuneri.data}? Rândul devine „respins” și plicul se poate propune din nou (un AWB nou costă).`)) return 'Nimic confirmat.'
    if (!curent()) return OPRIT
    const { error } = await supabase.rpc('fn_red_fan_reconciliaza', { p_id: p.id, p_awb: gasit ? p.awb : null, p_tarif: null, p_tva: null,
      p_motiv: gasit ? `găsit în borderoul FAN din ${propuneri.data}` : `confirmat absent în borderoul FAN complet din ${propuneri.data}` })
    if (error) throw error
    if (curent()) setPropuneri(x => x && { ...x, lista: x.lista.filter(y => y.id !== p.id) })
    return `${p.nr_plic}: ${gasit ? 'AWB confirmat' : 'absență confirmată'}.`
  })
  const schimbaPlafon = () => executa('plafon', async curent => {
    const n = Number(plafonNou)
    if (!Number.isInteger(n) || n < 1 || n > 2000) return 'Plafonul trebuie să fie un număr întreg între 1 și 2000.'
    if (!window.confirm(`Plafonul lotului pilot devine ${n} plicuri aprobate pe lot (pentru toate loturile)?`)) return 'Nimic schimbat.'
    if (!curent()) return OPRIT
    const { data, error } = await supabase.rpc('fn_red_fan_setari_seteaza', { p_limita: n }); if (error) throw error
    return `Plafonul lotului pilot: ${data}.`
  })
  const stergeAwb = r => executa('anulare', async curent => {
    if (!window.confirm(`Ștergi la FAN AWB-ul ${r.awb} al plicului ${r.nr_plic}? Doar înainte de ridicarea de către curier.`)) return 'Nimic șters.'
    if (!curent()) return OPRIT
    const { corp, mesaj } = await edge('sterge_awb', { rand_id: r.id })
    return corp?.cod === 'ok' ? `AWB șters și anulat: ${corp.anulat}.` : mesaj
  })
  const marcheazaAnulat = r => executa('anulare', async curent => {
    const motiv = window.prompt(`Motivul anulării AWB-ului ${r.awb} (${r.nr_plic}), după verificarea în selfAWB că a fost șters:`, 'șters în selfAWB, verificat')
    if (!motiv || !motiv.trim()) return 'Nimic schimbat.'
    if (!curent()) return OPRIT
    const { error } = await supabase.rpc('fn_red_fan_anulat', { p_id: r.id, p_awb: r.awb, p_motiv: motiv.trim() }); if (error) throw error
    return `${r.nr_plic}: AWB marcat anulat.`
  })
  // runda 5 (Jakarinos #1118 r4 P2): SOLUȚIONAREA unei contradicții (owner / admin Redări). Formularul ține rândul EXACT văzut (valorile +
  // versiunea): BD-ul refuză dacă a sosit între timp un răspuns FAN (RD023). Garda: generația + lotul (executa) și dublu-click (ocupat).
  const deschideSolutionare = r => { if (!lucru && pas('solutionare')?.activ) setSol({ rand: r, alegeri: {}, motiv: '' }) }
  const solutioneaza = () => executa('solutionare', async curent => {
    if (!sol) return 'Nicio contradicție aleasă.'
    const { rand: r, alegeri, motiv } = sol
    const opt = optiuniSolutionare(r, ETICHETE_RETUR)
    const lipsa = opt.filter(o => !alegeri[o.cheie])
    if (lipsa.length) return `Alege valoarea care rămâne pentru: ${lipsa.map(o => o.titlu).join(', ')}.`
    if (!motiv.trim()) return 'Scrie motivul soluționării (ce ai verificat în selfAWB).'
    const ales = opt.map(o => `${o.titlu}: ${o.optiuni.find(x => x.valoare === alegeri[o.cheie]).text}`).join('; ')
    if (!window.confirm(`Soluționezi contradicția pentru ${r.nr_plic} (AWB ${r.awb})? Rămân: ${ales}. Motiv: ${motiv.trim()}. Istoricul (ce era contrazis, alegerea, motivul) rămâne în jurnal.`)) return 'Nimic schimbat.'
    if (!curent()) return OPRIT
    let d
    // RD023 (răspuns FAN nou între timp): formularul cu valorile vechi se închide; se redeschide pe evidența reîncărcată
    try { d = await solutioneazaUrmarire({ rpc: (n, a) => supabase.rpc(n, a), rand: r, alegeri, motiv }) }
    catch (e) { if (curent() && e?.code === 'RD023') setSol(null); throw e }
    if (!curent()) return OPRIT
    setSol(null)
    return `${r.nr_plic}: contradicția soluționată; urmărire: ${ETICHETE_URMARIRE[d.stare] || d.stare}.`
  })
  const borderou = () => descarcaBlob(new Blob([csvBorderouFan({ lot, fanLot: fan?.fanLot, randuri: awb })], { type: 'text/csv;charset=utf-8' }), `${prefixLot(fan?.fanLot)}${lot.nr_lot}_borderou_FAN.csv`)

  const Pas = ({ cheie: k, onClick, children }) => { const p = pas(k)
    return <button style={{ ...S.btnX, opacity: p.activ ? 1 : 0.5 }} disabled={!p.activ || lucru} title={p.activ ? p.ajutor : `${p.ajutor} — ${p.motiv}`} onClick={onClick}>{children || p.titlu}</button> }
  const retururi = awb.filter(r => r.urmarire_stare === 'retur')
  const deVerificat = awb.filter(r => r.urmarire_stare === 'de_verificat')
  const generate = awb.filter(r => r.stare === 'generat')
  return <Modal titlu={`AWB FAN — ${titluLot(lot, fan?.fanLot)}`} onClose={onClose} latime={900}>
    {fan?.fanLot?.test === true && <p role="note" style={{ margin: '0 0 8px', padding: 8, borderRadius: 6, background: G.blueDim, color: G.blue, fontWeight: 700 }}>
      LOT DE TEST: AWB-urile lui nu sunt expedieri ale convocărilor și nu intră în registru, PV sau export. Fișierele lui încep cu „TEST_”.</p>}
    {!TRANSPORT_REAL_ACTIV && <p role="status" style={{ margin: '0 0 8px', padding: 8, borderRadius: 6, background: G.yellowDim, color: G.yellow }}>
      Transport oprit: pașii FAN sunt dezactivați până la activare (acordul proprietarului, migrarea, secretele FAN și publicarea funcției). Nu se trimite și nu se plătește nimic.</p>}
    {TRANSPORT_REAL_ACTIV && !permis.ok && <p role="status" style={{ margin: '0 0 8px', padding: 8, borderRadius: 6, background: G.yellowDim, color: G.yellow }}>
      Activare de TEST (Testul 1): {permis.motiv}. Pe acest lot funcția FAN nu face niciun apel și nu se plătește nimic.</p>}
    {TRANSPORT_REAL_ACTIV && permis.ok && <p role="status" style={{ margin: '0 0 8px', padding: 8, borderRadius: 6, background: G.redDim, color: G.red, fontWeight: 700 }}>
      TRANSPORT REAL PORNIT pe acest lot de TEST: „Generează AWB” trimite expedieri către curier (pe contul configurat în secretele funcției) și fiecare AWB poate costa. Urmează pașii din procedura Testului 1.</p>}
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
      {[...pasi, ...operatii].map(p => <div key={p.cheie} style={{ ...S.card, padding: 8, minWidth: 150, opacity: p.activ ? 1 : 0.6 }}>
        <b style={{ fontSize: 12.5 }}>{p.titlu}</b><div style={{ fontSize: 11.5, color: G.muted }}>{p.ajutor}</div>
        {!p.activ && <div style={{ fontSize: 11.5, color: G.yellow }}>{p.motiv === MESAJ_TRANSPORT_OPRIT ? 'transport oprit' : p.motiv}</div>}
      </div>)}
    </div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
      <Pas cheie="propune" onClick={propune}>1. Propune {propunere.dePropus.length} plicuri</Pas>
      <Pas cheie="marcaj_test" onClick={() => marcheaza(true)}>2a. Marchează TEST</Pas>
      <Pas cheie="marcaj_real" onClick={() => marcheaza(false)}>2b. Marchează real</Pas>
      <label title={opodSt.activ ? AJUTOR_OPOD : `${AJUTOR_OPOD} — ${opodSt.motiv}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12.5, opacity: opodSt.activ ? 1 : 0.6, padding: '0 6px' }}>
        <input type="checkbox" checked={opodLot(fan?.fanLot)} disabled={!opodSt.activ || lucru} onChange={e => schimbaOpod(e.target.checked)} aria-label={TEXT_OPOD} />
        {TEXT_OPOD}{fan?.fanLot && opodLot(fan.fanLot) ? <b style={{ color: G.orange }}> · CERUT</b> : ''}</label>
      <Pas cheie="aproba" onClick={aproba}>2c. Aprobă</Pas>
      <Pas cheie="genereaza" onClick={genereaza} />
      {(parti.length ? parti : [[]]).map((b, i) => <Pas key={i} cheie="etichete" onClick={() => etichete(i + 1)}>
        4. Etichete (PDF){parti.length > 1 ? ` — partea ${i + 1} din ${parti.length} (pozițiile ${b[0].pozitie}…${b.at(-1).pozitie})` : ''}</Pas>)}
      <Pas cheie="urmarire" onClick={urmarire} />
      <Pas cheie="urmarire" onClick={confirmaRidicarea}>6b. Confirmă ridicarea ({deConfirmatRidicare.length})</Pas>
      <Pas cheie="confirmari" onClick={confirmari} />
      <Pas cheie="evenimente" onClick={evenimente}>Lista de evenimente FAN</Pas>
      {fan?.instalata && awb.length > 0 && <button style={S.btnX} disabled={lucru} onClick={borderou}>Borderou FAN (CSV, fără date personale)</button>}
    </div>
    <div style={{ ...S.card, marginBottom: 8 }}>
      <b>Pagina de control</b> — {manifest.tiparite.length} plicuri tipărite (etichete + documente, aceeași ordine){manifest.ramase.length ? `; rămase netipărite: ${manifest.ramase.map(r => r.nr_plic).join(', ')}` : ''}.
      Se descarcă odată cu prima parte a etichetelor și în arhiva documentelor (Loturi → „Documente lot”), identică în ambele.
      <div>Tiraj: {tirajInceput ? <b>{tirajInceput.id} (nr. {tirajInceput.nr})</b> : 'niciun tiraj început (prima descărcare îl începe)'}
        {tirajInceput && cheieAcum && cheieAcum !== tirajInceput.cheie && <span style={{ color: G.red }}> · manifestul de acum ({idTiraj(cheieAcum)}) diferă de tirajul început: descărcările sunt refuzate până la „Tiraj nou” (se retipărește tot lotul)</span>}
        {oprire.oprit && <span style={{ color: G.red, fontWeight: 700 }}> · DESCĂRCĂRI OPRITE{oprire.gataDeInlocuit ? ': distruge foile și fișierele tirajului, apoi înlocuiește' : ` — încă ${oprire.secundeRamase} s, apoi distruge foile și fișierele tirajului`}</span>}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
        <Pas cheie="tiraj" onClick={opresteTiraj}>Tiraj nou — 1. Oprește descărcările</Pas>
        <Pas cheie="tiraj" onClick={inlocuiesteTiraj}>2. Înlocuiește tirajul (după {ASTEPTARE_DUPA_OPRIRE_S} s și distrugerea foilor)</Pas>
        <Pas cheie="tiraj" onClick={reiaTiraj}>Reia descărcările (fără tiraj nou)</Pas>
      </div>
    </div>
    <div style={{ ...S.card, marginBottom: 8, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      <b>Reconciliere</b>
      <input style={S.input} type="date" value={dataRec} disabled={lucru || !pas('reconciliere').activ} onChange={e => setDataRec(e.target.value)} aria-label="Ziua borderoului" />
      <Pas cheie="reconciliere" onClick={reconciliaza}>Reconciliază (borderoul zilei)</Pas>
      {propuneri && <div style={{ width: '100%' }}>
        {propuneri.lista.map(p => <div key={p.id}>{p.nr_plic} · {p.stare === 'gasit' ? `găsit: AWB ${p.awb}` : p.stare === 'lipsa' ? 'nu apare în borderoul complet' : `de verificat în selfAWB: ${p.motiv || ''}`}
          {' '}{p.stare !== 'de_verificat' && <Pas cheie="reconciliere" onClick={() => confirmaReconciliere(p)}>{p.stare === 'gasit' ? 'Confirmă AWB-ul' : 'Confirmă absența'}</Pas>}</div>)}
      </div>}
    </div>
    <div style={{ ...S.card, marginBottom: 8, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      <b>Plafonul lotului pilot:</b> {fan?.limita ?? LIMITA_LOT_PILOT_IMPLICITA} plicuri aprobate pe lot{fan?.instalata ? '' : ' (implicit; evidența FAN nu e instalată încă)'}.
      <input style={{ ...S.input, width: 90 }} type="number" min={1} max={2000} value={plafonNou} disabled={lucru || !pas('plafon').activ} onChange={e => setPlafonNou(e.target.value)} aria-label="Plafon nou" />
      <Pas cheie="plafon" onClick={schimbaPlafon}>Schimbă plafonul</Pas>
    </div>
    <div style={{ ...S.card, marginBottom: 8 }}>
      <b>Anulare AWB (înainte de ridicare)</b>
      {generate.length ? generate.map(r => <div key={r.id}>{r.nr_plic} · AWB {r.awb} <Pas cheie="anulare" onClick={() => stergeAwb(r)}>Șterge la FAN</Pas>
        <Pas cheie="anulare" onClick={() => marcheazaAnulat(r)}>Marchează anulat (verificat în selfAWB)</Pas></div>)
        : <div><Pas cheie="anulare" onClick={() => {}}>Șterge la FAN</Pas> <Pas cheie="anulare" onClick={() => {}}>Marchează anulat</Pas> <span style={{ color: G.muted }}>niciun AWB generat neridicat</span></div>}
    </div>
    <p style={{ fontSize: 12, color: G.muted, margin: '0 0 8px' }}>
      Comanda curierului (pasul 5) se face în selfAWB: o comandă pe zi pentru punctul de lucru, interval de cel puțin 2 ore.
      Înainte de predare, verifică pe fiecare plic, cu pagina de control: poziția și numărul de pe etichetă, prima pagină (opisul) și teancul de documente.</p>
    {eroare && <p role="alert" style={{ color: G.red }}>Nu am putut citi datele: {eroare}</p>}
    {mesaj && <p role="status" style={{ color: G.yellow, whiteSpace: 'pre-wrap' }}>{mesaj}</p>}
    {!randuri && !eroare && <p>Se citesc plicurile…</p>}
    {retururi.length > 0 && <div style={{ ...S.card, borderColor: G.orange, marginBottom: 8 }}>
      <b style={{ color: G.orange }}>Retururi semnalate de FAN ({retururi.length})</b> — se înregistrează de om, cu scanul plicului returnat, din tabelul Plicuri („Retur…”); apar apoi în PV B la „Demersurile de convocare”.
      {retururi.map(r => { const p = plicuri.find(x => x.id === r.plic_id)
        return <div key={r.id}>{r.nr_plic} · AWB {r.awb} · {r.ultim_eveniment || '-'} · propus: {r.retur_propus ? etichetaRetur(r.retur_propus) : 'motiv de ales'}
          {fan?.fanLot?.test ? ' · lot de test: nu se înregistrează pe plic' : p?.data_expediere && !p?.retur && onRetur
            ? <> <button style={S.btnX} disabled={lucru} onClick={() => onRetur(p.id, r.retur_propus, (r.ultim_eveniment_la || '').slice(0, 10))}>Înregistrează returul…</button></> : ''}</div> })}
    </div>}
    {deVerificat.length > 0 && <div style={{ ...S.card, borderColor: G.red, marginBottom: 8 }}>
      <b style={{ color: G.red }}>Urmărire de verificat de om ({deVerificat.length})</b> — răspuns FAN neclar sau CONTRADICȚIE cu un fapt cunoscut: faptele cunoscute rămân
      (nu se șterg și nu se înlocuiesc automat, nici la un răspuns ulterior). Verifică în selfAWB; o contradicție o soluționează owner-ul sau un admin Redări
      cu „Soluționează…” (alegi valoarea care rămâne pentru fiecare fapt, cu motiv); ridicarea / AR-ul / returul pe plic se înregistrează apoi ca de obicei.
      {deVerificat.map(r => <div key={r.id}>{r.nr_plic} · AWB {r.awb} · ultimul eveniment: {r.ultim_eveniment || '-'}{textFapteUrmarire(r, ETICHETE_RETUR) ? ` · ${textFapteUrmarire(r, ETICHETE_RETUR)}` : ''}
        {fapteContrazise(r).length > 0 && sol?.rand.id !== r.id && <> <Pas cheie="solutionare" onClick={() => deschideSolutionare(r)}>Soluționează…</Pas></>}
        {sol?.rand.id === r.id && <div style={{ ...S.card, margin: '4px 0', display: 'grid', gap: 4 }}>
          {optiuniSolutionare(sol.rand, ETICHETE_RETUR).map(o => <div key={o.cheie}><b>{o.titlu}:</b>{' '}
            {o.optiuni.map(x => <label key={x.valoare} style={{ marginRight: 10 }}><input type="radio" name={`sol_${r.id}_${o.cheie}`} disabled={lucru}
              checked={sol.alegeri[o.cheie] === x.valoare} onChange={() => setSol(s => s && s.rand.id === r.id ? { ...s, alegeri: { ...s.alegeri, [o.cheie]: x.valoare } } : s)} /> {x.text}</label>)}</div>)}
          <input style={S.input} maxLength={500} value={sol.motiv} disabled={lucru} placeholder="Motivul (ce ai verificat în selfAWB)" aria-label="Motivul soluționării"
            onChange={e => { const v = e.target.value; setSol(s => s && s.rand.id === r.id ? { ...s, motiv: v } : s) }} />
          <div><Pas cheie="solutionare" onClick={solutioneaza}>Confirmă soluționarea</Pas>{' '}
            <button style={S.btnX} disabled={lucru} onClick={() => setSol(null)}>Renunță</button></div>
        </div>}</div>)}
    </div>}
    {randuri && <>
      <p>{gata} din {randuri.length} plicuri au toate datele cerute de FAN.{fan?.instalata && gata > 0 && !propunere.dePropus.length ? ` ${propunere.motiv[0].toUpperCase()}${propunere.motiv.slice(1)}.` : ''}</p>
      {fan?.instalata && tarifLot.awb > 0 && <p role="status" style={{ margin: '0 0 8px', fontWeight: 700, color: tarifLot.necunoscute ? G.red : G.text }}>
        Tarif FAN pe lot (fără TVA): {textTotalTarif(awb)}</p>}
      <div style={{ display: 'grid', gap: 8 }}>
        {randuri.map(r => { const f = pePlic.get(r.plic.id)
          const tarif = f?.awb ? textTarif(f.tarif) : null   // 18.11: tariful lângă AWB; gol = „tarif necunoscut”, evidențiat (procedura cere oprire)
          // oPOD-ul rândului: pe un rând trimis = alegerea înghețată a lotului (ce a plecat), nu corpul reconstruit acum (Jakarinos #1135 r1 P2)
          const opodTxt = textOpodRand({ fanLot: fan?.fanLot, rand: f, shipment: r.shipment })
          return <div key={r.plic.id} style={{ ...S.card, borderColor: r.ok ? G.green : G.yellow }}>
            <b>{r.plic.nr_plic}</b> · {r.shipment.recipient.name || '(fără nume)'} · {[r.shipment.recipient.address.street, r.shipment.recipient.address.locality, r.shipment.recipient.address.county].filter(Boolean).join(', ') || '(fără adresă)'}
            {r.ok ? <div style={{ color: G.green }}>✓ gata pentru FAN · referința pe etichetă: {r.shipment.info.observation}{opodTxt ? <b style={{ color: G.orange }}> · {opodTxt}</b> : ''}</div> : <ul style={{ margin: '4px 0 0', paddingLeft: 18, color: G.yellow }}>{r.probleme.map((x, i) => <li key={i}>{x}</li>)}</ul>}
            {f && <div style={{ fontSize: 12.5, color: G.muted }}>FAN: {ETICHETE_STARE_FAN[f.stare] || f.stare}{f.awb ? ` · AWB ${f.awb}` : ''}
              {tarif && <> · <b style={tarif === MESAJ_TARIF_NECUNOSCUT ? { color: G.red, background: G.redDim, padding: '0 4px', borderRadius: 4 } : { color: G.text }}>{tarif}</b>{tarif !== MESAJ_TARIF_NECUNOSCUT && f.tva != null ? ` (+ TVA ${textTarif(f.tva)})` : ''}</>}
              {f.hash_date !== r.hash && ['propus', 'aprobat'].includes(f.stare) ? ' · datele s-au schimbat după propunere: propune din nou' : ''}
              {f.urmarire_stare && f.urmarire_stare !== 'neurmarit' ? ` · urmărire: ${etichetaUrmarire(f)}` : ''}
              {f.ultim_eveniment ? ` · ${textUltimEveniment(f)}` : ''}
              {textFapteUrmarire(f, ETICHETE_RETUR) ? ` · ${textFapteUrmarire(f, ETICHETE_RETUR)}` : ''}
              {f.confirmare_stare && f.confirmare_stare !== 'nesolicitata' ? ` · ${ETICHETE_CONFIRMARE[f.confirmare_stare] || f.confirmare_stare}` : ''}
              {f.motiv ? ` · ${f.motiv}` : ''}</div>}
          </div> })}
      </div>
    </>}
  </Modal>
}
