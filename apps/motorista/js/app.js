// =============================================================================
// SPEEDX MOTORISTA - Lógica do aplicativo
// =============================================================================
// O que este arquivo faz:
//   1. Descobre o endereço do servidor (igual ao app do passageiro)
//   2. Botão FICAR ONLINE: conecta no WebSocket e liga o GPS contínuo
//   3. Cada sinal de GPS -> emite "motorista:localizacao" para o servidor
//      (que grava no Redis e retransmite aos passageiros)
//   4. Botão FICAR OFFLINE: desliga o GPS e desconecta (o servidor remove
//      o carro do mapa de todos os passageiros automaticamente)
// =============================================================================

// -----------------------------------------------------------------------------
// 1. CONFIGURAÇÃO DO SERVIDOR (mesma lógica do app do passageiro)
// -----------------------------------------------------------------------------
function obterServidor() {
  const salvo = localStorage.getItem('speedx:servidor');
  if (salvo) return salvo;
  if (window.SPEEDX_SERVER) return window.SPEEDX_SERVER;

  // A detecção certa: o objeto Capacitor SÓ existe dentro do aplicativo nativo.
  const dentroDoApk = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  return dentroDoApk ? null : window.location.origin;
}

// Identidade temporária do motorista (login real virá na fase de autenticação)
function obterMotoristaId() {
  let id = localStorage.getItem('speedx:motoristaId');
  if (!id) {
    id = 'moto-' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem('speedx:motoristaId', id);
  }
  return id;
}

// -----------------------------------------------------------------------------
// 2. GPS CONTÍNUO - a diferença chave para o app do passageiro
// -----------------------------------------------------------------------------
// O motorista não pede a posição UMA vez: ele VIGIA a posição. Cada vez que
// o carro anda, o celular dispara o callback com as novas coordenadas.
function pluginGeo() {
  return window.Capacitor?.Plugins?.Geolocation || null;
}

let idVigiaNativo = null;     // Identificador do watch do plugin Capacitor
let idVigiaNavegador = null;  // Identificador do watch do navegador

async function ligarGps(aoReceberPosicao) {
  const nativo = pluginGeo();
  if (nativo) {
    // Caminho do APK: plugin nativo (pede permissão de localização ao Android)
    idVigiaNativo = await nativo.watchPosition(
      { enableHighAccuracy: true, timeout: 10000 },
      (pos, erro) => {
        if (erro || !pos) return console.error('GPS nativo:', erro);
        aoReceberPosicao(pos.coords.latitude, pos.coords.longitude);
      }
    );
    return;
  }
  // Caminho do navegador (versão web)
  if (!navigator.geolocation) throw new Error('Este aparelho não tem GPS disponível.');
  idVigiaNavegador = navigator.geolocation.watchPosition(
    (pos) => aoReceberPosicao(pos.coords.latitude, pos.coords.longitude),
    (erro) => console.error('GPS navegador:', erro.message),
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
  );
}

async function desligarGps() {
  const nativo = pluginGeo();
  if (nativo && idVigiaNativo) {
    await nativo.clearWatch({ id: idVigiaNativo });
    idVigiaNativo = null;
  }
  if (idVigiaNavegador !== null) {
    navigator.geolocation.clearWatch(idVigiaNavegador);
    idVigiaNavegador = null;
  }
}

// -----------------------------------------------------------------------------
// 3. O MAPA (mostra o próprio carro do motorista)
// -----------------------------------------------------------------------------
const CENTRO_PADRAO = { latitude: -9.9061, longitude: -36.3542 }; // Teotônio Vilela/AL

const mapa = L.map('mapa', { zoomControl: false })
  .setView([CENTRO_PADRAO.latitude, CENTRO_PADRAO.longitude], 15);

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap'
}).addTo(mapa);

const iconeMeuCarro = L.divIcon({ className: '', html: '<div class="marcador-carro">🚗</div>', iconSize: [30, 30], iconAnchor: [15, 15] });
let marcadorMeuCarro = null;

function moverMeuCarro(latitude, longitude) {
  if (marcadorMeuCarro) {
    marcadorMeuCarro.setLatLng([latitude, longitude]);
  } else {
    marcadorMeuCarro = L.marker([latitude, longitude], { icon: iconeMeuCarro }).addTo(mapa);
  }
  mapa.setView([latitude, longitude]); // O mapa segue o carro
}

// -----------------------------------------------------------------------------
// 3.5. O CHAMADO DE CORRIDA - aceitar, recusar, guiar e finalizar
// -----------------------------------------------------------------------------
let chamadoCorridaId = null;   // Chamado exibido na tela agora
let corridaAceitaId = null;    // Corrida em andamento
let timerChamado = null;       // Relógio local da barra de tempo
let marcadorPassageiro = null; // 🧍 onde buscar o passageiro
let marcadorDestino = null;    // 🎯 onde deixá-lo

const iconePassageiro = L.divIcon({ className: '', html: '<div class="marcador-emoji">🧍</div>', iconSize: [30, 30], iconAnchor: [15, 15] });
const iconeDestino = L.divIcon({ className: '', html: '<div class="marcador-emoji">🎯</div>', iconSize: [30, 30], iconAnchor: [15, 15] });

const modalChamado = document.getElementById('modal-chamado');
const chamadoValor = document.getElementById('chamado-valor');
const chamadoDetalhes = document.getElementById('chamado-detalhes');
const chamadoBarra = document.getElementById('chamado-barra');
const btnAceitar = document.getElementById('btn-aceitar');
const btnRecusar = document.getElementById('btn-recusar');
const btnFinalizar = document.getElementById('btn-finalizar');

// Mostra o chamado na tela com a barra de tempo encolhendo segundo a segundo
function mostrarChamado(dados) {
  chamadoCorridaId = dados.corridaId;
  chamadoValor.textContent = `R$ ${dados.valorEstimado.toFixed(2).replace('.', ',')}`;
  chamadoDetalhes.textContent =
    `Passageiro a ${dados.distanciaAteVoceKm} km de você • viagem de ${dados.viagemKm} km`;
  modalChamado.classList.remove('escondido');

  // Conta regressiva local: espelha o prazo do servidor
  let restante = dados.expiraEmSegundos;
  chamadoBarra.style.width = '100%';
  clearInterval(timerChamado);
  timerChamado = setInterval(() => {
    restante -= 1;
    chamadoBarra.style.width = `${Math.max(0, (restante / dados.expiraEmSegundos) * 100)}%`;
    if (restante <= 0) esconderChamado(); // O servidor já passou ao próximo
  }, 1000);
}

function esconderChamado() {
  clearInterval(timerChamado);
  timerChamado = null;
  chamadoCorridaId = null;
  modalChamado.classList.add('escondido');
}

// Limpa a corrida da tela (fim, cancelamento ou queda do passageiro)
function limparCorridaDaTela() {
  corridaAceitaId = null;
  if (marcadorPassageiro) { mapa.removeLayer(marcadorPassageiro); marcadorPassageiro = null; }
  if (marcadorDestino) { mapa.removeLayer(marcadorDestino); marcadorDestino = null; }
  btnFinalizar.classList.add('escondido');
  botao.classList.remove('escondido');
}

btnAceitar.addEventListener('click', () => {
  if (socket && chamadoCorridaId) socket.emit('corrida:aceitar', { corridaId: chamadoCorridaId });
});

btnRecusar.addEventListener('click', () => {
  if (socket && chamadoCorridaId) socket.emit('corrida:recusar', { corridaId: chamadoCorridaId });
  esconderChamado();
});

btnFinalizar.addEventListener('click', () => {
  if (socket && corridaAceitaId) socket.emit('corrida:finalizar', { corridaId: corridaAceitaId });
});

// -----------------------------------------------------------------------------
// 4. FICAR ONLINE / OFFLINE
// -----------------------------------------------------------------------------
let socket = null;
let online = false;

const botao = document.getElementById('btn-online');

function definirStatus(texto, conectado) {
  document.getElementById('texto-status').textContent = texto;
  const bolinha = document.getElementById('status-conexao');
  bolinha.classList.toggle('online', conectado);
  bolinha.classList.toggle('offline', !conectado);
}

async function ficarOnline() {
  const servidor = obterServidor();
  if (!servidor) {
    definirStatus('Configure o endereço do servidor ⚙️', false);
    abrirModal();
    return;
  }

  definirStatus('Conectando...', false);
  socket = io(servidor, { transports: ['websocket', 'polling'] });

  socket.on('connect', async () => {
    // 1º passo: apresentar-se ao servidor como motorista
    socket.emit('motorista:conectar', { motoristaId: obterMotoristaId() });

    // 2º passo: ligar o GPS contínuo — cada posição vai direto para o servidor
    try {
      await ligarGps((latitude, longitude) => {
        socket.emit('motorista:localizacao', { latitude, longitude });
        moverMeuCarro(latitude, longitude);
      });
    } catch (erro) {
      definirStatus('Não consegui acessar o GPS: ' + erro.message, false);
      return;
    }

    online = true;
    botao.textContent = 'FICAR OFFLINE';
    botao.classList.add('ligado');
    definirStatus('Você está ONLINE — visível para os passageiros 🚗💨', true);
  });

  // ------------------------- EVENTOS DO CHAMADO -------------------------

  // 📢 UM PASSAGEIRO PEDIU CORRIDA e você é o escolhido da vez!
  socket.on('corrida:chamado', (dados) => mostrarChamado(dados));

  // Você aceitou e o servidor confirmou: hora de trabalhar
  socket.on('corrida:confirmada', (dados) => {
    esconderChamado();
    corridaAceitaId = dados.corridaId;

    // Marca no mapa onde BUSCAR (🧍) e onde DEIXAR (🎯) o passageiro
    marcadorPassageiro = L.marker([dados.origem.latitude, dados.origem.longitude], { icon: iconePassageiro }).addTo(mapa);
    marcadorDestino = L.marker([dados.destino.latitude, dados.destino.longitude], { icon: iconeDestino }).addTo(mapa);

    // Troca o botão ONLINE pelo FINALIZAR enquanto dura a corrida
    botao.classList.add('escondido');
    btnFinalizar.classList.remove('escondido');
    definirStatus(`Corrida aceita! Busque o passageiro 🧍 — R$ ${dados.valorEstimado.toFixed(2).replace('.', ',')}`, true);
  });

  // Corrida concluída: valor no bolso e de volta à praça
  socket.on('corrida:encerrada', (dados) => {
    limparCorridaDaTela();
    definirStatus(`🏁 Corrida finalizada! R$ ${dados.valorEstimado.toFixed(2).replace('.', ',')} — você está online.`, true);
  });

  // O passageiro cancelou ou caiu
  socket.on('corrida:cancelada', (dados) => {
    esconderChamado();
    limparCorridaDaTela();
    definirStatus(`${dados.mensagem} Você segue online.`, true);
  });

  socket.on('disconnect', () => {
    if (online) definirStatus('Conexão perdida — tentando reconectar...', false);
  });

  socket.on('connect_error', () => {
    definirStatus('Servidor fora de alcance. Verifique ⚙️', false);
  });
}

async function ficarOffline() {
  await desligarGps();          // Para de enviar posição
  if (socket) socket.disconnect(); // O servidor remove o carro do mapa de todos
  socket = null;
  online = false;
  botao.textContent = 'FICAR ONLINE';
  botao.classList.remove('ligado');
  definirStatus('Você está offline', false);
}

botao.addEventListener('click', () => (online ? ficarOffline() : ficarOnline()));

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
  const valor = campoServidor.value.trim().replace(/\/+$/, '');
  if (valor) localStorage.setItem('speedx:servidor', valor);
  else localStorage.removeItem('speedx:servidor');
  modal.classList.add('escondido');
});

// -----------------------------------------------------------------------------
// 6. PARTIDA DO APP - só centraliza o mapa (GPS contínuo liga com o botão)
// -----------------------------------------------------------------------------
(async function iniciar() {
  const nativo = pluginGeo();
  try {
    let pos;
    if (nativo) {
      const r = await nativo.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000 });
      pos = { latitude: r.coords.latitude, longitude: r.coords.longitude };
    } else if (navigator.geolocation) {
      pos = await new Promise((resolver, rejeitar) =>
        navigator.geolocation.getCurrentPosition(
          (p) => resolver({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
          rejeitar,
          { enableHighAccuracy: true, timeout: 10000 }
        )
      );
    }
    if (pos) {
      mapa.setView([pos.latitude, pos.longitude], 16);
      moverMeuCarro(pos.latitude, pos.longitude);
    }
  } catch {
    console.warn('GPS indisponível na abertura — mapa no centro padrão.');
  }

  // PWA: registra o Service Worker (só na versão WEB — dentro do APK o
  // Capacitor já cuida dos arquivos locais, o SW seria redundante)
  const ehNativo = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  if ('serviceWorker' in navigator && !ehNativo) {
    navigator.serviceWorker.register('sw.js').catch((erro) =>
      console.warn('Service Worker não registrado:', erro.message)
    );
  }
})();
