import { $ } from '../core/util';
import { getLang } from '../core/i18n';
import { state } from '../core/state';

/** What was last announced (for tests and for the eyes-closed status line). */
export const spoken = { last: '', count: 0 };
let quietUntil = 0;

function speakNow(text: string, onend?: () => void) {
  try {
    if (!('speechSynthesis' in window)) { onend?.(); return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = getLang() === 'zh' ? 'zh-CN' : 'en-US'; u.rate = 1.04;
    if (onend) { u.onend = () => onend(); u.onerror = () => onend(); }
    speechSynthesis.speak(u);
  } catch { onend?.(); }
}

/** Speak aloud and mirror to the polite live region (and the eyes-closed status line). */
export function say(text: string, minor = false) {
  if (minor && performance.now() < quietUntil) return;
  if (!minor) quietUntil = performance.now() + Math.min(8000, 1000 + text.length * 50);
  spoken.last = text; spoken.count++;
  $('live').textContent = text;
  $('eyesStatus').textContent = text;
  speakNow(text);
}

/** Screen-reader announcement; spoken aloud as well only in eyes-closed mode. */
export function announce(text: string) {
  if (state.eyes) { say(text, true); return; }
  spoken.last = text; spoken.count++;
  $('live').textContent = text;
}

export function sayAsync(text: string): Promise<void> {
  return new Promise(res => {
    spoken.last = text; spoken.count++;
    $('live').textContent = text; $('eyesStatus').textContent = text;
    let done = false; const fin = () => { if (!done) { done = true; res(); } };
    // a safety net for browsers that never fire onend; generous, so a slow voice is not cut off
    window.setTimeout(fin, 1200 + text.length * (getLang() === 'zh' ? 280 : 90));
    speakNow(text, fin);
  });
}

let toastT = 0;
export function toast(text: string, ms = 3200) {
  const el = $('toast'); el.textContent = text; el.hidden = false;
  clearTimeout(toastT); toastT = window.setTimeout(() => { el.hidden = true; }, ms);
}

export function stopSpeech() { try { speechSynthesis.cancel(); } catch { /* ignore */ } }
