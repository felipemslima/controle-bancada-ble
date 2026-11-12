# 0004. Sem build e sem dependências

- Status: Aceito
- Data: 2026-11-12

## Contexto

A página é pequena e roda em navegadores modernos, incluindo o Bluefy. Ela é publicada no GitHub Pages direto do repositório. Cada ferramenta de build ou biblioteca acrescenta um ponto de falha e algo a manter, e em um sistema em que a segurança importa queremos poder ler todo o código que roda.

## Decisão

- Módulos ES nativos, servidos como estão. Não há bundler, transpilador nem `package.json` de dependências.
- JSDoc para documentar os tipos, em vez de TypeScript.
- Testes com `node --test` (embutido no Node) para o JavaScript e com `gcc` para o C do firmware.

Alternativas descartadas: TypeScript com build, e um framework de interface.

## Consequências

- O que está no repositório é o que roda no navegador. Não existe passo de build para quebrar.
- Novos colegas só precisam de Node e gcc para rodar os testes.
- Não há checagem de tipos automática. O JSDoc documenta, mas nada falha se um tipo estiver errado; a proteção vem dos testes.
- Não há minificação. No tamanho atual do código isso é irrelevante.
- Cada módulo é um arquivo separado carregado por requisição; em uma página pequena, o custo é desprezível.
- Sem biblioteca, escrevemos nós mesmos a loja e os controles de toque. São poucas linhas, mas ficam sob nossa manutenção.
