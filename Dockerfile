# Use an official Node.js runtime as a parent image
FROM node:20-bookworm-slim AS base

# Install dependencies only when needed
FROM base AS deps
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Install dependencies based on the preferred package manager
COPY package.json package-lock.json* yarn.lock* pnpm-lock.yaml* ./
COPY prisma ./prisma
RUN \
  if [ -f yarn.lock ]; then yarn --frozen-lockfile; \
  elif [ -f package-lock.json ]; then npm ci; \
  elif [ -f pnpm-lock.yaml ]; then corepack enable pnpm && pnpm i --frozen-lockfile; \
  else echo "Lockfile not found." && npm i; \
  fi

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
ARG NEXT_PUBLIC_APP_VERSION
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Next.js build
RUN \
  if [ -f yarn.lock ]; then yarn run build; \
  elif [ -f package-lock.json ]; then npm run build; \
  elif [ -f pnpm-lock.yaml ]; then corepack enable pnpm && pnpm run build; \
  else npm run build; \
  fi

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app
ARG TARGETARCH

RUN apt-get update && apt-get install -y openssl ffmpeg aubio-tools python3 python3-venv && rm -rf /var/lib/apt/lists/*
RUN if [ "${TARGETARCH:-$(dpkg --print-architecture)}" = "amd64" ]; then \
      python3 -m venv /opt/essentia && \
      /opt/essentia/bin/pip install --no-cache-dir --upgrade pip && \
      /opt/essentia/bin/pip install --no-cache-dir "numpy<2" essentia==2.1b6.dev1110 && \
      /opt/essentia/bin/python -c "import numpy; import essentia.standard as es; print('Essentia ready with NumPy', numpy.__version__)"; \
    else \
      echo "Skipping Essentia install for TARGETARCH=${TARGETARCH:-$(dpkg --print-architecture)}"; \
    fi

ENV NODE_ENV=production
ENV LOCAL_BPM_ESSENTIA_PYTHON=/opt/essentia/bin/python
ENV LOCAL_BPM_TEMP_DIR=/app/tmp/mixarr-bpm
# Uncomment the following line in case you want to disable telemetry during runtime.
# ENV NEXT_TELEMETRY_DISABLED=1

RUN groupadd --system --gid 1001 nodejs
RUN useradd --system --uid 1001 --gid 1001 nextjs
RUN mkdir -p /app/tmp && chown -R nextjs:nodejs /app/tmp

COPY --from=builder /app/public ./public

# Set the correct permission for prerender cache
RUN mkdir .next
RUN chown nextjs:nodejs .next

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma

ENV npm_config_cache=/tmp/.npm

USER nextjs

EXPOSE 3000

ENV PORT=3000
# set hostname to localhost
ENV HOSTNAME="0.0.0.0"

# Run Prisma migrations and then start Next.js
CMD ["sh", "-c", "npx --yes prisma@5.14.0 db push --skip-generate && node server.js"]
