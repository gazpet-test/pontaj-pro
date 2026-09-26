// ════════════════════════════════════════════════════════════════
// ofertareCantitatiInvalidare.js — CÂND o aprobare („validat") a unui rând din ofertare_cantitati nu mai e valabilă.
//
// Copilot (26.09.2026, condiția 1 a „aprobat = validat"): invalidarea nu privește doar cifra. O schimbare relevantă a unității,
// a diametrului (Dn), a materialului, a SDR-ului, a tronsonului / etapei (obiectul) sau a sursei aplicabile face aprobarea
// anterioară nevalabilă chiar dacă lungimea rămâne identică. Valoarea și aprobarea veche se păstrează în ISTORIC.
//
// Regula (aceeași în BD — trigger-ul propus în docs/R5_MIGRARE_PROPUSA_aprobare_istoric.sql — și în aplicație):
//   rândul e 'validat' și o scriere schimbă RELEVANT oricare dintre CAMPURI_APROBARE ⇒ status 'diferenta' („de reverificat”),
//   cu nota „Rândul era VALIDAT — aprobarea veche (…) nu mai e valabilă: s-a schimbat …”. O validare explicită ulterioară
//   (UPDATE doar pe status, bifa ✓) rămâne posibilă — și e singurul drum înapoi în 'validat'.
//   - cifrele (cantitate, cifra din planșă): runda 1b (Copilot, închiderea R4/R5, 26.09.2026) — comparație EXACTĂ a valorii
//     CANONICE (`valoareCanonica`: zecimalul rotunjit la 6 zecimale, ca round(x, 6) din SQL), pe ORICE unitate, fără prag:
//     aprobat 100 m, cifră nouă 100,8 m = altă cantitate => invalidare. Excepție doar forma: 100 = 100,000 (aceeași valoare).
//     Pragurile (1 m pe unitățile de lungime m / ml / fără unitate; 1 % relativ) decid DOAR SEVERITATEA din notă
//     („diferență mică: +0,8 m, +0,8 %” / „diferență mare: …”, `descrieDiferenta`), nu păstrează aprobarea; pe buc / mp / mc / kg …
//     nu există prag în metri (doar cel relativ). Nicio conversie m ↔ ml. Apariția / dispariția cifrei contează. Cifra din planșă
//     se compară EFECTIV (cantitate_plansa, altfel cantitate), exact ca `cifraSchimbata` din transferul planșei și din citirea CAD:
//     prima cifră din planșă EGALĂ cu cantitatea nu e o schimbare (observația confirmă valoarea aprobată);
//     Roluri separate: `cantitate` = valoarea aprobată / folosită; `cantitate_plansa` = observația-candidat a citirii. Transferul și
//     CAD nu scriu niciodată `cantitate` pe un rând validat; o observație diferită îl scoate pe „diferenta”, iar valoarea aprobată
//     și sursa ei rămân în rând, în notă și în istoric (`valori_aprobate`), nesuprascrise tacit;
//   - textele (denumire — unde stau Dn / material / SDR / tronsonul —, specificații, obiect, categorie, sursa, tip_sursa,
//     cod_articol): orice schimbare după normalizare (spații — și cele Unicode, ca NBSP —, majuscule; `normText`, identic în SQL);
//   - unitatea de măsură (um): runda 6 (decis în audit 26.09.2026 pe principiile Copilot, reversibil) — comparată NORMALIZAT
//     (`normUm` = `normText`: spații — și NBSP —, trim, lower; SQL: public.ofertare_norm_text), ca „m” → „M” / „m ” să nu
//     invalideze (se raportează ca formă), dar „m” → „ml” da. Filtrele de rețea folosesc ACEEAȘI normalizare (randuriFront,
//     v_ofertare_cantitati_nevalidate, v6); v_ofertare_pt_stare.qm (live, neatins) cere încă exact 'm' — rândurile de rețea cu
//     unitatea scrisă altfel sunt SEMNALATE în view (um_de_normalizat_*) și în H2, nu scăzute tacit din totaluri;
//   - un rând NEAPROBAT care își schimbă unitatea din / în „m” (normalizat) iese / intră în rețea: nu invalidează (n-are aprobare),
//     dar nu dispare tacit din semnalul de lipsă — istoric 'unitate_schimbata' (trigger) și, până la migrare, prefixul notei
//     „Unitatea s-a schimbat (…) — … de reverificat.” (`aplicaRegulaUnitate`, păstrat de transfer / CAD ca prefixul invalidării);
//   - schimbările doar de FORMĂ (texte: majuscule / spații; unitatea „m” → „M”; cifre egale canonic, ex. zgomot de virgulă mobilă
//     sub 6 zecimale) nu invalidează, dar se raportează (`subPrag`; în BD: rând de istoric cu motivul „modificat_sub_prag” — numele
//     motivului rămâne, e în CHECK-ul tabelului; din 1b nicio cifră cu altă valoare nu mai ajunge aici).
//   - runda 5 (MAJOR verificator): comparația se face față de valoarea APROBATĂ (a ultimei validări, din istoric), nu față de
//     valoarea de dinainte de scriere (pașii mici cumulați — din 1b, deja primul pas invalidează).
//     `referinta` = rândul de la validare (`referinteDinIstoric`); fără istoric (migrarea neaplicată) = rândul de acum.
// Dn / material / SDR nu au coloane proprii: se citesc din denumire + specificații doar ca să NUMEASCĂ schimbarea în notă.
//
// COPII IDENTICE (ține-le la fel; testul src/ofertareCantitatiInvalidare.test.js compară octet cu octet):
//   src/ofertareCantitatiInvalidare.js (UI, 📋 Cantități) · api/_cantitatiInvalidare.js (citirea CAD, Vercel) ·
//   supabase/functions/ofertare-plansa-citeste/invalidare.js (transferul din planșă; deploy-ul pe folder nu garantează ../_shared).
// Funcții PURE, fără dependențe.
// ════════════════════════════════════════════════════════════════

export const STATUS_VALIDAT = 'validat'
export const STATUS_DE_REVERIFICAT = 'diferenta'
// runda 1b: fără toleranță la comparație; pragurile de mai jos decid DOAR severitatea din notă (SQL: aceleași valori, în trigger)
export const ZECIMALE_CANONICE = 6
export const PRAG_SEVERITATE_LUNGIME_M = 1
export const PRAG_SEVERITATE_PROCENT = 1
// ordinea = ordinea din notă
export const CAMPURI_APROBARE = ['licitatie_id', 'um', 'cantitate', 'cantitate_plansa', 'denumire', 'specificatii', 'obiect', 'categorie', 'tip_sursa', 'sursa', 'cod_articol']
export const ETICHETE_CAMP = {
  licitatie_id: 'licitația', um: 'unitatea de măsură', cantitate: 'cantitatea', cantitate_plansa: 'cifra din planșă',
  denumire: 'denumirea', specificatii: 'specificațiile', obiect: 'obiectul (tronson / etapă)', categorie: 'categoria',
  tip_sursa: 'tipul sursei', sursa: 'sursa', cod_articol: 'codul articolului (poziția din listă)',
  dn: 'Dn', material: 'materialul', sdr: 'SDR',
}
export const PREFIX_INVALIDARE = 'Rândul era VALIDAT — aprobarea veche'

const CIFRE = new Set(['cantitate', 'cantitate_plansa'])
// spațiile Unicode (NBSP, thin space …) devin spațiu, apoi spațiile ASCII se comasează — IDENTIC cu public.ofertare_norm_text (SQL)
const SPATII_UNICODE = /[\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]/g
export const normText = v => (v == null ? '' : String(v).replace(SPATII_UNICODE, ' ').replace(/[ \t\n\v\f\r]+/g, ' ').replace(/^ | $/g, '').toLowerCase())
const numar = v => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
// runda 6: unitatea NORMALIZATĂ (aceeași funcție ca textele; SQL: ofertare_norm_text) — și în filtrele de rețea
export const normUm = v => normText(v)
export const esteUnitateLungime = um => um == null || ['m', 'ml', ''].includes(normUm(um))
// ── runda 1b: valoarea CANONICĂ și comparația EXACTĂ (o singură sursă pentru toate căile: regula, transferul, CAD, editorul,
// poarta graficului) ──
// Aritmetică zecimală întreagă (BigInt), fără virgulă mobilă: se pornește de la zecimalul cel mai scurt al numărului (exact ce
// pleacă în JSON / PostgREST și ajunge `numeric` în BD), rotunjit EXACT, jumătatea departe de zero — ca round(x, n) din SQL.
const BI = n => BigInt(n)
const ZECE = BI(10)
// a / b cu rotunjire la jumătate în sus (a ≥ 0, b > 0) — ca round() / div() din SQL pe valori pozitive
const imparteRotunjit = (a, b) => (BI(2) * a + b) / (BI(2) * b)
// v rotunjit la `zec` zecimale → întreg BigInt = valoarea × 10^zec; null / '' / nenumeric => null
function zecimalRotunjit(v, zec) {
  const n = numar(v)
  if (n === null) return null
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(n))
  if (!m) return null
  const frac = m[3] || ''
  const cifre = BI(m[2] + frac)
  const k = Number(m[4] || 0) - frac.length + zec
  const q = k >= 0 ? cifre * ZECE ** BI(k) : imparteRotunjit(cifre, ZECE ** BI(-k))
  return m[1] ? -q : q
}
// Valoarea canonică = milionimi întregi (round(x, 6) din trigger): 100 = 100,000 = 100,0000001; 100 ≠ 100,8; 0,1 + 0,2 = 0,3.
export const valoareCanonica = v => zecimalRotunjit(v, ZECIMALE_CANONICE)
// aceeași valoare canonică (null = null); ORICE altă diferență contează — fără toleranță
export const aceeasiValoare = (a, b) => valoareCanonica(a) === valoareCanonica(b)
// a / b: numere sau null. Apariția / dispariția cifrei e mereu o schimbare. (Runda 1b: fără al treilea parametru „tol”.)
export const cifraDiferita = (a, b) => !aceeasiValoare(a, b)
const grupeaza = s => s.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
// număr ro-RO, max. 2 zecimale („2.210”, „35.620,59”) — runda 1b: rotunjire zecimală EXACTĂ, identică cu public.ofertare_fmt_ro
// (înainte toFixed + toLocaleString: 1,085 → „1,08” în JS, „1,09” în SQL; și dependent de ICU-ul browserului)
export const fmtRo = v => {
  const s = zecimalRotunjit(v, 2)
  if (s === null) return '—'
  const m = s < 0 ? -s : s, fr = String(m % BI(100)).padStart(2, '0').replace(/0+$/, '')
  return (s < 0 ? '-' : '') + grupeaza(String(m / BI(100))) + (fr ? ',' + fr : '')
}
// milionimi (cu semn) → text ro-RO cu toate zecimalele semnificative (max. 6): 800000 → „0,8”; 1000 → „0,001”; 600000000 → „600”
const fmtMilionimi = q => {
  const neg = q < BI(0), m = neg ? -q : q
  const fr = String(m % BI(1000000)).padStart(6, '0').replace(/0+$/, '')
  return (neg ? '-' : '') + grupeaza(String(m / BI(1000000))) + (fr ? ',' + fr : '')
}
// Reparația rundei 1 (verificatorul BD, minor „cifrele din notă”): cifrele din NOTA REGULII se scriu EXACT — valoarea canonică, cu toate
// zecimalele semnificative (max. 6) —, nu pe 2 zecimale: „100 m → 100,000001 m”, „1,084 mc → 1,085 mc” (înainte „100 m → 100 m”,
// „1,08 mc → 1,09 mc”, deci două cifre DIFERITE apăreau egale sau rotunjite). SQL: aceeași expresie în trigger (to_char pe round(x, 6)).
export const fmtExact = v => { const q = valoareCanonica(v); return q === null ? '—' : fmtMilionimi(q) }
// SEVERITATEA unei diferențe (doar pentru notă; nu decide nimic): „diferență mică: +0,8 m, +0,03 %” / „diferență mare: -600 m,
// -4,37 %”. Mică = sub 1 % relativ ȘI, pe unitățile de lungime, sub 1 m absolut (pe buc / mp / mc / kg … doar pragul relativ).
// |Δ| exact (valorile canonice, până la 6 zecimale — „+0,001 mc”, nu „+0 mc”); față de 0 nu există procent (=> mare). Identic, octet
// cu octet, cu textul trigger-ului (docs/R5_MIGRARE_1b_prag_exact.sql). Aceeași valoare / o cifră lipsă => ''.
// Reparația rundei 1 (verificatorul BD, minor „severitatea la limită”): pragul de 1 % se compară pe valoarea EXACTĂ (|Δ| × 100 < |a|,
// aritmetică întreagă), nu pe procentul deja rotunjit (0,999 % dădea „diferență mare … +1 %”), iar procentul AFIȘAT e TRUNCHIAT la 2
// zecimale (0,999 % => „0,99 %”): textul nu mai poate arăta pragul atins când diferența e sub el; 0 => „sub 0,01 %”.
export function descrieDiferenta(vechi, nou, { lungime = true, unitate = 'm' } = {}) {
  const a = valoareCanonica(vechi), b = valoareCanonica(nou)
  if (a === null || b === null || a === b) return ''
  const d = b - a, ad = d < 0 ? -d : d, aa = a < 0 ? -a : a
  const semn = d > 0 ? '+' : '-'
  const pct = aa === BI(0) ? null : (ad * BI(10000)) / aa   // sutimi de procent, TRUNCHIAT (BigInt: împărțire întreagă)
  const mica = pct !== null && ad * BI(100) < aa * BI(PRAG_SEVERITATE_PROCENT) && (!lungime || ad < BI(PRAG_SEVERITATE_LUNGIME_M * 1000000))
  const tp = pct === null ? '' : pct === BI(0) ? ', sub 0,01 %' : `, ${semn}${fmtRo(Number(pct) / 100)} %`
  return `diferență ${mica ? 'mică' : 'mare'}: ${semn}${fmtMilionimi(ad)} ${unitate}${tp}`
}

// Dn / material / SDR din denumire + specificații (doar pentru a numi schimbarea; aceleași expresii ca în trigger-ul SQL).
// Toate valorile găsite, unice, în ordinea apariției („Tub PE80 SDR17 (Dn315) pentru conductă Dn250” → Dn „315/250”).
const unice = xs => [...new Set(xs)].join('/') || null
export function atributeTehnice(r) {
  const t = `${r?.denumire || ''} ${r?.specificatii || ''}`
  const dn = unice([...t.matchAll(/(?:\bdn|\bde|ø|φ)\s*(\d{2,4})(?!\d)/gi)].map(m => m[1]))
  const sdr = unice([...t.matchAll(/\bsdr\s*(\d+(?:[.,]\d+)?)/gi)].map(m => m[1].replace(',', '.')))
  const pe100 = /\bpe\s*-?\s*100(?!\d)/i.test(t), pe80 = /\bpe\s*-?\s*80(?!\d)/i.test(t)
  const material = unice([pe100 && 'PE100', pe80 && 'PE80', !pe100 && !pe80 && /\b(pehd|pe)\b/i.test(t) && 'PE', /\bol\b|o[țţt]el/i.test(t) && 'OL'].filter(Boolean))
  return { dn, material, sdr }
}

// Ce schimbă `patch` pe rândul `vechi` (doar câmpurile din CAMPURI_APROBARE prezente în patch și diferite de `vechi`).
// `referinta` (opțional) = rândul APROBAT (de la ultima validare, `referinteDinIstoric`): relevanța se măsoară față de el, ca pașii
// mici cumulați să nu ocolească regula; fără ea, față de `vechi` (ca înainte). `vechi` din fiecare schimbare relevantă = valoarea aprobată.
// Runda 1b: cifrele se compară EXACT (valoarea canonică); pe cifre, schimbarea relevantă poartă `unitati` [veche, nouă] (afișate în
// notă) și `severitate` (`descrieDiferenta`, pe cifrele efective; doar dacă ambele există și unitatea normalizată e aceeași).
// → { relevante: [{camp, eticheta, vechi, nou, unitati?, severitate?}], subPrag: [...], derivate: [{camp: 'dn'|'material'|'sdr', …}] }
const unitateAfisata = um => (um == null || um === '' ? 'm' : um)   // SQL: coalesce(nullif(um, ''), 'm')
export function schimbariRelevante(vechi, patch, referinta = null) {
  const v = vechi || {}, p = patch || {}, ref = referinta || v
  const nou = { ...v, ...p }
  const relevante = [], subPrag = []
  const efectiva = r => numar(r.cantitate_plansa ?? r.cantitate)
  for (const camp of CAMPURI_APROBARE) {
    if (!(camp in p)) continue
    const a = v[camp], b = nou[camp], r = ref[camp]
    let distinct, relevant, extra = {}
    if (camp === 'licitatie_id') { distinct = numar(a) !== numar(b); relevant = numar(r) !== numar(b) }
    else if (CIFRE.has(camp)) {
      distinct = numar(a) !== numar(b)
      // cifra din planșă EFECTIVĂ (ca `referintaCitire` / `cifraSchimbata`); cantitatea — valoarea ei
      const pl = camp === 'cantitate_plansa'
      const ea = pl ? efectiva(ref) : numar(r), eb = pl ? efectiva(nou) : numar(b)
      relevant = cifraDiferita(ea, eb) && (!pl || cifraDiferita(r, b))
      // cifra din planșă e o lungime (m); cantitatea — în unitatea rândului (aprobată / nouă)
      extra = { unitati: pl ? ['m', 'm'] : [unitateAfisata(ref.um), unitateAfisata(nou.um)] }
      if (relevant && ea !== null && eb !== null && (pl || normUm(ref.um) === normUm(nou.um))) {
        extra.severitate = descrieDiferenta(ea, eb, { lungime: pl || esteUnitateLungime(nou.um), unitate: extra.unitati[1] }) +
          (pl && (numar(r) === null || numar(b) === null) ? `, efectiv ${fmtExact(ea)} m → ${fmtExact(eb)} m` : '')
      }
    } else if (camp === 'um') {
      // runda 6: normalizat (trim + lower + spații Unicode): „m” → „M” = doar formă; „m” → „ml” = relevant
      distinct = (a ?? '') !== (b ?? ''); relevant = normUm(r) !== normUm(b)
    } else {
      distinct = (a ?? '') !== (b ?? '')
      relevant = normText(r) !== normText(b)
    }
    if (!distinct) continue
    const x = { camp, eticheta: ETICHETE_CAMP[camp], vechi: (relevant ? r : a) ?? null, nou: b ?? null, ...extra };
    (relevant ? relevante : subPrag).push(x)
  }
  const derivate = []
  if (relevante.some(x => x.camp === 'denumire' || x.camp === 'specificatii')) {
    const ta = atributeTehnice(ref), tb = atributeTehnice(nou)
    for (const k of ['dn', 'material', 'sdr']) if ((ta[k] || null) !== (tb[k] || null)) derivate.push({ camp: k, eticheta: ETICHETE_CAMP[k], vechi: ta[k], nou: tb[k] })
  }
  return { relevante, subPrag, derivate }
}

// Reparația rundei 1 (verificatorul BD, minor „caractere astrale”): tăierea pe PUNCTE DE COD (Array.from), ca left() / length() din SQL —
// pe unități UTF-16 un emoji la poziția 59–60 lăsa un surogat singur („�”), iar PostgREST poate refuza scrierea.
const scurt = (s, n = 60) => { const t = String(s ?? '—'), cp = Array.from(t); return cp.length > n ? cp.slice(0, n - 1).join('') + '…' : t }
// i = 0 (valoarea aprobată) / 1 (cea nouă); runda 1b: cifrele în unitatea lor (cantitatea: a rândului; cifra din planșă: m);
// reparația rundei 1: cifrele EXACT (fmtExact, max. 6 zecimale), nu pe 2 zecimale
const valoare = (x, v, i) => (CIFRE.has(x.camp) ? `${fmtExact(v)}${v == null ? '' : ' ' + (x.unitati?.[i] ?? 'm')}` : x.camp === 'licitatie_id' ? `#${v ?? '—'}` : `„${scurt(v ?? '—')}”`)
export function descrieSchimbari({ relevante, derivate }) {
  const d = (derivate || []).map(x => `${x.eticheta} ${x.vechi ?? '—'} → ${x.nou ?? '—'}`)
  const c = (relevante || []).map(x => `${x.eticheta} (${valoare(x, x.vechi, 0)} → ${valoare(x, x.nou, 1)}${x.severitate ? '; ' + x.severitate : ''})`)
  return [...d, ...c].join('; ')
}
// momentul în UTC, „AAAA-LL-ZZ HH:MM” (ca to_char(… AT TIME ZONE 'UTC') din SQL), oricare ar fi fusul din text
const momentUtc = t => { const d = new Date(t); return Number.isNaN(d.getTime()) ? String(t).slice(0, 16).replace('T', ' ') : d.toISOString().slice(0, 16).replace('T', ' ') }
export function descrieAprobareaVeche(v) {
  const p = [`cantitate ${fmtExact(v?.cantitate)}${v?.cantitate == null ? '' : ' ' + (v?.um || 'm')}`]
  if (v?.cantitate_plansa != null) p.push(`cifra din planșă ${fmtExact(v.cantitate_plansa)} m`)
  if (v?.updated_at) p.push(`ultima scriere ${momentUtc(v.updated_at)}`)
  return p.join(', ')
}
// Orice prefix de invalidare pune o regulă („Rândul era VALIDAT — aprobarea veche (…) …” sau „Rândul era VALIDAT cu … —”, al
// transferului / CAD) se termină cu „validarea se reface.” — acolo se taie (SQL: aceeași regulă, în trigger).
const FINAL_PREFIX = 'validarea se reface.'
// R5 sarcina 2 (Copilot, închiderea R4/R5): prefixul pus de o CITIRE AUTOMATĂ (transferul din planșă, CAD) pe un rând validat — conflictul
// sau cifra diferită a recitirii justifică „de reverificat”, NU concluzia că aprobarea umană era greșită: valoarea și sursa aprobate rămân
// în rând (`cantitate`, `sursa`, `tip_sursa` — neatinse de transfer / CAD) și în istoric (aprobare_veche, valori_vechi). Terminatorul
// FINAL_PREFIX rămâne ultimul (prefixInvalidare / view / v6 recunosc prefixul după el).
export const DE_REVERIFICAT_CITIRE = 'de reverificat: citirea automată nu infirmă aprobarea (valoarea și sursa aprobate rămân în rând și în istoric); '
export const prefixInvalidare = nota => {
  const s = String(nota ?? '')
  if (!s.startsWith('Rândul era VALIDAT')) return ''
  const i = s.indexOf(FINAL_PREFIX)
  return i < 0 ? '' : s.slice(0, i + FINAL_PREFIX.length)
}
// scoate un prefix de invalidare anterior (să nu se adune la fiecare ciclu validare → schimbare)
export const faraPrefixVechi = nota => { const s = String(nota ?? ''), pre = prefixInvalidare(s); return pre ? s.slice(pre.length).replace(/^ +/, '') : s }
// Reparația rundei 1 (verificatorul BD, minor „nota pe drumul fără aplicație”): când SINGURA schimbare relevantă e cifra din planșă
// (observația-candidat a unei citiri — cantitatea aprobată, unitatea și textele au rămas), nota spune „de reverificat — o citire nouă
// nu infirmă aprobarea”, nu „aprobarea … nu mai e valabilă” (Copilot: conflictul / cifra unei recitiri justifică reverificarea, nu
// concluzia că aprobarea umană era greșită). Statusul trece tot pe „diferenta”; prefixul și terminatorul rămân (prefixInvalidare).
// SQL: aceeași ramură în trigger (v_rel_c = {cantitate_plansa}), nota octet cu octet (setul comun src/ofertareCantitati1b.cazuri.js).
export const doarObservatiePlansa = sch => (sch?.relevante || []).length === 1 && sch.relevante[0].camp === 'cantitate_plansa' && !(sch.derivate || []).length
export function notaInvalidare(aprobat, sch, notaNoua) {
  if (doarObservatiePlansa(sch)) return `${PREFIX_INVALIDARE} (${descrieAprobareaVeche(aprobat)}) e de reverificat: s-a schimbat ${descrieSchimbari(sch)} — ` +
    `o citire nouă a planșei nu infirmă aprobarea. Valoarea și aprobarea veche rămân în rând și în istoric; validarea se reface. ` + faraPrefixVechi(notaNoua)
  return `${PREFIX_INVALIDARE} (${descrieAprobareaVeche(aprobat)}) nu mai e valabilă: s-a schimbat ${descrieSchimbari(sch)}. ` +
    `Valoarea și aprobarea veche rămân în istoric; validarea se reface. ` + faraPrefixVechi(notaNoua)
}

// Regula la nivel de aplicație (pereche cu trigger-ul din BD, ca protecția să nu depindă doar de el):
// rând 'validat' + patch care schimbă relevant un atribut (față de valoarea APROBATĂ, `referinta`) ⇒ patch cu status 'diferenta'
// și nota de invalidare. Un patch care pune el însuși alt status (ex. transferul care a scris deja „Rândul era VALIDAT cu …”)
// se lasă cum e.  → { patch, invalidat: bool, schimbari }
export function aplicaRegulaAprobare(vechi, patch, referinta = null) {
  const sch = schimbariRelevante(vechi, patch, referinta)
  if (vechi?.status !== STATUS_VALIDAT || !sch.relevante.length) return { patch, invalidat: false, schimbari: sch }
  if (patch && 'status' in patch && patch.status !== STATUS_VALIDAT) return { patch, invalidat: true, schimbari: sch }
  const notaNoua = patch && 'diferenta_nota' in patch ? patch.diferenta_nota : vechi.diferenta_nota
  return { patch: { ...patch, status: STATUS_DE_REVERIFICAT, diferenta_nota: notaInvalidare(referinta || vechi, sch, notaNoua) }, invalidat: true, schimbari: sch }
}

// ── R5 runda 5 (verificator, MAJOR 1): starea „invalidat” nu depinde de textul notei ──
// Un rând scos din „validat” de regulă (sau redeschis) rămâne „invalidat” până la o validare nouă, oricine i-ar rescrie apoi nota
// (transferul din planșă și citirea CAD rescriu nota oricărui rând nevalidat). Două surse, aceeași regulă ca view-ul
// v_ofertare_cantitati_nevalidate: (1) ISTORICUL — ultimul eveniment al rândului e 'invalidat' / 'redeschis' (fără 'validat' după
// el); (2) până la aplicarea migrării, prefixul notei — pe care transferul și CAD îl PĂSTREAZĂ acum (`pastreazaInvalidarea`).
// runda 6: + 'unitate_schimbata' (rând NEAPROBAT a cărui unitate normalizată a ieșit din / intrat în „m”; nu atinge aprobarea).
export const MOTIVE_ISTORIC = ['validat', 'invalidat', 'redeschis', 'modificat_sub_prag', 'sters', 'unitate_schimbata']
// ordinea de citire nu contează (desc / paginat): se sortează aici crescător după id
const evenimenteValide = ev => (ev || []).filter(e => e && e.cantitate_id != null && MOTIVE_ISTORIC.includes(e.motiv))
  .sort((a, b) => Number(a.id) - Number(b.id))
// ultimul eveniment din `motive`, pe rând → Map(cantitate_id → motiv)
const ultimulDin = (evenimente, motive) => {
  const ultim = new Map()
  for (const e of evenimenteValide(evenimente)) if (motive.includes(e.motiv)) ultim.set(Number(e.cantitate_id), e.motiv)
  return ultim
}
// → Set(cantitate_id) cu ultimul eveniment al APROBĂRII 'invalidat' / 'redeschis' (runda 6: 'unitate_schimbata' nu șterge starea —
// un rând invalidat căruia i se schimbă apoi unitatea rămâne invalidat; SQL: același filtru pe motiv în view și v6)
export function invalidateDinIstoric(evenimente) {
  const ultim = ultimulDin(evenimente, ['validat', 'invalidat', 'redeschis', 'modificat_sub_prag', 'sters'])
  return new Set([...ultim].filter(([, m]) => m === 'invalidat' || m === 'redeschis').map(([id]) => id))
}
// → Set(cantitate_id) cu o schimbare de unitate (din / în „m”) după ultima validare (runda 6; SQL: același criteriu)
export function unitateSchimbataDinIstoric(evenimente) {
  const ultim = ultimulDin(evenimente, ['validat', 'unitate_schimbata'])
  return new Set([...ultim].filter(([, m]) => m === 'unitate_schimbata').map(([id]) => id))
}
// Valoarea APROBATĂ a fiecărui rând (referința regulii; identic cu trigger-ul): rândul de la ULTIMA validare înregistrată
// ('validat', valori_noi = rândul întreg); fără validare înregistrată (rând validat înainte de migrare) = rândul dinaintea PRIMEI
// scrieri înregistrate (valori_vechi — rândul era validat). Fără evenimente: lipsă (se folosește rândul de acum).
// → Map(cantitate_id → rând)
export function referinteDinIstoric(evenimente) {
  const per = new Map()
  for (const e of evenimenteValide(evenimente)) {
    const k = Number(e.cantitate_id), x = per.get(k) || {}
    if (e.motiv === 'validat') { if (e.valori_noi) x.validare = e.valori_noi }
    // 'unitate_schimbata' e scris pe un rând NEVALIDAT: nu e o aprobare, nu poate fi referință
    else if (e.motiv !== 'unitate_schimbata' && !x.prim && e.valori_vechi) x.prim = e.valori_vechi
    per.set(k, x)
  }
  const out = new Map()
  for (const [k, x] of per) if (x.validare || x.prim) out.set(k, x.validare || x.prim)
  return out
}
// ── runda 6: unitatea schimbată pe un rând NEAPROBAT (semnal până la aplicarea migrării; după ea, istoricul 'unitate_schimbata') ──
export const PREFIX_UNITATE = 'Unitatea s-a schimbat'
const FINAL_UNITATE = 'de reverificat.'
export const prefixUnitate = nota => {
  const s = String(nota ?? '')
  if (!s.startsWith(PREFIX_UNITATE)) return ''
  const i = s.indexOf(FINAL_UNITATE)
  return i < 0 ? '' : s.slice(0, i + FINAL_UNITATE.length)
}
const faraPrefixUnitate = nota => { const s = String(nota ?? ''), pre = prefixUnitate(s); return pre ? s.slice(pre.length).replace(/^ +/, '') : s }
// schimbarea de unitate care contează: normalizat diferit și una din ele e „m” (rândul iese din / intră în rețea)
export const unitateIeseDinRetea = (vechiUm, nouUm) => normUm(vechiUm) !== normUm(nouUm) && (normUm(vechiUm) === 'm' || normUm(nouUm) === 'm')
export function notaUnitate(vechiUm, nouUm, notaNoua) {
  const u = v => `„${v == null || v === '' ? '—' : v}”`
  return `${PREFIX_UNITATE} (${u(vechiUm)} → ${u(nouUm)})` + (normUm(nouUm) === 'm' ? '' : ' — rândul nu mai e o lungime de rețea în metri') +
    `; ${FINAL_UNITATE} ` + faraPrefixUnitate(notaNoua)
}
// Rând NEAPROBAT (validatul trece prin aplicaRegulaAprobare) + patch care schimbă unitatea din / în „m” (fără să-l valideze) =>
// nota primește prefixul „Unitatea s-a schimbat (…) … de reverificat.”  → { patch, unitate: bool }
export function aplicaRegulaUnitate(vechi, patch) {
  if (!patch || !('um' in patch) || vechi?.status === STATUS_VALIDAT || patch.status === STATUS_VALIDAT) return { patch, unitate: false }
  if (!unitateIeseDinRetea(vechi?.um, patch.um)) return { patch, unitate: false }
  const notaNoua = 'diferenta_nota' in patch ? patch.diferenta_nota : vechi?.diferenta_nota
  return { patch: { ...patch, diferenta_nota: notaUnitate(vechi?.um, patch.um, notaNoua).trim() }, unitate: true }
}
// prefixele de la începutul notei (invalidare și / sau unitate, în orice ordine)
const prefixeleNotei = nota => {
  let s = String(nota ?? ''), pre = []
  for (let i = 0; i < 2; i++) {
    const p = prefixInvalidare(s) || prefixUnitate(s)
    if (!p) break
    pre.push(p); s = s.slice(p.length).replace(/^ +/, '')
  }
  return pre.join(' ')
}
// Transferul / CAD rescriu nota unui rând NEVALIDAT: dacă rândul fusese invalidat (prefixul regulii) sau își schimbase unitatea
// (runda 6, prefixul unității), prefixele rămân în față.
export function pastreazaInvalidarea(vechi, patch) {
  if (!patch || !('diferenta_nota' in patch) || vechi?.status === STATUS_VALIDAT || patch.status === STATUS_VALIDAT) return patch
  const pre = prefixeleNotei(vechi?.diferenta_nota)
  const nou = String(patch.diferenta_nota ?? '')
  if (!pre || nou.startsWith('Rândul era VALIDAT') || nou.startsWith(PREFIX_UNITATE)) return patch
  return { ...patch, diferenta_nota: `${pre} ${patch.diferenta_nota ?? ''}`.trim() }
}

// ── runda 6 (verificatorul rundei 5, minor „istoric fără paginare”): citirea completă, pe pagini ──
// `pagina(from, to)` = o cerere PostgREST cu .range(from, to) (ordonată DESCRESCĂTOR după id, ca cele mai noi evenimente — ultima
// validare / invalidare — să vină primele). Se avansează cu câte rânduri au VENIT (un plafon db-max-rows mai mic decât `pas` nu sare
// rânduri) și se oprește la o pagină goală; peste `max` rânduri => eroare („istoric trunchiat”), ca apelantul să nu ia o listă
// tăiată drept completă.  → { data, error }
export async function citestePaginat(pagina, pas = 1000, max = 100000) {
  const out = []
  while (out.length <= max) {
    const { data, error } = await pagina(out.length, out.length + pas - 1)
    if (error) return { data: null, error }
    if (!data || !data.length) return { data: out, error: null }
    out.push(...data)
  }
  return { data: null, error: { message: `istoric trunchiat (peste ${max} evenimente)` } }
}
