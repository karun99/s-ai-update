#!/usr/bin/env bash
# build-docker.sh — Build Docker image for S-AI
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IMAGE="s-ai"
TAG="${1:-latest}"

echo "=== S-AI Build: Docker Image ==="
echo ""

cd "$ROOT"
docker build -t "$IMAGE:$TAG" .

echo ""
echo "Done! Image: $IMAGE:$TAG"
echo ""
echo "Run:"
echo "  docker run -d -p 3000:3000 -e OPENROUTER_API_KEY=your-key $IMAGE:$TAG"
echo "  docker compose up -d"
