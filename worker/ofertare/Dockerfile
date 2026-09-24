FROM denoland/deno:alpine
# 7zip (24.09.2026): despachetarea arhivelor din SEAP — ZIP, RAR și RAR multi-volum (vezi seap.ts)
RUN apk add --no-cache git ca-certificates poppler-utils 7zip
ENV DENO_DIR=/deno-dir
WORKDIR /app
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
