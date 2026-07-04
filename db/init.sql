-- ==============================================================================
-- SPEEDX - CRIAÇÃO DO BANCO DE DADOS (FASE 1)
-- ==============================================================================
-- Este script roda AUTOMATICAMENTE na primeira vez que o container do
-- PostgreSQL sobe (via docker-entrypoint-initdb.d). Ele cria a estrutura
-- inicial de tabelas do Speedx.
-- ==============================================================================

-- Extensão para gerar UUIDs (identificadores únicos universais).
-- Usamos UUID em vez de números sequenciais (1, 2, 3...) por SEGURANÇA:
-- impede que alguém "adivinhe" IDs de outros usuários na API.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------------------------
-- TABELA: usuarios
-- Guarda TANTO passageiros QUANTO motoristas (o campo "tipo" diferencia).
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(), -- ID único gerado pelo banco
    nome          VARCHAR(120)  NOT NULL,                     -- Nome completo
    email         VARCHAR(160)  NOT NULL UNIQUE,              -- E-mail (não pode repetir)
    telefone      VARCHAR(20)   NOT NULL UNIQUE,              -- Celular (login por SMS no futuro)
    senha_hash    VARCHAR(255)  NOT NULL,                     -- NUNCA guardamos a senha pura! (bcrypt na Fase 2)
    tipo          VARCHAR(10)   NOT NULL CHECK (tipo IN ('passageiro', 'motorista')),
    ativo         BOOLEAN       NOT NULL DEFAULT TRUE,        -- Permite banir/suspender contas
    criado_em     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),       -- Data de cadastro (com fuso horário)
    atualizado_em TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------------------------
-- TABELA: motoristas_detalhes
-- Dados extras que SÓ motoristas possuem (carro, CNH, documentos).
-- Separamos em outra tabela para não poluir a tabela de usuários.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS motoristas_detalhes (
    usuario_id     UUID PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
    cnh            VARCHAR(20)  NOT NULL,                     -- Número da habilitação
    veiculo_modelo VARCHAR(80)  NOT NULL,                     -- Ex: "Chevrolet Onix"
    veiculo_placa  VARCHAR(10)  NOT NULL UNIQUE,              -- Ex: "ABC1D23"
    veiculo_cor    VARCHAR(30)  NOT NULL,                     -- Ex: "Prata"
    aprovado       BOOLEAN      NOT NULL DEFAULT FALSE,       -- Admin precisa aprovar documentos
    criado_em      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------------------------
-- TABELA: corridas
-- O coração do negócio: cada linha é uma viagem solicitada.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS corridas (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    passageiro_id    UUID NOT NULL REFERENCES usuarios(id),   -- Quem pediu a corrida
    motorista_id     UUID REFERENCES usuarios(id),            -- Quem aceitou (NULL enquanto procura)

    -- Coordenadas de origem e destino (latitude/longitude com 7 casas decimais
    -- = precisão de ~1 centímetro, mais que suficiente)
    origem_lat       DECIMAL(10, 7) NOT NULL,
    origem_lng       DECIMAL(10, 7) NOT NULL,
    origem_endereco  VARCHAR(255),                            -- Endereço legível ("Rua X, 123")
    destino_lat      DECIMAL(10, 7) NOT NULL,
    destino_lng      DECIMAL(10, 7) NOT NULL,
    destino_endereco VARCHAR(255),

    -- Ciclo de vida da corrida (máquina de estados):
    -- solicitada -> aceita -> motorista_chegou -> em_andamento -> finalizada
    --            \-> cancelada (pode acontecer em quase qualquer etapa)
    status           VARCHAR(20) NOT NULL DEFAULT 'solicitada'
                     CHECK (status IN ('solicitada', 'aceita', 'motorista_chegou',
                                       'em_andamento', 'finalizada', 'cancelada')),

    valor_estimado   DECIMAL(10, 2),                          -- Preço calculado ao solicitar
    valor_final      DECIMAL(10, 2),                          -- Preço real ao finalizar
    distancia_km     DECIMAL(8, 2),                           -- Distância percorrida

    solicitada_em    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finalizada_em    TIMESTAMPTZ                               -- NULL até a corrida acabar
);

-- ------------------------------------------------------------------------------
-- ÍNDICES - deixam as buscas mais comuns MUITO mais rápidas
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_corridas_passageiro ON corridas (passageiro_id);
CREATE INDEX IF NOT EXISTS idx_corridas_motorista  ON corridas (motorista_id);
CREATE INDEX IF NOT EXISTS idx_corridas_status     ON corridas (status);
CREATE INDEX IF NOT EXISTS idx_usuarios_email      ON usuarios (email);
