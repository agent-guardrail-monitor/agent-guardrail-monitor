import { hashObject } from "./policy.mjs";

const TERMINAL = new Set(["COMPLETED", "CANCELLED"]);

export class TaskStateMachine {
  constructor({ id, originalObjective, ...rest } = {}) {
    if (!id) throw new Error("task id is required");
    if (!originalObjective) throw new Error("originalObjective is required");
    this.state = {
      id,
      originalObjective,
      subObjectives: [],
      currentPlan: [],
      currentStep: null,
      currentAction: null,
      evidence: [],
      status: "PLANNED",
      createdAt: new Date().toISOString(),
      ...rest
    };
    this.events = [];
    this.record("TASK_CREATED", { objectiveHash: hashObject(originalObjective) });
  }

  record(type, data = {}) {
    const event = { index: this.events.length, at: new Date().toISOString(), type, data };
    this.events.push(event);
    return event;
  }

  setPlan(plan) {
    if (TERMINAL.has(this.state.status)) throw new Error("terminal task cannot be replanned");
    this.state.currentPlan = Array.isArray(plan) ? [...plan] : [plan];
    this.state.status = "RUNNING";
    this.record("PLAN_SET", { planHash: hashObject(this.state.currentPlan) });
  }

  setAction(action) {
    if (TERMINAL.has(this.state.status)) throw new Error("terminal task cannot accept actions");
    this.state.currentAction = action;
    this.record("ACTION_SET", { actionHash: hashObject(action) });
  }

  addEvidence(evidence) {
    this.state.evidence.push(evidence);
    this.record("EVIDENCE_ADDED", { evidenceHash: hashObject(evidence) });
  }

  block(reason) {
    this.state.status = "BLOCKED";
    this.record("TASK_BLOCKED", { reason });
  }

  requireReview(reason) {
    this.state.status = "REQUIRE_REVIEW";
    this.record("TASK_REVIEW_REQUIRED", { reason });
  }

  complete(proof) {
    if (!proof || !["VERIFIED", "SUPPORTED"].includes(proof.status)) {
      this.state.status = "UNKNOWN";
      this.record("COMPLETION_REJECTED", { proofStatus: proof?.status || "MISSING" });
      return false;
    }
    this.state.status = "COMPLETED";
    this.record("TASK_COMPLETED", { proofHash: hashObject(proof) });
    return true;
  }

  snapshot() {
    return {
      state: structuredClone(this.state),
      events: structuredClone(this.events),
      hash: hashObject({ state: this.state, events: this.events })
    };
  }
}
