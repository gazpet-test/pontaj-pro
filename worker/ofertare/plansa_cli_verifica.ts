// deno run -A worker/ofertare/plansa_cli_verifica.ts <dir_pachet>
// Reverificarea pe loturi (review Jakarinos P1 #5) IMEDIAT înaintea lansării CLI (run_pilot.sh … plansa_felii).
// Containerul CLI nu are BD și nici chei (by design), deci poarta nu poate rula în launcher.sh. Ea rulează aici, pe gazdă,
// în mediul administrativ al pregătirii (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPERATOR_DECLARAT), și scrie în pachet
// `verificare_lot.json` legat de pachet_id. Launcherul refuză pachetul (cod 2, înainte de orice apel CLI) dacă atestarea
// lipsește, e pentru alt pachet, nu e eligibilă sau e mai veche de VALABIL_MIN minute.
// Neeligibil / eroare de poartă / document schimbat → atestarea veche se șterge și ieșim cu cod nenul.
// Verificare administrativă (ca la pregătire/import), nu autentificare: atestarea nu e semnată.
import { documentEligibil, mesajLot, type Eligibilitate } from '../../supabase/functions/_shared/eligibilLot.ts'
import { citesteDoc, depsCliReale, verificaIdentitate, verificaManifest, verificaOwner, type DepsCli, type Manifest } from './plansa_cli_comun.ts'

export const FISIER_VERIFICARE = 'verificare_lot.json'
export const VALABIL_MIN = 15 // același prag în launcher.sh (fragmentul lot_neverificat)

// Fail-closed: documentEligibil întoarce eroare_poarta la orice cădere a RPC-ului.
export async function verificaLot(supa: any, docId: number): Promise<Eligibilitate> {
  const e = await documentEligibil(supa, docId)
  if (!e.eligibil) throw new Error(`${mesajLot(e.motiv)} (doc ${docId}, motiv ${e.motiv}); planșa nu se trimite la CLI`)
  return e
}

export type VerificareLot = { doc_id: number; licitatie_id: number; pachet_id: string; eligibil: true; motiv: string; verificat_la: string }

export async function verificaPachet(dir: string, d: DepsCli, acum = () => new Date()): Promise<VerificareLot> {
  const f = `${dir}/${FISIER_VERIFICARE}`
  // O atestare veche nu supraviețuiește unei reverificări (nici uneia eșuate).
  try { await Deno.remove(f) } catch (e) { if (!(e instanceof Deno.errors.NotFound)) throw e }
  await verificaOwner(d)
  const m: Manifest = JSON.parse(await Deno.readTextFile(`${dir}/manifest.json`))
  verificaManifest(m)
  verificaIdentitate(m, await citesteDoc(d.supa, m.doc_id)) // retăiat / alt fișier → pachet vechi, nu se citește
  const e = await verificaLot(d.supa, m.doc_id)
  const v: VerificareLot = { doc_id: m.doc_id, licitatie_id: m.licitatie_id, pachet_id: m.pachet_id, eligibil: true,
    motiv: e.motiv, verificat_la: acum().toISOString() }
  await Deno.writeTextFile(f, JSON.stringify(v) + '\n')
  return v
}

if (import.meta.main) {
  try {
    if (Deno.args.length !== 1) throw new Error('Folosire: plansa_cli_verifica.ts <dir_pachet>')
    const v = await verificaPachet(Deno.args[0], depsCliReale())
    console.log(`Eligibil pe loturi: doc ${v.doc_id} (${v.motiv}), pachet ${v.pachet_id.slice(0, 12)}; valabil ${VALABIL_MIN} min pentru run_pilot.sh`)
  } catch (e) { console.error((e as Error).message); Deno.exit(1) }
}
