import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Stack-level integration test: exercises the REAL Supabase stack (GoTrue auth +
// Postgres RLS) rather than mocks. This is the harness that makes pinning a fixed
// Supabase version set safe — it's what you re-run on every image bump to prove
// the auth↔API contract and the deny-all RLS firewall still hold. It also anchors
// the security model's central claim: RLS denies the user/anon path, and the API
// reaches data only via the service-role key.
//
// Gated: skipped unless a stack is provided (default CI unit run skips it).
// Locally: `supabase start`, then export the printed keys as:
//   SUPABASE_TEST_URL, SUPABASE_TEST_SERVICE_ROLE_KEY, SUPABASE_TEST_ANON_KEY
const url = process.env.SUPABASE_TEST_URL;
const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_TEST_ANON_KEY;
const maybeDescribe =
    url && serviceKey && anonKey ? describe : describe.skip;

// Every public table the app owns. The anon/user path must never return rows from
// any of these (deny-all); a regression that ships a table without RLS — or with a
// permissive policy — trips the leak sweep below.
const PUBLIC_TABLES = [
    "chat_messages", "chats", "courtlistener_citation_index",
    "courtlistener_opinion_cluster_index", "document_edits", "document_versions",
    "documents", "hidden_workflows", "project_subfolders", "projects",
    "tabular_cells", "tabular_review_chat_messages", "tabular_review_chats",
    "tabular_reviews", "user_api_keys", "user_mcp_connector_tools",
    "user_mcp_connectors", "user_mcp_oauth_states", "user_mcp_oauth_tokens",
    "user_mcp_tool_audit_logs", "user_profiles", "workflow_shares", "workflows",
];

maybeDescribe("Supabase stack — auth contract + RLS deny-all firewall", () => {
    const password = "StackTest1!";
    const emailA = `stack-a-${Date.now()}@test.local`;
    const emailB = `stack-b-${Date.now()}@test.local`;

    let admin: SupabaseClient; // service-role: BYPASSRLS, the app's data path
    let userA = "";
    let userB = "";
    let tokenA = "";
    let projectId = "";

    // A client acting as a signed-in end user (anon key + the user's JWT): this is
    // the path RLS must fence off.
    const asUser = (token: string) =>
        createClient(url!, anonKey!, {
            auth: { persistSession: false, autoRefreshToken: false },
            global: { headers: { Authorization: `Bearer ${token}` } },
        });

    beforeAll(async () => {
        admin = createClient(url!, serviceKey!, {
            auth: { persistSession: false, autoRefreshToken: false },
        });

        const a = await admin.auth.admin.createUser({
            email: emailA, password, email_confirm: true,
        });
        const b = await admin.auth.admin.createUser({
            email: emailB, password, email_confirm: true,
        });
        if (a.error || !a.data.user) throw a.error ?? new Error("no user A");
        if (b.error || !b.data.user) throw b.error ?? new Error("no user B");
        userA = a.data.user.id;
        userB = b.data.user.id;

        // Sign in as A to get a real access token (the token the API middleware
        // validates via auth.getUser).
        const signIn = await createClient(url!, anonKey!, {
            auth: { persistSession: false, autoRefreshToken: false },
        }).auth.signInWithPassword({ email: emailA, password });
        if (signIn.error || !signIn.data.session) {
            throw signIn.error ?? new Error("no session for A");
        }
        tokenA = signIn.data.session.access_token;

        // Seed one row owned by A via the service role (the app's real write path).
        const proj = await admin
            .from("projects")
            .insert({ user_id: userA, name: "Stack Test Project" })
            .select("id")
            .single();
        if (proj.error || !proj.data) throw proj.error ?? new Error("no project");
        projectId = proj.data.id;
    });

    afterAll(async () => {
        if (projectId) await admin.from("projects").delete().eq("id", projectId);
        if (userA) await admin.auth.admin.deleteUser(userA);
        if (userB) await admin.auth.admin.deleteUser(userB);
    });

    it("auth contract: the access token resolves to its user (middleware path)", async () => {
        const { data, error } = await admin.auth.getUser(tokenA);
        expect(error).toBeNull();
        expect(data.user?.id).toBe(userA);
        expect(data.user?.email).toBe(emailA);
    });

    it("RLS: the service role sees seeded rows the owner cannot see via the user path", async () => {
        // Service role (app data path) sees the project…
        const svc = await admin
            .from("projects").select("id").eq("id", projectId);
        expect(svc.error).toBeNull();
        expect(svc.data ?? []).toHaveLength(1);

        // …but the owner, going through the user/anon path, sees zero rows —
        // deny-all RLS is the firewall; the app must use the service role.
        const owner = await asUser(tokenA)
            .from("projects").select("id").eq("id", projectId);
        expect(owner.data ?? []).toHaveLength(0);

        // And the owner's auto-created profile is equally invisible to the user path.
        const prof = await asUser(tokenA)
            .from("user_profiles").select("user_id").eq("user_id", userA);
        expect(prof.data ?? []).toHaveLength(0);
    });

    it("tenant isolation: user B cannot read user A's project via the user path", async () => {
        const signInB = await createClient(url!, anonKey!, {
            auth: { persistSession: false, autoRefreshToken: false },
        }).auth.signInWithPassword({ email: emailB, password });
        const tokenB = signInB.data.session!.access_token;

        const cross = await asUser(tokenB)
            .from("projects").select("id").eq("id", projectId);
        expect(cross.data ?? []).toHaveLength(0);
    });

    it("leak sweep: no public table returns rows to the authenticated user path", async () => {
        const client = asUser(tokenA);
        const leaks: string[] = [];
        for (const table of PUBLIC_TABLES) {
            const { data } = await client.from(table).select("*").limit(1);
            if ((data ?? []).length > 0) leaks.push(table);
        }
        // Any table returning rows to a normal user means RLS is missing or a
        // policy is permissive — the exact regression this guards against.
        expect(leaks).toEqual([]);
    });
});
