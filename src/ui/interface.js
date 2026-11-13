/**
 * @fileoverview Liga o DOM à loja de estado.
 *
 * Regra da camada: a interface só despacha ações e desenha o estado.
 * Nenhuma regra de segurança é decidida aqui.
 */

import { CONFIG_PADRAO } from '../dominio/config.js';
import { Acao, Conexao, comandoDeSaida, podeArmar } from '../dominio/estado.js';
import { paraHex } from '../dominio/protocolo.js';
import { criarBotaoDeSegurar, criarJoystick } from './controles.js';

const TEMPO_PARA_ARMAR_MS = 1000;
const PERIODO_DEBUG_MS = 250;
const VALIDADE_TELEMETRIA_MS = 1000;

const ROTULO_CONEXAO = {
  [Conexao.DESCONECTADO]: 'Desconectado',
  [Conexao.CONECTANDO]: 'Conectando…',
  [Conexao.CONECTADO]: 'Conectado',
};

const graus = (valor) => `${valor.toFixed(1)}°`;
const porcento = (fracao) => `${(fracao * 100).toFixed(0)}%`;

/**
 * @param {Object} deps
 * @param {ReturnType<import('../aplicacao/loja.js').criarLoja>} deps.loja
 * @param {ReturnType<import('../aplicacao/conexao.js').criarGerenciadorDeConexao>} deps.conexao
 * @param {ReturnType<import('../aplicacao/transmissor.js').criarTransmissor>} deps.transmissor
 * @param {import('../aplicacao/portas.js').Armazenamento} deps.armazenamento
 * @param {{suportada: boolean, ativa: function(): boolean}} deps.travaDeTela
 * @param {boolean} deps.suportado o navegador tem o transporte
 * @param {boolean} deps.simulado
 * @param {Document=} deps.documento
 */
export function montarInterface({
  loja, conexao, transmissor, armazenamento, travaDeTela, suportado, simulado,
  documento = document,
}) {
  const $ = (id) => documento.getElementById(id);
  const despachar = (tipo, extras) => loja.despachar({ tipo, ...extras });

  // --- Controles de voo -------------------------------------------------
  // Estilo "modo 2" de rádio: esquerdo = throttle e yaw; direito = pitch e roll.
  const esquerdo = criarJoystick($('joystick-esquerdo'), {
    retornaY: false,
    aoMudar: (x, y) => despachar(Acao.EIXOS_ALTERADOS,
        { eixos: { yaw: x, throttle: (y + 1) / 2 } }),
  });
  const direito = criarJoystick($('joystick-direito'), {
    aoMudar: (x, y) => despachar(Acao.EIXOS_ALTERADOS,
        { eixos: { roll: x, pitch: y } }),
  });
  esquerdo.habilitarY(false); // throttle só funciona armado

  // --- Armar, desarmar e PARAR -----------------------------------------
  criarBotaoDeSegurar($('botao-armar'), {
    duracaoMs: TEMPO_PARA_ARMAR_MS,
    podeSegurar: () => podeArmar(loja.estado()).ok,
    aoConcluir: () => despachar(Acao.ARMAR),
    // Armado: um toque desarma. Desarmado e sem condição: mostra o motivo.
    aoTocar: () => despachar(loja.estado().armado ? Acao.DESARMAR : Acao.ARMAR),
  });

  const parar = () => despachar(Acao.PARAR);
  $('botao-parar').addEventListener('pointerdown', parar);
  $('botao-parar').addEventListener('click', parar);
  documento.addEventListener('keydown', (evento) => {
    const emCampo = evento.target instanceof HTMLElement &&
        evento.target.matches('input, select, textarea');
    if (evento.key === 'Escape' || (evento.key === ' ' && !emCampo)) {
      evento.preventDefault();
      parar();
    }
  });

  // --- Conexão ----------------------------------------------------------
  $('botao-conectar').addEventListener('click', () => {
    if (loja.estado().conexao === Conexao.DESCONECTADO) {
      conexao.conectar();
    } else {
      conexao.desconectar();
    }
  });

  // --- Ajustes ----------------------------------------------------------
  const painel = $('ajustes');
  const formulario = $('form-ajustes');

  function preencherFormulario(config) {
    for (const campo of formulario.elements) {
      if (!campo.name) continue;
      if (campo.type === 'checkbox') {
        campo.checked = config[campo.name];
      } else {
        campo.value = config[campo.name];
      }
    }
  }

  function lerFormulario() {
    const config = {};
    for (const campo of formulario.elements) {
      if (!campo.name) continue;
      config[campo.name] = campo.type === 'checkbox' ? campo.checked : campo.value;
    }
    return config;
  }

  $('botao-ajustes').addEventListener('click', () => {
    if (loja.estado().armado) {
      despachar(Acao.AVISO, { texto: 'Desarme antes de alterar os ajustes.' });
      return;
    }
    preencherFormulario(loja.estado().config);
    painel.hidden = false;
  });
  $('botao-fechar-ajustes').addEventListener('click', () => {
    painel.hidden = true;
  });
  $('botao-padrao').addEventListener('click', () => preencherFormulario(CONFIG_PADRAO));
  formulario.addEventListener('submit', (evento) => {
    evento.preventDefault();
    despachar(Acao.CONFIG_ALTERADA, { config: lerFormulario() });
    armazenamento.gravar(loja.estado().config);
    painel.hidden = true;
  });

  // Evita menu de contexto e seleção por toque longo sobre os controles.
  documento.addEventListener('contextmenu', (evento) => {
    if (!(evento.target instanceof HTMLElement && evento.target.matches('input'))) {
      evento.preventDefault();
    }
  });

  // --- Desenho ----------------------------------------------------------
  function desenhar() {
    const estado = loja.estado();
    const comando = comandoDeSaida(estado);
    const conectado = estado.conexao === Conexao.CONECTADO;

    documento.body.classList.toggle('armado', estado.armado);
    documento.body.dataset.conexao = estado.conexao;

    $('estado-conexao').textContent =
        ROTULO_CONEXAO[estado.conexao] + (simulado ? ' (simulado)' : '');
    $('botao-conectar').textContent =
        estado.conexao === Conexao.DESCONECTADO ? 'Conectar' : 'Desconectar';
    $('botao-armar').textContent = estado.armado ? 'DESARMAR' : 'Segure para ARMAR';
    $('botao-armar').classList.toggle('indisponivel', !estado.armado && !conectado);
    $('botao-ajustes').disabled = estado.armado;

    const semSuporte = !suportado && !simulado;
    $('aviso').textContent = semSuporte ?
        'Este navegador não tem Web Bluetooth. No iPhone use o Bluefy; ' +
        'no Android e no PC, Chrome ou Edge.' :
        (estado.aviso ?? '');

    const unidadeYaw = comando.yawTaxa ? '°/s' : '°';
    $('cmd-roll').textContent = graus(comando.roll);
    $('cmd-pitch').textContent = graus(comando.pitch);
    $('cmd-yaw').textContent = `${comando.yaw.toFixed(1)}${unidadeYaw}`;
    $('cmd-throttle').textContent = porcento(comando.throttle);

    const t = estado.telemetria;
    const recente = t && Date.now() - t.instante < VALIDADE_TELEMETRIA_MS;
    $('med-roll').textContent = recente ? graus(t.roll) : '—';
    $('med-pitch').textContent = recente ? graus(t.pitch) : '—';
    $('med-yaw').textContent =
        recente ? `${t.yaw.toFixed(1)}${t.yawTaxa ? '°/s' : '°'}` : '—';
    $('med-throttle').textContent = recente ? porcento(t.throttle) : '—';
    $('estado-firmware').textContent = !recente ? 'sem telemetria' :
        t.failsafe ? 'FAILSAFE' :
        t.paradaTravada ? 'parada travada' :
        t.armado ? 'armado' : 'desarmado';
  }

  function desenharDebug() {
    const d = transmissor.diagnostico();
    $('dbg-pacote').textContent = d.ultimoPacote ? paraHex(d.ultimoPacote) : '—';
    $('dbg-taxa').textContent =
        `${d.taxaHz} Hz (alvo ${loja.estado().config.taxaHz} Hz)`;
    $('dbg-contadores').textContent =
        `${d.enviados} enviados, ${d.descartados} descartados, ${d.erros} erros`;
    $('dbg-trava').textContent = !travaDeTela.suportada ? 'sem suporte' :
        travaDeTela.ativa() ? 'ativa' : 'inativa';
    $('dbg-desarme').textContent = loja.estado().motivoDesarme ?? '—';
    desenhar(); // também envelhece a telemetria na tela
  }

  // Vários eventos de toque por quadro viram um desenho só.
  let agendado = false;
  function agendarDesenho() {
    if (agendado) return;
    agendado = true;
    requestAnimationFrame(() => {
      agendado = false;
      desenhar();
    });
  }

  loja.assinar((novo, anterior) => {
    if (novo.geracaoDeControles !== anterior.geracaoDeControles) {
      esquerdo.reiniciar();
      direito.reiniciar();
    }
    if (novo.armado !== anterior.armado) esquerdo.habilitarY(novo.armado);
    agendarDesenho();
  });

  setInterval(desenharDebug, PERIODO_DEBUG_MS);
  desenhar();
}
