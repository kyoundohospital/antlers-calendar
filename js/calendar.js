import { monthsOfSeason } from './config.js';
import { getHolidayName } from './holidays.js';

const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];
const HOME_AWAY_LABEL = { home: 'H', away: 'A', neutral: '中立' };

function el(tag, className) {
  const e = document.createElement('div');
  if (className) e.className = className;
  return e;
}

function line(text, className) {
  const e = document.createElement('span');
  if (className) e.className = className;
  e.textContent = text;
  return e;
}

// 月インデックス(0-11)を実際のグリッド列番号(1-13、7列目は綴じ代スペーサー)に変換
function gridColumnForMonthIndex(i) {
  return i < 6 ? i + 1 : i + 2;
}

function dowClass(dow, holidayName) {
  if (holidayName) return 'day-cell--holiday';
  if (dow === 0) return 'day-cell--sun';
  if (dow === 6) return 'day-cell--sat';
  return '';
}

function renderMatchChip(match) {
  const chipClass = 'match-chip status-' + match.status + (match.altDate ? ' date-tentative' : '');
  const chip = el('div', chipClass);
  const line1Text = match.altDate ? `${match.competition}（日程未定）` : match.competition;
  chip.appendChild(line(line1Text, 'chip-line1'));
  chip.appendChild(line(`vs ${match.opponent || '未定'}`, 'chip-line2'));
  if (match.venue) chip.appendChild(line(match.venue, 'chip-line3'));
  return chip;
}

function createBadge(place) {
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.style.background = place.color;
  badge.style.color = contrastColor(place.color);
  badge.textContent = place.shortLabel;
  return badge;
}

function contrastColor(hex) {
  if (!hex || hex[0] !== '#') return '#000';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#000' : '#fff';
}

export function renderCalendar(container, opts) {
  const { seasonYear, matchesByDate, viewingPlaces, viewingPlans, onCellClick, onEmptyCellClick } = opts;
  container.innerHTML = '';
  const months = monthsOfSeason(seasonYear);

  months.forEach(({ year, month }, i) => {
    const header = el('div', 'month-header');
    header.style.gridColumn = String(gridColumnForMonthIndex(i));
    header.style.gridRow = '1';
    header.textContent = `${year}年 ${month}月`;
    container.appendChild(header);
  });

  const gutter = el('div', 'gutter');
  gutter.style.gridColumn = '7';
  gutter.style.gridRow = `1 / span 32`;
  container.appendChild(gutter);

  for (let day = 1; day <= 31; day++) {
    months.forEach(({ year, month }, i) => {
      const col = gridColumnForMonthIndex(i);
      const daysInMonth = new Date(year, month, 0).getDate();
      const cell = el('div');
      cell.style.gridColumn = String(col);
      cell.style.gridRow = String(day + 1);

      if (day > daysInMonth) {
        cell.className = 'day-cell day-cell--empty';
        container.appendChild(cell);
        return;
      }

      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dow = new Date(year, month - 1, day).getDay();
      const holidayName = getHolidayName(dateStr);
      const matches = matchesByDate.get(dateStr) || [];
      const allTentative = matches.length > 0 && matches.every((m) => m.altDate);

      cell.className = [
        'day-cell',
        dowClass(dow, holidayName),
        matches.length ? 'day-cell--match' : '',
        allTentative ? 'day-cell--match-tentative' : '',
      ]
        .filter(Boolean)
        .join(' ');
      cell.dataset.date = dateStr;

      const dateRow = el('div', 'day-cell__date-row');
      const dateGroup = el('div', 'day-cell__date-group');
      dateGroup.appendChild(line(`${day} (${WEEKDAY_JA[dow]})`, 'day-cell__date'));
      if (matches.length && matches[0].kickoffTime) {
        dateGroup.appendChild(line(matches[0].kickoffTime, 'day-cell__time'));
      }
      dateRow.appendChild(dateGroup);
      if (matches.length) {
        const m = matches[0];
        const meta = el('div', 'day-cell__meta');
        const ha = HOME_AWAY_LABEL[m.homeAway] || '';
        if (ha) {
          const haClass = 'day-cell__ha' + (m.homeAway === 'away' ? ' day-cell__ha--away' : '');
          meta.appendChild(line(ha, haClass));
        }
        const plan = viewingPlans ? viewingPlans[m.id] : null;
        if (plan && plan.viewingPlaceId) {
          const place = viewingPlaces.find((p) => p.id === plan.viewingPlaceId);
          if (place) meta.appendChild(createBadge(place));
        }
        dateRow.appendChild(meta);
      }
      cell.appendChild(dateRow);

      for (const m of matches) {
        cell.appendChild(renderMatchChip(m));
      }

      cell.addEventListener('click', () => {
        if (matches.length) onCellClick(matches, dateStr);
        else onEmptyCellClick(dateStr);
      });

      container.appendChild(cell);
    });
  }
}
