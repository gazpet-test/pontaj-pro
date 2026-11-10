// ═══════════════════════════════════════════════════════════════════════════
// FibraOptica.jsx — Execuție → proiect → „🧵 Fibră optică” (decizia lui Răzvan, 10.11.2026), mobil întâi (șeful de șantier, telefon)
// Aleg tronsonul -> bara tronsonului cu cele 3 etape colorate pe km (monotub, validat, suflat) și cameretele ca puncte -> „Raportează”
// (etapa, de la km+m, până la km+m, data = azi implicit). Rezumat pe tronson și pe proiect (azi / cumulat / rest, metri și %, camerete
// montate / total), exportabil CSV; istoricul raportărilor pe tronson, cu anulare (cu motiv) pentru cel care a raportat sau owner.
// Scrierea: doar cu drept de scriere pe Execuție, prin RPC-urile fn_executie_fibra_* (migrarea 20261211a); citirea prin RLS. Regulile
// (limite, suprapunere, acoperire, dependențe) sunt în BAZĂ; aici sunt repetate doar ca să vadă omul greșeala înainte de trimitere.
// L05: o salvare cu rezultat necunoscut se reia cu aceeași cheie doar dacă cererea e identică; altfel întâi se lămurește (registru local).
// L24: încărcarea are generația ei; un rezultat întârziat nu se aplică pe alt proiect.
// ═══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './lib/supabase.js'
import { paginareKeyset } from './hrDeciziiUtil.js'
import { ziBucuresti } from './lib/izoTeren.js'
import { G, S } from './NodCuplareVizualizare.jsx'
import { esteRefuzDeterminist, clasificaReluare, registruNou, aceeasiIntentie, aplicaRand, imbinaLista } from './probeTronsoaneLogica.js'
import {
  ETAPE, ETAPA_ANTERIOARA, ETICHETE_ETAPA, ETICHETE_SCURTE, CULORI_ETAPA, ETICHETE_CAMERETA, parseKm, fmtKm, fmtLungime, fmtZi,
  areKm, ordoneazaTronsoane, valideazaRaport, blocajAnulare, poateAnula, poateAnulaMontarea, poateScoateCamereta, rezumatTronson,
  rezumatProiect, csvRezumat, bandaTronson, deFacut, payloadRaport, payloadAnulare, payloadCameretaNoua, payloadCameretaStare,
  valideazaCameretaNoua, RPC_FIBRA, prefixRegistruFibra, textJurnal, normCodCamereta, ZILE_INAPOI, ZILE_INAPOI_OWNER, scadeZile,
} from './fibraOpticaLogica.js'

const stocareImplicita = () => { try { return globalThis.localStorage || null } catch { return null } }
const COL_INT = 'id, proiect_id, tronson_id, etapa, km_de_la_m, km_pana_la_m, data_lucru, observatii, stare, motiv_anulare, anulat_de, anulat_nume, anulat_la, raportat_de, raportat_nume, creat_la'
const COL_CAM = 'id, proiect_id, tronson_id, cod, km_m, stare, data_montare, montat_de, montat_nume, sursa, observatii, motiv, versiune, creat_de, creat_nume, creat_la'
const COL_JURNAL = 'id, tronson_id, interval_id, camereta_id, actiune, valori, creat_nume, creat_la'
const cheieNoua = () => globalThis.crypto.randomUUID()
const pagini = (client, tabel, coloane, filtru) => paginareKeyset((ultim, pas) => {
  let q = filtru(client.from(tabel).select(coloane)).order('id').limit(pas)
  if (ultim != null) q = q.gt('id', ultim)
  return q
})
const fara = m => String(m?.message || m || '').replace(/^(fibra|tronsoane): /, '')

// `client` și `stocare` se pot înlocui doar în teste (date sintetice); în aplicație: clientul Supabase al sesiunii și localStorage
export default function FibraOptica({ proiectId, client = supabase, stocare = stocareImplicita() }) {
  const [tronsoane, setTronsoane] = useState([])
  const [intervale, setIntervale] = useState([])
  const [camerete, setCamerete] = useState([])
  const [incarcat, setIncarcat] = useState(false)
  const [eroare, setEroare] = useState(null)
  const [eroareReimprospatare, setEroareReimprospatare] = useState(null)
  const [poateScrie, setPoateScrie] = useState(false)
  const [eroareDrept, setEroareDrept] = useState(null)
  const [uid, setUid] = useState(null)
  const [owner, setOwner] = useState(false)
  const [azi, setAzi] = useState(ziBucuresti())
  const [selectat, setSelectat] = useState(null)       // id-ul tronsonului ales
  const [form, setForm] = useState(null)               // { tip: 'raport' | 'anulare' | 'camereta_noua' | 'camereta', ... }
  const [mesaj, setMesaj] = useState(null)
  const [inCurs, setInCurs] = useState(false)
  const [jurnalKey, setJurnalKey] = useState(0)
  const [arataProiect, setArataProiect] = useState(false)
  const gen = useRef(0)
  const ctx = useRef(0)
  const proiectCtx = useRef(0)
  const registru = useRef(null)
  const [registruGata, setRegistruGata] = useState(false)
  const [eroareRegistru, setEroareRegistru] = useState(null)
  const [nrNelamurite, setNrNelamurite] = useState(0)
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

  // ── tronsoanele, intervalele, cameretele și dreptul de scriere; keyset pe id (L23). true doar dacă s-a citit și s-a aplicat (L18) ──
  const incarca = useCallback(async ({ silentios = false } = {}) => {
    const g = ++gen.current
    setEroareDrept(null)
    if (!silentios) setEroare(null)
    try {
      const [t, i, c, drept] = await Promise.all([
        pagini(client, 'executie_tronsoane', 'id, proiect_id, cod, denumire, km_start_m, km_end_m', q => q.eq('proiect_id', proiectId)),
        pagini(client, 'executie_fibra_intervale', COL_INT, q => q.eq('proiect_id', proiectId)),
        pagini(client, 'executie_fibra_camerete', COL_CAM, q => q.eq('proiect_id', proiectId)),
        client.rpc('fn_executie_fibra_drept', { p_proiect: proiectId, p_scriere: true }),
      ])
      if (g !== gen.current) return false
      setTronsoane(t.filter(x => x.proiect_id === proiectId))
      setIntervale(cur => imbinaLista(i.filter(x => x.proiect_id === proiectId), cur))
      setCamerete(cur => imbinaLista(c.filter(x => x.proiect_id === proiectId), cur))
      if (drept.error) { setPoateScrie(false); setEroareDrept('Nu am putut verifica dreptul de scriere: ' + drept.error.message) }
      else setPoateScrie(drept.data === true)
      setAzi(ziBucuresti()); setEroareReimprospatare(null); setIncarcat(true)
      return true
    } catch (err) {
      if (g !== gen.current) return false
      if (silentios) { setEroareReimprospatare('Lista nu s-a putut reîmprospăta (' + (err?.message || err) + '). Ce vezi poate fi vechi: apasă ↻ Reîncarcă.'); return false }
      setIntervale([]); setCamerete([]); setTronsoane([])
      setEroare('Nu am putut încărca fibra optică: ' + (err?.message || err))
      return false
    }
  }, [proiectId, client])

  useEffect(() => {
    proiectCtx.current += 1; ctx.current += 1
    const pg = proiectCtx.current
    registru.current = null; setRegistruGata(false); setNrNelamurite(0)
    setTronsoane([]); setIntervale([]); setCamerete([]); setSelectat(null); setForm(null); setMesaj(null); setInCurs(false)
    setIncarcat(false); setEroareReimprospatare(null); setEroareRegistru(null); setUid(null); setOwner(false)
    incarca()
    let curatare = () => {}
    ;(async () => {
      let id = null
      try { const s = client.auth?.getSession ? await client.auth.getSession() : null; id = s?.data?.session?.user?.id || null } catch { id = null }
      if (pg !== proiectCtx.current) return
      setUid(id)
      // owner-ul: doar pentru butoane și fereastra datei (serverul verifică din nou); o citire eșuată = ca non-owner (mai restrictiv)
      if (id) {
        try {
          const { data } = await client.from('profiles').select('is_owner').eq('id', id).maybeSingle()
          if (pg === proiectCtx.current) setOwner(data?.is_owner === true)
        } catch { /* rămâne non-owner */ }
      }
      const reg = registruNou(id ? stocare : null, id ? prefixRegistruFibra(id, proiectId) : null, RPC_FIBRA)
      if (!reg.utilizabil || reg.toate() === null) {
        setEroareRegistru('Stocarea locală a browserului nu e disponibilă (navigare privată, stocare blocată sau sesiune neidentificată): raportarea e oprită, ca un rezultat nelămurit să nu se piardă.')
        return
      }
      registru.current = reg
      setRegistruGata(true)
      setNrNelamurite(reg.toate().length)
      const laSchimbare = e => { if (pg === proiectCtx.current && (e.key == null || e.key.startsWith(prefixRegistruFibra(id, proiectId)))) setNrNelamurite((reg.toate() || []).length) }
      globalThis.addEventListener?.('storage', laSchimbare)
      curatare = () => globalThis.removeEventListener?.('storage', laSchimbare)
    })()
    return () => curatare()
  }, [incarca, client, stocare, proiectId])

  const ordonate = useMemo(() => ordoneazaTronsoane(tronsoane), [tronsoane])
  // tronsonul ales implicit: primul cu km
  useEffect(() => {
    if (selectat != null && tronsoane.some(t => t.id === selectat)) return
    const primul = ordonate.find(areKm) || ordonate[0]
    if (primul) setSelectat(primul.id)
  }, [ordonate, tronsoane, selectat])
  const tronson = tronsoane.find(t => t.id === selectat) || null
  const rezT = useMemo(() => (tronson ? rezumatTronson(tronson, intervale, camerete, azi) : null), [tronson, intervale, camerete, azi])
  const rezP = useMemo(() => rezumatProiect(tronsoane, intervale, camerete, azi), [tronsoane, intervale, camerete, azi])

  const deschide = f => { ctx.current += 1; setMesaj(null); setForm(f) }
  const inchideForm = () => { ctx.current += 1; setMesaj(null); setForm(null) }
  const aplicaRezultat = r => {
    if (r?.interval?.proiect_id === proiectId) setIntervale(l => aplicaRand(l, r.interval))
    if (r?.camereta?.proiect_id === proiectId) setCamerete(l => aplicaRand(l, r.camereta))
  }

  // ── L05: lămurirea unei cereri nelămurite = retrimitere IDENTICĂ (același RPC, payload, cheie); serverul e idempotent. Refuzul de
  // DREPT (verificat înaintea cheii) nu dovedește nimic: doar cheia găsită în jurnal dovedește scrierea. Iese din registru doar la
  // aplicat / aplicat acum / neaplicat (aceeași clasificare ca la probe, clasificaReluare). ──
  const rezolva = async (reg, intrare, { r, error }, pg) => {
    let clasa = clasificaReluare({ r, error })
    let prinJurnal = false
    if (clasa === 'fara_drept') {
      let data = null, err2 = null
      try { ({ data, error: err2 } = await client.from('executie_fibra_jurnal').select('id').eq('cheie', intrare.cheie).limit(1)) } catch (e) { err2 = e }
      if (err2 || !Array.isArray(data)) clasa = 'necunoscut'
      else if (data.length) { clasa = 'aplicat'; prinJurnal = true }
    }
    if ((clasa === 'aplicat' || clasa === 'aplicat_acum' || clasa === 'neaplicat') && !reg.scoate(intrare.cheie)) {
      if (montat.current && pg === proiectCtx.current) setEroareRegistru('O raportare lămurită nu s-a putut scoate din registrul local al browserului (stocare blocată); va reapărea ca nelămurită — retrimiterea ei e sigură (aceeași cheie).')
    }
    return { intrare, clasa, r: prinJurnal ? null : r, error, prinJurnal }
  }
  const lamureste = async (reg, intrare, pg) => {
    let r = null, error = null
    try { ({ data: r, error } = await client.rpc(intrare.rpc, { ...intrare.payload, p_cheie: intrare.cheie })) } catch (e) { error = e }
    return rezolva(reg, intrare, { r, error }, pg)
  }
  const mesajLamurire = ({ clasa, error, prinJurnal }) => ({
    aplicat: prinJurnal ? 'Cererea anterioară SE salvase (confirmat din jurnal).' : 'Cererea anterioară SE salvase (cu valorile de atunci).',
    aplicat_acum: 'Cererea anterioară nu ajunsese; am trimis-o acum, cu valorile de atunci.',
    neaplicat: error ? `Cererea anterioară nu s-a aplicat (serverul a refuzat-o: ${fara(error)}).` : 'Cererea anterioară nu s-a salvat (între timp s-a schimbat starea).',
    fara_drept: 'Cererea anterioară nu se poate lămuri acum: nu mai ai drept de scriere pe Execuție (rămâne de verificat).',
    necunoscut: `Cererea anterioară e tot fără rezultat sigur (${error?.message || error || 'fără răspuns valid'}).`,
  }[clasa])
  const ramaneNelamurita = x => x.clasa === 'necunoscut' || x.clasa === 'fara_drept'

  const lamuresteToate = async () => {
    const pg = proiectCtx.current, reg = registru.current
    if (!reg) return
    const lista = reg.toate()
    if (lista === null) { setMesaj({ ok: false, text: 'Registrul local nu se poate citi acum; reîncearcă.' }); return }
    setInCurs(true); setMesaj(null)
    const rezultate = []
    for (const x of lista) {
      const rez = await lamureste(reg, x, pg)
      if (!montat.current || pg !== proiectCtx.current) return
      rezultate.push(rez); aplicaRezultat(rez.r)
    }
    setInCurs(false); recitesteNelamurite(reg); setJurnalKey(k => k + 1)
    incarca({ silentios: true })
    setMesaj({ ok: !rezultate.some(ramaneNelamurita), text: rezultate.length ? rezultate.map(mesajLamurire).join(' ') + ' Verifică starea în listă.' : 'Nimic de lămurit.' })
  }

  // ── execuția unui RPC cu cheie de idempotență (L04 / L05 / L24): întâi se lămuresc cererile nelămurite pe aceeași țintă; o cerere nouă
  // primește o cheie nouă, scrisă DURABIL în registru ÎNAINTE de trimitere (scriere eșuată = nu se trimite). Întoarce { r, actual } sau null. ──
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
        const rez = await lamureste(reg, x, pg)
        if (!valid()) return null
        rezultate.push(rez); aplicaRezultat(rez.r)
      }
      setInCurs(false); recitesteNelamurite(reg)
      if (rezultate.some(x => x.r?.ok)) setJurnalKey(k => k + 1)
      const actual = g === ctx.current
      const aceeasi = rezultate.length === 1 && aceeasiIntentie(rezultate[0].intrare, rpc, payload) ? rezultate[0] : null
      if (aceeasi && (aceeasi.clasa === 'aplicat' || aceeasi.clasa === 'aplicat_acum')) {
        incarca({ silentios: true })
        if (aceeasi.r?.ok) return { r: aceeasi.r, actual }
        if (actual) setMesaj({ ok: true, text: mesajLamurire(aceeasi) + ' Reîncarc starea.' })
        return null
      }
      if (!rezultate.some(ramaneNelamurita)) incarca({ silentios: true })
      if (actual) {
        setMesaj({ ok: false, text: rezultate.map(mesajLamurire).join(' ') + (rezultate.some(ramaneNelamurita)
          ? ' Noua raportare se poate trimite abia după ce o lămurim: reîncearcă peste câteva secunde.'
          : ' Verifică, apoi confirmă din nou.') })
      }
      return null
    }
    const cheie = cheieNoua()
    const intrare = { tinta, rpc, cheie, payload, pusLa: new Date().toISOString() }
    if (!reg.pune(intrare)) {
      setMesaj({ ok: false, text: 'Nu pot păstra local cererea (stocarea browserului e plină sau blocată), deci nu o trimit: un rezultat nelămurit s-ar pierde.' })
      return null
    }
    setInCurs(true); setMesaj(null)
    let r = null, error = null
    try { ({ data: r, error } = await client.rpc(rpc, { ...payload, p_cheie: cheie })) } catch (e) { error = e }
    const rez = await rezolva(reg, intrare, { r, error }, pg)
    if (!valid()) return null
    setInCurs(false); recitesteNelamurite(reg)
    const actual = g === ctx.current
    if (rez.clasa === 'aplicat' || rez.clasa === 'aplicat_acum') {
      setJurnalKey(k => k + 1)
      incarca({ silentios: true })
      if (rez.r?.ok) { aplicaRezultat(rez.r); return { r: rez.r, actual } }
      if (actual) setMesaj({ ok: true, text: 'Salvarea s-a făcut (confirmată din jurnal). Reîncarc starea.' })
      return null
    }
    if (rez.clasa === 'neaplicat') {
      aplicaRezultat(r)
      if (actual) setMesaj({ ok: false, text: error ? fara(error) : 'S-a schimbat între timp (alt utilizator sau altă apăsare). Am adus starea actuală — verifică și reîncearcă.' })
      return null
    }
    if (actual) {
      setMesaj({ ok: false, text: rez.clasa === 'fara_drept'
        ? fara(error) + ' Cererea rămâne de verificat.'
        : error && esteRefuzDeterminist(error) ? fara(error) + ' Apasă din nou peste câteva secunde (aceeași cerere).'
          : 'Nu se știe dacă s-a salvat (' + (error?.message || error || 'răspuns gol') + '). Apasă din nou fără să schimbi nimic; dacă schimbi ceva, întâi verific ce s-a întâmplat.' })
    }
    return null
  }

  const raporteaza = async f => {
    const x = await executa(`raport:${f.tronsonId}`, 'fn_executie_fibra_raporteaza', payloadRaport({ proiectId, ...f }))
    if (x?.actual && x.r?.ok) { inchideForm(); setMesaj({ ok: true, text: x.r.duplicat ? 'Era deja raportat.' : 'Raportat.' }) }
  }
  const anuleaza = async (interval, motiv) => {
    const x = await executa(`anulare:${interval.id}`, 'fn_executie_fibra_anuleaza', payloadAnulare(interval, motiv))
    if (x?.actual && x.r?.ok) { inchideForm(); setMesaj({ ok: true, text: 'Raportarea a fost anulată.' }) }
  }
  const adaugaCamereta = async f => {
    const x = await executa(`camereta_noua:${f.tronsonId}`, 'fn_executie_fibra_camereta_adauga', payloadCameretaNoua({ proiectId, ...f }))
    if (x?.actual && x.r?.ok) { inchideForm(); setMesaj({ ok: true, text: x.r.duplicat ? 'Era deja adăugată.' : 'Camereta a fost adăugată.' }) }
  }
  const stareCamereta = async (c, f) => {
    const x = await executa(`camereta:${c.id}`, 'fn_executie_fibra_camereta_stare', payloadCameretaStare(c, f))
    if (x?.actual && x.r?.ok) { inchideForm(); setMesaj({ ok: true, text: 'Salvat.' }) }
  }
  const descarcaCsv = () => {
    const blob = new Blob([csvRezumat(rezP, azi)], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `fibra_optica_proiect_${proiectId}_${azi}.csv`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }

  if (!incarcat && !eroare) return <Cadru><div style={{ color: G.dim, padding: 30, textAlign: 'center' }}>Se încarcă…</div></Cadru>
  if (eroare) return <Cadru><Alerta text={eroare} /><button onClick={() => incarca()} style={{ ...S.btn, marginTop: 10, minHeight: 44 }}>Reîncearcă</button></Cadru>

  const nepregatit = !registruGata
  const camTronson = tronson ? camerete.filter(c => c.tronson_id === tronson.id).sort((a, b) => (a.stare === 'anulata') - (b.stare === 'anulata') || a.km_m - b.km_m || a.id - b.id) : []
  const intTronson = tronson ? intervale.filter(i => i.tronson_id === tronson.id).sort((a, b) => String(b.creat_la).localeCompare(String(a.creat_la)) || b.id - a.id) : []

  return (
    <Cadru>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: G.text }}>🧵 Fibră optică</div>
        <button onClick={() => incarca()} style={{ ...S.btn, marginLeft: 'auto', padding: '6px 12px', fontSize: 13, minHeight: 40 }}>↻ Reîncarcă</button>
      </div>
      {eroareDrept && <Alerta text={eroareDrept} />}
      {eroareReimprospatare && <Alerta text={eroareReimprospatare} galben />}
      {eroareRegistru && <Alerta text={eroareRegistru} />}
      {nrNelamurite > 0 && !form && (
        <div style={{ margin: '8px 0', padding: '9px 12px', borderRadius: 10, background: G.yellow + '1F', color: G.yellow, fontSize: 13, fontWeight: 600 }}>
          ⚠ {nrNelamurite === 1 ? 'O raportare are' : `${nrNelamurite} raportări au`} rezultat nelămurit (de exemplu fără semnal).
          <div style={{ marginTop: 8 }}><button disabled={inCurs} onClick={lamuresteToate} style={{ ...S.btn, minHeight: 44 }}>{inCurs ? 'Se verifică…' : 'Lămurește acum'}</button></div>
        </div>
      )}
      {!poateScrie && !eroareDrept && <div style={{ fontSize: 12, color: G.muted, marginBottom: 8 }}>Doar citire: raportările le fac cei cu drept de scriere pe Execuție.</div>}
      {mesaj && !form && <Mesaj m={mesaj} />}

      {!tronsoane.length && <div style={{ color: G.muted, padding: '16px 4px', fontSize: 14 }}>Proiectul nu are tronsoane (se adaugă la 📍 Tronsoane).</div>}
      {tronsoane.length > 0 && (
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 6, marginBottom: 8 }} role="tablist" aria-label="Tronsoane">
          {ordonate.map(t => {
            const r = rezP.randuri.find(x => x.id === t.id)
            const pct = r?.etape.suflat.pct
            return (
              <button key={t.id} role="tab" aria-selected={t.id === selectat} onClick={() => { setSelectat(t.id); setMesaj(null) }}
                style={{ ...S.chip(t.id === selectat, G.blue), flexShrink: 0, minHeight: 40, fontSize: 13 }}>
                <b>{t.cod}</b>{areKm(t) ? <span style={{ color: G.muted }}>{pct != null ? `${String(pct).replace('.', ',')}%` : ''}</span> : <span style={{ color: G.yellow }}>fără km</span>}
              </button>
            )
          })}
        </div>
      )}

      {tronson && (
        <div style={{ background: G.surface, border: `1px solid ${G.border2}`, borderRadius: 12, padding: 12, marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
            <span style={{ fontSize: 18, fontWeight: 900 }}>{tronson.cod}</span>
            {areKm(tronson)
              ? <span style={{ fontSize: 13, color: G.muted }}>km {fmtKm(tronson.km_start_m)} → {fmtKm(tronson.km_end_m)} · {fmtLungime(tronson.km_end_m - tronson.km_start_m)}</span>
              : <span style={{ fontSize: 13, color: G.yellow }}>fără km de început / sfârșit: nu primește raportări (se completează la 📍 Tronsoane)</span>}
            {tronson.denumire && <span style={{ fontSize: 13, color: G.text }}>{tronson.denumire}</span>}
          </div>
          <BaraTronson t={tronson} intervale={intervale} camerete={camerete} />
          {rezT?.areKm && <RezumatTronson r={rezT} />}
          {poateScrie && areKm(tronson) && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              <button onClick={() => deschide({ tip: 'raport' })} style={{ ...S.btn, flex: '2 1 200px', minHeight: 50, background: G.blue, color: '#0D1117', border: 'none', fontSize: 16 }}>📏 Raportează</button>
              <button onClick={() => deschide({ tip: 'camereta_noua' })} style={{ ...S.btn, flex: '1 1 140px', minHeight: 50 }}>＋ Cameretă lipsă</button>
            </div>
          )}
        </div>
      )}

      {tronson && (
        <Sectiune titlu={`Camerete (${rezT?.camerete.montate ?? 0} montate din ${rezT?.camerete.total ?? 0})`}>
          {!camTronson.length && <div style={{ fontSize: 13, color: G.dim }}>Nicio cameretă pe acest tronson (lista din proiect o încarcă biroul; lipsurile se adaugă cu „＋ Cameretă lipsă”).</div>}
          {camTronson.map(c => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 0', borderBottom: `1px solid ${G.border2}`, opacity: c.stare === 'anulata' ? 0.6 : 1 }}>
              <span style={{ width: 12, height: 12, borderRadius: 999, background: c.stare === 'montata' ? G.green : c.stare === 'anulata' ? G.border : G.muted, display: 'inline-block' }} />
              <b style={{ fontSize: 14 }}>{c.cod}</b>
              <span style={{ fontSize: 13, color: G.muted }}>km {fmtKm(c.km_m)}</span>
              <span style={{ fontSize: 12, color: c.stare === 'montata' ? G.green : G.muted }}>
                {ETICHETE_CAMERETA[c.stare] || c.stare}{c.stare === 'montata' ? ` ${fmtZi(c.data_montare)}${c.montat_nume ? ' · ' + c.montat_nume : ''}` : ''}{c.sursa === 'santier' ? ' · adăugată de pe șantier' : ''}
              </span>
              {c.motiv && c.stare !== 'montata' && <span style={{ fontSize: 12, color: G.dim }}>({c.motiv})</span>}
              {poateScrie && (
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {c.stare === 'de_montat' && <button onClick={() => deschide({ tip: 'camereta', camereta: c, stareNoua: 'montata' })} style={{ ...S.btn, minHeight: 40, padding: '6px 10px', fontSize: 13 }}>✓ Montată</button>}
                  {poateAnulaMontarea(c, uid, owner) && <button onClick={() => deschide({ tip: 'camereta', camereta: c, stareNoua: 'de_montat' })} style={{ ...S.btn, minHeight: 40, padding: '6px 10px', fontSize: 13, color: G.yellow }}>Anulează montarea</button>}
                  {poateScoateCamereta(c, uid, owner) && <button onClick={() => deschide({ tip: 'camereta', camereta: c, stareNoua: 'anulata' })} style={{ ...S.btn, minHeight: 40, padding: '6px 10px', fontSize: 13, color: G.red }}>Scoate</button>}
                </span>
              )}
            </div>
          ))}
        </Sectiune>
      )}

      {tronson && (
        <Sectiune titlu="Istoric raportări pe tronson">
          {!intTronson.length && <div style={{ fontSize: 13, color: G.dim }}>Nicio raportare încă.</div>}
          {intTronson.map(i => (
            <div key={i.id} style={{ borderLeft: `4px solid ${i.stare === 'activ' ? CULORI_ETAPA[i.etapa] : G.border}`, padding: '6px 10px', marginBottom: 8, opacity: i.stare === 'activ' ? 1 : 0.65 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <b style={{ fontSize: 14, color: CULORI_ETAPA[i.etapa] }}>{ETICHETE_SCURTE[i.etapa] || i.etapa}</b>
                <span style={{ fontSize: 13 }}>km {fmtKm(i.km_de_la_m)} → {fmtKm(i.km_pana_la_m)} · {fmtLungime(i.km_pana_la_m - i.km_de_la_m)}</span>
                {poateScrie && poateAnula(i, uid, owner) && (
                  <button onClick={() => deschide({ tip: 'anulare', interval: i })} style={{ ...S.btn, marginLeft: 'auto', minHeight: 40, padding: '6px 10px', fontSize: 13, color: G.red }}>Anulează</button>
                )}
              </div>
              <div style={{ fontSize: 12, color: G.muted }}>lucrat {fmtZi(i.data_lucru)}{i.raportat_nume ? ` · ${i.raportat_nume}` : ''}{i.observatii ? ` · ${i.observatii}` : ''}</div>
              {i.stare !== 'activ' && <div style={{ fontSize: 12, color: G.yellow }}>Anulat{i.anulat_nume ? ` de ${i.anulat_nume}` : ''}: {i.motiv_anulare}</div>}
            </div>
          ))}
          <JurnalTronson client={client} tronsonId={tronson.id} jurnalKey={jurnalKey} />
        </Sectiune>
      )}

      <Sectiune titlu="Rezumat pe proiect" deschisa={arataProiect} onComuta={() => setArataProiect(x => !x)}>
        <RezumatProiect rez={rezP} onCsv={descarcaCsv} />
      </Sectiune>

      {form?.tip === 'raport' && tronson && (
        <FormRaport tronson={tronson} intervale={intervale} azi={azi} owner={owner} busy={inCurs} nepregatit={nepregatit} mesaj={mesaj}
          onSalveaza={raporteaza} onInchide={inchideForm} />
      )}
      {form?.tip === 'anulare' && (
        <FormAnulare interval={intervale.find(i => i.id === form.interval.id) || form.interval} intervale={intervale} busy={inCurs} nepregatit={nepregatit} mesaj={mesaj}
          onAnuleaza={anuleaza} onInchide={inchideForm} />
      )}
      {form?.tip === 'camereta_noua' && tronson && (
        <FormCameretaNoua tronson={tronson} camerete={camerete} azi={azi} owner={owner} busy={inCurs} nepregatit={nepregatit} mesaj={mesaj}
          onSalveaza={adaugaCamereta} onInchide={inchideForm} />
      )}
      {form?.tip === 'camereta' && (
        <FormCamereta c={camerete.find(c => c.id === form.camereta.id) || form.camereta} laDeschidere={form.camereta} stareNoua={form.stareNoua} azi={azi} owner={owner}
          busy={inCurs} nepregatit={nepregatit} mesaj={mesaj} onSalveaza={stareCamereta} onInchide={inchideForm} />
      )}
    </Cadru>
  )
}

// ── bara tronsonului: câte o bandă pe etapă (colorat = făcut), cameretele ca puncte deasupra ──
function BaraTronson({ t, intervale, camerete }) {
  const b = bandaTronson(t, intervale, camerete)
  if (!b) return null
  const W = 1000, H = 132, X0 = 8, LAT = W - 16
  const x = f => X0 + f * LAT
  const RAND = { monotub: 34, validat: 66, suflat: 98 }
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }} role="img" aria-label={`Bara tronsonului ${t.cod}: etapele pe km și cameretele`}>
        {ETAPE.map(et => (
          <g key={et}>
            <rect x={X0} y={RAND[et]} width={LAT} height={24} rx={5} fill={G.border2} />
            {b.benzi[et].map((s, k) => <rect key={k} x={x(s.x0)} y={RAND[et]} width={Math.max(2, x(s.x1) - x(s.x0))} height={24} rx={4} fill={CULORI_ETAPA[et]} />)}
          </g>
        ))}
        {b.puncte.map(p => (
          <g key={p.id}>
            <line x1={x(p.x)} x2={x(p.x)} y1={20} y2={122} stroke={G.border} strokeWidth={2} strokeDasharray="4 4" />
            <circle cx={x(p.x)} cy={14} r={9} fill={p.stare === 'montata' ? G.green : G.bg} stroke={p.stare === 'montata' ? G.green : G.muted} strokeWidth={3}>
              <title>{`${p.cod} · km ${fmtKm(p.km_m)} · ${ETICHETE_CAMERETA[p.stare]}`}</title>
            </circle>
          </g>
        ))}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: G.dim, padding: '0 2px' }}>
        <span>km {fmtKm(t.km_start_m)}</span><span>km {fmtKm(t.km_end_m)}</span>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 11, color: G.muted, marginTop: 4 }}>
        {ETAPE.map(et => <span key={et} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><i style={{ width: 10, height: 10, borderRadius: 3, background: CULORI_ETAPA[et], display: 'inline-block' }} />{ETICHETE_SCURTE[et]}</span>)}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><i style={{ width: 10, height: 10, borderRadius: 999, background: G.green, display: 'inline-block' }} />Cameretă montată</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><i style={{ width: 10, height: 10, borderRadius: 999, border: `2px solid ${G.muted}`, display: 'inline-block', boxSizing: 'border-box' }} />De montat</span>
      </div>
    </div>
  )
}

const fmtPct = p => (p == null ? '—' : `${String(p).replace('.', ',')}%`)
function RezumatTronson({ r }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginTop: 10 }}>
      {ETAPE.map(et => {
        const x = r.etape[et]
        return (
          <div key={et} style={{ background: G.bg, border: `1px solid ${G.border2}`, borderTop: `3px solid ${CULORI_ETAPA[et]}`, borderRadius: 10, padding: '8px 10px' }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: CULORI_ETAPA[et] }}>{ETICHETE_ETAPA[et]}</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: G.text }}>{fmtPct(x.pct)}</div>
            <div style={{ fontSize: 12, color: G.muted }}>azi {fmtLungime(x.azi)} · cumulat {fmtLungime(x.cumulat)}</div>
            <div style={{ fontSize: 12, color: x.rest > 0 ? G.yellow : G.green }}>rest {fmtLungime(x.rest)}</div>
          </div>
        )
      })}
      <div style={{ background: G.bg, border: `1px solid ${G.border2}`, borderTop: `3px solid ${G.green}`, borderRadius: 10, padding: '8px 10px' }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: G.green }}>Camerete</div>
        <div style={{ fontSize: 20, fontWeight: 900, color: G.text }}>{r.camerete.montate} / {r.camerete.total}</div>
        <div style={{ fontSize: 12, color: G.muted }}>azi {r.camerete.azi} · rest {r.camerete.total - r.camerete.montate}</div>
      </div>
    </div>
  )
}

function RezumatProiect({ rez, onCsv }) {
  const th = { textAlign: 'right', padding: '6px 8px', fontSize: 11, color: G.muted, fontWeight: 700, whiteSpace: 'nowrap', borderBottom: `1px solid ${G.border}` }
  const td = { textAlign: 'right', padding: '6px 8px', fontSize: 12, whiteSpace: 'nowrap', borderBottom: `1px solid ${G.border2}` }
  const randEt = (x, et, k) => <td key={et + k} style={{ ...td, color: k === 'rest' && x.rest > 0 ? G.yellow : G.text }}>{k === 'pct' ? fmtPct(x.pct) : fmtLungime(x[k])}</td>
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{ fontSize: 13, color: G.muted }}>Lungime cu km: <b style={{ color: G.text }}>{fmtLungime(rez.lungime)}</b></span>
        <button onClick={onCsv} style={{ ...S.btn, marginLeft: 'auto', minHeight: 40, padding: '6px 12px', fontSize: 13 }}>⬇ CSV</button>
      </div>
      {rez.faraKm.length > 0 && <Alerta galben text={`Tronsoane fără km (nu intră în total, nu primesc raportări): ${rez.faraKm.join(', ')}`} />}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', color: G.text }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'left' }}>Tronson</th>
              {ETAPE.map(et => <th key={et} colSpan={3} style={{ ...th, textAlign: 'center', color: CULORI_ETAPA[et] }}>{ETICHETE_SCURTE[et]}</th>)}
              <th style={th}>Camerete</th>
            </tr>
            <tr>
              <th style={th} />
              {ETAPE.map(et => [<th key={et + 'a'} style={th}>azi</th>, <th key={et + 'c'} style={th}>cumulat</th>, <th key={et + 'r'} style={th}>rest</th>])}
              <th style={th}>montate / total</th>
            </tr>
          </thead>
          <tbody>
            {rez.randuri.map(r => (
              <tr key={r.id}>
                <td style={{ ...td, textAlign: 'left', fontWeight: 700 }}>{r.cod}{!r.areKm && <span style={{ color: G.yellow, fontWeight: 400 }}> (fără km)</span>}</td>
                {ETAPE.map(et => r.areKm ? [randEt(r.etape[et], et, 'azi'), <td key={et + 'c'} style={td}>{fmtLungime(r.etape[et].cumulat)} <span style={{ color: G.muted }}>({fmtPct(r.etape[et].pct)})</span></td>, randEt(r.etape[et], et, 'rest')]
                  : [<td key={et} colSpan={3} style={{ ...td, textAlign: 'center', color: G.dim }}>—</td>])}
                <td style={td}>{r.camerete.montate} / {r.camerete.total}</td>
              </tr>
            ))}
            <tr>
              <td style={{ ...td, textAlign: 'left', fontWeight: 900 }}>TOTAL</td>
              {ETAPE.map(et => [randEt(rez.etape[et], et, 'azi'), <td key={et + 'c'} style={{ ...td, fontWeight: 800 }}>{fmtLungime(rez.etape[et].cumulat)} <span style={{ color: G.muted }}>({fmtPct(rez.etape[et].pct)})</span></td>, randEt(rez.etape[et], et, 'rest')])}
              <td style={{ ...td, fontWeight: 800 }}>{rez.camerete.montate} / {rez.camerete.total}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── jurnalul tronsonului (toate operațiile, în ordine) ──
function JurnalTronson({ client, tronsonId, jurnalKey }) {
  const [deschis, setDeschis] = useState(false)
  const [jurnal, setJurnal] = useState(null)
  const [eroare, setEroare] = useState(null)
  useEffect(() => {
    if (!deschis) return undefined
    let viu = true
    setJurnal(null); setEroare(null)
    pagini(client, 'executie_fibra_jurnal', COL_JURNAL, q => q.eq('tronson_id', tronsonId))
      .then(r => { if (viu) setJurnal(r) }, e => { if (viu) setEroare('Jurnalul nu se poate citi: ' + (e?.message || e)) })
    return () => { viu = false }
  }, [deschis, tronsonId, jurnalKey, client])
  return (
    <div style={{ marginTop: 6 }}>
      <button onClick={() => setDeschis(x => !x)} style={{ ...S.btn, fontSize: 13, minHeight: 40 }}>{deschis ? '▾' : '▸'} Jurnalul complet</button>
      {deschis && eroare && <Alerta text={eroare} />}
      {deschis && !jurnal && !eroare && <div style={{ fontSize: 12, color: G.dim }}>Se încarcă…</div>}
      {deschis && jurnal && !jurnal.length && <div style={{ fontSize: 12, color: G.dim }}>Nicio operație.</div>}
      {deschis && jurnal && [...jurnal].reverse().map(j => (
        <div key={j.id} style={{ fontSize: 12, padding: '4px 0', borderBottom: `1px solid ${G.border2}` }}>
          <span style={{ color: G.dim }}>{fmtOra(j.creat_la)}{j.creat_nume ? ` · ${j.creat_nume}` : ''} — </span>{textJurnal(j)}
        </div>
      ))}
    </div>
  )
}
function fmtOra(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('ro-RO', { timeZone: 'Europe/Bucharest', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

// ── formularul de raportare: etapa, de la / până la (km+m), data (azi implicit), observații; propunerea „ce mai e de făcut” ──
function FormRaport({ tronson, intervale, azi, owner, busy, nepregatit, mesaj, onSalveaza, onInchide }) {
  const [etapa, setEtapa] = useState('monotub')
  const [deLaTxt, setDeLaTxt] = useState('')
  const [panaLaTxt, setPanaLaTxt] = useState('')
  const [data, setData] = useState(azi)
  const [observatii, setObservatii] = useState('')
  const deLa = parseKm(deLaTxt), panaLa = parseKm(panaLaTxt)
  const erori = valideazaRaport({ tronson, etapa, deLa, panaLa, data, azi, owner, intervale, observatii })
  const ramas = deFacut(tronson, etapa, intervale)
  const ok = erori.length === 0
  const propune = g => { setDeLaTxt(fmtKm(g.de_la)); setPanaLaTxt(fmtKm(g.pana_la)) }
  return (
    <Foaie titlu={`Raportează pe ${tronson.cod}`} onInchide={onInchide}>
      <span style={S.label}>Etapa</span>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        {ETAPE.map(et => (
          <button key={et} type="button" onClick={() => setEtapa(et)}
            style={{ ...S.btn, minHeight: 48, flex: '1 1 120px', background: etapa === et ? CULORI_ETAPA[et] : G.surface2, color: etapa === et ? '#0D1117' : G.text }}>
            {ETICHETE_ETAPA[et]}
          </button>
        ))}
      </div>
      {ETAPA_ANTERIOARA[etapa] && <div style={{ fontSize: 12, color: G.muted, marginTop: -4, marginBottom: 8 }}>Se raportează doar peste porțiuni cu „{ETICHETE_ETAPA[ETAPA_ANTERIOARA[etapa]]}”.</div>}
      {ramas.length > 0 && (
        <div style={{ fontSize: 12, color: G.muted, marginBottom: 8 }}>
          De făcut: {ramas.slice(0, 4).map((g, k) => (
            <button key={k} type="button" onClick={() => propune(g)} style={{ ...S.chip(false, G.blue), margin: '2px 4px 2px 0' }}>{fmtKm(g.de_la)}–{fmtKm(g.pana_la)}</button>
          ))}{ramas.length > 4 ? ` și încă ${ramas.length - 4}` : ''}
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <label style={{ display: 'block', marginBottom: 10, flex: '1 1 130px' }}>
          <span style={S.label}>De la km</span>
          <input value={deLaTxt} onChange={e => setDeLaTxt(e.target.value)} placeholder={fmtKm(tronson.km_start_m)} inputMode="text" style={S.input} />
        </label>
        <label style={{ display: 'block', marginBottom: 10, flex: '1 1 130px' }}>
          <span style={S.label}>Până la km</span>
          <input value={panaLaTxt} onChange={e => setPanaLaTxt(e.target.value)} placeholder={fmtKm(tronson.km_end_m)} inputMode="text" style={S.input} />
        </label>
      </div>
      <div style={{ fontSize: 11, color: G.dim, marginTop: -6, marginBottom: 10 }}>Scrie „12+350” (km+m). Tronsonul: km {fmtKm(tronson.km_start_m)} → {fmtKm(tronson.km_end_m)}.</div>
      <label style={{ display: 'block', marginBottom: 10 }}>
        <span style={S.label}>Data lucrării</span>
        <input type="date" value={data} max={azi} min={scadeZile(azi, owner ? ZILE_INAPOI_OWNER : ZILE_INAPOI)} onChange={e => setData(e.target.value)} style={S.input} />
      </label>
      <label style={{ display: 'block', marginBottom: 10 }}>
        <span style={S.label}>Observații (opțional)</span>
        <input value={observatii} onChange={e => setObservatii(e.target.value)} maxLength={1000} style={S.input} />
      </label>
      {ok && <div style={{ fontSize: 14, color: G.text, marginBottom: 10 }}><b>{fmtLungime(panaLa - deLa)}</b> {ETICHETE_SCURTE[etapa].toLowerCase()}, km {fmtKm(deLa)} → {fmtKm(panaLa)}, {fmtZi(data)}</div>}
      {erori.length > 0 && (deLaTxt || panaLaTxt) && <ul style={{ margin: '0 0 10px', paddingLeft: 18, color: G.yellow, fontSize: 13 }}>{erori.map(x => <li key={x}>{x}</li>)}</ul>}
      {mesaj && <Mesaj m={mesaj} />}
      <button disabled={busy || nepregatit || !ok} onClick={() => onSalveaza({ tronsonId: tronson.id, etapa, deLa, panaLa, data, observatii })}
        style={{ ...S.btn, width: '100%', minHeight: 52, background: ok ? G.green : G.surface2, color: ok ? '#0D1117' : G.muted, border: 'none', opacity: busy ? 0.6 : 1, fontSize: 16 }}>
        {busy ? 'Se salvează…' : 'Raportează'}
      </button>
    </Foaie>
  )
}

function FormAnulare({ interval, intervale, busy, nepregatit, mesaj, onAnuleaza, onInchide }) {
  const [motiv, setMotiv] = useState('')
  const blocaj = blocajAnulare(interval, intervale)
  const ok = !blocaj && !!motiv.trim()
  return (
    <Foaie titlu={`Anulează: ${ETICHETE_SCURTE[interval.etapa]} km ${fmtKm(interval.km_de_la_m)} → ${fmtKm(interval.km_pana_la_m)}`} onInchide={onInchide}>
      <div style={{ fontSize: 13, color: G.muted, marginBottom: 10 }}>
        Lucrat {fmtZi(interval.data_lucru)}{interval.raportat_nume ? `, raportat de ${interval.raportat_nume}` : ''}. Raportarea rămâne în istoric, marcată anulată; porțiunea se poate raporta din nou.
      </div>
      {blocaj && <Alerta text={blocaj} />}
      <label style={{ display: 'block', marginBottom: 10 }}>
        <span style={S.label}>Motiv (obligatoriu)</span>
        <input value={motiv} onChange={e => setMotiv(e.target.value)} maxLength={500} style={S.input} />
      </label>
      {mesaj && <Mesaj m={mesaj} />}
      <button disabled={busy || nepregatit || !ok} onClick={() => onAnuleaza(interval, motiv)}
        style={{ ...S.btn, width: '100%', minHeight: 50, background: ok ? G.red : G.surface2, color: ok ? '#0D1117' : G.muted, border: 'none', opacity: busy ? 0.6 : 1 }}>
        {busy ? 'Se salvează…' : 'Anulează raportarea'}
      </button>
    </Foaie>
  )
}

function FormCameretaNoua({ tronson, camerete, azi, owner, busy, nepregatit, mesaj, onSalveaza, onInchide }) {
  const [cod, setCod] = useState('')
  const [kmTxt, setKmTxt] = useState('')
  const [montata, setMontata] = useState(false)
  const [data, setData] = useState(azi)
  const [observatii, setObservatii] = useState('')
  const km = parseKm(kmTxt)
  const erori = valideazaCameretaNoua({ tronson, cod, km, montata, data, azi, owner, camerete })
  const ok = erori.length === 0
  return (
    <Foaie titlu={`Cameretă lipsă pe ${tronson.cod}`} onInchide={onInchide}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <label style={{ display: 'block', marginBottom: 10, flex: '1 1 130px' }}>
          <span style={S.label}>Cod / număr</span>
          <input value={cod} onChange={e => setCod(e.target.value)} autoCapitalize="characters" maxLength={30} style={S.input} />
        </label>
        <label style={{ display: 'block', marginBottom: 10, flex: '1 1 130px' }}>
          <span style={S.label}>Km</span>
          <input value={kmTxt} onChange={e => setKmTxt(e.target.value)} placeholder="12+350" style={S.input} />
        </label>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 14 }}>
        <input type="checkbox" checked={montata} onChange={e => setMontata(e.target.checked)} style={{ width: 22, height: 22 }} /> E deja montată
      </label>
      {montata && (
        <label style={{ display: 'block', marginBottom: 10 }}>
          <span style={S.label}>Data montării</span>
          <input type="date" value={data} max={azi} onChange={e => setData(e.target.value)} style={S.input} />
        </label>
      )}
      <label style={{ display: 'block', marginBottom: 10 }}>
        <span style={S.label}>Observații (opțional)</span>
        <input value={observatii} onChange={e => setObservatii(e.target.value)} maxLength={1000} style={S.input} />
      </label>
      {erori.length > 0 && (cod || kmTxt) && <ul style={{ margin: '0 0 10px', paddingLeft: 18, color: G.yellow, fontSize: 13 }}>{erori.map(x => <li key={x}>{x}</li>)}</ul>}
      {mesaj && <Mesaj m={mesaj} />}
      <button disabled={busy || nepregatit || !ok} onClick={() => onSalveaza({ tronsonId: tronson.id, cod: normCodCamereta(cod), km, montata, data, observatii })}
        style={{ ...S.btn, width: '100%', minHeight: 50, background: ok ? G.green : G.surface2, color: ok ? '#0D1117' : G.muted, border: 'none', opacity: busy ? 0.6 : 1 }}>
        {busy ? 'Se salvează…' : 'Adaugă camereta'}
      </button>
    </Foaie>
  )
}

function FormCamereta({ c, laDeschidere, stareNoua, azi, owner, busy, nepregatit, mesaj, onSalveaza, onInchide }) {
  const [data, setData] = useState(azi)
  const [motiv, setMotiv] = useState('')
  const schimbat = c.versiune !== laDeschidere.versiune
  const cuMotiv = stareNoua !== 'montata'
  const min = scadeZile(azi, owner ? ZILE_INAPOI_OWNER : ZILE_INAPOI)
  const ok = !schimbat && (cuMotiv ? !!motiv.trim() : (/^\d{4}-\d{2}-\d{2}$/.test(data) && data <= azi && data >= min))
  const titlu = { montata: `Camereta ${c.cod}: montată`, de_montat: `Camereta ${c.cod}: anulează montarea`, anulata: `Camereta ${c.cod}: scoate din listă` }[stareNoua]
  return (
    <Foaie titlu={titlu} onInchide={onInchide}>
      <div style={{ fontSize: 13, color: G.muted, marginBottom: 10 }}>km {fmtKm(c.km_m)} · acum: {ETICHETE_CAMERETA[c.stare]}</div>
      {schimbat && <Alerta galben text={`Între timp camereta s-a schimbat (acum: ${ETICHETE_CAMERETA[c.stare] || c.stare}). Închide și redeschide ca să lucrezi pe starea actuală.`} />}
      {!cuMotiv && (
        <label style={{ display: 'block', marginBottom: 10 }}>
          <span style={S.label}>Data montării</span>
          <input type="date" value={data} max={azi} min={min} onChange={e => setData(e.target.value)} style={S.input} />
        </label>
      )}
      {cuMotiv && (
        <label style={{ display: 'block', marginBottom: 10 }}>
          <span style={S.label}>Motiv (obligatoriu)</span>
          <input value={motiv} onChange={e => setMotiv(e.target.value)} maxLength={500} style={S.input} />
        </label>
      )}
      {mesaj && <Mesaj m={mesaj} />}
      <button disabled={busy || nepregatit || !ok} onClick={() => onSalveaza(laDeschidere, { stareNoua, data, motiv })}
        style={{ ...S.btn, width: '100%', minHeight: 50, background: ok ? (cuMotiv ? G.red : G.green) : G.surface2, color: ok ? '#0D1117' : G.muted, border: 'none', opacity: busy ? 0.6 : 1 }}>
        {busy ? 'Se salvează…' : 'Salvează'}
      </button>
    </Foaie>
  )
}

// ── piese comune ──
function Sectiune({ titlu, children, deschisa, onComuta }) {
  const comutabila = typeof onComuta === 'function'
  return (
    <div style={{ background: G.surface, border: `1px solid ${G.border2}`, borderRadius: 12, padding: 12, marginBottom: 10 }}>
      {comutabila
        ? <button onClick={onComuta} style={{ ...S.btn, width: '100%', textAlign: 'left', minHeight: 44, background: 'transparent', border: 'none', padding: 0, fontSize: 14, fontWeight: 800 }}>{deschisa ? '▾' : '▸'} {titlu}</button>
        : <div style={{ fontSize: 14, fontWeight: 800, color: G.text, marginBottom: 6 }}>{titlu}</div>}
      {(!comutabila || deschisa) && <div style={{ marginTop: comutabila ? 8 : 0 }}>{children}</div>}
    </div>
  )
}
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
