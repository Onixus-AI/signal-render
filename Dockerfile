# signal-render worker — Node 20 + ffmpeg + headless Chromium
FROM node:20-bookworm-slim

# ffmpeg + ffprobe (the #1 reason /health reports video_render:false)
# chromium (+ fonts) for /render and /render-html — renders HTML/CSS templates
# to PNG for social stills. Installed via apt instead of puppeteer's bundled
# download so the build pulls the exact library set Debian already knows how
# to satisfy, rather than puppeteer's own postinstall fetch.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg chromium ca-certificates fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

# EffectCraft (storytold/effectcraft, MIT OR Apache-2.0): headless motion
# graphics for TWIN graphic beats. Pinned by version and sha256; effectcraft.js
# falls back to the libass graphic if the CLI is missing or fails.
ARG EFFECTCRAFT_VERSION=0.8.0
ARG EFFECTCRAFT_SHA256=725c88cf379122d70f941dd3edacb54479d63ff1e2a00fae318eaee02ad762c4
ADD https://github.com/storytold/effectcraft/releases/download/v${EFFECTCRAFT_VERSION}/effectcraft-${EFFECTCRAFT_VERSION}-linux-x86_64.tar.gz /tmp/effectcraft.tar.gz
RUN echo "${EFFECTCRAFT_SHA256}  /tmp/effectcraft.tar.gz" | sha256sum -c - \
  && mkdir -p /opt/effectcraft \
  && tar -xzf /tmp/effectcraft.tar.gz -C /opt/effectcraft --strip-components 1 \
  && rm /tmp/effectcraft.tar.gz \
  && /opt/effectcraft/bin/effectcraft-cli --version

WORKDIR /app

# Lockfile-pinned install so the image matches what CI tested.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js status-delivery.js motion-director.js site-capture.js ugc-timing.js ad-adaptation.js ugc-graphics.js effectcraft.js ./
COPY templates ./templates
COPY mograph ./mograph

ENV NODE_ENV=production
ENV PORT=8080
ENV CHROMIUM_PATH=/usr/bin/chromium
EXPOSE 8080

CMD ["node", "server.js"]

