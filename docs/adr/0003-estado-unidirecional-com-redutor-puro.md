# 0003. Estado unidirecional com redutor puro

- Status: Aceito
- Data: 2026-11-12

## Contexto

A página tem várias fontes de eventos: toques, queda da conexão, perda de foco, telemetria e o relógio do envio. Todas podem exigir que o protótipo seja desarmado e que os valores sejam zerados. Se essas regras ficarem espalhadas em variáveis e callbacks da interface, é fácil esquecer um caminho, e uma falha aqui é um problema de segurança.

## Decisão

Usar um fluxo unidirecional no estilo Flux/Redux, sem biblioteca: ações, redutor puro (`src/dominio/estado.js`), loja (`src/aplicacao/loja.js`) e assinantes. Toda regra de segurança da página mora no redutor. A função `comandoDeSaida()` é o único ponto que decide o que vai para o rádio.

A loja aplica as ações em fila e em ordem, mesmo quando um assinante despacha outra ação, para que ninguém veja estados fora de sequência.

Alternativa descartada: guardar o estado em variáveis dos componentes de interface. Cada componente teria de lembrar de desarmar e zerar nos eventos que lhe dizem respeito.

## Consequências

- Toda regra pode ser testada com `node --test`, sem navegador: basta chamar `reduzir` com uma ação e comparar o estado.
- Para entender "por que desarmou", há um só lugar para olhar. O estado guarda o último motivo (`motivoDesarme`).
- Estados são imutáveis (`Object.freeze`), o que evita alterações escondidas.
- Escrever uma ação e um `case` para cada mudança é mais cerimonioso do que atribuir uma variável. Aceitamos isso.
- A interface precisa se redesenhar a partir do estado, em vez de guardar cópias dele.
