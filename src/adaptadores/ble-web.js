/**
 * @fileoverview Adaptador da porta `Enlace` sobre Web Bluetooth (BLE).
 *
 * Funciona com módulos de UART transparente (HM-10, JDY-23 e parecidos),
 * que expõem uma característica única para escrita e notificação.
 * É o único arquivo do projeto que fala com `navigator.bluetooth`.
 */

/**
 * @param {?Object=} bluetooth objeto `navigator.bluetooth` (injetável em testes)
 * @return {import('../aplicacao/portas.js').Enlace}
 */
export function criarEnlaceBle(bluetooth = globalThis.navigator?.bluetooth) {
  let dispositivo = null;
  let caracteristica = null;
  let escreverNaCaracteristica = null;
  let opcoes = null;
  const ouvintesDeDados = new Set();
  const ouvintesDeQueda = new Set();

  function aoCair() {
    caracteristica = null;
    escreverNaCaracteristica = null;
    for (const ouvinte of ouvintesDeQueda) ouvinte();
  }

  function aoNotificar(evento) {
    const valor = evento.target.value;
    const bytes = new Uint8Array(valor.buffer, valor.byteOffset, valor.byteLength);
    for (const ouvinte of ouvintesDeDados) ouvinte(bytes);
  }

  /** Escolhe o método de escrita conforme o que o módulo e o navegador têm. */
  function escolherEscrita(c) {
    const semResposta = c.properties ? c.properties.writeWithoutResponse : true;
    if (semResposta && typeof c.writeValueWithoutResponse === 'function') {
      return (bytes) => c.writeValueWithoutResponse(bytes);
    }
    if (typeof c.writeValueWithResponse === 'function') {
      return (bytes) => c.writeValueWithResponse(bytes);
    }
    return (bytes) => c.writeValue(bytes);
  }

  async function abrirGatt() {
    const servidor = await dispositivo.gatt.connect();
    const servico = await servidor.getPrimaryService(opcoes.servico);
    const c = await servico.getCharacteristic(opcoes.caracteristica);
    if (!c.properties || c.properties.notify || c.properties.indicate) {
      try {
        await c.startNotifications();
        c.removeEventListener('characteristicvaluechanged', aoNotificar);
        c.addEventListener('characteristicvaluechanged', aoNotificar);
      } catch {
        // Telemetria é opcional: sem notificação, o controle segue funcionando.
      }
    }
    escreverNaCaracteristica = escolherEscrita(c);
    caracteristica = c;
  }

  async function conectar(novasOpcoes) {
    if (!bluetooth) throw new Error('Web Bluetooth indisponível neste navegador');
    const pedido = novasOpcoes.mostrarTodos ?
        { acceptAllDevices: true, optionalServices: [novasOpcoes.servico] } :
        { filters: [{ services: [novasOpcoes.servico] }] };
    const escolhido = await bluetooth.requestDevice(pedido);
    if (dispositivo) {
      dispositivo.removeEventListener('gattserverdisconnected', aoCair);
    }
    dispositivo = escolhido;
    opcoes = novasOpcoes;
    dispositivo.addEventListener('gattserverdisconnected', aoCair);
    await abrirGatt();
  }

  async function reconectar() {
    if (!dispositivo) throw new Error('Nenhum dispositivo anterior');
    await abrirGatt();
  }

  async function desconectar() {
    caracteristica = null;
    escreverNaCaracteristica = null;
    if (dispositivo?.gatt?.connected) dispositivo.gatt.disconnect();
  }

  async function escrever(bytes) {
    if (!caracteristica) throw new Error('Sem conexão');
    await escreverNaCaracteristica(bytes);
  }

  return {
    suportado: Boolean(bluetooth),
    conectar,
    reconectar,
    desconectar,
    escrever,
    aoReceber: (ouvinte) => ouvintesDeDados.add(ouvinte),
    aoDesconectar: (ouvinte) => ouvintesDeQueda.add(ouvinte),
  };
}
