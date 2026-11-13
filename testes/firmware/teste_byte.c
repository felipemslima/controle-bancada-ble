/*
 * teste_byte.c - Testes do protocolo de um byte, para rodar no Linux.
 *
 * Modos:
 *   (sem argumentos)  roda os testes unitários; sai com 0 se todos passam.
 *   decodificar       lê bytes da entrada padrão e imprime uma linha por
 *                     byte: "tipo pitch roll" (tipo: 0 posição, 1 conectar,
 *                     2 desconectar, 3 reservado).
 *
 * O modo decodificar é usado pelo teste cruzado com o JavaScript
 * (testes/cruzado.test.js).
 */
#include <stdio.h>
#include <string.h>

#include "../../firmware/rc_byte.h"

static int falhas = 0;

#define CONFERIR(condicao)                                                  \
    do {                                                                    \
        if (!(condicao)) {                                                  \
            printf("FALHOU %s:%d: %s\n", __FILE__, __LINE__, #condicao);    \
            falhas++;                                                       \
        }                                                                   \
    } while (0)

static void teste_decodificar(void)
{
    rc_mensagem_t m;

    m = rc_decodificar(0xF0);
    CONFERIR(m.tipo == RC_MSG_CONECTAR && m.pitch == 0 && m.roll == 0);
    m = rc_decodificar(0xFF);
    CONFERIR(m.tipo == RC_MSG_DESCONECTAR);
    m = rc_decodificar(0x77);
    CONFERIR(m.tipo == RC_MSG_POSICAO && m.pitch == 0 && m.roll == 0);
    m = rc_decodificar(0xE0);
    CONFERIR(m.tipo == RC_MSG_POSICAO && m.pitch == 7 && m.roll == -7);
    m = rc_decodificar(0x0E);
    CONFERIR(m.tipo == RC_MSG_POSICAO && m.pitch == -7 && m.roll == 7);
    m = rc_decodificar(0x00);
    CONFERIR(m.tipo == RC_MSG_POSICAO && m.pitch == -7 && m.roll == -7);
    m = rc_decodificar(0xF3);
    CONFERIR(m.tipo == RC_MSG_RESERVADO);
    m = rc_decodificar(0x3F);
    CONFERIR(m.tipo == RC_MSG_RESERVADO);
}

static void teste_todas_as_posicoes(void)
{
    /* Nenhuma das 225 posições colide com um byte especial ou reservado. */
    for (int p = -7; p <= 7; p++) {
        for (int r = -7; r <= 7; r++) {
            uint8_t b = rc_codificar_posicao((int8_t)p, (int8_t)r);
            rc_mensagem_t m = rc_decodificar(b);
            CONFERIR(b != RC_BYTE_CONECTAR && b != RC_BYTE_DESCONECTAR);
            CONFERIR(m.tipo == RC_MSG_POSICAO && m.pitch == p && m.roll == r);
        }
    }
    /* Níveis fora da faixa são saturados. */
    CONFERIR(rc_codificar_posicao(100, -100) == 0xE0);
}

static void teste_receptor(void)
{
    rc_receptor_t r;

    rc_receptor_iniciar(&r);
    CONFERIR(!r.conectado && r.pitch == 0 && r.roll == 0);

    /* Posição antes de conectar é ignorada. */
    CONFERIR(!rc_receptor_processar(&r, 0xE7, 0));
    CONFERIR(r.pitch == 0 && r.ignorados == 1);

    /* Conectar, depois posição. */
    CONFERIR(rc_receptor_processar(&r, 0xF0, 0));
    CONFERIR(r.conectado);
    CONFERIR(rc_receptor_processar(&r, 0xA4, 10));
    CONFERIR(r.pitch == 3 && r.roll == -3);

    /* Conectar repetido não mexe nos níveis. */
    CONFERIR(rc_receptor_processar(&r, 0xF0, 20));
    CONFERIR(r.pitch == 3 && r.roll == -3);

    /* Reservado é ignorado e não muda nada. */
    CONFERIR(!rc_receptor_processar(&r, 0xF5, 30));
    CONFERIR(r.conectado && r.pitch == 3);

    /* Desconectar zera e passa a ignorar posições. */
    CONFERIR(rc_receptor_processar(&r, 0xFF, 40));
    CONFERIR(!r.conectado && r.pitch == 0 && r.roll == 0);
    CONFERIR(!rc_receptor_processar(&r, 0xA4, 50));
    CONFERIR(r.pitch == 0);
}

static void teste_failsafe(void)
{
    rc_receptor_t r;
    uint32_t t0 = 0xFFFFFF00u; /* perto da volta do relógio de 32 bits */

    rc_receptor_iniciar(&r);
    CONFERIR(rc_receptor_processar(&r, 0xF0, t0));
    CONFERIR(rc_receptor_processar(&r, 0xE7, t0));

    /* Dentro do prazo, mesmo com o relógio dando a volta: segue conectado. */
    rc_receptor_tick(&r, t0 + RC_TIMEOUT_MS);
    CONFERIR(r.conectado && r.pitch == 7);

    /* Bytes reservados não alimentam o watchdog. */
    CONFERIR(!rc_receptor_processar(&r, 0xF7, t0 + 200u));

    /* Passou do prazo: desconecta e zera. */
    rc_receptor_tick(&r, t0 + RC_TIMEOUT_MS + 1u);
    CONFERIR(!r.conectado && r.failsafe && r.pitch == 0);

    /* Posições que chegarem depois são ignoradas até um novo conectar. */
    CONFERIR(!rc_receptor_processar(&r, 0xE7, t0 + 300u));
    CONFERIR(!r.conectado && r.pitch == 0);
    CONFERIR(rc_receptor_processar(&r, 0xF0, t0 + 310u));
    CONFERIR(r.conectado && !r.failsafe && r.pitch == 0);

    /* Desconectado, o tick não faz nada. */
    CONFERIR(rc_receptor_processar(&r, 0xFF, t0 + 320u));
    rc_receptor_tick(&r, t0 + 5000u);
    CONFERIR(!r.conectado && !r.failsafe);
}

static int modo_decodificar(void)
{
    int c;
    while ((c = getchar()) != EOF) {
        rc_mensagem_t m = rc_decodificar((uint8_t)c);
        printf("%d %d %d\n", (int)m.tipo, (int)m.pitch, (int)m.roll);
    }
    return 0;
}

int main(int argc, char **argv)
{
    if (argc == 2 && strcmp(argv[1], "decodificar") == 0) {
        return modo_decodificar();
    }

    teste_decodificar();
    teste_todas_as_posicoes();
    teste_receptor();
    teste_failsafe();

    if (falhas == 0) {
        printf("firmware: todos os testes passaram\n");
        return 0;
    }
    printf("firmware: %d verificacao(oes) falharam\n", falhas);
    return 1;
}
