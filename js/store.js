// ユーザーデータ（観戦予定・観戦場所・手動試合・上書き）の永続化。
// Firebase未設定の間はブラウザの localStorage を使い、config.js に実際の
// Firebase設定を入れると自動的に Firestore（複数端末同期）に切り替わる。

import { FIREBASE_CONFIGURED, FIREBASE_CONFIG, SPACE_ID, DEFAULT_VIEWING_PLACES } from './config.js';

const FIREBASE_APP_URL = 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';
const FIREBASE_FIRESTORE_URL = 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

export const backendMode = FIREBASE_CONFIGURED ? 'firestore' : 'local';

function emptySeasonData(seasonYear) {
  return {
    seasonYear,
    viewingPlans: {},
    viewingPlaces: DEFAULT_VIEWING_PLACES.map((p) => ({ ...p })),
    manualMatches: [],
    matchOverrides: {},
    updatedAt: null,
  };
}

// ---- localStorage backend ----
const LS_PREFIX = 'antlers-calendar:season:';

function lsLoad(seasonYear) {
  const raw = localStorage.getItem(LS_PREFIX + seasonYear);
  if (!raw) return emptySeasonData(seasonYear);
  try {
    return { ...emptySeasonData(seasonYear), ...JSON.parse(raw) };
  } catch {
    return emptySeasonData(seasonYear);
  }
}

function lsSave(seasonYear, data) {
  const payload = { ...data, seasonYear, updatedAt: new Date().toISOString() };
  localStorage.setItem(LS_PREFIX + seasonYear, JSON.stringify(payload));
  return Promise.resolve(payload);
}

// ---- Firestore backend (遅延ロード) ----
let firestoreModulePromise = null;
async function loadFirestore() {
  if (!firestoreModulePromise) {
    firestoreModulePromise = (async () => {
      const appMod = await import(FIREBASE_APP_URL);
      const fsMod = await import(FIREBASE_FIRESTORE_URL);
      const app = appMod.initializeApp(FIREBASE_CONFIG);
      const db = fsMod.getFirestore(app);
      return { db, ...fsMod };
    })();
  }
  return firestoreModulePromise;
}

function seasonDocRef(db, mod, seasonYear) {
  return mod.doc(db, 'users', SPACE_ID, 'seasons', String(seasonYear));
}

async function fsLoad(seasonYear) {
  const { db, ...mod } = await loadFirestore();
  const snap = await mod.getDoc(seasonDocRef(db, mod, seasonYear));
  if (!snap.exists()) return emptySeasonData(seasonYear);
  return { ...emptySeasonData(seasonYear), ...snap.data() };
}

const debounceTimers = new Map();
function fsSave(seasonYear, data) {
  return new Promise((resolve, reject) => {
    clearTimeout(debounceTimers.get(seasonYear));
    const timer = setTimeout(async () => {
      try {
        const { db, ...mod } = await loadFirestore();
        const payload = { ...data, seasonYear, updatedAt: new Date().toISOString() };
        await mod.setDoc(seasonDocRef(db, mod, seasonYear), payload);
        resolve(payload);
      } catch (e) {
        reject(e);
      }
    }, 500);
    debounceTimers.set(seasonYear, timer);
  });
}

async function fsSubscribe(seasonYear, callback) {
  const { db, ...mod } = await loadFirestore();
  return mod.onSnapshot(seasonDocRef(db, mod, seasonYear), (snap) => {
    if (snap.exists()) callback({ ...emptySeasonData(seasonYear), ...snap.data() });
  });
}

// ---- 公開API ----
export async function loadSeasonUserData(seasonYear) {
  return FIREBASE_CONFIGURED ? fsLoad(seasonYear) : lsLoad(seasonYear);
}

// 連続入力時は数百ミリ秒まとめて書き込む（デバウンス）
export async function saveSeasonUserData(seasonYear, data) {
  return FIREBASE_CONFIGURED ? fsSave(seasonYear, data) : lsSave(seasonYear, data);
}

// ローカルモードでは購読対象がないため no-op の解除関数を返す
export async function subscribeSeasonUserData(seasonYear, callback) {
  if (!FIREBASE_CONFIGURED) return () => {};
  try {
    return await fsSubscribe(seasonYear, callback);
  } catch (e) {
    console.warn('Firestoreの購読に失敗しました', e);
    return () => {};
  }
}

export function emptySeasonDataFor(seasonYear) {
  return emptySeasonData(seasonYear);
}
