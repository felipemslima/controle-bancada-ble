/**
 * @fileoverview Gerencia a conexão: conectar, desconectar e reconexão
 * automática.
 *
 * Reconectar NUNCA rearma: a queda da conexão já desarmou (ver estado.js),
 * e armar de novo exige o gesto do usuário.
 *
 * O protocolo atual não tem telemetria; bytes que chegarem do módulo são
 * ignorados.
 */

import { normalizarUuid } from '../dominio/config.js';
import { Acao, Conexao } from '../dominio/estado.js';

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
 */
export function criarGerenciadorDeConexao({
  loja,
  enlace,
  esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms)),
}) {
  let desejaConectado = false;
  let geracao = 0;

  const mudar = (conexao) => loja.despachar({ tipo: Acao.CONEXAO_ALTERADA, conexao });
  const avisar = (texto) => loja.despachar({ tipo: Acao.AVISO, texto });

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
