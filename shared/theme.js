// Дополнительные функции для поддержки тем
function getThemeColor(colorName, theme) {
  const themeColors = {
    light: {
      bg: '--bg-light',
      surface: '--surface-light',
      text: '--text-light',
      accent: '--accent-light'
    },
    dark: {
      bg: '--bg-dark',
      surface: '--surface-dark',
      text: '--text-dark',
      accent: '--accent-dark'
    }
  };
  return themeColors[theme][colorName];
}

function getThemeVariables(theme) {
  const themeVariables = {
    light: {
      '--bg': 'var(--bg-light)',
      '--surface': 'var(--surface-light)',
      '--text': 'var(--text-light)',
      '--border': 'var(--border-light)',
      '--radius-s': 'var(--radius-s)',
      '--space-1': 'var(--space-1)',
      '--elevated': 'var(--elevated-light)',
      '--accent': 'var(--accent-light)',
      '--warn': 'var(--warn-light)',
      '--ok': 'var(--ok-light)',
      '--danger': 'var(--danger-light)'
    },
    dark: {
      '--bg': 'var(--bg-dark)',
      '--surface': 'var(--surface-dark)',
      '--text': 'var(--text-dark)',
      '--border': 'var(--border-dark)',
      '--radius-s': 'var(--radius-s)',
      '--space-1': 'var(--space-1)',
      '--elevated': 'var(--elevated-dark)',
      '--accent': 'var(--accent-dark)',
      '--warn': 'var(--warn-dark)',
      '--ok': 'var(--ok-dark)',
      '--danger': 'var(--danger-dark)'
    }
  };
  return themeVariables[theme];
}
