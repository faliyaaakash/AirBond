// Camera/mic failures need different UI treatment depending on cause - a
// denied permission needs "check your browser settings", a missing device
// needs "no camera found", and an insecure origin needs platform-specific
// instructions (chrome://flags works on Android Chrome, but iOS has no
// equivalent at all) - so callers get a classified code, not just a string.
export type MediaErrorCode = 'insecure-context' | 'permission-denied' | 'no-device' | 'device-in-use' | 'unknown';

export interface MediaErrorInfo {
  code: MediaErrorCode;
  message: string;
}

export function classifyMediaError(err: unknown, verb = 'access camera/microphone'): MediaErrorInfo {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      return {
        code: 'permission-denied',
        // Includes the raw browser reason (usually just "Permission denied",
        // but on mobile can also mean the OS blocked the whole browser app
        // from the camera/mic - a separate setting from the in-page site
        // permission toggle) so it's diagnosable without needing devtools.
        message:
          "Camera/microphone permission was denied. Check this browser's site settings AND your phone/OS-level " +
          "app permissions for this browser (camera/mic can be blocked at the OS level even when the site's own " +
          `permission shows "allowed"), then try again. (Browser reported: ${err.name}${err.message ? ` - ${err.message}` : ''})`,
      };
    }
    if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      return { code: 'no-device', message: 'No camera or microphone was found on this device.' };
    }
    if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
      return {
        code: 'device-in-use',
        message: `Couldn't ${verb} - it may already be in use by another app or browser tab.`,
      };
    }
  }
  return {
    code: 'unknown',
    message: err instanceof Error ? `Couldn't ${verb}: ${err.message}` : `Couldn't ${verb}.`,
  };
}

type SimplePermissionState = PermissionState | 'unknown';

// getUserMedia({video: true, audio: true}) is one atomic request - if EITHER
// device's permission is denied, the whole call rejects with the same
// NotAllowedError, with no way to tell from the exception alone which one.
// That reads as "I already allowed the microphone, why is it still erroring"
// when it's actually the camera that's blocked (or vice versa) - so on a
// permission failure, separately query each permission to say which.
async function queryMediaPermissions(): Promise<{ camera: SimplePermissionState; microphone: SimplePermissionState }> {
  const query = navigator.permissions?.query?.bind(navigator.permissions);
  if (!query) return { camera: 'unknown', microphone: 'unknown' };

  const [camera, microphone] = await Promise.all([
    query({ name: 'camera' as PermissionName })
      .then((status) => status.state)
      .catch(() => 'unknown' as const),
    query({ name: 'microphone' as PermissionName })
      .then((status) => status.state)
      .catch(() => 'unknown' as const),
  ]);
  return { camera, microphone };
}

export async function classifyMediaErrorAsync(err: unknown, verb = 'access camera/microphone'): Promise<MediaErrorInfo> {
  if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')) {
    const { camera, microphone } = await queryMediaPermissions();
    if (camera === 'denied' && microphone !== 'denied') {
      return {
        code: 'permission-denied',
        message:
          "Camera access is blocked, even though microphone access is allowed. Click the camera icon in this " +
          "browser's address bar, allow the camera, then try again.",
      };
    }
    if (microphone === 'denied' && camera !== 'denied') {
      return {
        code: 'permission-denied',
        message:
          "Microphone access is blocked, even though camera access is allowed. Click the camera icon in this " +
          "browser's address bar, allow the microphone, then try again.",
      };
    }
  }
  return classifyMediaError(err, verb);
}

// iPadOS 13+ identifies itself as "Macintosh" but exposes touch points, so the
// UA string alone isn't enough - this is the standard sniff for that case.
export function isLikelyIOS(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isLikelyAndroid(): boolean {
  return /Android/.test(navigator.userAgent);
}
