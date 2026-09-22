FROM denoland/deno:alpine
RUN apk add --no-cache git ca-certificates poppler-utils
ENV DENO_DIR=/deno-dir
WORKDIR /app
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
