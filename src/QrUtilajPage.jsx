// ============================================================
// QR Utilaj Page - Pagină publică mobile pentru scanare QR
// 27.05.2026 v1
// Flow: scan QR → vezi utilaj → PIN → sursă → cantitate → submit
// ============================================================
import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://dxczwkbciseqniprspcu.supabase.co'
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

// Paletă standalone (nu depinde de G/S din restul appului)
const P = {
  bg: '#0D1117',
  surface: '#161B22',
  border: '#30363D',
  text: '#E6EDF3',
  muted: '#7D8590',
  primary: '#2563EB',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  oscar: '#3B82F6',       // albastru pentru Oscar (vrac propriu)
  rompetrol: '#F59E0B',   // galben Rompetrol
  benzinarie: '#8B5CF6',  // mov benzinărie
}

// Edge function helpers
async function fetchUtilajInfo(id) {
  const url = `${SUPABASE_URL}/functions/v1/qr-utilaj-info?id=${id}`
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'apikey': SUPABASE_ANON_KEY,
    },
  })
  return await res.json()
}

async function submitAlimentare(payload) {
  const url = `${SUPABASE_URL}/functions/v1/qr-alimentare-submit`
  const res = await fetch(url, {
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

// ─── Componentă principală ──────────────────────────────────────────
export default function QrUtilajPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [step, setStep] = useState('loading')  // loading | info | pin | sursa | cantitate | submit | success | error
  const [error, setError] = useState('')
  const [utilaj, setUtilaj] = useState(null)
  const [ultimeAlim, setUltimeAlim] = useState([])
  const [pin, setPin] = useState('')
  const [sursa, setSursa] = useState(null)  // 'oscar' | 'rompetrol' | 'benzinarie'
  const [cantitate, setCantitate] = useState('')
  const [geo, setGeo] = useState({ lat: null, lng: null })
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState(null)
  
  // Load info utilaj
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetchUtilajInfo(id)
        if (cancelled) return
        if (res.error) {
          setError(res.error)
          setStep('error')
          return
        }
        setUtilaj(res.utilaj)
        setUltimeAlim(res.ultime_alimentari || [])
        setStep('info')
      } catch (e) {
        if (!cancelled) {
          setError('Eroare conectare. Verifică internetul.')
          setStep('error')
        }
      }
    }
    load()
    return () => { cancelled = true }
  }, [id])
  
  // Geolocation (opțional, NU blocăm dacă refuză)
  useEffect(() => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        pos => setGeo({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {},
        { timeout: 5000, enableHighAccuracy: false }
      )
    }
  }, [])
  
  async function doSubmit() {
    setSubmitting(true)
    try {
      const res = await submitAlimentare({
        active_id: parseInt(id),
        pin: pin.trim(),
        cantitate_litri: parseFloat(cantitate),
        qr_sursa: sursa,
        geo_lat: geo.lat,
        geo_lng: geo.lng,
      })
      if (res.error) {
        setError(res.error)
        setStep('error')
      } else {
        setResult(res)
        setStep('success')
      }
    } catch (e) {
      setError('Eroare conectare. Încearcă din nou.')
      setStep('error')
    } finally {
      setSubmitting(false)
    }
  }
  
  // ───────────────── UI ─────────────────
  return (
    <div style={{
      minHeight: '100vh',
      background: P.bg,
      color: P.text,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      padding: '16px',
      maxWidth: 480,
      margin: '0 auto',
    }}>
      {/* HEADER */}
      <div style={{textAlign: 'center', marginBottom: 20, padding: '12px 0'}}>
        <div style={{fontSize: 22, fontWeight: 800, color: P.text}}>⛽ Gazpet QR</div>
        <div style={{fontSize: 12, color: P.muted, marginTop: 2}}>Sistem alimentare rapidă</div>
      </div>
      
      {step === 'loading' && (
        <div style={{textAlign: 'center', padding: 40, color: P.muted}}>
          <div style={{fontSize: 40, marginBottom: 12}}>⏳</div>
          <div>Se încarcă utilajul...</div>
        </div>
      )}
      
      {step === 'error' && (
        <div style={{
          background: '#7F1D1D', border: `1px solid ${P.danger}`,
          padding: 20, borderRadius: 12, textAlign: 'center',
        }}>
          <div style={{fontSize: 40, marginBottom: 12}}>❌</div>
          <div style={{fontSize: 16, fontWeight: 700, marginBottom: 8, color: '#FCA5A5'}}>Eroare</div>
          <div style={{fontSize: 14, color: '#FECACA', marginBottom: 16}}>{error}</div>
          <button onClick={() => window.location.reload()} style={{
            padding: '12px 24px', background: P.danger, color: '#fff',
            border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer',
          }}>🔄 Reîncearcă</button>
        </div>
      )}
      
      {/* CARD UTILAJ (afișat în toți pașii info..cantitate) */}
      {utilaj && ['info', 'pin', 'sursa', 'cantitate'].includes(step) && (
        <div style={{
          background: P.surface, border: `1px solid ${P.border}`,
          padding: 16, borderRadius: 12, marginBottom: 16,
        }}>
          <div style={{display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12}}>
            <div style={{fontSize: 40}}>🚛</div>
            <div style={{flex: 1, minWidth: 0}}>
              <div style={{fontSize: 16, fontWeight: 800, color: P.text, lineHeight: 1.2}}>
                {utilaj.marca} {utilaj.model}
              </div>
              <div style={{fontSize: 13, color: P.muted, marginTop: 2}}>
                {utilaj.nr_inmatriculare || utilaj.cod_intern || `Utilaj #${utilaj.id}`}
              </div>
            </div>
          </div>
          {utilaj.santier && (
            <div style={{
              padding: '6px 10px', background: P.bg, borderRadius: 6,
              fontSize: 12, color: P.muted,
            }}>
              📍 <strong style={{color: P.text}}>{utilaj.santier}</strong>
            </div>
          )}
          {ultimeAlim.length > 0 && (
            <details style={{marginTop: 10}}>
              <summary style={{fontSize: 11, color: P.muted, cursor: 'pointer'}}>
                Ultimele 3 alimentări
              </summary>
              <div style={{marginTop: 6, fontSize: 11, color: P.muted}}>
                {ultimeAlim.map((a, i) => (
                  <div key={i} style={{padding: '3px 0'}}>
                    📅 {a.data} — {a.litri}L ({a.statie || '—'})
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
      
      {/* STEP: INFO - butoane principale */}
      {step === 'info' && (
        <div style={{display: 'flex', flexDirection: 'column', gap: 10}}>
          <button onClick={() => setStep('pin')} style={{
            padding: 18, background: P.success, color: '#fff', border: 'none',
            borderRadius: 12, fontWeight: 800, fontSize: 16, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            boxShadow: '0 4px 12px rgba(16, 185, 129, .3)',
          }}>
            ⛽ Alimentare nouă
          </button>
          <button disabled style={{
            padding: 14, background: 'transparent', color: P.muted,
            border: `1px solid ${P.border}`, borderRadius: 10,
            fontWeight: 600, fontSize: 13, cursor: 'not-allowed',
          }}>
            🐛 Raportează defect (în curând)
          </button>
        </div>
      )}
      
      {/* STEP: PIN */}
      {step === 'pin' && (
        <div style={{
          background: P.surface, border: `1px solid ${P.border}`,
          padding: 20, borderRadius: 12,
        }}>
          <div style={{fontSize: 15, fontWeight: 700, marginBottom: 6, color: P.text}}>
            🔑 Introdu PIN-ul tău
          </div>
          <div style={{fontSize: 12, color: P.muted, marginBottom: 16}}>
            PIN-ul personal de șofer (4-6 cifre).
          </div>
          <input
            type="tel"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            value={pin}
            onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
            placeholder="••••"
            autoFocus
            style={{
              width: '100%', padding: '16px 18px', fontSize: 28, textAlign: 'center',
              letterSpacing: '0.5em', fontWeight: 800,
              background: P.bg, color: P.text, border: `2px solid ${P.border}`,
              borderRadius: 10, outline: 'none', boxSizing: 'border-box',
            }}
          />
          <button
            onClick={() => pin.length >= 4 && setStep('sursa')}
            disabled={pin.length < 4}
            style={{
              width: '100%', marginTop: 16, padding: 16,
              background: pin.length >= 4 ? P.success : P.border,
              color: '#fff', border: 'none', borderRadius: 10,
              fontWeight: 800, fontSize: 16,
              cursor: pin.length >= 4 ? 'pointer' : 'not-allowed',
              opacity: pin.length >= 4 ? 1 : 0.5,
            }}
          >Continuă →</button>
          <button onClick={() => setStep('info')} style={{
            width: '100%', marginTop: 8, padding: 10, background: 'transparent',
            color: P.muted, border: 'none', fontSize: 13, cursor: 'pointer',
          }}>← Înapoi</button>
        </div>
      )}
      
      {/* STEP: SURSA - 3 butoane mari */}
      {step === 'sursa' && (
        <div>
          <div style={{fontSize: 15, fontWeight: 700, marginBottom: 12, color: P.text, textAlign: 'center'}}>
            🛢️ De unde alimentezi?
          </div>
          <div style={{display: 'flex', flexDirection: 'column', gap: 10}}>
            <button onClick={() => { setSursa('oscar'); setStep('cantitate') }} style={{
              padding: 20, background: P.oscar, color: '#fff', border: 'none',
              borderRadius: 12, fontWeight: 800, fontSize: 16, cursor: 'pointer',
              textAlign: 'left', boxShadow: '0 4px 12px rgba(59, 130, 246, .3)',
            }}>
              <div style={{fontSize: 24, marginBottom: 4}}>💧</div>
              <div>Oscar (vrac propriu)</div>
              <div style={{fontSize: 12, opacity: 0.85, marginTop: 4, fontWeight: 500}}>
                Alimentare directă din rezervorul Gazpet
              </div>
            </button>
            <button onClick={() => { setSursa('rompetrol'); setStep('cantitate') }} style={{
              padding: 20, background: P.rompetrol, color: '#fff', border: 'none',
              borderRadius: 12, fontWeight: 800, fontSize: 16, cursor: 'pointer',
              textAlign: 'left', boxShadow: '0 4px 12px rgba(245, 158, 11, .3)',
            }}>
              <div style={{fontSize: 24, marginBottom: 4}}>⛽</div>
              <div>Rompetrol (card)</div>
              <div style={{fontSize: 12, opacity: 0.85, marginTop: 4, fontWeight: 500}}>
                Stație Rompetrol cu card combustibil Gazpet
              </div>
            </button>
            <button onClick={() => { setSursa('benzinarie'); setStep('cantitate') }} style={{
              padding: 20, background: P.benzinarie, color: '#fff', border: 'none',
              borderRadius: 12, fontWeight: 800, fontSize: 16, cursor: 'pointer',
              textAlign: 'left', boxShadow: '0 4px 12px rgba(139, 92, 246, .3)',
            }}>
              <div style={{fontSize: 24, marginBottom: 4}}>🏪</div>
              <div>Benzinărie (alt card / cash)</div>
              <div style={{fontSize: 12, opacity: 0.85, marginTop: 4, fontWeight: 500}}>
                Altă stație (Petrom, MOL, OMV...) cu card sau bani
              </div>
            </button>
          </div>
          <button onClick={() => setStep('pin')} style={{
            width: '100%', marginTop: 12, padding: 10, background: 'transparent',
            color: P.muted, border: 'none', fontSize: 13, cursor: 'pointer',
          }}>← Înapoi</button>
        </div>
      )}
      
      {/* STEP: CANTITATE */}
      {step === 'cantitate' && (
        <div style={{
          background: P.surface, border: `1px solid ${P.border}`,
          padding: 20, borderRadius: 12,
        }}>
          <div style={{
            display: 'inline-block', padding: '4px 10px',
            background: sursa === 'oscar' ? P.oscar : (sursa === 'rompetrol' ? P.rompetrol : P.benzinarie),
            color: '#fff', borderRadius: 6, fontSize: 11, fontWeight: 700, marginBottom: 12,
          }}>
            {sursa === 'oscar' ? '💧 OSCAR' : sursa === 'rompetrol' ? '⛽ ROMPETROL' : '🏪 BENZINĂRIE'}
          </div>
          <div style={{fontSize: 15, fontWeight: 700, marginBottom: 6, color: P.text}}>
            Câți litri ai alimentat?
          </div>
          <div style={{fontSize: 12, color: P.muted, marginBottom: 16}}>
            Introduce cantitatea exactă (poți pune și zecimale).
          </div>
          <div style={{position: 'relative'}}>
            <input
              type="number"
              inputMode="decimal"
              min="0.1"
              max="2000"
              step="0.1"
              value={cantitate}
              onChange={e => setCantitate(e.target.value)}
              placeholder="0"
              autoFocus
              style={{
                width: '100%', padding: '16px 70px 16px 18px', fontSize: 36, textAlign: 'right',
                fontWeight: 800,
                background: P.bg, color: P.text, border: `2px solid ${P.border}`,
                borderRadius: 10, outline: 'none', boxSizing: 'border-box',
              }}
            />
            <div style={{
              position: 'absolute', right: 18, top: '50%', transform: 'translateY(-50%)',
              fontSize: 20, fontWeight: 700, color: P.muted, pointerEvents: 'none',
            }}>L</div>
          </div>
          <button
            onClick={doSubmit}
            disabled={!cantitate || parseFloat(cantitate) <= 0 || submitting}
            style={{
              width: '100%', marginTop: 16, padding: 18,
              background: (!cantitate || parseFloat(cantitate) <= 0) ? P.border : P.success,
              color: '#fff', border: 'none', borderRadius: 10,
              fontWeight: 800, fontSize: 18,
              cursor: (submitting || !cantitate) ? 'wait' : 'pointer',
              opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting ? '⏳ Se trimite...' : '✅ Trimite alimentarea'}
          </button>
          <button onClick={() => setStep('sursa')} style={{
            width: '100%', marginTop: 8, padding: 10, background: 'transparent',
            color: P.muted, border: 'none', fontSize: 13, cursor: 'pointer',
          }}>← Schimbă sursa</button>
        </div>
      )}
      
      {/* STEP: SUCCESS */}
      {step === 'success' && result && (
        <div style={{
          background: '#064E3B', border: `1px solid ${P.success}`,
          padding: 24, borderRadius: 12, textAlign: 'center',
        }}>
          <div style={{fontSize: 56, marginBottom: 12}}>✅</div>
          <div style={{fontSize: 18, fontWeight: 800, marginBottom: 12, color: '#A7F3D0'}}>
            Alimentare înregistrată!
          </div>
          <div style={{fontSize: 14, color: '#D1FAE5', marginBottom: 20, lineHeight: 1.5}}>
            {result.message}
          </div>
          <div style={{
            background: 'rgba(0,0,0,0.3)', borderRadius: 8, padding: 12,
            fontSize: 12, color: '#A7F3D0', marginBottom: 20, textAlign: 'left',
          }}>
            <div>👤 Șofer: <strong style={{color: '#fff'}}>{result.sofer_nume}</strong></div>
            <div>🚛 Utilaj: <strong style={{color: '#fff'}}>{result.utilaj}</strong></div>
            <div>⛽ Cantitate: <strong style={{color: '#fff'}}>{result.cantitate_litri} L</strong></div>
            <div>📡 Ref: #{result.alimentare_id}</div>
          </div>
          <button onClick={() => {
            setPin(''); setSursa(null); setCantitate(''); setResult(null); setStep('info')
          }} style={{
            padding: '14px 28px', background: P.success, color: '#fff',
            border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer',
            marginRight: 8,
          }}>+ Altă alimentare</button>
          <button onClick={() => navigate('/login')} style={{
            padding: '14px 28px', background: 'transparent', color: P.muted,
            border: `1px solid ${P.border}`, borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer',
          }}>Închide</button>
        </div>
      )}
      
      {/* FOOTER */}
      <div style={{
        marginTop: 30, textAlign: 'center', fontSize: 11, color: P.muted,
        padding: '12px 0',
      }}>
        <div>🔒 Sistem securizat · Gazpet Instal</div>
        <div style={{marginTop: 6, fontSize: 12, fontWeight: 600, color: P.text, letterSpacing: '0.02em'}}>
          Sistem intern Gazpet · <span style={{color: P.primary}}>by Trusu Razvan</span>
        </div>
        <div style={{marginTop: 4, fontSize: 10, color: P.muted}}>{new Date().getFullYear()}</div>
      </div>
    </div>
  )
}
