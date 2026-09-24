// Teste locale pentru worker/ofertare/seap.ts (fără rețea, fără Supabase): p7s, volume RAR, verificarea arhivelor.
// Rulare: bash test-fixtures/seap_terra/run.sh (are nevoie de openssl + 7z + rar opțional)
import { continutP7s, volumRar, numeVolum, verificaListare, cheieNume, esteArhiva } from '../../worker/ofertare/seap.ts'
const dir = Deno.args[0]
let ok = 0, fail = 0
const t = (nume: string, cond: boolean, info = '') => { if (cond) { ok++; console.log('PASS', nume) } else { fail++; console.log('FAIL', nume, info) } }
const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i])
const run = async (cmd: string, args: string[]) => { const p = await new Deno.Command(cmd, { args, stdout: 'piped', stderr: 'piped' }).output(); return new TextDecoder().decode(p.stdout) + new TextDecoder().decode(p.stderr) }

// 1-3. p7s atașat: mic (OCTET STRING primitiv), mare (constructed, bucăți), fără conținut (detașat)
const mic = await Deno.readFile(`${dir}/mic.bin`), mare = await Deno.readFile(`${dir}/mare.bin`)
t('01 p7s mic → conținut identic', eq(continutP7s(await Deno.readFile(`${dir}/mic.p7s`)), mic))
t('02 p7s mare (streaming, bucăți) → conținut identic', eq(continutP7s(await Deno.readFile(`${dir}/mare.p7s`)), mare))
t('03 p7s BER (lungimi nedefinite) → conținut identic', eq(continutP7s(await Deno.readFile(`${dir}/mare_ber.p7s`)), mare))
let arunca = false; try { continutP7s(await Deno.readFile(`${dir}/detasat.p7s`)) } catch { arunca = true }
t('04 p7s detașat → eroare explicită, nu gunoi', arunca)
arunca = false; try { continutP7s(mic) } catch { arunca = true }
t('05 fișier care nu e p7s → eroare', arunca)

// 6-8. nume
t('06 volum RAR recunoscut', JSON.stringify(volumRar('PT Dezvoltare SNT Botosani.part03.rar')) === JSON.stringify({ baza: 'PT Dezvoltare SNT Botosani', nr: 3 }))
const vs = volumRar('Documentatie tehnica HUEDIN Lot 1.part02-semnat.rar')
t('06b volum cu sufix „-semnat" (Huedin) → aceeași bază, nume canonic pentru 7z', vs?.nr === 2 && numeVolum(vs!, 2) === 'Documentatie tehnica HUEDIN Lot 1.part02.rar', JSON.stringify(vs))
t('07 RAR simplu nu e volum', volumRar('PT.rar') === null && esteArhiva('PT.rar') && esteArhiva('x.ZIP') && !esteArhiva('Formular.docx'))
t('08 cheieNume ca în import (fără .p7s, spații, virgule)', cheieNume('PT Dezvoltare, SNT (1).zip.p7s') === 'ptdezvoltaresnt1.zip')

// 9-11. verificarea arhivei ÎNAINTE de extragere (7z l -slt -ba)
const bun = verificaListare(await run('7z', ['l', '-slt', '-ba', `${dir}/bun.zip`]))
t('09 arhivă normală trece, numără intrările', bun.ok && (bun as any).intrari >= 2, JSON.stringify(bun))
const trav = verificaListare(await run('7z', ['l', '-slt', '-ba', `${dir}/traversal.zip`]))
t('10 cale cu ../ → refuzată', !trav.ok && /nesigur/.test((trav as any).motiv), JSON.stringify(trav))
const bomba = verificaListare('Path = a.bin\nSize = 7000000000\n\nPath = b.bin\nSize = 10\n')
t('11 peste 6 GB despachetat → refuzată (zip-bomb)', !bomba.ok && /GB/.test((bomba as any).motiv))
const multe = verificaListare(Array.from({ length: 5001 }, (_, i) => `Path = f${i}.txt\nSize = 1`).join('\n\n'))
t('12 peste 5000 de intrări → refuzată', !multe.ok)
const abs = verificaListare('Path = /etc/passwd\nSize = 10\n')
t('13 cale absolută → refuzată', !abs.ok)

// 14. RAR multi-volum: 7z listează și extrage din primul volum (dacă există generator rar local)
const goala = verificaListare('')
t('14 listare goală → refuzată (nu „ok" cu 0 fișiere)', !goala.ok)
try {
  await Deno.stat(`${dir}/multi.part1.rar`)
  const l = verificaListare(await run('7z', ['l', '-slt', '-ba', `${dir}/multi.part1.rar`]))
  t('15 RAR multi-volum listat din primul volum', l.ok && (l as any).total > 0, JSON.stringify(l))
} catch { console.log('SKIP 15 (fără rar local)') }
console.log(`TOTAL ${ok}/${ok + fail}`)
if (fail) Deno.exit(1)
