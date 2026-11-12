/**
 * @fileoverview Estado do controle e regras de segurança.
 *
 * Módulo puro: `reduzir(estado, acao)` devolve um novo estado e nunca altera
 * o anterior. Toda regra de segurança da página mora aqui, e
 * `comandoDeSaida` é o ÚNICO lugar que decide o que vai para o rádio.
 */

import { CONFIG_PADRAO, normalizarConfig } from './config.js';

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
  TELEMETRIA_RECEBIDA: 'telemetria-recebida',
  AVISO: 'aviso',
});

/** Quantos pacotes seguidos levam a flag de parada depois de um PARAR. */
export const PACOTES_DE_PARADA = 10;

/**
 * Posição dos controles, normalizada.
 * @typedef {Object} Eixos
 * @property {number} roll     -1 a 1 (direita positivo)
 * @property {number} pitch    -1 a 1 (para a frente positivo)
 * @property {number} yaw      -1 a 1 (direita positivo)
 * @property {number} throttle 0 a 1
 */

/** @type {Readonly<Eixos>} */
export const EIXOS_ZERADOS = Object.freeze({ roll: 0, pitch: 0, yaw: 0, throttle: 0 });

/**
 * @typedef {Object} Estado
 * @property {string} conexao             um valor de Conexao
 * @property {boolean} armado
 * @property {Readonly<Eixos>} eixos
 * @property {number} paradaRestante      pacotes de parada ainda a enviar
 * @property {number} geracaoDeControles  muda quando a UI deve soltar os controles
 * @property {?string} motivoDesarme      por que desarmou da última vez
 * @property {?string} aviso              mensagem para o usuário
 * @property {?Object} telemetria         última telemetria recebida
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
    geracaoDeControles: 0,
    motivoDesarme: null,
    aviso: null,
    telemetria: null,
    config,
  });
}

function limitar(valor, minimo, maximo) {
  if (!Number.isFinite(valor)) return 0;
  return Math.min(maximo, Math.max(minimo, valor));
}

/** @param {Eixos} eixos @return {boolean} */
export function eixosZerados(eixos) {
  return eixos.roll === 0 && eixos.pitch === 0 && eixos.yaw === 0 &&
      eixos.throttle === 0;
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
    return { ok: false, motivo: 'Solte todos os controles antes de armar.' };
  }
  return { ok: true, motivo: null };
}

/** Desarma, zera os eixos e manda a UI soltar os controles. */
function zerar(estado, extras) {
  return Object.freeze({
    ...estado,
    armado: false,
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
      return Object.freeze({ ...base, conexao: acao.conexao, telemetria: null });
    }

    case Acao.EIXOS_ALTERADOS: {
      const e = { ...estado.eixos, ...acao.eixos };
      const eixos = Object.freeze({
        roll: limitar(e.roll, -1, 1),
        pitch: limitar(e.pitch, -1, 1),
        yaw: limitar(e.yaw, -1, 1),
        throttle: limitar(e.throttle, 0, 1),
      });
      return Object.freeze({ ...estado, eixos });
    }

    case Acao.ARMAR: {
      const { ok, motivo } = podeArmar(estado);
      if (!ok) return Object.freeze({ ...estado, aviso: motivo });
      return Object.freeze({ ...estado, armado: true, aviso: null });
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
      if (!acao.parada || estado.paradaRestante === 0) return estado;
      return Object.freeze({ ...estado, paradaRestante: estado.paradaRestante - 1 });

    case Acao.CONFIG_ALTERADA:
      // Mudar limites com o protótipo armado causaria um salto de setpoint.
      if (estado.armado) {
        return Object.freeze({ ...estado, aviso: 'Desarme antes de alterar os ajustes.' });
      }
      return Object.freeze({ ...estado, config: normalizarConfig(acao.config) });

    case Acao.TELEMETRIA_RECEBIDA: {
      const t = acao.telemetria;
      const comTelemetria = Object.freeze({ ...estado, telemetria: t });
      // Se o firmware diz que travou, a página não pode continuar "armada".
      if (estado.armado && (t.failsafe || t.paradaTravada)) {
        return desarmar(comTelemetria, t.failsafe ?
            'o firmware entrou em failsafe' : 'o firmware travou em parada');
      }
      return comTelemetria;
    }

    case Acao.AVISO:
      return Object.freeze({ ...estado, aviso: acao.texto ?? null });

    default:
      return estado;
  }
}

/**
 * O que deve ser transmitido AGORA. Único ponto de saída dos valores:
 * se não está armado, tudo sai zerado, não importa o que os controles digam.
 *
 * @param {Estado} estado
 * @return {import('./protocolo.js').Comando}
 */
export function comandoDeSaida(estado) {
  const c = estado.config;
  const yawTaxa = c.yawModo === 'taxa';
  const parada = estado.paradaRestante > 0;
  if (!estado.armado || parada) {
    return { armado: false, parada, yawTaxa, roll: 0, pitch: 0, yaw: 0, throttle: 0 };
  }
  const sinal = (inverter) => (inverter ? -1 : 1);
  const yawMax = yawTaxa ? c.yawTaxaMaxGps : c.anguloMaxGraus;
  return {
    armado: true,
    parada: false,
    yawTaxa,
    roll: estado.eixos.roll * c.anguloMaxGraus * sinal(c.inverterRoll),
    pitch: estado.eixos.pitch * c.anguloMaxGraus * sinal(c.inverterPitch),
    yaw: estado.eixos.yaw * yawMax * sinal(c.inverterYaw),
    throttle: estado.eixos.throttle * (c.tetoThrottlePct / 100),
  };
}
