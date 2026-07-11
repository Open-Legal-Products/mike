# Solicitação de Validação Jurídica — Licença AGPL-3.0 do Mike

## Projeto

Mike OSS — fork `Edu-Carone-SA/mike` originado de `Open-Legal-Products/mike`.
Licença declarada: `AGPL-3.0-only`.

## Contexto

A Atlas pretende implantar o Mike para uso interno, com possibilidade futura de oferecimento a clientes externos. A AGPL-3.0 impõe obrigações específicas para software acessado por rede, inclusive a oferta do código-fonte correspondente aos usuários do serviço.

## Perguntas para validação jurídica

1. **Uso interno**: O mero uso interno pela Atlas (funcionários e prestadores) desencadeia alguma obrigação de distribuição do código-fonte?
2. **Oferta a clientes**: Se o sistema for disponibilizado a clientes externos (SaaS), qual é o mecanismo, prazo e escopo exato da oferta do código-fonte exigido pela Seção 13 da AGPL?
3. **Corresponding Source**: As customizações da Atlas (código de branding, infraestrutura Terraform, políticas internas, documentação de operação) devem ser incluídas na oferta? Até onde vai o limite?
4. **Proteção de know-how**: É possível manter separado e proprietário o conteúdo jurídico, datasets de treinamento internos e configurações operacionais sem violar a AGPL?
5. **LGPD + AGPL**: Como conciliar a retenção de logs/auditoria exigida pela LGPD com a eventual obrigação de fornecer código-fonte?
6. **Sub-licenciamento**: Podemos exigir que usuários externos aceitem termos adicionais de uso aceitável sem conflito com a AGPL?
7. **Upstream sync**: A obrigação de oferecer código se aplica apenas ao fork da Atlas ou também a dependências upstream?

## Materiais anexos

- Cópia do `LICENSE` do upstream.
- `docs/adr/ADR-004-agpl-compliance.md`.
- Lista de modificações previstas para a Atlas (ver sprints subsequentes).

## Decisão esperada

Parecer jurídico sobre viabilidade de uso da AGPL-3.0 no cenário Atlas e mecanismo de conformidade a ser implementado antes do go-live.

## Bloqueio de produção

A produção com dados reais é **NO-GO** até a obtenção deste parecer.
