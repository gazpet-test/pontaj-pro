/* Redari.jsx — Modul „Redări teren" (Lot 1 Transgaz): convocări proprietari, registru pe parcelă/deținător, PV.
   Contract: docs/redari/CONTRACT_SCHEMA.md (tabele red_*, vederea red_v_stare_parcela, RPC fn_red_numar_document).
   Ecrane: Registru · Fișa parcelei · Import TGZ · UAT-uri · Setări proiect (faza 2, felia 1). Nivel utilizator: admin / editor / viewer (user_module_access.redari; owner = admin).
   Fără date reale aici — doar structuri. */

import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from './lib/supabase.js'
import { STARI } from './redari/stare.js'
import { uat3 } from './redari/idParcela.js'
import { genereazaConvocator, verificaDateConvocator, salveazaConvocator, reincarcaConvocator, borderouCsv, descarcaBlob, BUCKET_REDARI } from './redari/docx.js'
// D4: convocatoarele generate dar neexpediate (citire separată din red_convocari, fără migrare)
import { citesteNeexpediatePeDetinatori, grupeazaNeexpediate, etichetaNeexpediat, textConfirmareNumarNou, poateGeneraNou, poateDescarcaExistent,
  poateDeschideConvocator, dataDocumentConvocare, useConvocariNeexpediate, aparuteDupaVerificare, rezervaNumarConvocare,
  AVERTISMENT_CONCURENTA } from './redari/convocatorNeexpediat.js'
import { G, S, fmtDate, azi, msgEroare, useToast, Modal, Camp, Gol, TagStare, CANALE_CONVOCARE, MOTIVE_RETUR, OPTIUNI_RASPUNS, etichetaOptiune, etichetaRetur,
  SABLON_CONVOCATOR, COL_DETINATOR, COL_CONVOCARE, citesteTokenRaspuns, motivBlocareGenerareNoua, citesteIn } from './redari/ui/comune.jsx'
import FisaParcela from './redari/ui/FisaParcela.jsx'
import ImportTgz from './redari/ui/ImportTgz.jsx'
import ImportPostal from './redari/ui/ImportPostal.jsx'
import PlicuriEcran from './redari/ui/PlicuriEcran.jsx'
import CorespondentaEcran from './redari/ui/CorespondentaEcran.jsx'
import UatEcran from './redari/ui/UatEcran.jsx'
import SetariProiect from './redari/ui/SetariProiect.jsx'
import TronsoaneEcran from './redari/ui/TronsoaneEcran.jsx'
import SesiuneEcran from './redari/ui/SesiuneEcran.jsx'
import DashboardEcran from './redari/ui/DashboardEcran.jsx'
// 📱 SMS proprietari (owner sau utilizator SMS cu Redari editor / admin, 20261130b; blocat in BD pana la autorizarea Transgaz)
import RedariSmsButon from './sms/RedariSmsButon.jsx'
// 📱 Starea SMS pe deținător (fn_red_sms_stare, 20261130i): doar agregate, fără text / telefon
import { citesteSmsStare, stareSmsPentru, potrivesteFiltru, csvListaSms } from './redari/smsStare.js'
import { CelulaSms, FiltruSms, RandStareRegistru } from './redari/ui/SmsRegistru.jsx'
import { filtruCautareSql, potrivesteCautare } from './redari/cautare.js'   // r3: aceeași regulă de căutare pe calea SQL și pe cea locală
import { paginiExport } from './redari/ui/ExportEcran.jsx'

const PAGINA = 100
// Proiectul LOT1 + cele 7 UAT-uri din brief (docs/redari/BRIEF_2026-11-01.md §2). text_gdpr / text_declaratie / contact_email NU se trimit:
// rămân DEFAULT-urile din BD (texte confirmate de Juridic, contract §2 [r2]). Fără telefoane.
const LOT1 = {
  cod:'LOT1-PRUNISOR-JUPA', denumire:'Redare teren — Lot 1 Prunișor–Jupa', beneficiar:'S.N.T.G.N. TRANSGAZ S.A.',
  contact_nume:'Ramona Brehui (delegat Gazpet)', reprezentant_gazpet_nume:'Răzvan Toma', reprezentant_gazpet_functie:'coordonator',
}
const UAT_LOT1 = ['Prunișor', 'Godeanu', 'Husnicioara', 'Căzănești', 'Ilovăț', 'Bâlvănești', 'Șișești']
const JUDET_LOT1 = 'Mehedinți'

// ════════════════════════════════════════════════════════════════════════════
export default function Redari() {
  const [searchParams] = useSearchParams()
  const proiectInitial = useRef(searchParams.get('proiect'))
  const selectieInitiala = useRef(false)
  const generatieProiecte = useRef(0)
  const { show, ToastContainer } = useToast()
  const [profile, setProfile] = useState(null)
  const [nivel, setNivel] = useState(null)         // 'admin' | 'editor' | 'viewer' | null
  const [gataProfil, setGataProfil] = useState(false)
  const [tab, setTab] = useState('registru')        // codurile din TABURI: 'dashboard' | 'sesiune' | 'tronsoane' | 'registru' | 'fisa' | 'import' | 'posta' | 'corespondenta' | 'uat' | 'setari'
  const [proiecte, setProiecte] = useState([])
  const [proiectId, setProiectId] = useState('')
  const [uats, setUats] = useState([])
  const [parcelaFisa, setParcelaFisa] = useState(null) // id parcela deschisă în fișă
  const [reload, setReload] = useState(0)

  // Profil + nivel: owner → admin; altfel user_module_access.redari (admin/editor/viewer)
  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { setGataProfil(true); return }
        const { data: p } = await supabase.from('profiles').select('id, name, email, is_owner').eq('id', user.id).maybeSingle()
        const { data: ma } = await supabase.from('user_module_access').select('module, access_level').eq('profile_id', user.id).eq('module', 'redari')
        const lvl = p?.is_owner ? 'admin' : (ma?.[0]?.access_level || null)
        setProfile(p ? { ...p, module_access_levels: { redari: ma?.[0]?.access_level || null } } : null)
        setNivel(['admin', 'editor', 'viewer'].includes(lvl) ? lvl : null)
      } catch (e) { show('Nu am putut citi profilul: ' + msgEroare(e), 'error') }
      finally { setGataProfil(true) }
    })()
  }, [show])

  const esteAdmin = nivel === 'admin'

  const incarcaProiecte = useCallback(async () => {
    const token = ++generatieProiecte.current
    const { data, error } = await supabase.from('red_proiecte').select('*').eq('activ', true).order('created_at')
    if (generatieProiecte.current !== token) return
    if (error) { show('Proiecte: ' + msgEroare(error), 'error'); return }
    setProiecte(data || [])
    const cerut = !selectieInitiala.current && (data || []).some(p => p.id === proiectInitial.current) ? proiectInitial.current : null
    selectieInitiala.current = true
    setProiectId(prev => cerut || (prev && (data || []).some(p => p.id === prev) ? prev : (data?.[0]?.id || '')))
  }, [show])
  useEffect(() => { if (gataProfil && nivel) incarcaProiecte(); return () => { generatieProiecte.current++ } }, [gataProfil, nivel, incarcaProiecte])

  useEffect(() => {
    // r3 P2-5: la schimbarea proiectului lista veche dispare imediat, iar un răspuns întârziat al cererii anterioare se ignoră
    setUats([])
    if (!proiectId) return
    let activ = true
    supabase.from('red_uat').select('*').eq('proiect_id', proiectId).order('nume').then(({ data, error }) => {
      if (!activ) return
      if (error) show('UAT-uri: ' + msgEroare(error), 'error'); else setUats(data || [])
    })
    return () => { activ = false }
  }, [proiectId, reload, show])

  const proiect = useMemo(() => proiecte.find(p => p.id === proiectId) || null, [proiecte, proiectId])

  // Creează proiectul LOT1 + cele 7 UAT-uri (doar admin, doar când nu există niciun proiect)
  const creeazaLot1 = async () => {
    if (!esteAdmin) return
    if (!window.confirm(`Creez proiectul ${LOT1.cod} cu ${UAT_LOT1.length} UAT-uri?`)) return
    const { data: pr, error } = await supabase.from('red_proiecte').insert({ ...LOT1, activ: true }).select().single()
    if (error) { show('Proiect: ' + msgEroare(error), 'error'); return }
    const randuri = UAT_LOT1.map(nume => ({ proiect_id: pr.id, nume, uat3: uat3(nume), judet: JUDET_LOT1 }))
    const { error: e2 } = await supabase.from('red_uat').insert(randuri)
    if (e2) { show('UAT-uri: ' + msgEroare(e2), 'error'); return }
    show(`Proiect ${pr.cod} creat cu ${randuri.length} UAT-uri.`, 'success')
    await incarcaProiecte()
  }

  const deschideFisa = (parcelaId) => { setParcelaFisa(parcelaId); setTab('fisa') }
  const inapoiLaRegistru = useCallback(() => setTab('registru'), [])   // stabil: FisaParcela îl are în deps
  // P1-5: schimbarea proiectului închide fișa (parcela e a altui proiect) și remontează Registrul (selecție + modale resetate prin key)
  const schimbaProiect = (id) => { setProiectId(id); setParcelaFisa(null); setTab(t => (t === 'fisa' ? 'registru' : t)) }

  if (!gataProfil) return <div style={S.page}><div style={{ color:G.muted }}>Se încarcă…</div></div>
  if (!nivel) return (
    <div style={S.page}>
      <div style={S.card}><b>Redări teren</b><div style={{ color:G.muted, marginTop:6, fontSize:13 }}>Nu ai un nivel de acces pe modulul „redari" (admin / editor / viewer). Cere-l administratorului.</div></div>
    </div>
  )

  const TABURI = [
    { cod:'dashboard', eticheta:'📊 Dashboard' },
    { cod:'sesiune', eticheta:'🗓️ Sesiune' },
    { cod:'registru', eticheta:'📋 Registru' },
    { cod:'fisa', eticheta:'📄 Fișa parcelei', dezactivat: !parcelaFisa },
    { cod:'tronsoane', eticheta:'🛤️ Tronsoane / PV C' },
    { cod:'import', eticheta:'📥 Import TGZ' },
    { cod:'posta', eticheta:'✉️ Poștă' },
    { cod:'corespondenta', eticheta:'📨 Corespondență' },
    { cod:'uat', eticheta:'🏛️ UAT-uri' },
    { cod:'setari', eticheta:'⚙️ Setări proiect' },
  ]

  return (
    <div style={S.page}>
      <ToastContainer />
      <div style={{ display:'flex', alignItems:'center', gap:14, flexWrap:'wrap', marginBottom:14 }}>
        <div style={{ fontSize:20, fontWeight:700 }}>🌾 Redări teren</div>
        <span style={{ ...S.tag, background:G.blueDim, color:G.blue }}>{nivel}</span>
        <div style={{ flex:1 }} />
        {proiecte.length > 0 ? (
          <select value={proiectId} onChange={e => schimbaProiect(e.target.value)} style={S.select}>
            {proiecte.map(p => <option key={p.id} value={p.id}>{p.cod} — {p.denumire || ''}</option>)}
          </select>
        ) : esteAdmin ? (
          <button onClick={creeazaLot1} style={S.btnP}>＋ Creează proiectul LOT1</button>
        ) : <span style={{ color:G.muted, fontSize:13 }}>Niciun proiect activ.</span>}
      </div>

      <div style={{ display:'flex', gap:4, borderBottom:`1px solid ${G.border2}`, marginBottom:14 }}>
        {TABURI.map(t => (
          <button key={t.cod} disabled={t.dezactivat} onClick={() => setTab(t.cod)}
            style={{ padding:'8px 14px', background:'transparent', border:'none', borderBottom: tab === t.cod ? `2px solid ${G.green}` : '2px solid transparent',
              color: t.dezactivat ? G.dim : tab === t.cod ? G.text : G.muted, cursor: t.dezactivat ? 'default' : 'pointer', fontSize:13.5, fontWeight:600 }}>
            {t.eticheta}
          </button>
        ))}
      </div>

      {!proiect ? <Gol text="Alege sau creează un proiect." /> : (
        <div key={proiect.id}>
          {tab === 'dashboard' && <DashboardEcran proiect={proiect} />}
          {tab === 'sesiune' && <SesiuneEcran proiect={proiect} nivel={nivel} show={show} />}
          {tab === 'tronsoane' && <TronsoaneEcran proiect={proiect} nivel={nivel} show={show} />} 
          {tab === 'registru' && <Registru key={reload} proiect={proiect} uats={uats} nivel={nivel} profile={profile} show={show} onDeschideFisa={deschideFisa} onPosta={() => setTab('posta')} />}
          {tab === 'fisa' && parcelaFisa && <FisaParcela parcelaId={parcelaFisa} proiect={proiect} uats={uats} nivel={nivel} profile={profile} show={show} onInapoi={inapoiLaRegistru} onSchimbat={() => setReload(r => r + 1)} />}
          {tab === 'import' && <ImportTgz proiect={proiect} uats={uats} nivel={nivel} show={show} onImportat={() => setReload(r => r + 1)} />}
          {tab === 'posta' && <><ImportPostal proiect={proiect} nivel={nivel} onSchimbat={() => setReload(r => r + 1)} /><PlicuriEcran key={proiect.id + nivel} proiect={proiect} uats={uats} nivel={nivel} reloadKey={reload} onSchimbat={() => setReload(r => r + 1)} /></>}
          {tab === 'corespondenta' && <CorespondentaEcran proiect={proiect} nivel={nivel} profile={profile} show={show} />}
          {tab === 'uat' && <UatEcran proiect={proiect} uats={uats} nivel={nivel} show={show} onSchimbat={() => setReload(r => r + 1)} />}
          {tab === 'setari' && <SetariProiect key={proiect.id} proiect={proiect} uats={uats} nivel={nivel} show={show} onSchimbat={incarcaProiecte} />}
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// REGISTRU — tabel din red_v_stare_parcela (o linie per parcelă × deținător)
// ════════════════════════════════════════════════════════════════════════════
function Registru({ proiect, uats, nivel, profile, show, onDeschideFisa, onPosta }) {
  const poateScrie = nivel === 'admin' || nivel === 'editor'
  const [randuri, setRanduri] = useState([])
  const [total, setTotal] = useState(0)
  const [pagina, setPagina] = useState(0)
  const [loading, setLoading] = useState(false)
  const [eroareRegistru, setEroareRegistru] = useState(null)   // r4 (P2-02): eroarea încărcării, separată de „zero rânduri”
  const [fUat, setFUat] = useState('')
  const [fTronson, setFTronson] = useState('')
  const [fStare, setFStare] = useState('')
  const [cautare, setCautare] = useState('')
  const [cautareAplicata, setCautareAplicata] = useState('')
  const [selectie, setSelectie] = useState(() => new Set())
  const [actiune, setActiune] = useState(null) // { tip, rand }
  const [lucru, setLucru] = useState(false)
  const [borderouRez, setBorderouRez] = useState(null) // { randuri, exclusi } — rezultatul borderoului, înainte de descărcare
  const generatie = useRef(0)   // r6 P2-1: contor de generație — răspunsul unei cereri depășite (filtru/pagină schimbate între timp) se ignoră
  // SMS (20261130i): un singur apel fn_red_sms_stare(proiect.id) → Map detinator_id → agregate. Eroarea e afișată, NU tratată ca „niciun SMS” (L18).
  const [fSms, setFSms] = useState('')
  const [sms, setSms] = useState({ harta: null, eroare: null })
  const generatieSms = useRef(0)
  // r2 (Jakarinos P2-2, L24): exportul „Lista SMS” are generația lui, invalidată la unmount și la schimbarea proiectului / filtrelor;
  // proiectCurent = proiectul afișat acum (verificat înainte de descărcare / toast)
  const generatieExport = useRef(0)
  const proiectCurent = useRef(proiect.id)
  proiectCurent.current = proiect.id
  useEffect(() => () => { generatieExport.current++; generatie.current++ }, [])
  const incarcaSms = useCallback(async () => {
    const g = ++generatieSms.current
    setSms({ harta: null, eroare: null })
    try {
      const harta = await citesteSmsStare(supabase, proiect.id, () => g === generatieSms.current)
      if (g !== generatieSms.current) return
      setSms({ harta, eroare: null })
    } catch (e) { if (g === generatieSms.current) setSms({ harta: null, eroare: msgEroare(e) }) }
  }, [proiect.id])
  useEffect(() => { incarcaSms(); return () => { generatieSms.current++ } }, [incarcaSms])
  const smsGata = !!sms.harta && !sms.eroare

  // Toate rândurile filtrelor de server (UAT / tronson / stare), paginate keyset pe cheia unică (parcela_id, detinator_id) — pentru filtrul SMS
  // (care nu există în vedere) și pentru CSV-ul „Lista SMS”. Căutarea se aplică apoi local (aceeași regulă: subșir, fără diferență de majuscule).
  const citesteToate = useCallback(async (curent) => {
    const tot = await paginiExport(() => {
      let q = supabase.from('red_v_stare_parcela').select('*').eq('proiect_id', proiect.id)
      if (fUat) q = q.eq('uat_id', fUat)
      if (fTronson === 'fara') q = q.is('tronson', null)
      else if (fTronson) q = q.eq('tronson', Number(fTronson))
      if (fStare) q = q.eq('stare', fStare)
      return q
    }, ['parcela_id', 'detinator_id'], curent)
    const cautat = tot.filter(r => potrivesteCautare(r, cautareAplicata))
    return cautat.sort((a, b) => String(a.id_parcela ?? '').localeCompare(String(b.id_parcela ?? ''), 'ro', { numeric: true })
      || String(a.nume ?? '').localeCompare(String(b.nume ?? ''), 'ro') || String(a.detinator_id).localeCompare(String(b.detinator_id)))
  }, [proiect.id, fUat, fTronson, fStare, cautareAplicata])

  const incarca = useCallback(async () => {
    const g = ++generatie.current
    let asteaptaSms = false   // r2 (P2-3): filtru SMS activ + hartă încă necitită = rămâne „Se încarcă…”, nu „Nicio parcelă”
    setLoading(true); setEroareRegistru(null)
    try {
      if (fSms) {
        // filtrul SMS se aplică pe TOATE rândurile filtrelor (nu pe pagina curentă), apoi se paginează local
        if (sms.eroare) throw new Error(`filtrul SMS nu se poate aplica: ${sms.eroare}`)
        if (!smsGata) { asteaptaSms = true; setRanduri([]); setTotal(0); return }   // harta încă se încarcă: incarca() rulează din nou când sosește (deps)
        const toate = (await citesteToate(() => g === generatie.current)).filter(r => potrivesteFiltru(stareSmsPentru(sms.harta, r.detinator_id), fSms))
        if (g !== generatie.current) return
        setRanduri(toate.slice(pagina * PAGINA, pagina * PAGINA + PAGINA)); setTotal(toate.length)
        return
      }
      let q = supabase.from('red_v_stare_parcela').select('*', { count:'exact' }).eq('proiect_id', proiect.id)
      if (fUat) q = q.eq('uat_id', fUat)
      if (fTronson === 'fara') q = q.is('tronson', null)   // parcelele încă neatribuite (după importul fără tronson)
      else if (fTronson) q = q.eq('tronson', Number(fTronson))
      if (fStare) q = q.eq('stare', fStare)
      const fCautare = filtruCautareSql(cautareAplicata)   // termen literal: wildcard-urile ILIKE / PostgREST scoase (src/redari/cautare.js)
      if (fCautare) q = q.or(fCautare)
      q = q.order('id_parcela').order('nume').range(pagina * PAGINA, pagina * PAGINA + PAGINA - 1)
      const { data, error, count } = await q
      if (g !== generatie.current) return   // a pornit o cerere mai nouă: rândurile și totalul acesteia nu se mai aplică
      if (error) throw error
      setRanduri(data || []); setTotal(count || 0)
    } catch (e) { if (g === generatie.current) { setRanduri([]); setTotal(0); setSelectie(new Set()); setEroareRegistru(msgEroare(e)); show('Registru: ' + msgEroare(e), 'error') } }   // r8/r9 P2-1: o încărcare eșuată nu lasă rândurile sau selecția anterioare (borderoul le-ar exporta)
    finally { if (g === generatie.current && !asteaptaSms) setLoading(false) }
  }, [proiect.id, fUat, fTronson, fStare, cautareAplicata, pagina, show, fSms, smsGata, sms.harta, sms.eroare, citesteToate])
  useEffect(() => { incarca() }, [incarca])
  // D4: convocatoarele generate, neexpediate, ale deținătorilor din pagina afișată (citire paginată pe loturi, L23).
  // Eroarea se afișează — nu e tratată ca „niciun convocator neexpediat”.
  const [neexp, setNeexp] = useState({ harta: null, eroare: null })
  const generatieNeexp = useRef(0)
  const incarcaNeexp = useCallback(async () => {
    const g = ++generatieNeexp.current
    const ids = [...new Set(randuri.map(r => r.detinator_id).filter(Boolean))]
    if (!ids.length) { setNeexp({ harta: new Map(), eroare: null }); return }
    setNeexp({ harta: null, eroare: null })
    try {
      const rows = await citesteNeexpediatePeDetinatori(supabase, ids)   // r2 P2-3: keyset complet, refuză răspunsul fără listă
      if (g === generatieNeexp.current) setNeexp({ harta: grupeazaNeexpediate(rows), eroare: null })
    } catch (e) { if (g === generatieNeexp.current) setNeexp({ harta: null, eroare: msgEroare(e) }) }
  }, [randuri])
  useEffect(() => { incarcaNeexp(); return () => { generatieNeexp.current++ } }, [incarcaNeexp])
  useEffect(() => { setPagina(0) }, [fUat, fTronson, fStare, cautareAplicata, fSms])
  // P1-4: selecția e a rândurilor VĂZUTE — se golește la orice schimbare de filtre / pagină
  useEffect(() => { setSelectie(new Set()); setRanduri([]); generatieExport.current++ }, [fUat, fTronson, fStare, cautareAplicata, pagina, fSms])   // r8 P2-1: și rândurile se invalidează

  const nrPagini = Math.max(1, Math.ceil(total / PAGINA))
  const toateSelectate = randuri.length > 0 && randuri.every(r => selectie.has(r.detinator_id))
  const comutaToate = () => setSelectie(prev => { const n = new Set(prev); if (toateSelectate) randuri.forEach(r => n.delete(r.detinator_id)); else randuri.forEach(r => n.add(r.detinator_id)); return n })
  const comuta = (id) => setSelectie(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  // P1-4: Borderoul Poștă = CONVOCĂRI concrete (canal poștă, active, cu fișier, neexpediate) ale deținătorilor din selecție / pagina
  // afișată, doar cu adresă cunoscută. Un rând = o convocare (nr_document al ei). Deținătorii fără așa ceva → „excluși” cu motiv.
  const borderou = async () => {
    if (!poateScrie) return
    const ids = selectie.size ? [...selectie] : randuri.map(r => r.detinator_id)
    if (!ids.length) { show('Nu e niciun rând de pus în borderou.', 'error'); return }
    setLucru(true)
    try {
      // r3 P2-3: citire paginată (loturi de 100 id-uri, range în bucle de 1000)
      const [contacte, conv, det] = await Promise.all([
        citesteIn(() => supabase.from('red_detinatori_contact').select('detinator_id, adresa_strada, adresa_sat, adresa_comuna, adresa_judet, cod_postal, adresa_cunoscuta').order('detinator_id'), 'detinator_id', ids),
        citesteIn(() => supabase.from('red_convocari').select('id, detinator_id, nr_document, created_at')
          .eq('canal', 'posta').eq('stare', 'activ').is('data_expediere', null).not('fisier_convocator_path', 'is', null).order('created_at').order('id'), 'detinator_id', ids),
        citesteIn(() => supabase.from('red_detinatori').select('id, nume, parcela_id, red_parcele(id_parcela)').is('sters_la', null).order('id'), 'id', ids),
      ])
      const cMap = Object.fromEntries((contacte || []).map(c => [c.detinator_id, c]))
      const dMap = Object.fromEntries((det || []).map(d => [d.id, d]))
      const convPeDet = {}; (conv || []).forEach(c => { (convPeDet[c.detinator_id] ||= []).push(c) })
      const randuriCsv = [], exclusi = []
      for (const id of ids) {
        const d = dMap[id]
        if (!d) { exclusi.push({ nume: '(deținător șters / indisponibil)', id_parcela: '', motiv: 'deținătorul nu mai e activ' }); continue }
        const c = cMap[id]
        const lista = convPeDet[id] || []
        if (!lista.length) { exclusi.push({ nume: d.nume, id_parcela: d.red_parcele?.id_parcela || '', motiv: 'fără convocator poștal neexpediat (generează-l întâi sau e deja expediat)' }); continue }
        if (!c || c.adresa_cunoscuta !== true) { exclusi.push({ nume: d.nume, id_parcela: d.red_parcele?.id_parcela || '', motiv: !c ? 'fără date de contact' : 'adresă necunoscută → afișare la primărie' }); continue }
        for (const cv of lista) randuriCsv.push({ nr_document: cv.nr_document, nume: d.nume, adresa: [c.adresa_strada, c.adresa_sat].filter(Boolean).join(', '),
          cod_postal: c.cod_postal || '', localitate: c.adresa_comuna || c.adresa_sat || '', judet: c.adresa_judet || '', id_parcela: d.red_parcele?.id_parcela || '' })
      }
      setBorderouRez({ randuri: randuriCsv, exclusi })
    } catch (e) { show('Borderou: ' + msgEroare(e), 'error') }
    finally { setLucru(false) }
  }
  const descarcaBorderou = () => {
    if (!borderouRez?.randuri.length) return
    descarcaBlob(borderouCsv(borderouRez.randuri), `borderou_${proiect.cod}_${azi()}.csv`)
    show(`Borderou descărcat: ${borderouRez.randuri.length} convocări.`, 'success')
    setBorderouRez(null)
  }

  // CSV „Lista SMS” (intern, fără telefon): toate rândurile filtrelor curente (inclusiv filtrul SMS), nu doar pagina
  const listaSms = async () => {
    if (!smsGata) { show(sms.eroare ? `Lista SMS: ${sms.eroare}` : 'Starea SMS încă se încarcă.', 'error'); return }
    const g = ++generatieExport.current, proiectId = proiect.id, cod = proiect.cod, harta = sms.harta
    const curent = () => g === generatieExport.current && proiectCurent.current === proiectId
    setLucru(true)
    try {
      const toate = (await citesteToate(curent)).filter(r => potrivesteFiltru(stareSmsPentru(harta, r.detinator_id), fSms))
      if (!curent()) return   // Registru demontat / alt proiect / filtre schimbate: fără descărcare și fără toast
      if (!toate.length) { show('Lista SMS: niciun rând pentru filtrele alese.', 'error'); return }
      descarcaBlob(new Blob([csvListaSms(toate, harta)], { type: 'text/csv;charset=utf-8' }), `lista_sms_${cod}_${azi()}.csv`)
      show(`Lista SMS descărcată: ${toate.length} rânduri.`, 'success')
    } catch (e) { if (curent()) show('Lista SMS: ' + msgEroare(e), 'error') }
    finally { setLucru(false) }   // butonul e blocat cât rulează (lucru), deci nu există alt export concurent de păstrat
  }

  const dupaActiune = () => { setActiune(null); incarca() }
  const tronsoane = useMemo(() => Array.from({ length: 11 }, (_, i) => i + 1), [])

  return (
    <div>
      {/* Filtre */}
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', marginBottom:10 }}>
        <select value={fUat} onChange={e => setFUat(e.target.value)} style={S.select}>
          <option value="">Toate UAT-urile</option>
          {uats.map(u => <option key={u.id} value={u.id}>{u.uat3} — {u.nume}</option>)}
        </select>
        <select value={fTronson} onChange={e => setFTronson(e.target.value)} style={S.select}>
          <option value="">Toate tronsoanele</option>
          <option value="fara">Fără tronson</option>
          {tronsoane.map(t => <option key={t} value={t}>Tronson {t}</option>)}
        </select>
        <select value={fStare} onChange={e => setFStare(e.target.value)} style={S.select}>
          <option value="">Toate stările</option>
          {STARI.map(s => <option key={s.cod} value={s.cod}>{s.eticheta}</option>)}
        </select>
        <FiltruSms valoare={fSms} onChange={setFSms} sms={sms} />
        <form onSubmit={e => { e.preventDefault(); setCautareAplicata(cautare.trim()) }} style={{ display:'flex', gap:6 }}>
          <input value={cautare} onChange={e => setCautare(e.target.value)} placeholder="Caută id parcelă / nume…" style={{ ...S.input, width:240 }} />
          <button type="submit" style={S.btnS}>Caută</button>
          {cautareAplicata && <button type="button" onClick={() => { setCautare(''); setCautareAplicata('') }} style={S.btnS}>✕</button>}
        </form>
        <div style={{ flex:1 }} />
        {/* r7 P2-1: blocat și cât se încarcă rândurile filtrului curent — altfel borderoul ar lua rândurile filtrului anterior */}
        {poateScrie && <button onClick={borderou} disabled={lucru || loading} style={S.btnS} title="CSV pentru Poștă: selecția sau rândurile afișate">📮 Borderou CSV {selectie.size ? `(${selectie.size})` : ''}</button>}
        {(profile?.is_owner === true || poateScrie) && <RedariSmsButon proiect={proiect} uats={uats} uatId={fUat} show={show} />}
        <button onClick={listaSms} disabled={lucru || loading || !smsGata} style={S.btnS} title="CSV intern: ID parcelă, UAT, deținător, SMS trimise / livrate / eșuate, ultima stare, date (fără telefon)">📱 Lista SMS</button>
        <button onClick={() => { incarca(); incarcaSms() }} style={S.btnS} title="Reîncarcă">↻</button>
      </div>
      {neexp.eroare && (
        <div role="alert" style={{ ...S.card, borderColor:G.red, color:G.red, fontSize:12.5, padding:'8px 12px', marginBottom:10 }}>
          ⚠ Convocatoarele generate și neexpediate nu s-au putut citi ({neexp.eroare}). Coloana „Convocare” nu le arată — nu înseamnă că nu există. <button style={S.btnX} onClick={incarcaNeexp}>Reîncearcă</button>
        </div>
      )}
      {sms.eroare && (
        <div role="alert" style={{ ...S.card, borderColor:G.red, color:G.red, fontSize:12.5, padding:'8px 12px', marginBottom:10 }}>
          ⚠ Starea SMS nu s-a putut citi ({sms.eroare}). Coloana „SMS” nu e completă — nu înseamnă „niciun SMS”. <button style={S.btnX} onClick={incarcaSms}>Reîncearcă</button>
        </div>
      )}

      <div style={{ ...S.card, padding:0, overflow:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr>
              {poateScrie && <th style={S.th}><input type="checkbox" checked={toateSelectate} onChange={comutaToate} /></th>}
              <th style={S.th}>ID parcelă</th><th style={S.th}>UAT</th><th style={S.th}>T</th><th style={S.th}>Deținător</th><th style={S.th}>Calitate</th>
              <th style={S.th}>Stare</th><th style={S.th}>Convocare</th><th style={S.th}>Răspuns</th><th style={S.th}>PV</th><th style={S.th}>SMS</th>
              {poateScrie && <th style={S.th}>Acțiuni</th>}
            </tr>
          </thead>
          <tbody>
            <RandStareRegistru loading={loading} eroare={eroareRegistru} fSms={fSms} nrRanduri={randuri.length} colSpan={poateScrie ? 12 : 10}
              onReincearca={() => { if (sms.eroare) incarcaSms(); else incarca() }} />
            {!loading && randuri.map(r => (
              <tr key={`${r.parcela_id}-${r.detinator_id}`} style={{ cursor:'pointer' }} onMouseEnter={e => e.currentTarget.style.background = '#1C2128'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                {poateScrie && <td style={S.td} onClick={e => e.stopPropagation()}><input type="checkbox" checked={selectie.has(r.detinator_id)} onChange={() => comuta(r.detinator_id)} /></td>}
                <td style={{ ...S.td, ...S.mono }} onClick={() => onDeschideFisa(r.parcela_id)}><span style={{ color:G.blue }}>{r.id_parcela}</span></td>
                <td style={S.td} onClick={() => onDeschideFisa(r.parcela_id)}>{r.uat3}</td>
                <td style={S.td} onClick={() => onDeschideFisa(r.parcela_id)}>{r.tronson ?? '-'}</td>
                <td style={S.td} onClick={() => onDeschideFisa(r.parcela_id)}>{r.nume}{r.decedat ? <span title="decedat" style={{ color:G.muted }}> †</span> : null}{r.cota ? <span style={{ color:G.dim, fontSize:11.5 }}> · {r.cota}</span> : null}</td>
                <td style={S.td} onClick={() => onDeschideFisa(r.parcela_id)}>{r.calitate}</td>
                <td style={S.td} onClick={() => onDeschideFisa(r.parcela_id)}><TagStare cod={r.stare} /></td>
                <td style={S.td} onClick={() => onDeschideFisa(r.parcela_id)}>
                  {fmtDate(r.ultima_convocare_data)}
                  {neexp.harta?.get(r.detinator_id)?.length > 0 && <div style={{ color:G.yellow, fontSize:11.5, whiteSpace:'nowrap' }} title="Generat, încă neexpediat. Un convocator nou ar consuma alt număr.">📄 {etichetaNeexpediat(neexp.harta.get(r.detinator_id))}</div>}
                </td>
                <td style={S.td} onClick={() => onDeschideFisa(r.parcela_id)} title={fmtDate(r.ultimul_raspuns_data)}>{r.ultimul_raspuns_optiune ? etichetaOptiune(r.ultimul_raspuns_optiune) : '-'}</td>
                <td style={S.td} onClick={() => onDeschideFisa(r.parcela_id)}>{r.pv_nr ? `${r.pv_nr} · ${r.pv_stare}` : '-'}</td>
                <td style={{ ...S.td, whiteSpace:'nowrap' }} onClick={() => onDeschideFisa(r.parcela_id)}><CelulaSms sms={sms} detinatorId={r.detinator_id} /></td>
                {poateScrie && (
                  <td style={{ ...S.td, whiteSpace:'nowrap' }}>
                    <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                      {(() => { const motiv = motivBlocareGenerareNoua(proiect, uats.find(u => u.id === r.uat_id), r); const exista = neexp.harta?.get(r.detinator_id) || []
                        // r2 P1-2: cu un fișier arhivat neexpediat, modalul rămâne accesibil pentru „Descarcă din nou” chiar dacă un document nou e blocat
                        const deschis = poateDeschideConvocator({ motiv, existente: neexp.harta ? exista : null }); return (
                        <button style={{ ...S.btnX, opacity: deschis ? 1 : 0.45, cursor: deschis ? 'pointer' : 'not-allowed', ...(exista.length ? { borderColor:G.yellow, color:G.yellow } : {}) }} disabled={!deschis}
                          title={!deschis ? `Nu se poate genera: ${motiv}` : exista.length ? `${etichetaNeexpediat(exista)} — deschide pentru descărcare / regenerare cu același număr${motiv ? ` (document nou blocat: ${motiv})` : ''}` : 'Generează convocator (DOCX)'}
                          onClick={() => setActiune({ tip:'convocator', rand:r })}>📄 Convocator{exista.length ? ' ⚠' : ''}</button>
                      ) })()}
                      <button style={S.btnX} title="Marchează expediat" onClick={() => setActiune({ tip:'expediat', rand:r })}>📤 Expediat</button>
                      <button style={S.btnX} title="Confirmare de primire (AR)" onClick={() => setActiune({ tip:'ar', rand:r })}>✅ AR</button>
                      <button style={S.btnX} title="Retur poștal" onClick={() => setActiune({ tip:'retur', rand:r })}>↩ Retur</button>
                      <button style={S.btnX} title="Răspuns telefonic" onClick={() => setActiune({ tip:'telefon', rand:r })}>📞 Răspuns</button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display:'flex', alignItems:'center', gap:10, marginTop:10, fontSize:12.5, color:G.muted }}>
        <span>{total} rânduri · pagina {pagina + 1} / {nrPagini}</span>
        <div style={{ flex:1 }} />
        <button style={S.btnS} disabled={pagina === 0} onClick={() => setPagina(p => p - 1)}>‹ Anterioara</button>
        <button style={S.btnS} disabled={pagina + 1 >= nrPagini} onClick={() => setPagina(p => p + 1)}>Următoarea ›</button>
      </div>

      {actiune?.tip === 'convocator' && <ModalConvocator rand={actiune.rand} proiect={proiect} uats={uats} show={show} onClose={() => setActiune(null)} onGata={dupaActiune} />}
      {actiune?.tip === 'expediat' && <ModalExpediat rand={actiune.rand} show={show} onClose={() => setActiune(null)} onGata={dupaActiune} onPosta={onPosta} />}
      {actiune?.tip === 'ar' && <ModalArRetur mod="ar" rand={actiune.rand} show={show} onClose={() => setActiune(null)} onGata={dupaActiune} onPosta={onPosta} />}
      {actiune?.tip === 'retur' && <ModalArRetur mod="retur" rand={actiune.rand} show={show} onClose={() => setActiune(null)} onGata={dupaActiune} onPosta={onPosta} />}
      {actiune?.tip === 'telefon' && <ModalRaspunsTelefon rand={actiune.rand} profile={profile} uats={uats} proiect={proiect} show={show} onClose={() => setActiune(null)} onGata={dupaActiune} />}
      {borderouRez && (
        <Modal titlu="Borderou Poștă" onClose={() => setBorderouRez(null)} latime={640}>
          <div style={{ fontSize:13, marginBottom:8 }}><b>{borderouRez.randuri.length}</b> convocări poștale neexpediate, cu fișier și adresă cunoscută{borderouRez.randuri.length ? ' — un rând per convocare (nr_document).' : '.'}</div>
          {borderouRez.exclusi.length > 0 && (
            <div style={{ marginBottom:10 }}>
              <div style={{ fontSize:12.5, color:G.yellow, fontWeight:600, marginBottom:4 }}>Excluși din borderou ({borderouRez.exclusi.length})</div>
              <div style={{ maxHeight:260, overflow:'auto', border:`1px solid ${G.border}`, borderRadius:7 }}>
                <table style={{ width:'100%', borderCollapse:'collapse' }}>
                  <thead><tr><th style={S.th}>Deținător</th><th style={S.th}>Parcelă</th><th style={S.th}>Motiv</th></tr></thead>
                  <tbody>{borderouRez.exclusi.map((x, i) => <tr key={i}><td style={S.td}>{x.nume}</td><td style={{ ...S.td, ...S.mono }}>{x.id_parcela}</td><td style={{ ...S.td, color:G.muted }}>{x.motiv}</td></tr>)}</tbody>
                </table>
              </div>
            </div>
          )}
          <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}>
            <button style={S.btnS} onClick={() => setBorderouRez(null)}>Închide</button>
            <button style={S.btnP} onClick={descarcaBorderou} disabled={!borderouRez.randuri.length}>⬇ Descarcă CSV ({borderouRez.randuri.length})</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─── Convocator: fn_red_numar_document('C') → genereazaConvocator → salveazaConvocator → descărcare ──────────────
function ModalConvocator({ rand, proiect, uats, show, onClose, onGata }) {
  const [canal, setCanal] = useState('posta')
  const [lucru, setLucru] = useState(false)
  const [pas, setPas] = useState('')
  const [lipsuri, setLipsuri] = useState([])   // din verificaDateConvocator — afișate în modal, fără număr consumat
  const uat = uats.find(u => u.id === rand.uat_id)
  const motiv = motivBlocareGenerareNoua(proiect, uat, rand)   // P2-11: precondiții (sesiune cu program, contact, GDPR, reprezentant TGZ, contract, împuternicire, calitate, adresă)
  // D4: convocatoarele generate și neexpediate ale deținătorului, citite PROASPĂT la deschidere (nu din Registru, care poate fi vechi).
  // null = se citește; eroare = generarea cu număr nou rămâne blocată (fail-closed) până la o citire reușită.
  // r2 P2-5 (L24): o singură citire valabilă (generație), legată de deținătorul ei (cheie), invalidată la unmount
  // r4 P2-03: cititor nou la fiecare setup al efectului (StrictMode / alt deținător), invalidat la cleanup-ul lui
  const [confirmNou, setConfirmNou] = useState(false)
  const citesteProaspat = useCallback(async (detId) => grupeazaNeexpediate(await citesteNeexpediatePeDetinatori(supabase, [detId])).get(detId) || [], [])
  const { existente, eroare: eroareCitire, reciteste: citesteExistente } = useConvocariNeexpediate(rand.detinator_id, citesteProaspat, { laCitire: () => setConfirmNou(false) })
  const eroareExistente = eroareCitire ? msgEroare(eroareCitire) : null
  // r3 P2-2 + r4 P2-02: montat + tokenul acțiunii — după fiecare await, nicio scriere NOUĂ, niciun show / onGata dacă acțiunea nu mai e curentă
  const montat = useRef(true)
  const tokenActiune = useRef(0)
  useEffect(() => { montat.current = true; return () => { montat.current = false; tokenActiune.current++ } }, [])
  const activ = (tok) => montat.current && tok === tokenActiune.current
  const reconciliaza = (tok) => { if (activ(tok)) citesteExistente() }
  // r4 P2-02: cât rulează o acțiune, ✕ și fundalul nu închid (scrierea începută trebuie terminată și reconciliată)
  const inchide = () => { if (lucru) { show('Așteaptă terminarea operației în curs — fereastra se poate închide după ce scrierea începută e finalizată și verificată.', 'error'); return } onClose() }
  const nouPermis = poateGeneraNou({ existente, eroare: eroareExistente, confirmat: confirmNou })

  // Datele comune (generare nouă și regenerare cu același număr): deținător, parcelă, contact (PII), token, verificare, șablon.
  // Întoarce null când lipsesc date (afișate în modal, FĂRĂ număr consumat).
  const pregatesteIntrare = async (tok) => {
    setPas('Citesc datele…')
    const [{ data: det, error: e1 }, { data: parcela, error: e3 }, { data: contactDetinator, error: e4 }, token] = await Promise.all([
      supabase.from('red_detinatori').select(COL_DETINATOR).eq('id', rand.detinator_id).single(),
      supabase.from('red_parcele').select('id, proiect_id, uat_id, id_parcela, tronson, sat, tarla, nr_cadastral, poz_hg, suprafata_temporara_mp, categoria_folosinta').eq('id', rand.parcela_id).single(),
      supabase.from('red_detinatori_contact').select('*').eq('detinator_id', rand.detinator_id).maybeSingle(),   // PII — doar admin/editor ajung aici
      citesteTokenRaspuns(rand.detinator_id),
    ])
    if (e1 || e3 || e4) throw (e1 || e3 || e4)
    if (!activ(tok)) return null
    setPas('Verific datele…')
    // `contact` = persoana de contact Gazpet ({nume, telefon, email}); null → docx.js ia proiect.contact_*
    const lipsa = verificaDateConvocator({ nrDocument: 'C-0000', token, uat, contact: null, proiect, detinator: det, contactDetinator: contactDetinator || null })
    if (lipsa.length) { setLipsuri(lipsa); show('Convocatorul nu se poate genera — vezi lipsurile din fereastră.', 'error'); return null }
    setPas('Descarc șablonul…')
    const rs = await fetch(SABLON_CONVOCATOR)
    if (!rs.ok) throw new Error(`Șablonul convocatorului lipsește (${rs.status}).`)
    const templateArrayBuffer = await rs.arrayBuffer()
    if (!activ(tok)) return null
    return { detinator: det, contactDetinator: contactDetinator || null, contact: null, parcela, uat, proiect, token, templateArrayBuffer }
  }

  // Ordinea (P2-8): date + contactul deținătorului → verificaDateConvocator (lipsuri → afișate, FĂRĂ număr consumat)
  // → fn_red_numar_document('C') → genereazaConvocator → salveazaConvocator (rând → upload → update) → descărcare.
  const genereaza = async () => {
    if (motiv) { show(`Nu se poate genera: ${motiv}.`, 'error'); return }
    if (!nouPermis) { show(existente?.length ? 'Există deja un convocator neexpediat: bifează confirmarea pentru un număr nou.' : 'Convocatoarele existente nu sunt încă verificate.', 'error'); return }
    setLucru(true); setLipsuri([])
    const tok = ++tokenActiune.current
    let scris = false   // r2 P1-1: din clipa rezervării numărului, orice ieșire (succes parțial, eroare) cere reconcilierea existentelor
    const vazute = existente   // lista văzută (și, dacă e nevidă, confirmată cu bifa) de operator
    try {
      const intrare = await pregatesteIntrare(tok)
      if (!intrare) return
      // r4 P2-01 (b): recitire proaspătă chiar înainte de rezervare — dacă între timp a apărut un convocator neexpediat
      // (alt utilizator / altă fereastră), oprim și cerem din nou bifa. Micșorează fereastra; NU e garanție atomică.
      setPas('Verific din nou convocatoarele existente…')
      const proaspete = await citesteProaspat(rand.detinator_id)
      if (!activ(tok)) return
      const noi = aparuteDupaVerificare(vazute, proaspete)
      if (noi.length) {
        citesteExistente()   // afișează lista nouă și resetează bifa
        show(`Între timp a fost generat ${noi.map(c => c.nr_document).join(', ')} pentru acest deținător — verifică lista și confirmă din nou dacă vrei totuși un număr nou.`, 'error')
        return
      }
      setPas('Rezerv numărul de document…')
      scris = true
      // r4 P2-01 (c): punctul de integrare pentru RPC-ul atomic din #989 (azi fn_red_numar_document)
      const nrDocument = await rezervaNumarConvocare(supabase, { uat3: rand.uat3, tronson: rand.tronson, detinatorId: rand.detinator_id, confirmateIds: (vazute || []).map(c => c.id) })
      // de aici scrierea e începută: continuă până la capăt (altfel numărul rămâne fără rând) și se reconciliază
      setPas(`Generez ${nrDocument}…`)
      const { blob, hash } = await genereazaConvocator({ ...intrare, nrDocument })
      setPas('Salvez în arhivă…')
      const { path } = await salveazaConvocator(supabase, { blob, hash, proiectCod: proiect.cod, uat3: rand.uat3, idParcela: rand.id_parcela, nrDocument, detinatorId: rand.detinator_id, canal })
      if (!activ(tok)) return   // salvarea s-a făcut; fereastra nu mai e a acestei acțiuni → fără descărcare / toast / onGata
      descarcaBlob(blob, `${nrDocument}_${rand.id_parcela}.docx`)
      show(`Convocator ${nrDocument} generat și salvat (${path}).`, 'success')
      onGata()
    } catch (e) { if (activ(tok)) show('Convocator: ' + msgEroare(e), 'error') }
    finally { if (scris) reconciliaza(tok); if (montat.current) { setLucru(false); setPas('') } }   // citesteExistente pune sincron „se citește” → număr nou blocat până la reconciliere
  }

  // D4: același număr, fără număr nou consumat — fișierul existent din arhivă (imutabil) se descarcă din nou
  const descarcaDinNou = async (c) => {
    setLucru(true)
    try {
      const { data: blob, error } = await supabase.storage.from(BUCKET_REDARI).download(c.fisier_convocator_path)
      if (error) throw error
      if (!montat.current) return
      descarcaBlob(blob, `${c.nr_document}_${rand.id_parcela}.docx`)
      show(`Convocator ${c.nr_document} descărcat din arhivă (niciun număr nou).`, 'success')
    } catch (e) { if (montat.current) show('Descărcare: ' + msgEroare(e), 'error') }
    finally { if (montat.current) setLucru(false) }
  }

  // D4: regenerează cu ACELAȘI număr (date actualizate) → versiune nouă {nr}-v{n}.docx, aceeași convocare (reincarcaConvocator)
  const regenereazaAcelasi = async (c) => {
    if (motiv) { show(`Nu se poate genera: ${motiv}.`, 'error'); return }
    setLucru(true); setLipsuri([])
    const tok = ++tokenActiune.current
    let scris = false
    try {
      const intrare = await pregatesteIntrare(tok)
      if (!intrare) return
      const dataDocument = dataDocumentConvocare(c)   // r3 P2-1: data civilă București a convocării (nu prefixul UTC)
      setPas(`Regenerez ${c.nr_document}…`)
      scris = true
      // r2 P2-4: aceeași dată ca documentul original (paritate cu Fișa parcelei și generarea în masă)
      const { blob, hash } = await genereazaConvocator({ ...intrare, nrDocument: c.nr_document, dataDocument })
      setPas('Salvez versiunea nouă…')
      const { path } = await reincarcaConvocator(supabase, { convocareId: c.id, blob, hash, proiectCod: proiect.cod, uat3: rand.uat3, idParcela: rand.id_parcela, nrDocument: c.nr_document })
      if (!activ(tok)) return
      descarcaBlob(blob, `${c.nr_document}_${rand.id_parcela}.docx`)
      show(`Convocator ${c.nr_document} regenerat cu același număr (${path}).`, 'success')
      onGata()
    } catch (e) { if (activ(tok)) show('Convocator: ' + msgEroare(e), 'error') }
    finally { if (scris) reconciliaza(tok); if (montat.current) { setLucru(false); setPas('') } }
  }

  return (
    <Modal titlu={`Generează convocator — ${rand.id_parcela}`} onClose={inchide}>
      <div style={{ fontSize:13, color:G.muted, marginBottom:10 }}>Deținător: <b style={{ color:G.text }}>{rand.nume}</b> · {rand.calitate} · UAT {uat?.nume || rand.uat3}</div>
      {motiv && <div style={{ ...S.card, borderColor:G.red, color:G.red, fontSize:12.5, marginBottom:10 }}>⛔ Nu se poate genera un document (nou sau regenerat): {motiv}. Completează datele UAT-ului / proiectului și revino.{existente?.some(poateDescarcaExistent) ? ' Fișierele deja arhivate se pot descărca mai jos.' : ''}</div>}
      {lipsuri.length > 0 && (
        <div style={{ ...S.card, borderColor:G.red, fontSize:12.5, marginBottom:10 }}>
          <div style={{ color:G.red, fontWeight:600, marginBottom:4 }}>⛔ Lipsesc date (niciun număr consumat):</div>
          <ul style={{ margin:0, paddingLeft:18, color:G.text }}>{lipsuri.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </div>
      )}
      {existente === null && !eroareExistente && <div style={{ fontSize:12.5, color:G.muted, marginBottom:10 }}>Verific convocatoarele deja generate…</div>}
      {eroareExistente && (
        <div role="alert" style={{ ...S.card, borderColor:G.red, color:G.red, fontSize:12.5, marginBottom:10 }}>
          ⚠ Nu am putut verifica dacă există deja un convocator neexpediat ({eroareExistente}). Generarea cu număr nou e blocată până la o verificare reușită. <button style={S.btnX} onClick={citesteExistente} disabled={lucru}>Reîncearcă</button>
        </div>
      )}
      {existente?.length > 0 && (
        <div style={{ ...S.card, borderColor:G.yellow, fontSize:12.5, marginBottom:10 }}>
          <div style={{ color:G.yellow, fontWeight:600, marginBottom:6 }}>⚠ Deținătorul are deja {existente.length === 1 ? 'un convocator generat, neexpediat' : `${existente.length} convocatoare generate, neexpediate`}:</div>
          {existente.map(c => (
            <div key={c.id} style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', marginBottom:6 }}>
              <span style={S.mono}>{c.nr_document}</span>
              <span style={{ color:G.muted }}>{c.canal} · generat {fmtDate(c.created_at)}{c.fisier_convocator_path ? '' : ' · fișier neîncărcat'}</span>
              <div style={{ flex:1 }} />
              {poateDescarcaExistent(c) && <button style={S.btnX} disabled={lucru} onClick={() => descarcaDinNou(c)} title="Descarcă fișierul din arhivă — fără număr nou">⬇ Descarcă din nou</button>}
              <button style={S.btnX} disabled={lucru || !!motiv} onClick={() => regenereazaAcelasi(c)} title="Regenerează cu datele actuale și ACELAȘI număr (versiune nouă a fișierului) — fără număr nou">🔁 Regenerează același număr</button>
            </div>
          ))}
          <label style={{ display:'flex', gap:6, alignItems:'flex-start', marginTop:6, color:G.text, cursor:'pointer' }}>
            <input type="checkbox" checked={confirmNou} onChange={e => setConfirmNou(e.target.checked)} disabled={lucru} style={{ marginTop:2 }} />
            <span>{textConfirmareNumarNou(existente)}</span>
          </label>
          <div style={{ color:G.muted, fontSize:11.5, marginTop:4 }}>ⓘ {AVERTISMENT_CONCURENTA}</div>
        </div>
      )}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
        <Camp eticheta="Canal (convocator nou)">
          <select value={canal} onChange={e => setCanal(e.target.value)} style={{ ...S.select, width:'100%' }}>{CANALE_CONVOCARE.filter(c => c !== 'telefon').map(c => <option key={c} value={c}>{c}</option>)}</select>
        </Camp>
      </div>
      <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:14, alignItems:'center' }}>
        {pas && <span style={{ fontSize:12, color:G.muted }}>{pas}</span>}
        <button style={S.btnS} onClick={onClose} disabled={lucru}>Renunță</button>
        <button style={{ ...S.btnP, opacity: motiv || !nouPermis ? 0.5 : 1 }} onClick={genereaza} disabled={lucru || !!motiv || !nouPermis}
          title={motiv || (eroareExistente ? 'Convocatoarele existente nu s-au putut verifica' : existente === null ? 'Se verifică convocatoarele existente…' : existente.length && !confirmNou ? 'Bifează confirmarea: se consumă un număr nou' : '')}>
          {lucru ? 'Lucrez…' : existente?.length ? 'Generează unul NOU (număr nou)' : 'Generează și descarcă'}
        </button>
      </div>
    </Modal>
  )
}

// ─── Alege convocarea activă a deținătorului (ultimele 20) ──────────────────────
function useConvocariDetinator(detinatorId, show) {
  const [lista, setLista] = useState(null)
  useEffect(() => {
    supabase.from('red_convocari').select(COL_CONVOCARE).eq('detinator_id', detinatorId).eq('stare', 'activ').order('created_at', { ascending:false }).limit(20)
      .then(({ data, error }) => { if (error) show('Convocări: ' + msgEroare(error), 'error'); setLista(data || []) })
  }, [detinatorId, show])
  return lista
}
const etichetaConvocare = (c) => `${c.nr_document} · ${c.canal} · ${c.data_expediere ? 'expediat ' + fmtDate(c.data_expediere) : 'neexpediat'}${c.data_confirmare_primire ? ' · AR ' + fmtDate(c.data_confirmare_primire) : ''}${c.retur ? ' · retur' : ''}`

// audit D10: convocările prin poștă se înregistrează pe plic — modalul are ieșire directă spre Poștă, nu doar textul.
function IesirePosta({ onPosta, onClose }) {
  return <>
    <p>Convocarea pleacă prin poștă: expedierea, AR-ul și returul se înregistrează pe plic, în Redări → Poștă → Plicuri.</p>
    <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:14 }}>
      <button style={S.btnS} onClick={onClose}>Închide</button>
      {onPosta && <button style={S.btnP} onClick={() => { onClose(); onPosta() }}>✉️ Deschide Poșta</button>}
    </div>
  </>
}

function ModalExpediat({ rand, show, onClose, onGata, onPosta }) {
  const lista = useConvocariDetinator(rand.detinator_id, show)
  const [convId, setConvId] = useState('')
  const [data, setData] = useState(azi())
  const [tracking, setTracking] = useState('')
  const [lucru, setLucru] = useState(false)
  useEffect(() => { if (lista && !convId) setConvId((lista.find(c => !c.data_expediere) || lista[0])?.id || '') }, [lista, convId])

  if (lista?.find(c => c.id === convId)?.canal === 'posta') return (
    <Modal titlu="Înregistrare poștală" onClose={onClose}>
      <Camp eticheta="Convocare"><select value={convId} onChange={e => setConvId(e.target.value)} style={S.select}>{lista.map(c => <option key={c.id} value={c.id}>{etichetaConvocare(c)}</option>)}</select></Camp>
      <IesirePosta onPosta={onPosta} onClose={onClose} />
    </Modal>
  )
  const salveaza = async () => {
    if (!convId) { show('Alege o convocare.', 'error'); return }
    if (!data) { show('Data expedierii e obligatorie.', 'error'); return }
    setLucru(true)
    try {
      const { error } = await supabase.from('red_convocari').update({ data_expediere: data, nr_tracking: tracking.trim() || null }).eq('id', convId)
      if (error) throw error
      show('Convocarea a fost marcată expediată.', 'success'); onGata()
    } catch (e) { show('Expediat: ' + msgEroare(e), 'error') }
    finally { setLucru(false) }
  }
  return (
    <Modal titlu={`Marchează expediat — ${rand.nume}`} onClose={onClose}>
      {lista === null ? <Gol text="Se încarcă…" /> : lista.length === 0 ? <Gol text="Deținătorul nu are nicio convocare activă. Generează întâi convocatorul." /> : (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          <Camp eticheta="Convocare" span={2}><select value={convId} onChange={e => setConvId(e.target.value)} style={{ ...S.select, width:'100%' }}>{lista.map(c => <option key={c.id} value={c.id}>{etichetaConvocare(c)}</option>)}</select></Camp>
          <Camp eticheta="Data expedierii"><input type="date" value={data} onChange={e => setData(e.target.value)} style={S.input} /></Camp>
          <Camp eticheta="Nr. tracking (AWB / recomandată)"><input value={tracking} onChange={e => setTracking(e.target.value)} style={S.input} placeholder="opțional" /></Camp>
        </div>
      )}
      <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:14 }}>
        <button style={S.btnS} onClick={onClose} disabled={lucru}>Renunță</button>
        <button style={S.btnP} onClick={salveaza} disabled={lucru || !lista?.length}>Salvează</button>
      </div>
    </Modal>
  )
}

function ModalArRetur({ mod, rand, show, onClose, onGata, onPosta }) {
  const lista = useConvocariDetinator(rand.detinator_id, show)
  const [convId, setConvId] = useState('')
  const [data, setData] = useState(azi())
  const [motiv, setMotiv] = useState(MOTIVE_RETUR[0].cod)
  const [lucru, setLucru] = useState(false)
  useEffect(() => { if (lista && !convId) setConvId((lista.find(c => c.data_expediere && !c.data_confirmare_primire && !c.retur) || lista[0])?.id || '') }, [lista, convId])
  const conv = lista?.find(c => c.id === convId)
  const arDupaRetur = mod === 'ar' && !!conv?.retur   // P2-10: se permite, dar explicit

  if (lista?.find(c => c.id === convId)?.canal === 'posta') return (
    <Modal titlu="Înregistrare poștală" onClose={onClose}>
      <Camp eticheta="Convocare"><select value={convId} onChange={e => setConvId(e.target.value)} style={S.select}>{lista.map(c => <option key={c.id} value={c.id}>{etichetaConvocare(c)}</option>)}</select></Camp>
      <IesirePosta onPosta={onPosta} onClose={onClose} />
    </Modal>
  )
  const salveaza = async () => {
    if (!convId) { show('Alege o convocare.', 'error'); return }
    if (!data) { show('Data e obligatorie.', 'error'); return }
    setLucru(true)
    try {
      const upd = mod === 'ar' ? { data_confirmare_primire: data } : { retur: motiv, retur_data: data }
      const { error } = await supabase.from('red_convocari').update(upd).eq('id', convId)
      if (error) throw error
      show(mod === 'ar' ? 'Confirmarea de primire a fost înregistrată.' : 'Returul a fost înregistrat.', 'success'); onGata()
    } catch (e) { show((mod === 'ar' ? 'AR: ' : 'Retur: ') + msgEroare(e), 'error') }
    finally { setLucru(false) }
  }
  return (
    <Modal titlu={`${mod === 'ar' ? 'Confirmare de primire (AR)' : 'Retur poștal'} — ${rand.nume}`} onClose={onClose}>
      {lista === null ? <Gol text="Se încarcă…" /> : lista.length === 0 ? <Gol text="Deținătorul nu are nicio convocare activă." /> : (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          <Camp eticheta="Convocare" span={2}><select value={convId} onChange={e => setConvId(e.target.value)} style={{ ...S.select, width:'100%' }}>{lista.map(c => <option key={c.id} value={c.id}>{etichetaConvocare(c)}</option>)}</select></Camp>
          <Camp eticheta={mod === 'ar' ? 'Data confirmării' : 'Data returului'}><input type="date" value={data} onChange={e => setData(e.target.value)} style={S.input} /></Camp>
          {mod === 'retur' && <Camp eticheta="Motiv retur"><select value={motiv} onChange={e => setMotiv(e.target.value)} style={{ ...S.select, width:'100%' }}>{MOTIVE_RETUR.map(m => <option key={m.cod} value={m.cod}>{m.eticheta}</option>)}</select></Camp>}
          {arDupaRetur && <div style={{ gridColumn:'span 2', ...S.card, borderColor:G.yellow, color:G.yellow, fontSize:12.5 }}>⚠ Convocarea {conv.nr_document} are retur ({etichetaRetur(conv.retur)}, {fmtDate(conv.retur_data)}). AR ulterior returului → convocarea se consideră <b>confirmată</b> (returul rămâne în istoric).</div>}
        </div>
      )}
      <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:14 }}>
        <button style={S.btnS} onClick={onClose} disabled={lucru}>Renunță</button>
        <button style={S.btnP} onClick={salveaza} disabled={lucru || !lista?.length}>Salvează</button>
      </div>
    </Modal>
  )
}

function ModalRaspunsTelefon({ rand, profile, uats, proiect, show, onClose, onGata }) {
  const uat = uats.find(u => u.id === rand.uat_id)
  const zile = [uat?.sesiune_zi1, uat?.sesiune_zi2, uat?.sesiune_zi3].filter(Boolean)
  // r3 P2-4: „particip” se poate alege DOAR dacă UAT-ul are zile de sesiune; ziua vine strict din lista UAT-ului (fără câmp liber)
  const faraSesiune = zile.length === 0
  const [optiune, setOptiune] = useState(faraSesiune ? 'nu_particip_fara_obiectii' : 'particip')
  const [zi, setZi] = useState(zile[0] || '')
  const [obiectii, setObiectii] = useState('')
  const [sursa, setSursa] = useState('')
  const [declaratie, setDeclaratie] = useState(false)     // P2-2: bifă explicită pentru „nu particip – fără obiecții”
  const [raspunsId, setRaspunsId] = useState(null)        // P2-2: răspunsul s-a salvat, nota (meta) nu — se reîncearcă fără a pierde nimic
  const [lucru, setLucru] = useState(false)
  const cereZi = optiune === 'particip'
  const cereDeclaratie = optiune === 'nu_particip_fara_obiectii'
  const cereObiectii = optiune === 'nu_particip_cu_obiectii' || optiune === 'constatare_teren'
  const textDeclaratie = (proiect?.text_declaratie && String(proiect.text_declaratie).trim()) || 'textul declarației (red_proiecte.text_declaratie)'

  const scrieNota = async (id) => {
    const operator = profile?.name || profile?.email || 'operator'
    const { error } = await supabase.from('red_raspunsuri_meta').insert({ raspuns_id: id, ip_sau_sursa: `telefon, operator ${operator}${sursa.trim() ? ' — ' + sursa.trim() : ''}`.slice(0, 500) })
    if (error) throw error
  }

  const salveaza = async () => {
    if (cereObiectii && !obiectii.trim()) { show('Pentru această opțiune obiecțiile sunt obligatorii.', 'error'); return }
    if (cereZi && faraSesiune) { show('UAT-ul nu are zile de sesiune stabilite — „particip” nu se poate înregistra încă.', 'error'); return }
    if (cereZi && !zile.includes(zi)) { show('Alege ziua de sesiune din lista UAT-ului.', 'error'); return }
    if (cereDeclaratie && !declaratie) { show('Bifează că deținătorul a confirmat verbal textul declarației.', 'error'); return }
    setLucru(true)
    try {
      let id = raspunsId
      if (!id) {
        // [r2] red_raspunsuri nu mai are ip_sau_sursa: rândul principal întâi, apoi nota în red_raspunsuri_meta
        const { data: rasp, error } = await supabase.from('red_raspunsuri').insert({
          detinator_id: rand.detinator_id, canal:'telefon', optiune,
          zi_sesiune_aleasa: cereZi ? zi : null,                       // doar pentru „particip”
          obiectii_text: cereObiectii ? obiectii.trim() : null,
          declaratie_confirmata: cereDeclaratie ? true : null,         // bifa explicită de mai sus
          created_by: profile?.id || null,
        }).select('id').single()
        if (error) throw error
        id = rasp.id; setRaspunsId(id)
      }
      try { await scrieNota(id) }
      catch (eMeta) { show('Răspunsul s-a salvat, dar nota (sursa) nu: ' + msgEroare(eMeta) + '. Apasă „Reîncearcă nota”.', 'error'); return }
      show('Răspunsul telefonic a fost înregistrat.', 'success')
      onGata()
    } catch (e) { show('Răspuns: ' + msgEroare(e), 'error') }
    finally { setLucru(false) }
  }
  return (
    <Modal titlu={`Răspuns telefonic — ${rand.nume}`} onClose={onClose}>
      {raspunsId && <div style={{ ...S.card, borderColor:G.yellow, color:G.yellow, fontSize:12.5, marginBottom:10 }}>Răspunsul e salvat; a rămas de scris nota cu sursa. Poți corecta sursa și apăsa „Reîncearcă nota”.</div>}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
        <Camp eticheta="Opțiune" span={2}>
          <select value={optiune} onChange={e => setOptiune(e.target.value)} disabled={!!raspunsId} style={{ ...S.select, width:'100%' }}>
            {OPTIUNI_RASPUNS.map(o => <option key={o.cod} value={o.cod} disabled={o.cod === 'particip' && faraSesiune}>{o.eticheta}{o.cod === 'particip' && faraSesiune ? ' — indisponibil: UAT-ul nu are zile de sesiune' : ''}</option>)}
          </select>
          {faraSesiune && <div style={{ fontSize:12, color:G.yellow, marginTop:4 }}>⚠ UAT-ul {uat?.nume || rand.uat3} nu are zile de sesiune stabilite: „particip” se poate înregistra după ce se completează sesiunea.</div>}
        </Camp>
        {cereZi && !faraSesiune && (
          <Camp eticheta="Ziua de sesiune aleasă (obligatoriu, din zilele UAT-ului)">
            <select value={zi} onChange={e => setZi(e.target.value)} disabled={!!raspunsId} style={{ ...S.select, width:'100%' }}><option value="">—</option>{zile.map((z, i) => <option key={z} value={z}>Ziua {i + 1}: {fmtDate(z)}{uat?.[`program_zi${i + 1}`] ? ` · ${uat[`program_zi${i + 1}`]}` : ''}</option>)}</select>
          </Camp>
        )}
        <Camp eticheta="Sursa (nr. telefon apelat / notă)"><input value={sursa} onChange={e => setSursa(e.target.value)} style={S.input} placeholder="opțional" /></Camp>
        {cereDeclaratie && (
          <div style={{ gridColumn:'span 2' }}>
            <div style={{ ...S.card, fontSize:12.5, color:G.muted, marginBottom:6 }}>{textDeclaratie}</div>
            <label style={{ fontSize:13, display:'flex', gap:8, alignItems:'flex-start', cursor:'pointer' }}>
              <input type="checkbox" checked={declaratie} onChange={e => setDeclaratie(e.target.checked)} disabled={!!raspunsId} style={{ marginTop:2 }} />
              <span>Deținătorul a confirmat verbal textul declarației de mai sus (obligatoriu).</span>
            </label>
          </div>
        )}
        {cereObiectii && <Camp eticheta="Obiecții (obligatoriu)" span={2}><textarea value={obiectii} onChange={e => setObiectii(e.target.value)} disabled={!!raspunsId} rows={4} style={{ ...S.input, resize:'vertical' }} maxLength={4000} /></Camp>}
      </div>
      <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:14 }}>
        <button style={S.btnS} onClick={onClose} disabled={lucru}>{raspunsId ? 'Închide (fără notă)' : 'Renunță'}</button>
        <button style={S.btnP} onClick={salveaza} disabled={lucru}>{lucru ? 'Lucrez…' : raspunsId ? 'Reîncearcă nota' : 'Salvează'}</button>
      </div>
    </Modal>
  )
}
