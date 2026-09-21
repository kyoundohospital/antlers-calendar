# 鹿島アントラーズ観戦カレンダー Webアプリ

要件定義書（`antlers_calendar_requirements_v1.0.docx`）に基づくフロントエンド実装です。
ビルド不要の素の HTML / CSS / JavaScript（ES Modules）で作られており、GitHub Pages にそのまま置けます。

## 今回の実装スコープ

- 年度カレンダー画面（7月始まり12か月横並び、土日祝日色分け、観戦場所バッヂ）
- 試合詳細表示・手動追加/編集/非表示
- 観戦場所管理（追加・編集・削除・並び替え・バッヂ色編集）
- 印刷 / PDF出力（A3横、12月-1月間に綴じ代余白）
- Firestoreによる端末間同期（バックエンド抽象化。設定前は localStorage で動作）
- Googleログイン・許可リストによる複数人での共有（観戦予定は1人ずつ）
- スマホ向けの1か月表示
- 祝日判定（内蔵計算方式、振替休日・国民の休日対応）

- 試合日程・結果の自動取得（GitHub Actions で3時間おきに Jリーグ公式サイトから取得）

## 試合データの自動更新

`.github/workflows/update-matches.yml` が3時間おきに `scripts/update_matches.py` を実行し、
Jリーグ公式サイトの鹿島アントラーズ日程ページ（J1・ACLE・天皇杯・ルヴァンカップ）から
日程・キックオフ時刻・会場・結果を取得して `data/matches_<年度>.json` を更新します。
変更があったときだけコミット・プッシュされ、GitHub Pages に反映されます。
アプリはページを開くたびにこの JSON を読み直すため、結果は自動で表示されます。

- すぐに更新したいとき: GitHub の Actions タブ →「試合データ自動更新」→「Run workflow」
- ローカルで実行: `python scripts/update_matches.py`（年度指定: `python scripts/update_matches.py 2026`）
- 既存の試合は id を変えずに更新するため、観戦予定・手動編集はそのまま残ります
- 取得元に載っていない試合（抽選前のルヴァンカップなど）は削除されません。抽選後に公式に載ると、
  同じ大会で日付が近い（10日以内）「対戦相手未定」の仮登録試合が公式の内容に置き換わります
- 60日間リポジトリに動きがないと GitHub が定期実行を止めるため、実行のたびに再有効化して防いでいます
- 手で書いた詳しい結果メモ（得点者など）は、スコアが一致する限り上書きされません

## 起動方法（ローカル確認）

`fetch()` で JSON を読み込むため、`file://` で直接開くとブラウザによっては失敗します。
簡易HTTPサーバーで開いてください。

```bash
cd antlers-calendar
python -m http.server 8000
```

ブラウザで `http://localhost:8000` を開きます。

## Firebase（Firestore）を設定する手順

現状 `js/config.js` の `FIREBASE_CONFIG` と `SPACE_ID` はプレースホルダーです。
未設定の間はブラウザの localStorage に観戦予定が保存されます（この端末だけで完結、同期なし）。
複数端末で同期したい場合は以下の手順で Firebase を設定してください。

1. https://console.firebase.google.com/ で新規プロジェクトを作成する
   - プラン: **Spark（無料）**。支払い情報の登録は不要です。
2. 左メニュー「Firestore Database」→「データベースの作成」
   - ロケーション: `asia-northeast1`（東京）を選択
   - セキュリティルール: 「本番環境モード」で開始（後述のルールに置き換えるため）
3. 左メニュー「プロジェクトの設定」→「マイアプリ」→ Web アプリを追加（`</>` アイコン）
   - アプリ登録後に表示される `firebaseConfig` の値をコピーする
4. `js/config.js` の `FIREBASE_CONFIG` を、コピーした値で置き換える
5. `SPACE_ID` を、推測困難なランダム文字列（20文字程度）に置き換える
   - 生成例（ブラウザのコンソールや Node で実行）:
     ```js
     Array.from(crypto.getRandomValues(new Uint8Array(15))).map(b => b.toString(36)).join('').slice(0, 20)
     ```
6. 左メニュー「Authentication」→「始める」→「Sign-in method」で **Google** を有効にする
7. 「Authentication」→「設定」→「承認済みドメイン」に GitHub Pages のドメイン（例: `kyoundohospital.github.io`）を追加する
8. Firestore の「ルール」タブに、リポジトリの `firestore.rules` の内容を貼り付けて「公開」する
   （`spaceOk()` の文字列は手順5の `SPACE_ID` に合わせる）
9. Firebase コンソールの「使用量とお支払い」で使用量アラートを設定しておく（想定外の急増検知用）
10. アプリを開いて Google でログインし、「管理者として登録」を押す（最初にログインした人だけが管理者になれます）
11. 「メンバー」画面で、一緒に使う人の Google アカウントのメールアドレスを追加する

## 複数人での利用

- 許可リスト（「メンバー」画面）に登録された Google アカウントだけがログインして使えます
- 観戦予定（観戦場所・メモ）は1人ずつ登録します。カレンダーには各メンバーの頭文字のバッジが
  観戦場所の色で並び、上部の選択で「全員の予定」と特定の人の予定を切り替えられます（印刷にも反映）
- 観戦場所の種類・手動で追加した試合・試合情報の編集は全員で共有します
- 自分の観戦予定は自分だけが変更でき、他の人が同時に編集しても互いの変更は消えません
- 表示名とバッジの文字は「メンバー」画面で各自が変更できます
- スマホ（画面幅 767px 以下）では1か月ずつ表示し、「‹ ›」で月を切り替えます
- 複数人対応より前に登録されていた「全員共通の観戦予定」は、管理者の予定として引き継がれます

## GitHub Pages で公開する手順

1. このフォルダの中身を GitHub リポジトリにコミット・プッシュする
2. リポジトリの Settings → Pages → Source を「Deploy from a branch」、ブランチを `main` / `/(root)` に設定
3. 数分後に表示される URL でアプリにアクセスできます
4. Googleログインと許可リストで利用者を制限しています
   - 検索エンジンに載らないよう `index.html` に `noindex` を指定しています
   - ただし GitHub リポジトリ自体は公開のため、GitHub 上の検索ではコードが見つかります

## ディレクトリ構成

```
index.html            画面本体
css/style.css          スタイル（印刷用CSSを含む）
js/config.js            マスタデータ・略称表・Firebase設定
js/holidays.js          祝日計算ロジック
js/matches.js           試合データの読み込み・マージ
js/store.js             Firestore / localStorage 抽象化
js/calendar.js          年度カレンダーのレンダリング
js/detail.js            試合詳細・編集・手動追加モーダル
js/places.js            観戦場所管理モーダル
js/members.js           メンバー（表示名・許可リスト）管理モーダル
js/main.js              画面の初期化・イベント配線
data/matches_<年度>.json  年度ごとの試合データ（自動更新）
scripts/update_matches.py  Jリーグ公式サイトからの試合データ取得スクリプト
.github/workflows/update-matches.yml  自動更新の定期実行設定
```

## 次にやること（要件定義書 12.残課題 より）

- 天皇杯・ルヴァンカップの対戦相手未定時の表示ルール確定
- ACL開催方式変更時の大会名・略称、クラブ名日英対応表の整備
- A3横印刷時の実寸フォントサイズ検証（実際に印刷して可読性確認）
