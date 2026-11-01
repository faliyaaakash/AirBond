import { theme } from '../theme';
import { isLikelyAndroid, isLikelyIOS } from '../stream/mediaError';

// Camera/mic "permission denied" needs different recovery steps per platform.
// Android's in-page prompt can get silently auto-blocked after being
// dismissed/denied once - the failure then looks identical to a fresh
// request (NotAllowedError, no visible prompt at all), and the fix lives in
// two independent places: the browser's own site permission AND the OS-level
// app permission for the browser itself. iOS instead routes entirely through
// the Settings app, not anything inside the browser.
export default function PermissionDeniedHelp() {
  if (isLikelyAndroid()) {
    return (
      <div style={{ marginTop: 10 }}>
        <p style={{ color: theme.color.danger, fontSize: 12, lineHeight: 1.6, margin: 0 }}>
          If no permission popup appeared at all before this error, Chrome already has a stored
          decision for this page - two separate things to check:
        </p>
        <ol style={{ color: theme.color.danger, fontSize: 12, lineHeight: 1.6, marginTop: 6, paddingLeft: 18 }}>
          <li>
            In Chrome, tap the lock/info icon next to the address bar → Permissions (or Chrome menu →
            Settings → Site settings → All sites → this page) → set Camera and Microphone to Allow.
          </li>
          <li>
            Also check Android Settings → Apps → Chrome → Permissions → Camera and Microphone are set
            to Allow - if Chrome itself is blocked at the OS level, it won't even show the in-page
            prompt.
          </li>
        </ol>
      </div>
    );
  }

  if (isLikelyIOS()) {
    return (
      <p style={{ color: theme.color.danger, fontSize: 12, marginTop: 10, lineHeight: 1.6 }}>
        On iPhone/iPad this is controlled from the Settings app, not the browser: Settings → Safari
        (or Chrome, if that's what you're using) → Camera and Microphone → Allow. Then reload this
        page.
      </p>
    );
  }

  return null;
}
