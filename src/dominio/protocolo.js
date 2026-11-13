/**
 * @fileoverview Protocolo de um byte entre o controle e a controladora.
 *
 * Módulo puro (sem DOM, sem BLE). A especificação completa está em
 * PROTOCOLO.md; o equivalente em C está em firmware/rc_byte.c.
 * Qualquer mudança aqui precisa ser espelhada nos dois lugares.
 *
 * Cada byte é uma mensagem completa:
 *   0xF0          conectar (libera o controle)
 *   0xFF          desconectar / parar
 *   0xF1 a 0xFE   reservados (o receptor ignora)
 *   outros        posição: nibble alto = pitch, nibble baixo = roll,
 *                 cada um de 0 a 14, com centro 7 (0x77 = parado)
 *
 * Como uma posição nunca usa o nibble 0xF, nenhuma posição pode ser
 * confundida com conectar ou desconectar.
 */

export const BYTE_CONECTAR = 0xf0;
export const BYTE_DESCONECTAR = 0xff;

/** Valor do nibble que representa o centro do eixo. */
export const CENTRO = 7;

/** Níveis de cada lado do centro (posição de 0 a 14 no nibble). */
export const NIVEIS_POR_LADO = 7;

/** Byte de posição com os dois eixos no centro. */
export const BYTE_PARADO = (CENTRO << 4) | CENTRO;

export const Tipo = Object.freeze({
  CONECTAR: 'conectar',
  DESCONECTAR: 'desconectar',
  POSICAO: 'posicao',
  RESERVADO: 'reservado',
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
 * @property {number} pitch nível de -7 a 7 (0 fora de POSICAO)
 * @property {number} roll  nível de -7 a 7 (0 fora de POSICAO)
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
 * @param {number} nivelPitch -7 a 7 (saturado)
 * @param {number} nivelRoll  -7 a 7 (saturado)
 * @return {number} 0x00 a 0xEE, nunca com nibble 0xF
 */
export function codificarPosicao(nivelPitch, nivelRoll) {
  const nibble = (n) => CENTRO + Math.min(NIVEIS_POR_LADO,
      Math.max(-NIVEIS_POR_LADO, Number.isFinite(n) ? Math.round(n) : 0));
  return (nibble(nivelPitch) << 4) | nibble(nivelRoll);
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
  const alto = b >> 4;
  const baixo = b & 0x0f;
  if (alto === 0x0f || baixo === 0x0f) return { tipo: Tipo.RESERVADO, pitch: 0, roll: 0 };
  return { tipo: Tipo.POSICAO, pitch: alto - CENTRO, roll: baixo - CENTRO };
}

/** @param {ArrayLike<number>} bytes @return {string} ex.: "77 F0" */
export function paraHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, '0'))
      .join(' ');
}
