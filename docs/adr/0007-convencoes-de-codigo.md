# 0007. Convenções de código

- Status: Aceito
- Data: 2026-11-12

## Contexto

O projeto mistura JavaScript e C, e a equipe é pequena e brasileira. Sem um conjunto de regras comum, o estilo varia entre arquivos e as revisões gastam tempo em preferências pessoais.

## Decisão

Adotar guias conhecidos em vez de regras próprias.

JavaScript: Google JavaScript Style Guide, com módulos ES, `const` e `let`, camelCase para funções e variáveis, CONSTANTE_EM_MAIUSCULAS, arquivos em kebab-case, 2 espaços, ponto e vírgula e aspas simples. Os tipos são documentados em JSDoc.

C: C99, só `<stdint.h>` e `<stdbool.h>`, tipos de largura fixa, sem alocação dinâmica, prefixo `rc_` em tudo que é público. O código precisa compilar limpo com `-std=c99 -Wall -Wextra -Werror -pedantic`.

Idioma: identificadores, comentários e documentação em português, porque a equipe é brasileira. Identificadores não levam acento, para evitar problemas de teclado e de ferramentas.

Commits: Conventional Commits (`feat:`, `fix:`, `docs:`, `test:` e assim por diante).

Decisões de arquitetura: registradas como ADR, no formato de Michael Nygard.

O `.editorconfig` na raiz fixa codificação, fim de linha e indentação (2 espaços em JS, HTML, CSS, JSON e Markdown; 4 em C).

## Consequências

- Quem conhece o guia do Google já sabe o estilo. Há menos discussão em revisão.
- Misturar português nos nomes com a API do navegador, em inglês, dá nomes mistos, como `pointerdown` ao lado de `criarJoystick`. Aceitamos isso.
- Sem acentos, nomes como `aplicacao` e `dominio` parecem errados em português, mas funcionam em qualquer ambiente.
- Nenhum linter força essas regras hoje; a conferência é na revisão. O `-Werror` do C é a exceção.
