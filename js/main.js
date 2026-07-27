import { seasonYearOf, monthsOfSeason } from './config.js';
import { loadBaseMatches, mergeMatches, groupByDate } from './matches.js';
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
    onDeleteManualMatch: deleteManualMatch,
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
  const [baseMatches, userData] = await Promise.all([
    loadBaseMatches(seasonYear),
    loadSeasonUserData(seasonYear),
  ]);
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

document.getElementById('reloadBtn').addEventListener('click', async () => {
  setSyncStatus('再読み込み中…');
  state.baseMatches = await loadBaseMatches(state.seasonYear);
  render();
  setSyncStatus('最新データを取得しました');
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

document.getElementById('exportBtn').addEventListener('click', () => {
  const payload = {
    exportedAt: new Date().toISOString(),
    seasonYear: state.seasonYear,
    data: state.userData,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `antlers-calendar-backup-${state.seasonYear}-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('importBtn').addEventListener('click', () => {
  document.getElementById('importFile').click();
});

document.getElementById('importFile').addEventListener('change', async (ev) => {
  const file = ev.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (!parsed.data) throw new Error('不正なバックアップファイルです');
    if (!confirm(`${parsed.seasonYear}年度のバックアップを現在表示中の${state.seasonYear}年度に読み込みます。よろしいですか？`)) {
      return;
    }
    state.userData = { ...state.userData, ...parsed.data, seasonYear: state.seasonYear };
    render();
    await persist();
    alert('読み込みが完了しました');
  } catch (e) {
    console.error(e);
    alert('読み込みに失敗しました: ' + e.message);
  } finally {
    ev.target.value = '';
  }
});

[detailOverlay, placesOverlay].forEach((overlay) => {
  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) closeModal(overlay);
  });
});

loadSeason(state.seasonYear);
