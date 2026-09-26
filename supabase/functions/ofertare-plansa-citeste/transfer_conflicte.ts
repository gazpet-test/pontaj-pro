// ════════════════════════════════════════════════════════════════
// transfer_conflicte.ts — R5 sarcina 2 (Copilot, închiderea R4/R5, condiția nr. 2a, 26.09.2026): conflictele transferului
// planșă → cantități PERSISTATE pe document, chiar când nu produc niciun rând în ofertare_cantitati.
//
// „Nimic scris ≠ nicio problemă”: un transfer care iese cu grupuri ambigue, Dn-uri doar „de verificat”, secvență Nr incompletă,
// rânduri fără lungime / fără Dn / fără identitate, mai multe rânduri TOTAL sau care NU s-a făcut (amânat / căzut) lasă sursa
// INCOMPLETĂ. Până acum urma stătea doar în analiza.citire_ai.sumar.cantitati (jurnalul scriitorului, necitit de nicio poartă):
// dacă rândurile existente erau validate, poarta vedea zero restanțe.
//
// Înregistrarea: analiza.transfer_cantitati (cheie de nivel 1 — NU în analiza.plansa, pe care o retăiere o înlocuiește întreagă, și
// NU în citire_ai.transfer, pe care lease-ul următorului transfer îl rescrie). Fără schemă nouă (analiza e jsonb). Legătura cu
// jurnalul: citire_ai.sumar.cantitati.inregistrare_id = transfer_cantitati.id — un transfer scris de codul vechi (fără legătură)
// e citit de SQL din jurnal (derivarea „legacy” din ofertare_transfer_stare, aceeași definiție ca `conflicteTransfer`).
//
// Închiderea unui conflict — NICIODATĂ ștergere tăcută:
//   - o recitire (transfer nou) fără conflicte: stare 'fara_conflicte', `inchis_prin: 'recitire_fara_conflicte'`, iar înregistrarea
//     închisă rămâne în `anterior` (cu conflictele ei) și rezumată în `istoric`;
//   - o confirmare umană explicită: confirmat_de / confirmat_la / confirmare_nota, scrise DOAR de funcția SQL
//     ofertare_transfer_conflicte_confirma (utilizator autentificat cu acces Ofertare, notă obligatorie; autorul = auth.uid(),
//     nu o valoare trimisă de client) — docs/R5_MIGRARE_PROPUSA_cantitati_nevalidate.sql;
//   - o recitire CU conflicte deschide o înregistrare nouă (o confirmare veche nu acoperă conflictele unei citiri noi).
// Un transfer eșuat / amânat NU șterge conflictele anterioare: e el însuși deschis ('neefectuat'), iar cele vechi stau în `anterior`.
// Funcții PURE — testate în transfer_conflicte_test.ts; construirea listei de conflicte (`conflicteTransfer`) e în handler.ts, lângă
// textele notelor pe care le refolosește.
//
// REPARAȚIA RUNDEI 1 (verificatorii + ADDENDUM 2 Copilot, 26.09.2026):
//  - „Recitirea «fără conflicte» NU închide conflictul dacă a pierdut chiar pozițiile / zonele problematice: cere acoperire demonstrată;
//    un rezultat gol sau parțial nu poate șterge prin absență un conflict anterior.” Fiecare conflict poartă ANCORELE lui (zone, Dn,
//    poziții din cantități); fiecare transfer, ACOPERIREA lui (citire completă? ce zone citite, ce Dn observate, cantitățile evaluate?).
//    Un conflict deschis al înregistrării precedente se închide doar dacă recitirea îi acoperă ancorele (și atunci citirea nouă decide:
//    dacă problema e încă acolo, apare ca un conflict nou); altfel e PURTAT în înregistrarea nouă ca 'nerezolvat_la_recitire'.
//  - Confirmarea umană = REZOLVARE sau EXCEPȚIE JUSTIFICATĂ, legată de înregistrarea EXACTĂ (confirmat_token = id), cu autor (uuid),
//    moment (ISO), tip și notă (min. 5 / 20 de caractere); orice altă formă NU închide (aceeași regulă ca în SQL,
//    ofertare_transfer_stare) — un `confirmat_la` oarecare scris direct nu mai ajunge.
//  - Jurnalul codului VECHI (fără înregistrare) e convertit, la prima scriere a codului nou, într-o înregistrare „legacy” cu aceleași
//    reguli ca derivarea SQL — inclusiv 'legacy_partial' (DESCHIS) când sumarul n-are marcajele R5 (identitate, Nr, TOTAL multiplu,
//    adnotări neevaluate de codul vechi): conflictele lui devin ancorate și nu mai pot dispărea la prima citire parțială.
// ════════════════════════════════════════════════════════════════

export const VERSIUNE_INREGISTRARE = 2;
// versiunea semanticii conflictelor (NU COD_VERSIUNE al citirii: acela decide compatibilitatea zonelor citite)
// t2 (reparația rundei 1): ancore + acoperire, confirmare cu tip / token, legacy_partial, TOTAL multiplu nescris, identitate incertă
export const COD_TRANSFER = '2026-09-26.t2';
export const MAX_CONFLICTE = 40;
export const MAX_ISTORIC = 10;

export type Ancore = { zone?: string[]; dn?: number[]; pozitii?: boolean };
export type ConflictTransfer = {
  tip: string; text: string; dn?: number | null; material?: string | null; metri?: number | null; fara_cantitate?: boolean;
  actiune?: string; pozitie_id?: number | null; pozitii?: { id: unknown; denumire: unknown }[];
  ancore?: Ancore; tip_initial?: string; din?: string | null;
};
// ce a acoperit un transfer: citirea COMPLETĂ (toate zonele citite, fără zone lipsă / căzute), zonele citite, Dn-urile observate
// (orice tronson — sigur, nestandard, adnotare, fără identitate), și dacă a EVALUAT rândurile din cantități (le-a citit și le-a comparat)
export type Acoperire = { complet: boolean; zone: string[]; dn: number[]; cantitati_evaluate: boolean };

export const STARE_INCHISA = 'fara_conflicte';
// compatibilitate (importat de teste / UI): stările care cer o decizie — de fapt ORICE stare în afară de 'fara_conflicte'
export const STARI_DESCHISE = ['conflicte', 'neefectuat', 'legacy_partial', 'necunoscut'];
export const TIPURI_CONFIRMARE = ['rezolvat', 'exceptie'];
export const NOTA_MIN: Record<string, number> = { rezolvat: 5, exceptie: 20 };
const RX_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}(:?\d{2})?)?$/;
const RX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// confirmarea care CONTEAZĂ (aceeași regulă ca ofertare_transfer_stare în SQL): autor uuid, moment ISO valid, tip rezolvat / excepție,
// nota minimă pe tip, legată de înregistrarea exactă (confirmat_token = id). Orice altceva = neconfirmat (deschis).
export const confirmareValida = (r: any): boolean => !!r && typeof r === 'object'
  && typeof r.confirmat_la === 'string' && RX_ISO.test(r.confirmat_la) && Number.isFinite(Date.parse(r.confirmat_la))
  && typeof r.confirmat_de === 'string' && RX_UUID.test(r.confirmat_de)
  && TIPURI_CONFIRMARE.includes(r.confirmare_tip) && String(r.confirmare_nota ?? '').trim().length >= NOTA_MIN[r.confirmare_tip]
  && r.confirmat_token != null && String(r.confirmat_token) === String(r.id);
// deschis = orice stare în afară de „fără conflicte” (inclusiv una necunoscută: fail-closed), fără o confirmare umană VALIDĂ
export const deschis = (r: any): boolean => !!r && typeof r === 'object' && r.stare !== STARE_INCHISA && !confirmareValida(r);

// rezumatul unei înregistrări în istoric (fără conflictele ei, fără istoricul ei)
export const rezumat = (r: any) => ({
  id: r?.id ?? null, la: r?.la ?? null, stare: r?.stare ?? null, n: Number(r?.n) || 0,
  confirmat_de: r?.confirmat_de ?? null, confirmat_la: r?.confirmat_la ?? null, confirmare_nota: r?.confirmare_nota ?? null,
  ...(r?.confirmare_tip ? { confirmare_tip: r.confirmare_tip } : {}),
  ...(r?.inchis_prin ? { inchis_prin: r.inchis_prin } : {}),
});

// ── acoperirea: un conflict anterior e ACOPERIT de un transfer dacă transferul i-a văzut toate ancorele ──
// fără nicio ancoră (ex. transfer căzut, evaluare parțială veche): acoperit doar de o citire COMPLETĂ și NEGOALĂ — cel puțin o zonă citită
// ȘI cel puțin un Dn observat (Copilot: „un rezultat GOL sau parțial nu poate șterge prin absență un conflict anterior” — o planșă citită
// fără nicio observație, de ex. ilizibilă, NU închide o evaluare parțială / un transfer căzut; rămâne pentru confirmarea omului)
export function acoperit(c: ConflictTransfer, a: Acoperire | null | undefined): boolean {
  if (!a || !a.complet) return false;
  const an = c?.ancore || {};
  const zone = (an.zone || []).map(String), dn = (an.dn || []).map(Number).filter(Number.isFinite);
  if (!zone.length && !dn.length && !an.pozitii) return (a.zone || []).length > 0 && (a.dn || []).length > 0;
  const Z = new Set((a.zone || []).map(String)), D = new Set((a.dn || []).map(Number));
  return zone.every((z) => Z.has(z)) && dn.every((d) => D.has(d)) && (!an.pozitii || a.cantitati_evaluate === true);
}
const descrieAncore = (an?: Ancore) => [an?.zone?.length ? `zonele ${an.zone.slice(0, 6).join(', ')}` : '',
  an?.dn?.length ? `Dn ${an.dn.slice(0, 6).join(', ')}` : '', an?.pozitii ? 'pozițiile din cantități' : ''].filter(Boolean).join(', ') || 'citirea completă';
// conflictul precedent, neacoperit, purtat în înregistrarea nouă (textul și ancorele originale — fără cuiburi „din citirea anterioară: …”)
function purtat(c: ConflictTransfer, prev: any, a: Acoperire | null | undefined): ConflictTransfer {
  if (c.tip === 'nerezolvat_la_recitire') return c;
  const cauza = !a ? 'transferul nu s-a făcut' : !a.complet ? 'recitirea nu e completă (zone lipsă / căzute)' : `recitirea nu a acoperit ${descrieAncore(c.ancore)}`;
  return { ...c, tip: 'nerezolvat_la_recitire', tip_initial: c.tip, din: prev?.id ?? null,
    text: `din transferul anterior (${String(prev?.la ?? '').slice(0, 16).replace('T', ' ') || 'data necunoscută'}), ÎNCĂ DESCHIS — ${cauza}: ${c.text}` };
}

// Înregistrarea nouă a unui transfer (sau a unui transfer amânat / căzut), peste cea precedentă `prev` (din documentul PROASPĂT —
// se reconstruiește la fiecare reîncercare CAS). `neefectuat` = transferul nu s-a făcut (amânat, eroare): stare deschisă.
// `acoperire` = ce a acoperit transferul (lipsă = nimic: conflictele precedente deschise sunt purtate toate).
export function inregistrareTransfer(prev: any, x: {
  conflicte: ConflictTransfer[]; neefectuat?: boolean; id: string; la: string; cod: string; acoperire?: Acoperire | null;
  rulare?: string | null; citire?: string | null; plansa?: string | null;
}) {
  const areAnterior = !!prev && typeof prev === 'object' && !!prev.id;
  const prevDeschis = areAnterior && deschis(prev);
  // conflictele DESCHISE ale precedentei: listate (plafonul de 40 — restul, dacă a fost trunchiat, ca un conflict fără ancore)
  const prevLista: ConflictTransfer[] = !prevDeschis ? [] : [
    ...(Array.isArray(prev.conflicte) ? prev.conflicte : []),
    ...((Number(prev.n) || 0) > (Array.isArray(prev.conflicte) ? prev.conflicte.length : 0)
      ? [{ tip: 'nerezolvat_la_recitire', tip_initial: 'lista_trunchiata', text: `${(Number(prev.n) || 0) - (Array.isArray(prev.conflicte) ? prev.conflicte.length : 0)} conflicte nelistate (lista trunchiată)` }]
      : []),
  ];
  const purtate = prevLista.filter((c) => !acoperit(c, x.acoperire)).map((c) => purtat(c, prev, x.acoperire));
  const inchiseLaRecitire = prevLista.length - purtate.length;
  const toate = [...x.conflicte, ...purtate];
  const n = toate.length;
  const stare = x.neefectuat ? 'neefectuat' : n ? 'conflicte' : STARE_INCHISA;
  const { istoric: istPrev, anterior: _a, ...prevFara } = areAnterior ? prev : ({} as any);
  const istoric = [...(areAnterior ? [rezumat(prev)] : []), ...(Array.isArray(istPrev) ? istPrev : [])].slice(0, MAX_ISTORIC);
  return {
    v: VERSIUNE_INREGISTRARE, id: x.id, la: x.la, cod: x.cod, cod_transfer: COD_TRANSFER,
    rulare: x.rulare ?? null, citire: x.citire ?? null, plansa: x.plansa ?? null,
    stare, n, conflicte: toate.slice(0, MAX_CONFLICTE), ...(n > MAX_CONFLICTE ? { trunchiat: true } : {}),
    acoperire: x.acoperire ?? null,
    confirmat_de: null, confirmat_la: null, confirmare_nota: null, confirmare_tip: null, confirmat_token: null,
    // conflictele deschise ale precedentei închise de o recitire care le-a ACOPERIT — explicit, cu urma lor
    ...(prevDeschis && inchiseLaRecitire > 0 ? { inchise_la_recitire: inchiseLaRecitire } : {}),
    ...(stare === STARE_INCHISA && prevDeschis ? { inchis_prin: 'recitire_fara_conflicte', inchide: prev.id } : {}),
    // înregistrarea precedentă, întreagă (cu conflictele ei; fără propriul `anterior` — lanțul nu crește), + istoricul rezumat
    ...(areAnterior ? { anterior: prevFara } : {}),
    istoric,
  };
}

// ── jurnalul codului VECHI (citire_ai.sumar.cantitati fără înregistrare legată) — aceleași reguli ca derivarea „legacy” din SQL
// (ofertare_transfer_stare). Marcajele R5 = sumarul are `identitate_randuri` (codul vechi — edge v25 — nu evalua identitatea, Nr,
// TOTAL-ul multiplu, adnotările). Fără ele și fără conflicte numărate => 'legacy_partial' (DESCHIS), nu „fără conflicte”.
export const areMarcajeR5 = (s: any) => !!s && typeof s === 'object' && !!s.identitate_randuri && typeof s.identitate_randuri === 'object';
export function stareLegacy(c: any, s: any, conflicte: ConflictTransfer[]): { stare: string; conflicte: ConflictTransfer[] } {
  const x = c && typeof c === 'object' ? c : {};
  if (x.eroare || x.amanat) return { stare: 'neefectuat', conflicte };
  if (conflicte.length) return { stare: 'conflicte', conflicte: areMarcajeR5(s) ? conflicte : [...conflicte, EVALUARE_PARTIALA] };
  if ('adaugate' in x && areMarcajeR5(s)) return { stare: STARE_INCHISA, conflicte: [] };
  if ('adaugate' in x) return { stare: 'legacy_partial', conflicte: [EVALUARE_PARTIALA] };
  return { stare: 'necunoscut', conflicte: [{ tip: 'necunoscut', text: 'jurnalul transferului are o formă necunoscută — nu putem verifica' }] };
}
// runda 9 (ADDENDUM 3 Copilot, 3): „verificare indisponibilă” — incertitudine de verificare, NU dovada unei contradicții în documentație; întâi
// reevaluarea deterministă pe observațiile salvate (fără AI, versiunea evaluării consemnată), altfel recitire țintită / review uman documentat
export const EVALUARE_PARTIALA: ConflictTransfer = { tip: 'evaluare_partiala', fara_cantitate: true,
  text: 'verificare indisponibilă: transfer evaluat de codul VECHI (edge publicat înainte de R5) — identitatea rândurilor, secvența Nr, rândurile fără lungime / fără Dn, ' +
    'TOTAL-ul multiplu și adnotările NU au fost verificate; „fără conflicte” nu e dovedit, dar nici o contradicție a documentației nu e dovedită. ' +
    'Reevaluează determinist pe observațiile salvate (fără AI) sau, dacă nu ajung, recitire țintită / review uman documentat (✋)' };
// ── RUNDA 9 (verificatorul BD, MAJOR M12): aceeași regulă ca ofertare_transfer_stare din SQL — o citire NETERMINATĂ (citire_ai.gata === false),
// fără înregistrare de transfer și fără jurnal de cantități = stare DESCHISĂ „citire neterminată” (edge-ul publicat v25 rescrie jurnalul la
// fiecare rundă; o rundă neterminată scotea conflictele din poartă). null = regula nu se aplică. NU e folosită la conversia din handler
// (inregistrareLegacy): codul nou, la citirea COMPLETĂ, evaluează toată planșa (identitate, Nr, TOTAL, adnotări) — purtarea unei stări
// fără ancore ar lăsa deschisă orice citire completă goală (planșă fără tronsoane). Exportată pentru paritatea SQL ↔ JS (teste).
export function stareCitireNeterminata(analiza: any): { stare: string; n: number; restante: { tip: string; n: number }[] } | null {
  const a = eObiect(analiza) ? analiza : null;
  // o înregistrare prezentă (obiect — sau coruptă: formaCorupta / „necunoscut” în SQL) are prioritate
  if (!a || a.transfer_cantitati != null || formaCorupta(a) || !eObiect(a.citire_ai) || a.citire_ai.gata !== false) return null;
  if (eObiect(a.citire_ai.sumar) && eObiect(a.citire_ai.sumar.cantitati)) return null;
  return { stare: 'citire_neterminata', n: 1, restante: [{ tip: 'citire_neterminata', n: 1 }] };
}
// ── Reparația rundei 2 (verificatorul UI, V-C4 — corupție de TIP): aceleași reguli ca ofertare_transfer_stare din SQL. O cheie a serverului
// PREZENTĂ, dar de alt tip decât obiect (înregistrarea = array / text; jurnalul citire_ai / sumar / cantitati = text) => „necunoscut”
// DESCHIS, nu „nimic”: înregistrarea coruptă contează oricând, jurnalul corupt doar fără o înregistrare-obiect. null (JSON) = absent.
const eObiect = (x: any) => !!x && typeof x === 'object' && !Array.isArray(x);
const tipJs = (x: any) => (Array.isArray(x) ? 'array' : typeof x);
export function formaCorupta(analiza: any): string | null {
  const a = eObiect(analiza) ? analiza : {};
  if ('transfer_cantitati' in a && a.transfer_cantitati !== null && !eObiect(a.transfer_cantitati)) return `transfer_cantitati de tip ${tipJs(a.transfer_cantitati)}`;
  if (eObiect(a.transfer_cantitati)) return null;
  const ca = a.citire_ai;
  if ('citire_ai' in a && ca !== null && !eObiect(ca)) return 'citire_ai nu e obiect';
  if (eObiect(ca) && 'sumar' in ca && ca.sumar !== null && !eObiect(ca.sumar)) return 'sumar nu e obiect';
  if (eObiect(ca?.sumar) && 'cantitati' in ca.sumar && ca.sumar.cantitati !== null && !eObiect(ca.sumar.cantitati)) return 'cantitati nu e obiect';
  return null;
}
// înregistrarea precedentă a unui document, pentru transferul nou: cea salvată (obiect) sau, fără ea, jurnalul vechi / forma coruptă convertite
export const inregistrarePrecedenta = (analiza: any, conflicteDin: (c: any, s: any) => ConflictTransfer[], la?: string) =>
  eObiect(analiza?.transfer_cantitati) ? analiza.transfer_cantitati : inregistrareLegacy(analiza, conflicteDin, la);
// înregistrarea „legacy” sintetică: jurnalul vechi nelegat de nicio înregistrare, convertit ca să nu dispară când citirea nouă îl suprascrie
// (reparația rundei 2: și forma coruptă => o înregistrare „necunoscut” deschisă, fără ancore — o închide doar o citire COMPLETĂ și negoală,
// sau confirmarea omului; înainte, un array în transfer_cantitati era ignorat, iar orice citire, chiar goală, trecea peste el)
export function inregistrareLegacy(analiza: any, conflicteDin: (c: any, s: any) => ConflictTransfer[], la?: string) {
  const a = analiza && typeof analiza === 'object' ? analiza : {};
  const cor = formaCorupta(a);
  if (cor) {
    return {
      v: VERSIUNE_INREGISTRARE, id: `corupt-js:${crypto.randomUUID()}`, sursa: 'necunoscut', la: la || null, cod: 'forma-corupta', cod_transfer: COD_TRANSFER,
      stare: 'necunoscut', n: 1, conflicte: [{ tip: 'necunoscut', fara_cantitate: true,
        text: `înregistrarea / jurnalul transferului anterior era corupt (${cor}) — nu putem verifica ce conflicte avea; îl închide doar o citire completă și negoală sau confirmarea explicită` }],
      acoperire: null, confirmat_de: null, confirmat_la: null, confirmare_nota: null, confirmare_tip: null, confirmat_token: null, istoric: [],
    };
  }
  if (a.transfer_cantitati && typeof a.transfer_cantitati === 'object') return null;
  const s = a.citire_ai?.sumar, c = s?.cantitati;
  if (!c || typeof c !== 'object' || 'in_curs' in c || c.inregistrare_id) return null;
  const st = stareLegacy(c, s, conflicteDin(c, s));
  return {
    v: VERSIUNE_INREGISTRARE, id: `legacy-js:${crypto.randomUUID()}`, sursa: 'legacy', la: la || a.citire_ai?.transfer?.la || a.citire_ai?.actualizat || null,
    cod: 'jurnal-vechi', cod_transfer: COD_TRANSFER, stare: st.stare, n: st.conflicte.length, conflicte: st.conflicte.slice(0, MAX_CONFLICTE),
    ...(st.conflicte.length > MAX_CONFLICTE ? { trunchiat: true } : {}), acoperire: null,
    confirmat_de: null, confirmat_la: null, confirmare_nota: null, confirmare_tip: null, confirmat_token: null, istoric: [],
  };
}
// restanțele pe tip (pentru afișare / paritatea cu SQL): { tip: număr }
export const restantePeTip = (conflicte: ConflictTransfer[]) => (conflicte || []).reduce((o: Record<string, number>, c) => ({ ...o, [c.tip]: (o[c.tip] || 0) + 1 }), {});
