# =============================================================================
# SPEEDX BACKEND - IMAGEM DOCKER DE PRODUÇÃO
# =============================================================================
# Multi-stage não é necessário (sem build step); imagem alpine = leve e segura.
FROM node:20-alpine

# Diretório da aplicação dentro do container
WORKDIR /app

# 1º copiamos só os manifestos: o Docker guarda essa camada em cache e o
# "npm install" NÃO roda de novo a cada mudança de código (deploys rápidos)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# Agora o código do backend
COPY server.js ./

# Os apps web (página institucional, passageiro, motorista) ficam FORA da
# pasta backend no repositório; o docker-compose monta ../apps como volume.

# Roda como usuário sem privilégios (segurança: container invadido != root)
USER node

EXPOSE 3000
CMD ["node", "server.js"]
