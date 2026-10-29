# =====================================================================
# VIDEO RENDER IMAGE: Node, headless Chromium, HyperFrames and ffmpeg.
# Nebius Serverless AI runs one CPU job per video from this image
# (cpu-d3, 8vcpu-32gb, 30 GiB disk, 1 h timeout); render.mjs reads the
# manifest at MANIFEST_URL, renders, muxes, uploads and calls back.
#
# Build and push (spike S2, docs/knowledge-modules-plan.md):
#   docker build -t cr.<region>.nebius.cloud/<registry>/video-render:1 \
#     --build-arg HYPERFRAMES_VERSION=<version> scripts/video/render
#   docker push cr.<region>.nebius.cloud/<registry>/video-render:1
# Then set VIDEO_RENDER_IMAGE to that tag on the app server.
# =====================================================================

FROM node:22-bookworm-slim

# Pin the HyperFrames CLI the spike verified; a render must not change under us
ARG HYPERFRAMES_VERSION=latest

ENV DEBIAN_FRONTEND=noninteractive \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    CHROME_PATH=/usr/bin/chromium \
    RENDER_WORKDIR=/work \
    NODE_ENV=production

# Chromium for HyperFrames, ffmpeg for the mux and poster, Inter for the scene templates
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium ffmpeg fonts-inter fonts-noto-color-emoji ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN npm install -g "hyperframes@${HYPERFRAMES_VERSION}" && npm cache clean --force

WORKDIR /app
COPY render.mjs /app/render.mjs

RUN useradd --create-home --uid 10001 render && mkdir -p /work && chown render /work
USER render

ENTRYPOINT ["node", "/app/render.mjs"]
