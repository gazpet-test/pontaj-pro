// ════════════════════════════════════════════════════════════════════════════
// FaraSantierBulkModal — Alocare manuală bulk pentru alimentări fără șantier
// 25.05.2026 — Etapa 4 WhatsApp Motorină, complement la Import WhatsApp
// ════════════════════════════════════════════════════════════════════════════
// Workflow:
//   1. Fetch alimentări cu site_id IS NULL: lista cardurilor din TOATE (keyset, doar id + card); fără card ales
//      cele mai noi 500 (data DESC) + totalul; cu card ales toate rândurile cardului, filtrate pe server
//      (alimentariAlocare.js, TKT-2026-0383/0387)
//   2. Per row: dropdown șantier + mass action „aplică pe toate filtrate"
//   3. La save: UPDATE-uri batch (Promise.all max 50 simultan) cu:
//        site_id = X
//        sursa_alocare_santier = 'manual'
//        aloc_santier_de = profile.id
//        aloc_santier_la = now()
//   4. Refresh count în AlimentariBulkPage prin callback onSaved()
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { supabase } from './lib/supabase.js'
import { FARA_CARD, filtreazaAlimentari, selectieMasa, selectiiDeSalvat, luniDin, statiiDin, optiuniFiltru, filtreFaraOptiune, faraSelectiileSalvate } from './alimentariFaraSantierFiltru.js'
import { citesteIndexCarduri, citesteAlimentariCard, citesteAlimentariRecente, salveazaAlocariBulk } from './alimentariAlocare.js'

// Theme — paletă G identică cu Logistica.jsx
const G = {
  bg:'#0D1117', surface:'#161B22', border:'#21262D', border2:'#30363D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  blue:'#58A6FF', green:'#3FB950', red:'#F85149', yellow:'#D29922',
  purple:'#BC8CFF', orange:'#F0883E',
  greenDim:'#1A3A1A', redDim:'#3A1A1A', yellowDim:'#3A2A0A',
  logistica:'#E3B341',
}

const fmtDate = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// „YYYY-MM” → „noiembrie 2026”, fără new Date() pe text (L17); altă formă = textul brut
const LUNI_RO = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie']
const numeLuna = (m) => {
  const p = /^(\d{4})-(\d{2})$/.exec(m || '')
  const i = p ? Number(p[2]) - 1 : -1
  return i >= 0 && i < 12 ? `${LUNI_RO[i]} ${p[1]}` : String(m)
}

const fmtDateTime = (iso) => {
  if (!iso) return ''
  return new Date(iso).toLocaleString('ro-RO', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function FaraSantierBulkModal({ sites, profile, showToast, onClose, onSaved }) {
  const [loading, setLoading] = useState(true)
  const [alimentari, setAlimentari] = useState([])     // toate alim fără șantier
  const [selections, setSelections] = useState({})     // map: alim_id → site_id
  const [saving, setSaving] = useState(false)
  const [savedCount, setSavedCount] = useState(0)
  
  // Filtre
  const [filterLuna, setFilterLuna] = useState('toate')     // 'toate' | YYYY-MM
  const [filterVehicul, setFilterVehicul] = useState('')    // text search
  const [filterStatie, setFilterStatie] = useState('toate') // 'toate' | nume stație
  const [filterWhatsApp, setFilterWhatsApp] = useState('toate') // 'toate' | 'cu_wa' | 'fara_wa'
  const [filterCard, setFilterCard] = useState('toate')       // 'toate' | FARA_CARD | card (TKT-2026-0383/0387)
  const [totalServer, setTotalServer] = useState(null)        // câte sunt în BD (count), ca să se vadă trunchierea
  const [carduri, setCarduri] = useState(null)                // indexul cardurilor pe TOATE alimentările fără șantier (alimentariAlocare.js)
  const [eroare, setEroare] = useState(null)                  // eroarea ultimei încărcări (≠ listă goală)

  // Mass action
  const [massSantierId, setMassSantierId] = useState('')

  // L24: fiecare încărcare are un număr de generație; un răspuns sosit după o schimbare de filtru (sau după
  // închiderea modalului) nu se mai aplică.
  const genRef = useRef(0)
  const showToastRef = useRef(showToast)
  showToastRef.current = showToast
  // Cardul ales ACUM (nu cel din closure-ul unei salvări pornite mai demult): reîncărcarea de după salvare îl
  // citește de aici (review #1184 r2). saveGenRef: rezultatul unei salvări se aplică doar cât modalul e deschis.
  const filterCardRef = useRef(filterCard)
  filterCardRef.current = filterCard
  const saveGenRef = useRef(0)
  useEffect(() => () => { genRef.current++; saveGenRef.current++ }, [])

  // Încărcare: (1) indexul cardurilor pe toate alimentările fără șantier (keyset, nu primele 500);
  // (2) fără card ales = cele mai noi 500 (+ totalul, pentru avertisment); cu card ales = TOATE rândurile
  // cardului, cu filtru pe server.
  const loadAlim = useCallback(async (card) => {
    const gen = ++genRef.current
    setLoading(true)
    setEroare(null)
    try {
      const idx = await citesteIndexCarduri(supabase)
      if (gen !== genRef.current) return
      let randuri, total
      if (card === 'toate') ({ randuri, total } = await citesteAlimentariRecente(supabase))
      else { randuri = await citesteAlimentariCard(supabase, card, idx); total = null }
      if (gen !== genRef.current) return
      setCarduri(idx)
      setAlimentari(randuri)
      setTotalServer(total)
    } catch (e) {
      if (gen !== genRef.current) return
      const msg = e?.message || String(e)
      setEroare(msg)
      setAlimentari([])
      setTotalServer(null)
      showToastRef.current?.('Eroare încărcare: ' + msg, 'error')
    } finally {
      if (gen === genRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => { loadAlim(filterCard) }, [loadAlim, filterCard])
  
  // Liste pentru filtre
  // Luna / stația aleasă rămâne în listă ca „(fără rezultate)” dacă noul set de rânduri (alt card, reîncărcare) nu o
  // mai are — altfel selectorul ar arăta „Toate” peste un tabel gol (review #1184 r2; alimentariFaraSantierFiltru.js).
  const optiuniLuna = useMemo(() => optiuniFiltru(luniDin(alimentari), filterLuna), [alimentari, filterLuna])
  const optiuniStatie = useMemo(() => optiuniFiltru(statiiDin(alimentari), filterStatie), [alimentari, filterStatie])
  const filtreRamase = useMemo(() => filtreFaraOptiune(alimentari, { luna: filterLuna, statie: filterStatie }), [alimentari, filterLuna, filterStatie])
  const resetFiltre = () => { setFilterLuna('toate'); setFilterStatie('toate'); setFilterWhatsApp('toate'); setFilterVehicul('') }

  // Opțiunile de card vin din index (toate alimentările fără șantier). Cardul ales rămâne în listă chiar dacă
  // între timp nu mai are rânduri (altfel dropdown-ul ar arăta alt card decât filtrul aplicat).
  const optiuniCard = useMemo(() => {
    const lista = carduri?.carduri || []
    if (filterCard !== 'toate' && filterCard !== FARA_CARD && !lista.some(c => c.card === filterCard)) return [...lista, { card: filterCard, nr: 0 }]
    return lista
  }, [carduri, filterCard])
  const faraCardNr = carduri?.faraCard || 0

  // Alimentări filtrate (logica în alimentariFaraSantierFiltru.js, cu teste)
  const filtered = useMemo(() => filtreazaAlimentari(alimentari, {
    luna: filterLuna, statie: filterStatie, whatsapp: filterWhatsApp, card: filterCard, vehicul: filterVehicul,
  }), [alimentari, filterLuna, filterVehicul, filterStatie, filterWhatsApp, filterCard])

  // Selecții active pentru save: doar rândurile vizibile cu filtrele curente
  const validSelections = useMemo(() => selectiiDeSalvat(selections, filtered), [selections, filtered])
  const trunchiat = totalServer !== null && totalServer > alimentari.length
  
  // Stats
  const totalLitri = useMemo(() => filtered.reduce((s, a) => s + Number(a.cantitate_litri || 0), 0), [filtered])
  const totalCost = useMemo(() => filtered.reduce((s, a) => s + Number(a.pret_total || 0), 0), [filtered])
  const cuWhatsApp = useMemo(() => filtered.filter(a => a.whatsapp_caption).length, [filtered])
  
  // Handler: setare șantier pe row
  const handleSetSite = (alimId, siteId) => {
    setSelections(prev => ({ ...prev, [alimId]: siteId || null }))
  }
  
  // Handler: mass action - aplică șantier pe toate filtrate
  const handleMassApply = () => {
    if (!massSantierId) {
      showToast('Selectează un șantier mai întâi', 'warn')
      return
    }
    const updates = selectieMasa(filtered, massSantierId)
    setSelections(prev => ({ ...prev, ...updates }))
    showToast(`✅ ${filtered.length} alocări preselectate. Verifică și apoi salvează.`, 'success')
  }
  
  // Handler: clear toate selecțiile
  const handleClearAll = () => {
    setSelections({})
    setMassSantierId('')
  }
  
  // Handler: save bulk
  const handleSave = async () => {
    if (loading || saving) return   // lista se reîncarcă: nu se salvează pe rânduri care nu mai sunt pe ecran
    if (validSelections.length === 0) {
      showToast('Nu există alocări de salvat', 'warn')
      return
    }
    if (!confirm(`Confirmi alocarea a ${validSelections.length} alimentări la șantierele selectate?`)) return
    
    const tok = ++saveGenRef.current
    const trimise = validSelections
    setSaving(true)
    // CAS pe site_id IS NULL, în loturi de 30 (alimentariAlocare.js, cu teste): conflicte = rânduri care
    // primiseră deja șantier între timp; o eroare de server / rețea e eroare, nu conflict.
    let rez
    try {
      rez = await salveazaAlocariBulk(supabase, trimise, { profileId: profile?.id || null })
    } catch (e) {
      rez = { success: 0, conflicte: 0, errors: [{ id: null, msg: e?.message || String(e) }] }
    }
    if (tok !== saveGenRef.current) return   // modalul s-a închis între timp
    const { success, conflicte, errors } = rez

    setSavedCount(success)
    setSaving(false)

    // Reîncărcarea după conflict / eroare folosește filtrul de ACUM (filterCardRef), nu cel de la pornirea salvării;
    // loadAlim ia o generație nouă, deci un răspuns mai vechi (ex. schimbarea de card făcută în timpul salvării) nu
    // se mai aplică peste ea. Se scot doar selecțiile trimise; cele alese între timp rămân.
    if (conflicte > 0 && errors.length === 0) {
      showToast(`⚠️ ${success} salvate, ${conflicte} aveau deja șantier (alocate între timp) — lista s-a reîncărcat`, 'warn')
      setSelections(prev => faraSelectiileSalvate(prev, trimise))
      loadAlim(filterCardRef.current)
    } else if (errors.length === 0) {
      showToast(`✅ ${success} alimentări alocate cu succes!`, 'success')
      // Auto-close după success complet (după 1 sec ca să se vadă toast-ul)
      setTimeout(() => { if (onSaved) onSaved() }, 1000)
    } else {
      showToast(`⚠️ ${success} salvate, ${errors.length} erori${conflicte ? `, ${conflicte} alocate între timp` : ''} (vezi console)`, 'warn')
      console.error('Erori save:', errors)
      // Refresh date ca să vadă ce s-a salvat
      setSelections(prev => faraSelectiileSalvate(prev, trimise))
      loadAlim(filterCardRef.current)
    }
  }

  // Cât salvarea e în curs modalul nu se închide (nici din fundal / ×), ca rezultatul să ajungă la utilizator.
  const inchide = () => { if (!saving) onClose?.() }
  
  // ────────────────────────── RENDER ──────────────────────────
  
  return (
    <div 
      style={{
        position:'fixed', inset:0, background:'rgba(0,0,0,0.78)',
        zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center',
        padding:20
      }}
      onClick={inchide}
    >
      <div 
        style={{
          background:G.surface, border:`1px solid ${G.border2}`, borderRadius:14,
          width:'100%', maxWidth:1300, maxHeight:'92vh', overflow:'hidden',
          display:'flex', flexDirection:'column'
        }} 
        onClick={e => e.stopPropagation()}
      >
        
        {/* HEADER */}
        <div style={{
          padding:'16px 22px', borderBottom:`1px solid ${G.border}`,
          display:'flex', justifyContent:'space-between', alignItems:'center', gap:16,
          flexWrap:'wrap'
        }}>
          <div>
            <div style={{fontSize:18, fontWeight:800, color:G.red}}>🚨 Alocare manuală șantier — Bulk Edit</div>
            <div style={{fontSize:12, color:G.muted, marginTop:2}}>
              {loading ? 'Se încarcă...' : eroare ? 'Lista nu s-a putut încărca' : filterCard === 'toate'
                ? `${carduri ? carduri.total : alimentari.length} alimentări fără șantier · ${filtered.length} afișate cu filtrele curente`
                : `${alimentari.length} alimentări fără șantier pe ${filterCard === FARA_CARD ? 'rândurile fără card' : `cardul ${filterCard}`} (din ${carduri ? carduri.total : '?'}) · ${filtered.length} afișate cu filtrele curente`}
            </div>
            {!loading && eroare && (
              <div style={{fontSize:12, color:G.red, marginTop:4, fontWeight:700}}>
                ⚠️ Eroare la încărcare: {eroare}{' '}
                <button onClick={() => loadAlim(filterCard)} style={{background:'transparent', color:G.blue, border:`1px solid ${G.border2}`, borderRadius:6, padding:'2px 8px', fontSize:11, cursor:'pointer'}}>Reîncearcă</button>
              </div>
            )}
            {!loading && trunchiat && (
              <div style={{fontSize:12, color:G.yellow, marginTop:4, fontWeight:700}}>
                ⚠️ În total sunt {totalServer} alimentări fără șantier; aici apar doar cele mai noi {alimentari.length}. Filtrele de lună / stație / WhatsApp și „Aplică toate” văd doar aceste rânduri; alege un card ca să vezi toate alimentările lui.
              </div>
            )}
          </div>
          <button onClick={inchide} disabled={saving} style={{
            background:'transparent', border:'none', color:G.muted,
            fontSize:24, cursor: saving ? 'wait' : 'pointer', padding:'4px 12px'
          }}>×</button>
        </div>
        
        {/* FILTRE + MASS ACTION */}
        {carduri && (carduri.total > 0 || alimentari.length > 0 || filterCard !== 'toate') && (
          <div style={{
            padding:'12px 22px', background:G.bg, borderBottom:`1px solid ${G.border}`,
            display:'flex', gap:12, flexWrap:'wrap', alignItems:'center'
          }}>
            <div style={{fontSize:11, color:G.muted, fontWeight:700, textTransform:'uppercase', letterSpacing:'.4px'}}>Filtre:</div>
            
            {/* Filtru lună */}
            <select 
              value={filterLuna} 
              onChange={e => setFilterLuna(e.target.value)}
              style={{
                background:G.surface, border:`1px solid ${G.border2}`, color:G.text,
                borderRadius:6, padding:'6px 10px', fontSize:12, minWidth:140
              }}
            >
              <option value="toate">Toate lunile</option>
              {optiuniLuna.map(({ valoare: m, faraRezultate }) => (
                <option key={m} value={m}>{numeLuna(m)}{faraRezultate ? ' (fără rezultate)' : ''}</option>
              ))}
            </select>
            
            {/* Filtru stație */}
            <select 
              value={filterStatie} 
              onChange={e => setFilterStatie(e.target.value)}
              style={{
                background:G.surface, border:`1px solid ${G.border2}`, color:G.text,
                borderRadius:6, padding:'6px 10px', fontSize:12, minWidth:140
              }}
            >
              <option value="toate">Toate stațiile</option>
              {optiuniStatie.map(({ valoare: s, faraRezultate }) => <option key={s} value={s}>{s}{faraRezultate ? ' (fără rezultate)' : ''}</option>)}
            </select>

            {/* Filtru card combustibil (TKT-2026-0383/0387) */}
            <select
              value={filterCard}
              onChange={e => setFilterCard(e.target.value)}
              style={{
                background:G.surface, border:`1px solid ${filterCard !== 'toate' ? G.purple : G.border2}`, color:G.text,
                borderRadius:6, padding:'6px 10px', fontSize:12, minWidth:150
              }}
            >
              <option value="toate">Toate cardurile</option>
              {optiuniCard.map(c => <option key={c.card} value={c.card}>💳 {c.card} ({c.nr > 0 ? c.nr : 'fără rezultate'})</option>)}
              {(faraCardNr > 0 || filterCard === FARA_CARD) && <option value={FARA_CARD}>Fără card ({faraCardNr > 0 ? faraCardNr : 'fără rezultate'})</option>}
            </select>

            {/* Filtru WhatsApp */}
            <select 
              value={filterWhatsApp} 
              onChange={e => setFilterWhatsApp(e.target.value)}
              style={{
                background:G.surface, border:`1px solid ${G.border2}`, color:G.text,
                borderRadius:6, padding:'6px 10px', fontSize:12, minWidth:160
              }}
            >
              <option value="toate">Toate WhatsApp</option>
              <option value="cu_wa">📲 Doar cu mesaj WhatsApp</option>
              <option value="fara_wa">Doar fără mesaj WhatsApp</option>
            </select>
            
            {/* Search vehicul */}
            <input
              type="text"
              placeholder="🔍 Caută vehicul..."
              value={filterVehicul}
              onChange={e => setFilterVehicul(e.target.value)}
              style={{
                background:G.surface, border:`1px solid ${G.border2}`, color:G.text,
                borderRadius:6, padding:'6px 10px', fontSize:12, minWidth:180, flex:'0 1 220px'
              }}
            />
            
            {/* Mass action */}
            <div style={{
              marginLeft:'auto', display:'flex', gap:6, alignItems:'center',
              padding:'4px 8px', background:G.surface, border:`1px dashed ${G.purple}`, borderRadius:8
            }}>
              <span style={{fontSize:10, color:G.purple, fontWeight:700, textTransform:'uppercase'}}>Mass:</span>
              <select 
                value={massSantierId} 
                onChange={e => setMassSantierId(e.target.value)}
                style={{
                  background:G.bg, border:`1px solid ${G.border2}`, color:G.text,
                  borderRadius:6, padding:'5px 8px', fontSize:12, minWidth:140
                }}
              >
                <option value="">— alege șantier —</option>
                {(sites || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <button
                onClick={handleMassApply}
                disabled={!massSantierId || filtered.length === 0 || loading}
                style={{
                  background: massSantierId && !loading ? G.purple : G.dim, color:'#000',
                  border:'none', borderRadius:6, padding:'6px 10px', fontSize:11, fontWeight:800,
                  cursor: massSantierId ? 'pointer' : 'not-allowed', whiteSpace:'nowrap'
                }}
              >
                Aplică toate ({filtered.length})
              </button>
            </div>
          </div>
        )}
        
        {/* STATS BAR */}
        {!loading && filtered.length > 0 && (
          <div style={{
            padding:'8px 22px', background:G.bg + '88', borderBottom:`1px solid ${G.border}`,
            display:'flex', gap:18, fontSize:11, color:G.muted, alignItems:'center', flexWrap:'wrap'
          }}>
            <span><strong style={{color:G.text}}>{filtered.length}</strong> alimentări</span>
            <span><strong style={{color:G.orange}}>{totalLitri.toFixed(1)} L</strong> total</span>
            {totalCost > 0 && <span><strong style={{color:G.green}}>{totalCost.toLocaleString('ro-RO', {minimumFractionDigits:2, maximumFractionDigits:2})} RON</strong></span>}
            {cuWhatsApp > 0 && <span style={{color:'#25D366'}}>📲 <strong>{cuWhatsApp}</strong> au mesaj WhatsApp (probabil score insuficient pentru auto-match)</span>}
            <span style={{marginLeft:'auto'}}>
              <strong style={{color: validSelections.length > 0 ? G.green : G.muted}}>
                {validSelections.length}
              </strong> alocări gata de salvat
            </span>
            {Object.keys(selections).length > 0 && (
              <button 
                onClick={handleClearAll}
                style={{
                  background:'transparent', color:G.muted, border:`1px solid ${G.border2}`,
                  borderRadius:6, padding:'3px 8px', fontSize:10, cursor:'pointer'
                }}
              >
                ✕ Clear selecții
              </button>
            )}
          </div>
        )}
        
        {/* TABEL */}
        <div style={{flex:1, overflow:'auto', padding:'0 22px 18px 22px'}}>
          {loading ? (
            <div style={{padding:60, textAlign:'center', color:G.muted, fontSize:14}}>
              ⏳ Se încarcă alimentările fără șantier...
            </div>
          ) : eroare ? (
            <div style={{padding:60, textAlign:'center', color:G.red, fontSize:14, fontWeight:700}}>
              ⚠️ Alimentările nu s-au putut încărca — nu înseamnă că nu există. Reîncearcă.
            </div>
          ) : alimentari.length === 0 && filterCard !== 'toate' ? (
            <div style={{padding:60, textAlign:'center', color:G.muted, fontSize:13}}>
              Nicio alimentare fără șantier pe {filterCard === FARA_CARD ? 'rândurile fără card' : `cardul ${filterCard}`}. Alege alt card sau „Toate cardurile”.
            </div>
          ) : alimentari.length === 0 ? (
            <div style={{padding:60, textAlign:'center', color:G.green, fontSize:16, fontWeight:700}}>
              🎉 Toate alimentările au șantier alocat!
              <div style={{fontSize:12, color:G.muted, fontWeight:400, marginTop:8}}>
                Nu există nimic de alocat manual.
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div style={{padding:60, textAlign:'center', color:G.muted, fontSize:13}}>
              Niciun rezultat cu filtrele curente.{' '}
              {filtreRamase.length > 0
                ? `${filtreRamase.map(f => (f === 'luna' ? `Luna aleasă (${numeLuna(filterLuna)})` : `Stația aleasă (${filterStatie})`)).join(' și ')} nu mai ${filtreRamase.length > 1 ? 'au' : 'are'} alimentări în lista încărcată acum.`
                : 'Încearcă să modifici filtrele.'}
              <div style={{marginTop:10}}>
                <button onClick={resetFiltre} style={{background:'transparent', color:G.blue, border:`1px solid ${G.border2}`, borderRadius:6, padding:'4px 10px', fontSize:12, cursor:'pointer'}}>Resetează filtrele (lună, stație, WhatsApp, vehicul)</button>
              </div>
            </div>
          ) : (
            <table style={{width:'100%', borderCollapse:'collapse', fontSize:12, marginTop:14}}>
              <thead style={{position:'sticky', top:0, background:G.surface, zIndex:1}}>
                <tr style={{borderBottom:`2px solid ${G.border2}`}}>
                  <th style={thStyle}>Data</th>
                  <th style={thStyle}>Vehicul</th>
                  <th style={thStyle}>Card</th>
                  <th style={{...thStyle, textAlign:'right'}}>Litri</th>
                  <th style={thStyle}>Stație</th>
                  <th style={{...thStyle, textAlign:'right'}}>Cost</th>
                  <th style={thStyle}>WhatsApp</th>
                  <th style={{...thStyle, minWidth:220}}>Șantier alocat</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(a => {
                  const av = a.logistica_active || {}
                  const selectedSite = selections[a.id]
                  const hasWA = !!a.whatsapp_caption
                  return (
                    <tr 
                      key={a.id} 
                      style={{
                        borderBottom:`1px solid ${G.border}`,
                        background: selectedSite ? G.greenDim + '44' : 'transparent',
                      }}
                    >
                      <td style={{padding:'8px 10px', fontFamily:'monospace', fontWeight:600, color:G.text, whiteSpace:'nowrap'}}>
                        {fmtDate(a.data_alimentare)}
                      </td>
                      <td style={{padding:'8px 10px'}}>
                        <div style={{fontWeight:600, color:G.text}}>{av.marca} {av.model?.substring(0, 26)}{av.model?.length > 26 ? '...' : ''}</div>
                        <div style={{fontSize:10, color:G.muted, marginTop:2}}>
                          {av.cod_intern && <span style={{color:G.logistica, fontFamily:'monospace'}}>{av.cod_intern}</span>}
                          {av.nr_inmatriculare && <span style={{color:G.blue, fontFamily:'monospace', marginLeft:6}}>{av.nr_inmatriculare}</span>}
                        </div>
                      </td>
                      <td style={{padding:'8px 10px', whiteSpace:'nowrap'}}>
                        {a.card_combustibil?.trim() ? (
                          <span style={{padding:'2px 7px', borderRadius:6, background:G.purple + '22', color:G.purple, fontWeight:700, fontSize:11, fontFamily:'monospace'}}>
                            {a.card_combustibil.trim()}
                          </span>
                        ) : <span style={{color:G.muted}}>—</span>}
                      </td>
                      <td style={{padding:'8px 10px', textAlign:'right', color:G.orange, fontWeight:700, fontVariantNumeric:'tabular-nums'}}>
                        {Number(a.cantitate_litri).toFixed(1)} L
                      </td>
                      <td style={{padding:'8px 10px', fontSize:11, color:G.text}}>
                        {a.statie_combustibil || '—'}
                      </td>
                      <td style={{padding:'8px 10px', textAlign:'right', fontVariantNumeric:'tabular-nums'}}>
                        {a.pret_total ? (
                          <span style={{color:G.green, fontWeight:700}}>
                            {Number(a.pret_total).toFixed(2)} RON
                          </span>
                        ) : <span style={{color:G.muted}}>—</span>}
                      </td>
                      <td style={{padding:'8px 10px', maxWidth:280}}>
                        {hasWA ? (
                          <div 
                            title={`Autor: ${a.whatsapp_autor || '?'}\nPostat: ${fmtDateTime(a.whatsapp_msg_dt)}\n\n"${a.whatsapp_caption}"`}
                            style={{
                              fontSize:10, color:G.text, lineHeight:1.3,
                              cursor:'help',
                              maxWidth:260, overflow:'hidden', textOverflow:'ellipsis',
                              display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical',
                            }}
                          >
                            <span style={{color:'#25D366', fontWeight:700, marginRight:4}}>📲</span>
                            <span style={{color:G.muted}}>{a.whatsapp_autor?.split(' ')[0] || '?'}: </span>
                            {a.whatsapp_caption.slice(0, 110)}{a.whatsapp_caption.length > 110 ? '...' : ''}
                          </div>
                        ) : (
                          <span style={{fontSize:10, color:G.muted, fontStyle:'italic'}}>fără mesaj</span>
                        )}
                      </td>
                      <td style={{padding:'8px 10px'}}>
                        <select
                          value={selectedSite || ''}
                          onChange={e => handleSetSite(a.id, e.target.value || null)}
                          style={{
                            background: selectedSite ? G.greenDim : G.bg,
                            border: `1px solid ${selectedSite ? G.green : G.border2}`,
                            color: selectedSite ? G.green : G.text,
                            borderRadius:6, padding:'5px 8px', fontSize:11, width:'100%',
                            fontWeight: selectedSite ? 700 : 400,
                          }}
                        >
                          <option value="">— alege șantier —</option>
                          {(sites || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
        
        {/* FOOTER */}
        <div style={{
          padding:'12px 22px', borderTop:`1px solid ${G.border}`,
          display:'flex', justifyContent:'space-between', alignItems:'center', gap:12,
          background:G.bg
        }}>
          <div style={{fontSize:11, color:G.muted}}>
            {savedCount > 0 && <span style={{color:G.green, fontWeight:700}}>✅ {savedCount} salvate · </span>}
            Alocările vor fi marcate cu sursă = <strong style={{color:G.text}}>manual</strong> + audit (cine + când).
          </div>
          <div style={{display:'flex', gap:10}}>
            <button 
              onClick={onClose} 
              disabled={saving}
              style={{
                padding:'10px 22px', background:G.surface, color:G.text,
                border:`1px solid ${G.border}`, borderRadius:8,
                cursor: saving ? 'wait' : 'pointer', fontSize:13, fontWeight:600,
                opacity: saving ? 0.6 : 1
              }}
            >
              Închide
            </button>
            <button 
              onClick={handleSave} 
              disabled={validSelections.length === 0 || saving || loading}
              style={{
                padding:'10px 22px',
                background: validSelections.length > 0 && !loading ? G.green : G.dim,
                color:'#fff', border:'none', borderRadius:8, fontSize:13, fontWeight:800,
                cursor: (validSelections.length > 0 && !saving && !loading) ? 'pointer' : 'not-allowed'
              }}
            >
              {saving ? '⏳ Salvez...' : `💾 Salvează ${validSelections.length} alocări`}
            </button>
          </div>
        </div>
        
      </div>
    </div>
  )
}

const thStyle = {
  padding:'10px 10px', textAlign:'left', color:G.muted, fontWeight:700,
  fontSize:11, textTransform:'uppercase', letterSpacing:'.4px',
  background:G.surface
}
