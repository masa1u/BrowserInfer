.PHONY: dev build stop clean

# Docker設定
IMAGE_NAME = browser-infer
PORT = 3000

# ローカルでDockerコンテナを起動
dev:
	docker build -t $(IMAGE_NAME) .
	docker run --rm -d -p $(PORT):$(PORT) --name $(IMAGE_NAME)-dev $(IMAGE_NAME)
	@echo "Server running at http://localhost:$(PORT)"
	@echo "Stop with: make stop"

# サーバーを停止
stop:
	docker stop $(IMAGE_NAME)-dev || true

# Dockerイメージのビルド
build:
	docker build -t $(IMAGE_NAME) .

# リソースクリーンアップ
clean:
	docker rmi $(IMAGE_NAME) || true