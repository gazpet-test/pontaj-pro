/* FanTrimitere.jsx — F1 (docs/redari/FAN_FLUX_OPERATOR_SPEC.md §1, §2, §8.3, §8.5, §13 F1): ecranul OPERATORULUI pe un lot de plicuire —
   lista plicurilor cu semnele „gata / lipsește …”, plafonul zilei (v_red_fan_plafon_azi; eroare de citire = mesaj, nu „0”, L18), avertismentul Q2
   (toată trimiterea așteaptă aprobarea când nu încape), butonul unic „Trimite la curier” cu o singură confirmare și un singur mesaj (§8.5),
   registrul local al intenției (scris și verificat ÎNAINTE de apel; iese doar la rezultat dovedit; „Reia trimiterea” cu aceeași cheie — L05 în UI),
   „Verifică la curier” (reconcilierea pe borderou; „Confirmă: găsit” o reverifică serverul), „Retrage din trimitere”, „Retrage cererea”,
   „Anulează AWB-ul” (motiv din listă; în doi pași, curierul întâi) — toate prin funcția edge sau RPC-uri de clasa A, cu JWT-ul omului.
   Pentru owner: „Operatori curier”, „Cereri de aprobare” (aprobă / respinge), „Lista anulărilor”, plafonul zilei și presupunerea P429.
   Dreptul de operator vine din BD (fn_red_fan_e_operator), nu din JS; butonul e dezactivat cu motivul pentru cine nu e operator. */
import React, { useEffect, useMemo, useState } from 'react'
import { G, S, msgEroare, citestePaginat } from './comune.jsx'
import { stareTrimitere, textPlafonAzi, registruIntentii, intentieLocalaBlocanta, rezultatDovedit, deciziaIntentiei, mesajTrimitere, hashCerereFan, plicuriTrimisibile,
  MOTIVE_ANULARE, ETICHETE_MOTIV_ANULARE, ETICHETE_STARE_FAN, ARENDA_INTENTIE_MIN, titluLot, numeEtichete, numeControl, ziRo, textTarif } from '../fanLot.js'
import { descarcaBlob } from '../docx.js'

const ora = v => { const ms = Date.parse(v); if (!Number.isFinite(ms)) return '?'
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bucharest', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map(x => [x.type, x.value]))
  return `${p.day}.${p.month} ${p.hour}:${p.minute}` }
const Btn = ({ activ = true, motiv = '', titlu = '', lucru, onClick, children, stil }) => <button style={{ ...S.btnX, ...(stil || {}), opacity: activ ? 1 : 0.5 }} disabled={!activ || lucru}
  title={activ ? titlu : `${titlu}${titlu && motiv ? ' — ' : ''}${motiv}`} onClick={onClick}>{children}</button>

/**
 * Secțiunea operatorului. pregatite = pregatestePlicuriFan pe plicurile active; awb = rândurile FAN ale lotului; esteOperator = fn_red_fan_e_operator (true / false /
 * null); plafon = v_red_fan_plafon_azi (null = necitit); intentii = v_red_fan_intentii pe lot (null = necitit); cereri = cererile lotului; ruleaza(fn(curent)) = garda
 * acțiunilor părintelui (ocupat, generație, lot); edge(actiune, extra) → { corp, mesaj }; rpc(nume, args); controlDocx(manifestCheie, tiraj) → Blob | null.
 */
export default function TrimiteLaCurier({ proiect, lot, fanLot, pregatite, awb, esteOwner = false, esteOperator = null, evidentaInstalata = false, plafon = null, intentii = null, cereri = null,
  lucru = false, ruleaza, edge, rpc, controlDocx, OPRIT = 'Oprit: lotul s-a schimbat sau ecranul s-a închis; reîncarcă evidența.' }) {
  const lista = useMemo(() => plicuriTrimisibile(pregatite || [], awb || []), [pregatite, awb])
  const [debifate, setDebifate] = useState(() => new Set())   // implicit: toate plicurile trimisibile sunt bifate; se țin DEBIFĂRILE
  const [rezultat, setRezultat] = useState(null), [propuneri, setPropuneri] = useState(null), [anulare, setAnulare] = useState(null)
  const [ziVerificare, setZiVerificare] = useState(() => ziRo()), [tick, setTick] = useState(0)
  const reg = useMemo(() => registruIntentii(globalThis.localStorage), [])
  useEffect(() => { setDebifate(new Set()); setRezultat(null); setPropuneri(null); setAnulare(null) }, [lot.id])
  const selectate = lista.filter(p => p.trimisibil && !debifate.has(p.plic.id)).map(p => p.plic.id)
  const vie = (intentii || []).find(i => i.stare === 'in_curs' && Date.parse(i.lucru_pana_la) > Date.now()) || null
  const st = stareTrimitere({ evidentaInstalata, esteOperator, fanLot, proiectCod: proiect?.cod, selectate: selectate.length, plafon, intentieVie: vie })
  const op = esteOperator === true
  // registrul local față de BD: intrările lămurite (încheiate / inexistente / preluate) ies; restul rămân cu decizia lor
  const locale = useMemo(() => reg.peLot(lot.id), [reg, lot.id, tick])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!intentii) return
    let sterse = 0
    for (const e of locale) if (deciziaIntentiei(e, intentii.find(i => i.cheie === e.cheie) || null) === 'sterge') { reg.sterge(e.cheie); sterse++ }
    if (sterse) setTick(t => t + 1)
  }, [intentii, locale, reg])
  const bifeaza = (id, on) => setDebifate(s => { const n = new Set(s); if (on) n.delete(id); else n.add(id); return n })

  async function descarcaFoi(corp) {
    if (corp?.cod !== 'ok' || !Array.isArray(corp.pdf_parti) || !corp.pdf_parti.length || !corp.tiraj?.cheie) return ''
    const tiraj = { id: corp.tiraj.id, nr: corp.tiraj.nr, cheie: corp.tiraj.cheie, inceput_la: corp.tiraj.inceput_la }
    corp.pdf_parti.forEach((b64, i) => {
      const bin = atob(b64), bytes = new Uint8Array(bin.length)
      for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k)
      descarcaBlob(new Blob([bytes], { type: 'application/pdf' }), numeEtichete({ lot, fanLot, parte: i + 1, parti: corp.pdf_parti.length, tiraj }))
    })
    const control = typeof controlDocx === 'function' ? await controlDocx(corp.manifest_cheie, tiraj).catch(() => null) : null
    if (control) { descarcaBlob(control, numeControl({ lot, fanLot, tiraj })); return '' }
    return '\nPagina de control nu s-a putut genera acum (evidența s-a schimbat): „Descarcă AWB-urile” o aduce din nou.'
  }
  const trimiteCu = (cheie, ids, reluare) => ruleaza(async curent => {
    if (!reluare) {
      const s2 = stareTrimitere({ evidentaInstalata, esteOperator, fanLot, proiectCod: proiect?.cod, selectate: ids.length, plafon, intentieVie: vie })
      if (!s2.activ) return s2.motiv
      const bloc = intentieLocalaBlocanta(reg.peLot(lot.id), lot.id)
      if (bloc) return `O trimitere pornită din acest browser la ${ora(bloc.inceput_la)} e încă în registru: „Reia trimiterea” sau așteaptă ${ARENDA_INTENTIE_MIN} minute de la pornirea ei.`
      if (!window.confirm(`Trimiți ${ids.length} plicuri la curier pentru ${titluLot(lot, fanLot)}? Fiecare AWB costă.${s2.avertisment ? `\n\n${s2.avertisment}` : ''}`)) return 'Nimic trimis.'
      const hash = await hashCerereFan(ids)
      if (!reg.scrie(cheie, { lot_id: lot.id, plic_ids: ids, hash_cerere: hash })) return 'Registrul local al trimiterii nu s-a putut scrie (stocarea browserului e blocată): nimic trimis.'
    } else if (!window.confirm(`Reiei trimiterea pornită la ${ora(reluare.inceput_la)} (${ids.length} plicuri), cu aceeași cheie? Nimic nu se aprobă din nou; se trimit doar rândurile deja aprobate.`)) return 'Nimic reluat.'
    if (!curent()) { if (!reluare) reg.sterge(cheie); return OPRIT }
    const { corp } = await edge('trimite', { plic_ids: ids, intentie: cheie })
    if (rezultatDovedit(corp)) reg.sterge(cheie)
    setTick(t => t + 1)
    if (curent()) setRezultat(corp || null)
    return mesajTrimitere(corp) + await descarcaFoi(corp)
  })
  const trimite = () => trimiteCu(globalThis.crypto.randomUUID(), selectate, null)
  const verifica = () => ruleaza(async curent => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ziVerificare)) return 'Alege ziua borderoului (ziua trimiterii).'
    const { corp, mesaj } = await edge('reconciliaza', { data: ziVerificare })
    if (corp?.cod !== 'ok' || !Array.isArray(corp.propuneri)) return mesaj
    if (curent()) setPropuneri({ data: ziVerificare, lista: corp.propuneri, complet: corp.complet, neinterpretabile: corp.neinterpretabile || 0 })
    const gasite = corp.propuneri.filter(p => p.stare === 'gasit').length
    return `Verificare la curier (borderoul din ${ziVerificare}): ${gasite} găsite de confirmat, ${corp.propuneri.length - gasite} de verificat în contul curierului${corp.neinterpretabile ? `; ${corp.neinterpretabile} elemente neinterpretabile` : ''}.`
  })
  const confirmaGasit = p => ruleaza(async curent => {
    if (p.stare !== 'gasit' || !p.awb) return 'Din ecran se confirmă doar „găsit”; absența o confirmă proprietarul (un AWB nou costă).'
    if (!window.confirm(`Confirmi pentru ${p.nr_plic} AWB-ul ${p.awb}, găsit în borderoul din ${propuneri.data}? Platforma îl reverifică la curier înainte să-l scrie.`)) return 'Nimic confirmat.'
    if (!curent()) return OPRIT
    const { corp, mesaj } = await edge('reconciliaza', { data: propuneri.data, confirma: { id: p.id } })
    if (corp?.cod !== 'ok') return mesaj
    if (curent()) setPropuneri(x => x && { ...x, lista: x.lista.filter(y => y.id !== p.id) })
    return `${p.nr_plic}: AWB ${corp.confirmat?.awb || p.awb} confirmat${corp.confirmat?.stare ? ` (${ETICHETE_STARE_FAN[corp.confirmat.stare] || corp.confirmat.stare})` : ''}.`
  })
  const retrage = r => ruleaza(async curent => {
    if (!window.confirm(`Retragi ${r.nr_plic} din trimitere? Rândul devine „retras”; plafonul consumat nu se restituie. Plicul se poate trimite din nou doar dintr-un lot nou sau după o nouă propunere.`)) return 'Nimic schimbat.'
    if (!curent()) return OPRIT
    const { error } = await rpc('fn_red_fan_retrage', { p_id: r.id, p_motiv_cod: esteOwner ? 'owner' : 'operator' })
    if (error) throw error
    return `${r.nr_plic}: retras din trimitere.`
  })
  const retrageCererea = c => ruleaza(async curent => {
    if (!window.confirm(`Retragi cererea de aprobare (${c.n} plicuri)? Rândurile revin „propus” și nu mai așteaptă decizia proprietarului.`)) return 'Nimic schimbat.'
    if (!curent()) return OPRIT
    const { error } = await rpc('fn_red_fan_cerere_retrage', { p_id: c.id }); if (error) throw error
    return 'Cererea de aprobare a fost retrasă.'
  })
  const anuleaza = () => ruleaza(async curent => {
    const a = anulare
    if (!a) return 'Alege AWB-ul.'
    if (!MOTIVE_ANULARE.includes(a.motiv)) return 'Alege motivul anulării din listă.'
    if (a.motiv === 'alt_motiv' && !(a.nota || '').trim()) return 'La „alt motiv” nota e obligatorie (cel mult 200 de caractere).'
    if (!window.confirm(`Anulezi AWB-ul ${a.rand.awb} al plicului ${a.rand.nr_plic} (${ETICHETE_MOTIV_ANULARE[a.motiv]})? Platforma cere întâi ștergerea la curier; „anulat” se scrie doar după răspunsul lui. Dacă foaia AWB era tipărită, distruge-o.`)) return 'Nimic schimbat.'
    if (!curent()) return OPRIT
    const { corp, mesaj } = await edge('sterge_awb', { rand_id: a.rand.id, motiv_cod: a.motiv, nota: a.motiv === 'alt_motiv' ? a.nota.trim().slice(0, 200) : null })
    if (curent() && corp?.cod === 'ok') setAnulare(null)
    return corp?.cod === 'ok' ? `AWB-ul ${a.rand.awb} (${corp.anulat}) a fost anulat (motiv: ${ETICHETE_MOTIV_ANULARE[a.motiv]}); proprietarul îl vede în lista anulărilor.` : mesaj
  })

  const aprobate = (awb || []).filter(r => ['aprobat', 'propus'].includes(r.stare))
  const generate = (awb || []).filter(r => r.stare === 'generat')
  const nelamurite = (awb || []).filter(r => ['in_curs', 'necunoscut'].includes(r.stare))
  const cereriDeschise = (cereri || []).filter(c => c.stare === 'deschisa')
  const t = (plafon?.limita_zi ?? null) === null ? null : plafon
  return <div style={{ ...S.card, marginBottom: 8, borderColor: G.blue }}>
    <b style={{ fontSize: 14 }}>📦 Trimite la curier</b>
    <div style={{ fontSize: 12.5, color: t ? G.text : G.yellow, margin: '4px 0' }}>{textPlafonAzi(t)}</div>
    {esteOperator === false && <div style={{ fontSize: 12.5, color: G.yellow }}>Nu ești pe lista operatorilor numiți de proprietar: butonul e dezactivat. Proprietarul te poate numi din „Operatori curier”.</div>}
    {esteOperator === null && evidentaInstalata && <div style={{ fontSize: 12.5, color: G.yellow }}>Dreptul de operator nu s-a putut verifica (reîncarcă).</div>}
    {vie && <div style={{ fontSize: 12.5, color: G.yellow }}>O trimitere e în curs pe acest lot (pornită la {ora(vie.inceput_la)}); până la {ora(vie.lucru_pana_la)} nicio altă apăsare nu trimite.</div>}
    <div style={{ display: 'grid', gap: 2, margin: '6px 0', maxHeight: 260, overflowY: 'auto' }}>
      {lista.map(p => <label key={p.plic.id} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5 }}>
        <input type="checkbox" disabled={!p.trimisibil || lucru} checked={p.trimisibil && !debifate.has(p.plic.id)} onChange={e => bifeaza(p.plic.id, e.target.checked)} aria-label={`Trimite ${p.plic.nr_plic}`} />
        <b>{p.plic.nr_plic}</b>
        <span style={{ color: G.muted }}>{p.shipment?.recipient?.name || '(fără nume)'} · {[p.shipment?.recipient?.address?.locality, p.shipment?.recipient?.address?.county].filter(Boolean).join(', ')}</span>
        {p.trimisibil ? <span style={{ color: G.green }}>✓ gata{p.rand ? ` (${ETICHETE_STARE_FAN[p.rand.stare]})` : ''}</span> : <span style={{ color: G.yellow }}>⚠ {p.motiv}{p.rand?.awb ? ` · AWB ${p.rand.awb}` : ''}</span>}
      </label>)}
      {!lista.length && <span style={{ color: G.muted, fontSize: 12.5 }}>niciun plic activ în lot</span>}
    </div>
    <div style={{ fontSize: 12.5, marginBottom: 4 }}>Selectate: {selectate.length} din {lista.length} plicuri.{st.avertisment && <span style={{ color: G.red, fontWeight: 700 }}> {st.avertisment}</span>}</div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      <Btn activ={st.activ} motiv={st.motiv} lucru={lucru} onClick={trimite} stil={{ fontWeight: 700 }} titlu="o singură confirmare; un singur mesaj la final">Trimite la curier ({selectate.length} plicuri)</Btn>
      <input style={{ ...S.input, width: 140 }} type="date" value={ziVerificare} disabled={lucru || !op} onChange={e => setZiVerificare(e.target.value)} aria-label="Ziua borderoului verificat" />
      <Btn activ={op && evidentaInstalata} motiv={!op ? 'doar operatorii numiți sau owner-ul' : 'evidența FAN nu e instalată'} lucru={lucru} onClick={verifica}
        titlu="borderoul curierului pentru ziua aleasă: ce AWB există pentru rândurile neconfirmate; „găsit” se confirmă din ecran, absența o confirmă proprietarul">Verifică la curier{nelamurite.length ? ` (${nelamurite.length} neconfirmate)` : ''}</Btn>
    </div>
    {!st.activ && st.motiv && <div style={{ fontSize: 12, color: G.yellow, marginTop: 4 }}>Butonul e dezactivat: {st.motiv}.</div>}
    {locale.map(e => { const bd = intentii ? intentii.find(i => i.cheie === e.cheie) || null : undefined
      const d = bd === undefined ? 'necitit' : deciziaIntentiei(e, bd)
      return <div key={e.cheie} style={{ fontSize: 12.5, marginTop: 6, padding: 6, borderRadius: 6, background: G.yellowDim, color: G.yellow }}>
        Trimitere pornită la {ora(e.inceput_la)} ({e.plic_ids.length} plicuri), neîncheiată
        {d === 'reia' && <> · <Btn lucru={lucru} activ={op} motiv="doar operatorul ei sau owner-ul" onClick={() => trimiteCu(e.cheie, e.plic_ids, e)}>Reia trimiterea</Btn></>}
        {d === 'verifica' && ` · ${bd.necunoscute} plicuri cu rezultat neconfirmat: „Verifică la curier” (NU retrimite)`}
        {d === 'asteapta' && ` · încă rulează (alt tab?) până la ${ora(bd.lucru_pana_la)}`}
        {d === 'necitit' && ' · starea din evidență nu s-a putut citi (reîncarcă)'}
      </div> })}
    {(intentii || []).filter(i => i.stare === 'in_curs' && !locale.some(e => e.cheie === i.cheie)).map(i => <div key={i.cheie} style={{ fontSize: 12.5, marginTop: 6, color: G.muted }}>
      Trimitere neîncheiată din alt browser (pornită la {ora(i.inceput_la)}; {i.ramase} aprobate rămase, {i.necunoscute} neconfirmate)
      {Number(i.necunoscute) > 0 ? ': „Verifică la curier”' : Date.parse(i.lucru_pana_la) > Date.now() ? `: încă rulează până la ${ora(i.lucru_pana_la)}` : ': expirată — „Trimite la curier” preia rândurile aprobate (fără aprobare nouă)'}.</div>)}
    {rezultat && Array.isArray(rezultat.excluse) && rezultat.excluse.length + (rezultat.respinse?.length || 0) > 0 && <div style={{ fontSize: 12, color: G.muted, marginTop: 4 }}>Ultimul rezultat are {rezultat.respinse?.length || 0} respinse și {rezultat.excluse.length} excluse: detaliile sunt în mesaj.</div>}
    {propuneri && <div style={{ ...S.card, marginTop: 6 }}>
      <b>Verificare la curier — borderoul din {propuneri.data}</b>{propuneri.complet === false ? ' (borderou incomplet)' : ''}{propuneri.neinterpretabile ? ` · ${propuneri.neinterpretabile} elemente neinterpretabile: rândurile rămân de verificat în contul curierului` : ''}
      {propuneri.lista.map(p => <div key={p.id}>{p.nr_plic} · {p.stare === 'gasit' ? `găsit: AWB ${p.awb}` : p.stare === 'lipsa' ? 'nu apare în borderou (absența o confirmă proprietarul)' : `de verificat în contul curierului: ${p.motiv || ''}`}
        {' '}{p.stare === 'gasit' && <Btn lucru={lucru} activ={op} motiv="doar operatorii numiți sau owner-ul" onClick={() => confirmaGasit(p)}>Confirmă: găsit</Btn>}</div>)}
      {!propuneri.lista.length && <div style={{ color: G.muted }}>nimic de confirmat</div>}
    </div>}
    {cereriDeschise.length > 0 && <div style={{ fontSize: 12.5, marginTop: 6, color: G.yellow }}>
      {cereriDeschise.map(c => <div key={c.id}>Cerere de aprobare deschisă din {ora(c.cerut_la)}: {c.n} plicuri așteaptă decizia proprietarului.{' '}
        <Btn lucru={lucru} activ={op} motiv="doar cel care a cerut sau owner-ul" onClick={() => retrageCererea(c)}>Retrage cererea</Btn></div>)}
    </div>}
    {(aprobate.length > 0 || generate.length > 0) && <details style={{ marginTop: 6, fontSize: 12.5 }}>
      <summary>Retrage din trimitere ({aprobate.length}) · Anulează un AWB neridicat ({generate.length})</summary>
      {aprobate.map(r => <div key={r.id}>{r.nr_plic} · {ETICHETE_STARE_FAN[r.stare]} <Btn lucru={lucru} activ={op} motiv="doar operatorii numiți sau owner-ul" onClick={() => retrage(r)}>Retrage din trimitere</Btn></div>)}
      {generate.map(r => <div key={r.id}>{r.nr_plic} · AWB {r.awb} · {textTarif(r.tarif)}{r.anulare_ceruta_la ? ' · anulare cerută, așteaptă curierul' : ''}
        {' '}{!r.anulare_ceruta_la && anulare?.rand.id !== r.id && <Btn lucru={lucru} activ={op} motiv="doar operatorii numiți sau owner-ul" onClick={() => setAnulare({ rand: r, motiv: '', nota: '' })}>Anulează AWB-ul…</Btn>}
        {anulare?.rand.id === r.id && <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
          <select style={S.input} value={anulare.motiv} disabled={lucru} aria-label="Motivul anulării" onChange={e => setAnulare(a => a && { ...a, motiv: e.target.value })}>
            <option value="">motivul…</option>{MOTIVE_ANULARE.map(m => <option key={m} value={m}>{ETICHETE_MOTIV_ANULARE[m]}</option>)}</select>
          {anulare.motiv === 'alt_motiv' && <input style={S.input} maxLength={200} value={anulare.nota} disabled={lucru} placeholder="nota (obligatorie)" aria-label="Nota anulării" onChange={e => setAnulare(a => a && { ...a, nota: e.target.value })} />}
          <Btn lucru={lucru} onClick={anuleaza}>Confirmă anularea</Btn><Btn lucru={lucru} onClick={() => setAnulare(null)}>Renunță</Btn></span>}
      </div>)}
    </details>}
  </div>
}

/** Cererile de aprobare ale lotului (owner: aprobă / respinge cu motiv; §7.2). Vizibile și operatorului (starea lor). */
export function CereriAprobare({ cereri, esteOwner = false, lucru = false, ruleaza, rpc, OPRIT }) {
  const decide = (c, aproba) => ruleaza(async curent => {
    let motiv = null
    if (!aproba) { motiv = window.prompt(`Motivul respingerii cererii (${c.n} plicuri):`, ''); if (!motiv || !motiv.trim()) return 'Respingerea cere un motiv.' }
    else if (!window.confirm(`Aprobi cererea de ${c.n} plicuri? Rândurile devin „aprobat” FĂRĂ să consume plafonul zilei; operatorul apasă apoi din nou „Trimite la curier”.`)) return 'Nimic schimbat.'
    if (!curent()) return OPRIT
    const { data, error } = await rpc('fn_red_fan_cerere_decide', { p_id: c.id, p_aproba: aproba, p_motiv: motiv ? motiv.trim().slice(0, 500) : null }); if (error) throw error
    return aproba ? `Cerere aprobată: ${data?.aprobate ?? '?'} rânduri aprobate${data?.retrase ? `, ${data.retrase} retrase (plic mutat / anulat)` : ''}.` : `Cerere respinsă: ${data?.propuse ?? '?'} rânduri revin „propus”.`
  })
  if (!cereri) return null
  return <div style={{ ...S.card, marginBottom: 8 }}>
    <b>Cereri de aprobare (plafonul zilei)</b>{!cereri.length && <span style={{ color: G.muted }}> — nicio cerere pe acest lot</span>}
    {cereri.map(c => <div key={c.id} style={{ fontSize: 12.5 }}>{ora(c.cerut_la)} · {c.n} plicuri · {c.stare}{c.motiv ? ` · ${c.motiv}` : ''}
      {esteOwner && c.stare === 'deschisa' && <> <Btn lucru={lucru} onClick={() => decide(c, true)}>Aprobă</Btn> <Btn lucru={lucru} onClick={() => decide(c, false)}>Respinge…</Btn></>}</div>)}
  </div>
}

/** Owner: lista operatorilor (red_fan_operatori) + numirea / retragerea prin fn_red_fan_operator_seteaza; candidații = conturile cu nivel Redări admin / editor. */
export function OperatoriCurier({ client, lucru = false, ruleaza, activ = false, OPRIT, reload = 0 }) {
  const [stare, setStare] = useState({ operatori: null, candidati: null, eroare: '' }), [ales, setAles] = useState(''), [nota, setNota] = useState('')
  useEffect(() => {
    if (!activ || !client?.from) return undefined
    let viu = true
    ;(async () => {
      try {
        const operatori = await citestePaginat(() => client.from('red_fan_operatori').select('profile_id,numit_de,numit_la,retras_de,retras_la,nota'), { cheie: 'profile_id', esteCurent: () => viu })
        const acces = await citestePaginat(() => client.from('user_module_access').select('profile_id,access_level').eq('module', 'redari').in('access_level', ['admin', 'editor']), { cheie: 'profile_id', esteCurent: () => viu })
        const ids = [...new Set([...operatori.map(o => o.profile_id), ...acces.map(a => a.profile_id)])]
        const profile = []
        for (let i = 0; i < ids.length; i += 100) profile.push(...await citestePaginat(() => client.from('profiles').select('id,name').in('id', ids.slice(i, i + 100)), { cheie: 'id', esteCurent: () => viu }))
        const nume = new Map(profile.map(p => [p.id, p.name]))
        if (viu) setStare({ operatori: operatori.map(o => ({ ...o, nume: nume.get(o.profile_id) || o.profile_id })), candidati: acces.map(a => ({ id: a.profile_id, nume: nume.get(a.profile_id) || a.profile_id, nivel: a.access_level })), eroare: '' })
      } catch (e) { if (viu) setStare(s => ({ ...s, eroare: msgEroare(e) })) }
    })()
    return () => { viu = false }
  }, [client, activ, reload])
  const seteaza = (profil, on) => ruleaza(async curent => {
    const n = stare.candidati?.find(c => c.id === profil)?.nume || stare.operatori?.find(o => o.profile_id === profil)?.nume || profil
    if (!window.confirm(on ? `Îl numești pe ${n} operator curier (poate trimite plicuri la curier, sub plafonul zilei)?` : `Îi retragi lui ${n} dreptul de operator curier?`)) return 'Nimic schimbat.'
    if (!curent()) return OPRIT
    const { error } = await client.rpc('fn_red_fan_operator_seteaza', { p_profile: profil, p_activ: on, p_nota: on && nota.trim() ? nota.trim().slice(0, 200) : null }); if (error) throw error
    return on ? `${n}: numit operator curier.` : `${n}: dreptul de operator a fost retras.`
  })
  if (!activ) return null
  const activi = (stare.operatori || []).filter(o => !o.retras_la), retrasi = (stare.operatori || []).filter(o => o.retras_la)
  return <div style={{ ...S.card, marginBottom: 8 }}>
    <b>Operatori curier</b> <span style={{ color: G.muted, fontSize: 12 }}>(doar owner-ul numește / retrage; nivelul Redări admin / editor rămâne precondiție; istoricul rămâne)</span>
    {stare.eroare && <div role="alert" style={{ color: G.red }}>Lista nu s-a putut citi: {stare.eroare}</div>}
    {activi.map(o => <div key={o.profile_id} style={{ fontSize: 12.5 }}>{o.nume} · numit {ora(o.numit_la)}{o.nota ? ` · ${o.nota}` : ''} <Btn lucru={lucru} onClick={() => seteaza(o.profile_id, false)}>Retrage</Btn></div>)}
    {stare.operatori && !activi.length && <div style={{ color: G.muted, fontSize: 12.5 }}>niciun operator numit</div>}
    {retrasi.length > 0 && <div style={{ color: G.muted, fontSize: 12 }}>retrași: {retrasi.map(o => `${o.nume} (${ora(o.retras_la)})`).join(', ')}</div>}
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
      <select style={S.input} value={ales} disabled={lucru} aria-label="Colegul de numit" onChange={e => setAles(e.target.value)}>
        <option value="">colegul…</option>{(stare.candidati || []).filter(c => !activi.some(o => o.profile_id === c.id)).map(c => <option key={c.id} value={c.id}>{c.nume} ({c.nivel})</option>)}</select>
      <input style={S.input} maxLength={200} value={nota} disabled={lucru} placeholder="notă (opțional)" aria-label="Nota numirii" onChange={e => setNota(e.target.value)} />
      <Btn lucru={lucru} activ={!!ales} motiv="alege colegul" onClick={() => seteaza(ales, true)}>Numește operator</Btn>
    </div>
  </div>
}

/** Owner: lista anulărilor (v_red_fan_anulari): cererile deschise și anulările confirmate, cu filtru pe zi; „avea foaia tipărită” e necunoscut până la F1b. */
export function ListaAnulari({ client, activ = false, reload = 0 }) {
  const [zi, setZi] = useState(''), [stare, setStare] = useState({ lista: null, eroare: '' })
  useEffect(() => {
    if (!activ || !client?.from) return undefined
    let viu = true
    ;(async () => {
      try {
        let q = () => client.from('v_red_fan_anulari').select('id,nr_lot,nr_plic,awb,stare,anulare_ceruta_de,anulare_ceruta_la,anulare_ceruta_motiv,anulare_ceruta_nota,anulat_de,anulat_la,motiv_anulare,anulare_nota,foaie_tiparita')
        if (/^\d{4}-\d{2}-\d{2}$/.test(zi)) { const q0 = q; q = () => q0().gte('anulare_ceruta_la', `${zi}T00:00:00+02:00`).lt('anulare_ceruta_la', `${zi}T23:59:59.999+02:00`) }
        const lista = await citestePaginat(q, { cheie: 'id', esteCurent: () => viu })
        if (viu) setStare({ lista: lista.sort((a, b) => String(b.anulare_ceruta_la || b.anulat_la).localeCompare(String(a.anulare_ceruta_la || a.anulat_la))), eroare: '' })
      } catch (e) { if (viu) setStare({ lista: null, eroare: msgEroare(e) }) }
    })()
    return () => { viu = false }
  }, [client, activ, zi, reload])
  if (!activ) return null
  return <div style={{ ...S.card, marginBottom: 8 }}>
    <b>Lista anulărilor</b> <input style={{ ...S.input, width: 140 }} type="date" value={zi} onChange={e => setZi(e.target.value)} aria-label="Ziua anulărilor" /> <span style={{ color: G.muted, fontSize: 12 }}>(gol = toate)</span>
    {stare.eroare && <div role="alert" style={{ color: G.red }}>Lista nu s-a putut citi: {stare.eroare}</div>}
    {(stare.lista || []).map(a => <div key={a.id} style={{ fontSize: 12.5 }}>{a.nr_lot} · {a.nr_plic} · AWB {a.awb || '-'} · {a.stare === 'anulat' ? `anulat ${ora(a.anulat_la)} (${ETICHETE_MOTIV_ANULARE[a.motiv_anulare] || a.motiv_anulare}${a.anulare_nota ? `: ${a.anulare_nota}` : ''})`
      : `anulare cerută ${ora(a.anulare_ceruta_la)} (${ETICHETE_MOTIV_ANULARE[a.anulare_ceruta_motiv] || a.anulare_ceruta_motiv}), așteaptă curierul`} · foaia tipărită: {a.foaie_tiparita == null ? 'necunoscut (până la evidența tipăririlor)' : a.foaie_tiparita ? 'DA — de distrus' : 'nu'}</div>)}
    {stare.lista && !stare.lista.length && <div style={{ color: G.muted, fontSize: 12.5 }}>nicio anulare</div>}
  </div>
}

/** Owner: plafonul zilei (fn_red_fan_setari_limita_zi) și presupunerea „pauza curierului = nimic creat” (fn_red_fan_setari_presupunere_429, cu motiv). */
export function SetariZi({ plafon, lucru = false, ruleaza, rpc, activ = false, OPRIT }) {
  const [limita, setLimita] = useState('')
  const schimba = () => ruleaza(async curent => {
    const n = Number(limita)
    if (!Number.isInteger(n) || n < 0 || n > 5000) return 'Plafonul zilei trebuie să fie un număr întreg între 0 și 5000.'
    if (!window.confirm(`Plafonul zilei devine ${n} AWB-uri aprobate pe zi fără aprobarea ta (tot modulul)?`)) return 'Nimic schimbat.'
    if (!curent()) return OPRIT
    const { data, error } = await rpc('fn_red_fan_setari_limita_zi', { p_limita: n }); if (error) throw error
    return `Plafonul zilei: ${data}.`
  })
  const presupunere = on => ruleaza(async curent => {
    const motiv = window.prompt(on ? 'Motivul repunerii presupunerii „pauza curierului = nimic creat” (ex. răspunsul scris al curierului):' : 'Motivul opririi presupunerii (ex. răspunsul scris al curierului):', '')
    if (!motiv || !motiv.trim()) return 'Schimbarea cere un motiv.'
    if (!curent()) return OPRIT
    const { error } = await rpc('fn_red_fan_setari_presupunere_429', { p_valida: on, p_motiv: motiv.trim().slice(0, 200) }); if (error) throw error
    return on ? 'Presupunerea P429 e repusă: la o pauză a curierului fără AWB, plicurile revin „aprobat”.' : 'Presupunerea P429 e oprită: fiecare pauză a curierului se lămurește prin „Verifică la curier”.'
  })
  if (!activ) return null
  return <div style={{ ...S.card, marginBottom: 8, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
    <b>Plafonul zilei:</b> {plafon ? `${plafon.limita_zi} AWB-uri/zi (azi ${plafon.aprobate} aprobate, mai încap ${plafon.incap})` : 'necitit'}
    <input style={{ ...S.input, width: 90 }} type="number" min={0} max={5000} value={limita} disabled={lucru} onChange={e => setLimita(e.target.value)} aria-label="Plafonul zilei nou" />
    <Btn lucru={lucru} onClick={schimba}>Schimbă plafonul zilei</Btn>
    <span style={{ marginLeft: 8 }}>Presupunerea „pauza curierului = nimic creat”: <b>{plafon ? (plafon.presupunere_429 ? 'în picioare' : 'OPRITĂ') : 'necitită'}</b></span>
    {plafon && <Btn lucru={lucru} onClick={() => presupunere(!plafon.presupunere_429)}>{plafon.presupunere_429 ? 'Oprește (cu motiv)…' : 'Repune (cu motiv)…'}</Btn>}
    <span style={{ color: G.muted, fontSize: 12 }}>Garda „doar proiecte de TEST” în BD: {plafon ? (plafon.doar_proiecte_test ? 'pornită' : 'OPRITĂ') : 'necitită'} (se schimbă doar la trecerea la proiectul real).</span>
  </div>
}
