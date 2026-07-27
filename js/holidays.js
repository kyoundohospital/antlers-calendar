// 日本の祝日を計算で求めるモジュール（内蔵計算方式）
// 対応範囲: 1980-2099年（春分・秋分の近似式の有効範囲）
// 振替休日・国民の休日（前後を祝日に挟まれた平日）にも対応。
//
// 参考にした規則:
// - 固定日の祝日（元日・建国記念の日・天皇誕生日・憲法記念日・みどりの日・こどもの日・山の日・文化の日・勤労感謝の日）
// - 第n月曜日の祝日（成人の日=1月第2月曜、海の日=7月第3月曜、敬老の日=9月第3月曜、スポーツの日=10月第2月曜）
// - 春分の日・秋分の日は天文計算に基づく近似式（国立天文台の暦要項が確定するまでの概算値）
//
// 注意: 春分・秋分の日は前年2月の官報公示で確定する。本モジュールの値は近似式による
// 概算であり、まれに実際の公示と1日ずれる可能性がある（要件定義書 12.残課題 に対応）。

function nthMonday(year, month, n) {
  // month: 1-12, n: 第n月曜
  const d = new Date(year, month - 1, 1);
  const firstDow = d.getDay(); // 0=Sun
  const offset = (8 - firstDow) % 7; // 最初の月曜日までの日数
  const day = 1 + offset + (n - 1) * 7;
  return new Date(year, month - 1, day);
}

function shunbun(year) {
  // 春分の日 近似式（1980-2099年）
  const day = Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  return new Date(year, 2, day); // 3月
}

function shuubun(year) {
  // 秋分の日 近似式（1980-2099年）
  const day = Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  return new Date(year, 8, day); // 9月
}

function toKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// year: 祝日を計算する対象の西暦年
function baseHolidays(year) {
  const list = [];
  const add = (date, name) => list.push({ date, name });

  add(new Date(year, 0, 1), '元日');
  add(nthMonday(year, 1, 2), '成人の日');
  if (year >= 1967) {
    add(new Date(year, 1, 11), '建国記念の日');
  }
  if (year >= 2020) {
    add(new Date(year, 1, 23), '天皇誕生日');
  }
  add(shunbun(year), '春分の日');
  add(new Date(year, 3, 29), '昭和の日');
  add(new Date(year, 4, 3), '憲法記念日');
  add(new Date(year, 4, 4), 'みどりの日');
  add(new Date(year, 4, 5), 'こどもの日');
  // 海の日（2016年〜、2020/2021はオリンピック特例で日付変更）
  if (year === 2020) {
    add(new Date(year, 6, 23), '海の日');
  } else if (year === 2021) {
    add(new Date(year, 6, 22), '海の日');
  } else if (year >= 2016) {
    add(nthMonday(year, 7, 3), '海の日');
  }
  // 山の日（2016年〜、2020/2021はオリンピック特例で日付変更）
  if (year === 2020) {
    add(new Date(year, 7, 10), '山の日');
  } else if (year === 2021) {
    add(new Date(year, 7, 8), '山の日');
  } else if (year >= 2016) {
    add(new Date(year, 7, 11), '山の日');
  }
  // 敬老の日（2003年〜、第3月曜）
  add(nthMonday(year, 9, 3), '敬老の日');
  add(shuubun(year), '秋分の日');
  // スポーツの日（2020年〜、旧体育の日は10月第2月曜）
  if (year === 2020) {
    add(new Date(year, 6, 24), 'スポーツの日');
  } else if (year === 2021) {
    add(new Date(year, 6, 23), 'スポーツの日');
  } else if (year >= 2020) {
    add(nthMonday(year, 10, 2), 'スポーツの日');
  } else if (year >= 2000) {
    add(nthMonday(year, 10, 2), '体育の日');
  }
  add(new Date(year, 10, 3), '文化の日');
  add(new Date(year, 10, 23), '勤労感謝の日');

  return list.filter((h) => h.name);
}

function applyTransferAndNational(list) {
  // 振替休日: 日曜が祝日の場合、直後の祝日でない日を振替休日とする
  // 国民の休日: 前後を祝日に挟まれた平日を休日とする
  const map = new Map();
  for (const h of list) map.set(toKey(h.date), h.name);

  const dates = [...map.keys()].sort();
  const added = [];

  // 振替休日
  for (const key of dates) {
    const d = new Date(key);
    if (d.getDay() === 0) {
      let next = new Date(d);
      do {
        next.setDate(next.getDate() + 1);
      } while (map.has(toKey(next)));
      added.push({ date: new Date(next), name: '振替休日' });
    }
  }
  for (const a of added) map.set(toKey(a.date), a.name);

  // 国民の休日（前日・翌日が祝日で、当日が祝日でも日曜でもない平日）
  const sortedKeys = [...map.keys()].sort();
  const nationalAdded = [];
  for (const key of sortedKeys) {
    const d = new Date(key);
    const next = new Date(d);
    next.setDate(next.getDate() + 2);
    const between = new Date(d);
    between.setDate(between.getDate() + 1);
    if (
      map.has(toKey(d)) &&
      map.has(toKey(next)) &&
      !map.has(toKey(between)) &&
      between.getDay() !== 0
    ) {
      nationalAdded.push({ date: between, name: '国民の休日' });
    }
  }
  for (const a of nationalAdded) {
    if (!map.has(toKey(a.date))) map.set(toKey(a.date), a.name);
  }

  return map;
}

const cache = new Map(); // year -> Map(dateKey -> name)

function holidayMapForYear(year) {
  if (cache.has(year)) return cache.get(year);
  const base = baseHolidays(year);
  const map = applyTransferAndNational(base);
  cache.set(year, map);
  return map;
}

// dateStr: 'YYYY-MM-DD' -> 祝日名 or null
export function getHolidayName(dateStr) {
  const year = Number(dateStr.slice(0, 4));
  // 振替休日が翌年1月にまたがるケアのため前年分も見る
  const maps = [holidayMapForYear(year - 1), holidayMapForYear(year), holidayMapForYear(year + 1)];
  for (const m of maps) {
    if (m.has(dateStr)) return m.get(dateStr);
  }
  return null;
}

export function isHoliday(dateStr) {
  return getHolidayName(dateStr) !== null;
}
