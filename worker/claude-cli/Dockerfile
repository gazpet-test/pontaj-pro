# gazpet-claude-cli — Claude Code CLI pe NAS Terra, pilot READ-ONLY (decizie Răzvan 22.09.2026, condiții Jakarinos).
# Agentul citește un folder de licitație montat :ro și scrie UN raport în /out. Fără Bash, fără BD, fără mail.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates poppler-utils unzip \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g @anthropic-ai/claude-code@latest && npm cache clean --force \
 && useradd -m -u 1000 -s /bin/sh agent 2>/dev/null || true
COPY launcher.sh /usr/local/bin/launcher
COPY prompts /opt/prompts
RUN chmod 755 /usr/local/bin/launcher && chmod -R a+rX /opt/prompts && mkdir -p /work /out /home/agent/.claude && chown -R 1000:1000 /work /out /home/agent
USER 1000
ENV HOME=/home/agent CLAUDE_CONFIG_DIR=/home/agent/.claude DISABLE_AUTOUPDATER=1 DISABLE_TELEMETRY=1 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
WORKDIR /work
ENTRYPOINT ["/usr/local/bin/launcher"]
