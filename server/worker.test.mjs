import test from "node:test";
import assert from "node:assert/strict";
import { createWorker, retryPlan } from "./worker.mjs";

test("regeneration reuses original prompts, context boundary and attachment scope without overwriting the source",async()=>{
  const queries=[],calls=[];
  const db={rpc:async(name,args)=>{calls.push([name,args]);return {data:name==="claim_compilation"?[{id:"new",conversation_id:"chat",regeneration_of:"original",created_at:"2026-11-25",lease_token:"lease"}]:true}},
    from(table){const q={table};queries.push(q);const chain={
      select(){return chain},eq(key,value){q[key]=value;return chain},lt(key,value){q.before=value;return chain},in(key,value){q.scope=value;return chain},order(){return chain},
      single:async()=>({data:{id:"original",created_at:"2026-11-24"}}),
      then(resolve){resolve({data:table==="prompts"?[{content:"Original question"}]:table==="compilations"?[{id:"prior",answer:"Earlier context"}]:[]})}
    };return chain}
  };
  const worker=createWorker(db,{generate:async input=>{
    assert.deepEqual(input,["Previous completed answers for context (new prompts below take priority):\nEarlier context","CURRENT USER MESSAGE:\nOriginal question"]);
    return {text:"New version",model:"test"};
  }});
  await worker.tick();worker.stop();
  assert.equal(queries.find(q=>q.table==="prompts").compilation_id,"original");
  assert.equal(queries.find(q=>q.before).before,"2026-11-24");
  assert.deepEqual(queries.find(q=>q.table==="attachments").scope,["original","prior"]);
  assert.equal(calls.at(-1)[1].p_id,"new");
  assert.equal(calls.at(-1)[1].p_answer,"New version");
});

test("backoff respects quota delay, bounds retries, and distinguishes permanent failures", () => {
  assert.deepEqual(
    retryPlan({ status: 429, retryable: true, retryAfter: "120" }, 1),
    { code: "rate_limit", delay: 120, retryable: true },
  );
  assert.equal(retryPlan({ name: "TimeoutError" }, 2).retryable, true);
  assert.equal(
    retryPlan({ status: 503, retryable: true }, 1, 0, () => 0).delay,
    5,
  );
  assert.equal(
    retryPlan({ status: 503, retryable: true }, 7, 0, () => 0.9).delay,
    60,
  );
  assert.equal(
    retryPlan({ status: 503, retryable: true }, 2, 0, () => 0.9).delay,
    11,
  );
  assert.equal(
    retryPlan({ status: 429, retryable: true }, 7, 0, () => 0).delay,
    3600,
  );
  assert.equal(retryPlan({ status: 400 }, 2).retryable, false);
  assert.equal(retryPlan({ code: "context_limit" }, 1).code, "context_limit");
  assert.equal(
    retryPlan({ status: 429, retryable: true, retryAfter: "999999999" }, 1)
      .delay,
    86400,
  );
});

test("worker accepts one lease, preserves ordered prompts, and stores a completed answer", async () => {
  const calls = [];
  let claims = 0;
  let unblock;
  const gate = new Promise((resolve) => {
    unblock = resolve;
  });
  const db = {
    rpc: async (name, args) => {
      calls.push([name, args]);
      return {
        data:
          name === "claim_compilation"
            ? claims++
              ? []
              : [
                  {
                    id: "job",
                    conversation_id: "chat",
                    lease_token: "lease",
                    attempts: 1,
                    created_at: "2026-11-24",
                  },
                ]
            : true,
      };
    },
    from(table) {
      const chain = {
        select() {
          return chain;
        },
        eq() {
          return chain;
        },
        lt() {
          return chain;
        },
        in() { return chain; },
        order() {
          return chain;
        },
        then(resolve) {
          resolve({
            data:
              table === "prompts"
                ? [{ content: "first" }, { content: "second" }]
                : [],
          });
        },
      };
      return chain;
    },
  };
  const worker = createWorker(db, {
    generate: async (input) => {
      assert.deepEqual(input, ["CURRENT USER MESSAGE:\nfirst", "CURRENT USER MESSAGE:\nsecond"]);
      await gate;
      return { text: "answer", title:"Reliable AI prompt queue", model: "test", usage: null };
    },
  });
  const first = worker.tick();
  await worker.tick();
  unblock();
  await first;
  worker.stop();
  assert.equal(claims, 1);
  assert.deepEqual(calls.at(-1), [
    "finish_compilation",
    {
      p_id: "job",
      p_lease: "lease",
      p_answer: "answer",
      p_model: "test",
      p_usage: null,
      p_title: "Reliable AI prompt queue",
    },
  ]);
});

test("a quota failure reschedules the leased job instead of losing it", async () => {
  const calls = [];
  const chain = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    lt() {
      return this;
    },
    in() { return this; },
    order() {
      return this;
    },
    then(resolve) {
      resolve({ data: [{ content: "prompt" }] });
    },
  };
  const worker = createWorker(
    {
      rpc: async (name, args) => {
        calls.push([name, args]);
        return {
          data:
            name === "claim_compilation"
              ? [{ id: "job", lease_token: "lease", attempts: 1 }]
              : true,
        };
      },
      from(table) {
        if(table==="attachments") return {select(){return this},eq(){return this},in(){return this},order(){return Promise.resolve({data:[]})}};
        return chain;
      },
    },
    {
      generate: async () => {
        const error = new Error("quota");
        error.status = 429;
        error.retryable = true;
        throw error;
      },
    },
  );
  await worker.tick();
  worker.stop();
  assert.equal(calls.at(-1)[0], "defer_compilation");
  assert.equal(calls.at(-1)[1].p_retry, true);
  assert.equal(calls.at(-1)[1].p_code, "rate_limit");
});
