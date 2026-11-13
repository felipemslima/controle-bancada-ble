/**
 * @fileoverview Estado do controle e regras de segurança.
 *
 * Módulo puro: `reduzir(estado, acao)` devolve um novo estado e nunca altera
 * o anterior. Toda regra de segurança da página mora aqui, e
 * `comandoDeSaida` é o ÚNICO lugar que decide o que vai para o rádio.
 *
 * Correspondência com o protocolo de um byte (PROTOCOLO.md):
 *   desarmado ou em parada  -> 0xFF (desconectar), repetido como heartbeat
 *   acabou de armar         -> 0xF0 (conectar), PACOTES_DE_INICIO vezes
 *   armado                  -> byte de posição (pitch e roll)
 */

import { CONFIG_PADRAO, normalizarConfig } from './config.js';
import { Tipo } from './protocolo.js';

export const Conexao = Object.freeze({
  DESCONECTADO: 'desconectado',
  CONECTANDO: 'conectando',
  CONECTADO: 'conectado',
});

export const Acao = Object.freeze({
  CONEXAO_ALTERADA: 'conexao-alterada',
  EIXOS_ALTERADOS: 'eixos-alterados',
  ARMAR: 'armar',
  DESARMAR: 'desarmar',
  PARAR: 'parar',
  FOCO_PERDIDO: 'foco-perdido',
  PACOTE_ENVIADO: 'pacote-enviado',
  CONFIG_ALTERADA: 'config-alterada',
  AVISO: 'aviso',
});

/** Quantos 0xFF precisam sair depois de um PARAR antes de poder rearmar. */
export const PACOTES_DE_PARADA = 10;

/**
 * Quantas vezes o 0xF0 (conectar) é enviado ao armar. Repetir cobre a perda
 * de um byte no rádio; o firmware deve tratar 0xF0 repetido como um só.
 */
export const PACOTES_DE_INICIO = 3;

/**
 * Posição do joystick, normalizada.
 * @typedef {Object} Eixos
 * @property {number} roll  -1 a 1 (direita positivo)
 * @property {number} pitch -1 a 1 (para cima positivo)
 */

/** @type {Readonly<Eixos>} */
export const EIXOS_ZERADOS = Object.freeze({ roll: 0, pitch: 0 });

/**
 * @typedef {Object} Estado
 * @property {string} conexao             um valor de Conexao
 * @property {boolean} armado
 * @property {Readonly<Eixos>} eixos
 * @property {number} paradaRestante      0xFF ainda a enviar após um PARAR
 * @property {number} inicioRestante      0xF0 ainda a enviar após armar
 * @property {number} geracaoDeControles  muda quando a UI deve soltar os controles
 * @property {?string} motivoDesarme      por que desarmou da última vez
 * @property {?string} aviso              mensagem para o usuário
 * @property {Readonly<import('./config.js').Config>} config
 */

/**
 * @param {Readonly<import('./config.js').Config>=} config
 * @return {Readonly<Estado>}
 */
export function estadoInicial(config = CONFIG_PADRAO) {
  return Object.freeze({
    conexao: Conexao.DESCONECTADO,
    armado: false,
    eixos: EIXOS_ZERADOS,
    paradaRestante: 0,
    inicioRestante: 0,
    geracaoDeControles: 0,
    motivoDesarme: null,
    aviso: null,
    config,
  });
}

function limitar(valor, minimo, maximo) {
  if (!Number.isFinite(valor)) return 0;
  return Math.min(maximo, Math.max(minimo, valor));
}

/** @param {Eixos} eixos @return {boolean} */
export function eixosZerados(eixos) {
  return eixos.roll === 0 && eixos.pitch === 0;
}

/**
 * Diz se é permitido armar agora e, se não for, o motivo.
 * @param {Estado} estado
 * @return {{ok: boolean, motivo: ?string}}
 */
export function podeArmar(estado) {
  if (estado.armado) return { ok: false, motivo: 'Já está armado.' };
  if (estado.conexao !== Conexao.CONECTADO) {
    return { ok: false, motivo: 'Conecte ao módulo antes de armar.' };
  }
  if (estado.paradaRestante > 0) {
    return { ok: false, motivo: 'Parada de emergência em andamento. Aguarde.' };
  }
  if (!eixosZerados(estado.eixos)) {
    return { ok: false, motivo: 'Solte o joystick antes de armar.' };
  }
  return { ok: true, motivo: null };
}

/** Desarma, zera os eixos e manda a UI soltar os controles. */
function zerar(estado, extras) {
  return Object.freeze({
    ...estado,
    armado: false,
    inicioRestante: 0,
    eixos: EIXOS_ZERADOS,
    geracaoDeControles: estado.geracaoDeControles + 1,
    ...extras,
  });
}

function desarmar(estado, motivo) {
  if (!estado.armado) return zerar(estado, {});
  return zerar(estado, { motivoDesarme: motivo, aviso: `Desarmado: ${motivo}.` });
}

/**
 * @param {Readonly<Estado>} estado
 * @param {{tipo: string}} acao
 * @return {Readonly<Estado>}
 */
export function reduzir(estado, acao) {
  switch (acao.tipo) {
    case Acao.CONEXAO_ALTERADA: {
      if (acao.conexao === estado.conexao) return estado;
      if (acao.conexao === Conexao.CONECTADO) {
        return Object.freeze({ ...estado, conexao: acao.conexao, aviso: null });
      }
      // Qualquer saída do estado conectado desarma e zera.
      const base = desarmar(estado, 'conexão perdida');
      return Object.freeze({ ...base, conexao: acao.conexao });
    }

    case Acao.EIXOS_ALTERADOS: {
      const e = { ...estado.eixos, ...acao.eixos };
      const eixos = Object.freeze({
        roll: limitar(e.roll, -1, 1),
        pitch: limitar(e.pitch, -1, 1),
      });
      return Object.freeze({ ...estado, eixos });
    }

    case Acao.ARMAR: {
      const { ok, motivo } = podeArmar(estado);
      if (!ok) return Object.freeze({ ...estado, aviso: motivo });
      return Object.freeze({
        ...estado,
        armado: true,
        inicioRestante: PACOTES_DE_INICIO,
        aviso: null,
      });
    }

    case Acao.DESARMAR:
      return desarmar(estado, acao.motivo ?? 'pedido do usuário');

    case Acao.PARAR:
      // Vale em qualquer estado, inclusive desconectado.
      return zerar(estado, {
        paradaRestante: PACOTES_DE_PARADA,
        motivoDesarme: 'parada de emergência',
        aviso: 'PARADA DE EMERGÊNCIA.',
      });

    case Acao.FOCO_PERDIDO:
      return desarmar(estado, acao.motivo ?? 'a página perdeu o foco');

    case Acao.PACOTE_ENVIADO:
      if (acao.comando === Tipo.DESCONECTAR && estado.paradaRestante > 0) {
        return Object.freeze({ ...estado, paradaRestante: estado.paradaRestante - 1 });
      }
      if (acao.comando === Tipo.CONECTAR && estado.armado && estado.inicioRestante > 0) {
        return Object.freeze({ ...estado, inicioRestante: estado.inicioRestante - 1 });
      }
      return estado;

    case Acao.CONFIG_ALTERADA:
      // Inverter um eixo com o protótipo armado causaria um salto.
      if (estado.armado) {
        return Object.freeze({ ...estado, aviso: 'Desarme antes de alterar os ajustes.' });
      }
      return Object.freeze({ ...estado, config: normalizarConfig(acao.config) });

    case Acao.AVISO:
      return Object.freeze({ ...estado, aviso: acao.texto ?? null });

    default:
      return estado;
  }
}

/**
 * O que deve ser transmitido AGORA. Único ponto de saída dos valores:
 * se não está armado, sai 0xFF (desconectar), não importa o que o joystick
 * diga.
 *
 * @param {Estado} estado
 * @return {import('./protocolo.js').Comando}
 */
export function comandoDeSaida(estado) {
  if (!estado.armado || estado.paradaRestante > 0) {
    return { tipo: Tipo.DESCONECTAR, pitch: 0, roll: 0 };
  }
  if (estado.inicioRestante > 0) {
    return { tipo: Tipo.CONECTAR, pitch: 0, roll: 0 };
  }
  const c = estado.config;
  return {
    tipo: Tipo.POSICAO,
    pitch: estado.eixos.pitch * (c.inverterPitch ? -1 : 1),
    roll: estado.eixos.roll * (c.inverterRoll ? -1 : 1),
  };
}
