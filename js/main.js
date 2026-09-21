import { seasonYearOf, monthsOfSeason } from './config.js';
import {
  loadBaseMatches,
  mergeMatches,
  groupByDate,
  loadCachedBaseMatches,
  saveCachedBaseMatches,
  diffMatches,
} from './matches.js';
import {
  backendMode,
  watchAuth,
  signIn,
  signOut,
  checkMembership,
  registerFirstAdmin,
  ensureProfile,
  subscribeSpace,
  loadSeasonUserData,
  saveSeasonUserData,
  subscribeSeasonUserData,
  subscribeSeasonPlans,
  saveMyPlan,
  migrateLegacyPlans,
  defaultLabel,
} from './store.js';
import { renderCalendar } from './calendar.js';
import { openMatchDetail, openAddMatchForm, closeModal } from './detail.js';
import { openPlacesManager } from './places.js';
import { openMembersManager } from './members.js';

const gridEl = document.getElementById('calendarGrid');
const printTitleEl = document.getElementById('printTitle');
const seasonLabelEl = document.getElementById('seasonLabel');
const syncStatusEl = document.getElementById('syncStatus');
const detailOverlay = document.getElementById('detailModal');
const placesOverlay = document.getElementById('placesModal');
const authScreenEl = document.getElementById('authScreen');
const viewFilterEl = document.getElementById('viewFilter');
const monthLabelEl = document.getElementById('monthLabel');

const todayStr = new Date().toISOString().slice(0, 10);
const mobileQuery = window.matchMedia('(max-width: 767px)');

const state = {
  user: null,
  members: { emails: [], admins: [] },
  profiles: {},
  seasonYear: seasonYearOf(todayStr),
  monthIndex: currentMonthIndex(seasonYearOf(todayStr)),
  baseMatches: [],
  userData: null,
  plansByUser: {},
  viewFilter: 'all',
  unsubscribers: [],
  unsubscribeSpace: null,
};

function seasonLabel(seasonYear) {
  return `${seasonYear}年度（${seasonYear}/7〜${seasonYear + 1}/6）`;
}

function currentMonthIndex(seasonYear) {
  const months = monthsOfSeason(seasonYear);
  const [y, m] = todayStr.split('-').map(Number);
  const i = months.findIndex((mm) => mm.year === y && mm.month === m);
  return i >= 0 ? i : 0;
}

function setSyncStatus(text) {
  syncStatusEl.textContent = text;
}

function idleStatus() {
  return backendMode === 'firestore' ? '同期中' : 'ローカル保存モード';
}

// ---- メンバー ----

// 許可リストに入っているメンバーだけを、表示名つきで返す（自分を先頭に）
function activeMembers() {
  const list = Object.entries(state.profiles)
    .filter(([uid, p]) => backendMode === 'local' || (state.members.emails || []).includes(p.email))
    .map(([uid, p]) => ({ uid, name: p.name || p.email, label: p.label || defaultLabel(p.name), email: p.email }));
  list.sort((a, b) => (a.uid === state.user.uid ? -1 : b.uid === state.user.uid ? 1 : a.name.localeCompare(b.name, 'ja')));
  return list;
}

function isAdmin() {
  return (state.members.admins || []).includes(state.user.uid);
}

function renderViewFilter() {
  const members = activeMembers();
  const current = state.viewFilter;
  viewFilterEl.innerHTML = '';
  const add = (value, text) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = text;
    viewFilterEl.appendChild(opt);
  };
  add('all', '全員の予定');
  for (const m of members) add(m.uid, m.uid === state.user.uid ? `${m.name}（自分）` : m.name);
  state.viewFilter = members.some((m) => m.uid === current) ? current : 'all';
  viewFilterEl.value = state.viewFilter;
  // 1人で使っているときは切り替える意味がないので隠す
  viewFilterEl.hidden = members.length <= 1;
}

// カレンダーのマスに表示するバッジ（観戦場所の色 + メンバーの頭文字）
function badgesFor(match) {
  const members = activeMembers().filter((m) => state.viewFilter === 'all' || m.uid === state.viewFilter);
  const showPersonLabel = activeMembers().length > 1;
  const badges = [];
  for (const m of members) {
    const plan = state.plansByUser[m.uid]?.[match.id];
    const place = plan && state.userData.viewingPlaces.find((p) => p.id === plan.viewingPlaceId);
    if (!place) continue;
    badges.push({
      color: place.color,
      text: showPersonLabel ? m.label : place.shortLabel,
      title: `${m.name}: ${place.name}`,
    });
  }
  return badges;
}

// ---- 描画 ----

function render() {
  if (!state.userData) return;
  const filterName = state.viewFilter === 'all' ? '' : activeMembers().find((m) => m.uid === state.viewFilter)?.name;
  seasonLabelEl.textContent = seasonLabel(state.seasonYear);
  printTitleEl.textContent = `鹿島アントラーズ観戦カレンダー　${seasonLabel(state.seasonYear)}${filterName ? `　${filterName}` : ''}`;
  const effective = mergeMatches({
    base: state.baseMatches,
    overrides: state.userData.matchOverrides,
    manual: state.userData.manualMatches,
  });
  const { year, month } = monthsOfSeason(state.seasonYear)[state.monthIndex];
  monthLabelEl.textContent = `${year}年${month}月`;
  renderCalendar(gridEl, {
    seasonYear: state.seasonYear,
    matchesByDate: groupByDate(effective),
    badgesFor,
    // スマホでは1か月ずつ表示する（印刷は常に12か月）
    monthIndices: mobileQuery.matches ? [state.monthIndex] : null,
    onCellClick: (matches) => showDetailForMatches(matches),
    onEmptyCellClick: (dateStr) => {
      openAddMatchForm(detailOverlay, dateStr, {
        seasonYear: state.seasonYear,
        onAddManualMatch: addManualMatch,
      });
    },
  });
}

function showDetailForMatches(matches) {
  // 同日複数試合の場合は最初の1件を表示（通常は1日1試合）
  const match = matches[0];
  openMatchDetail(detailOverlay, match, {
    viewingPlaces: state.userData.viewingPlaces,
    members: activeMembers(),
    myUid: state.user.uid,
    plansByUser: state.plansByUser,
    onSavePlan: savePlan,
    onSaveMatchEdit: saveMatchEdit,
    onHideMatch: hideMatch,
  });
}

// ---- 保存 ----

async function runSave(promise) {
  setSyncStatus('保存中…');
  try {
    await promise;
    setSyncStatus(backendMode === 'firestore' ? '保存しました' : 'ローカル保存済み');
  } catch (e) {
    console.error(e);
    setSyncStatus('保存に失敗しました');
  }
}

// 変更した項目だけを保存する（他の人が同時に別の項目を編集しても消えないように）
function persist(fields) {
  render();
  runSave(saveSeasonUserData(state.seasonYear, fields));
}

function savePlan(matchId, patch) {
  const plan = { ...patch, matchId, updatedAt: new Date().toISOString() };
  const uid = state.user.uid;
  state.plansByUser = { ...state.plansByUser, [uid]: { ...state.plansByUser[uid], [matchId]: plan } };
  render();
  runSave(saveMyPlan(state.seasonYear, uid, matchId, plan));
}

function saveMatchEdit(match, patch) {
  if (match.source === 'manual') {
    state.userData.manualMatches = state.userData.manualMatches.map((m) =>
      m.id === match.id ? { ...m, ...patch } : m
    );
    persist({ manualMatches: state.userData.manualMatches });
  } else {
    const override = { ...state.userData.matchOverrides[match.id], ...patch };
    state.userData.matchOverrides = { ...state.userData.matchOverrides, [match.id]: override };
    persist({ matchOverrides: { [match.id]: override } });
  }
}

function hideMatch(match) {
  if (match.source === 'manual') {
    state.userData.manualMatches = state.userData.manualMatches.filter((m) => m.id !== match.id);
    persist({ manualMatches: state.userData.manualMatches });
    return;
  }
  saveMatchEdit(match, { hidden: true });
}

function addManualMatch(newMatch) {
  state.userData.manualMatches = [...state.userData.manualMatches, newMatch];
  persist({ manualMatches: state.userData.manualMatches });
}

// ---- 読み込み ----

async function loadSeason(seasonYear, monthIndex = currentMonthIndex(seasonYear)) {
  state.unsubscribers.forEach((fn) => fn());
  state.unsubscribers = [];
  setSyncStatus('読み込み中…');
  state.seasonYear = seasonYear;
  state.monthIndex = monthIndex;
  // 開くたびに最新の試合情報・結果を取得して反映する。取得できなければ前回のキャッシュで表示する
  const cachedBaseMatches = loadCachedBaseMatches(seasonYear);
  const [fetched, userData] = await Promise.all([loadBaseMatches(seasonYear), loadSeasonUserData(seasonYear)]);
  if (state.seasonYear !== seasonYear) return; // 読み込み中に別の年度へ切り替えられた
  state.baseMatches = fetched ?? cachedBaseMatches ?? [];
  if (fetched) saveCachedBaseMatches(seasonYear, fetched);
  state.userData = userData;
  state.plansByUser = {};
  render();
  setSyncStatus(fetchResultStatus(cachedBaseMatches, fetched));

  // 複数人対応より前の「全員共通の観戦予定」は、管理者の予定として引き継ぐ
  if (userData.viewingPlans && isAdmin()) {
    migrateLegacyPlans(seasonYear, state.user.uid, userData.viewingPlans).catch((e) => console.error(e));
  }

  state.unsubscribers.push(
    await subscribeSeasonUserData(seasonYear, (data) => {
      state.userData = data;
      render();
    }),
    await subscribeSeasonPlans(seasonYear, (byUser) => {
      state.plansByUser = byUser;
      render();
    })
  );
}

function fetchResultStatus(cached, fetched) {
  if (!fetched) return `試合データを取得できませんでした（前回のデータを表示中）`;
  if (!cached) return idleStatus();
  const diff = diffMatches(cached, fetched);
  const n = diff.added.length + diff.changed.length + diff.removed.length;
  return n ? `最新の試合データを反映しました（${n}件更新）` : idleStatus();
}

// ---- ログイン ----

const AUTH_ERROR_MESSAGES = {
  'auth/configuration-not-found': 'Firebase で Google ログインが有効になっていません（管理者が設定してください）',
  'auth/operation-not-allowed': 'Firebase で Google ログインが有効になっていません（管理者が設定してください）',
  'auth/unauthorized-domain': 'このURLはログインが許可されていません（Firebase の承認済みドメインに追加が必要です）',
  'auth/popup-blocked': 'ログイン画面のポップアップがブロックされました。ポップアップを許可してもう一度押してください',
  'auth/popup-closed-by-user': 'ログインがキャンセルされました',
  'auth/cancelled-popup-request': 'ログインがキャンセルされました',
  'auth/network-request-failed': '通信に失敗しました。接続を確認してもう一度押してください',
  'permission-denied': '権限がありません（Firestore のルールが最新か確認してください）',
};

function authErrorMessage(e) {
  const text = AUTH_ERROR_MESSAGES[e.code];
  return text ? `${text}（${e.code}）` : `エラー: ${e.code || e.message}`;
}

function showAuthScreen({ message, primary, secondary }) {
  authScreenEl.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'auth-box';
  const h2 = document.createElement('h2');
  h2.textContent = '鹿島アントラーズ観戦カレンダー';
  box.appendChild(h2);
  for (const text of [].concat(message)) {
    const p = document.createElement('p');
    p.textContent = text;
    box.appendChild(p);
  }
  for (const b of [primary, secondary].filter(Boolean)) {
    const btn = document.createElement('button');
    btn.textContent = b.label;
    if (b === primary) btn.className = 'primary';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await b.onClick();
      } catch (e) {
        console.error(e);
        btn.disabled = false;
        // 押すたびにエラーが積み重ならないよう、1つの表示欄を使い回す
        let err = box.querySelector('.auth-error');
        if (!err) {
          err = document.createElement('p');
          err.className = 'auth-error';
          box.appendChild(err);
        }
        err.textContent = authErrorMessage(e);
      }
    });
    box.appendChild(btn);
  }
  authScreenEl.appendChild(box);
  authScreenEl.hidden = false;
}

async function onAuthChanged(user) {
  state.user = user;
  if (state.unsubscribeSpace) state.unsubscribeSpace();
  state.unsubscribeSpace = null;
  state.unsubscribers.forEach((fn) => fn());
  state.unsubscribers = [];
  if (!user) {
    showAuthScreen({
      message: 'メンバーだけが使えます。Googleアカウントでログインしてください。',
      primary: { label: 'Googleでログイン', onClick: signIn },
    });
    return;
  }
  const { status, members } = await checkMembership(user);
  if (members) state.members = members;
  if (status === 'bootstrap') {
    showAuthScreen({
      message: [
        'まだメンバーが登録されていません。',
        `このアカウント（${user.email}）を管理者として登録し、利用を開始しますか？管理者はメンバーの追加・削除ができます。`,
      ],
      primary: {
        label: '管理者として登録',
        onClick: async () => {
          await registerFirstAdmin(user);
          await onAuthChanged(user);
        },
      },
      secondary: { label: '別のアカウントでログイン', onClick: signOut },
    });
    return;
  }
  if (status === 'denied') {
    showAuthScreen({
      message: [
        `このアカウント（${user.email}）はメンバーに登録されていません。`,
        '管理者にメンバーへの追加を依頼してください。',
      ],
      primary: { label: '別のアカウントでログイン', onClick: signOut },
    });
    return;
  }

  authScreenEl.hidden = true;
  await ensureProfile(user);
  state.unsubscribeSpace = await subscribeSpace(user, ({ members, profiles }) => {
    state.members = members;
    state.profiles = profiles;
    renderViewFilter();
    render();
  });
  await loadSeason(state.seasonYear, state.monthIndex);
}

// ---- 画面操作 ----

document.getElementById('prevSeasonBtn').addEventListener('click', () => loadSeason(state.seasonYear - 1));
document.getElementById('nextSeasonBtn').addEventListener('click', () => loadSeason(state.seasonYear + 1));

document.getElementById('prevMonthBtn').addEventListener('click', () => {
  if (state.monthIndex > 0) {
    state.monthIndex--;
    render();
  } else {
    loadSeason(state.seasonYear - 1, 11);
  }
});
document.getElementById('nextMonthBtn').addEventListener('click', () => {
  if (state.monthIndex < 11) {
    state.monthIndex++;
    render();
  } else {
    loadSeason(state.seasonYear + 1, 0);
  }
});
mobileQuery.addEventListener('change', render);

viewFilterEl.addEventListener('change', () => {
  state.viewFilter = viewFilterEl.value;
  render();
});

document.getElementById('addMatchBtn').addEventListener('click', () => {
  openAddMatchForm(detailOverlay, todayStr, {
    seasonYear: state.seasonYear,
    onAddManualMatch: addManualMatch,
  });
});

document.getElementById('placesBtn').addEventListener('click', () => {
  openPlacesManager(placesOverlay, state.userData.viewingPlaces, (places) => {
    state.userData.viewingPlaces = places;
    persist({ viewingPlaces: places });
  });
});

document.getElementById('membersBtn').addEventListener('click', () => {
  openMembersManager(placesOverlay, {
    user: state.user,
    isAdmin: isAdmin(),
    members: state.members,
    profiles: state.profiles,
    backendMode,
    onSignOut: signOut,
    onSaved: (text) => setSyncStatus(text),
    // Firestore では購読で自動的に反映されるが、ローカル保存モードでも即座に表示を変えるため
    onProfileSaved: (profile) => {
      state.profiles = { ...state.profiles, [state.user.uid]: { ...state.profiles[state.user.uid], ...profile } };
      renderViewFilter();
      render();
    },
  });
});

document.getElementById('printBtn').addEventListener('click', () => window.print());

[detailOverlay, placesOverlay].forEach((overlay) => {
  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) closeModal(overlay);
  });
});

watchAuth((user) => {
  onAuthChanged(user).catch((e) => {
    console.error(e);
    showAuthScreen({
      message: ['読み込みに失敗しました。時間をおいて再読み込みしてください。', `(${e.code || e.message})`],
      primary: { label: '再読み込み', onClick: () => location.reload() },
    });
  });
});
