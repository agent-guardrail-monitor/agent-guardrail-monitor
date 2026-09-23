# ALWAYS_ON Account Context

## Product requirement

After installation, one plugin instance belongs to one AI-platform account and operates in `ALWAYS_ON` mode.

The person using the AI does not need to:

- activate the plugin per chat;
- call a memory command;
- create a session manually;
- repeat permanent restrictions;
- reconnect the plugin when opening another chat.

For every controlled user turn, the platform adapter performs the internal turn bootstrap automatically.

## Internal turn sequence

```
USER SENDS MESSAGE
        |
        v
PLATFORM ADAPTER (automatic)
        |
        v
cognitive_turn_begin
        |
        +--> authenticate installed account
        +--> identify platformConversationRef
        +--> auto-register chat if new
        +--> persist explicit user turn
        +--> load current-chat recent history
        +--> retrieve relevant older turns from current chat
        +--> load project memory
        +--> load account memory
        |
        v
CONTEXT REHYDRATION
        |
        v
AI GENERATES CANDIDATE
        |
        v
59-RULE CHECK
        |
        +--> BLOCK -> controlled correction
        |
        +--> ALLOW -> accepted assistant turn is persisted
```

## Memory boundaries

### Account-global durable memory

May be relevant in every chat of the installed account:

- approved decisions;
- permanent restrictions;
- frozen elements;
- durable preferences;
- validated project state;
- success criteria;
- current superseding rules.

### Chat-local episodic history

Never crosses chat boundaries automatically:

- user messages;
- accepted assistant responses;
- local references and subjects;
- recent conversational context;
- historically relevant older turns.

Raw history from chat A is not injected into chat B.

## Context priority

1. current user message;
2. current task;
3. current chat context;
4. current project memory;
5. account-wide durable memory.

Current explicit instructions therefore remain above older remembered state.

## Historical retrieval

The plugin stores accepted turns in PostgreSQL and uses internal full-text retrieval for older turns from the same conversation.

No external memory service or embedding provider is required.

Default active history target:

- recent logical turns: 24;
- relevant older turns: up to 8;
- hard configurable bounds: 4..60 recent and 0..20 relevant.

## Acceptance rule

User messages are explicit source data and may be stored as `USER_EXPLICIT`.

Assistant candidate content is stored only after canonical `ALLOW`.

The database accepts assistant history with `accepted_source='ALLOW'`; a blocked candidate is not an accepted conversation turn and must not become durable memory merely because the model produced it.

## Integration requirement

`ALWAYS_ON` is a property of the installed plugin instance and its platform adapter.

True account-wide automatic enforcement requires the target platform to route every relevant turn through the integration's mandatory path. Where a platform does not expose such an account-level interception path, the plugin must not claim universal interception of ordinary chats that never invoke the integration.

The user-facing experience remains installation once, then automatic operation wherever the platform integration can technically attach to every turn.
