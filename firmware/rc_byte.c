/*
 * rc_byte.c - Implementação do protocolo de um byte.
 * Ver rc_byte.h e PROTOCOLO.md.
 */
#include "rc_byte.h"

rc_mensagem_t rc_decodificar(uint8_t byte)
{
    rc_mensagem_t m;
    uint8_t alto = (uint8_t)(byte >> 4);
    uint8_t baixo = (uint8_t)(byte & 0x0Fu);

    m.pitch = 0;
    m.roll = 0;
    if (byte == RC_BYTE_CONECTAR) {
        m.tipo = RC_MSG_CONECTAR;
    } else if (byte == RC_BYTE_DESCONECTAR) {
        m.tipo = RC_MSG_DESCONECTAR;
    } else {
        m.tipo = RC_MSG_POSICAO;
        m.pitch = (int8_t)((int)alto - RC_CENTRO);
        m.roll = (int8_t)((int)baixo - RC_CENTRO);
    }
    return m;
}

static uint8_t nibble(int8_t nivel)
{
    if (nivel > RC_NIVEIS_POR_LADO) {
        nivel = RC_NIVEIS_POR_LADO;
    } else if (nivel < -RC_NIVEIS_POR_LADO) {
        nivel = -RC_NIVEIS_POR_LADO;
    }
    return (uint8_t)(RC_CENTRO + nivel);
}

uint8_t rc_codificar_posicao(int8_t pitch, int8_t roll)
{
    uint8_t byte = (uint8_t)((uint8_t)(nibble(pitch) << 4) | nibble(roll));
    return byte == RC_BYTE_CONECTAR ? (uint8_t)0xEEu : byte;
}

static void desconectar(rc_receptor_t *r)
{
    r->conectado = false;
    r->pitch = 0;
    r->roll = 0;
}

void rc_receptor_iniciar(rc_receptor_t *r)
{
    desconectar(r);
    r->failsafe = false;
    r->ultimo_ms = 0;
    r->ignorados = 0;
}

bool rc_receptor_processar(rc_receptor_t *r, uint8_t byte, uint32_t agora_ms)
{
    rc_mensagem_t m = rc_decodificar(byte);

    switch (m.tipo) {
    case RC_MSG_DESCONECTAR:
        /* Direção segura: vale sempre. */
        desconectar(r);
        r->failsafe = false;
        break;
    case RC_MSG_CONECTAR:
        /* Conecta com tudo no centro; repetido não muda nada. */
        if (!r->conectado) {
            r->pitch = 0;
            r->roll = 0;
        }
        r->conectado = true;
        r->failsafe = false;
        break;
    case RC_MSG_POSICAO:
        if (!r->conectado) {
            /* Posição antes de conectar (ou depois de um failsafe). */
            r->ignorados++;
            return false;
        }
        r->pitch = m.pitch;
        r->roll = m.roll;
        break;
    }
    r->ultimo_ms = agora_ms;
    return true;
}

void rc_receptor_tick(rc_receptor_t *r, uint32_t agora_ms)
{
    /* A subtração sem sinal continua correta quando o relógio dá a volta. */
    if (r->conectado && (uint32_t)(agora_ms - r->ultimo_ms) > RC_TIMEOUT_MS) {
        desconectar(r);
        r->failsafe = true;
    }
}
