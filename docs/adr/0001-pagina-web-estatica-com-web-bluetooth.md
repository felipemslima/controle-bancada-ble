# 0001. Página web estática com Web Bluetooth

- Status: Aceito
- Data: 2026-11-12

## Contexto

Precisamos de um controle remoto para enviar setpoints à controladora de voo durante os testes de bancada. O desenvolvimento acontece sem Mac e sem conta de desenvolvedor Apple, e o controle será usado principalmente em um iPhone. O iOS não oferece o perfil SPP do Bluetooth clássico para apps comuns, então módulos como HC-05 e HC-06 não servem. Os módulos BLE de UART transparente (tipo HM-10) funcionam no iOS.

## Decisão

Fazer uma página web estática que fala BLE por Web Bluetooth. No iPhone ela roda no Bluefy, porque o Safari não implementa Web Bluetooth. Em Android e PC roda no Chrome ou no Edge. A página é publicada no GitHub Pages, que serve HTTPS, requisito do Web Bluetooth.

Alternativas descartadas:

- App nativo iOS: exige Mac e conta de desenvolvedor Apple, que não temos.
- Bluetooth clássico (HC-05/HC-06): não funciona no iOS.

## Consequências

- Não há instalação nem loja de aplicativos: basta abrir a URL.
- Não existe execução em segundo plano. Se a página sair do primeiro plano, ela para de enviar; por isso a perda de foco desarma (ver ADR 0006).
- A conexão BLE só pode ser iniciada por um gesto do usuário, como um toque. Não dá para reconectar sozinho depois de recarregar a página.
- O suporte a wake lock (manter a tela acesa) no Bluefy é incerto. A página tenta usá-lo e, se faltar, depende da regra de perda de foco.
- Dependemos de um navegador de terceiros (Bluefy) no iPhone e do comportamento dele.
