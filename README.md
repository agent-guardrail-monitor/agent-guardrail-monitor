# O Guardião - W

**Sua IA trabalha. O Guardião confere se ela continua respeitando as regras.**

O Guardião - W acompanha as travas de segurança dos robôs de IA usados pela sua empresa.

Hoje, robôs como Claude Code, OpenAI Codex e GitHub Copilot podem receber atualizações e mudar de comportamento.

O Guardião acompanha isso continuamente.

Quando um robô faz o que não podia, ele:

**acha → prova → conserta → testa → fecha**

## O que você vê

O Guardião usa apenas três estados:

### APROVADO

A trava de segurança está funcionando conforme a prova disponível.

### FALHA

O robô fez o que não podia ou uma trava de segurança deixou de funcionar.

Quando o problema pode ser consertado com segurança, O Guardião prepara o conserto.

### DESCONHECIDO

Ainda falta prova para confirmar o funcionamento.

O Guardião nunca transforma falta de prova em aprovação.

## Auditoria automática

Na primeira instalação, O Guardião faz uma auditoria imediatamente.

Depois, ele verifica o ambiente todos os dias às **05:00, horário de Brasília**.

Se o horário for perdido, O Guardião executa a auditoria na primeira oportunidade do mesmo dia.

Dentro do ChatGPT ou Claude, o usuário pode pedir:

- **Ver minha última auditoria**
- **O que você consertou?**
- **Mostra as falhas recentes**
- **Verificar agora**

Toda comunicação sobre auditorias, falhas e consertos acontece **dentro do ChatGPT ou do Claude**.

O Guardião não usa e-mail, WhatsApp ou SMS para avisar o usuário.

## Como o conserto funciona

O Guardião compara o estado atual com o último estado aprovado.

Quando consegue identificar exatamente o que voltou a quebrar, ele restaura a trava de segurança usando esse estado aprovado como referência.

Por padrão, o conserto fica separado para sua equipe revisar antes de entrar no sistema principal.

O modo totalmente automático só funciona quando você escolher essa opção.

## O que ele acompanha

O Guardião começa acompanhando robôs de IA usados para programar:

- Claude Code
- OpenAI Codex
- GitHub Copilot

A proposta é simples: sua empresa pode usar IA com mais controle e saber quando uma trava de segurança realmente continua funcionando.

## Por que isso importa

Um robô pode continuar funcionando normalmente enquanto uma trava de segurança deixou de funcionar.

Esse é o tipo de falha que O Guardião procura.

Ele mantém a diferença clara entre:

**APROVADO**  
**FALHA**  
**DESCONHECIDO**

## Instalar

O plano inicial será gratuito.

[Conectar O Guardião - W ao GitHub](https://github.com/apps/agent-guardrail-monitor)

## Para sua equipe técnica

A tecnologia interna continua com o identificador `agent-guardrail-monitor` e o comando `agm`.

Os detalhes técnicos, instalação local, testes e integrações ficam na pasta [docs](docs/).

Versão atual: **0.3.0-alpha.3**

---

**O Guardião - W**

Acha. Prova. Conserta. Testa. Fecha.
