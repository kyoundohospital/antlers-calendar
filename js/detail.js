import { STATUS_LABEL } from './config.js';
import { makeManualMatchId } from './matches.js';

const HOME_AWAY_OPTIONS = [
  ['home', 'ホーム (H)'],
  ['away', 'アウェイ (A)'],
  ['neutral', '中立会場'],
];
const STATUS_OPTIONS = Object.entries(STATUS_LABEL);

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function field(labelText, inputEl) {
  const wrap = el('div', 'field');
  const label = el('label', null, labelText);
  wrap.appendChild(label);
  wrap.appendChild(inputEl);
  return wrap;
}

function closeModal(overlay) {
  overlay.classList.add('hidden');
  overlay.innerHTML = '';
}

function infoRow(dl, label, value) {
  const dt = el('dt', null, label);
  const dd = el('dd', null, value || '-');
  dl.appendChild(dt);
  dl.appendChild(dd);
}

export function openMatchDetail(overlay, match, ctx) {
  overlay.innerHTML = '';
  overlay.classList.remove('hidden');

  const box = el('div', 'modal-box');
  const closeBtn = el('button', 'modal-close', '×');
  closeBtn.addEventListener('click', () => closeModal(overlay));
  box.appendChild(closeBtn);
  box.appendChild(el('h2', null, '試合詳細'));

  const info = el('dl', 'info-grid');
  infoRow(info, '試合日', match.date);
  infoRow(info, '大会', match.competition);
  infoRow(info, '節/ラウンド', match.round);
  infoRow(info, 'ホーム/アウェイ', HOME_AWAY_OPTIONS.find((o) => o[0] === match.homeAway)?.[1] || match.homeAway);
  infoRow(info, '対戦相手', match.opponent);
  infoRow(info, 'キックオフ', match.kickoffTime);
  infoRow(info, '会場', match.venue);
  infoRow(info, 'ステータス', STATUS_LABEL[match.status] || match.status);
  if (match.sourceUrl) {
    const dt = el('dt', null, '取得元');
    const dd = el('dd');
    const a = el('a', null, match.sourceName || match.sourceUrl);
    a.href = match.sourceUrl;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    dd.appendChild(a);
    info.appendChild(dt);
    info.appendChild(dd);
  }
  infoRow(info, '最終取得', match.lastFetchedAt ? new Date(match.lastFetchedAt).toLocaleString('ja-JP') : '-');
  box.appendChild(info);

  // --- 観戦場所・メモ編集 ---
  const plan = ctx.viewingPlans[match.id] || {};
  const placeSelect = document.createElement('select');
  const noneOpt = el('option', null, '(未選択)');
  noneOpt.value = '';
  placeSelect.appendChild(noneOpt);
  for (const p of ctx.viewingPlaces.filter((p) => p.isActive)) {
    const opt = el('option', null, p.name);
    opt.value = p.id;
    if (plan.viewingPlaceId === p.id) opt.selected = true;
    placeSelect.appendChild(opt);
  }
  box.appendChild(field('観戦場所', placeSelect));

  const noteInput = document.createElement('textarea');
  noteInput.value = plan.note || '';
  box.appendChild(field('メモ', noteInput));

  const actions = el('div', 'modal-actions');

  const saveBtn = el('button', 'primary', '保存');
  saveBtn.addEventListener('click', () => {
    ctx.onSavePlan(match.id, { viewingPlaceId: placeSelect.value || null, note: noteInput.value });
    closeModal(overlay);
  });
  actions.appendChild(saveBtn);

  const editBtn = el('button', null, '試合情報を編集');
  editBtn.addEventListener('click', () => openMatchEditForm(overlay, match, ctx));
  actions.appendChild(editBtn);

  const hideBtn = el('button', 'danger', '非表示にする');
  hideBtn.addEventListener('click', () => {
    if (confirm('この試合をカレンダーから非表示にしますか？')) {
      ctx.onHideMatch(match);
      closeModal(overlay);
    }
  });
  actions.appendChild(hideBtn);

  if (match.source === 'manual') {
    const delBtn = el('button', 'danger', '削除');
    delBtn.addEventListener('click', () => {
      if (confirm('この手動追加試合を削除しますか？')) {
        ctx.onDeleteManualMatch(match);
        closeModal(overlay);
      }
    });
    actions.appendChild(delBtn);
  }

  const closeBtn2 = el('button', null, '閉じる');
  closeBtn2.addEventListener('click', () => closeModal(overlay));
  actions.appendChild(closeBtn2);

  box.appendChild(actions);
  overlay.appendChild(box);
}

function buildMatchForm(box, initial) {
  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.value = initial.date || '';
  box.appendChild(field('試合日', dateInput));

  const timeInput = document.createElement('input');
  timeInput.type = 'time';
  timeInput.value = initial.kickoffTime || '';
  box.appendChild(field('キックオフ時刻', timeInput));

  const competitionInput = document.createElement('input');
  competitionInput.type = 'text';
  competitionInput.value = initial.competition || '';
  box.appendChild(field('大会名', competitionInput));

  const roundInput = document.createElement('input');
  roundInput.type = 'text';
  roundInput.value = initial.round || '';
  box.appendChild(field('節/ラウンド', roundInput));

  const haSelect = document.createElement('select');
  for (const [v, label] of HOME_AWAY_OPTIONS) {
    const opt = el('option', null, label);
    opt.value = v;
    if (initial.homeAway === v) opt.selected = true;
    haSelect.appendChild(opt);
  }
  box.appendChild(field('ホーム/アウェイ', haSelect));

  const opponentInput = document.createElement('input');
  opponentInput.type = 'text';
  opponentInput.value = initial.opponent || '';
  box.appendChild(field('対戦相手', opponentInput));

  const venueInput = document.createElement('input');
  venueInput.type = 'text';
  venueInput.value = initial.venue || '';
  box.appendChild(field('会場', venueInput));

  const statusSelect = document.createElement('select');
  for (const [v, label] of STATUS_OPTIONS) {
    const opt = el('option', null, label);
    opt.value = v;
    if ((initial.status || 'scheduled') === v) opt.selected = true;
    statusSelect.appendChild(opt);
  }
  box.appendChild(field('ステータス', statusSelect));

  const noteInput2 = document.createElement('textarea');
  noteInput2.value = initial.note || '';
  box.appendChild(field('試合メモ', noteInput2));

  return {
    getValues() {
      return {
        date: dateInput.value,
        kickoffTime: timeInput.value,
        competition: competitionInput.value,
        round: roundInput.value,
        homeAway: haSelect.value,
        opponent: opponentInput.value,
        venue: venueInput.value,
        status: statusSelect.value,
        note: noteInput2.value,
      };
    },
  };
}

function openMatchEditForm(overlay, match, ctx) {
  overlay.innerHTML = '';
  const box = el('div', 'modal-box');
  const closeBtn = el('button', 'modal-close', '×');
  closeBtn.addEventListener('click', () => closeModal(overlay));
  box.appendChild(closeBtn);
  box.appendChild(el('h2', null, '試合情報を編集'));

  const form = buildMatchForm(box, match);

  const actions = el('div', 'modal-actions');
  const saveBtn = el('button', 'primary', '保存');
  saveBtn.addEventListener('click', () => {
    ctx.onSaveMatchEdit(match, form.getValues());
    closeModal(overlay);
  });
  actions.appendChild(saveBtn);
  const cancelBtn = el('button', null, 'キャンセル');
  cancelBtn.addEventListener('click', () => openMatchDetail(overlay, match, ctx));
  actions.appendChild(cancelBtn);
  box.appendChild(actions);

  overlay.appendChild(box);
}

export function openAddMatchForm(overlay, dateStr, ctx) {
  overlay.innerHTML = '';
  overlay.classList.remove('hidden');
  const box = el('div', 'modal-box');
  const closeBtn = el('button', 'modal-close', '×');
  closeBtn.addEventListener('click', () => closeModal(overlay));
  box.appendChild(closeBtn);
  box.appendChild(el('h2', null, '試合を手動追加'));

  const form = buildMatchForm(box, { date: dateStr, homeAway: 'home', status: 'scheduled' });

  const actions = el('div', 'modal-actions');
  const saveBtn = el('button', 'primary', '追加');
  saveBtn.addEventListener('click', () => {
    const values = form.getValues();
    if (!values.date || !values.competition || !values.opponent) {
      alert('試合日・大会名・対戦相手は必須です');
      return;
    }
    const newMatch = {
      id: makeManualMatchId(),
      source: 'manual',
      seasonYear: ctx.seasonYear,
      sourceUrl: '',
      sourceName: '手動追加',
      lastFetchedAt: new Date().toISOString(),
      ...values,
    };
    ctx.onAddManualMatch(newMatch);
    closeModal(overlay);
  });
  actions.appendChild(saveBtn);
  const cancelBtn = el('button', null, 'キャンセル');
  cancelBtn.addEventListener('click', () => closeModal(overlay));
  actions.appendChild(cancelBtn);
  box.appendChild(actions);

  overlay.appendChild(box);
}

export { closeModal };
