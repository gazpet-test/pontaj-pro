// ════════════════════════════════════════════════════════════════
// Comercial.jsx — Modulul COMERCIAL (placeholder Faza 1)
// LIVE: 19.05.2026 (Etapa 15 Faza 1 — fundație BD + module placeholder)
// Owner principal: Manageri Proiect (Razvan Toma, Eugen Nica, Cristina Pușcașu)
// Next: Faza 4 (Buton „Comandă" + Modal 4 pași + workflow status)
// ════════════════════════════════════════════════════════════════
import ModulePlaceholder from './ModulePlaceholder.jsx'

export default function ComercialPage() {
  return (
    <ModulePlaceholder
      icon="🛒"
      title="Comercial"
      subtitle="Panou Manager Proiect — comenzi din șantier, vânzări, contracte, CRM"
      color="#A371F7"
      faza={4}
      etapa="15.4"
      owner="Manageri Proiect (Toma · Eugen · Cristina)"
      statusBd={true}
      statusUi={false}
      features={[
        'Buton „Comandă" în panou MP — flow 4 pași (Context → Proiect → Materiale → Submit)',
        'Selector tip comandă: sediu / ofertare / execuție-proiect',
        'Asociere obligatorie cu Contract de lucrări (FK contracte_terti)',
        'Listă materiale auto-populată din ofertare câștigate per șantier',
        'Adăugare materiale ad-hoc (electrozi, discuri etc.) fără ofertă',
        'Trimitere directă către Inbox Achiziții (Kostas T)',
        'Tracking status comandă (deschisă → în lucru → în tranzit → ajunsă → finalizată)',
        'Istoric comenzi per șantier cu edit/delete restricționat (super-user)',
        'Notificări in-app pentru schimbări de status',
      ]}
    />
  )
}
