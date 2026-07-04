// =============================================================================
// SPEEDX - SERVIDOR PRINCIPAL (FASE 1 - O CORAÇÃO DO BACKEND)
// =============================================================================
// Este arquivo é o ponto de entrada de todo o backend do Speedx. Ele:
//
//   1. Sobe uma API REST com Express (rotas HTTP tradicionais)
//   2. Abre um túnel de WebSockets com Socket.io (rastreamento em tempo real)
//   3. Conecta ao PostgreSQL (dados permanentes: usuários, corridas)
//   4. Conecta ao Redis (dados voláteis: posição dos motoristas, via comandos GEO)
//
// Para rodar:  npm run dev   (desenvolvimento, reinicia sozinho ao salvar)
//              npm start     (produção)
// =============================================================================

// -----------------------------------------------------------------------------
// 1. IMPORTAÇÃO DAS DEPENDÊNCIAS
// -----------------------------------------------------------------------------

// Carrega as variáveis do arquivo .env para process.env
// (senhas e configurações NUNCA ficam escritas direto no código).
// Usamos __dirname (a pasta DESTE arquivo) para o .env ser encontrado
// não importa de onde o comando "node" seja executado.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');          // Framework web: cria as rotas da API
const http = require('http');                // Servidor HTTP nativo do Node (base p/ o Socket.io)
const { Server } = require('socket.io');     // WebSockets: comunicação em tempo real
const cors = require('cors');                // Libera o app do celular a chamar esta API
const { Pool } = require('pg');              // Driver do PostgreSQL (pool = conexões reaproveitadas)
const { createClient, GeoReplyWith } = require('redis'); // Cliente do Redis + helper geoespacial

// -----------------------------------------------------------------------------
// 2. CONFIGURAÇÕES GERAIS (lidas do .env)
// -----------------------------------------------------------------------------

const PORT = process.env.PORT || 3000;

// Chave no Redis onde guardamos a posição de TODOS os motoristas online.
// O Redis tem um tipo de dado geoespacial: com UMA chave conseguimos responder
// "quais motoristas estão a até 5 km deste passageiro?" em milissegundos.
const CHAVE_GEO_MOTORISTAS = 'speedx:motoristas:posicoes';

// -----------------------------------------------------------------------------
// 3. CONEXÃO COM O POSTGRESQL (banco permanente)
// -----------------------------------------------------------------------------
// Usamos um "Pool" em vez de uma conexão única: o pool mantém várias conexões
// abertas e as distribui entre as requisições. É o padrão profissional —
// abrir/fechar conexão a cada requisição derrubaria a performance.

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  max: 20,                      // Até 20 conexões simultâneas
  idleTimeoutMillis: 30000,     // Fecha conexão ociosa após 30s
  connectionTimeoutMillis: 5000 // Erro se não conectar em 5s
});

// -----------------------------------------------------------------------------
// 4. CONEXÃO COM O REDIS (banco em memória - tempo real)
// -----------------------------------------------------------------------------

const redis = createClient({ url: process.env.REDIS_URL });

// O Redis pode cair e voltar; registramos o erro em vez de derrubar o servidor
redis.on('error', (erro) => console.error('❌ [Redis] Erro:', erro.message));
redis.on('reconnecting', () => console.log('🔄 [Redis] Tentando reconectar...'));

// -----------------------------------------------------------------------------
// 5. CRIAÇÃO DO APP EXPRESS + SERVIDOR HTTP + SOCKET.IO
// -----------------------------------------------------------------------------
// Detalhe importante de arquitetura: o Express e o Socket.io compartilham o
// MESMO servidor HTTP e a MESMA porta. O Nginx (Fase 2) vai apontar para ela.

const app = express();
const servidorHttp = http.createServer(app);

const io = new Server(servidorHttp, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*', // Quem pode conectar via WebSocket
    methods: ['GET', 'POST']
  }
});

// Middlewares globais do Express:
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' })); // Libera chamadas do app
app.use(express.json());                                    // Entende JSON no corpo das requisições

// Log simples de cada requisição (ajuda MUITO a depurar em desenvolvimento)
app.use((req, res, next) => {
  console.log(`📡 [API] ${req.method} ${req.url}`);
  next(); // Passa a requisição adiante para a rota correta
});

// -----------------------------------------------------------------------------
// VERSÃO WEB DOS APLICATIVOS
// -----------------------------------------------------------------------------
// Os MESMOS arquivos que vão dentro dos APKs também são servidos aqui como
// site: quem não baixou o app usa pelo navegador. APK e web sempre em sincronia.
//   http://servidor/passageiro  -> app do passageiro
//   http://servidor/motorista   -> app do motorista
app.use('/passageiro', express.static(path.join(__dirname, '..', 'apps', 'passageiro')));
app.use('/motorista', express.static(path.join(__dirname, '..', 'apps', 'motorista')));

// -----------------------------------------------------------------------------
// 6. ROTAS DA API REST
// -----------------------------------------------------------------------------

// ROTA RAIZ - "cartão de visitas" da API
app.get('/', (req, res) => {
  res.json({
    aplicativo: 'Speedx',
    descricao: 'API de mobilidade urbana - Teotônio Vilela/AL e o mundo 🌍',
    versao: '1.0.0 (Fase 1)',
    status: 'online'
  });
});

// ROTA DE SAÚDE - verifica se o servidor E os bancos estão vivos.
// Essencial na VPS: o Docker/Nginx e sistemas de monitoramento chamam esta
// rota para saber se precisa reiniciar algo.
app.get('/api/health', async (req, res) => {
  const saude = { api: 'ok', postgres: 'falhou', redis: 'falhou' };

  // Testa o PostgreSQL com a consulta mais leve possível
  try {
    await pool.query('SELECT 1');
    saude.postgres = 'ok';
  } catch (erro) {
    console.error('❌ [Health] PostgreSQL:', erro.message);
  }

  // Testa o Redis com um PING (resposta esperada: PONG)
  try {
    if ((await redis.ping()) === 'PONG') saude.redis = 'ok';
  } catch (erro) {
    console.error('❌ [Health] Redis:', erro.message);
  }

  // Status HTTP 200 se tudo ok, 503 (Serviço Indisponível) se algo caiu
  const tudoOk = saude.postgres === 'ok' && saude.redis === 'ok';
  res.status(tudoOk ? 200 : 503).json(saude);
});

// ROTA DE BUSCA GEOESPACIAL - o coração da experiência "estilo Uber":
// o passageiro abre o app e vê os carros próximos.
//
// Exemplo de chamada:
//   GET /api/motoristas/proximos?latitude=-9.9061&longitude=-36.3542&raio=5
//   (coordenadas do centro de Teotônio Vilela/AL)
app.get('/api/motoristas/proximos', async (req, res) => {
  try {
    const latitude = parseFloat(req.query.latitude);
    const longitude = parseFloat(req.query.longitude);
    const raioKm = parseFloat(req.query.raio) || 5; // Raio padrão: 5 km

    // Validação: nunca confie em dados vindos de fora!
    if (isNaN(latitude) || isNaN(longitude)) {
      return res.status(400).json({
        erro: 'Parâmetros "latitude" e "longitude" são obrigatórios e devem ser números.'
      });
    }

    // GEOSEARCH: o Redis devolve os motoristas dentro do raio, JÁ ORDENADOS
    // do mais perto para o mais longe, com distância e coordenadas de cada um.
    const resultados = await redis.geoSearchWith(
      CHAVE_GEO_MOTORISTAS,
      { longitude, latitude },              // Centro da busca (posição do passageiro)
      { radius: raioKm, unit: 'km' },       // Raio de busca
      [GeoReplyWith.DISTANCE, GeoReplyWith.COORDINATES],
      { SORT: 'ASC' }                       // Mais próximos primeiro
    );

    // Convertemos a resposta "crua" do Redis num JSON amigável para o app
    const motoristas = resultados.map((item) => ({
      motoristaId: item.member,
      distanciaKm: parseFloat(parseFloat(item.distance).toFixed(2)),
      posicao: {
        latitude: parseFloat(item.coordinates.latitude),
        longitude: parseFloat(item.coordinates.longitude)
      }
    }));

    res.json({ total: motoristas.length, raioKm, motoristas });
  } catch (erro) {
    console.error('❌ [API] Erro ao buscar motoristas:', erro.message);
    res.status(500).json({ erro: 'Erro interno ao buscar motoristas próximos.' });
  }
});

// -----------------------------------------------------------------------------
// 7. TEMPO REAL COM SOCKET.IO - O TÚNEL DE RASTREAMENTO
// -----------------------------------------------------------------------------
// Aqui vive a mágica do "carrinho se movendo no mapa". O fluxo é:
//
//   MOTORISTA (app)                SERVIDOR                    PASSAGEIRO (app)
//   ---------------                --------                    ----------------
//   motorista:conectar   ------->  registra e entra na sala
//   motorista:localizacao ------>  grava no Redis (GEOADD)
//                                  retransmite  ------------>  motorista:atualizacao
//   (desconectou)        ------->  remove do Redis (ZREM)  ->  motorista:offline
//
// "Salas" (rooms) são grupos de conexões: mandamos mensagens só para quem
// precisa recebê-las, em vez de gritar para todo mundo.

io.on('connection', (socket) => {
  console.log(`🔌 [Socket] Nova conexão: ${socket.id}`);

  // ---------------------------------------------------------------------------
  // EVENTO: motorista fica online
  // O app do motorista envia: { motoristaId: "uuid-do-motorista" }
  // ---------------------------------------------------------------------------
  socket.on('motorista:conectar', (dados) => {
    if (!dados || !dados.motoristaId) {
      return socket.emit('erro', { mensagem: 'motoristaId é obrigatório.' });
    }

    // Guardamos o ID DENTRO do socket: quando ele desconectar, saberemos quem era
    socket.data.motoristaId = dados.motoristaId;
    socket.data.tipo = 'motorista';
    socket.join('sala:motoristas'); // Entra na sala dos motoristas

    console.log(`🚗 [Socket] Motorista online: ${dados.motoristaId}`);
    socket.emit('motorista:conectado', { mensagem: 'Você está online no Speedx!' });
  });

  // ---------------------------------------------------------------------------
  // EVENTO: passageiro abre o app
  // O app do passageiro envia: { passageiroId: "uuid-do-passageiro" }
  // ---------------------------------------------------------------------------
  socket.on('passageiro:conectar', (dados) => {
    if (!dados || !dados.passageiroId) {
      return socket.emit('erro', { mensagem: 'passageiroId é obrigatório.' });
    }

    socket.data.passageiroId = dados.passageiroId;
    socket.data.tipo = 'passageiro';
    socket.join('sala:passageiros'); // Entra na sala dos passageiros

    console.log(`🧍 [Socket] Passageiro online: ${dados.passageiroId}`);
    socket.emit('passageiro:conectado', { mensagem: 'Bem-vindo ao Speedx!' });
  });

  // ---------------------------------------------------------------------------
  // EVENTO: motorista envia sua posição (o GPS do celular dispara isso a cada
  // poucos segundos). Este é o evento MAIS FREQUENTE de todo o sistema — por
  // isso ele grava no Redis (RAM) e não no PostgreSQL (disco).
  // Formato: { latitude: -9.9061, longitude: -36.3542 }
  // ---------------------------------------------------------------------------
  socket.on('motorista:localizacao', async (dados) => {
    try {
      // Só aceita posição de quem se identificou como motorista antes
      if (socket.data.tipo !== 'motorista') {
        return socket.emit('erro', { mensagem: 'Identifique-se com motorista:conectar primeiro.' });
      }

      const latitude = parseFloat(dados?.latitude);
      const longitude = parseFloat(dados?.longitude);
      if (isNaN(latitude) || isNaN(longitude)) {
        return socket.emit('erro', { mensagem: 'latitude e longitude devem ser números.' });
      }

      // GEOADD: grava/atualiza a posição do motorista no índice geoespacial.
      // Se ele já existia, o Redis simplesmente MOVE o ponto — perfeito para GPS.
      await redis.geoAdd(CHAVE_GEO_MOTORISTAS, {
        longitude,
        latitude,
        member: socket.data.motoristaId
      });

      // Retransmite a posição para TODOS os passageiros conectados.
      // (Na Fase 3, vamos filtrar: só o passageiro da corrida recebe.)
      io.to('sala:passageiros').emit('motorista:atualizacao', {
        motoristaId: socket.data.motoristaId,
        latitude,
        longitude,
        horario: new Date().toISOString()
      });
    } catch (erro) {
      console.error('❌ [Socket] Erro ao salvar localização:', erro.message);
    }
  });

  // ---------------------------------------------------------------------------
  // EVENTO: conexão caiu (app fechado, sem internet, etc.)
  // Se era um motorista, ele SOME do mapa — removemos a posição do Redis para
  // nenhum passageiro ver um "carro fantasma".
  // ---------------------------------------------------------------------------
  socket.on('disconnect', async () => {
    console.log(`🔌 [Socket] Desconectado: ${socket.id}`);

    if (socket.data.tipo === 'motorista' && socket.data.motoristaId) {
      try {
        // ZREM funciona porque, por baixo dos panos, o índice GEO do Redis
        // é um "sorted set" — remover o membro remove o ponto do mapa.
        await redis.zRem(CHAVE_GEO_MOTORISTAS, socket.data.motoristaId);

        // Avisa os passageiros que este carro saiu do mapa
        io.to('sala:passageiros').emit('motorista:offline', {
          motoristaId: socket.data.motoristaId
        });

        console.log(`🚗💤 [Socket] Motorista removido do mapa: ${socket.data.motoristaId}`);
      } catch (erro) {
        console.error('❌ [Socket] Erro ao remover motorista:', erro.message);
      }
    }
  });
});

// -----------------------------------------------------------------------------
// 8. INICIALIZAÇÃO - conecta aos bancos ANTES de aceitar usuários
// -----------------------------------------------------------------------------
// Ordem importa: não adianta a API estar de pé se o banco está fora do ar.

async function iniciarServidor() {
  try {
    // 1º: PostgreSQL - "SELECT NOW()" confirma a conexão e mostra a hora do banco
    const resultado = await pool.query('SELECT NOW() AS agora');
    console.log(`✅ [PostgreSQL] Conectado! Hora do banco: ${resultado.rows[0].agora}`);

    // 2º: Redis
    await redis.connect();
    console.log('✅ [Redis] Conectado!');

    // 3º: Só agora abrimos a porta para o mundo
    servidorHttp.listen(PORT, () => {
      console.log('');
      console.log('🚀 =============================================');
      console.log(`🚀  SPEEDX BACKEND NO AR - porta ${PORT}`);
      console.log(`🚀  API REST:   http://localhost:${PORT}`);
      console.log(`🚀  WebSocket:  ws://localhost:${PORT}`);
      console.log('🚀 =============================================');
    });
  } catch (erro) {
    console.error('💥 [Fatal] Não foi possível iniciar o servidor:', erro.message);
    process.exit(1); // Encerra: na VPS, o Docker vai reiniciar automaticamente
  }
}

// -----------------------------------------------------------------------------
// 9. DESLIGAMENTO ELEGANTE (graceful shutdown)
// -----------------------------------------------------------------------------
// Quando o Docker manda o sinal de parada (deploy de versão nova, por exemplo),
// fechamos as conexões com calma em vez de "puxar o cabo da tomada".

async function desligar(sinal) {
  console.log(`\n🛑 [${sinal}] Desligando o Speedx com elegância...`);
  servidorHttp.close();     // Para de aceitar novas conexões
  await pool.end();          // Devolve as conexões do PostgreSQL
  await redis.quit();        // Fecha a conexão do Redis
  console.log('👋 Até logo!');
  process.exit(0);
}

process.on('SIGINT', () => desligar('SIGINT'));   // Ctrl+C no terminal
process.on('SIGTERM', () => desligar('SIGTERM')); // docker stop na VPS

// Liga tudo!
iniciarServidor();
