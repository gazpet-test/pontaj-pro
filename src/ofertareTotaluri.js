import { normUm, aceeasiValoare, fmtExact } from './ofertareCantitatiInvalidare.js'
import { clasaUnitate } from './ofertareUnitati.js'

const total = c => /total/i.test(`${c.obiect || ''} ${c.denumire || ''} ${c.sursa || ''}`)
const perimetru = c => ['licitatie_id', 'obiect', 'categorie', 'tip_sursa', 'sursa'].map(k => normUm(c[k]))
export const TOTAL_NECOMPARABIL = 'Totalul declarat nu poate fi verificat din detaliile disponibile.'
export const TOTAL_DIFERIT = 'Totalul declarat diferă de suma detaliilor validate.'
export const textControlTotal = t => `${t.text} TOTAL #${t.id}: declarat ${t.declarat == null ? 'necunoscut' : fmtExact(t.declarat)} ${t.um || ''}; detalii validate ${t.suma_detalii == null ? 'necunoscute' : fmtExact(t.suma_detalii)} ${t.um || ''}.`

// Fără a deduce un perimetru din proză. Obiectul și sursa trebuie identificate explicit.
// Același contract în ofertare_totaluri_control; niciodată TOTAL + detalii.
export function controlTotaluri(randuri = [], baza = 'cantitate') {
  return randuri.filter(total).map(t => {
    const p = perimetru(t), u = clasaUnitate(t.um)
    const grup = randuri.filter(c => perimetru(c).every((v, i) => v === p[i]))
    const det = grup.filter(c => !total(c))
    const valoare = c => c[baza] == null || c[baza] === '' ? null : Number(c[baza])
    const comparabila = c => {
      const k = clasaUnitate(c.um)
      return k.tip === u.tip && (u.tip === 'lungime' || (u.tip === 'alta' && normUm(c.um) === normUm(t.um)))
    }
    const valida = c => c.status === 'validat' && valoare(c) != null && Number.isFinite(valoare(c))
    const comparabil = !!p[1] && !!p[3] && !!p[4] && grup.filter(total).length === 1 && det.length > 0 &&
      u.tip !== 'de_verificat' && valida(t) && det.every(c => valida(c) && comparabila(c))
    const validate = det.filter(c => valida(c) && comparabila(c))
    const suma = validate.length ? validate.reduce((s, c) => s + valoare(c) * (clasaUnitate(c.um).factor || 1), 0) : null
    const declarat = valoare(t) == null ? null : valoare(t) * (u.factor || 1)
    const stare = !comparabil ? 'necomparabil' : aceeasiValoare(declarat, suma) ? 'ok' : 'diferit'
    return { id: t.id, baza, obiect: t.obiect, sursa: t.sursa, declarat, suma_detalii: det.length ? suma : null,
      um: u.tip === 'lungime' ? 'm' : t.um, stare, text: stare === 'necomparabil' ? TOTAL_NECOMPARABIL : stare === 'diferit' ? TOTAL_DIFERIT : '' }
  })
}
