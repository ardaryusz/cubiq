/** Apply the full app theme class to the document root. */
export function applyAppTheme(appTheme: string) {
  const classes = document.documentElement.classList;
  const toRemove: string[] = [];
  classes.forEach(c => {
    if (c.startsWith('theme-') || c === 'dark' || c.startsWith('accent-')) {
      toRemove.push(c);
    }
  });
  toRemove.forEach(c => classes.remove(c));
  if (appTheme) {
    classes.add(`theme-${appTheme}`);
  }
}
