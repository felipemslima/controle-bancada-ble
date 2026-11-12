# 0006. Modelo de segurança

- Status: Aceito
- Data: 2026-11-12

## Contexto

O protótipo tem hélices e fica preso em bancada. Um comando errado pode causar dano ou ferimento. A página roda em um celular, com Bluetooth, e pode perder foco, conexão ou a tela a qualquer momento. Segurança vale mais que conveniência.

## Decisão

Defesa em profundidade: várias barreiras independentes, para que uma falha de uma delas seja coberta por outra. A página é a primeira barreira. O firmware é a última e não confia na página: ele valida tudo de novo.

Na página (detalhes e arquivos em `ARQUITETURA.md`):

- O redutor puro desarma e zera os eixos em todos os eventos de risco.
- `comandoDeSaida()` é o único ponto de saída, e `codificarComando()` zera os valores de novo se o comando é desarmado ou de parada.
- O transmissor não tem fila e envia na hora ao desarmar.
- Uma escrita travada por mais de 1 s derruba a conexão.
- Os controles são relativos ao ponto de toque, e armar exige segurar o botão.
- Perder o foco desarma.

No firmware:

- Trava de parada, que só sai com pacote desarmado e zerado.
- Armar só com todos os valores em zero.
- Limites de saturação, checagem de sequência e failsafe por timeout.

Alternativa rejeitada: fila de envio. Com ela, valores antigos ainda sairiam depois de um PARAR, atrás do pacote de parada na fila. Em vez disso, só uma escrita fica em andamento e cada pacote é montado no momento do envio.

## Consequências

- Os testes podem cobrir cada barreira separadamente.
- Parte da lógica de segurança existe duas vezes (página e firmware). É redundância deliberada.
- O usuário enfrenta atritos de propósito: segurar um segundo para armar, desarmar antes de mudar ajustes ou de desconectar.
- Uma queda de conexão desarma, e reconectar nunca rearma sozinho.
- A página não consegue garantir o que acontece fora do primeiro plano. Nesse caso, quem protege é o failsafe do firmware.
