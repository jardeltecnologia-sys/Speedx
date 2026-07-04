// =============================================================================
// SPEEDX PASSAGEIRO - Lógica do aplicativo
// =============================================================================
// O que este arquivo faz:
//   1. Descobre o endereço do servidor (VPS, IP local ou o próprio site)
//   2. Pega a localização GPS do passageiro (Capacitor no APK / navegador na web)
//   3. Desenha o mapa e a posição do passageiro
//   4. Conecta no WebSocket e mostra os motoristas se movendo EM TEMPO REAL
// =============================================================================

// -----------------------------------------------------------------------------
// 1. CONFIGURAÇÃO DO SERVIDOR
// -----------------------------------------------------------------------------
// Ordem de prioridade do endereço do servidor:
//   1º O que o usuário salvou na engrenagem (localStorage)
//   2º O endereço injetado na hora do build do APK (window.SPEEDX_SERVER)
//   3º O próprio site onde a página está hospedada (versão web)
function obterServidor() {
  const salvo = localStorage.getItem('speedx:servidor');
  if (salvo) return salvo;
  if (window.SPEEDX_SERVER) return window.SPEEDX_SERVER;

  // Dentro do APK a "origem" é o pacote local (capacitor://localhost) —
  // isso NÃO é um servidor real, então não serve como padrão.
  // A detecção certa: o objeto Capacitor SÓ existe dentro do aplicativo nativo.
  const dentroDoApk = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  return dentroDoApk ? null : window.location.origin;
}

// Identidade temporária do passageiro (a Fase de autenticação trará login real).
// Geramos uma vez e guardamos: o mesmo aparelho mantém o mesmo ID.
function obterPassageiroId() {
  let id = localStorage.getItem('speedx:passageiroId');
  if (!id) {
    id = 'pass-' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem('speedx:passageiroId', id);
  }
  return id;
}

// -----------------------------------------------------------------------------
// 2. GPS - funciona no APK (plugin Capacitor) E no navegador (API padrão)
// -----------------------------------------------------------------------------
function pluginGeo() {
  // Se estamos dentro do APK, o Capacitor injeta os plugins nativos aqui
  return window.Capacitor?.Plugins?.Geolocation || null;
}

// Pede a posição UMA vez (para centralizar o mapa na abertura)
async function obterPosicaoAtual() {
  const nativo = pluginGeo();
  if (nativo) {
    // Caminho do APK: o plugin nativo pede a permissão ao Android sozinho
    const pos = await nativo.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000 });
    return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
  }
  // Caminho do navegador
  return new Promise((resolver, rejeitar) => {
    if (!navigator.geolocation) return rejeitar(new Error('Sem suporte a GPS'));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolver({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      (erro) => rejeitar(erro),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

// -----------------------------------------------------------------------------
// 3. O MAPA
// -----------------------------------------------------------------------------
// Centro padrão: Teotônio Vilela/AL — a casa do Speedx! Se o GPS responder,
// o mapa voa para a posição real do passageiro.
const CENTRO_PADRAO = { latitude: -9.9061, longitude: -36.3542 };

const mapa = L.map('mapa', { zoomControl: false })
  .setView([CENTRO_PADRAO.latitude, CENTRO_PADRAO.longitude], 15);

// Tiles do OpenStreetMap: gratuitos e sem chave de API
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap'
}).addTo(mapa);

// Marcador "você está aqui" (bolinha verde pulsante definida no CSS)
const iconeVoce = L.divIcon({ className: '', html: '<div class="marcador-voce"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
let marcadorVoce = null;
let minhaPosicao = { ...CENTRO_PADRAO };

// Guarda os marcadores dos motoristas: { motoristaId -> L.Marker }
const marcadoresMotoristas = new Map();

const iconeCarro = L.divIcon({ className: '', html: '<div class="marcador-carro">🚗</div>', iconSize: [30, 30], iconAnchor: [15, 15] });

// Cria OU move o carro de um motorista no mapa (chamado a cada sinal de GPS)
function atualizarMotorista(motoristaId, latitude, longitude) {
  const existente = marcadoresMotoristas.get(motoristaId);
  if (existente) {
    existente.setLatLng([latitude, longitude]); // Só desliza o carro
  } else {
    const novo = L.marker([latitude, longitude], { icon: iconeCarro }).addTo(mapa);
    marcadoresMotoristas.set(motoristaId, novo);
  }
  atualizarContador();
}

function removerMotorista(motoristaId) {
  const marcador = marcadoresMotoristas.get(motoristaId);
  if (marcador) {
    mapa.removeLayer(marcador);
    marcadoresMotoristas.delete(motoristaId);
    atualizarContador();
  }
}

function atualizarContador() {
  document.getElementById('contador-motoristas').textContent = marcadoresMotoristas.size;
}

function definirStatus(texto, online) {
  document.getElementById('texto-status').textContent = texto;
  const bolinha = document.getElementById('status-conexao');
  bolinha.classList.toggle('online', online);
  bolinha.classList.toggle('offline', !online);
}

// -----------------------------------------------------------------------------
// 4. CONEXÃO EM TEMPO REAL (Socket.io)
// -----------------------------------------------------------------------------
let socket = null;

function conectar() {
  const servidor = obterServidor();
  if (!servidor) {
    // Primeiro uso do APK sem servidor configurado: abre as configurações
    definirStatus('Configure o endereço do servidor ⚙️', false);
    abrirModal();
    return;
  }

  if (socket) socket.disconnect(); // Descarta conexão antiga, se houver

  definirStatus('Conectando ao Speedx...', false);
  socket = io(servidor, { transports: ['websocket', 'polling'] });

  socket.on('connect', () => {
    definirStatus('Conectado — procurando motoristas', true);
    socket.emit('passageiro:conectar', { passageiroId: obterPassageiroId() });
    buscarMotoristasProximos(servidor); // Carga inicial via API REST
  });

  // Chega a cada sinal de GPS de QUALQUER motorista online
  socket.on('motorista:atualizacao', (dados) => {
    atualizarMotorista(dados.motoristaId, dados.latitude, dados.longitude);
  });

  // Motorista fechou o app: some do mapa na hora
  socket.on('motorista:offline', (dados) => removerMotorista(dados.motoristaId));

  socket.on('disconnect', () => definirStatus('Sem conexão — tentando de novo...', false));
  socket.on('connect_error', () => definirStatus('Servidor fora de alcance. Verifique ⚙️', false));
}

// Busca via REST os motoristas que JÁ estavam online antes de abrirmos o app
// (o WebSocket só entrega as atualizações a partir de agora)
async function buscarMotoristasProximos(servidor) {
  try {
    const url = `${servidor}/api/motoristas/proximos?latitude=${minhaPosicao.latitude}&longitude=${minhaPosicao.longitude}&raio=10`;
    const resposta = await fetch(url);
    const dados = await resposta.json();
    (dados.motoristas || []).forEach((m) =>
      atualizarMotorista(m.motoristaId, m.posicao.latitude, m.posicao.longitude)
    );
  } catch (erro) {
    console.error('Falha ao buscar motoristas próximos:', erro);
  }
}

// -----------------------------------------------------------------------------
// 5. MODAL DE CONFIGURAÇÃO DO SERVIDOR
// -----------------------------------------------------------------------------
const modal = document.getElementById('modal-config');
const campoServidor = document.getElementById('campo-servidor');

function abrirModal() {
  campoServidor.value = localStorage.getItem('speedx:servidor') || window.SPEEDX_SERVER || '';
  modal.classList.remove('escondido');
}

document.getElementById('btn-config').addEventListener('click', abrirModal);
document.getElementById('btn-cancelar').addEventListener('click', () => modal.classList.add('escondido'));

document.getElementById('btn-salvar').addEventListener('click', () => {
  const valor = campoServidor.value.trim().replace(/\/+$/, ''); // Remove barra final
  if (valor) localStorage.setItem('speedx:servidor', valor);
  else localStorage.removeItem('speedx:servidor');
  modal.classList.add('escondido');
  conectar(); // Reconecta já no servidor novo
});

// -----------------------------------------------------------------------------
// 6. PARTIDA DO APP
// -----------------------------------------------------------------------------
(async function iniciar() {
  // Tenta o GPS real; se o usuário negar, seguimos com o centro padrão
  try {
    minhaPosicao = await obterPosicaoAtual();
    mapa.setView([minhaPosicao.latitude, minhaPosicao.longitude], 16);
  } catch {
    console.warn('GPS indisponível — usando o centro de Teotônio Vilela.');
  }

  // Coloca (ou move) a bolinha "você está aqui"
  marcadorVoce = L.marker([minhaPosicao.latitude, minhaPosicao.longitude], { icon: iconeVoce }).addTo(mapa);

  conectar();
})();
