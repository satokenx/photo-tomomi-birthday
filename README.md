# Tomomi Birthday - Photo Album

Next.js + Supabase で作るイベントフォトアルバム。

## 技術
- Next.js 14 / React 18 / TypeScript / SCSS
- Supabase Storage（画像保存）
- Supabase Auth（Google）
- デプロイ: Vercel（フロントのみ）

## 主要要件
- タイトル: Tomomi Birthday
- ヒーローイメージ（`/public/hero.jpg` を配置可。未配置時はグラデ背景）
- Google認証後に画像をアップロード（動画不可）
- 一度に最大 30 ファイル
- 写真一覧で「アップロード者名」と「日付」を表示

## セットアップ

1) 依存関係のインストール
```bash
npm i
```

2) 環境変数（`.env.local`）
```
NEXT_PUBLIC_SUPABASE_URL=あなたのSupabaseURL
NEXT_PUBLIC_SUPABASE_ANON_KEY=あなたのAnonKey
```

3) Supabase 設定
- プロジェクト作成後、SQL Editorで以下を実行:
  - `supabase/01_schema.sql`
- Google プロバイダを有効化（Credentials は Google Cloud Console で作成）
  - 承認済みリダイレクトURLに以下を追加（開発・本番両方）
    - `http://localhost:3000`
    - `https://<your-app>.vercel.app`

4) 開発サーバ
```bash
npm run dev
```

5) Vercel デプロイ
- プロジェクトをインポート
- 環境変数（`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`）をVercelに設定
- デプロイ

## 備考
- 画像バケット: `tomomi-photos`（public）
- RLS:
  - `photos` テーブルは「Select: public」「Insert: authenticated (自分のuidのみ)」
  - `storage.objects` は `tomomi-photos` バケットに対して「Select: public」「Insert: authenticated」
- `public/hero.jpg` を配置すればヒーローに反映されます（未配置でもグラデーション表示）


