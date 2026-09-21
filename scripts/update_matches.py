"""Jリーグ公式サイトの鹿島アントラーズ日程ページから試合日程・結果を取得し、
data/matches_<年度>.json に反映する。

GitHub Actions（.github/workflows/update-matches.yml）から定期実行される想定。
標準ライブラリのみで動作する。

    python scripts/update_matches.py            # 今日が属する年度を更新
    python scripts/update_matches.py 2026 2027  # 年度を指定して更新

既存の試合は id を変えずに更新する（アプリ側の観戦予定・手動編集は id に紐づくため）。
取得元に載っていない試合（ルヴァンカップの未確定枠など）は削除しない。
"""

import datetime as dt
import json
import re
import sys
import unicodedata
import urllib.request
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / 'data'
SEASON_START_MONTH = 7  # js/config.js と同じ（7月始まり）
JST = dt.timezone(dt.timedelta(hours=9))

CLUB_DAY_URL = 'https://www.jleague.jp/club/kashima/day/?year={year}&month={month}'
MATCH_URL = 'https://www.jleague.jp{href}'
SOURCE_NAME = 'Jリーグ公式サイト'
KASHIMA = '鹿島アントラーズ'

# 取得元の大会キー -> アプリで使っている大会名
COMPETITION_NAME = {
    'j1': '明治安田Ｊ１リーグ',
    'acle': 'AFCチャンピオンズリーグエリート',
    'emperor': '天皇杯',
    'levain': 'ルヴァンカップ',
}


def competition_key(name):
    """大会名（取得元の leagueName / 表示名、既存データの competition）を共通キーにする"""
    n = unicodedata.normalize('NFKC', name or '')
    if n in COMPETITION_NAME:
        return n
    if 'J1' in n:
        return 'j1'
    if 'AFC' in n or 'ACL' in n:
        return 'acle'
    if '天皇杯' in n or n == 'emperor':
        return 'emperor'
    if 'ルヴァン' in n or 'leaguecup' in n:
        return 'levain'
    return n


def normalize_round(text):
    """「リーグステージ　ＭＤ1　東地区」→「リーグステージ 第1節」、「３回戦」→「3回戦」"""
    t = unicodedata.normalize('NFKC', text or '').strip()
    t = re.sub(r'MD\s*(\d+)', r'第\1節', t)
    t = re.sub(r'\s*[東西]地区', '', t)
    return re.sub(r'\s+', ' ', t).strip()


def round_key(text):
    t = normalize_round(text)
    m = re.search(r'第(\d+)節', t)
    return m.group(1) if m else t


def season_of(date_str):
    y, m = int(date_str[:4]), int(date_str[5:7])
    return y if m >= SEASON_START_MONTH else y - 1


# ---- 取得 ----

def fetch_html(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (antlers-calendar updater)'})
    with urllib.request.urlopen(req, timeout=30) as res:
        return res.read().decode('utf-8')


def extract_schedule_list(html):
    """Next.js のページ内データ（self.__next_f.push）から scheduleList を取り出す"""
    chunks = re.findall(r'self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)', html)
    payload = ''.join(json.loads('"' + c + '"') for c in chunks)
    key = '"scheduleList":'
    i = payload.find(key)
    if i < 0:
        return []
    value, _ = json.JSONDecoder().raw_decode(payload, i + len(key))
    return value


def fetch_official_matches(season_year):
    out = []
    for i in range(12):
        month = (SEASON_START_MONTH - 1 + i) % 12 + 1
        year = season_year if month >= SEASON_START_MONTH else season_year + 1
        html = fetch_html(CLUB_DAY_URL.format(year=year, month=month))
        for group in extract_schedule_list(html):
            for sch in group.get('schedules', []):
                for m in sch.get('matches', []):
                    out.append(to_official(sch, m))
    return out


def map_status(state):
    s = (state or '').lower()
    if s == 'game-over':
        return 'finished'
    if 'postpone' in s:
        return 'postponed'
    if 'cancel' in s:
        return 'canceled'
    return 'scheduled'


def to_official(sch, m):
    home, away = m['homeTeam'], m['awayTeam']
    is_home = home.get('fullName') == KASHIMA
    opp = away if is_home else home
    time = m.get('time') or ''
    rec = {
        'jleagueId': m['id'],
        'date': sch['matchDate'].removeprefix('$D')[:10],
        'kickoffTime': time if re.fullmatch(r'\d{1,2}:\d{2}', time) else '',
        # leagueName はクラブの所属リーグ（常に j1）なので、大会の判定には表示名を使う
        'competitionKey': competition_key(sch.get('leagueDisplayName')),
        'competitionDisplay': sch.get('leagueDisplayName', ''),
        'round': normalize_round(sch.get('seasonText')),
        'homeAway': 'home' if is_home else 'away',
        'opponent': unicodedata.normalize('NFKC', opp.get('fullName') or '未定'),
        'opponentShort': unicodedata.normalize('NFKC', opp.get('name') or opp.get('fullName') or ''),
        'venue': unicodedata.normalize('NFKC', m.get('stadiumFullName') or ''),
        'status': map_status(m.get('state')),
        'sourceUrl': MATCH_URL.format(href=m['detailHref']) if m.get('detailHref') else '',
    }
    if rec['status'] == 'finished':
        own = home if is_home else away
        rec['ownScore'], rec['oppScore'] = own.get('score'), opp.get('score')
    return rec


# ---- 反映 ----

def result_note(o):
    s, t = o.get('ownScore'), o.get('oppScore')
    if s is None or t is None:
        return ''
    outcome = '勝利' if s > t else '敗戦' if s < t else '引分'
    return f'結果: 鹿島 {s}-{t} {o["opponentShort"]}（{outcome}）'


def cleaned_note(note, date_fixed, time_fixed, opponent_fixed):
    """確定した事項についての注記（「土曜/日曜どちらか未確定」など）を取り除く"""
    parts = [p for p in re.split(r'[、。]', note or '') if p]
    keep = []
    for p in parts:
        if date_fixed and '土曜/日曜' in p:
            continue
        if time_fixed and 'キックオフ時刻' in p:
            continue
        if opponent_fixed and ('対戦相手' in p or '組み合わせ' in p):
            continue
        keep.append(p)
    return '、'.join(keep) if len(keep) != len(parts) else (note or '')


def find_existing(o, matches, used):
    candidates = [m for m in matches if id(m) not in used]
    for m in candidates:
        if m.get('jleagueId') == o['jleagueId']:
            return m
    same_comp = [m for m in candidates if competition_key(m.get('competition')) == o['competitionKey']]
    for m in same_comp:
        if o['date'] in (m.get('date'), m.get('altDate')):
            return m
    for m in same_comp:
        if round_key(m.get('round')) == round_key(o['round']) and not m.get('jleagueId'):
            return m
    return None


def apply_official(m, o, now_iso):
    before = json.dumps(m, ensure_ascii=False, sort_keys=True)
    finished = o['status'] == 'finished'

    date_fixed = bool(m.get('altDate')) and (o['kickoffTime'] or o['date'] not in (m.get('date'), m.get('altDate')))
    if o['date'] != m.get('date') and o['date'] != m.get('altDate'):
        m['date'] = o['date']
        m.pop('altDate', None)
    elif date_fixed or finished:
        m['date'] = o['date']
        m.pop('altDate', None)
    else:
        date_fixed = False

    time_fixed = bool(o['kickoffTime']) and not m.get('kickoffTime')
    # 終了後の取得元は実際のキックオフ時刻（19:01 など）になるため、既存の予定時刻を優先する
    if o['kickoffTime'] and not (finished and m.get('kickoffTime')):
        m['kickoffTime'] = o['kickoffTime']

    opponent_fixed = (m.get('opponent') in (None, '', '未定')) and o['opponent'] != '未定'
    m['competition'] = COMPETITION_NAME.get(o['competitionKey'], m.get('competition') or o['competitionDisplay'])
    m['round'] = o['round'] or m.get('round', '')
    m['homeAway'] = o['homeAway']
    m['opponent'] = o['opponent']
    if o['venue']:
        m['venue'] = o['venue']
    m['status'] = o['status']

    if finished:
        old = m.get('note') or ''
        score_prefix = f'結果: 鹿島 {o.get("ownScore")}-{o.get("oppScore")} '
        # 手で書いた詳しい結果メモ（得点者など）はスコアが一致する限り残す
        if not old.startswith(score_prefix):
            m['note'] = result_note(o)
    else:
        m['note'] = cleaned_note(m.get('note'), date_fixed, time_fixed, opponent_fixed)

    m['jleagueId'] = o['jleagueId']
    if o['sourceUrl']:
        m['sourceUrl'] = o['sourceUrl']
    m['sourceName'] = SOURCE_NAME
    changed = json.dumps({k: v for k, v in m.items() if k != 'lastFetchedAt'}, ensure_ascii=False, sort_keys=True) != \
        json.dumps({k: v for k, v in json.loads(before).items() if k != 'lastFetchedAt'}, ensure_ascii=False, sort_keys=True)
    if changed:
        m['lastFetchedAt'] = now_iso
    return changed


def new_match(o, season_year, now_iso):
    m = {
        'id': f'{o["date"]}-{o["competitionKey"]}-{o["jleagueId"]}',
        'seasonYear': season_year,
        'date': o['date'],
        'kickoffTime': o['kickoffTime'],
        'competition': COMPETITION_NAME.get(o['competitionKey'], o['competitionDisplay']),
        'round': o['round'],
        'homeAway': o['homeAway'],
        'opponent': o['opponent'],
        'venue': o['venue'],
        'status': o['status'],
        'sourceUrl': o['sourceUrl'],
        'sourceName': SOURCE_NAME,
        'lastFetchedAt': now_iso,
        'note': result_note(o) if o['status'] == 'finished' else '',
        'jleagueId': o['jleagueId'],
    }
    return m


def update_season(season_year, now_iso):
    path = DATA_DIR / f'matches_{season_year}.json'
    data = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {
        'seasonYear': season_year, 'generatedAt': now_iso, 'note': '', 'matches': []}
    matches = data['matches']

    official = [o for o in fetch_official_matches(season_year) if season_of(o['date']) == season_year]
    if not official:
        # ページ構造の変更などで1件も取れない場合は、誤って何も更新しないよう失敗扱いにする
        raise RuntimeError(f'{season_year}年度の試合を取得できませんでした（取得元のページ構造が変わった可能性があります）')

    used, added, changed = set(), [], []
    for o in official:
        m = find_existing(o, matches, used)
        if m is None:
            m = new_match(o, season_year, now_iso)
            matches.append(m)
            added.append(m)
        elif apply_official(m, o, now_iso):
            changed.append(m)
        used.add(id(m))

    if not added and not changed:
        print(f'{season_year}年度: 変更なし（取得 {len(official)}件）')
        return False

    matches.sort(key=lambda m: (m.get('date') or '', m.get('kickoffTime') or ''))
    data['generatedAt'] = now_iso
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'{season_year}年度: 追加 {len(added)}件 / 更新 {len(changed)}件（取得 {len(official)}件）')
    for m in added:
        print(f'  + {m["date"]} {m["competition"]} {m["round"]} vs {m["opponent"]} {m["note"]}')
    for m in changed:
        print(f'  * {m["date"]} {m["competition"]} {m["round"]} vs {m["opponent"]} {m["note"]}')
    return True


def main(argv):
    now = dt.datetime.now(JST).replace(microsecond=0)
    seasons = [int(a) for a in argv] or [season_of(now.date().isoformat())]
    for season_year in seasons:
        update_season(season_year, now.isoformat())


if __name__ == '__main__':
    main(sys.argv[1:])
