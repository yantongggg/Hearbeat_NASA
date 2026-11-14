import { L, getLang } from '../core/i18n';

/** Static interface strings, keyed by data-i18n / data-i18n-label attributes in index.html. */
export const T: Record<string, [string, string]> = {
  skip: ['Skip to the listening point', '跳到聆听点'],
  tagline: ['Hear how home is doing', '听听家好不好'],
  homeBtn: ['My home', '我的家'],
  startPage: ['Start', '首页'],
  checkups: ['Check-ups', '检查'],
  checkupsTitle: ['Check-ups', '检查'],
  vitalsHere: ['Vital signs here', '这里的生命体征'],
  report: ['Read all vital signs', '读出全部生命体征'],
  eyes: ['Eyes-closed mode', '闭眼模式'],
  about: ['About', '关于'],
  tracks: ['Jukebox tracks', '点唱机曲目'],
  listening: ['Listening point', '聆听点'],
  read: ['Read aloud', '读出数值'],
  describe: ['Describe this frame', '描述这一帧'],
  legend: ['What am I hearing?', '这是什么声音？'],
  compare: ['Compare A / B', 'A / B 对比'],
  nextPlace: ['Jump to next place', '跳到下一个地点'],
  speed: ['Speed', '速度'],
  sound: ['Sound', '声音'],
  musical: ['Musical', '音乐'],
  precise: ['Precise', '精确'],
  gateKicker: ['NASA Earth Information Center · in sound', 'NASA 地球信息中心 · 用声音聆听'],
  gateTag: ['Hear how home is doing.', '听听家，好不好。'],
  gateProblem: ['Astronauts can see home from orbit, but cannot hear it. A student who cannot see is shown home only as colour maps.',
    '宇航员在轨道上看得见家，却听不见。看不见的学生，面对的只有彩色地图。'],
  gateSolution: ['Hearthbeat turns NASA\'s Earth data into sound. Choose your home and hear it: Is it raining? Is the air clean? How much has it warmed?',
    'Hearthbeat 把 NASA 的地球数据变成声音。选你的家，听一听：在下雨吗？空气干净吗？暖了多少？'],
  startCrew: ['Sign in: astronaut or family', '登录：宇航员或家人'],
  crewTitle: ['Sign in', '登录'],
  crewLead: ['Two people, far apart: an astronaut on the space station, and their family at home. Each one hears where the other is.', '两个人，相隔很远：一个在空间站上的宇航员，和他在家里的家人。每个人都听得到对方那边。'],
  crewWhoQ: ['Who are you?', '你是谁？'], crewWhoSub: ['On the space station', '在空间站上'], famWho: ['Family', '家人'], famWhoSub: ['At home on Earth', '在地球上的家里'],
  crewWho: ['Astronaut', '宇航员'],
  crewDemo: ['Demo account', '演示账号'],
  crewHome: ['Home on Earth', '地球上的家'],
  crewSignIn: ['Sign in', '登录'],
  crewNote: ['Demo sign-in: no password, and nothing is sent anywhere. Hearthbeat is an independent project, not a NASA system.', '演示登录：不需要密码，也不会发送任何信息。Hearthbeat 是独立项目，不是 NASA 的系统。'],
  startHome: ['Hear my home', '听我的家'],
  startCheck: ['Check-ups for class', '课堂检查'],
  start: ['Explore the globe', '探索整个地球'],
  startEyes: ['Eyes-closed mode', '闭眼模式'],
  headphones: ['Made first for people who cannot read a colour map. At least 2.2 billion people live with some vision impairment (WHO). Best with headphones.', '首先为看不了彩色地图的人而做。全球至少 22 亿人有不同程度的视力损伤（世卫组织）。建议戴耳机。'],
  eyesTitle: ['Listening', '聆听中'],
  north: ['North', '向北'], south: ['South', '向南'], east: ['East', '向东'], west: ['West', '向西'],
  readHere: ['Read here', '读出这里'],
  playPause: ['Play / pause', '播放 / 暂停'],
  earlier: ['Earlier', '更早'], later: ['Later', '更晚'],
  describeShort: ['Describe', '描述'],
  nextTrack: ['Next track', '下一首'],
  nextPlaceShort: ['Next place', '下一个地点'],
  help: ['Help', '帮助'],
  openEyes: ['Open eyes', '睁开眼睛'],
  aboutTitle: ['About Hearthbeat and its data', '关于 Hearthbeat 与数据'],
  ariaPlayback: ['Playback', '播放控制'], ariaPrev: ['Previous step', '上一步'], ariaNext: ['Next step', '下一步'], ariaTime: ['Time', '时间'],
  ariaFrame: ['Current NASA frame', '当前 NASA 画面'], ariaMove: ['Move the listening point', '移动聆听点'], ariaClose: ['Close', '关闭'],
  ariaGlobe: ['Earth. Arrow keys move the listening point, Enter reads the value, Space plays, D describes the picture, H lists all keys.', '地球。方向键移动聆听点，Enter 读出数值，空格播放，D 描述画面，H 列出所有按键。'],
  speedTitle: ['Playback speed', '播放速度'],
  jumpTo: ['Go to a time', '跳到某个时间']
};
export const t = (k: string) => { const v = T[k]; return v ? L(v[0], v[1]) : k; };

export function applyStatic(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n!); });
  root.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach(el => el.setAttribute('aria-label', t(el.dataset.i18nAria!)));
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach(el => el.setAttribute('title', t(el.dataset.i18nTitle!)));
  root.querySelectorAll<HTMLElement>('[data-i18n-label]').forEach(el => { const s = t(el.dataset.i18nLabel!); el.textContent = s; el.setAttribute('aria-label', s); });
  document.documentElement.lang = getLang() === 'zh' ? 'zh' : 'en';
  root.querySelectorAll<HTMLButtonElement>('[data-set-lang]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.setLang === getLang())));
}

export const KEYS: Array<[string, [string, string]]> = [
  ['← ↑ → ↓', ['Move the listening point (Shift: further)', '移动聆听点（按住 Shift 移得更远）']],
  ['Enter', ['Read the value here', '读出这里的数值']],
  ['Space', ['Play / pause time', '播放 / 暂停时间']],
  [', .', ['Earlier / later step', '上一步 / 下一步']],
  ['1 2 3 4 5', ['Rain, Air quality, Climate, Night lights, Lightning', '降雨、空气质量、气候、夜间灯光、闪电']],
  ['D', ['Describe the whole frame', '描述整幅画面']],
  ['L', ['Sound legend: low, middle, high', '声音图例：低、中、高']],
  ['P', ['Jump to the next interesting place', '跳到下一个值得听的地点']],
  ['C', ['Compare: mark A, then hear B against it', '对比：先标记 A，再与 B 比较']],
  ['V', ['Read all three vital signs here', '读出这里的三项生命体征']],
  ['K', ['Check-ups', '检查']],
  ['M', ['Musical or precise sound', '切换音乐 / 精确声音']],
  ['E', ['Eyes-closed mode on / off', '开关闭眼模式']],
  ['H', ['Hear these keys', '听按键说明']]
];
