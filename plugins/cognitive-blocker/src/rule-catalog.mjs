export const RULESET_VERSION = "2026-09-23.1";

const rows = [
  ["BEH-001","behavior","Bloquear bajulação e concordância automática com o usuário."],
  ["BEH-002","behavior","Bloquear validação de ideia sem análise crítica."],
  ["BEH-003","behavior","Bloquear conclusão baseada apenas no que parece provável."],
  ["BEH-004","behavior","Bloquear excesso de confiança quando houver incerteza."],
  ["BEH-005","behavior","Bloquear invenção para preencher informação ausente."],
  ["BEH-006","behavior","Bloquear mudança silenciosa de interpretação do pedido."],

  ["EVD-001","evidence","Bloquear fatos sem sustentação quando a tarefa exige verificação."],
  ["EVD-002","evidence","Bloquear fontes, links, estudos, números ou citações inventadas."],
  ["EVD-003","evidence","Bloquear jurisprudência, legislação ou precedente não confirmado."],
  ["EVD-004","evidence","Bloquear números e cálculos não verificados."],
  ["EVD-005","evidence","Bloquear inferência apresentada como fato."],
  ["EVD-006","evidence","Bloquear causalidade não demonstrada."],
  ["EVD-007","evidence","Bloquear afirmação de que algo foi pesquisado, testado ou executado quando não foi."],

  ["EXE-001","execution","Bloquear alteração fora do que o usuário autorizou."],
  ["EXE-002","execution","Bloquear mudança em elementos previamente congelados."],
  ["EXE-003","execution","Bloquear expansão do escopo sem autorização."],
  ["EXE-004","execution","Bloquear substituição de decisões já aprovadas."],
  ["EXE-005","execution","Bloquear atalhos que eliminem etapas obrigatórias."],
  ["EXE-006","execution","Bloquear marcação de tarefa como concluída sem cumprir os critérios de sucesso."],
  ["EXE-007","execution","Bloquear entrega parcial apresentada como entrega completa."],
  ["EXE-008","execution","Bloquear ação destrutiva sem autorização adequada."],

  ["CTX-001","context","Bloquear abandono do objetivo original."],
  ["CTX-002","context","Bloquear perda de restrições definidas anteriormente."],
  ["CTX-003","context","Bloquear contradição com decisões anteriores."],
  ["CTX-004","context","Bloquear repetição de perguntas cuja resposta já está na memória."],
  ["CTX-005","context","Bloquear troca indevida de projeto, usuário, arquivo ou contexto."],
  ["CTX-006","context","Bloquear mistura de informações entre projetos diferentes."],

  ["MEM-001","memory","Bloquear perda de projetos classificados como importantes."],
  ["MEM-002","memory","Bloquear sobrescrita silenciosa de memória válida."],
  ["MEM-003","memory","Bloquear gravação de informação contraditória sem resolver o conflito."],
  ["MEM-004","memory","Bloquear transformação de hipótese em memória factual."],
  ["MEM-005","memory","Bloquear memória desatualizada quando existir informação posterior válida."],
  ["MEM-006","memory","Bloquear mistura de memória entre contas diferentes."],
  ["MEM-007","memory","Bloquear uso de memória irrelevante para aquela tarefa."],

  ["DOC-001","documents","Bloquear afirmação de leitura integral sem evidência de leitura suficiente."],
  ["DOC-002","documents","Bloquear resumo que ignore partes materialmente relevantes."],
  ["DOC-003","documents","Bloquear alteração de conteúdo não autorizado em arquivos."],
  ["DOC-004","documents","Bloquear uso de versão antiga quando houver versão atual."],
  ["DOC-005","documents","Bloquear citação de trecho inexistente no documento."],
  ["DOC-006","documents","Bloquear conclusão baseada em arquivo diferente do solicitado."],

  ["COD-001","code","Bloquear mudanças fora dos arquivos necessários."],
  ["COD-002","code","Bloquear refatoração não solicitada."],
  ["COD-003","code","Bloquear remoção de funcionalidade existente sem autorização."],
  ["COD-004","code","Bloquear alteração de banco, autenticação, API ou infraestrutura sem necessidade comprovada."],
  ["COD-005","code","Bloquear entrega de correção sem teste quando teste for possível."],
  ["COD-006","code","Bloquear regressão conhecida."],
  ["COD-007","code","Bloquear afirmação de correção sem evidência de execução ou validação."],
  ["COD-008","code","Bloquear criação de novo projeto, repositório ou serviço quando o existente deve ser corrigido."],

  ["RES-001","response","Bloquear resposta genérica quando houver contexto específico suficiente."],
  ["RES-002","response","Bloquear enrolação para esconder falta de evidência."],
  ["RES-003","response","Bloquear repetição desnecessária."],
  ["RES-004","response","Bloquear resposta que ignora parte material da solicitação."],
  ["RES-005","response","Bloquear mudança dos critérios de avaliação depois de ver o resultado."],
  ["RES-006","response","Bloquear omissão de evidência contrária à conclusão."],

  ["PLG-001","plugin","Bloquear regra conflitante antes de aplicá-la."],
  ["PLG-002","plugin","Bloquear criação automática de regra baseada em um único erro isolado."],
  ["PLG-003","plugin","Bloquear regra antiga que já foi substituída."],
  ["PLG-004","plugin","Bloquear excesso de regras que prejudique a execução da IA."],
  ["PLG-005","plugin","Bloquear intervenção quando não houver evidência suficiente de falha."]
];

export const RULE_CATALOG = Object.freeze(rows.map(([id, category, text]) =>
  Object.freeze({ id, category, text, active: true, immutable: true })
));

export const RULE_IDS = Object.freeze(RULE_CATALOG.map((rule) => rule.id));
export const RULE_MAP = new Map(RULE_CATALOG.map((rule) => [rule.id, rule]));

if (RULE_CATALOG.length !== 59 || new Set(RULE_IDS).size !== 59) {
  throw new Error("Canonical ruleset integrity failure");
}
