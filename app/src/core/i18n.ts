export type Lang = 'en' | 'zh';

let lang: Lang = 'en';
try { const s = localStorage.getItem('hb-lang'); if (s === 'zh' || s === 'en') lang = s; } catch { /* storage may be blocked */ }
if (typeof location !== 'undefined' && location.hash === '#zh') lang = 'zh';

const listeners: Array<() => void> = [];

export const getLang = () => lang;
/** Pick the string for the current language. */
export const L = (en: string, zh: string) => (lang === 'zh' ? zh : en);
export function setLang(l: Lang) {
  lang = l;
  try { localStorage.setItem('hb-lang', l); } catch { /* ignore */ }
  listeners.forEach(f => f());
}
export const onLangChange = (f: () => void) => { listeners.push(f); };
