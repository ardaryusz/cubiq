import { openUrl } from '@tauri-apps/plugin-opener';

const SAFE_PROTOCOLS = ['http:', 'https:', 'mailto:', 'tel:'];

/**
 * Validates and opens a URL in the user's default browser.
 */
export async function openExternalUrl(url: string | URL) {
  try {
    const urlStr = typeof url === 'string' ? url : url.toString();
    const parsed = new URL(urlStr);
    
    if (!SAFE_PROTOCOLS.includes(parsed.protocol)) {
      console.warn(`Blocked attempt to open unsafe protocol: ${parsed.protocol}`);
      return;
    }
    
    await openUrl(urlStr);
  } catch (error) {
    console.error('Failed to open external URL:', error);
  }
}

/**
 * Sets up a global event listener to intercept link clicks and open them externally.
 * Idempotent — safe to call multiple times (e.g., during HMR); registers only once.
 */
let _interceptorInstalled = false;

export function setupLinkInterceptor() {
  if (_interceptorInstalled) return;
  _interceptorInstalled = true;

  const handleLinkClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    // Find the closest anchor tag with an href attribute
    const anchor = target.closest('a[href]') as HTMLAnchorElement | null;
    if (!anchor) return;

    const url = anchor.href;
    const currentOrigin = window.location.origin;

    // Check if it's an external link or a safe non-http protocol
    const isExternal = !url.startsWith(currentOrigin);
    const isSafeProtocol = SAFE_PROTOCOLS.some(proto => url.startsWith(proto));

    if (isSafeProtocol) {
      if (isExternal) {
        event.preventDefault();
        event.stopPropagation();
        openExternalUrl(url);
      }
      // Internal links (e.g., hash routes or relative paths) are ignored and handled by the app
    } else {
      // Unsafe or unknown protocol (e.g., javascript:, file:, data:)
      event.preventDefault();
      event.stopPropagation();
      console.warn(`Blocked navigation to unsafe URL: ${url}`);
    }
  };

  // Intercept standard clicks
  document.addEventListener('click', handleLinkClick, true);

  // Intercept middle clicks (auxclick with button 1)
  document.addEventListener('auxclick', (event: MouseEvent) => {
    if (event.button === 1) {
      handleLinkClick(event);
    }
  }, true);

  // Intercept window.open calls
  const originalWindowOpen = window.open;
  window.open = (url?: string | URL, target?: string, features?: string) => {
    if (!url) return originalWindowOpen(url, target, features);
    
    const urlStr = url.toString();
    const isSafe = SAFE_PROTOCOLS.some(proto => urlStr.startsWith(proto));
    const isExternal = !urlStr.startsWith(window.location.origin);

    if (isSafe && isExternal) {
      openExternalUrl(urlStr);
      return null;
    }
    
    if (!isSafe) {
      console.warn(`Blocked window.open to unsafe URL: ${urlStr}`);
      return null;
    }

    return originalWindowOpen(url, target, features);
  };
}
