# 🔐 Speedx — Comandos para liberar o acesso de deploy na VPS

Rode este bloco **como root** na VPS (187.127.8.26). Ele cria o usuário
`speedxdeploy` com sudo completo, Docker e a chave pública autorizada:

```bash
# 1. Cria o usuário de deploy
adduser --disabled-password --gecos "Speedx Deploy" speedxdeploy

# 2. Sudo administrativo completo (sem pedir senha, para automação)
usermod -aG sudo speedxdeploy
echo "speedxdeploy ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/speedxdeploy
chmod 440 /etc/sudoers.d/speedxdeploy

# 3. Permissão para usar o Docker
usermod -aG docker speedxdeploy || true   # (grupo passa a existir após instalar o Docker)

# 4. Autoriza a chave pública SSH
mkdir -p /home/speedxdeploy/.ssh
cat >> /home/speedxdeploy/.ssh/authorized_keys << 'CHAVE'
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIL3oJL80Efu7HyYKtVhClrLuUNDvU8RUg2Fl3KnMMTEB speedxdeploy@speedx
CHAVE
chmod 700 /home/speedxdeploy/.ssh
chmod 600 /home/speedxdeploy/.ssh/authorized_keys
chown -R speedxdeploy:speedxdeploy /home/speedxdeploy/.ssh

# 5. Pasta do projeto
mkdir -p /opt/speedx
chown speedxdeploy:speedxdeploy /opt/speedx

echo "✅ Acesso liberado para speedxdeploy"
```

Depois disso, o deploy conecta com: `ssh speedx-vps` (atalho já configurado).

## DNS (Titan Host)

Criar o registro apontando o domínio provisório para a VPS:

```text
Tipo: A
Nome: speedx          (resultando em speedx.titanhost.cloud)
Valor: 187.127.8.26
TTL: 300
```
