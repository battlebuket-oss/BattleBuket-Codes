import type { VirtualRoleId, VirtualAgentRole } from "@battlebuket/agent-contracts";
export type WorkPriority = "critical" | "high" | "normal" | "low";
export type WorkSkill = "planning" | "architecture" | "implementation" | "review" | "testing" | "security" | "documentation" | "devops";
export interface WorkItem { id: string; title: string; description: string; priority: WorkPriority; skill: WorkSkill; estimatedEffort: number; dependsOn: string[]; eligibleRoles?: VirtualRoleId[]; }
export interface AssignedWork extends WorkItem { assignedRole: VirtualRoleId; priorityWeight: number; weightedEffort: number; }
export interface RoleWorkload { role: VirtualAgentRole; items: AssignedWork[]; totalEffort: number; weightedEffort: number; }
export interface TeamPlan { assignments: AssignedWork[]; workloads: RoleWorkload[]; executionOrder: string[]; notes: string[]; }
export const VIRTUAL_ROLES: VirtualAgentRole[] = [
{ id: "planner", name: "Planning Specialist", responsibility: "Clarifies scope, breaks objectives into bounded tasks, identifies dependencies and acceptance criteria.", deliverable: "Ordered work breakdown and acceptance criteria" },
{ id: "architect", name: "Architecture Specialist", responsibility: "Owns system design, interfaces, data models, scalability and technical trade-offs.", deliverable: "Architecture decisions and implementation boundaries" },
{ id: "implementer", name: "Implementation Specialist", responsibility: "Implements approved changes, follows repository conventions and keeps changes focused.", deliverable: "Code and documentation changes" },
{ id: "reviewer", name: "Code Review Specialist", responsibility: "Inspects diffs for correctness, maintainability, regressions and acceptance-criteria coverage.", deliverable: "Findings ranked by severity and required fixes" },
{ id: "tester", name: "Testing Specialist", responsibility: "Designs and runs relevant unit, integration, end-to-end and regression checks.", deliverable: "Reproducible test results and uncovered gaps" },
{ id: "security-auditor", name: "Security Specialist", responsibility: "Checks trust boundaries, secrets, permissions, dependencies and risky execution paths.", deliverable: "Threat findings and security gate results" }
];
const priorityWeight: Record<WorkPriority, number> = { critical: 8, high: 4, normal: 2, low: 1 };
const skillRole: Record<WorkSkill, VirtualRoleId> = { planning: "planner", architecture: "architect", implementation: "implementer", review: "reviewer", testing: "tester", security: "security-auditor", documentation: "implementer", devops: "implementer" };
const qualifiedRoles: Record<WorkSkill, VirtualRoleId[]> = { planning: ["planner"], architecture: ["architect"], implementation: ["implementer"], review: ["reviewer"], testing: ["tester"], security: ["security-auditor"], documentation: ["implementer", "reviewer"], devops: ["implementer", "security-auditor"] };
function orderedItems(items: WorkItem[]): WorkItem[] {
  const byId = new Map(items.map(item => [item.id, item]));
  if (byId.size !== items.length) throw new Error("Work item IDs must be unique");
  for (const item of items) for (const dep of item.dependsOn) if (!byId.has(dep)) throw new Error("Unknown dependency " + dep + " for " + item.id);
  const remaining = new Set(items.map(item => item.id)); const done = new Set<string>(); const output: WorkItem[] = [];
  while (remaining.size) {
    const ready = items.filter(item => remaining.has(item.id) && item.dependsOn.every(dep => done.has(dep))).sort((a,b) => priorityWeight[b.priority]-priorityWeight[a.priority] || b.estimatedEffort-a.estimatedEffort || a.id.localeCompare(b.id));
    if (!ready.length) throw new Error("Work item dependency cycle detected");
    const next = ready[0]; output.push(next); remaining.delete(next.id); done.add(next.id);
  }
  return output;
}
export function buildTeamPlan(items: WorkItem[]): TeamPlan {
  const workloads: RoleWorkload[] = VIRTUAL_ROLES.map(role => ({ role, items: [], totalEffort: 0, weightedEffort: 0 }));
  const ordered = orderedItems(items); const assignments: AssignedWork[] = [];
  for (const item of ordered) {
    if (!Number.isFinite(item.estimatedEffort) || item.estimatedEffort <= 0) throw new Error("Estimated effort must be a positive number for " + item.id);
    const preferred = skillRole[item.skill];
    const allowed = item.eligibleRoles ?? qualifiedRoles[item.skill];
    if (allowed.some(role => !qualifiedRoles[item.skill].includes(role))) throw new Error("Ineligible role requested for skill " + item.skill);
    const candidates = workloads.filter(load => allowed.includes(load.role.id));
    if (!candidates.length || !allowed.includes(preferred)) throw new Error("No qualified role for work item " + item.id);
    const target = candidates.sort((a,b) => a.weightedEffort-b.weightedEffort || (a.role.id === preferred ? -1 : b.role.id === preferred ? 1 : a.role.id.localeCompare(b.role.id)))[0];
    const weight = priorityWeight[item.priority];
    const assigned: AssignedWork = { ...item, assignedRole: target.role.id, priorityWeight: weight, weightedEffort: item.estimatedEffort * weight };
    target.items.push(assigned); target.totalEffort += item.estimatedEffort; target.weightedEffort += assigned.weightedEffort; assignments.push(assigned);
  }
  const active = workloads.filter(load => load.items.length > 0);
  const average = active.length ? active.reduce((sum,load) => sum + load.weightedEffort,0) / active.length : 0;
  const notes = ["One shared provider/runtime executes the role passes; roles are workflow specializations, not separately billed model instances.", "Work is assigned only to skill-qualified roles; flexible work goes to the qualified role with the lowest accumulated priority-weighted effort.", "Weighted workload is estimated effort multiplied by priority; the Director should rebalance only across roles qualified to own the work.", "Current allocation average weighted effort across active roles: " + average.toFixed(2)];
  return { assignments, workloads, executionOrder: ordered.map(item => item.id), notes };
}
export function rolePrompt(roleId: VirtualRoleId, objective: string, context: string): string {
  const role = VIRTUAL_ROLES.find(item => item.id === roleId);
  if (!role) throw new Error("Unknown virtual role: " + roleId);
  return ["ROLE: " + role.name, "SPECIALTY: " + role.responsibility, "EXPECTED DELIVERABLE: " + role.deliverable, "OBJECTIVE: " + objective, "SHARED CONTEXT: " + context, "Work only within this specialty. State assumptions, cite concrete files or evidence, and hand off unresolved dependencies. Do not claim another role has completed work unless its result is present."].join("\n");
}