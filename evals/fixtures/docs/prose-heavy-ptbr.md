# Notas do Projeto — Migração do Sistema de Pagamentos

## Contexto e Motivação

É importante notar que o sistema de pagamentos atual foi construído originalmente em 2019, e na verdade ele nunca foi projetado para suportar o volume de transações que processamos atualmente. Basicamente, a arquitetura original assumia que todas as transações seriam processadas de forma síncrona, e devido ao fato de que o nosso volume cresceu aproximadamente dez vezes nos últimos dois anos, essa suposição se tornou um gargalo significativo para a operação como um todo.

Além disso, vale a pena mencionar que o provedor de pagamentos que utilizamos atualmente anunciou que a versão da API que consumimos será descontinuada em 2026-12-31, o que significa que de qualquer forma seríamos obrigados a fazer uma migração até o final do ano.

## Decisão de Arquitetura

Depois de avaliar as opções disponíveis, a equipe decidiu adotar um modelo de processamento assíncrono baseado em filas. Neste momento, a proposta é utilizar o RabbitMQ que já temos em produção para outros fluxos, a fim de evitar a introdução de uma nova peça de infraestrutura que a equipe ainda não sabe operar.

Tenha em mente que essa decisão tem uma consequência importante para o frontend: como o processamento passa a ser assíncrono, a interface do usuário precisa ser atualizada para refletir o estado pendente da transação, e o resultado final precisa ser comunicado através de uma notificação em tempo real ou de polling. A equipe de frontend estimou que esse trabalho leva aproximadamente três semanas.

## Plano de Migração

O plano é essencialmente dividido em três fases. Na primeira fase, vamos simplesmente introduzir a fila entre o recebimento da requisição e o processamento, mantendo o comportamento síncrono do ponto de vista do cliente. Na segunda fase, vamos migrar os clientes internos para o novo fluxo assíncrono, um por um, monitorando as métricas de erro a cada etapa do processo. Na terceira fase, vamos finalmente migrar os clientes externos e descontinuar o endpoint síncrono antigo.

Certifique-se de revisar o runbook de rollback antes de iniciar cada fase, porque no entanto bem planejada que a migração esteja, sempre existe a possibilidade de que algo inesperado aconteça em produção, e nesse caso é fundamental que qualquer pessoa da equipe seja capaz de reverter para o estado anterior em poucos minutos.

## Riscos Conhecidos

É importante destacar que o maior risco identificado até agora é a duplicação de cobranças durante a janela de transição. Para mitigar esse risco, todas as mensagens na fila carregam uma chave de idempotência, e o consumidor verifica essa chave contra o banco de dados antes de processar qualquer cobrança. Além disso, configuramos alertas específicos para detectar padrões de cobrança duplicada nas primeiras 48 horas de cada fase.
