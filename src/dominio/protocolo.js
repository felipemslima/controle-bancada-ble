/**
 * @fileoverview Protocolo de um byte entre o controle e a controladora.
 *
 * Módulo puro (sem DOM, sem BLE). A especificação completa está em
 * PROTOCOLO.md; o equivalente em C está em firmware/rc_byte.c.
 * Qualquer mudança aqui precisa ser espelhada nos dois lugares.
 *
 * Cada byte é uma mensagem completa:
 *   0xFF          conectar (libera o controle)
 *   0x00          desconectar / parar
 *   0x01 a 0xFE   posição: nibble alto = pitch, nibble baixo = roll,
 *                 centro 8 (0x88 = parado)
 *
 * O firmware aceita níveis de -8 a +7 em cada eixo (nibble - 8). A página
 * usa só -7 a +7, para o joystick ser simétrico; e o único canto que
 * coincidiria com um byte especial (+7, +7 = 0xFF) recua para 0xEE.
 */

export const BYTE_CONECTAR = 0xff;
export const BYTE_DESCONECTAR = 0x00;

/** Valor do nibble que representa o centro do eixo. */
export const CENTRO = 8;

/** Níveis de cada lado do centro que a página envia (nibble de 1 a 15). */
export const NIVEIS_POR_LADO = 7;

/** Byte de posição com os dois eixos no centro. */
export const BYTE_PARADO = (CENTRO << 4) | CENTRO;

export const Tipo = Object.freeze({
  CONECTAR: 'conectar',
  DESCONECTAR: 'desconectar',
  POSICAO: 'posicao',
});

/**
 * @typedef {Object} Comando
 * @property {string} tipo  CONECTAR, DESCONECTAR ou POSICAO
 * @property {number} pitch -1 a 1 (para cima positivo); só vale em POSICAO
 * @property {number} roll  -1 a 1 (para a direita positivo); só vale em POSICAO
 */

/**
 * @typedef {Object} Mensagem
 * @property {string} tipo  um valor de Tipo
 * @property {number} pitch nível de -8 a 7 (0 fora de POSICAO)
 * @property {number} roll  nível de -8 a 7 (0 fora de POSICAO)
 */

/**
 * Converte a posição normalizada de um eixo no nível inteiro.
 * @param {number} valor -1 a 1 (valores fora da faixa são saturados)
 * @return {number} -7 a 7; NaN vira 0
 */
export function nivelDoEixo(valor) {
  if (!Number.isFinite(valor)) return 0;
  const nivel = Math.round(valor * NIVEIS_POR_LADO);
  // `+ 0` evita o -0, que atrapalharia comparações e exibição.
  return Math.min(NIVEIS_POR_LADO, Math.max(-NIVEIS_POR_LADO, nivel)) + 0;
}

/**
 * Monta o byte de posição a partir dos níveis.
 *
 * Os níveis são saturados em -7..7, então o nibble vai de 1 a 15 e o byte
 * nunca é 0x00. O canto (+7, +7) daria 0xFF (conectar); nesse caso os dois
 * eixos recuam um nível, para 0xEE.
 *
 * @param {number} nivelPitch -7 a 7 (saturado)
 * @param {number} nivelRoll  -7 a 7 (saturado)
 * @return {number} 0x11 a 0xFE, nunca 0x00 nem 0xFF
 */
export function codificarPosicao(nivelPitch, nivelRoll) {
  const nibble = (n) => CENTRO + Math.min(NIVEIS_POR_LADO,
      Math.max(-NIVEIS_POR_LADO, Number.isFinite(n) ? Math.round(n) : 0));
  const byte = (nibble(nivelPitch) << 4) | nibble(nivelRoll);
  return byte === BYTE_CONECTAR ? 0xee : byte;
}

/**
 * Monta o byte a enviar.
 * @param {Comando} comando
 * @return {Uint8Array} um único byte
 */
export function codificarComando(comando) {
  let byte;
  if (comando.tipo === Tipo.POSICAO) {
    byte = codificarPosicao(nivelDoEixo(comando.pitch), nivelDoEixo(comando.roll));
  } else if (comando.tipo === Tipo.CONECTAR) {
    byte = BYTE_CONECTAR;
  } else {
    // Qualquer tipo desconhecido vira o byte seguro.
    byte = BYTE_DESCONECTAR;
  }
  return Uint8Array.of(byte);
}

/**
 * Lê um byte recebido (é o que o firmware faz; usado na simulação e nos
 * testes).
 * @param {number} byte
 * @return {Mensagem}
 */
export function decodificarByte(byte) {
  const b = byte & 0xff;
  if (b === BYTE_CONECTAR) return { tipo: Tipo.CONECTAR, pitch: 0, roll: 0 };
  if (b === BYTE_DESCONECTAR) return { tipo: Tipo.DESCONECTAR, pitch: 0, roll: 0 };
  return { tipo: Tipo.POSICAO, pitch: (b >> 4) - CENTRO, roll: (b & 0x0f) - CENTRO };
}

/** @param {ArrayLike<number>} bytes @return {string} ex.: "88 FF" */
export function paraHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, '0'))
      .join(' ');
}
