/**
 * Testes do adaptador BLE e da integração completa (loja + conexão +
 * transmissor + adaptador) contra o mock do Web Bluetooth.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { criarEnlaceBle } from '../src/adaptadores/ble-web.js';
import { criarGerenciadorDeConexao } from '../src/aplicacao/conexao.js';
import { criarLoja } from '../src/aplicacao/loja.js';
import { criarTransmissor } from '../src/aplicacao/transmissor.js';
import { normalizarConfig } from '../src/dominio/config.js';
import {
  Acao, Conexao, PACOTES_DE_INICIO, estadoInicial, reduzir,
} from '../src/dominio/estado.js';
import { decodificarByte } from '../src/dominio/protocolo.js';
import { assentar, criarMockBluetooth } from './apoio/mock-bluetooth.js';

const HM10 = { servico: 0xffe0, caracteristica: 0xffe1, mostrarTodos: false };

function montar({ mock = criarMockBluetooth(), config } = {}) {
  const loja = criarLoja(reduzir, estadoInicial(normalizarConfig(config)));
  const enlace = criarEnlaceBle(mock.bluetooth);
  const esperas = [];
  const conexao = criarGerenciadorDeConexao({
    loja, enlace,
    esperar: async (ms) => {
      esperas.push(ms);
    },
  });
  const transmissor = criarTransmissor({ loja, enlace, agora: () => 0 });
  const despachar = (tipo, extras) => loja.despachar({ tipo, ...extras });
  return { mock, loja, enlace, conexao, transmissor, despachar, esperas };
}

test('adaptador: sem Web Bluetooth informa que não há suporte', async () => {
  const enlace = criarEnlaceBle(null);
  assert.equal(enlace.suportado, false);
  await assert.rejects(enlace.conectar(HM10), /indisponível/);
});

test('adaptador: conecta filtrando pelo serviço do HM-10', async () => {
  const mock = criarMockBluetooth();
  const enlace = criarEnlaceBle(mock.bluetooth);
  await enlace.conectar(HM10);
  assert.deepEqual(mock.pedidos[0], { filters: [{ services: [0xffe0] }] });
  assert.equal(mock.caracteristica.notificando, true);
});

test('adaptador: "mostrar todos" pede o serviço como opcional', async () => {
  const mock = criarMockBluetooth();
  const enlace = criarEnlaceBle(mock.bluetooth);
  await enlace.conectar({ ...HM10, mostrarTodos: true });
  assert.deepEqual(mock.pedidos[0],
      { acceptAllDevices: true, optionalServices: [0xffe0] });
});

test('adaptador: UUIDs configuráveis (128 bits)', async () => {
  const servico = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
  const caracteristica = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
  const mock = criarMockBluetooth({ servico, caracteristica });
  const enlace = criarEnlaceBle(mock.bluetooth);
  await enlace.conectar({ servico, caracteristica, mostrarTodos: false });
  await enlace.escrever(Uint8Array.of(1, 2, 3));
  assert.deepEqual([...mock.escritas[0]], [1, 2, 3]);
});

test('adaptador: UUID errado faz a conexão falhar', async () => {
  const mock = criarMockBluetooth();
  const enlace = criarEnlaceBle(mock.bluetooth);
  await assert.rejects(enlace.conectar({ ...HM10, caracteristica: 0xffe2 }));
  await assert.rejects(enlace.escrever(Uint8Array.of(1)), /Sem conexão/);
});

test('adaptador: usa writeValue quando não há escrita sem resposta', async () => {
  const mock = criarMockBluetooth({ semEscritaSemResposta: true });
  const enlace = criarEnlaceBle(mock.bluetooth);
  await enlace.conectar(HM10);
  await enlace.escrever(Uint8Array.of(9));
  assert.deepEqual([...mock.escritas[0]], [9]);
});

test('adaptador: entrega notificações e avisa a queda', async () => {
  const mock = criarMockBluetooth();
  const enlace = criarEnlaceBle(mock.bluetooth);
  const recebidos = [];
  let quedas = 0;
  enlace.aoReceber((bytes) => recebidos.push([...bytes]));
  enlace.aoDesconectar(() => quedas++);
  await enlace.conectar(HM10);
  mock.notificar([0xa5, 0x5a]);
  assert.deepEqual(recebidos, [[0xa5, 0x5a]]);
  mock.derrubar();
  assert.equal(quedas, 1);
  await assert.rejects(enlace.escrever(Uint8Array.of(1)), /Sem conexão/);
});

test('adaptador: reconectar reusa o dispositivo, sem abrir o seletor', async () => {
  const mock = criarMockBluetooth();
  const enlace = criarEnlaceBle(mock.bluetooth);
  await assert.rejects(enlace.reconectar(), /Nenhum dispositivo/);
  await enlace.conectar(HM10);
  mock.derrubar();
  await enlace.reconectar();
  assert.equal(mock.pedidos.length, 1);
  assert.equal(mock.conexoes, 2);
  await enlace.escrever(Uint8Array.of(7));
  assert.equal(mock.escritas.length, 1);
});

test('integração: conectar, armar e enviar chega ao módulo', async () => {
  const { mock, loja, conexao, transmissor, despachar } = montar();
  await conexao.conectar();
  assert.equal(loja.estado().conexao, Conexao.CONECTADO);
  despachar(Acao.ARMAR);
  despachar(Acao.EIXOS_ALTERADOS, { eixos: { pitch: 1 } });
  for (let i = 0; i <= PACOTES_DE_INICIO; i++) {
    transmissor.tick();
    await assentar();
  }
  assert.deepEqual(mock.escritas.map((b) => b[0]),
      [...Array(PACOTES_DE_INICIO).fill(0xf0), 0xe7]);
});

test('integração: cancelar o seletor volta a desconectado com aviso', async () => {
  const mock = criarMockBluetooth();
  mock.cancelarSeletor = true;
  const { loja, conexao } = montar({ mock });
  await conexao.conectar();
  assert.equal(loja.estado().conexao, Conexao.DESCONECTADO);
  assert.match(loja.estado().aviso, /Nenhum dispositivo/);
});

test('integração: queda desarma; a reconexão automática não rearma', async () => {
  const { mock, loja, conexao, transmissor, despachar, esperas } = montar();
  await conexao.conectar();
  despachar(Acao.ARMAR);
  despachar(Acao.EIXOS_ALTERADOS, { eixos: { pitch: 1 } });
  transmissor.tick();
  await assentar();

  mock.derrubar();
  assert.equal(loja.estado().armado, false);
  await assentar();
  assert.equal(loja.estado().conexao, Conexao.CONECTADO, 'reconectou sozinho');
  assert.equal(loja.estado().armado, false);
  assert.deepEqual(esperas, [500]);
  assert.equal(mock.pedidos.length, 1, 'sem abrir o seletor de novo');

  const antes = mock.escritas.length;
  transmissor.tick();
  await assentar();
  assert.deepEqual([...mock.escritas[antes]], [0xff], 'volta mandando parar');
});

test('integração: reconexão desiste depois das tentativas', async () => {
  const { mock, loja, conexao, esperas } = montar();
  await conexao.conectar();
  mock.falharConexao = true;
  mock.derrubar();
  await assentar();
  await assentar();
  assert.equal(loja.estado().conexao, Conexao.DESCONECTADO);
  assert.deepEqual(esperas, [500, 1000, 2000, 4000]);
  assert.match(loja.estado().aviso, /Não foi possível reconectar/);
});

test('integração: desconectar é recusado enquanto armado', async () => {
  const { loja, conexao, despachar } = montar();
  await conexao.conectar();
  despachar(Acao.ARMAR);
  await conexao.desconectar();
  assert.equal(loja.estado().conexao, Conexao.CONECTADO);
  assert.match(loja.estado().aviso, /Desarme/);
  despachar(Acao.DESARMAR);
  await conexao.desconectar();
  await assentar();
  assert.equal(loja.estado().conexao, Conexao.DESCONECTADO, 'e não tenta reconectar');
});

test('integração: escrita lenta + PARAR não deixa valor antigo sair depois', async () => {
  const { mock, conexao, transmissor, despachar } = montar();
  await conexao.conectar();
  despachar(Acao.ARMAR);
  for (let i = 0; i < PACOTES_DE_INICIO; i++) {
    transmissor.tick();
    await assentar();
  }
  despachar(Acao.EIXOS_ALTERADOS, { eixos: { pitch: 1 } });
  const inicio = mock.escritas.length;

  let soltar;
  mock.segurarEscritas = new Promise((resolver) => {
    soltar = resolver;
  });
  transmissor.tick(); // fica presa dentro do "rádio"
  transmissor.tick();
  despachar(Acao.PARAR);
  transmissor.tick();
  await assentar();
  assert.equal(mock.escritas.length, inicio);

  mock.segurarEscritas = null;
  soltar();
  await assentar();
  for (let i = 0; i < 5; i++) {
    transmissor.tick();
    await assentar();
  }
  const mensagens = mock.escritas.slice(inicio).map((b) => decodificarByte(b[0]));
  assert.deepEqual(mensagens[0], { tipo: 'posicao', pitch: 7, roll: 0 },
      'a escrita já entregue ao rádio sai primeiro');
  assert.ok(mensagens.slice(1).every((m) => m.tipo === 'desconectar'),
      'depois dela, só 0xFF');
});
