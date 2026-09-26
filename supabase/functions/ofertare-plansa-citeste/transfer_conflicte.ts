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
// ════════════════════════════════════════════════════════════════

export const VERSIUNE_INREGISTRARE = 1;
// versiunea semanticii conflictelor (NU COD_VERSIUNE al citirii: acela decide compatibilitatea zonelor citite)
export const COD_TRANSFER = '2026-09-26.t1';
export const MAX_CONFLICTE = 40;
export const MAX_ISTORIC = 10;

export type ConflictTransfer = {
  tip: string; text: string; dn?: number | null; material?: string | null; metri?: number | null; fara_cantitate?: boolean;
  actiune?: string; pozitie_id?: number | null; pozitii?: { id: unknown; denumire: unknown }[];
};

export const STARI_DESCHISE = ['conflicte', 'neefectuat'];
// deschis = are conflicte (sau transferul nu s-a făcut) și nu l-a confirmat explicit un om
export const deschis = (r: any): boolean => !!r && typeof r === 'object' && STARI_DESCHISE.includes(r.stare) && !r.confirmat_la;

// rezumatul unei înregistrări în istoric (fără conflictele ei, fără istoricul ei)
export const rezumat = (r: any) => ({
  id: r?.id ?? null, la: r?.la ?? null, stare: r?.stare ?? null, n: Number(r?.n) || 0,
  confirmat_de: r?.confirmat_de ?? null, confirmat_la: r?.confirmat_la ?? null, confirmare_nota: r?.confirmare_nota ?? null,
  ...(r?.inchis_prin ? { inchis_prin: r.inchis_prin } : {}),
});

// Înregistrarea nouă a unui transfer (sau a unui transfer amânat / căzut), peste cea precedentă `prev` (din documentul PROASPĂT —
// se reconstruiește la fiecare reîncercare CAS). `neefectuat` = transferul nu s-a făcut (amânat, eroare): stare deschisă.
export function inregistrareTransfer(prev: any, x: {
  conflicte: ConflictTransfer[]; neefectuat?: boolean; id: string; la: string; cod: string;
  rulare?: string | null; citire?: string | null; plansa?: string | null;
}) {
  const n = x.conflicte.length;
  const stare = x.neefectuat ? 'neefectuat' : n ? 'conflicte' : 'fara_conflicte';
  const areAnterior = !!prev && typeof prev === 'object' && !!prev.id;
  const { istoric: istPrev, anterior: _a, ...prevFara } = areAnterior ? prev : ({} as any);
  const istoric = [...(areAnterior ? [rezumat(prev)] : []), ...(Array.isArray(istPrev) ? istPrev : [])].slice(0, MAX_ISTORIC);
  return {
    v: VERSIUNE_INREGISTRARE, id: x.id, la: x.la, cod: x.cod, cod_transfer: COD_TRANSFER,
    rulare: x.rulare ?? null, citire: x.citire ?? null, plansa: x.plansa ?? null,
    stare, n, conflicte: x.conflicte.slice(0, MAX_CONFLICTE), ...(n > MAX_CONFLICTE ? { trunchiat: true } : {}),
    confirmat_de: null, confirmat_la: null, confirmare_nota: null,
    // o recitire fără conflicte închide conflictele deschise ale celei precedente — explicit, cu urma lor
    ...(stare === 'fara_conflicte' && areAnterior && deschis(prev) ? { inchis_prin: 'recitire_fara_conflicte', inchide: prev.id } : {}),
    // înregistrarea precedentă, întreagă (cu conflictele ei; fără propriul `anterior` — lanțul nu crește), + istoricul rezumat
    ...(areAnterior ? { anterior: prevFara } : {}),
    istoric,
  };
}
