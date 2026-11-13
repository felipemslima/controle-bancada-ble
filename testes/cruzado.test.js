/**
 * Teste cruzado JavaScript x C: garante que a página e o firmware de
 * referência leem os bytes do mesmo jeito. Compila firmware/rc_byte.c com
 * gcc. Se o gcc não estiver instalado, os testes são pulados.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { Tipo, decodificarByte } from '../src/dominio/protocolo.js';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const temGcc = spawnSync('gcc', ['--version']).status === 0;
const pular = temGcc ? false : 'gcc não encontrado';

/** Mesma numeração do enum rc_tipo_t em firmware/rc_byte.h. */
const TIPO_EM_C = {
  [Tipo.POSICAO]: 0,
  [Tipo.CONECTAR]: 1,
  [Tipo.DESCONECTAR]: 2,
};

let pasta;
let binario;

before(() => {
  if (!temGcc) return;
  pasta = mkdtempSync(join(tmpdir(), 'rc-byte-'));
  binario = join(pasta, 'teste_byte');
  execFileSync('gcc', [
    '-std=c99', '-Wall', '-Wextra', '-Werror', '-pedantic', '-Wconversion',
    join(raiz, 'firmware/rc_byte.c'),
    join(raiz, 'testes/firmware/teste_byte.c'),
    '-o', binario,
  ], { stdio: 'pipe' });
});

after(() => {
  if (pasta) rmSync(pasta, { recursive: true, force: true });
});

test('C: compila sem avisos e passa nos testes unitários', { skip: pular }, () => {
  const saida = execFileSync(binario, { encoding: 'utf8' });
  assert.match(saida, /todos os testes passaram/);
});

test('JS e C decodificam os 256 bytes do mesmo jeito', { skip: pular }, () => {
  const todos = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
  const saida = execFileSync(binario, ['decodificar'], { input: todos, encoding: 'utf8' });
  const linhas = saida.trim().split('\n');
  assert.equal(linhas.length, 256);
  for (let b = 0; b < 256; b++) {
    const m = decodificarByte(b);
    assert.equal(linhas[b], `${TIPO_EM_C[m.tipo]} ${m.pitch} ${m.roll}`,
        `byte 0x${b.toString(16)}`);
  }
});
