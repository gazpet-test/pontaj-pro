FROM denoland/deno:alpine
RUN apk add --no-cache git ca-certificates poppler-utils xz
# 7-Zip OFICIAL (24.09.2026): despachetarea arhivelor din SEAP — ZIP, RAR și RAR multi-volum (vezi seap.ts).
# Pachetul 7zip din Alpine e compilat FĂRĂ codecul RAR (Botoșani/Huedin: „Cannot open the file as archive").
# 7zzs e binarul static din release-ul oficial; hash-ul fixat — imaginea nu se construiește dacă fișierul diferă.
ARG SEVENZIP_VER=2501
ARG SEVENZIP_SHA256=4ca3b7c6f2f67866b92622818b58233dc70367be2f36b498eb0bdeaaa44b53f4
RUN wget -q -O /tmp/7z.tar.xz "https://github.com/ip7z/7zip/releases/download/25.01/7z${SEVENZIP_VER}-linux-x64.tar.xz" \
 && echo "${SEVENZIP_SHA256}  /tmp/7z.tar.xz" | sha256sum -c - \
 && tar -xJf /tmp/7z.tar.xz -C /tmp 7zzs && install -m 0755 /tmp/7zzs /usr/local/bin/7zz && rm -f /tmp/7z.tar.xz /tmp/7zzs \
 && 7zz i | grep -qi rar
ENV DENO_DIR=/deno-dir
WORKDIR /app
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
