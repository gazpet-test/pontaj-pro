// Diametrele nominale: lista standard + Dn-urile numite într-un text (TKT-0329 B, PR3 — mutat din ofertare-plansa-citeste/handler.ts,
// comportament neschimbat pentru planșe; extragerea structurată folosește în plus dnDinText).
const faraDiacritice = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
// Diametre nominale reale (PE SR EN 1555 + OL DN). Orice altceva = citire greșită probabilă (debit, Di, viteză) => NU intră în
// cantități, se raportează „de verificat". Runda 8: la nivel de modul (și rândul TOTAL se recunoaște după lipsa unui Dn standard).
export const DN_STANDARD = new Set([16,20,25,32,40,50,63,65,75,80,90,100,110,125,140,150,160,180,200,225,250,280,300,315,350,355,400,450,500,560,600,630,700,800]);
// runda 9: Dn-urile standard numite într-o denumire de poziție + dacă denumirea are un INTERVAL de Dn („De 63–110”, „Dn 32-110”,
// „Dn 32…110”). Folosit la alegerea rândului TOTAL: „total” cu un singur Dn = subtotal pe Dn (candidat), cu interval / ≥ 2 Dn = total global.
// runda 10 (verificatorul rundei 9, MAJOR TOTAL-b): și notația românească uzuală a intervalului — „Dn 63÷110”, „De 63 ÷ 110”,
// „De 63/110”, „Dn 63 la 110”, „De 63 până la De 110” — și LISTELE de Dn după un prefix („Dn 63, 90 și 110”, „De 63; 90”, „Dn63 + 110”):
// fiecare număr standard din listă e un Dn (≥ 2 Dn => total global). Al doilea capăt / elementul din listă NU e un Dn când e urmat de o
// unitate sau de zecimale („Dn 63 - 200 m”, „De 110, 12,5 m”, „+ 20%”). „De 110/10” (grosimea peretelui): capătul al doilea mai mic și
// nestandard => nu e interval (un interval urcă: „De 60–110”; descrescător doar cu ambele capete standard).
// runda 11 (verificatorul rundei 10, MAJOR — regresie TOTAL-b): numărul FĂRĂ prefix Dn (al doilea capăt / element de listă) e un Dn
// doar dacă după el vine sfârșitul, o punctuație / un separator, „mm”, alt separator de listă / interval sau un material / SDR
// („pe”, „ol”, „sdr”). Orice alt cuvânt („, 20 tronsoane”, „și 32 branșamente”, „la 32 case”, „/ 16 bar”, „- 200 metri”, „90 mp”) îl
// anulează: altfel un SUBTOTAL cu un singur Dn devenea TOTAL global (lua totalul, iar TOTAL-ul real rămânea tăcut pe cifra veche).
// Pe „/” (grosimea peretelui: „De 225/20”, „De 180/16”) nu se aplică regula „descrescător cu ambele capete standard”: intervalul cu
// „/” doar crescător („De 63/110”) sau cu prefix pe al doilea capăt („Dn110/Dn63”). Fără prefix, al doilea capăt al intervalului
// trebuie să fie și el un Dn standard („De 110 - 120” = subtotal Dn110, nu interval).
// runda 12 (verificatorul rundei 11, MAJOR — regresie TOTAL-b, fals-negativ): lista albă de mai sus respingea al doilea capăt al unui
// interval CRESCĂTOR standard urmat de orice alt cuvânt („De 63 - 110 PEHD”, „De 63-110 (PE)”, „De 63 ÷ 110 pozate subteran”,
// „De 63 - 110 conducte PE”) => subtotal Dn63: TOTAL-ul primea 200 m (sau rămânea pe cifra veche) și poziția Dn63 nu se insera.
// Acum, pentru capătul FĂRĂ prefix al unui interval CRESCĂTOR cu ambele capete standard (a < b), se folosește o listă NEAGRĂ:
// capătul e Dn, cu excepția zecimalelor și a unei unități / unui numărător după el (m, ml, metri, km, mp, %, buc, tronsoane,
// branșamente, case, bar, kg, ore …). Lista albă strictă rămâne pentru capătul DESCRESCĂTOR și pentru elementele de listă
// (fals-pozitivele rundei 10: „, 20 tronsoane”, „la 32 case”, „/ 16 bar”, „- 50 branșamente”, „De 225/20”).
// Și (minor): descrescătorul fără prefix urmat de „mm” e grosimea peretelui („De 180 - 16 mm”, „De 225 - 20 mm”), nu interval.
const PREF_DN = '(?:\\bdn|\\bde|ø|Ø|φ)';
// cu prefix Dn, numărul E un Dn și când e urmat de o unitate („De 63 și De 110 m”: m e lungimea totalului); nu doar cu zecimale
const NU_ZECIMALE = '(?![.,]\\d)';
const URMARE_FARA_PREFIX = `${NU_ZECIMALE}(?=\\s*(?:$|[),;.:/÷–—+&…-]|mm\\b|(?:si|sau|la|pana|ol)\\b|pe(?:\\d|\\b)|sdr))`;
// lista neagră (doar pentru capătul crescător fără prefix): zecimale sau o unitate / un numărător după număr
const NU_UNITATE = `${NU_ZECIMALE}(?!\\s*(?:%|(?:m|ml|mc|mp|metri|metru|km|cm|buc|bucati|tronsoane|tronson|bransamente|bransament|case|bar|atm|kg|ore|zile|luni|ani)\\b))`;
const SEP_INTERVAL = '\\s*(?:[-–—÷/]|\\.{2,3}|…|\\b(?:pana\\s+)?la\\b)\\s*';
const SEP_LISTA = '\\s*(?:[,;+&]|\\bsi\\b|\\bsau\\b)\\s*';
// grupuri: 3 prefixul capătului 2, 4 capătul cu prefix, 5 fără prefix urmat de „mm”, 6 fără prefix pe lista albă, 7 fără prefix pe
// lista neagră (acceptat doar crescător, cu ambele capete standard)
const CAPAT_2 = `(?:(${PREF_DN})\\s*(\\d{2,3})\\b${NU_ZECIMALE}|(\\d{2,3})\\b(?=\\s*mm\\b)|(\\d{2,3})\\b${URMARE_FARA_PREFIX}|(\\d{2,3})\\b${NU_UNITATE})`;
const ELEM_LISTA = `(?:${PREF_DN}\\s*\\d{2,3}\\b${NU_ZECIMALE}|\\d{2,3}\\b${URMARE_FARA_PREFIX})`;
const RE_DN_DENUMIRE = new RegExp(`${PREF_DN}\\s*(\\d{2,3})\\b(?:(${SEP_INTERVAL})${CAPAT_2})?((?:${SEP_LISTA}${ELEM_LISTA})*)`, 'gi');
export function dnuriDenumire(s: unknown): { dn: number[]; interval: boolean } {
  const dn = new Set<number>(); let interval = false;
  const std = (x: number) => DN_STANDARD.has(x);
  for (const m of faraDiacritice(String(s || '')).matchAll(RE_DN_DENUMIRE)) {
    const a = Number(m[1]);
    if (std(a)) dn.add(a);
    if (m[2]) {
      const cuPrefix = !!m[3], urmMm = !!m[5], slab = !!m[7], b = Number(m[4] || m[5] || m[6] || m[7]);
      // fără prefix, al doilea capăt trebuie să fie un Dn standard („De 110 - 120” nu e interval; „De 60–110” da); pe lista neagră
      // (capăt urmat de un cuvânt oarecare) și primul capăt trebuie să fie standard
      const urca = b > a && (cuPrefix || (std(b) && (!slab || std(a))));
      const coboara = !slab && std(a) && std(b) && b !== a && (cuPrefix || (!m[2].includes('/') && !urmMm));
      if (urca || coboara) { interval = true; if (std(b)) dn.add(b); }
    }
    for (const x of (m[8] || '').matchAll(/(\d{2,3})\b/g)) if (std(Number(x[1]))) dn.add(Number(x[1]));
  }
  return { dn: [...dn].sort((a, b) => a - b), interval };
}

// TKT-0329 B (PR3): Dn-urile dintr-un text de poziție, pentru extragerea structurată (spec §5.1). Peste dnuriDenumire:
// - prefixul „D=” („D= 90 MM”, „D=90mm”) e un Dn;
// - „90X8.2” / „90x8,2” (diametru × grosimea peretelui) = Dn 90; „90X32” (reducție, al doilea capăt Dn standard > 30) = 90 și 32.
// Planșele NU folosesc această funcție (comportamentul lor rămâne cel testat în ofertare-plansa-citeste).
export function dnDinText(s: unknown): { dn: number[]; interval: boolean } {
  let t = faraDiacritice(String(s ?? ''))
  t = t.replace(/\bd\s*=\s*(\d{2,3})(?!\d)/gi, 'Dn $1 ')
  t = t.replace(/\b(\d{2,3})\s*[x×]\s*(\d{1,3}(?:[.,]\d+)?)/gi, (_m, a: string, b: string) => {
    const bn = Number(b.replace(',', '.'))
    return Number.isInteger(bn) && bn > 30 && DN_STANDARD.has(bn) ? `${a} si Dn ${b}` : `${a} `
  })
  return dnuriDenumire(t)
}
