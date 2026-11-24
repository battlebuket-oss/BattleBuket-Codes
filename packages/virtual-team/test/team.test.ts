import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildTeamPlan, rolePrompt } from "../src/index.js";
describe("virtual team planning", () => {
 it("assigns work to the matching specialist and weights critical work first", () => {
  const plan = buildTeamPlan([{id:"a",title:"Design",description:"",priority:"normal",skill:"architecture",estimatedEffort:3,dependsOn:[]},{id:"b",title:"Secure",description:"",priority:"critical",skill:"security",estimatedEffort:2,dependsOn:[]},{id:"c",title:"Build",description:"",priority:"high",skill:"implementation",estimatedEffort:5,dependsOn:["a"]}]);
  assert.equal(plan.assignments.find(x=>x.id==="a")?.assignedRole,"architect");
  assert.equal(plan.assignments.find(x=>x.id==="b")?.assignedRole,"security-auditor");
  assert.deepEqual(plan.executionOrder,["b","a","c"]);
 });
 it("balances flexible tasks across qualified specialists", () => {
  const plan = buildTeamPlan([{id:"d1",title:"Docs one",description:"",priority:"normal",skill:"documentation",estimatedEffort:2,dependsOn:[]},{id:"d2",title:"Docs two",description:"",priority:"normal",skill:"documentation",estimatedEffort:2,dependsOn:[]}]);
  assert.notEqual(plan.assignments[0].assignedRole,plan.assignments[1].assignedRole);
 });
 it("rejects dependency cycles", () => {
  assert.throws(() => buildTeamPlan([{id:"a",title:"A",description:"",priority:"normal",skill:"testing",estimatedEffort:1,dependsOn:["b"]},{id:"b",title:"B",description:"",priority:"normal",skill:"review",estimatedEffort:1,dependsOn:["a"]}]),/cycle/);
 });
 it("creates explicit role-specific instructions", () => {
  assert.match(rolePrompt("security-auditor","Audit the app","Repository context"),/Security Specialist/);
 });
});