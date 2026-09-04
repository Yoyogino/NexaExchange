export function createEventHub() {
  const subscribers = new Set();
  let fanout = null;

  function subscribe(userId, response) {
    const subscriber = { userId, response };
    subscribers.add(subscriber);
    return () => subscribers.delete(subscriber);
  }

  function deliver(event, userIds = null) {
    const targets = userIds ? new Set(userIds) : null;
    const message = `event: ${event}\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`;
    for (const subscriber of subscribers) {
      if (!targets || targets.has(subscriber.userId)) subscriber.response.write(message);
    }
  }

  function publish(event, userIds = null) {
    deliver(event, userIds);
    if (fanout) void fanout({ event, userIds }).catch((error) => {
      console.error(JSON.stringify({ event: "event_fanout_failed", message: error.message }));
    });
  }

  function setFanout(nextFanout) {
    fanout = nextFanout;
  }

  function close() {
    const message = `event: shutdown\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`;
    for (const subscriber of subscribers) {
      try {
        subscriber.response.write(message);
        subscriber.response.end();
      } catch { /* The client may already have disconnected. */ }
    }
    subscribers.clear();
    fanout = null;
  }

  return { close, deliver, publish, setFanout, subscribe, size: () => subscribers.size };
}
