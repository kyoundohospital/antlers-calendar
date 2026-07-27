// 試合データの読み込みとマージ

export async function loadBaseMatches(seasonYear) {
  try {
    const res = await fetch(`data/matches_${seasonYear}.json`, { cache: 'no-store' });
    if (!res.ok) return [];
    const data = await res.json();
    return data.matches || [];
  } catch (e) {
    console.warn('試合データの読み込みに失敗しました', e);
    return [];
  }
}

// base（静的JSON） + matchOverrides（手動編集/非表示） + manualMatches（手動追加）を合成する
export function mergeMatches({ base, overrides, manual }) {
  const out = [];
  for (const m of base) {
    const ov = overrides ? overrides[m.id] : null;
    if (ov && ov.hidden) continue;
    out.push(ov ? { ...m, ...ov, id: m.id } : m);
  }
  for (const m of manual || []) {
    out.push(m);
  }
  return out;
}

export function groupByDate(matches) {
  const map = new Map();
  const add = (date, m) => {
    if (!date) return;
    if (!map.has(date)) map.set(date, []);
    map.get(date).push(m);
  };
  for (const m of matches) {
    // 日程未確定（土/日どちらか未定など）の試合は altDate 側のマスにも表示する
    add(m.date, m);
    if (m.altDate) add(m.altDate, m);
  }
  for (const list of map.values()) {
    list.sort((a, b) => (a.kickoffTime || '').localeCompare(b.kickoffTime || ''));
  }
  return map;
}

export function makeManualMatchId() {
  return 'manual-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
