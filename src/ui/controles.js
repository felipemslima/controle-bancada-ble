/**
 * @fileoverview Controles de toque: joystick, deslizante e botão de segurar.
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
 * Joystick de dois eixos com retorno ao centro.
 *
 * @param {HTMLElement} elemento base; precisa conter um filho `.pino`
 * @param {function(number, number): void} aoMudar (x, y) em -1..1; y para cima
 * @return {{reiniciar: function(): void}}
 */
export function criarJoystick(elemento, aoMudar) {
  const pino = elemento.querySelector('.pino');
  let ponteiro = null;
  let origem = { x: 0, y: 0 };

  const raio = () => Math.max(1, (elemento.clientWidth - pino.offsetWidth) / 2);

  function mostrar(x, y) {
    pino.style.transform = `translate(${x * raio()}px, ${-y * raio()}px)`;
    elemento.classList.toggle('ativo', ponteiro !== null);
  }

  elemento.addEventListener('pointerdown', (evento) => {
    if (ponteiro !== null) return;
    evento.preventDefault();
    ponteiro = evento.pointerId;
    origem = { x: evento.clientX, y: evento.clientY };
    capturar(elemento, evento);
    mostrar(0, 0);
  });

  elemento.addEventListener('pointermove', (evento) => {
    if (evento.pointerId !== ponteiro) return;
    let x = (evento.clientX - origem.x) / raio();
    let y = -(evento.clientY - origem.y) / raio();
    const modulo = Math.hypot(x, y);
    if (modulo > 1) {
      x /= modulo;
      y /= modulo;
    }
    mostrar(x, y);
    aoMudar(x, y);
  });

  function soltar(evento) {
    if (evento.pointerId !== ponteiro) return;
    ponteiro = null;
    mostrar(0, 0);
    aoMudar(0, 0);
  }
  for (const tipo of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    elemento.addEventListener(tipo, soltar);
  }

  return {
    /** Solta o controle sem emitir valor (o estado já foi zerado). */
    reiniciar() {
      ponteiro = null;
      mostrar(0, 0);
    },
  };
}

/**
 * Deslizante de um eixo.
 *
 * @param {HTMLElement} elemento precisa conter um filho `.trilho`
 * @param {Object} opcoes
 * @param {boolean=} opcoes.vertical   true: para cima aumenta
 * @param {boolean=} opcoes.bipolar    true: -1..1; false: 0..1
 * @param {boolean=} opcoes.retorna    true: volta a zero ao soltar
 * @param {function(number): void} opcoes.aoMudar
 * @return {{reiniciar: function(): void, habilitar: function(boolean): void}}
 */
export function criarDeslizante(
    elemento, { vertical = false, bipolar = false, retorna = false, aoMudar }) {
  const trilho = elemento.querySelector('.trilho');
  const minimo = bipolar ? -1 : 0;
  const curso = bipolar ? 2 : 1;
  let valor = 0;
  let ponteiro = null;
  let origem = 0;
  let base = 0;
  let habilitado = true;

  function mostrar() {
    elemento.style.setProperty('--fracao', String((valor - minimo) / curso));
    elemento.classList.toggle('ativo', ponteiro !== null);
  }

  elemento.addEventListener('pointerdown', (evento) => {
    if (!habilitado || ponteiro !== null) return;
    evento.preventDefault();
    ponteiro = evento.pointerId;
    origem = vertical ? evento.clientY : evento.clientX;
    base = valor;
    capturar(elemento, evento);
    mostrar();
  });

  elemento.addEventListener('pointermove', (evento) => {
    if (evento.pointerId !== ponteiro) return;
    const comprimento =
        Math.max(1, vertical ? trilho.clientHeight : trilho.clientWidth);
    const deslocamento =
        vertical ? origem - evento.clientY : evento.clientX - origem;
    valor = Math.min(1, Math.max(minimo, base + (deslocamento / comprimento) * curso));
    mostrar();
    aoMudar(valor);
  });

  function soltar(evento) {
    if (evento.pointerId !== ponteiro) return;
    ponteiro = null;
    if (retorna) {
      valor = 0;
      aoMudar(0);
    }
    mostrar();
  }
  for (const tipo of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    elemento.addEventListener(tipo, soltar);
  }

  mostrar();
  return {
    /** Volta a zero sem emitir valor (o estado já foi zerado). */
    reiniciar() {
      ponteiro = null;
      valor = 0;
      mostrar();
    },
    habilitar(ligar) {
      habilitado = ligar;
      elemento.classList.toggle('desabilitado', !ligar);
      if (!ligar) ponteiro = null;
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
