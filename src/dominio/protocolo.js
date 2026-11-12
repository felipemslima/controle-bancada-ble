/**
 * @fileoverview Protocolo binário entre o controle remoto e a controladora.
 *
 * Módulo puro (sem DOM, sem BLE). A especificação completa está em
 * PROTOCOLO.md; o equivalente em C está em firmware/rc_protocolo.c.
 * Qualquer mudança aqui precisa ser espelhada nos dois lugares.
 */

export const CABECALHO_0 = 0xa5;
export const CABECALHO_1 = 0x5a;
export const TAMANHO_PACOTE = 15;

export const TIPO_COMANDO = 0x01;
export const TIPO_TELEMETRIA = 0x81;

/** Flags (byte 4). Os bits 0 a 2 valem para comando e telemetria. */
export const FLAG_ARMADO = 0x01;
export const FLAG_PARADA = 0x02;
export const FLAG_YAW_TAXA = 0x04;
/** Só na telemetria: o firmware está em failsafe por timeout. */
export const FLAG_FAILSAFE = 0x08;

/** Limites de representação do protocolo (não são os limites de voo). */
export const CENTI_MAX = 18000;
export const THROTTLE_MAX = 1000;

/**
 * @typedef {Object} Pacote
 * @property {number} tipo
 * @property {number} seq
 * @property {number} flags
 * @property {number} roll     centésimos de grau
 * @property {number} pitch    centésimos de grau
 * @property {number} yaw      centésimos de grau (ou de °/s com FLAG_YAW_TAXA)
 * @property {number} throttle 0 a 1000 (décimos de %)
 */

/**
 * CRC-16/CCITT-FALSE (polinômio 0x1021, valor inicial 0xFFFF, sem reflexão).
 * @param {ArrayLike<number>} bytes
 * @param {number=} inicio
 * @param {number=} fim exclusivo
 * @return {number}
 */
export function crc16(bytes, inicio = 0, fim = bytes.length) {
  let crc = 0xffff;
  for (let i = inicio; i < fim; i++) {
    crc ^= (bytes[i] & 0xff) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

function limitar(valor, minimo, maximo) {
  if (!Number.isFinite(valor)) return 0;
  return Math.min(maximo, Math.max(minimo, valor));
}

/** @param {number} graus @return {number} centésimos de grau, saturado */
export function grausParaCenti(graus) {
  return limitar(Math.round(graus * 100), -CENTI_MAX, CENTI_MAX);
}

/** @param {number} fracao 0 a 1 @return {number} 0 a 1000, saturado */
export function fracaoParaThrottle(fracao) {
  return limitar(Math.round(fracao * THROTTLE_MAX), 0, THROTTLE_MAX);
}

/**
 * Monta um pacote a partir dos campos já em unidades do protocolo.
 * @param {Pacote} pacote
 * @return {Uint8Array}
 */
export function codificarPacote(pacote) {
  const bytes = new Uint8Array(TAMANHO_PACOTE);
  const visao = new DataView(bytes.buffer);
  bytes[0] = CABECALHO_0;
  bytes[1] = CABECALHO_1;
  bytes[2] = pacote.tipo & 0xff;
  bytes[3] = pacote.seq & 0xff;
  bytes[4] = pacote.flags & 0xff;
  visao.setInt16(5, pacote.roll, true);
  visao.setInt16(7, pacote.pitch, true);
  visao.setInt16(9, pacote.yaw, true);
  visao.setUint16(11, pacote.throttle, true);
  visao.setUint16(13, crc16(bytes, 2, 13), true);
  return bytes;
}

/**
 * @typedef {Object} Comando
 * @property {boolean} armado
 * @property {boolean} parada   parada de emergência
 * @property {boolean} yawTaxa  true: yaw em °/s; false: yaw em graus
 * @property {number} roll      graus
 * @property {number} pitch     graus
 * @property {number} yaw       graus ou °/s
 * @property {number} throttle  0 a 1
 */

/**
 * Monta um pacote de comando a partir de unidades físicas.
 *
 * Segunda barreira de segurança: mesmo que quem chama erre, um comando
 * desarmado ou de parada SEMPRE sai com todos os valores em zero.
 *
 * @param {Comando} comando
 * @param {number} seq
 * @return {Uint8Array}
 */
export function codificarComando(comando, seq) {
  const parada = comando.parada === true;
  const armado = comando.armado === true && !parada;
  let flags = 0;
  if (armado) flags |= FLAG_ARMADO;
  if (parada) flags |= FLAG_PARADA;
  if (comando.yawTaxa) flags |= FLAG_YAW_TAXA;
  return codificarPacote({
    tipo: TIPO_COMANDO,
    seq,
    flags,
    roll: armado ? grausParaCenti(comando.roll) : 0,
    pitch: armado ? grausParaCenti(comando.pitch) : 0,
    yaw: armado ? grausParaCenti(comando.yaw) : 0,
    throttle: armado ? fracaoParaThrottle(comando.throttle) : 0,
  });
}

/**
 * Lê um pacote completo. Devolve null se o cabeçalho ou o CRC não conferem.
 * @param {ArrayLike<number>} bytes pelo menos TAMANHO_PACOTE bytes
 * @return {?Pacote}
 */
export function decodificarPacote(bytes) {
  if (bytes.length < TAMANHO_PACOTE) return null;
  if (bytes[0] !== CABECALHO_0 || bytes[1] !== CABECALHO_1) return null;
  const copia = Uint8Array.from({ length: TAMANHO_PACOTE }, (_, i) => bytes[i]);
  const visao = new DataView(copia.buffer);
  if (visao.getUint16(13, true) !== crc16(copia, 2, 13)) return null;
  return {
    tipo: copia[2],
    seq: copia[3],
    flags: copia[4],
    roll: visao.getInt16(5, true),
    pitch: visao.getInt16(7, true),
    yaw: visao.getInt16(9, true),
    throttle: visao.getUint16(11, true),
  };
}

/**
 * Decodificador de fluxo: recebe bytes em pedaços de qualquer tamanho e
 * devolve os pacotes válidos. Ressincroniza sozinho depois de lixo, bytes
 * perdidos ou corrompidos (mesmo algoritmo do parser em C).
 */
export function criarDecodificadorDeFluxo() {
  /** @type {number[]} */
  const janela = [];
  const estatisticas = { errosCrc: 0, bytesDescartados: 0 };

  function descartarPrimeiro() {
    janela.shift();
    estatisticas.bytesDescartados++;
  }

  function alinhado() {
    return janela[0] === CABECALHO_0 &&
        (janela.length < 2 || janela[1] === CABECALHO_1);
  }

  /**
   * @param {ArrayLike<number>} bytes
   * @return {!Array<Pacote>}
   */
  function alimentar(bytes) {
    const pacotes = [];
    for (let i = 0; i < bytes.length; i++) {
      janela.push(bytes[i] & 0xff);
      for (;;) {
        while (janela.length > 0 && !alinhado()) descartarPrimeiro();
        if (janela.length < TAMANHO_PACOTE) break;
        const pacote = decodificarPacote(janela);
        if (pacote) {
          pacotes.push(pacote);
          janela.length = 0;
          break;
        }
        estatisticas.errosCrc++;
        descartarPrimeiro();
      }
    }
    return pacotes;
  }

  return { alimentar, estatisticas };
}

/** @param {ArrayLike<number>} bytes @return {string} ex.: "A5 5A 01" */
export function paraHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, '0'))
      .join(' ');
}
