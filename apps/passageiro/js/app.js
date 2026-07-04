// =============================================================================
// SPEEDX PASSAGEIRO — Lógica do aplicativo (v2, Design System)
// =============================================================================
// A MESMA espinha dorsal de tempo real da v1 (Socket.io + Leaflet + GPS),
// com a interface reconstruída: bottom sheet, opções de corrida, estados
// claros e marcadores SVG. Nenhum evento de socket foi alterado.
// =============================================================================

// -----------------------------------------------------------------------------
// 1. SERVIDOR E IDENTIDADE
// -----------------------------------------------------------------------------
function obterServidor() {
  const salvo = localStorage.getItem('speedx:servidor');
  if (salvo) return salvo;
  if (window.SPEEDX_SERVER) return window.SPEEDX_SERVER;
  const dentroDoApk = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  return dentroDoApk ? null : window.location.origin;
}

function obterPassageiroId() {
  let id = localStorage.getItem('speedx:passageiroId');
  if (!id) {
    id = 'pass-' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem('speedx:passageiroId', id);
  }
  return id;
}

// -----------------------------------------------------------------------------
// 2. GPS (plugin nativo no APK, API padrão no navegador)
// -----------------------------------------------------------------------------
function pluginGeo() { return window.Capacitor?.Plugins?.Geolocation || null; }

async function obterPosicaoAtual() {
  const nativo = pluginGeo();
  if (nativo) {
    const pos = await nativo.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000 });
    return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
  }
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
// 3. MAPA E MARCADORES (SVG — sem emoji)
// -----------------------------------------------------------------------------
const CENTRO_PADRAO = { latitude: -9.9061, longitude: -36.3542 }; // Teotônio Vilela/AL

const mapa = L.map('mapa', { zoomControl: false })
  .setView([CENTRO_PADRAO.latitude, CENTRO_PADRAO.longitude], 15);

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19, attribution: '&copy; OpenStreetMap'
}).addTo(mapa);

const SVG_CARRO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 11 6.5 6.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11"/><path d="M4 11h16a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-1"/><path d="M3 12v4a1 1 0 0 0 1 1h1"/><circle cx="7.5" cy="17" r="1.8"/><circle cx="16.5" cy="17" r="1.8"/></svg>';
const SVG_PINO = '<svg class="map-pin" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>';

const iconeVoce    = L.divIcon({ className: '', html: '<div class="map-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
const iconeCarro   = L.divIcon({ className: '', html: `<div class="map-car">${SVG_CARRO}</div>`, iconSize: [36, 36], iconAnchor: [18, 18] });
const iconeDestino = L.divIcon({ className: '', html: SVG_PINO, iconSize: [34, 34], iconAnchor: [17, 32] });

let marcadorVoce = null;
let minhaPosicao = { ...CENTRO_PADRAO };
const marcadoresMotoristas = new Map(); // motoristaId -> L.Marker

function atualizarMotorista(motoristaId, latitude, longitude) {
  const existente = marcadoresMotoristas.get(motoristaId);
  if (existente) existente.setLatLng([latitude, longitude]);
  else marcadoresMotoristas.set(motoristaId, L.marker([latitude, longitude], { icon: iconeCarro }).addTo(mapa));
  atualizarContador();
}

function removerMotorista(motoristaId) {
  const m = marcadoresMotoristas.get(motoristaId);
  if (m) { mapa.removeLayer(m); marcadoresMotoristas.delete(motoristaId); atualizarContador(); }
}

function atualizarContador() {
  document.getElementById('contador-motoristas').textContent = marcadoresMotoristas.size;
}

// -----------------------------------------------------------------------------
// 4. INTERFACE — status de conexão e estados da corrida
// -----------------------------------------------------------------------------
const pill = document.getElementById('status-pill');
const pillTexto = document.getElementById('status-texto');

function definirConexao(texto, estado /* 'online' | 'offline' | 'busy' */) {
  pillTexto.textContent = texto;
  pill.classList.remove('status-pill--online', 'status-pill--offline', 'status-pill--busy');
  pill.classList.add(`status-pill--${estado}`);
}

const elOpcoes = document.getElementById('opcoes');
const elEstado = document.getElementById('estado-corrida');
const elEstadoIcone = document.getElementById('estado-icone');
const elEstadoTitulo = document.getElementById('estado-titulo');
const elEstadoTexto = document.getElementById('estado-texto');
const btnCorrida = document.getElementById('btn-corrida');
const destinoTexto = document.getElementById('destino-texto');
const destinoDica = document.getElementById('destino-dica');
const precoEconomico = document.getElementById('preco-economico');

const ICONE_SPINNER = '<div class="spinner" aria-hidden="true"></div>';
const ICONE_OK = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
const ICONE_ERRO = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>';
const ICONE_CARRO_ESTADO = `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 11 6.5 6.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11"/><path d="M4 11h16a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-1"/><path d="M3 12v4a1 1 0 0 0 1 1h1"/><circle cx="7.5" cy="17" r="1.8"/><circle cx="16.5" cy="17" r="1.8"/></svg>`;

// Mostra o cartão de estado da corrida (com variação visual)
function mostrarEstado(icone, titulo, texto, variacao /* '' | 'sucesso' | 'erro' */) {
  elEstado.classList.remove('escondido', 'estado--sucesso', 'estado--erro');
  if (variacao) elEstado.classList.add(`estado--${variacao}`);
  elEstadoIcone.innerHTML = icone;
  elEstadoTitulo.textContent = titulo;
  elEstadoTexto.textContent = texto;
}
function esconderEstado() { elEstado.classList.add('escondido'); }

// -----------------------------------------------------------------------------
// 5. A CORRIDA — escolher destino, estimar preço, pedir e acompanhar
// -----------------------------------------------------------------------------
// Tarifa espelhada do servidor SÓ para exibir a estimativa (o servidor manda).
const TARIFA_BASE = 3.00, TARIFA_POR_KM = 2.00, TARIFA_MINIMA = 5.00;

function distanciaKmEntre(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function precoEstimado(km) {
  return Math.max(TARIFA_MINIMA, Math.round((TARIFA_BASE + km * TARIFA_POR_KM) * 100) / 100);
}
function fmtReal(v) { return 'R$ ' + v.toFixed(2).replace('.', ','); }

// Estados: 'livre' -> 'procurando' -> 'a_caminho' (e volta)
let estadoCorrida = 'livre';
let corridaAtualId = null;
let destino = null;
let marcadorDestino = null;

mapa.on('click', (evento) => {
  if (estadoCorrida !== 'livre') return;

  destino = { latitude: evento.latlng.lat, longitude: evento.latlng.lng };
  if (marcadorDestino) marcadorDestino.setLatLng(evento.latlng);
  else marcadorDestino = L.marker(evento.latlng, { icon: iconeDestino }).addTo(mapa);

  const km = distanciaKmEntre(minhaPosicao.latitude, minhaPosicao.longitude, destino.latitude, destino.longitude);
  destinoTexto.textContent = `Destino marcado — ${km.toFixed(1)} km`;
  destinoTexto.classList.remove('search-input__placeholder');
  destinoDica.textContent = 'Toque em outro ponto do mapa para ajustar o destino.';
  precoEconomico.textContent = fmtReal(precoEstimado(km));
  elOpcoes.classList.remove('escondido');
  btnCorrida.textContent = 'Pedir corrida';
  btnCorrida.classList.remove('escondido', 'btn--danger');
  btnCorrida.classList.add('btn--primary');
  esconderEstado();
});

function reiniciarCorrida(manterDestino) {
  estadoCorrida = 'livre';
  corridaAtualId = null;
  if (!manterDestino) {
    destino = null;
    if (marcadorDestino) { mapa.removeLayer(marcadorDestino); marcadorDestino = null; }
    destinoTexto.textContent = 'Para onde vamos?';
    destinoTexto.classList.add('search-input__placeholder');
    destinoDica.textContent = 'Toque em um ponto do mapa para marcar o destino.';
    elOpcoes.classList.add('escondido');
    btnCorrida.classList.add('escondido');
  } else if (destino) {
    const km = distanciaKmEntre(minhaPosicao.latitude, minhaPosicao.longitude, destino.latitude, destino.longitude);
    precoEconomico.textContent = fmtReal(precoEstimado(km));
    elOpcoes.classList.remove('escondido');
    btnCorrida.textContent = 'Pedir corrida';
    btnCorrida.classList.remove('escondido', 'btn--danger');
    btnCorrida.classList.add('btn--primary');
  }
}

btnCorrida.addEventListener('click', () => {
  if (!socket || !socket.connected) {
    return mostrarEstado(ICONE_ERRO, 'Sem conexão', 'Verifique o servidor nas configurações.', 'erro');
  }

  if (estadoCorrida === 'livre') {
    if (!destino) return;
    socket.emit('corrida:pedir', { origem: minhaPosicao, destino });
    estadoCorrida = 'procurando';
    elOpcoes.classList.add('escondido');
    btnCorrida.textContent = 'Cancelar';
    btnCorrida.classList.remove('btn--primary');
    btnCorrida.classList.add('btn--danger');
    mostrarEstado(ICONE_SPINNER, 'Procurando motorista', 'Oferecendo sua corrida ao motorista mais próximo...');
  } else {
    socket.emit('corrida:cancelar', { corridaId: corridaAtualId });
    reiniciarCorrida(true);
    esconderEstado();
  }
});

// -----------------------------------------------------------------------------
// 6. TEMPO REAL (Socket.io) — eventos idênticos à v1
// -----------------------------------------------------------------------------
let socket = null;

function conectar() {
  const servidor = obterServidor();
  if (!servidor) {
    definirConexao('Configurar servidor', 'offline');
    abrirModal();
    return;
  }

  if (socket) socket.disconnect();
  definirConexao('Conectando', 'busy');
  socket = io(servidor, { transports: ['websocket', 'polling'] });

  socket.on('connect', () => {
    definirConexao('Online', 'online');
    socket.emit('passageiro:conectar', { passageiroId: obterPassageiroId() });
    buscarMotoristasProximos(servidor);
  });

  socket.on('motorista:atualizacao', (d) => atualizarMotorista(d.motoristaId, d.latitude, d.longitude));
  socket.on('motorista:offline', (d) => removerMotorista(d.motoristaId));

  socket.on('corrida:procurando', (d) => {
    corridaAtualId = d.corridaId;
    mostrarEstado(ICONE_SPINNER, 'Procurando motorista',
      `${fmtReal(d.valorEstimado)} · ${d.motoristasNaFila} motorista(s) na área`);
  });

  socket.on('corrida:aceita', (d) => {
    estadoCorrida = 'a_caminho';
    btnCorrida.textContent = 'Cancelar corrida';
    mostrarEstado(ICONE_CARRO_ESTADO, 'Motorista a caminho',
      `Corrida confirmada · ${fmtReal(d.valorEstimado)}`, 'sucesso');
  });

  socket.on('corrida:sem_motorista', (d) => {
    reiniciarCorrida(true);
    mostrarEstado(ICONE_ERRO, 'Nenhum motorista disponível', d.mensagem, 'erro');
  });

  socket.on('corrida:finalizada', (d) => {
    reiniciarCorrida(false);
    mostrarEstado(ICONE_OK, 'Você chegou!',
      `Obrigado por viajar de Speedx · ${fmtReal(d.valorEstimado)}`, 'sucesso');
  });

  socket.on('corrida:cancelada', (d) => {
    reiniciarCorrida(true);
    mostrarEstado(ICONE_ERRO, 'Corrida encerrada', d.mensagem, 'erro');
  });

  socket.on('disconnect', () => definirConexao('Reconectando', 'busy'));
  socket.on('connect_error', () => definirConexao('Sem conexão', 'offline'));
}

async function buscarMotoristasProximos(servidor) {
  try {
    const url = `${servidor}/api/motoristas/proximos?latitude=${minhaPosicao.latitude}&longitude=${minhaPosicao.longitude}&raio=10`;
    const dados = await (await fetch(url)).json();
    (dados.motoristas || []).forEach((m) => atualizarMotorista(m.motoristaId, m.posicao.latitude, m.posicao.longitude));
  } catch (erro) {
    console.error('Falha ao buscar motoristas próximos:', erro);
  }
}

// -----------------------------------------------------------------------------
// 7. MODAL DE CONFIGURAÇÃO
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
  conectar();
});

// -----------------------------------------------------------------------------
// 8. PARTIDA
// -----------------------------------------------------------------------------
(async function iniciar() {
  try {
    minhaPosicao = await obterPosicaoAtual();
    mapa.setView([minhaPosicao.latitude, minhaPosicao.longitude], 16);
  } catch {
    console.warn('GPS indisponível — usando o centro padrão.');
  }

  marcadorVoce = L.marker([minhaPosicao.latitude, minhaPosicao.longitude], { icon: iconeVoce }).addTo(mapa);
  conectar();

  const ehNativo = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  if ('serviceWorker' in navigator && !ehNativo) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW não registrado:', e.message));
  }
})();
