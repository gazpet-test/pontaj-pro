# Extractorul SEAP izolat — vezi extractor.sh. Fără rețea / chei / NAS: le impune docker-compose.yml.
FROM alpine:3.20
ARG SEVENZIP_VER=2501
ARG SEVENZIP_SHA256=4ca3b7c6f2f67866b92622818b58233dc70367be2f36b498eb0bdeaaa44b53f4
RUN apk add --no-cache xz \
 && wget -q -O /tmp/7z.tar.xz "https://github.com/ip7z/7zip/releases/download/25.01/7z${SEVENZIP_VER}-linux-x64.tar.xz" \
 && echo "${SEVENZIP_SHA256}  /tmp/7z.tar.xz" | sha256sum -c - \
 && xz -dc /tmp/7z.tar.xz | tar -x -C /tmp 7zzs && install -m 0755 /tmp/7zzs /usr/local/bin/7zz && rm -f /tmp/7z.tar.xz /tmp/7zzs \
 && 7zz i | grep -qi rar \
 && adduser -D -H -u 10001 extractor
COPY extractor.sh /extractor.sh
RUN chmod 0755 /extractor.sh
USER 10001:10001
ENTRYPOINT ["/extractor.sh"]
