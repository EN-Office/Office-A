# Office-A — 年間リソース管理ツール 仕様書

## 0. 体制
| 役割 | 担当 |
|---|---|
| PM / アーキテクト / レビュー | Fable |
| コーディング（バックエンド・フロント基盤） | Opus |
| コーディング（スケジュール・ダッシュボード） | Sonnet |
| デバッグ / QA | Sonnet |

## 1. 技術選定（決定事項）
- **言語**: TypeScript（フロント・バック共通）
- **フロント**: React 18 + Vite、Zustand（状態）、@dnd-kit（ドラッグ&ドロップ）、framer-motion（モーション）
- **バック**: Node 22 + Express、`tsx` で起動。ローカル専用（127.0.0.1）
- **保存**: `data/db.json`（単一 JSON、アトミック書込み。Git 管理外）
- **Excel**: `exceljs` によりサーバ側で `.xlsx` 生成 → ブラウザからダウンロード
- **起動**: `npm install` → `npm run dev`（フロント 5173 / API 5174 を同時起動）。本番相当は `npm run build && npm start`（API がビルド済みフロントを配信）

理由: ローカル完結・インストール容易（ネイティブ依存なし）・Excel 出力が堅牢・マウス操作 UI を React + dnd-kit で作りやすい。

## 2. データモデル（`shared/types.ts` が正）
```
Role          役職（ツリーの階層。level 小さいほど上位）  id, name, level, color
Member        人                                      id, name, roleId, parentId(null=ルート), order, note
RoleStatus    案件で必要な役割（PM/PL/開発メンバー/開発BP…追加可） id, name, color, order
Project       案件  id, code, name, unitPrice(円/月・人), startMonth, endMonth("YYYY-MM"), required: {statusId, count}[], color, note
Assignment    アサイン  id, month("YYYY-MM"), memberId, projectId, statusId?, ratio(0.0〜1.0, 既定1)
Settings      fiscalYearStartMonth(1-12, 既定4), currency("JPY"), companyName
DB            { roles, members, roleStatuses, projects, assignments, settings, version }
```
制約:
- 組織は Member.parentId による木。役職は自由に増減可能だが初期値は 部長>課長>課長代理>主任>メンバー。
- 同一 (month, memberId, projectId) は一意。1人・1月に複数案件可（ratio で按分）。
- 案件単価は「1人月あたり」。月売上 = Σ(unitPrice × ratio)。

## 3. API（`/api`、JSON）
```
GET    /api/db                       全データ
PUT    /api/db                       全データ置換（楽観ロック: version 一致必須）
GET    /api/export.xlsx?year=2026    Excel ダウンロード（年度は fiscalYearStartMonth 基準）
POST   /api/import                   db.json のインポート（任意）
POST   /api/import.xlsx[?dryRun=1]   編集した Excel の取り込み（raw body）。{ version, report }、dryRun は { report } のみ
```
クライアントは **全データをメモリに保持し、変更のたびに debounce(400ms) で PUT** する（ローカル単一ユーザー前提で単純化）。

## 4. 画面
1. **組織** `/org` — 役職ツリー。ノードのドラッグで親変更、インライン編集、右クリック/ホバーメニューで追加・削除。
2. **案件** `/projects` — カード一覧 + 詳細ドロワー。必要役割はチップで増減。役割ステータスは設定から追加可能。
3. **アサイン** `/schedule` — 年度 × 人 × 月のマトリクス。右サイドの案件パレットからセルへドラッグでアサイン。セル内チップは別セルへドラッグ移動、Alt+ドラッグで複製、横方向ドラッグで期間塗り。ratio はチップ上のスライダー。列フッターに月売上合計、行末に年間稼働率。
4. **ダッシュボード** `/` — 年度サマリ（売上推移、案件別、役職別稼働、未充足案件）。
5. **設定** `/settings` — 役職階層、役割ステータス、年度開始月、Excel 出力ボタン、バックアップ。

## 5. Excel 出力（シート構成）
1. `メンバー`: ID / 名前 / 役職 / 上長(名前) / 備考（階層はセルのインデント書式）
2. `案件`: ID / 案件コード / 案件名 / 単価 / 開始 / 終了(YYYY-MM) / 必要役割("PM×1, PL×1") / 色 / 備考
3. `アサイン`（表示中の年度）: ID / メンバー / 階層 + 12ヶ月(見出し "YYYY-MM") + 年間稼働。セルは 1 件 1 行 `案件コード [役割] ×ratio`（役割なし・ratio=1 は省略）。末尾に月別売上・稼働行。
4. `売上サマリ`: 案件 × 月の売上、合計
5. `説明`: 編集・取り込みルール

取り込み（`server/excelImport.ts`）: メンバー/案件は ID → 名前/コードの順で照合、なければ作成、シートにないものは削除（データ行 0 件のシートは除く）。アサインは見出しの 12 ヶ月分を置き換え。結果は `ImportReport`（shared/types.ts）。

## 6. デザイン基準（awwwards 水準を狙う）
- **トーン**: 「編集室のレイアウトテーブル」。紙のようなオフホワイト地に濃インク、1 アクセント色。ダークモード対応。
- **タイポ**: 全要素 **メイリオ** に統一（`--font-meiryo`、外部フォント読込なし）。見出しは太字＋大胆なサイズコントラストで階層を作る。数値・コードは `font-variant-numeric: tabular-nums` で桁揃え。
- **グリッド**: 8px ベース。余白を惜しまない。細い罫線（1px, 低コントラスト）。
- **モーション**: 画面遷移・ドロワー・チップのドラッグに framer-motion。150–300ms、ease-out。hover は色でなく「浮き・下線・スケール 1.02」。
- **マウス操作優先**: 全操作がクリック/ドラッグで完結。ホバーで操作ハンドル出現。ドロップ可能域をハイライト。カーソルは grab/grabbing。
- **アクセシビリティ**: focus-visible リング、コントラスト AA。
- 禁止: 既製 UI ライブラリの見た目、角丸過多、グラデ乱用、影の多用。
