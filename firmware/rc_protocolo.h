/*
 * rc_protocolo.h - Protocolo do controle remoto (lado do firmware).
 *
 * Especificação completa: PROTOCOLO.md, na raiz do repositório.
 * Equivalente em JavaScript: src/dominio/protocolo.js.
 *
 * C99, usa apenas <stdint.h> e <stdbool.h>, sem alocação dinâmica.
 * Independe de endianness e de alinhamento: os campos são lidos byte a byte.
 *
 * Duas camadas:
 *   rc_parser_*    enquadramento: bytes da UART -> pacotes com CRC válido.
 *   rc_receptor_*  segurança: pacotes -> setpoints (trava de parada, armar
 *                  só com zeros, limites, failsafe por timeout).
 */
#ifndef RC_PROTOCOLO_H
#define RC_PROTOCOLO_H

#include <stdbool.h>
#include <stdint.h>

#define RC_TAMANHO_PACOTE 15u
#define RC_CABECALHO_0 0xA5u
#define RC_CABECALHO_1 0x5Au

#define RC_TIPO_COMANDO 0x01u
#define RC_TIPO_TELEMETRIA 0x81u

#define RC_FLAG_ARMADO 0x01u   /* comando e telemetria */
#define RC_FLAG_PARADA 0x02u   /* comando: parada; telemetria: trava ativa */
#define RC_FLAG_YAW_TAXA 0x04u /* yaw em centésimos de grau/s */
#define RC_FLAG_FAILSAFE 0x08u /* só telemetria */
#define RC_FLAGS_DE_COMANDO (RC_FLAG_ARMADO | RC_FLAG_PARADA | RC_FLAG_YAW_TAXA)

/*
 * Limites aplicados pelo receptor (saturação). Ajuste ao protótipo definindo
 * as macros na linha de compilação, por exemplo -DRC_LIMITE_ROLL_PITCH=2000.
 */
#ifndef RC_LIMITE_ROLL_PITCH
#define RC_LIMITE_ROLL_PITCH 3000 /* centésimos de grau: +-30,00 graus */
#endif
#ifndef RC_LIMITE_YAW
#define RC_LIMITE_YAW 18000 /* centésimos de grau ou de grau/s */
#endif
#ifndef RC_LIMITE_THROTTLE
#define RC_LIMITE_THROTTLE 1000u /* décimos de %: 100,0 % */
#endif
#ifndef RC_TIMEOUT_MS
#define RC_TIMEOUT_MS 250u /* sem comando válido por esse tempo: failsafe */
#endif

/* Pacote já decodificado, em unidades do protocolo. */
typedef struct {
    uint8_t tipo;
    uint8_t seq;
    uint8_t flags;
    int16_t roll;      /* centésimos de grau */
    int16_t pitch;     /* centésimos de grau */
    int16_t yaw;       /* centésimos de grau, ou de grau/s com RC_FLAG_YAW_TAXA */
    uint16_t throttle; /* 0 a 1000 (décimos de %) */
} rc_pacote_t;

/* ---- Enquadramento ---------------------------------------------------- */

typedef struct {
    uint8_t janela[RC_TAMANHO_PACOTE];
    uint8_t n;
    uint32_t erros_crc;         /* diagnóstico */
    uint32_t bytes_descartados; /* diagnóstico */
} rc_parser_t;

void rc_parser_iniciar(rc_parser_t *p);

/*
 * Alimenta o parser com um byte recebido. Devolve true quando um pacote
 * com CRC válido fica completo; nesse caso *saida é preenchido.
 * Ressincroniza sozinho após lixo, bytes perdidos ou corrompidos.
 */
bool rc_parser_alimentar(rc_parser_t *p, uint8_t byte, rc_pacote_t *saida);

/* CRC-16/CCITT-FALSE: polinômio 0x1021, inicial 0xFFFF, sem reflexão. */
uint16_t rc_crc16(const uint8_t *dados, uint8_t tamanho);

/* Monta os 15 bytes de um pacote (usado para a telemetria). */
void rc_codificar(const rc_pacote_t *pacote, uint8_t saida[RC_TAMANHO_PACOTE]);

/* ---- Segurança -------------------------------------------------------- */

/* Setpoints que o PID deve usar. Zerados sempre que armado == false. */
typedef struct {
    bool armado;
    bool yaw_eh_taxa;
    int16_t roll;
    int16_t pitch;
    int16_t yaw;
    uint16_t throttle;
} rc_setpoints_t;

typedef struct {
    rc_setpoints_t sp;
    bool trava;     /* parada ou failsafe: só sai com pacote desarmado e zerado */
    bool failsafe;  /* sem comando válido há mais de RC_TIMEOUT_MS */
    bool tem_pacote;
    uint8_t ultimo_seq;
    uint32_t ultimo_ms;
    uint32_t rejeitados; /* diagnóstico */
} rc_receptor_t;

/* Começa desarmado, zerado e travado. */
void rc_receptor_iniciar(rc_receptor_t *r);

/*
 * Aplica um pacote recebido. agora_ms é um relógio monotônico em
 * milissegundos (pode dar a volta em 32 bits). Devolve true se aceito.
 */
bool rc_receptor_processar(rc_receptor_t *r, const rc_pacote_t *pacote,
                           uint32_t agora_ms);

/*
 * Chame periodicamente (por exemplo, a cada ciclo do PID). Se passou
 * RC_TIMEOUT_MS sem comando aceito, zera, desarma e trava.
 */
void rc_receptor_tick(rc_receptor_t *r, uint32_t agora_ms);

/* Monta um pacote de telemetria com os valores medidos e o estado atual. */
void rc_montar_telemetria(const rc_receptor_t *r, uint8_t seq,
                          int16_t roll_medido, int16_t pitch_medido,
                          int16_t yaw_medido, uint16_t throttle_aplicado,
                          uint8_t saida[RC_TAMANHO_PACOTE]);

#endif /* RC_PROTOCOLO_H */
