# SCHIȚĂ (E4, 25.09.2026) — NU e deployat. Convertor .doc/.xls/.rtf → PDF cu LibreOffice headless,
# container IZOLAT pe NAS: fără chei Supabase, fără rețea, doar volumul partajat /conv.
# Plan complet: docs/CONVERSIE_DOC_LIBREOFFICE.md
FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends libreoffice-writer-nogui libreoffice-calc-nogui \
      fonts-dejavu fonts-liberation fonts-crosextra-carlito fonts-crosextra-caladea inotify-tools coreutils \
 && rm -rf /var/lib/apt/lists/*
# utilizator neprivilegiat; profil LibreOffice în /tmp (rootfs read-only în compose)
RUN useradd -u 10050 -m conv
COPY convertor.sh /usr/local/bin/convertor.sh
RUN chmod 0755 /usr/local/bin/convertor.sh
USER conv
ENV HOME=/tmp/conv-home
ENTRYPOINT ["/usr/local/bin/convertor.sh"]
