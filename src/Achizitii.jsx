// ════════════════════════════════════════════════════════════════
// Achizitii.jsx — Modulul ACHIZIȚII (placeholder Faza 1)
// LIVE: 19.05.2026 (Etapa 15 Faza 1)
// Owner principal: Kostas T
// Next: Faza 4 (Inbox comenzi + flow „În lucru" / „Analiză" + reminder-uri 5z/30z)
//       Faza 5 (Recepție marfă + upload Factură/DoC/Cert + bifă cantitativ+calitativ)
// ════════════════════════════════════════════════════════════════
import ModulePlaceholder from './ModulePlaceholder.jsx'

export default function AchizitiiPage() {
  return (
    <ModulePlaceholder
      icon="📥"
      title="Achiziții"
      subtitle="Inbox comenzi din șantier — procesare, comandă furnizor, recepție marfă"
      color="#3FB950"
      faza={4}
      etapa="15.4"
      owner="Kostas T"
      statusBd={true}
      statusUi={false}
      features={[
        'Inbox cu listă comenzi sortate după prioritate + dată',
        'Acțiune „Trimis în lucru" — material identificat în lista proiectului',
        'Acțiune „Analiză" — 3 zile cu Ofertarea pentru materiale mărunte',
        'Reminder automat 5 zile pentru răspuns către MP (cu termen livrare estimat)',
        'Reminder bidirecțional la 30+ zile termen estimat (confirmare/update)',
        'Recepție marfă: upload 4 documente (Factură + DoC + Cert + Altele)',
        'Bifă finală „Am primit cantitativ+calitativ" → trecere la CTC',
        'Auto-trimitere documente spre modulul CTC pentru arhivare',
        'Dashboard KPI: comenzi deschise / blocate / termene depășite',
      ]}
    />
  )
}
