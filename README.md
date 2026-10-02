# Studio Aegis

DAW 以外の制作まわりを 1 か所に集約する、個人用の音楽制作ハブ(Mac アプリ)。
案件ごとに **リファレンス(Spotify)・Splice・構成/進行メモ・雑多アイデア・音源ファイル** をまとめて見渡せます。

> 「DAW と Studio Aegis の 2 つだけ開いていればいい」状態がゴール。姉妹アプリ: Lyric Machine

**Mac の中だけで完結**します。アカウント登録・パスワード・サーバーは不要で、データはすべてこの Mac に保存されます。

## インストール

1. [Releases](../../releases/latest) から dmg をダウンロード
   - Apple Silicon(M1 以降)→ `Studio-Aegis-apple-silicon.dmg` / Intel Mac → `Studio-Aegis-intel.dmg`
2. dmg を開いて Studio Aegis を「アプリケーション」へドラッグ
3. 初回だけ「開けません」と出るので、**システム設定 → プライバシーとセキュリティ** →「このまま開く」(Apple の有料署名をしていない個人用アプリのため)

**更新**: 新しいバージョンが出るとアプリ上部にお知らせが出ます。dmg を入れ直す(「置き換える」)だけで、データはそのまま残ります。

## 機能

| 画面 | 内容 |
|---|---|
| 案件一覧(トップ) | 案件カード(案件名・サムネ・最終更新日)、最終更新順、新規作成 |
| 案件詳細 | 下記 5 セクション + 案件名・サムネイル編集、案件削除 |
| 設定 | Spotify 連携、データの保存場所・バックアップ、アップデート確認 |

- **リファレンス(Spotify)**
  - 曲/アルバム/プレイリスト等の URL・URI を貼ると埋め込みプレイヤーをページ内に表示(Spotify 設定なしで使える)
  - Spotify 接続時: 検索、マイプレイリスト閲覧、**Spotify アプリでのフル再生**(ボタン 1 つで Spotify アプリに送って再生)
  - リファレンスごとにメモ・並べ替え
- **Splice** — 案件ごとに Stack の URL を登録し、「アプリ内で開く」で**ウィンドウ右側のパネルに Splice を表示**(⌘⇧S で開閉、Splice のログインは保存される)
- **構成・進行イメージ** — Markdown(表・見出し・リスト等)、編集/分割/プレビュー切替、自動保存
- **雑多アイデア** — 箇条書き書き殴り用。Enter で次の「- 」を自動挿入、空項目で Enter するとリスト終了、Tab/Shift+Tab でインデント、自動保存
- **ファイル** — 「先方リファレンス / 完成版 / その他」に分けてドラッグ&ドロップで追加。アプリ内で再生(シーク対応)、ダウンロード、分類変更、削除

## データとバックアップ

- 保存場所: `~/Library/Application Support/Studio Aegis/data`(`aegis.db` と `files/`)。普段は触らなくて OK
- Time Machine を使っていれば自動でバックアップされます
- 手動で残したいときは、メニュー「ファイル → バックアップを書き出す…」(設定画面にもボタンあり)

## Spotify を使う(任意)

埋め込みプレイヤーは設定なしで動きます。検索・プレイリスト・Spotify アプリでのフル再生を使う場合のみ、アプリの **設定** 画面の手順に沿って:

1. [Spotify for Developers](https://developer.spotify.com/dashboard) でアプリを作成
2. Redirect URI に `http://127.0.0.1:47823/api/spotify/callback` を登録
3. Client ID を設定画面に貼り付けて保存(Client Secret は不要)→ 右上の「Spotify に接続」

注意: Spotify の開発者向けルール(2026 年 2 月〜)で、アプリ所有者に Spotify Premium が必要です。フル再生は Spotify アプリで鳴ります(アプリ内蔵のブラウザには Spotify の再生に必要な DRM がないため)。

## Splice について(調査結果)

| 方法 | 結果 |
|---|---|
| 公式 API / 埋め込み機能 | 外部アプリ向けの公開 API・embed はなし(2026 年時点で提供されているのは AI ツール向けの「Splice MCP Server」のみ) |
| ページ内に iframe で埋め込み | splice.com は全ページで `X-Frame-Options: SAMEORIGIN` / `frame-ancestors 'self'` を返すため不可 |
| **アプリ内の独立した Web ビューで表示** | **可能(採用)**。iframe ではなく通常のページとして開くので制限に当たらない |

## 開発

```
web/       画面(React + Vite + TypeScript)
desktop/   Mac アプリ(Electron)
  src/main.js        ウィンドウ・Splice パネル・メニュー
  src/server/        ローカルサーバー(127.0.0.1 のみ。SQLite + ファイル保存、Spotify 連携)
```

```bash
npm install && (cd desktop && npm install)
npm run desktop      # 画面をビルドしてアプリを起動
```

`desktop/` か `web/` を変更して push すると、GitHub Actions(macOS)が dmg をビルドして Release に添付します(`.github/workflows/desktop.yml`)。バージョンは `desktop/package.json` の `version` で、上げるとアプリに更新のお知らせが出ます。

- ローカルサーバーは 127.0.0.1 のみで待ち受け、起動ごとに生成する秘密の Cookie を持つアプリのウィンドウ以外からの API アクセスを拒否します
- 並び順は API 側で `sort=updated | deadline | pinned` を用意済み(UI は「最終更新順」のみ有効)
