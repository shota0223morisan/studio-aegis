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
- **Splice** — Stack の共有 URL を 1 件登録。「Splice で開く」(新規タブ)/「サイドウィンドウで開く」(画面右側に並べて開く)。デスクトップ版ではアプリ内のパネルに表示
- **構成・進行イメージ** — Markdown(表・見出し・リスト等 GFM 対応)、編集/分割/プレビュー切替、自動保存
- **雑多アイデア** — 箇条書き書き殴り用。Enter で次の「- 」を自動挿入、空項目で Enter するとリスト終了、Tab/Shift+Tab でインデント、自動保存
- **ファイル** — 「先方リファレンス / 完成版 / その他」に分けてアップロード(ドラッグ&ドロップ・複数可、進捗表示)。ブラウザ内再生(シーク対応)、ダウンロード、分類変更、削除
  - wav / mp3 / aiff / flac / m4a / ogg / zip など。1 ファイル上限は既定 5GB
  - 再生は同時に 1 つだけ(他のファイルや Spotify は自動で一時停止)

## デスクトップアプリ(Mac)

`.dmg` でインストールできる Mac アプリ版があります。中身は Cloudflare にデプロイした Studio Aegis を表示するので、**スマホやほかの PC とデータは同期**されます(Web 版をデプロイ・更新すればアプリ側の更新は不要)。

- **ダウンロード**: GitHub の [Releases](../../releases) から
  - Apple Silicon(M1 以降)→ `Studio-Aegis-apple-silicon.dmg` / Intel Mac → `Studio-Aegis-intel.dmg`
- **インストール**: dmg を開いて「アプリケーション」へドラッグ。初回だけ「開けません」と出るので、システム設定 → プライバシーとセキュリティ →「このまま開く」(Apple の有料署名をしていない個人用アプリのため)
- **デスクトップ版だけの機能**
  - **Splice をアプリ内に表示**: 「アプリ内で開く」で右側のパネルに Splice が開く(⌘⇧S で開閉、ログインは保存される)。ブラウザでは Splice が埋め込みを拒否しますが、アプリ内の独立した画面としてなら表示できます
  - Dock アイコン、Mac 標準のメニュー・ショートカット
- Spotify のフル再生は **Spotify アプリで鳴ります**(アプリ版の内蔵ブラウザには Spotify の再生に必要な DRM が入っていないため。Spotify アプリを起動しておけば「▶ Spotify アプリで再生」で再生できます)
- 接続先を変えるときは メニュー → Studio Aegis → 「サーバー URL を変更…」

ビルドは `desktop/` を変更して push すると GitHub Actions(macOS)が自動で行い、Release に dmg を添付します(`.github/workflows/desktop.yml`)。ローカルで動かす場合は `cd desktop && npm install && npm start`(`AEGIS_SERVER_URL=http://127.0.0.1:8787 npm start` でローカルの開発サーバーに接続)。

## 技術構成

**Cloudflare 上で完結するサーバーレス構成**です。自分のマシンを起動しておく必要はなく、使っていないときは何も動きません。

```
web/            React + Vite + TypeScript(SPA)… Workers Static Assets で配信
worker/         Cloudflare Worker(Hono)… API・認証・Spotify 連携
                ├ D1 … 案件・メモ・リファレンス・ファイル情報(SQLite 互換 DB)
                └ R2 … アップロードした音源・サムネイル
wrangler.jsonc  Cloudflare の設定
```

- アップロードは 20MB ずつに分割して R2 に直接書き込むので、数 GB の WAV / ステム zip でも OK(既定の上限は 1 ファイル 5GB、`MAX_UPLOAD_MB`)
- 再生は Range リクエスト対応(長い WAV でもシーク可能)
- 並び順は API 側で `sort=updated | deadline | pinned` を用意済み(UI は「最終更新順」のみ有効。DB に `deadline` / `pinned` 列も確保済み)

### なぜ Cloudflare か

| 要件 | Cloudflare での対応 |
|---|---|
| 常時起動マシンを使わない | Workers はリクエストが来たときだけ動く。サーバー管理なし |
| 複数デバイスからアクセス | `https://studio-aegis.<サブドメイン>.workers.dev` でどこからでも |
| 大きな音源ファイル | R2 は**転送量(ダウンロード・再生)が無料**、保存 10GB まで無料 |
| HTTPS | 最初から HTTPS(Spotify の Redirect URI・Web Playback SDK の条件を満たす) |
| 費用 | 個人利用なら基本**無料枠内**。音源が 10GB を超えた分だけ約 $0.015/GB・月(100GB でも月 $1.35 程度) |

無料枠の目安: Workers 10 万リクエスト/日、D1 5GB、R2 10GB・書き込み 100 万回/月・読み出し 1000 万回/月。

## セットアップ

### 1. デプロイ(初回だけ・10 分程度)

必要なもの: Node.js 20 以上、Cloudflare アカウント(無料)

1. Cloudflare ダッシュボード → **R2** を開き、R2 を有効化する(支払い方法の登録が必要ですが、無料枠内なら請求はありません)
2. ターミナルで:

```bash
npm install
npx wrangler login          # ブラウザで Cloudflare にログイン
npm run setup:cloudflare    # D1/R2 作成 → デプロイ → パスワード設定 まで自動
```

途中で「workers.dev のサブドメインを登録しますか」と聞かれたら `y` を押して好きな名前を入力します(URL の一部になります)。
最後に表示される `https://studio-aegis.<サブドメイン>.workers.dev` を開き、設定したパスワードでログインすれば使えます。スマホならホーム画面に追加しておくと便利です。

> 安全のため、**パスワード (`APP_PASSWORD`) が未設定のままだとアプリは停止**し、案件やファイルは一切見えません。変更は `npx wrangler secret put APP_PASSWORD`。

### 2. 更新するとき

```bash
npm run deploy   # ビルド → DB マイグレーション → デプロイ
```

**自動デプロイ(推奨)**: Cloudflare ダッシュボード → Workers & Pages → studio-aegis → Settings → Build でこのリポジトリを接続しておくと、GitHub に push されるたびに自動でビルド・デプロイされます(手元にフォルダは不要)。

| 項目 | 値 |
|---|---|
| Branch | `claude/modest-mccarthy-l26qtf` |
| Build command | `npm run build` |
| Deploy command | `npm run deploy:ci` |
| Root directory | `/` |

### 3. Spotify を有効にする(任意)

埋め込みプレイヤーは設定なしで動きます。検索・プレイリスト・アプリ内再生を使う場合のみ:

1. https://developer.spotify.com/dashboard でアプリを作成(Web API と Web Playback SDK にチェック)
2. **Redirect URI** に `https://studio-aegis.<サブドメイン>.workers.dev/api/spotify/callback` を登録
   - ローカル開発でも使うなら `http://127.0.0.1:8787/api/spotify/callback` も追加(Spotify は `localhost` 表記を受け付けないので `127.0.0.1`)
3. Client ID / Secret を登録:
   ```bash
   npx wrangler secret put SPOTIFY_CLIENT_ID
   npx wrangler secret put SPOTIFY_CLIENT_SECRET
   ```
4. アプリ右上の「Spotify に接続」から認証

注意点(2026 年 2 月以降の Spotify 開発モードのルール):
- アプリ所有者に **Spotify Premium が必要**、開発モードの利用ユーザーは最大 5 人(個人利用なら問題なし)
- 検索結果は 1 回最大 10 件
- アプリ内再生(Web Playback SDK)はデスクトップの Chrome / Edge / Firefox / Safari で動作。iPhone/iPad のブラウザでは SDK が動かないため、埋め込みプレイヤーか「フル再生」(その時 Spotify アプリで再生中のデバイスに送る = Spotify Connect)を使ってください

トークンはサーバー側(D1)に保存されるので、一度接続すればどのデバイスからでも使えます。

### ローカル開発

```bash
npm install
cp .dev.vars.example .dev.vars   # 必要ならパスワードや Spotify のキーを記入
npm run dev                      # 画面: http://127.0.0.1:5173(API は 8787。D1/R2 はローカルに再現される)
```

### バックアップ

```bash
npx wrangler d1 export studio-aegis --remote --output backup.sql   # 案件・メモ
```

音源ファイルは R2 に保存されます(R2 は複数拠点に冗長保存されるので、ディスク故障でファイルを失う心配はほぼありません)。D1 は過去 30 日の任意の時点に戻せる「タイムトラベル」機能もあります(`npx wrangler d1 time-travel`)。

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

**デスクトップ版**では、Splice をアプリ内の独立した Web ビュー(iframe ではない)として右側パネルに表示しているため、アプリ内表示を実現しています。

Splice が将来 embed を提供した場合は `web/src/components/SpliceSection.tsx` を差し替えるだけで対応できます。

## 設定値

| 名前 | 種類 | 説明 |
|---|---|---|
| `APP_PASSWORD` | シークレット | ログインパスワード(デプロイ環境では必須) |
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | シークレット | Spotify 連携(任意) |
| `SPOTIFY_REDIRECT_URI` | シークレット | 戻り先 URL の上書き(既定はアクセス中のオリジン + `/api/spotify/callback`) |
| `SESSION_SECRET` | シークレット | 任意。未指定なら初回に自動生成して D1 に保存 |
| `MAX_UPLOAD_MB` | `wrangler.jsonc` の vars | 1 ファイルのアップロード上限(既定 5120) |

シークレットは `npx wrangler secret put <名前>`、ローカル開発では `.dev.vars` に書きます。

## 未確定事項(初期値)

- ビジュアル: タイポグラフィ中心のシンプル路線(ライト/ダークは OS 設定に追従)
- 並び順: 最終更新順のみ(締切順・お気に入り固定は API/DB 準備済み、UI は「準備中」表示)
