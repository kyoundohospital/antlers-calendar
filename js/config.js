// ==== アプリ全体の設定・マスタデータ ====

// --- Firebase 設定（プレースホルダー） ---
// README.md の手順で Firebase プロジェクトを作成し、ここに実際の値を入れてください。
// 値を入れるまでは Firestore 連携は無効化され、観戦予定はブラウザのローカル保存のみで動作します。
export const FIREBASE_CONFIG = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
  projectId: 'YOUR_PROJECT_ID',
  storageBucket: 'YOUR_PROJECT_ID.appspot.com',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId: 'YOUR_APP_ID',
};

// spaceId: 推測困難な固定文字列（20文字程度）。README の手順で生成して置き換えてください。
export const SPACE_ID = 'REPLACE_WITH_RANDOM_SPACE_ID';

export const FIREBASE_CONFIGURED =
  FIREBASE_CONFIG.apiKey !== 'YOUR_API_KEY' && SPACE_ID !== 'REPLACE_WITH_RANDOM_SPACE_ID';

// --- 年度定義 ---
export const SEASON_START_MONTH = 4; // 4月開始固定

// date: 'YYYY-MM-DD' -> その日が属する年度（4月始まり）
export function seasonYearOf(dateStr) {
  const [y, m] = dateStr.split('-').map(Number);
  return m >= SEASON_START_MONTH ? y : y - 1;
}

// 年度の12か月を [{year, month}, ...] で返す（4月〜翌年3月）
export function monthsOfSeason(seasonYear) {
  const months = [];
  for (let i = 0; i < 12; i++) {
    const m = SEASON_START_MONTH + i;
    if (m <= 12) months.push({ year: seasonYear, month: m });
    else months.push({ year: seasonYear + 1, month: m - 12 });
  }
  return months;
}

// --- 大会名 略称表（3.3） ---
export const COMPETITION_ABBR = {
  '明治安田Ｊ１リーグ': 'J1',
  '明治安田Ｊ１百年構想リーグ': '百年',
  'Ｊリーグ ヤマザキビスケットルヴァンカップ': 'LC',
  'ルヴァンカップ': 'LC',
  '天皇杯': '天皇',
  'AFCチャンピオンズリーグエリート': 'ACLE',
  'ACL Elite': 'ACLE',
  'AFCチャンピオンズリーグ2': 'ACL2',
  'ACL Two': 'ACL2',
  'FUJIFILM SUPER CUP': 'SC',
  'プレシーズンマッチ': '練習',
  '親善試合': '親善',
};

export function competitionAbbr(name) {
  return COMPETITION_ABBR[name] || name.slice(0, 4);
}

// --- 会場名 略称表 ---
export const VENUE_ABBR = {
  'メルカリスタジアム': 'カシマ', // 2026年に命名権変更（旧: 県立カシマサッカースタジアム）
  '県立カシマサッカースタジアム': 'カシマ',
  '茨城県立カシマサッカースタジアム': 'カシマ',
  'ＭＵＦＧスタジアム': 'MUFG', // 横浜FMホーム（旧: 日産スタジアム）
  '国立競技場': '国立',
  '埼玉スタジアム2002': '埼スタ',
  'パナソニックスタジアム吹田': '吹田',
  '豊田スタジアム': '豊田',
  '味の素スタジアム': '味スタ',
  '日産スタジアム': '日産',
  'デンカビッグスワンスタジアム': 'デンカ',
  'ノエビアスタジアム神戸': '神戸',
  '未定': '未定',
};

export function venueAbbr(name) {
  if (!name) return '';
  return VENUE_ABBR[name] || name.slice(0, 4);
}

// --- 観戦場所 初期値（3.5） ---
export const DEFAULT_VIEWING_PLACES = [
  { id: 'local', name: '現地', shortLabel: '現', color: '#e53935', sortOrder: 0, isActive: true },
  { id: 'footnick', name: 'FOOTNICK', shortLabel: 'F', color: '#43a047', sortOrder: 1, isActive: true },
  { id: 'home', name: '自宅', shortLabel: '家', color: '#757575', sortOrder: 2, isActive: true },
  { id: 'dazn', name: 'DAZN', shortLabel: 'D', color: '#212121', sortOrder: 3, isActive: true },
  { id: 'undecided', name: '未定', shortLabel: '?', color: '#ffffff', sortOrder: 4, isActive: true },
  { id: 'other', name: 'その他', shortLabel: '他', color: '#8e24aa', sortOrder: 5, isActive: true },
];

// --- 試合ステータス表示ラベル ---
export const STATUS_LABEL = {
  scheduled: '予定',
  postponed: '延期',
  canceled: '中止',
  finished: '終了',
};
