FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache openssl
RUN corepack enable && corepack prepare pnpm@11.24.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile --ignore-scripts && pnpm exec prisma generate

FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache openssl \
  && apk add --no-cache --virtual .native-build-deps python3 make g++
RUN corepack enable && corepack prepare pnpm@11.24.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile --prod --ignore-scripts \
  && pnpm rebuild bcrypt sharp \
  && pnpm exec prisma generate \
  && pnpm store prune \
  && apk del .native-build-deps
COPY --from=build /app/dist ./dist
COPY public ./public
COPY docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x entrypoint.sh && chown -R node:node /app
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-8080}/healthz || exit 1
ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "dist/server.js"]
