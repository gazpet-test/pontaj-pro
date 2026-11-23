// ═══════════════════════════════════════════════════════════════════════════
// restDecontat/IncarcareDocument.jsx — încărcarea unui document în „Rest de decontat” (Task 4, plan 2026-11-21-rest-de-decontat):
//   tip="situatie": situația de plată Transgaz (F3 .docx) → parsare în browser (parsareSituatie.js, fără AI) → potrivire pe baza proiectului
//                  (potrivire.js) → previzualizare (devizele cu controlul lor, liniile cu nivelul potrivirii) → decizia omului pe fiecare rând
//                  nesigur → „Confirm” → fn_rest_decontat_confirma_situatie (o tranzacție, 20270105a);
//   tip="baza":     oferta / devizul unui act adițional / al unei note NR-NCS (același format F3) → previzualizare → fn_rest_decontat_confirma_baza.
// FIȘIERUL NU SE PĂSTREAZĂ ÎN ERP deocamdată (r2, verdict #1178): documentul detaliat are prețuri și se va păstra doar într-un loc legat de
// dreptul „Rest de decontat” (livrare separată) → acum nu se urcă nicăieri, RPC-ul primește p_fisier = NULL (acceptat).
// NIMIC nu se scrie înainte de „Confirm”. Erorile BD-ului se arată în clar (L18); rețea / 5xx = rezultat NECUNOSCUT (L05): se verifică după
// amprentă sau se retrimite identic (amprenta = cheia de idempotență, UNIQUE în BD). După un rezultat necunoscut, un REFUZ la reîncercare nu
// dovedește „nimic scris”: starea se reconciliază în BD după amprentă, iar câmpurile rămân blocate până atunci. L24: fiecare citire / trimitere
// poartă un token de generație, invalidat și la demontare; un răspuns vechi (alt fișier, alt proiect) nu se aplică. Drepturile le decide BD-ul.
// ═══════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { parseSituatie, parseDevizModificare } from './parsareSituatie.js'
import { potrivesteLinii } from './potrivire.js'
import {
  randuriInitiale, controlCumulat, optiuniArticol, blocajeRanduri, verificaSituatie, pLiniiSituatie, verificaBaza, liniiBaza, totalLinii,
  clasificaEroare, sha256Hex, citesteToate, nrSituatieCanonic, SURSE_BAZA, PRAG_DIFERENTA_LEI, reconciliereDupaRefuz,
  stareDupaAmprenta, MESAJ_FARA_FISIER,
} from './incarcareLogica.js'

const G = { bg: '#0D1117', surface: '#161B22', card: '#1C2128', card2: '#21262D', text: '#E6EDF3', muted: '#8B949E', dim: '#6E7681',
  border: '#30363D', blue: '#58A6FF', green: '#2EA043', yellow: '#D29922', orange: '#F0883E', red: '#F85149', purple: '#A371F7' }
const S = {
  btn: { background: 'transparent', border: `1px solid ${G.border}`, borderRadius: 6, color: G.blue, cursor: 'pointer', fontSize: 13, padding: '6px 12px', fontFamily: 'inherit' },
  inp: { background: G.card2, border: `1px solid ${G.border}`, borderRadius: 6, color: G.text, fontSize: 12.5, padding: '5px 7px', fontFamily: 'inherit' },
  th: { textAlign: 'left', fontSize: 11, color: G.dim, textTransform: 'uppercase', letterSpacing: 0.4, padding: '6px 8px', borderBottom: `1px solid ${G.border}`, whiteSpace: 'nowrap' },
  td: { fontSize: 12.5, color: G.text, padding: '5px 8px', borderBottom: `1px solid ${G.border}`, verticalAlign: 'top' },
  err: { color: G.red, background: G.red + '14', border: `1px solid ${G.red}44`, borderRadius: 8, padding: '8px 12px', fontSize: 13, margin: '10px 0', whiteSpace: 'pre-wrap' },
  ok: { color: G.green, background: G.green + '14', border: `1px solid ${G.green}44`, borderRadius: 8, padding: '8px 12px', fontSize: 13, margin: '10px 0' },
  lbl: { fontSize: 12.5, color: G.muted, display: 'flex', gap: 6, alignItems: 'center' },
}
const num = { textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }
const CULOARE_NIVEL = { exact: G.green, cod: G.blue, descriere: G.yellow, de_verificat: G.red }
const ETICHETA_NIVEL = { exact: 'exact', cod: 'după cod', descriere: 'după denumire', de_verificat: 'de verificat' }
export const fmtLei = v => (v == null || !Number.isFinite(Number(v)) ? '—' : new Intl.NumberFormat('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v)))
export const fmtCant = v => (v == null || !Number.isFinite(Number(v)) ? '—' : new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 3 }).format(Number(v)))
const intreg = s => { const t = String(s ?? '').trim(); return /^\d{1,4}$/.test(t) ? Number(t) : null }

/**
 * <IncarcareDocument proiectId tip="situatie"|"baza" sursa? client onGata onInchide />
 * sursa (doar la „baza”): sursa propusă inițial (contract_initial / act_aditional / nota_renuntare / nota_comanda_suplimentara).
 * onBlocat(bool): adevărat cât o trimitere e în zbor / are rezultat necunoscut — apelantul nu închide panoul (închiderea ar pierde starea L05).
 */
export default function IncarcareDocument({ proiectId, tip = 'situatie', sursa: sursaInitiala = null, surse = null, client = supabase, onGata, onInchide, onBlocat }) {
  const pid = Number(proiectId)
  const eSit = tip === 'situatie'
  // sursele de bază pe care apelantul le poate confirma (oglinda dreptului: oferta cere 'confirmare', devizele AA / NR / NCS 'documente_baza')
  const surseVizibile = useMemo(() => SURSE_BAZA.filter(s => !surse || surse.includes(s.cod)), [surse])
  // contextul proiectului (citit la deschidere): baza (situație), situațiile de plată, situațiile detaliate active; actele / notele (bază)
  const [ctx, setCtx] = useState(null)        // null = se încarcă; { baza, sl, existente, acte, note, erori: {…} }
  const [eroareCtx, setEroareCtx] = useState(null)
  const [reloadCtx, setReloadCtx] = useState(0)
  // fișierul citit
  const [fis, setFis] = useState(null)        // { nume, file, amprenta, rez } | { nume, eroare } | { nume, citire: true }
  const [randuri, setRanduri] = useState([])
  const [potrivitPentru, setPotrivitPentru] = useState(null)   // amprenta fișierului ale cărui linii sunt în `randuri`
  const [decontat, setDecontat] = useState(null)   // null = nu e nevoie | { citire } | { map } | { eroare } (controlul cumulatului)
  const [cheieInput, setCheieInput] = useState(0)
  // câmpurile omului
  const [slId, setSlId] = useState('')
  const [nr, setNr] = useState('')
  const [luna, setLuna] = useState('')
  const [an, setAn] = useState('')
  const [inlocuieste, setInlocuieste] = useState(false)
  const [acceptDiferenta, setAcceptDiferenta] = useState(false)
  const [acceptProbleme, setAcceptProbleme] = useState(false)
  const [sursa, setSursa] = useState(sursaInitiala || (eSit ? null : (surse && !surse.includes('contract_initial') ? surse[0] || null : 'contract_initial')))
  const [actId, setActId] = useState('')
  const [notaId, setNotaId] = useState('')
  const [mod, setMod] = useState('diferente')
  const [acceptUm, setAcceptUm] = useState(false)
  // trimiterea
  const [trimitere, setTrimitere] = useState(null)   // null | { stare: 'trimite' } | { stare: 'ok', rez, dovada } | { stare: 'refuz'|'necunoscut', mesaj, indiciu }
  const [verificare, setVerificare] = useState(null)
  const gen = useRef(0)           // generația fișierului / proiectului (L24)
  const genCtx = useRef(0)
  const ocupat = useRef(false)    // garda anti-dublu-clic: pusă ÎNAINTEA primului await
  const necunoscutAnterior = useRef(false)

  // L24: la demontare toate generațiile avansează → niciun răspuns în zbor (context, fișier, decontat, trimitere, verificare) nu se mai aplică
  useEffect(() => () => { gen.current++; genCtx.current++ }, [])
  // panoul nu se închide cât o trimitere e în zbor / are rezultat necunoscut (apelantul ascunde închiderea)
  const stareTrim = trimitere?.stare
  useEffect(() => { onBlocat?.(stareTrim === 'trimite' || stareTrim === 'reconciliere' || stareTrim === 'necunoscut') }, [stareTrim, onBlocat])
  useEffect(() => () => onBlocat?.(false), [onBlocat])

  // ── contextul proiectului (toate citirile pe pagini până la pagina goală, fără plafon tăcut: L23) ──
  useEffect(() => {
    const g = ++genCtx.current
    setCtx(null); setEroareCtx(null)
    const pe = (tabel, coloane, filtre = q => q) => citesteToate((ultim, pas) => { let q = filtre(client.from(tabel).select(coloane).eq('proiect_id', pid)).order('id').limit(pas); if (ultim != null) q = q.gt('id', ultim); return q }, 'id')
    ;(async () => {
      try {
        const erori = {}
        const sigur = async (cheie, f) => { try { return await f() } catch (e) { erori[cheie] = e?.message || String(e); return null } }
        if (eSit) {
          const [baza, sl, existente] = await Promise.all([
            citesteToate((ultim, pas) => { let q = client.from('v_executie_rest_decontat_baza').select('cheie, tip_rand, obiect_cod, obiect_nume, deviz_cod, deviz_nume, nr, cod, denumire, um, um_incert').eq('proiect_id', pid).order('cheie').limit(pas); if (ultim != null) q = q.gt('cheie', ultim); return q }, 'cheie'),
            sigur('sl', () => pe('executie_situatii_plata', 'id, nr_situatie, luna, an, valoare_baza_lei')),
            pe('executie_sl_detaliu', 'id, nr_situatie, versiune, amprenta', q => q.eq('activ', true)),
          ])
          if (g !== genCtx.current) return
          setCtx({ baza, sl, existente, erori })
        } else {
          const [acte, note] = await Promise.all([
            sigur('acte', async () => (await pe('executie_acte_aditionale', 'id, numar_act, data_semnare, activ')).filter(a => a.activ !== false)),
            sigur('note', () => pe('executie_note_modificare', 'id, tip, numar, data_aprobare, activ', q => q.eq('activ', true))),
          ])
          if (g !== genCtx.current) return
          setCtx({ acte, note, erori })
        }
      } catch (e) { if (g === genCtx.current) setEroareCtx(e?.message || String(e)) }
    })()
    return () => { genCtx.current++ }
  }, [pid, eSit, client, reloadCtx])

  // ── fișierul: citire + amprentă + parsare + potrivire (fără nicio scriere) ──
  const alegeFisier = useCallback(async file => {
    const g = ++gen.current
    necunoscutAnterior.current = false
    setTrimitere(null); setVerificare(null); setRanduri([]); setPotrivitPentru(null); setInlocuieste(false); setAcceptDiferenta(false); setAcceptProbleme(false); setAcceptUm(false)
    if (!file) { setFis(null); return }
    setFis({ nume: file.name, citire: true })
    try {
      const buf = await file.arrayBuffer()
      const amprenta = await sha256Hex(buf)
      const f = { name: file.name, arrayBuffer: async () => buf }
      const rez = eSit ? await parseSituatie(f) : await parseDevizModificare(f)
      if (g !== gen.current) return
      setFis({ nume: file.name, file, amprenta, rez })
      if (eSit) {
        setLuna(rez.antet.luna != null ? String(rez.antet.luna) : ''); setAn(rez.antet.an != null ? String(rez.antet.an) : '')
        setSlId(''); setNr('')
      }
    } catch (e) { if (g === gen.current) setFis({ nume: file.name, eroare: e?.message || String(e) }) }
  }, [eSit])

  // potrivirea pe bază (o dată pe fișier: deciziile omului stau în `randuri`) + decontatul pentru controlul cumulatului, citit DOAR dacă
  // documentul are cumulat (F3 nu are)
  useEffect(() => {
    setDecontat(null)
    if (!eSit || !fis?.rez || !ctx?.baza) return undefined
    const g = gen.current
    let viu = true                 // L24: o rulare înlocuită (alt context / fișier) sau demontată nu mai scrie
    const curent = () => viu && g === gen.current
    const init = randuriInitiale(potrivesteLinii(fis.rez.linii, ctx.baza))
    setRanduri(init); setPotrivitPentru(fis.amprenta)
    if (!init.some(r => r.linie.cantitate_cumulat_doc != null)) return () => { viu = false }
    setDecontat({ citire: true })
    ;(async () => {
      try {
        const dec = await citesteToate((ultim, pas) => { let q = client.from('v_executie_rest_decontat').select('rand_id, cheie, decontat_cantitate').eq('proiect_id', pid).order('rand_id').limit(pas); if (ultim != null) q = q.gt('rand_id', ultim); return q }, 'rand_id')
        if (!curent()) return
        setDecontat({ map: new Map(dec.filter(d => d.cheie).map(d => [d.cheie, Number(d.decontat_cantitate)])) })
      } catch (e) { if (curent()) setDecontat({ eroare: e?.message || String(e) }) }
    })()
    return () => { viu = false }
  }, [eSit, fis?.rez, ctx?.baza, client, pid])
  // rândurile cu controlul cumulatului aplicat (deciziile rămân); cât decontatul nu e citit, liniile cu cumulat sunt de verificat
  const randuriEf = useMemo(() => {
    if (!decontat) return randuri
    if (decontat.map) return controlCumulat(randuri, decontat.map, { inlocuire: inlocuieste })
    const motiv = decontat.eroare ? `controlul cumulatului n-a putut citi decontatul: ${decontat.eroare}` : 'se citește decontatul pentru controlul cumulatului…'
    return randuri.map(r => (r.linie.cantitate_cumulat_doc != null && r.linie.nivel !== 'de_verificat' ? { ...r, linie: { ...r.linie, nivel: 'de_verificat', motiv } } : r))
  }, [randuri, decontat, inlocuieste])

  // situația de plată aleasă: numărul și (dacă antetul nu le dă) luna / anul
  const sl = useMemo(() => (ctx?.sl || []).find(s => String(s.id) === String(slId)) || null, [ctx, slId])
  const alegeSl = id => {
    setSlId(id)
    const s = (ctx?.sl || []).find(x => String(x.id) === String(id))
    if (s) { setNr(String(s.nr_situatie ?? '')); if (!luna && s.luna != null) setLuna(String(s.luna)); if (!an && s.an != null) setAn(String(s.an)) }
  }
  // propunerea: singura situație de plată cu aceeași lună / același an ca antetul
  const slPropusa = useMemo(() => {
    if (!eSit || !fis?.rez || !ctx?.sl) return null
    const { luna: l, an: a } = fis.rez.antet
    const c = ctx.sl.filter(s => l != null && a != null && Number(s.luna) === l && Number(s.an) === a)
    return c.length === 1 ? c[0] : null
  }, [eSit, fis?.rez, ctx?.sl])

  const blocaje = useMemo(() => (eSit && ctx?.baza ? blocajeRanduri(randuriEf, ctx.baza) : new Map()), [eSit, randuriEf, ctx?.baza])
  const ver = useMemo(() => {
    if (!fis?.rez || !ctx) return { ok: false, motive: [] }
    if (eSit) {
      const v = verificaSituatie({ rez: fis.rez, randuri: randuriEf, baza: ctx.baza, nr, luna: intreg(luna), an: intreg(an), existente: ctx.existente, amprenta: fis.amprenta,
        inlocuieste, referinta: sl ? sl.valoare_baza_lei : null, acceptDiferenta, acceptProbleme })
      // potrivirea se face după ce liniile au fost potrivite pe bază (nu pe o listă goală între citire și potrivire)
      if (potrivitPentru !== fis.amprenta || randuriEf.length !== fis.rez.linii.length) return { ...v, ok: false, motive: [...v.motive, 'se potrivesc liniile…'] }
      if (!ctx.baza.length) return { ...v, ok: false, motive: [...v.motive, 'proiectul nu are bază confirmată (fara_baza)'] }
      return v
    }
    return verificaBaza({ rez: fis.rez, sursa, mod, actId: actId ? Number(actId) : null, notaId: notaId ? Number(notaId) : null, note: ctx.note || [], acceptProbleme })
  }, [fis, ctx, eSit, randuriEf, potrivitPentru, nr, luna, an, inlocuieste, sl, acceptDiferenta, acceptProbleme, sursa, mod, actId, notaId])

  const decide = (i, decizie) => setRanduri(rs => rs.map(r => (r.i === i ? { ...r, decizie } : r)))

  // ── trimiterea: DOAR RPC-ul (fișierul nu se urcă nicăieri: p_fisier = NULL, vezi antetul) ──
  const confirma = async () => {
    if (ocupat.current || !ver.ok || !fis?.rez) return
    ocupat.current = true
    const g = gen.current
    setTrimitere({ stare: 'trimite' }); setVerificare(null)
    try {
      let r
      try {
        if (eSit) {
          r = await client.rpc('fn_rest_decontat_confirma_situatie', {
            p_proiect: pid, p_nr_situatie: nrSituatieCanonic(nr), p_sl_id: sl ? Number(sl.id) : null, p_fisier: null, p_amprenta: fis.amprenta,
            p_linii: pLiniiSituatie({ randuri: randuriEf, baza: ctx.baza, luna: intreg(luna), an: intreg(an), acceptDiferenta }), p_inlocuieste: inlocuieste === true,
            p_prag_diferenta: PRAG_DIFERENTA_LEI,
          })
        } else {
          const linii = liniiBaza(fis.rez)
          r = await client.rpc('fn_rest_decontat_confirma_baza', {
            p_proiect: pid, p_sursa: sursa, p_act_aditional_id: sursa === 'act_aditional' ? Number(actId) : null,
            p_nota_id: sursa === 'nota_renuntare' || sursa === 'nota_comanda_suplimentara' ? Number(notaId) : null, p_mod: ver.mod, p_fisier: null,
            p_amprenta: fis.amprenta, p_linii: sursa === 'contract_initial' && acceptUm ? { linii, accept_schimbare_um: true } : linii,
            p_inlocuieste: sursa === 'contract_initial' && inlocuieste === true,
          })
        }
      } catch (e) { r = e instanceof Error ? e : new Error(String(e)) }
      if (g !== gen.current) return
      if (!(r instanceof Error) && !r?.error) {
        necunoscutAnterior.current = false
        setTrimitere({ stare: 'ok', rez: r.data })
        onGata?.(r.data)
        return
      }
      const c = clasificaEroare(r)
      if (c.tip === 'necunoscut') {
        necunoscutAnterior.current = true
        setTrimitere({ stare: 'necunoscut', mesaj: c.mesaj, indiciu: c.indiciu })
        return
      }
      if (!necunoscutAnterior.current) { setTrimitere({ stare: 'refuz', mesaj: c.mesaj, indiciu: c.indiciu }); return }
      // L05: o încercare anterioară are rezultat NECUNOSCUT, iar reîncercarea e refuzată. Refuzul NU dovedește „nimic scris” (poate fi chiar
      // urma scrierii anterioare: „deja confirmat”, „are deja un deviz”, sau dreptul retras între timp, 42501) → starea rămâne necunoscută
      // (câmpurile blocate) până când BD-ul, citit după amprentă, o lămurește
      setTrimitere({ stare: 'reconciliere', mesaj: c.mesaj })
      const v = await stareDupaAmprenta({ client, pid, eSit, amprenta: fis.amprenta })
      if (g !== gen.current) return
      aplica(reconciliereDupaRefuz(v, c))
    } finally { ocupat.current = false }
  }
  // aplică starea reconciliată: ok (scris) / refuz (absență DOVEDITĂ sau versiune retrasă) / necunoscut (neverificabil: rămâne blocat)
  const aplica = t => {
    if (t.stare !== 'necunoscut') necunoscutAnterior.current = false
    setTrimitere(t)
    if (t.stare === 'ok') onGata?.(null)
  }

  // ── „Verifică starea” (după un rezultat necunoscut, fără refuz): aceeași citire după amprentă ──
  const verificaStarea = async () => {
    const g = gen.current
    setVerificare({ stare: 'citire' })
    const v = await stareDupaAmprenta({ client, pid, eSit, amprenta: fis.amprenta })
    if (g !== gen.current) return
    if (v.neverificabil) { setVerificare({ stare: 'eroare', mesaj: v.neverificabil }); return }
    if (v.scris || v.retras) { setVerificare(null); aplica(reconciliereDupaRefuz(v, null)); return }
    setVerificare({ stare: 'absent', mesaj: 'Verificat în ERP: nimic scris cu acest fișier până acum. Apăsați din nou „Confirm” (se trimite exact același conținut).' })
  }

  // ── afișarea ──
  const rez = fis?.rez
  const trimis = trimitere?.stare === 'ok'
  // cât rezultatul e NECUNOSCUT (sau se reconciliază) câmpurile și fișierul rămân înghețate: singura cale e retrimiterea identică sau
  // verificarea (L05); un refuz se deblochează DOAR după ce BD-ul a dovedit că încercarea anterioară nu s-a scris
  const blocatUi = stareTrim === 'trimite' || stareTrim === 'reconciliere' || trimis || stareTrim === 'necunoscut'
  const confirmBlocat = stareTrim === 'trimite' || stareTrim === 'reconciliere' || trimis
  const inchidereBlocata = stareTrim === 'trimite' || stareTrim === 'reconciliere' || stareTrim === 'necunoscut'
  const titlu = eSit ? '📥 Încarcă situația de plată (F3 .docx)' : '📥 Încarcă devizul: ofertă / act adițional / notă (F3 .docx)'
  const nrNecunoscut = eSit ? [...blocaje.keys()].length : 0
  return (
    <div style={{ background: G.card, border: `1px solid ${G.blue}44`, borderRadius: 10, padding: '12px 14px', margin: '0 0 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: G.text }}>{titlu}</div>
        {onInchide && <button style={{ ...S.btn, marginLeft: 'auto', padding: '2px 8px' }} onClick={onInchide} disabled={inchidereBlocata}
          title={inchidereBlocata ? 'Rezultatul trimiterii nu e încă lămurit: verificați starea sau retrimiteți înainte să închideți' : undefined} aria-label="închide încărcarea">×</button>}
      </div>
      <div style={{ fontSize: 12, color: G.muted, marginBottom: 10, lineHeight: 1.5 }}>
        Fișierul se citește în browser (fără AI). Nimic nu se scrie până la „Confirm”: atunci liniile intră în calcul.
        <div style={{ color: G.yellow, marginTop: 2 }} data-fara-fisier="1">{MESAJ_FARA_FISIER}</div>
      </div>

      {eroareCtx && <div style={S.err}>Nu s-a putut citi baza proiectului: {eroareCtx}<div><button style={{ ...S.btn, marginTop: 6 }} onClick={() => setReloadCtx(x => x + 1)}>Reîncearcă</button></div></div>}
      {!ctx && !eroareCtx && <div style={{ color: G.dim, fontSize: 12.5 }}>Se încarcă datele proiectului…</div>}
      {ctx && Object.entries(ctx.erori || {}).map(([k, m]) => (
        <div key={k} style={S.err}>{k === 'sl' ? 'Situațiile de plată nu s-au putut citi (fără referința de total)' : k === 'acte' ? 'Actele adiționale nu s-au putut citi' : 'Notele NR / NCS nu s-au putut citi'}: {m}</div>
      ))}
      {ctx && eSit && !ctx.baza.length && <div style={S.err}>Proiectul nu are încă bază (oferta financiară confirmată): situațiile nu se pot confirma (fara_baza). Încărcați întâi oferta.</div>}

      {ctx && (
        <label style={{ ...S.lbl, marginBottom: 8 }}>
          Fișier: <input key={cheieInput} type="file" accept=".docx" aria-label="fișierul documentului" disabled={blocatUi} onChange={e => alegeFisier(e.target.files?.[0] || null)} style={{ fontSize: 12.5, color: G.text }} />
          {trimis && <button style={S.btn} onClick={() => { setCheieInput(x => x + 1); alegeFisier(null); setReloadCtx(x => x + 1) }}>încarcă alt fișier</button>}
        </label>
      )}
      {fis?.citire && <div style={{ color: G.dim, fontSize: 12.5 }}>Se citește „{fis.nume}”…</div>}
      {fis?.eroare && <div style={S.err}>„{fis.nume}”: {fis.eroare}</div>}
      {decontat?.eroare && <div style={S.err}>Controlul cumulatului nu s-a putut face (decontatul nu s-a citit): {decontat.eroare}</div>}

      {rez && (
        <>
          <RezumatCitire rez={rez} amprenta={fis.amprenta} />

          {!eSit && ctx && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', margin: '10px 0' }}>
              <label style={S.lbl}>Documentul: <select aria-label="sursa documentului" value={sursa || ''} disabled={blocatUi} onChange={e => { setSursa(e.target.value); setInlocuieste(false); setAcceptUm(false) }} style={S.inp}>
                {surseVizibile.map(s => <option key={s.cod} value={s.cod}>{s.eticheta}</option>)}
              </select></label>
              {sursa === 'act_aditional' && <>
                <label style={S.lbl}>Actul: <select aria-label="actul adițional" value={actId} disabled={blocatUi} onChange={e => setActId(e.target.value)} style={S.inp}>
                  <option value="">— alegeți —</option>
                  {(ctx.acte || []).map(a => <option key={a.id} value={a.id}>AA {a.numar_act}{a.data_semnare ? ` din ${String(a.data_semnare).split('-').reverse().join('.')}` : ''}</option>)}
                </select></label>
                <label style={S.lbl}>Mod: <select aria-label="modul importului" value={mod} disabled={blocatUi} onChange={e => setMod(e.target.value)} style={S.inp}>
                  <option value="diferente">doar diferențe (+ / −, se adună)</option>
                  <option value="lista_completa">listă completă revizuită (înlocuiește obiectele atinse)</option>
                </select></label>
              </>}
              {(sursa === 'nota_renuntare' || sursa === 'nota_comanda_suplimentara') && (
                <label style={S.lbl}>Nota: <select aria-label="nota" value={notaId} disabled={blocatUi} onChange={e => setNotaId(e.target.value)} style={S.inp}>
                  <option value="">— alegeți —</option>
                  {(ctx.note || []).filter(n => n.tip === (sursa === 'nota_renuntare' ? 'NR' : 'NCS')).map(n => <option key={n.id} value={n.id}>{n.tip} {n.numar}{n.data_aprobare ? '' : ' (neaprobată)'}</option>)}
                </select></label>
              )}
              {sursa === 'contract_initial' && <>
                <label style={S.lbl}><input type="checkbox" aria-label="înlocuiește oferta" checked={inlocuieste} disabled={blocatUi} onChange={e => setInlocuieste(e.target.checked)} /> înlocuiește oferta deja confirmată a obiectelor din fișier</label>
                <label style={S.lbl}><input type="checkbox" aria-label="accept schimbarea UM" checked={acceptUm} disabled={blocatUi} onChange={e => setAcceptUm(e.target.checked)} /> accept schimbarea UM față de baza anterioară</label>
              </>}
            </div>
          )}

          {eSit && ctx && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', margin: '10px 0' }}>
              <label style={S.lbl}>Situația de plată: <select aria-label="situația de plată" value={slId} disabled={blocatUi} onChange={e => alegeSl(e.target.value)} style={{ ...S.inp, minWidth: 220 }}>
                <option value="">— fără legătură (fără referință de total) —</option>
                {(ctx.sl || []).map(s => <option key={s.id} value={s.id}>{s.nr_situatie} · {s.luna}/{s.an} · {fmtLei(s.valoare_baza_lei)} lei</option>)}
              </select></label>
              {slPropusa && String(slPropusa.id) !== String(slId) && <button style={{ ...S.btn, color: G.yellow }} disabled={blocatUi} onClick={() => alegeSl(String(slPropusa.id))}>propusă: {slPropusa.nr_situatie} ({slPropusa.luna}/{slPropusa.an})</button>}
              <label style={S.lbl}>Nr. situație: <input aria-label="numărul situației" value={nr} disabled={blocatUi} onChange={e => setNr(e.target.value)} style={{ ...S.inp, width: 90 }} /></label>
              <label style={S.lbl}>Luna: <input aria-label="luna" value={luna} disabled={blocatUi} onChange={e => setLuna(e.target.value)} style={{ ...S.inp, width: 44 }} /></label>
              <label style={S.lbl}>Anul: <input aria-label="anul" value={an} disabled={blocatUi} onChange={e => setAn(e.target.value)} style={{ ...S.inp, width: 60 }} /></label>
              {ver.exista && <label style={{ ...S.lbl, color: G.yellow }}><input type="checkbox" aria-label="înlocuiește situația" checked={inlocuieste} disabled={blocatUi} onChange={e => setInlocuieste(e.target.checked)} /> înlocuiește situația {nrSituatieCanonic(nr)} (versiunea {ver.exista.versiune} devine inactivă)</label>}
            </div>
          )}

          {eSit && <TotaluriSituatie rez={rez} randuri={randuriEf} sl={sl} diferenta={ver.diferenta} />}
          {eSit && ver.diferenta != null && Math.abs(ver.diferenta) > PRAG_DIFERENTA_LEI && (
            <label style={{ ...S.lbl, color: G.yellow, margin: '6px 0' }}><input type="checkbox" aria-label="accept diferența" checked={acceptDiferenta} disabled={blocatUi} onChange={e => setAcceptDiferenta(e.target.checked)} /> accept diferența de {fmtLei(ver.diferenta)} lei față de situația de plată</label>
          )}
          {!rez.complet && (
            <label style={{ ...S.lbl, color: G.yellow, margin: '6px 0' }}><input type="checkbox" aria-label="am verificat problemele" checked={acceptProbleme} disabled={blocatUi} onChange={e => setAcceptProbleme(e.target.checked)} /> am verificat cele {rez.probleme.length} probleme ale citirii; confirm totuși liniile citite</label>
          )}

          {eSit
            ? <TabelSituatie randuri={randuriEf} baza={ctx?.baza || []} blocaje={blocaje} decide={decide} blocat={blocatUi} />
            : <TabelBaza rez={rez} />}

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
            <button style={{ ...S.btn, color: ver.ok && !confirmBlocat ? G.green : G.dim, borderColor: ver.ok && !confirmBlocat ? G.green : G.border, fontWeight: 700 }}
              disabled={!ver.ok || confirmBlocat} onClick={confirma} data-confirm="1">{stareTrim === 'trimite' ? 'Se confirmă…' : stareTrim === 'reconciliere' ? 'Se verifică în ERP…' : '✓ Confirm'}</button>
            {!ver.ok && ver.motive.length > 0 && <div style={{ fontSize: 12, color: G.yellow }} data-motive="1">{ver.motive.join(' · ')}</div>}
            {eSit && nrNecunoscut > 0 && <span style={{ fontSize: 12, color: G.red }}>{nrNecunoscut} linii de rezolvat</span>}
          </div>
        </>
      )}

      {trimitere?.stare === 'ok' && (
        <div style={S.ok} data-rezultat="ok">
          ✓ Confirmat. {trimitere.dovada || ''}
          {trimitere.rez && eSit && <> Situația {nrSituatieCanonic(nr)}, versiunea {trimitere.rez.versiune}: {trimitere.rez.inserate} linii, total {fmtLei(trimitere.rez.total_citit)} lei.</>}
          {trimitere.rez && !eSit && <> {trimitere.rez.inserate} rânduri în bază{trimitere.rez.inlocuite ? `, ${trimitere.rez.inlocuite} înlocuite` : ''}.</>}
          {trimitere.rez && !eSit && (trimitere.rez.decontat_fara_baza || []).length > 0 && (
            <div style={{ color: G.yellow, marginTop: 4 }}>Atenție: {trimitere.rez.decontat_fara_baza.length} articole decontate nu mai au bază (apar la lipsuri): {trimitere.rez.decontat_fara_baza.join(', ')}</div>
          )}
        </div>
      )}
      {stareTrim === 'reconciliere' && (
        <div style={{ ...S.err, color: G.yellow, borderColor: G.yellow + '44', background: G.yellow + '14' }} data-rezultat="reconciliere">
          Reîncercarea a fost refuzată ({trimitere.mesaj}), dar încercarea anterioară are rezultat necunoscut: se verifică în ERP dacă s-a scris…
        </div>
      )}
      {(stareTrim === 'refuz' || stareTrim === 'necunoscut') && (
        <div style={S.err} data-rezultat={trimitere.stare}>
          {trimitere.stare === 'refuz' ? 'Refuzat de server: ' : 'Rezultat necunoscut: '}{trimitere.mesaj}
          {trimitere.indiciu && <div style={{ color: G.yellow, marginTop: 4 }}>{trimitere.indiciu}</div>}
          {trimitere.reconciliat && <div style={{ color: G.muted, marginTop: 4 }} data-reconciliat="1">{trimitere.reconciliat}</div>}
          {trimitere.stare === 'necunoscut' && fis?.amprenta && <div style={{ marginTop: 6 }}><button style={S.btn} onClick={verificaStarea} disabled={verificare?.stare === 'citire'}>Verifică starea în ERP</button></div>}
        </div>
      )}
      {verificare && verificare.stare !== 'citire' && <div style={verificare.stare === 'eroare' ? S.err : { fontSize: 12.5, color: G.muted, margin: '6px 0' }}>{verificare.stare === 'eroare' ? `Verificarea n-a reușit: ${verificare.mesaj}` : verificare.mesaj}</div>}
    </div>
  )
}

// ── rezumatul citirii: devizele cu controlul fiecăruia, problemele, avertismentele, paragrafele ignorate ──
function RezumatCitire({ rez, amprenta }) {
  const [deschis, setDeschis] = useState(false)
  return (
    <div style={{ margin: '8px 0' }}>
      <div style={{ fontSize: 12.5, color: rez.complet ? G.green : G.yellow }} data-complet={rez.complet ? '1' : '0'}>
        {rez.complet ? '✓ Citire completă' : `⚠ Citire cu ${rez.probleme.length} probleme`}: {rez.devize.length} devize, {rez.linii.length} linii
        {rez.negative ? ` (${rez.negative} cu cantitate negativă)` : ''} · amprenta {String(amprenta).slice(0, 12)}…
        <button style={{ ...S.btn, marginLeft: 8, padding: '1px 8px', fontSize: 11.5 }} onClick={() => setDeschis(v => !v)}>{deschis ? 'ascunde devizele' : 'arată devizele'}</button>
      </div>
      {rez.probleme.length > 0 && (
        <ul style={{ margin: '6px 0', paddingLeft: 18, fontSize: 12, color: G.yellow }}>
          {rez.probleme.slice(0, 50).map((p, i) => <li key={i}>§{p.paragraf}: {p.motiv}</li>)}
          {rez.probleme.length > 50 && <li>… încă {rez.probleme.length - 50}</li>}
        </ul>
      )}
      {rez.avertismente.length > 0 && <ul style={{ margin: '6px 0', paddingLeft: 18, fontSize: 12, color: G.muted }}>{rez.avertismente.map((a, i) => <li key={i}>{a.motiv}</li>)}</ul>}
      {rez.ignorate.length > 0 && <div style={{ fontSize: 11.5, color: G.dim }}>{rez.ignorate.length} paragrafe necunoscute în zona articolelor (nu s-au citit ca articole; controlul pe sumă decide dacă lipsește ceva).</div>}
      {deschis && (
        <div style={{ overflowX: 'auto', marginTop: 6 }}>
          <table style={{ borderCollapse: 'collapse', minWidth: 760 }}>
            <thead><tr><th style={S.th}>Obiect</th><th style={S.th}>Deviz</th><th style={{ ...S.th, ...num }}>Articole</th><th style={{ ...S.th, ...num }}>Suma citită</th><th style={{ ...S.th, ...num }}>Control „Cheltuieli directe”</th><th style={{ ...S.th, ...num }}>Total general deviz</th><th style={S.th}>Control</th></tr></thead>
            <tbody>{rez.devize.map((d, i) => (
              <tr key={i}>
                <td style={S.td}>{d.obiect_cod} <span style={{ color: G.dim }}>{d.obiect_nume}</span></td>
                <td style={S.td}>{d.deviz_cod} <span style={{ color: G.dim }}>{String(d.deviz_nume || '').slice(0, 60)}</span></td>
                <td style={{ ...S.td, ...num }}>{d.linii.length}</td>
                <td style={{ ...S.td, ...num }}>{fmtLei(d.suma_articole)}</td>
                <td style={{ ...S.td, ...num }}>{fmtLei(d.control_cheltuieli_directe)}</td>
                <td style={{ ...S.td, ...num }}>{fmtLei(d.total_general)}</td>
                <td style={{ ...S.td, color: d.reconciliat ? G.green : G.red }}>{d.reconciliat ? '✓' : `✗ ${d.diferenta == null ? 'lipsă' : fmtLei(d.diferenta)}`}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── totalurile situației: citit (articole) / control / document / referința din situația de plată ──
function TotaluriSituatie({ rez, randuri, sl, diferenta }) {
  const t = totalLinii(randuri.map(r => r.linie))
  const cel = (et, v, culoare) => <div style={{ background: G.card2, border: `1px solid ${G.border}`, borderRadius: 8, padding: '6px 10px' }}><div style={{ fontSize: 11, color: G.dim }}>{et}</div><div style={{ fontSize: 14, fontWeight: 700, color: culoare || G.text, ...num }}>{v}</div></div>
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0' }} data-totaluri="1">
      {cel('Total articole citite (se trimite)', `${fmtLei(t)} lei`)}
      {cel('Control „Cheltuieli directe” (document)', rez.total_control == null ? '—' : `${fmtLei(rez.total_control)} lei`)}
      {cel('Total general devize (document)', rez.total_document == null ? '—' : `${fmtLei(rez.total_document)} lei`)}
      {cel('Situația de plată (valoare de bază)', sl ? `${fmtLei(sl.valoare_baza_lei)} lei` : '— nelegată —')}
      {diferenta != null && cel('Diferență articole − situație de plată', `${fmtLei(diferenta)} lei`, Math.abs(diferenta) > PRAG_DIFERENTA_LEI ? G.yellow : G.green)}
    </div>
  )
}

// ── liniile situației: nivelul potrivirii colorat, articolul propus, decizia omului ──
function TabelSituatie({ randuri, baza, blocaje, decide, blocat }) {
  const [doarDeRezolvat, setDoarDeRezolvat] = useState(false)
  const pe = useMemo(() => new Map(baza.map(b => [b.cheie, b])), [baza])
  const vizibile = doarDeRezolvat ? randuri.filter(r => blocaje.has(r.i) || r.decizie) : randuri
  return (
    <div style={{ marginTop: 8 }}>
      <label style={{ ...S.lbl, marginBottom: 6 }}><input type="checkbox" checked={doarDeRezolvat} onChange={e => setDoarDeRezolvat(e.target.checked)} /> doar liniile de rezolvat / decise</label>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 1000 }}>
          <thead><tr>
            <th style={S.th}>Obiect / deviz</th><th style={S.th}>Nr</th><th style={S.th}>Cod</th><th style={S.th}>Denumire</th><th style={S.th}>UM</th>
            <th style={{ ...S.th, ...num }}>Cantitate</th><th style={{ ...S.th, ...num }}>Valoare</th><th style={S.th}>Potrivire</th><th style={S.th}>Articolul din bază</th>
          </tr></thead>
          <tbody>{vizibile.map(r => {
            const l = r.linie, b = blocaje.get(r.i)
            const ales = r.decizie?.tip === 'articol' ? pe.get(r.decizie.cheie) : (l.cheie_propusa ? pe.get(l.cheie_propusa) : null)
            const cul = r.decizie ? G.purple : CULOARE_NIVEL[l.nivel] || G.dim
            return (
              <tr key={r.i} data-linie={r.i} data-nivel={l.nivel} data-blocat={b ? '1' : '0'} style={{ background: b ? G.red + '0D' : 'transparent' }}>
                <td style={{ ...S.td, color: G.muted, whiteSpace: 'nowrap' }}>{l.obiect_cod} / {l.deviz_cod}</td>
                <td style={S.td}>{l.nr}</td>
                <td style={{ ...S.td, fontFamily: 'monospace' }}>{l.cod}</td>
                <td style={{ ...S.td, maxWidth: 320 }}>{l.denumire}</td>
                <td style={S.td}>{l.um}</td>
                <td style={{ ...S.td, ...num, color: Number(l.cantitate) < 0 ? G.orange : G.text }}>{fmtCant(l.cantitate)}</td>
                <td style={{ ...S.td, ...num }}>{fmtLei(l.valoare)}</td>
                <td style={S.td}>
                  <span style={{ fontSize: 11, color: cul, border: `1px solid ${cul}55`, borderRadius: 10, padding: '1px 7px', whiteSpace: 'nowrap' }}>
                    {r.decizie?.tip === 'articol_nou' ? 'articol nou' : r.decizie?.tip === 'articol' ? 'ales manual' : r.decizie?.tip === 'confirm' ? 'confirmat' : ETICHETA_NIVEL[l.nivel] || l.nivel}
                  </span>
                  {b && <div style={{ fontSize: 11, color: G.red, marginTop: 3, maxWidth: 260 }}>{b}</div>}
                </td>
                <td style={{ ...S.td, minWidth: 260 }}>
                  {r.decizie?.tip === 'articol_nou' ? <span style={{ color: G.purple }}>în afara ofertei (apare separat, cu valoarea lui)</span>
                    : ales ? <span>{ales.cod} <span style={{ color: G.dim }}>{ales.obiect_cod}/{ales.deviz_cod}{ales.nr ? ` #${ales.nr}` : ''} · {ales.um}</span><div style={{ fontSize: 11, color: G.dim }}>{String(ales.denumire || '').slice(0, 80)}</div></span>
                    : <span style={{ color: G.dim }}>—</span>}
                  {!blocat && <DecizieRand r={r} baza={baza} decide={decide} />}
                </td>
              </tr>
            )
          })}</tbody>
        </table>
      </div>
    </div>
  )
}

function DecizieRand({ r, baza, decide }) {
  const l = r.linie
  const opt = useMemo(() => optiuniArticol(l, baza), [l, baza])
  const nesigur = l.nivel === 'de_verificat' || l.nivel === 'descriere'
  if (!nesigur && !r.decizie) return null
  const val = r.decizie?.tip === 'articol' ? r.decizie.cheie : r.decizie?.tip === 'articol_nou' ? '__nou' : ''
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
      {l.nivel === 'descriere' && r.decizie?.tip !== 'confirm' && <button style={{ ...S.btn, padding: '2px 8px', fontSize: 11.5, color: G.yellow }} onClick={() => decide(r.i, { tip: 'confirm' })}>confirm propunerea</button>}
      <select aria-label={`alege articolul liniei ${r.i + 1}`} value={val} style={{ ...S.inp, maxWidth: 300, fontSize: 11.5 }}
        onChange={e => decide(r.i, e.target.value === '' ? null : e.target.value === '__nou' ? { tip: 'articol_nou' } : { tip: 'articol', cheie: e.target.value })}>
        <option value="">{r.decizie ? '— anulează decizia —' : '— alegeți articolul —'}</option>
        <option value="__nou">➕ articol nou, în afara ofertei</option>
        {opt.map(b => <option key={b.cheie} value={b.cheie}>{b.cod} · {b.obiect_cod}/{b.deviz_cod}{b.nr ? ` #${b.nr}` : ''} · {b.um} · {String(b.denumire || '').slice(0, 50)}</option>)}
      </select>
      {opt.length === 0 && <span style={{ fontSize: 11, color: G.dim }}>niciun articol din bază cu UM „{l.um}”</span>}
    </div>
  )
}

// ── liniile devizului (ofertă / AA / notă): cantitățile cu semn ──
function TabelBaza({ rez }) {
  return (
    <div style={{ overflowX: 'auto', marginTop: 8 }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 900 }}>
        <thead><tr><th style={S.th}>Obiect / deviz</th><th style={S.th}>Nr</th><th style={S.th}>Cod</th><th style={S.th}>Denumire</th><th style={S.th}>UM</th><th style={{ ...S.th, ...num }}>Cantitate</th><th style={{ ...S.th, ...num }}>Valoare</th><th style={S.th}>Tip</th></tr></thead>
        <tbody>{rez.linii.map((l, i) => (
          <tr key={i} data-linie={i}>
            <td style={{ ...S.td, color: G.muted, whiteSpace: 'nowrap' }}>{l.obiect_cod} / {l.deviz_cod}</td>
            <td style={S.td}>{l.nr}</td>
            <td style={{ ...S.td, fontFamily: 'monospace' }}>{l.cod}</td>
            <td style={{ ...S.td, maxWidth: 360 }}>{l.denumire}</td>
            <td style={S.td}>{l.um}</td>
            <td style={{ ...S.td, ...num, color: Number(l.cantitate) < 0 ? G.orange : G.text }}>{fmtCant(l.cantitate)}</td>
            <td style={{ ...S.td, ...num }}>{fmtLei(l.valoare)}</td>
            <td style={{ ...S.td, color: l.incomplet ? G.red : G.muted }}>{l.incomplet ? 'incompletă' : l.tip_rand}</td>
          </tr>))}</tbody>
      </table>
    </div>
  )
}
