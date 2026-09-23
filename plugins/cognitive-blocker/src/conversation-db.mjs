import { withAccountContext } from "./db.mjs";

export async function ensureConversation(accountId, input) {
  const ref = String(input.platformConversationRef || "").trim();
  if (!ref) {
    throw Object.assign(new Error("platform_conversation_ref_required"), {
      code: "PLATFORM_CONVERSATION_REF_REQUIRED"
    });
  }

  return withAccountContext(accountId, async (client) => {
    const result = await client.query(
      `INSERT INTO cognitive_conversations
         (account_id, platform_conversation_ref, title, metadata)
       VALUES ($1,$2,$3,$4::jsonb)
       ON CONFLICT(account_id, platform_conversation_ref)
       DO UPDATE SET
         title = COALESCE(EXCLUDED.title, cognitive_conversations.title),
         metadata = cognitive_conversations.metadata || EXCLUDED.metadata,
         last_seen_at = now()
       RETURNING id, account_id, platform_conversation_ref, title,
                 metadata, created_at, last_seen_at`,
      [
        accountId,
        ref,
        input.title ? String(input.title).slice(0, 300) : null,
        JSON.stringify(input.metadata || {})
      ]
    );
    return result.rows[0];
  });
}

export async function appendAcceptedTurn(accountId, conversationId, input) {
  const turnKey = String(input.turnKey || "").trim();
  const content = String(input.content || "").trim();
  const role = input.role === "assistant" ? "assistant" : "user";
  const source = role === "assistant" ? "ALLOW" : "USER_EXPLICIT";

  if (!turnKey) {
    throw Object.assign(new Error("turn_key_required"), { code: "TURN_KEY_REQUIRED" });
  }
  if (!content) return null;

  return withAccountContext(accountId, async (client) => {
    const result = await client.query(
      `INSERT INTO cognitive_turns
         (account_id, conversation_id, turn_key, role, content, accepted_source)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT(account_id, conversation_id, turn_key)
       DO NOTHING
       RETURNING id, conversation_id, turn_key, role, content,
                 accepted_source, created_at`,
      [accountId, conversationId, turnKey, role, content, source]
    );

    await client.query(
      `UPDATE cognitive_conversations
       SET last_seen_at = now()
       WHERE id = $1 AND account_id = $2`,
      [conversationId, accountId]
    );

    return result.rows[0] || null;
  });
}

export async function loadConversationContext(accountId, conversationId, queryText, options = {}) {
  const recentLimit = Math.max(4, Math.min(60, Number(options.recentLimit) || 24));
  const relevantLimit = Math.max(0, Math.min(20, Number(options.relevantLimit) || 8));
  const query = String(queryText || "").trim();

  return withAccountContext(accountId, async (client) => {
    const recentResult = await client.query(
      `SELECT id, turn_key, role, content, accepted_source, created_at
       FROM cognitive_turns
       WHERE account_id = $1 AND conversation_id = $2
       ORDER BY created_at DESC, id DESC
       LIMIT $3`,
      [accountId, conversationId, recentLimit]
    );

    const recent = [...recentResult.rows].reverse();
    const recentIds = recent.map((row) => row.id);

    let relevant = [];
    if (query && relevantLimit > 0) {
      const relevantResult = await client.query(
        `SELECT id, turn_key, role, content, accepted_source, created_at,
                ts_rank_cd(
                  to_tsvector('simple', content),
                  plainto_tsquery('simple', $3)
                ) AS rank
         FROM cognitive_turns
         WHERE account_id = $1
           AND conversation_id = $2
           AND to_tsvector('simple', content) @@ plainto_tsquery('simple', $3)
           AND NOT (id = ANY($4::uuid[]))
         ORDER BY rank DESC, created_at DESC
         LIMIT $5`,
        [accountId, conversationId, query, recentIds, relevantLimit]
      );
      relevant = relevantResult.rows;
    }

    return { recent, relevant };
  });
}

export async function countConversations(accountId) {
  return withAccountContext(accountId, async (client) => {
    const result = await client.query(
      `SELECT count(*)::int AS count
       FROM cognitive_conversations
       WHERE account_id = $1`,
      [accountId]
    );
    return Number(result.rows[0]?.count || 0);
  });
}
