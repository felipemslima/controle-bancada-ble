/**
 * @fileoverview Controles de toque: joystick e botão de segurar.
 *
 * Todos são RELATIVOS ao ponto do primeiro toque: encostar o dedo nunca
 * produz valor; só o deslocamento produz. Assim um toque acidental fora do
 * centro não gera um salto de comando.
 *
 * Estes componentes só conhecem o DOM; não sabem nada de estado ou BLE.
 */

function capturar(elemento, evento) {
  try {
    elemento.setPointerCapture(evento.pointerId);
  } catch {
    // Sem captura o controle ainda funciona enquanto o dedo estiver sobre ele.
  }
}

/**
 * Joystick de dois eixos.
 *
 * Por padrão os dois eixos voltam ao centro ao soltar. Com `retornaY: false`
 * o eixo vertical fica onde foi solto (como o acelerador de um rádio) e
 * começa embaixo (-1), não no centro.
 *
 * @param {HTMLElement} elemento base; precisa conter um filho `.pino`
 * @param {Object} opcoes
 * @param {function(number, number): void} opcoes.aoMudar
 *     (x, y) em -1..1; y positivo é para cima
 * @param {boolean=} opcoes.retornaY false: o eixo y não volta ao soltar
 * @return {{reiniciar: function(): void, habilitarY: function(boolean): void}}
 */
export function criarJoystick(elemento, { aoMudar, retornaY = true }) {
  const pino = elemento.querySelector('.pino');
  const repouso = retornaY ? 0 : -1;
  let ponteiro = null;
  let origem = { x: 0, y: 0 };
  let x = 0;
  let y = repouso;
  let yBase = repouso;
  let yHabilitado = true;

  const raio = () => Math.max(1, (elemento.clientWidth - pino.offsetWidth) / 2);
  const limitar = (v) => Math.min(1, Math.max(-1, v));

  function mostrar() {
    pino.style.transform = `translate(${x * raio()}px, ${-y * raio()}px)`;
    elemento.classList.toggle('ativo', ponteiro !== null);
  }

  elemento.addEventListener('pointerdown', (evento) => {
    if (ponteiro !== null) return;
    evento.preventDefault();
    ponteiro = evento.pointerId;
    origem = { x: evento.clientX, y: evento.clientY };
    yBase = y;
    capturar(elemento, evento);
    mostrar();
  });

  elemento.addEventListener('pointermove', (evento) => {
    if (evento.pointerId !== ponteiro) return;
    let dx = (evento.clientX - origem.x) / raio();
    let dy = -(evento.clientY - origem.y) / raio();
    if (retornaY) {
      // Os dois eixos voltam ao centro: limita ao círculo.
      const modulo = Math.hypot(dx, dy);
      if (modulo > 1) {
        dx /= modulo;
        dy /= modulo;
      }
      x = dx;
      y = dy;
    } else {
      x = limitar(dx);
      if (yHabilitado) y = limitar(yBase + dy);
    }
    mostrar();
    aoMudar(x, y);
  });

  function soltar(evento) {
    if (evento.pointerId !== ponteiro) return;
    ponteiro = null;
    x = 0;
    if (retornaY) y = 0;
    mostrar();
    aoMudar(x, y);
  }
  for (const tipo of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    elemento.addEventListener(tipo, soltar);
  }

  mostrar();
  return {
    /** Volta ao repouso sem emitir valor (o estado já foi zerado). */
    reiniciar() {
      ponteiro = null;
      x = 0;
      y = repouso;
      yBase = repouso;
      mostrar();
    },
    /** Trava ou libera o eixo vertical (só vale com `retornaY: false`). */
    habilitarY(ligar) {
      yHabilitado = ligar;
      elemento.classList.toggle('y-desabilitado', !ligar);
    },
  };
}

/**
 * Botão que só dispara depois de ficar pressionado por um tempo.
 *
 * @param {HTMLElement} botao
 * @param {Object} opcoes
 * @param {number=} opcoes.duracaoMs
 * @param {function(): boolean} opcoes.podeSegurar se false, vale como toque
 * @param {function(): void} opcoes.aoConcluir segurou até o fim
 * @param {function(): void} opcoes.aoTocar toque simples (quando não pode segurar)
 */
export function criarBotaoDeSegurar(
    botao, { duracaoMs = 1000, podeSegurar, aoConcluir, aoTocar }) {
  let temporizador = null;
  botao.style.setProperty('--duracao', `${duracaoMs}ms`);

  function cancelar() {
    if (temporizador !== null) clearTimeout(temporizador);
    temporizador = null;
    botao.classList.remove('segurando');
  }

  botao.addEventListener('pointerdown', (evento) => {
    evento.preventDefault();
    if (!podeSegurar()) {
      aoTocar();
      return;
    }
    cancelar();
    botao.classList.add('segurando');
    temporizador = setTimeout(() => {
      cancelar();
      aoConcluir();
    }, duracaoMs);
  });
  for (const tipo of ['pointerup', 'pointercancel', 'pointerleave']) {
    botao.addEventListener(tipo, cancelar);
  }

  return { cancelar };
}
