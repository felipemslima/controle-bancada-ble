/*
 * rc_protocolo.c - Implementação do protocolo do controle remoto.
 * Ver rc_protocolo.h e PROTOCOLO.md.
 */
#include "rc_protocolo.h"

/* ---- Utilitários ------------------------------------------------------ */

uint16_t rc_crc16(const uint8_t *dados, uint8_t tamanho)
{
    uint16_t crc = 0xFFFFu;
    for (uint8_t i = 0; i < tamanho; i++) {
        crc ^= (uint16_t)((uint16_t)dados[i] << 8);
        for (uint8_t bit = 0; bit < 8; bit++) {
            if (crc & 0x8000u) {
                crc = (uint16_t)((uint16_t)(crc << 1) ^ 0x1021u);
            } else {
                crc = (uint16_t)(crc << 1);
            }
        }
    }
    return crc;
}

static uint16_t ler_u16(const uint8_t *b)
{
    return (uint16_t)((uint16_t)b[0] | ((uint16_t)b[1] << 8));
}

static void gravar_u16(uint8_t *b, uint16_t v)
{
    b[0] = (uint8_t)(v & 0xFFu);
    b[1] = (uint8_t)(v >> 8);
}

static int16_t saturar(int16_t v, int16_t limite)
{
    if (v > limite) {
        return limite;
    }
    if (v < (int16_t)-limite) {
        return (int16_t)-limite;
    }
    return v;
}

/* ---- Enquadramento ---------------------------------------------------- */

void rc_parser_iniciar(rc_parser_t *p)
{
    p->n = 0;
    p->erros_crc = 0;
    p->bytes_descartados = 0;
}

static void descartar_primeiro(rc_parser_t *p)
{
    for (uint8_t i = 1; i < p->n; i++) {
        p->janela[i - 1] = p->janela[i];
    }
    p->n--;
    p->bytes_descartados++;
}

static bool alinhado(const rc_parser_t *p)
{
    return p->janela[0] == RC_CABECALHO_0 &&
           (p->n < 2 || p->janela[1] == RC_CABECALHO_1);
}

bool rc_parser_alimentar(rc_parser_t *p, uint8_t byte, rc_pacote_t *saida)
{
    p->janela[p->n++] = byte;

    for (;;) {
        /* Descarta até a janela começar pelo cabeçalho. */
        while (p->n > 0 && !alinhado(p)) {
            descartar_primeiro(p);
        }
        if (p->n < RC_TAMANHO_PACOTE) {
            return false;
        }
        /* O CRC cobre os bytes 2 a 12 (tipo até throttle). */
        if (rc_crc16(&p->janela[2], 11) == ler_u16(&p->janela[13])) {
            saida->tipo = p->janela[2];
            saida->seq = p->janela[3];
            saida->flags = p->janela[4];
            saida->roll = (int16_t)ler_u16(&p->janela[5]);
            saida->pitch = (int16_t)ler_u16(&p->janela[7]);
            saida->yaw = (int16_t)ler_u16(&p->janela[9]);
            saida->throttle = ler_u16(&p->janela[11]);
            p->n = 0;
            return true;
        }
        /*
         * CRC errado: o cabeçalho podia ser coincidência ou o pacote veio
         * corrompido. Descarta um byte só e procura de novo dentro do que
         * já chegou, para não perder um pacote bom que comece no meio.
         */
        p->erros_crc++;
        descartar_primeiro(p);
    }
}

void rc_codificar(const rc_pacote_t *pacote, uint8_t saida[RC_TAMANHO_PACOTE])
{
    saida[0] = RC_CABECALHO_0;
    saida[1] = RC_CABECALHO_1;
    saida[2] = pacote->tipo;
    saida[3] = pacote->seq;
    saida[4] = pacote->flags;
    gravar_u16(&saida[5], (uint16_t)pacote->roll);
    gravar_u16(&saida[7], (uint16_t)pacote->pitch);
    gravar_u16(&saida[9], (uint16_t)pacote->yaw);
    gravar_u16(&saida[11], pacote->throttle);
    gravar_u16(&saida[13], rc_crc16(&saida[2], 11));
}

/* ---- Segurança -------------------------------------------------------- */

static void zerar(rc_receptor_t *r)
{
    r->sp.armado = false;
    r->sp.roll = 0;
    r->sp.pitch = 0;
    r->sp.yaw = 0;
    r->sp.throttle = 0;
}

void rc_receptor_iniciar(rc_receptor_t *r)
{
    zerar(r);
    r->sp.yaw_eh_taxa = false;
    r->trava = true;
    r->failsafe = true;
    r->tem_pacote = false;
    r->ultimo_seq = 0;
    r->ultimo_ms = 0;
    r->rejeitados = 0;
}

static bool tudo_zero(const rc_pacote_t *p)
{
    return p->roll == 0 && p->pitch == 0 && p->yaw == 0 && p->throttle == 0;
}

static void aceitar(rc_receptor_t *r, const rc_pacote_t *p, uint32_t agora_ms)
{
    r->tem_pacote = true;
    r->failsafe = false;
    r->ultimo_seq = p->seq;
    r->ultimo_ms = agora_ms;
}

bool rc_receptor_processar(rc_receptor_t *r, const rc_pacote_t *p,
                           uint32_t agora_ms)
{
    if (p->tipo != RC_TIPO_COMANDO ||
        (p->flags & (uint8_t)~RC_FLAGS_DE_COMANDO) != 0) {
        r->rejeitados++;
        return false;
    }

    /* Parada de emergência: vale sempre, sem nenhuma outra verificação. */
    if (p->flags & RC_FLAG_PARADA) {
        zerar(r);
        r->trava = true;
        aceitar(r, p, agora_ms);
        return true;
    }

    /* Pacote desarmado: desarma sempre (é a direção segura). */
    if (!(p->flags & RC_FLAG_ARMADO)) {
        zerar(r);
        if (!tudo_zero(p)) {
            /* Desarmado com valores é inválido: não libera a trava. */
            r->rejeitados++;
            return false;
        }
        r->trava = false;
        aceitar(r, p, agora_ms);
        return true;
    }

    /* Pacote armado: precisa passar por todas as barreiras. */
    if (r->trava) {
        r->rejeitados++;
        return false;
    }
    if (r->tem_pacote) {
        /* Repetido ou mais antigo que o último aceito. */
        uint8_t avanco = (uint8_t)(p->seq - r->ultimo_seq);
        if (avanco == 0 || avanco > 127u) {
            r->rejeitados++;
            return false;
        }
    }
    if (!r->sp.armado && !tudo_zero(p)) {
        /* Só arma com todos os comandos em zero. */
        r->rejeitados++;
        return false;
    }

    r->sp.armado = true;
    r->sp.yaw_eh_taxa = (p->flags & RC_FLAG_YAW_TAXA) != 0;
    r->sp.roll = saturar(p->roll, RC_LIMITE_ROLL_PITCH);
    r->sp.pitch = saturar(p->pitch, RC_LIMITE_ROLL_PITCH);
    r->sp.yaw = saturar(p->yaw, RC_LIMITE_YAW);
    r->sp.throttle =
        p->throttle > RC_LIMITE_THROTTLE ? (uint16_t)RC_LIMITE_THROTTLE : p->throttle;
    aceitar(r, p, agora_ms);
    return true;
}

void rc_receptor_tick(rc_receptor_t *r, uint32_t agora_ms)
{
    /* A subtração sem sinal continua correta quando o relógio dá a volta. */
    if (r->tem_pacote && (uint32_t)(agora_ms - r->ultimo_ms) <= RC_TIMEOUT_MS) {
        return;
    }
    zerar(r);
    r->trava = true;
    r->failsafe = true;
    r->tem_pacote = false; /* a sequência recomeça após a falha */
}

void rc_montar_telemetria(const rc_receptor_t *r, uint8_t seq,
                          int16_t roll_medido, int16_t pitch_medido,
                          int16_t yaw_medido, uint16_t throttle_aplicado,
                          uint8_t saida[RC_TAMANHO_PACOTE])
{
    rc_pacote_t t;
    t.tipo = RC_TIPO_TELEMETRIA;
    t.seq = seq;
    t.flags = 0;
    if (r->sp.armado) {
        t.flags |= RC_FLAG_ARMADO;
    }
    if (r->trava) {
        t.flags |= RC_FLAG_PARADA;
    }
    if (r->sp.yaw_eh_taxa) {
        t.flags |= RC_FLAG_YAW_TAXA;
    }
    if (r->failsafe) {
        t.flags |= RC_FLAG_FAILSAFE;
    }
    t.roll = roll_medido;
    t.pitch = pitch_medido;
    t.yaw = yaw_medido;
    t.throttle = throttle_aplicado;
    rc_codificar(&t, saida);
}
