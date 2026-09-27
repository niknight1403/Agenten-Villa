# syntax=docker/dockerfile:1

# Agenten Villa – Production Image (Client + Express-Server in einem Service)
FROM node:22-bookworm-slim AS build
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

# Web-App und API laufen im selben Container: Standard ist die relative URL
# (leerer Wert), damit Staging, eigene Domains und geaenderte Render-URLs
# ohne Rebuild funktionieren. Native Builds (APK-Workflow) setzen die
# Backend-URL weiterhin explizlich: docker build --build-arg VITE_API_URL=<url>
ARG VITE_API_URL=
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable

COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/drizzle.config.ts ./drizzle.config.ts

EXPOSE 3000
CMD ["node", "dist/index.js"]
