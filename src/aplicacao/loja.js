/**
 * @fileoverview Loja de estado: guarda o estado atual e avisa os assinantes.
 *
 * Fluxo unidirecional: a UI e os adaptadores só DESPACHAM ações; o redutor
 * (src/dominio/estado.js) calcula o novo estado; os assinantes reagem.
 */

/**
 * @template E
 * @param {function(E, Object): E} reduzir
 * @param {E} inicial
 */
export function criarLoja(reduzir, inicial) {
  let estado = inicial;
  const assinantes = new Set();
  const fila = [];
  let processando = false;

  /** @return {E} */
  function obterEstado() {
    return estado;
  }

  /**
   * Aplica uma ação. Ações despachadas de dentro de um assinante entram em
   * fila e são aplicadas em ordem, para nenhum assinante ver estados fora
   * de sequência.
   * @param {{tipo: string}} acao
   */
  function despachar(acao) {
    fila.push(acao);
    if (processando) return;
    processando = true;
    try {
      while (fila.length > 0) {
        const anterior = estado;
        estado = reduzir(estado, fila.shift());
        if (estado === anterior) continue;
        for (const assinante of [...assinantes]) assinante(estado, anterior);
      }
    } finally {
      processando = false;
    }
  }

  /**
   * @param {function(E, E): void} assinante recebe (novo, anterior)
   * @return {function(): void} função para cancelar a assinatura
   */
  function assinar(assinante) {
    assinantes.add(assinante);
    return () => assinantes.delete(assinante);
  }

  return { estado: obterEstado, despachar, assinar };
}
