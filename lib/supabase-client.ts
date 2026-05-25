/**
 * lib/supabase-client.ts
 *
 * Shared Supabase client used by all agents.
 * Passes the `ws` package as the WebSocket transport
 * so it works on Node.js 21 (which has no native WebSocket).
 *
 * Import in every agent file:
 *   import { supabase } from "../lib/supabase-client";
 */

import { createClient } from "@supabase/supabase-js";
import ws from "ws";

export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    realtime: {
      transport: ws,
    },
  }
);
