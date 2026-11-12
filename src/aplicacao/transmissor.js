/**
 * @fileoverview Laço de envio periódico (heartbeat).
 *
 * Garantias de segurança deste módulo:
 *  1. Só existe UMA escrita em andamento. Não há fila: se o tick chega com
 *     uma escrita pendente, ele é descartado.
 *  2. O pacote é montado no instante do envio, a partir do estado atual.
 *     Nenhum valor antigo fica guardado esperando para sair.
 *  3. Ao desarmar (PARAR, perda de foco etc.), o pacote zerado sai
 *     imediatamente, ou logo após a escrita pendente terminar. Como as
 *     escritas são seriais, ele sempre chega DEPOIS de qualquer valor antigo.
 *  4. Se uma escrita travar, a conexão é derrubada; o failsafe por timeout
 *     do firmware assume.
 */

import { Acao, Conexao, comandoDeSaida } from '../dominio/estado.js';
import { codificarComando } from '../dominio/protocolo.js';

/** Tempo máximo de uma escrita antes de considerar o enlace travado. */
export const LIMITE_ESCRITA_MS = 1000;

/**
 * @param {Object} deps
 * @param {ReturnType<import('./loja.js').criarLoja>} deps.loja
 * @param {import('./portas.js').Enlace} deps.enlace
 * @param {function(): number=} deps.agora relógio em ms (injetável em testes)
 */
export function criarTransmissor({ loja, enlace, agora = () => performance.now() }) {
  let seq = 0;
  let ocupado = false;
  let urgente = false;
  let inicioDaEscrita = 0;
  let temporizador = null;
  /** @type {number[]} instantes dos envios do último segundo */
  const instantes = [];
  const contadores = { enviados: 0, descartados: 0, erros: 0 };
  /** @type {?Uint8Array} */
  let ultimoPacote = null;

  async function enviar() {
    const estado = loja.estado();
    if (estado.conexao !== Conexao.CONECTADO) return;
    if (ocupado) {
      contadores.descartados++;
      return;
    }
    const comando = comandoDeSaida(estado);
    const pacote = codificarComando(comando, seq);
    seq = (seq + 1) & 0xff;
    ocupado = true;
    inicioDaEscrita = agora();
    let enviado = false;
    try {
      await enlace.escrever(pacote);
      enviado = true;
    } catch {
      contadores.erros++;
    } finally {
      ocupado = false;
    }
    if (enviado) {
      ultimoPacote = pacote;
      contadores.enviados++;
      instantes.push(agora());
      loja.despachar({ tipo: Acao.PACOTE_ENVIADO, parada: comando.parada });
    }
    if (urgente) {
      urgente = false;
      enviar();
    }
  }

  /** Envia já, sem esperar o próximo tick (usado ao desarmar). */
  function enviarAgora() {
    if (ocupado) {
      urgente = true;
    } else {
      enviar();
    }
  }

  /** Um passo do laço periódico. Exposto para os testes. */
  function tick() {
    if (ocupado && agora() - inicioDaEscrita > LIMITE_ESCRITA_MS) {
      // Escrita travada: não dá para cancelar, então derruba o enlace.
      enlace.desconectar().catch(() => {});
      return;
    }
    enviar();
  }

  function parar() {
    if (temporizador !== null) clearInterval(temporizador);
    temporizador = null;
  }

  function iniciar() {
    parar();
    temporizador = setInterval(tick, 1000 / loja.estado().config.taxaHz);
  }

  loja.assinar((novo, anterior) => {
    if (anterior.armado && !novo.armado) enviarAgora();
    if (novo.config.taxaHz !== anterior.config.taxaHz && temporizador !== null) {
      iniciar();
    }
  });

  /** Dados para o painel de debug. */
  function diagnostico() {
    const limite = agora() - 1000;
    while (instantes.length > 0 && instantes[0] < limite) instantes.shift();
    return { ...contadores, taxaHz: instantes.length, ultimoPacote };
  }

  return { iniciar, parar, tick, enviarAgora, diagnostico };
}
