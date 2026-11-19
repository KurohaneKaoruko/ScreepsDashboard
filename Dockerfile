FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY src-web ./src-web
COPY scripts/web ./scripts/web
RUN pnpm build:web

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
COPY --from=build --chown=node:node /app/src-web/dist ./src-web/dist
COPY --from=build --chown=node:node /app/scripts/web ./scripts/web
USER node
EXPOSE 8080
CMD ["node", "scripts/web/serve.mjs"]
