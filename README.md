# 鹿島アントラーズ観戦カレンダー Webアプリ

要件定義書（`antlers_calendar_requirements_v1.0.docx`）に基づくフロントエンド実装です。
ビルド不要の素の HTML / CSS / JavaScript（ES Modules）で作られており、GitHub Pages にそのまま置けます。

## 今回の実装スコープ

- 年度カレンダー画面（4月始まり12か月横並び、土日祝日色分け、観戦場所バッヂ）
- 試合詳細表示・手動追加/編集/非表示
- 観戦場所管理（追加・編集・削除・並び替え・バッヂ色編集）
- 印刷 / PDF出力（A3横、6月-7月間に綴じ代余白）
- Firestoreによる端末間同期（バックエンド抽象化。設定前は localStorage で動作）
- 祝日判定（内蔵計算方式、振替休日・国民の休日対応）

**含まれていないもの**（要件定義書 12.残課題 に整理されている、実サイト調査が前提の部分）:
- 外部サイトからの試合日程自動取得バッチ（GitHub Actions cron + パーサー）
- 各情報源の実際のHTML構造調査

`data/matches_2026.json` は **サンプルデータ** です。実データ取得バッチが実装されるまでは、
このファイルを手動で編集するか、アプリの「試合を手動追加」機能で登録してください。

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
6. Firestore の「ルール」タブで、下記の内容に置き換えて「公開」する（`<SPACE_ID>` は手順5の値に置き換え）

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{spaceId}/seasons/{seasonYear} {
         allow read, write: if spaceId == '<SPACE_ID>'
                             && seasonYear.matches('^[0-9]{4}$');
       }
       match /{document=**} {
         allow read, write: if false;
       }
     }
   }
   ```

7. Firebase コンソールの「使用量とお支払い」で使用量アラートを設定しておく（想定外の急増検知用）
8. ページを再読み込みし、画面右上の同期ステータスが「Firestore同期中」になれば設定完了です
9. 別のブラウザ/スマホから同じ `index.html`（同じ `SPACE_ID`）を開き、観戦場所を変更して両方の画面に反映されることを確認してください

### 注意（要件定義書 6.6 準拠）

このルールは認証なしで `SPACE_ID` というパスの非公開性のみに依存しています。
アプリのソースコードは公開されるため `SPACE_ID` を完全に隠すことはできません。
個人の観戦記録という情報の性質上この水準で妥当と判断していますが、より厳密にしたい場合は
GitHub リポジトリを private にする、または将来的に匿名認証/Googleログインを追加してください。

## GitHub Pages で公開する手順

1. このフォルダの中身を GitHub リポジトリにコミット・プッシュする
2. リポジトリの Settings → Pages → Source を「Deploy from a branch」、ブランチを `main` / `/(root)` に設定
3. 数分後に表示される URL でアプリにアクセスできます
4. 認証機能がないため、**このURLは第三者に共有しない運用**としてください（要件定義書 6.2）

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
js/main.js              画面の初期化・イベント配線
data/matches_2026.json  2026年度サンプル試合データ
```

## 次にやること（要件定義書 12.残課題 より）

- 鹿島公式・Jリーグ・AFC・JFA各サイトの実際のHTML構造調査（パーサー実装前に必須）
- 天皇杯・ルヴァンカップの対戦相手未定時の表示ルール確定
- ACL開催方式変更時の大会名・略称、クラブ名日英対応表の整備
- A3横印刷時の実寸フォントサイズ検証（実際に印刷して可読性確認）
- GitHub Actions による日次自動取得バッチとパーサーの実装
