/**
 * @fileoverview Adaptador da porta `Enlace` que simula a controladora.
 *
 * Ativado com `?simular` na URL. Serve para experimentar a interface sem
 * hardware: aceita os bytes e guarda a última mensagem decodificada em
 * `ultimaMensagem` (útil no console do navegador). Não substitui o teste
 * com o firmware real.
 */

import { decodificarByte } from '../dominio/protocolo.js';

/** @return {import('../aplicacao/portas.js').Enlace} */
export function criarEnlaceSimulado() {
  let conectado = false;
  const ouvintesDeQueda = new Set();

  const enlace = {
    suportado: true,
    /** @type {?import('../dominio/protocolo.js').Mensagem} */
    ultimaMensagem: null,
    async conectar() {
      await new Promise((resolver) => setTimeout(resolver, 300));
      conectado = true;
    },
    async reconectar() {
      conectado = true;
    },
    async desconectar() {
      if (!conectado) return;
      conectado = false;
      for (const ouvinte of ouvintesDeQueda) ouvinte();
    },
    async escrever(bytes) {
      if (!conectado) throw new Error('Sem conexão');
      for (const byte of bytes) enlace.ultimaMensagem = decodificarByte(byte);
    },
    aoReceber() {},
    aoDesconectar: (ouvinte) => ouvintesDeQueda.add(ouvinte),
  };
  return enlace;
}
