# syntax=docker/dockerfile:1
FROM golang:1.26-bookworm AS go-build
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=1 go build -trimpath -o /hypercut-cloud ./cmd/hypercut-cloud

FROM node:24-bookworm-slim AS build
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 ONNXRUNTIME_NODE_INSTALL_CUDA=skip
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates cmake build-essential python3 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
# Keep model setup independent of editor/docs changes. Cache only verified public downloads/builds.
COPY assets ./assets
COPY scripts/setup-transcription.mjs ./scripts/setup-transcription.mjs
COPY scripts/helpers/verified-download.mjs ./scripts/helpers/verified-download.mjs
COPY scripts/helpers/transcription-model.mjs ./scripts/helpers/transcription-model.mjs
ARG WITH_TRANSCRIPTION=1
ARG TARGETARCH
RUN --mount=type=cache,id=hypercut-whisper-build-${TARGETARCH},target=/app/.hypercut/build \
    --mount=type=cache,id=hypercut-whisper-model-${TARGETARCH},target=/model-cache \
    mkdir -p .hypercut/transcription && if [ "$WITH_TRANSCRIPTION" = 1 ]; then HYPERCUT_TRANSCRIPTION_DIR=/model-cache/transcription npm run setup:transcription && cp -a /model-cache/transcription/. .hypercut/transcription/; fi
COPY shared ./shared
COPY src ./src
COPY public ./public
COPY docs/media/silence-editing.png docs/media/walkthrough.mp4 ./docs/media/
COPY tsconfig.json vite.config.ts index.html landing.html ./
RUN npm run build
RUN mkdir -p /native && arch="$TARGETARCH" && if [ "$arch" = "amd64" ]; then arch=x64; fi && cp node_modules/onnxruntime-node/bin/napi-v6/linux/$arch/libonnxruntime.so.1 /native/


FROM debian:bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates libgomp1 && rm -rf /var/lib/apt/lists/*
COPY --from=build /native ./native
COPY --from=build /app/dist ./dist
COPY --from=build /app/.hypercut/transcription /opt/hypercut/transcription
COPY --from=go-build /hypercut-cloud /usr/local/bin/hypercut-cloud
COPY assets ./assets
COPY LICENSE THIRD_PARTY_NOTICES.md ./
RUN groupadd -g 1000 hypercut && useradd -u 1000 -g hypercut -M hypercut && mkdir -p /data && chown hypercut:hypercut /data
ENV HYPERCUT_ROOT=/app HYPERCUT_ONNXRUNTIME_LIBRARY=/app/native/libonnxruntime.so.1 HYPERCUT_CLOUD_DATA=/data HYPERCUT_TRANSCRIPTION_DIR=/opt/hypercut/transcription HYPERCUT_CLOUD_HOST=0.0.0.0 PORT=4328
USER hypercut
EXPOSE 4328
CMD ["hypercut-cloud", "serve"]
