FROM node:22-alpine

WORKDIR /webmixer

COPY . .

RUN npm ci --omit-dev

ENTRYPOINT [ "node", "." ]