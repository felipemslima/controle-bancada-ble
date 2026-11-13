"""Protocolo do controle remoto, versão 3 (um byte por mensagem).

Espelho de src/dominio/protocolo.js e de firmware/rc_byte.c. Só biblioteca
padrão. Veja PROTOCOLO.md.
"""

CONECTAR = 0xFF
DESCONECTAR = 0x00
CENTRO = 8
TIMEOUT_MS = 250  # RC_TIMEOUT_MS do firmware


def eh_posicao(byte):
    return 0x01 <= byte <= 0xFE


def decodificar(byte):
    """Traduz um byte (sem estado).

    Devolve ("conectar",), ("desconectar",) ou ("posicao", pitch, roll) com
    níveis de -8 a +7.
    """
    if byte == CONECTAR:
        return ("conectar",)
    if byte == DESCONECTAR:
        return ("desconectar",)
    return ("posicao", (byte >> 4) - CENTRO, (byte & 0x0F) - CENTRO)


def codificar_posicao(pitch, roll):
    """Monta o byte como a página: satura em -7..+7 e troca 0xFF por 0xEE."""
    def nibble(nivel):
        return max(-7, min(7, int(nivel))) + CENTRO

    byte = (nibble(pitch) << 4) | nibble(roll)
    return 0xEE if byte == CONECTAR else byte


class Receptor:
    """Receptor de referência (seção 5 do PROTOCOLO.md), igual ao rc_byte.c."""

    def __init__(self):
        self.conectado = False
        self.pitch = 0
        self.roll = 0
        self.ultimo_ms = 0.0

    def processar(self, byte, agora_ms):
        """Devolve True se o byte foi aceito, False se foi ignorado."""
        if byte == DESCONECTAR:
            self._zerar()
            self.conectado = False
            return True
        if byte == CONECTAR:
            self._zerar()
            self.conectado = True
            self.ultimo_ms = agora_ms
            return True
        if not self.conectado:
            return False
        _, self.pitch, self.roll = decodificar(byte)
        self.ultimo_ms = agora_ms
        return True

    def tick(self, agora_ms):
        """Failsafe por timeout. Devolve True se disparou agora."""
        if self.conectado and agora_ms - self.ultimo_ms > TIMEOUT_MS:
            self._zerar()
            self.conectado = False
            return True
        return False

    def _zerar(self):
        self.pitch = 0
        self.roll = 0


def descrever(byte):
    """Texto curto para um byte, ex.: 'posição pitch +3 roll -3'."""
    msg = decodificar(byte)
    if msg[0] == "conectar":
        return "CONECTAR"
    if msg[0] == "desconectar":
        return "DESCONECTAR/PARAR"
    return "pitch %+d roll %+d" % (msg[1], msg[2])
