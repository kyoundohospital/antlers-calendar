import { seasonYearOf, monthsOfSeason } from './config.js';
import {
  loadBaseMatches,
  mergeMatches,
  groupByDate,
  loadCachedBaseMatches,
  saveCachedBaseMatches,
  diffMatches,
} from './matches.js';
import { loadSeasonUserData, saveSeasonUserData, subscribeSeasonUserData, backendMode } from './store.js';
import { renderCalendar } from './calendar.js';
import { openMatchDetail, openAddMatchForm, closeModal } from './detail.js';
import { openPlacesManager } from './places.js';

const gridEl = document.getElementById('calendarGrid');
const printTitleEl = document.getElementById('printTitle');
const seasonLabelEl = document.getElementById('seasonLabel');
const syncStatusEl = document.getElementById('syncStatus');
const detailOverlay = document.getElementById('detailModal');
const placesOverlay = document.getElementById('placesModal');

const todayStr = new Date().toISOString().slice(0, 10);

const state = {
  seasonYear: seasonYearOf(todayStr),
  baseMatches: [],
  userData: null,
  unsubscribe: null,
};

function seasonLabel(seasonYear) {
  return `${seasonYear}年度（${seasonYear}/4〜${seasonYear + 1}/3）`;
}

function setSyncStatus(text) {
  syncStatusEl.textContent = text;
}

function render() {
  seasonLabelEl.textContent = seasonLabel(state.seasonYear);
  printTitleEl.textContent = `鹿島アントラーズ観戦カレンダー　${seasonLabel(state.seasonYear)}`;
  const effective = mergeMatches({
    base: state.baseMatches,
    overrides: state.userData.matchOverrides,
    manual: state.userData.manualMatches,
  });
  const matchesByDate = groupByDate(effective);
  renderCalendar(gridEl, {
    seasonYear: state.seasonYear,
    matchesByDate,
    viewingPlaces: state.userData.viewingPlaces,
    viewingPlans: state.userData.viewingPlans,
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
    viewingPlans: state.userData.viewingPlans,
    onSavePlan: savePlan,
    onSaveMatchEdit: saveMatchEdit,
    onHideMatch: hideMatch,
  });
}

async function persist() {
  setSyncStatus('保存中…');
  try {
    await saveSeasonUserData(state.seasonYear, state.userData);
    setSyncStatus(backendMode === 'firestore' ? 'Firestoreに同期済み' : 'ローカル保存済み');
  } catch (e) {
    console.error(e);
    setSyncStatus('保存に失敗しました');
  }
}

function savePlan(matchId, patch) {
  state.userData.viewingPlans = {
    ...state.userData.viewingPlans,
    [matchId]: { ...patch, matchId, updatedAt: new Date().toISOString() },
  };
  render();
  persist();
}

function saveMatchEdit(match, patch) {
  if (match.source === 'manual') {
    state.userData.manualMatches = state.userData.manualMatches.map((m) =>
      m.id === match.id ? { ...m, ...patch } : m
    );
  } else {
    state.userData.matchOverrides = {
      ...state.userData.matchOverrides,
      [match.id]: { ...state.userData.matchOverrides[match.id], ...patch },
    };
  }
  render();
  persist();
}

function hideMatch(match) {
  if (match.source === 'manual') {
    deleteManualMatch(match);
    return;
  }
  state.userData.matchOverrides = {
    ...state.userData.matchOverrides,
    [match.id]: { ...state.userData.matchOverrides[match.id], hidden: true },
  };
  render();
  persist();
}

function restoreMatch(matchId) {
  const overrides = { ...state.userData.matchOverrides };
  delete overrides[matchId];
  state.userData.matchOverrides = overrides;
  render();
  persist();
}

function deleteManualMatch(match) {
  state.userData.manualMatches = state.userData.manualMatches.filter((m) => m.id !== match.id);
  render();
  persist();
}

function addManualMatch(newMatch) {
  state.userData.manualMatches = [...state.userData.manualMatches, newMatch];
  render();
  persist();
}

async function loadSeason(seasonYear) {
  if (state.unsubscribe) {
    state.unsubscribe();
    state.unsubscribe = null;
  }
  setSyncStatus('読み込み中…');
  state.seasonYear = seasonYear;
  // 試合データは「取得」ボタンを押したときだけ更新する。初回はキャッシュが無いので取得する
  const cachedBaseMatches = loadCachedBaseMatches(seasonYear);
  const [baseMatches, userData] = await Promise.all([
    cachedBaseMatches ? Promise.resolve(cachedBaseMatches) : loadBaseMatches(seasonYear),
    loadSeasonUserData(seasonYear),
  ]);
  if (!cachedBaseMatches) saveCachedBaseMatches(seasonYear, baseMatches);
  state.baseMatches = baseMatches;
  state.userData = userData;
  render();
  setSyncStatus(backendMode === 'firestore' ? 'Firestore同期中' : 'ローカル保存モード');

  state.unsubscribe = await subscribeSeasonUserData(seasonYear, (data) => {
    state.userData = data;
    render();
    setSyncStatus('他端末からの更新を反映しました');
  });
}

document.getElementById('prevSeasonBtn').addEventListener('click', () => loadSeason(state.seasonYear - 1));
document.getElementById('nextSeasonBtn').addEventListener('click', () => loadSeason(state.seasonYear + 1));

function matchLine(m) {
  const ha = m.homeAway === 'home' ? 'H' : m.homeAway === 'away' ? 'A' : m.homeAway === 'neutral' ? '中立' : '';
  const dateLabel = m.altDate ? `${m.date}(または${m.altDate})` : m.date;
  return `${dateLabel} ${m.competition} vs ${m.opponent || '未定'}${ha ? ' (' + ha + ')' : ''}`;
}

// 自分で非表示にした試合のうち、元データ（取得結果）にはまだ存在するものを探す
function findHiddenStillPresent(baseMatches) {
  const overrides = state.userData.matchOverrides || {};
  return baseMatches.filter((m) => overrides[m.id] && overrides[m.id].hidden);
}

function showUpdateConfirm(diff, hiddenStill, onConfirm) {
  detailOverlay.innerHTML = '';
  detailOverlay.classList.remove('hidden');

  const box = document.createElement('div');
  box.className = 'modal-box';
  const h2 = document.createElement('h2');
  h2.textContent = '試合データの更新を確認';
  box.appendChild(h2);

  const summary = document.createElement('p');
  summary.textContent = `新規 ${diff.added.length}件 / 変更 ${diff.changed.length}件 / 削除 ${diff.removed.length}件`;
  box.appendChild(summary);

  const listWrap = document.createElement('div');
  listWrap.style.maxHeight = '300px';
  listWrap.style.overflowY = 'auto';
  listWrap.style.fontSize = '13px';
  listWrap.style.marginBottom = '12px';

  const addSection = (title, items, formatter) => {
    if (!items.length) return;
    const h3 = document.createElement('div');
    h3.style.fontWeight = 'bold';
    h3.style.margin = '8px 0 4px';
    h3.textContent = title;
    listWrap.appendChild(h3);
    for (const item of items) {
      const p = document.createElement('div');
      p.textContent = formatter(item);
      listWrap.appendChild(p);
    }
  };
  addSection('追加される試合', diff.added, matchLine);
  addSection(
    '内容が変わる試合',
    diff.changed,
    (c) => `${matchLine(c.after)}　←　変更前: ${matchLine(c.before)}`
  );
  addSection('削除される試合', diff.removed, matchLine);

  if (hiddenStill.length) {
    const h3 = document.createElement('div');
    h3.style.fontWeight = 'bold';
    h3.style.margin = '8px 0 4px';
    h3.textContent = '非表示にしている試合（元データにはまだ存在します）';
    listWrap.appendChild(h3);
    for (const m of hiddenStill) {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '6px';
      row.style.margin = '2px 0';
      const label = document.createElement('span');
      label.textContent = matchLine(m);
      row.appendChild(label);
      const restoreBtn = document.createElement('button');
      restoreBtn.textContent = '復元する';
      restoreBtn.addEventListener('click', () => {
        restoreMatch(m.id);
        row.remove();
      });
      row.appendChild(restoreBtn);
      listWrap.appendChild(row);
    }
  }
  box.appendChild(listWrap);

  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  if (diff.added.length || diff.changed.length || diff.removed.length) {
    const okBtn = document.createElement('button');
    okBtn.className = 'primary';
    okBtn.textContent = '反映する';
    okBtn.addEventListener('click', () => {
      closeModal(detailOverlay);
      onConfirm();
    });
    actions.appendChild(okBtn);
  }
  const closeBtn = document.createElement('button');
  closeBtn.textContent = diff.added.length || diff.changed.length || diff.removed.length ? 'キャンセル' : '閉じる';
  closeBtn.addEventListener('click', () => {
    closeModal(detailOverlay);
    setSyncStatus(backendMode === 'firestore' ? 'Firestore同期中' : 'ローカル保存モード');
  });
  actions.appendChild(closeBtn);
  box.appendChild(actions);

  detailOverlay.appendChild(box);
}

document.getElementById('reloadBtn').addEventListener('click', async () => {
  setSyncStatus('確認中…');
  const fetched = await loadBaseMatches(state.seasonYear);
  const diff = diffMatches(state.baseMatches, fetched);
  const hiddenStill = findHiddenStillPresent(fetched);

  if (!diff.added.length && !diff.changed.length && !diff.removed.length && !hiddenStill.length) {
    setSyncStatus('変更はありませんでした');
    return;
  }

  showUpdateConfirm(diff, hiddenStill, () => {
    state.baseMatches = fetched;
    saveCachedBaseMatches(state.seasonYear, fetched);
    render();
    setSyncStatus('最新データを反映しました');
  });
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
    render();
    persist();
  });
});

document.getElementById('printBtn').addEventListener('click', () => window.print());

[detailOverlay, placesOverlay].forEach((overlay) => {
  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) closeModal(overlay);
  });
});

loadSeason(state.seasonYear);
