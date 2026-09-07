# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 ONNXRUNTIME_NODE_INSTALL_CUDA=skip
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates cmake build-essential python3 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
# Keep model setup independent of editor/docs changes. Cache only verified public downloads/builds.
COPY server ./server
COPY shared ./shared
COPY assets ./assets
COPY scripts/setup-transcription.mjs ./scripts/setup-transcription.mjs
COPY scripts/helpers/verified-download.mjs ./scripts/helpers/verified-download.mjs
ARG WITH_TRANSCRIPTION=1
ARG TARGETARCH
RUN --mount=type=cache,id=hypercut-whisper-build-${TARGETARCH},target=/app/.hypercut/build \
    --mount=type=cache,id=hypercut-whisper-model-${TARGETARCH},target=/model-cache \
    mkdir -p .hypercut/transcription && if [ "$WITH_TRANSCRIPTION" = 1 ]; then HYPERCUT_TRANSCRIPTION_DIR=/model-cache/transcription npm run setup:transcription && cp -a /model-cache/transcription/. .hypercut/transcription/; fi
COPY src ./src
COPY tsconfig.json vite.config.ts index.html ./
RUN npm run build
RUN npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates libgomp1 && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/.hypercut/transcription /opt/hypercut/transcription
COPY server ./server
COPY shared ./shared
COPY assets ./assets
COPY scripts/cloud-user.mjs ./scripts/cloud-user.mjs
COPY package.json LICENSE THIRD_PARTY_NOTICES.md ./
RUN mkdir -p /data && chown node:node /data
ENV NODE_ENV=production HYPERCUT_CLOUD_DATA=/data HYPERCUT_TRANSCRIPTION_DIR=/opt/hypercut/transcription HYPERCUT_CLOUD_HOST=0.0.0.0 PORT=4328
USER node
EXPOSE 4328
CMD ["node", "server/cloud/index.mjs"]
