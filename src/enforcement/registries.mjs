import { VersionedRegistry } from "./registry.mjs";

export class DirectiveRegistry extends VersionedRegistry {
  constructor(records = []) { super("directives", records); }
}
export class MemoryRegistry extends VersionedRegistry {
  constructor(records = []) { super("memory", records); }
}
export class SkillRegistry extends VersionedRegistry {
  constructor(records = []) { super("skills", records); }
}
export class ToolRegistry extends VersionedRegistry {
  constructor(records = []) { super("tools", records); }
}
export class TaskStateRegistry extends VersionedRegistry {
  constructor(records = []) { super("task-state", records); }
}
export class PolicyRegistry extends VersionedRegistry {
  constructor(records = []) { super("policies", records); }
}
