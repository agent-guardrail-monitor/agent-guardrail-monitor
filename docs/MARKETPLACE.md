# Publicação no GitHub Marketplace — O Guardião - W

Este documento guarda os dados de publicação do produto.

## Nome público

- Nome: **O Guardião - W**
- Identificador técnico atual: `agent-guardrail-monitor`
- Plano inicial: **Grátis**
- Versão: `0.3.0-alpha.2`

## Texto curto

> Sua IA trabalha. O Guardião confere se ela continua respeitando as regras.

## Descrição principal

O Guardião - W acompanha as travas de segurança dos robôs de IA usados pela empresa.

Quando um robô faz o que não podia, O Guardião identifica a falha, guarda a prova e prepara o conserto.

O fluxo é simples:

**acha → prova → conserta → testa → fecha**

O usuário vê apenas três estados:

- **APROVADO**: a trava de segurança está funcionando conforme a prova disponível.
- **FALHA**: o robô fez o que não podia ou uma trava deixou de funcionar.
- **DESCONHECIDO**: ainda falta prova para confirmar.

O Guardião nunca transforma falta de prova em aprovação.

## Como o conserto funciona

O Guardião compara o estado atual com o último estado aprovado.

Quando o problema pode ser resolvido com segurança, ele prepara o conserto usando esse estado aprovado como referência.

Por padrão, o conserto fica separado para revisão.

O modo totalmente automático só funciona quando o usuário escolhe essa opção.

## Público inicial

Empresas brasileiras que usam robôs de IA para programar, incluindo:

- Claude Code
- OpenAI Codex
- GitHub Copilot

## Mensagem principal da página

### Título

**Sua IA trabalha. O Guardião confere se ela continua respeitando as regras.**

### Subtítulo

**Quando um robô faz o que não podia, O Guardião acha, prova, conserta, testa e fecha.**

### Chamada

**Conectar O Guardião - W ao GitHub**

## Configuração técnica da publicação

- App ID atual: `5007193`
- Identificador técnico atual: `agent-guardrail-monitor`
- Repositório: `agent-guardrail-monitor/agent-guardrail-monitor`
- Plano inicial: **Free**
- Página inicial: `https://agent-guardrail-monitor.onrender.com/`
- Conexão: `https://agent-guardrail-monitor.onrender.com/setup`
- Privacidade: `https://agent-guardrail-monitor.onrender.com/privacy`
- Termos: `https://agent-guardrail-monitor.onrender.com/terms`
- Contrato: `https://agent-guardrail-monitor.onrender.com/eula`
- Ajuda: `https://agent-guardrail-monitor.onrender.com/support`
- Retorno de conexão: `https://agent-guardrail-monitor.onrender.com/oauth/callback`
- Recebimento de eventos: `https://agent-guardrail-monitor.onrender.com/webhook`

## Permissões necessárias

Para verificar e preparar consertos:

- leitura de informações básicas;
- leitura e escrita dos arquivos necessários para o conserto;
- leitura e escrita das verificações;
- leitura e escrita das propostas de alteração.

As permissões de escrita são usadas pelo conserto do O Guardião.

## Estado atual da publicação

O código do produto está em produção.

Ainda faltam, na área administrativa do GitHub:

1. autenticar a conta responsável;
2. atualizar o nome público para **O Guardião - W**;
3. gerar o segredo necessário para concluir a conexão do Marketplace;
4. aprovar as novas permissões;
5. subir logo, imagem principal e capturas;
6. confirmar o plano gratuito;
7. aceitar o contrato do GitHub Marketplace;
8. enviar para revisão.

## Regra de comunicação

Toda linguagem pública deve seguir este vocabulário:

- guardrail = trava de segurança
- quebrou guardrail = robô fez o que não podia
- hook = gatilho automático
- policy = regra
- regression = voltou a quebrar
- evidence = prova
- check = verificação
- repair = conserto
- PASS = APROVADO
- FAIL = FALHA
- UNKNOWN = DESCONHECIDO

Fluxo público:

**acha → prova → conserta → testa → fecha**
