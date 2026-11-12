# Protocolo do controle remoto

Especificação do enlace entre a página de controle e a controladora de voo.
Versão 1.

Este documento é para quem vai escrever o firmware. O código de referência
está em [`firmware/rc_protocolo.h`](firmware/rc_protocolo.h) e
[`firmware/rc_protocolo.c`](firmware/rc_protocolo.c), e pode ser usado como
está. O equivalente da página fica em
[`src/dominio/protocolo.js`](src/dominio/protocolo.js).

## 1. Visão geral

```
iPhone/PC (página) ──BLE──> módulo BLE ──UART──> controladora (RISC-V)
                   <──BLE──            <──UART──   (telemetria, opcional)
```

- O módulo BLE (HM-10 ou parecido) funciona como UART transparente: o que a
  página escreve na característica sai na UART, e o que entra na UART volta
  como notificação.
- A página envia um **pacote de comando** a uma taxa fixa (padrão 30 Hz),
  mesmo sem mudança nos valores. Esse envio contínuo é o **heartbeat**.
- O firmware pode enviar **pacotes de telemetria** com o mesmo formato. É
  opcional: a página funciona sem eles.
- Todo pacote tem **15 bytes**, então cabe em uma única escrita BLE (20 bytes
  de carga útil no MTU padrão).
- A 30 Hz são 450 bytes/s. Uma UART a 9600 baud (8N1) transporta 960 bytes/s,
  então a taxa padrão do HM-10 basta. O limite da página é 50 Hz
  (750 bytes/s).

## 2. Formato do pacote

Todos os campos de mais de um byte são **little-endian**.

| Byte | Campo | Tipo | Conteúdo |
|---:|---|---|---|
| 0 | Cabeçalho 0 | `uint8` | Sempre `0xA5` |
| 1 | Cabeçalho 1 | `uint8` | Sempre `0x5A` |
| 2 | Tipo | `uint8` | `0x01` comando (página → firmware), `0x81` telemetria (firmware → página) |
| 3 | Sequência | `uint8` | Contador de 0 a 255 que dá a volta; soma 1 a cada pacote enviado |
| 4 | Flags | `uint8` | Ver a seção 3 |
| 5–6 | Roll | `int16` | Centésimos de grau |
| 7–8 | Pitch | `int16` | Centésimos de grau |
| 9–10 | Yaw | `int16` | Centésimos de grau, ou centésimos de grau por segundo (flag `YAW_TAXA`) |
| 11–12 | Throttle | `uint16` | 0 a 1000, em décimos de por cento (1000 = 100,0 %) |
| 13–14 | CRC | `uint16` | CRC-16/CCITT-FALSE dos bytes 2 a 12 |

### Unidades e sinais

- **Roll, pitch e yaw**: inteiro com sinal, 1 unidade = 0,01°. Exemplo:
  `1500` = 15,00°; `-500` = −5,00°.
- **Sentido positivo, como a página envia**: pitch positivo = joystick para a
  frente; yaw positivo = joystick para a direita; roll positivo = deslizante
  para a direita. Se a convenção do PID for outra, cada eixo pode ser
  invertido nos ajustes da página, sem mexer no firmware.
- **Throttle**: sem sinal, 0 = motores no mínimo.
- No pacote de **comando**, os campos são os setpoints pedidos. No pacote de
  **telemetria**, são os valores medidos (ângulos) e o throttle aplicado.

### CRC

CRC-16/CCITT-FALSE: polinômio `0x1021`, valor inicial `0xFFFF`, sem reflexão
de entrada ou saída, sem XOR final. Valor de conferência: o CRC de
`"123456789"` (ASCII) é `0x29B1`.

O CRC cobre os 11 bytes do tipo ao throttle (bytes 2 a 12). O cabeçalho fica
de fora porque é constante.

### Pacote de exemplo

Comando armado, sequência 42, yaw em taxa, roll −5,00°, pitch +15,00°,
yaw +30,00 °/s, throttle 25,0 %:

```
A5 5A 01 2A 05 0C FE DC 05 B8 0B FA 00 08 2E
│     │  │  │  └─┬─┘ └─┬─┘ └─┬─┘ └─┬─┘ └─┬─┘
│     │  │  │  roll  pitch  yaw  thr.  CRC = 0x2E08
│     │  │  flags = armado + yaw em taxa
│     │  sequência = 42
│     tipo = comando
cabeçalho
```

Este mesmo vetor é verificado nos testes do JavaScript e do C.

## 3. Flags

| Bit | Máscara | Nome | No comando | Na telemetria |
|---:|---|---|---|---|
| 0 | `0x01` | `ARMADO` | A página está armada | O firmware está armado |
| 1 | `0x02` | `PARADA` | Parada de emergência | A trava está ativa (ver seção 5) |
| 2 | `0x04` | `YAW_TAXA` | O campo yaw é taxa (°/s) | Idem, modo em uso |
| 3 | `0x08` | `FAILSAFE` | Reservado, sempre 0 | O firmware está em failsafe por timeout |
| 4–7 | | | Reservados, sempre 0 | Reservados, sempre 0 |

### Yaw: ângulo ou taxa

Ainda não está decidido se o PID de yaw recebe ângulo ou taxa. Por isso o
modo é escolhido nos ajustes da página e **vai em todos os pacotes**, na
flag `YAW_TAXA`:

- `YAW_TAXA = 1` (padrão da página): yaw em centésimos de °/s. O fim de
  curso do joystick vale ±45 °/s por padrão.
- `YAW_TAXA = 0`: yaw em centésimos de grau, com o mesmo fim de curso de
  roll e pitch (±15° por padrão).

O firmware deve ler a flag e tratar o valor de acordo. Se o PID só aceitar
um dos modos, o firmware deve **recusar** pacotes armados no outro modo, em
vez de interpretar a unidade errada.

## 4. O que a página garante

1. Pacote sem `ARMADO` tem roll, pitch, yaw e throttle em zero.
2. Pacote com `PARADA` nunca tem `ARMADO` e tem tudo em zero.
3. O primeiro pacote armado depois de armar tem tudo em zero, porque a
   página só arma com os controles soltos.
4. Depois de um PARAR, a página envia 10 pacotes seguidos com `PARADA` e
   depois volta ao heartbeat desarmado.
5. As escritas são seriais e sem fila: um pacote com valores antigos nunca é
   escrito depois do pacote de parada.
6. Se a página perder o foco, a tela bloquear ou a conexão cair, a página
   desarma e, se ainda puder, envia um pacote desarmado.

**O firmware não deve confiar em nada disso.** A página roda em um celular,
em um navegador que o sistema pode suspender a qualquer momento, sobre um
enlace de rádio. A proteção de verdade é a da próxima seção.

## 5. O que o firmware precisa fazer

Estas regras já estão implementadas em `rc_receptor_*`. Se o firmware usar
outra implementação, precisa manter todas.

### 5.1 Failsafe por timeout (obrigatório)

Se passarem **250 ms** sem nenhum comando aceito, o firmware zera os
setpoints, desarma e ativa a trava. A 30 Hz, isso equivale a cerca de 7
pacotes perdidos em sequência. O valor está em `RC_TIMEOUT_MS`.

É a única proteção que funciona quando o celular trava, a bateria acaba ou
o navegador é suspenso. Pacotes recusados não contam como sinal de vida.

### 5.2 Limites (obrigatório)

O firmware satura os setpoints recebidos, sem depender dos limites da
página:

| Macro | Padrão | Significado |
|---|---|---|
| `RC_LIMITE_ROLL_PITCH` | `3000` | ±30,00° |
| `RC_LIMITE_YAW` | `18000` | ±180,00° ou ±180,00 °/s |
| `RC_LIMITE_THROTTLE` | `1000` | 100,0 % |

**Ajuste esses valores ao protótipo.** Com o protótipo preso, faz sentido
reduzir `RC_LIMITE_THROTTLE` e `RC_LIMITE_YAW` ao que a bancada suporta. A
página limita o ângulo a no máximo 30° e, por padrão, o throttle a 30 %.

### 5.3 Trava de parada

- Um pacote com `PARADA` zera tudo, desarma e ativa a **trava**. Vale
  sempre, qualquer que seja a sequência ou os outros campos.
- O failsafe por timeout também ativa a trava.
- O firmware começa com a trava ativa.
- Com a trava ativa, pacotes armados são recusados.
- A trava só sai com um pacote **desarmado e com tudo em zero**.

Consequência: depois de uma parada ou de uma falha de enlace, o protótipo
não volta a responder sozinho. Alguém precisa desarmar e armar de novo na
página.

### 5.4 Armar só com zeros

A passagem de desarmado para armado só é aceita se o pacote armado tiver
roll, pitch, yaw e throttle em zero.

### 5.5 Pacote desarmado

Um pacote sem `ARMADO` sempre desarma e zera. Se ele trouxer algum valor
diferente de zero, é inválido: desarma do mesmo jeito, mas não libera a
trava nem conta como sinal de vida.

### 5.6 Sequência

Entre pacotes armados, o firmware recusa o pacote cuja sequência seja igual
à do último aceito ou esteja "atrás" dela (diferença módulo 256 igual a 0 ou
maior que 127). Pacotes de parada e pacotes desarmados não passam por essa
verificação, porque sempre levam ao estado seguro. Depois de um failsafe, a
contagem recomeça.

### 5.7 Outras recusas

Tipo diferente de `0x01` ou qualquer bit reservado das flags ligado: o
pacote é recusado.

## 6. Como usar o código de referência

O código usa só `<stdint.h>` e `<stdbool.h>`, não aloca memória e não
depende de endianness. Compila sem avisos com
`-std=c99 -Wall -Wextra -Werror -pedantic -Wconversion`.

```c
#include "rc_protocolo.h"

static rc_parser_t parser;
static rc_receptor_t receptor;

void rc_iniciar(void)
{
    rc_parser_iniciar(&parser);
    rc_receptor_iniciar(&receptor); /* começa desarmado e travado */
}

/* Chame para cada byte que chegar na UART do módulo BLE. */
void rc_ao_receber_byte(uint8_t byte)
{
    rc_pacote_t pacote;
    if (rc_parser_alimentar(&parser, byte, &pacote)) {
        rc_receptor_processar(&receptor, &pacote, relogio_ms());
    }
}

/* Chame em todo ciclo do PID, antes de usar os setpoints. */
void rc_ciclo_do_pid(void)
{
    rc_receptor_tick(&receptor, relogio_ms()); /* failsafe por timeout */

    const rc_setpoints_t *sp = &receptor.sp;
    if (!sp->armado) {
        desligar_motores();
        return;
    }
    /* sp->roll e sp->pitch: centésimos de grau.
     * sp->yaw: centésimos de grau, ou de grau/s se sp->yaw_eh_taxa.
     * sp->throttle: 0 a 1000. */
    pid_atualizar(sp->roll, sp->pitch, sp->yaw, sp->yaw_eh_taxa, sp->throttle);
}
```

`relogio_ms()`, `desligar_motores()` e `pid_atualizar()` são do firmware.
`relogio_ms()` precisa ser um contador monotônico em milissegundos; pode dar
a volta em 32 bits sem problema.

Cuidados:

- Se `rc_ao_receber_byte` rodar em interrupção e `rc_ciclo_do_pid` no laço
  principal, proteja o acesso a `receptor` (desabilite a interrupção da UART
  durante a leitura dos setpoints, ou passe os bytes por uma fila e processe
  tudo no laço principal).
- O parser se ressincroniza sozinho. Não é preciso limpar nada quando chega
  lixo. `parser.erros_crc` e `parser.bytes_descartados` servem de diagnóstico.
- Alguns módulos BLE enviam texto pela UART ao conectar ou desconectar (por
  exemplo `OK+CONN` no HM-10). O parser descarta esses bytes.

### Telemetria (opcional)

```c
uint8_t bytes[RC_TAMANHO_PACOTE];
static uint8_t seq;

rc_montar_telemetria(&receptor, seq++, roll_medido, pitch_medido, yaw_medido,
                     throttle_aplicado, bytes);
uart_enviar(bytes, RC_TAMANHO_PACOTE);
```

Uma taxa de 10 Hz é suficiente para a tela. A página mostra os valores
medidos ao lado dos comandados e o estado do firmware (armado, trava,
failsafe). Se a telemetria informar failsafe ou trava enquanto a página está
armada, a página desarma e avisa o usuário.

## 7. Testes

`npm test` (ou `node --test "testes/*.test.js"`) compila o código C com o
`gcc` e verifica:

- os testes unitários do parser e do receptor
  ([`testes/firmware/teste_protocolo.c`](testes/firmware/teste_protocolo.c));
- 500 pacotes aleatórios codificados em JavaScript e decodificados em C, com
  lixo, pacotes truncados e pacotes corrompidos no meio do fluxo;
- 100 pacotes de telemetria codificados em C e decodificados em JavaScript.

Esses testes rodam no PC (x86-64). O código não foi compilado nem executado
no alvo RISC-V.

## 8. Mudanças futuras no protocolo

O byte de tipo identifica o formato. Para acrescentar campos, crie um tipo
novo (por exemplo `0x02`) em vez de mudar o `0x01`. O passo a passo está em
[`docs/ARQUITETURA.md`](docs/ARQUITETURA.md).
