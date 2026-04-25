import React, { useState } from 'react';

interface PolicySection {
  id: string;
  title: string;
  icon: string;
  color: string;
  items: string[];
}

const policySections: PolicySection[] = [
  {
    id: 'vaerdier',
    title: 'Firma værdier',
    icon: '🌟',
    color: '#FBBF24',
    items: [
      'Hos Flai skal kunder kun betale, hvis de er tilfredse med resultatet.',
      'Vores direktør og dronepilot er 13-årige Felix.',
    ],
  },
  {
    id: 'databrug',
    title: 'Databrug',
    icon: '🔒',
    color: '#10B981',
    items: [
      'Vi bruger din email, dit navn og dit profilbillede fra din Google-login session.',
      'Når du opretter en konto via Google login, gemmes dit navn, din email og dit profilbillede automatisk til brug under bookinger.',
    ],
  },
];

const Policies: React.FC = () => {
  const [activeSection, setActiveSection] = useState<string | null>(null);

  return (
    <div style={styles.page}>
      <div style={styles.bgGlow} />
      <div style={styles.container}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.badge}>Fortrolighed & Politikker</div>
          <h1 style={styles.title}>Privatlivspolitik</h1>
          <p style={styles.subtitle}>
            Hos Flai tager vi dit privatliv alvorligt. Her kan du læse om vores
            værdier og hvordan vi håndterer dine data.
          </p>
          <div style={styles.metaRow}>
            <span style={styles.metaItem}>
              <span style={styles.metaDot} />
              GDPR-kompatibel
            </span>
            <span style={styles.metaDivider}>·</span>
            <span style={styles.metaItem}>Opdateret 2025</span>
          </div>
        </div>

        {/* Highlight card */}
        <div style={styles.highlight}>
          <div style={styles.highlightLeft}>
            <div style={styles.highlightIconWrap}>✅</div>
          </div>
          <div>
            <h3 style={styles.highlightTitle}>Vores løfte til dig</h3>
            <p style={styles.highlightText}>
              Du betaler kun, hvis du er tilfreds. Vi sælger aldrig dine data til tredjeparter.
              Dit privatliv er vores prioritet.
            </p>
          </div>
        </div>

        {/* Table of contents */}
        <div style={styles.toc}>
          <p style={styles.tocLabel}>INDHOLD</p>
          <div style={styles.tocLinks}>
            {policySections.map((s) => (
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

        {/* Policy Sections */}
        <div style={styles.sections}>
          {policySections.map((section, idx) => (
            <div
              key={section.id}
              id={section.id}
              style={{
                ...styles.section,
                ...(activeSection === section.id ? {
                  borderColor: section.color + '40',
                } : {}),
              }}
              onMouseEnter={() => setActiveSection(section.id)}
              onMouseLeave={() => setActiveSection(null)}
            >
              <div style={styles.sectionHeader}>
                <div style={{
                  ...styles.sectionIconWrap,
                  background: section.color + '18',
                  border: `1px solid ${section.color}33`,
                }}>
                  <span style={styles.sectionIcon}>{section.icon}</span>
                </div>
                <div>
                  <div style={{ ...styles.sectionNumber, color: section.color }}>
                    §{idx + 1}
                  </div>
                  <h2 style={styles.sectionTitle}>{section.title}</h2>
                </div>
              </div>
              <div style={styles.divider} />
              <ul style={styles.list}>
                {section.items.map((item, i) => (
                  <li key={i} style={styles.listItem}>
                    <div style={{ ...styles.bullet, background: section.color }} />
                    <p style={styles.listText}>{item}</p>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Data we collect summary */}
        <div style={styles.dataBox}>
          <h3 style={styles.dataBoxTitle}>Data vi indsamler</h3>
          <div style={styles.dataGrid}>
            {[
              { icon: '📧', label: 'E-mailadresse' },
              { icon: '👤', label: 'Navn' },
              { icon: '🖼️', label: 'Profilbillede' },
            ].map((d) => (
              <div key={d.label} style={styles.dataChip}>
                <span style={styles.dataChipIcon}>{d.icon}</span>
                <span style={styles.dataChipLabel}>{d.label}</span>
              </div>
            ))}
          </div>
          <p style={styles.dataNote}>
            Kun via Google Login — aldrig manuelt indtastet eller delt med tredjeparter.
          </p>
        </div>

        {/* Footer note */}
        <div style={styles.footer}>
          <div style={styles.footerIcon}>🛡️</div>
          <p style={styles.footerText}>
            Dine data er i sikre hænder. Vi overholder alle gældende databeskyttelseslove.
            Kontakt os, hvis du har spørgsmål til behandlingen af dine personoplysninger.
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
    background: 'radial-gradient(ellipse, rgba(16,185,129,0.08) 0%, transparent 70%)',
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
    marginBottom: '36px',
  },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '4px 12px',
    background: 'rgba(16,185,129,0.12)',
    border: '1px solid rgba(16,185,129,0.25)',
    borderRadius: '20px',
    fontSize: '11px',
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: '#10B981',
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
  highlight: {
    display: 'flex',
    gap: '16px',
    alignItems: 'flex-start',
    background: 'rgba(16,185,129,0.06)',
    border: '1px solid rgba(16,185,129,0.2)',
    borderRadius: '14px',
    padding: '22px 24px',
    marginBottom: '32px',
  },
  highlightLeft: {
    flexShrink: 0,
  },
  highlightIconWrap: {
    fontSize: '28px',
    marginTop: '2px',
  },
  highlightTitle: {
    fontSize: '16px',
    fontWeight: 600,
    color: '#ffffff',
    margin: '0 0 6px',
  },
  highlightText: {
    fontSize: '14px',
    lineHeight: 1.65,
    color: '#a3a3a3',
    margin: 0,
  },
  toc: {
    background: '#1f1f1f',
    border: '1px solid #2a2a2a',
    borderRadius: '12px',
    padding: '20px 24px',
    marginBottom: '32px',
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
    marginBottom: '28px',
  },
  section: {
    background: '#1c1c1c',
    border: '1px solid #2a2a2a',
    borderRadius: '16px',
    padding: '28px 32px',
    transition: 'border-color 0.2s',
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
    marginTop: '8px',
    flexShrink: 0,
  },
  listText: {
    fontSize: '15px',
    lineHeight: 1.65,
    color: '#c4c4c4',
    margin: 0,
  },
  dataBox: {
    background: '#1c1c1c',
    border: '1px solid #2a2a2a',
    borderRadius: '14px',
    padding: '24px 28px',
    marginBottom: '28px',
  },
  dataBoxTitle: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#737373',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    margin: '0 0 16px',
  },
  dataGrid: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '10px',
    marginBottom: '16px',
  },
  dataChip: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 16px',
    background: '#262626',
    border: '1px solid #333',
    borderRadius: '8px',
  },
  dataChipIcon: {
    fontSize: '16px',
  },
  dataChipLabel: {
    fontSize: '14px',
    color: '#d4d4d4',
    fontWeight: 500,
  },
  dataNote: {
    fontSize: '13px',
    color: '#737373',
    margin: 0,
    lineHeight: 1.5,
  },
  footer: {
    padding: '24px 28px',
    background: 'rgba(16,185,129,0.05)',
    border: '1px solid rgba(16,185,129,0.15)',
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

export default Policies;
