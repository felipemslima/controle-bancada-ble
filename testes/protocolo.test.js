import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BYTE_CONECTAR, BYTE_DESCONECTAR, BYTE_PARADO, Tipo, codificarComando,
  codificarPosicao, decodificarByte, nivelDoEixo, paraHex,
} from '../src/dominio/protocolo.js';

const posicao = (pitch, roll) => codificarComando({ tipo: Tipo.POSICAO, pitch, roll })[0];

test('bytes especiais e centro', () => {
  assert.equal(BYTE_CONECTAR, 0xff);
  assert.equal(BYTE_DESCONECTAR, 0x00);
  assert.equal(BYTE_PARADO, 0x88);
  assert.equal(codificarComando({ tipo: Tipo.CONECTAR })[0], 0xff);
  assert.equal(codificarComando({ tipo: Tipo.DESCONECTAR })[0], 0x00);
});

test('cada comando é exatamente um byte', () => {
  for (const tipo of Object.values(Tipo)) {
    assert.equal(codificarComando({ tipo, pitch: 0, roll: 0 }).length, 1);
  }
});

test('tipo desconhecido vira o byte seguro (0x00, desconectar)', () => {
  assert.equal(codificarComando({ tipo: 'outro', pitch: 1, roll: 1 })[0], 0x00);
});

test('exemplos do PROTOCOLO.md', () => {
  assert.equal(posicao(0, 0), 0x88);
  assert.equal(posicao(1, 0), 0xf8);
  assert.equal(posicao(-1, 0), 0x18);
  assert.equal(posicao(0, 1), 0x8f);
  assert.equal(posicao(0, -1), 0x81);
  assert.equal(codificarPosicao(3, -3), 0xb5);
});

test('o canto (+7, +7) daria 0xFF (conectar) e vira 0xEE', () => {
  assert.equal(codificarPosicao(7, 7), 0xee);
  assert.equal(posicao(1, 1), 0xee);
  assert.equal(codificarPosicao(100, 100), 0xee);
});

test('quantização: 7 níveis de cada lado, saturada, sem -0', () => {
  assert.equal(nivelDoEixo(0), 0);
  assert.equal(nivelDoEixo(1), 7);
  assert.equal(nivelDoEixo(-1), -7);
  assert.equal(nivelDoEixo(0.5), 4);
  assert.equal(nivelDoEixo(0.05), 0);
  assert.equal(nivelDoEixo(5), 7);
  assert.equal(nivelDoEixo(NaN), 0);
  assert.ok(Object.is(nivelDoEixo(-0.01), 0), 'não pode ser -0');
});

test('as 225 posições da página: nunca 0x00 nem 0xFF, e ida e volta exatas', () => {
  const vistos = new Set();
  for (let p = -7; p <= 7; p++) {
    for (let r = -7; r <= 7; r++) {
      const byte = codificarPosicao(p, r);
      assert.notEqual(byte, BYTE_CONECTAR);
      assert.notEqual(byte, BYTE_DESCONECTAR);
      const lido = decodificarByte(byte);
      assert.equal(lido.tipo, Tipo.POSICAO);
      if (p === 7 && r === 7) continue; // recua para (+6, +6), ver teste acima
      assert.deepEqual(lido, { tipo: Tipo.POSICAO, pitch: p, roll: r });
      vistos.add(byte);
    }
  }
  assert.equal(vistos.size, 224);
});

test('decodificar os 256 bytes: 254 posições e 2 especiais', () => {
  const contagem = {};
  for (let b = 0; b < 256; b++) {
    const { tipo } = decodificarByte(b);
    contagem[tipo] = (contagem[tipo] ?? 0) + 1;
  }
  assert.deepEqual(contagem, { desconectar: 1, posicao: 254, conectar: 1 });
});

test('o firmware aceita o nível -8 (nibble 0), que a página não gera', () => {
  assert.deepEqual(decodificarByte(0x01), { tipo: Tipo.POSICAO, pitch: -8, roll: -7 });
  assert.deepEqual(decodificarByte(0xfe), { tipo: Tipo.POSICAO, pitch: 7, roll: 6 });
});

test('valores inválidos ficam no centro', () => {
  assert.equal(posicao(NaN, Infinity), 0x88);
});

test('paraHex', () => {
  assert.equal(paraHex(Uint8Array.of(0x88, 0xff, 0x0a)), '88 FF 0A');
});
