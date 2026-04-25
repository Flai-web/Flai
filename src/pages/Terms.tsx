import React, { useState } from 'react';

interface Section {
  id: string;
  title: string;
  icon: string;
  items: string[];
}

const sections: Section[] = [
  {
    id: 'booking',
    title: 'Booking',
    icon: '📅',
    items: [
      'Alle indtastede oplysninger gemmes sikkert i vores database.',
      'Færdige optagelser eller billeder gemmes i vores cloud (Google Drive).',
      'Vigtige e-mails, såsom bookingbekræftelser og gennemførte booking-e-mails, sendes til din e-mailadresse.',
      'Når du udfylder dine betalingsoplysninger, enten på en faktura, betalingssiden under booking eller med vores kortterminal under optagelserne, trækkes tjenestens pris. Hvis redigering er inkluderet, trækkes yderligere 100 kr.',
    ],
  },
  {
    id: 'konto',
    title: 'Konto oprettelse',
    icon: '👤',
    items: [
      'Dine oplysninger gemmes sikkert i vores database.',
      'Dine oplysninger bruges til at udfylde felter i vores system, f.eks. under booking.',
      'Vigtige e-mails, såsom bookingbekræftelser og gennemførte booking-e-mails, sendes til din e-mailadresse.',
    ],
  },
];

const Terms: React.FC = () => {
  const [activeSection, setActiveSection] = useState<string | null>(null);

  return (
    <div style={styles.page}>
      <div style={styles.bgGlow} />
      <div style={styles.container}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.badge}>Juridisk dokument</div>
          <h1 style={styles.title}>Vilkår & Betingelser</h1>
          <p style={styles.subtitle}>
            Disse vilkår gælder for alle bookinger og kontooprettelser hos Flai.
            Læs dem venligst grundigt igennem.
          </p>
          <div style={styles.metaRow}>
            <span style={styles.metaItem}>
              <span style={styles.metaDot} />
              Opdateret 2025
            </span>
            <span style={styles.metaDivider}>·</span>
            <span style={styles.metaItem}>Gælder for alle kunder</span>
          </div>
        </div>

        {/* Table of contents */}
        <div style={styles.toc}>
          <p style={styles.tocLabel}>INDHOLD</p>
          <div style={styles.tocLinks}>
            {sections.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                style={styles.tocLink}
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth' });
                }}
              >
                <span style={styles.tocIcon}>{s.icon}</span>
                {s.title}
              </a>
            ))}
          </div>
        </div>

        {/* Sections */}
        <div style={styles.sections}>
          {sections.map((section, idx) => (
            <div
              key={section.id}
              id={section.id}
              style={{
                ...styles.section,
                ...(activeSection === section.id ? styles.sectionActive : {}),
              }}
              onMouseEnter={() => setActiveSection(section.id)}
              onMouseLeave={() => setActiveSection(null)}
            >
              <div style={styles.sectionHeader}>
                <div style={styles.sectionIconWrap}>
                  <span style={styles.sectionIcon}>{section.icon}</span>
                </div>
                <div>
                  <div style={styles.sectionNumber}>§{idx + 1}</div>
                  <h2 style={styles.sectionTitle}>{section.title}</h2>
                </div>
              </div>
              <div style={styles.divider} />
              <ul style={styles.list}>
                {section.items.map((item, i) => (
                  <li key={i} style={styles.listItem}>
                    <div style={styles.bullet} />
                    <p style={styles.listText}>{item}</p>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Footer note */}
        <div style={styles.footer}>
          <div style={styles.footerIcon}>⚖️</div>
          <p style={styles.footerText}>
            Ved at benytte Flais tjenester accepterer du disse vilkår. Har du spørgsmål,
            er du altid velkommen til at kontakte os.
          </p>
        </div>
      </div>
    </div>
  );
};

const styles: { [key: string]: React.CSSProperties } = {
  page: {
    minHeight: '100vh',
    background: '#171717',
    color: '#e5e5e5',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    position: 'relative',
    overflowX: 'hidden',
  },
  bgGlow: {
    position: 'fixed',
    top: '-200px',
    left: '50%',
    transform: 'translateX(-50%)',
    width: '800px',
    height: '500px',
    background: 'radial-gradient(ellipse, rgba(15,82,186,0.12) 0%, transparent 70%)',
    pointerEvents: 'none',
    zIndex: 0,
  },
  container: {
    position: 'relative',
    zIndex: 1,
    maxWidth: '720px',
    margin: '0 auto',
    padding: '60px 24px 80px',
  },
  header: {
    marginBottom: '48px',
  },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '4px 12px',
    background: 'rgba(15,82,186,0.15)',
    border: '1px solid rgba(15,82,186,0.3)',
    borderRadius: '20px',
    fontSize: '11px',
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: '#64A0FF',
    marginBottom: '20px',
  },
  title: {
    fontSize: 'clamp(32px, 5vw, 48px)',
    fontWeight: 700,
    color: '#ffffff',
    margin: '0 0 16px',
    lineHeight: 1.1,
    letterSpacing: '-0.02em',
  },
  subtitle: {
    fontSize: '16px',
    lineHeight: 1.7,
    color: '#a3a3a3',
    margin: '0 0 20px',
    maxWidth: '540px',
  },
  metaRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    fontSize: '13px',
    color: '#737373',
  },
  metaItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  metaDot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    background: '#10B981',
    display: 'inline-block',
  },
  metaDivider: {
    color: '#404040',
  },
  toc: {
    background: '#1f1f1f',
    border: '1px solid #2a2a2a',
    borderRadius: '12px',
    padding: '20px 24px',
    marginBottom: '40px',
  },
  tocLabel: {
    fontSize: '10px',
    fontWeight: 700,
    letterSpacing: '0.12em',
    color: '#525252',
    textTransform: 'uppercase',
    margin: '0 0 12px',
  },
  tocLinks: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
  },
  tocLink: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 14px',
    background: '#262626',
    border: '1px solid #333',
    borderRadius: '8px',
    fontSize: '13px',
    color: '#d4d4d4',
    textDecoration: 'none',
    cursor: 'pointer',
  },
  tocIcon: {
    fontSize: '14px',
  },
  sections: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  },
  section: {
    background: '#1c1c1c',
    border: '1px solid #2a2a2a',
    borderRadius: '16px',
    padding: '28px 32px',
    transition: 'border-color 0.2s',
  },
  sectionActive: {
    borderColor: 'rgba(15,82,186,0.4)',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '16px',
    marginBottom: '20px',
  },
  sectionIconWrap: {
    width: '44px',
    height: '44px',
    background: 'rgba(15,82,186,0.1)',
    border: '1px solid rgba(15,82,186,0.2)',
    borderRadius: '10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  sectionIcon: {
    fontSize: '20px',
  },
  sectionNumber: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#0F52BA',
    letterSpacing: '0.05em',
    marginBottom: '4px',
  },
  sectionTitle: {
    fontSize: '20px',
    fontWeight: 600,
    color: '#ffffff',
    margin: 0,
    lineHeight: 1.2,
  },
  divider: {
    height: '1px',
    background: '#2a2a2a',
    marginBottom: '20px',
  },
  list: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
  },
  listItem: {
    display: 'flex',
    gap: '14px',
    alignItems: 'flex-start',
  },
  bullet: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    background: '#0F52BA',
    marginTop: '8px',
    flexShrink: 0,
  },
  listText: {
    fontSize: '15px',
    lineHeight: 1.65,
    color: '#c4c4c4',
    margin: 0,
  },
  footer: {
    marginTop: '48px',
    padding: '24px 28px',
    background: 'rgba(15,82,186,0.06)',
    border: '1px solid rgba(15,82,186,0.15)',
    borderRadius: '12px',
    display: 'flex',
    gap: '16px',
    alignItems: 'flex-start',
  },
  footerIcon: {
    fontSize: '24px',
    flexShrink: 0,
    marginTop: '2px',
  },
  footerText: {
    fontSize: '14px',
    lineHeight: 1.7,
    color: '#a3a3a3',
    margin: 0,
  },
};

export default Terms;
