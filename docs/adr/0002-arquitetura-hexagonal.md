# 0002. Arquitetura hexagonal

- Status: Aceito
- Data: 2026-11-12

## Contexto

O módulo BLE ainda não está definido: hoje o padrão é o HM-10, mas pode mudar, e outro transporte (Web Serial, por exemplo) pode ser útil. O firmware está em desenvolvimento, então precisamos exercitar a página sem hardware. Além disso, um colega precisa conseguir ler o protocolo e as regras de segurança sem passar pelo código de interface e de Bluetooth.

## Decisão

Adotar a arquitetura hexagonal (portas e adaptadores, de Alistair Cockburn). As dependências apontam para dentro: `ui` e `adaptadores` dependem de `aplicacao`, que depende de `dominio`. O domínio é puro: sem DOM, sem BLE e sem relógio. As portas (`Enlace`, `Armazenamento`) são typedefs JSDoc em `src/aplicacao/portas.js`. Só `src/main.js` conhece todas as camadas e liga as peças.

Alternativas consideradas:

- Arquivo único: mais rápido no começo, mas mistura regra, DOM e Bluetooth, e só se testa no navegador com hardware.
- MVC: separa a tela, mas não isola o transporte. A regra continuaria acoplada a quem a chama.

## Consequências

- O enlace falso (`enlace-simulado.js`, ativado com `?simular`) e os testes usam a mesma porta que o BLE real.
- Trocar o transporte significa escrever um adaptador novo e alterar só `main.js`.
- O protocolo e o estado são módulos puros que podem ser lidos e testados isoladamente.
- Há mais arquivos e mais indireção do que um arquivo único. Aceitamos esse custo.
- A regra de dependência é uma convenção; nenhuma ferramenta a verifica hoje.
