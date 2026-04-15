"use client";
import { useEffect, useRef, useState } from "react";
import { AGENT_API } from "@/lib/addresses";

export type AgentEvent = {
  type: string;
  [k: string]: unknown;
};

/** Subscribe to the agent's /sse stream. */
export function useAgentSse(limit = 100) {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const bufRef = useRef<AgentEvent[]>([]);

  useEffect(() => {
    const es = new EventSource(`${AGENT_API}/sse`);

    function handle(eventType: string) {
      return (ev: MessageEvent) => {
        try {
          const data = JSON.parse(ev.data);
          bufRef.current = [{ ...data, type: eventType }, ...bufRef.current].slice(0, limit);
          setEvents([...bufRef.current]);
        } catch {
          // drop unparseable
        }
      };
    }

    for (const t of ["poll", "fire", "verdict", "intent", "expire", "error", "heartbeat"]) {
      es.addEventListener(t, handle(t));
    }
    es.onerror = () => {
      // keep open; EventSource auto-reconnects
    };
    return () => es.close();
  }, [limit]);

  return events;
}
