# 0009. Bytes especiais e centro do firmware

- Status: Aceito
- Data: 2026-11-13

Substitui o [ADR 0008](0008-protocolo-de-um-byte.md) apenas nos valores dos bytes e na faixa de níveis. O resto do 0008 continua valendo: um byte por mensagem, só pitch e roll, heartbeat, failsafe de 250 ms e módulo BLE.

## Contexto

O ADR 0008 propôs `0xF0` para conectar, `0xFF` para desconectar, nibbles de 0 a 14 com centro 7 e bytes com nibble `F` reservados. O colega do firmware avaliou a contraproposta, manteve um byte por mensagem e definiu outros valores, que a página e o C de referência passam a seguir.

## Decisão

- `0xFF` conecta (libera o controle). `0x00` desconecta e para.
- Todos os bytes de `0x01` a `0xFE` são posição. Não há bytes reservados: são 254 posições e 2 especiais.
- Posição: nibble alto = pitch, nibble baixo = roll, centro 8 (`0x88` = parado). Nível = nibble − 8, então o firmware aceita de −8 a +7 em cada eixo. Nibble maior = para cima e para a direita.
- A página envia só níveis de −7 a +7 (nibbles de 1 a 15), para o joystick ser simétrico. Nunca envia o nível −8 nem `0x00` como posição.
- O único canto que coincidiria com um especial é pitch +7 e roll +7 = `0xFF`. A página o troca por `0xEE` (+6, +6). O canto é inalcançável no joystick circular (na diagonal máxima cada eixo chega a ±5), mas a garantia está no código e nos testes.
- Comportamento da página: desarmada envia `0x00` como heartbeat; ao armar, `0xFF` três vezes e depois as posições; PARAR, perda de foco ou queda geram `0x00` imediato; após PARAR, 10 `0x00` antes de poder rearmar.
- Receptor de referência em C: ignora posições antes do `0xFF`; `0x00` desconecta e zera sempre; 250 ms sem byte aceito desconectam e zeram, e posições ficam ignoradas até um novo `0xFF`. `rc_decodificar` devolve níveis de −8 a +7; `rc_codificar_posicao` satura em −7..+7 e troca `0xFF` por `0xEE`.

## Alternativas consideradas

- **Manter o ADR 0008** (`0xF0`/`0xFF`, centro 7, nibble `F` reservado). Tinha a vantagem de nenhuma posição colidir com um especial, mas o firmware escolheu os valores acima e o receptor dele é quem manda no enlace.
- **Usar os 16 níveis assimétricos (−8 a +7) no joystick.** Rejeitada: o joystick ficaria assimétrico, com mais curso para baixo e para a esquerda do que para cima e para a direita.

## Consequências

- Todo byte tem significado, então não sobra valor livre para extensões; um recurso novo pede um protocolo novo.
- Ruído ou condição de break na UART tende a gerar `0x00`, que agora é desconectar: o byte espúrio vai na direção segura.
- Um `0xFF` espúrio (por exemplo, um pulso que pareça bit de início com a linha ociosa em nível alto) seria lido como conectar. O efeito é limitado: conectar só libera o controle com tudo no centro, e só posições que chegarem depois movem o protótipo.
- O texto ASCII que o HM-10 manda ao conectar (`OK+CONN`) cai na faixa de posição. O receptor o ignora antes do `0xFF`, mas, com o controle conectado, ele viraria posições espúrias por um instante. Recomenda-se desligar as notificações (`AT+NOTI0` no HM-10) e confirmar o comando no módulo escolhido. Continua valendo trocar o HC-05 (Bluetooth Classic, não funciona com Web Bluetooth) por um módulo BLE (HM-10, HC-08, JDY-23).
- O nível −8 existe só no lado negativo. O firmware pode tratá-lo como −8 ou saturá-lo; a página nunca o envia.
- O teste cruzado JS × C continua nos 256 bytes (254 posições e 2 especiais). JavaScript, C, `PROTOCOLO.md` e testes mudam juntos.
