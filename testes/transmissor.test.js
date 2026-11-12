import assert from 'node:assert/strict';
import { test } from 'node:test';

import { criarLoja } from '../src/aplicacao/loja.js';
import { LIMITE_ESCRITA_MS, criarTransmissor } from '../src/aplicacao/transmissor.js';
import {
  Acao, Conexao, PACOTES_DE_PARADA, estadoInicial, reduzir,
} from '../src/dominio/estado.js';
import {
  FLAG_ARMADO, FLAG_PARADA, decodificarPacote,
} from '../src/dominio/protocolo.js';
import { assentar } from './apoio/mock-bluetooth.js';

/**
 * Enlace falso em que o teste decide quando cada escrita termina.
 * `liberar()` conclui a escrita pendente mais antiga.
 */
function criarEnlaceFalso({ automatico = true } = {}) {
  const enlace = {
    suportado: true,
    escritas: [],
    pendentes: [],
    desconexoes: 0,
    falhar: false,
    automatico,
    escrever(bytes) {
      enlace.escritas.push(decodificarPacote(bytes));
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
  return { loja, enlace, relogio, transmissor, despachar, conectar, mover };
}

const armado = (p) => (p.flags & FLAG_ARMADO) !== 0;
const parada = (p) => (p.flags & FLAG_PARADA) !== 0;
const zerado = (p) => p.roll === 0 && p.pitch === 0 && p.yaw === 0 && p.throttle === 0;

test('não envia nada enquanto desconectado', async () => {
  const { transmissor, enlace } = montar();
  transmissor.tick();
  await assentar();
  assert.equal(enlace.escritas.length, 0);
});

test('heartbeat: envia a cada tick mesmo sem mudança, com sequência crescente', async () => {
  const { transmissor, enlace, conectar } = montar();
  conectar();
  for (let i = 0; i < 5; i++) {
    transmissor.tick();
    await assentar();
  }
  assert.deepEqual(enlace.escritas.map((p) => p.seq), [0, 1, 2, 3, 4]);
  assert.ok(enlace.escritas.every((p) => !armado(p) && zerado(p)));
});

test('a sequência dá a volta de 255 para 0', async () => {
  const { transmissor, enlace, conectar } = montar();
  conectar();
  for (let i = 0; i < 258; i++) {
    transmissor.tick();
    await assentar();
  }
  assert.deepEqual(enlace.escritas.slice(254).map((p) => p.seq), [254, 255, 0, 1]);
});

test('desarmado: controles mexidos nunca chegam ao rádio', async () => {
  const { transmissor, enlace, conectar, mover } = montar();
  conectar();
  mover({ roll: 1, pitch: 1, yaw: 1, throttle: 1 });
  transmissor.tick();
  await assentar();
  assert.ok(!armado(enlace.escritas[0]) && zerado(enlace.escritas[0]));
});

test('armado: os valores atuais vão no pacote', async () => {
  const { transmissor, enlace, conectar, mover, despachar } = montar();
  conectar();
  despachar(Acao.ARMAR);
  mover({ pitch: 1, yaw: -1, throttle: 0.5 });
  transmissor.tick();
  await assentar();
  const p = enlace.escritas[0];
  assert.ok(armado(p));
  assert.equal(p.pitch, 1500);
  assert.equal(p.yaw, -4500);
  assert.equal(p.throttle, 150);
});

test('sem sobreposição: tick com escrita pendente é descartado', async () => {
  const { transmissor, enlace, conectar } = montar({ automatico: false });
  conectar();
  transmissor.tick();
  transmissor.tick();
  transmissor.tick();
  await assentar();
  assert.equal(enlace.escritas.length, 1);
  assert.equal(transmissor.diagnostico().descartados, 2);
  enlace.liberar();
  await assentar();
  transmissor.tick();
  await assentar();
  assert.equal(enlace.escritas.length, 2);
});

test('PARAR durante uma escrita pendente: o próximo pacote é a parada', async () => {
  const { transmissor, enlace, conectar, mover, despachar } = montar({ automatico: false });
  conectar();
  despachar(Acao.ARMAR);
  mover({ pitch: 1, throttle: 1 });
  transmissor.tick(); // pacote com valores fica pendente no enlace
  await assentar();
  assert.ok(armado(enlace.escritas[0]) && !zerado(enlace.escritas[0]));

  despachar(Acao.PARAR);
  await assentar();
  assert.equal(enlace.escritas.length, 1, 'não escreve por cima da pendente');

  enlace.liberar(); // a pendente termina: a parada sai sem esperar o tick
  await assentar();
  assert.equal(enlace.escritas.length, 2);
  assert.ok(parada(enlace.escritas[1]));
  assert.ok(!armado(enlace.escritas[1]) && zerado(enlace.escritas[1]));

  // Daqui em diante nenhum pacote volta a ter valores ou a flag de armado.
  enlace.automatico = true;
  enlace.liberar();
  for (let i = 0; i < 20; i++) {
    transmissor.tick();
    await assentar();
  }
  const depois = enlace.escritas.slice(1);
  assert.ok(depois.every((p) => !armado(p) && zerado(p)));
});

test('PARAR sem escrita pendente sai imediatamente, sem esperar o tick', async () => {
  const { enlace, conectar, mover, despachar } = montar();
  conectar();
  despachar(Acao.ARMAR);
  mover({ roll: 1 });
  despachar(Acao.PARAR);
  await assentar();
  assert.equal(enlace.escritas.length, 1);
  assert.ok(parada(enlace.escritas[0]) && zerado(enlace.escritas[0]));
});

test('a flag de parada vai em N pacotes e depois some', async () => {
  const { transmissor, enlace, conectar, despachar, loja } = montar();
  conectar();
  despachar(Acao.ARMAR);
  despachar(Acao.PARAR);
  await assentar();
  for (let i = 0; i < PACOTES_DE_PARADA + 3; i++) {
    transmissor.tick();
    await assentar();
  }
  const comParada = enlace.escritas.filter(parada).length;
  assert.equal(comParada, PACOTES_DE_PARADA);
  assert.ok(!parada(enlace.escritas.at(-1)));
  assert.equal(loja.estado().paradaRestante, 0);
});

test('perder o foco envia o pacote desarmado na hora', async () => {
  const { enlace, conectar, mover, despachar } = montar();
  conectar();
  despachar(Acao.ARMAR);
  mover({ yaw: 1 });
  despachar(Acao.FOCO_PERDIDO);
  await assentar();
  assert.equal(enlace.escritas.length, 1);
  assert.ok(!armado(enlace.escritas[0]) && zerado(enlace.escritas[0]));
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

test('diagnóstico: taxa efetiva e último pacote', async () => {
  const { transmissor, conectar, relogio } = montar();
  conectar();
  for (let i = 0; i < 30; i++) {
    relogio.ms = i * 33;
    transmissor.tick();
    await assentar();
  }
  let d = transmissor.diagnostico();
  assert.equal(d.taxaHz, 30);
  assert.equal(d.ultimoPacote.length, 15);
  relogio.ms = 5000;
  d = transmissor.diagnostico();
  assert.equal(d.taxaHz, 0);
});
