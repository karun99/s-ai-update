# syntax=docker/dockerfile:1

# ============================================================================
# S-AI — Multi-Agent Swarm Intelligence
#
#   docker build -t s-ai .
#   docker run -p 3000:3000 -v s-ai-data:/root/.s-ai -v s-ai-config:/app/.s-ai s-ai
#
# State layout inside the container:
#   /root/.s-ai   -> data (knowledge graph, cache, ai-engine artifacts, personas)
#   /app/.s-ai    -> config.json written by `s-ai setup` / `s-ai config set`
# ============================================================================

# ---------- Stage 1: build (compile TypeScript -> dist/) --------------------
FROM node:22-slim AS build
WORKDIR /app

# Install production deps first (pure-JS, so no build toolchain needed).
# --ignore-scripts: the package postinstall/prepare would otherwise try to
# compile before ./src exists. We run the build explicitly below.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Compile TypeScript -> dist/
COPY tsconfig.json ./
COPY src/ src/
COPY skills/ skills/
COPY bin/ bin/
COPY public/ public/
COPY config.default.json ./
RUN npm run build

# ---------- Stage 2: runtime -------------------------------------------------
FROM node:22-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000

# Runtime tools:
#   tini   -> proper PID 1 with signal forwarding (Ctrl+C / docker stop)
#   git    -> `s-ai skill install <pkg>` (npm install from git URLs)
#   ffmpeg -> AI Studio (video generation). Remove if you don't need it.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini git ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Copy the compiled app BEFORE npm ci so the package postinstall/prepare
# scripts see dist/ and skip rebuilding (they require devDependencies).
COPY --from=build /app/dist/ dist/
COPY --from=build /app/bin/ bin/
COPY --from=build /app/public/ public/
COPY --from=build /app/skills/ skills/
COPY --from=build /app/config.default.json ./

# Production deps only: no dev tools, and no optional playwright (avoids the
# ~300MB browser download).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional --ignore-scripts

# Persistent state volumes (config is written to /app/.s-ai from the app's cwd).
VOLUME ["/root/.s-ai", "/app/.s-ai"]

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "bin/you-ai.js", "serve"]
