// ユーザーデータ（観戦予定・観戦場所・手動試合・上書き）とログイン・メンバー管理の永続化。
// Firebase未設定の間はブラウザの localStorage を使い（1人用）、config.js に実際の
// Firebase設定を入れると Firestore + Googleログイン（複数人で共有）に切り替わる。
//
// Firestore の構成（SPACE_ID ごと）:
//   users/{SPACE_ID}/meta/members           許可リスト { emails: [...], admins: [uid...] }
//   users/{SPACE_ID}/profiles/{uid}         各メンバーの表示名 { name, label, email }
//   users/{SPACE_ID}/seasons/{年度}          全員で共有するデータ（観戦場所・手動試合・試合の上書き）
//   users/{SPACE_ID}/seasons/{年度}/plans/{uid}  各メンバーの観戦予定 { plans: { matchId: {...} } }

import { FIREBASE_CONFIGURED, FIREBASE_CONFIG, SPACE_ID, DEFAULT_VIEWING_PLACES } from './config.js';

const FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/10.13.2';

export const backendMode = FIREBASE_CONFIGURED ? 'firestore' : 'local';

const LOCAL_USER = { uid: 'local', email: '', name: '自分' };

function emptySeasonData(seasonYear) {
  return {
    seasonYear,
    viewingPlaces: DEFAULT_VIEWING_PLACES.map((p) => ({ ...p })),
    manualMatches: [],
    matchOverrides: {},
    updatedAt: null,
  };
}

export function defaultLabel(name) {
  return Array.from((name || '?').trim())[0] || '?';
}

// ---- localStorage backend ----
const LS_PREFIX = 'antlers-calendar:season:';
const LS_PLANS_PREFIX = 'antlers-calendar:plans:';

function lsRead(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function lsWrite(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorageが使えない環境では保存しない
  }
}

// Firestore の setDoc(..., { merge: true }) と同じく、オブジェクトは項目ごとに、配列などはまるごと置き換える
function deepMerge(base, patch) {
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = isObj(v) && isObj(base[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

// ---- Firebase（遅延ロード） ----
let firebasePromise = null;
function loadFirebase() {
  if (!firebasePromise) {
    firebasePromise = (async () => {
      const [appMod, fs, authMod] = await Promise.all([
        import(`${FIREBASE_SDK}/firebase-app.js`),
        import(`${FIREBASE_SDK}/firebase-firestore.js`),
        import(`${FIREBASE_SDK}/firebase-auth.js`),
      ]);
      const app = appMod.initializeApp(FIREBASE_CONFIG);
      return { fs, db: fs.getFirestore(app), authMod, auth: authMod.getAuth(app) };
    })();
  }
  return firebasePromise;
}

const spaceDoc = (fs, db, ...path) => fs.doc(db, 'users', SPACE_ID, ...path);

// ---- ログイン ----

// ログイン状態が変わるたびに callback(user | null) を呼ぶ
export async function watchAuth(callback) {
  if (!FIREBASE_CONFIGURED) {
    callback(LOCAL_USER);
    return () => {};
  }
  const { authMod, auth } = await loadFirebase();
  return authMod.onAuthStateChanged(auth, (u) => {
    callback(u ? { uid: u.uid, email: (u.email || '').toLowerCase(), name: u.displayName || u.email || '' } : null);
  });
}

export async function signIn() {
  const { authMod, auth } = await loadFirebase();
  const provider = new authMod.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  await authMod.signInWithPopup(auth, provider);
}

export async function signOut() {
  if (!FIREBASE_CONFIGURED) return;
  const { authMod, auth } = await loadFirebase();
  await authMod.signOut(auth);
}

// ---- メンバー（許可リスト） ----

// 'member'（利用可）/ 'bootstrap'（許可リスト未作成＝最初の管理者を登録できる）/ 'denied'（許可リストに無い）
export async function checkMembership(user) {
  if (!FIREBASE_CONFIGURED) return { status: 'member', members: { emails: [], admins: [LOCAL_USER.uid] } };
  const { fs, db } = await loadFirebase();
  try {
    const snap = await fs.getDoc(spaceDoc(fs, db, 'meta', 'members'));
    if (!snap.exists()) return { status: 'bootstrap' };
    const members = snap.data();
    return { status: (members.emails || []).includes(user.email) ? 'member' : 'denied', members };
  } catch (e) {
    if (e.code === 'permission-denied') return { status: 'denied' };
    throw e;
  }
}

export async function registerFirstAdmin(user) {
  const { fs, db } = await loadFirebase();
  await fs.setDoc(spaceDoc(fs, db, 'meta', 'members'), { emails: [user.email], admins: [user.uid] });
}

export async function saveMemberEmails(emails) {
  if (!FIREBASE_CONFIGURED) return;
  const { fs, db } = await loadFirebase();
  await fs.updateDoc(spaceDoc(fs, db, 'meta', 'members'), { emails });
}

// 許可リストと全員の表示名を購読する。callback({ members, profiles })
export async function subscribeSpace(user, callback) {
  if (!FIREBASE_CONFIGURED) {
    const profile = lsRead('antlers-calendar:profile', { name: LOCAL_USER.name, label: defaultLabel(LOCAL_USER.name) });
    callback({
      members: { emails: [], admins: [LOCAL_USER.uid] },
      profiles: { [LOCAL_USER.uid]: { ...profile, email: '' } },
    });
    return () => {};
  }
  const { fs, db } = await loadFirebase();
  let members = null;
  let profiles = null;
  const emit = () => members && profiles && callback({ members, profiles });
  const unsubMembers = fs.onSnapshot(spaceDoc(fs, db, 'meta', 'members'), (snap) => {
    members = snap.exists() ? snap.data() : { emails: [], admins: [] };
    emit();
  });
  const unsubProfiles = fs.onSnapshot(fs.collection(db, 'users', SPACE_ID, 'profiles'), (snap) => {
    profiles = {};
    snap.forEach((d) => {
      profiles[d.id] = d.data();
    });
    emit();
  });
  return () => {
    unsubMembers();
    unsubProfiles();
  };
}

// 初回ログイン時に表示名を登録する（既に登録済みなら名前・ラベルはそのまま）
export async function ensureProfile(user) {
  if (!FIREBASE_CONFIGURED) return;
  const { fs, db } = await loadFirebase();
  const ref = spaceDoc(fs, db, 'profiles', user.uid);
  const snap = await fs.getDoc(ref);
  if (snap.exists() && snap.data().email === user.email) return;
  const current = snap.exists() ? snap.data() : {};
  await fs.setDoc(ref, {
    name: current.name || user.name,
    label: current.label || defaultLabel(user.name),
    email: user.email,
  });
}

export async function saveProfile(uid, profile) {
  if (!FIREBASE_CONFIGURED) {
    lsWrite('antlers-calendar:profile', profile);
    return;
  }
  const { fs, db } = await loadFirebase();
  await fs.setDoc(spaceDoc(fs, db, 'profiles', uid), profile, { merge: true });
}

// ---- 全員で共有する年度データ ----

export async function loadSeasonUserData(seasonYear) {
  if (!FIREBASE_CONFIGURED) return { ...emptySeasonData(seasonYear), ...lsRead(LS_PREFIX + seasonYear, {}) };
  const { fs, db } = await loadFirebase();
  const snap = await fs.getDoc(spaceDoc(fs, db, 'seasons', String(seasonYear)));
  return { ...emptySeasonData(seasonYear), ...(snap.exists() ? snap.data() : {}) };
}

// 変更した項目（例: { viewingPlaces }）だけを書き込む。他の人が同時に別の項目を
// 変更しても上書きしないよう、年度データ全体ではなく指定した項目だけをマージする
export async function saveSeasonUserData(seasonYear, fields) {
  const payload = { ...fields, seasonYear, updatedAt: new Date().toISOString() };
  if (!FIREBASE_CONFIGURED) {
    lsWrite(LS_PREFIX + seasonYear, deepMerge(lsRead(LS_PREFIX + seasonYear, {}), payload));
    return;
  }
  const { fs, db } = await loadFirebase();
  await fs.setDoc(spaceDoc(fs, db, 'seasons', String(seasonYear)), payload, { merge: true });
}

export async function subscribeSeasonUserData(seasonYear, callback) {
  if (!FIREBASE_CONFIGURED) return () => {};
  const { fs, db } = await loadFirebase();
  return fs.onSnapshot(spaceDoc(fs, db, 'seasons', String(seasonYear)), (snap) => {
    if (snap.exists() && !snap.metadata.hasPendingWrites) callback({ ...emptySeasonData(seasonYear), ...snap.data() });
  });
}

// ---- 各メンバーの観戦予定 ----

// 全員分の観戦予定を購読する。callback({ [uid]: { [matchId]: plan } })
export async function subscribeSeasonPlans(seasonYear, callback) {
  if (!FIREBASE_CONFIGURED) {
    callback({ [LOCAL_USER.uid]: lsRead(LS_PLANS_PREFIX + seasonYear, legacyLocalPlans(seasonYear)) });
    return () => {};
  }
  const { fs, db } = await loadFirebase();
  return fs.onSnapshot(fs.collection(db, 'users', SPACE_ID, 'seasons', String(seasonYear), 'plans'), (snap) => {
    const byUser = {};
    snap.forEach((d) => {
      byUser[d.id] = d.data().plans || {};
    });
    callback(byUser);
  });
}

function legacyLocalPlans(seasonYear) {
  return lsRead(LS_PREFIX + seasonYear, {}).viewingPlans || {};
}

// 自分の観戦予定を1試合分だけ書き込む（自分のドキュメントにしか書けない）
export async function saveMyPlan(seasonYear, uid, matchId, plan) {
  if (!FIREBASE_CONFIGURED) {
    const key = LS_PLANS_PREFIX + seasonYear;
    lsWrite(key, { ...lsRead(key, legacyLocalPlans(seasonYear)), [matchId]: plan });
    return;
  }
  const { fs, db } = await loadFirebase();
  await fs.setDoc(
    spaceDoc(fs, db, 'seasons', String(seasonYear), 'plans', uid),
    { plans: { [matchId]: plan } },
    { merge: true }
  );
}

// 複数人対応より前の「全員共通の観戦予定」（年度データの viewingPlans）を、
// 管理者の観戦予定として引き継いでから年度データから削除する
export async function migrateLegacyPlans(seasonYear, uid, legacyPlans) {
  if (!FIREBASE_CONFIGURED || !legacyPlans || !Object.keys(legacyPlans).length) return false;
  const { fs, db } = await loadFirebase();
  const myRef = spaceDoc(fs, db, 'seasons', String(seasonYear), 'plans', uid);
  const mine = (await fs.getDoc(myRef)).data()?.plans || {};
  const merged = { ...legacyPlans, ...mine }; // 既に自分で登録した予定を優先
  await fs.setDoc(myRef, { plans: merged }, { merge: true });
  await fs.updateDoc(spaceDoc(fs, db, 'seasons', String(seasonYear)), { viewingPlans: fs.deleteField() });
  return true;
}
