/**
 * @fileoverview Ponto de entrada (raiz de composição).
 *
 * É o único arquivo que conhece todas as camadas: cria os adaptadores,
 * injeta-os na aplicação e monta a interface. Para trocar o transporte ou
 * acrescentar um recurso, este é o lugar onde as peças são ligadas.
 */

import { criarEnlaceBle } from './adaptadores/ble-web.js';
import { criarEnlaceSimulado } from './adaptadores/enlace-simulado.js';
import {
  criarArmazenamento, criarTravaDeTela, observarCicloDeVida,
} from './adaptadores/navegador.js';
import { criarGerenciadorDeConexao } from './aplicacao/conexao.js';
import { criarLoja } from './aplicacao/loja.js';
import { criarTransmissor } from './aplicacao/transmissor.js';
import { normalizarConfig } from './dominio/config.js';
import { Acao, Conexao, estadoInicial, reduzir } from './dominio/estado.js';
import { montarInterface } from './ui/interface.js';

const simulado = new URLSearchParams(location.search).has('simular');

const armazenamento = criarArmazenamento();
const loja = criarLoja(reduzir, estadoInicial(normalizarConfig(armazenamento.ler())));
const enlace = simulado ? criarEnlaceSimulado() : criarEnlaceBle();
const conexao = criarGerenciadorDeConexao({ loja, enlace });
const transmissor = criarTransmissor({ loja, enlace });
const travaDeTela = criarTravaDeTela();

// Segurança: sair do primeiro plano desarma e zera antes de a página ser suspensa.
observarCicloDeVida((motivo) => loja.despachar({ tipo: Acao.FOCO_PERDIDO, motivo }));

// Tela acesa apenas enquanto conectado.
loja.assinar((novo, anterior) => {
  if (novo.conexao !== anterior.conexao) {
    travaDeTela.definir(novo.conexao === Conexao.CONECTADO);
  }
});

montarInterface({
  loja, conexao, transmissor, armazenamento, travaDeTela,
  suportado: enlace.suportado, simulado,
});
transmissor.iniciar();
