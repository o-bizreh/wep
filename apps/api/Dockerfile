FROM node:20-alpine AS base
RUN npm install -g pnpm@9.15.4
WORKDIR /app

# Copy workspace manifests for dependency install
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/shared/domain-types/package.json ./packages/shared/domain-types/
COPY packages/shared/aws-clients/package.json ./packages/shared/aws-clients/
COPY packages/shared/github-client/package.json ./packages/shared/github-client/
COPY packages/shared/event-bus/package.json ./packages/shared/event-bus/
COPY packages/shared/slack-notifier/package.json ./packages/shared/slack-notifier/
COPY packages/ui/package.json ./packages/ui/
COPY domains/service-catalog/package.json ./domains/service-catalog/
COPY domains/deployment-tracker/package.json ./domains/deployment-tracker/
COPY domains/velocity-metrics/package.json ./domains/velocity-metrics/
COPY domains/pipeline-analytics/package.json ./domains/pipeline-analytics/
COPY domains/cost-intelligence/package.json ./domains/cost-intelligence/
COPY domains/self-service/package.json ./domains/self-service/
COPY domains/security/package.json ./domains/security/
COPY domains/npm-audit/package.json ./domains/npm-audit/
COPY domains/ci-cost/package.json ./domains/ci-cost/
COPY domains/on-call/package.json ./domains/on-call/
COPY apps/api/package.json ./apps/api/
RUN pnpm install --frozen-lockfile

# Build all workspace packages the API depends on
FROM deps AS builder
COPY packages/ ./packages/
COPY domains/ ./domains/
COPY apps/api/ ./apps/api/
RUN pnpm --filter @wep/domain-types build
RUN pnpm --filter @wep/aws-clients build
RUN pnpm --filter @wep/github-client build
RUN pnpm --filter @wep/event-bus build
RUN pnpm --filter @wep/slack-notifier build
RUN pnpm --filter @wep/service-catalog build
RUN pnpm --filter @wep/deployment-tracker build
RUN pnpm --filter @wep/velocity-metrics build
RUN pnpm --filter @wep/pipeline-analytics build
RUN pnpm --filter @wep/cost-intelligence build
RUN pnpm --filter @wep/self-service build
RUN pnpm --filter @wep/security build
RUN pnpm --filter @wep/npm-audit build
RUN pnpm --filter @wep/ci-cost build
RUN pnpm --filter @wep/on-call build
RUN pnpm --filter @wep/api build

FROM node:20-alpine AS runner
RUN npm install -g pnpm@9.15.4
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/domains ./domains
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/
ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "apps/api/dist/index.js"]
