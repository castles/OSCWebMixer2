FROM node:23.8.0-alpine3.21

WORKDIR /webmixer

COPY . .

RUN apk add git && npm install

ENTRYPOINT [ "node", "." ]
