.PHONY: dev build deploy stop clean

# Docker設定
IMAGE_NAME = browser-infer
PORT = 3000

# AWS設定
AWS_REGION = ap-northeast-1
ECR_REPOSITORY = browser-infer

# 開発用（ローカルでDockerコンテナを起動）
dev:
	docker build -t $(IMAGE_NAME) .
	docker run --rm -d -p $(PORT):$(PORT) --name $(IMAGE_NAME)-dev $(IMAGE_NAME)
	@echo "Server running at http://localhost:$(PORT)"
	@echo "Stop with: make stop"

# 開発サーバーを停止
stop:
	docker stop $(IMAGE_NAME)-dev || true

# 本番用ビルド
build:
	docker build -t $(IMAGE_NAME) .

# AWS ECRにデプロイ
deploy: build
	aws ecr get-login-password --region $(AWS_REGION) | docker login --username AWS --password-stdin $$(aws sts get-caller-identity --query Account --output text).dkr.ecr.$(AWS_REGION).amazonaws.com
	docker tag $(IMAGE_NAME):latest $$(aws sts get-caller-identity --query Account --output text).dkr.ecr.$(AWS_REGION).amazonaws.com/$(ECR_REPOSITORY):latest
	docker push $$(aws sts get-caller-identity --query Account --output text).dkr.ecr.$(AWS_REGION).amazonaws.com/$(ECR_REPOSITORY):latest

# リソースクリーンアップ
clean:
	docker rmi $(IMAGE_NAME) || true