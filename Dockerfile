FROM node:24-alpine

# curl: zuverlässiger HTTP-Abruf (Bot-/TLS-Filter); tzdata: korrekte Zeitzone
RUN apk add --no-cache curl tzdata

WORKDIR /app
COPY package.json ./
COPY lib ./lib
COPY adapters ./adapters
COPY track.mjs server.mjs scheduler.mjs ./

ENV NODE_ENV=production PORT=8080
EXPOSE 8080

# Healthcheck fürs Dashboard
HEALTHCHECK --interval=60s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health || exit 1

CMD ["node", "scheduler.mjs"]
