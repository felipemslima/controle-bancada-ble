# Protocolo do controle remoto

Especificação do enlace entre a página de controle e a controladora.
Versão 2 (protocolo de um byte; substitui o pacote de 15 bytes, ver o
[ADR 0008](docs/adr/0008-protocolo-de-um-byte.md)).

Este documento é para quem escreve o firmware. O código de referência está em
[`firmware/rc_byte.h`](firmware/rc_byte.h) e
[`firmware/rc_byte.c`](firmware/rc_byte.c), e pode ser usado como está. O
equivalente da página fica em
[`src/dominio/protocolo.js`](src/dominio/protocolo.js).

## 1. Visão geral

- O protótipo fica preso em bancada e não voa, então só existem **pitch** e
  **roll**. Não há yaw, throttle nem telemetria.
- Cada byte recebido pela UART é uma mensagem completa. Não há cabeçalho,
  tamanho, sequência nem checksum: o firmware lê um byte por vez e decide.
- Caminho dos dados: página (Web Bluetooth) → módulo BLE com UART transparente
  → UART da controladora, 9600 baud, 8N1. O sentido é só página → firmware.
- A página envia continuamente (30 Hz por padrão, ajustável de 10 a 50 Hz).
  Isso é o heartbeat: o firmware usa a chegada de bytes como sinal de vida.
- Posição: pitch e roll são níveis inteiros de -7 a +7. O **significado em
  graus** de cada nível (sugestão: 2° por nível, ou seja, ±14°) e o sentido
  físico de cada eixo são definidos pelo firmware.

## 2. Bytes

| Byte | Significado |
|---|---|
| `0xFF` | Desconectar / parar. Vale sempre. |
| `0xF0` | Conectar (libera o controle). |
| `0xF1` a `0xFE` | Reservados. O receptor ignora. |
| Qualquer outro | Posição: nibble alto = pitch, nibble baixo = roll. |

Qualquer byte com um nibble `F` que não seja `0xF0` ou `0xFF` é reservado.

Na posição, cada nibble vai de 0 a 14, com **centro 7**:

- nível = nibble − 7, de −7 a +7;
- nibble maior = para cima (pitch) e para a direita (roll);
- `0x77` = parado (os dois eixos no centro).

Como uma posição nunca usa o nibble `F`, nenhuma posição se confunde com
conectar ou desconectar. Há 225 posições (15 × 15).

### Exemplos

| Byte | Mensagem |
|---|---|
| `0x77` | Posição: pitch 0, roll 0 (parado) |
| `0xE7` | Posição: pitch +7, roll 0 |
| `0x07` | Posição: pitch −7, roll 0 |
| `0x7E` | Posição: pitch 0, roll +7 |
| `0x70` | Posição: pitch 0, roll −7 |
| `0xA4` | Posição: pitch +3, roll −3 |
| `0xF0` | Conectar |
| `0xFF` | Desconectar / parar |

## 3. Sequência típica de uma sessão

```
FF FF FF ...        página conectada ao módulo, desarmada (heartbeat)
F0 F0 F0            usuário arma: três conectar
77 77 77 A7 A7 ...  posições, na taxa configurada
FF                  PARAR, perda de foco, tela bloqueada ou queda da conexão
FF FF FF ... (10)   a página insiste antes de permitir rearmar
```

Notas:

- O `0xF0` sai três vezes (`PACOTES_DE_INICIO`) para cobrir a perda de um byte
  no rádio. O firmware deve tratar `0xF0` repetido como um só.
- O primeiro byte de posição depois do conectar é `0x77`, porque a página só
  arma com o joystick solto.
- Se a conexão BLE cair, não há como enviar nada; quem protege é o failsafe
  (seção 5.2).

## 4. O que a página garante

1. Desarmada ou em parada, só sai `0xFF`.
2. Ao armar, sai `0xF0` três vezes e só depois o byte de posição.
3. Armar exige o joystick solto, então a primeira posição é `0x77`.
4. Depois de um PARAR, a página envia 10 vezes `0xFF` antes de permitir
   rearmar.
5. As escritas são seriais e sem fila: uma posição antiga nunca é escrita
   depois de um `0xFF`.
6. PARAR, perda de foco, tela bloqueada ou queda da conexão geram `0xFF`
   imediato (quando o enlace ainda permite).
7. Uma escrita travada por mais de 1 s derruba a conexão.

**O firmware não deve confiar em nada disso.** A página roda em um celular,
em um navegador que o sistema pode suspender a qualquer momento, sobre um
enlace de rádio. A proteção de verdade é a da próxima seção.

## 5. O que o firmware precisa fazer

### 5.1 Regras do receptor

1. **Começar desconectado**, com pitch e roll em zero.
2. **Ignorar posições antes do `0xF0`.** Também depois de um failsafe, até
   chegar um novo `0xF0`.
3. **`0xFF` sempre vale:** desconecta e zera, em qualquer estado.
4. **`0xF0`** conecta com pitch e roll em zero. Repetido não muda nada.
5. **Bytes reservados** são ignorados e **não contam como sinal de vida**.
6. Definir os graus por nível e o sentido de cada eixo, e limitar o setpoint
   do PID a um valor seguro para a bancada.

### 5.2 Failsafe por timeout (obrigatório)

Se o receptor está conectado e passam `RC_TIMEOUT_MS` (250 ms) sem nenhum byte
aceito (posição, `0xF0` ou `0xFF`), ele desconecta e zera pitch e roll. Depois
disso, posições são ignoradas até um novo `0xF0`. Isso cobre queda do Bluetooth,
celular travado e página suspensa. Sem este item, não teste com hélices.

O tempo de 250 ms foi pensado para 30 Hz (33 ms entre bytes, cerca de 7
bytes perdidos em sequência antes de disparar). Por isso a página não aceita
taxa abaixo de 10 Hz (100 ms entre bytes). Se mudar o timeout, mantenha-o
bem acima do intervalo entre bytes.

### 5.3 Sem checksum

O BLE já verifica erros no ar e o trecho de UART é curto, então o protocolo não
tem CRC. Um byte corrompido vira, no pior caso, uma posição errada por um
ciclo, que o byte seguinte corrige. Se a UART se mostrar ruidosa, uma extensão
possível é mandar cada byte seguido do seu complemento (`pos, ~pos`) e aceitar
só pares coerentes. **Não está implementada.**

### 5.4 Cuidado com o módulo BLE (texto do HM-10)

O HM-10 pode escrever texto na UART por conta própria, como `OK+CONN` ao
conectar e `OK+LOST` ao perder a conexão. Esses bytes são ASCII (`0x4F`,
`0x4B`, `0x2B`...) e **caem na faixa de posição**. Antes do `0xF0`, o receptor
os ignora. Mas se a mensagem chegar com o controle conectado, ela vira
posições espúrias por um instante.

Recomendação: desligar essas notificações no módulo (no HM-10, o comando AT
`AT+NOTI0`). **É preciso confirmar o comando equivalente no módulo escolhido**
(HC-08, JDY-23 etc.); o comportamento muda de um fabricante para outro.

## 6. Código de referência em C

`firmware/rc_byte.h` e `rc_byte.c`: C99, só `<stdint.h>` e `<stdbool.h>`, sem
alocação dinâmica.

- `rc_decodificar(byte)`: traduz um byte, sem estado.
- `rc_codificar_posicao(pitch, roll)`: monta o byte (níveis saturados).
- `rc_receptor_processar(&r, byte, agora_ms)`: aplica as regras da seção 5.1;
  devolve `true` se o byte foi aceito.
- `rc_receptor_tick(&r, agora_ms)`: aplica o timeout da seção 5.2.

Exemplo de uso (nomes de hardware ilustrativos):

```c
#include "rc_byte.h"

static volatile rc_receptor_t rx;   /* escrito na interrupção, lido no PID */

void uart_rx_isr(void)              /* um byte por interrupção */
{
    rc_receptor_processar((rc_receptor_t *)&rx, uart_ler_byte(), tempo_ms());
}

void ciclo_pid(void)                /* periódico, por exemplo 1 kHz */
{
    rc_receptor_t copia;

    desabilitar_interrupcoes();     /* cópia coerente do receptor */
    rc_receptor_tick((rc_receptor_t *)&rx, tempo_ms());
    copia = *(rc_receptor_t *)&rx;
    habilitar_interrupcoes();

    if (copia.conectado) {
        pid_setpoint(copia.pitch * GRAUS_POR_NIVEL, copia.roll * GRAUS_POR_NIVEL);
    } else {
        pid_setpoint(0, 0);
    }
}
```

Pontos de atenção:

- `rc_receptor_t` é compartilhada entre a interrupção e o laço do PID. Proteja
  o acesso (como acima) ou chame tudo do mesmo contexto, lendo os bytes da UART
  por polling no laço.
- `agora_ms` precisa ser monotônico; a volta em 32 bits é tratada.
- Chame `rc_receptor_tick` com regularidade. Sem isso o failsafe não existe.
- Se o hardware tem FIFO na UART, processe todos os bytes pendentes antes do
  tick; a ordem dos bytes importa (um `0xFF` depois de posições deve vencer).

## 7. Testes

`npm test` roda os testes em JavaScript (protocolo, estado, transmissor e BLE
com um mock) e compila com `gcc` o teste em C
(`testes/firmware/teste_byte.c`). Há um teste cruzado: o mesmo conjunto de
256 valores de byte é decodificado em JavaScript e em C, e os resultados têm
de coincidir.

**Não testado:** módulo BLE real, firmware real no RISC-V, Bluefy e iOS.

## 8. Mudanças futuras

- Qualquer mudança no protocolo precisa ser feita ao mesmo tempo em
  `src/dominio/protocolo.js`, `firmware/rc_byte.c` e `.h`, neste documento e
  nos testes. Se for incompatível, registre um ADR que substitua o 0008.
- Os bytes `0xF1` a `0xFE` ficam reservados para extensões. O receptor atual os
  ignora, então a página pode usá-los no futuro sem quebrar firmwares que
  seguem esta especificação.
- Detecção de erro na UART: ver a seção 5.3 (byte seguido do complemento).
