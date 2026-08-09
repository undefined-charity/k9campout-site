# ---- build stage ----
FROM node:22-alpine AS build
WORKDIR /app

# Toolchain fallback for native modules (better-sqlite3) when no musl prebuilt exists
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Container paths are baked into the build (astro.config reads them at build time)
ENV DATABASE_PATH=file:/app/data/emdash.db
ENV UPLOADS_DIR=/app/data/uploads
RUN npm run build

# ---- runtime stage ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4321
ENV DATABASE_PATH=file:/app/data/emdash.db
ENV UPLOADS_DIR=/app/data/uploads

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json

# SQLite database + media uploads live here; mount a volume to persist
RUN mkdir -p /app/data
VOLUME /app/data

EXPOSE 4321
CMD ["node", "./dist/server/entry.mjs"]
