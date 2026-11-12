/**
 * @fileoverview Adaptador da porta `Enlace` que simula a controladora.
 *
 * Ativado com `?simular` na URL. Serve para experimentar a interface sem
 * hardware: aceita os comandos e devolve uma telemetria em que os ângulos
 * "medidos" seguem o comando com atraso. Não substitui o teste com o
 * firmware real.
 */

import {
  FLAG_ARMADO, FLAG_PARADA, TIPO_TELEMETRIA, codificarPacote,
  decodificarPacote,
} from '../dominio/protocolo.js';

const SUAVIZACAO = 0.15;
const COMANDOS_POR_TELEMETRIA = 3;

/** @return {import('../aplicacao/portas.js').Enlace} */
export function criarEnlaceSimulado() {
  let conectado = false;
  let recebidos = 0;
  let seq = 0;
  const medido = { roll: 0, pitch: 0, yaw: 0, throttle: 0 };
  const ouvintesDeDados = new Set();
  const ouvintesDeQueda = new Set();

  async function conectar() {
    await new Promise((resolver) => setTimeout(resolver, 300));
    conectado = true;
  }

  async function desconectar() {
    if (!conectado) return;
    conectado = false;
    for (const ouvinte of ouvintesDeQueda) ouvinte();
  }

  async function escrever(bytes) {
    if (!conectado) throw new Error('Sem conexão');
    const comando = decodificarPacote(bytes);
    if (!comando) return;
    for (const eixo of Object.keys(medido)) {
      medido[eixo] += (comando[eixo] - medido[eixo]) * SUAVIZACAO;
    }
    if (++recebidos % COMANDOS_POR_TELEMETRIA !== 0) return;
    const telemetria = codificarPacote({
      tipo: TIPO_TELEMETRIA,
      seq: seq++,
      flags: comando.flags & (FLAG_ARMADO | FLAG_PARADA),
      roll: Math.round(medido.roll),
      pitch: Math.round(medido.pitch),
      yaw: Math.round(medido.yaw),
      throttle: Math.round(medido.throttle),
    });
    for (const ouvinte of ouvintesDeDados) ouvinte(telemetria);
  }

  return {
    suportado: true,
    conectar,
    reconectar: conectar,
    desconectar,
    escrever,
    aoReceber: (ouvinte) => ouvintesDeDados.add(ouvinte),
    aoDesconectar: (ouvinte) => ouvintesDeQueda.add(ouvinte),
  };
}
