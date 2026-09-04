import assert from "node:assert/strict";
import test from "node:test";
import { createEventHub } from "../server/event-hub.mjs";

test("account events reach only targeted users while market events reach everyone", () => {
  const hub = createEventHub();
  const first = [];
  const second = [];
  const unsubscribe = hub.subscribe("user-1", { write: (message) => first.push(message) });
  hub.subscribe("user-2", { write: (message) => second.push(message) });
  hub.publish("account", ["user-1"]);
  assert.equal(first.length, 1);
  assert.equal(second.length, 0);
  hub.publish("market");
  assert.equal(first.length, 2);
  assert.equal(second.length, 1);
  unsubscribe();
  assert.equal(hub.size(), 1);
});

test("external fan-out is published once and remote events are delivered locally", async () => {
  const hub = createEventHub();
  const published = [];
  const received = [];
  hub.setFanout(async (update) => published.push(update));
  hub.subscribe("user-1", { write: (message) => received.push(message) });
  hub.publish("account", ["user-1"]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(published, [{ event: "account", userIds: ["user-1"] }]);
  assert.equal(received.length, 1);
  hub.deliver("market");
  assert.equal(received.length, 2);
  assert.equal(published.length, 1);
});

test("closing the event hub ends every live stream and clears subscribers", () => {
  const hub = createEventHub();
  const streams = [
    { messages: [], ended: 0, write(message) { this.messages.push(message); }, end() { this.ended += 1; } },
    { messages: [], ended: 0, write(message) { this.messages.push(message); }, end() { this.ended += 1; } },
  ];
  hub.subscribe("user-1", streams[0]);
  hub.subscribe("user-2", streams[1]);

  hub.close();

  assert.equal(hub.size(), 0);
  for (const stream of streams) {
    assert.equal(stream.ended, 1);
    assert.match(stream.messages[0], /^event: shutdown/m);
  }
});
