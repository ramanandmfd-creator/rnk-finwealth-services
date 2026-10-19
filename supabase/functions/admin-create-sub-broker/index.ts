// Deploy as Supabase Edge Function: admin-create-sub-broker
// Required secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: cors });

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) {
    return Response.json({ error: "Server function secrets are not configured." }, { status: 500, headers: cors });
  }

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return Response.json({ error: "Please sign in as Admin." }, { status: 401, headers: cors });

  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) return Response.json({ error: "Invalid login session." }, { status: 401, headers: cors });

  const adminClient = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: admin, error: adminError } = await adminClient
    .from("rnk_admins").select("user_id").eq("user_id", userData.user.id).maybeSingle();
  if (adminError || !admin) return Response.json({ error: "Only the RNK Admin can create Sub-Broker accounts." }, { status: 403, headers: cors });

  let body: { email?: string; password?: string; sub_broker_name?: string; sub_broker_code?: string };
  try { body = await req.json(); } catch { return Response.json({ error: "Invalid request body." }, { status: 400, headers: cors }); }
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const name = String(body.sub_broker_name || "").trim();
  const code = String(body.sub_broker_code || "").trim().toUpperCase();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ error: "Enter a valid email address." }, { status: 400, headers: cors });
  if (password.length < 10) return Response.json({ error: "Password must be at least 10 characters." }, { status: 400, headers: cors });
  if (!name || name.length > 150 || !code || code.length > 80) return Response.json({ error: "Sub-Broker name and code are required." }, { status: 400, headers: cors });

  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { role: "sub_broker", sub_broker_name: name, sub_broker_code: code },
  });
  if (createError || !created.user) {
    return Response.json({ error: createError?.message || "Could not create Sub-Broker login." }, { status: 400, headers: cors });
  }

  const { error: profileError } = await adminClient.from("rnk_sub_brokers").insert({
    user_id: created.user.id, sub_broker_name: name, sub_broker_code: code, email, active: true,
  });
  if (profileError) {
    await adminClient.auth.admin.deleteUser(created.user.id);
    return Response.json({ error: profileError.message }, { status: 400, headers: cors });
  }

  return Response.json({ success: true, user_id: created.user.id, email, sub_broker_name: name, sub_broker_code: code }, { status: 200, headers: cors });
});
