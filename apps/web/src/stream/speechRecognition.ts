// The Web Speech API has no types in TS's default DOM lib, so this file
// defines just the shape this app actually uses. Runs entirely in the
// broadcaster's browser - audio never touches our server, only the resulting
// text is relayed (see useStreamSession's caption handling).

export interface CaptionResult {
  text: string;
  isFinal: boolean;
}

// Surfaced so the UI can tell "no one has spoken yet" apart from "captions
// are actually broken" - previously onerror was a no-op and a dead mic/
// blocked permission/offline speech service just produced silence forever
// with no indication anything was wrong.
export type CaptionStatus =
  | { state: 'retrying'; reason: string }
  | { state: 'stopped'; reason: string };

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  [index: number]: { transcript: string };
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionErrorEventLike {
  error: string;
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | undefined {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function isCaptionsSupported(): boolean {
  return typeof window !== 'undefined' && !!getSpeechRecognitionCtor();
}

// Errors the browser will never recover from on its own - retrying just
// spins forever (and in some cases re-triggers the same permission/service
// dialog repeatedly). Anything else ('no-speech', 'network', 'aborted', …)
// is treated as transient and gets retried with a short backoff.
const TERMINAL_ERRORS = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported']);

// Chrome occasionally throws if a new recognition instance is started
// synchronously inside the previous instance's onend/onerror - a short delay
// avoids that race instead of the restart silently failing.
const RESTART_DELAY_MS = 300;
// After this many consecutive transient errors (no successful result in
// between), back off to a longer interval instead of hammering retries.
const BACKOFF_AFTER_ERRORS = 5;
const BACKOFF_DELAY_MS = 3000;

// Chrome stops recognition after a period of silence, so this restarts itself
// on `onend` until the returned stop function is called - keeping captions
// running for the whole broadcast instead of just the first utterance.
export function startCaptionRecognition(
  onResult: (result: CaptionResult) => void,
  onStatus?: (status: CaptionStatus) => void,
): (() => void) | null {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) return null;

  let stopped = false;
  let consecutiveErrors = 0;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let recognition = createInstance();

  function scheduleRestart(delayMs: number) {
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      restartTimer = null;
      if (stopped) return;
      recognition = createInstance();
      recognition.start();
    }, delayMs);
  }

  function createInstance(): SpeechRecognitionLike {
    const instance = new Ctor!();
    instance.continuous = true;
    instance.interimResults = true;
    instance.lang = 'en-US';
    instance.onresult = (event) => {
      consecutiveErrors = 0;
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? '';
        if (result.isFinal) {
          if (transcript.trim()) onResult({ text: transcript, isFinal: true });
        } else {
          interim += transcript;
        }
      }
      if (interim.trim()) onResult({ text: interim, isFinal: false });
    };
    instance.onerror = (event) => {
      if (stopped) return;
      if (TERMINAL_ERRORS.has(event.error)) {
        stopped = true;
        onStatus?.({ state: 'stopped', reason: event.error });
        return;
      }
      consecutiveErrors += 1;
      const backingOff = consecutiveErrors >= BACKOFF_AFTER_ERRORS;
      onStatus?.({ state: 'retrying', reason: event.error });
      // onend always fires right after onerror - let it drive the actual
      // restart (with the right delay) rather than racing two schedulers.
      void backingOff;
    };
    instance.onend = () => {
      if (stopped) return;
      const delay = consecutiveErrors >= BACKOFF_AFTER_ERRORS ? BACKOFF_DELAY_MS : RESTART_DELAY_MS;
      scheduleRestart(delay);
    };
    return instance;
  }

  recognition.start();
  return () => {
    stopped = true;
    if (restartTimer) clearTimeout(restartTimer);
    recognition.onend = null;
    recognition.stop();
  };
}
