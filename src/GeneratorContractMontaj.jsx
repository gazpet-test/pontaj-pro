// ════════════════════════════════════════════════════════════════
// GeneratorContractMontaj.jsx — Generator contract prestări servicii
// MONTAJ CONDUCTE (model „GAZPET–PETROCONST rev.01GI", 152 Lot 2 Jupa)
// Decizie 01.09.2026: se folosește DOAR pentru Transgaz / Romgaz / Conpet.
// Flux: formular → HTML offscreen 794px → html2canvas → jsPDF multipagină
//       → upload bucket contracte-terti + INSERT contracte_terti (draft).
// ════════════════════════════════════════════════════════════════
import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase.js'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'

const G = {
  bg:'#0D1117', surface:'#161B22', border:'#21262D', border2:'#30363D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  blue:'#58A6FF', green:'#3FB950', red:'#F85149', yellow:'#D29922', orange:'#F0883E',
}
const S = {
  input: { width:'100%', padding:'8px 12px', background:G.bg, border:`1px solid ${G.border2}`, borderRadius:6, color:G.text, fontSize:13, outline:'none', boxSizing:'border-box' },
  btnP:  { padding:'9px 16px', background:G.green, color:'#fff', border:'none', borderRadius:7, cursor:'pointer', fontSize:13, fontWeight:700 },
  btnS:  { padding:'9px 16px', background:G.surface, color:G.text, border:`1px solid ${G.border2}`, borderRadius:7, cursor:'pointer', fontSize:13, fontWeight:600 },
  lbl:   { display:'block', fontSize:11, color:G.muted, marginBottom:4, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.3px' },
}

const BENEFICIARI_FINALI = {
  transgaz: 'SNTGN Transgaz S.A.',
  romgaz:   'SNGN Romgaz S.A.',
  conpet:   'Conpet S.A.',
}

const GAZPET_ANTET = `GAZPET INSTAL SRL cu sediul social in Ploiesti, str. Fluturilor, nr. 34, judetul Prahova, tel/fax 0244435005, e-mail: office@gazpet.ro, inmatriculata sub nr. J29/1650/2007, cod fiscal RO 22029920, reprezentata prin Administrator Trusu Razvan, avand contul nr. RO04 BRDE 300S V361 0123 3000 deschis la BRD Ploiesti, in calitate de Beneficiar`

const fmtLei = v => Number(v || 0).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')

// HTML-ul integral al contractului (model Petroconst rev.01GI, câmpuri interpolate)
function contractHtml(f) {
  const bf = BENEFICIARI_FINALI[f.beneficiar_final] || f.beneficiar_final
  const dataRo = f.data_contract ? new Date(f.data_contract).toLocaleDateString('ro-RO') : '..........'
  const p = (t) => `<p style="margin:5px 0;">${t}</p>`
  const h = (t) => `<p style="margin:12px 0 5px;font-weight:bold;">${t}</p>`
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;color:#111;padding:34px 40px;width:794px;box-sizing:border-box;background:#fff;font-size:11.5px;line-height:1.45;text-align:justify;">
    <div style="text-align:center;font-size:15px;font-weight:bold;margin-bottom:4px;">CONTRACT DE PRESTARI SERVICII</div>
    <div style="text-align:center;font-size:12px;margin-bottom:14px;">Nr. ${esc(f.numar)} din ${dataRo}</div>

    ${h('1. PARTILE CONTRACTANTE')}
    ${p(`1.1. ${esc(GAZPET_ANTET)}, pe de o parte, si`)}
    ${p(`1.2. <b>${esc(f.prestator_nume)}</b>, cu sediul in ${esc(f.prestator_sediu)}, telefon ${esc(f.prestator_telefon)}, e-mail ${esc(f.prestator_email)}, inregistrata la Registrul Comertului sub nr. ${esc(f.prestator_reg_com)}, C.U.I. ${esc(f.prestator_cui)} si cod IBAN ${esc(f.prestator_iban)}, deschis la ${esc(f.prestator_banca)}, reprezentata legal prin ${esc(f.prestator_reprezentant)}, in calitate de <b>Prestator</b>, pe de alta parte,`)}
    ${p('am convenit sa incheiem prezentul contract de prestari servicii cu respectarea urmatoarelor clauze:')}

    ${h('2. OBIECTUL CONTRACTULUI')}
    ${p(`2.1. Prestatorul se obliga sa presteze in folosul beneficiarului ${esc(f.obiect)} la obiectivul &laquo; ${esc(f.obiectiv)} &raquo;.`)}
    ${p('2.2. Serviciile ce se vor presta sunt descrise in anexa la prezentul, urmand a fi executate conform documentatiei tehnice pe care prestatorul atesta prin semnarea prezentului contract ca a primit-o. Anexa contine si materialele puse la dispozitie de catre prestator.')}

    ${h('3. PRETUL SI MODALITATILE DE PLATA')}
    ${p('3.1. Beneficiarul se obliga sa plateasca prestatorului contravaloarea lucrarilor executate in baza situatiilor de plata confirmate de beneficiar.')}
    ${p(`3.2. Pentru lucrarile executate prestatorul va emite facturi in concordanta cu situatiile de lucrari confirmate de beneficiar, plata facandu-se cu ordin de plata in termen de ${esc(f.termen_plata_zile)} zile lucratoare de la data incasarii contravalorii acestora de catre beneficiar de la beneficiarul sau final.`)}
    ${p(`3.3. Pretul lucrarilor este de <b>${fmtLei(f.valoare_lei)} lei, fara TVA</b> si se afla mentionat in anexa la prezentul.`)}
    ${p(`3.4. In ultima zi lucratoare a fiecarei luni prestatorul va inainta prin email catre reprezentantii beneficiarului ${esc(f.reprezentanti)} situatia de lucrari aferenta lunii ce se incheie. De asemenea, alaturi de situatia de lucrari (corelata cu jurnalul de santier care va fi inaintat zilnic catre beneficiar) prestatorul va inainta si situatia stadiului fizic confirmata de catre dirigintele de santier, certificatele de calitate si conformitate aferente materialelor puse in opera. Executantul va anexa situatiilor de lucrari documentele de calitate si conformitate impreuna cu procesele verbale ce atesta executia lucrarilor (documente necesare cartii constructiei).`)}
    ${p('3.5. Doar situatia de lucrari insotita de toate documentele mai sus mentionate si inaintata tuturor reprezentantilor mentionati mai sus va face obiectul verificarii si confirmarii de catre beneficiar.')}
    ${p('3.6. Beneficiarul va verifica situatia de lucrari in termen de 5 zile lucratoare de la data primirii de catre reprezentantii beneficiarului, descrisi mai sus, a intregii documentatii specificate anterior.')}
    ${p('3.7. Doar situatia de lucrari aprobata de catre reprezentantii beneficiarului da dreptul prestatorului sa emita factura pentru serviciile prestate in luna de referinta.')}

    ${h('4. DURATA CONTRACTULUI')}
    ${p(`4.1. Prezentul contract se incheie pe o durata de ${esc(f.durata_luni)} luni calendaristice, calculate cu incepere de la data predarii frontului de lucru, in conformitate cu graficul anexat (intocmit de prestator si aprobat de beneficiar), parte integranta din prezentul contract. La data finalizarii lucrarilor se vor intocmi procese-verbale de receptie la terminarea lucrarilor si de predare-primire intre parti.`)}
    ${p(`4.2. Prestatorul va putea incepe executarea lucrarilor exclusiv dupa predarea frontului de lucru de catre beneficiar. Reprezentantul beneficiarului pentru predarea frontului de lucru este managerul de proiect ${esc(f.manager_proiect)}.`)}
    ${p('4.3. Prestatorul va inainta beneficiarului spre aprobare graficul de executie a lucrarilor, in termen de 10 zile de la data semnarii prezentului contract, sub sanctiunea platii unor penalitati de 1000 euro / zi de intarziere (pentru nepredarea in termen a graficului initial).')}

    ${h('5. GARANTIA LUCRARILOR')}
    ${p(`5.1. Garantia contractuala acordata lucrarilor executate in temeiul prezentului contract este de ${esc(f.garantie_ani)} ani de la semnarea procesului verbal de receptie la terminarea lucrarilor dintre beneficiar si beneficiarul sau final, si inceteaza la data semnarii procesului verbal final la terminarea lucrarilor, la expirarea perioadei de garantie de ${esc(f.garantie_ani)} ani, dar nu mai tarziu de 30 de zile de la data implinirii termenului de ${esc(f.garantie_ani)} ani. In situatia in care nu se semneaza procesul verbal final la terminarea lucrarilor in termen de 30 de zile de la implinirea termenului, toate obligatiile prestatorului se considera indeplinite si finalizate in a 31-a zi de la expirarea perioadei de garantie incheiate de catre beneficiar cu beneficiarul sau final.`)}
    ${p('5.2. Garantia contractuala nu exclude raspunderea prestatorului in raport de normele legale privind calitatea in constructii. Prestatorului ii incumba si obligatia legala prevazuta de art. 30 din Legea nr. 10/1995.')}
    ${p(`5.3. Beneficiarul va retine din contravaloarea fara TVA a fiecarei situatii de lucrari aprobate un procent de ${esc(f.retentie_pct)} % cu titlu de garantie de buna executie. Garantia de buna executie va fi evidentiata in mod distinct pe fiecare factura in parte.`)}
    ${p('5.4. In absenta oricaror revendicari pe perioada de garantie, beneficiarul va restitui garantia de buna executie, dupa cum urmeaza:')}
    ${p('a. un procent de 70% din garantia constituita, in termen de 5 zile lucratoare de la data semnarii fara obiectiuni a procesului verbal de receptie la terminarea lucrarilor dintre beneficiar si prestator. In situatia in care sunt obiectiuni, la finalizarea lucrarilor de remediere pentru rezolvarea obiectiunilor, in termen de 5 zile lucratoare se va restitui procentul de 70% din garantie;')}
    ${p('b. un procent de 30% din garantia constituita, in termen de 5 zile lucratoare de la data semnarii, fara obiectiuni, a procesului verbal de receptie la expirarea perioadei de garantie incheiat de catre beneficiar cu beneficiarul sau final.')}

    ${h('6. OBLIGATIILE PARTILOR')}
    ${p('6.1. Beneficiarul se obliga:')}
    ${p('a. Sa predea frontul de lucru in vederea executarii lucrarilor.')}
    ${p('b. Sa achite prestatorului lucrarile executate in conditiile art. 3 de mai sus.')}
    ${p('c. Sa receptioneze lucrarile executate, daca acestea indeplinesc integral cerintele tehnico-calitative si daca prestatorul a predat beneficiarului intreaga documentatie la care s-a obligat prin prezentul contract.')}
    ${p('6.2. Prestatorul se obliga:')}
    ${p('a. Sa asigure confidentialitatea datelor si lucrarilor ce privesc activitatea GAZPET INSTAL SRL.')}
    ${p('b. Sa respecte instructiunile si dispozitiile date de beneficiar in ceea ce priveste realizarea lucrarilor.')}
    ${p(`c. Sa nu se angajeze sau sa negocieze in scopul de a se angaja intr-o activitate in conflict cu interesele beneficiarului sau ale beneficiarului sau final ${esc(bf)}.`)}
    ${p('d. Sa predea lucrarea convenita la timp, executata in bune conditii, potrivit prescriptiilor / normativelor tehnice in vigoare.')}
    ${p(`e. In cazul in care, din vina sa exclusiva, prestatorul nu reuseste sa-si indeplineasca obligatiile asumate prin contract, beneficiarul are dreptul de a deduce din pretul contractului, cu titlu de penalitati, un cuantum de ${esc(f.penalitate_pct)} % pe zi de intarziere din valoarea fara TVA a contractului, pana la data indeplinirii integrale a obligatiilor asumate de catre prestator. La cuantumul penalitatilor calculate potrivit prevederilor anterioare se adauga si obligarea prestatorului de a achita beneficiarului orice eventuale sume retinute acestuia cu orice titlu de catre beneficiarul final pentru intarzierea in executarea lucrarilor ce fac obiectul contractului dintre acestia. Penalitatile si daunele mentionate anterior pot fi retinute de catre beneficiar din orice sume datorate, cu orice titlu, prestatorului.`)}
    ${p(`f. In cazul in care beneficiarul nu onoreaza facturile in termen de 5 zile de la expirarea perioadei descrise la punctul 3.2., atunci acesta are obligatia de a plati, cu titlu de penalitati, procentul de ${esc(f.penalitate_pct)} % din valoarea neachitata, pentru fiecare zi de intarziere.`)}
    ${p('g. Nerespectarea obligatiilor asumate prin prezentul contract de catre una din parti da dreptul partii lezate de a considera contractul de lucrari reziliat si de a pretinde plata de daune-interese.')}
    ${p('h. Prestatorul are obligatia de a respecta si insusi intocmai cerintele HSEQ ale beneficiarului final.')}
    ${p('i. Prestatorul are obligatia de a utiliza doar utilaje / echipamente ce indeplinesc conditiile legale de utilizare (in special normele ISCIR, fara a se limita la acestea).')}
    ${p('j. Prestatorul are obligatia remedierii pe perioada de garantie a tuturor defectelor aparute si datorate culpei sale. Remedierile se vor opera in termenele stipulate de catre beneficiar in fiecare sesizare de remediere. In situatia nerespectarii acestei clauze, beneficiarul, ca urmare a neindeplinirii obligatiilor la termenele mentionate in notificarile scrise ale beneficiarului, este indreptatit sa efectueze lucrarile de remediere pe costul sau, in regim propriu sau prin contractarea unor terti, costurile lucrarilor de remediere urmand a fi imputate prestatorului, prin retinerea contravalorii lor din garantia de buna executie constituita, ori prin solicitare / facturare separata, la libera alegere a beneficiarului. In situatia in care contravaloarea lucrarilor de remediere si/sau a daunelor provocate beneficiarului final este in cuantum mai mare decat garantia de buna executie retinuta, prestatorul se obliga sa intregeasca cuantumul garantiei de buna executie, in termen de 5 zile de la notificarea in acest sens a beneficiarului, sub sanctiunea platii unor penalitati de intarziere de 1000 euro / zi, pana la data intregirii totale a garantiei, indiferent de cuantumul sumei necesar a fi acoperite.')}
    ${p('k. Prestatorul se obliga sa intocmeasca si sa comunice beneficiarului, in termen de 5 zile de la semnarea prezentului contract, planul propriu SSM, sub sanctiunea platii unor penalitati de intarziere in cuantum de 100 euro / zi de intarziere.')}
    ${p('l. Prestatorul se obliga sa desemneze in scris, si sa comunice beneficiarului, in termen de 5 zile de la data semnarii prezentului contract, reprezentantii sai in domeniul SSM, situatii de urgenta, precum si managerul de proiect insarcinat cu supravegherea si coordonarea lucrarilor, sub sanctiunea platii unor penalitati de intarziere in cuantum de 100 euro / zi de intarziere.')}
    ${p('m. Prestatorul se obliga sa respecte normele SSM si de prevenire a incidentelor de natura situatiilor de urgenta si de mediu, raspunderea pentru orice astfel de incidente revenindu-i integral; conventia SSM, anexa a prezentului contract, nu limiteaza sub nicio forma raspunderea prestatorului.')}
    ${p('n. Prestatorul se obliga sa despagubeasca beneficiarul cu contravaloarea oricaror daune si/sau pretentii ale beneficiarului final formulate de catre acesta fata de beneficiar, urmare a actiunilor / inactiunilor prestatorului.')}
    ${p('o. Prestatorul va preda beneficiarului spre analiza graficul de executie care, dupa aprobare, va face parte integranta din prezentul contract. Lunar, pana pe data de 5 a fiecarei luni, prestatorul va actualiza si transmite beneficiarului spre verificare si aprobare graficul de executie actualizat, sub sanctiunea platii unor penalitati de intarziere in cuantum de 100 euro / zi de intarziere, pentru nepredarea graficului de executie actualizat.')}
    ${p('p. Prestatorul va transmite la sfarsitul fiecarei zile, catre beneficiar, jurnalul de santier aferent zilei de lucru incheiate, sub sanctiunea platii unor penalitati in cuantum de 100 euro / zi de intarziere / eveniment.')}
    ${p('r. Prestatorul va transmite beneficiarului, in fiecare zi lucratoare, pana la ora 8.00 a.m., programul activitatilor propuse a se realiza, sub sanctiunea platii unor penalitati in cuantum de 100 euro / zi de intarziere / eveniment.')}
    ${p('s. Prestatorul va transmite beneficiarului, in fiecare zi lucratoare, pana la ora 8.00 a.m., dovada instruirii zilnice a personalului lucrator, sub sanctiunea platii unor penalitati in cuantum de 100 euro / zi de intarziere / eveniment.')}
    ${p('t. Prestatorul are obligatia predarii catre beneficiar a intregii documentatii aferente cartii tehnice a constructiei, pentru lucrarile executate in temeiul prezentului contract.')}

    ${h('7. CODUL CIVIL - RAPORT JURIDIC')}
    ${p('7.1. Singurul raport juridic existent intre partile contractante este cel stabilit prin prezentul contract, ce este guvernat de legea romana.')}

    ${h('8. FORTA MAJORA')}
    ${p('8.1. Niciuna din partile contractante nu raspunde de neexecutarea la termen si/sau de executarea in mod necorespunzator, total sau partial, a oricarei obligatii care ii revine in baza prezentului contract, daca neexecutarea sau executarea necorespunzatoare a obligatiei respective a fost cauzata de forta majora, asa cum este definita de lege, respectiv art. 1351 Cod Civil.')}
    ${p('8.2. Partea care invoca forta majora este obligata sa notifice celeilalte parti, in termen de 15 zile, producerea evenimentului si sa ia toate masurile in vederea limitarii consecintelor lui.')}
    ${p('8.3. Daca in termen de 15 zile de la producere evenimentul respectiv nu inceteaza, partile au dreptul sa isi notifice incetarea de plin drept a prezentului contract, fara ca vreuna dintre ele sa pretinda daune-interese. Forta majora se va dovedi cu certificat emis de Camera de Comert si Industrie.')}

    ${h('9. NOTIFICAREA INTRE PARTI')}
    ${p('9.1. In acceptiunea partilor contractante, orice notificare adresata de una dintre acestea celeilalte este valabil indeplinita daca va fi transmisa la adresa/sediul prevazut in partea introductiva a prezentului contract.')}
    ${p('9.2. In cazul in care notificarea se face pe cale postala, ea va fi transmisa prin scrisoare recomandata cu confirmare de primire (A.R.) si se considera primita de destinatar la data mentionata de oficiul postal primitor pe aceasta confirmare.')}
    ${p('9.3. In cazul in care confirmarea de primire se face prin e-mail, ea se considera primita in prima zi lucratoare dupa cea in care a fost expediata.')}
    ${p('9.4. Notificarile verbale nu se iau in considerare de niciuna dintre parti, daca nu sunt confirmate prin intermediul uneia dintre modalitatile prevazute la alineatele precedente.')}

    ${h('10. SOLUTIONAREA LITIGIILOR')}
    ${p('10.1. In cazul in care nu este posibila rezolvarea litigiilor pe cale amiabila, partile se vor adresa Tribunalului Prahova.')}

    ${h('11. CLAUZA DE CONFIDENTIALITATE')}
    ${p('11.1. Partile se obliga sa pastreze confidentialitatea datelor, informatiilor si documentelor pe care le vor detine ca urmare a executarii clauzelor prezentului contract. Nerespectarea acestei clauze de catre oricare dintre parti atrage obligarea celui in culpa la plata de daune-interese.')}
    ${p('11.2. Partile au obligatia respectarii normelor legale ce reglementeaza GDPR.')}

    ${h('12. CLAUZE FINALE')}
    ${p('12.1. Prestatorul nu poate cesiona ori subcontracta, in tot sau in parte, executarea serviciilor ce fac obiectul prezentului contract decat cu acordul prealabil, scris, al beneficiarului, sub sanctiunea rezilierii contractului.')}
    ${p('12.2. Prestatorul declara in mod expres, definitiv si irevocabil ca renunta fata de beneficiar la: a) ipoteca legala a antreprenorului prevazuta la art. 1869 si la art. 2386 alin. (6) din Codul Civil roman si la inregistrarea in cartea funciara a ipotecii legale a antreprenorului prevazute la art. 1869 si la art. 2386 alin. (6) din Codul Civil roman; b) actiunea directa a lucratorilor prevazuta la art. 1856 din Codul Civil roman; c) orice privilegii, garantii, sarcini sau ipoteci de care prestatorul ar putea beneficia conform legii.')}
    ${p('12.3. In situatia inregistrarii de intarzieri in executie, ori a inregistrarii de catre prestator a unui progres nesatisfacator, inclusiv din punct de vedere calitativ, beneficiarul poate, la libera sa alegere, sa notifice prestatorului, in scris, incetarea prezentului contract. Urmare a incetarii contractului in aceasta modalitate, beneficiarul va achita prestatorului doar sumele aprobate spre plata, respectiv decontate, de catre beneficiarul final, sume aferente lucrarilor deja executate de catre prestator.')}
    ${p('12.4. In situatia inregistrarii de intarzieri in executie, ori a inregistrarii de catre prestator a unui progres nesatisfacator, beneficiarul, la libera sa alegere, si fara a fi tinut de prevederile anterioare, poate prelua executarea, total sau in parte, a lucrarilor, ori poate incredinta executarea acestora catre un alt prestator. Urmare a aplicarii acestei clauze, beneficiarul va achita prestatorului doar sumele aprobate spre plata, respectiv decontate, de catre beneficiarul final, aferente lucrarilor deja executate de catre prestator. Aceasta clauza nu exclude retinerea penalitatilor de intarziere si a eventualelor daune suportate de beneficiar ca urmare a intarzierilor prestatorului.')}
    ${p('12.5. In situatia inregistrarii de intarzieri in executie, ori a inregistrarii de catre prestator a unui progres nesatisfacator, inclusiv din punct de vedere calitativ, beneficiarul poate, la libera sa alegere, sa notifice, in scris, prestatorul, fixandu-i un termen pana la care acesta sa remedieze ori sa finalizeze lucrarile restante conform graficului. In situatia in care prestatorul nu se conformeaza in termenul notificat, beneficiarul poate, la libera sa alegere, sa notifice prestatorului, in scris, incetarea prezentului contract. Urmare a aplicarii acestei clauze, beneficiarul va achita prestatorului doar sumele aprobate spre plata, respectiv decontate, de catre beneficiarul final, aferente lucrarilor deja executate de catre prestator. Aceasta clauza nu exclude retinerea penalitatilor de intarziere si a eventualelor daune suportate de beneficiar ca urmare a intarzierilor prestatorului.')}
    ${p('12.6. Partile convin, in mod expres, ca beneficiarul este indreptatit, la libera sa alegere, sa aplice oricare dintre prevederile de la art. 12.3, 12.4, 12.5 ar considera de cuviinta.')}
    ${p(`12.7. Prezentul contract, impreuna cu anexele sale, asupra carora s-a facut referire anterior, ce fac parte integranta din acesta, a fost incheiat in 2 exemplare, cate unul pentru fiecare parte semnatara, astazi, ${dataRo}.`)}

    <table style="width:100%;margin-top:34px;font-size:11.5px;"><tr>
      <td style="width:50%;text-align:center;vertical-align:top;">
        <div style="font-weight:bold;">BENEFICIAR,</div>
        <div style="font-weight:bold;margin-top:4px;">GAZPET INSTAL S.R.L.</div>
        <div style="margin-top:2px;">Administrator</div>
        <div>Trusu Razvan</div>
        <div style="margin-top:44px;">.............................</div>
      </td>
      <td style="width:50%;text-align:center;vertical-align:top;">
        <div style="font-weight:bold;">PRESTATOR,</div>
        <div style="font-weight:bold;margin-top:4px;">${esc(f.prestator_nume)}</div>
        <div style="margin-top:2px;">${esc(f.prestator_reprezentant)}</div>
        <div style="margin-top:44px;">.............................</div>
      </td>
    </tr></table>
    <div style="margin-top:20px;border-top:1px solid #ccc;padding-top:5px;font-size:8.5px;color:#777;">
      Generat din Gazpet ERP la ${new Date().toLocaleDateString('ro-RO')} · model contract montaj conducte (Transgaz / Romgaz / Conpet) · document DRAFT pana la semnare
    </div>
  </div>`
}

// HTML înalt → canvas → jsPDF multipagină (felii de 297mm; 794px = 210mm la scale 2)
async function renderContractPdf(html) {
  const holder = document.createElement('div')
  holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;background:#ffffff;z-index:-1;'
  holder.innerHTML = html
  document.body.appendChild(holder)
  try {
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    const canvas = await html2canvas(holder, { scale: 2, backgroundColor: '#ffffff', logging: false })
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const imgH = canvas.height * 210 / canvas.width      // înălțimea totală în mm la lățime plină
    const pages = Math.max(1, Math.ceil(imgH / 297))
    const img = canvas.toDataURL('image/jpeg', 0.92)
    for (let i = 0; i < pages; i++) {
      if (i > 0) doc.addPage()
      doc.addImage(img, 'JPEG', 0, -i * 297, 210, imgH, undefined, 'FAST')
    }
    return doc.output('blob')
  } finally {
    document.body.removeChild(holder)
  }
}

// ghicește beneficiarul final din numele beneficiarului contractului-mamă
const ghicesteBF = (nume = '') => {
  const n = nume.toLowerCase()
  if (n.includes('romgaz')) return 'romgaz'
  if (n.includes('conpet')) return 'conpet'
  return 'transgaz'
}

export default function GeneratorContractMontaj({ onClose, onSaved, showToast, contractMama = null, beneficiarMamaNume = '' }) {
  const [parteneri, setParteneri] = useState([])
  const [busy, setBusy] = useState(false)
  const m = contractMama
  // durata sugerată din contractul-mamă: termen_executie_zile sau data_termen − azi
  const durataDinMama = m ? (
    m.termen_executie_zile ? String(Math.max(1, Math.round(m.termen_executie_zile / 30)))
    : m.data_termen ? String(Math.max(1, Math.ceil((new Date(m.data_termen) - Date.now()) / (30 * 86400000)))) : ''
  ) : ''
  const [f, setF] = useState({
    numar: '', data_contract: new Date().toISOString().slice(0, 10),
    beneficiar_final: ghicesteBF(beneficiarMamaNume),
    prestator_id: '', prestator_nume: '', prestator_sediu: '', prestator_telefon: '', prestator_email: '',
    prestator_reg_com: '', prestator_cui: '', prestator_iban: '', prestator_banca: '', prestator_reprezentant: '',
    obiect: 'servicii de montaj conducta de gaze naturale', obiectiv: m?.denumire || '',
    valoare_lei: '', durata_luni: durataDinMama, manager_proiect: 'Razvan Toma',
    reprezentanti: 'Razvan Toma (razvan.toma@gazpet.ro), Constantin Pantea (constantin.pantea@gazpet.ro) si Marilena Tudorache (marilena.tudorache@gazpet.ro)',
    termen_plata_zile: String(m?.termen_plata_zile || 5),
    retentie_pct: String(m?.garantie_buna_executie_pct ?? 10),
    garantie_ani: m?.garantie_perioada_luni ? String(Math.max(1, Math.round(m.garantie_perioada_luni / 12))) : '3',
    penalitate_pct: '0,1',
  })
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }))

  useEffect(() => {
    supabase.from('ofertare_parteneri').select('id, nume, cui, contact, observatii').order('nume')
      .then(({ data }) => setParteneri(data || []))
  }, [])

  const alegePartener = id => {
    set('prestator_id', id)
    const pr = parteneri.find(x => String(x.id) === String(id))
    if (pr) setF(prev => ({ ...prev, prestator_id: id, prestator_nume: pr.nume || '', prestator_cui: pr.cui || '' }))
  }

  const genereaza = async () => {
    if (!f.prestator_nume.trim() || !f.obiectiv.trim() || !f.valoare_lei || !f.durata_luni) {
      showToast?.('Completează minim: prestator, obiectiv, valoare, durată', 'err'); return
    }
    setBusy(true)
    try {
      const blob = await renderContractPdf(contractHtml(f))
      const safeNr = (f.numar || 'fara-nr').replace(/[^\w.-]+/g, '_')
      const path = `generat/${Date.now()}_contract_montaj_${safeNr}.pdf`
      const { error: upErr } = await supabase.storage.from('contracte-terti')
        .upload(path, blob, { contentType: 'application/pdf', upsert: false })
      if (upErr) throw upErr
      const { error: insErr } = await supabase.from('contracte_terti').insert({
        numar_contract: f.numar || null,
        denumire: `Montaj conducte — ${f.obiectiv}`.slice(0, 200),
        partener_text: f.prestator_nume,
        categorie: 'prestari_servicii', sens: 'plata', status: 'draft',
        valoare_lei: Number(String(f.valoare_lei).replace(',', '.')) || null,
        data_semnare: f.data_contract || null,
        termen_plata_zile: Number(f.termen_plata_zile) || null,
        garantie_buna_executie_pct: Number(String(f.retentie_pct).replace(',', '.')) || null,
        garantie_perioada_luni: (Number(f.garantie_ani) || 0) * 12 || null,
        contract_parinte_id: m?.id || null,
        site_id: m?.site_id || null,
        pdf_path: path,
        observatii: `Generat din platformă (model montaj conducte / ${BENEFICIARI_FINALI[f.beneficiar_final]})`
          + (m ? ` din contractul-mamă „${m.numar_contract || m.denumire}"` : '') + `. Obiect: ${f.obiect}`,
      })
      if (insErr) throw insErr
      // descarcă local pentru semnare
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `Contract montaj ${safeNr} - ${f.prestator_nume}.pdf`; a.click()
      URL.revokeObjectURL(url)
      showToast?.('✓ Contract generat, salvat ca DRAFT în listă și descărcat')
      onSaved?.(); onClose?.()
    } catch (e) {
      showToast?.('Eroare: ' + e.message, 'err')
    } finally { setBusy(false) }
  }

  const Row = ({ children }) => <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>{children}</div>
  const Fld = ({ k, label, ...rest }) => (
    <div>
      <label style={S.lbl}>{label}</label>
      <input style={S.input} value={f[k]} onChange={e => set(k, e.target.value)} {...rest} />
    </div>
  )

  return (
    <div style={{ position:'fixed', inset:0, background:'#000a', zIndex:1000, display:'flex', alignItems:'flex-start', justifyContent:'center', overflowY:'auto', padding:'30px 12px' }} onClick={onClose}>
      <div style={{ background:G.surface, border:`1px solid ${G.border2}`, borderRadius:12, padding:22, width:'100%', maxWidth:760 }} onClick={e => e.stopPropagation()}>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:6 }}>
          <span style={{ fontSize:22 }}>📄</span>
          <div style={{ fontSize:17, fontWeight:800, color:G.blue }}>Generator contract montaj conducte</div>
        </div>
        <div style={{ fontSize:11, color:G.muted, marginBottom:10 }}>
          Model „Petroconst rev.01GI" — folosit DOAR pentru lucrări Transgaz / Romgaz / Conpet (contracte de montaj conducte).
          Contractul se salvează ca <b>DRAFT</b> în Contracte cu terți și se descarcă PDF pentru semnare.
        </div>
        {m && (
          <div style={{ padding:'8px 12px', background:G.blue+'18', border:`1px solid ${G.blue}44`, borderRadius:7, fontSize:11, color:G.blue, marginBottom:14 }}>
            🔗 Generat din contractul-mamă: <b>{m.numar_contract ? m.numar_contract + ' · ' : ''}{m.denumire}</b>
            {beneficiarMamaNume ? ` (${beneficiarMamaNume})` : ''} — lucrarea, termenele și garanțiile sunt preluate de acolo; le poți ajusta mai jos.
            După semnare, încarci PDF-ul semnat pe contractul generat (✏️ → PDF), iar el rămâne legat de contractul-mamă.
          </div>
        )}

        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <Row>
            <Fld k="numar" label="Nr. contract" placeholder="ex. 152/2026" />
            <div>
              <label style={S.lbl}>Data contract</label>
              <input type="date" style={S.input} value={f.data_contract} onChange={e => set('data_contract', e.target.value)} />
            </div>
          </Row>
          <Row>
            <div>
              <label style={S.lbl}>Beneficiar final</label>
              <select style={S.input} value={f.beneficiar_final} onChange={e => set('beneficiar_final', e.target.value)}>
                {Object.entries(BENEFICIARI_FINALI).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label style={S.lbl}>Prestator din Parteneri (opțional, precompletează)</label>
              <select style={S.input} value={f.prestator_id} onChange={e => alegePartener(e.target.value)}>
                <option value="">— alege sau completează manual —</option>
                {parteneri.map(pr => <option key={pr.id} value={pr.id}>{pr.nume}</option>)}
              </select>
            </div>
          </Row>

          <div style={{ fontSize:12, fontWeight:700, color:G.orange, marginTop:4 }}>Date prestator</div>
          <Row>
            <Fld k="prestator_nume" label="Denumire *" placeholder="ex. PETROCONST S.A." />
            <Fld k="prestator_sediu" label="Sediu" placeholder="oraș, stradă, nr., județ" />
          </Row>
          <Row>
            <Fld k="prestator_reg_com" label="Nr. Reg. Com." placeholder="J.../..../...." />
            <Fld k="prestator_cui" label="CUI" placeholder="RO......." />
          </Row>
          <Row>
            <Fld k="prestator_iban" label="IBAN" />
            <Fld k="prestator_banca" label="Banca" />
          </Row>
          <Row>
            <Fld k="prestator_telefon" label="Telefon" />
            <Fld k="prestator_email" label="E-mail" />
          </Row>
          <Fld k="prestator_reprezentant" label="Reprezentant legal (funcție + nume)" placeholder="ex. Director General dl. ..." />

          <div style={{ fontSize:12, fontWeight:700, color:G.orange, marginTop:4 }}>Obiect & condiții</div>
          <Fld k="obiect" label="Obiectul serviciilor *" />
          <Fld k="obiectiv" label="Obiectiv / lucrare *" placeholder="ex. Prunisor - Orsova - Baile Herculane - Jupa, LOT 2" />
          <Row>
            <Fld k="valoare_lei" label="Valoare (lei, fără TVA) *" placeholder="ex. 1250000" />
            <Fld k="durata_luni" label="Durată (luni) *" placeholder="ex. 10" />
          </Row>
          <Row>
            <Fld k="manager_proiect" label="Manager proiect (predare front)" />
            <Fld k="termen_plata_zile" label="Termen plată (zile lucr. de la încasare)" />
          </Row>
          <Row>
            <Fld k="retentie_pct" label="Garanție bună execuție (% reținut)" />
            <Fld k="garantie_ani" label="Garanție lucrări (ani)" />
          </Row>
          <Row>
            <Fld k="penalitate_pct" label="Penalitate întârziere (% / zi)" />
            <div />
          </Row>
          <div>
            <label style={S.lbl}>Reprezentanți GI pentru situații de lucrări (art. 3.4)</label>
            <textarea style={{ ...S.input, minHeight:52, resize:'vertical' }} value={f.reprezentanti} onChange={e => set('reprezentanti', e.target.value)} />
          </div>
        </div>

        <div style={{ display:'flex', gap:10, justifyContent:'flex-end', marginTop:18 }}>
          <button style={S.btnS} onClick={onClose} disabled={busy}>Renunță</button>
          <button style={S.btnP} onClick={genereaza} disabled={busy}>{busy ? '⏳ Generez...' : '📄 Generează PDF + salvează draft'}</button>
        </div>
      </div>
    </div>
  )
}
