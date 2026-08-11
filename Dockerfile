FROM node:22-alpine AS base
LABEL authors="sauravtiru"

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm build

FROM node:22-alpine AS runner

WORKDIR /app

RUN corepack enable

ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN pnpm install --prod --frozen-lockfile

COPY --from=base /app/dist ./dist
COPY --from=base /app/views ./views
COPY --from=base /app/public ./public
COPY --from=base /app/mastra-skills ./mastra-skills

EXPOSE 3000

CMD ["node", "dist/main.js"]
