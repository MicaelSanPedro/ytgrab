# Instância Cobalt do YTGrab Web com cookies anônimos de visitante.
# Os cookies ficam num gist SECRETO (não estão neste repo público).
# Pra atualizar os cookies: editar o gist + Render → Manual Deploy.
FROM ghcr.io/imputnet/cobalt:latest

# v=N muda a cada atualização de cookies (evita cache do Docker)
ARG COOKIES_VERSION=5
RUN wget -qO /tmp/cookies.json \
      "https://gist.githubusercontent.com/lucasgabrieldevgg/4a102fc157c06ef59cbdae87d16a5b39/raw/cookies.json?v=${COOKIES_VERSION}"

ENV COOKIE_PATH=/tmp/cookies.json
