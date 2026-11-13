/**
 * @fileoverview Configuração do controle: valores padrão e validação.
 * Módulo puro.
 */

/**
 * @typedef {Object} Config
 * @property {string} uuidServico         16 bits ("FFE0") ou 128 bits
 * @property {string} uuidCaracteristica  16 bits ("FFE1") ou 128 bits
 * @property {boolean} mostrarTodosDispositivos lista todos no seletor BLE
 * @property {number} taxaHz              taxa de envio (heartbeat)
 * @property {boolean} inverterRoll
 * @property {boolean} inverterPitch
 */

/** @type {Readonly<Config>} Padrão: módulo HM-10. */
export const CONFIG_PADRAO = Object.freeze({
  uuidServico: 'FFE0',
  uuidCaracteristica: 'FFE1',
  mostrarTodosDispositivos: false,
  taxaHz: 30,
  inverterRoll: false,
  inverterPitch: false,
});

/** Faixas aceitas para os campos numéricos: [mínimo, máximo]. */
export const LIMITES = Object.freeze({
  taxaHz: [10, 50],
});

const UUID_16 = /^[0-9a-f]{4}$/;
const UUID_128 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Converte o texto digitado para o formato que o Web Bluetooth aceita.
 * @param {*} texto "FFE0", "0xFFE0" ou UUID de 128 bits
 * @return {number|string|null} número (16 bits), string (128 bits) ou null
 */
export function normalizarUuid(texto) {
  const limpo = String(texto ?? '').trim().toLowerCase().replace(/^0x/, '');
  if (UUID_16.test(limpo)) return parseInt(limpo, 16);
  if (UUID_128.test(limpo)) return limpo;
  return null;
}

function numero(valor, chave) {
  const [minimo, maximo] = LIMITES[chave];
  const n = Number(valor);
  if (!Number.isFinite(n)) return CONFIG_PADRAO[chave];
  return Math.min(maximo, Math.max(minimo, n));
}

function uuid(valor, chave) {
  return normalizarUuid(valor) === null ?
      CONFIG_PADRAO[chave] : String(valor).trim().toUpperCase();
}

/**
 * Devolve uma configuração completa e válida. Campos ausentes ou inválidos
 * voltam ao padrão; números fora da faixa são saturados; campos que não
 * existem mais (de versões antigas salvas no navegador) são descartados.
 * @param {?Object=} entrada
 * @return {Readonly<Config>}
 */
export function normalizarConfig(entrada) {
  const e = entrada && typeof entrada === 'object' ? entrada : {};
  return Object.freeze({
    uuidServico: uuid(e.uuidServico, 'uuidServico'),
    uuidCaracteristica: uuid(e.uuidCaracteristica, 'uuidCaracteristica'),
    mostrarTodosDispositivos: e.mostrarTodosDispositivos === true,
    taxaHz: Math.round(numero(e.taxaHz, 'taxaHz')),
    inverterRoll: e.inverterRoll === true,
    inverterPitch: e.inverterPitch === true,
  });
}
