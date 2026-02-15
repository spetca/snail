# --- Build Stage ---
FROM ubuntu:22.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive

# Install build dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
    git \
    pkg-config \
    libfftw3-dev \
    nlohmann-json3-dev \
    curl \
    python3 \
    automake \
    autoconf \
    && rm -rf /var/lib/apt/lists/*

# Install liquid-dsp from source
RUN git clone https://github.com/jgaeddert/liquid-dsp.git /tmp/liquid-dsp \
    && cd /tmp/liquid-dsp \
    && ./bootstrap.sh \
    && ./configure \
    && make -j$(nproc) \
    && make install \
    && ldconfig

# Install Node.js
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs

WORKDIR /app

# Copy dependency manifests
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build native C++ addon
RUN npm run build:native

# Build Electron app (renderer + main)
RUN npm run build

# --- Runtime Stage ---
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV DISPLAY=:0
ENV LIBGL_ALWAYS_SOFTWARE=1
ENV MESA_GL_VERSION_OVERRIDE=2.1
ENV GALLIUM_DRIVER=llvmpipe
ENV XDG_RUNTIME_DIR=/tmp/runtime-root

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    libfftw3-single3 \
    xvfb \
    x11vnc \
    fluxbox \
    dbus-x11 \
    net-tools \
    git \
    python3 \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libgtk-3-0 \
    libgbm1 \
    libasound2 \
    curl \
    libgl1-mesa-dri \
    libgl1-mesa-glx \
    mesa-utils \
    && rm -rf /var/lib/apt/lists/*

# Install noVNC + websockify (pinned versions for compatibility)
RUN git clone --branch v1.5.0 --depth 1 https://github.com/novnc/noVNC.git /opt/noVNC \
    && git clone --branch v0.12.0 --depth 1 https://github.com/novnc/websockify /opt/noVNC/utils/websockify \
    && ln -s /opt/noVNC/vnc.html /opt/noVNC/index.html

# Install Node.js in runtime stage
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs

# Install liquid-dsp (copying from builder)
COPY --from=builder /usr/local/lib/libliquid.so /usr/local/lib/libliquid.so
RUN ldconfig

WORKDIR /app

# Copy built application and production dependencies
COPY --from=builder /app/out ./out
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Copy native addon (Electron runs unpackaged in Docker, so it needs the dev path)
COPY --from=builder /app/src/native/build/Release/snail_native.node ./src/native/build/Release/snail_native.node

# Copy startup script
COPY scripts/start-vnc.sh /app/scripts/start-vnc.sh
RUN chmod +x /app/scripts/start-vnc.sh

# Web VNC Port
EXPOSE 6080

# Default data directory for mounting
RUN mkdir /data
RUN mkdir -p /tmp/runtime-root && chmod 700 /tmp/runtime-root
VOLUME /data

ENTRYPOINT ["/app/scripts/start-vnc.sh"]
