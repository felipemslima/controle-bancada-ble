# Controle remoto de bancada

Página web que controla, por Bluetooth (BLE), a controladora do protótipo.
Envia a posição de **pitch e roll** para validar a resposta do PID com o
protótipo preso na bancada. Ele não voa: não há yaw, throttle nem telemetria.

Endereço publicado: <https://felipemslima.github.io/controle-bancada-ble/>

- Funciona no iPhone pelo navegador **Bluefy** e no **Chrome/Edge** em
  Android e PC. O Safari não tem Web Bluetooth.
- São só arquivos estáticos: sem servidor, sem build e sem dependências.
- O protocolo (um byte por mensagem) e o código de referência em C para o
  firmware estão em [`PROTOCOLO.md`](PROTOCOLO.md) e em [`firmware/`](firmware/).

> **Módulo Bluetooth.** O HC-05 e o HC-06 **não funcionam**: são Bluetooth
> Classic e o Web Bluetooth só fala BLE (nem no iPhone). Use um módulo BLE com
> UART transparente (HM-10, HC-08, JDY-23), ligado em VCC, GND, TX e RX a 9600
> baud, 8N1. O HM-10 pode escrever texto como `OK+CONN` na UART; desligue as
> notificações do módulo (no HM-10, `AT+NOTI0`). Detalhes em
> [`PROTOCOLO.md`](PROTOCOLO.md).

> **Segurança.** Use somente com o protótipo preso. A página desarma sozinha
> em várias situações, mas a proteção de verdade é o failsafe do firmware
> (seção 5 do [`PROTOCOLO.md`](PROTOCOLO.md)). Não teste com hélices antes de
> confirmar que o failsafe funciona.

## Como usar

1. Abra a página (endereço acima).
2. Toque em **Conectar** e escolha o módulo BLE na lista.
3. Com o joystick solto, **segure** o botão de armar por 1 segundo.
4. Controle com o **joystick**: para cima e para baixo é **pitch**; para os
   lados é **roll**. Ele volta ao centro ao soltar. Para cima e para a direita
   são níveis positivos. Cada eixo tem 7 níveis para cada lado (-7 a +7; o firmware
   aceita até -8); os graus de cada nível são definidos pelo firmware.
5. **PARAR** desarma na hora e envia `0x00`. No PC, as teclas Esc e Espaço
   fazem o mesmo. Um toque no botão de armar, quando armado, desarma.

O joystick é relativo ao ponto em que o dedo encosta: encostar não gera
comando, só arrastar.

A página desarma e envia `0x00` sozinha se a conexão cair, se a página perder
o foco ou se a tela bloquear. Depois disso é preciso armar de novo. Depois de
um PARAR, ela envia 10 `0x00` antes de permitir rearmar.

### Ajustes (engrenagem)

Só abrem com a página desarmada. Ficam salvos no navegador.

| Ajuste | Padrão | Observação |
|---|---|---|
| UUID do serviço / da característica | `FFE0` / `FFE1` | Padrão do HM-10. Aceita 16 bits ou 128 bits |
| Mostrar todos os dispositivos | desligado | Ligue se o módulo não aparecer na lista |
| Taxa de envio | 30 Hz | 10 a 50 Hz |
| Inverter pitch | desligado | Troca o sinal do eixo |
| Inverter roll | desligado | Troca o sinal do eixo |

### Leituras e painel de debug

A tabela de leituras mostra o nível de pitch e de roll (-7 a +7), o byte que
sairia agora em hexadecimal e a mensagem (Conectar, Posição ou Parar).

O painel de debug mostra o último byte enviado, a taxa de envio medida, os
contadores (enviados, descartados, erros), o estado da trava de tela e o motivo
do último desarme. Em telas baixas e em paisagem ele fica oculto para dar
espaço ao joystick.

### Modo simulado

Acrescente `?simular` ao endereço para testar a interface sem hardware. A
página usa uma controladora simulada que só aceita os bytes. Serve para treinar
o uso; não testa o Bluetooth.

## Rodar no computador

O Web Bluetooth exige HTTPS ou `localhost`. Para testar localmente:

```sh
python3 -m http.server 8000
# abra http://localhost:8000 ou http://localhost:8000/?simular
```

Abrir o `index.html` direto do disco não funciona, porque o navegador
bloqueia módulos ES em `file://`.

## Testador no PC (ver os bytes que o celular envia)

`ferramentas/testador_ble.py` faz o PC se passar pela controladora: anuncia
por BLE o mesmo serviço do HM-10 (`FFE0`/`FFE1`) e mostra no terminal cada
byte que a página enviar, já decodificado (conectar, desconectar ou posição
de pitch e roll). Ele também simula o receptor do firmware e avisa quando uma
posição seria ignorada, quando a página viola uma garantia do protocolo
(por exemplo, posição antes do `0xFF`) e quando passam mais de 250 ms sem
byte, que é o momento em que o failsafe do firmware dispararia.

```sh
npm run testador                              # painel ao vivo
python3 ferramentas/testador_ble.py --todos   # uma linha por byte
python3 ferramentas/testador_ble.py --csv saida.csv
```

No celular, abra a página, toque em **Conectar** e escolha `Bancada-PC`.
Requer Linux com BlueZ, `python3-dbus` e `python3-gi`; não instala nada.
Não comanda motor algum. Testes do decodificador: `npm run test:ferramentas`.

## Testes

Precisa de Node.js 22 ou mais novo e, para os testes do firmware, do `gcc`.

```sh
npm test
```

O comando não instala nada. Ele roda os testes em JavaScript (protocolo,
estado, transmissor e adaptador BLE contra um mock do Web Bluetooth) e compila
com `gcc` o teste em C (`testes/firmware/teste_byte.c`). Um teste cruzado
decodifica os 256 valores de byte em JavaScript e em C e compara os resultados.

O que os testes **não** cobrem:

- o comportamento real no Bluefy e no iOS (gesto para conectar, suspensão em
  segundo plano, trava de tela);
- um módulo BLE de verdade (UUIDs, escrita sem resposta, latência, alcance);
- o firmware real: o código C de referência só foi compilado e executado no
  PC, e o alvo RISC-V não foi testado;
- a interface, que só foi conferida à mão no Chrome em modo simulado.

## Publicar no GitHub Pages

1. Crie o repositório no GitHub e envie o código (o repositório atual é
   `felipemslima/controle-bancada-ble`):
   ```sh
   git remote add origin git@github.com:felipemslima/controle-bancada-ble.git
   git push -u origin main
   ```
2. No GitHub, abra **Settings → Pages**.
3. Em **Build and deployment → Source**, escolha **Deploy from a branch**.
4. Escolha a branch `main` e a pasta `/ (root)`, e salve.
5. Depois de um ou dois minutos, a página fica em
   <https://felipemslima.github.io/controle-bancada-ble/>.

O arquivo `.nojekyll` faz o GitHub servir os arquivos como estão. No plano
gratuito, o GitHub Pages exige repositório público.

## Organização do código

```
index.html, css/      a página
src/dominio/          protocolo, estado e regras de segurança (código puro)
src/aplicacao/        loja de estado, laço de envio, conexão, portas
src/adaptadores/      Web Bluetooth, enlace simulado, navegador
src/ui/               controles de toque e desenho da tela
src/main.js           liga todas as peças
firmware/             rc_byte: decodificador e receptor em C (referência)
testes/               testes em JavaScript e em C
docs/                 arquitetura e registros de decisão (ADRs)
```

Para entender ou estender o projeto, comece por
[`docs/ARQUITETURA.md`](docs/ARQUITETURA.md). As decisões de projeto e seus
motivos estão em [`docs/adr/`](docs/adr/README.md).
