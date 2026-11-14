/** "About the data": what each track shows, how its numbers are made, how accurate they are, and where they come from. */
import { $ } from '../core/util';
import { L, getLang } from '../core/i18n';
import { DATA, layer, type LayerEntry } from '../data/manifest';
import { THEMES, THEME_IDS, tname, type ThemeId } from '../themes';
import { whenLabel } from '../player';
import { homeSounds } from './home';
import { credit } from '../data/home-sounds';

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const link = (u?: string, txt?: string) => (u ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(txt ?? u)}</a>` : '');
/** Chinese for the English notes the data pipeline writes; the English original stays one tap away. */
const ZH_NOTES: Record<string, string> = {
  precip: 'GEOS-FP 降水率，只在画面上看得到雨色的地方读出。显示云、陆地或海洋的像素算作没有下雨，所以厚云下的雨会被低估。每格数值为 1° 格内的平均。以对数方式存储 0.1–20 mm/h；最低值 0.1 表示没下雨或不超过 0.1 mm/h。最新几步是短期预报。NASA 标志和日期标签下面的格子没有数据。',
  pm25: '地表细颗粒物（PM2.5）来自 NASA 的 GEOS-CF 大气成分模式，不是地面监测站。地球上显示的是 EIC 画面的颜色（空气越脏越不透明）；数值直接取自同一小时的 GEOS-CF 输出（先用分析场，最新几小时用最新预报），因为准确度测试发现画面颜色与它的色标不一致（从画面读出的数值约低 4 倍）。',
  temp: 'GEOS-FP 地面以上约 3 米的气温，限制在色标范围 −40…40 °C（−40 表示 −40 或更冷）。最新几步是短期预报。NASA 标志和日期标签下面的格子（部分西南极洲和北太平洋最北部）没有数据。',
  tanom: '数值是相对于每个格子 1951–1980 年平均的气温距平（°C），不是绝对气温（+1 表示比那个地方 1951–1980 年的平均暖 1 °C）。来源：GISTEMP v4（GHCN v4 陆地站加 ERSST v5 海表温度），2° 网格，每个站点的影响最远 1200 公里，所以远离站点的格子是插值得到的。年值是 1–12 月逐月距平的平均，一个格子至少要有 9 个月的数据，否则记为无数据。年份为 1880–2025（2026 年的文件只到 9 月，不完整，所以不用）。早期覆盖稀疏：1950 年以前，北极、南极、海冰附近的南大洋以及非洲和南美部分地区多为无数据（有数据的地球面积：1880 年 83%，1900 年 90%，1950 年 95%，2025 年 99%）。存储范围 −6…+6 °C，超出的 134 个格年被截到端值；画面色阶在 ±4 °C 饱和。深灰 = 无数据。全球序列是 NASA 自己算的全球陆海年平均（GLB.Ts+dSST.csv），不是这些格子的平均。'
};
ZH_NOTES.lights = '夜间灯光来自 NASA 的 Black Marble 年度合成图（Suomi NPP 卫星的 VIIRS 仪器，NASA/NOAA），读自 EIC 可视化 SVS 5313，2012–2023 年。画面没有色标，所以每个数值是 0–100 的相对灯光指数（100 = 一个 1° 格子全部是画面里最亮的颜色），不是辐亮度：比较地方和年份，不要看单位。画面取自 NASA 这段可视化的影片（它的单帧文件夹不公开）：每年取标着该年份那一段的中间一帧，再减去影片里没有灯光的底图。地图位置用 NASA Black Marble 2016 核对过。';
ZH_NOTES.lightning = '闪电来自国际空间站上的闪电成像传感器（LIS），读自 NASA 可视化 SVS 5011（用的是它的 Science On a Sphere 版本：一张普通世界地图，每一帧都有日期）。每 10 天取一帧，10 天窗口互不重叠；每个月份把标在该月的窗口跨年平均。每个数值是 1° 格子里被 NASA 闪电标记覆盖的面积占比（0–100%），是相对量：LIS 每次经过只看到一个地方约 90 秒，标记本身也有画出来的大小。NASA 的日期文件把 2023 写成了 2003；这些日期紧跟在 2022 年 12 月 31 日之后，按 2023 读。核对：地图位置与 NASA Blue Marble 对齐；南北纬 58° 以外几乎没有标记（空间站看不到那里）；北纬 30–50° 的闪电 6–8 月远多于 12–2 月，南纬 20–40° 相反。';
const ZH_TIMING: Record<string, string> = {
  precip: 'NASA 每小时发布一帧；Hearthbeat 每 6 小时取一帧。最新一帧的时间由画面的发布时间推定，并与画面上的美国东部日期标签核对。',
  pm25: 'NASA 每小时发布一帧；Hearthbeat 每 6 小时取一帧。最新一帧的时间由画面的发布时间推定，并与画面上的美国东部日期标签核对。',
  temp: 'NASA 每小时发布一帧；Hearthbeat 每 6 小时取一帧。最新一帧的时间由画面的发布时间推定，并与画面上的美国东部日期标签核对。',
  tanom: '1–12 月逐月距平的年平均。',
  lights: '夜间灯光的年平均；NASA 的可视化里每年一帧。',
  lightning: '每个月份跨 2017–2023 年平均，来自国际空间站 LIS 看到的闪电（10 天窗口）。'
};
const orig = (en: string) => `<details class="orig"><summary>${L('Original (English)', '英文原文')}</summary>${esc(en)}</details>`;
const zhOr = (zh: string | undefined, en: string) => (getLang() === 'zh' ? (zh ? `${esc(zh)} ${orig(en)}` : orig(en)) : esc(en));
const n2 = (x: unknown, d = 2) => (typeof x === 'number' && isFinite(x) ? x.toFixed(d) : '—');

function accuracyBlock(key: string, l: LayerEntry): string {
  const a = DATA.accuracy?.layers?.[key];
  const err = DATA.accuracy?.errors?.[key];
  if (l.picture?.mode === 'lightning') {
    const c = (l as LayerEntry & { check?: { positionR?: number; positionR2DegOff?: number; polarPct?: number; northSummerRatio?: number; southSummerRatio?: number } }).check;
    return `<p><span class="tag bad">${L('relative, not measured', '相对值，未测量')}</span>${L('The value is the share of the area covered with NASA\'s lightning marks, not a flash count: it says where and in which months the station saw more lightning, not how many flashes there were. Checks run on every build',
      '数值是被 NASA 闪电标记覆盖的面积占比，不是闪电次数：它说明空间站在哪里、哪几个月看到更多闪电，而不是有多少次。每次构建都会核对')}: ${L('map position against NASA Blue Marble', '地图位置与 NASA Blue Marble 对齐')}${c?.positionR != null ? ` (r = ${n2(c.positionR, 2)}${c.positionR2DegOff != null ? `, ${L('two degrees off', '偏 2° 时')} ${n2(c.positionR2DegOff, 2)}` : ''})` : ''}; ${L('marks beyond 58°', '58° 以外的标记')} ${n2(c?.polarPct, 2)}%; ${L('storms follow the summer', '雷暴跟着夏天走')} (${L('north', '北')} ${n2(c?.northSummerRatio, 0)}×, ${L('south', '南')} ${n2(c?.southSummerRatio, 0)}×).</p>`;
  }
  if (l.source.kind === 'eic-svs-movie') {
    const c = (l as LayerEntry & { check?: { positionR?: number; positionR2DegOff?: number } }).check;
    return `<p><span class="tag bad">${L('relative, not measured', '相对值，未测量')}</span>${L('NASA\'s picture has no colour scale, so the index cannot be checked against a physical value; it says which places and years are brighter, not by how many nanowatts. The map position was checked against NASA Black Marble 2016',
      'NASA 的画面没有色标，所以这个指数没法和物理数值对照；它说明哪些地方、哪些年份更亮，而不是亮多少纳瓦。地图位置用 NASA Black Marble 2016 核对过')}${c?.positionR != null ? ` (r = ${n2(c.positionR, 2)}${c.positionR2DegOff != null ? `, ${L('two degrees off', '偏 2° 时')} ${n2(c.positionR2DegOff, 2)}` : ''})` : ''}.</p>`;
  }
  if (l.source.kind === 'gistemp-netcdf') {
    return `<p>${L('These values are NASA\'s published numbers, read directly from the GISTEMP data file (no picture is decoded). The only rounding is the storage step of',
      '这些数值直接读取自 NASA GISTEMP 数据文件（不经过图像反算），唯一的舍入是存储精度')} ${n2((l.encoding.max - l.encoding.min) / 254 / 2, 3)} ${l.unit}. ${L('GISTEMP\'s own uncertainty is about ±0.05 °C for recent global annual means and larger for early years and sparse regions (Lenssen et al., 2019).',
      'GISTEMP 本身的不确定度：近年全球年均约 ±0.05 °C，早期年份和观测稀疏地区更大（Lenssen 等，2019）。')}</p>`;
  }
  if (l.source.values?.from === 'nasa-model-output') {
    const pic = a ? `${L('Reading the numbers from the picture instead was tested and rejected', '曾测试过从画面颜色反算数值，但未采用')}: ${L('against the same NASA output it gave', '与同一 NASA 输出相比')} r = ${n2(a.r, 2)}, ${L('bias', '偏差')} ${n2(a.bias)} ${esc(l.unit)} (${L('about 4× too low', '约低 4 倍')}) — ${L('the frame\'s colours do not follow its colorbar', '该画面的颜色与其色标不一致')}.` : '';
    return `<p><span class="tag ok">${L('NASA model values', 'NASA 模式数值')}</span>${L('The numbers you hear and read come directly from', '你听到和读到的数值直接来自')} ${esc(l.source.values.label ?? '')} (${esc(l.source.values.variable ?? '')}), ${L('sampled at each 1° cell centre at the same hour as the picture. The picture on the globe is the NASA EIC frame.', '在每个 1° 网格中心、与画面同一小时取值。地球上的画面是 NASA EIC 原始帧。')}</p>${pic ? `<p>${pic}</p>` : ''}`;
  }
  if (!a) {
    return `<p><span class="tag bad">${L('not measured', '未测量')}</span>${err ? esc(err) : L('The accuracy test (pipeline/hearthbeat_pipeline/accuracy.py) has not been run for this layer in this build.', '本次构建尚未对该图层运行准确度测试（pipeline/hearthbeat_pipeline/accuracy.py）。')}</p>`;
  }
  return `<p><span class="tag ok">${L('measured', '已测量')}</span>${L('Values recovered from the NASA picture were compared with NASA\'s raw model output at the same time and place', '把从 NASA 图像反算出的数值与同一时间、同一地点的 NASA 原始模式输出对比')} (${esc(a.raw?.dataset ?? '')} ${esc(a.raw?.variable ?? '')}${a.frameTime ? ', ' + esc(a.frameTime) : ''}).</p>
  <table><thead><tr><th>${L('points', '样本点')}</th><th>${L('bias', '偏差')}</th><th>${L('typical error (MAE)', '典型误差 (MAE)')}</th><th>RMSE</th><th>r</th><th>${L('90% of errors below', '90% 误差小于')}</th></tr></thead>
  <tbody><tr><td>${a.n ?? '—'}</td><td>${n2(a.bias)} ${esc(l.unit)}</td><td>${n2(a.mae)} ${esc(l.unit)}</td><td>${n2(a.rmse)} ${esc(l.unit)}</td><td>${n2(a.r, 3)}</td><td>${n2(a.p90AbsErr)} ${esc(l.unit)}</td></tr></tbody></table>
  ${a.notes ? `<p>${zhOr(undefined, a.notes)}</p>` : ''}${typeof a.bestOffsetHours === 'number' ? `<p>${L('Timing check: the best match with the raw data is at an offset of', '时间核对：与原始数据最吻合的时间偏移为')} ${a.bestOffsetHours} h.</p>` : ''}`;
}

function themeSection(id: ThemeId): string {
  const t = THEMES[id], key = DATA.manifest?.themes[id]?.layer ?? '', l = layer(key);
  if (!l) {
    return `<section class="sec"><h3>${t.no} · ${esc(tname(t))}</h3><p><span class="tag bad">${L('unavailable', '不可用')}</span>${esc(DATA.manifest?.errors[key] ?? L('Not in this data build.', '本次数据构建中没有。'))}</p></section>`;
  }
  const how = l.picture?.mode === 'lightning'
    ? L('One step per calendar month, January to December. From NASA\'s visualization of lightning seen by LIS on the ISS (SVS 5011, its Science On a Sphere copy: a plain world map with a date for every frame), one frame every 10 days, so each 10-day window is counted once. The yellow marks are measured in each 1° cell, and the windows labelled in each month are averaged over 2017–2023. The globe shows those marks on a night-time Earth, as NASA draws them on a dark one.',
      '每个月份一步，1 月到 12 月。来自 NASA 对国际空间站 LIS 看到的闪电的可视化（SVS 5011，用它的 Science On a Sphere 版本：一张普通世界地图，每帧都有日期），每 10 天取一帧，所以每个 10 天窗口只算一次。在每个 1° 格子里量黄色标记，再把标在每个月的窗口跨 2017–2023 年平均。地球上把这些标记显示在夜晚的地球上，就像 NASA 画在暗色地球上一样。')
    : l.source.kind === 'eic-svs-movie'
    ? L('One step per year, 2012–2023: for each year, the frame of NASA\'s EIC night-lights visualization (SVS 5313) labelled with that year, taken from NASA\'s movie of it (its frame folder is not public). The base map without lights, also in the movie, is subtracted; what is left is the light, averaged over each 1° cell as an index 0–100. The globe shows those lights on a night-time Earth.',
      '每年一步，2012–2023：每年取 NASA EIC 夜间灯光可视化（SVS 5313）里标着该年份的一帧，来自 NASA 的这段影片（单帧文件夹不公开）。减去影片里没有灯光的底图后，剩下的就是灯光，在每个 1° 格子里平均成 0–100 的指数。地球显示的是夜晚的地球上的这些灯光。')
    : l.source.kind === 'eic-svs-frames'
    ? L(`Every ${l.time.cadence === 'PT6H' ? 'six hours' : 'step'}, Hearthbeat takes NASA's own published frame of this visualization. For the globe, the data colours are lifted off the frame's flat background${l.picture?.mode === 'rain-clouds' ? ' (rain in NASA\'s colours, and the frame\'s clouds as white)' : ', more opaque where the value is higher'} and laid over NASA Blue Marble, lit by the sun at that hour; in daylight the colours are exactly NASA\'s. To hear it, the pipeline reads the visualization's colour legend (colorbar) and turns each pixel's colour back into the value it stands for, then takes the median (or mean, for rain) over each 1° × 1° cell. Pixels that are not a legend colour — coastlines, labels, the NASA logo — are skipped.`,
      `每${l.time.cadence === 'PT6H' ? '六小时' : '一步'}，Hearthbeat 取 NASA 发布的这一可视化的原始画面。地球上显示的是从画面平面底图上分离出的数据颜色${l.picture?.mode === 'rain-clouds' ? '（降雨保留 NASA 原色，画面中的云显示为白色）' : '，数值越高越不透明'}，叠在按当时太阳位置照亮的 NASA Blue Marble 上；白天一侧的颜色与 NASA 原图完全一致。为了让它发声，数据管线读取该可视化的色标，把每个像素的颜色还原为它代表的数值，再在每个 1° × 1° 网格内取中位数（降雨取平均）。不是色标颜色的像素（海岸线、文字、NASA 标志）会被跳过。`)
    : L('One step per year: the annual mean of NASA GISTEMP v4 monthly anomalies on its native 2° grid. The colour on the globe is drawn by Hearthbeat from those numbers with a blue–white–red scale, more opaque the further from normal (grey veil = no data), over NASA Blue Marble lit evenly.',
      '每年一步：NASA GISTEMP v4 逐月距平在其原始 2° 网格上的年平均。地球上的颜色由 Hearthbeat 根据这些数值、用蓝—白—红色阶绘制，偏离正常越多越不透明（灰色薄层 = 没有数据），叠在均匀照亮的 NASA Blue Marble 上。');
  return `<section class="sec">
  <h3>${t.no} · ${esc(tname(t))} — ${esc(L(t.question[0], t.question[1]))}</h3>
  <p>${esc(L(t.scienceWhat[0], t.scienceWhat[1]))}</p>
  <h4>${L('What you hear', '你听到的')}</h4>
  <ul>${t.hear.map(h => `<li>${esc(L(h[0], h[1]))}</li>`).join('')}</ul>
  <p>${esc(L(t.categorySource[0], t.categorySource[1]))}</p>
  <h4>${L('How the numbers are made', '数值如何得到')}</h4>
  <p>${how}</p>
  <h4>${L('How accurate', '准确度')}</h4>
  ${accuracyBlock(key, l)}
  <h4>${L('Limitations', '局限')}</h4>
  <p>${zhOr(ZH_NOTES[key], l.notes)}</p>
  <h4>${L('Source', '来源')}</h4>
  <table><tbody>
   <tr><th>${L('Dataset', '数据集')}</th><td>${esc(l.title)} — ${esc(l.source.agency ?? '')} ${esc(l.source.product ?? '')}</td></tr>
   <tr><th>${L('Page', '页面')}</th><td>${link(l.source.page)}</td></tr>
   <tr><th>${L('Steps', '时间步')}</th><td>${l.steps.length}: ${esc(whenLabel(l, 0))} – ${esc(whenLabel(l, l.steps.length - 1))}</td></tr>
   ${l.time.timing ? `<tr><th>${L('Timing', '时间')}</th><td>${zhOr(ZH_TIMING[key], l.time.timing)}</td></tr>` : ''}
   <tr><th>${L('Colour legend', '色标')}</th><td>${esc(String(l.colorbar.min))} – ${esc(String(l.colorbar.max))} ${esc(l.unit)} (${esc(l.colorbar.scale === 'log' ? L('log', '对数') : l.colorbar.scale === 'linear' ? L('linear', '线性') : l.colorbar.scale)}) ${link(l.colorbar.source, L('original', '原图'))}</td></tr>
   <tr><th>${L('Cite', '引用')}</th><td>${esc(l.source.citation ?? '')}</td></tr>
  </tbody></table>
  </section>`;
}

/** Together: where the space station's position comes from, and how it was checked. */
function stationSection() {
  const st = DATA.manifest?.station;
  const span = st?.start && st?.stop ? `${esc(st.start.slice(0, 16).replace('T', ' '))} – ${esc(st.stop.slice(0, 16).replace('T', ' '))} UTC` : '—';
  return `<section class="sec"><h3>${L('The space station (Together)', '空间站（一起听）')}</h3>
  <p>${L('Signed in, the app shows where the International Space Station is now, and "Hear both sides" plays the next 16 minutes of its path: NASA\'s rain and air under the ground track, from the same EIC data as the tracks, and soft marimba taps where the station\'s own lightning sensor (LIS) saw lightning in this calendar month, 2017–2023 (track 05). The position comes from NASA\'s predicted ISS trajectory (state vectors every 4 minutes in the J2000 frame, about 15 days ahead), interpolated and turned into latitude and longitude in the browser. Checked against the file itself: at the ascending-node times NASA lists, the app\'s latitude is 0.00° and its longitude matches NASA\'s to 0.001°. Outside the file\'s dates the app shows no position rather than a guess. The sign-in is a demo with no accounts; nothing is sent anywhere.',
    '登录后，应用会显示国际空间站此刻的位置；“听两边”会播放它接下来 16 分钟的路径：空间站正下方 NASA 的雨和空气，与曲目用的是同一套 EIC 数据；空间站自己的闪电传感器（LIS）在这个月份（2017–2023）看到闪电的地方，会有轻柔的木琴敲击（第 05 首）。位置来自 NASA 预测的空间站轨道（J2000 坐标系，每 4 分钟一个位置和速度，约覆盖 15 天），在浏览器里插值并换算成经纬度。用文件本身核对：在 NASA 列出的升交点时刻，应用算出的纬度是 0.00°，经度与 NASA 给的相差不到 0.001°。超出文件日期时，应用不显示位置，而不是猜一个。登录只是演示，没有账号，也不会发送任何信息。')}</p>
  <table><tbody>
   <tr><th>${L('Source', '来源')}</th><td>${st?.source ? link(st.source, 'NASA JSC (TOPO): ISS.OEM_J2K_EPH.txt') : L('not in this build', '本版本没有')}</td></tr>
   <tr><th>${L('Covers', '覆盖')}</th><td>${span}</td></tr>
   ${st?.created ? `<tr><th>${L('Made by NASA', 'NASA 生成于')}</th><td>${esc(st.created)}</td></tr>` : ''}
  </tbody></table></section>`;
}

export function renderAbout() {
  const m = DATA.manifest, v = DATA.validation;
  const status = v ? (v.ok ? `<span class="tag ok">${L('data files checked', '数据文件已校验')}</span>` : `<span class="tag bad">${L('validation failed', '校验失败')}</span>`) : `<span class="tag">${L('no validation report', '无校验报告')}</span>`;
  $('aboutBody').innerHTML = `
  <section class="sec first"><h3>${L('Why Hearthbeat exists', '为什么做 Hearthbeat')}</h3>
  <p>${L('<b>The story.</b> From the space station, astronauts can see home but cannot hear it. Astronaut Scott Kelly, who spent a year on the station, wrote that his crewmates played a recording of Earth sounds — birds, rustling trees, even mosquitoes — over and over (<i>The New York Times</i>, March 2020). A student who cannot see can hear, but NASA shows home only as colour maps. The name says what Hearthbeat is for: a <i>hearth</i> is the heart of a home, so Hearthbeat is the heartbeat of home.',
    '<b>故事。</b>宇航员在空间站上看得见家，却听不见。在空间站住了一年的宇航员 Scott Kelly 写过，他的同事会一遍又一遍地播放一段地球声音的录音：鸟叫、树叶沙沙声，甚至还有蚊子声（《纽约时报》，2020 年 3 月）。看不见的学生听得见，可是 NASA 只用彩色地图展示家乡。名字说明了 Hearthbeat 的用途：<i>hearth</i>（壁炉）是一个家的中心，Hearthbeat 就是“家的心跳”。')}</p>
  <p>${L('Hearthbeat is an independent project made for the NASA Space Apps Challenge 2026. It is not a NASA system, and the astronaut sign-in is a demo: there are no accounts.', 'Hearthbeat 是为 2026 年 NASA Space Apps Challenge 做的独立项目，不是 NASA 的系统；宇航员登录只是演示，并没有真正的账号。')}</p>
  <p>${L('<b>Problem.</b> NASA shows the condition of our planet as colour maps. At least 2.2 billion people live with a vision impairment (WHO, 2019); a student who cannot see the map has to wait for someone to describe it, and a daily NASA map cannot be turned into a tactile copy every day.',
    '<b>问题。</b>NASA 用彩色地图展示地球的状况。全球至少有 22 亿人有视力损伤（世卫组织，2019）；看不见地图的学生只能等别人描述，而每天更新的 NASA 地图不可能每天都做成触觉图。')}</p>
  <p>${L('<b>What you can do.</b> <b>Home</b>: choose your home and hear it — a home with someone cooking, then NASA\'s latest rain on its window, then the air as a heartbeat — or press a question — is it raining, is the air clean, how much warmer than 1951–1980 — to hear NASA\'s answer as a short sound, then read the number. Compare home with any other city. <b>Check-ups</b>: four questions for class, each checked against the data, timed and logged, so a listening test can be run with the app itself. <b>Explore</b>: move the listening point anywhere on Earth.',
    '<b>能做什么。</b><b>家</b>：选你的家，听听家里——先是家里有人炒菜，然后是 NASA 最新数据里落在窗上的雨，然后是变成心跳的空气——或者按一个问题——在下雨吗、空气干净吗、比 1951–1980 年暖了多少——先听 NASA 的答案（一段短声音），再看数字；还可以把家和任何城市对比。<b>检查</b>：四个课堂问题，答案按数据核对、计时并记录，可直接用来做聆听测试。<b>探索</b>：把聆听点移到地球任何地方。')}</p>
  <p>${L('<b>How the sounds work.</b> Like a stethoscope, each sound is one vital sign: raindrops for rain (more drops, harder rain), a heartbeat for the air (faster, dirtier), and one note per year or decade for warming (higher, warmer). In “hear home” the sounds of a home play underneath. They are recordings, not data: the data is the rain on the window and the heartbeat, and dirtier air also shuts the room in (muffled and farther away), as if the windows were closed. A switch turns the home sounds off to hear the data alone.',
    '<b>声音怎么理解。</b>就像听诊器，每种声音是一项生命体征：雨滴代表降雨（越密雨越大），心跳代表空气（越快越脏），每年或每十年一个音代表变暖（越高越暖）。在“听听家里”里，底下还有一个家的声音。那是录音，不是数据：数据是窗上的雨滴和心跳；空气越脏，家里的声音也越闷、越远，像关上了窗。有一个开关可以关掉家里的声音，只听数据。')}</p>
  <table><thead><tr><th>${L('For', '对象')}</th><th>${L('What they get', '得到什么')}</th><th>${L('How it could be sustained (proposed; no organisation contacted yet)', '可以如何持续（设想，尚未接洽任何机构）')}</th></tr></thead><tbody>
    <tr><td>${L('Schools and special-education classes', '学校与特殊教育班')}</td><td>${L('The web app and check-ups; a phone and headphones are enough', '网页应用与检查任务；一部手机加耳机即可')}</td><td>${L('Free', '免费')}</td></tr>
    <tr><td>${L('Science centres, planetariums, EIC screens', '科学馆、天文馆、EIC 展示屏')}</td><td>${L('An audio layer and check-up kiosk for Earth exhibits', '地球展品的声音层与检查互动站')}</td><td>${L('Yearly venue licence', '场馆年度授权')}</td></tr>
    <tr><td>${L('Agencies, publishers, universities', '政府机构、出版商、大学')}</td><td>${L('The engine: an equirectangular map whose colours follow its colorbar becomes explorable sound, with a measured accuracy report (of five EIC layers tried, two were usable, one needed model output for its numbers, two could not be used)', '引擎：颜色与色标一致的等经纬度地图可以变成可探索的声音，并附实测准确度报告（试过 5 个 EIC 图层：2 个可用，1 个要改用模式输出的数值，2 个不可用）')}</td><td>${L('API / SDK licence (accessibility law: EU Accessibility Act since June 2025; US ADA Title II web rule)', 'API / SDK 授权（无障碍法规：欧盟《无障碍法案》2025 年 6 月起适用；美国 ADA Title II 网页规则）')}</td></tr>
  </tbody></table>
  <p>${L('Classroom pack for teachers (PDF): a 40-minute lesson, four check-up cards in large print, a listening-test guide and a tactile map for swell paper.', '教师课堂资料包（PDF）：40 分钟课堂、四张大字检查卡、聆听测试指南和热敏膨胀纸触觉地图。')}
    <a href="classroom/hearthbeat-classroom-pack-en.pdf" target="_blank" rel="noopener">${L('English', '英文版')}</a> · <a href="classroom/hearthbeat-classroom-pack-zh.pdf" target="_blank" rel="noopener" lang="zh">${L('Chinese', '中文版')}</a></p></section>
  <p>${L('Every value you see or hear comes from NASA data. Nothing is simulated: if a dataset cannot be loaded, its track is switched off and says why. The colours on the globe are NASA\'s own (lifted off the EIC frames for Rain and Air quality, read from NASA\'s visualizations for Night lights and Lightning) or drawn from NASA numbers (Climate), over NASA Blue Marble.',
    '你看到和听到的每个数值都来自 NASA 数据，没有任何模拟。如果某个数据集无法载入，对应曲目会被关闭并说明原因。地球上的颜色来自 NASA 原图（降雨、空气质量从 EIC 帧中分离；夜间灯光、闪电读自 NASA 的可视化），或根据 NASA 数值绘制（气候），底图为 NASA Blue Marble。')}</p>
  <p>${status} ${L('Data built', '数据构建于')} ${esc(m?.generated ?? '—')}${v?.checked ? ` · ${L('checked', '校验于')} ${esc(v.checked)}` : ''}${v && v.warnings.length ? ` · ${v.warnings.length} ${L('warnings', '条提醒')}` : ''}</p>
  ${THEME_IDS.map(themeSection).join('')}
  <section class="sec"><h3>${L('Sound design', '声音设计')}</h3>
  <p>${L('Each track maps one variable to sound in the direction most people expect: more rain = more drops, dirtier air = more muffled (and a heartbeat above the WHO guideline), warmer = higher. In Explore and the check-ups, a soft wash on the left or right tells which side nearby rain or dirty air lies on. "Precise" mode replaces the music with a single tone whose pitch is the value, for careful comparison. Exact numbers are always available by voice (Enter), so nobody has to guess a number by ear. The sounds are meant to be warm, never eerie: major keys only, round wooden and music-box tones, no noise bursts or deep thuds, and a short, light reverb. Like NASA\'s sonification of the star cluster Caldwell 73 (SVS 13786, one of the challenge resources), which gives each kind of star its own instrument, Hearthbeat gives each kind of data its own voice: drops, a heartbeat, notes, twinkles and marimba taps. The home song plays all five at once for one place, in one key (D major) and one tempo: two bars of chords, then the warming as the melody (one note per decade since the 1880s, higher = warmer) and each other voice joining two bars apart, then all five together. Every note is taken from the bar\'s chord; how much of each voice you hear is still the data.',
    '每首曲目把一个变量映射成声音，方向符合直觉：雨越大雨滴越密，空气越脏声音越闷（超过世卫组织指导值时加入心跳声），越暖音越高。在探索和检查里，附近的雨或脏空气在哪一侧，左边或右边就有一层轻柔的沙沙声。“精确”模式把音乐换成单一音调，音高就是数值，方便仔细比较。按 Enter 随时可以听到准确数字，不需要靠耳朵猜。声音追求温暖而不吓人：只用大调，用圆润的木琴和八音盒音色，没有噪音爆破或低沉的重击，混响短而轻。和 NASA 对星团 Caldwell 73 的声音化（SVS 13786，比赛资源之一）一样：那里每类星星有自己的乐器，Hearthbeat 让每种数据有自己的声音：雨滴、心跳、音符、星点和木琴敲击。“家的歌”把一个地方的五首同时演奏，用同一个调（D 大调）和同一个速度：先两小节和弦，然后变暖成为旋律（从 1880 年代起每十年一个音，越高越暖），其他声音每隔两小节加入一个，最后五个一起。每个音都取自那一小节的和弦；每个声音有多少，仍然由数据决定。')}</p></section>
  <section class="sec"><h3>${L('Sounds of a home', '家里的声音')}</h3>
  <p>${L('Public-domain recordings from Wikimedia Commons, trimmed and filtered. None contains a person\'s voice. They are not data and not your own home.', 'Wikimedia Commons 上的公有领域录音，经过剪裁和滤波，里面没有任何人的声音。它们不是数据，也不是你家的录音。')}</p>
  ${homeSounds().length ? `<ul class="credits">${homeSounds().map(c => `<li>${L(c.en, c.zh)}: ${link(c.source, c.title)} — ${esc(c.author)}, ${c.licenseUrl ? link(c.licenseUrl, c.license) : esc(c.license === 'Public domain' ? L(c.license, '公有领域') : c.license)}. ${esc(L(c.excerpt, c.zhExcerpt ?? c.excerpt))}; ${esc(L(c.changes, c.zhChanges ?? c.changes))}.</li>`).join('')}</ul>`
    : `<p>${L('No home recordings are loaded, so “hear home” plays the data alone.', '没有载入家里的录音，所以“听听家里”只播放数据。')}</p>`}
  <p class="micro">${L('Credit text', '署名文字')}: ${esc(homeSounds().map(credit).join(' '))}</p></section>
  ${stationSection()}
  <section class="sec"><h3>${L('Imagery and credits', '影像与致谢')}</h3>
  <p>${L('Base Earth: NASA Blue Marble and Black Marble (Visible Earth). Coastline mask: Natural Earth. Libraries: three.js, d3-geo, topojson-client.', '底图：NASA Blue Marble 与 Black Marble（Visible Earth）。海岸线：Natural Earth。程序库：three.js、d3-geo、topojson-client。')}</p></section>`;
}
