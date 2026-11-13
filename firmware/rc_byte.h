/*
 * rc_byte.h - Protocolo de um byte do controle remoto (lado do firmware).
 *
 * Especificação completa: PROTOCOLO.md, na raiz do repositório.
 * Equivalente em JavaScript: src/dominio/protocolo.js.
 *
 * C99, usa apenas <stdint.h> e <stdbool.h>, sem alocação dinâmica.
 *
 * Cada byte recebido da UART é uma mensagem completa:
 *   0xFF          conectar (libera o controle)
 *   0x00          desconectar / parar
 *   0x01 a 0xFE   posição: nibble alto = pitch, nibble baixo = roll,
 *                 centro 8 (0x88 = parado); nível = nibble - 8 (-8 a +7)
 *
 * Duas camadas:
 *   rc_decodificar  só traduz um byte (sem estado).
 *   rc_receptor_*   segurança: ignora posições antes de conectar e aplica
 *                   o failsafe por timeout.
 */
#ifndef RC_BYTE_H
#define RC_BYTE_H

#include <stdbool.h>
#include <stdint.h>

#define RC_BYTE_CONECTAR 0xFFu
#define RC_BYTE_DESCONECTAR 0x00u
#define RC_CENTRO 8
#define RC_NIVEIS_POR_LADO 7 /* a página envia de -7 a +7 */

#ifndef RC_TIMEOUT_MS
#define RC_TIMEOUT_MS 250u /* sem byte válido por esse tempo: desconecta */
#endif

typedef enum {
    RC_MSG_POSICAO = 0,
    RC_MSG_CONECTAR,
    RC_MSG_DESCONECTAR
} rc_tipo_t;

typedef struct {
    rc_tipo_t tipo;
    int8_t pitch; /* -8 a 7, positivo para cima; 0 fora de RC_MSG_POSICAO */
    int8_t roll;  /* -8 a 7, positivo para a direita; 0 fora de RC_MSG_POSICAO */
} rc_mensagem_t;

/* Traduz um byte. Não guarda estado. */
rc_mensagem_t rc_decodificar(uint8_t byte);

/*
 * Monta o byte de uma posição, como a página faz: níveis saturados em
 * -7..7 e o canto (+7, +7), que daria 0xFF (conectar), trocado por 0xEE.
 */
uint8_t rc_codificar_posicao(int8_t pitch, int8_t roll);

typedef struct {
    bool conectado;   /* só com conectado == true os níveis valem */
    bool failsafe;    /* desconectou por timeout */
    int8_t pitch;     /* nível atual, -8 a 7; 0 quando desconectado */
    int8_t roll;      /* nível atual, -8 a 7; 0 quando desconectado */
    uint32_t ultimo_ms;
    uint32_t ignorados; /* diagnóstico: posições recebidas sem conexão */
} rc_receptor_t;

/* Começa desconectado e zerado. */
void rc_receptor_iniciar(rc_receptor_t *r);

/*
 * Aplica um byte recebido. agora_ms é um relógio monotônico em
 * milissegundos (pode dar a volta em 32 bits). Devolve true se o byte foi
 * aceito; bytes ignorados não contam como sinal de vida.
 */
bool rc_receptor_processar(rc_receptor_t *r, uint8_t byte, uint32_t agora_ms);

/*
 * Chame periodicamente (por exemplo, a cada ciclo do PID). Se passou
 * RC_TIMEOUT_MS sem byte aceito, desconecta e zera.
 */
void rc_receptor_tick(rc_receptor_t *r, uint32_t agora_ms);

#endif /* RC_BYTE_H */
