/**
 * @fileoverview Gerencia a conexão: conectar, desconectar, reconexão
 * automática e leitura da telemetria.
 *
 * Reconectar NUNCA rearma: a queda da conexão já desarmou (ver estado.js),
 * e armar de novo exige o gesto do usuário.
 */

import { normalizarUuid } from '../dominio/config.js';
import { Acao, Conexao } from '../dominio/estado.js';
import {
  FLAG_ARMADO, FLAG_FAILSAFE, FLAG_PARADA, FLAG_YAW_TAXA, THROTTLE_MAX,
  TIPO_TELEMETRIA, criarDecodificadorDeFluxo,
} from '../dominio/protocolo.js';

/** Esperas entre as tentativas de reconexão automática. */
export const ESPERAS_DE_RECONEXAO_MS = [500, 1000, 2000, 4000];

function mensagemDeErro(erro) {
  if (erro?.name === 'NotFoundError') return 'Nenhum dispositivo selecionado.';
  if (erro?.name === 'SecurityError') return 'O navegador bloqueou o Bluetooth.';
  return `Falha na conexão: ${erro?.message ?? erro}`;
}

/**
 * @param {Object} deps
 * @param {ReturnType<import('./loja.js').criarLoja>} deps.loja
 * @param {import('./portas.js').Enlace} deps.enlace
 * @param {function(number): Promise<void>=} deps.esperar injetável em testes
 * @param {function(): number=} deps.agora
 */
export function criarGerenciadorDeConexao({
  loja,
  enlace,
  esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms)),
  agora = () => Date.now(),
}) {
  let decodificador = criarDecodificadorDeFluxo();
  let desejaConectado = false;
  let geracao = 0;

  const mudar = (conexao) => loja.despachar({ tipo: Acao.CONEXAO_ALTERADA, conexao });
  const avisar = (texto) => loja.despachar({ tipo: Acao.AVISO, texto });

  enlace.aoReceber((bytes) => {
    for (const pacote of decodificador.alimentar(bytes)) {
      if (pacote.tipo !== TIPO_TELEMETRIA) continue;
      loja.despachar({
        tipo: Acao.TELEMETRIA_RECEBIDA,
        telemetria: Object.freeze({
          roll: pacote.roll / 100,
          pitch: pacote.pitch / 100,
          yaw: pacote.yaw / 100,
          throttle: pacote.throttle / THROTTLE_MAX,
          armado: (pacote.flags & FLAG_ARMADO) !== 0,
          paradaTravada: (pacote.flags & FLAG_PARADA) !== 0,
          yawTaxa: (pacote.flags & FLAG_YAW_TAXA) !== 0,
          failsafe: (pacote.flags & FLAG_FAILSAFE) !== 0,
          instante: agora(),
        }),
      });
    }
  });

  enlace.aoDesconectar(() => {
    mudar(Conexao.DESCONECTADO);
    if (desejaConectado) reconectarAutomaticamente();
  });

  async function reconectarAutomaticamente() {
    const minhaGeracao = ++geracao;
    for (const espera of ESPERAS_DE_RECONEXAO_MS) {
      await esperar(espera);
      if (minhaGeracao !== geracao || !desejaConectado) return;
      mudar(Conexao.CONECTANDO);
      try {
        await enlace.reconectar();
        if (minhaGeracao !== geracao) return;
        decodificador = criarDecodificadorDeFluxo();
        mudar(Conexao.CONECTADO);
        avisar('Reconectado. Arme de novo para continuar.');
        return;
      } catch {
        if (minhaGeracao !== geracao) return;
        mudar(Conexao.DESCONECTADO);
      }
    }
    desejaConectado = false;
    avisar('Não foi possível reconectar. Toque em Conectar.');
  }

  /** Abre o seletor e conecta. Chame a partir de um gesto do usuário. */
  async function conectar() {
    if (loja.estado().conexao !== Conexao.DESCONECTADO) return;
    if (!enlace.suportado) {
      avisar('Este navegador não tem Web Bluetooth. No iPhone, use o Bluefy.');
      return;
    }
    const config = loja.estado().config;
    geracao++;
    desejaConectado = true;
    mudar(Conexao.CONECTANDO);
    try {
      await enlace.conectar({
        servico: normalizarUuid(config.uuidServico),
        caracteristica: normalizarUuid(config.uuidCaracteristica),
        mostrarTodos: config.mostrarTodosDispositivos,
      });
      decodificador = criarDecodificadorDeFluxo();
      mudar(Conexao.CONECTADO);
    } catch (erro) {
      desejaConectado = false;
      mudar(Conexao.DESCONECTADO);
      avisar(mensagemDeErro(erro));
    }
  }

  /** Desconecta a pedido do usuário. Recusado enquanto armado. */
  async function desconectar() {
    if (loja.estado().armado) {
      avisar('Desarme antes de desconectar.');
      return;
    }
    desejaConectado = false;
    geracao++;
    await enlace.desconectar().catch(() => {});
    mudar(Conexao.DESCONECTADO);
  }

  return { conectar, desconectar };
}
