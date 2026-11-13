// Protocolul MOTORULUI UNIC (r4, PR #1086): o sesiune = o speță = un proces Node (motor_cli.mjs), pornit de motor.py.
// Câte un obiect JSON pe linie, UTF-8. Cererea: {v, id, op, ...câmpurile operației}; răspunsul: {v, id, ok: true, rez} sau
// {v, id, ok: false, eroare: '<cod>'}. Câmpurile se validează EXACT (fără câmpuri în plus, tipuri, mărimi); orice abatere = eroare
// cu cod, fără text din speță sau din dicționar. Starea (dicționarul, etichetele, ce s-a învățat, tabelul de demascare) trăiește
// DOAR în obiectul sesiunii, de la „init” până la „gata” — nimic nu se împarte între două spețe (fiecare are procesul ei).
// Toate regulile stau în src/intrebariMascare.js; aici doar se cheamă.
import { Mascare, Dictionar, aplicaRegulaB, cereCitat } from '../../src/intrebariMascare.js'

export const PROTOCOL = 1
export const MAX_TEXT = 2000000          // caractere pe un text (speța, un extras, răspunsul modelului: cu mult sub)
export const MAX_SURSE = 60
const MOTIVE_DEMASCARE = new Set(['eticheta_neemisa', 'eticheta_din_model', 'eticheta_rupta'])
export { MOTIVE_DEMASCARE }

const eText = x => typeof x === 'string' && x.length <= MAX_TEXT
const eSursa = s => s && typeof s === 'object' && !Array.isArray(s)
  && Object.keys(s).sort().join('|') === 'extras|id|inceput_sigur|sfarsit_sigur|titlu'
  && typeof s.id === 'string' && /^[CW][0-9]{1,2}$/.test(s.id) && eText(s.titlu) && eText(s.extras)
  && typeof s.inceput_sigur === 'boolean' && typeof s.sfarsit_sigur === 'boolean'
const TIPURI = {
  text: eText,
  bool: x => typeof x === 'boolean',
  texte: x => Array.isArray(x) && x.length <= 10 && x.every(y => y === null || eText(y)),
  surse: x => Array.isArray(x) && x.length <= MAX_SURSE && x.every(eSursa),
  obiect: x => !!x && typeof x === 'object' && !Array.isArray(x),
}
// operația → câmpurile ei (exact) și tipurile
export const OPERATII = {
  init: { dictionar: 'obiect' },
  invata: { texte: 'texte' },
  mascheaza: { text: 'text', protejeaza: 'bool' },
  demascheaza_sigur: { text: 'text' },
  emise_in: { text: 'text' },
  contoare: {},
  regula_b: { text: 'text', surse: 'surse' },
  cere_citat: { text: 'text', surse: 'surse' },
  gata: {},
}

export function creeazaSesiune() { return { mascare: null, ultimId: 0, gata: false } }

const eroare = (id, cod) => ({ v: PROTOCOL, id, ok: false, eroare: cod })

/** Răspunsul la o cerere deja parsată (niciodată nu aruncă). */
export function trateaza(sesiune, c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return eroare(null, 'schema')
  const id = Number.isSafeInteger(c.id) ? c.id : null
  if (c.v !== PROTOCOL) return eroare(id, 'protocol')
  if (id === null || id <= sesiune.ultimId) return eroare(id, 'id')
  const campuri = OPERATII[c.op]
  if (!campuri || !Object.hasOwn(OPERATII, c.op)) return eroare(id, 'operatie')
  const asteptate = ['id', 'op', 'v', ...Object.keys(campuri)].sort().join('|')
  if (Object.keys(c).sort().join('|') !== asteptate) return eroare(id, 'schema')
  for (const [k, tip] of Object.entries(campuri)) if (!TIPURI[tip](c[k])) return eroare(id, 'schema')
  if (sesiune.gata) return eroare(id, 'sesiune_inchisa')
  sesiune.ultimId = id
  if (c.op === 'init' && sesiune.mascare) return eroare(id, 'init_repetat')
  if (c.op !== 'init' && c.op !== 'gata' && !sesiune.mascare) return eroare(id, 'neinitializat')
  try {
    return { v: PROTOCOL, id, ok: true, rez: executa(sesiune, c) }
  } catch {
    return eroare(id, 'motor')      // fără mesajul excepției: poate conține date
  }
}

function executa(sesiune, c) {
  const m = sesiune.mascare
  switch (c.op) {
    case 'init': {
      let d
      try { d = Dictionar.dinRaspuns(c.dictionar) } catch { throw new Error('dictionar') }
      sesiune.mascare = new Mascare(d)
      return { statistici: d.statistici() }
    }
    case 'invata': m.invata(...c.texte); return {}
    case 'mascheaza': return { text: m.mascheaza(c.text, c.protejeaza) }
    case 'demascheaza_sigur': return m.demascheazaSigur(c.text)
    case 'emise_in': return { n: m.emiseIn(c.text) }
    case 'contoare': return { contoare: m.contoare(), inlocuiri: m.inlocuiri, total: m.total() }
    case 'regula_b': return aplicaRegulaB(c.text, c.surse)
    case 'cere_citat': return { cere_citat: cereCitat(c.text, c.surse) }
    case 'gata': sesiune.gata = true; return {}
    default: throw new Error('operatie')
  }
}
