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

// ---- 試合データのローカルキャッシュ ----
// 「取得」ボタンを押すまでは画面に反映しないため、直近に確定した試合データを
// ブラウザ内に保持しておく（起動のたびに無条件でJSONを反映しないようにする）
const BASE_MATCHES_CACHE_PREFIX = 'antlers-calendar:baseMatches:';

export function loadCachedBaseMatches(seasonYear) {
  try {
    const raw = localStorage.getItem(BASE_MATCHES_CACHE_PREFIX + seasonYear);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveCachedBaseMatches(seasonYear, matches) {
  try {
    localStorage.setItem(BASE_MATCHES_CACHE_PREFIX + seasonYear, JSON.stringify(matches));
  } catch {
    // localStorageが使えない環境では何もしない
  }
}

// ---- 差分検出 ----
// メタ情報（取得元・最終取得日時）は無視し、実質的な内容の変化だけを検出する
const DIFF_FIELDS = ['date', 'altDate', 'kickoffTime', 'competition', 'round', 'homeAway', 'opponent', 'venue', 'status', 'note'];

function fingerprint(m) {
  return DIFF_FIELDS.map((f) => m[f] ?? '').join('|');
}

export function diffMatches(oldList, newList) {
  const oldMap = new Map((oldList || []).map((m) => [m.id, m]));
  const newMap = new Map((newList || []).map((m) => [m.id, m]));
  const added = [];
  const changed = [];
  const removed = [];
  for (const [id, m] of newMap) {
    if (!oldMap.has(id)) {
      added.push(m);
    } else if (fingerprint(oldMap.get(id)) !== fingerprint(m)) {
      changed.push({ before: oldMap.get(id), after: m });
    }
  }
  for (const [id, m] of oldMap) {
    if (!newMap.has(id)) removed.push(m);
  }
  return { added, changed, removed };
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
