import { hashObject } from "./policy.mjs";

export class VersionedRegistry {
  constructor(name, records = []) {
    this.name = String(name);
    this.records = new Map();
    for (const record of records) this.upsert(record);
  }

  upsert(record) {
    if (!record?.id) throw new Error(this.name + " record requires id");
    const prior = this.records.get(record.id);
    const nextVersion = prior ? Number(prior.version || 0) + 1 : Number(record.version || 1);
    const stored = {
      ...record,
      version: nextVersion,
      status: record.status || "ACTIVE",
      updatedAt: new Date().toISOString()
    };
    if (!stored.createdAt) stored.createdAt = prior?.createdAt || stored.updatedAt;
    stored.hash = hashObject({ ...stored, hash: undefined });
    this.records.set(stored.id, stored);
    return stored;
  }

  get(id) {
    return this.records.get(id) || null;
  }

  active() {
    return [...this.records.values()].filter((record) => record.status === "ACTIVE");
  }

  snapshot() {
    const records = [...this.records.values()].sort((a, b) => a.id.localeCompare(b.id));
    return {
      registry: this.name,
      generatedAt: new Date().toISOString(),
      records,
      hash: hashObject(records)
    };
  }
}
