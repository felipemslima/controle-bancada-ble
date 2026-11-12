import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  FLAG_ARMADO, FLAG_PARADA, FLAG_YAW_TAXA, TAMANHO_PACOTE, TIPO_COMANDO,
  codificarComando, codificarPacote, crc16, criarDecodificadorDeFluxo,
  decodificarPacote, paraHex,
} from '../src/dominio/protocolo.js';

const comandoBase = {
  armado: true, parada: false, yawTaxa: true,
  roll: -5, pitch: 15, yaw: 30, throttle: 0.25,
};

test('CRC-16/CCITT-FALSE confere com o vetor padrão', () => {
  const bytes = [...'123456789'].map((c) => c.charCodeAt(0));
  assert.equal(crc16(bytes), 0x29b1);
});

test('vetor de referência (o mesmo do PROTOCOLO.md e do teste em C)', () => {
  const pacote = codificarComando(comandoBase, 42);
  assert.equal(pacote.length, TAMANHO_PACOTE);
  assert.equal(paraHex(pacote), 'A5 5A 01 2A 05 0C FE DC 05 B8 0B FA 00 08 2E');
});

test('codificar e decodificar devolvem os mesmos campos', () => {
  const lido = decodificarPacote(codificarComando(comandoBase, 200));
  assert.deepEqual(lido, {
    tipo: TIPO_COMANDO, seq: 200, flags: FLAG_ARMADO | FLAG_YAW_TAXA,
    roll: -500, pitch: 1500, yaw: 3000, throttle: 250,
  });
});

test('comando desarmado sai zerado mesmo com valores na entrada', () => {
  const lido = decodificarPacote(codificarComando({ ...comandoBase, armado: false }, 1));
  assert.equal(lido.flags & FLAG_ARMADO, 0);
  assert.deepEqual([lido.roll, lido.pitch, lido.yaw, lido.throttle], [0, 0, 0, 0]);
});

test('comando de parada sai zerado e nunca armado', () => {
  const lido = decodificarPacote(codificarComando({ ...comandoBase, parada: true }, 1));
  assert.equal(lido.flags & FLAG_PARADA, FLAG_PARADA);
  assert.equal(lido.flags & FLAG_ARMADO, 0);
  assert.deepEqual([lido.roll, lido.pitch, lido.yaw, lido.throttle], [0, 0, 0, 0]);
});

test('"armado" só vale com o booleano true', () => {
  const lido = decodificarPacote(codificarComando({ ...comandoBase, armado: 1 }, 1));
  assert.equal(lido.flags & FLAG_ARMADO, 0);
  assert.equal(lido.roll, 0);
});

test('valores fora da faixa ou inválidos são saturados ou zerados', () => {
  const lido = decodificarPacote(codificarComando(
      { ...comandoBase, roll: 1e6, pitch: -1e6, yaw: NaN, throttle: 7 }, 1));
  assert.deepEqual([lido.roll, lido.pitch, lido.yaw, lido.throttle],
      [18000, -18000, 0, 1000]);
});

test('pacote com um bit trocado é recusado', () => {
  const pacote = codificarComando(comandoBase, 5);
  for (let i = 2; i < TAMANHO_PACOTE; i++) {
    const corrompido = Uint8Array.from(pacote);
    corrompido[i] ^= 0x04;
    assert.equal(decodificarPacote(corrompido), null, `byte ${i}`);
  }
});

test('fluxo: pacotes partidos em pedaços de qualquer tamanho', () => {
  const pacotes = [1, 2, 3].map((seq) => codificarComando(comandoBase, seq));
  const fluxo = pacotes.flatMap((p) => [...p]);
  for (const tamanho of [1, 2, 7, 15, 20, 45]) {
    const decodificador = criarDecodificadorDeFluxo();
    const lidos = [];
    for (let i = 0; i < fluxo.length; i += tamanho) {
      lidos.push(...decodificador.alimentar(fluxo.slice(i, i + tamanho)));
    }
    assert.deepEqual(lidos.map((p) => p.seq), [1, 2, 3], `pedaços de ${tamanho}`);
  }
});

test('fluxo: ressincroniza após lixo, truncamento e corrupção', () => {
  const a = [...codificarComando(comandoBase, 1)];
  const b = [...codificarComando(comandoBase, 2)];
  const c = [...codificarComando(comandoBase, 3)];
  const corrompido = [...a];
  corrompido[6] ^= 0x10;
  const fluxo = [
    0x00, 0xa5, 0x5a, 0xa5, 0xff, // lixo com falso cabeçalho
    ...a,
    ...b.slice(0, 9),             // truncado: bytes perdidos
    ...corrompido,                // CRC não confere
    ...b,
    0xa5,                         // meio cabeçalho solto
    ...c,
  ];
  const decodificador = criarDecodificadorDeFluxo();
  const lidos = decodificador.alimentar(fluxo);
  assert.deepEqual(lidos.map((p) => p.seq), [1, 2, 3]);
  assert.ok(decodificador.estatisticas.errosCrc >= 1);
});

test('fluxo: cabeçalho dentro dos dados não quebra o sincronismo', () => {
  // roll = 0x5AA5 põe "A5 5A" no meio do pacote.
  const pacote = codificarPacote({
    tipo: TIPO_COMANDO, seq: 9, flags: FLAG_ARMADO,
    roll: 0x5aa5, pitch: 0x5aa5, yaw: 0, throttle: 0,
  });
  const decodificador = criarDecodificadorDeFluxo();
  const lidos = decodificador.alimentar([...pacote, ...pacote]);
  assert.equal(lidos.length, 2);
  assert.equal(lidos[1].roll, 0x5aa5);
});
