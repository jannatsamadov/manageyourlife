import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are a productivity assistant for "Stratify". You help the user create tasks.

CRITICAL RULES:
1. When the user wants to add ONE task, call create_task.
2. When the user wants to add MULTIPLE tasks (list, comma-separated, numbered, etc.), you MUST call create_tasks with an array.
3. ALWAYS call a tool when the user wants to add tasks. NEVER respond with text only when tasks should be created.
4. For general questions or chat, respond normally without calling tools.

FIELD RULES - YOU MUST FOLLOW THESE:
- title: REQUIRED. Short clear task name.
- description: REQUIRED. Write 1-2 sentences explaining the task. NEVER leave empty. If user didn't provide details, generate a reasonable description.
- estimated_time: REQUIRED. Estimated minutes to complete. ALWAYS provide a number. If user didn't specify, GUESS a reasonable estimate (e.g. "read article" = 15, "write report" = 60, "quick email" = 5, "study chapter" = 45).
- deadline: Deadline in YYYY-MM-DD. If user mentions "today", "tomorrow", "next monday" etc, convert to date. If not mentioned, omit.
- link: URL if user provided one. Otherwise omit.
- priority: "high", "medium", or "low". Default "medium". If user says "important"/"urgent" use "high", if "minor"/"whenever" use "low".`;

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

    const token = authHeader.replace("Bearer ", "");
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: userError } = await anonClient.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { message, history, model } = await req.json();

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...(history || []),
      { role: "user", content: message },
    ];

    const tools = [
      {
        type: "function",
        function: {
          name: "create_tasks",
          description: "Create one or more tasks at once. Use this for bulk task creation.",
          parameters: {
            type: "object",
            properties: {
              tasks: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    title: { type: "string", description: "Task title" },
                    description: { type: "string", description: "Brief description" },
                    estimated_time: { type: "number", description: "Estimated minutes" },
                    deadline: { type: "string", description: "Deadline in YYYY-MM-DD format" },
                    link: { type: "string", description: "Related URL if any" },
                    priority: { type: "string", enum: ["high", "medium", "low"], description: "Priority level" },
                  },
                  required: ["title"],
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
          name: "create_task",
          description: "Create a single task",
          parameters: {
            type: "object",
            properties: {
              title: { type: "string", description: "Task title" },
              description: { type: "string", description: "Brief description" },
              estimated_time: { type: "number", description: "Estimated minutes" },
              deadline: { type: "string", description: "Deadline in YYYY-MM-DD format" },
              link: { type: "string", description: "Related URL if any" },
              priority: { type: "string", enum: ["high", "medium", "low"], description: "Priority level" },
            },
            required: ["title"],
            additionalProperties: false,
          },
        },
      },
    ];

    const aiModel = model || "google/gemini-3-flash-preview";

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: aiModel,
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
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
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

    const toolCalls = choice.message?.tool_calls;
    if (toolCalls && toolCalls.length > 0) {
      const today = new Date().toISOString().split("T")[0];
      const results: string[] = [];
      let totalCreated = 0;

      for (const call of toolCalls) {
        const args = JSON.parse(call.function.arguments);

        if (call.function.name === "create_task") {
          const { error } = await supabase.from("tasks").insert({
            user_id: user.id,
            title: args.title,
            description: args.description || "",
            estimated_time: args.estimated_time || null,
            status: "idle",
            date: null,
            deadline: args.deadline || "",
            link: args.link || "",
            priority: args.priority || "medium",
          });
          if (error) {
            results.push(`Failed "${args.title}": ${error.message}`);
          } else {
            results.push(`"${args.title}"`);
            totalCreated++;
          }
        }

        if (call.function.name === "create_tasks") {
          const taskList = args.tasks || [];
          for (const t of taskList) {
            const { error } = await supabase.from("tasks").insert({
              user_id: user.id,
              title: t.title,
              description: t.description || "",
              estimated_time: t.estimated_time || null,
              status: "idle",
              date: null,
              deadline: t.deadline || "",
              link: t.link || "",
              priority: t.priority || "medium",
            });
            if (error) {
              results.push(`Failed "${t.title}": ${error.message}`);
            } else {
              results.push(`"${t.title}"`);
              totalCreated++;
            }
          }
        }
      }

      const reply = totalCreated === 1
        ? `Added ${results[0]} to your plan.`
        : `Added ${totalCreated} tasks: ${results.join(", ")}`;

      return new Response(JSON.stringify({
        reply,
        action: totalCreated === 1 ? "task_created" : "tasks_created",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
