/**
 * @fileoverview Portas da aplicação (arquitetura hexagonal).
 *
 * Uma porta é o contrato que a aplicação exige do mundo externo. Os
 * adaptadores em src/adaptadores/ implementam essas portas. Para trocar o
 * transporte (por exemplo, Web Serial ou WebSocket), basta escrever outro
 * adaptador com o mesmo formato de `Enlace`; nada mais muda.
 *
 * Este arquivo só contém tipos JSDoc; não há código executável.
 */

/**
 * Enlace de dados com a controladora.
 *
 * @typedef {Object} Enlace
 * @property {boolean} suportado
 *     false se o navegador não oferece o transporte.
 * @property {function(OpcoesDeConexao): Promise<void>} conectar
 *     Abre o seletor de dispositivo e conecta. Exige gesto do usuário.
 * @property {function(): Promise<void>} reconectar
 *     Reconecta ao último dispositivo, sem seletor.
 * @property {function(): Promise<void>} desconectar
 * @property {function(Uint8Array): Promise<void>} escrever
 *     Envia um pacote. A promessa resolve quando o transporte aceitou os
 *     bytes. Nunca chame de novo antes de a anterior resolver.
 * @property {function(function(Uint8Array): void): void} aoReceber
 *     Registra quem recebe os bytes vindos da controladora.
 * @property {function(function(): void): void} aoDesconectar
 *     Registra quem é avisado quando a conexão cai.
 */

/**
 * @typedef {Object} OpcoesDeConexao
 * @property {number|string} servico         UUID já normalizado
 * @property {number|string} caracteristica  UUID já normalizado
 * @property {boolean} mostrarTodos          não filtrar o seletor pelo serviço
 */

/**
 * Armazenamento da configuração.
 *
 * @typedef {Object} Armazenamento
 * @property {function(): ?Object} ler
 * @property {function(Object): void} gravar
 */

export {};
