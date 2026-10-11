# Engine + dashboard in one image. Build: docker build -t vantrel .
FROM node:20-slim AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm ci || npm install
COPY web/ ./
ARG VITE_AUTH0_DOMAIN VITE_AUTH0_CLIENT_ID VITE_AUTH0_AUDIENCE
RUN npm run build

FROM rust:1-slim AS engine
WORKDIR /engine
COPY engine/ ./
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=engine /engine/target/release/vantrel-engine /app/vantrel-engine
COPY --from=web /web/dist /app/web
COPY data/backtest.json /app/seed/backtest.json
COPY backtest/fixtures /app/fixtures
ENV WEB_DIR=/app/web DATA_DIR=/data PORT=8080 OFFLINE_FIXTURES=/app/fixtures
EXPOSE 8080
CMD ["sh", "-c", "mkdir -p /data && cp -n /app/seed/backtest.json /data/ 2>/dev/null; exec /app/vantrel-engine"]
