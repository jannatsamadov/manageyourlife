import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are a personal productivity assistant for the app "Stratify". Your job is to help the user capture tasks and opportunities from their input.

RULES:
1. Analyze the user's message to determine if it's a "task" (direct action / quick to-do) or an "opportunity" (external event with a deadline, application, or form).
2. Extract: title, description, estimated_time (in minutes, guess if not provided), deadline (YYYY-MM-DD if found), and link (URL if found).
3. If the input has a deadline or mentions an external event/application/form, classify it as "opportunity".
4. If it's a direct action or quick to-do, classify it as "task".
5. If you cannot determine a deadline for an opportunity, set needs_deadline to true.
6. If a link/URL is in the message, extract it into the link field.
7. BULK ADD: When the user provides MULTIPLE tasks in one message (e.g. "Add: buy milk, call mom, finish report" or a numbered/bulleted list), use create_tasks to add them all at once. Do NOT use create_task repeatedly for each item.
8. Always respond by calling the appropriate tool.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get user from token
    const token = authHeader.replace("Bearer ", "");
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: userError } = await anonClient.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { message, history, model: requestedModel } = await req.json();

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...(history || []),
      { role: "user", content: message },
    ];

    const tools = [
      {
        type: "function",
        function: {
          name: "create_task",
          description: "Create a single daily task for the user. Use only when adding ONE task.",
          parameters: {
            type: "object",
            properties: {
              title: { type: "string", description: "Short task title" },
              description: { type: "string", description: "Brief description" },
              estimated_time: { type: "number", description: "Estimated minutes" },
            },
            required: ["title", "description", "estimated_time"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "create_tasks",
          description: "Create multiple daily tasks at once. Use when the user provides 2 or more tasks in one message (lists, bullet points, comma-separated items, etc.).",
          parameters: {
            type: "object",
            properties: {
              tasks: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    title: { type: "string", description: "Short task title" },
                    description: { type: "string", description: "Brief description" },
                    estimated_time: { type: "number", description: "Estimated minutes" },
                  },
                  required: ["title", "description", "estimated_time"],
                },
                description: "Array of tasks to create",
              },
            },
            required: ["tasks"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "create_opportunity",
          description: "Create an opportunity with a deadline",
          parameters: {
            type: "object",
            properties: {
              name: { type: "string", description: "Opportunity name" },
              description: { type: "string", description: "Brief description" },
              estimated_time: { type: "number", description: "Estimated minutes" },
              deadline: { type: "string", description: "Deadline in YYYY-MM-DD format" },
              link: { type: "string", description: "Related URL if any" },
              priority: { type: "string", enum: ["high", "medium", "low"], description: "Priority level" },
            },
            required: ["name", "description", "estimated_time", "priority"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "ask_for_deadline",
          description: "Ask the user if there is a specific deadline when one wasn't provided for an opportunity-like item",
          parameters: {
            type: "object",
            properties: {
              item_summary: { type: "string", description: "Summary of the item to ask about" },
            },
            required: ["item_summary"],
            additionalProperties: false,
          },
        },
      },
    ];

    const defaultModel = "google/gemini-2.0-flash";
    const model = requestedModel && typeof requestedModel === "string" ? requestedModel : defaultModel;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        tools,
        tool_choice: "auto",
      }),
    });

    if (!response.ok) {
      const status = response.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits in Settings." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await response.text();
      console.error("AI gateway error:", status, errText);
      throw new Error(`AI gateway error: ${status}`);
    }

    const aiResult = await response.json();
    const choice = aiResult.choices?.[0];

    if (!choice) throw new Error("No response from AI");

    // Handle tool calls
    const toolCalls = choice.message?.tool_calls;
    if (toolCalls && toolCalls.length > 0) {
      const call = toolCalls[0];
      const args = JSON.parse(call.function.arguments);

      if (call.function.name === "create_task") {
        const today = new Date().toISOString().split("T")[0];
        const { error } = await supabase.from("tasks").insert({
          user_id: user.id,
          title: args.title,
          description: args.description || "",
          estimated_time: args.estimated_time || null,
          status: "idle",
          date: today,
        });

        if (error) {
          console.error("DB insert error:", error);
          return new Response(JSON.stringify({
            reply: `I tried to add "${args.title}" but got an error: ${error.message}`,
            action: "error",
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({
          reply: `Done! I've added "${args.title}" to your **Daily Plan** with an estimated time of **${args.estimated_time} minutes**.`,
          action: "task_created",
          data: args,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (call.function.name === "create_tasks") {
        const taskList = Array.isArray(args.tasks) ? args.tasks : [];
        const today = new Date().toISOString().split("T")[0];
        const inserted: string[] = [];
        const errors: string[] = [];

        for (const t of taskList.slice(0, 20)) {
          const title = t?.title;
          const desc = t?.description ?? "";
          const est = t?.estimated_time ?? 30;
          if (!title || typeof title !== "string") continue;
          const { error } = await supabase.from("tasks").insert({
            user_id: user.id,
            title: String(title).trim(),
            description: String(desc),
            estimated_time: typeof est === "number" ? est : 30,
            status: "idle",
            date: today,
          });
          if (error) errors.push(`${title}: ${error.message}`);
          else inserted.push(title);
        }

        const reply =
          inserted.length > 0
            ? `Done! I've added **${inserted.length}** task(s) to your Daily Plan: ${inserted.map((t) => `"${t}"`).join(", ")}.`
            : "I couldn't add any tasks.";
        const withErrors = errors.length > 0 ? ` Some failed: ${errors.join("; ")}.` : "";

        return new Response(JSON.stringify({
          reply: reply + withErrors,
          action: inserted.length > 0 ? "tasks_created" : "error",
          data: { inserted, errors },
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (call.function.name === "create_opportunity") {
        const deadline = args.deadline || new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];
        const { error } = await supabase.from("opportunities").insert({
          user_id: user.id,
          name: args.name,
          description: args.description || "",
          estimated_time: args.estimated_time || null,
          deadline,
          link: args.link || "",
          priority: args.priority || "medium",
        });

        if (error) {
          console.error("DB insert error:", error);
          return new Response(JSON.stringify({
            reply: `I tried to add "${args.name}" but got an error: ${error.message}`,
            action: "error",
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({
          reply: `Done! I've added "${args.name}" to your **Opportunities** with an estimated time of **${args.estimated_time} minutes** and deadline **${deadline}**.`,
          action: "opportunity_created",
          data: { ...args, deadline },
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (call.function.name === "ask_for_deadline") {
        return new Response(JSON.stringify({
          reply: `I noticed "${args.item_summary}" might be an opportunity. Is there a specific deadline for this, or should I leave it open?`,
          action: "ask_deadline",
          data: args,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Fallback: plain text response
    const text = choice.message?.content || "I'm not sure what to do with that. Could you rephrase?";
    return new Response(JSON.stringify({ reply: text, action: "chat" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-assistant error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
