/**
 * Teste cruzado JavaScript x C: garante que a página e o firmware falam
 * exatamente o mesmo protocolo. Compila firmware/rc_protocolo.c com gcc.
 * Se o gcc não estiver instalado, os testes são pulados.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  TIPO_COMANDO, TIPO_TELEMETRIA, codificarPacote, criarDecodificadorDeFluxo,
} from '../src/dominio/protocolo.js';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const temGcc = spawnSync('gcc', ['--version']).status === 0;
const pular = temGcc ? false : 'gcc não encontrado';

let pasta;
let binario;

before(() => {
  if (!temGcc) return;
  pasta = mkdtempSync(join(tmpdir(), 'rc-protocolo-'));
  binario = join(pasta, 'teste_protocolo');
  execFileSync('gcc', [
    '-std=c99', '-Wall', '-Wextra', '-Werror', '-pedantic', '-Wconversion',
    join(raiz, 'firmware/rc_protocolo.c'),
    join(raiz, 'testes/firmware/teste_protocolo.c'),
    '-o', binario,
  ], { stdio: 'pipe' });
});

after(() => {
  if (pasta) rmSync(pasta, { recursive: true, force: true });
});

/** Gerador pseudoaleatório com semente fixa: o teste é reproduzível. */
function criarAleatorio(semente) {
  let s = semente >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function pacoteAleatorio(aleatorio, tipo) {
  const inteiro = (min, max) => Math.floor(aleatorio() * (max - min + 1)) + min;
  return {
    tipo,
    seq: inteiro(0, 255),
    flags: inteiro(0, 15),
    roll: inteiro(-32768, 32767),
    pitch: inteiro(-32768, 32767),
    yaw: inteiro(-32768, 32767),
    throttle: inteiro(0, 65535),
  };
}

const linha = (p) =>
  `${p.tipo} ${p.seq} ${p.flags} ${p.roll} ${p.pitch} ${p.yaw} ${p.throttle}`;

test('C: compila sem avisos e passa nos testes unitários', { skip: pular }, () => {
  const saida = execFileSync(binario, { encoding: 'utf8' });
  assert.match(saida, /todos os testes passaram/);
});

test('JS codifica, C decodifica: 500 pacotes com lixo e corrupção no meio',
    { skip: pular }, () => {
      const aleatorio = criarAleatorio(2026);
      const fluxo = [];
      const esperados = [];
      for (let i = 0; i < 500; i++) {
        const pacote = pacoteAleatorio(aleatorio, TIPO_COMANDO);
        const bytes = [...codificarPacote(pacote)];
        const sorteio = aleatorio();
        if (sorteio < 0.15) {
          // Lixo antes do pacote, podendo conter bytes de cabeçalho.
          const n = Math.floor(aleatorio() * 12) + 1;
          for (let k = 0; k < n; k++) {
            fluxo.push([0xa5, 0x5a, 0x00, 0xff][Math.floor(aleatorio() * 4)]);
          }
          // Fecha o lixo com um byte neutro para não emendar um falso
          // cabeçalho no pacote bom que vem a seguir.
          fluxo.push(0x00);
        } else if (sorteio < 0.25) {
          // Um pacote truncado (bytes perdidos) antes do pacote bom.
          const perdido = [...codificarPacote(pacoteAleatorio(aleatorio, TIPO_COMANDO))];
          fluxo.push(...perdido.slice(0, Math.floor(aleatorio() * 14) + 1), 0x00);
        } else if (sorteio < 0.35) {
          // Um pacote com um bit trocado na carga útil antes do pacote bom.
          const ruim = [...codificarPacote(pacoteAleatorio(aleatorio, TIPO_COMANDO))];
          ruim[2 + Math.floor(aleatorio() * 11)] ^= 1 << Math.floor(aleatorio() * 8);
          fluxo.push(...ruim, 0x00);
        }
        fluxo.push(...bytes);
        esperados.push(linha(pacote));
      }

      const saida = execFileSync(binario, ['decodificar'],
          { input: Buffer.from(fluxo), encoding: 'utf8' });
      assert.deepEqual(saida.trim().split('\n'), esperados);

      // O decodificador em JS tem de chegar ao mesmo resultado do C.
      const emJs = criarDecodificadorDeFluxo().alimentar(fluxo).map(linha);
      assert.deepEqual(emJs, esperados);
    });

test('C codifica, JS decodifica: telemetria', { skip: pular }, () => {
  const aleatorio = criarAleatorio(7);
  for (let i = 0; i < 100; i++) {
    const pacote = pacoteAleatorio(aleatorio, TIPO_TELEMETRIA);
    const hex = execFileSync(binario, ['codificar', ...linha(pacote).split(' ')],
        { encoding: 'utf8' }).trim();
    const bytes = hex.match(/../g).map((par) => parseInt(par, 16));
    assert.deepEqual([...codificarPacote(pacote)], bytes, 'bytes idênticos');
    const lidos = criarDecodificadorDeFluxo().alimentar(bytes);
    assert.equal(lidos.length, 1);
    assert.equal(linha(lidos[0]), linha(pacote));
  }
});
