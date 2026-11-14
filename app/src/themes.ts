/**
 * The five Jukebox tracks. Each plays one NASA layer (chosen in pipeline/sources.json via the
 * manifest's `themes` block) and says how values are named, sorted into categories and explained.
 */
import { L } from './core/i18n';

export type ThemeId = 'rain' | 'air' | 'climate' | 'lights' | 'lightning';
export const THEME_IDS: ThemeId[] = ['rain', 'air', 'climate', 'lights', 'lightning'];

export interface Category { max: number; en: string; zh: string; /** 0..1 position used for haptics and colour */ level: number }

export interface ThemeDef {
  id: ThemeId;
  no: string;
  name: [string, string];
  /** the planet's vital sign this track listens to (the stethoscope metaphor) */
  sign: [string, string];
  question: [string, string];
  quantity: [string, string];
  color: string;
  categories: Category[];
  /** value at or above which a cell counts as "present" for the neighbourhood cue */
  presence: number;
  /** places worth jumping to with the P key, [lat, lon] */
  presets: Array<[number, number]>;
  fmt: (v: number) => string;
  /** what each sound means, shown and spoken in the legend */
  hear: Array<[string, string]>;
  /** the three values the sound legend plays, low → high */
  legend: number[];
  scienceWhat: [string, string];
  categorySource: [string, string];
}

const f1 = (v: number) => (Math.abs(v) < 10 ? v.toFixed(1) : v.toFixed(0));

export const THEMES: Record<ThemeId, ThemeDef> = {
  rain: {
    id: 'rain', no: '01', color: '#8fcaff',
    name: ['Rain', '降雨'],
    sign: ['Circulation', '循环'],
    question: ['Where is it raining?', '哪里在下雨？'],
    quantity: ['Precipitation rate', '降水强度'],
    // American Meteorological Society rain intensity classes (light < 2.5, moderate 2.5–7.6, heavy > 7.6 mm/h)
    categories: [
      { max: 0.105, en: 'dry', zh: '无雨', level: 0 },   // the lowest stored code (0.1 mm/h) means dry or ≤ 0.1
      { max: 2.5, en: 'light rain', zh: '小雨', level: .33 },
      { max: 7.6, en: 'moderate rain', zh: '中雨', level: .66 },
      { max: Infinity, en: 'heavy rain', zh: '大雨', level: 1 }
    ],
    presence: 0.5,
    presets: [[3.14, 101.69], [1.55, 110.34], [5.98, 116.07], [-6.2, 106.85], [13.75, 100.5], [14.6, 120.98], [19.08, 72.88], [-3, -60], [51.5, -0.13]],
    fmt: v => `${v < 0.105 ? '0' : f1(v)} mm/h`,
    hear: [
      ['Raindrops: the more drops, the harder it rains where you are listening (1 a second in drizzle, up to 10 in a downpour).', '雨滴声：雨滴越密，聆听点的雨越大（毛毛雨每秒 1 滴，暴雨最多每秒 10 滴）。'],
      ['A soft low note joins in heavy rain (above 7.6 mm/h).', '大雨（超过 7.6 mm/h）时加入一个柔和的低音。'],
      ['A soft, low wash of rain nearby, from the side it lies on: left = west, right = east.', '附近有雨时会听到柔和的雨声，从雨所在的一侧传来：左边是西，右边是东。'],
      ['When there is no rain, the music stays open and bright.', '没有雨时，音乐保持开阔明亮。']
    ],
    legend: [0, 1.5, 12],
    scienceWhat: ['Rain rate from NASA\'s GEOS-FP weather model (analysis and short forecast), drawn by NASA\'s Earth Information Center every hour.', '数据来自 NASA GEOS-FP 天气模式（分析场与短期预报）的降水强度，由 NASA 地球信息中心每小时绘制。'],
    categorySource: ['Rain classes: American Meteorological Society (light < 2.5, moderate 2.5–7.6, heavy > 7.6 mm/h).', '雨量分级：美国气象学会（小雨 < 2.5，中雨 2.5–7.6，大雨 > 7.6 mm/h）。']
  },
  air: {
    id: 'air', no: '02', color: '#e0a36a',
    name: ['Air quality', '空气质量'],
    sign: ['Breathing', '呼吸'],
    question: ['How clean is the air you breathe?', '你呼吸的空气有多干净？'],
    quantity: ['Fine particles (PM2.5)', '细颗粒物（PM2.5）'],
    // Thresholds: the WHO 2021 guideline for 24-hour PM2.5 (15 µg/m³) and its interim targets 4, 2 and 1 (25, 50, 75).
    // The class names are Hearthbeat's own (WHO does not name classes); they say how high, not how unhealthy.
    categories: [
      { max: 15, en: 'within the WHO guideline', zh: '符合世卫组织指导值', level: 0 },
      { max: 25, en: 'above the WHO guideline', zh: '超过世卫组织指导值', level: .25 },
      { max: 50, en: 'high', zh: '偏高', level: .5 },
      { max: 75, en: 'very high', zh: '很高', level: .75 },
      { max: Infinity, en: 'extremely high', zh: '极高', level: 1 }
    ],
    presence: 35,
    presets: [[3.14, 101.69], [28.61, 77.21], [39.9, 116.4], [-6.2, 106.85], [23.81, 90.41], [13.75, 100.5], [30.04, 31.24], [51.5, -0.13], [64.15, -21.94]],
    fmt: v => `${f1(v)} µg/m³`,
    hear: [
      ['Clean air sounds clear and open. Dirtier air sounds muffled, as if through a mask.', '干净的空气听起来清澈开阔；越脏的空气越闷，像隔着口罩。'],
      ['Above the WHO guideline (15 µg/m³) a soft heartbeat joins in, two gentle wooden notes. The dirtier the air, the faster it beats: about 60 beats a minute just above the guideline, 140 at ten times it.', '超过世卫组织指导值（15 µg/m³）后加入轻柔的心跳声（两个温和的木琴音）。空气越脏，心跳越快：刚超过指导值时约每分钟 60 下，达到指导值十倍时约 140 下。'],
      ['Polluted air nearby is heard from its side: left = west, right = east.', '附近有污染时，从污染所在的一侧传来：左边是西，右边是东。']
    ],
    legend: [5, 30, 120],
    scienceWhat: ['Surface PM2.5 from NASA\'s GEOS-CF atmospheric composition model, drawn by NASA\'s Earth Information Center every hour. GEOS-CF is also the model behind NASA\'s air-quality visualization SVS 5533 in the challenge resources.', '数据来自 NASA GEOS-CF 大气成分模式的近地面 PM2.5，由 NASA 地球信息中心每小时绘制。比赛资源里 NASA 的空气质量可视化 SVS 5533 用的也是 GEOS-CF。'],
    categorySource: ['Air class thresholds: WHO 2021 guideline for 24-hour PM2.5 (15 µg/m³) and its interim targets (25, 50, 75). The class names are Hearthbeat\'s own. Model hours are compared with a daily guideline, so treat the class as a guide, not a health warning.', '空气分级的阈值：世卫组织 2021 年 PM2.5 24 小时指导值（15 µg/m³）及过渡目标（25、50、75）。分级名称是 Hearthbeat 自己取的。这里拿逐小时模式值对比日均指导值，分级仅供参考，不是健康警告。']
  },
  climate: {
    id: 'climate', no: '03', color: '#ff8a6b',
    name: ['Climate', '气候'],
    sign: ['Fever', '发烧'],
    question: ['How has our planet warmed since 1880?', '自 1880 年以来，地球变暖了多少？'],
    quantity: ['Temperature anomaly', '温度距平'],
    categories: [
      { max: -1, en: 'much colder than 1951–1980', zh: '比 1951–1980 年冷得多', level: 0 },
      { max: -0.25, en: 'colder than 1951–1980', zh: '比 1951–1980 年冷', level: .2 },
      { max: 0.25, en: 'close to the 1951–1980 average', zh: '接近 1951–1980 年平均', level: .4 },
      { max: 1, en: 'warmer than 1951–1980', zh: '比 1951–1980 年暖', level: .6 },
      { max: 2, en: 'much warmer than 1951–1980', zh: '比 1951–1980 年暖得多', level: .8 },
      { max: Infinity, en: 'extremely warm compared with 1951–1980', zh: '比 1951–1980 年极端偏暖', level: 1 }
    ],
    presence: 1,
    presets: [[3.14, 101.69], [80, 0], [72, -40], [62, 100], [-80, 0], [0, -150], [51.5, -0.13], [40.71, -74], [-33.87, 151.21]],
    fmt: v => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(2)} °C`,
    hear: [
      ['One note per year. Higher notes mean warmer than the 1951–1980 average where you are listening.', '每年一个音。音越高，表示聆听点比 1951–1980 年平均越暖。'],
      ['The soft held chord follows the whole planet\'s average; it rises as the Earth warms.', '柔和的持续和弦代表全球平均温度距平，地球变暖时它会升高。'],
      ['A soft tap instead of a note means no measurements there that year.', '如果某年只有轻轻的一下敲击而没有音符，表示那一年那里没有观测数据。']
    ],
    legend: [-1, 0, 2.5],
    scienceWhat: ['NASA GISTEMP v4: monthly surface temperature anomalies from weather stations and ships, averaged into years. Anomaly = difference from the 1951–1980 average.', 'NASA GISTEMP v4：由气象站与船舶观测得到的逐月地表温度距平，再计算年平均。距平 = 与 1951–1980 年平均值之差。'],
    categorySource: ['Climate classes are Hearthbeat\'s own bands around the 1951–1980 baseline, chosen to be easy to hear.', '气候分级是 Hearthbeat 自己围绕 1951–1980 基准划分的区间，便于用耳朵分辨。']
  },
  lights: {
    id: 'lights', no: '04', color: '#ffd27a',
    name: ['Night lights', '夜间灯光'],
    sign: ['Life', '生机'],
    question: ['Where are the lights on at night?', '夜里哪里亮着灯？'],
    quantity: ['Night light (relative index)', '夜间灯光（相对指数）'],
    // Hearthbeat's own classes on a relative index read from NASA's picture (the picture has no scale)
    categories: [
      { max: 1, en: 'dark', zh: '黑暗', level: 0 },
      { max: 8, en: 'a few lights', zh: '零星灯光', level: .33 },
      { max: 25, en: 'many lights', zh: '灯光较多', level: .66 },
      { max: Infinity, en: 'bright city lights', zh: '城市灯火', level: 1 }
    ],
    presence: 8,
    presets: [[3.14, 101.69], [-6.2, 106.85], [28.61, 77.21], [50.45, 30.52], [6.52, 3.38], [35.68, 139.69], [51.5, -0.13], [40.71, -74], [30.04, 31.24]],
    fmt: v => `${v < 1 ? '0' : v.toFixed(0)} /100`,
    hear: [
      ['Twinkles: the more light at night, the more twinkles. Where it is dark, only the soft night chord.', '星点声：夜里灯光越多，星点越密。黑暗的地方只有柔和的夜曲和弦。'],
      ['One year per step, 2012 to 2023: listen to a place grow brighter or darker.', '每一步是一年，2012 到 2023：听一个地方变亮还是变暗。']
    ],
    legend: [0, 6, 40],
    scienceWhat: ['Light at night seen from space: NASA/NOAA Black Marble annual composites (VIIRS on Suomi NPP), 2012–2023, from the Earth Information Center\'s night-lights visualization (SVS 5313). It shows where people live, and how that changes.',
      '从太空看到的夜间灯光：NASA/NOAA Black Marble 年度合成图（Suomi NPP 卫星上的 VIIRS 仪器），2012–2023 年，来自地球信息中心的夜间灯光可视化（SVS 5313）。它显示人住在哪里，以及怎样变化。'],
    categorySource: ['NASA\'s picture has no colour scale, so the value is a relative light index 0–100 read from it, not radiance. The classes are Hearthbeat\'s own.',
      'NASA 的画面没有色标，所以数值是从画面读出的相对灯光指数 0–100，不是辐亮度。分级是 Hearthbeat 自己定的。']
  },
  lightning: {
    id: 'lightning', no: '05', color: '#ffe066',
    name: ['Lightning', '闪电'],
    sign: ['Storms', '雷暴'],
    question: ['Where does the space station see lightning?', '空间站在哪里看到闪电？'],
    quantity: ['Lightning seen from the ISS', '国际空间站看到的闪电'],
    // Hearthbeat's own classes on the share of the area covered with NASA's lightning marks
    categories: [
      { max: 0.0105, en: 'no lightning seen', zh: '没看到闪电', level: 0 },   // the lowest stored code (0.01 %) means none
      { max: 1, en: 'a little lightning', zh: '偶尔有闪电', level: .33 },
      { max: 10, en: 'frequent lightning', zh: '闪电较多', level: .66 },
      { max: Infinity, en: 'very frequent lightning', zh: '闪电很多', level: 1 }
    ],
    presence: 1,
    presets: [[3.14, 101.69], [-2, 23], [9.8, -71.6], [28, -81], [-26.2, 28.05], [-12.46, 130.84], [39.9, 116.4], [51.5, -0.13], [-10, -140]],
    fmt: v => `${v < 0.0105 ? '0' : v < 1 ? v.toFixed(2) : v.toFixed(0)} %`,
    hear: [
      ['Soft wooden taps, like a marimba: the more lightning the space station saw here, the more taps. None where it saw none.', '轻柔的木琴声：空间站在这里看到的闪电越多，敲击越密。没看到闪电就没有。'],
      ['One step per month, January to December, averaged over 2017–2023: listen to the storms follow the summer.', '每一步是一个月，1 月到 12 月，2017–2023 年平均：听雷暴跟着夏天走。']
    ],
    legend: [0, 0.5, 25],
    scienceWhat: ['Lightning seen by the Lightning Imaging Sensor (LIS) on the International Space Station, 2017–2023, from NASA\'s visualization SVS 5011. The station flies between 52° north and south, so LIS sees no lightning beyond about 55°.',
      '国际空间站上的闪电成像传感器（LIS）看到的闪电，2017–2023 年，来自 NASA 可视化 SVS 5011。空间站在南北纬 52° 之间飞行，所以 LIS 看不到约 55° 以外的闪电。'],
    categorySource: ['NASA\'s picture marks every flash LIS saw. The value is the share of the area covered with those marks, averaged over each month\'s 10-day windows: a relative measure, since LIS sees each place for only about 90 seconds per pass. The classes are Hearthbeat\'s own.',
      'NASA 的画面标出 LIS 看到的每一次闪电。数值是被这些标记覆盖的面积占比，按每个月的 10 天窗口平均：这是相对量，因为 LIS 每次经过只看到一个地方约 90 秒。分级是 Hearthbeat 自己定的。']
  }
};

export function category(t: ThemeDef, v: number | null): Category | null {
  if (v == null) return null;
  return t.categories.find(c => v < c.max) ?? t.categories[t.categories.length - 1];
}
export const catName = (c: Category | null) => (c ? L(c.en, c.zh) : L('no data', '无数据'));
export const tname = (t: ThemeDef) => L(t.name[0], t.name[1]);
