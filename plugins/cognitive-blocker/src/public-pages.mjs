function page(title, body) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · Bloqueando Alucinações</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;background:#080a09;color:#f4f6f5;margin:0}
main{max-width:760px;margin:0 auto;padding:56px 24px 80px}
h1{font-size:36px;letter-spacing:-.03em;margin:0 0 12px}h2{margin-top:34px}
p,li{color:#bac2be;line-height:1.65}strong{color:#f4f6f5}
a{color:#6db4ff}.tag{display:inline-block;border:1px solid #2b3932;border-radius:999px;padding:7px 11px;color:#8ed3ae;margin-bottom:20px}
</style>
</head><body><main><div class="tag">Bloqueando Alucinações</div><h1>${title}</h1>${body}</main></body></html>`;
}

export function publicPage(pathname) {
  if (pathname === "/") {
    return page("Menos alucinação. Memória protegida.", `
<p>Camada cognitiva para respostas e ações de IA. O plugin preserva contexto validado, aplica um catálogo fixo de bloqueios e mantém tentativas bloqueadas fora da memória aceita.</p>
<h2>Como funciona</h2>
<p><strong>Contexto protegido:</strong> decisões, restrições e histórico relevante são recuperados para o caminho controlado.</p>
<p><strong>Validação:</strong> uma candidata pode receber ALLOW, BLOCK, CORRECT ou SAFE_STOP conforme o motor canônico.</p>
<p><strong>Privacidade:</strong> cada instalação fica isolada no banco por tenant e Row Level Security.</p>
<p><a href="/privacy">Política de Privacidade</a> · <a href="/terms">Termos de Uso</a></p>
`);
  }

  if (pathname === "/privacy") {
    return page("Política de Privacidade", `
<p>Esta política descreve o tratamento de dados pelo plugin Bloqueando Alucinações.</p>
<h2>Dados processados</h2>
<p>Quando a integração é acionada, o serviço pode processar mensagens da conversa, identificadores anonimizados de sessão fornecidos pelo host, memória cognitiva validada, eventos de bloqueio e dados técnicos necessários à operação.</p>
<h2>Finalidade</h2>
<p>Os dados são usados para continuidade de contexto, aplicação dos bloqueios configurados, recuperação controlada, isolamento de conta e diagnóstico interno de falhas.</p>
<h2>Isolamento</h2>
<p>Dados de instalações diferentes são separados por conta e protegidos por políticas de Row Level Security no PostgreSQL. Histórico bruto de um chat não é automaticamente injetado em outro chat.</p>
<h2>Candidatos bloqueados</h2>
<p>Conteúdo de assistente que recebe BLOCK não é consolidado como turno aceito de conversa.</p>
<h2>Compartilhamento</h2>
<p>O serviço não vende dados de conversa a anunciantes. Provedores de infraestrutura podem processar dados somente na medida necessária para hospedar banco e aplicação.</p>
<h2>Controle</h2>
<p>A conexão pode ser removida pelo usuário na plataforma onde o plugin foi instalado. Solicitações relativas aos dados podem ser abertas pelo repositório oficial do projeto.</p>
<p><a href="https://github.com/agent-guardrail-monitor/agent-guardrail-monitor">Repositório oficial</a></p>
`);
  }

  if (pathname === "/support") {
    return page("Suporte", `
<p>Suporte do plugin Bloqueando Alucinações.</p>
<h2>Instalação e conexão</h2>
<p>Se a instalação, autenticação ou conexão MCP falhar, registre o erro com o horário aproximado, a plataforma utilizada e a etapa em que ocorreu.</p>
<h2>Privacidade e dados</h2>
<p>Solicitações sobre dados, memória cognitiva ou remoção de uma conexão podem ser abertas no repositório oficial do projeto.</p>
<h2>Canal oficial</h2>
<p><a href="https://github.com/agent-guardrail-monitor/agent-guardrail-monitor/issues">Abrir uma solicitação de suporte no GitHub</a></p>
<p><a href="/privacy">Política de Privacidade</a> · <a href="/terms">Termos de Uso</a></p>
`);
  }

  if (pathname === "/terms") {
    return page("Termos de Uso", `
<p>Bloqueando Alucinações é uma camada de controle para caminhos de IA tecnicamente integrados ao plugin.</p>
<h2>Escopo</h2>
<p>O plugin aplica seu catálogo canônico somente nos turnos, respostas e ações que efetivamente passam pela integração. A instalação não cria autoridade sobre caminhos que a plataforma não encaminha ao plugin.</p>
<h2>Disponibilidade</h2>
<p>Falhas de rede, plataforma, autenticação ou infraestrutura podem interromper a validação. Superfícies com enforcement obrigatório devem operar em modo seguro quando a validação não puder ser comprovada.</p>
<h2>Responsabilidade do usuário</h2>
<p>O usuário continua responsável por revisar decisões importantes e por autorizar ações destrutivas ou externas quando aplicável.</p>
<h2>Evolução</h2>
<p>O produto pode receber atualizações de segurança e compatibilidade, preservando o catálogo canônico e as decisões explicitamente aprovadas do projeto.</p>
`);
  }

  return null;
}
