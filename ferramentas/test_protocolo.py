import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import protocolo as p  # noqa: E402


class TesteDecodificar(unittest.TestCase):
    def test_exemplos_da_especificacao(self):
        # PROTOCOLO.md, seção 2
        casos = {
            0x88: (0, 0), 0xF8: (7, 0), 0x18: (-7, 0), 0x8F: (0, 7),
            0x81: (0, -7), 0xB5: (3, -3), 0xEE: (6, 6), 0x01: (-8, -7),
        }
        for byte, (pitch, roll) in casos.items():
            self.assertEqual(p.decodificar(byte), ("posicao", pitch, roll), hex(byte))

    def test_especiais(self):
        self.assertEqual(p.decodificar(0xFF), ("conectar",))
        self.assertEqual(p.decodificar(0x00), ("desconectar",))

    def test_254_posicoes_e_2_especiais(self):
        tipos = [p.decodificar(b)[0] for b in range(256)]
        self.assertEqual(tipos.count("posicao"), 254)
        self.assertEqual(tipos.count("conectar"), 1)
        self.assertEqual(tipos.count("desconectar"), 1)

    def test_codificar_satura_e_troca_ff(self):
        self.assertEqual(p.codificar_posicao(0, 0), 0x88)
        self.assertEqual(p.codificar_posicao(3, -3), 0xB5)
        self.assertEqual(p.codificar_posicao(99, 0), 0xF8)
        self.assertEqual(p.codificar_posicao(-99, 0), 0x18)
        self.assertEqual(p.codificar_posicao(7, 7), 0xEE)  # nunca 0xFF

    def test_ida_e_volta(self):
        for pitch in range(-7, 8):
            for roll in range(-7, 8):
                byte = p.codificar_posicao(pitch, roll)
                if (pitch, roll) == (7, 7):
                    continue
                self.assertEqual(p.decodificar(byte), ("posicao", pitch, roll))


class TesteReceptor(unittest.TestCase):
    def test_ignora_posicao_antes_de_conectar(self):
        r = p.Receptor()
        self.assertFalse(r.processar(0xB5, 0))
        self.assertEqual((r.pitch, r.roll), (0, 0))

    def test_conecta_e_segue_posicao(self):
        r = p.Receptor()
        self.assertTrue(r.processar(0xFF, 0))
        self.assertTrue(r.processar(0xB5, 10))
        self.assertTrue(r.conectado)
        self.assertEqual((r.pitch, r.roll), (3, -3))

    def test_ff_repetido_nao_muda_nada(self):
        r = p.Receptor()
        r.processar(0xFF, 0)
        r.processar(0xFF, 5)
        self.assertTrue(r.conectado)
        self.assertEqual((r.pitch, r.roll), (0, 0))

    def test_zero_sempre_vale(self):
        r = p.Receptor()
        r.processar(0xFF, 0)
        r.processar(0xB5, 10)
        self.assertTrue(r.processar(0x00, 20))
        self.assertFalse(r.conectado)
        self.assertEqual((r.pitch, r.roll), (0, 0))
        self.assertTrue(r.processar(0x00, 30))  # também desconectado

    def test_failsafe_por_timeout_exige_novo_ff(self):
        r = p.Receptor()
        r.processar(0xFF, 0)
        r.processar(0xB5, 100)
        self.assertFalse(r.tick(300))   # 200 ms: ainda vale
        self.assertTrue(r.tick(351))    # > 250 ms: dispara
        self.assertFalse(r.conectado)
        self.assertEqual((r.pitch, r.roll), (0, 0))
        self.assertFalse(r.processar(0xB5, 400))  # ignorada até novo 0xFF
        self.assertTrue(r.processar(0xFF, 410))
        self.assertTrue(r.processar(0xB5, 420))


if __name__ == "__main__":
    unittest.main()
