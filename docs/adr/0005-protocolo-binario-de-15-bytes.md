# 0005. Protocolo binário de 15 bytes

- Status: Substituído pelo [ADR 0008](0008-protocolo-de-um-byte.md)
- Data: 2026-11-12

## Contexto

Os dados passam por BLE até um módulo UART, e daí para a controladora. O MTU padrão do BLE leva 20 bytes por escrita. A UART pode ser lenta (9600 baud) e o firmware tem pouca capacidade para interpretar texto. Ainda não se sabe se o PID espera o yaw como ângulo ou como taxa.

## Decisão

Usar um quadro binário fixo de 15 bytes, com campos little-endian. A especificação é `PROTOCOLO.md`; o código está em `src/dominio/protocolo.js` e em `firmware/rc_protocolo.h` e `.c`.

| Bytes | Campo |
| --- | --- |
| 0-1 | cabeçalho `A5 5A` |
| 2 | tipo (`01` comando, `81` telemetria) |
| 3 | sequência (uint8, dá a volta) |
| 4 | flags (armado, parada, yaw em taxa, failsafe) |
| 5-6, 7-8, 9-10 | roll, pitch, yaw (int16, centésimos de grau) |
| 11-12 | throttle (uint16, 0 a 1000) |
| 13-14 | CRC-16/CCITT-FALSE dos bytes 2 a 12 |

O modo do yaw (ângulo ou taxa) vai em uma flag em cada pacote, e não em configuração fixa no firmware, porque ainda não sabemos o que o PID espera. O mesmo formato serve para a telemetria, com tipo `81`.

Alternativas descartadas:

- Texto ou JSON: pacote bem maior, e o parsing é caro para a controladora.
- Pacote sem CRC: um byte corrompido viraria um setpoint falso.

## Consequências

- Cabe em uma escrita BLE de 20 bytes. A 30 Hz são 450 bytes por segundo, que cabem em UART a 9600 baud (cerca de 960 bytes por segundo).
- O parser ressincroniza sozinho depois de lixo, pela busca do cabeçalho e pela checagem do CRC.
- O cabeçalho e o CRC detectam erros, mas não protegem contra um emissor malicioso. O CRC não é autenticação.
- Mudar o layout exige alterar JavaScript, C, `PROTOCOLO.md` e testes ao mesmo tempo.
