/**
 * @fileoverview Mock do Web Bluetooth para testes sem hardware.
 *
 * Imita o suficiente de `navigator.bluetooth` para exercitar o adaptador
 * src/adaptadores/ble-web.js: seletor de dispositivo, GATT, uma
 * característica de UART transparente (escrita sem resposta + notificação)
 * e o evento de desconexão.
 *
 * NÃO imita tempos de rádio, perda de pacotes no ar nem as diferenças
 * entre navegadores (Bluefy x Chrome).
 */

class Alvo {
  constructor() {
    this.ouvintes = new Map();
  }
  addEventListener(tipo, ouvinte) {
    if (!this.ouvintes.has(tipo)) this.ouvintes.set(tipo, new Set());
    this.ouvintes.get(tipo).add(ouvinte);
  }
  removeEventListener(tipo, ouvinte) {
    this.ouvintes.get(tipo)?.delete(ouvinte);
  }
  disparar(tipo) {
    for (const ouvinte of [...(this.ouvintes.get(tipo) ?? [])]) {
      ouvinte({ type: tipo, target: this });
    }
  }
}

/**
 * @param {Object=} opcoes
 * @param {number|string=} opcoes.servico
 * @param {number|string=} opcoes.caracteristica
 * @param {boolean=} opcoes.semEscritaSemResposta simula navegador/módulo antigo
 */
export function criarMockBluetooth({
  servico = 0xffe0,
  caracteristica = 0xffe1,
  semEscritaSemResposta = false,
} = {}) {
  const mock = {
    /** @type {Uint8Array[]} tudo o que foi escrito, em ordem */
    escritas: [],
    /** @type {Object[]} argumentos de cada requestDevice */
    pedidos: [],
    conexoes: 0,
    cancelarSeletor: false,
    falharConexao: false,
    /** Se definido, cada escrita espera esta promessa antes de resolver. */
    segurarEscritas: null,
  };

  const car = new Alvo();
  car.properties = {
    writeWithoutResponse: !semEscritaSemResposta,
    write: semEscritaSemResposta,
    notify: true,
    indicate: false,
  };
  car.value = null;
  car.notificando = false;

  async function gravar(dados) {
    if (!gatt.connected) throw new Error('GATT Server is disconnected');
    if (mock.segurarEscritas) await mock.segurarEscritas;
    mock.escritas.push(Uint8Array.from(dados));
  }
  if (semEscritaSemResposta) {
    car.writeValue = gravar;
  } else {
    car.writeValueWithoutResponse = gravar;
    car.writeValueWithResponse = gravar;
  }
  car.startNotifications = async () => {
    car.notificando = true;
    return car;
  };

  const dispositivo = new Alvo();
  dispositivo.name = 'HMSoft';

  const gatt = {
    connected: false,
    async connect() {
      if (mock.falharConexao) throw new Error('Connection attempt failed');
      gatt.connected = true;
      mock.conexoes++;
      return gatt;
    },
    disconnect() {
      if (!gatt.connected) return;
      gatt.connected = false;
      dispositivo.disparar('gattserverdisconnected');
    },
    async getPrimaryService(uuid) {
      if (uuid !== servico) throw new Error(`No Services matching UUID ${uuid}`);
      return {
        async getCharacteristic(u) {
          if (u !== caracteristica) throw new Error(`No Characteristics matching UUID ${u}`);
          return car;
        },
      };
    },
  };
  dispositivo.gatt = gatt;

  mock.bluetooth = {
    async requestDevice(opcoes) {
      mock.pedidos.push(opcoes);
      if (mock.cancelarSeletor) {
        throw Object.assign(new Error('User cancelled the requestDevice() chooser.'),
            { name: 'NotFoundError' });
      }
      return dispositivo;
    },
  };

  /** Simula bytes chegando da controladora (notificação). */
  mock.notificar = (bytes) => {
    const copia = Uint8Array.from(bytes);
    car.value = new DataView(copia.buffer);
    car.disparar('characteristicvaluechanged');
  };

  /** Simula a queda do enlace (módulo desligado, fora de alcance). */
  mock.derrubar = () => gatt.disconnect();

  mock.dispositivo = dispositivo;
  mock.caracteristica = car;
  return mock;
}

/** Deixa as promessas pendentes avançarem. */
export function assentar() {
  return new Promise((resolver) => setImmediate(resolver));
}
