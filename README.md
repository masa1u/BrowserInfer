# BrowserInfer

WebGPU + ONNX Runtime Web を使って、ブラウザ内だけで LLM 推論を行うチャットデモ。

サーバーサイドの推論は一切不要。ユーザーの GPU でモデルが動く。

## 使用技術

- **モデル**: Phi-3-mini-4k-instruct（Hugging Face から約 2GB をダウンロード）
- **推論**: ONNX Runtime Web（WebGPU バックエンド）
- **トークナイザー**: Transformers.js
- **キャッシュ**: IndexedDB（2 回目以降は高速起動）
- **サーバー**: Express.js（静的ファイル配信のみ）

## 動作要件

- WebGPU 対応ブラウザ（Chrome 113+ 推奨）
- Docker

## 起動方法

```bash
make dev
```

http://localhost:3000 にアクセス。

初回はモデルのダウンロード（約 2GB）が走るため数分かかる。2 回目以降はキャッシュから読み込まれる。

## コマンド

| コマンド | 内容 |
|---|---|
| `make dev` | ビルド＆起動 |
| `make stop` | 停止 |
| `make build` | イメージのビルドのみ |
| `make clean` | イメージの削除 |
