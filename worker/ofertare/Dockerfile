FROM denoland/deno:alpine
RUN apk add --no-cache git ca-certificates poppler-utils
# 7-Zip NU mai e în imaginea workerului (24.09.2026): arhivele din SEAP se despachetează doar în containerul
# izolat seap-extractor (fără rețea și fără chei) — vezi extractor/ și seap.ts.
ENV DENO_DIR=/deno-dir
WORKDIR /app
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
