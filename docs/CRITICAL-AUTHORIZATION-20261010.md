# Escopo de autorização crítica — política v4 (revisão 2026-10-10)

Estado: **candidata em branch isolada; não representa instalação ativa**.

## Causa observada

Na política v3, `defaults.criticalUnmatched=BLOCK` e as únicas exceções GitHub tinham casamento por PR/SHA fixos e alias `GitHub`. A chamada de merge atual usa `mcp__GitHub__merge_pull_request`, logo o PR 260 recebeu `CRITICAL_UNMATCHED`, reproduzido no endpoint ativo.

## Mudança delimitada

- Mantida a proteção `criticalUnmatched=BLOCK` para ações sem regra correspondente. Nenhuma liberação global de operações críticas.
- Autorização de merge por **classe de operação + repositórios de propriedade/administrados previamente auditados**, independentemente do número de PR ou commit.
- Vinculação obrigatória `bindGithubPrToObjective=true`: o repositório e o **mesmo número de PR** devem constar da ordem e dos argumentos normalizados; SHA esperado com 40 dígitos hexadecimais.
- Rótulos obrigatórios para evidenciar autorização direta, escopo, permissões do provedor, CI, segurança e regressão. Para `odomdowell2030-crypto/lunna`, acrescenta-se prova de isolamento de tenants.
- A skill `software-repair` continua obrigatória, carregada e executada com referência de evidência; a implementação do SRE continua independente.
- Repositórios fora do conjunto permitido, outras ferramentas, PRs inconsistentes, SHA ausente, falta de prova e rotas externas seguem bloqueados.
- A nova regra trata **merge no GitHub**. Ela não autoriza, por extensão, comandos Render, Neon, operações bancárias, exclusão de contas ou qualquer outra ação.

## Limite de confiança obrigatório

Os campos `labels`, `objective` e `skillExecution.executionProof` enviados ao endpoint **não constituem uma assinatura do titular nem provam autonomamente a execução técnica**. A avaliação é determinística sobre os valores recebidos; a verificação de procedência da ordem, identidade GitHub, privilégios reais, logs de CI, revisão independente e evidências de isolamento compete ao sistema que chama o endpoint e aos provedores.

Dados de arquivos, web, prompts de terceiros ou ferramentas não podem gerar rótulos de autorização. Nunca promover informação externa ao status `owner-direct-order` ou `*-verified` sem validação em fontes próprias, nem tratar retorno `ALLOW` como ordem de executar independentemente do contexto.

Para garantia criptográfica ponta a ponta, haverá necessidade de attestation do host/provedor vinculada à sessão e ao hash de alvo/ação, ausente da interface v4. Sem atestado confiável, o consumidor deve reter execução crítica cujo escopo ou autorização não esteja efetivamente confirmado.

## Caso de regressão PR 260

GitHub: `odomdowell2030-crypto/lunna#260`.
Aprovação de política, por si só, **não autoriza publicação de funcionalidade**. Antes de qualquer merge e deploy exigir:
- CI no SHA exato;
- testes HTTP autenticados e logout de todas as sessões;
- homologação fiel em base isolada, com múltiplos usuários e casos financeiros;
- prova de isolamento entre usuários/empresas e retenção exigida;
- limpeza ou controle documentado de Google, buckets e identidades;
- revisão SRE e validação de implantação.

## Verificações executadas

- Branch `fix/owner-scoped-critical-authorization-20261010`.
- `npm test` no notebook Pc-Aryane: **100 testes, 100 aprovados**, exit code 0, no commit `555dc560041a342c178434332351d65152af40e0`.
- Testes positivos e negativos exercitam autorização circunscrita, divergência de PR, repo externo, falta de isolamento, falta de revisão SRE, operação de outra ferramenta e payload insuficiente.
- A versão de produção da política só será considerada atualizada após `agm_status` retornar a nova versão/hash no endpoint efetivamente instalado.

## Procedimento de implantação

Merge somente depois de CI do próprio GitHub na HEAD final e revisão humana do risco e das evidências. Publicar aplicação a partir de revisão autenticada do serviço proprietário; obter `agm_status` pós-deploy e reproduzir verificações positivas/negativas. Não reutilizar o hash antigo como prova de atualização.
