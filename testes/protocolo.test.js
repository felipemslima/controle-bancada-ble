import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BYTE_CONECTAR, BYTE_DESCONECTAR, BYTE_PARADO, Tipo, codificarComando,
  codificarPosicao, decodificarByte, nivelDoEixo, paraHex,
} from '../src/dominio/protocolo.js';

const posicao = (pitch, roll) => codificarComando({ tipo: Tipo.POSICAO, pitch, roll })[0];

test('bytes especiais e centro', () => {
  assert.equal(BYTE_CONECTAR, 0xf0);
  assert.equal(BYTE_DESCONECTAR, 0xff);
  assert.equal(BYTE_PARADO, 0x77);
  assert.equal(codificarComando({ tipo: Tipo.CONECTAR })[0], 0xf0);
  assert.equal(codificarComando({ tipo: Tipo.DESCONECTAR })[0], 0xff);
});

test('cada comando é exatamente um byte', () => {
  for (const tipo of Object.values(Tipo)) {
    assert.equal(codificarComando({ tipo, pitch: 0, roll: 0 }).length, 1);
  }
});

test('tipo desconhecido vira o byte seguro (0xFF)', () => {
  assert.equal(codificarComando({ tipo: 'outro', pitch: 1, roll: 1 })[0], 0xff);
  assert.equal(codificarComando({ tipo: Tipo.RESERVADO })[0], 0xff);
});

test('exemplos do PROTOCOLO.md', () => {
  assert.equal(posicao(0, 0), 0x77);
  assert.equal(posicao(1, 0), 0xe7);
  assert.equal(posicao(-1, 0), 0x07);
  assert.equal(posicao(0, 1), 0x7e);
  assert.equal(posicao(0, -1), 0x70);
  assert.equal(codificarPosicao(3, -3), 0xa4);
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

test('as 225 posições: ida e volta, e nenhuma colide com especial ou reservado', () => {
  const vistos = new Set();
  for (let p = -7; p <= 7; p++) {
    for (let r = -7; r <= 7; r++) {
      const byte = codificarPosicao(p, r);
      assert.notEqual(byte, BYTE_CONECTAR);
      assert.notEqual(byte, BYTE_DESCONECTAR);
      assert.notEqual(byte >> 4, 0xf);
      assert.notEqual(byte & 0xf, 0xf);
      assert.deepEqual(decodificarByte(byte), { tipo: Tipo.POSICAO, pitch: p, roll: r });
      vistos.add(byte);
    }
  }
  assert.equal(vistos.size, 225);
});

test('decodificar os 256 bytes: 225 posições, 2 especiais, 29 reservados', () => {
  const contagem = {};
  for (let b = 0; b < 256; b++) {
    const { tipo } = decodificarByte(b);
    contagem[tipo] = (contagem[tipo] ?? 0) + 1;
  }
  assert.deepEqual(contagem, { posicao: 225, conectar: 1, desconectar: 1, reservado: 29 });
});

test('valores fora da faixa ou inválidos ficam dentro dos 15 níveis', () => {
  assert.equal(posicao(10, -10), 0xe0);
  assert.equal(posicao(NaN, Infinity), 0x77);
  assert.equal(codificarPosicao(100, -100), 0xe0);
});

test('paraHex', () => {
  assert.equal(paraHex(Uint8Array.of(0x77, 0xf0, 0x0a)), '77 F0 0A');
});
