// =============================================================================
// SPEEDX MOTORISTA — Lógica do cockpit (v2, Design System)
// =============================================================================
// Mesma espinha dorsal de tempo real da v1 (Socket.io + GPS contínuo).
// Novidades de interface: abas (Início/Ganhos/Corridas/Conta), painel de
// métricas com DADOS REAIS da sessão (nada inventado), chamado premium com
// contagem regressiva e marcadores SVG.
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

function obterMotoristaId() {
  let id = localStorage.getItem('speedx:motoristaId');
  if (!id) {
    id = 'moto-' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem('speedx:motoristaId', id);
  }
  return id;
}

function fmtReal(v) { return 'R$ ' + v.toFixed(2).replace('.', ','); }

// -----------------------------------------------------------------------------
// 2. ESTATÍSTICAS REAIS DO DIA (persistidas por data no aparelho)
// -----------------------------------------------------------------------------
// Nada de números falsos: só corridas realmente finalizadas nesta data.
// O extrato permanente no servidor chega com a carteira (Fase 4).
function chaveHoje() {
  const d = new Date();
  return `speedx:stats:${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function lerStats() {
  try { return JSON.parse(localStorage.getItem(chaveHoje())) || { ganhos: 0, corridas: 0, segundos: 0, lista: [] }; }
  catch { return { ganhos: 0, corridas: 0, segundos: 0, lista: [] }; }
}
function salvarStats(s) { localStorage.setItem(chaveHoje(), JSON.stringify(s)); }

function registrarCorridaFinalizada(valor) {
  const s = lerStats();
  s.ganhos += valor;
  s.corridas += 1;
  s.lista.unshift({ hora: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }), valor });
  s.lista = s.lista.slice(0, 50);
  salvarStats(s);
  renderizarStats();
}

function fmtTempo(totalSegundos) {
  const h = Math.floor(totalSegundos / 3600), m = Math.floor((totalSegundos % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function renderizarStats() {
  const s = lerStats();
  document.getElementById('m-ganhos').textContent = fmtReal(s.ganhos);
  document.getElementById('m-corridas').textContent = s.corridas;
  document.getElementById('m-tempo').textContent = fmtTempo(s.segundos);
  document.getElementById('g-hoje').textContent = fmtReal(s.ganhos);
  document.getElementById('g-corridas').textContent = s.corridas;
  renderizarListaCorridas(s.lista);
}

function renderizarListaCorridas(lista) {
  const el = document.getElementById('lista-corridas');
  if (!lista.length) {
    el.innerHTML = `
      <div class="empty-state">
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></svg>
        <p class="empty-state__title">Sem corridas hoje ainda</p>
        <p class="empty-state__text">Fique online para receber chamados. Suas corridas finalizadas aparecem aqui.</p>
      </div>`;
    return;
  }
  el.innerHTML = lista.map((c) => `
    <div class="corrida-item">
      <div>
        <p style="font-weight:var(--fw-semibold);">Corrida finalizada</p>
        <p class="corrida-item__hora">Hoje às ${c.hora}</p>
      </div>
      <span class="corrida-item__valor">${fmtReal(c.valor)}</span>
    </div>`).join('');
}

// Relógio de tempo online: soma segundos REAIS enquanto o motorista está online
let timerOnline = null;
function ligarRelogio() {
  if (timerOnline) return;
  timerOnline = setInterval(() => {
    const s = lerStats();
    s.segundos += 10;
    salvarStats(s);
    document.getElementById('m-tempo').textContent = fmtTempo(s.segundos);
  }, 10000);
}
function desligarRelogio() { clearInterval(timerOnline); timerOnline = null; }

// -----------------------------------------------------------------------------
// 3. GPS CONTÍNUO (plugin nativo no APK / navegador na web)
// -----------------------------------------------------------------------------
function pluginGeo() { return window.Capacitor?.Plugins?.Geolocation || null; }

let idVigiaNativo = null;
let idVigiaNavegador = null;

async function ligarGps(aoReceberPosicao) {
  const nativo = pluginGeo();
  if (nativo) {
    idVigiaNativo = await nativo.watchPosition(
      { enableHighAccuracy: true, timeout: 10000 },
      (pos, erro) => {
        if (erro || !pos) return console.error('GPS nativo:', erro);
        aoReceberPosicao(pos.coords.latitude, pos.coords.longitude);
      }
    );
    return;
  }
  if (!navigator.geolocation) throw new Error('Este aparelho não tem GPS disponível.');
  idVigiaNavegador = navigator.geolocation.watchPosition(
    (pos) => aoReceberPosicao(pos.coords.latitude, pos.coords.longitude),
    (erro) => console.error('GPS navegador:', erro.message),
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
  );
}

async function desligarGps() {
  const nativo = pluginGeo();
  if (nativo && idVigiaNativo) { await nativo.clearWatch({ id: idVigiaNativo }); idVigiaNativo = null; }
  if (idVigiaNavegador !== null) { navigator.geolocation.clearWatch(idVigiaNavegador); idVigiaNavegador = null; }
}

// -----------------------------------------------------------------------------
// 4. MAPA E MARCADORES (SVG)
// -----------------------------------------------------------------------------
const CENTRO_PADRAO = { latitude: -9.9061, longitude: -36.3542 };

const mapa = L.map('mapa', { zoomControl: false })
  .setView([CENTRO_PADRAO.latitude, CENTRO_PADRAO.longitude], 15);

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19, attribution: '&copy; OpenStreetMap'
}).addTo(mapa);

const SVG_CARRO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 11 6.5 6.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11"/><path d="M4 11h16a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-1"/><path d="M3 12v4a1 1 0 0 0 1 1h1"/><circle cx="7.5" cy="17" r="1.8"/><circle cx="16.5" cy="17" r="1.8"/></svg>';
const SVG_PINO = '<svg class="map-pin" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>';
const SVG_PESSOA = '<svg class="map-pin" style="color:var(--info);" viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="12" cy="7" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7z"/></svg>';

const iconeMeuCarro    = L.divIcon({ className: '', html: `<div class="map-car">${SVG_CARRO}</div>`, iconSize: [36, 36], iconAnchor: [18, 18] });
const iconePassageiro  = L.divIcon({ className: '', html: SVG_PESSOA, iconSize: [34, 34], iconAnchor: [17, 32] });
const iconeDestino     = L.divIcon({ className: '', html: SVG_PINO, iconSize: [34, 34], iconAnchor: [17, 32] });

let marcadorMeuCarro = null;
function moverMeuCarro(latitude, longitude) {
  if (marcadorMeuCarro) marcadorMeuCarro.setLatLng([latitude, longitude]);
  else marcadorMeuCarro = L.marker([latitude, longitude], { icon: iconeMeuCarro }).addTo(mapa);
  mapa.setView([latitude, longitude]);
}

// -----------------------------------------------------------------------------
// 5. INTERFACE — status, abas e estados
// -----------------------------------------------------------------------------
const pill = document.getElementById('status-pill');
const pillTexto = document.getElementById('status-texto');

function definirConexao(texto, estado) {
  pillTexto.textContent = texto;
  pill.classList.remove('status-pill--online', 'status-pill--offline', 'status-pill--busy');
  pill.classList.add(`status-pill--${estado}`);
}

const elEstado = document.getElementById('estado-operacao');
const elEstadoIcone = document.getElementById('estado-icone');
const elEstadoTitulo = document.getElementById('estado-titulo');
const elEstadoTexto = document.getElementById('estado-texto');

const ICONE_RELOGIO = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>';
const ICONE_RADAR = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.9 19.1a10 10 0 1 1 14.2 0"/><path d="M7.8 16.2a6 6 0 1 1 8.4 0"/><circle cx="12" cy="12" r="1.5"/></svg>';
const ICONE_CARRO = `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 11 6.5 6.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11"/><path d="M4 11h16a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-1"/><path d="M3 12v4a1 1 0 0 0 1 1h1"/><circle cx="7.5" cy="17" r="1.8"/><circle cx="16.5" cy="17" r="1.8"/></svg>`;
const ICONE_ERRO = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>';

function estadoOperacao(icone, titulo, texto, variacao /* '' | 'online' | 'corrida' | 'erro' */) {
  elEstado.classList.remove('estado--online', 'estado--corrida', 'estado--erro');
  if (variacao) elEstado.classList.add(`estado--${variacao}`);
  elEstadoIcone.innerHTML = icone;
  elEstadoTitulo.textContent = titulo;
  elEstadoTexto.textContent = texto;
}

// Navegação por abas (bottom nav)
const abas = { inicio: document.getElementById('tab-inicio'), ganhos: document.getElementById('tab-ganhos'),
               corridas: document.getElementById('tab-corridas'), conta: document.getElementById('tab-conta') };

document.querySelectorAll('.bottom-nav__item').forEach((botao) => {
  botao.addEventListener('click', () => {
    document.querySelectorAll('.bottom-nav__item').forEach((b) => b.classList.remove('bottom-nav__item--ativo'));
    botao.classList.add('bottom-nav__item--ativo');
    const alvo = botao.dataset.tab;
    Object.entries(abas).forEach(([nome, el]) => el.classList.toggle('escondido', nome !== alvo && nome !== 'inicio'));
    // O cockpit (mapa + sheet) fica sempre por baixo; as páginas cobrem por cima
    abas.inicio.classList.toggle('escondido', alvo !== 'inicio');
    if (alvo === 'inicio') setTimeout(() => mapa.invalidateSize(), 100);
    renderizarStats();
  });
});

// -----------------------------------------------------------------------------
// 6. O CHAMADO — aceitar, recusar, finalizar
// -----------------------------------------------------------------------------
let chamadoCorridaId = null;
let corridaAceitaId = null;
let timerChamado = null;
let marcadorPassageiro = null;
let marcadorDestino = null;

const modalChamado = document.getElementById('modal-chamado');
const chamadoValor = document.getElementById('chamado-titulo');
const chamadoOrigem = document.getElementById('chamado-origem');
const chamadoViagem = document.getElementById('chamado-viagem');
const chamadoBarra = document.getElementById('chamado-barra');
const chamadoSegundos = document.getElementById('chamado-tempo-num');
const btnAceitar = document.getElementById('btn-aceitar');
const btnRecusar = document.getElementById('btn-recusar');
const btnFinalizar = document.getElementById('btn-finalizar');
const botao = document.getElementById('btn-online');

function mostrarChamado(dados) {
  chamadoCorridaId = dados.corridaId;
  chamadoValor.textContent = fmtReal(dados.valorEstimado);
  chamadoOrigem.textContent = `Passageiro a ${dados.distanciaAteVoceKm} km de você`;
  chamadoViagem.textContent = `Viagem de ${dados.viagemKm} km até o destino`;
  modalChamado.classList.remove('escondido');

  let restante = dados.expiraEmSegundos;
  chamadoBarra.style.width = '100%';
  chamadoSegundos.textContent = `${restante}s`;
  clearInterval(timerChamado);
  timerChamado = setInterval(() => {
    restante -= 1;
    chamadoSegundos.textContent = `${Math.max(0, restante)}s`;
    chamadoBarra.style.width = `${Math.max(0, (restante / dados.expiraEmSegundos) * 100)}%`;
    if (restante <= 0) esconderChamado();
  }, 1000);
}

function esconderChamado() {
  clearInterval(timerChamado);
  timerChamado = null;
  chamadoCorridaId = null;
  modalChamado.classList.add('escondido');
}

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
// 7. FICAR ONLINE / OFFLINE (Socket.io — eventos idênticos à v1)
// -----------------------------------------------------------------------------
let socket = null;
let online = false;

async function ficarOnline() {
  const servidor = obterServidor();
  if (!servidor) {
    estadoOperacao(ICONE_ERRO, 'Configure o servidor', 'Toque na engrenagem para informar o endereço.', 'erro');
    abrirModal();
    return;
  }

  definirConexao('Conectando', 'busy');
  estadoOperacao(ICONE_RELOGIO, 'Conectando...', 'Falando com a central Speedx.');
  socket = io(servidor, { transports: ['websocket', 'polling'] });

  socket.on('connect', async () => {
    socket.emit('motorista:conectar', { motoristaId: obterMotoristaId() });
    try {
      await ligarGps((latitude, longitude) => {
        socket.emit('motorista:localizacao', { latitude, longitude });
        moverMeuCarro(latitude, longitude);
      });
    } catch (erro) {
      definirConexao('Sem GPS', 'offline');
      estadoOperacao(ICONE_ERRO, 'GPS indisponível', erro.message, 'erro');
      return;
    }

    online = true;
    ligarRelogio();
    botao.textContent = 'Ficar offline';
    botao.classList.add('ligado');
    definirConexao('Online', 'online');
    estadoOperacao(ICONE_RADAR, 'Recebendo chamados', 'Você está visível para os passageiros da região.', 'online');
  });

  socket.on('corrida:chamado', (dados) => mostrarChamado(dados));

  socket.on('corrida:confirmada', (dados) => {
    esconderChamado();
    corridaAceitaId = dados.corridaId;
    marcadorPassageiro = L.marker([dados.origem.latitude, dados.origem.longitude], { icon: iconePassageiro }).addTo(mapa);
    marcadorDestino = L.marker([dados.destino.latitude, dados.destino.longitude], { icon: iconeDestino }).addTo(mapa);
    botao.classList.add('escondido');
    btnFinalizar.classList.remove('escondido');
    definirConexao('Em corrida', 'busy');
    estadoOperacao(ICONE_CARRO, 'Corrida em andamento',
      `Busque o passageiro no ponto azul · ${fmtReal(dados.valorEstimado)}`, 'corrida');
  });

  socket.on('corrida:encerrada', (dados) => {
    limparCorridaDaTela();
    registrarCorridaFinalizada(dados.valorEstimado); // Ganho REAL no painel
    definirConexao('Online', 'online');
    estadoOperacao(ICONE_RADAR, 'Corrida finalizada',
      `${fmtReal(dados.valorEstimado)} somados aos seus ganhos de hoje. Você segue online.`, 'online');
  });

  socket.on('corrida:cancelada', (dados) => {
    esconderChamado();
    limparCorridaDaTela();
    definirConexao('Online', 'online');
    estadoOperacao(ICONE_RADAR, 'Corrida encerrada', `${dados.mensagem} Você segue online.`, 'online');
  });

  socket.on('disconnect', () => {
    if (online) {
      definirConexao('Reconectando', 'busy');
      estadoOperacao(ICONE_RELOGIO, 'Conexão perdida', 'Tentando reconectar à central...', 'erro');
    }
  });

  socket.on('connect_error', () => {
    definirConexao('Sem conexão', 'offline');
    estadoOperacao(ICONE_ERRO, 'Servidor fora de alcance', 'Verifique o endereço nas configurações.', 'erro');
  });
}

async function ficarOffline() {
  await desligarGps();
  if (socket) socket.disconnect();
  socket = null;
  online = false;
  desligarRelogio();
  botao.textContent = 'Ficar online';
  botao.classList.remove('ligado');
  definirConexao('Offline', 'offline');
  estadoOperacao(ICONE_RELOGIO, 'Você está offline', 'Fique online para receber chamados de corrida.');
}

botao.addEventListener('click', () => (online ? ficarOffline() : ficarOnline()));

// -----------------------------------------------------------------------------
// 8. MODAL DE CONFIGURAÇÃO
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
// 9. PARTIDA
// -----------------------------------------------------------------------------
(async function iniciar() {
  renderizarStats();
  document.getElementById('conta-id').textContent = obterMotoristaId();
  document.getElementById('conta-servidor').textContent = obterServidor() || 'não configurado';

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
          rejeitar, { enableHighAccuracy: true, timeout: 10000 }
        ));
    }
    if (pos) { mapa.setView([pos.latitude, pos.longitude], 16); moverMeuCarro(pos.latitude, pos.longitude); }
  } catch {
    console.warn('GPS indisponível na abertura — mapa no centro padrão.');
  }

  const ehNativo = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  if ('serviceWorker' in navigator && !ehNativo) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW não registrado:', e.message));
  }
})();
