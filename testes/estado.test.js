import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CONFIG_PADRAO, normalizarConfig, normalizarUuid } from '../src/dominio/config.js';
import {
  Acao, Conexao, PACOTES_DE_PARADA, comandoDeSaida, estadoInicial, podeArmar,
  reduzir,
} from '../src/dominio/estado.js';

/** Aplica uma lista de ações em sequência. */
function aplicar(estado, ...acoes) {
  return acoes.reduce(reduzir, estado);
}

const conectar = { tipo: Acao.CONEXAO_ALTERADA, conexao: Conexao.CONECTADO };
const cair = { tipo: Acao.CONEXAO_ALTERADA, conexao: Conexao.DESCONECTADO };
const armar = { tipo: Acao.ARMAR };
const mover = (eixos) => ({ tipo: Acao.EIXOS_ALTERADOS, eixos });

function armado() {
  return aplicar(estadoInicial(), conectar, armar);
}

test('começa desconectado, desarmado e zerado', () => {
  const e = estadoInicial();
  assert.equal(e.conexao, Conexao.DESCONECTADO);
  assert.equal(e.armado, false);
  assert.deepEqual(comandoDeSaida(e),
      { armado: false, parada: false, yawTaxa: true, roll: 0, pitch: 0, yaw: 0, throttle: 0 });
});

test('não arma desconectado', () => {
  const e = reduzir(estadoInicial(), armar);
  assert.equal(e.armado, false);
  assert.match(e.aviso, /Conecte/);
});

test('não arma com algum controle fora do zero', () => {
  for (const eixos of [{ roll: 0.1 }, { pitch: -0.1 }, { yaw: 0.01 }, { throttle: 0.2 }]) {
    const e = aplicar(estadoInicial(), conectar, mover(eixos), armar);
    assert.equal(e.armado, false, JSON.stringify(eixos));
    assert.match(e.aviso, /Solte/);
  }
});

test('arma conectado e com tudo zerado', () => {
  assert.equal(armado().armado, true);
});

test('desarmado: mexer nos controles não produz saída', () => {
  const e = aplicar(estadoInicial(), conectar, mover({ roll: 1, pitch: 1, yaw: 1, throttle: 1 }));
  const c = comandoDeSaida(e);
  assert.equal(c.armado, false);
  assert.deepEqual([c.roll, c.pitch, c.yaw, c.throttle], [0, 0, 0, 0]);
});

test('armado: a saída é escalada pelos limites da configuração', () => {
  const e = aplicar(armado(), mover({ roll: -1, pitch: 0.5, yaw: 1, throttle: 1 }));
  const c = comandoDeSaida(e);
  assert.equal(c.armado, true);
  assert.equal(c.roll, -15);
  assert.equal(c.pitch, 7.5);
  assert.equal(c.yaw, 45);
  assert.equal(c.yawTaxa, true);
  assert.ok(Math.abs(c.throttle - 0.30) < 1e-9);
});

test('yaw em modo ângulo usa o ângulo máximo e avisa pela flag', () => {
  const config = normalizarConfig({ yawModo: 'angulo', inverterPitch: true });
  const e = aplicar(estadoInicial(config), conectar, armar, mover({ yaw: 1, pitch: 1 }));
  const c = comandoDeSaida(e);
  assert.equal(c.yawTaxa, false);
  assert.equal(c.yaw, 15);
  assert.equal(c.pitch, -15);
});

test('eixos são limitados e valores inválidos viram zero', () => {
  const e = reduzir(estadoInicial(), mover({ roll: 5, pitch: -5, yaw: NaN, throttle: -1 }));
  assert.deepEqual(e.eixos, { roll: 1, pitch: -1, yaw: 0, throttle: 0 });
});

test('PARAR zera, desarma e marca os pacotes de parada', () => {
  const e = aplicar(armado(), mover({ pitch: 1, throttle: 1 }), { tipo: Acao.PARAR });
  assert.equal(e.armado, false);
  assert.deepEqual(e.eixos, { roll: 0, pitch: 0, yaw: 0, throttle: 0 });
  assert.equal(e.paradaRestante, PACOTES_DE_PARADA);
  const c = comandoDeSaida(e);
  assert.equal(c.parada, true);
  assert.equal(c.armado, false);
});

test('não rearma enquanto a parada não terminou de ser enviada', () => {
  let e = aplicar(armado(), { tipo: Acao.PARAR }, armar);
  assert.equal(e.armado, false);
  for (let i = 0; i < PACOTES_DE_PARADA; i++) {
    e = reduzir(e, { tipo: Acao.PACOTE_ENVIADO, parada: true });
  }
  assert.equal(e.paradaRestante, 0);
  assert.equal(reduzir(e, armar).armado, true);
});

test('PARAR funciona mesmo desconectado', () => {
  const e = reduzir(estadoInicial(), { tipo: Acao.PARAR });
  assert.equal(e.paradaRestante, PACOTES_DE_PARADA);
  assert.equal(e.armado, false);
});

test('queda da conexão desarma e zera; reconectar não rearma', () => {
  let e = aplicar(armado(), mover({ pitch: 1, throttle: 0.5 }), cair);
  assert.equal(e.armado, false);
  assert.deepEqual(e.eixos, { roll: 0, pitch: 0, yaw: 0, throttle: 0 });
  assert.match(e.motivoDesarme, /conexão/);
  e = reduzir(e, conectar);
  assert.equal(e.armado, false);
});

test('"conectando" também desarma', () => {
  const e = reduzir(armado(), { tipo: Acao.CONEXAO_ALTERADA, conexao: Conexao.CONECTANDO });
  assert.equal(e.armado, false);
});

test('perda de foco desarma, zera e manda soltar os controles', () => {
  const antes = aplicar(armado(), mover({ yaw: 0.7 }));
  const e = reduzir(antes, { tipo: Acao.FOCO_PERDIDO, motivo: 'a página ficou oculta' });
  assert.equal(e.armado, false);
  assert.deepEqual(e.eixos, { roll: 0, pitch: 0, yaw: 0, throttle: 0 });
  assert.ok(e.geracaoDeControles > antes.geracaoDeControles);
  assert.match(e.motivoDesarme, /oculta/);
});

test('desarmar pelo usuário zera os controles', () => {
  const e = aplicar(armado(), mover({ throttle: 1 }), { tipo: Acao.DESARMAR });
  assert.equal(e.armado, false);
  assert.equal(e.eixos.throttle, 0);
});

test('ajustes não mudam enquanto armado', () => {
  const e = reduzir(armado(), { tipo: Acao.CONFIG_ALTERADA, config: { anguloMaxGraus: 30 } });
  assert.equal(e.config.anguloMaxGraus, 15);
  assert.match(e.aviso, /Desarme/);
});

test('ajustes são validados ao entrar no estado', () => {
  const e = reduzir(estadoInicial(),
      { tipo: Acao.CONFIG_ALTERADA, config: { anguloMaxGraus: 500, taxaHz: 'x' } });
  assert.equal(e.config.anguloMaxGraus, 30);
  assert.equal(e.config.taxaHz, 30);
});

test('telemetria de failsafe ou trava desarma a página', () => {
  const base = { roll: 0, pitch: 0, yaw: 0, throttle: 0, armado: false, yawTaxa: true, instante: 0 };
  for (const extra of [{ failsafe: true, paradaTravada: true }, { failsafe: false, paradaTravada: true }]) {
    const e = reduzir(armado(), { tipo: Acao.TELEMETRIA_RECEBIDA, telemetria: { ...base, ...extra } });
    assert.equal(e.armado, false);
  }
  const normal = reduzir(armado(), {
    tipo: Acao.TELEMETRIA_RECEBIDA,
    telemetria: { ...base, armado: true, failsafe: false, paradaTravada: false },
  });
  assert.equal(normal.armado, true);
});

test('podeArmar explica o motivo', () => {
  assert.equal(podeArmar(aplicar(estadoInicial(), conectar)).ok, true);
  assert.equal(podeArmar(armado()).ok, false);
});

test('o estado é imutável', () => {
  const e = armado();
  assert.throws(() => {
    e.armado = false;
  }, TypeError);
});

test('normalizarUuid aceita 16 e 128 bits', () => {
  assert.equal(normalizarUuid('FFE0'), 0xffe0);
  assert.equal(normalizarUuid(' 0xffe1 '), 0xffe1);
  assert.equal(normalizarUuid('6E400001-B5A3-F393-E0A9-E50E24DCCA9E'),
      '6e400001-b5a3-f393-e0a9-e50e24dcca9e');
  assert.equal(normalizarUuid('xyz'), null);
  assert.equal(normalizarUuid(''), null);
});

test('normalizarConfig devolve o padrão para entradas ruins', () => {
  assert.deepEqual(normalizarConfig(null), CONFIG_PADRAO);
  assert.deepEqual(normalizarConfig({ uuidServico: 'zz', yawModo: 'outro', tetoThrottlePct: -5 }),
      { ...CONFIG_PADRAO, tetoThrottlePct: 0 });
});
