# Studio Aegis

DAW 以外の制作まわりを 1 か所に集約する、個人用の音楽制作ハブ。
案件ごとに **リファレンス(Spotify)・Splice Stack・構成/進行メモ・雑多アイデア・音源ファイル** をまとめて見渡せます。

> 「DAW と Studio Aegis の 2 つだけ開いていればいい」状態がゴール。姉妹アプリ: Lyric Machine

## 機能

| 画面 | 内容 |
|---|---|
| 案件一覧(トップ) | 案件カード(案件名・サムネ・最終更新日)、最終更新順、新規作成 |
| 案件詳細 | 下記 5 セクション + 案件名・サムネイル編集、案件削除 |

- **リファレンス(Spotify)**
  - 曲/アルバム/プレイリスト等の URL・URI を貼ると埋め込みプレイヤーをページ内に表示(Spotify 設定なしで使える)
  - Spotify 接続時: 検索、マイプレイリスト閲覧、**アプリ内プレイヤー(Web Playback SDK)** でのフル再生・一時停止・スキップ・シーク
  - リファレンスごとにメモ・並べ替え
- **Splice** — Stack の共有 URL を 1 件登録。「Splice で開く」(新規タブ)/「サイドウィンドウで開く」(画面右側に並べて開く)
- **構成・進行イメージ** — Markdown(表・見出し・リスト等 GFM 対応)、編集/分割/プレビュー切替、自動保存
- **雑多アイデア** — 箇条書き書き殴り用。Enter で次の「- 」を自動挿入、空項目で Enter するとリスト終了、Tab/Shift+Tab でインデント、自動保存
- **ファイル** — 「先方リファレンス / 完成版 / その他」に分けてアップロード(ドラッグ&ドロップ・複数可、進捗表示)。ブラウザ内再生(シーク対応)、ダウンロード、分類変更、削除
  - wav / mp3 / aiff / flac / m4a / ogg など。1 ファイル上限は既定 1GB(`MAX_UPLOAD_MB`)
  - 再生は同時に 1 つだけ(他のファイルや Spotify は自動で一時停止)

## 技術構成

```
web/     React + Vite + TypeScript(SPA)
server/  Node.js (Express) + SQLite(node:sqlite 組み込み)+ ローカルディスクにファイル保存
data/    aegis.db(案件・メモ・リファレンス)と uploads/<案件ID>/(音源・サムネ)
```

- 依存はネイティブビルド不要(SQLite は Node 22 組み込み)。Node.js **22.13 以上**が必要
- データは `data/` フォルダ 1 つにまとまるので、**バックアップはこのフォルダをコピーするだけ**
- 並び順は API 側で `sort=updated | deadline | pinned` を用意済み(UI は「最終更新順」のみ有効。DB に `deadline` / `pinned` 列も確保済み)

## ホスティングの判断

「個人用・複数デバイスからアクセス」「大きな WAV を置く」という要件から、**自宅の常時起動マシン(Mac mini / PC / NAS)で動かし、Tailscale で自分のデバイスからだけ HTTPS アクセスする**構成を推奨します。

- 音源ファイルが増えてもクラウドのストレージ費用がかからない
- インターネットに公開しないので攻撃面が小さい(それでも `APP_PASSWORD` は設定推奨)
- `tailscale serve` で `https://<マシン名>.<tailnet>.ts.net` の正規 HTTPS が得られる
  → Spotify の Redirect URI(HTTPS 必須)と Web Playback SDK(セキュアコンテキスト必須)の条件を満たせる

外出先の回線や自宅マシンを用意できない場合は、VPS や Fly.io/Railway 等(永続ボリューム付き)に同じ Docker イメージを載せても動きます。その場合は **必ず `APP_PASSWORD` を設定**してください。

## セットアップ

### 1. ローカルで試す

```bash
npm install
cp .env.example .env   # 必要に応じて編集
npm run build
npm start              # → http://127.0.0.1:8787
```

開発時は `npm run dev`(API: 8787 / 画面: http://127.0.0.1:5173、ホットリロード)。

### 2. 自宅サーバー + Tailscale で常用する(推奨)

```bash
cp .env.example .env
# .env を編集:
#   PUBLIC_URL=https://<マシン名>.<tailnet>.ts.net
#   APP_PASSWORD=<長めのパスワード>
docker compose up -d --build
sudo tailscale serve --bg 8787
```

iPhone / iPad / ノート PC に Tailscale アプリを入れて同じアカウントでログインすれば、`PUBLIC_URL` で開けます。
Docker を使わない場合は `npm run build && npm start` を launchd / systemd 等で常駐させてください。

> **アクセスは常に `PUBLIC_URL` の URL から**行ってください(Spotify 接続の戻り先がこの URL になるため、別ホスト名で開いていると接続に失敗します)。

### 3. Spotify を有効にする(任意)

埋め込みプレイヤーは設定なしで動きます。検索・プレイリスト・アプリ内再生を使う場合のみ:

1. https://developer.spotify.com/dashboard でアプリを作成(Web API と Web Playback SDK にチェック)
2. **Redirect URI** に `<PUBLIC_URL>/api/spotify/callback` を登録
   - ローカルのみなら `http://127.0.0.1:8787/api/spotify/callback`(Spotify は `localhost` 表記を受け付けないので `127.0.0.1` を使う)
3. Client ID / Client Secret を `.env` の `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` に設定して再起動
4. 画面右上の「Spotify に接続」から認証

注意点(2026 年 2 月以降の Spotify 開発モードのルール):
- アプリ所有者に **Spotify Premium が必要**、開発モードの利用ユーザーは最大 5 人(個人利用なら問題なし)
- 検索結果は 1 回最大 10 件
- アプリ内再生(Web Playback SDK)はデスクトップの Chrome / Edge / Firefox / Safari で動作。iPhone/iPad のブラウザでは SDK が動かないため、埋め込みプレイヤーか「フル再生」(その時 Spotify アプリで再生中のデバイスに送る = Spotify Connect)を使ってください

トークンはサーバー側に保存されるので、一度接続すればどのデバイスからでも使えます。

## Splice のアプリ内表示について(調査結果)

仕様どおりアプリ内表示を第一候補として調査しましたが、**技術的に不可能**と判断し、次善策(Stack URL を保存してワンクリックで開く)を実装しています。

| 調査項目 | 結果 |
|---|---|
| 公式の開発者向け API / embed / oEmbed | 外部 Web アプリ向けの公開 API・埋め込み機能はなし(`/oembed` 等も存在しない)。2026 年時点で Splice が提供しているのは AI ツール向けの「Splice MCP Server(Beta)」で、Web ページへの埋め込み手段ではない |
| iframe 埋め込み | splice.com の全ページ(トップ、`/sounds`、Stack 関連、`/developers` 等)が `X-Frame-Options: SAMEORIGIN` と `Content-Security-Policy: frame-ancestors 'self'` を返すため、ブラウザが他サイト内での表示を拒否する |
| プロキシ経由で中身を表示 | ログイン状態・再生が動かず、規約上も問題があるため不採用 |

**採用した方式**: Stack の共有リンク(Stack 画面の共有ボタンで発行)を案件ごとに保存し、
- 「Splice で開く」= 新規タブ
- 「サイドウィンドウで開く」= 画面右側に縦長ウィンドウで開き、Studio Aegis と並べて使える

Splice が将来 embed を提供した場合は `web/src/components/SpliceSection.tsx` を差し替えるだけで対応できます。

## 環境変数

| 変数 | 既定値 | 説明 |
|---|---|---|
| `PUBLIC_URL` | `http://127.0.0.1:8787` | アクセスに使う URL。Spotify の戻り先に使用 |
| `PORT` / `HOST` | `8787` / `0.0.0.0` | 待ち受け |
| `APP_PASSWORD` | (空) | 設定するとパスワードログインが必須に |
| `SESSION_DAYS` | `30` | ログイン保持日数 |
| `DATA_DIR` | `./data` | DB とアップロードファイルの保存先 |
| `MAX_UPLOAD_MB` | `1024` | 1 ファイルのアップロード上限 |
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | (空) | Spotify 連携 |
| `SPOTIFY_REDIRECT_URI` | `<PUBLIC_URL>/api/spotify/callback` | 必要な場合のみ上書き |
| `SESSION_SECRET` | 自動生成 | 未指定時は `data/.session-secret` に生成・保存 |

## 未確定事項(初期値)

- ビジュアル: タイポグラフィ中心のシンプル路線(ライト/ダークは OS 設定に追従)
- 並び順: 最終更新順のみ(締切順・お気に入り固定は API/DB 準備済み、UI は「準備中」表示)
