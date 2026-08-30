FROM node:22-alpine3.23

RUN apk add --no-cache build-base python3

WORKDIR /home/node

WORKDIR /app
RUN mkdir -p /app/db && mkdir -p /app/log && chown -R node:node /app

COPY --chown=node:node ./federator/package*.json ./federator/
WORKDIR ./federator
RUN (npm install) && (npm ci)

WORKDIR ../
COPY --chown=node:node ./bridge/abi ./bridge/abi/
COPY --chown=node:node ./federator/ ./federator/

WORKDIR ./federator
# Two trees are built while the rearchitecture is in flight:
#   built/federator/src/main.js       the current federator, which is what CMD runs
#   built-app/federator/app/main.js   the wallet-lib federator, selected by overriding `command:`
#                                     in docker-compose.walletlib.yml
# Building both from one image means the same artefact can run either, so switching stacks - or
# rolling back - is a compose change rather than a rebuild.
RUN (cd ./config/ && cp config.sample.js config.js) && \
    npx tsc --build && \
    npx tsc -p tsconfig.app.build.json

WORKDIR ./built/federator

CMD ["node", "./src/main.js"]
