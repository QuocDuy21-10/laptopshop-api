# syntax=docker/dockerfile:1
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app
ENV CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# python3/make/g++ only compile bcrypt here; they never reach the runtime image
RUN apk add --no-cache openssl python3 make g++ && corepack enable
# pnpm version comes from "packageManager" in package.json (corepack)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile --ignore-scripts \
  && pnpm rebuild bcrypt sharp \
  && pnpm exec prisma generate
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm run build && pnpm prune --prod --ignore-scripts

FROM node:${NODE_VERSION}-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apk upgrade --no-cache && apk add --no-cache openssl
# code stays root-owned (read-only for the app); node owns only what it writes:
# node_modules (Prisma engines) and public/images (uploads)
COPY --from=build /app/package.json ./
COPY --from=build /app/dist ./dist
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY prisma ./prisma
COPY --chown=node:node public ./public
COPY docker/entrypoint.sh ./entrypoint.sh
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-8080}/healthz || exit 1
ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "dist/server.js"]
