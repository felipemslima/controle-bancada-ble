import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CONFIG_PADRAO, normalizarConfig, normalizarUuid } from '../src/dominio/config.js';
import {
  Acao, Conexao, PACOTES_DE_INICIO, PACOTES_DE_PARADA, comandoDeSaida,
  estadoInicial, podeArmar, reduzir,
} from '../src/dominio/estado.js';
import { Tipo } from '../src/dominio/protocolo.js';

/** Aplica uma lista de ações em sequência. */
function aplicar(estado, ...acoes) {
  return acoes.reduce(reduzir, estado);
}

const conectar = { tipo: Acao.CONEXAO_ALTERADA, conexao: Conexao.CONECTADO };
const cair = { tipo: Acao.CONEXAO_ALTERADA, conexao: Conexao.DESCONECTADO };
const armar = { tipo: Acao.ARMAR };
const mover = (eixos) => ({ tipo: Acao.EIXOS_ALTERADOS, eixos });
const enviado = (comando) => ({ tipo: Acao.PACOTE_ENVIADO, comando });

/** Arma e já consome os 0xFF (conectar) iniciais. */
function armado() {
  let e = aplicar(estadoInicial(), conectar, armar);
  for (let i = 0; i < PACOTES_DE_INICIO; i++) e = reduzir(e, enviado(Tipo.CONECTAR));
  return e;
}

test('começa desconectado, desarmado e mandando parar', () => {
  const e = estadoInicial();
  assert.equal(e.conexao, Conexao.DESCONECTADO);
  assert.equal(e.armado, false);
  assert.deepEqual(comandoDeSaida(e), { tipo: Tipo.DESCONECTAR, pitch: 0, roll: 0 });
});

test('não arma desconectado', () => {
  const e = reduzir(estadoInicial(), armar);
  assert.equal(e.armado, false);
  assert.match(e.aviso, /Conecte/);
});

test('não arma com o joystick fora do centro', () => {
  for (const eixos of [{ roll: 0.1 }, { pitch: -0.1 }]) {
    const e = aplicar(estadoInicial(), conectar, mover(eixos), armar);
    assert.equal(e.armado, false, JSON.stringify(eixos));
    assert.match(e.aviso, /Solte/);
  }
});

test('ao armar: manda conectar N vezes e depois a posição', () => {
  let e = aplicar(estadoInicial(), conectar, armar, mover({ pitch: 1 }));
  for (let i = 0; i < PACOTES_DE_INICIO; i++) {
    assert.equal(comandoDeSaida(e).tipo, Tipo.CONECTAR, `envio ${i}`);
    e = reduzir(e, enviado(Tipo.CONECTAR));
  }
  assert.deepEqual(comandoDeSaida(e), { tipo: Tipo.POSICAO, pitch: 1, roll: 0 });
});

test('desarmado: mexer no joystick não produz posição', () => {
  const e = aplicar(estadoInicial(), conectar, mover({ roll: 1, pitch: 1 }));
  assert.equal(comandoDeSaida(e).tipo, Tipo.DESCONECTAR);
});

test('inversão de eixos', () => {
  const config = normalizarConfig({ inverterPitch: true });
  let e = aplicar(estadoInicial(config), conectar, armar);
  for (let i = 0; i < PACOTES_DE_INICIO; i++) e = reduzir(e, enviado(Tipo.CONECTAR));
  e = reduzir(e, mover({ pitch: 1, roll: 0.5 }));
  assert.deepEqual(comandoDeSaida(e), { tipo: Tipo.POSICAO, pitch: -1, roll: 0.5 });
});

test('eixos são limitados e valores inválidos viram zero', () => {
  const e = reduzir(estadoInicial(), mover({ roll: 5, pitch: NaN }));
  assert.deepEqual(e.eixos, { roll: 1, pitch: 0 });
});

test('PARAR zera, desarma e manda parar por N pacotes', () => {
  let e = aplicar(armado(), mover({ pitch: 1 }), { tipo: Acao.PARAR });
  assert.equal(e.armado, false);
  assert.deepEqual(e.eixos, { roll: 0, pitch: 0 });
  assert.equal(e.paradaRestante, PACOTES_DE_PARADA);
  assert.equal(comandoDeSaida(e).tipo, Tipo.DESCONECTAR);
  assert.equal(reduzir(e, armar).armado, false, 'não rearma durante a parada');
  for (let i = 0; i < PACOTES_DE_PARADA; i++) e = reduzir(e, enviado(Tipo.DESCONECTAR));
  assert.equal(e.paradaRestante, 0);
  assert.equal(reduzir(e, armar).armado, true);
});

test('PARAR durante os 0xFF (conectar) iniciais cancela o início', () => {
  const e = aplicar(estadoInicial(), conectar, armar, { tipo: Acao.PARAR });
  assert.equal(e.inicioRestante, 0);
  assert.equal(comandoDeSaida(e).tipo, Tipo.DESCONECTAR);
});

test('PARAR funciona mesmo desconectado', () => {
  const e = reduzir(estadoInicial(), { tipo: Acao.PARAR });
  assert.equal(e.paradaRestante, PACOTES_DE_PARADA);
  assert.equal(e.armado, false);
});

test('queda da conexão desarma e zera; reconectar não rearma', () => {
  let e = aplicar(armado(), mover({ pitch: 1 }), cair);
  assert.equal(e.armado, false);
  assert.deepEqual(e.eixos, { roll: 0, pitch: 0 });
  assert.match(e.motivoDesarme, /conexão/);
  e = reduzir(e, conectar);
  assert.equal(e.armado, false);
});

test('"conectando" também desarma', () => {
  const e = reduzir(armado(), { tipo: Acao.CONEXAO_ALTERADA, conexao: Conexao.CONECTANDO });
  assert.equal(e.armado, false);
});

test('perda de foco desarma, zera e manda soltar o joystick', () => {
  const antes = aplicar(armado(), mover({ roll: 0.7 }));
  const e = reduzir(antes, { tipo: Acao.FOCO_PERDIDO, motivo: 'a página ficou oculta' });
  assert.equal(e.armado, false);
  assert.deepEqual(e.eixos, { roll: 0, pitch: 0 });
  assert.ok(e.geracaoDeControles > antes.geracaoDeControles);
  assert.match(e.motivoDesarme, /oculta/);
});

test('ajustes não mudam enquanto armado', () => {
  const e = reduzir(armado(), { tipo: Acao.CONFIG_ALTERADA, config: { inverterRoll: true } });
  assert.equal(e.config.inverterRoll, false);
  assert.match(e.aviso, /Desarme/);
});

test('ajustes são validados; campos antigos são descartados', () => {
  const e = reduzir(estadoInicial(), {
    tipo: Acao.CONFIG_ALTERADA,
    config: { taxaHz: 500, anguloMaxGraus: 30, yawModo: 'taxa' },
  });
  assert.equal(e.config.taxaHz, 50);
  assert.deepEqual(Object.keys(e.config).sort(), Object.keys(CONFIG_PADRAO).sort());
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
});

test('normalizarConfig devolve o padrão para entradas ruins', () => {
  assert.deepEqual(normalizarConfig(null), CONFIG_PADRAO);
  assert.deepEqual(normalizarConfig({ uuidServico: 'zz', taxaHz: 'x' }), CONFIG_PADRAO);
});
