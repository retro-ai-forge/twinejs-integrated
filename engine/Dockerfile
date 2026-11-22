# The story engine, deployed as engine-test (WORKER_MODE=single-use) and
# engine-live (WORKER_MODE=shared); see SETUP.md "Story engines".
#
# Build from the twinejs-integrated folder (it needs the editor's publish code,
# runtime and SugarCube format):
#   docker build -f engine/Dockerfile -t wudlands-engine .
#
# Node only, no secrets, no outbound network (the platform's network has none).
# The process runs under Node's permission model: worker threads, files read
# only below /app/engine, no child processes, no file writes.

FROM node:22-slim AS build
WORKDIR /app
COPY engine/package.json engine/package-lock.json engine/
RUN cd engine && npm ci --no-audit --no-fund
COPY src/util/publish.ts src/util/wudlands-runtime.ts src/util/
COPY public/story-formats/sugarcube-2.37.3/format.js public/story-formats/sugarcube-2.37.3/
COPY engine/build.js engine/
COPY engine/src engine/src
RUN cd engine && node build.js && npm prune --omit=dev

FROM node:22-slim
ENV NODE_ENV=production PORT=8080
WORKDIR /app/engine
COPY --from=build /app/engine/package.json ./
COPY --from=build /app/engine/node_modules ./node_modules
COPY --from=build /app/engine/build ./build
COPY --from=build /app/engine/src ./src
USER node
EXPOSE 8080
CMD ["node", "--permission", "--allow-fs-read=/app/engine", "--allow-worker", "src/server.js"]
