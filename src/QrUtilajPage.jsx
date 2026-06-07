// ============================================================
// QR Utilaj Page - Pagină publică mobile pentru scanare QR
// 07.06.2026 v2 - Flow refactorizat:
//   PIN → Șantier (denumiri scurte, butoane mari) → Sursă →
//   Bon tip → [Bon site activ / Bon cod] → Cantitate + Ore/Km → Submit
// Oscar apare DOAR la LOT 1 (site_id=4) și LOT 2 (site_id=6)
// Bon comun bazat pe șantier — fără cod manual
// ============================================================
import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://dxczwkbciseqniprspcu.supabase.co'
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

const OSCAR_LOT1_SITE_ID = 4
const OSCAR_LOT2_SITE_ID = 6

const P = {
  bg: '#0D1117', surface: '#161B22', border: '#30363D',
  text: '#E6EDF3', muted: '#7D8590', primary: '#2563EB',
  success: '#10B981', warning: '#F59E0B', danger: '#EF4444',
  oscar: '#3B82F6', rompetrol: '#F59E0B', benzinarie: '#8B5CF6',
}

async function fetchUtilajInfo(id) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/qr-utilaj-info?id=${id}`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'apikey': SUPABASE_ANON_KEY },
  })
  return await res.json()
}

async function submitAlimentare(payload) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/qr-alimentare-submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'apikey': SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(payload),
  })
  return await res.json()
}

async function lookupBonByCod(cod) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/qr-bon-comun-lookup?cod=${encodeURIComponent(cod)}`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'apikey': SUPABASE_ANON_KEY },
  })
  return await res.json()
}

async function lookupBonuriSite(siteId) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/qr-bon-comun-lookup?site_id=${siteId}`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'apikey': SUPABASE_ANON_KEY },
  })
  return await res.json()
}

export default function QrUtilajPage() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [step, setStep] = useState('loading')
  const [error, setError] = useState('')
  const [utilaj, setUtilaj] = useState(null)
  const [ultimeAlim, setUltimeAlim] = useState([])
  const [documente, setDocumente] = useState([])
  const [service, setService] = useState(null)
  const [pin, setPin] = useState('')
  const [sursa, setSursa] = useState(null)
  const [oscarLot, setOscarLot] = useState(null)
  const [cantitate, setCantitate] = useState('')
  const [geo, setGeo] = useState({ lat: null, lng: null })
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState(null)
  const [fotoBon, setFotoBon] = useState(null)
  const [fotoPreview, setFotoPreview] = useState(null)
  const [fotoProcessing, setFotoProcessing] = useState(false)
  const [fotoPompa, setFotoPompa] = useState(null)
  const [fotoPompaPreview, setFotoPompaPreview] = useState(null)
  const [fotoPompaProcessing, setFotoPompaProcessing] = useState(false)
  const [bonMode, setBonMode] = useState('individual')
  const [totalBon, setTotalBon] = useState('')
  const [bonCod, setBonCod] = useState('')
  const [bonVerificat, setBonVerificat] = useState(null)
  const [bonVerifLoading, setBonVerifLoading] = useState(false)
  const [bonuriSite, setBonuriSite] = useState([])
  const [bonuriSiteLoading, setBonuriSiteLoading] = useState(false)
  const [santiere, setSantiere] = useState([])
  const [siteSelectat, setSiteSelectat] = useState(null)
  const [oreBord, setOreBord] = useState('')
  const [kmBord, setKmBord] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetchUtilajInfo(id)
        if (cancelled) return
        if (res.error) { setError(res.error); setStep('error'); return }
        setUtilaj(res.utilaj)
        setUltimeAlim(res.ultime_alimentari || [])
        setDocumente(res.documente || [])
        setService(res.service || null)
        setSantiere(res.santiere || [])
        setSiteSelectat(res.utilaj?.site_id || null)
        setStep('info')
      } catch { if (!cancelled) { setError('Eroare conectare. Verifică internetul.'); setStep('error') } }
    }
    load()
    return () => { cancelled = true }
  }, [id])

  async function comprimaImagine(file) {
    const img = new Image()
    const reader = new FileReader()
    const loaded = new Promise((resolve, reject) => {
      reader.onload = () => { img.src = reader.result }
      reader.onerror = reject
      img.onload = () => resolve()
      img.onerror = reject
    })
    reader.readAsDataURL(file)
    await loaded
    const maxDim = 1200
    let w = img.width, h = img.height
    if (w > maxDim || h > maxDim) {
      if (w > h) { h = Math.round(h * maxDim / w); w = maxDim }
      else { w = Math.round(w * maxDim / h); h = maxDim }
    }
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    canvas.getContext('2d').drawImage(img, 0, 0, w, h)
    return canvas.toDataURL('image/jpeg', 0.7)
  }

  async function handleFotoSelect(e) {
    const file = e.target.files?.[0]; if (!file) return
    setFotoProcessing(true)
    try { const b = await comprimaImagine(file); setFotoBon(b); setFotoPreview(b) }
    catch { setError('Eroare procesare poză bon.') } finally { setFotoProcessing(false) }
  }

  async function handleFotoPompaSelect(e) {
    const file = e.target.files?.[0]; if (!file) return
    setFotoPompaProcessing(true)
    try { const b = await comprimaImagine(file); setFotoPompa(b); setFotoPompaPreview(b) }
    catch { setError('Eroare procesare poză pompă.') } finally { setFotoPompaProcessing(false) }
  }

  async function incarcaBonuriSite(siteId) {
    setBonuriSiteLoading(true); setBonuriSite([])
    try { const data = await lookupBonuriSite(siteId); setBonuriSite(data.bonuri || []) }
    catch { setBonuriSite([]) } finally { setBonuriSiteLoading(false) }
  }

  async function verifBon() {
    setBonVerifLoading(true)
    try {
      const data = await lookupBonByCod(bonCod)
      if (data.error) { alert(data.error); return }
      setBonVerificat(data.bon)
    } catch { alert('Eroare verificare bon.') } finally { setBonVerifLoading(false) }
  }

  async function doSubmit() {
    setSubmitting(true)
    try {
      navigator.geolocation?.getCurrentPosition(
        pos => setGeo({ lat: pos.coords.latitude, lng: pos.coords.longitude }), () => {}
      )
      const res = await submitAlimentare({
        active_id: utilaj.id,          // edge fn: active_id
        pin,
        qr_sursa: sursa,               // edge fn: qr_sursa
        cantitate_litri: parseFloat(cantitate),
        site_id: siteSelectat,
        bon_mode: bonMode,
        bon_comun_id: bonVerificat?.id || null,   // modul nou: ID direct
        bon_cod: bonVerificat?.cod_bon || null,    // modul vechi: fallback cod
        total_litri_bon: bonMode === 'creeaza_bon' ? parseFloat(totalBon) : null,
        foto_base64: fotoBon || null,              // edge fn: foto_base64
        foto_pompa_base64: fotoPompa || null,
        geo_lat: geo.lat, geo_lng: geo.lng,        // edge fn: geo_lat/geo_lng
        ore_la_alimentare: oreBord ? parseFloat(oreBord) : null,  // edge fn
        km_la_alimentare:  kmBord  ? parseFloat(kmBord)  : null,  // edge fn
      })
      if (res.error) { setError(res.error); setStep('error'); return }
      setResult(res); setStep('success')
    } catch { setError('Eroare la trimitere. Verifică internetul și încearcă din nou.'); setStep('error') }
    finally { setSubmitting(false) }
  }

  const siteInfo = santiere.find(s => s.id === siteSelectat)
  const siteEOscarLot1 = siteSelectat === OSCAR_LOT1_SITE_ID
  const siteEOscarLot2 = siteSelectat === OSCAR_LOT2_SITE_ID
  const siteEOscar = siteEOscarLot1 || siteEOscarLot2
  const labelSursa = sursa === 'oscar'
    ? `💧 OSCAR ${oscarLot === 'lot1' ? 'LOT 1' : 'LOT 2'}`
    : sursa === 'rompetrol' ? '⛽ ROMPETROL (CARD GAZPET)' : '🏪 ALTE STAȚII'

  return (
    <div style={{
      minHeight: '100vh', background: P.bg, color: P.text,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      maxWidth: 420, margin: '0 auto', padding: '16px 16px 40px',
    }}>
      {/* HEADER */}
      <div style={{ textAlign: 'center', marginBottom: 20, paddingTop: 12 }}>
        <div style={{ fontSize: 32, marginBottom: 4 }}>⛽🏗️</div>
        <div style={{ fontSize: 20, fontWeight: 800 }}>Gazpet QR</div>
        <div style={{ fontSize: 12, color: P.muted }}>Sistem alimentare rapidă</div>
      </div>

      {/* LOADING */}
      {step === 'loading' && (
        <div style={{ textAlign: 'center', padding: 40, color: P.muted }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
          <div>Se încarcă informațiile utilajului...</div>
        </div>
      )}

      {/* ERROR */}
      {step === 'error' && (
        <div style={{ background: '#450A0A', border: `1px solid ${P.danger}`, padding: 20, borderRadius: 12, textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>❌</div>
          <div style={{ fontWeight: 700, marginBottom: 8, color: '#FCA5A5' }}>Eroare</div>
          <div style={{ fontSize: 13, color: '#FECACA' }}>{error}</div>
          <button onClick={() => navigate('/login')} style={{
            marginTop: 16, padding: '10px 20px', background: P.danger,
            color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer',
          }}>Închide</button>
        </div>
      )}

      {/* INFO */}
      {step === 'info' && utilaj && (
        <>
          <div style={{ background: P.surface, border: `1px solid ${P.border}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ fontSize: 32 }}>🚛</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: 15, lineHeight: 1.3 }}>{utilaj.marca} {utilaj.model}</div>
                <div style={{ fontSize: 12, color: P.muted, marginTop: 2 }}>{utilaj.cod_intern}</div>
                {utilaj.santier && <div style={{ fontSize: 11, color: P.primary, marginTop: 4 }}>📍 {utilaj.santier}</div>}
              </div>
            </div>
            {documente.filter(d => d.status !== 'valid').length > 0 && (
              <div style={{ marginTop: 10 }}>
                {documente.filter(d => d.status !== 'valid').map(d => (
                  <div key={d.nume} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '4px 8px', borderRadius: 6, marginTop: 4,
                    background: d.status === 'expirat' ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)',
                  }}>
                    <span style={{ fontSize: 11 }}>{d.nume}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: d.status === 'expirat' ? P.danger : P.warning }}>
                      {d.status === 'expirat' ? '❌ Expirat' : `⚠️ ${d.zile}z`}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {service && service.nivel !== 'ok' && (
              <div style={{
                marginTop: 8, padding: '6px 10px', borderRadius: 6,
                background: service.nivel === 'critic' ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)',
              }}>
                <span style={{ fontSize: 11, color: service.nivel === 'critic' ? P.danger : P.warning }}>
                  🔧 {service.mesaj}
                </span>
              </div>
            )}
            {ultimeAlim.length > 0 && (
              <details style={{ marginTop: 10 }}>
                <summary style={{ fontSize: 12, color: P.muted, cursor: 'pointer' }}>
                  ▶ Ultimele {ultimeAlim.length} alimentări
                </summary>
                <div style={{ marginTop: 6 }}>
                  {ultimeAlim.map((a, i) => (
                    <div key={i} style={{
                      display: 'flex', justifyContent: 'space-between',
                      fontSize: 11, color: P.muted, padding: '3px 0',
                      borderBottom: i < ultimeAlim.length - 1 ? `1px solid ${P.border}` : 'none',
                    }}>
                      <span>{a.data}</span>
                      <span style={{ fontWeight: 600, color: P.text }}>{a.litri}L</span>
                      <span>{a.statie}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button onClick={() => setStep('pin')} style={{
              padding: 18, background: P.success, color: '#fff', border: 'none',
              borderRadius: 12, fontWeight: 800, fontSize: 16, cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(16,185,129,.3)',
            }}>⛽ Alimentare nouă</button>
            <button disabled style={{
              padding: 14, background: 'transparent', color: P.muted,
              border: `1px solid ${P.border}`, borderRadius: 10,
              fontWeight: 600, fontSize: 13, cursor: 'not-allowed',
            }}>🐛 Raportează defect (în curând)</button>
          </div>
        </>
      )}

      {/* PIN */}
      {step === 'pin' && (
        <div style={{ background: P.surface, border: `1px solid ${P.border}`, padding: 20, borderRadius: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>🔑 Introdu PIN-ul tău</div>
          <div style={{ fontSize: 12, color: P.muted, marginBottom: 16 }}>PIN-ul personal de șofer (4-6 cifre).</div>
          <input
            type="tel" inputMode="numeric" pattern="[0-9]*" maxLength={6}
            value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
            placeholder="••••" autoFocus
            style={{
              width: '100%', padding: '16px 18px', fontSize: 28, textAlign: 'center',
              letterSpacing: '0.5em', fontWeight: 800,
              background: P.bg, color: P.text, border: `2px solid ${P.border}`,
              borderRadius: 10, outline: 'none', boxSizing: 'border-box',
            }}
          />
          <button
            onClick={() => pin.length >= 4 && setStep('santier')}
            disabled={pin.length < 4}
            style={{
              width: '100%', marginTop: 16, padding: 16,
              background: pin.length >= 4 ? P.success : P.border,
              color: '#fff', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 16,
              cursor: pin.length >= 4 ? 'pointer' : 'not-allowed', opacity: pin.length >= 4 ? 1 : 0.5,
            }}
          >Continuă →</button>
          <button onClick={() => setStep('info')} style={{
            width: '100%', marginTop: 8, padding: 10, background: 'transparent',
            color: P.muted, border: 'none', fontSize: 13, cursor: 'pointer',
          }}>← Înapoi</button>
        </div>
      )}

      {/* SANTIER — NOU — grid 2 coloane, butoane mari */}
      {step === 'santier' && (
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4, textAlign: 'center' }}>
            📍 Pe ce șantier ești?
          </div>
          <div style={{ fontSize: 12, color: P.muted, marginBottom: 16, textAlign: 'center' }}>
            Alege locul unde lucrezi azi
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
            {santiere.map(s => (
              <button
                key={s.id}
                onClick={() => setSiteSelectat(s.id)}
                style={{
                  padding: '18px 10px',
                  background: siteSelectat === s.id ? P.primary : P.surface,
                  border: `2px solid ${siteSelectat === s.id ? P.primary : P.border}`,
                  borderRadius: 12, color: '#fff', fontWeight: 800,
                  fontSize: 15, cursor: 'pointer', textAlign: 'center', lineHeight: 1.2,
                  boxShadow: siteSelectat === s.id ? '0 4px 12px rgba(37,99,235,.4)' : 'none',
                  transition: 'all 0.15s',
                }}
              >
                {(s.id === OSCAR_LOT1_SITE_ID || s.id === OSCAR_LOT2_SITE_ID) && (
                  <div style={{ fontSize: 16, marginBottom: 4 }}>💧</div>
                )}
                {s.denumire_qr || s.name}
              </button>
            ))}
          </div>
          <button
            onClick={() => siteSelectat && setStep('sursa')}
            disabled={!siteSelectat}
            style={{
              width: '100%', padding: 16,
              background: siteSelectat ? P.success : P.border,
              color: '#fff', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 16,
              cursor: siteSelectat ? 'pointer' : 'not-allowed', opacity: siteSelectat ? 1 : 0.5,
            }}
          >
            {siteSelectat ? `✅ ${siteInfo?.denumire_qr || 'Ales'} — Continuă →` : 'Alege șantierul'}
          </button>
          <button onClick={() => setStep('pin')} style={{
            width: '100%', marginTop: 8, padding: 10, background: 'transparent',
            color: P.muted, border: 'none', fontSize: 13, cursor: 'pointer',
          }}>← Înapoi</button>
        </div>
      )}

      {/* SURSA */}
      {step === 'sursa' && (
        <div>
          <div style={{ fontSize: 13, color: P.muted, marginBottom: 12, textAlign: 'center' }}>
            📍 {siteInfo?.denumire_qr || 'Șantier ales'}
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12, textAlign: 'center' }}>
            🛢️ De unde alimentezi?
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {siteEOscar && (
              <button
                onClick={() => {
                  setSursa('oscar')
                  setOscarLot(siteEOscarLot1 ? 'lot1' : 'lot2')
                  setBonMode('individual')
                  setStep('cantitate')
                }}
                style={{
                  padding: 20, background: P.oscar, color: '#fff', border: 'none',
                  borderRadius: 12, fontWeight: 800, fontSize: 16, cursor: 'pointer',
                  textAlign: 'left', boxShadow: '0 4px 12px rgba(59,130,246,.3)',
                }}
              >
                <div style={{ fontSize: 24, marginBottom: 4 }}>💧</div>
                <div>Oscar — {siteEOscarLot1 ? 'LOT 1' : 'LOT 2'}</div>
                <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4, fontWeight: 500 }}>
                  Alimentare directă din rezervorul Gazpet
                </div>
              </button>
            )}
            <button
              onClick={() => { setSursa('rompetrol'); setStep('bon_tip') }}
              style={{
                padding: 20, background: P.rompetrol, color: '#fff', border: 'none',
                borderRadius: 12, fontWeight: 800, fontSize: 16, cursor: 'pointer',
                textAlign: 'left', boxShadow: '0 4px 12px rgba(245,158,11,.3)',
              }}
            >
              <div style={{ fontSize: 24, marginBottom: 4 }}>⛽</div>
              <div>Rompetrol (CARD GAZPET)</div>
              <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4, fontWeight: 500 }}>
                Stație Rompetrol cu cardul de combustibil Gazpet
              </div>
            </button>
            <button
              onClick={() => { setSursa('benzinarie'); setStep('bon_tip') }}
              style={{
                padding: 20, background: P.benzinarie, color: '#fff', border: 'none',
                borderRadius: 12, fontWeight: 800, fontSize: 16, cursor: 'pointer',
                textAlign: 'left', boxShadow: '0 4px 12px rgba(139,92,246,.3)',
              }}
            >
              <div style={{ fontSize: 24, marginBottom: 4 }}>🏪</div>
              <div>Alte Stații</div>
              <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4, fontWeight: 500 }}>
                OMV, Petrom, MOL, Rompetrol — card sau cash
              </div>
            </button>
          </div>
          <button onClick={() => setStep('santier')} style={{
            width: '100%', marginTop: 12, padding: 10, background: 'transparent',
            color: P.muted, border: 'none', fontSize: 13, cursor: 'pointer',
          }}>← Înapoi</button>
        </div>
      )}

      {/* BON_TIP */}
      {step === 'bon_tip' && (
        <div>
          <div style={{ fontSize: 13, color: P.muted, marginBottom: 4, textAlign: 'center' }}>
            📍 {siteInfo?.denumire_qr} · {sursa === 'rompetrol' ? '⛽ Rompetrol (CARD GAZPET)' : '🏪 Alte Stații'}
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4, textAlign: 'center' }}>
            🧾 Cum e bonul?
          </div>
          <div style={{ fontSize: 12, color: P.muted, marginBottom: 14, textAlign: 'center' }}>
            Bonul e doar pentru acest utilaj, sau alimentezi mai multe utilaje din același bon?
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button onClick={() => { setBonMode('individual'); setStep('cantitate') }} style={{
              padding: 18, background: P.surface, color: P.text, border: `1px solid ${P.border}`,
              borderRadius: 12, fontWeight: 700, fontSize: 15, cursor: 'pointer', textAlign: 'left',
            }}>
              <div style={{ fontSize: 22, marginBottom: 4 }}>🚛</div>
              <div>Doar acest utilaj</div>
              <div style={{ fontSize: 12, color: P.muted, marginTop: 4, fontWeight: 500 }}>
                Un bon = un utilaj (cazul normal)
              </div>
            </button>
            <button onClick={() => { setBonMode('creeaza_bon'); setStep('cantitate') }} style={{
              padding: 18, background: '#1E3A5F', color: '#fff', border: `1px solid ${P.primary}`,
              borderRadius: 12, fontWeight: 700, fontSize: 15, cursor: 'pointer', textAlign: 'left',
            }}>
              <div style={{ fontSize: 22, marginBottom: 4 }}>📋</div>
              <div>Bon comun — sunt primul</div>
              <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4, fontWeight: 500 }}>
                Creez bonul (ex: 500L) — ceilalți șoferi de pe {siteInfo?.denumire_qr} îl văd automat
              </div>
            </button>
            <button onClick={() => {
              setBonMode('leaga_bon'); setBonVerificat(null)
              incarcaBonuriSite(siteSelectat); setStep('bon_site')
            }} style={{
              padding: 18, background: '#3D2F5F', color: '#fff', border: `1px solid ${P.benzinarie}`,
              borderRadius: 12, fontWeight: 700, fontSize: 15, cursor: 'pointer', textAlign: 'left',
            }}>
              <div style={{ fontSize: 22, marginBottom: 4 }}>🔗</div>
              <div>Bon comun — continui un bon</div>
              <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4, fontWeight: 500 }}>
                Alimentez din bonul deschis de alt șofer pe {siteInfo?.denumire_qr}
              </div>
            </button>
          </div>
          <button onClick={() => setStep('sursa')} style={{
            width: '100%', marginTop: 12, padding: 10, background: 'transparent',
            color: P.muted, border: 'none', fontSize: 13, cursor: 'pointer',
          }}>← Înapoi</button>
        </div>
      )}

      {/* BON_SITE — NOU — bonuri active azi pe șantier */}
      {step === 'bon_site' && (
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4, textAlign: 'center' }}>
            🔗 Bonuri deschise azi
          </div>
          <div style={{ fontSize: 12, color: P.muted, marginBottom: 16, textAlign: 'center' }}>
            📍 {siteInfo?.denumire_qr} · {sursa === 'rompetrol' ? '⛽ Rompetrol (CARD GAZPET)' : '🏪 Alte Stații'}
          </div>
          {bonuriSiteLoading && (
            <div style={{ textAlign: 'center', padding: 24, color: P.muted }}>⏳ Se caută bonurile...</div>
          )}
          {!bonuriSiteLoading && bonuriSite.length === 0 && (
            <div style={{ background: P.surface, border: `1px solid ${P.border}`, borderRadius: 12, padding: 20, textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Niciun bon deschis azi</div>
              <div style={{ fontSize: 12, color: P.muted, marginBottom: 16 }}>
                Nu există bonuri deschise azi pe {siteInfo?.denumire_qr}. Dacă știi codul, îl poți introduce manual.
              </div>
              <button onClick={() => { setBonCod(''); setStep('bon_cod') }} style={{
                padding: '10px 20px', background: P.benzinarie, color: '#fff',
                border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer',
              }}>🔢 Introdu cod manual</button>
            </div>
          )}
          {!bonuriSiteLoading && bonuriSite.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {bonuriSite.map(bon => (
                <button key={bon.id} onClick={() => {
                  setBonVerificat(bon); setBonCod(bon.cod_bon); setStep('cantitate')
                }} style={{
                  padding: 18, background: '#1E3A5F', color: '#fff',
                  border: `2px solid ${P.primary}`, borderRadius: 12,
                  fontWeight: 700, fontSize: 14, cursor: 'pointer', textAlign: 'left',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontSize: 16 }}>
                      {bon.qr_sursa === 'rompetrol' ? '⛽' : '🏪'} Bon #{bon.cod_bon}
                    </span>
                    <span style={{
                      padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 800,
                      background: bon.litri_ramasi > 0 ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)',
                      color: bon.litri_ramasi > 0 ? '#A7F3D0' : '#FCA5A5',
                    }}>
                      {bon.litri_ramasi > 0 ? `${bon.litri_ramasi}L disponibil` : 'Complet'}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.85 }}>
                    Total: {bon.total_litri}L · Distribuit: {bon.litri_distribuiti}L · {bon.nr_utilaje} utilaje
                  </div>
                  {bon.creat_de && (
                    <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4 }}>Creat de: {bon.creat_de}</div>
                  )}
                </button>
              ))}
              <button onClick={() => { setBonCod(''); setStep('bon_cod') }} style={{
                padding: 12, background: 'transparent', color: P.muted,
                border: `1px dashed ${P.border}`, borderRadius: 10,
                fontWeight: 600, fontSize: 13, cursor: 'pointer',
              }}>🔢 Alt bon (introdu cod manual)</button>
            </div>
          )}
          <button onClick={() => setStep('bon_tip')} style={{
            width: '100%', marginTop: 12, padding: 10, background: 'transparent',
            color: P.muted, border: 'none', fontSize: 13, cursor: 'pointer',
          }}>← Înapoi</button>
        </div>
      )}

      {/* BON_COD — fallback cod manual */}
      {step === 'bon_cod' && (
        <div style={{ background: P.surface, border: `1px solid ${P.border}`, padding: 20, borderRadius: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>🔗 Codul bonului</div>
          <div style={{ fontSize: 12, color: P.muted, marginBottom: 16 }}>Tastează codul bonului.</div>
          <input
            type="tel" inputMode="numeric" pattern="[0-9]*" maxLength={6}
            value={bonCod} onChange={e => { setBonCod(e.target.value.replace(/\D/g, '')); setBonVerificat(null) }}
            placeholder="••••" autoFocus
            style={{
              width: '100%', padding: '16px 18px', fontSize: 28, textAlign: 'center',
              letterSpacing: '0.4em', fontWeight: 800,
              background: P.bg, color: P.text, border: `2px solid ${P.border}`,
              borderRadius: 10, outline: 'none', boxSizing: 'border-box',
            }}
          />
          {bonVerificat && (
            <div style={{ marginTop: 12, padding: 12, background: '#064E3B', borderRadius: 8, border: `1px solid ${P.success}` }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#A7F3D0', marginBottom: 4 }}>✅ Bon găsit</div>
              <div style={{ fontSize: 12, color: '#D1FAE5' }}>
                {bonVerificat.qr_sursa === 'rompetrol' ? '⛽ Rompetrol (CARD GAZPET)' : '🏪 Alte Stații'} · Total {bonVerificat.total_litri}L
              </div>
              <div style={{ fontSize: 12, color: '#D1FAE5', marginTop: 2 }}>
                Rămas: <strong style={{ color: '#fff' }}>{bonVerificat.litri_ramasi}L</strong> ({bonVerificat.nr_utilaje} utilaje)
              </div>
            </div>
          )}
          {!bonVerificat ? (
            <button onClick={verifBon} disabled={bonCod.length < 3 || bonVerifLoading} style={{
              width: '100%', marginTop: 16, padding: 16,
              background: bonCod.length >= 3 ? P.benzinarie : P.border,
              color: '#fff', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 16,
              cursor: bonCod.length >= 3 ? 'pointer' : 'not-allowed',
              opacity: bonCod.length >= 3 ? 1 : 0.5,
            }}>{bonVerifLoading ? '⏳ Se verifică...' : '🔍 Verifică bonul'}</button>
          ) : (
            <button onClick={() => setStep('cantitate')} style={{
              width: '100%', marginTop: 16, padding: 16,
              background: P.success, color: '#fff', border: 'none', borderRadius: 10,
              fontWeight: 800, fontSize: 16, cursor: 'pointer',
            }}>Continuă →</button>
          )}
          <button onClick={() => setStep('bon_site')} style={{
            width: '100%', marginTop: 8, padding: 10, background: 'transparent',
            color: P.muted, border: 'none', fontSize: 13, cursor: 'pointer',
          }}>← Înapoi</button>
        </div>
      )}

      {/* CANTITATE */}
      {step === 'cantitate' && (
        <div style={{ background: P.surface, border: `1px solid ${P.border}`, padding: 20, borderRadius: 12 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            <div style={{
              display: 'inline-block', padding: '4px 10px',
              background: sursa === 'oscar' ? P.oscar : (sursa === 'rompetrol' ? P.rompetrol : P.benzinarie),
              color: '#fff', borderRadius: 6, fontSize: 11, fontWeight: 700,
            }}>
              {labelSursa}
              {bonMode === 'creeaza_bon' && ' · 📋 BON COMUN NOU'}
              {bonMode === 'leaga_bon' && bonVerificat && ` · 🔗 BON ${bonVerificat.cod_bon}`}
            </div>
            <div style={{
              display: 'inline-block', padding: '4px 10px',
              background: 'rgba(37,99,235,0.2)', color: P.primary,
              borderRadius: 6, fontSize: 11, fontWeight: 700,
            }}>📍 {siteInfo?.denumire_qr}</div>
          </div>

          {bonMode === 'leaga_bon' && bonVerificat && (
            <div style={{ padding: 10, background: P.bg, borderRadius: 8, marginBottom: 14, fontSize: 12, color: P.muted }}>
              🔗 Bon {bonVerificat.cod_bon}: rămas{' '}
              <strong style={{ color: P.success }}>{bonVerificat.litri_ramasi}L</strong> din {bonVerificat.total_litri}L
            </div>
          )}

          {bonMode === 'creeaza_bon' && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: P.text, marginBottom: 4 }}>
                📋 Total litri pe bon (tot bonul)
              </div>
              <div style={{ fontSize: 11, color: P.muted, marginBottom: 8 }}>
                Cantitatea TOTALĂ de pe bonul fiscal (ex: 500L care se împarte la mai multe utilaje).
              </div>
              <div style={{ position: 'relative' }}>
                <input
                  type="number" inputMode="decimal" min="0.1" step="0.1"
                  value={totalBon} onChange={e => setTotalBon(e.target.value)} placeholder="500"
                  style={{
                    width: '100%', padding: '12px 50px 12px 16px', fontSize: 24, textAlign: 'right',
                    fontWeight: 700, background: P.bg, color: P.primary, border: `2px solid ${P.primary}`,
                    borderRadius: 10, outline: 'none', boxSizing: 'border-box',
                  }}
                />
                <div style={{
                  position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)',
                  fontSize: 16, fontWeight: 700, color: P.muted, pointerEvents: 'none',
                }}>L</div>
              </div>
            </div>
          )}

          {/* Ore / Km ÎNAINTE de litri */}
          {utilaj && utilaj.metric_tip === 'km' ? (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: P.text, marginBottom: 4 }}>
                🛣️ Km la bord <span style={{ fontWeight: 400, color: P.muted, fontSize: 12 }}>(opțional)</span>
              </div>
              {utilaj.km_actuali != null && (
                <div style={{ fontSize: 11, color: P.muted, marginBottom: 8 }}>
                  Ultima valoare: {Number(utilaj.km_actuali).toLocaleString('ro-RO')} km
                </div>
              )}
              <input
                type="number" inputMode="numeric" value={kmBord}
                onChange={e => setKmBord(e.target.value)} placeholder="ex: 125400"
                style={{
                  width: '100%', padding: '12px 14px', fontSize: 16,
                  background: P.bg, color: P.text, border: `2px solid ${kmBord ? P.primary : P.border}`,
                  borderRadius: 10, outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>
          ) : utilaj && (utilaj.metric_tip === 'ore' || utilaj.metric_tip === 'none' || !utilaj.metric_tip) ? (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: P.text, marginBottom: 4 }}>
                ⏱️ Ore funcționare bord <span style={{ fontWeight: 400, color: P.muted, fontSize: 12 }}>(opțional)</span>
              </div>
              {utilaj.ore_functionare != null && (
                <div style={{ fontSize: 11, color: P.muted, marginBottom: 8 }}>
                  Ultima valoare: {Number(utilaj.ore_functionare).toLocaleString('ro-RO')} ore
                </div>
              )}
              <input
                type="number" inputMode="numeric" value={oreBord}
                onChange={e => setOreBord(e.target.value)} placeholder="ex: 3450"
                style={{
                  width: '100%', padding: '12px 14px', fontSize: 16,
                  background: P.bg, color: P.text, border: `2px solid ${oreBord ? P.primary : P.border}`,
                  borderRadius: 10, outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>
          ) : null}

          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>
            {bonMode === 'individual' ? '⛽ Câți litri ai alimentat?' : '⛽ Cât a luat ACEST utilaj?'}
          </div>
          <div style={{ fontSize: 12, color: P.muted, marginBottom: 16 }}>
            {bonMode === 'individual'
              ? 'Introduce cantitatea exactă (poți pune și zecimale).'
              : 'Cantitatea pusă în utilajul curent (din bonul comun).'}
          </div>
          <div style={{ position: 'relative' }}>
            <input
              type="number" inputMode="decimal" min="0.1" max="2000" step="0.1"
              value={cantitate} onChange={e => setCantitate(e.target.value)}
              placeholder="0" autoFocus
              style={{
                width: '100%', padding: '16px 70px 16px 18px', fontSize: 36, textAlign: 'right',
                fontWeight: 800, background: P.bg, color: P.text, border: `2px solid ${P.border}`,
                borderRadius: 10, outline: 'none', boxSizing: 'border-box',
              }}
            />
            <div style={{
              position: 'absolute', right: 18, top: '50%', transform: 'translateY(-50%)',
              fontSize: 20, fontWeight: 700, color: P.muted, pointerEvents: 'none',
            }}>L</div>
          </div>

          {sursa !== 'oscar' && bonMode !== 'leaga_bon' && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: P.text, marginBottom: 4 }}>
                📸 Poză bon{' '}
                {sursa === 'rompetrol' ? '(recomandat)' : '(obligatoriu pentru alte stații)'}
              </div>
              <div style={{ fontSize: 11, color: P.muted, marginBottom: 10 }}>
                Fotografiază bonul fiscal — ajută biroul la reconciliere și ANAF.
              </div>
              {!fotoPreview ? (
                <label style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  padding: 16, background: P.bg, border: `2px dashed ${P.border}`,
                  borderRadius: 10, cursor: 'pointer', color: P.muted, fontSize: 14, fontWeight: 600,
                }}>
                  {fotoProcessing ? '⏳ Se procesează...' : '📷 Fă o poză bonului'}
                  <input type="file" accept="image/*" capture="environment"
                    onChange={handleFotoSelect} style={{ display: 'none' }} disabled={fotoProcessing} />
                </label>
              ) : (
                <div style={{ position: 'relative' }}>
                  <img src={fotoPreview} alt="Bon" style={{
                    width: '100%', maxHeight: 200, objectFit: 'contain',
                    borderRadius: 10, border: `1px solid ${P.border}`, background: P.bg,
                  }} />
                  <button onClick={() => { setFotoBon(null); setFotoPreview(null) }} style={{
                    position: 'absolute', top: 8, right: 8, width: 32, height: 32,
                    background: P.danger, color: '#fff', border: 'none', borderRadius: '50%',
                    fontSize: 16, cursor: 'pointer', fontWeight: 700,
                  }}>×</button>
                  <div style={{
                    position: 'absolute', bottom: 8, left: 8, padding: '4px 10px',
                    background: 'rgba(16,185,129,0.9)', color: '#fff', borderRadius: 6,
                    fontSize: 11, fontWeight: 700,
                  }}>✅ Bon atașat</div>
                </div>
              )}
            </div>
          )}

          {sursa !== 'oscar' && bonMode !== 'leaga_bon' && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: P.text, marginBottom: 4 }}>
                ⛽ Poză pompă (afișaj litri/lei) <span style={{ color: P.muted, fontWeight: 400 }}>— opțional</span>
              </div>
              <div style={{ fontSize: 11, color: P.muted, marginBottom: 10 }}>
                Fotografiază afișajul pompei — dublă dovadă alături de bon.
              </div>
              {!fotoPompaPreview ? (
                <label style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  padding: 16, background: P.bg, border: `2px dashed ${P.border}`,
                  borderRadius: 10, cursor: 'pointer', color: P.muted, fontSize: 14, fontWeight: 600,
                }}>
                  {fotoPompaProcessing ? '⏳ Se procesează...' : '📷 Fă o poză pompei'}
                  <input type="file" accept="image/*" capture="environment"
                    onChange={handleFotoPompaSelect} style={{ display: 'none' }} disabled={fotoPompaProcessing} />
                </label>
              ) : (
                <div style={{ position: 'relative' }}>
                  <img src={fotoPompaPreview} alt="Pompă" style={{
                    width: '100%', maxHeight: 200, objectFit: 'contain',
                    borderRadius: 10, border: `1px solid ${P.border}`, background: P.bg,
                  }} />
                  <button onClick={() => { setFotoPompa(null); setFotoPompaPreview(null) }} style={{
                    position: 'absolute', top: 8, right: 8, width: 32, height: 32,
                    background: P.danger, color: '#fff', border: 'none', borderRadius: '50%',
                    fontSize: 16, cursor: 'pointer', fontWeight: 700,
                  }}>×</button>
                  <div style={{
                    position: 'absolute', bottom: 8, left: 8, padding: '4px 10px',
                    background: 'rgba(245,158,11,0.9)', color: '#fff', borderRadius: 6,
                    fontSize: 11, fontWeight: 700,
                  }}>✅ Pompă atașată</div>
                </div>
              )}
            </div>
          )}

          {(() => {
            const cantOk = cantitate && parseFloat(cantitate) > 0
            const altStatiieFotoLipsa = sursa === 'benzinarie' && bonMode !== 'leaga_bon' && !fotoBon
            const totalBonLipsa = bonMode === 'creeaza_bon' && (!totalBon || parseFloat(totalBon) <= 0)
            const totalBonPreaMic = bonMode === 'creeaza_bon' && totalBon && cantitate && parseFloat(totalBon) < parseFloat(cantitate)
            const blocat = !cantOk || submitting || altStatiieFotoLipsa || totalBonLipsa || totalBonPreaMic
            let label = '✅ Trimite alimentarea'
            if (submitting) label = '⏳ Se trimite...'
            else if (totalBonLipsa) label = '📋 Completează totalul bonului'
            else if (totalBonPreaMic) label = '⚠️ Cantitatea > total bon'
            else if (altStatiieFotoLipsa) label = '📸 Adaugă poza bonului'
            else if (bonMode === 'creeaza_bon') label = '✅ Creează bon + trimite'
            return (
              <button onClick={doSubmit} disabled={blocat} style={{
                width: '100%', marginTop: 16, padding: 18,
                background: blocat && !submitting ? P.border : P.success,
                color: '#fff', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 18,
                cursor: submitting ? 'wait' : (blocat ? 'not-allowed' : 'pointer'),
                opacity: submitting ? 0.7 : 1,
              }}>{label}</button>
            )
          })()}
          <button onClick={() => setStep(sursa === 'oscar' ? 'sursa' : 'bon_tip')} style={{
            width: '100%', marginTop: 8, padding: 10, background: 'transparent',
            color: P.muted, border: 'none', fontSize: 13, cursor: 'pointer',
          }}>← Înapoi</button>
        </div>
      )}

      {/* SUCCESS */}
      {step === 'success' && result && (
        <div style={{
          background: '#064E3B', border: `1px solid ${P.success}`,
          padding: 24, borderRadius: 12, textAlign: 'center',
        }}>
          <div style={{ fontSize: 56, marginBottom: 12 }}>✅</div>
          <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 12, color: '#A7F3D0' }}>
            Alimentare înregistrată!
          </div>
          <div style={{ fontSize: 14, color: '#D1FAE5', marginBottom: 20, lineHeight: 1.5 }}>
            {result.message}
          </div>
          {result.bon_mode === 'creeaza_bon' && result.bon_comun_cod && (
            <div style={{
              background: '#1E3A5F', border: `2px solid ${P.primary}`,
              borderRadius: 12, padding: 16, marginBottom: 20,
            }}>
              <div style={{ fontSize: 12, color: '#93C5FD', marginBottom: 6, fontWeight: 600 }}>
                📋 CODUL BONULUI (dacă e nevoie):
              </div>
              <div style={{ fontSize: 48, fontWeight: 900, color: '#fff', letterSpacing: '0.1em' }}>
                {result.bon_comun_cod}
              </div>
              <div style={{ fontSize: 11, color: '#93C5FD', marginTop: 6 }}>
                Ceilalți șoferi de pe {siteInfo?.denumire_qr} îl văd automat în aplicație.
              </div>
            </div>
          )}
          <div style={{
            background: 'rgba(0,0,0,0.3)', borderRadius: 8, padding: 12,
            fontSize: 12, color: '#A7F3D0', marginBottom: 20, textAlign: 'left',
          }}>
            <div>👤 Șofer: <strong style={{ color: '#fff' }}>{result.sofer_nume}</strong></div>
            <div>🚛 Utilaj: <strong style={{ color: '#fff' }}>{result.utilaj}</strong></div>
            <div>📍 Șantier: <strong style={{ color: '#fff' }}>{siteInfo?.denumire_qr}</strong></div>
            <div>⛽ Cantitate: <strong style={{ color: '#fff' }}>{result.cantitate_litri} L</strong></div>
            {result.bon_comun_cod && result.bon_mode !== 'creeaza_bon' && (
              <div>🔗 Bon comun: <strong style={{ color: '#fff' }}>{result.bon_comun_cod}</strong></div>
            )}
            <div>📡 Ref: #{result.alimentare_id}</div>
          </div>
          <button onClick={() => {
            setPin(''); setSursa(null); setOscarLot(null); setCantitate(''); setResult(null)
            setFotoBon(null); setFotoPreview(null); setFotoPompa(null); setFotoPompaPreview(null)
            setBonMode('individual'); setTotalBon(''); setBonCod(''); setBonVerificat(null)
            setBonuriSite([]); setOreBord(''); setKmBord('')
            setStep('info')
          }} style={{
            padding: '14px 28px', background: P.success, color: '#fff',
            border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer', marginRight: 8,
          }}>+ Altă alimentare</button>
          <button onClick={() => navigate('/login')} style={{
            padding: '14px 28px', background: 'transparent', color: P.muted,
            border: `1px solid ${P.border}`, borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer',
          }}>Închide</button>
        </div>
      )}

      {/* FOOTER */}
      <div style={{ marginTop: 30, textAlign: 'center', fontSize: 11, color: P.muted, padding: '12px 0' }}>
        <div>🔒 Sistem securizat · Gazpet Instal</div>
        <div style={{ marginTop: 6, fontSize: 12, fontWeight: 600, color: P.text, letterSpacing: '0.02em' }}>
          Sistem intern Gazpet · <span style={{ color: P.primary }}>by Trusu Razvan</span>
        </div>
        <div style={{ marginTop: 4, fontSize: 10, color: P.muted }}>{new Date().getFullYear()}</div>
      </div>
    </div>
  )
}
