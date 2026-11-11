# Production image for self-hosting (VPS / Coolify). Not used by Vercel.
# Build:  docker build -t nixcript \
#           --build-arg NEXT_PUBLIC_APP_URL=https://your.domain \
#           --build-arg NEXT_PUBLIC_R2_PRODUCT_IMAGES_URL=... \
#           --build-arg NEXT_PUBLIC_GA_MEASUREMENT_ID=... .
# Run:    docker run -p 3000:3000 --env-file .env.production nixcript

FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* values are baked into the browser bundle at build time, so they
# must be passed here (changing them later needs a rebuild).
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_R2_PRODUCT_IMAGES_URL
ARG NEXT_PUBLIC_GA_MEASUREMENT_ID
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_R2_PRODUCT_IMAGES_URL=$NEXT_PUBLIC_R2_PRODUCT_IMAGES_URL \
    NEXT_PUBLIC_GA_MEASUREMENT_ID=$NEXT_PUBLIC_GA_MEASUREMENT_ID \
    BUILD_STANDALONE=1 \
    NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
