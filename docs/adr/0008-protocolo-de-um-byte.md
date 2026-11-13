# 0008. Protocolo de um byte

- Status: Aceito; valores dos bytes e faixa substituídos pelo [ADR 0009](0009-bytes-especiais-e-centro-do-firmware.md)
- Data: 2026-11-13

Substitui o [ADR 0005](0005-protocolo-binario-de-15-bytes.md).

## Contexto

O protótipo fica preso em bancada e não voa, então só pitch e roll interessam. O firmware da controladora (silício RISC-V próprio) já lê um byte por vez da UART e não tem parser de pacote. O pacote de 15 bytes com CRC, yaw, throttle e telemetria deixou de fazer sentido. O colega propôs 15 níveis por nibble, `0x00` para conectar e `0xFF` para desconectar.

## Decisão

Cada byte é uma mensagem completa (especificação em `PROTOCOLO.md`):

- `0xFF` desconecta e para; `0xF0` conecta; `0xF1` a `0xFE` e qualquer outro byte com nibble `F` são reservados e ignorados.
- Posição: nibble alto = pitch, nibble baixo = roll, de 0 a 14 com centro 7 (`0x77` = parado). Sete níveis para cada lado; os graus por nível são definidos pelo firmware (sugestão: 2° por nível).
- A página envia na taxa configurada (padrão 30 Hz), `0xFF` quando desarmada, `0xF0` três vezes ao armar e 10 `0xFF` após um PARAR.
- O firmware ignora posição antes do `0xF0`, obedece `0xFF` sempre e desconecta por timeout de 250 ms sem byte aceito.
- Sem checksum. Possível extensão futura, não implementada: cada byte seguido do complemento (`pos, ~pos`).

### Módulo

O HC-05 é Bluetooth Classic (SPP) e não funciona com Web Bluetooth, que só fala BLE, nem no iPhone. Usar um módulo BLE com UART transparente (HM-10, HC-08, JDY-23), com a mesma ligação VCC/GND/TX/RX a 9600 baud 8N1. O firmware não muda por causa disso.

## Alternativas consideradas

- **Proposta original (15 níveis, `0x00` conectar, `0xFF` desconectar).** Com 15 níveis sobra um único valor de nibble, então um especial sempre coincide com um canto do joystick: com centro 8, o canto (15,15) é `0xFF`; com centro 7, o canto (0,0) é `0x00`. Além disso, `0x00` é o que ruído ou condição de break na UART gera sozinho, e um "conectar" espúrio iria na direção perigosa. Um `0xFF` espúrio (linha ociosa em nível alto) só desconecta, a direção segura.
- **Manter o pacote de 15 bytes.** Exigiria parser, CRC e sequência no firmware para um protótipo que só precisa de dois eixos.
- **Manter o HC-05 com Web Serial.** Funciona no Chrome desktop e no Android, mas não no iPhone. Fica como caminho possível, como um novo adaptador da porta `Enlace`, se um dia for necessário.

## Consequências

- Firmware muito mais simples: um byte, sem estado de parser. O receptor de referência tem poucas dezenas de linhas.
- Resolução menor: 7 níveis por lado em vez de centésimos de grau.
- Sem CRC, um byte corrompido vira no máximo uma posição errada por um ciclo. O BLE verifica erros no ar e a UART é curta. O failsafe de 250 ms continua obrigatório.
- O HM-10 pode escrever texto (`OK+CONN`) na UART, e esses bytes ASCII caem na faixa de posição. Recomenda-se desligar as notificações do módulo (`AT+NOTI0`) e confirmar o comando no módulo escolhido.
- Não há telemetria: a página não sabe o que o firmware está fazendo. A porta `Enlace` ainda tem `aoReceber`, hoje sem uso.
- Mudar o protocolo exige alterar JavaScript, C, `PROTOCOLO.md` e testes ao mesmo tempo.
- Não testado: módulo real, firmware real e Bluefy/iOS.
