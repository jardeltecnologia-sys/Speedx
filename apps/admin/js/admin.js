// =============================================================================
// SPEEDX ADMIN — Central de operação (v1)
// =============================================================================
// Regra de ouro: NADA de número inventado. Este painel só exibe:
//   - /api/health          -> saúde real de API, PostgreSQL e Redis
//   - /api/admin/resumo    -> frota online, passageiros conectados e
//                             corridas ativas, direto do Redis/Socket.io
// Áreas de fases futuras aparecem como estados "preparado", sem simulação.
// =============================================================================

// ------------------------- NAVEGAÇÃO ENTRE ÁREAS ----------------------------
document.querySelectorAll('.sidebar__item').forEach((botao) => {
  botao.addEventListener('click', () => {
    document.querySelectorAll('.sidebar__item').forEach((b) => b.classList.remove('sidebar__item--ativo'));
    botao.classList.add('sidebar__item--ativo');
    const alvo = botao.dataset.area;
    document.querySelectorAll('.area').forEach((a) => a.classList.toggle('escondido', a.id !== `area-${alvo}`));
  });
});

// --------------------------- DADOS AO VIVO ----------------------------------
function badgeSaude(el, ok) {
  el.textContent = ok ? 'Operacional' : 'Falha';
  el.className = 'badge ' + (ok ? 'badge--success' : 'badge--danger');
}

async function atualizarPainel() {
  const statusPill = document.getElementById('admin-status');
  const statusTexto = document.getElementById('admin-status-texto');

  // Saúde da plataforma (dados reais)
  try {
    const saude = await (await fetch('/api/health')).json();
    badgeSaude(document.getElementById('s-api'), saude.api === 'ok');
    badgeSaude(document.getElementById('s-pg'), saude.postgres === 'ok');
    badgeSaude(document.getElementById('s-redis'), saude.redis === 'ok');

    document.getElementById('sis-api').textContent = saude.api === 'ok' ? 'Operacional' : 'Falha';
    document.getElementById('sis-pg').textContent = saude.postgres === 'ok' ? 'Operacional' : 'Falha';
    document.getElementById('sis-redis').textContent = saude.redis === 'ok' ? 'Operacional' : 'Falha';

    const agora = new Date().toLocaleTimeString('pt-BR');
    document.getElementById('saude-hora').textContent = `Última verificação: ${agora}`;
    document.getElementById('sis-hora').textContent = agora;

    const tudoOk = saude.api === 'ok' && saude.postgres === 'ok' && saude.redis === 'ok';
    statusPill.className = 'status-pill ' + (tudoOk ? 'status-pill--online' : 'status-pill--offline');
    statusTexto.textContent = tudoOk ? 'Sistema saudável' : 'Instabilidade';
  } catch {
    statusPill.className = 'status-pill status-pill--offline';
    statusTexto.textContent = 'Sem conexão';
  }

  // Resumo da operação (dados reais do Redis/Socket.io)
  try {
    const r = await (await fetch('/api/admin/resumo')).json();
    document.getElementById('mv-motoristas').textContent = r.motoristasOnline;
    document.getElementById('mv-passageiros').textContent = r.passageirosConectados;
    document.getElementById('mv-corridas').textContent = r.corridasAtivas;
    document.getElementById('mot-online').textContent = r.motoristasOnline;
  } catch {
    // Sem resumo disponível: mantém os traços (—), sem inventar números
  }
}

atualizarPainel();
setInterval(atualizarPainel, 10000); // Ao vivo: a cada 10 segundos
