import { useEffect } from 'react';
import { supabase } from '../utils/supabase';

/**
 * AuthCallback — the OAuth redirect landing page.
 *
 * Desktop (popup) flow:
 *   Google → AuthCallback (in popup) → exchangeCodeForSession writes session
 *   to localStorage → storage event fires in parent tab → parent detects
 *   session, shows toast, navigates. We just close the popup.
 *   No postMessage. No window.opener. Both break under COOP.
 *
 * Mobile (redirect) flow:
 *   Google → AuthCallback (main tab) → exchangeCodeForSession → we set a
 *   toast flag in sessionStorage, then navigate to postAuthRedirect (or '/').
 *   AuthContext's SIGNED_IN handler is intentionally NOT used for navigation
 *   here — we do it ourselves so the flag and redirect happen atomically.
 */
export default function AuthCallback() {
  useEffect(() => {
    const handle = async () => {
      try {
        const { error } = await supabase.auth.exchangeCodeForSession(
          window.location.search
        );

        // Detect popup: window.opener accessible without throwing = popup path.
        // COOP may have severed opener, but we can still detect we're a popup
        // by checking if we were opened (window.opener exists or COOP threw).
        const isPopup = (() => {
          try {
            // If opener is accessible and non-null → definitely a popup
            return Boolean(window.opener);
          } catch {
            // COOP blocked the check — we're almost certainly a popup
            // (main-tab navigations don't trigger COOP opener blocking)
            return true;
          }
        })();

        if (isPopup) {
          // ── Popup path ────────────────────────────────────────────────────
          // The session is now in localStorage. The parent tab's 'storage'
          // event listener (in GoogleLoginButton) will fire and handle the
          // toast + redirect. We just need to close.
          // Small delay ensures the localStorage write has propagated
          // before the window disappears.
          setTimeout(() => {
            try { window.close(); } catch { /* COOP may block this too */ }
          }, 100);
          return;
        }

        // ── Mobile / redirect fallback path ──────────────────────────────────
        if (!error) {
          const redirect = sessionStorage.getItem('postAuthRedirect') || '/';
          sessionStorage.removeItem('postAuthRedirect');
          // Flag is consumed by the useAuthToast hook mounted in App.tsx
          sessionStorage.setItem('showWelcomeToast', '1');
          window.location.replace(redirect);
        } else {
          sessionStorage.setItem('showAuthErrorToast', error.message);
          window.location.replace('/login');
        }
      } catch (err: any) {
        console.error('AuthCallback error:', err);
        // Best-effort close (popup) or redirect (main tab)
        try { window.close(); } catch { /* noop */ }
        window.location.replace('/');
      }
    };

    handle();
  }, []);

  // Visible for ~100–300ms while exchangeCodeForSession runs
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: '#171717',
        gap: '14px',
      }}
    >
      <svg
        width="36"
        height="36"
        viewBox="0 0 36 36"
        fill="none"
        style={{ animation: 'spin 0.8s linear infinite' }}
      >
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <circle cx="18" cy="18" r="15" stroke="#3f3f3f" strokeWidth="3" />
        <path
          d="M18 3 A15 15 0 0 1 33 18"
          stroke="#4285F4"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
      <p style={{ margin: 0, fontSize: '14px', color: '#9ca3af', fontFamily: 'sans-serif' }}>
        Logger ind…
      </p>
    </div>
  );
}
