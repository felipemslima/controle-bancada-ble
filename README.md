# Controle remoto de bancada

Página web que controla, por Bluetooth (BLE), a controladora de voo do
protótipo. Envia setpoints de **roll, pitch, yaw e throttle** para validar a
resposta do PID com o protótipo preso na bancada.

- Funciona no iPhone pelo navegador **Bluefy** e no **Chrome/Edge** em
  Android e PC. O Safari não tem Web Bluetooth.
- São só arquivos estáticos: sem servidor, sem build e sem dependências.
- O protocolo e o parser em C para o firmware estão em
  [`PROTOCOLO.md`](PROTOCOLO.md) e em [`firmware/`](firmware/).

> **Segurança.** Use somente com o protótipo preso. A página desarma sozinha
> em várias situações, mas a proteção de verdade é o failsafe do firmware
> (seção 5 do [`PROTOCOLO.md`](PROTOCOLO.md)). Não teste com hélices antes de
> confirmar que o failsafe funciona.

## Como usar

1. Abra a página (endereço do GitHub Pages, ver abaixo).
2. Toque em **Conectar** e escolha o módulo BLE na lista.
3. Com todos os controles soltos, **segure** o botão de armar por 1 segundo.
4. Controle:
   - **Joystick**: para cima e para baixo é pitch; para os lados é yaw.
     Volta ao centro ao soltar.
   - **Roll**: deslizante horizontal. Volta ao centro ao soltar.
   - **Throttle**: deslizante vertical. Fica onde foi solto e só funciona
     armado.
5. **PARAR** zera tudo e desarma na hora. No PC, as teclas Esc e Espaço fazem
   o mesmo. Um toque no botão de armar, quando armado, desarma.

Os controles são relativos ao ponto em que o dedo encosta: encostar não gera
comando, só arrastar.

A página desarma e zera sozinha se a conexão cair, se a página perder o foco,
se a tela bloquear ou se o firmware avisar que entrou em failsafe. Depois
disso é preciso armar de novo.

### Ajustes (engrenagem)

Só abrem com a página desarmada. Ficam salvos no navegador.

| Ajuste | Padrão | Observação |
|---|---|---|
| UUID do serviço / da característica | `FFE0` / `FFE1` | Padrão do HM-10. Aceita 16 bits ou 128 bits |
| Mostrar todos os dispositivos | desligado | Ligue se o módulo não aparecer na lista |
| Taxa de envio | 30 Hz | 5 a 50 Hz |
| Ângulo máximo de roll/pitch | 15° | 1 a 30° |
| Modo do yaw | taxa (°/s) | Ou ângulo. Tem de combinar com o PID do firmware |
| Taxa máxima de yaw | 45 °/s | Só no modo taxa |
| Teto do throttle | 30 % | Valor enviado com o deslizante no máximo |
| Inverter roll / pitch / yaw | desligado | Troca o sinal do eixo |

### Painel de debug

Mostra o último pacote enviado em hexadecimal, a taxa de envio medida, os
contadores de pacotes, o estado da trava de tela e o motivo do último
desarme. Em telas baixas e em paisagem ele fica oculto para dar espaço aos
controles.

### Modo simulado

Acrescente `?simular` ao endereço para testar a interface sem hardware. A
página usa uma controladora simulada, que devolve uma telemetria falsa. Serve
para treinar o uso; não testa o Bluetooth.

## Rodar no computador

O Web Bluetooth exige HTTPS ou `localhost`. Para testar localmente:

```sh
python3 -m http.server 8000
# abra http://localhost:8000 ou http://localhost:8000/?simular
```

Abrir o `index.html` direto do disco não funciona, porque o navegador
bloqueia módulos ES em `file://`.

## Testes

Precisa de Node.js 22 ou mais novo e, para os testes do firmware, do `gcc`.

```sh
npm test
```

O comando não instala nada. Ele roda os testes do protocolo, das regras de
segurança, do laço de envio e do adaptador BLE contra um mock do Web
Bluetooth, e compila e testa o parser em C contra pacotes gerados pelo
JavaScript.

O que os testes **não** cobrem:

- o comportamento real no Bluefy e no iOS (gesto para conectar, suspensão em
  segundo plano, trava de tela);
- um módulo BLE de verdade (UUIDs, escrita sem resposta, latência, alcance);
- o firmware no alvo RISC-V: o código C só foi compilado e executado no PC;
- a interface, que só foi conferida à mão no Chrome em modo simulado.

## Publicar no GitHub Pages

1. Crie o repositório no GitHub e envie o código:
   ```sh
   git remote add origin git@github.com:USUARIO/REPOSITORIO.git
   git push -u origin main
   ```
2. No GitHub, abra **Settings → Pages**.
3. Em **Build and deployment → Source**, escolha **Deploy from a branch**.
4. Escolha a branch `main` e a pasta `/ (root)`, e salve.
5. Depois de um ou dois minutos, a página fica em
   `https://USUARIO.github.io/REPOSITORIO/`.

O arquivo `.nojekyll` faz o GitHub servir os arquivos como estão. No plano
gratuito, o GitHub Pages exige repositório público.

## Organização do código

```
index.html, css/      a página
src/dominio/          protocolo, estado e regras de segurança (código puro)
src/aplicacao/        loja de estado, laço de envio, conexão, portas
src/adaptadores/      Web Bluetooth, controladora simulada, navegador
src/ui/               controles de toque e desenho da tela
src/main.js           liga todas as peças
firmware/             parser e receptor em C para a controladora
testes/               testes em JavaScript e em C
docs/                 arquitetura e registros de decisão (ADRs)
```

Para entender ou estender o projeto, comece por
[`docs/ARQUITETURA.md`](docs/ARQUITETURA.md). As decisões de projeto e seus
motivos estão em [`docs/adr/`](docs/adr/README.md).
