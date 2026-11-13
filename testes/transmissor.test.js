import assert from 'node:assert/strict';
import { test } from 'node:test';

import { criarLoja } from '../src/aplicacao/loja.js';
import { LIMITE_ESCRITA_MS, criarTransmissor } from '../src/aplicacao/transmissor.js';
import {
  Acao, Conexao, PACOTES_DE_INICIO, PACOTES_DE_PARADA, estadoInicial, reduzir,
} from '../src/dominio/estado.js';
import { Tipo, decodificarByte } from '../src/dominio/protocolo.js';
import { assentar } from './apoio/mock-bluetooth.js';

/**
 * Enlace falso em que o teste decide quando cada escrita termina.
 * `liberar()` conclui a escrita pendente mais antiga.
 */
function criarEnlaceFalso({ automatico = true } = {}) {
  const enlace = {
    suportado: true,
    bytes: [],
    pendentes: [],
    desconexoes: 0,
    falhar: false,
    automatico,
    escrever(dados) {
      assert.equal(dados.length, 1, 'cada escrita leva um byte');
      enlace.bytes.push(dados[0]);
      if (enlace.falhar) return Promise.reject(new Error('falha de escrita'));
      if (enlace.automatico) return Promise.resolve();
      return new Promise((resolver) => enlace.pendentes.push(resolver));
    },
    liberar() {
      enlace.pendentes.shift()?.();
    },
    async desconectar() {
      enlace.desconexoes++;
    },
    async conectar() {},
    async reconectar() {},
    aoReceber() {},
    aoDesconectar() {},
    /** As mensagens como o firmware as leria. */
    get mensagens() {
      return enlace.bytes.map((b) => decodificarByte(b));
    },
  };
  return enlace;
}

function montar(opcoesDoEnlace) {
  const loja = criarLoja(reduzir, estadoInicial());
  const enlace = criarEnlaceFalso(opcoesDoEnlace);
  const relogio = { ms: 0 };
  const transmissor = criarTransmissor({ loja, enlace, agora: () => relogio.ms });
  const despachar = (tipo, extras) => loja.despachar({ tipo, ...extras });
  const conectar = () => despachar(Acao.CONEXAO_ALTERADA, { conexao: Conexao.CONECTADO });
  const mover = (eixos) => despachar(Acao.EIXOS_ALTERADOS, { eixos });
  async function ticks(n) {
    for (let i = 0; i < n; i++) {
      transmissor.tick();
      await assentar();
    }
  }
  return { loja, enlace, relogio, transmissor, despachar, conectar, mover, ticks };
}

test('não envia nada enquanto desconectado', async () => {
  const { enlace, ticks } = montar();
  await ticks(3);
  assert.equal(enlace.bytes.length, 0);
});

test('heartbeat desarmado: 0x00 a cada tick, mesmo sem mudança', async () => {
  const { enlace, conectar, ticks } = montar();
  conectar();
  await ticks(5);
  assert.deepEqual(enlace.bytes, [0x00, 0x00, 0x00, 0x00, 0x00]);
});

test('desarmado: joystick mexido nunca vira posição', async () => {
  const { enlace, conectar, mover, ticks } = montar();
  conectar();
  mover({ roll: 1, pitch: 1 });
  await ticks(3);
  assert.ok(enlace.bytes.every((b) => b === 0x00));
});

test('ao armar: 0xFF repetido e depois a posição atual', async () => {
  const { enlace, conectar, mover, despachar, ticks } = montar();
  conectar();
  despachar(Acao.ARMAR);
  mover({ pitch: 1, roll: -3 / 7 });
  await ticks(PACOTES_DE_INICIO + 2);
  assert.deepEqual(enlace.bytes,
      [...Array(PACOTES_DE_INICIO).fill(0xff), 0xf5, 0xf5]);
  assert.deepEqual(enlace.mensagens.at(-1), { tipo: Tipo.POSICAO, pitch: 7, roll: -3 });
});

test('sem sobreposição: tick com escrita pendente é descartado', async () => {
  const { transmissor, enlace, conectar } = montar({ automatico: false });
  conectar();
  transmissor.tick();
  transmissor.tick();
  transmissor.tick();
  await assentar();
  assert.equal(enlace.bytes.length, 1);
  assert.equal(transmissor.diagnostico().descartados, 2);
  enlace.liberar();
  await assentar();
  transmissor.tick();
  await assentar();
  assert.equal(enlace.bytes.length, 2);
});

test('PARAR durante uma escrita pendente: o próximo byte é 0x00', async () => {
  const { transmissor, enlace, conectar, mover, despachar, ticks } = montar();
  conectar();
  despachar(Acao.ARMAR);
  await ticks(PACOTES_DE_INICIO);
  mover({ pitch: 1 });
  enlace.automatico = false;
  transmissor.tick(); // posição fica pendente no enlace
  await assentar();
  assert.equal(enlace.bytes.at(-1), 0xf8);

  despachar(Acao.PARAR);
  await assentar();
  assert.equal(enlace.bytes.at(-1), 0xf8, 'não escreve por cima da pendente');

  enlace.liberar(); // a pendente termina: o 0x00 sai sem esperar o tick
  await assentar();
  assert.equal(enlace.bytes.at(-1), 0x00);

  const indiceParada = enlace.bytes.length - 1;
  enlace.automatico = true;
  enlace.liberar();
  await ticks(20);
  assert.ok(enlace.bytes.slice(indiceParada).every((b) => b === 0x00),
      'nenhuma posição sai depois da parada');
});

test('PARAR sem escrita pendente sai imediatamente, sem esperar o tick', async () => {
  const { enlace, conectar, mover, despachar, ticks } = montar();
  conectar();
  despachar(Acao.ARMAR);
  await ticks(PACOTES_DE_INICIO + 1);
  mover({ roll: 1 });
  const antes = enlace.bytes.length;
  despachar(Acao.PARAR);
  await assentar();
  assert.equal(enlace.bytes.length, antes + 1);
  assert.equal(enlace.bytes.at(-1), 0x00);
});

test('depois de PARAR: N bytes 0x00 antes de poder rearmar', async () => {
  const { enlace, conectar, despachar, loja, ticks } = montar();
  conectar();
  despachar(Acao.ARMAR);
  despachar(Acao.PARAR);
  await assentar();
  await ticks(PACOTES_DE_PARADA);
  assert.equal(loja.estado().paradaRestante, 0);
  assert.ok(enlace.bytes.every((b) => b === 0x00));
  despachar(Acao.ARMAR);
  assert.equal(loja.estado().armado, true);
});

test('perder o foco envia 0x00 na hora', async () => {
  const { enlace, conectar, mover, despachar, ticks } = montar();
  conectar();
  despachar(Acao.ARMAR);
  await ticks(PACOTES_DE_INICIO);
  mover({ pitch: -1 });
  await ticks(1);
  assert.equal(enlace.bytes.at(-1), 0x18);
  despachar(Acao.FOCO_PERDIDO);
  await assentar();
  assert.equal(enlace.bytes.at(-1), 0x00);
});

test('erro de escrita não trava o laço e é contado', async () => {
  const { transmissor, enlace, conectar } = montar();
  conectar();
  enlace.falhar = true;
  transmissor.tick();
  await assentar();
  enlace.falhar = false;
  transmissor.tick();
  await assentar();
  const d = transmissor.diagnostico();
  assert.equal(d.erros, 1);
  assert.equal(d.enviados, 1);
});

test('escrita travada derruba o enlace', async () => {
  const { transmissor, enlace, conectar, relogio } = montar({ automatico: false });
  conectar();
  transmissor.tick();
  await assentar();
  relogio.ms = LIMITE_ESCRITA_MS;
  transmissor.tick();
  assert.equal(enlace.desconexoes, 0);
  relogio.ms = LIMITE_ESCRITA_MS + 1;
  transmissor.tick();
  assert.equal(enlace.desconexoes, 1);
});

test('diagnóstico: taxa efetiva e último byte', async () => {
  const { transmissor, conectar, relogio } = montar();
  conectar();
  for (let i = 0; i < 30; i++) {
    relogio.ms = i * 33;
    transmissor.tick();
    await assentar();
  }
  let d = transmissor.diagnostico();
  assert.equal(d.taxaHz, 30);
  assert.deepEqual([...d.ultimoPacote], [0x00]);
  relogio.ms = 5000;
  d = transmissor.diagnostico();
  assert.equal(d.taxaHz, 0);
});
