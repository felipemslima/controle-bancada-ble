/**
 * @fileoverview Adaptadores pequenos para recursos do navegador:
 * ciclo de vida da página, trava de tela (wake lock) e armazenamento local.
 */

const CHAVE_CONFIG = 'controle-remoto.config.v1';

/**
 * Avisa quando a página deixa de estar em primeiro plano: aba oculta, tela
 * bloqueada, troca de aplicativo ou perda de foco da janela. No iOS/Bluefy
 * não há execução em segundo plano, então qualquer um desses eventos tem de
 * desarmar ANTES de a página ser suspensa.
 *
 * @param {function(string): void} aoPerderFoco recebe o motivo
 * @param {Window=} janela
 */
export function observarCicloDeVida(aoPerderFoco, janela = globalThis) {
  const documento = janela.document;
  documento.addEventListener('visibilitychange', () => {
    if (documento.visibilityState !== 'visible') aoPerderFoco('a página ficou oculta');
  });
  documento.addEventListener('freeze', () => aoPerderFoco('a página foi suspensa'));
  janela.addEventListener('pagehide', () => aoPerderFoco('a página foi fechada'));
  janela.addEventListener('blur', () => aoPerderFoco('a página perdeu o foco'));
}

/**
 * Mantém a tela acesa enquanto for pedido. O suporte varia (no Bluefy pode
 * não existir); sem ele, o bloqueio de tela cai na regra de perda de foco.
 *
 * @param {Navigator=} navegador
 * @param {Document=} documento
 */
export function criarTravaDeTela(
    navegador = globalThis.navigator, documento = globalThis.document) {
  let trava = null;
  let desejada = false;

  async function pedir() {
    if (!desejada || trava || !navegador?.wakeLock) return;
    if (documento.visibilityState !== 'visible') return;
    try {
      trava = await navegador.wakeLock.request('screen');
      trava.addEventListener('release', () => {
        trava = null;
      });
    } catch {
      trava = null;
    }
  }

  // O navegador solta a trava quando a página fica oculta; pede de novo ao voltar.
  documento?.addEventListener('visibilitychange', pedir);

  return {
    suportada: Boolean(navegador?.wakeLock),
    ativa: () => trava !== null,
    /** @param {boolean} ligar */
    definir(ligar) {
      desejada = ligar;
      if (ligar) {
        pedir();
      } else if (trava) {
        trava.release().catch(() => {});
        trava = null;
      }
    },
  };
}

/**
 * Guarda a configuração no localStorage. Falhas (modo privado, bloqueio)
 * são ignoradas: a página funciona com a configuração padrão.
 *
 * @param {Storage=} armazenamento
 * @return {import('../aplicacao/portas.js').Armazenamento}
 */
export function criarArmazenamento(armazenamento) {
  const obter = () => armazenamento ?? globalThis.localStorage;
  return {
    ler() {
      try {
        return JSON.parse(obter().getItem(CHAVE_CONFIG));
      } catch {
        return null;
      }
    },
    gravar(config) {
      try {
        obter().setItem(CHAVE_CONFIG, JSON.stringify(config));
      } catch {
        // Sem armazenamento: a configuração vale só para esta sessão.
      }
    },
  };
}
