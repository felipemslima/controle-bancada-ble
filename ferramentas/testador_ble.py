#!/usr/bin/env python3
"""Testador no PC: faz o computador se passar pela controladora de bancada.

Anuncia por BLE (BlueZ, via D-Bus) um serviço UART transparente igual ao do
HM-10 (serviço FFE0, característica FFE1). O celular abre a página de
controle, conecta neste PC e cada byte que a página enviar aparece
decodificado no terminal (protocolo de um byte, ver PROTOCOLO.md), junto com
o que o receptor do firmware faria com ele.

Uso:
    python3 ferramentas/testador_ble.py            # painel ao vivo
    python3 ferramentas/testador_ble.py --todos    # uma linha por byte
    python3 ferramentas/testador_ble.py --csv saida.csv

Linux com BlueZ, python3-dbus e python3-gi. Nenhuma instalação de pacote pip.
Não comanda motor nenhum: serve só para ver o que a página envia.
"""

import argparse
import sys
import time

import dbus
import dbus.exceptions
import dbus.mainloop.glib
import dbus.service
from gi.repository import GLib

import protocolo as p

BLUEZ = "org.bluez"
OM_IFACE = "org.freedesktop.DBus.ObjectManager"
PROP_IFACE = "org.freedesktop.DBus.Properties"
GATT_MANAGER = "org.bluez.GattManager1"
ADV_MANAGER = "org.bluez.LEAdvertisingManager1"
GATT_SERVICE = "org.bluez.GattService1"
GATT_CHRC = "org.bluez.GattCharacteristic1"
ADV_IFACE = "org.bluez.LEAdvertisement1"
DEVICE_IFACE = "org.bluez.Device1"

BASE_UUID = "0000%s-0000-1000-8000-00805f9b34fb"
TIMEOUT_FAILSAFE_S = 0.250  # RC_TIMEOUT_MS do firmware


class Falha(Exception):
    pass


# --------------------------------------------------------------------------
# Objetos GATT/anúncio expostos ao BlueZ
# --------------------------------------------------------------------------

class _ObjetoDbus(dbus.service.Object):
    """Base com org.freedesktop.DBus.Properties sobre `self._props`."""

    def __init__(self, bus, caminho):
        self.path = caminho
        super().__init__(bus, caminho)

    def _props(self):
        raise NotImplementedError

    @dbus.service.method(PROP_IFACE, in_signature="s", out_signature="a{sv}")
    def GetAll(self, interface):
        todas = self._props()
        if interface not in todas:
            raise dbus.exceptions.DBusException(
                "org.freedesktop.DBus.Error.InvalidArgs", "interface desconhecida")
        return todas[interface]

    @dbus.service.method(PROP_IFACE, in_signature="ss", out_signature="v")
    def Get(self, interface, nome):
        return self.GetAll(interface)[nome]


class Caracteristica(_ObjetoDbus):
    def __init__(self, bus, caminho, uuid, caminho_servico, ao_escrever, ao_notificar):
        self.uuid = uuid
        self.caminho_servico = caminho_servico
        self.ao_escrever = ao_escrever
        self.ao_notificar = ao_notificar
        self.notificando = False
        self.valor = []
        super().__init__(bus, caminho)

    def _props(self):
        return {GATT_CHRC: {
            "Service": dbus.ObjectPath(self.caminho_servico),
            "UUID": self.uuid,
            "Flags": dbus.Array(
                ["read", "write", "write-without-response", "notify"], signature="s"),
        }}

    @dbus.service.method(GATT_CHRC, in_signature="a{sv}", out_signature="ay")
    def ReadValue(self, opcoes):
        return dbus.Array(self.valor, signature="y")

    @dbus.service.method(GATT_CHRC, in_signature="aya{sv}")
    def WriteValue(self, valor, opcoes):
        self.ao_escrever(bytes(valor), str(opcoes.get("device", "")))

    @dbus.service.method(GATT_CHRC)
    def StartNotify(self):
        self.notificando = True
        self.ao_notificar(True)

    @dbus.service.method(GATT_CHRC)
    def StopNotify(self):
        self.notificando = False
        self.ao_notificar(False)

    @dbus.service.signal(PROP_IFACE, signature="sa{sv}as")
    def PropertiesChanged(self, interface, mudou, invalidou):
        pass

    def notificar(self, dados):
        if not self.notificando:
            return
        self.valor = [dbus.Byte(b) for b in dados]
        self.PropertiesChanged(
            GATT_CHRC, {"Value": dbus.Array(self.valor, signature="y")}, [])


class Servico(_ObjetoDbus):
    def __init__(self, bus, caminho, uuid):
        self.uuid = uuid
        self.caracteristicas = []
        super().__init__(bus, caminho)

    def _props(self):
        return {GATT_SERVICE: {
            "UUID": self.uuid,
            "Primary": True,
            "Characteristics": dbus.Array(
                [dbus.ObjectPath(c.path) for c in self.caracteristicas], signature="o"),
        }}


class Aplicacao(dbus.service.Object):
    """Raiz GATT: o BlueZ lê toda a árvore por GetManagedObjects."""

    def __init__(self, bus, servico):
        self.path = "/org/bluez/testador"
        self.servico = servico
        super().__init__(bus, self.path)

    @dbus.service.method(OM_IFACE, out_signature="a{oa{sa{sv}}}")
    def GetManagedObjects(self):
        resposta = {dbus.ObjectPath(self.servico.path): self.servico._props()}
        for c in self.servico.caracteristicas:
            resposta[dbus.ObjectPath(c.path)] = c._props()
        return resposta


class Anuncio(_ObjetoDbus):
    def __init__(self, bus, uuid_servico, nome):
        self.uuid_servico = uuid_servico
        self.nome = nome
        super().__init__(bus, "/org/bluez/testador/anuncio0")

    def _props(self):
        return {ADV_IFACE: {
            "Type": "peripheral",
            "ServiceUUIDs": dbus.Array([self.uuid_servico], signature="s"),
            "LocalName": dbus.String(self.nome),
        }}

    @dbus.service.method(ADV_IFACE)
    def Release(self):
        pass


# --------------------------------------------------------------------------
# Painel
# --------------------------------------------------------------------------

class Painel:
    """Estado da sessão e saída no terminal."""

    def __init__(self, todos, arquivo_csv):
        self.todos = todos
        self.csv = arquivo_csv
        self.tty = sys.stdout.isatty()
        self.conectados = {}  # caminho do dispositivo -> rótulo
        self.rotular = lambda origem: origem
        self.esta_conectado = lambda origem: True
        self.inicio = time.monotonic()
        self.ultima_consulta = self.inicio
        self.reiniciar_sessao()

    def reiniciar_sessao(self):
        self.rx = p.Receptor()  # o que o firmware faria
        self.ultimo = None  # último byte recebido
        self.ultimo_instante = None
        self.total = 0
        self.ignorados = 0
        self.instantes = []
        self.silencio_avisado = False
        self.ignorando = False  # já avisou de posição antes do 0xFF
        self.zeros_seguidos = 0
        self.parada_em_curso = False

    # -- saída ------------------------------------------------------------
    def evento(self, texto):
        carimbo = time.strftime("%H:%M:%S")
        if self.tty:
            sys.stdout.write("\r\033[K")
        print("%s  %s" % (carimbo, texto), flush=True)

    @staticmethod
    def formatar(byte):
        return "0x%02X  %s" % (byte, p.descrever(byte))

    def hz(self):
        agora = time.monotonic()
        self.instantes = [t for t in self.instantes if agora - t <= 1.0]
        return len(self.instantes)

    def desenhar(self):
        if not self.tty or self.todos:
            return
        if not self.conectados and self.ultimo is None:
            linha = "aguardando o celular conectar..."
        elif self.ultimo is None:
            linha = "conectado, nenhum byte ainda"
        else:
            idade = time.monotonic() - self.ultimo_instante
            estado = "ARMADO   " if self.rx.conectado else "desarmado"
            posicao = ("pitch %+d roll %+d" % (self.rx.pitch, self.rx.roll)
                       if self.rx.conectado else "-")
            linha = "%s | %-17s | último %s | %2d Hz | bytes %d ignorados %d%s" % (
                estado, posicao, "0x%02X" % self.ultimo, self.hz(), self.total,
                self.ignorados,
                "  SEM SINAL %.1fs" % idade if idade > p.TIMEOUT_MS / 1000 else "")
        sys.stdout.write("\r\033[K" + linha[:200])
        sys.stdout.flush()

    # -- eventos do enlace -------------------------------------------------
    def dispositivo_conectou(self, origem):
        """Idempotente: chamado pelo sinal do BlueZ e pelo primeiro byte."""
        if origem in self.conectados:
            return
        rotulo = self.rotular(origem)
        self.conectados[origem] = rotulo
        self.reiniciar_sessao()
        self.evento("CELULAR CONECTOU  (%s)" % rotulo)

    def dispositivo_desconectou(self, origem):
        if origem not in self.conectados:
            return
        rotulo = self.conectados.pop(origem)
        resumo = ""
        if self.total:
            resumo = " — %d bytes, %d ignorados pelo firmware" % (self.total, self.ignorados)
        self.evento("CELULAR DESCONECTOU (%s)%s" % (rotulo, resumo))
        self.ultimo = None

    def receber(self, dados, origem):
        # O sinal de conexão do BlueZ nem sempre chega: um byte basta.
        self.dispositivo_conectou(origem)
        agora = time.monotonic()
        for byte in dados:
            self.processar(byte, agora)

    def processar(self, byte, agora):
        anterior = self.ultimo
        estava_armado = self.rx.conectado
        if self.silencio_avisado:
            self.evento("bytes voltaram depois de %.0f ms" % (
                (agora - self.ultimo_instante) * 1000))
            self.silencio_avisado = False
        aceito = self.rx.processar(byte, agora * 1000)

        if byte != p.DESCONECTAR and self.zeros_seguidos:
            if self.parada_em_curso:
                self.evento("PARAR: %d x 0x00 seguidos (a página manda 10)%s" % (
                    self.zeros_seguidos,
                    "" if self.zeros_seguidos >= 10 else "  <- MENOS que 10"))
            self.zeros_seguidos = 0
            self.parada_em_curso = False

        if byte == p.CONECTAR:
            if anterior != p.CONECTAR:
                self.evento("CONECTAR (0xFF): o firmware libera o controle")
            self.ignorando = False
        elif byte == p.DESCONECTAR:
            if estava_armado:
                self.evento("DESCONECTAR/PARAR (0x00): o firmware desconecta e zera")
                self.parada_em_curso = True
            elif anterior is None:
                self.evento("heartbeat desarmado: 0x00")
            self.zeros_seguidos += 1
        else:
            _, pitch, roll = p.decodificar(byte)
            if not aceito:
                self.ignorados += 1
                if not self.ignorando:
                    self.ignorando = True
                    self.evento(
                        "VIOLAÇÃO: posição 0x%02X antes do 0xFF; o firmware a ignora "
                        "(desarmada a página só manda 0x00)" % byte)
            else:
                if anterior == p.CONECTAR and byte != 0x88:
                    self.evento("VIOLAÇÃO: a primeira posição depois do 0xFF deveria "
                                "ser 0x88, veio %s" % self.formatar(byte))
                if pitch == -8 or roll == -8:
                    self.evento("VIOLAÇÃO: nível -8 em %s (a página só manda -7..+7)" %
                                self.formatar(byte))
        self.ultimo = byte
        self.ultimo_instante = agora
        self.total += 1
        self.instantes.append(agora)
        if self.todos:
            print("%s  %s%s" % (time.strftime("%H:%M:%S"), self.formatar(byte),
                                "" if aceito else "   (ignorado)"), flush=True)
        if self.csv:
            msg = p.decodificar(byte)
            self.csv.write("%.3f,0x%02X,%s,%s,%s,%d\n" % (
                agora - self.inicio, byte, msg[0],
                msg[1] if msg[0] == "posicao" else "",
                msg[2] if msg[0] == "posicao" else "", aceito))
            self.csv.flush()

    # -- relógio ----------------------------------------------------------
    def tique(self):
        agora = time.monotonic()
        if agora - self.ultima_consulta >= 1.0:
            self.ultima_consulta = agora
            for origem in list(self.conectados):
                if not self.esta_conectado(origem):
                    self.dispositivo_desconectou(origem)
        if self.ultimo_instante is not None and not self.silencio_avisado:
            if self.rx.tick(agora * 1000):
                self.silencio_avisado = True
                self.evento("SILÊNCIO > %d ms: o failsafe do firmware disparou "
                            "(desconecta e zera; posições ignoradas até novo 0xFF)" %
                            p.TIMEOUT_MS)
            elif agora - self.ultimo_instante > p.TIMEOUT_MS / 1000:
                self.silencio_avisado = True
                self.evento("SILÊNCIO > %d ms sem nenhum byte da página" % p.TIMEOUT_MS)
        self.desenhar()
        return True


# --------------------------------------------------------------------------
# Inicialização
# --------------------------------------------------------------------------

def achar_adaptador(bus, nome):
    gerente = dbus.Interface(bus.get_object(BLUEZ, "/"), OM_IFACE)
    for caminho, ifaces in gerente.GetManagedObjects().items():
        if GATT_MANAGER in ifaces and ADV_MANAGER in ifaces:
            if nome is None or str(caminho).endswith("/" + nome):
                return str(caminho)
    raise Falha("nenhum adaptador Bluetooth com suporte a BLE periférico"
                + (" chamado %s" % nome if nome else ""))


def dispositivo_esta_conectado(bus, caminho):
    try:
        props = dbus.Interface(bus.get_object(BLUEZ, caminho), PROP_IFACE)
        return bool(props.Get(DEVICE_IFACE, "Connected"))
    except dbus.exceptions.DBusException:
        return False


def rotulo_do_dispositivo(bus, caminho):
    try:
        props = dbus.Interface(bus.get_object(BLUEZ, caminho), PROP_IFACE)
        nome = str(props.Get(DEVICE_IFACE, "Alias"))
        return "%s %s" % (nome, str(props.Get(DEVICE_IFACE, "Address")))
    except dbus.exceptions.DBusException:
        return caminho.split("dev_")[-1].replace("_", ":")


def principal():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--todos", action="store_true", help="imprime uma linha por byte")
    ap.add_argument("--csv", metavar="ARQ", help="grava todos os bytes em CSV")
    ap.add_argument("--nome", default="Bancada-PC", help="nome anunciado (padrão: Bancada-PC)")
    ap.add_argument("--servico", default="FFE0", help="UUID do serviço (padrão: FFE0)")
    ap.add_argument("--caracteristica", default="FFE1", help="UUID da característica (padrão: FFE1)")
    ap.add_argument("--adaptador", help="ex.: hci0 (padrão: o primeiro com suporte)")
    args = ap.parse_args()

    def uuid_longo(u):
        return BASE_UUID % u.lower() if len(u) == 4 else u.lower()

    dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
    bus = dbus.SystemBus()
    try:
        adaptador = achar_adaptador(bus, args.adaptador)
    except dbus.exceptions.DBusException as erro:
        raise Falha("BlueZ indisponível (%s). O serviço bluetooth está ativo?" %
                    erro.get_dbus_message())

    arquivo_csv = open(args.csv, "w") if args.csv else None
    if arquivo_csv:
        arquivo_csv.write("t_s,byte,tipo,pitch,roll,aceito_pelo_firmware\n")
    painel = Painel(args.todos, arquivo_csv)

    uuid_servico = uuid_longo(args.servico)
    servico = Servico(bus, "/org/bluez/testador/servico0", uuid_servico)
    chrc = Caracteristica(
        bus, servico.path + "/char0", uuid_longo(args.caracteristica), servico.path,
        painel.receber, lambda ligado: painel.evento(
            "celular %s as notificações (a página não as usa)" %
            ("ligou" if ligado else "desligou")))
    servico.caracteristicas.append(chrc)
    painel.rotular = lambda origem: rotulo_do_dispositivo(bus, origem)
    painel.esta_conectado = lambda origem: dispositivo_esta_conectado(bus, origem)
    aplicacao = Aplicacao(bus, servico)
    anuncio = Anuncio(bus, uuid_servico, args.nome)

    laco = GLib.MainLoop()
    registrados = {"gatt": False, "anuncio": False}

    def falhou(que):
        def tratar(erro):
            print("\nFalha ao registrar %s: %s" % (que, erro.get_dbus_message()),
                  file=sys.stderr)
            laco.quit()
        return tratar

    def ao_registrar(que):
        def ok():
            registrados[que] = True
            if all(registrados.values()):
                print("Pronto. Anunciando como '%s' (serviço %s, característica %s)." % (
                    args.nome, args.servico.upper(), args.caracteristica.upper()))
                print("No celular: abra a página, toque em Conectar e escolha '%s'." % args.nome)
                print("Ctrl+C para sair.\n")
        return ok

    obj = bus.get_object(BLUEZ, adaptador)
    dbus.Interface(obj, GATT_MANAGER).RegisterApplication(
        aplicacao.path, {}, reply_handler=ao_registrar("gatt"),
        error_handler=falhou("o serviço GATT"))
    dbus.Interface(obj, ADV_MANAGER).RegisterAdvertisement(
        anuncio.path, {}, reply_handler=ao_registrar("anuncio"),
        error_handler=falhou("o anúncio"))

    def ao_mudar_propriedade(interface, mudou, _invalidou, path=None):
        if interface == DEVICE_IFACE and "Connected" in mudou:
            if mudou["Connected"]:
                painel.dispositivo_conectou(str(path))
            else:
                painel.dispositivo_desconectou(str(path))

    bus.add_signal_receiver(
        ao_mudar_propriedade, dbus_interface=PROP_IFACE, signal_name="PropertiesChanged",
        path_keyword="path")

    GLib.timeout_add(100, painel.tique)
    try:
        laco.run()
    except KeyboardInterrupt:
        pass
    finally:
        print("\nEncerrando.")
        for chamada in (
            lambda: dbus.Interface(obj, ADV_MANAGER).UnregisterAdvertisement(anuncio.path),
            lambda: dbus.Interface(obj, GATT_MANAGER).UnregisterApplication(aplicacao.path),
        ):
            try:
                chamada()
            except dbus.exceptions.DBusException:
                pass
        if arquivo_csv:
            arquivo_csv.close()


if __name__ == "__main__":
    try:
        principal()
    except Falha as erro:
        print("Erro:", erro, file=sys.stderr)
        sys.exit(1)
