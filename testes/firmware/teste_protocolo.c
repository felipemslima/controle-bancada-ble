/*
 * teste_protocolo.c - Testes do parser e do receptor, para rodar no Linux.
 *
 * Modos:
 *   (sem argumentos)  roda os testes unitários; sai com 0 se todos passam.
 *   decodificar       lê bytes da entrada padrão e imprime um pacote por
 *                     linha: "tipo seq flags roll pitch yaw throttle".
 *   codificar t s f r p y th   imprime os 15 bytes do pacote em hex.
 *
 * Os dois últimos modos são usados pelo teste cruzado com o JavaScript
 * (testes/cruzado.test.js).
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "../../firmware/rc_protocolo.h"

static int falhas = 0;

#define CONFERIR(condicao)                                                  \
    do {                                                                    \
        if (!(condicao)) {                                                  \
            printf("FALHOU %s:%d: %s\n", __FILE__, __LINE__, #condicao);    \
            falhas++;                                                       \
        }                                                                   \
    } while (0)

static rc_pacote_t comando(uint8_t seq, uint8_t flags, int16_t roll,
                           int16_t pitch, int16_t yaw, uint16_t throttle)
{
    rc_pacote_t p;
    p.tipo = RC_TIPO_COMANDO;
    p.seq = seq;
    p.flags = flags;
    p.roll = roll;
    p.pitch = pitch;
    p.yaw = yaw;
    p.throttle = throttle;
    return p;
}

/* Alimenta o parser e conta os pacotes; guarda o último em *ultimo. */
static int alimentar(rc_parser_t *parser, const uint8_t *bytes, size_t n,
                     rc_pacote_t *ultimo)
{
    int pacotes = 0;
    for (size_t i = 0; i < n; i++) {
        if (rc_parser_alimentar(parser, bytes[i], ultimo)) {
            pacotes++;
        }
    }
    return pacotes;
}

static void teste_crc(void)
{
    const uint8_t texto[] = {'1', '2', '3', '4', '5', '6', '7', '8', '9'};
    CONFERIR(rc_crc16(texto, 9) == 0x29B1u);
}

static void teste_vetor_de_referencia(void)
{
    /* Mesmo vetor de PROTOCOLO.md e de testes/protocolo.test.js. */
    const uint8_t esperado[RC_TAMANHO_PACOTE] = {
        0xA5, 0x5A, 0x01, 0x2A, 0x05, 0x0C, 0xFE, 0xDC,
        0x05, 0xB8, 0x0B, 0xFA, 0x00, 0x08, 0x2E};
    uint8_t bytes[RC_TAMANHO_PACOTE];
    rc_pacote_t p = comando(42, RC_FLAG_ARMADO | RC_FLAG_YAW_TAXA, -500, 1500,
                            3000, 250);
    rc_pacote_t lido;
    rc_parser_t parser;

    rc_codificar(&p, bytes);
    CONFERIR(memcmp(bytes, esperado, RC_TAMANHO_PACOTE) == 0);

    rc_parser_iniciar(&parser);
    CONFERIR(alimentar(&parser, esperado, RC_TAMANHO_PACOTE, &lido) == 1);
    CONFERIR(lido.tipo == RC_TIPO_COMANDO && lido.seq == 42);
    CONFERIR(lido.flags == (RC_FLAG_ARMADO | RC_FLAG_YAW_TAXA));
    CONFERIR(lido.roll == -500 && lido.pitch == 1500 && lido.yaw == 3000);
    CONFERIR(lido.throttle == 250);
}

static void teste_ressincronismo(void)
{
    uint8_t a[RC_TAMANHO_PACOTE], b[RC_TAMANHO_PACOTE];
    uint8_t fluxo[128];
    size_t n = 0;
    rc_pacote_t pa = comando(1, RC_FLAG_ARMADO, 100, -200, 300, 400);
    rc_pacote_t pb = comando(2, RC_FLAG_ARMADO, -32768, 32767, -1, 1000);
    rc_pacote_t lido;
    rc_parser_t parser;

    rc_codificar(&pa, a);
    rc_codificar(&pb, b);

    /* Lixo, inclusive um falso cabeçalho, antes de um pacote bom. */
    rc_parser_iniciar(&parser);
    fluxo[n++] = 0x00;
    fluxo[n++] = 0xA5;
    fluxo[n++] = 0x5A;
    fluxo[n++] = 0xA5;
    fluxo[n++] = 0xFF;
    memcpy(&fluxo[n], a, RC_TAMANHO_PACOTE);
    n += RC_TAMANHO_PACOTE;
    CONFERIR(alimentar(&parser, fluxo, n, &lido) == 1);
    CONFERIR(lido.seq == 1 && lido.yaw == 300);

    /* Pacote truncado (bytes perdidos) seguido de um pacote bom. */
    rc_parser_iniciar(&parser);
    n = 0;
    memcpy(&fluxo[n], a, 9);
    n += 9;
    memcpy(&fluxo[n], b, RC_TAMANHO_PACOTE);
    n += RC_TAMANHO_PACOTE;
    CONFERIR(alimentar(&parser, fluxo, n, &lido) == 1);
    CONFERIR(lido.seq == 2 && lido.roll == -32768 && lido.pitch == 32767);

    /* Pacote corrompido: é descartado e o seguinte é aceito. */
    rc_parser_iniciar(&parser);
    n = 0;
    memcpy(&fluxo[n], a, RC_TAMANHO_PACOTE);
    fluxo[6] ^= 0x10;
    n += RC_TAMANHO_PACOTE;
    memcpy(&fluxo[n], b, RC_TAMANHO_PACOTE);
    n += RC_TAMANHO_PACOTE;
    CONFERIR(alimentar(&parser, fluxo, n, &lido) == 1);
    CONFERIR(lido.seq == 2);
    CONFERIR(parser.erros_crc >= 1);

    /* Dois pacotes bons colados. */
    rc_parser_iniciar(&parser);
    memcpy(&fluxo[0], a, RC_TAMANHO_PACOTE);
    memcpy(&fluxo[RC_TAMANHO_PACOTE], b, RC_TAMANHO_PACOTE);
    CONFERIR(alimentar(&parser, fluxo, 2 * RC_TAMANHO_PACOTE, &lido) == 2);
    CONFERIR(parser.bytes_descartados == 0);
}

/* Leva o receptor a "armado", com seq 1 (desarmado) e 2 (armado). */
static void armar(rc_receptor_t *r, uint32_t agora)
{
    rc_pacote_t p = comando(1, 0, 0, 0, 0, 0);
    CONFERIR(rc_receptor_processar(r, &p, agora));
    p = comando(2, RC_FLAG_ARMADO, 0, 0, 0, 0);
    CONFERIR(rc_receptor_processar(r, &p, agora));
    CONFERIR(r->sp.armado);
}

static void teste_receptor_armar(void)
{
    rc_receptor_t r;
    rc_pacote_t p;

    rc_receptor_iniciar(&r);
    CONFERIR(!r.sp.armado && r.trava && r.failsafe);

    /* Começa travado: armado direto é recusado. */
    p = comando(1, RC_FLAG_ARMADO, 0, 0, 0, 0);
    CONFERIR(!rc_receptor_processar(&r, &p, 0));
    CONFERIR(!r.sp.armado);

    /* Desarmado e zerado libera a trava. */
    p = comando(2, 0, 0, 0, 0, 0);
    CONFERIR(rc_receptor_processar(&r, &p, 0));
    CONFERIR(!r.trava && !r.failsafe);

    /* Armar com valores diferentes de zero é recusado. */
    p = comando(3, RC_FLAG_ARMADO, 100, 0, 0, 0);
    CONFERIR(!rc_receptor_processar(&r, &p, 0));
    CONFERIR(!r.sp.armado && r.sp.roll == 0);

    /* Armar com zeros funciona; depois os valores passam. */
    p = comando(4, RC_FLAG_ARMADO, 0, 0, 0, 0);
    CONFERIR(rc_receptor_processar(&r, &p, 0));
    p = comando(5, RC_FLAG_ARMADO | RC_FLAG_YAW_TAXA, 500, -700, 900, 300);
    CONFERIR(rc_receptor_processar(&r, &p, 0));
    CONFERIR(r.sp.armado && r.sp.yaw_eh_taxa);
    CONFERIR(r.sp.roll == 500 && r.sp.pitch == -700 && r.sp.yaw == 900);
    CONFERIR(r.sp.throttle == 300);
}

static void teste_receptor_limites(void)
{
    rc_receptor_t r;
    rc_pacote_t p;

    rc_receptor_iniciar(&r);
    armar(&r, 0);
    p = comando(3, RC_FLAG_ARMADO, 32767, -32768, 32767, 65535);
    CONFERIR(rc_receptor_processar(&r, &p, 0));
    CONFERIR(r.sp.roll == RC_LIMITE_ROLL_PITCH);
    CONFERIR(r.sp.pitch == -RC_LIMITE_ROLL_PITCH);
    CONFERIR(r.sp.yaw == RC_LIMITE_YAW);
    CONFERIR(r.sp.throttle == RC_LIMITE_THROTTLE);
}

static void teste_receptor_parada(void)
{
    rc_receptor_t r;
    rc_pacote_t p;

    rc_receptor_iniciar(&r);
    armar(&r, 0);
    p = comando(3, RC_FLAG_ARMADO, 500, 500, 500, 500);
    CONFERIR(rc_receptor_processar(&r, &p, 0));

    /* Parada vale mesmo com sequência antiga e com a flag de armado. */
    p = comando(1, RC_FLAG_PARADA | RC_FLAG_ARMADO, 500, 500, 500, 500);
    CONFERIR(rc_receptor_processar(&r, &p, 0));
    CONFERIR(!r.sp.armado && r.trava);
    CONFERIR(r.sp.roll == 0 && r.sp.pitch == 0 && r.sp.yaw == 0);
    CONFERIR(r.sp.throttle == 0);

    /* Um pacote armado atrasado NÃO rearma depois da parada. */
    p = comando(4, RC_FLAG_ARMADO, 0, 0, 0, 0);
    CONFERIR(!rc_receptor_processar(&r, &p, 0));
    CONFERIR(!r.sp.armado);

    /* Desarmado com valores não libera a trava. */
    p = comando(5, 0, 10, 0, 0, 0);
    CONFERIR(!rc_receptor_processar(&r, &p, 0));
    CONFERIR(r.trava);

    /* Só desarmado e zerado libera; então dá para armar de novo. */
    p = comando(6, 0, 0, 0, 0, 0);
    CONFERIR(rc_receptor_processar(&r, &p, 0));
    p = comando(7, RC_FLAG_ARMADO, 0, 0, 0, 0);
    CONFERIR(rc_receptor_processar(&r, &p, 0));
    CONFERIR(r.sp.armado);
}

static void teste_receptor_sequencia(void)
{
    rc_receptor_t r;
    rc_pacote_t p;

    rc_receptor_iniciar(&r);
    armar(&r, 0);
    p = comando(10, RC_FLAG_ARMADO, 100, 0, 0, 0);
    CONFERIR(rc_receptor_processar(&r, &p, 0));

    /* Repetido e antigo são recusados e não mudam os setpoints. */
    p = comando(10, RC_FLAG_ARMADO, 999, 0, 0, 0);
    CONFERIR(!rc_receptor_processar(&r, &p, 0));
    p = comando(9, RC_FLAG_ARMADO, 999, 0, 0, 0);
    CONFERIR(!rc_receptor_processar(&r, &p, 0));
    CONFERIR(r.sp.roll == 100);

    /* A sequência dá a volta em 255 -> 0. */
    p = comando(255, RC_FLAG_ARMADO, 200, 0, 0, 0);
    CONFERIR(!rc_receptor_processar(&r, &p, 0)); /* 245 à frente: antigo */
    p = comando(120, RC_FLAG_ARMADO, 200, 0, 0, 0);
    CONFERIR(rc_receptor_processar(&r, &p, 0));
    p = comando(240, RC_FLAG_ARMADO, 300, 0, 0, 0);
    CONFERIR(rc_receptor_processar(&r, &p, 0));
    p = comando(3, RC_FLAG_ARMADO, 400, 0, 0, 0);
    CONFERIR(rc_receptor_processar(&r, &p, 0));
    CONFERIR(r.sp.roll == 400);

    /* Tipo errado e flags reservadas são recusados. */
    p = comando(4, RC_FLAG_ARMADO, 0, 0, 0, 0);
    p.tipo = RC_TIPO_TELEMETRIA;
    CONFERIR(!rc_receptor_processar(&r, &p, 0));
    p = comando(4, RC_FLAG_ARMADO | 0x80u, 0, 0, 0, 0);
    CONFERIR(!rc_receptor_processar(&r, &p, 0));
}

static void teste_receptor_failsafe(void)
{
    rc_receptor_t r;
    rc_pacote_t p;
    uint32_t t0 = 0xFFFFFF00u; /* perto da volta do relógio de 32 bits */

    rc_receptor_iniciar(&r);
    armar(&r, t0);
    p = comando(3, RC_FLAG_ARMADO, 500, 0, 0, 200);
    CONFERIR(rc_receptor_processar(&r, &p, t0));

    /* Dentro do prazo, mesmo com o relógio dando a volta: segue armado. */
    rc_receptor_tick(&r, t0 + RC_TIMEOUT_MS);
    CONFERIR(r.sp.armado && r.sp.roll == 500);

    /* Passou do prazo: zera, desarma e trava. */
    rc_receptor_tick(&r, t0 + RC_TIMEOUT_MS + 1u);
    CONFERIR(!r.sp.armado && r.failsafe && r.trava);
    CONFERIR(r.sp.roll == 0 && r.sp.throttle == 0);

    /* O controle voltou ainda "armado": não rearma sozinho. */
    p = comando(4, RC_FLAG_ARMADO, 0, 0, 0, 0);
    CONFERIR(!rc_receptor_processar(&r, &p, t0 + 400u));
    CONFERIR(!r.sp.armado);

    /* Pacotes recusados não alimentam o watchdog. */
    rc_receptor_tick(&r, t0 + 401u);
    CONFERIR(r.failsafe);

    /* Desarmar e armar de novo recupera. */
    p = comando(5, 0, 0, 0, 0, 0);
    CONFERIR(rc_receptor_processar(&r, &p, t0 + 500u));
    CONFERIR(!r.failsafe && !r.trava);
    p = comando(6, RC_FLAG_ARMADO, 0, 0, 0, 0);
    CONFERIR(rc_receptor_processar(&r, &p, t0 + 510u));
    CONFERIR(r.sp.armado);
}

static void teste_telemetria(void)
{
    rc_receptor_t r;
    rc_parser_t parser;
    rc_pacote_t lido;
    uint8_t bytes[RC_TAMANHO_PACOTE];

    rc_receptor_iniciar(&r);
    rc_montar_telemetria(&r, 7, -123, 456, -789, 0, bytes);
    rc_parser_iniciar(&parser);
    CONFERIR(alimentar(&parser, bytes, RC_TAMANHO_PACOTE, &lido) == 1);
    CONFERIR(lido.tipo == RC_TIPO_TELEMETRIA && lido.seq == 7);
    CONFERIR(lido.flags == (RC_FLAG_PARADA | RC_FLAG_FAILSAFE));
    CONFERIR(lido.roll == -123 && lido.pitch == 456 && lido.yaw == -789);

    armar(&r, 0);
    rc_montar_telemetria(&r, 8, 0, 0, 0, 100, bytes);
    CONFERIR(alimentar(&parser, bytes, RC_TAMANHO_PACOTE, &lido) == 1);
    CONFERIR(lido.flags == RC_FLAG_ARMADO && lido.throttle == 100);
}

static int modo_decodificar(void)
{
    rc_parser_t parser;
    rc_pacote_t p;
    int c;

    rc_parser_iniciar(&parser);
    while ((c = getchar()) != EOF) {
        if (rc_parser_alimentar(&parser, (uint8_t)c, &p)) {
            printf("%u %u %u %d %d %d %u\n", (unsigned)p.tipo, (unsigned)p.seq,
                   (unsigned)p.flags, (int)p.roll, (int)p.pitch, (int)p.yaw,
                   (unsigned)p.throttle);
        }
    }
    return 0;
}

static int modo_codificar(char **argv)
{
    rc_pacote_t p;
    uint8_t bytes[RC_TAMANHO_PACOTE];

    p.tipo = (uint8_t)atoi(argv[0]);
    p.seq = (uint8_t)atoi(argv[1]);
    p.flags = (uint8_t)atoi(argv[2]);
    p.roll = (int16_t)atoi(argv[3]);
    p.pitch = (int16_t)atoi(argv[4]);
    p.yaw = (int16_t)atoi(argv[5]);
    p.throttle = (uint16_t)atoi(argv[6]);
    rc_codificar(&p, bytes);
    for (unsigned i = 0; i < RC_TAMANHO_PACOTE; i++) {
        printf("%02X", (unsigned)bytes[i]);
    }
    printf("\n");
    return 0;
}

int main(int argc, char **argv)
{
    if (argc == 2 && strcmp(argv[1], "decodificar") == 0) {
        return modo_decodificar();
    }
    if (argc == 9 && strcmp(argv[1], "codificar") == 0) {
        return modo_codificar(&argv[2]);
    }

    teste_crc();
    teste_vetor_de_referencia();
    teste_ressincronismo();
    teste_receptor_armar();
    teste_receptor_limites();
    teste_receptor_parada();
    teste_receptor_sequencia();
    teste_receptor_failsafe();
    teste_telemetria();

    if (falhas == 0) {
        printf("firmware: todos os testes passaram\n");
        return 0;
    }
    printf("firmware: %d verificacao(oes) falharam\n", falhas);
    return 1;
}
