import styles from './SettingsModal.module.css';

const FULL_THEMES = [
  { id: 'cubiq-dark', name: 'Cubiq Dark' },
  { id: 'cubiq-light', name: 'Cubiq Light' },
  { id: 'midnight-violet', name: 'Midnight Violet' },
  { id: 'ocean-glass', name: 'Ocean Glass' },
  { id: 'rose-noir', name: 'Rose Noir' },
  { id: 'amber-terminal', name: 'Amber Terminal' },
  { id: 'slate-minimal', name: 'Slate Minimal' },
  { id: 'paper-studio', name: 'Paper Studio' },
  { id: 'mint-studio', name: 'Mint Studio' },
  { id: 'monochrome-pro', name: 'Monochrome Pro' },
];

interface AppearanceSettingsProps {
  activeTheme: string;
  onThemeChange: (themeId: string) => void;
}

export function AppearanceSettings({ activeTheme, onThemeChange }: AppearanceSettingsProps) {
  return (
    <>
      <div className={styles.sectionTitle}>Theme Packs</div>
      <div className={styles.themeGrid}>
        {FULL_THEMES.map(theme => (
          <button
            key={theme.id}
            className={`${styles.themeCard} ${activeTheme === theme.id ? styles.themeCardActive : ''}`}
            onClick={() => onThemeChange(theme.id)}
          >
            <div className={`${styles.themePreview} theme-${theme.id}`}>
              <div className={styles.tpHeader} />
              <div className={styles.tpBody}>
                <div className={styles.tpUser} />
                <div className={styles.tpAsst} />
                <div className={styles.tpComposer} />
              </div>
            </div>
            <span>{theme.name}</span>
          </button>
        ))}
      </div>
    </>
  );
}
